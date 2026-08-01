# Security Breach Register — Refueler Share
> **Version:** 1.0 | **Created:** AP-5 · 1 Aug 2026
> The incident log. Each confirmed or suspected breach gets a dated entry below.
> Response procedures, communication templates, and tabletop simulation checklist live in `docs/incident-response.md`.
> No entries below means no recorded incidents. That is itself meaningful data.

---

## How to use this file

When an incident is declared (S1 or S2 under `docs/incident-response.md` §2), open a new entry using the template below. Fill in every field you can immediately. Leave fields blank rather than speculating — incomplete honest entries are preferable to complete dishonest ones. Return and update the entry as more information becomes available. Close the entry when the incident is resolved and lessons learned are documented.

This file is version-controlled. Every update is timestamped by git. Do not edit past entries except to add information — amendments should be additive, not revisionary. If an earlier assessment was wrong, add a correction note with a timestamp rather than changing the original text.

This file may be disclosed to the ICO, to enterprise clients during procurement diligence, or in response to a freedom of information request. Write accordingly: factually, without minimisation, without spin.

---

## Entry template

Copy this block for each new incident. Remove the comments before committing.

```
---

## [YYYY-MM-DD] — [Severity: S1 / S2 / S3] — [One-line title]

**Status:** [INVESTIGATING / CONFIRMED / RESOLVED]
**Declared:** [timestamp UTC]
**Resolved:** [timestamp UTC, or "open"]
**ICO notification filed:** [yes / no / not applicable — reasoning]
**ICO reference number:** [if filed]

### What happened

[Factual narrative. Past tense for confirmed events. Present tense for ongoing investigation.
Include: how the incident was discovered, by whom, at what time. What systems were involved.]

### Systems and data involved

| System | Confirmed accessed? | Data category | Personal data? |
|--------|--------------------|-|----------------|
| Cloudflare R2 | yes / no / unknown | Encrypted chunks, manifests | No (ciphertext only) |
| Supabase `subscribers` | yes / no / unknown | Email, name, tier, card last 4 | Yes |
| Supabase `spent_tokens` | yes / no / unknown | Cashu serials only | No |
| Cloudflare KV | yes / no / unknown | Lightning payment hashes (TTL-bound) | No |
| Worker secrets | yes / no / unknown | API keys | Depends on scope |

### What was exposed

[Honest enumeration. If R2 was accessed: encrypted chunks only — no key was held, no plaintext
is derivable. If Supabase was accessed: list the specific fields in the subscriber table that
were readable. Do not minimise. Do not extrapolate.]

### What was not exposed by design

[Architecture statement — this section should be nearly identical in every incident, because the
architecture does not change. "AES-GCM session keys were never transmitted to our servers — they
exist only in URL fragments and browser memory. File contents cannot be derived from anything we hold.
Sender and recipient identities are not held for free tier users. No account credentials exist
because no accounts exist."]

### Timeline

| Time (UTC) | Event |
|------------|-------|
| [time] | [event] |

### Response actions taken

[Ordered list of what was done, when, by whom.]

### Communication log

| Time (UTC) | Channel | Content |
|------------|---------|---------|
| [time] | Status page | [summary of post] |
| [time] | Subscriber email | [summary] |
| [time] | ICO portal | [notification filed] |

### ICO notification reasoning

[Required field. Either: "Article 33 applies — personal data was implicated — filed at [time]."
Or: "Article 33 does not apply — [reasoning, e.g. breach involved R2 encrypted data only,
no personal data accessible without a key we do not hold] — decision not to file documented here
at [time]."]

### Lessons learned

[What this incident revealed about the architecture, procedures, or communication process.
What changes are being made as a result. This section is the most important one — an incident
without a lessons learned entry is an opportunity wasted.]

### Architecture changes

[Any modifications to the system made in response to this incident. Reference the commit hash(es).]

---
```

---

## Incident log

No entries. No recorded incidents to date.

The absence of entries in this file is not a claim that no security events have ever occurred — it is a statement that no event has risen to the level of an S1 or S2 incident since this register was opened on 1 August 2026. Routine operational S3 events (third-party outages, degraded performance) are tracked on the status page, not here.

---

*"Nothing stops this train."*
