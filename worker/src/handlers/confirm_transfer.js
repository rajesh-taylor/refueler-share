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
 * existing ctx.waitUntil block. Consumer transfers (no cref_ct in the
 * manifest) are silently skipped. notifyTransfer is awaited inline because
 * we are already inside waitUntil — cannot nest.
 */

import { getManifest }                                       from '../manifest.js';
import { latchConsumed }                                     from '../latch.js';
import { destroyTransfer }                                   from './delete_transfer.js';
import { verifyDownloadToken }                               from '../nut11.js';
import { notifyTransfer, EVENTS }                            from '../webhook_delivery.js';
import { storedTier }                                       from '../tiers.js';

const MANIFEST_SIZE_MAX = 64 * 1024;


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
  // B12-3: the consumed step is the R2 conditional-put latch (SR S1.8), awaited
  // before the 200 so the transfer is blocked from that moment. The rest is the
  // shared destruction (delete_transfer.js — the same call DAD, owner delete and
  // bearer delete make); it also clears dock_index (B12 §0.3: absence is the
  // trace — the old "collected" mark here predated that rule).
  const nowSeconds  = Math.floor(Date.now() / 1000);
  const totalChunks = manifest.total_chunks ?? 0;

  const latch = await latchConsumed(env, uuid, nowSeconds);
  if (!latch.won) {
    if (latch.reason === 'gone')      return _err(404, 'Transfer not found.');
    if (latch.reason === 'contended') return _err(503, 'Transfer busy — please retry.');
    return _err(410, 'Transfer has already been destroyed.');
  }
  const latched = { ...latch.manifest, consumed: true, consumed_at: nowSeconds };

  ctx.waitUntil(
    (async () => {
      const r = await destroyTransfer(env, uuid, latched, nowSeconds, 'confirm')
        .catch(e => { console.error('confirm: destruction failed:', e); return null; });

      // Webhook — 'transfer.confirmed'. Routed from the pre-tombstone manifest
      // (cref_ct); consumer transfers have none and are skipped. Notification,
      // never control flow (API-Repair-1).
      await notifyTransfer(env, uuid, manifest, EVENTS.CONFIRMED);

      if (env.AE) {
        try {
          env.AE.writeDataPoint({
            blobs:   ['transfer_destroyed', storedTier(manifest.tier ?? 'free'), r?.destroyed ? '' : 'partial_delete', ''],
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
