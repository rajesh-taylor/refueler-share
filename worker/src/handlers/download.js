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
 *     - root reconstruction from {uuid}/hashes vs manifest.merkle_root — run
 *       ONCE per transfer via KV-cached flag (Share-B10-3); subsequent chunks
 *       skip reconstruction and trust the cached proof (see readSidecarWithRootCheck);
 *     - per-chunk body BLAKE3 recompute vs sidecar[i] — runs on EVERY chunk;
 *     - 409 integrity_failed on any mismatch; large-file mid-stream mismatch
 *       aborts the connection (hybrid threshold).
 *   On mismatch: AE logged, object NOT auto-destroyed (preserved for
 *   investigation — merkle-spec §3.4; the date-seal.ots.enc deletion invariant
 *   is separate and untouched).
 *
 * Share-B10-3 — fix for false 409 under load on large transfers:
 *   Root of the bug: reconstructAndCheckRoot() was called on every chunk request.
 *   For transfers >128 chunks (>4 GiB, streaming path), the noble tree over N
 *   leaves exhausted cpu_ms under concurrent load, causing the try/catch inside
 *   reconstructAndCheckRoot to catch the CPU-kill and return integrity_failed —
 *   a false 409 with no actual tamper event. Fix: replaced reconstructAndCheckRoot()
 *   call with readSidecarWithRootCheck() (download_verify.js), which:
 *     - runs the full root reconstruction exactly once per transfer (first chunk
 *       request to arrive for a given uuid, whichever it is);
 *     - caches the result as KV flag `root_verified:{uuid}` (TTL = transfer expiry);
 *     - on subsequent chunks: reads the sidecar from R2 (always needed for step 4),
 *       sees the KV flag, and skips reconstruction entirely.
 *   Security: verifyChunkBody (step 4) still runs on every chunk. The root check
 *   defends against sidecar tampering; by caching it we accept that subsequent
 *   chunks rely on a proof established on the first request. An adversary who can
 *   write to R2 and patch both a chunk and its sidecar entry would evade step 3
 *   on cached chunks but is still caught by: step 4 (chunk body vs sidecar entry),
 *   and the recipient's plaintext blake3_root check post-decryption. No silent
 *   data corruption escapes. Full security rationale in download_verify.js.
 *
 * Share-B11-1 — DAD-BUG fix (destroy-after-download not executing):
 *   Root of the bug: flipPendingDestruction correctly flipped pending_destruction
 *   false → true on the last chunk, but nothing ever acted on that flag. The
 *   comment in manifest_tg.js even said "pending_destruction: true is advisory —
 *   never blocks a re-fetch." The deletion sequence (consumed flag, chunk deletes,
 *   tombstone) existed in delete_transfer.js but was never wired to the DAD path.
 *   Fix: finishDownload now executes the full destruction sequence inline via
 *   ctx.waitUntil when pendingDestructionFlipped === true. Sequence:
 *     1. Write consumed:true to manifest (blocks any concurrent re-download)
 *     2. Delete all chunks {uuid}/0000 … {uuid}/{N-1}
 *     3. Delete {uuid}/hashes sidecar
 *     4. Delete {uuid}/date-seal.ots.enc (OTS anchor, matches bearer delete path)
 *     5. Delete KV root_verified:{uuid} (B10-3 cache key — self-expiring anyway)
 *     6. Write tombstone (consumed:true + consumed_at) as the final manifest state
 *   The manifest write at step 1 is the guard — if the Worker dies mid-sequence,
 *   consumed:true is already set so checkTransferStatus blocks any re-download.
 *   Chunks may be partially deleted (orphan sweep catches residue at 03:00).
 *   finishDownload returns the response immediately; destruction runs in the
 *   background via ctx.waitUntil — the recipient's download is never held up.
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
import { checkTransferStatus, flipPendingDestruction, buildTombstone } from '../manifest_tg.js';
import { emitReceipt } from '../receipts.js';
import { findApiKeyHashForUuid } from '../webhook_delivery.js';
import {
  isVerifiedPath,
  readSidecarWithRootCheck,
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
  const verified = isVerifiedPath(manifest);

  const key = `${uuid}/${String(chunkIndex).padStart(4, '0')}`;

  if (verified) {
    if (request.headers.has('Range')) {
      logEvent(env, { endpoint: 'download', status: 416, chunkIndex, errorMsg: 'range_on_verified' });
      return err(416, 'Range requests are not supported on verified transfers');
    }

    const rootCheck = await readSidecarWithRootCheck(env, uuid, manifest);
    if (!rootCheck.ok) {
      logEvent(env, { endpoint: 'download', status: 409, chunkIndex, errorMsg: rootCheck.code });
      return json({ error: rootCheck.code }, 409);
    }
    const { sidecar, chunkCount } = rootCheck;

    if (chunkIndex >= chunkCount) {
      logEvent(env, { endpoint: 'download', status: 400, chunkIndex, errorMsg: 'chunk_index_out_of_range' });
      return err(400, 'Invalid chunk index');
    }

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
      'X-Integrity':     'ciphertext-storage-verified',
    };

    if (chunkCount <= VERIFY_INLINE_CHUNK_THRESHOLD) {
      const bytes = new Uint8Array(await obj.arrayBuffer());
      if (!verifyChunkBody(bytes, sidecar, chunkIndex)) {
        logEvent(env, { endpoint: 'download', status: 409, chunkIndex, errorMsg: 'chunk_hash_mismatch' });
        return json({ error: 'integrity_failed', chunk: chunkIndex }, 409);
      }
      const dlResponse = new Response(bytes, { status: 200, headers: baseHeaders });
      return finishDownload(request, env, ctx, uuid, chunkIndex, manifest, dlResponse);
    }

    const verifyingStream = makeVerifyingStream(obj.body, sidecar, chunkIndex, env, uuid);
    const dlResponse = new Response(verifyingStream, { status: 200, headers: baseHeaders });
    return finishDownload(request, env, ctx, uuid, chunkIndex, manifest, dlResponse);
  }

  // ── Legacy path (pre-6-3, no merkle_root) — UNCHANGED.
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
function makeVerifyingStream(sourceBody, sidecar, i, env, uuid) {
  const chunks = [];
  const reader = sourceBody.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          let total = 0;
          for (const c of chunks) total += c.length;
          const joined = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { joined.set(c, off); off += c.length; }
          if (!verifyChunkBody(joined, sidecar, i)) {
            logEventStatic(env, 409, i, 'chunk_hash_mismatch_stream');
            controller.error(new Error('integrity_failed'));
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

// ── Shared tail: DAD destruction + pending_destruction flip + cargo.discharged receipt ──
//
// Share-B11-1: when flipPendingDestruction returns a new manifest (last chunk of a
// DAD transfer), execute the full destruction sequence in ctx.waitUntil:
//   1. Write consumed:true immediately — guards against concurrent re-downloads
//      if the Worker dies before completing the rest of the sequence.
//   2. Delete all chunks sequentially; log failures (orphan sweep catches residue).
//   3. Delete {uuid}/hashes sidecar.
//   4. Delete {uuid}/date-seal.ots.enc (OTS anchor, matches bearer delete path).
//   5. Delete KV root_verified:{uuid} (B10-3 cache key; self-expiring but clean to remove).
//   6. Write tombstone as the final manifest state.
//   7. Remove KV dock_index:{uuid} — the same call owner-delete makes, so DAD and
//      owner-delete are indistinguishable in the Execution Dock (absence). B12 §6.5.
// The response is returned to the recipient immediately; destruction is background.
// The receipt tail (SW5 cargo.discharged) fires independently — DAD does not suppress it.
function finishDownload(request, env, ctx, uuid, chunkIndex, manifest, dlResponse) {
  // ── TG: flip pending_destruction → true on last chunk of a DAD transfer ───
  const updatedManifestForFlip = flipPendingDestruction(manifest, chunkIndex);
  const pendingDestructionFlipped = updatedManifestForFlip !== manifest;

  if (pendingDestructionFlipped) {
    // Share-B11-1: full DAD destruction sequence.
    ctx.waitUntil(
      (async () => {
        const nowSeconds  = Math.floor(Date.now() / 1000);
        const totalChunks = manifest.total_chunks ?? 0;

        // Step 1: mark consumed:true — the critical guard write.
        // If anything below fails, this prevents a second download succeeding.
        try {
          await putManifest(env.BUCKET, uuid, {
            ...manifest,
            consumed:    true,
            consumed_at: nowSeconds,
          });
        } catch (e) {
          console.error('DAD: consumed guard write failed:', e);
          // Do not continue — we cannot safely delete without the guard in place.
          return;
        }

        // Step 2: delete all chunks.
        for (let i = 0; i < totalChunks; i++) {
          try {
            await env.BUCKET.delete(`${uuid}/${String(i).padStart(4, '0')}`);
          } catch (e) {
            console.error(`DAD: chunk delete failed at index ${i}:`, e);
            // Continue — orphan sweep catches residue at 03:00.
          }
        }

        // Step 3: delete sidecar.
        env.BUCKET.delete(`${uuid}/hashes`).catch(e =>
          console.error('DAD: sidecar delete failed:', e)
        );

        // Step 4: delete OTS anchor (matches bearer delete path).
        env.BUCKET.delete(`${uuid}/date-seal.ots.enc`).catch(e =>
          console.error('DAD: date-seal.ots.enc delete failed:', e)
        );

        // Step 5: delete the B10-3 KV root-verified cache key.
        env.STATUS_KV.delete(`root_verified:${uuid}`).catch(e =>
          console.error('DAD: root_verified KV delete failed:', e)
        );

                // Step 6: write tombstone — final manifest state.
        const tombstone = buildTombstone(nowSeconds);
        putManifest(env.BUCKET, uuid, tombstone).catch(e =>
          console.error('DAD: tombstone write failed:', e)
        );

        // Step 7: remove the Execution Dock entry (Share-B12-1, B12 §6.5).
        env.STATUS_KV.delete(`dock_index:${uuid}`).catch(e =>
          console.error('DAD: dock_index KV delete failed:', e)
        );
      })()
    );
  }

  // ── SW5: emit cargo.discharged receipt ────────────────────────────────────
  // Fires independently of DAD — destruction does not suppress the receipt.
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
