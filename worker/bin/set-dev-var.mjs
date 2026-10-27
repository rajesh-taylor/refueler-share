#!/usr/bin/env node
// worker/bin/set-dev-var.mjs — Stripe-Account-1 · 27 Oct 2026.
//
// Puts one secret into worker/.dev.vars (gitignored; read by `wrangler dev`)
// without it ever showing: the value comes from the VAL environment variable,
// set from a hidden zsh prompt, never from an argument (arguments land in ps
// and shell history). Prints the name and "set" — never the value or its length.
//
//   read -s "VAL?Value: " && echo
//   VAL="$VAL" node /Users/rajeshtaylor/Documents/refueler-share/worker/bin/set-dev-var.mjs STRIPE_SECRET_KEY
//   unset VAL
//
// SUPABASE_URL is not secret: `VAL=https://<ref>.supabase.co node … SUPABASE_URL`.
//
// Replaces the NAME=… line if there is one (every copy), else appends it. Other
// lines are kept byte for byte. Written to a temp file, mode 600, then renamed.
//
// Local sandbox only: refuses live Stripe keys (sk_live_ / rk_live_), and
// STRIPE_SECRET_KEY takes only an rk_test_ / sk_test_ key. (A live whsec_
// looks like a sandbox one, so that check rests on the hidden prompt's label.)

import { readFileSync, writeFileSync, renameSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV_VARS = join(dirname(fileURLToPath(import.meta.url)), '..', '.dev.vars');

// Production Supabase (already public in TESTING.md). Sandbox runs must never
// write its subscribers table (plan v1 S-6), so .dev.vars never points at it.
const PRODUCTION_SUPABASE_REF = 'tihgvdokeofnjxjkenmm';

// Per-name shape checks for the values -2 sets. Unknown names: any single line.
const SHAPES = {
  SUPABASE_URL:               /^(https:\/\/[a-z0-9]+\.supabase\.co|http:\/\/(127\.0\.0\.1|localhost):\d+)$/,
  STRIPE_SECRET_KEY:          /^(rk_test_|sk_test_)[A-Za-z0-9]+$/,
  STRIPE_WEBHOOK_SECRET:      /^whsec_[A-Za-z0-9]+$/,
  TURNSTILE_PLANS_SECRET_KEY: /^[A-Za-z0-9_-]+$/,
};

function fail(msg) {
  console.error(`set-dev-var: ${msg}`);
  process.exit(1);
}

const name = process.argv[2];
if (!name || process.argv.length !== 3) fail('usage: VAL="$VAL" node set-dev-var.mjs NAME');
if (!/^[A-Z][A-Z0-9_]*$/.test(name)) fail(`bad name ${JSON.stringify(name)} (A–Z, 0–9, _)`);

const value = process.env.VAL;
if (!value) fail('VAL is empty — run the hidden read -s prompt first');
if (/[\r\n\0]/.test(value)) fail('value has a line break or NUL — refused');
if (/^(sk|rk)_live_/.test(value)) fail('a live Stripe key never goes in .dev.vars — refused');
if (SHAPES[name] && !SHAPES[name].test(value)) fail(`value does not look like a sandbox ${name} — refused`);
if (name === 'SUPABASE_URL' && value.includes(PRODUCTION_SUPABASE_REF)) fail('that is the production Supabase project — sandbox runs never write it');

const before = existsSync(DEV_VARS) ? readFileSync(DEV_VARS, 'utf8') : '';
const lines = before === '' ? [] : before.replace(/\n$/, '').split('\n');
const line = `${name}=${value}`;
let found = false;
const after = lines.map(l => {
  if (l.startsWith(`${name}=`)) { found = true; return line; }
  return l;
});
if (!found) after.push(line);

const tmp = `${DEV_VARS}.tmp-${process.pid}`;
writeFileSync(tmp, after.join('\n') + '\n', { mode: 0o600 });
chmodSync(tmp, 0o600);
renameSync(tmp, DEV_VARS);
console.log(`set-dev-var: ${name} ${found ? 'replaced' : 'added'} in worker/.dev.vars (mode 600)`);
