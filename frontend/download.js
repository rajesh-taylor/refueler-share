// ── frontend/download.js — download state machine ────────────────────────────
// Extracted from share.js at Share-JS-Refactor session (TH-block).
// No behaviour change from TH-2 share.js — pure structural split.
//
// Exports:
//   enterDownloadMode(fragment, domRefs, state, helpers)
// ─────────────────────────────────────────────────────────────────────────────

import { loadDeps, hexToBuf, bufToHex, WORKER_URL } from './crypto.js';
import { decryptOts } from './timestamp.js';

// ─────────────────────────────────────────────────────────────────────────────
// enterDownloadMode
// ─────────────────────────────────────────────────────────────────────────────
export async function enterDownloadMode({ uuid, key, iv, sn }, domRefs, state, helpers) {
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

  const keyBytes = hexToBuf(key);
  const ivBytes  = hexToBuf(iv);
  state.sessionAesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  state.sessionIv     = new Uint8Array(ivBytes);
  history.replaceState(null, '', location.pathname);

  // TH-2: sn = seal_nonce from fragment
  const sealNonceHex = sn || null;

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

  const timestampState = meta.timestamp_state || 'none';
  const hasOts = (timestampState === 'pending' || timestampState === 'complete') && !!sealNonceHex;

  // Populate receiver card
  const fileName = meta.file_name || `refueler-${uuid.slice(0, 8)}`;
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

  const willSelfDestruct     = !!meta.pending_destruction;
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
            await _startDownloadGated(uuid, meta, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers);
          } catch {
            unlockError.textContent = 'Network error. Try again.';
            unlockBtn.disabled = false;
          }
        });
        unlockInput.addEventListener('keydown', e => { if (e.key === 'Enter') unlockBtn.click(); });
      } else {
        await _startDownloadGated(uuid, meta, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers);
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
async function _startDownloadGated(uuid, meta, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers) {
  const hasFSAA = typeof showSaveFilePicker !== 'undefined';
  if (hasFSAA) {
    const fileName = meta.file_name || `refueler-${uuid.slice(0, 8)}`;
    let fileHandle;
    try {
      fileHandle = await showSaveFilePicker({ suggestedName: fileName, types: [] });
    } catch (e) {
      if (e.name === 'AbortError') { domRefs.receiverCard.style.display = 'flex'; return; }
      helpers.reportError('fsaa_picker_error', e.message, `uuid:${uuid.slice(0,8)}`);
      await _startDownload(uuid, meta, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers);
      return;
    }
    await _startDownloadStream(uuid, meta, fileHandle, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers);
  } else {
    await _startDownload(uuid, meta, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FSAA streaming download
// ─────────────────────────────────────────────────────────────────────────────
async function _startDownloadStream(uuid, meta, fileHandle, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers) {
  const { downloadCard, dlStageTag, dlPct, dlBar, dlSignoff, uspBlock } = domRefs;
  const { reportError } = helpers;
  const totalChunks = meta.total_chunks;

  if (!totalChunks || totalChunks < 1) { _showDownloadError('Transfer metadata is incomplete. Please try again.', domRefs); return; }

  downloadCard.classList.remove('hidden');
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

  async function fetchChunkWithRetry(chunkIdx) {
    const padded  = String(chunkIdx).padStart(4, '0');
    const headers = {};
    if (state.downloadToken) headers['Authorization'] = `Bearer ${state.downloadToken}`;
    const RETRYABLE_DELAYS = [1000, 2000, 4000];
    let lastErr;
    for (let attempt = 0; attempt <= RETRYABLE_DELAYS.length; attempt++) {
      try {
        const res = await fetch(`${WORKER_URL}/download/${uuid}/${padded}`, { headers });
        if (res.status === 400 || res.status === 401 || res.status === 410) {
          const err = new Error(`HTTP ${res.status}`); err.fatal = true; err.status = res.status; throw err;
        }
        if (res.ok) return await res.arrayBuffer();
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (e) {
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
        reportError('decrypt', e.message, `uuid:${uuid.slice(0,8)} chunk:${i}`).catch(() => {});
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
    reportError('download_chunk_retry_exhausted', e.message || 'unknown', `uuid:${uuid.slice(0,8)}`).catch(() => {});
    try { await writable.abort(); } catch {}
    if (e.status === 401)       _showDownloadError('Access denied. This transfer may have expired or the link is incorrect.', domRefs);
    else if (e.status === 410)  _showDownloadError('This transfer has expired. The file is no longer available.', domRefs);
    else if (e.retryExhausted)  _showDownloadError('Download failed after several attempts. Check your connection and try again.', domRefs);
    else                        _showDownloadError('Download failed. Please try again.', domRefs);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Blob fallback download
// ─────────────────────────────────────────────────────────────────────────────
async function _startDownload(uuid, meta, willSelfDestruct, hasOts, sealNonceHex, domRefs, state, helpers) {
  const { downloadCard, dlStageTag, dlPct, dlBar, dlSignoff, uspBlock } = domRefs;
  const { formatBytes, reportError } = helpers;
  const totalChunks = meta?.total_chunks;

  if (!totalChunks || totalChunks < 1) { _showDownloadError('Transfer metadata is incomplete. Please try again.', domRefs); return; }

  downloadCard.classList.remove('hidden');
  dlStageTag.textContent = 'Downloading';
  dlPct.textContent = '0%';
  dlBar.style.width = '0%';

  const totalBytes = (meta.total_bytes && meta.total_bytes > 0) ? meta.total_bytes : 0;
  const fileName   = meta?.file_name || `refueler-${uuid.slice(0, 8)}`;
  const chunks = [];
  let bytesReceived = 0;

  for (let i = 0; i < totalChunks; i++) {
    const headers = {};
    if (state.downloadToken) headers['Authorization'] = `Bearer ${state.downloadToken}`;
    const padded = String(i).padStart(4, '0');
    const res = await fetch(`${WORKER_URL}/download/${uuid}/${padded}`, { headers });

    if (res.status === 401 || res.status === 410) {
      _showDownloadError(res.status === 401
        ? 'Access denied. This transfer may have expired or the link is incorrect.'
        : 'This transfer has expired. The file is no longer available.', domRefs);
      return;
    }
    if (!res.ok) {
      reportError('download_chunk', `HTTP ${res.status} chunk ${i}`, `uuid:${uuid.slice(0,8)}`).catch(() => {});
      _showDownloadError(`Download failed (${res.status}). Please try again.`, domRefs);
      return;
    }

    const buf = await res.arrayBuffer();
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
      reportError('decrypt', e.message, `uuid:${uuid.slice(0,8)} chunk:${i}`).catch(() => {});
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
  domRefs.downloadCard.classList.remove('hidden');
  domRefs.dlStageTag.textContent = `Error — ${msg}`;
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
