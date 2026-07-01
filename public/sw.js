// Service worker: cache "app shell" dla szybkiego startu + dzialania offline.
// API nigdy nie jest cache'owane (zawsze swieze dane / poprawne 401).
const CACHE = 'budzet-v9';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css?v=9',
  '/app.js?v=9',
  '/vendor/chart.min.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return; // API -> siec

  const putCache = (res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); return res; };

  // Kod (HTML/JS/CSS) -> network-first: swiezy online, cache tylko offline.
  const isCode = e.request.mode === 'navigate' || url.pathname === '/' || /\.(?:js|css|html)$/.test(url.pathname);
  if (isCode) {
    e.respondWith(
      fetch(e.request).then(putCache).catch(() => caches.match(e.request).then((c) => c || caches.match('/index.html')))
    );
    return;
  }
  // Reszta (vendor, ikony) -> cache-first.
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then(putCache).catch(() => cached))
  );
});
