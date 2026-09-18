/**
 * finalise.js — POST /upload/:uuid/finalise
 * worker/src/handlers/finalise.js
 *
 * Share-6-3a handler, extracted from index.js unchanged (Share-Dash-2 fold),
 * then extended with the Execution Dock enrichment step (§6 below).
 *
 * Session-token authed (NOT a Cashu re-spend). The Worker reads no chunk bodies.
 * It confirms every {uuid}/{iiii} object exists (HEAD), writes the {uuid}/hashes
 * sidecar (raw 32-byte concat, chunk order — merkle-spec §1/§2), records the
 * browser-supplied ciphertext-chunk merkle_root + tree_algo, flips
 * upload_complete:true, spends the session token, and enriches the Execution
 * Dock KV entry with size_bytes · rail · merkle_root.
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
 */

import { UUID_RE, safeGetManifest, json, err } from '../utils.js';
import { putManifest } from '../manifest.js';

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

// Timing-safe string compare. Local copy of index.js ctEqual (which stays in
// index.js — it has other callers there). Kept identical so the fold is
// behaviour-preserving; a handler in handlers/ is self-contained by convention.
function ctEqual(a, b) {
  const ab = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  if (ab.length !== bb.length) return false;
  try {
    if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(ab, bb);
  } catch { /* fall through to manual compare */ }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

// Minimal AE writer — mirrors index.js logEvent's data-point shape exactly so
// the one granular 401 log below survives the fold. index.js still logs the
// overall upload_finalise event via timed(); this only preserves the errorMsg.
function aeLog(env, { endpoint = '', tier = 'free', status = 200, errorMsg = '' }) {
  if (!env.AE) return;
  try {
    env.AE.writeDataPoint({
      blobs:   [endpoint, tier, errorMsg, ''],
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

export async function handleFinalise(request, env, uuid) {
  if (!UUID_RE.test(uuid)) return err(400, 'Invalid transfer ID');

  // ── 1. Session-token auth (timing-safe compare vs KV) ──────────────────────
  const presented = request.headers.get('X-Upload-Session') ?? '';
  let stored = null;
  try {
    stored = await env.STATUS_KV.get(`upload_session:${uuid}`);
  } catch (e) {
    console.error('upload_session KV read failed:', e);
    return err(502, 'Session store unavailable');
  }
  if (!presented || !stored || !ctEqual(presented, stored)) {
    aeLog(env, { endpoint: 'upload_finalise', status: 401, errorMsg: 'session_token_invalid' });
    return err(401, 'Invalid or expired upload session');
  }

  // ── Manifest (source of truth for chunk_count == total_chunks) ─────────────
  const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (oversize)  return err(502, 'Transfer manifest exceeds size limit');
  if (!manifest) return err(404, 'Transfer not found');
  const chunkCount = manifest.total_chunks;
  if (!Number.isInteger(chunkCount) || chunkCount < 1) {
    return err(502, 'Manifest is missing a valid chunk count');
  }

  // ── 2. HEAD completeness — every {uuid}/{iiii} must exist ──────────────────
  // No bodies read. Collect ALL missing indices, then 409 with the full list —
  // never stop at the first gap. Bounded concurrency keeps us clear of the
  // connection cap; see the large-N note in the session hand-off.
  const HEAD_WINDOW = 64;
  const missing = [];
  for (let start = 0; start < chunkCount; start += HEAD_WINDOW) {
    const end = Math.min(start + HEAD_WINDOW, chunkCount);
    const window = [];
    for (let i = start; i < end; i++) window.push(i);
    const results = await Promise.all(window.map(async (i) => {
      const obj = await env.BUCKET.head(`${uuid}/${String(i).padStart(4, '0')}`);
      return obj === null ? i : -1;
    }));
    for (const i of results) if (i !== -1) missing.push(String(i).padStart(4, '0'));
  }
  if (missing.length > 0) {
    return json({ error: 'incomplete', missing }, 409);
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

  // ── 5. Update manifest + spend the session token ───────────────────────────
  manifest.merkle_root     = merkleRoot;                      // trusted b64url string
  manifest.tree_algo       = 'rfc6962-unbalanced-blake3-v1';  // pinned — never vary
  manifest.upload_complete = true;
  await putManifest(env.BUCKET, uuid, manifest);

  try {
    await env.STATUS_KV.delete(`upload_session:${uuid}`);      // session is spent
  } catch (e) {
    console.error('upload_session KV delete failed:', e);      // manifest already written — do not fail
  }

  // ── 6. Enrich the Execution Dock entry (Share-Dash-2) ──────────────────────
  // The dock_index:{uuid} entry was created at initiate with
  // expiry_timestamp · tier · file_name · created_at. Add the three fields
  // known only now: size_bytes (from the manifest), rail (from the tier), and
  // merkle_root (the ciphertext-chunk root recorded at lodgement).
  //
  // READ-THEN-MERGE — never clobber. collected / collected_at are written at
  // collection by a different path; overwriting the whole key would erase them.
  // KV put() drops the TTL unless re-specified, so recompute it from expiry
  // using the same formula the initiate write used. Fire-and-forget: the
  // transfer has already succeeded above — a dock miss must never fail finalise.
  try {
    const dockKey  = `dock_index:${uuid}`;
    const existing = await env.STATUS_KV.get(dockKey, { type: 'json' });
    if (existing && typeof existing === 'object') {
      existing.size_bytes  = manifest.total_bytes ?? 0;
      existing.rail        = railForTier(existing.tier ?? manifest.tier);
      existing.merkle_root = merkleRoot; // ciphertext-chunk root — never the plaintext root
      const now = Math.floor(Date.now() / 1000);
      const ttl = Math.max((existing.expiry_timestamp - now) + 48 * 3600 + 3600, 3600);
      await env.STATUS_KV.put(dockKey, JSON.stringify(existing), { expirationTtl: ttl });
    }
  } catch (e) {
    console.error('Execution Dock enrich failed:', e); // non-fatal
  }

  return json({ ok: true, merkle_root: merkleRoot });
}
