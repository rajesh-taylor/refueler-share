// ── frontend/upload.js — upload state machine ────────────────────────────────
// Extracted from share.js at Share-JS-Refactor session (TH-block).
// No behaviour change from TH-2 share.js — pure structural split.
//
// Exports:
//   enterUploadMode(domRefs, state, helpers)
//   resumeUpload(record, domRefs, state, helpers)
//   checkResumeState(domRefs, state, helpers)
//
// Receives shared mutable state object from share.js — mutations are visible
// to all holders (sessionAesKey, partKey, uploadUUID set here).
//
// Share-6-6b: legacy Worker-relay path (PUT /upload/:uuid/:chunk) removed.
// Direct-to-R2 is the only upload path. USE_DIRECT_R2 flag retired.
// ─────────────────────────────────────────────────────────────────────────────

import {
  loadDeps,
  blake3Hash,
  blake3CreateHash,
  sha256Hex,
  generateBlindedCredential,
  unblindSignature,
  CredentialProofError,
  bufToHex,
  hexToBuf,
  derivePartKey,
  encryptPart,
  WORKER_URL,
  CHUNK_SIZE,
  FREE_CAP,
  FREE_EXPIRY,
  TIER_EXPIRY_SECONDS,
  CHUNK_UPLOAD_TIMEOUT_MS,
  RETRY_DELAYS_MS,
  waitForRetry,
  makeRateMeter,
} from './crypto.js';

import {
  generateSealNonce,
  runPermanentRecord,
} from './timestamp.js';

import { assembleFragment } from './fragment.js';

import { buildMerkleTree } from './merkle.js';

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB — chunk resume state (RU1)
//
// Schema: DB = 'refueler-share-resume', store = 'transfers', keyPath = 'uuid'
// One record per interrupted transfer. Overwritten on each 200 ACK.
// Cleared on discard or successful completion.
//
// Record shape (TH-2: added sealNonceHex — additive, no schema bump required):
// { uuid, chunkIndex, totalChunks, fileName, fileSize, keyHex, ivHex,
//   tier, expiryTimestamp, timestamp, sealNonceHex }
// Share-6 added uploadMode, sessionToken, sourceType. B12-1c added tailUrl
// { url, expires } — the size-signed tail URL, issued only at /initiate.
// Share-Upload-6 added hashes, fileModified. Share-Crypto-1 added scheme: 2 (part
// key schedule, link format v2) and dropped ivHex; a record without scheme 2 is
// discarded, never resumed.
// ─────────────────────────────────────────────────────────────────────────────
const IDB_NAME    = 'refueler-share-resume';
const IDB_STORE   = 'transfers';
const IDB_VERSION = 1;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'uuid' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function writeChunkState(record, reportError) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).put(record);
      req.onsuccess = resolve;
      req.onerror   = e => reject(e.target.error);
      tx.oncomplete = resolve;
    });
    db.close();
  } catch (e) {
    reportError('idb_write', e.message, record.uuid?.slice(0, 8) ?? '');
  }
}

async function readResumeState() {
  try {
    const db = await idbOpen();
    const record = await new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).openCursor();
      req.onsuccess = e => resolve(e.target.result ? e.target.result.value : null);
      req.onerror   = e => reject(e.target.error);
    });
    db.close();
    return record;
  } catch {
    return null;
  }
}

export async function clearResumeState(uuid, reportError) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).delete(uuid);
      req.onsuccess = resolve;
      req.onerror   = e => reject(e.target.error);
      tx.oncomplete = resolve;
    });
    db.close();
  } catch (e) {
    reportError('idb_clear', e.message, uuid?.slice(0, 8) ?? '');
  }
}

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
// Folder helpers
// ─────────────────────────────────────────────────────────────────────────────
const FOLDER_MAX_DEPTH  = 20;
const FOLDER_WARN_FILES = 500;
const FOLDER_MAX_FILES  = 2000;
const IOS_LOCAL_ROOT    = 'File Provider Storage';
const FOLDER_ZIP_CAP    = 2 * 1024 ** 3; // 2 GiB — folder zips are held in RAM during upload (Share-6-spec §7)

function sanitiseSegment(seg) {
  // eslint-disable-next-line no-control-regex
  let s = seg.replace(/[\x00-\x1F\x7F\u202A-\u202E\u2066-\u2069]/g, '');
  const enc = new TextEncoder();
  let bytes = enc.encode(s);
  if (bytes.length > 200) {
    bytes = bytes.slice(0, 200);
    s = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\uFFFD$/, '');
  }
  return s;
}

function sanitisePath(rel) {
  return rel.split('/')
    .map(sanitiseSegment)
    .filter(s => s.length > 0 && s !== '..' && s !== '.')
    .join('/');
}

async function readDirectoryEntry(dirEntry, pathPrefix, depth) {
  const prefix    = pathPrefix || '';
  const currDepth = depth      || 0;
  const results   = [];

  if (currDepth > FOLDER_MAX_DEPTH) {
    throw new Error(`Folder is nested more than ${FOLDER_MAX_DEPTH} levels deep. Please zip it manually first.`);
  }

  await new Promise((resolve, reject) => {
    const reader = dirEntry.createReader();
    function readBatch() {
      reader.readEntries(async entries => {
        if (entries.length === 0) { resolve(); return; }
        for (const entry of entries) {
          if (entry.isFile) {
            const file = await new Promise((res, rej) => entry.file(res, rej));
            const rel  = prefix ? `${prefix}/${entry.name}` : entry.name;
            const safe = sanitisePath(rel);
            if (safe) results.push({ relativePath: safe, file });
          } else if (entry.isDirectory) {
            const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
            try {
              const subResults = await readDirectoryEntry(entry, subPrefix, currDepth + 1);
              results.push(...subResults);
            } catch (e) { reject(e); return; }
          }
        }
        readBatch();
      }, reject);
    }
    readBatch();
  });

  return results;
}

// Store-only folder zips (Share-Upload-5): no compression, entries in path order,
// each file's own modified date — the same folder always zips to the same bytes,
// the base for folder resume (S-031). Dates go in twice: the zip's own field (local
// time, 2 s steps) and the extended UTC timestamp (0x5455) most unzip tools restore
// exactly. Unknown or out-of-range dates (zip fields run 1980–2038) use 1 Jan 1980.
const ZIP_DATE_MIN = new Date(1980, 0, 1, 12).getTime();
const ZIP_DATE_MAX = 2 ** 31 * 1000 - 1;

function _zipDate(file) {
  const t = file.lastModified;
  return t >= ZIP_DATE_MIN && t <= ZIP_DATE_MAX ? t : ZIP_DATE_MIN;
}

function _zipUtcStamp(t) {
  const b = new Uint8Array(5);
  b[0] = 1;   // flags: modified time only
  new DataView(b.buffer).setUint32(1, Math.floor(t / 1000), true);
  return b;
}

// Exact size of that zip: per file a 30 B local header, 16 B data descriptor,
// 46 B central entry, a 9 B timestamp in each header and the name twice; 22 B end record.
function _zipSize(entries) {
  const enc = new TextEncoder();
  return entries.reduce((acc, e) => acc + (e.file.size || 0) + 110 + 2 * enc.encode(e.relativePath).length, 22);
}

// ─────────────────────────────────────────────────────────────────────────────
// Zip streaming (fflate)
// ─────────────────────────────────────────────────────────────────────────────
async function zipAndSelect(entries, folderName, domRefs, helpers) {
  const { showZipStage, hideZipCard, handleFileSelection, formatBytes, setDropMsg, reportError } = helpers;
  const zipName  = `${folderName}.zip`;
  const totalBytes = entries.reduce((acc, e) => acc + (e.file.size || 0), 0);
  entries = [...entries].sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));

  // RAM guard (Share-6-spec §7): the zip is held in memory, so refuse BEFORE the
  // read loop. Checked once, on the zip's exact size (files + headers), so the
  // "zip it yourself" copy shows before any zipping starts.
  const zipBytes = _zipSize(entries);
  if (zipBytes > FOLDER_ZIP_CAP) {
    hideZipCard();
    _resetRows(domRefs); helpers.setView('empty');
    setDropMsg(_folderTooBig(zipBytes, formatBytes));
    return;
  }

  showZipStage('Zipping', 0, `0 B of ${formatBytes(totalBytes)}`);

  const zipChunks = [];
  let bytesProcessed = 0;
  let zipError = null;

  const zipBlob = await new Promise((resolve, reject) => {
    const zipper = new fflate.Zip((err, chunk, final) => {
      if (err) { zipError = err; reject(err); return; }
      zipChunks.push(chunk);
      if (final) resolve(new Blob(zipChunks, { type: 'application/zip' }));
    });

    (async () => {
      try {
        for (let i = 0; i < entries.length; i++) {
          if (zipError) break;
          const { relativePath, file } = entries[i];
          const buf  = await file.arrayBuffer();
          const data = new Uint8Array(buf);

          const entry = new fflate.ZipPassThrough(relativePath);
          const when  = _zipDate(file);
          entry.mtime = when;
          entry.extra = { 0x5455: _zipUtcStamp(when) };
          zipper.add(entry);
          entry.push(data, true);
          // eslint-disable-next-line no-unused-expressions
          buf;

          bytesProcessed += file.size;
          const pct = Math.min(Math.round((bytesProcessed / totalBytes) * 95), 95);
          showZipStage('Zipping', pct, `${formatBytes(bytesProcessed)} of ${formatBytes(totalBytes)}`);
          await new Promise(r => setTimeout(r, 0));
        }
        if (!zipError) {
          showZipStage('Finalising archive', 95, `${formatBytes(totalBytes)} of ${formatBytes(totalBytes)}`);
          zipper.end();
        }
      } catch (e) { reject(e); }
    })();
  }).catch(err => {
    reportError('folder_zip', err.message || 'fflate error', folderName.slice(0, 100));
    hideZipCard();
    _resetRows(domRefs); helpers.setView('empty');
    setDropMsg('Zipping the folder didn’t work. Try again, or zip it yourself and send the .zip as a file.');
    return null;
  });

  if (!zipBlob) return;

  showZipStage('Zipping', 100, `${formatBytes(totalBytes)} of ${formatBytes(totalBytes)}`);
  await new Promise(r => setTimeout(r, 300));
  hideZipCard();

  const zipFile = new File([zipBlob], zipName, { type: 'application/zip' });
  handleFileSelection(zipFile, entries.length);
}

// Build list §1: folders over the 2 GB in-memory cap (Share-6-spec §7).
function _folderTooBig(bytes, formatBytes) {
  return `This folder is ${formatBytes(bytes)}. Folders can be up to 2 GB. Zip it yourself and send the .zip as a file (free up to 4 GB).`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tidal + permanent-record option injection
// ─────────────────────────────────────────────────────────────────────────────
function _injectTransferOptions(domRefs, transferOpts) {
  // 1–2. Delete after download: static markup since Share-Upload-2 (ids kept).
  transferOpts.destroyToggle = domRefs.destroyToggle;
  transferOpts.destroyNotice = domRefs.destroyNotice;
  transferOpts.destroyToggle.addEventListener('change', () => {
    transferOpts.destroyNotice.hidden = !transferOpts.destroyToggle.checked;
  });

  // 3–5. Paid only and unreachable today (F-10): injected into #paid-options, which stays hidden.
  const paid = domRefs.paidOptions;
  if (!paid) return;

  // 3. Tidal window
  const tidal = document.createElement('div');
  tidal.id = 'tidal-window-section';
  tidal.className = 'tidal-window hidden';
  tidal.setAttribute('aria-label', 'Transfer availability window');
  tidal.innerHTML = `
    <div class="tidal-heading">
      <div class="toggle-label">Availability window</div>
      <div class="toggle-desc">Optionally restrict when this transfer can be downloaded</div>
    </div>
    <div class="tidal-pickers">
      <div class="tidal-field">
        <label for="available-from" class="tidal-label">Available from</label>
        <input type="datetime-local" id="available-from" class="tidal-input" />
      </div>
      <div class="tidal-field">
        <label for="available-until" class="tidal-label" id="available-until-label">Available until</label>
        <input type="datetime-local" id="available-until" class="tidal-input" />
      </div>
    </div>
    <div id="tidal-error" class="tidal-error hidden" role="alert"></div>`;
  paid.appendChild(tidal);
  transferOpts.tidalSection   = document.getElementById('tidal-window-section');
  transferOpts.availableFrom  = document.getElementById('available-from');
  transferOpts.availableUntil = document.getElementById('available-until');
  transferOpts.tidalError     = document.getElementById('tidal-error');

  function _setPickerMin() {
    const nowMs  = Date.now();
    const nowMin = new Date(nowMs - (nowMs % 60000));
    const iso    = nowMin.toISOString().slice(0, 16);
    transferOpts.availableFrom.min  = iso;
    transferOpts.availableUntil.min = iso;
  }
  _setPickerMin();
  transferOpts.availableFrom.addEventListener('focus', _setPickerMin);
  transferOpts.availableUntil.addEventListener('focus', _setPickerMin);
  transferOpts.availableFrom.addEventListener('change', () => _clearTidalError(transferOpts));
  transferOpts.availableUntil.addEventListener('change', () => _clearTidalError(transferOpts));

  // 4. Permanent-record toggle (TH-2)
  const permanentRow = document.createElement('div');
  permanentRow.className = 'mt16 hidden';
  permanentRow.id = 'permanent-record-row';
  permanentRow.innerHTML = `
    <div class="toggle-row">
      <div>
        <div class="toggle-label">Permanent record</div>
        <div class="toggle-desc">A Bitcoin-anchored date stamp is added to this transfer</div>
      </div>
      <label class="switch">
        <input type="checkbox" id="permanent-record-toggle" />
        <span class="slider"></span>
      </label>
    </div>`;
  tidal.insertAdjacentElement('afterend', permanentRow);
  transferOpts.permanentRecordToggle = document.getElementById('permanent-record-toggle');

  // 5. Amber permanent-record notice (TH-2)
  const prNotice = document.createElement('div');
  prNotice.id = 'permanent-record-notice';
  prNotice.className = 'destroy-notice hidden';
  prNotice.innerHTML = `<strong>This creates an unforgeable record that this file existed.</strong> The stamp is public — it proves when, not who.`;
  permanentRow.insertAdjacentElement('afterend', prNotice);
  transferOpts.permanentRecordNotice = prNotice;

  transferOpts.permanentRecordToggle.addEventListener('change', () => {
    prNotice.classList.toggle('hidden', !transferOpts.permanentRecordToggle.checked);
  });
}

function _updatePaidFeaturesVisibility(tier, transferOpts) {
  const isPaid = tier && tier !== 'free' && tier !== 'citizen';
  if (transferOpts.tidalSection) transferOpts.tidalSection.classList.toggle('hidden', !isPaid);
  const permanentRow = document.getElementById('permanent-record-row');
  if (permanentRow) permanentRow.classList.toggle('hidden', !isPaid);
}

function _pickerToUnix(input) {
  if (!input || !input.value) return null;
  return Math.floor(new Date(input.value).getTime() / 1000);
}

function _validateTidal(fromUnix, untilUnix, expiryTimestamp) {
  if (fromUnix !== null && untilUnix !== null && fromUnix > untilUnix) {
    return '"Available from" must be before "Available until".';
  }
  if (untilUnix !== null && untilUnix > expiryTimestamp) {
    return '"Available until" cannot be after the transfer expiry date.';
  }
  if (fromUnix !== null && fromUnix > expiryTimestamp) {
    return '"Available from" cannot be after the transfer expiry date.';
  }
  return null;
}

function _showTidalError(msg, transferOpts) {
  if (!transferOpts.tidalError) return;
  transferOpts.tidalError.textContent = msg;
  transferOpts.tidalError.classList.remove('hidden');
}

function _clearTidalError(transferOpts) {
  if (!transferOpts.tidalError) return;
  transferOpts.tidalError.textContent = '';
  transferOpts.tidalError.classList.add('hidden');
}

// ─────────────────────────────────────────────────────────────────────────────
// Turnstile (U-10): invisible unless Cloudflare needs a click; then the
// #turnstile-wrap line and widget show above the button. Drawn once, when the upload
// page opens (Share-Upload-5: a slow check runs while the sender picks a file), and
// kept across "Choose another" (U-11); Cloudflare refreshes an
// expired token itself. A token is single-use: startUpload spends it at
// /credential/issue, then resets the widget so a retry gets a fresh check.
// The button never waits on the check: pressed early it reads "Checking…" and
// the upload starts when the token lands; past CHECK_WAIT_MS the line shows, so
// the wait has a reason. If Cloudflare's box appears, the queued press is dropped:
// a tick never starts an upload, the sender presses the button after it (Rajesh, 7 Oct).
// ─────────────────────────────────────────────────────────────────────────────
const UPLOAD_LABEL = 'Encrypt and upload';
let turnstileWidgetId = null;
let turnstilePolling  = false;
let turnstileFailed   = false;
let startWhenChecked  = null;   // queued start while the button reads "Checking…"
let turnstileTheme    = null;   // 'light' | 'dark', as drawn
let turnstileStale    = false;  // page theme changed while a token was held
let themeWatch        = null;
let turnstileAsking   = false;  // Cloudflare's box is showing (wants a click)
let checkWaitTimer    = null;
const CHECK_WAIT_MS   = 2000;

function renderTurnstile(state, domRefs, helpers) {
  const container = document.getElementById('cf-turnstile');
  if (!container) return;
  if (!window.turnstile) {
    if (!turnstilePolling) {
      turnstilePolling = true;
      const deadline = Date.now() + 15000;
      const poll = setInterval(() => {
        if (window.turnstile) {
          clearInterval(poll);
          turnstilePolling = false;
          renderTurnstile(state, domRefs, helpers);
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          turnstilePolling = false;
          helpers.reportError('turnstile_load', 'Turnstile script did not load within 15s', navigator.userAgent.slice(0, 100));
        }
      }, 200);
    }
    return;
  }
  if (turnstileWidgetId !== null) return;
  const wrap = document.getElementById('turnstile-wrap');
  container.innerHTML = '';
  if (!themeWatch) {
    // Cloudflare offers light or dark only, fixed when drawn: follow a Carbon/Paper switch.
    themeWatch = new MutationObserver(() => _followTheme(state, domRefs, helpers));
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  turnstileTheme = _pageTheme();
  turnstileWidgetId = window.turnstile.render(container, {
    sitekey: '0x4AAAAAAD0N7GlHlCRuWITr',
    theme: turnstileTheme,
    appearance: 'interaction-only',
    size: 'flexible', // full width like the button; Cloudflare fixes the height at 65 px
    'before-interactive-callback': function() {
      turnstileAsking = true;
      if (wrap) wrap.classList.remove('hidden');
      _cancelQueuedStart(state, domRefs);
      domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
    },
    callback: function(token) {
      state.turnstileToken = token;
      turnstileFailed = false;
      turnstileAsking = false;
      clearTimeout(checkWaitTimer);
      if (wrap) wrap.classList.add('hidden');
      domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
      if (startWhenChecked) {
        const go = startWhenChecked;
        startWhenChecked = null;
        go();
      }
    },
    'error-callback': function() {
      state.turnstileToken = null;
      turnstileFailed = true;
      turnstileAsking = false;
      domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
      if (startWhenChecked) {
        _cancelQueuedStart(state, domRefs);
        helpers.setDropMsg('The security check didn’t go through. Try again.');
        _resetTurnstile();
      }
      return true;
    },
    'expired-callback': function() {
      state.turnstileToken = null;
      if (turnstileStale) setTimeout(() => _redrawTurnstile(state, domRefs, helpers), 0);
    },
  });
}

function _resetTurnstile() {
  turnstileFailed = false;
  if (turnstileWidgetId !== null && window.turnstile) {
    try { window.turnstile.reset(turnstileWidgetId); } catch (e) {}
  }
}

const _pageTheme = () => document.documentElement.dataset.theme === 'carbon' ? 'dark' : 'light';

// Theme switched: redraw the widget in the new colours. A token already held is
// kept (redrawing would throw it away); the redraw then waits for the next reset.
function _followTheme(state, domRefs, helpers) {
  if (turnstileWidgetId === null || _pageTheme() === turnstileTheme) return;
  if (state.turnstileToken) { turnstileStale = true; return; }
  _redrawTurnstile(state, domRefs, helpers);
}

function _redrawTurnstile(state, domRefs, helpers) {
  turnstileStale = false;
  try { window.turnstile.remove(turnstileWidgetId); } catch (e) {}
  turnstileWidgetId = null;
  turnstileFailed = false;
  turnstileAsking = false;
  document.getElementById('turnstile-wrap')?.classList.add('hidden');
  renderTurnstile(state, domRefs, helpers);
}

// Called right after /credential/issue, whatever its outcome: that token is gone.
function _spendTurnstileToken(state, domRefs, helpers) {
  state.turnstileToken = null;
  if (turnstileStale) _redrawTurnstile(state, domRefs, helpers);
  else _resetTurnstile();
}

function _cancelQueuedStart(state, domRefs) {
  if (!startWhenChecked) return;
  startWhenChecked = null;
  clearTimeout(checkWaitTimer);
  if (!turnstileAsking) document.getElementById('turnstile-wrap')?.classList.add('hidden');
  domRefs.uploadBtn.textContent = UPLOAD_LABEL;
  domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
}

// Greyed only for a reason the sender can see (no file, empty password, Cloudflare's
// box waiting for its tick) or while "Checking…".
function _uploadBtnDisabled(state, domRefs) {
  const needsPassphrase = domRefs.passphraseToggle.checked && domRefs.passphraseInput.value.trim().length === 0;
  return !state.selectedFile || needsPassphrase || !!startWhenChecked || (turnstileAsking && !state.turnstileToken);
}

export function enterUploadMode(domRefs, state, helpers) {
  const {
    dropZone, fileInput, folderInput, folderBtn, passphraseToggle,
    passphraseInput, uploadBtn,
  } = domRefs;
  const { reportError, formatBytes, setDropMsg, clearDropMsg, showZipStage, hideZipCard } = helpers;

  // Transfer option refs — mutable, populated by _injectTransferOptions
  const transferOpts = {
    destroyToggle: null, destroyNotice: null,
    tidalSection: null, availableFrom: null, availableUntil: null, tidalError: null,
    permanentRecordToggle: null, permanentRecordNotice: null,
  };

  // Whole-page drop (U-8): the page takes a file while one can still be chosen. dragover
  // fires continuously while a file is held over the page; when it stops for a moment,
  // the file has left (dragleave is unreliable across child elements and in Safari).
  // Upload mode only: enterUploadMode never runs on a receiver link.
  const droppable = () => ['empty', 'chosen', 'over'].includes(domRefs.uploadSheet.dataset.view);
  const hasFiles  = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  let dragTimer = null;
  const dragOff = () => {
    clearTimeout(dragTimer);
    document.documentElement.classList.remove('up-dragging');
    dropZone.classList.remove('drag-over');
    domRefs.upHint.textContent = 'Drop it anywhere on this page';
  };
  document.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();               // never let the browser open the file in place of the page
    if (!droppable()) { e.dataTransfer.dropEffect = 'none'; return; }
    e.dataTransfer.dropEffect = 'copy';
    document.documentElement.classList.add('up-dragging');
    dropZone.classList.add('drag-over');
    domRefs.upHint.textContent = 'Release to add.';
    clearTimeout(dragTimer);
    dragTimer = setTimeout(dragOff, 250);
  });
  document.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragOff();
    if (!droppable()) return;
    clearDropMsg();

    const items = e.dataTransfer.items;
    if (e.dataTransfer.files.length > 1 || (items && items.length > 1)) { setDropMsg('One file or one folder at a time.'); return; }
    if (items && items.length === 1 && items[0].webkitGetAsEntry) {
      const entry = items[0].webkitGetAsEntry();
      if (entry && entry.isDirectory) {
        _handleFolderDrop(entry, domRefs, state, helpers, transferOpts);
        return;
      }
    }
    if (e.dataTransfer.files[0]) _handleFileSelection(e.dataTransfer.files[0], domRefs, state, helpers, transferOpts);
  });

  // "Choose another" (U-11): back to the empty rows; password, delete settings and a
  // passed Cloudflare check kept; focus on "Choose a file".
  const chooseAnother = () => {
    _cancelQueuedStart(state, domRefs);
    state.selectedFile = null;
    clearDropMsg();
    domRefs.capWarning.classList.add('hidden');
    _resetRows(domRefs);
    helpers.setView('empty');
    domRefs.fileBtn.focus();
  };
  domRefs.chooseAnotherBtn.addEventListener('click', chooseAnother);
  domRefs.overAnotherBtn.addEventListener('click', chooseAnother);

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
      clearDropMsg();
      _handleFileSelection(fileInput.files[0], domRefs, state, helpers, transferOpts);
    }
  });

  const fileBtn = document.getElementById('file-btn');
  if (fileBtn) {
    fileBtn.addEventListener('click', e => {
      e.stopPropagation();
      fileInput.value = '';
      fileInput.click();
    });
  }

  folderBtn.addEventListener('click', e => { e.stopPropagation(); folderInput.value = ''; folderInput.click(); });

  folderInput.addEventListener('change', () => {
    if (folderInput.files.length === 0) return;
    clearDropMsg();
    _handleFolderFiles(Array.from(folderInput.files), domRefs, state, helpers, transferOpts);
  });

  passphraseToggle.addEventListener('change', () => {
    domRefs.passphraseWrap.classList.toggle('hidden', !passphraseToggle.checked);
    if (!passphraseToggle.checked) passphraseInput.value = '';
    uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
  });
  passphraseInput.addEventListener('input', () => {
    uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
  });

  _injectTransferOptions(domRefs, transferOpts);

  // U-10: pressed before the check has passed → "Checking…", start when the token lands.
  // A fresh-start Try again (F-11) presses it too: a spent token means a new check.
  pressUpload = () => {
    const go = () => startUpload(domRefs, state, helpers, transferOpts);
    clearDropMsg();
    if (state.turnstileToken) { go(); return; }
    startWhenChecked = go;
    uploadBtn.textContent = 'Checking…';
    uploadBtn.disabled = true;
    if (turnstileFailed) _resetTurnstile();
    renderTurnstile(state, domRefs, helpers);
    clearTimeout(checkWaitTimer);
    checkWaitTimer = setTimeout(() => {
      if (startWhenChecked) document.getElementById('turnstile-wrap')?.classList.remove('hidden');
    }, CHECK_WAIT_MS);
  };
  uploadBtn.addEventListener('click', pressUpload);

  // Start the check now, not on the first file: on hardened browsers (Vanadium)
  // Cloudflare can take ~10 s to decide it wants a click.
  renderTurnstile(state, domRefs, helpers);
}

// ─────────────────────────────────────────────────────────────────────────────
// File selection
// ─────────────────────────────────────────────────────────────────────────────
function _handleFileSelection(file, domRefs, state, helpers, transferOpts, folderFiles = 0) {
  const { capWarning, fileNameTag, fileSizeTag } = domRefs;
  const { formatBytes, formatWhen, setView } = helpers;

  _cancelQueuedStart(state, domRefs);
  state.selectedFile = file;
  state.sourceType   = 'file'; // reset: folder path sets this to 'folder' before upload
  fileNameTag.textContent = file.name;
  domRefs.upFileLabel.textContent = folderFiles ? 'Folder' : 'File';
  domRefs.upFileNote.hidden = !folderFiles;
  domRefs.upFileNote.textContent = folderFiles ? `${folderFiles.toLocaleString()} files, zipped in your browser` : '';
  fileSizeTag.textContent = formatBytes(file.size);
  fileSizeTag.classList.remove('up-dim');
  if (file.size > FREE_CAP) {
    fileSizeTag.classList.add('up-warn');
    capWarning.classList.remove('hidden');
    setView('over');
    return;
  }
  fileSizeTag.classList.remove('up-warn');
  capWarning.classList.add('hidden');
  domRefs.upUntil.textContent = formatWhen(new Date(Date.now() + FREE_EXPIRY * 1000));
  domRefs.upUntil.classList.remove('up-dim');
  domRefs.upUntilNote.hidden = false;
  setView('chosen');
  // Warm the hashing + credential code while the sender looks at the slip, so the
  // button press doesn't wait for it ("Preparing" at 0 %). Cached; a failure here is
  // silent and startUpload retries and says so.
  loadDeps().catch(() => {});
  // U-11: a passed check is kept for the next file. Drawn at page open; restart only after a failure.
  if (turnstileWidgetId === null) renderTurnstile(state, domRefs, helpers);
  else if (turnstileFailed && !state.turnstileToken) _resetTurnstile();
  domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
}

// Back to the empty ledger ("—", "7 days after upload").
function _resetRows(domRefs) {
  domRefs.upFileLabel.textContent = 'File';
  domRefs.fileNameTag.textContent = '';
  domRefs.upFileNote.hidden = true;
  domRefs.fileSizeTag.textContent = '—';
  domRefs.fileSizeTag.classList.add('up-dim');
  domRefs.fileSizeTag.classList.remove('up-warn');
  domRefs.upUntil.textContent = '7 days after upload';
  domRefs.upUntil.classList.add('up-dim');
  domRefs.upUntilNote.hidden = true;
}

// Folder chosen or dropped: the File row becomes Folder and a Zipping row runs (U-7).
function _startZipView(folderName, fileCount, domRefs, helpers) {
  domRefs.upFileLabel.textContent = 'Folder';
  domRefs.fileNameTag.textContent = folderName;
  domRefs.upFileNote.hidden = !fileCount;
  domRefs.upFileNote.textContent = fileCount ? `${fileCount.toLocaleString()} files` : '';
  helpers.setView('zipping');
}

async function _handleFolderDrop(directoryEntry, domRefs, state, helpers, transferOpts) {
  const { setDropMsg, showZipStage, hideZipCard, reportError } = helpers;
  if (typeof fflate === 'undefined') {
    setDropMsg('Folders can’t be zipped in this browser. Zip it yourself and send the .zip as a file.');
    return;
  }
  _startZipView(directoryEntry.name || 'folder', 0, domRefs, helpers);
  showZipStage('Gathering', 0, 'Reading the folder…');
  let files;
  try {
    files = await readDirectoryEntry(directoryEntry);
  } catch (e) {
    reportError('folder_read', e.message, 'drag_entry');
    hideZipCard();
    _resetRows(domRefs); helpers.setView('empty');
    setDropMsg(e.message.includes('nested more than')
      ? e.message
      : 'The dropped folder couldn’t be read. Try “or a folder” instead.');
    return;
  }
  if (files.length === 0) { hideZipCard(); _resetRows(domRefs); helpers.setView('empty'); setDropMsg('That folder is empty.'); return; }
  if (files.length > FOLDER_MAX_FILES) {
    hideZipCard(); _resetRows(domRefs); helpers.setView('empty');
    setDropMsg(_folderTooMany(files.length));
    return;
  }
  // Over 2 GB is refused inside zipAndSelect (before reading), with the folder copy.

  const folderName = directoryEntry.name || 'folder';
  _startZipView(folderName, files.length, domRefs, helpers);
  await zipAndSelect(files, folderName, domRefs, { ...helpers, handleFileSelection: (f, n) => _handleFileSelection(f, domRefs, state, helpers, transferOpts, n) });
  // Part C: set AFTER zipAndSelect — _handleFileSelection (called inside zip) resets to 'file';
  // setting here overwrites that after the zip+selection chain completes.
  state.sourceType = 'folder';
}

function _folderTooMany(n) {
  return `This folder has ${n.toLocaleString()} files. Folders can have up to ${FOLDER_MAX_FILES.toLocaleString()}. Zip it yourself and send the .zip as a file.`;
}

async function _handleFolderFiles(fileList, domRefs, state, helpers, transferOpts) {
  const { setDropMsg, showZipStage, hideZipCard } = helpers;
  if (fileList.length === 0) return;
  if (typeof fflate === 'undefined') {
    setDropMsg('Folders can’t be zipped in this browser. Zip it yourself and send the .zip as a file.');
    return;
  }
  if (fileList.length > FOLDER_MAX_FILES) {
    setDropMsg(_folderTooMany(fileList.length));
    return;
  }

  const firstPath = fileList[0].webkitRelativePath || fileList[0].name;
  const rootName  = firstPath.includes('/') ? firstPath.split('/')[0] : 'folder';
  // iOS picker: "Open" at the top of On My iPhone reports that root as
  // "File Provider Storage". Name only — entry paths drop the root, so bytes are unchanged.
  const folderName = rootName === IOS_LOCAL_ROOT ? 'On My iPhone' : rootName;
  _startZipView(folderName, fileList.length, domRefs, helpers);
  showZipStage('Gathering', 0, '');

  const entries = fileList.map(f => {
    const rel      = f.webkitRelativePath || f.name;
    const stripped = rel.includes('/') ? rel.slice(rel.indexOf('/') + 1) : rel;
    return { relativePath: sanitisePath(stripped), file: f };
  }).filter(e => e.relativePath.length > 0);

  // Over 2 GB is refused inside zipAndSelect (before reading), with the folder copy.
  await zipAndSelect(entries, folderName, domRefs, { ...helpers, handleFileSelection: (f, n) => _handleFileSelection(f, domRefs, state, helpers, transferOpts, n) });
  // Part C: set AFTER zipAndSelect — _handleFileSelection (called inside zip) resets to 'file';
  // setting here overwrites that after the zip+selection chain completes.
  state.sourceType = 'folder';
}

// ─────────────────────────────────────────────────────────────────────────────
// _fetchNextUrlBatch — POST /upload/{uuid}/urls {from,count}, session-token authed.
// Never re-verifies or re-spends Cashu (spec §6 / do-not-retry §10).
// ─────────────────────────────────────────────────────────────────────────────
async function _fetchNextUrlBatch(uuid, sessionToken, from, count, reportError) {
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
async function _putChunkDirect(presignedUrl, encryptedBytes, chunkIndex, uuid, reportError, { onProgress, onWait } = {}) {
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

// Share-Deps-1 (E): if BLAKE3/secp256k1 can't load even with the pure-JS fallback,
// say so instead of freezing on the progress bar. Runs before anything is sent.
// Every other stop goes through _stopped (F-11, Share-Upload-4).
async function _loadDepsOrSay(domRefs, helpers) {
  try {
    await loadDeps();
    return true;
  } catch (e) {
    helpers.reportError('load_deps', e?.name || 'Error', String(e?.message || '').slice(0, 120));
    helpers.showStopped('Share couldn’t start in this browser. Reload to try again, or use another browser.');
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// F-11 (Share-Upload-4): every way an upload can stop lands on "Stopped" with a
// plain sentence (build list §1), and "Try again" carries on in the same tab with
// the file the page still holds — no picker. Before /initiate nothing was sent, so
// Try again starts afresh (new check, new upload pass); after it, the transfer
// carries on from the last part that arrived. After a refresh the resume card asks
// for the file as before.
//
// Kinds: network · check · refused · missing (finalise 409: parts absent or the wrong
// size) · unfinished (all sent, finalise failed) · gone (session spent or expired —
// can't carry on) · changed (resume: the chosen file's sent parts differ from the
// record) · browser (anything unexpected in this tab).
// ─────────────────────────────────────────────────────────────────────────────
class UploadStop extends Error {
  constructor(kind, message, extra = {}) {
    super(message || kind);
    this.kind = kind;
    Object.assign(this, extra);
  }
}

// Share-Progress-1: the resume screen is one box; the page headline says what happened.
const RESUME_HEAD = { eyebrow: 'Interrupted', head: 'An upload didn’t finish.' };
const NO_RESUME = 'This upload can’t be resumed. Start over to send the file again.';
const NOT_SAME_FILE = 'That file doesn’t match the unfinished upload. Discard it and start again.';
const SCHEME = 2;   // part key schedule + link format v2 (crypto.js, fragment.js)

// fetch, with a dropped connection turned into a "network" stop.
async function _send(url, options, what, reportError) {
  try {
    return await fetch(url, options);
  } catch (e) {
    reportError(`${what}_fetch`, e.message?.slice(0, 120), '');
    throw new UploadStop('network', `${what}: ${e.message}`);
  }
}

// The §1 sentence for a stop. job is null when nothing was sent yet.
function _stopText(e, job) {
  const sent = job ? Math.min(job.sent * CHUNK_SIZE, job.file.size) : 0;
  const pct  = job ? Math.round(sent / job.file.size * 100) : 0;
  switch (e.kind) {
    case 'network': {
      const reached = e.tried ? 'Refueler couldn’t be reached after several tries.' : 'Refueler couldn’t be reached.';
      return `${reached} Nothing was shared. ${pct > 0 ? `Try again carries on from ${pct}%.` : 'Try again.'}`;
    }
    case 'check':      return 'The security check didn’t go through. Try again.';
    case 'refused':    return 'Refueler refused the upload. Try again; if it keeps happening, check the Status page.';
    case 'missing':    return 'The upload didn’t finish. Some parts didn’t arrive. Try again.';
    case 'unfinished': return 'The upload didn’t finish. Everything was sent; Try again finishes it.';
    default:           return 'Something went wrong in this browser. Try again; if it keeps happening, check the Status page.';
  }
}

function _stopped(e, job, domRefs, state, helpers) {
  if (!(e instanceof UploadStop)) {
    helpers.reportError('upload_stopped', e?.name || 'Error', String(e?.message || '').slice(0, 160));
    e = new UploadStop('browser', e?.message);
  }
  if (e.kind === 'gone' || e.kind === 'changed') {
    if (job) clearResumeState(job.uuid, helpers.reportError).catch(() => {});
    helpers.showStopped(e.kind === 'changed' ? NOT_SAME_FILE : NO_RESUME);
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

async function startUpload(domRefs, state, helpers, transferOpts) {
  if (!state.selectedFile) return;
  let job = null;
  try {
    job = await _setUp(domRefs, state, helpers, transferOpts);
    if (job) await _carryOn(job, domRefs, state, helpers);
  } catch (e) {
    _stopped(e, job, domRefs, state, helpers);
  }
}

async function _carryOnOrStop(job, domRefs, state, helpers) {
  try {
    await _carryOn(job, domRefs, state, helpers);
  } catch (e) {
    _stopped(e, job, domRefs, state, helpers);
  }
}

// Fresh upload: key, upload pass, /initiate. Returns the job, or null when it has
// already said why it stopped (deps, a bad pass, the paid-only window).
async function _setUp(domRefs, state, helpers, transferOpts) {
  const { uploadBtn, passphraseToggle, passphraseInput } = domRefs;
  const { setStage, setProgress, formatBytes, reportError, showStopped } = helpers;
  const file = state.selectedFile;

  uploadBtn.disabled = true;
  uploadBtn.textContent = UPLOAD_LABEL;
  helpers.setView('uploading');
  setProgress(0, 'Getting an upload pass…');   // Share-Progress-1: say each setup step (option A)

  if (!(await _loadDepsOrSay(domRefs, helpers))) return null;

  // Stage words (build list §1): Preparing · Encrypting and uploading · Finishing.
  setStage('Preparing');
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const keyHex = bufToHex(await crypto.subtle.exportKey('raw', aesKey));   // K: the transfer key in the link

  // The password stays in its field until the link is ready, so a Try again
  // before /initiate can use it again (cleared in _carryOn on success).
  let p2shHashHex = null;
  if (passphraseToggle.checked && passphraseInput.value.trim()) {
    p2shHashHex = await sha256Hex(new TextEncoder().encode(passphraseInput.value.trim()));
  }

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const blinded = await generateBlindedCredential();

  let issueRes;
  try {
    issueRes = await _send(`${WORKER_URL}/credential/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstile_token: state.turnstileToken, blinded_message: blinded.blindedMsg, tier: 'free' }),
    }, 'credential_issue', reportError);
  } finally {
    _spendTurnstileToken(state, domRefs, helpers);   // single-use, whatever the outcome
  }

  if (!issueRes.ok) {
    const errText = await issueRes.text().catch(() => '');
    reportError('credential_issue', `HTTP ${issueRes.status}`, errText.slice(0, 200));
    // 400 no token · 403 check failed · 429 token already used → the check; else refused.
    const check = issueRes.status === 400 || issueRes.status === 403 || (issueRes.status === 429 && /turnstile/i.test(errText));
    throw new UploadStop(check ? 'check' : 'refused', `Credential issue failed: HTTP ${issueRes.status}`);
  }
  const issued = await issueRes.json();
  const { uuid: issuedUuid, issued_tier: issuedTier, commitment } = issued;
  if (!issuedUuid || !commitment || !issuedTier) throw new UploadStop('refused', 'Credential issue response missing uuid, commitment, or issued_tier');
  // Cred-Fix-2b: credential format v2. A bad DLEQ proof stops here, before anything is spent.
  let credential;
  try {
    credential = await unblindSignature(issued, blinded);
  } catch (e) {
    if (!(e instanceof CredentialProofError)) throw e;
    reportError('credential_dleq', e.name, String(e.message).slice(0, 120));
    showStopped('Share couldn’t get a valid upload pass. Reload to try again.');
    return null;
  }

  _updatePaidFeaturesVisibility(issuedTier, transferOpts);

  const expiryTimestamp = Math.floor(Date.now() / 1000) + FREE_EXPIRY;

  const destroyAfterDownload = transferOpts.destroyToggle && transferOpts.destroyToggle.checked ? '1' : null;
  const availableFromUnix    = _pickerToUnix(transferOpts.availableFrom);
  const availableUntilUnix   = _pickerToUnix(transferOpts.availableUntil);

  const tidalErr = _validateTidal(availableFromUnix, availableUntilUnix, expiryTimestamp);
  if (tidalErr) {
    _showTidalError(tidalErr, transferOpts);
    uploadBtn.disabled = false;
    helpers.setView('chosen');
    return null;
  }

  const isPaidTier = issuedTier && issuedTier !== 'free' && issuedTier !== 'citizen';
  const wantsPermanentRecord = isPaidTier && transferOpts.permanentRecordToggle && transferOpts.permanentRecordToggle.checked;
  const sealNonceHex = wantsPermanentRecord ? generateSealNonce() : null;

  // ── Direct-to-R2 upload path (Share-6-6b: only path) ─────────────────────
  // handleInitiate reads headers, not JSON body — matches legacy chunk-0 header schema.
  const initiateHeaders = {
    'X-Cashu-Credential':      credential,
    'X-Credential-Commitment': commitment,
    'X-Issued-Tier':           issuedTier,
    'X-Total-Chunks':          String(totalChunks),
    'X-Total-Bytes':           String(file.size),
    'X-Expiry-Timestamp':      String(expiryTimestamp),
    'X-File-Name':             'encrypted-payload', // D-1 invariant
  };
  if (p2shHashHex)          initiateHeaders['X-P2SH-Secret-Hash']       = p2shHashHex;
  if (destroyAfterDownload) initiateHeaders['X-Destroy-After-Download'] = '1';
  if (availableFromUnix)    initiateHeaders['X-Available-From']         = String(availableFromUnix);
  if (availableUntilUnix)   initiateHeaders['X-Available-Until']        = String(availableUntilUnix);

  setProgress(0, 'Setting up the transfer…');
  const initRes = await _send(`${WORKER_URL}/upload/${issuedUuid}/initiate`, {
    method: 'POST',
    headers: initiateHeaders,
  }, 'initiate', reportError);
  if (!initRes.ok) {
    const txt = await initRes.text().catch(() => '');
    reportError('initiate', `HTTP ${initRes.status}`, txt.slice(0, 200));
    throw new UploadStop('refused', `Initiate failed: HTTP ${initRes.status} — ${txt.slice(0, 120)}`);
  }
  const initData = await initRes.json();

  // URL map: index → presigned URL. First batch arrives in initiate response.
  const urlMap = new Map();
  for (const entry of (initData.urls || [])) urlMap.set(entry.index, entry.url);

  // B12-1c: a size-signing Worker returns the tail URL separately (tail_url) and
  // /urls never covers index N−1. An older Worker has no tail_url → unchanged.
  let tailUrl = null;
  if (initData.tail_url) {
    if (initData.tail_url.index !== totalChunks - 1) {
      throw new UploadStop('refused', `tail_url index ${initData.tail_url.index} ≠ ${totalChunks - 1}`);
    }
    tailUrl = { url: initData.tail_url.url, expires: initData.tail_url.expires };
  }

  return {
    file, uuid: issuedUuid, keyHex, scheme: SCHEME, totalChunks, expiryTimestamp,
    tier: issuedTier, sessionToken: initData.session_token, tailUrl,
    sealNonceHex, sourceType: state.sourceType || 'file',
    sent: 0, hashes: [], urlMap,
    // Streaming BLAKE3 plaintext root, fed after each part arrives (TH-2; paid only, F-10)
    plainHash: wantsPermanentRecord ? blake3CreateHash() : null,
    info: {
      fileName: file.name, isFolder: state.sourceType === 'folder',
      sizeBytes: file.size, expiryTimestamp,
      isProtected: !!p2shHashHex, destroyAfterDownload: !!destroyAfterDownload,
    },
  };
}

// The IndexedDB resume record for a job (chunkIndex = last part that arrived).
function _recordOf(job) {
  return {
    uuid: job.uuid, chunkIndex: job.sent - 1, totalChunks: job.totalChunks,
    fileName: job.file.name, fileSize: job.file.size,
    keyHex: job.keyHex, scheme: job.scheme, tier: job.tier || 'free',
    expiryTimestamp: job.expiryTimestamp, timestamp: Date.now(),
    sealNonceHex: job.sealNonceHex || undefined,
    uploadMode: 'direct-r2', sessionToken: job.sessionToken, // Share-6: resume needs these
    tailUrl: job.tailUrl || undefined,                       // B12-1c: /urls cannot re-issue the tail
    sourceType: job.sourceType,                              // Part C: folder detection for FOLDER-RESUME discard
    hashes: job.hashes.slice(0, job.sent),                   // Share-Upload-6: sent parts' ciphertext hashes (resume skips re-encrypting)
    fileModified: job.file.lastModified,                     // …trusted only while the chosen file is unchanged
  };
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
async function _carryOn(job, domRefs, state, helpers) {
  const { setStage, setProgress, formatBytes, reportError, showSharePanel } = helpers;
  const totalBytes  = job.file.size;
  const totalChunks = job.totalChunks;
  const chunks      = _splitChunks(job.file, CHUNK_SIZE);
  const short       = job.uuid.slice(0, 8);
  // Share-Progress-1: the bar counts bytes as they leave (inFlight = this part's
  // bytes so far), with time left once there's speed to judge it on.
  const meter = makeRateMeter();
  let inFlight = 0;
  const progress = () => {
    const b = Math.min(job.sent * CHUNK_SIZE + inFlight, totalBytes);
    meter.add(b);
    const left = meter.left(totalBytes - b);
    setProgress(b / totalBytes * 100, `${formatBytes(b)} of ${formatBytes(totalBytes)}${left ? ` · ${left}` : ''}`);
  };
  const drop = domRefs.progressDrop;
  const onWait = (secs) => {
    if (!secs) { meter.reset(); return; }   // a try starts again
    if (drop) {
      drop.textContent = `Connection lost. Trying again in ${secs} s.`;
      drop.hidden = false;
      if (inFlight) { inFlight = 0; progress(); }   // the part starts again: step back to the last one that arrived
    }
  };
  if (drop) drop.hidden = true;

  helpers.setView('uploading');
  setStage('Preparing');
  if (job.sent) progress(); else setProgress(0, 'Encrypting…');

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

export async function checkResumeState(domRefs, state, helpers) {
  const record = await readResumeState();
  if (!record) return;

  const age = Date.now() - (record.timestamp || 0);
  if (age > 8 * 24 * 60 * 60 * 1000) {
    await clearResumeState(record.uuid, helpers.reportError);
    return;
  }

  // ── FOLDER-RESUME auto-discard (Part C) ─────────────────────────────────────
  // A folder upload is zipped into an in-memory File that never touches disk, so
  // the file picker cannot re-select it on resume. Discard immediately — a resume
  // offer here could never succeed. Gate runs BEFORE the expiry check.
  if (record.sourceType === 'folder') {
    await clearResumeState(record.uuid, helpers.reportError);
    const { resumeCard, resumeNoticeBtn } = domRefs;
    if (resumeCard) resumeCard.classList.add('hidden');
    if (resumeNoticeBtn) resumeNoticeBtn.classList.add('hidden');
    if (typeof helpers.setDropMsg === 'function') {
      helpers.setDropMsg('A folder upload didn’t finish. Folders can’t be resumed, so start again.');
    }
    return;
  }

  // Share-Crypto-1: records from before link format v2 can't carry on; drop them quietly.
  if (record.scheme !== SCHEME) {
    await clearResumeState(record.uuid, helpers.reportError);
    return;
  }

  const nowSecs = Date.now() / 1000;
  let expired = false;
  if (record.expiryTimestamp) {
    expired = nowSecs > record.expiryTimestamp;
  } else if (record.tier && TIER_EXPIRY_SECONDS[record.tier]) {
    const windowSecs = TIER_EXPIRY_SECONDS[record.tier];
    const writtenSecs = (record.timestamp || 0) / 1000;
    expired = nowSecs > writtenSecs + windowSecs;
  }

  const { resumeCard, resumeDetail, resumeDiscardBtn, resumeNoticeBtn } = domRefs;
  const { formatBytes } = helpers;

  const sentBytes = Math.min((record.chunkIndex + 1) * CHUNK_SIZE, record.fileSize);
  const pct       = Math.round(sentBytes / record.fileSize * 100);
  domRefs.resumeFile.textContent = record.fileName;
  domRefs.resumeUploaded.replaceChildren(`${pct}%`, Object.assign(document.createElement('small'),
    { textContent: `${formatBytes(sentBytes)} of ${formatBytes(record.fileSize)}` }));
  if (resumeCard) resumeCard.classList.remove('hidden');
  helpers.setView('empty', RESUME_HEAD);   // one box: share.css hides the empty slip while the card shows

  if (resumeDiscardBtn) {
    resumeDiscardBtn.addEventListener('click', async () => {
      await clearResumeState(record.uuid, helpers.reportError);
      if (resumeCard) resumeCard.classList.add('hidden');
      helpers.setView('empty');   // back to the normal page
    }, { once: true });
  }

  if (expired) {
    if (resumeDetail) resumeDetail.textContent = 'It’s too late to carry on: the upload window has closed. Discard it and start again.';
    if (resumeNoticeBtn) resumeNoticeBtn.classList.add('hidden');
    return;
  }

  loadDeps().catch(() => {});   // warm before "Choose the file" (see _handleFileSelection)

  if (resumeNoticeBtn) {
    let resumeInFlight = false;
    resumeNoticeBtn.addEventListener('click', async () => {
      if (resumeInFlight) return;
      resumeInFlight = true;
      await resumeUpload(record, domRefs, state, helpers);
      resumeInFlight = false;
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// resumeUpload — after a refresh: ask for the same file, then carry on (_carryOn).
// ─────────────────────────────────────────────────────────────────────────────
export async function resumeUpload(record, domRefs, state, helpers) {
  if (!record) return;
  const { resumeCard } = domRefs;
  const { formatBytes, reportError, showStopped } = helpers;
  // Back to the resume card with a sentence (file picker cancelled, wrong file).
  const backToCard = (text) => {
    helpers.setView('empty', RESUME_HEAD);
    if (resumeCard) resumeCard.classList.remove('hidden');
    if (domRefs.resumeDetail) domRefs.resumeDetail.textContent = text;
  };

  // ── Mode gate (6-4a): only direct-R2 records supported ────────────────────
  // Pre-6-2 records lack uploadMode / sessionToken and cannot finalise.
  // Discard cleanly rather than taking the legacy relay road.
  // sessionToken was minted at /initiate and stored in the record — no re-credential needed.
  if (record.uploadMode !== 'direct-r2' || !record.sessionToken) {
    await clearResumeState(record.uuid, reportError);
    showStopped(NO_RESUME);
    return;
  }

  const totalChunks = record.totalChunks;
  const resumeFrom  = record.chunkIndex + 1;

  // ── Scheme gate (Share-Crypto-1): link format v2 records only ──────────────
  // An older record can't finish as a v2 link, and every v2 record keeps one
  // hash per sent part: the changed-file check below needs them all.
  const recordHashes = Array.isArray(record.hashes) && record.hashes.length === resumeFrom
    && record.hashes.every(h => /^[0-9a-f]{64}$/.test(h)) ? record.hashes.slice() : null;
  if (record.scheme !== SCHEME || !recordHashes) {
    await clearResumeState(record.uuid, reportError);
    showStopped(NO_RESUME);
    return;
  }

  // B12-1c: the size-signed tail URL is issued once, at /initiate.
  const tailUrl = record.tailUrl || null;
  if (tailUrl && resumeFrom < totalChunks && tailUrl.expires * 1000 <= Date.now()) {
    await clearResumeState(record.uuid, reportError);
    showStopped(NO_RESUME);
    return;
  }

  // ── File prompt + validation ───────────────────────────────────────────────
  // We need the original plaintext bytes for the parts still to send, and to
  // re-encrypt prior chunks when the record can't vouch for them (HARD RULE 1).
  // The picker opens before anything is awaited on the resume path: Safari only
  // opens a file picker inside the click that asked for it (user activation), so
  // loading deps first cost a second click (Share-Upload-3).
  let resumeFile = null;
  try {
    resumeFile = await _promptForResumeFile(record.fileName, record.fileSize, domRefs);
  } catch {
    backToCard('Choose the same file to carry on. Your browser can’t reopen it by itself.');
    return;
  }

  if (!resumeFile) { backToCard('Choose the same file to carry on. Your browser can’t reopen it by itself.'); return; }

  if (resumeFile.name !== record.fileName || resumeFile.size !== record.fileSize) {
    backToCard(`That’s a different file. Choose “${record.fileName}” (${formatBytes(record.fileSize)}) to carry on.`);
    return;
  }

  if (Math.ceil(resumeFile.size / CHUNK_SIZE) !== totalChunks) {
    backToCard(NOT_SAME_FILE);
    reportError('resume_chunk_count', `expected ${totalChunks} got ${Math.ceil(resumeFile.size / CHUNK_SIZE)}`, `uuid:${record.uuid.slice(0,8)}`);
    return;
  }

  if (resumeCard) resumeCard.classList.add('hidden');
  helpers.setView('uploading');
  helpers.setStage('Preparing');
  helpers.setProgress(0, '');

  if (!(await _loadDepsOrSay(domRefs, helpers))) return;

  const expiryTimestamp = record.expiryTimestamp
    || (Math.floor((record.timestamp || Date.now()) / 1000) + (TIER_EXPIRY_SECONDS[record.tier] || FREE_EXPIRY));
  // Share-Upload-6: reuse the sent parts' hashes only for the same file, unchanged
  // since (lastModified). Otherwise _carryOn re-encrypts them and checks each one
  // against the record (expectedHashes, Share-Crypto-1): a different file stops
  // there, before any part is sent.
  const savedHashes = record.fileModified === resumeFile.lastModified ? recordHashes.slice() : [];
  const job = {
    file: resumeFile, uuid: record.uuid, keyHex: record.keyHex, scheme: SCHEME, expectedHashes: recordHashes,
    totalChunks, expiryTimestamp, tier: record.tier || 'free',
    sessionToken: record.sessionToken, tailUrl,
    sealNonceHex: record.sealNonceHex || null, sourceType: record.sourceType || 'file',
    sent: resumeFrom, hashes: savedHashes, urlMap: new Map(), plainHash: null,
    // A resumed upload doesn't record the password or delete setting: left out of the ledger.
    info: { fileName: record.fileName, sizeBytes: record.fileSize, expiryTimestamp },
  };
  await _carryOnOrStop(job, domRefs, state, helpers);
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

function _promptForResumeFile(expectedName, expectedSize, domRefs) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    document.body.appendChild(input);


    let settled = false;
    const onFocus = () => {
      setTimeout(() => {
        if (settled) return;
        settled = true;
        if (document.body.contains(input)) document.body.removeChild(input);
        reject(new Error('File picker cancelled'));
      }, 500);
    };
    window.addEventListener('focus', onFocus, { once: true });

    input.addEventListener('change', () => {
      settled = true;
      window.removeEventListener('focus', onFocus);
      if (document.body.contains(input)) document.body.removeChild(input);
      if (input.files[0]) resolve(input.files[0]);
      else reject(new Error('No file selected'));
    }, { once: true });

    input.click();
  });
}
