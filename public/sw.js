// ============================================================
//  Service Worker — Ghost Shopper
//  Place at: /public/sw.js
//
//  Policy:
//   - Precaches only shell assets (HTML, base CSS, key JS)
//   - Network-first for HTML navigations (offline fallback)
//   - Stale-while-revalidate for our own static assets
//     (css/js/img/config/modals/fonts):
//       * serve from cache immediately (fast)
//       * fetch fresh copy in background, update cache
//       * next load gets the new version automatically
//   - Pass-through for everything else (Firebase, Google,
//     cdnjs, Yoco, any external URL)
// ============================================================

// Increment the version so the browser knows to update the cache
const CACHE_VERSION = 'ghost-shopper-v5.6.8'; 
const OFFLINE_URL = 'offline.html';

const PRECACHE_URLS = [
  './',
  './index.html',
  './offline.html',
  './404.html',
  './css/base.css',
  './css/index.css',
  './js/firebase-config.js',
  './js/global.js',
  './js/cart-utils.js',
  './config/env.js',
  './manifest.json',
  './img/ghost-shopper-logo.png',
  './img/favicon.png'
];

// ===== INSTALL =====
self.addEventListener('install', event => {
  console.log('[SW] Installing', CACHE_VERSION);

  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);

    // Cache each file individually so one failure doesn't kill the install
    await Promise.all(PRECACHE_URLS.map(url =>
      cache.add(url).catch(err => {
        console.warn('[SW] Precache failed (non-fatal):', url, err.message || err);
      })
    ));

    console.log('[SW] Installed');
    await self.skipWaiting();
  })());
});

// ===== ACTIVATE =====
self.addEventListener('activate', event => {
  console.log('[SW] Activating', CACHE_VERSION);

  event.waitUntil((async () => {
    // Clean old caches
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if (k !== CACHE_VERSION) {
        console.log('[SW] Deleting old cache:', k);
        return caches.delete(k);
      }
    }));

    console.log('[SW] Activated');
    await self.clients.claim();
  })());
});

// ===== FETCH =====
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  // Only handle http/https
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Don't touch requests to external origins — let the browser handle them.
  // The SW should not intercept Firebase, Google, cdnjs, Yoco, etc.
  if (url.origin !== self.location.origin) return;

  // ---- HTML navigations: network-first, fall back to cache, then offline ----
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        const cached = await caches.match(req);
        if (cached) return cached;
        const offline = await caches.match(OFFLINE_URL);
        if (offline) return offline;
        return new Response('You are offline.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    })());
    return;
  }

  // ---- Our own static assets (css/js/img/config/modals/fonts):
  //      STALE-WHILE-REVALIDATE ----
  //  Serve the cached copy immediately, but fetch a fresh copy in the
  //  background and update the cache. This means:
  //    load N:   user gets cached version (fast), fresh copy downloads in bg
  //    load N+1: user gets the FRESH version (from the updated cache)
  //  No more manual cache clearing needed for JS/CSS updates.
  const isOwnStatic = /^\/(public\/)?(css|js|img|config|modals|fonts)\//.test(url.pathname) ||
                      /\/(css|js|img|config|modals|fonts)\//.test(url.pathname);

  if (isOwnStatic) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);

      // Kick off background fetch (do not await — that's the whole point)
      const networkPromise = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      }).catch(() => null);

      // If we have a cached copy, return it now (stale-while-revalidate)
      if (cached) return cached;

      // Otherwise wait for the network
      const fresh = await networkPromise;
      if (fresh) return fresh;

      return new Response('Offline', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain' }
      });
    })());
    return;
  }

  // ---- Everything else (same-origin but not matched above): pass through ----
  // Let the browser hit the network directly. Don't cache, don't intercept.
  // (No respondWith call → browser default behaviour)
});

// ===== MESSAGE HANDLER (kill switch + manual purge) =====
self.addEventListener('message', event => {
  const data = event.data || {};

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (data.type === 'CLEAR_CACHES') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      console.log('[SW] Caches cleared by page request');
    })());
  }

  if (data.type === 'UNREGISTER') {
    self.registration.unregister().then(() => {
      console.log('[SW] Unregistered by page request');
    });
  }
});