# ROTATION-CEREMONY.md — Keyset Rotation Ceremonies
> **Version:** 1.0 | **Locked:** Opus-3b · 31 Aug 2026
> Four ceremonies — one per Liberty. Covers: what a ceremony is, admin
> changelog template, worked examples, and the whitepaper §Key lifecycle
> section language (Part II §6 of the whitepaper outline).

---

## What a rotation ceremony is

When a Liberty rotates its active keyset — generating new keypairs, publishing the new keyset, retiring the old — it performs its rotation ceremony.

A ceremony is:
- **Announced in advance.** Outstanding credential holders are notified. The schedule is published.
- **Consequential.** After the ceremony, the old keyset is retired. Credentials issued against it remain valid through a stated grace period; after that, they must be renewed.
- **Never a login flow.** Authentication is a plain challenge-response at the gate. The ceremony vocabulary is reserved for the keyset event alone. Do not confuse a Harbourmaster logging in with the Royal Mint performing the Ceremony of the Keys.
- **Periodic and predictable.** The cadence is fixed and published. An unscheduled ceremony is an incident, not a ceremony.

---

## The four ceremonies

| Liberty | Ceremony | Actor | Historical basis |
|---|---|---|---|
| Tower / Share | **Ceremony of the Keys** | the **Warder** | Performed nightly at the Tower of London for 700+ years, interrupted twice in recorded history. A locked gate is a locked gate: the weight is appropriate for an event that changes what is cryptographically valid. |
| Westminster / Pass | **Black Rod** | Black Rod | At the State Opening of Parliament, Black Rod's approach is met with the door of the Commons slammed shut. He knocks three times; the door is opened; he summons the Commons to the Lords. The rotation is the rite itself — a closed door, reopened under new authority. |
| Temple / Legend | **Silent Ceremony** | — | The near-wordless annual handover of the office of Lord Mayor of the City of London. No fanfare. No explanation. The keys of office change hands in near silence, announced but not explained. The keyset changes hands in near silence, announced but not explained. |
| Royal Exchange / Merchant | **The Proclamation** | the **Common Crier** *(optional colour)* | The accession proclamation is read from the steps of the Royal Exchange — one of the four official City of London proclamation sites. Old authority is retired; new authority is declared; continuity is preserved across the handover. Public, formal, and non-negotiable once read. The Common Crier is the City officer who reads proclamations; the role exists if you want the pairing, but the ceremony stands without it. |

---

## Admin changelog template

```
## [YYYY-MM-DD] — [Ceremony] performed — [Liberty] / [Mint]

Ceremony:        [Ceremony of the Keys | Black Rod | Silent Ceremony | The Proclamation]
Liberty / mint:  [Tower / Royal Mint | Westminster / Jewel Tower | Temple / Temple Treasury | Royal Exchange / the Exchange]
Announced:       [YYYY-MM-DD]  (N days in advance)
Performed:       [YYYY-MM-DD]
New keyset:      [keyset ID / fingerprint]  — ACTIVE
Previous keyset: [keyset ID / fingerprint]  — RETIRED
Grace window:    outstanding credentials valid until [YYYY-MM-DD]
Operator:        [initials]
```

### Worked examples (one line per ceremony)

```
2026-12-31 — Ceremony of the Keys performed — Tower / Royal Mint
  New keyset 03e4…b7 ACTIVE · previous 03c2…19 RETIRED · grace to 2027-01-30 · RT

2026-10-14 — Black Rod performed — Westminster / Jewel Tower
  New keyset 03cc…71 ACTIVE · previous 03aa…04 RETIRED · grace to 2026-11-13 · RT

2026-11-14 — Silent Ceremony performed — Temple / Temple Treasury
  New keyset 02f0…8d ACTIVE · previous 02d1…22 RETIRED · grace to 2026-12-14 · RT

2026-11-09 — The Proclamation performed — Royal Exchange / the Exchange
  New keyset 03a1…f2 ACTIVE · previous 02be…9c RETIRED · grace to 2026-12-09 · RT
```

---

## Usage by context

Applies to all four ceremonies identically.

| Context | Usage |
|---|---|
| Whitepaper / developer docs | "[Ceremony] — keyset rotation event, announced N days in advance; outstanding credentials remain valid for the grace period." |
| Admin changelog | "[Ceremony] performed — new keyset active, previous keyset retired." |
| Product UI | Plain language only — "Active keyset updated." |
| Login / authentication | Never referenced. Authentication is a plain challenge-response. |

---

## Whitepaper §Key lifecycle language
*Drop verbatim into Part II §6 of the whitepaper draft.*

---

### Key lifecycle: the rotation ceremonies

Each Liberty rotates its active keyset on a published schedule. When a Liberty generates a new keypair, publishes the new keyset, and retires the old, it performs its rotation ceremony.

A ceremony is announced in advance. It is consequential for outstanding credentials, which remain valid through a stated grace period. It is never a login flow — authentication is a plain challenge-response at the gate; the ceremony vocabulary is reserved for the keyset event alone.

Each Liberty's rite is native to its home:

**Tower (Share)** — the Ceremony of the Keys, performed by the Warder. Nightly at the Tower of London for seven centuries, interrupted twice. The weight suits an event that changes what is cryptographically valid.

**Westminster (Pass)** — Black Rod. At the State Opening, Black Rod's approach is met with the door of the Commons slammed shut. He knocks; the door opens; new authority enters. The rotation is the rite itself.

**Temple (Legend)** — the Silent Ceremony. The near-wordless annual handover of the office of Lord Mayor. The keyset changes hands in near silence — announced, but not explained.

**Royal Exchange (Merchant)** — The Proclamation, read from the steps of the Exchange. The City's commercial proclamation site: old authority retired, new authority declared, continuity preserved across the handover. Public, formal, and non-negotiable once read. The Common Crier reads it.

---

*"Nothing stops this train."*
