// H2 Browser-KAT-1: test-vectors/v1.json in this engine, on the real built modules, real CSP.
import { test, expect } from '@playwright/test';

test('known-answer vectors, real modules, real CSP', async ({ page, browserName }) => {
  const csp = [];
  page.on('console', (m) => { if (/Content.Security.Policy/i.test(m.text())) csp.push(m.text()); });
  page.on('pageerror', (e) => csp.push('pageerror: ' + e.message));

  const res = await page.goto('/kat/');
  expect(res.headers()['content-security-policy']).toContain("default-src 'none'");

  await page.waitForFunction(() => window.__kat?.done, null, { timeout: 90_000 });
  const kat = await page.evaluate(() => window.__kat);

  expect(kat.fatal, 'the page could not run the vectors').toBeUndefined();
  const failed = kat.results.filter((r) => !r.ok);
  console.log(`${browserName}: ${kat.results.length} checks, ${failed.length} failed, BLAKE3 ${kat.blake3}, release ${kat.rel}`);
  expect(failed, 'failed vectors').toEqual([]);
  expect(kat.results.length).toBeGreaterThan(80);

  // Under the real CSP each engine must run the WASM. A silent fall back to the pure-JS BLAKE3
  // still gives right answers, ~2.5 MiB/s, so it needs its own check.
  expect(kat.blake3, 'BLAKE3 fell back to pure JS').toBe('wasm');
  expect(csp, 'CSP errors or page errors').toEqual([]);
});
