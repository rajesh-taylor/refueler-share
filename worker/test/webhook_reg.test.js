// worker/test/webhook_reg.test.js
//
// SW4 — Unit tests for webhook registration endpoints.
//
// Coverage:
//   validateWebhookUrl  — URL validation (18 cases)
//   generateWhsec       — key generation shape + uniqueness
//   kvWhConfigKey       — KV key derivation
//   handleWebhookRegister — POST / DELETE / GET (all paths)
//
// Mocking strategy:
//   - requireApiAuth is mocked at the module level (vi.mock).
//   - blake3_worker.js and api_auth.sha256Hex are mocked to avoid WASM in tests.
//   - STATUS_KV is a simple in-memory Map stub with get/put/delete.
//   - No Supabase, no R2, no Stripe — webhook_reg touches none of these.
//
// Auth contract under test:
//   - tier !== 'api'  → 403
//   - Auth failure    → propagated from requireApiAuth mock (401)
//   - tier === 'api'  → proceeds to handler
//
// Note: GitHub Push Protection pattern-matches rfs_live_ and rfs_sign_ prefixes.
// Test keys use rfs_test_ and rfs_test_sign_ prefixes per locked convention.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — must be declared before the import under test.
// ─────────────────────────────────────────────────────────────────────────────

// vi.mock is hoisted to the top of the file by vitest — the factory must be
// fully self-contained with no references to outer const/let variables, which
// would not yet be initialised at hoist time.
vi.mock('../src/api_auth.js', () => ({
  requireApiAuth: vi.fn(),
  sha256Hex: vi.fn(async (input) => {
    const bytes = typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input;
    const hex = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    // Pad/truncate to 64 hex chars to match real SHA-256 output shape.
    return hex.substring(0, 64).padEnd(64, '0');
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import after mocks are in place.
// ─────────────────────────────────────────────────────────────────────────────

import {
  validateWebhookUrl,
  generateWhsec,
  kvWhConfigKey,
  handleWebhookRegister,
} from '../src/webhook_reg.js';

import { requireApiAuth } from '../src/api_auth.js';

// ─────────────────────────────────────────────────────────────────────────────
// KV stub
// ─────────────────────────────────────────────────────────────────────────────

function makeKv() {
  const store = new Map();
  return {
    _store: store,
    async get(key, opts) {
      const val = store.get(key) ?? null;
      if (val === null) return null;
      if (opts?.type === 'json') return JSON.parse(val);
      return val;
    },
    async put(key, value, _opts) {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Request factory helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRequest(method, body = null) {
  const bodyStr = body ? JSON.stringify(body) : '';
  return new Request('https://api.share.refueler.io/api/v1/webhook/register', {
    method,
    headers: {
      'Content-Type':    'application/json',
      'Authorization':   'HMAC-SHA256 key=rfs_test_abc, sig=deadsig, ts=0',
      'X-Api-Sign-Key':  'rfs_test_sign_abc',
    },
    body: bodyStr || undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth helper: configure requireApiAuth mock for a given outcome.
// ─────────────────────────────────────────────────────────────────────────────

function mockAuth({ tier = 'api', apiKey = 'rfs_test_abc' } = {}) {
  requireApiAuth.mockResolvedValue({
    client: { tier, rail: 'identity', active: true },
    apiKey,
  });
}

function mockAuthFailure(status = 401, message = 'Invalid API credentials') {
  requireApiAuth.mockRejectedValue(
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: validateWebhookUrl
// ─────────────────────────────────────────────────────────────────────────────

describe('validateWebhookUrl', () => {
  it('accepts a valid HTTPS URL', () => {
    const result = validateWebhookUrl('https://example.com/hook');
    expect(result.ok).toBe(true);
    expect(result.url).toBeInstanceOf(URL);
  });

  it('accepts an HTTPS URL with a port', () => {
    const result = validateWebhookUrl('https://example.com:8443/hook');
    expect(result.ok).toBe(true);
  });

  it('accepts an HTTPS URL with query string and path', () => {
    const result = validateWebhookUrl('https://example.com/hook?source=refueler');
    expect(result.ok).toBe(true);
  });

  it('rejects null input', () => {
    const result = validateWebhookUrl(null);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it('rejects empty string', () => {
    const result = validateWebhookUrl('');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it('rejects a non-URL string', () => {
    const result = validateWebhookUrl('not-a-url');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/valid URL/i);
  });

  it('rejects HTTP (non-HTTPS)', () => {
    const result = validateWebhookUrl('http://example.com/hook');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTPS/i);
  });

  it('rejects ws:// protocol', () => {
    const result = validateWebhookUrl('ws://example.com/hook');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTPS/i);
  });

  it('rejects localhost', () => {
    const result = validateWebhookUrl('https://localhost/hook');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/localhost/i);
  });

  it('rejects LOCALHOST (case-insensitive)', () => {
    const result = validateWebhookUrl('https://LOCALHOST/hook');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/localhost/i);
  });

  it('rejects RFC1918 10.x.x.x', () => {
    const result = validateWebhookUrl('https://10.0.0.1/hook');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private/i);
  });

  it('rejects RFC1918 172.16.x.x', () => {
    const result = validateWebhookUrl('https://172.16.0.1/hook');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private/i);
  });

  it('rejects RFC1918 172.31.x.x (upper bound of /12)', () => {
    const result = validateWebhookUrl('https://172.31.255.255/hook');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private/i);
  });

  it('accepts 172.15.x.x (just outside RFC1918 /12)', () => {
    const result = validateWebhookUrl('https://172.15.0.1/hook');
    expect(result.ok).toBe(true);
  });

  it('rejects RFC1918 192.168.x.x', () => {
    const result = validateWebhookUrl('https://192.168.1.1/hook');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private/i);
  });

  it('rejects loopback 127.0.0.1', () => {
    const result = validateWebhookUrl('https://127.0.0.1/hook');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private/i);
  });

  it('rejects link-local 169.254.x.x', () => {
    const result = validateWebhookUrl('https://169.254.0.1/hook');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private/i);
  });

  it('rejects unspecified 0.0.0.0', () => {
    const result = validateWebhookUrl('https://0.0.0.0/hook');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: generateWhsec
// ─────────────────────────────────────────────────────────────────────────────

describe('generateWhsec', () => {
  it('returns a string with rfs_whsec_ prefix', async () => {
    const key = await generateWhsec();
    expect(key).toMatch(/^rfs_whsec_/);
  });

  it('returns a key with non-trivial suffix', async () => {
    const key = await generateWhsec();
    const suffix = key.slice('rfs_whsec_'.length);
    expect(suffix.length).toBeGreaterThan(30);
  });

  it('returns unique keys on successive calls', async () => {
    const keys = await Promise.all(Array.from({ length: 20 }, () => generateWhsec()));
    const unique = new Set(keys);
    expect(unique.size).toBe(20);
  });

  it('uses only base58 characters in suffix', async () => {
    const key = await generateWhsec();
    const suffix = key.slice('rfs_whsec_'.length);
    // Base58 alphabet: no 0, O, I, l
    expect(suffix).toMatch(/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: kvWhConfigKey
// ─────────────────────────────────────────────────────────────────────────────

describe('kvWhConfigKey', () => {
  it('returns a string prefixed wh_config_', async () => {
    const key = await kvWhConfigKey('rfs_test_abc');
    expect(key).toMatch(/^wh_config_/);
  });

  it('returns the same key for the same input', async () => {
    const k1 = await kvWhConfigKey('rfs_test_abc');
    const k2 = await kvWhConfigKey('rfs_test_abc');
    expect(k1).toBe(k2);
  });

  it('returns different keys for different inputs', async () => {
    const k1 = await kvWhConfigKey('rfs_test_abc');
    const k2 = await kvWhConfigKey('rfs_test_xyz');
    expect(k1).not.toBe(k2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: handleWebhookRegister — auth gate
// ─────────────────────────────────────────────────────────────────────────────

describe('handleWebhookRegister — auth gate', () => {
  let env;
  beforeEach(() => {
    env = { STATUS_KV: makeKv() };
    vi.clearAllMocks();
  });

  it('propagates 401 from requireApiAuth', async () => {
    mockAuthFailure(401);
    const req = makeRequest('POST', { url: 'https://example.com/hook' });
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(401);
  });

  it('returns 403 when tier is sovereign', async () => {
    mockAuth({ tier: 'sovereign' });
    const req = makeRequest('POST', { url: 'https://example.com/hook' });
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/API tier/i);
  });

  it('returns 403 when tier is citizen', async () => {
    mockAuth({ tier: 'citizen' });
    const req = makeRequest('GET');
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(403);
  });

  it('returns 405 for unsupported method', async () => {
    mockAuth();
    const req = makeRequest('PATCH');
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(405);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: POST /api/v1/webhook/register
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/webhook/register', () => {
  let env;
  beforeEach(() => {
    env = { STATUS_KV: makeKv() };
    vi.clearAllMocks();
  });

  it('registers a valid URL and returns rfs_whsec_', async () => {
    mockAuth();
    const req = makeRequest('POST', { url: 'https://hooks.example.com/refueler' });
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('https://hooks.example.com/refueler');
    expect(body.whsec).toMatch(/^rfs_whsec_/);
    expect(body.created_at).toBeTypeOf('number');
    expect(body.note).toMatch(/Store/i);
  });

  it('persists a wh_config_ KV record with whsec_hash, not raw whsec', async () => {
    mockAuth({ apiKey: 'rfs_test_abc' });
    const req = makeRequest('POST', { url: 'https://hooks.example.com/refueler' });
    await handleWebhookRegister(req, env);

    const configKey = await kvWhConfigKey('rfs_test_abc');
    const record = await env.STATUS_KV.get(configKey, { type: 'json' });
    expect(record).not.toBeNull();
    expect(record.active).toBe(true);
    expect(record.url).toBe('https://hooks.example.com/refueler');
    expect(record.whsec_hash).toBeDefined();
    expect(typeof record.whsec_hash).toBe('string');
    // whsec_hash must not be the raw key
    expect(record.whsec_hash).not.toMatch(/^rfs_whsec_/);
  });

  it('returns 400 for missing URL', async () => {
    mockAuth();
    const req = makeRequest('POST', {});
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/url/i);
  });

  it('returns 400 for HTTP URL', async () => {
    mockAuth();
    const req = makeRequest('POST', { url: 'http://example.com/hook' });
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/HTTPS/i);
  });

  it('returns 400 for localhost URL', async () => {
    mockAuth();
    const req = makeRequest('POST', { url: 'https://localhost/hook' });
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(400);
  });

  it('returns 400 for private IP URL', async () => {
    mockAuth();
    const req = makeRequest('POST', { url: 'https://192.168.1.1/hook' });
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(400);
  });

  it('returns 409 if a registration already exists and is active', async () => {
    mockAuth({ apiKey: 'rfs_test_abc' });
    // Seed an existing active record
    const configKey = await kvWhConfigKey('rfs_test_abc');
    await env.STATUS_KV.put(configKey, JSON.stringify({
      url:        'https://old.example.com/hook',
      whsec_hash: 'oldhash',
      created_at: 1000,
      active:     true,
    }));

    const req = makeRequest('POST', { url: 'https://new.example.com/hook' });
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already registered/i);
  });

  it('allows re-registration after a deleted (inactive) record', async () => {
    mockAuth({ apiKey: 'rfs_test_abc' });
    // Seed an inactive record (post-DELETE tombstone)
    const configKey = await kvWhConfigKey('rfs_test_abc');
    await env.STATUS_KV.put(configKey, JSON.stringify({
      url:        'https://old.example.com/hook',
      whsec_hash: 'oldhash',
      created_at: 1000,
      active:     false,
      deleted_at: 2000,
    }));

    const req = makeRequest('POST', { url: 'https://new.example.com/hook' });
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid JSON body', async () => {
    mockAuth();
    const req = new Request('https://api.share.refueler.io/api/v1/webhook/register', {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  'HMAC-SHA256 key=rfs_test_abc, sig=x, ts=0',
        'X-Api-Sign-Key': 'rfs_test_sign_abc',
      },
      body: 'not json',
    });
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/JSON/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: DELETE /api/v1/webhook/register
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/webhook/register', () => {
  let env;
  beforeEach(() => {
    env = { STATUS_KV: makeKv() };
    vi.clearAllMocks();
  });

  it('deregisters an active webhook', async () => {
    mockAuth({ apiKey: 'rfs_test_abc' });
    const configKey = await kvWhConfigKey('rfs_test_abc');
    await env.STATUS_KV.put(configKey, JSON.stringify({
      url:        'https://example.com/hook',
      whsec_hash: 'somehash',
      created_at: 1000,
      active:     true,
    }));

    const req = makeRequest('DELETE');
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deregistered).toBe(true);
  });

  it('sets active: false in KV after DELETE', async () => {
    mockAuth({ apiKey: 'rfs_test_abc' });
    const configKey = await kvWhConfigKey('rfs_test_abc');
    await env.STATUS_KV.put(configKey, JSON.stringify({
      url:        'https://example.com/hook',
      whsec_hash: 'somehash',
      created_at: 1000,
      active:     true,
    }));

    const req = makeRequest('DELETE');
    await handleWebhookRegister(req, env);

    const record = await env.STATUS_KV.get(configKey, { type: 'json' });
    expect(record.active).toBe(false);
    expect(record.deleted_at).toBeTypeOf('number');
  });

  it('is idempotent — 200 when no registration exists', async () => {
    mockAuth();
    const req = makeRequest('DELETE');
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deregistered).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: GET /api/v1/webhook/register
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/webhook/register', () => {
  let env;
  beforeEach(() => {
    env = { STATUS_KV: makeKv() };
    vi.clearAllMocks();
  });

  it('returns registered: false when no record exists', async () => {
    mockAuth();
    const req = makeRequest('GET');
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registered).toBe(false);
  });

  it('returns registered: true and redacted URL for active record', async () => {
    mockAuth({ apiKey: 'rfs_test_abc' });
    const configKey = await kvWhConfigKey('rfs_test_abc');
    await env.STATUS_KV.put(configKey, JSON.stringify({
      url:        'https://hooks.example.com/refueler?secret=abc&token=xyz',
      whsec_hash: 'somehash',
      created_at: 1000,
      active:     true,
    }));

    const req = makeRequest('GET');
    const res = await handleWebhookRegister(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registered).toBe(true);
    expect(body.active).toBe(true);
    expect(body.whsec_active).toBe(true);
    // URL must be redacted to scheme + host only — no path, query, or fragment.
    expect(body.url).toBe('https://hooks.example.com');
    expect(body.url).not.toContain('secret=abc');
    expect(body.url).not.toContain('/refueler');
  });

  it('never returns whsec or whsec_hash in GET response', async () => {
    mockAuth({ apiKey: 'rfs_test_abc' });
    const configKey = await kvWhConfigKey('rfs_test_abc');
    await env.STATUS_KV.put(configKey, JSON.stringify({
      url:        'https://example.com/hook',
      whsec_hash: 'supersecret',
      created_at: 1000,
      active:     true,
    }));

    const req = makeRequest('GET');
    const res = await handleWebhookRegister(req, env);
    const body = await res.json();
    // Must not leak whsec or its hash
    expect(body.whsec).toBeUndefined();
    expect(body.whsec_hash).toBeUndefined();
  });

  it('returns active: false for an inactive (deleted) record', async () => {
    mockAuth({ apiKey: 'rfs_test_abc' });
    const configKey = await kvWhConfigKey('rfs_test_abc');
    await env.STATUS_KV.put(configKey, JSON.stringify({
      url:        'https://example.com/hook',
      whsec_hash: 'somehash',
      created_at: 1000,
      active:     false,
      deleted_at: 2000,
    }));

    const req = makeRequest('GET');
    const res = await handleWebhookRegister(req, env);
    const body = await res.json();
    expect(body.registered).toBe(true);
    expect(body.active).toBe(false);
    expect(body.whsec_active).toBe(false);
    expect(body.deleted_at).toBe(2000);
  });
});
