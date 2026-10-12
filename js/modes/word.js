// word.js — 单词模式：长时间无操作时的默认屏（环境式背雅思单词）
// 横屏：左 = 单词 / 音标 / 考试标签 / 释义 / 操作；右 = 例句（含 Tatoeba 出处）/ 单词笔记
// 词库 words.js 约 1.5MB，进入本页时才按需加载，不拖慢其他页面
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { get, update } from '../store.js';
import { addCard } from '../srs.js';
import { displayStreak, minutesToday } from '../streak.js';
import { speak, stopSpeak, ttsAvailable } from '../tts.js';

let WORDS = null;
const say = (text) => ttsAvailable() ? speak(text) : toast('当前无可用英文语音');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TAG_NAME = { ielts: '雅思', cet4: '四级', cet6: '六级', ky: '考研', toefl: '托福', gre: 'GRE' };

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

  // ---------- 头部：进度 + 迷你状态 ----------
  const sub = h('div', { class: 'sub' }, '正在加载雅思词库…');
  const clockEl = h('span', {});
  const head = h('div', { class: 'mode-head' },
    h('div', {}, h('h1', {}, icon('book', 24), '雅思单词'), sub),
    h('a', { class: 'wm-status', href: '#standby', title: '回到待机屏' },
      h('span', { class: 'chip' }, icon('timer', 14), clockEl),
      h('span', { class: 'chip amber' }, icon('flame', 14), `连续 ${displayStreak()} 天`),
      h('span', { class: 'chip' }, `今日 ${minutesToday()} 分钟`)));

  const body = h('div', { class: 'wm-body' });
  const barFill = h('i', {});
  const wrap = h('div', { class: 'word-mode' }, head, body);
  root.append(wrap);

  function updateSub() {
    const w = get().words;
    sub.textContent = cur < 0
      ? `共 ${WORDS.length} 个单词，已全部标记掌握`
      : `第 ${cur + 1} / ${WORDS.length} 个 · 已掌握 ${w.known.length} · 不认识 ${w.unknown.length}`;
  }

  function next() {
    if (!WORDS) return;
    stopSpeak();
    cur = findIndex(cur + 1);
    update(s => { s.words.idx = cur < 0 ? 0 : cur; });
    paint();
  }

  function paint() {
    body.innerHTML = '';
    left = autoSec;
    barFill.style.width = '0%';
    updateSub();

    if (cur < 0) {
      body.append(h('div', { class: 'task-card glass', style: 'grid-column:1/-1;text-align:center' },
        h('div', { class: 'prompt' }, '全部单词都已标记为「太简单」'),
        h('p', { class: 'task-sub' }, '可以重置进度重新过一遍'),
        h('div', { class: 'btn-row', style: 'justify-content:center' },
          h('button', {
            class: 'btn primary', onclick: () => {
              update(s => { s.words = { idx: 0, known: [], unknown: [] }; });
              cur = 0; paint();
            },
          }, icon('undo', 18), '重置单词进度'))));
      return;
    }

    const w = WORDS[cur];
    const isUnknown = get().words.unknown.includes(w.w);
    const meaning = w.defs.map(d => `${d[0]} ${d[1]}`).join('；');

    // ---------- 左：单词卡 ----------
    const unknownBtn = h('button', {
      class: 'wm-pill' + (isUnknown ? ' on' : ''), onclick: () => {
        if (get().words.unknown.includes(w.w)) return toast('已在复习卡组中');
        update(s => { s.words.unknown.push(w.w); });
        const added = addCard(w.w, meaning, w.ex[0] ? w.ex[0][0] : '');
        unknownBtn.classList.add('on');
        toast(added ? '已加入复习卡组' : '已在复习卡组中');
        updateSub();
      },
    }, icon('undo', 16), '不认识');
    const easyBtn = h('button', {
      class: 'wm-pill', onclick: () => {
        update(s => {
          if (!s.words.known.includes(w.w)) s.words.known.push(w.w);
          s.words.unknown = s.words.unknown.filter(x => x !== w.w);
        });
        toast('已标记掌握，之后不再出现');
        next();
      },
    }, icon('check', 16), '太简单');

    const tagRow = h('div', { class: 'wm-tags' },
      ...(w.tags || []).map(t => h('span', { class: 'wm-tag' + (t === 'ielts' ? ' main' : '') }, TAG_NAME[t] || t)),
      w.collins ? h('span', { class: 'wm-stars', title: `柯林斯 ${w.collins} 星` }, '★'.repeat(w.collins) + '☆'.repeat(5 - w.collins)) : null);

    const hero = h('section', { class: 'wm-hero glass' },
      h('div', { class: 'wm-top' },
        h('div', { class: 'wm-word', style: 'font-size:5.25rem' }, w.w),
        h('button', { class: 'wm-speak', 'aria-label': '读单词', onclick: () => say(w.w) }, icon('volume', 30))),
      h('div', { class: 'wm-ipa-row' },
        h('span', { class: 'wm-ipa' }, w.ipa),
        h('div', { class: 'wm-pills' }, unknownBtn, h('span', { class: 'wm-sep' }), easyBtn)),
      tagRow,
      h('div', { class: 'wm-defs' },
        ...w.defs.map(([pos, zh]) => h('div', { class: 'wm-def' },
          pos ? h('span', { class: 'wm-pos' }, pos) : null, h('span', { class: 'wm-zh' }, zh)))),
      h('div', { class: 'wm-spacer' }),
      h('button', { class: 'wm-next', onclick: next },
        '下一个', icon('arrowRight', 22),
        autoSec ? h('span', { class: 'wm-auto' }, barFill) : null));

    // ---------- 左下：单词笔记（词形 / 辨析 / 搭配），放在单词卡空白处，挂墙时不用滚动 ----------
    const groups = [];
    if (w.forms?.length) {
      // 相同拼写合并标签，如「过去式/过去分词 accommodated」
      const merged = new Map();
      for (const [label, f] of w.forms) merged.set(f, merged.has(f) ? `${merged.get(f)}/${label}` : label);
      groups.push(h('div', { class: 'wm-note-group' },
        h('span', { class: 'chip' }, '词形'),
        h('div', { class: 'wm-forms' }, ...[...merged].map(([f, label]) => h('span', {}, h('small', {}, label), f)))));
    }
    if (groups.length) {
      const notesEl = h('div', { class: 'wm-notes' }, ...groups);
      hero.insertBefore(notesEl, hero.querySelector('.wm-spacer'));
      requestAnimationFrame(() => notesEl.classList.toggle('clipped', notesEl.scrollHeight > notesEl.clientHeight + 2));
    }

    // ---------- 右：例句 ----------
    const exCard = h('section', { class: 'wm-card glass' },
      h('div', { class: 'wm-card-head' }, h('span', { class: 'wm-label' }, `例句 · ${w.ex.length}`)),
      ...w.ex.map(([en, zh, eid], i) => h('div', { class: 'wm-ex' + (i === 0 ? ' first' : '') },
        h('div', { class: 'wm-ex-main' },
          h('div', { class: 'wm-en' }, highlight(en, w)),
          h('div', { class: 'wm-cn' }, zh),
          h('div', { class: 'wm-src' }, eid ? `来源：Tatoeba #${eid} · CC BY 2.0 FR` : '来源：本站原创')),
        h('button', { class: 'icon-btn sm', 'aria-label': '朗读例句', onclick: () => say(en) }, icon('volume', 18)))));

    // ---------- 右：单词笔记（辨析 / 搭配，仅原创词条有） ----------
    const noteGroups = [];
    if (w.notes?.length) noteGroups.push(h('div', { class: 'wm-note-group' },
      h('span', { class: 'chip' }, '辨析'), h('ul', {}, ...w.notes.map(n => h('li', {}, n)))));
    if (w.col?.length) noteGroups.push(h('div', { class: 'wm-note-group' },
      h('span', { class: 'chip green' }, '搭配'), h('ul', {}, ...w.col.map(n => h('li', {}, n)))));
    const notesCard = noteGroups.length
      ? h('section', { class: 'wm-card glass' }, h('div', { class: 'wm-card-head' }, h('span', { class: 'wm-label' }, '单词笔记')), ...noteGroups)
      : null;

    body.append(hero, h('div', { class: 'wm-side' }, exCard, notesCard));

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
  const onTouch = () => { left = autoSec; barFill.style.width = '0%'; };
  const onKey = (e) => { if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); } };
  wrap.addEventListener('pointerdown', onTouch);
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
    .catch(e => { sub.textContent = '词库加载失败：' + e.message; });

  return () => { alive = false; clearInterval(iv); stopSpeak(); document.removeEventListener('keydown', onKey); };
}
