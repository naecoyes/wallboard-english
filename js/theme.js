// theme.js — 白天 / 夜间模式自动切换
// 设置项 settings.theme：auto（按时间段）| system（跟随系统深色模式）| light | dark
import { get } from './store.js';

const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const META = { light: '#f4f3ed', dark: '#0f1513' };

/** 现在应该用哪种主题 */
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

export function applyTheme() {
  const t = currentTheme();
  const root = document.documentElement;
  if (root.dataset.theme === t) return;
  root.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META[t]);
}

export function initTheme() {
  applyTheme();
  setInterval(applyTheme, 30 * 1000); // 每 30 秒检查一次是否到点切换
  if (mq) (mq.addEventListener ? mq.addEventListener('change', applyTheme) : mq.addListener(applyTheme));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) applyTheme(); });
}
