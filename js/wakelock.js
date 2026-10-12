// wakelock.js — Screen Wake Lock：挂墙时防止自动休眠
// 注意：只在安全上下文可用（https 或 localhost）。平板通过 http://192.168.x.x 访问时不可用，
//       此时需在平板系统设置里把「休眠」设为「永不」。
let sentinel = null;

export async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return false;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
    return true;
  } catch (e) {
    console.warn('Wake Lock 申请失败', e);
    return false;
  }
}

export function wakeLockSupported() { return 'wakeLock' in navigator; }
export function wakeLockActive() { return sentinel !== null; }

/** 页面重新可见时自动重新申请（切后台会被系统释放） */
export function initWakeLock() {
  requestWakeLock();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });
  // 部分浏览器需要用户手势后才能申请，首次触摸时再试一次
  document.addEventListener('pointerdown', () => requestWakeLock(), { once: true });
}
