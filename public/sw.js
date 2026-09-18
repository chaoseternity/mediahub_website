// MediaHub & Media Club NFC Station PWA Service Worker
const CACHE_NAME = "mediahub-station-v1";

const APP_SHELL_ASSETS = [
  "/",
  "/dashboard/nfc",
  "/login",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/icon.svg",
  "/icons/media-club-logo.svg",
  "/manifest.webmanifest",
];

// Install: pre-cache critical app shell routes & icons
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(APP_SHELL_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn("[SW] Pre-cache warning:", err);
      })
  );
});

// Activate: purge stale caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: Network-first for navigation, Cache-first for static assets, Network-only for APIs
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. Skip non-GET and API calls (offline sync engine handles APIs)
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) {
    return;
  }

  // 2. Navigation requests (HTML pages) -> Network-first with Cache fallback
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          // Fallback to cached NFC station route
          const nfcFallback = await caches.match("/dashboard/nfc");
          if (nfcFallback) return nfcFallback;
          return caches.match("/");
        })
    );
    return;
  }

  // 3. Static assets (_next/static, icons, images) -> Cache-first with Network update
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png")
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          // Background revalidation
          fetch(event.request)
            .then((networkRes) => {
              if (networkRes.status === 200) {
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkRes));
              }
            })
            .catch(() => {});
          return cached;
        }

        return fetch(event.request).then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
});
