// test/helpers/report-fake.js — OSA-Tools-1 · 22 Oct 2026.
// The report register's SQL functions (supabase/migrations/20261022_osa_tools_1_reports.sql)
// mirrored in memory for makeSupabase(). A throw here = a raised exception or a CHECK
// violation in Postgres (the fake answers 400, as PostgREST does). Single-threaded, so
// "atomic" means the counter is read and bumped in one step, as the upsert does.
// The SQL itself was run against PGlite at build time (43 checks, scratch, 22 Oct).

const ROUTES     = ['report@', 'support@', 'privacy@', 'signal', 'other'];
const CATEGORIES = ['csea', 'terrorism', 'iia', 'extreme_porn', 'fraud', 'other_illegal', 'terms', 'complaint', 'appeal', 'no_link'];
const DECISIONS  = ['open', 'removed', 'not_removed', 'already_gone', 'manifestly_unfounded'];
const TOLD       = ['y', 'n', 'no_contact'];

export function makeReportRpcs(clock) {
  const register = new Map();   // case_ref → row
  const events   = [];          // { id, case_ref, at, by, action, fields }
  const counters = new Map();   // 'R:2026' → last
  let eventId = 0;

  const by = (b) => { if (b !== 'admin' && b !== 'helper') throw new Error('report: by must be admin or helper'); return b; };
  function check(r) {   // the table CHECKs
    const bad = (why) => { throw new Error(`violates check constraint ${why}`); };
    if (!/^[RT]-[0-9]{4}-[0-9]{3,4}$/.test(r.case_ref)) bad('case_ref');
    if (r.training !== r.case_ref.startsWith('T-')) bad('training');
    if (!ROUTES.includes(r.route)) bad('route');
    if (r.uuid8 !== null && !/^[0-9a-f]{8}$/.test(r.uuid8)) bad('uuid8');
    if (!CATEGORIES.includes(r.category)) bad('category');
    if (!DECISIONS.includes(r.decision)) bad('decision');
    if (r.reason !== null && (r.reason.length > 500 || /@|#|http/i.test(r.reason))) bad('reason');
    if (r.nca_ref !== null && (r.nca_ref.length > 64 || !/^[A-Za-z0-9-]*$/.test(r.nca_ref))) bad('nca_ref');
    if (r.reporter_told !== null && !TOLD.includes(r.reporter_told)) bad('reporter_told');
    if ((r.decision === 'open') !== (r.closed_at === null)) bad('closed_at');
  }
  const event = (case_ref, at, b, action, fields) => events.push({ id: ++eventId, case_ref, at, by: b, action, fields });

  const rpcs = {
    report_open({ p_by, p_training, p_received_at, p_route, p_uuid8, p_category, p_reason }) {
      const b = by(p_by), t = clock();
      if (typeof p_training !== 'boolean') throw new Error('report_open: training is required');
      if (!(p_received_at >= 1767225600 && p_received_at <= t + 300)) throw new Error('report_open: received_at out of range');
      const pre = p_training ? 'T' : 'R';
      const y = new Date(p_received_at * 1000).getUTCFullYear();
      const n = (counters.get(`${pre}:${y}`) ?? 0) + 1;
      if (n > 9999) throw new Error('report_open: counter full');
      const case_ref = `${pre}-${y}-${n < 1000 ? String(n).padStart(3, '0') : n}`;
      const row = { case_ref, training: p_training, received_at: p_received_at, route: p_route, uuid8: p_uuid8 ?? null,
                    category: p_category, decision: 'open', reason: p_reason ?? null, takedown_at: null, takedown_by: null,
                    nca_ref: null, reporter_told: null, key_removed: false, closed_at: null, opened_by: b, updated_at: t };
      check(row);                         // a refused row rolls the counter back too
      counters.set(`${pre}:${y}`, n);
      register.set(case_ref, row);
      event(case_ref, t, b, 'open', ['training', 'received_at', 'route', ...(row.uuid8 ? ['uuid8'] : []), 'category', ...(row.reason ? ['reason'] : [])]);
      return { ok: true, case_ref, row: { ...row } };
    },
    report_update({ p_by, p_case_ref, p_patch }) {
      const b = by(p_by), t = clock();
      for (const k of Object.keys(p_patch)) {
        if (!['category', 'decision', 'reason', 'nca_ref', 'reporter_told', 'key_removed'].includes(k)) throw new Error(`report_update: field ${k} cannot be updated`);
      }
      const r = register.get(p_case_ref);
      if (!r) return { ok: false, code: 'not_found' };
      if (b === 'helper' && !['csea', 'terrorism'].includes(r.category)) return { ok: false, code: 'helper_category' };
      if (b === 'helper' && 'category' in p_patch && p_patch.category !== r.category) return { ok: false, code: 'helper_category_change' };
      const n = { ...r };
      for (const k of ['category', 'decision', 'reason', 'nca_ref', 'reporter_told']) if (k in p_patch) n[k] = p_patch[k];
      if ('key_removed' in p_patch) n.key_removed = p_patch.key_removed ?? false;
      const changed = ['decision', 'reason', 'nca_ref', 'reporter_told', 'key_removed'].filter((k) => n[k] !== r[k]);
      if (n.category === r.category && !changed.length) return { ok: true, unchanged: true, row: { ...r } };
      if (n.decision === 'open') n.closed_at = null; else if (r.decision === 'open') n.closed_at = t;
      n.updated_at = t;
      check(n);
      register.set(r.case_ref, n);
      if (n.category !== r.category) event(r.case_ref, t, b, 'category_change', ['category']);
      if (changed.length) event(r.case_ref, t, b, r.decision === 'open' && n.decision !== 'open' ? 'close' : 'update', changed);
      return { ok: true, row: { ...n } };
    },
    report_takedown({ p_by, p_case_ref, p_uuid8, p_at }) {
      const b = by(p_by), t = clock();
      const r = register.get(p_case_ref);
      if (!r) return { ok: false, code: 'not_found' };
      if (r.takedown_at !== null) return { ok: true, already: true, row: { ...r } };
      if (r.decision !== 'open') return { ok: false, code: 'case_closed' };
      if (r.uuid8 === null || r.uuid8 !== p_uuid8) return { ok: false, code: 'case_mismatch' };
      if (b === 'helper' && !['csea', 'terrorism'].includes(r.category)) return { ok: false, code: 'helper_category' };
      Object.assign(r, { takedown_at: p_at, takedown_by: b, updated_at: t });
      event(r.case_ref, t, b, 'takedown', ['takedown_at', 'takedown_by']);
      return { ok: true, row: { ...r } };
    },
    report_get({ p_case_ref }) { const r = register.get(p_case_ref); return r ? { ...r } : null; },
    report_list({ p_limit }) {
      return [...register.values()]
        .sort((a, b) => b.received_at - a.received_at || (a.case_ref < b.case_ref ? 1 : -1))
        .slice(0, Math.max(1, Math.min(p_limit ?? 200, 500))).map((r) => ({ ...r }));
    },
    report_export({ p_training }) {
      const rows = [...register.values()].filter((r) => r.training === !!p_training)
        .sort((a, b) => (a.case_ref < b.case_ref ? -1 : 1));
      const refs = new Set(rows.map((r) => r.case_ref));
      return { exported_at: clock(), rows: rows.map((r) => ({ ...r })), events: events.filter((e) => refs.has(e.case_ref)) };
    },
    report_delete_training() {
      let n = 0;
      for (let i = events.length - 1; i >= 0; i--) if (events[i].case_ref.startsWith('T-')) events.splice(i, 1);
      for (const [k, r] of register) if (r.training) { register.delete(k); n++; }
      return { ok: true, deleted: n };
    },
  };

  /** What the guard triggers do on a direct delete (tests call this to prove the rule). */
  function deleteRow(caseRef) {
    const r = register.get(caseRef);
    if (r && !r.training) throw new Error('report_register: real rows are never deleted');
    register.delete(caseRef);
  }

  return { rpcs, register, events, counters, deleteRow };
}
