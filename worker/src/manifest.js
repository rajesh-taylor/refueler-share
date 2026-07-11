/**
 * manifest.js — R2 manifest helpers + TIER_CAPS
 *
 * Manifest schema (stored at {uuid}/manifest.json):
 * {
 *   uuid:                    string
 *   tier:                    'free' | 'creative' | 'production' | 'enterprise'
 *   total_chunks:            number
 *   total_bytes:             number
 *   expiry_timestamp:        number  (unix seconds)
 *   created_at:              number  (unix seconds)
 *   blake3_root:             string  (hex — rolling root hash from client)
 *   chunks_received:         number[]
 *   upload_complete:         boolean
 *   download_initiated_at:   number | null  (unix seconds, first chunk download)
 *   p2sh_secret_hash:        string | null  (BLAKE3 hex — null = no passphrase gate)
 * }
 */

export const TIER_CAPS = {
  free:       4  * 1024 * 1024 * 1024,   // 4 GB
  creative:   100 * 1024 * 1024 * 1024,  // 100 GB
  production: 250 * 1024 * 1024 * 1024,  // 250 GB
  enterprise: Infinity,
};

export const TIER_EXPIRY_SECONDS = {
  free:       5  * 24 * 60 * 60,   // 5 days, fixed
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
  totalBytes,
  expiryTimestamp,
  blake3Root,
  p2shSecretHash = null,
}) {
  return {
    uuid,
    tier,
    total_chunks: totalChunks,
    total_bytes: totalBytes,
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
