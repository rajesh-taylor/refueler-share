// test/ops_alerts_1.test.js
// Ops-Alerts-1 (31 Oct 2026, row 30b): hourly integer counters of our own machinery,
// checked by the :15 cron; one plain email per problem per day; GET /health for the
// GitHub Actions heartbeat. Never who: no IP, transfer ID, email or customer ID.

import { describe, it, expect, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import {
  COUNTERS, count, sums, webhookOutcome, countingBucket, recordSweep, runOpsCheck,
  SWEEP_STALE_SECONDS, R2_ERROR_THRESHOLD,
} from '../src/ops.js';
import { sendSignInEmail } from '../src/mailer.js';
import { makeBucket, makeKV } from './_r2_mock.js';

afterEach(() => vi.restoreAllMocks());

const T = 1_800_000_000;        // a fixed "now" (unix seconds)
const H = 3600;
const hourOf = (t) => `ops:h:${Math.floor(t / H)}`;

function makeMail({ fail = false } = {}) {
  const sent = [];
  return { sent, async send(m) { if (fail) throw new Error('send refused'); sent.push(m); } };
}
const opsEnv = (o = {}) => ({
  STATUS_KV: makeKV(), EMAIL: makeMail(),
  OPS_ALERT_TO: 'ops@example.test', OPS_MAIL_FROM: 'alerts@mail.example.test', ...o,
});
function makeCtx() {
  const waits = [];
  return { waits, waitUntil: (p) => waits.push(p), passThroughOnException() {}, settle: () => Promise.all(waits) };
}
// A quiet env: hello already sent, a sweep finished an hour ago.
async function quiet(env, now = T) {
  await env.STATUS_KV.put('ops:hello', '1');
  await env.STATUS_KV.put('ops:sweep_last_ok', String(now - H));
  return env;
}

describe('counters — integers only, never who', () => {
  it('adds to this hour\'s record; the record holds counter names and integers only', async () => {
    const env = opsEnv();
    await count(env, 'webhook_ok', 1, T);
    await count(env, 'webhook_ok', 1, T + 60);
    await count(env, 'r2_error', 3, T);
    const rec = JSON.parse(env.STATUS_KV._store.get(hourOf(T)));
    expect(rec).toEqual({ webhook_ok: 2, r2_error: 3 });
    for (const [k, v] of Object.entries(rec)) {
      expect(COUNTERS).toContain(k);
      expect(Number.isInteger(v)).toBe(true);
    }
    expect(env.STATUS_KV._log.puts[0].opts).toEqual({ expirationTtl: 3 * 86400 });
  });

  it('ignores a name that is not a counter (nothing else can be stored)', async () => {
    const env = opsEnv();
    await count(env, 'user@example.com', 1, T);
    expect(env.STATUS_KV._store.size).toBe(0);
  });

  it('never throws when KV fails', async () => {
    const env = opsEnv();
    env.STATUS_KV.put = async () => { throw new Error('kv down'); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(count(env, 'sweep_ok', 1, T)).resolves.toBeUndefined();
  });

  it('sums the 24 hours up to now and no further back', async () => {
    const env = opsEnv();
    await count(env, 'webhook_error', 1, T);
    await count(env, 'webhook_error', 1, T - 23 * H);
    await count(env, 'webhook_error', 5, T - 24 * H);   // 25th hour back: out
    expect((await sums(env, T)).webhook_error).toBe(2);
  });

  it('webhook status → counter', () => {
    expect(webhookOutcome(200)).toBe('webhook_ok');
    expect(webhookOutcome(401)).toBe('webhook_sig_fail');
    expect(webhookOutcome(500)).toBe('webhook_error');
  });
});

describe('where the counts come from', () => {
  it('a Stripe webhook with a bad signature counts webhook_sig_fail (and nothing about the caller)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = opsEnv({ STRIPE_WEBHOOK_SECRET: 'whsec_test', BUCKET: makeBucket() });
    const ctx = makeCtx();
    const res = await worker.fetch(new Request('https://api.share.refueler.io/webhook/stripe', {
      method: 'POST', body: '{"type":"x"}',
      headers: { 'Stripe-Signature': 't=1,v1=00', 'CF-Connecting-IP': '203.0.113.9' },
    }), env, ctx);
    await ctx.settle();
    expect(res.status).toBe(401);
    const stored = [...env.STATUS_KV._store.values()].join();
    expect(JSON.parse(env.STATUS_KV._store.get(hourOf(Math.floor(Date.now() / 1000))))).toEqual({ webhook_sig_fail: 1 });
    expect(stored).not.toContain('203.0.113.9');
  });

  it('countingBucket counts a rejected call and passes results and errors through', async () => {
    const onError = vi.fn();
    const target = {
      async get(k) { return k === 'x' ? { ok: 1 } : null; },
      async put() { throw new Error('R2 down'); },
      boom() { throw new Error('sync'); },
      name: 'b',
    };
    const b = countingBucket(target, onError);
    expect(await b.get('x')).toEqual({ ok: 1 });
    expect(await b.get('missing')).toBeNull();          // a miss is not an error
    expect(onError).not.toHaveBeenCalled();
    await expect(b.put('k', 'v')).rejects.toThrow('R2 down');
    expect(() => b.boom()).toThrow('sync');
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(b.name).toBe('b');
  });

  it('the 03:30 sweep: success counts sweep_ok + last-ok time; an R2 failure counts sweep_fail and r2_error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const good = opsEnv({ BUCKET: makeBucket() });
    await worker.scheduled({ cron: '30 3 * * *' }, good, makeCtx());
    const now = Math.floor(Date.now() / 1000);
    expect((await sums(good, now)).sweep_ok).toBe(1);
    expect(Number(good.STATUS_KV._store.get('ops:sweep_last_ok'))).toBeGreaterThan(now - 60);

    const bad = opsEnv({ BUCKET: { async list() { throw new Error('R2 down'); } } });
    const ctx = makeCtx();
    await worker.scheduled({ cron: '30 3 * * *' }, bad, ctx);
    await ctx.settle();
    const s = await sums(bad, Math.floor(Date.now() / 1000));
    expect(s.sweep_fail).toBe(1);
    expect(s.r2_error).toBe(1);
    expect(s.sweep_ok).toBe(0);
  });

  it('a failed sign-in email counts email_send_fail and still throws', async () => {
    const env = opsEnv({ EMAIL: makeMail({ fail: true }), AUTH_MAIL_FROM: 'signin@x.test' });
    await expect(sendSignInEmail(env, 'a@b.test', [{ kind: 'citizen', url: 'https://s/#t=1' }])).rejects.toThrow();
    const rec = JSON.parse([...env.STATUS_KV._store.values()][0]);
    expect(rec).toEqual({ email_send_fail: 1 });
  });

  it('recordSweep(false) does not move the last-ok time', async () => {
    const env = opsEnv();
    await recordSweep(env, false, T);
    expect(env.STATUS_KV._store.has('ops:sweep_last_ok')).toBe(false);
  });
});

describe('the :15 check', () => {
  it('first run sends one "alerts are on" email, then nothing while all is well', async () => {
    const env = opsEnv();
    await runOpsCheck(env, T);
    await runOpsCheck(env, T + H);
    expect(env.EMAIL.sent).toHaveLength(1);
    expect(env.EMAIL.sent[0]).toMatchObject({ to: 'ops@example.test', from: 'alerts@mail.example.test' });
    expect(env.EMAIL.sent[0].subject).toBe('Share: ops alerts are on');
  });

  it('the hourly cron runs it', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"tokens":0,"sessions":0}'));
    const env = opsEnv({ BUCKET: makeBucket(), SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'k' });
    await worker.scheduled({ cron: '15 * * * *' }, env, makeCtx());
    expect(env.EMAIL.sent.map(m => m.subject)).toEqual(['Share: ops alerts are on']);
  });

  it('Stripe signature failures with no OK: one email per day, counts + route only', async () => {
    const env = await quiet(opsEnv());
    await count(env, 'webhook_sig_fail', 4, T - 2 * H);
    expect(await runOpsCheck(env, T)).toEqual([{ id: 'stripe_sig', sent: true }]);
    await runOpsCheck(env, T + H);                       // same day: no second email
    expect(env.EMAIL.sent).toHaveLength(1);
    const m = env.EMAIL.sent[0];
    expect(m.subject).toBe('Share: Stripe webhooks failing the signature check');
    expect(m.text).toContain('4 Stripe webhook(s) answered 401');
    expect(m.text).toContain('Route: POST /webhook/stripe');
    expect(m.text).not.toMatch(/@|cus_|[0-9a-f]{8}-[0-9a-f]{4}-/);   // no address, customer or transfer ID
  });

  it('…but not when a webhook also passed in the same 24 hours', async () => {
    const env = await quiet(opsEnv());
    await count(env, 'webhook_sig_fail', 1, T);
    await count(env, 'webhook_ok', 1, T - H);
    expect(await runOpsCheck(env, T)).toEqual([]);
  });

  it('a problem still there the next UTC day emails again', async () => {
    const env = await quiet(opsEnv());
    await count(env, 'email_send_fail', 1, T);
    await runOpsCheck(env, T);
    const nextDay = (Math.floor(T / 86400) + 1) * 86400 + 60;
    await env.STATUS_KV.put('ops:sweep_last_ok', String(nextDay - H));
    await count(env, 'email_send_fail', 1, nextDay);
    await runOpsCheck(env, nextDay);
    expect(env.EMAIL.sent.map(m => m.subject)).toEqual(['Share: Email sending failed', 'Share: Email sending failed']);
  });

  it('a failed alert is not marked sent, is counted, and is tried again next hour', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = await quiet(opsEnv({ EMAIL: makeMail({ fail: true }) }));
    await count(env, 'webhook_error', 1, T);
    expect(await runOpsCheck(env, T)).toEqual([{ id: 'webhook_error', sent: false }]);
    expect((await sums(env, T)).email_send_fail).toBe(1);
    env.EMAIL = makeMail();
    const second = await runOpsCheck(env, T + H);
    expect(second.find(r => r.id === 'webhook_error')).toEqual({ id: 'webhook_error', sent: true });
  });

  it('sweep: a failure fires; no finished sweep for 26 hours fires; the first run sets the baseline', async () => {
    const env = opsEnv();
    await env.STATUS_KV.put('ops:hello', '1');
    expect(await runOpsCheck(env, T)).toEqual([]);                       // baseline written
    expect(env.STATUS_KV._store.get('ops:sweep_last_ok')).toBe(String(T));
    expect(await runOpsCheck(env, T + SWEEP_STALE_SECONDS)).toEqual([]);
    expect(await runOpsCheck(env, T + SWEEP_STALE_SECONDS + H)).toEqual([{ id: 'sweep', sent: true }]);

    const env2 = await quiet(opsEnv());
    await count(env2, 'sweep_fail', 1, T);
    expect(await runOpsCheck(env2, T)).toEqual([{ id: 'sweep', sent: true }]);
  });

  it(`R2: fires at ${R2_ERROR_THRESHOLD} errors in 24 hours, not below`, async () => {
    const env = await quiet(opsEnv());
    await count(env, 'r2_error', R2_ERROR_THRESHOLD - 1, T);
    expect(await runOpsCheck(env, T)).toEqual([]);
    await count(env, 'r2_error', 1, T);
    expect(await runOpsCheck(env, T)).toEqual([{ id: 'r2', sent: true }]);
  });

  it('with no recipient configured: no send, no throw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = await quiet(opsEnv({ OPS_ALERT_TO: undefined }));
    await count(env, 'email_send_fail', 1, T);
    expect(await runOpsCheck(env, T)).toEqual([{ id: 'email', sent: false }]);
    expect(env.EMAIL.sent).toHaveLength(0);
  });
});

describe('GET /health', () => {
  it('answers 200 {"ok":true} and touches no storage', async () => {
    const env = opsEnv({ BUCKET: makeBucket() });
    const res = await worker.fetch(new Request('https://api.share.refueler.io/health'), env, makeCtx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(env.STATUS_KV._log.puts).toHaveLength(0);
  });
});
