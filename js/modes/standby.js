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
  '不要追求每个词都懂。先听懂大意，再把一两句真正变成自己的表达。',
  '说不出来时，先模仿，再替换一个词造句。模仿是起点，不是终点。',
  '复习时先遮住中文，努力回忆几秒钟，再看答案；回忆本身就是练习。',
  '选择你真正感兴趣、难度合适的英文内容，更容易持续积累。',
  '今天只有五分钟也没关系。把习惯保留下来，明天再继续。',
  '发音练习不需要一开始就追求口音完美，先让表达清楚、可理解。',
  '学完一个短语，试着把它放进你自己的生活场景里。',
];

// 今天的学习路线：与专注模式的步骤一一对应，完成情况由当天的真实练习记录判断
const ROUTE = [
  { key: 'listen', icon: 'headphones', cls: 'c1', title: '听力理解', desc: '先不看文本听一遍，抓住大意', min: 5, hash: '#focus', by: 'focus' },
  { key: 'shadow', icon: 'repeat', cls: 'c2', title: '跟读模仿', desc: '逐句跟读，模仿重音与节奏', min: 8, hash: '#focus', by: 'focus' },
  { key: 'recall', icon: 'cards', cls: 'c3', title: '短语与回忆', desc: '回忆卡片，再自己造一个句', min: 5, hash: '#micro', by: 'micro' },
  { key: 'speak', icon: 'chat', cls: 'c4', title: '主动输出', desc: '不看原文，用英语说 2–3 句', min: 7, hash: '#focus', by: 'focus' },
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
  let text = hr < 11 ? '早上好。趁一天刚开始，给英语留一点空间。'
    : hr < 17 ? '现在开始也不晚，完成一小步就算进步。'
    : '今天辛苦了。用 5 分钟英语，为今天画个小句号。';
  let cls = '';
  if (checked || mins >= goal) {
    cls = 'done';
    text = checked ? `今天已打卡，连续 ${streak} 天。记住你的进步，然后安心休息。` : `今天已学 ${mins} 分钟，目标完成。再做一次专注就能打卡。`;
  } else if (hr >= 20 || hr < 4) {
    cls = 'risk';
    text = streak > 0 ? `连续 ${streak} 天就差今天 · 还剩约 ${hoursLeft()} 小时` : '今天还没开始，睡前来 5 分钟吧。';
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
    return { key, label: '一二三四五六日'[i], minutes: byDay[key] || 0 };
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
      h('h1', {}, '让英语成为日常。', h('span', {}, 'Start where you are.')),
      h('p', { class: g.cls }, g.text)),
    h('div', { class: 'ec-greet-right' },
      h('div', { class: 'ec-clock' }, clockEl, dateEl),
      h('div', { class: 'goal-chip' },
        h('div', { class: 'goal-icon' }, icon('sparkle', 18)),
        h('div', {}, h('small', {}, '今日目标'), h('strong', {}, `${goal} 分钟 · 已学 ${mins}`)))));

  // ---------- 每日短语（绿色主卡） ----------
  let revealed = false;
  const cn = h('div', { class: 'phrase-cn reveal-hidden' }, item.zh);
  const ex = h('div', { class: 'phrase-example' }, '用法提示也先藏起来，先自己想一想。');
  const revealBtn = h('button', { class: 'light' }, '看看意思', icon('arrowRight', 14));
  revealBtn.addEventListener('click', () => {
    revealed = !revealed;
    cn.classList.toggle('reveal-hidden', !revealed);
    ex.textContent = revealed ? (item.note ? `用法：${item.note}` : '') : '用法提示也先藏起来，先自己想一想。';
    revealBtn.firstChild.textContent = revealed ? '隐藏释义' : '看看意思';
  });
  const inDeck = s.cards.some(c => c.front === item.en);
  const addBtn = h('button', {
    onclick: () => {
      const added = addCard(item.en, item.zh, item.note || '');
      addBtn.replaceChildren(icon('check', 14), '已加入复习');
      toast(added ? '已加入复习，明天再回忆一次。' : '这条短语已经在复习计划里。');
    },
  }, icon(inDeck ? 'check' : 'plus', 14), inDeck ? '已加入复习' : '加入复习');
  const hero = h('section', { class: 'ec-hero', 'aria-label': '今日短语' },
    h('div', { class: 'ec-hero-head' },
      h('div', { class: 'ec-hero-label' }, 'PHRASE OF THE DAY'),
      h('div', { class: 'today-badge' }, "TODAY'S PICK")),
    h('div', { class: 'phrase-en' }, item.en),
    cn, ex,
    h('div', { class: 'hero-actions' },
      revealBtn,
      h('button', { onclick: () => ttsAvailable() ? speak(item.en) : toast('当前无可用英文语音') }, icon('volume', 14), '听发音'),
      addBtn));

  // ---------- 今天的学习路线 ----------
  const routeDone = ROUTE.filter(t => doneModes.has(t.by)).length;
  const pct = Math.min(100, goal ? (mins / goal) * 100 : 0);
  const route = h('section', { class: 'ec-card ec-route' },
    h('div', { class: 'ec-head' },
      h('div', {}, h('h2', {}, '今天的学习路线'), h('p', {}, '按顺序完成即可，不用纠结学什么。')),
      h('a', { class: 'text-btn', href: '#focus' }, '开始专注 25 分钟')),
    h('div', { class: 'tasks' },
      ...ROUTE.map(t => {
        const done = doneModes.has(t.by);
        return h('button', { class: 'task' + (done ? ' done' : ''), onclick: () => { location.hash = t.hash; } },
          h('div', { class: 'task-icon ' + t.cls }, icon(t.icon, 20)),
          h('div', {}, h('div', { class: 'task-title' }, t.title), h('div', { class: 'task-desc' }, t.desc)),
          h('span', { class: 'task-time' }, done ? icon('check', 13) : null, done ? '完成' : `${t.min} 分钟`));
      })),
    h('div', { class: 'progress-area' },
      h('div', { class: 'progress-meta' },
        h('span', {}, '今日进度 ', h('strong', {}, mins >= goal ? `${mins} / ${goal} 分钟 · 今日目标完成` : `${mins} / ${goal} 分钟`)),
        h('span', {}, `${routeDone} / 4 项完成`)),
      h('div', { class: 'progress-track' }, h('div', { class: 'progress-fill', style: `width:${pct}%` }))));

  // ---------- 右栏：统计 ----------
  const week = thisWeek();
  const weekTotal = week.reduce((a, d) => a + d.minutes, 0);
  const weekDays = week.filter(d => d.minutes >= 5).length;
  const stats = h('div', { class: 'stats-grid' },
    h('section', { class: 'ec-card stat-card' },
      h('div', { class: 'stat-top' }, h('span', {}, '连续学习'), h('span', { class: 'stat-emoji fire' }, icon('flame', 16))),
      h('div', { class: 'stat-number' }, String(streak), h('small', {}, '天')),
      h('div', { class: 'stat-foot' }, streak === 0 ? '从今天开始建立节奏' : streak === 1 ? '连续学习的第一天！' : `最佳纪录 ${s.profile.bestStreak} 天`)),
    h('section', { class: 'ec-card stat-card' },
      h('div', { class: 'stat-top' }, h('span', {}, '本周学习'), h('span', { class: 'stat-emoji' }, icon('timer', 16))),
      h('div', { class: 'stat-number' }, String(weekTotal), h('small', {}, '分钟')),
      h('div', { class: 'stat-foot' }, `Lv.${s.profile.level} · 共 ${s.profile.xp} XP`)));

  // ---------- 右栏：本周节奏 ----------
  const maxBar = Math.max(goal, ...week.map(d => d.minutes));
  const weekly = h('section', { class: 'ec-card' },
    h('div', { class: 'ec-head' },
      h('div', {}, h('h2', {}, '本周节奏'), h('p', {}, '稳定比某一天学很久更重要。')), icon('chart', 18)),
    h('div', { class: 'weekly' },
      ...week.map(d => {
        const bar = h('div', { class: 'bar' + (d.minutes >= 5 ? ' active' : '') + (d.key === today ? ' today' : ''), title: `${d.key}: ${d.minutes} 分钟` });
        bar.style.height = `${d.minutes ? Math.max(8, (d.minutes / maxBar) * 100) : 6}%`;
        return h('div', { class: 'day-col' },
          h('div', { class: 'bar-area' }, bar),
          h('div', { class: 'day-label' + (d.key === today ? ' today' : '') }, d.key === today ? '今' : d.label));
      })),
    h('div', { class: 'weekly-caption' }, h('span', {}, `本周完成 ${weekDays} 天`), h('span', {}, `目标：每天 ${goal} 分钟`)));

  // ---------- 右栏：该复习了 ----------
  const reviewBox = h('div', {});
  const review = h('section', { class: 'ec-card ec-review' },
    h('div', { class: 'ec-head' },
      h('div', {}, h('h2', {}, '该复习了'), h('p', {}, '先回忆，再揭晓；想不起来也正常。')), icon('undo', 18)),
    reviewBox);
  function paintReview() {
    const due = dueCards();
    reviewBox.replaceChildren();
    if (!due.length) {
      reviewBox.append(h('div', { class: 'empty-state' }, '今天没有到期的卡片。', h('strong', {}, '先学会今天的新表达吧。')));
      return;
    }
    const c = due[0];
    const cnEl = h('div', { class: 'review-cn' }, '点「查看答案」确认记忆情况。');
    const showBtn = h('button', { class: 'go' }, '查看答案');
    const againBtn = h('button', {}, '还不熟');
    const grade = (q) => {
      reviewCard(c.id, q);
      addXP(2);
      toast(q === 2 ? '记住了，已安排下次复习。' : '没关系，明天再见一次。');
      paintReview();
    };
    showBtn.addEventListener('click', () => {
      if (showBtn.dataset.shown) return grade(2);
      showBtn.dataset.shown = '1';
      cnEl.textContent = c.back + (c.example ? `  ·  ${c.example}` : '');
      showBtn.textContent = '记住了';
    });
    againBtn.addEventListener('click', () => grade(0));
    reviewBox.append(
      h('div', { class: 'review-item' },
        h('div', { class: 'review-word' }, c.front), cnEl,
        h('div', { class: 'review-actions' }, showBtn, againBtn)),
      h('div', { class: 'review-more' },
        h('span', {}, `今天还有 ${due.length} 张到期`),
        h('a', { class: 'text-btn', href: '#micro' }, '去碎片练习 →')));
  }
  paintReview();

  // ---------- 右栏：小提醒（到期时优先提醒备份） ----------
  const lastBk = s.settings.lastBackupHint;
  const needBackup = !lastBk || (Date.now() - new Date(lastBk).getTime()) > 7 * 864e5;
  const tip = needBackup
    ? h('a', { class: 'tiny-tip', href: '#settings' },
      h('div', { class: 'bulb' }, icon('download', 18)),
      h('div', {}, h('strong', {}, '记得备份'), h('p', {}, '进度只存在这台设备的浏览器里。去「设置 → 导出备份」存一份。')))
    : h('section', { class: 'tiny-tip' },
      h('div', { class: 'bulb' }, icon('bulb', 18)),
      h('div', {}, h('strong', {}, '今天的小提醒'), h('p', {}, TIPS[hashOf(today) % TIPS.length])));

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
