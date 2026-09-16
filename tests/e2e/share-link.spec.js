// tests/e2e/share-link.spec.js
//
// Smoke test: upload a file → share link contains ?uuid= and # fragment →
// pasting that link shows the receiver card, not the upload drop zone.
//
// Runs against the live site: https://refueler.io/share/
// Runs headed (visible browser) so Cloudflare Turnstile can solve itself.
//
// Run:
//   cd /Users/rajeshtaylor/Documents/refueler-share
//   npx playwright test tests/e2e/share-link.spec.js --headed
//
// What this catches:
//   - uuid missing from share URL  ← the Sep 2026 breakage
//   - fragment missing entirely
//   - routing falls through to upload mode instead of download mode
//   - receiver card never appears

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const BASE_URL = 'https://refueler.io/share/';

function makeTempFile(name = 'refueler-e2e-test.txt') {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, 'refueler share e2e test payload ' + Date.now());
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — share URL structure
// Upload a file. Assert generated URL has ?uuid= and a non-empty #fragment.
// ─────────────────────────────────────────────────────────────────────────────
test('share URL contains ?uuid= and a non-empty fragment', async ({ page }) => {
  await page.goto(BASE_URL);
  await expect(page.locator('#drop-zone')).toBeVisible();

  const tmpFile = makeTempFile();
  await page.locator('#file-input').setInputFiles(tmpFile);
  await expect(page.locator('#options-card')).toBeVisible({ timeout: 5000 });

  // Wait for Turnstile to solve (headed browser, real widget — allow 60s)
  await expect(page.locator('#upload-btn')).toBeEnabled({ timeout: 60000 });

  await page.locator('#upload-btn').click();

  // Wait for share card — allow 30s for upload
  await expect(page.locator('#share-card')).toBeVisible({ timeout: 30000 });

  const shareUrl = (await page.locator('#share-link-display').textContent()).trim();
  expect(shareUrl).toBeTruthy();

  const parsed = new URL(shareUrl);

  const uuid = parsed.searchParams.get('uuid');
  expect(uuid, 'share URL must contain ?uuid=').toBeTruthy();
  expect(uuid).toMatch(/^[0-9a-f-]{36}$/i);

  const fragment = parsed.hash.slice(1);
  expect(fragment, 'share URL must contain a non-empty fragment').toBeTruthy();
  expect(fragment.length).toBeGreaterThan(10);

  fs.unlinkSync(tmpFile);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — recipient routing
// Navigate to a share URL. Assert receiver card appears, drop zone is hidden.
// ─────────────────────────────────────────────────────────────────────────────
test('navigating to a share URL shows receiver card not upload screen', async ({ page }) => {
  // Step 1: upload to get a real share URL
  await page.goto(BASE_URL);
  await expect(page.locator('#drop-zone')).toBeVisible();

  const tmpFile = makeTempFile('refueler-e2e-routing.txt');
  await page.locator('#file-input').setInputFiles(tmpFile);
  await expect(page.locator('#options-card')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#upload-btn')).toBeEnabled({ timeout: 60000 });
  await page.locator('#upload-btn').click();
  await expect(page.locator('#share-card')).toBeVisible({ timeout: 30000 });

  const shareUrl = (await page.locator('#share-link-display').textContent()).trim();
  fs.unlinkSync(tmpFile);

  // Step 2: open share URL in a fresh tab
  const newPage = await page.context().newPage();
  await newPage.goto(shareUrl);

  // Drop zone must be hidden
  await expect(newPage.locator('#drop-zone')).toBeHidden({ timeout: 10000 });

  // Receiver card must be visible
  await expect(newPage.locator('#receiver-card')).toBeVisible({ timeout: 10000 });

  // Filename must be populated
  const fileName = await newPage.locator('#rc-file-name').textContent();
  expect(fileName.trim()).toBeTruthy();
  expect(fileName.trim()).not.toBe('Loading…');

  await newPage.close();
});
