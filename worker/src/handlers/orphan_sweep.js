/**
 * orphan_sweep.js — GET /admin/orphan-sweep
 * worker/src/handlers/orphan_sweep.js
 *
 * Share-6-6a: admin-key-gated orphan-object audit. Pages all R2 objects in the
 * bucket via list(), groups by UUID prefix, and classifies each transfer UUID
 * into one of four states:
 *
 *   complete      — manifest present, upload_complete: true
 *   incomplete    — manifest present, upload_complete !== true; may be in-flight
 *                   or stalled (created_at older than ORPHAN_GRACE_SECONDS)
 *   orphan_chunks — R2 chunks present but NO manifest.json found at all;
 *                   presigned-PUT transfers that never reached /initiate, or
 *                   whose manifest was deleted but chunks were not
 *   sidecar_only  — only {uuid}/hashes or {uuid}/manifest.json present; no
 *                   numbered chunks (e.g. upload aborted after initiate)
 *
 * Share-6-6b: adds ?dry_run param. When dry_run=false, deletes the R2 objects
 * for:
 *   - stale transfers (incomplete AND older than stale_hours)
 *   - sidecar_only transfers (manifest/hashes but no chunks)
 *
 * orphan_chunks are deliberately NEVER deleted by this endpoint — a presigned-PUT
 * transfer may still be in flight when the sweep runs. Chunks without a manifest
 * indicate the /initiate request may have been lost in transit; deleting them
 * would corrupt an in-progress upload. Schedule a dedicated orphan-chunk TTL
 * sweep once direct-R2 upload history is mature enough to set a safe threshold.
 *
 * complete transfers are never touched.
 *
 * Query params:
 *   ?dry_run=false — actually delete stale + sidecar_only objects (default: true)
 *   ?stale_hours=N — how old (in hours) an incomplete transfer must be before
 *                    it is flagged as stale vs in-flight (default: 24).
 *   ?limit=N       — max UUIDs to inspect (default: 200, max: 500). Applied
 *                    after grouping; the R2 list() pages the full bucket.
 *
 * Response shape (200):
 * {
 *   swept_at:         number,   // Unix timestamp
 *   dry_run:          boolean,  // whether deletion was suppressed
 *   objects_scanned:  number,   // total R2 objects seen
 *   uuids_found:      number,   // distinct UUID prefixes
 *   limit_applied:    number,   // effective ?limit
 *   stale_hours:      number,   // effective ?stale_hours
 *   summary: {
 *     complete:      number,
 *     incomplete:    number,    // in-flight or stalled (not yet stale)
 *     stale:         number,
 *     orphan_chunks: number,
 *     sidecar_only:  number,
 *     deleted_objects: number,  // 0 on dry_run=true
 *   },
 *   stale: [                    // incomplete transfers older than stale_hours
 *     { uuid, created_at, chunk_count, expiry_timestamp }, ...
 *   ],
 *   orphan_chunks: [            // chunks with no manifest (never deleted)
 *     { uuid, chunk_count }, ...
 *   ],
 *   sidecar_only: [             // manifest/hashes but no chunks
 *     { uuid }, ...
 *   ],
 * }
 *
 * Notes:
 *   - complete transfers are counted but NOT listed (may be large).
 *   - Non-UUID prefixes (e.g. bare keys with no slash) are counted in
 *     objects_scanned but silently ignored in grouping.
 *   - The sweep uses list() only for classification, then reads manifests only
 *     for stale/orphan candidates.
 *   - Deletion is best-effort per object. A failed individual delete is logged
 *     but does not abort the sweep — partial deletion is reported in the
 *     deleted_objects count.
 *   - Admin-key auth is checked before any R2 access.
 */

import { UUID_RE, err, json } from '../utils.js';

const ORPHAN_GRACE_DEFAULT_HOURS = 24;
const SWEEP_LIMIT_DEFAULT        = 200;
const SWEEP_LIMIT_MAX            = 500;

// UUID_RE matches a 36-char lowercase RFC4122 UUID.
// Key pattern for a transfer: {uuid}/0000 · {uuid}/manifest.json · {uuid}/hashes
// The prefix segment before the first '/' must be a valid UUID.
const UUID_PREFIX_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

export async function handleOrphanSweep(request, env) {
  // ── Admin-key auth ──────────────────────────────────────────────────────────
  const adminKey = request.headers.get('X-Admin-Key') ?? '';
  if (!adminKey || !env.ADMIN_KEY || adminKey !== env.ADMIN_KEY) {
    return err(401, 'Unauthorised');
  }

  // ── Query params ────────────────────────────────────────────────────────────
  const url        = new URL(request.url);
  const dryRun     = url.searchParams.get('dry_run') !== 'false'; // default true — must opt in to deletion
  const staleHours = Math.max(1, parseInt(url.searchParams.get('stale_hours') ?? String(ORPHAN_GRACE_DEFAULT_HOURS), 10) || ORPHAN_GRACE_DEFAULT_HOURS);
  const limitParam = parseInt(url.searchParams.get('limit') ?? String(SWEEP_LIMIT_DEFAULT), 10) || SWEEP_LIMIT_DEFAULT;
  const limit      = Math.min(Math.max(1, limitParam), SWEEP_LIMIT_MAX);
  const staleThreshold = Math.floor(Date.now() / 1000) - staleHours * 3600;

  // ── Phase 1: page all R2 objects, group by UUID prefix ─────────────────────
  //
  // Each UUID prefix accumulates a lightweight descriptor:
  //   { chunks: Set<string>, hasManifest: bool, hasHashes: bool }
  const byUuid = new Map(); // uuid → { chunks: Set, hasManifest, hasHashes }
  let objectsScanned = 0;
  let cursor;

  do {
    let page;
    try {
      const opts = cursor ? { limit: 1000, cursor } : { limit: 1000 };
      page = await env.BUCKET.list(opts);
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
        byUuid.set(uuid, { chunks: new Set(), hasManifest: false, hasHashes: false });
      }
      const entry = byUuid.get(uuid);

      if (/^\d{4}$/.test(segment)) {
        entry.chunks.add(segment);
      } else if (segment === 'manifest.json') {
        entry.hasManifest = true;
      } else if (segment === 'hashes') {
        entry.hasHashes = true;
      }
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  // ── Phase 2: classify each UUID ─────────────────────────────────────────────
  const uuids         = [...byUuid.keys()];
  const uuidsFound    = uuids.length;
  const uuidsToCheck  = uuids.slice(0, limit);

  const result = {
    complete:      0,
    incomplete:    [],
    stale:         [],
    orphan_chunks: [],
    sidecar_only:  [],
  };

  for (const uuid of uuidsToCheck) {
    const entry = byUuid.get(uuid);
    const hasChunks = entry.chunks.size > 0;

    if (!entry.hasManifest) {
      if (hasChunks) {
        result.orphan_chunks.push({ uuid, chunk_count: entry.chunks.size });
      } else if (entry.hasHashes) {
        result.sidecar_only.push({ uuid });
      }
      continue;
    }

    let manifest = null;
    try {
      const obj = await env.BUCKET.get(`${uuid}/manifest.json`);
      if (obj) manifest = await obj.json();
    } catch (e) {
      console.error(`orphan_sweep: manifest read failed for ${uuid}:`, e);
      continue;
    }

    if (!manifest) continue;

    if (manifest.upload_complete === true) {
      result.complete++;
      continue;
    }

    const createdAt = manifest.created_at ?? manifest.initiated_at ?? null;

    if (!hasChunks && !entry.hasHashes) {
      result.sidecar_only.push({ uuid });
      continue;
    }

    const entry_data = {
      uuid,
      created_at:        createdAt,
      chunk_count:       entry.chunks.size,
      total_chunks:      manifest.total_chunks ?? null,
      expiry_timestamp:  manifest.expiry_timestamp ?? null,
    };

    if (createdAt !== null && createdAt < staleThreshold) {
      result.stale.push(entry_data);
    } else {
      result.incomplete.push(entry_data);
    }
  }

  // ── Phase 3: deletion (dry_run=false only) ─────────────────────────────────
  //
  // Deletes R2 objects for stale + sidecar_only transfers only.
  // orphan_chunks: deliberately skipped — chunks may still be in flight via a
  //   presigned PUT. Safe to delete only once a manifest-based TTL is established.
  // complete: never touched.
  //
  // Deletion is per-object, best-effort. A single delete failure is logged and
  // counted but does not abort the sweep.
  let deletedObjects = 0;

  if (!dryRun) {
    // ── Delete stale transfers (manifest + optional chunks + optional hashes) ──
    for (const entry of result.stale) {
      const { uuid } = entry;
      const uuidEntry = byUuid.get(uuid);

      // Chunks
      for (const chunkSeg of (uuidEntry?.chunks ?? [])) {
        const key = `${uuid}/${chunkSeg}`;
        try {
          await env.BUCKET.delete(key);
          deletedObjects++;
        } catch (e) {
          console.error(`orphan_sweep: delete failed for ${key}:`, e);
        }
      }

      // Hashes sidecar
      if (uuidEntry?.hasHashes) {
        const key = `${uuid}/hashes`;
        try {
          await env.BUCKET.delete(key);
          deletedObjects++;
        } catch (e) {
          console.error(`orphan_sweep: delete failed for ${key}:`, e);
        }
      }

      // Manifest — delete last so a partial failure leaves the manifest in place
      // for the next sweep run to re-classify rather than producing orphan_chunks.
      const manifestKey = `${uuid}/manifest.json`;
      try {
        await env.BUCKET.delete(manifestKey);
        deletedObjects++;
      } catch (e) {
        console.error(`orphan_sweep: delete failed for ${manifestKey}:`, e);
      }
    }

    // ── Delete sidecar_only transfers (manifest and/or hashes, no chunks) ────
    // These are safe to delete: no chunks means no in-flight presigned PUTs.
    for (const entry of result.sidecar_only) {
      const { uuid } = entry;
      const uuidEntry = byUuid.get(uuid);

      if (uuidEntry?.hasManifest) {
        const key = `${uuid}/manifest.json`;
        try {
          await env.BUCKET.delete(key);
          deletedObjects++;
        } catch (e) {
          console.error(`orphan_sweep: delete failed for ${key}:`, e);
        }
      }

      if (uuidEntry?.hasHashes) {
        const key = `${uuid}/hashes`;
        try {
          await env.BUCKET.delete(key);
          deletedObjects++;
        } catch (e) {
          console.error(`orphan_sweep: delete failed for ${key}:`, e);
        }
      }
    }
  }

  return json({
    swept_at:        Math.floor(Date.now() / 1000),
    dry_run:         dryRun,
    objects_scanned: objectsScanned,
    uuids_found:     uuidsFound,
    limit_applied:   limit,
    stale_hours:     staleHours,
    summary: {
      complete:        result.complete,
      incomplete:      result.incomplete.length,
      stale:           result.stale.length,
      orphan_chunks:   result.orphan_chunks.length,
      sidecar_only:    result.sidecar_only.length,
      deleted_objects: deletedObjects,
    },
    stale:         result.stale,
    orphan_chunks: result.orphan_chunks,
    sidecar_only:  result.sidecar_only,
  });
}
