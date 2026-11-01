import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Acceptance spec for issue #934 offline service worker slice:
// (a) registration occurs and after reload the page is controlled (navigator.serviceWorker.controller non-null),
//     and precache holds the shell and bundled files;
// (b) with the network blocked, shell and bundled files are served from cache; a miss surfaces as network error;
// (c) a changed worker script (served via page.route) installs as waiting while the open page keeps its old controller;
//     after that page closes a fresh launch is controlled by the new version, with no skipWaiting/claim involved;
// (d) no cache contains any /api/ or .tpk binary bytes or save URL; descriptors use network-first with cache fallback;
// (e) shouldRegisterServiceWorker is false for app: protocol (Electron desktop) and non-http(s) runtimes.

const PROBE_PAGE = "/packages/runner-web/app/worker-probe.html";
const PROBE_SCOPE = "/packages/runner-web/app/worker-probe.html";
const PLAYER_PAGE = "/packages/runner-web/app/index.html";

async function clearWorkerState(page: Page): Promise<void> {
  await page.goto(PROBE_PAGE);
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        await reg.unregister();
      }
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    }
  });
}

async function waitForActivated(page: Page, scope: string): Promise<void> {
  await page.evaluate(async (targetScope) => {
    const reg = await navigator.serviceWorker.getRegistration(targetScope);
    if (!reg) throw new Error(`No registration found for ${targetScope}`);
    if (reg.active && reg.active.state === "activated") return;
    const worker = reg.installing || reg.waiting || reg.active;
    if (!worker) throw new Error("No worker on registration");
    await new Promise<void>((resolve, reject) => {
      if (worker.state === "activated") {
        resolve();
        return;
      }
      worker.addEventListener("statechange", () => {
        if (worker.state === "activated") resolve();
        if (worker.state === "redundant") reject(new Error("Worker became redundant"));
      });
    });
  }, scope);
}

test.beforeEach(async ({ page }) => {
  await clearWorkerState(page);
});

test("(e) shouldRegisterServiceWorker is false for app: location and non-http(s)", async ({ page }) => {
  await page.goto(PROBE_PAGE);
  await page.waitForFunction(() => window.__probe !== undefined);

  const evaluation = await page.evaluate(() => {
    const probe = window.__probe!;
    return {
      desktopApp: probe.shouldRegisterServiceWorker(
        { protocol: "app:", origin: "app://player", href: "app://player/index.html" },
        navigator,
      ),
      fileScheme: probe.shouldRegisterServiceWorker(
        { protocol: "file:", origin: "file://", href: "file:///game/index.html" },
        navigator,
      ),
      capacitorScheme: probe.shouldRegisterServiceWorker(
        { protocol: "capacitor:", origin: "capacitor://localhost", href: "capacitor://localhost" },
        navigator,
      ),
      missingServiceWorker: probe.shouldRegisterServiceWorker(
        { protocol: "http:", origin: location.origin, href: location.href },
        {} as unknown as Navigator,
      ),
      validWebHttp: probe.shouldRegisterServiceWorker(
        { protocol: "http:", origin: location.origin, href: location.href },
        navigator,
      ),
      validWebHttps: probe.shouldRegisterServiceWorker(
        { protocol: "https:", origin: "https://example.com", href: "https://example.com" },
        navigator,
      ),
    };
  });

  expect(evaluation.desktopApp).toBe(false);
  expect(evaluation.fileScheme).toBe(false);
  expect(evaluation.capacitorScheme).toBe(false);
  expect(evaluation.missingServiceWorker).toBe(false);
  expect(evaluation.validWebHttp).toBe(true);
  expect(evaluation.validWebHttps).toBe(true);

  // Calling registerPlayerWorker with app: protocol returns desktop-app-scheme and performs no registration
  const regResult = await page.evaluate(async () => {
    const probe = window.__probe!;
    return probe.registerPlayerWorker({
      location: { protocol: "app:", origin: "app://player", href: "app://player/index.html" },
      navigator,
    });
  });
  expect(regResult).toEqual({ registered: false, reason: "desktop-app-scheme" });
});

test("(a) registration happens, reload controls the page, and precache holds shell and bundled files", async ({ page }) => {
  await page.goto(PROBE_PAGE);
  await page.waitForFunction(() => window.__probe !== undefined);

  // Initial visit: no controller yet
  const initialController = await page.evaluate(() => navigator.serviceWorker.controller);
  expect(initialController).toBeNull();

  // Register the worker for the probe scope
  const registrationResult = await page.evaluate(async (scope) => {
    const probe = window.__probe!;
    return probe.registerPlayerWorker(window, { scope });
  }, PROBE_SCOPE);
  expect(registrationResult.registered).toBe(true);

  // Wait for worker to finish installing and reach activated state
  await waitForActivated(page, PROBE_SCOPE);

  // First-ever install does NOT control the page that registered it (no clients.claim, next launch only)
  const stillUncontrolled = await page.evaluate(() => navigator.serviceWorker.controller);
  expect(stillUncontrolled).toBeNull();

  // Reload the page: on this next launch, the page IS controlled by the worker
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  const isControlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  expect(isControlled).toBe(true);

  // Query worker version via message channel
  const workerVersion = await page.evaluate(async () => {
    const probe = window.__probe!;
    return probe.askWorkerVersion(navigator.serviceWorker.controller!);
  });
  expect(typeof workerVersion).toBe("string");
  expect(workerVersion.length).toBeGreaterThan(0);

  // Verify precache contents against apps/precache.json
  const precacheJsonPath = resolve("apps/precache.json");
  const precacheManifest = JSON.parse(readFileSync(precacheJsonPath, "utf8")) as {
    version: string;
    shell: string[];
    bundled: string[];
  };
  expect(workerVersion).toBe(precacheManifest.version);

  // Check the versioned cache contents
  const cacheReport = await page.evaluate(async (version) => {
    const cacheName = `tkr-shell-${version}`;
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    const urls = requests.map((req) => new URL(req.url).pathname);
    return {
      cacheName,
      urls,
      hasPlayerPage: await cache.match("/packages/runner-web/app/index.html") !== undefined,
      hasPlayerBundle: await cache.match("/apps/player.js") !== undefined,
      hasBundledJson: await cache.match("/apps/bundled.json") !== undefined,
      hasPrecacheJson: await cache.match("/apps/precache.json") !== undefined,
    };
  }, workerVersion);

  expect(cacheReport.hasPlayerPage).toBe(true);
  expect(cacheReport.hasPlayerBundle).toBe(true);
  expect(cacheReport.hasBundledJson).toBe(true);
  expect(cacheReport.hasPrecacheJson).toBe(true);

  // Verify every shell file and bundled file from the manifest is in the cache
  for (const shellUrl of precacheManifest.shell) {
    expect(cacheReport.urls).toContain(shellUrl);
  }
  for (const bundledUrl of precacheManifest.bundled) {
    expect(cacheReport.urls).toContain(bundledUrl);
  }
});

test("(b) with network blocked, shell and bundled files are served from cache; cache miss surfaces as network error", async ({
  page,
  context,
}) => {
  // Set up controlled page
  await page.goto(PROBE_PAGE);
  await page.waitForFunction(() => window.__probe !== undefined);
  await page.evaluate(async (scope) => {
    const probe = window.__probe!;
    await probe.registerPlayerWorker(window, { scope });
  }, PROBE_SCOPE);
  await waitForActivated(page, PROBE_SCOPE);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // Block the network completely
  await context.setOffline(true);

  try {
    // 1. Fetch shell files while offline: served from cache successfully
    const shellResults = await page.evaluate(async () => {
      const files = [
        "/packages/runner-web/app/index.html",
        "/apps/player.js",
        "/apps/bundled.json",
        "/apps/precache.json",
      ];
      const results: { url: string; status: number; textLength: number }[] = [];
      for (const url of files) {
        const res = await fetch(url);
        const text = await res.text();
        results.push({ url, status: res.status, textLength: text.length });
      }
      return results;
    });

    for (const item of shellResults) {
      expect(item.status).toBe(200);
      expect(item.textLength).toBeGreaterThan(0);
    }

    // 2. Fetch bundled asset (soundfont bank and fonts) while offline: served from cache successfully
    const bundledResult = await page.evaluate(async () => {
      const res = await fetch("/media/soundfonts/TK-16.sf2");
      const buffer = await res.arrayBuffer();
      return { status: res.status, byteLength: buffer.byteLength };
    });
    expect(bundledResult.status).toBe(200);
    expect(bundledResult.byteLength).toBeGreaterThan(1000);

    // 3. Cache miss while offline surfaces as a normal network failure (TypeError), never a fabricated response
    const missResult = await page.evaluate(async () => {
      try {
        await fetch("/media/nonexistent-soundfont-miss.sf2");
        return { failed: false, error: "" };
      } catch (err) {
        return { failed: true, error: (err as Error).message };
      }
    });
    expect(missResult.failed).toBe(true);
  } finally {
    await context.setOffline(false);
  }
});

test("(c) changed worker script installs as waiting while open page keeps old version; fresh launch uses new version", async ({
  page,
  context,
}) => {
  await page.goto(PROBE_PAGE);
  await page.waitForFunction(() => window.__probe !== undefined);

  // Register v1 and reload to be controlled by v1
  await page.evaluate(async (scope) => {
    const probe = window.__probe!;
    await probe.registerPlayerWorker(window, { scope });
  }, PROBE_SCOPE);
  await waitForActivated(page, PROBE_SCOPE);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  const v1 = await page.evaluate(async () => {
    const probe = window.__probe!;
    return probe.askWorkerVersion(navigator.serviceWorker.controller!);
  });
  const updatedVersion = `v2-upgraded-${Date.now()}`;

  // Deploy a genuine v2 bundle to `apps/service-worker.js` while the session is open (exactly what a real deploy does;
  // Playwright routes do not reach Chromium's out-of-page `registration.update()` fetch) and restore v1 afterwards.
  const workerFile = resolve("apps/service-worker.js");
  const originalScript = readFileSync(workerFile, "utf8");
  const modifiedScript =
    originalScript.replace(new RegExp(JSON.stringify(v1), "g"), JSON.stringify(updatedVersion)) +
    `\n// deployed worker ${updatedVersion}\n`;
  writeFileSync(workerFile, modifiedScript, "utf8");
  try {
    await page.evaluate(async (scope) => {
      const reg = await navigator.serviceWorker.getRegistration(scope);
      if (reg === undefined) throw new Error("no registration");
      await reg.update();
      if (reg.waiting !== null) return;
      const installing = reg.installing ?? await new Promise<ServiceWorker>((done) => {
        reg.addEventListener("updatefound", () => { if (reg.installing !== null) done(reg.installing); }, { once: true });
      });
      await new Promise<void>((done, fail) => {
        if (installing.state === "installed") { done(); return; }
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed") done();
          else if (installing.state === "redundant") fail(new Error("updated worker became redundant"));
        });
      });
    }, PROBE_SCOPE);

    // Verify: open page STILL has v1 controller
    const openPageControllerVersion = await page.evaluate(async () => {
      const probe = window.__probe!;
      return probe.askWorkerVersion(navigator.serviceWorker.controller!);
    });
    expect(openPageControllerVersion).toBe(v1);

    // Verify: waiting worker is the new version
    const waitingWorkerVersion = await page.evaluate(async (scope) => {
      const probe = window.__probe!;
      const reg = await navigator.serviceWorker.getRegistration(scope);
      return probe.askWorkerVersion(reg!.waiting!);
    }, PROBE_SCOPE);
    expect(waitingWorkerVersion).toBe(updatedVersion);

    // Verify: while the open page is still controlled by v1, a precached bundled asset is still served from the v1 cache.
    //    Block the network so a cache-bypassing worker would fail; only a v1-cache response can succeed.
    const v1CacheName = `tkr-shell-${v1}`;
    const bundledUrl = "/media/fonts/LiberationMono-Regular.ttf";
    await context.setOffline(true);
    const [v1Cached, fetched] = await page.evaluate(async ({ cacheName, url }) => {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(url);
      const response = await fetch(url).catch(() => null);
      return [
        cached === undefined ? null : { ok: cached.ok, status: cached.status },
        response === null ? null : { ok: response.ok, status: response.status },
      ];
    }, { cacheName: v1CacheName, url: bundledUrl });
    await context.setOffline(false);
    expect(v1Cached).toEqual({ ok: true, status: 200 });
    expect(fetched).toEqual({ ok: true, status: 200 });

    // Close the open page so no clients remain bound to v1
    await page.close();

    // Open fresh page in the same context (next launch)
    const page2 = await context.newPage();
    await page2.goto(PROBE_PAGE);
    await page2.waitForFunction(() => navigator.serviceWorker.controller !== null);

    // New page is controlled by the upgraded version!
    const newPageControllerVersion = await page2.evaluate(async () => {
      const probe = window.__probe!;
      return probe.askWorkerVersion(navigator.serviceWorker.controller!);
    });
    expect(newPageControllerVersion).toBe(updatedVersion);

    // Activate purged older cache: tkr-shell-${v1} is gone, tkr-shell-${updatedVersion} remains
    const cacheKeys = await page2.evaluate(async () => caches.keys());
    expect(cacheKeys).not.toContain(`tkr-shell-${v1}`);
    expect(cacheKeys).toContain(`tkr-shell-${updatedVersion}`);

    await page2.close();
  } finally {
    writeFileSync(workerFile, originalScript, "utf8");
  }
});

test("(d) no cache contains /api/ or .tpk or save URL; descriptors use network-first with cache fallback", async ({
  page,
  context,
}) => {
  await page.goto(PROBE_PAGE);
  await page.waitForFunction(() => window.__probe !== undefined);
  await page.evaluate(async (scope) => {
    const probe = window.__probe!;
    await probe.registerPlayerWorker(window, { scope });
  }, PROBE_SCOPE);
  await waitForActivated(page, PROBE_SCOPE);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // Issue various fetches through the controlled page
  await page.evaluate(async () => {
    // 1. /api/ route (must pass through untouched)
    await fetch("/api/bundled?folders=media/fonts").catch(() => undefined);
    // 2. .tpk binary file (must pass through untouched)
    await fetch("/fixtures/packages/demo.tpk").catch(() => undefined);
    // 3. Save / blob URLs (must pass through untouched)
    await fetch("/packages/runner-web/app/saves/slot1.sav").catch(() => undefined);
    await fetch("/packages/runner-web/app/blobs/slot1").catch(() => undefined);
    // 4. Descriptor (<package>.tpk.json, network-first with cache fallback)
    await fetch("/fixtures/packages/demo.tpk.json").catch(() => undefined);
  });

  // Verify across ALL caches that no forbidden URLs exist
  const cacheAudit = await page.evaluate(async () => {
    const allCacheNames = await caches.keys();
    const forbiddenFound: { cache: string; url: string; reason: string }[] = [];
    for (const cacheName of allCacheNames) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      for (const req of requests) {
        const url = req.url.toLowerCase();
        if (url.includes("/api/")) {
          forbiddenFound.push({ cache: cacheName, url: req.url, reason: "api-url" });
        }
        if (url.endsWith(".tpk")) {
          forbiddenFound.push({ cache: cacheName, url: req.url, reason: "tpk-binary-bytes" });
        }
        if (url.includes("/save") || url.includes("/blob") || url.endsWith(".sav") || url.endsWith(".blob")) {
          forbiddenFound.push({ cache: cacheName, url: req.url, reason: "save-or-blob-url" });
        }
      }
    }
    return {
      allCacheNames,
      forbiddenFound,
    };
  });

  expect(cacheAudit.forbiddenFound).toEqual([]);

  // Verify descriptor cache holds the demo.tpk.json descriptor
  const descCacheReport = await page.evaluate(async () => {
    const descCache = await caches.open("tkr-descriptors");
    const keys = await descCache.keys();
    return keys.map((r) => r.url);
  });
  expect(descCacheReport.some((u) => u.endsWith("demo.tpk.json"))).toBe(true);

  // Verify descriptor is network-first with cache fallback:
  // When offline, the cached descriptor is returned; an uncached descriptor fails
  await context.setOffline(true);
  try {
    const offlineDescResult = await page.evaluate(async () => {
      const cachedRes = await fetch("/fixtures/packages/demo.tpk.json");
      const cachedData = (await cachedRes.json()) as { gameId?: string };

      let missFailed = false;
      try {
        await fetch("/fixtures/packages/uncached-miss.tpk.json");
      } catch {
        missFailed = true;
      }

      return {
        cachedStatus: cachedRes.status,
        hasGameId: typeof cachedData.gameId === "string",
        missFailed,
      };
    });

    expect(offlineDescResult.cachedStatus).toBe(200);
    expect(offlineDescResult.hasGameId).toBe(true);
    expect(offlineDescResult.missFailed).toBe(true);
  } finally {
    await context.setOffline(false);
  }
});
