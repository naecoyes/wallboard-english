// Automatic cloud sync. A device link grants access to one private two-learner space.
import { CLOUD_SYNC_URL } from './cloud-config.js';
import { USERS, getUserState, currentUserId, replaceState, onSave, compactSessions } from './store.js';
import { mergeProfile, withoutSecrets } from './cloud-merge.js';
const KEY = 'wallboard-cloud-v1';
let config = null;
try { config = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
let busy = false, timer = null, generation = 0, legacy = null;
const listeners = new Set();
export const syncState = { status: config ? 'ready' : CLOUD_SYNC_URL ? 'ready' : 'unconfigured', message: '', last: null };
export const onSyncChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const setState = (status, message = '') => { Object.assign(syncState, { status, message }); listeners.forEach(fn => fn(syncState)); };
function validConfig(value) {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value.secret)) throw new Error('Invalid device link');
  const url = new URL(value.endpoint);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('Sync service must use HTTPS');
  return { endpoint: url.origin, secret: value.secret, base: value.base || {} };
}
function randomSecret() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function persist() { localStorage.setItem(KEY, JSON.stringify(config)); }
async function request(c, method = 'GET', body) {
  const r = await fetch(`${c.endpoint}/v1/state`, { method,
    headers: { Authorization: `Bearer ${c.secret}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const value = await r.json();
  if (r.status === 409) return { conflict: true, ...value };
  if (!r.ok) throw new Error(value.error || `Sync service HTTP ${r.status}`);
  if (method === 'DELETE') return value;
   if (!Number.isInteger(value.revision) || !value.users || typeof value.users !== 'object') throw new Error('Invalid cloud response');
  return value;
}
export async function syncNow() {
  if (legacy) return legacy.syncNow();
  if (!config || busy) return;
  busy = true;
  const c = config, expected = generation;
  setState('syncing');
  try {
    let remote = await request(c);
    for (let attempt = 0; attempt < 4; attempt++) {
      if (expected !== generation) return;
      const users = {}, before = {};
      for (const { id } of USERS) {
        before[id] = withoutSecrets(getUserState(id));
        users[id] = mergeProfile(before[id], remote.users[id], c.base[id]);
        users[id].sessions = compactSessions(users[id].sessions);
      }
      const result = await request(c, 'PUT', { revision: remote.revision, users });
      if (expected !== generation) return;
      if (result.conflict) { remote = result; continue; }
      // Include edits made during the network round trip; never discard fresh local seconds/XP.
      let activeChanged = false;
      for (const { id } of USERS) {
        const local = withoutSecrets(getUserState(id));
        const merged = mergeProfile(local, result.users[id], before[id]);
        if (id === currentUserId() && JSON.stringify(local) !== JSON.stringify(merged)) activeChanged = true;
        replaceState(merged, { silent: true, userId: id });
      }
      c.base = result.users;
      persist();
      syncState.last = Date.now();
      setState('ok');
      if (activeChanged) window.dispatchEvent(new CustomEvent('wallboard:remote-updated'));
      return;
    }
    throw new Error('Other device is updating. Retrying shortly.');
  } catch (e) {
    if (expected === generation) setState('error', navigator.onLine === false ? 'Offline — saved on this device; will retry automatically.' : e.message);
  } finally { busy = false; }
}
async function loadLegacy() {
  if (!legacy) {
    legacy = await import('./github-sync.js');
    legacy.onSyncChange(state => { Object.assign(syncState, state); listeners.forEach(fn => fn(syncState)); });
  }
  return legacy;
}
export const githubAvailable = () => !CLOUD_SYNC_URL && !config;
export async function connect(options) {
  if (options) {
    if (!githubAvailable()) throw new Error('Disconnect cloud sync before connecting GitHub.');
    if (!/^(?:https:\/\/github\.com\/)?[\w.-]+\/[\w.-]+$/.test(options.repo?.trim() || '')) throw new Error('Enter a GitHub owner/repository.');
    if (!options.tokenText?.trim()) throw new Error('Enter a GitHub token.');
    if (typeof options.pass !== 'string' || options.pass.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
    const client = await loadLegacy();
    try { await client.connect(options); }
    catch (error) { setState('unconfigured', error.message); throw error; }
    return;
  }
  if (!CLOUD_SYNC_URL) throw new Error('Cloud service has not been deployed yet. Use GitHub sync or a device link.');
  generation++;
  config = validConfig({ endpoint: CLOUD_SYNC_URL, secret: randomSecret() }); persist();
  await syncNow();
}
export async function disconnect() {
  generation++; config = null; localStorage.removeItem(KEY); clearTimeout(timer); timer = null;
  if (legacy) { await legacy.disconnect(); legacy = null; }
  setState(CLOUD_SYNC_URL ? 'ready' : 'unconfigured');
}
// Room links are shared credentials: revoke disconnects every device using the old link.
export const canShareDevice = () => !!config && !legacy;
export async function revokeDeviceLinks() {
  if (!config) throw new Error('Connect cloud sync first');
  const c = config;
  generation++;
  await request(c, 'DELETE');
  await disconnect();
}
export async function createDeviceLink() {
  if (!config) throw new Error('Connect cloud sync first');
  const url = new URL(location.href); url.hash = 'pair=' + encodeURIComponent(btoa(JSON.stringify({ endpoint: config.endpoint, secret: config.secret })));
  return url.href;
}
export async function pairDevice(link) {
  const url = new URL(link);
  if (url.origin !== location.origin || url.pathname !== location.pathname) throw new Error('Use a device link from this learning site.');
  if (!url.hash.startsWith('#pair=')) throw new Error('Invalid device link');
  const value = validConfig(JSON.parse(atob(decodeURIComponent(url.hash.slice('#pair='.length)))));
  await request(value); // Validate service access before replacing this device's connection.
  if (legacy) { await legacy.disconnect(); legacy = null; }
  generation++; config = value; persist();
  await syncNow();
}
export const syncRepo = () => legacy ? legacy.syncRepo() : config?.endpoint || CLOUD_SYNC_URL;
export async function unlock(pass) { if (legacy) return legacy.unlock(pass); }
function schedule() {
  if (!config || timer) return;
  timer = setTimeout(() => { timer = null; syncNow(); }, 15000);
}
let initialized = false;
async function handlePairRoute() {
  if (!location.hash.startsWith('#pair=')) return false;
  const link = location.href;
  history.replaceState(null, '', location.pathname + location.search + '#settings');
  // replaceState does not emit hashchange: notify the existing app router.
  window.dispatchEvent(new Event('hashchange'));
  if (confirm('Pair this device with the shared learning space? Both learners will sync. Local study time is kept.')) {
    try { await pairDevice(link); } catch (e) { setState('error', e.message); }
  }
  return true;
}
export async function initSync() {
  if (initialized) return;
  initialized = true;
  window.addEventListener('hashchange', handlePairRoute);
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  setInterval(() => { if (!document.hidden) syncNow(); }, 60000);
  if (await handlePairRoute()) return;
  // Continue an existing GitHub connection until a deployed cloud service replaces it.
  if (!config && !CLOUD_SYNC_URL && localStorage.getItem('wallboard-sync-v1')) {
    await (await loadLegacy()).initSync();
  } else if (!config && CLOUD_SYNC_URL) await connect();
  else if (config) await syncNow();
}
onSave(schedule);
