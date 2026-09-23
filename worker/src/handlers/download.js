/**
 * download.js — GET /download/:uuid/:chunk
 * worker/src/handlers/download.js
 *
 * Full extraction of handleDownload from index.js (Share-6-5a), behaviour-
 * preserving for the legacy path, plus the Share-6-5a verified path
 * (merkle-spec-v1.md §3 / B9-3 server half). index.js keeps only the dispatch
 * stub (invariant: new handlers live in handlers/, index.js is the router).
 *
 * VERIFIED PATH (per-manifest gate — isVerifiedPath, download_verify.js):
 *   A manifest finalised by Share-6-3 (upload_complete + merkle_root + pinned
 *   tree_algo) is served with ciphertext storage-integrity verification:
 *     - root reconstruction from {uuid}/hashes vs manifest.merkle_root (once per
 *       request, order-independent — no assumption that chunk 0 is fetched first);
 *     - per-chunk body BLAKE3 recompute vs sidecar[i];
 *     - 409 integrity_failed on any mismatch; large-file mid-stream mismatch
 *       aborts the connection (hybrid threshold).
 *   On mismatch: AE logged, object NOT auto-destroyed (preserved for
 *   investigation — merkle-spec §3.4; the date-seal.ots.enc deletion invariant
 *   is separate and untouched).
 *
 * LEGACY PATH (pre-6-3 manifests, no merkle_root): served exactly as before,
 *   NO 409 — a file predating the sidecar must still serve (session brief;
 *   Share-6 §4). This is the cutover-safe additive behaviour: the verified path
 *   is reachable for test/WL without moving consumer traffic (that is 6-6b).
 *
 * BARRED here (6-5b / B9-4 territory): verified:true on any receipt; blake3_root
 *   emission; any "end-to-end" claim. The cargo.discharged receipt tail is
 *   preserved UNCHANGED and does NOT gain a verified field.
 */

import { UUID_RE, safeGetManifest, json, err, parseRange } from '../utils.js';
import { putManifest, isDownloadBlocked, requiresPassphrase } from '../manifest.js';
import { verifyDownloadToken } from '../nut11.js';
import { checkTransferStatus, flipPendingDestruction } from '../manifest_tg.js';
import { emitReceipt } from '../receipts.js';
import { findApiKeyHashForUuid } from '../webhook_delivery.js';
import {
  isVerifiedPath,
  reconstructAndCheckRoot,
  verifyChunkBody,
  VERIFY_INLINE_CHUNK_THRESHOLD,
} from './download_verify.js';

// Local AE writer — mirrors index.js logEvent's data-point shape exactly, so
// the download event log survives the extraction. Same pattern finalise.js uses
// (a handler in handlers/ is self-contained; logEvent stays module-private in
// index.js and cannot be imported without a circular dependency).
function logEvent(env, {
  endpoint,
  tier         = 'free',
  status       = 200,
  latency      = 0,
  chunkIndex   = -1,
  totalChunks  = 0,
  totalBytes   = 0,
  errorMsg     = '',
  httpProtocol = '',
}) {
  if (!env.AE) return;
  try {
    env.AE.writeDataPoint({
      blobs:   [endpoint, tier, errorMsg, httpProtocol],
      doubles: [latency, status, chunkIndex, totalChunks, totalBytes],
      indexes: [endpoint],
    });
  } catch (e) {
    console.error('AE write failed:', e);
  }
}

export async function handleDownload(request, env, ctx, uuid, chunkIndex) {
  // ── UUID format validation (S41) ──────────────────────────────────────────
  if (!UUID_RE.test(uuid)) {
    logEvent(env, { endpoint: 'download', status: 400, errorMsg: 'invalid_uuid' });
    return err(400, 'Invalid transfer ID');
  }

  if (chunkIndex < 0 || chunkIndex > 9999) {
    logEvent(env, { endpoint: 'download', status: 400, errorMsg: 'invalid_chunk_index' });
    return err(400, 'Invalid chunk index');
  }

  const { manifest, oversize: dlOversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (dlOversize) {
    logEvent(env, { endpoint: 'download', status: 502, errorMsg: 'manifest_oversize' });
    return err(502, 'Transfer manifest exceeds size limit');
  }
  if (!manifest) return err(404, 'Transfer not found');

  const dlNowSeconds = Math.floor(Date.now() / 1000);
  const dlStatusCheck = checkTransferStatus(manifest, dlNowSeconds);
  if (!dlStatusCheck.ok) return err(dlStatusCheck.status, dlStatusCheck.body);

  if (isDownloadBlocked(manifest)) return err(410, 'Transfer expired');

  if (chunkIndex === 0) {
    logEvent(env, {
      endpoint:    'download_tier',
      tier:        manifest.tier ?? 'free',
      status:      200,
      latency:     0,
      totalChunks: manifest.total_chunks ?? 0,
      totalBytes:  manifest.total_bytes  ?? 0,
    });
  }

  if (requiresPassphrase(manifest)) {
    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return err(401, 'Download token required');
    const { valid, uuid: tokenUuid } = await verifyDownloadToken(token, env.MINT_PRIVATE_KEY);
    if (!valid || tokenUuid !== uuid) return err(401, 'Invalid or expired download token');
  }

  if (chunkIndex === 0 && !manifest.download_initiated_at) {
    manifest.download_initiated_at = Math.floor(Date.now() / 1000);
    await putManifest(env.BUCKET, uuid, manifest);
  }

  // ── Share-6-5a: verified vs legacy fork ────────────────────────────────────
  // Per-manifest gate. Verified path only when this manifest was finalised by
  // Share-6-3 (merkle_root + pinned tree_algo present). Everything else — every
  // pre-6-3 upload — takes the unchanged legacy serve below, never a 409.
  const verified = isVerifiedPath(manifest);

  const key = `${uuid}/${String(chunkIndex).padStart(4, '0')}`;

  if (verified) {
    // Range cannot be integrity-verified against a whole-chunk leaf hash: a
    // partial body's BLAKE3 will never equal sidecar[i]. Rather than serve a
    // "verified" 206 that is nothing of the sort, reject Range on the verified
    // path. The consumer client fetches whole chunks (frontend/download.js), so
    // nothing legitimate is broken; a future verified-resume feature is a real
    // design task (verify whole, then slice), flagged — not smuggled in here.
    if (request.headers.has('Range')) {
      logEvent(env, { endpoint: 'download', status: 416, chunkIndex, errorMsg: 'range_on_verified' });
      return err(416, 'Range requests are not supported on verified transfers');
    }

    // merkle-spec §3 steps 2–3: sidecar length check + root reconstruction vs
    // manifest.merkle_root. Runs every verified request (order-independent):
    // no chunk is ever served without the committed root having been checked.
    const rootCheck = await reconstructAndCheckRoot(env, uuid, manifest);
    if (!rootCheck.ok) {
      logEvent(env, { endpoint: 'download', status: 409, chunkIndex, errorMsg: rootCheck.code });
      // Root-level failure — AE logged above. No auto-destroy (merkle-spec §3.4).
      return json({ error: rootCheck.code }, 409);
    }
    const { sidecar, chunkCount } = rootCheck;

    if (chunkIndex >= chunkCount) {
      logEvent(env, { endpoint: 'download', status: 400, chunkIndex, errorMsg: 'chunk_index_out_of_range' });
      return err(400, 'Invalid chunk index');
    }

    // Fetch the WHOLE stored object (no range) so its bytes match leaf i.
    let obj;
    try {
      obj = await env.BUCKET.get(key);
    } catch (e) {
      console.error('verified chunk GET failed:', e);
      return err(502, 'Chunk unavailable');
    }
    if (!obj) return err(404, 'Chunk not found');

    const baseHeaders = {
      'Content-Type':    'application/octet-stream',
      'Cache-Control':   'private, no-store',
      'X-Transfer-UUID': uuid,
      'X-Chunk-Index':   String(chunkIndex),
      'X-File-Name':     manifest.file_name ?? `refueler-${uuid.slice(0, 8)}`,
      'X-Integrity':     'ciphertext-storage-verified', // storage integrity, NOT end-to-end
    };

    // merkle-spec §3 step 4: verify-then-flush, hybrid failure mode.
    if (chunkCount <= VERIFY_INLINE_CHUNK_THRESHOLD) {
      // Small transfers (the entire free tier and most paid): buffer the whole
      // chunk, verify, and release only on match — a clean 409 is always
      // possible because nothing is on the wire until it verifies.
      const bytes = new Uint8Array(await obj.arrayBuffer());
      if (!verifyChunkBody(bytes, sidecar, chunkIndex)) {
        logEvent(env, { endpoint: 'download', status: 409, chunkIndex, errorMsg: 'chunk_hash_mismatch' });
        // AE logged. Object preserved for investigation — NOT destroyed.
        return json({ error: 'integrity_failed', chunk: chunkIndex }, 409);
      }
      const dlResponse = new Response(bytes, { status: 200, headers: baseHeaders });
      return finishDownload(request, env, ctx, uuid, chunkIndex, manifest, dlResponse);
    }

    // Large transfers (> threshold, Chartered-scale): stream with inline
    // verify-then-flush. A mismatch mid-body cannot yield a clean 409 — bytes
    // are already on the wire — so the stream is aborted (the connection
    // truncates; the client sees a failed download). AE logged, object
    // preserved. 6-5b handles BOTH shapes: clean 409 (small) and truncation
    // (large). This is the honest large-file behaviour, stated, not hidden.
    const verifyingStream = makeVerifyingStream(obj.body, sidecar, chunkIndex, env, uuid);
    const dlResponse = new Response(verifyingStream, { status: 200, headers: baseHeaders });
    return finishDownload(request, env, ctx, uuid, chunkIndex, manifest, dlResponse);
  }

  // ── Legacy path (pre-6-3, no merkle_root) — UNCHANGED from the inline handler.
  const obj = await env.BUCKET.get(key, {
    range: request.headers.has('Range') ? parseRange(request.headers.get('Range')) : undefined,
  });
  if (!obj) return err(404, 'Chunk not found');

  const status = request.headers.has('Range') ? 206 : 200;
  const headers = new Headers({
    'Content-Type':    'application/octet-stream',
    'Cache-Control':   'private, no-store',
    'X-Transfer-UUID': uuid,
    'X-Chunk-Index':   String(chunkIndex),
    'X-File-Name':     manifest.file_name ?? `refueler-${uuid.slice(0, 8)}`,
  });

  if (obj.range) {
    headers.set('Content-Range', `bytes ${obj.range.offset}-${obj.range.end}/${obj.size}`);
  }

  const dlResponse = new Response(obj.body, { status, headers });
  return finishDownload(request, env, ctx, uuid, chunkIndex, manifest, dlResponse);
}

// ── Streaming verify-then-flush for large (> threshold) verified transfers ────
// Buffers the chunk body through a TransformStream, hashing as it passes. Bytes
// flow to the client as they arrive; if the final digest ≠ sidecar[i] the
// stream errors, truncating the connection. No clean status is possible once
// bytes are flushed — this is the accepted large-file failure mode. The object
// is never destroyed here.
function makeVerifyingStream(sourceBody, sidecar, i, env, uuid) {
  // Accumulate for a whole-chunk BLAKE3 (leaf = digest over exactly the stored
  // bytes). Web Streams: pass bytes through, hash at flush.
  const chunks = [];
  const reader = sourceBody.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          // Concatenate and verify at end-of-stream.
          let total = 0;
          for (const c of chunks) total += c.length;
          const joined = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { joined.set(c, off); off += c.length; }
          if (!verifyChunkBody(joined, sidecar, i)) {
            logEventStatic(env, 409, i, 'chunk_hash_mismatch_stream');
            controller.error(new Error('integrity_failed')); // truncates the connection
            return;
          }
          controller.close();
          return;
        }
        chunks.push(value);
        controller.enqueue(value);
      } catch (e) {
        controller.error(e);
      }
    },
    cancel(reason) {
      try { reader.cancel(reason); } catch { /* noop */ }
    },
  });
}

// Static AE line for the streaming-abort case (no access to the closure logEvent
// above from inside the stream source; same shape).
function logEventStatic(env, status, chunkIndex, errorMsg) {
  if (!env.AE) return;
  try {
    env.AE.writeDataPoint({
      blobs:   ['download', 'free', errorMsg, ''],
      doubles: [0, status, chunkIndex, 0, 0],
      indexes: ['download'],
    });
  } catch (e) {
    console.error('AE write failed:', e);
  }
}

// ── Shared tail: pending_destruction flip + cargo.discharged receipt ──────────
// Preserved VERBATIM from the inline handler (lines 1912–1980). The receipt does
// NOT gain a verified field in 6-5a — that is 6-5b / B9-4, barred here.
function finishDownload(request, env, ctx, uuid, chunkIndex, manifest, dlResponse) {
  // ── TG: flip pending_destruction → true on last chunk of a DAD transfer ───
  const updatedManifestForFlip = flipPendingDestruction(manifest, chunkIndex);
  const pendingDestructionFlipped = updatedManifestForFlip !== manifest;
  if (pendingDestructionFlipped) {
    ctx.waitUntil(
      putManifest(env.BUCKET, uuid, updatedManifestForFlip).catch(e =>
        console.error('TG: pending_destruction flip write failed:', e)
      )
    );
  }

  // ── SW5: emit cargo.discharged receipt ────────────────────────────────────
  const isLastChunk = manifest.total_chunks > 0 && chunkIndex === manifest.total_chunks - 1;
  if (isLastChunk && manifest.api_live_key) {
    ctx.waitUntil(
      (async () => {
        try {
          const guardKey  = `receipt_discharged_guard:${uuid}`;
          let alreadyFired = false;
          try {
            const existing = await env.STATUS_KV.get(guardKey);
            alreadyFired   = existing !== null;
          } catch (e) {
            console.error('SW5 discharge guard KV read failed:', e);
          }

          if (!alreadyFired) {
            env.STATUS_KV.put(guardKey, '1', { expirationTtl: 7 * 24 * 3600 }).catch(e =>
              console.error('SW5 discharge guard KV write failed:', e)
            );

            const apiKeyHash = await findApiKeyHashForUuid(env, uuid);
            if (apiKeyHash) {
              emitReceipt(env, ctx, {
                receipt_type: 'collection',
                event:        'cargo.discharged',
                live_key:     manifest.api_live_key,
                uuid,
                transfer_ref: manifest.api_transfer_ref ?? null,
                size_bytes:   manifest.total_bytes  ?? 0,
                chunk_count:  manifest.total_chunks ?? 0,
                issued_at:    Math.floor(Date.now() / 1000),
                collected_at: Math.floor(Date.now() / 1000),
                apiKeyHash,
              });
            }
          }
        } catch (e) {
          console.error('SW5 cargo.discharged emit error:', e);
        }
      })()
    );
  }

  return dlResponse;
}
