/**
 * worker/tests/integration/tg-round-trip.test.js
 * Traitor's Gate end to end against wrangler dev --local: destroy-after-download
 * (the last part served destroys the transfer), POST /confirm, owner DELETE, DELETE auth boundaries, tidal windows on download.
 *
 * Rewritten Integration-Repair-1 (28 Oct 2026) for the Share-6 upload and
 * X-Transfer-UUID / X-Part (UUID-Out-Of-Path-1). Scheduling at upload needs a
 * paid Citizen session (refused on free: security.test.js), so the tidal
 * windows here are written into the stored manifest and the download gate is
 * what's tested; Citizen acceptance is unit-tested in test/.
 */

import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import * as client from './client.js';

beforeAll(() => client.init({ workerUrl: inject('workerUrl'), persistDir: inject('persistDir'), envFile: inject('envFile') }));
afterAll(() => client.close());

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Poll /meta until the transfer is gone (DAD destruction runs in waitUntil). */
async function waitForDestroyed(uuid, tries = 30) {
  for (let i = 0; i < tries; i++) {
    if ((await client.getMeta(uuid)).status === 410) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Destroy-after-download — open transfer
//    Serving the last part destroys the transfer (Share-B11-1, Share-DAD-2);
//    POST /confirm is only a recipient's early or late knock.
// ─────────────────────────────────────────────────────────────────────────────

describe('TG: destroy-after-download (open transfer)', () => {
  let uuid;
  beforeAll(async () => { ({ uuid } = await client.upload({ destroyAfterDownload: true, totalBytes: client.CHUNK_SIZE + 10 })); });

  it('armed after upload: pending_destruction false', async () => {
    expect((await client.getMeta(uuid)).body.pending_destruction).toBe(false);
  });

  it('POST /confirm before the last part is served → 409, no side effects', async () => {
    expect((await client.confirmTransfer(uuid)).status).toBe(409);
    expect((await client.getMeta(uuid)).status).toBe(200);
  });

  it('serving a part that is not the last leaves it in place', async () => {
    expect((await client.downloadChunk(uuid, 0)).status).toBe(200);
    expect((await client.getMeta(uuid)).status).toBe(200);
  });

  it('serving the last part destroys the transfer', async () => {
    expect((await client.downloadChunk(uuid, 1)).status).toBe(200);
    expect(await waitForDestroyed(uuid)).toBe(true);
  });

  it('afterwards: every part 410, confirm 410', async () => {
    for (const i of [0, 1]) expect((await client.downloadChunk(uuid, i)).status).toBe(410);
    expect((await client.confirmTransfer(uuid)).status).toBe(410);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Destroy-after-download — password-protected
// ─────────────────────────────────────────────────────────────────────────────

describe('TG: destroy-after-download (password-protected)', () => {
  const PASSWORD = 'correct-horse-traitors-gate';
  let uuid, bearer;
  beforeAll(async () => {
    ({ uuid } = await client.upload({ destroyAfterDownload: true, password: PASSWORD }));
    bearer = (await client.unlock(uuid, PASSWORD)).body.token;
  });

  it('POST /confirm without a token → 401', async () => {
    expect((await client.confirmTransfer(uuid)).status).toBe(401);
  });

  it("POST /confirm with another transfer's token → 403", async () => {
    const other = await client.upload({ password: PASSWORD });
    const otherBearer = (await client.unlock(other.uuid, PASSWORD)).body.token;
    expect((await client.confirmTransfer(uuid, otherBearer)).status).toBe(403);
  });

  it('POST /confirm with the token, before download → 409', async () => {
    expect((await client.confirmTransfer(uuid, bearer)).status).toBe(409);
  });

  it('download with the token → 200, and the transfer is destroyed', async () => {
    expect((await client.downloadChunk(uuid, 0, bearer)).status).toBe(200);
    expect(await waitForDestroyed(uuid)).toBe(true);
  });

  it('POST /unlock after deletion → 410', async () => {
    expect((await client.unlock(uuid, PASSWORD)).status).toBe(410);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. POST /confirm on transfers it doesn't apply to
// ─────────────────────────────────────────────────────────────────────────────

describe('TG: POST /confirm edge cases', () => {
  it('not a destroy-after-download transfer → 200 destroyed: false, still downloadable', async () => {
    const { uuid } = await client.upload();
    const r = await client.confirmTransfer(uuid);
    expect(r.status).toBe(200);
    expect(r.body.destroyed).toBe(false);
    expect((await client.downloadChunk(uuid, 0)).status).toBe(200);
  });

  it('non-existent transfer → 404', async () => {
    expect((await client.confirmTransfer(crypto.randomUUID())).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Owner DELETE (rfs_owner_ bearer + X-Admin-Key)
// ─────────────────────────────────────────────────────────────────────────────

describe('TG: owner DELETE (X-Admin-Key)', () => {
  let uuid;
  beforeAll(async () => { ({ uuid } = await client.upload({ totalBytes: client.CHUNK_SIZE + 10 })); });

  it('wrong X-Admin-Key → 401, transfer untouched', async () => {
    expect((await client.ownerDeleteTransfer(uuid, { badKey: true })).status).toBe(401);
    expect((await client.downloadChunk(uuid, 1)).status).toBe(200);
  });

  it('with the admin key → 200 destroyed, consumed_at set', async () => {
    const r = await client.ownerDeleteTransfer(uuid, { adminKey: inject('adminKey') });
    expect(r.status).toBe(200);
    expect(r.body.destroyed).toBe(true);
    expect(r.body.consumed_at).toBeTypeOf('number');
  });

  it('every part → 410 after deletion (tombstone gate holds)', async () => {
    for (const i of [0, 1]) expect((await client.downloadChunk(uuid, i)).status).toBe(410);
  });

  it('second owner DELETE → 410', async () => {
    expect((await client.ownerDeleteTransfer(uuid, { adminKey: inject('adminKey') })).status).toBe(410);
  });

  it('non-existent transfer → 404', async () => {
    expect((await client.ownerDeleteTransfer(crypto.randomUUID(), { adminKey: inject('adminKey') })).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Tidal windows on download
// ─────────────────────────────────────────────────────────────────────────────

describe('TG: tidal windows on GET /download', () => {
  async function withWindow(window) {
    const { uuid } = await client.upload();
    await client.patchManifest(uuid, m => ({ ...m, ...window }));
    return uuid;
  }

  it('before available_from → 425', async () => {
    const uuid = await withWindow({ available_from_timestamp: nowSeconds() + 3600 });
    expect((await client.downloadChunk(uuid, 0)).status).toBe(425);
  });

  it('after available_from → 200', async () => {
    const uuid = await withWindow({ available_from_timestamp: nowSeconds() - 60 });
    expect((await client.downloadChunk(uuid, 0)).status).toBe(200);
  });

  it('inside available_until → 200', async () => {
    const uuid = await withWindow({ available_until_timestamp: nowSeconds() + 3600 });
    expect((await client.downloadChunk(uuid, 0)).status).toBe(200);
  });

  it('after available_until → 410', async () => {
    const uuid = await withWindow({ available_until_timestamp: nowSeconds() - 60 });
    expect((await client.downloadChunk(uuid, 0)).status).toBe(410);
  });

  it('inside both bounds → 200; before the start of both → 425', async () => {
    const open = await withWindow({ available_from_timestamp: nowSeconds() - 60, available_until_timestamp: nowSeconds() + 3600 });
    expect((await client.downloadChunk(open, 0)).status).toBe(200);
    const early = await withWindow({ available_from_timestamp: nowSeconds() + 3600, available_until_timestamp: nowSeconds() + 7200 });
    expect((await client.downloadChunk(early, 0)).status).toBe(425);
  });

  it('meta reports the window', async () => {
    const from = nowSeconds() + 3600;
    const uuid = await withWindow({ available_from_timestamp: from });
    expect((await client.getMeta(uuid)).body.available_from_timestamp).toBe(from);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. DELETE auth boundaries
// ─────────────────────────────────────────────────────────────────────────────

describe('TG: DELETE auth boundaries', () => {
  it('no Authorization header → 401', async () => {
    const { uuid } = await client.upload();
    expect((await client.deleteTransfer(uuid, null, { omitAuth: true })).status).toBe(401);
  });

  it('a made-up bearer → 403, transfer untouched', async () => {
    const { uuid } = await client.upload();
    expect((await client.deleteTransfer(uuid, 'not-a-real-token')).status).toBe(403);
    expect((await client.downloadChunk(uuid, 0)).status).toBe(200);
  });

  it('owner bearer without X-Admin-Key → 401', async () => {
    const { uuid } = await client.upload();
    const r = await client.request('DELETE', '/transfer', {
      headers: { 'X-Transfer-UUID': uuid, Authorization: 'Bearer rfs_owner_executiondock' },
    });
    expect(r.status).toBe(401);
  });
});
