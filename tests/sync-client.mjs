import test from 'node:test';
import assert from 'node:assert/strict';
const data = new Map();
globalThis.localStorage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class {};
const store = await import('../js/store.js');
store.save(true);
const base = structuredClone(store.get());
localStorage.setItem('wallboard-cloud-v1', JSON.stringify({ endpoint: 'https://offline.test', secret: 'A'.repeat(43), base: { male: base, female: structuredClone(store.getUserState('female')) } }));
const sync = await import('../js/sync.js');
test('CAS retry and edits during PUT preserve remote fields, fresh local edits and XP exactly once', async () => {
  let puts = 0;
  let remote = { revision: 1, users: { male: structuredClone(base), female: structuredClone(store.getUserState('female')) } };
  remote.users.male.reading.pos[8] = 2;
  remote.users.male.updatedAt = Date.now() + 10;
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'GET') return Response.json(remote);
    if (options.method === 'DELETE') return Response.json({ revoked: true });
    const incoming = JSON.parse(options.body);
    puts++;
    if (puts === 1) {
      remote.revision++;
      remote.users.male.words.known.push('remote');
      return Response.json(remote, { status: 409 });
    }
    remote = { revision: remote.revision + 1, users: incoming.users };
    store.update(s => { s.reading.pos[9] = 5; });
    store.addXP(10);
    return Response.json(remote);
  };
  await sync.syncNow();
  assert.equal(sync.syncState.status, 'ok');
  assert.equal(puts, 2);
  assert.deepEqual(store.get().reading.pos, { 8: 2, 9: 5 });
  assert.deepEqual(store.get().words.known, ['remote']);
  assert.equal(store.get().profile.xp, 10);
  assert.equal('mimoEndpoint' in remote.users.male.settings, false);
  await sync.revokeDeviceLinks();
  assert.equal(localStorage.getItem('wallboard-cloud-v1'), null);
});
