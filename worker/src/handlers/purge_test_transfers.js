/**
 * purge_test_transfers.js — DELETE /admin/purge-test-transfers
 * worker/src/handlers/purge_test_transfers.js
 *
 * Admin-key-gated endpoint to delete ALL complete transfers from R2.
 * Intended for post-build cleanup of test uploads — never run against
 * a bucket that holds real user data.
 *
 * Deletes: chunks + hashes sidecar + manifest.json for each complete UUID.
 * Never touches: incomplete / stale / orphan_chunks / sidecar_only UUIDs
 * (use orphan_sweep for those).
 *
 * Query params:
 *   ?dry_run=false — actually delete (default: true — report only)
 *
 * Response shape (200):
 * {
 *   purged_at:        number,   // Unix timestamp
 *   dry_run:          boolean,
 *   objects_scanned:  number,
 *   complete_found:   number,   // UUIDs with upload_complete: true
 *   deleted_objects:  number,   // 0 on dry_run
 *   uuids: [{ uuid, chunk_count, deleted_objects }]
 * }
 */

import { err, json } from '../utils.js';

const UUID_PREFIX_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

export async function handlePurgeTestTransfers(request, env) {
  // ── Admin-key auth ──────────────────────────────────────────────────────────
  const adminKey = request.headers.get('X-Admin-Key') ?? '';
  if (!adminKey || !env.ADMIN_KEY || adminKey !== env.ADMIN_KEY) {
    return err(401, 'Unauthorised');
  }

  const url    = new URL(request.url);
  const dryRun = url.searchParams.get('dry_run') !== 'false'; // default true

  // ── Phase 1: page all R2 objects, group by UUID prefix ─────────────────────
  const byUuid = new Map(); // uuid → { chunks: Set<string>, hasManifest, hasHashes }
  let objectsScanned = 0;
  let cursor;

  do {
    let page;
    try {
      const opts = cursor ? { limit: 1000, cursor } : { limit: 1000 };
      page = await env.BUCKET.list(opts);
    } catch (e) {
      console.error('purge_test_transfers: R2 list() failed:', e);
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

  // ── Phase 2: identify complete UUIDs only ──────────────────────────────────
  const completeUuids = [];

  for (const [uuid, entry] of byUuid) {
    if (!entry.hasManifest) continue;

    let manifest = null;
    try {
      const obj = await env.BUCKET.get(`${uuid}/manifest.json`);
      if (obj) manifest = await obj.json();
    } catch (e) {
      console.error(`purge_test_transfers: manifest read failed for ${uuid}:`, e);
      continue;
    }

    if (manifest?.upload_complete === true) {
      completeUuids.push(uuid);
    }
  }

  // ── Phase 3: delete (dry_run=false only) ──────────────────────────────────
  let totalDeleted = 0;
  const uuidResults = [];

  for (const uuid of completeUuids) {
    const entry = byUuid.get(uuid);
    let deletedHere = 0;

    if (!dryRun) {
      // Chunks first
      for (const chunkSeg of (entry?.chunks ?? [])) {
        const key = `${uuid}/${chunkSeg}`;
        try {
          await env.BUCKET.delete(key);
          deletedHere++;
        } catch (e) {
          console.error(`purge_test_transfers: delete failed for ${key}:`, e);
        }
      }

      // Hashes sidecar
      if (entry?.hasHashes) {
        try {
          await env.BUCKET.delete(`${uuid}/hashes`);
          deletedHere++;
        } catch (e) {
          console.error(`purge_test_transfers: delete failed for ${uuid}/hashes:`, e);
        }
      }

      // Manifest last
      try {
        await env.BUCKET.delete(`${uuid}/manifest.json`);
        deletedHere++;
      } catch (e) {
        console.error(`purge_test_transfers: delete failed for ${uuid}/manifest.json:`, e);
      }

      totalDeleted += deletedHere;
    }

    uuidResults.push({
      uuid,
      chunk_count:     entry?.chunks.size ?? 0,
      deleted_objects: deletedHere,
    });
  }

  return json({
    purged_at:       Math.floor(Date.now() / 1000),
    dry_run:         dryRun,
    objects_scanned: objectsScanned,
    complete_found:  completeUuids.length,
    deleted_objects: totalDeleted,
    uuids:           uuidResults,
  });
}
