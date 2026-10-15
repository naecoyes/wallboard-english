// app.js — 入口：路由、待机自动返回、初始卡组、Wake Lock、SW 注册
import { get, update } from './store.js';
import { SEED_DECK } from './content.js';
import { newCard } from './srs.js';
import { initWakeLock } from './wakelock.js';
import { icon } from './icons.js';
import { initTheme, applyTheme } from './theme.js';
import { initFullscreen } from './fullscreen.js';
import { initSync } from './sync.js';
import { initExternalStudy, externalStudyActive } from './external-study.js';
import { pauseStudyTimer } from './study-timer.js';
import { initStudyTimer, startStudyTimer } from './study-timer.js';
import { renderStandby } from './modes/standby.js';
import { renderMicro } from './modes/micro.js';
import { renderFocus } from './modes/focus.js';
import { renderSettings } from './modes/settings.js';
import { renderWord } from './modes/word.js';
import { renderSentences } from './modes/sentences.js';
import { renderReading } from './modes/reading.js';

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
  reading: renderReading,
  settings: renderSettings,
};

let cleanup = null;

function route() {
  const name = (location.hash || '#standby').slice(1);
  const render = ROUTES[name] || renderStandby;
  if (cleanup) { try { cleanup(); } catch (_) {} cleanup = null; }
  startStudyTimer(ROUTES[name] ? name : 'standby');
  if (externalStudyActive()) pauseStudyTimer(true);
  screen.innerHTML = '';
  document.querySelectorAll('#topbar [data-nav]').forEach(a =>
    a.classList.toggle('active', a.dataset.nav === (ROUTES[name] ? name : 'standby')));
  cleanup = render(screen) || null;
  // 切屏时重置待机计时
  resetIdle();
}

window.addEventListener('hashchange', route);
window.addEventListener('wallboard:remote-updated', () => {
  applyTheme();
  const name = (location.hash || '#standby').slice(1);
  if (document.querySelector('dialog[open]')) return;
  if (!(name === 'standby' || name === 'word' || name === 'sentences' || name === 'reading' || !ROUTES[name])) return;
  // 同步刷新不播放入场动画：渲染时标记 quiet，渲染完把动画直接跳到结束
  document.documentElement.dataset.quiet = '1';
  route();
  screen.getAnimations?.({ subtree: true }).forEach(a => { try { a.finish(); } catch (_) {} });
  delete document.documentElement.dataset.quiet;
});

// ---------- 长时间无操作 → 自动进入单词模式（专注进行中不打扰） ----------
let idleTimer = null;
let idleReset = null;

function resetIdle() {
  clearTimeout(idleTimer);
  if (externalStudyActive()) return;
  const hash = location.hash || '';
  if (hash === '#focus' || hash === '#word' || hash === '#sentences' || hash === '#reading') return; // 专注有自己的计时；单词模式本身就是待机内容
  const idleMs = Math.max(1, get().settings.idleMin || 2) * 60 * 1000;
  idleTimer = setTimeout(() => { if (!externalStudyActive()) location.hash = '#word'; }, idleMs);
}
idleReset = resetIdle;
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, () => idleReset && idleReset(), { passive: true }));

// ---------- 启动 ----------
initTheme();
initFullscreen();
initSync();
initStudyTimer();
initWakeLock();

// Service Worker（离线缓存；file:// 下自动跳过）
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then(registration => registration.update())
    .catch(e => console.warn('SW registration failed', e));
}

if (!location.hash) location.hash = '#standby';
route();
initExternalStudy();
