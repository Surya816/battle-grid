const CACHE = 'battle-grid-v2';
const ASSETS = [
    '/battle-grid/',
    '/battle-grid/new.html',
    '/battle-grid/manifest.json',
    '/battle-grid/icon-192.png',
    '/battle-grid/icon-512.png'
];
self.addEventListener('install', e => e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
));
self.addEventListener('activate', e => e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
));
self.addEventListener('fetch', e => e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
));
