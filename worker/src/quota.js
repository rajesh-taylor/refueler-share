/**
 * quota.js — Monthly credit allocation for API-tier credential issuance
 *
 * SW-MCP-W2. Extracted from handleApiCredentialIssue in index.js.
 *
 * KV key: api_quota_{ sha256hex(rfs_live_key) }  (kvQuotaKey() from api_auth.js)
 *
 * Schema:
 * {
 *   plan:             "identity_api" | "personal_api",
 *   allocation:       number,   // monthly included credits (50000 | 10000)
 *   remaining:        number,   // decremented per issue; reset to allocation at rollover
 *   overage_credits:  number,   // credits spent above allocation this period (identity_api only)
 *   overage_ceiling:  number,   // hard abuse ceiling per period (identity_api only; per-client at onboarding)
 *   period_start:     number,   // unix secs — current period opened
 *   period_end:       number,   // unix secs — next reset boundary (billing anniversary)
 *   status:           "active" | "cancelled",
 *   updated_at:       number,   // unix secs
 * }
 *
 * Two plans:
 *   identity_api  — £99/mo, 50 000 credits/mo, metered overage up to overage_ceiling (default 50 000)
 *   personal_api  — £49/mo, 10 000 credits/mo, hard stop at allocation (no overage)
 *
 * Reset: LAZY — triggered on the next credential/issue call after period_end passes.
 *   Unused credits expire. No rollover. No cron required.
 *
 * Cancellation (two flavours):
 *   cancel-at-period-end (default): status → "cancelled", remaining untouched until period_end,
 *     then remaining → 0, no allocation on next issue.
 *   immediate (admin-initiated): status → "cancelled", remaining → 0 at once.
 *
 * Transfers already issued persist to their own expiry_timestamp regardless of
 * account status — policy enforced at the manifest/transfer layer, not here.
 *
 * Do-not-retry:
 *   - Never write overage_credits or overage_ceiling for personal_api plan — hard stop only.
 *   - Never roll the period for a cancelled account — return 402 account_cancelled immediately.
 *   - KV is last-write-wins; the race-critical double-spend path remains in Supabase (unchanged).
 *   - Never use Durable Objects / D1 / Queues — KV + ctx.waitUntil only.
 */

// ── Plan constants ─────────────────────────────────────────────────────────────

export const PLAN_IDENTITY_API = 'identity_api';
export const PLAN_PERSONAL_API = 'personal_api';

const PLAN_DEFAULTS = {
  [PLAN_IDENTITY_API]: { allocation: 50_000 },
  [PLAN_PERSONAL_API]: { allocation: 10_000 },
};

// Default overage ceiling for identity_api (per-client at onboarding; this is the fallback).
export const DEFAULT_OVERAGE_CEILING = 50_000;

// ── Month arithmetic ───────────────────────────────────────────────────────────

/**
 * addOneMonth(unixSecs) → unix secs
 *
 * Advances a Unix timestamp by one calendar month on the billing anniversary.
 * Handles month-length edge cases: 31 Jan → 28/29 Feb → last day of Feb.
 * Uses UTC throughout — no timezone dependency.
 */
export function addOneMonth(unixSecs) {
  const d = new Date(unixSecs * 1000);
  const originalDay = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 1);
  // If the day overflowed (e.g. Jan 31 → Mar 3), clamp back to last day of target month.
  if (d.getUTCDate() !== originalDay) {
    d.setUTCDate(0); // last day of previous month (which is the target month)
  }
  return Math.floor(d.getTime() / 1000);
}

// ── Core: load + apply spend ───────────────────────────────────────────────────

/**
 * loadQuota(env, quotaKey) → { record } | { error, status, code }
 *
 * Reads the quota record from KV. Returns { error } shape if the key is absent
 * or unreadable — callers translate to the appropriate HTTP response.
 */
export async function loadQuota(env, quotaKey) {
  let record;
  try {
    record = await env.STATUS_KV.get(quotaKey, { type: 'json' });
  } catch (e) {
    console.error('quota: KV read failed:', e);
    return { error: 'kv_read_failed', status: 502, code: 'quota_check_unavailable' };
  }

  if (!record) {
    // Key absent: the account was provisioned without a quota record (shouldn't
    // happen in production after onboarding, but must not blow up silently).
    console.error('quota: record absent for key:', quotaKey);
    return { error: 'record_absent', status: 402, code: 'quota_not_provisioned' };
  }

  return { record };
}

/**
 * applyQuotaSpend(record, cost, nowSecs) → { updated, response402 }
 *
 * Pure function — does not touch KV. Returns:
 *   { updated: <mutated record>, response402: null }  — spend permitted; caller must write updated to KV.
 *   { updated: null, response402: { code, shortfall_credits?, ... } }  — spend blocked; caller returns 402.
 *
 * Lazy period reset is applied first if now >= period_end AND account is active.
 *
 * @param {object} record   — the raw KV quota record
 * @param {number} cost     — credits this issuance costs (always 1 for v1 credential/issue)
 * @param {number} nowSecs  — current unix timestamp in seconds
 */
export function applyQuotaSpend(record, cost, nowSecs) {
  const plan = record.plan ?? PLAN_IDENTITY_API;

  // ── Cancellation gate ──────────────────────────────────────────────────────
  // Check BEFORE lazy reset: a cancelled account whose period has ended must not
  // be revived by the reset logic.
  if (record.status === 'cancelled') {
    // Cancel-at-period-end: if period has not yet ended, remaining credits are
    // still valid — allow spend. Once the period ends, no reset → hard stop.
    if (nowSecs >= record.period_end || record.remaining <= 0) {
      return {
        updated: null,
        response402: {
          code:              'account_cancelled',
          shortfall_credits: cost,
        },
      };
    }
    // Period still running — fall through to spend logic (no reset for cancelled).
  }

  // ── Lazy period reset (active accounts only) ───────────────────────────────
  let mutated = { ...record };
  if (record.status !== 'cancelled' && nowSecs >= record.period_end) {
    mutated = {
      ...mutated,
      remaining:       mutated.allocation,
      overage_credits: 0,                      // personal_api: field ignored but harmless to reset
      period_start:    mutated.period_end,
      period_end:      addOneMonth(mutated.period_end),
    };
  }

  // ── Spend logic ────────────────────────────────────────────────────────────
  if (plan === PLAN_PERSONAL_API) {
    // Hard stop — no overage ever.
    if (mutated.remaining < cost) {
      return {
        updated: null,
        response402: {
          code:              'quota_exhausted',
          shortfall_credits: cost - mutated.remaining,
          remaining_credits: mutated.remaining,
        },
      };
    }
    mutated = { ...mutated, remaining: mutated.remaining - cost, updated_at: nowSecs };
    return { updated: mutated, response402: null };
  }

  // identity_api — metered overage up to ceiling.
  if (mutated.remaining >= cost) {
    // Happy path: still within allocation.
    mutated = { ...mutated, remaining: mutated.remaining - cost, updated_at: nowSecs };
    return { updated: mutated, response402: null };
  }

  // Allocation exhausted — meter into overage.
  const shortfall       = cost - mutated.remaining;
  const newOverage      = (mutated.overage_credits ?? 0) + shortfall;
  const overageCeiling  = mutated.overage_ceiling ?? DEFAULT_OVERAGE_CEILING;

  if (newOverage > overageCeiling) {
    return {
      updated: null,
      response402: {
        code:              'overage_ceiling',
        remaining_credits: 0,
        overage_credits:   mutated.overage_credits ?? 0,
        overage_ceiling:   overageCeiling,
        shortfall_credits: shortfall,
      },
    };
  }

  // Within ceiling — spend the remainder of allocation to 0 and add to overage.
  mutated = {
    ...mutated,
    remaining:       0,
    overage_credits: newOverage,
    updated_at:      nowSecs,
  };
  return { updated: mutated, response402: null };
}

// ── Admin: provision ───────────────────────────────────────────────────────────

/**
 * provisionQuota(env, quotaKey, opts) → { ok } | { error }
 *
 * Writes a fresh quota record to KV. Called at API onboarding (POST /api/v1/admin/quota/provision).
 * Overwrites any existing record — idempotent (re-provision resets the period).
 *
 * @param {object} opts
 *   plan             — "identity_api" | "personal_api"
 *   overage_ceiling  — number (identity_api only; ignored for personal_api)
 *   period_start     — unix secs (defaults to now)
 *   period_end       — unix secs (defaults to now + 1 month)
 */
export async function provisionQuota(env, quotaKey, opts) {
  const {
    plan            = PLAN_IDENTITY_API,
    overage_ceiling = DEFAULT_OVERAGE_CEILING,
    period_start,
    period_end,
  } = opts;

  if (!PLAN_DEFAULTS[plan]) {
    return { error: `unknown_plan: ${plan}` };
  }

  const { allocation } = PLAN_DEFAULTS[plan];
  const nowSecs        = Math.floor(Date.now() / 1000);
  const ps             = period_start ?? nowSecs;
  const pe             = period_end   ?? addOneMonth(ps);

  const record = {
    plan,
    allocation,
    remaining:       allocation,
    overage_credits: 0,
    overage_ceiling: plan === PLAN_PERSONAL_API ? 0 : overage_ceiling,
    period_start:    ps,
    period_end:      pe,
    status:          'active',
    updated_at:      nowSecs,
  };

  try {
    await env.STATUS_KV.put(quotaKey, JSON.stringify(record));
    return { ok: true, record };
  } catch (e) {
    console.error('quota: provision KV write failed:', e);
    return { error: 'kv_write_failed' };
  }
}

// ── Admin: cancel ──────────────────────────────────────────────────────────────

/**
 * cancelQuota(env, quotaKey, { immediate }) → { ok } | { error }
 *
 * Two flavours (locked spec §7.4):
 *   immediate: false (default) — cancel-at-period-end.
 *     Sets status → "cancelled". Does NOT zero remaining.
 *     Credits continue to work until period_end; no reset after that.
 *   immediate: true — admin-initiated (abuse / refund).
 *     Sets status → "cancelled" AND remaining → 0 at once.
 *     Next credential/issue returns 402 account_cancelled immediately.
 *
 * Already-cancelled accounts: idempotent (no-op, returns ok).
 */
export async function cancelQuota(env, quotaKey, { immediate = false } = {}) {
  let record;
  try {
    record = await env.STATUS_KV.get(quotaKey, { type: 'json' });
  } catch (e) {
    console.error('quota: cancel KV read failed:', e);
    return { error: 'kv_read_failed' };
  }

  if (!record) return { error: 'record_absent' };
  if (record.status === 'cancelled') return { ok: true, already_cancelled: true };

  const nowSecs = Math.floor(Date.now() / 1000);
  const updated = {
    ...record,
    status:     'cancelled',
    updated_at: nowSecs,
    ...(immediate ? { remaining: 0 } : {}),
  };

  try {
    await env.STATUS_KV.put(quotaKey, JSON.stringify(updated));
    return { ok: true, record: updated };
  } catch (e) {
    console.error('quota: cancel KV write failed:', e);
    return { error: 'kv_write_failed' };
  }
}

// ── Quota summary (for auth/ping response) ─────────────────────────────────────

/**
 * quotaSummary(record) → object
 *
 * Returns the subset of quota fields that auth/ping and refueler_balance expose.
 * personal_api: omits overage fields (hard stop — no overage concept).
 * Null-safe: returns zeroed summary if record is absent.
 */
export function quotaSummary(record) {
  if (!record) {
    return {
      plan:              null,
      allocation_credits: 0,
      remaining_credits:  0,
      period_end:         null,
    };
  }

  const base = {
    plan:               record.plan,
    allocation_credits: record.allocation,
    remaining_credits:  record.remaining,
    period_end:         record.period_end,
    status:             record.status,
  };

  if (record.plan === PLAN_IDENTITY_API) {
    base.overage_credits  = record.overage_credits  ?? 0;
    base.overage_ceiling  = record.overage_ceiling  ?? DEFAULT_OVERAGE_CEILING;
  }

  return base;
}
