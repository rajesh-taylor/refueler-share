// Error-Notes-1 (21 Oct 2026): anything that can name a transfer is kept one day
// in KV; Analytics Engine (three months, no per-row delete) never gets a transfer ID.
import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { makeKv } from './helpers/kv-mock.js';
import {
  appendClientError, appendErrorNote, readErrorNotes, handleClientErrorsLog,
  stripTransferId, RETENTION_SECONDS,
} from '../src/handlers/client_errors_kv.js';
import { scrubUuids } from '../src/utils.js';

const ADMIN_KEY = 'test-admin-key-error-notes-1';
const UUID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function makeAe() {
  const points = [];
  return { points, writeDataPoint(p) { points.push(p); } };
}
function makeCtx() {
  const waits = [];
  return { waits, waitUntil(p) { waits.push(p); } };
}
const keysWith = (kv, prefix) => [...kv._store.keys()].filter(k => k.startsWith(prefix));

describe('retention', () => {
  it('is one day', () => {
    expect(RETENTION_SECONDS).toBe(86_400);
  });
});

describe('stripTransferId / scrubUuids', () => {
  it('drops the uuid prefix, keeps chunk/attempt', () => {
    expect(stripTransferId('uuid:1a2b3c4d chunk:12')).toBe('chunk:12');
    expect(stripTransferId('uuid:1A2B3C4D')).toBe('');
    expect(stripTransferId('chunk:3 attempt:2')).toBe('chunk:3 attempt:2');
    expect(stripTransferId('')).toBe('');
  });
  it('replaces full transfer IDs anywhere', () => {
    expect(scrubUuids(`R2 get ${UUID}/chunk_0004 failed`)).toBe('R2 get {uuid}/chunk_0004 failed');
    expect(scrubUuids(undefined)).toBe('');
  });
});

describe('POST /log/error', () => {
  async function post(body, env) {
    const ctx = makeCtx();
    const res = await worker.fetch(new Request('https://w.test/log/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }), env, ctx);
    await Promise.all(ctx.waits);
    return res;
  }

  it('Analytics Engine gets no transfer ID; KV keeps the full note for one day', async () => {
    const env = { STATUS_KV: makeKv(), AE: makeAe() };
    const res = await post({ context: 'decrypt', message: 'OperationError', detail: 'uuid:1a2b3c4d chunk:12' }, env);
    expect(res.status).toBe(200);

    const errPoints = env.AE.points.filter(p => p.blobs[0] === 'client_error');
    expect(errPoints).toHaveLength(1);
    expect(errPoints[0].blobs).toEqual(['client_error', 'decrypt', 'OperationError', 'chunk:12']);
    expect(JSON.stringify(env.AE.points)).not.toMatch(/1a2b3c4d/);

    const [key] = keysWith(env.STATUS_KV, 'errnote:');
    const { metadata, expirationTtl } = env.STATUS_KV._meta.get(key);
    expect(expirationTtl).toBe(86_400);
    expect(metadata).toMatchObject({ context: 'decrypt', message: 'OperationError', detail: 'uuid:1a2b3c4d chunk:12' });
  });
});

describe('server-observed log', () => {
  it('one key per error, one-day TTL, IDs scrubbed', async () => {
    const env = { STATUS_KV: makeKv() };
    await appendClientError(env, { status: 404, endpoint: 'meta', path: `/meta/${UUID}`, method: 'GET' });
    await appendClientError(env, { status: 503, endpoint: 'download', path: '/download', method: 'GET' });
    const keys = keysWith(env.STATUS_KV, 'errlog:');
    expect(keys).toHaveLength(2);
    for (const k of keys) expect(env.STATUS_KV._meta.get(k).expirationTtl).toBe(86_400);
    expect(JSON.stringify([...env.STATUS_KV._meta.values()])).not.toContain(UUID);
  });

  it('GET /admin/client-errors-log: newest first, window 1 day, legacy 90-day key removed', async () => {
    const env = { ADMIN_KEY, STATUS_KV: makeKv() };
    await env.STATUS_KV.put('admin:client_errors_log', JSON.stringify([{ ts: 1, status: 500 }]));
    const t0 = Date.now();
    await appendClientError(env, { status: 404, endpoint: 'old', path: '/a', method: 'GET' });
    // later entry: invert-timestamp keys sort newest first
    const realNow = Date.now;
    Date.now = () => t0 + 5_000;
    try { await appendClientError(env, { status: 500, endpoint: 'new', path: '/b', method: 'GET' }); }
    finally { Date.now = realNow; }

    const res = await handleClientErrorsLog(new Request('https://w.test/admin/client-errors-log', {
      headers: { 'X-Admin-Key': ADMIN_KEY },
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.window_days).toBe(1);
    expect(body.entries.map(e => e.endpoint)).toEqual(['new', 'old']);
    expect(body.count_4xx).toBe(1);
    expect(body.count_5xx).toBe(1);
    expect(env.STATUS_KV._store.has('admin:client_errors_log')).toBe(false);
  });

  it('401 without the admin key', async () => {
    const env = { ADMIN_KEY, STATUS_KV: makeKv() };
    const res = await handleClientErrorsLog(new Request('https://w.test/admin/client-errors-log'), env);
    expect(res.status).toBe(401);
  });
});

describe('readErrorNotes', () => {
  it('returns the Navy Office shape, newest first', async () => {
    const env = { STATUS_KV: makeKv() };
    const realNow = Date.now;
    try {
      Date.now = () => 1_790_000_000_000;
      await appendErrorNote(env, { context: 'decrypt', message: 'A', detail: 'uuid:1a2b3c4d' });
      Date.now = () => 1_790_000_060_000;
      await appendErrorNote(env, { context: 'upload', message: 'B', detail: '' });
    } finally { Date.now = realNow; }
    const rows = await readErrorNotes(env);
    expect(rows.map(r => r.message)).toEqual(['B', 'A']);
    expect(rows[1]).toEqual({ ts: new Date(1_790_000_000_000).toISOString(), context: 'decrypt', message: 'A', detail: 'uuid:1a2b3c4d' });
  });
});
