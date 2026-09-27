// worker/scripts/soak-download.mjs  (Share-Download-Opus, Part 1)
//
// Raw full-file download of a soak transfer through the VERIFIED Worker path
// (GET /download/{uuid}/{NNNN}, no Range header). Server half only: soak
// chunks from test-upload.html / soak-headless.mjs are random bytes, never
// encrypted, so there is nothing to decrypt. Proves: every chunk is served,
// the Worker's per-chunk verify-then-flush holds at 3,200 chunks, and the
// bytes on disk hash to what the uploader committed (optional --sidecar).
//
// Resumable: each chunk is written at its offset, fsync'd, THEN recorded in
// <out>/<uuid>.progress (one JSON line per chunk). Re-running the same
// command skips chunks already recorded. This is the resume model the
// download spec proposes (verify → flush → record index), in miniature.
//
// Refuses to start if destroy-after-download is armed (pending_destruction
// === false), if the transfer needs a passphrase, or if the target drive
// lacks space for the remaining bytes.
//
//   cd /Users/rajeshtaylor/Documents/refueler-share/worker && \
//     caffeinate -i nohup node scripts/soak-download.mjs \
//       --uuid=<uuid> --out="/Volumes/Portable 001/refueler-soak" \
//       [--sidecar=/path/hashes.bin] [--merkle-root=<b64url>] [--concurrency=4] \
//     > "/Volumes/Portable 001/refueler-soak/download-$(date +%s).log" 2>&1 & disown
//
// No new npm dependencies: vendored WASM BLAKE3 (worker/blake3-wasm, same
// binary the Worker verifies with) for chunk hashing; @noble/hashes for the
// Merkle tree nodes (as merkle.js).

import { blake3 } from '@noble/hashes/blake3';
import { readFileSync, existsSync, mkdirSync, statfsSync } from 'node:fs';
import { open, appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ─── WASM BLAKE3 (Node instantiation of the Worker's vendored bundle) ──────
const WASM_DIR = new URL('../blake3-wasm/', import.meta.url);
const bg = await import(new URL('blake3_wasm_bg.js', WASM_DIR).href);
bg.__wbg_set_wasm(new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(new URL('blake3_wasm_bg.wasm', WASM_DIR))),
  { './blake3_wasm_bg.js': { __wbindgen_init_externref_table: bg.__wbindgen_init_externref_table } },
).exports);
const hashChunk = (u8) => bg.hash(u8);

// ─── CLI args ─────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const i = a.indexOf('=');
    return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
  })
);
const workerUrl   = (args.url || 'https://api.share.refueler.io').replace(/\/$/, '');
const uuid        = args.uuid;
const outDir      = args.out;
const concurrency = parseInt(args.concurrency ?? '4', 10);
const timeoutMs   = 1000 * parseInt(args['timeout-s'] ?? '300', 10);
const chunkMib    = parseInt(args['chunk-mib'] ?? '32', 10);
const sidecarPath = args.sidecar || null;
const expectRoot  = args['merkle-root'] || null;

if (!uuid || !/^[0-9a-f-]{36}$/i.test(uuid) || !outDir) {
  console.error('✗ --uuid=<transfer uuid> and --out=<directory> are required');
  process.exit(1);
}

const CHUNK_SIZE = chunkMib * 1024 * 1024;
const BACKOFFS   = [2000, 5000, 15000, 30000, 60000]; // Share-5 budget: 6 attempts
const outFile    = join(outDir, `${uuid}.bin`);
const progFile   = join(outDir, `${uuid}.progress`);

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
const GiB = 1024 ** 3, MiB = 1024 ** 2;
const fmtGiB = b => `${(b / GiB).toFixed(2)} GiB`;
const hex = u8 => Buffer.from(u8).toString('hex');
const b64url = u8 => Buffer.from(u8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Merkle (rfc6962-unbalanced-blake3-v1) — identical to soak-headless.mjs
function buildMerkleRoot(leaves) {
  let nodes = leaves.map(d => { const b = new Uint8Array(33); b[0] = 0x00; b.set(d, 1); return blake3(b); });
  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) {
      if (i + 1 < nodes.length) {
        const b = new Uint8Array(65); b[0] = 0x01; b.set(nodes[i], 1); b.set(nodes[i + 1], 33);
        next.push(blake3(b));
      } else next.push(nodes[i]);
    }
    nodes = next;
  }
  return nodes[0];
}

// ─── Counters ─────────────────────────────────────────────────────────────
const stats = {
  done: 0, skipped: 0, bytes: 0, retries: 0, http409: 0, http429: 0, http5xx: 0,
  streamAborts: 0, shortBodies: 0, timeouts: 0, localMismatch: 0,
  integrity: {},            // X-Integrity header value → count
  slowest: { i: -1, ms: 0 },
};
const failed = new Set();
let fatal = null;

// ─── One chunk: GET → length check → hash → (sidecar compare) → write → fsync → record
async function fetchChunk(i, expectLen, fh, sidecar, hashes) {
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
      if (body.length !== expectLen) {
        stats.shortBodies++;
        throw new Error(`body ${body.length} B, expected ${expectLen} B`);
      }
      const h = hashChunk(body);
      if (sidecar) {
        const want = sidecar.subarray(i * 32, i * 32 + 32);
        if (Buffer.compare(Buffer.from(h), Buffer.from(want)) !== 0) {
          stats.localMismatch++;
          throw new Error(`local BLAKE3 ≠ sidecar[${i}] (got ${hex(h).slice(0, 16)}…)`);
        }
      }
      await fh.write(body, 0, body.length, i * CHUNK_SIZE);
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
  // 1. Preflight — /meta (public, read-only)
  const metaRes = await fetch(`${workerUrl}/meta/${uuid}`);
  if (metaRes.status !== 200) throw new Error(`/meta → HTTP ${metaRes.status}: ${await metaRes.text()}`);
  const meta = await metaRes.json();
  log(`meta: ${JSON.stringify(meta)}`);
  if (meta.pending_destruction === false || meta.pending_destruction === true)
    throw new Error('destroy-after-download is ARMED on this transfer — refusing (the last chunk would delete it)');
  if (meta.passphrase_protected) throw new Error('passphrase-protected transfer — this script sends no download token');
  const totalChunks = meta.total_chunks, totalBytes = meta.total_bytes;
  if (!Number.isInteger(totalChunks) || !Number.isInteger(totalBytes) || totalChunks < 1)
    throw new Error('meta has no total_chunks / total_bytes');
  if (Math.ceil(totalBytes / CHUNK_SIZE) !== totalChunks)
    throw new Error(`chunk geometry mismatch: ${totalBytes} B / ${chunkMib} MiB ≠ ${totalChunks} chunks`);
  const lenOf = i => (i === totalChunks - 1 ? totalBytes - i * CHUNK_SIZE : CHUNK_SIZE);

  // 2. Optional sidecar (read-only copy of {uuid}/hashes fetched beforehand)
  let sidecar = null;
  if (sidecarPath) {
    sidecar = new Uint8Array(readFileSync(sidecarPath));
    if (sidecar.length !== totalChunks * 32) throw new Error(`sidecar is ${sidecar.length} B, expected ${totalChunks * 32}`);
    const sideRoot = b64url(buildMerkleRoot(Array.from({ length: totalChunks }, (_, i) => sidecar.subarray(i * 32, i * 32 + 32))));
    log(`sidecar loaded: ${totalChunks} hashes, root ${sideRoot}` + (expectRoot ? (sideRoot === expectRoot ? ' = manifest merkle_root ✓' : ` ≠ manifest ${expectRoot} ✗`) : ''));
    if (expectRoot && sideRoot !== expectRoot) throw new Error('sidecar root does not match --merkle-root');
  }

  // 3. Resume state
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const hashes = new Array(totalChunks);
  if (existsSync(progFile)) {
    for (const line of (await readFile(progFile, 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); if (r.len === lenOf(r.i)) hashes[r.i] = Uint8Array.from(Buffer.from(r.b3, 'hex')); } catch { /* torn last line — chunk refetched */ }
    }
  }
  const todo = [];
  for (let i = 0; i < totalChunks; i++) if (!hashes[i]) todo.push(i);
  stats.skipped = totalChunks - todo.length;
  const remainingBytes = todo.reduce((s, i) => s + lenOf(i), 0);

  // 4. Free space (APFS: output file is sparse, so count only what is still to come)
  const fs = statfsSync(outDir);
  const freeBytes = fs.bavail * fs.bsize;
  log(`target ${outFile} — free ${fmtGiB(freeBytes)}, still to write ${fmtGiB(remainingBytes)}` +
      (stats.skipped ? ` (resuming: ${stats.skipped} chunks already on disk)` : ''));
  if (freeBytes < remainingBytes + GiB) throw new Error('not enough free space on the target drive (need remaining + 1 GiB)');

  const fh = await open(outFile, existsSync(outFile) ? 'r+' : 'w+');
  log(`▶ downloading ${todo.length}/${totalChunks} chunks (${fmtGiB(remainingBytes)}) — concurrency ${concurrency}, per-chunk timeout ${timeoutMs / 1000}s, local verify ${sidecar ? 'vs sidecar' : 'hash-only'}`);

  // 5. Pool + heartbeat
  let next = 0, lastBytes = 0, lastT = Date.now();
  const heartbeat = setInterval(() => {
    const now = Date.now(), el = (now - tStart) / 1000;
    const recent = (stats.bytes - lastBytes) / MiB / ((now - lastT) / 1000);
    const overall = stats.bytes / MiB / el;
    const eta = overall > 0 ? Math.round((remainingBytes - stats.bytes) / MiB / overall / 60) : '?';
    log(`… ${stats.skipped + stats.done}/${totalChunks} chunks — ${fmtGiB(stats.bytes)} this run — ${recent.toFixed(1)} MiB/s (last 60s), ${overall.toFixed(1)} MiB/s avg — ETA ${eta} min — retries ${stats.retries}, 409s ${stats.http409}, aborts ${stats.streamAborts}, failed ${failed.size}`);
    lastBytes = stats.bytes; lastT = now;
  }, 60000);

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!fatal) {
      const k = next++;
      if (k >= todo.length) break;
      await fetchChunk(todo[k], lenOf(todo[k]), fh, sidecar, hashes);
    }
  }));
  clearInterval(heartbeat);
  await fh.close();

  // 6. Whole-file checks
  const have = hashes.filter(Boolean).length;
  let rootLine = 'not computed (chunks missing)';
  if (have === totalChunks) {
    const root = b64url(buildMerkleRoot(hashes));
    rootLine = root + (expectRoot ? (root === expectRoot ? '  = manifest merkle_root ✓' : `  ≠ manifest ${expectRoot} ✗`) : '');
  }
  const el = (Date.now() - tStart) / 1000;
  log('─── Final tally ───');
  if (fatal) log(`FATAL               : ${fatal}`);
  log(`Chunks on disk      : ${have} / ${totalChunks} (this run ${stats.done}, resumed ${stats.skipped})`);
  log(`Failed after retries: ${failed.size}` + (failed.size ? ` (${[...failed].sort((a, b) => a - b).join(', ')})` : ''));
  log(`Bytes this run      : ${fmtGiB(stats.bytes)} in ${(el / 60).toFixed(1)} min — ${(stats.bytes / MiB / el).toFixed(1)} MiB/s avg`);
  log(`Retries             : ${stats.retries} (409 ${stats.http409} · 429 ${stats.http429} · 5xx ${stats.http5xx} · stream aborts ${stats.streamAborts} · short bodies ${stats.shortBodies} · timeouts ${stats.timeouts} · local≠sidecar ${stats.localMismatch})`);
  log(`X-Integrity         : ${JSON.stringify(stats.integrity)}`);
  log(`Slowest chunk       : ${stats.slowest.i} (${(stats.slowest.ms / 1000).toFixed(1)}s)`);
  log(`Local Merkle root   : ${rootLine}`);
  const ok = !fatal && have === totalChunks && failed.size === 0 && (!expectRoot || rootLine.includes('✓'));
  log(ok ? `✓ DOWNLOAD COMPLETE — ${outFile}` : '✗ DOWNLOAD INCOMPLETE — re-run the same command to resume');
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  log(`✗ ${e.message}`);
  process.exitCode = 1;
}
