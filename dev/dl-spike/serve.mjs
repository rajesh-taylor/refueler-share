// dev/dl-spike/serve.mjs — Share-DL-Spike (10 Oct 2026). Scratch, never shipped.
//
// Serves the spike page on http://localhost:8787 (loopback only). localhost is a
// secure context, so service workers run, and the Worker's CORS already echoes
// localhost origins. The browser's own modules are read live from frontend/ —
// nothing copied.
//
//   /                       index.html
//   /assets/{crypto,config,fragment}.js   frontend/ as-is
//   /assets/{parts,sw}.js   this folder
//   /assets/sw-classic.js   config + crypto + parts + sw, imports/exports stripped
//                           (for browsers without module service workers)
//   POST /log               one JSON line → ~/.refueler-soak/dl-spike.log (no key, no link)
//   anything else           200 + an HTML stand-in, like refueler.io answers a missing
//                           path — so an un-intercepted download shows up as such
//
//   node /Users/rajeshtaylor/Documents/refueler-share/dev/dl-spike/serve.mjs
//
// --relay (iPhone, S-2): second instance on 127.0.0.1:8788 for a cloudflared quick
// tunnel. A phone's page can't be on localhost, and the Worker's CORS only allows
// refueler.io + localhost, so config.js is served with WORKER_URL = '/relay' and
// /relay/meta/<uuid> + /relay/download/<uuid>/<NNNN> are streamed through from the
// Worker (status, X-Integrity, Content-Length kept). Nothing else is relayed.

import http from 'node:http';
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const RELAY = process.argv.includes('--relay');
const PORT  = RELAY ? 8788 : 8787;
const WORKER = 'https://api.share.refueler.io';
const RELAY_RE = /^\/relay\/(meta\/[0-9a-f-]{36}|download\/[0-9a-f-]{36}\/\d{4})$/i;
const HERE  = new URL('./', import.meta.url);
const FRONT = new URL('../../frontend/', import.meta.url);
const LOG_DIR  = join(homedir(), '.refueler-soak');
const LOG_FILE = join(LOG_DIR, 'dl-spike.log');
mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });

const read = (base, f) => readFileSync(new URL(f, base), 'utf8');
const files = {
  '/assets/crypto.js':   () => read(FRONT, 'crypto.js'),
  '/assets/config.js':   () => relayConfig(read(FRONT, 'config.js')),
  '/assets/fragment.js': () => read(FRONT, 'fragment.js'),
  '/assets/parts.js':    () => read(HERE, 'parts.js'),
  '/assets/sw.js':       () => read(HERE, 'sw.js'),
};

const relayConfig = src => (RELAY
  ? src.replace(/export const WORKER_URL\s*=\s*'[^']*';/, "export const WORKER_URL  = '/relay';")
  : src);

async function relay(path, res) {
  try {
    const up = await fetch(WORKER + path.slice('/relay'.length), { headers: { 'Cache-Control': 'no-store' } });
    const h = { 'Cache-Control': 'no-store', 'Content-Type': up.headers.get('content-type') || 'application/octet-stream' };
    for (const k of ['content-length', 'x-integrity']) if (up.headers.get(k)) h[k] = up.headers.get(k);
    res.writeHead(up.status, h);
    if (!up.body) return res.end();
    for await (const c of up.body) if (!res.write(c)) await new Promise(r => res.once('drain', r));
    res.end();
  } catch (e) {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end();
  }
}

// Classic build: drop single-line static imports, drop the `export` keyword.
const classic = src => src
  .replace(/^import\s.*?from\s+['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^export\s+(?=(async\s+)?function|const|let|class)/gm, '');
const swClassic = () => [
  read(FRONT, 'config.js'), read(FRONT, 'crypto.js'), read(HERE, 'parts.js'),
  read(HERE, 'sw.js').replace("const SW_KIND = 'module';", "const SW_KIND = 'classic';"),
].map(classic).join('\n;\n');

const STANDIN = '<!doctype html><title>not-intercepted</title><h1>Homepage stand-in</h1>';

function handler(req, res) {
  const path = new URL(req.url, 'http://localhost').pathname;
  const send = (code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  if (req.method === 'POST' && path === '/log') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        appendFileSync(LOG_FILE, JSON.stringify({ t: new Date().toISOString(), ua: req.headers['user-agent'], ...j }) + '\n', { mode: 0o600 });
        console.log(`${new Date().toISOString().slice(11, 19)} ${j.ev} ${j.i ?? ''}${j.msg ? ' ' + j.msg : ''}`);
      } catch { /* drop */ }
      send(204, 'text/plain', '');
    });
    return;
  }
  if (RELAY && req.method === 'GET' && RELAY_RE.test(path)) return relay(path, res);
  try {
    if (path === '/' || path === '/index.html') return send(200, 'text/html; charset=utf-8', read(HERE, 'index.html'));
    if (path === '/assets/sw-classic.js') return send(200, 'text/javascript', swClassic());
    if (files[path]) return send(200, 'text/javascript', files[path]());
  } catch (e) {
    return send(500, 'text/plain', e.message);
  }
  send(200, 'text/html; charset=utf-8', STANDIN);
}

for (const host of RELAY ? ['127.0.0.1'] : ['127.0.0.1', '::1']) {
  http.createServer(handler).listen(PORT, host, () => console.log(`dl-spike on http://localhost:${PORT} (${host}) · log ${LOG_FILE}`));
}
