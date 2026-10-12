// focus.js — 专注模式：25 分钟主线任务向导
// 流程：听力理解 → 逐句跟读 → 表达积累 → 口语输出 → 记录结果
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { addXP, logSession } from '../store.js';
import { addCard } from '../srs.js';
import { checkIn, studyDay } from '../streak.js';
import { PASSAGES } from '../content.js';
import { speak, stopSpeak, ttsAvailable } from '../tts.js';

const TOTAL_SEC = 25 * 60;
const STEPS = ['听力理解', '逐句跟读', '表达积累', '口语输出', '记录结果'];

function todayPassage() {
  const ds = studyDay();
  let hash = 0;
  for (const ch of ds) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PASSAGES[hash % PASSAGES.length];
}

const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

export function renderFocus(root) {
  const passage = todayPassage();
  let step = 0;
  let remaining = TOTAL_SEC;
  let timerOn = false;
  let done = false;
  let added = 0;
  const startedAt = Date.now();

  // ---------- 横屏：左侧栏（计时 + 竖向步骤条）+ 右侧内容；竖屏由 CSS 改为上下排列 ----------
  const stepper = h('div', { class: 'stepper glass' });
  const timerEl = h('div', { class: 'timer' }, fmt(TOTAL_SEC));
  const barFill = h('i', { style: 'width:0%' });
  const timerPill = h('div', { class: 'timer-pill glass' },
    h('div', { class: 'timer-row' }, icon('timer', 16), '专注计时'),
    timerEl,
    h('div', { class: 'timer-bar' }, barFill));
  const sideNote = h('div', { class: 'side-note glass' }, '今日短文', h('b', {}, passage.title));
  const body = h('div', { class: 'focus-main' });

  root.append(h('div', { class: 'focus-layout' },
    h('aside', { class: 'focus-side' }, timerPill, stepper, sideNote), body));

  function paintStepper() {
    stepper.innerHTML = '';
    STEPS.forEach((label, i) => {
      if (i > 0) stepper.append(h('div', { class: 'st-line' + (i <= step ? ' done' : '') }));
      const cls = i === step ? 'on' : i < step ? 'done' : '';
      stepper.append(h('div', { class: 'st ' + cls },
        h('span', { class: 'n' }, i < step ? icon('check', 14) : String(i + 1)),
        h('span', { class: 'lbl' }, label)));
    });
  }

  const iv = setInterval(() => {
    if (!timerOn || done) return;
    remaining = Math.max(0, remaining - 1);
    timerEl.textContent = fmt(remaining);
    barFill.style.width = `${((TOTAL_SEC - remaining) / TOTAL_SEC) * 100}%`;
    if (remaining === 0) {
      timerOn = false;
      timerPill.classList.add('over');
      timerEl.textContent = '时间到';
      toast('25 分钟到，去记录结果吧');
    }
  }, 1000);

  const say = (text, opts) => ttsAvailable() ? speak(text, opts) : toast('当前无可用英文语音');
  const go = (n) => { step = n; renderStep(); };

  function card(chipCls, chipIcon, chipText, sub, ...children) {
    return h('div', { class: 'task-card glass' },
      h('span', { class: 'chip ' + chipCls }, icon(chipIcon, 15), chipText),
      h('p', { class: 'task-sub' }, sub),
      ...children);
  }

  function navRow(nextLabel, onNext, extra = []) {
    return h('div', { class: 'btn-row' },
      ...extra,
      h('span', { class: 'spacer' }),
      step > 0 && step < 4 ? h('button', { class: 'btn ghost', onclick: () => go(step - 1) }, '上一步') : null,
      onNext ? h('button', { class: 'btn primary', onclick: onNext }, nextLabel, icon('arrowRight', 18)) : null);
  }

  function renderStep() {
    stopSpeak();
    body.innerHTML = '';
    body.scrollTop = 0;
    paintStepper();

    if (step === 0) { // 听力理解
      const textBlock = h('div', { class: 'passage-text', style: 'display:none' },
        ...passage.sentences.map(s => h('p', {}, s)));
      const toggle = h('button', {
        class: 'btn', onclick: () => {
          const hidden = textBlock.style.display === 'none';
          textBlock.style.display = hidden ? 'flex' : 'none';
          toggle.replaceChildren(icon(hidden ? 'eyeOff' : 'eye', 18), hidden ? '收起文本' : '看文本');
        },
      }, icon('eye', 18), '看文本');
      body.append(card('sky', 'headphones', '第 1 步 · 听力理解',
        '先只听不看，抓住大意；听完再点开文本对照',
        h('div', { class: 'prompt' }, passage.title),
        textBlock,
        navRow('逐句跟读', () => go(1), [
          h('button', { class: 'btn blue', onclick: () => say(passage.sentences.join(' ')) }, icon('play', 18), '播放整段'),
          h('button', { class: 'btn', onclick: () => say(passage.sentences.join(' '), { rate: 0.7 }) }, icon('gauge', 18), '慢速'),
          toggle,
        ])));
    }

    if (step === 1) { // 逐句跟读
      body.append(card('sky', 'repeat', '第 2 步 · 逐句跟读',
        '每句播放后大声跟读，模仿语音语调和停顿',
        h('div', { class: 'lines' },
          ...passage.sentences.map((s, i) =>
            h('div', { class: 'line-item' },
              h('span', { class: 'idx' }, String(i + 1)),
              h('span', { class: 'txt' }, s),
              h('button', { class: 'icon-btn', 'aria-label': '播放', onclick: () => say(s) }, icon('volume', 20))))),
        navRow('表达积累', () => go(2))));
    }

    if (step === 2) { // 表达积累
      body.append(card('violet', 'cards', '第 3 步 · 表达积累',
        '把实用短语加入复习卡组，之后会按记忆曲线自动安排复习',
        h('div', { class: 'lines' },
          ...passage.phrases.map(p => {
            const btn = h('button', {
              class: 'btn sm add-btn', onclick: () => {
                const ok = addCard(p.en, p.zh, `选自「${passage.title}」`);
                if (ok) added++;
                btn.replaceChildren(icon('check', 16), ok ? '已加入' : '已在卡组');
                btn.classList.add('added');
                btn.disabled = true;
              },
            }, icon('plus', 16), '加入卡组');
            return h('div', { class: 'line-item' },
              h('span', { class: 'txt' }, p.en, h('small', {}, p.zh)),
              h('button', { class: 'icon-btn', 'aria-label': '播放', onclick: () => say(p.en) }, icon('volume', 20)),
              btn);
          })),
        navRow('口语输出', () => go(3))));
    }

    if (step === 3) { // 口语输出
      body.append(card('amber', 'mic', '第 4 步 · 口语输出',
        '用英语口头回答下面的问题，尽量用上今天积累的短语',
        h('div', { class: 'prompt' }, passage.question),
        h('div', { class: 'hint-phrases' },
          h('span', { class: 'lbl' }, '可以用：'),
          ...passage.phrases.map(p => h('span', { class: 'chip' }, p.en))),
        navRow('记录结果', () => go(4), [
          h('button', { class: 'btn', onclick: () => say(passage.question) }, icon('volume', 18), '听问题'),
        ])));
    }

    if (step === 4) { // 记录结果
      timerOn = false;
      const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
      const pick = (val) => {
        if (done) return; done = true;
        logSession('focus', minutes, val);
        const { streak } = checkIn();
        addXP(30);
        toast(`+30 XP · 连续 ${streak} 天`);
        setTimeout(() => location.hash = '#standby', 1300);
      };
      body.append(card('green', 'flag', '第 5 步 · 记录结果',
        '自评一下今天的状态，完成后自动打卡',
        h('div', { class: 'summary' },
          h('span', { class: 'chip' }, icon('timer', 14), `专注约 ${minutes} 分钟`),
          h('span', { class: 'chip' }, icon('book', 14), passage.title),
          h('span', { class: 'chip' }, icon('cards', 14), `新增 ${added} 张卡片`)),
        h('div', { class: 'choices' },
          ...[['😣', '有点吃力'], ['🙂', '基本完成'], ['😄', '状态很好']].map(([face, val]) =>
            h('button', { class: 'choice', onclick: () => pick(val) }, h('span', { class: 'face' }, face), val)))));
    }
  }

  // 进入专注模式即开始倒计时
  timerOn = true;
  renderStep();

  return () => { clearInterval(iv); stopSpeak(); };
}
