/**
 * orphan_sweep.js — GET /admin/orphan-sweep
 * worker/src/handlers/orphan_sweep.js
 *
 * Share-6-6a/6b: admin-key-gated R2 audit + cleanup. Share-B12-1: sweep rules
 * per B12-SR §S1.10, PURGED marking per B12 §6 / B12-SR §S3(b). Rules and
 * effects live in ../sweep_rules.js; this file lists, classifies, plans, and
 * (only when dry_run=false) executes the plan.
 *
 * Each UUID in the bucket lands in exactly one class:
 *   protected         — in SWEEP_PROTECTED_UUIDS (the 250 GiB soak). Never touched.
 *   tombstone_residue — manifest consumed:true but objects remain (S1.10 rule 1).
 *                       Chunks/hashes/seal deleted; the tombstone manifest STAYS
 *                       (it is the recipient's 410). Dock entry removed.
 *   complete          — upload_complete:true. If also past expiry + 48 h grace,
 *                       unconsumed, and no download inside its grace → `expired`:
 *                       purged (guard write → chunks → hashes → seal → tombstone)
 *                       and dock_index gets purged_at. Otherwise untouched.
 *   incomplete        — manifest, not finalised, still inside the 7-day window
 *                       (UPLOAD_WINDOW 6 d + 1 d). In flight; never touched.
 *   stale             — incomplete AND manifest created_at AND last R2 activity
 *                       older than stale_hours (default 168, floored at 168).
 *   sidecar_only      — manifest and/or hashes/seal with no chunks, same age gate.
 *   orphan_chunks     — chunks, no manifest. Only chunk objects whose R2
 *                       `uploaded` is older than 7 days are deletable (rule 2).
 *
 * Wrong-size objects (rule 3) are always REPORTED; deleted only with
 * ?wrong_size=delete (opt-in until a live dry run confirms CHUNK_SIZE).
 *
 * Dock rule (SR §S3(b)): purged_at is written ONLY when this run made the
 * not-consumed → consumed transition. Any other removal deletes the entry.
 * Dry runs write nothing. Delete order: chunks → hashes → manifest.
 * date-seal.ots.enc is deleted on every path that removes a transfer.
 *
 * Query params:
 *   ?dry_run=false        — execute (default true)
 *   ?stale_hours=N        — stale threshold, hours (default/min 168)
 *   ?limit=N              — max UUIDs inspected (default 200, max 500)
 *   ?wrong_size=delete    — also delete wrong-size objects (default: report)
 *
 * At most ACTION_CAP (25) transfers are acted on per run (Workers subrequest
 * budget); `summary.action_capped` says if more remain — run again.
 * Admin-key auth is checked before any R2 access.
 */

import { err, json } from '../utils.js';
import {
  IN_FLIGHT_CUTOFF_SECONDS, MIN_STALE_HOURS, ACTION_CAP, SWEEP_PROTECTED_UUIDS,
  toSeconds, wrongSizeSegments, isPurgeableExpired,
  deleteGroups, settleDockEntry, purgeExpiredTransfer,
} from '../sweep_rules.js';

const SWEEP_LIMIT_DEFAULT = 200;
const SWEEP_LIMIT_MAX     = 500;

const UUID_PREFIX_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

const chunkKeys   = (uuid, segs) => segs.map(s => `${uuid}/${s}`);
const sidecarKeys = (uuid, e) => [...(e.hasHashes ? [`${uuid}/hashes`] : []), `${uuid}/date-seal.ots.enc`];
const groupSize   = (groups) => groups.reduce((n, g) => n + g.length, 0);

export async function handleOrphanSweep(request, env) {
  // ── Admin-key auth ──────────────────────────────────────────────────────────
  const adminKey = request.headers.get('X-Admin-Key') ?? '';
  if (!adminKey || !env.ADMIN_KEY || adminKey !== env.ADMIN_KEY) {
    return err(401, 'Unauthorised');
  }

  // ── Query params ────────────────────────────────────────────────────────────
  const url        = new URL(request.url);
  const dryRun     = url.searchParams.get('dry_run') !== 'false'; // must opt in to deletion
  const staleHours = Math.max(MIN_STALE_HOURS,
    parseInt(url.searchParams.get('stale_hours') ?? String(MIN_STALE_HOURS), 10) || MIN_STALE_HOURS);
  const limitParam = parseInt(url.searchParams.get('limit') ?? String(SWEEP_LIMIT_DEFAULT), 10) || SWEEP_LIMIT_DEFAULT;
  const limit      = Math.min(Math.max(1, limitParam), SWEEP_LIMIT_MAX);
  const wrongSizeDelete = url.searchParams.get('wrong_size') === 'delete';

  const now            = Math.floor(Date.now() / 1000);
  const staleThreshold = now - staleHours * 3600;
  const orphanCutoff   = now - IN_FLIGHT_CUTOFF_SECONDS;

  // ── Phase 1: page all R2 objects, group by UUID prefix ─────────────────────
  // uuid → { chunks: Map<"0000",{size,uploaded}>, hasManifest, hasHashes, hasSeal, lastActivity }
  const byUuid = new Map();
  let objectsScanned = 0;
  let cursor;

  do {
    let page;
    try {
      page = await env.BUCKET.list(cursor ? { limit: 1000, cursor } : { limit: 1000 });
    } catch (e) {
      console.error('orphan_sweep: R2 list() failed:', e);
      return err(502, 'Storage list failed');
    }

    for (const obj of page.objects) {
      objectsScanned++;
      const m = UUID_PREFIX_RE.exec(obj.key);
      if (!m) continue;

      const uuid    = m[1].toLowerCase();
      const segment = obj.key.slice(uuid.length + 1);
      if (!byUuid.has(uuid)) {
        byUuid.set(uuid, { chunks: new Map(), hasManifest: false, hasHashes: false, hasSeal: false, lastActivity: 0 });
      }
      const e  = byUuid.get(uuid);
      const up = toSeconds(obj.uploaded, now); // unknown timestamp → "fresh" → never swept
      e.lastActivity = Math.max(e.lastActivity, up);

      if (/^\d{4}$/.test(segment))            e.chunks.set(segment, { size: obj.size ?? 0, uploaded: up });
      else if (segment === 'manifest.json')   e.hasManifest = true;
      else if (segment === 'hashes')          e.hasHashes   = true;
      else if (segment === 'date-seal.ots.enc') e.hasSeal   = true;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  // ── Phase 2: classify each UUID and build the action plan ──────────────────
  const uuids        = [...byUuid.keys()];
  const uuidsToCheck = uuids.slice(0, limit);
  const result = {
    complete: 0, protected: 0,
    incomplete: [], stale: [], orphan_chunks: [], sidecar_only: [],
    expired: [], tombstone_residue: [], wrong_size: [],
  };
  const plan = []; // { kind, uuid, groups: string[][], dock: 'mark'|'remove'|null, transfer: bool }

  for (const uuid of uuidsToCheck) {
    if (SWEEP_PROTECTED_UUIDS.has(uuid)) { result.protected++; continue; }

    const e         = byUuid.get(uuid);
    const segs      = [...e.chunks.keys()].sort();
    const hasChunks = segs.length > 0;

    // No manifest at all.
    if (!e.hasManifest) {
      if (hasChunks) {
        // Rule 2: only chunk objects older than UPLOAD_WINDOW + 1 d are deletable.
        const old = segs.filter(s => e.chunks.get(s).uploaded < orphanCutoff);
        result.orphan_chunks.push({ uuid, chunk_count: segs.length, deletable_chunks: old.length });
        if (old.length) plan.push({ kind: 'orphan_chunks', uuid, groups: [chunkKeys(uuid, old)], dock: null, transfer: false });
      } else if ((e.hasHashes || e.hasSeal) && e.lastActivity < orphanCutoff) {
        result.sidecar_only.push({ uuid });
        plan.push({ kind: 'sidecar_only', uuid, groups: [sidecarKeys(uuid, e)], dock: 'remove', transfer: true });
      }
      continue;
    }

    let manifest = null;
    try {
      const obj = await env.BUCKET.get(`${uuid}/manifest.json`);
      if (obj) manifest = await obj.json();
    } catch (err_) {
      console.error(`orphan_sweep: manifest read failed for ${uuid}:`, err_);
      continue;
    }
    if (!manifest) continue;

    const noteWrongSize = () => {
      const bad = wrongSizeSegments(e.chunks, manifest.total_chunks);
      if (!bad.length) return;
      result.wrong_size.push({ uuid, count: bad.length });
      if (wrongSizeDelete) plan.push({ kind: 'wrong_size', uuid, groups: [chunkKeys(uuid, bad)], dock: null, transfer: false });
    };

    // Rule 1: tombstoned UUID — residue is always deletable; the tombstone stays.
    if (manifest.consumed === true) {
      if (hasChunks || e.hasHashes || e.hasSeal) {
        result.tombstone_residue.push({ uuid, chunk_count: segs.length });
        plan.push({ kind: 'tombstone_residue', uuid, groups: [chunkKeys(uuid, segs), sidecarKeys(uuid, e)], dock: 'remove', transfer: true });
      }
      continue;
    }

    // Finalised.
    if (manifest.upload_complete === true) {
      result.complete++;
      if (isPurgeableExpired(manifest, now)) {
        result.expired.push({ uuid, expiry_timestamp: manifest.expiry_timestamp, chunk_count: segs.length });
        plan.push({ kind: 'expired', uuid, groups: [chunkKeys(uuid, segs), sidecarKeys(uuid, e)], dock: 'mark', transfer: true });
      } else {
        noteWrongSize();
      }
      continue;
    }

    // Not finalised: in flight until BOTH created_at and last R2 activity pass the threshold.
    const createdAt = manifest.created_at ?? manifest.initiated_at ?? null;
    const dead      = createdAt !== null && createdAt < staleThreshold && e.lastActivity < staleThreshold;
    const detail    = {
      uuid, created_at: createdAt, chunk_count: segs.length,
      total_chunks: manifest.total_chunks ?? null, expiry_timestamp: manifest.expiry_timestamp ?? null,
    };
    const manifestGroup = [`${uuid}/manifest.json`]; // deleted last, always

    if (!dead) { result.incomplete.push(detail); noteWrongSize(); continue; }

    if (!hasChunks && !e.hasHashes) {
      result.sidecar_only.push({ uuid });
      plan.push({ kind: 'sidecar_only', uuid, groups: [sidecarKeys(uuid, e), manifestGroup], dock: 'remove', transfer: true });
    } else {
      result.stale.push(detail);
      plan.push({ kind: 'stale', uuid, groups: [chunkKeys(uuid, segs), sidecarKeys(uuid, e), manifestGroup], dock: 'remove', transfer: true });
    }
  }

  // ── Phase 3: execute (dry_run=false only) ───────────────────────────────────
  const tally = { deleted: 0, purged: 0, marked: 0, removed: 0, skipped: 0, capped: false };

  if (!dryRun) {
    let acted = 0;
    for (const a of plan) {
      if (a.transfer) {
        if (acted >= ACTION_CAP) { tally.capped = true; continue; }
        acted++;
      }

      if (a.kind === 'expired') {
        const r = await purgeExpiredTransfer(env, a.uuid, a.groups, now);
        tally.deleted += r.deleted;
        if (r.status === 'purged') tally.purged++; else tally.skipped++;
        if (r.dock === 'marked')  tally.marked++;
        if (r.dock === 'removed') tally.removed++;
        continue;
      }

      const n = await deleteGroups(env.BUCKET, a.groups);
      tally.deleted += n;
      // Only unhook the dock entry once the whole transfer is really gone.
      if (a.dock === 'remove' && n === groupSize(a.groups)) {
        const d = await settleDockEntry(env.STATUS_KV, a.uuid, { mark: false, nowSeconds: now });
        if (d === 'removed') tally.removed++;
      }
    }
  }

  return json({
    swept_at:        now,
    dry_run:         dryRun,
    objects_scanned: objectsScanned,
    uuids_found:     uuids.length,
    limit_applied:   limit,
    stale_hours:     staleHours,
    wrong_size_delete: wrongSizeDelete,
    summary: {
      complete:            result.complete,
      incomplete:          result.incomplete.length,
      stale:               result.stale.length,
      orphan_chunks:       result.orphan_chunks.length,
      sidecar_only:        result.sidecar_only.length,
      expired_purgeable:   result.expired.length,
      tombstone_residue:   result.tombstone_residue.length,
      wrong_size:          result.wrong_size.length,
      protected:           result.protected,
      would_delete_objects: plan.reduce((n, a) => n + groupSize(a.groups), 0),
      deleted_objects:     tally.deleted,
      purged:              tally.purged,
      purge_skipped:       tally.skipped,
      dock_marked:         tally.marked,
      dock_removed:        tally.removed,
      action_capped:       tally.capped,
    },
    stale:             result.stale,
    orphan_chunks:     result.orphan_chunks,
    sidecar_only:      result.sidecar_only,
    expired:           result.expired,
    tombstone_residue: result.tombstone_residue,
    wrong_size:        result.wrong_size,
  });
}
