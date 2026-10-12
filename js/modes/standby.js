// standby.js — 今日仪表盘（EchoEnglish 风格，横屏一屏放下）
// 左：问候 + 绿色「每日短语」主卡 + 今天的学习路线；右：时钟/目标、连续学习、本周节奏、该复习了、小提醒
// 所有数字都来自真实学习记录（sessions / 卡组 / 打卡），不是手动勾选
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { get, addXP } from '../store.js';
import { displayStreak, minutesToday, studyDay, hasCheckedInToday, dayStr } from '../streak.js';
import { dueCards, addCard, reviewCard } from '../srs.js';
import { DAILY } from '../content.js';
import { speak, ttsAvailable } from '../tts.js';

const TIPS = [
  "You don't need every word. Get the gist first, then make one or two lines your own.",
  'Stuck? Copy the sentence, then swap one word. Imitation is where speaking starts.',
  'Cover the answer and try to recall it for a few seconds — the effort is the practice.',
  'Pick English content you actually enjoy at the right level. It keeps you coming back.',
  'Only five minutes today? That still counts. Keep the habit alive and continue tomorrow.',
  "Don't chase a perfect accent. Aim to be clear and easy to understand.",
  'After learning a phrase, use it in a sentence about your own life.',
];

// 今天的学习路线：与专注模式的步骤一一对应，完成情况由当天的真实练习记录判断
const ROUTE = [
  { key: 'listen', icon: 'headphones', cls: 'c1', title: 'Listening', desc: 'Listen once, no text, catch the gist', min: 5, hash: '#focus', by: 'focus' },
  { key: 'shadow', icon: 'repeat', cls: 'c2', title: 'Shadowing', desc: 'Repeat each line, copy the rhythm', min: 8, hash: '#focus', by: 'focus' },
  { key: 'recall', icon: 'cards', cls: 'c3', title: 'Recall', desc: 'Review cards, then make a sentence', min: 5, hash: '#micro', by: 'micro' },
  { key: 'speak', icon: 'chat', cls: 'c4', title: 'Speaking', desc: 'Say 2–3 sentences without looking', min: 7, hash: '#focus', by: 'focus' },
];

const hashOf = (s) => { let x = 0; for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x; };
const dailyItem = () => DAILY[hashOf(studyDay()) % DAILY.length];

/** 距离本学习日结束（次日凌晨 4 点）还剩几小时 */
function hoursLeft(now = new Date()) {
  const end = new Date(now);
  if (now.getHours() >= 4) end.setDate(end.getDate() + 1);
  end.setHours(4, 0, 0, 0);
  return Math.max(0, Math.ceil((end - now) / 3.6e6));
}

/** 问候语 + 状态（done / risk / 普通） */
function greeting(mins, goal, streak, checked) {
  const hr = new Date().getHours();
  const label = hr < 5 ? 'LATE NIGHT' : hr < 11 ? 'GOOD MORNING' : hr < 18 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
  let text = hr < 11 ? 'Good morning. Save a little room for English before the day fills up.'
    : hr < 17 ? "It's not too late to start. One small step still counts."
    : 'Long day? Five minutes of English is a nice way to close it.';
  let cls = '';
  if (checked || mins >= goal) {
    cls = 'done';
    text = checked ? `Checked in today · ${streak}-day streak. Nice work — rest easy.` : `${mins} minutes today — goal reached. Finish one Focus session to check in.`;
  } else if (hr >= 20 || hr < 4) {
    cls = 'risk';
    text = streak > 0 ? `Keep your ${streak}-day streak · about ${hoursLeft()} h left today` : 'Nothing yet today — how about 5 minutes before bed?';
  }
  return { label, text, cls };
}

/** 本周（周一开始）每天的学习分钟数 */
function thisWeek() {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const byDay = {};
  for (const s of get().sessions) {
    const k = studyDay(new Date(s.date));
    byDay[k] = (byDay[k] || 0) + (s.minutes || 0);
  }
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    const key = dayStr(d);
    return { key, label: ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i], minutes: byDay[key] || 0 };
  });
}

function build(root) {
  const s = get();
  const goal = s.settings.dailyGoalMin;
  const mins = minutesToday();
  const streak = displayStreak();
  const checked = hasCheckedInToday();
  const today = studyDay();
  const item = dailyItem();
  const g = greeting(mins, goal, streak, checked);
  const now = new Date();
  const doneModes = new Set(s.sessions.filter(x => studyDay(new Date(x.date)) === today).map(x => x.mode));

  // ---------- 问候 + 时钟 + 今日目标 ----------
  const clockEl = h('b', {}, '--:--');
  const dateEl = h('small', {}, now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase());
  const greet = h('section', { class: 'ec-greet' },
    h('div', {},
      h('div', { class: 'eyebrow' }, `${g.label} · A LITTLE ENGLISH, EVERY DAY`),
      h('h1', {}, 'Make it daily. ', h('span', {}, 'Start where you are.')),
      h('p', { class: g.cls }, g.text)),
    h('div', { class: 'ec-greet-right' },
      h('div', { class: 'ec-clock' }, clockEl, dateEl),
      h('div', { class: 'goal-chip' },
        h('div', { class: 'goal-icon' }, icon('sparkle', 18)),
        h('div', {}, h('small', {}, "Today's goal"), h('strong', {}, `${mins} / ${goal} min`)))));

  // ---------- 每日短语（绿色主卡） ----------
  let revealed = false;
  const cn = h('div', { class: 'phrase-cn reveal-hidden' }, item.zh);
  const ex = h('div', { class: 'phrase-example' }, 'Guess the meaning first, then reveal it.');
  const revealBtn = h('button', { class: 'light' }, 'Reveal meaning', icon('arrowRight', 14));
  revealBtn.addEventListener('click', () => {
    revealed = !revealed;
    cn.classList.toggle('reveal-hidden', !revealed);
    ex.textContent = revealed ? (item.note ? `Usage: ${item.note}` : '') : 'Guess the meaning first, then reveal it.';
    revealBtn.firstChild.textContent = revealed ? 'Hide meaning' : 'Reveal meaning';
  });
  const inDeck = s.cards.some(c => c.front === item.en);
  const addBtn = h('button', {
    onclick: () => {
      const added = addCard(item.en, item.zh, item.note || '');
      addBtn.replaceChildren(icon('check', 14), 'In review');
      toast(added ? 'Added to review — try recalling it tomorrow.' : 'Already in your review deck.');
    },
  }, icon(inDeck ? 'check' : 'plus', 14), inDeck ? 'In review' : 'Add to review');
  const hero = h('section', { class: 'ec-hero', 'aria-label': 'Phrase of the day' },
    h('div', { class: 'ec-hero-head' },
      h('div', { class: 'ec-hero-label' }, 'PHRASE OF THE DAY'),
      h('div', { class: 'today-badge' }, "TODAY'S PICK")),
    h('div', { class: 'phrase-en' }, item.en),
    cn, ex,
    h('div', { class: 'hero-actions' },
      revealBtn,
      h('button', { onclick: () => ttsAvailable() ? speak(item.en) : toast('No English voice available') }, icon('volume', 14), 'Listen'),
      addBtn));

  // ---------- 今天的学习路线 ----------
  const routeDone = ROUTE.filter(t => doneModes.has(t.by)).length;
  const pct = Math.min(100, goal ? (mins / goal) * 100 : 0);
  const route = h('section', { class: 'ec-card ec-route' },
    h('div', { class: 'ec-head' },
      h('div', {}, h('h2', {}, "Today's plan"), h('p', {}, 'Just go in order — no need to decide what to study.')),
      h('a', { class: 'text-btn', href: '#focus' }, 'Start 25-min focus')),
    h('div', { class: 'tasks' },
      ...ROUTE.map(t => {
        const done = doneModes.has(t.by);
        return h('button', { class: 'task' + (done ? ' done' : ''), onclick: () => { location.hash = t.hash; } },
          h('div', { class: 'task-icon ' + t.cls }, icon(t.icon, 20)),
          h('div', {}, h('div', { class: 'task-title' }, t.title), h('div', { class: 'task-desc' }, t.desc)),
          h('span', { class: 'task-time' }, done ? icon('check', 13) : null, done ? 'Done' : `${t.min} min`));
      })),
    h('div', { class: 'progress-area' },
      h('div', { class: 'progress-meta' },
        h('span', {}, 'Progress ', h('strong', {}, mins >= goal ? `${mins} / ${goal} min · goal reached` : `${mins} / ${goal} min`)),
        h('span', {}, `${routeDone} / 4 done`)),
      h('div', { class: 'progress-track' }, h('div', { class: 'progress-fill', style: `width:${pct}%` }))));

  // ---------- 右栏：统计 ----------
  const week = thisWeek();
  const weekTotal = week.reduce((a, d) => a + d.minutes, 0);
  const weekDays = week.filter(d => d.minutes >= 5).length;
  const stats = h('div', { class: 'stats-grid' },
    h('section', { class: 'ec-card stat-card' },
      h('div', { class: 'stat-top' }, h('span', {}, 'Streak'), h('span', { class: 'stat-emoji fire' }, icon('flame', 16))),
      h('div', { class: 'stat-number' }, String(streak), h('small', {}, streak === 1 ? 'day' : 'days')),
      h('div', { class: 'stat-foot' }, streak === 0 ? 'Start your rhythm today' : streak === 1 ? 'Day one — keep going!' : `Best: ${s.profile.bestStreak} days`)),
    h('section', { class: 'ec-card stat-card' },
      h('div', { class: 'stat-top' }, h('span', {}, 'This week'), h('span', { class: 'stat-emoji' }, icon('timer', 16))),
      h('div', { class: 'stat-number' }, String(weekTotal), h('small', {}, 'min')),
      h('div', { class: 'stat-foot' }, `Lv.${s.profile.level} · ${s.profile.xp} XP total`)));

  // ---------- 右栏：本周节奏 ----------
  const maxBar = Math.max(goal, ...week.map(d => d.minutes));
  const weekly = h('section', { class: 'ec-card' },
    h('div', { class: 'ec-head' },
      h('div', {}, h('h2', {}, 'Weekly rhythm'), h('p', {}, 'Consistency beats one long session.')), icon('chart', 18)),
    h('div', { class: 'weekly' },
      ...week.map(d => {
        const bar = h('div', { class: 'bar' + (d.minutes >= 5 ? ' active' : '') + (d.key === today ? ' today' : ''), title: `${d.key}: ${d.minutes} min` });
        bar.style.height = `${d.minutes ? Math.max(8, (d.minutes / maxBar) * 100) : 6}%`;
        return h('div', { class: 'day-col' },
          h('div', { class: 'bar-area' }, bar),
          h('div', { class: 'day-label' + (d.key === today ? ' today' : '') }, d.key === today ? 'Today' : d.label));
      })),
    h('div', { class: 'weekly-caption' }, h('span', {}, `${weekDays} active day${weekDays === 1 ? '' : 's'} this week`), h('span', {}, `Goal: ${goal} min/day`)));

  // ---------- 右栏：该复习了 ----------
  const reviewBox = h('div', {});
  const review = h('section', { class: 'ec-card ec-review' },
    h('div', { class: 'ec-head' },
      h('div', {}, h('h2', {}, 'Time to review'), h('p', {}, "Recall first, then reveal. Forgetting is normal.")), icon('undo', 18)),
    reviewBox);
  function paintReview() {
    const due = dueCards();
    reviewBox.replaceChildren();
    if (!due.length) {
      reviewBox.append(h('div', { class: 'empty-state' }, 'No cards due today.', h('strong', {}, "Learn today's new phrase instead.")));
      return;
    }
    const c = due[0];
    const cnEl = h('div', { class: 'review-cn' }, 'Tap “Show answer” to check yourself.');
    const showBtn = h('button', { class: 'go' }, 'Show answer');
    const againBtn = h('button', {}, 'Not yet');
    const grade = (q) => {
      reviewCard(c.id, q);
      addXP(2);
      toast(q === 2 ? 'Got it — next review scheduled.' : "No worries — you'll see it again tomorrow.");
      paintReview();
    };
    showBtn.addEventListener('click', () => {
      if (showBtn.dataset.shown) return grade(2);
      showBtn.dataset.shown = '1';
      cnEl.textContent = c.back + (c.example ? `  ·  ${c.example}` : '');
      showBtn.textContent = 'I knew it';
    });
    againBtn.addEventListener('click', () => grade(0));
    reviewBox.append(
      h('div', { class: 'review-item' },
        h('div', { class: 'review-word' }, c.front), cnEl,
        h('div', { class: 'review-actions' }, showBtn, againBtn)),
      h('div', { class: 'review-more' },
        h('span', {}, `${due.length} card${due.length === 1 ? '' : 's'} due today`),
        h('a', { class: 'text-btn', href: '#micro' }, 'Review in Quick 5 →')));
  }
  paintReview();

  // ---------- 右栏：小提醒（到期时优先提醒备份） ----------
  const lastBk = s.settings.lastBackupHint;
  const needBackup = !lastBk || (Date.now() - new Date(lastBk).getTime()) > 7 * 864e5;
  const tip = needBackup
    ? h('a', { class: 'tiny-tip', href: '#settings' },
      h('div', { class: 'bulb' }, icon('download', 18)),
      h('div', {}, h('strong', {}, 'Back up your progress'), h('p', {}, 'Progress lives only in this browser. Export a copy in Settings → Backup.')))
    : h('section', { class: 'tiny-tip' },
      h('div', { class: 'bulb' }, icon('bulb', 18)),
      h('div', {}, h('strong', {}, 'Tip of the day'), h('p', {}, TIPS[hashOf(today) % TIPS.length])));

  const wrap = h('div', { class: 'ec-dash' },
    greet,
    h('main', { class: 'ec-grid' },
      h('div', { class: 'ec-col' }, hero, route, tip),
      h('aside', { class: 'ec-col' }, stats, weekly, review)));
  root.append(wrap);

  const tick = () => {
    const n = new Date();
    clockEl.textContent = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  };
  tick();
  return { tick, key: stateKey() };
}

/** 状态指纹：跨日、进入晚间提醒、剩余小时变化时整体重绘 */
function stateKey() {
  const s = get();
  const g = greeting(minutesToday(), s.settings.dailyGoalMin, displayStreak(), hasCheckedInToday());
  return `${studyDay()}|${g.cls}|${g.text}|${g.label}`;
}

export function renderStandby(root) {
  let view = build(root);
  const timer = setInterval(() => {
    view.tick();
    if (new Date().getSeconds() === 0 && stateKey() !== view.key) {
      root.innerHTML = '';
      view = build(root);
    }
  }, 1000);
  return () => clearInterval(timer);
}
