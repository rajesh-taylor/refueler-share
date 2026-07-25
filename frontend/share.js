// ── share.js — extracted from src/index.njk at S51 ──────────────────────────
// DO NOT edit inline JS in index.njk — edit this file only.
// Loaded as <script type="module" src="/share.js"></script>

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const WORKER_URL  = 'https://refueler-share.rt-fc4.workers.dev';
const CHUNK_SIZE  = 8 * 1024 * 1024;         // 8 MB
const FREE_CAP    = 4 * 1024 * 1024 * 1024;  // 4 GB
const FREE_EXPIRY = 7 * 24 * 60 * 60;        // 7 days in seconds — matches UI "1 / 7 day expiry" and server EXPIRY_WINDOWS.free

// ─────────────────────────────────────────────────────────────────────────────
// Deps (dynamic)
// ─────────────────────────────────────────────────────────────────────────────
let blake3, secp;
async function loadDeps() {
  const [b3mod, secpMod] = await Promise.all([
    import('./blake3/browser-async.js'),
    import('https://esm.sh/@noble/secp256k1@1.7.2'),
  ]);
  blake3 = await b3mod.default();
  secp = secpMod;
  // NOTE: secp256k1@1.7.2 (v1 API) used here — secp.Point.fromPrivateKey / secp.Point.fromHex
  // These are removed in v2. Flag: do not upgrade secp256k1 without migrating NUT-00 crypto below.
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let selectedFile   = null;
let turnstileToken = null;
let downloadToken  = null;
let sessionAesKey  = null;
let sessionIv      = null;
let uploadUUID     = null;

// ─────────────────────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const infoCard         = $('info-card');
const dropZone         = $('drop-zone');
const fileInput        = $('file-input');
const capWarning       = $('cap-warning');
const optionsCard      = $('options-card');
const fileNameTag      = $('file-name-tag');
const fileSizeTag      = $('file-size-tag');
const passphraseToggle = $('passphrase-toggle');
const passphraseWrap   = $('passphrase-field-wrap');
const passphraseInput  = $('passphrase-input');
const uploadBtn        = $('upload-btn');
const progressCard     = $('progress-card');
const stageTag         = $('progress-stage-tag');
const progressPct      = $('progress-pct');
const progressBar      = $('progress-bar');
const progressDetail   = $('progress-detail');
const shareCard        = $('share-card');
const shareLinkDisplay = $('share-link-display');
const copyBtn          = $('copy-btn');
const newUploadBtn     = $('new-upload-btn');
const qrWrap           = $('qr-wrap');
const unlockScreen     = $('unlock-screen');
const unlockInput      = $('unlock-input');
const unlockError      = $('unlock-error');
const unlockBtn        = $('unlock-btn');
const downloadCard     = $('download-card');
const dlStageTag       = $('dl-stage-tag');
const dlPct            = $('dl-pct');
const dlBar            = $('dl-bar');
const dlSignoff        = $('dl-signoff');
const dropMultiMsg     = $('drop-multi-msg');
const folderInput      = $('folder-input');
const folderBtn        = $('folder-btn');
const zipProgressCard  = $('zip-progress-card');
const zipStageTag      = $('zip-stage-tag');
const zipPct           = $('zip-pct');
const zipBar           = $('zip-bar');
const zipDetail        = $('zip-detail');
const dlCompatWarn     = $('dl-compat-warn');
const receiverCard     = $('receiver-card');
const rcFileName       = $('rc-file-name');
const rcSize           = $('rc-size');
const rcExpiry         = $('rc-expiry');
const rcPassphraseRow  = $('rc-passphrase-row');
const rcDownloadBtn    = $('rc-download-btn');
const uspBlock         = $('usp-block');
const uspText          = $('usp-text');

// ─────────────────────────────────────────────────────────────────────────────
// Info card
// ─────────────────────────────────────────────────────────────────────────────
$('dismiss-info').addEventListener('click', () => infoCard.classList.add('hidden'));

// ─────────────────────────────────────────────────────────────────────────────
// Mode detection
// ─────────────────────────────────────────────────────────────────────────────
const fragment = parseFragment();
if (fragment.uuid && fragment.key) {
  enterDownloadMode(fragment);
} else {
  enterUploadMode();
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload mode
// ─────────────────────────────────────────────────────────────────────────────
function enterUploadMode() {
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    clearDropMsg();

    // ── Folder drag detection ──────────────────────────────────────────────
    // Check if the first item is a directory via the FileSystem API.
    // Falls back gracefully if webkitGetAsEntry is unavailable.
    const items = e.dataTransfer.items;
    if (items && items.length === 1 && items[0].webkitGetAsEntry) {
      const entry = items[0].webkitGetAsEntry();
      if (entry && entry.isDirectory) {
        handleFolderDrop(entry);
        return;
      }
    }

    // Multiple items (files or a mix) — reject with message
    if (e.dataTransfer.files.length > 1) {
      setDropMsg('One file or one folder at a time please.');
      return;
    }

    if (e.dataTransfer.files[0]) handleFileSelection(e.dataTransfer.files[0]);
  });

  // Single-file input
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
      clearDropMsg();
      handleFileSelection(fileInput.files[0]);
    }
  });

  // Folder button triggers the hidden webkitdirectory input.
  // Stop propagation so the click doesn't bubble to the drop zone's file input.
  folderBtn.addEventListener('click', e => {
    e.stopPropagation();
    folderInput.value = '';
    folderInput.click();
  });

  // webkitdirectory input — user selected a folder via the picker
  folderInput.addEventListener('change', () => {
    if (folderInput.files.length === 0) return;
    clearDropMsg();
    handleFolderFiles(Array.from(folderInput.files));
  });

  passphraseToggle.addEventListener('change', () => {
    passphraseWrap.classList.toggle('hidden', !passphraseToggle.checked);
    if (!passphraseToggle.checked) passphraseInput.value = '';
    updateUploadBtn();
  });
  passphraseInput.addEventListener('input', updateUploadBtn);
  uploadBtn.addEventListener('click', startUpload);
  copyBtn.addEventListener('click', copyShareLink);
  newUploadBtn.addEventListener('click', () => location.reload());
}

function setDropMsg(msg) {
  dropMultiMsg.textContent = msg;
  dropMultiMsg.classList.remove('hidden');
}

function clearDropMsg() {
  dropMultiMsg.classList.add('hidden');
  dropMultiMsg.textContent = '';
}

function handleFileSelection(file) {
  selectedFile = file;
  capWarning.classList.add('hidden');
  optionsCard.classList.add('hidden');
  if (file.size > FREE_CAP) { capWarning.classList.remove('hidden'); return; }
  fileNameTag.textContent = file.name.length > 32 ? file.name.slice(0, 30) + '…' : file.name;
  fileSizeTag.textContent = formatBytes(file.size);
  optionsCard.classList.remove('hidden');
  turnstileToken = null;
  const tsWrap = document.getElementById('turnstile-wrap');
  if (tsWrap) tsWrap.classList.remove('hidden');
  renderTurnstile();
  updateUploadBtn();
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder handling — drag drop entry point
// ─────────────────────────────────────────────────────────────────────────────
async function handleFolderDrop(directoryEntry) {
  // Guard: fflate must be loaded as a blocking CDN script before this module.
  if (typeof fflate === 'undefined') {
    setDropMsg('Compression library unavailable. Please zip the folder manually and upload the .zip file.');
    return;
  }

  // Gather all files from the FileSystem API entry tree.
  // Shows "Gathering…" stage while reading the directory recursively.
  showZipStage('Gathering', 0, 'Reading folder…');

  let files;
  try {
    files = await readDirectoryEntry(directoryEntry);
  } catch (e) {
    reportError('folder_read', e.message, 'drag_entry');
    // e.message may be a depth-limit error — surface it directly.
    setDropMsg(e.message.includes('nested more than')
      ? e.message
      : 'Could not read the dropped folder. Try the "Upload folder" button instead.');
    hideZipCard();
    return;
  }

  // Empty folder — explicit message, not a silent skip.
  if (files.length === 0) {
    setDropMsg('That folder appears to be empty.');
    hideZipCard();
    return;
  }

  // File count checks.
  if (files.length > FOLDER_MAX_FILES) {
    setDropMsg(`This folder contains ${files.length.toLocaleString()} files — the maximum is ${FOLDER_MAX_FILES.toLocaleString()}. Please zip it manually and upload the .zip file.`);
    hideZipCard();
    return;
  }
  if (files.length > FOLDER_WARN_FILES) {
    setDropMsg(`Large folder (${files.length.toLocaleString()} files) — this may take a moment.`);
    // Non-blocking: proceed after showing the message.
  }

  // Top-level folder name from entry.name
  const folderName = directoryEntry.name || 'folder';
  await zipAndSelect(files, folderName);
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder handling — webkitdirectory input entry point
// ─────────────────────────────────────────────────────────────────────────────
async function handleFolderFiles(fileList) {
  if (fileList.length === 0) return;

  // Guard: fflate must be loaded as a blocking CDN script before this module.
  if (typeof fflate === 'undefined') {
    setDropMsg('Compression library unavailable. Please zip the folder manually and upload the .zip file.');
    return;
  }

  // File count checks (same thresholds as drag-drop path).
  if (fileList.length > FOLDER_MAX_FILES) {
    setDropMsg(`This folder contains ${fileList.length.toLocaleString()} files — the maximum is ${FOLDER_MAX_FILES.toLocaleString()}. Please zip it manually and upload the .zip file.`);
    return;
  }
  if (fileList.length > FOLDER_WARN_FILES) {
    setDropMsg(`Large folder (${fileList.length.toLocaleString()} files) — this may take a moment.`);
  }

  showZipStage('Gathering', 0, `${fileList.length} file${fileList.length !== 1 ? 's' : ''} found`);

  // Derive top-level folder name from webkitRelativePath of the first file.
  // e.g. "ProjectFiles/assets/hero.jpg" → top-level = "ProjectFiles"
  const firstPath = fileList[0].webkitRelativePath || fileList[0].name;
  const folderName = firstPath.includes('/') ? firstPath.split('/')[0] : 'folder';

  // Convert File objects to { relativePath, file } pairs, stripping top-level dir name.
  // "ProjectFiles/assets/hero.jpg" → "assets/hero.jpg", then sanitise each segment.
  const entries = fileList.map(f => {
    const rel     = f.webkitRelativePath || f.name;
    const stripped = rel.includes('/') ? rel.slice(rel.indexOf('/') + 1) : rel;
    const safe    = sanitisePath(stripped);
    return { relativePath: safe, file: f };
  }).filter(e => e.relativePath.length > 0);

  await zipAndSelect(entries, folderName);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sanitise a single path segment — strip control chars, null bytes, bidi overrides.
// Truncates to 200 bytes (UTF-8). Matches Worker S42a filename sanitisation logic.
// ─────────────────────────────────────────────────────────────────────────────
function sanitiseSegment(seg) {
  // Strip null bytes, C0/C1 control chars (U+0000–U+001F, U+007F),
  // and Unicode bidi override codepoints (U+202A–U+202E, U+2066–U+2069).
  // eslint-disable-next-line no-control-regex
  let s = seg.replace(/[\x00-\x1F\x7F\u202A-\u202E\u2066-\u2069]/g, '');
  // Truncate to 200 bytes via round-trip through TextEncoder/TextDecoder.
  const enc = new TextEncoder();
  let bytes = enc.encode(s);
  if (bytes.length > 200) {
    bytes = bytes.slice(0, 200);
    s = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\uFFFD$/, '');
  }
  return s;
}

// Sanitise a full relative path — apply sanitiseSegment to each segment,
// drop empty segments and path traversal attempts ('..', '.').
function sanitisePath(rel) {
  return rel.split('/')
    .map(sanitiseSegment)
    .filter(s => s.length > 0 && s !== '..' && s !== '.')
    .join('/');
}

// ─────────────────────────────────────────────────────────────────────────────
// Read a FileSystem API DirectoryEntry recursively → [{relativePath, file}]
// Max depth: 20 levels. Hard stops with a thrown Error on breach.
// createReader.readEntries() returns ≤100 entries per call — loop until empty.
// ─────────────────────────────────────────────────────────────────────────────
const FOLDER_MAX_DEPTH  = 20;
const FOLDER_WARN_FILES = 500;
const FOLDER_MAX_FILES  = 2000;

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
            } catch (e) {
              reject(e); return;
            }
          }
        }
        readBatch();
      }, reject);
    }
    readBatch();
  });

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zip [{relativePath, file}] using fflate, then hand blob to handleFileSelection
// ─────────────────────────────────────────────────────────────────────────────
const FOLDER_MEM_WARN_BYTES = 500 * 1024 * 1024; // 500 MB

async function zipAndSelect(entries, folderName) {
  const zipName    = `${folderName}.zip`;
  const totalFiles = entries.length;

  // Memory pressure warning — computed before reading anything into RAM.
  // Non-blocking: the user is already committed to this folder at this point.
  const totalBytes = entries.reduce((acc, e) => acc + (e.file.size || 0), 0);
  if (totalBytes > FOLDER_MEM_WARN_BYTES) {
    setDropMsg(`Large folder (${formatBytes(totalBytes)}) — compression may use significant memory and take a while.`);
  }

  showZipStage('Compressing', 0, `0 / ${totalFiles} files`);

  // Read all files into memory as Uint8Arrays.
  // fflate.zip() accepts { "path": Uint8Array } — no streaming API for full zip.
  // For S54 we can revisit async streaming for very large folders.
  const fileMap = {};
  for (let i = 0; i < entries.length; i++) {
    const { relativePath, file } = entries[i];
    const buf = await file.arrayBuffer();
    fileMap[relativePath] = new Uint8Array(buf);
    // Bare Uint8Array → fflate default (level 6 DEFLATE) — produces unambiguous DEFLATE entries.
    // level:0 is a fflate footgun: writes DEFLATED method with zero compression, which macOS
    // Archive Utility rejects as "unsupported format". Compression ratio is irrelevant here
    // since the zip is AES-GCM encrypted immediately after. Compatibility wins over CPU saving.

    const pct = Math.round(((i + 1) / totalFiles) * 85); // read phase = 0–85%
    showZipStage('Compressing', pct, `${i + 1} / ${totalFiles} files`);
  }

  // fflate.zip() — async, callback-based
  const zipBlob = await new Promise((resolve, reject) => {
    fflate.zip(fileMap, (err, data) => {
      if (err) { reject(err); return; }
      resolve(new Blob([data], { type: 'application/zip' }));
    });
  }).catch(err => {
    reportError('folder_zip', err.message || 'fflate error', folderName.slice(0, 100));
    setDropMsg('Compression failed. Try again or zip the folder manually first.');
    hideZipCard();
    return null;
  });

  if (!zipBlob) return;

  showZipStage('Compressing', 100, `Ready — ${formatBytes(zipBlob.size)}`);
  await new Promise(r => setTimeout(r, 300)); // brief hold so user sees 100%
  hideZipCard();

  // Synthesise a File object — handleFileSelection expects .name, .size, .slice()
  const zipFile = new File([zipBlob], zipName, { type: 'application/zip' });
  handleFileSelection(zipFile);
}

// ─────────────────────────────────────────────────────────────────────────────
// Zip progress UI helpers
// ─────────────────────────────────────────────────────────────────────────────
function showZipStage(label, pct, detail) {
  zipProgressCard.classList.remove('hidden');
  zipStageTag.textContent   = label;
  zipPct.textContent        = pct + '%';
  zipBar.style.width        = pct + '%';
  zipDetail.textContent     = detail || '';
}

function hideZipCard() {
  zipProgressCard.classList.add('hidden');
  zipBar.style.width = '0%';
  zipPct.textContent = '0%';
  zipDetail.textContent = '';
}

function updateUploadBtn() {
  const needsPassphrase = passphraseToggle.checked && passphraseInput.value.trim().length === 0;
  uploadBtn.disabled = !selectedFile || needsPassphrase || !turnstileToken;
}

let turnstileWidgetId = null;
let turnstileScriptReady = false;
let pendingTurnstileRender = false;

// onTurnstileLoad is called by the Turnstile script via ?onload=onTurnstileLoad.
// On Safari/mobile Safari, ITP can block this callback — so we also poll in
// renderTurnstile. The flag avoids a double-render if both paths fire.
window.onTurnstileLoad = function() {
  turnstileScriptReady = true;
  if (pendingTurnstileRender) {
    pendingTurnstileRender = false;
    renderTurnstile();
  }
};

function renderTurnstile() {
  const container = document.getElementById('cf-turnstile');
  if (!container) return;
  if (!window.turnstile) {
    // Script not ready yet — set flag and start polling (Safari ITP fallback).
    // Polls every 200ms up to 15s. Once the script loads, renderTurnstile is
    // called again by the poll. The onTurnstileLoad callback above also fires
    // on non-Safari browsers, whichever arrives first wins.
    if (!pendingTurnstileRender) {
      pendingTurnstileRender = true;
      const deadline = Date.now() + 15000;
      const poll = setInterval(() => {
        if (window.turnstile) {
          clearInterval(poll);
          pendingTurnstileRender = false;
          renderTurnstile();
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          pendingTurnstileRender = false;
          reportError('turnstile_load', 'Turnstile script did not load within 15s', navigator.userAgent.slice(0, 100));
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
      turnstileToken = token;
      updateUploadBtn();
    },
    'error-callback': function() {
      turnstileToken = null;
      updateUploadBtn();
    },
    'expired-callback': function() {
      turnstileToken = null;
      updateUploadBtn();
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload flow
// ─────────────────────────────────────────────────────────────────────────────
async function startUpload() {
  if (!selectedFile) return;
  uploadBtn.disabled = true;
  optionsCard.classList.add('hidden');
  progressCard.classList.remove('hidden');

  await loadDeps();

  setStage('Generating key', 5);
  sessionAesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  sessionIv     = crypto.getRandomValues(new Uint8Array(12));
  const rawKey  = await crypto.subtle.exportKey('raw', sessionAesKey);
  const keyHex  = bufToHex(rawKey);
  const ivHex   = bufToHex(sessionIv);

  let p2shHashHex = null;
  if (passphraseToggle.checked && passphraseInput.value.trim()) {
    setStage('Hashing passphrase', 8);
    p2shHashHex = await sha256Hex(new TextEncoder().encode(passphraseInput.value.trim()));
    passphraseInput.value = '';
  }

  setStage('Chunking', 10);
  // UUID is generated server-side at /credential/issue (S42c).
  // Do not call crypto.randomUUID() here — uploadUUID is populated from the issue response.
  const chunks = splitChunks(selectedFile, CHUNK_SIZE);
  const totalChunks = chunks.length;
  const chunkHashes = [];

  setStage('Credentialling', 12);
  const { blindedMsg, blindingFactor } = await generateBlindedCredential();
  let _credPct = 12;
  const _credTick = setInterval(() => { if (_credPct < 14) { _credPct += 0.5; progressBar.style.width = _credPct + '%'; } }, 120);
  const issueRes = await fetch(`${WORKER_URL}/credential/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turnstile_token: turnstileToken, blinded_message: blindedMsg, tier: 'free' }),
  });
  clearInterval(_credTick);
  if (!issueRes.ok) {
    const errText = await issueRes.text();
    reportError('credential_issue', `HTTP ${issueRes.status}`, errText.slice(0, 200));
    throw new Error(`Credential issue failed: ${errText}`);
  }
  const { signed_point, mint_pubkey, uuid: issuedUuid, issued_tier: issuedTier, commitment } = await issueRes.json();
  // Fail loudly if the Worker did not return a UUID — misconfiguration should not silently fall through.
  if (!issuedUuid || !commitment || !issuedTier) throw new Error('Credential issue response missing uuid, commitment, or issued_tier');
  uploadUUID = issuedUuid;
  const credential = await unblindSignature(signed_point, blindingFactor, mint_pubkey);

  setStage('Uploading', 15);
  const expiryTimestamp = Math.floor(Date.now() / 1000) + FREE_EXPIRY;

  for (let i = 0; i < totalChunks; i++) {
    const raw = await readChunk(chunks[i]);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: sessionIv, additionalData: (() => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, i, false); return b; })() },
      sessionAesKey, raw
    );
    // AAD: 4-byte big-endian chunk index (DataView.setUint32) — overflow-safe for all chunk counts
    let chunkHashHex;
    try {
      chunkHashHex = await blake3Hash(new Uint8Array(encrypted));
    } catch (e) {
      reportError('blake3_hash', e.message, `uuid:${uploadUUID.slice(0,8)} chunk:${i}`);
      throw e;
    }
    chunkHashes.push(chunkHashHex);
    const rollingRoot = await blake3Hash(new TextEncoder().encode(chunkHashes.join('')));

    const headers = {
      'Content-Type': 'application/octet-stream',
      'X-Blake3-Chunk-Hash': chunkHashHex,
      'X-Blake3-Root': rollingRoot,
    };
    if (i === 0) {
      headers['X-Cashu-Credential']       = credential;
      headers['X-Total-Chunks']           = String(totalChunks);
      headers['X-Total-Bytes']            = String(selectedFile.size);
      headers['X-Tier']                   = 'free';
      headers['X-Expiry-Timestamp']       = String(expiryTimestamp);
      headers['X-File-Name']              = selectedFile.name;
      headers['X-Credential-Commitment']  = commitment;   // S42c: UUID-bound commitment
      headers['X-Issued-Tier']            = issuedTier;   // S42c: tier at credential issuance
      if (p2shHashHex) headers['X-P2SH-Secret-Hash'] = p2shHashHex;
    }

    const res = await fetch(`${WORKER_URL}/upload/${uploadUUID}/${String(i).padStart(4, '0')}`, {
      method: 'PUT', headers, body: encrypted,
    });
    if (!res.ok) {
      const errText = await res.text();
      reportError('upload_chunk', `HTTP ${res.status} chunk ${i}`, `uuid:${uploadUUID.slice(0,8)} chunk:${i} text:${errText.slice(0,100)}`);
      throw new Error(`Chunk ${i} upload failed: ${errText}`);
    }
    setProgress(Math.round(((i + 1) / totalChunks) * 80) + 15, `${i + 1} / ${totalChunks} chunks`);
  }

  // Smooth finish: animate to 100%, hold 600ms, then transition to share panel
  setStage('Finalising', 98);
  await new Promise(r => setTimeout(r, 80));
  setStage('Done', 100);
  progressDetail.textContent = 'Transfer complete';
  await new Promise(r => setTimeout(r, 700));
  progressCard.classList.add('hidden');

  const fragmentStr = `uuid=${uploadUUID}&key=${keyHex}&iv=${ivHex}`;
  const shareUrl = `${location.origin}${location.pathname}#${fragmentStr}`;
  history.replaceState(null, '', location.pathname);
  showSharePanel(shareUrl, !!p2shHashHex);
}

function renderQr(url) {
  const isDark = document.documentElement.dataset.theme === 'carbon';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  qrWrap.appendChild(svg);
  QrCreator.render({
    text: url,
    radius: 0,
    ecLevel: 'M',
    fill:       isDark ? '#F7F4EF' : '#3D3A36',
    background: isDark ? '#111316' : '#F7F4EF',
    size: 200,
  }, svg);
}

function showSharePanel(url, isProtected) {
  shareCard.classList.remove('hidden');
  shareLinkDisplay.textContent = url;
  if (isProtected) {
    const note = document.createElement('p');
    note.className = 'muted small mt8';
    note.textContent = '🔐 Password protected — share the password separately.';
    shareLinkDisplay.insertAdjacentElement('afterend', note);
  }
  qrWrap.innerHTML = '';
  // qr-creator renders to SVG — crisp at any DPR, no canvas blur.
  // Guard: if the blocking script above the module tag didn't expose QrCreator
  // (e.g. CDN blocked, cached old build), load it dynamically before rendering.
  if (typeof QrCreator !== 'undefined') {
    renderQr(url);
  } else {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qr-creator/1.0.0/qr-creator.min.js';
    s.onload = () => renderQr(url);
    s.onerror = () => { /* QR unavailable — silently skip, link is still copyable */ };
    document.head.appendChild(s);
  }
}

const COPY_ICON = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:-1px;margin-right:5px" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.2" stroke="currentColor" stroke-width="1.25"/><path d="M3 9H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';
function copyShareLink() {
  navigator.clipboard.writeText(shareLinkDisplay.textContent).then(() => {
    copyBtn.innerHTML = COPY_ICON + 'Copied ✓';
    setTimeout(() => { copyBtn.innerHTML = COPY_ICON + 'Copy link'; }, 2000);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Download mode
// ─────────────────────────────────────────────────────────────────────────────
async function enterDownloadMode({ uuid, key, iv }) {
  dropZone.classList.add('hidden');
  infoCard.classList.add('hidden');
  optionsCard.classList.add('hidden');

  await loadDeps();

  const keyBytes = hexToBuf(key);
  const ivBytes  = hexToBuf(iv);
  sessionAesKey  = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  sessionIv      = new Uint8Array(ivBytes);
  history.replaceState(null, '', location.pathname);

  // ── Fetch metadata from /meta/{uuid} ────────────────────────────────────
  // Public endpoint — no auth, returns filename/size/expiry/passphrase flag.
  // Works for both protected and unprotected transfers.
  let meta = {};
  try {
    const metaRes = await fetch(`${WORKER_URL}/meta/${uuid}`);
    if (metaRes.ok) meta = await metaRes.json();
    else if (metaRes.status === 404) { showDownloadError('Transfer not found or already expired.'); return; }
  } catch {
    showDownloadError('Network error — could not reach server.');
    return;
  }

  // ── Populate receiver card ────────────────────────────────────────────────
  rcFileName.textContent = meta.file_name || `refueler-${uuid.slice(0, 8)}`;

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

  receiverCard.style.display = 'flex';

  // ── A/B USP variant (S47c) ───────────────────────────────────────────────
  // 50/50 split per session. Variant stored in sessionStorage — never a cookie,
  // never sent to any server as identity. Only the variant label is logged to AE.
  const USP_VARIANTS = {
    A: `Reading your files is not technically possible for us.\nThe key never leaves your browser. The server stores encrypted noise.\nFiles delete themselves. No account. No trace. No data to sell.`,
    B: `This link expires and deletes itself — no trace remains.\nNo account. No email. No history.\nYour data. Not ours.`,
  };
  let uspVariant;
  try {
    uspVariant = sessionStorage.getItem('rs-usp-variant');
    if (!uspVariant) {
      uspVariant = Math.random() > 0.5 ? 'B' : 'A';
      sessionStorage.setItem('rs-usp-variant', uspVariant);
    }
  } catch {
    // sessionStorage blocked (private mode edge case) — assign without storing.
    uspVariant = Math.random() > 0.5 ? 'B' : 'A';
  }
  uspText.textContent = USP_VARIANTS[uspVariant];
  uspBlock.classList.remove('hidden');
  // Log variant exposure to AE via /log/error (context: receiver_ab) — fire-and-forget.
  logReceiverEvent('receiver_ab_shown', uspVariant);

  // ── Show capability warning on receiver card if FSAA is unavailable ─────
  const WARN_AMBER_BYTES = 300 * 1024 * 1024;  // 300 MB
  const WARN_RED_BYTES   = 1024 * 1024 * 1024; // 1 GB
  const hasFSAA = typeof showSaveFilePicker !== 'undefined';
  const totalBytes = meta.total_bytes || 0;

  if (!hasFSAA && totalBytes > WARN_AMBER_BYTES) {
    const isRed = totalBytes > WARN_RED_BYTES;
    dlCompatWarn.className = `dl-compat-warn ${isRed ? 'red' : 'amber'}`;
    dlCompatWarn.innerHTML = `<strong>Streaming downloads aren't supported in this browser</strong> — this transfer may be slow or fail for large files. Chrome gives the best experience.`;
    dlCompatWarn.offsetHeight; // eslint-disable-line no-unused-expressions
    dlCompatWarn.classList.add('visible');
  }

  // ── Wire Download button ─────────────────────────────────────────────────
  // FSAA click handler order (locked):
  // showSaveFilePicker() MUST be the first async operation — Chrome rejects
  // picker calls that occur after awaited work (non-gesture context).
  rcDownloadBtn.addEventListener('click', async () => {
    receiverCard.style.display = 'none';

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
          downloadToken = token;
          unlockInput.value = '';
          unlockScreen.style.display = 'none';
          await startDownloadGated(uuid, meta);
        } catch {
          unlockError.textContent = 'Network error. Try again.';
          unlockBtn.disabled = false;
        }
      });
      unlockInput.addEventListener('keydown', e => { if (e.key === 'Enter') unlockBtn.click(); });
    } else {
      await startDownloadGated(uuid, meta);
    }
  }, { once: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Download capability gate — routes to FSAA stream or Blob fallback
// ─────────────────────────────────────────────────────────────────────────────
async function startDownloadGated(uuid, meta) {
  const hasFSAA = typeof showSaveFilePicker !== 'undefined';

  if (hasFSAA) {
    const fileName = meta.file_name || `refueler-${uuid.slice(0, 8)}`;
    let fileHandle;
    try {
      fileHandle = await showSaveFilePicker({
        suggestedName: fileName,
        types: [],
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        receiverCard.style.display = 'flex';
        return;
      }
      reportError('fsaa_picker_error', e.message, `uuid:${uuid.slice(0,8)}`);
      await startDownload(uuid, meta);
      return;
    }
    await startDownloadStream(uuid, meta, fileHandle);
  } else {
    await startDownload(uuid, meta);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FSAA streaming download — pipeline depth 2, per-chunk retry (3×, exp backoff)
// Memory resident at any time: at most 2 chunks of ciphertext + 1 of plaintext.
// ─────────────────────────────────────────────────────────────────────────────
async function startDownloadStream(uuid, meta, fileHandle) {
  const totalChunks = meta.total_chunks;
  if (!totalChunks || totalChunks < 1) {
    showDownloadError('Transfer metadata is incomplete. Please try again.');
    return;
  }

  downloadCard.classList.remove('hidden');
  dlStageTag.textContent = 'Downloading';
  dlPct.textContent = '0%';
  dlBar.style.width = '0%';

  let writable;
  try {
    writable = await fileHandle.createWritable();
  } catch (e) {
    showDownloadError('Could not open the save location. Please try again.');
    return;
  }

  // ── Per-chunk fetch with retry ────────────────────────────────────────────
  async function fetchChunkWithRetry(chunkIdx) {
    const padded = String(chunkIdx).padStart(4, '0');
    const headers = {};
    if (downloadToken) headers['Authorization'] = `Bearer ${downloadToken}`;

    const RETRYABLE_DELAYS = [1000, 2000, 4000];
    let lastErr;

    for (let attempt = 0; attempt <= RETRYABLE_DELAYS.length; attempt++) {
      try {
        const res = await fetch(`${WORKER_URL}/download/${uuid}/${padded}`, { headers });

        if (res.status === 400 || res.status === 401 || res.status === 410) {
          const err = new Error(`HTTP ${res.status}`);
          err.fatal = true;
          err.status = res.status;
          throw err;
        }

        if (res.ok) return await res.arrayBuffer();

        lastErr = new Error(`HTTP ${res.status}`);
      } catch (e) {
        if (e.fatal) throw e;
        lastErr = e;
      }

      if (attempt < RETRYABLE_DELAYS.length) {
        await new Promise(r => setTimeout(r, RETRYABLE_DELAYS[attempt]));
      }
    }

    const err = new Error(lastErr?.message || 'Network error');
    err.retryExhausted = true;
    throw err;
  }

  // ── Streaming loop — pipeline depth 2 ─────────────────────────────────────
  try {
    let nextChunkPromise = fetchChunkWithRetry(0);

    for (let i = 0; i < totalChunks; i++) {
      const ciphertextBuf = await nextChunkPromise;
      if (i + 1 < totalChunks) {
        nextChunkPromise = fetchChunkWithRetry(i + 1);
      }

      const aad = new Uint8Array(4);
      new DataView(aad.buffer).setUint32(0, i, false);

      let plaintext;
      try {
        plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: sessionIv, additionalData: aad },
          sessionAesKey,
          ciphertextBuf
        );
      } catch (e) {
        reportError('decrypt', e.message, `uuid:${uuid.slice(0,8)} chunk:${i}`).catch(() => {});
        // Privacy: abort() discards the incomplete FSAA temp file — no partial plaintext
        // remains on disk after a failed transfer. Document in B9 security whitepaper.
        await writable.abort();
        showDownloadError('Decryption failed — wrong key or corrupted data. No partial file was saved.');
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
    dlSignoff.classList.remove('hidden');
    try { logReceiverEvent('receiver_ab_downloaded', sessionStorage.getItem('rs-usp-variant') || 'unknown'); } catch {}

  } catch (e) {
    reportError('download_chunk_retry_exhausted', e.message || 'unknown', `uuid:${uuid.slice(0,8)}`).catch(() => {});

    try {
      // Privacy: abort() discards the incomplete FSAA temp file.
      await writable.abort();
    } catch { /* already closed or aborted */ }

    if (e.status === 401) {
      showDownloadError('Access denied. This transfer may have expired or the link is incorrect.');
    } else if (e.status === 410) {
      showDownloadError('This transfer has expired. The file is no longer available.');
    } else if (e.retryExhausted) {
      showDownloadError('Download failed after several attempts. Check your connection and try again.');
    } else {
      showDownloadError('Download failed. Please try again.');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Blob fallback download — for browsers without FSAA (showSaveFilePicker) support.
// Memory cost: 2× file size. Not suitable for large files — capability warning
// shown above 300 MB / 1 GB on receiver card.
// ─────────────────────────────────────────────────────────────────────────────
async function startDownload(uuid, meta) {
  const totalChunks = meta?.total_chunks;
  if (!totalChunks || totalChunks < 1) {
    showDownloadError('Transfer metadata is incomplete. Please try again.');
    return;
  }

  downloadCard.classList.remove('hidden');
  dlStageTag.textContent = 'Downloading';
  dlPct.textContent = '0%';
  dlBar.style.width = '0%';

  const totalBytes = (meta.total_bytes && meta.total_bytes > 0) ? meta.total_bytes : 0;
  const fileName = meta?.file_name || `refueler-${uuid.slice(0, 8)}`;
  const chunks = [];
  let bytesReceived = 0;

  // ── Fetch phase ────────────────────────────────────────────────────────────
  for (let i = 0; i < totalChunks; i++) {
    const headers = {};
    if (downloadToken) headers['Authorization'] = `Bearer ${downloadToken}`;
    const padded = String(i).padStart(4, '0');
    const res = await fetch(`${WORKER_URL}/download/${uuid}/${padded}`, { headers });

    if (res.status === 401 || res.status === 410) {
      showDownloadError(res.status === 401
        ? 'Access denied. This transfer may have expired or the link is incorrect.'
        : 'This transfer has expired. The file is no longer available.');
      return;
    }
    if (!res.ok) {
      reportError('download_chunk', `HTTP ${res.status} chunk ${i}`, `uuid:${uuid.slice(0,8)}`).catch(() => {});
      showDownloadError(`Download failed (${res.status}). Please try again.`);
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

  // ── Decrypt phase ──────────────────────────────────────────────────────────
  dlStageTag.textContent = 'Decrypting';
  const decrypted = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const aad = new Uint8Array(4);
      new DataView(aad.buffer).setUint32(0, i, false);
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sessionIv, additionalData: aad },
        sessionAesKey, chunks[i]
      );
      decrypted.push(plain);
    } catch (e) {
      reportError('decrypt', e.message, `uuid:${uuid.slice(0,8)} chunk:${i}`).catch(() => {});
      showDownloadError('Decryption failed — wrong key or corrupted data.');
      return;
    }

    const pct = 50 + Math.round(((i + 1) / chunks.length) * 50);
    dlBar.style.width = pct + '%';
    dlPct.textContent = pct + '%';
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const blob    = new Blob(decrypted, { type: 'application/octet-stream' });
  const blobUrl = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href        = blobUrl;
  a.download    = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

  dlStageTag.textContent = 'Complete';
  dlBar.style.width = '100%';
  dlPct.textContent = '100%';
  uspBlock.classList.add('hidden');
  dlSignoff.classList.remove('hidden');
  try { logReceiverEvent('receiver_ab_downloaded', sessionStorage.getItem('rs-usp-variant') || 'unknown'); } catch {}
}

function showDownloadError(msg) {
  downloadCard.classList.remove('hidden');
  dlStageTag.textContent = `Error — ${msg}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// NUT-00 crypto — NOTE: uses secp256k1 v1 API (secp.Point.*)
// v1 API will break if secp256k1 is upgraded to v2 — do not upgrade without migrating
// ─────────────────────────────────────────────────────────────────────────────
async function generateBlindedCredential() {
  const r   = secp.utils.randomPrivateKey();
  const msg = crypto.getRandomValues(new Uint8Array(32));
  const Y   = await hashToCurve(bufToHex(msg));
  const rG  = secp.Point.fromPrivateKey(r);
  const B_  = Y.add(rG);
  return { blindedMsg: B_.toHex(true), blindingFactor: bufToHex(r) };
}

async function unblindSignature(signedPoint, blindingFactor, mintPubkeyHex) {
  const C_ = secp.Point.fromHex(signedPoint);
  const K  = secp.Point.fromHex(mintPubkeyHex);
  const r  = BigInt('0x' + blindingFactor);
  const C  = C_.add(K.multiply(r).negate());
  return JSON.stringify({ C: C.toHex(true), mint_pubkey: mintPubkeyHex });
}

async function hashToCurve(msgHex) {
  const hash = await crypto.subtle.digest('SHA-256', hexToBuf(msgHex));
  const hashHex = bufToHex(hash);
  for (let i = 0; i < 256; i++) {
    try {
      return secp.Point.fromHex('02' + (BigInt('0x' + hashHex) + BigInt(i)).toString(16).padStart(64, '0'));
    } catch { continue; }
  }
  throw new Error('hashToCurve failed');
}

// ─────────────────────────────────────────────────────────────────────────────
// BLAKE3 + SHA-256
// ─────────────────────────────────────────────────────────────────────────────
async function blake3Hash(data) {
  const h = blake3.createHash();
  h.update(data);
  return h.digest('hex');
}

async function sha256Hex(data) {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function parseFragment() {
  const raw = location.hash.slice(1);
  if (!raw) return {};
  return Object.fromEntries(raw.split('&').map(p => p.split('=')));
}
function splitChunks(file, size) {
  const out = [];
  let offset = 0;
  while (offset < file.size) { out.push(file.slice(offset, offset + size)); offset += size; }
  return out;
}
function readChunk(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(blob);
  });
}
function setStage(label, pct) {
  stageTag.textContent     = label;
  progressPct.textContent  = pct + '%';
  progressBar.style.width  = pct + '%';
}
function setProgress(pct, detail) {
  progressPct.textContent   = pct + '%';
  progressBar.style.width   = pct + '%';
  progressDetail.textContent = detail;
}
function formatBytes(b) {
  if (b < 1024)       return b + ' B';
  if (b < 1024 ** 2)  return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 ** 3)  return (b / 1024 ** 2).toFixed(1) + ' MB';
  return (b / 1024 ** 3).toFixed(2) + ' GB';
}
function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBuf(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return out.buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error reporting (S36b) — fire-and-forget, never blocks flow, never surfaces to user
// ─────────────────────────────────────────────────────────────────────────────
function reportError(context, message, detail) {
  try {
    fetch(`${WORKER_URL}/log/error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: String(context).slice(0, 64),
        message: String(message || '').slice(0, 200),
        detail:  String(detail  || '').slice(0, 200),
        ts:      Date.now(),
      }),
    }).catch(() => {});
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Receiver A/B event logging (S47c) — fire-and-forget, no identity, no cookies
// ─────────────────────────────────────────────────────────────────────────────
function logReceiverEvent(event, variant) {
  try {
    fetch(`${WORKER_URL}/log/error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: 'receiver_ab',
        message: String(event).slice(0, 64),
        detail:  `variant:${variant}`,
        ts:      Date.now(),
      }),
    }).catch(() => {});
  } catch {}
}

async function waitForTurnstile(ms = 10000) {
  const start = Date.now();
  while (!turnstileToken && Date.now() - start < ms) await new Promise(r => setTimeout(r, 200));
}
