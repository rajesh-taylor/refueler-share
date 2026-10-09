// ── frontend/upload-send.js — the send engine: parts, finalise, link ─────────
// Moved out of upload.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

import { blake3Hash, hexToBuf, derivePartKey, encryptPart } from './crypto.js';
import { WORKER_URL, CHUNK_SIZE } from './config.js';
import { makeSteadyProgress, progressBytesText, setProgressWords } from './progress.js';
import { runPermanentRecord } from './timestamp.js';
import { assembleFragment } from './fragment.js';
import { buildMerkleTree } from './merkle.js';
import { writeChunkState, clearResumeState, _recordOf } from './upload-store.js';
import { UploadStop, _stopText, NO_RESUME, NOT_SAME_FILE, NOT_SAME_FOLDER } from './upload-stop.js';
import { _fetchNextUrlBatch, _putChunkDirect } from './upload-net.js';

export function _stopped(e, job, domRefs, state, helpers) {
  if (!(e instanceof UploadStop)) e = new UploadStop('browser', `${e?.name || 'Error'}: ${e?.message || ''}`);
  // B12-2: one line per stop, whatever the kind — Navy Office counts these as the
  // real failures; the per-try lines before it are retries or detail.
  helpers.reportError(`upload_stopped:${e.kind}`, String(e.message || '').slice(0, 160), job ? `uuid:${job.uuid.slice(0, 8)}` : '');
  if (e.kind === 'gone' || e.kind === 'changed') {
    if (job) clearResumeState(job.uuid, helpers.reportError).catch(() => {});
    helpers.showStopped(e.kind === 'changed' ? (job?.folder ? NOT_SAME_FOLDER : NOT_SAME_FILE) : NO_RESUME);
    return;
  }
  const retry = job
    ? () => { job.urlMap = new Map(); _carryOnOrStop(job, domRefs, state, helpers); }   // fresh URLs on a retry
    : () => { helpers.setView('chosen'); pressUpload(); };                              // new check + pass
  helpers.showStopped(_stopText(e, job), retry);
}

// Set by enterUploadMode: the upload button's own press (U-10: "Checking…" until
// the Cloudflare token lands, then start). A fresh-start Try again uses it.
let pressUpload = () => {};
// Glue 1 (Share-JS-Split-2): enterUploadMode lives in upload.js now.
export function setPressUpload(fn) { pressUpload = fn; }

export async function _carryOnOrStop(job, domRefs, state, helpers) {
  try {
    await _carryOn(job, domRefs, state, helpers);
  } catch (e) {
    _stopped(e, job, domRefs, state, helpers);
  }
}

// Encrypt part i of n under the part key (crypto.js encryptPart: per-part nonce,
// last-part flag, 4-byte BE uint32 AAD = object index = Merkle leaf).
// Deterministic: the same bytes give the same stored part, so resume can re-check.
function _encryptChunk(raw, i, n, state) {
  return encryptPart(state.partKey, raw, i, n);
}

// Send what's left of a job, then finalise and show the link. Shared by a fresh
// upload, a resume after a refresh and every same-tab Try again. Advances job.sent
// and job.hashes as parts arrive, so a stop can carry on from there.
export async function _carryOn(job, domRefs, state, helpers) {
  const { setStage, setProgress, formatBytes, reportError, showSharePanel } = helpers;
  const totalBytes  = job.file.size;
  const totalChunks = job.totalChunks;
  const chunks      = _splitChunks(job.file, CHUNK_SIZE);
  const short       = job.uuid.slice(0, 8);
  // Share-Progress-1: the bar counts bytes as they leave (inFlight = this part's
  // bytes so far), calmly: makeSteadyProgress (progress.js) climbs at the measured
  // speed, words every 2 s, time left every 5 s and none while waiting to retry.
  let inFlight = 0, waiting = false;
  const steady = makeSteadyProgress(totalBytes, (b, words) => {
    setProgress(b / totalBytes * 100);
    if (words) setProgressWords(domRefs.progressDetail, b, totalBytes, waiting ? '' : steady.left());
  });
  const progress = () => steady.set(Math.min(job.sent * CHUNK_SIZE + inFlight, totalBytes));
  const drop = domRefs.progressDrop;
  const onWait = (secs) => {
    if (!secs) { waiting = false; steady.reset(); return; }   // a try starts again
    waiting = true;
    if (drop) {
      drop.textContent = `Connection lost. Trying again in ${secs} s.`;
      drop.hidden = false;
    }
    if (inFlight) { inFlight = 0; progress(); }   // the part starts again: step back to the last one that arrived
  };
  if (drop) drop.hidden = true;

  helpers.setView('uploading');
  setStage('Preparing');
  const sentBytes0 = Math.min(job.sent * CHUNK_SIZE, totalBytes);
  setProgress(sentBytes0 / totalBytes * 100, job.sent ? progressBytesText(sentBytes0, totalBytes) : 'Encrypting…');   // whole line until bytes move

  state.sessionAesKey = await crypto.subtle.importKey('raw', hexToBuf(job.keyHex), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);   // date seal only
  state.partKey       = await derivePartKey(new Uint8Array(hexToBuf(job.keyHex)), ['encrypt']);
  state.uploadUUID    = job.uuid;

  // B12-1c: the tail URL is signed once, at /initiate; /urls serves indices < urlLimit.
  const urlLimit = job.tailUrl ? totalChunks - 1 : totalChunks;
  if (job.tailUrl) job.urlMap.set(totalChunks - 1, job.tailUrl.url);

  // Next batch of presigned URLs from index `from`. 401/409 = session expired or
  // already finalised; 400 on a record with no tailUrl = an old record meeting a
  // B12-1c Worker (it asked /urls for index N−1, which that Worker never signs).
  const fetchUrls = async (from) => {
    let urls;
    try {
      urls = await _fetchNextUrlBatch(job.uuid, job.sessionToken, from, Math.min(256, urlLimit - from), reportError);
    } catch (e) {
      if (!e.status) throw new UploadStop('network', e.message);
      if (e.status === 401 || e.status === 409 || (e.status === 400 && !job.tailUrl)) throw new UploadStop('gone', e.message);
      throw new UploadStop('refused', e.message);
    }
    for (const entry of urls) job.urlMap.set(entry.index, entry.url);
  };

  // Probe the session before any CPU work (a resume, or a retry with fresh URLs).
  // Skipped when only the tail is left: finalise's 401 is then the session check.
  if (job.sent < urlLimit && !job.urlMap.has(job.sent)) await fetchUrls(job.sent);

  // HARD RULE 1 (resume after a refresh): re-encrypt the parts already sent to
  // rebuild their ciphertext hashes — the Merkle leaves for /finalise. Skipped when
  // the job already holds them: a same-tab Try again, or a resume record that kept
  // them for an unchanged file (Share-Upload-6). Each one must equal the hash the
  // record kept for that part (expectedHashes): the first that doesn't means the
  // chosen file isn't the one that was being sent, so stop before sending anything.
  if (job.hashes.length < job.sent) {
    job.hashes.length = 0;
    const sentBytes = Math.min(job.sent * CHUNK_SIZE, totalBytes);
    setProgress(sentBytes / totalBytes * 100, 'Checking what was already sent');   // C2: say what the pause is
    for (let i = 0; i < job.sent; i++) {
      const h = blake3Hash(await _encryptChunk(await _readChunk(chunks[i]), i, totalChunks, state));
      if (job.expectedHashes && h !== job.expectedHashes[i]) {
        reportError('resume_part_mismatch', `part ${i} of ${job.sent}`, `uuid:${short}`);
        throw new UploadStop('changed', `resume part ${i} differs`);
      }
      job.hashes.push(h);
      setProgress(sentBytes / totalBytes * 100, `Checking what was already sent · ${formatBytes(Math.min((i + 1) * CHUNK_SIZE, totalBytes))} of ${formatBytes(sentBytes)}`);
    }
  }
  job.hashes.length = job.sent;   // a part that was encrypted but never arrived is redone

  setStage('Encrypting and uploading');
  try {
  for (let i = job.sent; i < totalChunks; i++) {
    if (!job.urlMap.has(i)) {
      if (i >= urlLimit) throw new UploadStop('gone', `No presigned URL for chunk ${i}`);
      await fetchUrls(i);
    }
    const presignedUrl = job.urlMap.get(i);
    if (!presignedUrl) throw new UploadStop('refused', `Presigned URL for chunk ${i} missing after batch fetch`);

    const raw = await _readChunk(chunks[i]); // fresh FileReader per chunk — fixes NotReadableError
    const encrypted = await _encryptChunk(raw, i, totalChunks, state);
    const chunkHashHex = blake3Hash(encrypted);

    const partLen = Math.min(CHUNK_SIZE, totalBytes - i * CHUNK_SIZE);
    await _putChunkDirect(presignedUrl, encrypted, i, job.uuid, reportError, {
      onProgress: (loaded) => {
        if (drop && !drop.hidden && loaded > 0) drop.hidden = true;   // bytes moving again
        inFlight = Math.min(loaded, partLen);
        progress();
      },
      onWait,
    });
    inFlight = 0;

    job.hashes.push(chunkHashHex);
    if (job.plainHash) job.plainHash.update(new Uint8Array(raw));
    job.sent = i + 1;
    writeChunkState(_recordOf(job), reportError).catch(() => {});
    progress();
  }
  } finally {
    steady.stop();   // the bar's ticker ends with the sending, however it ends
  }

  setStage('Finishing');
  setProgress(100, 'Checking every part arrived…');
  if (job.plainHash && job.sealNonceHex) {
    const prResult = await runPermanentRecord(job.uuid, job.plainHash.digest('hex'), job.sealNonceHex, state.sessionAesKey);
    if (!prResult.ok) reportError('permanent_record', prResult.error || 'unknown', `uuid:${short}`);
    // (paid only, unreachable today, F-10 — reported, not shown.)
    job.plainHash = null;   // once per transfer, even if finalise needs a retry
  }

  // ── Share-6-3d: finalise the transfer ─────────────────────────────────────
  // Client-authoritative CIPHERTEXT-chunk Merkle root over the per-chunk
  // ciphertext-object digests in job.hashes (hex, index order).
  // buildMerkleTree (frontend/merkle.js) applies the RFC-6962 leaf/node domain
  // separation internally — feed it the RAW 32-byte digests. Do NOT prepend the
  // session IV (NONCE trap): the leaves must equal BLAKE3 of the exact stored
  // bytes the Worker re-hashes at download, or every transfer 409-walls at 6-5.
  // This is the ciphertext root ONLY — never blake3PlaintextRoot (TWO ROOTS).
  const leaves = job.hashes.map(hex => new Uint8Array(hexToBuf(hex)));
  const { root: merkleRootBytes } = buildMerkleTree(leaves);
  const finaliseBody = {
    hashes:      leaves.map(_bytesToB64url), // b64url(raw 32B digest) × total_chunks
    merkle_root: _bytesToB64url(merkleRootBytes),
    // tree_algo is NOT sent — the Worker pins 'rfc6962-unbalanced-blake3-v1'.
  };

  let finRes;
  try {
    finRes = await fetch(`${WORKER_URL}/upload/${job.uuid}/finalise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upload-Session': job.sessionToken },
      body: JSON.stringify(finaliseBody),
    });
  } catch (e) {
    reportError('finalise_fetch', e.message?.slice(0, 120), `uuid:${short}`);
    throw new UploadStop('unfinished', e.message);
  }

  if (finRes.status === 409) {
    // incomplete → { missing }; B12-1d wrong size → { segments } (the Worker deletes those).
    // The session stays open: carry on from the first part that has to go again.
    let body = {};
    try { body = await finRes.json(); } catch { /* not JSON */ }
    const redo = (body.missing || body.segments || []).map(s => parseInt(s, 10)).filter(n => n >= 0);
    reportError(body.error === 'wrong_size' ? 'finalise_wrong_size' : 'finalise_incomplete',
      `${redo.length}: ${redo.slice(0, 20).join(',')}`, `uuid:${short}`);
    job.sent = redo.length ? Math.min(job.sent, ...redo) : 0;
    job.hashes.length = job.sent;
    writeChunkState(_recordOf(job), reportError).catch(() => {});
    throw new UploadStop('missing', `finalise 409 ${body.error || ''}`);
  }
  if (finRes.status === 401 || finRes.status === 404) {
    reportError('finalise_status', `HTTP ${finRes.status}`, `uuid:${short}`);
    throw new UploadStop('gone', `finalise ${finRes.status}`);
  }
  if (!finRes.ok) {
    const txt = await finRes.text().catch(() => '');
    reportError('finalise_status', `HTTP ${finRes.status}`, `uuid:${short} ${txt.slice(0, 120)}`);
    throw new UploadStop(finRes.status >= 500 ? 'unfinished' : 'browser', `finalise ${finRes.status}`);
  }

  // 200 { ok:true, merkle_root } — transfer complete and ciphertext-verifiable.
  // The resume record goes only now: a refresh after a failed finalise can still finish.
  clearResumeState(job.uuid, reportError).catch(() => {});
  domRefs.passphraseInput.value = '';
  setProgress(100);
  await new Promise(r => setTimeout(r, 500));

  // Link format v2 (D-1): real filename + key + size in the URL fragment only.
  const fragmentBlob = assembleFragment({
    keyBytes:  new Uint8Array(hexToBuf(job.keyHex)),
    filename:  job.file.name,
    sealNonce: job.sealNonceHex ? new Uint8Array(hexToBuf(job.sealNonceHex)) : undefined,
    sizeBytes: job.file.size, // Share-Size-1: size travels in the fragment, not /meta (required in v2)
  });
  const shareUrl = `${location.origin}${location.pathname}?uuid=${job.uuid}#${fragmentBlob}`;
  history.replaceState(null, '', location.pathname);
  showSharePanel(shareUrl, job.info);
}

// ─────────────────────────────────────────────────────────────────────────────
// Local helpers
// ─────────────────────────────────────────────────────────────────────────────
function _splitChunks(file, size) {
  const out = [];
  let offset = 0;
  while (offset < file.size) { out.push(file.slice(offset, offset + size)); offset += size; }
  return out;
}

function _readChunk(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(blob);
  });
}

// bytes → base64url, UNPADDED, strict URL-safe alphabet [A-Za-z0-9_-].
// Matches fragment.js's canonical encoder and exactly what finalise.js's
// b64urlToBytes accepts — it REJECTS any '=' padding. Used only on the 6-3d
// finalise wire body, where every input is a fixed 32-byte digest. (fragment.js's
// own encoder is not exported, so this is the small local copy the brief calls for.)
function _bytesToB64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
