/**
 * finalise.js — POST /upload/:uuid/finalise
 * worker/src/handlers/finalise.js
 *
 * Share-6-3a handler, extracted from index.js unchanged (Share-Dash-2 fold),
 * then extended with the Execution Dock enrichment step (§6 below).
 * Share-6-6a: §2 HEAD-per-chunk completeness replaced with list()-based sweep.
 *
 * Session-token authed (NOT a Cashu re-spend). The Worker reads no chunk bodies.
 * It confirms every {uuid}/{iiii} object exists via R2 list() (Share-6-6a —
 * replaces per-chunk HEAD which hit the Workers subrequest ceiling at ~1000
 * chunks / ~30 GB), writes the {uuid}/hashes sidecar (raw 32-byte concat,
 * chunk order — merkle-spec §1/§2), records the browser-supplied
 * ciphertext-chunk merkle_root + tree_algo, flips upload_complete:true,
 * (session tokens are MAC'd, B12-3 — nothing to spend in KV), and enriches the Execution Dock KV entry with
 * rail · merkle_root. size_bytes is deliberately NOT written (B12-SR X4:
 * plaintext size is never persisted in KV).
 *
 * The root is TRUSTED here and RECONSTRUCTED at download (Share-6-5 / B9-3):
 * finalise writes, download verifies. The sidecar is written here and MUST
 * persist for Share-6-5 — it is never deleted in this handler.
 *
 * Body: { hashes: [b64url(32B) × chunk_count], merkle_root: b64url(32B) }.
 * chunk_count is read from the manifest (total_chunks) — never trusted from the
 * body. Returns 200 { ok:true, merkle_root }.
 *
 * NOTE ON merkle_root: the value stored is the CIPHERTEXT-CHUNK Merkle root only
 * — Worker-verifiable, storage-integrity. The plaintext blake3PlaintextRoot is
 * permanently barred from the Worker, KV, and every receipt (invariant). Never
 * store it here.
 *
 * Share-6-6a — completeness check change:
 *   OLD: N individual env.BUCKET.head() calls in windows of 64 concurrently.
 *        Approaches the ~1000 Workers subrequest ceiling for Chartered transfers
 *        (250 GB = 8,000 chunks). Each HEAD is one subrequest.
 *   NEW: env.BUCKET.list({ prefix: uuid + '/', limit: 1000 }) paged until
 *        list_complete. One R2 API call per 1000 objects — 8,000-chunk transfer
 *        needs 8 list() calls rather than 8,000 HEAD subrequests. The chunk
 *        key set is built locally; missing indices computed in O(N).
 */

import { UUID_RE, safeGetManifest, json, err, scrubUuids } from '../utils.js';
import { updateManifest } from '../latch.js';
import { putDockEntry, dockTtl } from './execution_dock.js';
import { verifySessionToken, sessionHash } from '../upload_session.js';
import { finaliseQuota } from '../quota_store.js';
import { wrongSizeSegments, DELETE_BATCH } from '../sweep_rules.js';
import { hasCref, hasQref } from '../seal.js';
import { issueReceipt } from '../receipts.js';

// base64url → Uint8Array. Returns null on any non-base64url input or decode
// failure; the caller enforces the exact 32-byte length. Strict base64url
// alphabet only (matches r2_presign.b64url on the way out). Moved here from
// index.js with handleFinalise — it had no other caller (Share-Dash-2 fold).
function b64urlToBytes(s) {
  if (typeof s !== 'string' || s.length === 0) return null;
  if (/[^A-Za-z0-9_-]/.test(s)) return null;
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  let bin;
  try { bin = atob(b64); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Minimal AE writer — mirrors index.js logEvent's data-point shape exactly so
// the one granular 401 log below survives the fold. index.js still logs the
// overall upload_finalise event via timed(); this only preserves the errorMsg.
function aeLog(env, { endpoint = '', tier = 'free', status = 200, errorMsg = '' }) {
  if (!env.AE) return;
  try {
    env.AE.writeDataPoint({
      blobs:   [endpoint, tier, scrubUuids(errorMsg), ''],
      doubles: [0, status, -1, 0, 0],
      indexes: [endpoint],
    });
  } catch (e) {
    console.error('AE write failed:', e);
  }
}

// Derive the internal rail name from the transfer tier for the Execution Dock.
// Internal architecture names ('identity' / 'anonymous') — the dashboard maps
// these to the user-facing Registered / Bearer at render (Share-Dash-3).
//
// Pre-B7 the anonymous (Lightning / Bearer) consumer rail is not live, so every
// paid transfer resolves to 'identity' and free transfers have no rail. When
// Bearer ships, derive from the credential's actual rail rather than the tier.
// Wire tiers today: free · creative · max (Stripe axis) · api (Chartered).
function railForTier(tier) {
  switch (tier) {
    case 'free':     return null;        // Pro Bono — no rail
    case 'creative':
    case 'max':      return 'identity';  // Registered (Stripe)
    case 'api':      return 'identity';  // Chartered — Bearer variant post-B7
    default:         return null;
  }
}

// ── Share-6-6a: list()-based completeness check ──────────────────────────────
//
// Pages through all R2 objects under {uuid}/ and builds a Set of chunk keys
// matching the four-digit pattern (e.g. "1eea013f-.../0000"). Non-chunk objects
// (manifest.json, hashes) are present under the same prefix but never match
// /^\d{4}$/ on the final path segment, so they are naturally excluded from the
// Set without an explicit filter step.
//
// Returns: { missing: string[], chunks: Map<"0000", { size }> }. `missing` holds
// the 4-digit index of each absent chunk (empty = all present). `chunks` carries
// each chunk object's R2 size for the B12-1d exact-size check.
//
// Subrequest cost:
//   ceil(chunkCount / 1000) list() calls vs chunkCount HEAD subrequests.
//   250 GB (8,000 chunks): 8 list() calls vs 8,000 HEADs.
//   4 GB (128 chunks):     1 list() call  vs 128 HEADs.
//
// Error handling: a list() failure throws; the caller (handleFinalise) lets it
// propagate to the outer 500 handler — same behaviour as a failed HEAD batch.
async function listBasedCompleteness(bucket, uuid, chunkCount) {
  const prefix    = `${uuid}/`;
  const chunkKeys = new Map();
  let cursor;

  do {
    const opts = cursor ? { prefix, limit: 1000, cursor } : { prefix, limit: 1000 };
    const page  = await bucket.list(opts);

    for (const obj of page.objects) {
      // Extract the final segment after the UUID prefix (e.g. "0000", "hashes").
      const segment = obj.key.slice(prefix.length);
      // Chunk keys are exactly 4 decimal digits — manifest.json and hashes excluded.
      if (/^\d{4}$/.test(segment)) chunkKeys.set(segment, { size: obj.size });
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const missing = [];
  for (let i = 0; i < chunkCount; i++) {
    const seg = String(i).padStart(4, '0');
    if (!chunkKeys.has(seg)) missing.push(seg);
  }

  return { missing, chunks: chunkKeys };
}

export async function handleFinalise(request, env, uuid, ctx) {
  if (!UUID_RE.test(uuid)) return err(400, 'Invalid transfer ID');

  // ── 1. Session-token auth (B12-3, SR S1.3) ────────────────────────────────
  // MAC'd token; the chunk count comes from the token, never from KV or the
  // body. No KV session record exists: "spent" is upload_complete in R2.
  const presented = request.headers.get('X-Upload-Session') ?? '';
  const session = await verifySessionToken(env, presented, uuid, Math.floor(Date.now() / 1000));
  if (!session) {
    aeLog(env, { endpoint: 'upload_finalise', status: 401, errorMsg: 'session_token_invalid' });
    return err(401, 'Invalid or expired upload session');
  }

  // ── Manifest (must agree with the token's chunk count) ─────────────────────
  const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (oversize)  return err(502, 'Transfer manifest exceeds size limit');
  if (!manifest) return err(404, 'Transfer not found');
  if (manifest.consumed === true) return err(410, 'Transfer has been destroyed');
  // KV-Fix-1a: finalise runs once. A replayed session must never re-write the
  // sidecar / merkle_root of a completed transfer.
  if (manifest.upload_complete === true) {
    aeLog(env, { endpoint: 'upload_finalise', status: 409, errorMsg: 'already_complete' });
    return json({ error: 'already_complete' }, 409);
  }
  const chunkCount = session.totalChunks;
  if (manifest.total_chunks !== chunkCount) {
    return err(502, 'Manifest chunk count does not match the upload session');
  }

  // ── 2. list()-based completeness — every {uuid}/{iiii} must exist ──────────
  // Share-6-6a: replaces the per-chunk HEAD window loop (64 concurrent HEADs
  // × N windows). list() pages up to 1000 objects per call — far cheaper on
  // subrequest budget and removes the ~1000-chunk ceiling for large transfers.
  // All missing indices are collected before returning 409 (same contract as
  // the old HEAD sweep — no stop-at-first behaviour).
  let missing, chunks;
  try {
    ({ missing, chunks } = await listBasedCompleteness(env.BUCKET, uuid, chunkCount));
  } catch (e) {
    console.error('list()-based completeness check failed:', e);
    return err(502, 'Storage completeness check failed');
  }
  if (missing.length > 0) {
    return json({ error: 'incomplete', missing }, 409);
  }

  // ── 2b. Exact-size check (B12-1d, B12-SR S1.1 / S1.10 rule 3) ──────────────
  // Full chunks must be exactly CHUNK_SIZE + 16; the tail no larger. Signed
  // content-length makes this unreachable through our URLs — this is the
  // backstop. Offending objects are deleted off the response path (DAD
  // pattern: ctx.waitUntil, never inline); the browser re-uploads them.
  // Runs before the body is read: a 409 here changes no state.
  const wrong = wrongSizeSegments(chunks, chunkCount);
  if (wrong.length > 0) {
    const keys = wrong.map(seg => `${uuid}/${seg}`);
    const del  = (async () => {
      for (let i = 0; i < keys.length; i += DELETE_BATCH) {
        await env.BUCKET.delete(keys.slice(i, i + DELETE_BATCH));
      }
    })().catch(e => console.error('wrong-size chunk delete failed:', e));
    ctx?.waitUntil?.(del);
    aeLog(env, { endpoint: 'upload_finalise', status: 409, errorMsg: 'wrong_size' });
    return json({ error: 'wrong_size', segments: wrong }, 409);
  }

  // ── 3. Read + validate chunk hashes and merkle_root from the body ──────────
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }
  const hashes = body?.hashes;
  if (!Array.isArray(hashes) || hashes.length !== chunkCount) {
    return err(400, 'hashes length must equal chunk count');
  }
  const sidecar = new Uint8Array(chunkCount * 32);
  for (let i = 0; i < chunkCount; i++) {
    const bytes = b64urlToBytes(hashes[i]);
    if (!bytes || bytes.length !== 32) {
      return err(400, `hash at index ${i} is not 32 bytes`);
    }
    sidecar.set(bytes, i * 32);
  }
  const merkleRoot = body?.merkle_root;
  const rootBytes  = b64urlToBytes(merkleRoot);
  if (!rootBytes || rootBytes.length !== 32) {
    return err(400, 'merkle_root is not 32 bytes');
  }

  // ── 4. Write the {uuid}/hashes sidecar (raw 32-byte concat, chunk order) ───
  // No padding: exactly chunk_count × 32 bytes. Never inline in the manifest
  // (64 KB safeGetManifest ceiling). This is the Share-6-5 verification input.
  try {
    await env.BUCKET.put(`${uuid}/hashes`, sidecar, {
      httpMetadata: { contentType: 'application/octet-stream' },
    });
  } catch (e) {
    console.error('hashes sidecar write failed:', e);
    return err(502, 'Failed to persist chunk hashes');
  }

  // ── 5. Update manifest (conditional — B12-3, latch.js) ────────────────────
  // A deletion that latched consumed:true meanwhile wins: finalise then 410s
  // and converts nothing (the latch winner already cancelled the reservation).
  const upd = await updateManifest(env.BUCKET, uuid, (m) =>
    (m.consumed === true || m.upload_complete === true) ? null
      : { ...m, merkle_root: merkleRoot, tree_algo: 'rfc6962-unbalanced-blake3-v1', upload_complete: true, status: 'complete' });
  if (upd.status === 'gone' || upd.before?.consumed === true) return err(410, 'Transfer has been destroyed');
  if (upd.status === 'declined') return json({ error: 'already_complete' }, 409);
  if (upd.status !== 'written') return err(503, 'Transfer busy — please retry');
  manifest.merkle_root     = merkleRoot;                      // trusted b64url string
  manifest.tree_algo       = 'rfc6962-unbalanced-blake3-v1';  // pinned — never vary
  manifest.upload_complete = true;
  manifest.status          = 'complete';   // OSA-Tools-2 F5 — same write as upload_complete

  // ── 5b. Quota: reserved → used (B12-SR S1.7) ───────────────────────────────
  // Idempotent in SQL. On error finalise still succeeds (the user's upload is
  // done) and the conversion retries 3× off the response path; if all fail the
  // nightly reconcile counts the transfer from R2 and drops the reservation.
  if (hasQref(manifest) && manifest.soak !== true) {
    const sh = await sessionHash(presented);
    const convert = async () => {
      for (const wait of [0, 2000, 5000, 15000]) {
        if (wait) await new Promise(r => setTimeout(r, wait));
        try { await finaliseQuota(env, sh); return; }
        catch (e) { console.error('finalise: quota conversion failed:', e?.message ?? e); }
      }
    };
    ctx?.waitUntil?.(convert());
  }

  // ── 6. Enrich the Execution Dock entry (Share-Dash-2; OSA-Tools-2 §6) ─────
  // The dock_index:{uuid} entry was created at initiate with
  // uuid · expiry_timestamp · tier · file_name · created_at. Add the two fields
  // known only now: rail (from the tier) and merkle_root (the ciphertext-chunk
  // root recorded at lodgement). size_bytes is NOT written (B12-SR X4) — legacy
  // entries that carry it age out on TTL; no backfill.
  //
  // READ-THEN-MERGE — never clobber; the uuid is kept (or added to a legacy
  // entry). An entry the initiate write never made (F1, before OSA-Tools-2) is
  // created here from the manifest. Value + metadata, TTL recomputed from expiry
  // with the initiate formula. A dock miss must never fail finalise.
  try {
    const dockKey  = `dock_index:${uuid}`;
    const existing = await env.STATUS_KV.get(dockKey, { type: 'json' });
    const entry = existing && typeof existing === 'object' ? existing : {
      expiry_timestamp: manifest.expiry_timestamp,
      tier:             manifest.tier ?? 'free',
      file_name:        'encrypted-payload',
      created_at:       manifest.created_at,
    };
    delete entry.size_bytes;   // X4: never carry a plaintext size forward
    entry.uuid        = uuid;
    entry.rail        = railForTier(entry.tier ?? manifest.tier);
    entry.merkle_root = merkleRoot; // ciphertext-chunk root — never the plaintext root
    if (Number.isFinite(entry.expiry_timestamp)) {
      const now = Math.floor(Date.now() / 1000);
      await putDockEntry(env.STATUS_KV, uuid, entry, dockTtl(entry.expiry_timestamp, now));
    }
  } catch (e) {
    console.error('Execution Dock enrich failed:', e?.message ?? e); // non-fatal
  }

  // ── 7. cargo.accepted (Share-6 spec §3③.4; API-Repair-1) ──────────────────
  // Chartered transfers only (sealed client in the manifest). Notification,
  // never control flow: finalise has already succeeded.
  if (hasCref(manifest)) {
    ctx?.waitUntil?.(issueReceipt(env, uuid, manifest, 'acceptance',
      { accepted_at: Math.floor(Date.now() / 1000) }));
  }

  return json({ ok: true, merkle_root: merkleRoot });
}
