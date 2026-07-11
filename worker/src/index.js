/**
 * index.js — Cloudflare Worker — refueler-share
 *
 * Endpoints:
 *   POST /credential/issue          NUT-00 blind sig issuance (free tier Turnstile gate)
 *   PUT  /upload/{uuid}/{chunk}     Chunked upload with NUT-00 credential verify
 *   POST /auth/{uuid}               NUT-11 Mode 1: passphrase verify → download token
 *   GET  /download/{uuid}/{chunk}   R2 chunk proxy (token required if p2sh_secret_hash set)
 *
 * Secrets (wrangler secret put):
 *   MINT_PRIVATE_KEY        secp256k1 hex (32 bytes) — also used as HMAC key for download tokens
 *   TURNSTILE_SECRET_KEY    Cloudflare Turnstile secret
 *   SUPABASE_URL            https://tihgvdokeofnjxjkenmm.supabase.co
 *   SUPABASE_SERVICE_KEY    service_role JWT
 *
 * Bindings (wrangler.toml):
 *   R2: BUCKET
 */

import { verifyTurnstileToken } from './turnstile.js';
import { issueBlindSignature, verifyCredential } from './nut00.js';
import { verifyChunkHash } from './blake3.js';
import {
  getManifest, putManifest, createManifest,
  isDownloadBlocked, requiresPassphrase,
  TIER_CAPS,
} from './manifest.js';
import {
  hashSecret, timingSafeEqual,
  issueDownloadToken, verifyDownloadToken,
} from './nut11.js';

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // POST /credential/issue
      if (request.method === 'POST' && path === '/credential/issue') {
        return handleCredentialIssue(request, env);
      }

      // PUT /upload/{uuid}/{chunk-index}
      const uploadMatch = path.match(/^\/upload\/([0-9a-f-]{36})\/(\d{4})$/i);
      if (request.method === 'PUT' && uploadMatch) {
        return handleUpload(request, env, uploadMatch[1], parseInt(uploadMatch[2], 10));
      }

      // POST /auth/{uuid}  — NUT-11 Mode 1 passphrase verify
      const authMatch = path.match(/^\/auth\/([0-9a-f-]{36})$/i);
      if (request.method === 'POST' && authMatch) {
        return handleAuth(request, env, authMatch[1]);
      }

      // GET /download/{uuid}/{chunk-index}
      const downloadMatch = path.match(/^\/download\/([0-9a-f-]{36})\/(\d{4})$/i);
      if (request.method === 'GET' && downloadMatch) {
        return handleDownload(request, env, downloadMatch[1], parseInt(downloadMatch[2], 10));
      }

      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.error('Worker error:', err);
      return new Response('Internal server error', { status: 500 });
    }
  },
};

// ---------------------------------------------------------------------------
// POST /credential/issue
// ---------------------------------------------------------------------------

async function handleCredentialIssue(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

  const { turnstile_token, blinded_message, tier = 'free' } = body;

  if (!turnstile_token || !blinded_message) {
    return err(400, 'Missing turnstile_token or blinded_message');
  }

  // Turnstile — fail closed
  const turnstileOk = await verifyTurnstileToken(turnstile_token, env.TURNSTILE_SECRET_KEY);
  if (!turnstileOk) {
    return err(403, 'Turnstile verification failed');
  }

  const allocationBytes = TIER_CAPS[tier] ?? TIER_CAPS.free;

  let signedPoint, mintPubkey;
  try {
    ({ signedPoint, mintPubkey } = await issueBlindSignature(blinded_message, env.MINT_PRIVATE_KEY));
  } catch (e) {
    console.error('Blind sig error:', e);
    return err(500, 'Credential issuance failed');
  }

  return json({ signed_point: signedPoint, mint_pubkey: mintPubkey, allocation_bytes: allocationBytes });
}

// ---------------------------------------------------------------------------
// PUT /upload/{uuid}/{chunk-index}
// ---------------------------------------------------------------------------

async function handleUpload(request, env, uuid, chunkIndex) {
  const isFirstChunk = chunkIndex === 0;

  if (isFirstChunk) {
    // --- First chunk: full credential verify + manifest creation ---

    const credential   = request.headers.get('X-Cashu-Credential');
    const blake3Root   = request.headers.get('X-Blake3-Root');
    const totalChunks  = parseInt(request.headers.get('X-Total-Chunks') ?? '0', 10);
    const totalBytes   = parseInt(request.headers.get('X-Total-Bytes') ?? '0', 10);
    const tier         = request.headers.get('X-Tier') ?? 'free';
    const expiryTs     = parseInt(request.headers.get('X-Expiry-Timestamp') ?? '0', 10);
    const chunkHash    = request.headers.get('X-Blake3-Chunk-Hash');
    // NUT-11: optional passphrase hash from client (already BLAKE3-hashed client-side)
    const p2shHash     = request.headers.get('X-P2SH-Secret-Hash') ?? null;

    if (!credential || !blake3Root || !totalChunks || !totalBytes || !expiryTs || !chunkHash) {
      return err(400, 'Missing required headers');
    }

    // Credential verify (NUT-00)
    let serial;
    try {
      serial = await verifyCredential(credential, env.MINT_PRIVATE_KEY);
    } catch (e) {
      return err(401, 'Invalid credential');
    }

    // Double-spend check (Supabase)
    const spentRes = await supabaseFetch(env, 'GET', `/rest/v1/spent_tokens?serial=eq.${encodeURIComponent(serial)}&select=serial`);
    if (!spentRes.ok) return err(502, 'Ledger unavailable');
    const spent = await spentRes.json();
    if (spent.length > 0) return err(409, 'Credential already spent');

    // Cap enforcement
    const cap = TIER_CAPS[tier] ?? TIER_CAPS.free;
    if (totalBytes > cap) return err(413, `Exceeds ${tier} tier cap`);

    // BLAKE3 chunk hash verify
    const chunkBody = await request.arrayBuffer();
    const hashOk = await verifyChunkHash(new Uint8Array(chunkBody), chunkHash);
    if (!hashOk) return err(400, 'BLAKE3 chunk hash mismatch');

    // Write chunk to R2
    await env.BUCKET.put(`${uuid}/${String(chunkIndex).padStart(4, '0')}`, chunkBody);

    // Write manifest (includes p2sh_secret_hash if passphrase-gated)
    const manifest = createManifest({
      uuid, tier, totalChunks, totalBytes,
      expiryTimestamp: expiryTs,
      blake3Root,
      p2shSecretHash: p2shHash,
    });
    manifest.chunks_received = [0];
    await putManifest(env.BUCKET, uuid, manifest);

    // NUT-07 melt — mark serial spent
    const meltRes = await supabaseFetch(env, 'POST', '/rest/v1/spent_tokens', { serial });
    if (!meltRes.ok) {
      // Log and continue — NUT-00 verify will reject replays
      console.error('NUT-07 melt failed — serial:', serial, await meltRes.text());
    }

    return json({ ok: true, chunk: 0, uuid });

  } else {
    // --- Subsequent chunks: manifest existence + expiry + hash verify ---

    const manifest = await getManifest(env.BUCKET, uuid);
    if (!manifest) return err(404, 'Transfer not found');
    if (manifest.upload_complete) return err(409, 'Upload already complete');

    // Loose expiry check during upload (grace period not relevant here)
    const now = Math.floor(Date.now() / 1000);
    if (now > manifest.expiry_timestamp) return err(410, 'Transfer expired');

    const chunkHashHeader = request.headers.get('X-Blake3-Chunk-Hash');
    if (!chunkHashHeader) return err(400, 'Missing X-Blake3-Chunk-Hash');

    const chunkBody = await request.arrayBuffer();
    const hashOk = await verifyChunkHash(new Uint8Array(chunkBody), chunkHashHeader);
    if (!hashOk) return err(400, 'BLAKE3 chunk hash mismatch');

    await env.BUCKET.put(`${uuid}/${String(chunkIndex).padStart(4, '0')}`, chunkBody);

    manifest.chunks_received.push(chunkIndex);
    if (manifest.chunks_received.length === manifest.total_chunks) {
      manifest.upload_complete = true;
    }
    await putManifest(env.BUCKET, uuid, manifest);

    return json({ ok: true, chunk: chunkIndex, uuid });
  }
}

// ---------------------------------------------------------------------------
// POST /auth/{uuid}  — NUT-11 Mode 1
// ---------------------------------------------------------------------------

async function handleAuth(request, env, uuid) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

  const { passphrase } = body;
  if (!passphrase || typeof passphrase !== 'string') {
    return err(400, 'Missing passphrase');
  }

  const manifest = await getManifest(env.BUCKET, uuid);
  if (!manifest) return err(404, 'Transfer not found');

  // If no passphrase gate, this endpoint should not be called — but handle gracefully
  if (!requiresPassphrase(manifest)) {
    return err(400, 'Transfer is not passphrase-protected');
  }

  // Expiry check
  if (isDownloadBlocked(manifest)) {
    return err(410, 'Transfer expired');
  }

  // Hash the submitted passphrase and compare — timing-safe
  const submitted = await hashSecret(passphrase);
  const match = timingSafeEqual(submitted, manifest.p2sh_secret_hash);

  if (!match) {
    // Constant delay to prevent timing oracle even with timing-safe compare
    await new Promise(r => setTimeout(r, 200));
    return err(401, 'Incorrect passphrase');
  }

  // Issue short-lived download token (15 min)
  const token = await issueDownloadToken(uuid, env.MINT_PRIVATE_KEY);

  return json({ token });
}

// ---------------------------------------------------------------------------
// GET /download/{uuid}/{chunk-index}
// ---------------------------------------------------------------------------

async function handleDownload(request, env, uuid, chunkIndex) {
  const manifest = await getManifest(env.BUCKET, uuid);
  if (!manifest) return err(404, 'Transfer not found');

  // Expiry + grace period check
  if (isDownloadBlocked(manifest)) {
    return err(410, 'Transfer expired');
  }

  // NUT-11 gate — if passphrase-protected, require valid download token
  if (requiresPassphrase(manifest)) {
    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return err(401, 'Download token required');

    const { valid, uuid: tokenUuid } = await verifyDownloadToken(token, env.MINT_PRIVATE_KEY);
    if (!valid || tokenUuid !== uuid) {
      return err(401, 'Invalid or expired download token');
    }
  }

  // Record download_initiated_at on first chunk
  if (chunkIndex === 0 && !manifest.download_initiated_at) {
    manifest.download_initiated_at = Math.floor(Date.now() / 1000);
    await putManifest(env.BUCKET, uuid, manifest);
  }

  const key = `${uuid}/${String(chunkIndex).padStart(4, '0')}`;
  const obj = await env.BUCKET.get(key, {
    range: request.headers.has('Range')
      ? parseRange(request.headers.get('Range'))
      : undefined,
  });

  if (!obj) return err(404, 'Chunk not found');

  const status = request.headers.has('Range') ? 206 : 200;
  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'private, no-store',
    'X-Transfer-UUID': uuid,
    'X-Chunk-Index': String(chunkIndex),
  });

  if (obj.range) {
    headers.set('Content-Range', `bytes ${obj.range.offset}-${obj.range.end}/${obj.size}`);
  }

  return new Response(obj.body, { status, headers });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseRange(rangeHeader) {
  const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!m) return undefined;
  const offset = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : undefined;
  return { offset, length: end !== undefined ? end - offset + 1 : undefined };
}

async function supabaseFetch(env, method, path, body = null) {
  const opts = {
    method,
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=minimal' : '',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${env.SUPABASE_URL}${path}`, opts);
}
