/**
 * sweep_rules.js — rules + small helpers for the orphan / expired sweep
 * worker/src/sweep_rules.js
 *
 * Share-B12-1. Everything the sweep DECIDES lives here as small, testable
 * functions; handlers/orphan_sweep.js only lists, classifies and dispatches.
 *
 * Spec: B12-SR §S1.10 (sweep rules) · §S3(b) (sweep interaction) · B12 §6
 * (PURGED status). Where the two disagree, B12-SR wins.
 */

import { buildTombstone } from './manifest_tg.js';
import { putManifest }    from './manifest.js';

// ── Constants ────────────────────────────────────────────────────────────────

// Plaintext chunk size. Ciphertext chunk = CHUNK_SIZE + 16 (AES-GCM tag).
// Local on purpose: utils.js CHUNK_SIZE_MAX (10 MB) is the legacy-path cap and
// has other callers. Wrong-size DELETION is opt-in (?wrong_size=delete) until a
// live dry run has shown this number matches reality.
export const CHUNK_SIZE      = 32 * 1024 * 1024;
export const CHUNK_TAG_BYTES = 16;

export const UPLOAD_WINDOW_SECONDS   = 6 * 86400;                          // presigned URLs live ≤ 6 days
export const IN_FLIGHT_CUTOFF_SECONDS = UPLOAD_WINDOW_SECONDS + 86400;      // + 1 day margin = 7 days
export const MIN_STALE_HOURS         = IN_FLIGHT_CUTOFF_SECONDS / 3600;     // 168 — floor for ?stale_hours
export const EXPIRY_GRACE_SECONDS    = 48 * 3600;                           // matches dock_index TTL formula
export const PURGED_DISPLAY_TTL_SECONDS = 7 * 86400;                        // B12 §6.4
export const ACTION_CAP              = 25;                                  // transfers acted on per run
export const DELETE_BATCH            = 1000;                                // R2 delete() max keys per call

// UUIDs the sweep must never touch, whatever dry_run says. Add / remove here.
// Empty since Share-Soak-3: the 250 GiB soak (3dcccb35…) was deleted at Soak-2.
// New soaks need no entry — in-flight (<7 d) and unexpired transfers are never swept.
export const SWEEP_PROTECTED_UUIDS = new Set([]);

// ── Pure rules ───────────────────────────────────────────────────────────────

/** R2 `uploaded` (Date | string | number) → unix seconds. Unknown → `fallback` (i.e. "fresh", never swept). */
export function toSeconds(value, fallback) {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : fallback;
}

/**
 * S1.10 rule 3 — chunk indices whose object size is wrong for this manifest.
 *   index >= total_chunks                    → deletable
 *   full chunk (index < total_chunks - 1)    → must be exactly CHUNK_SIZE + 16
 *   tail chunk (index == total_chunks - 1)   → must be <= CHUNK_SIZE + 16
 * `chunks` is Map<"0000", { size, uploaded }>. Returns string[] of segments.
 */
export function wrongSizeSegments(chunks, totalChunks) {
  if (!Number.isInteger(totalChunks) || totalChunks < 1) return [];
  const full = CHUNK_SIZE + CHUNK_TAG_BYTES;
  const bad  = [];
  for (const [seg, c] of chunks) {
    const idx = parseInt(seg, 10);
    if (idx >= totalChunks)            bad.push(seg);
    else if (idx < totalChunks - 1)  { if (c.size !== full) bad.push(seg); }
    else if (c.size > full)            bad.push(seg);
  }
  return bad;
}

/**
 * B12 §6.2 / option A — finalised, unconsumed transfer that is past
 * expiry + 48 h grace, with no download still inside its own grace window.
 */
export function isPurgeableExpired(m, nowSeconds) {
  if (!m || m.upload_complete !== true || m.consumed === true) return false;
  if (!Number.isFinite(m.expiry_timestamp)) return false;
  if (nowSeconds <= m.expiry_timestamp + EXPIRY_GRACE_SECONDS) return false;
  if (Number.isFinite(m.download_initiated_at) &&
      nowSeconds - m.download_initiated_at <= EXPIRY_GRACE_SECONDS) return false;
  return true;
}

// ── Effects ──────────────────────────────────────────────────────────────────

/**
 * Batched R2 delete (R2 accepts up to 1000 keys per call — an 8,000-chunk
 * transfer is 8 subrequests, not 8,000). Returns the number of keys deleted.
 * A failed batch is logged and skipped; the next sweep re-classifies it.
 */
export async function deleteKeys(bucket, keys) {
  let deleted = 0;
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    const batch = keys.slice(i, i + DELETE_BATCH);
    try {
      await bucket.delete(batch);
      deleted += batch.length;
    } catch (e) {
      console.error(`sweep: batch delete failed (${batch.length} keys from ${batch[0]}):`, e);
    }
  }
  return deleted;
}

/**
 * Run ordered key groups (chunks → hashes → manifest). Stops at the first
 * group that did not fully delete, so the manifest is never removed while
 * chunks remain — the next sweep can still classify the transfer.
 */
export async function deleteGroups(bucket, groups) {
  let deleted = 0;
  for (const group of groups) {
    if (group.length === 0) continue;
    const n = await deleteKeys(bucket, group);
    deleted += n;
    if (n < group.length) break;
  }
  return deleted;
}

/**
 * Settle dock_index:{uuid} after a sweep action (B12 §6, SR §S3(b)).
 *   mark=true  → read-then-merge purged_at, TTL = 7-day display window.
 *                No entry → nothing to mark ('none').
 *   mark=false → delete the entry. Absence is the only signal DAD, manual
 *                delete and every non-own-transition path share.
 */
export async function settleDockEntry(kv, uuid, { mark, nowSeconds }) {
  const key = `dock_index:${uuid}`;
  try {
    if (!mark) { await kv.delete(key); return 'removed'; }
    const existing = await kv.get(key, { type: 'json' });
    if (!existing || typeof existing !== 'object') return 'none';
    existing.purged_at = nowSeconds;
    await kv.put(key, JSON.stringify(existing), { expirationTtl: PURGED_DISPLAY_TTL_SECONDS });
    return 'marked';
  } catch (e) {
    console.error('sweep: dock_index settle failed:', e);
    return 'error';
  }
}

/**
 * Option A executor — purge one expired, finalised, unconsumed transfer.
 * Same shape as the DAD sequence: guard write → chunks → hashes → seal →
 * root_verified cache → tombstone → dock entry.
 *
 * `groups` = [chunkKeys, [hashes, date-seal]]; the tombstone is the manifest's
 * final state (written last, exactly as DAD does).
 *
 * The manifest is RE-READ immediately before the guard write. If another path
 * consumed it since classification, this run did NOT make the transition: no
 * purge, and the dock entry is removed (never marked).
 *
 * TODO(B12-3, SR §S1.8): the guard write becomes `put` with
 * `onlyIf: { etagMatches }`; a null return means another path won.
 */
export async function purgeExpiredTransfer(env, uuid, groups, nowSeconds) {
  let fresh = null;
  try {
    const obj = await env.BUCKET.get(`${uuid}/manifest.json`);
    if (obj) fresh = await obj.json();
  } catch (e) {
    console.error(`sweep: manifest re-read failed for ${uuid}:`, e);
    return { status: 'read_failed', deleted: 0, dock: null };
  }
  if (!fresh) return { status: 'gone', deleted: 0, dock: null };

  if (fresh.consumed === true) {
    const dock = await settleDockEntry(env.STATUS_KV, uuid, { mark: false, nowSeconds });
    return { status: 'lost_race', deleted: 0, dock };
  }
  if (!isPurgeableExpired(fresh, nowSeconds)) {
    return { status: 'no_longer_eligible', deleted: 0, dock: null };
  }

  try {
    await putManifest(env.BUCKET, uuid, { ...fresh, consumed: true, consumed_at: nowSeconds });
  } catch (e) {
    console.error(`sweep: consumed guard write failed for ${uuid}:`, e);
    return { status: 'guard_failed', deleted: 0, dock: null };
  }

  const deleted = await deleteGroups(env.BUCKET, groups);
  try { await env.STATUS_KV.delete(`root_verified:${uuid}`); }
  catch (e) { console.error('sweep: root_verified KV delete failed:', e); }

  try { await putManifest(env.BUCKET, uuid, buildTombstone(nowSeconds)); }
  catch (e) { console.error(`sweep: tombstone write failed for ${uuid}:`, e); }

  const dock = await settleDockEntry(env.STATUS_KV, uuid, { mark: true, nowSeconds });
  return { status: 'purged', deleted, dock };
}
