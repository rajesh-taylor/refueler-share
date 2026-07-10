/**
 * Manifest — authoritative transfer state
 *
 * The R2 manifest.json is the single source of truth for every transfer.
 * Supabase (spent_tokens) is the double-spend ledger only.
 * No transfer state lives in KV, Durable Objects, or Worker memory.
 *
 * Manifest key: {transfer-uuid}/manifest.json
 * Chunk key:    {transfer-uuid}/{chunk-index-zero-padded-4-digits}
 *               e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890/0042
 */

// Transfer capacity limits per tier (bytes)
export const TIER_CAPS = {
  free:               4  * 1024 * 1024 * 1024,  //   4 GB — Skint Tog
  creative_premium:   100 * 1024 * 1024 * 1024, // 100 GB
  production_max:     250 * 1024 * 1024 * 1024, // 250 GB
  enterprise:         Infinity,
};

// Link expiry options per tier (seconds)
export const TIER_EXPIRY_OPTIONS = {
  free:             [5 * 86400],                                // 5 days only, no choice
  creative_premium: [1 * 86400, 7 * 86400, 30 * 86400],        // 1 / 7 / 30 days
  production_max:   [1 * 86400, 7 * 86400, 30 * 86400, 90 * 86400], // 1 / 7 / 30 / 90 days
  enterprise:       null,                                       // custom
};

/**
 * Manifest v1 shape.
 * All fields present from creation. Null fields updated as transfer progresses.
 */
export function buildManifest({
  uuid,
  tier,
  chunkCount,
  totalBytes,
  blake3RootHash,
  expirySeconds,
  recipientMode = null,
  maxRedemptions = null,
  maxDownloadsPerKey = null,
}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    version: 1,
    transfer_uuid: uuid,
    tier,
    chunk_count: chunkCount,
    total_bytes: totalBytes,
    blake3_root_hash: blake3RootHash,
    created_at: now,
    expiry_timestamp: now + expirySeconds,
    download_initiated_at: null,
    p2sh_mode: null,
    p2sh_secret_hash: null,
    p2sh_public_key: null,
    aes_key_encrypted: null,
    ml_kem_enabled: false,
    recipient_mode: recipientMode,
    max_redemptions: maxRedemptions,
    redemption_count: 0,
    max_downloads_per_key: maxDownloadsPerKey,
  };
}

/**
 * getManifest(uuid, env) → manifest object | null
 */
export async function getManifest(uuid, env) {
  const obj = await env.R2.get(`${uuid}/manifest.json`);
  if (!obj) return null;
  try {
    return JSON.parse(await obj.text());
  } catch {
    return null;
  }
}

/**
 * putManifest(manifest, env) → void
 *
 * Writes manifest to R2. Overwrites existing. Caller is responsible for
 * atomic consistency — use ETag conditional writes for redemption_count
 * increments to prevent race conditions.
 */
export async function putManifest(manifest, env) {
  await env.R2.put(
    `${manifest.transfer_uuid}/manifest.json`,
    JSON.stringify(manifest),
    { httpMetadata: { contentType: 'application/json' } }
  );
}

/**
 * isExpired(manifest) → boolean
 *
 * Returns true if the transfer link has expired AND no download is in progress.
 * Grace period: if download_initiated_at is set and was before expiry, serve continues.
 */
export function isExpired(manifest) {
  const now = Math.floor(Date.now() / 1000);
  if (now <= manifest.expiry_timestamp) return false;
  // Link is past expiry — check in-progress grace period
  if (manifest.download_initiated_at && manifest.download_initiated_at < manifest.expiry_timestamp) {
    // Download started before expiry — grace period applies, not expired for this transfer
    return false;
  }
  return true;
}

/**
 * chunkKey(uuid, chunkIndex) → string
 *
 * Produces the zero-padded 4-digit chunk key for R2 storage.
 * e.g. chunkKey('abc...', 42) → 'abc.../0042'
 */
export function chunkKey(uuid, chunkIndex) {
  return `${uuid}/${String(chunkIndex).padStart(4, '0')}`;
}

/**
 * validateExpiryChoice(tier, expirySeconds) → boolean
 *
 * Ensures the client hasn't sent a non-permitted expiry value for their tier.
 * Free tier is always 5 days — any other value is rejected.
 */
export function validateExpiryChoice(tier, expirySeconds) {
  const options = TIER_EXPIRY_OPTIONS[tier];
  if (options === null) return true;           // enterprise: anything goes
  if (!options) return false;
  return options.includes(expirySeconds);
}
