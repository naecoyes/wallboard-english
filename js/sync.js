// sync.js — 把学习进度同步到私有 GitHub 仓库（纯前端，无后台）
// · 仓库里只有一个 progress.json；GitHub Token 用口令加密（PBKDF2 → AES-GCM）后存在本机
// · 口令派生出的密钥以「不可导出」形式存进 IndexedDB，本机重启后自动解锁；Token 明文只在内存里
// · MiMo Key 也用同一把密钥加密后放进 progress.json，多台设备共用
import { get, replaceState, onSave } from './store.js';

const CFG = 'wallboard-sync-v1';
const FILE = 'progress.json';
const b64 = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
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
async function readRemote() {
  const f = await gh(FILE);
  if (!f) return { sha: null, data: null };
  const bin = atob(f.content.replace(/\n/g, ''));
  return { sha: f.sha, data: JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))) };
}
async function writeRemote(data, sha) {
  const content = b64.enc(utf8(JSON.stringify(data)));
  return gh(FILE, { method: 'PUT', body: JSON.stringify({ message: 'sync progress', content, ...(sha ? { sha } : {}) }) });
}

// ---------- 合并（两边都不会丢数据） ----------
const uniq = (a, b) => [...new Set([...(a || []), ...(b || [])])];
export function merge(local, remote) {
  if (!remote) return local;
  const out = JSON.parse(JSON.stringify(local));
  const newer = (remote.settingsAt || 0) > (local.settingsAt || 0);
  if (newer) { out.settings = { ...local.settings, ...remote.settings, mimoKey: local.settings.mimoKey }; out.sentences.scene = remote.sentences?.scene || out.sentences.scene; out.sentences.pos = { ...out.sentences.pos, ...(remote.sentences?.pos || {}) }; }
  // 进度：取较大值
  const lp = local.profile, rp = remote.profile || {};
  out.profile.xp = Math.max(lp.xp, rp.xp || 0);
  out.profile.level = Math.floor(out.profile.xp / 100) + 1;
  out.profile.bestStreak = Math.max(lp.bestStreak, rp.bestStreak || 0);
  if ((rp.lastCheckIn || '') > (lp.lastCheckIn || '')) { out.profile.lastCheckIn = rp.lastCheckIn; out.profile.streak = rp.streak; }
  // 已掌握 / 学习中：并集（掌握优先）
  const known = uniq(local.words.known, remote.words?.known);
  out.words.known = known;
  out.words.unknown = uniq(local.words.unknown, remote.words?.unknown).filter(w => !known.includes(w));
  if (newer && remote.words) out.words.idx = remote.words.idx;
  out.sentences.known = uniq(local.sentences.known, remote.sentences?.known);
  // 复习卡：按 front 合并，复习次数多的为准
  const cards = new Map(local.cards.map(c => [c.front, c]));
  for (const c of remote.cards || []) {
    const mine = cards.get(c.front);
    if (!mine || (c.reps + c.lapses) > (mine.reps + mine.lapses)) cards.set(c.front, c);
  }
  out.cards = [...cards.values()];
  // 学习记录：同一条取秒数较大的
  const ses = new Map();
  for (const s of [...local.sessions, ...(remote.sessions || [])]) {
    const id = s.timerId || `${s.date}|${s.mode}`;
    const old = ses.get(id);
    if (!old || (s.seconds ?? s.minutes * 60) > (old.seconds ?? old.minutes * 60)) ses.set(id, s);
  }
  out.sessions = [...ses.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-400);
  out.settingsAt = Math.max(local.settingsAt || 0, remote.settingsAt || 0);
  return out;
}

// ---------- 同步 ----------
export async function syncNow() {
  if (!token || busy) return;
  busy = true; setState('syncing');
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { sha, data } = await readRemote();
      const local = get();
      if (data?.mimoKeyEnc && !local.settings.mimoKey) {
        try { local.settings.mimoKey = await decrypt(data.mimoKeyEnc); } catch { /* 口令不一致则忽略 */ }
      }
      const beforeSnap = JSON.stringify({ ...local, settings: { ...local.settings, mimoKey: '' } });
      const merged = merge(local, data?.state);
      const afterSnap = JSON.stringify({ ...merged, settings: { ...merged.settings, mimoKey: '' } });
      replaceState(merged, { silent: true });
      if (beforeSnap !== afterSnap && typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('wallboard:remote-updated'));
      }
      const body = {
        v: 1, salt: cfg.salt, check: data?.check || await encrypt('ok'),
        state: { ...merged, settings: { ...merged.settings, mimoKey: '' } },
        ...(merged.settings.mimoKey ? { mimoKeyEnc: await encrypt(merged.settings.mimoKey) } : {}),
      };
      if (data && JSON.stringify(data.state) === JSON.stringify(body.state)) break; // 没有变化
      try { await writeRemote(body, sha); break; } catch (e) { if (e.status !== 409 && e.status !== 422 || attempt) throw e; }
    }
    syncState.last = Date.now(); setState('ok');
  } catch (e) {
    setState('error', e.status === 401 ? 'Token invalid or expired' : e.status === 403 ? 'Rate-limited or no permission' : e.message === 'Failed to fetch' ? 'Offline' : e.message);
  } finally { busy = false; }
}
const schedule = () => { clearTimeout(timer); if (token) timer = setTimeout(syncNow, 15000); };

// ---------- 对外接口 ----------
export async function connect({ repo, tokenText, pass }) {
  repo = repo.trim().replace(/^https:\/\/github\.com\//, '');
  const probe = { repo };
  cfg = probe; token = tokenText.trim();
  let remote;
  try { remote = await readRemote(); } catch (e) { cfg = null; token = null; throw new Error(e.status === 401 ? 'Token rejected by GitHub' : e.status === 403 ? 'Token has no access to that repo' : e.message); }
  const salt = remote.data?.salt ? b64.dec(remote.data.salt) : crypto.getRandomValues(new Uint8Array(16));
  key = await derive(pass, salt);
  if (remote.data?.check) { try { await decrypt(remote.data.check); } catch { cfg = null; token = null; key = null; throw new Error('Wrong passphrase for the existing data'); } }
  cfg = { repo, salt: b64.enc(salt), tokenEnc: await encrypt(token) };
  localStorage.setItem(CFG, JSON.stringify(cfg));
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
  localStorage.removeItem(CFG); await keyStore('del'); cfg = null; key = null; token = null; clearTimeout(timer); setState('off');
}
export const syncRepo = () => cfg?.repo || '';

export async function initSync() {
  if (!cfg) return;
  key = await keyStore('get');
  if (!key) return setState('locked');
  try { token = await decrypt(cfg.tokenEnc); } catch { key = null; return setState('locked'); }
  document.addEventListener('visibilitychange', () => syncNow());
  syncNow();
}
// 解锁 / 连接后也要监听保存
onSave(schedule);
