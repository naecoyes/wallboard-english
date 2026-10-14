// word.js — 单词模式：长时间无操作时的默认屏（环境式背雅思单词）
// 横屏：左 = 单词 / 音标 / 考试标签 / 释义 / 操作；右 = 例句（含 Tatoeba 出处）/ 单词笔记
// 词库 words.js 约 1.5MB，进入本页时才按需加载，不拖慢其他页面
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { get, update } from '../store.js';
import { addCard } from '../srs.js';
import { displayStreak, minutesToday } from '../streak.js';
import { lookupFromEvent } from '../lookup.js';
import { attachSwipe } from '../swipe.js';
import { speak, regenerateAudio, speakSequence, stopSpeak, ttsAvailable, prefetch, prefetchMode, staticAudioReady } from '../tts.js';

let WORDS = null;
const say = (text) => ttsAvailable() ? speak(text) : toast('No English voice available');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TAG_NAME = { ielts: 'IELTS', cet4: 'CET-4', cet6: 'CET-6', ky: 'Kaoyan', toefl: 'TOEFL', gre: 'GRE' };
// 词库里的词形标签是中文（来自构建脚本），界面上显示英文
const FORM_EN = { '过去式': 'past', '过去分词': 'past participle', '现在分词': '-ing', '三单': '3rd person', '复数': 'plural', '比较级': 'comparative', '最高级': 'superlative' };

/** 把例句中的目标词及其变形（过去式、复数等）高亮 */
function highlight(text, w) {
  const forms = [w.w, ...(w.forms || []).map(f => f[1])].sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(?:${forms.map(escapeRe).join('|')})\\w*`, 'gi');
  const frag = document.createDocumentFragment();
  let last = 0, m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(last, m.index), h('mark', {}, m[0]));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

/** 从 start 开始找下一个未标记「太简单」的单词下标；全部掌握返回 -1 */
function findIndex(start) {
  const known = new Set(get().words.known);
  const n = WORDS.length;
  for (let i = 0; i < n; i++) {
    const k = (((start + i) % n) + n) % n;
    if (!known.has(WORDS[k].w)) return k;
  }
  return -1;
}

export function renderWord(root) {
  const autoSec = get().settings.wordAutoSec || 0;
  let cur = -1;
  let left = autoSec;
  let alive = true;
  let curExamples = [];
  const hist = []; // 已看过的词，用于「上一个」 // 当前词的例句文本（触摸时预生成）

  // ---------- 头部：进度 + 迷你状态 ----------
  const sub = h('div', { class: 'sub' }, 'Loading IELTS word list…');
  const clockEl = h('span', {});
  const searchIn = h('input', { type: 'search', class: 'wm-search', placeholder: 'Search word…', autocomplete: 'off', 'aria-label': 'Search word' });
  searchIn.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key !== 'Enter' || !WORDS) return;
    const q = searchIn.value.trim().toLowerCase();
    const i = WORDS.findIndex(x => x.w.toLowerCase() === q);
    const j = i >= 0 ? i : WORDS.findIndex(x => x.w.toLowerCase().startsWith(q));
    if (!q || j < 0) return toast('No matching word');
    stopSpeak(); hist.push(cur); cur = j; body.dataset.dir = 'jump';
    update(s => { s.words.idx = cur; });
    searchIn.value = ''; searchIn.blur(); paint();
  });
  const head = h('div', { class: 'mode-head' },
    h('div', {}, h('h1', {}, icon('book', 24), 'IELTS Words'), sub),
    searchIn,
    h('a', { class: 'wm-status', href: '#standby', title: 'Back to Today' },
      h('span', { class: 'chip' }, icon('timer', 14), clockEl),
      h('span', { class: 'chip amber' }, icon('flame', 14), `Streak ${displayStreak()}`),
      h('span', { class: 'chip' }, `${minutesToday()} min today`)));

  const body = h('div', { class: 'wm-body' });
  const barFill = h('i', {});
  const wrap = h('div', { class: 'word-mode' }, head, body);
  root.append(wrap);

  function updateSub() {
    const w = get().words;
    sub.textContent = cur < 0
      ? `All ${WORDS.length} words marked as known`
      : `Word ${cur + 1} of ${WORDS.length} · known ${w.known.length} · learning ${w.unknown.length}`;
  }

  function next() {
    if (!WORDS) return;
    stopSpeak();
    if (cur >= 0) hist.push(cur);
    cur = findIndex(cur + 1);
    body.dataset.dir = 'next';
    update(s => { s.words.idx = cur < 0 ? 0 : cur; });
    paint();
  }

  function prev() {
    if (!WORDS || !hist.length) return toast('This is where you started');
    stopSpeak();
    cur = hist.pop();
    body.dataset.dir = 'prev';
    update(s => { s.words.idx = cur; });
    paint();
  }

  function paint() {
    body.innerHTML = '';
    left = autoSec;
    barFill.style.width = '0%';
    updateSub();

    if (cur < 0) {
      body.append(h('div', { class: 'task-card glass', style: 'grid-column:1/-1;text-align:center' },
        h('div', { class: 'prompt' }, 'You marked every word as too easy'),
        h('p', { class: 'task-sub' }, 'Reset your progress to go through the list again.'),
        h('div', { class: 'btn-row', style: 'justify-content:center' },
          h('button', {
            class: 'btn primary', onclick: () => {
              update(s => { s.words = { idx: 0, known: [], unknown: [] }; });
              cur = 0; paint();
            },
          }, icon('undo', 18), 'Reset word progress'))));
      return;
    }

    const w = WORDS[cur];
    const isUnknown = get().words.unknown.includes(w.w);
    const meaning = w.defs.map(d => `${d[0]} ${d[1]}`).join('；');

    // ---------- 左：单词卡 ----------
    const unknownBtn = h('button', {
      class: 'wm-pill' + (isUnknown ? ' on' : ''), onclick: () => {
        if (get().words.unknown.includes(w.w)) return toast('Already in your review deck');
        update(s => { s.words.unknown.push(w.w); });
        const added = addCard(w.w, meaning, w.ex[0] ? w.ex[0][0] : '');
        unknownBtn.classList.add('on');
        toast(added ? 'Added to your review deck' : 'Already in your review deck');
        updateSub();
      },
    }, icon('undo', 16), "Don't know");
    const easyBtn = h('button', {
      class: 'wm-pill', onclick: () => {
        update(s => {
          if (!s.words.known.includes(w.w)) s.words.known.push(w.w);
          s.words.unknown = s.words.unknown.filter(x => x !== w.w);
        });
        toast("Marked as known — it won't show again");
        next();
      },
    }, icon('check', 16), 'Too easy');

    const tagRow = h('div', { class: 'wm-tags' },
      ...(w.tags || []).map(t => h('span', { class: 'wm-tag' + (t === 'ielts' ? ' main' : '') }, TAG_NAME[t] || t)),
      w.collins ? h('span', { class: 'wm-stars', title: `Collins ${w.collins}-star` }, '★'.repeat(w.collins) + '☆'.repeat(5 - w.collins)) : null);

    let chineseFace = false;
    const meaningContent = h('div', { class: 'wm-meaning-content' });
    const meaningHint = h('span', { class: 'wm-meaning-hint' });
    const meaningButton = h('button', {
      type: 'button', class: 'wm-meaning-flip', 'aria-pressed': 'false',
      onclick: () => {
        chineseFace = !chineseFace; paintMeaning();
      },
    }, meaningContent, meaningHint);
    function paintMeaning() {
      meaningContent.replaceChildren();
      meaningButton.setAttribute('aria-pressed', String(chineseFace));
      meaningButton.setAttribute('aria-label', chineseFace ? 'Show English meaning' : 'Show Chinese meaning');
      if (chineseFace) {
        meaningContent.append(h('div', { class: 'wm-defs' },
          ...w.defs.map(([pos, zh]) => h('div', { class: 'wm-def' },
            pos ? h('span', { class: 'wm-pos' }, pos) : null, h('span', { class: 'wm-zh' }, zh)))));
        meaningHint.textContent = 'CHINESE MEANING · Tap to return to English';
      } else {
        meaningContent.append(w.enDefs?.length
          ? h('ol', { class: 'wm-english-defs' }, ...w.enDefs.map(d => h('li', {}, d)))
          : h('p', {}, 'English definition unavailable in this dictionary.'));
        meaningHint.textContent = 'ENGLISH MEANING · Tap to flip to Chinese';
      }
    }
    paintMeaning();

    const hero = h('section', { class: 'wm-hero glass' },
      h('div', { class: 'wm-top' },
        h('button', { type: 'button', class: 'wm-word readable', style: 'font-size:5.25rem', title: 'Read word, then one example', onclick: () => speakSequence([w.w, w.ex?.[0]?.[0]]) }, w.w),
        h('button', { class: 'wm-speak fix', 'aria-label': 'Fix pronunciation', title: 'Wrong pronunciation? Regenerate it', onclick: () => regenerateAudio(w.w) }, icon('undo', 22)),
        h('button', { class: 'wm-speak speak-btn', 'aria-label': 'Read word and example', title: 'Read word, then one example', onclick: () => speakSequence([w.w, w.ex?.[0]?.[0]]) }, icon('volume', 30))),
      h('div', { class: 'wm-ipa-row' },
        h('span', { class: 'wm-ipa' }, w.ipa),
        h('div', { class: 'wm-pills' }, unknownBtn, h('span', { class: 'wm-sep' }), easyBtn)),
      tagRow,
      meaningButton,
      h('div', { class: 'wm-spacer' }),
      h('div', { class: 'sn-nav' },
        h('button', { class: 'sn-prev', 'aria-label': 'Previous word', onclick: prev }, icon('arrowRight', 22)),
        h('button', { class: 'wm-next', onclick: next },
          'Next', icon('arrowRight', 22),
          autoSec ? h('span', { class: 'wm-auto' }, barFill) : null)));

    // ---------- 左下：单词笔记（词形 / 辨析 / 搭配），放在单词卡空白处，挂墙时不用滚动 ----------
    const groups = [];
    if (w.forms?.length) {
      // 相同拼写合并标签，如「过去式/过去分词 accommodated」
      const merged = new Map();
      for (const [zh, f] of w.forms) { const label = FORM_EN[zh] || zh; merged.set(f, merged.has(f) ? `${merged.get(f)} / ${label}` : label); }
      groups.push(h('div', { class: 'wm-note-group' },
        h('span', { class: 'chip' }, 'Forms'),
        h('div', { class: 'wm-forms' }, ...[...merged].map(([f, label]) => h('span', {}, h('small', {}, label), f)))));
    }
    if (groups.length) {
      const notesEl = h('div', { class: 'wm-notes' }, ...groups);
      hero.insertBefore(notesEl, hero.querySelector('.wm-spacer'));
      requestAnimationFrame(() => notesEl.classList.toggle('clipped', notesEl.scrollHeight > notesEl.clientHeight + 2));
    }

    // ---------- 右：例句 ----------
    const exCard = h('section', { class: 'wm-card glass' },
      h('div', { class: 'wm-card-head' }, h('span', { class: 'wm-label' }, `EXAMPLES · ${w.ex.length}`)),
      ...w.ex.map(([en, zh, eid], i) => {
        const translation = h('div', { class: 'wm-cn', hidden: '' }, zh);
        const reveal = h('button', {
          type: 'button', class: 'wm-translation-toggle', 'aria-expanded': 'false',
          onclick: () => {
            translation.hidden = !translation.hidden;
            reveal.textContent = translation.hidden ? 'Reveal translation' : 'Hide translation';
            reveal.setAttribute('aria-expanded', String(!translation.hidden));
          },
        }, 'Reveal translation');
        return h('div', { class: 'wm-ex' + (i === 0 ? ' first' : '') },
          h('div', { class: 'wm-ex-main' },
            h('button', { type: 'button', class: 'wm-en readable', title: 'Read example · tap a word for its meaning', onclick: e => { say(en); lookupFromEvent(e); } }, highlight(en, w)),
            reveal, translation,
            h('div', { class: 'wm-src' }, eid ? `Source: Tatoeba #${eid} · CC BY 2.0 FR` : 'Source: original')),
          h('button', { class: 'icon-btn sm', 'aria-label': 'Read example', onclick: () => say(en) }, icon('volume', 18)));
      }));

    // ---------- 右：单词笔记（辨析 / 搭配，仅原创词条有） ----------
    const noteGroups = [];
    if (w.notes?.length) noteGroups.push(h('div', { class: 'wm-note-group' },
      h('span', { class: 'chip' }, 'Compare'), h('ul', {}, ...w.notes.map(n => h('li', {}, n)))));
    if (w.col?.length) noteGroups.push(h('div', { class: 'wm-note-group' },
      h('span', { class: 'chip green' }, 'Collocations'), h('ul', {}, ...w.col.map(n => h('li', {}, n)))));
    const notesCard = noteGroups.length
      ? h('section', { class: 'wm-card glass' }, h('div', { class: 'wm-card-head' }, h('span', { class: 'wm-label' }, 'NOTES')), ...noteGroups)
      : null;

    if (notesCard) {
      const contents = h('div', { hidden: '' });
      contents.append(...noteGroups);
      const toggle = h('button', {
        type: 'button', class: 'wm-translation-toggle', 'aria-expanded': 'false',
        onclick: () => {
          contents.hidden = !contents.hidden;
          toggle.textContent = contents.hidden ? 'Reveal notes' : 'Hide notes';
          toggle.setAttribute('aria-expanded', String(!contents.hidden));
        },
      }, 'Reveal notes');
      notesCard.replaceChildren(h('div', { class: 'wm-card-head' }, h('span', { class: 'wm-label' }, 'NOTES'), toggle), contents);
    }
    body.append(hero, h('div', { class: 'wm-side' }, exCard, notesCard));

    // 预生成发音：当前词 → 下一个词（自动切换时直接就绪）→ 例句
    // smart 模式下例句要等有人触摸屏幕才生成，避免无人时每 45 秒消耗多次额度
    curExamples = w.ex.map(e => e[0]);
    const nxt = findIndex(cur + 1);
    prefetch([w.w, w.ex?.[0]?.[0], nxt >= 0 ? WORDS[nxt].w : null, ...(prefetchMode() === 'all' ? curExamples : [])], { replace: true });

    // 切换到新词时自动读一遍（设置里可关闭）；熄屏 / 切后台时不读
    if (get().settings.wordAutoPlay !== false) {
      const shown = cur;
      staticAudioReady.then(() => setTimeout(() => {
        if (alive && shown === cur && !document.hidden) speakSequence([w.w, w.ex?.[0]?.[0]], { auto: true });
      }, 400));
    }

    // 单词按卡片宽度自动缩字号，长词也不会从中间断开
    const wordEl = hero.querySelector('.wm-word');
    requestAnimationFrame(() => {
      let size = parseFloat(wordEl.style.fontSize);
      while (wordEl.scrollWidth > wordEl.clientWidth + 1 && size > 2.2) {
        size -= 0.2;
        wordEl.style.fontSize = `${size}rem`;
      }
    });
  }

  // ---------- 时钟 + 自动切换 ----------
  const tickClock = () => {
    const n = new Date();
    clockEl.textContent = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  };
  tickClock();
  const iv = setInterval(() => {
    tickClock();
    if (!WORDS || !autoSec || cur < 0) return;
    left--;
    barFill.style.width = `${((autoSec - left) / autoSec) * 100}%`;
    if (left <= 0) next();
  }, 1000);

  // 有人操作时重新计时，避免正在看就被切走
  const onTouch = () => {
    left = autoSec; barFill.style.width = '0%';
    if (curExamples.length) prefetch(curExamples); // 有人在看：把例句也准备好
  };
  const onKey = (e) => { if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); } };
  wrap.addEventListener('pointerdown', onTouch);
  attachSwipe(body, { left: next, right: prev });
  document.addEventListener('keydown', onKey);

  // 按需加载词库
  const start = () => {
    if (!alive) return;
    // 网址带 ?w=单词 时直接跳到该词（方便分享 / 预览）
    const jump = new URLSearchParams(location.search).get('w');
    const j = jump ? WORDS.findIndex(x => x.w === jump.toLowerCase()) : -1;
    cur = j >= 0 ? j : findIndex(get().words.idx || 0);
    paint();
  };
  if (WORDS) start();
  else import('../words.js')
    .then(m => { WORDS = m.WORDS; start(); })
    .catch(e => { sub.textContent = 'Could not load the word list: ' + e.message; });

  return () => { alive = false; clearInterval(iv); stopSpeak(); document.removeEventListener('keydown', onKey); };
}
