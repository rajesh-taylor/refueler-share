// worker/scripts/soak-download.mjs  (Share-Download-Opus; --decrypt Share-Soak-4)
//
// Full-file download of a transfer through the VERIFIED Worker path
// (GET /download/{uuid}/{NNNN}, no Range header). Proves every part is
// served, the Worker's per-part verify-then-flush holds at scale, and the
// bytes on disk are right.
//
// Modes:
//   raw (default)  --uuid=<uuid>: ciphertext parts written as-is (random soak parts
//                  have nothing to decrypt). Optional --sidecar / --merkle-root.
//   --decrypt      the share link is read from STDIN (never argv: shell history, ps).
//                  Link format v2 only. Before any part request: ceil(z / CHUNK_SIZE)
//                  must equal /meta total_chunks. Each part: exact ciphertext length
//                  → BLAKE3 → decryptPart (the browser's frontend/crypto.js: derived
//                  part key, counter nonce + last flag) → plaintext length → compare
//                  with the regenerated soak plaintext (refueler-soak-<seed>.bin names)
//                  → write → fsync → record. End: SHA-256 of the whole file.
//
// Resumable: each part is written at its offset, fsync'd, THEN recorded in
// <out>/<uuid>.progress (one JSON line per part; no key, no link). Re-running
// the same command (and re-supplying the link) skips recorded parts.
//
// Refuses to start if destroy-after-download is armed, if the transfer needs a
// passphrase, or if the target drive lacks space for the remaining bytes.
//
//   cd /Users/rajeshtaylor/Documents/refueler-share/worker && \
//     caffeinate -i node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//       scripts/soak-download.mjs --decrypt --out="/Volumes/<SSD>/refueler-soak" \
//       [--concurrency=4] < ~/.refueler-soak/<uuid>.link
//
//   raw: ... scripts/soak-download.mjs --uuid=<uuid> --out=DIR [--sidecar=hashes.bin] [--merkle-root=<b64url>]

import { existsSync, mkdirSync, statfsSync, readFileSync } from 'node:fs';
import { open, appendFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  CHUNK_SIZE, TAG_BYTES, derivePartKey, decryptPart, parseFragment, selfTest,
  hashChunk, buildMerkleRoot, hex, b64url, SOAK_NAME_RE, soakPlain, soakPlainSha256,
} from './lib/soak-common.mjs';

// ─── CLI args ─────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const i = a.indexOf('=');
    return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
  })
);
const workerUrl   = (args.url || 'https://api.share.refueler.io').replace(/\/$/, '');
const decryptMode = args.decrypt === true;
const outDir      = args.out;
const concurrency = parseInt(args.concurrency ?? '4', 10);
const timeoutMs   = 1000 * parseInt(args['timeout-s'] ?? '300', 10);
const sidecarPath = args.sidecar || null;
const expectRoot  = args['merkle-root'] || null;
let   uuid        = args.uuid;

const BACKOFFS = [2000, 5000, 15000, 30000, 60000]; // Share-5 budget: 6 attempts
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
const GiB = 1024 ** 3, MiB = 1024 ** 2;
const fmtGiB = b => `${(b / GiB).toFixed(2)} GiB`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Link (decrypt mode): stdin only ──────────────────────────────────────
let link = null;   // { keyBytes, filename, z }
if (decryptMode) {
  if (uuid) { console.error('✗ --decrypt takes the link on stdin; do not pass --uuid'); process.exit(1); }
  if (process.stdin.isTTY) { console.error('✗ --decrypt reads the share link from stdin: ... < ~/.refueler-soak/<uuid>.link'); process.exit(1); }
  let raw = '';
  for await (const c of process.stdin) raw += c;
  let u;
  try { u = new URL(raw.trim()); } catch { console.error('✗ stdin is not a URL'); process.exit(1); }
  uuid = u.searchParams.get('uuid');
  let f;
  try { f = parseFragment(u.hash.replace(/^#/, '')); } catch (e) { console.error(`✗ link fragment: ${e.message}`); process.exit(1); }
  if (f.v !== 2) { console.error('✗ --decrypt supports link format v2 only'); process.exit(1); }
  link = { keyBytes: f.keyBytes, filename: f.filename, z: f.sizeBytes };
}

if (!uuid || !/^[0-9a-f-]{36}$/i.test(uuid) || !outDir) {
  console.error('✗ --out=<directory> is required, plus --uuid=<uuid> (raw) or the link on stdin (--decrypt)');
  process.exit(1);
}

const outFile  = join(outDir, decryptMode ? `${uuid}.plain` : `${uuid}.bin`);
const progFile = join(outDir, decryptMode ? `${uuid}.plain.progress` : `${uuid}.progress`);

// ─── Counters ─────────────────────────────────────────────────────────────
const stats = {
  done: 0, skipped: 0, bytes: 0, retries: 0, http409: 0, http429: 0, http5xx: 0,
  streamAborts: 0, shortBodies: 0, timeouts: 0, localMismatch: 0, plainMismatch: 0,
  integrity: {},            // X-Integrity header value → count
  slowest: { i: -1, ms: 0 },
};
const failed = new Set();
let fatal = null;

// ─── One part: GET → length → BLAKE3 (→ sidecar) (→ decrypt → compare) → write → fsync → record
async function fetchChunk(i, ctx) {
  const { n, okLen, fh, sidecar, hashes, partKey, seed } = ctx;
  const url = `${workerUrl}/download/${uuid}/${String(i).padStart(4, '0')}`;
  let lastErr = '';
  for (let attempt = 0; attempt <= BACKOFFS.length; attempt++) {
    if (fatal) return false;
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let waitMs = BACKOFFS[attempt] ?? 0;
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { 'Cache-Control': 'no-store' } });
      if (res.status === 404 || res.status === 410 || res.status === 401 || res.status === 425) {
        fatal = `chunk ${i} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
        return false;
      }
      if (res.status === 429) {
        stats.http429++;
        waitMs = 1000 * parseInt(res.headers.get('Retry-After') ?? '30', 10);
        throw new Error(`HTTP 429 (rate limited)`);
      }
      if (res.status === 409) {
        stats.http409++;
        throw new Error(`HTTP 409 ${(await res.text()).slice(0, 200)}`);
      }
      if (res.status >= 500) { stats.http5xx++; throw new Error(`HTTP ${res.status}`); }
      if (res.status !== 200) throw new Error(`HTTP ${res.status} (unexpected)`);

      const integ = res.headers.get('X-Integrity') ?? '(none)';
      let body;
      try { body = new Uint8Array(await res.arrayBuffer()); }
      catch (e) {
        // The Worker aborts the stream on a chunk-hash mismatch (>128-chunk
        // transfers): it surfaces here as a body read error, not a 409.
        if (e.name === 'AbortError') throw e;
        stats.streamAborts++;
        throw new Error(`stream aborted mid-body (${e.cause?.code || e.message})`);
      }
      if (!okLen(i, body.length)) {
        stats.shortBodies++;
        throw new Error(`body ${body.length} B — wrong length for part ${i}`);
      }
      const h = hashChunk(body);
      if (sidecar) {
        const want = sidecar.subarray(i * 32, i * 32 + 32);
        if (Buffer.compare(Buffer.from(h), Buffer.from(want)) !== 0) {
          stats.localMismatch++;
          throw new Error(`local BLAKE3 ≠ sidecar[${i}] (got ${hex(h).slice(0, 16)}…)`);
        }
      }

      // Decrypt failure is an integrity failure, never retried as a network error.
      let out = body;
      if (partKey) {
        try { out = new Uint8Array(await decryptPart(partKey, body, i, n)); }
        catch { fatal = `part ${i}: decryption failed — wrong key, wrong index/last flag, or corrupted part`; return false; }
        if (out.length !== body.length - TAG_BYTES) { fatal = `part ${i}: plaintext ${out.length} B`; return false; }
        if (seed) {
          const want = soakPlain(seed, i, out.length);
          if (Buffer.compare(Buffer.from(out), Buffer.from(want)) !== 0) {
            stats.plainMismatch++;
            fatal = `part ${i}: decrypted plaintext ≠ regenerated soak plaintext`;
            return false;
          }
        }
      }

      await fh.write(out, 0, out.length, i * (partKey ? CHUNK_SIZE : CHUNK_SIZE + TAG_BYTES));
      await fh.datasync();
      const ms = Date.now() - t0;
      await appendFile(progFile, JSON.stringify({ i, len: body.length, b3: hex(h), ms, attempts: attempt + 1, integrity: integ }) + '\n');
      hashes[i] = h;
      stats.integrity[integ] = (stats.integrity[integ] ?? 0) + 1;
      stats.done++; stats.bytes += body.length;
      if (ms > stats.slowest.ms) stats.slowest = { i, ms };
      return true;
    } catch (e) {
      lastErr = e.name === 'AbortError' ? (stats.timeouts++, `timed out after ${timeoutMs / 1000}s`) : e.message;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < BACKOFFS.length) {
      stats.retries++;
      log(`⚠ chunk ${i} attempt ${attempt + 1} → ${lastErr} — retrying in ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
    }
  }
  log(`✗ chunk ${i} exhausted ${BACKOFFS.length + 1} attempts: ${lastErr}`);
  failed.add(i);
  return false;
}

// ─── Main ─────────────────────────────────────────────────────────────────
const tStart = Date.now();
try {
  let partKey = null, seed = null;
  if (decryptMode) {
    await selfTest();
    log('Self-test ✓ (browser crypto.js / fragment.js match part-crypto KATs)');
    partKey = await derivePartKey(link.keyBytes, ['decrypt']);
    const m = SOAK_NAME_RE.exec(link.filename);
    if (m) seed = Uint8Array.from(Buffer.from(m[1], 'hex'));
    log(`link v2: uuid ${uuid}, z ${link.z} B, name ${seed ? 'soak (plaintext compare on)' : '(not a soak name — no plaintext compare)'}`);
  }

  // 1. Preflight — /meta (public, read-only)
  const metaRes = await fetch(`${workerUrl}/meta/${uuid}`);
  if (metaRes.status !== 200) throw new Error(`/meta → HTTP ${metaRes.status}: ${await metaRes.text()}`);
  const meta = await metaRes.json();
  log(`meta: ${JSON.stringify(meta)}`);
  if (meta.pending_destruction === false || meta.pending_destruction === true)
    throw new Error('destroy-after-download is ARMED on this transfer — refusing (the last chunk would delete it)');
  if (meta.passphrase_protected) throw new Error('passphrase-protected transfer — this script sends no download token');
  const n = meta.total_chunks;
  if (!Number.isInteger(n) || n < 1) throw new Error('meta has no total_chunks');

  // Part geometry. Decrypt: exact from z, checked against total_chunks before any part request.
  // Raw: full parts CHUNK_SIZE + 16; the tail anything from 17 B up (size not in /meta).
  let okLen, ctLenOf, plainTotal;
  if (decryptMode) {
    if (Math.ceil(link.z / CHUNK_SIZE) !== n) throw new Error(`part count: link z gives ${Math.ceil(link.z / CHUNK_SIZE)}, /meta says ${n} — refusing`);
    ctLenOf = i => (i === n - 1 ? link.z - i * CHUNK_SIZE : CHUNK_SIZE) + TAG_BYTES;
    okLen = (i, len) => len === ctLenOf(i);
    plainTotal = link.z;
  } else {
    ctLenOf = () => CHUNK_SIZE + TAG_BYTES;
    okLen = (i, len) => (i < n - 1 ? len === CHUNK_SIZE + TAG_BYTES : len > TAG_BYTES && len <= CHUNK_SIZE + TAG_BYTES);
    plainTotal = n * (CHUNK_SIZE + TAG_BYTES);
  }

  // 2. Optional sidecar (read-only copy of {uuid}/hashes fetched beforehand)
  let sidecar = null;
  if (sidecarPath) {
    sidecar = new Uint8Array(readFileSync(sidecarPath));
    if (sidecar.length !== n * 32) throw new Error(`sidecar is ${sidecar.length} B, expected ${n * 32}`);
    const sideRoot = b64url(buildMerkleRoot(Array.from({ length: n }, (_, i) => sidecar.subarray(i * 32, i * 32 + 32))));
    log(`sidecar loaded: ${n} hashes, root ${sideRoot}` + (expectRoot ? (sideRoot === expectRoot ? ' = manifest merkle_root ✓' : ` ≠ manifest ${expectRoot} ✗`) : ''));
    if (expectRoot && sideRoot !== expectRoot) throw new Error('sidecar root does not match --merkle-root');
  }

  // 3. Resume state
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const hashes = new Array(n);
  if (existsSync(progFile)) {
    for (const line of (await readFile(progFile, 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); if (okLen(r.i, r.len)) hashes[r.i] = Uint8Array.from(Buffer.from(r.b3, 'hex')); } catch { /* torn last line — part refetched */ }
    }
  }
  const todo = [];
  for (let i = 0; i < n; i++) if (!hashes[i]) todo.push(i);
  stats.skipped = n - todo.length;
  const remainingBytes = todo.reduce((s, i) => s + ctLenOf(i), 0);

  // 4. Free space (APFS: output file is sparse, so count only what is still to come)
  const fs = statfsSync(outDir);
  const freeBytes = fs.bavail * fs.bsize;
  log(`target ${outFile} — free ${fmtGiB(freeBytes)}, still to write ${fmtGiB(remainingBytes)}` +
      (stats.skipped ? ` (resuming: ${stats.skipped} parts already on disk)` : ''));
  if (freeBytes < remainingBytes + GiB) throw new Error('not enough free space on the target drive (need remaining + 1 GiB)');

  const fh = await open(outFile, existsSync(outFile) ? 'r+' : 'w+');
  log(`▶ downloading ${todo.length}/${n} parts (${fmtGiB(remainingBytes)}) — concurrency ${concurrency}, per-part timeout ${timeoutMs / 1000}s, ${decryptMode ? 'DECRYPT' : 'raw'}, local verify ${sidecar ? 'vs sidecar' : 'hash-only'}`);

  // 5. Pool + heartbeat
  let next = 0, lastBytes = 0, lastT = Date.now();
  const heartbeat = setInterval(() => {
    const now = Date.now(), el = (now - tStart) / 1000;
    const recent = (stats.bytes - lastBytes) / MiB / ((now - lastT) / 1000);
    const overall = stats.bytes / MiB / el;
    const eta = overall > 0 ? Math.round((remainingBytes - stats.bytes) / MiB / overall / 60) : '?';
    log(`… ${stats.skipped + stats.done}/${n} parts — ${fmtGiB(stats.bytes)} this run — ${recent.toFixed(1)} MiB/s (last 60s), ${overall.toFixed(1)} MiB/s avg — ETA ${eta} min — retries ${stats.retries}, 409s ${stats.http409}, aborts ${stats.streamAborts}, failed ${failed.size}`);
    lastBytes = stats.bytes; lastT = now;
  }, 60000);

  const ctx = { n, okLen, fh, sidecar, hashes, partKey, seed };
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!fatal) {
      const k = next++;
      if (k >= todo.length) break;
      await fetchChunk(todo[k], ctx);
    }
  }));
  clearInterval(heartbeat);

  // 6. Whole-file checks
  const have = hashes.filter(Boolean).length;
  const complete = !fatal && have === n && failed.size === 0;
  let rootLine = 'not computed (parts missing)';
  if (have === n) {
    const root = b64url(buildMerkleRoot(hashes));
    rootLine = root + (expectRoot ? (root === expectRoot ? '  = manifest merkle_root ✓' : `  ≠ manifest ${expectRoot} ✗`) : '');
  }
  let shaLine = null, shaOk = true;
  if (decryptMode && complete) {
    await fh.truncate(plainTotal);
    log(`hashing ${fmtGiB(plainTotal)} on disk (SHA-256, in order)…`);
    const got = createHash('sha256');
    const buf = Buffer.alloc(CHUNK_SIZE);
    for (let off = 0; off < plainTotal; off += CHUNK_SIZE) {
      const len = Math.min(CHUNK_SIZE, plainTotal - off);
      const { bytesRead } = await fh.read(buf, 0, len, off);
      if (bytesRead !== len) throw new Error(`short read at ${off}`);
      got.update(buf.subarray(0, len));
    }
    const gotHex = got.digest('hex');
    if (seed) {
      const want = soakPlainSha256(seed, link.z);
      shaOk = gotHex === want;
      shaLine = `${gotHex}  ${shaOk ? '= regenerated soak plaintext ✓' : `≠ expected ${want} ✗`}`;
    } else shaLine = `${gotHex}  (no soak seed — compare by hand)`;
  }
  await fh.close();

  const el = (Date.now() - tStart) / 1000;
  log('─── Final tally ───');
  if (fatal) log(`FATAL               : ${fatal}`);
  log(`Parts on disk       : ${have} / ${n} (this run ${stats.done}, resumed ${stats.skipped})`);
  log(`Failed after retries: ${failed.size}` + (failed.size ? ` (${[...failed].sort((a, b) => a - b).join(', ')})` : ''));
  log(`Bytes this run      : ${fmtGiB(stats.bytes)} in ${(el / 60).toFixed(1)} min — ${(stats.bytes / MiB / el).toFixed(1)} MiB/s avg`);
  log(`Retries             : ${stats.retries} (409 ${stats.http409} · 429 ${stats.http429} · 5xx ${stats.http5xx} · stream aborts ${stats.streamAborts} · wrong lengths ${stats.shortBodies} · timeouts ${stats.timeouts} · local≠sidecar ${stats.localMismatch} · plaintext≠soak ${stats.plainMismatch})`);
  log(`X-Integrity         : ${JSON.stringify(stats.integrity)}`);
  log(`Slowest part        : ${stats.slowest.i} (${(stats.slowest.ms / 1000).toFixed(1)}s)`);
  log(`Local Merkle root   : ${rootLine}`);
  if (shaLine) log(`Plaintext SHA-256   : ${shaLine}`);
  const ok = complete && shaOk && (!expectRoot || rootLine.includes('✓'));
  log(ok ? `✓ ${decryptMode ? 'DECRYPT' : 'DOWNLOAD'} COMPLETE — ${outFile}` : '✗ INCOMPLETE — re-run the same command to resume');
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  log(`✗ ${e.message}`);
  process.exitCode = 1;
}
