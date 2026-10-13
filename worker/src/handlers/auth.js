// ─────────────────────────────────────────────────────────────────────────────
// handlers/auth.js — Registered-rail sign-in routes (B12-4a · 13 Oct 2026)
//
// Design: docs/B12-SR-spec-v1.md S6 (wins). Registered principals only
// (Citizen, Registered-rail Chartered org admin). Bearer principals never get a
// magic link — they have no row the lookup could find.
//
//   POST /auth/magic                  { email, turnstile_token } → 202, always
//   POST /auth/verify                 { token } → Set-Cookie + { kind, csrf, … }
//   GET  /chambers/session            → { kind, csrf, … } | 401
//   POST /auth/signout                cookie + X-CSRF + Origin
//   POST /auth/signout-everywhere     cookie + X-CSRF + Origin
//
// Served only on AUTH_API_HOST (api.share.refueler.io) — never workers.dev
// (S6.5). CORS here is credentialed and exact-origin (authCors); the public
// corsHeaders() localhost echo never reaches these routes (S6.6).
// Every response: Cache-Control: no-store. Nothing logs an email, token,
// session id or cookie.
// ─────────────────────────────────────────────────────────────────────────────

import {
  newSecret, secretHash, csrfFor, csrfOk, rlId, normaliseEmail, sessionCookie,
  clearSessionCookie, readSessionCookie, isAuthOrigin, SESSION_TTL, SESSION_CAP,
  PRINCIPAL_KINDS,
} from '../auth.js';
import * as store from '../auth_store.js';
import { sendSignInEmail } from '../mailer.js';
import { verifyTurnstileToken } from '../turnstile.js';
import { checkRateLimit, getClientIp } from '../ratelimit.js';

// S6.2 limits (🔒 existence · 🟡 numbers).
export const MAGIC_IP_LIMIT        = { max: 5,   window: 900 };    // per IP / 15 min → 429
export const MAGIC_PRINCIPAL_LIMIT = { max: 3,   window: 3600 };   // per principal / hour → silent
export const MAGIC_GLOBAL_LIMIT    = { max: 200, window: 3600 };   // all sends / hour → silent + alarm
export const VERIFY_IP_LIMIT       = { max: 10,  window: 60 };

export const AUTH_PATHS = new Set([
  '/auth/magic', '/auth/verify', '/auth/signout', '/auth/signout-everywhere', '/chambers/session',
]);

/** True when this request is for an auth route on the one host that serves them. */
export function isAuthRoute(request, env) {
  const url = new URL(request.url);
  return AUTH_PATHS.has(url.pathname);
}

export function onAuthHost(request, env) {
  return Boolean(env.AUTH_API_HOST) && new URL(request.url).hostname === env.AUTH_API_HOST;
}

/** Credentialed, exact-origin CORS. Unknown origins get no ACAO at all. */
export function authCors(request, env) {
  const origin = request.headers.get('Origin');
  const h = { 'Vary': 'Origin', 'Cache-Control': 'no-store' };
  if (isAuthOrigin(env, origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Credentials'] = 'true';
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type, X-CSRF';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

function reply(request, env, status, body, extra = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...authCors(request, env), ...extra },
  });
}

async function readJson(request) {
  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')) return null;
  try { const b = await request.json(); return b && typeof b === 'object' ? b : null; } catch { return null; }
}

function originOk(request, env) {
  return isAuthOrigin(env, request.headers.get('Origin'));
}

// checkRateLimit keys every counter by rlId itself (B12-4a-2); here a missing
// pepper fails closed before it gets that far.
async function limited(env, scope, value, lim) {
  if (!(await rlId(env, scope, value))) return { limited: true, resetAt: Math.floor(Date.now() / 1000) + lim.window };
  return checkRateLimit(env, value, scope, lim.max, lim.window);
}

export function handleAuthOptions(request, env) {
  return new Response(null, { status: 204, headers: authCors(request, env) });
}

// ── POST /auth/magic ─────────────────────────────────────────────────────────
// Same status, body and timing for every well-formed request: the lookup, mint
// and send happen after the response, in waitUntil (S6.2). Unknown email →
// nothing is sent.
export async function handleMagic(request, env, ctx) {
  if (!originOk(request, env)) return reply(request, env, 403, { error: 'Forbidden' });
  const ip = getClientIp(request);
  const rl = await limited(env, 'magic_ip', ip, MAGIC_IP_LIMIT);
  if (rl.limited) return reply(request, env, 429, { error: 'Too many requests' });

  const body = await readJson(request);
  const email = normaliseEmail(body?.email);
  if (!email || typeof body?.turnstile_token !== 'string') return reply(request, env, 400, { error: 'Bad request' });
  if (!(await verifyTurnstileToken(body.turnstile_token, env.TURNSTILE_SECRET_KEY))) {
    return reply(request, env, 403, { error: 'Turnstile verification failed' });
  }
  ctx.waitUntil(sendMagic(env, email).catch(() => console.error('auth/magic: send failed')));
  return reply(request, env, 202, { ok: true });
}

/** The after-response half of /auth/magic. Exported for tests. */
export async function sendMagic(env, email) {
  const global = await checkRateLimit(env, 'all', 'magic_global', MAGIC_GLOBAL_LIMIT.max, MAGIC_GLOBAL_LIMIT.window);
  if (global.limited) { console.error('auth/magic: global ceiling reached'); return { sent: 0 }; }

  const principals = (await store.principalsForEmail(env, email))
    .filter(p => PRINCIPAL_KINDS.includes(p?.kind) && typeof p?.ref === 'string');
  const links = [];
  for (const p of principals) {
    const rl = await limited(env, 'magic_principal', `${p.kind}:${p.ref}`, MAGIC_PRINCIPAL_LIMIT);
    if (rl.limited) continue;
    const token = newSecret();
    await store.issueToken(env, secretHash(token), p.kind, p.ref);
    links.push({ kind: p.kind, url: `${env.AUTH_SIGNIN_URL}#t=${token}` });
  }
  if (links.length === 0) return { sent: 0 };
  await sendSignInEmail(env, email, links);
  return { sent: links.length };
}

// ── POST /auth/verify ────────────────────────────────────────────────────────
// Only a click on the sign-in page sends this (the token sits in the link's
// fragment, so link scanners never reach here). Fresh session every sign-in.
export async function handleVerify(request, env) {
  if (!originOk(request, env)) return reply(request, env, 403, { error: 'Forbidden' });
  const rl = await limited(env, 'verify_ip', getClientIp(request), VERIFY_IP_LIMIT);
  if (rl.limited) return reply(request, env, 429, { error: 'Too many requests' });

  const body = await readJson(request);
  const tokenHash = secretHash(body?.token);
  if (!tokenHash) return reply(request, env, 401, { error: 'This link has expired or was already used' });

  let p;
  try { p = await store.consumeToken(env, tokenHash); } catch { return reply(request, env, 503, { error: 'Unavailable' }); }
  if (!p || !SESSION_TTL[p.kind]) return reply(request, env, 401, { error: 'This link has expired or was already used' });

  const sessionId = newSecret();
  const ttl = SESSION_TTL[p.kind];
  let s;
  try { s = await store.createSession(env, secretHash(sessionId), p.kind, p.ref, ttl, SESSION_CAP); }
  catch { return reply(request, env, 503, { error: 'Unavailable' }); }
  const csrf = await csrfFor(env, sessionId);
  if (!csrf) return reply(request, env, 503, { error: 'Unavailable' });

  return reply(request, env, 200, {
    kind: p.kind, csrf, idle_expires_at: s.idle_expires_at, absolute_expires_at: s.absolute_expires_at,
  }, { 'Set-Cookie': sessionCookie(sessionId, ttl.absolute) });
}

// ── Session gate (also used by later routes: initiate, billing, strike-off) ──
/**
 * requireSession(request, env, { stateChanging }) →
 *   { sessionId, sessionHash, kind, ref, idle_expires_at, absolute_expires_at } | Response
 * State-changing calls need all three: cookie · X-CSRF · exact Origin (S6.6).
 */
export async function requireSession(request, env, { stateChanging }) {
  if (stateChanging && !originOk(request, env)) return reply(request, env, 403, { error: 'Forbidden' });
  const sessionId = readSessionCookie(request);
  if (!sessionId) return reply(request, env, 401, { error: 'Not signed in' });
  if (stateChanging && !(await csrfOk(env, sessionId, request.headers.get('X-CSRF')))) {
    return reply(request, env, 403, { error: 'Forbidden' });
  }
  const sessionHash = secretHash(sessionId);
  let s = null;
  try {
    // Idle window per kind; look up once with the shortest, then re-slide if longer.
    s = await store.checkSession(env, sessionHash, SESSION_TTL.org_admin.idle);
    if (s && SESSION_TTL[s.kind]?.idle !== SESSION_TTL.org_admin.idle) {
      s = await store.checkSession(env, sessionHash, SESSION_TTL[s.kind].idle);
    }
  } catch { return reply(request, env, 503, { error: 'Unavailable' }); }
  if (!s || !SESSION_TTL[s.kind]) {
    return reply(request, env, 401, { error: 'Not signed in' }, { 'Set-Cookie': clearSessionCookie() });
  }
  return { sessionId, sessionHash, ...s };
}

/**
 * citizenTier(env, ref) → 'max' | 'free' (B12-4a-2). 'max' only for a paid
 * subscription (active + period not over). Throws StoreUnavailable.
 */
export async function citizenTier(env, ref) {
  const e = await store.citizenEntitlement(env, ref);
  return e.paid && e.tier === 'max' ? 'max' : 'free';
}

// ── GET /chambers/session ────────────────────────────────────────────────────
// Side-effect free apart from sliding the idle window. Never returns the
// principal ref (Stripe customer id / org id). Citizens also get `tier`, so the
// upload page knows whether "Uploading as Citizen" applies.
export async function handleSession(request, env) {
  const s = await requireSession(request, env, { stateChanging: false });
  if (s instanceof Response) return s;
  const body = {
    kind: s.kind, csrf: await csrfFor(env, s.sessionId),
    idle_expires_at: s.idle_expires_at, absolute_expires_at: s.absolute_expires_at,
  };
  if (s.kind === 'citizen') {
    try { body.tier = await citizenTier(env, s.ref); }
    catch { return reply(request, env, 503, { error: 'Unavailable' }); }
  }
  return reply(request, env, 200, body);
}

// ── POST /auth/signout · /auth/signout-everywhere ────────────────────────────
export async function handleSignout(request, env, { everywhere }) {
  const s = await requireSession(request, env, { stateChanging: true });
  if (s instanceof Response) return s;
  try {
    if (everywhere) await store.deleteAllSessions(env, s.sessionHash);
    else await store.deleteSession(env, s.sessionHash);
  } catch { return reply(request, env, 503, { error: 'Unavailable' }); }
  return reply(request, env, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
}

/** Router entry: every auth path, already known to be on the auth host. */
export async function routeAuth(request, env, ctx) {
  const { pathname } = new URL(request.url);
  const m = request.method;
  if (m === 'OPTIONS') return handleAuthOptions(request, env);
  if (m === 'POST' && pathname === '/auth/magic')               return handleMagic(request, env, ctx);
  if (m === 'POST' && pathname === '/auth/verify')              return handleVerify(request, env);
  if (m === 'GET'  && pathname === '/chambers/session')         return handleSession(request, env);
  if (m === 'POST' && pathname === '/auth/signout')             return handleSignout(request, env, { everywhere: false });
  if (m === 'POST' && pathname === '/auth/signout-everywhere')  return handleSignout(request, env, { everywhere: true });
  return reply(request, env, 405, { error: 'Method not allowed' });
}
