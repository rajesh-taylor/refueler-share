// Fake Share Worker for the Share-Upload-2 preview harness. In-memory, localhost only.
// Real credential signing (worker/src/nut00.js) so the browser's DLEQ check passes.
// Control: GET /_ctl?fail=<issue|initiate|chunk:N|drop:N|finalise|finalise409|wrong_size|none>&slow=<ms per chunk PUT, and before each download's first byte>&rate=<MB/s>
// rate: chunk PUTs and downloads move at that speed, so byte progress shows (Share-Progress-1).
// drop:N: part N's PUT or download is cut halfway once, then works (Chrome re-sends a cut PUT by itself).
// down:N: part N's PUT and download answer 503 until fail changes — the page's retry line shows.
// Share-Copy-2 (receiver stop lines): meta503 · meta_incomplete (no part count) · dl401 · auth500 · auth410 · auth_cut (socket cut).
// UUID-Out-Of-Path-1: as the real Worker, transfer routes are fixed paths; the UUID is
// X-Transfer-UUID and the download part X-Part. An old /meta/{uuid}-style call 404s here.
// OSA-Tools-2: /meta 410 {"error":"removed"} after a take-down, or for any link with
// ?fail=meta_removed (?fail=meta_deleted → the plain 410). /admin/reports/* as the Worker
// (whoami, lookup, register, open, update, takedown, export, export-training, delete-training), keys from
// FAKE_ADMIN_KEY / FAKE_HELPER_KEY; GET /_reports → every reports request as received
// (method, url, headers) and the register, for the Terminal-script tests. FAKE_PORT moves it off 8766.
// OSA-Tools-4: /admin/execution-dock in the Worker's shape (status, days_remaining, rail,
// upload_complete …); /_seed?id=<uuid>[&dock=0 not in the dock index][&done=0 still uploading]
// [&tier=citizen][&age=<days old>][&drift=1 the index's tier disagrees with the live record][&n=<k> k more
// random links]; the register keeps report_events (names of fields changed) and export returns them.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { issueBlindSignature } from '../../worker/src/nut00.js';
import { blake3 } from '../../worker/node_modules/@noble/hashes/blake3.js';
import { buildMerkleTree } from '../../worker/src/merkle.js';
const KEY = '1'.repeat(64);
const CHUNK = 32 * 1024 * 1024;
const T = new Map();             // uuid → { total, bytes, chunks: [], dad, pw, expiry, done }
let ctl = { fail: 'none', slow: 0, rate: 0 };
const ADMIN_KEY = process.env.FAKE_ADMIN_KEY || 'fake-admin-key';
// FAKE_HELPER_KEY_FILE: read on every request, so a rehearsal can set and remove the helper key.
const helperKey = () => { try { return process.env.FAKE_HELPER_KEY_FILE ? readFileSync(process.env.FAKE_HELPER_KEY_FILE, 'utf8') : (process.env.FAKE_HELPER_KEY || ''); } catch { return ''; } };
const R = { rows: new Map(), n: { R: 0, T: 0 }, log: [], events: [] };   // the fake report register
const role = (req) => req.headers['x-admin-key'] === ADMIN_KEY ? 'admin'
  : helperKey() && req.headers['x-admin-key'] === helperKey() ? 'helper' : null;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
// B12-4a-2: sign-in + Citizen. One fake session; the cookie is plain (no __Host-/Secure on http).
// GET /_last → what the last initiate carried. /_ctl?tier=free makes the session unpaid.
const auth = { session: null, tokens: new Set(), tier: 'citizen', last: null };
const hasCookie = (req) => /(?:^|;\s*)rfs_session=1(?:;|$)/.test(req.headers.cookie || '');
const credCors = (req) => req.headers.origin === 'http://localhost:8765'
  ? { 'Access-Control-Allow-Origin': req.headers.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type, X-CSRF, X-Transfer-UUID, X-Cashu-Credential, X-Credential-Commitment, X-Issued-Tier, X-Total-Chunks, X-Total-Bytes, X-Expiry-Timestamp, X-File-Name, X-P2SH-Secret-Hash, X-Destroy-After-Download', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' }
  : {};
// no-store on every JSON answer, as the Worker (H1): /meta's URL is the same for every link
// (the UUID is a header), so a cached 410 would otherwise answer for the next link.
const cjson = (req, res, code, o, extra = {}) => { res.writeHead(code, { ...cors, ...credCors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(o)); };
const json = (res, code, o) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
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
  const id = req.headers['x-transfer-uuid'] || '', part = req.headers['x-part'] || '';
  const TRANSFER = ['/upload/initiate', '/upload/urls', '/upload/finalise', '/unlock', '/meta', '/download'];
  if (req.method === 'OPTIONS') {   // credentialed CORS only where the real Worker has it
    const cred = ['auth', 'chambers'].includes(p[0]) || u.pathname === '/upload/initiate';
    res.writeHead(204, { ...cors, ...(cred ? credCors(req) : {}) }); return res.end();
  }
  try {
    if (p[0] === '_ctl') { if (u.searchParams.get('tier')) auth.tier = u.searchParams.get('tier'); if (u.searchParams.get('signout')) auth.session = null; ctl = { fail: u.searchParams.get('fail') || 'none', slow: +(u.searchParams.get('slow') || 0), rate: +(u.searchParams.get('rate') || 0) }; return json(res, 200, ctl); }
    if (p[0] === '_last') return json(res, 200, auth.last);
    if (p[0] === '_reports') return json(res, 200, { log: R.log, rows: [...R.rows.values()] });
    if (p[0] === '_seed') {   // a live, complete transfer to look up and take down: /_seed?id=<uuid>
      const q = (k, d) => u.searchParams.get(k) ?? d;
      const ids = [q('id', crypto.randomUUID()), ...[...Array(+q('n', 0))].map(() => crypto.randomUUID())];
      ids.forEach((sid, k) => {
        const created = Math.floor(Date.now() / 1000) - Math.round(+q('age', 0) * 86400) - k * 3600;
        T.set(sid, { total: 1, bytes: 1, chunks: [Buffer.alloc(1)], dad: false, pw: null, expiry: created + 7 * 86400,
          done: q('done', '1') !== '0', tier: q('tier', 'free'), created, dock: q('dock', '1') !== '0',
          drift: q('drift', '0') === '1' });
      });
      return json(res, 200, { ok: true, ids });
    }
    if (p[0] === 'admin' && p[1] === 'reports') return reports(req, res, u, id);
    if (p[0] === 'admin' && (p[1] === 'execution-dock' || p[1] === 'metrics')) {   // admin key only, as the Worker
      if (role(req) !== 'admin') return json(res, 401, { error: 'Unauthorized' });
      if (p[1] === 'metrics') return json(res, 200, {});
      // As handlers/execution_dock.js: every indexed transfer (the initiate write), newest first;
      // a take-down or deletion clears the entry. upload_complete = finalised (proposed, OSA-Tools-4).
      const now = Math.floor(Date.now() / 1000);
      const transfers = [...T].filter(([, t]) => t.dock !== false && !t.removed && t.created)
        .map(([uuid, t]) => {
          const tier = t.drift ? 'citizen' : (t.tier ?? 'free');
          return { uuid, file_name: 'encrypted-payload', expiry_timestamp: t.expiry, created_at: t.created, tier,
            collected: false, collected_at: null, status: now > t.expiry ? 'expired' : 'active',
            days_remaining: Math.max(0, Math.ceil((t.expiry - now) / 86400)), purged_at: null,
            rail: tier === 'free' ? null : 'identity', merkle_root: null, upload_complete: !!t.done };
        }).sort((a, b) => b.created_at - a.created_at);
      return json(res, 200, { transfers, badge_count: 0 });
    }
    if (TRANSFER.includes(u.pathname) && !/^[0-9a-f-]{36}$/.test(id)) return json(res, 400, { error: 'missing_transfer_id' });
    // The receiver's password check, POST /unlock (any password opens it).
    if (u.pathname === '/unlock') {
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
    if (u.pathname === '/upload/initiate') {
      await body(req);
      auth.last = { cookie: hasCookie(req), csrf: req.headers['x-csrf'] ?? null, bytes: +req.headers['x-total-bytes'] };
      console.log('[fake] initiate', JSON.stringify(auth.last));
      if (auth.last.cookie && auth.last.csrf !== null) {
        if (!auth.session) return cjson(req, res, 401, { error: 'Not signed in' });
        if (auth.last.csrf !== auth.session.csrf) return cjson(req, res, 403, { error: 'Forbidden' });
      }
      const capOk = auth.last.cookie && auth.session && auth.tier === 'citizen' ? 100 * 1024 ** 3 : 4 * 1024 ** 3;
      if (auth.last.bytes > capOk) return cjson(req, res, 413, { error: 'over cap' });
      if (ctl.fail === 'initiate') return cjson(req, res, 401, { error: 'invalid credential' });
      const total = +req.headers['x-total-chunks'], bytes = +req.headers['x-total-bytes'];
      T.set(id, { total, bytes, chunks: [], dad: !!req.headers['x-destroy-after-download'], pw: req.headers['x-p2sh-secret-hash'] || null,
        expiry: +req.headers['x-expiry-timestamp'], done: false, tier: 'free', created: Math.floor(Date.now() / 1000) });
      const full = total - 1, first = Math.min(full, 256);
      return cjson(req, res, 200, { session_token: 'st-' + id, urls: [...Array(first)].map((_, i) => ({ index: i, url: url(id, i) })),
        batch_next: first < full ? first : null, tail_url: { index: total - 1, url: url(id, total - 1), expires: Date.now() / 1000 + 518400 } });
    }
    if (u.pathname === '/upload/urls') {
      const b = JSON.parse(await body(req)); const t = T.get(id);
      if (!t) return json(res, 401, { error: 'session' });
      return json(res, 200, { urls: [...Array(b.count)].map((_, k) => ({ index: b.from + k, url: url(id, b.from + k) })) });
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
    if (u.pathname === '/upload/finalise') {
      const fb = JSON.parse(await body(req)); const t = T.get(id);
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
    if (u.pathname === '/meta') {
      if (ctl.fail === 'meta503') return json(res, 503, { error: 'unavailable' });
      if (ctl.fail === 'meta_removed') return json(res, 410, { error: 'removed' });
      if (ctl.fail === 'meta_deleted') return json(res, 410, { error: 'deleted' });
      const t = T.get(id);
      if (t?.removed) return json(res, 410, { error: 'removed' });
      if (t && ctl.fail === 'meta_incomplete') return json(res, 200, { total_chunks: 0, expiry_timestamp: t.expiry, passphrase_protected: !!t.pw, pending_destruction: null });
      if (!t || !t.done) return json(res, 404, { error: 'not found' });
      return json(res, 200, { total_chunks: t.total, total_bytes: null, expiry_timestamp: t.expiry, file_name: 'encrypted-payload',
        passphrase_protected: !!t.pw, pending_destruction: t.dad ? false : null });
    }
    if (u.pathname === '/download') {
      if (!/^\d{4}$/.test(part)) return json(res, 400, { error: 'missing_part' });
      const t = T.get(id); if (!t || t.removed) return json(res, 410, { error: 'gone' });
      if (ctl.fail === 'down:' + +part) return json(res, 503, { error: 'unavailable' });
      if (ctl.fail === 'dl401') return json(res, 401, { error: 'Invalid or expired download token' });
      console.log(`GET part ${part} ${Date.now() % 100000}`);
      if (ctl.slow) await sleep(ctl.slow);   // like the Worker: whole part read and checked before the first byte
      const b = t.chunks[+part]; res.writeHead(200, { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Length': b.length,
        'X-Integrity': 'ciphertext-storage-verified', 'X-Chunk-Index': String(+part), 'Access-Control-Expose-Headers': 'X-Integrity, X-Chunk-Index' });
      if (t.dad && +part === t.total - 1) setTimeout(() => T.delete(id), 2000);
      return send(res, b, dropOnce(+part));
    }
    json(res, 404, { error: 'no route ' + u.pathname });
  } catch (e) { console.error(e); json(res, 500, { error: String(e) }); }
}).listen(+process.env.FAKE_PORT || 8766, () => console.log(`fake worker :${+process.env.FAKE_PORT || 8766}`));

// ── /admin/reports/* — the same answers as worker/src/handlers/reports.js ─────
async function reports(req, res, u, id) {
  const raw = req.method === 'POST' ? String(await body(req)) : '';
  R.log.push({ method: req.method, url: req.url, headers: req.headers, body: raw });
  const out = (code, o) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
  const who = role(req);
  const route = `${req.method} ${u.pathname}`;
  const adminOnly = ['GET /admin/reports/export', 'GET /admin/reports/export-training', 'POST /admin/reports/delete-training'].includes(route);
  if (!who || (adminOnly && who !== 'admin')) return out(401, { error: 'Unauthorized' });
  const b = raw ? JSON.parse(raw) : {};
  const now = Math.floor(Date.now() / 1000);
  const uuidOk = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
  switch (route) {
    case 'GET /admin/reports/whoami': return out(200, { role: who });
    case 'GET /admin/reports/lookup': {
      if (!uuidOk) return out(400, { error: 'missing_transfer_id' });
      const t = T.get(id);
      if (!t) return out(200, { state: 'not_found', consumed: false });
      if (t.removed) return out(200, { state: 'removed', consumed: true });
      return out(200, { state: t.expiry < now ? 'expired' : 'live', tier: t.tier ?? 'free', created_at: t.created ?? now,
        expires_at: t.expiry, upload_complete: !!t.done, consumed: false });
    }
    case 'GET /admin/reports/register': return out(200, { rows: [...R.rows.values()].reverse() });
    case 'POST /admin/reports/open': {
      if (/@|#|http/i.test(b.reason ?? '')) return out(400, { error: 'reason_forbidden' });
      const pre = b.training ? 'T' : 'R';
      const case_ref = `${pre}-${new Date().getUTCFullYear()}-${String(++R.n[pre]).padStart(3, '0')}`;
      const row = { case_ref, training: !!b.training, received_at: now, route: b.route, uuid8: b.uuid8 ?? null, category: b.category,
        decision: 'open', reason: b.reason ?? null, takedown_at: null, takedown_by: null, nca_ref: null, reporter_told: null,
        key_removed: false, closed_at: null, opened_by: who, updated_at: now };
      R.rows.set(case_ref, row);
      R.events.push({ id: R.events.length + 1, case_ref, at: now, by: who, action: 'open', fields: [] });
      return out(200, { case_ref, row });
    }
    case 'POST /admin/reports/update': {
      const r = R.rows.get(b.case_ref);
      if (!r) return out(404, { error: 'not_found' });
      if (who === 'helper' && !['csea', 'terrorism'].includes(r.category)) return out(403, { error: 'helper_category' });
      if (who === 'helper' && b.category && b.category !== r.category) return out(403, { error: 'helper_category_change' });
      if (/@|#|http/i.test(b.reason ?? '')) return out(400, { error: 'reason_forbidden' });
      const wasOpen = r.decision === 'open';
      const changed = ['category', 'decision', 'reason', 'nca_ref', 'reporter_told', 'key_removed'].filter((k) => k in b && b[k] !== r[k]);
      for (const k of changed) r[k] = b[k];
      r.closed_at = r.decision === 'open' ? null : (r.closed_at ?? now); r.updated_at = now;
      if (changed.length) R.events.push({ id: R.events.length + 1, case_ref: r.case_ref, at: now, by: who,
        action: wasOpen && r.decision !== 'open' ? 'close' : changed.includes('category') ? 'category_change' : 'update', fields: changed });
      return out(200, { row: r });
    }
    case 'POST /admin/reports/takedown': {
      if (!uuidOk) return out(400, { error: 'missing_transfer_id' });
      const r = R.rows.get(b.case_ref), u8 = id.slice(0, 8);
      if (!r) return out(409, { error: 'case_mismatch', why: 'no_such_case' });
      if (r.uuid8 !== u8) return out(409, { error: 'case_mismatch', why: 'other_link' });
      if (r.decision !== 'open') return out(409, { error: 'case_mismatch', why: 'case_closed' });
      if (b.confirm !== u8) return out(400, { error: 'confirm_mismatch' });
      if (who === 'helper' && !['csea', 'terrorism'].includes(r.category)) return out(403, { error: 'helper_category' });
      const t = T.get(id);
      if (!t) return out(404, { error: 'not_found' });
      if (t.removed) return out(200, { already_removed: true, removed_at: t.removedAt });
      if (ctl.fail === 'takedown_partial') return out(202, { partial: true, remaining: 3 });
      t.removed = true; t.removedAt = now; t.chunks = [];
      if (ctl.fail === 'register_down') return out(200, { destroyed: true, removed_at: now, register_updated: false });
      Object.assign(r, { takedown_at: now, takedown_by: who, updated_at: now });
      R.events.push({ id: R.events.length + 1, case_ref: r.case_ref, at: now, by: who, action: 'takedown', fields: ['takedown_at', 'takedown_by'] });
      return out(200, { destroyed: true, removed_at: now, register_updated: true });
    }
    case 'POST /admin/reports/delete-training': {
      let deleted = 0;
      for (const [k, r] of R.rows) if (r.training) { R.rows.delete(k); deleted++; }
      R.events = R.events.filter((e) => !e.case_ref.startsWith('T-'));
      return out(200, { deleted });
    }
    case 'GET /admin/reports/export':
    case 'GET /admin/reports/export-training': {
      const training = u.pathname.endsWith('training');
      return out(200, { exported_at: now, rows: [...R.rows.values()].filter((r) => r.training === training),
        events: R.events.filter((e) => e.case_ref.startsWith(training ? 'T-' : 'R-')) });
    }
  }
  return out(404, { error: 'no route ' + u.pathname });
}
