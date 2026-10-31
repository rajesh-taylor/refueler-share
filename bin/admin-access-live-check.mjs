#!/usr/bin/env node
// Admin-Access live check (H6a · Admin-Access-1b · 31 Oct 2026). Plan: private
// strategy/docs/H6a-Admin-Access-plan-v1.md §6. Against production; acts on nothing.
//
//   S-1  every Host admin row in docs/ROUTES.md → api.share, dummy key   → 404 Not found
//   S-2  api.share /, /index.html, /navy-office.js                        → 404
//   S-3  admin host, no Access token: / and whoami                        → 302 to the Access login
//   S-4  admin host + Access token, no key: whoami                        → 401 Unauthorised
//   S-5  same, / (and /.assetsignore → 404)                               → 200, admin headers exact, no CORS
//   S-6  token + key: whoami, GET /admin/status                           → admin; status body
//   S-7  refueler.io/share/admin/ (+ two old file paths)                  → 301 to the admin host
//
// Run in Terminal.app (the key typed once, hidden; never in argv or history):
//   read -s "KEY?Admin key: " && echo && KEY="$KEY" node /Users/rajeshtaylor/Documents/refueler-share/bin/admin-access-live-check.mjs --out <file>; unset KEY
// Without KEY, S-6 is skipped. --only=S-1,S-2 runs those checks only (the next-day re-run needs no key or token).
// The Access token comes from `cloudflared access token` (one browser login if none); neither it nor
// the key is ever printed or written. An Access redirect's address is shown as its origin only.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocRows, ADMIN_PATH } from './lib/route-inventory-lib.mjs';
import { ADMIN_HEADERS } from '../worker/src/admin_headers.js';

export const API = 'https://api.share.refueler.io';
export const ADMIN = 'https://admin.share.refueler.io';
export const SITE = 'https://refueler.io';
export const ACCESS_ORIGIN = 'https://refueler.cloudflareaccess.com';

// A path you can send for a ROUTES.md row: {id} → x, {a|b} → a, a trailing * → x.
export const concrete = (path) => path.replace(/\{id\}/g, 'x').replace(/\{(\w+)\|[^}]*\}/g, '$1').replace(/\*$/, 'x');

/** S-1's requests, from docs/ROUTES.md: every Host admin row → [method, concrete path]. */
export function adminRequests(routesDoc) {
  return [...readDocRows(routesDoc).values()].filter((r) => r.host === 'admin').map((r) => [r.method, concrete(r.path)]);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  const outFile = args.out === true ? process.argv[process.argv.indexOf('--out') + 1] : args.out;
  const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
  const run = (id) => !only || only.has(id);
  const KEY = (process.env.KEY || '').replace(/\x1b\[20[01]~/g, '').trim();
  const lines = [];
  let bad = 0;
  const say = (s) => { lines.push(s); console.log(s); };
  const check = (ok, s) => { if (!ok) bad++; say(`${ok ? '✓' : '✗'} ${s}`); };
  // 20 s each: a stalled answer is a ✗, never a hang.
  const get = async (url, init = {}) => {
    try { return await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...init }); }
    catch (e) { return new Response(`fetch failed: ${e.name}`, { status: 599 }); }
  };
  const origin = (loc) => { try { return new URL(loc).origin; } catch { return String(loc); } };

  say(`Admin-Access live check — ${new Date().toISOString()} (UTC)`);

  if (run('S-1')) {
    const reqs = adminRequests(readFileSync(join(ROOT, 'docs/ROUTES.md'), 'utf8'));
    let open = 0;
    for (const [method, path] of reqs) {
      const res = await get(API + path, { method, headers: { 'X-Admin-Key': 'not-the-key' } });
      const body = await res.text();
      if (res.status === 401) open++;
      check(res.status === 404 && body === 'Not found', `S-1 api.share ${method} ${path} → ${res.status}`);
    }
    if (open) say(`  ${open} answered 401: the public window (ADMIN_PUBLIC_UNTIL) is still open — expected only on the cut-over day.`);
  }

  if (run('S-2')) {
    for (const p of ['/', '/index.html', '/navy-office.js']) {
      const res = await get(API + p);
      check(res.status === 404, `S-2 api.share GET ${p} → ${res.status}`);
    }
  }

  if (run('S-3')) {
    for (const p of ['/', '/admin/reports/whoami']) {
      const res = await get(ADMIN + p);
      const loc = res.headers.get('location') || '';
      check(res.status === 302 && origin(loc) === ACCESS_ORIGIN, `S-3 admin GET ${p}, no Access token → ${res.status} ${loc ? origin(loc) : ''}`.trim());
    }
  }

  let token = '';
  if (['S-4', 'S-5', 'S-6'].some(run)) {
    const ask = () => { try { return execFileSync('cloudflared', ['access', 'token', `-app=${ADMIN}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
    token = ask();
    if (!token) {
      console.log('Signing in through Cloudflare Access: a browser window opens once.');
      try { execFileSync('cloudflared', ['access', 'login', ADMIN], { stdio: 'ignore' }); } catch {}
      token = ask();
    }
    if (!token) check(false, 'S-4…S-6 no Access token (cloudflared access login did not finish)');
  }
  const withToken = (h = {}) => ({ headers: { 'cf-access-token': token, ...h } });

  if (token && run('S-4')) {
    const res = await get(ADMIN + '/admin/reports/whoami', withToken());
    const body = await res.text();
    check(res.status === 401 && body.includes('"Unauthorised"'), `S-4 admin whoami, Access ok, no key →${res.status} ${res.status === 401 ? body : ''}`.trim());
  }

  if (token && run('S-5')) {
    const res = await get(ADMIN + '/', withToken());
    const html = await res.text();
    check(res.status === 200 && html.includes('Navy Office'), `S-5 admin GET / → ${res.status}`);
    for (const [k, v] of Object.entries(ADMIN_HEADERS)) check(res.headers.get(k) === v, `S-5 ${k}: ${res.headers.get(k) === v ? 'exact' : JSON.stringify(res.headers.get(k))}`);
    const cors = [...res.headers.keys()].filter((k) => k.startsWith('access-control-'));
    check(cors.length === 0, `S-5 no Access-Control-* ${cors.length ? cors.join(', ') : ''}`.trim());
    const ign = await get(ADMIN + '/.assetsignore', withToken());
    check(ign.status === 404, `S-5 admin GET /.assetsignore → ${ign.status}`);
  }

  if (token && run('S-6')) {
    if (!KEY) say('– S-6 skipped (no KEY)');
    else {
      const who = await get(ADMIN + '/admin/reports/whoami', withToken({ 'X-Admin-Key': KEY }));
      const role = who.ok ? (await who.json()).role : null;
      check(role === 'admin', `S-6 admin whoami, token + key → ${who.status} ${role ?? ''}`.trim());
      const st = await get(ADMIN + '/admin/status', withToken({ 'X-Admin-Key': KEY }));
      const body = st.ok ? await st.json() : null;
      check(st.status === 200 && typeof body?.updated_at === 'number', `S-6 admin GET /admin/status → ${st.status}${body ? ' (status body)' : ''}`);
    }
  }

  if (run('S-7')) {
    for (const p of ['/share/admin/', '/share/admin/navy-office.js', '/share/admin/navy-office.html']) {
      const res = await get(SITE + p);
      const loc = res.headers.get('location') || '';
      check(res.status === 301 && loc === `${ADMIN}/`, `S-7 refueler.io${p} → ${res.status} ${loc}`.trim());
    }
  }

  say(bad ? `✗ ${bad} check(s) failed` : '✓ all checks passed');
  if (outFile) { writeFileSync(outFile, lines.join('\n') + '\n'); console.log(`saved → ${outFile}`); }
  process.exit(bad ? 1 : 0);   // unread redirect bodies would otherwise hold the process open
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
export { ADMIN_PATH };
