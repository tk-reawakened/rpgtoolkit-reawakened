import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  askWorkerVersion,
  registrationBlocker,
  registerPlayerWorker,
  shouldRegisterServiceWorker,
  PLAYER_PAGE_URL,
  PLAYER_SCOPE,
  PRECACHE_MANIFEST_URL,
  WORKER_SCRIPT_URL,
  type WindowLike,
} from "../src/register-worker.ts";
import {
  classifyRequest,
  createShellWorkerHandlers,
  DESCRIPTORS_CACHE_NAME,
  isDescriptorPath,
  isForbiddenPath,
  isShellCacheName,
  parsePrecacheManifest,
  shellCacheName,
  staleShellCaches,
  type CacheLike,
  type CacheStorageLike,
  type ExtendableMessageEventLike,
  type FetchEventLike,
  type PrecacheManifest,
} from "../src/service-worker-core.ts";

const dummyReg = {
  scope: "",
  active: null,
  installing: null,
  waiting: null,
  update: async () => ({}),
  unregister: async () => true,
};
const dummySw = {
  register: async () => dummyReg,
};

test("shouldRegisterServiceWorker guards desktop, non-http, and missing serviceWorker", () => {
  // Electron desktop app: protocol app: must return false
  equal(
    shouldRegisterServiceWorker(
      { protocol: "app:", origin: "app://player" },
      { serviceWorker: dummySw },
    ),
    false,
  );

  // Non-http(s) protocols (Capacitor capacitor:, file:, chrome-extension:)
  equal(
    shouldRegisterServiceWorker(
      { protocol: "file:", origin: "file://" },
      { serviceWorker: dummySw },
    ),
    false,
  );
  equal(
    shouldRegisterServiceWorker(
      { protocol: "capacitor:", origin: "capacitor://localhost" },
      { serviceWorker: dummySw },
    ),
    false,
  );

  // Missing serviceWorker API
  equal(
    shouldRegisterServiceWorker(
      { protocol: "http:", origin: "http://127.0.0.1:4173" },
      { serviceWorker: null },
    ),
    false,
  );
  equal(
    shouldRegisterServiceWorker(
      { protocol: "http:", origin: "http://127.0.0.1:4173" },
      {},
    ),
    false,
  );

  // Missing location or navigator
  equal(shouldRegisterServiceWorker(null, { serviceWorker: dummySw }), false);
  equal(shouldRegisterServiceWorker({ protocol: "http:" }, null), false);

  // Valid web HTTP and HTTPS
  equal(
    shouldRegisterServiceWorker(
      { protocol: "http:", origin: "http://127.0.0.1:4173" },
      { serviceWorker: dummySw },
    ),
    true,
  );
  equal(
    shouldRegisterServiceWorker(
      { protocol: "https:", origin: "https://example.com" },
      { serviceWorker: dummySw },
    ),
    true,
  );
});

test("registrationBlocker identifies the exact reason registration cannot proceed", () => {
  equal(registrationBlocker(null, {}), "no-location");
  equal(registrationBlocker({ protocol: "app:" }, { serviceWorker: dummySw }), "desktop-app-scheme");
  equal(registrationBlocker({ protocol: "file:" }, { serviceWorker: dummySw }), "unsupported-protocol: file:");
  equal(registrationBlocker({ protocol: "http:" }, null), "no-service-worker");
  equal(registrationBlocker({ protocol: "http:" }, { serviceWorker: null }), "no-service-worker");
  equal(registrationBlocker({ protocol: "http:" }, { serviceWorker: dummySw }), null);
});

test("registerPlayerWorker skips desktop app: without calling register", async () => {
  let registerCalled = false;
  const mockWin: WindowLike = {
    location: { protocol: "app:", origin: "app://player" },
    navigator: {
      serviceWorker: {
        register: async () => {
          registerCalled = true;
          return dummyReg;
        },
      },
    },
  };

  const result = await registerPlayerWorker(mockWin);
  equal(result.registered, false);
  if (!result.registered) {
    equal(result.reason, "desktop-app-scheme");
  }
  equal(registerCalled, false);
});

test("registerPlayerWorker registers /apps/service-worker.js with player scope by default", async () => {
  let passedScript: string | URL | null = null;
  let passedOptions: { scope?: string; updateViaCache?: string } | undefined;

  const mockRegistration = { scope: PLAYER_SCOPE, active: null, installing: null, waiting: null, update: async () => ({}), unregister: async () => true };

  const mockWin: WindowLike = {
    location: { protocol: "http:", origin: "http://127.0.0.1:4173" },
    navigator: {
      serviceWorker: {
        register: async (script, options) => {
          passedScript = script;
          passedOptions = options;
          return mockRegistration;
        },
      },
    },
  };

  const result = await registerPlayerWorker(mockWin);
  equal(result.registered, true);
  equal(passedScript, WORKER_SCRIPT_URL);
  deepEqual(passedOptions, { scope: PLAYER_SCOPE, updateViaCache: "none" });
});

test("registerPlayerWorker supports custom scope override and surfaces register failure", async () => {
  const customScope = "/packages/runner-web/app/worker-probe.html";
  let passedOptions: { scope?: string; updateViaCache?: string } | undefined;

  const mockWin: WindowLike = {
    location: { protocol: "http:", origin: "http://127.0.0.1:4173" },
    navigator: {
      serviceWorker: {
        register: async (_script, options) => {
          passedOptions = options;
          return { scope: customScope, active: null, installing: null, waiting: null, update: async () => ({}), unregister: async () => true };
        },
      },
    },
  };

  const okResult = await registerPlayerWorker(mockWin, { scope: customScope });
  equal(okResult.registered, true);
  equal(passedOptions?.scope, customScope);

  const failingWin: WindowLike = {
    location: { protocol: "http:", origin: "http://127.0.0.1:4173" },
    navigator: {
      serviceWorker: {
        register: async () => {
          throw new Error("SecurityError: Scope disallowed");
        },
      },
    },
  };

  const failResult = await registerPlayerWorker(failingWin);
  equal(failResult.registered, false);
  if (!failResult.registered) {
    ok(failResult.reason.includes("SecurityError"));
  }
});

test("cache naming and staleness helpers", () => {
  equal(shellCacheName("test1"), "tkr-shell-test1");
  equal(isShellCacheName("tkr-shell-test1"), true);
  equal(isShellCacheName("tkr-descriptors"), false);
  equal(isShellCacheName("other-cache"), false);

  const existing = ["tkr-shell-v1", "tkr-shell-v2", "tkr-descriptors", "custom-cache"];
  const stale = staleShellCaches(existing, "v2");
  deepEqual(stale, ["tkr-shell-v1"]);
});

test("isForbiddenPath and isDescriptorPath checks", () => {
  equal(isForbiddenPath("/api/game"), true);
  equal(isForbiddenPath("/api/bundled"), true);
  equal(isForbiddenPath("/api"), true);
  equal(isForbiddenPath("/fixtures/packages/demo.tpk"), true);
  equal(isForbiddenPath("/saves/slot1.sav"), true);
  equal(isForbiddenPath("/blobs/game.sav"), true);
  equal(isForbiddenPath("/save/data.json"), true);

  // Descriptors are NOT forbidden paths
  equal(isForbiddenPath("/fixtures/packages/demo.tpk.json"), false);
  equal(isForbiddenPath("/packages/runner-web/app/index.html"), false);
  equal(isForbiddenPath("/apps/player.js"), false);

  // Descriptor path identification
  equal(isDescriptorPath("/fixtures/packages/demo.tpk.json"), true);
  equal(isDescriptorPath("/packages/game.tpk.json"), true);
  equal(isDescriptorPath("/fixtures/packages/demo.tpk"), false);
  equal(isDescriptorPath("/api/demo.tpk.json"), false);
});

test("parsePrecacheManifest validates manifest shape and rejects forbidden paths", async () => {
  const valid = {
    version: "3a4f6d",
    shell: ["/packages/runner-web/app/index.html", "/apps/player.js"],
    bundled: ["/media/fonts/LiberationMono-Regular.ttf"],
  };
  const parsed = parsePrecacheManifest(valid);
  equal(parsed.version, "3a4f6d");
  deepEqual(parsed.shell, valid.shell);
  deepEqual(parsed.bundled, valid.bundled);

  // Reject non-objects or invalid version
  await rejects(async () => parsePrecacheManifest(null));
  await rejects(async () => parsePrecacheManifest({ version: "", shell: [], bundled: [] }));
  await rejects(async () => parsePrecacheManifest({ version: "bad version!", shell: [], bundled: [] }));

  // Reject non-absolute URLs
  await rejects(async () => parsePrecacheManifest({ version: "v1", shell: ["relative/path.js"], bundled: [] }));

  // Reject forbidden paths in shell or bundled
  await rejects(async () => parsePrecacheManifest({ version: "v1", shell: ["/api/shell.js"], bundled: [] }));
  await rejects(async () => parsePrecacheManifest({ version: "v1", shell: ["/game.tpk"], bundled: [] }));
  await rejects(async () => parsePrecacheManifest({ version: "v1", shell: ["/saves/slot.sav"], bundled: [] }));
});

test("classifyRequest routes requests according to service worker contract", () => {
  const origin = "http://127.0.0.1:4173";
  const shellUrls = new Set([
    "/packages/runner-web/app/index.html",
    "/apps/player.js",
    "/apps/bundled.json",
    "/apps/precache.json",
    "/media/fonts/LiberationMono-Regular.ttf",
  ]);

  // Non-GET requests pass through untouched
  equal(classifyRequest({ method: "POST", url: `${origin}/apps/player.js` }, origin, shellUrls), "pass-through");
  equal(classifyRequest({ method: "HEAD", url: `${origin}/apps/player.js` }, origin, shellUrls), "pass-through");

  // Cross-origin requests pass through untouched
  equal(classifyRequest({ method: "GET", url: "https://other.example.com/apps/player.js" }, origin, shellUrls), "pass-through");

  // Range requests pass through untouched
  equal(
    classifyRequest(
      { method: "GET", url: `${origin}/apps/player.js`, headers: { range: "bytes=0-10" } },
      origin,
      shellUrls,
    ),
    "pass-through",
  );

  // Forbidden URLs (/api/, .tpk binary, save/blob) pass through untouched
  equal(classifyRequest({ method: "GET", url: `${origin}/api/game?root=demo` }, origin, shellUrls), "pass-through");
  equal(classifyRequest({ method: "GET", url: `${origin}/api/bundled` }, origin, shellUrls), "pass-through");
  equal(classifyRequest({ method: "GET", url: `${origin}/fixtures/packages/demo.tpk` }, origin, shellUrls), "pass-through");
  equal(classifyRequest({ method: "GET", url: `${origin}/saves/slot1.sav` }, origin, shellUrls), "pass-through");

  // Descriptors: network-first
  equal(classifyRequest({ method: "GET", url: `${origin}/fixtures/packages/demo.tpk.json` }, origin, shellUrls), "network-first-descriptor");

  // Shell URLs: cache-first
  equal(classifyRequest({ method: "GET", url: `${origin}/packages/runner-web/app/index.html` }, origin, shellUrls), "cache-first-shell");
  equal(classifyRequest({ method: "GET", url: `${origin}/packages/runner-web/app/index.html?package=demo.tpk` }, origin, shellUrls), "cache-first-shell");
  equal(classifyRequest({ method: "GET", url: `${origin}/apps/player.js` }, origin, shellUrls), "cache-first-shell");
  equal(classifyRequest({ method: "GET", url: `${origin}/media/fonts/LiberationMono-Regular.ttf` }, origin, shellUrls), "cache-first-shell");

  // Other GET paths pass through untouched
  equal(classifyRequest({ method: "GET", url: `${origin}/unrelated.png` }, origin, shellUrls), "pass-through");
});

// In-memory Cache and CacheStorage simulation for testing worker handlers in pure Node
class MemoryCache implements CacheLike {
  private readonly entries = new Map<string, Response>();

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const key = typeof request === "string" ? request : "url" in request ? request.url : String(request);
    const parsed = new URL(key, "http://127.0.0.1:4173");
    // Store by pathname for path-independent lookups
    this.entries.set(parsed.pathname, response.clone());
  }

  async match(request: RequestInfo | URL, options?: { ignoreSearch?: boolean }): Promise<Response | undefined> {
    const key = typeof request === "string" ? request : "url" in request ? request.url : String(request);
    const parsed = new URL(key, "http://127.0.0.1:4173");
    const matched = this.entries.get(parsed.pathname);
    return matched ? matched.clone() : undefined;
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    const key = typeof request === "string" ? request : "url" in request ? request.url : String(request);
    const parsed = new URL(key, "http://127.0.0.1:4173");
    return this.entries.delete(parsed.pathname);
  }

  keys(): string[] {
    return Array.from(this.entries.keys());
  }
}

class MemoryCacheStorage implements CacheStorageLike {
  readonly store = new Map<string, MemoryCache>();

  async open(name: string): Promise<MemoryCache> {
    let cache = this.store.get(name);
    if (!cache) {
      cache = new MemoryCache();
      this.store.set(name, cache);
    }
    return cache;
  }

  async keys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }

  async delete(name: string): Promise<boolean> {
    return this.store.delete(name);
  }

  async match(request: RequestInfo | URL, options?: { ignoreSearch?: boolean }): Promise<Response | undefined> {
    for (const cache of this.store.values()) {
      const match = await cache.match(request, options);
      if (match) return match;
    }
    return undefined;
  }
}

test("createShellWorkerHandlers onInstall precaches manifest assets atomically", async () => {
  const version = "testv1";
  const origin = "http://127.0.0.1:4173";
  const caches = new MemoryCacheStorage();

  const manifest: PrecacheManifest = {
    version,
    shell: ["/packages/runner-web/app/index.html", "/apps/player.js", "/apps/precache.json"],
    bundled: ["/media/fonts/test.ttf"],
  };

  const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : "url" in input ? input.url : String(input);
    const parsed = new URL(url, origin);
    if (parsed.pathname === PRECACHE_MANIFEST_URL) {
      return new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (manifest.shell.includes(parsed.pathname) || manifest.bundled.includes(parsed.pathname)) {
      return new Response(`content of ${parsed.pathname}`, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  const shellUrls = new Set<string>();
  const handlers = createShellWorkerHandlers({
    version,
    origin,
    caches,
    fetch: fetchMock,
    shellUrls,
  });

  await handlers.onInstall();

  // Verify shellUrls was populated
  equal(shellUrls.has("/packages/runner-web/app/index.html"), true);
  equal(shellUrls.has("/media/fonts/test.ttf"), true);

  // Verify cache was populated with versioned name
  const cache = await caches.open(shellCacheName(version));
  equal(cache.keys().length, 4);
  const matched = await cache.match("/apps/player.js");
  ok(matched);
  equal(await matched.text(), "content of /apps/player.js");
});

test("createShellWorkerHandlers onInstall cleans up cache if precache fetch fails", async () => {
  const version = "failv1";
  const origin = "http://127.0.0.1:4173";
  const caches = new MemoryCacheStorage();

  const manifest: PrecacheManifest = {
    version,
    shell: ["/packages/runner-web/app/index.html", "/apps/player.js"],
    bundled: ["/media/fonts/broken.ttf"],
  };

  const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : "url" in input ? input.url : String(input);
    const parsed = new URL(url, origin);
    if (parsed.pathname === PRECACHE_MANIFEST_URL) {
      return new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (parsed.pathname === "/media/fonts/broken.ttf") {
      return new Response("server error", { status: 500 });
    }
    return new Response("ok", { status: 200 });
  };

  const handlers = createShellWorkerHandlers({
    version,
    origin,
    caches,
    fetch: fetchMock,
    shellUrls: new Set(),
  });

  await rejects(async () => handlers.onInstall());
  // Partial cache must be deleted
  equal(caches.store.has(shellCacheName(version)), false);
});

test("createShellWorkerHandlers onActivate purges only older shell caches", async () => {
  const origin = "http://127.0.0.1:4173";
  const caches = new MemoryCacheStorage();
  await caches.open("tkr-shell-v1");
  await caches.open("tkr-shell-v2");
  await caches.open(DESCRIPTORS_CACHE_NAME);
  await caches.open("user-custom-data");

  const handlers = createShellWorkerHandlers({
    version: "v2",
    origin,
    caches,
    fetch: async () => new Response(),
    shellUrls: new Set(),
  });

  await handlers.onActivate();

  const remaining = await caches.keys();
  deepEqual(remaining.sort(), [DESCRIPTORS_CACHE_NAME, "tkr-shell-v2", "user-custom-data"].sort());
  equal(remaining.includes("tkr-shell-v1"), false);
  equal(remaining.includes("tkr-shell-v2"), true);
  equal(remaining.includes(DESCRIPTORS_CACHE_NAME), true);
});

test("createShellWorkerHandlers onFetch serves shell cache-first and descriptors network-first", async () => {
  const version = "fetchv1";
  const origin = "http://127.0.0.1:4173";
  const caches = new MemoryCacheStorage();
  const shellCache = await caches.open(shellCacheName(version));
  await shellCache.put("/apps/player.js", new Response("cached player.js", { status: 200 }));

  let networkCalls = 0;
  let offline = false;

  const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
    networkCalls += 1;
    if (offline) {
      throw new TypeError("Failed to fetch (offline)");
    }
    const url = typeof input === "string" ? input : "url" in input ? input.url : String(input);
    const parsed = new URL(url, origin);
    if (parsed.pathname === "/fixtures/packages/demo.tpk.json") {
      return new Response(JSON.stringify({ gameId: "demo-id", size: 1234 }), { status: 200 });
    }
    return new Response(`network: ${parsed.pathname}`, { status: 200 });
  };

  const shellUrls = new Set(["/apps/player.js", "/packages/runner-web/app/index.html"]);
  const handlers = createShellWorkerHandlers({
    version,
    origin,
    caches,
    fetch: fetchMock,
    shellUrls,
  });

  // 1. Shell URL cache hit: returned from cache without network call
  let respondedWith: Promise<Response> | null = null as Promise<Response> | null;
  const shellEvent: FetchEventLike = {
    request: new Request(`${origin}/apps/player.js`),
    respondWith: (p) => {
      respondedWith = Promise.resolve(p);
    },
    waitUntil: () => undefined,
  };
  handlers.onFetch(shellEvent);
  ok(respondedWith);
  const shellRes = await respondedWith;
  equal(await shellRes.text(), "cached player.js");
  equal(networkCalls, 0);

  // 2. Shell URL cache miss: attempts network fetch
  let missPromise: Promise<Response> | null = null as Promise<Response> | null;
  const missEvent: FetchEventLike = {
    request: new Request(`${origin}/packages/runner-web/app/index.html`),
    respondWith: (p) => {
      missPromise = Promise.resolve(p);
    },
    waitUntil: () => undefined,
  };
  handlers.onFetch(missEvent);
  ok(missPromise);
  const missRes = await missPromise;
  equal(await missRes.text(), "network: /packages/runner-web/app/index.html");
  equal(networkCalls, 1);

  // 3. Shell URL cache miss while offline: surfaces as normal network failure (never fabricates response)
  offline = true;
  let offlineMissPromise: Promise<Response> | null = null;
  handlers.onFetch({
    request: new Request(`${origin}/packages/runner-web/app/index.html`),
    respondWith: (p) => {
      offlineMissPromise = Promise.resolve(p);
    },
    waitUntil: () => undefined,
  });
  ok(offlineMissPromise);
  await rejects(async () => offlineMissPromise);

  // 4. Descriptor online: fetched network-first and stored in descriptor cache
  offline = false;
  let descPromise: Promise<Response> | null = null as Promise<Response> | null;
  const descEvent: FetchEventLike = {
    request: new Request(`${origin}/fixtures/packages/demo.tpk.json`),
    respondWith: (p) => {
      descPromise = Promise.resolve(p);
    },
    waitUntil: (p) => {
      void p;
    },
  };
  handlers.onFetch(descEvent);
  ok(descPromise);
  const descRes = await descPromise;
  ok(descRes.ok);

  // Wait for descriptor cache write to settle
  const descCache = await caches.open(DESCRIPTORS_CACHE_NAME);
  const cachedDesc = await descCache.match("/fixtures/packages/demo.tpk.json");
  ok(cachedDesc);

  // 5. Descriptor offline: falls back to cached descriptor
  offline = true;
  let offlineDescPromise: Promise<Response> | null = null as Promise<Response> | null;
  handlers.onFetch({
    request: new Request(`${origin}/fixtures/packages/demo.tpk.json`),
    respondWith: (p) => {
      offlineDescPromise = Promise.resolve(p);
    },
    waitUntil: () => undefined,
  });
  ok(offlineDescPromise);
  const offlineDescRes = await offlineDescPromise;
  equal(offlineDescRes.status, 200);

  // 6. Descriptor offline with cache miss: throws network error (never fabricates response)
  let uncachedDescPromise: Promise<Response> | null = null;
  handlers.onFetch({
    request: new Request(`${origin}/unknown/pkg.tpk.json`),
    respondWith: (p) => {
      uncachedDescPromise = Promise.resolve(p);
    },
    waitUntil: () => undefined,
  });
  ok(uncachedDescPromise);
  await rejects(async () => uncachedDescPromise);
});

test("createShellWorkerHandlers onMessage replies with version on client port", async () => {
  const version = "msg-v1";
  const handlers = createShellWorkerHandlers({
    version,
    origin: "http://127.0.0.1:4173",
    caches: new MemoryCacheStorage(),
    fetch: async () => new Response(),
    shellUrls: new Set(),
  });

  let repliedVersion: unknown = null;
  const mockPort = {
    postMessage: (msg: unknown) => {
      if (msg && typeof msg === "object" && "version" in msg) {
        repliedVersion = (msg as { version: unknown }).version;
      }
    },
  };

  const messageEvent: ExtendableMessageEventLike = {
    data: { type: "version" },
    ports: [mockPort],
  };

  handlers.onMessage(messageEvent);
  equal(repliedVersion, version);
});

test("askWorkerVersion queries worker and resolves with version", async () => {
  const mockWorker = {
    postMessage: (message: unknown, transfer?: Transferable[]) => {
      if (message && typeof message === "object" && "type" in message && message.type === "version") {
        const port = transfer && transfer[0] as unknown as MessagePort;
        if (port) {
          port.postMessage({ version: "retrieved-v1" });
        }
      }
    },
  };

  const version = await askWorkerVersion(mockWorker);
  equal(version, "retrieved-v1");
});

test("service worker source never invokes skipWaiting() or clients.claim()", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const swSource = readFileSync(join(here, "../src/service-worker.ts"), "utf8");
  const coreSource = readFileSync(join(here, "../src/service-worker-core.ts"), "utf8");

  const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const swClean = stripComments(swSource);
  const coreClean = stripComments(coreSource);

  equal(/\bskipWaiting\s*\(/i.test(swClean), false, "service-worker.ts must never call skipWaiting()");
  equal(/\bclients\.claim\s*\(/i.test(swClean), false, "service-worker.ts must never call clients.claim()");
  equal(/\bskipWaiting\s*\(/i.test(coreClean), false, "service-worker-core.ts must never call skipWaiting()");
  equal(/\bclients\.claim\s*\(/i.test(coreClean), false, "service-worker-core.ts must never call clients.claim()");
});
