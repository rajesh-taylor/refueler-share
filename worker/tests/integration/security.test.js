/**
 * worker/tests/integration/security.test.js
 * Closed vulnerabilities as executable regression tests, against wrangler dev
 * --local. The machine-checkable half of the B9 whitepaper (TESTING.md).
 *
 * Rewritten Integration-Repair-1 (28 Oct 2026) for today's routes: upload is
 * /upload/initiate (Share-6; the PUT relay and its per-chunk checks are gone —
 * their successors, wrong_size and the declared-size cap, are tested here and
 * in round-trip.test.js), credential v2, and the transfer UUID in
 * X-Transfer-UUID only (UUID-Out-Of-Path-1).
 */

import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import * as client from './client.js';
import {
  signStripePayload,
  signStripePayloadBadSig,
  signStripePayloadStale,
  makeSubscriptionUpdatedEvent,
} from './fixtures/stripe-events.js';
import { TIER_CAPS } from '../../src/manifest.js';

beforeAll(() => client.init({ workerUrl: inject('workerUrl'), persistDir: inject('persistDir'), envFile: inject('envFile') }));
afterAll(() => client.close());

const nowSeconds = () => Math.floor(Date.now() / 1000);

// ═════════════════════════════════════════════════════════════════════════════
// Rate limits (per-IP KV throttles — a courtesy, never the security gate)
// ═════════════════════════════════════════════════════════════════════════════

describe('Rate limit enforcement — credential_issue (10 / 60s)', () => {
  it('returns 429 at limit+1 on /credential/issue', async () => {
    const ip = client.uniqueIp('rl-issue');
    for (let i = 0; i < 10; i++) {
      const r = await client.issueCredential({ ip });
      expect(r.status, `request ${i + 1} within limit`).toBe(200);
    }
    const over = await client.issueCredential({ ip });
    expect(over.status).toBe(429);
  });

  it('different IPs do not share rate limit buckets', async () => {
    const ip = client.uniqueIp('rl-issue-a');
    for (let i = 0; i < 10; i++) await client.issueCredential({ ip });
    expect((await client.issueCredential({ ip })).status).toBe(429);
    expect((await client.issueCredential({ ip: client.uniqueIp('rl-issue-b') })).status).toBe(200);
  });
});

describe('Rate limit enforcement — upload initiate (20 / 60s)', () => {
  it('returns 429 at limit+1 on /upload/initiate', async () => {
    const ip = client.uniqueIp('rl-init');
    const headers = { 'X-Transfer-UUID': crypto.randomUUID() };   // no credential: 400, but counted
    for (let i = 0; i < 20; i++) {
      const r = await client.initiate(headers, { ip });
      expect(r.status, `request ${i + 1} within limit`).toBe(400);
    }
    expect((await client.initiate(headers, { ip })).status).toBe(429);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Credential binding
// ═════════════════════════════════════════════════════════════════════════════

describe('Credential farming defence — UUID and tier binding', () => {
  it('rejects a valid credential + commitment used against a foreign UUID (401)', async () => {
    const a = await client.issueCredential();
    const b = await client.issueCredential();
    const r = await client.initiate(await client.initiateHeaders(a.body, { uuid: b.body.uuid }));
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/commitment mismatch/i);
  });

  it('rejects a free credential that claims a paid tier (401)', async () => {
    const a = await client.issueCredential();
    const r = await client.initiate(await client.initiateHeaders(a.body, { issuedTier: 'citizen' }));
    expect(r.status).toBe(401);
  });

  it('rejects a forged proof under a genuine UUID + commitment (401)', async () => {
    const a = await client.issueCredential();
    const forged = JSON.parse(a.body.proof);
    forged.secret = 'ab'.repeat(32);   // C no longer signs this secret
    const r = await client.initiate(await client.initiateHeaders(a.body, { proof: JSON.stringify(forged) }));
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/invalid credential/i);
  });
});

describe('Credential farming defence — Turnstile nonce binding', () => {
  it('rejects a reused Turnstile token on /credential/issue (nonce replay → 429)', async () => {
    const token = client.freshTurnstileToken();
    expect((await client.issueCredential({ turnstileToken: token })).status).toBe(200);
    expect((await client.issueCredential({ turnstileToken: token })).status).toBe(429);
  });

  it('same token from a different IP is still rejected (nonce is keyed by token, not IP)', async () => {
    const token = client.freshTurnstileToken();
    expect((await client.issueCredential({ turnstileToken: token, ip: client.uniqueIp('tt-a') })).status).toBe(200);
    expect((await client.issueCredential({ turnstileToken: token, ip: client.uniqueIp('tt-b') })).status).toBe(429);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Transfer UUID — header only, RFC 4122 only (UUID-Out-Of-Path-1)
// ═════════════════════════════════════════════════════════════════════════════

describe('Transfer UUID validation — X-Transfer-UUID', () => {
  const BAD = {
    'empty':              '',
    'not a uuid':         'not-a-uuid',
    'path traversal':     '../../../etc/passwd',
    'too short':          '1234-5678',
    'non-hex':            'zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz',
    'SQL fragment':       "' OR 1=1 --",
  };
  for (const [label, value] of Object.entries(BAD)) {
    it(`rejects "${label}" → 400 missing_transfer_id`, async () => {
      const r = await client.request('GET', '/meta', { headers: { 'X-Transfer-UUID': value } });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('missing_transfer_id');
    });
  }

  it('a UUID in the path is not a route (404) — the old /meta/{uuid}', async () => {
    const { uuid } = await client.upload();
    const r = await client.request('GET', `/meta/${uuid}`);
    expect(r.status).toBe(404);
  });

  it('download without X-Part → 400 missing_part', async () => {
    const r = await client.request('GET', '/download', { headers: { 'X-Transfer-UUID': crypto.randomUUID() } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('missing_part');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Free-tier limits at initiate (declared size + expiry; checked before the spend)
// ═════════════════════════════════════════════════════════════════════════════

describe('Tier cap enforcement — free tier', () => {
  it('rejects a declared total over the free cap → 413', async () => {
    const a = await client.issueCredential();
    const r = await client.initiate(await client.initiateHeaders(a.body, { totalBytes: TIER_CAPS.free + 1 }));
    expect(r.status).toBe(413);
  });

  it('accepts a declared total exactly at the free cap', async () => {
    const a = await client.issueCredential();
    const r = await client.initiate(await client.initiateHeaders(a.body, { totalBytes: TIER_CAPS.free }));
    expect(r.status).toBe(200);
  });

  it('rejects an expiry past the free 7-day window → 400', async () => {
    const a = await client.issueCredential();
    const r = await client.initiate(await client.initiateHeaders(a.body, { expiryTs: nowSeconds() + 8 * client.DAY }));
    expect(r.status).toBe(400);
  });

  it('rejects a chunk count that does not match the byte count → 400', async () => {
    const a = await client.issueCredential();
    const r = await client.initiate(await client.initiateHeaders(a.body, { totalBytes: 1024, totalChunks: 2 }));
    expect(r.status).toBe(400);
  });

  it('availability scheduling is refused on the free tier → 403', async () => {
    const a = await client.issueCredential();
    const r = await client.initiate(await client.initiateHeaders(a.body, { availableFrom: nowSeconds() + 3600 }));
    expect(r.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Stripe webhook authentication
// ═════════════════════════════════════════════════════════════════════════════

describe('Stripe webhook authentication', () => {
  // An event type the handler acknowledges without acting on: this block tests
  // authentication only. (A subscription event makes the Worker re-fetch the
  // subscription from Stripe — Stripe-Account-1 — which a fake id can't pass.)
  const SAMPLE_EVENT = makeSubscriptionUpdatedEvent({ type: 'invoice.paid' });
  const JSON_CT = { 'Content-Type': 'application/json' };

  it('valid signed webhook → 200', async () => {
    const secret = inject('stripeWebhookSecret');   // random per run (wrangler-lifecycle.js)
    expect(secret).toMatch(/^whsec_/);
    const { body, headers } = await signStripePayload(SAMPLE_EVENT, secret);
    const res = await client.post('/webhook/stripe', body, { ...JSON_CT, ...headers });
    expect([200, 204]).toContain(res.status);
  });

  it('signed with another secret → 401', async () => {
    const { body, headers } = await signStripePayload(SAMPLE_EVENT);   // fixture's own secret
    const res = await client.post('/webhook/stripe', body, { ...JSON_CT, ...headers });
    expect(res.status).toBe(401);
  });

  it('tampered signature → 401', async () => {
    const { body, headers } = await signStripePayloadBadSig(SAMPLE_EVENT, inject('stripeWebhookSecret'));
    const res = await client.post('/webhook/stripe', body, { ...JSON_CT, ...headers });
    expect(res.status).toBe(401);
  });

  it('stale timestamp (>300s) → 401', async () => {
    const { body, headers } = await signStripePayloadStale(SAMPLE_EVENT, inject('stripeWebhookSecret'));
    const res = await client.post('/webhook/stripe', body, { ...JSON_CT, ...headers });
    expect(res.status).toBe(401);
  });

  it('missing Stripe-Signature header → 401', async () => {
    const res = await client.post('/webhook/stripe', SAMPLE_EVENT, JSON_CT);
    expect(res.status).toBe(401);
  });

  it('empty body → 401', async () => {
    const { headers } = await signStripePayloadBadSig('');
    const res = await client.post('/webhook/stripe', '', { ...JSON_CT, ...headers });
    expect(res.status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Traitor's Gate — DELETE /transfer, consumed state, tidal window
// ═════════════════════════════════════════════════════════════════════════════

const TG_PASSWORD = 'tg-test-password';

/** Password-protected upload + unlock → { uuid, bearer } */
async function uploadAndUnlock() {
  const { uuid } = await client.upload({ password: TG_PASSWORD });
  const r = await client.unlock(uuid, TG_PASSWORD);
  expect(r.status, 'unlock').toBe(200);
  return { uuid, bearer: r.body.token };
}

describe("Traitor's Gate — DELETE /transfer", () => {
  it('destroys with a valid recipient token → 200, then download → 410', async () => {
    const { uuid, bearer } = await uploadAndUnlock();
    const del = await client.deleteTransfer(uuid, bearer);
    expect(del.status).toBe(200);
    expect(del.body.destroyed).toBe(true);
    expect((await client.downloadChunk(uuid, 0, bearer)).status).toBe(410);
  });

  it('no Authorization → 401', async () => {
    const { uuid } = await uploadAndUnlock();
    expect((await client.deleteTransfer(uuid, null, { omitAuth: true })).status).toBe(401);
  });

  it("another transfer's token → 403", async () => {
    const a = await uploadAndUnlock();
    const b = await uploadAndUnlock();
    expect((await client.deleteTransfer(a.uuid, b.bearer)).status).toBe(403);
  });

  it('already consumed → 410', async () => {
    const { uuid, bearer } = await uploadAndUnlock();
    expect((await client.deleteTransfer(uuid, bearer)).status).toBe(200);
    expect((await client.deleteTransfer(uuid, bearer)).status).toBe(410);
  });
});

describe("Traitor's Gate — consumed state blocks unlock, download and meta", () => {
  let uuid, bearer;
  beforeAll(async () => {
    ({ uuid, bearer } = await uploadAndUnlock());
    expect((await client.deleteTransfer(uuid, bearer)).status).toBe(200);
  });

  it('POST /unlock after deletion → 410', async () => {
    expect((await client.unlock(uuid, TG_PASSWORD)).status).toBe(410);
  });

  it('GET /download after deletion → 410', async () => {
    expect((await client.downloadChunk(uuid, 0, bearer)).status).toBe(410);
  });

  it('GET /meta after deletion → 410 deleted, nothing else', async () => {
    const r = await client.getMeta(uuid);
    expect(r.status).toBe(410);
    expect(r.body).toEqual({ error: 'deleted' });
  });
});

describe("Traitor's Gate — tidal window enforcement on unlock", () => {
  // Free uploads can't schedule (403 above), so the window is written into the
  // stored manifest directly: this tests the receive-side gate.
  it('available_from in the future → 425', async () => {
    const { uuid } = await client.upload({ password: TG_PASSWORD });
    await client.patchManifest(uuid, m => ({ ...m, available_from_timestamp: nowSeconds() + 3600 }));
    expect((await client.unlock(uuid, TG_PASSWORD)).status).toBe(425);
  });

  it('available_until in the past → 410', async () => {
    const { uuid } = await client.upload({ password: TG_PASSWORD });
    await client.patchManifest(uuid, m => ({ ...m, available_until_timestamp: nowSeconds() - 60 }));
    expect((await client.unlock(uuid, TG_PASSWORD)).status).toBe(410);
  });
});
