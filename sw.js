// ═══════════════════════════════════════════════════
// VOCAB-KING v4 — Offline Service Worker
// Network-first for app shell, cache fallback for offline
// ═══════════════════════════════════════════════════

const CACHE_NAME = 'vocab-king-v6-auth-20261029';
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './vocab-data.js',
  './app.js',
  './vk_logo.jpg',
  './manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).catch(()=>{})
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

  // Never cache external API or Supabase requests
  if (url.hostname.includes('supabase.co') || url.pathname.includes('/rest/v1/')) {
    return;
  }

  // Network-first strategy for app shell assets so updates appear immediately
  event.respondWith(
    fetch(req).then(networkRes => {
      if (networkRes && networkRes.status === 200) {
        const clone = networkRes.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, clone)).catch(()=>{});
      }
      return networkRes;
    }).catch(() => {
      return caches.match(req).then(cached => cached || caches.match('./index.html'));
    })
  );
});
