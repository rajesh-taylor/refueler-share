// Serves the harness's built gate page (.out/gate) on :8768 under the gate's REAL CSP
// (Turnstile-Gate-1, 6 Nov 2026). bin/lib/gate-csp.txt with only what localhost forces changed:
// frame-ancestors becomes the local app, and upgrade-insecure-requests goes. A swap that finds
// nothing to swap stops the server. Local and CI only; nothing here is deployed. (Not :8767 —
// that is Navy Office's harness port.)
//   node dev/share-harness/serve-gate.mjs      (APP_ORIGIN, GATE_PORT to move it)
import http from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '.out', 'gate');
const PORT = +process.env.GATE_PORT || 8768;
const APP = process.env.APP_ORIGIN || 'http://localhost:8765';

export function harnessGateCsp(real) {
  const swap = (s, from, to) => {
    if (!s.includes(from)) throw new Error(`gate-csp.txt no longer has ${from}: update serve-gate.mjs`);
    return s.replace(from, to);
  };
  let csp = real.trim();
  csp = swap(csp, 'frame-ancestors https://share.refueler.io', `frame-ancestors ${APP}`);
  csp = swap(csp, '; upgrade-insecure-requests', '');
  return csp;
}

const CSP = harnessGateCsp(readFileSync(join(HERE, '..', '..', 'bin', 'lib', 'gate-csp.txt'), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const HEADERS = {
  'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store',
};

function resolve(pathname) {
  let rel;
  try { rel = normalize(decodeURIComponent(pathname)); } catch { return null; }
  const full = join(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  try {
    const s = statSync(full);
    if (s.isFile()) return full;
    if (s.isDirectory()) { const i = join(full, 'index.html'); return statSync(i).isFile() ? i : null; }
  } catch { /* not there */ }
  return null;
}

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  const file = resolve(pathname);
  if (!file) { res.writeHead(404, HEADERS); return res.end('not found'); }
  res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`gate (real CSP) http://localhost:${PORT}`));
