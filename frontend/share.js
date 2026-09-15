// ── share.js — entry point ────────────────────────────────────────────────────
// Refactored at Share-JS-Refactor session (TH-block).
// This file: imports, DOM refs, shared state, mode detection, UI helpers only.
// Crypto → crypto.js  |  Upload → upload.js  |  Download → download.js
// Loaded as <script type="module" src="/share.js"></script> — do not change type.
//
// Fragment grammar v1 (D-1 filename fix, SW-MCP-4):
//   URL format: https://refueler.io/share/?uuid=<uuid>#<base64url-JSON-blob>
//   Fragment blob: base64url( JSON { v:1, k:"<aes-key-b64url>", n:"<filename>", s:"<seal-nonce-b64url>" } )
//   UUID travels in the query string (?uuid=) — not secret, never in the fragment.
//   AES session key travels in the fragment only — never in requests, never in logs.
//
// Legacy fallback: pre-v1 links used #uuid=X&key=Y&iv=Z — handled transparently.
// ─────────────────────────────────────────────────────────────────────────────

import { WORKER_URL }                                   from './crypto.js';
import { parseFragment as parseFragmentV1 }             from './fragment.js';
import { enterUploadMode, checkResumeState }            from './upload.js';
import { enterDownloadMode }                            from './download.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared mutable state — single object passed by reference to upload + download.
// Mutations made inside upload.js and download.js are visible to all holders.
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  selectedFile:   null,
  turnstileToken: null,
  downloadToken:  null,
  sessionAesKey:  null,
  sessionIv:      null,
  uploadUUID:     null,
};

// ─────────────────────────────────────────────────────────────────────────────
// DOM refs — collected once, passed to upload/download as a plain object.
// ─────────────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const domRefs = {
  infoCard:         $('info-card'),
  dropZone:         $('drop-zone'),
  fileInput:        $('file-input'),
  capWarning:       $('cap-warning'),
  optionsCard:      $('options-card'),
  fileNameTag:      $('file-name-tag'),
  fileSizeTag:      $('file-size-tag'),
  passphraseToggle: $('passphrase-toggle'),
  passphraseWrap:   $('passphrase-field-wrap'),
  passphraseInput:  $('passphrase-input'),
  uploadBtn:        $('upload-btn'),
  progressCard:     $('progress-card'),
  stageTag:         $('progress-stage-tag'),
  progressPct:      $('progress-pct'),
  progressBar:      $('progress-bar'),
  progressDetail:   $('progress-detail'),
  shareCard:        $('share-card'),
  shareLinkDisplay: $('share-link-display'),
  copyBtn:          $('copy-btn'),
  newUploadBtn:     $('new-upload-btn'),
  qrWrap:           $('qr-wrap'),
  unlockScreen:     $('unlock-screen'),
  unlockInput:      $('unlock-input'),
  unlockError:      $('unlock-error'),
  unlockBtn:        $('unlock-btn'),
  downloadCard:     $('download-card'),
  dlStageTag:       $('dl-stage-tag'),
  dlPct:            $('dl-pct'),
  dlBar:            $('dl-bar'),
  dlSignoff:        $('dl-signoff'),
  dropMultiMsg:     $('drop-multi-msg'),
  folderInput:      $('folder-input'),
  folderBtn:        $('folder-btn'),
  zipProgressCard:  $('zip-progress-card'),
  zipStageTag:      $('zip-stage-tag'),
  zipPct:           $('zip-pct'),
  zipBar:           $('zip-bar'),
  zipDetail:        $('zip-detail'),
  dlCompatWarn:     $('dl-compat-warn'),
  receiverCard:     $('receiver-card'),
  rcFileIcon:       $('rc-file-icon'),
  rcFileName:       $('rc-file-name'),
  rcFolderNote:     $('rc-folder-note'),
  rcSize:           $('rc-size'),
  rcExpiry:         $('rc-expiry'),
  rcPassphraseRow:  $('rc-passphrase-row'),
  rcDownloadBtn:    $('rc-download-btn'),
  uspBlock:         $('usp-block'),
  uspText:          $('usp-text'),
  resumeCard:       $('resume-card'),
  resumeDetail:     $('resume-detail'),
  resumeDiscardBtn: $('resume-discard-btn'),
  resumeNoticeBtn:  $('resume-notice-btn'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — passed to upload.js and download.js as a helpers bundle.
// Functions defined here use only DOM refs and state from this file.
// ─────────────────────────────────────────────────────────────────────────────
function formatBytes(b) {
  if (b < 1024)       return b + ' B';
  if (b < 1024 ** 2)  return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 ** 3)  return (b / 1024 ** 2).toFixed(1) + ' MB';
  return (b / 1024 ** 3).toFixed(2) + ' GB';
}

function setStage(label, pct) {
  domRefs.stageTag.textContent    = label;
  domRefs.progressPct.textContent = pct + '%';
  domRefs.progressBar.style.width = pct + '%';
}

function setProgress(pct, detail) {
  domRefs.progressPct.textContent    = pct + '%';
  domRefs.progressBar.style.width    = pct + '%';
  domRefs.progressDetail.textContent = detail;
}

function setDropMsg(msg) {
  domRefs.dropMultiMsg.textContent = msg;
  domRefs.dropMultiMsg.classList.remove('hidden');
}

function clearDropMsg() {
  domRefs.dropMultiMsg.classList.add('hidden');
  domRefs.dropMultiMsg.textContent = '';
}

function showZipStage(label, pct, detail) {
  domRefs.zipProgressCard.classList.remove('hidden');
  domRefs.zipStageTag.textContent = label;
  domRefs.zipPct.textContent      = pct + '%';
  domRefs.zipBar.style.width      = pct + '%';
  domRefs.zipDetail.textContent   = detail || '';
}

function hideZipCard() {
  domRefs.zipProgressCard.classList.add('hidden');
  domRefs.zipBar.style.width  = '0%';
  domRefs.zipPct.textContent  = '0%';
  domRefs.zipDetail.textContent = '';
}

// reportError — fire-and-forget, never blocks flow, never surfaces to user (S36b)
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

function showSharePanel(url, isProtected) {
  domRefs.shareCard.classList.remove('hidden');
  domRefs.shareLinkDisplay.textContent = url;
  if (isProtected) {
    const note = document.createElement('p');
    note.className = 'muted small mt8';
    note.textContent = '🔐 Password protected — share the password separately.';
    domRefs.shareLinkDisplay.insertAdjacentElement('afterend', note);
  }
  domRefs.qrWrap.innerHTML = '';
  if (typeof QrCreator !== 'undefined') {
    _renderQr(url);
  }
}

function _renderQr(url) {
  const isDark = document.documentElement.dataset.theme === 'carbon';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  domRefs.qrWrap.appendChild(svg);
  QrCreator.render({
    text: url, radius: 0, ecLevel: 'M',
    fill:       isDark ? '#F7F4EF' : '#3D3A36',
    background: isDark ? '#111316' : '#F7F4EF',
    size: 200,
  }, svg);
}

const COPY_ICON = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:-1px;margin-right:5px" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.2" stroke="currentColor" stroke-width="1.25"/><path d="M3 9H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers bundle — passed to upload.js and download.js
// ─────────────────────────────────────────────────────────────────────────────
const helpers = {
  formatBytes,
  setStage,
  setProgress,
  setDropMsg,
  clearDropMsg,
  showZipStage,
  hideZipCard,
  reportError,
  showSharePanel,
};

// ─────────────────────────────────────────────────────────────────────────────
// Info card dismiss
// ─────────────────────────────────────────────────────────────────────────────
$('dismiss-info').addEventListener('click', () => domRefs.infoCard.classList.add('hidden'));

// ─────────────────────────────────────────────────────────────────────────────
// Copy button (share card)
// ─────────────────────────────────────────────────────────────────────────────
domRefs.copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(domRefs.shareLinkDisplay.textContent).then(() => {
    domRefs.copyBtn.innerHTML = COPY_ICON + 'Copied ✓';
    setTimeout(() => { domRefs.copyBtn.innerHTML = COPY_ICON + 'Copy link'; }, 2000);
  });
});

domRefs.newUploadBtn.addEventListener('click', () => location.reload());

// ─────────────────────────────────────────────────────────────────────────────
// Mode detection — fragment grammar v1 (SW-MCP-4) + legacy fallback
//
// v1 URL:     https://refueler.io/share/?uuid=<uuid>#<base64url-JSON-blob>
// Legacy URL: https://refueler.io/share/#uuid=<uuid>&key=<hex>&iv=<hex>[&sn=<hex>]
//
// Detection order:
//   1. Fragment present + parseable as v1 JSON blob → download mode (v1)
//   2. Fragment contains uuid= and key= (ampersand format) → download mode (legacy)
//   3. Otherwise → upload mode
// ─────────────────────────────────────────────────────────────────────────────
function detectMode() {
  const raw = location.hash.slice(1);
  if (!raw) return null;

  // ── Attempt v1 fragment parse first ──────────────────────────────────────
  try {
    const parsed = parseFragmentV1(raw);
    if (!parsed.legacy) {
      // v1: uuid lives in query string
      const uuid = new URLSearchParams(location.search).get('uuid');
      if (!uuid) return null; // malformed v1 link — no uuid in query
            return { v: 1, uuid, keyBytes: parsed.keyBytes, ivBytes: parsed.ivBytes, filename: parsed.filename, sealNonce: parsed.sealNonce };
    }
  } catch {
    // not a v1 blob — fall through to legacy check
  }

  // ── Legacy: #uuid=X&key=Y&iv=Z[&sn=W] ───────────────────────────────────
  const params = Object.fromEntries(raw.split('&').map(p => {
    const idx = p.indexOf('=');
    return idx === -1 ? [p, ''] : [p.slice(0, idx), p.slice(idx + 1)];
  }));
  if (params.uuid && params.key) {
    return { v: 0, uuid: params.uuid, key: params.key, iv: params.iv || null, sn: params.sn || null };
  }

  return null;
}

const detected = detectMode();

if (detected) {
  enterDownloadMode(detected, domRefs, state, helpers);
} else {
  checkResumeState(domRefs, state, helpers).catch(() => {});
  enterUploadMode(domRefs, state, helpers);
}
