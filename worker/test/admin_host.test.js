// H6a Admin-Access-1a (30 Oct 2026) — the host split, generated from docs/ROUTES.md.
// Plan: private strategy/docs/H6a-Admin-Access-plan-v1.md §3.1, §3.3, §5.3.
//
//   • every Host admin row → public host → 404 `Not found`, byte for byte an unknown route (with and without the key)
//   • every Host admin row → admin host without an Access token → 401 {error:access}
//   • every Host admin row → admin host with a good token, no key → 401 Unauthorised (the key gate still holds)
//   • every Host api row → admin host with a good token → 404
//   • no Access-Control-* on the admin host; ADMIN_PUBLIC_UNTIL open → old behaviour, shut → 404; fails closed

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/turnstile.js', () => ({
  verifyTurnstileToken: vi.fn(async () => true),
  verifyTurnstile:      vi.fn(async () => true),
}));

import worker from '../src/index.js';
import routesDoc from '../../docs/ROUTES.md?raw';
import toml from '../wrangler.toml?raw';
import { readDocRows, ADMIN_PATH as INVENTORY_ADMIN_PATH } from '../../bin/lib/route-inventory-lib.mjs';
import { ADMIN_PATH } from '../src/admin_host.js';
import { forgetAccessCerts, ACCESS_HEADER } from '../src/access_jwt.js';
import { forgetApiKey } from '../src/api_store.js';
import { makeSupabase, makeEnv, ctx, ADMIN, ORIGIN } from './helpers/api-fake.js';
import { TEAM, AUD, makeToken, certsFetch } from './helpers/access-token.js';

const ADMIN_ORIGIN = 'https://admin.share.test';
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const NOW = () => Math.floor(Date.now() / 1000);

let sb;
beforeEach(() => {
  forgetApiKey();
  forgetAccessCerts();
  sb = makeSupabase();
  vi.stubGlobal('fetch', certsFetch({ other: (url, opts) => sb.fetchImpl(url, opts) }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const env = (o = {}) => makeEnv({
  ADMIN_HOST: 'admin.share.test', ACCESS_TEAM: TEAM, ACCESS_AUD: AUD, ADMIN_PUBLIC_UNTIL: '0',
  APP_ORIGINS: 'https://share.refueler.io,https://refueler.io', ...o,
});
const rows = [...readDocRows(routesDoc).values()];
const adminRows = rows.filter((r) => r.host === 'admin');
const apiRows   = rows.filter((r) => r.host === 'api');
const concrete  = (path) => path.replace('{id}', 'x').replace(/\{(\w+)\|[^}]*\}/, '$1').replace(/\*$/, 'x');

async function call(e, method, path, { origin = ORIGIN, key, token, headers = {} } = {}) {
  const h = new Headers({ 'X-Transfer-UUID': UUID, Origin: 'https://refueler.io', ...headers });
  if (key) h.set('X-Admin-Key', key);
  if (token) h.set(ACCESS_HEADER, token);
  const body = ['POST', 'PUT', 'DELETE'].includes(method) ? '{}' : undefined;
  if (body) h.set('Content-Type', 'application/json');
  return worker.fetch(new Request(`${origin}${concrete(path)}`, { method, headers: h, body }), e, ctx);
}
const snapshot = async (res) => ({ status: res.status, body: await res.text(), headers: [...res.headers.entries()] });
const corsOf = (res) => [...res.headers.keys()].filter((k) => k.startsWith('access-control-'));

describe('one admin-path rule for the Worker and the inventory', () => {
  it('src/admin_host.js and bin/lib/route-inventory-lib.mjs agree', () => {
    expect(ADMIN_PATH.source).toBe(INVENTORY_ADMIN_PATH.source);
    expect(ADMIN_PATH.flags).toBe(INVENTORY_ADMIN_PATH.flags);
  });

  it('the table has both hosts, every admin/staff gate on admin', () => {
    expect(adminRows.length).toBe(40);
    expect(rows.filter((r) => ['admin', 'staff'].includes(r.gate)).every((r) => r.host === 'admin')).toBe(true);
  });
});

describe('public host: every Host admin row → the unknown-route 404', () => {
  it.each(adminRows.map((r) => [r.method, r.path]))('%s %s', async (method, path) => {
    const e = env();
    const unknown = await snapshot(await call(e, method, '/no-such-route'));
    expect(unknown.status).toBe(404);
    expect(await snapshot(await call(e, method, path))).toEqual(unknown);
    expect(await snapshot(await call(e, method, path, { key: ADMIN }))).toEqual(unknown);
    expect(sb.calls.length).toBe(0);
  });

  it('bare /admin and /api/v1/admin too', async () => {
    for (const p of ['/admin', '/api/v1/admin', '/admin/', '/admin/no-such']) {
      expect((await call(env(), 'GET', p, { key: ADMIN })).status).toBe(404);
    }
  });

  it('the old sandbox paths are gone on both hosts', async () => {
    const token = await makeToken();
    for (const p of ['/api/v1/sandbox/activate', '/api/v1/sandbox/reset']) {
      expect((await call(env(), 'POST', p, { key: ADMIN })).status).toBe(404);
      expect((await call(env(), 'POST', p, { key: ADMIN, token, origin: ADMIN_ORIGIN })).status).toBe(404);
    }
  });
});

describe('admin host, no Access token: every Host admin row → 401 {error:access}', () => {
  it.each(adminRows.map((r) => [r.method, r.path]))('%s %s', async (method, path) => {
    const res = await call(env(), method, path, { origin: ADMIN_ORIGIN, key: ADMIN });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'access' });
    expect(corsOf(res)).toEqual([]);
    expect(sb.calls.length).toBe(0);
  });

  it('a token for another application (aud) or another team → 401', async () => {
    for (const claims of [{ aud: ['another-app'] }, { iss: 'https://other.cloudflareaccess.com' }]) {
      const res = await call(env(), 'GET', '/admin/reports/whoami', { origin: ADMIN_ORIGIN, key: ADMIN, token: await makeToken({ claims }) });
      expect(res.status).toBe(401);
    }
  });
});

describe('admin host, good Access token, no admin key: every Host admin row → 401 Unauthorised', () => {
  it.each(adminRows.map((r) => [r.method, r.path]))('%s %s', async (method, path) => {
    const res = await call(env(), method, path, { origin: ADMIN_ORIGIN, token: await makeToken() });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorised' });
    expect(corsOf(res)).toEqual([]);
  });
});

describe('admin host, good Access token: every Host api row → 404', () => {
  it.each(apiRows.map((r) => [r.method, r.path]))('%s %s', async (method, path) => {
    const res = await call(env(), method, path, { origin: ADMIN_ORIGIN, key: ADMIN, token: await makeToken() });
    expect(res.status).toBe(404);
    expect(corsOf(res)).toEqual([]);
  });

  it('/ and any other path → 404 (Navy Office arrives in Admin-Access-1b)', async () => {
    for (const p of ['/', '/index.html', '/navy-office.js', '/administrator']) {
      expect((await call(env(), 'GET', p, { origin: ADMIN_ORIGIN, token: await makeToken() })).status).toBe(404);
    }
  });
});

describe('admin host, token + key', () => {
  it('whoami → admin, no Access-Control-* even with an allowed Origin', async () => {
    const res = await call(env(), 'GET', '/admin/reports/whoami', { origin: ADMIN_ORIGIN, key: ADMIN, token: await makeToken() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'admin' });
    expect(corsOf(res)).toEqual([]);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('GET /admin/status → the same body as public GET /status', async () => {
    const e = env();
    await e.STATUS_KV.put('status:current', JSON.stringify({ updated_at: 1790000000 }));
    const pub = await call(e, 'GET', '/status');
    const adm = await call(e, 'GET', '/admin/status', { origin: ADMIN_ORIGIN, key: ADMIN, token: await makeToken() });
    expect(adm.status).toBe(200);
    expect(await adm.json()).toEqual(await pub.json());
    expect((await call(e, 'GET', '/admin/status', { origin: ADMIN_ORIGIN, key: 'wrong', token: await makeToken() })).status).toBe(401);
  });

  it('sandbox activate on its new path reaches the handler', async () => {
    const res = await call(env(), 'POST', '/api/v1/admin/sandbox/activate', { origin: ADMIN_ORIGIN, key: ADMIN, token: await makeToken() });
    expect([404, 401]).not.toContain(res.status);
  });

  it('OPTIONS preflight is not answered with CORS on the admin host', async () => {
    const res = await call(env(), 'OPTIONS', '/admin/metrics', { origin: ADMIN_ORIGIN, token: await makeToken() });
    expect(corsOf(res)).toEqual([]);
  });

  it('auth routes are not served on the admin host', async () => {
    const res = await call(env(), 'POST', '/auth/magic', { origin: ADMIN_ORIGIN, token: await makeToken() });
    expect(res.status).toBe(404);
  });
});

describe('ADMIN_PUBLIC_UNTIL — cut-over day and break-glass', () => {
  it('in the future → the public host answers admin paths as before (key gate, CORS)', async () => {
    const e = env({ ADMIN_PUBLIC_UNTIL: String(NOW() + 3600) });
    expect((await call(e, 'GET', '/admin/reports/whoami')).status).toBe(401);
    const ok = await call(e, 'GET', '/admin/reports/whoami', { key: ADMIN });
    expect(await ok.json()).toEqual({ role: 'admin' });
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://refueler.io');
  });

  it('past, 0, unset or not a number → 404', async () => {
    for (const v of [String(NOW() - 1), String(NOW()), '0', undefined, '', 'tomorrow', 'Infinity']) {
      expect((await call(env({ ADMIN_PUBLIC_UNTIL: v }), 'GET', '/admin/reports/whoami', { key: ADMIN })).status, String(v)).toBe(404);
    }
  });

  it('never opens the admin host without a token', async () => {
    const e = env({ ADMIN_PUBLIC_UNTIL: String(NOW() + 3600) });
    expect((await call(e, 'GET', '/admin/reports/whoami', { origin: ADMIN_ORIGIN, key: ADMIN })).status).toBe(401);
  });
});

describe('fails closed', () => {
  it('ADMIN_HOST unset → no admin host: admin paths 404 on every host', async () => {
    const e = env({ ADMIN_HOST: undefined });
    expect((await call(e, 'GET', '/admin/reports/whoami', { origin: ADMIN_ORIGIN, key: ADMIN, token: await makeToken() })).status).toBe(404);
    expect((await call(e, 'GET', '/admin/reports/whoami', { key: ADMIN })).status).toBe(404);
  });

  it('ACCESS_TEAM or ACCESS_AUD unset → the admin host refuses everything (503)', async () => {
    for (const o of [{ ACCESS_TEAM: undefined }, { ACCESS_AUD: undefined }]) {
      const res = await call(env(o), 'GET', '/admin/reports/whoami', { origin: ADMIN_ORIGIN, key: ADMIN, token: await makeToken() });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'access_unavailable' });
    }
  });

  it('Access keys unreachable → 503, never a pass', async () => {
    vi.stubGlobal('fetch', certsFetch({ certs: () => new Response('down', { status: 502 }), other: (u, o) => sb.fetchImpl(u, o) }));
    const res = await call(env(), 'GET', '/admin/reports/whoami', { origin: ADMIN_ORIGIN, key: ADMIN, token: await makeToken() });
    expect(res.status).toBe(503);
  });

  it('the public routes on the public host are untouched', async () => {
    const res = await call(env(), 'GET', '/status');
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://refueler.io');
  });
});

describe('wrangler.toml pins (plan §1.1, §1.2, §3.1)', () => {
  const top = toml.slice(0, toml.search(/^\[/m));
  const v = (name) => toml.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];

  it('no workers.dev, no preview URLs', () => {
    expect(top).toMatch(/^workers_dev\s*=\s*false\s*$/m);
    expect(top).toMatch(/^preview_urls\s*=\s*false\s*$/m);
  });

  it('the admin host is a Custom Domain; the API route is unchanged', () => {
    expect(toml).toMatch(/\[\[routes\]\]\s*\npattern\s*=\s*"admin\.share\.refueler\.io"\s*\ncustom_domain\s*=\s*true/);
    expect(toml).toMatch(/\[\[routes\]\]\s*\npattern\s*=\s*"api\.share\.refueler\.io\/\*"\s*\nzone_name\s*=\s*"refueler\.io"/);
  });

  it('admin host vars set; the window closes within a fortnight of the cut-over', () => {
    expect(v('ADMIN_HOST')).toBe('admin.share.refueler.io');
    expect(v('ACCESS_TEAM')).toMatch(/^[a-z0-9-]+$/);
    expect(v('ACCESS_AUD')).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(v('ADMIN_PUBLIC_UNTIL'))).toBeLessThanOrEqual(Date.UTC(2026, 10, 15) / 1000);
  });

  it('static assets, if configured, always run the Worker first (else they would be public on api.share)', () => {
    const assets = toml.match(/^\[assets\]\s*\n((?:(?!\[).*\n?)*)/m);
    if (assets) expect(assets[1]).toMatch(/^run_worker_first\s*=\s*true\s*$/m);
  });
});
