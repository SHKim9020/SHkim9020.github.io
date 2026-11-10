importScripts("./offline-assets.js?v=3");
const { cacheName, cachePrefix, page, ready, urls } = self.OneMakerOffline;
const offlineAssets = new Set(urls);
const root = new URL("./", self.location.href).pathname;

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

async function matchSaved(request, { completeOnly = false } = {}) {
  const current = await caches.open(cacheName);
  if (!completeOnly || await current.match(ready)) {
    const match = await current.match(request);
    if (match) return match;
  }
  // Keep the last prepared offline page available until the new cache is complete.
  const previous = (await caches.keys()).filter(name => name.startsWith(cachePrefix) && name !== cacheName);
  for (const name of previous.reverse()) {
    const cache = await caches.open(name);
    if (!(await cache.match(ready))) continue;
    const match = await cache.match(request);
    if (match) return match;
  }
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const inApp = url.origin === self.location.origin && url.pathname.startsWith(root);
  if (event.request.mode === "navigate" && inApp &&
      (url.pathname === root || url.pathname === root + "index.html")) {
    event.respondWith((async () => {
      if (url.searchParams.get("offline") === "1") {
        const saved = await matchSaved(page, { completeOnly: true });
        if (saved) return saved;
      }
      try {
        return await fetch(event.request);
      } catch (error) {
        const saved = await matchSaved(page, { completeOnly: true });
        if (saved) return saved;
        throw error;
      }
    })());
  } else if (offlineAssets.has(url.href) || (inApp && /\.(?:js|css)$/.test(url.pathname))) {
    event.respondWith((async () => (await matchSaved(event.request)) || fetch(event.request))());
  }
});
