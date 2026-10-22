// Navy Office, local, with its real CSP (OSA-Tools-3 · 22 Oct 2026). Local only; nothing deployed.
// Serves refueler.io/src/share/admin/ on :8767 with the /share/admin/* headers from refueler.io's
// src/_headers, two changes only: connect-src → the fake Worker, and navy-office.js's WORKER constant
// → the fake Worker. So a CSP fault (inline handler, style=, a stray fetch) shows here as it would live.
//   node dev/share-harness/fake-worker.mjs         # :8766 (FAKE_HELPER_KEY_FILE for the helper view)
//   node dev/share-harness/navy-office-serve.mjs   # http://localhost:8767/navy-office.html
// REFUELER_IO overrides the refueler.io checkout; FAKE_WORKER the Worker origin.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';

const SITE = process.env.REFUELER_IO || '/Users/rajeshtaylor/Documents/refueler.io';
const DIR = join(SITE, 'src/share/admin');
const FAKE = process.env.FAKE_WORKER || 'http://localhost:8766';
const LIVE = 'https://api.share.refueler.io';

// The /share/admin/* block of _headers, read fresh per request so an edit there shows at once.
function headers() {
  const lines = readFileSync(join(SITE, 'src/_headers'), 'utf8').split('\n');
  const at = lines.findIndex((l) => l.trim() === '/share/admin/*');
  if (at < 0) throw new Error('no /share/admin/* block in _headers');
  const out = {};
  for (const l of lines.slice(at + 1)) {
    if (!/^\s+\S/.test(l)) break;
    const i = l.indexOf(':');
    out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  if (!out['Content-Security-Policy']?.includes(`connect-src ${LIVE};`)) throw new Error('CSP connect-src is not the Worker alone');
  out['Content-Security-Policy'] = out['Content-Security-Policy'].replace(`connect-src ${LIVE};`, `connect-src ${FAKE};`);
  return out;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.txt': 'text/plain' };

http.createServer((req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'navy-office.html';
    if (p.startsWith('..')) { res.writeHead(400); return res.end(); }
    let body = readFileSync(join(DIR, p));
    if (p === 'navy-office.js') {
      const src = body.toString('utf8');
      if (!src.includes(`const WORKER = '${LIVE}';`)) throw new Error('WORKER constant not found');
      body = src.replace(`const WORKER = '${LIVE}';`, `const WORKER = '${FAKE}';`);
    }
    res.writeHead(200, { ...headers(), 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
    res.end(e.code === 'ENOENT' ? 'not found' : String(e.message));
  }
}).listen(8767, () => console.log(`navy office :8767 → ${DIR} (Worker ${FAKE})`));
