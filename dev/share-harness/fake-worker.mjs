// Fake Share Worker for the Share-Upload-2 preview harness. In-memory, localhost only.
// Real credential signing (worker/src/nut00.js) so the browser's DLEQ check passes.
// Control: GET /_ctl?fail=<issue|initiate|chunk:N|finalise|finalise409|wrong_size|none>&slow=<ms per chunk>
import http from 'node:http';
import { issueBlindSignature } from '../../worker/src/nut00.js';
import { blake3 } from '../../worker/node_modules/@noble/hashes/blake3.js';
import { buildMerkleTree } from '../../worker/src/merkle.js';
const KEY = '1'.repeat(64);
const CHUNK = 32 * 1024 * 1024;
const T = new Map();             // uuid → { total, bytes, chunks: [], dad, pw, expiry, done }
let ctl = { fail: 'none', slow: 0 };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const json = (res, code, o) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise(r => { const b = []; req.on('data', c => b.push(c)); req.on('end', () => r(Buffer.concat(b))); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const url = (u, i) => `http://localhost:8766/r2/${u}/${i}`;
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname.split('/').filter(Boolean);
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  try {
    if (p[0] === '_ctl') { ctl = { fail: u.searchParams.get('fail') || 'none', slow: +(u.searchParams.get('slow') || 0) }; return json(res, 200, ctl); }
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
      if (ctl.fail === 'initiate') return json(res, 401, { error: 'invalid credential' });
      const total = +req.headers['x-total-chunks'], bytes = +req.headers['x-total-bytes'];
      T.set(p[1], { total, bytes, chunks: [], dad: !!req.headers['x-destroy-after-download'], pw: req.headers['x-p2sh-secret-hash'] || null,
        expiry: +req.headers['x-expiry-timestamp'], done: false });
      const full = total - 1, first = Math.min(full, 256);
      return json(res, 200, { session_token: 'st-' + p[1], urls: [...Array(first)].map((_, i) => ({ index: i, url: url(p[1], i) })),
        batch_next: first < full ? first : null, tail_url: { index: total - 1, url: url(p[1], total - 1), expires: Date.now() / 1000 + 518400 } });
    }
    if (p[0] === 'upload' && p[2] === 'urls') {
      const b = JSON.parse(await body(req)); const t = T.get(p[1]);
      if (!t) return json(res, 401, { error: 'session' });
      return json(res, 200, { urls: [...Array(b.count)].map((_, k) => ({ index: b.from + k, url: url(p[1], b.from + k) })) });
    }
    if (p[0] === 'r2') {
      const b = await body(req); const t = T.get(p[1]); const i = +p[2];
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
      const t = T.get(p[1]); if (!t || !t.done) return json(res, 404, { error: 'not found' });
      return json(res, 200, { total_chunks: t.total, total_bytes: null, expiry_timestamp: t.expiry, file_name: 'encrypted-payload',
        passphrase_protected: !!t.pw, pending_destruction: t.dad ? false : null });
    }
    if (p[0] === 'auth') { await body(req); return json(res, 200, { token: 'dl-token' }); }
    if (p[0] === 'download') {
      const t = T.get(p[1]); if (!t) return json(res, 410, { error: 'gone' });
      const b = t.chunks[+p[2]]; res.writeHead(200, { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Length': b.length,
        'X-Integrity': 'ciphertext-storage-verified', 'X-Chunk-Index': p[2], 'Access-Control-Expose-Headers': 'X-Integrity, X-Chunk-Index' });
      if (t.dad && +p[2] === t.total - 1) setTimeout(() => T.delete(p[1]), 2000);
      return res.end(b);
    }
    json(res, 404, { error: 'no route ' + u.pathname });
  } catch (e) { console.error(e); json(res, 500, { error: String(e) }); }
}).listen(8766, () => console.log('fake worker :8766'));
