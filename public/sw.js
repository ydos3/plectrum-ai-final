// Plectrum service worker — enables PWA install + basic offline. Deliberately
// conservative so it can never serve stale app code or break API calls:
//  • /api/*        → always network (never cached).
//  • navigations   → network-first, fall back to the cached shell when offline.
//  • /assets/*     → cache-first (Vite content-hashes these, so they're immutable).
//  • everything else same-origin GET → network, cached opportunistically.
const CACHE = 'plectrum-v1';
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // let cross-origin (CDN, YouTube, API hosts) pass through
  if (url.pathname.startsWith('/api/')) return;         // never cache API

  // Navigations: network-first so new deploys show immediately; offline → shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(SHELL).then((r) => r || Response.error()))
    );
    return;
  }

  // Hashed static assets: cache-first (immutable).
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Other same-origin GETs (icons, images, manifest): network, cache on success.
  event.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req))
  );
});
