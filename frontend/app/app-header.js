// ── app-header.js — the standalone header (X5-1a · 14 Oct 2026) ───────────────
// refueler.io-style row (Rajesh, 14 Oct): CARBON / PAPER pill, menu drawer, account slot.
// No inline handlers (CSP): everything wired here.
//   Theme: the pill reads "Carbon / Paper" (current first), as on refueler.io; the choice
//   is kept in localStorage (theme-early.js applies it before first paint). No cookie.
//   Menu: the hamburger opens the drawer (≤ 960 px); a click outside or Escape closes it.
//   Account: who this browser is — "Citizen" or "Sign in" — from the single
//   /chambers/session answer upload-account.js already asks for (event 'rfs:account');
//   this file never calls the auth host. Upload page only: the receiver and the sign-in
//   page show no account slot (a recipient never needs one).

const root   = document.documentElement;
const header = document.getElementById('site-header');
const pills  = [document.getElementById('app-theme'), document.getElementById('app-theme-drawer')].filter(Boolean);

function drawPills() {
  const label = root.getAttribute('data-theme') === 'paper' ? 'Paper / Carbon' : 'Carbon / Paper';
  for (const p of pills) p.textContent = label;
}
for (const p of pills) {
  p.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'paper' ? 'carbon' : 'paper';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('rs-theme', next); } catch { /* not kept; fine */ }
    drawPills();
  });
}
drawPills();

const burger = document.getElementById('nav-hamburger');
function setMenu(open) {
  if (!header || !burger) return;
  header.classList.toggle('nav-open', open);
  burger.setAttribute('aria-expanded', String(open));
}
if (burger && header) {
  burger.addEventListener('click', (e) => { e.stopPropagation(); setMenu(!header.classList.contains('nav-open')); });
  document.addEventListener('click', (e) => { if (header.classList.contains('nav-open') && !header.contains(e.target)) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && header.classList.contains('nav-open')) { setMenu(false); burger.focus(); } });
}

// Two copies of the slot: the header's, and the menu's (shown instead on phones ≤ 360 px).
const accts = [document.getElementById('app-account'), document.getElementById('app-account-drawer')].filter(Boolean);
if (accts.length) {
  document.addEventListener('rfs:account', (e) => {
    // Receiver mode is decided by share.js; never show the slot there.
    if (root.classList.contains('rx-mode') || root.classList.contains('rx-pending')) return;
    const citizen = e.detail && e.detail.who === 'citizen';
    for (const a of accts) {
      a.textContent = citizen ? 'Citizen' : 'Sign in';
      a.classList.toggle('active-account', citizen);
      a.hidden = false;
    }
  });
}
