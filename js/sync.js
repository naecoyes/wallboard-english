// sync.js — 把学习进度同步到私有 GitHub 仓库（纯前端，无后台）
// · Two profile files: progress-male.json / progress-female.json; legacy progress.json is read only during migration.
// · 口令派生出的密钥以「不可导出」形式存进 IndexedDB，本机重启后自动解锁；Token 明文只在内存里
// · MiMo Key 也用同一把密钥加密后放进 progress.json，多台设备共用
import { get, getUserState, currentUserId, USERS, replaceState, onSave, compactSessions } from './store.js';

const CFG = 'wallboard-sync-v1';
const fileFor = id => `progress-${id}.json`;
const b64 = {
  enc: (buf) => {
    const bytes = new Uint8Array(buf); let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  },
  dec: (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0)),
};
const utf8 = (s) => new TextEncoder().encode(s);

let cfg = JSON.parse(localStorage.getItem(CFG) || 'null'); // { repo, salt, tokenEnc:{iv,ct} }
let key = null;      // CryptoKey（内存）
let token = null;    // 明文 Token（仅内存）
let timer = null, busy = false;
export const syncState = { status: cfg ? 'locked' : 'off', message: '', last: null };
const listeners = new Set();
export const onSyncChange = (fn) => listeners.add(fn);
const setState = (status, message = '') => { Object.assign(syncState, { status, message }); listeners.forEach(f => f(syncState)); };

// ---------- 加密 ----------
const derive = async (pass, salt) => crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
  await crypto.subtle.importKey('raw', utf8(pass), 'PBKDF2', false, ['deriveKey']),
  { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
async function encrypt(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv: b64.enc(iv), ct: b64.enc(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(text))) };
}
async function decrypt(o) {
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(o.iv) }, key, b64.dec(o.ct)));
}

// ---------- 把密钥记在本机（IndexedDB，不可导出） ----------
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open('wallboard-sync', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('k');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function keyStore(op, k) {
  try {
    const db = await idb();
    return await new Promise(res => {
      const st = db.transaction('k', op === 'get' ? 'readonly' : 'readwrite').objectStore('k');
      const rq = op === 'get' ? st.get('key') : op === 'put' ? st.put(k, 'key') : st.delete('key');
      rq.onsuccess = () => res(rq.result ?? null); rq.onerror = () => res(null);
    });
  } catch { return null; }
}

// ---------- GitHub API ----------
async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, {
    ...opts, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
  });
  if (r.status === 404) return null;
  if (!r.ok) { const e = new Error(`GitHub ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}
async function readRemote(file) {
  const f = await gh(file);
  if (!f) return { sha: null, data: null };
  const bin = atob(f.content.replace(/\n/g, ''));
  return { sha: f.sha, data: JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))) };
}
async function writeRemote(data, sha, file) {
  const content = b64.enc(utf8(JSON.stringify(data)));
  return gh(file, { method: 'PUT', body: JSON.stringify({ message: 'sync progress', content, ...(sha ? { sha } : {}) }) });
}

// ---------- 合并（单用户：哪边最近改过就以哪边为准，学习记录两边合并不丢） ----------
// base = 本机上次同步成功时云端的 updatedAt；没有 base 说明本机从没同步过，直接采用云端数据
const secondsOf = (r) => (Number.isFinite(r.seconds) ? r.seconds : (r.minutes || 0) * 60);
function mergeSessions(a = [], b = []) {
  const ses = new Map();
  for (const r of [...a, ...b]) {
    const id = r.timerId || `${r.date}|${r.mode}`;
    const old = ses.get(id);
    if (!old || secondsOf(r) > secondsOf(old)) ses.set(id, r);
  }
  return compactSessions([...ses.values()]);
}
export function merge(local, remote, base = null) {
  if (!remote) return local;
  const remoteChanged = base == null || (remote.updatedAt || 0) > base;
  const localDirty = base != null && (local.updatedAt || 0) > base;
  const takeRemote = remoteChanged && (!localDirty || (remote.updatedAt || 0) > (local.updatedAt || 0));
  const out = JSON.parse(JSON.stringify(takeRemote ? remote : local));
  const settingsOwner = (remote.settingsAt || 0) > (local.settingsAt || 0) ? remote : local;
  out.settings = { ...settingsOwner.settings, mimoKey: local.settings.mimoKey };
  out.settingsAt = settingsOwner.settingsAt || 0;
  out.sessions = mergeSessions(local.sessions, remote.sessions);
  out.seeded = !!out.seeded;
  out.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
  return out;
}

// ---------- 同步 ----------
const strip = (st) => ({ ...st, settings: { ...st.settings, mimoKey: '' } });
const saveCfg = () => localStorage.setItem(CFG, JSON.stringify(cfg));
export async function syncNow() {
  if (!token || busy) return;
  busy = true; setState('syncing');
  try {
    for (const { id: userId } of USERS) {
    const file = fileFor(userId);
    for (let attempt = 0; attempt < 2; attempt++) {
      let { sha, data } = await readRemote(file);
      if (!data && userId === 'male') {
        const legacy = await readRemote('progress.json');
        data = legacy.data; // Retain the legacy file; create a separate male file.
      }
      const local = getUserState(userId);
      if (data?.mimoKeyEnc && !local.settings.mimoKey) {
        try { local.settings.mimoKey = await decrypt(data.mimoKeyEnc); } catch { /* 口令不一致则忽略 */ }
      }
      const merged = merge(local, data?.state, cfg.bases?.[userId] ?? (userId === 'male' ? cfg.base : null) ?? null);
      const changed = !sha || !data || JSON.stringify(data.state) !== JSON.stringify(strip(merged));
      if (changed) merged.updatedAt = Math.max(Date.now(), merged.updatedAt); // 写回云端的版本比两边都新
      const localChanged = JSON.stringify(strip(local)) !== JSON.stringify(strip(merged));
      replaceState(merged, { silent: true, userId });
      if (localChanged && currentUserId() === userId) window.dispatchEvent(new CustomEvent('wallboard:remote-updated'));
      if (changed) {
        const body = {
          v: 2, salt: cfg.salt, check: data?.check || await encrypt('ok'), state: strip(merged),
          ...(merged.settings.mimoKey ? { mimoKeyEnc: await encrypt(merged.settings.mimoKey) } : {}),
        };
        try { await writeRemote(body, sha, file); } catch (e) { if ((e.status !== 409 && e.status !== 422) || attempt) throw e; continue; }
      }
      cfg.bases ||= {};
      cfg.bases[userId] = merged.updatedAt; saveCfg();
      break;
    }
    }
    syncState.last = Date.now(); setState('ok');
  } catch (e) {
    setState('error', e.status === 401 ? 'Token invalid or expired' : e.status === 403 ? 'Rate-limited or no permission' : e.message === 'Failed to fetch' ? 'Offline' : e.message);
  } finally { busy = false; }
}
// 有改动后最多 60 秒上传一次（正在学习时也会按时上传，不会因为一直有改动而无限推迟）
const schedule = () => { if (token && !timer) timer = setTimeout(() => { timer = null; syncNow(); }, 60000); };

// ---------- 对外接口 ----------
export async function connect({ repo, tokenText, pass }) {
  repo = repo.trim().replace(/^https:\/\/github\.com\//, '');
  const probe = { repo };
  cfg = probe; token = tokenText.trim();
  let remote;
  try {
    remote = await readRemote(fileFor('male'));
    if (!remote.data) remote = await readRemote(fileFor('female'));
    if (!remote.data) remote = await readRemote('progress.json');
  } catch (e) { cfg = null; token = null; throw new Error(e.status === 401 ? 'Token rejected by GitHub' : e.status === 403 ? 'Token has no access to that repo' : e.message); }
  const salt = remote.data?.salt ? b64.dec(remote.data.salt) : crypto.getRandomValues(new Uint8Array(16));
  key = await derive(pass, salt);
  if (remote.data?.check) { try { await decrypt(remote.data.check); } catch { cfg = null; token = null; key = null; throw new Error('Wrong passphrase for the existing data'); } }
  cfg = { repo, salt: b64.enc(salt), tokenEnc: await encrypt(token) };
  saveCfg();
  await keyStore('put', key);
  await syncNow();
}
export async function unlock(pass) {
  key = await derive(pass, b64.dec(cfg.salt));
  try { token = await decrypt(cfg.tokenEnc); } catch { key = null; throw new Error('Wrong passphrase'); }
  await keyStore('put', key);
  syncNow();
}
export async function disconnect() {
  localStorage.removeItem(CFG); await keyStore('del'); cfg = null; key = null; token = null; clearTimeout(timer); timer = null; setState('off');
}
export const syncRepo = () => cfg?.repo || '';

export async function initSync() {
  if (!cfg) return;
  key = await keyStore('get');
  if (!key) return setState('locked');
  try { token = await decrypt(cfg.tokenEnc); } catch { key = null; return setState('locked'); }
  document.addEventListener('visibilitychange', () => syncNow()); // 切后台 / 回到前台时立刻同步
  syncNow();
}
// 解锁 / 连接后也要监听保存
onSave(schedule);
