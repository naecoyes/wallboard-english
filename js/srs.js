// srs.js — 简化 SM-2 间隔复习。自评三档：0 忘了 / 1 模糊 / 2 认识。
import { get, update } from './store.js';
import { studyDay } from './streak.js';

function plusDays(dayString, n) {
  const d = new Date(dayString + 'T12:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function newCard(front, back, example = '') {
  return {
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    front, back, example,
    due: studyDay(),          // 新卡今天就可复习
    interval: 0, ease: 2.5, reps: 0, lapses: 0,
    added: studyDay(),
  };
}

export function addCard(front, back, example = '') {
  const exists = get().cards.some(c => c.front === front);
  if (exists) return null;
  const card = newCard(front, back, example);
  update(s => { s.cards.push(card); });
  return card;
}

/** 复习评分，返回更新后的卡片 */
export function reviewCard(cardId, q) {
  let result = null;
  update(s => {
    const c = s.cards.find(x => x.id === cardId);
    if (!c) return;
    if (q === 0) {
      c.reps = 0;
      c.interval = 1;
      c.lapses += 1;
      c.ease = Math.max(1.3, c.ease - 0.2);
    } else if (q === 1) {
      c.reps += 1;
      c.ease = Math.max(1.3, c.ease - 0.15);
      c.interval = Math.max(1, Math.round((c.interval || 1) * 1.2));
    } else {
      c.reps += 1;
      c.ease = c.ease + 0.15;
      if (c.reps === 1) c.interval = 1;
      else if (c.reps === 2) c.interval = 3;
      else c.interval = Math.round(c.interval * c.ease);
    }
    c.due = plusDays(studyDay(), c.interval);
    result = c;
  });
  return result;
}

/** 今日到期卡片（含过期） */
export function dueCards() {
  const today = studyDay();
  return get().cards.filter(c => c.due <= today);
}

/** 随机取一张到期卡 */
export function nextDueCard(excludeId = null) {
  const pool = dueCards().filter(c => c.id !== excludeId);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
