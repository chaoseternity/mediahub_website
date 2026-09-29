// MediaHub & Media Club NFC Station PWA Service Worker
//
// Privacy: only the NFC station page and static assets are cached. Other dashboard pages
// (user lists, events, profiles), /rsvp/<token> pages and all API responses are never stored,
// so a shared device does not expose a previous user's pages offline. The page cache is also
// cleared on sign-out (CLEAR_USER_CACHE message from lib/sw-client.ts).

const CACHE_VERSION = "v2";
const PAGE_CACHE = `mediahub-station-pages-${CACHE_VERSION}`;
const STATIC_CACHE = `mediahub-station-static-${CACHE_VERSION}`;
const CURRENT_CACHES = [PAGE_CACHE, STATIC_CACHE];

// The only navigation that is cached for offline use.
const OFFLINE_PAGES = ["/dashboard/nfc"];

// Static app-shell assets precached on install (no navigations: those redirect when logged out).
const PRECACHE_ASSETS = [
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/icon.svg",
  "/icons/media-club-logo.svg",
  "/manifest.webmanifest",
];

const MAX_STATIC_ENTRIES = 300;

/** Only plain, non-redirected 200 responses may be cached (redirects break navigations). */
function isCacheable(response) {
  return (
    !!response &&
    response.status === 200 &&
    response.type === "basic" &&
    !response.redirected
  );
}

function isOfflinePage(url) {
  return OFFLINE_PAGES.includes(url.pathname.replace(/\/+$/, "") || "/");
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/manifest.webmanifest"
  );
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

async function precache() {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(
    PRECACHE_ASSETS.map(async (path) => {
      try {
        const response = await fetch(path, { cache: "reload" });
        if (isCacheable(response)) await cache.put(path, response);
      } catch (err) {
        console.warn("[SW] Pre-cache skipped:", path, err);
      }
    })
  );
}

// Install: best-effort precache; activation never depends on it succeeding.
self.addEventListener("install", (event) => {
  event.waitUntil(
    precache()
      .catch((err) => console.warn("[SW] Pre-cache warning:", err))
      .finally(() => self.skipWaiting())
  );
});

// Activate: delete every cache that is not current (including the old mediahub-station-v1,
// which may hold other users' pages).
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Sign-out: drop cached pages so the next user of this device cannot see them offline.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "CLEAR_USER_CACHE") return;
  const work = caches.delete(PAGE_CACHE).catch(() => false);
  if (event.waitUntil) event.waitUntil(work);
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Only same-origin GETs; never touch API calls (the offline sync engine handles them)
  //    or RSVP token pages.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/rsvp")
  ) {
    return;
  }

  // 2. Navigations: only the NFC station page is cached (network-first, cache fallback).
  //    All other pages go straight to the network and are never stored.
  if (request.mode === "navigate") {
    if (!isOfflinePage(url)) return;

    // Keyed by path (no query string), so the page cache holds at most one entry per offline page.
    const { response, cacheWork } = fetchAndCache(request, PAGE_CACHE, url.pathname);
    event.waitUntil(cacheWork);
    event.respondWith(
      response.catch(async () => {
        const cached = await caches.match(url.pathname, { cacheName: PAGE_CACHE });
        if (cached) return cached;
        return new Response("You are offline and this page is not available offline.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      })
    );
    return;
  }

  // 3. Static assets -> cache-first (hashed /_next/static files are immutable; others are
  //    revalidated in the background).
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { cacheName: STATIC_CACHE });
        if (cached && url.pathname.startsWith("/_next/static/")) return cached;

        const { response, cacheWork } = fetchAndCache(request, STATIC_CACHE, request, () =>
          trimCache(STATIC_CACHE, MAX_STATIC_ENTRIES)
        );
        // Still inside respondWith's pending promise, so extending the lifetime is allowed.
        event.waitUntil(cacheWork);
        if (cached) {
          response.catch(() => {});
          return cached;
        }
        return response;
      })()
    );
  }
});

/**
 * Fetches `request` and stores a copy under `key` when cacheable. Returns the network
 * response promise and a never-rejecting promise for the cache write.
 */
function fetchAndCache(request, cacheName, key, afterPut) {
  let cacheWork = Promise.resolve();
  const response = fetch(request).then((res) => {
    if (isCacheable(res)) {
      const copy = res.clone();
      cacheWork = caches
        .open(cacheName)
        .then((cache) => cache.put(key, copy))
        .then(() => (afterPut ? afterPut() : undefined));
    }
    return res;
  });
  return {
    response,
    cacheWork: response.then(() => cacheWork).catch(() => {}),
  };
}
