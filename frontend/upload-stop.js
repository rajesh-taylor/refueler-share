// ── frontend/upload-stop.js — how an upload stops, and what it says ──────────
// Moved out of upload.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

import { loadDeps } from './crypto.js';
import { CHUNK_SIZE } from './config.js';

// ─────────────────────────────────────────────────────────────────────────────
// F-11 (Share-Upload-4): every way an upload can stop lands on "Stopped" with a
// plain sentence (build list §1), and "Try again" carries on in the same tab with
// the file the page still holds — no picker. Before /initiate nothing was sent, so
// Try again starts afresh (new check, new upload pass); after it, the transfer
// carries on from the last part that arrived. After a refresh the resume card asks
// for the file as before.
//
// Kinds: network · check · refused · missing (finalise 409: parts absent or the wrong
// size) · unfinished (all sent, finalise failed) · gone (session spent or expired —
// can't carry on) · changed (resume: the chosen file's sent parts differ from the
// record) · browser (anything unexpected in this tab).
// ─────────────────────────────────────────────────────────────────────────────
export class UploadStop extends Error {
  constructor(kind, message, extra = {}) {
    super(message || kind);
    this.kind = kind;
    Object.assign(this, extra);
  }
}

// Share-Progress-1: the resume screen is one box; the page headline says what happened.
export const RESUME_HEAD = { eyebrow: 'Interrupted', head: 'An upload didn’t finish.' };
export const NO_RESUME = 'This upload can’t be resumed. Start over to send the file again.';
export const NOT_SAME_FILE = 'That file doesn’t match the unfinished upload. Discard it and start again.';
// Share-Folder-Resume-1: folder wording says "folder" and names it.
export const FOLDER_ASK = 'Choose the same folder to continue. This page only sees what you choose.';
export const NOT_SAME_FOLDER = 'That folder doesn’t match the unfinished upload. Start over to send it again.';
export const FOLDER_DIFFERENT = (f) => `That’s a different folder. Choose “${f.name}” (${f.files.toLocaleString()} files) to continue.`;
export const FOLDER_CHANGED   = (f) => `“${f.name}” has changed since the upload stopped: files were added, removed or edited. It can’t continue. Discard and send the folder again.`;
export const FOLDER_TIME_ZONE = (f) => `This device’s time zone has changed since the upload stopped, so “${f.name}” can’t continue. Set the time zone back, or discard and start again.`;

// The §1 sentence for a stop. job is null when nothing was sent yet.
export function _stopText(e, job) {
  const sent = job ? Math.min(job.sent * CHUNK_SIZE, job.file.size) : 0;
  const pct  = job ? Math.round(sent / job.file.size * 100) : 0;
  switch (e.kind) {
    case 'network': {
      const reached = e.tried ? 'Refueler couldn’t be reached after several tries.' : 'Refueler couldn’t be reached.';
      return `${reached} Nothing was shared. ${pct > 0 ? `Try again continues from ${pct}%.` : 'Try again.'}`;
    }
    case 'check':      return 'The security check didn’t go through. Try again.';
    case 'refused':    return 'Refueler refused the upload. Try again; if it keeps happening, check the Status page.';
    case 'missing':    return 'The upload didn’t finish. Some parts didn’t arrive. Try again.';
    case 'unfinished': return 'The upload didn’t finish. Everything was sent; Try again finishes it.';
    default:           return 'Something went wrong in this browser. Try again; if it keeps happening, check the Status page.';
  }
}

// Share-Deps-1 (E): if BLAKE3/secp256k1 can't load even with the pure-JS fallback,
// say so instead of freezing on the progress bar. Runs before anything is sent.
// Every other stop goes through _stopped (F-11, Share-Upload-4).
export async function _loadDepsOrSay(domRefs, helpers) {
  try {
    await loadDeps();
    return true;
  } catch (e) {
    helpers.reportError('load_deps', e?.name || 'Error', String(e?.message || '').slice(0, 120));
    helpers.showStopped('Share couldn’t start in this browser. Reload to try again, or use another browser.');
    return false;
  }
}
