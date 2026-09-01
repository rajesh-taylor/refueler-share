# WHITEPAPER-OUTLINE.md — Refueler Platform Whitepaper
> **Version:** 1.0 | **Locked:** Opus-3b · 31 Aug 2026
> B9 deliverable. Covers all four Liberties.
> Load alongside BRIDGE and CLAUDE.md when entering any whitepaper build session.

---

## Front matter

**Title:** TBD whitepaper build session (before B9).

**Version · Date · Authors**

**Scope and claims statement (mandatory — appears here AND in §8 Integrity)**

The following claims are asserted in this whitepaper:
- Server-side BLAKE3 chunk integrity verification (400 on hash mismatch — implemented, audited S42e)
- Double-spend detection via Supabase ledger
- Rate limiting on all public endpoints
- UUID-bound credential issuance (Worker precursor to NUT-20)

The following claims are explicitly NOT made:
- Full Merkle-root verification (future work — §16)
- NUT-11 Mode 2 keypair authentication (B8)
- Any "end-to-end integrity" claim without the Merkle qualifier
- "Audit-certified" or "security-audited"
- "Anonymous" for Lightning payers (correct claim: pseudonymous — §10)

*No subsequent section overrides this boundary. If a claim is not on the first list, it is not in this whitepaper.*

---

## Part I — The argument
*Why privacy must be architectural, not a policy choice.*

### §1 — The two problems

Most privacy products solve one problem. Refueler solves two, simultaneously, by architecture rather than promise.

**The recipient problem:** a transfer must survive either party going offline. It must be asynchronous — collected on the recipient's schedule, not the sender's. Every synchronous peer-to-peer mechanism (direct link share, AirDrop, encrypted messaging attachments) fails this clause by design. The recipient cannot maintain a permanent, publicly-shareable intake address without a server holding files on their behalf.

**The compulsion problem:** a server holding files on someone's behalf can be compelled to produce them. The threshold varies by jurisdiction; it is never zero. The only system that cannot comply with a production order is one that never held the plaintext. "We promise not to look" is policy. "We are cryptographically incapable of reading it" is architecture.

These two problems pull in opposite directions. Solving the recipient problem seems to require a server — which creates a compulsion surface. Refueler's architecture dissolves the tension: the server holds encrypted noise it cannot read, issued against a blind-signature credential it cannot link to an identity, for a transfer it cannot correlate with any other.

*Writer's note: define both terms plainly before using them. A first-time reader of the whitepaper has not encountered "recipient problem" or "compulsion problem" as technical vocabulary. Two crisp sentences each, no jargon, before the section above runs.*

### §2 — Historical prior art: the Templar lineage

**Geography:** Temple (Legend's home — and the headwater of the prior-art argument. The record-keeper stands on the origin ground.)

The Knights Templar invented the letter of credit at Temple Church, London, circa 1150. A pilgrim deposited gold at the London preceptory, received a credential — a document, a bearer instrument, encrypted and verifiable — travelled to Jerusalem, presented the credential, received equivalent value. The gold never moved. The *information about the gold* moved, in verifiable form, across jurisdictions with no common sovereign, designed for adversarial interception conditions.

This is Cashu. Not a metaphor for Cashu. Cashu, described in 1150.

The blind signature is the letter. The mint is the Temple treasury. The bearer is the pilgrim. The receiving preceptory is the download endpoint. Fleet Street runs from Temple Bar (the credential checkpoint) westward past the Temple — the information channel running through the credentialing layer, physically.

The lineage in full:
- Templar letter of credit — Temple Church, London, c.1150
- Venetian bill of exchange — anonymous bearer, no common sovereign, c.1350–1500
- Chaumian blind signature — David Chaum, 1982 — the cryptographic formalisation
- Cashu — open-source Chaumian ecash on Lightning, 2022
- Refueler — four Cashu Liberties in a browser, no account, 2026

Anonymous bearer instruments for moving value and information across jurisdictions without carrying the underlying asset. The prior art is 900 years old. The open-source cryptographic implementation on Lightning infrastructure, in a browser, with no account required, is new.

*Whitepaper copy note: "the pilgrim's society" is available as a future proper noun for the constituency of Refueler users — heavy Anglo-American connotations, silent power. Hold until the naming is ready; do not introduce it speculatively.*

### §3 — The metadata argument

**Geography:** Temple of Mithras (a system that leaves almost no record, running beneath financial infrastructure) + Whispering Gallery (St Paul's, Legend geography — a whisper you believe private travels the whole dome and is heard on the far side).

The question is never whether the content is protected. It is what the infrastructure knows that the content cannot reveal. File size. Transfer timestamp. Chunk count. IP addresses of sender and recipient. Browser fingerprint. The pattern of access — when, how often, from where.

A block explorer query is a Whispering Gallery event: the user believes they are looking privately at one address. The query goes to a server that logs the IP, the address, the time, and can correlate it with every other query from that IP or session. A Harley Street physician looking up a patient's wallet is not anonymous. Neither is the journalist running a source's address through a public explorer at 2am on a work laptop.

The Temple of Mithras ran underneath Roman London — a system of practice beneath the visible financial architecture, leaving almost no trace. The metadata layer is its inversion: a system that leaves a trace even when the content leaves none.

**Honest admission (load-bearing, appears here):** Refueler logs edge metadata — file size, chunk count, transfer timing, and infrastructure-layer IP data held by Cloudflare under their data processing agreement. This is published voluntarily in `honest_metadata.json` (public URL: `refueler.io/_data/honest_metadata.json`). The whitepaper does not hide this; naming it here earns the right to every privacy claim that follows.

**VPN recommendation (named, measured):** readers for whom IP protection matters should use a VPN that does not log. Mullvad is the named recommendation — no account required, no email, payment in cash or Monero accepted, audited no-log policy. For stronger protection, a multi-hop VPN (where traffic routes through two separate providers' infrastructure, breaking the single-provider correlation) materially reduces the residual surface. Multi-hop providers: Mullvad (built-in), IVPN. This recommendation appears once, in plain language, without becoming an endorsement of any commercial relationship.

---

## Part II — The constitutional model
*How the four Liberties are governed.*

### §4 — The four Liberties

**Geography:** City sovereignty (the sovereign requires permission to enter the square mile; each Liberty is self-governing within its jurisdiction) + Temple Bar (the boundary / challenge point).

A Liberty in London is a zone with its own jurisdiction where ordinary authority does not reach — the Liberty of the Tower, the Liberty of the Clink, the Liberty of the Temple. Each Refueler Cashu mint is a Liberty: self-governing, separately seeded, separately operated, answerable to no shared authority above it.

The model is literal, not metaphorical. Four real self-governing jurisdictions of London, west to east along the Thames:

**Westminster makes the rules (Pass) → Temple keeps the record and the origin (Legend) → the Royal Exchange settles the trade (Merchant) → the Tower moves the cargo across the water (Share).**

| Liberty | Product | Credential type | Melt path | Mint |
|---|---|---|---|---|
| Tower of London | Share | Upload credentials, Harbourmaster Lockes | None — capability tokens only | Royal Mint |
| Westminster | Pass | Access credentials + reward tokens | Mixed — reward tokens carry live melt | Jewel Tower *(TBD Opus-3a)* |
| Temple | Legend | Address watch credentials | None — signal-only | Temple Treasury *(TBD Opus-3a)* |
| Royal Exchange | Merchant | Settlement tokens + stamps | Live — venue settlement | the Exchange *(provisional)* |

**Constitutional principle:** four mints, four independent seeds, four Ravens, four separate databases. No shared process, no shared seed material, no shared failure domain. Isolation goes all the way to the seed.

**Why four, not one mint with four keysets:** a shared mint is a shared failure domain, a shared compulsion surface, and a shared database that *can* correlate events across products — a capability that must not exist, not merely one that will not be exercised. The melt-hygiene argument is equally firm: Pass and Merchant carry live Lightning melt paths; Share and Legend credentials must never melt. The same process must not hold both properties. Separate mints remove the ability, not merely the intention.

**The City sovereign test:** the sovereign of England, since the 14th century, requires permission to enter the City of London at Temple Bar — a formal ceremony of mace-presentation at the boundary before entry is granted. Each Liberty holds equivalent sovereignty over its own jurisdiction. Refueler holds no master key. There is no master key.

### §5 — Compulsion resistance: the Raven system

**Geography:** Tower of London (Ravens are native to the Tower — their presence is statutory under the protection of the Crown).

Ravens are warrant canaries. One Raven per Liberty — four Ravens in total. Each is a standing, signed, dated legal statement on its product page: no compulsion received, no logging beyond the stated policy, no backdoor.

Ravens signal safety by presence. Their *absence* is the compulsion signal.

The canary dies to signal danger. The raven is absent — and the Tower falls. The metaphor is more accurate: a canary's death is a one-time event, unrepeatable and disposable. A raven's absence is a standing condition that persists and compounds. Refueler's warrant canaries are Ravens because the mechanism is continuous: the Raven must be renewed on a fixed schedule; a failure to renew — whether through inaction, compulsion, or operator compromise — is the signal. The bird does not die; it simply does not return.

**The hard wall:** Ravens and the status page must never share vocabulary, a display surface, or ambiguity. "Royal Mint: operational" is infrastructure language. A Raven absent is a legal event. One is a Tuesday; the other is a constitutional moment. A mint outage on a Tuesday must never read as a legal event.

Four Ravens:
- Share (Tower / Royal Mint): no compulsion, no logging beyond stated, no backdoor — Share-scoped
- Pass (Westminster / Jewel Tower): as above, Pass-scoped
- Legend (Temple / Temple Treasury): as above, Legend-scoped, 5–6 mirrors (distributed explorer architecture)
- Merchant (Royal Exchange / the Exchange): as above; scoped to merchant settlement and venue data — no order content logged beyond stated, no compelled backdoor into the Exchange mint

### §6 — Key lifecycle: the rotation ceremonies

**Geography:** native to each Liberty's home (Tower / Westminster / Temple / Royal Exchange).

Each Liberty rotates its active keyset on a published schedule. When a Liberty generates a new keypair, publishes the new keyset, and retires the old, it performs its rotation ceremony. A ceremony is announced in advance. It is consequential for outstanding credentials, which remain valid through a stated grace period. It is never a login flow — authentication is a plain challenge-response at the gate; the ceremony vocabulary is reserved for the keyset event alone.

Each Liberty's rite is native to its home:

| Liberty | Ceremony | Historical basis |
|---|---|---|
| Tower (Share) | **Ceremony of the Keys**, performed by the **Warder** | Nightly at the Tower for 700+ years. The weight suits an event that changes what is valid. |
| Westminster (Pass) | **Black Rod** | The State Opening — Black Rod's door is shut and reopened; the rotation is the rite itself. |
| Temple (Legend) | **Silent Ceremony** | The near-wordless annual handover of the office of Lord Mayor. The keyset changes hands in near silence, announced but not explained. |
| Royal Exchange (Merchant) | **The Proclamation**, read by the **Common Crier** | The accession proclamation read from the steps of the Exchange — the City's commercial proclamation site. Old authority retired, new declared, continuity preserved across the handover. Public, formal, non-negotiable once read. |

Usage by context:

| Context | Usage |
|---|---|
| Whitepaper / developer docs | "[Ceremony] — keyset rotation event, announced N days in advance; outstanding credentials remain valid for the grace period" |
| Admin changelog | "[Ceremony] performed — new keyset active, previous keyset retired" |
| Product UI | Plain language only — "Active keyset updated" |
| Login | Never referenced |

---

## Part III — The cryptographic architecture
*What it is built from.*

### §7 — The two-layer lock

BLAKE3 = content addressing and chunk integrity. Internal only. Never the authentication layer.
Cashu blind signatures = anonymous authentication and payment gate. Never the hashing layer.

These two layers must never be conflated. The distinction is not technical pedantry — it is the load-bearing architectural claim. One answers "is this chunk exactly what was sent?" The other answers "does this bearer have the right to receive it?" They are different questions, answered by different cryptographic primitives, at different points in the transfer lifecycle.

### §8 — Integrity

**Geography:** floating staircase (Merkle — whitepaper and closed-door presentation only) + Triforium / Trinity Library (the deep ledger consulted — St Paul's).

The floating staircase at St Paul's is self-supporting: each step rests on the one below, with no central column. A Merkle tree is the same construction in data: each parent hash is computed from its children; the root hash commits to every leaf; tampering with any leaf invalidates everything above it. The image is available for the whitepaper and closed-door presentation — it is too technical for client copy.

The Triforium — St Paul's hidden 1709 library — is the deep historical ledger. When a user consults Legend's chain data, they are ascending to the Triforium: the record was always there; most people never looked.

**Integrity claims (§front matter restated):**
- ✅ Asserted: server-side BLAKE3 chunk integrity. Every chunk verified server-side on receipt. 400 on hash mismatch.
- 🔒 Not asserted: full Merkle-root verification (assembled file vs BLAKE3 tree root). This is future work — §16.

### §9 — The credential model

**Geography:** Temple Bar (challenge point — where the Locke is presented).

Cashu NUT-11 P2PK — the Locke. The Harbourmaster generates a keypair client-side; the private key never leaves the device. The Royal Mint issues a Locke bound to the Harbourmaster's public key. Authentication: the dashboard issues a nonce, the device signs with the private key, the public key is verified against the authorised set. Nothing reusable crosses the wire.

At Temple Bar: *present Locke → receive nonce → sign with device → gate opens.*

Key decisions:
- UUID-bound credential issuance — the Worker precursor to NUT-20. UUID→credential binding lives in cryptographic commitment only; it is never stored in KV or Supabase.
- Capability tokens (Share / Legend) carry no melt path — the property is architectural, not a policy setting on a general-purpose token.
- Live-melt tokens (Pass / Merchant) are separate mint processes for this reason.
- Cashu sits at the payment and credential layer. The KV byte counter is the usage primitive. These are different things.
- CDK pinned at 0.17.2. Monitor cashubtc/nuts for NUT-00 v3 and NUT-10 v3 (Nutroot secrets) merge.

The Locke is separate from the subscription credential. Subscription credential = entitlement (what you are allowed). Locke = access (who holds the key to the door). Issued as two separate objects from one payment event. Rotating the Locke does not affect the billing entitlement.

### §10 — Storage and settlement

**Storage:** Cloudflare R2 — egress-free object store. The Worker receives and stores encrypted noise. It cannot read file content. Content-Type is validated against a denylist of execution-capable types at the upload boundary (Port Authority); the MIME type is never stored. The declared type reflects intent only — the Worker cannot verify payload content.

**Settlement:** self-hosted LNbits on Hetzner CAX21, backed by phoenixd (ACINQ). No third-party provider holds invoice metadata. No custodial wallet at any point in the payment path.

**Honest privacy framing for Lightning:**
- Lightning payers are **pseudonymous, not anonymous.** The payment hash, amount, and tier are known. Internal correlation by the node operator (ACINQ/phoenixd) is documented and not hidden.
- Stripe payers: name, email, and card visible to Refueler.
- "Anonymous" is not claimed for either rail. Pseudonymous is the honest word.

The payment privacy table (`payment_privacy.json`) is published at `refueler.io/_data/payment_privacy.json` and appears verbatim in this whitepaper and on the platform.

---

## Part IV — Per-Liberty detail
*The four products in their home geography.*

### §11 — Share (Tower of London / Royal Mint)

Silent Drop · Lighthouse · Quay · Harbourmaster · Cargo · Port Authority · Locke · Warder · Ceremony of the Keys · Raven

The Tower moved cargo across the Pool of London for centuries. The Royal Mint operated inside the Tower walls for approximately 500 years — issuing credentials that governed the movement of value. The Port of London Authority sat at Tower Hill — controlling what entered. The Warder performs the Ceremony of the Keys nightly, locking the gate.

Product detail: Silent Drop, the Lighthouse intake URL, named Quays, the Harbourmaster dashboard and receipt ledger, the credential lifecycle, the Cargo transit model, the Port Authority denylist gate. Full product detail in the Share developer docs; this section covers the architectural placement and geographic grounding.

### §12 — Pass (Westminster / Jewel Tower)

*Vocabulary session pending (small Sonnet session) — geographic terms for reward tokens and live melt path to be named before this section is drafted in full.*

Westminster passes laws — permits, who may do what and when. The Palace of Westminster is the seat of the permission-granting authority. Pass credential classes: non-monetary access credentials (bearer or NUT-11 P2PK bound) and monetary reward tokens (spendable sats, live Lightning melt path).

Black Rod performs the rotation ceremony at the State Opening — the door is shut in his face and reopened; the rotation is the rite itself.

### §13 — Legend (Temple / Temple Treasury)

*Mint/issuer name (Temple Treasury — provisional) to be confirmed Opus-3a.*

Legend is a block explorer. The City keeps the record — Guildhall Library is London's civic archive. When a user consults the chain, they consult the record. The Whispering Gallery is the metadata-leak argument in full: a private query is a public whisper. Article 14 (opening line locked) lives here.

Triforium = the deep ledger. Floating staircase = Merkle structure (whitepaper and presentation only). Address-watch credentials are signal-only, no melt path. The Raven here has 5–6 mirrors, appropriate for a distributed block explorer architecture.

The Temple is unowned — the neutral Templar / Cashu origin, headwater for all four Liberties. Legend stands at that origin. The mint takes its name from the Temple Treasury (provisional — Opus-3a); the product's home is the record-house (Guildhall + St Paul's).

### §14 — Merchant (Royal Exchange / the Exchange)

*Vocabulary session pending (same Sonnet session as Pass) — geographic terms for settlement tokens, stamps, and live melt path to be named before this section is drafted in full.*

The Royal Exchange was the first purpose-built commercial exchange in England — Thomas Gresham, 1565. Gresham's Law was named here. It is where trade is settled, not where cargo moves or rules are made.

The Exchange mint issues settlement tokens and venue stamps. Live melt path: venue payments settle directly to the merchant's Lightning address. Stamps are passive, silent — issued on FULFILLED status, `✦` glyph on tile. The Proclamation is performed from the steps of the Exchange.

---

## Part V — Distinctions and future work

### §15 — The monetary distinction

**Geography:** Bank of England — the foil. *Handled with care throughout — the whitepaper is not a polemic.*

The Bank of England is independent within the system; it cannot be audited by Treasury; it is the central monetary authority. It is also the establishment institution Refueler is explicitly not. The distinction is architectural: the Bank issues currency that must be accepted; Refueler issues credentials that govern access to a service. The Bank cannot be blind to what it issues; Refueler's mints are structurally blind to the content they protect.

This section makes the distinction once, precisely, and does not return to it. It does not antagonise the wrong people.

### §16 — Future work

- **Full Merkle-root verification** (assembled file vs BLAKE3 tree root) — B9
- **NUT-11 Mode 2 keypair authentication** — B8
- **ML-KEM key wrapping** — B10 (Production Max and Enterprise first)
- **FROST threshold signatures** — B12. Use cases locked: law firm co-sign, music masters, film/VFX chain of custody.
- **Nutroot secrets (NUT-10 v3)** — supersedes the NUT-29 framing. B9 whitepaper §Future work must reference Nutroot. "The policy is the credential" is the architectural direction this follows to its conclusion.
- **SP-native receive** — requires a full Lightning node (LND migration, post-B9 trigger condition).
- **International scale** — the three-city-states model (London / Washington / Vatican) is available the moment Refueler operates across jurisdictions. Gesture only; no commitment.

### §17 — Threat model and honest limitations

- Edge metadata is logged: file size, chunk count, transfer timing, Cloudflare-layer IP data.
- Lightning payers are pseudonymous, not anonymous. Internal correlation by the node operator is documented, not hidden.
- Authorised-recipient exfiltration is out of architectural scope. The system protects the transfer; it cannot protect what a legitimate recipient does with a file they were entitled to decrypt and download.
- IP protection is the user's responsibility at the edge. Mullvad VPN (named recommendation) or a multi-hop provider materially reduces the residual surface — see §3.
- Compulsion resistance extends to what Refueler holds. Refueler cannot compel the user's device, and cannot resist compulsion applied to the user's device by another party.

---

## Back matter

**Prior-art and defensive publication note**
The novel combination of BLAKE3 chunk integrity verification with Cashu NUT-00 blind-signature access control in a browser-based anonymous file transfer system is documented here for the public record. Defensive publication at IP.com (or equivalent), attorney-assisted, is planned for 30 days after this whitepaper publishes. Apache 2.0 licence — the patent grant clause protects this combination. See also: Templar lineage (§2) — the prior art for bearer credential transfer is 900 years old; the open-source cryptographic implementation is new.

**Glossary**
Geography term → technical reality, straight from the canonical vocabulary matrix in BRIDGE. Every term that appears in the whitepaper body is defined here. No term appears in the whitepaper that is not in the vocabulary matrix.

---

*"Nothing stops this train."*
