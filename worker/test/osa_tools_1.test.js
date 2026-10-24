// OSA-Tools-1 (22 Oct 2026) — report register and roles.
// Plan: private docs/OSA-Tools-plan-v1.md §1 (look-up), §2 (helper key), §4–§5 (register), §8.
//
//   • requireRole: admin / helper / 401; HELPER_KEY unset, short or equal to ADMIN_KEY → helper off
//   • look-up: each state, the exact key set, 400 / 401 / 429, no-store, helper allowed
//   • the helper key → 401 on every admin-gated route, the list generated from the route inventory
//   • register: refs sequential + atomic, year rollover, T- counter separate, '@' / '#' / 'http'
//     refused, helper category change refused, real rows not deletable, export excludes training
//
// The SQL behind the fake (helpers/report-fake.js) was run against PGlite at build time.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/turnstile.js', () => ({
  verifyTurnstileToken: vi.fn(async () => true),
  verifyTurnstile:      vi.fn(async () => true),
}));

import worker from '../src/index.js';
import indexSrc from '../src/index.js?raw';
import authSrc from '../src/handlers/auth.js?raw';
import routesDoc from '../../docs/ROUTES.md?raw';
import { readRoutes, readDocRows } from '../../bin/lib/route-inventory-lib.mjs';
import { requireRole, requireAdmin } from '../src/utils.js';
import { forgetApiKey, StoreUnavailable } from '../src/api_store.js';
import { reportOpen } from '../src/report_store.js';
import { makeBucket } from './_r2_mock.js';
import { makeSupabase, makeEnv, ctx, ADMIN, ORIGIN } from './helpers/api-fake.js';
import { transferRequest } from './helpers/transfer-request.js';

const HELPER = 'helper-key-test-0123456789abcdef-0123456789';   // ≥ 32 characters
const PEPPER = 'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=';
const UUID   = '0f8fad5b-d9cb-469f-a165-70867728950e';
const NOW    = () => Math.floor(Date.now() / 1000);
const YEAR   = () => new Date().getUTCFullYear();

let sb;
beforeEach(() => {
  forgetApiKey();
  sb = makeSupabase();
  vi.stubGlobal('fetch', async (url, opts = {}) => sb.fetchImpl(url, opts));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

const env = (o = {}) => makeEnv({ HELPER_KEY: HELPER, ...o });
const call = (e, method, path, { key = ADMIN, body, uuid, headers = {} } = {}) => {
  const h = { ...(key ? { 'X-Admin-Key': key } : {}), ...headers };
  const init = { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const req = uuid ? transferRequest(`${ORIGIN}${path}`, uuid, init) : new Request(`${ORIGIN}${path}`, init);
  return worker.fetch(req, e, ctx);
};
const open = (e, body, key = ADMIN) => call(e, 'POST', '/admin/reports/open', { key, body });
const update = (e, body, key = ADMIN) => call(e, 'POST', '/admin/reports/update', { key, body });
const newReport = (o = {}) => ({ training: false, route: 'report@', category: 'csea', uuid8: 'ab1602aa', ...o });

// ── requireRole ──────────────────────────────────────────────────────────────
describe('requireRole', () => {
  const req = (key) => new Request('https://w.test/admin/reports/whoami', key === undefined ? {} : { headers: { 'X-Admin-Key': key } });
  const role = async (key, e, roles = ['admin', 'helper']) => {
    const r = await requireRole(req(key), e, roles);
    return r instanceof Response ? r.status : r;
  };

  it('admin key → admin, helper key → helper, anything else → 401', async () => {
    const e = { ADMIN_KEY: ADMIN, HELPER_KEY: HELPER };
    expect(await role(ADMIN, e)).toBe('admin');
    expect(await role(HELPER, e)).toBe('helper');
    for (const k of [undefined, '', 'nope', HELPER.slice(0, -1), ADMIN + 'x', HELPER + 'x']) expect(await role(k, e)).toBe(401);
  });

  it('a role outside the allowed list → 401', async () => {
    expect(await role(HELPER, { ADMIN_KEY: ADMIN, HELPER_KEY: HELPER }, ['admin'])).toBe(401);
    expect(await role(ADMIN,  { ADMIN_KEY: ADMIN, HELPER_KEY: HELPER }, ['admin'])).toBe('admin');
  });

  it('fails closed: HELPER_KEY unset, empty or short → helper off; ADMIN_KEY unset → admin off', async () => {
    expect(await role(HELPER, { ADMIN_KEY: ADMIN })).toBe(401);
    expect(await role('', { ADMIN_KEY: ADMIN, HELPER_KEY: '' })).toBe(401);
    const short = 'x'.repeat(31);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await role(short, { ADMIN_KEY: ADMIN, HELPER_KEY: short })).toBe(401);
    expect(await role('', { HELPER_KEY: HELPER })).toBe(401);
    expect(await role(ADMIN, { HELPER_KEY: HELPER })).toBe(401);
  });

  it('HELPER_KEY equal to ADMIN_KEY → helper off, admin still works, one line logged', async () => {
    const same = 'same-key-for-both-0123456789abcdef-xyz';
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await role(same, { ADMIN_KEY: same, HELPER_KEY: same })).toBe('admin');
    expect(await role(same, { ADMIN_KEY: same, HELPER_KEY: same }, ['helper'])).toBe(401);
    expect(log.mock.calls.flat().join(' ')).toMatch(/HELPER_KEY equals ADMIN_KEY/);
    expect(log.mock.calls.flat().join(' ')).not.toContain(same);
  });

  it('requireAdmin is unchanged: the helper key never passes it', async () => {
    const e = { ADMIN_KEY: ADMIN, HELPER_KEY: HELPER };
    expect((await requireAdmin(req(HELPER), e))?.status).toBe(401);
    expect(await requireAdmin(req(ADMIN), e)).toBeNull();
  });
});

// ── whoami ───────────────────────────────────────────────────────────────────
describe('GET /admin/reports/whoami', () => {
  it('names the role; no key or a wrong key → 401', async () => {
    const e = env();
    expect(await (await call(e, 'GET', '/admin/reports/whoami')).json()).toEqual({ role: 'admin' });
    expect(await (await call(e, 'GET', '/admin/reports/whoami', { key: HELPER })).json()).toEqual({ role: 'helper' });
    expect((await call(e, 'GET', '/admin/reports/whoami', { key: null })).status).toBe(401);
    expect((await call(e, 'GET', '/admin/reports/whoami', { key: 'wrong' })).status).toBe(401);
    expect((await call(makeEnv(), 'GET', '/admin/reports/whoami', { key: HELPER })).status).toBe(401);
  });
});

// ── look-up ──────────────────────────────────────────────────────────────────
describe('GET /admin/reports/lookup', () => {
  const LIVE_KEYS = ['consumed', 'created_at', 'expires_at', 'state', 'tier', 'upload_complete'];
  const DEAD_KEYS = ['consumed', 'state'];
  const full = (o = {}) => ({
    uuid: UUID, tier: 'creative', total_chunks: 3, expiry_timestamp: NOW() + 86400, created_at: NOW() - 60,
    blake3_root: 'r', chunks_received: [], upload_complete: true, download_initiated_at: null,
    p2sh_secret_hash: 'deadbeef', file_name: 'secret-name.pdf', total_bytes: 12345, status: 'uploading',
    destroy_after_download: true, available_from_timestamp: 1, merkle_root: 'm', sealed_qref: 'q', ...o,
  });
  const withManifest = (m) => env({ BUCKET: makeBucket(m ? { [`${UUID}/manifest.json`]: { uploaded: NOW(), body: JSON.stringify(m) } } : {}) });
  const look = (e, key = ADMIN, uuid = UUID) => call(e, 'GET', '/admin/reports/lookup', { key, uuid });

  it('live: exactly the six keys, from the manifest, no-store', async () => {
    const m = full();
    const res = await look(withManifest(m));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const j = await res.json();
    expect(Object.keys(j).sort()).toEqual(LIVE_KEYS);
    expect(j).toEqual({ state: 'live', tier: 'creative', created_at: m.created_at, expires_at: m.expiry_timestamp, upload_complete: true, consumed: false });
  });

  it('upload not complete is reported as such (never from status)', async () => {
    const j = await (await look(withManifest(full({ upload_complete: false, status: 'complete' })))).json();
    expect(j.state).toBe('live');
    expect(j.upload_complete).toBe(false);
  });

  it('expired: time ran out, parts not yet swept — same six keys', async () => {
    const j = await (await look(withManifest(full({ expiry_timestamp: NOW() - 10 })))).json();
    expect(Object.keys(j).sort()).toEqual(LIVE_KEYS);
    expect(j.state).toBe('expired');
  });

  it('gone (tombstone, or being deleted), removed, not_found: state + consumed only', async () => {
    const cases = [
      [{ consumed: true, consumed_at: NOW() }, { state: 'gone', consumed: true }],
      [full({ consumed: true }), { state: 'gone', consumed: true }],
      [{ consumed: true, consumed_at: NOW(), removed: true }, { state: 'removed', consumed: true }],
      [null, { state: 'not_found', consumed: false }],
    ];
    for (const [m, want] of cases) {
      const res = await look(withManifest(m));
      expect(res.status).toBe(200);
      const j = await res.json();
      expect(Object.keys(j).sort()).toEqual(DEAD_KEYS);
      expect(j).toEqual(want);
    }
  });

  it('never returns size, chunks, file name, password, window, refs, merkle root or status', async () => {
    const text = await (await look(withManifest(full()))).text();
    for (const s of ['secret-name', '12345', 'deadbeef', 'merkle', 'sealed', 'uploading', 'destroy', 'available', 'total_chunks']) {
      expect(text).not.toContain(s);
    }
  });

  it('the helper key may look up any link', async () => {
    const res = await look(withManifest(full({ tier: 'free' })), HELPER);
    expect(res.status).toBe(200);
    expect((await res.json()).tier).toBe('free');
  });

  it('400 without a valid X-Transfer-UUID; 401 without a key (before reading R2)', async () => {
    const e = withManifest(full());
    expect((await call(e, 'GET', '/admin/reports/lookup')).status).toBe(400);
    expect((await call(e, 'GET', '/admin/reports/lookup', { headers: { 'X-Transfer-UUID': 'ab1602aa' } })).status).toBe(400);
    const r401 = await look(e, null);
    expect(r401.status).toBe(401);
    expect(r401.headers.get('Cache-Control')).toBe('no-store');
    expect((await look(e, 'wrong')).status).toBe(401);
  });

  it('the transfer ID never goes in the path: /admin/reports/lookup/<uuid> is 404', async () => {
    expect((await call(withManifest(full()), 'GET', `/admin/reports/lookup/${UUID}`)).status).toBe(404);
  });
});

// ── rate limit ───────────────────────────────────────────────────────────────
describe('rate limit — 30 / 60 s per IP on /admin/reports/*', () => {
  it('the 31st request in a minute → 429, across reports routes, keyed or not', async () => {
    const e = env({ AUTH_PEPPER: PEPPER });
    const ip = { 'CF-Connecting-IP': '203.0.113.9' };
    for (let i = 0; i < 30; i++) {
      const path = i % 2 ? '/admin/reports/whoami' : '/admin/reports/register';
      expect((await call(e, 'GET', path, { key: i % 3 ? ADMIN : 'wrong', headers: ip })).status).not.toBe(429);
    }
    const res = await call(e, 'GET', '/admin/reports/lookup', { uuid: UUID, headers: ip });
    expect(res.status).toBe(429);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect((await call(e, 'GET', '/admin/reports/whoami', { headers: { 'CF-Connecting-IP': '203.0.113.10' } })).status).toBe(200);
  });
});

// ── helper key everywhere else — generated from the route inventory ─────────
describe('the helper key → 401 on every route outside its allowlist', () => {
  const list = readRoutes(indexSrc, authSrc);
  const rows = readDocRows(routesDoc);
  const gate = (r) => rows.get(`${r.method} ${r.path}`)?.gate;
  const ALLOW = ['GET /admin/reports/whoami', 'GET /admin/reports/lookup', 'GET /admin/reports/register',
                 'POST /admin/reports/open', 'POST /admin/reports/update', 'POST /admin/reports/takedown'];
  const admin = list.filter((r) => gate(r) === 'admin');
  const staff = list.filter((r) => gate(r) === 'staff');

  it('the inventory sees the report routes, with the allowlist exactly the staff gate', () => {
    expect(admin.length).toBeGreaterThanOrEqual(33);   // 34 → 33: purge-test-transfers removed (Purge-Route-Off)
    expect(staff.map((r) => `${r.method} ${r.path}`).sort()).toEqual([...ALLOW].sort());
    for (const p of ['/admin/reports/export', '/admin/reports/export-training', '/admin/reports/delete-training']) {
      expect(admin.some((r) => r.path === p)).toBe(true);
    }
  });

  it.each(admin.map((r) => [r.method, r.path]))('%s %s', async (method, path) => {
    const e = env({ BUCKET: makeBucket({ [`${UUID}/manifest.json`]: { uploaded: NOW(), body: JSON.stringify({ uuid: UUID, expiry_timestamp: NOW() + 99 }) } }) });
    const url = path.replace('{id}', 'x').replace(/\*$/, '');
    const body = ['POST', 'PUT', 'DELETE'].includes(method) ? {} : undefined;
    const res = await call(e, method, url, { key: HELPER, uuid: UUID, body });
    expect(res.status).toBe(401);
    expect(sb.reports.register.size).toBe(0);
  });

  it('DELETE /transfer with an owner bearer + the helper key → 401, nothing deleted', async () => {
    const e = env({ BUCKET: makeBucket({ [`${UUID}/manifest.json`]: { uploaded: NOW(), body: JSON.stringify({ uuid: UUID, expiry_timestamp: NOW() + 99, total_chunks: 1 }) } }) });
    const res = await call(e, 'DELETE', '/transfer', { key: HELPER, uuid: UUID, headers: { Authorization: 'Bearer rfs_owner_x' } });
    expect(res.status).toBe(401);
    expect(await e.BUCKET.get(`${UUID}/manifest.json`)).not.toBeNull();
  });

  it.each(staff.map((r) => [r.method, r.path]))('%s %s — helper not refused by role', async (method, path) => {
    const res = await call(env(), method, path, { key: HELPER, uuid: UUID, body: method === 'POST' ? {} : undefined });
    expect(res.status).not.toBe(401);
  });
});

// ── register ─────────────────────────────────────────────────────────────────
describe('register: open', () => {
  it('case references are sequential per year: R-YYYY-001, -002 …', async () => {
    const e = env();
    const a = await (await open(e, newReport())).json();
    const b = await (await open(e, newReport({ category: 'fraud' }), HELPER)).json();
    expect(a.case_ref).toBe(`R-${YEAR()}-001`);
    expect(b.case_ref).toBe(`R-${YEAR()}-002`);
    expect(a.row).toMatchObject({ decision: 'open', opened_by: 'admin', uuid8: 'ab1602aa', training: false, closed_at: null });
    expect(b.row.opened_by).toBe('helper');
  });

  it('atomic: 12 opens at once get 12 different, consecutive references', async () => {
    const e = env();
    const res = await Promise.all(Array.from({ length: 12 }, () => open(e, newReport())));
    const refs = (await Promise.all(res.map((r) => r.json()))).map((j) => j.case_ref).sort();
    expect(new Set(refs).size).toBe(12);
    expect(refs[0]).toBe(`R-${YEAR()}-001`);
    expect(refs[11]).toBe(`R-${YEAR()}-012`);
  });

  it('training rows take T- from their own counter', async () => {
    const e = env();
    await open(e, newReport());
    const t = await (await open(e, newReport({ training: true }))).json();
    const r = await (await open(e, newReport())).json();
    expect(t.case_ref).toBe(`T-${YEAR()}-001`);
    expect(r.case_ref).toBe(`R-${YEAR()}-002`);
  });

  it('year rollover: the UTC year of received_at; a new year starts at 001', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-01T00:05:00Z'));
    const e = env();
    const dec31 = Date.UTC(2026, 11, 31, 23, 59, 59) / 1000;
    const a = await (await open(e, newReport({ received_at: dec31 }))).json();
    const b = await (await open(e, newReport())).json();
    const c = await (await open(e, newReport({ received_at: dec31 - 60 }))).json();
    expect([a.case_ref, b.case_ref, c.case_ref]).toEqual(['R-2026-001', 'R-2027-001', 'R-2026-002']);
  });

  it("refuses '@', '#' and 'http' in the reason — before the database, and the database refuses too", async () => {
    const e = env();
    for (const reason of ['write to a@b.c', 'link had #k=abc', 'see HTTPS://x', 'http']) {
      const res = await open(e, newReport({ reason }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('reason_forbidden');
    }
    expect(sb.rpcCalls('report_open')).toHaveLength(0);
    await expect(reportOpen(e, 'admin', { training: false, receivedAt: NOW(), route: 'report@', category: 'csea', uuid8: null, reason: 'x@y' }))
      .rejects.toBeInstanceOf(StoreUnavailable);
    expect(sb.reports.register.size).toBe(0);
    expect(sb.reports.counters.size).toBe(0);   // a refused row doesn't use up a number
  });

  it('refuses a full transfer ID, unknown fields and values outside the fixed lists', async () => {
    const e = env();
    const bad = [
      [newReport({ uuid8: UUID }), 'bad_uuid8'],
      [newReport({ uuid8: 'AB1602AA' }), 'bad_uuid8'],
      [newReport({ email: 'x' }), 'unknown_field'],
      [newReport({ route: 'email' }), 'bad_route'],
      [newReport({ category: 'spam' }), 'bad_category'],
      [newReport({ training: 'no' }), 'bad_training'],
      [newReport({ received_at: NOW() + 3600 }), 'bad_received_at'],
      [newReport({ reason: 'x'.repeat(501) }), 'bad_reason'],
    ];
    for (const [body, code] of bad) {
      const res = await open(e, body);
      expect(res.status, code).toBe(400);
      expect((await res.json()).error).toBe(code);
    }
    expect(sb.reports.register.size).toBe(0);
  });

  it('no link given: uuid8 null is fine', async () => {
    const j = await (await open(env(), newReport({ uuid8: null, category: 'no_link' }))).json();
    expect(j.row.uuid8).toBeNull();
  });
});

describe('register: update and close', () => {
  it('admin closes a row: decision, reporter told, key removed, NCA ref; closed_at set; events name fields only', async () => {
    const e = env();
    const { case_ref } = await (await open(e, newReport({ reason: 'image reported' }))).json();
    const res = await update(e, { case_ref, decision: 'removed', reporter_told: 'y', key_removed: true, nca_ref: 'NCA-2026-77', reason: 'removed same day' });
    expect(res.status).toBe(200);
    const { row } = await res.json();
    expect(row).toMatchObject({ decision: 'removed', reporter_told: 'y', key_removed: true, nca_ref: 'NCA-2026-77' });
    expect(row.closed_at).toBeGreaterThan(0);
    const ev = sb.reports.events.filter((x) => x.case_ref === case_ref);
    expect(ev.map((x) => x.action)).toEqual(['open', 'close']);
    expect(JSON.stringify(ev)).not.toMatch(/removed same day|NCA-2026-77|image reported/);
  });

  it('the helper may update CSEA and terrorism rows, never another category, never change one', async () => {
    const e = env();
    const csea  = (await (await open(e, newReport({ category: 'csea' }))).json()).case_ref;
    const fraud = (await (await open(e, newReport({ category: 'fraud' }))).json()).case_ref;
    expect((await update(e, { case_ref: csea, nca_ref: 'NCA-1' }, HELPER)).status).toBe(200);
    const r1 = await update(e, { case_ref: fraud, decision: 'not_removed' }, HELPER);
    expect(r1.status).toBe(403);
    expect((await r1.json()).error).toBe('helper_category');
    const r2 = await update(e, { case_ref: csea, category: 'fraud' }, HELPER);
    expect(r2.status).toBe(403);
    expect((await r2.json()).error).toBe('helper_category_change');
    const r3 = await update(e, { case_ref: csea, category: 'terrorism' }, HELPER);
    expect(r3.status).toBe(403);
    expect(sb.reports.register.get(csea).category).toBe('csea');
    // the admin may change it; that's its own event
    expect((await update(e, { case_ref: fraud, category: 'csea' })).status).toBe(200);
    expect(sb.reports.events.filter((x) => x.case_ref === fraud).map((x) => x.action)).toEqual(['open', 'category_change']);
    expect((await update(e, { case_ref: fraud, decision: 'removed' }, HELPER)).status).toBe(200);
  });

  it('refuses unknown fields, takedown fields, bad references and forbidden text; 404 for an unknown case', async () => {
    const e = env();
    const { case_ref } = await (await open(e, newReport())).json();
    const bad = [
      [{ case_ref, takedown_at: 1 }, 'unknown_field'],
      [{ case_ref, opened_by: 'admin' }, 'unknown_field'],
      [{ case_ref }, 'nothing_to_update'],
      [{ case_ref: 'X-2026-001', decision: 'removed' }, 'bad_case_ref'],
      [{ case_ref, decision: 'deleted' }, 'bad_decision'],
      [{ case_ref, reason: 'mail a@b' }, 'reason_forbidden'],
      [{ case_ref, nca_ref: 'NCA 1' }, 'bad_nca_ref'],
      [{ case_ref, reporter_told: 'yes' }, 'bad_reporter_told'],
      [{ case_ref, key_removed: 'y' }, 'bad_key_removed'],
    ];
    for (const [body, code] of bad) {
      const res = await update(e, body);
      expect(res.status, code).toBe(400);
      expect((await res.json()).error).toBe(code);
    }
    const nf = await update(e, { case_ref: `R-${YEAR()}-999`, decision: 'removed' });
    expect(nf.status).toBe(404);
  });

  it('a no-op update says unchanged and records no event', async () => {
    const e = env();
    const { case_ref } = await (await open(e, newReport())).json();
    const j = await (await update(e, { case_ref, decision: 'open' })).json();
    expect(j.unchanged).toBe(true);
    expect(sb.reports.events).toHaveLength(1);
  });
});

describe('register: list, export, delete training', () => {
  async function seed(e) {
    const r1 = (await (await open(e, newReport({ received_at: NOW() - 100 }))).json()).case_ref;
    const t1 = (await (await open(e, newReport({ training: true, received_at: NOW() - 50 }))).json()).case_ref;
    const r2 = (await (await open(e, newReport({ received_at: NOW() - 10 }))).json()).case_ref;
    return { r1, t1, r2 };
  }

  it('register: newest first, training rows included and marked; helper may read it', async () => {
    const e = env();
    const { r1, t1, r2 } = await seed(e);
    const res = await call(e, 'GET', '/admin/reports/register', { key: HELPER });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const { rows } = await res.json();
    expect(rows.map((r) => r.case_ref)).toEqual([r2, t1, r1]);
    expect(rows.find((r) => r.case_ref === t1).training).toBe(true);
  });

  it('export: real rows and their events only; export-training: training only; both admin-only', async () => {
    const e = env();
    const { r1, t1, r2 } = await seed(e);
    const ex = await (await call(e, 'GET', '/admin/reports/export')).json();
    expect(Object.keys(ex).sort()).toEqual(['events', 'exported_at', 'rows']);
    expect(ex.rows.map((r) => r.case_ref)).toEqual([r1, r2]);
    expect(ex.events.every((x) => x.case_ref.startsWith('R-'))).toBe(true);
    const tr = await (await call(e, 'GET', '/admin/reports/export-training')).json();
    expect(tr.rows.map((r) => r.case_ref)).toEqual([t1]);
    expect(tr.events.every((x) => x.case_ref === t1)).toBe(true);
    expect((await call(e, 'GET', '/admin/reports/export', { key: HELPER })).status).toBe(401);
    expect((await call(e, 'GET', '/admin/reports/export-training', { key: HELPER })).status).toBe(401);
  });

  it('delete-training removes T- rows and their events only; real rows are never deletable', async () => {
    const e = env();
    const { r1, t1, r2 } = await seed(e);
    expect((await call(e, 'POST', '/admin/reports/delete-training', { key: HELPER })).status).toBe(401);
    expect(sb.reports.register.has(t1)).toBe(true);
    const res = await call(e, 'POST', '/admin/reports/delete-training');
    expect(await res.json()).toEqual({ deleted: 1 });
    expect([...sb.reports.register.keys()].sort()).toEqual([r1, r2]);
    expect(sb.reports.events.some((x) => x.case_ref === t1)).toBe(false);
    expect(() => sb.reports.deleteRow(r1)).toThrow(/never deleted/);
    // the T- counter is not reset by a delete
    expect((await (await open(e, newReport({ training: true }))).json()).case_ref).toBe(`T-${YEAR()}-002`);
  });

  it('Supabase down → 503 register_unavailable, nothing about the request logged', async () => {
    const e = env();
    sb.state.down = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await open(e, newReport({ reason: 'private words' }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('register_unavailable');
    expect(log.mock.calls.flat().join(' ')).not.toMatch(/private words|ab1602aa/);
  });
});
