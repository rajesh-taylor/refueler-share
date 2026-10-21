// UUID-Out-Of-Path-1 (21 Oct 2026) — no transfer UUID in any path on the API.
// Cloudflare's sampled HTTP-request records keep client IP + host + path for at
// least 31 days; headers are not in them. Plan: private docs/UUID-Out-Of-Path-plan-v1.md.
//
//   • every transfer route is a fixed path: no X-Transfer-UUID (or a bad one) → 400
//   • /download takes the part from X-Part
//   • /unlock keeps both rate limits (per IP, per UUID)
//   • HMAC canonical v2 signs the UUID line: a swapped header or a v1 signature → 401
//   • preflight: X-Part allowed, Max-Age 7200, one fixed URL per route
//   • every moved route answers no-store; nothing uses caches.default
//   • the error log records the fixed path, never a UUID
//   • the old path shapes 404 (removed at deploy 2)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/turnstile.js', () => ({
  verifyTurnstileToken: vi.fn(async () => true),
  verifyTurnstile:      vi.fn(async () => true),
}));

import worker from '../src/index.js';
import indexSrc from '../src/index.js?raw';
import { transferUuid } from '../src/utils.js';
import { forgetApiKey } from '../src/api_store.js';
import { makeBucket, makeKV } from './_r2_mock.js';
import { makeSupabase, makeEnv, seedClient as seed, signedRequest, ctx, ORIGIN } from './helpers/api-fake.js';
import { transferRequest } from './helpers/transfer-request.js';

const UUID  = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER = '6a1b0c3e-1f2d-4e5f-8a9b-0c1d2e3f4a5b';
const NOW   = Math.floor(Date.now() / 1000);
const APP   = 'https://share.refueler.io';

const ROUTES = [
  ['POST',   '/upload/initiate'],
  ['POST',   '/upload/urls'],
  ['POST',   '/upload/finalise'],
  ['POST',   '/unlock'],
  ['GET',    '/meta'],
  ['GET',    '/download'],
  ['DELETE', '/transfer'],
  ['POST',   '/confirm'],
  ['GET',    '/timestamp/seal'],
  ['GET',    '/api/v1/receipt/acceptance'],
];

const liveManifest = { uuid: UUID, total_chunks: 1, expiry_timestamp: NOW + 86400, file_name: 'encrypted-payload' };
const plainEnv = (manifest = liveManifest) => ({
  BUCKET:    makeBucket(manifest ? { [`${UUID}/manifest.json`]: { uploaded: NOW, body: JSON.stringify(manifest) } } : {}),
  STATUS_KV: makeKV(),
  APP_ORIGINS: APP,
  AUTH_PEPPER: 'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=',   // 32 bytes, base64
});
const init = (method, headers = {}) =>
  ({ method, headers: { Origin: APP, 'Content-Type': 'application/json', ...headers }, ...(method === 'POST' ? { body: '{}' } : {}) });

describe('transferUuid()', () => {
  it('reads X-Transfer-UUID, trimmed and lower-cased; anything else is null', () => {
    const r = (v) => new Request('https://w.test/meta', v === undefined ? {} : { headers: { 'X-Transfer-UUID': v } });
    expect(transferUuid(r(UUID))).toBe(UUID);
    expect(transferUuid(r(` ${UUID.toUpperCase()} `))).toBe(UUID);
    for (const bad of [undefined, '', 'not-a-uuid', '-'.repeat(36), `${UUID}x`, UUID.slice(1)]) {
      expect(transferUuid(r(bad))).toBeNull();
    }
  });
});

describe('fixed paths — the UUID comes from X-Transfer-UUID only', () => {
  for (const [method, path] of ROUTES) {
    it(`${method} ${path}: no header or a bad one → 400 missing_transfer_id, with CORS`, async () => {
      for (const headers of [{}, { 'X-Transfer-UUID': 'nope' }, { 'X-Transfer-UUID': '-'.repeat(36) }]) {
        const res = await worker.fetch(new Request(`${ORIGIN}${path}`, init(method, headers)), plainEnv(), ctx);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'missing_transfer_id' });
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP);
        expect(res.headers.get('Cache-Control')).toContain('no-store');
      }
    });
  }

  it('a UUID in the query string is never read', async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/meta?uuid=${UUID}`), plainEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('GET /meta with the header answers for that transfer', async () => {
    const res = await worker.fetch(transferRequest(`${ORIGIN}/meta`, UUID), plainEnv(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).total_chunks).toBe(1);
    const gone = await worker.fetch(transferRequest(`${ORIGIN}/meta`, OTHER), plainEnv(), ctx);
    expect(gone.status).toBe(404);
  });

  it('a path with a UUID after a fixed route is not a route', async () => {
    for (const p of [`/meta/${UUID}/x`, `/unlock/${UUID}`, `/download/${UUID}`, `/upload/initiate/${UUID}`]) {
      const res = await worker.fetch(new Request(`${ORIGIN}${p}`), plainEnv(), ctx);
      expect(res.status).toBe(404);
    }
  });
});

describe('GET /download — part in X-Part', () => {
  const parts = { [`${UUID}/0000`]: { uploaded: NOW, body: 'cipher' } };
  const env = () => ({ ...plainEnv(), BUCKET: makeBucket({
    [`${UUID}/manifest.json`]: { uploaded: NOW, body: JSON.stringify(liveManifest) }, ...parts,
  }) });

  it('no X-Part, or not four digits → 400 missing_part', async () => {
    for (const part of [undefined, '', '7', '00001', 'abcd', '-001']) {
      const headers = part === undefined ? {} : { 'X-Part': part };
      const res = await worker.fetch(transferRequest(`${ORIGIN}/download`, UUID, { headers }), env(), ctx);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'missing_part' });
    }
  });

  it('part 0000 streams, private no-store, and no longer echoes the UUID', async () => {
    const res = await worker.fetch(transferRequest(`${ORIGIN}/download`, UUID, {}, 0), env(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Chunk-Index')).toBe('0');
    expect(res.headers.get('X-Transfer-UUID')).toBeNull();
  });

  it('a part that does not exist is refused as before', async () => {
    const res = await worker.fetch(transferRequest(`${ORIGIN}/download`, UUID, {}, 1), env(), ctx);
    expect(res.status).toBe(404);
  });
});

describe('POST /unlock — rate limits unchanged', () => {
  const pwManifest = { ...liveManifest, p2sh_secret_hash: 'ab'.repeat(32) };
  const unlock = (env, ip, uuid = UUID) => worker.fetch(transferRequest(`${ORIGIN}/unlock`, uuid, {
    method: 'POST', headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase: 'wrong' }),
  }), env, ctx);

  it('5 per IP per minute', async () => {
    const env = plainEnv(pwManifest);
    for (let i = 0; i < 5; i++) expect((await unlock(env, '198.51.100.1')).status).toBe(401);
    expect((await unlock(env, '198.51.100.1')).status).toBe(429);
  }, 20000);

  it('10 per UUID per minute, whatever the IP; another UUID is unaffected', async () => {
    const env = plainEnv(pwManifest);
    for (let i = 0; i < 10; i++) expect((await unlock(env, `198.51.100.${10 + i}`)).status).toBe(401);
    expect((await unlock(env, '198.51.100.99')).status).toBe(429);
    expect((await unlock(env, '198.51.100.98', OTHER)).status).toBe(404);
  }, 20000);

  it('the old /auth/{uuid} was the password route; /auth/* now belongs to sign-in only', () => {
    expect(indexSrc).not.toMatch(/path === '\/auth'/);
  });
});

describe('HMAC canonical v2 — the transfer UUID is signed', () => {
  let sb;
  beforeEach(() => {
    forgetApiKey();
    sb = makeSupabase();
    vi.stubGlobal('fetch', async (url, opts = {}) => sb.fetchImpl(url, opts));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const receipt = (client, headers) => signedRequest('GET', '/api/v1/receipt/acceptance', client, '', headers);

  it('a good v2 signature passes auth (404: no receipt for this transfer)', async () => {
    const env = makeEnv(); const c = await seed(sb);
    const res = await worker.fetch(await receipt(c, { 'X-Transfer-UUID': UUID }), env, ctx);
    expect(res.status).toBe(404);
  });

  it('the same signed request replayed with a swapped X-Transfer-UUID → 401', async () => {
    const env = makeEnv(); const c = await seed(sb);
    const signed = await receipt(c, { 'X-Transfer-UUID': UUID });
    const headers = new Headers(signed.headers);
    headers.set('X-Transfer-UUID', OTHER);
    const res = await worker.fetch(new Request(signed.url, { method: 'GET', headers }), env, ctx);
    expect(res.status).toBe(401);
  });

  it('a v1 signature (no UUID line) → 401', async () => {
    const env = makeEnv(); const c = await seed(sb);
    const signedNoUuid = await receipt(c, {});                 // signs an empty UUID line
    const headers = new Headers(signedNoUuid.headers);
    headers.set('X-Transfer-UUID', UUID);                       // then names a transfer
    const res = await worker.fetch(new Request(signedNoUuid.url, { method: 'GET', headers }), env, ctx);
    expect(res.status).toBe(401);
  });

  it('upper-case header signs the same as lower-case (one canonical form)', async () => {
    const env = makeEnv(); const c = await seed(sb);
    const res = await worker.fetch(await receipt(c, { 'X-Transfer-UUID': UUID.toUpperCase() }), env, ctx);
    expect(res.status).toBe(404);
  });
});

describe('CORS preflight', () => {
  const preflight = (path, origin = APP) => worker.fetch(new Request(`${ORIGIN}${path}`, {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-transfer-uuid, x-part' },
  }), plainEnv(), ctx);

  it('every transfer route allows X-Transfer-UUID + X-Part and caches the answer 7200 s', async () => {
    for (const [, path] of ROUTES) {
      const res = await preflight(path);
      expect(res.status).toBe(204);
      const allowed = res.headers.get('Access-Control-Allow-Headers').split(/,\s*/);
      expect(allowed).toContain('X-Transfer-UUID');
      expect(allowed).toContain('X-Part');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('7200');
    }
  });

  it('localhost echo still never meets credentials on initiate', async () => {
    const res = await preflight('/upload/initiate', 'http://localhost:8181');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(res.headers.get('Access-Control-Max-Age')).toBe('7200');
  });
});

describe('caching — many transfers now share one URL', () => {
  it('every moved route answers no-store (404 / 410 / 400 alike)', async () => {
    for (const [method, path] of ROUTES) {
      const res = await worker.fetch(transferRequest(`${ORIGIN}${path}`, OTHER, init(method), path === '/download' ? 0 : null), plainEnv(null), ctx);
      expect(res.headers.get('Cache-Control') ?? '', `${method} ${path} → ${res.status}`).toContain('no-store');
    }
  });

  it('the Worker never uses the Cache API', () => {
    expect(indexSrc).not.toMatch(/caches\.default|caches\.open/);
  });
});

describe('error log — the fixed path, never a UUID', () => {
  it('a 404 on /meta logs path "/meta"', async () => {
    const env = plainEnv(null);
    const waits = [];
    await worker.fetch(transferRequest(`${ORIGIN}/meta`, UUID), env, { waitUntil: (p) => waits.push(p), passThroughOnException() {} });
    await Promise.all(waits);
    const logged = JSON.stringify(env.STATUS_KV._log.puts.map((p) => p.opts?.metadata));
    expect(logged).toContain('"path":"/meta"');
    expect(logged).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

// ── Deploy 2: the old path shapes are gone ───────────────────────────────────
describe('old path shapes → 404, nothing read', () => {
  const OLD = [
    ['POST', `/upload/${UUID}/initiate`], ['POST', `/upload/${UUID}/urls`], ['POST', `/upload/${UUID}/finalise`],
    ['POST', `/auth/${UUID}`], ['GET', `/meta/${UUID}`], ['GET', `/download/${UUID}/0000`],
    ['DELETE', `/transfer/${UUID}`], ['POST', `/confirm/${UUID}`], ['GET', `/timestamp/seal/${UUID}`],
    ['GET', `/api/v1/receipt/${UUID}/acceptance`], ['GET', `/api/v1/receipt/${UUID}/collection`],
  ];
  for (const [method, path] of OLD) {
    it(`${method} ${path.replace(UUID, '{uuid}')} → 404`, async () => {
      const res = await worker.fetch(new Request(`${ORIGIN}${path}`, init(method)), plainEnv(), ctx);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('Not found');
    });
  }
});
