# Ark (bark / Second) and Wavelength for Refueler: research

As of **11 October 2026**. This is research, not legal, tax or financial advice.

**How to read the marks**
- **verified** means I read it in a primary source (the code, a spec, official docs, the operator's own terms or pricing, release notes, or a live API response). The source is linked.
- **verified (secondary)** means a news or law-firm report, used only where no primary source was reachable.
- **inferred** means my own reasoning from the verified facts. Treat it as an argument, not a fact.

**How sources were read.** On 11 Oct 2026 I cloned four repositories and read them directly:
- bark at `master` 851d31a (10 Oct 2026)
- wavelength at `main` d4af719 (9 Oct 2026)
- wavelength-sdk at `main` 4f98610 (15 Sep 2026)
- phoenixd at `master` 85d0472 (8 Oct 2026)

I also read Second's docs, pricing page and terms, the Wavelength docs (in the SDK repo, the source of wavelength.lightning.engineering), and the launch posts. I asked Wavelength's public signet operator for its live settings.

Two pages could not be fetched: phoenix.acinq.co returned 403, and the FCA's site was not tried after earlier blocks. Those gaps are marked where they matter. Every source is listed in the appendix.

---

## Read these six first

1. **Both Ark operators are US companies, and both can refuse to co-sign.**
   - Second's terms are with "TwoND, Inc., d/b/a Second", governed by Delaware law, with a Delaware postal address. **verified** ([Second terms, revised 10 Aug 2026](https://second.tech/terms))
   - Those terms reserve the right to "decline to co-sign transactions to or from any bitcoin address" and to "block access from any region or IP address". They also forbid using a VPN to get round location checks. **verified** (same)
   - Lightning Labs runs the only Wavelength operator. **verified** ([Wavelength docs](https://wavelength.lightning.engineering/introduction/the-wavelength-system/)) Lightning Labs is a US company. **inferred** (well known, but not re-checked today)
   - Ark is "self-custodial with asterisks", not custodial. Even so, this collides with your "no US custodians" rule in spirit. **You need to decide whether that rule also covers US co-signers.**
2. **Second's Ark server was exploited six days ago.**
   - On 5 Oct 2026 an attacker drained **0.75 BTC of Second's own money** through a bug in boarding (how coins enter Ark). A denial-of-service attack followed and degraded Lightning receives. **verified (secondary)** ([The Bitcoin Manual](https://thebitcoinmanual.com/articles/ark-operator-second-hack/), quoting [Second on X, 8 Oct](https://x.com/secondhq/status/2108065406665805992))
   - Second says user funds were never at risk. Fixes to board validation landed in the code on 5 to 8 Oct. **verified** (bark commits `48b005f`, `df187c7`, `30c5f46`, `d36b879`)
   - Those commits are the fix for this incident. **inferred**
   - There is no published post-mortem, and I found **no independent audit of bark or of Wavelength**.
3. **Wavelength is not open for business yet.**
   - It is alpha. Mainnet is invite-only: you submit your wallet's permanent identity key through a **Google Form**. **verified** ([Wavelength networks doc](https://wavelength.lightning.engineering/concepts/networks-and-config/))
   - The operator and swap-server code (`lumosd`, `swapd`) live in repos that are not public. **verified** (the repos are referenced in `docs/swap_system.md`; `git ls-remote` asked for credentials on 11 Oct)
   - For an anonymity product, an allowlist keyed to a permanent identity is a non-starter today. **inferred**
4. **For funding your own phoenixd node, Ark does not reduce LSP exposure. It moves it.**
   - Ark swaps ACINQ (France) for Second or Lightning Labs (US) as the party that sees your flows.
   - The most private option is the one you already have: let the first customer payments buy your liquidity, so none of your own coins touch the chain. **inferred**, built on phoenixd's auto-liquidity defaults (**verified**, code)
5. **Cashu stays the right bearer instrument for credits.**
   - An Ark wallet in the browser would keep *your* server blind, but would make the *Ark operator* see and link every top-up.
   - Ark balances also need regular check-ins. Coins received over Lightning on Second expire in **1 to 3 days** unless the wallet comes online and refreshes them. **verified** ([Second docs](https://second.tech/docs/learn/payments-lightning))
   - Customers who use Ark wallets can already pay your Lightning invoices with zero work from you. **verified** (bark pays BOLT11, BOLT12 offers and LNURL, per the changelog)
6. **The best non-money idea doesn't need Ark at all.** Ark's hash-locks inspire a **"collected" receipt**:
   - Derive a secret from the transfer key.
   - The receiver's browser reveals that secret when it opens the file.
   - The sender checks it against a hash they kept.
   - It works today, costs nothing and leaks nothing.
   - The Ark-specific idea worth a lab test is **"Paid Drop"**: a seller with no node and no account sells a file, and the buyer's Lightning payment releases the key at the same moment. It needs one small missing API. See section 4.

**Recommendation:** **watch**, plus **one lab experiment** in a separate repo (section 6). **Do not adopt at B7.** Keep phoenixd as the Lightning block.

---

## 1. What exists, today

### 1.1 At a glance

| | **bark** (Second) | **Wavelength** (Lightning Labs) |
|---|---|---|
| What it is | An implementation of the Ark protocol: client `bark`, server `captaind`, libraries. **verified** ([README](https://gitlab.com/ark-bitcoin/bark)) | An "Ark-like" wallet system: client daemon `waved`, plus a typed SDK. **verified** ([launch post, 21 Jul 2026](https://lightning.engineering/posts/2026-07-21-wavelength-launch/)) |
| Licence | MIT, client **and** server. **verified** (LICENSE) | MIT for the client and SDK. The operator and swap server are **not public**. **verified** (LICENSE; `docs/swap_system.md`) |
| Language | Rust | Go (daemon), TypeScript (SDK) |
| Bindings | Kotlin, Swift, React Native, Flutter, Go, Python, WebAssembly. **verified** ([mainnet post](https://second.tech/blog/bark-now-on-bitcoin-mainnet/)) | Browser WASM, React Native, native iOS/Android (gomobile), gRPC/REST, **MCP server for agents**. **verified** ([SDK README](https://github.com/lightninglabs/wavelength-sdk)) |
| Browser? | Yes. `@secondts/bark` runs fully in the browser, keeps state in IndexedDB, needs HTTPS. **verified** ([web docs](https://second.tech/docs/bark-sdk/wasm)). npm 0.25.0, 24 Sep 2026. **verified** (npm) | Yes. Chrome 100+, Firefox 110+, Safari 16+. The default mode **requires COOP/COEP cross-origin-isolation headers**. **verified** ([requirements](https://wavelength.lightning.engineering/web/get-started/requirements/)). npm 0.1.2, 11 Sep 2026. **verified** (npm) |
| Server daemon for us | `barkd`: REST + OpenAPI. Plain HTTP, loopback only by default, bearer token with full wallet access. **verified** (README) | `waved` + `wavecli`: gRPC/REST with macaroons. **verified** (README) |
| Mainnet | **Live since 9 Jun 2026**, open to anyone at `https://ark.second.tech`. **verified** ([blog](https://second.tech/blog/bark-now-on-bitcoin-mainnet/), [connection details](https://second.tech/docs/connection-details)) | **Invite-only alpha.** Signet and testnet are open. Mainnet uses an allowlist keyed to your `identity_pubkey`. **verified** ([networks doc](https://wavelength.lightning.engineering/concepts/networks-and-config/)) |
| Latest release | bark 0.7.1, 11 Sep 2026. **verified** ([changelog](https://second.tech/docs/changelog)) | wavelength v0.1.2, 10 Sep 2026 (v0.1.0 was 21 Jul 2026). **verified** (git tags) |
| Audits | **None found.** External reviewers are credited: Project Loupe, Greg Sanders and the bitcoin Red Team, in 0.6.2 and 0.7.0. **verified** (changelog). A formal academic analysis of Ark exists ([arXiv 2605.20952](https://arxiv.org/abs/2605.20952), 20 May 2026); it found two attacks in "the testnet implementation", now fixed. **verified** (abstract) I believe two authors work at Ark Labs, so it probably analysed Arkade rather than bark. **inferred** (not checked) | **None found.** **verified** (nothing in the repo or launch post) |
| Who runs the server (ASP) | Second (TwoND, Inc., US). **verified** ([terms](https://second.tech/terms)). You can run your own `captaind`; it is open source. **verified** | Lightning Labs ("Wavelength Operator"), with liquidity through Loop. **verified** ([docs](https://wavelength.lightning.engineering/introduction/the-wavelength-system/)). You cannot run your own: the server code is not public. **verified** |
| Lightning interop | Built in: the server runs Lightning nodes (Core Lightning) and acts as your gateway. Pays BOLT11, **BOLT12 offers**, Lightning addresses and LNURL-pay. Receives BOLT11. **verified** ([LN docs](https://second.tech/docs/learn/payments-lightning), changelog). Receiving BOLT12 is "planned". **verified** ([mailbox.md](https://gitlab.com/ark-bitcoin/bark/-/blob/master/docs/mailbox.md)) | Every payment is a BOLT11 swap through LL's swap server. **verified** ([swaps doc](https://wavelength.lightning.engineering/concepts/lightning-payments-are-swaps/)). No BOLT12 mention found. **verified** (grep of the docs) |
| Fees | Ark send/receive 0%. Lightning send 0.2–0.5% (minimum 20 sats). Lightning receive 0%. Refresh free if done in the last 2 days of a coin's life. **verified** ([pricing, 11 Oct 2026](https://second.tech/pricing)) | "1 basis point" on Lightning during the closed alpha, plus routing fees. "May change." **verified** ([launch post](https://lightning.engineering/posts/2026-07-21-wavelength-launch/)) |

### 1.2 What the operator can see, censor and steal

**Second (bark)**
- **Sees:**
  - Every Ark-to-Ark payment: which coin paid which key, amounts and timing.
  - Every Lightning invoice you pay, and every one you are paid.
  - The on-chain coin you board from.
  - Your IP address. **inferred** (the terms talk about blocking IPs)
- **The mailbox links you together.** bark's own design note says the mailbox "gives privacy from the public, but not from the Ark server … the server will be able to link all your Ark activity together". **verified** ([mailbox.md](https://gitlab.com/ark-bitcoin/bark/-/blob/master/docs/mailbox.md))
- **Seed-only backup also goes through the server.** Seed-only restore depends on a server mailbox and "on the server to cooperate". **verified** ([backups](https://second.tech/docs/backups))
- **Censors:** Second can refuse any operation, address, region or IP. **verified** ([terms §1.9](https://second.tech/terms)) It cannot block an emergency exit, as long as the exit confirms before the coin expires. **verified** ([exit docs](https://second.tech/docs/learn/exit))
- **Can steal or lose your money in five narrow cases:**
  1. **Coins you received from someone else (spend VTXOs).** Until you refresh them, the sender and Second together could double-spend them. **verified** ([payments](https://second.tech/docs/learn/payments))
  2. **Coins received over Lightning.** You trust that Second deleted a one-time signing key. If it kept the key, it could double-spend. **verified** ([LN docs](https://second.tech/docs/learn/payments-lightning))
  3. **A failed Lightning receive claim.** The wallet must start an exit by hand within about 180 blocks. Auto-exit was switched off, and in the worst case the slack is "two blocks (about 20 minutes)". **verified** (same page)
  4. **Expired coins.** These can only be recovered with Second's cooperation. Its "emergency exit: not possible". **verified** ([lifetime](https://second.tech/docs/learn/lifetime))
  5. **Delegated (phone) refreshes.** These currently depend "on the Ark server's signature only". **verified** ([rounds](https://second.tech/docs/learn/rounds))

**Lightning Labs (Wavelength)**
- **Sees:** the same graph as Second. On top of that, your client has a **permanent identity key**: your mailbox ID is derived from it, and mainnet access is approved against it. **verified** ([networks doc](https://wavelength.lightning.engineering/concepts/networks-and-config/), [README](https://github.com/lightninglabs/wavelength))
  - The "indexer" (the operator's record of which coins exist) is "the only witness" to swap outputs. **verified** ([swap_system.md](https://github.com/lightninglabs/wavelength/blob/main/docs/swap_system.md))
- **Censors:** the allowlist itself. Unilateral exit stays possible. **verified** ([leaving Ark](https://wavelength.lightning.engineering/concepts/leaving-ark/))
- **Holds your money outright: "credits".** Amounts below the minimum coin size (1,000 sats on signet) become **"a row in the swap server ledger … keyed by the wallet identity public key"**. **verified** ([credit_system.md](https://github.com/lightninglabs/wavelength/blob/main/docs/credit_system.md))
  - That is a custodial account balance at a US company. **inferred**
  - It is the exact opposite of your Cashu design.

### 1.3 Exit costs, expiry and liveness (what the user must do)

| | bark / Second (mainnet) | Wavelength (signet, live 11 Oct 2026) |
|---|---|---|
| Coin lifetime | 28 days from board or refresh. Lightning-received coins last **1–3 days**. **verified** ([lifetime](https://second.tech/docs/learn/lifetime)) | Operator-set. The "free refresh window" is 504 blocks (about 3.5 days). **verified** (live `get-info`) |
| Exit timelock | 144 blocks (about 1 day). **verified** ([forfeits](https://second.tech/docs/learn/forfeits)) | `vtxo_exit_delay` 144 blocks; `boarding_exit_delay` 512. **verified** (live) |
| Min / max coin | Default server config: minimum board 20,000 sats. Second's mainnet values are not published. **verified** ([captaind.default.toml](https://gitlab.com/ark-bitcoin/bark/-/blob/master/server/captaind.default.toml)) | Minimum coin 1,000 sats, maximum coin 200,000 sats, maximum balance 1 BTC. **verified** (live) |
| Rounds | Hourly. **verified** ([rounds](https://second.tech/docs/learn/rounds)) | "Often well under a minute" on test networks. **verified** ([architecture doc](https://wavelength.lightning.engineering/introduction/system-architecture/)) |
| Emergency exit cost | "Multiple on-chain fees". It can cost more than a small coin is worth. **verified** ([pricing](https://second.tech/pricing), [exit](https://second.tech/docs/learn/exit)) | Slow and expensive. Needs a **funded on-chain backing wallet** for fees (`fundingShortfallSat`). **verified** ([leaving Ark](https://wavelength.lightning.engineering/concepts/leaving-ark/)) |
| The user must… | Come online before every expiry. Be online to create an invoice. Claim incoming Lightning promptly. Keep **continuous database backups**, because the seed alone is incomplete and depends on the server. **verified** ([backups](https://second.tech/docs/backups)) | Keep the daemon running, which refreshes coins automatically. Hold an on-chain balance to exit. **verified** |

Plain English: an Ark balance is like a parking permit that must be renewed every few weeks (or every day or so, for Lightning money). Renewal is cheap if the car turns up. If it doesn't, the council (the operator) eventually tows the car, and the owner must ask nicely to get it back.

---

## 2. Funding our own phoenixd node privately

**What phoenixd does today (v0.9.2, 30 Sep 2026):**
- **Auto-liquidity.** Default 2,000,000 sats (choices: off, 2m, 5m or 10m), bought automatically when an incoming payment needs room. **verified** ([Phoenixd.kt](https://github.com/ACINQ/phoenixd/blob/master/src/commonMain/kotlin/fr/acinq/phoenixd/Phoenixd.kt))
  - Default mining-fee cap: 1% of the liquidity amount. Default fee-credit cap: 2.5%. **verified** (same file)
  - ACINQ's own service fee, from the page I couldn't fetch: 1% of the liquidity. **inferred**
- **On-chain "swap-in" deposits.** The `getswapinaddress` endpoint takes on-chain deposits. **verified** ([Api.kt](https://github.com/ACINQ/phoenixd/blob/master/src/commonMain/kotlin/fr/acinq/phoenixd/Api.kt))
  - The swap-in key is built with ACINQ's `swapInXpub`, so ACINQ co-signs every deposit. **verified** (Phoenixd.kt)

| Option | Who learns what | Public chain footprint | Cost | Verdict |
|---|---|---|---|---|
| **A. Do nothing.** Let the first customer payments trigger auto-liquidity. | ACINQ sees every inbound payment's amount, timing and hash, because it is your only channel peer. It does not see who paid. **inferred** | ACINQ's channel-open/splice transaction. **None of your coins are involved.** **inferred** | Liquidity fee, taken out of incoming payments | **Most private for your coins.** Nothing of yours links to the node. |
| **B. Splice in via phoenixd swap-in** (send your own on-chain coins) | ACINQ co-signs, so it knows your source coin. **verified** (code) | Your coin flows into a Phoenix splice. Phoenix splices are probably recognisable. **inferred** | Mining fee + swap-in fee | **Worst.** It ties your coins to your node publicly *and* for ACINQ. |
| **C. Ark first:** board coins into Second (or LN-receive into Ark), then pay your own phoenixd invoice over Lightning | Second sees your source coin **and** the destination node, because a phoenixd invoice carries your node ID in its route hints. **inferred** ACINQ sees a payment arriving from Second's direction. **inferred** | The board goes into a MuSig taproot output, which is less distinctive than a Phoenix splice. **inferred** | Board fee + 0.2–0.5% Lightning send (minimum 20 sats) **verified** ([pricing](https://second.tech/pricing)) + phoenixd's liquidity fee anyway | It swaps "public chain + ACINQ" for "Second (US) + ACINQ". It is **no better** than paying your invoice from any self-custodial Lightning wallet. |
| **C′. Same, via Wavelength** | Lightning Labs sees it all, against your **allowlisted identity key**. **verified** (identity mechanism) | Similar | 1 bp + routing, plus boarding | **Worse** than C today. |
| **D. Replace phoenixd with `barkd`** as the server's Lightning receiver | No ACINQ at all. Second sees every receive and links it via the mailbox. **verified** ([mailbox.md](https://gitlab.com/ark-bitcoin/bark/-/blob/master/docs/mailbox.md)) | Second's rounds only | Receive 0%, refresh 0% in the last 2 days. **verified** ([pricing](https://second.tech/pricing)) | A genuine alternative LSP, but a **US operator**, **six days after an exploit**, with daily refresh liveness on Lightning receives. Not for B7. |

**Honest answer.**
- Ark cannot "receive Lightning to our node" with less LSP exposure. Some LSP always sees the payment. Ark only chooses *which* one, and today the choices are American.
- On chain-analysis, Ark beats splicing your own coins (B), but loses to doing nothing (A).
- **Doing nothing is the private answer.** Fund nothing yourself, and let customers' first payments buy the liquidity. **inferred**

---

## 3. Credits and overage

**What already works with no changes**
- Customers can top up anonymous-rail credits from Ark wallets today. To phoenixd, an Ark wallet is just another Lightning payer.
  - bark pays BOLT11 invoices, BOLT12 offers, Lightning addresses and LNURL-pay. **verified** (changelog 0.3.0, 26 Jun 2026; alpha.19, 10 Sep 2025)
  - Wavelength pays BOLT11. **verified** ([swaps doc](https://wavelength.lightning.engineering/concepts/lightning-payments-are-swaps/))
- Your blind-signature Cashu flow is untouched. **inferred**

**Ways Ark could replace or sit beside Lightning**

| Idea | Status | What breaks |
|---|---|---|
| **Customers pay us Ark-to-Ark** (to our `ark1…` address, with `barkd` on our side) | Feasible. Both sides must use the **same operator**. **verified** ([LN docs](https://second.tech/docs/learn/payments-lightning)) | Second links the customer's coin to our key, and the mailbox links all our receipts. **verified** It is not more anonymous than Lightning, and it adds a US co-signer to the money path. **inferred** |
| **Credits held as Ark coins in the customer's browser** instead of Cashu | Feasible technically (bark WASM). **verified** | Our server stays blind, but **the Ark operator sees every balance and spend** and links them. **verified** (mailbox). Balances expire in 1–3 days if funded over Lightning. **verified**. IndexedDB "can be evicted by the browser". **verified** ([backups](https://second.tech/docs/backups)). **Do not.** |
| **Wavelength "credits"** for small amounts | Exists. **verified** ([credit_system.md](https://github.com/lightninglabs/wavelength/blob/main/docs/credit_system.md)) | A custodial, identity-keyed ledger at a US company. Breaks both locked rules. **inferred** |
| **A Cashu mint backed by Ark** (mint reserves held as coins via `barkd`) | **No CDK backend for bark found.** The only related CDK work is draft Payjoin plumbing ([cashubtc/cdk#2407](https://github.com/cashubtc/cdk/pull/2407), draft, opened 21 Aug 2026). **verified**. Second says Payjoin boards "open up … interoperability with Cashu mints". **verified** ([blog, 10 Sep 2026](https://second.tech/blog/payjoin-boards-board-psbt/)) | Blind signatures are unchanged, so the **client balance stays blind**. **inferred** The *mint's reserves* take on operator, expiry and liveness risk. A future option, not a B7 one. |
| **Ark ↔ Cashu swaps** | No standard. A swap works today as "melt Cashu to pay the Ark wallet's invoice" or the reverse. **inferred** | Nothing new; that's just Lightning. |
| **API overage paid by agents** | Agents with Wavelength's MCP wallet (`wavecli mcp serve`) or `barkd` can pay our invoices. The preimage (the secret that proves payment) is the receipt. **verified** ([launch post](https://lightning.engineering/posts/2026-07-21-wavelength-launch/)) | Nothing breaks, as long as settlement still converts into Cashu credits. |

**What breaks "the server is blind to the client balance"?** All **inferred**:
1. Running our own Ark server. We would see every balance, and might become a regulated operator.
2. Wavelength credits: an account keyed to an identity.
3. Reusing one Wavelength identity key across top-ups. The key is fixed per seed. **verified**
4. Any design where our server pays into, or reads, a customer's Ark wallet.

Keeping Ark strictly on the payer's side of a Lightning invoice breaks nothing.

---

## 4. Non-monetary uses: how features get born

BOLT12 gave you Silent Drop because a reusable payment code turned out to be a reusable *contact* code. Here are Ark's and Wavelength's building blocks, looked at the same way.

**The primitives on the table** (all **verified** unless marked):

| Primitive | What it is, plainly | Source |
|---|---|---|
| **Hash-lock (preimage reveal)** | "This unlocks only when someone reveals secret *p* whose hash is *H*." Used in hArk refreshes, Lightning HTLCs and Wavelength vHTLCs. | [forfeits](https://second.tech/docs/learn/forfeits), [swap_system.md](https://github.com/lightninglabs/wavelength/blob/main/docs/swap_system.md) |
| **Timelocks (CSV/CLTV)** | "After N blocks, someone else may act." | same |
| **Forfeit + connector** | "My signature only counts if *that* transaction confirms." | [forfeits](https://second.tech/docs/learn/forfeits) |
| **Operator co-signature** | Every off-chain transfer is countersigned by the server. | [payments](https://second.tech/docs/learn/payments) |
| **Coin expiry** | Every coin dies unless refreshed, which is a built-in heartbeat. | [lifetime](https://second.tech/docs/learn/lifetime) |
| **Blinded mailbox ID** | An address carries an ECDH-blinded mailbox pointer: senders can't link your addresses, but the server can. | [mailbox.md](https://gitlab.com/ark-bitcoin/bark/-/blob/master/docs/mailbox.md), changelog 0.7.0 |
| **Ownership proof / receive token** | Prove you control a coin, or present a server-issued token, to be allowed to claim a receive (anti-DoS). | [`receive.rs`](https://gitlab.com/ark-bitcoin/bark/-/blob/master/bark/src/lightning/receive.rs) |
| **Forwarding invoice** | An invoice whose money is signed straight to *someone else's* Ark address. The forwarder "has no custodial control and cannot redirect". | `receive.rs` (`bolt11_invoice_for_address`); changelog 0.4.0, 20 Jul 2026 |
| **Round commitment** | Each round puts one transaction on-chain that commits to a tree of coins. | [rounds](https://second.tech/docs/learn/rounds) |
| **Scheduled batches** (Wavelength) | An operator-published UTC timetable, with your slot choice signed into your join. | [scheduled_batches.md](https://github.com/lightninglabs/wavelength/blob/main/docs/scheduled_batches.md) |
| **Agent wallet over MCP** (Wavelength) | Tools for an AI agent to pay; seed and unlock stay off the agent channel. | [launch post](https://lightning.engineering/posts/2026-07-21-wavelength-launch/) |

### 4.1 Ideas, graded

| # | Idea | Borrowed primitive | Grade | Why |
|---|---|---|---|---|
| 1 | **"Collected" receipt.** The sender gets cryptographic proof that someone holding the link opened the transfer. | Hash-lock, **as an idea only** | **Feasible now, no Ark, no money** | Derive `p = HKDF(fileKey, "collected")` and store `H = SHA256(p)` with the transfer. The receiver's browser posts `p` after decrypting. The Worker or sender checks `SHA256(p) = H`. The Worker learns `p`, but `p` cannot reveal `fileKey` (it's one-way). **inferred** It can travel over Nostr NIP-59 instead of the Worker. |
| 2 | **Paid Drop.** An anonymous seller with no node and no account sells a file. The buyer's payment *atomically* releases the key. | Lightning preimage as key-release, plus a browser Ark wallet as a node-less payee | **Needs X** | Seller creates an invoice with preimage `p` and puts `W = Enc(p, fileKey)` in the buyer's link. Paying reveals `p`, which decrypts `W`. Routing hops and the Ark server learn `p` but never see `W`; our server sees neither. **inferred** **Missing piece:** bark makes a fresh preimage on the seller's device, **verified** ([LN docs](https://second.tech/docs/learn/payments-lightning)), but its `bolt11_invoice` API **does not return it or accept a chosen one**, **verified** (`receive.rs`). phoenixd *does* expose `preimage` on incoming payments, **verified** (`JsonSerializers.kt`), but phoenixd is *ours*, so we'd hold the seller's money and their key. **Needs a one-function change to the bark SDK.** |
| 3 | **Pay-on-collect bounty.** The sender locks a small refundable sum that only the real collector can claim, by revealing the collection preimage from idea 1. Uncollected means refunded at time T. | Hash-lock + CLTV refund (a vHTLC) | **Needs X** | Needs a hold invoice or vHTLC on a *chosen* hash. Neither phoenixd (it uses `randomBytes32()`, **verified**, `Api.kt`) nor bark's public API offers one. Possible on LND or CLN hold invoices. Also a regulatory question. |
| 4 | **Blinded Quay addresses.** Each source gets a different-looking Quay address; the relay can't tell two drops are for the same Quay, but the Quay can. | bark's blinded mailbox ID, **as a pattern** | **Feasible now, no Ark** | Pure ECDH key tweaking, done in our own code. **inferred** It's Silent Drop's natural sibling. |
| 5 | **Non-custodial tip jar on a Quay.** Supporters tip a Quay owner via an invoice we mint, but the money goes straight to the owner's Ark address. | Forwarding invoice | **Feasible now** (Second mainnet) | We never hold keys. **verified** (`receive.rs` trust note) But Second sees every tip, and we'd be "forwarding" money: a solicitor question. **inferred** |
| 6 | **Agent-to-agent receipts.** An MCP client pays per upload and gets the preimage as a receipt, swapped for Cashu credits. | Preimage receipt; Wavelength MCP wallet | **Feasible now** (signet for Wavelength; mainnet with bark) | Ark is only the *agent's* wallet. Our side stays phoenixd + Cashu. **inferred** |
| 7 | **Timestamped existence attestation.** Tweak a coin's key with a file hash, then refresh it into a round; the round transaction commits to it on-chain. | Round commitment + pay-to-contract key tweak | **Feasible but pointless** | Needs a wallet fork, a minimum coin, and refresh costs. **OpenTimestamps does this free.** **inferred** |
| 8 | **Expiring capability tied to a coin's life** | Coin expiry | **Fantasy** | Coin expiry is visible only to the operator and costs sats. R2 lifecycle rules already expire transfers. **inferred** |
| 9 | **Anonymous rate-limit / anti-spam for Quays** via proof-of-funds | Ownership proof | **Works, but worse than what you have** | Proving you own a coin reveals *which* coin, so it's linkable. **inferred** Burnable Cashu proofs are unlinkable and already in your stack. |
| 10 | **Dead-man switch / warrant canary.** A coin whose beneficiary can claim after T unless the owner refreshes. | CLTV + multisig leaves; refresh as heartbeat | **Needs X → fantasy for now** | Wavelength's arkscript can *express* CLTV + multisig shapes, **verified** ([arkscript_spec.md](https://github.com/lightninglabs/wavelength/blob/main/docs/arkscript_spec.md)), but the operator only admits standard policies. **verified** (same, §7.2) And money isn't a key release. Nostr + OpenTimestamps + time-lock encryption is the better toolkit. **inferred** |
| 11 | **Operator co-signature as a notary** ("Second witnessed this hand-off") | Co-signature | **Fantasy** | Signatures prove authorisation, not time, and you'd be asking a US company to witness your users. **inferred** |
| 12 | **Wavelength-style credit ledger** | Server ledger | **Anti-pattern** | It is the account model your anonymous rail exists to avoid. **inferred** |

**What to take from this:**
- Ideas **1 and 4** borrow Ark's *ideas*, not its network. Build them in Refueler proper, whenever they fit the roadmap.
- Idea **2 (Paid Drop)** is the one feature that genuinely needs a node-less, browser-held Lightning payee. Ark is the only thing today that gives you that without custody.
- So Paid Drop is the experiment. **inferred**

---

## 5. Risks

### 5.1 Questions for a UK solicitor (FCA cryptoasset regime)

**Context.** The FCA published final rules on 30 Jun 2026 (PS26/9 to PS26/13). The authorisation window runs **30 Sep 2026 to 28 Feb 2027**, and the regime **commences 25 Oct 2027**. Firms that miss the window lose transitional protection. **verified (secondary)** ([Lewis Silkin, 1 Jul 2026](https://www.lewissilkin.com/insights/2026/07/01/fca-finalises-core-crypto-rules-102n7nu); [Travers Smith](https://www.traverssmith.com/knowledge/knowledge-container/can-we-finally-summit-all-up-the-fcas-cryptoasset-regime-largely-emerges-from-the-clouds/); [PaymentExpert, 17 Sep 2026](https://paymentexpert.com/2026/09/17/fca-crypto-regime-guidance-firms/)) Perimeter guidance PS26/18 is reported as published 16 Sep 2026. **verified (secondary), unconfirmed against the FCA site**

Questions to ask, not answers:
1. If we run a Cashu mint whose reserves sit in Ark coins co-signed by a US operator, are we "safeguarding" or "arranging safeguarding" of cryptoassets? Does the answer change if reserves are in phoenixd channels instead?
2. If our software runs a `barkd` wallet that receives customer payments for our own services, is that just a merchant taking payment, or a regulated activity?
3. **Paid Drop (idea 2):** if our platform carries the encrypted key and the link, but never the money or the preimage, are we arranging deals, operating a platform, or neither?
4. **Tip jar (idea 5):** we mint invoices whose proceeds are signed straight to a third party's Ark address, and we never hold keys. Is minting the invoice "arranging" a transfer?
5. **Pay-on-collect bounty (idea 3):** if we coordinate a refundable deposit released by a cryptographic event, is that escrow? Does it matter that we never hold the funds?
6. Does using a US co-signer (Second / TwoND, Inc.) that reserves the right to refuse UK users change our position under UK sanctions or financial-promotion rules?
7. Are Cashu credits sold at 1 credit = 1 sat "cryptoassets", or prepaid service vouchers, for regime purposes? Does adding Ark anywhere change the answer?
8. If we must apply, does the window closing 28 Feb 2027 apply to us, and what happens to the anonymous rail if we don't apply?
9. What records would AML rules expect us to keep for the anonymous rail? Does any Ark design increase that duty?
10. If an agent (an MCP client) pays us, who is the "customer" for any customer-due-diligence purpose?

### 5.2 Maturity
- **bark** is at 0.x, and almost every release lists **BREAKING** changes. **verified** ([CHANGELOG](https://gitlab.com/ark-bitcoin/bark/-/blob/master/CHANGELOG.md))
  - The operator lost 0.75 BTC on 5 Oct 2026. **verified (secondary)**
  - Auto-exit on failed Lightning receives is switched off. **verified**
  - Delegated refresh trusts the server alone. **verified**
- **Wavelength** is alpha. "RPC surfaces, on-disk schema, and CLI commands may still change." **verified** ([README](https://github.com/lightninglabs/wavelength))
  - Mainnet REST endpoints are not live: `wavelength-rest.lightning.finance` returned HTTP 501 on 11 Oct 2026. **verified** (live request)

### 5.3 Single-operator risk
- Each network has exactly **one** operator, and Ark-to-Ark payments only work inside the same one. **verified** ([LN docs](https://second.tech/docs/learn/payments-lightning))
- If the operator stops, every coin must exit on-chain before it expires. That costs several on-chain fees each, and tiny coins may be uneconomic to rescue. **verified** ([exit](https://second.tech/docs/learn/exit))
- Second can stop serving the UK at will. Its terms say it may "restrict, suspend, or discontinue" service where licensing may apply. **verified** ([terms](https://second.tech/terms))
- Alternatives exist: Ark Labs' Arkade is a third implementation. **verified (secondary)** ([Bitcoin Magazine](https://bitcoinmagazine.com/news/second-launches-bark-on-bitcoin-mainnet)) I did not research it, and it is not in scope here.

### 5.4 Key management on our side (if we ever ran `barkd`)
- The mnemonic plus a **database backup after every state change**; the seed alone is not enough. **verified** ([backups](https://second.tech/docs/backups))
- The `barkd` bearer token gives full wallet access over **plain HTTP**. It must stay on loopback or behind a TLS proxy. **verified** (README)
- The server must be online for every refresh and every Lightning claim. **verified**
- The Hetzner ARM box would need an arm64 build of `captaind`/`barkd`. I didn't confirm prebuilt arm64 binaries. **inferred**: a Nix or cargo build should work, but check before relying on it.

---

## 6. Recommendation

**Verdict: watch, and run one lab experiment. Do not adopt at B7.**

**B7 stays phoenixd**, with auto-liquidity funded by customers' first payments (section 2, option A). Customers using Ark wallets already pay you through it.

**Re-open the question when any one of these happens.** All are things to watch for, **inferred**:
1. Second publishes a post-mortem **and** an independent audit.
2. A **non-US** Ark operator reaches mainnet.
3. Wavelength opens mainnet without an identity allowlist **and** publishes its operator code.
4. The bark SDK exposes the Lightning-receive preimage, or accepts a chosen hash. That unlocks Paid Drop.
5. A CDK payment backend for `barkd` appears.

### The one experiment worth running first

**"Paid Drop spike" on Second's signet, in a separate lab repo (for example `refueler-lab-ark`), time-boxed to two sessions.**

1. A static HTTPS page loads `@secondts/bark` (WASM), creates a throwaway signet wallet, and receives one Lightning payment from Second's signet faucet.
2. Record five things:
   - What the page sends to `ark.signet.2nd.dev`, from the browser network log.
   - Time to ready, and the WASM size.
   - What survives a browser storage wipe, with seed-only restore.
   - How the 1–3 day expiry and refresh behave.
   - **Whether the receive preimage can be read before payment.** That needs a small patch to the MIT-licensed bark FFI.
3. If the preimage is reachable: encrypt a test file key as `W = Enc(p, fileKey)`, pay the invoice from a second signet wallet, and confirm the payer can decrypt.

- **Success:** one atomic "pay and the key opens" round-trip, in a browser, with no node and no account.
- **Kill:** the preimage can't be reached without forking deep internals, or the network log shows linkable identifiers beyond what is documented.

Separately, and not as an Ark task: put the **"collected" receipt** (idea 1) and **blinded Quay addresses** (idea 4) on the normal Refueler roadmap. They need no Ark and no money.

---

## Technical appendix

### A. How Ark works (one screen)
- **Board.** You and the server pre-sign an exit transaction, then you broadcast a funding transaction. After **six confirmations** you get a **VTXO**: an off-chain coin backed by pre-signed transactions you can broadcast alone. Boarding needs no round. **verified** ([board](https://second.tech/docs/learn/board)) The funding output is a user+server MuSig output. **verified** (bark commit `48b005f`, 5 Oct 2026)
- **Pay (arkoor).** You and the server co-sign a transaction extending your coin to the recipient's key. The receiver trusts that sender and server don't collude, until they refresh. **verified** ([payments](https://second.tech/docs/learn/payments))
- **Refresh (round).** Old coins are forfeited for new ones in a shared tree whose root is one on-chain transaction. Since bark 0.1.0-beta.6 (23 Jan 2026), refresh atomicity uses hash-locks (hArk) instead of connectors. **verified** ([forfeits](https://second.tech/docs/learn/forfeits))
- **Lightning.** The server is your gateway. Sends use an HTLC from your coin. Receives use an HTLC funded from the server's pool coin, which you claim by revealing a preimage you generated on-device. **verified** ([LN docs](https://second.tech/docs/learn/payments-lightning))
- **Leave.** Cooperative offboard (connector-protected), or emergency exit: broadcast the tree branch, wait 144 blocks, then claim. **verified** ([exit](https://second.tech/docs/learn/exit))
- **Wavelength differences.**
  - Lightning is a swap through a separate swap server (`swapd`), using a six-leaf vHTLC. **verified** ([swap_system.md](https://github.com/lightninglabs/wavelength/blob/main/docs/swap_system.md))
  - Sub-floor amounts become server-ledger credits. **verified**
  - Stablecoins via Taproot Assets are "coming soon". **verified** ([launch post](https://lightning.engineering/posts/2026-07-21-wavelength-launch/))

### B. Live Wavelength signet operator parameters (POST `/v1/ark/get-info`, 11 Oct 2026)
**verified**, live response from `https://signet.wavelength-rest.lightning.finance`:
```
version 0.1.99 · vtxo_exit_delay 144 · boarding_exit_delay 512
dust_limit 1000 · min_vtxo_amount_sat 1000 · min_boarding_amount 1000
max_vtxo_amount 200000 · max_user_balance 100000000
min_operator_fee 1000 · annual_rate 0.05 · base_margin_sat 100
free_refresh_window_blocks 504 · vtxo_confirmations 1 · batch_schedule null
```

### C. bark server defaults (template, not Second's mainnet values)
**verified**, [`server/captaind.default.toml`](https://gitlab.com/ark-bitcoin/bark/-/blob/master/server/captaind.default.toml):
```
vtxo_lifetime 4320 blocks · vtxo_exit_delta 144 · min_board_amount 20000 sat
required_board_confirmations 3 · max_vtxo_exit_depth 100 · round_interval 10s
htlc_expiry_delta 40 · htlc_send_expiry_delta 258 · invoice_expiry 48h
receive_htlc_forward_timeout 3min · ln_receive_anti_dos_required false
```
Second's mainnet uses a 28-day lifetime and hourly rounds. **verified** ([lifetime](https://second.tech/docs/learn/lifetime), [rounds](https://second.tech/docs/learn/rounds))

### D. Who sees what (summary)

| Party | Refueler today (phoenixd + Cashu) | Add customer-side Ark only | Add `barkd` server-side | Ark credits in the browser |
|---|---|---|---|---|
| Our Worker/DB | Spent-proof hashes only | Same | + our Ark history | Same, but blind |
| ACINQ | Inbound amounts and hashes | Same | **Gone** | Gone |
| Ark operator | — | The customer's payment to our invoice | **All our receipts, linked** | **Every customer balance, linked** |
| Public chain | ACINQ's channel transactions | Rounds | Rounds | Rounds |

All **inferred** from the verified mechanics above.

### E. Paid Drop construction (idea 2)
```
seller (browser Ark wallet):  p ← wallet's receive preimage   (needs API)
                              inv ← BOLT11(amount, H = SHA256(p))
                              W ← AES-GCM(key = HKDF(p, "paid-drop"), fileKey)
seller → buyer link fragment: { transferId, inv, W }
buyer pays inv  → learns p (proof of payment) → fileKey = Dec(HKDF(p), W)
```
- Who learns `p`: the routing hops and the Ark server.
- Who sees `W`: only link holders.
- Our server sees neither, so it stays blind. **inferred**
- bark's current API (`bolt11_invoice(amount, description, token)`) neither returns nor accepts `p`. **verified** ([`receive.rs`](https://gitlab.com/ark-bitcoin/bark/-/blob/master/bark/src/lightning/receive.rs))

### F. "Collected" receipt construction (idea 1)
```
at send:     p = HKDF(fileKey, "refueler/collected/v1");  store H = SHA256(p) with transfer
at collect:  receiver browser computes p after successful decrypt; POST {transferId, p}
verify:      SHA256(p) == H  → mark collected (or relay p to sender via NIP-59 gift wrap)
```
- `p` reveals nothing about `fileKey`, because HKDF is one-way.
- An attacker would need the fragment key to forge `p`. **inferred**

### G. Sources (all read 11 Oct 2026 unless dated)

**Second / bark**
- Repo: https://gitlab.com/ark-bitcoin/bark (master `851d31a`, 10 Oct 2026). Also bark-ffi: https://gitlab.com/ark-bitcoin/bark-ffi
- CHANGELOG: https://gitlab.com/ark-bitcoin/bark/-/blob/master/CHANGELOG.md
- Product changelog: https://second.tech/docs/changelog
- Mailbox design: https://gitlab.com/ark-bitcoin/bark/-/blob/master/docs/mailbox.md
- Addresses: https://gitlab.com/ark-bitcoin/bark/-/blob/master/docs/addresses.md (spec: [BOAT-001](https://github.com/ark-protocol/boats/blob/master/boat-0001.md))
- Server config template: https://gitlab.com/ark-bitcoin/bark/-/blob/master/server/captaind.default.toml
- Lightning receive API: https://gitlab.com/ark-bitcoin/bark/-/blob/master/bark/src/lightning/receive.rs
- Docs:
  - https://second.tech/docs/learn/lifetime
  - …/exit
  - …/rounds
  - …/forfeits
  - …/payments
  - …/payments-lightning
  - …/fees
  - …/board
  - https://second.tech/docs/bark-sdk/wasm
  - https://second.tech/docs/backups
  - https://second.tech/docs/connection-details
  - https://second.tech/docs/getting-started/bark-cli/mainnet
- Pricing: https://second.tech/pricing
- Terms (revised 10 Aug 2026): https://second.tech/terms
- Blog:
  - [Mainnet, 9 Jun 2026](https://second.tech/blog/bark-now-on-bitcoin-mainnet/)
  - [Payjoin boards, 10 Sep 2026](https://second.tech/blog/payjoin-boards-board-psbt/)
- Incident:
  - [Second on X, 8 Oct 2026](https://x.com/secondhq/status/2108065406665805992), via [The Bitcoin Manual](https://thebitcoinmanual.com/articles/ark-operator-second-hack/)
  - [news.bitcoin.com](https://news.bitcoin.com/security/hackers-attack-another-bitcoin-project-as-arks-second-exploited/)
- Academic: Keer et al., "Ark: Offchain Transaction Batching in Bitcoin", https://arxiv.org/abs/2605.20952 (v1 20 May 2026, v2 21 Jun 2026)

**Lightning Labs / Wavelength**
- Launch post (21 Jul 2026): https://lightning.engineering/posts/2026-07-21-wavelength-launch/
- SDK: https://github.com/lightninglabs/wavelength-sdk (`main` `4f98610`). Docs: https://wavelength.lightning.engineering, specifically:
  - …/introduction/the-wavelength-system/
  - …/introduction/system-architecture/
  - …/concepts/networks-and-config/
  - …/concepts/balances-and-vtxos/
  - …/concepts/leaving-ark/
  - …/concepts/lightning-payments-are-swaps/
  - …/web/get-started/requirements/
- Daemon: https://github.com/lightninglabs/wavelength (`main` `d4af719`), specifically:
  - `README.md`, `ARCHITECTURE.md`
  - `docs/credit_system.md`, `docs/swap_system.md`, `docs/signet.md`
  - `docs/arkscript_spec.md`, `docs/scheduled_batches.md`
- Live operator info: `POST https://signet.wavelength-rest.lightning.finance/v1/ark/get-info`

**ACINQ / phoenixd**
- Repo: https://github.com/ACINQ/phoenixd (v0.9.2, 30 Sep 2026; `master` `85d0472`)
- Files: `src/commonMain/kotlin/fr/acinq/phoenixd/Phoenixd.kt`, `Api.kt`, `json/JsonSerializers.kt`

**Cashu**
- https://github.com/cashubtc/cdk/pull/2407 (draft, opened 21 Aug 2026)

**npm** (registry.npmjs.org)
- `@secondts/bark` 0.25.0 (24 Sep 2026)
- `@lightninglabs/wavelength-web` 0.1.2 (11 Sep 2026)
- `@cashu/cashu-ts` 4.11.0 (22 Sep 2026)

**UK regulation** (secondary)
- https://www.lewissilkin.com/insights/2026/07/01/fca-finalises-core-crypto-rules-102n7nu
- https://www.traverssmith.com/knowledge/knowledge-container/can-we-finally-summit-all-up-the-fcas-cryptoasset-regime-largely-emerges-from-the-clouds/
- https://paymentexpert.com/2026/09/17/fca-crypto-regime-guidance-firms/

**Secondary press used for dates only**
- https://bitcoinmagazine.com/news/second-launches-bark-on-bitcoin-mainnet
- https://www.tftc.io/wavelength-lightning-labs-self-custodial-bitcoin-api-agents
