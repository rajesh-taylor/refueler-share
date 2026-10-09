// ── frontend/download-fetch.js — fetching and decrypting parts ───────────────
// Moved out of download.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

import { decryptPart, decryptPartV1 } from './crypto.js';
import { WORKER_URL, CHUNK_SIZE } from './config.js';
import { RETRY_DELAYS_MS, waitForRetry } from './progress.js';

// ─────────────────────────────────────────────────────────────────────────────
// IntegrityError — typed error thrown on any 409 or truncated-body path.
// Carries the raw chunk index from the 409 body when present (chunk field).
// ─────────────────────────────────────────────────────────────────────────────
export class IntegrityError extends Error {
  constructor(chunk = null) {
    super('integrity_failed');
    this.name = 'IntegrityError';
    this.integrity = true;
    this.chunk = chunk; // null = root/sidecar failure; number = chunk i was bad
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// _parse409Body — safely read a 409 body and extract {chunk} if present.
// Returns null (root/sidecar failure) or a number (chunk index).
// Never throws.
// ─────────────────────────────────────────────────────────────────────────────
async function _parse409Body(res) {
  try {
    const body = await res.json();
    if (body && typeof body.chunk === 'number') return body.chunk;
  } catch {
    // body already consumed or non-JSON — root/sidecar failure path
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decrypt part i of n — one helper for both download paths.
// v2: part key + per-part nonce (the last-part flag means a shortened or extended
// transfer fails here); every part but the last must be exactly CHUNK_SIZE.
// v1/v0: the old path (K + the link's IV). Throws on any failure.
// ─────────────────────────────────────────────────────────────────────────────
export const DECRYPT_FAILED_FSAA = 'Decryption failed — wrong key or corrupted data. No partial file was saved.';
export const DECRYPT_FAILED_BLOB = 'Decryption failed — wrong key or corrupted data.';

export async function _decryptPart(state, ct, i, n) {
  if (state.linkVersion !== 2) return decryptPartV1(state.sessionAesKey, state.sessionIv, ct, i);
  const plain = await decryptPart(state.sessionAesKey, ct, i, n);
  if (i < n - 1 && plain.byteLength !== CHUNK_SIZE) throw new Error(`part ${i} is ${plain.byteLength} bytes`);
  return plain;
}

// ─────────────────────────────────────────────────────────────────────────────
// Size from the fragment, if it agrees with the chunk count; else /meta (links
// made before Share-Size-1); else 0. A damaged z never blocks a download.
// ─────────────────────────────────────────────────────────────────────────────
export function _resolveSize(fragmentSize, meta) {
  if (Number.isSafeInteger(fragmentSize) && fragmentSize > 0 &&
      Math.ceil(fragmentSize / CHUNK_SIZE) === meta.total_chunks) return fragmentSize;
  return (Number.isSafeInteger(meta.total_bytes) && meta.total_bytes > 0) ? meta.total_bytes : 0;
}

// Parts in order, overlapped (Share-Progress-1). The Worker reads and checks a whole
// part before its first byte, so one part at a time left the bar standing still at
// every part. The next part is asked for as soon as the one before it starts
// arriving, so one part is always waiting while another streams; at most DL_IN_FLIGHT
// are held (64 MiB on the stream path). Two, not four (Safari-Slow-Link-1): an iPhone
// on a VPN had four 32 MiB parts cut together, again and again, while one or two at a
// time arrived; the link, not the count, sets the speed. Part 0 goes first (it records the download
// start). On a delete-after-download transfer (holdLast) the last part is asked for
// only once every earlier part has fully arrived: serving it starts the deletion on
// the Worker (handlers/download.js finishDownload). On a failure the rest stop.
const DL_IN_FLIGHT = 2;
export async function _eachPartInOrder(uuid, n, state, prog, use, holdLast) {
  const pending = new Map();
  let next = 0, waiting = 0, arrived = 0;
  const fill = () => {
    while (next < n && waiting === 0 && pending.size < DL_IN_FLIGHT) {
      if (holdLast && next === n - 1 && arrived < n - 1) break;
      waiting++;
      let started = false;
      const begin = () => { if (!started) { started = true; waiting--; fill(); } };
      const p = _fetchPart(uuid, next, state, prog, begin);
      p.then(() => { arrived++; begin(); fill(); }, () => { if (!started) { started = true; waiting--; } });
      pending.set(next++, p);
    }
  };
  try {
    for (let i = 0; i < n; i++) {
      fill();
      const buf = await pending.get(i);
      pending.delete(i);
      fill();
      await use(buf, i);
    }
  } catch (e) {
    prog.stopped = true;
    throw e;
  } finally {
    prog.stop();   // the bar's ticker ends with the parts
  }
}

// One part, read as it arrives so the bar moves within a part, with the upload's
// retry rule (RETRY_DELAYS_MS). Auth header only — never a Range header (locked
// 6-5b). 400/401/410/416 → err.fatal. 409 is a definitive integrity verdict and an
// empty body a cut one: IntegrityError, never retried. A body cut mid-read (no 409
// on the >128 path) throws in read() and is retried, as before.
async function _fetchPart(uuid, idx, state, prog, onStart) {
  const { onBytes, onWait } = prog;
  const padded  = String(idx).padStart(4, '0');
  const headers = {};
  if (state.downloadToken) headers['Authorization'] = `Bearer ${state.downloadToken}`;
  const tries = RETRY_DELAYS_MS.length + 1;
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (prog.stopped) throw new Error('stopped');
    let got = 0;
    try {
      const res = await fetch(`${WORKER_URL}/download/${uuid}/${padded}`, { headers });
      if (res.status === 400 || res.status === 401 || res.status === 410 || res.status === 416) {
        const err = new Error(`HTTP ${res.status}`); err.fatal = true; err.status = res.status; throw err;
      }
      if (res.status === 409) throw new IntegrityError(await _parse409Body(res));
      if (res.ok) {
        if (onStart) onStart();   // headers in: the next part can be asked for
        const pieces = [];
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pieces.push(value);
          got += value.byteLength;
          onBytes(value.byteLength);
        }
        if (got === 0) throw new IntegrityError(idx);
        const buf = new Uint8Array(got);
        let off = 0;
        for (const p of pieces) { buf.set(p, off); off += p.byteLength; }
        return buf.buffer;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (e instanceof IntegrityError || e.fatal) throw e;
      lastErr = e;
    }
    if (got) onBytes(-got);
    if (attempt < tries - 1 && !prog.stopped) { await waitForRetry(RETRY_DELAYS_MS[attempt], onWait); onWait(0); }
  }
  const err = new Error(lastErr?.message || 'Network error'); err.retryExhausted = true; throw err;
}
