// dev/dl-spike/parts.js — Share-DL-Spike (10 Oct 2026). Scratch, never shipped.
//
// One part of a link-v2 transfer: GET (verified Worker path, no Range) → exact
// ciphertext length → decryptPart (the browser's own frontend/crypto.js: derived
// part key, counter nonce + last flag) → exact plaintext length. Shared by sw.js
// (service-worker download) and index.html (Chrome FSAA). Holds no key: callers
// pass the CryptoKey.

import { decryptPart } from './crypto.js';
import { WORKER_URL, CHUNK_SIZE } from './config.js';

export const TAG = 16;
export const BACKOFFS = [2000, 5000, 15000, 30000, 60000];   // spec §2.1: 6 attempts
export const STALL_MS = 120_000;                              // no bytes for 120 s → retry
export const partCount = z => Math.ceil(z / CHUNK_SIZE);
export const plainLen  = (z, i) => (i === partCount(z) - 1 ? z - i * CHUNK_SIZE : CHUNK_SIZE);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Fatal extends Error {}

export function newStats() {
  return { retries: 0, shortBodies: 0, stalls: 0, lastRetry: null, integrity: {} };
}

async function fetchPart(job, i, stats) {
  const want = plainLen(job.z, i) + TAG;
  const url  = `${WORKER_URL}/download/${job.uuid}/${String(i).padStart(4, '0')}`;
  let lastErr;
  for (let a = 0; a <= BACKOFFS.length; a++) {
    if (job.cancelled) throw new Fatal('cancelled');
    const ctl = new AbortController();
    let timer = setTimeout(() => ctl.abort(), STALL_MS);
    const poke = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), STALL_MS); };
    try {
      const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if ([400, 401, 404, 410, 416, 425].includes(res.status)) throw new Fatal(`part ${i}: HTTP ${res.status}`);
      if (res.status === 409) throw new Fatal(`part ${i}: 409 integrity`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const integ = res.headers.get('X-Integrity') || 'none';
      const buf = new Uint8Array(want);
      let off = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        poke();
        if (off + value.byteLength > want) throw new Fatal(`part ${i}: body longer than ${want}`);
        buf.set(value, off);
        off += value.byteLength;
      }
      if (off !== want) { stats.shortBodies++; throw new Error(`short body ${off}/${want}`); }
      stats.integrity[integ] = (stats.integrity[integ] || 0) + 1;
      return buf;
    } catch (e) {
      if (e instanceof Fatal) throw e;
      if (e.name === 'AbortError') { stats.stalls++; lastErr = new Error(`stalled ${STALL_MS / 1000}s`); }
      else lastErr = e;
      stats.retries++;
      stats.lastRetry = `part ${i}: ${lastErr.message}`;
      if (a < BACKOFFS.length) await sleep(BACKOFFS[a]);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Fatal(`part ${i}: gave up after ${BACKOFFS.length + 1} attempts (${lastErr?.message})`);
}

// Parts in index order, inFlight fetched ahead. read(i) must be called for
// i = 0, 1, 2, … in turn. Returns the plaintext as a Uint8Array.
export function partReader(job, partKey, stats, inFlight = 2) {
  const pending = new Map();
  let next = 0;
  const fill = () => {
    while (next < job.n && pending.size < inFlight) {
      const i = next++;
      const p = fetchPart(job, i, stats);
      p.catch(() => {});   // surfaced when read(i) awaits it
      pending.set(i, p);
    }
  };
  return async function read(i) {
    fill();
    const ct = await pending.get(i);
    pending.delete(i);
    fill();
    let plain;
    try { plain = await decryptPart(partKey, ct, i, job.n); }
    catch { throw new Fatal(`part ${i}: decrypt failed (wrong key or corrupted)`); }
    if (plain.byteLength !== plainLen(job.z, i)) throw new Fatal(`part ${i}: plaintext ${plain.byteLength} B`);
    return new Uint8Array(plain);
  };
}
