// ── status-banner.js — maintenance / degraded line (X5-1 · 14 Oct 2026) ───────
// The app's copy of the inline block in src/index.njk (CSP: no inline script).
// Design theory §4.7.7 + §7.2: no emoji, no slide-in, "Close" not "Got it".
// The line is simply there when the page arrives; the dialog only for scheduled
// maintenance, only on the upload page (never over a Share link), once a session.
// Deployed flat into /v/<sha>/ beside config.js — hence './config.js'.

import { WORKER_URL } from './config.js';

const BANNER_DISMISS = 'rs-banner-dismissed';
const MODAL_DISMISS  = 'rs-maint-modal-dismissed';

function seen(key) { try { return sessionStorage.getItem(key) !== null; } catch { return false; } }
function remember(key) { try { sessionStorage.setItem(key, '1'); } catch { /* fine */ } }

function maintenanceText(status) {
  const mw = status.maintenance;
  if (mw && mw.scheduled_at) {
    const when = new Date(mw.scheduled_at * 1000).toLocaleString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
    const dur  = mw.duration_minutes ? ` (${mw.duration_minutes} min)` : '';
    const desc = mw.description ? ` — ${mw.description}` : '';
    return `Scheduled maintenance: ${when}${dur}${desc}`;
  }
  return typeof status.message === 'string' ? status.message : 'Maintenance in progress.';
}

function showModal(text) {
  if (seen(MODAL_DISMISS) || location.hash.length > 1 || document.getElementById('app-modal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'app-modal';
  overlay.className = 'app-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'app-modal-head');
  const card = document.createElement('div');
  card.className = 'app-modal-card';
  const h = document.createElement('h2');
  h.id = 'app-modal-head';
  h.textContent = 'Scheduled maintenance';
  const p = document.createElement('p');
  p.textContent = text;                       // Worker text: textContent only, never HTML
  const btn = document.createElement('button');
  btn.className = 'rx-btn';
  btn.type = 'button';
  btn.textContent = 'Close';
  card.append(h, p, btn);
  overlay.append(card);
  document.body.append(overlay);
  btn.focus();
  const close = () => { remember(MODAL_DISMISS); overlay.remove(); };
  btn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

async function loadStatus() {
  const banner = document.getElementById('app-status');
  if (!banner || seen(BANNER_DISMISS)) return;
  let status;
  try {
    const res = await fetch(`${WORKER_URL}/status`, { cache: 'no-store' });
    if (!res.ok) return;
    status = await res.json();
  } catch { return; }

  const state = status && status.state;
  let text;
  if (state === 'maintenance') {
    text = maintenanceText(status);
    showModal(text);
  } else if (state === 'degraded') {
    text = typeof status.message === 'string' ? status.message : 'Some services are degraded — we are investigating.';
  } else {
    return;
  }
  document.getElementById('app-status-text').textContent = text;
  document.getElementById('app-status-close').addEventListener('click', () => {
    banner.hidden = true;
    remember(BANNER_DISMISS);
  });
  banner.hidden = false;
}

loadStatus();
