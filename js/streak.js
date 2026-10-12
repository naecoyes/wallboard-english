// streak.js — 打卡与连续天数。日界为凌晨 4 点：4 点前算前一天，熬夜学习不断签。
import { get, update } from './store.js';

/** 把 Date 转为 "YYYY-MM-DD"（本地时区） */
export function dayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 学习日：凌晨 4 点前仍算昨天的学习日 */
export function studyDay(now = new Date()) {
  const d = new Date(now);
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  return dayStr(d);
}

export function prevDayStr(ds) {
  const d = new Date(ds + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return dayStr(d);
}

export function hasCheckedInToday() {
  return get().profile.lastCheckIn === studyDay();
}

/**
 * 打卡。返回 { streak, already }。
 * 昨天打过卡则连续 +1，否则归零重计；同一天重复打卡不变。
 */
export function checkIn() {
  const today = studyDay();
  const p = get().profile;
  if (p.lastCheckIn === today) return { streak: p.streak, already: true };
  const yesterday = prevDayStr(today);
  const next = p.lastCheckIn === yesterday ? p.streak + 1 : 1;
  update(s => {
    s.profile.streak = next;
    s.profile.bestStreak = Math.max(s.profile.bestStreak, next);
    s.profile.lastCheckIn = today;
  });
  return { streak: next, already: false };
}

/** 当前展示的 streak（若昨天没打卡则显示 0，但不抹掉历史数据） */
export function displayStreak() {
  const p = get().profile;
  const today = studyDay();
  if (p.lastCheckIn === today || p.lastCheckIn === prevDayStr(today)) return p.streak;
  return 0;
}

/** 今日已学分钟数（按学习日统计） */
export function minutesToday() {
  const today = studyDay();
  return get().sessions
    .filter(s => studyDay(new Date(s.date)) === today)
    .reduce((sum, s) => sum + (s.minutes || 0), 0);
}

/** 近 7 天每天分钟数（含今天），用于热力条 */
export function last7Days() {
  const out = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = dayStr(d);
    const mins = get().sessions
      .filter(s => studyDay(new Date(s.date)) === ds)
      .reduce((sum, s) => sum + (s.minutes || 0), 0);
    out.push({ day: ds, dow: '日一二三四五六'[d.getDay()], minutes: mins });
  }
  return out;
}
