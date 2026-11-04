// The vectors in REAL Safari (H2 Browser-KAT-1). Playwright's WebKit is not Safari, so this drives
// Safari itself through safaridriver: plain WebDriver over fetch, no new package. Runs weekly on a
// GitHub macOS runner (browser.yml). On a Mac: once, `sudo safaridriver --enable`, then
//   dev/share-harness/build.sh && node dev/share-harness/real-safari.mjs
// Vectors only. Real-Safari flows stay the Safari + Mullvad check in CLAUDE.md.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = 'http://localhost:4723';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kids = [];
const die = (msg) => { console.error('✗ ' + msg); for (const k of kids) k.kill(); process.exit(1); };

async function wd(method, path, body) {
  const r = await fetch(DRIVER + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${JSON.stringify(j.value)}`);
  return j.value;
}

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not up yet */ }
    if (Date.now() > end) die(`timed out: ${what}`);
    await sleep(300);
  }
}

kids.push(spawn(process.execPath, [join(HERE, 'serve-app.mjs')], { stdio: 'ignore' }));
kids.push(spawn('safaridriver', ['-p', '4723'], { stdio: 'inherit' }));
await until(async () => (await fetch('http://localhost:8765/kat/')).ok, 15_000, 'app server');
await until(async () => (await fetch(DRIVER + '/status')).ok, 15_000, 'safaridriver');

let session;
try {
  session = (await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })).sessionId;
  await wd('POST', `/session/${session}/url`, { url: 'http://localhost:8765/kat/' });
  const kat = await until(() => wd('POST', `/session/${session}/execute/sync`, { script: 'return window.__kat || null', args: [] }), 120_000, 'vectors');
  const ua = await wd('POST', `/session/${session}/execute/sync`, { script: 'return navigator.userAgent', args: [] });
  const failed = (kat.results || []).filter((r) => !r.ok);
  console.log(ua);
  console.log(`real Safari: ${kat.results?.length ?? 0} checks, ${failed.length} failed, BLAKE3 ${kat.blake3}, release ${kat.rel}`);
  if (kat.fatal) die(`the page could not run the vectors: ${kat.fatal}`);
  for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
  if (failed.length || !(kat.results?.length > 80)) die('vectors failed');
  if (kat.blake3 !== 'wasm') die(`BLAKE3 fell back to ${kat.blake3}`);
} catch (e) {
  die(e.message);
} finally {
  if (session) await wd('DELETE', `/session/${session}`).catch(() => {});
}
for (const k of kids) k.kill();
console.log('✓ real Safari green');
process.exit(0);
