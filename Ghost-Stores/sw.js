// sw.js — Ghost Stores service worker
// Same policy as Ghost Driver SW:
// - network-first for HTML navigations
// - stale-while-revalidate for own static assets
// - pass-through for external origins

const CACHE_VERSION = 'ghost-stores-v1.0.4';
const OFFLINE_URL = 'offline.html';

const PRECACHE_URLS = [
  './',
  './index.html',
  './login.html',
  './register.html',
  './forgot-password.html',
  './offline.html',
  './css/store-auth.css',
  './js/firebase-config.js',
  './js/store-register.js',
  './js/store-login.js',
  './js/store-forgot.js',
  './config/env.js',
  './manifest.json',
  './img/icon-192.png',
  './img/icon-512.png',
  './img/favicon.png'
];
// NOTE: dashboard.html is intentionally NOT precached (Cache-Control: no-store).

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(PRECACHE_URLS.map(url =>
      cache.add(url).catch(err => console.warn('[SW] Precache failed:', url, err?.message || err))
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE_VERSION ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Never intercept dashboard — Cache-Control: no-store handles it
  if (url.pathname.endsWith('/dashboard.html')) return;

  // Pass-through external origins
  if (url.origin !== self.location.origin) return;

  // HTML navigations: network-first
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
        return new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // Own static assets: stale-while-revalidate
  const isOwnStatic = /\/(css|js|img|config)\//.test(url.pathname);
  if (isOwnStatic) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      const networkPromise = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      if (cached) return cached;
      const fresh = await networkPromise;
      if (fresh) return fresh;
      return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })());
    return;
  }
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'CLEAR_CACHES') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    })());
  }
  if (data.type === 'UNREGISTER') self.registration.unregister();
});