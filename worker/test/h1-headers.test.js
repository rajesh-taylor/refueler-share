// H1 Logs-Headers-1 (18 Oct 2026) — Worker JSON hardening headers + observability pin.
import { describe, it, expect } from 'vitest';
import toml from '../wrangler.toml?raw';
import { hardenJson } from '../src/index.js';

describe('hardenJson', () => {
  it('adds the four headers to a JSON response and keeps CORS + status', async () => {
    const res = hardenJson(new Response('{"a":1}', {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://share.refueler.io', 'Access-Control-Expose-Headers': 'X-Integrity' },
    }));
    expect(res.status).toBe(429);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-site');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://share.refueler.io');
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe('X-Integrity');
    expect(await res.json()).toEqual({ a: 1 });
  });

  it('keeps a Cache-Control the route already set', () => {
    const res = hardenJson(new Response('{}', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } }));
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it('leaves non-JSON responses (chunk downloads, text) untouched', () => {
    for (const ct of ['application/octet-stream', 'text/plain']) {
      const res = hardenJson(new Response('x', { headers: { 'Content-Type': ct, 'Cache-Control': 'private, no-store' } }));
      expect(res.headers.get('Cross-Origin-Resource-Policy')).toBeNull();
      expect(res.headers.get('Content-Security-Policy')).toBeNull();
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    }
  });

  it('is never same-origin (the app on share. reads api.share.)', () => {
    const res = hardenJson(new Response('{}', { headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-site');
  });
});

describe('wrangler.toml observability pin', () => {
  const block = (name) => {
    const m = toml.match(new RegExp(`^\\[${name.replace('.', '\\.')}\\]\\s*\\n((?:(?!\\[).*\\n?)*)`, 'm'));
    return m ? m[1] : null;
  };
  it.each(['observability', 'observability.logs', 'observability.traces'])('[%s] is present and enabled = false', (name) => {
    const b = block(name);
    expect(b, `[${name}] missing from wrangler.toml`).not.toBeNull();
    expect(b).toMatch(/^\s*enabled\s*=\s*false\s*$/m);
    expect(b).not.toMatch(/enabled\s*=\s*true/);
  });
});
