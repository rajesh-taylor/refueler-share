// ── share-early.js — F-23 (Share-Upload-2) ────────────────────────────────────
// Blocking, in <head>, before share.css. A Share link carries its key in the
// fragment; mark the page so share.css keeps the upload screen hidden until the
// modules decide the mode. Without it a link showed the upload page for ~½ s.
// share.js removes the mark once it knows the mode (a fragment that isn't a
// Share link falls back to the upload page). A file, not inline: CSP-ready.
if (location.hash.length > 1) document.documentElement.classList.add('rx-pending');

// Safari-Slow-Link-1: start the work the page will wait on, before the modules load.
// Receiver: ask /meta now; download.js takes the answer from window.__rfsMeta. The
// UUID is the query string's (not secret; /meta gets it anyway); the fragment and
// its key are never read here. Same host as crypto.js WORKER_URL.
// Upload page: fetch the upload modules alongside the ones index.njk preloads.
(function () {
  var q = /[?&]uuid=([0-9a-fA-F-]{36})(?:&|$)/.exec(location.search);
  if (location.hash.length > 1 && q && window.fetch) {
    window.__rfsMeta = {
      uuid: q[1],
      res:  fetch('https://api.share.refueler.io/meta/' + q[1]).catch(function () { return null; }),
    };
  }
  if (location.hash.length <= 1 && document.currentScript) {
    ['upload.js', 'timestamp.js', 'merkle.js'].forEach(function (f) {
      var l = document.createElement('link');
      l.rel = 'modulepreload';
      l.href = new URL(f, document.currentScript.src).href;
      document.head.appendChild(l);
    });
  }
})();
