// Wisdom Power — minimal app-shell service worker
//
// Purpose: register a controlling Service Worker so Chrome/Edge (desktop
// and Android) recognize this site as installable and offer the native
// "Install app" / "Add to Home screen" prompt, per the PWA installability
// criteria (valid manifest + HTTPS + a Service Worker with a fetch handler).
// This is intentionally minimal — network-first with a cache fallback —
// and does not attempt full offline support for authenticated/data routes.
//
// Cache versioning: bump CACHE_NAME on any change to this file so old
// caches are cleaned up on activate.
const CACHE_NAME = 'wisdom-power-shell-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        // Best-effort precache only; installation must not fail if a
        // shell asset is temporarily unreachable.
      }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle same-origin, top-level navigations and static GETs.
  // Never intercept API/auth calls — this repo's Cache-Control headers are
  // already "no-store, no-cache, must-revalidate" for every route, so this
  // cache is purely a client-side fallback for brief connectivity loss.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(event.request, copy))
          .catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
