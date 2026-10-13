import { h, toast } from './ui.js';
import { get, update } from './store.js';
import { pauseStudyTimer, formatStudyTime } from './study-timer.js';

const KEY = 'wallboard-external-v1';
let pending = null;
try { pending = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
let dialog = null;
let banner = null;
export const externalStudyActive = () => !!pending;
function persist() {
  if (pending) localStorage.setItem(KEY, JSON.stringify(pending));
  else localStorage.removeItem(KEY);
  paintBanner();
}
function closeDialog() { dialog?.remove(); dialog = null; }
function modal(title, ...children) {
  closeDialog();
  dialog = h('dialog', { class: 'external-dialog', 'aria-label': title },
    h('h2', {}, title), ...children);
  document.body.append(dialog);
  dialog.addEventListener('cancel', () => { closeDialog(); });
  dialog.showModal();
}
function finish(seconds) {
  const p = pending;
  if (!p) return;
  if (seconds > 0) update(s => {
    const id = `external:${p.id}`;
    if (!s.sessions.some(r => r.timerId === id)) s.sessions.push({
      timerId: id, date: new Date(p.startedAt).toISOString(), mode: 'external',
      seconds, minutes: seconds / 60, result: p.title, resourceUrl: p.url,
    });
    if (s.sessions.length > 400) s.sessions = s.sessions.slice(-400);
  });
  pending = null; persist(); closeDialog(); pauseStudyTimer(false);
  window.dispatchEvent(new Event('hashchange'));
  toast(seconds > 0 ? `Saved ${formatStudyTime(seconds)} of external study` : 'External session discarded');
}
function review() {
  if (!pending) return;
  pending.endedAt ||= Date.now(); persist();
  const elapsed = Math.max(0, Math.floor((pending.endedAt - pending.startedAt) / 1000));
  const suggested = Math.min(elapsed, pending.plannedMinutes * 60);
  const minutes = h('input', { type: 'number', min: '0', max: '1440', step: '1', value: Math.floor(suggested / 60) });
  const seconds = h('input', { type: 'number', min: '0', max: '59', step: '1', value: suggested % 60 });
  const error = h('p', { role: 'alert' });
  modal('Confirm external study',
    h('p', {}, pending.title),
    h('p', {}, `Time away: ${formatStudyTime(elapsed)}. Planned: ${pending.plannedMinutes} min.`),
    h('p', {}, 'Only save time you actually studied. The suggestion is capped at your planned time; you can edit it.'),
    h('div', { class: 'external-duration' }, h('label', {}, 'Minutes', minutes), h('label', {}, 'Seconds', seconds)), error,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost', onclick: () => finish(0) }, 'Discard'),
      h('button', { class: 'btn ghost', onclick: closeDialog }, 'Review later'),
      h('button', { class: 'btn primary', onclick: () => {
        const m = Number(minutes.value), s = Number(seconds.value);
        if (!minutes.value || !seconds.value || !Number.isInteger(m) || !Number.isInteger(s) || m < 0 || m > 1440 || s < 0 || s > 59) {
          error.textContent = 'Enter whole minutes (0–1440) and seconds (0–59).'; return;
        }
        finish(m * 60 + s);
      } }, 'Save study time')));
}
function paintBanner() {
  banner?.remove(); banner = null;
  if (!pending) return;
  banner = h('aside', { class: 'external-banner' },
    h('span', {}, `${pending.endedAt ? 'Confirm study time' : 'External study running'} · ${pending.title}`),
    h('button', { class: 'btn sm', onclick: review }, pending.endedAt ? 'Review' : 'Finish / confirm'));
  document.getElementById('topbar').after(banner);
}
export function openExternalStudy(title, url) {
  if (pending) { review(); return; }
  const plan = h('select', {}, ...[5, 15, 25, 45, 60].map(n => h('option', { value: n, ...(n === 15 ? { selected: '' } : {}) }, `${n} min`)));
  modal('Start external study', h('p', {}, title),
    h('p', {}, 'Start a session, then open the resource in a new tab. Return here to confirm your actual study time.'),
    h('label', {}, 'Planned duration', plan),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost', onclick: closeDialog }, 'Cancel'),
      h('a', { class: 'btn ghost', href: url, target: '_blank', rel: 'noopener noreferrer', onclick: closeDialog }, 'Open without timing'),
      h('button', { class: 'btn primary', onclick: () => {
        pending = { id: crypto.randomUUID(), title, url, plannedMinutes: Number(plan.value), startedAt: Date.now(), endedAt: null };
        pauseStudyTimer(true); persist(); closeDialog();
        // Open during the click gesture so browsers can allow the new tab.
        const tab = window.open(url, '_blank');
        if (tab) tab.opener = null;
        else toast('New tab blocked. Use Open resource below.');
        if (banner) banner.append(h('a', { class: 'btn sm', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open resource'));
      } }, 'Start & open')));
}
export function initExternalStudy() {
  paintBanner();
  document.addEventListener('visibilitychange', () => {
    if (!pending || document.hidden) return;
    review();
  });
  // Reloading must not lose a pending session.
  if (pending) setTimeout(review, 500);
}
