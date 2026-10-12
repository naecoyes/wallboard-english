// standby.js — 待机仪表盘：挂墙时的默认屏
// 横屏双栏一屏放下：左 = 时间 / 状态 / 数据；右 = 每日一句 / 待复习 / 两个主入口
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { get } from '../store.js';
import { displayStreak, minutesToday, last7Days, studyDay, hasCheckedInToday } from '../streak.js';
import { dueCards } from '../srs.js';
import { DAILY } from '../content.js';
import { speak, ttsAvailable } from '../tts.js';

function dailyItem() {
  // 按学习日稳定轮换
  const ds = studyDay();
  let hash = 0;
  for (const ch of ds) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return DAILY[hash % DAILY.length];
}

/** 距离本学习日结束（次日凌晨 4 点）还剩几小时 */
function hoursLeft(now = new Date()) {
  const end = new Date(now);
  if (now.getHours() >= 4) end.setDate(end.getDate() + 1);
  end.setHours(4, 0, 0, 0);
  return Math.max(0, Math.ceil((end - now) / 3.6e6));
}

/** 今日状态：done（已打卡）/ risk（晚上还没学）/ idle */
function todayStatus(mins, goal, streak, checked) {
  const hour = new Date().getHours();
  const late = hour >= 20 || hour < 4;
  if (checked) return { cls: 'done', text: `今日已打卡 · 连续 ${streak} 天，明天继续` };
  if (mins >= goal) return { cls: 'done', text: `今日已学 ${mins} 分钟，完成一次专注即可打卡` };
  if (late) {
    const left = hoursLeft();
    return {
      cls: 'risk',
      text: streak > 0 ? `连续 ${streak} 天就差今天 · 还剩约 ${left} 小时` : `今天还没学 · 睡前来 5 分钟吧`,
    };
  }
  if (mins === 0) return { cls: '', text: '今天还没开始，先花 5 分钟热个身' };
  return { cls: '', text: `今天已学 ${mins} 分钟 · 还差 ${goal - mins} 分钟达标` };
}

function ring(pct, label) {
  const r = 42, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(1, Math.max(0, pct)));
  const full = pct >= 1;
  const box = h('div', { class: 'ring' });
  box.innerHTML = `
    <svg viewBox="0 0 100 100">
      <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${full ? '#6ee7b7' : '#a5b4fc'}"/>
        <stop offset="1" stop-color="${full ? '#10b981' : '#38bdf8'}"/>
      </linearGradient></defs>
      <circle cx="50" cy="50" r="${r}" fill="none" style="stroke: rgba(var(--tint), .08)" stroke-width="9"/>
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="url(#ringGrad)" stroke-width="9"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${pct > 0 ? off : c}"
        transform="rotate(-90 50 50)"/>
    </svg>`;
  box.append(h('div', { class: 'ring-txt' }, label));
  return box;
}

function build(root) {
  const s = get();
  const mins = minutesToday();
  const goal = s.settings.dailyGoalMin;
  const due = dueCards().length;
  const item = dailyItem();
  const checked = hasCheckedInToday();
  const streak = displayStreak();
  const status = todayStatus(mins, goal, streak, checked);
  const now = new Date();

  // ---------- 左栏 ----------
  const clock = h('div', { class: 'clock' }, '--:--');
  const dateLine = h('div', { class: 'eyebrow' },
    `${now.getMonth() + 1}月${now.getDate()}日 · 星期${'日一二三四五六'[now.getDay()]}`);
  const statusLine = h('div', { class: 'status-line ' + status.cls },
    h('span', { class: 'status-dot' }), h('span', {}, status.text));
  const hero = h('div', { class: 'hero' }, dateLine, clock, statusLine);

  const streakTile = h('div', { class: 'tile glass streak ' + (checked ? 'done' : status.cls === 'risk' ? 'risk' : '') },
    h('div', { class: 'tile-head' }, icon('flame', 18), '连续打卡'),
    h('div', { class: 'tile-num' }, String(streak), h('small', {}, '天')),
    h('div', { class: 'tile-foot' }, `最佳纪录 ${s.profile.bestStreak} 天`));

  const todayTile = h('div', { class: 'tile glass' },
    h('div', { class: 'tile-head' }, icon('timer', 18), '今日目标'),
    h('div', { class: 'ring-box' },
      ring(goal ? mins / goal : 0, String(mins)),
      h('div', { class: 'ring-meta' }, h('b', {}, `/ ${goal} 分`), mins >= goal ? '已达标' : `还差 ${goal - mins}`)));

  const xpIn = s.profile.xp % 100;
  const bar = h('div', { class: 'xp-bar' }, h('i', { style: `width:${xpIn}%` }));
  const levelTile = h('div', { class: 'tile glass level' },
    h('div', { class: 'tile-head' }, icon('sparkle', 18), '等级'),
    h('div', { class: 'tile-num' }, `Lv.${s.profile.level}`),
    bar,
    h('div', { class: 'tile-foot' }, `再 ${100 - xpIn} XP 升级`));

  const week = last7Days();
  const max = Math.max(goal, ...week.map(d => d.minutes));
  const weekTotal = week.reduce((a, d) => a + d.minutes, 0);
  const weekCard = h('div', { class: 'week glass' },
    h('div', { class: 'week-top' }, h('div', { class: 'eyebrow' }, '近 7 天'), h('span', {}, `共 ${weekTotal} 分钟`)),
    h('div', { class: 'week-bars' },
      ...week.map((d, i) => {
        const col = h('div', { class: 'col' + (d.minutes >= goal ? ' full' : d.minutes > 0 ? ' some' : '') });
        col.style.height = d.minutes === 0 ? '6px' : `${Math.max(14, Math.round((d.minutes / max) * 100))}%`;
        return h('div', { class: 'wb' + (i === week.length - 1 ? ' today' : ''), title: `${d.day}: ${d.minutes} 分钟` },
          col, h('span', { class: 'dow' }, i === week.length - 1 ? '今' : d.dow));
      })));

  const left = h('div', { class: 'sb-col sb-left' },
    hero, h('div', { class: 'tiles' }, streakTile, todayTile, levelTile), weekCard);

  // ---------- 右栏 ----------
  const reveal = h('div', { class: 'reveal hidden' }, item.zh, item.note ? h('span', { class: 'note' }, item.note) : null);
  const hint = h('div', { class: 'daily-hint' }, icon('eye', 16), '先想想意思，轻点卡片揭晓');
  const speakBtn = h('button', {
    class: 'icon-btn', 'aria-label': '听发音',
    onclick: (e) => { e.stopPropagation(); ttsAvailable() ? speak(item.en) : toast('当前无可用英文语音'); },
  }, icon('volume', 20));
  const daily = h('div', { class: 'daily' },
    h('div', { class: 'daily-top' }, h('span', { class: 'chip violet' }, icon('sparkle', 14), '每日一句'), speakBtn),
    h('div', { class: 'en' }, item.en), reveal, hint);
  daily.addEventListener('click', () => {
    const hidden = reveal.classList.toggle('hidden');
    hint.style.visibility = hidden ? 'visible' : 'hidden';
  });

  const dueRow = h('div', { class: 'due-row glass' + (due ? '' : ' clear'), onclick: () => location.hash = '#micro' },
    h('div', { class: 'due-ico' }, icon(due ? 'cards' : 'check', 20)),
    h('div', { class: 'due-txt' },
      due ? `${due} 张卡片待复习` : '今日复习已清空',
      h('small', {}, due ? '间隔复习 · 在碎片练习里完成' : '新卡会按记忆曲线自动安排')),
    icon('arrowRight', 18, 'arrow'));

  const cta = (cls, ico, title, sub, hash) =>
    h('button', { class: 'cta ' + cls, onclick: () => location.hash = hash },
      h('span', { class: 'cta-ico' }, icon(ico, 28)),
      h('span', { class: 'cta-txt' }, h('b', {}, title), h('span', {}, sub)),
      icon('arrowRight', 24));

  const right = h('div', { class: 'sb-col' },
    daily, dueRow,
    cta('go', 'play', '开始 5 分钟', '回忆卡 · 跟读 · 快答', '#micro'),
    cta('deep', 'target', '专注 25 分钟', '听力 → 跟读 → 积累 → 输出', '#focus'));

  // 备份提醒：每 7 天最多提示一次
  const last = s.settings.lastBackupHint;
  if (!last || (Date.now() - new Date(last).getTime()) > 7 * 864e5) {
    right.append(h('a', { class: 'backup-hint', href: '#settings' }, icon('download', 15),
      '建议去设置导出一次备份，防止浏览器清空本地数据'));
  }

  const wrap = h('div', { class: 'standby' }, left, right);
  root.append(wrap);

  const tick = () => {
    const n = new Date();
    clock.textContent = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  };
  tick();
  return { tick, key: stateKey() };
}

/** 状态指纹：变化时重绘（跨日、进入晚间提醒、剩余小时变化） */
function stateKey() {
  const s = get();
  const st = todayStatus(minutesToday(), s.settings.dailyGoalMin, displayStreak(), hasCheckedInToday());
  return `${studyDay()}|${st.cls}|${st.text}`;
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
