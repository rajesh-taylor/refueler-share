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
// Test count: 42

import { describe, it, expect, vi } from 'vitest';
import {
  validateWebhookUrl,
  handleWebhookRegister,
} from '../src/webhook_reg.js';
import { requireApiAuth }           from '../src/api_auth.js';
import { whConfigKey, deriveWhsec } from '../src/webhook_delivery.js';

// API-Repair-1: wh_config_ is keyed by the client's org (keyed tag) and MAC'd;
// the real webhook_delivery.js is used (no mock), with KV_MAC_KEY in the env.
const ORG = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';

// ─────────────────────────────────────────────────────────────────────────────
// Mock api_auth.js
//
// requireApiAuth is a vi.fn() defined inside the factory so it is a proper
// Vitest spy with .mockResolvedValue / .mockResolvedValueOnce support.
// sha256Hex is the real implementation (other modules import it) and tests
// compare the KV key derived in the test against the key written by the handler.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../src/api_auth.js', () => {
  const _requireApiAuth = vi.fn().mockResolvedValue({
    client: { tier: 'api', org_account_id: '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c' },
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
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TEST_API_KEY = 'rfs_live_TestKeyForWebhookRegTests1234567890Ab';

function makeEnv(overrides = {}) {
  const store = new Map();
  return {
    WEBHOOK_SIGNING_MASTER_KEY: 'test-master-key-at-least-32-chars-long!!',
    KV_MAC_KEY:                 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=',
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
// whConfigKey (org tag — no raw org id in the KV key)
// ─────────────────────────────────────────────────────────────────────────────
describe('whConfigKey', () => {
  it('is wh_config_ + 32 hex chars, deterministic, and never contains the org id', async () => {
    const env = makeEnv();
    const k1 = await whConfigKey(env, ORG);
    expect(k1).toMatch(/^wh_config_[0-9a-f]{32}$/);
    expect(await whConfigKey(env, ORG)).toBe(k1);
    expect(k1).not.toContain(ORG.replace(/-/g, '').slice(0, 8));
  });

  it('differs per org, and is null without KV_MAC_KEY', async () => {
    const env = makeEnv();
    expect(await whConfigKey(env, '00000000-0000-4000-8000-000000000001')).not.toBe(await whConfigKey(env, ORG));
    expect(await whConfigKey(makeEnv({ KV_MAC_KEY: undefined }), ORG)).toBeNull();
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
    expect(b1.whsec).toBe(await deriveWhsec(env, ORG, Math.floor(FIXED_TIME / 1000)));
    dateNowSpy.mockRestore();
  });

  it('KV record has no whsec_hash field', async () => {
    const env       = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    const configKey = await whConfigKey(env, ORG);
    const record    = JSON.parse(env.STATUS_KV._store.get(configKey));
    expect(record).not.toHaveProperty('whsec_hash');
  });

  it('KV record has url, created_at, active, deleted_at (+ v, mac) — nothing else', async () => {
    const env       = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    const configKey = await whConfigKey(env, ORG);
    const record    = JSON.parse(env.STATUS_KV._store.get(configKey));
    expect(record).toHaveProperty('url');
    expect(record).toHaveProperty('created_at');
    expect(record).toHaveProperty('active', true);
    expect(Object.keys(record).sort()).toEqual(['active', 'created_at', 'deleted_at', 'mac', 'url', 'v']);
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
      client: { tier: 'max', org_account_id: ORG },
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
    const tombstone = JSON.parse(env.STATUS_KV._store.get(await whConfigKey(env, ORG)));
    expect(tombstone).not.toHaveProperty('whsec_hash');
    expect(tombstone.active).toBe(false);
    expect(tombstone).toHaveProperty('deleted_at');
  });

  it('tombstone has url, created_at, active, deleted_at (+ v, mac) — nothing else', async () => {
    const env = makeEnv();
    await handleWebhookRegister(makePostRequest({ url: 'https://hooks.example.com/refueler' }), env);
    await handleWebhookRegister(makeDeleteRequest(), env);
    const tombstone = JSON.parse(env.STATUS_KV._store.get(await whConfigKey(env, ORG)));
    expect(Object.keys(tombstone).sort()).toEqual(['active', 'created_at', 'deleted_at', 'mac', 'url', 'v']);
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
