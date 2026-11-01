/**
 * Pure policy, routing, manifest validation, and cache management for the offline service worker (issue #934).
 *
 * SCOPE DECISION:
 * - Worker script: `/apps/service-worker.js`
 * - Player page:   `/packages/runner-web/app/index.html`
 * - Player scope:  `/packages/runner-web/app/index.html`
 *
 * Why `/packages/runner-web/app/index.html`:
 * In the Service Worker specification, scope matching uses URL path prefix matching. Setting the scope to the exact
 * player page file path `/packages/runner-web/app/index.html` controls the player document and all navigations with query
 * parameters (e.g. `?package=fixtures/packages/demo.tpk`), while strictly excluding sibling test pages in the same directory
 * (`storage.html`, `audio.html`, `agreement.html`, `decode.html`, `vectors.html`). This is the minimal scope that controls
 * the player and no more.
 *
 * Because the script is served from `/apps/` and the scope is under `/packages/runner-web/app/`, the server must send the
 * `Service-Worker-Allowed` response header. Setting `Service-Worker-Allowed: /packages/runner-web/app/` on the worker script
 * permits registrations at or below that prefix.
 */

export const PLAYER_PAGE_URL = "/packages/runner-web/app/index.html";
export const WORKER_SCRIPT_URL = "/apps/service-worker.js";
export const PLAYER_SCOPE = "/packages/runner-web/app/index.html";
export const ALLOWED_SCOPE_HEADER = "/packages/runner-web/app/";
export const PRECACHE_MANIFEST_URL = "/apps/precache.json";
export const SHELL_CACHE_PREFIX = "tkr-shell-";
export const DESCRIPTORS_CACHE_NAME = "tkr-descriptors";

/** The precache manifest format emitted into `apps/precache.json`. */
export interface PrecacheManifest {
  /** Content-derived version string (16-char hex hash). */
  readonly version: string;
  /** App shell URLs (HTML, bundles, manifests). */
  readonly shell: readonly string[];
  /** Bundled asset URLs (/media/fonts/..., /media/cursors/..., /media/soundfonts/...). */
  readonly bundled: readonly string[];
}

export type RequestClassification = "pass-through" | "cache-first-shell" | "network-first-descriptor";

/** Derive the versioned shell cache name for a given worker/precache version. */
export function shellCacheName(version: string): string {
  return `${SHELL_CACHE_PREFIX}${version}`;
}

/** Check if a cache name belongs to the shell cache family. */
export function isShellCacheName(name: string): boolean {
  return name.startsWith(SHELL_CACHE_PREFIX);
}

/** Given a list of existing cache names, return all shell cache names that do not match the current version. */
export function staleShellCaches(cacheNames: readonly string[], currentVersion: string): string[] {
  const current = shellCacheName(currentVersion);
  return cacheNames.filter((name) => isShellCacheName(name) && name !== current);
}

/** Check whether a path or URL points to a forbidden resource that must never be cached by the service worker. */
export function isForbiddenPath(pathname: string): boolean {
  const clean = pathname.toLowerCase();
  // Never intercept /api/
  if (clean === "/api" || clean.startsWith("/api/")) return true;
  // Never intercept package binary bytes (.tpk without .json)
  if (clean.endsWith(".tpk")) return true;
  // Never intercept saves or blobs (saves live in IndexedDB)
  if (clean.includes("/save") || clean.includes("/blob") || clean.endsWith(".sav") || clean.endsWith(".blob")) return true;
  return false;
}

/** Check whether a path or URL represents a package install descriptor (<package>.tpk.json). */
export function isDescriptorPath(pathname: string): boolean {
  const clean = pathname.toLowerCase();
  return clean.endsWith(".tpk.json") && !clean.startsWith("/api/") && !clean.includes("/save");
}

/** Parse and validate an untrusted precache manifest object. */
export function parsePrecacheManifest(raw: unknown): PrecacheManifest {
  if (raw === null || typeof raw !== "object") {
    throw new Error("Invalid precache manifest: expected an object");
  }
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate["version"] !== "string" || candidate["version"].trim() === "") {
    throw new Error("Invalid precache manifest: missing or non-string version");
  }
  const version = candidate["version"].trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(version)) {
    throw new Error(`Invalid precache manifest: version '${version}' contains invalid characters`);
  }

  const validateUrlList = (field: "shell" | "bundled"): string[] => {
    const list = candidate[field];
    if (!Array.isArray(list)) {
      throw new Error(`Invalid precache manifest: field '${field}' must be an array`);
    }
    const result: string[] = [];
    for (const item of list) {
      if (typeof item !== "string" || !item.startsWith("/")) {
        throw new Error(`Invalid precache manifest: item in '${field}' must be an absolute path starting with '/': ${String(item)}`);
      }
      if (isForbiddenPath(item)) {
        throw new Error(`Invalid precache manifest: '${item}' matches forbidden cache patterns`);
      }
      result.push(item);
    }
    return result;
  };

  const shell = validateUrlList("shell");
  const bundled = validateUrlList("bundled");

  return { version, shell, bundled };
}

export interface MinimalRequestLike {
  readonly method: string;
  readonly url: string;
  readonly headers?:
    | {
        has?(name: string): boolean;
        get?(name: string): string | null;
      }
    | Record<string, string | string[] | undefined>;
}

function hasRangeHeader(headers?: MinimalRequestLike["headers"]): boolean {
  if (!headers) return false;
  if ("has" in headers && typeof headers.has === "function") {
    return headers.has("range") || headers.has("Range");
  }
  const record = headers as Record<string, unknown>;
  return record["range"] !== undefined || record["Range"] !== undefined;
}

/**
 * Classify a fetch request according to the service worker contract:
 * - Same-origin GET only;
 * - Forbidden paths (/api/, .tpk binary, save/blob URLs), range requests, and non-GET requests pass through untouched;
 * - Package descriptors (.tpk.json) use network-first with cache fallback;
 * - Shell and bundled asset URLs use cache-first;
 * - Everything else passes through untouched.
 */
export function classifyRequest(
  request: MinimalRequestLike,
  origin: string,
  shellUrls: ReadonlySet<string>,
): RequestClassification {
  if (request.method !== "GET") return "pass-through";

  let parsed: URL;
  try {
    parsed = new URL(request.url, origin);
  } catch {
    return "pass-through";
  }

  // Same-origin only
  if (parsed.origin !== origin) return "pass-through";

  // Never intercept range requests (e.g. streaming audio / video / partial ranges)
  if (hasRangeHeader(request.headers)) return "pass-through";

  const pathname = parsed.pathname;

  // Never intercept forbidden paths
  if (isForbiddenPath(pathname)) return "pass-through";

  // Descriptors: network-first with cache fallback
  if (isDescriptorPath(pathname)) return "network-first-descriptor";

  // Shell & bundled URLs: cache-first
  if (shellUrls.has(pathname)) return "cache-first-shell";

  return "pass-through";
}

/** Minimal cache interface matching the subset of the Cache API used by the worker handlers. */
export interface CacheLike {
  put(request: RequestInfo | URL, response: Response): Promise<void>;
  match(request: RequestInfo | URL, options?: { ignoreSearch?: boolean }): Promise<Response | undefined>;
  delete(request: RequestInfo | URL): Promise<boolean>;
}

/** Minimal CacheStorage interface matching the subset used by the worker handlers. */
export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
  match(request: RequestInfo | URL, options?: { ignoreSearch?: boolean }): Promise<Response | undefined>;
}

export interface ShellWorkerEnvironment {
  readonly version: string;
  readonly origin: string;
  readonly caches: CacheStorageLike;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly precacheManifestUrl?: string;
  readonly shellUrls: Set<string>;
}

export interface ExtendableMessageEventLike {
  readonly data: unknown;
  readonly ports?: readonly { postMessage(message: unknown): void }[];
  readonly source?: { postMessage?(message: unknown): void } | null;
}

export interface FetchEventLike {
  readonly request: Request;
  respondWith(response: Promise<Response> | Response): void;
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Creates the pure event handlers for the service worker.
 * Can be run in the real ServiceWorkerGlobalScope or in Node tests with injected environment.
 */
export function createShellWorkerHandlers(env: ShellWorkerEnvironment): {
  readonly onInstall: () => Promise<void>;
  readonly onActivate: () => Promise<void>;
  readonly onFetch: (event: FetchEventLike) => void;
  readonly onMessage: (event: ExtendableMessageEventLike) => void;
} {
  const onInstall = async (): Promise<void> => {
    const manifestUrl = env.precacheManifestUrl ?? PRECACHE_MANIFEST_URL;
    const manifestResponse = await env.fetch(manifestUrl, { cache: "reload" });
    if (!manifestResponse.ok) {
      throw new Error(`Failed to fetch precache manifest '${manifestUrl}': HTTP ${manifestResponse.status}`);
    }
    const manifestRaw = (await manifestResponse.json()) as unknown;
    const manifest = parsePrecacheManifest(manifestRaw);

    // Update the in-memory shell URL set so fetch routing knows all precached paths
    for (const url of manifest.shell) env.shellUrls.add(url);
    for (const url of manifest.bundled) env.shellUrls.add(url);

    const cacheName = shellCacheName(env.version);
    const cache = await env.caches.open(cacheName);

    // Precache all unique shell and bundled URLs
    const urlsToCache = Array.from(new Set([...manifest.shell, ...manifest.bundled]));
    try {
      await Promise.all(
        urlsToCache.map(async (url) => {
          const res = await env.fetch(url, { cache: "reload" });
          if (!res.ok) {
            throw new Error(`Failed to precache asset '${url}': HTTP ${res.status}`);
          }
          await cache.put(url, res);
        }),
      );
    } catch (error) {
      // If any fetch fails, delete the partial cache to ensure atomic install
      await env.caches.delete(cacheName).catch(() => undefined);
      throw error;
    }
  };

  const onActivate = async (): Promise<void> => {
    const keys = await env.caches.keys();
    const stale = staleShellCaches(keys, env.version);
    await Promise.all(stale.map((name) => env.caches.delete(name)));
  };

  const handleShell = async (request: Request): Promise<Response> => {
    const cacheName = shellCacheName(env.version);
    const cache = await env.caches.open(cacheName);
    const url = new URL(request.url);

    // Try matching the request directly (ignoring query strings such as ?package=... on index.html)
    // or by its pathname.
    const cached =
      (await cache.match(request, { ignoreSearch: true })) || (await cache.match(url.pathname, { ignoreSearch: true }));
    if (cached) return cached;

    // Cache miss while offline surfaces as a normal network failure (fetch throws TypeError).
    // Never fabricate a response.
    return env.fetch(request);
  };

  const handleDescriptor = async (request: Request, waitUntil: (p: Promise<unknown>) => void): Promise<Response> => {
    const cache = await env.caches.open(DESCRIPTORS_CACHE_NAME);
    const url = new URL(request.url);

    try {
      // Network first: stays fresh when online
      const netRes = await env.fetch(request, { cache: "no-cache" });
      if (netRes.ok) {
        const cloned = netRes.clone();
        const writePromise = cache.put(url.pathname, cloned).catch(() => undefined);
        waitUntil(writePromise);
      }
      return netRes;
    } catch (netError) {
      // Network failed: fall back to cache
      const cached =
        (await cache.match(request, { ignoreSearch: true })) || (await cache.match(url.pathname, { ignoreSearch: true }));
      if (cached) return cached;

      // Cache miss while offline surfaces as the original network failure
      throw netError;
    }
  };

  const onFetch = (event: FetchEventLike): void => {
    const request = event.request;
    const classification = classifyRequest(request, env.origin, env.shellUrls);

    if (classification === "cache-first-shell") {
      event.respondWith(handleShell(request));
      return;
    }

    if (classification === "network-first-descriptor") {
      event.respondWith(handleDescriptor(request, (p) => event.waitUntil(p)));
      return;
    }

    // "pass-through": do not call respondWith, browser handles fetch naturally
  };

  const onMessage = (event: ExtendableMessageEventLike): void => {
    const data = event.data;
    if (data && typeof data === "object" && "type" in data && data.type === "version") {
      const port = event.ports && event.ports[0];
      if (port) {
        port.postMessage({ version: env.version });
      } else if (event.source && typeof event.source.postMessage === "function") {
        event.source.postMessage({ version: env.version });
      }
    }
  };

  return { onInstall, onActivate, onFetch, onMessage };
}
