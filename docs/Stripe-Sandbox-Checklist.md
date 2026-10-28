# Stripe sandbox test-through — checklist

> First run: Stripe-Account-2 · 28 Oct 2026 (all green, results below).
> Re-run at **B12-6** (portal, billing) and at the **deploy sitting** (before the
> new account goes live). Sandbox only: never a live key, never the production
> Supabase project, no deploy. Rajesh types every key and card; scripts never
> print a secret.

Helper scripts: `dev/stripe-sandbox/` — each refuses a production Supabase URL
or a live Stripe key (`lib.mjs`).

---

## 0 · Set-up

1. **Sandbox Supabase** — project `refueler-share-sandbox`, created with
   "Automatically expose new tables" **off**. Apply every file in
   `supabase/migrations/` in filename order (SQL editor, one tab each). The
   baseline's explicit grants exist for exactly this project shape.
   Check: service_role only on public tables, nothing for anon/authenticated.
2. **`worker/.dev.vars` → sandbox.** Back up the production file first
   (`.dev.vars.production`, mode 600, gitignored by `.dev.vars.*`). Every secret
   goes in through a hidden prompt in Terminal.app, never chat:
   ```
   read -s "VAL?<name>: " && echo
   VAL="$VAL" node /Users/rajeshtaylor/Documents/refueler-share/worker/bin/set-dev-var.mjs <NAME> && unset VAL
   ```
   | var | value |
   |---|---|
   | `SUPABASE_URL` | `https://<sandbox ref>.supabase.co` (bare) |
   | `SUPABASE_SERVICE_KEY` | sandbox service_role key |
   | `STRIPE_SECRET_KEY` | restricted key `share-worker-sandbox`: Customers W, Subscriptions W, Invoices R, PaymentIntents R, Prices R |
   | `STRIPE_WEBHOOK_SECRET` | the `whsec_` that `stripe listen` prints |
   | `TURNSTILE_SECRET_KEY`, `TURNSTILE_PLANS_SECRET_KEY` | Cloudflare always-pass test secret `1x0000000000000000000000000000000AA` |
   | `PLANS_TURNSTILE_HOSTNAME` | `example.com` (what the test secret returns) |
   | `MINT_PRIVATE_KEY`, `COMMITMENT_KEY`, `HELPER_KEY`, `WEBHOOK_SIGNING_MASTER_KEY` | random hex(32) |
   | `AUTH_PEPPER`, `KV_MAC_KEY`, `QUOTA_REF_KEY`, `TEST_CRED_KEY`, `UPLOAD_SESSION_KEY`, `SHARE_SEAL_KEY_1` | random base64(32) |
   | `CF_ACCOUNT_ID`, `R2_S3_ACCESS_KEY_ID`, `R2_S3_SECRET_ACCESS_KEY` | placeholders — upload URLs get signed, never used |
   | `ADMIN_KEY` | random, sandbox only (for `admin-figures.mjs`) |
   | `R2_BUCKET_NAME` | `refueler-share-dev` |

   wrangler reads `.dev.vars` only at start: restart `wrangler dev` after any change.
3. **Stripe prices** in the sandbox carry lookup keys `share-citizen-monthly`
   (£24/month) and `share-citizen-yearly` (£288/year).
4. **Four Terminal.app tabs:**
   1. `stripe login` (90-day login; next expiry ≈ 26 Jan 2027), then
      `stripe listen --forward-to http://localhost:8787/webhook/stripe --events customer.subscription.created,customer.subscription.updated,customer.subscription.deleted`
   2. spare (hidden prompts)
   3. `cd worker && npx wrangler dev` → `Ready on http://localhost:8787`
   4. refueler.io on the Stripe-Account-1 branch: `ELEVENTY_RUN_MODE=serve` with
      `PLANS_STRIPE_PK` (pk_test_ only) and the local Worker URL → Plans at
      `http://localhost:8080/share/plans/`. A plain build stays LIVE and keeps
      Citizen "Coming soon".

## 1 · Checkout (Safari, Plans local)

| # | plan | email | card | expect |
|---|---|---|---|---|
| 1a | Monthly | citizen-test-1@example.com | 4242 4242 4242 4242 | "You're all set"; row citizen · active · period end +1 month; `created` + `updated` [200] |
| 1b | Yearly | citizen-test-2@example.com | 4000 0027 6000 3184 (3DS) | row **inactive** while the 3DS window is open; Complete → **active**, period end +1 year |
| 1c | Monthly | citizen-test-3@example.com | 4000 0000 0000 0002 | "Your card has been declined"; row **inactive** (not paid) |

Expiry 12/30, CVC 123. Check rows: `node dev/stripe-sandbox/subscribers.mjs`.

## 2 · Webhook

- `node dev/stripe-sandbox/webhook-checks.mjs citizen-test-1@example.com` →
  **500** (re-fetch fails, so Stripe retries) · **401** (10-minute-old event) · **200**.
- `stripe listen` never retries. At the deploy sitting, check retries on the real
  endpoint: Stripe dashboard → Webhooks → the endpoint → event attempts.

## 3 · Cancel

The in-app portal returns at B12-6 (`POST /billing/portal`). Until then cancel
from the Stripe dashboard (Subscriptions → the row's ⋯, or the subscription's
Actions — the Customers ⋯ only offers Delete) or the test API.

| # | who | how | expect |
|---|---|---|---|
| 3a | test-1 | cancel at period end | `updated` [200]; row stays citizen · active to period end |
| 3b | test-2 | cancel immediately | `deleted` [200]; row free · cancelled · cancelled_at set |

At B12-6: repeat 3a through the portal.

## 4 · Sign-in and upload (local Worker)

- `node dev/stripe-sandbox/signin.mjs citizen-test-1@example.com citizen-test-2@example.com citizen-test-3@example.com`
  → verify 200 · session 200 · kind citizen · tier **citizen** / **free** / **free**.
  (Skips the email; the magic-link send is B12-4a's own test.)
- `node dev/stripe-sandbox/citizen-upload.mjs citizen-test-1@example.com citizen-test-2@example.com`
  → 200 · 402 full · 413 (101 GiB) · 400 (91 days) · 401 (commitment) · 400 free · 400 free.
- `node dev/stripe-sandbox/admin-figures.mjs` → citizen 1 · paid_total 1 ·
  MRR £24 · cancelled_mtd 1 (the figures Navy Office shows; Navy Office itself
  talks only to production).

## 5 · Close

- `cd worker && npm test` green.
- Restore `.dev.vars` from `.dev.vars.production` only when production work
  resumes (keep the sandbox file otherwise).
- Nothing deploys from this checklist.

---

## Notes from the first run (28 Oct 2026)

- **Plans:** the Citizen card had no click handler and never revealed the
  payment form (paid cards went "Coming soon" around 16 Oct). Fixed on the
  refueler.io Stripe-Account-1 branch; a live build is unchanged.
- **Postcode:** the Payment Element on Plans **does** ask for a UK postcode, so
  Radar's postcode rule can fire.
- **Abandoned checkouts:** an unpaid (incomplete) subscription stays `inactive`
  until Stripe expires it (≈ 23 h) — it never counts as paid.
- **`npm run test:integration` was stale** (not caused by this run): config
  used `testMatch`, which Vitest ignores, and its client predated
  UUID-Out-Of-Path-1 and credential v2. Repaired the same day
  (Integration-Repair-1): integration tests only, 68 green, and it no longer
  touches `.dev.vars`. It still doesn't cover Citizen or Chartered initiates —
  the scripts above do.
