// Fullscreen API: must be initiated by a user gesture.
import { icon } from './icons.js';
import { toast } from './ui.js';

export function initFullscreen() {
  const button = document.getElementById('fullscreen-btn');
  const root = document.documentElement;
  const active = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const sync = () => {
    const on = active();
    button.replaceChildren(icon(on ? 'minimize' : 'maximize', 20));
    button.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
    button.setAttribute('title', on ? 'Exit fullscreen' : 'Enter fullscreen');
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('active', on);
  };
  button.addEventListener('click', async () => {
    try {
      if (active()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      } else {
        const request = root.requestFullscreen || root.webkitRequestFullscreen;
        if (!request) {
          toast('Fullscreen is unavailable. Try adding this site to your home screen.');
          return;
        }
        if (root.requestFullscreen) {
          await request.call(root, { navigationUI: 'hide' });
        } else {
          await request.call(root);
        }
      }
      sync();
    } catch {
      toast('Fullscreen was blocked by your browser. Try opening the site directly.');
    }
  });
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();
}
