// The build injects a content-derived version and the exact editor shell URLs.
// Project files never pass through this allowlist. The player owns different caches.
const cacheName = `tkr-editor-shell-${__EDITOR_VERSION__}`;
const urls = __EDITOR_SHELL__.map((path) => new URL(path, self.location.href).href);
const shell = new Set(urls);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(urls)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(
    names.filter((name) => name.startsWith("tkr-editor-shell-") && name !== cacheName)
      .map((name) => caches.delete(name)),
  )));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !shell.has(event.request.url)) return;
  event.respondWith(caches.open(cacheName).then(async (cache) => {
    const saved = await cache.match(event.request);
    return saved ?? fetch(event.request);
  }));
});
