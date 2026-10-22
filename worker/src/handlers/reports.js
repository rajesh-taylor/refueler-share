// ─────────────────────────────────────────────────────────────────────────────
// handlers/reports.js — /admin/reports/* (OSA-Tools-1 · 22 Oct 2026)
//
// The report route's tools: who am I, look up a link, and the register.
// Design: private docs/OSA-Tools-plan-v1.md §1, §2, §4, §5.
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
//   GET  /admin/reports/export           admin           real rows only
//   GET  /admin/reports/export-training  admin           training rows only (drills)
//   POST /admin/reports/delete-training  admin           T- rows only
// ─────────────────────────────────────────────────────────────────────────────

import { json, requireRole, safeGetManifest, transferUuid } from '../utils.js';
import { StoreUnavailable } from '../api_store.js';
import {
  parseOpen, parseUpdate, reportOpen, reportUpdate, reportList, reportExport, reportDeleteTraining,
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
