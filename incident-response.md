# Incident Response — Refueler Share
> **Version:** 1.0 | **Created:** AP-5 · 1 Aug 2026
> The playbook. Read this before you need it. Run the tabletop simulation before alpha.
> All incidents are logged in `docs/security-breach.md`. This document never changes to reflect a specific event — it is the standing procedure.

---

## 1. Architecture context — what a breach at Share actually means

Before anything else: understand what Share stores and what it cannot store.

**What we hold:**

| Data | Where | Accessible to operator? | Accessible under compulsion? |
|------|-------|------------------------|------------------------------|
| Encrypted file chunks | Cloudflare R2 | No — ciphertext only | Ciphertext only — useless without key |
| File sizes, chunk counts, transfer timestamps | R2 manifest, KV | Yes | Yes |
| BLAKE3 chunk hashes | R2 manifest | Yes | Yes |
| Cashu credential serial (melted token) | Supabase `spent_tokens` | Yes (serial only, not linked to identity) | Serial only |
| Stripe subscriber email, name, card last 4 | Supabase `subscribers` | Yes | Yes |
| Lightning payment hashes, tier, amount | KV (25h TTL) | Yes | Yes (during TTL window) |
| AES-GCM session key | URL fragment — never transmitted | No | Not held — does not exist on our infrastructure |
| Sender identity (free tier) | Not held | N/A | N/A |
| Recipient identity (any tier) | Not held | N/A | N/A |
| File content in plaintext | Not held | N/A | N/A |

**The one sentence:** the files we store are encrypted noise — a breach of our storage returns ciphertext that is useless without a key we never held.

This is not a claim to prove in a breach. It is the architecture. It holds regardless of what an attacker does to our infrastructure.

**What a full R2 exfiltration exposes:** encrypted blobs, file sizes, chunk counts, timestamps. Nothing a journalist can read. Nothing a court can use to identify the parties to a transfer.

**What a Supabase exfiltration exposes:** Stripe subscriber emails, names, subscription tiers. Lightning payment hashes (not linked to wallet identity). Cashu serials (not linked to any identity). This is the realistic worst case for privacy exposure, and it affects paid tier users who chose identified payment. Free tier users: not held.

**What cannot be exposed by design:** file contents, decryption keys, sender/recipient identities at any tier, which file was sent to whom by whom.

The `honest_metadata.json` file at `refueler.io/_data/honest_metadata.json` already discloses publicly what we can see. A breach that exposes only what we already said we hold is not a cover-up scenario — it confirms the architecture works as documented.

---

## 2. Severity definitions

### S1 — Active or confirmed breach
**Definition:** confirmed exfiltration of user data, cryptographic compromise, active attack on infrastructure, or evidence of unauthorised access to Supabase, R2, KV, or Worker secrets.

**Response target:** acknowledge within 30 minutes of discovery. Public acknowledgement within 2 hours.
**ICO notification:** within 72 hours if any personal data (Stripe subscriber records) is implicated. File what you know — do not wait for full scope.

### S2 — Suspected breach or significant degradation
**Definition:** anomalous access patterns, unexplained KV/R2 behaviour, unverified report from a credible source, or service degradation that cannot be attributed to a known cause within 1 hour.

**Response target:** initial assessment within 1 hour. Public update within 4 hours.
**ICO notification:** hold unless S2 escalates to S1. Document the decision to hold and the reasoning.

### S3 — Operational incident
**Definition:** service unavailability, degraded performance, Worker errors, third-party dependency failure (Blink, Stripe, Cloudflare). No privacy impact. No evidence of breach.

**Response target:** status page update within 30 minutes of confirmed impact. No ICO obligation.

---

## 3. Communication principles

These are drawn from established crisis communication practice — the same principles used by crisis negotiators and organisations that have handled high-stakes public incidents well.

**Acknowledge before you advise.** The first communication is not an explanation — it is confirmation that you know, you are taking it seriously, and you will return with more at a specific time. People in a crisis need to know they are not waiting alone.

**Specific time, not "soon".** Every communication must name the next update time. "We will update at 14:00 UTC" is acceptable. "We will update shortly" is not. Uncertainty about when information will arrive is itself distressing — it compounds the original problem.

**Say what you don't know.** Explicitly. "We do not yet know whether subscriber emails were accessed" is honest and appropriate. "We have found no evidence of..." is lawyerly and damages trust. If you don't know, say you don't know. The ICO expects this.

**Never minimise.** Do not describe a confirmed breach as "a potential security incident." Do not say "may have been accessed" if you know data was accessed. Courts and regulators treat minimising language as evidence of bad faith. Journalists treat it as the story.

**The architecture is the reassurance.** For Share specifically: the honest reassurance in a breach is not "we're working on it" — it is "the files are ciphertext and the key never existed on our servers." Lead with the architecture, not with the apology. The apology is for the distress; the architecture is the actual protection. Keep them separate.

**Silence compounds damage faster than the breach itself.** Every hour of silence is a hour the story is being written by others. A company that goes quiet for 48 hours after a breach loses more trust than the breach itself causes. This is consistently documented — Coldcard 2023, Proton 2021, Bitwarden's handling of the 2023 researcher report.

---

## 4. Channel order

For any S1 or S2 event:

1. **Status page** (`refueler.io/share/status`) — first, always, before anything else. The status page is the canonical source of truth. Every other channel points to it, not the reverse.
2. **Email** — paid tier subscribers (Stripe records). Use Stripe email list. Plain text. No HTML. Arrives from `support@refueler.io`.
3. **SimpleX group** — enterprise clients with dedicated support groups (B9+). Direct, private, before public post.
4. **Public** — a post on `refueler.io` (not social media). Share does not maintain social channels. `refueler.io` is the canonical public destination.

**What is never a channel:** X/Twitter, LinkedIn, Reddit, Hacker News. We do not have accounts on these platforms and we do not create them in a crisis. If a journalist finds the story there, they will find it on our status page first or they will find silence — and silence is worse.

---

## 5. Communication templates

### 5.1 — S1 status page (initial post, within 2 hours)

```
STATUS: [INVESTIGATING / CONFIRMED] — [one sentence, honest, plain English]
Declared: [timestamp UTC]

What we know
[Bullet points. Facts only. Use past tense for confirmed facts, present tense for ongoing investigation.]

What we do not yet know
[Bullet points. Be explicit. "We do not yet know whether X" is correct. "We have found no evidence of Y" is not.]

What we are doing in the next 2 hours
[Specific actions. Named if possible.]

Next update: [specific time UTC — not "as soon as possible"]
```

### 5.2 — S1 subscriber email (same day, after status page post)

Subject: `Security notice — Refueler Share [date]`

```
This is Rajesh Taylor, founder of Refueler Share.

[One sentence: what happened.]

What this means for you: [Plain English. No hedging. If their data was exposed, say so.]

What this does not mean: [The architecture point — keys were never held, file contents cannot be read.]

What we are doing: [Two or three specific actions.]

For updates: refueler.io/share/status — this is the only source of truth. All further updates go there first.

If you have questions: support@refueler.io — it comes directly to me.

Rajesh Taylor
Refueler Share
```

### 5.3 — Free tier notice (status page addition, same post)

```
Free tier users
We cannot notify you individually. We do not hold your identity — no email address, no name, no account. This is by design, and it is relevant here: if our subscriber records were accessed, free tier users are not in them. Your transfers exist as encrypted noise on our servers. The encryption key was in your link. We never held it.
```

### 5.4 — S2 status page (initial post)

```
STATUS: INVESTIGATING — [one sentence describing the anomaly]
Declared: [timestamp UTC]

We have identified [describe anomaly] and are investigating whether this represents a security incident. No breach has been confirmed.

What we are watching: [specifics]
What remains operational: [specifics]

We will update at [specific time UTC] or earlier if the situation changes.
```

### 5.5 — S3 status page (operational incident)

```
STATUS: DEGRADED — [specific service affected]
Started: [timestamp UTC]

[One sentence: what users are seeing. What is affected, what is not.]

We are investigating. Current indication: [third-party dependency / known issue / unknown cause].
Next update: [specific time UTC]
```

---

## 6. UK GDPR Article 33 — obligations and process

**The rule:** a personal data breach must be reported to the ICO within 72 hours of becoming aware of it, unless it is unlikely to result in a risk to the rights and freedoms of individuals.

**What constitutes awareness:** you are "aware" when you have reasonable certainty that a breach has occurred. A security incident under investigation (S2) does not trigger the 72-hour clock. A confirmed breach (S1 with personal data) does.

**Personal data at Share:** Stripe subscriber records (email, name, card last 4, subscription tier) are personal data under UK GDPR. Lightning payment hashes are not directly personal data but may be pseudonymous data depending on what the payer can be identified from. Free tier: no personal data held.

**What to report:** the ICO does not require you to know everything within 72 hours. Report what you know. Explicitly state what is not yet known. The report can be supplemented. The ICO has confirmed this in published guidance.

**How to report:** via the ICO online portal at `ico.org.uk/make-a-report`. This is not a phone call. It is a structured form. Completing it takes approximately 30–45 minutes.

**Information required for the report:**
- Nature of the breach (what happened)
- Categories of personal data involved (email addresses, names, payment data)
- Approximate number of individuals affected
- Likely consequences
- Measures taken or proposed to address the breach
- Contact details for the DPO (in Share's case: Rajesh Taylor, `support@refueler.io`)

**The Share architectural advantage:** if the breach involves only R2 (encrypted chunks) and not Supabase (subscriber records), the ICO threshold may not be met — encrypted data where we do not hold the key is not meaningfully accessible personal data. Document this reasoning explicitly in the breach log (`docs/security-breach.md`) and in any ICO correspondence.

**If the 72-hour window will be missed:** contact the ICO proactively before the deadline. Explain that investigation is ongoing. This is explicitly better than missing the deadline without notice.

---

## 7. Status page incident dashboard — technical spec

### Homepage persistent indicator

A small status widget in the bottom-right corner of `refueler.io/share`. Always visible. Three states:

- **Green** (default): "All systems operational"
- **Amber**: "Service degraded — see status page"
- **Red**: "Active incident — see status page"

Clicking the widget navigates to `/status`. The widget reads the `incident_active` KV key on page load (via `GET /status` JSON response) and refreshes every 60 seconds.

### Status page incident panel

The existing `/status` page gains a dedicated incident panel that renders when `incident_active` is non-null.

**S1 panel:** full-width, `--c-red-bg` background, `--c-red` border. Cannot be dismissed. Auto-refreshes every 60 seconds. Countdown to next update time.

**S2 panel:** full-width, `--c-amber-bg` background, `--c-amber` border. Dismissible after reading (sessionStorage). Auto-refreshes every 60 seconds.

**S3 panel:** standard informational card. SessionStorage dismiss. No auto-refresh beyond the existing 60s page refresh.

### KV schema — `incident_active`

Key: `incident_active` in `STATUS_KV`.

**Active incident value:**
```json
{
  "severity": "S1",
  "declared_at": "2026-08-01T00:00:00Z",
  "updated_at": "2026-08-01T00:30:00Z",
  "summary": "One sentence. Honest. Plain English.",
  "actions": "What we are doing right now. Specific.",
  "next_update": "2026-08-01T02:00:00Z",
  "affected_systems": ["R2", "Supabase"],
  "personal_data_involved": true
}
```

**No active incident:** key does not exist, or value is `null`.

Setting and clearing via extended `POST /admin/status` with `incident` field:
- `{ "incident": { ... } }` — sets active incident
- `{ "incident": null }` — clears (incident resolved)

Existing `STATUS_KV` binding. No new infrastructure required.

### Panel fields rendered

- Severity badge (S1 / S2 / S3)
- Declared timestamp (human-readable, UTC)
- Last updated timestamp
- Summary (one sentence)
- Current actions (freeform text)
- Next update countdown (live, JavaScript)
- Link to this document (for enterprise clients): `refueler.io/docs/incident-response`

---

## 8. Tabletop simulation — run before alpha

The purpose of a tabletop is not to find the right answers. It is to discover which questions you haven't asked yet. Run this as a conversation, not a checklist. Record the answers.

**Scenario:** 02:47 UTC. You receive an email from Cloudflare Security notifying you that your R2 bucket `refueler-share-prod` has been accessed from an IP address not associated with your Cloudflare account. Access logs show bulk object reads over a 40-minute window.

Work through the following:

**Access and control**
- Can you post to the status page from a phone, without the dev laptop? Where is the `ADMIN_KEY`? Is it in 1Password?
- Can you send the subscriber email without access to the Mac? Stripe has a dashboard — is the contact list exportable on mobile?
- Can you rotate the R2 API token from your phone?

**Scope assessment**
- What did they get? R2 contains encrypted chunks only. Manifest files contain file sizes and BLAKE3 hashes. No plaintext. No keys. Document this conclusion before you post anything.
- Was Supabase accessed? Check `subscribers` table for unexpected access via the Supabase dashboard (audit logs). This is the personal data question. It determines whether Article 33 applies.
- Was KV accessed? Lightning payment hashes are in KV with 25h TTL. If the window has passed, they may already be gone.

**Communication sequence**
- Draft the S1 status page post. Time yourself. It should take less than 10 minutes. If it takes longer, the template needs work.
- Identify the Stripe email send path. Practice it once in test mode before you need it.
- Who do you call at Cloudflare? (Answer: Cloudflare Enterprise support is not available on the free plan — the security report goes to `security@cloudflare.com`. Save this address now.)

**ICO notification**
- Open the ICO portal (`ico.org.uk/make-a-report`). Familiarise yourself with the form structure. Do not fill it in now. Know what it asks.
- What is the 72-hour deadline from 02:47 UTC on a Tuesday? Write it down: 02:47 UTC Friday. Set a calendar reminder in the simulation.
- In this scenario, does Article 33 apply? (R2 breach: no personal data in encrypted blobs — probably not. Supabase breach: subscriber emails — yes, within 72 hours.)

**Post-incident**
- What goes in `docs/security-breach.md`? Write the entry now, in the simulation. Every field. The discipline of writing it before you need it reveals gaps.
- What changes to the architecture would prevent this? Write one paragraph. This is the "lessons learned" section of the breach log entry.

**Record the answers.** A simulation that produces a document is worth ten times one that doesn't.

---

## 9. Why a published playbook is a competitive differentiator

The security industry has known for decades that organisations with documented, rehearsed incident response plans sustain less reputational damage from breaches than those without — independent of the severity of the breach itself. The research is consistent. The intuition is simple: a company that has thought about what to do when things go wrong is a company that takes security seriously before things go wrong.

For Share specifically, there is a second-order effect. Publishing this document at `refueler.io/docs/incident-response` signals something that no privacy policy can: that we have considered the worst case, documented it honestly, and built the architecture so that the worst case is less bad than it would be anywhere else. Enterprise clients in procurement diligence will ask for this document. Having it before they ask closes the conversation faster than any feature list.

The most valuable sentence in a breach communication is not "we are deeply sorry." It is "the files are encrypted noise and the key never left your browser." That sentence is only credible if it was true before the breach, documented before the breach, and said without hesitation when the breach occurs. This document is the preparation for saying it without hesitation.

The Coldcard principle: say the hard thing first, say it completely, say it once. Companies that manage bad news by dripping it out over days do not recover. Companies that front-load the bad news with full technical honesty consistently do.

---

*"Nothing stops this train."*
