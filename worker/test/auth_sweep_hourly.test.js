// test/auth_sweep_hourly.test.js
// Tombstone-30 (16 Oct 2026): sign-in tokens and sessions past expiry are swept
// hourly (cron "15 * * * *"), not nightly — a dead sign-in record is gone within
// the hour, so "24 hours at most" stays true. The 03:00 run no longer sweeps them.

import { describe, it, expect, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import { makeBucket, makeKV } from './_r2_mock.js';

afterEach(() => vi.restoreAllMocks());

const env = () => ({ BUCKET: makeBucket(), STATUS_KV: makeKV(), SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'k' });
const sweptAuth = (spy) => spy.mock.calls.some(([u]) => String(u?.url ?? u).includes('/rest/v1/rpc/auth_sweep'));

describe('sign-in sweep — hourly', () => {
  it('the hourly trigger sweeps sign-in records', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"tokens":0,"sessions":0}'));
    await worker.scheduled({ cron: '15 * * * *' }, env(), {});
    expect(sweptAuth(spy)).toBe(true);
  });

  it('the 03:00 trigger no longer does', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'));
    await worker.scheduled({ cron: '0 3 * * *' }, env(), {}).catch(() => {});
    expect(sweptAuth(spy)).toBe(false);
  });
});
