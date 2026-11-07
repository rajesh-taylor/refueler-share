// H8 Trusted-Types-1 (7 Nov 2026): the app's CSP enforces Trusted Types in this engine.
// A string sent to an HTML sink throws; the share-dom policy (frontend/trusted-types.js) lets
// through exactly its two late scripts and nothing else. Skipped under TT_REPORT_ONLY=1, where
// the directives are report-only on purpose (the smoke run then lists violations instead).
import { test, expect } from '@playwright/test';

test.skip(process.env.TT_REPORT_ONLY === '1', 'Trusted Types are report-only in this run');

test('Trusted Types enforced: a planted innerHTML throws, the policy refuses foreign script URLs', async ({ page, browserName }) => {
  await page.goto('/');
  await expect(page.locator('#drop-zone')).toBeAttached();

  const r = await page.evaluate(async () => {
    const out = { tt: typeof window.trustedTypes !== 'undefined' };
    try { document.createElement('div').innerHTML = '<b>x</b>'; out.innerHTML = 'allowed'; }
    catch (e) { out.innerHTML = e.name; }
    try { document.createElement('script').src = '/x.js'; out.scriptSrc = 'allowed'; }
    catch (e) { out.scriptSrc = e.name; }
    try { window.trustedTypes?.createPolicy('other', { createHTML: (s) => s }); out.otherPolicy = 'allowed'; }
    catch (e) { out.otherPolicy = e.name; }
    const rel = [...document.scripts].map((s) => s.src).find((s) => /\/v\/[0-9a-f]+\//.test(s));
    const { lateScriptURL } = await import(new URL('trusted-types.js', rel).href);
    const tryURL = (u) => { try { return String(lateScriptURL(u)); } catch (e) { return e.name; } };
    out.fflate = tryURL('fflate.min.js');
    out.qr = tryURL('qr-creator.min.js');
    out.other = tryURL('upload.js');
    out.foreign = tryURL('https://example.com/fflate.min.js');
    out.query = tryURL('fflate.min.js?x=1');
    out.up = tryURL('../fflate.min.js');
    return out;
  });
  console.log(`${browserName}: ${JSON.stringify(r)}`);

  expect(r.tt, `${browserName} has no window.trustedTypes`).toBe(true);
  expect(r.innerHTML).toBe('TypeError');
  expect(r.scriptSrc).toBe('TypeError');
  expect(r.otherPolicy).toBe('TypeError');
  expect(r.fflate).toMatch(/\/v\/[0-9a-f]+\/fflate\.min\.js$/);
  expect(r.qr).toMatch(/\/v\/[0-9a-f]+\/qr-creator\.min\.js$/);
  for (const k of ['other', 'foreign', 'query', 'up']) expect(r[k], k).toBe('TypeError');
});
