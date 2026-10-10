// dev/dl-spike/sw.js — Share-DL-Spike (10 Oct 2026). Scratch, never shipped.
//
// Service-worker streaming download (spec §2.2, research notes §A). Scope /assets/dl/.
// The page posts one job { id, uuid, keyBytes, name, z, n } over a MessageChannel;
// the key stays in this worker's memory for that one download and is zeroed once the
// part key is derived. Nothing is persisted. A hidden iframe then navigates to
// /assets/dl/<id>; this worker fetches and decrypts the parts itself and streams the
// plaintext to the browser's download manager with Content-Length = z.
// serve.mjs also builds a classic-script copy (sw-classic.js) for browsers without
// module service workers.

import { derivePartKey } from './crypto.js';
import { partReader, newStats } from './parts.js';

const SW_KIND = 'module';
const jobs = new Map();   // id → job, one-shot
const pause = ms => new Promise(r => setTimeout(r, ms));

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('message', e => {
  const m = e.data || {};
  const port = e.ports[0];
  if (m.type === 'ping') { port?.postMessage({ type: 'pong', kind: SW_KIND, jobs: jobs.size }); return; }
  if (m.type === 'keepalive') return;   // receiving it is the point (Firefox ~30 s idle limit)
  if (m.type === 'job') {
    if (!port || !/^[A-Za-z0-9_-]{16,64}$/.test(m.id) || !(m.keyBytes instanceof Uint8Array) || m.keyBytes.length !== 32) {
      port?.postMessage({ type: 'job-refused' });
      return;
    }
    jobs.set(m.id, { uuid: m.uuid, keyBytes: m.keyBytes, name: m.name, z: m.z, n: m.n,
                     stallAt: m.stallAt, stallSec: m.stallSec, port, cancelled: false });
    port.postMessage({ type: 'job-ok' });
  }
});

self.addEventListener('fetch', e => {
  const m = new URL(e.request.url).pathname.match(/\/assets\/dl\/([A-Za-z0-9_-]{16,64})$/);
  if (!m) return;
  const job = jobs.get(m[1]);
  if (!job) { e.respondWith(new Response('No such download.', { status: 404 })); return; }
  jobs.delete(m[1]);
  let finish;
  const done = new Promise(r => { finish = r; });
  const ascii = job.name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  e.respondWith(new Response(makeStream(job, finish), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(job.z),
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(job.name)}`,
      'X-Content-Type-Options': 'nosniff',
    },
  }));
  e.waitUntil(done);   // hold the fetch event open until the body drains
});

function makeStream(job, finish) {
  const stats = newStats();
  const say = msg => { try { job.port.postMessage(msg); } catch { /* page gone */ } };
  let i = 0, bytes = 0, t0 = 0, read;
  return new ReadableStream({
    async start() {
      t0 = Date.now();
      const partKey = await derivePartKey(job.keyBytes, ['decrypt']);
      job.keyBytes.fill(0);
      job.keyBytes = null;
      read = partReader(job, partKey, stats);
      say({ type: 'started', kind: SW_KIND });
    },
    async pull(ctl) {
      try {
        if (job.stallSec && i === job.stallAt) { say({ type: 'stall', i, s: job.stallSec }); await pause(job.stallSec * 1000); }
        const plain = await read(i);
        ctl.enqueue(plain);
        bytes += plain.byteLength;
        i++;
        say({ type: 'part', i, n: job.n, bytes, ms: Date.now() - t0, stats });
        if (i === job.n) { ctl.close(); say({ type: 'done', bytes, ms: Date.now() - t0, stats }); finish(); }
      } catch (err) {
        job.cancelled = true;
        say({ type: 'error', i, msg: err.message, stats });
        ctl.error(err);
        finish();
      }
    },
    cancel(reason) {
      job.cancelled = true;
      say({ type: 'cancelled', i, reason: String(reason), stats });
      finish();
    },
  }, { highWaterMark: 1 });
}
