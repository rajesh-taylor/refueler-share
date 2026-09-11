// worker/tests/unit/btc_rate.test.js
//
// Unit tests for:
//   - api_capabilities.js: cap.v1 response shape, RATE_CARD constants,
//     FEATURES, LIMITS, rails_available invariant, daily_reference_rate
//     null-on-cold-start and population-from-KV.
//   - btc_rate.js: POST /admin/btc-rate validation, GET /admin/btc-rate
//     cold-start / populated / staleness; refreshBtcRate ±20% guard,
//     cold-start unconditional write, CoinGecko error paths.
//
// Dependencies mocked: env.STATUS_KV (KV mock), env.AE (fire-and-forget),
// requireApiAuth (always resolves to identity rail), fetch (CoinGecko).
//
// Pattern: describe → test → assert. No external network calls.

import { describe, test, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// We import the modules under test directly. api_auth is mocked below.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../src/api_auth.js', () => ({
  requireApiAuth: vi.fn(),
  kvQuotaKey:     vi.fn(async (key) => `api_quota_${key}`),
}));

import {
  handleApiCapabilities,
  BUNDLE_DENOMINATIONS,
  BUNDLE_DEFAULT,
  RATE_CARD,
  BTC_RATE_KV_KEY,
} from '../src/handlers/api_capabilities.js';

import {
  handleAdminBtcRatePost,
  handleAdminBtcRateGet,
  refreshBtcRate,
} from '../src/handlers/btc_rate.js';

import { requireApiAuth, kvQuotaKey } from '../src/api_auth.js';

// ─────────────────────────────────────────────────────────────────────────────
// KV mock factory
// ─────────────────────────────────────────────────────────────────────────────
function makeKv(initial = {}) {
  const store = { ...initial };
  return {
    async get(key, opts = {}) {
      const val = store[key] ?? null;
      if (val === null) return null;
      if (opts.type === 'json') return JSON.parse(val);
      return val;
    },
    async put(key, value) {
      store[key] = typeof value === 'string' ? value : JSON.stringify(value);
    },
    _store: store,
  };
}

function makeEnv(kvData = {}, adminKey = 'test-admin-key') {
  return {
    STATUS_KV:  makeKv(kvData),
    ADMIN_KEY:  adminKey,
    AE:         { writeDataPoint: vi.fn() },
  };
}

function makeRequest(method, path, opts = {}) {
  const headers = new Headers(opts.headers ?? {});
  const body    = opts.body ? JSON.stringify(opts.body) : undefined;
  return new Request(`https://api.share.refueler.io${path}`, {
    method,
    headers,
    body,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// api_capabilities.js — exported constants
// ─────────────────────────────────────────────────────────────────────────────
describe('api_capabilities — constants', () => {
  test('BUNDLE_DENOMINATIONS contains the four locked lots', () => {
    expect(BUNDLE_DENOMINATIONS).toEqual([10, 50, 100, 500]);
  });

  test('BUNDLE_DEFAULT is 50', () => {
    expect(BUNDLE_DEFAULT).toBe(50);
  });

  test('RATE_CARD has integer values for all three actions', () => {
    expect(RATE_CARD.transfer).toBe(10);
    expect(RATE_CARD.storage_per_gb).toBe(100);
    expect(RATE_CARD.permanent_record).toBe(20);
    // All must be integers, never floats
    for (const val of Object.values(RATE_CARD)) {
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  test('BTC_RATE_KV_KEY matches the locked schema key', () => {
    expect(BTC_RATE_KV_KEY).toBe('btc_ref_rate:current');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleApiCapabilities — response shape
// ─────────────────────────────────────────────────────────────────────────────
describe('handleApiCapabilities — cap.v1 response shape', () => {
  beforeEach(() => {
    requireApiAuth.mockResolvedValue({
      client: { rail: 'identity' },
      apiKey: 'rfs_live_testkey',
    });
  });

  async function callCapabilities(env) {
    const req = makeRequest('GET', '/api/v1/capabilities');
    const res = await handleApiCapabilities(req, env);
    return { status: res.status, body: await res.json() };
  }

  test('returns 200 with schema_version: "cap.v1"', async () => {
    const { status, body } = await callCapabilities(makeEnv());
    expect(status).toBe(200);
    expect(body.schema_version).toBe('cap.v1');
  });

  test('rails_available is exactly ["identity"] — not modified by anything', async () => {
    const { body } = await callCapabilities(makeEnv());
    expect(body.rails_available).toEqual(['identity']);
  });

  test('credit_unit is "sat"', async () => {
    const { body } = await callCapabilities(makeEnv());
    expect(body.credit_unit).toBe('sat');
  });

  test('rate_card matches locked integer values', async () => {
    const { body } = await callCapabilities(makeEnv());
    expect(body.rate_card).toMatchObject({
      transfer:         10,
      storage_per_gb:   100,
      permanent_record: 20,
    });
  });

  test('rate_card_version is present and a string', async () => {
    const { body } = await callCapabilities(makeEnv());
    expect(typeof body.rate_card_version).toBe('string');
    expect(body.rate_card_version.length).toBeGreaterThan(0);
  });

  test('limits.transfer_expiry_days has citizen/sovereign/api keys', async () => {
    const { body } = await callCapabilities(makeEnv());
    expect(body.limits.transfer_expiry_days).toMatchObject({
      citizen:   7,
      sovereign: 90,
      api:       90,
    });
  });

  test('limits.max_file_size_gb is 250', async () => {
    const { body } = await callCapabilities(makeEnv());
    expect(body.limits.max_file_size_gb).toBe(250);
  });

  test('mcp_tools contains all four locked tool names', async () => {
    const { body } = await callCapabilities(makeEnv());
    expect(body.mcp_tools).toContain('refueler_capabilities');
    expect(body.mcp_tools).toContain('refueler_send_file');
    expect(body.mcp_tools).toContain('refueler_check_transfer');
    expect(body.mcp_tools).toContain('refueler_quote');
  });

  test('features.anonymous_rail is false (B7/NB-4 not live)', async () => {
    const { body } = await callCapabilities(makeEnv());
    expect(body.features.anonymous_rail).toBe(false);
  });

  test('features.silent_drop_anon is false (SD-block not yet shipped)', async () => {
    const { body } = await callCapabilities(makeEnv());
    expect(body.features.silent_drop_anon).toBe(false);
  });

  test('features.mcp_tools is true (shipped SW-MCP-W1)', async () => {
    const { body } = await callCapabilities(makeEnv());
    expect(body.features.mcp_tools).toBe(true);
  });

  test('daily_reference_rate is null on cold start — never invented', async () => {
    // KV is empty — no btc_ref_rate:current entry
    const { body } = await callCapabilities(makeEnv({}));
    expect(body.daily_reference_rate).toBeNull();
  });

  test('daily_reference_rate is populated from KV when entry exists', async () => {
    const rateEntry = {
      gbp_per_btc:  62000,
      source:       'coingecko',
      last_updated: '2026-09-11T03:00:00.000Z',
      set_by:       'coingecko_cron',
      previous:     null,
    };
    const env = makeEnv({
      [BTC_RATE_KV_KEY]: JSON.stringify(rateEntry),
    });
    const { body } = await callCapabilities(env);
    expect(body.daily_reference_rate).not.toBeNull();
    expect(body.daily_reference_rate.gbp_per_btc).toBe(62000);
    expect(body.daily_reference_rate.set_by).toBe('coingecko_cron');
    expect(body.daily_reference_rate.last_updated).toBe('2026-09-11T03:00:00.000Z');
    expect(body.daily_reference_rate.previous).toBeNull();
  });

  test('daily_reference_rate.previous is populated when previous exists in KV', async () => {
    const rateEntry = {
      gbp_per_btc:  63000,
      source:       'coingecko',
      last_updated: '2026-09-12T03:00:00.000Z',
      set_by:       'coingecko_cron',
      previous: {
        gbp_per_btc:  62000,
        set_by:       'coingecko_cron',
        last_updated: '2026-09-11T03:00:00.000Z',
      },
    };
    const env = makeEnv({ [BTC_RATE_KV_KEY]: JSON.stringify(rateEntry) });
    const { body } = await callCapabilities(env);
    expect(body.daily_reference_rate.previous.gbp_per_btc).toBe(62000);
  });

  test('quota.model is "kv_pool" on identity rail with no KV record', async () => {
    const { body } = await callCapabilities(makeEnv());
    expect(body.quota.model).toBe('kv_pool');
    expect(body.quota.remaining).toBeNull();
  });

  test('quota.remaining is populated from KV when record exists', async () => {
    // kvQuotaKey(rfs_live_testkey) → api_quota_rfs_live_testkey
    const env = makeEnv({
      'api_quota_rfs_live_testkey': JSON.stringify({ remaining: 49500, updated_at: 1725926400 }),
    });
    const { body } = await callCapabilities(env);
    expect(body.quota.remaining).toBe(49500);
    expect(body.quota.updated_at).toBe(1725926400);
  });

  test('anonymous rail: quota.model is "bearer", server_blind is true', async () => {
    requireApiAuth.mockResolvedValueOnce({
      client: { rail: 'anonymous' },
      apiKey: 'rfs_live_anonkey',
    });
    const { body } = await callCapabilities(makeEnv());
    expect(body.quota.model).toBe('bearer');
    expect(body.quota.remaining).toBeNull();
    expect(body.quota.server_blind).toBe(true);
    // Note must not mention "sats" — credits vocabulary only
    expect(body.quota.note).not.toMatch(/\bsats?\b/i);
  });

  test('auth failure propagates — no response body on 401', async () => {
    const authResponse = new Response(JSON.stringify({ error: 'Unauthorised.' }), { status: 401 });
    requireApiAuth.mockRejectedValueOnce(authResponse);
    const req = makeRequest('GET', '/api/v1/capabilities');
    const res = await handleApiCapabilities(req, makeEnv());
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleAdminBtcRatePost
// ─────────────────────────────────────────────────────────────────────────────
describe('handleAdminBtcRatePost', () => {
  test('rejects missing X-Admin-Key with 401', async () => {
    const req = makeRequest('POST', '/admin/btc-rate', { body: { gbp_per_btc: 60000 } });
    const res = await handleAdminBtcRatePost(req, makeEnv());
    expect(res.status).toBe(401);
  });

  test('rejects wrong X-Admin-Key with 401', async () => {
    const req = makeRequest('POST', '/admin/btc-rate', {
      headers: { 'X-Admin-Key': 'wrong' },
      body: { gbp_per_btc: 60000 },
    });
    const res = await handleAdminBtcRatePost(req, makeEnv());
    expect(res.status).toBe(401);
  });

  test('rejects missing gbp_per_btc with 400', async () => {
    const req = makeRequest('POST', '/admin/btc-rate', {
      headers: { 'X-Admin-Key': 'test-admin-key' },
      body: {},
    });
    const res = await handleAdminBtcRatePost(req, makeEnv());
    expect(res.status).toBe(400);
  });

  test('rejects non-numeric gbp_per_btc with 400', async () => {
    const req = makeRequest('POST', '/admin/btc-rate', {
      headers: { 'X-Admin-Key': 'test-admin-key' },
      body: { gbp_per_btc: 'sixty thousand' },
    });
    const res = await handleAdminBtcRatePost(req, makeEnv());
    expect(res.status).toBe(400);
  });

  test('rejects zero with 400', async () => {
    const req = makeRequest('POST', '/admin/btc-rate', {
      headers: { 'X-Admin-Key': 'test-admin-key' },
      body: { gbp_per_btc: 0 },
    });
    const res = await handleAdminBtcRatePost(req, makeEnv());
    expect(res.status).toBe(400);
  });

  test('rejects negative with 400', async () => {
    const req = makeRequest('POST', '/admin/btc-rate', {
      headers: { 'X-Admin-Key': 'test-admin-key' },
      body: { gbp_per_btc: -1000 },
    });
    const res = await handleAdminBtcRatePost(req, makeEnv());
    expect(res.status).toBe(400);
  });

  test('rejects below sanity floor (£999) with 400', async () => {
    const req = makeRequest('POST', '/admin/btc-rate', {
      headers: { 'X-Admin-Key': 'test-admin-key' },
      body: { gbp_per_btc: 999 },
    });
    const res = await handleAdminBtcRatePost(req, makeEnv());
    expect(res.status).toBe(400);
  });

  test('rejects above sanity ceiling (£10,000,001) with 400', async () => {
    const req = makeRequest('POST', '/admin/btc-rate', {
      headers: { 'X-Admin-Key': 'test-admin-key' },
      body: { gbp_per_btc: 10_000_001 },
    });
    const res = await handleAdminBtcRatePost(req, makeEnv());
    expect(res.status).toBe(400);
  });

  test('accepts valid rate and returns ok: true with rate record', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/admin/btc-rate', {
      headers: { 'X-Admin-Key': 'test-admin-key' },
      body: { gbp_per_btc: 62000 },
    });
    const res = await handleAdminBtcRatePost(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rate.gbp_per_btc).toBe(62000);
    expect(body.rate.set_by).toBe('manual');
    expect(body.rate.source).toBe('manual');
    expect(body.rate.previous).toBeNull(); // cold start — no prior
  });

  test('populates previous block when overriding an existing rate', async () => {
    const existing = {
      gbp_per_btc:  58000,
      source:       'coingecko',
      last_updated: '2026-09-10T03:00:00.000Z',
      set_by:       'coingecko_cron',
      previous:     null,
    };
    const env = makeEnv({ [BTC_RATE_KV_KEY]: JSON.stringify(existing) });
    const req = makeRequest('POST', '/admin/btc-rate', {
      headers: { 'X-Admin-Key': 'test-admin-key' },
      body: { gbp_per_btc: 65000 },
    });
    const res = await handleAdminBtcRatePost(req, env);
    const body = await res.json();
    expect(body.rate.previous.gbp_per_btc).toBe(58000);
    expect(body.rate.previous.set_by).toBe('coingecko_cron');
  });

  test('manual override bypasses ±20% guard — large jump accepted', async () => {
    const existing = {
      gbp_per_btc:  60000,
      source:       'coingecko',
      last_updated: '2026-09-10T03:00:00.000Z',
      set_by:       'coingecko_cron',
      previous:     null,
    };
    const env = makeEnv({ [BTC_RATE_KV_KEY]: JSON.stringify(existing) });
    // 100% jump — would breach guard if this were a cron write
    const req = makeRequest('POST', '/admin/btc-rate', {
      headers: { 'X-Admin-Key': 'test-admin-key' },
      body: { gbp_per_btc: 120000 },
    });
    const res = await handleAdminBtcRatePost(req, env);
    expect(res.status).toBe(200);
  });

  test('writes KV entry that can be read back', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/admin/btc-rate', {
      headers: { 'X-Admin-Key': 'test-admin-key' },
      body: { gbp_per_btc: 70000 },
    });
    await handleAdminBtcRatePost(req, env);
    const stored = await env.STATUS_KV.get(BTC_RATE_KV_KEY, { type: 'json' });
    expect(stored.gbp_per_btc).toBe(70000);
    expect(stored.set_by).toBe('manual');
  });

  test('rejects invalid JSON body with 400', async () => {
    const req = new Request('https://api.share.refueler.io/admin/btc-rate', {
      method:  'POST',
      headers: { 'X-Admin-Key': 'test-admin-key', 'Content-Type': 'application/json' },
      body:    'not-json',
    });
    const res = await handleAdminBtcRatePost(req, makeEnv());
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleAdminBtcRateGet
// ─────────────────────────────────────────────────────────────────────────────
describe('handleAdminBtcRateGet', () => {
  test('rejects missing X-Admin-Key with 401', async () => {
    const req = makeRequest('GET', '/admin/btc-rate');
    const res = await handleAdminBtcRateGet(req, makeEnv());
    expect(res.status).toBe(401);
  });

  test('returns { set: false } on cold start', async () => {
    const req = makeRequest('GET', '/admin/btc-rate', {
      headers: { 'X-Admin-Key': 'test-admin-key' },
    });
    const res = await handleAdminBtcRateGet(req, makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.set).toBe(false);
  });

  test('returns { set: true, rate, age_seconds } when entry exists', async () => {
    const rateEntry = {
      gbp_per_btc:  62000,
      source:       'coingecko',
      last_updated: new Date(Date.now() - 300_000).toISOString(), // 5 min ago
      set_by:       'coingecko_cron',
      previous:     null,
    };
    const env = makeEnv({ [BTC_RATE_KV_KEY]: JSON.stringify(rateEntry) });
    const req = makeRequest('GET', '/admin/btc-rate', {
      headers: { 'X-Admin-Key': 'test-admin-key' },
    });
    const res = await handleAdminBtcRateGet(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.set).toBe(true);
    expect(body.rate.gbp_per_btc).toBe(62000);
    // age_seconds ≈ 300 — allow ±5s for execution time
    expect(body.age_seconds).toBeGreaterThan(295);
    expect(body.age_seconds).toBeLessThan(310);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// refreshBtcRate — CoinGecko cron task
// ─────────────────────────────────────────────────────────────────────────────
describe('refreshBtcRate', () => {
  // Save and restore global fetch between tests.
  const realFetch = global.fetch;
  beforeEach(() => { global.fetch = realFetch; });

  function mockCoinGecko(gbp, status = 200) {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ bitcoin: { gbp } }),
        { status, headers: { 'Content-Type': 'application/json' } }
      )
    );
  }

  function mockCoinGeckoNetworkError() {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Network error'));
  }

  function mockCoinGeckoTimeout() {
    global.fetch = vi.fn().mockImplementation(() =>
      new Promise((_, reject) =>
        setTimeout(() => {
          const e = new Error('AbortError');
          e.name = 'AbortError';
          reject(e);
        }, 0)
      )
    );
  }

  test('cold start: writes rate unconditionally when no previous entry exists', async () => {
    mockCoinGecko(62000);
    const env = makeEnv();
    await refreshBtcRate(env);
    const stored = await env.STATUS_KV.get(BTC_RATE_KV_KEY, { type: 'json' });
    expect(stored.gbp_per_btc).toBe(62000);
    expect(stored.set_by).toBe('coingecko_cron');
    expect(stored.source).toBe('coingecko');
    expect(stored.previous).toBeNull();
  });

  test('within guard: writes when change is exactly at the 20% threshold', async () => {
    const existing = { gbp_per_btc: 50000, set_by: 'coingecko_cron', last_updated: '2026-09-10T03:00:00.000Z', source: 'coingecko', previous: null };
    const env = makeEnv({ [BTC_RATE_KV_KEY]: JSON.stringify(existing) });
    // Exactly 20% up → pctChange = 0.20, guard threshold is > 0.20, so this passes.
    mockCoinGecko(60000);
    await refreshBtcRate(env);
    const stored = await env.STATUS_KV.get(BTC_RATE_KV_KEY, { type: 'json' });
    expect(stored.gbp_per_btc).toBe(60000);
  });

  test('guard breach: does NOT write when change exceeds ±20%', async () => {
    const existing = { gbp_per_btc: 50000, set_by: 'coingecko_cron', last_updated: '2026-09-10T03:00:00.000Z', source: 'coingecko', previous: null };
    const env = makeEnv({ [BTC_RATE_KV_KEY]: JSON.stringify(existing) });
    // 25% up — guard breach
    mockCoinGecko(62500);
    await refreshBtcRate(env);
    const stored = await env.STATUS_KV.get(BTC_RATE_KV_KEY, { type: 'json' });
    // Original value must remain
    expect(stored.gbp_per_btc).toBe(50000);
  });

  test('guard breach: logs an AE event', async () => {
    const existing = { gbp_per_btc: 50000, set_by: 'coingecko_cron', last_updated: '2026-09-10T03:00:00.000Z', source: 'coingecko', previous: null };
    const env = makeEnv({ [BTC_RATE_KV_KEY]: JSON.stringify(existing) });
    mockCoinGecko(62500); // 25% breach
    await refreshBtcRate(env);
    expect(env.AE.writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        blobs: expect.arrayContaining(['btc_rate_guard', 'guard_breach']),
      })
    );
  });

  test('guard breach: downward spike also suppressed (−25%)', async () => {
    const existing = { gbp_per_btc: 60000, set_by: 'coingecko_cron', last_updated: '2026-09-10T03:00:00.000Z', source: 'coingecko', previous: null };
    const env = makeEnv({ [BTC_RATE_KV_KEY]: JSON.stringify(existing) });
    // 25% down — guard breach
    mockCoinGecko(45000);
    await refreshBtcRate(env);
    const stored = await env.STATUS_KV.get(BTC_RATE_KV_KEY, { type: 'json' });
    expect(stored.gbp_per_btc).toBe(60000);
  });

  test('previous block is set correctly after a successful write', async () => {
    const existing = { gbp_per_btc: 60000, set_by: 'coingecko_cron', last_updated: '2026-09-11T03:00:00.000Z', source: 'coingecko', previous: null };
    const env = makeEnv({ [BTC_RATE_KV_KEY]: JSON.stringify(existing) });
    // 5% up — within guard
    mockCoinGecko(63000);
    await refreshBtcRate(env);
    const stored = await env.STATUS_KV.get(BTC_RATE_KV_KEY, { type: 'json' });
    expect(stored.gbp_per_btc).toBe(63000);
    expect(stored.previous.gbp_per_btc).toBe(60000);
    expect(stored.previous.set_by).toBe('coingecko_cron');
  });

  test('CoinGecko HTTP error: does not write, logs AE event', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    const env = makeEnv();
    await refreshBtcRate(env);
    const stored = await env.STATUS_KV.get(BTC_RATE_KV_KEY, { type: 'json' });
    expect(stored).toBeNull();
    expect(env.AE.writeDataPoint).toHaveBeenCalled();
  });

  test('CoinGecko network error: does not throw, does not write', async () => {
    mockCoinGeckoNetworkError();
    const env = makeEnv();
    await expect(refreshBtcRate(env)).resolves.not.toThrow();
    const stored = await env.STATUS_KV.get(BTC_RATE_KV_KEY, { type: 'json' });
    expect(stored).toBeNull();
  });

  test('CoinGecko returns bad JSON structure: does not write', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ not_bitcoin: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const env = makeEnv();
    await refreshBtcRate(env);
    const stored = await env.STATUS_KV.get(BTC_RATE_KV_KEY, { type: 'json' });
    expect(stored).toBeNull();
    expect(env.AE.writeDataPoint).toHaveBeenCalled();
  });

  test('sanity bounds: rate below £1,000 not written', async () => {
    mockCoinGecko(500); // implausibly low
    const env = makeEnv();
    await refreshBtcRate(env);
    const stored = await env.STATUS_KV.get(BTC_RATE_KV_KEY, { type: 'json' });
    expect(stored).toBeNull();
  });

  test('sanity bounds: rate above £10,000,000 not written', async () => {
    mockCoinGecko(10_000_001);
    const env = makeEnv();
    await refreshBtcRate(env);
    const stored = await env.STATUS_KV.get(BTC_RATE_KV_KEY, { type: 'json' });
    expect(stored).toBeNull();
  });

  test('refreshBtcRate resolves without throwing even on KV failure', async () => {
    mockCoinGecko(62000);
    const env = makeEnv();
    env.STATUS_KV.put = vi.fn().mockRejectedValue(new Error('KV write failed'));
    await expect(refreshBtcRate(env)).resolves.not.toThrow();
  });
});
