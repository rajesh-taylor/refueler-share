// Before H6a (Admin-Access-1b, 31 Oct 2026): kept as history. Admin calls now need the admin host (admin.share.refueler.io) + a Cloudflare Access token.
// B12-3 live check (11 Oct 2026). Against production, with one throwaway API
// client (storage quota: 2 chunks, 2 in flight) made through the admin route:
//   client create provisions a storage quota · signed initiate reserves 1 chunk ·
//   over-quota initiate → 402 with a band, credential not burnt · forged session → 401 ·
//   /urls past the bound → 400 · finalise → used 1 · finalise again → 409 ·
//   DAD download → used 0 (latch winner releases) · owner delete after DAD →
//   nothing released twice · reconcile → 0 corrected · unsafe header → 400 ·
//   soak (test credential) upload: no quota touched, full MAC'd-session round trip ·
//   then revoke.
// Prints no keys. Run with ADMIN_KEY set (prompted, never echoed):
//   read -rs "ADMIN_KEY?ADMIN_KEY: " && echo && ADMIN_KEY="$ADMIN_KEY" node /Users/rajeshtaylor/Documents/refueler-share/bin/b12-3-live-check.mjs; unset ADMIN_KEY
// Afterwards Claude deletes the client's Supabase rows (api_keys, api_credit_pools,
// quota_accounts) by org_account_id / the single quota row this run created.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { reconstructRoot } from '../worker/src/merkle.js';
import { blake3 } from '../worker/node_modules/@noble/hashes/blake3.js';

const require = createRequire(new URL('../worker/package.json', import.meta.url));
const { blindMessage, unblindSignature, pointFromHex } =
  await import(pathToFileURL(require.resolve('@cashu/cashu-ts')).href);

const B = 'https://api.share.refueler.io';
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY || !/^[\x21-\x7e]+$/.test(ADMIN_KEY)) {
  console.error('Set ADMIN_KEY to the real admin key (printable ASCII).');
  process.exit(1);
}

const sha  = (s) => createHash('sha256').update(s).digest('hex');
const hmac = (k, m) => createHmac('sha256', k).update(m).digest('hex');
const b64u = (b) => Buffer.from(b).toString('base64url');
const ok = (label, cond, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`); if (!cond) process.exitCode = 1; return cond; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);

function signed(method, path, c, body = '', extra = {}) {
  const ts = String(now());
  const sig = hmac(c.sign_key, `${method}\n${path}\n${ts}\n${sha(body)}\n${String(extra['X-Transfer-UUID'] ?? '').trim().toLowerCase()}`);
  return fetch(B + path, {
    method,
    headers: { Authorization: `HMAC-SHA256 key=${c.live_key}, sig=${sig}, ts=${ts}`, 'X-Api-Sign-Key': c.sign_key,
               'Content-Type': 'application/json', ...extra },
    ...(method === 'GET' ? {} : { body }),
  });
}
// UUID-Out-Of-Path-1: transfer routes take the UUID as X-Transfer-UUID (part: X-Part), never in the path.
const signedTx = (uuid, method, path, c, body = '', extra = {}) => signed(method, path, c, body, { ...extra, 'X-Transfer-UUID': uuid });
const fetchTx = (uuid, url, init = {}, part) => fetch(url, { ...init, headers: { ...(init.headers ?? {}),
  'X-Transfer-UUID': uuid, ...(part === undefined ? {} : { 'X-Part': String(part).padStart(4, '0') }) } });
const admin = (path, body) => fetch(B + path, {
  method: 'POST', headers: { 'X-Admin-Key': ADMIN_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const quota = async (c) => (await (await admin('/api/v1/admin/storage-quota', { live_key: c.live_key })).json()).storage_quota;

async function issue(c) {
  const secret = randomBytes(32).toString('hex');
  const { B_, r: blind } = blindMessage(new TextEncoder().encode(secret));
  const r = await signed('POST', '/api/v1/credential/issue', c, JSON.stringify({ blinded_message: B_.toHex(true) }));
  const iss = await r.json();
  if (r.status !== 200) throw new Error(`issue ${r.status}`);
  const C = unblindSignature(pointFromHex(iss.signed_point), blind, pointFromHex(iss.mint_pubkey));
  return { iss, credential: JSON.stringify({ id: iss.keyset_id, amount: 1, secret, C: C.toHex(true) }) };
}
const initHeaders = (iss, credential, chunks, bytes, extra = {}) => ({
  'X-Cashu-Credential': credential, 'X-Credential-Commitment': iss.commitment, 'X-Issued-Tier': iss.issued_tier,
  'X-Total-Chunks': String(chunks), 'X-Total-Bytes': String(bytes), 'X-Expiry-Timestamp': String(now() + 3600), ...extra,
});
async function finalise(uuid, token, chunk) {
  const d = blake3(chunk);
  return fetchTx(uuid, `${B}/upload/finalise`, {
    method: 'POST', headers: { 'X-Upload-Session': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes: [b64u(d)], merkle_root: b64u(reconstructRoot([d])) }),
  });
}

let client = null;
try {
  // ── Client + storage quota ────────────────────────────────────────────────
  let r = await admin('/api/v1/admin/api-client', { plan: 'personal_api', label: 'b12-3 live', limit_chunks: 2, max_in_flight: 2 });
  ok('client create → 201', r.status === 201, String(r.status));
  if (r.status !== 201) throw new Error('client create failed');
  client = await r.json();
  console.log(`  org ${client.org_account_id}`);
  ok('storage quota provisioned (2 chunks, 2 in flight)',
     client.storage_quota?.limit_chunks === 2 && client.storage_quota?.max_in_flight === 2, JSON.stringify(client.storage_quota));

  // ── Initiate 1 chunk (DAD) → reserved 1 ──────────────────────────────────
  const a = await issue(client);
  const chunk = randomBytes(17);                                   // 1 byte + 16-byte tag
  r = await signedTx(a.iss.uuid, 'POST', '/upload/initiate', client, '', initHeaders(a.iss, a.credential, 1, 1, { 'X-Destroy-After-Download': '1' }));
  const init = await r.json();
  ok('signed initiate → 200', r.status === 200, String(r.status));
  ok('session token is MAC-shaped (v1.exp.chunks.mac)', /^v1\.\d+\.1\.[A-Za-z0-9_-]{43}$/.test(init.session_token ?? ''));
  let q = await quota(client);
  ok('reserved 1, used 0', q?.reserved_chunks === 1 && q?.used_chunks === 0, JSON.stringify(q));

  // ── Over quota → 402 band, credential not burnt ──────────────────────────
  const b = await issue(client);
  r = await signedTx(b.iss.uuid, 'POST', '/upload/initiate', client, '', initHeaders(b.iss, b.credential, 2, 32 * 1024 * 1024 + 1));
  const over = await r.json();
  ok('over-quota initiate → 402 quota_exceeded with band', r.status === 402 && over.code === 'quota_exceeded' && /^\d+–\d+%$/.test(over.band ?? ''),
     `${r.status} ${JSON.stringify(over)}`);
  ok('402 body carries no exact figures', !/used_chunks|limit_chunks|reserved_chunks/.test(JSON.stringify(over)));

  // ── Unsafe header → 400 ───────────────────────────────────────────────────
  r = await signedTx(b.iss.uuid, 'POST', '/upload/initiate', client, '', initHeaders(b.iss, b.credential, 1, '1e9'));
  ok('X-Total-Bytes "1e9" → 400', r.status === 400, String(r.status));

  // Same (unburnt) credential now fits: proves the 402 spent nothing.
  r = await signedTx(b.iss.uuid, 'POST', '/upload/initiate', client, '', initHeaders(b.iss, b.credential, 1, 1));
  const initB = await r.json();
  ok('the refused credential still works (→ 200, reserved 2)', r.status === 200, String(r.status));

  // ── Forged session + bound ────────────────────────────────────────────────
  r = await fetchTx(a.iss.uuid, `${B}/upload/urls`, { method: 'POST', headers: { 'X-Upload-Session': 'planted', 'Content-Type': 'application/json' }, body: '{"from":0,"count":1}' });
  ok('forged session at /urls → 401', r.status === 401, String(r.status));
  r = await fetchTx(a.iss.uuid, `${B}/upload/urls`, { method: 'POST', headers: { 'X-Upload-Session': initB.session_token, 'Content-Type': 'application/json' }, body: '{"from":0,"count":1}' });
  ok("another transfer's session → 401", r.status === 401, String(r.status));
  r = await fetchTx(a.iss.uuid, `${B}/upload/urls`, { method: 'POST', headers: { 'X-Upload-Session': init.session_token, 'Content-Type': 'application/json' }, body: '{"from":0,"count":1}' });
  ok('/urls for the tail index (≥ N−1) → 400', r.status === 400, String(r.status));

  // ── Upload + finalise A → used 1 ─────────────────────────────────────────
  r = await fetch(init.tail_url.url, { method: 'PUT', body: chunk });
  ok('tail PUT → 200', r.status === 200, String(r.status));
  r = await finalise(a.iss.uuid, init.session_token, chunk);
  ok('finalise → 200', r.status === 200, String(r.status));
  await sleep(1500);
  q = await quota(client);
  ok('A converted: used 1, reserved 1 (B in flight)', q?.used_chunks === 1 && q?.reserved_chunks === 1, JSON.stringify(q));
  r = await finalise(a.iss.uuid, init.session_token, chunk);
  ok('finalise again → 409', r.status === 409, String(r.status));

  // ── Owner-delete B while in progress → its reservation is cancelled ──────
  r = await fetchTx(b.iss.uuid, `${B}/transfer`, { method: 'DELETE', headers: { Authorization: 'Bearer rfs_owner_live', 'X-Admin-Key': ADMIN_KEY } });
  ok('owner delete of in-progress B → 200', r.status === 200, String(r.status));
  q = await quota(client);
  ok('B reservation cancelled: used 1, reserved 0', q?.used_chunks === 1 && q?.reserved_chunks === 0, JSON.stringify(q));

  // ── DAD download → used 0 ────────────────────────────────────────────────
  r = await fetchTx(a.iss.uuid, `${B}/download`, {}, '0000');
  const got = Buffer.from(await r.arrayBuffer());
  ok('download → 200, bytes match', r.status === 200 && got.equals(chunk), String(r.status));
  await sleep(3000);
  q = await quota(client);
  ok('DAD released once: used 0, reserved 0', q?.used_chunks === 0 && q?.reserved_chunks === 0, JSON.stringify(q));
  r = await fetchTx(a.iss.uuid, `${B}/transfer`, { method: 'DELETE', headers: { Authorization: 'Bearer rfs_owner_live', 'X-Admin-Key': ADMIN_KEY } });
  q = await quota(client);
  ok('owner delete after DAD releases nothing (still 0, no clamp)', q?.used_chunks === 0, `${r.status} ${JSON.stringify(q)}`);
  r = await fetchTx(a.iss.uuid, `${B}/meta`);
  ok('A is a tombstone (meta 404/410)', r.status === 404 || r.status === 410, String(r.status));

  // ── Reconcile on demand ───────────────────────────────────────────────────
  r = await admin('/admin/quota-reconcile', {});
  const rec = await r.json();
  ok('reconcile → ok, 0 corrected', r.status === 200 && rec.ok === true && rec.corrected === 0, JSON.stringify(rec));

  // ── Soak (test credential): no quota, MAC'd session end to end ───────────
  const secret = randomBytes(32).toString('hex');
  const { B_, r: blind } = blindMessage(new TextEncoder().encode(secret));
  r = await admin('/admin/test-credential', { blinded_message: B_.toHex(true), cap_bytes: 1024, expires_in_seconds: 900 });
  const tc = await r.json();
  ok('test credential issued', r.status === 200, String(r.status));
  const C = unblindSignature(pointFromHex(tc.signed_point), blind, pointFromHex(tc.mint_pubkey));
  const soakChunk = randomBytes(17);
  r = await fetchTx(tc.uuid, `${B}/upload/initiate`, { method: 'POST', headers: {
    ...initHeaders(tc, JSON.stringify({ id: '00', amount: 1, secret, C: C.toHex(true) }), 1, 1),
    'X-Test-Credential': tc.test_credential, 'X-Destroy-After-Download': '1' } });
  const sInit = await r.json();
  ok('soak initiate → 200 (no HMAC, no quota)', r.status === 200, String(r.status));
  r = await fetch(sInit.tail_url.url, { method: 'PUT', body: soakChunk });
  r = await finalise(tc.uuid, sInit.session_token, soakChunk);
  ok('soak finalise → 200', r.status === 200, String(r.status));
  r = await fetchTx(tc.uuid, `${B}/download`, {}, '0000');
  ok('soak download (DAD) → 200, bytes match', r.status === 200 && Buffer.from(await r.arrayBuffer()).equals(soakChunk), String(r.status));
  q = await quota(client);
  ok("soak touched no quota (client still 0/0)", q?.used_chunks === 0 && q?.reserved_chunks === 0, JSON.stringify(q));
} catch (e) {
  ok(`run aborted: ${e.message}`, false);
} finally {
  if (client) {
    const r = await admin('/api/v1/admin/api-client/revoke', { live_key: client.live_key });
    ok('revoke → 200', r.status === 200, String(r.status));
    console.log(`\nDelete Supabase rows for: ${client.org_account_id}`);
  }
  console.log(process.exitCode ? '✗ LIVE CHECK FAILED' : '✓ LIVE CHECK PASSED');
}
