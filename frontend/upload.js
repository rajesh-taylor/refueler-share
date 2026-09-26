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
// to all holders (sessionAesKey, sessionIv, uploadUUID set here; read by download.js).
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
  bufToHex,
  hexToBuf,
  WORKER_URL,
  CHUNK_SIZE,
  FREE_CAP,
  FREE_EXPIRY,
  TIER_EXPIRY_SECONDS,
  CHUNK_UPLOAD_TIMEOUT_MS,
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
// Safari upload timeout wrapper
// ─────────────────────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      const err = new Error(`Chunk upload timed out after ${timeoutMs / 1000}s`);
      err.timedOut = true;
      throw err;
    }
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder helpers
// ─────────────────────────────────────────────────────────────────────────────
const FOLDER_MAX_DEPTH  = 20;
const FOLDER_WARN_FILES = 500;
const FOLDER_MAX_FILES  = 2000;
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

const SKIP_COMPRESS_EXTENSIONS = new Set([
  'mov', 'mp4', 'mxf', 'r3d', 'braw', 'ari', 'mkv', 'avi', 'wmv', 'webm', 'm4v', 'mpg', 'mpeg',
  'mp3', 'aac', 'm4a', 'ogg', 'flac', 'opus', 'wma',
  'jpg', 'jpeg', 'heic', 'heif', 'webp', 'avif',
  'zip', 'gz', 'bz2', 'xz', '7z', 'rar',
  'pdf', 'docx', 'xlsx', 'pptx',
]);

function shouldSkipCompression(relativePath) {
  const ext = relativePath.split('.').pop().toLowerCase();
  return SKIP_COMPRESS_EXTENSIONS.has(ext);
}

// ─────────────────────────────────────────────────────────────────────────────
// Zip streaming (fflate)
// ─────────────────────────────────────────────────────────────────────────────
async function zipAndSelect(entries, folderName, domRefs, helpers) {
  const { showZipStage, hideZipCard, handleFileSelection, formatBytes, setDropMsg, reportError } = helpers;
  const zipName  = `${folderName}.zip`;
  const totalBytes = entries.reduce((acc, e) => acc + (e.file.size || 0), 0);

  // Pre-zip RAM guard (Share-6-spec §7) — a folder is read wholly into memory to
  // compress, so refuse BEFORE the read loop when the input already exceeds the
  // cap. The post-zip check further down can't help here: an over-cap folder
  // throws an allocation error mid-compression, before any blob exists, and the
  // user sees only a generic "Compression failed". Guarding on input bytes lets
  // the useful "zip it yourself" copy show instead.
  if (totalBytes > FOLDER_ZIP_CAP) {
    hideZipCard();
    setDropMsg(`This folder is ${formatBytes(totalBytes)}. Folders are held in memory during upload and capped at 2 GB. Zip it yourself and lodge the .zip as a single file — single files stream from disk with no size limit beyond your tier ceiling.`);
    return;
  }

  showZipStage('Compressing', 0, `0 B / ${formatBytes(totalBytes)}`);

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

          let entry;
          if (shouldSkipCompression(relativePath)) {
            entry = new fflate.ZipPassThrough(relativePath);
          } else {
            entry = new fflate.ZipDeflate(relativePath, { level: 6 });
          }
          zipper.add(entry);
          entry.push(data, true);
          // eslint-disable-next-line no-unused-expressions
          buf;

          bytesProcessed += file.size;
          const pct = Math.min(Math.round((bytesProcessed / totalBytes) * 95), 95);
          showZipStage('Compressing', pct, `${formatBytes(bytesProcessed)} / ${formatBytes(totalBytes)}`);
          await new Promise(r => setTimeout(r, 0));
        }
        if (!zipError) {
          showZipStage('Finalising archive', 95, 'Writing zip directory…');
          zipper.end();
        }
      } catch (e) { reject(e); }
    })();
  }).catch(err => {
    reportError('folder_zip', err.message || 'fflate error', folderName.slice(0, 100));
    setDropMsg('Compression failed. Try again or zip the folder manually first.');
    hideZipCard();
    return null;
  });

  if (!zipBlob) return;

  // Folder RAM cap (Share-6-spec §7) — the zip lives entirely in memory; refuse
  // over-cap folders and steer the user to lodging a pre-zipped single file,
  // which streams from disk with no in-RAM ceiling.
  if (zipBlob.size > FOLDER_ZIP_CAP) {
    hideZipCard();
    setDropMsg(`This folder is ${formatBytes(zipBlob.size)} zipped. Folders are held in memory during upload and capped at 2 GB. Zip it yourself and lodge the .zip as a single file — single files stream from disk with no size limit beyond your tier ceiling.`);
    return;
  }

  showZipStage('Compressing', 100, `Ready — ${formatBytes(zipBlob.size)}`);
  await new Promise(r => setTimeout(r, 300));
  hideZipCard();

  const zipFile = new File([zipBlob], zipName, { type: 'application/zip' });
  handleFileSelection(zipFile);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tidal + permanent-record option injection
// ─────────────────────────────────────────────────────────────────────────────
function _injectTransferOptions(domRefs, transferOpts) {
  const { uploadBtn } = domRefs;
  const uploadBtnWrap = uploadBtn.closest('.mt16');
  if (!uploadBtnWrap) return;

  // 1. Destroy-after-download toggle
  const destroyRow = document.createElement('div');
  destroyRow.className = 'mt16';
  destroyRow.id = 'destroy-toggle-row';
  destroyRow.innerHTML = `
    <div class="toggle-row">
      <div>
        <div class="toggle-label">Destroy after download</div>
        <div class="toggle-desc">This transfer is deleted the moment it is downloaded</div>
      </div>
      <label class="switch">
        <input type="checkbox" id="destroy-after-download" />
        <span class="slider"></span>
      </label>
    </div>`;
  uploadBtnWrap.insertAdjacentElement('beforebegin', destroyRow);
  transferOpts.destroyToggle = document.getElementById('destroy-after-download');

  // 2. Amber destroy notice
  const notice = document.createElement('div');
  notice.id = 'destroy-notice';
  notice.className = 'destroy-notice hidden';
  notice.innerHTML = `<strong>Once downloaded, the recipient cannot download again.</strong> Our servers store only encrypted data we can't read as we never hold encryption keys.`;
  destroyRow.insertAdjacentElement('afterend', notice);
  transferOpts.destroyNotice = notice;

  transferOpts.destroyToggle.addEventListener('change', () => {
    notice.classList.toggle('hidden', !transferOpts.destroyToggle.checked);
  });

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
  notice.insertAdjacentElement('afterend', tidal);
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
// Turnstile
// ─────────────────────────────────────────────────────────────────────────────
let turnstileWidgetId      = null;
let turnstileScriptReady   = false;
let pendingTurnstileRender = false;

export function initTurnstile(state, domRefs) {
  window.onTurnstileLoad = function() {
    turnstileScriptReady = true;
    if (pendingTurnstileRender) {
      pendingTurnstileRender = false;
      renderTurnstile(state, domRefs);
    }
  };
}

export function renderTurnstile(state, domRefs, reportError) {
  const container = document.getElementById('cf-turnstile');
  if (!container) return;
  if (!window.turnstile) {
    if (!pendingTurnstileRender) {
      pendingTurnstileRender = true;
      const deadline = Date.now() + 15000;
      const poll = setInterval(() => {
        if (window.turnstile) {
          clearInterval(poll);
          pendingTurnstileRender = false;
          renderTurnstile(state, domRefs, reportError);
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          pendingTurnstileRender = false;
          if (reportError) reportError('turnstile_load', 'Turnstile script did not load within 15s', navigator.userAgent.slice(0, 100));
        }
      }, 200);
    }
    return;
  }
  if (turnstileWidgetId !== null) {
    try { window.turnstile.remove(turnstileWidgetId); } catch(e) {}
    turnstileWidgetId = null;
  }
  container.innerHTML = '';
  const isDarkMode = document.documentElement.dataset.theme === 'carbon';
  turnstileWidgetId = window.turnstile.render(container, {
    sitekey: '0x4AAAAAAD0N7GlHlCRuWITr',
    theme: isDarkMode ? 'dark' : 'light',
    callback: function(token) {
      state.turnstileToken = token;
      domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
    },
    'error-callback': function() {
      state.turnstileToken = null;
      domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
    },
    'expired-callback': function() {
      state.turnstileToken = null;
      domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
    },
  });
}

function _uploadBtnDisabled(state, domRefs) {
  const needsPassphrase = domRefs.passphraseToggle.checked && domRefs.passphraseInput.value.trim().length === 0;
  return !state.selectedFile || needsPassphrase || !state.turnstileToken;
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

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    clearDropMsg();

    const items = e.dataTransfer.items;
    if (items && items.length === 1 && items[0].webkitGetAsEntry) {
      const entry = items[0].webkitGetAsEntry();
      if (entry && entry.isDirectory) {
        _handleFolderDrop(entry, domRefs, state, helpers, transferOpts);
        return;
      }
    }
    if (e.dataTransfer.files.length > 1) { setDropMsg('One file or one folder at a time please.'); return; }
    if (e.dataTransfer.files[0]) _handleFileSelection(e.dataTransfer.files[0], domRefs, state, helpers, transferOpts);
  });

  dropZone.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });

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

  initTurnstile(state, domRefs);

  uploadBtn.addEventListener('click', () =>
    startUpload(domRefs, state, helpers, transferOpts)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// File selection
// ─────────────────────────────────────────────────────────────────────────────
function _handleFileSelection(file, domRefs, state, helpers, transferOpts) {
  const { capWarning, optionsCard, fileNameTag, fileSizeTag } = domRefs;
  const { formatBytes, reportError } = helpers;

  state.selectedFile = file;
  state.sourceType   = 'file'; // reset: folder path sets this to 'folder' before upload
  capWarning.classList.add('hidden');
  optionsCard.classList.add('hidden');
  if (file.size > FREE_CAP) { capWarning.classList.remove('hidden'); return; }
  fileNameTag.textContent = file.name.length > 32 ? file.name.slice(0, 30) + '…' : file.name;
  fileSizeTag.textContent = formatBytes(file.size);
  optionsCard.classList.remove('hidden');
  state.turnstileToken = null;
  const tsWrap = document.getElementById('turnstile-wrap');
  if (tsWrap) tsWrap.classList.remove('hidden');
  renderTurnstile(state, domRefs, reportError);
  domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
}

async function _handleFolderDrop(directoryEntry, domRefs, state, helpers, transferOpts) {
  const { setDropMsg, showZipStage, hideZipCard, reportError } = helpers;
  if (typeof fflate === 'undefined') {
    setDropMsg('Compression library unavailable. Please zip the folder manually and upload the .zip file.');
    return;
  }
  showZipStage('Gathering', 0, 'Reading folder…');
  let files;
  try {
    files = await readDirectoryEntry(directoryEntry);
  } catch (e) {
    reportError('folder_read', e.message, 'drag_entry');
    setDropMsg(e.message.includes('nested more than')
      ? e.message
      : 'Could not read the dropped folder. Try the "Upload folder" button instead.');
    hideZipCard();
    return;
  }
  if (files.length === 0) { setDropMsg('That folder appears to be empty.'); hideZipCard(); return; }
  if (files.length > FOLDER_MAX_FILES) {
    setDropMsg(`This folder contains ${files.length.toLocaleString()} files — the maximum is ${FOLDER_MAX_FILES.toLocaleString()}. Please zip it manually and upload the .zip file.`);
    hideZipCard();
    return;
  }
  if (files.length > FOLDER_WARN_FILES) setDropMsg(`Large folder (${files.length.toLocaleString()} files) — this may take a moment.`);

  const totalUncompressedBytes = files.reduce((acc, e) => acc + (e.file.size || 0), 0);
  if (totalUncompressedBytes > FREE_CAP) {
    hideZipCard();
    domRefs.capWarning.classList.remove('hidden');
    return;
  }

  const folderName = directoryEntry.name || 'folder';
  await zipAndSelect(files, folderName, domRefs, { ...helpers, handleFileSelection: (f) => _handleFileSelection(f, domRefs, state, helpers, transferOpts) });
  // Part C: set AFTER zipAndSelect — _handleFileSelection (called inside zip) resets to 'file';
  // setting here overwrites that after the zip+selection chain completes.
  state.sourceType = 'folder';
}

async function _handleFolderFiles(fileList, domRefs, state, helpers, transferOpts) {
  const { setDropMsg, showZipStage, hideZipCard } = helpers;
  if (fileList.length === 0) return;
  if (typeof fflate === 'undefined') {
    setDropMsg('Compression library unavailable. Please zip the folder manually and upload the .zip file.');
    return;
  }
  if (fileList.length > FOLDER_MAX_FILES) {
    setDropMsg(`This folder contains ${fileList.length.toLocaleString()} files — the maximum is ${FOLDER_MAX_FILES.toLocaleString()}. Please zip it manually and upload the .zip file.`);
    return;
  }
  if (fileList.length > FOLDER_WARN_FILES) setDropMsg(`Large folder (${fileList.length.toLocaleString()} files) — this may take a moment.`);

  showZipStage('Gathering', 0, `${fileList.length} file${fileList.length !== 1 ? 's' : ''} found`);

  const firstPath = fileList[0].webkitRelativePath || fileList[0].name;
  const folderName = firstPath.includes('/') ? firstPath.split('/')[0] : 'folder';

  const entries = fileList.map(f => {
    const rel      = f.webkitRelativePath || f.name;
    const stripped = rel.includes('/') ? rel.slice(rel.indexOf('/') + 1) : rel;
    return { relativePath: sanitisePath(stripped), file: f };
  }).filter(e => e.relativePath.length > 0);

  const totalUncompressedBytes = entries.reduce((acc, e) => acc + (e.file.size || 0), 0);
  if (totalUncompressedBytes > FREE_CAP) {
    hideZipCard();
    domRefs.capWarning.classList.remove('hidden');
    return;
  }

  await zipAndSelect(entries, folderName, domRefs, { ...helpers, handleFileSelection: (f) => _handleFileSelection(f, domRefs, state, helpers, transferOpts) });
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
    throw new Error(`URL batch ${from} failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  return body.urls || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// _putChunkDirect — PUT one encrypted chunk to R2 via a presigned URL.
// Returns the ETag string (R2 ACK). Implements Share-5 retry budget (6 attempts).
// ─────────────────────────────────────────────────────────────────────────────
const _DIRECT_RETRY_DELAYS = [2000, 5000, 15000, 30000, 60000];
const _DIRECT_MAX_ATTEMPTS = _DIRECT_RETRY_DELAYS.length + 1; // 6

async function _putChunkDirect(presignedUrl, encryptedBytes, chunkIndex, uuid, reportError) {
  let lastErr;
  for (let attempt = 0; attempt < _DIRECT_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: encryptedBytes,
      }, CHUNK_UPLOAD_TIMEOUT_MS);

      if (res.ok) {
        const etag = res.headers.get('ETag') || res.headers.get('etag') || '';
        return etag.replace(/"/g, '');
      }

      // 403 = signature invalid / URL reused — unrecoverable without a new URL
      if (res.status === 403) {
        const txt = await res.text().catch(() => '');
        reportError('direct_put_403', `chunk ${chunkIndex} 403 — URL invalid`, `uuid:${uuid.slice(0, 8)} attempt:${attempt} ${txt.slice(0, 80)}`);
        throw new Error(`Chunk ${chunkIndex} direct PUT 403: presigned URL rejected`);
      }

      if (res.status === 429) {
        const waitMs = _DIRECT_RETRY_DELAYS[attempt] ?? 60000;
        reportError('direct_put_429', `chunk ${chunkIndex} 429 attempt ${attempt}`, `uuid:${uuid.slice(0, 8)}`);
        lastErr = new Error('HTTP 429');
        if (attempt < _DIRECT_MAX_ATTEMPTS - 1) await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (res.status < 500) {
        const txt = await res.text().catch(() => '');
        reportError('direct_put_4xx', `chunk ${chunkIndex} HTTP ${res.status}`, `uuid:${uuid.slice(0, 8)} ${txt.slice(0, 80)}`);
        throw new Error(`Chunk ${chunkIndex} direct PUT: HTTP ${res.status}`);
      }

      lastErr = new Error(`HTTP ${res.status}`);
      reportError('direct_put_5xx', `chunk ${chunkIndex} HTTP ${res.status} attempt ${attempt}`, `uuid:${uuid.slice(0, 8)}`);
    } catch (e) {
      if (e.message?.includes('direct PUT')) throw e; // fatal — propagate immediately
      lastErr = e;
      if (e.timedOut) {
        reportError('direct_put_timeout', `chunk ${chunkIndex} timed out attempt ${attempt}`, `uuid:${uuid.slice(0, 8)}`);
      } else {
        reportError('direct_put_err', `chunk ${chunkIndex} attempt ${attempt}: ${e.message?.slice(0, 80)}`, `uuid:${uuid.slice(0, 8)}`);
      }
    }
    if (attempt < _DIRECT_MAX_ATTEMPTS - 1) await new Promise(r => setTimeout(r, _DIRECT_RETRY_DELAYS[attempt] ?? 60000));
  }
  throw new Error(`Chunk ${chunkIndex} direct PUT failed after ${_DIRECT_MAX_ATTEMPTS} attempts: ${lastErr?.message}`);
}

async function startUpload(domRefs, state, helpers, transferOpts) {
  if (!state.selectedFile) return;
  const {
    uploadBtn, optionsCard, progressCard, progressBar, progressDetail,
    passphraseToggle, passphraseInput,
  } = domRefs;
  const { setStage, setProgress, formatBytes, reportError, showSharePanel } = helpers;

  uploadBtn.disabled = true;
  optionsCard.classList.add('hidden');
  progressCard.classList.remove('hidden');

  await loadDeps();

  setStage('Generating key', 5);
  state.sessionAesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  state.sessionIv     = crypto.getRandomValues(new Uint8Array(12));
  const rawKey  = await crypto.subtle.exportKey('raw', state.sessionAesKey);
  const keyHex  = bufToHex(rawKey);
  const ivHex   = bufToHex(state.sessionIv);

  let p2shHashHex = null;
  if (passphraseToggle.checked && passphraseInput.value.trim()) {
    setStage('Hashing password', 8);
    p2shHashHex = await sha256Hex(new TextEncoder().encode(passphraseInput.value.trim()));
    passphraseInput.value = '';
  }

  setStage('Chunking', 10);
  const chunks      = _splitChunks(state.selectedFile, CHUNK_SIZE);
  const totalChunks = chunks.length;
  const chunkHashes = [];

  setStage('Credentialling', 12);
  const { blindedMsg, blindingFactor } = await generateBlindedCredential();
  let _credPct = 12;
  const _credTick = setInterval(() => { if (_credPct < 14) { _credPct += 0.5; progressBar.style.width = _credPct + '%'; } }, 120);

  const issueRes = await fetch(`${WORKER_URL}/credential/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turnstile_token: state.turnstileToken, blinded_message: blindedMsg, tier: 'free' }),
  });
  clearInterval(_credTick);

  if (!issueRes.ok) {
    const errText = await issueRes.text();
    reportError('credential_issue', `HTTP ${issueRes.status}`, errText.slice(0, 200));
    throw new Error(`Credential issue failed: ${errText}`);
  }
  const { signed_point, mint_pubkey, uuid: issuedUuid, issued_tier: issuedTier, commitment } = await issueRes.json();
  if (!issuedUuid || !commitment || !issuedTier) throw new Error('Credential issue response missing uuid, commitment, or issued_tier');
  state.uploadUUID = issuedUuid;
  const credential = await unblindSignature(signed_point, blindingFactor, mint_pubkey);

  _updatePaidFeaturesVisibility(issuedTier, transferOpts);

  setStage('Uploading', 15);
  const expiryTimestamp = Math.floor(Date.now() / 1000) + FREE_EXPIRY;

  const destroyAfterDownload = transferOpts.destroyToggle && transferOpts.destroyToggle.checked ? '1' : null;
  const availableFromUnix    = _pickerToUnix(transferOpts.availableFrom);
  const availableUntilUnix   = _pickerToUnix(transferOpts.availableUntil);

  const tidalErr = _validateTidal(availableFromUnix, availableUntilUnix, expiryTimestamp);
  if (tidalErr) {
    _showTidalError(tidalErr, transferOpts);
    uploadBtn.disabled = false;
    optionsCard.classList.remove('hidden');
    progressCard.classList.add('hidden');
    return;
  }

  const isPaidTier = issuedTier && issuedTier !== 'free' && issuedTier !== 'citizen';
  const wantsPermanentRecord = isPaidTier && transferOpts.permanentRecordToggle && transferOpts.permanentRecordToggle.checked;
  const sealNonceHex = wantsPermanentRecord ? generateSealNonce() : null;

  // Streaming BLAKE3 plaintext root — incremental update per chunk (TH-2)
  const blake3PlaintextHash = wantsPermanentRecord ? blake3CreateHash() : null;

  // ── Direct-to-R2 upload path (Share-6-6b: only path) ─────────────────────

    setStage('Initiating', 15);

    // handleInitiate reads headers, not JSON body — matches legacy chunk-0 header schema.
    const initiateHeaders = {
      'X-Cashu-Credential':      credential,
      'X-Credential-Commitment': commitment,
      'X-Issued-Tier':           issuedTier,
      'X-Total-Chunks':          String(totalChunks),
      'X-Total-Bytes':           String(state.selectedFile.size),
      'X-Expiry-Timestamp':      String(expiryTimestamp),
      'X-File-Name':             'encrypted-payload', // D-1 invariant
    };
    if (p2shHashHex)          initiateHeaders['X-P2SH-Secret-Hash']       = p2shHashHex;
    if (destroyAfterDownload) initiateHeaders['X-Destroy-After-Download'] = '1';
    if (availableFromUnix)    initiateHeaders['X-Available-From']         = String(availableFromUnix);
    if (availableUntilUnix)   initiateHeaders['X-Available-Until']        = String(availableUntilUnix);

    const initRes = await fetch(`${WORKER_URL}/upload/${state.uploadUUID}/initiate`, {
      method: 'POST',
      headers: initiateHeaders,
    });
    if (!initRes.ok) {
      const txt = await initRes.text().catch(() => '');
      reportError('initiate', `HTTP ${initRes.status}`, txt.slice(0, 200));
      throw new Error(`Initiate failed: HTTP ${initRes.status} — ${txt.slice(0, 120)}`);
    }
    const initData     = await initRes.json();
    const sessionToken = initData.session_token;

    // URL map: index → presigned URL. First batch arrives in initiate response.
    const urlMap = new Map();
    for (const entry of (initData.urls || [])) urlMap.set(entry.index, entry.url);
    let batchNext = initData.batch_next; // null when all URLs delivered upfront (≤ 256 chunks)

    setStage('Uploading', 18);

    for (let i = 0; i < totalChunks; i++) {
      // Fetch the next URL batch on demand (chunks > 256)
      if (!urlMap.has(i)) {
        if (batchNext === null) throw new Error(`No presigned URL for chunk ${i} and no batch_next`);
        const newUrls = await _fetchNextUrlBatch(state.uploadUUID, sessionToken, batchNext, 256, reportError);
        for (const entry of newUrls) urlMap.set(entry.index, entry.url);
        const maxIdx = newUrls.length > 0 ? Math.max(...newUrls.map(e => e.index)) : batchNext - 1;
        batchNext = (maxIdx + 1 < totalChunks) ? maxIdx + 1 : null;
      }

      const presignedUrl = urlMap.get(i);
      if (!presignedUrl) throw new Error(`Presigned URL for chunk ${i} missing after batch fetch`);

      const raw = await _readChunk(chunks[i]); // fresh FileReader per chunk — fixes NotReadableError
      if (blake3PlaintextHash) blake3PlaintextHash.update(new Uint8Array(raw));

      const aad = new Uint8Array(4);
      new DataView(aad.buffer).setUint32(0, i, false); // AAD index = object index = Merkle leaf
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: state.sessionIv, additionalData: aad },
        state.sessionAesKey, raw
      );

      let chunkHashHex;
      try {
        chunkHashHex = blake3Hash(new Uint8Array(encrypted));
      } catch (e) {
        reportError('blake3_hash', e.message, `uuid:${state.uploadUUID.slice(0, 8)} chunk:${i}`);
        throw e;
      }
      chunkHashes.push(chunkHashHex);

      await _putChunkDirect(presignedUrl, encrypted, i, state.uploadUUID, reportError);

      writeChunkState({
        uuid: state.uploadUUID, chunkIndex: i, totalChunks,
        fileName: state.selectedFile.name, fileSize: state.selectedFile.size,
        keyHex, ivHex, tier: issuedTier, expiryTimestamp, timestamp: Date.now(),
        sealNonceHex: sealNonceHex || undefined,
        uploadMode: 'direct-r2', sessionToken, // Share-6: resume will need these
        sourceType: state.sourceType || 'file', // Part C: folder detection for FOLDER-RESUME discard
      }, reportError).catch(() => {});

      setProgress(Math.round(((i + 1) / totalChunks) * 77) + 18, `${i + 1} / ${totalChunks} chunks`);
    }

    clearResumeState(state.uploadUUID, reportError).catch(() => {});

    let permanentRecordOk = false;
    if (wantsPermanentRecord && blake3PlaintextHash && sealNonceHex) {
      setStage('Anchoring to Bitcoin', 97);
      const blake3PlaintextRoot = blake3PlaintextHash.digest('hex');
      const prResult = await runPermanentRecord(state.uploadUUID, blake3PlaintextRoot, sealNonceHex, state.sessionAesKey);
      permanentRecordOk = prResult.ok;
      if (!prResult.ok) reportError('permanent_record', prResult.error || 'unknown', `uuid:${state.uploadUUID.slice(0, 8)}`);
    }

    // ── Share-6-3d: finalise the transfer ─────────────────────────────────────
    // Client-authoritative CIPHERTEXT-chunk Merkle root over the per-chunk
    // ciphertext-object digests accumulated in chunkHashes (hex, index order).
    // buildMerkleTree (frontend/merkle.js) applies the RFC-6962 leaf/node domain
    // separation internally — feed it the RAW 32-byte digests. Do NOT prepend the
    // session IV (NONCE trap): the leaves must equal BLAKE3 of the exact stored
    // bytes the Worker re-hashes at download, or every transfer 409-walls at 6-5.
    // This is the ciphertext root ONLY — never blake3PlaintextRoot above (TWO ROOTS).
    setStage('Finalising', 98);

    const leaves = chunkHashes.map(hex => new Uint8Array(hexToBuf(hex)));
    const { root: merkleRootBytes } = buildMerkleTree(leaves);
    const finaliseBody = {
      hashes:      leaves.map(_bytesToB64url), // b64url(raw 32B digest) × total_chunks
      merkle_root: _bytesToB64url(merkleRootBytes),
      // tree_algo is NOT sent — the Worker pins 'rfc6962-unbalanced-blake3-v1'.
    };

    let finRes;
    try {
      finRes = await fetch(`${WORKER_URL}/upload/${state.uploadUUID}/finalise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Upload-Session': sessionToken },
        body: JSON.stringify(finaliseBody),
      });
    } catch (e) {
      reportError('finalise_fetch', e.message?.slice(0, 120), `uuid:${state.uploadUUID.slice(0, 8)}`);
      progressDetail.textContent = 'Finalise failed (network) — transfer not complete. Please try again.';
      return; // no share URL for an unfinalised transfer
    }

    if (finRes.status === 409) {
      let missing = [];
      try { missing = (await finRes.json()).missing || []; } catch { /* not JSON */ }
      reportError('finalise_incomplete', `${missing.length} missing: ${missing.slice(0, 20).join(',')}`, `uuid:${state.uploadUUID.slice(0, 8)}`);
      progressDetail.textContent = `Finalise failed — ${missing.length} chunk(s) missing at storage. Transfer not complete.`;
      return; // no share URL
    }

    if (!finRes.ok) {
      const txt = await finRes.text().catch(() => '');
      reportError('finalise_status', `HTTP ${finRes.status}`, `uuid:${state.uploadUUID.slice(0, 8)} ${txt.slice(0, 120)}`);
      progressDetail.textContent = `Finalise failed (HTTP ${finRes.status}) — transfer not complete. Please try again.`;
      return; // no share URL
    }

    // 200 { ok:true, merkle_root } — transfer complete and ciphertext-verifiable.
    setStage('Done', 100);
    progressDetail.textContent = wantsPermanentRecord
      ? (permanentRecordOk ? 'Transfer complete — date seal submitted ✓' : 'Transfer complete — date seal failed (transfer still available)')
      : 'Transfer complete';
    await new Promise(r => setTimeout(r, 700));
    progressCard.classList.add('hidden');

    const keyBytesRaw2 = new Uint8Array(await crypto.subtle.exportKey('raw', state.sessionAesKey));
    const fragmentBlob2 = assembleFragment({
      keyBytes:  keyBytesRaw2,
      ivBytes:   new Uint8Array(state.sessionIv),
      filename:  state.selectedFile.name,
      sealNonce: sealNonceHex ? new Uint8Array(hexToBuf(sealNonceHex)) : undefined,
    });
    const shareUrl2 = `${location.origin}${location.pathname}?uuid=${state.uploadUUID}#${fragmentBlob2}`;
    history.replaceState(null, '', location.pathname);
    showSharePanel(shareUrl2, !!p2shHashHex);
    return;

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
      helpers.setDropMsg('Folder uploads cannot be resumed — please start a new upload.');
    }
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

  const pct    = Math.round((record.chunkIndex + 1) / record.totalChunks * 100);
  const detail = `${record.fileName} — ${pct}% uploaded (chunk ${record.chunkIndex + 1} of ${record.totalChunks}, ${formatBytes(record.fileSize)})`;
  if (resumeDetail) resumeDetail.textContent = detail;

  const resumeNote = document.getElementById('resume-note');
  if (resumeNote) resumeNote.classList.remove('hidden');
  if (resumeCard) resumeCard.classList.remove('hidden');

  if (resumeDiscardBtn) {
    resumeDiscardBtn.addEventListener('click', async () => {
      await clearResumeState(record.uuid, helpers.reportError);
      if (resumeCard) resumeCard.classList.add('hidden');
    }, { once: true });
  }

  if (expired) {
    if (resumeDetail) resumeDetail.textContent = `${record.fileName} — transfer window has expired. Discard and start a new transfer.`;
    if (resumeNoticeBtn) resumeNoticeBtn.classList.add('hidden');
    return;
  }

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
// resumeUpload
// ─────────────────────────────────────────────────────────────────────────────
export async function resumeUpload(record, domRefs, state, helpers) {
  if (!record) return;
  const { resumeCard, progressCard, progressDetail } = domRefs;
  const { setStage, setProgress, formatBytes, reportError, showSharePanel } = helpers;

  if (resumeCard) resumeCard.classList.add('hidden');
  progressCard.classList.remove('hidden');
  setStage('Resuming', 5);

  // ── Mode gate (6-4a): only direct-R2 records supported ────────────────────
  // Pre-6-2 records lack uploadMode / sessionToken and cannot finalise.
  // Discard cleanly rather than taking the legacy relay road.
  if (record.uploadMode !== 'direct-r2') {
    await clearResumeState(record.uuid, reportError);
    progressDetail.textContent = 'This transfer cannot be resumed — please start a new upload.';
    setStage('', 0);
    return;
  }

  await loadDeps();

  // Restore AES-GCM key + session IV from the record.
  // Per-chunk AAD (4-byte BE uint32 index) differentiates chunks; session IV is shared.
  const keyBytes = hexToBuf(record.keyHex);
  const ivBytes  = hexToBuf(record.ivHex);
  state.sessionAesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  state.sessionIv     = new Uint8Array(ivBytes);
  state.uploadUUID    = record.uuid;

  const totalChunks     = record.totalChunks;
  const resumeFrom      = record.chunkIndex + 1;
  const expiryTimestamp = record.expiryTimestamp
    || (Math.floor((record.timestamp || Date.now()) / 1000) + (TIER_EXPIRY_SECONDS[record.tier] || FREE_EXPIRY));
  const sealNonceHex    = record.sealNonceHex || null;
  // sessionToken was minted at /initiate and stored in the record — no re-credential needed.
  const sessionToken    = record.sessionToken;

  if (!sessionToken) {
    await clearResumeState(record.uuid, reportError);
    progressDetail.textContent = 'Resume record is incomplete — please start a new upload.';
    setStage('', 0);
    return;
  }

  setStage(`Resuming from chunk ${resumeFrom + 1} of ${totalChunks}`, 10);

  // ── File prompt + validation ───────────────────────────────────────────────
  // We need the original plaintext bytes to re-encrypt prior chunks (HARD RULE 1).
  let resumeFile = null;
  try {
    resumeFile = await _promptForResumeFile(record.fileName, record.fileSize, domRefs);
  } catch {
    progressCard.classList.add('hidden');
    if (resumeCard) resumeCard.classList.remove('hidden');
    const resumeDetail = domRefs.resumeDetail;
    if (resumeDetail) resumeDetail.textContent = `${record.fileName} — select the same file to resume.`;
    return;
  }

  if (!resumeFile) { progressCard.classList.add('hidden'); if (resumeCard) resumeCard.classList.remove('hidden'); return; }

  if (resumeFile.name !== record.fileName || resumeFile.size !== record.fileSize) {
    progressCard.classList.add('hidden');
    if (resumeCard) resumeCard.classList.remove('hidden');
    const resumeDetail = domRefs.resumeDetail;
    if (resumeDetail) resumeDetail.textContent = `File mismatch — expected "${record.fileName}" (${formatBytes(record.fileSize)}). Please select the original file.`;
    return;
  }

  const chunks = _splitChunks(resumeFile, CHUNK_SIZE);
  if (chunks.length !== record.totalChunks) {
    progressCard.classList.add('hidden');
    if (resumeCard) resumeCard.classList.remove('hidden');
    const resumeDetail = domRefs.resumeDetail;
    if (resumeDetail) resumeDetail.textContent = `File layout mismatch (expected ${record.totalChunks} chunks, got ${chunks.length}). Start a new transfer.`;
    reportError('resume_chunk_count', `expected ${record.totalChunks} got ${chunks.length}`, `uuid:${record.uuid.slice(0,8)}`);
    return;
  }

  // ── Probe session token before CPU work ────────────────────────────────────
  // 401 = sessionToken expired (transfer window closed) or finalise already spent it.
  // 409 = upload_complete (finalise already ran — stale IDB record).
  // Both are terminal: clear the record and surface a clean message.
  const remaining = totalChunks - resumeFrom;

  if (remaining > 0) {
    let probeRes;
    try {
      probeRes = await fetch(`${WORKER_URL}/upload/${record.uuid}/urls`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Upload-Session': sessionToken },
        body:    JSON.stringify({ from: resumeFrom, count: Math.min(remaining, 256) }),
      });
    } catch (e) {
      reportError('resume_urls_fetch', e.message?.slice(0, 80), `uuid:${record.uuid.slice(0, 8)}`);
      progressDetail.textContent = 'Could not reach the server — check your connection and try again.';
      return;
    }

    if (probeRes.status === 401 || probeRes.status === 409) {
      await clearResumeState(record.uuid, reportError);
      progressDetail.textContent = 'This transfer can no longer be resumed — please start a new upload.';
      return;
    }

    if (!probeRes.ok) {
      const txt = await probeRes.text().catch(() => '');
      reportError('resume_urls_status', `HTTP ${probeRes.status}`, `uuid:${record.uuid.slice(0, 8)} ${txt.slice(0, 80)}`);
      progressDetail.textContent = `Could not fetch upload URLs (HTTP ${probeRes.status}) — please try again.`;
      return;
    }

    // Populate the URL map from the initial batch.
    const initBody = await probeRes.json();
    var urlMap    = new Map();
    for (const entry of (initBody.urls || [])) urlMap.set(entry.index, entry.url);
    const maxInitIdx = initBody.urls?.length > 0 ? Math.max(...initBody.urls.map(e => e.index)) : resumeFrom - 1;
    var batchNext    = (maxInitIdx + 1 < totalChunks) ? maxInitIdx + 1 : null;
  } else {
    // remaining === 0: all chunks already in R2 but finalise was interrupted.
    // Fall through to the re-hash loop (which covers all chunks) then finalise.
    var urlMap    = new Map();
    var batchNext = null;
  }

  // ── HARD RULE 1: re-encrypt prior chunks to rebuild ciphertext hashes ───────
  // Exactly the same key + session IV + 4-byte BE uint32 AAD as startUpload.
  // Hash the CIPHERTEXT — these are the Merkle leaves for /finalise.
  // Parity is proven by the acceptance-gate root-equality check (not by inspection).
  const chunkHashes = [];
  setStage('Verifying prior chunks', 12);
  for (let i = 0; i < resumeFrom; i++) {
    const raw = await _readChunk(chunks[i]);
    const aad = new Uint8Array(4);
    new DataView(aad.buffer).setUint32(0, i, false);
    let encrypted;
    try {
      encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: state.sessionIv, additionalData: aad },
        state.sessionAesKey, raw
      );
    } catch (e) {
      reportError('resume_encrypt', e.message, `uuid:${record.uuid.slice(0, 8)} chunk:${i}`);
      throw e;
    }
    let h;
    try { h = blake3Hash(new Uint8Array(encrypted)); } catch (e) {
      reportError('resume_hash', e.message, `uuid:${record.uuid.slice(0, 8)} chunk:${i}`);
      throw e;
    }
    chunkHashes.push(h);
    const pct = Math.round(((i + 1) / Math.max(resumeFrom, 1)) * 10) + 12;
    setProgress(pct, `Verifying chunk ${i + 1} of ${resumeFrom}…`);
  }

  // ── Upload remaining chunks to R2 via presigned URLs ──────────────────────
  // Mirrors startUpload's direct-R2 loop exactly: encrypt → blake3Hash → PUT.
  setStage(`Uploading from chunk ${resumeFrom + 1} of ${totalChunks}`, 22);

  for (let i = resumeFrom; i < totalChunks; i++) {
    // Page URL batches on demand (> 256 remaining chunks)
    if (!urlMap.has(i)) {
      if (batchNext === null) throw new Error(`No presigned URL for chunk ${i} and no batch_next`);
      const newUrls = await _fetchNextUrlBatch(record.uuid, sessionToken, batchNext, 256, reportError);
      for (const entry of newUrls) urlMap.set(entry.index, entry.url);
      const maxIdx = newUrls.length > 0 ? Math.max(...newUrls.map(e => e.index)) : batchNext - 1;
      batchNext = (maxIdx + 1 < totalChunks) ? maxIdx + 1 : null;
    }

    const presignedUrl = urlMap.get(i);
    if (!presignedUrl) throw new Error(`Presigned URL for chunk ${i} missing after batch fetch`);

    const raw = await _readChunk(chunks[i]);
    const aad = new Uint8Array(4);
    new DataView(aad.buffer).setUint32(0, i, false);
    let encrypted;
    try {
      encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: state.sessionIv, additionalData: aad },
        state.sessionAesKey, raw
      );
    } catch (e) {
      reportError('resume_encrypt_chunk', e.message, `uuid:${record.uuid.slice(0, 8)} chunk:${i}`);
      throw e;
    }

    let chunkHashHex;
    try {
      chunkHashHex = blake3Hash(new Uint8Array(encrypted));
    } catch (e) {
      reportError('resume_blake3_hash', e.message, `uuid:${record.uuid.slice(0, 8)} chunk:${i}`);
      throw e;
    }
    chunkHashes.push(chunkHashHex);

    await _putChunkDirect(presignedUrl, encrypted, i, record.uuid, reportError);

    writeChunkState({
      uuid: record.uuid, chunkIndex: i, totalChunks,
      fileName: record.fileName, fileSize: record.fileSize,
      keyHex: record.keyHex, ivHex: record.ivHex,
      tier: record.tier || 'free', expiryTimestamp, timestamp: Date.now(),
      sealNonceHex: sealNonceHex || undefined,
      uploadMode: 'direct-r2', sessionToken,
      sourceType: record.sourceType || 'file',
    }, reportError).catch(() => {});

    const uploadedChunks  = i - resumeFrom + 1;
    const remainingChunks = totalChunks - resumeFrom || 1;
    setProgress(Math.round(22 + (uploadedChunks / remainingChunks) * 71), `Chunk ${i + 1} of ${totalChunks} sent`);
  }

  clearResumeState(record.uuid, reportError).catch(() => {});

  // ── Finalise — identical to 6-3d block in startUpload (TWO ROOTS: ciphertext only) ──
  setStage('Finalising', 95);

  const leaves = chunkHashes.map(hex => new Uint8Array(hexToBuf(hex)));
  const { root: merkleRootBytes } = buildMerkleTree(leaves);
  const finaliseBody = {
    hashes:      leaves.map(_bytesToB64url),
    merkle_root: _bytesToB64url(merkleRootBytes),
    // tree_algo NOT sent — Worker pins 'rfc6962-unbalanced-blake3-v1'.
  };

  let finRes;
  try {
    finRes = await fetch(`${WORKER_URL}/upload/${record.uuid}/finalise`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upload-Session': sessionToken },
      body:    JSON.stringify(finaliseBody),
    });
  } catch (e) {
    reportError('finalise_fetch', e.message?.slice(0, 120), `uuid:${record.uuid.slice(0, 8)}`);
    progressDetail.textContent = 'Finalise failed (network) — transfer not complete. Please try again.';
    return; // no share URL for an unfinalised transfer (HARD RULE 4 — IDB already cleared above)
  }

  if (finRes.status === 409) {
    let missing = [];
    try { missing = (await finRes.json()).missing || []; } catch { /* not JSON */ }
    reportError('finalise_incomplete', `${missing.length} missing: ${missing.slice(0, 20).join(',')}`, `uuid:${record.uuid.slice(0, 8)}`);
    progressDetail.textContent = `Finalise failed — ${missing.length} chunk(s) missing at storage. Transfer not complete.`;
    return;
  }

  if (!finRes.ok) {
    const txt = await finRes.text().catch(() => '');
    reportError('finalise_status', `HTTP ${finRes.status}`, `uuid:${record.uuid.slice(0, 8)} ${txt.slice(0, 120)}`);
    progressDetail.textContent = `Finalise failed (HTTP ${finRes.status}) — transfer not complete. Please try again.`;
    return;
  }

  // 200 { ok:true, merkle_root } — transfer complete and ciphertext-verifiable.
  setStage('Done', 100);
  progressDetail.textContent = 'Transfer resumed and complete';
  await new Promise(r => setTimeout(r, 700));
  progressCard.classList.add('hidden');

  // Fragment grammar v1 (D-1): real filename + key + IV in URL fragment only.
  const resumeFragmentBlob = assembleFragment({
    keyBytes:  new Uint8Array(hexToBuf(record.keyHex)),
    ivBytes:   new Uint8Array(hexToBuf(record.ivHex)),
    filename:  record.fileName,
    sealNonce: sealNonceHex ? new Uint8Array(hexToBuf(sealNonceHex)) : undefined,
  });
  const shareUrl = `${location.origin}${location.pathname}?uuid=${record.uuid}#${resumeFragmentBlob}`;
  history.replaceState(null, '', location.pathname);
  showSharePanel(shareUrl, false);
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

    const resumeDetail = domRefs.resumeDetail;
    if (resumeDetail) resumeDetail.textContent = `Select the original file to resume: "${expectedName}" (${expectedSize} bytes)`;

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
