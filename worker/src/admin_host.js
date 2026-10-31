/**
 * admin_host.js — the host split (H6a · Admin-Access-1a · 30 Oct 2026)
 *
 * Plan: private strategy/docs/H6a-Admin-Access-plan-v1.md §3.1. One rule:
 * an admin path answers only on the admin host, and the admin host answers only
 * admin paths and Navy Office's files (GET/HEAD, from Admin-Access-1b).
 *
 *   ADMIN_HOST          the admin hostname (admin.share.refueler.io). Unset → no host is
 *                       the admin host, so every admin path answers 404 (fails closed).
 *   ACCESS_TEAM/_AUD    read by access_jwt.js. Unset → the admin host refuses everything.
 *   ADMIN_PUBLIC_UNTIL  unix seconds. While it is in the future the public host still
 *                       answers admin paths as before: the cut-over day and break-glass
 *                       (plan §5.3). "0", unset or past → shut.
 *
 * adminGate() runs before anything else in fetch(): before the auth paths, the
 * OPTIONS branch and the router. Every response on the admin host leaves without
 * Access-Control-* headers (stripCors), so no other origin can read one.
 */

import { requireAccess } from './access_jwt.js';
import { ADMIN_HEADERS } from './admin_headers.js';
import { corsHeaders, setAppOrigins } from './utils.js';

// Same shape as ADMIN_PATH in bin/lib/route-inventory-lib.mjs (admin_host.test.js checks they agree).
export const ADMIN_PATH = /^\/(api\/v1\/)?admin(\/|$)/;

export function onAdminHost(request, env) {
  const host = String(env.ADMIN_HOST ?? '').toLowerCase();
  return host !== '' && new URL(request.url).hostname === host;
}

export function adminPublicOpen(env, now = Math.floor(Date.now() / 1000)) {
  const until = Number(env.ADMIN_PUBLIC_UNTIL ?? 0);
  return Number.isFinite(until) && until > now;
}

// The router's own unknown-route answer, so an admin path off the admin host
// can't be told apart from a path that never existed.
export const notFound = (request) => new Response('Not found', { status: 404, headers: corsHeaders(request) });

/** → a Response to send now, or null to carry on into the router. */
export async function adminGate(request, env) {
  const path = new URL(request.url).pathname;
  if (onAdminHost(request, env)) {
    const refused = await requireAccess(request, env);
    if (refused) return refused;
    if (ADMIN_PATH.test(path)) return null;
    if (['GET', 'HEAD'].includes(request.method) && env.ASSETS) return adminAsset(request, env);
    return new Response('Not found', { status: 404 });
  }
  if (ADMIN_PATH.test(path) && !adminPublicOpen(env)) {
    setAppOrigins(env);
    return notFound(request);
  }
  return null;
}

// Navy Office's files (navy-office/, the [assets] binding), reached only from adminGate()
// after the Access check. run_worker_first = true in wrangler.toml, so nothing is served
// before this runs — on api.share an asset path is just an unknown route. Every answer,
// a 404 included, carries the admin headers.
async function adminAsset(request, env) {
  const res = await env.ASSETS.fetch(request);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(ADMIN_HEADERS)) out.headers.set(k, v);
  return out;
}

export function stripCors(res) {
  const out = new Response(res.body, res);
  for (const k of [...out.headers.keys()]) if (k.startsWith('access-control-')) out.headers.delete(k);
  return out;
}
