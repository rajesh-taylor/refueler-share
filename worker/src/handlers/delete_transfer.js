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
import { UUID_RE, safeGetManifest, json, err } from '../utils.js';

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

  if (manifest.consumed === true) {
    return err(410, 'Transfer has already been destroyed');
  }

  const { valid, uuid: tokenUuid } = await verifyDownloadToken(bearerToken, env.MINT_PRIVATE_KEY);
  if (!valid || tokenUuid !== uuid) {
    return err(403, 'Not authorised to destroy this transfer');
  }

  const nowSeconds   = Math.floor(Date.now() / 1000);
  const totalChunks  = manifest.total_chunks ?? 0;

  await putManifest(env.BUCKET, uuid, { ...manifest, consumed: true, consumed_at: nowSeconds });

  const deleteErrors = [];
  for (let i = 0; i < totalChunks; i++) {
    try {
      await env.BUCKET.delete(`${uuid}/${String(i).padStart(4, '0')}`);
    } catch (e) {
      console.error(`TG: chunk delete failed at index ${i}:`, e);
      deleteErrors.push(i);
    }
  }

  env.BUCKET.delete(`${uuid}/date-seal.ots.enc`).catch(e =>
    console.error('TH-1: date-seal.ots.enc delete failed (bearer path):', e)
  );

  const tombstone = buildTombstone(nowSeconds);
  await putManifest(env.BUCKET, uuid, tombstone);

  return json({
    destroyed:   true,
    consumed_at: nowSeconds,
    ...(deleteErrors.length > 0 ? { partial: true, failed_chunks: deleteErrors } : {}),
  });
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

  if (manifest.consumed === true) {
    return err(410, 'Transfer has already been destroyed');
  }

  const nowSeconds  = Math.floor(Date.now() / 1000);
  const totalChunks = manifest.total_chunks ?? 0;

  await putManifest(env.BUCKET, uuid, { ...manifest, consumed: true, consumed_at: nowSeconds });

  const deleteErrors = [];
  for (let i = 0; i < totalChunks; i++) {
    try {
      await env.BUCKET.delete(`${uuid}/${String(i).padStart(4, '0')}`);
    } catch (e) {
      console.error(`TG owner delete: chunk delete failed at index ${i}:`, e);
      deleteErrors.push(i);
    }
  }

  env.BUCKET.delete(`${uuid}/date-seal.ots.enc`).catch(e =>
    console.error('TH-1: date-seal.ots.enc delete failed (owner path):', e)
  );

  const tombstone = buildTombstone(nowSeconds);
  await putManifest(env.BUCKET, uuid, tombstone);

  env.STATUS_KV.delete(`dock_index:${uuid}`).catch(e =>
    console.error('Execution Dock KV delete failed:', e)
  );

  return json({
    destroyed:   true,
    consumed_at: nowSeconds,
    ...(deleteErrors.length > 0 ? { partial: true, failed_chunks: deleteErrors } : {}),
  });
}
