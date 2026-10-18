// ─────────────────────────────────────────────────────────────────────────────
// latch.js — conditional manifest writes + the deletion latch (B12-3 · 11 Oct 2026)
//
// B12-SR S1.8 🔒: every deletion path latches on the manifest with an R2
// conditional put (`onlyIf: { etagMatches }`). Exactly one path wins the
// live → consumed transition, and only the winner releases quota. Proven on
// real R2 at the B12-3 build gate (5 racers × 10 rounds, one winner each time).
//
// X6 🔒: initiate writes the manifest create-if-absent (`etagDoesNotMatch: '*'`),
// also proven on real R2 (and against a tombstone).
//
// Every other manifest writer (finalise, download start, timestamp) goes through
// updateManifest(): read with etag → mutate → conditional put → retry on
// contention. A stale writer can no longer clobber consumed:true (which would
// re-open a deleted transfer and let a second path win the latch).
// Tombstones are written unconditionally, but only after the latch is held.
// ─────────────────────────────────────────────────────────────────────────────

import { MANIFEST_SIZE_MAX } from './utils.js';
import { openQref, hasQref } from './seal.js';
import { releaseQuota } from './quota_store.js';

const manifestKey = (uuid) => `${uuid}/manifest.json`;
const PUT_OPTS = { httpMetadata: { contentType: 'application/json' } };

/**
 * readManifestTagged(bucket, uuid) → { manifest, etag } | { manifest: null, etag: null, oversize? }
 * Same 64 KB ceiling as safeGetManifest. Throws on R2 errors (callers decide).
 */
export async function readManifestTagged(bucket, uuid) {
  const obj = await bucket.get(manifestKey(uuid));
  if (!obj) return { manifest: null, etag: null };
  if ((obj.size ?? 0) > MANIFEST_SIZE_MAX) return { manifest: null, etag: null, oversize: true };
  let manifest = null;
  try { manifest = JSON.parse(await obj.text()); } catch { /* unreadable → null */ }
  return { manifest, etag: obj.etag ?? null };
}

/** Create-if-absent (X6). → true when this call created the manifest. */
export async function putManifestIfAbsent(bucket, uuid, manifest) {
  const r = await bucket.put(manifestKey(uuid), JSON.stringify(manifest),
    { ...PUT_OPTS, onlyIf: { etagDoesNotMatch: '*' } });
  return r !== null;
}

/** Conditional replace. → true when the object still had `etag` and was replaced. */
export async function putManifestIfMatch(bucket, uuid, manifest, etag) {
  if (!etag) return false;
  const r = await bucket.put(manifestKey(uuid), JSON.stringify(manifest),
    { ...PUT_OPTS, onlyIf: { etagMatches: etag } });
  return r !== null;
}

/**
 * updateManifest(bucket, uuid, mutate, { tries }) →
 *   { status: 'written', before, after } | { status: 'declined', before } |
 *   { status: 'gone' } | { status: 'contended', before }
 * mutate(fresh) returns the new manifest, or null to decline (e.g. consumed).
 */
export async function updateManifest(bucket, uuid, mutate, { tries = 4 } = {}) {
  let before = null;
  for (let i = 0; i < tries; i++) {
    const { manifest, etag } = await readManifestTagged(bucket, uuid);
    if (!manifest) return { status: 'gone' };
    before = manifest;
    const after = mutate(manifest);
    if (!after) return { status: 'declined', before };
    if (await putManifestIfMatch(bucket, uuid, after, etag)) return { status: 'written', before, after };
  }
  return { status: 'contended', before };
}

/**
 * releaseHeld(env, uuid, manifest) — the ONE release function (B12 §1.8): every
 * deletion path calls it with the pre-latch manifest, so the arguments reaching
 * Supabase are identical whichever path won. Never throws.
 *   no qref_ct (Pro Bono, Bearer, soak, pre-B12-3) → nothing held.
 * → { released, skipped? , error? }
 */
export async function releaseHeld(env, uuid, manifest) {
  if (!hasQref(manifest) || manifest.soak === true) return { released: 'none', skipped: 'no_quota' };
  const chunks = manifest.total_chunks;
  if (!Number.isInteger(chunks) || chunks < 1) return { released: 'none', skipped: 'no_chunks' };
  const q = await openQref(env, uuid, manifest.qref_ct);
  if (!q) {
    console.error(`quota release: qref_ct would not open for ${String(uuid).slice(0, 8)} (reconcile corrects)`);
    return { released: 'none', error: 'seal_open_failed' };
  }
  try {
    const r = await releaseQuota(env, q.quotaRef, q.sessionHash, chunks, manifest.upload_complete === true);
    if (r?.clamped) console.error(`quota release: used clamped at 0 for one account (${String(uuid).slice(0, 8)})`);
    return { released: r?.released ?? 'none' };
  } catch (e) {
    // Missed credit-back: over-count, user's disfavour, ≤ 24 h until reconcile (S1 drift).
    console.error(`quota release failed for ${String(uuid).slice(0, 8)}:`, e?.message ?? e);
    return { released: 'none', error: 'store_unavailable' };
  }
}

/**
 * latchConsumed(env, uuid, nowSeconds, { eligible }) →
 *   { won: true,  manifest: <pre-latch>, consumedAt, release }
 *   { won: false, reason: 'already_consumed', manifest, consumedAt }
 *   { won: false, reason: 'gone' | 'not_eligible' | 'contended', manifest? }
 * eligible(fresh) — optional extra condition checked on the fresh read (sweeps).
 * The winner releases quota before returning; a loser never does.
 */
export async function latchConsumed(env, uuid, nowSeconds, { eligible } = {}) {
  let reason = null;
  const r = await updateManifest(env.BUCKET, uuid, (m) => {
    if (m.consumed === true)       { reason = 'already_consumed'; return null; }
    if (eligible && !eligible(m))  { reason = 'not_eligible';     return null; }
    return { ...m, consumed: true, consumed_at: nowSeconds };
  });
  if (r.status === 'gone')      return { won: false, reason: 'gone' };
  if (r.status === 'contended') return { won: false, reason: 'contended', manifest: r.before };
  if (r.status === 'declined') {
    return { won: false, reason, manifest: r.before, consumedAt: r.before?.consumed_at ?? nowSeconds };
  }
  const release = await releaseHeld(env, uuid, r.before);
  return { won: true, manifest: r.before, consumedAt: nowSeconds, release };
}
