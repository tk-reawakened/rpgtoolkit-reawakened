/**
 * Offline Service Worker for TK Reawakened web player (issue #934).
 *
 * Built as a single self-contained IIFE bundle (`apps/service-worker.js`).
 *
 * LIFECYCLE CONTRACT:
 * - On install: precaches the versioned app shell (`tkr-shell-<version>`) from `/apps/precache.json`.
 * - No `skipWaiting()` and no `clients.claim()`: a newly installed worker waits. A first-ever install
 *   does not control the page that registered it (next launch only); an update waits until every existing
 *   session is closed.
 * - On activate: deletes only older `tkr-shell-*` caches (safe because activation only occurs when no
 *   clients remain bound to the old worker).
 * - On fetch:
 *   * same-origin GET only;
 *   * shell/bundled/precache URLs: cache-first;
 *   * package descriptors (`<package>.tpk.json`): network-first with cache fallback;
 *   * everything else (including `/api/`, `.tpk` binary package bytes, range requests, non-GET,
 *     and save/blob URLs) passes through untouched.
 *   * cache miss while offline surfaces as a normal network failure (never fabricates a response).
 * - On message:
 *   * responds to `{ type: 'version' }` with `{ version }` on the client port.
 */

import {
  createShellWorkerHandlers,
  PRECACHE_MANIFEST_URL,
  type CacheStorageLike,
  type ExtendableMessageEventLike,
  type FetchEventLike,
  type PrecacheManifest,
} from "./service-worker-core.ts";

declare const __SERVICE_WORKER_VERSION__: string | undefined;
declare const __PRECACHE_MANIFEST__: string | undefined;

// Content-derived version injected by build.mjs via esbuild define
const VERSION: string =
  typeof __SERVICE_WORKER_VERSION__ === "string" && __SERVICE_WORKER_VERSION__.length > 0
    ? __SERVICE_WORKER_VERSION__
    : "dev";

// Pre-baked manifest URLs injected by build.mjs so shell classification is synchronous on cold start
const EMBEDDED_MANIFEST: PrecacheManifest | null = (() => {
  if (typeof __PRECACHE_MANIFEST__ === "string" && __PRECACHE_MANIFEST__.length > 0) {
    try {
      return JSON.parse(__PRECACHE_MANIFEST__) as PrecacheManifest;
    } catch {
      return null;
    }
  }
  return null;
})();

const initialShellUrls = new Set<string>();
if (EMBEDDED_MANIFEST) {
  for (const url of EMBEDDED_MANIFEST.shell) initialShellUrls.add(url);
  for (const url of EMBEDDED_MANIFEST.bundled) initialShellUrls.add(url);
}

// In the service worker execution context, globalThis is ServiceWorkerGlobalScope
interface WorkerGlobalScopeLike {
  readonly caches: unknown;
  readonly location: { readonly origin: string };
  addEventListener(type: "install" | "activate", listener: (event: { waitUntil(promise: Promise<unknown>): void }) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEventLike) => void): void;
  addEventListener(type: "message", listener: (event: ExtendableMessageEventLike) => void): void;
}

const sw = globalThis as unknown as WorkerGlobalScopeLike;

const handlers = createShellWorkerHandlers({
  version: VERSION,
  origin: sw.location.origin,
  caches: sw.caches as unknown as CacheStorageLike,
  fetch: (input, init) => fetch(input, init),
  precacheManifestUrl: PRECACHE_MANIFEST_URL,
  shellUrls: initialShellUrls,
});

sw.addEventListener("install", (event) => {
  // Wait for precaching to complete, but NEVER call skipWaiting()
  event.waitUntil(handlers.onInstall());
});

sw.addEventListener("activate", (event) => {
  // Clean up older shell caches, but NEVER call clients.claim()
  event.waitUntil(handlers.onActivate());
});

sw.addEventListener("fetch", (event) => {
  handlers.onFetch(event);
});

sw.addEventListener("message", (event) => {
  handlers.onMessage(event);
});
