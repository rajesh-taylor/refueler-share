// worker/src/r2_presign.js
// ─────────────────────────────────────────────────────────────────────────────
// Share-6-1 — R2 S3 SigV4 query-string presigner + upload-session token signer.
//
// Zero dependencies. Web Crypto only. Presigns PutObject to {uuid}/{iiii} so the
// browser PUTs each ciphertext chunk direct to R2 (Worker out of the transfer
// path — Share-6-spec §1/§3). The R2 secret access key never leaves the Worker;
// the browser receives only the signed URL.
//
// Hand-rolled SigV4 chosen over aws4fetch (Share-6-spec §6 D-5): zero files to
// place or audit, no package.json churn, self-contained, Web Crypto only.
// aws4fetch remains a drop-in swap if a dependency is ever preferred — the
// handler only depends on the two exports makePresigner / presignPutObject.
//
// LOCKS honoured:
//   • X-Amz-Expires = 6 days (518,400 s); hard-refuse anything over the SigV4
//     7-day cap (§6, do-not-retry §10).
//   • Object key = {uuid}/{iiii}, 0-indexed, big-endian, single-encoded path
//     (§8 — object index == AAD index == Merkle leaf; no +1 anywhere).
//   • region = "auto", service = "s3" (R2 S3 API).
// ─────────────────────────────────────────────────────────────────────────────

const ENC = new TextEncoder();

// ── Rate card v1.0 (CLAUDE.md §Rate card): 10 credits/transfer + 100/GB ──────
// GiB (2^30) is used to match the tier-cap units (4 GiB / 100 GiB / 250 GiB).
// If billing should peg to decimal GB, change GIB below — see Share-6-1 chat.
export const TRANSFER_BASE_CREDITS   = 10;
export const TRANSFER_PER_GB_CREDITS = 100;
const GIB = 1024 * 1024 * 1024;

export function computeTransferCost(totalBytes) {
  const bytes = Number(totalBytes) || 0;
  const gb    = Math.ceil(bytes / GIB);
  return TRANSFER_BASE_CREDITS + gb * TRANSFER_PER_GB_CREDITS;
}

// ── SigV4 expiry constants ───────────────────────────────────────────────────
export const SIGV4_MAX_EXPIRY = 7 * 24 * 3600; // 604,800 — SigV4 hard cap
export const PRESIGN_EXPIRY   = 6 * 24 * 3600; // 518,400 — Share-6 lock (§6)

// ── Encoding helpers ─────────────────────────────────────────────────────────
// RFC 3986 unreserved set only; everything else percent-encoded (uppercase hex).
function rfc3986(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    c => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

// Canonical URI: encode each path segment, preserve '/' separators (S3
// path-style, single-encoding).
function encodeKey(key) {
  return key.split('/').map(rfc3986).join('/');
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(str) {
  return toHex(await crypto.subtle.digest('SHA-256', ENC.encode(str)));
}

async function hmac(keyBytes, msg) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', key, typeof msg === 'string' ? ENC.encode(msg) : msg)
  );
}

// AWS4 signing-key derivation: kDate → kRegion → kService → kSigning.
async function awsSigningKey(secret, dateStamp, region, service) {
  const kDate    = await hmac(ENC.encode('AWS4' + secret), dateStamp);
  const kRegion  = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

// amzDate: 20260916T120000Z ; dateStamp: 20260916
function amzTimes(now) {
  const iso       = now.toISOString();                  // 2026-09-16T12:00:00.000Z
  const amzDate   = iso.replace(/[:-]|\.\d{3}/g, '');    // 20260916T120000Z
  const dateStamp = amzDate.slice(0, 8);                 // 20260916
  return { amzDate, dateStamp };
}

// ─────────────────────────────────────────────────────────────────────────────
// makePresigner — derive the signing key + timestamp ONCE, return a closure that
// presigns individual object keys. Used for a batch of up to 256 URLs so the
// AWS4 key-derivation chain (4 HMACs) runs once per batch, not per URL.
// ─────────────────────────────────────────────────────────────────────────────
export async function makePresigner({
  accountId, accessKeyId, secretAccessKey, bucket,
  region = 'auto', service = 's3',
  expiresIn = PRESIGN_EXPIRY, now = new Date(),
}) {
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('makePresigner: missing R2 accountId / credentials / bucket');
  }
  if (expiresIn > SIGV4_MAX_EXPIRY) {
    throw new Error(`makePresigner: expiresIn ${expiresIn}s exceeds SigV4 7-day cap`);
  }

  const host            = `${accountId}.r2.cloudflarestorage.com`;
  const { amzDate, dateStamp } = amzTimes(now);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const kSigning        = await awsSigningKey(secretAccessKey, dateStamp, region, service);
  const expires         = Math.floor(now.getTime() / 1000) + expiresIn;

  const query = new Map([
    ['X-Amz-Algorithm',     'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential',    `${accessKeyId}/${credentialScope}`],
    ['X-Amz-Date',          amzDate],
    ['X-Amz-Expires',       String(expiresIn)],
    ['X-Amz-SignedHeaders', 'host'],
  ]);
  const canonicalQuery = Array.from(query.keys()).sort()
    .map(k => `${rfc3986(k)}=${rfc3986(query.get(k))}`)
    .join('&');

  return async function presign(key) {
    const canonicalUri = `/${rfc3986(bucket)}/${encodeKey(key)}`;
    const canonicalRequest = [
      'PUT',
      canonicalUri,
      canonicalQuery,
      `host:${host}\n`,   // canonical headers
      'host',             // signed headers
      'UNSIGNED-PAYLOAD', // presigned URLs sign no body
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      await sha256Hex(canonicalRequest),
    ].join('\n');

    const signature = toHex(await hmac(kSigning, stringToSign));
    const url = `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
    return { url, expires };
  };
}

// One-shot presign (tests / single-URL smoke). Prefer makePresigner for batches.
export async function presignPutObject(opts) {
  const presign = await makePresigner(opts);
  return presign(opts.key);
}

// ─────────────────────────────────────────────────────────────────────────────
// signSessionToken — upload-session token = HMAC-SHA256 over uuid‖commitment,
// domain-tagged (architecture-invariant: no shared master keys across products).
// The value is unguessable (attacker lacks the master key) and bound to the
// transfer. The Worker also stores it in KV with TTL-to-expiry for revocation;
// /urls auth is a timing-safe compare against the stored value (index.js).
// ─────────────────────────────────────────────────────────────────────────────
export const SESSION_DOMAIN_TAG = 'refueler.share.upload-session.v1';

export async function signSessionToken(masterKeyStr, uuid, commitment) {
  if (!masterKeyStr) throw new Error('signSessionToken: missing signing key');
  const mac = await hmac(
    ENC.encode(String(masterKeyStr)),
    `${SESSION_DOMAIN_TAG}:${uuid}:${commitment}`
  );
  return b64url(mac);
}

// Constant-time equality over two ASCII strings (session-token auth primitive).
// index.js prefers crypto.subtle.timingSafeEqual in the Worker; this is the
// dependency-free equivalent used for the /urls compare fallback and in tests.
export function constantTimeEqual(a, b) {
  const ab = ENC.encode(String(a));
  const bb = ENC.encode(String(b));
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
