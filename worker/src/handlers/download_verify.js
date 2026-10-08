/**
 * download_verify.js — Share-6-5a (B9-3 server half), WASM-hashed as of Share-6-5d
 * worker/src/handlers/download_verify.js
 *
 * Worker-side ciphertext storage-integrity verification for the download path.
 * Implements merkle-spec-v1.md §3 steps 1–4 inside the per-chunk download
 * handler, and Share-6-spec-v1.md §4 (integrity reconciliation) + §10.
 *
 * SCOPE — read before touching:
 *   This verifies the CIPHERTEXT-CHUNK Merkle root only. The Worker sees
 *   ciphertext; it attests "the encrypted object served equals the encrypted
 *   object stored" (storage integrity). It is NOT end-to-end integrity — that
 *   is the recipient's plaintext check against blake3PlaintextRoot, which never
 *   enters the Worker. Never conflate them. Never emit blake3_root here. Never
 *   set verified:true on a receipt here — that is 6-5b / B9-4, barred in 6-5a.
 *
 * LEAF DEFINITION (merkle-spec §1 operative clause, Share-6 §4 phrasing fix):
 *   leaf i = BLAKE3 over EXACTLY the stored bytes of {uuid}/{iiii}
 *            (ciphertext ‖ GCM tag — NO IV/nonce prepend; the session IV lives
 *            in the URL fragment, never per-object). Do not "fix" the IV scheme
 *            here (Share-6 §10 / invariant) — the leaf binds to the stored bytes.
 *
 * BLAKE3 SOURCE (Share-6-5d change — the ONLY behavioural change this session):
 *   The per-chunk body hash (verifyChunkBody, the 32 MiB CPU hog) now runs through
 *   the vendored WASM BLAKE3 via ../blake3_wasm.js hashOneShot(), instead of the
 *   pure-JS @noble/hashes pass that forced Workers Paid + cpu_ms=300000 in 6-5c.
 *   The WASM output is proven byte-for-byte identical to pinned noble v1 (empty,
 *   small, and a real 32 MiB input — see worker/test/share-6-5d.test.js), so every
 *   digest, every 409, and every root reconciliation is unchanged; only the CPU
 *   cost drops. The tree function is still IMPORTED from ../merkle.js (6-3b) and
 *   never reimplemented (session brief; merkle-spec §10). merkle.js is left on
 *   noble by design (it hashes only 33/65-byte nodes — the swap there buys nothing
 *   and would disturb the parity keystone). Both hashers agree byte-for-byte, so
 *   the reconstructed root (noble) and the chunk-body digests (WASM) still meet.
 *
 * Share-B10-3 change — KV-cached root verification:
 *   The root reconstruction (steps 2–3, the CPU-expensive noble tree over N leaves)
 *   was running on every chunk request. For large transfers (>128 chunks, streaming
 *   path) this exhausted cpu_ms under load, causing reconstructRoot to throw inside
 *   the try/catch, which returned { ok:false, code:'integrity_failed' } — a false
 *   409 with no real tamper event. Fix: readSidecarWithRootCheck() replaces the
 *   direct reconstructAndCheckRoot() call in download.js. It writes a KV flag
 *   `root_verified:{uuid}` (TTL = transfer expiry) on first proof, then trusts it
 *   on subsequent chunks — skipping reconstruction and reading the sidecar directly.
 *   reconstructAndCheckRoot() is unchanged and still exported (tests, future use).
 *   verifyChunkBody() (step 4) still runs on every chunk — the security-bearing
 *   check is untouched. Security trade documented in download.js.
 */

import { hashOneShot, hashStream } from '../blake3_wasm.js';
import { reconstructRoot, TREE_ALGO } from '../merkle.js';
import { deriveKvMacKey, makeRootVerifiedValue, checkRootVerifiedValue } from '../kvmac.js';

const DIGEST_LEN = 32;

// KV key prefix for the cached root-verified flag (Share-B10-3).
// TTL is set to the transfer's remaining lifetime so it self-expires with the
// transfer. The value is '1' — presence is the signal, content is irrelevant.
const ROOT_VERIFIED_PREFIX = 'root_verified:';

// Safari-Slow-Link-1: one download path for every size. The ≤128-chunk buffer
// path and the >128 stream-then-abort path (VERIFY_INLINE_CHUNK_THRESHOLD) are
// gone: download.js hashes each part as it is read (verifyChunkStream), then
// streams a second read of the same object. Every part now verifies before its
// first byte, so every mismatch is a clean 409.

// ── Gate predicate ───────────────────────────────────────────────────────────
// Per-manifest, NOT a global flag (session brief: "gate switch = per-manifest
// upload_complete + sidecar presence, not a global flag").
//
// A manifest is on the VERIFIED path iff it was finalised by Share-6-3:
//   upload_complete === true  AND  merkle_root is a string  AND  tree_algo pinned.
// merkle_root presence is the real discriminator — upload_complete alone is set
// true by the LEGACY PUT path too, so it never separates 6-3 from pre-6-3.
// Pre-6-3 manifests (no merkle_root) fall through to the legacy serve and MUST
// NOT be 409'd (session brief; Share-6 §4). Sidecar presence is confirmed at
// read time in reconstructAndCheckRoot (a manifest claiming a root but missing
// its sidecar is an integrity failure, not a legacy file).
export function isVerifiedPath(manifest) {
  return (
    manifest?.upload_complete === true &&
    typeof manifest?.merkle_root === 'string' &&
    manifest.merkle_root.length > 0 &&
    manifest?.tree_algo === TREE_ALGO
  );
}

// ── base64url → bytes (matches finalise.js decoder; strict alphabet) ─────────
// The manifest merkle_root is stored as the b64url string the browser sent at
// finalise. Decode it to compare against the reconstructed 32 raw bytes.
export function b64urlToBytes(s) {
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

// Constant-time 32-byte compare. Uint8Array in, no early exit on first diff.
export function ctEqualBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  try {
    if (crypto?.subtle?.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  } catch { /* fall through */ }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Split a raw sidecar (N × 32 concat) into an array of 32-byte leaf digests.
// These are the per-chunk ciphertext digests — the INPUT to merkle.js, which
// applies its own 0x00 leaf-domain prefix. Do not prefix here.
function sidecarToLeaves(sidecar, chunkCount) {
  const leaves = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i++) {
    leaves[i] = sidecar.subarray(i * DIGEST_LEN, (i + 1) * DIGEST_LEN);
  }
  return leaves;
}

/**
 * merkle-spec §3 steps 1–3, evaluated once per verified request.
 *
 * Reads {uuid}/hashes (one small R2 GET), length-checks it against
 * chunk_count × 32, reconstructs the RFC-6962-unbalanced-BLAKE3 root via
 * merkle.js, and compares to the manifest merkle_root. On any failure returns
 * a 409-shaped result the caller turns into a response; on success returns the
 * decoded sidecar so the caller can verify individual chunk bodies (step 4)
 * without a second GET.
 *
 * NOTE (Share-B10-3): download.js no longer calls this directly on every chunk.
 * Call readSidecarWithRootCheck() instead, which gates this behind a KV flag.
 * This function remains exported for tests and any future non-hot-path callers.
 *
 * @returns {Promise<{ok:true, sidecar:Uint8Array, chunkCount:number}
 *                 | {ok:false, code:string, detail:string}>}
 */
export async function reconstructAndCheckRoot(env, uuid, manifest) {
  const chunkCount = manifest.total_chunks;
  if (!Number.isInteger(chunkCount) || chunkCount < 1) {
    return { ok: false, code: 'integrity_failed', detail: 'manifest chunk_count invalid' };
  }

  // Step 1 already done by the caller (manifest read). Step 2: single sidecar GET.
  let obj;
  try {
    obj = await env.BUCKET.get(`${uuid}/hashes`);
  } catch (e) {
    console.error('sidecar GET failed:', e);
    return { ok: false, code: 'integrity_failed', detail: 'sidecar unavailable' };
  }
  // A manifest on the verified path (merkle_root present) with NO sidecar is an
  // integrity failure, not a legacy file. Legacy files never reach here.
  if (!obj) {
    return { ok: false, code: 'integrity_failed', detail: 'sidecar missing' };
  }

  const sidecar = new Uint8Array(await obj.arrayBuffer());
  if (sidecar.length !== chunkCount * DIGEST_LEN) {
    return {
      ok: false,
      code: 'integrity_failed',
      detail: `sidecar length ${sidecar.length} != ${chunkCount * DIGEST_LEN}`,
    };
  }

  // Step 3: reconstruct root from the sidecar, compare to the manifest root.
  const manifestRoot = b64urlToBytes(manifest.merkle_root);
  if (!manifestRoot || manifestRoot.length !== DIGEST_LEN) {
    return { ok: false, code: 'integrity_failed', detail: 'manifest merkle_root malformed' };
  }

  let rebuilt;
  try {
    rebuilt = reconstructRoot(sidecarToLeaves(sidecar, chunkCount));
  } catch (e) {
    // merkle.js throws on empty/malformed leaves — treated as integrity failure.
    console.error('root reconstruction threw:', e);
    return { ok: false, code: 'integrity_failed', detail: 'reconstruction error' };
  }

  if (!ctEqualBytes(rebuilt, manifestRoot)) {
    return { ok: false, code: 'integrity_failed', detail: 'reconstructed root != manifest root' };
  }

  return { ok: true, sidecar, chunkCount };
}

/**
 * Share-B10-3: KV-cached sidecar fetch + root verification.
 *
 * This is the function download.js calls on every chunk request. It replaces
 * the bare reconstructAndCheckRoot() call that ran the full noble tree
 * reconstruction on every chunk — which exhausted cpu_ms on large transfers
 * (>128 chunks) and caused false 409s under load.
 *
 * Behaviour:
 *   - Always reads {uuid}/hashes from R2 (the sidecar must be fetched every
 *     request so verifyChunkBody has its leaf data — this R2 GET is unavoidable).
 *   - On the FIRST chunk request for a given uuid (KV flag absent): runs the
 *     full root reconstruction (steps 2–3) and writes `root_verified:{uuid}`
 *     to STATUS_KV with TTL = remaining transfer lifetime. From this point on
 *     the sidecar is proven structurally consistent with the manifest root.
 *   - On SUBSEQUENT chunk requests (KV flag present): skips reconstruction,
 *     trusts the cached proof, returns the sidecar directly. One KV read
 *     (~0.2 ms) replaces ~6,399 noble BLAKE3 hashes (hundreds of ms at scale).
 *   - verifyChunkBody (step 4) still runs on every chunk in download.js — the
 *     security-bearing check is completely untouched.
 *
 * Security model:
 *   The root reconstruction proves the sidecar is structurally consistent with
 *   the manifest merkle_root committed at finalise. An attacker who can write to
 *   R2 and patch both a chunk and its sidecar entry would evade step 4 but not
 *   step 3. By caching the step 3 result in KV, we accept that subsequent chunks
 *   are served on the basis of a cached proof rather than a live one. This is
 *   sound because: (a) the proof is established from the live sidecar on the
 *   first request; (b) verifyChunkBody independently checks each chunk's bytes
 *   against its sidecar entry on every request, which catches any per-chunk
 *   R2 tamper regardless of the root; (c) the manifest merkle_root in R2 is
 *   equally attackable by any adversary who can write to R2 — the root check
 *   does not protect against a fully compromised storage layer; (d) the
 *   recipient's plaintext blake3_root check is the terminal integrity guarantee.
 *
 * KV key: `root_verified:{uuid}`  value: `{v:1, mac}` (KV-Fix-1a, kvmac.js)  TTL: transfer remaining lifetime
 * (min 60 s to avoid KV rejecting a zero/negative TTL on nearly-expired transfers)
 *
 * @returns {Promise<{ok:true, sidecar:Uint8Array, chunkCount:number}
 *                 | {ok:false, code:string, detail:string}>}
 */
export async function readSidecarWithRootCheck(env, uuid, manifest) {
  const chunkCount = manifest.total_chunks;
  if (!Number.isInteger(chunkCount) || chunkCount < 1) {
    return { ok: false, code: 'integrity_failed', detail: 'manifest chunk_count invalid' };
  }

  // Always read the sidecar — verifyChunkBody needs the leaf data every time.
  let obj;
  try {
    obj = await env.BUCKET.get(`${uuid}/hashes`);
  } catch (e) {
    console.error('sidecar GET failed:', e);
    return { ok: false, code: 'integrity_failed', detail: 'sidecar unavailable' };
  }
  if (!obj) {
    return { ok: false, code: 'integrity_failed', detail: 'sidecar missing' };
  }

  const sidecar = new Uint8Array(await obj.arrayBuffer());
  if (sidecar.length !== chunkCount * DIGEST_LEN) {
    return {
      ok: false,
      code: 'integrity_failed',
      detail: `sidecar length ${sidecar.length} != ${chunkCount * DIGEST_LEN}`,
    };
  }

  const manifestRoot = b64urlToBytes(manifest.merkle_root);
  if (!manifestRoot || manifestRoot.length !== DIGEST_LEN) {
    return { ok: false, code: 'integrity_failed', detail: 'manifest merkle_root malformed' };
  }

  // Check the KV flag — if present AND its MAC verifies, root was proven on a
  // prior chunk request. KV-Fix-1a: the flag is MAC'd over uuid ‖ merkle_root
  // (kvmac.js); a forged, copied, stale or legacy '1' value reads as absent.
  // No KV_MAC_KEY → macKey null → never trusted, never written (always rebuild).
  const kvKey  = `${ROOT_VERIFIED_PREFIX}${uuid}`;
  const macKey = await deriveKvMacKey(env, 'rootv');
  let rootAlreadyVerified = false;
  if (macKey) {
    try {
      const flag = await env.STATUS_KV.get(kvKey);
      rootAlreadyVerified = await checkRootVerifiedValue(macKey, uuid, manifestRoot, flag);
    } catch (e) {
      // KV read failure: conservative path — treat as unverified, run reconstruction.
      console.error('root_verified KV read failed, falling back to reconstruction:', e);
    }
  }

  if (!rootAlreadyVerified) {
    // First request (or flag absent / unverifiable): run the full reconstruction.
    let rebuilt;
    try {
      rebuilt = reconstructRoot(sidecarToLeaves(sidecar, chunkCount));
    } catch (e) {
      console.error('root reconstruction threw:', e);
      return { ok: false, code: 'integrity_failed', detail: 'reconstruction error' };
    }

    if (!ctEqualBytes(rebuilt, manifestRoot)) {
      return { ok: false, code: 'integrity_failed', detail: 'reconstructed root != manifest root' };
    }

    // Root proven. Write the MAC'd flag so subsequent chunks skip reconstruction.
    // TTL = remaining transfer lifetime, floored at 60 s (KV rejects zero/negative).
    if (macKey) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const expiryTs   = manifest.expiry_timestamp ?? (nowSeconds + 86400);
      const ttl        = Math.max(expiryTs - nowSeconds, 60);
      try {
        const value = await makeRootVerifiedValue(macKey, uuid, manifestRoot);
        if (value) await env.STATUS_KV.put(kvKey, value, { expirationTtl: ttl });
      } catch (e) {
        // Non-fatal: the flag just won't be set. Next chunk re-runs reconstruction.
        console.error('root_verified KV write failed (non-fatal):', e);
      }
    }
  }

  return { ok: true, sidecar, chunkCount };
}

/**
 * merkle-spec §3 step 4 (body half): recompute BLAKE3 over EXACTLY the stored
 * bytes of one chunk and compare to sidecar entry i. Whole-chunk only — a
 * partial (Range) body cannot match a whole-chunk leaf, which is why the caller
 * rejects Range on the verified path (416) rather than pretending to verify it.
 *
 * Share-6-5d: the digest is now computed by the vendored WASM BLAKE3
 * (hashOneShot), byte-for-byte identical to the noble pass it replaces. This is
 * the one 32 MiB-per-request operation the swap targets; both the ≤128 buffer
 * path (download.js) and the >128 streaming path (makeVerifyingStream, which
 * calls straight into this function at flush) inherit the WASM hash for free.
 *
 * @param {Uint8Array} chunkBytes  exactly the stored bytes of {uuid}/{iiii}
 * @param {Uint8Array} sidecar     the full decoded sidecar
 * @param {number} i               chunk index
 * @returns {boolean} true iff the recomputed digest equals sidecar[i]
 */
export function verifyChunkBody(chunkBytes, sidecar, i) {
  const expected = sidecar.subarray(i * DIGEST_LEN, (i + 1) * DIGEST_LEN);
  const actual = hashOneShot(chunkBytes); // 32-byte digest over the stored bytes (WASM)
  return ctEqualBytes(actual, expected);
}

/**
 * verifyChunkBody over a stream: hashes the stored bytes as they are read
 * (hashStream), holding none of them. Same digest, same comparison.
 * Throws if the stream errors (the caller answers 502, retryable).
 *
 * @param {ReadableStream<Uint8Array>} stream  body of {uuid}/{iiii}
 * @param {Uint8Array} sidecar  the full decoded sidecar
 * @param {number} i            chunk index
 * @returns {Promise<boolean>}  true iff the digest equals sidecar[i]
 */
export async function verifyChunkStream(stream, sidecar, i) {
  const expected = sidecar.subarray(i * DIGEST_LEN, (i + 1) * DIGEST_LEN);
  return ctEqualBytes(await hashStream(stream), expected);
}
