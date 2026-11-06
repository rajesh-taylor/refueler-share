// H3 Smoke-1: the real built app, in this engine, under the real CSP, against the fake Worker.
// index.njk is upload AND receiver, so every flow goes through both modes, and the receiver is
// always a fresh browser context (a different person, nothing shared with the sender).
//
// What this proves: the app's flows and its use of the API. What it doesn't: the Worker's own
// behaviour (worker/test + worker/tests/integration), or Safari itself (Playwright WebKit is
// not Safari; see real-safari.mjs and the Safari + Mullvad check in CLAUDE.md).
import { test, expect } from '@playwright/test';
import { createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { unzipSync } = createRequire(import.meta.url)('../../../frontend/fflate.min.js');

const FAKE = 'http://localhost:8766';
const MIB = 1024 * 1024;
const CHUNK = 32 * MIB;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const ctl = (q) => fetch(`${FAKE}/_ctl?${q}`);

// One folder per test; files on disk so large ones don't hit Playwright's 50 MB buffer limit.
let dir;
test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'share-smoke-'));
  await ctl('fail=none&slow=0&rate=0');
});
test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

function makeFile(name, size) {
  const path = join(dir, name);
  const bytes = randomBytes(size);
  writeFileSync(path, bytes);
  return { path, name, bytes };
}

// ── Pages: CSP and script errors fail the test wherever they happen ─────────
function watch(page, problems) {
  page.on('console', (m) => { if (/Content.Security.Policy/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
}

// Chromium has showSaveFilePicker, and headless it can't be answered, so:
//   'blob'   removes it: the same save path as Firefox and Safari
//   'stream' answers it with a private-storage file: Chromium's real streaming path
const SAVE_BLOB = () => { window.showSaveFilePicker = undefined; };
const SAVE_STREAM = () => {
  window.showSaveFilePicker = async () => {
    const root = await navigator.storage.getDirectory();
    return root.getFileHandle('smoke-download', { create: true });
  };
};

async function sender(page, browserName, problems) {
  watch(page, problems);
  if (browserName === 'chromium') await page.addInitScript(SAVE_BLOB);
  return page;
}

async function receiver(browser, problems, save = SAVE_BLOB) {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(save);
  const page = await context.newPage();
  watch(page, problems);
  return page;
}

// ── Upload mode ──────────────────────────────────────────────────────────────
async function openUpload(page) {
  await page.goto('/');
  await expect(page.locator('#drop-zone')).toBeVisible();
  await expect(page.locator('#receiver-card')).toBeHidden();
}

async function setOptions(page, { password, dad }) {
  if (password) {
    await page.locator('#passphrase-toggle').check({ force: true });
    await page.locator('#passphrase-input').fill(password);
  }
  if (dad) await page.locator('#destroy-after-download').check({ force: true });
}

async function finishSend(page) {
  await page.locator('#upload-btn').click();
  await expect(page.locator('#share-card')).toBeVisible({ timeout: 90_000 });
  return (await page.locator('#share-link-display').textContent()).trim();
}

async function send(page, file, opts = {}) {
  await openUpload(page);
  await page.locator('#file-input').setInputFiles(file.path);
  await expect(page.locator('#options-card')).toBeVisible();
  await setOptions(page, opts);
  return finishSend(page);
}

function readLink(link) {
  const u = new URL(link);
  const fragment = u.hash.slice(1);
  const json = JSON.parse(Buffer.from(fragment, 'base64url').toString('utf8'));
  return { uuid: u.searchParams.get('uuid'), fragment, json, key: Buffer.from(json.k, 'base64url') };
}

// ── Receiver mode ────────────────────────────────────────────────────────────
async function openCard(page, link, file) {
  await page.goto(link);
  await expect(page.locator('#receiver-card')).toBeVisible();
  await expect(page.locator('#drop-zone')).toBeHidden();
  await expect(page.locator('#rc-size')).not.toBeEmpty();
  await expect(page.locator('#rc-expiry')).not.toBeEmpty();
  const reveal = page.locator('#receiver-card .rx-reveal');
  if (await reveal.count()) await reveal.click();
  await expect(page.locator('#receiver-card')).toContainText(file.name);
}

async function saved(page, press) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90_000 }), press()]);
  await expect(page.locator('#rx-done')).toBeVisible();
  return readFileSync(await download.path());
}

const closesWhenGone = async (uuid) => {
  await expect.poll(async () => (await fetch(`${FAKE}/meta`, { headers: { 'X-Transfer-UUID': uuid } })).status, { timeout: 10_000 }).toBe(410);
};

// ─────────────────────────────────────────────────────────────────────────────
test('send, then a stranger downloads the same bytes', async ({ page, browser, browserName }) => {
  const problems = [];
  await sender(page, browserName, problems);
  const seen = [];
  page.on('request', (r) => seen.push(r));

  const file = makeFile('smoke-private-name.bin', 64 * 1024);
  const link = await send(page, file);

  // The link: ?uuid= plus a v2 # part that describes this file.
  const { uuid, fragment, json, key } = readLink(link);
  expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
  expect(json).toMatchObject({ v: 2, n: file.name, z: file.bytes.length });
  expect(key.length).toBe(32);

  // Neither the key, the # part nor the name was in any URL, header or small body we sent.
  for (const r of seen) {
    const small = r.postDataBuffer()?.length < MIB ? r.postDataBuffer().toString('latin1') : '';
    const wire = r.url() + JSON.stringify(await r.allHeaders()) + small;
    for (const secret of [fragment, json.k, key.toString('hex'), file.name]) {
      expect(wire.includes(secret), `${secret.slice(0, 12)}… sent in ${r.method()} ${r.url()}`).toBe(false);
    }
  }

  // What was stored is ciphertext, and it opens outside the browser with the link's key alone.
  const stored = Buffer.from(await (await fetch(`${FAKE}/download`, { headers: { 'X-Transfer-UUID': uuid, 'X-Part': '0000' } })).arrayBuffer());
  expect(stored.length).toBe(file.bytes.length + 16);
  expect(stored.includes(file.bytes.subarray(0, 32))).toBe(false);
  const partKey = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), Buffer.from('refueler.share.payload.v2\0'), 32));
  const d = createDecipheriv('aes-256-gcm', partKey, Buffer.from('000000000000000000000001', 'hex'));
  d.setAAD(Buffer.alloc(4));
  d.setAuthTag(stored.subarray(-16));
  expect(sha(Buffer.concat([d.update(stored.subarray(0, -16)), d.final()]))).toBe(sha(file.bytes));

  const rx = await receiver(browser, problems);
  await openCard(rx, link, file);
  const got = await saved(rx, () => rx.locator('#rc-download-btn').click());
  expect(sha(got)).toBe(sha(file.bytes));
  await rx.context().close();
  expect(problems).toEqual([]);
});

test('a file over one part, parts stored in order and put back together', async ({ page, browser, browserName }) => {
  const problems = [];
  await sender(page, browserName, problems);
  const file = makeFile('two-parts.bin', CHUNK + 1024);
  const link = await send(page, file);
  const rx = await receiver(browser, problems);
  await openCard(rx, link, file);
  const got = await saved(rx, () => rx.locator('#rc-download-btn').click());
  expect(sha(got)).toBe(sha(file.bytes));
  await rx.context().close();
  expect(problems).toEqual([]);
});

test('half a link shows the notice, never the upload page', async ({ page, browser, browserName }) => {
  const problems = [];
  await sender(page, browserName, problems);
  const file = makeFile('half.bin', 1024);
  const link = await send(page, file);
  const { uuid, fragment } = readLink(link);
  const origin = new URL(link).origin;

  const rx = await receiver(browser, problems);
  for (const cut of [`${origin}/?uuid=${uuid}`, `${origin}/#${fragment}`]) {
    await rx.goto('about:blank');
    await rx.goto(cut);
    await expect(rx.locator('#rx-notice')).toBeVisible();
    await expect(rx.locator('#rx-notice-eyebrow')).toHaveText('Link incomplete');
    await expect(rx.locator('#drop-zone')).toBeHidden();
    await expect(rx.locator('#receiver-card')).toBeHidden();
  }
  await rx.context().close();
  expect(problems).toEqual([]);
});

test('the wrong key in a link saves nothing', async ({ page, browser, browserName }) => {
  const problems = [];
  await sender(page, browserName, problems);
  const file = makeFile('wrong-key.bin', 1024);
  const link = await send(page, file);
  const { uuid, json } = readLink(link);
  const wrong = Buffer.from(JSON.stringify({ ...json, k: Buffer.alloc(32, 7).toString('base64url') })).toString('base64url');

  const rx = await receiver(browser, problems);
  let downloads = 0;
  rx.on('download', () => { downloads++; });
  await openCard(rx, `${new URL(link).origin}/?uuid=${uuid}#${wrong}`, file);
  await rx.locator('#rc-download-btn').click();
  await expect(rx.locator('#rx-notice')).toBeVisible();
  await expect(rx.locator('#rx-done')).toBeHidden();
  expect(downloads).toBe(0);
  await rx.context().close();
  expect(problems).toEqual([]);
});

test('password: the wrong one stops it, the right one opens it', async ({ page, browser, browserName }) => {
  const problems = [];
  await sender(page, browserName, problems);
  const file = makeFile('locked.bin', 64 * 1024);
  const link = await send(page, file, { password: 'correct horse' });
  const { uuid } = readLink(link);

  // The password never went to the Worker at upload, and the part needs a token now.
  expect((await fetch(`${FAKE}/download`, { headers: { 'X-Transfer-UUID': uuid, 'X-Part': '0000' } })).status).toBe(401);

  const rx = await receiver(browser, problems);
  await openCard(rx, link, file);
  await expect(rx.locator('#rc-passphrase-row')).toBeVisible();
  await rx.locator('#rc-download-btn').click();
  await expect(rx.locator('#unlock-screen')).toBeVisible();

  await rx.locator('#unlock-input').fill('wrong horse');
  await rx.locator('#unlock-btn').click();
  await expect(rx.locator('#unlock-error')).toContainText('doesn’t open this file');
  await expect(rx.locator('#rx-done')).toBeHidden();

  await rx.locator('#unlock-input').fill('correct horse');
  const got = await saved(rx, () => rx.locator('#unlock-btn').click());
  expect(sha(got)).toBe(sha(file.bytes));
  await rx.context().close();
  expect(problems).toEqual([]);
});

test('delete after download: "Not now" keeps it, Download closes the link', async ({ page, browser, browserName }) => {
  const problems = [];
  await sender(page, browserName, problems);
  const file = makeFile('once.bin', 64 * 1024);
  const link = await send(page, file, { dad: true });
  const { uuid } = readLink(link);

  const rx = await receiver(browser, problems);
  await openCard(rx, link, file);
  await rx.locator('#rc-download-btn').click();
  await rx.locator('#pre-dl-modal-cancel').click();
  await expect(rx.locator('#receiver-card')).toBeVisible();
  expect((await fetch(`${FAKE}/meta`, { headers: { 'X-Transfer-UUID': uuid } })).status).toBe(200);

  await rx.locator('#rc-download-btn').click();
  const got = await saved(rx, () => rx.locator('#pre-dl-modal-btn').click());
  expect(sha(got)).toBe(sha(file.bytes));
  await expect(rx.locator('#rx-done-deleted')).toBeVisible();
  await rx.context().close();

  await closesWhenGone(uuid);
  const later = await receiver(browser, problems);
  await later.goto(link);
  await expect(later.locator('#rx-notice')).toBeVisible();
  await expect(later.locator('#receiver-card')).toBeHidden();
  await expect(later.locator('#drop-zone')).toBeHidden();
  await later.context().close();
  expect(problems).toEqual([]);
});

test('password and delete after download together', async ({ page, browser, browserName }) => {
  const problems = [];
  await sender(page, browserName, problems);
  const file = makeFile('locked-once.bin', 64 * 1024);
  const link = await send(page, file, { password: 'pw two', dad: true });
  const { uuid } = readLink(link);

  const rx = await receiver(browser, problems);
  await openCard(rx, link, file);
  await rx.locator('#rc-download-btn').click();
  await rx.locator('#pre-dl-modal-btn').click();
  await expect(rx.locator('#unlock-screen')).toBeVisible();
  await rx.locator('#unlock-input').fill('pw two');
  const got = await saved(rx, () => rx.locator('#unlock-btn').click());
  expect(sha(got)).toBe(sha(file.bytes));
  await expect(rx.locator('#rx-done-deleted')).toBeVisible();
  await rx.context().close();
  await closesWhenGone(uuid);
  expect(problems).toEqual([]);
});

test('a folder arrives as a zip with every file intact', async ({ page, browser, browserName }) => {
  const problems = [];
  await sender(page, browserName, problems);
  const folder = join(dir, 'Job 42');
  mkdirSync(join(folder, 'raw'), { recursive: true });
  const a = randomBytes(2048), b = randomBytes(70 * 1024);
  writeFileSync(join(folder, 'notes.txt'), a);
  writeFileSync(join(folder, 'raw', 'frame.bin'), b);

  await openUpload(page);
  await page.locator('#folder-input').setInputFiles(folder);
  await expect(page.locator('#options-card')).toBeVisible({ timeout: 30_000 });
  const link = await finishSend(page);
  expect(readLink(link).json.n).toBe('Job 42.zip');

  const rx = await receiver(browser, problems);
  await rx.goto(link);
  await expect(rx.locator('#receiver-card')).toBeVisible();
  const got = await saved(rx, () => rx.locator('#rc-download-btn').click());
  const files = unzipSync(new Uint8Array(got));
  const byName = Object.fromEntries(Object.entries(files).map(([k, v]) => [k.split('/').slice(-1)[0], v]));
  expect(sha(byName['notes.txt'])).toBe(sha(a));
  expect(sha(byName['frame.bin'])).toBe(sha(b));
  await rx.context().close();
  expect(problems).toEqual([]);
});

test('an upload carries on after a refresh, and the file arrives whole', async ({ page, browser, browserName }) => {
  const problems = [];
  await sender(page, browserName, problems);
  const file = makeFile('resume.bin', 2 * CHUNK + 1024);

  await ctl('slow=2500');   // long enough to refresh between parts
  await openUpload(page);
  await page.locator('#file-input').setInputFiles(file.path);
  await expect(page.locator('#options-card')).toBeVisible();
  let arrived = 0;
  page.on('requestfinished', (r) => { if (r.url().includes('/r2/')) arrived++; });
  await page.locator('#upload-btn').click();
  await expect.poll(() => arrived, { timeout: 60_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(300);   // the record is written just after the part arrives
  await page.reload();

  await expect(page.locator('#resume-card')).toBeVisible();
  // The refresh above killed requests on purpose, and WebKit reports that as a page error. Only
  // that moment is forgiven: everything from here on still fails the test.
  problems.length = 0;
  await expect(page.locator('#resume-file')).toHaveText(file.name);
  await ctl('slow=0');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#resume-notice-btn').click()]);
  await chooser.setFiles(file.path);
  await expect(page.locator('#share-card')).toBeVisible({ timeout: 90_000 });
  const link = (await page.locator('#share-link-display').textContent()).trim();

  const rx = await receiver(browser, problems);
  await openCard(rx, link, file);
  const got = await saved(rx, () => rx.locator('#rc-download-btn').click());
  expect(sha(got)).toBe(sha(file.bytes));
  await rx.context().close();
  expect(problems).toEqual([]);
});

test('Chromium: the streaming save path', async ({ page, browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium has showSaveFilePicker');
  const problems = [];
  await sender(page, browserName, problems);
  const file = makeFile('stream.bin', CHUNK + 1024);
  const link = await send(page, file);

  const rx = await receiver(browser, problems, SAVE_STREAM);
  await openCard(rx, link, file);
  await rx.locator('#rc-download-btn').click();
  await expect(rx.locator('#rx-done')).toBeVisible({ timeout: 90_000 });
  const hash = await rx.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const f = await (await root.getFileHandle('smoke-download')).getFile();
    const d = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
    return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
  });
  expect(hash).toBe(sha(file.bytes));
  await rx.context().close();
  expect(problems).toEqual([]);
});

// ── Turnstile-Gate-1: the check runs in the gate frame, never in the app ────
// The gate (serve-gate.mjs, :8768) is the real src/gate build under its real CSP, with the stub
// in place of Cloudflare's script; ?ts= on the app URL reaches it (harness build only).
const BLOCKED = /The security check couldn’t load\. A content blocker or VPN may be stopping it; allow challenges\.cloudflare\.com and gate\.share\.refueler\.io/;

async function pick(page, url, name = 'gate.bin') {
  await page.goto(url);
  await expect(page.locator('#drop-zone')).toBeVisible();
  await page.locator('#file-input').setInputFiles(makeFile(name, 4096).path);
  await expect(page.locator('#options-card')).toBeVisible();
}

test('gate: Cloudflare\'s script never loads in the app page; the frame is the gate, sandboxed', async ({ page, browserName }) => {
  const problems = [];
  await sender(page, browserName, problems);
  await pick(page, '/');
  const frame = page.locator('iframe#cf-gate');
  await expect(frame).toHaveAttribute('src', 'http://localhost:8768/');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(page.locator('#share-card')).toBeHidden();
  const link = await finishSend(page);
  expect(link).toContain('?uuid=');
  expect(await page.evaluate(() => typeof window.turnstile)).toBe('undefined');
  expect(await page.locator('script[src*="turnstile"]').count()).toBe(0);
  const gate = page.frames().find((f) => f.url().startsWith('http://localhost:8768/'));
  expect(await gate.evaluate(() => typeof window.turnstile)).toBe('object');
  expect(problems).toEqual([]);
});

test('gate: Cloudflare asks for a click → the box shows; a forged token from the page is ignored; the tick, then the press, uploads', async ({ page, browserName }) => {
  const problems = [];
  await sender(page, browserName, problems);
  await pick(page, '/?ts=click');
  await expect(page.locator('#turnstile-wrap')).toBeVisible();
  await expect(page.locator('#upload-btn')).toBeDisabled();
  // Not from the gate frame: dropped (source and origin checks).
  await page.evaluate(() => window.postMessage({ t: 'refueler-gate', v: 1, op: 'token', id: 'x', token: 'forged' }, '*'));
  await page.waitForTimeout(300);
  await expect(page.locator('#upload-btn')).toBeDisabled();
  await page.frameLocator('iframe#cf-gate').getByText('Verify you are human (stub)').click();
  await expect(page.locator('#upload-btn')).toBeEnabled();
  await expect(page.locator('#turnstile-wrap')).toBeHidden();
  const link = await finishSend(page);
  expect(link).toContain('?uuid=');
  expect(problems).toEqual([]);
});

test('gate: Cloudflare\'s script blocked inside the gate → the blocked line at once, the button back', async ({ page, browserName }) => {
  const problems = [];
  await sender(page, browserName, problems);
  await pick(page, '/?ts=blocked');
  await page.locator('#upload-btn').click();
  await expect(page.getByText(BLOCKED)).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#upload-btn')).toHaveText('Encrypt and upload');
  await expect(page.locator('#upload-btn')).toBeEnabled();
  expect(problems).toEqual([]);
});

test('gate: the gate page itself unreachable → the blocked line 15 s after the press', async ({ page, browserName }) => {
  const problems = [];
  await sender(page, browserName, problems);
  await page.route('http://localhost:8768/**', (r) => r.abort());
  await pick(page, '/');
  await page.locator('#upload-btn').click();
  await expect(page.locator('#upload-btn')).toHaveText('Checking…');
  await expect(page.getByText(BLOCKED)).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('#upload-btn')).toHaveText('Encrypt and upload');
  // The next press inserts a fresh frame; with the gate back, the upload goes through.
  await page.unroute('http://localhost:8768/**');
  const link = await finishSend(page);
  expect(link).toContain('?uuid=');
});

test('gate: a top-level visit shows one line and loads no Cloudflare script', async ({ page }) => {
  await page.goto('http://localhost:8768/');
  await expect(page.getByText('This page works only inside Share.')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => typeof window.turnstile)).toBe('undefined');
  expect(await page.locator('script[src*="turnstile"]').count()).toBe(0);
});

test('gate: sign-in gets its token through the gate; the frame takes no room until asked', async ({ page, browserName }) => {
  const problems = [];
  await sender(page, browserName, problems);
  await fetch(`${FAKE}/_ctl?signout=1`);
  await page.goto('/signin/');
  const frame = page.locator('#si-check iframe#cf-gate');
  await expect(frame).toHaveAttribute('src', 'http://localhost:8768/');
  await expect(page.locator('#si-send')).toBeEnabled();
  expect((await frame.boundingBox())?.height ?? 0).toBe(0);
  expect(await page.evaluate(() => typeof window.turnstile)).toBe('undefined');
  await page.locator('#si-email').fill('dev@refueler.io');
  await page.locator('#si-send').click();
  await expect(page.locator('#signin-sheet')).toHaveAttribute('data-state', 'sent');
  expect(problems).toEqual([]);
});

// Cloudflare's real script in the gate, with its always-pass test sitekey (needs the network;
// run with SMOKE_REAL_TURNSTILE=1). The spike (plan §11) covered the fail and click test keys.
test('gate: real Turnstile (test sitekey) in the gate → upload', async ({ page, browserName }) => {
  test.skip(!process.env.SMOKE_REAL_TURNSTILE, 'set SMOKE_REAL_TURNSTILE=1 (network)');
  const problems = [];
  await sender(page, browserName, problems);
  await pick(page, '/?ts=real');
  const link = await finishSend(page);
  expect(link).toContain('?uuid=');
  expect(await page.evaluate(() => typeof window.turnstile)).toBe('undefined');
  expect(problems).toEqual([]);
});
