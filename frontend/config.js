// ── frontend/config.js — shared config ───────────────────────────────────────
// Moved out of crypto.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// Worker URL, part size, free cap and expiry, upload timeout. Imports nothing.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Config — single source of truth, consumed by upload.js and download.js
// ─────────────────────────────────────────────────────────────────────────────
export const WORKER_URL  = 'https://api.share.refueler.io';
export const CHUNK_SIZE  = 32 * 1024 * 1024;        // 32 MiB — Share-6-2 spec §2
export const FREE_CAP    = 4 * 1024 * 1024 * 1024;  // 4 GB
export const CITIZEN_CAP = 100 * 1024 * 1024 * 1024; // 100 GiB — Worker TIER_CAPS.citizen (B12-4a-2)
export const FREE_EXPIRY = 7 * 24 * 60 * 60;        // 7 days in seconds

// Tier expiry seconds — mirrors the Worker's EXPIRY_WINDOWS (Stripe-Account-1).
// Used by resume flow to determine whether a saved transfer is still within window.
export const TIER_EXPIRY_SECONDS = {
  free:    7  * 24 * 60 * 60,
  citizen: 90 * 24 * 60 * 60,
};

// Safari fetch timeout — Safari silently hangs on network drops.
export const CHUNK_UPLOAD_TIMEOUT_MS = 60_000; // 60 s per chunk
