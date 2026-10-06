// Share-Size-1 — receipts carry size_bytes: null (the Worker no longer stores the size).
// The key stays in the v1 receipt schema; a missing size must never become 0.

import { describe, it, expect } from 'vitest';
import { buildSignedReceipt } from '../src/receipts.js';

const env = { WEBHOOK_SIGNING_MASTER_KEY: 'test-master-key-share-size-1' };
const base = {
  receipt_type: 'collection', event: 'cargo.discharged',
  live_key: 'rfs_test_size1', uuid: '0f8fad5b-d9cb-469f-a165-70867728950e',
  transfer_ref: null, chunk_count: 4, issued_at: 1791300000, wh_created_at: 1791000000,
};

describe('Share-Size-1 — receipt size_bytes', () => {
  it('size_bytes null → null in the signed receipt (key kept, never 0)', async () => {
    const { receipt, sig } = await buildSignedReceipt(env, { ...base, size_bytes: null });
    expect('size_bytes' in receipt).toBe(true);
    expect(receipt.size_bytes).toBeNull();
    expect(receipt.chunk_count).toBe(4);
    expect(typeof sig).toBe('string');
  });

  it('size_bytes omitted → null', async () => {
    const { receipt } = await buildSignedReceipt(env, base);
    expect(receipt.size_bytes).toBeNull();
  });
});
