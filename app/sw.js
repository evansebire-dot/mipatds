/* Mipa Data Sheets — service worker (offline-first) */
const SHELL_CACHE = 'mipa-shell-v6'; // …v5 install btn + version footer · v6 offline skips online-only sheets
const DATA_CACHE = 'mipa-data-v1';
const PDF_CACHE = 'mipa-pdfs-v1'; // must match app.js

const SHELL_ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'vendor/fuse.basic.min.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, DATA_CACHE, PDF_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never intercept cross-origin (PDF source fallback)

  // PDFs: cache-first, then network (and store on view) → fully offline once seen/downloaded.
  if (url.pathname.includes('/pdfs/')) {
    event.respondWith(cacheFirst(req, PDF_CACHE));
    return;
  }

  // Index data + version stamp: network-first so they stay fresh, cache fallback offline.
  if (url.pathname.endsWith('datasheets.json') || url.pathname.endsWith('version.json')) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // App shell + navigations: cache-first, fall back to cached index.html for navigations.
  event.respondWith(
    cacheFirst(req, SHELL_CACHE).catch(() =>
      req.mode === 'navigate' ? caches.match('index.html') : Promise.reject()
    )
  );
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw e;
  }
}
