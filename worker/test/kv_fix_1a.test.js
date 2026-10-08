// test/kv_fix_1a.test.js
// KV-Fix-1a — status shape (write + read), requireAdmin.

import { describe, it, expect } from 'vitest';
import { makeKv } from './helpers/kv-mock.js';
import { cleanStatus } from '../src/status_shape.js';
import { handleAdminStatus } from '../src/handlers/admin.js';
import { requireAdmin } from '../src/utils.js';
import { appendClientError } from '../src/handlers/client_errors_kv.js';
import worker from '../src/index.js';
import { handleFinalise } from '../src/handlers/finalise.js';
import { makeBucket, makeKV, FULL } from './_r2_mock.js';
import { deriveKvMacKey, makeRootVerifiedValue, checkRootVerifiedValue } from '../src/kvmac.js';
import { readSidecarWithRootCheck } from '../src/handlers/download_verify.js';
import { reconstructRoot } from '../src/merkle.js';

const ADMIN_KEY = 'test-admin-key-kvfix1a';
const T = 1_791_000_000;

const goodIncident = {
  title: 'Slow downloads', severity: 'major', started_at: T,
  updates: [{ at: T + 60, body: 'Looking into it' }],
};

function adminPost(body, key = ADMIN_KEY) {
  return new Request('https://w.test/admin/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
    body: JSON.stringify(body),
  });
}

describe('cleanStatus — strict (admin write)', () => {
  it('accepts a valid incident and keeps known fields only', () => {
    const out = cleanStatus({ state: 'degraded', incidents: [goodIncident], evil: '<x>' }, { strict: true });
    expect(out).toEqual({ state: 'degraded', incidents: [goodIncident] });
  });

  for (const [name, inc] of [
    ['severity outside the list', { ...goodIncident, severity: 'minor" onmouseover="x' }],
    ['missing severity',          { title: 'x' }],
    ['string time',               { ...goodIncident, started_at: '1791000000' }],
    ['long title',                { ...goodIncident, title: 'x'.repeat(161) }],
    ['updates not an array',      { ...goodIncident, updates: '<img>' }],
    ['update body not a string',  { ...goodIncident, updates: [{ at: T, body: { a: 1 } }] }],
  ]) {
    it(`rejects ${name}`, () => {
      expect(() => cleanStatus({ incidents: [inc] }, { strict: true })).toThrow();
    });
  }

  it('rejects more than 20 incidents and a bad state', () => {
    expect(() => cleanStatus({ incidents: Array(21).fill(goodIncident) }, { strict: true })).toThrow();
    expect(() => cleanStatus({ state: 'on fire' }, { strict: true })).toThrow();
  });
});

describe('cleanStatus — lenient (public read)', () => {
  it('drops a forged incident, keeps good ones, never passes unknown keys', () => {
    const forged = { ...goodIncident, severity: '"><script>alert(1)</script>' };
    const out = cleanStatus({ state: 'degraded', incidents: [forged, goodIncident], extra: 'x', inc_html: '<b>' });
    expect(out.incidents).toEqual([goodIncident]);
    expect(Object.keys(out).sort()).toEqual(
      ['incidents', 'lightning_available', 'maintenance', 'message', 'phoenixd', 'state', 'updated_at'],
    );
    expect(JSON.stringify(out)).not.toContain('script');
  });

  it('falls back to defaults for null / garbage', () => {
    expect(cleanStatus(null)).toMatchObject({ state: 'operational', incidents: [], message: null });
    expect(cleanStatus({ state: 'x', incidents: 'y', maintenance: 5 })).toMatchObject({
      state: 'operational', incidents: [], maintenance: null,
    });
  });
});

describe('POST /admin/status', () => {
  it('400 on a bad severity, nothing written', async () => {
    const env = { ADMIN_KEY, STATUS_KV: makeKv() };
    const res = await handleAdminStatus(adminPost({ incidents: [{ ...goodIncident, severity: 'bogus' }] }), env);
    expect(res.status).toBe(400);
    expect(env.STATUS_KV._store.has('status:current')).toBe(false);
  });

  it('writes a clean value and drops stray keys already in KV', async () => {
    const env = { ADMIN_KEY, STATUS_KV: makeKv() };
    await env.STATUS_KV.put('status:current', JSON.stringify({ state: 'operational', planted: '<x>' }));
    const res = await handleAdminStatus(adminPost({ incidents: [goodIncident], lightning_available: 'false' }), env);
    expect(res.status).toBe(200);
    const stored = JSON.parse(env.STATUS_KV._store.get('status:current'));
    expect(stored.planted).toBeUndefined();
    expect(stored.lightning_available).toBe(false);
    expect(stored.incidents).toEqual([goodIncident]);
  });

  it('401 on a wrong key', async () => {
    const env = { ADMIN_KEY, STATUS_KV: makeKv() };
    expect((await handleAdminStatus(adminPost({}, 'nope'), env)).status).toBe(401);
  });
});

describe('GET /status', () => {
  it('serves a forged KV value with the bad incident removed', async () => {
    const env = { STATUS_KV: makeKv() };
    await env.STATUS_KV.put('status:current', JSON.stringify({
      state: 'degraded', incidents: [{ ...goodIncident, severity: 'x" onload="y' }], secret: 1,
    }));
    const res = await worker.fetch(new Request('https://w.test/status'), env, { waitUntil() {} });
    const body = await res.json();
    expect(body.incidents).toEqual([]);
    expect(body.secret).toBeUndefined();
    expect(body.state).toBe('degraded');
  });
});

describe('requireAdmin', () => {
  const req = (key) => new Request('https://w.test/', { headers: key === undefined ? {} : { 'X-Admin-Key': key } });
  it('null on the right key', async () => {
    expect(await requireAdmin(req(ADMIN_KEY), { ADMIN_KEY })).toBeNull();
  });
  it('401 on wrong, shorter, longer and missing keys', async () => {
    for (const k of ['x', ADMIN_KEY.slice(0, -1), ADMIN_KEY + 'x', '', undefined]) {
      expect((await requireAdmin(req(k), { ADMIN_KEY })).status).toBe(401);
    }
  });
  it('fails closed when ADMIN_KEY is unset', async () => {
    expect((await requireAdmin(req('anything'), {})).status).toBe(401);
  });
});

describe('finalise — runs once', () => {
  it('409 already_complete on a completed transfer; nothing rewritten', async () => {
    const UUID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    const B32  = 'A'.repeat(43);
    const done = { uuid: UUID, total_chunks: 1, upload_complete: true, merkle_root: 'orig', tree_algo: 'rfc6962-unbalanced-blake3-v1' };
    const bucket = makeBucket({
      [`${UUID}/manifest.json`]: { uploaded: 1, body: JSON.stringify(done) },
      [`${UUID}/0000`]: { size: FULL, uploaded: 1 },
    });
    const kv  = makeKV({ [`upload_session:${UUID}`]: 'planted' });
    const req = new Request(`https://w.test/upload/${UUID}/finalise`, {
      method: 'POST', headers: { 'X-Upload-Session': 'planted' },
      body: JSON.stringify({ hashes: [B32], merkle_root: B32 }),
    });
    const res = await handleFinalise(req, { BUCKET: bucket, STATUS_KV: kv }, UUID, { waitUntil() {} });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_complete' });
    expect(JSON.parse(bucket._store.get(`${UUID}/manifest.json`).body).merkle_root).toBe('orig');
    expect(bucket._store.has(`${UUID}/hashes`)).toBe(false);
  });
});

// ── root_verified MAC (kvmac.js) ─────────────────────────────────────────────
// Known-answer vector computed independently with Node's crypto.hkdfSync +
// createHmac (scratch script, KV-Fix-1a):
//   KV_MAC_KEY = bytes 0x01..0x20 (base64 below)
//   K_rootv    = 700ec96d45860a23c4b2a99cef206ffc46037c15857d7486f27ca47031822e79
//   uuid       = 6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b, root = 32 × 0xab
const KAT_SECRET = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
const KAT_UUID   = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const KAT_ROOT   = new Uint8Array(32).fill(0xab);
const KAT_MAC    = '63b9ZpUqH8WB4XpRRZTzQjkI54SQ3C2UQ8niDYxFgqg';

describe('kvmac — root_verified value', () => {
  it('matches the known-answer vector', async () => {
    const key = await deriveKvMacKey({ KV_MAC_KEY: KAT_SECRET }, 'rootv');
    expect(await makeRootVerifiedValue(key, KAT_UUID, KAT_ROOT)).toBe(JSON.stringify({ v: 1, mac: KAT_MAC }));
  });

  it('no key when the secret is missing or short', async () => {
    expect(await deriveKvMacKey({}, 'rootv')).toBeNull();
    expect(await deriveKvMacKey({ KV_MAC_KEY: btoa('short') }, 'rootv')).toBeNull();
  });

  it('rejects legacy, forged, moved and stale values', async () => {
    const key  = await deriveKvMacKey({ KV_MAC_KEY: KAT_SECRET }, 'rootv');
    const good = await makeRootVerifiedValue(key, KAT_UUID, KAT_ROOT);
    expect(await checkRootVerifiedValue(key, KAT_UUID, KAT_ROOT, good)).toBe(true);
    expect(await checkRootVerifiedValue(key, KAT_UUID, KAT_ROOT, '1')).toBe(false);
    expect(await checkRootVerifiedValue(key, KAT_UUID, KAT_ROOT, JSON.stringify({ v: 1, mac: 'A'.repeat(43) }))).toBe(false);
    expect(await checkRootVerifiedValue(key, '00000000-0000-4000-8000-000000000000', KAT_ROOT, good)).toBe(false);
    expect(await checkRootVerifiedValue(key, KAT_UUID, new Uint8Array(32), good)).toBe(false);
    const other = await deriveKvMacKey({ KV_MAC_KEY: btoa('x'.repeat(32)) }, 'rootv');
    expect(await checkRootVerifiedValue(other, KAT_UUID, KAT_ROOT, good)).toBe(false);
  });
});

describe('readSidecarWithRootCheck — MAC\'d flag', () => {
  const UUID  = KAT_UUID;
  const leaves = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
  const sidecar = new Uint8Array(64); sidecar.set(leaves[0], 0); sidecar.set(leaves[1], 32);
  const b64url = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const goodRoot = b64url(reconstructRoot(leaves));
  const badRoot  = b64url(new Uint8Array(32).fill(9));
  const man = (root) => ({ total_chunks: 2, merkle_root: root, expiry_timestamp: Math.floor(Date.now() / 1000) + 3600 });
  const env = (kv, withKey = true) => ({
    BUCKET: { get: async k => (k === `${UUID}/hashes` ? { arrayBuffer: async () => sidecar.slice().buffer } : null) },
    STATUS_KV: kv,
    ...(withKey ? { KV_MAC_KEY: KAT_SECRET } : {}),
  });

  it('proves the root, then writes a MAC\'d flag (not \'1\')', async () => {
    const kv = makeKv();
    expect((await readSidecarWithRootCheck(env(kv), UUID, man(goodRoot))).ok).toBe(true);
    expect(JSON.parse(kv._store.get(`root_verified:${UUID}`))).toMatchObject({ v: 1 });
  });

  it('a planted \'1\' does not skip reconstruction', async () => {
    const kv = makeKv();
    await kv.put(`root_verified:${UUID}`, '1');
    const r = await readSidecarWithRootCheck(env(kv), UUID, man(badRoot));
    expect(r).toMatchObject({ ok: false, detail: 'reconstructed root != manifest root' });
  });

  it('a genuine flag for a different root does not skip reconstruction', async () => {
    const kv = makeKv();
    await readSidecarWithRootCheck(env(kv), UUID, man(goodRoot));          // writes flag for goodRoot
    const r = await readSidecarWithRootCheck(env(kv), UUID, man(badRoot));  // root changed
    expect(r.ok).toBe(false);
  });

  it('without KV_MAC_KEY: never trusts, never writes', async () => {
    const kv = makeKv();
    await kv.put(`root_verified:${UUID}`, '1');
    expect((await readSidecarWithRootCheck(env(kv, false), UUID, man(badRoot))).ok).toBe(false);
    const kv2 = makeKv();
    expect((await readSidecarWithRootCheck(env(kv2, false), UUID, man(goodRoot))).ok).toBe(true);
    expect(kv2._store.has(`root_verified:${UUID}`)).toBe(false);
  });
});

describe('client-error log — no UUIDs', () => {
  it('writes {uuid} in place of transfer IDs in path and msg', async () => {
    const env = { STATUS_KV: makeKv() };
    const id = '6F1C2A3B-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    await appendClientError(env, { status: 404, endpoint: 'meta', path: `/meta/${id}`, method: 'GET', errorMsg: `no ${id}` });
    const [e] = JSON.parse(env.STATUS_KV._store.get('admin:client_errors_log'));
    expect(e.path).toBe('/meta/{uuid}');
    expect(e.msg).toBe('no {uuid}');
  });
});
