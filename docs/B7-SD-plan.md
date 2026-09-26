# B7 + SD-block session plans — refueler-share

> Forward plans moved verbatim out of `share-sessions.md` (Share-Hygiene-1 · 26 Sep 2026). Sequence and gates: CLAUDE.md §Session queue + `Share-Master-Context.md` §Roadmap. The session numbers are the original plan and will be renumbered when the blocks open.
>
> Note (26 Sep 2026): the two "B7 open snags" below are both closed — `receiver_ab` AE routing fixed at Share-B10-1; theme toggle in modals still to confirm at B7.

---

## B7 session plan — Lightning/LNbits + anonymous paid tier

**All B7 sessions from S74 gate on NB-4 (node live).**

| Session | Label | Scope |
|---------|-------|-------|
| S74–S74c | Lightning adapter + Invoice creation I–III | `worker/src/lightning.js`. `POST /subscription/lightning`. LNbits BOLT11. KV 25h TTL. |
| S75–S75c | Webhook endpoint I–IV | `POST /webhook/lightning`. KV lookup. Re-verify GET. Settled-flag dedup. Integration test. |
| S76–S76d | Credential issuance I–V | NUT-00 BDHKE on settlement. KV 10-min TTL. Poll endpoint. Tier cap. Unit tests. |
| S77–S77b | Upgrade page rail split I–III | Two-rail structure. Lightning + Stripe cards. Visual parity. |
| S78–S79a | Frontend Lightning flow I–VI | QR. BOLT11 copy. Countdown. Live GBP/credits rate. Credential poll. Error states. |
| S80–S80b | Payment privacy table I–III | JSON data. Eleventy partial. Collapsible on upgrade page. |
| S81–S81b | Dashboard Lightning cards I–III | AE datapoint at settlement. Stub cards. Design pass. Unit tests. |
| S82–S82a | KV Lightning admin toggle | `lightning_available` flag. Dashboard toggle. Graceful degradation. |
| S83–S83b | Renewal banner + paid tier activation | 7-day pre-expiry banner. Both rails confirmed live. |
| S84–S84d | B7 security audit I–V | Invoice expiry. KV races. Credential farming. Webhook replay. Double-issuance. |
| S85–S87 | LNbits ops verification + LNURL-withdraw + LNbits skinning | Post-node sanity. Gift architecture design. Paper/Carbon decisions. |
| S91–S92 | CI Level 2 + Article 6 prep | Integration suite in GitHub Actions. "Paying anonymously for file transfer" structure. |
| S93–S95 | B7 snag sweeps I–III | Theme toggle in modals. `receiver_ab` AE routing fix. Manifest-field minimalism. |
| S96 | Context file maintenance | `Share-Master-Context.md` split → working memory (≤350L) + `Share-Archive.md`. |
| S100 | B7 close | Final snag sweep. Context files at target. B8 brief. |

**Buffer pool (5 sessions):** S74d · S76e · S84e · S85b · S100a

**B7 open snags (resolve at S93–S95):**
- Theme toggle absent from modals
- `receiver_ab_shown` / `receiver_ab_downloaded` events routed to `/log/error` instead of AE


---

## SD-block — Silent Drop (post-B8, post-NB-4)

**S88 complete · 4 Sep 2026.** All design decisions locked. Full Locke (NUT-11 Mode 2) required.

**Prerequisites:** B8 complete. NB-4 (node live). 7-day friend-group soft launch gates public Sovereign access.

**SD-Opus-pre · 12 Sep 2026** — Quay management + multi-client attribution design locked. Per-client Quay link confirmed. Notification model confirmed (webhook API/MCP; polling Sovereign web). Anonymous API/MCP rail market locked. Harbourmaster design pass required before SD4.

| Session | Label | Scope |
|---------|-------|-------|
| SD1–SD1b | Lighthouse architecture | KV schema. Opaque token → inbox key. Worker endpoints. UUID isolation. |
| SD2–SD2b | Sender upload flow | Worker validates token, one-time credential, cargo arrived AE event. |
| SD3–SD3c | Harbourmaster auth + Deed | NUT-11 Mode 2 login. Keypair + BIP-39 mnemonic. Recovery flow. |
| SD4–SD4b | Harbourmaster dashboard I–III + mid-block audit | Receipt ledger. Quay management. **Design pass required before SD4.** |
| SD5–SD5a | Notification + renewal | API/MCP: webhook (`cargo.accepted` per Quay). Sovereign web: polling + badge. SimpleX stub. |
| SD6–SD6a | Soft launch + findings | 7-day friend-group. P0/P1 fixes. |
| SD7–SD7a | Source-protection copy + final audit | Gated: SD shipped + VPN scope stated. |
| SD8 | SD close | Snag sweep. Context trim. B9 brief. Public Sovereign Lightning access enabled. |

**SD do-not-retry:**
- DO NOT reuse upload credential UUID as cargo UUID — generate separately at Lighthouse layer
- DO NOT return 402 at `GET /inbox/{token}` — defer quota errors to upload attempt
- DO NOT use Math.random() in Deed generation — `crypto.getRandomValues()` only
- DO NOT use "anonymous" for Stripe-rail Silent Drop — private, not anonymous
- DO NOT design a single shared inbox for multi-client practices — one Quay per client relationship

**Buffer pool (3 sessions):** SD1c · SD3d · SD4c

