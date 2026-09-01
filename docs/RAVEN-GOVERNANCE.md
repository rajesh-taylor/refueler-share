# RAVEN-GOVERNANCE.md — Refueler Warrant Canary System
> **Version:** 1.0 | **Locked:** Opus-3b · 31 Aug 2026
> Internal governance document. One Raven per Liberty. Four Ravens total.
> Load in any session touching warrant canaries, status pages, compulsion
> resistance claims, or the §5 Governance section of the whitepaper.

---

## What a Raven is

A Raven is a warrant canary. It signals safety by presence, not by dying.

The traditional warrant canary — borrowed from coal mining — dies to signal danger. The mechanism has a flaw: a one-time, unrepeatable signal. The bird dies once; after that, nothing. Refueler uses Ravens instead: by statute, there must always be at least six Ravens at the Tower of London, or the Tower — and with it, the kingdom — falls. The Raven does not die. It is simply absent. And its absence is continuous, compounding, and impossible to hide.

This is why the metaphor is more accurate than the canary. A Refueler Raven must be renewed on a fixed schedule. A failure to renew — whether through inaction, compulsion, or operator compromise — is the signal. The Raven does not die. It simply does not return. And when it does not return, the Liberty has fallen.

---

## Constitutional rule

**Ravens are warrant canaries only.**

One Raven per Liberty. Separate legal statements, separately signed, separately dated, each on its own product page. No shared statement across Liberties. A shared canary is a shared compulsion surface: one order could silence all four. The isolation that applies to the mints applies to the Ravens.

---

## Four Ravens

| Liberty | Product | Statement scope | Mirrors |
|---|---|---|---|
| Tower / Royal Mint | Share | No compulsion received. No logging beyond the stated policy. No backdoor. Share-scoped. | 2–3 |
| Westminster / Jewel Tower | Pass | As above. Pass-scoped — access credentials and reward tokens. | 2–3 |
| Temple / Temple Treasury | Legend | As above. Legend-scoped — address watch credentials and block explorer queries. | 5–6 |
| Royal Exchange / the Exchange | Merchant | As above. Scoped to merchant settlement and venue data — no order content logged beyond the stated policy, no compelled backdoor into the Exchange mint. | 2–3 |

Legend carries more mirrors because its architecture is distributed. A distributed explorer architecture implies distributed Raven verification — more independent hosts, more independently verifiable absence.

---

## Mechanics

**Signer:** Rajesh Taylor. Single detached PGP signature per Raven. The signing key is held by the signer; the public key is published on the product page.

**Statement text:** Each Raven carries the statement text, the current date, and the hash of a recent Bitcoin block (freshness proof — no pre-signed statement can fake a future block hash).

**Renewal cadence:** Fixed interval. Weekly is the recommended minimum. Longer intervals increase the window between compulsion and signal; shorter intervals are operationally demanding for a solo operator. Cadence is published alongside each Raven so readers know what renewal looks like.

**Trigger to silence:** receipt of any compelled-secrecy order touching that Liberty. The Raven is not renewed. No statement is made about why. The mechanism does the speaking.

**Mirrors:** independently hosted. Each mirror URL is listed on the product page. A reader verifies the PGP signature and checks the date is current across mirrors before concluding the Raven is present. Reader instructions are published alongside each Raven — how to verify the signature and read the date.

---

## The hard wall

| Signal | Meaning | Lives at |
|---|---|---|
| Raven absent / not renewed on schedule | Legal compulsion received touching that Liberty | Product page (Raven) |
| Status indicator amber or red | Infrastructure outage / mint unavailable | `refueler.io/status/` |

These two signals must never share vocabulary, a display surface, or ambiguity.

"Royal Mint: operational" is plain infrastructure language. A Raven absent is a legal and constitutional event. One is a Tuesday; the other is the Tower falling.

A mint outage on a Tuesday must never read as a legal event. A compulsion event must never be mistaken for a Tuesday.

**Prohibited:** using any Raven metaphor, vocabulary, or display element on the status page. Prohibited: using any status-page health language in the Raven system. Prohibited: any shared component, shared label, or shared colour between the two surfaces.

---

## Governance rule (one sentence)

Absence of a Raven signals legal compulsion. Absence of a status indicator signals infrastructure. Never let a user of any Refueler product confuse the two.

---

*"Nothing stops this train."*
