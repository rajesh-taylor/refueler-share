/**
 * quota.test.js — unit tests for worker/src/quota.js
 *
 * SW-MCP-W2. Tests: lazy reset, overage metering, ceiling 402, personal_api hard
 * stop, account_cancelled paths, addOneMonth edge cases, provisionQuota, cancelQuota.
 *
 * Run: npx vitest run worker/test/quota.test.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addOneMonth,
  applyQuotaSpend,
  provisionQuota,
  cancelQuota,
  quotaSummary,
  PLAN_IDENTITY_API,
  PLAN_PERSONAL_API,
  DEFAULT_OVERAGE_CEILING,
} from '../src/quota.js';

// ── addOneMonth ────────────────────────────────────────────────────────────────

describe('addOneMonth', () => {
  it('advances a mid-month date by one calendar month', () => {
    // 15 Jan 2026 00:00:00 UTC → 15 Feb 2026 00:00:00 UTC
    const jan15 = Date.UTC(2026, 0, 15) / 1000;
    const feb15 = Date.UTC(2026, 1, 15) / 1000;
    expect(addOneMonth(jan15)).toBe(feb15);
  });

  it('clamps Jan 31 → last day of Feb (non-leap)', () => {
    const jan31 = Date.UTC(2026, 0, 31) / 1000;
    const feb28 = Date.UTC(2026, 1, 28) / 1000;
    expect(addOneMonth(jan31)).toBe(feb28);
  });

  it('clamps Jan 31 → Feb 29 on a leap year', () => {
    const jan31_2024 = Date.UTC(2024, 0, 31) / 1000;
    const feb29_2024 = Date.UTC(2024, 1, 29) / 1000;
    expect(addOneMonth(jan31_2024)).toBe(feb29_2024);
  });

  it('handles month-end to month-end: Mar 31 → Apr 30', () => {
    const mar31 = Date.UTC(2026, 2, 31) / 1000;
    const apr30 = Date.UTC(2026, 3, 30) / 1000;
    expect(addOneMonth(mar31)).toBe(apr30);
  });

  it('Dec → Jan crosses year boundary', () => {
    const dec15 = Date.UTC(2026, 11, 15) / 1000;
    const jan15 = Date.UTC(2027, 0, 15) / 1000;
    expect(addOneMonth(dec15)).toBe(jan15);
  });
});

// ── applyQuotaSpend — helpers ──────────────────────────────────────────────────

/** Build a standard active identity_api quota record. */
function makeIdentityRecord(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    plan:             PLAN_IDENTITY_API,
    allocation:       50_000,
    remaining:        50_000,
    overage_credits:  0,
    overage_ceiling:  DEFAULT_OVERAGE_CEILING,
    period_start:     now - 86400,           // started yesterday
    period_end:       now + 30 * 86400,      // ends in 30 days
    status:           'active',
    updated_at:       now - 86400,
    ...overrides,
  };
}

function makePersonalRecord(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    plan:             PLAN_PERSONAL_API,
    allocation:       10_000,
    remaining:        10_000,
    overage_credits:  0,
    overage_ceiling:  0,
    period_start:     now - 86400,
    period_end:       now + 30 * 86400,
    status:           'active',
    updated_at:       now - 86400,
    ...overrides,
  };
}

// ── applyQuotaSpend — identity_api happy paths ─────────────────────────────────

describe('applyQuotaSpend — identity_api — happy path', () => {
  const now = Math.floor(Date.now() / 1000);

  it('decrements remaining within allocation', () => {
    const record = makeIdentityRecord({ remaining: 5000 });
    const { updated, response402 } = applyQuotaSpend(record, 1, now);
    expect(response402).toBeNull();
    expect(updated.remaining).toBe(4999);
    expect(updated.overage_credits).toBe(0);
  });

  it('decrements by cost > 1', () => {
    const record = makeIdentityRecord({ remaining: 500 });
    const { updated, response402 } = applyQuotaSpend(record, 110, now);
    expect(response402).toBeNull();
    expect(updated.remaining).toBe(390);
  });

  it('sets updated_at to nowSecs', () => {
    const record = makeIdentityRecord({ remaining: 100 });
    const { updated } = applyQuotaSpend(record, 1, now);
    expect(updated.updated_at).toBe(now);
  });
});

// ── applyQuotaSpend — identity_api overage ─────────────────────────────────────

describe('applyQuotaSpend — identity_api — overage metering', () => {
  const now = Math.floor(Date.now() / 1000);

  it('meters into overage when allocation is exhausted', () => {
    const record = makeIdentityRecord({ remaining: 0, overage_credits: 100 });
    const { updated, response402 } = applyQuotaSpend(record, 1, now);
    expect(response402).toBeNull();
    expect(updated.remaining).toBe(0);
    expect(updated.overage_credits).toBe(101);
  });

  it('partial remaining spends to 0 and adds shortfall to overage', () => {
    // 3 remaining, cost 10 → remaining → 0, overage += 7
    const record = makeIdentityRecord({ remaining: 3, overage_credits: 50 });
    const { updated, response402 } = applyQuotaSpend(record, 10, now);
    expect(response402).toBeNull();
    expect(updated.remaining).toBe(0);
    expect(updated.overage_credits).toBe(57); // 50 + 7
  });

  it('returns 402 overage_ceiling when ceiling would be breached', () => {
    const record = makeIdentityRecord({
      remaining:       0,
      overage_credits: DEFAULT_OVERAGE_CEILING, // already at ceiling
      overage_ceiling: DEFAULT_OVERAGE_CEILING,
    });
    const { updated, response402 } = applyQuotaSpend(record, 1, now);
    expect(updated).toBeNull();
    expect(response402.code).toBe('overage_ceiling');
    expect(response402.remaining_credits).toBe(0);
  });

  it('allows spend that lands exactly on ceiling', () => {
    // overage_credits = ceiling - 1; cost = 1 → total = ceiling → permitted
    const record = makeIdentityRecord({
      remaining:       0,
      overage_credits: DEFAULT_OVERAGE_CEILING - 1,
      overage_ceiling: DEFAULT_OVERAGE_CEILING,
    });
    const { updated, response402 } = applyQuotaSpend(record, 1, now);
    expect(response402).toBeNull();
    expect(updated.overage_credits).toBe(DEFAULT_OVERAGE_CEILING);
  });

  it('returns 402 when one credit over the ceiling', () => {
    const record = makeIdentityRecord({
      remaining:       0,
      overage_credits: DEFAULT_OVERAGE_CEILING,
      overage_ceiling: DEFAULT_OVERAGE_CEILING,
    });
    const { updated, response402 } = applyQuotaSpend(record, 1, now);
    expect(updated).toBeNull();
    expect(response402.code).toBe('overage_ceiling');
  });
});

// ── applyQuotaSpend — personal_api ─────────────────────────────────────────────

describe('applyQuotaSpend — personal_api — hard stop', () => {
  const now = Math.floor(Date.now() / 1000);

  it('decrements within allocation', () => {
    const record = makePersonalRecord({ remaining: 500 });
    const { updated, response402 } = applyQuotaSpend(record, 1, now);
    expect(response402).toBeNull();
    expect(updated.remaining).toBe(499);
  });

  it('returns 402 quota_exhausted at hard stop', () => {
    const record = makePersonalRecord({ remaining: 0 });
    const { updated, response402 } = applyQuotaSpend(record, 1, now);
    expect(updated).toBeNull();
    expect(response402.code).toBe('quota_exhausted');
  });

  it('returns 402 when cost > remaining (no overage path)', () => {
    const record = makePersonalRecord({ remaining: 3 });
    const { updated, response402 } = applyQuotaSpend(record, 10, now);
    expect(updated).toBeNull();
    expect(response402.code).toBe('quota_exhausted');
    expect(response402.shortfall_credits).toBe(7);
  });

  it('never accrues overage_credits regardless of spend pattern', () => {
    // Confirm that even if overage_credits was somehow non-zero, a hard-stop
    // plan never increments it — it returns 402 before touching any field.
    const record = makePersonalRecord({ remaining: 0, overage_credits: 0 });
    const { updated } = applyQuotaSpend(record, 1, now);
    expect(updated).toBeNull();
  });
});

// ── applyQuotaSpend — lazy reset ───────────────────────────────────────────────

describe('applyQuotaSpend — lazy period reset', () => {
  it('resets remaining to allocation when period_end has passed', () => {
    const pastPeriodEnd = Math.floor(Date.now() / 1000) - 1;
    const now           = Math.floor(Date.now() / 1000);
    const record = makeIdentityRecord({
      remaining:    0,              // exhausted last period
      period_end:   pastPeriodEnd,
      period_start: pastPeriodEnd - 30 * 86400,
    });
    const { updated, response402 } = applyQuotaSpend(record, 1, now);
    expect(response402).toBeNull();
    // After reset, allocation = 50000; then spend 1 → remaining = 49999
    expect(updated.remaining).toBe(49_999);
  });

  it('rolls period_start and period_end forward by one month on reset', () => {
    const now = Math.floor(Date.now() / 1000);
    const oldPeriodEnd = now - 1;
    const record = makeIdentityRecord({
      remaining:  0,
      period_end: oldPeriodEnd,
    });
    const { updated } = applyQuotaSpend(record, 1, now);
    expect(updated.period_start).toBe(oldPeriodEnd);
    expect(updated.period_end).toBe(addOneMonth(oldPeriodEnd));
  });

  it('resets overage_credits to 0 on period rollover', () => {
    const now = Math.floor(Date.now() / 1000);
    const record = makeIdentityRecord({
      remaining:       0,
      overage_credits: 5000,
      period_end:      now - 1,
    });
    const { updated } = applyQuotaSpend(record, 1, now);
    expect(updated.overage_credits).toBe(0);
  });

  it('does NOT reset a cancelled account even if period has ended', () => {
    const now = Math.floor(Date.now() / 1000);
    const record = makeIdentityRecord({
      remaining:  0,
      status:     'cancelled',
      period_end: now - 1,
    });
    const { updated, response402 } = applyQuotaSpend(record, 1, now);
    expect(updated).toBeNull();
    expect(response402.code).toBe('account_cancelled');
  });
});

// ── applyQuotaSpend — cancellation ────────────────────────────────────────────

describe('applyQuotaSpend — cancellation', () => {
  it('allows spend when cancelled but period_end has not passed and remaining > 0', () => {
    const now = Math.floor(Date.now() / 1000);
    const record = makeIdentityRecord({
      remaining:  5000,
      status:     'cancelled',
      period_end: now + 10 * 86400, // still 10 days left
    });
    const { updated, response402 } = applyQuotaSpend(record, 1, now);
    expect(response402).toBeNull();
    expect(updated.remaining).toBe(4999);
  });

  it('returns 402 account_cancelled when cancelled and remaining is 0', () => {
    const now = Math.floor(Date.now() / 1000);
    const record = makeIdentityRecord({
      remaining:  0,
      status:     'cancelled',
      period_end: now + 10 * 86400,
    });
    const { updated, response402 } = applyQuotaSpend(record, 1, now);
    expect(updated).toBeNull();
    expect(response402.code).toBe('account_cancelled');
  });

  it('returns 402 account_cancelled when cancelled and period has ended', () => {
    const now = Math.floor(Date.now() / 1000);
    const record = makeIdentityRecord({
      remaining:  5000,
      status:     'cancelled',
      period_end: now - 1,
    });
    const { updated, response402 } = applyQuotaSpend(record, 1, now);
    expect(updated).toBeNull();
    expect(response402.code).toBe('account_cancelled');
  });
});

// ── provisionQuota ─────────────────────────────────────────────────────────────

describe('provisionQuota', () => {
  function makeEnv() {
    const store = {};
    return {
      STATUS_KV: {
        put: vi.fn(async (key, val) => { store[key] = val; }),
        get: vi.fn(async (key, opts) => {
          const v = store[key];
          return v ? (opts?.type === 'json' ? JSON.parse(v) : v) : null;
        }),
      },
      _store: store,
    };
  }

  it('writes identity_api record with correct allocation', async () => {
    const env = makeEnv();
    const result = await provisionQuota(env, 'api_quota_test', { plan: PLAN_IDENTITY_API });
    expect(result.ok).toBe(true);
    expect(result.record.plan).toBe(PLAN_IDENTITY_API);
    expect(result.record.allocation).toBe(50_000);
    expect(result.record.remaining).toBe(50_000);
    expect(result.record.status).toBe('active');
    expect(env.STATUS_KV.put).toHaveBeenCalledOnce();
  });

  it('writes personal_api record with correct allocation and zero overage ceiling', async () => {
    const env = makeEnv();
    const result = await provisionQuota(env, 'api_quota_test', { plan: PLAN_PERSONAL_API });
    expect(result.ok).toBe(true);
    expect(result.record.allocation).toBe(10_000);
    expect(result.record.overage_ceiling).toBe(0);
  });

  it('applies custom overage_ceiling for identity_api', async () => {
    const env = makeEnv();
    const result = await provisionQuota(env, 'api_quota_test', {
      plan:            PLAN_IDENTITY_API,
      overage_ceiling: 25_000,
    });
    expect(result.record.overage_ceiling).toBe(25_000);
  });

  it('returns error on unknown plan', async () => {
    const env = makeEnv();
    const result = await provisionQuota(env, 'api_quota_test', { plan: 'enterprise' });
    expect(result.error).toMatch(/unknown_plan/);
  });

  it('sets period_end one month after period_start when not provided', async () => {
    const env = makeEnv();
    const now = Math.floor(Date.now() / 1000);
    const result = await provisionQuota(env, 'api_quota_test', { plan: PLAN_IDENTITY_API });
    const expectedEnd = addOneMonth(result.record.period_start);
    expect(result.record.period_end).toBe(expectedEnd);
  });

  it('respects custom period_start and period_end', async () => {
    const env = makeEnv();
    const ps = 1750000000;
    const pe = 1752678400;
    const result = await provisionQuota(env, 'api_quota_test', {
      plan:         PLAN_IDENTITY_API,
      period_start: ps,
      period_end:   pe,
    });
    expect(result.record.period_start).toBe(ps);
    expect(result.record.period_end).toBe(pe);
  });
});

// ── cancelQuota ────────────────────────────────────────────────────────────────

describe('cancelQuota', () => {
  function makeEnvWithRecord(record) {
    let stored = JSON.stringify(record);
    return {
      STATUS_KV: {
        put: vi.fn(async (_k, v) => { stored = v; }),
        get: vi.fn(async (_k, opts) => opts?.type === 'json' ? JSON.parse(stored) : stored),
      },
    };
  }

  it('cancel-at-period-end: sets status to cancelled, does NOT zero remaining', async () => {
    const env = makeEnvWithRecord(makeIdentityRecord({ remaining: 5000 }));
    const result = await cancelQuota(env, 'api_quota_test', { immediate: false });
    expect(result.ok).toBe(true);
    expect(result.record.status).toBe('cancelled');
    expect(result.record.remaining).toBe(5000);
  });

  it('immediate cancel: sets status to cancelled AND zeros remaining', async () => {
    const env = makeEnvWithRecord(makeIdentityRecord({ remaining: 5000 }));
    const result = await cancelQuota(env, 'api_quota_test', { immediate: true });
    expect(result.ok).toBe(true);
    expect(result.record.status).toBe('cancelled');
    expect(result.record.remaining).toBe(0);
  });

  it('returns error on absent record', async () => {
    const env = {
      STATUS_KV: { get: vi.fn(async () => null), put: vi.fn() },
    };
    const result = await cancelQuota(env, 'api_quota_test');
    expect(result.error).toBe('record_absent');
  });

  it('is idempotent on already-cancelled record', async () => {
    const env = makeEnvWithRecord(makeIdentityRecord({ status: 'cancelled', remaining: 0 }));
    const result = await cancelQuota(env, 'api_quota_test');
    expect(result.ok).toBe(true);
    expect(result.already_cancelled).toBe(true);
    expect(env.STATUS_KV.put).not.toHaveBeenCalled();
  });
});

// ── quotaSummary ───────────────────────────────────────────────────────────────

describe('quotaSummary', () => {
  it('returns zeroed summary for null record', () => {
    const s = quotaSummary(null);
    expect(s.plan).toBeNull();
    expect(s.remaining_credits).toBe(0);
    expect(s.allocation_credits).toBe(0);
    expect(s.period_end).toBeNull();
  });

  it('includes overage fields for identity_api', () => {
    const now = Math.floor(Date.now() / 1000);
    const record = makeIdentityRecord({ remaining: 1000, overage_credits: 50 });
    const s = quotaSummary(record);
    expect(s.overage_credits).toBe(50);
    expect(s.overage_ceiling).toBe(DEFAULT_OVERAGE_CEILING);
    expect(s.remaining_credits).toBe(1000);
  });

  it('omits overage fields for personal_api', () => {
    const record = makePersonalRecord({ remaining: 500 });
    const s = quotaSummary(record);
    expect(s).not.toHaveProperty('overage_credits');
    expect(s).not.toHaveProperty('overage_ceiling');
  });

  it('passes through status', () => {
    const record = makeIdentityRecord({ status: 'cancelled' });
    expect(quotaSummary(record).status).toBe('cancelled');
  });
});
