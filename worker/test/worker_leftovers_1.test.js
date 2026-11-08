// test/worker_leftovers_1.test.js
// Worker-Leftovers-1 (8 Nov 2026).
//   1. GET /download refuses every part until finalise has run (425 upload_incomplete),
//      on every tier; the password check still comes first.
//   2. The hourly ops check reads one row from the database and alerts after two
//      failed hours in a row.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { issueDownloadToken, hashSecret } from '../src/download_gate.js';
import { TREE_ALGO } from '../src/merkle.js';
import { runOpsCheck, RULES, DB_DOWN_AFTER } from '../src/ops.js';
import { makeBucket, makeKV } from './_r2_mock.js';
import { transferRequest } from './helpers/transfer-request.js';

afterEach(() => vi.restoreAllMocks());

const ORIGIN = 'https://api.share.refueler.io';
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const KEY_B64 = 'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=';
const NOW = Math.floor(Date.now() / 1000);
const FAR = 4102444800;

describe('GET /download — nothing until the upload is complete', () => {
  let env, ctx;
  const waits = [];

  function setup(fields) {
    const manifest = { uuid: UUID, tier: 'free', total_chunks: 2, expiry_timestamp: NOW + 86400, file_name: 'encrypted-payload', ...fields };
    env = {
      BUCKET: makeBucket({
        [`${UUID}/manifest.json`]: { uploaded: NOW, body: JSON.stringify(manifest) },
        [`${UUID}/0000`]: { uploaded: NOW, body: 'ciphertext' },
      }),
      STATUS_KV: makeKV(), ENVIRONMENT: 'test', DL_TOKEN_KEY: KEY_B64,
    };
    ctx = { waitUntil: (p) => waits.push(p), passThroughOnException() {} };
  }
  const get = (headers = {}, part = 0) => worker.fetch(transferRequest(`${ORIGIN}/download`, UUID, {
    method: 'GET', headers: { 'CF-Connecting-IP': '198.51.100.7', ...headers },
  }, part), env, ctx);
  const stored = () => JSON.parse(env.BUCKET._store.get(`${UUID}/manifest.json`).body);
  const bearer = async () => ({ Authorization: `Bearer ${await issueDownloadToken(UUID, env, FAR)}` });

  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

  for (const tier of ['free', 'citizen', 'api']) {
    it(`no password, still uploading (${tier}): refused, no ciphertext, nothing stamped`, async () => {
      setup({ tier, upload_complete: false });
      const res = await get();
      expect(res.status).toBe(425);
      const body = await res.text();
      expect(JSON.parse(body)).toEqual({ error: 'upload_incomplete' });
      expect(body).not.toContain('ciphertext');
      expect(stored().download_initiated_at).toBeUndefined();
    });
  }

  it('a manifest with no upload_complete field is refused too', async () => {
    setup({});
    expect((await get()).status).toBe(425);
  });

  it('a Range request on an upload in progress is refused', async () => {
    setup({ upload_complete: false });
    expect((await get({ Range: 'bytes=0-3' })).status).toBe(425);
  });

  it('a refused fetch is not counted as a download', async () => {
    setup({ upload_complete: false });
    const points = [];
    env.AE = { writeDataPoint: (p) => points.push(p) };
    await get();
    expect(points.filter(p => p.blobs[0] === 'download_tier')).toEqual([]);
  });

  it('complete: served, and the first part stamps download_initiated_at', async () => {
    setup({ upload_complete: true });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Chunk-Index')).toBe('0');
    expect(typeof stored().download_initiated_at).toBe('number');
  });

  it('complete with a root goes through the Merkle check (missing sidecar: 409)', async () => {
    setup({ upload_complete: true, merkle_root: 'AAAA', tree_algo: TREE_ALGO });
    expect((await get()).status).toBe(409);
  });

  it('password, no token: 401 whether uploading or complete', async () => {
    const p2sh_secret_hash = await hashSecret('correct horse');
    setup({ p2sh_secret_hash, upload_complete: false });
    expect((await get()).status).toBe(401);
    setup({ p2sh_secret_hash, upload_complete: true });
    expect((await get()).status).toBe(401);
  });

  it('password, valid token: 425 while uploading, served once complete', async () => {
    const p2sh_secret_hash = await hashSecret('correct horse');
    setup({ p2sh_secret_hash, upload_complete: false });
    expect((await get(await bearer())).status).toBe(425);
    setup({ p2sh_secret_hash, upload_complete: true });
    expect((await get(await bearer())).status).toBe(200);
  });
});

describe('ops check — database probe', () => {
  const T = 1_800_000_000;
  const H = 3600;
  let env, mail;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mail = [];
    env = {
      STATUS_KV: makeKV(), EMAIL: { send: async (m) => { mail.push(m); } },
      OPS_ALERT_TO: 'ops@example.test', OPS_MAIL_FROM: 'alerts@mail.example.test',
      SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_KEY: 'k',
    };
    await env.STATUS_KV.put('ops:hello', '1');
    await env.STATUS_KV.put('ops:sweep_last_ok', String(T));
  });
  const dbAnswers = (status) => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('[]', { status }));
  const dbThrows = () => vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));

  it('reads one id and nothing about anyone', async () => {
    const f = dbAnswers(200);
    await runOpsCheck(env, T);
    expect(f).toHaveBeenCalledTimes(1);
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain('select=id');
    expect(url).toContain('limit=1');
    expect(f.mock.calls[0][1].method).toBe('GET');
  });

  it('healthy: no alert', async () => {
    dbAnswers(200);
    expect(await runOpsCheck(env, T)).toEqual([]);
    expect(mail).toEqual([]);
  });

  it('one failed hour stays quiet', async () => {
    dbAnswers(503);
    expect(await runOpsCheck(env, T)).toEqual([]);
  });

  it(`${DB_DOWN_AFTER} failed hours in a row send one email, counts and route only`, async () => {
    dbThrows();
    await runOpsCheck(env, T);
    expect(await runOpsCheck(env, T + H)).toEqual([{ id: 'db', sent: true }]);
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe('Share: Database not answering');
    expect(mail[0].text).toContain('2 hourly checks');
    expect(mail[0].text).not.toContain('db.example.test');
    expect(await runOpsCheck(env, T + 2 * H)).toEqual([{ id: 'db', sent: false, already: true }]);
    expect(mail).toHaveLength(1);
  });

  it('a good hour resets the run', async () => {
    const f = dbAnswers(500);
    await runOpsCheck(env, T);
    f.mockImplementation(async () => new Response('[]', { status: 200 }));
    await runOpsCheck(env, T + H);
    f.mockImplementation(async () => new Response('[]', { status: 500 }));
    expect(await runOpsCheck(env, T + 2 * H)).toEqual([]);
  });

  it('a hung database counts as failed', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
      const run = runOpsCheck(env, T);
      await vi.advanceTimersByTimeAsync(6000);
      await run;
      expect(await env.STATUS_KV.get('ops:db_fails')).toBe('1');
    } finally { vi.useRealTimers(); }
  });

  it('no database configured: no probe, no alert', async () => {
    delete env.SUPABASE_URL;
    const f = dbAnswers(500);
    expect(await runOpsCheck(env, T)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('the rule is on the list', () => {
    expect(RULES.map(r => r.id)).toContain('db');
  });
});
