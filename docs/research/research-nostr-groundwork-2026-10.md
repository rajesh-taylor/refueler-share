# Nostr groundwork for Refueler's private notifications

Research as of **11 October 2026**, written ahead of the design session. This is not legal advice.

> **Review box — Research-Review-3 (11 Oct 2026, Opus).** Re-checked at source (nips `a79e21d`, nuts `8bde3c0`, blossom `b5bd280`, `paulmillr/nip44` audit PDF read in full, live NIP-11 for 13 relays, npm registry). Holds: Cure53 NOS-01 (ten findings, none exploitable; 006 forward secrecy + 007 key separation unfixed), NIP-40/59/62/17/06 wording, NUT-24 unimplemented, NUT-18 wallets only, NUT-28 in cashu-ts, BUD 00–12 all draft, Send `dtotal` behind the owner token, nostr.wine terms (IP collected, deletion not guaranteed), Kimura et al. (project page: recommends NIP-44 + NIP-17/59 and mandatory signature checks), library versions. inbox.nostr.wine's NIP-11 declares 1059 retention `time: null` (kept indefinitely).
> **Relay test run (B.6, Node from the Mac, Mullvad on; script `dev/relay-check/`):** expired-on-arrival wraps rejected everywhere ✓; NIP-40 expiry **hid** events on all five open relays within 5 min ✓; **NIP-09 by the `p` key and NIP-62 vanish were accepted ("OK") and not honoured** at 5 min on nos.lol, primal, nostr.mom, offchain.pub (westernbtc refused both: sign-up), and NIP-09 not honoured on auth.nostr1.com either. Open relays serve 1059 to anyone. **relay.damus.io demands AUTH for `#p` reads and its AUTH is misconfigured** ("needs serviceUrl") — unreadable, not open as A2.2 inferred. **auth.nostr1.com gates correctly** (publisher AUTH with a one-time key; stranger gets 0 even by id; recipient gets the event). inbox.nostr.wine refuses wraps to keys without a bought inbox. relay.ditto.pub unreachable (NIP-11 and WebSocket).
> **Corrections:** (1) RUSTSEC-2026-0227 missed (Rust `nostr`: base64-decodes before any size cap; fixed 0.44.7) — cap size before decoding. (2) NOS-01-004 is WP2/WP4 (JS and Rust), not noble alone; nostr-tools still uses noble `equalBytes` (Low). (3) nostr-tools `nip44.ts` is a port of the audited reference, not the audited code (ships the official vectors — run them). (4) nostr-wasm is a hard dep in published 2.25.2, optional peer on master. (5) Competitors added: Bitwarden Send (counter, account), Filemail (download emails, account-based per help), Yopass 14.2 read receipts (token + Receipts page, licensed), Hemmelig / Internxt / FiNo / napstr (none found). Keet still unchecked.
> **Out of step with Share:** Q4/A4.2 idea 1 — Share's Worker mint issues credits, not sats, and accepts only its own proofs; a NUT-18 payer sends sat ecash from another mint, so accepting it means melting at that mint into our phoenixd (needs B7 + a mint allowlist) — not "feasible now". A5 — BUD-01 requires `Access-Control-Allow-Origin: *` on every response (own hostname, never beside credentialed CORS); echoing Content-Type breaks the "Worker never learns the file type" lock (octet-stream only); PUT body passes through the Worker; SHA-256 address = new job under the three-hashes lock; BUD-07 `X-Cashu` only pays with Share credits, so Lightning after B7. A6 — `tid` in the rumor is redundant (N is per transfer); nostr-tools pins older noble than the Worker (vendor with matched pins).
> **Unverified:** Ditto relay today, Amber "NIP-44 v3" contents, Keet, Filemail no-account behaviour, Kimura full PDF (403), purge after expiry (unknowable from outside).
> **Decided (Rajesh):** relay login only with a per-job key, never an identity key (replaces "NIP-42 off") · cover traffic dropped · partner commitments optional, not a blocker · Blossom parked (Blossom-Opus after solicitor + B7) · NUT-18 top-up = B7-Opus question, not the first rail-split feature · Nostr-Opus = one session (agenda in Master Context row 19) · X5-Plan reserves the reading side · relay test + competitor sweep re-run before notices ship. See Master Context 9.17, CLAUDE.md 2.17.

**Legend**
- ✅ **Verified.** Read today in a primary source: a spec, source code, the audit PDF, a vendor page, the npm registry, or a relay's own NIP-11 document.
- 🟡 **Secondary.** A newsletter, review site, search-engine extract of a vendor page, or a forum post.
- 🔵 **Inferred.** My own reasoning from the verified facts. Treat it as a proposal, not a fact.
- 🆕 Changed in 2025 or 2026.
- **Not found** means I looked and found nothing.

**How this was gathered**
- Specs (NIPs, BUDs, NUTs) were read from the `master`/`main` branches of their GitHub repos on 11 Oct 2026.
- Relay facts come from each relay's live NIP-11 document, fetched on 11 Oct 2026 for 35 relays (30 answered).
- Library versions come from the live npm registry.
- I wanted to **test** whether relays really honour expiry and deletion: publish throwaway gift wraps, wait, then query. This environment's network proxy does not allow WebSocket connections, so **no relay behaviour was tested**. Everything about what relays *do*, as opposed to what they *advertise*, is marked 🔵. A short test plan is in Appendix B.6.

---

# Part 1: Plain-English summary

## Read these six first

1. **Your crypto choice is sound, and its weak spot is one your design already fixes.**
   - NIP-44 v2 was audited by Cure53 in Nov–Dec 2023 ✅. They found **no exploitable vulnerabilities**, and ten weaknesses ranging from "Info" to "Medium".
   - The biggest weakness is **no forward secrecy**: steal a key and you can read everything ever sent to it. This was never fixed in the protocol ✅.
   - Your rule of **one key per job, thrown away when the job ends** gives you forward secrecy per job in practice 🔵. Steal one job's key and you get one job's notices, not a person's history. Write that rule down as a security property, not just a privacy one.
2. **"Expiry" on Nostr means "stops being shown", not "gets deleted".**
   - NIP-40 says relays "MAY persist them indefinitely" and warns: "don't consider expiring messages as a security feature" ✅.
   - So the copy must never say a notice "self-destructs". A better word is "expires".
   - For real cleanup, the job key can send a **NIP-62 "request to vanish"**, which relays MUST honour by fully deleting. Only 2 of the 30 relays checked advertise NIP-62 support ✅. Otherwise there is NIP-09 deletion, which nearly all advertise ✅.
3. **Keeping relay login (NIP-42 AUTH) switched off is the wrong default 🔵.**
   - The privacy-respecting relays only hand a gift wrap to whoever proves they own the recipient key. That is exactly what stops strangers listing "everything sent to key X" ✅ (NIP-17, NIP-59).
   - Logging in with a **per-job** key tells the relay nothing it doesn't already know, because the key is already in the event's `p` tag.
   - The rule should be: **AUTH only ever with a per-job key, never with a personal npub.**
4. **You cannot claim "first" for telling senders a file was collected without an account.**
   - **Send** (the Mozilla Send fork) shows the uploader a download count with no account or email. I checked its source: `/api/info/:id` returns `dtotal` to whoever holds the owner token ✅.
   - **Magic Wormhole** prints "Confirmation received. Transfer complete." to the sender ✅, and **OnionShare** stops sharing once the download completes ✅. Neither needs an account.
   - What nobody I found does is tell the sender **later, on another device, after the tab is closed, without an email, phone number or account**. That is a narrower claim. Phrase it as "we don't know of anyone else who…", never "first".
5. **NutZaps (NIP-61) are public, so don't use them for receipts.**
   - A kind 9321 nutzap is a plain, signed, public event naming the recipient and the sender ✅. Using one as a "collected" receipt would publish the very link you're hiding.
   - The useful Cashu-over-Nostr piece is **NUT-18's Nostr transport**. There, a wallet sends ecash inside a NIP-17 private message ✅.
   - That supports two things:
     - an **anonymous credit top-up over Nostr**, feasible now;
     - **postage stamps on drop-box messages and replies**, feasible now.
6. **Blossom fits your stack, but it pulls against "destroyed after download".**
   - Blossom blobs are public by hash ✅, and anyone may copy (mirror) them to another server ✅.
   - So "destroyed after download" can only ever mean "destroyed **on Refueler**".
   - BUD-07 paid upload with Cashu exists on paper ✅. But the Cashu spec table lists **no wallet or mint implementing NUT-24** ✅.

## Q1. Is the crypto in good shape?

**Mostly yes, with known, documented limits.**
- **NIP-44 v2** (the encryption) was audited by Cure53 in late 2023, along with the JS, Go and Rust code. There were no exploitable bugs ✅.
  - Their protocol suggestions were never adopted, because v2 was frozen ✅. These were: forward secrecy, separate keys for signing and encrypting, and tidier key derivation.
  - The spec still lists its own limits ✅: no forward secrecy, no deniability, no hiding of IP addresses, a public `created_at`, and only partial hiding of message length.
- **A "NIP-44 v3" is in the wild but not in the spec.** 🆕 The Amber signer app shipped "NIP-44 v3 encryption ahead of the spec" on 1 June 2026 🟡. The official NIP still lists version 2 as current ✅. **Don't touch v3** until it is merged and audited.
- **NIP-59 gift wraps and NIP-17 private messages** are the right wrappers ✅.
  - The outer wrapper is signed by a throwaway key.
  - The inner "seal" is signed by the real sender, which for you is the per-job key.
  - Timestamps should be backdated by a random amount, up to two days.
- **NIP-17 already has a "file message" (kind 15)** with fields for an AES-GCM key and nonce ✅. That is close to what Refueler already does, and it could make "send a link to an npub" readable in ordinary Nostr apps 🔵.
- **The 2025 academic attack paper doesn't hit you.**
  - Kimura et al. (IEEE EuroS&P 2025, also shown at Black Hat USA 2025) broke the **old** NIP-04 DMs and clients that skip signature checks ✅.
  - The paper recommends NIP-44, NIP-17 and NIP-59 ✅.
  - The lesson for you: **verify every signature on every layer, and never fetch link previews** from inside a notice 🔵.
- **Libraries**
  - **Crypto core:** the audited code is Paul Miller's `nip44` reference plus his `noble` libraries.
    - `noble-ciphers` was audited by Cure53 in Sep 2024 ✅.
    - `noble-curves` was audited by Trail of Bits as recently as Aug 2026 ✅.
  - **nostr-tools** 2.25.2 (4 Sep 2026) is lean and actively released ✅, but has **no audit of its own** ✅.
  - **NDK** 3.0.3 pulls in heavyweight extras, including `debug`, the very package hijacked in the 8 Sep 2025 npm attack ✅.
  - **Recommendation 🔵:** use `nostr-tools` for the Nostr plumbing, or `paulmillr/nip44` plus noble directly for the crypto path. Avoid NDK in the browser bundle.

## Q2. Do relays actually behave?

**On paper, mostly. In writing, almost none commit to anything.**
- **What relays advertise.** Of the 30 relays that answered, nearly all strfry-based relays list **NIP-09 (deletion)** and **NIP-40 (expiry)** ✅.
  - Only **two** require login: `inbox.nostr.wine` and `auth.nostr1.com`.
  - Only **two** list NIP-62 (vanish): `relay.ditto.pub` and `relay.westernbtc.com`, both running Ditto's relay ✅.
  - `relay.damus.io` lists gift wraps (NIP-59) but not login (NIP-42) ✅. That probably means anyone can ask it for every gift wrap addressed to a given key 🔵.
- **What relays write down.**
  - **nostr.wine's terms** say they collect "IP address and/or public key … for the purpose of detecting abuse", that deletion "cannot be guaranteed", and that you grant rights "for an unlimited time" ✅.
  - **Damus's privacy policy** doesn't mention IP addresses ✅.
  - **auth.nostr1.com** publishes no policy text ✅.
  - **I found no relay with a published no-IP-log policy** (Not found).
  - The NIP-11 spec doesn't even have a privacy-policy field any more ✅.
- **Paid relays don't fit per-job keys.**
  - Prices: nostr.wine charges 18,888 sats once ✅. inbox.nostr.wine charges 2,500 sats per 30 days ✅. Nostr Elites charges 50,000 sats per 30 days ✅.
  - Paid relays whitelist **keys**, and you'd be minting thousands of throwaway keys 🔵.
  - A partner relay would need to accept gift wraps addressed to *any* key, which is a bespoke arrangement 🔵.
- **Rate limits.** Relays publish subscription caps: 20 at Primal, nos.lol and Ditto; 50 at nostr.wine; 200 at Damus ✅.
  - Most refuse events dated more than 5–15 minutes in the future ✅. So random backdating is fine, but never forward-date.
  - Per-IP limits are not published anywhere (Not found).
- **Who might sign a written promise** (no IP logs, honour expiry, honour vanish, AUTH-gated reads) 🔵 plausible, none contacted:
  1. **Ditto / Alex Gleason** (`relay.ditto.pub`). Already supports NIP-62. Is pushing encrypted files on public Blossom servers (NIP-94 PR #2437, Aug 2026) ✅.
  2. **nostr.wine** (`inbox.nostr.wine`). The most mature AUTH-gated inbox relay ✅, but would have to drop or narrow its IP clause.
  3. **nostr1.com** (`auth.nostr1.com`). A free "DM Inbox Relay", AUTH-required ✅.
  4. **Reserve: community operators** of `nos.lol`, `nostr.mom` or `offchain.pub`. They advertise NIP-40 and NIP-09 ✅, but have no AUTH and no policy.
  - For independence, pick operators in different countries on different hosts, none of them paid by you beyond a standard fee 🔵.

## Q3. Who else tells senders a file was collected?

| Product | Tells the sender? | Needs email/account? | Source |
|---|---|---|---|
| WeTransfer | Yes. A tick per recipient in the Transfers panel | **Yes.** Email is verified and a free account is auto-created | 🟡 |
| Smash | Yes. "Downloaded / not downloaded" emails, on free tier too | **Yes** (email) | 🟡 |
| Tresorit Send | Yes. The admin link tracks opens; optional email | **Yes** (verified email) | 🟡 |
| SwissTransfer | Yes. Notification option; the app tracks downloads | **Yes** (email) | 🟡 |
| Proton Drive (public links) | **Not found** | n/a | 🟡 |
| wormhole.app | **Not found** (the FAQ is silent) | n/a | ✅ FAQ checked |
| **Magic Wormhole** | Yes. "Confirmation received. Transfer complete." | **No** | ✅ |
| **OnionShare** | Yes. Stops sharing once the download completes | **No** | ✅ |
| **Send (timvisee fork) / ffsend** | Yes. Shows the download count to the owner-token holder | **No** | ✅ source code |
| OneTimeSecret | Yes. The metadata key shows "if or when it was viewed" | Anonymous creation exists ✅; anonymous status view 🔵 likely | ✅/🔵 |
| Nostr-native tools (nogringo/file-transfer, Anagram, Brainstorm-UI) | **Not found.** They encrypt to Blossom and send keys by NIP-44 or NIP-17, with no receipt | No | ✅/🟡 |

**Verdict.**
- Several products tell senders without an account. But Magic Wormhole and OnionShare need both ends online, and Send only shows the count when you reopen it in the same browser.
- **Not found anywhere:** an asynchronous push, to a phone or npub, after the sender has left, with no email, account or phone number, and with notice content end-to-end encrypted through third-party relays.
- That combination is your defensible ground 🔵. Re-run this sweep before any public claim.

## Q4. Can NutZaps and Cashu-over-Nostr be repurposed?

| Idea | Grade | Why |
|---|---|---|
| Anonymous credit top-up over Nostr (NUT-18 request with Nostr transport) | **Feasible now** | The wallet sends ecash as a NIP-17 DM ✅. The spec table lists cashu-ts, Cashu.me, cdk, Minibits and Sovran as supporting NUT-18 ✅. Nostr transport specifically is documented by Sovran 🟡. Needs a listener on your side 🔵. |
| Postage stamp on drop-box messages and replies (1–21 sats, locked to the per-box key, inside the gift wrap) | **Feasible now** | Uses P2PK (NUT-11), plus P2BK (NUT-28) so the mint can't link stamps ✅. The receiver sorts "stamped" from "unstamped" mail. It never blocks anything. |
| API/MCP: an agent pays by NUT-24 `X-Cashu` header and gets per-job keys back | **Feasible now on your side, needs X on theirs** | The spec exists ✅. No listed NUT-24 implementations ✅. cashu-ts can build the tokens 🔵. |
| Sender pre-pays relay costs inside the upload (notice postage) | **Needs X** | Needs a partner relay that takes Cashu per event. None found. |
| NIP-60 wallet per drop box, so stamps follow the owner across devices | **Needs X** | Workable, but adds relay-stored wallet state per box 🔵. Do it after stamps prove useful. |
| 0- or 1-sat nutzap as the "collected" receipt | **Fantasy, and against your rules** | Cashu has no zero-value tokens 🔵. NIP-61 events are public ✅. "The payment itself is the receipt" ✅ edges toward "proof of delivery", which your copy bans. |
| Hash-locked (NUT-14) payment released on collection | **Fantasy, and against your rules** | It makes a notification into control flow and an escrow, so it breaks two locked rules. |

## Q5. Blossom

- **Status ✅** (11 Oct 2026). There are 13 documents, BUD-00 to BUD-12, **all marked `draft`**.
  - BUD-00 and BUD-01 are mandatory. The rest are optional.
  - The set now includes **BUD-10** (`blossom:` links), **BUD-11** (login tokens) and **BUD-12** (list and delete). BUD-07 covers paid **download** as well as upload ✅. I could not check when each was added, because the GitHub API was blocked here.
- **Paying with Cashu (BUD-07) ✅.**
  1. The server answers `402` with an `X-Cashu` header (a NUT-24 payment request) and/or `X-Lightning`.
  2. The client retries with a `cashuB` token in the same header.
  3. A bad token gets `400` and an `X-Reason` header.
  - Wallet support for NUT-24 is listed as **none** ✅.
- **How clients choose servers ✅.**
  - Each user publishes a server list (kind 10063). Clients MUST upload to the first server on it, MAY mirror to others, and fall back to the author's list and then to "well-known popular" servers.
  - For you 🔵: a per-job key has no server list, so links must name Refueler's server explicitly.
- **Expiry fits ✅.** BUD-01 now has a `Sunset` header, for "expected to become unavailable at a specific time". That is a natural match for your expiring transfers. Clients treat it as advisory.
- **Reports (BUD-09) ✅.** Anyone can `PUT /report` a signed Nostr report (kind 1984) naming blob hashes.
  - Servers "MAY" keep the reports and act on them, "MAY" block removed hashes, and "SHOULD" publish their rules.
  - Expect relays and clients to copy those reports around. Reports are public Nostr events 🔵.
- **The liability problem 🔵** (not legal advice):
  - You can't prove a blob is ciphertext. Zipped or compressed files look just as random. So a paid Blossom endpoint is also a **free-for-anyone public CDN** for plaintext.
  - Hash-matching against known abuse imagery can't work on ciphertext.
  - Your defensible position:
    - serve everything as `application/octet-stream` with download-only headers, and never render inline;
    - keep retention short;
    - honour BUD-09 reports by deleting and blocking the hash;
    - publish the rules page;
    - don't run public mirroring (BUD-04) or listing (BUD-12).
  - This connects to the UK Online Safety Act points in your live-streaming research. Encrypted uploads are still user content.

## Q6. Event design: the short version

- **The Worker sends the notices, not browsers 🔵.** Only the server knows a download completed in full. Publishing from Cloudflare also keeps an anonymous uploader's or recipient's IP off every relay.
- **What each notice looks like.** Each notice is a NIP-17-style gift wrap addressed to the sender's random notification key. It is padded so that "collected", "destroyed", "expiring in 24 h" and "anchored in block N" are **byte-for-byte the same size**.
  - Timestamps are randomly backdated.
  - The expiry is set, with its own random jitter.
  - The same wrap goes to the 2–3 partner relays.
- **Cover traffic 🔵.** Every transfer gets the **same number of notices** over its life, whether or not anything happened. Relays then can't count downloads from traffic alone.
- **Clean-up.** At job end, the notification key sends a NIP-62 vanish request (or NIP-09 deletions), and the key is destroyed.
- **Write a NIP? Not for the notice format yet 🔵.**
  - First get two independent clients reading it.
  - The NIP worth writing sooner is a **relay policy profile**, a set of NIP-11 fields for "no IP logs, max retention X, AUTH-gated reads, honours NIP-62". Every privacy app needs that, not only Refueler.

## Q7. Decisions the design session must make

The ranked list is at the end of this document, after the technical appendix.

---

# Part 2: Technical appendix

## A1. Crypto status

### A1.1 NIP-44 v2 audit (Cure53, "NOS-01")

✅ Source: [Cure53 report](https://cure53.de/audit-report_nip44-implementations.pdf). It is dated 11 Dec 2023 and linked from [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md) and [paulmillr/nip44](https://github.com/paulmillr/nip44).

**Who and when**
- Requested by Paul Miller in Oct 2023.
- Tested in calendar weeks 47–48 of 2023 (late Nov to early Dec).
- Three senior testers, 10 days in total. Report credits: Dr M. Heiderich, Dr Mazaheri, Dr Bleichenbacher.

**Scope**
- WP1: cryptography review of the spec.
- WP2: the JS/TS implementation.
- WP3: the Go implementation.
- WP4: the Rust implementation.
- The README says the other six language ports were **not audited** ✅.

**Overall result:** "no vulnerabilities were detected… All ten findings… general weaknesses with limited exploitation potential." ✅

| ID | Finding | Severity | Status today |
|---|---|---|---|
| NOS-01-001 | Potential twist attacks in secp256k1 implementations | Info | Spec now requires validating keys 🔵 |
| NOS-01-002 | Spec improvement recommendations | Info | Editorial. Largely absorbed 🔵 |
| NOS-01-003 | Proposed test vectors for invalid conversation key | Info | Test vectors exist in the repo 🔵 |
| NOS-01-004 | Timing differences in HMAC comparison (`noble-ciphers equalBytes`) | Low | The spec now says MAC "compared in constant time" ✅. noble's README admits JS can't guarantee constant time ✅ |
| NOS-01-005 | Missing range checks (Go: panic on malformed input) | Medium | Go-only. A similar bug hit the **Rust `nostr` crate in 2026** (RUSTSEC-2026-0216, DoS on malformed NIP-44 payload, fixed in 0.44.5) 🟡🆕 |
| NOS-01-006 | **Lack of forward secrecy** | **Medium** | **Not fixed.** v2 is unchanged. The spec still lists "No forward secrecy" ✅ |
| NOS-01-007 | No key separation between signing and encryption | Low | Not fixed in v2. A separate proposal, NIP-4e (PR #1647, open), addresses it ✅ |
| NOS-01-008 | Misuse of the HKDF salt | Info | Not changed (the salt is still `nip44-v2`) ✅ |
| NOS-01-009 | No encryption nonce in the HMAC tag | Info | Not changed 🔵 |
| NOS-01-010 | Inclusion of extra authenticated data (AAD) in the HMAC needs clear boundaries | Info | Not changed 🔵 |

**What this means for Refueler 🔵**
- **NOS-01-006.** Your per-job keys, deleted at job end, give *job-scoped* forward secrecy.
  - The sender's notification key must be **erased** from browser storage and the Android app once the job closes, not merely forgotten.
  - The Worker's per-job seal key must be erased too.
- **NOS-01-007** doesn't apply to you. Per-job keys are never someone's long-term signing identity.
- **NOS-01-005 and the 2026 Rust advisory.** Malformed-input handling is where real bugs keep landing. Fuzz your decrypt path, and cap plaintext size before decrypting (the spec says implementations "should enforce their own maximum payload size" ✅).

### A1.2 Other NIP-44 facts that matter

- ✅ The **padding** "is related to powers-of-two, with min padded msg size of 32 bytes". Lengths leak to within roughly a power of two.
- ✅🆕 The spec now describes an **extended length prefix**: two zero bytes plus a 4-byte length, for plaintexts of 65,536 bytes or more.
  - Some libraries only added it in mid-2026 (for example, the Perl Net-Nostr release of 2 Jul 2026 🟡).
  - Nostr Compass's topic page still says "1 to 65535 bytes" 🟡.
  - **Keep every notice far under 64 KB** and the question never arises 🔵.
- ✅ Signatures **MUST be validated before decrypting**. Nonces come from a secure random source and are never reused.
- 🆕 **"NIP-44 v3".** Amber v6.2.0 (released 1 Jun 2026) "ships NIP-44 v3 encryption ahead of the spec" 🟡 ([Nostr Compass, 3 Jun 2026](https://buttondown.com/nostrcompass/archive/nostr-compass-4/)).
  - The current [44.md](https://github.com/nostr-protocol/nips/blob/master/44.md) lists `0x02` as the current version, with `0x01` "deprecated and undefined" ✅.
  - **Naming trap:** Nostr Compass's topic page says "NIP-44 revision 3 was merged in December 2023". That is the *third revision of the document* that defines *version 2* 🟡. "v3" means different things in different places.
  - I couldn't find what Amber's v3 changes (**Not found**).

### A1.3 NIP-59 (gift wrap) and NIP-17 (private messages)

✅ [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md)
- **Layers:** an unsigned **rumor** inside a kind 13 **seal** (signed by the author, tags "MUST always be empty") inside a kind 1059 **gift wrap**, signed by "random one-time keys".
- **Ephemeral variant:** kind 21059, which relays "MUST NOT store". Only for recipients who are connected at that moment.
- **Timestamps:** "The canonical created_at time belongs to the rumor. All other timestamps SHOULD be tweaked". "All timestamps SHOULD be in the past".
- **Expiry on both layers:** "use independent random timestamps for each layer".
- **Relay rules:**
  - Relays "SHOULD guard access to kind 1059 events based on user AUTH" and "SHOULD only serve kind 1059 events intended for the marked recipient".
  - Relays "SHOULD delete kind:1059 events whose p-tag matches the signer of NIP-09 deletions or NIP-62 vanish requests". In other words, **the recipient key can clean up its own inbox**.
- **Spam:** relays "cannot rely on pubkey-based anti-spam". The spec suggests AUTH or NIP-13 proof-of-work on the wrapper. AUTH "does not fully undermine the privacy or deniability properties".

✅ [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md)
- **Kinds:** 14 (chat), 15 (file), and 10050 (the user's DM relay list).
- **Where to publish:** clients "MUST only publish… to the relays listed in the recipient's kind 10050". Keep the list to 1–3 relays.
- **Timestamps:** randomise `created_at` "up to two days in the past" on both the seal and the wrap.
- **Kind 15 file message** tags: `file-type`, `encryption-algorithm` (only `aes-gcm`), `decryption-key`, `decryption-nonce`, `x` (hash of the ciphertext), `ox` (hash of the original), and optional `size`, `dim`, `thumbhash`, `blurhash`, `thumb`, `fallback`.
- **Disappearing messages:** an `expiration` tag on each recipient's wrap, and on the seal too "in case it leaks".
- **Its own stated limitation:** one wrap per recipient, so it is not for groups over about 10.
- 🔵 For "send a link to an npub":
  - A kind 15 pointing at the Refueler ciphertext URL, with the AES key in `decryption-key`, would display in NIP-17 clients that support file messages.
  - Check the mismatch first: kind 15 assumes **one** blob with one `x` hash. Multi-file or chunked transfers would need a fallback (a kind 14 with the link).
  - The key now sits in the message rather than the URL fragment. Same secrecy, different place.

🆕 **Decoupled encryption keys (watch this)**
- [NIP-4e, PR #1647](https://github.com/nostr-protocol/nips/pull/1647) by fiatjaf, opened 14 Dec 2024, **still open** ✅.
  - A user announces a separate encryption key in a kind 10044 event. Senders must then encrypt to *that* key instead of the npub.
  - Jumble ships it, according to a Mar 2026 comment in the PR ✅. The `nak` CLI supports it 🟡.
- PR #2361 (Jun 2026) proposes the same split inside NIP-17 ✅ (mentioned in the #1647 thread).
- 🔵 When sending to an npub, **check for a kind 10044 first**, or you may encrypt to a key the recipient's app no longer reads.

### A1.4 Known weaknesses, gathered in one place

| Weakness | Spec source | Effect on Refueler 🔵 | Mitigation 🔵 |
|---|---|---|---|
| No forward secrecy | 44.md ✅, NOS-01-006 ✅ | Bounded to one job | Erase per-job keys at job end. Cleanup via NIP-62 or NIP-09 |
| No post-compromise security | 44.md ✅ | Same | Same |
| Recipient key visible (the `p` tag) | 59.md ✅ | Relay sees "key K got N wraps" | Per-job K. AUTH-gated reads. Fixed notice count |
| IP address visible to relays | 44.md ✅ | Whoever *reads* K reveals their IP | The Worker publishes. Readers may use Tor (Pokey has built-in Tor ✅) |
| `created_at` public | 44.md ✅ | Timing correlation | Random backdating, random publish delay |
| `expiration` tag public | 40.md ✅ | `expiration` minus TTL gives the real send time | Independent random jitter on each layer's expiry ✅ (59.md) |
| Length leak | 44.md ✅ | Notice type could be guessed from size | Pad every notice to one fixed size *before* NIP-44 |
| No deniability | 44.md ✅ | The seal proves the per-job key wrote it | Fine, because the per-job key isn't a person |
| Clients skipping signature checks | Kimura et al. ✅ | Forged notices | Verify the wrap signature, the seal signature, and that seal pubkey = the expected job key |

### A1.5 Browser libraries

All versions are from the npm registry, read 11 Oct 2026 ✅.

| Package | Latest | Published | Audit | Notes |
|---|---|---|---|---|
| `nostr-tools` | 2.25.2 | 4 Sep 2026 | **None found** (README mentions none ✅) | Deps: `@noble/curves` 2.0.1, `@noble/hashes` 2.0.1, `@noble/ciphers` 2.1.1, `@scure/*`, `nostr-wasm` 0.1.0. Six releases Jul–Sep 2026, so actively maintained. Ships `nip44`, `nip59`, `nip17` modules ✅ |
| `@nostr-dev-kit/ndk` | 3.0.3 | 23 Feb 2026 | None found | Deps include `debug`, `shiki`, `@codesandbox/sandpack-client` ✅. Large attack surface for a crypto page 🔵 |
| `@noble/ciphers` | 2.4.0 | 27 Aug 2026 | **Cure53, v1.0.0, Sep 2024, "Scope: everything"** ✅. AI-assisted self-audits since Apr 2026 ✅ | README: AES uses T-tables that "leak access timings"; JS can't promise constant time ✅ |
| `@noble/curves` | 2.4.0 | 27 Aug 2026 | **Trail of Bits v2.3.0, Aug 2026**. Cure53 v1.6.0, Sep 2024. Kudelski v1.2.0, Sep 2023. Trail of Bits v0.7.3, Feb 2023 ✅ | secp256k1 / Schnorr |
| `paulmillr/nip44` (TS) | n/a | n/a | **Cure53, Dec 2023** ✅ | The reference implementation |
| `applesauce-core` | 6.2.0 | 26 Jun 2026 | None found | Alternative toolkit |
| `@welshman/signer` | 0.13.0 | 8 Oct 2026 | None found | Coracle's stack |
| `@cashu/cashu-ts` | 4.11.0 | 22 Sep 2026 | **Not checked** | Needed for Q4 ideas |

**Supply-chain note ✅.** On 8 Sep 2025, a phished maintainer account pushed crypto-stealing code into `debug`, `chalk` and about 18–25 other npm packages. Most bad versions were pulled within about an hour ([Semgrep](https://semgrep.dev/blog/2025/chalk-debug-and-color-on-npm-compromised-in-new-supply-chain-attack); [Check Point](https://blog.checkpoint.com/crypto/the-great-npm-heist-september-2025/)).

**Recommendation 🔵**
- Pin exact versions with a committed lockfile and subresource integrity, or vendor the minimum: `@noble/*`, `@scure/*`, and nostr-tools' `nip44` and `nip59` modules.
- Keep NDK out of the encryption page.
- `nostr-wasm` (Dec 2023, unchanged since) is a dependency of nostr-tools. Check whether your import path pulls it in.

## A2. Relays in practice

### A2.1 What the specs promise

- ✅ **NIP-40** ([40.md](https://github.com/nostr-protocol/nips/blob/master/40.md)):
  - "Relays MAY NOT delete expired messages immediately on expiration and MAY persist them indefinitely."
  - "Relays SHOULD NOT send expired events to clients."
  - "Relays SHOULD drop any events that are published to them if they are expired."
  - "Clients SHOULD NOT send expiration events to relays that do not support this NIP."
  - "Don't consider expiring messages as a security feature."
- ✅ **NIP-09** ([09.md](https://github.com/nostr-protocol/nips/blob/master/09.md)):
  - Kind 5 with `e`/`a` tags and a SHOULD `k` tag.
  - "Relays SHOULD delete or stop publishing any referenced events that have an identical `pubkey`."
  - The deletion request itself is kept "indefinitely". It is a permanent public marker that *something* was deleted 🔵.
- ✅ **NIP-62** ([62.md](https://github.com/nostr-protocol/nips/blob/master/62.md)):
  - Kind 62 names one or more relays. "Relays MUST fully delete any events from the .pubkey".
  - Relays "SHOULD delete all NIP-59 Gift Wraps that p-tagged the .pubkey".
  - Relays "MUST ensure the deleted events cannot be re-broadcasted".
  - It applies to paid relays "regardless of the user's status".
  - **The strongest clean-up tool available.**
- ✅ **NIP-42** ([42.md](https://github.com/nostr-protocol/nips/blob/master/42.md)):
  - Relays answer `CLOSED` or `OK` with an `auth-required:` prefix, e.g. "we can't serve DMs to unauthenticated users", or `restricted:` once logged in but not allowed.
  - The login event is kind 22242 and is never rebroadcast.
- ✅ **NIP-11** ([11.md](https://github.com/nostr-protocol/nips/blob/master/11.md)):
  - Limitation flags `auth_required`, `payment_required` and `restricted_writes`.
  - **No `retention` and no `privacy_policy` field** in the current text. Some relays still publish both.

### A2.2 What relays advertise (live NIP-11, 11 Oct 2026) ✅

| Relay | Software | 9 | 40 | 42 | 59 | 62 | AUTH required | Paid | Policy published |
|---|---|---|---|---|---|---|---|---|---|
| relay.damus.io | strfry 1.1.0+ | ✔ | ✔ | – | ✔ | – | no | no | none in NIP-11 |
| nos.lol | strfry 1.1.3 | ✔ | ✔ | – | – | – | no | no | ToS link (wikifreedia) |
| relay.primal.net | strfry 1.1.3 | ✔ | ✔ | – | – | – | no | no | none |
| nostr.wine | own 0.3.3 | ✔ | ✔ | ✔ | – | – | no | **18,888 sats once** | ToS (IP collected) |
| **inbox.nostr.wine** | own 0.1.4 | ✔ | ✔ | ✔ | – | – | **yes** | **2,500 sats / 30 d** | legacy `retention`: kinds 4 and 1059 `time: null` (likely "kept indefinitely" 🔵) |
| **auth.nostr1.com** | strfry v315 | ✔ | ✔ | ✔ | – | – | **yes** | no | link only, no text |
| relay.ditto.pub | ditto-relay 2.0.0 | ✔ | ✔ | ✔ | – | **✔** | no | no | none |
| relay.westernbtc.com | ditto-relay 2.0.0 | ✔ | ✔ | ✔ | – | **✔** | no | no | none |
| nostr.land | NFDB 2.0 | – | – | – | – | – | no | yes | ToS link |
| nostr.mom | strfry 1.1.3 | ✔ | ✔ | – | – | – | no | no | ToS link |
| offchain.pub | strfry 1.1.0 | ✔ | ✔ | – | – | – | no | no | none |
| nostr-pub.wellorder.net | nostr-rs-relay 0.9.0 | ✔ | ✔ | – | – | – | no | no | none |
| relay.snort.social | memlay 0.2.0 | ✔ | – | – | – | – | no | no | none |
| haven.sovereignengineering.io | Haven 1.2.0 | ✔ | ✔ | ✔ | – | – | – | – | none |

Also strfry, all 9 ✔ / 40 ✔ / no AUTH: nostr.oxtr.dev, relay.angor.io, nostr.bitcoiner.social, relay.coinos.io, nostr.data.haus, yabu.me, relay.nostrplebs.com. Also relay.notoshi.win (rnostr) and nostr.einundzwanzig.space (nostr-rs-relay), with the same flags.

No answer on 11 Oct 2026: relay.nostr.band, relay.0xchat.com, relay.nsec.app, relay.mostr.pub, relay.nostr.bg, nostr.mutinywallet.com, relay.bitcoinpark.com, relay.siamstr.com.

**NIP-17 itself** is advertised only by auth.nostr1.com.

**Reading the table 🔵**
- **"Advertises NIP-40" is not "deletes expired events".** strfry's README lists NIP-40 but says nothing about when expired events are purged ✅ ([strfry](https://github.com/hoytech/strfry)). Assume they are hidden, not erased, until tested.
- **Relays that list 59 but not 42** (Damus) most likely serve kind 1059 to *anyone* who filters by `#p`.
  - With per-job keys, the outsider must already know the key, so the leak is small.
  - It is still the reason to prefer AUTH-gated relays.
- **Timestamp limits** ✅: `created_at_lower_limit` 94,608,000 s (3 years) and `created_at_upper_limit` 300 s (nostr.wine) or 900 s (nostr1, Ditto).
  - Two days of backdating is safe. Any forward-dating risks rejection.

### A2.3 Published policies

| Operator | IP | Retention | Deletion | Source |
|---|---|---|---|---|
| nostr.wine | "IP address and/or public key collected for the purpose of detecting abuse, spam or misuse" | Content rights granted "for an unlimited time" | "Requests to delete content… cannot be guaranteed" | ✅ [nostr.wine/terms](https://nostr.wine/terms) (undated, © 2024) |
| Damus | Not mentioned | Not mentioned | n/a | ✅ [damus.io privacy policy](https://damus.io/privacy-policy.txt) |
| auth.nostr1.com | Not published | Not published | n/a | ✅ [auth.nostr1.com](https://auth.nostr1.com) |
| Primal | Page returned no text | n/a | n/a | **Not found** |
| nostr.build (Blossom/upload host, not a relay) | Logs IP, npub, user agent and referrer per upload, **kept indefinitely** | Indefinite | n/a | 🟡 [account.nostr.build/privacy](https://account.nostr.build/privacy) |

**Not found:** any relay with a published no-IP-log commitment.

### A2.4 Partner shortlist and what to ask for 🔵

None of these has been contacted. "Plausible" is a judgement from public behaviour only.

| Candidate | Why plausible | Obstacle |
|---|---|---|
| **Ditto** (Alex Gleason): relay.ditto.pub | Implements NIP-62 and NIP-40. Publicly arguing for encrypted blobs on public servers ✅ | No AUTH required. Would need AUTH-gated 1059 reads |
| **nostr.wine**: inbox.nostr.wine | Mature AUTH-gated inbox relay. Paid, so has a business model | IP clause in ToS. Per-key subscription model doesn't fit per-job keys |
| **nostr1.com**: auth.nostr1.com | Free DM inbox relay, AUTH-required, advertises NIP-17 | Labelled "alpha software". No published policy |
| Community strfry operators (nos.lol, nostr.mom, offchain.pub) | Advertise 9 and 40. Independent hobby operators | No AUTH. No policy. Small teams |

**What to put in the written commitment 🔵 (one page each)**
1. No IP addresses stored beyond in-memory rate limiting, and nothing written to disk logs.
2. Kind 1059 accepted for any `p` key, up to X wraps per key per day.
3. Kind 1059 served **only** to an AUTH session whose key matches the `p` tag.
4. Expired events purged within 24 h of expiry, not just hidden.
5. NIP-09 and NIP-62 honoured for gift wraps per NIP-59's rule.
6. Maximum retention of 30 days even without an `expiration` tag.
7. A warrant canary, or a commitment to notify where lawful.
8. 90 days' notice before any change.

**Independence:** different legal jurisdictions, different hosting providers, and no shared operators. Refueler pays at most a published standard fee.

### A2.5 The NIP-42 question: "we keep auth off"

- **Reading.** On AUTH-gated relays (inbox.nostr.wine, auth.nostr1.com) you **cannot read** 1059 without logging in ✅.
  - On open relays you can, and so can everyone else 🔵.
  - AUTH with the per-job recipient key reveals nothing new. The relay already sees the `p` tag, and the session can't be tied to another job unless the same connection or IP reads several keys 🔵.
- **Writing.** auth.nostr1.com has `auth_required: true` for every action ✅. To publish there, the Worker would AUTH with the wrap's one-time key or the job key 🔵. That is harmless.
- **Rule to adopt 🔵:**
  - "AUTH allowed with per-job keys only."
  - One WebSocket connection per job key when reading, so a relay can't link a reader's several jobs by connection.
  - Never AUTH with an identity npub.

## A3. Competitor sweep: sources and detail

| Product | Detail | Source and date |
|---|---|---|
| WeTransfer | "Transfers panel shows a checkmark next to each recipient's address once they download". Email verified during sending; Free account auto-created. Free plan: 3-day availability | 🟡 [Cloudwards, 2026](https://www.cloudwards.net/how-to-use-wetransfer/); WeTransfer help via search extract |
| Smash | Emails about "download (or non-download)", toggleable, on free and paid tiers | 🟡 [fromsmash.com](https://fromsmash.com/discover-smash/everyone), [comparison page](https://fromsmash.com/comparison/sendanywhere) |
| Tresorit Send | Admin link to "track when your link is opened, enable notifications". Email verified on first opening the admin link | 🟡 support article via search extract (direct fetch got 403): [support.tresorit.com/…360011293134](https://support.tresorit.com/hc/en-us/articles/360011293134-Tresorit-Send-admin-link) |
| SwissTransfer | Download notification option. App: "track downloads in real-time" | 🟡 [InfoSwitch guide](https://infoswitch.fr/en/blog/swisstransfer-send-large-files-free), [App Store](https://apps.apple.com/app/id6737686335) |
| Proton Drive | No download alert for public links found | **Not found** ([Proton support](https://proton.me/support/drive-shareable-link)) |
| wormhole.app | FAQ silent on notifications or counts | **Not found** ✅ [wormhole.app/faq](https://wormhole.app/faq) |
| Magic Wormhole | "File sent.. waiting for confirmation" then "Confirmation received. Transfer complete." Both ends run "within an hour or so of each other". No accounts described | ✅ [docs](https://magic-wormhole.readthedocs.io/en/latest/welcome.html) |
| OnionShare | Server "stopped automatically once someone completes the download" by default | 🟡/✅ [docs 2.6](https://docs.onionshare.org/2.6/en/features.html) (via search extract) |
| Send (timvisee) | `POST /api/info/:id` behind `auth.owner` returns `{dlimit, dtotal, ttl}`. No account | ✅ [server/routes/info.js](https://github.com/timvisee/send/blob/master/server/routes/info.js), [index.js](https://github.com/timvisee/send/blob/master/server/routes/index.js) |
| ffsend | `info` output "Downloads: 0 of 10" | ✅ [ffsend README](https://github.com/timvisee/ffsend) |
| OneTimeSecret | "metadata key… whether or when it was viewed". The owner field is `anon` for anonymous requests | ✅ [API docs](https://docs.onetimesecret.com/en/rest-api/v1/retrieve-secrets) / 🔵 for anonymous status view |
| nogringo/file-transfer | AES-GCM to Blossom, keys via NIP-44, "NIP-17 compliant". No receipt mentioned | ✅ [repo](https://github.com/nogringo/file-transfer) |
| Anagram (LNbits), Brainstorm-UI | Kind 15 AES-GCM attachments on Blossom. No receipt | 🟡 [anagram PR #81](https://github.com/lnbits/anagram/pull/81), [Brainstorm-UI PR #150](https://github.com/NosFabrica/Brainstorm-UI/pull/150) |
| coop | Bug: DM attachments uploaded **unencrypted** to Blossom | 🟡 [coop #224](https://github.com/lumehq/coop/issues/224) |

**Not checked:** Bitwarden Send, Filemail, Internxt Send, Keet, Hemmelig, Yopass. Do this before any marketing claim.

## A4. NutZaps, NIP-60, NUT-18 and friends

### A4.1 How they work ✅

- **NIP-61 nutzaps** ([61.md](https://github.com/nostr-protocol/nips/blob/master/61.md)).
  - The recipient publishes kind 10019, listing relays, mints and a **separate** P2PK `pubkey`. It "MUST NOT use the target user's main Nostr public key".
  - The sender mints at one of those mints and P2PK-locks to that key.
  - The sender then publishes **kind 9321**, a normal public signed event. Its `proof` tags hold the tokens with DLEQ proofs, and it carries a `u` (mint) tag and a `p` tag naming the recipient's identity key.
  - On redemption the recipient writes kind 7376, which `e`-tags the nutzap and `p`-tags the sender.
  - "A Nutzap is a P2PK Cashu token in which the payment itself is the receipt."
- **NIP-60 wallets** ([60.md](https://github.com/nostr-protocol/nips/blob/master/60.md)).
  - Kind 17375 wallet (NIP-44-encrypted `privkey` and mints, with a privkey "not associated in any way to the user's Nostr private key").
  - Kind 7375 unspent proofs (encrypted). Kind 7376 history.
  - Spent token events are NIP-09-deleted with `["k","7375"]`.
- **NUT-18 payment requests** ([18.md](https://github.com/cashubtc/nuts/blob/main/18.md)).
  - A CBOR `creqA…` request with fields `i, a, u, s, m, mp, sm, d, t, nut10`.
  - **Nostr transport:** `{"t":"nostr","a":"<nprofile>","g":[["n","17"]]}`. "The sender sends a PaymentRequestPayload as the message content" of a NIP-17 DM.
  - There is also an HTTP POST transport.
  - An empty transport means in-band, as in `X-Cashu`.
- **NUT-24** ([24.md](https://github.com/cashubtc/nuts/blob/main/24.md)).
  - HTTP 402 with `X-Cashu: creqA…` or `creqB…`. The client retries with `X-Cashu: cashuB…`. Wrong mint, unit or amount gets `400`.
  - **The implementation table in the NUTs README lists "–" for both wallets and mints** ✅ ([README](https://github.com/cashubtc/nuts/blob/main/README.md)).
- **NUT-28 P2BK** ([28.md](https://github.com/cashubtc/nuts/blob/main/28.md)).
  - Blinds each P2PK lock key with an ECDH-derived scalar, "preventing the mint from linking multiple P2PK spends by the same party".
  - Implemented in Nutshell, cdk and cashu-ts ✅.
- **NUT-18 wallet support** (README table ✅): cashu-ts, Cashu.me, cdk, Minibits, Sovran.
  - The Nostr transport specifically is documented by Sovran 🟡 ([Sovran docs](https://mintlify.wiki/sovranBitcoin/sovran/cashu/payment-requests)).
  - cdk 0.16.0 stores Nostr payment-request data 🟡.

### A4.2 The ideas in detail 🔵

**1. Anonymous credit top-up over Nostr (feasible now)**
- **Flow:**
  1. The Share page shows a NUT-18 `creqA` with `t = nostr`, targeting a **fresh per-request nprofile**. That key is generated by the Worker; the relays are your partner set.
  2. The user's wallet (e.g. Sovran) sends the tokens in a NIP-17 gift wrap.
  3. The Worker's listener redeems them at the mint, then issues your usual Cashu access credential, delivered the same way or picked up by request id.
- **Needs:**
  - A listener that can hold or poll relay connections. Workers can open outbound WebSockets, but long-lived listening usually means Durable Objects, which your house rule may exclude (see the earlier live-streaming research, point 1).
  - A cron-triggered Worker that polls each relay every minute avoids Durable Objects.
- **Honest value:** the HTTP rail already accepts Cashu. This adds an *anonymous-rail-only* path for wallets that can't reach your HTTPS (Tor-only setups) and makes "pay without touching our domain" possible. Worth it as the first anonymous-rail feature. It's cheap.

**2. Postage on drop-box messages and replies (feasible now)**
- Inside the gift-wrapped rumor, add `["postage", "<cashuB token P2BK-locked to the per-box key>"]`.
- The owner's client checks DLEQ offline (NUT-12), then swaps at the mint to detect double-spends (the mint sees only a blinded key).
- Unstamped messages go to a separate tray. They are **never refused**, so notices are never control flow.

**3. API/MCP job keys paid by `X-Cashu` (feasible on your side)**
- `POST /api/jobs` → `402 X-Cashu: creqB…` → retry with a token → returns `{job_pubkeys, relays}`.
- An MCP tool wraps this so an AI agent with a cashu-ts wallet can send to an npub without any account.

**4. Sender-paid notice postage to relays (needs X)**
- Needs a relay that accepts Cashu per event, or NUT-24 on WebSocket. **Not found.**

**5. NIP-60 wallet per drop box (needs X)**
- Store the box's stamp proofs as kind 7375 under the box key, so a restored recovery phrase recovers the takings.
- Adds relay state per box. Defer.

**6. "Collected" nutzap (rejected)**
- A kind 9321 is public, names the `p` identity and the sender, and is meant to be a verifiable receipt ✅.
- That contradicts "never proof of delivery" and leaks the pairing. Cashu has no zero-value proofs 🔵.

**7. HTLC pay-on-collection (rejected)**
- It turns a notification into a settlement condition, which is control flow.

## A5. Blossom detail

All BUD text was read from [hzrd149/blossom `buds/`](https://github.com/hzrd149/blossom/tree/master/buds) on 11 Oct 2026 ✅.

| BUD | Title | Tags | Notes for Refueler 🔵 |
|---|---|---|---|
| 00 | Blossom Upgrade Documents | draft, mandatory | Process |
| 01 | Server requirements and blob retrieval | draft, mandatory | `GET/HEAD /<sha256>` is **public**. CORS `*`. Range requests. Unknown MIME "MUST default to application/octet-stream". 🆕 **`Sunset` header** for planned unavailability |
| 02 | Blob upload | draft, optional | `PUT /upload`. Server "MUST NOT modify the blob". 201 for new, 200 if it exists |
| 03 | User Server List (kind 10063) | draft, optional | Upload to the first listed server. Fallback lookup through the author's list, then popular servers |
| 04 | Mirroring | draft, optional | `PUT /mirror` copies from a URL. **Undermines "destroyed after download"**, so don't offer it |
| 05 | Media optimisation | draft, optional | Not applicable (ciphertext) |
| 06 | Upload requirements (`HEAD /upload`) | draft, optional | Preflight; 402 can be signalled here |
| 07 | **Paid upload and download** | draft, optional | 402 with `X-Cashu` (NUT-24) or `X-Lightning` (BOLT11). Retry with proof. 400 + `X-Reason` on failure. HEAD never retried with payment |
| 08 | NIP-94 tags in upload response | draft, optional | Optional |
| 09 | Blob Report | draft, optional | `PUT /report` with a signed kind 1984 and `x` tags. Server MAY act, MAY block the hash, SHOULD publish rules |
| 10 | `blossom:` URI schema | draft, optional | Could carry server hints in links |
| 11 | Nostr Authorization (kind 24242) | draft, optional | Token MUST have `expiration`, a `t` verb (get, upload, list, delete, media), and optional `server` and `x` scoping. **Per-job keys work fine** |
| 12 | List and delete | draft, optional | `/list/<pubkey>` and `DELETE /<sha256>`. Disable listing |

**How Share-as-Blossom would work 🔵**
- Accept `PUT /upload` with BUD-11 auth signed by the per-job key, plus BUD-07 `X-Cashu`.
- Serve `GET /<sha256>` with a `Sunset` header equal to the transfer expiry.
- Destroy on full download. A Blossom client will then see `404` or `410`, which BUD-01 allows after `Sunset`, and before it, servers may follow "their own policy".
- The address is the hash of the ciphertext. That is unguessable because the ciphertext is random, but anyone who sees the link can fetch it, exactly as today.

**Moderation expectations ✅ and liability 🔵**
- BUD-09 reports are signed Nostr events and are usually also sent to relays, where they become public 🟡 (BUD-09 recommends merging with normal reports).
- In the NIP-94 encryption debate (PR #2437, Aug–Oct 2026) ✅:
  - Alex Gleason argued that encryption makes takedowns harder and hosting "safer".
  - staab argued that "the hash might as well be a password".
  - Vitor Pamplona argued that if everyone can see the secret, the file isn't private.
- No regulator guidance on "host cannot prove ciphertext" was found (**Not found**).
- Practical stance:
  - octet-stream only, with `Content-Disposition: attachment`;
  - no previews, no mirroring, no listing;
  - short retention;
  - published rules;
  - delete and block on report;
  - keep the per-upload Cashu credential so abusive *paying* uploaders can be rate-limited without identity.

## A6. Proposed event layout for "collected" and other sender notices 🔵

### A6.1 Keys

| Key | Who makes it | Lives where | Purpose | Erased when |
|---|---|---|---|---|
| `N` (sender notification key) | Sender's browser or app, random. **Never derived from the link key** (locked rule) | Sender device only. `N_pub` is sent to the Worker at upload | Recipient of all notices for this transfer | Final notice read + vanish sent |
| `J` (job seal key) | Worker, random per transfer | Worker storage, next to the transfer record | Signs seals, so the sender can check notices came from *this* job | Transfer expiry + grace |
| `W` (wrap key) | Worker, random per wrap | Memory only | Signs the gift wrap | Immediately |
| `D` (drop-box key) | Owner, derived from the recovery phrase | Owner devices | Receives "arrived" pings and stamps | Box closed |

At upload, the Worker returns `J_pub` and the sender keeps it. A notice whose seal isn't signed by `J` is discarded.

**Derivation note for `D` ✅🆕.** NIP-06 is now tagged **`unrecommended`**, with the warning "prefer a single nsec" ([06.md](https://github.com/nostr-protocol/nips/blob/master/06.md)).
- Its path is `m/44'/1237'/<account>'/0/0`, and it explicitly allows "other derivation paths for their own other purposes".
- The warning is about *identity* UX, not about the maths. Still 🔵:
  - Use a Refueler-specific path (e.g. `m/44'/1237'/<box>'/1/0` with a distinct change index), so a user who imports the phrase into a Nostr client doesn't see drop-box keys as "accounts".
  - Alternatively, use BIP-85 child derivation. A BIP-85 Nostr application is proposed in bitcoin/bips #2126 🟡.

### A6.2 Rumor: the inner, unsigned event

```json
{
  "kind": "<NOTICE_KIND>",  // a regular (non-replaceable) kind, chosen in A6.5
  "created_at": <true unix time of the event>,
  "pubkey": "<J_pub>",
  "tags": [],
  "content": "<JSON below, padded to exactly 512 bytes>"
}
```

Content before padding:
```json
{"v":1,"type":"collected","tid":"<opaque transfer id or its HMAC>","at":1791700000,"n":1,"anchor":null}
```

- `type` is one of `collected`, `collected_destroyed`, `expiring_24h`, `anchored`, `heartbeat`.
- `anchor` is `{"block":N,"txid":"…"}` for "permanent record confirmed in block N".
- **Padding:** append `"pad":"<random base64>"` to bring the UTF-8 length to exactly **512 bytes**.
  - NIP-44 then pads all notices identically, so the type is invisible from size.
  - 512 leaves room for the anchor object. 256 is enough if `anchored` is a separate, fixed-size form.
- No tags in the rumor, so nothing leaks if a seal is ever exposed.

### A6.3 Seal (kind 13)

- Signed by `J`. Tags empty (59.md MUST).
- `created_at` = now − uniform(0, 48 h).
- Optional `expiration` set independently, per NIP-17's "in case it leaks".

### A6.4 Gift wrap (kind 1059)

```json
{
  "kind": 1059,
  "pubkey": "<W_pub – one-time>",
  "created_at": "<now − uniform(0, 48h), independent of the seal>",
  "tags": [
    ["p", "<N_pub>"],
    ["expiration", "<transfer_expiry + uniform(24h, 96h)>"]
  ],
  "content": "<NIP-44 v2 encrypt(seal, W→N)>"
}
```

- **Expiry cap:** never more than 30 days ahead, whatever the transfer's own lifetime is. For "permanent record" anchors, the final notice expires 30 days after it is sent.
- **Fan-out:** publish the **same** signed wrap to every partner relay.
  - Distinct wraps per relay would hide the event id across relays, but colluding relays can match on `p` anyway.
  - Identical events make de-duplication trivial.
- **Proof-of-work:** optional NIP-13 difficulty around 16 on `W`, only if a partner requires it. None advertise NIP-13 today ✅.

### A6.5 Kind choice

| Option | Pros | Cons |
|---|---|---|
| A. Kind 14 (NIP-17 chat) with a fixed text body | Any NIP-17 client can display it. No new kind | Pushes "collected" into human chat UX. Text is harder to pad. Invites "read receipt" readings that conflict with your copy rules |
| B. **A dedicated unassigned kind** for "service notice" (registered via a NIPs PR to the kind list) | Clean parsing, no chat confusion | Only your apps read it at first |
| C. Kind 15 | Only fits "send a link to an npub" | Wrong semantics for notices |

**Recommendation:** B for notices to `N`. Use A or C only for human messages: "send to npub", the sealed note, and replies.

### A6.6 Timing and cover traffic

- **Publish delay:** uniform 30 s–10 min after the event.
  - The aim is to break the "recipient finished downloading at 14:03:07, relay got a wrap for `N` at 14:03:08" link if the relay and recipient collude.
  - Longer adds little, because the relay still sees the reader's IP when `N` is fetched.
- **Fixed schedule per transfer:**
  - Every transfer emits **exactly k wraps** (e.g. k = 4) at random times across its life.
  - Real events replace a scheduled `heartbeat`. Anything left over is sent as `heartbeat`.
  - Effect: relays can't tell collected from uncollected, or how many times something was collected. The cost is k events per transfer.
  - For "collected, then destroyed after download" there may be only minutes of life. Then send the remaining scheduled wraps in a burst at destruction, with the random delays.

### A6.7 Reading and clean-up

**Reading**
1. The sender's app opens one connection per relay per `N`.
2. It sends AUTH as `N` where required.
3. It sends `REQ {"kinds":[1059], "#p":[N_pub]}`.
4. It decrypts, checks wrap signature → seal signature → seal pubkey == `J_pub` → rumor pubkey == `J_pub`, and ignores everything else.

**Clean-up after the final notice is read, or at transfer expiry**
1. The sender signs a **NIP-62 kind 62** with `N`, listing each relay. That deletes "all NIP-59 Gift Wraps that p-tagged" `N`.
2. As a fallback for relays without NIP-62, send a NIP-09 kind 5 signed by `N`, with `e` tags of the wraps and `["k","1059"]`. NIP-59 says relays SHOULD act on that.
3. Erase `N`.
4. The Worker erases `J` on its own schedule.

### A6.8 Drop box "arrived", the sealed note thread, and Android

- **Drop box "arrived"** is the same layout with `p = D_pub`, published by the **Worker**, never by the uploader's browser. That keeps the anonymous uploader's IP off relays.
- **Sealed note and replies thread:**
  - NIP-17 kind 14 rumors between the per-transfer sender key `S` and recipient key `R`. Neither is a personal npub.
  - `expiration` equals the transfer expiry on both layers, each with independent jitter.
  - Clean-up by NIP-62 from both `S` and `R`.
  - Stamps (A4.2, idea 2) go inside the rumor.
- **Android without Google:**
  - Pokey (KoalaSat) calls itself Nostr "Pull Notifications" for Android. It lists "Auth to relays", inbox relay management, a built-in Tor engine, Amber login, and a `com.shared.NOSTR` broadcast to other apps. It ships via IzzyOnDroid, Zap.Store and Obtainium ✅ ([repo](https://github.com/KoalaSat/pokey)).
  - A developer's post says Pokey holds open connections to the inbox relays rather than using Google, Apple or UnifiedPush 🟡.
  - Amethyst's FOSS build uses UnifiedPush distributors 🟡 ([NoBS Bitcoin](https://nobsbitcoin.com/amethyst-v0-80-1)).
  - Simplest route 🔵: your app holds its own relay connections for active job keys only, with a foreground-service notification while any job is live. Treat UnifiedPush as a later optimisation.

### A6.9 Is a NIP worth writing? 🔵

- **Notice format: not yet.** Register the kind number once it is stable, after two independent readers exist. A one-paragraph "kind registry" PR is cheap.
- **Relay privacy profile: yes, and sooner.**
  - Proposed NIP-11 `limitation` or `policy` fields, for example: `ip_logging: "none"|"abuse-only"|"full"`, `max_retention_secs`, `expired_purge_secs`, `gift_wrap_reads: "auth-p-only"|"open"`, `honours: [9, 40, 62]`, `policy_url`, `policy_signed_by`.
  - The spec currently has no privacy field at all ✅. Every privacy app would use it.
  - This gives partner commitments a machine-readable form that the client can check before publishing.

## B. Method notes and gaps

**B.1 Sources not reachable:**
- The GitHub API for commit dates. Blossom file dates are therefore "as of master on 11 Oct 2026", not per-file.
- The Tresorit support site (403).
- Primal's privacy page (empty).
- Eight relays' NIP-11 documents (listed in A2.2).

**B.2 Not found:**
- Any relay with a published no-IP-log policy.
- What "NIP-44 v3" in Amber changes.
- A wallet or mint implementing NUT-24.
- Regulator guidance on hosts that can't inspect ciphertext.
- Any product that pushes a "collected" notice asynchronously with no account and no email.

**B.3 Not checked:** Bitwarden Send, Filemail, Internxt Send, Keet, Hemmelig, Yopass; audits of cashu-ts; `@noble/hashes` audit history.

**B.4 Conflicts noted:**
- The paulmillr/nip44 README says only TS, Go and Rust were audited. Some secondary sources say "the JS implementation" only. The Cure53 PDF confirms all three ✅.
- Nostr Compass says NIP-44 plaintext is "1 to 65535 bytes". 44.md now defines an extended length prefix ✅.

**B.5 Inferences that most need checking:** that strfry hides but doesn't promptly purge expired events, and that relay.damus.io serves 1059 without AUTH. Both can be settled by B.6.

**B.6 Relay behaviour test (to run from a normal machine, not this sandbox)**
1. Generate a random `R`. Publish three kind 1059 wraps to `R` on each relay:
   - (a) `expiration` = now + 120 s;
   - (b) no expiration;
   - (c) `expiration` already in the past.
2. Straight away, run `REQ {"kinds":[1059],"#p":[R]}` without AUTH. This records who serves gift wraps to strangers.
3. Sign a kind 5 with `R` for (b), plus a kind 62 where supported.
4. After 5 minutes, query (a), (b) and (c) by id, with and without AUTH as `R`.
5. Repeat the query after 48 h to separate "hidden" from "purged". Purging can only be inferred, never proven from outside.

## C. Key sources (all read 11 Oct 2026 unless dated)

**Specs**
- NIPs: [44](https://github.com/nostr-protocol/nips/blob/master/44.md), [59](https://github.com/nostr-protocol/nips/blob/master/59.md), [17](https://github.com/nostr-protocol/nips/blob/master/17.md), [40](https://github.com/nostr-protocol/nips/blob/master/40.md), [09](https://github.com/nostr-protocol/nips/blob/master/09.md), [62](https://github.com/nostr-protocol/nips/blob/master/62.md), [42](https://github.com/nostr-protocol/nips/blob/master/42.md), [11](https://github.com/nostr-protocol/nips/blob/master/11.md), [06](https://github.com/nostr-protocol/nips/blob/master/06.md), [60](https://github.com/nostr-protocol/nips/blob/master/60.md), [61](https://github.com/nostr-protocol/nips/blob/master/61.md), [B7](https://github.com/nostr-protocol/nips/blob/master/B7.md).
- NIP pull requests: [#1647 NIP-4e](https://github.com/nostr-protocol/nips/pull/1647) (open since 14 Dec 2024); [#2437 NIP-94 file encryption](https://github.com/nostr-protocol/nips/pull/2437) (opened 12 Aug 2026).
- Cashu NUTs: [18](https://github.com/cashubtc/nuts/blob/main/18.md), [24](https://github.com/cashubtc/nuts/blob/main/24.md), [28](https://github.com/cashubtc/nuts/blob/main/28.md), [README implementation table](https://github.com/cashubtc/nuts/blob/main/README.md).
- Blossom BUDs: [00–12](https://github.com/hzrd149/blossom/tree/master/buds).

**Audits and papers**
- [Cure53 NIP-44 audit](https://cure53.de/audit-report_nip44-implementations.pdf) (11 Dec 2023).
- [Kimura et al., "Not in The Prophecies: Practical Attacks on Nostr"](https://eprint.iacr.org/2025/1459) (IEEE EuroS&P 2025), with its [project page](https://crypto-sec-n.github.io/) and [Osaka University release](https://resou.osaka-u.ac.jp/en/research/2025/20250804_1) (4 Aug 2025).
- [noble-ciphers](https://github.com/paulmillr/noble-ciphers) and [noble-curves](https://github.com/paulmillr/noble-curves) security sections.

**Libraries:** npm registry entries for `nostr-tools`, `@nostr-dev-kit/ndk`, `@noble/*`, `@cashu/cashu-ts`, `applesauce-core`, `@welshman/signer`.

**Relays:** NIP-11 documents fetched live from each relay URL in A2.2.

**News**
- [Nostr Compass, 3 Jun 2026](https://buttondown.com/nostrcompass/archive/nostr-compass-4/) (Amber "NIP-44 v3"; NIP-17 key decoupling).
- [Nostr Compass NIP-44 topic](https://nostrcompass.org/en/topics/nip-44/).

---

# Part 3: Decisions for the design session, ranked

1. **Who publishes notices: the Worker, or users' browsers?**
   - Recommended: the Worker. Only it knows "collected in full", and it keeps anonymous users' IPs off relays.
   - It means the Worker holds `N_pub` and `J`. Decide whether that is acceptable.
2. **The NIP-42 rule.** Replace "auth off" with "AUTH only ever with per-job keys, one connection per key".
   - Without this, the AUTH-gated relays, which are the privacy-respecting ones, are unusable.
3. **The partner relay set and the one-page commitment** (A2.4). Also decide the fallback if fewer than two sign.
   - Fall back to open strfry relays plus cover traffic?
   - Or ship notices as "beta, best effort"?
4. **Expiry wording and clean-up.**
   - Copy says "expires", never "deleted" or "self-destructs" (NIP-40 MAY keep forever).
   - Adopt NIP-62, then NIP-09, at job end, then key erasure.
   - Decide the 30-day hard cap.
5. **Cover traffic.** A fixed k notices per transfer, or "send only when something happens".
   - This trades relay storage and a little latency for hiding whether anything was collected.
6. **Library and supply chain.** nostr-tools pinned, or vendored `nip44` + noble. NDK out. Lockfile plus integrity hashes.
7. **Notice kind.** A dedicated kind (recommended) or kind 14. Also the padding bucket size (256 or 512 bytes).
8. **Drop-box key derivation.** NIP-06 is now `unrecommended`. Choose a Refueler-specific path or BIP-85, and write the recovery-phrase spec before any box exists.
9. **"Send a link to an npub" format.** Kind 15 file message for Nostr-client interop, or kind 14 with a link.
   - Must handle kind 10050 relay lists and, soon, kind 10044 decoupled keys (NIP-4e).
10. **Share-as-Blossom scope.** Full public BUD-01 server, or a restricted profile: no mirror or list, `Sunset`, octet-stream only, destroy on download.
    - Includes the BUD-09 report-handling policy and the liability stance.
11. **First Cashu-over-Nostr feature.** The anonymous top-up via NUT-18 Nostr transport is feasible now. Decide the listener design under the Durable Objects house rule (cron-polling Worker?), and which mints.
12. **Postage stamps on drop-box messages and replies.** Yes or no. Amount. Tray UX that never blocks.
13. **Android delivery.** In-app relay connections with a foreground service, or a UnifiedPush distributor, or a Pokey broadcast integration.
14. **Marketing claims.** Retire "first". Approve the narrow phrasing, and re-run the competitor sweep (A3 "not checked" list) before launch.
15. **NIP authorship.** A relay privacy-profile NIP now. A notice-format kind registration after the pilot.

*Nostr: where "expired" means "politely ignored", much like a British queue-jumper.*
