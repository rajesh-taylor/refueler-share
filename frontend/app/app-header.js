// ── app-header.js — the standalone header (X5-1 · 14 Oct 2026) ────────────────
// Design theory §10–§11. Theme toggle + account slot. No inline handlers (CSP).
//   Theme: the button names the theme it switches to; choice kept in localStorage.
//   Account: who this browser is — "Citizen" or "Sign in" — from the single
//   /chambers/session answer upload-account.js already asks for (event
//   'rfs:account'); this file never calls the auth host. Upload page only: the
//   receiver and the sign-in page show no account slot (a recipient never needs one).

const root = document.documentElement;

function themeLabel() {
  return root.getAttribute('data-theme') === 'paper' ? 'Carbon' : 'Paper';
}

const themeBtn = document.getElementById('app-theme');
if (themeBtn) {
  themeBtn.textContent = themeLabel();
  themeBtn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'paper' ? 'carbon' : 'paper';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('rs-theme', next); } catch { /* not kept; fine */ }
    themeBtn.textContent = themeLabel();
  });
}

const acct = document.getElementById('app-account');
if (acct) {
  document.addEventListener('rfs:account', (e) => {
    // Receiver mode is decided by share.js; never show the slot there.
    if (root.classList.contains('rx-mode') || root.classList.contains('rx-pending')) return;
    acct.textContent = e.detail && e.detail.who === 'citizen' ? 'Citizen' : 'Sign in';
    acct.hidden = false;
  });
}
