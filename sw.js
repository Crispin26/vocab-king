// ═══════════════════════════════════════════════════
// VOCAB-KING v3 — Offline Service Worker
// Caches static application shell & vocabulary data.
// Never caches private student data or Supabase API requests.
// ═══════════════════════════════════════════════════

const CACHE_NAME = 'vocab-king-v3-static-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './vocab-data.js',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache Supabase REST API or external dynamic APIs
  if (url.hostname.includes('supabase.co') || url.pathname.includes('/rest/v1/')) {
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req).then(res => {
        if (res && res.status === 200 && (url.origin === self.location.origin || url.hostname.includes('fonts.g'))) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      }).catch(() => cached || caches.match('./index.html'));

      return cached || networkFetch;
    })
  );
});
