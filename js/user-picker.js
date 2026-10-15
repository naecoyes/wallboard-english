import { USERS, get, getUserState, currentUserId, renameUser } from './store.js';
import { h, toast } from './ui.js';

export function initUserPicker(onSwitch) {
  const button = h('button', { type: 'button', class: 'user-picker-btn', 'aria-label': 'Switch learner', onclick: open });
  const paint = () => {
    const user = USERS.find(u => u.id === currentUserId());
    button.replaceChildren(h('span', { 'aria-hidden': 'true' }, user.avatar), h('span', {}, get().profile.nickname || user.name));
  };
  document.querySelector('#topbar .nav-wrap').append(button);
  function open() {
    const dialog = h('dialog', { class: 'external-dialog user-dialog', 'aria-label': 'Choose learner' });
    const close = () => dialog.remove();
    dialog.append(h('h2', {}, 'Choose learner / 切换用户'),
      h('p', { class: 'resources-intro' }, 'Each learner has separate study time, progress and tree. Settings are shared. Existing history belongs to 男生.'));
    for (const user of USERS) {
      const name = h('input', { value: getUserState(user.id).profile.nickname || user.name, maxlength: '24', 'aria-label': `${user.name} nickname` });
      dialog.append(h('div', { class: 'user-option' },
        h('span', { class: 'user-avatar', 'aria-hidden': 'true' }, user.avatar), name,
        h('button', { class: 'btn sm', onclick: () => { renameUser(user.id, name.value); paint(); toast('Name saved'); } }, 'Save name'),
        h('button', { class: 'btn sm primary', ...(user.id === currentUserId() ? { disabled: '' } : {}), onclick: () => { if (onSwitch(user.id)) { close(); paint(); } } }, user.id === currentUserId() ? 'Current' : 'Switch')));
    }
    dialog.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: close }, 'Close')));
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    document.body.append(dialog); dialog.showModal();
  }
  paint();
  window.addEventListener('wallboard:remote-updated', paint);
}
