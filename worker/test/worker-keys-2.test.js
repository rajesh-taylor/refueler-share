// Worker-Keys-2 (5 Nov 2026): what the fuzz survey found, pinned one case at a time. fuzz.test.js
// keeps the general properties; these say exactly what each route answers. All keys are test keys.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env as testEnv } from 'cloudflare:test';
import { hashToCurve } from '@cashu/cashu-ts';

import worker from '../src/index.js';
import { makeSessionToken, verifySessionToken } from '../src/upload_session.js';
import { parseRange, isJsonObject } from '../src/utils.js';
import { isExpired, isInGracePeriod, isDownloadBlocked } from '../src/manifest.js';
import { makeBucket } from './_r2_mock.js';
import { makeEnv, ctx, ADMIN, ORIGIN } from './helpers/api-fake.js';
import { transferRequest } from './helpers/transfer-request.js';

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const NOW = Math.floor(Date.now() / 1000);
const PEPPER = 'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=';
const NOT_OBJECTS = ['null', '[]', '[1]', '5', 'true', '"x"'];
const baseManifest = {
  uuid: UUID, tier: 'free', total_chunks: 3, total_bytes: 100, expiry_timestamp: NOW + 86400,
  created_at: NOW - 60,
};
const seeded = (manifest = baseManifest) => makeBucket({
  [`${UUID}/manifest.json`]: { uploaded: NOW, body: JSON.stringify(manifest) },
});
const jsonHeaders = (extra = {}) => ({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.20', ...extra });
const post = (env, path, body, extra) => worker.fetch(
  new Request(`${ORIGIN}${path}`, { method: 'POST', headers: jsonHeaders(extra), body }), env, ctx,
);

const textOf = async (res) => new TextDecoder().decode(await res.arrayBuffer());

let turnstileCalls;
beforeEach(() => {
  turnstileCalls = 0;
  vi.stubGlobal('fetch', async (url) => {
    if (String(url).includes('siteverify')) {
      turnstileCalls++;
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200 });
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('a JSON body that is not an object', () => {
  it('isJsonObject', () => {
    for (const v of [null, [], 5, 'x', true, undefined]) expect(isJsonObject(v), String(v)).toBe(false);
    expect(isJsonObject({})).toBe(true);
  });

  it('answers 400 on every route that reads fields from it', async () => {
    for (const b of NOT_OBJECTS) {
      const env = makeEnv({ BUCKET: seeded() });
      const unlock = await worker.fetch(transferRequest(`${ORIGIN}/unlock`, UUID, { method: 'POST', headers: jsonHeaders(), body: b }), env, ctx);
      expect(unlock.status, `/unlock ${b}`).toBe(400);
      expect((await post(env, '/credential/issue', b)).status, `/credential/issue ${b}`).toBe(400);
      expect((await post(env, '/subscription/checkout', b)).status, `/subscription/checkout ${b}`).toBe(400);
      expect((await post(env, '/admin/test-credential', b, { 'X-Admin-Key': ADMIN })).status, `test-credential ${b}`).toBe(400);
      expect((await post(env, '/admin/btc-rate', b, { 'X-Admin-Key': ADMIN })).status, `btc-rate ${b}`).toBe(400);
      const tok = await makeSessionToken(env, UUID, 3, NOW + 3600);
      const urls = await worker.fetch(transferRequest(`${ORIGIN}/upload/urls`, UUID, { method: 'POST', headers: jsonHeaders({ 'X-Upload-Session': tok }), body: b }), env, ctx);
      expect(urls.status, `/upload/urls ${b}`).toBe(400);
    }
    expect(turnstileCalls).toBe(0);
  });

  it('/log/error answers 200 and logs nothing', async () => {
    const AE = { writeDataPoint: vi.fn() };
    for (const b of NOT_OBJECTS) {
      expect((await post(makeEnv({ AE }), '/log/error', b)).status, b).toBe(200);
    }
    expect(AE.writeDataPoint).not.toHaveBeenCalled();
  });
});

describe('/log/error fields', () => {
  it('a non-string field counts as empty, and is never coerced', async () => {
    const AE = { writeDataPoint: vi.fn() };
    const body = JSON.stringify({ context: { toString: null }, message: 5, detail: ['x'] });
    expect((await post(makeEnv({ AE }), '/log/error', body)).status).toBe(200);
    expect(AE.writeDataPoint.mock.calls[0][0].blobs).toEqual(['client_error', '', '', '']);
  });

  it('strings still arrive, cut to length', async () => {
    const AE = { writeDataPoint: vi.fn() };
    const body = JSON.stringify({ context: 'c'.repeat(100), message: 'm', detail: 'd' });
    await post(makeEnv({ AE }), '/log/error', body);
    expect(AE.writeDataPoint.mock.calls[0][0].blobs).toEqual(['client_error', 'c'.repeat(64), 'm', 'd']);
  });
});

describe('/upload/urls numbers', () => {
  const urls = async (body) => {
    const env = makeEnv({ BUCKET: seeded() });
    const tok = await makeSessionToken(env, UUID, 3, NOW + 3600);
    return worker.fetch(transferRequest(`${ORIGIN}/upload/urls`, UUID, { method: 'POST', headers: jsonHeaders({ 'X-Upload-Session': tok }), body: JSON.stringify(body) }), env, ctx);
  };

  it('whole JSON numbers work, as the browser and MCP send them', async () => {
    expect((await urls({ from: 0, count: 1 })).status).toBe(200);
  });

  it('anything else is 400, never coerced', async () => {
    for (const body of [
      { from: '0', count: 1 }, { from: 0, count: '1' }, { from: 1.5, count: 1 }, { from: 0, count: 1.5 },
      { from: null, count: 1 }, { from: {}, count: 1 }, { from: [0], count: 1 }, { from: 0, count: [1] },
      { from: { toString: null }, count: 1 }, {},
    ]) {
      expect((await urls(body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('/credential/issue fields', () => {
  const blinded = hashToCurve(new TextEncoder().encode('worker-keys-2')).toHex(true);
  const issue = (body) => post(makeEnv(), '/credential/issue', JSON.stringify({ blinded_message: blinded, turnstile_token: `t-${Math.random()}`, ...body }));

  it('a prototype name is not a tier: it issues free', async () => {
    for (const tier of ['constructor', '__proto__', 'toString', 'hasOwnProperty', { toString: null }, 5]) {
      const res = await issue({ tier });
      expect(res.status, JSON.stringify(tier)).toBe(200);
      expect((await res.json()).issued_tier, JSON.stringify(tier)).toBe('free');
    }
  });

  it('a real tier still issues as itself', async () => {
    expect((await (await issue({ tier: 'free' })).json()).issued_tier).toBe('free');
  });

  it('a non-string blinded message or Turnstile token is 400, before Turnstile is used', async () => {
    for (const bad of [{ a: 1 }, ['x'], 5, true]) {
      expect((await issue({ blinded_message: bad })).status, JSON.stringify(bad)).toBe(400);
      expect((await issue({ turnstile_token: bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect(turnstileCalls).toBe(0);
  });
});

describe('parseRange', () => {
  it('reads the forms it should', () => {
    expect(parseRange('bytes=0-0')).toEqual({ offset: 0, length: 1 });
    expect(parseRange('bytes=5-9')).toEqual({ offset: 5, length: 5 });
    expect(parseRange('bytes=5-')).toEqual({ offset: 5, length: undefined });
  });

  it('refuses the rest', () => {
    for (const h of [
      'bytes=5-2', 'bytes=1-0', 'xbytes=0-1', 'bytes=0-1x', ' bytes=0-1', 'bytes=0-1,3-4', 'bytes=-5', 'bytes=-',
      'bytes=9007199254740992-', 'bytes=0-9007199254740992', 'bytes=0-9007199254740991', '', 'items=0-1',
    ]) {
      expect(parseRange(h), h).toBeUndefined();
    }
  });
});

describe('upload session token: one spelling', () => {
  it('every other last character is refused, the spare-bit ones included', async () => {
    const env = { UPLOAD_SESSION_KEY: 'c2Vzc2lvbi1rZXktdGVzdC1vbmx5LTMyLWJ5dGVzLSE=' };
    const t = await makeSessionToken(env, UUID, 3, NOW + 3600);
    expect(await verifySessionToken(env, t, UUID, NOW)).not.toBeNull();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (const c of alphabet) {
      if (c === t.at(-1)) continue;
      expect(await verifySessionToken(env, t.slice(0, -1) + c, UUID, NOW), c).toBeNull();
    }
  });
});

describe('stored manifest fields', () => {
  it('an expiry that is not a number counts as expired', () => {
    for (const v of [undefined, null, 'soon', String(NOW + 3600), {}, { toString: null }, true]) {
      expect(isExpired({ expiry_timestamp: v }), JSON.stringify(v)).toBe(true);
      expect(isDownloadBlocked({ expiry_timestamp: v }), JSON.stringify(v)).toBe(true);
    }
  });

  it('a start date that is not a number gives no grace period', () => {
    const past = NOW - 10;
    for (const v of [undefined, null, 0, 'x', String(past - 10), {}, { toString: null }]) {
      expect(isInGracePeriod({ expiry_timestamp: past, download_initiated_at: v }), JSON.stringify(v)).toBe(false);
      expect(isDownloadBlocked({ expiry_timestamp: past, download_initiated_at: v }), JSON.stringify(v)).toBe(true);
    }
    expect(isInGracePeriod({ expiry_timestamp: 'x', download_initiated_at: past })).toBe(false);
  });

  it('real values behave as before', () => {
    expect(isExpired({ expiry_timestamp: NOW + 60 })).toBe(false);
    expect(isExpired({ expiry_timestamp: NOW - 60 })).toBe(true);
    expect(isDownloadBlocked({ expiry_timestamp: NOW - 60, download_initiated_at: NOW - 120 })).toBe(false);
    expect(isDownloadBlocked({ expiry_timestamp: NOW - 60, download_initiated_at: NOW - 30 })).toBe(true);
  });
});

describe('rate limit: DELETE /transfer and POST /confirm', () => {
  const hit = (env, path, method, ip = '198.51.100.30', uuid = UUID) => worker.fetch(transferRequest(`${ORIGIN}${path}`, uuid, {
    method, headers: { 'CF-Connecting-IP': ip, Authorization: 'Bearer junk', Origin: 'https://share.refueler.io' },
  }), env, ctx);
  const limited = () => makeEnv({ AUTH_PEPPER: PEPPER, BUCKET: seeded() });

  for (const [path, method] of [['/confirm', 'POST'], ['/transfer', 'DELETE']]) {
    it(`${method} ${path}: 30 a minute per IP, then 429 with the usual headers`, async () => {
      const env = limited();
      for (let i = 0; i < 30; i++) expect((await hit(env, path, method)).status, `try ${i}`).not.toBe(429);
      const res = await hit(env, path, method);
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBeTruthy();
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
      expect((await hit(env, path, method, '198.51.100.31')).status, 'another IP').not.toBe(429);
    });
  }

  it('each route has its own count', async () => {
    const env = limited();
    for (let i = 0; i < 31; i++) await hit(env, '/confirm', 'POST');
    expect((await hit(env, '/confirm', 'POST')).status).toBe(429);
    expect((await hit(env, '/transfer', 'DELETE')).status).not.toBe(429);
  });

  it('it does not count per transfer: another IP on the same link is unaffected', async () => {
    const env = limited();
    for (let i = 0; i < 31; i++) await hit(env, '/transfer', 'DELETE');
    expect((await hit(env, '/transfer', 'DELETE', '198.51.100.32')).status).toBe(403);
  });
});

// Against the test Worker's R2 binding, not the mock: it reports { offset, length }, and throws on
// an offset past the end.
describe('download with no merkle_root: Range', () => {
  const OPEN_UUID = '6a1b0c3e-1f2d-4e5f-8a9b-0c1d2e3f4a5b';
  const get = (env, range) => worker.fetch(transferRequest(`${ORIGIN}/download`, OPEN_UUID, {
    headers: { 'CF-Connecting-IP': '198.51.100.40', ...(range ? { Range: range } : {}) },
  }, 0), env, ctx);
  const realR2 = async () => {
    await testEnv.BUCKET.put(`${OPEN_UUID}/manifest.json`, JSON.stringify({ ...baseManifest, uuid: OPEN_UUID, total_chunks: 2 }));
    await testEnv.BUCKET.put(`${OPEN_UUID}/0000`, 'hello');
    return makeEnv({ BUCKET: testEnv.BUCKET });
  };

  it('no Range: the whole part, 200', async () => {
    const res = await get(await realR2());
    expect(res.status).toBe(200);
    expect(await textOf(res)).toBe('hello');
  });

  it('a real range: 206, the right bytes and the right Content-Range', async () => {
    const res = await get(await realR2(), 'bytes=1-2');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 1-2/5');
    expect(await textOf(res)).toBe('el');
  });

  it('an open-ended range: 206 to the end', async () => {
    const res = await get(await realR2(), 'bytes=2-');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 2-4/5');
    expect(await textOf(res)).toBe('llo');
  });

  it('a Range it cannot read is ignored: the whole part, 200, never 206', async () => {
    for (const r of ['bytes=5-2', 'bytes=1-0', 'xbytes=0-1', 'bytes=0-1,3-4', 'bytes=99999999999999999999-']) {
      const res = await get(await realR2(), r);
      expect(res.status, r).toBe(200);
      expect(await textOf(res), r).toBe('hello');
    }
  });

  it('an offset past the end: 416', async () => {
    expect((await get(await realR2(), 'bytes=50-')).status).toBe(416);
    expect((await get(await realR2(), 'bytes=5-9')).status).toBe(416);
  });
});
