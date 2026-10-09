// KV-Fix-2 live check (9 Oct 2026). Creates a throwaway API client through the
// admin route, proves issue / 402 / revocation against production, then revokes it.
// Prints no keys. Run with ADMIN_KEY in the environment:
//   ADMIN_KEY=… node /Users/rajeshtaylor/Documents/refueler-share/bin/kv-fix-2-live-check.mjs
// Afterwards Claude deletes the test rows in Supabase by org_account_id.

import { createHash, createHmac } from 'node:crypto';

const B = 'https://api.share.refueler.io';
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) { console.error('Set ADMIN_KEY first.'); process.exit(1); }

const G = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'; // valid point; test only
const sha = (s) => createHash('sha256').update(s).digest('hex');
const ok  = (label, cond, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`); if (!cond) process.exitCode = 1; };

function signed(method, path, live, sign, body = '') {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', sign).update(`${method}\n${path}\n${ts}\n${sha(body)}`).digest('hex');
  return fetch(B + path, {
    method,
    headers: { Authorization: `HMAC-SHA256 key=${live}, sig=${sig}, ts=${ts}`, 'X-Api-Sign-Key': sign, 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body }),
  });
}
const admin = (path, body) => fetch(B + path, {
  method: 'POST', headers: { 'X-Admin-Key': ADMIN_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const created = await admin('/api/v1/admin/api-client', { plan: 'personal_api', label: 'kv-fix-2 live check' });
ok('create client → 201', created.status === 201, String(created.status));
if (created.status !== 201) process.exit(1);
const c = await created.json();
console.log(`  org_account_id ${c.org_account_id}`);

let r = await signed('GET', '/api/v1/auth/ping', c.live_key, c.sign_key);
let j = await r.json();
ok('auth/ping → 200, pool from Supabase', r.status === 200 && j.remaining_credits === 10000, `${r.status} remaining=${j.remaining_credits}`);

r = await signed('GET', '/api/v1/capabilities', c.live_key, c.sign_key);
j = await r.json();
ok('capabilities → server_pool + max_transfer_bytes', r.status === 200 && j.quota?.model === 'server_pool' && Number.isFinite(j.limits?.max_transfer_bytes),
   `${r.status} model=${j.quota?.model} max_transfer_bytes=${j.limits?.max_transfer_bytes}`);

const body = JSON.stringify({ blinded_message: G });
r = await signed('POST', '/api/v1/credential/issue', c.live_key, c.sign_key, body);
j = await r.json();
ok('credential issue → 200, one credit spent', r.status === 200 && j.quota_remaining === 9999, `${r.status} remaining=${j.quota_remaining}`);

r = await admin('/api/v1/admin/quota/cancel', { live_key: c.live_key, immediate: true });
ok('admin cancel (immediate) → 200', r.status === 200, String(r.status));
r = await signed('POST', '/api/v1/credential/issue', c.live_key, c.sign_key, body);
j = await r.json();
ok('issue after cancel → 402 account_cancelled', r.status === 402 && j.code === 'account_cancelled', `${r.status} ${j.code}`);

r = await admin('/api/v1/admin/api-client/revoke', { live_key: c.live_key });
ok('revoke → 200', r.status === 200, String(r.status));
const t0 = Date.now();
let secs = null;
while (Date.now() - t0 < 120_000) {
  r = await signed('GET', '/api/v1/auth/ping', c.live_key, c.sign_key);
  if (r.status === 401) { secs = Math.round((Date.now() - t0) / 1000); break; }
  await new Promise(res => setTimeout(res, 5000));
}
ok('revoked key refused within 60 s (+5 s poll)', secs !== null && secs <= 65, secs === null ? 'still accepted after 120 s' : `${secs} s`);
console.log(`\nDone. Tell Claude: org ${c.org_account_id}`);
