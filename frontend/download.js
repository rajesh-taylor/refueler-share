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
import { hexToBuf, derivePartKey, decryptPart, decryptPartV1, WORKER_URL, CHUNK_SIZE } from './crypto.js';

// Newest Notes article, shown on the finished screen (R-10/R-11). Same site as
// refueler.io/share/. A missing file answers 200 + the homepage, so only a body
// that parses and passes every check below becomes a card.
const NOTES_LATEST_URL = 'https://refueler.io/notes/latest.json';
const NOTES_URL_PREFIX = 'https://refueler.io/notes/';
const NOTES_TIMEOUT_MS = 4000;

const RX_SHEETS = ['receiver-card', 'unlock-screen', 'download-card', 'rx-done', 'rx-notice'];
const $ = id => document.getElementById(id);

// Item 14: lines settle 170 ms apart, button last, once per sheet. Must match share.css .rx-arrive.
const RX_STAGGER_MS = 170;
const RX_SETTLE_MS  = 500;
const _arrived = new Set(['download-card']);   // a measurement, not an arrival

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
  let meta = {};
  try {
    const metaRes = await fetch(`${WORKER_URL}/meta/${uuid}`);
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
//   1. fetchChunkWithRetry detects 409 → throws IntegrityError (never retried)
//   2. No Range header ever sent — confirmed and locked; fetch uses the full URL only
//   3. Truncated-body guard: if buf.byteLength === 0 on a chunk that should have bytes → IntegrityError
//   4. Catch block handles IntegrityError → _showIntegrityFailure, abort writable, no partial file
//   5. X-Integrity header read silently on first chunk; no UX change
//   6. Legacy 200 (no X-Integrity) → identical path, silent pass-through
// ─────────────────────────────────────────────────────────────────────────────
async function _startDownloadStream(uuid, meta, fileHandle, fileName, willSelfDestruct, domRefs, state, helpers) {
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
    let bytesWritten = 0;
    let nextChunkPromise = fetchChunkWithRetry(0);
    for (let i = 0; i < totalChunks; i++) {
      const ciphertextBuf = await nextChunkPromise;
      if (i + 1 < totalChunks) nextChunkPromise = fetchChunkWithRetry(i + 1);

      let plaintext;
      try {
        plaintext = await _decryptPart(state, ciphertextBuf, i, totalChunks);
      } catch (e) {
        reportError('decrypt', e.message, `uuid:${uuid.slice(0,8)} chunk:${i}`);
        await writable.abort();
        _showDownloadError(DECRYPT_FAILED_FSAA, domRefs);
        return;
      }
      await writable.write(new Uint8Array(plaintext));
      bytesWritten += plaintext.byteLength;
      const pct = totalBytes > 0
        ? Math.min(Math.round((bytesWritten / totalBytes) * 100), 100)
        : Math.round(((i + 1) / totalChunks) * 100);
      _setProgress(domRefs, pct, bytesWritten, totalBytes);
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

    // ── IntegrityError — the 409 and truncated-body paths ───────────────────
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Blob fallback download — Share-6-5b changes:
//   1. 409 detected in the fetch loop → IntegrityError thrown
//   2. Truncated-body guard: byteLength === 0 after res.ok → IntegrityError
//   3. No Range header ever sent (loop fetches full chunk URL only)
//   4. chunks array discarded and never assembled on IntegrityError
//   5. X-Integrity read silently on res headers; no UX change for legacy
// ─────────────────────────────────────────────────────────────────────────────
async function _startDownload(uuid, meta, fileName, willSelfDestruct, domRefs, state, helpers) {
  const { reportError } = helpers;
  const totalChunks = meta?.total_chunks;

  if (!totalChunks || totalChunks < 1) { _showDownloadError('Transfer metadata is incomplete. Please try again.', domRefs); return; }

  const totalBytes = (meta.total_bytes && meta.total_bytes > 0) ? meta.total_bytes : 0;
  _showProgress(domRefs, 'Downloading', totalBytes);

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

    if (res.status === 410) { _showLinkInactive(domRefs); return; }
    if (res.status === 401) {
      _showDownloadError('Access denied. This transfer may have expired or the link is incorrect.', domRefs);
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
    _setProgress(domRefs, pct, bytesReceived, totalBytes);
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
    const pct = 50 + Math.round(((i + 1) / chunks.length) * 50);
    _setProgress(domRefs, pct, totalBytes, totalBytes);
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
// Decrypt part i of n — one helper for both download paths.
// v2: part key + per-part nonce (the last-part flag means a shortened or extended
// transfer fails here); every part but the last must be exactly CHUNK_SIZE.
// v1/v0: the old path (K + the link's IV). Throws on any failure.
// ─────────────────────────────────────────────────────────────────────────────
const DECRYPT_FAILED_FSAA = 'Decryption failed — wrong key or corrupted data. No partial file was saved.';
const DECRYPT_FAILED_BLOB = 'Decryption failed — wrong key or corrupted data.';

async function _decryptPart(state, ct, i, n) {
  if (state.linkVersion !== 2) return decryptPartV1(state.sessionAesKey, state.sessionIv, ct, i);
  const plain = await decryptPart(state.sessionAesKey, ct, i, n);
  if (i < n - 1 && plain.byteLength !== CHUNK_SIZE) throw new Error(`part ${i} is ${plain.byteLength} bytes`);
  return plain;
}

// ─────────────────────────────────────────────────────────────────────────────
// Size from the fragment, if it agrees with the chunk count; else /meta (links
// made before Share-Size-1); else 0. A damaged z never blocks a download.
// ─────────────────────────────────────────────────────────────────────────────
function _resolveSize(fragmentSize, meta) {
  if (Number.isSafeInteger(fragmentSize) && fragmentSize > 0 &&
      Math.ceil(fragmentSize / CHUNK_SIZE) === meta.total_chunks) return fragmentSize;
  return (Number.isSafeInteger(meta.total_bytes) && meta.total_bytes > 0) ? meta.total_bytes : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Finished (item 9, R-10): "Downloaded." + File/Size, DAD line, Notes card, send line.
// No date seal (item 10, R-9), so the Notes card is always tried.
// ─────────────────────────────────────────────────────────────────────────────
function _finish(willSelfDestruct, domRefs) {
  if (willSelfDestruct) $('rx-done-deleted').hidden = false;   // before the sheet shows: it joins the arrival
  _showSheet('rx-done');

  try { _logReceiverEvent('receiver_ab_downloaded', sessionStorage.getItem('rs-usp-variant') || 'unknown'); } catch {}

  _showNotesCard(domRefs.dlSignoff);
}

// Fetched only now, after the download. No cookies, no referrer, nothing about
// the reader. Any failure (error, HTML, slow, bad fields) = no card, no message.
async function _showNotesCard(anchor) {
  const ctl   = new AbortController();
  const timer = setTimeout(() => ctl.abort(), NOTES_TIMEOUT_MS);
  try {
    const res = await fetch(NOTES_LATEST_URL, {
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal,
    });
    if (!res.ok) return;
    const d = JSON.parse(await res.text());
    const str = v => typeof v === 'string' && v.trim() !== '';
    if (!d || d.schema !== 'notes-latest.v1') return;
    if (!str(d.title) || !str(d.summary) || !str(d.url)) return;
    if (!d.url.startsWith(NOTES_URL_PREFIX)) return;
    const href = new URL(d.url);
    if (href.origin !== 'https://refueler.io' || !href.pathname.startsWith('/notes/')) return;

    const card = document.createElement('a');
    card.className = 'rx-article rx-settle';   // arrives up to 4 s after the sheet: settles in on its own
    card.href      = href.href;
    card.target    = '_blank';                  // don't navigate away from a download still saving
    card.rel       = 'noopener noreferrer';
    const eyebrow = document.createElement('p');
    eyebrow.className   = 'rx-eyebrow';
    eyebrow.textContent = 'Latest from Refueler Notes';
    const title = document.createElement('h2');
    title.className   = 'rx-article-title';
    title.textContent = d.title;
    const summary = document.createElement('p');
    summary.className   = 'rx-article-summary';
    summary.textContent = d.summary;
    const more = document.createElement('span');
    more.className   = 'rx-article-more';
    more.textContent = 'Read the article →';
    card.append(eyebrow, title, summary, more);
    anchor.insertAdjacentElement('beforebegin', card);
    setTimeout(() => card.classList.remove('rx-settle'), RX_SETTLE_MS + 100);
  } catch {
    // no card
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Receiver helpers
// ─────────────────────────────────────────────────────────────────────────────
function _showSheet(id) {
  for (const s of RX_SHEETS) { const el = $(s); if (el) el.hidden = (s !== id); }
  if (!_arrived.has(id)) { _arrived.add(id); _arrive($(id)); }
}

// Item 14. Stagger only the lines actually on screen, so a hidden row leaves no gap.
// The class comes off once the last line has settled: a sheet shown again (save
// dialog cancelled, card re-rendered) doesn't replay. prefers-reduced-motion: share.css.
function _arrive(sheet) {
  if (!sheet) return;
  const lines = [...sheet.children].filter(el => !el.hidden && el.getClientRects().length > 0);
  lines.forEach((el, i) => { el.style.animationDelay = `${i * RX_STAGGER_MS}ms`; });
  sheet.classList.add('rx-arrive');
  setTimeout(() => {
    sheet.classList.remove('rx-arrive');
    lines.forEach(el => { el.style.animationDelay = ''; });
  }, Math.max(0, lines.length - 1) * RX_STAGGER_MS + RX_SETTLE_MS + 100);
}

function _showNotice(eyebrow, head, lede, { send = false } = {}) {
  $('rx-notice-eyebrow').textContent = eyebrow;
  $('rx-notice-head').textContent    = head;
  $('rx-notice-lede').textContent    = lede;
  $('rx-notice-send').hidden         = !send;
  _showSheet('rx-notice');
}

// Item 7: the sender's timed window has closed (before the transfer's own expiry).
function _showWindowClosed(untilTs) {
  _showNotice('Link closed', 'This file is no longer available.',
    `The sender made it available until ${_fmtDateTime(untilTs)}. Ask them for a new link.`);
}

// Item 8: big mono %, hairline track, "X MB of Y MB".
function _showProgress(domRefs, stage, totalBytes) {
  domRefs.dlStageTag.textContent = stage;
  _setProgress(domRefs, 0, 0, totalBytes);
  _showSheet('download-card');
}

function _setProgress(domRefs, pct, doneBytes, totalBytes) {
  domRefs.dlPct.textContent = String(pct);
  domRefs.dlBar.style.width = pct + '%';
  $('dl-track').setAttribute('aria-valuenow', String(pct));
  $('dl-mb').textContent = totalBytes > 0 ? _bytesOf(doneBytes, totalBytes) : '';
}

// Both figures in the total's unit, same units as share.js formatBytes (Size row).
function _bytesOf(done, total) {
  const units = [['GB', 1024 ** 3, 2], ['MB', 1024 ** 2, 1], ['KB', 1024, 1]];
  const [unit, div, dp] = units.find(([, d]) => total >= d) || ['B', 1, 0];
  const f = b => (Math.min(b, total) / div).toFixed(dp);
  return `${f(done)} ${unit} of ${f(total)} ${unit}`;
}

function _setUnlockError(input, errEl, msg, invalid) {
  errEl.textContent = msg;
  if (invalid) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

// Run fn at a unix time. Re-checks at least once a minute, so a sleeping laptop can't overshoot.
function _at(unixSecs, fn) {
  const step = () => {
    const ms = unixSecs * 1000 - Date.now();
    if (ms <= 0) { fn(); return; }
    setTimeout(step, Math.min(ms, 60000));
  };
  step();
}

// R-5: exact local date + time first ("Sat 3 Oct, 15:25"). Built by hand so
// every browser prints the same thing.
const _WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const _MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _pad2 = n => String(n).padStart(2, '0');

function _fmtTime(unixSecs) {
  const d = new Date(unixSecs * 1000);
  return `${_pad2(d.getHours())}:${_pad2(d.getMinutes())}`;
}

function _fmtDateTime(unixSecs) {
  const d = new Date(unixSecs * 1000);
  return `${_WD[d.getDay()]} ${d.getDate()} ${_MO[d.getMonth()]}, ${_fmtTime(unixSecs)}`;
}

function _sameDay(unixSecs) {
  return new Date(unixSecs * 1000).toDateString() === new Date().toDateString();
}

// Countdown under "Available until": days, then hours on the last day.
function _countdown(secs) {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  if (d >= 1) return `in ${d} day${d === 1 ? '' : 's'}`;
  if (h >= 1) return `in ${h} hour${h === 1 ? '' : 's'}`;
  return 'in less than an hour';
}

// Countdown under "Opens".
function _untilOpen(secs) {
  const d = Math.floor(secs / 86400);
  if (d >= 1) return `in ${d} day${d === 1 ? '' : 's'}`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (!h && !m) return 'in less than a minute';
  return 'in ' + (h ? `${h} h ` : '') + `${m} min`;
}

// Share-DAD-2: the Worker deletes a DAD transfer as soon as the last chunk is
// served (Share-B11-1, finishDownload) — not on a recipient confirm. The copy
// says exactly that; there is no confirm step to ask for.
function _showPreDownloadModal(onConfirm, onCancel) {
  const overlay = document.createElement('div');
  overlay.id = 'pre-dl-modal';
  overlay.className = 'pre-dl-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'pre-dl-modal-heading');
  overlay.innerHTML = `
    <div class="pre-dl-modal-card">
      <p class="pre-dl-modal-heading" id="pre-dl-modal-heading">This transfer is deleted after download</p>
      <button id="pre-dl-modal-btn" class="btn btn-primary btn-full">Download</button>
      <button id="pre-dl-modal-cancel" class="btn btn-ghost btn-full">Not now</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('pre-dl-modal-btn').addEventListener('click', () => { overlay.remove(); onConfirm(); }, { once: true });
  document.getElementById('pre-dl-modal-cancel').addEventListener('click', () => { overlay.remove(); onCancel(); }, { once: true });
}

function _renderHiddenFileName(rcFileName, fileName, hiddenLabel) {
  rcFileName.textContent = hiddenLabel;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rx-reveal';
  btn.textContent = 'Show name';
  btn.setAttribute('aria-pressed', 'false');
  btn.addEventListener('click', () => {
    const shown = btn.getAttribute('aria-pressed') === 'true';
    rcFileName.textContent = shown ? hiddenLabel : fileName;
    btn.textContent        = shown ? 'Show name' : 'Hide name';
    btn.setAttribute('aria-pressed', String(!shown));
  });
  rcFileName.insertAdjacentElement('afterend', btn);
}

// Item 11. Deleted, expired and unknown links (mid-download 410 lands here too).
function _showLinkInactive(_domRefs) {
  _showNotice('Link closed', 'This link is no longer active.',
    'The file was deleted after download, or its time ran out. Ask the sender for a new link.',
    { send: true });
}

// No progress figures on an error (DAD-ERROR-TEXT, Share-B10-3): the notice sheet has none.
function _showDownloadError(msg, _domRefs) {
  _showNotice('Stopped', 'The download stopped.', msg);
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
