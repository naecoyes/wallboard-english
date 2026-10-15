// One monotonic clock for every study screen. No minimum-minute rounding.
import { get, update, compactSessions } from './store.js';
import { studyDay } from './streak.js';

export class ActiveClock {
  constructor(now = 0, visible = true, idleMs = 60000) {
    this.last = now; this.activity = now; this.visible = visible;
    this.paused = false; this.total = 0; this.idleMs = idleMs;
  }
  sample(now) {
    const end = Math.min(now, this.activity + this.idleMs);
    const delta = this.visible && !this.paused ? Math.max(0, end - this.last) : 0;
    this.total += delta; this.last = now;
    return delta;
  }
  touch(now) { this.sample(now); this.activity = now; }
  visibility(now, visible) { this.sample(now); this.visible = visible; if (visible) this.activity = now; }
  pause(now, paused) { this.sample(now); this.paused = paused; if (!paused) this.activity = now; }
}

const MODES = new Set(['standby', 'micro', 'focus', 'word', 'sentences', 'reading', 'settings']);
let current = null;
const now = () => performance.now();
export const formatStudyTime = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function sample() {
  if (!current) return;
  const delta = current.clock.sample(now());
  const day = studyDay();
  current.buckets.set(day, (current.buckets.get(day) || 0) + delta);
}
function flush() {
  if (!current) return;
  sample();
  const c = current;
  update(s => {
    for (const [day, ms] of c.buckets) {
      if (ms < 1000) continue;
      const id = `${c.id}:${day}`;
      let rec = s.sessions.find(r => r.timerId === id);
      if (!rec) {
        rec = { timerId: id, studyDay: day, date: new Date().toISOString(), mode: c.mode, seconds: 0, minutes: 0, result: '' };
        s.sessions.push(rec);
      }
      rec.seconds = Math.floor(ms / 1000);
      rec.minutes = rec.seconds / 60;
    }
    s.sessions = compactSessions(s.sessions);
  });
}
export function startStudyTimer(mode) {
  flush();
  current = MODES.has(mode) ? {
    mode, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    clock: new ActiveClock(now(), !document.hidden, Infinity), buckets: new Map(),
  } : null;
}
export function studySeconds() { sample(); return current ? current.clock.total / 1000 : 0; }
export function pauseStudyTimer(paused) { sample(); current?.clock.pause(now(), paused); flush(); }
export function finishStudyResult(result) {
  flush();
  if (!current) return;
  const prefix = current.id + ':';
  update(s => s.sessions.filter(r => r.timerId?.startsWith(prefix)).forEach(r => { r.result = result; }));
}
export function initStudyTimer() {
  for (const type of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(type, e => {
    if (!e.isTrusted || !current) return;
    sample(); current.clock.touch(now());
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    sample(); current?.clock.visibility(now(), !document.hidden); flush();
  });
  window.addEventListener('pagehide', flush);
  setInterval(() => { sample(); }, 1000);
  setInterval(flush, 5000);
}

export const sessionSeconds = record => Number.isFinite(record.seconds) ? record.seconds : (record.minutes || 0) * 60;
export const sessionDay = record => record.studyDay || studyDay(new Date(record.date));
