// ── frontend/download-notes.js — the Notes card on the finished screen ───────
// Moved out of download.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

import { RX_SETTLE_MS } from './download-sheets.js';

// Newest Notes article, shown on the finished screen (R-10/R-11). Same site as
// refueler.io/share/. A missing file answers 200 + the homepage, so only a body
// that parses and passes every check below becomes a card.
const NOTES_LATEST_URL = 'https://refueler.io/notes/latest.json';
const NOTES_URL_PREFIX = 'https://refueler.io/notes/';
const NOTES_TIMEOUT_MS = 4000;

// Fetched only now, after the download. No cookies, no referrer, nothing about
// the reader. Any failure (error, HTML, slow, bad fields) = no card, no message.
export async function _showNotesCard(anchor) {
  const ctl   = new AbortController();
  const timer = setTimeout(() => ctl.abort(), NOTES_TIMEOUT_MS);
  try {
    const res = await fetch(NOTES_LATEST_URL, {
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal,
    });
    if (!res.ok) return;
    const d = JSON.parse(await res.text());
    const str = v => typeof v === 'string' && v.trim() !== '';
    if (!d || d.schema !== 'notes-latest.v1') return;
    if (!str(d.title) || !str(d.summary) || !str(d.url)) return;
    if (!d.url.startsWith(NOTES_URL_PREFIX)) return;
    const href = new URL(d.url);
    if (href.origin !== 'https://refueler.io' || !href.pathname.startsWith('/notes/')) return;

    const card = document.createElement('a');
    card.className = 'rx-article rx-settle';   // arrives up to 4 s after the sheet: settles in on its own
    card.href      = href.href;
    card.target    = '_blank';                  // don't navigate away from a download still saving
    card.rel       = 'noopener noreferrer';
    const eyebrow = document.createElement('p');
    eyebrow.className   = 'rx-eyebrow';
    eyebrow.textContent = 'Latest from Refueler Notes';
    const title = document.createElement('h2');
    title.className   = 'rx-article-title';
    title.textContent = d.title;
    const summary = document.createElement('p');
    summary.className   = 'rx-article-summary';
    summary.textContent = d.summary;
    const more = document.createElement('span');
    more.className   = 'rx-article-more';
    more.textContent = 'Read the article →';
    card.append(eyebrow, title, summary, more);
    anchor.insertAdjacentElement('beforebegin', card);
    setTimeout(() => card.classList.remove('rx-settle'), RX_SETTLE_MS + 100);
  } catch {
    // no card
  } finally {
    clearTimeout(timer);
  }
}
