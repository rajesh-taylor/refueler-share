// worker/src/handlers/timestamp.js
//
// SW9a — Extracted from index.js (Phase 3a).
// TH-1: handleTimestampSubmit — POST /timestamp/submit
// TH-2: handleTimestampSeal   — GET  /timestamp/seal/:uuid
//
// All imports from ../utils.js — never from ../index.js.

import {
  getTimestampState,
  buildTimestampPendingPatch,
  isTimestampEligible,
} from '../manifest_tg.js';
import { putManifest }                         from '../manifest.js';
import { findApiKeyHashForUuid, deliverWebhookInline } from '../webhook_delivery.js';
import { UUID_RE, safeGetManifest, json, err } from '../utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// Timestamp submit — POST /timestamp/submit  (TH-1)
// ─────────────────────────────────────────────────────────────────────────────
export async function handleTimestampSubmit(request, env, ctx) {
  const uuid = request.headers.get('X-Transfer-UUID') ?? '';
  if (!UUID_RE.test(uuid)) return err(400, 'Invalid or missing X-Transfer-UUID');

  const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (oversize) return err(502, 'Transfer manifest exceeds size limit');
  if (!manifest) return err(404, 'Transfer not found');

  const manifestTier = (manifest.tier ?? 'free').toLowerCase();
  if (manifestTier === 'free' || manifestTier === 'citizen') {
    return err(403, 'Permanent record requires a Sovereign subscription');
  }

  if (!isTimestampEligible(manifest)) {
    const state = getTimestampState(manifest);
    if (manifest.consumed === true) return err(410, 'Transfer has been destroyed');
    if (manifest.upload_complete !== true) return err(409, 'Upload not yet complete');
    return err(409, `Timestamp already in state: ${state}`);
  }

  let otsBlob;
  try {
    const buf = await request.arrayBuffer();
    if (buf.byteLength < 13) return err(400, 'Timestamp blob too short (min 13 bytes: iv + ciphertext)');
    if (buf.byteLength > 8192) return err(413, 'Timestamp blob exceeds 8 KB limit');
    otsBlob = new Uint8Array(buf);
  } catch (e) {
    return err(400, 'Could not read request body');
  }

  try {
    await env.BUCKET.put(`${uuid}/date-seal.ots.enc`, otsBlob, {
      httpMetadata: { contentType: 'application/octet-stream' },
    });
  } catch (e) {
    console.error('TH-1: R2 put date-seal.ots.enc failed:', e);
    return err(502, 'Failed to store timestamp blob');
  }

  const jitterMs = 50 + Math.floor(Math.random() * 150);
  await new Promise(r => setTimeout(r, jitterMs));

  const nowSeconds = Math.floor(Date.now() / 1000);
  const patch = buildTimestampPendingPatch(nowSeconds);
  await putManifest(env.BUCKET, uuid, { ...manifest, ...patch });

  ctx.waitUntil(
    (async () => {
      try {
        const apiKeyHash = await findApiKeyHashForUuid(env, uuid);
        if (apiKeyHash) {
          await deliverWebhookInline(env, apiKeyHash, {
            type: 'transfer.timestamp_submitted',
            uuid,
          });
        }
      } catch (e) {
        console.error('timestamp_submit: webhook delivery error:', e);
      }
    })()
  );

  return json({ ok: true, timestamp_state: 'pending' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Timestamp seal fetch — GET /timestamp/seal/:uuid  (TH-2)
// ─────────────────────────────────────────────────────────────────────────────
export async function handleTimestampSeal(request, env, uuid) {
  const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (oversize) return err(502, 'Transfer manifest exceeds size limit');
  if (!manifest) return err(404, 'Transfer not found');
  if (manifest.consumed === true) return err(410, 'Transfer has been destroyed');

  const state = getTimestampState(manifest);
  if (state === 'none') return err(404, 'No date seal for this transfer');

  let obj;
  try {
    obj = await env.BUCKET.get(`${uuid}/date-seal.ots.enc`);
  } catch (e) {
    console.error('TH-2: R2 get date-seal.ots.enc failed:', e);
    return err(502, 'Could not retrieve date seal');
  }
  if (!obj) return err(404, 'Date seal not found');

  const buf = await obj.arrayBuffer();

  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type':   'application/octet-stream',
      'Content-Length': String(buf.byteLength),
      'Cache-Control':  'no-store',
    },
  });
}
