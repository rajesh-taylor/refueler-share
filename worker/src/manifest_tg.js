/**
 * manifest_tg.js — Traitor's Gate manifest helpers
 *
 * Exports pure functions that operate on manifest objects.
 * No R2/KV I/O here — callers handle reads/writes.
 *
 * Four manifest fields added by TG-block:
 *   pending_destruction  — absent | false | true
 *   consumed             — bool, default false
 *   available_from_timestamp  — unix seconds, nullable, paid only
 *   available_until_timestamp — unix seconds, nullable, paid only
 */

// ---------------------------------------------------------------------------
// Status check — called by both auth and download handlers before any work.
// Returns { ok: true } or { ok: false, status: 410|425, body: string }.
// ---------------------------------------------------------------------------
export function checkTransferStatus(manifest, nowSeconds) {
  // Terminal: consumed (deleted)
  if (manifest.consumed === true) {
    return { ok: false, status: 410, body: 'Transfer has been destroyed.' };
  }

  const from  = manifest.available_from_timestamp  ?? null;
  const until = manifest.available_until_timestamp ?? null;

  // Not yet available — 425 Too Early
  if (from !== null && nowSeconds < from) {
    return { ok: false, status: 425, body: 'This transfer is not yet available.' };
  }

  // Tidal window closed — 410 Gone
  if (until !== null && nowSeconds > until) {
    return { ok: false, status: 410, body: 'This transfer is no longer available.' };
  }

  // pending_destruction: true is advisory — never blocks a re-fetch
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Write-time invariant check for tidal headers.
// Call this at chunk-0 processing before writing to manifest.
// Returns null on success, or an error string.
// ---------------------------------------------------------------------------
export function validateTidalHeaders(availableFrom, availableUntil, createdAt, expiryTimestamp) {
  if (availableFrom === null && availableUntil === null) return null; // nothing to check

  if (availableFrom !== null && availableFrom < createdAt) {
    return 'available_from must not be before transfer creation time';
  }
  if (availableFrom !== null && availableUntil !== null && availableFrom > availableUntil) {
    return 'available_from must not be after available_until';
  }
  if (availableUntil !== null && availableUntil > expiryTimestamp) {
    return 'available_until must not exceed transfer expiry';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Flip pending_destruction to true when the last chunk of a
// destroy-after-download transfer is served.
//
// Call this in the download handler AFTER a successful chunk response,
// ONLY when manifest.pending_destruction === false (armed).
//
// Returns the updated manifest object (caller writes it back to R2).
// Does NOT delete chunks — that happens in the confirmation-triggered DELETE.
// ---------------------------------------------------------------------------
export function flipPendingDestruction(manifest, chunkIndex) {
  // Only armed transfers participate (pending_destruction === false, not absent)
  if (manifest.pending_destruction !== false) return manifest;

  const totalChunks = manifest.total_chunks;
  if (typeof totalChunks !== 'number') return manifest; // malformed manifest — skip

  const isLastChunk = chunkIndex === totalChunks - 1;
  if (!isLastChunk) return manifest;

  return { ...manifest, pending_destruction: true };
}

// ---------------------------------------------------------------------------
// Build the tombstone object written back to R2 after chunk deletion.
// Drops all sensitive fields; keeps only consumed + consumed_at for audit.
// ---------------------------------------------------------------------------
export function buildTombstone(nowSeconds) {
  return {
    consumed:     true,
    consumed_at:  nowSeconds,
  };
}

// ---------------------------------------------------------------------------
// Tier gate for tidal headers.
// Returns true if the credential's tier permits tidal scheduling.
// Paid tiers: 'sovereign', 'business', 'enterprise' (lowercase).
//
// NOTE: confirm the exact tier string baked into the Cashu token secret
// in the credential issue handler before first deploy.
// ---------------------------------------------------------------------------
const PAID_TIERS = new Set(['sovereign', 'business', 'enterprise']);

export function isTidalPermitted(credentialTier) {
  return PAID_TIERS.has((credentialTier ?? '').toLowerCase());
}
