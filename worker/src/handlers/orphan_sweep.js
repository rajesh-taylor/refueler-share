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
 * This is a DRY-RUN endpoint — it NEVER deletes anything. Deletion is Share-6-6b
 * scope. The report is safe to run at any time.
 *
 * Query params:
 *   ?stale_hours=N   — how old (in hours) an incomplete transfer must be before
 *                      it is flagged as stale vs in-flight (default: 24).
 *   ?limit=N         — max UUIDs to inspect (default: 200, max: 500). Applied
 *                      after grouping; the R2 list() pages the full bucket.
 *
 * Response shape (200):
 * {
 *   swept_at:         number,   // Unix timestamp
 *   objects_scanned:  number,   // total R2 objects seen
 *   uuids_found:      number,   // distinct UUID prefixes
 *   limit_applied:    number,   // effective ?limit
 *   stale_hours:      number,   // effective ?stale_hours
 *   summary: {
 *     complete:      number,
 *     incomplete:    number,    // in-flight or stalled (not yet stale)
 *     stale:         number,    // incomplete AND older than stale_hours
 *     orphan_chunks: number,
 *     sidecar_only:  number,
 *   },
 *   stale: [                    // incomplete transfers older than stale_hours
 *     { uuid, created_at, chunk_count, expiry_timestamp }, ...
 *   ],
 *   orphan_chunks: [            // chunks with no manifest
 *     { uuid, chunk_count }, ...
 *   ],
 *   sidecar_only: [             // manifest/hashes but no chunks
 *     { uuid }, ...
 *   ],
 * }
 *
 * Notes:
 *   - complete transfers are counted but NOT listed (may be large; dashboard
 *     consumption of this endpoint drives the design).
 *   - Non-UUID prefixes (e.g. bare keys with no slash) are counted in
 *     objects_scanned but silently ignored in grouping.
 *   - The sweep uses list() only — no manifest reads for complete transfers
 *     (we check presence of manifest.json key). For stale/orphan candidates,
 *     the manifest IS read to get created_at and upload_complete.
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
  const staleHours = Math.max(1, parseInt(url.searchParams.get('stale_hours') ?? String(ORPHAN_GRACE_DEFAULT_HOURS), 10) || ORPHAN_GRACE_DEFAULT_HOURS);
  const limitParam = parseInt(url.searchParams.get('limit') ?? String(SWEEP_LIMIT_DEFAULT), 10) || SWEEP_LIMIT_DEFAULT;
  const limit      = Math.min(Math.max(1, limitParam), SWEEP_LIMIT_MAX);
  const staleThreshold = Math.floor(Date.now() / 1000) - staleHours * 3600;

  // ── Phase 1: page all R2 objects, group by UUID prefix ─────────────────────
  //
  // Each UUID prefix accumulates a lightweight descriptor:
  //   { chunks: Set<string>, hasManifest: bool, hasHashes: bool }
  //
  // We collect chunk segments matching /^\d{4}$/ and presence of the two
  // non-chunk objects (manifest.json, hashes). No other keys exist under a
  // valid UUID prefix in the current schema.
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
      if (!m) continue; // bare key or non-UUID prefix — skip

      const uuid    = m[1].toLowerCase();
      const segment = obj.key.slice(uuid.length + 1); // strip "uuid/"

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
      // Any other segment (e.g. future schema additions) is silently ignored.
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  // ── Phase 2: classify each UUID ─────────────────────────────────────────────
  //
  // For UUIDs with a manifest, read the manifest to check upload_complete +
  // created_at. We only read manifests for non-complete candidates (orphan or
  // incomplete) — complete transfers are classified by list() signal alone.
  //
  // Manifest reads are I/O — cap to `limit` UUIDs to bound latency. UUIDs
  // beyond the limit are not classified and not returned in any list; the
  // summary counts only what was classified.
  const uuids         = [...byUuid.keys()];
  const uuidsFound    = uuids.length;
  const uuidsToCheck  = uuids.slice(0, limit);

  const result = {
    complete:      0,
    incomplete:    [],  // in-flight
    stale:         [],  // incomplete AND older than stale_hours
    orphan_chunks: [],  // chunks, no manifest
    sidecar_only:  [],  // manifest/hashes, no chunks
  };

  for (const uuid of uuidsToCheck) {
    const entry = byUuid.get(uuid);
    const hasChunks = entry.chunks.size > 0;

    // ── No manifest present ────────────────────────────────────────────────
    if (!entry.hasManifest) {
      if (hasChunks) {
        // Chunks exist but no manifest — orphan chunk objects.
        result.orphan_chunks.push({ uuid, chunk_count: entry.chunks.size });
      } else if (entry.hasHashes) {
        // Hashes sidecar with no manifest and no chunks — unusual; classify.
        result.sidecar_only.push({ uuid });
      }
      // else: nothing meaningful (should not occur — no objects would mean
      // the UUID wouldn't be in byUuid). Skip silently.
      continue;
    }

    // ── Manifest present — read it ─────────────────────────────────────────
    let manifest = null;
    try {
      const obj = await env.BUCKET.get(`${uuid}/manifest.json`);
      if (obj) manifest = await obj.json();
    } catch (e) {
      console.error(`orphan_sweep: manifest read failed for ${uuid}:`, e);
      // Count as unknown — skip rather than misclassify.
      continue;
    }

    if (!manifest) continue; // race: disappeared between list and get

    if (manifest.upload_complete === true) {
      result.complete++;
      continue;
    }

    // ── Incomplete: manifest present but upload_complete !== true ──────────
    const createdAt = manifest.created_at ?? manifest.initiated_at ?? null;

    if (!hasChunks && !entry.hasHashes) {
      // Manifest only — no chunks, no sidecar. Initiated but nothing uploaded.
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

  return json({
    swept_at:        Math.floor(Date.now() / 1000),
    objects_scanned: objectsScanned,
    uuids_found:     uuidsFound,
    limit_applied:   limit,
    stale_hours:     staleHours,
    summary: {
      complete:      result.complete,
      incomplete:    result.incomplete.length,
      stale:         result.stale.length,
      orphan_chunks: result.orphan_chunks.length,
      sidecar_only:  result.sidecar_only.length,
    },
    stale:         result.stale,
    orphan_chunks: result.orphan_chunks,
    sidecar_only:  result.sidecar_only,
  });
}
