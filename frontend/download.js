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
// Split by job at Share-JS-Split-2 (9 Oct 2026), no behaviour change:
//   download-fetch.js  parts in order, retries, decrypt   download-save.js   stream or blob, finish
//   download-sheets.js one sheet at a time, progress bar  download-time.js   dates and countdowns
//   download-notes.js  the Notes card
//
// Exports:
//   enterDownloadMode(detected, domRefs, state, helpers)
//
// Link formats (detectMode in share.js; grammar in fragment.js):
//   detected.v === 2  → { v:2, uuid, keyBytes (K), filename, sealNonce, sizeBytes (z, required) }
//   detected.v === 1  → { v:1, uuid, keyBytes, ivBytes, filename, sealNonce, sizeBytes|null }
//   detected.v === 0  → { v:0, uuid, key (hex), iv (hex|null), sn (hex|null) }  [legacy]
//
//   Decrypting parts (_decryptPart):
//     v2: part key derived from K, per-part nonce with a last-part flag
//         (crypto.js decryptPart). Before any download request the receiver checks
//         ceil(z / CHUNK_SIZE) == /meta total_chunks; while writing, every part but
//         the last must be exactly CHUNK_SIZE and the total must equal z.
//     v1: K directly + the IV from the URL fragment (detected.ivBytes).
//     v0: K directly + the fragment iv param (hex) — backward compat for old links.
//
// Share-Receiver-2a (docs/Share-Receiver-1-build-list.md N-2a, items 1–9):
//   One sheet at a time (src/index.njk): #receiver-card → #unlock-screen →
//   #download-card → #rx-done, or #rx-notice (window closed / dead link / stopped).
//   Copy is the build list's, word for word. "Password", never "passphrase" (R-7).
//
// Share-Receiver-2b (N-2b, items 10–12, 14):
//   No date seal for recipients (R-9, finding F-1): a recipient can't check it today.
//   The seal nonce may still be in the link fragment; this page ignores it.
//   Each sheet settles in the first time it appears (item 14); the downloading sheet never does.
// ─────────────────────────────────────────────────────────────────────────────

// Share-Deps-1: no loadDeps() here. Receiving needs neither BLAKE3 nor secp256k1,
// so the card never waits on them (and never fails on a browser without WASM, F-20).
import { hexToBuf, derivePartKey } from './crypto.js';
import { WORKER_URL, CHUNK_SIZE } from './config.js';
import { DECRYPT_FAILED_FSAA, _resolveSize } from './download-fetch.js';
import { _startDownloadStream, _startDownload } from './download-save.js';
import { $, _showSheet, _showNotice, _showWindowClosed, _setUnlockError, _showPreDownloadModal,
         _renderHiddenFileName, _showLinkInactive, _showDownloadError } from './download-sheets.js';
import { _at, _fmtTime, _fmtDateTime, _sameDay, _countdown, _untilOpen } from './download-time.js';

// ─────────────────────────────────────────────────────────────────────────────
// enterDownloadMode
// ─────────────────────────────────────────────────────────────────────────────
// Share-Deps-1 (E): an unexpected throw while setting up the page used to leave it
// blank (share.js doesn't await this). Say so plainly instead. Full error design: Upload-2.
export async function enterDownloadMode(detected, domRefs, state, helpers) {
  try {
    await _enterDownloadMode(detected, domRefs, state, helpers);
  } catch (e) {
    try { helpers.reportError('receiver_setup', e?.name || 'Error', String(e?.message || '').slice(0, 120)); } catch {}
    _showNotice('Stopped', 'Share couldn’t start in this browser.',
      'Reload to try again, or use another browser.');
  }
}

async function _enterDownloadMode(detected, domRefs, state, helpers) {
  const { uuid } = detected;
  const {
    receiverCard,
    rcFileName, rcFolderNote, rcSize, rcExpiry,
    rcPassphraseRow, rcDownloadBtn, unlockInput,
    unlockError, unlockBtn, uspText,
  } = domRefs;
  const { formatBytes } = helpers;

  // Receiver mode (R-14): share.css hides the site nav links, the Share sub-menu
  // and the upload sheet. Wordmark and theme pill stay.
  document.documentElement.classList.add('rx-mode');

  // ── Resolve key bytes ─────────────────────────────────────────────────────
  // v2/v1: keyBytes is already a Uint8Array from parseFragment()
  // v0: key is a hex string — convert with hexToBuf()
  const isV2        = detected.v === 2;
  const rawKeyBytes = detected.v >= 1 ? detected.keyBytes : hexToBuf(detected.key);
  state.linkVersion = isV2 ? 2 : detected.v;

  // ── The key that opens parts — v2: derived part key; v1/v0: K itself (IV below) ──
  state.sessionAesKey = isV2
    ? await derivePartKey(rawKeyBytes, ['decrypt'])
    : await crypto.subtle.importKey('raw', rawKeyBytes, { name: 'AES-GCM' }, false, ['decrypt']);

  // Clear fragment + query from URL bar now (key is imported, no longer needed)
  history.replaceState(null, '', location.pathname);

  // Fetch metadata
  // Safari-Slow-Link-1: share-early.js asked already; a failed early ask is asked again.
  let meta = {};
  try {
    const early   = window.__rfsMeta;
    delete window.__rfsMeta;
    const metaRes = (early && early.uuid === uuid && await early.res) || await fetch(`${WORKER_URL}/meta/${uuid}`);
    if (metaRes.ok) meta = await metaRes.json();
    else if (metaRes.status === 404 || metaRes.status === 410) { _showLinkInactive(domRefs); return; }
  } catch {
    _showDownloadError('Network error — could not reach server.', domRefs);
    return;
  }

  // Dead link (Share-DAD-2) — one page, no filename/size/expiry:
  //   - 410 from /meta: deleted transfer (Worker ≥ Share-DAD-2)
  //   - tombstone { consumed, consumed_at } on older Workers: /meta answers 200, every field null
  //   - expiry passed: downloads already 410, so don't offer one
  // Never keyed on total_bytes: /meta stops serving it (Share-Size-1).
  const tombstoned = meta.total_chunks == null && meta.expiry_timestamp == null;
  const expired    = !!meta.expiry_timestamp && meta.expiry_timestamp <= Date.now() / 1000;
  if (tombstoned || expired) {
    _showLinkInactive(domRefs);
    return;
  }

  // ── v2: the stored part count must match the link's size, before any download ──
  if (isV2 && meta.total_chunks !== Math.ceil(detected.sizeBytes / CHUNK_SIZE)) {
    helpers.reportError('part_count', `link ${Math.ceil(detected.sizeBytes / CHUNK_SIZE)} meta ${meta.total_chunks}`, `uuid:${uuid.slice(0,8)}`);
    _showDownloadError(DECRYPT_FAILED_FSAA, domRefs);
    return;
  }

  // ── Size (Share-Size-1) ───────────────────────────────────────────────────
  // The exact size travels in the fragment (z). /meta's total_bytes is only a
  // fallback for links made before Share-Size-1. Everything below reads
  // meta.total_bytes, so resolve it once here; 0 = unknown (chunk-based progress).
  meta.total_bytes = _resolveSize(detected.sizeBytes, meta);

  // ── Resolve IV (links before v2 only; v2 needs none) ───────────────────────
  // v1: IV is in the fragment (detected.ivBytes Uint8Array) — never in manifest.
  // v0: IV came from the fragment iv param (hex string) — backward compat.
  if (isV2) {
    state.sessionIv = null;
  } else if (detected.v === 1) {
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

  // ── Filename (v2/v1 carry the real name in the fragment; v0 falls back to meta) ──
  // In v2/v1 the Worker always saw "encrypted-payload" as X-File-Name, so meta.file_name
  // is that constant placeholder. Real name comes from the fragment.
  const fileName = (detected.v >= 1 && detected.filename)
    ? detected.filename
    : (meta.file_name || `refueler-${uuid.slice(0, 8)}`);

  const isZip                 = fileName.toLowerCase().endsWith('.zip');
  const isPassphraseProtected = !!meta.passphrase_protected;
  const willSelfDestruct      = meta.pending_destruction !== null && meta.pending_destruction !== undefined;
  const expiryTs = meta.expiry_timestamp          || null;
  const fromTs   = meta.available_from_timestamp  || null;   // paid tiers only (manifest_tg.js)
  const untilTs  = meta.available_until_timestamp || null;
  // Last moment a download is allowed: the sender's window or the transfer's expiry, whichever is first.
  const closeTs  = (untilTs && expiryTs) ? Math.min(untilTs, expiryTs) : (untilTs || expiryTs);
  const nowSecs  = () => Math.floor(Date.now() / 1000);

  // Timed window already closed (item 7): say so on arrival — no name, no size.
  if (untilTs && nowSecs() >= untilTs) { _showWindowClosed(untilTs); return; }

  // Folder (item 5). Folders are zipped in the sender's browser; the Worker never learns the type.
  if (isZip) {
    $('rc-eyebrow').textContent         = 'A folder for you';
    $('rc-head').textContent            = 'Someone sent you a folder.';
    $('rc-name-label').textContent      = 'Folder';
    $('rx-done-name-label').textContent = 'Folder';
    rcFolderNote.hidden = false;
  }

  // Share-DAD-2: name hidden until the recipient asks — glancing eyes on a screen
  // see "Encrypted file". The saved file still gets its real name.
  const hiddenLabel = isZip ? 'Encrypted folder' : 'Encrypted file';
  _renderHiddenFileName(rcFileName, fileName, hiddenLabel);
  _renderHiddenFileName($('rx-done-name'), fileName, hiddenLabel);

  const sizeText = meta.total_bytes ? formatBytes(meta.total_bytes) : '—';
  rcSize.textContent            = sizeText;
  $('rx-done-size').textContent = sizeText;

  if (isPassphraseProtected) rcPassphraseRow.hidden = false;

  // ── Card state: ready, or timed window not yet open (items 2, 3, 6) ───────
  // phase: card → (unlock) → download. The clock only changes the page before a download starts.
  let phase = 'card';

  function renderCard() {
    const now     = nowSecs();
    const waiting = !!fromTs && now < fromTs;
    $('rc-until-row').hidden  = waiting;
    $('rc-opens-row').hidden  = !waiting;
    $('rc-closes-row').hidden = !waiting;
    if (waiting) {
      $('rc-opens').textContent       = _fmtDateTime(fromTs);
      $('rc-opens-count').textContent = _untilOpen(fromTs - now);
      $('rc-closes').textContent      = closeTs ? _fmtDateTime(closeTs) : '—';
      rcDownloadBtn.disabled    = true;
      rcDownloadBtn.textContent = 'Download from ' + (_sameDay(fromTs) ? _fmtTime(fromTs) : _fmtDateTime(fromTs));
      uspText.textContent       = 'The sender chose when this file can be downloaded. This page unlocks by itself.';
    } else {
      rcExpiry.textContent               = closeTs ? _fmtDateTime(closeTs) : '—';
      $('rc-expiry-count').textContent   = closeTs ? _countdown(closeTs - now) : '';
      rcDownloadBtn.disabled    = false;
      rcDownloadBtn.textContent = 'Download';
      uspText.textContent       = 'No account or email needed.';
    }
  }

  // Recompute on open, every minute, when the tab comes back, and at the exact
  // moments the window opens or closes (R-5: today's code worked it out once).
  function tick() {
    if (phase !== 'card' && phase !== 'unlock') return;
    const now = nowSecs();
    if (expiryTs && now >= expiryTs) { phase = 'ended'; _showLinkInactive(domRefs); return; }
    if (untilTs && now >= untilTs)   { phase = 'ended'; _showWindowClosed(untilTs); return; }
    if (phase === 'card') renderCard();
  }
  renderCard();
  _showSheet('receiver-card');
  setInterval(tick, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  if (fromTs && nowSecs() < fromTs) _at(fromTs, tick);
  if (closeTs) _at(closeTs, tick);

  // ── Download ──────────────────────────────────────────────────────────────
  const startDownload = async () => {
    phase = 'download';
    let outcome;
    try {
      outcome = await _startDownloadGated(uuid, meta, fileName, willSelfDestruct, domRefs, state, helpers);
    } catch (e) {
      helpers.reportError('download_unhandled', e?.message || 'unknown', `uuid:${uuid.slice(0,8)}`);
      _showDownloadError('Download failed. Please try again.', domRefs);
      return;
    }
    // Save dialog cancelled: back to the card, button still live (it used to go dead).
    if (outcome === 'cancelled') { phase = 'card'; renderCard(); _showSheet('receiver-card'); tick(); }
  };

  // ── Password (item 4, R-8) ────────────────────────────────────────────────
  const tryUnlock = async () => {
    const passphrase = unlockInput.value.trim();
    if (!passphrase || unlockBtn.disabled) return;
    unlockBtn.disabled = true;
    _setUnlockError(unlockInput, unlockError, '', false);
    let authRes;
    try {
      authRes = await fetch(`${WORKER_URL}/auth/${uuid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      if (!authRes.ok) {
        _setUnlockError(unlockInput, unlockError,
          authRes.status === 401 ? 'Incorrect password.' : 'Something went wrong.',
          authRes.status === 401);
        unlockBtn.disabled = false;
        return;
      }
      const { token } = await authRes.json();
      state.downloadToken = token;
    } catch {
      _setUnlockError(unlockInput, unlockError, 'Network error. Try again.', false);
      unlockBtn.disabled = false;
      return;
    }
    unlockInput.value  = '';
    unlockBtn.disabled = false;
    await startDownload();
  };
  unlockBtn.addEventListener('click', tryUnlock);
  unlockInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });

  let busy = false;
  rcDownloadBtn.addEventListener('click', async () => {
    if (busy || rcDownloadBtn.disabled || phase !== 'card') return;
    busy = true;
    try {
      if (willSelfDestruct) {
        // "Download / Not now" dialog stays until Share-DL-W1 (build item 13).
        receiverCard.hidden = true;
        const go = await new Promise(resolve => _showPreDownloadModal(() => resolve(true), () => resolve(false)));
        if (!go) { if (phase === 'card') receiverCard.hidden = false; return; }
      }
      if (isPassphraseProtected && !state.downloadToken) {
        phase = 'unlock';
        _showSheet('unlock-screen');
        unlockInput.focus();
        return;
      }
      await startDownload();
    } finally {
      busy = false;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Download capability gate. Returns 'cancelled' if the recipient closed the save dialog.
// ─────────────────────────────────────────────────────────────────────────────
async function _startDownloadGated(uuid, meta, fileName, willSelfDestruct, domRefs, state, helpers) {
  const hasFSAA = typeof showSaveFilePicker !== 'undefined';
  if (hasFSAA) {
    let fileHandle;
    try {
      fileHandle = await showSaveFilePicker({ suggestedName: fileName, types: [] });
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      helpers.reportError('fsaa_picker_error', e.message, `uuid:${uuid.slice(0,8)}`);
      await _startDownload(uuid, meta, fileName, willSelfDestruct, domRefs, state, helpers);
      return;
    }
    await _startDownloadStream(uuid, meta, fileHandle, fileName, willSelfDestruct, domRefs, state, helpers);
  } else {
    await _startDownload(uuid, meta, fileName, willSelfDestruct, domRefs, state, helpers);
  }
}
