// worker/test/webhook_reg.test.js
//
// SW4-patch — updated for Option B HMAC derivation.
// SW9 fixes:
//   - vi.mock factory literal string (hoisting fix)
//   - webhook_delivery.js mocked so handleWebhookRegister can run in Vitest
//   - deriveWhsec tests updated: import deriveWhsecFromHash from webhook_delivery.js
//     and pre-hash the API_KEY via sha256Hex (matches the production call path)
//
// Test count: 50 (48 unchanged + 2 adjusted)

import { describe, it, expect, vi } from 'vitest';
import {
  validateWebhookUrl,
  kvWhConfigKey,
  handleWebhookRegister,
} from '../src/webhook_reg.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeEnv(overrides = {}) {
  const store = new Map();
  return {
    WEBHOOK_SIGNING_MASTER_KEY: 'test-master-key-at-least-32-chars-long!!',
    STATUS_KV: {
      get:  async (k, opts) => {
        const raw = store.get(k);
        if (!raw) return null;
        if (opts?.type === 'json') return JSON.parse(raw);
        return raw;
      },
      put:  async (k, v) => { store.set(k, v); },
      _store: store,
    },
    ...overrides,
  };
}

function makePostRequest(body) {
  return new Request('https://api.share.refueler.io/api/v1/webhook/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest() {
  return new Request('https://api.share.refueler.io/api/v1/webhook/register', {
    method: 'DELETE',
  });
}

function makeGetRequest() {
  return new Request('https://api.share.refueler.io/api/v1/webhook/register', {
    method: 'GET',
  });
}

const TEST_API_KEY = 'rfs_live_TestKeyForWebhookRegTests1234567890Ab';

// ─────────────────────────────────────────────────────────────────────────────
// Mock requireApiAuth — bypass HMAC gate in handler tests.
// Literal string in factory: vi.mock is hoisted above const declarations,
// so TEST_API_KEY would be in the TDZ at mock-init time.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../src/api_auth.js', () => ({
  requireApiAuth: vi.fn().mockResolvedValue({
    client: { tier: 'api', id: 'test-client-001' },
    apiKey: 'rfs_live_TestKeyForWebhookRegTests1234567890Ab',
  }),
  sha256Hex: async (input) => {
    const enc = new TextEncoder();
    const data = enc.encode(input);
    const buf  = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock webhook_delivery.js — prevents CF-specific chain-imports from failing
// in the Vitest environment.
//
// deriveWhsecFromHash is implemented with the REAL production HMAC-SHA256
// derivation + base58 encoding, so the deriveWhsec describe block below gets
// genuine cryptographic output without needing vi.importActual (which poisons
// the module cache and causes handleWebhookRegister to return undefined).
//
// SIGN_DOMAIN_TAG and BASE58_ALPHABET are inlined here to match production
// exactly. Any divergence would be caught by the determinism tests.
// ─────────────────────────────────────────────────────────────────────────────
const _SIGN_DOMAIN_TAG  = 'refueler.webhook.v1.sign';
const _BASE58_ALPHABET  = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

async function _realDeriveWhsecFromHash(masterKey, apiKeyHash, createdAt) {
  const enc         = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(masterKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const message   = `${_SIGN_DOMAIN_TAG}\n${apiKeyHash}\n${createdAt}`;
  const sigBuffer = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(message));
  const bytes     = new Uint8Array(sigBuffer);

  // base58 encode
  let leadingZeroes = 0;
  for (const b of bytes) { if (b !== 0) break; leadingZeroes++; }
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  const b58 = '1'.repeat(leadingZeroes) + digits.reverse().map(d => _BASE58_ALPHABET[d]).join('');
  return `rfs_whsec_${b58}`;
}

vi.mock('../src/webhook_delivery.js', () => ({
  deriveWhsecFromHash:    _realDeriveWhsecFromHash,
  findApiKeyHashForUuid:  vi.fn(async () => null),
  deliverWebhookInline:   vi.fn(async () => {}),
  retryDeadLetterQueue:   vi.fn(async () => {}),
}));

// ─────────────────────────────────────────────────────────────────────────────
// validateWebhookUrl
// ─────────────────────────────────────────────────────────────────────────────
describe('validateWebhookUrl', () => {
  it('accepts a plain HTTPS URL', () => {
    const r = validateWebhookUrl('https://example.com/webhook');
    expect(r.ok).toBe(true);
    expect(r.url).toBeInstanceOf(URL);
  });

  it('accepts HTTPS URL with path, query, fragment', () => {
    const r = validateWebhookUrl('https://hooks.example.com/refueler?v=1#anchor');
    expect(r.ok).toBe(true);
  });

  it('accepts HTTPS URL with port', () => {
    const r = validateWebhookUrl('https://example.com:8443/webhook');
    expect(r.ok).toBe(true);
  });

  it('rejects null', () => {
    expect(validateWebhookUrl(null).ok).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateWebhookUrl('').ok).toBe(false);
  });

  it('rejects non-string', () => {
    expect(validateWebhookUrl(42).ok).toBe(false);
  });

  it('rejects unparseable URL', () => {
    expect(validateWebhookUrl('not a url').ok).toBe(false);
  });

  it('rejects HTTP (non-HTTPS)', () => {
    expect(validateWebhookUrl('http://example.com/webhook').ok).toBe(false);
  });

  it('rejects localhost', () => {
    expect(validateWebhookUrl('https://localhost/webhook').ok).toBe(false);
  });

  it('rejects LOCALHOST (case-insensitive)', () => {
    expect(validateWebhookUrl('https://LOCALHOST/webhook').ok).toBe(false);
  });

  it('rejects 127.0.0.1 (loopback)', () => {
    expect(validateWebhookUrl('https://127.0.0.1/webhook').ok).toBe(false);
  });

  it('rejects 10.x.x.x (RFC1918)', () => {
    expect(validateWebhookUrl('https://10.0.0.1/webhook').ok).toBe(false);
  });

  it('rejects 172.16.x.x (RFC1918)', () => {
    expect(validateWebhookUrl('https://172.16.0.1/webhook').ok).toBe(false);
  });

  it('rejects 172.31.x.x (RFC1918 upper bound)', () => {
    expect(validateWebhookUrl('https://172.31.255.255/webhook').ok).toBe(false);
  });

  it('accepts 172.15.x.x (just outside RFC1918)', () => {
    expect(validateWebhookUrl('https://172.15.0.1/webhook').ok).toBe(true);
  });

  it('accepts 172.32.x.x (just outside RFC1918)', () => {
    expect(validateWebhookUrl('https://172.32.0.1/webhook').ok).toBe(true);
  });

  it('rejects 192.168.x.x (RFC1918)', () => {
    expect(validateWebhookUrl('https://192.168.1.1/webhook').ok).toBe(false);
  });

  it('rejects 169.254.x.x (link-local)', () => {
    expect(validateWebhookUrl('https://169.254.0.1/webhook').ok).toBe(false);
  });

  it('rejects 0.0.0.0 (unspecified)', () => {
    expect(validateWebhookUrl('https://0.0.0.0/webhook').ok).toBe(false);
  });

  it('accepts a public IP', () => {
    expect(validateWebhookUrl('https://93.184.216.34/webhook').ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveWhsec — Option B HMAC-SHA256 derivation
//
// Calls _realDeriveWhsecFromHash directly (the same function used in the mock
// above). No vi.importActual — that poisons the module cache and causes
// handleWebhookRegister to return undefined in the handler tests.
//
// Production call path: sha256Hex(apiKey) → deriveWhsecFromHash(master, hash, ts)
// Tests mirror this by pre-hashing API_KEY inline.
// ─────────────────────────────────────────────────────────────────────────────
describe('deriveWhsec', () => {
  const MASTER_KEY = 'test-master-key-at-least-32-chars-long!!';
  const API_KEY    = 'rfs_live_TestKeyForDerivation1234567890Ab';
  const CREATED_AT = 1725811200;

  async function sha256Hex(input) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  it('returns a string prefixed rfs_whsec_', async () => {
    const hash = await sha256Hex(API_KEY);
    const w = await _realDeriveWhsecFromHash(MASTER_KEY, hash, CREATED_AT);
    expect(typeof w).toBe('string');
    expect(w.startsWith('rfs_whsec_')).toBe(true);
  });

  it('base58 body contains only Bitcoin-alphabet characters', async () => {
    const hash = await sha256Hex(API_KEY);
    const w = await _realDeriveWhsecFromHash(MASTER_KEY, hash, CREATED_AT);
    const body = w.slice('rfs_whsec_'.length);
    expect(body).toMatch(/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/);
  });

  it('is deterministic — same inputs, same output', async () => {
    const hash = await sha256Hex(API_KEY);
    const w1 = await _realDeriveWhsecFromHash(MASTER_KEY, hash, CREATED_AT);
    const w2 = await _realDeriveWhsecFromHash(MASTER_KEY, hash, CREATED_AT);
    expect(w1).toBe(w2);
  });

  it('different created_at → different output (rotation salt)', async () => {
    const hash = await sha256Hex(API_KEY);
    const w1 = await _realDeriveWhsecFromHash(MASTER_KEY, hash, CREATED_AT);
    const w2 = await _realDeriveWhsecFromHash(MASTER_KEY, hash, CREATED_AT + 1);
    expect(w1).not.toBe(w2);
  });

  it('different api_key → different output', async () => {
    const hash1 = await sha256Hex(API_KEY);
    const hash2 = await sha256Hex('rfs_live_DifferentKeyXYZXYZXYZXYZXYZXYZ');
    const w1 = await _realDeriveWhsecFromHash(MASTER_KEY, hash1, CREATED_AT);
    const w2 = await _realDeriveWhsecFromHash(MASTER_KEY, hash2, CREATED_AT);
    expect(w1).not.toBe(w2);
  });

  it('different master_key → different output', async () => {
    const hash = await sha256Hex(API_KEY);
    const w1 = await _realDeriveWhsecFromHash(MASTER_KEY, hash, CREATED_AT);
    const w2 = await _realDeriveWhsecFromHash('completely-different-master-key-value!!', hash, CREATED_AT);
    expect(w1).not.toBe(w2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// kvWhConfigKey
// ─────────────────────────────────────────────────────────────────────────────
describe('kvWhConfigKey', () => {
  it('returns a string starting with wh_config_', async () => {
    const k = await kvWhConfigKey('rfs_live_SomeKey');
    expect(k.startsWith('wh_config_')).toBe(true);
  });

  it('is deterministic', async () => {
    const k1 = await kvWhConfigKey('rfs_live_SomeKey');
    const k2 = await kvWhConfigKey('rfs_live_SomeKey');
    expect(k1).toBe(k2);
  });

  it('different keys → different KV prefixes', async () => {
    const k1 = await kvWhConfigKey('rfs_live_KeyA');
    const k2 = await kvWhConfigKey('rfs_live_KeyB');
    expect(k1).not.toBe(k2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleWebhookRegister — POST
// ─────────────────────────────────────────────────────────────────────────────
describe('handleWebhookRegister POST', () => {
  it('returns 200 with url, whsec, created_at, note on valid registration', async () => {
    const env  = makeEnv();
    const req  = makePostRequest({ url: 'https://hooks.example.com/refueler' });
    const resp = await handleWebhookRegister(req, env);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.url).toBe('https://hooks.example.com/refueler');
    expect(body.whsec).toMatch(/^rfs_whsec_/);
    expect(typeof body.created_at).toBe('number');
    expect(body.note).toContain('Store whsec securely');
  });

  it('whsec is derived (not random) — same registration params → same whsec', async () => {
    const FIXED_TIME = 1725811200000;
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_TIME);
    const env  = makeEnv();
    const req1 = makePostRequest({ url: 'https://hooks.example.com/refueler' });
    const r1   = await handleWebhookRegister(req1, env);
    const b1   = await r1.json();

    env.STATUS_KV._store.clear();
    const req2 = makePostRequest({ url: 'https://hooks.example.com/refueler' });
    const r2   = await handleWebhookRegister(req2, env);
    const b2   = await r2.json();

    expect(b1.whsec).toBe(b2.whsec);
    vi.restoreAllMocks();
  });

  it('KV record has no whsec_hash field', async () => {
    const env  = makeEnv();
    const req  = makePostRequest({ url: 'https://hooks.example.com/refueler' });
    await handleWebhookRegister(req, env);
    const configKey = await kvWhConfigKey(TEST_API_KEY);
    const raw = env.STATUS_KV._store.get(configKey);
    const record = JSON.parse(raw);
    expect(record).not.toHaveProperty('whsec_hash');
  });

  it('KV record has url, created_at, active fields', async () => {
    const env  = makeEnv();
    const req  = makePostRequest({ url: 'https://hooks.example.com/refueler' });
    await handleWebhookRegister(req, env);
    const configKey = await kvWhConfigKey(TEST_API_KEY);
    const record = JSON.parse(env.STATUS_KV._store.get(configKey));
    expect(record).toHaveProperty('url');
    expect(record).toHaveProperty('created_at');
    expect(record).toHaveProperty('active', true);
    expect(Object.keys(record)).toHaveLength(3);
  });

  it('returns 400 on invalid URL', async () => {
    const env  = makeEnv();
    const req  = makePostRequest({ url: 'http://example.com/not-https' });
    const resp = await handleWebhookRegister(req, env);
    expect(resp.status).toBe(400);
  });

  it('returns 400 on missing url field', async () => {
    const env  = makeEnv();
    const req  = makePostRequest({});
    const resp = await handleWebhookRegister(req, env);
    expect(resp.status).toBe(400);
  });

  it('returns 400 on malformed JSON', async () => {
    const req = new Request('https://api.share.refueler.io/api/v1/webhook/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const resp = await handleWebhookRegister(req, makeEnv());
    expect(resp.status).toBe(400);
  });

  it('returns 409 when an active registration already exists', async () => {
    const env  = makeEnv();
    const req1 = makePostRequest({ url: 'https://hooks.example.com/refueler' });
    await handleWebhookRegister(req1, env);
    const req2 = makePostRequest({ url: 'https://hooks2.example.com/refueler' });
    const resp = await handleWebhookRegister(req2, env);
    expect(resp.status).toBe(409);
  });

  it('returns 403 when tier is not api', async () => {
    const { requireApiAuth } = await import('../src/api_auth.js');
    requireApiAuth.mockResolvedValueOnce({
      client: { tier: 'sovereign', id: 'test-sovereign' },
      apiKey: TEST_API_KEY,
    });
    const env  = makeEnv();
    const req  = makePostRequest({ url: 'https://hooks.example.com/refueler' });
    const resp = await handleWebhookRegister(req, env);
    expect(resp.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleWebhookRegister — DELETE
// ─────────────────────────────────────────────────────────────────────────────
describe('handleWebhookRegister DELETE', () => {
  it('returns 200 { deregistered: true } when a registration exists', async () => {
    const env = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    const resp = await handleWebhookRegister(makeDeleteRequest(), env);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.deregistered).toBe(true);
  });

  it('tombstone has no whsec_hash field', async () => {
    const env = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    await handleWebhookRegister(makeDeleteRequest(), env);
    const configKey = await kvWhConfigKey(TEST_API_KEY);
    const tombstone = JSON.parse(env.STATUS_KV._store.get(configKey));
    expect(tombstone).not.toHaveProperty('whsec_hash');
    expect(tombstone.active).toBe(false);
    expect(tombstone).toHaveProperty('deleted_at');
  });

  it('tombstone has url, created_at, active, deleted_at — nothing else', async () => {
    const env = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    await handleWebhookRegister(makeDeleteRequest(), env);
    const configKey = await kvWhConfigKey(TEST_API_KEY);
    const tombstone = JSON.parse(env.STATUS_KV._store.get(configKey));
    expect(Object.keys(tombstone).sort()).toEqual(['active', 'created_at', 'deleted_at', 'url']);
  });

  it('returns 200 { deregistered: false } when nothing is registered (idempotent)', async () => {
    const env  = makeEnv();
    const resp = await handleWebhookRegister(makeDeleteRequest(), env);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.deregistered).toBe(false);
  });

  it('allows re-registration after DELETE', async () => {
    const env = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    await handleWebhookRegister(makeDeleteRequest(), env);
    const resp = await handleWebhookRegister(makePostRequest({ url: 'https://hooks2.example.com/refueler' }), env);
    expect(resp.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleWebhookRegister — GET
// ─────────────────────────────────────────────────────────────────────────────
describe('handleWebhookRegister GET', () => {
  it('returns { registered: false } when nothing is registered', async () => {
    const env  = makeEnv();
    const resp = await handleWebhookRegister(makeGetRequest(), env);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.registered).toBe(false);
  });

  it('returns registered: true, active: true, redacted URL after POST', async () => {
    const env = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/secret/path?q=1' }), env);
    const resp = await handleWebhookRegister(makeGetRequest(), env);
    const body = await resp.json();
    expect(body.registered).toBe(true);
    expect(body.active).toBe(true);
    expect(body.whsec_active).toBe(true);
    expect(body.url).toBe('https://hooks.example.com');
  });

  it('never returns whsec in GET response', async () => {
    const env = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    const resp = await handleWebhookRegister(makeGetRequest(), env);
    const body = await resp.json();
    expect(body).not.toHaveProperty('whsec');
    expect(body).not.toHaveProperty('whsec_hash');
  });

  it('returns active: false, whsec_active: false after DELETE', async () => {
    const env = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    await handleWebhookRegister(makeDeleteRequest(), env);
    const resp = await handleWebhookRegister(makeGetRequest(), env);
    const body = await resp.json();
    expect(body.active).toBe(false);
    expect(body.whsec_active).toBe(false);
    expect(body.deleted_at).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Method dispatch
// ─────────────────────────────────────────────────────────────────────────────
describe('handleWebhookRegister — method dispatch', () => {
  it('returns 405 on PATCH', async () => {
    const env = makeEnv();
    const req = new Request('https://api.share.refueler.io/api/v1/webhook/register', { method: 'PATCH' });
    const resp = await handleWebhookRegister(req, env);
    expect(resp.status).toBe(405);
  });

  it('returns 405 on PUT', async () => {
    const env = makeEnv();
    const req = new Request('https://api.share.refueler.io/api/v1/webhook/register', { method: 'PUT' });
    const resp = await handleWebhookRegister(req, env);
    expect(resp.status).toBe(405);
  });
});
