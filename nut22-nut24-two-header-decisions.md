# NUT-22, NUT-24 & the Two-Header Door — Locked Strategy Decisions
> **Session:** Share-127 (ad-hoc, architecture & product strategy — no code, no build sequencing)
> **Date:** 7 September 2026 · London
> **Inputs (authoritative):** REFUELER-BRIDGE.md v8.5 · Share-Master-Context.md v7.5 · CLAUDE.md · NUT-22 (Blind Authentication) and NUT-24 (HTTP 402 Payment Required) specs, read this session.
> **Reference (framing only, treated as stale):** silent-drop-strategy-decisions.md (27 Aug 2026).
> **Scope rule honoured:** Every decision in the input files is treated as locked unless a section below explicitly supersedes it with a stated reason. Session-level sequencing and code outlines are left to the next planning session.

This is the locked decision record from the Share-127 material. Hand it to the SW block, B8, and the eventual Teams block. Two items are marked **→ BRIDGE** for propagation into REFUELER-BRIDGE.md at session close.

---

## 1. The two-header model — what NUT-22 and NUT-24 each answer

**Decision. NUT-22 and NUT-24 are adopted as two *independent* mechanisms answering two different questions in two different headers, both answers blind. `Blind-auth:` (NUT-22 BAT) answers "are you of the set?" — membership, with which-member hidden. `X-Cashu:` (NUT-24 token) answers "is *this* request paid?" — the per-request toll, with who-paid hidden. They fail independently and compose freely.**

The four-square that governs every product surface:

| | No toll | Per-request toll (NUT-24) |
|---|---|---|
| **No gate** | Citizen + Turnstile | Open pay-per-use (anonymous rail, no membership) |
| **Membership gate (NUT-22)** | Flat membership, uncapped within the realm | **Membership-scoped metered access — blind at both layers** |

The bottom-right cell is the Teams/enterprise case: the firm proves it belongs *and* every action pays its way, so Refueler holds a contract-level count of tolls and no individual at all.

Internal three-storey mnemonic (teaching aid, **not** product UI): nutroot conditions = **the Entmoot** (when, and with whom, a token may move); NUT-22 membership = **the Fellowship count** (count the banner, name no bearer); NUT-24 toll = **the Whispering Gallery** (the price named at the wall and answered along it).

---

## 2. NUT-24 unit — the regulatory hinge → BRIDGE

**Decision. When Share adopts NUT-24, the `u` (unit) field MUST be a Refueler capability atom (the spec's own `"api"` example), NEVER `sat`. Accepting a Refueler unit back at the door is *redeeming a capability already sold*, not *accepting money for passage*. This keeps NUT-24 squarely inside the standing line: "the mint issues access credentials only — capability tokens, not monetary instruments — FCA authorisation not required."**

Reasoning. Accept `sat` over HTTP at the door and Share is taking money for passage — money transmission, the exact thing the capability-token framing exists to avoid. Accept Share's own `api` atom and Share is a turnstile taking its own token. This is not a detail; it is the hinge on which the regulatory posture of the whole 402 surface turns. Cost of adoption: support for the NUT-18/NUT-26 payment-request encodings (`creqA` / `creqB`) that NUT-24 carries. Small surface, right verb.

NUT-24 is the standardised, in-band form of the **402 backstop already locked** in Master-Context ("anonymous rail burns prepaid tokens"). It is the wire-level twin of the already-locked `refueler_quote` MCP tool — `quote` is the polite ask in the agent's language; the 402 is the same conversation at the HTTP layer, where autonomous agents live.

---

## 3. Keyset granularity follows the rail — the Teams default

**Decision. The default is not a single choice; it is inherited from the rail the principal already declares at onboarding. Per-firm keyset = identity-rail default. Shared Teams-wide keyset = anonymous-rail default. No new decision is created; the one-way rail declaration *is* the keyset decision.**

Reasoning.

- **Identity rail → per-firm keyset.** The firm is already named (Stripe, invoice, DPA, AM). Hiding the firm *from Refueler* would be theatre — the correlation sits in the billing relationship regardless — and would break the one thing this rail must do: attribute the toll to the right contract. What the firm needs here is *intra-firm* unlinkability (which associate, hidden), which per-firm keyset delivers exactly, mapping one-to-one onto existing machinery: keyset ↔ contract ↔ invoice ↔ DPA counterparty, no billing refactor. Image: **Dernhelm** — a rider under a legible banner; the muster knows a rider of Rohan struck, and cannot name Éowyn beneath the helm.
- **Anonymous rail → shared Teams keyset.** There is no invoice to attribute (the prepaid pool burns in-band; the burn *was* the billing), the firm genuinely wants to vanish, and a bigger crowd is the point. Pool every Teams client under one keyset and the firm itself dissolves into "a paying member did something." Image: **the host at the Black Gate** — Gondor, Rohan, Rangers merged into "the host that came," no realm pickable from the throng.

The two are not two builds — the same two-header door with the keyset granularity turned from "this firm" to "any member." The dial is the tier.

**Honesty flag (in-set anonymity).** NUT-22 gives anonymity *within the set*, so the cloak is only as good as the crowd. A three-partner boutique on its own keyset is a thin disguise; Individual Sovereign is no disguise at all (correctly — it gains nothing from this feature). Value scales with seat count, which is why the S/M/L bands are the right shape. **Tell a small firm its set is small** — a disclosure line, not an architecture problem. (See open item O4.)

---

## 4. Pre-funding the muster — BATs drawn in bulk, decoupled in time

**Decision. Associates draw BATs in *batches, in advance, decoupled in time from any specific transfer*. Never mint-at-the-crossing (one BAT minted immediately before the transfer it pays for).**

Reasoning. Clear-auth (the mint step) sees the associate; the spend does not. If mint-time sits one second before spend-time, timing alone re-links them and the anonymity set collapses to a queue. Bulk pre-funding is what makes the set an actual crowd. Image: **Dunharrow** — the Rohirrim assemble in the hidden valley *before* the ride, so no watcher counts them arriving one by one.

---

## 5. The atomic two-stage commit, and BAT-survives-error

**Decision. The two-stage exchange commits as one. The 402 is a challenge, not a commit; the BAT is validated-but-held; BAT-strike + credit-burn + reservation-UUID-issue commit *together on the successful retry, or nothing commits*. A failed toll (400) MUST NOT burn the BAT.**

Reasoning. NUT-22 is explicit: a BAT is marked spent only on a *successful* request, "not marked as spent if the request results in an error." So a bounced fare leaves membership intact — the associate keeps the banner, having not crossed. Getting the commit boundary wrong means either bleeding BATs on failed tolls or handing out free transfers. Rule to carry: **one BAT and one fare per *transfer* (not per chunk), committed atomically, buying a resumable reservation.**

---

## 6. Resume-not-refund — a both-rails invariant

**Decision. The fare buys a *resumable reservation*, not delivery. A chunk failing mid-crossing resumes the *same* reservation UUID and finishes with no second BAT and no second fare. Refund is not offered and not possible on the anonymous rail — burned bearer credit has no ledger to refund from — so "resume, not refund" is forced on both rails for parity. R-series (resumable uploads) is a HARD prerequisite, inherited identically to Silent Drop.**

Reasoning. Credit is already spent when a chunk dies (the 1.51 GB-at-80% failure that birthed R-series). Because the upload is resumable (IDB-backed, `resume: true` + `resume_uuid` + R2 HEAD on chunk 0000), resume finishes the same reservation — the toll was burned once at reservation, never per chunk. Image: **the Bucklebury Ferry** — swept mid-crossing, you don't pay the ferryman twice; you pull back to the same crossing and finish, because the fare was always for the passage.

**Edge:** if the reservation *expires* before resume (tie TTL to `manifest.expiry_timestamp`), resume within the window is free; past it the credit is consumed and a new transfer needs a new fare. The recovery-cliff discipline, applied to the toll — state it plainly.

---

## 7. Clear-auth authority — own account system only

**Decision. The NUT-22 clear-auth authority is Refueler's own account system, NEVER a third-party OIDC (Google, etc.). Identity stays confined to the rail that already holds it (identity rail). No new external identity surface is created.**

Reasoning. A third-party OIDC would leak the firm's members to an outsider — the precise inversion of the product. The identity rail already holds the firm's identity via Stripe; the clear-auth gate reuses that relationship and no more.

**Honesty flag / dependency (see O1).** Share's identity rail *today* is Stripe subscription + email in `subscribers` — there is **no per-seat login/session system** for individual associates. A clear-auth authority the firm's seats authenticate against is **net-new infrastructure** and is the single largest unbuilt dependency for NUT-22 Teams. Do not under-price it.

---

## 8. DLEQ verification is load-bearing, not optional

**Decision. Client-side DLEQ verification (NUT-12) on every BAT is mandatory for the anonymity claim, not a nicety.**

Reasoning. Without it, a dishonest mint could hand each associate *uniquely tagged* BATs and follow them on spend — the blindness would be theatre. DLEQ is the assay proving the coin was struck plain, no secret thread sewn into the cloak. NUT-22 mandates DLEQ on the mint response; the wallet must actually verify it.

---

## 9. The identity-rail toll is an abuse ceiling, not a billing meter

**Decision. On the identity rail the NUT-24 toll functions as the *abuse ceiling*, not the billing mechanism — consistent with SW-Opus-3 ("plan identity-rail revenue as access-fee-only"). The firm pays the flat access fee; the fare meters abuse and yields a contract-level count. The metered component is not surfaced as a bill in normal operation.**

This keeps the two-header design from silently contradicting the SW-Opus-3 revenue lock. On the anonymous rail the position is the opposite and unchanged: the prepaid burn *is* the billing.

---

## 10. Correction to BRIDGE v8.5 — NUT-22 does not supersede NUT-11 Mode 2 → BRIDGE

**Decision. Amend the nutroot forward-note. NUT-22 does NOT supersede NUT-11 Mode 2; they solve orthogonal problems. Keep Mode 2 on the B8 slate.**

- **NUT-11 Mode 2 (P2PK / keypair-binding):** "only the holder of key K can spend this credential." Anti-theft, delegation, the *Locke* object, receiver-bound Silent Drop collection. Share needs this.
- **NUT-22 (blind authentication):** "only a member, and I can't tell which." Membership gating with in-set anonymity. Additive Teams-tier capability.

The BRIDGE v8.5 line ("a `02` BAT signs a full request transcript … may supersede NUT-11 Mode 2") conflated NUT-22 with the **transcript-signing property of nutroot / v3** (BRIDGE §nutroot: "every v3 input signs a shared transaction transcript"). A NUT-22 BAT as specified is a single-use blind token checked like ordinary ecash and struck off a spent list — no holder-keypair transcript signing. Fix the note so the two are not treated as substitutes.

**Dependency chains to note:** NUT-22 pulls NUT-21 (clear auth) + NUT-12 (DLEQ). NUT-24 pulls NUT-18 + NUT-26 (`creqA`/`creqB` encodings).

---

## 11. Silent Drop verdict reaffirmed; the "Elven cloak" is a distinct idea

**Decision. NUT-22 is the WRONG tool for Silent Drop and is not adopted there. Its clear-auth gate (an OAuth/OpenID login) is antithetical to the Silent Drop sender — "a frightened person with zero technical ability" who must reveal nothing and install nothing. Silent Drop stays as designed (blind credential, Turnstile, Port Authority).**

Separately parked as a *creative direction, not a decision*: **the "Elven cloak" curated inbox** — the *recipient* pre-mints a stack of blind, single-use upload tickets and distributes them out-of-band to known sources, so a curated inbox accepts only ticketed uploads (spam-proof, still no login for the source) and even the recipient cannot correlate which source used which ticket. This is NUT-22-*inspired* but distinct (recipient issues to senders; no OAuth). A Sovereign-tier variant sitting *beside* open Silent Drop, not replacing it. Galadriel's gifts — bearer capabilities handed over in trust at Lórien.

---

## 12. Framing lock — the Fellowship is a threshold with graceful degradation

**Decision. Adopt "threshold with graceful degradation" as the canonical non-cryptographer explanation of FROST / B12 M-of-N.**

The Fellowship is not "9 keys, all must sign." It is a trusted set designed to complete *as members fall*: Boromir defects (a compromised key), the company scatters, and the task still completes on a reduced quorum (Frodo carries, Sam refuses to be dropped). Surviving missing signers is exactly FROST's selling point — the honest promise to a firm whose partners are on aeroplanes.

---

## 13. Pool exhaustion — the three identity-rail sub-decisions (O5 resolved)

**Decision. Pool exhaustion on the identity rail produces three specific behaviours: (a) a non-actionable message to the blocked associate; (b) a coalesced beacon to the principal and AM fired at a pre-exhaustion threshold; (c) the beacon re-arms after top-up only.**

Reasoning.

The atomicity of §5 already resolves the concurrency race — three simultaneous starts resolve as three sequential commits; the first two succeed, the third bounces cleanly (400, BAT survives, banner kept). Pool exhaustion stops *new* crossings; it never strands *in-flight* ones (§6, resume-not-refund). The three sub-decisions address only the signalling:

- **(a) Associate message: non-actionable, honest.** "This transfer needs more than the firm's pool currently holds; your administrator has been notified." The associate is not the principal, cannot top up, and must not be shown a top-up button they cannot press. One message, no retry prompt.
- **(b) Pre-exhaustion beacon, coalesced.** The warning fires at a configurable low-pool threshold (reference: 20% remaining) — early enough for AM follow-up to land before exhaustion, because the remedy (AM async top-up) is slow by design. Image: **the beacons of Gondor** — Amon Dîn is lit while there is still time for Rohan to muster; signalling after the city falls is theatre. Critically: multiple associates bouncing in a short window produce *one* coalesced signal to the principal ("pool exhausted — N transfers affected in the last X minutes"), never a flood of identical alarms. Debounce window and threshold are config, not architecture.
- **(c) Re-arm after top-up only.** The threshold beacon arms once per crossing-into-low and re-arms only after the pool is replenished. No repeated signals while the pool sits empty.

**Anonymous rail — server-side warning is structurally impossible; client-side only.** Refueler cannot see the bearer token balance (client-held, no server ledger), so no beacon can be fired. There is no AM and no relationship to notify. The only remedy is a self-service Lightning top-up; the only warning is a local, client-side "credit low" indicator on the shared purse. "Teams" on the anonymous rail is a **shared purse**, not a managed pool — sharing bearer tokens is sharing a wallet — and its low-balance UX is a wallet concern, not a server signal. State this plainly to anonymous-rail Teams buyers; it is a thinner managed abstraction than the identity-rail version by design and by honesty.

**Fork is the finding.** The entire remedy model forks by rail — identity rail: server-observed pool + coalesced beacon to a named AM; anonymous rail: client-held purse + local warning only. Same failure, two completely different answers, because one rail has a relationship and the other refuses one by design.

---

## 14. `nut10` anti-replay on the NUT-24 402 — reserved, not adopted at v1 (O3 resolved)

**Decision. NUT-24 v1 emits the 402 with `nut10` absent. The toll is pure bearer. Anti-replay is provided structurally by the spent-token ledger and the single-use reservation. The `nut10` slot is reserved: when nutroot matures (B8+), a hashlock-over-request-transcript MAY be added with no wire break.**

Reasoning.

`nut10` on the 402 binds the toll token to the exact request (a hashlock over method + target + body-hash), so a lifted token cannot be replayed against a different request. Two structural defences already make this redundant for Share v1:

1. **Spent-token ledger.** A replayed token is caught as double-spent by `spent_tokens` (NUT-07 melt pattern, already built) before `nut10` is ever needed.
2. **Single-use atomic reservation.** The fare buys one crossing (§5). A lifted token, redirected, can at most complete the crossing it was already paying for — there is no fatter target to aim it at. On the identity rail the toll is an abuse ceiling (§9), not a coin; the loot from a successful replay is nil-to-tiny.

The residual threat `nut10` closes — a TLS-surviving on-endpoint adversary lifting the outgoing `X-Cashu` header inside the client's own trust domain — is real but out-of-proportion to the cost. That adversary has already partially compromised the client's environment; the payoff is one tiny single-purpose toll. More decisively: `nut10` is a spending-condition feature and Share's spending-condition machinery (NUT-10 v3 nutroot, B8) does not yet exist. Adopting `nut10` now would require rolling a bespoke lock ahead of nutroot — the premature-dependency error the whitepaper discipline explicitly forbids.

**Posture: bearer now, inscription later, parchment kept inscribable.** A pure bearer toll is an open decree — whoever holds it, it applies. A `nut10`-bound toll is a writ sealed to one errand. Reach for the seal when the bearer property is too loose; for Share today it is not. The slot is in the schema; the wax is ready; do not seal every scroll yet.

---

## Cross-product forward notes (for BRIDGE; detailed design in each product's own project)

- **Legend (strongest fit in the estate; post-B9).** NUT-22 membership + NUT-24 per-query toll = "prove you're allowed to look without revealing that it's *you* looking, or that these lookups are one watcher." Resolves Legend's structural trap: *open* (unsustainable) vs *accounts* (self-defeating — an account binds every lookup to a person, the exact leak Legend abolishes). The anti-palantír: you look into the chain, and the chain does not look back. Detailed design → `refueler-legend` session.
- **Pass.** NUT-22 = "count the room, name none" — the door confirms a valid holder, not which, and links no scan to scan across re-entries or the VIP rope. Composes with nutroot `threshold` (VIP subset) / `after` (time windows). Differentiator vs Luma: the venue proves you belong without proving who you are; no attendance graph is ever assembled. NUT-24 = whispered VIP-rope upgrade toll (an upgrade no CRM logged). Image: Bree — a common room full of Underhills. Detailed design → `refueler-pass` session.

---

## Vocabulary candidates (NOT locked — finalise at build time) → BRIDGE

- **Whisper** — the NUT-24 toll ("the price is named at the wall and answered along it"). **Whispering Gallery** — the pattern. Brushes the Silent Drop register; do not lock now. `refueler_whisper` floated as the 402 handshake tool name.
- **Entmoot / Fellowship count / Whispering Gallery** — the three-storey internal mnemonic (conditions / membership / toll). Teaching aid only; never product UI.
- LOTR access-utterance cluster (colour, not vocabulary): "Speak, friend, and enter" (Moria = match the channel's expected form), the Gondorian guard refusing Rohan's coin (mint-scoping), the Whispering Gallery at St Paul's answering only at its own resonance (unit/mint match, else `400`).

---

## Open items carried to the next session(s)

**Resolved this session:** O3 (§14) · O5 (§13).
**Logged to memory, slotted at best block:** O1 (own Opus session before any Teams block) · O8 (SW-scoping session).

Genuinely unresolved — not session plans:

1. **O2 — Teams keyset rotation.** Cadence, in-flight BAT handling, migration on rotation. Ties to Ceremony of the Keys / Warder.
2. **O4 — Small-set honesty threshold.** Minimum seat count below which per-firm-keyset anonymity is "thin"; a disclosure line for S-band Teams; hard "Individual Sovereign gains none."
3. **O6 — Dependency scope confirmation.** NUT-22 → NUT-21 + NUT-12; NUT-24 → NUT-18 + NUT-26. Confirm the adoption footprint before B8 lock.
4. **O7 — Roadmap placement.** The Teams two-header combo is Teams-maturity — after the SW block, alongside/after B8, ~B10. Near-term discipline: **design the Teams entitlement + keyset model now so the BAT layer slots in without a refactor; build none of it yet** (same discipline B7 used for Silent Drop). Final placement = next planning session.

---

*"One does not simply issue a bearer instrument that calls home."*
