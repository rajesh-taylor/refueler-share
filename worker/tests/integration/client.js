/**
 * worker/tests/integration/client.js
 * Thin HTTP client for the integration suite. Endpoint helpers return
 * { status, headers, body }; no assertions here — they belong in test files.
 * Pure ESM, no Vitest imports: test files call init() with inject() values.
 *
 * Rewritten Integration-Repair-1 (28 Oct 2026) for today's Worker:
 *   - the transfer UUID travels in X-Transfer-UUID and the part in X-Part,
 *     never in a path (UUID-Out-Of-Path-1; docs/ROUTES.md)
 *   - credential v2: X-Cashu-Credential = {id, amount: 1, secret, C}, the
 *     keyset id from /credential/issue, checked by verifyProofV2 (nut00.js)
 *   - upload = POST /upload/initiate → chunk PUTs → POST /upload/finalise
 *     (Share-6). Initiate hands back presigned R2 URLs, which wrangler dev
 *     --local can't receive, so upload() writes the chunk bytes straight into
 *     the local bucket wrangler dev persists to (getPlatformProxy, same dir).
 *     Everything around that — spend, manifest, session token, completeness,
 *     size, sidecar, merkle root, verified download — is the real Worker.
 *
 * BDHKE credential flow:
 *   1. Random secret x (64 hex) and blinding factor r
 *   2. B_ = hash_to_curve(utf8(x)) + r*G
 *   3. POST /credential/issue → { signed_point C_, mint_pubkey K, keyset_id, uuid, commitment, issued_tier }
 *   4. Unblind: C = C_ - r*K
 */

import { createHash, randomBytes } from 'node:crypto';
import { join }                     from 'node:path';
import { secp256k1 }                from '@noble/curves/secp256k1.js';
import { blake3 }                   from '@noble/hashes/blake3';
import { reconstructRoot }          from '../../src/merkle.js';
import { hashSecret }               from '../../src/nut11.js';

const Point = secp256k1.Point;

export const CHUNK_SIZE      = 32 * 1024 * 1024;   // sweep_rules.js
export const CHUNK_TAG_BYTES = 16;                 // AES-GCM tag on every stored chunk
export const DAY             = 24 * 3600;

// ── Run settings (from globalSetup via inject) ──────────────────────────────

let cfg = null;
let proxy = null;

/** init({ workerUrl, persistDir, envFile }) — call once per test file (beforeAll). */
export function init(settings) {
  cfg = settings;
}

function baseUrl() {
  if (!cfg?.workerUrl) throw new Error('client.init() not called — pass inject() values in beforeAll');
  return cfg.workerUrl;
}

/** The local R2 bucket wrangler dev uses (same persist dir, same bucket). */
export async function bucket() {
  if (!proxy) {
    const { getPlatformProxy } = await import('wrangler');
    proxy = await getPlatformProxy({
      configPath: join(process.cwd(), 'wrangler.toml'),
      persist:    { path: join(cfg.persistDir, 'v3') },   // wrangler dev --persist-to keeps state under v3/
      envFiles:   [cfg.envFile],                          // never .dev.vars
    });
  }
  return proxy.env.BUCKET;
}

/** close() — dispose the bucket proxy (afterAll). */
export async function close() {
  if (proxy) await proxy.dispose();
  proxy = null;
}

// ── HTTP ────────────────────────────────────────────────────────────────────

/** A fresh client IP per call unless one is given: rate limits are per IP. */
export function uniqueIp(label = 'test') {
  return `${label}-${randomBytes(6).toString('hex')}`;
}

async function parseBody(res) {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try { return await res.json(); } catch { return null; }
  }
  return await res.text();
}

export async function request(method, path, { headers = {}, body, ip } = {}) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: { ...headers, 'CF-Connecting-IP': ip ?? uniqueIp() },
    body,
  });
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: await parseBody(res),
  };
}

// ── NUT-00 (duplicated from nut00.js / the browser — no Worker imports) ─────

const sha256 = (b) => createHash('sha256').update(b).digest();
const DST = Buffer.from('Secp256k1_HashToCurve_Cashu_');

function hashToCurve(msg) {
  const m = sha256(Buffer.concat([DST, msg]));
  for (let c = 0; c < 0xffffffff; c++) {
    const cb = Buffer.alloc(4); cb.writeUInt32LE(c);
    try {
      return Point.fromHex(Buffer.concat([Buffer.from([2]), sha256(Buffer.concat([m, cb]))]).toString('hex'));
    } catch { /* not on the curve — next counter */ }
  }
  throw new Error('hash_to_curve: exhausted counter space');
}

/** A Turnstile token never used before (the Worker refuses a replayed one). */
export function freshTurnstileToken() {
  return `integration.${randomBytes(16).toString('hex')}`;
}

/**
 * issueCredential({ ip, tier, turnstileToken }) → issue response; on 200,
 * body.proof is the ready X-Cashu-Credential value.
 */
export async function issueCredential({ ip, tier, turnstileToken } = {}) {
  const secret = randomBytes(32).toString('hex');
  const r  = BigInt(`0x${randomBytes(32).toString('hex')}`) % Point.Fn.ORDER;
  const B_ = hashToCurve(Buffer.from(secret)).add(Point.BASE.multiply(r));
  const res = await request('POST', '/credential/issue', {
    ip,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blinded_message: B_.toHex(true),
      turnstile_token: turnstileToken ?? freshTurnstileToken(),
      ...(tier ? { tier } : {}),
    }),
  });
  if (res.status === 200) {
    const b = res.body;
    const C = Point.fromHex(b.signed_point).subtract(Point.fromHex(b.mint_pubkey).multiply(r)).toHex(true);
    b.proof = JSON.stringify({ id: b.keyset_id, amount: 1, secret, C });
  }
  return res;
}

// ── Upload ──────────────────────────────────────────────────────────────────

/**
 * initiateHeaders(cred, opts) — the headers POST /upload/initiate reads.
 * opts: { uuid, totalBytes, expiryTs, password, destroyAfterDownload,
 *         availableFrom, availableUntil, proof, commitment, issuedTier }
 */
export async function initiateHeaders(cred, opts = {}) {
  const totalBytes = opts.totalBytes ?? 1024;
  const h = {
    'X-Transfer-UUID':         opts.uuid ?? cred.uuid,
    'X-Cashu-Credential':      opts.proof ?? cred.proof,
    'X-Credential-Commitment': opts.commitment ?? cred.commitment,
    'X-Issued-Tier':           opts.issuedTier ?? cred.issued_tier,
    'X-Total-Chunks':          String(opts.totalChunks ?? Math.ceil(totalBytes / CHUNK_SIZE)),
    'X-Total-Bytes':           String(totalBytes),
    'X-Expiry-Timestamp':      String(opts.expiryTs ?? Math.floor(Date.now() / 1000) + 7 * DAY),
  };
  if (opts.password)                h['X-P2SH-Secret-Hash']       = await hashSecret(opts.password);
  if (opts.destroyAfterDownload)    h['X-Destroy-After-Download'] = '1';
  if (opts.availableFrom  != null)  h['X-Available-From']         = String(opts.availableFrom);
  if (opts.availableUntil != null)  h['X-Available-Until']        = String(opts.availableUntil);
  return h;
}

/** POST /upload/initiate */
export async function initiate(headers, { ip } = {}) {
  return request('POST', '/upload/initiate', { headers, ip });
}

/**
 * Stand-in ciphertext for each chunk: random bytes at the sizes initiate
 * signs for (full chunks CHUNK_SIZE + tag, the tail its own length + tag).
 * The Worker never decrypts, so nothing here is encrypted.
 */
export function makeChunks(totalBytes) {
  const n = Math.ceil(totalBytes / CHUNK_SIZE);
  return Array.from({ length: n }, (_, i) => {
    const plain = i < n - 1 ? CHUNK_SIZE : totalBytes - (n - 1) * CHUNK_SIZE;
    return new Uint8Array(randomBytes(plain + CHUNK_TAG_BYTES));
  });
}

/** Write chunk bytes where the presigned PUTs would have put them. */
export async function putChunks(uuid, chunks) {
  const b = await bucket();
  for (let i = 0; i < chunks.length; i++) {
    await b.put(`${uuid}/${String(i).padStart(4, '0')}`, chunks[i]);
  }
}

const b64url = (u8) => Buffer.from(u8).toString('base64url');

/** The finalise body: per-chunk BLAKE3 + the ciphertext-chunk merkle root. */
export function finaliseBody(chunks) {
  const leaves = chunks.map(c => blake3(c));
  return { hashes: leaves.map(b64url), merkle_root: b64url(reconstructRoot(leaves)) };
}

/** POST /upload/finalise */
export async function finalise(uuid, sessionToken, body) {
  return request('POST', '/upload/finalise', {
    headers: { 'X-Transfer-UUID': uuid, 'X-Upload-Session': sessionToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * upload(opts) — issue → initiate → chunks → finalise. Throws on any non-200
 * so a broken step names itself. Returns { uuid, chunks, cred }.
 * opts as initiateHeaders, plus ip.
 */
export async function upload(opts = {}) {
  const cred = await issueCredential({ ip: opts.ip });
  if (cred.status !== 200) throw new Error(`credential issue ${cred.status} ${JSON.stringify(cred.body)}`);
  const totalBytes = opts.totalBytes ?? 1024;
  const init = await initiate(await initiateHeaders(cred.body, { ...opts, totalBytes }), { ip: opts.ip });
  if (init.status !== 200) throw new Error(`initiate ${init.status} ${JSON.stringify(init.body)}`);
  const uuid = cred.body.uuid;
  const chunks = makeChunks(totalBytes);
  await putChunks(uuid, chunks);
  const fin = await finalise(uuid, init.body.session_token, finaliseBody(chunks));
  if (fin.status !== 200) throw new Error(`finalise ${fin.status} ${JSON.stringify(fin.body)}`);
  return { uuid, chunks, cred: cred.body };
}

/** Read-modify-write the stored manifest (to set states no upload can reach today). */
export async function patchManifest(uuid, fn) {
  const b = await bucket();
  const obj = await b.get(`${uuid}/manifest.json`);
  const m = fn(JSON.parse(await obj.text()));
  await b.put(`${uuid}/manifest.json`, JSON.stringify(m));
}

// ── Receive side ────────────────────────────────────────────────────────────

const uuidHeader = (uuid) => ({ 'X-Transfer-UUID': uuid });
const bearerHeader = (bearer) => (bearer ? { Authorization: `Bearer ${bearer}` } : {});

/** GET /meta */
export async function getMeta(uuid) {
  return request('GET', '/meta', { headers: uuidHeader(uuid) });
}

/** POST /unlock — password → download token */
export async function unlock(uuid, passphrase, { ip } = {}) {
  return request('POST', '/unlock', {
    ip,
    headers: { ...uuidHeader(uuid), 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  });
}

/** GET /download, part in X-Part. Body as bytes on 200. */
export async function downloadChunk(uuid, chunkIndex, bearer = null) {
  const res = await fetch(`${baseUrl()}/download`, {
    headers: {
      ...uuidHeader(uuid),
      'X-Part': String(chunkIndex).padStart(4, '0'),
      ...bearerHeader(bearer),
      'CF-Connecting-IP': uniqueIp(),
    },
  });
  const body = res.ok ? new Uint8Array(await res.arrayBuffer()) : await parseBody(res);
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body };
}

/** POST /confirm — recipient destroy confirmation */
export async function confirmTransfer(uuid, bearer = null) {
  return request('POST', '/confirm', {
    headers: { ...uuidHeader(uuid), 'Content-Type': 'application/json', ...bearerHeader(bearer) },
  });
}

/**
 * DELETE /transfer — recipient deletion with a download token.
 * opts.omitAuth sends no Authorization header at all.
 */
export async function deleteTransfer(uuid, bearer = null, { omitAuth = false } = {}) {
  const headers = { ...uuidHeader(uuid) };
  if (!omitAuth) headers.Authorization = `Bearer ${bearer ?? 'invalid-token'}`;
  return request('DELETE', '/transfer', { headers });
}

/**
 * DELETE /transfer — owner path: an rfs_owner_ bearer plus X-Admin-Key.
 * opts.adminKey = inject('adminKey') (a fresh random key per run — no default);
 * opts.badKey sends a wrong key.
 */
export async function ownerDeleteTransfer(uuid, { adminKey, badKey = false } = {}) {
  if (!badKey && !adminKey) throw new Error("ownerDeleteTransfer: pass inject('adminKey') from the test");
  return request('DELETE', '/transfer', {
    headers: {
      ...uuidHeader(uuid),
      Authorization: 'Bearer rfs_owner_executiondock',
      'X-Admin-Key': badKey ? 'wrong-key' : adminKey,
    },
  });
}

/** POST with a raw body (Stripe webhook tests). */
export async function post(path, body, headers = {}) {
  return request('POST', path, { headers, body });
}
