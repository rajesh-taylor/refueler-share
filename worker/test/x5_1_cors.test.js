// X5-1 — public CORS answers both app origins during the parallel run
// (refueler.io/share/ until X5-2b, and share.refueler.io). docs/X5-plan-v1.md §2.7.
// Allowlist = var APP_ORIGINS, set once per request by setAppOrigins(env).
// Credentials stay exact AUTH_ORIGINS on AUTH_API_HOST only; localhost never gets them.

import { describe, it, expect, afterEach } from 'vitest';
import worker from '../src/index.js';
import { corsHeaders, setAppOrigins, parseOrigins } from '../src/utils.js';
import { handleAuthPingOptions } from '../src/auth_ping.js';
import { env as shipped } from 'cloudflare:test';

const OLD = 'https://refueler.io';
const APP = 'https://share.refueler.io';
const API = 'https://api.share.refueler.io';
const BOTH = `${OLD},${APP}`;
const ctx = { waitUntil() {}, passThroughOnException() {} };
const env = (o = {}) => ({ APP_ORIGINS: BOTH, AUTH_ORIGINS: BOTH, AUTH_API_HOST: 'api.share.refueler.io', ...o });

const req = (origin, path = '/status', method = 'GET') =>
  new Request(`${API}${path}`, { method, headers: origin ? { Origin: origin } : {} });
const acao = (h) => h['Access-Control-Allow-Origin'];

afterEach(() => setAppOrigins({}));

describe('corsHeaders — APP_ORIGINS allowlist', () => {
  it('echoes each listed origin', () => {
    setAppOrigins(env());
    expect(acao(corsHeaders(req(OLD)))).toBe(OLD);
    expect(acao(corsHeaders(req(APP)))).toBe(APP);
  });

  it('answers an unknown origin with the first entry, never an echo', () => {
    setAppOrigins(env());
    expect(acao(corsHeaders(req('https://evil.example')))).toBe(OLD);
    expect(acao(corsHeaders(req('https://refueler-share-app.pages.dev')))).toBe(OLD);
    expect(acao(corsHeaders(req(null)))).toBe(OLD);
  });

  it('falls back to refueler.io only when APP_ORIGINS is unset (pre-X5 behaviour)', () => {
    setAppOrigins({});
    expect(acao(corsHeaders(req(APP)))).toBe(OLD);
    expect(acao(corsHeaders(req(OLD)))).toBe(OLD);
  });

  it('keeps the localhost echo, without credentials', () => {
    setAppOrigins(env());
    const h = corsHeaders(req('http://localhost:8181'));
    expect(acao(h)).toBe('http://localhost:8181');
    expect(h['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('never sends Allow-Credentials and varies on Origin', () => {
    setAppOrigins(env());
    const h = corsHeaders(req(APP));
    expect(h['Access-Control-Allow-Credentials']).toBeUndefined();
    expect(h['Vary']).toBe('Origin');
  });

  it('parses https-only exact origins', () => {
    expect(parseOrigins(' https://a.example , http://b.example,https://c.example/x,*,https://d.example ')).toEqual(['https://a.example', 'https://d.example']);
  });
});

describe('worker.fetch — origin per request', () => {
  it('a public preflight from share.refueler.io is echoed, no credentials', async () => {
    const r = await worker.fetch(req(APP, '/credential/issue', 'OPTIONS'), env(), ctx);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(r.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('initiate preflight: credentials for both AUTH_ORIGINS on the auth host', async () => {
    for (const o of [OLD, APP]) {
      const r = await worker.fetch(req(o, '/upload/00000000-0000-4000-8000-000000000001/initiate', 'OPTIONS'), env(), ctx);
      expect(r.headers.get('Access-Control-Allow-Origin')).toBe(o);
      expect(r.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    }
  });

  it('initiate preflight: an origin in APP_ORIGINS but not AUTH_ORIGINS gets no credentials', async () => {
    const r = await worker.fetch(req(APP, '/upload/00000000-0000-4000-8000-000000000001/initiate', 'OPTIONS'),
      env({ AUTH_ORIGINS: OLD }), ctx);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(r.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('initiate preflight from localhost never gets credentials', async () => {
    const r = await worker.fetch(req('http://localhost:8181', '/upload/00000000-0000-4000-8000-000000000001/initiate', 'OPTIONS'), env(), ctx);
    expect(r.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('an unset APP_ORIGINS on the next request falls back (env read per request)', async () => {
    await worker.fetch(req(APP, '/credential/issue', 'OPTIONS'), env(), ctx);
    const r = await worker.fetch(req(APP, '/credential/issue', 'OPTIONS'), {}, ctx);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(OLD);
  });
});

describe('auth_ping — same allowlist, no localhost echo', () => {
  it('echoes a listed origin, else the first entry', () => {
    setAppOrigins(env());
    expect(handleAuthPingOptions(req(APP)).headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(handleAuthPingOptions(req('https://evil.example')).headers.get('Access-Control-Allow-Origin')).toBe(OLD);
    expect(handleAuthPingOptions(req('http://localhost:8181')).headers.get('Access-Control-Allow-Origin')).toBe(OLD);
  });
});

// X5-2b (16 Oct 2026): the shipped wrangler.toml vars. Sign-in only on the app's origin;
// refueler.io stays a public page origin (Plans + Status /status, Navy Office /admin/*),
// after share.refueler.io so unknown origins are answered with the app.

describe('X5-2b — shipped origins', () => {
  it('AUTH_ORIGINS is share.refueler.io only', () => {
    expect(parseOrigins(shipped.AUTH_ORIGINS)).toEqual([APP]);
  });

  it('APP_ORIGINS answers unknown origins with the app, and keeps refueler.io for Plans, Status, Navy Office', () => {
    expect(parseOrigins(shipped.APP_ORIGINS)).toEqual([APP, OLD]);
    setAppOrigins(shipped);
    expect(acao(corsHeaders(req('https://evil.example')))).toBe(APP);
    expect(acao(corsHeaders(req(OLD)))).toBe(OLD);
  });
});
