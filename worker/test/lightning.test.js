/**
 * lightning.test.js — unit tests for worker/src/lightning.js
 *
 * Updated SW9: Blink discontinued Aug 2026. All Blink tests replaced with
 * LNbits equivalents. Backend default is now 'lnbits'.
 *
 * Mocks: fetch (vi.stubGlobal), STATUS_KV (plain object stub)
 * No live network calls. No live LNbits instance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInvoice, getInvoiceStatus } from '../src/lightning.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const MOCK_BOLT11 =
  'lnbc1000n1pjktest0pp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdqqcqpjsp5yz';
const MOCK_PAYMENT_HASH = 'aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344';

/** Minimal env for LNbits backend */
function makeEnv(overrides = {}) {
  const kvStore = new Map();
  return {
    LIGHTNING_BACKEND: 'lnbits',
    LNBITS_URL:        'https://lnbits.example.com',
    LNBITS_API_KEY:    'test-lnbits-api-key',
    STATUS_KV: {
      get: vi.fn(async (key, type) => {
        const val = kvStore.get(key);
        if (val === undefined) return null;
        return type === 'json' ? JSON.parse(val) : val;
      }),
      put: vi.fn(async (key, value) => {
        kvStore.set(key, value);
      }),
      _store: kvStore, // exposed for assertions
    },
    ...overrides,
  };
}

/** Build a successful LNbits POST /api/v1/payments response */
function lnbitsCreateSuccess() {
  return {
    payment_hash:    MOCK_PAYMENT_HASH,
    payment_request: MOCK_BOLT11,
    checking_id:     MOCK_PAYMENT_HASH,
    lnurl_response:  null,
  };
}

/** Build a successful LNbits GET /api/v1/payments/{hash} response — paid */
function lnbitsInvoicePaid() {
  return {
    paid:         true,
    payment_hash: MOCK_PAYMENT_HASH,
    amount:       5000,
    memo:         'Refueler Share — max monthly',
  };
}

/** Build a successful LNbits GET /api/v1/payments/{hash} response — pending */
function lnbitsInvoicePending() {
  return {
    paid:         false,
    payment_hash: MOCK_PAYMENT_HASH,
    amount:       5000,
    memo:         'Refueler Share — max monthly',
  };
}

/** Helper: mock fetch to return a JSON body */
function mockFetch(body, { ok = true, status = 200 } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      statusText: ok ? 'OK' : 'Bad Request',
      text: async () => JSON.stringify(body),
      json: async () => body,
    })),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// createInvoice — LNbits backend
// ---------------------------------------------------------------------------

describe('createInvoice (lnbits)', () => {
  it('returns { bolt11, paymentHash, expiresAt } on success', async () => {
    mockFetch(lnbitsCreateSuccess());
    const env = makeEnv();

    const result = await createInvoice(
      { tier: 'max', period: 'monthly', amountSats: 5000, expirySeconds: 3600 },
      env,
    );

    expect(result).toMatchObject({
      bolt11:      MOCK_BOLT11,
      paymentHash: MOCK_PAYMENT_HASH,
    });
    expect(typeof result.expiresAt).toBe('string');
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('writes KV record keyed by paymentHash', async () => {
    mockFetch(lnbitsCreateSuccess());
    const env = makeEnv();

    await createInvoice(
      { tier: 'max', period: '3month', amountSats: 2000, expirySeconds: 1800 },
      env,
    );

    expect(env.STATUS_KV.put).toHaveBeenCalledOnce();
    const [key, value] = env.STATUS_KV.put.mock.calls[0];
    expect(key).toBe(`lightning:invoice:${MOCK_PAYMENT_HASH}`);
    const parsed = JSON.parse(value);
    expect(parsed).toMatchObject({ tier: 'max', period: '3month', settled: false });
    expect(typeof parsed.created_at).toBe('string');
  });

  it('throws on non-200 HTTP response from LNbits', async () => {
    mockFetch({ detail: 'Bad auth' }, { ok: false, status: 401 });
    const env = makeEnv();

    await expect(
      createInvoice({ tier: 'max', period: 'monthly', amountSats: 5000, expirySeconds: 3600 }, env),
    ).rejects.toThrow('401');
  });

  it('throws on 503 from LNbits', async () => {
    mockFetch({}, { ok: false, status: 503 });
    const env = makeEnv();

    await expect(
      createInvoice({ tier: 'max', period: 'monthly', amountSats: 5000, expirySeconds: 3600 }, env),
    ).rejects.toThrow('503');
  });

  it('sends correct POST to LNbits API with X-API-KEY header', async () => {
    mockFetch(lnbitsCreateSuccess());
    const env = makeEnv();

    await createInvoice(
      { tier: 'max', period: 'yearly', amountSats: 10000, expirySeconds: 7200 },
      env,
    );

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://lnbits.example.com/api/v1/payments');
    expect(options.method).toBe('POST');
    expect(options.headers['X-API-KEY']).toBe('test-lnbits-api-key');
    expect(options.headers['Content-Type']).toBe('application/json');

    const sentBody = JSON.parse(options.body);
    expect(sentBody.out).toBe(false);
    expect(sentBody.amount).toBe(10000);
    expect(sentBody.expiry).toBe(7200);
    expect(sentBody.memo).toContain('max');
    expect(sentBody.memo).toContain('yearly');
  });

  it('throws when LNBITS_URL is missing', async () => {
    const env = makeEnv({ LNBITS_URL: undefined });

    await expect(
      createInvoice({ tier: 'max', period: 'monthly', amountSats: 5000, expirySeconds: 3600 }, env),
    ).rejects.toThrow('LNBITS_URL and LNBITS_API_KEY must be set');
  });

  it('throws when LNBITS_API_KEY is missing', async () => {
    const env = makeEnv({ LNBITS_API_KEY: undefined });

    await expect(
      createInvoice({ tier: 'max', period: 'monthly', amountSats: 5000, expirySeconds: 3600 }, env),
    ).rejects.toThrow('LNBITS_URL and LNBITS_API_KEY must be set');
  });
});

// ---------------------------------------------------------------------------
// getInvoiceStatus — LNbits backend
// ---------------------------------------------------------------------------

describe('getInvoiceStatus (lnbits)', () => {
  it('returns { settled: true, tier, period } when LNbits reports paid', async () => {
    const env = makeEnv();
    await env.STATUS_KV.put(
      `lightning:invoice:${MOCK_PAYMENT_HASH}`,
      JSON.stringify({ tier: 'max', period: 'monthly', settled: false, created_at: new Date().toISOString() }),
    );

    mockFetch(lnbitsInvoicePaid());

    const result = await getInvoiceStatus({ paymentHash: MOCK_PAYMENT_HASH }, env);

    expect(result).toEqual({ settled: true, tier: 'max', period: 'monthly' });
  });

  it('returns { settled: false, tier, period } when LNbits reports pending', async () => {
    const env = makeEnv();
    await env.STATUS_KV.put(
      `lightning:invoice:${MOCK_PAYMENT_HASH}`,
      JSON.stringify({ tier: 'max', period: '3month', settled: false, created_at: new Date().toISOString() }),
    );

    mockFetch(lnbitsInvoicePending());

    const result = await getInvoiceStatus({ paymentHash: MOCK_PAYMENT_HASH }, env);

    expect(result).toEqual({ settled: false, tier: 'max', period: '3month' });
  });

  it('returns null when paymentHash is not in KV', async () => {
    const env = makeEnv();
    // KV empty — fetch should never be called
    mockFetch(lnbitsInvoicePaid());

    const result = await getInvoiceStatus({ paymentHash: 'unknown-hash-000' }, env);

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns null when LNbits returns 404 for this hash', async () => {
    const env = makeEnv();
    await env.STATUS_KV.put(
      `lightning:invoice:${MOCK_PAYMENT_HASH}`,
      JSON.stringify({ tier: 'max', period: 'monthly', settled: false, created_at: new Date().toISOString() }),
    );

    mockFetch({ detail: 'Payment not found' }, { ok: false, status: 404 });

    const result = await getInvoiceStatus({ paymentHash: MOCK_PAYMENT_HASH }, env);

    expect(result).toBeNull();
  });

  it('throws on non-200 non-404 HTTP response from LNbits', async () => {
    const env = makeEnv();
    await env.STATUS_KV.put(
      `lightning:invoice:${MOCK_PAYMENT_HASH}`,
      JSON.stringify({ tier: 'max', period: 'monthly', settled: false, created_at: new Date().toISOString() }),
    );

    mockFetch({}, { ok: false, status: 429 });

    await expect(
      getInvoiceStatus({ paymentHash: MOCK_PAYMENT_HASH }, env),
    ).rejects.toThrow('429');
  });

  it('sends GET to correct LNbits endpoint with X-API-KEY', async () => {
    const env = makeEnv();
    await env.STATUS_KV.put(
      `lightning:invoice:${MOCK_PAYMENT_HASH}`,
      JSON.stringify({ tier: 'max', period: 'monthly', settled: false, created_at: new Date().toISOString() }),
    );

    mockFetch(lnbitsInvoicePaid());

    await getInvoiceStatus({ paymentHash: MOCK_PAYMENT_HASH }, env);

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(`https://lnbits.example.com/api/v1/payments/${MOCK_PAYMENT_HASH}`);
    expect(options.method).toBe('GET');
    expect(options.headers['X-API-KEY']).toBe('test-lnbits-api-key');
  });
});

// ---------------------------------------------------------------------------
// Unknown LIGHTNING_BACKEND
// ---------------------------------------------------------------------------

describe('unknown LIGHTNING_BACKEND', () => {
  it('createInvoice throws with useful message', async () => {
    const env = makeEnv({ LIGHTNING_BACKEND: 'lnbits_future' });

    await expect(
      createInvoice({ tier: 'max', period: 'monthly', amountSats: 5000, expirySeconds: 3600 }, env),
    ).rejects.toThrow('Unknown LIGHTNING_BACKEND: "lnbits_future"');
  });

  it('getInvoiceStatus throws with useful message', async () => {
    const env = makeEnv({ LIGHTNING_BACKEND: 'lnbits_future' });

    await expect(
      getInvoiceStatus({ paymentHash: MOCK_PAYMENT_HASH }, env),
    ).rejects.toThrow('Unknown LIGHTNING_BACKEND: "lnbits_future"');
  });
});

// ---------------------------------------------------------------------------
// Missing secrets — both functions guard before any network call
// ---------------------------------------------------------------------------

describe('missing secrets guard', () => {
  it('createInvoice throws before fetch when LNBITS_URL missing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const env = makeEnv({ LNBITS_URL: undefined });

    await expect(
      createInvoice({ tier: 'max', period: 'monthly', amountSats: 5000, expirySeconds: 3600 }, env),
    ).rejects.toThrow('LNBITS_URL and LNBITS_API_KEY must be set');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('getInvoiceStatus throws before fetch when LNBITS_API_KEY missing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const env = makeEnv({ LNBITS_API_KEY: undefined });
    // Put a KV record so we'd get past the null-check if secrets weren't guarded
    await env.STATUS_KV.put(
      `lightning:invoice:${MOCK_PAYMENT_HASH}`,
      JSON.stringify({ tier: 'max', period: 'monthly', settled: false, created_at: new Date().toISOString() }),
    );

    await expect(
      getInvoiceStatus({ paymentHash: MOCK_PAYMENT_HASH }, env),
    ).rejects.toThrow('LNBITS_URL and LNBITS_API_KEY must be set');

    expect(fetch).not.toHaveBeenCalled();
  });
});
