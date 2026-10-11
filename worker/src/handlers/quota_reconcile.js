// ─────────────────────────────────────────────────────────────────────────────
// quota_reconcile.js — nightly storage-quota reconcile (B12-3 · 11 Oct 2026; B12-SR S1.9 🔒)
//
// R2 manifests are the truth; quota_accounts.used_chunks is a cache of it.
//   1. t0 = Supabase clock (quota_now), read BEFORE the scan.
//   2. Scan every {uuid}/manifest.json: live (upload_complete, not consumed,
//      not soak) with qref_ct → used += total_chunks for that quota_ref; its
//      session hash goes in "done" (any reservation left by a failed finalise
//      conversion is dropped — used now counts it).
//   3. quota_reconcile(t0, rows): rows touched at/after t0 are skipped tonight;
//      reserved is recomputed in SQL from unexpired reservation rows.
// A partial scan never writes: over the manifest cap, or any qref_ct that will
// not open, aborts the run (writing partial counts would drift in the user's
// favour). One AE data point per run: corrected accounts + total drift, no
// identifiers. A non-zero night is a bug report.
// Runs from the 03:00 cron (index.js Task 4) and POST /admin/quota-reconcile.
// ─────────────────────────────────────────────────────────────────────────────

import { requireAdmin, json } from '../utils.js';
import { openQref, hasQref } from '../seal.js';
import { quotaNow, reconcileQuotaRows } from '../quota_store.js';
import { StoreUnavailable } from '../api_store.js';

// Workers allow ~1,000 subrequests per invocation; each manifest read is one.
// Above this the run aborts (Navy Office sees the AE flag) — revisit at scale
// (B12 §1.8: ~100k live transfers), e.g. a cursor carried across nights.
export const MAX_RECONCILE_MANIFESTS = 900;

const UUID_DIR_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/$/;

function ae(env, blob, doubles) {
  if (!env.AE) return;
  try { env.AE.writeDataPoint({ blobs: [blob, '', '', ''], doubles, indexes: [blob] }); }
  catch (e) { console.error('quota_reconcile: AE write failed:', e); }
}

/** runQuotaReconcile(env) → summary object (never throws for store/scan faults). */
export async function runQuotaReconcile(env) {
  if (!env.SUPABASE_URL || !env.QUOTA_REF_KEY) return { ok: false, skipped: 'not_configured' };

  let t0;
  try { t0 = await quotaNow(env); }
  catch (e) {
    if (!(e instanceof StoreUnavailable)) throw e;
    console.error('quota_reconcile: store unavailable:', e.message);
    return { ok: false, error: 'store_unavailable' };
  }

  // ── Scan: one list() per 1000 transfer prefixes, one get() per manifest ────
  const uuids = [];
  let cursor;
  do {
    const page = await env.BUCKET.list({ delimiter: '/', limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const p of page.delimitedPrefixes ?? []) {
      const m = UUID_DIR_RE.exec(p);
      if (m) uuids.push(m[1]);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  if (uuids.length > MAX_RECONCILE_MANIFESTS) {
    console.error(`quota_reconcile: ${uuids.length} transfers > cap ${MAX_RECONCILE_MANIFESTS}; not written`);
    ae(env, 'quota_reconcile_aborted', [uuids.length, 0, 0, 0, 0]);
    return { ok: false, error: 'over_cap', transfers: uuids.length };
  }

  const rows = new Map();   // quota_ref hex → { q, used, done[] }
  let live = 0;
  for (const uuid of uuids) {
    let m = null;
    try {
      const o = await env.BUCKET.get(`${uuid}/manifest.json`);
      if (o) m = JSON.parse(await o.text());
    } catch (e) {
      console.error(`quota_reconcile: manifest read failed for ${uuid}; not written:`, e);
      ae(env, 'quota_reconcile_aborted', [uuids.length, 1, 0, 0, 0]);
      return { ok: false, error: 'read_failed' };
    }
    if (!m || m.upload_complete !== true || m.consumed === true || m.soak === true || !hasQref(m)) continue;
    if (!Number.isInteger(m.total_chunks) || m.total_chunks < 1) continue;
    const q = await openQref(env, uuid, m.qref_ct);
    if (!q) {
      console.error(`quota_reconcile: qref_ct would not open for ${uuid}; not written`);
      ae(env, 'quota_reconcile_aborted', [uuids.length, 2, 0, 0, 0]);
      return { ok: false, error: 'seal_open_failed' };
    }
    const r = rows.get(q.quotaRef) ?? { q: q.quotaRef, used: 0, done: [] };
    r.used += m.total_chunks;
    r.done.push(q.sessionHash);
    rows.set(q.quotaRef, r);
    live++;
  }

  let out;
  try { out = await reconcileQuotaRows(env, t0, [...rows.values()]); }
  catch (e) {
    if (!(e instanceof StoreUnavailable)) throw e;
    console.error('quota_reconcile: store unavailable at write:', e.message);
    return { ok: false, error: 'store_unavailable' };
  }
  ae(env, 'quota_reconcile', [out?.corrected ?? 0, out?.drift_chunks ?? 0, out?.skipped ?? 0, out?.accounts ?? 0, live]);
  if ((out?.corrected ?? 0) > 0) console.error(`quota_reconcile: corrected ${out.corrected} account(s), drift ${out.drift_chunks} chunk(s)`);
  return { ok: true, transfers_scanned: uuids.length, live_quota_transfers: live, ...out };
}

/** POST /admin/quota-reconcile — admin-key gated; same run as the cron. */
export async function handleQuotaReconcile(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const r = await runQuotaReconcile(env);
  return r.ok ? json(r) : json(r, r.error === 'store_unavailable' ? 503 : 409);
}
