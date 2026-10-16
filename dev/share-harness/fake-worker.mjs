// Fake Share Worker for the Share-Upload-2 preview harness. In-memory, localhost only.
// Real credential signing (worker/src/nut00.js) so the browser's DLEQ check passes.
// Control: GET /_ctl?fail=<issue|initiate|chunk:N|drop:N|finalise|finalise409|wrong_size|none>&slow=<ms per chunk PUT, and before each download's first byte>&rate=<MB/s>
// rate: chunk PUTs and downloads move at that speed, so byte progress shows (Share-Progress-1).
// drop:N: part N's PUT or download is cut halfway once, then works (Chrome re-sends a cut PUT by itself).
// down:N: part N's PUT and download answer 503 until fail changes — the page's retry line shows.
// Share-Copy-2 (receiver stop lines): meta503 · meta_incomplete (no part count) · dl401 · auth500 · auth410 · auth_cut (socket cut).
import http from 'node:http';
import { issueBlindSignature } from '../../worker/src/nut00.js';
import { blake3 } from '../../worker/node_modules/@noble/hashes/blake3.js';
import { buildMerkleTree } from '../../worker/src/merkle.js';
const KEY = '1'.repeat(64);
const CHUNK = 32 * 1024 * 1024;
const T = new Map();             // uuid → { total, bytes, chunks: [], dad, pw, expiry, done }
let ctl = { fail: 'none', slow: 0, rate: 0 };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
// B12-4a-2: sign-in + Citizen. One fake session; the cookie is plain (no __Host-/Secure on http).
// GET /_last → what the last initiate carried. /_ctl?tier=free makes the session unpaid.
const auth = { session: null, tokens: new Set(), tier: 'max', last: null };
const hasCookie = (req) => /(?:^|;\s*)rfs_session=1(?:;|$)/.test(req.headers.cookie || '');
const credCors = (req) => req.headers.origin === 'http://localhost:8765'
  ? { 'Access-Control-Allow-Origin': req.headers.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type, X-CSRF, X-Cashu-Credential, X-Credential-Commitment, X-Issued-Tier, X-Total-Chunks, X-Total-Bytes, X-Expiry-Timestamp, X-File-Name, X-P2SH-Secret-Hash, X-Destroy-After-Download', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' }
  : {};
const cjson = (req, res, code, o, extra = {}) => { res.writeHead(code, { ...cors, ...credCors(req), 'Content-Type': 'application/json', ...extra }); res.end(JSON.stringify(o)); };
const json = (res, code, o) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise(r => { const b = []; req.on('data', c => { b.push(c); if (ctl.rate) { req.pause(); setTimeout(() => req.resume(), c.length / (ctl.rate * 1048.576)); } }); req.on('end', () => r(Buffer.concat(b))); });
const dropOnce = (i) => { if (ctl.fail !== 'drop:' + i) return false; ctl.fail = 'none'; return true; };
const send = async (res, b, cut) => {
  const step = 256 * 1024, end = cut ? b.length >> 1 : b.length;
  for (let o = 0; o < end; o += step) { res.write(b.subarray(o, Math.min(o + step, end))); if (ctl.rate) await sleep(step / (ctl.rate * 1048.576)); }
  if (cut) return res.socket.destroy();
  res.end();
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const url = (u, i) => `http://localhost:8766/r2/${u}/${i}`;
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname.split('/').filter(Boolean);
  if (req.method === 'OPTIONS') {   // credentialed CORS only where the real Worker has it
    const cred = ['auth', 'chambers'].includes(p[0]) || (p[0] === 'upload' && p[2] === 'initiate');
    res.writeHead(204, { ...cors, ...(cred ? credCors(req) : {}) }); return res.end();
  }
  try {
    if (p[0] === '_ctl') { if (u.searchParams.get('tier')) auth.tier = u.searchParams.get('tier'); if (u.searchParams.get('signout')) auth.session = null; ctl = { fail: u.searchParams.get('fail') || 'none', slow: +(u.searchParams.get('slow') || 0), rate: +(u.searchParams.get('rate') || 0) }; return json(res, 200, ctl); }
    if (p[0] === '_last') return json(res, 200, auth.last);
    // The receiver's password check, POST /auth/:uuid (any password opens it).
    if (p[0] === 'auth' && /^[0-9a-f-]{36}$/.test(p[1] || '')) {
      await body(req);
      if (ctl.fail === 'auth500') return json(res, 500, { error: 'boom' });
      if (ctl.fail === 'auth410') return json(res, 410, { error: 'Transfer expired' });
      if (ctl.fail === 'auth_cut') { req.socket.destroy(); return; }
      return json(res, 200, { token: 'dl-token' });
    }
    if (p[0] === 'auth' || p[0] === 'chambers') {
      const b = req.method === 'POST' ? JSON.parse((await body(req)) || '{}') : {};
      const ok = () => auth.session && hasCookie(req);
      if (p[1] === 'magic') {
        const t = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
        auth.tokens.add(t);
        console.log(`[fake] sign-in link for ${b.email}: http://localhost:8765/signin/#t=${t}`);
        return cjson(req, res, 202, { ok: true });
      }
      if (p[1] === 'verify') {
        if (!auth.tokens.delete(b.token)) return cjson(req, res, 401, { error: 'This link has expired or was already used' });
        auth.session = { csrf: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url') };
        const now = Math.floor(Date.now() / 1000);
        return cjson(req, res, 200, { kind: 'citizen', csrf: auth.session.csrf, idle_expires_at: now + 3600, absolute_expires_at: now + 86400 },
          { 'Set-Cookie': 'rfs_session=1; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400' });
      }
      if (p[1] === 'session') {
        if (!ok()) return cjson(req, res, 401, { error: 'Not signed in' });
        const now = Math.floor(Date.now() / 1000);
        return cjson(req, res, 200, { kind: 'citizen', csrf: auth.session.csrf, tier: auth.tier, idle_expires_at: now + 3600, absolute_expires_at: now + 86400 });
      }
      if (p[1] === 'signout' || p[1] === 'signout-everywhere') {
        if (!ok()) return cjson(req, res, 401, { error: 'Not signed in' });
        if (req.headers['x-csrf'] !== auth.session.csrf) return cjson(req, res, 403, { error: 'Forbidden' });
        auth.session = null;
        return cjson(req, res, 200, { ok: true }, { 'Set-Cookie': 'rfs_session=; Path=/; Max-Age=0' });
      }
      return cjson(req, res, 404, { error: 'no route' });
    }
    if (p[0] === 'status') return json(res, 200, { state: u.searchParams.get('s') || 'operational' });
    if (p[0] === 'log') { await body(req); return json(res, 200, { ok: true }); }
    if (p[0] === 'credential') {
      const b = JSON.parse(await body(req));
      if (ctl.fail === 'issue') return json(res, 403, { error: 'turnstile_failed' });
      const s = issueBlindSignature(b.blinded_message, KEY);
      return json(res, 200, { uuid: crypto.randomUUID(), issued_tier: 'free', commitment: 'c'.repeat(64),
        signed_point: s.signedPoint, mint_pubkey: s.mintPubkey, keyset_id: s.keysetId, dleq: s.dleq });
    }
    if (p[0] === 'admin' && p[1] === 'test-credential') {   // soak page (worker/src/share/admin/test-upload.html)
      const b = JSON.parse(await body(req));
      if (!req.headers['x-admin-key']) return json(res, 401, { error: 'admin key' });
      const s = issueBlindSignature(b.blinded_message, KEY);
      return json(res, 200, { uuid: crypto.randomUUID(), issued_tier: 'free', commitment: 'c'.repeat(64),
        allocation_bytes: b.cap_bytes, signed_point: s.signedPoint, mint_pubkey: s.mintPubkey });
    }
    if (p[0] === 'upload' && p[2] === 'initiate') {
      await body(req);
      auth.last = { cookie: hasCookie(req), csrf: req.headers['x-csrf'] ?? null, bytes: +req.headers['x-total-bytes'] };
      console.log('[fake] initiate', JSON.stringify(auth.last));
      if (auth.last.cookie && auth.last.csrf !== null) {
        if (!auth.session) return cjson(req, res, 401, { error: 'Not signed in' });
        if (auth.last.csrf !== auth.session.csrf) return cjson(req, res, 403, { error: 'Forbidden' });
      }
      const capOk = auth.last.cookie && auth.session && auth.tier === 'max' ? 100 * 1024 ** 3 : 4 * 1024 ** 3;
      if (auth.last.bytes > capOk) return cjson(req, res, 413, { error: 'over cap' });
      if (ctl.fail === 'initiate') return cjson(req, res, 401, { error: 'invalid credential' });
      const total = +req.headers['x-total-chunks'], bytes = +req.headers['x-total-bytes'];
      T.set(p[1], { total, bytes, chunks: [], dad: !!req.headers['x-destroy-after-download'], pw: req.headers['x-p2sh-secret-hash'] || null,
        expiry: +req.headers['x-expiry-timestamp'], done: false });
      const full = total - 1, first = Math.min(full, 256);
      return cjson(req, res, 200, { session_token: 'st-' + p[1], urls: [...Array(first)].map((_, i) => ({ index: i, url: url(p[1], i) })),
        batch_next: first < full ? first : null, tail_url: { index: total - 1, url: url(p[1], total - 1), expires: Date.now() / 1000 + 518400 } });
    }
    if (p[0] === 'upload' && p[2] === 'urls') {
      const b = JSON.parse(await body(req)); const t = T.get(p[1]);
      if (!t) return json(res, 401, { error: 'session' });
      return json(res, 200, { urls: [...Array(b.count)].map((_, k) => ({ index: b.from + k, url: url(p[1], b.from + k) })) });
    }
    if (p[0] === 'r2') {
      const i = +p[2];
      if (dropOnce(i)) { setTimeout(() => req.socket.destroy(), 1500); return; }
      const b = await body(req); const t = T.get(p[1]);
      if (ctl.fail === 'down:' + i) return json(res, 503, { error: 'unavailable' });
      if (ctl.slow) await sleep(ctl.slow);
      if (ctl.fail === 'chunk:' + i) { req.socket.destroy(); return; }
      t.chunks[i] = b; res.writeHead(200, cors); return res.end();
    }
    if (p[0] === 'upload' && p[2] === 'finalise') {
      const fb = JSON.parse(await body(req)); const t = T.get(p[1]);
      if (!t) return json(res, 401, { error: 'session' });
      if (ctl.fail === 'finalise409') return json(res, 409, { error: 'incomplete', missing: [3] });
      if (ctl.fail === 'wrong_size') return json(res, 409, { error: 'wrong_size', segments: [2] });
      if (ctl.fail === 'finalise') return json(res, 500, { error: 'boom' });
      // As the real Worker: every part present, leaves = BLAKE3 of the stored bytes, root over them.
      const b64 = (x) => Buffer.from(x).toString('base64url');
      const missing = [...Array(t.total).keys()].filter(i => !t.chunks[i]);
      if (missing.length) return json(res, 409, { error: 'incomplete', missing });
      const leaves = t.chunks.slice(0, t.total).map(c => blake3(new Uint8Array(c)));
      const bad = leaves.findIndex((h, i) => b64(h) !== fb.hashes?.[i]);
      if (bad >= 0 || fb.hashes.length !== t.total) return json(res, 400, { error: 'hash mismatch', index: bad });
      if (b64(buildMerkleTree(leaves).root) !== fb.merkle_root) return json(res, 400, { error: 'root mismatch' });
      t.done = true; return json(res, 200, { ok: true, merkle_root: fb.merkle_root });
    }
    if (p[0] === 'meta') {
      if (ctl.fail === 'meta503') return json(res, 503, { error: 'unavailable' });
      const t = T.get(p[1]);
      if (t && ctl.fail === 'meta_incomplete') return json(res, 200, { total_chunks: 0, expiry_timestamp: t.expiry, passphrase_protected: !!t.pw, pending_destruction: null });
      if (!t || !t.done) return json(res, 404, { error: 'not found' });
      return json(res, 200, { total_chunks: t.total, total_bytes: null, expiry_timestamp: t.expiry, file_name: 'encrypted-payload',
        passphrase_protected: !!t.pw, pending_destruction: t.dad ? false : null });
    }
    if (p[0] === 'download') {
      const t = T.get(p[1]); if (!t) return json(res, 410, { error: 'gone' });
      if (ctl.fail === 'down:' + +p[2]) return json(res, 503, { error: 'unavailable' });
      if (ctl.fail === 'dl401') return json(res, 401, { error: 'Invalid or expired download token' });
      console.log(`GET part ${p[2]} ${Date.now() % 100000}`);
      if (ctl.slow) await sleep(ctl.slow);   // like the Worker: whole part read and checked before the first byte
      const b = t.chunks[+p[2]]; res.writeHead(200, { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Length': b.length,
        'X-Integrity': 'ciphertext-storage-verified', 'X-Chunk-Index': p[2], 'Access-Control-Expose-Headers': 'X-Integrity, X-Chunk-Index' });
      if (t.dad && +p[2] === t.total - 1) setTimeout(() => T.delete(p[1]), 2000);
      return send(res, b, dropOnce(+p[2]));
    }
    json(res, 404, { error: 'no route ' + u.pathname });
  } catch (e) { console.error(e); json(res, 500, { error: String(e) }); }
}).listen(8766, () => console.log('fake worker :8766'));
