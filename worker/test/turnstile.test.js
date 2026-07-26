/**
 * turnstile.test.js — S62
 *
 * Covers verifyTurnstileToken (exported as verifyTurnstile alias too).
 * All HTTP mocked via vi.stubGlobal('fetch', ...) — no real Cloudflare calls.
 *
 * Test groups:
 *   A. Input guard (missing / empty / non-string token)
 *   B. Successful verification
 *   C. Cloudflare returns success:false (invalid token, expired, already-used)
 *   D. HTTP errors (non-2xx, network throw)
 *   E. Malformed JSON response
 *   F. Edge cases (very long token, whitespace-only token)
 *   G. Alias export
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyTurnstileToken, verifyTurnstile } from '../src/turnstile.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = 'test-turnstile-secret-0x4AAAAAAD';
const VALID_TOKEN = 'cf-turnstile-token-abc123';
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Build a fetch stub that returns the given Turnstile-style body */
function mockFetch(body, { ok = true, status = 200 } = {}) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

/** Build a fetch stub that throws (network error) */
function mockFetchThrow(msg = 'Network failure') {
  return vi.fn().mockRejectedValue(new Error(msg));
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let originalFetch;
beforeEach(() => {
  originalFetch = global.fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// A. Input guard
// ---------------------------------------------------------------------------

describe('A. Input guard — rejects without hitting the network', () => {
  it('A1: null token → false', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    expect(await verifyTurnstileToken(null, SECRET)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('A2: undefined token → false', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    expect(await verifyTurnstileToken(undefined, SECRET)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('A3: empty string token → false', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    expect(await verifyTurnstileToken('', SECRET)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('A4: numeric token (wrong type) → false', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    expect(await verifyTurnstileToken(12345, SECRET)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('A5: object token (wrong type) → false', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    expect(await verifyTurnstileToken({ token: 'x' }, SECRET)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('A6: boolean token (wrong type) → false', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    expect(await verifyTurnstileToken(true, SECRET)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// B. Successful verification
// ---------------------------------------------------------------------------

describe('B. Successful verification', () => {
  it('B1: valid token + success:true → true', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: true }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(true);
  });

  it('B2: verifies against the correct Cloudflare endpoint', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    await verifyTurnstileToken(VALID_TOKEN, SECRET);
    expect(spy).toHaveBeenCalledOnce();
    const [url] = spy.mock.calls[0];
    expect(url).toBe(VERIFY_URL);
  });

  it('B3: POSTs with method:POST', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    await verifyTurnstileToken(VALID_TOKEN, SECRET);
    const [, opts] = spy.mock.calls[0];
    expect(opts.method).toBe('POST');
  });

  it('B4: FormData body includes secret and response fields', async () => {
    let capturedBody;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
      capturedBody = opts.body;
      return { ok: true, json: async () => ({ success: true }) };
    }));
    await verifyTurnstileToken(VALID_TOKEN, SECRET);
    expect(capturedBody).toBeInstanceOf(FormData);
    expect(capturedBody.get('secret')).toBe(SECRET);
    expect(capturedBody.get('response')).toBe(VALID_TOKEN);
  });

  it('B5: response with extra Cloudflare fields still returns true', async () => {
    vi.stubGlobal('fetch', mockFetch({
      success: true,
      challenge_ts: '2026-07-26T12:00:00.000Z',
      hostname: 'share.refueler.io',
      action: '',
      cdata: '',
    }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. Cloudflare returns success:false
// ---------------------------------------------------------------------------

describe('C. Cloudflare success:false — invalid, expired, reused tokens', () => {
  it('C1: success:false → false', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: false }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });

  it('C2: token-already-spent error codes → false', async () => {
    vi.stubGlobal('fetch', mockFetch({
      success: false,
      'error-codes': ['timeout-or-duplicate'],
    }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });

  it('C3: invalid-input-response → false', async () => {
    vi.stubGlobal('fetch', mockFetch({
      success: false,
      'error-codes': ['invalid-input-response'],
    }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });

  it('C4: missing success field → false (undefined !== true)', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });

  it('C5: success:1 (truthy non-boolean) → false (strict ===)', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: 1 }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });

  it('C6: success:"true" (string) → false (strict ===)', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: 'true' }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. HTTP errors
// ---------------------------------------------------------------------------

describe('D. HTTP errors — fail-closed', () => {
  it('D1: HTTP 500 → false', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: true }, { ok: false, status: 500 }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });

  it('D2: HTTP 429 (rate-limited by CF) → false', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: true }, { ok: false, status: 429 }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });

  it('D3: HTTP 403 → false', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: true }, { ok: false, status: 403 }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });

  it('D4: Network throw → false', async () => {
    vi.stubGlobal('fetch', mockFetchThrow('ECONNREFUSED'));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });

  it('D5: fetch rejects with TypeError (network unavailable) → false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });

  it('D6: fetch never resolves timeout sim — rejected → false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('AbortError: timeout')));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E. Malformed JSON response
// ---------------------------------------------------------------------------

describe('E. Malformed JSON — fail-closed', () => {
  it('E1: json() throws → false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });

  it('E2: json() returns null → false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => null,
    }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });

  it('E3: json() returns array instead of object → false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [true],
    }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F. Edge cases
// ---------------------------------------------------------------------------

describe('F. Edge cases', () => {
  it('F1: whitespace-only string token → false (length > 0 but logically empty)', async () => {
    // turnstile.js checks length === 0, so a whitespace string passes the guard
    // but Cloudflare returns success:false — we mock that
    vi.stubGlobal('fetch', mockFetch({ success: false, 'error-codes': ['invalid-input-response'] }));
    expect(await verifyTurnstileToken('   ', SECRET)).toBe(false);
  });

  it('F2: very long token (4096 chars) — still hits network and returns true', async () => {
    const longToken = 'x'.repeat(4096);
    vi.stubGlobal('fetch', mockFetch({ success: true }));
    expect(await verifyTurnstileToken(longToken, SECRET)).toBe(true);
  });

  it('F3: token with special chars (base64url safe) → passes to network', async () => {
    const b64Token = 'abc-def_123.xyz=';
    vi.stubGlobal('fetch', mockFetch({ success: true }));
    expect(await verifyTurnstileToken(b64Token, SECRET)).toBe(true);
  });

  it('F4: two sequential calls with same token both resolve independently', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: true }));
    const [r1, r2] = await Promise.all([
      verifyTurnstileToken(VALID_TOKEN, SECRET),
      verifyTurnstileToken(VALID_TOKEN, SECRET),
    ]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
  });

  it('F5: different secret key is passed to FormData correctly', async () => {
    let capturedBody;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
      capturedBody = opts.body;
      return { ok: true, json: async () => ({ success: true }) };
    }));
    const altSecret = 'different-secret-key';
    await verifyTurnstileToken(VALID_TOKEN, altSecret);
    expect(capturedBody.get('secret')).toBe(altSecret);
  });
});

// ---------------------------------------------------------------------------
// G. Alias export
// ---------------------------------------------------------------------------

describe('G. verifyTurnstile alias', () => {
  it('G1: verifyTurnstile is the same function as verifyTurnstileToken', () => {
    expect(verifyTurnstile).toBe(verifyTurnstileToken);
  });

  it('G2: alias returns true on valid token', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: true }));
    expect(await verifyTurnstile(VALID_TOKEN, SECRET)).toBe(true);
  });

  it('G3: alias returns false on null token without hitting network', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    expect(await verifyTurnstile(null, SECRET)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
