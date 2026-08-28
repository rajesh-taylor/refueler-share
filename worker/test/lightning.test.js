/**
 * lightning.test.js — unit tests for worker/src/lightning.js
 *
 * Mocks: fetch (vi.stubGlobal), STATUS_KV (plain object stub)
 * No live network calls. No live Blink API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInvoice, getInvoiceStatus } from '../src/lightning.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const MOCK_BOLT11 =
  'lnbc1000n1pjktest0pp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdqqcqpjsp5yz';
const MOCK_PAYMENT_HASH = 'aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344';

/** Minimal env for Blink backend */
function makeEnv(overrides = {}) {
  const kvStore = new Map();
  return {
    LIGHTNING_BACKEND: 'blink',
    BLINK_WALLET_ID: 'test-wallet-id',
    BLINK_API_KEY: 'test-api-key',
    STATUS_KV: {
      get: vi.fn(async (key, type) => {
        const val = kvStore.get(key);
        if (val === undefined) return null;
        return type === 'json' ? JSON.parse(val) : val;
      }),
      put: vi.fn(async (key, value) => {
        kvStore.set(key, value);
      }),
      _store: kvStore, // expose for assertions
    },
    ...overrides,
  };
}

/** Build a Blink lnInvoiceCreate success response */
function blinkCreateSuccess() {
  return {
    data: {
      lnInvoiceCreate: {
        invoice: {
          paymentRequest: MOCK_BOLT11,
          paymentHash: MOCK_PAYMENT_HASH,
        },
        errors: [],
      },
    },
  };
}

/** Build a Blink lnInvoiceCreate error response */
function blinkCreateError(message = 'Insufficient balance') {
  return {
    data: {
      lnInvoiceCreate: {
        invoice: null,
        errors: [{ message }],
      },
    },
  };
}

/** Build a Blink lnInvoice query response */
function blinkInvoiceQuery(paymentStatus = 'PAID') {
  return {
    data: {
      lnInvoice: {
        paymentHash: MOCK_PAYMENT_HASH,
        paymentStatus,
      },
    },
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
// createInvoice — Blink backend
// ---------------------------------------------------------------------------

describe('createInvoice (blink)', () => {
  it('returns { bolt11, paymentHash, expiresAt } on success', async () => {
    mockFetch(blinkCreateSuccess());
    const env = makeEnv();

    const result = await createInvoice(
      { tier: 'max', period: 'monthly', amountSats: 5000, expirySeconds: 3600 },
      env,
    );

    expect(result).toMatchObject({
      bolt11: MOCK_BOLT11,
      paymentHash: MOCK_PAYMENT_HASH,
    });
    expect(typeof result.expiresAt).toBe('string');
    // expiresAt should be a valid ISO-8601 date in the future
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('writes KV record keyed by paymentHash', async () => {
    mockFetch(blinkCreateSuccess());
    const env = makeEnv();

    await createInvoice(
      { tier: 'creative', period: '3month', amountSats: 2000, expirySeconds: 1800 },
      env,
    );

    expect(env.STATUS_KV.put).toHaveBeenCalledOnce();
    const [key, value] = env.STATUS_KV.put.mock.calls[0];
    expect(key).toBe(`lightning:invoice:${MOCK_PAYMENT_HASH}`);
    const parsed = JSON.parse(value);
    expect(parsed).toMatchObject({ tier: 'creative', period: '3month', settled: false });
  });

  it('throws when Blink returns errors array', async () => {
    mockFetch(blinkCreateError('Wallet not found'));
    const env = makeEnv();

    await expect(
      createInvoice({ tier: 'max', period: 'monthly', amountSats: 5000, expirySeconds: 3600 }, env),
    ).rejects.toThrow('Wallet not found');
  });

  it('throws on non-200 HTTP response from Blink', async () => {
    mockFetch({}, { ok: false, status: 503 });
    const env = makeEnv();

    await expect(
      createInvoice({ tier: 'max', period: 'monthly', amountSats: 5000, expirySeconds: 3600 }, env),
    ).rejects.toThrow('503');
  });

  it('sends correct GraphQL mutation to Blink API URL', async () => {
    mockFetch(blinkCreateSuccess());
    const env = makeEnv();

    await createInvoice(
      { tier: 'max', period: 'yearly', amountSats: 10000, expirySeconds: 7200 },
      env,
    );

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://api.blink.sv/graphql');
    expect(options.method).toBe('POST');
    expect(options.headers['X-API-KEY']).toBe('test-api-key');

    const sentBody = JSON.parse(options.body);
    expect(sentBody.variables.input.walletId).toBe('test-wallet-id');
    expect(sentBody.variables.input.amount).toBe(10000);
    expect(sentBody.variables.input.expiresIn).toBe(7200);
  });
});

// ---------------------------------------------------------------------------
// getInvoiceStatus — Blink backend
// ---------------------------------------------------------------------------

describe('getInvoiceStatus (blink)', () => {
  it('returns { settled: true, tier, period } when Blink reports PAID', async () => {
    // Pre-populate KV as createInvoice would have done
    const env = makeEnv();
    await env.STATUS_KV.put(
      `lightning:invoice:${MOCK_PAYMENT_HASH}`,
      JSON.stringify({ tier: 'max', period: 'monthly', settled: false, created_at: new Date().toISOString() }),
    );

    mockFetch(blinkInvoiceQuery('PAID'));

    const result = await getInvoiceStatus({ paymentHash: MOCK_PAYMENT_HASH }, env);

    expect(result).toEqual({ settled: true, tier: 'max', period: 'monthly' });
  });

  it('returns { settled: false, tier, period } when Blink reports PENDING', async () => {
    const env = makeEnv();
    await env.STATUS_KV.put(
      `lightning:invoice:${MOCK_PAYMENT_HASH}`,
      JSON.stringify({ tier: 'creative', period: '3month', settled: false, created_at: new Date().toISOString() }),
    );

    mockFetch(blinkInvoiceQuery('PENDING'));

    const result = await getInvoiceStatus({ paymentHash: MOCK_PAYMENT_HASH }, env);

    expect(result).toEqual({ settled: false, tier: 'creative', period: '3month' });
  });

  it('returns null when paymentHash is not in KV', async () => {
    const env = makeEnv();
    // KV empty — no fetch should happen
    mockFetch(blinkInvoiceQuery('PAID'));

    const result = await getInvoiceStatus({ paymentHash: 'unknown-hash-000' }, env);

    expect(result).toBeNull();
    // fetch should not have been called — we short-circuit on missing KV record
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns null when Blink returns no lnInvoice for this hash', async () => {
    const env = makeEnv();
    await env.STATUS_KV.put(
      `lightning:invoice:${MOCK_PAYMENT_HASH}`,
      JSON.stringify({ tier: 'max', period: 'monthly', settled: false, created_at: new Date().toISOString() }),
    );

    mockFetch({ data: { lnInvoice: null } });

    const result = await getInvoiceStatus({ paymentHash: MOCK_PAYMENT_HASH }, env);

    expect(result).toBeNull();
  });

  it('throws on non-200 HTTP response from Blink', async () => {
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
// LNbits stubs — confirm they throw, not silently fail
// ---------------------------------------------------------------------------

describe('lnbits stubs', () => {
  it('createInvoice throws "not yet implemented"', async () => {
    const env = makeEnv({ LIGHTNING_BACKEND: 'lnbits' });

    await expect(
      createInvoice({ tier: 'max', period: 'monthly', amountSats: 5000, expirySeconds: 3600 }, env),
    ).rejects.toThrow('LNbits backend not yet implemented');
  });

  it('getInvoiceStatus throws "not yet implemented"', async () => {
    const env = makeEnv({ LIGHTNING_BACKEND: 'lnbits' });

    await expect(
      getInvoiceStatus({ paymentHash: MOCK_PAYMENT_HASH }, env),
    ).rejects.toThrow('LNbits backend not yet implemented');
  });
});
