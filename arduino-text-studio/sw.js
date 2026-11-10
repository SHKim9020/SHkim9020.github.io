importScripts("./offline-assets.js?v=2");
const { cacheName, page, urls } = self.OneMakerOffline;
const offlineAssets = new Set(urls);
const prefix = "onemaker-arduino-text-offline-";
const root = new URL("./", self.location.href).pathname;

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const oldCaches = (await caches.keys()).filter(name => name.startsWith(prefix) && name !== cacheName);
    await Promise.all(oldCaches.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (event.request.mode === "navigate" && url.origin === self.location.origin &&
      (url.pathname === root || url.pathname === root + "index.html")) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      if (url.searchParams.get("offline") === "1") {
        const saved = await cache.match(page);
        if (saved) return saved;
      }
      try {
        return await fetch(event.request);
      } catch (error) {
        const saved = await cache.match(page);
        if (saved) return saved;
        throw error;
      }
    })());
  } else if (offlineAssets.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match(event.request)) || fetch(event.request);
    })());
  }
});
