// Serves the harness's built app (.out/app) on :8765 under the REAL CSP (H3 Smoke-1, 4 Nov 2026).
// bin/lib/app-csp.txt with only what localhost forces changed: the API origin becomes the fake
// Worker, and upgrade-insecure-requests goes. A swap that finds nothing to swap stops the server,
// so this can't quietly serve a weaker policy. Local and CI only; nothing here is deployed.
//   node dev/share-harness/serve-app.mjs      (FAKE_ORIGIN, APP_PORT to move it)
import http from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '.out', 'app');
const PORT = +process.env.APP_PORT || 8765;
const FAKE = process.env.FAKE_ORIGIN || 'http://localhost:8766';
const GATE = process.env.GATE_ORIGIN || 'http://localhost:8768';

export function harnessCsp(real) {
  const swap = (s, from, to) => {
    if (!s.includes(from)) throw new Error(`app-csp.txt no longer has ${from}: update serve-app.mjs`);
    return s.replace(from, to);
  };
  let csp = real.trim();
  csp = swap(csp, 'https://api.share.refueler.io', FAKE);
  csp = swap(csp, '; upgrade-insecure-requests', '');
  // Turnstile-Gate-1: the app frames the local gate (serve-gate.mjs).
  csp = swap(csp, 'frame-src https://gate.share.refueler.io', `frame-src ${GATE}`);
  return csp;
}

const CSP = harnessCsp(readFileSync(join(HERE, '..', '..', 'bin', 'lib', 'app-csp.txt'), 'utf8'));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
};
const HEADERS = {
  'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-store',
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
}).listen(PORT, () => console.log(`app (real CSP) http://localhost:${PORT}`));
