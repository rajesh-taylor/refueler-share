# B7 prep: Cashu mint and Lightning node for the anonymous rail

As of **11 October 2026**. This is engineering research, not legal or tax advice.

**Legend**
- ✅ **Verified** against a primary source: the spec text, source code at a named commit, an official repo README or release tag, or the vendor's own words.
- 🟡 **Secondary**: a blog, forum, review site, a third-party issue tracker, or a search-engine extract.
- 🔵 **Inferred**: my own reasoning from the verified facts.
- **Not found** means I looked and came up empty.

**How sources were read.** Everything was read on 11 Oct 2026.
- **Repos cloned and read directly:**
  - `cashubtc/nuts`, HEAD dated 2026-09-24.
  - `cashubtc/cdk`, HEAD dated 2026-10-10, tag v0.18.1.
  - `cashubtc/nutshell`, HEAD dated 2026-10-09, version 0.21.0.
  - `ACINQ/phoenixd`, HEAD dated 2026-10-08, tag v0.9.2.
- **ACINQ's docs site was blocked.** phoenix.acinq.co returned **HTTP 403** to this environment. Every phoenixd fact marked ✅ therefore comes from phoenixd's **source code**, not its docs.
- **ACINQ's terms of service were not read.** Fee-credit and liquidity rules come from the text phoenixd prints on first run (in the source) and from a public issue thread.

---

# Part 1: Plain-English summary

## The short answer

**Don't adopt cdk-mintd for B7.** Keep your own Worker mint, add phoenixd alone (no LNbits) on the Hetzner box, and borrow the race-safety patterns CDK uses. Revisit a real mint only if you ever want to hold or pay out sats rather than sell upload credits.

## Five things that change the plan

1. **Neither real mint can talk to phoenixd.**
   - CDK removed its LNbits backend after v0.17 ✅. Nutshell removed its own in 0.21.0, released 16 Sep 2026 ✅. Neither has had a phoenixd backend since CDK dropped an early one ✅.
   - "phoenixd + LNbits + CDK" therefore means running **three daemons**. LNbits would be bolted on through a payment processor CDK itself labels "Tier 3, experimental" ✅.
   - The alternative is writing your own Rust payment processor for CDK.
   - LNbits is no longer a bridge to anything you need, so drop it.
2. **Your credentials are vouchers, not money. Keep them that way.**
   - A sat-denominated mint that lets people cash out (a "melt") makes Refueler the custodian of other people's bitcoin. That breaks your own "no custodial providers" rule, with you as the custodian 🔵.
   - It also sits squarely inside the UK cryptoasset regime going live 25 Oct 2027, per the live-streaming research file in this repo 🟡.
   - A one-way "credit" unit that can only buy uploads is a much smaller thing. A full mint brings swap and melt endpoints you'd have to switch off or defend.
3. **One verification shortcut silently breaks anonymity. Never use it.**
   - Cashu lets a third party check a token using only the mint's public key, via the NUT-12 DLEQ proof. To do that, the token must carry the user's **blinding factor `r`** ✅.
   - The spec warns that with `r`, the mint "can associate the BlindSignature with the Proof" ✅.
   - Refueler is both the mint and the verifier. Accepting `r` at upload lets you join "this upload" back to "this Lightning payment" 🔵.
   - Checking the DLEQ in the browser (the user checking you) is fine and should stay. The server must never receive or log `r`.
4. **phoenixd webhooks fire once and are never retried.**
   - The code sends each webhook once and, on failure, only writes a log line ✅.
   - "First one wins" crediting must therefore work from **webhook OR polling**, funnelled into one idempotent database call.
5. **Budget about 1% for inbound liquidity, and pre-fund the channel yourself.**
   - With phoenixd's default 2,000,000-sat auto-liquidity, one real purchase cost **21,000 sats service fee + 411 sats mining fee** (Mar 2026) ✅/🟡.
   - Payments too small to open a channel go into a **"fee credit"** that phoenixd's own startup text says is **"non-refundable"** ✅.
   - Your first customer's £3 should not vanish into ACINQ's tip jar. Open the channel with your own ~25k+ sats before launch 🔵.

## Answers, one paragraph each

**1. Which mint?**
- **CDK** is the most complete: every NUT from 00 to 30 except 24, Postgres, ARM Docker images and static binaries, and keyset rotation tooling ✅.
- But CDK still calls itself **ALPHA**. It shipped a breaking config migration in v0.18.0 (2 Sep 2026), has no phoenixd backend, and has no formal audit ✅/Not found.
- **Nutshell** is Python, also unaudited, and has no phoenixd backend. Its remaining backends are CLN, LND, Spark and Strike ✅. Strike is a US custodian, which your rules exclude.
- **Your Worker mint** is the least code, already in production, and fits the voucher model. Its risk is hand-rolled crypto, which you fix with test vectors, not a rewrite.
- **Trust story.** If the mint moves to Hetzner and the Worker "only verifies", the Worker either still holds the private key (so nothing changes), or calls Hetzner on every upload (Hetzner becomes a single point of failure). The third option, DLEQ with `r`, breaks anonymity (point 3 above).

**2. NUT status.**
- **Settled and widely implemented:** NUT-11 (P2PK) and NUT-20 (signed mint quotes).
- **Wallet-side only:** NUT-18 (payment requests, including Nostr transport); no mint needs to implement it.
- **Still moving:**
  - NUT-24 (HTTP 402) has **no listed implementations** ✅.
  - NUT-25 (BOLT12) is cdk-mintd-only and was edited as recently as 16 Sep 2026 ✅.
- **Interesting but needs accounts:** NUT-22 blind auth is almost exactly your upload-credential design: a unit `auth`, amount `1`, single-use tokens ✅. It needs an OpenID login to obtain them, so it doesn't fit an account-free rail.
- **Copy cheaply:** NUT-24's header shape, so your upload endpoint speaks a standard dialect.

**3. phoenixd.**
- **What ACINQ sees:**
  - Every incoming payment's amount, timing and payment hash, because ACINQ is your only channel peer 🔵.
  - Both ends of anything you send, because outgoing payments go via ACINQ's trampoline node ✅/🟡.
  - Both ends of a customer's payment too, if that customer also uses Phoenix 🔵.
- **Fees:**
  - About 1% + 1,000 sats per inbound-liquidity purchase, plus mining fees ✅/🟡.
  - Payers pay ACINQ a last-hop fee of 1 sat + 0.01% ✅.
- **Platform and backup:** It runs natively on Linux ARM64 ✅. Back up the whole data directory, not just the seed 🔵.
- **If ACINQ stops serving the UK:**
  - The US precedent (May 2024) was: leave the app stores, and tell users to close channels cooperatively 🟡.
  - Keep the float low and sweep often, so an exit is a tidy mutual close and not an archaeology project.

**4. Privacy of the loop.**
- **What the blind signature hides:** The cryptography already stops anyone joining "who paid" to "which upload" through the token itself.
- **What still leaks:**
  - The same IP address at purchase and at upload. Cloudflare sees both whatever you do.
  - Purchase timing followed by upload timing.
  - Purchase size compared with how many uploads follow.
  - A short keyset period, which shrinks the crowd you hide in.
  - **Most of all, a tiny user base.**
- **Mitigations:** fixed pack sizes, long keyset periods, never forcing users to swap old credits, a fresh key per quote, no IP logging, and stripping `r`.

**5. Race safety.**
- **CDK's approach:** CDK's Postgres schema is a good crib sheet ✅:
  - the payment hash is unique per quote, and each payment is unique per quote;
  - a counter means "issued" can never exceed "paid";
  - each blinded output is a primary key, so it can't be signed twice;
  - each spent proof is a primary key on `Y`, with a PENDING then SPENT state;
  - quote rows are locked with `SELECT … FOR UPDATE`.
- **Rule of thumb:** the winner is decided by one `INSERT … ON CONFLICT DO NOTHING`, or one conditional `UPDATE … RETURNING`. Never read in app code and then write.

**6. Recommendation and build order.** In Part 2, §6. Roughly:
1. phoenixd on a CAX21, behind a private tunnel, with a limited-access password.
2. Four Postgres tables and three database functions.
3. A NUT-04-shaped quote and mint flow in the Worker, with a custom `credit` unit and NUT-20 required.
4. Upload spending made PENDING then SPENT.
5. A liquidation runbook (phoenixd cannot pay a Silent Payments address directly ✅).
6. The test plan.

---

# Part 2: Technical appendix

## §1. Mint choice

### 1.1 Comparison (as of 11 Oct 2026)

| | **CDK `cdk-mintd`** | **Nutshell** | **Your Worker mint** |
|---|---|---|---|
| Latest | v0.18.1, **2026-09-18** ✅ (v0.18.0 2026-09-02; v0.17.7 backport 2026-09-16) | 0.21.0, **2026-09-16** ✅ | n/a |
| Language | Rust (MSRV 1.85) ✅ | Python. README says use 3.12; 3.13/3.14 fail to build `coincurve` ✅ | TypeScript on Workers |
| Self-description | "ALPHA… the api will change" and "works with real sats! Always use amounts you don't mind losing" ✅ | No explicit alpha warning ✅ | n/a |
| Formal third-party audit | **Not found** | **Not found** | None |
| Community conformance testing | Amperstrand/cashu-audit: a cross-implementation test matrix, not a paid audit; reports dated Jul to Sep 2026 🟡 | Same project; filed a liveness bug upstream (nutshell#1178) 🟡 | Could run its NUT-00/12 vectors 🔵 |
| NUT coverage (mint) | 00–30 except 24 ✅ | 00–23 plus 29 (not 25/30 per matrix) ✅ | 00-ish, 12 (DLEQ out) |
| Postgres | Yes (`[database] engine = "postgres"`). **"Only one active cdk-mintd process may use a database"**; replica coordination arrived in v0.18 with advisory locks ✅ | Yes, plus a SQLite→Postgres migration script ✅ | Yes (your spent-serial table) |
| ARM64 | Docker `linux/arm64` (built on `ubuntu-24.04-arm`) and static aarch64 binaries ✅ | Docker `linux/amd64,linux/arm64` ✅ | n/a (Cloudflare) |
| Keyset rotation | `cdk-mint-cli rotate-next-keyset`; v0.18 adds a "keyset epoch used for coordinated rotations"; keyset v2 is default for new keysets ✅ | "Keyset rotations" listed as supported; v2 keysets since 0.20.0 ✅/🟡 | Manual |
| Lightning backends | CLN, LND, LDK Node built in. External gRPC processors: **Bark (Tier 1)**, **Spark (Tier 2)**, **LDK Server and LNbits (Tier 3, "experimental and carry additional risk")** ✅ | `clnrest`, `lndrest`, `lnd_grpc`, `sparkl2`, `strike`, `fake` ✅. LNbits, Blink and old CLN-REST removed in 0.21.0 ✅ | phoenixd via your own code |
| **phoenixd** | **No.** `cdk-phoenixd` existed early on and is gone ✅ | **No** ✅ | Yes, if you write it (small) |
| **LNbits** | Removed after v0.17: "LNbits integrations can move to an external payment processor" ✅ | Removed in 0.21.0 ✅ | Not needed |
| Custom units | `CurrencyUnit::Custom(String)` exists ✅; pricing a `credit` unit in sats means writing your own payment processor 🔵 | Not checked | Already `amount: 1` only |
| Remote key custody | `[signatory]` remote signer; mintd refuses a local seed when remote is on ✅ | n/a | Worker secret |
| Admin UI | Orchard supports Nutshell and cdk-mintd, and LND and CLN, but **not phoenixd**; its maintainers say the mint RPCs are "nascent" 🟡 | Same | Your own |
| Ops burden for one person | **High.** Config moved into the DB in v0.18 ("REQUIRED MINT OPERATOR ACTION"), and DB migrations come most months. Plus a payment processor you write yourself, plus phoenixd ✅/🔵 | **Medium-high.** Python pin, migrations each minor release, no phoenixd ✅/🔵 | **Low.** Plus phoenixd 🔵 |

Excluded by your own rules 🔵:
- **Strike**: a US custodian.
- **Spark**: Lightspark, a US company, runs the operators. I believe this but have not verified it here.
- **LNbits as a funding source**: still self-hosted, but no longer a supported bridge.

### 1.2 What changes in the trust story if the mint runs on Hetzner and the Worker "only verifies"

Verifying a Cashu proof means checking `C == k·hash_to_curve(secret)`, which needs the **private key `k`** (NUT-00) ✅. There are three ways to do it:

| Option | How the Worker verifies | Forging credits possible from | Upload path depends on Hetzner? | Unlinkability |
|---|---|---|---|---|
| **A. Worker holds a copy of `k`** | Locally, as today | Hetzner **and** Cloudflare (Worker secrets) | No | Intact |
| **B. Worker asks the mint** | Calls a mint "spend" endpoint (e.g. NUT-03 swap, or a custom one), so the double-spend authority moves to the mint's DB | Hetzner only | **Yes**: every upload needs the CAX21 up | Intact |
| **C. DLEQ with `r`** (NUT-12 "Carol") | Public key only | Hetzner only | No | **Broken.** Same operator can recompute `B' = Y + r·G` and look up which quote it was minted for ✅ spec / 🔵 consequence |

🔵 Consequences:
- **Option A is today's trust story with extra moving parts.** Cloudflare can still forge credits, but not steal sats, because credits are not redeemable for sats.
- **Option B is the honest "Worker only verifies" model.** It turns a €7-a-month ARM box into your upload SLA.
- **Option C is a privacy bug that looks like a feature.**
- **If you move to CDK later**, the keys can't be carried across. No NUT specifies how a mint derives private keys from its seed: Nutshell uses HMAC-SHA256 and CDK uses BIP32 hardened paths ✅🟡 (Amperstrand/cashu-audit#27, 18 Sep 2026).
  - Plan a **new keyset**, with the Worker accepting the old keyset until its final expiry.

### 1.3 The regulatory angle in one table

| Design | What the user holds | Who holds the sats | Feel 🔵 |
|---|---|---|---|
| Sat mint with melt (CDK/Nutshell default) | Bearer claims on Refueler's bitcoin, cashable to Lightning | Refueler | Custodial wallet. In scope of the UK cryptoasset regime from 25 Oct 2027 (see `research/live-streaming-research-2026-10.md` D3) 🟡 |
| One-way `credit` unit, no melt, no swap (your design) | Prepaid upload vouchers | Refueler, as revenue on sale | Prepaid service. Get advice, but a much smaller surface |

---

## §2. NUT status

Source: `cashubtc/nuts` README matrix and the spec files, HEAD 2026-09-24 ✅. "Last edit" is the git date of that NUT's file.

| NUT | What | Last edit | Mints (matrix) | Wallets (matrix) | Relevance to B7 |
|---|---|---|---|---|---|
| **04** | Mint quotes. Now `amount_paid` / `amount_issued` / `updated_at`; `state` deprecated | 2026-09-15 | all | all | **Copy its shape and rules** (§5) |
| **11** | P2PK | 2026-09-14 | Nutshell, cdk-mintd, nutmix | Nutshell, cashu-ts, cdk, Cashu.me, Minibits, Sovran | Not for credits 🔵: a reused pubkey is a linking tag. NUT-28 (P2BK: blinds the key) fixes that for wallets |
| **12** | DLEQ | 2026-09-11 | Nutshell, cdk-mintd, nutmix | Nutshell, cashu-ts, cdk, Minibits | Keep browser-side checking; **server must never receive `r`** |
| **18** | Payment requests (`creqA`). Transports: `nostr` (NIP-17 DM), `post` (HTTP), or empty = in-band | 2026-07-21 | n/a (wallet-side) | cashu-ts, Cashu.me, cdk, Minibits, Sovran | Later, for "pay with ecash from your own mint" 🔵. **Nostr transport needs a long-running listener**, so it goes on Hetzner, not a Worker (house no-Durable-Objects rule) 🔵 |
| **19** | Cached responses (idempotent replays) | 2025-02-01 | Nutshell, cdk-mintd, nutmix | cashu-ts | Get it for free via deterministic signatures (§5.3) |
| **20** | Signed mint quotes: a pubkey on the quote, and a signature required to mint | 2026-07-07 | cdk-mintd, Nutshell, nutmix | cashu-ts, cdk, Nutshell | **Require it.** Spec: quotes without a pubkey "can be minted by anyone who knows the mint quote id" ✅ |
| **22** | Blind auth: unit `auth`, amount `1`, single-use BATs; "not marked as spent if the request results in an error" | 2026-03-21 | Nutshell, cdk-mintd, nutmix | Nutshell, cashu-ts, cdk | Design twin of your credentials, but **depends on NUT-21 (OpenID login)** ✅, so not account-free. Steal its "not spent on error" rule |
| **24** | HTTP 402: server returns `X-Cashu: creqA…/creqB…`; client retries with `X-Cashu: cashuB…`; must support NUT-18 **and** NUT-26 encodings | 2026-06-23 | **none listed** | **none listed** | Use its header names for uploads 🔵. Third-party `express-cashu` and `cashu-mpp` exist 🟡. The spec example even uses unit `"api"` |
| **25** | BOLT12 mint/melt; **pubkey mandatory** | 2026-09-16 | **cdk-mintd only** | cdk, cashu-ts | Skip for B7. phoenixd can make offers (`createoffer`) ✅, but payer-side BOLT12 support is thinner than BOLT11 🔵 |
| 26 | Bech32m payment requests (`creqB`) | — | — | Nutshell, cdk, cashu-ts, Sovran | Needed if you ever emit NUT-24 402s |
| 29 | Batched mint | — | Nutshell, cdk-mintd | cdk, cashu-ts | Not needed |

Library: **@cashu/cashu-ts 4.11.0, published 2026-09-22** ✅ (npm registry).

---

## §3. phoenixd

All ✅ items come from `ACINQ/phoenixd` source at v0.9.2 (tagged 2026-09-30, lightning-kmp 1.13.2), unless marked otherwise.

### 3.1 Platform and setup

- **Platforms:** Native Linux **x86 and ARM**, macOS, Windows via WSL; there is also a JVM build. Build target `linuxArm64DistZip` ✅.
  - The v0.9.2 release has 8 assets, but I could not list them. Verify the ARM zip against `SHA256SUMS` and `SHA256SUMS.asc` 🟡.
- **Chains:** `--chain` is `mainnet` or `testnet` (testnet3) only. **No regtest, signet or testnet4** ✅. That shapes the test plan (§6.3).
- **Data directory:** `~/.phoenix` (JVM build; overridable with the `PHOENIX_DATADIR` env var) ✅. The seed is a **12-word** `seed.dat` there, or passed via `--seed` / the `PHOENIX_SEED` env var ✅.
- **First-run warning:** phoenixd prints "Do not share the same seed with other phoenix instances (mobile or server), it will cause issues and channel force closes." ✅
- **HTTP API:**
  - Binds `127.0.0.1:9740` by default ✅.
  - Has a **full-access** and a **limited-access** password, readable from files (`--http-password-file`, new in v0.9.1) ✅.
  - By route nesting in `Api.kt`, `payinvoice`, `payoffer`, `paylnaddress`, `lnurlpay`, `lnurlauth`, `sendtoaddress`, `bumpfee` and `closechannel` need **full access**.
  - `createinvoice`, `payments/incoming/{hash}` and `export` work with **limited access** ✅.
  - 🔵 **Give the Worker only the limited password.** A leaked Worker secret then can't spend.
- **`createinvoice`:**
  - Takes `amountSat`, plus `description` (max 128 chars) **or** `descriptionHash`, `expirySeconds`, `externalId` and a per-invoice `webhookUrl` ✅.
  - 🔵 Use `descriptionHash` or a fixed generic description. The invoice travels through the payer's wallet, which may be custodial.
- **Webhooks:**
  - Signed with `X-Phoenix-Signature` = hex HMAC-SHA256(body, secret) ✅.
  - **No timestamp, so they are replayable** 🔵.
  - **One attempt only; a failure is just `log.warning`** ✅.

### 3.2 Fees

**Inbound liquidity (auto-liquidity):**
- **Sizes:** `--auto-liquidity` can be `off`, `2m`, `5m` or `10m`; the default is **2,000,000 sats** ✅.
- **Real cost at 2m:** **serviceFeeSat 21,000 + miningFeeSat 411**, from CLI output posted on ACINQ/phoenixd#222 (2 Mar 2026) ✅ as a primary output, 🟡 as a general rule.
  - That is consistent with **1% + 1,000 sats + mining** 🔵.
  - Secondary sources say "1% + mining fees" 🟡.
- **The issue thread:** asks for a lower minimum, has no reply from ACINQ, and gained a +1 on 9 Oct 2026 🟡.

**Caps:**
- **Mining fee cap:** `--max-mining-fee` defaults to 1% of auto-liquidity (20k sats at 2m), limited to 5k–200k ✅.
- **Hidden relative cap:** `--max-relative-fee-percent` defaults to 30% ✅.

**Fee credit:**
- **What happens to small payments:** If a payment is too small to fund the channel operation, "the full amount is added to your fee credit… **The fee credit is non-refundable**" ✅ (phoenixd first-run text).
- **Cap:** `--max-fee-credit` defaults to 2.5% of auto-liquidity (50k sats at 2m). Choices are `off`, `50k`, `125k` or `250k`; once the cap is reached, payments are rejected ✅.

**Other fees:**
- **Payer side:** Invoices carry a last-hop route hint charging **1,000 msat + 100 ppm** (1 sat + 0.01%) ✅. That is negligible for customers.
- **Outgoing via trampoline:** **4 sats + 4,000 ppm (0.4%)** ✅ (`Lsp.kt`). You barely send over Lightning anyway; liquidation is on-chain.
- **Splice-out (`sendtoaddress`):** takes `feerateSatByte` you choose ✅. ACINQ service fee on splice-out: **Not found** in source. Reviews say "mining fee only" 🟡.

🔵 **What this means:**
- **Rough cost:** about 1.07% per 2M sats of inbound liquidity consumed.
- **Pre-fund:** Before launch, pay your own node ≥ ~25k sats so the first channel exists. Customers' first small purchases then don't disappear into fee credit.
- **Pack prices:** Make your smallest pack comfortably above the per-payment threshold once a channel exists.

### 3.3 What ACINQ sees

- **ACINQ's node:** pubkey `03864ef0…597a3f8f` at `3.33.236.230:9735`, hard-coded as the only peer ✅.
  - 🔵 That IP looks like AWS Global Accelerator space. That's infrastructure, not custody, but it is a US provider in the path. Verify if it matters to you.
- **Incoming payments:** amount, payment hash, timing and previous hop for every one, because ACINQ is your only peer 🔵. **Not** the invoice description.
- **Outgoing payments:** ACINQ, as trampoline, learns "both the payer and recipient", in ACINQ's own words (Medium, older post) 🟡. A 2026 review repeats this 🟡.
- **Customers who use Phoenix:** ACINQ is then their trampoline **and** your LSP, so it sees both ends 🔵.
- **Splices:** ACINQ co-signs every splice, so it knows your splice-out destination 🔵.

### 3.4 Liquidity and splicing

- **One channel, resized by splicing.** Inbound liquidity is bought automatically. Payouts are splice-outs via `sendtoaddress` (`peer.spliceOut`). Fee bumps use `bumpfee`. A full exit is a cooperative close via `closechannel` (`mutualClose`) ✅.
- **No force-close endpoint** exists in the HTTP API ✅ (`Api.kt` route list).
- **Swap-in:** `getswapinaddress` is supported, as is an Electrum backend (`--electrum-server`, added in v0.9.0) ✅. Swap-in goes to ACINQ, not a submarine-swap service. It is not needed for B7.

### 3.5 Backups and seed handling 🔵

- **Back up the whole of `~/.phoenix`** (seed plus SQLite channel and payment DBs), encrypted, off-box.
  - The seed alone relies on ACINQ cooperating to restore channel state. A secondary, older ACINQ source says static backups plus ACINQ cooperation recover funds 🟡.
- **Keep the seed out of shell history and env files.** Prefer `seed.dat` with `chmod 600` on an encrypted volume.
- **Never run two instances** with one seed ✅ (see the warning in §3.1).
- **Keep the float small.** Sweep on a threshold (§6.2 step 7). Whatever sits in the channel is your blast radius.

### 3.6 Failure modes

| Failure | Effect | Mitigation 🔵 |
|---|---|---|
| Webhook POST fails | Payment never credited | Poll `GET /payments/incoming/{paymentHash}` on quote status checks, plus a cron sweep |
| Webhook replayed | Double credit | Idempotent credit keyed on payment hash (§5.3) |
| phoenixd or Hetzner down | Can't sell credits | Quote endpoint returns 503. Spending keeps working with Option A |
| Fee credit cap reached | Small payments rejected ✅ | Pre-fund the channel, set sensible minimum pack size |
| Mining fees spike | Liquidity purchase deferred or rejected ✅ (caps) | Raise `--max-mining-fee` deliberately, not by default |
| ACINQ unreachable | No sends or receives | Mutual close impossible; you'd need tooling outside the API. Low float |

### 3.7 Running beside LNbits

- **It works:** LNbits 1.6.1 (10 Sep 2026) supports phoenixd as a funding source 🟡.
- **But there's nothing left for it to do in B7** 🔵. The Worker talks to phoenixd directly, and neither mint uses LNbits any more. It would add a Python web app with its own users, admin and extensions on the box holding your seed. Skip it.

### 3.8 If ACINQ stops serving the UK

- **US precedent:** Phoenix left US app stores on **3 May 2024**. ACINQ said it was unclear whether self-custodial wallet providers, LSPs or even Lightning nodes count as Money Services Businesses. Users were told to close channels cooperatively and avoid force-closing 🟡 (NoBS Bitcoin; Blocktrainer).
  - One 2026 review claims US service "returned April 2025" 🟡, unverified.
- 🔵 **What a UK exit would look like:**
  - Your node is in DE/FI, so an IP block wouldn't catch it. A ToS exclusion would still make continued use a breach.
  - Your exit is `closechannel` to an address you control, while ACINQ cooperates.
  - **Plan B:** an LDK-based node (LDK Node, or CDK's `cdk-ldk-node`) with your own channels and inbound bought from a non-US LSP. More capital, more ops.
- **ToS text:** ACINQ's phoenixd terms of service could not be fetched (403). **Read them before mainnet.**

### 3.9 Liquidation to a Silent Payments address

- **phoenixd has no Silent Payments support** ✅: no `silent`, `sp1` or BIP-352 handling in the source. `sendtoaddress` converts a normal address to a script.
- 🔵 **Why it can't be fixed by a feature flag:** A Silent Payments sender must tweak the output with its input private keys. A splice input is a 2-of-2 shared with ACINQ.
- 🔵 **Do it in two steps:**
  1. Splice-out to a single-sig wallet you control.
  2. Send from that wallet to your SP address with an SP-capable wallet.
- 🔵 ACINQ will see the intermediate address, and chain analysis can link step 1 to step 2. That is acceptable for business revenue; it's your money, not users'.

---

## §4. Privacy of the whole loop

### 4.1 Where linkage can happen

```
Payer wallet ──LN──▶ ACINQ ──▶ phoenixd ──webhook──▶ Worker/DB ◀── browser (IP)
  (L1)                 (L1)                          quote ↔ hash (L2)
                                                     quote ↔ B' (L3)
                                        ··· blind signature: no link ···
Browser (IP) ──upload + proof (Y)──▶ Worker/DB  (L4)
```

| Observer | Sees | Can link | Mitigation 🔵 |
|---|---|---|---|
| Payer's wallet (worst if custodial, e.g. Wallet of Satoshi) | Paid your node, amount, time | Person ↔ "bought Refueler credits" | Tell users a self-custodial wallet hides this. Later: NUT-18 "pay with ecash" |
| Lightning routing nodes | Amount and timing per hop | Little | — |
| ACINQ | Amount, hash, time; payer too if they use Phoenix | Payment ↔ your node | Accept it, or move to Plan B node |
| Cloudflare | IP + headers on quote, mint and upload requests | **IP at purchase ↔ IP at upload** | Outside your control. Allow Tor; don't add first-party IP logging |
| Refueler DB | quote ↔ payment hash ↔ `B'`; spent `Y` + upload | Breaks only if `r` leaks, or via side channels below | Strip `r`, minimise retention |
| Hetzner | phoenixd box contents | Same as ACINQ, plus your seed | Encrypted volume, low float |

### 4.2 Side channels the cryptography doesn't fix 🔵

1. **Anonymity set size.** Each spent proof hides among the unspent proofs of the same keyset. With weekly keysets and 20 buyers a week, that's a crowd of 20. Early on, this matters more than anything else on this page.
2. **Amount.** Buying 37 credits, then 37 uploads follow. → **Fixed packs** (e.g. 10 / 50 / 200), and no custom amounts.
3. **Timing.** Pay, mint, upload within 30 seconds from the same browser. → Can't fully fix without hurting UX. At minimum don't *log* timing at second resolution. Round `created_at` on spends to the hour.
4. **Keyset period.** Shorter periods = smaller crowd and a visible purchase date. → **Quarterly keysets**, spendable for 12 months.
5. **Forced swaps reveal balances.** If keyset expiry forces users to swap leftovers into a new keyset, each swap request reveals one user's whole remaining balance in one go. → **No swap endpoint for credits.** Old keysets stay spendable proof-by-proof until final expiry.
6. **Quote linkage.** → **NUT-20 with a fresh key per quote.** The spec says wallets "SHOULD generate a unique public key for each mint quote request" ✅.
7. **`r` in the token.** NUT-24 and NUT-18 flows assume the payee checks the DLEQ, so standard wallets may attach `r` ✅. → The Refueler client strips `dleq` before upload. The server ignores it, and never logs or persists it.
8. **Browser storage.** Credits in `localStorage` alongside anything identifying = linkage at the device, not the server. Keep the credit store separate.
9. **Upload content** may identify the uploader regardless. Out of scope, but it caps how anonymous the whole thing can be.

---

## §5. Race safety: what mints do, and what to copy

### 5.1 What the spec requires ✅

- **Never over-issue:** "Mints **MUST NOT** issue ecash whose total output amount exceeds `amount_paid - amount_issued`" (NUT-04).
- **Expiry is for paying, not minting:** "`expiry` is a deadline for payment, not for issuance… Mints MUST NOT refuse to issue… solely because `expiry` has passed" (NUT-04).
- **`updated_at` only goes up:** it must increase monotonically per quote (NUT-04).
- **Quote IDs are secrets:** "SHOULD be UUID v7 with all 74 variable bits generated by a CSPRNG… A third party who knows the `quote` ID can front-run and steal the tokens" (NUT-04).
- **Error codes:**
  - `11001` already spent
  - `11002` pending
  - `11003` outputs already signed
  - `11007`/`11008` duplicate inputs/outputs
  - `20002` quote already issued
- **Failed requests don't burn tokens:** "The BAT is not marked as spent if the request results in an error" (NUT-22).
- **Replays return the first answer:** NUT-19 replays a stored successful response for the same request.

### 5.2 How CDK does it ✅

From the CDK Postgres migrations and `cdk-sql-common` at HEAD 2026-10-10:

| Guarantee | Mechanism |
|---|---|
| One quote per invoice | `mint_quote.request_lookup_id TEXT UNIQUE` (payment hash); plus a unique index on `mint_quote(request)` (migration 2026-04-16) |
| Each payment credited once | `mint_quote_payments.payment_id TEXT NOT NULL UNIQUE` |
| Never issue more than paid | `amount_paid` / `amount_issued` counters, updated under `SELECT … FOR UPDATE` on the quote row |
| Each output signed once | `blind_signature.blinded_message BYTEA PRIMARY KEY` |
| Each proof spent once | `proof.y BYTEA PRIMARY KEY`, state column, `SELECT state FROM proof WHERE y IN (:ys) … FOR UPDATE` |
| One in-flight melt per invoice | Partial unique index `ON melt_quote(request_lookup_id) WHERE state IN ('PENDING','PAID')` (migration 2025-11-27) |
| Crash recovery | `saga_state` table keyed by `operation_id`; proofs and signatures tagged with `operation_id` |
| Multiple replicas | Postgres advisory locks for melt dispatch (v0.18.0-rc.1). README still says one active mintd per DB |

Nutshell takes Postgres row locks with `SELECT … FOR UPDATE NOWAIT` ✅ (`cashu/core/db.py`).

### 5.3 What to copy: schema and three functions 🔵

Key the spent table on `Y = hash_to_curve(secret)`, as CDK does, rather than the raw secret string. Your current "insert on serial" is already the right instinct; this adds PENDING, so a failed upload doesn't burn a credit.

```sql
-- B7: anonymous-rail tables (Postgres). Units are credits; price lives in pack table.
create table credit_pack (
  size        int primary key check (size > 0),
  price_sat   bigint not null check (price_sat > 0)
);

create table mint_quote (
  id             uuid primary key,                 -- UUIDv7, CSPRNG bits, secret
  payment_hash   bytea not null unique,
  bolt11         text  not null unique,
  pack_size      int   not null references credit_pack(size),
  price_sat      bigint not null,
  pubkey         bytea not null,                   -- NUT-20, required
  keyset_id      text  not null,
  amount_paid    int   not null default 0,
  amount_issued  int   not null default 0,
  expires_at     timestamptz not null,
  updated_at     timestamptz not null default clock_timestamp(),
  check (amount_issued between 0 and amount_paid)
);

create table quote_payment (
  payment_hash   bytea primary key references mint_quote(payment_hash),
  received_sat   bigint not null
);

create table blind_signature (
  b_         bytea primary key,                    -- each output signed once (11003)
  c_         bytea not null,
  keyset_id  text  not null,
  quote_id   uuid  not null references mint_quote(id)
);

create table spent_proof (
  y          bytea primary key,                    -- hash_to_curve(secret)
  keyset_id  text  not null,
  state      text  not null check (state in ('PENDING','SPENT')),
  op_id      uuid  not null,
  hour       timestamptz not null default date_trunc('hour', now())  -- coarse on purpose
);

-- 1) Credit a payment. Safe to call from webhook AND poller, any number of times.
create or replace function credit_quote(p_hash bytea, p_received_sat bigint)
returns void language plpgsql as $$
begin
  insert into quote_payment (payment_hash, received_sat)
  values (p_hash, p_received_sat)
  on conflict (payment_hash) do nothing;
  if not found then
    return;                                        -- already credited
  end if;
  update mint_quote
     set amount_paid = pack_size,
         updated_at  = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
   where payment_hash = p_hash
     and p_received_sat >= price_sat;
end $$;

-- 2) Record signatures the Worker computed. Replays return the same rows; over-issue aborts.
create or replace function issue_credits(p_quote uuid, p_b bytea[], p_c bytea[], p_keyset text)
returns table (b_ bytea, c_ bytea) language plpgsql as $$
declare
  v_new int;
begin
  perform 1 from mint_quote where id = p_quote for update;
  if not found then
    raise exception 'unknown quote' using errcode = 'P0002';
  end if;

  if exists (select 1 from blind_signature s
              where s.b_ = any(p_b) and s.quote_id <> p_quote) then
    raise exception '11003 outputs already signed' using errcode = 'P0001';
  end if;

  with ins as (
    insert into blind_signature (b_, c_, keyset_id, quote_id)
    select u.b, u.c, p_keyset, p_quote
      from unnest(p_b, p_c) as u(b, c)
    on conflict on constraint blind_signature_pkey do nothing
    returning 1
  )
  select count(*) into v_new from ins;

  update mint_quote
     set amount_issued = amount_issued + v_new,    -- check constraint stops over-issue
         updated_at    = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
   where id = p_quote;

  return query
    select s.b_, s.c_ from blind_signature s
     where s.quote_id = p_quote and s.b_ = any(p_b);
end $$;

-- 3) Spend: reserve, then commit or release. First INSERT wins.
create or replace function reserve_proof(p_y bytea, p_keyset text, p_op uuid)
returns boolean language sql as $$
  insert into spent_proof (y, keyset_id, state, op_id)
  values (p_y, p_keyset, 'PENDING', p_op)
  on conflict (y) do nothing
  returning true;
$$;
-- commit:  update spent_proof set state = 'SPENT' where y = $1 and op_id = $2 and state = 'PENDING';
-- release: delete from spent_proof where y = $1 and op_id = $2 and state = 'PENDING';
```

Notes:
- **Tested on a throwaway Postgres 16 on 11 Oct 2026** ✅. Results:
  - The schema loads.
  - A repeated `credit_quote` credits once.
  - A replayed `issue_credits` returns identical rows with `amount_issued` unchanged.
  - A third credit on a 2-pack fails the check constraint.
  - Reusing an output on another quote raises 11003.
  - **20 parallel `issue_credits` calls on one 2-credit quote issued exactly 2.**
  - **20 parallel `reserve_proof` calls on one `Y` gave exactly 1 winner.**
- **Why signing outside the transaction is safe.** Blind signatures are deterministic (`C' = k·B'`). The Worker can compute `C'` first and then call `issue_credits`. It **returns `C'` to the client only after the commit succeeds**.
  - A replayed request recomputes the same `C'`, inserts nothing, adds nothing to `amount_issued`, and gets the same answer. That is NUT-19 for free.
- **Checking the quote's signature.** The NUT-20 signature check happens in the Worker before `issue_credits`, against `mint_quote.pubkey`.
- **The webhook is a hint, not proof of payment.** On a webhook, verify the HMAC in constant time. Then fetch `payments/incoming/{hash}` from phoenixd and pass *its* `receivedSat` to `credit_quote`. Never pass the webhook body's amount.
- **The pending-proof janitor.** If a PENDING row is older than N minutes, check whether the upload object for `op_id` exists in storage. If it does, mark it SPENT; if not, delete the row.
  - Never release a PENDING row blindly: the upload may have succeeded and only the commit got lost.
- **Data retention.** Once a quote is fully issued and past expiry + 30 days, you can null out `bolt11` and delete its `blind_signature` rows. The unique `payment_hash` stays, for idempotency.

---

## §6. Recommendation, B7 build order, test plan

### 6.1 Recommendation 🔵

**Worker mint (keep) + phoenixd (alone) on a CAX21 + the patterns above.**

- **Not CDK for now.** It has no phoenixd path; a voucher doesn't need a full sat mint; the ALPHA label and monthly migrations are a poor fit for a one-person operation; and a sat mint would make you the custodian.
- **Use Option A from §1.2.** The Worker keeps `k`, so uploads never depend on Hetzner. The CAX21 only has to be up to *sell* credits.
- **Revisit CDK if:**
  - you want sat-denominated ecash, or
  - someone ships a maintained phoenixd payment processor, or
  - you outgrow ACINQ and move to `cdk-ldk-node`.

### 6.2 Minimum build order

1. **Box.**
   - CAX21, Ubuntu LTS, encrypted data volume, firewall allowing outbound only. phoenixd native ARM64 build, checked against `SHA256SUMS.asc`.
   - systemd unit. Passwords and webhook secret read from files (`--http-password-file`, `--http-password-limited-access-file`, `--webhook-secret-file`).
   - Keep `--auto-liquidity 2m`. Set `--max-fee-credit 50k` explicitly.
   - Read ACINQ's ToS.
2. **Tunnel.**
   - Worker ↔ phoenixd over Cloudflare Tunnel with an Access service token, or WireGuard. phoenixd stays on `127.0.0.1`.
   - The Worker gets the **limited-access** password only. The full-access password lives on the box.
3. **Pre-fund.** From your own wallet, pay one invoice of ~25–30k sats. Confirm a channel exists with `listchannels`.
4. **DB.** The four tables and three functions in §5.3, plus `keyset` (id, unit `credit`, public key for amount 1, active_from, spend_until).
5. **Worker endpoints**, NUT-04/20/23-shaped:
   - `POST /v1/mint/quote/bolt11 {pack, pubkey}`
   - `GET /v1/mint/quote/bolt11/{id}`, which polls phoenixd while unpaid
   - `POST /v1/mint/bolt11 {quote, outputs, signature}`
   - `POST /hooks/phoenixd`
   - `/v1/keys` and `/v1/keysets` for the browser's DLEQ checks
6. **Spend path.**
   - Upload carries `X-Cashu: cashuB…` (NUT-24 header name) with exactly one proof, DLEQ stripped.
   - Order of work: verify `C = k·Y`, then `reserve_proof`, then the upload, then commit or release.
7. **Liquidation runbook.**
   - When channel balance > threshold: `sendtoaddress` to your single-sig wallet at a chosen feerate.
   - From that wallet, send to your Silent Payments address.
   - Log totals only.
8. **Monitoring.** Alert on:
   - phoenixd down;
   - fee credit > 0 after launch;
   - unpaid-but-paid quotes (phoenixd says paid, DB says not) older than 5 minutes;
   - PENDING spends older than 15 minutes.

### 6.3 Test plan

| # | Test | Pass condition |
|---|---|---|
| 1 | NUT-00 and NUT-12 vectors (`nuts/tests/00-tests.md`, `12-tests.md`) against your signing code | Byte-for-byte match |
| 2 | cashu-ts 4.11 wallet end to end: quote, pay, mint, verify DLEQ in browser | Proofs verify; keyset ID matches NUT-02 v2 derivation |
| 3 | 50 parallel `POST /v1/mint` on one paid quote with different outputs | Exactly `pack_size` signatures issued in total; rest get 20002/over-issue error |
| 4 | Same request replayed 10× | Identical `C'` each time; `amount_issued` unchanged |
| 5 | Outputs from quote A reused on quote B | 11003 |
| 6 | Mint without NUT-20 signature, or with a wrong one | Rejected |
| 7 | Webhook with bad HMAC; valid webhook replayed 10× | First rejected; second credits once |
| 8 | Webhook endpoint down during payment | Poll path credits it; quote mintable |
| 9 | Pay after `expires_at` | Still mintable (NUT-04) |
| 10 | 20 parallel uploads with the same proof | Exactly one 2xx; others 11001-style 409 |
| 11 | Upload fails after reserve | Proof released and reusable |
| 12 | Commit lost (kill Worker after upload, before commit) | Janitor marks it SPENT, not released |
| 13 | Token arrives with `dleq.r` | Accepted, but `r` never persisted or logged (grep logs) |
| 14 | Keyset rotation: old-keyset proof during grace; after `spend_until` | Accepted; then rejected |
| 15 | Hetzner offline | Quote endpoint 503; spending unaffected |
| 16 | phoenixd restore drill on a fresh CAX21 from backup, **testnet3** (no regtest/signet in phoenixd) | Node comes up with same node ID and balance |
| 17 | Mainnet canary: three real packs, smallest size | All credited; fee credit stays 0 |

For tests 3–12, run against a **fake phoenixd**: a 60-line stub serving `createinvoice` and `payments/incoming/{hash}`, plus a signed webhook. Running them on testnet3 too would be like testing your brakes on an ice rink. Possible, but you learn more about the ice.

---

## Not found

- ACINQ phoenixd terms of service text, and the docs pages for auto-liquidity and FAQ (all HTTP 403 from this environment).
- An official ACINQ statement on the liquidity service-fee formula (only the 21,000-sat CLI output, and secondary "1%" claims).
- Any formal paid security audit of CDK or Nutshell.
- A maintained phoenixd backend or payment processor for CDK or Nutshell.
- Any NUT-24 implementation in the official support matrix.
- ACINQ's position on serving UK users specifically.
- The asset list for phoenixd v0.9.2 (8 assets, names not visible).

## Sources

**Specs and code (✅)**
- Cashu NUTs repo, README matrix and NUT-04/05/11/12/18/19/20/22/24/25, error codes, HEAD 2026-09-24: https://github.com/cashubtc/nuts
- CDK README, crates list, CHANGELOG, Postgres migrations, `cdk-mintd/README` and `example.config.toml`, `docker-publish.yml`, HEAD 2026-10-10, tag v0.18.1 (2026-09-18): https://github.com/cashubtc/cdk
- CDK releases (v0.18.1 2026-09-18, v0.18.0 2026-09-02, v0.17.7 2026-09-16): https://github.com/cashubtc/cdk/releases
- CDK payment processors (tiers), read 11 Oct 2026: https://github.com/cashubtc/cdk-payment-processors
- cdk-lnbits deprecation notice (0.17.7): https://docs.rs/cdk-lnbits/latest/cdk_lnbits/
- Nutshell README, `cashu/lightning/`, `cashu/core/db.py`, docker workflow, v0.21.0 (2026-09-16): https://github.com/cashubtc/nutshell and https://github.com/cashubtc/nutshell/releases
- phoenixd source (`Phoenixd.kt`, `Api.kt`, `conf/Lsp.kt`, `Actuals.kt`), README, v0.9.2 (2026-09-30): https://github.com/ACINQ/phoenixd and https://github.com/ACINQ/phoenixd/releases
- phoenixd issue #222, liquidity fee CLI output (2 Mar 2026): https://github.com/ACINQ/phoenixd/issues/222
- @cashu/cashu-ts 4.11.0 (2026-09-22): https://registry.npmjs.org/@cashu/cashu-ts

**Secondary (🟡)**
- Cashu blog, Q2 2026 Highlights (1 Sep 2026): https://blog.cashu.space/q2-2026-highlights/
- Orchard: https://blog.cashu.space/orchard/
- Amperstrand cashu-audit, community conformance (Jul to Sep 2026): https://github.com/Amperstrand/cashu-audit, and issue #27 (18 Sep 2026): https://github.com/Amperstrand/cashu-audit/issues/27
- ACINQ, "Phoenix Wallet Part 4: Trampoline payments": https://medium.com/@ACINQ/phoenix-wallet-part-4-trampoline-payments-fb1befd027c8
- ACINQ, "Phoenix Wallet Part 3: Backup": https://medium.com/@ACINQ/phoenix-wallet-part-3-backup-f63a9470d4e7
- Phoenix leaving the US (Apr/May 2024): https://nobsbitcoin.com/phoenix-wallet-to-be-removed-from-us-app-stores-on-may-3 and https://www.blocktrainer.de/en/blog/out-in-the-usa-phoenix-wallet-pulls-the-emergency-brake
- Phoenix review 2026 (US status, fees): https://www.bitcoinproducts.com/blog/phoenix-wallet-review
- The Block on splicing (2023): https://www.theblock.co/post/239098/phoenix-wallet-lightning
- Fee-credit discussion: https://stacker.news/items/696504
- LNbits 1.6.1 (10 Sep 2026): https://freedom.tech/posts/2026-09-10-lnbits-1-6-1/
- NUT-24 third-party implementations: https://github.com/cashubtc/awesome-cashu
- UK cryptoasset regime dates: `research/live-streaming-research-2026-10.md` (this repo, 9 Oct 2026)
