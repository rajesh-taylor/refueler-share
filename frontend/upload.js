// ── frontend/upload.js — upload page: choosing a file or folder ─────────────────
// Extracted from share.js at Share-JS-Refactor session (TH-block). Split by job at
// Share-JS-Split-2 (9 Oct 2026), no behaviour change:
//   upload-turnstile.js  the Cloudflare check        upload-start.js   key, pass, /initiate
//   upload-options.js    delete / tidal / record     upload-send.js    parts, finalise, link
//   upload-folder.js     reading + zipping folders   upload-resume.js  after a refresh
//   upload-store.js      IndexedDB resume record     upload-net.js     wire calls
//   upload-stop.js       stops and their sentences
//
// Exports:
//   enterUploadMode(domRefs, state, helpers)
//   resumeUpload(record, domRefs, state, helpers)     (upload-resume.js)
//   checkResumeState(domRefs, state, helpers)         (upload-resume.js)
//   clearResumeState(uuid, reportError)               (upload-store.js)
//
// Receives shared mutable state object from share.js — mutations are visible
// to all holders (sessionAesKey, partKey, uploadUUID set in upload-send.js).
//
// Share-6-6b: legacy Worker-relay path (PUT /upload/:uuid/:chunk) removed.
// Direct-to-R2 is the only upload path. USE_DIRECT_R2 flag retired.
// ─────────────────────────────────────────────────────────────────────────────

import { loadDeps } from './crypto.js';
import { FREE_CAP, FREE_EXPIRY } from './config.js';
import { renderTurnstile, _cancelQueuedStart, _uploadBtnDisabled, pressWhenChecked,
         keepTurnstile } from './upload-turnstile.js';
import { _injectTransferOptions } from './upload-options.js';
import { FOLDER_MAX_FILES, readDirectoryEntry, zipAndSelect, _folderTooMany,
         _folderEntries } from './upload-folder.js';
import { startUpload } from './upload-start.js';
import { setPressUpload } from './upload-send.js';

export { checkResumeState, resumeUpload } from './upload-resume.js';
export { clearResumeState } from './upload-store.js';

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
  const pressUpload = () => {
    const go = () => startUpload(domRefs, state, helpers, transferOpts);
    clearDropMsg();
    pressWhenChecked(go, state, domRefs, helpers);
  };
  setPressUpload(pressUpload);
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
  state.folder       = null;
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
  keepTurnstile(state, domRefs, helpers);   // U-11 (upload-turnstile.js)
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
  _setFolder(state, await zipAndSelect(files, folderName, domRefs, { ...helpers, handleFileSelection: (f, n) => _handleFileSelection(f, domRefs, state, helpers, transferOpts, n), resetRows: () => _resetRows(domRefs) }));
}

// Set AFTER zipAndSelect: _handleFileSelection (called inside it) resets to 'file'.
// print = the folder's resume print, or null when zipping stopped (nothing chosen).
function _setFolder(state, print) {
  if (!print) return;
  state.sourceType = 'folder';
  state.folder     = print;
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

  const { folderName, entries } = _folderEntries(fileList);
  _startZipView(folderName, fileList.length, domRefs, helpers);
  showZipStage('Gathering', 0, '');

  // Over 2 GB is refused inside zipAndSelect (before reading), with the folder copy.
  _setFolder(state, await zipAndSelect(entries, folderName, domRefs, { ...helpers, handleFileSelection: (f, n) => _handleFileSelection(f, domRefs, state, helpers, transferOpts, n), resetRows: () => _resetRows(domRefs) }));
}
