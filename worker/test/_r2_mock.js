import { handleOrphanSweep } from 'src/handlers/orphan_sweep.js';
import { CHUNK_SIZE } from 'src/sweep_rules.js';

// test/_r2_mock.js — in-memory R2 bucket + KV + sweep fixtures for the B12-1 tests (not a test file).
//   bucket._log.deletes = one array per delete() call (R2 batch shape)
//   bucket._log.puts    = every put(), in order

export function makeBucket(seed = {}) {
  const store = new Map();
  const log   = { puts: [], deletes: [] };
  for (const [key, v] of Object.entries(seed)) {
    store.set(key, { body: v.body, size: v.size ?? (v.body ? v.body.length : 0), uploaded: new Date(v.uploaded * 1000) });
  }
  return {
    _store: store,
    _log:   log,
    async list({ prefix = '', limit = 1000, cursor } = {}) {
      const keys  = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? parseInt(cursor, 10) : 0;
      const next  = start + limit;
      return {
        objects: keys.slice(start, next).map(k => ({ key: k, size: store.get(k).size, uploaded: store.get(k).uploaded })),
        list_complete: next >= keys.length,
        cursor: String(next),
      };
    },
    async get(key) {
      const o = store.get(key);
      if (!o) return null;
      return { size: o.size, json: async () => JSON.parse(o.body), text: async () => o.body };
    },
    async put(key, value) {
      log.puts.push({ key, value });
      const body = typeof value === 'string' ? value : undefined;
      store.set(key, { body, size: body ? body.length : (value?.byteLength ?? 0), uploaded: new Date(Date.now()) });
    },
    async delete(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      log.deletes.push([...arr]);
      for (const k of arr) store.delete(k);
    },
  };
}

export function makeKV(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const log   = { puts: [], deletes: [] };
  return {
    _store: store,
    _log:   log,
    async get(key, opts) {
      const v = store.get(key);
      if (v === undefined) return null;
      return opts?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value, opts) { log.puts.push({ key, value, opts }); store.set(key, value); },
    async delete(key)           { log.deletes.push(key); store.delete(key); },
    async list({ prefix = '' } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) };
    },
  };
}

// ── sweep fixtures ──────────────────────────────────────────────────────────
export const NOW  = 1_800_000_000;
export const DAY  = 86400;
export const FULL = CHUNK_SIZE + 16;
export const SOAK = 'aaaaaaaa-0000-4000-8000-00000000500a'; // test-only; sweep_safety adds it to SWEEP_PROTECTED_UUIDS
export const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ── fixtures ────────────────────────────────────────────────────────────────
// A transfer's R2 objects. total = total_chunks; present = how many chunks exist.
export function transfer(uuid, { total = 3, present = total, uploaded = NOW - DAY, manifest = null, hashes = false, seal = false } = {}) {
  const seed = {};
  for (let i = 0; i < present; i++) {
    seed[`${uuid}/${String(i).padStart(4, '0')}`] = { size: i < total - 1 ? FULL : 1000, uploaded };
  }
  if (manifest) seed[`${uuid}/manifest.json`] = { body: JSON.stringify(manifest), uploaded };
  if (hashes)   seed[`${uuid}/hashes`]            = { size: total * 32, uploaded };
  if (seal)     seed[`${uuid}/date-seal.ots.enc`] = { size: 100, uploaded };
  return seed;
}
export const complete = (uuid, o = {}) => ({ uuid, total_chunks: 3, upload_complete: true, expiry_timestamp: NOW + DAY, created_at: NOW - 2 * DAY, ...o });
export const partial  = (uuid, o = {}) => ({ uuid, total_chunks: 3, upload_complete: false, expiry_timestamp: NOW + DAY, created_at: NOW - DAY, ...o });
export const dock     = (o = {}) => ({ expiry_timestamp: NOW - 3 * DAY, tier: 'creative', file_name: 'encrypted-payload', created_at: NOW - 10 * DAY, ...o });

export async function sweep(bucket, kv, query = '') {
  const env = { BUCKET: bucket, STATUS_KV: kv, ADMIN_KEY: 'k' };
  const res = await handleOrphanSweep(new Request(`https://w.test/admin/orphan-sweep?${query}`, { headers: { 'X-Admin-Key': 'k' } }), env);
  return { res, body: await res.json() };
}
