// ── frontend/download-sheets.js — the receiver sheets and progress bar ───────
// Moved out of download.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

import { CHUNK_SIZE } from './config.js';
import { makeSteadyProgress, setProgressWords, setCalmText } from './progress.js';
import { _fmtDateTime } from './download-time.js';

const RX_SHEETS = ['receiver-card', 'unlock-screen', 'download-card', 'rx-done', 'rx-notice'];
export const $ = id => document.getElementById(id);

// Item 14: lines settle 170 ms apart, button last, once per sheet. Must match share.css .rx-arrive.
const RX_STAGGER_MS = 170;
export const RX_SETTLE_MS  = 500;
const _arrived = new Set(['download-card']);   // a measurement, not an arrival

// ─────────────────────────────────────────────────────────────────────────────
// Receiver helpers
// ─────────────────────────────────────────────────────────────────────────────
export function _showSheet(id) {
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

export function _showNotice(eyebrow, head, lede, { send = false } = {}) {
  $('rx-notice-eyebrow').textContent = eyebrow;
  $('rx-notice-head').textContent    = head;
  $('rx-notice-lede').textContent    = lede;
  $('rx-notice-send').hidden         = !send;
  _showSheet('rx-notice');
}

// Item 7: the sender's timed window has closed (before the transfer's own expiry).
export function _showWindowClosed(untilTs) {
  _showNotice('Link closed', 'This file is no longer available.',
    `The sender made it available until ${_fmtDateTime(untilTs)}. Ask them for a new link.`);
}

// Item 8: big mono %, hairline track, "X MB of Y MB".
export function _showProgress(domRefs, stage, totalBytes) {
  domRefs.dlStageTag.textContent = stage;
  _setProgress(domRefs, 0, 0, totalBytes);
  setCalmText($('dl-mb'), 'Connecting…');   // until the first bytes arrive (Share-Progress-1)
  $('dl-drop').hidden = true;
  _showSheet('download-card');
}

export function _setBar(domRefs, pct) {
  const shown = Math.floor(pct);
  domRefs.dlPct.textContent = String(shown);
  domRefs.dlBar.style.width = Math.min(100, pct).toFixed(1) + '%';   // bar finer than the number
  $('dl-track').setAttribute('aria-valuenow', String(shown));
}

function _setProgress(domRefs, pct, doneBytes, totalBytes, tail = '') {
  _setBar(domRefs, pct);
  if (totalBytes > 0) setProgressWords($('dl-mb'), doneBytes, totalBytes, tail);   // only what changed fades
  else setCalmText($('dl-mb'), tail);
}

// Share-Progress-1: the bar counts bytes as they arrive, across every part in
// flight; a failed try takes its bytes back. Shown calmly: makeSteadyProgress
// (progress.js) climbs at the measured speed rather than a part at a time, words
// every 2 s, time left every 5 s and none while waiting to retry. `share` = the
// bar's part for downloading (1, or 0.9 where decrypting comes after). Old links
// without a size (total 0) estimate from the part count and show no byte figures.
export function _makeDlProgress(domRefs, totalBytes, totalChunks, share) {
  const cipherTotal = totalBytes > 0 ? totalBytes + 16 * totalChunks : (CHUNK_SIZE + 16) * totalChunks;
  const drop  = $('dl-drop');
  let got = 0, waiting = 0;
  const steady = makeSteadyProgress(cipherTotal, (b, words) => {
    const f = Math.min(b / cipherTotal, 1);
    if (!words) return _setBar(domRefs, f * share * 100);
    _setProgress(domRefs, f * share * 100, Math.round(f * totalBytes), totalBytes, waiting ? '' : steady.left());
  });
  return {
    stopped: false,   // set when the download has failed: tries still waiting give up
    onBytes(n) { got += n; steady.set(got); },
    onWait(secs) {
      if (!secs) {   // a try starts again
        waiting = Math.max(0, waiting - 1);
        steady.reset();
        if (!waiting) drop.hidden = true;
        return;
      }
      // (not hidden on bytes: on the stream path the next part is already arriving)
      if (drop.hidden) { waiting++; steady.redraw(); }
      drop.textContent = `Connection lost. Trying again in ${secs} s.`;
      drop.hidden = false;
    },
    stop() { steady.stop(); },
  };
}

export function _setUnlockError(input, errEl, msg, invalid) {
  errEl.textContent = msg;
  if (invalid) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

// Share-DAD-2: the Worker deletes a DAD transfer as soon as the last chunk is
// served (Share-B11-1, finishDownload) — not on a recipient confirm. The copy
// says exactly that; there is no confirm step to ask for.
export function _showPreDownloadModal(onConfirm, onCancel) {
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

export function _renderHiddenFileName(rcFileName, fileName, hiddenLabel) {
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
export function _showLinkInactive(_domRefs) {
  _showNotice('Link closed', 'This link is no longer active.',
    'The file was deleted after download, or its time ran out. Ask the sender for a new link.',
    { send: true });
}

// No progress figures on an error (DAD-ERROR-TEXT, Share-B10-3): the notice sheet has none.
export function _showDownloadError(msg, _domRefs) {
  _showNotice('Stopped', 'The download stopped.', msg);
}
