// ── theme-early.js — share.refueler.io (X5-1 · 14 Oct 2026) ───────────────────
// Classic script, sync, in <head> before the stylesheets: sets data-theme before
// first paint so there's no flash. Carbon by default; a saved choice wins.
// localStorage only (never a cookie: the old .refueler.io rs-theme cookie rode
// along to the API host on every credentialed call). Storage can throw (private
// mode, blocked site data) — then the default stands. The toggle is app-header.js.
(function () {
  var t = 'carbon';
  try { if (localStorage.getItem('rs-theme') === 'paper') t = 'paper'; } catch (e) { /* default */ }
  document.documentElement.setAttribute('data-theme', t);
})();
