const CACHE_NAME = "onemaker-boat-studio-1.4.25";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=1.4.25",
  "./app.js?v=1.4.25",
  "./ble-transport.js?v=1.4.7",
  "./remote-safety.js?v=1.4.14",
  "./remote-handler.js?v=1.4.10",
  "./manifest.webmanifest?v=1.4.25",
  "./icons/boat-studio-192.png",
  "./icons/boat-studio-512.png",
  "./icons/boat-studio-maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
