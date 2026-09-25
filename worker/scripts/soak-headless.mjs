// worker/scripts/soak-headless.mjs  (Share-Soak-1)
//
// Headless, terminal-independent driver for the same soak pipeline as
// test-upload.html. Run with nohup so it survives the SSH/terminal session
// closing — see the launch command printed by the session, or:
//
//   cd /Users/rajeshtaylor/Documents/refueler-share/worker && \
//     nohup node scripts/soak-headless.mjs --gib=250 --admin-key=YOUR_KEY \
//     > /tmp/soak-$(date +%s).log 2>&1 & disown
//
// Tail the log with: tail -f /tmp/soak-<ts>.log
// No new npm dependencies — imports @noble/hashes and @noble/secp256k1,
// both already in worker/package.json.

import { blake3 } from '@noble/hashes/blake3';
import * as secp from '@noble/secp256k1';
import { webcrypto as crypto } from 'node:crypto';

// ─── CLI args ─────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const workerUrl   = (args.url || 'https://api.share.refueler.io').replace(/\/$/, '');
const adminKey    = args['admin-key'];
const targetGib   = parseFloat(args.gib ?? '250');
const concurrency = parseInt(args.concurrency ?? '8', 10);
const chunkMib    = parseInt(args['chunk-mib'] ?? '32', 10);
const capGib      = parseFloat(args['cap-gib'] ?? String(targetGib + 10));
const credExpiry  = parseInt(args['cred-expiry'] ?? '28800', 10);

if (!adminKey) {
  console.error('✗ --admin-key=YOUR_KEY is required');
  process.exit(1);
}

const CHUNK_SIZE  = chunkMib * 1024 * 1024;
const totalBytes  = Math.round(targetGib * 1024 * 1024 * 1024);
const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE);
const capBytes    = Math.round(capGib * 1024 * 1024 * 1024);
const URL_BATCH   = 256;

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KiB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(2)} MiB`;
  return `${(b / 1024 ** 3).toFixed(3)} GiB`;
}
function toB64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function b64urlDecode(s) {
  return new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}
function randomChunk(size) {
  const buf = new Uint8Array(size);
  for (let o = 0; o < buf.length; o += 65536)
    crypto.getRandomValues(buf.subarray(o, Math.min(o + 65536, buf.length)));
  return buf;
}

// Plain Node fetch() has NO default timeout — unlike browser fetch, a stalled
// TCP connection or a server that accepts the connection but never responds
// will hang the promise forever, with no resolution and no throw, so it never
// enters the retry path. This wraps every request with a hard deadline so a
// stall surfaces as a normal AbortError, which the retry loop already handles.
const FETCH_TIMEOUT_MS = 30000; // 30s — generous for a 32 MiB PUT, short enough to notice a real stall
async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Merkle tree (rfc6962-unbalanced-blake3-v1) — identical to test-upload.html
function leafHash(digest) {
  const buf = new Uint8Array(33);
  buf[0] = 0x00;
  buf.set(digest, 1);
  return blake3(buf);
}
function merkleNode(left, right) {
  const buf = new Uint8Array(65);
  buf[0] = 0x01;
  buf.set(left, 1);
  buf.set(right, 33);
  return blake3(buf);
}
function buildMerkleRoot(leafHashBytes) {
  let nodes = leafHashBytes.map(d => leafHash(d));
  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) {
      next.push(i + 1 < nodes.length ? merkleNode(nodes[i], nodes[i + 1]) : nodes[i]);
    }
    nodes = next;
  }
  return nodes[0];
}

// ─── BDHKE blind (identical to test-upload.html / share.js) ──────────────
async function blindedMessage() {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const Y      = secp.ProjectivePoint.fromPrivateKey(secret);
  const rBytes = crypto.getRandomValues(new Uint8Array(32));
  const r      = secp.utils.normPrivateKeyToScalar(rBytes);
  const B_     = Y.add(secp.ProjectivePoint.BASE.multiply(r));
  return { blinded_message: B_.toHex(true), r, secret };
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

async function fetchBatch(uuid, batchStart) {
  if (batchStart in urlCache) return;
  if (!(batchStart in batchFetching)) {
    batchFetching[batchStart] = (async () => {
      const res = await fetchWithTimeout(`${workerUrl}/upload/${uuid}/urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Upload-Session': sessionToken },
        body: JSON.stringify({ from: batchStart, count: 256 }),
      });
      if (!res.ok) throw new Error(`/urls batch ${batchStart} → ${res.status}`);
      const d = await res.json();
      urlCache[batchStart] = d.urls;
    })();
  }
  await batchFetching[batchStart];
}

async function getUrl(i) {
  const batchStart = Math.floor(i / URL_BATCH) * URL_BATCH;
  await fetchBatch(uuid, batchStart);
  const next = batchStart + URL_BATCH;
  if (next < totalChunks && !(next in urlCache) && !(next in batchFetching))
    fetchBatch(uuid, next).catch(() => {});
  return urlCache[batchStart][i - batchStart].url;
}

// Same never-throws contract as the browser page's uploadOneChunk.
async function uploadOneChunk(i) {
  attempted++;
  try {
    const isLast     = i === totalChunks - 1;
    const chunkBytes = isLast ? (totalBytes - i * CHUNK_SIZE) : CHUNK_SIZE;
    const payload     = randomChunk(chunkBytes);
    const [hashBytes, presignedUrl] = await Promise.all([
      Promise.resolve(blake3(payload)),
      getUrl(i),
    ]);
    chunkHashes[i] = toB64url(hashBytes);

    const BACKOFFS = [1000, 4000, 10000];
    let lastErr = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const putRes = await fetchWithTimeout(presignedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: payload,
        });
        if (putRes.ok) { lastErr = null; break; }
        if (putRes.status < 500) {
          const body = await putRes.text().catch(() => '');
          lastErr = new Error(`HTTP ${putRes.status}: ${body.slice(0, 200)}`);
          break;
        }
        const body = await putRes.text().catch(() => '');
        lastErr = new Error(`HTTP ${putRes.status}: ${body.slice(0, 200)}`);
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
    bytesUploaded += chunkBytes;
    if (succeeded % 100 === 0 || succeeded === totalChunks) {
      const elapsed = Math.round((Date.now() - tStart) / 1000);
      log(`${succeeded}/${totalChunks} chunks — ${fmtBytes(bytesUploaded)} in ${elapsed}s`);
    }
    return true;
  } catch (e) {
    log(`✗ chunk ${i} unexpected error: ${e.message}`);
    failedChunks.add(i);
    return false;
  }
}

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
let nextChunk = 0;

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
    log(`▶ Starting headless soak upload — ${fmtBytes(totalBytes)}, ${totalChunks} chunks, concurrency=${concurrency}`);

    // Step 1: credential
    const { blinded_message } = await blindedMessage();
    const credRes = await fetchWithTimeout(`${workerUrl}/admin/test-credential`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify({ blinded_message, cap_bytes: capBytes, expires_in_seconds: credExpiry }),
    });
    if (!credRes.ok) throw new Error(`credential ${credRes.status}: ${await credRes.text()}`);
    const cred = await credRes.json();
    uuid = cred.uuid;
    log(`UUID: ${uuid} — issued tier ${cred.issued_tier} — allocation ${fmtBytes(cred.allocation_bytes)}`);
    const cashuCredential = JSON.stringify({ C_: cred.signed_point, mint_pubkey: cred.mint_pubkey });

    // Step 2: initiate
    const expiryTs = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
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
        'X-File-Name':             'soak-test-payload',
      },
    });
    if (!initiateRes.ok) throw new Error(`initiate ${initiateRes.status}: ${await initiateRes.text()}`);
    const initData = await initiateRes.json();
    sessionToken = initData.session_token;
    urlCache[0] = initData.urls;
    log(`Session token obtained. Batch 0: ${initData.urls.length} URLs.`);

    // Step 3: parallel upload
    // Heartbeat — a stall now shows up in the log within 60s instead of
    // being silent until the process is manually checked. Cleared once the
    // upload phase (success or failure) is done.
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

    // Step 4: merkle root
    const leafBytes = chunkHashes.map(h => b64urlDecode(h));
    const rootBytes = buildMerkleRoot(leafBytes);
    const merkleRoot = toB64url(rootBytes);
    log(`Merkle root: ${merkleRoot}`);

    // Step 5: finalise
    const finaliseRes = await fetchWithTimeout(`${workerUrl}/upload/${uuid}/finalise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upload-Session': sessionToken },
      body: JSON.stringify({ hashes: chunkHashes, merkle_root: merkleRoot }),
    }, 120000);
    if (!finaliseRes.ok) throw new Error(`finalise ${finaliseRes.status}: ${await finaliseRes.text()}`);
    finaliseReached = true;
    const finaliseData = await finaliseRes.json();
    log(`Finalise OK — ${JSON.stringify(finaliseData)}`);
    log(`✓ Soak complete. UUID ${uuid}, root ${merkleRoot}`);
    printFinalTally();
  } catch (e) {
    log(`✗ Unexpected error: ${e.message}`);
    printFinalTally();
    process.exitCode = 1;
  }
})();
