// Baseline-aware merges: independent fields/items survive; deletion wins over an unchanged item.
const clone = value => value === undefined ? undefined : structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const seconds = r => Number.isFinite(r.seconds) ? r.seconds : (r.minutes || 0) * 60;
export const sessionId = r => r.timerId || `${r.date}|${r.mode}`;
export function sessionTotals(parts) {
  let seconds = 0, count = 0, legacySeconds = 0, legacyCount = 0;
  for (const [id, part] of Object.entries(parts)) {
    if (id.startsWith('agg:')) {
      legacySeconds = Math.max(legacySeconds, part.seconds);
      legacyCount = Math.max(legacyCount, part.count);
    } else { seconds += part.seconds; count += part.count; }
  }
  // Old aggregates discarded membership; retain their lower bound without counting
  // potentially overlapping raw records twice. New aggregates retain exact IDs.
  return { seconds: Math.max(seconds, legacySeconds), count: Math.max(count, legacyCount) };
}
export function sessionParts(record) {
  return record.parts || { [sessionId(record)]: { seconds: seconds(record), count: record.count || 1 } };
}
export function mergeSessions(local = [], remote = []) {
  const map = new Map();
  for (const record of [...remote, ...local]) {
    const id = sessionId(record), old = map.get(id);
    if (old && (record.parts || old.parts)) {
      const parts = { ...sessionParts(old) };
      for (const [key, part] of Object.entries(sessionParts(record))) {
        if (!parts[key] || part.seconds > parts[key].seconds) parts[key] = clone(part);
      }
      const { seconds: sec, count } = sessionTotals(parts);
      map.set(id, { ...old, ...record, parts, seconds: sec, minutes: sec / 60, count });
    } else if (!old || seconds(record) > seconds(old)) map.set(id, clone(record));
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function mergeValue(local, remote, base, localWins) {
  if (equal(local, remote)) return clone(local);
  if (equal(local, base)) return clone(remote);
  if (equal(remote, base)) return clone(local);
  if (object(local) && object(remote)) {
    const out = {};
    for (const key of new Set([...Object.keys(base || {}), ...Object.keys(remote), ...Object.keys(local)])) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      const value = mergeValue(local[key], remote[key], base?.[key], localWins);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  if (Array.isArray(local) && Array.isArray(remote)) {
    const all = [...local, ...remote, ...(Array.isArray(base) ? base : [])];
    const keyed = all.every(item => object(item) && typeof item.id === 'string');
    const primitive = all.every(item => typeof item === 'string' || typeof item === 'number');
    if (keyed || primitive) {
      const key = item => keyed ? item.id : JSON.stringify(item);
      const asMap = items => new Map((items || []).map(item => [key(item), item]));
      const l = asMap(local), r = asMap(remote), b = asMap(base);
      return [...new Set([...l.keys(), ...r.keys(), ...b.keys()])].flatMap(id => {
        const value = mergeValue(l.get(id), r.get(id), b.get(id), localWins);
        return value === undefined ? [] : [value];
      });
    }
  }
  return clone(localWins ? local : remote);
}
const eventSum = events => Object.values(events || {}).reduce((n, v) => n + (Number.isSafeInteger(v) && v > 0 ? v : 0), 0);
export function mergeProfile(local, remote, base = null) {
  if (!remote) return withoutSecrets(local);
  if (!local) return withoutSecrets(remote);
  const localWins = (local.updatedAt || 0) >= (remote.updatedAt || 0);
  const out = mergeValue(local, remote, base, localWins);
  out.sessions = mergeSessions(local.sessions, remote.sessions);
  // XP events are immutable awards. Legacy totals already containing known awards must
  // not become a second baseline. A shared baseline identifies later legacy increments.
  out.xpEvents = { ...remote.xpEvents, ...local.xpEvents };
  const events = eventSum(out.xpEvents);
  const baseline = state => {
    if (Number.isFinite(state.xpBase)) return Math.max(state.xpBase, (state.profile?.xp || 0) - eventSum(state.xpEvents));
    if (base) return (base.xpBase ?? base.profile?.xp ?? 0) + Math.max(0, (state.profile?.xp || 0) - (base.profile?.xp || 0));
    return Math.max(0, (state.profile?.xp || 0) - events);
  };
  out.xpBase = Math.max(baseline(local), baseline(remote));
  const xp = out.xpBase + events;
  out.profile = { ...out.profile, xp, level: Math.floor(xp / 100) + 1 };
  out.settings = mergeValue(local.settings || {}, remote.settings || {}, base?.settings, (local.settingsAt || 0) >= (remote.settingsAt || 0));
  delete out.settings.mimoKey;
  delete out.settings.mimoEndpoint;
  out.settingsAt = Math.max(local.settingsAt || 0, remote.settingsAt || 0);
  out.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
  return out;
}
export function withoutSecrets(state) {
  const out = clone(state);
  if (!out) return out;
  // Also remove obsolete credentials nested in older backup formats.
  const scrub = value => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (['mimoKey', 'mimoKeyEnc', 'mimoEndpoint'].includes(key)) delete value[key];
      else scrub(value[key]);
    }
  };
  scrub(out);
  return out;
}
