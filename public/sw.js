const CACHE = 'worksite-v24';
const SHELL = ['./', 'index.html', 'styles.css', 'pdoc.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/util.js', 'js/i18n.js', 'js/docs.js', 'icons/icon.svg', 'icons/icon-192.png', 'fonts/readex-arabic.woff2', 'fonts/readex-latin.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const net = fetch(e.request, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000));
  e.respondWith(Promise.race([net, timeout]).catch(() =>
    caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : null)).then(r => r || net)));
});

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Yawmiyyeh', {
    body: data.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', dir: 'auto', lang: 'ar', data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.location.origin));
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
