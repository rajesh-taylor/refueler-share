// ── frontend/upload-turnstile.js — the Cloudflare check ──────────────────────
// Moved out of upload.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Turnstile (U-10): invisible unless Cloudflare needs a click; then the
// #turnstile-wrap line and widget show above the button. Drawn once, when the upload
// page opens (Share-Upload-5: a slow check runs while the sender picks a file), and
// kept across "Choose another" (U-11); Cloudflare refreshes an
// expired token itself. A token is single-use: startUpload spends it at
// /credential/issue, then resets the widget so a retry gets a fresh check.
// The button never waits on the check: pressed early it reads "Checking…" and
// the upload starts when the token lands; past CHECK_WAIT_MS the line shows, so
// the wait has a reason. If Cloudflare's box appears, the queued press is dropped:
// a tick never starts an upload, the sender presses the button after it (Rajesh, 7 Oct).
// ─────────────────────────────────────────────────────────────────────────────
export const UPLOAD_LABEL = 'Encrypt and upload';
let turnstileWidgetId = null;
let turnstilePolling  = false;
let turnstileFailed   = false;
let startWhenChecked  = null;   // queued start while the button reads "Checking…"
let turnstileTheme    = null;   // 'light' | 'dark', as drawn
let turnstileStale    = false;  // page theme changed while a token was held
let themeWatch        = null;
let turnstileAsking   = false;  // Cloudflare's box is showing (wants a click)
let checkWaitTimer    = null;
const CHECK_WAIT_MS   = 2000;

export function renderTurnstile(state, domRefs, helpers) {
  const container = document.getElementById('cf-turnstile');
  if (!container) return;
  if (!window.turnstile) {
    if (!turnstilePolling) {
      turnstilePolling = true;
      const deadline = Date.now() + 15000;
      const poll = setInterval(() => {
        if (window.turnstile) {
          clearInterval(poll);
          turnstilePolling = false;
          renderTurnstile(state, domRefs, helpers);
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          turnstilePolling = false;
          helpers.reportError('turnstile_load', 'Turnstile script did not load within 15s', navigator.userAgent.slice(0, 100));
        }
      }, 200);
    }
    return;
  }
  if (turnstileWidgetId !== null) return;
  const wrap = document.getElementById('turnstile-wrap');
  container.innerHTML = '';
  if (!themeWatch) {
    // Cloudflare offers light or dark only, fixed when drawn: follow a Carbon/Paper switch.
    themeWatch = new MutationObserver(() => _followTheme(state, domRefs, helpers));
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  turnstileTheme = _pageTheme();
  turnstileWidgetId = window.turnstile.render(container, {
    sitekey: '0x4AAAAAAD0N7GlHlCRuWITr',
    theme: turnstileTheme,
    appearance: 'interaction-only',
    size: 'flexible', // full width like the button; Cloudflare fixes the height at 65 px
    'before-interactive-callback': function() {
      turnstileAsking = true;
      if (wrap) wrap.classList.remove('hidden');
      _cancelQueuedStart(state, domRefs);
      domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
    },
    callback: function(token) {
      state.turnstileToken = token;
      turnstileFailed = false;
      turnstileAsking = false;
      clearTimeout(checkWaitTimer);
      if (wrap) wrap.classList.add('hidden');
      domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
      if (startWhenChecked) {
        const go = startWhenChecked;
        startWhenChecked = null;
        go();
      }
    },
    'error-callback': function() {
      state.turnstileToken = null;
      turnstileFailed = true;
      turnstileAsking = false;
      domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
      if (startWhenChecked) {
        _cancelQueuedStart(state, domRefs);
        helpers.setDropMsg('The security check didn’t go through. Try again.');
        _resetTurnstile();
      }
      return true;
    },
    'expired-callback': function() {
      state.turnstileToken = null;
      if (turnstileStale) setTimeout(() => _redrawTurnstile(state, domRefs, helpers), 0);
    },
  });
}

function _resetTurnstile() {
  turnstileFailed = false;
  if (turnstileWidgetId !== null && window.turnstile) {
    try { window.turnstile.reset(turnstileWidgetId); } catch (e) {}
  }
}

const _pageTheme = () => document.documentElement.dataset.theme === 'carbon' ? 'dark' : 'light';

// Theme switched: redraw the widget in the new colours. A token already held is
// kept (redrawing would throw it away); the redraw then waits for the next reset.
function _followTheme(state, domRefs, helpers) {
  if (turnstileWidgetId === null || _pageTheme() === turnstileTheme) return;
  if (state.turnstileToken) { turnstileStale = true; return; }
  _redrawTurnstile(state, domRefs, helpers);
}

function _redrawTurnstile(state, domRefs, helpers) {
  turnstileStale = false;
  try { window.turnstile.remove(turnstileWidgetId); } catch (e) {}
  turnstileWidgetId = null;
  turnstileFailed = false;
  turnstileAsking = false;
  document.getElementById('turnstile-wrap')?.classList.add('hidden');
  renderTurnstile(state, domRefs, helpers);
}

// Called right after /credential/issue, whatever its outcome: that token is gone.
export function _spendTurnstileToken(state, domRefs, helpers) {
  state.turnstileToken = null;
  if (turnstileStale) _redrawTurnstile(state, domRefs, helpers);
  else _resetTurnstile();
}

export function _cancelQueuedStart(state, domRefs) {
  if (!startWhenChecked) return;
  startWhenChecked = null;
  clearTimeout(checkWaitTimer);
  if (!turnstileAsking) document.getElementById('turnstile-wrap')?.classList.add('hidden');
  domRefs.uploadBtn.textContent = UPLOAD_LABEL;
  domRefs.uploadBtn.disabled = _uploadBtnDisabled(state, domRefs);
}

// Greyed only for a reason the sender can see (no file, empty password, Cloudflare's
// box waiting for its tick) or while "Checking…".
export function _uploadBtnDisabled(state, domRefs) {
  const needsPassphrase = domRefs.passphraseToggle.checked && domRefs.passphraseInput.value.trim().length === 0;
  return !state.selectedFile || needsPassphrase || !!startWhenChecked || (turnstileAsking && !state.turnstileToken);
}

// Glue 2 (Share-JS-Split-2): the two places outside this file that read the widget's
// state. Same lines as before, moved here so the state stays private.

// The upload button's press, pressed before the check has passed (U-10): "Checking…",
// start when the token lands. Was the body of enterUploadMode's pressUpload.
export function pressWhenChecked(go, state, domRefs, helpers) {
  const { uploadBtn } = domRefs;
  if (state.turnstileToken) { go(); return; }
  startWhenChecked = go;
  uploadBtn.textContent = 'Checking…';
  uploadBtn.disabled = true;
  if (turnstileFailed) _resetTurnstile();
  renderTurnstile(state, domRefs, helpers);
  clearTimeout(checkWaitTimer);
  checkWaitTimer = setTimeout(() => {
    if (startWhenChecked) document.getElementById('turnstile-wrap')?.classList.remove('hidden');
  }, CHECK_WAIT_MS);
}

// U-11: a passed check is kept for the next file. Drawn at page open; restart only after a failure.
export function keepTurnstile(state, domRefs, helpers) {
  if (turnstileWidgetId === null) renderTurnstile(state, domRefs, helpers);
  else if (turnstileFailed && !state.turnstileToken) _resetTurnstile();
}
