/**
 * access_jwt.js — Cloudflare Access token check for the admin host (H6a · Admin-Access-1a · 30 Oct 2026)
 *
 * Plan: private strategy/docs/H6a-Admin-Access-plan-v1.md §3.2. Access sits in front
 * of ADMIN_HOST and signs every request it lets through; the Worker checks that
 * signature itself before the admin key is even read. WebCrypto RSASSA-PKCS1-v1_5 /
 * SHA-256 only — no JWT package (A-5). Every rule fails closed:
 *
 *   1. Header Cf-Access-Jwt-Assertion only (never the CF_Authorization cookie). One
 *      value, three base64url parts, ≤ 8 KB. Two headers arrive joined by ", " → refused.
 *   2. JOSE header: alg exactly "RS256" (never read from the key), kid present.
 *   3. kid must be a key in https://<ACCESS_TEAM>.cloudflareaccess.com/cdn-cgi/access/certs.
 *      Keys cached ≤ 1 h per isolate; an unknown kid refetches at most once per 5 min.
 *      Certs unreachable and nothing fresh cached → 503, never a pass.
 *   4. Signature over header.payload.
 *   5. iss = the team URL; aud (array) contains ACCESS_AUD; type "app";
 *      exp > now − 60 s; nbf (if present) and iat ≤ now + 60 s; email present.
 *   6. Nothing from the token is logged, stored or returned.
 *
 * Exports:
 *   requireAccess(request, env, now?) → null | 401/503 Response   (same shape as requireAdmin)
 *   forgetAccessCerts()               → clears the key cache (tests)
 */

import { json } from './utils.js';

export const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';
const MAX_TOKEN   = 8192;
const SKEW        = 60;     // seconds either side for exp / nbf / iat
const CERTS_TTL   = 3600;   // keys kept at most an hour
const REFETCH_GAP = 300;    // unknown kid → at most one refetch per 5 minutes
const B64URL      = /^[A-Za-z0-9_-]+$/;
const RS256       = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

const denied      = () => json({ error: 'access' }, 401);
const unavailable = () => json({ error: 'access_unavailable' }, 503);

// { url, keys: Map(kid → CryptoKey), at } — per isolate. lastFetch counts failed tries too.
let cache = null;
let lastFetch = { url: null, at: -Infinity };

export function forgetAccessCerts() {
  cache = null;
  lastFetch = { url: null, at: -Infinity };
}

function fromB64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Fetch and import the team's keys → Map, or null when unreachable or empty. */
async function fetchKeys(url) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json();
    const keys = new Map();
    for (const k of Array.isArray(body?.keys) ? body.keys : []) {
      if (!isObject(k) || k.kty !== 'RSA' || typeof k.kid !== 'string' || !k.kid) continue;
      if (k.alg !== undefined && k.alg !== 'RS256') continue;
      if (k.use !== undefined && k.use !== 'sig') continue;
      try {
        keys.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e }, RS256, false, ['verify']));
      } catch { /* a malformed key is skipped, never trusted */ }
    }
    return keys.size ? keys : null;
  } catch {
    return null;
  }
}

/** The key for kid → CryptoKey | null (unknown) | 'unreachable'. */
async function keyFor(url, kid, now) {
  const fresh = cache && cache.url === url && now - cache.at < CERTS_TTL;
  if (fresh && cache.keys.has(kid)) return cache.keys.get(kid);
  if (fresh && lastFetch.url === url && now - lastFetch.at < REFETCH_GAP) return null;
  lastFetch = { url, at: now };
  const keys = await fetchKeys(url);
  if (keys) cache = { url, keys, at: now };
  else if (!fresh) { cache = null; return 'unreachable'; }
  return cache.keys.get(kid) ?? null;
}

export async function requireAccess(request, env, now = Math.floor(Date.now() / 1000)) {
  const team = env.ACCESS_TEAM ?? '';
  const aud  = env.ACCESS_AUD ?? '';
  if (!/^[a-z0-9-]+$/.test(team) || !aud) return unavailable();   // not configured: refuse everything

  // 1. One header, three base64url parts.
  const token = request.headers.get(ACCESS_HEADER) ?? '';
  if (!token || token.length > MAX_TOKEN) return denied();
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((p) => B64URL.test(p))) return denied();

  let header, claims;
  try {
    const text = (p) => new TextDecoder('utf-8', { fatal: true }).decode(fromB64url(p));
    header = JSON.parse(text(parts[0]));
    claims = JSON.parse(text(parts[1]));
  } catch {
    return denied();
  }
  if (!isObject(header) || !isObject(claims)) return denied();

  // 2. Algorithm pinned here, never taken from the token or the key.
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return denied();

  // 3. The team's key for this kid.
  const issuer = `https://${team}.cloudflareaccess.com`;
  const key = await keyFor(`${issuer}/cdn-cgi/access/certs`, header.kid, now);
  if (key === 'unreachable') return unavailable();
  if (!key) return denied();

  // 4. Signature.
  let ok = false;
  try {
    ok = await crypto.subtle.verify(RS256, key, fromB64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch {
    ok = false;
  }
  if (!ok) return denied();

  // 5. Claims.
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (claims.iss !== issuer) return denied();
  if (!Array.isArray(claims.aud) || !claims.aud.includes(aud)) return denied();
  if (claims.type !== 'app') return denied();
  if (!num(claims.exp) || claims.exp <= now - SKEW) return denied();
  if (!num(claims.iat) || claims.iat > now + SKEW) return denied();
  if (claims.nbf !== undefined && (!num(claims.nbf) || claims.nbf > now + SKEW)) return denied();
  if (typeof claims.email !== 'string' || !claims.email) return denied();

  return null;
}
