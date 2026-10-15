// sw.js — 离线缓存 app shell
const CACHE = 'wallboard-en-v39'; // 改版后升级版本号，旧缓存会在 activate 时清掉
// 词库 / 句库（约 1.7 MB）单独缓存：改界面升级版本号时不必重新下载，后台静默更新
const DATA_CACHE = 'wallboard-data-v4';
const DATA_FILES = ['./js/words.js', './js/sentences.js', './js/passages.js'];
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './js/app.js',
  './js/store.js',
  './js/streak.js',
  './js/study-timer.js',
  './js/auto-advance.js',
  './js/sync.js',
  './js/external-study.js',
  './js/srs.js',
  './js/tts.js',
  './js/ui.js',
  './js/icons.js',
  './js/fullscreen.js',
  './js/lookup.js',
  './js/reading-dictionary.js',
  './js/swipe.js',
  './js/deck.js',
  './js/theme.js',
  './js/wakelock.js',
  './js/content.js',
  './js/modes/word.js',
  './js/modes/sentences.js',
  './js/modes/reading.js',
  './js/modes/standby.js',
  './js/modes/micro.js',
  './js/modes/focus.js',
  './js/modes/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then(c => c.addAll(ASSETS)),
    caches.open(DATA_CACHE).then(c => Promise.all(DATA_FILES.map(f => c.match(f).then(hit => hit || c.add(f))))),
  ]).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== AUDIO_CACHE && k !== DATA_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// 预生成的发音文件（单词 + 句子）：放进单独的缓存，升级网站版本时不会被清掉（约 15 MB，不必重复下载）
const AUDIO_CACHE = 'wallboard-audio-v1';

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === self.location.origin && (url.pathname.includes('/audio/words/') || url.pathname.includes('/audio/s/'))) {
    // 索引文件：优先网络（重新生成后能及时更新），断网时用缓存
    if (url.pathname.endsWith('/index.json')) {
      e.respondWith(fetch(e.request).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(AUDIO_CACHE).then(c => c.put(url.pathname, copy)); }
        return res;
      }).catch(() => caches.match(url.pathname, { cacheName: AUDIO_CACHE })));
      return;
    }
    // mp3：缓存优先
    e.respondWith(caches.open(AUDIO_CACHE).then(c => c.match(e.request).then(hit => hit ||
      fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (url.origin === self.location.origin && DATA_FILES.some(f => url.pathname.endsWith(f.slice(1)))) {
    e.respondWith(caches.open(DATA_CACHE).then(c => c.match(e.request).then(hit => {
      const net = fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; });
      return hit || net;
    })));
    return;
  }
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
