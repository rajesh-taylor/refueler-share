// ── frontend/upload-turnstile.js — the Cloudflare check ──────────────────────
// Moved out of upload.js at Share-JS-Split-2 (9 Oct 2026). Turnstile-Gate-1 (6 Nov 2026):
// Cloudflare's script no longer runs in this page. The check runs in the gate page
// (gate.share.refueler.io), framed through gate-client.js; this file keeps the button
// behaviour exactly as it was. Same exports.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Turnstile (U-10): invisible unless Cloudflare needs a click; then the
// #turnstile-wrap line and the gate frame show above the button. The gate is inserted once,
// at the first pick (X5-1b: nothing from Cloudflare or the gate loads on arrival; a slow
// check runs while the sender sets the options), and kept across "Choose another" (U-11);
// Cloudflare refreshes an expired token itself. A token is single-use: startUpload spends
// it at /credential/issue, then resets the check so a retry gets a fresh one.
// The button never waits on the check: pressed early it reads "Checking…" and the upload
// starts when the token lands; past CHECK_WAIT_MS the line shows, so the wait has a reason.
// If Cloudflare's box appears, the queued press is dropped: a tick never starts an upload,
// the sender presses the button after it (Rajesh, 7 Oct).
// Failures (plan §4.5): the gate's own error:load (Cloudflare's script didn't arrive in 12 s)
// → CHECK_BLOCKED at once, reported turnstile_load. The gate page itself not answering 15 s
// after a press → CHECK_BLOCKED, reported gate_load. The next press removes the frame and
// inserts a fresh one.
// ─────────────────────────────────────────────────────────────────────────────
import { openGate } from './gate-client.js';

export const UPLOAD_LABEL = 'Encrypt and upload';
// Share-Copy-2, reworded at Turnstile-Gate-1 (G-4 option A, approved by Rajesh 6 Nov): the
// check never arrived. Shown only to a sender who pressed the button; the next press tries again.
export const CHECK_BLOCKED = 'The security check couldn’t load. A content blocker or VPN may be stopping it; allow challenges.cloudflare.com and gate.share.refueler.io, or try once without it.';
const CHECK_FAILED = 'The security check didn’t go through. Try again.';
const CHECK_WAIT_MS  = 2000;
const GATE_WAIT_MS   = 15000;

let gate              = null;   // the open gate (gate-client.js), or null
let gateBroken        = false;  // the gate or Cloudflare's script didn't load: next press starts afresh
let turnstileFailed   = false;  // Cloudflare's check failed (error:failed): next press resets
let turnstileAsking   = false;  // Cloudflare's box is showing (wants a click)
let startWhenChecked  = null;   // queued start while the button reads "Checking…"
let checkWaitTimer    = null;
let gateWaitTimer     = null;

const wrapEl = () => document.getElementById('turnstile-wrap');

function _dropGate() {
  gate?.remove();
  gate = null;
  gateBroken = false;
  turnstileFailed = false;
  turnstileAsking = false;
}

function _blocked(state, domRefs, helpers, kind) {
  clearTimeout(gateWaitTimer);
  helpers.reportError(kind, 'timeout', '');
  state.turnstileToken = null;
  gateBroken = true;
  turnstileAsking = false;
  if (startWhenChecked) {
    _cancelQueuedStart(state, domRefs);
    helpers.setDropMsg(CHECK_BLOCKED);
  }
  wrapEl()?.classList.add('hidden');
}

export function renderTurnstile(state, domRefs, helpers) {
  if (gate) return;
  const container = document.getElementById('cf-turnstile');
  if (!container) return;
  gate = openGate({
    container,
    purpose: 'upload',
    on: {
      asking() {
        turnstileAsking = true;
        wrapEl()?.classList.remove('hidden');
        _cancelQueuedStart(state, domRefs);
        domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
      },
      token(token) {
        clearTimeout(gateWaitTimer);
        state.turnstileToken = token;
        turnstileFailed = false;
        turnstileAsking = false;
        clearTimeout(checkWaitTimer);
        wrapEl()?.classList.add('hidden');
        domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
        if (startWhenChecked) {
          const go = startWhenChecked;
          startWhenChecked = null;
          go();
        }
      },
      expired() { state.turnstileToken = null; },
      error(code) {
        clearTimeout(gateWaitTimer);
        if (code === 'load') { _blocked(state, domRefs, helpers, 'turnstile_load'); return; }
        state.turnstileToken = null;
        turnstileFailed = true;
        turnstileAsking = false;
        domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
        if (startWhenChecked) {
          _cancelQueuedStart(state, domRefs);
          helpers.setDropMsg(CHECK_FAILED);
          _resetTurnstile();
        }
      },
    },
  });
}

function _resetTurnstile() {
  turnstileFailed = false;
  gate?.reset();
}

// Called right after /credential/issue, whatever its outcome: that token is gone.
export function _spendTurnstileToken(state, domRefs, helpers) {
  state.turnstileToken = null;
  _resetTurnstile();
}

export function _cancelQueuedStart(state, domRefs) {
  if (!startWhenChecked) return;
  startWhenChecked = null;
  clearTimeout(checkWaitTimer);
  clearTimeout(gateWaitTimer);
  if (!turnstileAsking) wrapEl()?.classList.add('hidden');
  domRefs.uploadBtn.textContent = UPLOAD_LABEL;
  domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
}

// Greyed only for a reason the sender can see (no file, empty password, Cloudflare's
// box waiting for its tick) or while "Checking…".
export function _uploadBtnDisabled(state, domRefs) {
  const needsPassphrase = domRefs.passphraseToggle.checked && domRefs.passphraseInput.value.trim().length === 0;
  return !state.selectedFile || needsPassphrase || !!startWhenChecked || (turnstileAsking && !state.turnstileToken);
}

// The upload button's press, pressed before the check has passed (U-10): "Checking…",
// start when the token lands.
export function pressWhenChecked(go, state, domRefs, helpers) {
  const { uploadBtn } = domRefs;
  if (state.turnstileToken) { go(); return; }
  startWhenChecked = go;
  uploadBtn.textContent = 'Checking…';
  uploadBtn.disabled = true;
  if (gateBroken) _dropGate();               // the next press loads it afresh
  else if (turnstileFailed) _resetTurnstile();
  renderTurnstile(state, domRefs, helpers);
  clearTimeout(checkWaitTimer);
  checkWaitTimer = setTimeout(() => {
    if (startWhenChecked) wrapEl()?.classList.remove('hidden');
  }, CHECK_WAIT_MS);
  // The gate page itself never answered (blocked host, DNS filter): say so. Once it has
  // answered, Cloudflare's own errors arrive through it (error:load / error:failed).
  clearTimeout(gateWaitTimer);
  const pressed = gate;
  gateWaitTimer = setTimeout(() => {
    if (startWhenChecked && gate === pressed && gate && !gate.ready) _blocked(state, domRefs, helpers, 'gate_load');
  }, GATE_WAIT_MS);
}

// U-11: a passed check is kept for the next file. Inserted at the first pick; restart only after a failure.
export function keepTurnstile(state, domRefs, helpers) {
  if (gateBroken) _dropGate();
  if (!gate) renderTurnstile(state, domRefs, helpers);
  else if (turnstileFailed && !state.turnstileToken) _resetTurnstile();
}
