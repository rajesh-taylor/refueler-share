// ── frontend/download-save.js — saving: stream or blob, and how it ends ──────
// Moved out of download.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

import { setCalmText } from './progress.js';
import { IntegrityError, DECRYPT_FAILED_FSAA, DECRYPT_FAILED_BLOB, _decryptPart,
         _eachPartInOrder } from './download-fetch.js';
import { $, _showSheet, _showNotice, _showProgress, _setBar, _makeDlProgress, _showLinkInactive,
         _showDownloadError } from './download-sheets.js';
import { _showNotesCard } from './download-notes.js';

// ─────────────────────────────────────────────────────────────────────────────
// _showIntegrityFailure — the honest, user-facing integrity failure state.
//
// Copy rules (honesty banner in session brief):
//   - NEVER "end-to-end integrity", "proof of delivery", "verified in transit"
//   - "Transfer failed its integrity check" — ciphertext storage integrity only
//   - No partial file was saved
// ─────────────────────────────────────────────────────────────────────────────
function _showIntegrityFailure(domRefs, reportError, uuid, chunkIdx) {
  // Item 12. Honest scope: the stored copy vs. what was uploaded (ciphertext storage
  // integrity), never end-to-end.
  _showNotice('Stopped', "This file didn't pass its check.",
    "The stored copy doesn't match what the sender uploaded, so the download stopped. "
    + 'Nothing was saved to your device. Ask the sender for a new link.');

  // Log for ops visibility — fire-and-forget
  const detail = chunkIdx !== null ? `chunk:${chunkIdx}` : 'root_or_sidecar';
  try {
    reportError('integrity_check_failed', 'ciphertext_storage_integrity', `uuid:${uuid.slice(0,8)} ${detail}`);
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// FSAA streaming download — Share-6-5b changes:
//   1. _fetchPart detects 409 → throws IntegrityError (never retried)
//   2. No Range header ever sent — confirmed and locked; fetch uses the full URL only
//   3. Truncated-body guard: if buf.byteLength === 0 on a chunk that should have bytes → IntegrityError
//   4. Catch block handles IntegrityError → _showIntegrityFailure, abort writable, no partial file
//   5. X-Integrity header read silently on first chunk; no UX change
//   6. Legacy 200 (no X-Integrity) → identical path, silent pass-through
// ─────────────────────────────────────────────────────────────────────────────
export async function _startDownloadStream(uuid, meta, fileHandle, fileName, willSelfDestruct, domRefs, state, helpers) {
  const { reportError } = helpers;
  const totalChunks = meta.total_chunks;
  const totalBytes  = (meta.total_bytes && meta.total_bytes > 0) ? meta.total_bytes : 0;

  if (!totalChunks || totalChunks < 1) { _showDownloadError('Transfer metadata is incomplete. Please try again.', domRefs); return; }

  _showProgress(domRefs, 'Downloading', totalBytes);

  let writable;
  try {
    writable = await fileHandle.createWritable();
  } catch {
    _showDownloadError('Could not open the save location. Please try again.', domRefs);
    return;
  }

  const prog = _makeDlProgress(domRefs, totalBytes, totalChunks, 1);
  const DECRYPT_STOP = {};

  try {
    let bytesWritten = 0;
    try {
      await _eachPartInOrder(uuid, totalChunks, state, prog, async (ciphertextBuf, i) => {
        let plaintext;
        try {
          plaintext = await _decryptPart(state, ciphertextBuf, i, totalChunks);
        } catch (e) {
          reportError('decrypt', e.message, `uuid:${uuid.slice(0,8)} chunk:${i}`);
          throw DECRYPT_STOP;
        }
        await writable.write(new Uint8Array(plaintext));
        bytesWritten += plaintext.byteLength;   // the bar counts bytes as they arrive (prog)
      }, willSelfDestruct);
    } catch (e) {
      if (e !== DECRYPT_STOP) throw e;
      await writable.abort();
      _showDownloadError(DECRYPT_FAILED_FSAA, domRefs);
      return;
    }

    if (state.linkVersion === 2 && bytesWritten !== totalBytes) {
      reportError('decrypt', `size ${bytesWritten} != ${totalBytes}`, `uuid:${uuid.slice(0,8)}`);
      await writable.abort();
      _showDownloadError(DECRYPT_FAILED_FSAA, domRefs);
      return;
    }
    await writable.close();
    _finish(willSelfDestruct, domRefs);

  } catch (e) {
    try { await writable.abort(); } catch {}
    _downloadFailed(e, uuid, domRefs, reportError);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Blob fallback download — Share-6-5b changes:
//   1. 409 detected in the fetch loop → IntegrityError thrown
//   2. Truncated-body guard: byteLength === 0 after res.ok → IntegrityError
//   3. No Range header ever sent (loop fetches full chunk URL only)
//   4. chunks array discarded and never assembled on IntegrityError
//   5. X-Integrity read silently on res headers; no UX change for legacy
// ─────────────────────────────────────────────────────────────────────────────
export async function _startDownload(uuid, meta, fileName, willSelfDestruct, domRefs, state, helpers) {
  const { reportError } = helpers;
  const totalChunks = meta?.total_chunks;

  if (!totalChunks || totalChunks < 1) { _showDownloadError('Transfer metadata is incomplete. Please try again.', domRefs); return; }

  const totalBytes = (meta.total_bytes && meta.total_bytes > 0) ? meta.total_bytes : 0;
  _showProgress(domRefs, 'Downloading', totalBytes);

  // Share-Progress-1: downloading fills 0–90 % as bytes arrive, preparing the last 10 %.
  const prog = _makeDlProgress(domRefs, totalBytes, totalChunks, 0.9);
  const chunks = [];
  try {
    await _eachPartInOrder(uuid, totalChunks, state, prog, (buf) => { chunks.push(buf); }, willSelfDestruct);
  } catch (e) {
    _downloadFailed(e, uuid, domRefs, reportError);   // chunks discarded, never assembled
    return;
  }

  // Second pass (Safari/Firefox): decrypt in memory, then hand the file over (item 8).
  domRefs.dlStageTag.textContent = 'Preparing file';
  const decrypted = [];
  let plainBytes = 0;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const plain = await _decryptPart(state, chunks[i], i, totalChunks);
      decrypted.push(plain);
      plainBytes += plain.byteLength;
    } catch (e) {
      reportError('decrypt', e.message, `uuid:${uuid.slice(0,8)} chunk:${i}`);
      _showDownloadError(DECRYPT_FAILED_BLOB, domRefs);
      return;
    }
    _setBar(domRefs, 90 + ((i + 1) / chunks.length) * 10);
    setCalmText($('dl-mb'), 'Decrypting…');
  }
  if (state.linkVersion === 2 && plainBytes !== totalBytes) {
    reportError('decrypt', `size ${plainBytes} != ${totalBytes}`, `uuid:${uuid.slice(0,8)}`);
    _showDownloadError(DECRYPT_FAILED_BLOB, domRefs);
    return;
  }

  const blob    = new Blob(decrypted, { type: 'application/octet-stream' });
  const blobUrl = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href = blobUrl; a.download = fileName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

  _finish(willSelfDestruct, domRefs);
}

// ─────────────────────────────────────────────────────────────────────────────
// Finished (item 9, R-10): "Downloaded." + File/Size, DAD line, Notes card, send line.
// No date seal (item 10, R-9), so the Notes card is always tried.
// ─────────────────────────────────────────────────────────────────────────────
function _finish(willSelfDestruct, domRefs) {
  if (willSelfDestruct) $('rx-done-deleted').hidden = false;   // before the sheet shows: it joins the arrival
  _showSheet('rx-done');

  _showNotesCard(domRefs.dlSignoff);
}

// Where a download that stopped lands — both paths (was the stream path's catch).
function _downloadFailed(e, uuid, domRefs, reportError) {
  if (e instanceof IntegrityError) {
    reportError('integrity_check_failed', 'ciphertext_storage_integrity', `uuid:${uuid.slice(0,8)}`);
    _showIntegrityFailure(domRefs, reportError, uuid, e.chunk);
    return;
  }
  reportError('download_chunk_retry_exhausted', e.message || 'unknown', `uuid:${uuid.slice(0,8)}`);
  if (e.status === 401)       _showDownloadError('Access denied. This transfer may have expired or the link is incorrect.', domRefs);
  else if (e.status === 410)  _showLinkInactive(domRefs);
  else if (e.retryExhausted)  _showDownloadError('Download failed after several attempts. Check your connection and try again.', domRefs);
  else                        _showDownloadError('Download failed. Please try again.', domRefs);
}
