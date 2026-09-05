/**
 * confirm_transfer.js — POST /confirm/{uuid}
 *
 * Recipient calls this after saving the file locally.
 * If the transfer was armed with destroy-after-download, this triggers
 * the actual R2 deletion. The download handler only flips pending_destruction
 * to true (signals "fully served"); deletion happens here on explicit confirm.
 *
 * Auth: mirrors download auth exactly.
 *   - Passphrase-protected transfers require Authorization: Bearer <token>
 *     (the download token issued by POST /auth/{uuid}).
 *   - Open transfers: no auth required.
 *
 * Responses:
 *   200 { destroyed: true }               — deletion complete
 *   200 { destroyed: false }              — not a destroy-after-download transfer (no-op)
 *   409                                   — final chunk not yet served; confirm too early
 *   401/403                               — auth failure on passphrase-protected transfer
 *   404                                   — transfer not found
 *   410                                   — already consumed (idempotent)
 */

import { getManifest, putManifest } from '../manifest.js';
import { buildTombstone }           from '../manifest_tg.js';
import { verifyDownloadToken }      from '../nut11.js';

const MANIFEST_SIZE_MAX = 64 * 1024;

// Chunk key format — must match upload handler exactly.
function chunkKey(uuid, index) {
  return `${uuid}/${index.toString().padStart(4, '0')}`;
}

export async function handleConfirmTransfer(request, env, ctx, uuid) {
  // ── Auth — mirrors download handler ──────────────────────────────────────
  // Read manifest first to know whether auth is required.
const _obj = await env.BUCKET.head(`${uuid}/manifest.json`).catch(() => null);
const oversize = _obj && (_obj.size ?? 0) > MANIFEST_SIZE_MAX;
const manifest = oversize ? null : await getManifest(env.BUCKET, uuid);
  if (oversize) {
    return _err(502, 'Transfer manifest exceeds size limit.');
  }
  if (!manifest) {
    return _err(404, 'Transfer not found.');
  }

  // Already consumed — tombstone in place, nothing to do.
  if (manifest.consumed === true) {
    return _err(410, 'Transfer has already been destroyed.');
  }

  // Passphrase-protected transfers require a valid download token.
  const requiresAuth = typeof manifest.p2sh_secret_hash === 'string' &&
                       manifest.p2sh_secret_hash.length === 64;

  if (requiresAuth) {
    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return _err(401, 'Download token required.');
    }
    const { valid, uuid: tokenUuid } = await verifyDownloadToken(token, env.MINT_PRIVATE_KEY);
    if (!valid || tokenUuid !== uuid) {
      return _err(403, 'Not authorised for this transfer.');
    }
  }

  // ── Not a destroy-after-download transfer — idempotent no-op ─────────────
  // pending_destruction absent or never set means sender did not arm this transfer.
  if (manifest.pending_destruction !== true && manifest.pending_destruction !== false) {
    return _json({ destroyed: false });
  }
  if (manifest.pending_destruction === false) {
    // Armed but final chunk not yet served.
    return _err(409, 'Transfer not yet fully downloaded.');
  }

  // pending_destruction === true: final chunk was served, sender armed it.
  // This is the destruction trigger.

  // ── 409: final chunk not yet served ──────────────────────────────────────
  // pending_destruction flips from false → true only after the final chunk
  // is served by the download handler. If it is still false here, the
  // recipient is calling confirm before completing the download.
  // (Handled above in the false branch — kept explicit for clarity.)

  // ── Fail-closed deletion sequence ─────────────────────────────────────────
  // 1. Write consumed marker first. If R2 chunk deletes fail, transfer is
  //    still marked gone — chunks expire via R2 lifecycle TTL.
  // 2. Delete chunks.
  // 3. Overwrite manifest with stripped tombstone.
  //
  // All R2 puts/deletes fire inside ctx.waitUntil so the 200 response
  // is returned immediately; the recipient does not wait for chunk deletion.

  const nowSeconds   = Math.floor(Date.now() / 1000);
  const totalChunks  = manifest.total_chunks ?? 0;

  // Step 1: consumed marker — synchronous write before returning 200.
  // This ensures the transfer is marked gone even if the waitUntil work fails.
  await putManifest(env.BUCKET, uuid, { ...manifest, consumed: true, consumed_at: nowSeconds });

  // Steps 2 + 3: chunk deletion + tombstone — fire-and-forget via waitUntil.
  // Caller receives 200 immediately; deletion runs in the background.
  ctx.waitUntil(
    (async () => {
      const deleteErrors = [];
      for (let i = 0; i < totalChunks; i++) {
        try {
          await env.BUCKET.delete(chunkKey(uuid, i));
        } catch (e) {
          console.error(`confirm: chunk delete failed at index ${i}:`, e);
          deleteErrors.push(i);
        }
      }

      // Step 3: Overwrite with stripped tombstone.
      // On partial failure, tombstone still written — orphaned chunks TTL out.
      const tombstone = buildTombstone(nowSeconds);
      try {
        await putManifest(env.BUCKET, uuid, tombstone);
      } catch (e) {
        console.error('confirm: tombstone write failed:', e);
      }

      // AE log — fire-and-forget inside waitUntil.
      if (env.AE) {
        try {
          env.AE.writeDataPoint({
            blobs:   ['transfer_destroyed', manifest.tier ?? 'free', deleteErrors.length > 0 ? 'partial_delete' : '', ''],
            doubles: [0, 200, 0, totalChunks, 0],
            indexes: ['transfer_destroyed'],
          });
        } catch (e) {
          console.error('confirm: AE write failed:', e);
        }
      }
    })()
  );

  return _json({ destroyed: true });
}

// ── Response helpers (local, no shared dep) ───────────────────────────────

function _json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function _err(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
