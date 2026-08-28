/**
 * lightning-endpoint.test.js  (S75)
 *
 * Imports directly from lightning-routes.js — no index.js, no WASM chain.
 * Deps injected as plain objects, matching the pattern used in stripe.test.js.
 *
 * Run: npx vitest run test/lightning-endpoint.test.js
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  handleLightningCreate,
  handleLightningStatus,
  handleLightningWebhook,
  fetchBtcGbpRate,
} from '../src/lightning-routes.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const MOCK_BTC_GBP = 52000;
const TEST_HASH    = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const BASE_URL     = 'https://refueler-share.rt-fc4.workers.dev';

function makeMockKv() {
  const store = new Map();
  return {
    async get(key, type) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    async delete(key) { store.delete(key); },
    _store: store,
  };
}

function makeEnv(overrides = {}) {
  return {
    STATUS_KV: makeMockKv(),
    TURNSTILE_SECRET_KEY: 'test-ts-secret',
    MINT_PRIVATE_KEY: 'a'.repeat(64),
    LIGHTNING_BACKEND: 'blink',
    BLINK_API_KEY: 'test-key',
    BLINK_WALLET_ID: 'test-wallet',
    PRICE_CREATIVE_MONTHLY_GBP: '12',
    PRICE_CREATIVE_YEARLY_GBP:  '144',
    PRICE_MAX_MONTHLY_GBP:      '24',
    PRICE_MAX_YEARLY_GBP:       '288',
    ...overrides,
  };
}

function makeReq(method, url, body, extraHeaders = {}) {
  const init = {
    method,
    headers: { 'CF-Connecting-IP': '1.2.3.4', 'Content-Type': 'application/json', ...extraHeaders },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

// Shared mock deps — overridden per test in beforeEach
let mockDeps;

function makeDeps(overrides = {}) {
  return {
    verifyTurnstileToken:  vi.fn().mockResolvedValue(true),
    issueBlindSignature:   vi.fn().mockResolvedValue({ signedPoint: 'sp', mintPubkey: 'pk' }),
    createInvoice:         vi.fn().mockResolvedValue({ bolt11: 'lnbc21n1ptest', paymentHash: TEST_HASH, expiresAt: '2026-08-29T18:00:00.000Z' }),
    getInvoiceStatus:      vi.fn().mockResolvedValue({ settled: false, tier: 'creative', period: 'monthly' }),
    checkRateLimit:        vi.fn().mockResolvedValue({ limited: false, resetAt: 0 }),
    getClientIp:           vi.fn().mockReturnValue('1.2.3.4'),
    rateLimitResponse:     vi.fn().mockReturnValue(new Response('Too Many Requests', { status: 429 })),
    logEvent:              vi.fn(),
    corsHeaders:           vi.fn().mockReturnValue({}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// POST /subscription/lightning
// ---------------------------------------------------------------------------

describe('handleLightningCreate', () => {
  beforeEach(() => {
    mockDeps = makeDeps();
    // Stub globalThis.fetch for CoinGecko
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ bitcoin: { gbp: MOCK_BTC_GBP } }), { status: 200 })
    ));
  });

  it('returns 200 with bolt11, paymentHash, expiresAt, amountSats, btcPerGbp', async () => {
    const resp = await handleLightningCreate(
      makeReq('POST', `${BASE_URL}/subscription/lightning`, { tier: 'creative', period: 'monthly', turnstileToken: 'tok' }),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.bolt11).toMatch(/^lnbc/);
    expect(body.paymentHash).toBe(TEST_HASH);
    expect(body.amountSats).toBe(Math.ceil((12 / MOCK_BTC_GBP) * 1e8));
    expect(body.btcPerGbp).toBe(MOCK_BTC_GBP);
  });

  it('amountSats correct for max yearly £288', async () => {
    const resp = await handleLightningCreate(
      makeReq('POST', `${BASE_URL}/subscription/lightning`, { tier: 'max', period: 'yearly', turnstileToken: 'tok' }),
      makeEnv(), mockDeps
    );
    const body = await resp.json();
    expect(body.amountSats).toBe(Math.ceil((288 / MOCK_BTC_GBP) * 1e8));
  });

  it('returns 400 for invalid tier', async () => {
    const resp = await handleLightningCreate(
      makeReq('POST', `${BASE_URL}/subscription/lightning`, { tier: 'enterprise', period: 'monthly', turnstileToken: 'tok' }),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(400);
    expect((await resp.json()).error).toMatch(/Invalid tier/);
  });

  it('returns 400 for invalid period', async () => {
    const resp = await handleLightningCreate(
      makeReq('POST', `${BASE_URL}/subscription/lightning`, { tier: 'creative', period: 'quarterly', turnstileToken: 'tok' }),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(400);
    expect((await resp.json()).error).toMatch(/Invalid period/);
  });

  it('returns 400 when turnstileToken missing', async () => {
    const resp = await handleLightningCreate(
      makeReq('POST', `${BASE_URL}/subscription/lightning`, { tier: 'creative', period: 'monthly' }),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(400);
    expect((await resp.json()).error).toMatch(/Turnstile/);
  });

  it('returns 403 when Turnstile fails — createInvoice never called', async () => {
    mockDeps.verifyTurnstileToken.mockResolvedValue(false);
    const resp = await handleLightningCreate(
      makeReq('POST', `${BASE_URL}/subscription/lightning`, { tier: 'creative', period: 'monthly', turnstileToken: 'bad' }),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(403);
    expect(mockDeps.createInvoice).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limited — Turnstile never called', async () => {
    mockDeps.checkRateLimit.mockResolvedValue({ limited: true, resetAt: 0 });
    const resp = await handleLightningCreate(
      makeReq('POST', `${BASE_URL}/subscription/lightning`, { tier: 'creative', period: 'monthly', turnstileToken: 'tok' }),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(429);
    expect(mockDeps.verifyTurnstileToken).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON', async () => {
    const req = new Request(`${BASE_URL}/subscription/lightning`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '1.2.3.4', 'Content-Type': 'application/json' },
      body: 'not json {{{',
    });
    const resp = await handleLightningCreate(req, makeEnv(), mockDeps);
    expect(resp.status).toBe(400);
  });

  it('returns 502 if CoinGecko fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const resp = await handleLightningCreate(
      makeReq('POST', `${BASE_URL}/subscription/lightning`, { tier: 'creative', period: 'monthly', turnstileToken: 'tok' }),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(502);
  });

  it('returns 502 if createInvoice throws', async () => {
    mockDeps.createInvoice.mockRejectedValue(new Error('Blink down'));
    const resp = await handleLightningCreate(
      makeReq('POST', `${BASE_URL}/subscription/lightning`, { tier: 'creative', period: 'monthly', turnstileToken: 'tok' }),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(502);
  });

  it('passes correct params to createInvoice', async () => {
    const env = makeEnv();
    await handleLightningCreate(
      makeReq('POST', `${BASE_URL}/subscription/lightning`, { tier: 'creative', period: 'monthly', turnstileToken: 'tok' }),
      env, mockDeps
    );
    expect(mockDeps.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'creative', period: 'monthly', amountSats: Math.ceil((12 / MOCK_BTC_GBP) * 1e8), expirySeconds: 86400 }),
      env
    );
  });
});

// ---------------------------------------------------------------------------
// GET /subscription/lightning/status
// ---------------------------------------------------------------------------

describe('handleLightningStatus', () => {
  beforeEach(() => { mockDeps = makeDeps(); });

  it('returns 200 with { settled: false, tier, period } for pending invoice', async () => {
    const resp = await handleLightningStatus(
      makeReq('GET', `${BASE_URL}/subscription/lightning/status?hash=${TEST_HASH}`),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ settled: false, tier: 'creative', period: 'monthly' });
  });

  it('returns 200 with settled: true for paid invoice', async () => {
    mockDeps.getInvoiceStatus.mockResolvedValue({ settled: true, tier: 'max', period: 'yearly' });
    const resp = await handleLightningStatus(
      makeReq('GET', `${BASE_URL}/subscription/lightning/status?hash=${TEST_HASH}`),
      makeEnv(), mockDeps
    );
    expect((await resp.json()).settled).toBe(true);
  });

  it('returns 404 when getInvoiceStatus returns null', async () => {
    mockDeps.getInvoiceStatus.mockResolvedValue(null);
    const resp = await handleLightningStatus(
      makeReq('GET', `${BASE_URL}/subscription/lightning/status?hash=${TEST_HASH}`),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(404);
  });

  it('returns 400 for missing hash', async () => {
    const resp = await handleLightningStatus(
      makeReq('GET', `${BASE_URL}/subscription/lightning/status`),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(400);
  });

  it('returns 400 for hash that is too short', async () => {
    const resp = await handleLightningStatus(
      makeReq('GET', `${BASE_URL}/subscription/lightning/status?hash=short`),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(400);
  });

  it('returns 429 when rate limited', async () => {
    mockDeps.checkRateLimit.mockResolvedValue({ limited: true, resetAt: 0 });
    const resp = await handleLightningStatus(
      makeReq('GET', `${BASE_URL}/subscription/lightning/status?hash=${TEST_HASH}`),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(429);
  });

  it('returns 502 if getInvoiceStatus throws', async () => {
    mockDeps.getInvoiceStatus.mockRejectedValue(new Error('KV timeout'));
    const resp = await handleLightningStatus(
      makeReq('GET', `${BASE_URL}/subscription/lightning/status?hash=${TEST_HASH}`),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(502);
  });

  it('passes paymentHash to getInvoiceStatus', async () => {
    const env = makeEnv();
    await handleLightningStatus(
      makeReq('GET', `${BASE_URL}/subscription/lightning/status?hash=${TEST_HASH}`),
      env, mockDeps
    );
    expect(mockDeps.getInvoiceStatus).toHaveBeenCalledWith({ paymentHash: TEST_HASH }, env);
  });
});

// ---------------------------------------------------------------------------
// POST /webhook/lightning
// ---------------------------------------------------------------------------

describe('handleLightningWebhook', () => {
  const pendingRecord = JSON.stringify({
    tier: 'creative', period: 'monthly', settled: false,
    created_at: new Date(Date.now() - 5000).toISOString(),
  });

  function makeEnvWithPending() {
    const env = makeEnv();
    env.STATUS_KV._store.set(`lightning:invoice:${TEST_HASH}`, pendingRecord);
    return env;
  }

  beforeEach(() => { mockDeps = makeDeps(); });

  it('returns 200 on valid first settlement', async () => {
    const resp = await handleLightningWebhook(
      makeReq('POST', `${BASE_URL}/webhook/lightning`, { paymentHash: TEST_HASH }),
      makeEnvWithPending(), mockDeps
    );
    expect(resp.status).toBe(200);
  });

  it('writes credential to KV at lightning:credential:{hash}', async () => {
    const env = makeEnvWithPending();
    await handleLightningWebhook(
      makeReq('POST', `${BASE_URL}/webhook/lightning`, { paymentHash: TEST_HASH }),
      env, mockDeps
    );
    const raw = env.STATUS_KV._store.get(`lightning:credential:${TEST_HASH}`);
    expect(raw).toBeTruthy();
    const cred = JSON.parse(raw);
    expect(cred.signed_point).toBe('sp');
    expect(cred.tier).toBe('creative');
  });

  it('marks invoice settled: true in KV', async () => {
    const env = makeEnvWithPending();
    await handleLightningWebhook(
      makeReq('POST', `${BASE_URL}/webhook/lightning`, { paymentHash: TEST_HASH }),
      env, mockDeps
    );
    const updated = JSON.parse(env.STATUS_KV._store.get(`lightning:invoice:${TEST_HASH}`));
    expect(updated.settled).toBe(true);
  });

  it('deduplicates — second callback does not call issueBlindSignature', async () => {
    const env = makeEnv();
    env.STATUS_KV._store.set(`lightning:invoice:${TEST_HASH}`, JSON.stringify({ tier: 'creative', period: 'monthly', settled: true }));
    await handleLightningWebhook(
      makeReq('POST', `${BASE_URL}/webhook/lightning`, { paymentHash: TEST_HASH }),
      env, mockDeps
    );
    expect(mockDeps.issueBlindSignature).not.toHaveBeenCalled();
  });

  it('returns 200 for unknown paymentHash — no credential issued', async () => {
    const resp = await handleLightningWebhook(
      makeReq('POST', `${BASE_URL}/webhook/lightning`, { paymentHash: TEST_HASH }),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(200);
    expect(mockDeps.issueBlindSignature).not.toHaveBeenCalled();
  });

  it('returns 200 for malformed JSON body', async () => {
    const req = new Request(`${BASE_URL}/webhook/lightning`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '1.2.3.4', 'Content-Type': 'application/json' },
      body: 'not json {{{{',
    });
    const resp = await handleLightningWebhook(req, makeEnv(), mockDeps);
    expect(resp.status).toBe(200);
    expect(mockDeps.issueBlindSignature).not.toHaveBeenCalled();
  });

  it('returns 200 even if issueBlindSignature throws — invoice still marked settled', async () => {
    mockDeps.issueBlindSignature.mockRejectedValue(new Error('mint error'));
    const env = makeEnvWithPending();
    const resp = await handleLightningWebhook(
      makeReq('POST', `${BASE_URL}/webhook/lightning`, { paymentHash: TEST_HASH }),
      env, mockDeps
    );
    expect(resp.status).toBe(200);
    const updated = JSON.parse(env.STATUS_KV._store.get(`lightning:invoice:${TEST_HASH}`));
    expect(updated.settled).toBe(true);
  });

  it('accepts payment_hash snake_case field', async () => {
    const env = makeEnvWithPending();
    await handleLightningWebhook(
      makeReq('POST', `${BASE_URL}/webhook/lightning`, { payment_hash: TEST_HASH }),
      env, mockDeps
    );
    expect(mockDeps.issueBlindSignature).toHaveBeenCalled();
  });

  it('returns 200 for body with no hash field', async () => {
    const resp = await handleLightningWebhook(
      makeReq('POST', `${BASE_URL}/webhook/lightning`, { irrelevant: 'field' }),
      makeEnv(), mockDeps
    );
    expect(resp.status).toBe(200);
    expect(mockDeps.issueBlindSignature).not.toHaveBeenCalled();
  });

  it('passes tier from KV record to issueBlindSignature', async () => {
    const env = makeEnv();
    env.STATUS_KV._store.set(`lightning:invoice:${TEST_HASH}`, JSON.stringify({
      tier: 'max', period: 'yearly', settled: false, created_at: new Date().toISOString(),
    }));
    await handleLightningWebhook(
      makeReq('POST', `${BASE_URL}/webhook/lightning`, { paymentHash: TEST_HASH }),
      env, mockDeps
    );
    // issueBlindSignature called with paymentHash slice and MINT_PRIVATE_KEY
    expect(mockDeps.issueBlindSignature).toHaveBeenCalledWith(
      TEST_HASH.slice(0, 64),
      env.MINT_PRIVATE_KEY
    );
  });
});
