// ── frontend/download.js — download state machine ────────────────────────────
// Extracted from share.js at Share-JS-Refactor session (TH-block).
// No behaviour change from TH-2 share.js — pure structural split.
//
// Share-6-5b: integrity-failure UX (B9-3 client half).
//   Handles every response shape from the verified download path:
//   - Verified 200  → header X-Integrity: ciphertext-storage-verified (silent, no UX change)
//   - Legacy 200    → no X-Integrity header (silent, no UX change)
//   - 409 root/sidecar failure → {"error":"integrity_failed"} → show IntegrityError UI
//   - 409 per-chunk ≤128      → {"error":"integrity_failed","chunk":<i>} → same UI + chunk index
//   - 409 per-chunk >128      → connection truncates mid-body (short/empty read) → same UI
//   - Range on verified       → 416 (fatal; fetch never sends Range — confirmed locked)
//   - No partial file is ever kept on any integrity failure.
//
// Honesty constraint (CLAUDE.md + Share-Master-Context §Locked):
//   NEVER say "end-to-end integrity", "proof of delivery", "verified in transit".
//   The browser surfaces ciphertext STORAGE integrity only.
//   End-to-end is the recipient's plaintext check, which is separate and unreported here.
//
// Exports:
//   enterDownloadMode(detected, domRefs, state, helpers)
//
// Fragment grammar v1 (D-1 filename fix, SW-MCP-4):
//   detected.v === 1  → { v:1, uuid, keyBytes (Uint8Array), filename, sealNonce (Uint8Array|null) }
//   detected.v === 0  → { v:0, uuid, key (hex), iv (hex|null), sn (hex|null) }  [legacy]
//
//   IV source:
//     v1: URL fragment (detected.ivBytes) — never in manifest. See Share-4.
//     v0: fragment iv param (hex) — backward compat for old links.
// ─────────────────────────────────────────────────────────────────────────────

import { loadDeps, hexToBuf, bufToHex, WORKER_URL } from './crypto.js';
import { decryptOts } from './timestamp.js';

// ─────────────────────────────────────────────────────────────────────────────
// IntegrityError — typed error thrown on any 409 or truncated-body path.
// Carries the raw chunk index from the 409 body when present (chunk field).
// ─────────────────────────────────────────────────────────────────────────────
class IntegrityError extends Error {
  constructor(chunk = null) {
    super('integrity_failed');
    this.name = 'IntegrityError';
    this.integrity = true;
    this.chunk = chunk; // null = root/sidecar failure; number = chunk i was bad
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// enterDownloadMode
// ─────────────────────────────────────────────────────────────────────────────
export async function enterDownloadMode(detected, domRefs, state, helpers) {
  const { uuid } = detected;
  const {
    dropZone, infoCard, optionsCard, receiverCard,
    rcFileName, rcFileIcon, rcFolderNote, rcSize, rcExpiry,
    rcPassphraseRow, rcDownloadBtn, unlockScreen, unlockInput,
    unlockError, unlockBtn, uspBlock, uspText,
  } = domRefs;
  const { formatBytes, reportError } = helpers;

  dropZone.classList.add('hidden');
  infoCard.classList.add('hidden');
  optionsCard.classList.add('hidden');

  await loadDeps();

  // ── Resolve AES key bytes ─────────────────────────────────────────────────
  // v1: keyBytes is already a Uint8Array from parseFragment()
  // v0: key is a hex string — convert with hexToBuf()
  const rawKeyBytes = detected.v === 1 ? detected.keyBytes : hexToBuf(detected.key);

  // ── Import AES key — IV resolved after meta fetch (v1) or from fragment (v0) ──
  state.sessionAesKey = await crypto.subtle.importKey(
    'raw', rawKeyBytes, { name: 'AES-GCM' }, false, ['decrypt'],
  );

  // ── Seal nonce — for OTS download offer ──────────────────────────────────
  // v1: detected.sealNonce is Uint8Array|null → convert to hex string for internal use
  // v0: detected.sn is already a hex string|null
  let sealNonceHex = null;
  if (detected.v === 1 && detected.sealNonce) {
    sealNonceHex = bufToHex(detected.sealNonce);
  } else if (detected.v === 0 && detected.sn) {
    sealNonceHex = detected.sn;
  }

  // Clear fragment + query from URL bar now (key is imported, no longer needed)
  history.replaceState(null, '', location.pathname);

  // Fetch metadata
  let meta = {};
  try {
    const metaRes = await fetch(`${WORKER_URL}/meta/${uuid}`);
    if (metaRes.ok) meta = await metaRes.json();
    else if (metaRes.status === 404) { _showDownloadError('Transfer not found or already expired.', domRefs); return; }
  } catch {
    _showDownloadError('Network error — could not reach server.', domRefs);
    return;
  }

  // ── Resolve IV ────────────────────────────────────────────────────────────
  // v1: IV is in the fragment (detected.ivBytes Uint8Array) — never in manifest.
  // v0: IV came from the fragment iv param (hex string) — backward compat.
  if (detected.v === 1) {
    if (!detected.ivBytes || detected.ivBytes.length === 0) {
      _showDownloadError('Link is missing IV — was this link generated before today\'s update? Please ask the sender for a new link.', domRefs);
      return;
    }
    state.sessionIv = detected.ivBytes;
  } else {
    if (!detected.iv) {
      _showDownloadError('Link is corrupt — missing IV.', domRefs);
      return;
    }
    state.sessionIv = new Uint8Array(hexToBuf(detected.iv));
  }

  // ── Filename (v1 carries real name in fragment; v0 falls back to meta) ───
  // In v1 the Worker always saw "encrypted-payload" as X-File-Name, so meta.file_name
  // is that constant placeholder. Real name comes from the fragment.
  const fileName = (detected.v === 1 && detected.filename)
    ? detected.filename
    : (meta.file_name || `refueler-${uuid.slice(0, 8)}`);

  const timestampState = meta.timestamp_state || 'none';
  const hasOts = (timestampState === 'pending' || timestampState === 'complete') && !!sealNonceHex;

  // Populate receiver card  (fileName resolved above — fragment v1 or meta fallback)
  rcFileName.textContent = fileName;

  const isZip = fileName.toLowerCase().endsWith('.zip');
  if (isZip) { rcFileIcon.textContent = '📁'; rcFolderNote.classList.remove('hidden'); }

  rcSize.textContent = meta.total_bytes ? formatBytes(meta.total_bytes) : '—';

  if (meta.expiry_timestamp) {
    const secsRemaining = Math.floor(meta.expiry_timestamp - Date.now() / 1000);
    if (secsRemaining <= 0) {
      rcExpiry.textContent = 'Expired';
      rcExpiry.style.color = 'var(--c-red)';
    } else {
      const days  = Math.floor(secsRemaining / 86400);
      const hours = Math.floor((secsRemaining % 86400) / 3600);
      if (days >= 1)       rcExpiry.textContent = `${days} day${days !== 1 ? 's' : ''} remaining`;
      else if (hours >= 1) rcExpiry.textContent = `${hours} hour${hours !== 1 ? 's' : ''} remaining`;
      else                 rcExpiry.textContent = 'Less than 1 hour';
    }
  } else {
    rcExpiry.textContent = '—';
  }

  const isPassphraseProtected = !!meta.passphrase_protected;
  if (isPassphraseProtected) rcPassphraseRow.classList.remove('hidden');

  const willSelfDestruct     = meta.pending_destruction !== null && meta.pending_destruction !== undefined;
  const availableFromUnixRx  = meta.available_from_timestamp  || null;
  const availableUntilUnixRx = meta.available_until_timestamp || null;

  receiverCard.style.display = 'flex';

  // Tidal countdown
  const nowSecs = () => Math.floor(Date.now() / 1000);
  if (availableFromUnixRx && nowSecs() < availableFromUnixRx) {
    rcDownloadBtn.disabled = true;
    const countdownEl = document.createElement('p');
    countdownEl.id = 'tidal-countdown';
    countdownEl.className = 'tidal-countdown-display muted mono small';
    rcDownloadBtn.insertAdjacentElement('afterend', countdownEl);

    function _updateCountdown() {
      const secsLeft = Math.max(0, availableFromUnixRx - nowSecs());
      if (secsLeft === 0) { rcDownloadBtn.disabled = false; countdownEl.remove(); return; }
      const h = Math.floor(secsLeft / 3600);
      const m = Math.floor((secsLeft % 3600) / 60);
      const s = secsLeft % 60;
      const parts = [];
      if (h > 0) parts.push(`${h}h`);
      if (m > 0 || h > 0) parts.push(`${m}m`);
      parts.push(`${s}s`);
      countdownEl.textContent = `Available in ${parts.join(' ')}`;
      setTimeout(_updateCountdown, 1000);
    }
    _updateCountdown();
  }

  if (availableUntilUnixRx) {
    const untilEl = document.createElement('p');
    untilEl.id = 'tidal-until-display';
    untilEl.className = 'tidal-until-display muted mono small';
    untilEl.textContent = `Available until ${_formatDatetime(availableUntilUnixRx)}`;
    rcDownloadBtn.insertAdjacentElement('afterend', untilEl);
  }

  uspText.textContent = 'No account. No email. No history. Your data. Not ours.';
  uspBlock.classList.remove('hidden');

  rcDownloadBtn.addEventListener('click', async () => {
    receiverCard.style.display = 'none';

    const _proceed = async () => {
      if (isPassphraseProtected) {
        unlockScreen.style.display = 'flex';
        unlockBtn.addEventListener('click', async () => {
          const passphrase = unlockInput.value.trim();
          if (!passphrase) return;
          unlockBtn.disabled = true;
          unlockError.textContent = '';
          try {
            const authRes = await fetch(`${WORKER_URL}/auth/${uuid}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ passphrase }),
            });
            if (!authRes.ok) {
              unlockError.textContent = authRes.status === 401 ? 'Incorrect password.' : 'Something went wrong.';
              unlockBtn.disabled = false;
              return;
            }
            const { token } = await authRes.json();
            state.downloadToken = token;
            unlockInput.value = '';
            unlockScreen.style.display = 'none';
            await _startDownloadGated(uuid, meta, fileName, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers);
          } catch {
            unlockError.textContent = 'Network error. Try again.';
            unlockBtn.disabled = false;
          }
        });
        unlockInput.addEventListener('keydown', e => { if (e.key === 'Enter') unlockBtn.click(); });
      } else {
        await _startDownloadGated(uuid, meta, fileName, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers);
      }
    };

    if (willSelfDestruct) {
      _showPreDownloadModal(() => _proceed());
    } else {
      await _proceed();
    }
  }, { once: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Download capability gate
// ─────────────────────────────────────────────────────────────────────────────
async function _startDownloadGated(uuid, meta, fileName, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers) {
  const hasFSAA = typeof showSaveFilePicker !== 'undefined';
  if (hasFSAA) {
    let fileHandle;
    try {
      fileHandle = await showSaveFilePicker({ suggestedName: fileName, types: [] });
    } catch (e) {
      if (e.name === 'AbortError') { domRefs.receiverCard.style.display = 'flex'; return; }
      helpers.reportError('fsaa_picker_error', e.message, `uuid:${uuid.slice(0,8)}`);
      await _startDownload(uuid, meta, fileName, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers);
      return;
    }
    await _startDownloadStream(uuid, meta, fileHandle, fileName, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers);
  } else {
    await _startDownload(uuid, meta, fileName, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers);
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
// _showIntegrityFailure — the honest, user-facing integrity failure state.
//
// Copy rules (honesty banner in session brief):
//   - NEVER "end-to-end integrity", "proof of delivery", "verified in transit"
//   - "Transfer failed its integrity check" — ciphertext storage integrity only
//   - No partial file was saved
// ─────────────────────────────────────────────────────────────────────────────
function _showIntegrityFailure(domRefs, reportError, uuid, chunkIdx) {
  const { downloadCard, dlStageTag, dlPct, dlBar } = domRefs;

  // Hide progress entirely — no stray percentage/bar alongside a failure state.
  dlPct.classList.add('hidden');
  dlBar.parentElement.classList.add('hidden');
  dlStageTag.textContent = 'Transfer failed';
  downloadCard.classList.remove('hidden');

  // Remove any existing error card to avoid doubling up
  const existing = document.getElementById('integrity-fail-card');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.id = 'integrity-fail-card';
  card.className = 'integrity-fail-card';

  const icon = document.createElement('div');
  icon.className = 'integrity-fail-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '⚠';

  const heading = document.createElement('p');
  heading.className = 'integrity-fail-heading';
  heading.textContent = 'This transfer did not pass its integrity check';

  const body = document.createElement('p');
  body.className = 'integrity-fail-body';
  // Honest scope: ciphertext storage integrity check, not end-to-end
  body.textContent = 'The encrypted file on the server does not match what was lodged. '
    + 'No partial file has been saved to your device. '
    + 'Contact the sender for a fresh link.';

  card.appendChild(icon);
  card.appendChild(heading);
  card.appendChild(body);

  // Insert after the download card heading area
  downloadCard.appendChild(card);

  // Log for ops visibility — fire-and-forget
  const detail = chunkIdx !== null ? `chunk:${chunkIdx}` : 'root_or_sidecar';
  try {
    reportError('integrity_check_failed', 'ciphertext_storage_integrity', `uuid:${uuid.slice(0,8)} ${detail}`);
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// FSAA streaming download — Share-6-5b changes:
//   1. fetchChunkWithRetry detects 409 → throws IntegrityError (never retried)
//   2. No Range header ever sent — confirmed and locked; fetch uses the full URL only
//   3. Truncated-body guard: if buf.byteLength === 0 on a chunk that should have bytes → IntegrityError
//   4. Catch block handles IntegrityError → _showIntegrityFailure, abort writable, no partial file
//   5. X-Integrity header read silently on first chunk; no UX change
//   6. Legacy 200 (no X-Integrity) → identical path, silent pass-through
// ─────────────────────────────────────────────────────────────────────────────
async function _startDownloadStream(uuid, meta, fileHandle, fileName, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers) {
  const { downloadCard, dlStageTag, dlPct, dlBar, dlSignoff, uspBlock } = domRefs;
  const { reportError } = helpers;
  const totalChunks = meta.total_chunks;

  if (!totalChunks || totalChunks < 1) { _showDownloadError('Transfer metadata is incomplete. Please try again.', domRefs); return; }

  downloadCard.classList.remove('hidden');
  dlPct.classList.remove('hidden');
  dlBar.parentElement.classList.remove('hidden');
  dlStageTag.textContent = 'Downloading';
  dlPct.textContent = '0%';
  dlBar.style.width = '0%';

  let writable;
  try {
    writable = await fileHandle.createWritable();
  } catch {
    _showDownloadError('Could not open the save location. Please try again.', domRefs);
    return;
  }

  // ── fetchChunkWithRetry (FSAA path) ────────────────────────────────────────
  // 6-5b invariant: NO Range header ever sent on any chunk request.
  // 409 → IntegrityError (not retried). 416 would mean we somehow sent Range — should never occur.
  // Truncated read (byteLength === 0 on a non-empty transfer) → IntegrityError (>128-chunk path).
  async function fetchChunkWithRetry(chunkIdx) {
    const padded  = String(chunkIdx).padStart(4, '0');
    // Auth header only — never a Range header (locked 6-5b).
    const headers = {};
    if (state.downloadToken) headers['Authorization'] = `Bearer ${state.downloadToken}`;

    const RETRYABLE_DELAYS = [1000, 2000, 4000];
    let lastErr;
    for (let attempt = 0; attempt <= RETRYABLE_DELAYS.length; attempt++) {
      try {
        const res = await fetch(`${WORKER_URL}/download/${uuid}/${padded}`, { headers });

        // ── Fatal non-retry statuses ─────────────────────────────────────────
        if (res.status === 400 || res.status === 401 || res.status === 410) {
          const err = new Error(`HTTP ${res.status}`); err.fatal = true; err.status = res.status; throw err;
        }

        // ── 409 integrity failure (≤128 path: clean JSON body) ──────────────
        // 409 is never retried — it is a definitive integrity verdict.
        if (res.status === 409) {
          const chunkBad = await _parse409Body(res);
          throw new IntegrityError(chunkBad);
        }

        // ── 416 would mean a Range header was sent — should be impossible ───
        if (res.status === 416) {
          const err = new Error('HTTP 416 — unexpected Range response on verified path');
          err.fatal = true; err.status = 416; throw err;
        }

        if (res.ok) {
          const buf = await res.arrayBuffer();

          // ── Truncated-body guard (>128 path) ───────────────────────────────
          // If the connection was cut mid-body, the Worker never sent 409.
          // byteLength === 0 on chunk 0 is a legitimate empty file edge case, but
          // chunk_count ≥ 1 guarantees chunk 0 is non-empty (AES-GCM tag alone = 16 B).
          if (buf.byteLength === 0) {
            throw new IntegrityError(chunkIdx);
          }

          return buf;
        }

        lastErr = new Error(`HTTP ${res.status}`);
      } catch (e) {
        if (e instanceof IntegrityError) throw e; // never retry integrity failures
        if (e.fatal) throw e;
        lastErr = e;
      }
      if (attempt < RETRYABLE_DELAYS.length) await new Promise(r => setTimeout(r, RETRYABLE_DELAYS[attempt]));
    }
    const err = new Error(lastErr?.message || 'Network error'); err.retryExhausted = true; throw err;
  }

  try {
    let nextChunkPromise = fetchChunkWithRetry(0);
    for (let i = 0; i < totalChunks; i++) {
      const ciphertextBuf = await nextChunkPromise;
      if (i + 1 < totalChunks) nextChunkPromise = fetchChunkWithRetry(i + 1);

      const aad = new Uint8Array(4);
      new DataView(aad.buffer).setUint32(0, i, false);
      let plaintext;
      try {
        plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: state.sessionIv, additionalData: aad }, state.sessionAesKey, ciphertextBuf);
      } catch (e) {
        reportError('decrypt', e.message, `uuid:${uuid.slice(0,8)} chunk:${i}`);
        await writable.abort();
        _showDownloadError('Decryption failed — wrong key or corrupted data. No partial file was saved.', domRefs);
        return;
      }
      await writable.write(new Uint8Array(plaintext));
      const pct = Math.round(((i + 1) / totalChunks) * 100);
      dlBar.style.width = pct + '%';
      dlPct.textContent = pct + '%';
    }

    await writable.close();
    dlStageTag.textContent = 'Complete';
    dlBar.style.width = '100%';
    dlPct.textContent = '100%';
    uspBlock.classList.add('hidden');

    if (hasOts) await _offerOtsDownload(uuid, sealNonceHex, state, domRefs, reportError);

    dlSignoff.classList.remove('hidden');
    try { _logReceiverEvent('receiver_ab_downloaded', sessionStorage.getItem('rs-usp-variant') || 'unknown'); } catch {}
    if (willSelfDestruct) _showConfirmGate(uuid, !!state.downloadToken, domRefs, state);

  } catch (e) {
    try { await writable.abort(); } catch {}

    // ── IntegrityError — the 409 and truncated-body paths ───────────────────
    if (e instanceof IntegrityError) {
      reportError('integrity_check_failed', 'ciphertext_storage_integrity', `uuid:${uuid.slice(0,8)}`);
      _showIntegrityFailure(domRefs, reportError, uuid, e.chunk);
      return;
    }

    reportError('download_chunk_retry_exhausted', e.message || 'unknown', `uuid:${uuid.slice(0,8)}`);
    if (e.status === 401)       _showDownloadError('Access denied. This transfer may have expired or the link is incorrect.', domRefs);
    else if (e.status === 410)  _showDownloadError('This transfer has expired. The file is no longer available.', domRefs);
    else if (e.retryExhausted)  _showDownloadError('Download failed after several attempts. Check your connection and try again.', domRefs);
    else                        _showDownloadError('Download failed. Please try again.', domRefs);
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
async function _startDownload(uuid, meta, fileName, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers) {
  const { downloadCard, dlStageTag, dlPct, dlBar, dlSignoff, uspBlock } = domRefs;
  const { formatBytes, reportError } = helpers;
  const totalChunks = meta?.total_chunks;

  if (!totalChunks || totalChunks < 1) { _showDownloadError('Transfer metadata is incomplete. Please try again.', domRefs); return; }

  downloadCard.classList.remove('hidden');
  dlPct.classList.remove('hidden');
  dlBar.parentElement.classList.remove('hidden');
  dlStageTag.textContent = 'Downloading';
  dlPct.textContent = '0%';
  dlBar.style.width = '0%';

  const totalBytes = (meta.total_bytes && meta.total_bytes > 0) ? meta.total_bytes : 0;
  const chunks = [];
  let bytesReceived = 0;

  for (let i = 0; i < totalChunks; i++) {
    // Auth header only — never a Range header (locked 6-5b).
    const headers = {};
    if (state.downloadToken) headers['Authorization'] = `Bearer ${state.downloadToken}`;
    const padded = String(i).padStart(4, '0');
    const res = await fetch(`${WORKER_URL}/download/${uuid}/${padded}`, { headers });

    // ── 409 integrity failure ────────────────────────────────────────────────
    // 409 is a definitive verdict — parse body for chunk index, then bail.
    // No partial file is kept (chunks array is discarded, never assembled).
    if (res.status === 409) {
      const chunkBad = await _parse409Body(res);
      reportError('integrity_check_failed', 'ciphertext_storage_integrity', `uuid:${uuid.slice(0,8)}`);
      _showIntegrityFailure(domRefs, reportError, uuid, chunkBad);
      return;
    }

    if (res.status === 401 || res.status === 410) {
      _showDownloadError(res.status === 401
        ? 'Access denied. This transfer may have expired or the link is incorrect.'
        : 'This transfer has expired. The file is no longer available.', domRefs);
      return;
    }
    if (!res.ok) {
      reportError('download_chunk', `HTTP ${res.status} chunk ${i}`, `uuid:${uuid.slice(0,8)}`);
      _showDownloadError(`Download failed (${res.status}). Please try again.`, domRefs);
      return;
    }

    const buf = await res.arrayBuffer();

    // ── Truncated-body guard (>128 path — connection cut mid-body, no 409) ──
    // AES-GCM tag alone is 16 B, so any real chunk is > 0 bytes.
    if (buf.byteLength === 0) {
      reportError('integrity_check_failed', 'truncated_body', `uuid:${uuid.slice(0,8)} chunk:${i}`);
      _showIntegrityFailure(domRefs, reportError, uuid, i);
      return;
    }

    chunks.push(buf);
    bytesReceived += buf.byteLength;
    const pct = totalBytes > 0
      ? Math.min(Math.round((bytesReceived / totalBytes) * 50), 50)
      : Math.round(((i + 1) / totalChunks) * 50);
    dlBar.style.width = pct + '%';
    dlPct.textContent = pct + '%';
  }

  dlStageTag.textContent = 'Decrypting';
  const decrypted = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const aad = new Uint8Array(4);
      new DataView(aad.buffer).setUint32(0, i, false);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: state.sessionIv, additionalData: aad }, state.sessionAesKey, chunks[i]);
      decrypted.push(plain);
    } catch (e) {
      reportError('decrypt', e.message, `uuid:${uuid.slice(0,8)} chunk:${i}`);
      _showDownloadError('Decryption failed — wrong key or corrupted data.', domRefs);
      return;
    }
    const pct = 50 + Math.round(((i + 1) / chunks.length) * 50);
    dlBar.style.width = pct + '%';
    dlPct.textContent = pct + '%';
  }

  const blob    = new Blob(decrypted, { type: 'application/octet-stream' });
  const blobUrl = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href = blobUrl; a.download = fileName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

  dlStageTag.textContent = 'Complete';
  dlBar.style.width = '100%';
  dlPct.textContent = '100%';
  uspBlock.classList.add('hidden');

  if (hasOts) await _offerOtsDownload(uuid, sealNonceHex, state, domRefs, reportError);

  dlSignoff.classList.remove('hidden');
  try { _logReceiverEvent('receiver_ab_downloaded', sessionStorage.getItem('rs-usp-variant') || 'unknown'); } catch {}
  if (willSelfDestruct) _showConfirmGate(uuid, !!state.downloadToken, domRefs, state);
}

// ─────────────────────────────────────────────────────────────────────────────
// TH-2: OTS download offer
// ─────────────────────────────────────────────────────────────────────────────
async function _offerOtsDownload(uuid, sealNonceHex, state, domRefs, reportError) {
  if (!uuid || !sealNonceHex || !state.sessionAesKey) return;

  let otsBytes;
  try {
    const res = await fetch(`${WORKER_URL}/timestamp/seal/${uuid}`);
    if (!res.ok) { reportError('ots_fetch', `HTTP ${res.status}`, `uuid:${uuid.slice(0,8)}`); return; }
    const raw  = await res.arrayBuffer();
    otsBytes   = await decryptOts(new Uint8Array(raw), state.sessionAesKey);
  } catch (e) {
    reportError('ots_decrypt', e.message, `uuid:${uuid.slice(0,8)}`);
    return;
  }

  const otsWrap = document.createElement('div');
  otsWrap.className = 'ots-download-wrap mt8';

  const otsBtn = document.createElement('button');
  otsBtn.type = 'button';
  otsBtn.className = 'btn btn-secondary btn-small';
  otsBtn.textContent = '⬇ date-seal.ots';
  otsBtn.title = 'Download the Bitcoin-anchored date stamp for this transfer';
  otsBtn.addEventListener('click', () => {
    const otsBlob = new Blob([otsBytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(otsBlob);
    const a = document.createElement('a');
    a.href = url; a.download = 'date-seal.ots';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  otsWrap.appendChild(otsBtn);

  const otsNote = document.createElement('p');
  otsNote.className = 'muted small mt4';
  otsNote.textContent = 'Verify with opentimestamps.org — proves when this file existed, not who sent it.';
  otsWrap.appendChild(otsNote);

  domRefs.dlSignoff.insertAdjacentElement('beforebegin', otsWrap);
}

// ─────────────────────────────────────────────────────────────────────────────
// TG receiver helpers
// ─────────────────────────────────────────────────────────────────────────────
function _formatDatetime(unixSecs) {
  const d = new Date(unixSecs * 1000);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function _showPreDownloadModal(onConfirm) {
  const overlay = document.createElement('div');
  overlay.id = 'pre-dl-modal';
  overlay.className = 'pre-dl-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Download warning');
  overlay.innerHTML = `
    <div class="pre-dl-modal-card">
      <div class="pre-dl-modal-icon" aria-hidden="true">⚠️</div>
      <p class="pre-dl-modal-heading">This transfer will be permanently deleted</p>
      <p class="pre-dl-modal-body">Once you confirm you have saved the file, it will be removed from Refueler's servers. Make sure you have a safe place to save it before you continue.</p>
      <button id="pre-dl-modal-btn" class="btn btn-primary btn-full">I understand — download</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('pre-dl-modal-btn').addEventListener('click', () => { overlay.remove(); onConfirm(); }, { once: true });
}

async function _showConfirmGate(uuid, isPassphrase, domRefs, state) {
  const { dlSignoff } = domRefs;
  const gate = document.createElement('div');
  gate.id = 'dl-confirm-gate';
  gate.className = 'dl-confirm-gate';
  gate.innerHTML = `
    <p class="dl-confirm-question">Have you saved the file?</p>
    <button id="dl-confirm-btn" class="btn btn-primary">I've saved it — delete this transfer</button>
    <p id="dl-confirm-status" class="dl-confirm-status hidden"></p>`;
  dlSignoff.insertAdjacentElement('beforebegin', gate);

  document.getElementById('dl-confirm-btn').addEventListener('click', async () => {
    const btn    = document.getElementById('dl-confirm-btn');
    const status = document.getElementById('dl-confirm-status');
    btn.disabled = true;
    try {
      let res;
      if (isPassphrase) {
        res = await fetch(`${WORKER_URL}/transfer/${uuid}`, {
          method: 'DELETE',
          headers: state.downloadToken ? { 'Authorization': `Bearer ${state.downloadToken}` } : {},
        });
      } else {
        res = await fetch(`${WORKER_URL}/confirm/${uuid}`, { method: 'POST' });
      }
      if (res.ok) {
        gate.classList.add('dl-confirm-gate--done');
        btn.remove();
        status.textContent = 'Transfer permanently deleted.';
        status.classList.remove('hidden');
        status.classList.add('dl-confirm-status--success');
      } else { throw new Error(`HTTP ${res.status}`); }
    } catch {
      btn.disabled = false;
      const status2 = document.getElementById('dl-confirm-status');
      status2.textContent = 'Could not confirm deletion — the transfer will expire naturally.';
      status2.classList.remove('hidden');
      status2.classList.add('dl-confirm-status--error');
    }
  }, { once: true });
}

function _showDownloadError(msg, domRefs) {
  const { downloadCard, dlStageTag, dlPct, dlBar } = domRefs;
  downloadCard.classList.remove('hidden');
  dlStageTag.textContent = `Error — ${msg}`;
  // Hide progress entirely on error (DAD-ERROR-TEXT, Share-B10-3) — no stray "0%".
  // #dl-pct is a sibling span in the same flex-row as #dl-stage-tag; #dl-bar's
  // parent (.progress-bar-wrap) is the separate row underneath. Hiding both
  // matches the pattern _showIntegrityFailure now also uses.
  dlPct.classList.add('hidden');
  dlBar.parentElement.classList.add('hidden');
}

function _logReceiverEvent(event, variant) {
  try {
    fetch(`${WORKER_URL}/log/error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: 'receiver_ab', message: String(event).slice(0, 64), detail: `variant:${variant}`, ts: Date.now() }),
    }).catch(() => {});
  } catch {}
}
