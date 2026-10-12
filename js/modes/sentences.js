// sentences.js — 日常用句模式：按生活场景浏览 1200+ 条常用句子
// 左：绿色句子卡（英文大字 + 点击揭晓中文 + 朗读 / 慢速 + 会了 / 稍后复习）；右：当前场景的句子列表
// 句库约 150 KB，进入本页时才按需加载
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { AdvanceClock } from '../auto-advance.js';
import { get, update, addXP } from '../store.js';
import { addCard } from '../srs.js';
import { speak, stopSpeak, ttsAvailable, prefetch, staticAudioReady } from '../tts.js';

let DATA = null; // { SCENES, SENTENCES }
const say = (text, opts) => ttsAvailable() ? speak(text, opts) : toast('No English voice available');

/** 英文字号随长度自动调整，长句也能完整显示 */
const sizeFor = (t) => (t.length <= 28 ? 3.4 : t.length <= 48 ? 2.8 : t.length <= 70 ? 2.3 : 1.9);

export function renderSentences(root) {
  let scene = get().sentences.scene || 'all';
  let list = [];
  let pos = 0;
  let revealed = false;
  let alive = true;
  let viewRevision = 0;
  const autoSec = get().settings.sentenceAutoSec ?? 45;
  const advance = new AdvanceClock(autoSec, performance.now(), !document.hidden);
  let progressFill = null;
  const countdown = h('span', { class: 'chip' });
  const pauseButton = h('button', {
    type: 'button', class: 'btn sm ghost', ...(autoSec ? {} : { disabled: '' }),
    onclick: () => {
      advance.setPaused(performance.now(), !advance.paused);
      pauseButton.textContent = advance.paused ? 'Resume auto' : 'Pause auto';
      updateCountdown();
    },
  }, 'Pause auto');
  if (autoSec) pauseButton.removeAttribute('disabled');
  function updateCountdown() {
    countdown.textContent = autoSec === 0 ? 'Auto: off'
      : `${advance.paused ? 'Paused' : 'Next in'} ${Math.ceil(advance.remaining / 1000)} s`;
    if (progressFill) progressFill.style.width = `${autoSec ? (1 - advance.remaining / advance.duration) * 100 : 0}%`;
  }

  const sub = h('div', { class: 'sub' }, 'Loading sentences…');
  const head = h('div', { class: 'mode-head' },
    h('div', {}, h('h1', {}, icon('chat', 24), 'Daily Sentences'), sub),
    h('div', { class: 'btn-group' }, countdown, pauseButton));
  const chips = h('div', { class: 'sn-chips' });
  const body = h('div', { class: 'wm-body sn-body' });
  const wrap = h('div', { class: 'word-mode' }, head, chips, body);
  root.append(wrap);

  const known = () => new Set(get().sentences.known);

  function setList() {
    list = scene === 'all' ? DATA.SENTENCES : DATA.SENTENCES.filter(s => s.scene === scene);
    const saved = get().sentences.pos[scene] || 0;
    pos = Math.min(Math.max(0, saved), Math.max(0, list.length - 1));
  }

  function paintChips() {
    chips.innerHTML = '';
    const k = known();
    const mk = (id, name, items) => {
      const done = items.filter(s => k.has(s.id)).length;
      const b = h('button', { class: 'sn-chip' + (scene === id ? ' on' : ''), onclick: () => switchScene(id) },
        name, h('small', {}, `${done}/${items.length}`));
      return b;
    };
    chips.append(mk('all', 'All', DATA.SENTENCES));
    for (const [id, name] of DATA.SCENES) chips.append(mk(id, name, DATA.SENTENCES.filter(s => s.scene === id)));
    const on = chips.querySelector('.on');
    if (on) requestAnimationFrame(() => { chips.scrollLeft = Math.max(0, on.offsetLeft - chips.offsetLeft - 24); });
  }

  function switchScene(id) {
    stopSpeak();
    scene = id;
    update(s => { s.sentences.scene = id; });
    setList();
    paintChips();
    paint(true);
  }

  function save() { update(s => { s.sentences.pos[scene] = pos; }); }

  function go(n, auto = true) {
    if (!list.length) return;
    stopSpeak();
    pos = (n + list.length) % list.length;
    save();
    paint(auto);
  }

  function paint(autoPlay) {
    const revision = ++viewRevision;
    advance.reset(performance.now());
    progressFill = h('i', {});
    updateCountdown();
    body.innerHTML = '';
    revealed = false;
    const k = known();
    sub.textContent = list.length
      ? `${scene === 'all' ? 'All scenes' : DATA.SCENES.find(x => x[0] === scene)?.[1]} · ${pos + 1} of ${list.length} · ${[...k].length} known overall`
      : 'No sentences';
    if (!list.length) return;
    const s = list[pos];
    const sceneName = DATA.SCENES.find(x => x[0] === s.scene)?.[1] || '';

    // ---------- 左：句子卡 ----------
    const zh = h('div', { class: 'sn-zh reveal-hidden' }, s.zh);
    const note = s.note ? h('div', { class: 'sn-note', style: 'display:none' }, s.note) : null;
    const revealBtn = h('button', { class: 'sn-pill light' }, icon('eye', 16), 'Reveal');
    const toggle = () => {
      revealed = !revealed;
      zh.classList.toggle('reveal-hidden', !revealed);
      if (note) note.style.display = revealed ? 'block' : 'none';
      revealBtn.replaceChildren(icon(revealed ? 'eyeOff' : 'eye', 16), revealed ? 'Hide' : 'Reveal');
    };
    revealBtn.addEventListener('click', toggle);
    zh.addEventListener('click', toggle);

    const isKnown = k.has(s.id);
    const knownBtn = h('button', {
      class: 'wm-pill' + (isKnown ? ' on' : ''), onclick: () => {
        const was = get().sentences.known.includes(s.id);
        update(st => {
          st.sentences.known = was ? st.sentences.known.filter(x => x !== s.id) : [...st.sentences.known, s.id];
        });
        if (!was) { addXP(1); toast('Marked as known'); }
        paintChips();
        if (!was) go(pos + 1); else paint(false);
      },
    }, icon('check', 16), isKnown ? 'Known ✓' : 'Got it');
    const laterBtn = h('button', {
      class: 'wm-pill', onclick: () => {
        const added = addCard(s.en, s.zh, '');
        toast(added ? 'Added to your review deck' : 'Already in your review deck');
      },
    }, icon('undo', 16), 'Review later');

    const hero = h('section', { class: 'wm-hero glass sn-hero' },
      h('div', { class: 'sn-top' },
        h('span', { class: 'sn-scene' }, sceneName),
        h('div', { class: 'wm-pills' }, laterBtn, h('span', { class: 'wm-sep' }), knownBtn)),
      h('div', { class: 'sn-en', style: `font-size:${sizeFor(s.en)}rem` }, s.en),
      zh, note,
      h('div', { class: 'sn-actions' },
        h('button', { class: 'sn-pill light', onclick: () => say(s.en) }, icon('volume', 16), 'Listen'),
        h('button', { class: 'sn-pill', onclick: () => say(s.en, { rate: 0.7 }) }, icon('gauge', 16), 'Slow'),
        revealBtn),
      h('div', { class: 'sn-src' }, s.src ? `Source: Tatoeba #${s.src} · CC BY 2.0 FR` : 'Source: original'),
      h('div', { class: 'wm-spacer' }),
      h('div', { class: 'sn-nav' },
        h('button', { class: 'sn-prev', 'aria-label': 'Previous', onclick: () => go(pos - 1) }, icon('arrowRight', 22)),
        h('button', { class: 'wm-next', onclick: () => go(pos + 1) }, 'Next', icon('arrowRight', 22),
          autoSec ? h('span', { class: 'wm-auto' }, progressFill) : null)));

    // ---------- 右：当前场景的句子列表 ----------
    const items = list.map((x, i) => h('button', {
      class: 'sn-item' + (i === pos ? ' on' : '') + (k.has(x.id) ? ' done' : ''), 'data-i': i,
      onclick: () => go(i),
    }, h('span', { class: 'idx' }, k.has(x.id) ? icon('check', 13) : String(i + 1)), h('span', { class: 'txt' }, x.en)));
    const listCard = h('section', { class: 'wm-card glass sn-list' },
      h('div', { class: 'wm-card-head' }, h('span', { class: 'wm-label' }, `IN THIS SCENE · ${list.length}`)),
      h('div', { class: 'sn-items' }, ...items));
    body.append(hero, listCard);
    const cur = listCard.querySelector('.sn-item.on');
    // 让当前句子大致居中；位置靠前时从列表顶部开始显示
    if (cur) requestAnimationFrame(() => {
      const box = cur.parentElement;
      box.scrollTop = Math.max(0, cur.offsetTop - cur.parentElement.offsetTop - box.clientHeight / 2 + cur.offsetHeight / 2);
    });

    // 预生成：当前句 + 后面两句（都是随站点发布的音频文件，不耗额度）
    prefetch([s.en, list[(pos + 1) % list.length].en, list[(pos + 2) % list.length].en], { replace: true });
    if (autoPlay && get().settings.wordAutoPlay !== false) {
      staticAudioReady.then(() => setTimeout(() => {
        if (alive && revision === viewRevision && !document.hidden) speak(s.en, { auto: true });
      }, 250));
    }
  }

  const onKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(pos + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(pos - 1); }
    else if (e.key === ' ') { e.preventDefault(); body.querySelector('.sn-actions .sn-pill')?.click(); }
  };
  document.addEventListener('keydown', onKey);
  const resetCountdown = () => { advance.reset(performance.now()); updateCountdown(); };
  const onVisibility = () => {
    advance.setVisible(performance.now(), !document.hidden);
    if (document.hidden) { viewRevision++; stopSpeak(); }
    updateCountdown();
  };
  wrap.addEventListener('pointerdown', resetCountdown);
  wrap.addEventListener('wheel', resetCountdown, { passive: true });
  document.addEventListener('keydown', resetCountdown);
  document.addEventListener('visibilitychange', onVisibility);
  const advanceInterval = setInterval(() => {
    if (!list.length) { advance.reset(performance.now()); return; }
    if (advance.tick(performance.now())) go(pos + 1);
    updateCountdown();
  }, 250);
  updateCountdown();

  import('../sentences.js')
    .then(m => {
      DATA = m;
      if (!alive) return;
      if (scene !== 'all' && !DATA.SCENES.some(x => x[0] === scene)) scene = 'all';
      setList();
      paintChips();
      paint(false); // 刚进入页面不自动出声（浏览器通常要求先有一次触摸）
    })
    .catch(e => { sub.textContent = 'Could not load sentences: ' + e.message; });

  return () => {
    alive = false; viewRevision++; clearInterval(advanceInterval); stopSpeak();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keydown', resetCountdown);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
