import { HttpError, readEnvelope } from './validation.js';

const PRODUCTION_ORIGIN = 'https://naecoyes.github.io';
const LOCAL_ORIGINS = new Set(['http://localhost:8931', 'http://127.0.0.1:8931']);
const SECRET = /^Bearer ([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/;

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export async function roomName(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function corsResponse(response, origin, allowed) {
  const result = new Response(response.body, response);
  result.headers.set('Vary', 'Origin');
  result.headers.set('Cache-Control', 'no-store');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  if (origin && allowed) {
    result.headers.set('Access-Control-Allow-Origin', origin);
    result.headers.set('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
    result.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    result.headers.set('Access-Control-Max-Age', '600');
  }
  return result;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = !origin || origin === PRODUCTION_ORIGIN || (env.ALLOW_LOCAL_ORIGINS === 'true' && LOCAL_ORIGINS.has(origin));
    let response;
    try {
      // Cloudflare overwrites CF-Connecting-IP. Count all public requests, including
      // invalid auth and preflights, before any Durable Object can be instantiated.
      if (!env.PUBLIC_RATE_LIMITER) throw new HttpError(503, 'Rate limiter unavailable');
      const { success } = await env.PUBLIC_RATE_LIMITER.limit({ key: `ip:${request.headers.get('CF-Connecting-IP') || 'local'}` });
      if (!success) throw new HttpError(429, 'Too many requests');
      if (!allowed) throw new HttpError(403, 'Origin not allowed');
      const url = new URL(request.url);
      if (url.search) throw new HttpError(400, 'Query parameters are not supported');
      const path = url.pathname;
      if (path !== '/health' && path !== '/v1/state') throw new HttpError(404, 'Not found');
      if (request.method === 'OPTIONS') {
        const method = request.headers.get('Access-Control-Request-Method');
        const headers = (request.headers.get('Access-Control-Request-Headers') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
        if (!origin || !['GET', ...(path === '/v1/state' ? ['PUT', 'DELETE'] : [])].includes(method)
          || headers.some(value => !['authorization', 'content-type'].includes(value))) {
          throw new HttpError(403, 'Preflight not allowed');
        }
        response = new Response(null, { status: 204 });
      } else if (path === '/health') {
        response = request.method === 'GET' ? json({ ok: true }) : json({ error: 'Method not allowed' }, 405, { Allow: 'GET, OPTIONS' });
      } else {
        if (!['GET', 'PUT', 'DELETE'].includes(request.method)) throw new HttpError(405, 'Method not allowed');
        const secret = SECRET.exec(request.headers.get('Authorization') || '')?.[1];
        if (!secret) throw new HttpError(401, 'Valid room secret required');
        const body = request.method === 'PUT' ? await readEnvelope(request) : undefined;
        const id = env.ACCOUNTS.idFromName(await roomName(secret));
        const stub = env.ACCOUNTS.get(id);
        // Build a fresh request: the room secret never reaches Durable Object storage,
        // its request headers, the URL, or a rate-limit key.
        response = await stub.fetch(new Request('https://account.internal/v1/state', {
          method: request.method,
          ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
        }));
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      // Do not log request data, headers, bodies, credentials or exception strings.
      response = json({ error: status === 500 ? 'Internal server error' : error.message }, status,
        status === 401 ? { 'WWW-Authenticate': 'Bearer' } : status === 429 ? { 'Retry-After': '60' } : {});
    }
    return corsResponse(response, origin, allowed);
  },
};

// A fetch-only Durable Object class keeps the same module usable in node:test.
// Its migration explicitly chooses the SQLite storage backend.
export class AccountState {
  constructor(ctx) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS account_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, users TEXT NOT NULL)');
  }

  current() {
    const row = this.sql.exec('SELECT revision, users FROM account_state WHERE id = 1').toArray()[0];
    return row ? { revision: row.revision, users: JSON.parse(row.users) } : { revision: 0, users: {} };
  }

  async fetch(request) {
    try {
      if (new URL(request.url).pathname !== '/v1/state') throw new HttpError(404, 'Not found');
      if (this.current().revision === -1) throw new HttpError(401, 'This device link has been revoked');
      if (request.method === 'GET') return json(this.current());
      if (request.method === 'DELETE') return this.storage.transactionSync(() => {
        this.sql.exec('INSERT INTO account_state (id, revision, users) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, users = excluded.users', -1, '{}');
        return json({ revoked: true });
      });
      if (request.method !== 'PUT') throw new HttpError(405, 'Method not allowed');
      const incoming = await readEnvelope(request);
      // No await between read and write. transactionSync atomically commits the
      // comparison and update, even when requests finish body reads concurrently.
      return this.storage.transactionSync(() => {
        const current = this.current();
        if (current.revision === -1) throw new HttpError(401, 'This device link has been revoked');
        if (incoming.revision !== current.revision) return json(current, 409);
        const next = { revision: current.revision + 1, users: incoming.users };
        this.sql.exec('INSERT INTO account_state (id, revision, users) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, users = excluded.users', next.revision, JSON.stringify(next.users));
        return json(next);
      });
    } catch (error) {
      return json({ error: error instanceof HttpError ? error.message : 'Internal server error' }, error instanceof HttpError ? error.status : 500);
    }
  }
}
