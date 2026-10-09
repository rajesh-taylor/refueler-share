// test/kv_fix_1b.test.js
// KV-Fix-1b — B12-SR S2 test credential: MAC'd X-Test-Credential under TEST_CRED_KEY.
//
//   • known-answer vector (computed independently, Python hmac)
//   • the S2 proof-obligation matrix: every case → normal path (401: 'Invalid credential'
//     for the junk Cashu credential, or the HMAC refusal for an unsigned Chartered
//     initiate since API-Repair-1), no manifest, no flag; only a fresh, valid,
//     unexpired, matching token reaches the bypass
//   • the bypass obeys the expiry ceiling (P2) and its own chunk cap; manifest soak:true
//   • /admin/test-credential: requireAdmin, 503 without the secret, cap ≤ 8,000 chunks,
//     no KV write, AE admin.testcred.issued (count only)
// In-memory R2/KV (test/_r2_mock.js); fetch stubbed to fail — no network, no Supabase.

import { describe, it, expect, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { computeCommitment } from '../src/commitment.js';
import { CHUNK_SIZE } from '../src/sweep_rules.js';
import {
  importTestCredKey, makeTestCredential, checkTestCredential,
  TESTCRED_MAX_CHUNKS, TESTCRED_USED_PREFIX,
} from '../src/testcred.js';
import { makeBucket, makeKV } from './_r2_mock.js';

const MINT_PRIVKEY_HEX = '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f';
const TC_KEY     = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA='; // bytes 0x01…0x20
const KEY        = 'test-commitment-key-kvfix1b';
const ADMIN_KEY  = 'test-admin-key-kvfix1b';
const UUID       = '0f8fad5b-d9cb-469f-a165-70867728950e';
const UUID2      = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const API_WINDOW = 90 * 24 * 3600;
const DAY        = 24 * 3600;
const now        = () => Math.floor(Date.now() / 1000);
const ctx        = () => ({ waitUntil() {}, passThroughOnException() {} });

afterEach(() => vi.unstubAllGlobals());

function noNetwork() {
  const calls = [];
  vi.stubGlobal('fetch', async (url) => { calls.push(String(url)); throw new Error('network in test'); });
  return calls;
}

function makeEnv(overrides = {}) {
  const ae = [];
  return {
    COMMITMENT_KEY:          KEY,
    TEST_CRED_KEY:           TC_KEY,
    ADMIN_KEY,
    MINT_PRIVATE_KEY:        MINT_PRIVKEY_HEX,
    SUPABASE_URL:            'https://sb.test',
    SUPABASE_SERVICE_KEY:    'x',
    BUCKET:                  makeBucket(),
    STATUS_KV:               makeKV(),
    CF_ACCOUNT_ID:           'acct',
    R2_S3_ACCESS_KEY_ID:     'ak',
    R2_S3_SECRET_ACCESS_KEY: 'sk',
    R2_BUCKET_NAME:          'refueler-share-dev',
    AE:                      { writeDataPoint: d => ae.push(d) },
    _ae:                     ae,
    ...overrides,
  };
}

async function token(uuid = UUID, cap = 4, exp = now() + 3600, keyB64 = TC_KEY) {
  const key = await importTestCredKey({ TEST_CRED_KEY: keyB64 });
  return makeTestCredential(key, uuid, cap, exp);
}

async function initiate(env, { uuid = UUID, header, tier = 'api', bytes = CHUNK_SIZE + 5, expiry = now() + 2 * DAY, credential = '{}' } = {}) {
  const headers = {
    'X-Cashu-Credential':      credential,
    'X-Total-Chunks':          String(Math.ceil(bytes / CHUNK_SIZE)),
    'X-Total-Bytes':           String(bytes),
    'X-Expiry-Timestamp':      String(expiry),
    'X-Credential-Commitment': await computeCommitment(KEY, uuid, 'api', API_WINDOW),
    'X-Issued-Tier':           tier,
  };
  if (header !== undefined) headers['X-Test-Credential'] = header;
  const res = await worker.fetch(new Request(`https://api.share.test/upload/${uuid}/initiate`, { method: 'POST', headers }), env, ctx());
  return { status: res.status, body: await res.json().catch(() => null) };
}

const manifestOf = (env, uuid = UUID) => env.BUCKET._store.get(`${uuid}/manifest.json`);

// Normal path = 401, nothing written, no Supabase. For tier 'api' that 401 is the
// HMAC refusal (API-Repair-1: an unsigned Chartered initiate never reaches Cashu).
function expectNormalPath(env, res, calls, uuid = UUID) {
  expect(res.status).toBe(401);
  expect(['Invalid credential', expect.stringMatching(/^Missing or malformed Authorization header/)])
    .toContainEqual(res.body.error);
  expect(manifestOf(env, uuid)).toBeUndefined();
  expect(env.STATUS_KV._store.has(`${TESTCRED_USED_PREFIX}${uuid}`)).toBe(false);
  expect(calls).toEqual([]);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('testcred.js', () => {
  it('known-answer vector (independent HMAC-SHA256)', async () => {
    expect(await token(UUID, 8000, 1_791_000_000))
      .toBe(`v1.${UUID}.8000.1791000000.DW5SUiVg5SskpH-ZrSFQdLfIwE9hPxehI0nq9Ar1cTU`);
  });

  it('round-trips; missing or short secret → absent', async () => {
    const exp = now() + 600;
    const t = await token(UUID, 7, exp);
    expect(await checkTestCredential({ TEST_CRED_KEY: TC_KEY }, t, UUID, now())).toEqual({ capChunks: 7, exp });
    expect(await checkTestCredential({}, t, UUID, now())).toBeNull();
    expect(await checkTestCredential({ TEST_CRED_KEY: btoa('short') }, t, UUID, now())).toBeNull();
    expect(await importTestCredKey({})).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S2 proof-obligation matrix — all → normal path', () => {
  it('no header', async () => {
    const calls = noNetwork(); const env = makeEnv();
    expectNormalPath(env, await initiate(env), calls);
  });

  it.each([
    ['empty', ''],
    ['garbage', 'not-a-token'],
    ['v2 prefix', (t) => t.replace(/^v1\./, 'v2.')],
    ['trailing junk', (t) => t + '.x'],
    ['uppercase uuid', (t) => t.replace(UUID, UUID.toUpperCase())],
    ['cap 0', `v1.${UUID}.0.${now() + 60}.${'A'.repeat(43)}`],
  ])('malformed (%s)', async (_n, mk) => {
    const calls = noNetwork(); const env = makeEnv();
    const header = typeof mk === 'function' ? mk(await token()) : mk;
    expectNormalPath(env, await initiate(env, { header }), calls);
  });

  it('wrong MAC (one character flipped)', async () => {
    const calls = noNetwork(); const env = makeEnv();
    const t = await token();
    // Flip a character 10 from the end: the last base64url char of a 32-byte MAC
    // carries 2 padding bits, so flipping it can decode to the same MAC (flaky).
    const i = t.length - 10;
    const header = t.slice(0, i) + (t[i] === 'A' ? 'B' : 'A') + t.slice(i + 1);
    expectNormalPath(env, await initiate(env, { header }), calls);
  });

  it('MAC under a different key', async () => {
    const calls = noNetwork(); const env = makeEnv();
    const header = await token(UUID, 4, now() + 3600, btoa(String.fromCharCode(...new Uint8Array(32).fill(9))));
    expectNormalPath(env, await initiate(env, { header }), calls);
  });

  it('cap_chunks edited upward (MAC no longer matches)', async () => {
    const calls = noNetwork(); const env = makeEnv();
    const header = (await token(UUID, 4)).replace(`.${4}.`, '.4000.');
    expectNormalPath(env, await initiate(env, { header }), calls);
  });

  it('expired', async () => {
    const calls = noNetwork(); const env = makeEnv();
    expectNormalPath(env, await initiate(env, { header: await token(UUID, 4, now() - 1) }), calls);
  });

  it('exp more than 24 h ahead (validly MAC\'d)', async () => {
    const calls = noNetwork(); const env = makeEnv();
    expectNormalPath(env, await initiate(env, { header: await token(UUID, 4, now() + DAY + 120) }), calls);
  });

  it('cap_chunks above 8,000 (validly MAC\'d)', async () => {
    const calls = noNetwork(); const env = makeEnv();
    expectNormalPath(env, await initiate(env, { header: await token(UUID, TESTCRED_MAX_CHUNKS + 1) }), calls);
  });

  it('valid token for another UUID', async () => {
    const calls = noNetwork(); const env = makeEnv();
    expectNormalPath(env, await initiate(env, { header: await token(UUID2) }), calls);
  });

  it('replay after the first initiate → 409 (manifest exists), flag set once', async () => {
    noNetwork(); const env = makeEnv();
    const header = await token();
    expect((await initiate(env, { header })).status).toBe(200);
    const r2 = await initiate(env, { header });
    expect(r2.status).toBe(409);
    expect(env.STATUS_KV._log.puts.filter(p => p.key.startsWith(TESTCRED_USED_PREFIX))).toHaveLength(1);
  });

  it('replay with the manifest gone but the flag set (e.g. after a purge)', async () => {
    const calls = noNetwork(); const env = makeEnv();
    env.STATUS_KV._store.set(`${TESTCRED_USED_PREFIX}${UUID}`, '1');
    const res = await initiate(env, { header: await token() });
    expect(res.status).toBe(401);
    expect(manifestOf(env)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('old-style KV flag present without header (P2)', async () => {
    const calls = noNetwork();
    const env = makeEnv({ STATUS_KV: makeKV({ [`test_credential:${UUID}`]: { initiated: false, cap_bytes: 400 * 1024 ** 3 } }) });
    expectNormalPath(env, await initiate(env), calls);
    expect(JSON.parse(env.STATUS_KV._store.get(`test_credential:${UUID}`)).initiated).toBe(false); // never read or touched
  });

  it('valid token + existing manifest → 409, no flag', async () => {
    noNetwork(); const env = makeEnv();
    env.BUCKET._store.set(`${UUID}/manifest.json`, { body: JSON.stringify({ uuid: UUID }), size: 10, uploaded: new Date() });
    const res = await initiate(env, { header: await token() });
    expect(res.status).toBe(409);
    expect(env.STATUS_KV._store.has(`${TESTCRED_USED_PREFIX}${UUID}`)).toBe(false);
  });

  it('ADMIN_KEY pasted as the header', async () => {
    const calls = noNetwork(); const env = makeEnv();
    expectNormalPath(env, await initiate(env, { header: ADMIN_KEY }), calls);
  });

  it.each(['soak', 'test'])('tier "%s" in the credential (no header)', async (tier) => {
    const calls = noNetwork(); const env = makeEnv();
    const res = await initiate(env, { tier });
    // 'soak'/'test' are not tiers: commitment is recomputed as 'free' → mismatch, still the normal path.
    expect(res.status).toBe(401);
    expect(manifestOf(env)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('TEST_CRED_KEY missing at initiate → a once-valid token is ignored', async () => {
    const calls = noNetwork(); const env = makeEnv({ TEST_CRED_KEY: undefined });
    expectNormalPath(env, await initiate(env, { header: await token() }), calls);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the bypass itself', () => {
  it('fresh valid matching token → 200, soak:true, flag set with TTL, no Supabase', async () => {
    const calls = noNetwork(); const env = makeEnv();
    const exp = now() + 3600;
    const res = await initiate(env, { header: await token(UUID, 4, exp) });
    expect(res.status).toBe(200);
    expect(JSON.parse(manifestOf(env).body).soak).toBe(true);
    const put = env.STATUS_KV._log.puts.find(p => p.key === `${TESTCRED_USED_PREFIX}${UUID}`);
    expect(put.value).toBe('1');
    expect(put.opts.expirationTtl).toBeGreaterThanOrEqual(3600);
    expect(calls).toEqual([]);
  });

  it('obeys the 7-day expiry ceiling (P2) — 400, flag not consumed', async () => {
    noNetwork(); const env = makeEnv();
    const res = await initiate(env, { header: await token(), expiry: now() + 8 * DAY });
    expect(res.status).toBe(400);
    expect(env.STATUS_KV._store.has(`${TESTCRED_USED_PREFIX}${UUID}`)).toBe(false);
    expect(manifestOf(env)).toBeUndefined();
  });

  it('obeys its own cap: one chunk over cap_chunks → 413', async () => {
    noNetwork(); const env = makeEnv();
    const res = await initiate(env, { header: await token(UUID, 1), bytes: CHUNK_SIZE + 1 });
    expect(res.status).toBe(413);
    expect(env.STATUS_KV._store.has(`${TESTCRED_USED_PREFIX}${UUID}`)).toBe(false);
  });

  it('exactly cap_chunks → 200', async () => {
    noNetwork(); const env = makeEnv();
    expect((await initiate(env, { header: await token(UUID, 2), bytes: 2 * CHUNK_SIZE })).status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /admin/test-credential', () => {
  const blinded = '02' + '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const issue = (env, body = {}, key = ADMIN_KEY) => worker.fetch(new Request('https://api.share.test/admin/test-credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
    body: JSON.stringify({ blinded_message: blinded, ...body }),
  }), env, ctx());

  it('wrong admin key → 401', async () => {
    noNetwork();
    expect((await issue(makeEnv(), {}, 'nope')).status).toBe(401);
  });

  it('no TEST_CRED_KEY → 503', async () => {
    noNetwork();
    expect((await issue(makeEnv({ TEST_CRED_KEY: undefined }))).status).toBe(503);
  });

  it('cap over 8,000 chunks → 400', async () => {
    noNetwork();
    expect((await issue(makeEnv(), { cap_bytes: (TESTCRED_MAX_CHUNKS + 1) * CHUNK_SIZE })).status).toBe(400);
  });

  it('issues a header that initiates; no KV write at issue; AE count only', async () => {
    noNetwork(); const env = makeEnv();
    const res = await issue(env, { cap_bytes: 3 * CHUNK_SIZE, expires_in_seconds: 999_999 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allocation_bytes).toBe(3 * CHUNK_SIZE);
    expect(body.expires_at).toBeLessThanOrEqual(now() + DAY);
    expect(body.test_credential).toMatch(new RegExp(`^v1\\.${body.uuid}\\.3\\.${body.expires_at}\\.`));
    expect(env.STATUS_KV._log.puts.filter(p => !p.key.startsWith('rl:'))).toEqual([]);
    expect(env._ae.filter(d => d.indexes[0] === 'admin.testcred.issued')).toEqual([{ blobs: ['admin.testcred.issued'], doubles: [1], indexes: ['admin.testcred.issued'] }]);
    const init = await initiate(env, { uuid: body.uuid, header: body.test_credential, bytes: 3 * CHUNK_SIZE });
    expect(init.status).toBe(200);
  });
});
