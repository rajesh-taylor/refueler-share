#!/usr/bin/env node
// Scripted mutation testing of the crypto modules (Test-Hardening-1, 4 Nov 2026). No new package.
// Why: at Worker-Keys-1 a junk-signature bug survived a passing suite for months, because no test
// sent a well-formed wrong signature. A mutant is one small deliberate bug; if every test still
// passes, nothing is watching that line.
//
//   node dev/mutants/run.mjs --out=<folder outside this repo> [--jobs=3] [--only=download_gate] [--retest=<an earlier mutants.json>] [--list]
// --retest runs only that file's survivors: the check after adding a test.
//
// Works on temporary copies, never this checkout, and never copies .dev.vars. Each mutant first
// runs its module's own tests (seconds); survivors then run the whole suite. Not a CI gate.
// Survivors point at test gaps, so results stay out of this public repo: --out refuses it.
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const JOBS = +arg('jobs', 3);
const ONLY = arg('only', '');
const LIST = process.argv.includes('--list');
const OUT = arg('out', '');
if (!LIST) {
  if (!OUT) { console.error('--out=<folder outside this repo> is required'); process.exit(2); }
  if (!relative(ROOT, resolve(OUT)).startsWith('..')) { console.error('--out must be outside this repo: results point at test gaps'); process.exit(2); }
}

// What gets mutated: whole file, or the lines between two markers.
const TARGETS = [
  { name: 'download_gate', file: 'worker/src/download_gate.js', from: 'export function timingSafeEqual', tests: ['dltoken', 'fuzz'] },
  { name: 'upload_session', file: 'worker/src/upload_session.js', from: 'const TOKEN_RE', tests: ['fuzz', 'share-6-3a'] },
  { name: 'part-crypto', file: 'frontend/crypto.js', from: 'const _PAYLOAD_INFO', to: '// Credential format v2', tests: ['part-crypto', 'kat-vectors'] },
  { name: 'proof', file: 'worker/src/nut00.js', from: 'export function verifyProofV2', tests: ['nut00', 'credential-v2', 'kat-vectors', 'fuzz'] },
];

// Line operators. Each regex match gives one mutant.
const OPS = [
  ['===', /===/g, '!=='], ['!==', /!==/g, '==='], ['&&', /&&/g, '||'], ['||', /\|\|/g, '&&'],
  ['>', / > /g, ' >= '], ['>=', / >= /g, ' > '], ['<', / < /g, ' <= '], ['<=', / <= /g, ' < '],
  ['+', / \+ /g, ' - '], ['-', / - /g, ' + '], ['!', /(?<=[( ])!(?=[a-zA-Z_(])/g, ''],
  ['true', /\btrue\b/g, 'false'], ['false', /\bfalse\b/g, 'true'], ['|=', /\|=/g, '&='], ['^', / \^ /g, ' & '],
  ['int', /(?<![\w.$'"-])\d+(?![\w.'"])/g, (m) => String(+m + 1)],
  ['hex', /\b0x[0-9a-fA-F]+\b/g, (m) => String(+m + 1)],
  ['refused', /return refused;/g, "return { valid: true, uuid: '0f8fad5b-d9cb-469f-a165-70867728950e' };"],
  ['null', /return null;/g, 'return {};'],
  ['tag', /'refueler\.[a-z0-9.]+'/g, (m) => m.slice(0, -1) + "x'"],
];
const GUARD = /^\s*if \(.*\) (return\b.*|throw\b.*);\s*$/;

// Bugs of the kind that matter here, spelled out. A find that stops matching stops the run.
const HAND = [
  ['download_gate', 'tagged(textEnc.encode(payload))))) return refused', 'textEnc.encode(payload)))) return refused', 'verify drops the MAC tag'],
  ['download_gate', "crypto.subtle.sign('HMAC', key, tagged(textEnc.encode(payload)))", "crypto.subtle.sign('HMAC', key, textEnc.encode(payload))", 'issue drops the MAC tag'],
  ['download_gate', 'info: tagged(new Uint8Array(0))', 'info: new Uint8Array(0)', 'HKDF info without its tag'],
  ['download_gate', 'return bufToBase64url(bytes) === sigB64 ? bytes : null;', 'return bytes;', 'second spelling of a signature accepted'],
  ['download_gate', '|| now > claims.exp', '', 'expiry not checked'],
  ['download_gate', 'typeof claims?.uuid !== \'string\' || ', '', 'uuid type not checked'],
  ['download_gate', '!Number.isInteger(claims.exp) || ', '', 'exp type not checked'],
  ['download_gate', "if (!HEX.test(a) || !HEX.test(b)) return false;", '', 'non-hex compared in timingSafeEqual'],
  ['download_gate', 'raw.length !== DL_TOKEN_BYTES', 'false', 'a short DL_TOKEN_KEY accepted'],
  ['upload_session', 'crypto.subtle.timingSafeEqual(presented, expected)', 'true', 'MAC not compared'],
  ['upload_session', 'msg.set(u, tag.length + 1);', '', 'UUID not in the MAC'],
  ['upload_session', 'dv.setUint32(tag.length + 17, totalChunks, false);', '', 'part count not in the MAC'],
  ['upload_session', 'dv.setBigUint64(tag.length + 21, BigInt(sessionExp), false);', '', 'expiry not in the MAC'],
  ['upload_session', 'totalChunks > MAX_TRANSFER_CHUNKS || ', '', 'part cap not checked'],
  ['upload_session', ' || sessionExp <= nowSeconds', '', 'expiry not checked'],
  ['upload_session', 'if (bytesToB64url(presented) !== m[3]) return null;', '', 'second spelling of a session token accepted'],
  ['part-crypto', ", 0x00]);", "]);", 'HKDF info loses its 0x00'],
  ['part-crypto', "salt: new Uint8Array(0), info: _PAYLOAD_INFO", "salt: new Uint8Array(32), info: _PAYLOAD_INFO", 'HKDF salt changed'],
  ['part-crypto', 'n[11] = last ? 1 : 0;', 'n[11] = 0;', 'no last-chunk flag'],
  ['part-crypto', 'new DataView(n.buffer).setUint32(7, i, false);', '', 'nonce has no counter'],
  ['part-crypto', "{ name: 'AES-GCM', iv: partNonce(i, i === n - 1), additionalData: partAad(i) }, partKey, raw,", "{ name: 'AES-GCM', iv: partNonce(i, i === n - 1) }, partKey, raw,", 'encrypt drops the AAD'],
  ['part-crypto', "{ name: 'AES-GCM', iv: partNonce(i, i === n - 1), additionalData: partAad(i) }, partKey, ct,", "{ name: 'AES-GCM', iv: partNonce(i, i === n - 1) }, partKey, ct,", 'decrypt drops the AAD'],
  ['part-crypto', "iv: partNonce(i, i === n - 1), additionalData: partAad(i) }, partKey, ct,", "iv: partNonce(i, false), additionalData: partAad(i) }, partKey, ct,", 'decrypt never checks last'],
  ['part-crypto', "if (k.length !== 32) throw new TypeError('derivePartKey: K must be 32 bytes');", '', 'any K length'],
  ['proof', 'if (!equalBytes(expected, hexToBytes(C))) throw new Error(\'Proof signature invalid\');', '', 'signature not checked'],
  ['proof', "if (typeof id !== 'string' || id !== keysetIdFor(mintPrivkeyHex)) throw new Error('Unknown keyset id');", '', 'keyset not checked'],
  ['proof', "if (!PROOF_V2_FIELDS.has(key)) throw new Error('Unexpected proof field');", '', 'unknown fields allowed'],
  ['proof', "if (amount !== undefined && amount !== 1)                   throw new Error('Invalid proof amount');", '', 'any amount'],
  ['proof', 'return { serial: Y.toHex(true) };', 'return { serial: C };', 'serial taken from C'],
];

function mutantsFor(t) {
  const src = readFileSync(join(ROOT, t.file), 'utf8');
  const lines = src.split('\n');
  const start = t.from ? lines.findIndex((l) => l.includes(t.from)) : 0;
  const end = t.to ? lines.findIndex((l, i) => i > start && l.includes(t.to)) : lines.length;
  if (start < 0 || end < 0) throw new Error(`markers gone in ${t.file}`);
  const out = [];
  for (let i = start; i < end; i++) {
    const full = lines[i];
    const trimmed = full.trim();
    if (!trimmed || /^(\/\/|\*|\/\*|import\b)/.test(trimmed)) continue;
    const cut = full.search(/\s\/\/\s/);          // leave end-of-line comments alone
    const code = cut >= 0 ? full.slice(0, cut) : full;
    const tail = full.slice(code.length);
    const push = (op, next) => {
      if (next === full) return;
      out.push({ target: t.name, file: t.file, line: i + 1, op, before: trimmed, after: next.trim(), src: [...lines.slice(0, i), next, ...lines.slice(i + 1)].join('\n') });
    };
    for (const [op, re, rep] of OPS) {
      for (const m of code.matchAll(re)) {
        const r = typeof rep === 'function' ? rep(m[0]) : rep;
        push(op, code.slice(0, m.index) + r + code.slice(m.index + m[0].length) + tail);
      }
    }
    if (GUARD.test(code)) push('guard removed', '');
  }
  for (const [name, find, rep, label] of HAND) {
    if (name !== t.name) continue;
    if (!src.includes(find)) throw new Error(`hand mutant "${label}": text gone from ${t.file}`);
    const idx = src.indexOf(find);
    out.push({ target: t.name, file: t.file, line: src.slice(0, idx).split('\n').length, op: 'hand: ' + label, before: find.trim(), after: rep.trim(), src: src.replace(find, rep) });
  }
  return out;
}

function run(cmd, args, cwd, ms) {
  return new Promise((done) => {
    const p = spawn(cmd, args, { cwd, stdio: 'ignore', detached: true, env: { ...process.env, CI: '' } });
    const timer = setTimeout(() => { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } done('timeout'); }, ms);
    p.on('exit', (code) => { clearTimeout(timer); try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } done(code === 0 ? 'pass' : 'fail'); });
  });
}

function syntaxOk(path) { return run(process.execPath, ['--check', path], dirname(path), 15_000).then((r) => r === 'pass'); }

function makeCopy(base, n) {
  const w = join(base, `w${n}`);
  mkdirSync(join(w, 'worker'), { recursive: true });
  const skip = new Set(['node_modules', '.dev.vars', '.dev.vars.production', '.wrangler', '.wrangler-test-state', 'tests', 'blake3-wasm-src']);
  for (const e of readdirSync(join(ROOT, 'worker'))) {
    if (!skip.has(e)) cpSync(join(ROOT, 'worker', e), join(w, 'worker', e), { recursive: true });
  }
  symlinkSync(join(ROOT, 'worker', 'node_modules'), join(w, 'worker', 'node_modules'));
  // What worker/test and wrangler.toml read from outside worker/.
  for (const d of ['frontend', 'test-vectors', 'docs', 'navy-office', join('bin', 'lib'), join('src', '_includes')]) {
    cpSync(join(ROOT, d), join(w, d), { recursive: true });
  }
  return w;
}

const targets = TARGETS.filter((t) => !ONLY || t.name === ONLY);
const RETEST = arg('retest', '');
const earlier = RETEST ? new Set(JSON.parse(readFileSync(RETEST, 'utf8')).filter((r) => r.status === 'SURVIVED').map((r) => `${r.file}|${r.op}|${r.before}|${r.after}`)) : null;
const all = targets.flatMap(mutantsFor).filter((m) => !earlier || earlier.has(`${m.file}|${m.op}|${m.before}|${m.after}`));
console.log(`${all.length} mutants: ` + targets.map((t) => `${t.name} ${all.filter((m) => m.target === t.name).length}`).join(', '));
if (LIST) process.exit(0);

mkdirSync(OUT, { recursive: true });
const base = mkdtempSync(join(tmpdir(), 'share-mutants-'));
const vitest = join(ROOT, 'worker', 'node_modules', '.bin', 'vitest');
const started = Date.now();
// On a busy Mac the 32 MiB BLAKE3 tests can pass their 5 s limit. That must not count as a kill:
// a slow test would hide a survivor. A mutant that really hangs is still stopped by run()'s timer.
const CALM = ['--maxWorkers=2', '--testTimeout=60000'];
const copies = Array.from({ length: JOBS }, (_, n) => makeCopy(base, n));

// A clean copy must pass, or every "killed" below would mean nothing.
const clean = await run(vitest, ['run', ...CALM], join(copies[0], 'worker'), 300_000);
if (clean !== 'pass') { console.error(`the unmutated copy did not pass (${clean}): stopping`); rmSync(base, { recursive: true, force: true }); process.exit(1); }
console.log('unmutated copy: every test passes');

const fast = Object.fromEntries(targets.map((t) => [t.name, t.tests.map((f) => `test/${f}.test.js`)]));
const results = [];
let next = 0;
async function worker(copy) {
  while (next < all.length) {
    const m = all[next++];
    const path = join(copy, m.file);
    const original = join(ROOT, m.file);
    writeFileSync(path, m.src);
    const probe = join(copy, 'probe.mjs');
    writeFileSync(probe, m.src);
    let status;
    if (!(await syntaxOk(probe))) {
      status = 'invalid';
    } else {
      const first = await run(vitest, ['run', ...CALM, ...fast[m.target]], join(copy, 'worker'), 120_000);
      if (first !== 'pass') status = first === 'timeout' ? 'killed (hung)' : 'killed';
      else {
        const second = await run(vitest, ['run', ...CALM], join(copy, 'worker'), 240_000);
        status = second === 'pass' ? 'SURVIVED' : second === 'timeout' ? 'killed (hung, full suite)' : 'killed (full suite)';
      }
    }
    copyFileSync(original, path);
    const { src, ...row } = m;
    results.push({ ...row, status });
    process.stdout.write(`${results.length}/${all.length} ${status} ${m.target}:${m.line} ${m.op}\n`);
    writeFileSync(join(OUT, 'mutants.json'), JSON.stringify(results, null, 1));
  }
}
await Promise.all(copies.map(worker));
rmSync(base, { recursive: true, force: true });

const count = (s) => results.filter((r) => r.status.startsWith(s)).length;
const summary = { commit_note: 'see git log', total: results.length, killed: count('killed'), survived: count('SURVIVED'), invalid: count('invalid'), minutes: +((Date.now() - started) / 60000).toFixed(1) };
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(summary);
for (const r of results.filter((x) => x.status === 'SURVIVED').sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  console.log(`SURVIVED ${r.file}:${r.line} [${r.op}]\n   - ${r.before}\n   + ${r.after}`);
}
