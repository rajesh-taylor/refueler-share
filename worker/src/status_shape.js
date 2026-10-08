// ─────────────────────────────────────────────────────────────────────────────
// status_shape.js — the one shape of `status:current` (KV-Fix-1a · 8 Oct 2026)
//
// KV is compromised for write (B12-SR X1), and `status:current` reaches public
// pages. So the shape is enforced twice with the same rules:
//   - POST /admin/status  → cleanStatus(body, { strict: true }): any bad field
//                           is a 400; unknown top-level keys are dropped.
//   - GET  /status        → cleanStatus(kvValue): bad fields fall back to
//                           defaults, bad incidents are dropped, unknown keys
//                           never leave the Worker.
// Pages still escape everything they render — this is the second wall.
// ─────────────────────────────────────────────────────────────────────────────

export const STATUS_STATES     = ['operational', 'degraded', 'maintenance'];
export const STATUS_SEVERITIES = ['minor', 'major', 'critical'];
const LIGHTNING_VALUES         = [true, false, 'phoenixd', 'blink'];

const MAX_MESSAGE     = 500;
const MAX_DESCRIPTION = 200;
const MAX_TITLE       = 160;
const MAX_ID          = 64;
const MAX_BODY        = 1000;
const MAX_INCIDENTS   = 20;
const MAX_UPDATES     = 20;

class ShapeError extends Error {}

const isTime = v => Number.isInteger(v) && v > 0;
const isObj  = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function str(v, max, name) {
  if (typeof v !== 'string' || v.length > max) throw new ShapeError(`${name} must be a string of at most ${max} characters`);
  return v;
}

function time(v, name) {
  if (!isTime(v)) throw new ShapeError(`${name} must be a positive integer (unix seconds)`);
  return v;
}

function cleanMaintenance(mw) {
  if (mw === null) return null;
  if (!isObj(mw)) throw new ShapeError('maintenance must be an object or null');
  const out = {};
  if (mw.scheduled_at     !== undefined) out.scheduled_at     = time(mw.scheduled_at, 'maintenance.scheduled_at');
  if (mw.duration_minutes !== undefined) out.duration_minutes = time(mw.duration_minutes, 'maintenance.duration_minutes');
  if (mw.description      !== undefined) out.description      = str(mw.description, MAX_DESCRIPTION, 'maintenance.description');
  return out;
}

function cleanUpdate(u, i) {
  if (!isObj(u)) throw new ShapeError(`updates[${i}] must be an object`);
  return { at: time(u.at, `updates[${i}].at`), body: str(u.body, MAX_BODY, `updates[${i}].body`) };
}

function cleanIncident(inc, i) {
  if (!isObj(inc)) throw new ShapeError(`incidents[${i}] must be an object`);
  if (!STATUS_SEVERITIES.includes(inc.severity)) {
    throw new ShapeError(`incidents[${i}].severity must be one of: ${STATUS_SEVERITIES.join(', ')}`);
  }
  const out = {
    title:    str(inc.title, MAX_TITLE, `incidents[${i}].title`),
    severity: inc.severity,
  };
  if (inc.id          !== undefined) out.id          = str(inc.id, MAX_ID, `incidents[${i}].id`);
  if (inc.started_at  !== undefined) out.started_at  = time(inc.started_at, `incidents[${i}].started_at`);
  if (inc.resolved_at !== undefined && inc.resolved_at !== null) {
    out.resolved_at = time(inc.resolved_at, `incidents[${i}].resolved_at`);
  }
  if (inc.updates !== undefined) {
    if (!Array.isArray(inc.updates) || inc.updates.length > MAX_UPDATES) {
      throw new ShapeError(`incidents[${i}].updates must be an array of at most ${MAX_UPDATES}`);
    }
    out.updates = inc.updates.map(cleanUpdate);
  }
  return out;
}

function cleanIncidents(list, strict) {
  if (!Array.isArray(list)) throw new ShapeError('incidents must be an array');
  if (strict && list.length > MAX_INCIDENTS) throw new ShapeError(`at most ${MAX_INCIDENTS} incidents`);
  const out = [];
  list.slice(0, MAX_INCIDENTS).forEach((inc, i) => {
    try { out.push(cleanIncident(inc, i)); }
    catch (e) { if (strict) throw e; }
  });
  return out;
}

// Each field: how to clean it, and the default the public read falls back to.
const FIELDS = {
  state:               { clean: v => { if (!STATUS_STATES.includes(v)) throw new ShapeError(`state must be one of: ${STATUS_STATES.join(', ')}`); return v; }, fallback: 'operational' },
  message:             { clean: v => v === null ? null : str(v, MAX_MESSAGE, 'message'), fallback: null },
  maintenance:         { clean: cleanMaintenance, fallback: null },
  lightning_available: { clean: v => { if (!LIGHTNING_VALUES.includes(v)) throw new ShapeError('lightning_available must be true, false, "phoenixd" or "blink"'); return v; }, fallback: false },
  phoenixd:            { clean: v => { if (v !== null && typeof v !== 'boolean') throw new ShapeError('phoenixd must be true, false or null'); return v; }, fallback: null },
  updated_at:          { clean: v => time(v, 'updated_at'), fallback: null },
};

/**
 * cleanStatus(src, { strict }) → object with known fields only.
 *
 * strict: throws ShapeError (message safe to return as a 400) on the first bad
 *   field; only fields present in `src` are returned (a patch).
 * lenient (default): never throws; every known field is present, bad ones at
 *   their fallback, bad incidents dropped.
 */
export function cleanStatus(src, { strict = false } = {}) {
  if (!isObj(src)) {
    if (strict) throw new ShapeError('body must be a JSON object');
    src = {};
  }
  const out = {};
  for (const [name, { clean, fallback }] of Object.entries(FIELDS)) {
    if (src[name] === undefined) { if (!strict) out[name] = fallback; continue; }
    try { out[name] = clean(src[name]); }
    catch (e) { if (strict) throw e; out[name] = fallback; }
  }
  if (src.incidents !== undefined) {
    try { out.incidents = cleanIncidents(src.incidents, strict); }
    catch (e) { if (strict) throw e; out.incidents = []; }
  } else if (!strict) {
    out.incidents = [];
  }
  return out;
}

export function isShapeError(e) {
  return e instanceof ShapeError;
}
