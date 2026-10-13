/**
 * manifest.js — R2 manifest helpers + TIER_CAPS
 *
 * Manifest schema (stored at {uuid}/manifest.json):
 * {
 *   uuid:                    string
 *   tier:                    'free' | 'max' | 'api'   (resolved at initiate)
 *   total_chunks:            number
 *   (no total_bytes — Share-Size-1: the exact size travels in the link fragment;
 *    manifests written before 6 Oct 2026 may still carry it until they expire)
 *   expiry_timestamp:        number  (unix seconds)
 *   created_at:              number  (unix seconds)
 *   blake3_root:             string  (hex — rolling root hash from client)
 *   chunks_received:         number[]
 *   upload_complete:         boolean
 *   download_initiated_at:   number | null  (unix seconds, first chunk download)
 *   p2sh_secret_hash:        string | null  (BLAKE3 hex — null = no passphrase gate)
 * }
 */

// One wire name per tier (B12-4a-2). The cap is checked at initiate against the
// RESOLVED tier: 'max' only from a paid Citizen session, 'api' only after the
// Chartered HMAC check. Locks: Sovereign/Citizen 100 GB (TH-Opus-1),
// API 250 GB (SW-Opus-1) = MAX_TRANSFER_CHUNKS × 32 MiB.
export const TIER_CAPS = {
  free: 4   * 1024 * 1024 * 1024,   //   4 GiB — Pro Bono
  max:  100 * 1024 * 1024 * 1024,   // 100 GiB — Citizen (wire 'max')
  api:  250 * 1024 * 1024 * 1024,   // 250 GiB — Chartered (wire 'api')
};

// Chartered cap: API issue `allocation_bytes` and capabilities
// `max_file_size_gb` read this — never a second literal. Live from B12-4a-2
// (was the free cap under KV-Fix-1a until initiate could resolve the tier).
export const CHARTERED_CAP_BYTES = TIER_CAPS.api;

export const TIER_EXPIRY_SECONDS = {
  free: 7 * 24 * 60 * 60,           // 7 days, fixed
  creative:   null,                 // user-set: 1 / 7 / 30 days
  production: null,                 // user-set: 1 / 7 / 30 / 90 days
  enterprise: null,                 // custom
};

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Fetch and parse manifest from R2.
 * Returns parsed object or null if not found.
 */
export async function getManifest(r2, uuid) {
  const obj = await r2.get(`${uuid}/manifest.json`);
  if (!obj) return null;
  const text = await obj.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write manifest to R2.
 */
export async function putManifest(r2, uuid, manifest) {
  await r2.put(`${uuid}/manifest.json`, JSON.stringify(manifest), {
    httpMetadata: { contentType: 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Build a fresh manifest object.
 * p2shSecretHash: hex string from nut11.hashSecret(), or null.
 */
export function createManifest({
  uuid,
  tier,
  totalChunks,
  expiryTimestamp,
  blake3Root,
  p2shSecretHash = null,
}) {
  return {
    uuid,
    tier,
    total_chunks: totalChunks,
    expiry_timestamp: expiryTimestamp,
    created_at: Math.floor(Date.now() / 1000),
    blake3_root: blake3Root,
    chunks_received: [],
    upload_complete: false,
    download_initiated_at: null,
    p2sh_secret_hash: p2shSecretHash,
  };
}

// ---------------------------------------------------------------------------
// Expiry helpers
// ---------------------------------------------------------------------------

/**
 * Is the transfer expired?
 * Returns true if past expiry_timestamp.
 */
export function isExpired(manifest) {
  return Math.floor(Date.now() / 1000) > manifest.expiry_timestamp;
}

/**
 * Is an in-progress download within grace period?
 * If download_initiated_at is set and the transfer was started before expiry,
 * we continue serving chunks even after expiry_timestamp has passed.
 */
export function isInGracePeriod(manifest) {
  if (!manifest.download_initiated_at) return false;
  return manifest.download_initiated_at < manifest.expiry_timestamp;
}

/**
 * Should this download request be blocked?
 * Blocked if: expired AND not in grace period.
 */
export function isDownloadBlocked(manifest) {
  if (!isExpired(manifest)) return false;
  return !isInGracePeriod(manifest);
}

// ---------------------------------------------------------------------------
// P2SH gate helper
// ---------------------------------------------------------------------------

/**
 * Does this manifest require a passphrase?
 */
export function requiresPassphrase(manifest) {
  return typeof manifest.p2sh_secret_hash === 'string' && manifest.p2sh_secret_hash.length === 64;
}
