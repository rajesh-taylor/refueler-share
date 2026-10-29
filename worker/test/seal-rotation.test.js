// H6 Accounts-Mac-1 (29 Oct 2026) — SHARE_SEAL_KEY_<kid> rotation, as the runbook
// does it: put SHARE_SEAL_KEY_2, then flip SHARE_SEAL_CURRENT to "2", keep _1 until
// the last _1-sealed manifest has expired (≤ 92 days, the R2 backstop), then delete _1.
//
//   • before the flip: new writes still use _1 (adding _2 alone changes nothing)
//   • after the flip: _1 fields (cref_ct, qref_ct) still open; new writes are k = "2"
//   • flip before the secret is put → seal fails closed (callers 503), never a fallback
//   • _1 deleted too early → _1 fields open to null (fail closed), _2 fields still open
//   • the kid is bound into the AAD: relabelling k on a stored field never opens it
//   • the latch's hold release (openQref) works across the flip

import { describe, it, expect } from 'vitest';
import { sealCref, openCref, sealQref, openQref } from '../src/seal.js';

const b64 = (start) => btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => start + i)));
const KEY_1 = b64(0x00);
const KEY_2 = b64(0x40);

const UUID = '00112233-4455-6677-8899-aabbccddeeff';
const ORG  = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const QREF = 'ab'.repeat(32);
const SESS = 'cd'.repeat(32);

const before  = { SHARE_SEAL_CURRENT: '1', SHARE_SEAL_KEY_1: KEY_1 };
const added   = { SHARE_SEAL_CURRENT: '1', SHARE_SEAL_KEY_1: KEY_1, SHARE_SEAL_KEY_2: KEY_2 };
const flipped = { SHARE_SEAL_CURRENT: '2', SHARE_SEAL_KEY_1: KEY_1, SHARE_SEAL_KEY_2: KEY_2 };
const retired = { SHARE_SEAL_CURRENT: '2', SHARE_SEAL_KEY_2: KEY_2 };

describe('SHARE_SEAL_KEY rotation (runbook, H6)', () => {
  it('step 1 — putting _2 alone changes nothing: writes stay k = "1"', async () => {
    const c = await sealCref(added, UUID, ORG, 'INV-1');
    expect(c.k).toBe('1');
    expect(await openCref(before, UUID, c)).toEqual({ org: ORG, transferRef: 'INV-1' });
  });

  it('step 2 — after the flip, old _1 fields still open and new writes are k = "2"', async () => {
    const oldC = await sealCref(before, UUID, ORG, 'INV-1');
    const oldQ = await sealQref(before, UUID, QREF, SESS);
    expect(await openCref(flipped, UUID, oldC)).toEqual({ org: ORG, transferRef: 'INV-1' });
    expect(await openQref(flipped, UUID, oldQ)).toEqual({ quotaRef: QREF, sessionHash: SESS });

    const newC = await sealCref(flipped, UUID, ORG, 'INV-2');
    const newQ = await sealQref(flipped, UUID, QREF, SESS);
    expect(newC.k).toBe('2');
    expect(newQ.k).toBe('2');
    expect(await openCref(flipped, UUID, newC)).toEqual({ org: ORG, transferRef: 'INV-2' });
    expect(await openQref(flipped, UUID, newQ)).toEqual({ quotaRef: QREF, sessionHash: SESS });
    // A Worker still on the old config (rollback) cannot open k = "2" fields.
    expect(await openCref(before, UUID, newC)).toBeNull();
  });

  it('flip before the secret is put → seal fails closed, no fallback to _1', async () => {
    const early = { SHARE_SEAL_CURRENT: '2', SHARE_SEAL_KEY_1: KEY_1 };
    expect(await sealCref(early, UUID, ORG, null)).toBeNull();
    expect(await sealQref(early, UUID, QREF, SESS)).toBeNull();
  });

  it('step 3 — _1 deleted: _2 fields open, any _1 field left opens to null', async () => {
    const oldQ = await sealQref(before, UUID, QREF, SESS);
    const newQ = await sealQref(flipped, UUID, QREF, SESS);
    expect(await openQref(retired, UUID, newQ)).toEqual({ quotaRef: QREF, sessionHash: SESS });
    expect(await openQref(retired, UUID, oldQ)).toBeNull();
  });

  it('the kid is in the AAD: relabelling k never opens a field', async () => {
    const newC = await sealCref(flipped, UUID, ORG, null);
    const oldC = await sealCref(before, UUID, ORG, null);
    expect(await openCref(flipped, UUID, { ...newC, k: '1' })).toBeNull();
    expect(await openCref(flipped, UUID, { ...oldC, k: '2' })).toBeNull();
  });

  it('a different key under the same kid does not open (no silent re-key of _1)', async () => {
    const oldC = await sealCref(before, UUID, ORG, null);
    const wrong = { SHARE_SEAL_CURRENT: '2', SHARE_SEAL_KEY_1: KEY_2, SHARE_SEAL_KEY_2: KEY_2 };
    expect(await openCref(wrong, UUID, oldC)).toBeNull();
  });
});
