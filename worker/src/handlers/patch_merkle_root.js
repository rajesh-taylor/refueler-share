/**
 * patch_merkle_root.js — POST /admin/patch-merkle-root
 * worker/src/handlers/patch_merkle_root.js
 *
 * Share-6-6a: one-shot admin endpoint to fix a manifest whose merkle_root was
 * computed without the RFC 6962 0x00 leaf domain tag (test-harness bug).
 *
 * Reads {uuid}/hashes from R2, recomputes the correct root via reconstructRoot
 * (mirrors worker/src/merkle.js exactly), and patches {uuid}/manifest.json
 * in-place if the stored root is wrong.
 *
 * Body: { "uuid": "<transfer-uuid>" }
 * Response: { uuid, old_root, new_root, patched: true|false }
 *
 * Admin-key gated (X-Admin-Key header).
 */

import { UUID_RE, json } from '../utils.js';
import { reconstructRoot } from '../merkle.js';

const DIGEST_LEN = 32;

/** Parse the raw sidecar bytes into an array of 32-byte Uint8Arrays. */
function parseSidecar(buf) {
  if (buf.byteLength % DIGEST_LEN !== 0) {
    throw new Error(`Sidecar length ${buf.byteLength} not divisible by ${DIGEST_LEN}`);
  }
  const count = buf.byteLength / DIGEST_LEN;
  const digests = [];
  for (let i = 0; i < count; i++) {
    digests.push(new Uint8Array(buf, i * DIGEST_LEN, DIGEST_LEN));
  }
  return digests;
}

function toB64url(u8) {
  // Workers-compatible base64url encode
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function handlePatchMerkleRoot(request, env) {
  // Auth
  const adminKey = request.headers.get('X-Admin-Key') ?? '';
  if (!adminKey || !env.ADMIN_KEY || adminKey !== env.ADMIN_KEY) {
    return json({ error: 'forbidden' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const uuid = body?.uuid ?? '';
  if (!UUID_RE.test(uuid)) return json({ error: 'invalid_uuid' }, 400);

  // 1. Read sidecar
  const sidecarObj = await env.BUCKET.get(`${uuid}/hashes`);
  if (!sidecarObj) return json({ error: 'sidecar_not_found', uuid }, 404);
  const sidecarBuf = await sidecarObj.arrayBuffer();

  let digests;
  try { digests = parseSidecar(sidecarBuf); }
  catch (e) { return json({ error: 'sidecar_parse_error', detail: e.message }, 500); }

  // 2. Recompute correct root
  const correctRoot    = reconstructRoot(digests);
  const correctRootB64 = toB64url(correctRoot);

  // 3. Read manifest
  const manifestObj = await env.BUCKET.get(`${uuid}/manifest.json`);
  if (!manifestObj) return json({ error: 'manifest_not_found', uuid }, 404);
  const manifest = await manifestObj.json();

  const oldRoot = manifest.merkle_root ?? null;

  if (oldRoot === correctRootB64) {
    return json({ uuid, old_root: oldRoot, new_root: correctRootB64, patched: false,
                  note: 'Root already correct — no change made.' });
  }

  // 4. Patch and write manifest
  manifest.merkle_root = correctRootB64;
  await env.BUCKET.put(`${uuid}/manifest.json`,
    JSON.stringify(manifest),
    { httpMetadata: { contentType: 'application/json' } });

  return json({
    uuid,
    chunk_count: digests.length,
    old_root:    oldRoot,
    new_root:    correctRootB64,
    patched:     true,
  });
}
