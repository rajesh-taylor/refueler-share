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
// Turnstile-Gate-1: a hostname rule is now required (fail-closed without one). The stub
// answers this host unless a test says otherwise.
const GATE_HOST = 'gate.share.refueler.io';
const GATE = { hostnames: [GATE_HOST] };

/** Build a fetch stub that returns the given Turnstile-style body */
function mockFetch(body, { ok = true, status = 200 } = {}) {
  if (body && typeof body === 'object' && !('hostname' in body)) body = { hostname: GATE_HOST, ...body };
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
    expect(await verifyTurnstileToken(null, SECRET, GATE)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('A2: undefined token → false', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    expect(await verifyTurnstileToken(undefined, SECRET, GATE)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('A3: empty string token → false', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    expect(await verifyTurnstileToken('', SECRET, GATE)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('A4: numeric token (wrong type) → false', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    expect(await verifyTurnstileToken(12345, SECRET, GATE)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('A5: object token (wrong type) → false', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    expect(await verifyTurnstileToken({ token: 'x' }, SECRET, GATE)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('A6: boolean token (wrong type) → false', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    expect(await verifyTurnstileToken(true, SECRET, GATE)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// B. Successful verification
// ---------------------------------------------------------------------------

describe('B. Successful verification', () => {
  it('B1: valid token + success:true → true', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: true }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(true);
  });

  it('B2: verifies against the correct Cloudflare endpoint', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE);
    expect(spy).toHaveBeenCalledOnce();
    const [url] = spy.mock.calls[0];
    expect(url).toBe(VERIFY_URL);
  });

  it('B3: POSTs with method:POST', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE);
    const [, opts] = spy.mock.calls[0];
    expect(opts.method).toBe('POST');
  });

  it('B4: FormData body includes secret and response fields', async () => {
    let capturedBody;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
      capturedBody = opts.body;
      return { ok: true, json: async () => ({ success: true }) };
    }));
    await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE);
    expect(capturedBody).toBeInstanceOf(FormData);
    expect(capturedBody.get('secret')).toBe(SECRET);
    expect(capturedBody.get('response')).toBe(VALID_TOKEN);
  });

  it('B5: response with extra Cloudflare fields still returns true', async () => {
    vi.stubGlobal('fetch', mockFetch({
      success: true,
      challenge_ts: '2026-07-26T12:00:00.000Z',
      hostname: GATE_HOST,
      action: '',
      cdata: '',
    }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. Cloudflare returns success:false
// ---------------------------------------------------------------------------

describe('C. Cloudflare success:false — invalid, expired, reused tokens', () => {
  it('C1: success:false → false', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: false }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
  });

  it('C2: token-already-spent error codes → false', async () => {
    vi.stubGlobal('fetch', mockFetch({
      success: false,
      'error-codes': ['timeout-or-duplicate'],
    }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
  });

  it('C3: invalid-input-response → false', async () => {
    vi.stubGlobal('fetch', mockFetch({
      success: false,
      'error-codes': ['invalid-input-response'],
    }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
  });

  it('C4: missing success field → false (undefined !== true)', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
  });

  it('C5: success:1 (truthy non-boolean) → false (strict ===)', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: 1 }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
  });

  it('C6: success:"true" (string) → false (strict ===)', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: 'true' }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. HTTP errors
// ---------------------------------------------------------------------------

describe('D. HTTP errors — fail-closed', () => {
  it('D1: HTTP 500 → false', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: true }, { ok: false, status: 500 }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
  });

  it('D2: HTTP 429 (rate-limited by CF) → false', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: true }, { ok: false, status: 429 }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
  });

  it('D3: HTTP 403 → false', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: true }, { ok: false, status: 403 }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
  });

  it('D4: Network throw → false', async () => {
    vi.stubGlobal('fetch', mockFetchThrow('ECONNREFUSED'));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
  });

  it('D5: fetch rejects with TypeError (network unavailable) → false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
  });

  it('D6: fetch never resolves timeout sim — rejected → false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('AbortError: timeout')));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
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
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
  });

  it('E2: json() returns null → false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => null,
    }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
  });

  it('E3: json() returns array instead of object → false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [true],
    }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
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
    expect(await verifyTurnstileToken('   ', SECRET, GATE)).toBe(false);
  });

  it('F2: very long token (4096 chars) — still hits network and returns true', async () => {
    const longToken = 'x'.repeat(4096);
    vi.stubGlobal('fetch', mockFetch({ success: true }));
    expect(await verifyTurnstileToken(longToken, SECRET, GATE)).toBe(true);
  });

  it('F3: token with special chars (base64url safe) → passes to network', async () => {
    const b64Token = 'abc-def_123.xyz=';
    vi.stubGlobal('fetch', mockFetch({ success: true }));
    expect(await verifyTurnstileToken(b64Token, SECRET, GATE)).toBe(true);
  });

  it('F4: two sequential calls with same token both resolve independently', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: true }));
    const [r1, r2] = await Promise.all([
      verifyTurnstileToken(VALID_TOKEN, SECRET, GATE),
      verifyTurnstileToken(VALID_TOKEN, SECRET, GATE),
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
    await verifyTurnstileToken(VALID_TOKEN, altSecret, GATE);
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
    expect(await verifyTurnstile(VALID_TOKEN, SECRET, GATE)).toBe(true);
  });

  it('G3: alias returns false on null token without hitting network', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    expect(await verifyTurnstile(null, SECRET, GATE)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// H. Turnstile-Gate-1: hostname + action (plan §5)
// ---------------------------------------------------------------------------
import { appTurnstileRule, LEGACY_APP_TURNSTILE_HOSTNAME } from '../src/app_turnstile.js';

describe('H. hostname + action', () => {
  const ENV = { APP_TURNSTILE_HOSTNAME: GATE_HOST, APP_TURNSTILE_LEGACY_UNTIL: '2000000000' };
  const verify = (answer, rule) => { vi.stubGlobal('fetch', mockFetch(answer)); return verifyTurnstileToken(VALID_TOKEN, SECRET, rule); };

  it('H1: no rule at all → false, without hitting the network', async () => {
    const spy = mockFetch({ success: true });
    vi.stubGlobal('fetch', spy);
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET)).toBe(false);
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, { hostnames: [] })).toBe(false);
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, { hostnames: [], legacyHostnames: ['share.refueler.io'] })).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('H2: gate host + right action → true', async () => {
    expect(await verify({ success: true, hostname: GATE_HOST, action: 'upload' }, appTurnstileRule(ENV, 'upload', 1))).toBe(true);
    expect(await verify({ success: true, hostname: GATE_HOST, action: 'signin' }, appTurnstileRule(ENV, 'signin', 1))).toBe(true);
  });

  it('H3: wrong hostname → false', async () => {
    for (const hostname of ['evil.example', 'refueler-share-gate.pages.dev', 'gate.share.refueler.io.evil', '', undefined]) {
      expect(await verify({ success: true, hostname, action: 'upload' }, appTurnstileRule(ENV, 'upload', 1)), String(hostname)).toBe(false);
    }
  });

  it('H4: wrong action → false (a sign-in token never starts an upload, nor the reverse)', async () => {
    expect(await verify({ success: true, hostname: GATE_HOST, action: 'signin' }, appTurnstileRule(ENV, 'upload', 1))).toBe(false);
    expect(await verify({ success: true, hostname: GATE_HOST, action: 'upload' }, appTurnstileRule(ENV, 'signin', 1))).toBe(false);
    expect(await verify({ success: true, hostname: GATE_HOST, action: 'checkout' }, appTurnstileRule(ENV, 'upload', 1))).toBe(false);
  });

  it('H5: missing action on the gate host → false', async () => {
    expect(await verify({ success: true, hostname: GATE_HOST }, appTurnstileRule(ENV, 'upload', 1))).toBe(false);
    expect(await verify({ success: true, hostname: GATE_HOST, action: '' }, appTurnstileRule(ENV, 'upload', 1))).toBe(false);
  });

  it('H6: legacy host, no action, inside the window → true; after it → false', async () => {
    const old = { success: true, hostname: LEGACY_APP_TURNSTILE_HOSTNAME, action: '' };
    expect(await verify(old, appTurnstileRule(ENV, 'upload', 1999999999))).toBe(true);
    expect(await verify({ success: true, hostname: LEGACY_APP_TURNSTILE_HOSTNAME }, appTurnstileRule(ENV, 'signin', 1999999999))).toBe(true);
    expect(await verify(old, appTurnstileRule(ENV, 'upload', 2000000000))).toBe(false);
    expect(await verify(old, appTurnstileRule({ ...ENV, APP_TURNSTILE_LEGACY_UNTIL: '0' }, 'upload', 1))).toBe(false);
    expect(await verify(old, appTurnstileRule({ APP_TURNSTILE_HOSTNAME: GATE_HOST }, 'upload', 1))).toBe(false);
    expect(await verify(old, appTurnstileRule({ ...ENV, APP_TURNSTILE_LEGACY_UNTIL: 'soon' }, 'upload', 1))).toBe(false);
  });

  it('H7: legacy host WITH an action → false, even inside the window', async () => {
    expect(await verify({ success: true, hostname: LEGACY_APP_TURNSTILE_HOSTNAME, action: 'upload' }, appTurnstileRule(ENV, 'upload', 1))).toBe(false);
  });

  it('H8: no APP_TURNSTILE_HOSTNAME → false for every token (fail-closed)', async () => {
    expect(await verify({ success: true, hostname: GATE_HOST, action: 'upload' }, appTurnstileRule({}, 'upload', 1))).toBe(false);
    expect(await verify({ success: true, hostname: LEGACY_APP_TURNSTILE_HOSTNAME }, appTurnstileRule({ APP_TURNSTILE_LEGACY_UNTIL: '2000000000' }, 'upload', 1))).toBe(false);
  });

  it('H9: malformed siteverify JSON → false', async () => {
    for (const body of [null, [], 'success', 5]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }));
      expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE), JSON.stringify(body)).toBe(false);
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }));
    expect(await verifyTurnstileToken(VALID_TOKEN, SECRET, GATE)).toBe(false);
  });

  it('H10: checkout rule (hostnames only, no action) is unchanged', async () => {
    const plans = { hostnames: ['refueler.io'] };
    expect(await verify({ success: true, hostname: 'refueler.io' }, plans)).toBe(true);
    expect(await verify({ success: true, hostname: 'refueler.io', action: 'anything' }, plans)).toBe(true);
    expect(await verify({ success: true, hostname: GATE_HOST }, plans)).toBe(false);
  });

  it('H11: wrangler vars: gate host named, legacy window shut unless set at deploy', async () => {
    const { env } = await import('cloudflare:test');
    expect(env.APP_TURNSTILE_HOSTNAME).toBe('gate.share.refueler.io');
    expect(Number.isFinite(Number(env.APP_TURNSTILE_LEGACY_UNTIL))).toBe(true);
  });
});

describe('H12. siteverify address: Cloudflare, or localhost for the integration run only', async () => {
  const { verifyUrlFor } = await import('../src/turnstile.js');
  it('anything but a plain localhost http address falls back to Cloudflare', () => {
    expect(verifyUrlFor(undefined)).toBe(VERIFY_URL);
    expect(verifyUrlFor('http://127.0.0.1:41234/siteverify')).toBe('http://127.0.0.1:41234/siteverify');
    expect(verifyUrlFor('http://localhost:8790/')).toBe('http://localhost:8790/');
    for (const bad of ['https://evil.example/siteverify', 'http://localhost.evil.example:80/', 'http://127.0.0.1.nip.io:80/',
      'http://user@localhost:80/', 'http://localhost:80/x?y', 'http://localhost/', 'ftp://localhost:21/', 5, {}]) {
      expect(verifyUrlFor(bad), String(bad)).toBe(VERIFY_URL);
    }
  });
  it('the shipped wrangler.toml sets no TURNSTILE_VERIFY_URL', async () => {
    const { env } = await import('cloudflare:test');
    expect(env.TURNSTILE_VERIFY_URL).toBeUndefined();
  });
});
