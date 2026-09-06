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
  notice.innerHTML = `<strong>Once downloaded, this transfer is gone.</strong> The recipient cannot return to it. Send only when you are certain.`;
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

// ─────────────────────────────────────────────────────────────────────────────
// enterUploadMode — wire all upload-side events
// ─────────────────────────────────────────────────────────────────────────────
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

  const folderName = directoryEntry.name || 'folder';
  await zipAndSelect(files, folderName, domRefs, { ...helpers, handleFileSelection: (f) => _handleFileSelection(f, domRefs, state, helpers, transferOpts) });
}

async function _handleFolderFiles(fileList, domRefs, state, helpers, transferOpts) {
  const { setDropMsg, showZipStage } = helpers;
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

  await zipAndSelect(entries, folderName, domRefs, { ...helpers, handleFileSelection: (f) => _handleFileSelection(f, domRefs, state, helpers, transferOpts) });
}

// ─────────────────────────────────────────────────────────────────────────────
// startUpload — main upload state machine
// ─────────────────────────────────────────────────────────────────────────────
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

  const CHUNK_RETRY_DELAYS = [2000, 5000, 10000];

  for (let i = 0; i < totalChunks; i++) {
    const raw = await _readChunk(chunks[i]);

    if (blake3PlaintextHash) {
      blake3PlaintextHash.update(new Uint8Array(raw));
    }

    const aad = new Uint8Array(4);
    new DataView(aad.buffer).setUint32(0, i, false);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: state.sessionIv, additionalData: aad },
      state.sessionAesKey, raw
    );

    let chunkHashHex;
    try {
      chunkHashHex = blake3Hash(new Uint8Array(encrypted));
    } catch (e) {
      reportError('blake3_hash', e.message, `uuid:${state.uploadUUID.slice(0,8)} chunk:${i}`);
      throw e;
    }
    chunkHashes.push(chunkHashHex);
    const rollingRoot = blake3Hash(new TextEncoder().encode(chunkHashes.join('')));

    const headers = {
      'Content-Type': 'application/octet-stream',
      'X-Blake3-Chunk-Hash': chunkHashHex,
      'X-Blake3-Root': rollingRoot,
    };
    if (i === 0) {
      headers['X-Cashu-Credential']      = credential;
      headers['X-Total-Chunks']          = String(totalChunks);
      headers['X-Total-Bytes']           = String(state.selectedFile.size);
      headers['X-Tier']                  = 'free';
      headers['X-Expiry-Timestamp']      = String(expiryTimestamp);
      headers['X-File-Name']             = state.selectedFile.name;
      headers['X-Credential-Commitment'] = commitment;
      headers['X-Issued-Tier']           = issuedTier;
      if (p2shHashHex)          headers['X-P2SH-Secret-Hash']       = p2shHashHex;
      if (destroyAfterDownload) headers['X-Destroy-After-Download'] = destroyAfterDownload;
      if (availableFromUnix)    headers['X-Available-From']         = String(availableFromUnix);
      if (availableUntilUnix)   headers['X-Available-Until']        = String(availableUntilUnix);
    }

    let lastErr;
    let uploaded = false;
    for (let attempt = 0; attempt <= CHUNK_RETRY_DELAYS.length; attempt++) {
      try {
        const res = await fetchWithTimeout(
          `${WORKER_URL}/upload/${state.uploadUUID}/${String(i).padStart(4, '0')}`,
          { method: 'PUT', headers, body: encrypted },
          CHUNK_UPLOAD_TIMEOUT_MS
        );
        if (res.status >= 400 && res.status < 500) {
          const errText = await res.text();
          reportError('upload_chunk', `HTTP ${res.status} chunk ${i}`, `uuid:${state.uploadUUID.slice(0,8)} chunk:${i} text:${errText.slice(0,100)}`);
          throw new Error(`Chunk ${i} upload failed: ${errText}`);
        }
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); }
        else { uploaded = true; break; }
      } catch (e) {
        if (!e.timedOut && !(e.message?.startsWith('Chunk'))) { lastErr = e; }
        else if (!e.timedOut) { throw e; }
        else {
          lastErr = e;
          reportError('chunk_timeout', `chunk ${i} timed out attempt ${attempt}`, `uuid:${state.uploadUUID.slice(0,8)}`);
        }
      }
      if (!uploaded && attempt < CHUNK_RETRY_DELAYS.length) {
        await new Promise(r => setTimeout(r, CHUNK_RETRY_DELAYS[attempt]));
      }
    }
    if (!uploaded) throw new Error(`Chunk ${i} failed after ${CHUNK_RETRY_DELAYS.length + 1} attempts: ${lastErr?.message}`);

    writeChunkState({
      uuid: state.uploadUUID, chunkIndex: i, totalChunks,
      fileName: state.selectedFile.name, fileSize: state.selectedFile.size,
      keyHex, ivHex, tier: 'free', expiryTimestamp, timestamp: Date.now(),
      sealNonceHex: sealNonceHex || undefined,
    }, reportError).catch(() => {});

    setProgress(Math.round(((i + 1) / totalChunks) * 80) + 15, `${i + 1} / ${totalChunks} chunks`);
  }

  clearResumeState(state.uploadUUID, reportError).catch(() => {});

  // TH-2: run permanent record pipeline after final ACK
  let permanentRecordOk = false;
  if (wantsPermanentRecord && blake3PlaintextHash && sealNonceHex) {
    setStage('Anchoring to Bitcoin', 97);
    const blake3PlaintextRoot = blake3PlaintextHash.digest('hex');
    const prResult = await runPermanentRecord(state.uploadUUID, blake3PlaintextRoot, sealNonceHex, state.sessionAesKey);
    permanentRecordOk = prResult.ok;
    if (!prResult.ok) reportError('permanent_record', prResult.error || 'unknown', `uuid:${state.uploadUUID.slice(0,8)}`);
  }

  setStage('Finalising', 98);
  await new Promise(r => setTimeout(r, 80));
  setStage('Done', 100);
  progressDetail.textContent = wantsPermanentRecord
    ? (permanentRecordOk ? 'Transfer complete — date seal submitted ✓' : 'Transfer complete — date seal failed (transfer still available)')
    : 'Transfer complete';
  await new Promise(r => setTimeout(r, 700));
  progressCard.classList.add('hidden');

  const fragmentStr = sealNonceHex
    ? `uuid=${state.uploadUUID}&key=${keyHex}&iv=${ivHex}&sn=${sealNonceHex}`
    : `uuid=${state.uploadUUID}&key=${keyHex}&iv=${ivHex}`;
  const shareUrl = `${location.origin}${location.pathname}#${fragmentStr}`;
  history.replaceState(null, '', location.pathname);
  showSharePanel(shareUrl, !!p2shHashHex);
}

// ─────────────────────────────────────────────────────────────────────────────
// checkResumeState — called on page load before enterUploadMode
// ─────────────────────────────────────────────────────────────────────────────
export async function checkResumeState(domRefs, state, helpers) {
  const record = await readResumeState();
  if (!record) return;

  const age = Date.now() - (record.timestamp || 0);
  if (age > 8 * 24 * 60 * 60 * 1000) {
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

  await loadDeps();

  const keyBytes = hexToBuf(record.keyHex);
  const ivBytes  = hexToBuf(record.ivHex);
  state.sessionAesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  state.sessionIv     = new Uint8Array(ivBytes);
  state.uploadUUID    = record.uuid;

  const totalChunks     = record.totalChunks;
  const resumeFromChunk = record.chunkIndex + 1;
  const expiryTimestamp = record.expiryTimestamp
    || (Math.floor((record.timestamp || Date.now()) / 1000) + (TIER_EXPIRY_SECONDS[record.tier] || FREE_EXPIRY));
  const sealNonceHex = record.sealNonceHex || null;

  setStage('Re-credentialling', 8);
  let credential, commitment, issuedTier;
  try {
    const { blindedMsg, blindingFactor } = await generateBlindedCredential();
    const issueRes = await fetch(`${WORKER_URL}/credential/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: true, resume_uuid: record.uuid, blinded_message: blindedMsg, tier: record.tier || 'free' }),
    });
    if (!issueRes.ok) {
      const errText = await issueRes.text();
      throw new Error(`Re-credential failed (${issueRes.status}): ${errText}`);
    }
    const issueData = await issueRes.json();
    if (!issueData.uuid || !issueData.commitment) throw new Error('Re-credential response missing uuid or commitment');
    credential  = await unblindSignature(issueData.signed_point, blindingFactor, issueData.mint_pubkey);
    commitment  = issueData.commitment;
    issuedTier  = issueData.issued_tier || record.tier || 'free';
  } catch (e) {
    reportError('resume_credential', e.message, `uuid:${record.uuid.slice(0, 8)}`);
    setStage('Could not re-validate — please start a new transfer.', 0);
    progressDetail.textContent = '';
    return;
  }

  setStage(`Resuming from chunk ${resumeFromChunk + 1} of ${totalChunks}`, 10);

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

  const chunkHashes = [];
  setStage('Verifying prior chunks', 12);
  for (let i = 0; i < resumeFromChunk; i++) {
    const raw = await _readChunk(chunks[i]);
    const aad = new Uint8Array(4);
    new DataView(aad.buffer).setUint32(0, i, false);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: state.sessionIv, additionalData: aad }, state.sessionAesKey, raw);
    let h;
    try { h = blake3Hash(new Uint8Array(encrypted)); } catch (e) {
      reportError('resume_hash', e.message, `uuid:${state.uploadUUID.slice(0,8)} chunk:${i}`);
      throw e;
    }
    chunkHashes.push(h);
    const pct = Math.round(((i + 1) / resumeFromChunk) * 10) + 12;
    setProgress(pct, `Verifying chunk ${i + 1} of ${resumeFromChunk}…`);
  }

  setStage(`Resuming — uploading from chunk ${resumeFromChunk + 1} of ${totalChunks}`, 22);
  const CHUNK_RETRY_DELAYS = [2000, 5000, 10000];

  for (let i = resumeFromChunk; i < totalChunks; i++) {
    const raw = await _readChunk(chunks[i]);
    const aad = new Uint8Array(4);
    new DataView(aad.buffer).setUint32(0, i, false);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: state.sessionIv, additionalData: aad }, state.sessionAesKey, raw);

    let chunkHashHex;
    try { chunkHashHex = blake3Hash(new Uint8Array(encrypted)); } catch (e) {
      reportError('blake3_hash', e.message, `uuid:${state.uploadUUID.slice(0,8)} chunk:${i}`);
      throw e;
    }
    chunkHashes.push(chunkHashHex);
    const rollingRoot = blake3Hash(new TextEncoder().encode(chunkHashes.join('')));

    const headers = { 'Content-Type': 'application/octet-stream', 'X-Blake3-Chunk-Hash': chunkHashHex, 'X-Blake3-Root': rollingRoot };
    if (i === resumeFromChunk) {
      headers['X-Cashu-Credential']      = credential;
      headers['X-Total-Chunks']          = String(totalChunks);
      headers['X-Total-Bytes']           = String(record.fileSize);
      headers['X-Tier']                  = issuedTier;
      headers['X-Expiry-Timestamp']      = String(expiryTimestamp);
      headers['X-File-Name']             = record.fileName;
      headers['X-Credential-Commitment'] = commitment;
      headers['X-Issued-Tier']           = issuedTier;
      headers['X-Resume-From-Chunk']     = String(resumeFromChunk);
    }

    let lastErr; let uploaded = false;
    for (let attempt = 0; attempt <= CHUNK_RETRY_DELAYS.length; attempt++) {
      try {
        const res = await fetchWithTimeout(
          `${WORKER_URL}/upload/${state.uploadUUID}/${String(i).padStart(4, '0')}`,
          { method: 'PUT', headers, body: encrypted }, CHUNK_UPLOAD_TIMEOUT_MS
        );
        if (res.status === 409) {
          reportError('resume_409', `chunk ${i} 409 — transfer already complete`, `uuid:${state.uploadUUID.slice(0,8)}`);
          await clearResumeState(state.uploadUUID, reportError);
          progressCard.classList.add('hidden');
          if (resumeCard) resumeCard.classList.remove('hidden');
          const resumeDetail = domRefs.resumeDetail;
          if (resumeDetail) resumeDetail.textContent = 'This transfer was already completed — start a new upload.';
          const resumeNote = document.getElementById('resume-note');
          if (resumeNote) resumeNote.classList.add('hidden');
          const resumeDiscardBtn409 = document.getElementById('resume-discard-btn');
          if (resumeDiscardBtn409) { resumeDiscardBtn409.textContent = 'New upload'; resumeDiscardBtn409.addEventListener('click', () => location.reload(), { once: true }); }
          return;
        }
        if (res.status >= 400 && res.status < 500) {
          const errText = await res.text();
          reportError('resume_chunk', `HTTP ${res.status} chunk ${i}`, `uuid:${state.uploadUUID.slice(0,8)}`);
          throw new Error(`Chunk ${i} upload failed (resume): ${errText}`);
        }
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); }
        else { uploaded = true; break; }
      } catch (e) {
        if (e.timedOut) { lastErr = e; reportError('resume_chunk_timeout', `chunk ${i} timed out attempt ${attempt}`, `uuid:${state.uploadUUID.slice(0,8)}`); }
        else if (e.message?.includes('upload failed (resume)')) { throw e; }
        else { lastErr = e; }
      }
      if (!uploaded && attempt < CHUNK_RETRY_DELAYS.length) await new Promise(r => setTimeout(r, CHUNK_RETRY_DELAYS[attempt]));
    }
    if (!uploaded) throw new Error(`Chunk ${i} failed after ${CHUNK_RETRY_DELAYS.length + 1} attempts: ${lastErr?.message}`);

    writeChunkState({
      uuid: state.uploadUUID, chunkIndex: i, totalChunks,
      fileName: record.fileName, fileSize: record.fileSize,
      keyHex: record.keyHex, ivHex: record.ivHex,
      tier: record.tier || 'free', expiryTimestamp, timestamp: Date.now(),
      sealNonceHex: sealNonceHex || undefined,
    }, reportError).catch(() => {});

    const uploadedChunks  = i - resumeFromChunk + 1;
    const remainingChunks = totalChunks - resumeFromChunk;
    setProgress(Math.round(22 + (uploadedChunks / remainingChunks) * 73), `Resuming from chunk ${resumeFromChunk + 1} of ${totalChunks} — chunk ${i + 1} of ${totalChunks} sent`);
  }

  clearResumeState(state.uploadUUID, reportError).catch(() => {});

  setStage('Finalising', 98);
  await new Promise(r => setTimeout(r, 80));
  setStage('Done', 100);
  progressDetail.textContent = 'Transfer resumed and complete';
  await new Promise(r => setTimeout(r, 700));
  progressCard.classList.add('hidden');

  const fragmentStr = sealNonceHex
    ? `uuid=${state.uploadUUID}&key=${record.keyHex}&iv=${record.ivHex}&sn=${sealNonceHex}`
    : `uuid=${state.uploadUUID}&key=${record.keyHex}&iv=${record.ivHex}`;
  const shareUrl = `${location.origin}${location.pathname}#${fragmentStr}`;
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
