/**
 * delete_transfer.js — DELETE /transfer/{uuid}
 *
 * Two auth paths:
 *   Recipient path — bearer token issued by POST /auth/{uuid} (TG-2, live)
 *   Owner path     — owner-scoped credential (TG-4, stubbed as 501)
 *
 * Deletion sequence (fail-closed, tombstone path A):
 *   1. Read manifest, authorise caller
 *   2. Flip consumed: true, write manifest back first
 *   3. Delete chunks {uuid}/0000…{uuid}/{N-1} (zero-padded 4-digit index)
 *   4. Overwrite manifest with stripped tombstone { consumed, consumed_at }
 *
 * Already consumed → 410 (idempotent-ish; tombstone already written)
 */

import { safeGetManifest } from '../manifest.js';
import { buildTombstone } from '../manifest_tg.js';
import { logEvent } from '../analytics.js';

// Chunk key format matches upload handler: {uuid}/{index.toString().padStart(4,'0')}
function chunkKey(uuid, index) {
  return `${uuid}/${index.toString().padStart(4, '0')}`;
}

export async function handleDeleteTransfer(request, env, ctx, uuid) {
  // ── Auth ─────────────────────────────────────────────────────────────────

  const authHeader = request.headers.get('Authorization') ?? '';

  // Owner path — TG-4 (stub)
  if (authHeader.startsWith('Bearer rfs_owner_')) {
    return new Response(
      JSON.stringify({ error: 'Owner-scoped deletion available in a future release.' }),
      { status: 501, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Recipient path — bearer from POST /auth/{uuid}
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Authorization required.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const bearerToken = authHeader.slice(7);

  // ── Read manifest ─────────────────────────────────────────────────────────

  const manifest = await safeGetManifest(env.BUCKET, uuid);
  if (!manifest) {
    return new Response(
      JSON.stringify({ error: 'Transfer not found.' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Already consumed — tombstone exists, nothing more to do
  if (manifest.consumed === true) {
    return new Response(
      JSON.stringify({ error: 'Transfer has already been destroyed.' }),
      { status: 410, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── Authorise bearer ──────────────────────────────────────────────────────
  //
  // The bearer token issued by POST /auth/{uuid} is stored in the manifest
  // under `auth_token` (written by the auth handler at issuance).
  // It is UUID-scoped — a bearer for a different transfer will not match.

  if (!manifest.auth_token || manifest.auth_token !== bearerToken) {
    return new Response(
      JSON.stringify({ error: 'Not authorised to destroy this transfer.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── Fail-closed deletion sequence ─────────────────────────────────────────

  const nowSeconds = Math.floor(Date.now() / 1000);
  const totalChunks = manifest.total_chunks ?? 0;

  // Step 2: Mark consumed first — if subsequent steps fail, the transfer
  // is still marked gone. Clients get 410. Chunks may linger until expiry TTL.
  const consumedManifest = {
    ...manifest,
    consumed: true,
    consumed_at: nowSeconds,
  };
  await env.BUCKET.put(`${uuid}/manifest.json`, JSON.stringify(consumedManifest));

  // Step 3: Delete chunks
  const deleteErrors = [];
  for (let i = 0; i < totalChunks; i++) {
    try {
      await env.BUCKET.delete(chunkKey(uuid, i));
    } catch (err) {
      // Log but don't abort — tombstone is already written
      deleteErrors.push(i);
    }
  }

  // Step 4: Overwrite with stripped tombstone (drops p2sh_secret_hash, expiry, tidal times)
  const tombstone = buildTombstone(nowSeconds);
  await env.BUCKET.put(`${uuid}/manifest.json`, JSON.stringify(tombstone));

  // ── Analytics ─────────────────────────────────────────────────────────────

  ctx.waitUntil(
    logEvent(env, {
      event: 'transfer_destroyed',
      uuid: uuid.slice(0, 8),
      chunks_deleted: totalChunks - deleteErrors.length,
      chunk_delete_errors: deleteErrors.length,
    })
  );

  return new Response(
    JSON.stringify({
      destroyed: true,
      consumed_at: nowSeconds,
      ...(deleteErrors.length > 0 ? { partial: true, failed_chunks: deleteErrors } : {}),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
