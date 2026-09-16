# Receiver Page — Design Brief
> **Session:** Ad hoc — no number · 16 September 2026
> **Type:** Thinking session → design brief handoff
> **Status:** Brief complete. Design session to follow.
> **Location:** Lives in `refueler-share/` alongside CLAUDE.md

---

## What this page is

The receiver page is the highest-traffic page in the product. It is also the most likely first encounter with Refueler for anyone who hasn't sought us out. A sender — lawyer, accountant, journalist, photographer, Bitcoiner — chose Share. The receiver arrived because someone they trust sent them a link.

It is not a marketing page. It is a handover.

---

## Who is on this page

**Primary:** Laptop/PC user. Professional context — compliance, legal, financial, creative. Received the link from Signal, WhatsApp, a one-line email, or a printed QR. Has no prior knowledge of Refueler.

**Secondary:** Mobile user. Less likely given the use case, but must be handled. Anyone using a phone for work — reading documents, collecting contracts — should not be punished by the layout.

**Not assumed:** A Bitcoiner. A developer. Anyone who knows what AES-GCM, BLAKE3, or a Cashu token is. The receiver is a normie who came for the file.

**The receiver's only question:** Is this safe to click?

Not "what encryption scheme?" Not "who is Refueler?" Just: is this a scam?

---

## What the page currently gets wrong

1. **Treats the receiver as already sold.** No orientation, no legitimacy signal, no explanation of what is happening.
2. **Privacy story absent.** The architecture is genuinely extraordinary but completely invisible.
3. **No exit ramp.** First-time visitors have nowhere for curiosity to go. No article link, no product introduction, nothing.
4. **No arrival moment.** Static page. The receiver is plonked rather than welcomed.

---

## What the page must do — in order

1. Signal legitimacy in the first five seconds. Real service. Professional. Someone you trust chose this.
2. Show the receiver what they're collecting — file name, size, expiry — before asking them to act.
3. Let them collect. Simply, without friction.
4. Carry the privacy positioning through *behaviour and absence*, not explanation.
5. Offer an exit ramp for the curious — one article link, nothing more.
6. Introduce the platform quietly, after collection.

---

## Copy decisions

### The one privacy line
> **"No account. No list. No tracking."**

Three words, three times. Plain English. Placed beneath the collect action, small. Normie-legible. Not technical. Not alarming.

Do NOT use on this page:
- "encrypted" — will alarm non-technical users
- "key" — implies complexity, implies they need to know something
- "server" — jargon
- "zero-knowledge" — banned per BRIDGE
- "military-grade" — banned per BRIDGE
- "sealed in your browser" — confuses normies (the sender sealed it, not their browser)
- "key never left your device" — will lose them
- "nothing about you left with it" — alarming to someone who just wanted their photos

### Permitted vocabulary (locked registry)
- **Collect / Collection** — replaces "download"
- **Sealed / Under seal** — permitted and legible. "An envelope, already sealed." Normies understand this.
- **Lodged** — sender context only, does not appear on receiver page
- **Refueler** — always full name on first use

### Success state copy
> **"Collected."**

Full stop. File name beneath, greyed out, mono. That is all.

Below that, in the quiet zone:
- Article link (subpoena piece)
- *"Refueler — privacy infrastructure, London."* One line. One link to refueler.io.

### What does NOT appear on the receiver page
- Signup prompt
- Email capture
- Cookie banner (confirm legal position — absence is the statement)
- Pricing
- Feature grid
- Competitor comparisons (those live in the article)
- Explanation of the cryptographic architecture

---

## Visual direction

### Primary reference: Jaeger-LeCoultre
Not aesthetic decoration. A working reference for three things:

**1. Motion that earns its place.**
JLC shows the movement working because the work is beautiful. The tourbillon solves gravity's effect on the escapement. On the receiver page: every element that moves does so because it means something. Metadata resolves line by line — name, size, expiry — as if being placed on a desk. The collect button appears after. Nothing animates that doesn't have a function.

**2. Typography as precision instrument.**
JLC dial numerals are not styled — they are exact. IBM Plex Mono carries this on the receiver page. File size, expiry timestamp: measurements, not labels. Treat them as such.

**3. Restraint as the luxury signal.**
Enormous space. One object. Nothing competing. The receiver page is Paper (#E8E2D8), generous whitespace, one action at a time.

### Secondary reference: Victorian Thames / Assassin's Creed London
Cannot use Ubisoft artwork (copyright). The *feeling* is the reference:
- Pre-dawn Thames light — bruised gold-grey, gas lamps still lit, sky beginning
- Atmospheric depth — city receding into mist
- A figure who moves through the city without being noticed
- Stone, water, timber. Materials that have been here longer than any of us.

This is the world the product lives in. Not a fintech aesthetic. Not a SaaS gradient. London, before you had to identify yourself to use it.

### Photography direction (Rajesh to shoot)
Not a briefcase. Not a padlock. Those are generic.

Options, in order of preference:
1. **A wax seal on correspondence paper** — closed, already sealed, the transaction complete. Shot at f/1.4. Morning light. The vocabulary is already locked: *Under seal.*
2. **The Thames at low tide, early morning, no people.** Wide. Contemplative. The city before the noise.
3. **A sealed envelope in a hand** — already delivered. You are the recipient. Here it is.
4. **Aged London stone** — a threshold, a keystone, a step worn smooth.

One image. Not decorative. The image *is* the brand statement.

### Illustration alternative
If photography isn't right for the receiver page specifically — the complication diagram. In the JLC style: a technical drawing of the transfer mechanism. Not a flowchart. An engineering drawing. Sender → sealed → conduit → receiver. Each stage labelled in mono. Quiet. Certain. The architecture made visible without explaining it.

---

## Motion specification

**Arrival sequence (one-time, on page load):**
1. File metadata resolves, line by line. Name. Size. Expiry. Small delay between each — 150–200ms. Like a document being unfolded.
2. A quiet mark — the seal, or the Refueler wordmark — settles into position. Animates once. Static from that point.
3. The collect button appears. Not before the metadata is complete.

**Nothing loops.** Nothing pulses. Nothing draws attention to itself after the arrival sequence is complete.

**During collection:** a progress indicator that feels like a measurement, not a loading bar. Mono numerals. Percentage or MB transferred. Clinical. Exact.

**On completion:** "Collected." appears. Clean. No confetti. No celebration. The job is done.

---

## Page structure (laptop/PC first)

```
[HEADER — Refueler wordmark + theme toggle. No nav.]

[ARRIVAL ZONE]
  File name           [mono, resolves first]
  Size · Expiry       [mono, resolves second]

[COLLECT ACTION]
  [ Collect ]         [single button, appears after metadata]
  No account. No list. No tracking.   [small, beneath]

[QUIET ZONE — visible on scroll or after collection]
  [Article link: "What a subpoena gets from seven file transfer services"]
  Refueler — privacy infrastructure, London.   [link to refueler.io]

[FOOTER]
  Share · Legend · Pass   [one-line descriptors, quiet]
  © Refueler · London
```

---

## Product suite introduction

**On receiver page:** one line, success state only.
> *"Refueler — privacy infrastructure, London."*

**Legend cross-sell:** deferred until Legend is live. Post-collection, conditional on file type. Not now.

**Footer navigation:** Share · Legend · Pass — quiet, always present, no descriptors needed on the receiver page specifically.

---

## Competitive context (for the article, not the page)

Smash collects on every receiver:
- IP address
- Browser name and version
- Operating system
- Location and language
- Email address (if link sent via Smash)
- Retained for 1 year

Dropbox shares receiver data with: OpenAI, Oracle, Salesforce, FullContact, Google, and 17 others. Runs ML on file contents. Retains deleted files for 30–365 days depending on plan.

Share: server sees chunk hashes and timestamps. Key never transmitted (URL fragment). Download credential is a Cashu blind token — server cannot link it to sender or receiver.

**This comparison belongs in the subpoena article, not the receiver page.**
The receiver page simply doesn't do the thing. "No account. No list. No tracking." is the entire statement.

Article: https://refueler.io/notes/what-a-subpoena-gets/

---

## The honest sell problem

Nobody on the planet knows Refueler. The market is dominated by services people default to out of habit (WeTransfer, Dropbox) or corporate mandate. Bending Spoons is consolidating the consumer end. Nobody is buying on privacy — they're buying on familiarity.

**The receiver page cannot solve this alone.** What it can do:

1. Not embarrass the sender. The sender chose Share for a reason. The page must honour that choice by behaving exactly as the sender expected it to.
2. Make one person curious. If one in fifty receivers clicks the article link and reads it, that's one person who might become a sender.
3. Build the long institutional case. The page, the article, the design — together they signal: this is a real service run by someone who takes this seriously. That signal accumulates. It is not a growth hack. It is a reputation being built.

**Re: Jason Lopp / WBD / browser security:** He's right that browsers are a weak point relative to native apps. This is an honest constraint, not a fatal one. Share's browser-based architecture is a deliberate trade-off: accessibility over maximum hardness. OnionShare is harder. Share is usable by the normie receiver without installing anything. That positioning is locked: "one step short of OnionShare, deliberately." The whitepaper (B9) addresses the threat model honestly. Until then, don't argue with Lopp — agree with him and state the trade-off plainly.

**Re: Bitcoiners not trusting browsers:** This cohort is not the receiver. They may be the sender — and a sender who understands the trade-off and chose Share anyway is making an informed, deliberate choice. That's a stronger endorsement than an uninformed one.

---

## Claude Design session scope

When the design session opens, the brief above is the input. The session should produce:

1. Full receiver page HTML/CSS in the existing design system
2. Paper default, Carbon toggle
3. JLC-inspired arrival motion (CSS animation, no JS libraries)
4. IBM Plex Mono for all data display
5. Single photography/illustration placeholder — correctly proportioned for the wax seal direction
6. Mobile layout (functional, not primary)
7. Success state with "Collected." and quiet zone
8. Two links: subpoena article + refueler.io

**Not in scope for the design session:**
- Legend cross-sell
- Account/signup flows
- Tier-gated receiver experiences (future)
- The photography itself (Rajesh shoots separately)

---

## Open questions for founder decision before design session

1. **Cookie banner:** Is Share's architecture legally defensible without one, given we log chunk hashes and timestamps? Confirm with solicitor before removing entirely.
2. **Photography vs. typographic:** Does the receiver page carry a photograph, or is it purely typographic? Decision affects the design session scope.
3. **The seal mark:** Does Refueler have or want a standalone mark (not the wordmark) — something that could appear as the arrival emblem? A wax seal as the logo element would be extraordinarily on-brand.
4. **"London" in the footer:** One word. Implies jurisdiction, permanence, accountability. Confirm this is the right signal given legal entity status.

---

*Brief compiled: 16 September 2026. Session: ad hoc, unnumbered.*
*Next: Design session — receiver page build.*
