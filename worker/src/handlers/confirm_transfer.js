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
 *
 * SW4a: fires 'transfer.confirmed' webhook for API-tier transfers inside the
 * existing ctx.waitUntil block. Consumer transfers (no api_key_hash in
 * dock_index) are silently skipped. deliverWebhookInline is used (not
 * deliverWebhook) because we are already inside waitUntil — cannot nest.
 */

import { getManifest, putManifest }                          from '../manifest.js';
import { buildTombstone }                                    from '../manifest_tg.js';
import { verifyDownloadToken }                               from '../nut11.js';
import { findApiKeyHashForUuid, deliverWebhookInline }       from '../webhook_delivery.js';

const MANIFEST_SIZE_MAX = 64 * 1024;

// Chunk key format — must match upload handler exactly.
function chunkKey(uuid, index) {
  return `${uuid}/${index.toString().padStart(4, '0')}`;
}

export async function handleConfirmTransfer(request, env, ctx, uuid) {
  // ── Auth — mirrors download handler ──────────────────────────────────────
  const _obj    = await env.BUCKET.head(`${uuid}/manifest.json`).catch(() => null);
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
  if (manifest.pending_destruction !== true && manifest.pending_destruction !== false) {
    return _json({ destroyed: false });
  }
  if (manifest.pending_destruction === false) {
    return _err(409, 'Transfer not yet fully downloaded.');
  }

  // pending_destruction === true: final chunk was served, sender armed it.

  // ── Fail-closed deletion sequence ─────────────────────────────────────────
  const nowSeconds  = Math.floor(Date.now() / 1000);
  const totalChunks = manifest.total_chunks ?? 0;

  // Step 1: consumed marker — synchronous write before returning 200.
  await putManifest(env.BUCKET, uuid, { ...manifest, consumed: true, consumed_at: nowSeconds });

  // Steps 2–5: fire-and-forget via waitUntil. Caller receives 200 immediately.
  ctx.waitUntil(
    (async () => {
      // ── Step 2: Delete chunks ─────────────────────────────────────────────
      const deleteErrors = [];
      for (let i = 0; i < totalChunks; i++) {
        try {
          await env.BUCKET.delete(chunkKey(uuid, i));
        } catch (e) {
          console.error(`confirm: chunk delete failed at index ${i}:`, e);
          deleteErrors.push(i);
        }
      }

      // TH-1: delete encrypted .ots blob if present — load-bearing on all
      // deletion paths. No-op if timestamp_state was 'none'.
      env.BUCKET.delete(`${uuid}/date-seal.ots.enc`).catch(e =>
        console.error('TH-1: date-seal.ots.enc delete failed (confirm path):', e)
      );

      // ── Step 3: Overwrite with stripped tombstone ──────────────────────────
      const tombstone = buildTombstone(nowSeconds);
      try {
        await putManifest(env.BUCKET, uuid, tombstone);
      } catch (e) {
        console.error('confirm: tombstone write failed:', e);
      }

      // ── Step 4: Mark collected in Execution Dock KV index ─────────────────
      try {
        const dockRaw = await env.STATUS_KV.get(`dock_index:${uuid}`, { type: 'json' });
        if (dockRaw) {
          await env.STATUS_KV.put(
            `dock_index:${uuid}`,
            JSON.stringify({
              ...dockRaw,
              collected:    true,
              collected_at: nowSeconds,
            }),
            { expirationTtl: 86400 * 7 },
          );
        }
      } catch (e) {
        console.error('confirm: dock_index collected update failed:', e);
      }

      // ── Step 5: Webhook — 'transfer.confirmed' (SW4a) ────────────────────
      // API-tier transfers only. findApiKeyHashForUuid returns null for
      // consumer transfers; deliverWebhookInline is a no-op on null.
      // We use deliverWebhookInline (not deliverWebhook) because we are
      // already inside waitUntil — nested waitUntil is not permitted.
      // Webhook failure never affects deletion outcome.
      try {
        const apiKeyHash = await findApiKeyHashForUuid(env, uuid);
        if (apiKeyHash) {
          await deliverWebhookInline(env, apiKeyHash, {
            type: 'transfer.confirmed',
            uuid,
          });
        }
      } catch (e) {
        console.error('confirm: webhook delivery error:', e);
      }

      // ── AE log ────────────────────────────────────────────────────────────
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

// ── Response helpers ──────────────────────────────────────────────────────────

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
