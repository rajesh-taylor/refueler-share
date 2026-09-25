// worker/src/handlers/delete_transfer.js
//
// SW9a — Extracted from index.js (Phase 3b).
// TG-block: handleDeleteTransfer — DELETE /transfer/:uuid (bearer path)
//           handleOwnerDelete    — DELETE /transfer/:uuid (admin key path / Execution Dock)
//
// All imports from ../utils.js — never from ../index.js.

import { buildTombstone }                      from '../manifest_tg.js';
import { putManifest }                         from '../manifest.js';
import { verifyDownloadToken }                 from '../nut11.js';
import { deleteKeys }                          from '../sweep_rules.js';
import { UUID_RE, safeGetManifest, json, err } from '../utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared destruction sequence (both delete paths).
//
// State machine on the manifest:
//   live        — consumed !== true
//   in progress — consumed === true AND total_chunks still present (guard written,
//                 tombstone not yet). A delete that died mid-loop lands here and
//                 is RESUMED, not refused.
//   tombstone   — consumed === true, no total_chunks. Terminal → 410.
//
// Everything under {uuid}/ except manifest.json is listed and deleted in R2
// batches (1000 keys per call), so an 8,000-chunk transfer is 8 subrequests
// and stray chunks / hashes / date-seal all go with it. The tombstone is written
// LAST and only if every batch succeeded; otherwise the response is partial and
// the manifest stays in-progress so a retry resumes.
// ─────────────────────────────────────────────────────────────────────────────
const isTombstone = (m) => m.consumed === true && !Number.isFinite(m.total_chunks);

async function destroyTransfer(env, uuid, manifest, nowSeconds, logTag) {
  const consumedAt = manifest.consumed === true ? (manifest.consumed_at ?? nowSeconds) : nowSeconds;

  if (manifest.consumed !== true) {
    await putManifest(env.BUCKET, uuid, { ...manifest, consumed: true, consumed_at: consumedAt });
  }

  const prefix = `${uuid}/`;
  const keys   = [];
  let cursor;
  do {
    const page = await env.BUCKET.list(cursor ? { prefix, limit: 1000, cursor } : { prefix, limit: 1000 });
    for (const o of page.objects) if (o.key !== `${uuid}/manifest.json`) keys.push(o.key);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const deleted = await deleteKeys(env.BUCKET, keys);
  if (deleted < keys.length) {
    console.error(`${logTag}: ${keys.length - deleted} object(s) not deleted for ${uuid}; left in-progress for retry`);
    return { destroyed: false, consumed_at: consumedAt, partial: true, remaining: keys.length - deleted };
  }

  await env.STATUS_KV.delete(`root_verified:${uuid}`).catch(e =>
    console.error(`${logTag}: root_verified KV delete failed:`, e)
  );

  await putManifest(env.BUCKET, uuid, buildTombstone(consumedAt));

  // Share-B12-1 (B12 §0.3): every deletion path clears the index — absence is the trace.
  env.STATUS_KV.delete(`dock_index:${uuid}`).catch(e =>
    console.error(`${logTag}: Execution Dock KV delete failed:`, e)
  );

  return { destroyed: true, consumed_at: consumedAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete transfer — DELETE /transfer/:uuid  (TG-block)
//
// Two dispatch paths:
//   - Bearer rfs_owner_* → handleOwnerDelete (admin key / Execution Dock)
//   - Bearer rfs_* (standard download token) → bearer-verified recipient delete
// ─────────────────────────────────────────────────────────────────────────────
export async function handleDeleteTransfer(request, env, uuid) {
  const authHeader = request.headers.get('Authorization') ?? '';

  if (authHeader.startsWith('Bearer rfs_owner_')) {
    return handleOwnerDelete(request, env, uuid);
  }

  if (!authHeader.startsWith('Bearer ')) {
    return err(401, 'Authorization required');
  }

  const bearerToken = authHeader.slice(7);

  const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (oversize) return err(502, 'Transfer manifest exceeds size limit');
  if (!manifest) return err(404, 'Transfer not found');

  if (isTombstone(manifest)) {
    return err(410, 'Transfer has already been destroyed');
  }

  const { valid, uuid: tokenUuid } = await verifyDownloadToken(bearerToken, env.MINT_PRIVATE_KEY);
  if (!valid || tokenUuid !== uuid) {
    return err(403, 'Not authorised to destroy this transfer');
  }

  return json(await destroyTransfer(env, uuid, manifest, Math.floor(Date.now() / 1000), 'TG'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner delete — admin-keyed forced deletion (TG-4)
//
// Called when Authorization header starts with 'Bearer rfs_owner_'.
// Validates X-Admin-Key, then performs a forced tombstone regardless of
// transfer state (pending_destruction flag, tidal window, etc.).
// Clears the dock_index KV entry used by the Execution Dock dashboard.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleOwnerDelete(request, env, uuid) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return err(401, 'Unauthorised');
  }

  const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (oversize) return err(502, 'Transfer manifest exceeds size limit');
  if (!manifest) return err(404, 'Transfer not found');

  if (isTombstone(manifest)) {
    return err(410, 'Transfer has already been destroyed');
  }

  return json(await destroyTransfer(env, uuid, manifest, Math.floor(Date.now() / 1000), 'TG owner delete'));
}
