const CACHE_NAME = "kid-radio-pwa-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Only cache same-origin app shell assets; let YouTube requests go straight to network
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // Refresh cache in background when online
        fetch(req)
          .then((resp) => {
            if (resp && resp.ok) {
              caches.open(CACHE_NAME).then((c) => c.put(req, resp.clone()));
            }
          })
          .catch(() => {});
        return cached;
      }
      return fetch(req).then((resp) => {
        if (resp && resp.ok) {
          caches.open(CACHE_NAME).then((c) => c.put(req, resp.clone()));
        }
        return resp;
      });
    })
  );
});
