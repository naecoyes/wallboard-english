// lookup.js — 点击句子里的单词，弹出迷你释义（先查本地词库，查不到再用在线词典）
import { h } from './ui.js';
import { icon } from './icons.js';
import { speak } from './tts.js';

let index = null;
let pop = null;

async function local(word) {
  if (!index) {
    const { WORDS } = await import('./words.js');
    index = new Map();
    for (const x of WORDS) {
      index.set(x.w.toLowerCase(), x);
      for (const [, f] of x.forms || []) if (!index.has(f.toLowerCase())) index.set(f.toLowerCase(), x);
    }
  }
  return index.get(word.toLowerCase()) || null;
}

async function online(word) {
  try {
    const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const m = (await r.json())[0];
    const first = m.meanings?.[0];
    return {
      ipa: m.phonetic || '',
      lines: (first?.definitions || []).slice(0, 2).map(d => `${first.partOfSpeech}. ${d.definition}`),
    };
  } catch { return null; }
}

/** 取出点击位置下的英文单词 */
export function wordAtPoint(x, y) {
  let node, off;
  if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); node = p?.offsetNode; off = p?.offset; }
  else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); node = r?.startContainer; off = r?.startOffset; }
  if (!node || node.nodeType !== 3) return null;
  const t = node.textContent, re = /[A-Za-z'’-]/;
  let a = off, b = off;
  while (a > 0 && re.test(t[a - 1])) a--;
  while (b < t.length && re.test(t[b])) b++;
  const w = t.slice(a, b).replace(/^['’-]+|['’-]+$/g, '').replace(/['’]s$/i, '');
  return /^[A-Za-z][A-Za-z'’-]*$/.test(w) ? w : null;
}

export function closeLookup() { pop?.remove(); pop = null; }

export async function showLookup(word, x, y) {
  closeLookup();
  const body = h('div', { class: 'lk-body' }, 'Looking up…');
  pop = h('aside', { class: 'lookup-pop', role: 'dialog', 'aria-label': `Meaning of ${word}` },
    h('div', { class: 'lk-head' }, h('b', {}, word),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Say word', onclick: () => speak(word) }, icon('volume', 16)),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Close', onclick: closeLookup }, icon('x', 16))),
    body);
  document.body.append(pop);
  const w = pop.offsetWidth || 280;
  const left = Math.max(8, Math.min(x - w / 2, innerWidth - w - 8));
  pop.style.left = `${left}px`;
  pop.style.transformOrigin = `${Math.round(x - left)}px top`; // 从点击处弹出
  pop.style.top = `${Math.min(y + 18, innerHeight - pop.offsetHeight - 8)}px`;
  const mine = pop;

  const hit = await local(word);
  let content;
  if (hit) {
    content = [h('div', { class: 'lk-ipa' }, hit.ipa || ''),
      ...hit.defs.map(([pos, zh]) => h('div', {}, `${pos} ${zh}`)),
      ...(hit.enDefs || []).slice(0, 1).map(d => h('div', { class: 'lk-en' }, d))];
  } else {
    const { READING_DICTIONARY } = await import('./reading-dictionary.js');
    const entry = READING_DICTIONARY[word.toLowerCase().replace(/’/g, "'")];
    if (entry) {
      content = [h('div', { class: 'lk-ipa' }, entry[0]),
        ...entry[1].split('\n').map(line => h('div', {}, line))];
    } else {
      const o = await online(word);
      content = [h('div', {}, '暂无中文释义'),
        ...(o ? [h('div', { class: 'lk-ipa' }, o.ipa), ...o.lines.map(l => h('div', { class: 'lk-en' }, l))] : [])];
    }
  }
  if (pop !== mine) return;
  body.replaceChildren(...content);
  mine.style.top = `${Math.max(8, Math.min(parseFloat(mine.style.top), innerHeight - mine.offsetHeight - 8))}px`;
}

export function lookupFromEvent(e) {
  const w = wordAtPoint(e.clientX, e.clientY);
  if (w) showLookup(w, e.clientX, e.clientY);
}

document.addEventListener('pointerdown', e => { if (pop && !pop.contains(e.target)) closeLookup(); }, true);
window.addEventListener('hashchange', closeLookup);
