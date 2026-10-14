// deck.js — 复习卡组管理：查看 / 搜索 / 删除 / 提前复习
import { h, toast } from './ui.js';
import { icon } from './icons.js';
import { get, update } from './store.js';
import { studyDay } from './streak.js';

export function openDeck(onChange) {
  const dlg = h('dialog', { class: 'external-dialog deck-dialog', 'aria-label': 'Review deck' });
  const search = h('input', { type: 'search', placeholder: 'Search cards…', autocomplete: 'off' });
  const list = h('div', { class: 'deck-list' });
  const count = h('small', {});
  const close = () => { dlg.close(); dlg.remove(); onChange?.(); };

  function paint() {
    const q = search.value.trim().toLowerCase();
    const today = studyDay();
    const cards = get().cards
      .filter(c => !q || c.front.toLowerCase().includes(q) || (c.back || '').toLowerCase().includes(q))
      .sort((a, b) => a.due.localeCompare(b.due));
    count.textContent = `${get().cards.length} cards · ${get().cards.filter(c => c.due <= today).length} due`;
    list.replaceChildren(...(cards.length ? cards.map(c => h('div', { class: 'deck-item' },
      h('div', { class: 'deck-text' }, h('b', {}, c.front), h('small', {}, c.back || '')),
      h('span', { class: 'chip' + (c.due <= today ? ' amber' : '') }, c.due <= today ? 'Due' : c.due.slice(5)),
      h('button', { class: 'icon-btn sm', 'aria-label': `Remove ${c.front}`, onclick: () => {
        update(s => { s.cards = s.cards.filter(x => x.id !== c.id); });
        toast('Card removed');
        paint();
      } }, icon('trash', 16)))) : [h('p', {}, 'No cards found.')]));
  }
  search.addEventListener('input', paint);
  dlg.append(h('h2', {}, 'Review deck'), count, search, list,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost', onclick: close }, 'Close'),
      h('button', { class: 'btn primary', onclick: () => { close(); location.hash = '#micro'; } }, 'Review now')));
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  document.body.append(dlg);
  paint();
  dlg.showModal();
}
