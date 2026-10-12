import { studySeconds, formatStudyTime, pauseStudyTimer, finishStudyResult } from '../study-timer.js';
// focus.js — 专注模式：25 分钟主线任务向导
// 流程：听力理解 → 逐句跟读 → 表达积累 → 口语输出 → 记录结果
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { addXP } from '../store.js';
import { addCard } from '../srs.js';
import { checkIn, studyDay } from '../streak.js';
import { PASSAGES } from '../content.js';
import { speak, stopSpeak, ttsAvailable, prefetch } from '../tts.js';

const TOTAL_SEC = 25 * 60;
const STEPS = ['Listening', 'Shadowing', 'Phrases', 'Speaking', 'Wrap-up'];

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
  let manualPause = false;

  // ---------- 横屏：左侧栏（计时 + 竖向步骤条）+ 右侧内容；竖屏由 CSS 改为上下排列 ----------
  const stepper = h('div', { class: 'stepper glass' });
  const timerEl = h('div', { class: 'timer' }, fmt(TOTAL_SEC));
  const barFill = h('i', { style: 'width:0%' });
  const timerPill = h('div', { class: 'timer-pill glass' },
    h('div', { class: 'timer-row' }, icon('timer', 16), 'FOCUS TIMER'),
    timerEl,
    h('div', { class: 'timer-bar' }, barFill));
  const pauseButton = h('button', { class: 'btn sm', onclick: () => {
    manualPause = !manualPause;
    pauseStudyTimer(manualPause);
    pauseButton.textContent = manualPause ? 'Resume' : 'Pause';
  } }, 'Pause');
  timerPill.append(pauseButton);
  const sideNote = h('div', { class: 'side-note glass' }, "Today's passage", h('b', {}, passage.title));
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
    remaining = Math.max(0, TOTAL_SEC - Math.floor(studySeconds()));
    timerEl.textContent = fmt(remaining);
    barFill.style.width = `${((TOTAL_SEC - remaining) / TOTAL_SEC) * 100}%`;
    if (remaining === 0) {
      timerOn = false;
      pauseStudyTimer(true);
      timerPill.classList.add('over');
      timerEl.textContent = "Time's up";
      toast("25 minutes done — time to wrap up");
    }
  }, 1000);

  const say = (text, opts) => ttsAvailable() ? speak(text, opts) : toast('No English voice available');
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
      step > 0 && step < 4 ? h('button', { class: 'btn ghost', onclick: () => go(step - 1) }, 'Back') : null,
      onNext ? h('button', { class: 'btn primary', onclick: onNext }, nextLabel, icon('arrowRight', 18)) : null);
  }

  function renderStep() {
    stopSpeak();
    body.innerHTML = '';
    body.scrollTop = 0;
    paintStepper();
    // 预生成本步骤要朗读的内容（整段 / 逐句 / 短语 / 问题）
    prefetch(
      step === 0 ? [passage.sentences.join(' ')]
        : step === 1 ? passage.sentences
          : step === 2 ? passage.phrases.map(p => p.en)
            : step === 3 ? [passage.question] : [],
      { replace: true });

    if (step === 0) { // 听力理解
      const textBlock = h('div', { class: 'passage-text', style: 'display:none' },
        ...passage.sentences.map(s => h('p', {}, s)));
      const toggle = h('button', {
        class: 'btn', onclick: () => {
          const hidden = textBlock.style.display === 'none';
          textBlock.style.display = hidden ? 'flex' : 'none';
          toggle.replaceChildren(icon(hidden ? 'eyeOff' : 'eye', 18), hidden ? 'Hide text' : 'Show text');
        },
      }, icon('eye', 18), 'Show text');
      body.append(card('sky', 'headphones', 'Step 1 · Listening',
        'Listen without reading and catch the gist, then open the text to check.',
        h('div', { class: 'prompt' }, passage.title),
        textBlock,
        navRow('Shadowing', () => go(1), [
          h('button', { class: 'btn blue', onclick: () => say(passage.sentences.join(' ')) }, icon('play', 18), 'Play all'),
          h('button', { class: 'btn', onclick: () => say(passage.sentences.join(' '), { rate: 0.7 }) }, icon('gauge', 18), 'Slow'),
          toggle,
        ])));
    }

    if (step === 1) { // 逐句跟读
      body.append(card('sky', 'repeat', 'Step 2 · Shadowing',
        'Play each line, then say it out loud. Copy the intonation and pauses.',
        h('div', { class: 'lines' },
          ...passage.sentences.map((s, i) =>
            h('div', { class: 'line-item' },
              h('span', { class: 'idx' }, String(i + 1)),
              h('span', { class: 'txt' }, s),
              h('button', { class: 'icon-btn', 'aria-label': 'Play', onclick: () => say(s) }, icon('volume', 20))))),
        navRow('Phrases', () => go(2))));
    }

    if (step === 2) { // 表达积累
      body.append(card('violet', 'cards', 'Step 3 · Phrases',
        'Add useful phrases to your review deck — they come back on a spaced schedule.',
        h('div', { class: 'lines' },
          ...passage.phrases.map(p => {
            const btn = h('button', {
              class: 'btn sm add-btn', onclick: () => {
                const ok = addCard(p.en, p.zh, `From “${passage.title}”`);
                if (ok) added++;
                btn.replaceChildren(icon('check', 16), ok ? 'Added' : 'Already in deck');
                btn.classList.add('added');
                btn.disabled = true;
              },
            }, icon('plus', 16), 'Add to deck');
            return h('div', { class: 'line-item' },
              h('span', { class: 'txt' }, p.en, h('small', {}, p.zh)),
              h('button', { class: 'icon-btn', 'aria-label': 'Play', onclick: () => say(p.en) }, icon('volume', 20)),
              btn);
          })),
        navRow('Speaking', () => go(3))));
    }

    if (step === 3) { // 口语输出
      body.append(card('amber', 'mic', 'Step 4 · Speaking',
        "Answer the question out loud in English. Try to use today's phrases.",
        h('div', { class: 'prompt' }, passage.question),
        h('div', { class: 'hint-phrases' },
          h('span', { class: 'lbl' }, 'Try using:'),
          ...passage.phrases.map(p => h('span', { class: 'chip' }, p.en))),
        navRow('Wrap-up', () => go(4), [
          h('button', { class: 'btn', onclick: () => say(passage.question) }, icon('volume', 18), 'Hear question'),
        ])));
    }

    if (step === 4) { // 记录结果
      timerOn = false;
      pauseStudyTimer(true);
      pauseButton.disabled = true;
      const duration = formatStudyTime(studySeconds());
      const pick = (val) => {
        if (done) return; done = true;
        finishStudyResult(val);
        const { streak } = checkIn();
        addXP(30);
        toast(`+30 XP · ${streak}-day streak`);
        setTimeout(() => location.hash = '#standby', 1300);
      };
      body.append(card('green', 'flag', 'Step 5 · Wrap-up',
        'How did it go? Picking one checks you in for today.',
        h('div', { class: 'summary' },
          h('span', { class: 'chip' }, icon('timer', 14), `${duration} active`),
          h('span', { class: 'chip' }, icon('book', 14), passage.title),
          h('span', { class: 'chip' }, icon('cards', 14), `${added} new card${added === 1 ? '' : 's'}`)),
        h('div', { class: 'choices' },
          ...[['😣', 'Tough'], ['🙂', 'Got through it'], ['😄', 'Felt great']].map(([face, val]) =>
            h('button', { class: 'choice', onclick: () => pick(val) }, h('span', { class: 'face' }, face), val)))));
    }
  }

  // 进入专注模式即开始倒计时
  timerOn = true;
  renderStep();

  return () => { clearInterval(iv); stopSpeak(); };
}
