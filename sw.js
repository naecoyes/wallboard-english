// sw.js — 离线缓存 app shell
const CACHE = 'wallboard-en-v11'; // 改版后升级版本号，旧缓存会在 activate 时清掉
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './js/app.js',
  './js/store.js',
  './js/streak.js',
  './js/srs.js',
  './js/tts.js',
  './js/ui.js',
  './js/icons.js',
  './js/theme.js',
  './js/wakelock.js',
  './js/content.js',
  './js/words.js',
  './js/modes/word.js',
  './js/modes/standby.js',
  './js/modes/micro.js',
  './js/modes/focus.js',
  './js/modes/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit ||
      fetch(e.request).then(res => {
        // 只缓存本站的成功响应（避免把 404 的 config.local.js 之类缓存住）
        if (!res.ok || new URL(e.request.url).origin !== self.location.origin) return res;
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match('./index.html'))));
});
