// app.js — 入口：路由、待机自动返回、初始卡组、Wake Lock、SW 注册
import { get, update } from './store.js';
import { SEED_DECK } from './content.js';
import { newCard } from './srs.js';
import { initWakeLock } from './wakelock.js';
import { icon } from './icons.js';
import { initTheme } from './theme.js';
import { initFullscreen } from './fullscreen.js';
import { initStudyTimer, startStudyTimer } from './study-timer.js';
import { renderStandby } from './modes/standby.js';
import { renderMicro } from './modes/micro.js';
import { renderFocus } from './modes/focus.js';
import { renderSettings } from './modes/settings.js';
import { renderWord } from './modes/word.js';
import { renderSentences } from './modes/sentences.js';

// ---------- 首次运行：导入初始卡组 ----------
if (!get().seeded) {
  update(s => {
    for (const c of SEED_DECK) s.cards.push(newCard(c.front, c.back, c.example));
    s.seeded = true;
  });
}

// ---------- 顶栏图标 ----------
document.querySelectorAll('#topbar [data-icon]').forEach(a =>
  a.prepend(icon(a.dataset.icon, a.classList.contains('nav-icon') ? 20 : 18)));

// ---------- 路由 ----------
const screen = document.getElementById('screen');
const ROUTES = {
  standby: renderStandby,
  micro: renderMicro,
  focus: renderFocus,
  word: renderWord,
  sentences: renderSentences,
  settings: renderSettings,
};

let cleanup = null;

function route() {
  const name = (location.hash || '#standby').slice(1);
  const render = ROUTES[name] || renderStandby;
  if (cleanup) { try { cleanup(); } catch (_) {} cleanup = null; }
  startStudyTimer(ROUTES[name] ? name : 'standby');
  screen.innerHTML = '';
  document.querySelectorAll('#topbar [data-nav]').forEach(a =>
    a.classList.toggle('active', a.dataset.nav === (ROUTES[name] ? name : 'standby')));
  cleanup = render(screen) || null;
  // 切屏时重置待机计时
  resetIdle();
}

window.addEventListener('hashchange', route);

// ---------- 长时间无操作 → 自动进入单词模式（专注进行中不打扰） ----------
let idleTimer = null;
let idleReset = null;

function resetIdle() {
  clearTimeout(idleTimer);
  const hash = location.hash || '';
  if (hash === '#focus' || hash === '#word' || hash === '#sentences') return; // 专注有自己的计时；单词模式本身就是待机内容
  const idleMs = Math.max(1, get().settings.idleMin || 2) * 60 * 1000;
  idleTimer = setTimeout(() => { location.hash = '#word'; }, idleMs);
}
idleReset = resetIdle;
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, () => idleReset && idleReset(), { passive: true }));

// ---------- 启动 ----------
initTheme();
initFullscreen();
initStudyTimer();
initWakeLock();

// Service Worker（离线缓存；file:// 下自动跳过）
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed', e));
}

if (!location.hash) location.hash = '#standby';
route();
