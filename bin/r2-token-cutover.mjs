#!/usr/bin/env node
// R2 token cut-over (Worker-Keys-1 · 4 Nov 2026). One command, stays open from start to finish,
// and walks through it. Against production. Writes one 1-byte object to refueler-share-dev.
//
//   1  old token: a dev-bucket URL from /admin/r2-presign-test, upload    → 2xx (the control)
//      You make the prod-only token and put it in a second window; press Return.
//   2  new token: the signing key has changed                             → yes
//   3  new token: a dev-bucket URL, upload                                → 403 (production can't reach dev)
//      You run an upload and download in Safari, delete the old token; press Return.
//   4  the URL from step 1, signed by the old token, upload               → 401 (R2 no longer knows the key; 403 also passes)
//
// The URL from step 1 lives only in this process's memory, because it is the proof for step 4. It
// and the Access token are never printed or written. So if this window closes before step 4, that
// proof is gone: the token's absence from the dashboard is then all you have.
//
// Run in Terminal.app (the key typed once, hidden; never in argv or history):
//   read -s "KEY?Admin key: " && echo && KEY="$KEY" node /Users/rajeshtaylor/Documents/refueler-share/bin/r2-token-cutover.mjs

import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const ADMIN = 'https://admin.share.refueler.io';
const OBJECT = 'worker-keys-1/token-check';
const KEY = (process.env.KEY || '').replace(/\x1b\[20[01]~/g, '').trim();
// How long to wait for R2 to catch up with a secret put or a token deletion.
const SETTLE_MS = 5 * 60_000;
const RETRY_MS = 15_000;

const stop = (s) => { console.error(`✗ ${s}\n  Stopped: nothing further was done.`); process.exit(1); };
const ok = (s) => console.log(`✓ ${s}`);

async function pressReturn(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(`\n${prompt}\nPress Return when that is done. `);
  rl.close();
  console.log('');
}

function accessToken() {
  const ask = () => {
    try {
      return execFileSync('cloudflared', ['access', 'token', `-app=${ADMIN}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { return ''; }
  };
  let token = ask();
  if (!token) {
    console.log('Signing in through Cloudflare Access: a browser window opens once.');
    try { execFileSync('cloudflared', ['access', 'login', ADMIN], { stdio: 'ignore' }); } catch { /* the next ask says */ }
    token = ask();
  }
  return token;
}

async function devUrl() {
  // Before the fetch's timeout starts: a browser sign-in here can take longer than the timeout.
  const access = accessToken();
  const res = await fetch(`${ADMIN}/admin/r2-presign-test`, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
    headers: { 'cf-access-token': access, 'X-Admin-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: OBJECT }),
  });
  if (res.status !== 200) stop(`/admin/r2-presign-test answered ${res.status}. Is the admin key right, and Access signed in?`);
  const { url, bucket } = await res.json();
  if (bucket !== 'refueler-share-dev') stop(`the route presigned for ${bucket}, not the dev bucket`);
  return url;
}

const signingKey = (url) => new URL(url).searchParams.get('X-Amz-Credential')?.split('/')[0] ?? '';

async function put(url) {
  try {
    const res = await fetch(url, { method: 'PUT', body: new Uint8Array([0x2e]), signal: AbortSignal.timeout(30_000) });
    await res.arrayBuffer();
    return res.status;
  } catch (e) {
    return `network error (${e.name})`;
  }
}

// R2 may take a moment to act on a change: keep asking until it answers `want`, or time runs out.
async function putUntil(url, want, label) {
  const end = Date.now() + SETTLE_MS;
  for (;;) {
    const status = await put(url);
    if (status === want) return status;
    if (Date.now() > end) return status;
    console.log(`  ${label}: answered ${status}, want ${want}. Trying again in ${RETRY_MS / 1000} s.`);
    await sleep(RETRY_MS);
  }
}

async function main() {
  if (!KEY) stop('no admin key. Start it with the read -s line at the top of this file.');
  console.log(`R2 token cut-over — ${new Date().toISOString()} (UTC)\n`);

  const oldUrl = await devUrl();
  const first = await put(oldUrl);
  if (first !== 200) {
    stop(`step 1 answered ${first}, not 200. If the Worker already holds the prod-only token, the old token can't be tested this way.`);
  }
  ok('1  old token reaches refueler-share-dev (the control: the check can tell the two apart)');

  await pressReturn('NOW, IN THE OTHER WINDOW: create the prod-only token in the dashboard and put it, as in the chat.\nLeave this window open.');

  const newUrl = await devUrl();
  if (signingKey(newUrl) === signingKey(oldUrl)) stop('step 2: the Worker is still signing with the old key. Was the secret put?');
  ok('2  the Worker now signs with a different key');

  const second = await putUntil(newUrl, 403, 'step 3');
  if (second !== 403) stop(`step 3 answered ${second}, not 403: production's token may still reach the dev bucket. Keep the old token.`);
  ok("3  production's token can't reach refueler-share-dev (403)");

  await pressReturn('NOW, IN SAFARI: upload and download a file on https://share.refueler.io/ .\nOnly if both work: delete the OLD token in the dashboard, and only then come back here.\nIf either fails, press Ctrl-C and keep the old token.');

  // Live answer on 4 Nov 2026 was 401: R2 no longer knows the key. 403 is a refusal too; a 2xx is not.
  let last = await put(oldUrl);
  const refused = (s) => s === 401 || s === 403;
  for (const end = Date.now() + SETTLE_MS; !refused(last) && Date.now() <= end; last = await put(oldUrl)) {
    console.log(`  step 4: answered ${last}, want 401 or 403. Trying again in ${RETRY_MS / 1000} s.`);
    await sleep(RETRY_MS);
  }
  if (!refused(last)) stop(`step 4 answered ${last}: the old token still works, or R2 hasn't caught up. Check the dashboard, then ask.`);
  ok(`4  the old token is dead (${last})`);

  console.log('\n✓ R2 cut-over proved. Paste these four lines into the chat.');
}

main().catch((e) => stop(`unexpected: ${e.message}`));
