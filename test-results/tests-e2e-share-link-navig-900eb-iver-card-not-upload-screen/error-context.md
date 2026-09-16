# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/e2e/share-link.spec.js >> navigating to a share URL shows receiver card not upload screen
- Location: tests/e2e/share-link.spec.js:72:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: expect(locator).toBeEnabled() failed

Locator:  locator('#upload-btn')
Expected: enabled
Received: disabled

Call log:
  - Expect "toBeEnabled" locator('#upload-btn') with timeout 60000ms
  - waiting for locator('#upload-btn')
    60 × locator resolved to <button disabled id="upload-btn" class="btn btn-primary btn-full">Encrypt & upload</button>
       - unexpected value "disabled"
  - Test timeout of 30000ms exceeded.

```

```yaml
- button "Encrypt & upload" [disabled]
```

# Test source

```ts
  1   | // tests/e2e/share-link.spec.js
  2   | //
  3   | // Smoke test: upload a file → share link contains ?uuid= and # fragment →
  4   | // pasting that link shows the receiver card, not the upload drop zone.
  5   | //
  6   | // Runs against the live site: https://refueler.io/share/
  7   | // Runs headed (visible browser) so Cloudflare Turnstile can solve itself.
  8   | //
  9   | // Run:
  10  | //   cd /Users/rajeshtaylor/Documents/refueler-share
  11  | //   npx playwright test tests/e2e/share-link.spec.js --headed
  12  | //
  13  | // What this catches:
  14  | //   - uuid missing from share URL  ← the Sep 2026 breakage
  15  | //   - fragment missing entirely
  16  | //   - routing falls through to upload mode instead of download mode
  17  | //   - receiver card never appears
  18  | 
  19  | import { test, expect } from '@playwright/test';
  20  | import path from 'path';
  21  | import fs from 'fs';
  22  | import os from 'os';
  23  | 
  24  | const BASE_URL = 'https://refueler.io/share/';
  25  | 
  26  | function makeTempFile(name = 'refueler-e2e-test.txt') {
  27  |   const p = path.join(os.tmpdir(), name);
  28  |   fs.writeFileSync(p, 'refueler share e2e test payload ' + Date.now());
  29  |   return p;
  30  | }
  31  | 
  32  | // ─────────────────────────────────────────────────────────────────────────────
  33  | // Test 1 — share URL structure
  34  | // Upload a file. Assert generated URL has ?uuid= and a non-empty #fragment.
  35  | // ─────────────────────────────────────────────────────────────────────────────
  36  | test('share URL contains ?uuid= and a non-empty fragment', async ({ page }) => {
  37  |   await page.goto(BASE_URL);
  38  |   await expect(page.locator('#drop-zone')).toBeVisible();
  39  | 
  40  |   const tmpFile = makeTempFile();
  41  |   await page.locator('#file-input').setInputFiles(tmpFile);
  42  |   await expect(page.locator('#options-card')).toBeVisible({ timeout: 5000 });
  43  | 
  44  |   // Wait for Turnstile to solve (headed browser, real widget — allow 60s)
  45  |   await expect(page.locator('#upload-btn')).toBeEnabled({ timeout: 60000 });
  46  | 
  47  |   await page.locator('#upload-btn').click();
  48  | 
  49  |   // Wait for share card — allow 30s for upload
  50  |   await expect(page.locator('#share-card')).toBeVisible({ timeout: 30000 });
  51  | 
  52  |   const shareUrl = (await page.locator('#share-link-display').textContent()).trim();
  53  |   expect(shareUrl).toBeTruthy();
  54  | 
  55  |   const parsed = new URL(shareUrl);
  56  | 
  57  |   const uuid = parsed.searchParams.get('uuid');
  58  |   expect(uuid, 'share URL must contain ?uuid=').toBeTruthy();
  59  |   expect(uuid).toMatch(/^[0-9a-f-]{36}$/i);
  60  | 
  61  |   const fragment = parsed.hash.slice(1);
  62  |   expect(fragment, 'share URL must contain a non-empty fragment').toBeTruthy();
  63  |   expect(fragment.length).toBeGreaterThan(10);
  64  | 
  65  |   fs.unlinkSync(tmpFile);
  66  | });
  67  | 
  68  | // ─────────────────────────────────────────────────────────────────────────────
  69  | // Test 2 — recipient routing
  70  | // Navigate to a share URL. Assert receiver card appears, drop zone is hidden.
  71  | // ─────────────────────────────────────────────────────────────────────────────
  72  | test('navigating to a share URL shows receiver card not upload screen', async ({ page }) => {
  73  |   // Step 1: upload to get a real share URL
  74  |   await page.goto(BASE_URL);
  75  |   await expect(page.locator('#drop-zone')).toBeVisible();
  76  | 
  77  |   const tmpFile = makeTempFile('refueler-e2e-routing.txt');
  78  |   await page.locator('#file-input').setInputFiles(tmpFile);
  79  |   await expect(page.locator('#options-card')).toBeVisible({ timeout: 5000 });
> 80  |   await expect(page.locator('#upload-btn')).toBeEnabled({ timeout: 60000 });
      |                                             ^ Error: expect(locator).toBeEnabled() failed
  81  |   await page.locator('#upload-btn').click();
  82  |   await expect(page.locator('#share-card')).toBeVisible({ timeout: 30000 });
  83  | 
  84  |   const shareUrl = (await page.locator('#share-link-display').textContent()).trim();
  85  |   fs.unlinkSync(tmpFile);
  86  | 
  87  |   // Step 2: open share URL in a fresh tab
  88  |   const newPage = await page.context().newPage();
  89  |   await newPage.goto(shareUrl);
  90  | 
  91  |   // Drop zone must be hidden
  92  |   await expect(newPage.locator('#drop-zone')).toBeHidden({ timeout: 10000 });
  93  | 
  94  |   // Receiver card must be visible
  95  |   await expect(newPage.locator('#receiver-card')).toBeVisible({ timeout: 10000 });
  96  | 
  97  |   // Filename must be populated
  98  |   const fileName = await newPage.locator('#rc-file-name').textContent();
  99  |   expect(fileName.trim()).toBeTruthy();
  100 |   expect(fileName.trim()).not.toBe('Loading…');
  101 | 
  102 |   await newPage.close();
  103 | });
  104 | 
```