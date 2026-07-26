// test/manifest.test.js
// Unit tests for worker/src/manifest.js
//
// Covers:
//   TIER_CAPS         — correct byte values for all tiers
//   TIER_EXPIRY_SECONDS — free=7days, paid tiers null
//   createManifest    — required fields, defaults, p2shSecretHash optional
//   isExpired         — past/future expiry_timestamp
//   isInGracePeriod   — download_initiated_at before vs after expiry
//   isDownloadBlocked — expired + not in grace, expired + in grace, not expired
//   requiresPassphrase — 64-char hex present, null, wrong length
//   getManifest       — R2 hit, R2 miss, malformed JSON
//   putManifest       — R2 put called with correct key + JSON

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  TIER_CAPS,
  TIER_EXPIRY_SECONDS,
  createManifest,
  getManifest,
  putManifest,
  isExpired,
  isInGracePeriod,
  isDownloadBlocked,
  requiresPassphrase,
} from 'src/manifest.js';

// ─── R2 mock ─────────────────────────────────────────────────────────────────

function makeR2(initialObjects = {}) {
  const store = new Map(Object.entries(initialObjects));

  return {
    _store: store,

    async get(key) {
      const value = store.get(key);
      if (value === undefined) return null;
      return {
        text: async () => value,
      };
    },

    async put(key, value, _opts) {
      store.set(key, value);
    },
  };
}

// ─── Fixture helpers ─────────────────────────────────────────────────────────

const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const NOW_SEC = 1_000_000; // unix seconds

function baseManifest(overrides = {}) {
  return {
    uuid: UUID,
    tier: 'free',
    total_chunks: 4,
    total_bytes: 1024,
    expiry_timestamp: NOW_SEC + 3600,   // 1 hour from now by default
    created_at: NOW_SEC,
    blake3_root: 'a'.repeat(64),
    chunks_received: [],
    upload_complete: false,
    download_initiated_at: null,
    p2sh_secret_hash: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe('TIER_CAPS', () => {
  it('free tier is exactly 4 GB', () => {
    expect(TIER_CAPS.free).toBe(4 * 1024 * 1024 * 1024);
  });

  it('creative tier is exactly 100 GB', () => {
    expect(TIER_CAPS.creative).toBe(100 * 1024 * 1024 * 1024);
  });

  it('production tier is exactly 250 GB', () => {
    expect(TIER_CAPS.production).toBe(250 * 1024 * 1024 * 1024);
  });

  it('enterprise tier is Infinity', () => {
    expect(TIER_CAPS.enterprise).toBe(Infinity);
  });
});

describe('TIER_EXPIRY_SECONDS', () => {
  it('free tier is exactly 7 days in seconds', () => {
    expect(TIER_EXPIRY_SECONDS.free).toBe(7 * 24 * 60 * 60);
  });

  it('paid tiers return null (user-set expiry)', () => {
    expect(TIER_EXPIRY_SECONDS.creative).toBeNull();
    expect(TIER_EXPIRY_SECONDS.production).toBeNull();
    expect(TIER_EXPIRY_SECONDS.enterprise).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createManifest
// ─────────────────────────────────────────────────────────────────────────────

describe('createManifest', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns an object with all required fields', () => {
    const m = createManifest({
      uuid: UUID,
      tier: 'free',
      totalChunks: 4,
      totalBytes: 1024,
      expiryTimestamp: NOW_SEC + 3600,
      blake3Root: 'a'.repeat(64),
    });

    expect(m.uuid).toBe(UUID);
    expect(m.tier).toBe('free');
    expect(m.total_chunks).toBe(4);
    expect(m.total_bytes).toBe(1024);
    expect(m.expiry_timestamp).toBe(NOW_SEC + 3600);
    expect(m.blake3_root).toBe('a'.repeat(64));
    expect(m.chunks_received).toEqual([]);
    expect(m.upload_complete).toBe(false);
    expect(m.download_initiated_at).toBeNull();
    expect(m.p2sh_secret_hash).toBeNull();
  });

  it('sets created_at to current unix seconds', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_SEC * 1000);
    const m = createManifest({
      uuid: UUID, tier: 'creative', totalChunks: 1,
      totalBytes: 100, expiryTimestamp: NOW_SEC + 100, blake3Root: 'b'.repeat(64),
    });
    expect(m.created_at).toBe(NOW_SEC);
  });

  it('accepts p2shSecretHash when provided', () => {
    const hash = 'f'.repeat(64);
    const m = createManifest({
      uuid: UUID, tier: 'free', totalChunks: 1,
      totalBytes: 100, expiryTimestamp: NOW_SEC + 100,
      blake3Root: 'a'.repeat(64), p2shSecretHash: hash,
    });
    expect(m.p2sh_secret_hash).toBe(hash);
  });

  it('defaults p2shSecretHash to null when omitted', () => {
    const m = createManifest({
      uuid: UUID, tier: 'free', totalChunks: 1,
      totalBytes: 100, expiryTimestamp: NOW_SEC + 100, blake3Root: 'a'.repeat(64),
    });
    expect(m.p2sh_secret_hash).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isExpired / isInGracePeriod / isDownloadBlocked
// ─────────────────────────────────────────────────────────────────────────────

describe('isExpired', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns false when expiry_timestamp is in the future', () => {
    vi.spyOn(Date, 'now').mockReturnValue((NOW_SEC - 10) * 1000);
    expect(isExpired(baseManifest({ expiry_timestamp: NOW_SEC }))).toBe(false);
  });

  it('returns true when expiry_timestamp is in the past', () => {
    vi.spyOn(Date, 'now').mockReturnValue((NOW_SEC + 10) * 1000);
    expect(isExpired(baseManifest({ expiry_timestamp: NOW_SEC }))).toBe(true);
  });
});

describe('isInGracePeriod', () => {
  it('returns false when download_initiated_at is null', () => {
    expect(isInGracePeriod(baseManifest({ download_initiated_at: null }))).toBe(false);
  });

  it('returns true when download started before expiry_timestamp', () => {
    const m = baseManifest({
      expiry_timestamp: NOW_SEC + 3600,
      download_initiated_at: NOW_SEC,  // started before expiry
    });
    expect(isInGracePeriod(m)).toBe(true);
  });

  it('returns false when download started after expiry_timestamp', () => {
    const m = baseManifest({
      expiry_timestamp: NOW_SEC,
      download_initiated_at: NOW_SEC + 1,  // started after expiry
    });
    expect(isInGracePeriod(m)).toBe(false);
  });
});

describe('isDownloadBlocked', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is not blocked when not expired', () => {
    vi.spyOn(Date, 'now').mockReturnValue((NOW_SEC - 10) * 1000);
    expect(isDownloadBlocked(baseManifest({ expiry_timestamp: NOW_SEC }))).toBe(false);
  });

  it('is blocked when expired and no download_initiated_at', () => {
    vi.spyOn(Date, 'now').mockReturnValue((NOW_SEC + 10) * 1000);
    const m = baseManifest({ expiry_timestamp: NOW_SEC, download_initiated_at: null });
    expect(isDownloadBlocked(m)).toBe(true);
  });

  it('is NOT blocked when expired but in grace period', () => {
    vi.spyOn(Date, 'now').mockReturnValue((NOW_SEC + 10) * 1000);
    const m = baseManifest({
      expiry_timestamp: NOW_SEC,
      download_initiated_at: NOW_SEC - 100,  // started before expiry
    });
    expect(isDownloadBlocked(m)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requiresPassphrase
// ─────────────────────────────────────────────────────────────────────────────

describe('requiresPassphrase', () => {
  it('returns true for a 64-char hex p2sh_secret_hash', () => {
    expect(requiresPassphrase(baseManifest({ p2sh_secret_hash: 'a'.repeat(64) }))).toBe(true);
  });

  it('returns false when p2sh_secret_hash is null', () => {
    expect(requiresPassphrase(baseManifest({ p2sh_secret_hash: null }))).toBe(false);
  });

  it('returns false when p2sh_secret_hash is wrong length', () => {
    expect(requiresPassphrase(baseManifest({ p2sh_secret_hash: 'abc' }))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getManifest / putManifest
// ─────────────────────────────────────────────────────────────────────────────

describe('getManifest', () => {
  it('returns parsed manifest when R2 object exists', async () => {
    const fixture = baseManifest();
    const r2 = makeR2({ [`${UUID}/manifest.json`]: JSON.stringify(fixture) });
    const result = await getManifest(r2, UUID);
    expect(result).toEqual(fixture);
  });

  it('returns null when R2 key does not exist', async () => {
    const r2 = makeR2({});
    const result = await getManifest(r2, UUID);
    expect(result).toBeNull();
  });

  it('returns null when R2 value is malformed JSON', async () => {
    const r2 = makeR2({ [`${UUID}/manifest.json`]: '{BROKEN' });
    const result = await getManifest(r2, UUID);
    expect(result).toBeNull();
  });
});

describe('putManifest', () => {
  it('writes manifest JSON to the correct R2 key', async () => {
    const r2 = makeR2();
    const fixture = baseManifest();
    await putManifest(r2, UUID, fixture);
    const stored = r2._store.get(`${UUID}/manifest.json`);
    expect(JSON.parse(stored)).toEqual(fixture);
  });
});
