// Pure ESM. No vitest/node imports. Importable by both Vitest and k6.

/**
 * Returns a structurally-valid NUT-00 credential shape for tests
 * that only need to inspect credential fields, not verify crypto.
 * For full BDHKE round-trips use the real client.issueCredential().
 */
export function mockCredential(uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee') {
  return {
    uuid,
    C_: '02' + 'ab'.repeat(32),  // 33-byte compressed point, hex
    tier: 'free',
    issued_at: Date.now(),
  };
}

export function expiredCredential(uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee') {
  return {
    uuid,
    C_: '02' + 'cd'.repeat(32),
    tier: 'free',
    issued_at: Date.now() - 86_400_000, // 24h ago
  };
}

export function malformedCredential() {
  return { uuid: 'not-a-uuid', C_: 'zzzz', tier: 'free' };
}


//
