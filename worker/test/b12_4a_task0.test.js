// test/b12_4a_task0.test.js
// B12-4a task 0 — the email-only subscription routes are gone (410), with CORS
// so the plans page reads the error instead of a CORS failure.

import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';

const env = { STATUS_KV: null };
const ctx = { waitUntil() {} };

describe('B12-4a task 0 — /subscription/status and /subscription/portal', () => {
  it('GET /subscription/status?email=… → 410, no lookup', async () => {
    const res = await worker.fetch(new Request('https://w.test/subscription/status?email=dev%40refueler.io',
      { headers: { Origin: 'https://refueler.io' } }), env, ctx);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'Gone' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://refueler.io');
  });

  it('POST /subscription/portal { email } → 410, no portal session', async () => {
    const res = await worker.fetch(new Request('https://w.test/subscription/portal', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://refueler.io' },
      body: JSON.stringify({ email: 'dev@refueler.io' }),
    }), env, ctx);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'Gone' });
  });
});
