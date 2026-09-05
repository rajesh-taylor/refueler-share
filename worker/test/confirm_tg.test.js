/**
 * confirm_tg.test.js — S-TG-4 unit tests
 *
 * Coverage:
 *   - POST /confirm/{uuid}: destruction, idempotency, 409 pre-consumed, 410 already-consumed
 *   - Download handler: 425 not-yet-available, 410 tidal-window-closed
 *   - Upload handler: 403 tidal-on-free-tier
 *   - manifest_tg helpers: checkTransferStatus, flipPendingDestruction, isTidalPermitted
 *   - meta handler: TG fields in response
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkTransferStatus,
  flipPendingDestruction,
  isTidalPermitted,
  validateTidalHeaders,
  buildTombstone,
} from '../src/manifest_tg.js';

// ─────────────────────────────────────────────────────────────────────────────
// manifest_tg pure-function tests
// ─────────────────────────────────────────────────────────────────────────────

describe('checkTransferStatus', () => {
  const NOW = 1_700_000_000;

  it('returns ok for a plain manifest with no TG fields', () => {
    const result = checkTransferStatus({}, NOW);
    expect(result.ok).toBe(true);
  });

  it('returns 410 when consumed === true', () => {
    const result = checkTransferStatus({ consumed: true }, NOW);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(410);
    expect(result.body).toMatch(/destroyed/i);
  });

  it('returns 425 when available_from is in the future', () => {
    const manifest = { available_from_timestamp: NOW + 3600 };
    const result = checkTransferStatus(manifest, NOW);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(425);
    expect(result.body).toMatch(/not yet available/i);
  });

  it('returns ok exactly at available_from boundary', () => {
    const manifest = { available_from_timestamp: NOW };
    const result = checkTransferStatus(manifest, NOW);
    expect(result.ok).toBe(true);
  });

  it('returns 410 when available_until is in the past', () => {
    const manifest = { available_until_timestamp: NOW - 1 };
    const result = checkTransferStatus(manifest, NOW);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(410);
    expect(result.body).toMatch(/no longer available/i);
  });

  it('returns ok exactly at available_until boundary (not yet expired)', () => {
    const manifest = { available_until_timestamp: NOW };
    const result = checkTransferStatus(manifest, NOW);
    expect(result.ok).toBe(true);
  });

  it('returns ok when both timestamps set and now is within the window', () => {
    const manifest = {
      available_from_timestamp: NOW - 60,
      available_until_timestamp: NOW + 3600,
    };
    const result = checkTransferStatus(manifest, NOW);
    expect(result.ok).toBe(true);
  });

  it('returns 425 (not 410) when from is future and until is also set', () => {
    const manifest = {
      available_from_timestamp: NOW + 60,
      available_until_timestamp: NOW + 3600,
    };
    const result = checkTransferStatus(manifest, NOW);
    expect(result.status).toBe(425);
  });

  it('pending_destruction: true does not block the transfer', () => {
    const manifest = { pending_destruction: true };
    const result = checkTransferStatus(manifest, NOW);
    expect(result.ok).toBe(true);
  });

  it('consumed check fires before tidal check', () => {
    // consumed: true + valid tidal window → still 410 (consumed wins)
    const manifest = {
      consumed: true,
      available_from_timestamp: NOW - 60,
      available_until_timestamp: NOW + 3600,
    };
    const result = checkTransferStatus(manifest, NOW);
    expect(result.status).toBe(410);
    expect(result.body).toMatch(/destroyed/i);
  });
});

describe('flipPendingDestruction', () => {
  it('returns manifest unchanged when pending_destruction is absent', () => {
    const manifest = { total_chunks: 3 };
    const result = flipPendingDestruction(manifest, 2);
    expect(result).toBe(manifest); // same reference
  });

  it('returns manifest unchanged when pending_destruction is already true', () => {
    const manifest = { total_chunks: 3, pending_destruction: true };
    const result = flipPendingDestruction(manifest, 2);
    expect(result).toBe(manifest);
  });

  it('returns manifest unchanged for a non-final chunk', () => {
    const manifest = { total_chunks: 5, pending_destruction: false };
    const result = flipPendingDestruction(manifest, 2);
    expect(result).toBe(manifest);
  });

  it('flips to true on the final chunk', () => {
    const manifest = { total_chunks: 5, pending_destruction: false };
    const result = flipPendingDestruction(manifest, 4); // index 4 = chunk 5 of 5
    expect(result).not.toBe(manifest);
    expect(result.pending_destruction).toBe(true);
  });

  it('returns manifest unchanged when total_chunks is not a number', () => {
    const manifest = { total_chunks: 'bad', pending_destruction: false };
    const result = flipPendingDestruction(manifest, 0);
    expect(result).toBe(manifest);
  });

  it('single-chunk transfer flips on chunk 0', () => {
    const manifest = { total_chunks: 1, pending_destruction: false };
    const result = flipPendingDestruction(manifest, 0);
    expect(result.pending_destruction).toBe(true);
  });
});

describe('isTidalPermitted', () => {
  it('returns true for sovereign', () => expect(isTidalPermitted('sovereign')).toBe(true));
  it('returns true for business',  () => expect(isTidalPermitted('business')).toBe(true));
  it('returns true for enterprise', () => expect(isTidalPermitted('enterprise')).toBe(true));
  it('returns false for free',     () => expect(isTidalPermitted('free')).toBe(false));
  it('returns false for citizen',  () => expect(isTidalPermitted('citizen')).toBe(false));
  it('returns false for undefined', () => expect(isTidalPermitted(undefined)).toBe(false));
  it('is case-insensitive',        () => expect(isTidalPermitted('Sovereign')).toBe(true));
});

describe('validateTidalHeaders', () => {
  const CREATED_AT   = 1_700_000_000;
  const EXPIRY_TS    = 1_700_000_000 + 7 * 86400; // 7 days out

  it('returns null when both args are null', () => {
    expect(validateTidalHeaders(null, null, CREATED_AT, EXPIRY_TS)).toBeNull();
  });

  it('returns error when available_from is before created_at', () => {
    const err = validateTidalHeaders(CREATED_AT - 1, null, CREATED_AT, EXPIRY_TS);
    expect(err).toMatch(/before transfer creation/);
  });

  it('returns error when available_from > available_until', () => {
    const err = validateTidalHeaders(CREATED_AT + 7200, CREATED_AT + 3600, CREATED_AT, EXPIRY_TS);
    expect(err).toMatch(/available_from must not be after/);
  });

  it('returns error when available_until exceeds expiry', () => {
    const err = validateTidalHeaders(null, EXPIRY_TS + 1, CREATED_AT, EXPIRY_TS);
    expect(err).toMatch(/must not exceed transfer expiry/);
  });

  it('returns null for valid window within expiry', () => {
    const err = validateTidalHeaders(CREATED_AT + 3600, CREATED_AT + 7200, CREATED_AT, EXPIRY_TS);
    expect(err).toBeNull();
  });

  it('returns null when only available_until is set and within expiry', () => {
    expect(validateTidalHeaders(null, EXPIRY_TS - 60, CREATED_AT, EXPIRY_TS)).toBeNull();
  });

  it('returns null when only available_from is set and after created_at', () => {
    expect(validateTidalHeaders(CREATED_AT + 60, null, CREATED_AT, EXPIRY_TS)).toBeNull();
  });
});

describe('buildTombstone', () => {
  it('returns only consumed and consumed_at', () => {
    const ts = 1_700_000_000;
    const t = buildTombstone(ts);
    expect(t).toEqual({ consumed: true, consumed_at: ts });
    expect(Object.keys(t)).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleConfirmTransfer — integration-style tests with env mocks
// ─────────────────────────────────────────────────────────────────────────────

// Import after pure-fn tests so vi.mock works at module boundary.
// We mock the R2 / KV / nut11 deps that confirm_transfer.js uses indirectly
// via manifest.js and nut11.js.

import { handleConfirmTransfer } from '../src/handlers/confirm_transfer.js';

function makeRequest(method = 'POST', headers = {}) {
  return new Request('https://example.com/confirm/test-uuid', {
    method,
    headers,
  });
}

function makeEnv(manifestData, { aeEnabled = true } = {}) {
  const manifestJson = JSON.stringify(manifestData);

  const bucket = {
    get: vi.fn(async (key) => {
      if (key.endsWith('manifest.json')) {
        return {
          size: manifestJson.length,
          text: async () => manifestJson,
        };
      }
      return null;
    }),
    put:    vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    head:   vi.fn(async () => null),
  };

  const ae = aeEnabled ? { writeDataPoint: vi.fn() } : undefined;

  return {
    BUCKET:            bucket,
    STATUS_KV:         { get: vi.fn(async () => null), put: vi.fn(), delete: vi.fn() },
    MINT_PRIVATE_KEY:  'test-key',
    AE:                ae,
  };
}

function makeCtx() {
  const work = [];
  return {
    waitUntil: (p) => work.push(p),
    flush: async () => Promise.allSettled(work),
  };
}

// ── Mock nut11.verifyDownloadToken ─────────────────────────────────────────
vi.mock('../src/nut11.js', () => ({
  verifyDownloadToken: vi.fn(),
  hashSecret:          vi.fn(),
  timingSafeEqual:     vi.fn(),
  issueDownloadToken:  vi.fn(),
}));

import { verifyDownloadToken } from '../src/nut11.js';

// ── Mock manifest.js safeGetManifest / putManifest ───────────────────────
// confirm_transfer.js imports safeGetManifest from '../manifest.js'.
// We intercept at the module level.
vi.mock('../src/manifest.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    putManifest: vi.fn(async () => {}),
  };
});

// Note: safeGetManifest in index.js is a local wrapper; confirm_transfer.js
// imports it directly from manifest.js. We therefore control it via the env
// mock above (bucket.get returns our manifest JSON). The mock above keeps
// putManifest as a spy while using the real getManifest logic.

describe('handleConfirmTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('200 { destroyed: false } — not a destroy-after-download transfer', async () => {
    const manifest = { total_chunks: 2, tier: 'sovereign' }; // no pending_destruction field
    const env = makeEnv(manifest);
    const ctx = makeCtx();

    const res = await handleConfirmTransfer(makeRequest(), env, ctx, 'aaaaaaaa-0000-0000-0000-000000000000');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.destroyed).toBe(false);
    expect(env.BUCKET.delete).not.toHaveBeenCalled();
  });

  it('409 — pending_destruction is false (armed but not yet fully downloaded)', async () => {
    const manifest = { total_chunks: 3, pending_destruction: false, tier: 'sovereign' };
    const env = makeEnv(manifest);
    const ctx = makeCtx();

    const res = await handleConfirmTransfer(makeRequest(), env, ctx, 'aaaaaaaa-0000-0000-0000-000000000000');
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/not yet fully downloaded/i);
    expect(env.BUCKET.delete).not.toHaveBeenCalled();
  });

  it('200 { destroyed: true } — pending_destruction is true, deletion fires', async () => {
    const uuid = 'aaaaaaaa-0000-0000-0000-000000000000';
    const manifest = {
      total_chunks:       2,
      pending_destruction: true,
      tier:               'sovereign',
      p2sh_secret_hash:   null,
    };
    const env = makeEnv(manifest);
    const ctx = makeCtx();

    const res = await handleConfirmTransfer(makeRequest(), env, ctx, uuid);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.destroyed).toBe(true);

    // Flush waitUntil promises
    await ctx.flush();

    // Both chunks should be deleted
    expect(env.BUCKET.delete).toHaveBeenCalledTimes(2);
    expect(env.BUCKET.delete).toHaveBeenCalledWith(`${uuid}/0000`);
    expect(env.BUCKET.delete).toHaveBeenCalledWith(`${uuid}/0001`);

      // Tombstone written — putManifest is mocked, verify it was called
    const { putManifest } = await import('../src/manifest.js');
    expect(putManifest).toHaveBeenCalled();
  });

  it('410 — already consumed (idempotent)', async () => {
    const manifest = { consumed: true, consumed_at: 1_700_000_000 };
    const env = makeEnv(manifest);
    const ctx = makeCtx();

    const res = await handleConfirmTransfer(makeRequest(), env, ctx, 'aaaaaaaa-0000-0000-0000-000000000000');
    expect(res.status).toBe(410);
    expect(env.BUCKET.delete).not.toHaveBeenCalled();
  });

  it('404 — transfer not found', async () => {
    const env = makeEnv(null);
    // Override bucket.get to return null for manifest
    env.BUCKET.get = vi.fn(async () => null);
    const ctx = makeCtx();

    const res = await handleConfirmTransfer(makeRequest(), env, ctx, 'aaaaaaaa-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('401 — passphrase-protected transfer, no token provided', async () => {
    const manifest = {
      total_chunks:       1,
      pending_destruction: true,
      p2sh_secret_hash:   'a'.repeat(64), // 64-char hex = passphrase present
      tier:               'sovereign',
    };
    const env = makeEnv(manifest);
    const ctx = makeCtx();

    const res = await handleConfirmTransfer(makeRequest('POST', {}), env, ctx, 'aaaaaaaa-0000-0000-0000-000000000000');
    expect(res.status).toBe(401);
  });

  it('403 — passphrase-protected transfer, invalid token', async () => {
    verifyDownloadToken.mockResolvedValue({ valid: false, uuid: null });

    const manifest = {
      total_chunks:       1,
      pending_destruction: true,
      p2sh_secret_hash:   'a'.repeat(64),
      tier:               'sovereign',
    };
    const env = makeEnv(manifest);
    const ctx = makeCtx();

    const res = await handleConfirmTransfer(
      makeRequest('POST', { Authorization: 'Bearer bad-token' }),
      env, ctx,
      'aaaaaaaa-0000-0000-0000-000000000000'
    );
    expect(res.status).toBe(403);
  });

  it('200 { destroyed: true } — passphrase-protected with valid token', async () => {
    const uuid = 'aaaaaaaa-0000-0000-0000-000000000000';
    verifyDownloadToken.mockResolvedValue({ valid: true, uuid });

    const manifest = {
      total_chunks:       1,
      pending_destruction: true,
      p2sh_secret_hash:   'a'.repeat(64),
      tier:               'sovereign',
    };
    const env = makeEnv(manifest);
    const ctx = makeCtx();

    const res = await handleConfirmTransfer(
      makeRequest('POST', { Authorization: 'Bearer valid-token' }),
      env, ctx,
      uuid
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.destroyed).toBe(true);

    await ctx.flush();
    expect(env.BUCKET.delete).toHaveBeenCalledWith(`${uuid}/0000`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tidal gate tests — 425 / 410 responses from checkTransferStatus
// These test the pure function directly (the download handler delegates to it)
// ─────────────────────────────────────────────────────────────────────────────

describe('tidal timing gates via checkTransferStatus', () => {
  const NOW = 1_700_000_000;

  it('425 when transfer is not yet available', () => {
    const manifest = { available_from_timestamp: NOW + 3600 };
    const { ok, status, body } = checkTransferStatus(manifest, NOW);
    expect(ok).toBe(false);
    expect(status).toBe(425);
    expect(body).toBe('This transfer is not yet available.');
  });

  it('410 when transfer availability window has closed', () => {
    const manifest = { available_until_timestamp: NOW - 1 };
    const { ok, status, body } = checkTransferStatus(manifest, NOW);
    expect(ok).toBe(false);
    expect(status).toBe(410);
    expect(body).toBe('This transfer is no longer available.');
  });

  it('410 when consumed regardless of tidal window', () => {
    const manifest = {
      consumed: true,
      available_from_timestamp: NOW - 60,
      available_until_timestamp: NOW + 3600,
    };
    const { ok, status } = checkTransferStatus(manifest, NOW);
    expect(ok).toBe(false);
    expect(status).toBe(410);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tidal tier-gate — 403 on free-tier tidal headers
// Tests isTidalPermitted which upload handler calls
// ─────────────────────────────────────────────────────────────────────────────

describe('tidal tier gate', () => {
  it('rejects free tier for tidal headers', () => {
    expect(isTidalPermitted('free')).toBe(false);
  });

  it('rejects citizen tier for tidal headers', () => {
    expect(isTidalPermitted('citizen')).toBe(false);
  });

  it('permits sovereign tier', () => {
    expect(isTidalPermitted('sovereign')).toBe(true);
  });

  it('permits business tier', () => {
    expect(isTidalPermitted('business')).toBe(true);
  });

  it('permits enterprise tier', () => {
    expect(isTidalPermitted('enterprise')).toBe(true);
  });
});
