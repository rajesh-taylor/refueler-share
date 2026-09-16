// worker/test/share-6-1.test.js
// Share-6-1 unit tests — the pure primitives behind /upload/:uuid/initiate.
//   • presign shape / expiry        (r2_presign.presignPutObject)
//   • commitment binding            (r2_presign.signSessionToken over uuid‖commitment)
//   • session-token auth            (r2_presign.constantTimeEqual)
//   • credit-pool debit refusal     (r2_presign.computeTransferCost + the gate predicate)
//
// These run standalone (Web Crypto only, no Worker harness). The end-to-end
// initiate/urls integration tests (real Supabase mock, real applyQuotaSpend 402,
// KV-stored session lookup) slot into the existing Vitest Worker harness next —
// stubbed at the foot of this file so the assertions are recorded.

import { describe, it, expect } from 'vitest';
import {
  presignPutObject,
  signSessionToken,
  constantTimeEqual,
  computeTransferCost,
  PRESIGN_EXPIRY,
  SIGV4_MAX_EXPIRY,
  TRANSFER_BASE_CREDITS,
  TRANSFER_PER_GB_CREDITS,
} from '../src/r2_presign.js';

const R2 = {
  accountId:       'fc4f3e5aeebe483677d14185daf544f5',
  accessKeyId:     'AKIAEXAMPLE_ACCESS_KEY_ID',
  secretAccessKey: 'wJalrXUtnFEMIexampleSECRETkeyEXAMPLEkey1234',
  bucket:          'refueler-share-dev',
};
const UUID = '0e51385a-1234-4abc-89ab-0123456789ab';
const FIXED_NOW = new Date('2026-09-16T12:00:00.000Z');

describe('presign shape / expiry', () => {
  it('produces a well-formed SigV4 query-string URL for PutObject', async () => {
    const { url } = await presignPutObject({ ...R2, key: `${UUID}/0000`, now: FIXED_NOW });
    const u = new URL(url);

    expect(u.protocol).toBe('https:');
    expect(u.host).toBe(`${R2.accountId}.r2.cloudflarestorage.com`);
    // path-style, single-encoded, '/' preserved, 0-indexed 4-digit part key
    expect(u.pathname).toBe(`/${R2.bucket}/${UUID}/0000`);
    expect(u.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(u.searchParams.get('X-Amz-Credential'))
      .toBe(`${R2.accessKeyId}/20260916/auto/s3/aws4_request`);
    expect(u.searchParams.get('X-Amz-Date')).toBe('20260916T120000Z');
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signs a 6-day expiry and reports the absolute unix expiry', async () => {
    const { url, expires } = await presignPutObject({ ...R2, key: `${UUID}/0000`, now: FIXED_NOW });
    expect(PRESIGN_EXPIRY).toBe(6 * 24 * 3600);           // 518,400
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe(String(PRESIGN_EXPIRY));
    expect(expires).toBe(Math.floor(FIXED_NOW.getTime() / 1000) + PRESIGN_EXPIRY);
  });

  it('refuses any expiry over the SigV4 7-day hard cap', async () => {
    expect(SIGV4_MAX_EXPIRY).toBe(7 * 24 * 3600);          // 604,800
    await expect(
      presignPutObject({ ...R2, key: `${UUID}/0000`, expiresIn: SIGV4_MAX_EXPIRY + 1 })
    ).rejects.toThrow(/7-day cap/);
  });

  it('signs distinct part keys to distinct signatures', async () => {
    const a = await presignPutObject({ ...R2, key: `${UUID}/0000`, now: FIXED_NOW });
    const b = await presignPutObject({ ...R2, key: `${UUID}/0001`, now: FIXED_NOW });
    expect(new URL(a.url).searchParams.get('X-Amz-Signature'))
      .not.toBe(new URL(b.url).searchParams.get('X-Amz-Signature'));
  });

  it('refuses to presign without R2 credentials', async () => {
    await expect(
      presignPutObject({ accountId: 'x', bucket: 'y', key: 'k' })
    ).rejects.toThrow(/credentials/);
  });
});

describe('commitment binding (upload-session token)', () => {
  const KEY = 'master-signing-key-for-tests';

  it('binds the token to uuid‖commitment', async () => {
    const base = await signSessionToken(KEY, UUID, 'commitment-AAA');
    const diffCommit = await signSessionToken(KEY, UUID, 'commitment-BBB');
    const diffUuid = await signSessionToken(KEY, 'ffffffff-1234-4abc-89ab-0123456789ab', 'commitment-AAA');
    expect(base).not.toBe(diffCommit);
    expect(base).not.toBe(diffUuid);
  });

  it('is deterministic for the same inputs (re-derivable for verification)', async () => {
    const a = await signSessionToken(KEY, UUID, 'commitment-AAA');
    const b = await signSessionToken(KEY, UUID, 'commitment-AAA');
    expect(a).toBe(b);
  });

  it('is a 43-char base64url string (HMAC-SHA256 → 32 bytes)', async () => {
    const t = await signSessionToken(KEY, UUID, 'commitment-AAA');
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('changes with the signing key (key is load-bearing)', async () => {
    const a = await signSessionToken('key-one', UUID, 'commitment-AAA');
    const b = await signSessionToken('key-two', UUID, 'commitment-AAA');
    expect(a).not.toBe(b);
  });

  it('throws without a signing key', async () => {
    await expect(signSessionToken('', UUID, 'c')).rejects.toThrow(/signing key/);
  });
});

describe('session-token auth', () => {
  it('authenticates the exact token and rejects a tampered one', async () => {
    const token = await signSessionToken('k', UUID, 'commitment-AAA');
    expect(constantTimeEqual(token, token)).toBe(true);
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(constantTimeEqual(token, tampered)).toBe(false);
  });

  it('rejects an empty or length-mismatched presented token', () => {
    expect(constantTimeEqual('', 'abc')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('credit-pool debit refusal (API tier)', () => {
  const GIB = 1024 * 1024 * 1024;

  it('prices per rate card v1.0: base + ceil(GiB) × per-GB', () => {
    expect(TRANSFER_BASE_CREDITS).toBe(10);
    expect(TRANSFER_PER_GB_CREDITS).toBe(100);
    expect(computeTransferCost(0)).toBe(10);              // base only
    expect(computeTransferCost(1)).toBe(110);             // 10 + 1×100
    expect(computeTransferCost(4 * GIB)).toBe(410);       // 4 GiB transfer
    expect(computeTransferCost(100 * GIB)).toBe(10010);   // 100 GiB transfer
  });

  // Gate predicate the handler applies: applyQuotaSpend refuses when the record
  // cannot cover computeTransferCost(bytes). Tested here against the cost fn.
  const canAfford = (remaining, bytes) => remaining >= computeTransferCost(bytes);

  it('refuses when remaining credits are below the transfer cost', () => {
    const bytes = 4 * GIB;                 // cost = 410
    expect(canAfford(409, bytes)).toBe(false); // 402 refusal
    expect(canAfford(410, bytes)).toBe(true);  // exact cover
    expect(canAfford(1000, bytes)).toBe(true);
  });
});

// ── Integration stubs — slot into the Vitest Worker harness (Share-6-1b) ──────
// These need the Supabase HTTP mock (seed via HTTP per invariant), the real
// applyQuotaSpend from quota.js, and KV-stored session lookup. Recorded here so
// the assertions travel with the code.
describe.skip('initiate / urls integration (Worker harness)', () => {
  it('initiate: 413 when total_bytes > TIER_CAPS[resolvedTier]');
  it('initiate: 401 on commitment mismatch (uuid-bound)');
  it('initiate: 409 on double-spend (atomic spent_tokens INSERT conflict)');
  it('initiate: 402 payment_required when the API credit pool cannot cover cost');
  it('initiate: does NOT re-spend on a second call (already_initiated 409)');
  it('initiate: returns ≤256 URLs + batch_next, and lands nothing on the Worker');
  it('urls: 401 without a valid X-Upload-Session token');
  it('urls: no Cashu re-verify / re-spend; bounds [from, from+count) to total_chunks');
});
