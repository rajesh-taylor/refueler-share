// ── frontend/gate-client.js — the app's side of the security-check gate ──────
// Turnstile-Gate-1 (6 Nov 2026) · refueler-share-private docs/Turnstile-Gate-plan-v1.md §4.
// Cloudflare's Turnstile no longer runs in Share's page: it runs in a small page on its own
// origin (GATE_ORIGIN), which this module frames. The gate has no network access of its own
// and hands back one thing, a token string, by postMessage. Shared by the upload page
// (upload-turnstile.js) and sign-in (signin.js). DOM calls only, no HTML strings (H8-ready).
//
// Messages, all { t: 'refueler-gate', v: 1, op, id, … } with exact key sets:
//   gate → app  ready {id: null} · asking · token {token} · expired · error {code: load|failed}
//   app → gate  init {purpose, theme} · reset · theme {theme}
// Received only if: origin === GATE_ORIGIN, source === this iframe's window, exact keys,
// t/v match, and id is the current request id (ready: null, once). Anything else is dropped
// silently. Sent only to GATE_ORIGIN, never '*'. Every init, reset and theme carries a fresh
// 16-byte id, so a slow answer from before it is dropped. The id is a correlation id, not a
// secret. The gate picks the sitekey and action from the purpose; the app never sends them.
//
// The iframe: fixed src, no query string, sandboxed (the spike passed under it in Chromium,
// WebKit and real Safari, plan §11). Its colour-scheme is set to normal in share.css: with
// the page in Carbon, a scheme mismatch makes browsers paint the frame opaque (plan §11).
// ─────────────────────────────────────────────────────────────────────────────

import { GATE_ORIGIN } from './config.js';

const T = 'refueler-gate';
const V = 1;
const GATE_SRC = GATE_ORIGIN + '/';
const SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';
// Cloudflare's limits: a token is at most 2,048 characters (plan F-7).
const TOKEN_RE = /^[A-Za-z0-9._-]{1,2048}$/;
const CODES = new Set(['load', 'failed']);
const KEYS = {
  ready:   ['id', 'op', 't', 'v'],
  asking:  ['id', 'op', 't', 'v'],
  expired: ['id', 'op', 't', 'v'],
  token:   ['id', 'op', 't', 'token', 'v'],
  error:   ['code', 'id', 'op', 't', 'v'],
};

export function newRequestId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Exactly the keys a message of this op has, nothing more (a plain object, not an array).
export function gateMessageOk(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  if (m.t !== T || m.v !== V || typeof m.op !== 'string' || !Object.hasOwn(KEYS, m.op)) return false;
  const keys = Object.keys(m).sort();
  const want = KEYS[m.op];
  if (keys.length !== want.length || keys.some((k, i) => k !== want[i])) return false;
  if (m.op === 'ready') return m.id === null;
  if (typeof m.id !== 'string') return false;
  if (m.op === 'token') return typeof m.token === 'string' && TOKEN_RE.test(m.token);
  if (m.op === 'error') return CODES.has(m.code);
  return true;
}

export const pageTheme = () => document.documentElement.getAttribute('data-theme') === 'carbon' ? 'dark' : 'light';

/**
 * openGate({ container, purpose, on }) → { reset(), theme(t), remove(), ready }
 * Inserts the gate iframe into container. on: { ready, asking, token(t), expired, error(code) }.
 * Follows the page's Carbon/Paper switch itself (the gate keeps a held token and redraws
 * after it is spent or expires, as before).
 */
export function openGate({ container, purpose, on = {} }) {
  const frame = document.createElement('iframe');
  frame.id = 'cf-gate';
  frame.className = 'cf-gate';
  frame.src = GATE_SRC;
  frame.title = 'Cloudflare security check';
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('loading', 'eager');
  frame.setAttribute('sandbox', SANDBOX);

  let id = null;
  let ready = false;
  let alive = true;
  let shownTheme = pageTheme();
  const post = (msg) => { try { frame.contentWindow?.postMessage({ t: T, v: V, ...msg }, GATE_ORIGIN); } catch { /* gone */ } };

  function onMessage(e) {
    if (!alive || e.origin !== GATE_ORIGIN || e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!gateMessageOk(m)) return;
    if (m.op === 'ready') {
      if (ready) return;
      ready = true;
      id = newRequestId();
      shownTheme = pageTheme();
      post({ op: 'init', id, purpose, theme: shownTheme });
      on.ready?.();
      return;
    }
    if (m.id !== id) return;
    if (m.op === 'asking') on.asking?.();
    else if (m.op === 'token') on.token?.(m.token);
    else if (m.op === 'expired') on.expired?.();
    else if (m.op === 'error') on.error?.(m.code);
  }

  const themeWatch = new MutationObserver(() => {
    const t = pageTheme();
    if (!ready || t === shownTheme) return;
    shownTheme = t;
    id = newRequestId();
    post({ op: 'theme', id, theme: t });
  });

  window.addEventListener('message', onMessage);
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  container.appendChild(frame);

  return {
    get ready() { return ready; },
    reset() {
      if (!ready) return;
      id = newRequestId();
      post({ op: 'reset', id });
    },
    remove() {
      alive = false;
      window.removeEventListener('message', onMessage);
      themeWatch.disconnect();
      frame.remove();
    },
  };
}
