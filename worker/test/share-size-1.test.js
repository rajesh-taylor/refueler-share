// Share-Size-1 — receipts carry size_bytes: null (the Worker no longer stores the size).
// The key stays in the receipt schema (v2 since API-Repair-1); a missing size must never become 0.

import { describe, it, expect } from 'vitest';
import { buildSignedReceipt } from '../src/receipts.js';

const whsec = 'rfs_whsec_test_share_size_1';
const base = {
  receipt_type: 'collection', event: 'cargo.discharged',
  org_account_id: '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c', uuid: '0f8fad5b-d9cb-469f-a165-70867728950e',
  transfer_ref: null, chunk_count: 4, issued_at: 1791300000,
};

describe('Share-Size-1 — receipt size_bytes', () => {
  it('size_bytes is always null in the signed receipt (key kept, never 0, never a passed value)', async () => {
    const { receipt, sig } = await buildSignedReceipt(whsec, { ...base, size_bytes: 123 });
    expect('size_bytes' in receipt).toBe(true);
    expect(receipt.size_bytes).toBeNull();
    expect(receipt.chunk_count).toBe(4);
    expect(typeof sig).toBe('string');
  });

  it('size_bytes omitted → null', async () => {
    const { receipt } = await buildSignedReceipt(whsec, base);
    expect(receipt.size_bytes).toBeNull();
  });
});
