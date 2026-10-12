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

const say = (text, opts) => ttsAvailable() ? speak(text, opts) : toast('No English voice available');

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
    h('button', { class: 'grade g0', onclick: () => grade(0) }, icon('undo', 22), 'Forgot', h('small', {}, 'See it tomorrow')),
    h('button', { class: 'grade g1', onclick: () => grade(1) }, icon('help', 22), 'Unsure', h('small', {}, 'Shorter gap')),
    h('button', { class: 'grade g2', onclick: () => grade(2) }, icon('check', 22), 'Knew it', h('small', {}, 'Longer gap')));

  const hint = h('div', { class: 'tap-hint' }, icon('eye', 16), 'Tap the English to reveal the answer');
  const prompt = h('div', { class: 'prompt tappable' }, front);
  const showAnswer = () => {
    answer.style.display = 'block';
    gradeRow.style.display = 'grid';
    hint.style.display = 'none';
    actions.style.display = 'none';
  };
  prompt.addEventListener('click', showAnswer);
  const actions = h('div', { class: 'btn-row' },
    h('button', { class: 'btn', onclick: () => say(front) }, icon('volume', 18), 'Listen'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn ghost', onclick: showAnswer }, icon('eye', 18), 'Reveal'));

  root.append(taskCard('violet', 'cards', card ? 'Recall · spaced review' : 'Recall · phrase of the day',
    'Say the meaning to yourself, then try using it in a sentence', prompt, hint, answer, gradeRow, actions));
}

function shadowTask(root, next) {
  const passage = rand(PASSAGES, session.lastPassage);
  session.lastPassage = passage;
  const sentence = rand(passage.sentences, session.lastSentence);
  session.lastSentence = sentence;

  let done = false;
  root.append(taskCard('sky', 'repeat', 'Shadow one line',
    `From “${passage.title}” · listen first, then say it out loud — replay as often as you like`,
    h('div', { class: 'prompt' }, sentence),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn blue', onclick: () => say(sentence) }, icon('volume', 18), 'Play'),
      h('button', { class: 'btn', onclick: () => say(sentence, { rate: 0.7 }) }, icon('gauge', 18), 'Slow 0.7×'),
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'btn primary', onclick: () => {
          if (done) return; done = true;
          addXP(5); toast('+5 XP'); session.tasksDone++; next();
        },
      }, icon('check', 18), 'Done shadowing'))));
}

function quickTask(root, next) {
  const q = rand(QUICK_QUESTIONS, session.lastQuestion);
  session.lastQuestion = q;
  let done = false;
  root.append(taskCard('amber', 'chat', 'Quick answer', 'Answer out loud in English — 2–3 sentences, no need to be perfect',
    h('div', { class: 'prompt' }, q),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => say(q) }, icon('volume', 18), 'Hear question'),
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'btn primary', onclick: () => {
          if (done) return; done = true;
          addXP(5); toast('+5 XP'); session.tasksDone++; next();
        },
      }, icon('check', 18), 'I answered'))));
}

// ---------- 模式入口 ----------
export function renderMicro(root) {
  session = { startedAt: Date.now(), tasksDone: 0, lastCardId: null, lastPassage: null, lastSentence: null, lastQuestion: null };
  const TASKS = [recallTask, shadowTask, recallTask, quickTask, shadowTask];
  let taskIndex = Math.floor(Math.random() * TASKS.length);

  const container = h('div', {});
  const sub = h('div', { class: 'sub' }, '');
  const head = h('div', { class: 'mode-head' },
    h('div', {}, h('h1', {}, icon('zap', 24), 'Quick practice'), sub),
    h('div', { class: 'btn-group' },
      h('button', { class: 'btn sm', onclick: () => next() }, 'Skip', icon('arrowRight', 16)),
      h('button', { class: 'btn sm ghost', onclick: endSession }, icon('x', 16), 'End session')));

  root.append(h('div', { class: 'mode-wrap center' }, head, container));

  function updateStatus() {
    const elapsed = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));
    sub.textContent = `${session.tasksDone} task${session.tasksDone === 1 ? '' : 's'} done · about ${elapsed} min · +5 XP each`;
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
    logSession('micro', minutes, `${session.tasksDone} tasks`);
    return minutes;
  }

  function endSession() {
    stopSpeak();
    const minutes = save();
    if (minutes) toast(`${session.tasksDone} tasks · ${minutes} min this session`);
    location.hash = '#standby';
  }

  next();
  // 被闲置跳转或切到其他页面时，也把已完成的任务记下来
  return () => { stopSpeak(); save(); };
}
