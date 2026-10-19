import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import worker, { AccountState, roomName } from '../src/worker.js';
import { MAX_BODY_BYTES, validateEnvelope } from '../src/validation.js';

const ORIGIN = 'https://naecoyes.github.io';
const secret = randomBytes(32).toString('base64url');
const auth = { Authorization: `Bearer ${secret}` };
const profile = () => ({
  version: 1,
  profile: { xp: 0, level: 1, streak: 0, bestStreak: 0, lastCheckIn: null },
  cards: [{ id: 'c1', front: 'hello', back: '你好', example: '', due: '2025-09-01', added: '2025-09-01', interval: 0, ease: 2.5, reps: 0, lapses: 0 }],
  sessions: [{ date: '2025-09-01T12:00:00.000Z', mode: 'word', minutes: 0.5, seconds: 30, timerId: 't1', studyDay: '2025-09-01', result: '' }],
  settings: { mimoKey: 'local-only-key', rate: 0.95, lastBackupHint: null },
  words: { idx: 0, known: [], unknown: [] },
  sentences: { scene: 'all', pos: {}, known: [] },
  reading: { id: null, pos: {}, done: [], level: 'all' },
  audioOverrides: {}, updatedAt: 0, settingsAt: 0, seeded: false,
});
const envelope = (revision = 0) => ({ revision, users: { male: profile(), female: profile() } });

// Models the synchronous SQL cursor and transaction boundary used by the DO.
// Durable Object/runtime integration is separately checked with Wrangler dry-run.
class MockStorage {
  row = undefined;
  commits = 0;
  inTransaction = false;
  sql = {
    exec: (query, ...bindings) => {
      if (query.startsWith('CREATE TABLE')) return { toArray: () => [] };
      if (query.startsWith('SELECT')) return { toArray: () => this.row ? [structuredClone(this.row)] : [] };
      if (query.startsWith('INSERT')) {
        assert.equal(this.inTransaction, true, 'write must occur inside transactionSync');
        this.row = { revision: bindings[0], users: bindings[1] };
        return { toArray: () => [] };
      }
      throw new Error(`Unexpected SQL ${query}`);
    },
  };
  transactionSync(fn) {
    assert.equal(this.inTransaction, false);
    const previous = structuredClone(this.row);
    this.inTransaction = true;
    try { const result = fn(); this.commits++; return result; }
    catch (error) { this.row = previous; throw error; }
    finally { this.inTransaction = false; }
  }
}

function harness(options = {}) {
  const accounts = new Map();
  const seen = { names: [], requests: [], rateKeys: [] };
  const env = {
    ALLOW_LOCAL_ORIGINS: options.local ? 'true' : 'false',
    PUBLIC_RATE_LIMITER: { async limit({ key }) { seen.rateKeys.push(key); return { success: options.rateSuccess ?? true }; } },
    ACCOUNTS: {
      idFromName(name) { seen.names.push(name); return name; },
      get(id) {
        if (!accounts.has(id)) {
          const storage = new MockStorage();
          accounts.set(id, { storage, object: new AccountState({ storage }) });
        }
        return { fetch(request) { seen.requests.push(request.clone()); return accounts.get(id).object.fetch(request); } };
      },
    },
  };
  return {
    env, seen, accounts,
    request(path = '/v1/state', options = {}) {
      return worker.fetch(new Request(`https://sync.example${path}`, {
        ...options,
        headers: { Origin: ORIGIN, ...auth, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      }), env);
    },
    put(body = envelope(), options = {}) {
      return this.request('/v1/state', { method: 'PUT', body: JSON.stringify(body), ...options });
    },
  };
}

test('health is public and state starts at revision zero', async () => {
  const h = harness();
  assert.deepEqual(await (await h.request('/health', { headers: { Authorization: '' } })).json(), { ok: true });
  assert.deepEqual(await (await h.request()).json(), { revision: 0, users: {} });
});

test('PUT persists both profiles, strips every MiMo credential and survives object recreation', async () => {
  const h = harness();
  const input = envelope();
  input.users.male.mimoKeyEnc = { iv: 'old', ct: 'old' };
  input.users.female.extra = { settings: { mimoKey: 'nested-key' }, mimoKeyEnc: 'encrypted-key' };
  const response = await h.put(input);
  assert.equal(response.status, 200);
  const stored = await response.json();
  assert.equal(stored.revision, 1);
  assert.equal(stored.users.female.settings.rate, 0.95);
  assert.equal(JSON.stringify(stored).includes('mimoKey'), false);
  const [{ storage }] = h.accounts.values();
  assert.equal(storage.row.users.includes('local-only-key'), false);
  const recreated = new AccountState({ storage });
  assert.deepEqual(await (await recreated.fetch(new Request('https://internal/v1/state'))).json(), stored);
  assert.deepEqual(await (await h.request()).json(), stored);
  assert.equal(input.users.male.settings.mimoKey, 'local-only-key', 'caller object is unchanged');
});

test('CAS increments once and stale PUT returns exactly the current envelope', async () => {
  const h = harness();
  const first = await (await h.put()).json();
  const stale = await h.put();
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), first);
  const next = envelope(1);
  next.users.female.profile.xp = 50;
  const success = await h.put(next);
  assert.equal(success.status, 200);
  assert.equal((await success.json()).revision, 2);
});

test('concurrent writes serialize: exactly one wins each shared revision', async () => {
  const storage = new MockStorage();
  const object = new AccountState({ storage });
  for (let revision = 0; revision < 5; revision++) {
    const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => {
      const body = envelope(revision);
      body.users.male.profile.xp = index;
      return object.fetch(new Request('https://internal/v1/state', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }));
    }));
    assert.equal(responses.filter(response => response.status === 200).length, 1);
    assert.equal(responses.filter(response => response.status === 409).length, 11);
    const bodies = await Promise.all(responses.map(response => response.json()));
    for (const body of bodies) assert.deepEqual(body, bodies[0]);
    assert.equal(storage.row.revision, revision + 1);
  }
});

test('secret maps only to SHA256 namespace name; no secret forwarded or stored', async () => {
  const h = harness();
  await h.put();
  const hash = createHash('sha256').update(secret, 'utf8').digest('hex');
  assert.equal(await roomName(secret), hash);
  assert.deepEqual(h.seen.names, [hash]);
  assert.equal(h.seen.requests[0].headers.has('Authorization'), false);
  assert.equal(h.seen.requests[0].url.includes(secret), false);
  assert.equal((await h.seen.requests[0].text()).includes(secret), false);
  assert.equal(JSON.stringify(h.seen.rateKeys).includes(secret), false);
  const secondSecret = randomBytes(32).toString('base64url');
  const response = await h.request('/v1/state', { headers: { Authorization: `Bearer ${secondSecret}` } });
  assert.deepEqual(await response.json(), { revision: 0, users: {} });
});

test('rejects missing, malformed, noncanonical and URL-based room credentials', async () => {
  const h = harness();
  for (const Authorization of ['', `Basic ${secret}`, `Bearer ${secret}=`, `Bearer ${'a'.repeat(42)}`, `Bearer ${'a'.repeat(43)}`, `Bearer ${'!'.repeat(43)}`, `Bearer ${secret} extra`]) {
    assert.equal((await h.request('/v1/state', { headers: { Authorization } })).status, 401);
  }
  assert.equal((await h.request(`/v1/state?secret=${secret}`)).status, 400);
  assert.equal(h.accounts.size, 0);
});

test('production CORS permits only exact production origin', async () => {
  const h = harness();
  const ok = await h.request();
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(ok.headers.get('Cache-Control'), 'no-store');
  assert.equal(ok.headers.get('Vary'), 'Origin');
  for (const Origin of ['https://evil.example', 'null', 'https://naecoyes.github.io.evil.example', 'http://localhost:8931', 'http://127.0.0.1:8931']) {
    const denied = await h.request('/v1/state', { headers: { Origin } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.has('Access-Control-Allow-Origin'), false);
  }
  const noOrigin = await worker.fetch(new Request('https://sync.example/v1/state', { headers: auth }), h.env);
  assert.equal(noOrigin.status, 200);
  assert.equal(noOrigin.headers.has('Access-Control-Allow-Origin'), false);
});

test('development CORS permits the two explicit origins only', async () => {
  const h = harness({ local: true });
  for (const Origin of ['http://localhost:8931', 'http://127.0.0.1:8931']) {
    const response = await h.request('/v1/state', { headers: { Origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), Origin);
  }
  assert.equal((await h.request('/v1/state', { headers: { Origin: 'http://localhost:8932' } })).status, 403);
});

test('preflight requires allowed origin, method and headers without bearer auth', async () => {
  const h = harness();
  const headers = { Authorization: '', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization, content-type' };
  const ok = await h.request('/v1/state', { method: 'OPTIONS', headers });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  for (const changes of [{ 'Access-Control-Request-Method': 'POST' }, { 'Access-Control-Request-Headers': 'x-secret' }, { Origin: 'https://evil.example' }]) {
    assert.equal((await h.request('/v1/state', { method: 'OPTIONS', headers: { ...headers, ...changes } })).status, 403);
  }
  assert.equal(h.accounts.size, 0);
});

test('rate limits all public requests before auth or DO access and fails closed', async () => {
  const h = harness({ rateSuccess: false });
  for (const path of ['/health', '/v1/state', '/unknown']) {
    const response = await h.request(path);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '60');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  }
  assert.equal(h.accounts.size, 0);
  assert.equal(h.seen.rateKeys.length, 3);
  delete h.env.PUBLIC_RATE_LIMITER;
  assert.equal((await h.request('/health')).status, 503);
});

test('accepts 2 MiB exactly; rejects oversized declared, actual and streaming bodies', async () => {
  const h = harness();
  const body = envelope();
  body.users.male.padding = '';
  body.users.male.padding = 'x'.repeat(MAX_BODY_BYTES - Buffer.byteLength(JSON.stringify(body)));
  assert.equal(Buffer.byteLength(JSON.stringify(body)), MAX_BODY_BYTES);
  assert.equal((await h.put(body)).status, 200);
  body.users.male.padding += 'x';
  assert.equal((await h.put(body)).status, 413);
  assert.equal((await h.put(envelope(), { headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) } })).status, 413);
  const request = new Request('https://sync.example/v1/state', {
    method: 'PUT', headers: { ...auth, Origin: ORIGIN, 'Content-Type': 'application/json', 'Content-Length': '1' },
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_BODY_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } }),
    duplex: 'half',
  });
  assert.equal((await worker.fetch(request, h.env)).status, 413);
});

test('malformed JSON, UTF8 and non-JSON content type never reach storage', async () => {
  const h = harness();
  assert.equal((await h.request('/v1/state', { method: 'PUT', body: '{' })).status, 400);
  assert.equal((await h.put(envelope(), { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await h.request('/v1/state', { method: 'PUT', body: new Uint8Array([0xff]) })).status, 400);
  assert.equal(h.accounts.size, 0);
});

const badShapes = [
  ['missing second profile', body => { delete body.users.female; }],
  ['extra profile', body => { body.users.other = profile(); }],
  ['empty profile', body => { body.users.female = {}; }],
  ['negative revision', body => { body.revision = -1; }],
  ['fractional revision', body => { body.revision = 0.5; }],
  ['unsafe revision', body => { body.revision = Number.MAX_SAFE_INTEGER; }],
  ['profile array', body => { body.users.male.profile = []; }],
  ['cards object', body => { body.users.female.cards = {}; }],
  ['null card', body => { body.users.male.cards = [null]; }],
  ['bad card due', body => { body.users.male.cards[0].due = 'tomorrow'; }],
  ['negative card interval', body => { body.users.male.cards[0].interval = -1; }],
  ['sessions object', body => { body.users.female.sessions = {}; }],
  ['bad session date', body => { body.users.male.sessions[0].date = 'invalid'; }],
  ['bad minutes', body => { body.users.male.sessions[0].minutes = '3'; }],
  ['string timestamp', body => { body.users.male.updatedAt = '2025-01-01'; }],
  ['null timestamp', body => { body.users.female.updatedAt = null; }],
  ['unbounded timestamp', body => { body.users.female.settingsAt = 9e18; }],
  ['bad progress', body => { body.users.male.words.known = {}; }],
  ['bad paragraph position', body => { body.users.male.reading.pos = { a: -1 }; }],
];
for (const [name, mutate] of badShapes) {
  test(`rejects invalid shape: ${name}`, async () => {
    const h = harness();
    const body = envelope();
    mutate(body);
    assert.equal((await h.put(body)).status, 400);
    assert.equal(h.accounts.size, 0);
  });
}

test('rejects non-finite numeric JSON even when JSON.parse accepts exponent overflow', async () => {
  const h = harness();
  const body = JSON.stringify(envelope()).replace('"updatedAt":0', '"updatedAt":1e999');
  assert.equal((await h.request('/v1/state', { method: 'PUT', body })).status, 400);
  const direct = envelope();
  direct.users.female.updatedAt = NaN;
  assert.throws(() => validateEnvelope(direct), /finite number/);
});

test('rejects dangerous object keys and excessive nesting', async () => {
  const h = harness();
  const unsafe = JSON.stringify(envelope()).replace('"settings":{', '"settings":{"__proto__":{},');
  assert.equal((await h.request('/v1/state', { method: 'PUT', body: unsafe })).status, 400);
  const body = envelope();
  let current = body.users.male;
  for (let depth = 0; depth < 50; depth++) current = current.child = {};
  assert.equal((await h.put(body)).status, 400);
});

test('numeric reading identifiers and provenance are accepted, unsafe values rejected', async () => {
  const h = harness(), body = envelope();
  body.users.male.reading = { id: 42, pos: { 42: 3 }, done: [42, 'article'], level: 'B1' };
  body.users.male.settings.mimoEndpoint = 'https://untrusted.example';
  body.users.male.sessions[0].parts = { t1: { seconds: 30, count: 1 } };
  const response = await h.put(body);
  assert.equal(response.status, 200);
  const stored = await response.json();
  assert.equal(stored.users.male.reading.id, 42);
  assert.equal('mimoEndpoint' in stored.users.male.settings, false);
  for (const bad of [-1, 1.5, {}, true]) {
    body.users.male.reading.id = bad;
    assert.equal((await h.put(body)).status, 400);
  }
});

test('revocation is permanent for all holders and cannot recreate the old room', async () => {
  const h = harness();
  await h.put();
  const preflight = await h.request('/v1/state', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'DELETE' } });
  assert.equal(preflight.status, 204);
  assert.equal((await h.request('/v1/state', { method: 'DELETE' })).status, 200);
  assert.equal((await h.request()).status, 401);
  assert.equal((await h.put(envelope(1))).status, 401);
  const [{ storage }] = h.accounts.values();
  assert.equal(storage.row.users, '{}');
  assert.equal((await new AccountState({ storage }).fetch(new Request('https://internal/v1/state'))).status, 401);
});

test('unsupported routes/methods do not touch account storage', async () => {
  const h = harness();
  assert.equal((await h.request('/unknown')).status, 404);
  assert.equal((await h.request('/v1/state', { method: 'POST' })).status, 405);
  assert.equal((await h.request('/health', { method: 'PUT' })).status, 405);
  assert.equal(h.accounts.size, 0);
});
