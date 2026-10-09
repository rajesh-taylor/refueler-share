// ── frontend/upload-net.js — upload wire calls ───────────────────────────────
// Moved out of upload.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

import { WORKER_URL, CHUNK_UPLOAD_TIMEOUT_MS } from './config.js';
import { RETRY_DELAYS_MS, waitForRetry } from './progress.js';
import { UploadStop } from './upload-stop.js';

// ─────────────────────────────────────────────────────────────────────────────
// One PUT by XMLHttpRequest — fetch can't report upload progress (Share-Progress-1).
// The browser sets Content-Length from the body, as fetch did, so the presigned
// signature (B12-1c signs content-length) still matches. The timer is a stall
// timer: it restarts on every progress event, so a slow link isn't cut off while
// bytes are moving (Safari hangs silently on a dropped network).
// ─────────────────────────────────────────────────────────────────────────────
function _xhrPut(url, body, stallMs, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer;
    const stall = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { xhr.abort(); reject(Object.assign(new Error(`Chunk upload stalled for ${stallMs / 1000}s`), { timedOut: true })); }, stallMs);
    };
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { stall(); if (onProgress) onProgress(e.loaded); };
    xhr.onload  = () => { clearTimeout(timer); resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, etag: xhr.getResponseHeader('ETag') || '', text: xhr.responseText || '' }); };
    xhr.onerror = () => { clearTimeout(timer); reject(new Error('Network error')); };
    stall();
    xhr.send(body);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// _fetchNextUrlBatch — POST /upload/{uuid}/urls {from,count}, session-token authed.
// Never re-verifies or re-spends Cashu (spec §6 / do-not-retry §10).
// ─────────────────────────────────────────────────────────────────────────────
export async function _fetchNextUrlBatch(uuid, sessionToken, from, count, reportError) {
  let res;
  try {
    res = await fetch(`${WORKER_URL}/upload/${uuid}/urls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upload-Session': sessionToken },
      body: JSON.stringify({ from, count }),
    });
  } catch (e) {
    reportError('url_batch_fetch', e.message?.slice(0, 80), `uuid:${uuid.slice(0, 8)} from:${from}`);
    throw new Error(`URL batch fetch failed (network): ${e.message}`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    reportError('url_batch_status', `HTTP ${res.status}`, `uuid:${uuid.slice(0, 8)} from:${from} ${txt.slice(0, 80)}`);
    const e = new Error(`URL batch ${from} failed: HTTP ${res.status}`);
    e.status = res.status; // resume uses 400 to spot an old record on a B12-1c Worker
    throw e;
  }
  const body = await res.json();
  return body.urls || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// _putChunkDirect — PUT one encrypted chunk to R2 via a presigned URL.
// Returns the ETag string (R2 ACK). Retries on RETRY_DELAYS_MS (Share-Progress-1:
// no wait over 10 s, about 2 min in all). onProgress(bytes of this part sent);
// onWait(seconds) counts down a wait, onWait(0) when a try starts again.
// ─────────────────────────────────────────────────────────────────────────────
export async function _putChunkDirect(presignedUrl, encryptedBytes, chunkIndex, uuid, reportError, { onProgress, onWait } = {}) {
  const tries = RETRY_DELAYS_MS.length + 1;
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await _xhrPut(presignedUrl, encryptedBytes, CHUNK_UPLOAD_TIMEOUT_MS, onProgress);

      if (res.ok) return res.etag.replace(/"/g, '');

      // 403 = signature invalid / URL reused — unrecoverable without a new URL
      if (res.status === 403) {
        reportError('direct_put_403', `chunk ${chunkIndex} 403 — URL invalid`, `uuid:${uuid.slice(0, 8)} attempt:${attempt} ${res.text.slice(0, 80)}`);
        throw new UploadStop('refused', `Chunk ${chunkIndex} direct PUT 403: presigned URL rejected`);
      }

      if (res.status === 429) {
        reportError('direct_put_429', `chunk ${chunkIndex} 429 attempt ${attempt}`, `uuid:${uuid.slice(0, 8)}`);
        lastErr = new Error('HTTP 429');
      } else if (res.status < 500) {
        reportError('direct_put_4xx', `chunk ${chunkIndex} HTTP ${res.status}`, `uuid:${uuid.slice(0, 8)} ${res.text.slice(0, 80)}`);
        throw new UploadStop('refused', `Chunk ${chunkIndex} direct PUT: HTTP ${res.status}`);
      } else {
        lastErr = new Error(`HTTP ${res.status}`);
        reportError('direct_put_5xx', `chunk ${chunkIndex} HTTP ${res.status} attempt ${attempt}`, `uuid:${uuid.slice(0, 8)}`);
      }
    } catch (e) {
      if (e instanceof UploadStop) throw e; // fatal — propagate immediately
      lastErr = e;
      if (e.timedOut) {
        reportError('direct_put_timeout', `chunk ${chunkIndex} timed out attempt ${attempt}`, `uuid:${uuid.slice(0, 8)}`);
      } else {
        reportError('direct_put_err', `chunk ${chunkIndex} attempt ${attempt}: ${e.message?.slice(0, 80)}`, `uuid:${uuid.slice(0, 8)}`);
      }
    }
    if (attempt < tries - 1) {
      await waitForRetry(RETRY_DELAYS_MS[attempt], onWait);
      if (onWait) onWait(0);
    }
  }
  throw new UploadStop('network', `Chunk ${chunkIndex} direct PUT failed after ${tries} attempts: ${lastErr?.message}`, { tried: true });
}

// fetch, with a dropped connection turned into a "network" stop.
export async function _send(url, options, what, reportError) {
  try {
    return await fetch(url, options);
  } catch (e) {
    reportError(`${what}_fetch`, e.message?.slice(0, 120), '');
    throw new UploadStop('network', `${what}: ${e.message}`);
  }
}
