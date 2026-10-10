/* Offline: the app shell is cached on install; data files and images are
 * cached as they are used, and refreshed from the network when online. */
const CACHE = 'symbols-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'css/vendor/leaflet.css', 'js/store.js', 'js/data.js', 'js/app.js',
  'js/views-explore.js', 'js/views-learn.js', 'js/views-mine.js', 'manifest.webmanifest', 'icons/icon.svg', 'data/app/index.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === location.origin;
  const isTile = /tile\.openstreetmap\.org/.test(url.host);
  if (!same && !/wikimedia\.org$/.test(url.host) && !/fonts\.(googleapis|gstatic)\.com$/.test(url.host)) return;
  if (isTile) return;
  // our own files: network first (so updates arrive), cache as fallback; images and fonts: cache first
  if (same) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
  } else {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })));
  }
});
