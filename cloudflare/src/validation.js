export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = message => { throw new HttpError(400, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string';
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const timestamp = value => number(value) && value <= 8.64e15;
const date = value => text(value) && value.length <= 40 && Number.isFinite(Date.parse(value));
const day = value => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && date(value)
  && new Date(value).toISOString().slice(0, 10) === value;
const readingId = value => text(value) || integer(value);
const strings = value => Array.isArray(value) && value.every(text);
function requireValue(valid, path) { if (!valid) fail(`Invalid ${path}`); }

// Strip credentials at every depth, including obsolete encrypted GitHub-sync keys.
// Also reject non-JSON numbers and unsafe object keys before any storage operation.
function sanitize(value, depth = 0) {
  if (depth > 40) fail('State is nested too deeply');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    requireValue(Number.isFinite(value), 'finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(item => sanitize(item, depth + 1));
  requireValue(object(value), 'JSON value');
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'mimoKey' || key === 'mimoKeyEnc' || key === 'mimoEndpoint') continue;
    requireValue(!['__proto__', 'constructor', 'prototype'].includes(key), 'object key');
    clean[key] = sanitize(item, depth + 1);
  }
  return clean;
}

function validateState(state, id) {
  const at = path => `users.${id}.${path}`;
  requireValue(object(state), `users.${id}`);
  requireValue(Number.isSafeInteger(state.version) && state.version >= 1, at('version'));
  requireValue(object(state.profile), at('profile'));
  for (const field of ['xp', 'level', 'streak', 'bestStreak']) {
    requireValue(integer(state.profile[field]), at(`profile.${field}`));
  }
  if (state.profile.lastCheckIn != null) requireValue(day(state.profile.lastCheckIn), at('profile.lastCheckIn'));
  if ('nickname' in state.profile) requireValue(text(state.profile.nickname), at('profile.nickname'));
  requireValue(object(state.settings), at('settings'));
  if (state.settings.lastBackupHint != null) requireValue(date(state.settings.lastBackupHint), at('settings.lastBackupHint'));
  requireValue(timestamp(state.updatedAt), at('updatedAt'));
  if ('settingsAt' in state) requireValue(timestamp(state.settingsAt), at('settingsAt'));
  if ('seeded' in state) requireValue(typeof state.seeded === 'boolean', at('seeded'));

  requireValue(Array.isArray(state.cards), at('cards'));
  for (const card of state.cards) {
    requireValue(object(card), at('cards[]'));
    for (const field of ['id', 'front', 'back']) requireValue(text(card[field]), at(`cards[].${field}`));
    requireValue(card.id.length > 0, at('cards[].id'));
    if ('example' in card) requireValue(text(card.example), at('cards[].example'));
    for (const field of ['due', 'added']) requireValue(day(card[field]), at(`cards[].${field}`));
    for (const field of ['interval', 'ease']) requireValue(number(card[field]), at(`cards[].${field}`));
    for (const field of ['reps', 'lapses']) requireValue(integer(card[field]), at(`cards[].${field}`));
  }
  requireValue(Array.isArray(state.sessions), at('sessions'));
  for (const session of state.sessions) {
    requireValue(object(session), at('sessions[]'));
    requireValue(date(session.date), at('sessions[].date'));
    requireValue(text(session.mode) && session.mode.length > 0, at('sessions[].mode'));
    requireValue(number(session.minutes), at('sessions[].minutes'));
    if ('seconds' in session) requireValue(number(session.seconds), at('sessions[].seconds'));
    if ('count' in session) requireValue(integer(session.count), at('sessions[].count'));
    if ('parts' in session) {
      requireValue(object(session.parts), at('sessions[].parts'));
      for (const part of Object.values(session.parts)) requireValue(object(part) && number(part.seconds) && integer(part.count), at('sessions[].parts[]'));
    }
    if ('studyDay' in session) requireValue(day(session.studyDay), at('sessions[].studyDay'));
    for (const field of ['timerId', 'result']) if (field in session) requireValue(text(session[field]), at(`sessions[].${field}`));
  }
  if ('words' in state) {
    requireValue(object(state.words) && integer(state.words.idx) && strings(state.words.known) && strings(state.words.unknown), at('words'));
  }
  for (const section of ['sentences', 'reading']) {
    if (!(section in state)) continue;
    const value = state[section];
    requireValue(object(value) && object(value.pos), at(section));
    requireValue(Object.values(value.pos).every(integer), at(`${section}.pos`));
    if (section === 'sentences') requireValue(text(value.scene) && strings(value.known), at(section));
    else requireValue((value.id === null || readingId(value.id)) && text(value.level) && Array.isArray(value.done) && value.done.every(readingId), at(section));
  }
  if ('xpBase' in state) requireValue(integer(state.xpBase), at('xpBase'));
  if ('xpEvents' in state) requireValue(object(state.xpEvents) && Object.values(state.xpEvents).every(integer), at('xpEvents'));
  if ('audioOverrides' in state) {
    requireValue(object(state.audioOverrides) && Object.values(state.audioOverrides).every(value => value === 'mimo' || value === 'system'), at('audioOverrides'));
  }
}

export function validateEnvelope(value) {
  requireValue(object(value) && Object.keys(value).length === 2 && 'revision' in value && 'users' in value, 'state envelope');
  requireValue(integer(value.revision) && value.revision < Number.MAX_SAFE_INTEGER, 'revision');
  requireValue(object(value.users) && Object.keys(value.users).length === 2 && 'male' in value.users && 'female' in value.users, 'both users');
  const clean = sanitize(value);
  for (const id of ['male', 'female']) validateState(clean.users[id], id);
  return clean;
}

export async function readEnvelope(request) {
  const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json');
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new HttpError(413, 'State exceeds 2 MiB');
  }
  const reader = request.body?.getReader();
  if (!reader) fail('JSON body required');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, 'State exceeds 2 MiB');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('Invalid JSON'); }
  return validateEnvelope(parsed);
}
