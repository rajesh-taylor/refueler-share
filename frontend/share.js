// ── share.js — extracted from src/index.njk at S51 ──────────────────────────
// DO NOT edit inline JS in index.njk — edit this file only.
// Loaded as <script type="module" src="/share.js"></script>
// TH-2: permanent-record toggle, seal_nonce, blake3PlaintextRoot, OTS download offer.

// ── TH-2: import permanent-record helpers from timestamp.js ──────────────────
import {
  generateSealNonce,
  runPermanentRecord,
  decryptOts,
} from './timestamp.js';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const WORKER_URL  = 'https://refueler-share.rt-fc4.workers.dev';
const CHUNK_SIZE  = 8 * 1024 * 1024;         // 8 MB
const FREE_CAP    = 4 * 1024 * 1024 * 1024;  // 4 GB
const FREE_EXPIRY = 7 * 24 * 60 * 60;        // 7 days in seconds — matches UI "1 / 7 day expiry" and server EXPIRY_WINDOWS.free

// Tier expiry seconds — mirrors server TIER_EXPIRY_SECONDS.
// Used by resume flow to determine whether a saved transfer is still within window.
const TIER_EXPIRY_SECONDS = {
  free:              7 * 24 * 60 * 60,   // 7 days
  creative_premium: 30 * 24 * 60 * 60,  // 30 days (longest window)
  production_max:   90 * 24 * 60 * 60,  // 90 days (longest window)
};

// Safari fetch timeout — Safari silently hangs on network drops; Promise.race()
// wraps each chunk upload so the per-chunk retry loop fires instead of stalling forever.
const CHUNK_UPLOAD_TIMEOUT_MS = 60_000; // 60 s per chunk

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
const rcFileIcon       = $('rc-file-icon');
const rcFileName       = $('rc-file-name');
const rcFolderNote     = $('rc-folder-note');
const rcSize           = $('rc-size');
const rcExpiry         = $('rc-expiry');
const rcPassphraseRow  = $('rc-passphrase-row');
const rcDownloadBtn    = $('rc-download-btn');
const uspBlock         = $('usp-block');
const uspText          = $('usp-text');

// ── TG-block DOM refs (injected into options card by enterUploadMode) ─────────
// Elements do not exist in the Njk — created in JS so Njk stays untouched.
let destroyToggle   = null; // <input type="checkbox"> #destroy-after-download
let destroyNotice   = null; // <div> #destroy-notice — amber sender warning
let tidalSection    = null; // <div> #tidal-window-section — paid-only wrapper
let availableFrom   = null; // <input type="datetime-local"> #available-from
let availableUntil  = null; // <input type="datetime-local"> #available-until
let tidalError      = null; // <div> #tidal-error — inline invariant error

// ── TH-2: permanent-record DOM refs ──────────────────────────────────────────
let permanentRecordToggle  = null; // <input type="checkbox"> #permanent-record-toggle
let permanentRecordNotice  = null; // <div> #permanent-record-notice — amber notice

// ─────────────────────────────────────────────────────────────────────────────
// Info card
// ─────────────────────────────────────────────────────────────────────────────
$('dismiss-info').addEventListener('click', () => infoCard.classList.add('hidden'));

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
// sealNonceHex: hex string | undefined — absent on legacy records and Citizen uploads.
// Resume path: if absent, permanent record is silently skipped on resume. Correct.
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

// Write (or overwrite) chunk completion state after each 200 ACK.
// RU1a: record includes tier and expiryTimestamp for expiry-awareness on resume.
// TH-2: record includes sealNonceHex (optional) for fragment reconstruction on resume.
async function writeChunkState(record) {
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
    // IDB write failure must never interrupt the upload — fire and forget.
    reportError('idb_write', e.message, record.uuid?.slice(0, 8) ?? '');
  }
}

// Return the first interrupted transfer record, or null.
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

// Delete a resume record by UUID.
async function clearResumeState(uuid) {
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
// Resume UI — shown on page load if an interrupted transfer is found in IDB.
//
// RU1a: Resume button now wired to full resume flow.
// Expiry-awareness: if the transfer window has closed, Resume is hidden and
// only Discard is offered with an explanatory message.
// ─────────────────────────────────────────────────────────────────────────────
const resumeCard       = $('resume-card');
const resumeDetail     = $('resume-detail');
const resumeDiscardBtn = $('resume-discard-btn');
const resumeNoticeBtn  = $('resume-notice-btn');

// Stored resume record — populated by checkResumeState(), consumed by resumeUpload().
let pendingResumeRecord = null;

async function checkResumeState() {
  const record = await readResumeState();
  if (!record) return;

  // ── Stale guard: discard records older than 8 days (transfer expiry is max 7 days).
  const age = Date.now() - (record.timestamp || 0);
  if (age > 8 * 24 * 60 * 60 * 1000) {
    await clearResumeState(record.uuid);
    return;
  }

  // ── Expiry-awareness (RU1a): check whether the transfer window is still open.
  // Prefer stored expiryTimestamp (seconds epoch); fall back to computing from tier.
  const nowSecs = Date.now() / 1000;
  let expired = false;

  if (record.expiryTimestamp) {
    expired = nowSecs > record.expiryTimestamp;
  } else if (record.tier && TIER_EXPIRY_SECONDS[record.tier]) {
    // Legacy records (pre-RU1a) lack expiryTimestamp — derive from timestamp + tier window.
    const windowSecs = TIER_EXPIRY_SECONDS[record.tier];
    const writtenSecs = (record.timestamp || 0) / 1000;
    expired = nowSecs > writtenSecs + windowSecs;
  }

  pendingResumeRecord = record;

  // Populate detail line: "photo-shoot.zip — chunk 82 of 193 (3.72 GB)"
  const pct    = Math.round((record.chunkIndex + 1) / record.totalChunks * 100);
  const detail = `${record.fileName} — ${pct}% uploaded (chunk ${record.chunkIndex + 1} of ${record.totalChunks}, ${formatBytes(record.fileSize)})`;
  if (resumeDetail) resumeDetail.textContent = detail;

  // Reassurance note — shown below the detail line on the resume card.
  // Architecturally accurate: AES-GCM key lives in the URL fragment only,
  // never touches the server. The server holds encrypted noise and nothing else.
  const resumeNote = $('resume-note');
  if (resumeNote) resumeNote.classList.remove('hidden');

  if (resumeCard) resumeCard.classList.remove('hidden');

  // ── Discard: wipe IDB record and dismiss card.
  if (resumeDiscardBtn) {
    resumeDiscardBtn.addEventListener('click', async () => {
      await clearResumeState(record.uuid);
      pendingResumeRecord = null;
      if (resumeCard) resumeCard.classList.add('hidden');
    }, { once: true });
  }

  if (expired) {
    // Transfer window closed — Resume is pointless. Show Discard only.
    if (resumeDetail) {
      resumeDetail.textContent = `${record.fileName} — transfer window has expired. Discard and start a new transfer.`;
    }
    if (resumeNoticeBtn) resumeNoticeBtn.classList.add('hidden');
    return;
  }

  // ── Resume: wire full resume flow (RU2c).
  // NOT { once: true } — resumeUpload() may return early (picker cancel, file mismatch)
  // and the button must stay live so the user can click again without refreshing.
  // Guard flag prevents concurrent resume attempts if the user double-clicks.
  if (resumeNoticeBtn) {
    let resumeInFlight = false;
    resumeNoticeBtn.addEventListener('click', async () => {
      if (resumeInFlight) return;
      resumeInFlight = true;
      await resumeUpload(record);
      resumeInFlight = false;
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resume flow (RU1a)
//
// Re-uses the existing upload loop from startUpload() but:
//   1. Restores AES key and IV from the IDB record (keyHex / ivHex).
//   2. Skips chunks 0..record.chunkIndex (already confirmed by the Worker).
//   3. Re-sends chunk 0 headers on the first chunk being resumed, because the
//      Worker needs the credential and metadata for any chunk that arrives
//      after a restart. The credential is not available after a page reload —
//      we re-issue a fresh one. The UUID is preserved (Worker already has the
//      partial object).
//
// Credential re-issue on resume is correct: the existing chunks are already
// committed to R2 under the original UUID. The resumed upload sends the new
// credential on the first resumed chunk so the Worker can re-validate tier
// and capacity before allowing further chunks.
//
// TH-2: sealNonceHex restored from IDB record if present. Fragment includes &sn=
// on the share URL if present, enabling the recipient to reconstruct it.
// Permanent record itself is NOT re-run on resume — the pipeline already
// completed (or was skipped) before the interruption. Correct: do not retry.
// ─────────────────────────────────────────────────────────────────────────────
async function resumeUpload(record) {
  if (!record) return;

  // Hide resume card, show progress card.
  if (resumeCard) resumeCard.classList.add('hidden');
  progressCard.classList.remove('hidden');
  setStage('Resuming', 5);

  await loadDeps();

  // Restore crypto state from IDB record.
  const keyBytes = hexToBuf(record.keyHex);
  const ivBytes  = hexToBuf(record.ivHex);
  sessionAesKey  = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  sessionIv      = new Uint8Array(ivBytes);
  uploadUUID     = record.uuid;

  const totalChunks     = record.totalChunks;
  const resumeFromChunk = record.chunkIndex + 1; // first chunk not yet confirmed
  const expiryTimestamp = record.expiryTimestamp
    || (Math.floor((record.timestamp || Date.now()) / 1000) + (TIER_EXPIRY_SECONDS[record.tier] || FREE_EXPIRY));

  // TH-2: restore sealNonceHex from IDB if present
  const sealNonceHex = record.sealNonceHex || null;

  setStage('Re-credentialling', 8);

  // Re-issue a fresh credential for the resumed transfer.
  // Resume path uses `resume: true` + `resume_uuid` — the Worker verifies a real
  // partial upload exists in R2 (chunk 0000 head-check) and skips Turnstile.
  // Turnstile was already solved when the original upload began; requiring it again
  // after a connection drop is security theatre that just breaks the flow.
  let credential, commitment, issuedTier;
  try {
    const { blindedMsg, blindingFactor } = await generateBlindedCredential();
    const issueRes = await fetch(`${WORKER_URL}/credential/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resume:        true,
        resume_uuid:   record.uuid,
        blinded_message: blindedMsg,
        tier:          record.tier || 'free',
      }),
    });
    if (!issueRes.ok) {
      const errText = await issueRes.text();
      throw new Error(`Re-credential failed (${issueRes.status}): ${errText}`);
    }
    const issueData = await issueRes.json();
    if (!issueData.uuid || !issueData.commitment) throw new Error('Re-credential response missing uuid or commitment');

    // The Worker issues a fresh UUID for the new credential — but we continue
    // uploading to the *original* UUID. We need the commitment and credential
    // from the new issuance but send them against the old UUID.
    credential   = await unblindSignature(issueData.signed_point, blindingFactor, issueData.mint_pubkey);
    commitment   = issueData.commitment;
    issuedTier   = issueData.issued_tier || record.tier || 'free';
  } catch (e) {
    reportError('resume_credential', e.message, `uuid:${record.uuid.slice(0, 8)}`);
    progressCard.classList.remove('hidden');
    setStage('Could not re-validate — please start a new transfer.', 0);
    progressDetail.textContent = '';
    return;
  }

  setStage(`Resuming from chunk ${resumeFromChunk + 1} of ${totalChunks}`, 10);

  // We need the original file to read chunks from — but we only have the
  // encrypted data already on the server for chunks 0..resumeFromChunk-1.
  // We cannot re-read the original file (it's not in memory).
  // Resolution: the resume flow requires the user to re-select the same file.
  // On page load we don't have the File object. Present a targeted file picker.
  //
  // This is correct UX: we tell the user exactly which file to re-select.
  // The IDB record has fileName and fileSize for the prompt.
  let resumeFile = null;
  try {
    resumeFile = await promptForResumeFile(record.fileName, record.fileSize);
  } catch (e) {
    // User cancelled the picker or browser doesn't support it.
    progressCard.classList.add('hidden');
    if (resumeCard) resumeCard.classList.remove('hidden');
    if (resumeDetail) resumeDetail.textContent = `${record.fileName} — select the same file to resume.`;
    return;
  }

  if (!resumeFile) {
    progressCard.classList.add('hidden');
    if (resumeCard) resumeCard.classList.remove('hidden');
    return;
  }

  // Verify file identity (name + size match).
  if (resumeFile.name !== record.fileName || resumeFile.size !== record.fileSize) {
    progressCard.classList.add('hidden');
    if (resumeCard) resumeCard.classList.remove('hidden');
    if (resumeDetail) {
      resumeDetail.textContent = `File mismatch — expected "${record.fileName}" (${formatBytes(record.fileSize)}). Please select the original file.`;
    }
    return;
  }

  const chunks = splitChunks(resumeFile, CHUNK_SIZE);

  // Verify chunk count matches the IDB record — a different chunk size would
  // produce misaligned encrypted blocks and corrupt the transfer on the server.
  if (chunks.length !== record.totalChunks) {
    progressCard.classList.add('hidden');
    if (resumeCard) resumeCard.classList.remove('hidden');
    if (resumeDetail) {
      resumeDetail.textContent = `File layout mismatch (expected ${record.totalChunks} chunks, got ${chunks.length}). Start a new transfer.`;
    }
    reportError('resume_chunk_count', `expected ${record.totalChunks} got ${chunks.length}`, `uuid:${record.uuid.slice(0,8)}`);
    return;
  }

  const chunkHashes = [];

  // Reconstruct rolling hashes for all already-uploaded chunks so the root
  // remains consistent when we resume. We encrypt each skipped chunk locally
  // (same key/IV) and hash it — this replicates what startUpload() did.
  setStage('Verifying prior chunks', 12);
  for (let i = 0; i < resumeFromChunk; i++) {
    const raw = await readChunk(chunks[i]);
    const aad = new Uint8Array(4);
    new DataView(aad.buffer).setUint32(0, i, false);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: sessionIv, additionalData: aad },
      sessionAesKey, raw
    );
    let h;
    try { h = await blake3Hash(new Uint8Array(encrypted)); } catch (e) {
      reportError('resume_hash', e.message, `uuid:${uploadUUID.slice(0,8)} chunk:${i}`);
      throw e;
    }
    chunkHashes.push(h);
    const pct = Math.round(((i + 1) / resumeFromChunk) * 10) + 12;
    setProgress(pct, `Verifying chunk ${i + 1} of ${resumeFromChunk}…`);
  }

  setStage(`Resuming — uploading from chunk ${resumeFromChunk + 1} of ${totalChunks}`, 22);

  // Upload remaining chunks.
  for (let i = resumeFromChunk; i < totalChunks; i++) {
    const raw = await readChunk(chunks[i]);
    const aad = new Uint8Array(4);
    new DataView(aad.buffer).setUint32(0, i, false);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: sessionIv, additionalData: aad },
      sessionAesKey, raw
    );

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

    // Re-send chunk-0 headers on the first resumed chunk — Worker needs them.
    if (i === resumeFromChunk) {
      headers['X-Cashu-Credential']      = credential;
      headers['X-Total-Chunks']          = String(totalChunks);
      headers['X-Total-Bytes']           = String(record.fileSize);
      headers['X-Tier']                  = issuedTier;
      headers['X-Expiry-Timestamp']      = String(expiryTimestamp);
      headers['X-File-Name']             = record.fileName;
      headers['X-Credential-Commitment'] = commitment;
      headers['X-Issued-Tier']           = issuedTier;
      headers['X-Resume-From-Chunk']     = String(resumeFromChunk); // advisory
    }

    // Retry loop — mirrors startUpload(). Handles Safari silent drops (.timedOut)
    // and transient 5xx. Non-retryable 4xx rethrows immediately.
    const CHUNK_RETRY_DELAYS = [2000, 5000, 10000];
    let lastErr;
    let uploaded = false;
    for (let attempt = 0; attempt <= CHUNK_RETRY_DELAYS.length; attempt++) {
      try {
        const res = await fetchWithTimeout(
          `${WORKER_URL}/upload/${uploadUUID}/${String(i).padStart(4, '0')}`,
          { method: 'PUT', headers, body: encrypted },
          CHUNK_UPLOAD_TIMEOUT_MS
        );
        if (res.status === 409) {
          // Stale R2 object — this transfer was already completed in a prior session
          // (e.g. a CORS-blocked run that landed server-side but not client-side).
          // Nothing to resume: clear IDB, tell the user, offer a fresh upload.
          reportError('resume_409', `chunk ${i} 409 — transfer already complete`, `uuid:${uploadUUID.slice(0,8)}`);
          await clearResumeState(uploadUUID);
          progressCard.classList.add('hidden');
          if (resumeCard) resumeCard.classList.remove('hidden');
          if (resumeDetail) {
            resumeDetail.textContent = 'This transfer was already completed — start a new upload.';
          }
          const resumeNote = $('resume-note');
          if (resumeNote) resumeNote.classList.add('hidden');
          const resumeDiscardBtn409 = $('resume-discard-btn');
          if (resumeDiscardBtn409) resumeDiscardBtn409.textContent = 'New upload';
          if (resumeDiscardBtn409) resumeDiscardBtn409.addEventListener('click', () => location.reload(), { once: true });
          return;
        }
        if (res.status >= 400 && res.status < 500) {
          const errText = await res.text();
          reportError('resume_chunk', `HTTP ${res.status} chunk ${i}`, `uuid:${uploadUUID.slice(0,8)} chunk:${i} text:${errText.slice(0,100)}`);
          throw new Error(`Chunk ${i} upload failed (resume): ${errText}`);
        }
        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status}`);
        } else {
          uploaded = true;
          break;
        }
      } catch (e) {
        if (e.timedOut) {
          lastErr = e;
          reportError('resume_chunk_timeout', `chunk ${i} timed out attempt ${attempt}`, `uuid:${uploadUUID.slice(0,8)}`);
        } else if (e.message?.includes('upload failed (resume)')) {
          throw e; // 4xx — not retryable
        } else {
          lastErr = e;
        }
      }
      if (!uploaded && attempt < CHUNK_RETRY_DELAYS.length) {
        await new Promise(r => setTimeout(r, CHUNK_RETRY_DELAYS[attempt]));
      }
    }
    if (!uploaded) {
      throw new Error(`Chunk ${i} failed after ${CHUNK_RETRY_DELAYS.length + 1} attempts: ${lastErr?.message}`);
    }

    // Update IDB with latest confirmed chunk.
    writeChunkState({
      uuid: uploadUUID, chunkIndex: i, totalChunks,
      fileName: record.fileName, fileSize: record.fileSize,
      keyHex: record.keyHex, ivHex: record.ivHex,
      tier: record.tier || 'free', expiryTimestamp, timestamp: Date.now(),
      sealNonceHex: sealNonceHex || undefined, // TH-2: carry through on resume
    }).catch(() => {});

    const uploadedChunks  = i - resumeFromChunk + 1;
    const remainingChunks = totalChunks - resumeFromChunk;
    const pct = Math.round(22 + (uploadedChunks / remainingChunks) * 73);
    setProgress(pct, `Resuming from chunk ${resumeFromChunk + 1} of ${totalChunks} — chunk ${i + 1} of ${totalChunks} sent`);
  }

  clearResumeState(uploadUUID).catch(() => {});

  setStage('Finalising', 98);
  await new Promise(r => setTimeout(r, 80));
  setStage('Done', 100);
  progressDetail.textContent = 'Transfer resumed and complete';
  await new Promise(r => setTimeout(r, 700));
  progressCard.classList.add('hidden');

  // TH-2: include &sn= in fragment if sealNonceHex was stored in IDB record.
  // Permanent record pipeline itself is not re-run on resume.
  const fragmentStr = sealNonceHex
    ? `uuid=${uploadUUID}&key=${record.keyHex}&iv=${record.ivHex}&sn=${sealNonceHex}`
    : `uuid=${uploadUUID}&key=${record.keyHex}&iv=${record.ivHex}`;
  const shareUrl = `${location.origin}${location.pathname}#${fragmentStr}`;
  history.replaceState(null, '', location.pathname);
  showSharePanel(shareUrl, false);
}

// Prompt the user to re-select the interrupted file.
// Returns a Promise<File> — rejects if cancelled.
function promptForResumeFile(expectedName, expectedSize) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    document.body.appendChild(input);

    // Update detail to guide the user.
    if (resumeDetail) {
      resumeDetail.textContent = `Select the original file to resume: "${expectedName}" (${formatBytes(expectedSize)})`;
    }

    // Cancellation: if focus returns to window without a change event, reject.
    // onFocus defined before change listener so both closures share the reference.
    let settled = false;
    const onFocus = () => {
      setTimeout(() => {
        if (settled) return; // change event already fired — do nothing
        settled = true;
        if (document.body.contains(input)) document.body.removeChild(input);
        reject(new Error('File picker cancelled'));
      }, 500);
    };
    window.addEventListener('focus', onFocus, { once: true });

    input.addEventListener('change', () => {
      settled = true;
      window.removeEventListener('focus', onFocus); // stop cancellation firing after a normal pick
      if (document.body.contains(input)) document.body.removeChild(input);
      if (input.files[0]) resolve(input.files[0]);
      else reject(new Error('No file selected'));
    }, { once: true });

    input.click();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Safari upload timeout wrapper (RU1a)
//
// Safari silently drops connections on large uploads — fetch() hangs
// indefinitely with no error event, so per-chunk retry never fires.
// fetchWithTimeout() races the fetch against a deadline AbortController.
// On timeout, throws an Error with .timedOut = true so the caller can retry.
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
// Mode detection
// ─────────────────────────────────────────────────────────────────────────────
const fragment = parseFragment();
if (fragment.uuid && fragment.key) {
  enterDownloadMode(fragment);
} else {
  // Check for interrupted transfer before handing control to upload mode.
  checkResumeState().catch(() => {}); // never blocks upload mode
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

  // Drop zone click — opens the single-file picker.
  // S56: file input is now outside the drop zone hit area so this explicit
  // click handler is required. No delay from full-area invisible input.
  dropZone.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  // Single-file input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
      clearDropMsg();
      handleFileSelection(fileInput.files[0]);
    }
  });

  // Browse file button — explicit file picker trigger (redundant with drop zone
  // click but provided as a clear affordance alongside the folder button).
  const fileBtn = $('file-btn');
  if (fileBtn) {
    fileBtn.addEventListener('click', e => {
      e.stopPropagation(); // prevent bubbling to drop zone click handler
      fileInput.value = '';
      fileInput.click();
    });
  }

  // Folder button triggers the hidden webkitdirectory input.
  folderBtn.addEventListener('click', e => {
    e.stopPropagation(); // prevent bubbling to drop zone click handler
    folderInput.value = '';
    folderInput.click();
  });

  // webkitdirectory input — user selected a folder via the picker.
  // On macOS Chrome, webkitdirectory navigates into the folder — user clicks
  // Open from inside the folder, which submits all files within it.
  // Subfolders are traversed by the browser and included in files[].
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

  // ── TG-block + TH-2: inject destroy toggle, tidal window, permanent-record
  //    toggle into options card ──────────────────────────────────────────────
  _injectTransferOptions();

  uploadBtn.addEventListener('click', startUpload);
  copyBtn.addEventListener('click', copyShareLink);
  newUploadBtn.addEventListener('click', () => location.reload());
}

// ─────────────────────────────────────────────────────────────────────────────
// TG-block + TH-2: inject transfer option controls into the options card
//
// Called once from enterUploadMode(). Inserts:
//   1. Destroy-after-download toggle row (all tiers)
//   2. Amber sender notice (shown when toggle is on)
//   3. Tidal window section — available-from / available-until pickers
//      (paid tiers only; hidden entirely for Citizen / free)
//   4. [TH-2] Permanent-record toggle row (paid tiers only; hidden for Citizen)
//   5. [TH-2] Amber permanent-record notice (shown when toggle is on)
//
// Placement: immediately before the upload button wrapper div.
// Datetime pickers use native input[type=datetime-local] — IBM Plex Mono,
// Paper/Carbon tokens, no custom calendar. Min attribute set dynamically to
// prevent past dates. Values converted to unix integer seconds on the wire.
// ─────────────────────────────────────────────────────────────────────────────
function _injectTransferOptions() {
  const uploadBtnWrap = uploadBtn.closest('.mt16');
  if (!uploadBtnWrap) return; // guard: options card not in expected shape

  // ── 1. Destroy-after-download toggle ───────────────────────────────────────
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
  destroyToggle = $('destroy-after-download');

  // ── 2. Amber sender notice — shown when destroy toggle is on ───────────────
  const notice = document.createElement('div');
  notice.id = 'destroy-notice';
  notice.className = 'destroy-notice hidden';
  notice.innerHTML = `<strong>Once downloaded, this transfer is gone.</strong> The recipient cannot return to it. Send only when you are certain.`;
  destroyRow.insertAdjacentElement('afterend', notice);
  destroyNotice = notice;

  destroyToggle.addEventListener('change', () => {
    destroyNotice.classList.toggle('hidden', !destroyToggle.checked);
  });

  // ── 3. Tidal window — available-from / available-until ─────────────────────
  // Hidden for Citizen (free) tier. Visibility set by _updatePaidFeaturesVisibility()
  // when a credential is issued (issuedTier is known). Default: hidden.
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
  destroyNotice.insertAdjacentElement('afterend', tidal);
  tidalSection   = $('tidal-window-section');
  availableFrom  = $('available-from');
  availableUntil = $('available-until');
  tidalError     = $('tidal-error');

  // Set minimum datetime to now (prevents past selection without extra JS validation).
  // Rounded to the current minute — datetime-local step is 60s by default.
  function _setPickerMin() {
    const nowMs  = Date.now();
    const nowMin = new Date(nowMs - (nowMs % 60000)); // floor to minute
    const iso    = nowMin.toISOString().slice(0, 16);  // "YYYY-MM-DDTHH:MM"
    availableFrom.min  = iso;
    availableUntil.min = iso;
  }
  _setPickerMin();

  // Recompute min each time a picker is focused — page may have been open a while.
  availableFrom.addEventListener('focus', _setPickerMin);
  availableUntil.addEventListener('focus', _setPickerMin);

  // Clear tidal error on any picker change so stale messages don't linger.
  availableFrom.addEventListener('change', () => _clearTidalError());
  availableUntil.addEventListener('change', () => _clearTidalError());

  // ── 4. [TH-2] Permanent-record toggle ─────────────────────────────────────
  // Hidden for Citizen (free) tier. Revealed by _updatePaidFeaturesVisibility()
  // once issuedTier is known. Default: hidden (same timing as tidal section).
  // Label and description: spec-locked — no "notarise", no "blockchain".
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
  permanentRecordToggle = $('permanent-record-toggle');

  // ── 5. [TH-2] Amber permanent-record notice ────────────────────────────────
  // Shown when toggle is on. Honest scope: proves when, not who.
  // Spec-locked copy — do not edit without product confirmation.
  const prNotice = document.createElement('div');
  prNotice.id = 'permanent-record-notice';
  prNotice.className = 'destroy-notice hidden'; // reuse destroy-notice amber style
  prNotice.innerHTML = `<strong>This creates an unforgeable record that this file existed.</strong> The stamp is public — it proves when, not who.`;
  permanentRow.insertAdjacentElement('afterend', prNotice);
  permanentRecordNotice = prNotice;

  permanentRecordToggle.addEventListener('change', () => {
    permanentRecordNotice.classList.toggle('hidden', !permanentRecordToggle.checked);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TH-2: _updatePaidFeaturesVisibility(tier)
// Replaces the former _updateTidalVisibility(). Shows/hides all paid-only
// transfer options: tidal window section AND permanent-record toggle row.
// Called from startUpload() once issuedTier is known.
// free / citizen → hidden. sovereign / business / enterprise → visible.
// ─────────────────────────────────────────────────────────────────────────────
function _updatePaidFeaturesVisibility(tier) {
  const isPaid = tier && tier !== 'free' && tier !== 'citizen';
  if (tidalSection) tidalSection.classList.toggle('hidden', !isPaid);
  const permanentRow = $('permanent-record-row');
  if (permanentRow) permanentRow.classList.toggle('hidden', !isPaid);
}

// Read picker values → unix integer seconds, or null if empty.
function _pickerToUnix(input) {
  if (!input || !input.value) return null;
  return Math.floor(new Date(input.value).getTime() / 1000);
}

// Validate tidal invariant: available_from ≤ available_until ≤ expiry_timestamp.
// Returns null on pass, or an error string to show inline.
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

function _showTidalError(msg) {
  if (!tidalError) return;
  tidalError.textContent = msg;
  tidalError.classList.remove('hidden');
}

function _clearTidalError() {
  if (!tidalError) return;
  tidalError.textContent = '';
  tidalError.classList.add('hidden');
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
  // Guard: fflate must be loaded as a blocking script before this module.
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

  // Guard: fflate must be loaded as a blocking script before this module.
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
// Zip [{relativePath, file}] using fflate streaming API (RU1 Part A).
//
// Uses fflate.Zip (streaming encoder) — never fflate.zip() (buffered, OOM).
// One file read into RAM at a time; previous ArrayBuffer released before next.
// ZipPassThrough (STORED, method=0) for already-compressed types — macOS
// Archive Utility compatible. ZipDeflate level 6 for compressible types.
// Progress reports input bytes consumed / total bytes — not file count, because
// ZipPassThrough entries complete near-instantly and distort file-count progress.
//
// RU1a fix: progress bar pushed to 95% + "Finalising archive…" label before
// zipper.end() to prevent the 85%→100% freeze visible during the zip central
// directory write phase.
// ─────────────────────────────────────────────────────────────────────────────
const FOLDER_MEM_WARN_BYTES = 500 * 1024 * 1024; // 500 MB

// Extensions that are already compressed — skip deflate, use STORED (method=0).
// DO NOT use ZipDeflate with { level: 0 } — writes method=8 (DEFLATED) with zero
// passes; macOS Archive Utility rejects this as unsupported. ZipPassThrough only.
const SKIP_COMPRESS_EXTENSIONS = new Set([
  // Video
  'mov', 'mp4', 'mxf', 'r3d', 'braw', 'ari', 'mkv', 'avi', 'wmv', 'webm', 'm4v', 'mpg', 'mpeg',
  // Audio
  'mp3', 'aac', 'm4a', 'ogg', 'flac', 'opus', 'wma',
  // Images (already compressed — PNG and TIFF remain compressible)
  'jpg', 'jpeg', 'heic', 'heif', 'webp', 'avif',
  // Archives
  'zip', 'gz', 'bz2', 'xz', '7z', 'rar',
  // Office/PDF (zipped internally)
  'pdf', 'docx', 'xlsx', 'pptx',
]);

function shouldSkipCompression(relativePath) {
  const ext = relativePath.split('.').pop().toLowerCase();
  return SKIP_COMPRESS_EXTENSIONS.has(ext);
}

async function zipAndSelect(entries, folderName) {
  const zipName    = `${folderName}.zip`;
  const totalFiles = entries.length;

  // Compute total bytes before reading anything into RAM.
  const totalBytes = entries.reduce((acc, e) => acc + (e.file.size || 0), 0);

  showZipStage('Compressing', 0, `0 B / ${formatBytes(totalBytes)}`);

  const zipChunks = [];
  let bytesProcessed = 0;
  let zipError = null;

  const zipBlob = await new Promise((resolve, reject) => {
    // fflate.Zip streaming encoder — output chunks collected into zipChunks[].
    const zipper = new fflate.Zip((err, chunk, final) => {
      if (err) { zipError = err; reject(err); return; }
      zipChunks.push(chunk);
      if (final) {
        resolve(new Blob(zipChunks, { type: 'application/zip' }));
      }
    });

    // Process files sequentially — one arrayBuffer() in flight at a time.
    // Each iteration yields to the event loop via setTimeout(0) so the browser
    // can repaint the progress bar and remain responsive.
    (async () => {
      try {
        for (let i = 0; i < entries.length; i++) {
          if (zipError) break; // encoder already rejected

          const { relativePath, file } = entries[i];
          const buf  = await file.arrayBuffer();
          const data = new Uint8Array(buf);

          let entry;
          if (shouldSkipCompression(relativePath)) {
            // Already-compressed type — STORED (method=0). No CPU wasted.
            entry = new fflate.ZipPassThrough(relativePath);
          } else {
            // Compressible type — DEFLATE level 6.
            entry = new fflate.ZipDeflate(relativePath, { level: 6 });
          }

          // Wire entry output into the parent Zip stream.
          zipper.add(entry);

          // Push the entire file in one call and mark it final (true).
          // fflate handles internal chunking; we maintain max 1 buffer in memory.
          entry.push(data, true);

          // Release the ArrayBuffer reference so GC can reclaim it.
          // eslint-disable-next-line no-unused-expressions
          buf;

          bytesProcessed += file.size;
          const pct = Math.min(Math.round((bytesProcessed / totalBytes) * 95), 95);
          showZipStage('Compressing', pct, `${formatBytes(bytesProcessed)} / ${formatBytes(totalBytes)}`);

          // Yield to the event loop between files — keeps UI responsive and
          // prevents the browser from treating this as a hung script.
          await new Promise(r => setTimeout(r, 0));
        }

        if (!zipError) {
          // Zip central directory write — can take a noticeable moment on large
          // archives. Push bar to 95% + "Finalising" label so the user sees
          // progress rather than an apparently frozen bar at ~85%.
          showZipStage('Finalising archive', 95, 'Writing zip directory…');
          // Signal end of stream — triggers the final=true callback above.
          zipper.end();
        }
      } catch (e) {
        reject(e);
      }
    })();
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
// Upload flow — TH-2 changes:
//   - generateSealNonce() when permanent-record toggle is on (Sovereign+)
//   - Streaming BLAKE3 plaintext root via incremental h.update() per chunk
//   - &sn={hex} embedded in fragment
//   - sealNonceHex added to IDB record
//   - runPermanentRecord() called after final chunk ACK, before showSharePanel()
//   - Non-blocking status line on the progress card for OTS result
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
    setStage('Hashing password', 8);
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

  // ── TH-2 + TG-block: reveal paid-only features now that tier is known ───────
  // Must happen before the invariant check so the user can see (and correct)
  // any picker values if they pre-filled them before the credential was issued.
  _updatePaidFeaturesVisibility(issuedTier);

  setStage('Uploading', 15);
  const expiryTimestamp = Math.floor(Date.now() / 1000) + FREE_EXPIRY;

  // ── TG-block: read destroy + tidal state ───────────────────────────────────
  const destroyAfterDownload = destroyToggle && destroyToggle.checked ? '1' : null;
  const availableFromUnix    = _pickerToUnix(availableFrom);
  const availableUntilUnix   = _pickerToUnix(availableUntil);

  // Invariant check: available_from ≤ available_until ≤ expiry_timestamp.
  // Shown inline — never silently dropped. Aborts upload if violated.
  const tidalErr = _validateTidal(availableFromUnix, availableUntilUnix, expiryTimestamp);
  if (tidalErr) {
    _showTidalError(tidalErr);
    // Restore UI so user can correct and retry.
    uploadBtn.disabled = false;
    optionsCard.classList.remove('hidden');
    progressCard.classList.add('hidden');
    return;
  }

  // ── TH-2: permanent-record state ───────────────────────────────────────────
  // permanentRecordToggle is only revealed for paid tiers, so a Citizen user
  // with the toggle somehow checked would still produce sealNonceHex = null here
  // because the toggle element defaults unchecked and is hidden. Belt-and-braces:
  // guard on both isPaid AND toggle.checked.
  const isPaidTier = issuedTier && issuedTier !== 'free' && issuedTier !== 'citizen';
  const wantsPermanentRecord = isPaidTier && permanentRecordToggle && permanentRecordToggle.checked;
  const sealNonceHex = wantsPermanentRecord ? generateSealNonce() : null;

  // ── TH-2: streaming BLAKE3 plaintext root ──────────────────────────────────
  // Incremental: one plaintext chunk hashed at a time — constant memory regardless
  // of file size. blake3.createHash() is the incremental API (same as blake3Hash()
  // uses internally). Only initialised when permanent record is wanted.
  // After the loop, blake3PlaintextHash.digest('hex') gives the root.
  const blake3PlaintextHash = wantsPermanentRecord ? blake3.createHash() : null;

  // Per-chunk upload with Safari timeout wrapper and 3× retry.
  const CHUNK_RETRY_DELAYS = [2000, 5000, 10000];

  for (let i = 0; i < totalChunks; i++) {
    const raw = await readChunk(chunks[i]);

    // ── TH-2: update plaintext BLAKE3 root before encrypting ─────────────────
    // raw is an ArrayBuffer of plaintext — this is the correct capture point.
    // Update the incremental hasher; do not store raw (released after loop body).
    if (blake3PlaintextHash) {
      blake3PlaintextHash.update(new Uint8Array(raw));
    }

    const aad = new Uint8Array(4);
    new DataView(aad.buffer).setUint32(0, i, false);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: sessionIv, additionalData: aad },
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
      if (p2shHashHex)          headers['X-P2SH-Secret-Hash']         = p2shHashHex;
      // TG-block headers — chunk-0 only, same pattern as X-P2SH-Secret-Hash.
      if (destroyAfterDownload) headers['X-Destroy-After-Download']   = destroyAfterDownload;
      if (availableFromUnix)    headers['X-Available-From']           = String(availableFromUnix);
      if (availableUntilUnix)   headers['X-Available-Until']          = String(availableUntilUnix);
    }

    // Retry loop — handles Safari silent connection drops (timedOut) and
    // transient 5xx errors. Non-retryable errors (4xx) rethrow immediately.
    let lastErr;
    let uploaded = false;
    for (let attempt = 0; attempt <= CHUNK_RETRY_DELAYS.length; attempt++) {
      try {
        const res = await fetchWithTimeout(
          `${WORKER_URL}/upload/${uploadUUID}/${String(i).padStart(4, '0')}`,
          { method: 'PUT', headers, body: encrypted },
          CHUNK_UPLOAD_TIMEOUT_MS
        );
        if (res.status >= 400 && res.status < 500) {
          // 4xx — not retryable.
          const errText = await res.text();
          reportError('upload_chunk', `HTTP ${res.status} chunk ${i}`, `uuid:${uploadUUID.slice(0,8)} chunk:${i} text:${errText.slice(0,100)}`);
          throw new Error(`Chunk ${i} upload failed: ${errText}`);
        }
        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status}`);
        } else {
          uploaded = true;
          break;
        }
      } catch (e) {
        if (!e.timedOut && !(e.message?.startsWith('Chunk'))) {
          lastErr = e;
        } else if (!e.timedOut) {
          throw e; // 4xx rethrow
        } else {
          lastErr = e;
          reportError('chunk_timeout', `chunk ${i} timed out attempt ${attempt}`, `uuid:${uploadUUID.slice(0,8)}`);
        }
      }
      if (!uploaded && attempt < CHUNK_RETRY_DELAYS.length) {
        await new Promise(r => setTimeout(r, CHUNK_RETRY_DELAYS[attempt]));
      }
    }
    if (!uploaded) {
      throw new Error(`Chunk ${i} failed after ${CHUNK_RETRY_DELAYS.length + 1} attempts: ${lastErr?.message}`);
    }

    // 200 ACK — persist chunk completion state to IndexedDB (RU1).
    // RU1a: record includes tier and expiryTimestamp for expiry-awareness on resume.
    // TH-2: sealNonceHex included so resume path can reconstruct fragment correctly.
    // Fire-and-forget: IDB write must never block the upload loop.
    writeChunkState({
      uuid:            uploadUUID,
      chunkIndex:      i,
      totalChunks,
      fileName:        selectedFile.name,
      fileSize:        selectedFile.size,
      keyHex,
      ivHex,
      tier:            'free',
      expiryTimestamp,
      timestamp:       Date.now(),
      sealNonceHex:    sealNonceHex || undefined, // TH-2: absent for Citizen / no PR
    }).catch(() => {}); // already fire-and-forget inside writeChunkState, belt and braces

    setProgress(Math.round(((i + 1) / totalChunks) * 80) + 15, `${i + 1} / ${totalChunks} chunks`);
  }

  // Transfer complete — clear IDB resume record (no longer needed).
  clearResumeState(uploadUUID).catch(() => {});

  // ── TH-2: fire permanent-record pipeline after final chunk ACK ─────────────
  // Fire-and-forget: await the result but do not block the share panel on it.
  // Surface result as a non-blocking status line on the progress card.
  // blake3PlaintextRoot: finalise the incremental hasher here — all chunks read.
  let permanentRecordOk = false;
  if (wantsPermanentRecord && blake3PlaintextHash && sealNonceHex) {
    setStage('Anchoring to Bitcoin', 97);
    const blake3PlaintextRoot = blake3PlaintextHash.digest('hex');
    const prResult = await runPermanentRecord(uploadUUID, blake3PlaintextRoot, sealNonceHex, sessionAesKey);
    permanentRecordOk = prResult.ok;
    if (!prResult.ok) {
      reportError('permanent_record', prResult.error || 'unknown', `uuid:${uploadUUID.slice(0,8)}`);
    }
  }

  // Smooth finish: animate to 100%, hold 600ms, then transition to share panel
  setStage('Finalising', 98);
  await new Promise(r => setTimeout(r, 80));
  setStage('Done', 100);
  // TH-2: show OTS status line alongside "Transfer complete"
  if (wantsPermanentRecord) {
    progressDetail.textContent = permanentRecordOk
      ? 'Transfer complete — date seal submitted ✓'
      : 'Transfer complete — date seal failed (transfer still available)';
  } else {
    progressDetail.textContent = 'Transfer complete';
  }
  await new Promise(r => setTimeout(r, 700));
  progressCard.classList.add('hidden');

  // TH-2: include &sn= in fragment when permanent record was armed.
  // seal_nonce lives in fragment only — never touches Worker or manifest.
  const fragmentStr = sealNonceHex
    ? `uuid=${uploadUUID}&key=${keyHex}&iv=${ivHex}&sn=${sealNonceHex}`
    : `uuid=${uploadUUID}&key=${keyHex}&iv=${ivHex}`;
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
  // Guard: if self-hosted script didn't load, skip QR silently — link is still copyable.
  if (typeof QrCreator !== 'undefined') {
    renderQr(url);
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
// Download mode — TH-2 additions:
//   - Read timestamp_state from /meta response
//   - Read sn= from fragment (seal_nonce)
//   - After file assembly: if timestamp_state is 'pending'|'complete' and sn
//     is present, fetch date-seal.ots.enc from Worker, decrypt with decryptOts(),
//     offer as "date-seal.ots" download button in dlSignoff area.
// ─────────────────────────────────────────────────────────────────────────────
async function enterDownloadMode({ uuid, key, iv, sn }) {
  dropZone.classList.add('hidden');
  infoCard.classList.add('hidden');
  optionsCard.classList.add('hidden');

  await loadDeps();

  const keyBytes = hexToBuf(key);
  const ivBytes  = hexToBuf(iv);
  sessionAesKey  = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  sessionIv      = new Uint8Array(ivBytes);
  history.replaceState(null, '', location.pathname);

  // TH-2: sn (seal_nonce) from fragment — present only on permanent-record transfers.
  // If absent, OTS download is skipped. Fragment-only by design.
  const sealNonceHex = sn || null;

  // ── Fetch metadata from /meta/{uuid} ────────────────────────────────────
  let meta = {};
  try {
    const metaRes = await fetch(`${WORKER_URL}/meta/${uuid}`);
    if (metaRes.ok) meta = await metaRes.json();
    else if (metaRes.status === 404) { showDownloadError('Transfer not found or already expired.'); return; }
  } catch {
    showDownloadError('Network error — could not reach server.');
    return;
  }

  // ── TH-2: capture timestamp_state from /meta (already available here) ────
  const timestampState = meta.timestamp_state || 'none'; // 'none' | 'pending' | 'complete'
  const hasOts = (timestampState === 'pending' || timestampState === 'complete') && !!sealNonceHex;

  // ── Populate receiver card ────────────────────────────────────────────────
  const fileName = meta.file_name || `refueler-${uuid.slice(0, 8)}`;
  rcFileName.textContent = fileName;

  // Folder transfer detection — zip filename signals a client-side zipped folder.
  const isZip = fileName.toLowerCase().endsWith('.zip');
  if (isZip) {
    rcFileIcon.textContent = '📁';
    rcFolderNote.classList.remove('hidden');
  }

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

  // ── TG-block: read receiver-side destroy + tidal fields ──────────────────
  const willSelfDestruct     = !!meta.pending_destruction;
  const availableFromUnixRx  = meta.available_from_timestamp  || null;
  const availableUntilUnixRx = meta.available_until_timestamp || null;

  receiverCard.style.display = 'flex';

  // ── TG-block: tidal window gating ────────────────────────────────────────
  // If available_from is in the future, block download and show countdown.
  const nowSecs = () => Math.floor(Date.now() / 1000);

  if (availableFromUnixRx && nowSecs() < availableFromUnixRx) {
    rcDownloadBtn.disabled = true;
    const countdownEl = document.createElement('p');
    countdownEl.id = 'tidal-countdown';
    countdownEl.className = 'tidal-countdown-display muted mono small';
    rcDownloadBtn.insertAdjacentElement('afterend', countdownEl);

    function _updateCountdown() {
      const secsLeft = Math.max(0, availableFromUnixRx - nowSecs());
      if (secsLeft === 0) {
        rcDownloadBtn.disabled = false;
        countdownEl.remove();
        return;
      }
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

  // If available_until is set, show static "Available until [datetime]" label.
  if (availableUntilUnixRx) {
    const untilEl = document.createElement('p');
    untilEl.id = 'tidal-until-display';
    untilEl.className = 'tidal-until-display muted mono small';
    untilEl.textContent = `Available until ${_formatDatetime(availableUntilUnixRx)}`;
    rcDownloadBtn.insertAdjacentElement('afterend', untilEl);
  }

  // ── USP copy — Variant B locked (A/B test retired, B won) ─────────────────
  uspText.textContent = 'No account. No email. No history. Your data. Not ours.';
  uspBlock.classList.remove('hidden');

  // ── Wire Download button ─────────────────────────────────────────────────
  rcDownloadBtn.addEventListener('click', async () => {
    receiverCard.style.display = 'none';

    // TG-block: pre-download acknowledgement modal if transfer self-destructs.
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
            downloadToken = token;
            unlockInput.value = '';
            unlockScreen.style.display = 'none';
            await startDownloadGated(uuid, meta, willSelfDestruct, hasOts, sealNonceHex);
          } catch {
            unlockError.textContent = 'Network error. Try again.';
            unlockBtn.disabled = false;
          }
        });
        unlockInput.addEventListener('keydown', e => { if (e.key === 'Enter') unlockBtn.click(); });
      } else {
        await startDownloadGated(uuid, meta, willSelfDestruct, hasOts, sealNonceHex);
      }
    };

    if (willSelfDestruct) {
      _showPreDownloadModal(() => {
        _proceed();
      });
    } else {
      await _proceed();
    }
  }, { once: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Download capability gate — routes to FSAA stream or Blob fallback
// TH-2: passes hasOts and sealNonceHex through to both paths.
// ─────────────────────────────────────────────────────────────────────────────
async function startDownloadGated(uuid, meta, willSelfDestruct = false, hasOts = false, sealNonceHex = null) {
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
      await startDownload(uuid, meta, willSelfDestruct, hasOts, sealNonceHex);
      return;
    }
    await startDownloadStream(uuid, meta, fileHandle, willSelfDestruct, hasOts, sealNonceHex);
  } else {
    await startDownload(uuid, meta, willSelfDestruct, hasOts, sealNonceHex);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FSAA streaming download — pipeline depth 2, per-chunk retry (3×, exp backoff)
// TH-2: after file assembly, if hasOts, fetch and offer date-seal.ots.
// ─────────────────────────────────────────────────────────────────────────────
async function startDownloadStream(uuid, meta, fileHandle, willSelfDestruct = false, hasOts = false, sealNonceHex = null) {
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

    // TH-2: fetch and offer date-seal.ots before showing signoff
    if (hasOts) {
      await _offerOtsDownload(uuid, sealNonceHex);
    }

    dlSignoff.classList.remove('hidden');
    try { logReceiverEvent('receiver_ab_downloaded', sessionStorage.getItem('rs-usp-variant') || 'unknown'); } catch {}
    // TG-block: post-download confirm gate
    if (willSelfDestruct) _showConfirmGate(uuid, !!downloadToken);

  } catch (e) {
    reportError('download_chunk_retry_exhausted', e.message || 'unknown', `uuid:${uuid.slice(0,8)}`).catch(() => {});

    try { await writable.abort(); } catch { /* already closed or aborted */ }

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
// Blob fallback download — browsers without FSAA support
// TH-2: same OTS offer logic after file assembly.
// ─────────────────────────────────────────────────────────────────────────────
async function startDownload(uuid, meta, willSelfDestruct = false, hasOts = false, sealNonceHex = null) {
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

  // TH-2: fetch and offer date-seal.ots before showing signoff
  if (hasOts) {
    await _offerOtsDownload(uuid, sealNonceHex);
  }

  dlSignoff.classList.remove('hidden');
  try { logReceiverEvent('receiver_ab_downloaded', sessionStorage.getItem('rs-usp-variant') || 'unknown'); } catch {}
  // TG-block: post-download confirm gate
  if (willSelfDestruct) _showConfirmGate(uuid, !!downloadToken);
}

// ─────────────────────────────────────────────────────────────────────────────
// TH-2: _offerOtsDownload(uuid, sealNonceHex)
// Fetches date-seal.ots.enc from the Worker, decrypts it with the session AES
// key, and injects a download button into the dlSignoff area.
//
// Worker endpoint: GET /timestamp/seal/{uuid}
// Response: raw binary blob = iv(12) ‖ ciphertext (same wire format as submitTimestamp)
// Decryption: decryptOts(blob, sessionAesKey) → Uint8Array (plaintext .ots bytes)
//
// The button triggers a browser download of the plaintext as "date-seal.ots".
// If the fetch or decryption fails, the button is omitted silently — no error
// shown to the recipient (the file download already succeeded; the OTS is bonus).
//
// Note: sessionAesKey must remain extractable=false (importKey with extractable=false)
// for this to work — decryptOts only needs to call subtle.decrypt, not exportKey.
// Confirmed: enterDownloadMode() imports with extractable=false, which is fine.
// ─────────────────────────────────────────────────────────────────────────────
async function _offerOtsDownload(uuid, sealNonceHex) {
  if (!uuid || !sealNonceHex || !sessionAesKey) return;

  let otsBytes;
  try {
    const res = await fetch(`${WORKER_URL}/timestamp/seal/${uuid}`);
    if (!res.ok) {
      reportError('ots_fetch', `HTTP ${res.status}`, `uuid:${uuid.slice(0,8)}`);
      return;
    }
    const raw = await res.arrayBuffer();
    const blob = new Uint8Array(raw);
    otsBytes = await decryptOts(blob, sessionAesKey);
  } catch (e) {
    reportError('ots_decrypt', e.message, `uuid:${uuid.slice(0,8)}`);
    return;
  }

  // Inject download button into dlSignoff area, before the existing signoff content.
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
    a.href = url;
    a.download = 'date-seal.ots';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  otsWrap.appendChild(otsBtn);

  const otsNote = document.createElement('p');
  otsNote.className = 'muted small mt4';
  otsNote.textContent = 'Verify with opentimestamps.org — proves when this file existed, not who sent it.';
  otsWrap.appendChild(otsNote);

  dlSignoff.insertAdjacentElement('beforebegin', otsWrap);
}

// ─────────────────────────────────────────────────────────────────────────────
// TG-block receiver helpers — pre-download modal, post-download confirm gate,
// datetime formatter, tidal countdown display.
// "Traitor" must not appear in any identifier, class, or aria-label.
// ─────────────────────────────────────────────────────────────────────────────

// Format a Unix timestamp as a human-readable local datetime string.
function _formatDatetime(unixSecs) {
  const d = new Date(unixSecs * 1000);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Pre-download acknowledgement modal — shown before download begins when
// pending_destruction is true. Overlays the page; onConfirm called on proceed.
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

  document.getElementById('pre-dl-modal-btn').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  }, { once: true });
}

// Post-download confirm gate — shown after file is saved to disk.
// Prompts recipient to confirm; on confirm calls Worker destruction endpoint.
// isPassphrase: if true, uses DELETE /transfer/{uuid} (bearer auth);
//               if false, uses POST /confirm/{uuid} (no auth).
async function _showConfirmGate(uuid, isPassphrase) {
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
          headers: downloadToken ? { 'Authorization': `Bearer ${downloadToken}` } : {},
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
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      btn.disabled = false;
      const status2 = document.getElementById('dl-confirm-status');
      status2.textContent = 'Could not confirm deletion — the transfer will expire naturally.';
      status2.classList.remove('hidden');
      status2.classList.add('dl-confirm-status--error');
    }
  }, { once: true });
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
