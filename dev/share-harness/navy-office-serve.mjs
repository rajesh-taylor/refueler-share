// Navy Office, local, with its real headers (OSA-Tools-3 · 22 Oct 2026; Admin-Access-1b · 31 Oct 2026).
// Local only; nothing deployed. Serves refueler-share's navy-office/ on :8767 with the headers the
// Worker sends on admin.share.refueler.io (worker/src/admin_headers.js, the same function), and
// passes every admin path (/admin…, /api/v1/admin…) to the fake Worker — so, as live, the page and
// its API share one origin and CSP connect-src 'self' holds. A CSP fault (inline handler, style=,
// a stray fetch to another origin) shows here as it would live. No Access here: that gate is tested
// in worker/test/admin_host.test.js and the live check.
//   node dev/share-harness/fake-worker.mjs         # :8766 (FAKE_HELPER_KEY_FILE for the helper view)
//   node dev/share-harness/navy-office-serve.mjs   # http://localhost:8767/
// FAKE_WORKER overrides the fake Worker origin.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_HEADERS } from '../../worker/src/admin_headers.js';
import { ADMIN_PATH } from '../../bin/lib/route-inventory-lib.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../navy-office');
const FAKE = process.env.FAKE_WORKER || 'http://localhost:8766';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.txt': 'text/plain' };

async function proxy(req, res, path) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { ...req.headers };
  delete headers.host;
  const r = await fetch(FAKE + req.url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
  const out = {};
  r.headers.forEach((v, k) => { if (!k.startsWith('access-control-')) out[k] = v; });   // none on the admin host
  res.writeHead(r.status, out);
  res.end(Buffer.from(await r.arrayBuffer()));
}

http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://x').pathname;
    if (ADMIN_PATH.test(path)) return await proxy(req, res, path);
    const p = normalize(decodeURIComponent(path)).replace(/^\/+/, '') || 'index.html';
    if (p.startsWith('..') || p.startsWith('.') || !['GET', 'HEAD'].includes(req.method)) throw Object.assign(new Error(), { code: 'ENOENT' });
    const body = readFileSync(join(DIR, p));
    res.writeHead(200, { ...ADMIN_HEADERS, 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500, { ...ADMIN_HEADERS, 'Content-Type': 'text/plain' });
    res.end(e.code === 'ENOENT' ? 'not found' : String(e.message));
  }
}).listen(8767, () => console.log(`navy office :8767 → ${DIR} (admin paths → ${FAKE})`));
