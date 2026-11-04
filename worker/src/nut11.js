/**
 * nut11.js — NUT-11 Mode 1 helpers
 *
 * Passphrase hashing, timing-safe comparison of hex digests, and download tokens.
 * Tokens are HMAC-SHA256 signed, bound to a UUID, valid until the transfer expires.
 *
 * LAYER BOUNDARY: This module handles download gating only.
 * NUT-00 blind sig lives in nut00.js. These layers must never be conflated.
 */

/**
 * hashSecret(passphrase) → hex string
 * SHA-256 of the UTF-8 passphrase. Stored in manifest as p2sh_secret_hash.
 */
export async function hashSecret(passphrase) {
  const encoded = new TextEncoder().encode(passphrase);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return bytesToHex(new Uint8Array(hash));
}

const HEX = /^[0-9a-fA-F]*$/;

/**
 * timingSafeEqual(a, b) → boolean
 * Constant-time comparison of two HEX strings, nothing else. Non-hex input is refused: it would
 * not parse to bytes, and different strings could compare equal (Worker-Keys-1).
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length % 2 !== 0) return false;
  if (!HEX.test(a) || !HEX.test(b)) return false;
  const aBytes = hexToBytes(a);
  const bBytes = hexToBytes(b);
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Download tokens (Worker-Keys-1, F3). One key per job: never the mint key.
//
//   DL_TOKEN_KEY   exactly 32 random bytes, base64 (wrangler secret). Can be replaced at any
//                  time without a kept copy: open tabs get a 401 and re-enter the password.
//   K     = HKDF-SHA256(DL_TOKEN_KEY, salt = empty, info = TAG ‖ 0x00, 32 B)
//   token = "dl1." + payload + "." + b64url(HMAC-SHA256(K, TAG ‖ 0x00 ‖ utf8(payload)))
//   payload = b64url(json({ uuid, exp }))     exp = the transfer's own expiry, not a short TTL.
//
// Fails closed: no usable DL_TOKEN_KEY → nothing is issued and no dl1 token verifies. The mint
// key never signs. WebCrypto only; known-answer vector in test/dltoken.test.js.
//
// Overlap: the old form (b64url(json).b64url(HMAC-SHA256(mint key, payload))) still VERIFIES
// while env.DL_TOKEN_LEGACY_UNTIL (unix seconds) is in the future. Unset, or past, means refused:
// the overlap shuts itself even if the follow-up commit deleting it slips.
// ─────────────────────────────────────────────────────────────────────────────
const DL_TOKEN_TAG   = 'refueler.share.dltoken.v1';
const DL_TOKEN_BYTES = 32;
const SIG_B64URL     = /^[A-Za-z0-9_-]{43}$/;

const textEnc = new TextEncoder();

function tagged(bytes) {
  const tag = textEnc.encode(DL_TOKEN_TAG);
  const out = new Uint8Array(tag.length + 1 + bytes.length);
  out.set(tag, 0);            // out[tag.length] stays 0x00
  out.set(bytes, tag.length + 1);
  return out;
}

async function dlTokenKey(env) {
  let raw;
  try {
    raw = typeof env?.DL_TOKEN_KEY === 'string'
      ? Uint8Array.from(atob(env.DL_TOKEN_KEY), c => c.charCodeAt(0))
      : null;
  } catch {
    return null;
  }
  if (!raw || raw.length !== DL_TOKEN_BYTES) return null;
  const ikm  = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: tagged(new Uint8Array(0)) }, ikm, 256,
  );
  return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/**
 * issueDownloadToken(uuid, env, expiresAt) → token string | null
 * null means DL_TOKEN_KEY is missing or unusable: the caller answers 503.
 */
export async function issueDownloadToken(uuid, env, expiresAt) {
  const key = await dlTokenKey(env);
  if (!key) return null;
  const payload = bufToBase64url(textEnc.encode(JSON.stringify({ uuid, exp: expiresAt })));
  const sig = await crypto.subtle.sign('HMAC', key, tagged(textEnc.encode(payload)));
  return `dl1.${payload}.${bufToBase64url(sig)}`;
}

/**
 * verifyDownloadToken(token, env) → { valid: boolean, uuid: string|null }
 * The caller still compares uuid with the transfer it is serving.
 */
export async function verifyDownloadToken(token, env) {
  const refused = { valid: false, uuid: null };
  try {
    if (typeof token !== 'string') return refused;
    const parts = token.split('.');
    const now = Math.floor(Date.now() / 1000);
    let payload;
    if (parts.length === 3 && parts[0] === 'dl1') {
      const key = await dlTokenKey(env);
      const sig = sigBytes(parts[2]);
      if (!key || !sig) return refused;
      payload = parts[1];
      if (!(await crypto.subtle.verify('HMAC', key, sig, tagged(textEnc.encode(payload))))) return refused;
    } else if (parts.length === 2) {
      // Old form. Delete this branch, and DL_TOKEN_LEGACY_UNTIL, at the follow-up commit.
      if (!(Number(env?.DL_TOKEN_LEGACY_UNTIL) > now)) return refused;
      const key = await legacyMintHmacKey(env?.MINT_PRIVATE_KEY);
      const sig = sigBytes(parts[1]);
      if (!key || !sig) return refused;
      payload = parts[0];
      if (!(await crypto.subtle.verify('HMAC', key, sig, textEnc.encode(payload)))) return refused;
    } else {
      return refused;
    }
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof claims?.uuid !== 'string' || !Number.isInteger(claims.exp) || now > claims.exp) return refused;
    return { valid: true, uuid: claims.uuid };
  } catch {
    return refused;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// A signature is exactly 32 bytes in canonical base64url. Re-encoding catches the two spare bits
// of the last character, so one token has one spelling and any changed character is refused.
function sigBytes(sigB64) {
  if (!SIG_B64URL.test(sigB64)) return null;
  const bytes = Uint8Array.from(atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  return bufToBase64url(bytes) === sigB64 ? bytes : null;
}

// Verify only, and only inside the overlap. The mint key never signs a token.
async function legacyMintHmacKey(mintPrivkeyHex) {
  if (typeof mintPrivkeyHex !== 'string' || !HEX.test(mintPrivkeyHex) || mintPrivkeyHex.length !== 64) return null;
  return crypto.subtle.importKey('raw', hexToBytes(mintPrivkeyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bufToBase64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
