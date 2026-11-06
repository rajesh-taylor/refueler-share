// ── src/gate/gate.js — the gate page: Cloudflare Turnstile in its own origin ──
// Turnstile-Gate-1 (6 Nov 2026) · refueler-share-private docs/Turnstile-Gate-plan-v1.md §3–§4.
// Served at https://gate.share.refueler.io/ (Pages project refueler-share-gate, shipped by
// bin/ship-app.sh in the same release as the app). Share's page frames this one; Cloudflare's
// api.js runs here, never in Share's page, so it can't read the app's memory or storage.
// This page has no network access of its own (CSP connect-src 'none'), stores nothing, and
// hands back one thing: a token string, by postMessage, to an exactly named parent origin.
//
// Messages, all { t: 'refueler-gate', v: 1, op, id, … } with exact key sets:
//   app → gate  init {purpose, theme} · reset · theme {theme}
//   gate → app  ready {id: null} · asking · token {token} · expired · error {code: load|failed}
// Received only from window.parent, from an origin in PARENTS, with an exact shape. The first
// good init fixes the parent origin for the frame's life. Sent only to that origin (ready: to
// each origin in PARENTS, so it reaches only the one that framed us), never '*'.
// The sitekey and action are chosen here from the purpose, never passed by the parent.
// Top-level visit: loads nothing, shows one line. No imports, nothing inline.
// ─────────────────────────────────────────────────────────────────────────────

const T = 'refueler-gate';
const V = 1;
const APP_SITEKEY = '0x4AAAAAAD0N7GlHlCRuWITr';
// Parent origin → purpose → { sitekey, action }. A purpose not on its origin's row is ignored.
// Gate-2 adds refueler.io → checkout (Plans widget).
const PARENTS = {
  'https://share.refueler.io': {
    upload: { sitekey: APP_SITEKEY, action: 'upload' },
    signin: { sitekey: APP_SITEKEY, action: 'signin' },
  },
};
const API_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const LOAD_MS = 12000;
const THEMES = new Set(['light', 'dark']);
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const TOKEN_RE = /^[A-Za-z0-9._-]{1,2048}$/;
const KEYS = {
  init:  ['id', 'op', 'purpose', 't', 'theme', 'v'],
  reset: ['id', 'op', 't', 'v'],
  theme: ['id', 'op', 't', 'theme', 'v'],
};

let parentOrigin = null;
let job = null;          // { sitekey, action } for this frame's life
let id = null;           // the parent's current request id
let theme = 'light';
let widget = null;       // Turnstile widget id
let held = false;        // a token was handed over and not yet reset or expired
let stale = false;       // theme changed while a token was held: redraw after it's spent

function shapeOk(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  if (m.t !== T || m.v !== V || typeof m.op !== 'string' || !Object.hasOwn(KEYS, m.op)) return false;
  const keys = Object.keys(m).sort();
  const want = KEYS[m.op];
  if (keys.length !== want.length || keys.some((k, i) => k !== want[i])) return false;
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return false;
  if ('theme' in m && !THEMES.has(m.theme)) return false;
  return true;
}

function send(msg) {
  window.parent.postMessage({ t: T, v: V, id, ...msg }, parentOrigin);
}

function render() {
  widget = window.turnstile.render(document.getElementById('gate-widget'), {
    sitekey: job.sitekey,
    action: job.action,
    theme,
    appearance: 'interaction-only',
    size: 'flexible',
    'refresh-expired': 'auto',
    'before-interactive-callback': () => send({ op: 'asking' }),
    callback: (token) => {
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) { send({ op: 'error', code: 'failed' }); return; }
      held = true;
      send({ op: 'token', token });
    },
    'error-callback': () => { held = false; send({ op: 'error', code: 'failed' }); return true; },
    'expired-callback': () => {
      held = false;
      send({ op: 'expired' });
      if (stale) setTimeout(redraw, 0);
    },
  });
}

function redraw() {
  stale = false;
  held = false;
  if (widget !== null) { try { window.turnstile.remove(widget); } catch { /* already gone */ } }
  widget = null;
  render();
}

function load() {
  const s = document.createElement('script');
  s.src = API_SRC;
  s.async = true;
  let done = false;
  const fail = () => { if (done) return; done = true; send({ op: 'error', code: 'load' }); };
  const timer = setTimeout(fail, LOAD_MS);
  s.onerror = () => { clearTimeout(timer); fail(); };
  s.onload = () => {
    clearTimeout(timer);
    if (done) return;
    if (!window.turnstile) { fail(); return; }
    done = true;
    render();
  };
  document.head.appendChild(s);
}

function onMessage(e) {
  if (e.source !== window.parent) return;
  if (parentOrigin ? e.origin !== parentOrigin : !Object.hasOwn(PARENTS, e.origin)) return;
  const m = e.data;
  if (!shapeOk(m)) return;
  if (m.op === 'init') {
    if (job) return;                                   // one init per frame
    const row = PARENTS[e.origin];
    if (typeof m.purpose !== 'string' || !Object.hasOwn(row, m.purpose)) return;
    parentOrigin = e.origin;
    job = row[m.purpose];
    id = m.id;
    theme = m.theme;
    load();
    return;
  }
  if (!job) return;
  id = m.id;
  if (m.op === 'reset') {
    held = false;
    if (widget === null) return;
    if (stale) redraw();
    else { try { window.turnstile.reset(widget); } catch { redraw(); } }
  } else if (m.op === 'theme') {
    if (m.theme === theme) return;
    theme = m.theme;
    if (widget === null) return;                       // not drawn yet: drawn in the new theme
    if (held) stale = true;                            // keep the held token; redraw after it
    else redraw();
  }
}

if (window.parent === window) {
  document.getElementById('gate-top').hidden = false;  // top-level visit: no Turnstile here
} else {
  window.addEventListener('message', onMessage);
  for (const origin of Object.keys(PARENTS)) {
    window.parent.postMessage({ t: T, v: V, op: 'ready', id: null }, origin);
  }
}
