// ── share-early.js — F-23 (Share-Upload-2) ────────────────────────────────────
// Blocking, in <head>, before share.css. A Share link carries its key in the
// fragment; mark the page so share.css keeps the upload screen hidden until the
// modules decide the mode. Without it a link showed the upload page for ~½ s.
// share.js removes the mark once it knows the mode (a fragment that isn't a
// Share link falls back to the upload page). A file, not inline: CSP-ready.
if (location.hash.length > 1) document.documentElement.classList.add('rx-pending');
