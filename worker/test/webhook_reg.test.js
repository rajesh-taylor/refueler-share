// worker/test/webhook_reg.test.js
//
// SW4-patch — Option B HMAC derivation.
// SW9a rewrite — clean mock architecture for current Vitest/ESM environment.
//
// Key design decisions:
//   - vi.mock factories are hoisted above all imports and const declarations.
//     All helpers used inside a factory must be defined INSIDE that factory.
//   - requireApiAuth is a vi.fn() defined inside the api_auth mock factory,
//     then re-exported via the module-level binding so tests can call
//     mockResolvedValueOnce on it via the static import.
//   - No vi.importActual anywhere — it poisons the module cache.
//   - No dynamic import() inside test bodies — use static imports only.
//   - vi.restoreAllMocks() must NEVER be called in this file — it restores
//     requireApiAuth to its original (unmocked) implementation and poisons
//     all subsequent tests. Use targeted dateNowSpy.mockRestore() instead.
//
// Test count: 50

import { describe, it, expect, vi } from 'vitest';
import {
  validateWebhookUrl,
  kvWhConfigKey,
  handleWebhookRegister,
} from '../src/webhook_reg.js';
import { requireApiAuth }      from '../src/api_auth.js';
import { deriveWhsecFromHash } from '../src/webhook_delivery.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock api_auth.js
//
// requireApiAuth is a vi.fn() defined inside the factory so it is a proper
// Vitest spy with .mockResolvedValue / .mockResolvedValueOnce support.
// sha256Hex is the real implementation — kvWhConfigKey depends on it and tests
// compare the KV key derived in the test against the key written by the handler.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../src/api_auth.js', () => {
  const _requireApiAuth = vi.fn().mockResolvedValue({
    client: { tier: 'api', id: 'test-client-001' },
    apiKey: 'rfs_live_TestKeyForWebhookRegTests1234567890Ab',
  });

  async function _sha256Hex(input) {
    const enc  = new TextEncoder();
    const data = typeof input === 'string' ? enc.encode(input) : input;
    const buf  = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  return {
    requireApiAuth: _requireApiAuth,
    sha256Hex:      _sha256Hex,
    kvClientKey:    async (k) => `api_client_${await _sha256Hex(k)}`,
    kvQuotaKey:     async (k) => `api_quota_${await _sha256Hex(k)}`,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Mock webhook_delivery.js
//
// deriveWhsecFromHash is the real HMAC-SHA256 + base58 derivation, defined
// inside the factory so it is not in the TDZ when the factory runs.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../src/webhook_delivery.js', () => {
  const SIGN_DOMAIN_TAG = 'refueler.webhook.v1.sign';
  const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  async function _deriveWhsecFromHash(masterKey, apiKeyHash, createdAt) {
    const enc         = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(masterKey),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const message   = `${SIGN_DOMAIN_TAG}\n${apiKeyHash}\n${createdAt}`;
    const sigBuffer = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(message));
    const bytes     = new Uint8Array(sigBuffer);

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
    const b58 = '1'.repeat(leadingZeroes) + digits.reverse().map(d => BASE58_ALPHABET[d]).join('');
    return `rfs_whsec_${b58}`;
  }

  return {
    deriveWhsecFromHash:   _deriveWhsecFromHash,
    findApiKeyHashForUuid: vi.fn(async () => null),
    deliverWebhookInline:  vi.fn(async () => {}),
    retryDeadLetterQueue:  vi.fn(async () => {}),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TEST_API_KEY = 'rfs_live_TestKeyForWebhookRegTests1234567890Ab';

function makeEnv(overrides = {}) {
  const store = new Map();
  return {
    WEBHOOK_SIGNING_MASTER_KEY: 'test-master-key-at-least-32-chars-long!!',
    STATUS_KV: {
      get:    async (k, opts) => {
        const raw = store.get(k);
        if (!raw) return null;
        if (opts?.type === 'json') return JSON.parse(raw);
        return raw;
      },
      put:    async (k, v) => { store.set(k, v); },
      _store: store,
    },
    ...overrides,
  };
}

function makePostRequest(body) {
  return new Request('https://api.share.refueler.io/api/v1/webhook/register', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

function makeDeleteRequest() {
  return new Request('https://api.share.refueler.io/api/v1/webhook/register', {
    method:  'DELETE',
    body:    '{}',
    headers: { 'Content-Type': 'application/json' },
  });
}

// Bug fix: GET requests cannot carry a body — Fetch API throws synchronously.
function makeGetRequest() {
  return new Request('https://api.share.refueler.io/api/v1/webhook/register', {
    method:  'GET',
    headers: { 'Content-Type': 'application/json' },
  });
}

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
    expect(validateWebhookUrl('https://hooks.example.com/refueler?v=1#anchor').ok).toBe(true);
  });

  it('accepts HTTPS URL with port', () => {
    expect(validateWebhookUrl('https://example.com:8443/webhook').ok).toBe(true);
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

  it('rejects 172.31.x.x (RFC1918 upper boundary)', () => {
    expect(validateWebhookUrl('https://172.31.255.255/webhook').ok).toBe(false);
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
    expect(validateWebhookUrl('https://203.0.113.5/webhook').ok).toBe(true);
  });

  it('accepts a subdomain', () => {
    expect(validateWebhookUrl('https://hooks.my-company.io/refueler/v2').ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// kvWhConfigKey
// ─────────────────────────────────────────────────────────────────────────────
describe('kvWhConfigKey', () => {
  it('returns a string starting with wh_config_', async () => {
    const k = await kvWhConfigKey('rfs_live_SomeKey');
    expect(k).toMatch(/^wh_config_/);
  });

  it('returns a deterministic key for the same input', async () => {
    const k1 = await kvWhConfigKey('rfs_live_SameKey');
    const k2 = await kvWhConfigKey('rfs_live_SameKey');
    expect(k1).toBe(k2);
  });

  it('returns different keys for different inputs', async () => {
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
    // Targeted spy — restore only Date.now, never vi.restoreAllMocks() which
    // would nuke the requireApiAuth mock and poison every subsequent test.
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(FIXED_TIME);

    const env  = makeEnv();
    const r1   = await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    const b1   = await r1.json();

    env.STATUS_KV._store.clear();
    const r2 = await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    const b2 = await r2.json();

    expect(b1.whsec).toBe(b2.whsec);
    dateNowSpy.mockRestore();
  });

  it('KV record has no whsec_hash field', async () => {
    const env       = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    const configKey = await kvWhConfigKey(TEST_API_KEY);
    const record    = JSON.parse(env.STATUS_KV._store.get(configKey));
    expect(record).not.toHaveProperty('whsec_hash');
  });

  it('KV record has url, created_at, active fields', async () => {
    const env       = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    const configKey = await kvWhConfigKey(TEST_API_KEY);
    const record    = JSON.parse(env.STATUS_KV._store.get(configKey));
    expect(record).toHaveProperty('url');
    expect(record).toHaveProperty('created_at');
    expect(record).toHaveProperty('active', true);
    expect(Object.keys(record)).toHaveLength(3);
  });

  it('returns 400 on invalid URL', async () => {
    const resp = await handleWebhookRegister(makePostRequest({ url: 'http://example.com/not-https' }), makeEnv());
    expect(resp.status).toBe(400);
  });

  it('returns 400 on missing url field', async () => {
    const resp = await handleWebhookRegister(makePostRequest({}), makeEnv());
    expect(resp.status).toBe(400);
  });

  it('returns 400 on malformed JSON', async () => {
    const req  = new Request('https://api.share.refueler.io/api/v1/webhook/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json',
    });
    const resp = await handleWebhookRegister(req, makeEnv());
    expect(resp.status).toBe(400);
  });

  it('returns 409 when an active registration already exists', async () => {
    const env = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    const resp = await handleWebhookRegister(makePostRequest({ url: 'https://hooks2.example.com/refueler' }), env);
    expect(resp.status).toBe(409);
  });

  it('returns 403 when tier is not api', async () => {
    requireApiAuth.mockResolvedValueOnce({
      client: { tier: 'max', id: 'test-max' },
      apiKey: TEST_API_KEY,
    });
    const resp = await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), makeEnv());
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
    expect((await resp.json()).deregistered).toBe(true);
  });

  it('tombstone has no whsec_hash field', async () => {
    const env = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    await handleWebhookRegister(makeDeleteRequest(), env);
    const tombstone = JSON.parse(env.STATUS_KV._store.get(await kvWhConfigKey(TEST_API_KEY)));
    expect(tombstone).not.toHaveProperty('whsec_hash');
    expect(tombstone.active).toBe(false);
    expect(tombstone).toHaveProperty('deleted_at');
  });

  it('tombstone has url, created_at, active, deleted_at — nothing else', async () => {
    const env = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    await handleWebhookRegister(makeDeleteRequest(), env);
    const tombstone = JSON.parse(env.STATUS_KV._store.get(await kvWhConfigKey(TEST_API_KEY)));
    expect(Object.keys(tombstone).sort()).toEqual(['active', 'created_at', 'deleted_at', 'url']);
  });

  it('returns 200 { deregistered: false } when nothing is registered (idempotent)', async () => {
    const resp = await handleWebhookRegister(makeDeleteRequest(), makeEnv());
    expect(resp.status).toBe(200);
    expect((await resp.json()).deregistered).toBe(false);
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
    const resp = await handleWebhookRegister(makeGetRequest(), makeEnv());
    expect(resp.status).toBe(200);
    expect((await resp.json()).registered).toBe(false);
  });

  it('returns registered: true, active: true, redacted URL after POST', async () => {
    const env = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/secret/path?q=1' }), env);
    const body = await (await handleWebhookRegister(makeGetRequest(), env)).json();
    expect(body.registered).toBe(true);
    expect(body.active).toBe(true);
    expect(body.whsec_active).toBe(true);
    expect(body.url).toBe('https://hooks.example.com');
  });

  it('never returns whsec in GET response', async () => {
    const env = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    const body = await (await handleWebhookRegister(makeGetRequest(), env)).json();
    expect(body).not.toHaveProperty('whsec');
    expect(body).not.toHaveProperty('whsec_hash');
  });

  it('returns active: false, whsec_active: false after DELETE', async () => {
    const env = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    await handleWebhookRegister(makeDeleteRequest(), env);
    const body = await (await handleWebhookRegister(makeGetRequest(), env)).json();
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
    const req  = new Request('https://api.share.refueler.io/api/v1/webhook/register', {
      method: 'PATCH', body: '{}', headers: { 'Content-Type': 'application/json' },
    });
    const resp = await handleWebhookRegister(req, makeEnv());
    expect(resp.status).toBe(405);
  });

  it('returns 405 on PUT', async () => {
    const req  = new Request('https://api.share.refueler.io/api/v1/webhook/register', {
      method: 'PUT', body: '{}', headers: { 'Content-Type': 'application/json' },
    });
    const resp = await handleWebhookRegister(req, makeEnv());
    expect(resp.status).toBe(405);
  });
});
