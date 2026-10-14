// ui.js — DOM 小工具
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** 数字从 0 递增到目标值（动画关闭或静默刷新时直接显示） */
export function countUp(el, to, ms = 700) {
  const root = document.documentElement;
  if (!to || root.dataset.motion === 'off' || root.dataset.quiet) { el.textContent = String(to); return el; }
  const t0 = performance.now();
  el.textContent = '0';
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return el;
}

/** 屏幕中央弹出一个对勾（标记「会了」时的反馈） */
export function celebrate() {
  if (document.documentElement.dataset.motion === 'off') return;
  const el = h('div', { class: 'celebrate', 'aria-hidden': 'true' });
  el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  document.body.append(el);
  setTimeout(() => el.remove(), 800);
}

export function toast(msg) {
  const el = h('div', { class: 'xp-toast' }, msg);
  document.body.append(el);
  setTimeout(() => el.remove(), 1500);
}
