#!/usr/bin/env node
// bin/test/static-site.mjs — serve a built dist/ the way Cloudflare Pages does, for the
// verify-live tests and the watchdog's deliberate-red check. Share-Release-1b · 17 Oct 2026.
// Node, no dependencies. Never used in production.
//
//   node bin/test/static-site.mjs <dist> [port]     (default port 8787; Ctrl-C to stop)
//
// What it copies from Pages: "/" → index.html, "/x/" → x/index.html, "/x" → x.html, the
// headers in dist/_headers' "/*" block on every response ("! Name" lines skipped), and an
// unknown path answered 404 with 404.html. The query string is ignored. _headers isn't served.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', json: 'application/json',
  wasm: 'application/wasm', woff2: 'font/woff2', png: 'image/png', svg: 'image/svg+xml',
  txt: 'text/plain', webmanifest: 'application/manifest+json',
};

export function readHeaders(dist) {
  const f = join(dist, '_headers');
  if (!existsSync(f)) return [];
  const out = [];
  let inAll = false;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (/^\S/.test(line)) { inAll = line.trim() === '/*'; continue; }
    const m = /^\s+([A-Za-z0-9-]+):\s?(.*)$/.exec(line);
    if (inAll && m) out.push([m[1], m[2]]);
  }
  return out;
}

function fileFor(dist, path) {
  const isFile = (rel) => {
    const abs = normalize(join(dist, rel));
    if (!abs.startsWith(normalize(dist) + sep)) return null;
    return existsSync(abs) && statSync(abs).isFile() ? abs : null;
  };
  if (path === '/_headers') return null;
  if (path.endsWith('/')) return isFile(`${path}index.html`);
  return isFile(path) || (!path.endsWith('.html') && isFile(`${path}.html`)) || null;
}

export function pagesHandler(dist) {
  return (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = fileFor(dist, path), status = 200;
    if (!file) { file = fileFor(dist, '/404.html'); status = 404; }
    for (const [k, v] of readHeaders(dist)) res.setHeader(k, v);
    if (!file) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', TYPES[file.split('.').pop()] || 'application/octet-stream');
    res.writeHead(status);
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  };
}

export function startServer(handler, port = 0) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(port, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [dist, port = '8787'] = process.argv.slice(2);
  if (!dist || !existsSync(join(dist, 'index.html'))) {
    console.error('usage: node bin/test/static-site.mjs <dist> [port]   (dist must hold index.html)');
    process.exit(2);
  }
  const s = await startServer(pagesHandler(dist), Number(port));
  console.log(`serving ${dist} at ${s.url} (Pages-style; Ctrl-C to stop)`);
}
