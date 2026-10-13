// ── frontend/upload-account.js — "Uploading as Citizen" (B12-4a-2) ───────────
// Upload mode only (enterUploadMode never runs on a receiver link). One GET
// /chambers/session when the upload page opens; the session cookie is HttpOnly,
// so asking is the only way to know. Nothing shows unless that answer is a
// signed-in, paid Citizen — then the ledger gets an Account row:
//   "Uploading as Citizen · Send without my account"
// Default is the account (Rajesh, 13 Oct 2026). "Send without my account"
// makes this page's uploads Pro Bono: initiate goes out with no cookie and no
// X-CSRF, exactly as for someone who never signed in.
//
// The cookie travels on ONE call only — /initiate — and only while the account
// is chosen (credentials: 'include' there; every other call keeps the default,
// which never sends a cross-origin cookie). The CSRF token lives in this
// module's memory only, never in storage.
// ─────────────────────────────────────────────────────────────────────────────

import { WORKER_URL, FREE_CAP, CITIZEN_CAP } from './config.js';

const account = { csrf: null, use: false, onChange: () => {} };   // csrf set only for a paid Citizen

/** Ask once whether this browser is signed in as a paid Citizen. Silent on any failure. */
export async function loadAccount(domRefs, onChange) {
  let s = null;
  try {
    const r = await fetch(`${WORKER_URL}/chambers/session`, { credentials: 'include', cache: 'no-store' });
    if (r.ok) s = await r.json();
  } catch { /* offline, blocked, or no auth host: Pro Bono, say nothing */ }
  if (!s || s.kind !== 'citizen' || s.tier !== 'max' || typeof s.csrf !== 'string') return;
  account.csrf = s.csrf;
  account.use  = true;
  account.onChange = onChange;
  const { upAccountRow, upAccountText, upAccountBtn } = domRefs;
  if (!upAccountRow) return;
  const draw = () => {
    upAccountText.textContent = account.use ? 'Uploading as Citizen' : 'Sending without your account';
    upAccountBtn.textContent  = account.use ? 'Send without my account' : 'Use my account';
    // Calm (Rajesh, 13 Oct): the Pro Bono facts line ("No account or email
    // needed · Free up to 4 GB") is for people without an account — hidden
    // while uploading on it, back the moment they choose to send without.
    domRefs.uploadSheet.dataset.account = account.use ? 'citizen' : '';
  };
  upAccountBtn.addEventListener('click', () => { account.use = !account.use; draw(); onChange(); });
  draw();
  upAccountRow.hidden = false;
  onChange();
}

/** Signed out underneath us (initiate 401/403): forget the account, hide the row. */
export function dropAccount(domRefs) {
  account.csrf = null;
  account.use  = false;
  if (domRefs.upAccountRow) domRefs.upAccountRow.hidden = true;
  domRefs.uploadSheet.dataset.account = '';
  account.onChange();   // re-checks the chosen file against the Pro Bono cap
}

/** The size cap the Worker will apply to this upload. */
export function uploadCap() {
  return account.use ? CITIZEN_CAP : FREE_CAP;
}

/** True while uploads go out on the Citizen account. */
export function usingAccount() {
  return account.use && account.csrf !== null;
}

/** fetch options for /initiate: the cookie + X-CSRF only when the account is chosen. */
export function initiateOptions(headers) {
  if (!usingAccount()) return { method: 'POST', headers };
  return { method: 'POST', headers: { ...headers, 'X-CSRF': account.csrf }, credentials: 'include' };
}
