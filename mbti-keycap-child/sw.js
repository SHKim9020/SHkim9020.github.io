/* Offline-first app cache. Scope-safe on GitHub Pages subfolders. */
const CACHE_NAME='onemaker-kids-mbti-keycap-v2';
const RELATIVE_ASSETS=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png','./icons/apple-touch-icon.png'];
const toUrl = rel => new URL(rel, self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(RELATIVE_ASSETS.map(toUrl))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('onemaker-kids-mbti-keycap-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request=event.request;
  if (request.method !== 'GET') return;
  const url=new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok){ const copy=response.clone(); event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(toUrl('./index.html'),copy))); }
      return response;
    }).catch(async()=> (await caches.match(toUrl('./index.html'))) || Response.error()));
  } else {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok){const copy=response.clone(); event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(request,copy)));}
      return response;
    })));
  }
});