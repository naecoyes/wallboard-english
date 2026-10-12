// micro.js — 碎片模式：1–5 分钟主动练习（回忆 / 跟读 / 快答）
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { addXP, logSession } from '../store.js';
import { nextDueCard, reviewCard } from '../srs.js';
import { DAILY, PASSAGES, QUICK_QUESTIONS } from '../content.js';
import { speak, stopSpeak, ttsAvailable } from '../tts.js';
import { studyDay } from '../streak.js';

let session = null; // { startedAt, tasksDone, lastCardId, ... }

function rand(arr, exclude) {
  if (arr.length <= 1) return arr[0];
  let item;
  do { item = arr[Math.floor(Math.random() * arr.length)]; } while (item === exclude);
  return item;
}

function dailyItem() {
  const ds = studyDay();
  let hash = 0;
  for (const ch of ds) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return DAILY[hash % DAILY.length];
}

const say = (text, opts) => ttsAvailable() ? speak(text, opts) : toast('当前无可用英文语音');

function taskCard(chipCls, chipIcon, chipText, sub, ...children) {
  return h('div', { class: 'task-card glass' },
    h('span', { class: 'chip ' + chipCls }, icon(chipIcon, 15), chipText),
    h('p', { class: 'task-sub' }, sub),
    ...children);
}

// ---------- 三种任务 ----------
function recallTask(root, next) {
  const card = nextDueCard(session.lastCardId);
  const item = card || dailyItem(); // 没有到期卡时复习每日一句
  const front = card ? card.front : item.en;
  const backText = card ? card.back : item.zh;
  const example = card ? card.example : item.note;

  const answer = h('div', { class: 'answer', style: 'display:none' },
    h('div', {}, backText),
    example ? h('div', { class: 'ex' }, example) : null);

  let graded = false;
  const grade = (q) => {
    if (graded) return; graded = true;
    if (card) reviewCard(card.id, q);
    addXP(5); toast('+5 XP');
    session.tasksDone++;
    session.lastCardId = card ? card.id : session.lastCardId;
    next();
  };
  const gradeRow = h('div', { class: 'grade-row', style: 'display:none' },
    h('button', { class: 'grade g0', onclick: () => grade(0) }, icon('undo', 22), '忘了', h('small', {}, '明天再来')),
    h('button', { class: 'grade g1', onclick: () => grade(1) }, icon('help', 22), '模糊', h('small', {}, '稍短间隔')),
    h('button', { class: 'grade g2', onclick: () => grade(2) }, icon('check', 22), '认识', h('small', {}, '间隔拉长')));

  const hint = h('div', { class: 'tap-hint' }, icon('eye', 16), '轻点英文揭晓答案');
  const prompt = h('div', { class: 'prompt tappable' }, front);
  const showAnswer = () => {
    answer.style.display = 'block';
    gradeRow.style.display = 'grid';
    hint.style.display = 'none';
    actions.style.display = 'none';
  };
  prompt.addEventListener('click', showAnswer);
  const actions = h('div', { class: 'btn-row' },
    h('button', { class: 'btn', onclick: () => say(front) }, icon('volume', 18), '听发音'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn ghost', onclick: showAnswer }, icon('eye', 18), '揭晓'));

  root.append(taskCard('violet', 'cards', card ? '回忆卡 · 间隔复习' : '回忆 · 每日一句',
    '先在心里说出中文意思，再试着用它造一个句子', prompt, hint, answer, gradeRow, actions));
}

function shadowTask(root, next) {
  const passage = rand(PASSAGES, session.lastPassage);
  session.lastPassage = passage;
  const sentence = rand(passage.sentences, session.lastSentence);
  session.lastSentence = sentence;

  let done = false;
  root.append(taskCard('sky', 'repeat', '跟读一句',
    `选自「${passage.title}」· 先听一遍，再大声跟读，可以反复播放`,
    h('div', { class: 'prompt' }, sentence),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn blue', onclick: () => say(sentence) }, icon('volume', 18), '播放'),
      h('button', { class: 'btn', onclick: () => say(sentence, { rate: 0.7 }) }, icon('gauge', 18), '慢速 0.7×'),
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'btn primary', onclick: () => {
          if (done) return; done = true;
          addXP(5); toast('+5 XP'); session.tasksDone++; next();
        },
      }, icon('check', 18), '跟读完成'))));
}

function quickTask(root, next) {
  const q = rand(QUICK_QUESTIONS, session.lastQuestion);
  session.lastQuestion = q;
  let done = false;
  root.append(taskCard('amber', 'chat', '快答', '用英语口头回答，说 2–3 句就够，不必完美',
    h('div', { class: 'prompt' }, q),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => say(q) }, icon('volume', 18), '听问题'),
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'btn primary', onclick: () => {
          if (done) return; done = true;
          addXP(5); toast('+5 XP'); session.tasksDone++; next();
        },
      }, icon('check', 18), '答完了'))));
}

// ---------- 模式入口 ----------
export function renderMicro(root) {
  session = { startedAt: Date.now(), tasksDone: 0, lastCardId: null, lastPassage: null, lastSentence: null, lastQuestion: null };
  const TASKS = [recallTask, shadowTask, recallTask, quickTask, shadowTask];
  let taskIndex = Math.floor(Math.random() * TASKS.length);

  const container = h('div', {});
  const sub = h('div', { class: 'sub' }, '');
  const head = h('div', { class: 'mode-head' },
    h('div', {}, h('h1', {}, icon('zap', 24), '碎片练习'), sub),
    h('div', { class: 'btn-group' },
      h('button', { class: 'btn sm', onclick: () => next() }, '换一个', icon('arrowRight', 16)),
      h('button', { class: 'btn sm ghost', onclick: endSession }, icon('x', 16), '结束本轮')));

  root.append(h('div', { class: 'mode-wrap center' }, head, container));

  function updateStatus() {
    const elapsed = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));
    sub.textContent = `本轮已完成 ${session.tasksDone} 个小任务 · 约 ${elapsed} 分钟 · 每个任务 +5 XP`;
  }

  function next() {
    stopSpeak();
    session.lastActive = Date.now();
    container.innerHTML = '';
    updateStatus();
    taskIndex = (taskIndex + 1) % TASKS.length;
    TASKS[taskIndex](container, next);
  }

  let saved = false;
  function save() {
    if (saved || session.tasksDone === 0) return false;
    saved = true;
    // 按实际活跃时长计（最多到最后一次操作），避免闲置时间被算进去
    const minutes = Math.max(1, Math.round((session.lastActive - session.startedAt) / 60000));
    logSession('micro', minutes, `${session.tasksDone} 个小任务`);
    return minutes;
  }

  function endSession() {
    stopSpeak();
    const minutes = save();
    if (minutes) toast(`本轮 ${session.tasksDone} 个任务 · ${minutes} 分钟`);
    location.hash = '#standby';
  }

  next();
  // 被闲置跳转或切到其他页面时，也把已完成的任务记下来
  return () => { stopSpeak(); save(); };
}
