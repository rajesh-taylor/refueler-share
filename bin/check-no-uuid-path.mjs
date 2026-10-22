#!/usr/bin/env node
// bin/check-no-uuid-path.mjs — UUID-Out-Of-Path-1 · 21 Oct 2026.
//
// No transfer UUID in any URL path on the API. Cloudflare's sampled HTTP-request
// records keep client IP + host + path for at least 31 days, so a UUID in a path ties
// an IP to a transfer. The UUID travels in X-Transfer-UUID (the part in X-Part).
//
// Fails when code builds an API path from a value after a transfer route —
//   `${WORKER_URL}/meta/${uuid}`  ·  '/download/' + id  ·  `/upload/${uuid}/urls`
// — or writes a literal UUID into a path. Comments are skipped.
//
//   node bin/check-no-uuid-path.mjs                 the repo's sources (CI)
//   node bin/check-no-uuid-path.mjs --only <dir>    one tree only, e.g. a built dist/ (ship-app.sh)
//
// The Worker side is checked too: bin/route-inventory.mjs refuses a {uuid} route.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// admin/reports: OSA-Tools-1 — the look-up and take-down name a transfer too (header only).
const ROUTE = '(?:meta|download|unlock|auth|confirm|transfer|upload|timestamp/seal|api/v1/receipt|receipt|admin/reports)';
const RULES = [
  [new RegExp(`(?<!releases)/${ROUTE}/[^'"\`\\s]*\\$[{A-Za-z_]`), 'path built with ${…} / $VAR under a transfer route'],
  [new RegExp(`(?<!releases)/${ROUTE}/['"\`]\\s*\\+`),           'path built with + after a transfer route'],
  [/['"`][^'"`\n]*\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'literal UUID in a path'],
];
const DIRS = ['frontend', 'worker/src', 'worker/scripts', 'bin', 'dev/share-harness', 'scripts', 'src'];
const SKIP = [
  /(^|\/)node_modules\//, /(^|\/)\.out\//, /^frontend\/(blake3|vendor)\//, /^worker\/src\/blake3-wasm\//,
  /\.min\.js$/, /^frontend\/cashu-crypto\.js$/, /^bin\/check-no-uuid-path\.mjs$/,
];
const EXT = new Set(['.js', '.mjs', '.cjs', '.html', '.njk', '.sh']);

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.has(extname(name))) yield p;
  }
}

// Drop // and /* */ comments and shell # comments, keeping line numbers.
function stripComments(text, ext) {
  if (ext === '.sh') return text.replace(/(^|\s)#.*$/gm, '$1');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const only = process.argv.indexOf('--only');
const roots = only > 0 ? [resolve(ROOT, process.argv[only + 1] ?? '')] : DIRS.map((d) => join(ROOT, d));
const problems = [];
let files = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    const rel = relative(ROOT, file);
    if (SKIP.some((re) => re.test(rel))) continue;
    files++;
    const lines = stripComments(readFileSync(file, 'utf8'), extname(file)).split('\n');
    lines.forEach((line, i) => {
      const hit = RULES.find(([re]) => re.test(line));
      if (hit) problems.push(`${rel}:${i + 1}: ${hit[1]}\n      ${line.trim().slice(0, 160)}`);
    });
  }
}

if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`✗ ${problems.length} transfer UUID(s) in a path — send it as X-Transfer-UUID (part: X-Part)`);
  process.exit(1);
}
console.log(`✓ no transfer UUID in a path (${files} files)`);
