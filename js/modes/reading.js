// reading.js — 短文模式：VOA Learning English 文章，一屏一段
// 左：绿色段落卡（点句子朗读 / 点单词查词 + 中文揭晓 + Dean 朗读 / VOA 原声）；右：Words in This Story 词汇表
// 文章数据约 400 KB，进入本页时才按需加载
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { AdvanceClock } from '../auto-advance.js';
import { lookupFromEvent } from '../lookup.js';
import { attachSwipe } from '../swipe.js';
import { get, update, addXP } from '../store.js';
import { addCard } from '../srs.js';
import { speak, speakSequence, stopSpeak, ttsAvailable, prefetch } from '../tts.js';

let DATA = null; // { PASSAGE_CATS, PASSAGES }
const say = (text, opts) => ttsAvailable() ? speak(text, opts) : toast('No English voice available');

/** 段落字号随长度调整，长段也能完整显示 */
const sizeFor = (t) => (t.length <= 140 ? 2 : t.length <= 240 ? 1.7 : t.length <= 360 ? 1.45 : 1.25);

export function renderReading(root) {
  const rs = get().reading;
  let level = rs.level || 'all';
  let art = null;
  let pos = 0;
  let revealed = false;
  let alive = true;
  const autoSec = get().settings.readingAutoSec ?? 60;
  const advance = new AdvanceClock(autoSec, performance.now(), !document.hidden);
  let progressFill = null;

  // ---------- VOA 原声：整篇播放，翻段落时不中断，换文章 / 离开页面时停止 ----------
  const voa = new Audio();
  voa.preload = 'none';
  let voaBtn = null;
  const voaPlaying = () => !voa.paused && !voa.ended;
  const setVoaUi = () => {
    if (voaPlaying()) document.documentElement.dataset.speaking = '1';
    else delete document.documentElement.dataset.speaking;
    voaBtn?.replaceChildren(icon(voaPlaying() ? 'x' : 'headphones', 16), voaPlaying() ? 'Stop VOA' : 'VOA audio');
  };
  voa.addEventListener('play', setVoaUi);
  voa.addEventListener('pause', setVoaUi);
  voa.addEventListener('ended', () => { setVoaUi(); advance.reset(performance.now()); });
  voa.addEventListener('error', () => {
    if (!voa.getAttribute('src')) return;
    setVoaUi();
    if (!alive) return;
    toast('VOA audio unavailable — using Dean');
    readParagraph();
  });
  function stopVoa() {
    if (!voa.paused) voa.pause();
    setVoaUi();
  }
  function toggleVoa() {
    if (voaPlaying()) { stopVoa(); return; }
    stopSpeak();
    if (voa.getAttribute('src') !== art.audio) voa.src = art.audio;
    voa.play().catch(() => { toast('VOA audio unavailable — using Dean'); readParagraph(); });
  }
  function readParagraph() {
    stopVoa();
    if (!ttsAvailable()) return toast('No English voice available');
    speakSequence(art.paras[pos]);
  }

  const countdown = h('span', { class: 'chip' });
  const pauseButton = h('button', {
    type: 'button', class: 'btn sm ghost', ...(autoSec ? {} : { disabled: '' }),
    onclick: () => {
      advance.setPaused(performance.now(), !advance.paused);
      pauseButton.textContent = advance.paused ? 'Resume auto' : 'Pause auto';
      updateCountdown();
    },
  }, 'Pause auto');
  function updateCountdown() {
    countdown.textContent = autoSec === 0 ? 'Auto: off'
      : voaPlaying() ? 'Auto: waiting for audio'
      : `${advance.paused ? 'Paused' : 'Next in'} ${Math.ceil(advance.remaining / 1000)} s`;
    if (progressFill) progressFill.style.width = `${autoSec ? (1 - advance.remaining / advance.duration) * 100 : 0}%`;
  }

  const sub = h('div', { class: 'sub' }, 'Loading articles…');
  const head = h('div', { class: 'mode-head' },
    h('div', { class: 'rd-head-text' }, h('h1', {}, icon('article', 24), 'Reading'), sub),
    h('div', { class: 'btn-group' }, countdown, pauseButton,
      h('button', { type: 'button', class: 'btn sm', onclick: () => openLibrary() }, icon('book', 16), 'Library')));
  const body = h('div', { class: 'wm-body rd-body' });
  const wrap = h('div', { class: 'word-mode' }, head, body);
  root.append(wrap);

  const done = () => new Set(get().reading.done);
  const catName = (id) => DATA.PASSAGE_CATS.find(c => c[0] === id)?.[1] || '';
  const pool = () => DATA.PASSAGES.filter(a => level === 'all' || a.level === level);

  /** 下一篇：同级别里第一篇未读的（从当前文章往后找）；全读完则从头开始 */
  function nextArticle() {
    const list = pool();
    if (!list.length) return DATA.PASSAGES[0];
    const d = done();
    const start = list.findIndex(a => a.id === art?.id); // 还没打开文章时为 -1，从第一篇开始
    for (let i = 1; i <= list.length; i++) {
      const a = list[(start + i) % list.length];
      if (!d.has(a.id)) return a;
    }
    toast('All articles read — starting again');
    return list[(start + 1) % list.length];
  }

  function open(a, p = null, dir = 'jump') {
    if (art?.id !== a.id) { stopVoa(); voa.removeAttribute('src'); }
    art = a;
    pos = Math.min(Math.max(0, p ?? get().reading.pos[a.id] ?? 0), a.paras.length - 1);
    update(s => { s.reading.id = a.id; s.reading.pos[a.id] = pos; });
    body.dataset.dir = dir;
    paint();
  }

  function go(n) {
    if (!art) return;
    stopSpeak();
    if (n >= art.paras.length) return finish();
    if (n < 0) return;
    body.dataset.dir = n === pos + 1 ? 'next' : n === pos - 1 ? 'prev' : 'jump';
    pos = n;
    update(s => { s.reading.pos[art.id] = pos; });
    paint();
  }

  function finish() {
    const first = !get().reading.done.includes(art.id);
    update(s => {
      if (first) s.reading.done = [...s.reading.done, art.id];
      s.reading.pos[art.id] = 0;
    });
    if (first) { addXP(5); toast('Article finished · +5 XP'); }
    open(nextArticle(), 0, 'jump');
  }

  function paint() {
    advance.reset(performance.now());
    progressFill = h('i', {});
    updateCountdown();
    body.innerHTML = '';
    revealed = false;
    const a = art;
    const sents = a.paras[pos];
    const text = sents.join(' ');
    const isLast = pos === a.paras.length - 1;
    sub.textContent = `${a.title} · ${a.level} · ${catName(a.cat)} · ¶ ${pos + 1} of ${a.paras.length}`;

    // ---------- 左：段落卡 ----------
    const zh = h('div', { class: 'sn-zh rd-zh reveal-hidden' }, a.zh[pos] || '');
    const revealBtn = h('button', { class: 'sn-pill' }, icon('eye', 16), 'Reveal');
    const toggle = () => {
      revealed = !revealed;
      zh.classList.toggle('reveal-hidden', !revealed);
      revealBtn.replaceChildren(icon(revealed ? 'eyeOff' : 'eye', 16), revealed ? 'Hide' : 'Reveal');
    };
    revealBtn.addEventListener('click', toggle);
    zh.addEventListener('click', toggle);

    const para = h('div', { class: 'rd-para', style: `font-size:${sizeFor(text)}rem`, title: 'Tap a sentence to hear it · tap a word for its meaning' },
      ...sents.flatMap((s, i) => [
        h('span', { class: 'rd-sent', onclick: e => { stopVoa(); say(s); lookupFromEvent(e); } }, s),
        i < sents.length - 1 ? ' ' : null,
      ]));
    voaBtn = a.audio ? h('button', { class: 'sn-pill', onclick: toggleVoa }) : null;
    setVoaUi();

    const hero = h('section', { class: 'wm-hero glass sn-hero rd-hero' },
      h('div', { class: 'sn-top' },
        h('span', { class: 'sn-scene' }, a.heads?.[pos] || `${catName(a.cat)} · ${a.level}`),
        h('span', { class: 'rd-count' }, `${pos + 1} / ${a.paras.length}`)),
      pos === 0 ? h('div', { class: 'rd-title' }, a.title) : null,
      h('div', { class: 'rd-scroll' }, para, zh),
      h('div', { class: 'sn-actions' },
        h('button', { class: 'sn-pill light speak-btn', onclick: readParagraph }, icon('volume', 16), 'Listen'),
        voaBtn, revealBtn),
      h('div', { class: 'wm-spacer' }),
      h('div', { class: 'sn-nav' },
        h('button', { class: 'sn-prev', 'aria-label': 'Previous paragraph', ...(pos === 0 ? { disabled: '' } : {}), onclick: () => go(pos - 1) }, icon('arrowRight', 22)),
        h('button', { class: 'wm-next', onclick: () => go(pos + 1) }, isLast ? 'Finish article' : 'Next', icon(isLast ? 'check' : 'arrowRight', 22),
          autoSec ? h('span', { class: 'wm-auto' }, progressFill) : null)));

    // ---------- 右：词汇表 + 来源 ----------
    const gloss = a.gloss.length
      ? h('div', { class: 'rd-gloss' }, ...a.gloss.map(([term, pos_, def]) =>
        h('button', {
          class: 'rd-term', title: 'Add to review deck',
          onclick: () => toast(addCard(term, `${pos_} ${def}`, '') ? `“${term}” added to your review deck` : 'Already in your review deck'),
        }, h('strong', {}, term), h('em', {}, pos_), h('span', {}, def), icon('plus', 14))))
      : h('p', { class: 'rd-empty' }, 'No word list for this article.');
    const side = h('section', { class: 'wm-card glass rd-side' },
      h('div', { class: 'wm-card-head' },
        h('span', { class: 'wm-label' }, `WORDS IN THIS STORY · ${a.gloss.length}`),
        h('span', { class: 'chip' + (done().has(a.id) ? ' green' : '') }, done().has(a.id) ? 'Read ✓' : `${a.words} words`)),
      h('div', { class: 'rd-progress' }, ...a.paras.map((_, i) =>
        h('button', { class: 'rd-dot' + (i === pos ? ' on' : i < pos ? ' past' : ''), 'aria-label': `Paragraph ${i + 1}`, onclick: () => go(i) }))),
      gloss,
      h('a', { class: 'rd-src', href: a.url, target: '_blank', rel: 'noopener noreferrer' },
        `Source: VOA Learning English · ${a.date}`, icon('arrowRight', 14)));
    body.append(hero, side);

    // 预生成：当前段 + 下一段（都是随站点发布的音频文件，不耗额度）
    prefetch([...sents, ...(a.paras[pos + 1] || [])], { replace: true });
  }

  // ---------- 文章库 ----------
  function openLibrary() {
    advance.setPaused(performance.now(), true);
    let lv = level, cat = 'all';
    const list = h('div', { class: 'rd-lib-list' });
    const chips = h('div', { class: 'sn-chips rd-lib-chips' });
    const close = () => {
      dlg.close(); dlg.remove();
      advance.setPaused(performance.now(), pauseButton.textContent === 'Resume auto');
      advance.reset(performance.now());
    };
    const paintLib = () => {
      const d = done();
      chips.replaceChildren(
        ...[['all', 'All levels'], ['B1', 'B1 · Daily life'], ['B2', 'B2 · IELTS topics']].map(([v, t]) =>
          h('button', { class: 'sn-chip' + (lv === v ? ' on' : ''), onclick: () => { lv = v; paintLib(); } }, t)),
        h('span', { class: 'wm-sep' }),
        ...[['all', 'All topics'], ...DATA.PASSAGE_CATS.map(c => [c[0], c[1]])].map(([v, t]) =>
          h('button', { class: 'sn-chip' + (cat === v ? ' on' : ''), onclick: () => { cat = v; paintLib(); } }, t)));
      const items = DATA.PASSAGES.filter(a => (lv === 'all' || a.level === lv) && (cat === 'all' || a.cat === cat));
      list.replaceChildren(...items.map(a => h('button', {
        class: 'rd-lib-item' + (a.id === art?.id ? ' on' : '') + (d.has(a.id) ? ' done' : ''),
        onclick: () => {
          level = lv;
          update(s => { s.reading.level = lv; });
          close();
          stopSpeak();
          open(a, null, 'jump');
        },
      },
      h('span', { class: 'idx' }, d.has(a.id) ? icon('check', 13) : a.level),
      h('span', { class: 'txt' }, h('b', {}, a.title), h('small', {}, `${catName(a.cat)} · ${a.words} words · ${a.date}`)))));
    };
    const dlg = h('dialog', { class: 'external-dialog rd-lib', 'aria-label': 'Article library' },
      h('h2', {}, 'Article library'),
      h('p', { class: 'resources-intro' }, `${done().size} of ${DATA.PASSAGES.length} read · from VOA Learning English`),
      chips, list,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: close }, 'Close')));
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
    paintLib();
    document.body.append(dlg);
    dlg.showModal();
  }

  const onKey = (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(pos + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(pos - 1); }
    else if (e.key === ' ') { e.preventDefault(); readParagraph(); }
  };
  document.addEventListener('keydown', onKey);
  attachSwipe(body, { left: () => go(pos + 1), right: () => go(pos - 1) });
  const resetCountdown = () => { advance.reset(performance.now()); updateCountdown(); };
  const onVisibility = () => {
    advance.setVisible(performance.now(), !document.hidden);
    if (document.hidden) { stopSpeak(); stopVoa(); }
    updateCountdown();
  };
  wrap.addEventListener('pointerdown', resetCountdown);
  wrap.addEventListener('wheel', resetCountdown, { passive: true });
  document.addEventListener('keydown', resetCountdown);
  document.addEventListener('visibilitychange', onVisibility);
  const advanceInterval = setInterval(() => {
    // VOA 原声播放时不自动翻段
    if (!art || voaPlaying()) { advance.reset(performance.now()); updateCountdown(); return; }
    if (advance.tick(performance.now())) go(pos + 1);
    updateCountdown();
  }, 250);
  updateCountdown();

  import('../passages.js')
    .then(m => {
      DATA = m;
      if (!alive) return;
      const saved = DATA.PASSAGES.find(a => a.id === get().reading.id);
      if (saved) open(saved, null, '');
      else { art = null; open(nextArticle(), 0, ''); }
      delete body.dataset.dir;
    })
    .catch(e => { sub.textContent = 'Could not load articles: ' + e.message; });

  return () => {
    alive = false; clearInterval(advanceInterval); stopSpeak();
    voa.pause(); voa.removeAttribute('src');
    delete document.documentElement.dataset.speaking;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keydown', resetCountdown);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
