// ─────────────────────────────────────────────────────────────────────────────
// handlers/reports.js — /admin/reports/* (OSA-Tools-1 · 22 Oct 2026; take-down OSA-Tools-2)
//
// The report route's tools: who am I, look up a link, the register, take down.
// Design: private docs/OSA-Tools-plan-v1.md §1, §2, §3, §4, §5.
//
// Every route: X-Admin-Key checked by requireRole (admin key, or HELPER_KEY
// where the plan allows it), fixed path, Cache-Control: no-store. The rate
// limit (30 / 60 s per IP) is applied by the router before these run.
// The transfer ID (UUID) travels only in X-Transfer-UUID. Nothing here logs a
// transfer ID, a case reference or any register text.
//
//   GET  /admin/reports/whoami           admin, helper   → { role }
//   GET  /admin/reports/lookup           admin, helper   R2 manifest only (§1)
//   GET  /admin/reports/register         admin, helper   newest first, training marked
//   POST /admin/reports/open             admin, helper   any category
//   POST /admin/reports/update           admin, helper   helper: CSEA/terrorism rows, no category change
//   POST /admin/reports/takedown         admin, helper   helper: CSEA/terrorism cases only (§3)
//   GET  /admin/reports/export           admin           real rows only
//   GET  /admin/reports/export-training  admin           training rows only (drills)
//   POST /admin/reports/delete-training  admin           T- rows only
// ─────────────────────────────────────────────────────────────────────────────

import { json, requireRole, safeGetManifest, transferUuid } from '../utils.js';
import { StoreUnavailable } from '../api_store.js';
import { destroyTransfer, isTombstone } from './delete_transfer.js';
import {
  parseOpen, parseUpdate, reportOpen, reportUpdate, reportList, reportExport, reportDeleteTraining,
  reportGet, reportTakedown, CASE_REF_RE, HELPER_CATEGORIES,
} from '../report_store.js';

const STAFF = ['admin', 'helper'];
const ADMIN = ['admin'];
const BODY_MAX = 4096;

function out(data, status = 200) {
  const res = json(data, status);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > BODY_MAX) return { error: out({ error: 'body_too_large' }, 413) };
  try { return { body: JSON.parse(text) }; }
  catch { return { error: out({ error: 'bad_json' }, 400) }; }
}

/** Run a register call; a store failure is 503, a database refusal 400. */
async function store(fn) {
  try { return { value: await fn() }; }
  catch (e) {
    if (!(e instanceof StoreUnavailable)) throw e;
    if (/: 400 /.test(e.message)) return { error: out({ error: 'refused_by_database' }, 400) };
    console.error('reports: register unavailable');
    return { error: out({ error: 'register_unavailable' }, 503) };
  }
}

// ── GET /admin/reports/whoami ────────────────────────────────────────────────
export async function handleReportsWhoami(request, env) {
  const role = await requireRole(request, env, STAFF);
  if (role instanceof Response) return role;
  return out({ role });
}

// ── GET /admin/reports/lookup ────────────────────────────────────────────────
// Reads the R2 manifest only (never the Execution Dock, never KV). These keys
// and no others:
//   live / expired         → state, tier, created_at, expires_at, upload_complete, consumed
//   gone / removed / not_found → state, consumed
// `expired` = time ran out but the sweep has not removed the parts yet (still
// in R2, so it can still be taken down). After 30 days a tombstone is swept
// and the state becomes not_found. Never: size, chunks, file name, password,
// destroy-after-download, window, sealed refs, merkle root, timestamp, status.
export async function handleReportsLookup(request, env) {
  const role = await requireRole(request, env, STAFF);
  if (role instanceof Response) return role;
  const uuid = transferUuid(request);
  if (!uuid) return out({ error: 'missing_transfer_id' }, 400);

  const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (oversize) return out({ error: 'manifest_unreadable' }, 502);
  if (!manifest) return out({ state: 'not_found', consumed: false });
  if (manifest.consumed === true) {
    return out({ state: manifest.removed === true ? 'removed' : 'gone', consumed: true });
  }
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Number.isFinite(manifest.expiry_timestamp) ? manifest.expiry_timestamp : null;
  return out({
    state:           expiresAt !== null && now > expiresAt ? 'expired' : 'live',
    tier:            typeof manifest.tier === 'string' ? manifest.tier : null,
    created_at:      Number.isFinite(manifest.created_at) ? manifest.created_at : null,
    expires_at:      expiresAt,
    upload_complete: manifest.upload_complete === true,
    consumed:        false,
  });
}

// ── GET /admin/reports/register ──────────────────────────────────────────────
export async function handleReportsRegister(request, env) {
  const role = await requireRole(request, env, STAFF);
  if (role instanceof Response) return role;
  const r = await store(() => reportList(env, 200));
  return r.error ?? out({ rows: r.value ?? [] });
}

// ── POST /admin/reports/open ─────────────────────────────────────────────────
export async function handleReportsOpen(request, env) {
  const role = await requireRole(request, env, STAFF);
  if (role instanceof Response) return role;
  const { body, error } = await readBody(request);
  if (error) return error;
  const p = parseOpen(body, Math.floor(Date.now() / 1000));
  if (!p.ok) return out({ error: p.code }, 400);
  const r = await store(() => reportOpen(env, role, p.args));
  return r.error ?? out({ case_ref: r.value.case_ref, row: r.value.row });
}

// ── POST /admin/reports/update ───────────────────────────────────────────────
// The helper limits (CSEA/terrorism rows only, never a category change) are
// checked by report_update() under the row lock, so a category changed by the
// admin a moment earlier can't slip past.
export async function handleReportsUpdate(request, env) {
  const role = await requireRole(request, env, STAFF);
  if (role instanceof Response) return role;
  const { body, error } = await readBody(request);
  if (error) return error;
  const p = parseUpdate(body);
  if (!p.ok) return out({ error: p.code }, 400);
  const r = await store(() => reportUpdate(env, role, p.caseRef, p.patch));
  if (r.error) return r.error;
  const v = r.value;
  if (!v?.ok) {
    const status = v?.code === 'not_found' ? 404 : 403;
    return out({ error: v?.code ?? 'refused' }, status);
  }
  return out({ row: v.row, ...(v.unchanged ? { unchanged: true } : {}) });
}

// ── GET /admin/reports/export · /admin/reports/export-training ──────────────
export async function handleReportsExport(request, env) {
  const role = await requireRole(request, env, ADMIN);
  if (role instanceof Response) return role;
  const r = await store(() => reportExport(env, false));
  return r.error ?? out(r.value);
}

export async function handleReportsExportTraining(request, env) {
  const role = await requireRole(request, env, ADMIN);
  if (role instanceof Response) return role;
  const r = await store(() => reportExport(env, true));
  return r.error ?? out(r.value);
}

// ── POST /admin/reports/delete-training ──────────────────────────────────────
export async function handleReportsDeleteTraining(request, env) {
  const role = await requireRole(request, env, ADMIN);
  if (role instanceof Response) return role;
  const r = await store(() => reportDeleteTraining(env));
  return r.error ?? out({ deleted: r.value?.deleted ?? 0 });
}

// ── POST /admin/reports/takedown ─────────────────────────────────────────────
// Body {"case_ref":"R-2026-001","confirm":"<uuid8>"}; the transfer ID in
// X-Transfer-UUID. Plan §3, in order:
//   1. role (the rate limit ran in the router)
//   2. the case exists, is open and names this link's uuid8 → else 409 case_mismatch;
//      confirm equals uuid8 → else 400 confirm_mismatch
//   3. helper → the case's category (read from the row, never the request) must
//      be csea or terrorism → else 403 helper_category
//   4. manifest: none → 404; removed → 200 already_removed (idempotent);
//      deleted for another reason → 410 already_gone (a deletion left part-way
//      is finished first, as what it was)
//   5. destroyTransfer(…, { removed: true }); part-way → 202 partial — a retry
//      resumes and still ends "removed"
//   6. record the take-down in the register. Destroy first, record second: a
//      register failure is 200 { destroyed, register_updated: false } and
//      removed_at is given so the time can be written in by hand.
// Logs uuid8 at most (destroyTransfer); never the case reference.
export async function handleReportsTakedown(request, env) {
  const role = await requireRole(request, env, STAFF);
  if (role instanceof Response) return role;
  const uuid = transferUuid(request);
  if (!uuid) return out({ error: 'missing_transfer_id' }, 400);
  const { body, error } = await readBody(request);
  if (error) return error;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out({ error: 'bad_body' }, 400);
  if (Object.keys(body).some((k) => k !== 'case_ref' && k !== 'confirm')) return out({ error: 'unknown_field' }, 400);
  if (typeof body.case_ref !== 'string' || !CASE_REF_RE.test(body.case_ref)) return out({ error: 'bad_case_ref' }, 400);
  const uuid8 = uuid.slice(0, 8);

  const got = await store(() => reportGet(env, body.case_ref));
  if (got.error) return got.error;
  const row = got.value;
  if (!row) return out({ error: 'case_mismatch', why: 'no_such_case' }, 409);
  if (row.uuid8 !== uuid8) return out({ error: 'case_mismatch', why: 'other_link' }, 409);
  if (row.decision !== 'open') return out({ error: 'case_mismatch', why: 'case_closed' }, 409);
  if (typeof body.confirm !== 'string' || body.confirm.toLowerCase() !== uuid8) return out({ error: 'confirm_mismatch' }, 400);
  if (role === 'helper' && !HELPER_CATEGORIES.includes(row.category)) return out({ error: 'helper_category' }, 403);

  const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (oversize) return out({ error: 'manifest_unreadable' }, 502);
  if (!manifest) return out({ error: 'not_found' }, 404);

  const now = Math.floor(Date.now() / 1000);
  if (manifest.consumed === true && manifest.removed !== true) {
    if (isTombstone(manifest)) return out({ error: 'already_gone' }, 410);
    const r = await destroyTransfer(env, uuid, manifest, now, 'reports');
    if (r.partial) return out({ partial: true, remaining: r.remaining ?? null }, 202);
    return out({ error: 'already_gone' }, 410);
  }

  // Already removed: idempotent, and the register is left alone — a second
  // report about the same link didn't do the take-down (its row is closed
  // "already removed" by hand, pointing at the first).
  if (manifest.consumed === true && isTombstone(manifest)) {
    return out({ already_removed: true, removed_at: Number.isFinite(manifest.consumed_at) ? manifest.consumed_at : null });
  }

  const r = await destroyTransfer(env, uuid, manifest, now, 'reports', { removed: true });
  if (r.gone) return out({ error: 'not_found' }, 404);
  if (r.partial) return out({ partial: true, remaining: r.remaining ?? null }, 202);
  const removedAt = r.consumed_at ?? now;

  let registerUpdated = false;
  try {
    const v = await reportTakedown(env, role, row.case_ref, uuid8, removedAt);
    registerUpdated = v?.ok === true;
    if (!registerUpdated) console.error(`reports: take-down not recorded (${v?.code ?? 'refused'})`);
  } catch (e) {
    if (!(e instanceof StoreUnavailable)) throw e;
    console.error('reports: take-down not recorded (register unavailable)');
  }
  return out({ destroyed: true, removed_at: removedAt, register_updated: registerUpdated });
}
