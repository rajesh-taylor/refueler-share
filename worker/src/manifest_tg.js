/**
 * manifest_tg.js — Traitor's Gate + Tower Hill manifest helpers
 *
 * Exports pure functions that operate on manifest objects.
 * No R2/KV I/O here — callers handle reads/writes.
 *
 * TG-block fields:
 *   pending_destruction       — absent | false | true
 *   consumed                  — bool, default false
 *   available_from_timestamp  — unix seconds, nullable, paid only
 *   available_until_timestamp — unix seconds, nullable, paid only
 *
 * TH-1 fields (Tower Hill / Permanent Record):
 *   timestamp_state           — 'none' | 'pending' | 'complete'
 *   timestamp_submitted_at    — unix seconds, nullable
 *
 * No digest, no calendar URLs stored in manifest — Worker is a blind byte-relay.
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
// Tier gate for tidal headers (the availability window).
// Returns true if the credential's tier permits tidal scheduling.
//
// The availability window is a PAID-vs-FREE gate — permitted on BOTH paid
// tiers (Citizen and Sovereign), never rail-gated. isTidalPermitted receives a
// tier string (feature level), which carries no rail signal, so it can only
// ever express paid-vs-free — which is exactly the intended gate.
//
// Live wire values (Share-2, 11 Sep 2026): 'free' / 'creative' / 'max'. The
// two paid keys are 'creative' and 'max'; this set mirrors the paid set in
// lightning-routes.js (VALID_TIERS). Deferred: 'free'/'creative'/'max' →
// 'paid_*' migration, after which gate via tiers.js isPaidTier() instead.
// ---------------------------------------------------------------------------
const PAID_TIERS = new Set(['creative', 'max']);

export function isTidalPermitted(credentialTier) {
  return PAID_TIERS.has((credentialTier ?? '').toLowerCase());
}

// ---------------------------------------------------------------------------
// TH-1: Timestamp state helpers
// ---------------------------------------------------------------------------

// Valid timestamp_state values.
export const TIMESTAMP_STATES = /** @type {const} */ (['none', 'pending', 'complete']);

// Returns the current timestamp_state, defaulting to 'none' for legacy manifests.
export function getTimestampState(manifest) {
  const s = manifest.timestamp_state;
  if (s === 'pending' || s === 'complete') return s;
  return 'none';
}

// Returns a manifest patch that sets timestamp_state to 'pending'.
// Caller merges this into the manifest and writes to R2.
// Does NOT touch any other field — minimal write footprint.
export function buildTimestampPendingPatch(nowSeconds) {
  return {
    timestamp_state:        'pending',
    timestamp_submitted_at: nowSeconds,
  };
}

// Returns a manifest patch that promotes timestamp_state from 'pending' to 'complete'.
// Called when Legend (or any future verifier) confirms the Bitcoin attestation.
// No GET /timestamp/upgrade in Share — upgrade path belongs to Legend.
// This function exists so the data model is consistent across products.
export function buildTimestampCompletePatch() {
  return {
    timestamp_state: 'complete',
  };
}

// Guard: returns true if this manifest is eligible for timestamp submission.
// Eligibility: upload complete, not consumed, timestamp_state === 'none'.
// Tier check is the caller's responsibility (Sovereign+ gate in the handler).
export function isTimestampEligible(manifest) {
  return (
    manifest.upload_complete === true  &&
    manifest.consumed !== true         &&
    getTimestampState(manifest) === 'none'
  );
}