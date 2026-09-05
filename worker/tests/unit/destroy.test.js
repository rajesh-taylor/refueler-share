/**
 * destroy.test.js — Traitor's Gate manifest state machine
 *
 * Tests: checkTransferStatus, validateTidalHeaders, flipPendingDestruction,
 *        buildTombstone, isTidalPermitted
 *
 * No R2/KV I/O — pure function tests only.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTransferStatus,
  validateTidalHeaders,
  flipPendingDestruction,
  buildTombstone,
  isTidalPermitted,
} from '../../src/manifest_tg.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000; // arbitrary fixed unix timestamp

function baseManifest(overrides = {}) {
  return {
    uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    total_chunks: 3,
    expiry_timestamp: NOW + 7 * 86400,
    created_at: NOW - 60,
    consumed: false,
    pending_destruction: undefined,
    available_from_timestamp: null,
    available_until_timestamp: null,
    ...overrides,
  };
}

// ── checkTransferStatus ───────────────────────────────────────────────────────

describe('checkTransferStatus', () => {
  it('returns ok for a normal manifest', () => {
    const result = checkTransferStatus(baseManifest(), NOW);
    expect(result.ok).toBe(true);
  });

  it('consumed: true → 410', () => {
    const result = checkTransferStatus(baseManifest({ consumed: true }), NOW);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(410);
  });

  it('now < available_from → 423 (locked)', () => {
    const result = checkTransferStatus(
      baseManifest({ available_from_timestamp: NOW + 3600 }),
      NOW
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(425);
  });

  it('now === available_from → ok (boundary is inclusive)', () => {
    const result = checkTransferStatus(
      baseManifest({ available_from_timestamp: NOW }),
      NOW
    );
    expect(result.ok).toBe(true);
  });

  it('now > available_until → 410 (tide closed)', () => {
    const result = checkTransferStatus(
      baseManifest({ available_until_timestamp: NOW - 1 }),
      NOW
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(410);
  });

  it('now === available_until → ok (boundary is inclusive)', () => {
    const result = checkTransferStatus(
      baseManifest({ available_until_timestamp: NOW }),
      NOW
    );
    expect(result.ok).toBe(true);
  });

  it('pending_destruction: true with not consumed → still 200 (advisory)', () => {
    const result = checkTransferStatus(
      baseManifest({ pending_destruction: true }),
      NOW
    );
    expect(result.ok).toBe(true);
  });

  it('consumed takes priority over tidal window', () => {
    // consumed: true even when inside a valid tidal window → 410, not 423
    const result = checkTransferStatus(
      baseManifest({
        consumed: true,
        available_from_timestamp: NOW - 100,
        available_until_timestamp: NOW + 100,
      }),
      NOW
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(410);
  });
});

// ── validateTidalHeaders ──────────────────────────────────────────────────────

describe('validateTidalHeaders', () => {
  const createdAt = NOW - 60;
  const expiry = NOW + 7 * 86400;

  it('null/null → no error', () => {
    expect(validateTidalHeaders(null, null, createdAt, expiry)).toBeNull();
  });

  it('valid window → no error', () => {
    expect(validateTidalHeaders(NOW + 3600, NOW + 7200, createdAt, expiry)).toBeNull();
  });

  it('available_from < created_at → error', () => {
    const err = validateTidalHeaders(createdAt - 1, null, createdAt, expiry);
    expect(err).toMatch(/available_from/);
  });

  it('available_from > available_until → error', () => {
    const err = validateTidalHeaders(NOW + 7200, NOW + 3600, createdAt, expiry);
    expect(err).toMatch(/available_from/);
  });

  it('available_until > expiry_timestamp → error', () => {
    const err = validateTidalHeaders(null, expiry + 1, createdAt, expiry);
    expect(err).toMatch(/available_until/);
  });

  it('available_until === expiry_timestamp → ok (boundary is inclusive)', () => {
    expect(validateTidalHeaders(null, expiry, createdAt, expiry)).toBeNull();
  });

  it('available_from only (no until) → ok when valid', () => {
    expect(validateTidalHeaders(NOW + 3600, null, createdAt, expiry)).toBeNull();
  });
});

// ── flipPendingDestruction ────────────────────────────────────────────────────

describe('flipPendingDestruction', () => {
  it('armed transfer, last chunk → flips to true', () => {
    const m = baseManifest({ pending_destruction: false, total_chunks: 3 });
    const updated = flipPendingDestruction(m, 2); // index 2 = last of 3
    expect(updated.pending_destruction).toBe(true);
  });

  it('armed transfer, not last chunk → unchanged', () => {
    const m = baseManifest({ pending_destruction: false, total_chunks: 3 });
    const updated = flipPendingDestruction(m, 1);
    expect(updated).toBe(m); // same reference — no mutation
    expect(updated.pending_destruction).toBe(false);
  });

  it('not armed (pending_destruction absent) → unchanged', () => {
    const m = baseManifest({ total_chunks: 3 }); // pending_destruction: undefined
    const updated = flipPendingDestruction(m, 2);
    expect(updated).toBe(m);
  });

  it('already flipped (pending_destruction: true) → unchanged', () => {
    const m = baseManifest({ pending_destruction: true, total_chunks: 3 });
    const updated = flipPendingDestruction(m, 2);
    expect(updated).toBe(m);
  });

  it('single-chunk transfer: index 0 is last chunk → flips', () => {
    const m = baseManifest({ pending_destruction: false, total_chunks: 1 });
    const updated = flipPendingDestruction(m, 0);
    expect(updated.pending_destruction).toBe(true);
  });

  it('malformed manifest (no total_chunks) → unchanged', () => {
    const m = { pending_destruction: false }; // no total_chunks
    const updated = flipPendingDestruction(m, 0);
    expect(updated).toBe(m);
  });
});

// ── buildTombstone ────────────────────────────────────────────────────────────

describe('buildTombstone', () => {
  it('contains consumed: true and consumed_at', () => {
    const t = buildTombstone(NOW);
    expect(t.consumed).toBe(true);
    expect(t.consumed_at).toBe(NOW);
  });

  it('does not contain p2sh_secret_hash', () => {
    expect(buildTombstone(NOW)).not.toHaveProperty('p2sh_secret_hash');
  });

  it('does not contain expiry_timestamp', () => {
    expect(buildTombstone(NOW)).not.toHaveProperty('expiry_timestamp');
  });

  it('does not contain available_from_timestamp', () => {
    expect(buildTombstone(NOW)).not.toHaveProperty('available_from_timestamp');
  });

  it('does not contain available_until_timestamp', () => {
    expect(buildTombstone(NOW)).not.toHaveProperty('available_until_timestamp');
  });

  it('does not contain pending_destruction', () => {
    expect(buildTombstone(NOW)).not.toHaveProperty('pending_destruction');
  });

  it('contains exactly two keys', () => {
    const t = buildTombstone(NOW);
    expect(Object.keys(t)).toHaveLength(2);
  });
});

// ── isTidalPermitted ──────────────────────────────────────────────────────────

describe('isTidalPermitted', () => {
  it('sovereign → permitted', () => {
    expect(isTidalPermitted('sovereign')).toBe(true);
  });

  it('Sovereign (mixed case) → permitted', () => {
    expect(isTidalPermitted('Sovereign')).toBe(true);
  });

  it('business → permitted', () => {
    expect(isTidalPermitted('business')).toBe(true);
  });

  it('enterprise → permitted', () => {
    expect(isTidalPermitted('enterprise')).toBe(true);
  });

  it('citizen → not permitted', () => {
    expect(isTidalPermitted('citizen')).toBe(false);
  });

  it('null → not permitted', () => {
    expect(isTidalPermitted(null)).toBe(false);
  });

  it('undefined → not permitted', () => {
    expect(isTidalPermitted(undefined)).toBe(false);
  });

  it('empty string → not permitted', () => {
    expect(isTidalPermitted('')).toBe(false);
  });
});
