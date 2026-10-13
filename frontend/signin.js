// ── frontend/signin.js — the sign-in page (B12-4a-2 · 13 Oct 2026) ───────────
// Design: docs/B12-SR-spec-v1.md S6.2 / S6.3 / S6.6. Served at
// refueler.io/share/signin/ (= Worker AUTH_SIGNIN_URL), from src/signin.njk.
//
//   no fragment, signed out  → email + Cloudflare check → "Check your email"
//                              (same words whatever the address)
//   #t=<token>               → ONE button, "Sign in" (was "Enter Chambers" in
//                              SR S6.3 — Rajesh, 13 Oct: no jargon on a button;
//                              the one-click rule is what's locked). Only the click
//                              POSTs {token} to /auth/verify; then the fragment
//                              is stripped from the address bar and history.
//                              Link scanners that fetch the URL never see the
//                              token (fragments aren't sent) and don't click.
//   signed in                → sign out · sign out everywhere
//
// The CSRF token is held in this module's memory only. Every auth call is
// credentialed; the cookie is HttpOnly and never touched here. Cloudflare's
// script is loaded only when the email form shows — never on the link page.
// ─────────────────────────────────────────────────────────────────────────────

import { WORKER_URL } from './config.js';

const SITEKEY = '0x4AAAAAAD0N7GlHlCRuWITr';
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const $ = (id) => document.getElementById(id);

const sheet = $('signin-sheet');
const els = {
  form: $('si-form'), email: $('si-email'), send: $('si-send'), check: $('si-check'),
  enter: $('si-enter'), signout: $('si-signout'), everywhere: $('si-everywhere'),
  again: $('si-again'), msg: $('si-msg'), until: $('si-until'),
};
let csrf = null;
let token = null;
let turnstileId = null;
let turnstileToken = null;

function show(state, msg = '') {
  sheet.dataset.state = state;
  els.msg.textContent = msg;
  els.msg.hidden = !msg;
}

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = { method, credentials: 'include', cache: 'no-store', headers: { ...headers } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(`${WORKER_URL}${path}`, opts);
}

// ── Signed in ────────────────────────────────────────────────────────────────
function signedIn(s) {
  csrf = s.csrf;
  const until = Number(s.absolute_expires_at);
  els.until.textContent = Number.isFinite(until) && until > 0
    ? new Date(until * 1000).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';
  show('in');
}

async function signOut(everywhere) {
  els.signout.disabled = els.everywhere.disabled = true;
  try {
    const r = await call(everywhere ? '/auth/signout-everywhere' : '/auth/signout',
      { method: 'POST', body: {}, headers: { 'X-CSRF': csrf ?? '' } });
    if (r.ok || r.status === 401) {
      csrf = null;
      show('out', everywhere ? 'Every browser and device you signed in on is signed out.' : '');
    } else {
      show('in', 'That didn’t go through. Try again.');
    }
  } catch {
    show('in', 'Refueler couldn’t be reached. Try again.');
  } finally {
    els.signout.disabled = els.everywhere.disabled = false;
  }
}

// ── The link: one button ────────────────────────────────────────────────────
function stripFragment() {
  history.replaceState(null, '', location.pathname + location.search);
}

async function enter() {
  els.enter.disabled = true;
  let r;
  try {
    r = await call('/auth/verify', { method: 'POST', body: { token } });
  } catch {
    els.enter.disabled = false;
    show('link', 'Refueler couldn’t be reached. Try again.');
    return;
  }
  token = null;
  stripFragment();          // after the one POST, whatever the answer: the token is spent or dead
  if (r.ok) { signedIn(await r.json()); return; }
  show('expired');
}

// ── The email form ──────────────────────────────────────────────────────────
function loadTurnstile() {
  if (window.turnstile) { drawTurnstile(); return; }
  if (!document.querySelector(`script[src="${TURNSTILE_SRC}"]`)) {
    const s = document.createElement('script');
    s.src = TURNSTILE_SRC;
    s.async = true;
    document.head.appendChild(s);
  }
  const deadline = Date.now() + 15000;
  const poll = setInterval(() => {
    if (window.turnstile) { clearInterval(poll); drawTurnstile(); }
    else if (Date.now() > deadline) { clearInterval(poll); show('ask', 'Cloudflare’s check didn’t load. Reload to try again.'); }
  }, 200);
}

function drawTurnstile() {
  if (turnstileId !== null) return;
  turnstileId = window.turnstile.render(els.check, {
    sitekey: SITEKEY,
    theme: document.documentElement.getAttribute('data-theme') === 'carbon' ? 'dark' : 'light',
    appearance: 'interaction-only',
    callback: (t) => { turnstileToken = t; els.send.disabled = false; },
    'expired-callback': () => { turnstileToken = null; els.send.disabled = true; },
    'error-callback': () => { turnstileToken = null; els.send.disabled = true; },
  });
}

function askForEmail(msg = '') {
  show('ask', msg);
  els.send.disabled = !turnstileToken;
  loadTurnstile();
  els.email.focus();
}

async function sendLink(e) {
  e.preventDefault();
  const email = els.email.value.trim();
  if (!email || !turnstileToken) return;
  els.send.disabled = true;
  const t = turnstileToken;
  turnstileToken = null;
  if (turnstileId !== null) window.turnstile.reset(turnstileId);   // single use
  let r;
  try {
    r = await call('/auth/magic', { method: 'POST', body: { email, turnstile_token: t } });
  } catch {
    askForEmail('Refueler couldn’t be reached. Try again.');
    return;
  }
  if (r.status === 202) { els.email.value = ''; show('sent'); return; }
  if (r.status === 429) { askForEmail('Too many tries. Wait a few minutes, then try again.'); return; }
  if (r.status === 400) { askForEmail('That doesn’t look like an email address.'); return; }
  askForEmail('That didn’t go through. Try again.');
}

// ── Start ───────────────────────────────────────────────────────────────────
async function start() {
  els.form.addEventListener('submit', sendLink);
  els.enter.addEventListener('click', enter);
  els.signout.addEventListener('click', () => signOut(false));
  els.everywhere.addEventListener('click', () => signOut(true));
  els.again.addEventListener('click', () => askForEmail());
  $('si-out-again').addEventListener('click', () => askForEmail());

  const m = /^#t=([A-Za-z0-9_-]{43})$/.exec(location.hash);
  if (m) { token = m[1]; show('link'); return; }   // nothing sent until the click
  if (location.hash) stripFragment();               // a malformed fragment: drop it

  try {
    const r = await call('/chambers/session');
    if (r.ok) { signedIn(await r.json()); return; }
  } catch { /* fall through to the form */ }
  askForEmail();
}

start();
