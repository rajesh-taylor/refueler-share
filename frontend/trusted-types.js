// ─────────────────────────────────────────────────────────────────────────────
// trusted-types.js — the app's one Trusted Types policy, "share-dom" (H8 Trusted-Types-1 · 7 Nov 2026).
//
// The app CSP has `require-trusted-types-for 'script'; trusted-types share-dom`: no string
// becomes HTML or script without this policy. The app builds HTML with DOM calls
// (createElement, textContent, replaceChildren), so the policy has no createHTML and no
// createScript: those sinks throw in every engine that enforces Trusted Types.
//
// Why a policy at all: two vendored classic scripts load late, on first use (X5-1b, page
// weight) — qr-creator.min.js when an upload starts (share.js) and fflate.min.js on the first
// folder (zip.js). Setting a <script>'s src is a TrustedScriptURL sink. They are UMD globals,
// not modules, so import() can't replace the <script>.
//
// The rule: a script URL is allowed only if it is one of those two files, in this release's own
// folder (/v/<sha>/ on share.refueler.io), same origin, with no query or fragment. Anything else
// throws. Browsers without Trusted Types get the same check and a plain string.
//
// bin/check-dom-sinks.mjs (ship-app.sh + CI) refuses a DOM sink in any other release file.
// ─────────────────────────────────────────────────────────────────────────────

const LATE_SCRIPTS = new Set(['qr-creator.min.js', 'fflate.min.js']);
const BASE = new URL('./', import.meta.url);

function checkScriptURL(input) {
  const u = new URL(String(input), BASE);
  const name = u.pathname.startsWith(BASE.pathname) ? u.pathname.slice(BASE.pathname.length) : '';
  if (u.origin !== BASE.origin || u.search || u.hash || !LATE_SCRIPTS.has(name)) {
    throw new TypeError('share-dom: script URL refused');
  }
  return u.href;
}

const policy = globalThis.trustedTypes?.createPolicy
  ? globalThis.trustedTypes.createPolicy('share-dom', { createScriptURL: checkScriptURL })
  : null;

// lateScriptURL('fflate.min.js') → a TrustedScriptURL (or checked string) for script.src.
export function lateScriptURL(name) {
  return policy ? policy.createScriptURL(name) : checkScriptURL(name);
}
