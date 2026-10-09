// worker/scripts/soak-headless.mjs  (Share-Soak-1; encrypted mode Share-Soak-4)
//
// Headless, terminal-independent driver for the same soak pipeline as
// test-upload.html (admin test credential → initiate → parallel PUTs →
// finalise). Run with nohup so it survives the terminal closing:
//
//   cd /Users/rajeshtaylor/Documents/refueler-share/worker && \
//     caffeinate -i nohup node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//       scripts/soak-headless.mjs --gib=100 --encrypt \
//     > ~/.refueler-soak/upload-$(date +%s).log 2>&1 & disown
//
// Modes:
//   (default)  random ciphertext-sized parts — storage path only, nothing to decrypt.
//   --encrypt  a real transfer: deterministic plaintext, encrypted with the
//              browser's own link-v2 code (frontend/crypto.js derivePartKey +
//              encryptPart: derived part key, counter nonce + last flag). Writes a
//              real share link to <link-dir>/<uuid>.link (0600). The link (key)
//              is NEVER printed to the log. Check it with:
//                node scripts/soak-download.mjs --decrypt --out=DIR < <link file>
//
// Admin key: env SOAK_ADMIN_KEY (preferred; `read -rs SOAK_ADMIN_KEY && export SOAK_ADMIN_KEY`)
//            or --admin-key= (visible in ps and shell history).
// Flags: --gib (default 250) · --encrypt · --concurrency (8)
//        --expiry-days (6; test credentials obey the 7-day ceiling) · --cred-expiry (s, 28800)
//        --link-dir (~/.refueler-soak) · --put-timeout-s · --url
//
// Parts are fixed at 32 MiB (B12-1c: the Worker signs content-length =
// CHUNK_SIZE + 16; the tail URL comes from /initiate, never /urls).

import { blindMessage } from '@cashu/cashu-ts';
import { webcrypto as crypto } from 'node:crypto';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  CHUNK_SIZE, TAG_BYTES, derivePartKey, encryptPart, assembleFragment, selfTest,
  hashChunk, buildMerkleRoot, b64url, b64urlDecode, soakPlain, soakName, soakPlainSha256,
} from './lib/soak-common.mjs';

// ─── CLI args ─────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const i = a.indexOf('=');
    return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
  })
);

const workerUrl   = (args.url || 'https://api.share.refueler.io').replace(/\/$/, '');
// Env preferred (argv shows in ps). Strip whitespace and bracketed-paste markers
// (ESC[200~ / ESC[201~) that a paste into a hidden `read` prompt can carry.
const adminKey    = (process.env.SOAK_ADMIN_KEY || args['admin-key'] || '')
  .replace(/\x1b\[20[01]~/g, '').trim() || null;
const targetGib   = parseFloat(args.gib ?? '250');
const concurrency = parseInt(args.concurrency ?? '8', 10);
const credExpiry  = parseInt(args['cred-expiry'] ?? '28800', 10);
const expiryDays  = parseFloat(args['expiry-days'] ?? '6');
const encryptMode = args.encrypt === true;
const linkDir     = args['link-dir'] || join(homedir(), '.refueler-soak');
const shareBase   = 'https://refueler.io/share/';

if (!adminKey) {
  console.error('✗ admin key required: export SOAK_ADMIN_KEY (preferred) or --admin-key=');
  process.exit(1);
}

const chunkMib    = CHUNK_SIZE / (1024 * 1024);
const totalBytes  = Math.round(targetGib * 1024 * 1024 * 1024);   // plaintext = X-Total-Bytes = z
const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE);
const capBytes    = totalChunks * CHUNK_SIZE;
const URL_BATCH   = 256;
const plainLenOf  = i => (i === totalChunks - 1 ? totalBytes - i * CHUNK_SIZE : CHUNK_SIZE);

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KiB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(2)} MiB`;
  return `${(b / 1024 ** 3).toFixed(3)} GiB`;
}
function randomChunk(size) {
  const buf = new Uint8Array(size);
  for (let o = 0; o < buf.length; o += 65536)
    crypto.getRandomValues(buf.subarray(o, Math.min(o + 65536, buf.length)));
  return buf;
}

// Plain Node fetch() has NO default timeout — a stalled TCP connection would
// hang forever and never enter the retry path. Control calls get 30 s; chunk
// PUTs a much longer deadline (Share-Soak-3): default allows an aggregate
// upload as slow as 0.5 MiB/s before calling a PUT stalled.
const FETCH_TIMEOUT_MS = 30000;
const PUT_TIMEOUT_MS = 1000 * (args['put-timeout-s']
  ? parseInt(args['put-timeout-s'], 10)
  : Math.max(120, Math.ceil(chunkMib * concurrency * 2)));
async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Cashu blinded message (NUT-00, as crypto.js generateBlindedCredential) ─
// /admin/test-credential signs it; /initiate does not verify a test
// credential's proof (the MAC'd X-Test-Credential selects the bypass).
function blindedMessage() {
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
  const { B_ } = blindMessage(new TextEncoder().encode(secret));
  return { blinded_message: B_.toHex(true) };
}

// ─── State ─────────────────────────────────────────────────────────────────
let attempted = 0, succeeded = 0;
const failedChunks = new Set();
let paused = false, pauseReason = '';
let finaliseReached = false;
let bytesUploaded = 0;
const tStart = Date.now();

const chunkHashes   = new Array(totalChunks);
const urlCache      = {};
const batchFetching = {};
let sessionToken = null, uuid = null;
let tailUrl = null, urlLimit = totalChunks;
let partKey = null, seed = null;

async function fetchBatch(batchStart) {
  if (batchStart in urlCache) return;
  if (!(batchStart in batchFetching)) {
    batchFetching[batchStart] = (async () => {
      const count = Math.min(URL_BATCH, urlLimit - batchStart);
      const res = await fetchWithTimeout(`${workerUrl}/upload/${uuid}/urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Upload-Session': sessionToken },
        body: JSON.stringify({ from: batchStart, count }),
      });
      if (!res.ok) { delete batchFetching[batchStart]; throw new Error(`/urls batch ${batchStart} → ${res.status}`); }
      const d = await res.json();
      urlCache[batchStart] = d.urls;
    })();
  }
  await batchFetching[batchStart];
}

async function getUrl(i) {
  if (tailUrl && i === totalChunks - 1) return tailUrl;
  const batchStart = Math.floor(i / URL_BATCH) * URL_BATCH;
  await fetchBatch(batchStart);
  const next = batchStart + URL_BATCH;
  if (next < urlLimit && !(next in urlCache) && !(next in batchFetching))
    fetchBatch(next).catch(() => {});
  return urlCache[batchStart][i - batchStart].url;
}

// Part i as stored: ciphertext ‖ tag. Encrypted once; a retry resends these
// exact bytes (never re-encrypts).
async function makePayload(i) {
  const len = plainLenOf(i);
  if (!encryptMode) return randomChunk(len + TAG_BYTES);
  return encryptPart(partKey, soakPlain(seed, i, len), i, totalChunks);
}

// Same never-throws contract as the browser page's uploadOneChunk.
async function uploadOneChunk(i) {
  attempted++;
  try {
    const [payload, presignedUrl] = await Promise.all([makePayload(i), getUrl(i)]);
    if (payload.length !== plainLenOf(i) + TAG_BYTES) throw new Error(`payload ${payload.length} B, expected ${plainLenOf(i) + TAG_BYTES}`);
    chunkHashes[i] = b64url(hashChunk(payload));

    const BACKOFFS = [1000, 4000, 10000];
    let lastErr = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const putRes = await fetchWithTimeout(presignedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: payload,
        }, PUT_TIMEOUT_MS);
        if (putRes.ok) { lastErr = null; break; }
        const body = await putRes.text().catch(() => '');
        lastErr = new Error(`HTTP ${putRes.status}: ${body.slice(0, 200)}`);
        if (putRes.status < 500) break;
      } catch (netErr) {
        lastErr = netErr;
      }
      if (attempt < 2) {
        log(`⚠ chunk ${i} attempt ${attempt + 1} → ${lastErr.message} — retrying in ${BACKOFFS[attempt] / 1000}s…`);
        await new Promise(r => setTimeout(r, BACKOFFS[attempt]));
      }
    }

    if (lastErr) {
      log(`✗ chunk ${i} exhausted 3 attempts: ${lastErr.message}`);
      failedChunks.add(i);
      return false;
    }

    succeeded++;
    bytesUploaded += payload.length;
    if (succeeded % 100 === 0 || succeeded === totalChunks) {
      const elapsed = Math.max(1, Math.round((Date.now() - tStart) / 1000));
      const rate    = bytesUploaded / elapsed;
      const etaMin  = Math.round((totalBytes - bytesUploaded) / rate / 60);
      log(`${succeeded}/${totalChunks} chunks — ${fmtBytes(bytesUploaded)} in ${elapsed}s — ${fmtBytes(rate)}/s — ETA ${etaMin} min`);
    }
    return true;
  } catch (e) {
    log(`✗ chunk ${i} unexpected error: ${e.message}`);
    failedChunks.add(i);
    return false;
  }
}

let nextChunk = 0;
async function worker() {
  while (true) {
    if (paused) break;
    const i = nextChunk++;
    if (i >= totalChunks) break;
    const ok = await uploadOneChunk(i);
    if (!ok && !paused) {
      paused = true;
      pauseReason = `chunk ${i} exhausted retries — run paused for review`;
      log(`⏸ PAUSED: ${pauseReason}`);
    }
  }
}

function printFinalTally() {
  log('─── Final tally ───');
  log(`Attempted           : ${attempted} / ${totalChunks}`);
  log(`Succeeded           : ${succeeded}`);
  log(`Failed after retries: ${failedChunks.size}` +
      (failedChunks.size ? ` (chunks: ${[...failedChunks].sort((a, b) => a - b).join(', ')})` : ''));
  log(`Finalise reached    : ${finaliseReached ? 'yes' : 'no'}`);
  if (paused) log(`Paused              : yes — ${pauseReason}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────
(async () => {
  try {
    log(`▶ Starting headless soak upload (${encryptMode ? 'ENCRYPTED, link v2' : 'random parts'}) — ${fmtBytes(totalBytes)}, ${totalChunks} chunks, concurrency=${concurrency}, PUT timeout ${PUT_TIMEOUT_MS / 1000}s`);

    // Step 0: key, seed, expected plaintext hash (encrypted mode)
    let K = null;
    if (encryptMode) {
      await selfTest();
      log('Self-test ✓ (browser crypto.js / fragment.js match part-crypto KATs)');
      K       = crypto.getRandomValues(new Uint8Array(32));
      seed    = crypto.getRandomValues(new Uint8Array(16));
      partKey = await derivePartKey(K, ['encrypt']);
      mkdirSync(linkDir, { recursive: true, mode: 0o700 });
      chmodSync(linkDir, 0o700);
      const t0 = Date.now();
      const sha = soakPlainSha256(seed, totalBytes);
      log(`Plaintext: ${soakName(seed)} — ${totalBytes} B — SHA-256 ${sha} (${Math.round((Date.now() - t0) / 1000)}s)`);
    }

    // Step 1: credential (key length only — never the key)
    log(`Admin key: ${adminKey.length} chars`);
    const { blinded_message } = blindedMessage();
    const credRes = await fetchWithTimeout(`${workerUrl}/admin/test-credential`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify({ blinded_message, cap_bytes: capBytes, expires_in_seconds: credExpiry }),
    });
    if (!credRes.ok) throw new Error(`credential ${credRes.status}: ${await credRes.text()}`);
    const cred = await credRes.json();
    if (typeof cred.test_credential !== 'string') throw new Error('Worker returned no test_credential (pre-KV-Fix-1b Worker?)');
    uuid = cred.uuid;
    log(`UUID: ${uuid} — issued tier ${cred.issued_tier} — allocation ${fmtBytes(cred.allocation_bytes)}`);
    const cashuCredential = JSON.stringify({ C_: cred.signed_point, mint_pubkey: cred.mint_pubkey });

    // Step 2: initiate
    const expiryTs = Math.floor(Date.now() / 1000) + Math.round(expiryDays * 24 * 3600);
    const initiateRes = await fetchWithTimeout(`${workerUrl}/upload/${uuid}/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type':            'application/json',
        'X-Cashu-Credential':      cashuCredential,
        'X-Total-Chunks':          String(totalChunks),
        'X-Total-Bytes':           String(totalBytes),
        'X-Expiry-Timestamp':      String(expiryTs),
        'X-Credential-Commitment': cred.commitment,
        'X-Issued-Tier':           cred.issued_tier,
        'X-Test-Credential':       cred.test_credential,
        'X-File-Name':             encryptMode ? 'encrypted-payload' : 'soak-test-payload',
      },
    });
    if (!initiateRes.ok) throw new Error(`initiate ${initiateRes.status}: ${await initiateRes.text()}`);
    const initData = await initiateRes.json();
    sessionToken = initData.session_token;
    urlCache[0] = initData.urls;
    if (initData.tail_url) {
      if (initData.tail_url.index !== totalChunks - 1) throw new Error(`tail_url index ${initData.tail_url.index} ≠ ${totalChunks - 1}`);
      tailUrl  = initData.tail_url.url;
      urlLimit = totalChunks - 1;
    }
    log(`Session token obtained. Batch 0: ${initData.urls.length} URLs.` + (tailUrl ? ' Tail URL issued separately.' : ' No tail_url (pre-B12-1c Worker).'));
    log(`Expires ${new Date(expiryTs * 1000).toISOString()}`);

    // Link file now (0600), so a run that dies mid-way still leaves a usable
    // link for whatever was finalised. Key never goes to the log.
    if (encryptMode) {
      const frag = assembleFragment({ keyBytes: K, filename: soakName(seed), sizeBytes: totalBytes });
      const linkPath = join(linkDir, `${uuid}.link`);
      writeFileSync(linkPath, `${shareBase}?uuid=${uuid}#${frag}\n`, { mode: 0o600 });
      chmodSync(linkPath, 0o600);
      log(`Link written (0600): ${linkPath}`);
    }

    // Step 3: parallel upload, with a 60 s heartbeat so a stall shows in the log
    const heartbeat = setInterval(() => {
      log(`… still running: ${succeeded}/${totalChunks} succeeded, ${attempted}/${totalChunks} attempted, ${failedChunks.size} failed, paused=${paused}`);
    }, 60000);

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    clearInterval(heartbeat);

    if (failedChunks.size > 0) {
      log(`✗ Upload stopped: ${failedChunks.size} chunk(s) failed after retries. Not proceeding to finalise.`);
      printFinalTally();
      process.exit(1);
    }
    if (chunkHashes.some(h => !h)) throw new Error('Internal: missing chunk hashes after upload');
    log(`All ${totalChunks} chunks uploaded.`);

    // Step 4: merkle root (over ciphertext digests — two-roots rule)
    const merkleRoot = b64url(buildMerkleRoot(chunkHashes.map(b64urlDecode)));
    log(`Merkle root (ciphertext): ${merkleRoot}`);

    // Step 5: finalise
    const finaliseRes = await fetchWithTimeout(`${workerUrl}/upload/${uuid}/finalise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upload-Session': sessionToken },
      body: JSON.stringify({ hashes: chunkHashes, merkle_root: merkleRoot }),
    }, 120000);
    if (!finaliseRes.ok) throw new Error(`finalise ${finaliseRes.status}: ${await finaliseRes.text()}`);
    finaliseReached = true;
    log(`Finalise OK — ${JSON.stringify(await finaliseRes.json())}`);
    log(`✓ Soak complete. UUID ${uuid}, root ${merkleRoot}` + (encryptMode ? ` — link in ${join(linkDir, `${uuid}.link`)}` : ''));
    printFinalTally();
  } catch (e) {
    log(`✗ Unexpected error: ${e.message}`);
    printFinalTally();
    process.exitCode = 1;
  }
})();
