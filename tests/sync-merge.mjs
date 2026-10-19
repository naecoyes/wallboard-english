import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeProfile, mergeSessions, withoutSecrets } from '../js/cloud-merge.js';
const profile = () => ({ profile: { xp: 100, level: 2 }, settings: { rate: 1 }, cards: [{ id: 'a', front: 'a', back: 'A' }], sessions: [], words: { idx: 0, known: ['old'], unknown: [] }, reading: { id: 1, pos: { 1: 0 }, done: [] }, updatedAt: 1 });
test('independent fields, keyed items, set additions and deletions survive a three-way merge', () => {
  const base = profile(), local = structuredClone(base), remote = structuredClone(base);
  local.cards[0].front = 'edited'; local.words.known = []; local.reading.pos[1] = 3;
  remote.cards[0].back = 'translated'; remote.words.known.push('new'); remote.reading.pos[2] = 4; remote.updatedAt = 99;
  const merged = mergeProfile(local, remote, base);
  assert.deepEqual(merged.cards, [{ id: 'a', front: 'edited', back: 'translated' }]);
  assert.deepEqual(merged.words.known, ['new']);
  assert.deepEqual(merged.reading.pos, { 1: 3, 2: 4 });
  local.cards = []; remote.cards = structuredClone(base.cards);
  assert.deepEqual(mergeProfile(local, remote, base).cards, []);
});
test('setting fields merge separately and local credentials/endpoint never leave device', () => {
  const base = profile(), local = structuredClone(base), remote = structuredClone(base);
  local.settings.rate = 0.7; remote.settings.theme = 'dark'; remote.settings.mimoEndpoint = 'https://bad.example';
  local.settings.mimoKey = 'secret'; local.settings.mimoEndpoint = 'https://local.example';
  const merged = mergeProfile(local, remote, base);
  assert.deepEqual(merged.settings, { rate: 0.7, theme: 'dark' });
  assert.equal(JSON.stringify(withoutSecrets({ nested: { mimoKeyEnc: 'secret', mimoEndpoint: 'bad' } })).includes('secret'), false);
});
test('XP mixed legacy migration does not count existing awards twice', () => {
  const legacy = profile(), migrated = profile();
  migrated.xpBase = 100; migrated.xpEvents = { a: 20 }; migrated.profile.xp = 120;
  legacy.profile.xp = 120;
  assert.equal(mergeProfile(legacy, migrated).profile.xp, 120);
  const base = structuredClone(migrated);
  legacy.profile.xp = 130;
  const next = mergeProfile(legacy, migrated, base);
  assert.equal(next.profile.xp, 130);
  assert.equal(mergeProfile(next, migrated, base).profile.xp, 130);
  const other = structuredClone(migrated); other.xpEvents.b = 30; other.profile.xp = 150;
  assert.equal(mergeProfile(next, other, base).profile.xp, 160);
});
test('aggregate provenance unions disjoint sessions and keeps max for the same timer', () => {
  const record = parts => ({ timerId: 'agg:2020-01-01:focus', date: '2020-01-01', mode: 'focus', seconds: 60, parts });
  const merged = mergeSessions([record({ a: { seconds: 60, count: 1 } })], [record({ b: { seconds: 90, count: 1 }, a: { seconds: 30, count: 1 } })]);
  assert.equal(merged[0].seconds, 150);
  assert.equal(merged[0].count, 2);
  assert.deepEqual(mergeSessions(merged, merged), merged);
});
