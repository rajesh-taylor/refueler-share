/**
 * stripe_account_1.test.js — Stripe-Account-1 (27 Oct 2026)
 *
 * The consumer wire tier is 'citizen'. Old names ('max', 'creative') are read
 * through tiers.js storedTier only — stored values written before the deploy
 * (R2 manifests, Execution Dock KV, Analytics Engine labels). Remove the legacy
 * map, and this file's legacy cases, on/after 26 Jan 2027.
 */

import { describe, it, expect } from 'vitest';
import { CITIZEN, storedTier } from '../src/tiers.js';
import { TIER_CAPS } from '../src/manifest.js';
import { isTidalPermitted } from '../src/manifest_tg.js';

describe('Stripe-Account-1 — wire tier citizen', () => {
  it('the Citizen wire value is citizen and carries the 100 GiB cap', () => {
    expect(CITIZEN).toBe('citizen');
    expect(TIER_CAPS[CITIZEN]).toBe(100 * 1024 * 1024 * 1024);
  });

  it('storedTier folds the two old names into citizen, nothing else', () => {
    expect(storedTier('max')).toBe('citizen');
    expect(storedTier('creative')).toBe('citizen');
    for (const t of ['free', 'citizen', 'api', 'sandbox', 'rate_limited', '', null, undefined]) {
      expect(storedTier(t)).toBe(t);
    }
  });

  it('storedTier never resolves through the prototype', () => {
    expect(storedTier('toString')).toBe('toString');
    expect(storedTier('__proto__')).toBe('__proto__');
  });

  it('a live gate never accepts an old name (storedTier is for reads of stored values only)', () => {
    expect(isTidalPermitted('max')).toBe(false);
    expect(TIER_CAPS.max).toBeUndefined();
  });
});
