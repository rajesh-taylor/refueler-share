// test/slow-link-1.test.js
// Safari-Slow-Link-1 — download verify-then-stream.
//   The verified download path used to buffer each whole 33.5 MB part (plus a WASM
//   copy) before sending it; a browser's 4 parts in flight passed the 128 MB isolate
//   limit and the isolate was reset ("Network connection lost.", live 8 Oct 2026).
//   Now: read 1 hashes the part as it streams (hashStream, nothing kept); on a match
//   read 2 (etagMatches read 1) streams to the recipient. Every size verifies first.

import { describe, it, expect, vi } from 'vitest';
import { blake3 } from '../node_modules/@noble/hashes/blake3.js';
import { hashOneShot, hashStream, incrHeapBytes } from '../src/blake3_wasm.js';
import { verifyChunkStream } from '../src/handlers/download_verify.js';
import { buildMerkleTree, TREE_ALGO } from '../src/merkle.js';

// Read the manifest straight from the fake bucket (keeps the real json/err/UUID_RE).
vi.mock('../src/utils.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    safeGetManifest: async (bucket, uuid) => {
      const o = await bucket.get(`${uuid}/manifest.json`);
      return { manifest: o ? JSON.parse(await o.text()) : null, oversize: false };
    },
  };
});

import { handleDownload } from '../src/handlers/download.js';

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// A stream yielding `bytes` in pieces of `piece` bytes (uneven last piece).
function streamOf(bytes, piece = 1 << 20) {
  let off = 0;
  return new ReadableStream({
    pull(c) {
      if (off >= bytes.length) return c.close();
      c.enqueue(bytes.slice(off, off + piece));
      off += piece;
    },
  });
}

function randomBytes(n) {
  const out = new Uint8Array(n);
  for (let o = 0; o < n; o += 65536) crypto.getRandomValues(out.subarray(o, Math.min(n, o + 65536)));
  return out;
}

// ── hashStream ───────────────────────────────────────────────────────────────
describe('hashStream — streaming WASM BLAKE3', () => {
  it('reproduces the standard BLAKE3 vectors (empty, "abc")', async () => {
    expect(hex(await hashStream(streamOf(new Uint8Array(0)))))
      .toBe('af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262');
    expect(hex(await hashStream(streamOf(new TextEncoder().encode('abc'), 1))))
      .toBe('6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85');
  });

  it('equals hashOneShot and noble on a full 32 MiB + 16 part, in uneven pieces', async () => {
    const part = randomBytes(32 * 1024 * 1024 + 16);
    const want = hex(hashOneShot(part));
    expect(hex(blake3(part))).toBe(want);
    expect(hex(await hashStream(streamOf(part, 1_000_003)))).toBe(want);
    expect(hex(await hashStream(streamOf(part, 65536)))).toBe(want);
  });

  it('keeps no part in memory: the WASM heap stays small across 200 MiB hashed', async () => {
    const piece = randomBytes(1 << 20);
    const many = () => new ReadableStream({
      n: 0,
      pull(c) { if (this.n++ >= 64) c.close(); else c.enqueue(piece); },
    });
    await hashStream(many());
    const after1 = await incrHeapBytes();
    await hashStream(many());
    await hashStream(many());
    expect(await incrHeapBytes()).toBe(after1);        // no growth: nothing leaks per call
    expect(after1).toBeLessThan(8 * 1024 * 1024);      // a piece, never a part
  });

  it('throws when the stream errors (caller answers 502, retryable)', async () => {
    const bad = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); c.error(new Error('cut')); } });
    await expect(hashStream(bad)).rejects.toThrow('cut');
  });
});

describe('verifyChunkStream', () => {
  const bodies  = [randomBytes(1000), randomBytes(1000)];
  const sidecar = new Uint8Array(64);
  bodies.forEach((b, i) => sidecar.set(blake3(b), i * 32));

  it('accepts the stored bytes of part i', async () => {
    expect(await verifyChunkStream(streamOf(bodies[1], 7), sidecar, 1)).toBe(true);
  });
  it('rejects one flipped byte, and the right body at the wrong index', async () => {
    const t = bodies[1].slice(); t[500] ^= 1;
    expect(await verifyChunkStream(streamOf(t), sidecar, 1)).toBe(false);
    expect(await verifyChunkStream(streamOf(bodies[1]), sidecar, 0)).toBe(false);
  });
});

// ── handleDownload (verified path) against a fake R2 with etags + onlyIf ─────
const UUID = '61971a1b-0000-4000-8000-00000000510a';
const NOW  = Math.floor(Date.now() / 1000);

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// N parts of `size` bytes. hooks.afterFirstGet(key, bucket) runs once per part key.
function fakeTransfer(N, { size = 4096, hooks = {} } = {}) {
  const parts = Array.from({ length: N }, () => randomBytes(size));
  const leaves = parts.map((p) => blake3(p));
  const sidecar = new Uint8Array(N * 32);
  leaves.forEach((d, i) => sidecar.set(d, i * 32));
  const manifest = {
    uuid: UUID, total_chunks: N, upload_complete: true,
    merkle_root: b64url(buildMerkleTree(leaves).root), tree_algo: TREE_ALGO,
    expiry_timestamp: NOW + 86400, pending_destruction: null, file_name: 'encrypted-payload',
  };
  const store = new Map();
  let etagN = 0;
  const set = (k, v) => store.set(k, { bytes: typeof v === 'string' ? new TextEncoder().encode(v) : v, etag: `e${++etagN}` });
  set(`${UUID}/manifest.json`, JSON.stringify(manifest));
  set(`${UUID}/hashes`, sidecar);
  parts.forEach((p, i) => set(`${UUID}/${String(i).padStart(4, '0')}`, p));
  const gets = [];
  const seen = new Set();
  const bucket = {
    set,
    gets,
    async get(key, opts = {}) {
      gets.push({ key, onlyIf: opts.onlyIf });
      const o = store.get(key);
      if (!o) return null;
      const meta = { key, etag: o.etag, size: o.bytes.length };
      if (opts.onlyIf?.etagMatches && opts.onlyIf.etagMatches !== o.etag) return meta;   // R2Object, no body
      const out = {
        ...meta,
        body: streamOf(o.bytes, 1500),
        arrayBuffer: async () => o.bytes.slice().buffer,
        text: async () => new TextDecoder().decode(o.bytes),
      };
      if (/\/\d{4}$/.test(key) && !seen.has(key)) { seen.add(key); hooks.afterFirstGet?.(key, bucket); }
      return out;
    },
    async put(key, value) { set(key, value); },
  };
  const env = { BUCKET: bucket, STATUS_KV: { get: async () => null, put: async () => {} } };
  const ctx = { waitUntil: () => {} };
  return { parts, env, ctx, bucket };
}

const get = (t, i, headers = {}) =>
  handleDownload(new Request(`https://w.test/download/${UUID}/${i}`, { headers }), t.env, t.ctx, UUID, i);

describe('handleDownload — verify, then stream', () => {
  it('200: serves exactly the stored bytes, X-Integrity set, two reads (second pinned to the first etag)', async () => {
    const t = fakeTransfer(3);
    const res = await get(t, 1);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Integrity')).toBe('ciphertext-storage-verified');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(t.parts[1]);
    const reads = t.bucket.gets.filter((g) => g.key.endsWith('/0001'));
    expect(reads).toHaveLength(2);
    expect(reads[0].onlyIf).toBeUndefined();
    expect(reads[1].onlyIf).toEqual({ etagMatches: 'e4' });   // manifest e1, hashes e2, parts e3…
  });

  it('409 {integrity_failed, chunk}: a tampered part is refused before any byte, no second read', async () => {
    const t = fakeTransfer(3);
    const bad = t.parts[2].slice(); bad[0] ^= 1;
    t.bucket.set(`${UUID}/0002`, bad);
    const res = await get(t, 2);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'integrity_failed', chunk: 2 });
    expect(t.bucket.gets.filter((g) => g.key.endsWith('/0002'))).toHaveLength(1);
  });

  it('409: an object replaced between the verify read and the send read is refused', async () => {
    const t = fakeTransfer(2, {
      hooks: { afterFirstGet: (key, b) => { if (key.endsWith('/0001')) b.set(key, randomBytes(4096)); } },
    });
    const res = await get(t, 1);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'integrity_failed', chunk: 1 });
  });

  it('502 (retryable) when the verify read is cut mid-part', async () => {
    const t = fakeTransfer(2);
    const realGet = t.bucket.get;
    t.bucket.get = async (key, opts) => {
      const o = await realGet(key, opts);
      if (key.endsWith('/0000') && o?.body) {
        o.body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); c.error(new Error('cut')); } });
      }
      return o;
    };
    expect((await get(t, 0)).status).toBe(502);
  });

  it('over 128 parts: same path — verified before the first byte, a mismatch is a clean 409', async () => {
    const t = fakeTransfer(130, { size: 64 });
    const ok = await get(t, 129);
    expect(ok.status).toBe(200);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(t.parts[129]);
    t.bucket.set(`${UUID}/0128`, new Uint8Array(64));
    const bad = await get(t, 128);
    expect(bad.status).toBe(409);
  });

  it('Range on a verified transfer is still 416', async () => {
    const t = fakeTransfer(1);
    expect((await get(t, 0, { Range: 'bytes=0-9' })).status).toBe(416);
  });
});
