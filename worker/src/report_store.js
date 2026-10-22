// ─────────────────────────────────────────────────────────────────────────────
// report_store.js — the report register in Supabase (OSA-Tools-1 · 22 Oct 2026)
//
// Design: private docs/OSA-Tools-plan-v1.md §4–§5. SQL:
// supabase/migrations/20261022_osa_tools_1_reports.sql. Never KV.
//
// The fields are checked here first so the caller gets a plain error code; the
// database CHECKs are the guarantee behind them (no '@', '#' or 'http' in free
// text, fixed lists, uuid8 only — never the full transfer ID, an email or the
// key part after the #). Any Supabase failure throws StoreUnavailable.
// ─────────────────────────────────────────────────────────────────────────────

import { rpc } from './api_store.js';

export const REPORT_ROUTES     = ['report@', 'support@', 'privacy@', 'signal', 'other'];
export const REPORT_CATEGORIES = ['csea', 'terrorism', 'iia', 'extreme_porn', 'fraud',
                                  'other_illegal', 'terms', 'complaint', 'appeal', 'no_link'];
export const REPORT_DECISIONS  = ['open', 'removed', 'not_removed', 'already_gone', 'manifestly_unfounded'];
export const REPORTER_TOLD     = ['y', 'n', 'no_contact'];
/** Categories a helper may act on (plan §2). */
export const HELPER_CATEGORIES = ['csea', 'terrorism'];

export const CASE_REF_RE = /^[RT]-\d{4}-\d{3,4}$/;
const UUID8_RE   = /^[0-9a-f]{8}$/;
const NCA_REF_RE = /^[A-Za-z0-9-]{0,64}$/;
const FORBIDDEN  = /@|#|http/i;
const EARLIEST   = 1767225600;   // 1 Jan 2026 UTC — same floor as report_open()
export const REASON_MAX = 500;

const isInt = (v) => Number.isSafeInteger(v);

/** null when ok, else an error code. Free text: ≤ 500, no '@', '#' or 'http'. */
function checkReason(v) {
  if (v === null) return null;
  if (typeof v !== 'string' || v.length > REASON_MAX) return 'bad_reason';
  return FORBIDDEN.test(v) ? 'reason_forbidden' : null;
}

/**
 * Validate a "New report" body → { ok: true, args } | { ok: false, code }.
 * Keys: training (bool, required), received_at (unix s, default now), route,
 * category, uuid8 (or null), reason (or null). Anything else is refused.
 */
export function parseOpen(body, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, code: 'bad_body' };
  const allowed = ['training', 'received_at', 'route', 'category', 'uuid8', 'reason'];
  if (Object.keys(body).some((k) => !allowed.includes(k))) return { ok: false, code: 'unknown_field' };
  const { training, route, category } = body;
  const receivedAt = body.received_at ?? now;
  const uuid8  = body.uuid8 ?? null;
  const reason = body.reason ?? null;
  if (typeof training !== 'boolean') return { ok: false, code: 'bad_training' };
  if (!isInt(receivedAt) || receivedAt < EARLIEST || receivedAt > now + 300) return { ok: false, code: 'bad_received_at' };
  if (!REPORT_ROUTES.includes(route)) return { ok: false, code: 'bad_route' };
  if (!REPORT_CATEGORIES.includes(category)) return { ok: false, code: 'bad_category' };
  if (uuid8 !== null && (typeof uuid8 !== 'string' || !UUID8_RE.test(uuid8))) return { ok: false, code: 'bad_uuid8' };
  const r = checkReason(reason);
  if (r) return { ok: false, code: r };
  return { ok: true, args: { training, receivedAt, route, category, uuid8, reason } };
}

/**
 * Validate an "update / close" body → { ok: true, caseRef, patch } | { ok: false, code }.
 * Keys: case_ref (required) + any of category, decision, reason, nca_ref,
 * reporter_told, key_removed. null clears reason / nca_ref / reporter_told.
 */
export function parseUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, code: 'bad_body' };
  const fields = ['category', 'decision', 'reason', 'nca_ref', 'reporter_told', 'key_removed'];
  if (Object.keys(body).some((k) => k !== 'case_ref' && !fields.includes(k))) return { ok: false, code: 'unknown_field' };
  if (typeof body.case_ref !== 'string' || !CASE_REF_RE.test(body.case_ref)) return { ok: false, code: 'bad_case_ref' };
  const patch = {};
  for (const k of fields) if (k in body) patch[k] = body[k];
  if (!Object.keys(patch).length) return { ok: false, code: 'nothing_to_update' };
  if ('category' in patch && !REPORT_CATEGORIES.includes(patch.category)) return { ok: false, code: 'bad_category' };
  if ('decision' in patch && !REPORT_DECISIONS.includes(patch.decision)) return { ok: false, code: 'bad_decision' };
  if ('reason' in patch) { const r = checkReason(patch.reason); if (r) return { ok: false, code: r }; }
  if ('nca_ref' in patch && patch.nca_ref !== null && (typeof patch.nca_ref !== 'string' || !NCA_REF_RE.test(patch.nca_ref))) {
    return { ok: false, code: 'bad_nca_ref' };
  }
  if ('reporter_told' in patch && patch.reporter_told !== null && !REPORTER_TOLD.includes(patch.reporter_told)) {
    return { ok: false, code: 'bad_reporter_told' };
  }
  if ('key_removed' in patch && typeof patch.key_removed !== 'boolean') return { ok: false, code: 'bad_key_removed' };
  return { ok: true, caseRef: body.case_ref, patch };
}

/** → { ok: true, case_ref, row } */
export async function reportOpen(env, by, { training, receivedAt, route, category, uuid8, reason }) {
  return rpc(env, 'report_open', {
    p_by: by, p_training: training, p_received_at: receivedAt, p_route: route,
    p_uuid8: uuid8, p_category: category, p_reason: reason,
  });
}

/** → { ok: true, row, unchanged? } | { ok: false, code: not_found | helper_category | helper_category_change } */
export async function reportUpdate(env, by, caseRef, patch) {
  return rpc(env, 'report_update', { p_by: by, p_case_ref: caseRef, p_patch: patch });
}

/** First called by the take-down route (OSA-Tools-2). → { ok, row, already? } | { ok: false, code } */
export async function reportTakedown(env, by, caseRef, uuid8, at) {
  return rpc(env, 'report_takedown', { p_by: by, p_case_ref: caseRef, p_uuid8: uuid8, p_at: at });
}

/** → row | null */
export async function reportGet(env, caseRef) {
  return rpc(env, 'report_get', { p_case_ref: caseRef });
}

/** Newest first, training rows included (training: true). */
export async function reportList(env, limit = 200) {
  return rpc(env, 'report_list', { p_limit: limit });
}

/** training false → real rows only; true → training rows only. → { exported_at, rows, events } */
export async function reportExport(env, training) {
  return rpc(env, 'report_export', { p_training: training });
}

/** T- rows only; real rows are refused by the database. → { ok, deleted } */
export async function reportDeleteTraining(env) {
  return rpc(env, 'report_delete_training', {});
}
