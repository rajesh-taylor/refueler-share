// API-Repair-1 live check (9 Oct 2026). Against production, with two throwaway
// API clients made through the admin route:
//   unsigned Chartered initiate → 401 · signed initiate → 200, pool debited ·
//   finalise → cargo.accepted · download (DAD) → cargo.discharged + transfer.confirmed ·
//   every envelope (v0) and receipt sig verified with the whsec · receipt pull:
//   owner 200, other client 404 · then deregister, revoke both.
// Webhooks arrive at a local sink behind the named tunnel refueler-wh-sink
// (wh-sink.refueler.io, bin/lib/wh-sink.mjs) — up only while this runs.
// Prints no keys. Run from anywhere, with ADMIN_KEY set:
//   ADMIN_KEY=… node /Users/rajeshtaylor/Documents/refueler-share/bin/api-repair-1-live-check.mjs
// Afterwards Claude deletes both clients' Supabase rows by org_account_id.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { reconstructRoot } from '../worker/src/merkle.js';
import { blake3 } from '../worker/node_modules/@noble/hashes/blake3.js';
import { startSink } from './lib/wh-sink.mjs';

const require = createRequire(new URL('../worker/package.json', import.meta.url));
const { blindMessage, unblindSignature, pointFromHex } =
  await import(pathToFileURL(require.resolve('@cashu/cashu-ts')).href);

const B = 'https://api.share.refueler.io';
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY || !/^[\x21-\x7e]+$/.test(ADMIN_KEY)) {
  console.error('Set ADMIN_KEY to the real admin key (printable ASCII, not the … placeholder).');
  process.exit(1);
}

const sha = (s) => createHash('sha256').update(s).digest('hex');
const hmac = (k, m) => createHmac('sha256', k).update(m).digest('hex');
const b64u = (b) => Buffer.from(b).toString('base64url');
const ok = (label, cond, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`); if (!cond) process.exitCode = 1; return cond; };

function signed(method, path, c, body = '', extra = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = hmac(c.sign_key, `${method}\n${path}\n${ts}\n${sha(body)}`);
  return fetch(B + path, {
    method,
    headers: { Authorization: `HMAC-SHA256 key=${c.live_key}, sig=${sig}, ts=${ts}`, 'X-Api-Sign-Key': c.sign_key,
               'Content-Type': 'application/json', ...extra },
    ...(method === 'GET' || method === 'DELETE' && !body ? {} : { body }),
  });
}
const admin = (path, body) => fetch(B + path, {
  method: 'POST', headers: { 'X-Admin-Key': ADMIN_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// ── Webhook sink (named tunnel, bin/lib/wh-sink.mjs) ─────────────────────────
const sink = await startSink();
const hookUrl = sink.url;
const events = sink.events;
const waitFor = sink.waitFor;
console.log('  sink up (wh-sink.refueler.io)');

function envelopeOk(e, whsec) {
  const m = String(e.headers['x-refueler-signature'] ?? '').match(/^t=(\d+),v0=([0-9a-f]{64})$/);
  return !!m && hmac(whsec, `v0:${m[1]}:${e.body}`) === m[2];
}
const receiptSigOk = (r, sig, whsec) => sig === `v1=${hmac(whsec, `refueler.receipt.v2\n${JSON.stringify(r)}`)}`;

const orgs = [];
const clients = [];
try {
  // ── Clients ───────────────────────────────────────────────────────────────
  for (const label of ['api-repair-1 live A', 'api-repair-1 live B']) {
    const r = await admin('/api/v1/admin/api-client', { plan: 'personal_api', label });
    ok(`create ${label.slice(-1)} → 201`, r.status === 201, String(r.status));
    if (r.status !== 201) throw new Error('client create failed');
    const c = await r.json();
    clients.push(c); orgs.push(c.org_account_id);
  }
  const [A, Bc] = clients;
  console.log(`  orgs ${orgs.join(' ')}`);

  // ── Register A's webhook ──────────────────────────────────────────────────
  let r = await signed('POST', '/api/v1/webhook/register', A, JSON.stringify({ url: hookUrl }));
  const reg = await r.json();
  ok('register webhook → 200, whsec once', r.status === 200 && /^rfs_whsec_/.test(reg.whsec ?? ''), String(r.status));
  const whsec = reg.whsec;

  // ── Issue a real credential ───────────────────────────────────────────────
  const secret = randomBytes(32).toString('hex');
  const { B_, r: blind } = blindMessage(new TextEncoder().encode(secret));
  r = await signed('POST', '/api/v1/credential/issue', A, JSON.stringify({ blinded_message: B_.toHex(true) }));
  const iss = await r.json();
  ok('credential issue → 200', r.status === 200, String(r.status));
  const C = unblindSignature(pointFromHex(iss.signed_point), blind, pointFromHex(iss.mint_pubkey));
  const credential = JSON.stringify({ id: iss.keyset_id, amount: 1, secret, C: C.toHex(true) });
  const uuid = iss.uuid;

  const chunk = randomBytes(17);                                  // 1 plaintext byte + 16-byte tag
  const initHeaders = {
    'X-Cashu-Credential': credential, 'X-Credential-Commitment': iss.commitment, 'X-Issued-Tier': iss.issued_tier,
    'X-Total-Chunks': '1', 'X-Total-Bytes': '1', 'X-Expiry-Timestamp': String(Math.floor(Date.now() / 1000) + 3600),
    'X-Destroy-After-Download': '1', 'X-Transfer-Ref': 'api-repair-1-live',
  };

  // ── Unsigned Chartered initiate → 401, nothing spent ─────────────────────
  r = await fetch(`${B}/upload/${uuid}/initiate`, { method: 'POST', headers: { ...initHeaders, 'X-Api-Live-Key': A.live_key } });
  ok('unsigned Chartered initiate (even naming the key) → 401', r.status === 401, String(r.status));

  // ── Signed initiate → 200 ─────────────────────────────────────────────────
  const before = await (await signed('GET', '/api/v1/auth/ping', A)).json();
  r = await signed('POST', `/upload/${uuid}/initiate`, A, '', initHeaders);
  const init = await r.json();
  ok('signed initiate → 200', r.status === 200, String(r.status));
  const after = await (await signed('GET', '/api/v1/auth/ping', A)).json();
  ok('pool debited by the transfer cost', after.remaining_credits < before.remaining_credits,
     `${before.remaining_credits} → ${after.remaining_credits}`);

  r = await fetch(init.tail_url.url, { method: 'PUT', body: chunk });
  ok('tail PUT → 200', r.status === 200, String(r.status));

  const digest = blake3(chunk);
  r = await fetch(`${B}/upload/${uuid}/finalise`, {
    method: 'POST', headers: { 'X-Upload-Session': init.session_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes: [b64u(digest)], merkle_root: b64u(reconstructRoot([digest])) }),
  });
  ok('finalise → 200', r.status === 200, String(r.status));

  // ── cargo.accepted ────────────────────────────────────────────────────────
  const acc = await waitFor('cargo.accepted');
  if (ok('cargo.accepted arrived', !!acc)) {
    const b = JSON.parse(acc.body);
    ok('  envelope v0 verifies with whsec', envelopeOk(acc, whsec));
    ok('  receipt sig verifies with whsec', receiptSigOk(b.receipt, b.sig, whsec));
    ok('  receipt names org + transfer_ref, no live key',
       b.receipt.org_account_id === A.org_account_id && b.receipt.transfer_ref === 'api-repair-1-live' && !acc.body.includes('rfs_live_'));
  }
  r = await signed('GET', `/api/v1/receipt/${uuid}/acceptance`, A);
  ok('receipt pull, owner → 200', r.status === 200, String(r.status));
  r = await signed('GET', `/api/v1/receipt/${uuid}/acceptance`, Bc);
  ok('receipt pull, other client → 404', r.status === 404, String(r.status));

  // ── Download (DAD) → cargo.discharged + transfer.confirmed ────────────────
  r = await fetch(`${B}/download/${uuid}/0000`);
  const got = Buffer.from(await r.arrayBuffer());
  ok('download → 200, bytes match', r.status === 200 && got.equals(chunk), String(r.status));
  const dis = await waitFor('cargo.discharged');
  if (ok('cargo.discharged arrived', !!dis)) {
    const b = JSON.parse(dis.body);
    ok('  envelope + receipt verify', envelopeOk(dis, whsec) && receiptSigOk(b.receipt, b.sig, whsec));
  }
  const conf = await waitFor('transfer.confirmed');
  ok('transfer.confirmed arrived, envelope verifies', !!conf && envelopeOk(conf, whsec));
  r = await signed('GET', `/api/v1/receipt/${uuid}/collection`, A);
  ok('collection receipt pull, owner → 200 (after the tombstone)', r.status === 200, String(r.status));

  r = await signed('GET', '/api/v1/webhooks/status', A);
  const st = await r.json();
  ok('webhook status: active, DLQ empty', st.active === true && st.dlq_depth === 0, JSON.stringify(st));
  console.log(`  events received: ${events.map(e => JSON.parse(e.body).event).join(', ')}`);
} catch (e) {
  ok(`run aborted: ${e.message}`, false);
} finally {
  for (const c of clients) {
    await signed('DELETE', '/api/v1/webhook/register', c).catch(() => {});
    const r = await admin('/api/v1/admin/api-client/revoke', { live_key: c.live_key });
    ok(`revoke ${c.org_account_id.slice(0, 8)}… → 200`, r.status === 200, String(r.status));
  }
  sink.close();
  console.log(`\nDelete Supabase rows for: ${orgs.join(' ')}`);
  console.log(process.exitCode ? '✗ LIVE CHECK FAILED' : '✓ LIVE CHECK PASSED');
}
