// dev/stripe-sandbox/lib.mjs — shared by the sandbox test-through scripts
// (Stripe-Account-2, 28 Oct 2026). Reads worker/.dev.vars; refuses anything that
// is not a sandbox: production Supabase ref, a live Stripe key, a Worker that is
// not on localhost. Never prints a key, secret, cookie or token.
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const DEV_VARS = fileURLToPath(new URL('../../worker/.dev.vars', import.meta.url));
const PRODUCTION_REF = 'tihgvdokeofnjxjkenmm';

export const env = {};
for (const l of fs.readFileSync(DEV_VARS, 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(env.SUPABASE_URL ?? '') || env.SUPABASE_URL.includes(PRODUCTION_REF)) {
  throw new Error('SUPABASE_URL is not a sandbox project — refusing');
}
if (env.STRIPE_SECRET_KEY && !/^(rk|sk)_test_/.test(env.STRIPE_SECRET_KEY)) throw new Error('STRIPE_SECRET_KEY is not a test key — refusing');

export const WORKER_PORT = Number(process.env.WORKER_PORT ?? 8787);
export const AUTH_HOST   = 'api.share.refueler.io';   // AUTH_API_HOST in wrangler.toml
export const AUTH_ORIGIN = 'https://share.refueler.io'; // AUTH_ORIGINS

const SH = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

export async function rest(path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: SH });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return r.json();
}

export async function rpc(fn, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: SH, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn} ${r.status}`);
  return t ? JSON.parse(t) : null;
}

export async function stripe(method, path, form) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method, body: form,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return r.json();
}

/**
 * A request to the local Worker. Sent to 127.0.0.1 with Host set to the auth
 * host, so sign-in and Citizen routes answer as they do in production.
 */
export function worker(method, path, headers = {}, body) {
  return new Promise((ok, no) => {
    const r = http.request({
      host: '127.0.0.1', port: WORKER_PORT, path, method,
      headers: { Host: AUTH_HOST, Origin: AUTH_ORIGIN, 'CF-Connecting-IP': `198.51.100.${1 + Math.floor(Math.random() * 200)}`, ...headers },
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { let b = d; try { b = JSON.parse(d); } catch {} ok({ status: res.statusCode, headers: res.headers, body: b }); });
    });
    r.on('error', no);
    if (body) r.write(body);
    r.end();
  });
}
