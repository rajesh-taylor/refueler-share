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

import { err, json, requireAdmin, safeGetManifest } from '../utils.js';
import { destroyTransfer } from './delete_transfer.js';

const UUID_PREFIX_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

export async function handlePurgeTestTransfers(request, env) {
  // ── Admin-key auth ──────────────────────────────────────────────────────────
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

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
      console.error(`purge_test_transfers: manifest read failed for ${String(uuid).slice(0, 8)}:`, e);
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
      // B12-3: the shared destruction (delete_transfer.js) — latch, quota
      // release by the winner, batched deletes, tombstone last. The manifest
      // now stays as a tombstone (it was deleted outright before), the same
      // end state as every other deletion path.
      try {
        const { manifest } = await safeGetManifest(env.BUCKET, uuid, env);
        if (manifest) {
          const before = (entry?.chunks.size ?? 0) + (entry?.hasHashes ? 1 : 0);
          const r = await destroyTransfer(env, uuid, manifest, Math.floor(Date.now() / 1000), 'purge_test');
          deletedHere = r?.destroyed ? before : 0;
        }
      } catch (e) {
        console.error(`purge_test_transfers: destroy failed for ${String(uuid).slice(0, 8)}:`, e);
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
