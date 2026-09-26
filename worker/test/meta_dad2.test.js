// Share-DAD-2 — GET /meta/:uuid on a deleted transfer.
//   • live transfer        → 200 with size / expiry / chunk count (unchanged)
//   • tombstone            → 410 { error: 'deleted' } and nothing else
//   • deletion in progress → 410 too (consumed guard written, tombstone not yet)
// All env is in-memory (test/_r2_mock.js). No network.

import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { makeBucket, makeKV } from './_r2_mock.js';

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const NOW  = Math.floor(Date.now() / 1000);
const ctx  = { waitUntil() {}, passThroughOnException() {} };

async function meta(manifest) {
  const env = {
    BUCKET:    makeBucket({ [`${UUID}/manifest.json`]: { uploaded: NOW, body: JSON.stringify(manifest) } }),
    STATUS_KV: makeKV(),
  };
  const res = await worker.fetch(new Request(`https://api.share.test/meta/${UUID}`), env, ctx);
  return { status: res.status, body: await res.json() };
}

const live = { uuid: UUID, total_chunks: 2, total_bytes: 1234, expiry_timestamp: NOW + 86400, file_name: 'encrypted-payload' };

describe('GET /meta — deleted transfers (Share-DAD-2)', () => {
  it('live transfer: 200 with metadata', async () => {
    const { status, body } = await meta(live);
    expect(status).toBe(200);
    expect(body.total_bytes).toBe(1234);
    expect(body.total_chunks).toBe(2);
  });

  it('tombstone: 410 deleted, no metadata', async () => {
    const { status, body } = await meta({ consumed: true, consumed_at: NOW });
    expect(status).toBe(410);
    expect(body).toEqual({ error: 'deleted' });
  });

  it('deletion in progress: 410, size and expiry not leaked', async () => {
    const { status, body } = await meta({ ...live, consumed: true, consumed_at: NOW });
    expect(status).toBe(410);
    expect(body).toEqual({ error: 'deleted' });
  });
});
