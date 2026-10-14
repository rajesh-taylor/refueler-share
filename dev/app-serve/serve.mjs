// dev/app-serve/serve.mjs — local preview of dist/ (the share.refueler.io build) with the
// headers from dist/_headers applied, like Pages: /x/ → x/index.html, /x → x.html, unknown → 404.html.
// X5-1. Local only, never deployed. Build first: bin/ship-app.sh --check
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const DIST = new URL('../../dist/', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 8094);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json' };

function headers() {
  const h = {};
  for (const line of readFileSync(join(DIST, '_headers'), 'utf8').split('\n')) {
    const m = /^  ([A-Za-z-]+): (.*)$/.exec(line);
    if (m) h[m[1]] = m[2];
  }
  return h;
}

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (path.includes('..')) { res.writeHead(400); return res.end(); }
  const tries = path.endsWith('/') ? [path + 'index.html'] : [path, path + '.html'];
  let file = tries.map(p => join(DIST, p)).find(f => existsSync(f) && statSync(f).isFile());
  let status = 200;
  if (!file) { file = join(DIST, '404.html'); status = 404; }
  res.writeHead(status, { ...headers(), 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`app-serve: http://localhost:${PORT}`));
