import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../js/sync.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/export /g, '')
  .replace("import('./github-sync.js')", 'Promise.resolve(github)');
function fixture() {
  const data = new Map(), events = new Map(), calls = [];
  let subscriber;
  const github = {
    onSyncChange(fn) { subscriber = fn; },
    async connect(options) { calls.push(options); subscriber({ status: 'ok', message: '', last: 1 }); },
    async disconnect() {}, async initSync() {}, syncRepo() { return calls.length ? 'owner/private' : ''; },
  };
  const location = new URL('https://learning.example/app/#settings');
  const context = vm.createContext({
    CLOUD_SYNC_URL: '', github, URL, Event, console, location, onSave() {},
    localStorage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) },
    window: { addEventListener: (name, fn) => events.set(name, fn), dispatchEvent(event) { calls.push(event.type); } },
    document: { addEventListener() {}, hidden: true },
    history: { replaceState(_state, _title, path) { location.href = new URL(path, location).href; } },
    confirm: () => false, setInterval() {}, setTimeout() {}, clearTimeout() {},
  });
  const api = vm.runInContext(`(()=>{${source};return {connect,initSync,syncState,githubAvailable,syncRepo};})()`, context);
  return { api, location, events, calls };
}
test('undeployed cloud retains GitHub onboarding and forwards repository/token/passphrase', async () => {
  const { api, calls } = fixture();
  assert.equal(api.githubAvailable(), true);
  await assert.rejects(api.connect({ repo: 'owner/private', tokenText: 'test', pass: 'short' }), /12 characters/);
  assert.equal(calls.length, 0);
  const options = { repo: 'owner/private', tokenText: 'offline-fixture', pass: 'fixture-passphrase' };
  await api.connect(options);
  assert.deepEqual(calls[0], options);
  assert.equal(api.syncState.status, 'ok');
  assert.equal(api.syncRepo(), 'owner/private');
});
test('pair links opened after startup are scrubbed and route to settings even when declined', async () => {
  const { api, location, events, calls } = fixture();
  await api.initSync();
  location.hash = '#pair=private-link';
  await events.get('hashchange')();
  assert.equal(location.hash, '#settings');
  assert.equal(calls.includes('hashchange'), true);
});
