// swipe.js — 左右滑动手势：向左滑 = 下一个，向右滑 = 上一个
export function attachSwipe(el, { left, right }) {
  let sx = null, sy = 0, t = 0;
  el.style.touchAction = 'pan-y';
  el.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; t = Date.now(); });
  el.addEventListener('pointerup', e => {
    if (sx == null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - t < 800) (dx < 0 ? left : right)?.();
  });
  el.addEventListener('pointercancel', () => { sx = null; });
}
