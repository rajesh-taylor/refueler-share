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

import { WORKER_URL, FREE_EXPIRY }                      from './crypto.js';
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
  uploadSheet:      $('upload-sheet'),
  upEyebrow:        $('up-eyebrow'),
  upHead:           $('up-head'),
  upFileLabel:      $('up-file-label'),
  upFileNote:       $('up-file-note'),
  upHint:           $('up-hint'),
  upUntil:          $('up-until'),
  upUntilNote:      $('up-until-note'),
  upStoppedText:    $('up-stopped-text'),
  upRestartBtn:     $('up-restart-btn'),
  upRetryBtn:       $('up-retry-btn'),
  chooseAnotherBtn: $('choose-another-btn'),
  overAnotherBtn:   $('over-another-btn'),
  fileBtn:          $('file-btn'),
  dropZone:         $('drop-zone'),
  fileInput:        $('file-input'),
  capWarning:       $('cap-warning'),
  optionsCard:      $('options-card'),
  fileNameTag:      $('file-name-tag'),
  fileSizeTag:      $('file-size-tag'),
  passphraseToggle: $('passphrase-toggle'),
  passphraseWrap:   $('passphrase-field-wrap'),
  passphraseInput:  $('passphrase-input'),
  destroyToggle:    $('destroy-after-download'),
  destroyNotice:    $('destroy-notice'),
  paidOptions:      $('paid-options'),
  uploadBtn:        $('upload-btn'),
  progressCard:     $('progress-card'),
  progressPct:      $('progress-pct'),
  progressTrack:    $('progress-track'),
  progressBar:      $('progress-bar'),
  progressDetail:   $('progress-detail'),
  shareCard:        $('share-card'),
  shareLinkDisplay: $('share-link-display'),
  shareLedger:      $('share-ledger'),
  copyBtn:          $('copy-btn'),
  qrBtn:            $('qr-btn'),
  newUploadBtn:     $('new-upload-btn'),
  qrWrap:           $('qr-wrap'),
  qrCanvas:         $('qr-canvas'),
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
  resumeFile:       $('resume-file'),
  resumeUploaded:   $('resume-uploaded'),
  resumeTitle:      $('resume-title'),
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

// ── Sender sheet (Share-Upload-2) ─────────────────────────────────────────────
// One sheet, one view at a time; share.css shows the parts for data-view.
// Eyebrow + headline per view (build list §1); callers may override either.
const PAGE_TITLE = document.title;
const VIEWS = {
  empty:     ['New transfer',  'Send a file.'],
  zipping:   ['Preparing',     'Zipping your folder.'],
  chosen:    ['Ready to send', 'Send a file.'],
  over:      ['Too large',     'This file is over 4 GB.'],
  uploading: ['Preparing',     'Uploading.'],
  ready:     ['Link ready',    'Your link is ready.'],
  stopped:   ['Stopped',       'The upload stopped.'],
};

function setView(view, { eyebrow, head } = {}) {
  const [e, h] = VIEWS[view];
  const changed = domRefs.uploadSheet.dataset.view !== view;
  domRefs.uploadSheet.dataset.view = view;
  domRefs.upEyebrow.textContent = eyebrow || e;
  domRefs.upHead.textContent    = head || h;
  if (view !== 'uploading') document.title = PAGE_TITLE;
  if (changed) revealSheet();
}

// F-27: a view change keeps the scroll position, so the eyebrow and headline could sit
// under the pinned header (phone after "Encrypt and upload"; desktop "link ready").
// Bring the sheet top into view below the header (and status banner); leave it if on screen.
function revealSheet() {
  const bars = [document.querySelector('.site-header'), document.getElementById('status-banner')]
    .filter(el => el && el.getClientRects().length);
  const covered = Math.max(0, ...bars.map(el => el.getBoundingClientRect().bottom));
  const top = domRefs.uploadSheet.getBoundingClientRect().top;
  if (top >= covered && top < window.innerHeight - 120) return;
  const instant = document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: window.scrollY + top - covered - 16, behavior: instant ? 'auto' : 'smooth' });
}

// "Stopped" with a plain sentence (F-11). With retry, "Try again" carries on in this tab;
// without it only "Start over" (a reload) shows. One press per stop.
function showStopped(text, retry) {
  domRefs.upStoppedText.textContent = text;
  domRefs.upRetryBtn.hidden = !retry;
  domRefs.upRetryBtn.onclick = retry ? () => { domRefs.upRetryBtn.onclick = null; retry(); } : null;
  setView('stopped');
}

// Stage word in the eyebrow: Preparing · Encrypting and uploading · Finishing.
function setStage(label) {
  domRefs.upEyebrow.textContent = label;
}

// Bytes-based: setup steps don't move the bar (C4). The tab title shows the %, never the file name.
function setProgress(pct, detail) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  domRefs.progressPct.textContent = String(p);
  domRefs.progressBar.style.width = p + '%';
  domRefs.progressTrack.setAttribute('aria-valuenow', String(p));
  if (detail !== undefined) domRefs.progressDetail.textContent = detail;
  document.title = `${p}% · Refueler Share`;
}

function setDropMsg(msg) {
  domRefs.dropMultiMsg.textContent = msg;
  domRefs.dropMultiMsg.classList.remove('hidden');
}

function clearDropMsg() {
  domRefs.dropMultiMsg.classList.add('hidden');
  domRefs.dropMultiMsg.textContent = '';
}

function showZipStage(_label, pct, detail) {
  domRefs.zipPct.textContent    = pct + '%';
  domRefs.zipBar.style.width    = pct + '%';
  domRefs.zipDetail.textContent = detail || '';
}

function hideZipCard() {
  domRefs.zipBar.style.width    = '0%';
  domRefs.zipPct.textContent    = '';
  domRefs.zipDetail.textContent = '';
}

// R-5: exact local date + time ("Tue 13 Oct, 17:42").
function formatWhen(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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

// Link ready: link first, then the details (U-9 QR on request).
// info = { fileName, isFolder, sizeBytes, expiryTimestamp, isProtected, destroyAfterDownload };
// anything unknown (a resumed upload doesn't record the password or delete setting) is left out.
function showSharePanel(url, info = {}) {
  domRefs.shareLinkDisplay.textContent = url;
  const rows = [];
  const row = (label, value, note) => {
    const div = document.createElement('div'); div.className = 'rx-row';
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value;
    if (note) { const sm = document.createElement('small'); sm.textContent = note; dd.appendChild(sm); }
    div.append(dt, dd); rows.push(div);
  };
  if (info.fileName) row(info.isFolder ? 'Folder' : 'File', info.fileName);
  if (info.sizeBytes) row('Size', formatBytes(info.sizeBytes));
  if (info.expiryTimestamp) {
    const days = Math.round((info.expiryTimestamp * 1000 - Date.now()) / 86400000);
    row('Available until', formatWhen(new Date(info.expiryTimestamp * 1000)), days > 1 ? `in ${days} days` : '');
  }
  if (info.isProtected) row('Password', 'Needed to download', 'Send it separately from the link.');
  if (info.destroyAfterDownload) row('After download', 'The link works once');
  domRefs.shareLedger.replaceChildren(...rows);
  domRefs.qrWrap.hidden = true;
  domRefs.qrBtn.textContent = 'Show QR code';
  domRefs.qrBtn.setAttribute('aria-expanded', 'false');
  domRefs.qrBtn.hidden = typeof QrCreator === 'undefined';
  setView('ready');
}

// U-9 / F-16 / F-19: dark modules on a light tile in both themes, drawn sharp —
// whole CSS pixels per module, canvas at CSS × devicePixelRatio. QrCreator only
// draws into a <canvas> (given an <svg> it drew nothing: F-19).
function _renderQr(url) {
  const opts = { text: url, radius: 0, ecLevel: 'M', quiet: 0 };
  // Module count: draw once, measure the top-left finder (7 modules wide), snap to 17 + 4v.
  const probe = document.createElement('canvas');
  QrCreator.render({ ...opts, fill: '#000', background: '#fff', size: 1000 }, probe);
  const line = probe.getContext('2d').getImageData(0, 2, 1000, 1).data;
  let run = 0;
  while (run < 1000 && line[run * 4] < 128) run++;
  const count = 17 + 4 * Math.round((1000 * 7 / run - 17) / 4);
  const units = count + 8;                                    // 4-module light margin each side
  const target = window.matchMedia('(max-width: 480px)').matches ? 220 : 260;
  const mod = Math.max(2, Math.floor(target / units));
  const side = units * mod;
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const cv = domRefs.qrCanvas;
  cv.style.width = cv.style.height = side + 'px';
  QrCreator.render({ ...opts, quiet: 4, fill: '#1A1917', background: '#F5F0E8', size: side * dpr }, cv);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers bundle — passed to upload.js and download.js
// ─────────────────────────────────────────────────────────────────────────────
const helpers = {
  formatBytes,
  formatWhen,
  setView,
  showStopped,
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
// Link ready: copy, QR, send another
// ─────────────────────────────────────────────────────────────────────────────
domRefs.copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(domRefs.shareLinkDisplay.textContent).then(() => {
    domRefs.copyBtn.textContent = 'Copied';
    setTimeout(() => { domRefs.copyBtn.textContent = 'Copy link'; }, 2000);
  });
});

domRefs.qrBtn.addEventListener('click', () => {
  const open = domRefs.qrWrap.hidden;
  if (open) _renderQr(domRefs.shareLinkDisplay.textContent);
  domRefs.qrWrap.hidden = !open;
  domRefs.qrBtn.textContent = open ? 'Hide QR code' : 'Show QR code';
  domRefs.qrBtn.setAttribute('aria-expanded', String(open));
});

domRefs.newUploadBtn.addEventListener('click', () => location.reload());
domRefs.upRestartBtn.addEventListener('click', () => location.reload());

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
            return { v: 1, uuid, keyBytes: parsed.keyBytes, ivBytes: parsed.ivBytes, filename: parsed.filename, sealNonce: parsed.sealNonce, sizeBytes: parsed.sizeBytes };
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
  enterDownloadMode(detected, domRefs, state, helpers);   // sets .rx-mode before its first await
} else {
  checkResumeState(domRefs, state, helpers).catch(() => {});
  enterUploadMode(domRefs, state, helpers);
}
// F-23: the mode is known; share-early.js's mark has done its job.
document.documentElement.classList.remove('rx-pending');
