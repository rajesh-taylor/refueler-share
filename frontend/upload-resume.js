// ── frontend/upload-resume.js — carrying on after a refresh ──────────────────
// Moved out of upload.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

import { loadDeps } from './crypto.js';
import { CHUNK_SIZE, FREE_EXPIRY, TIER_EXPIRY_SECONDS } from './config.js';
import { progressBytesText } from './progress.js';
import { zipFolder, zipSize, folderPrint } from './zip.js';
import { readResumeState, clearResumeState, SCHEME } from './upload-store.js';
import { RESUME_HEAD, NO_RESUME, NOT_SAME_FILE, FOLDER_ASK, FOLDER_DIFFERENT, FOLDER_CHANGED,
         FOLDER_TIME_ZONE, _loadDepsOrSay } from './upload-stop.js';
import { _folderEntries } from './upload-folder.js';
import { _carryOnOrStop } from './upload-send.js';

export async function checkResumeState(domRefs, state, helpers) {
  const record = await readResumeState();
  if (!record) return;

  const age = Date.now() - (record.timestamp || 0);
  if (age > 8 * 24 * 60 * 60 * 1000) {
    await clearResumeState(record.uuid, helpers.reportError);
    return;
  }

  // ── Folders (Share-Folder-Resume-1) ─────────────────────────────────────────
  // A folder's zip lives only in memory, so resume re-zips the re-picked folder
  // and checks it against the print the record kept. A folder record from before
  // that print existed can't be checked: discard it and say so.
  if (record.sourceType === 'folder' && !_folderPrintOk(record.folder)) {
    await clearResumeState(record.uuid, helpers.reportError);
    if (typeof helpers.setDropMsg === 'function') {
      helpers.setDropMsg('A folder upload didn’t finish and can’t continue. Send the folder again.');
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
  if (record.folder) {
    // Folder wording: the row, the sentence and the button say "folder" and name it.
    const label = domRefs.resumeFile.closest('.rx-row')?.querySelector('dt');
    if (label) label.textContent = 'Folder';
    domRefs.resumeFile.replaceChildren(record.folder.name, Object.assign(document.createElement('small'),
      { textContent: `${record.folder.files.toLocaleString()} files` }));
    if (resumeDetail) resumeDetail.textContent = FOLDER_ASK;
    if (resumeNoticeBtn) resumeNoticeBtn.textContent = 'Choose folder';
  } else {
    domRefs.resumeFile.textContent = record.fileName;
  }
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
    if (resumeDetail) resumeDetail.textContent = 'It’s too late to continue: the upload window has closed. Discard it and start again.';
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
  const { formatBytes, reportError, showStopped } = helpers;
  const backToCard = (text) => _backToCard(text, domRefs, helpers);

  // ── Gates: direct-R2 (6-4a), link format v2 (Share-Crypto-1), tail URL (B12-1c) ──
  if (_resumeBlocked(record)) {
    await clearResumeState(record.uuid, reportError);
    showStopped(NO_RESUME);
    return;
  }

  // Share-Folder-Resume-1: a folder is re-picked, checked and re-zipped.
  if (record.folder) { _pickResumeFolder(record, domRefs, state, helpers); return; }

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
    backToCard('Choose the same file to continue. This page only sees what you choose.');
    return;
  }

  if (!resumeFile) { backToCard('Choose the same file to continue. This page only sees what you choose.'); return; }

  if (resumeFile.name !== record.fileName || resumeFile.size !== record.fileSize) {
    backToCard(`That’s a different file. Choose “${record.fileName}” (${formatBytes(record.fileSize)}) to continue.`);
    return;
  }

  if (Math.ceil(resumeFile.size / CHUNK_SIZE) !== record.totalChunks) {
    backToCard(NOT_SAME_FILE);
    reportError('resume_chunk_count', `expected ${record.totalChunks} got ${Math.ceil(resumeFile.size / CHUNK_SIZE)}`, `uuid:${record.uuid.slice(0,8)}`);
    return;
  }

  _resumeView(domRefs, helpers);
  // Share-Upload-6: reuse the sent parts' hashes only for the same file, unchanged
  // since (lastModified). Otherwise _carryOn re-encrypts them and checks each one
  // against the record (expectedHashes, Share-Crypto-1): a different file stops
  // there, before any part is sent.
  const recordHashes = _recordHashes(record);
  await _resumeWith(record, resumeFile, record.fileModified === resumeFile.lastModified ? recordHashes : [], domRefs, state, helpers);
}

// Why a record can't carry on: true = it can't. Synchronous, so the resume press
// can still open a picker (Safari user activation).
function _resumeBlocked(record) {
  // Pre-6-2 records lack uploadMode / sessionToken and cannot finalise (6-4a).
  // sessionToken was minted at /initiate and stored in the record — no re-credential needed.
  if (record.uploadMode !== 'direct-r2' || !record.sessionToken) return true;
  // An older record can't finish as a v2 link, and every v2 record keeps one
  // hash per sent part: the changed-file check needs them all.
  if (record.scheme !== SCHEME || !_recordHashes(record)) return true;
  // B12-1c: the size-signed tail URL is issued once, at /initiate.
  const tail = record.tailUrl;
  return !!(tail && record.chunkIndex + 1 < record.totalChunks && tail.expires * 1000 <= Date.now());
}

function _recordHashes(record) {
  const h = record.hashes;
  return Array.isArray(h) && h.length === record.chunkIndex + 1 && h.every(x => /^[0-9a-f]{64}$/.test(x)) ? h.slice() : null;
}

function _folderPrintOk(f) {
  return !!f && typeof f.name === 'string' && Number.isInteger(f.files) && f.files > 0
    && /^[0-9a-f]{64}$/.test(f.list) && /^[0-9a-f]{64}$/.test(f.local);
}

// Back to the resume card with a sentence (picker cancelled, wrong file or folder).
function _backToCard(text, domRefs, helpers) {
  helpers.setView('empty', RESUME_HEAD);
  if (domRefs.resumeCard) domRefs.resumeCard.classList.remove('hidden');
  if (domRefs.resumeDetail) domRefs.resumeDetail.textContent = text;
}

function _resumeView(domRefs, helpers) {
  if (domRefs.resumeCard) domRefs.resumeCard.classList.add('hidden');
  helpers.setView('uploading');
  helpers.setStage('Preparing');
  helpers.setProgress(0, '');
}

// The record's transfer, carried on with this file: deps, then _carryOn.
async function _resumeWith(record, file, savedHashes, domRefs, state, helpers) {
  if (!(await _loadDepsOrSay(domRefs, helpers))) return;
  const expiryTimestamp = record.expiryTimestamp
    || (Math.floor((record.timestamp || Date.now()) / 1000) + (TIER_EXPIRY_SECONDS[record.tier] || FREE_EXPIRY));
  const job = {
    file, uuid: record.uuid, keyHex: record.keyHex, scheme: SCHEME, expectedHashes: _recordHashes(record),
    totalChunks: record.totalChunks, expiryTimestamp, tier: record.tier || 'free',
    sessionToken: record.sessionToken, tailUrl: record.tailUrl || null,
    sealNonceHex: record.sealNonceHex || null, sourceType: record.sourceType || 'file',
    folder: record.folder || null,
    sent: record.chunkIndex + 1, hashes: savedHashes.slice(), urlMap: new Map(), plainHash: null,
    // A resumed upload doesn't record the password or delete setting: left out of the ledger.
    info: { fileName: record.fileName, isFolder: !!record.folder, sizeBytes: record.fileSize, expiryTimestamp },
  };
  await _carryOnOrStop(job, domRefs, state, helpers);
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder resume (Share-Folder-Resume-1, S-031). The press opens a folder picker
// (no await before it: Safari). The re-picked folder must match the record's
// print — name, then the list of paths, sizes and dates, then the dates as the zip
// writes them (the device's time zone) — before a byte of it is read. Then it is
// re-zipped to the same bytes, and _carryOn re-encrypts every sent part and checks
// it against the record before sending the rest (re-encrypting is safe only for
// identical bytes; a part that differs stops there, nothing sent).
// ─────────────────────────────────────────────────────────────────────────────
let resumeFolderInput = null;   // one hidden folder picker, made on the first press

function _pickResumeFolder(record, domRefs, state, helpers) {
  if (!resumeFolderInput) {
    resumeFolderInput = Object.assign(document.createElement('input'), { type: 'file', multiple: true, hidden: true });
    resumeFolderInput.setAttribute('webkitdirectory', '');
    document.body.appendChild(resumeFolderInput);
  }
  // A cancelled picker leaves the card as it is; the button opens it again.
  resumeFolderInput.onchange = () => {
    const files = Array.from(resumeFolderInput.files || []);
    if (files.length) _resumeFolder(record, files, domRefs, state, helpers);
  };
  resumeFolderInput.value = '';
  resumeFolderInput.click();
}

async function _resumeFolder(record, fileList, domRefs, state, helpers) {
  const { reportError } = helpers;
  const want  = record.folder;
  const short = `uuid:${record.uuid.slice(0, 8)}`;
  const back  = (text) => _backToCard(text, domRefs, helpers);

  const { folderName, entries } = _folderEntries(fileList);
  if (folderName !== want.name) { back(FOLDER_DIFFERENT(want)); return; }
  if (typeof fflate === 'undefined') { back('Folders can’t be zipped in this browser. Discard it and send the folder as a .zip file.'); return; }

  let print;
  try {
    print = await folderPrint(entries);
  } catch (e) {
    reportError('resume_folder_print', e?.name || 'Error', short);
    back('This folder couldn’t be read. Try again, or discard it and start again.');
    return;
  }
  if (print.list !== want.list || zipSize(entries) !== record.fileSize) {
    reportError('resume_folder_changed', `files ${print.files} of ${want.files}`, short);
    back(FOLDER_CHANGED(want));
    return;
  }
  if (print.local !== want.local) {
    reportError('resume_folder_tz', 'local dates differ', short);
    back(FOLDER_TIME_ZONE(want));
    return;
  }

  // Same folder: zip it again. The bar stays put; the words say what's happening.
  _resumeView(domRefs, helpers);
  const total = entries.reduce((a, e) => a + (e.file.size || 0), 0);
  const words = (done) => `Zipping the folder again · ${progressBytesText(done, total)}`;
  helpers.setProgress(0, words(0));
  let said = Date.now(), zipBlob;
  try {
    zipBlob = await zipFolder(entries, (done) => {
      if (Date.now() - said < 2000) return;   // calm: words every 2 s (Share-Progress-1)
      said = Date.now();
      helpers.setProgress(0, words(done));
    });
  } catch (e) {
    reportError('resume_folder_zip', e?.message?.slice(0, 80) || 'fflate error', short);
    back('Zipping the folder didn’t work. Try again, or discard it and start again.');
    return;
  }
  const zipFile = new File([zipBlob], record.fileName, { type: 'application/zip' });
  if (zipFile.size !== record.fileSize) {   // can't happen when the print matched; never send on a guess
    reportError('resume_folder_size', `${zipFile.size} vs ${record.fileSize}`, short);
    back(FOLDER_CHANGED(want));
    return;
  }
  // A re-zipped folder is a new file in memory: every sent part is re-checked.
  await _resumeWith(record, zipFile, [], domRefs, state, helpers);
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
