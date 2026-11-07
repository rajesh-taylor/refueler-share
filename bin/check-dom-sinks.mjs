#!/usr/bin/env node
// bin/check-dom-sinks.mjs — H8 Trusted-Types-1 · 7 Nov 2026.
//
// The app CSP enforces Trusted Types (`require-trusted-types-for 'script'; trusted-types
// share-dom`). A string sent to a DOM sink would throw in the browser; this check refuses it
// before it ships. Every release file is scanned, vendored ones included: a vendored sink means a
// policy or a re-vendor (never an edit to vendored bytes), and an entry in ALLOWED with its reason.
//
// Sinks: innerHTML / outerHTML (= or +=), insertAdjacentHTML, document.write, srcdoc,
// createContextualFragment, setHTMLUnsafe / parseHTMLUnsafe, DOMParser, eval, Function,
// setTimeout/setInterval with a string, .src = / .text = (script elements), setAttribute of
// on*/src/srcdoc, importScripts, new Worker / SharedWorker, serviceWorker.register, and
// trustedTypes.createPolicy outside frontend/trusted-types.js.
//
//   node bin/check-dom-sinks.mjs                 the release sources in frontend/ (CI)
//   node bin/check-dom-sinks.mjs --only <dir>    one built tree, e.g. dist/v/<sha> (ship-app.sh)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const RULES = [
  [/\.(?:inner|outer)HTML\s*\+?=(?!=)/,                'innerHTML / outerHTML assignment'],
  [/\binsertAdjacentHTML\s*\(/,                        'insertAdjacentHTML'],
  [/\bdocument\.write(?:ln)?\s*\(/,                    'document.write'],
  [/\.srcdoc\s*=(?!=)/,                                'srcdoc assignment'],
  [/\bcreateContextualFragment\s*\(/,                  'createContextualFragment'],
  [/\b(?:setHTMLUnsafe|parseHTMLUnsafe)\s*\(/,         'setHTMLUnsafe / parseHTMLUnsafe'],
  [/\bnew\s+DOMParser\b/,                              'DOMParser'],
  [/(?<![\w$.])eval\s*\(/,                             'eval'],
  [/(?<![\w$.])(?:new\s+)?Function\s*\(/,              'Function constructor'],
  [/\bset(?:Timeout|Interval)\s*\(\s*['"`]/,           'setTimeout / setInterval with a string'],
  [/\.src\s*=(?!=)/,                                   '.src assignment (script URL sink)'],
  [/\.text\s*=(?!=)/,                                  '.text assignment (script text sink)'],
  [/\.setAttribute\s*\(\s*['"`](?:on\w+|src|srcdoc)['"`]/i, 'setAttribute of on*/src/srcdoc'],
  [/\bimportScripts\s*\(/,                             'importScripts'],
  [/\bnew\s+(?:Shared)?Worker\s*\(/,                   'new Worker / SharedWorker'],
  [/\bserviceWorker\s*\.\s*register\s*\(/,             'serviceWorker.register'],
  [/\bcreatePolicy\s*\(/,                              'trustedTypes.createPolicy outside trusted-types.js'],
];

// [file basename, text the line contains, reason]. Exact and few; each one read by hand.
const ALLOWED = [
  ['trusted-types.js', 'createPolicy(', 'the one policy, share-dom'],
  ['share.js', "s.src = lateScriptURL('qr-creator.min.js')", 'through the share-dom policy'],
  ['zip.js', "s.src = lateScriptURL('fflate.min.js')", 'through the share-dom policy'],
  ['gate-client.js', 'frame.src = GATE_SRC', 'an <iframe> src is not a Trusted Types sink'],
  ['fflate.min.js', 'new Worker(', 'async API only; zip.js uses Zip + ZipPassThrough (sync); worker-src also refuses blob:'],
  ['qr-creator.min.js', 'b.text=t', 'a plain object field, not a script element'],
  ['qr-creator.min.js', 'a.text=a.text', 'a plain object field, not a script element'],
  ['cashu-crypto.js', 'this.src=e', 'a parser class field, not a script element'],
];

// Minified vendored files: no comment stripping (a // inside a string would cut the line).
const NO_STRIP = /(\.min\.js|^cashu-crypto\.js|^noble-blake3\.js)$/;

function* walk(dir, deep = true) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (deep) yield* walk(p); }
    else if (/\.(?:js|mjs)$/.test(name)) yield p;
  }
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const only = process.argv.indexOf('--only');
const files = only > 0
  ? [...walk(resolve(ROOT, process.argv[only + 1] ?? ''))]
  : [...walk(join(ROOT, 'frontend'), false), ...walk(join(ROOT, 'frontend', 'app')), ...walk(join(ROOT, 'frontend', 'blake3'))];

const problems = [];
const used = new Set();
for (const file of files) {
  const name = basename(file);
  const raw = readFileSync(file, 'utf8');
  const text = NO_STRIP.test(name) ? raw : stripComments(raw);
  // Minified files are one long line: split on ; too, so each hit is judged on its own statement.
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const parts = NO_STRIP.test(name) ? line.split(/;|,(?=[\w$.]+\s*=)/) : [line];
    for (const part of parts) {
      for (const [re, what] of RULES) {
        if (!re.test(part)) continue;
        const ok = ALLOWED.findIndex(([f, s]) => f === name && part.includes(s));
        if (ok >= 0) { used.add(ok); continue; }
        problems.push(`${relative(ROOT, file)}:${i + 1}: ${what}\n      ${part.trim().slice(0, 160)}`);
      }
    }
  });
}

if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`✗ ${problems.length} DOM sink(s) — build with createElement/textContent, or go through frontend/trusted-types.js (H8)`);
  process.exit(1);
}
// A stale exemption is a fail too in the full source scan: the list stays exactly what is there.
if (only < 0) {
  const stale = ALLOWED.filter((_, i) => !used.has(i));
  if (stale.length) {
    for (const [f, s] of stale) console.error(`  ✗ ALLOWED entry no longer matches: ${f}: ${s}`);
    console.error('✗ remove stale entries from ALLOWED in bin/check-dom-sinks.mjs');
    process.exit(1);
  }
}
console.log(`✓ no DOM sink outside the share-dom policy (${files.length} files)`);
