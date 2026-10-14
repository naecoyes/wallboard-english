// theme.js — 配色主题 + 白天 / 夜间模式自动切换
// settings.palette：配色主题（forest / ocean / terracotta / lavender / rose / graphite），每个都有白天和夜间两套颜色
// settings.theme：auto（按时间段）| system（跟随系统深色模式）| light | dark
import { get } from './store.js';

const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** 可选配色：id / 名称 / 色板预览用的颜色（白天：背景、主卡、强调色；夜间同理） */
export const PALETTES = [
  { id: 'forest', name: 'Forest', day: ['#f4f3ed', '#236b52', '#236b52'], night: ['#0f1513', '#1b4b3a', '#4cae86'] },
  { id: 'ocean', name: 'Ocean', day: ['#f2f4f6', '#1f5f8b', '#1f5f8b'], night: ['#0e1319', '#1b3f5c', '#5aa6dc'] },
  { id: 'terracotta', name: 'Terracotta', day: ['#f6f1ea', '#b5532e', '#b5532e'], night: ['#15110e', '#5a2d19', '#e08a5f'] },
  { id: 'lavender', name: 'Lavender', day: ['#f4f3f8', '#5b4bb7', '#5b4bb7'], night: ['#111019', '#352b72', '#a597ee'] },
  { id: 'rose', name: 'Rose', day: ['#f7f2f3', '#a8385d', '#a8385d'], night: ['#150f12', '#5c1f35', '#e07a9c'] },
  { id: 'graphite', name: 'Graphite', day: ['#f2f2f0', '#232323', '#2b2b2b'], night: ['#0f0f0f', '#2a2a2a', '#e8e8e8'] },
];
const IDS = new Set(PALETTES.map(p => p.id));

/** 现在应该用白天还是夜间 */
export function currentTheme(now = new Date()) {
  // 预览用：网址加 ?theme=light 或 ?theme=dark 可临时强制（不写入设置）
  const forced = new URLSearchParams(location.search).get('theme');
  if (forced === 'light' || forced === 'dark') return forced;
  const { theme = 'auto', dayStart = 7, dayEnd = 19 } = get().settings;
  if (theme === 'light' || theme === 'dark') return theme;
  if (theme === 'system') return mq && mq.matches ? 'dark' : 'light';
  const h = now.getHours() + now.getMinutes() / 60;
  return h >= dayStart && h < dayEnd ? 'light' : 'dark';
}

/** 当前配色主题（网址 ?palette=ocean 可临时预览） */
export function currentPalette() {
  const forced = new URLSearchParams(location.search).get('palette');
  if (IDS.has(forced)) return forced;
  const p = get().settings.palette;
  return IDS.has(p) ? p : 'forest';
}

/** 是否处于深夜极暗模式（23:00–06:00 自动开启，或 ?dim=1 强制预览） */
export function isDimmed(now = new Date()) {
  const forced = new URLSearchParams(location.search).get('dim');
  if (forced === '1' || forced === 'true') return true;
  if (forced === '0' || forced === 'false') return false;
  const mode = get().settings.nightDim || 'auto';
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  const h = now.getHours() + now.getMinutes() / 60;
  return h >= 23 || h < 6;
}

let metaSynced = false;
export function applyTheme() {
  const root = document.documentElement;
  const t = currentTheme();
  const p = currentPalette();
  const dim = isDimmed() ? '1' : '0';
  const shiftOn = get().settings.pixelShift !== false;
  const appEl = document.getElementById('app');
  if (appEl) {
    if (shiftOn) {
      const m = new Date().getMinutes();
      const dx = (m % 5) - 2;
      const dy = (Math.floor(m / 5) % 3) - 1;
      appEl.style.transform = `translate(${dx}px, ${dy}px)`;
    } else {
      appEl.style.transform = '';
    }
  }
  // 首帧脚本已经设好 theme/palette，但还没同步地址栏颜色，所以第一次调用一定要往下走
  if (metaSynced && root.dataset.theme === t && root.dataset.palette === p && root.dataset.dim === dim) return;
  metaSynced = true;
  root.dataset.theme = t;
  root.dataset.palette = p;
  root.dataset.dim = dim;
  // 浏览器地址栏 / 状态栏颜色跟随当前背景色
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#f4f3ed');
}

export function initTheme() {
  applyTheme();
  setInterval(applyTheme, 30 * 1000); // 每 30 秒检查一次是否到点切换
  if (mq) (mq.addEventListener ? mq.addEventListener('change', applyTheme) : mq.addListener(applyTheme));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) applyTheme(); });
}
