# notes-articles-list.md — refueler.io /notes/ pipeline
> **Version:** 1.0 | **Created:** AP-1 · 29 July 2026
> Editorial planning document. Lives in `refueler-share/` alongside CLAUDE.md and TESTING.md.
> Load when in an editorial planning or article build session. Not by default.
> Publishing platform: `refueler.io/notes/` (main domain, not share subdomain).

---

## Editorial conventions

**Byline:** Rajesh Taylor (personal, named). Not "Refueler" or "The Refueler Team."
**Voice:** Notes = Refueler brand voice with personal register bleeding through. Editorial = pure brand voice. The distinction matters.
**Register:** Authoritative but readable. Not academic. Not marketing. A named founder who knows what they're talking about and isn't pretending to be a committee.
**Typography:** Source Serif 4 body. IBM Plex Mono for data, tables, and inline technical strings. Paper/Carbon tokens throughout — same design system as Share.
**Table styling:** All table columns carry the same font weight and colour. No lighter secondary-text treatment on any column. If it's in the table, it has the same authority as the rest of the table.
**CTAs:** Each article earns its own ending. No standard template. No hard sell.
**honest_metadata.json:** Lives in `src/_data/` in the refueler-io repo. Referenced by published URL from the B9 whitepaper (not as a file import). Single source of truth for what Refueler stores and doesn't.

---

## What this file is not

Not a content calendar. Not a publishing schedule. No artificial deadlines.
Articles publish when they're ready and when there's something honest to say.
The btc++ Berlin window (October 2026) is a soft prompt for articles 4 and 6,
not a deadline. Developers at the conference will find the repo and the site —
the articles are context, not a campaign.

---

## Article 1 — What a subpoena gets from seven file transfer services
**Status:** Live — iteration pending (give it a week from 29 Jul before touching)
**Audience:** Lawyers, journalists, accountants
**Product dependency:** None
**SEO targets:** "file transfer privacy", "secure file transfer lawyers", "file transfer subpoena"

**Iteration decisions locked (do not action until week of 5 Aug):**
- Split the large table into two passes: (1) seven services — jurisdiction + what can be compelled, short; (2) breathing paragraph ("what these services have in common is not malice, it's architecture"); (3) Refueler honest-metadata table as contrast and resolution. Eyes need room between data bursts.
- All table columns: same font, same weight, same colour. Remove shy right-column secondary treatment.
- Add founder-voice closing paragraph — one or two sentences, first person, that don't feel like marketing.
- Prose lead before the first table: establish the question ("what does a legal notice to a file transfer provider actually return?") before the data appears.

**Outreach hooks:**
- Cold DM to legal journalists with the published URL
- Susie (Bitcoin Policy UK) — forward to press freedom contacts
- The article that opens the conversation, not the one that closes it

---

## Article 2 — Why your client's files don't belong in your inbox
**Status:** Planned — structure locked AP-1
**Audience:** Solicitors, barristers, accountants, financial advisers
**Product dependency:** None — publish before B7
**SEO targets:** "secure file transfer solicitors", "client documents email GDPR", "file transfer legal duty"
**Length:** ~1,100 words. Pure prose, no tables. Slightly warmer register than article 1.

**Structure:**
1. Open with a concrete scenario: a client emails their solicitor 3 years of bank statements. Where do those files live? (Gmail, Microsoft — US cloud, CLOUD Act jurisdiction.)
2. What the professional's duty actually says — GDPR Article 32, SRA/ICAEW data security obligations. Precise, not alarmist.
3. The invisible metadata: email headers, access timestamps, IP logs — what an email server knows that an encrypted transfer service doesn't.
4. The specific risk: not "your email gets hacked" (FUD) but "the platform holding your client's documents receives a US federal request and has 0 days to notify you."
5. What "secure file transfer" actually needs to mean — and what most services still get wrong (server can read it).
6. CTA: own ending, earned.

**Outreach hooks:**
- Send to BHODL co-founder (lawyer + Bitcoiner) for feedback before publishing — opens the relationship
- Susie can forward the journalist version of the same risk (nearly identical audience concern)
- The article that earns the right to ask for introductions

---

## Article 3 — The metadata your file transfer service keeps (and what it's worth to someone else)
**Status:** Planned — structure locked AP-1
**Audience:** General professional — anyone who's used WeTransfer, Dropbox Transfer, Google Drive share links
**Product dependency:** None — publish any time after /notes/ section exists
**SEO targets:** "file transfer metadata privacy", "WeTransfer privacy", "what does file transfer service collect"
**Length:** ~900 words + honest-metadata table

**Structure:**
1. Define what metadata a file transfer service collects in plain English: sender IP, recipient IP, file size, file name, access timestamps, browser fingerprint, referring URL, download count.
2. Major services one by one — WeTransfer, Google, Dropbox: what their privacy policies actually say they collect and what they reserve the right to do with it. Cite and link policies. Dry, precise, no editorialising.
3. "What is this data worth?" — not hypothetically. The ad-tech ecosystem for B2B data. The value of knowing which law firm sent files to which client on what date.
4. Contrast: the honest-metadata table for Refueler (from honest_metadata.json). Sizes and timing are visible, published voluntarily. Everything else is architectural impossibility, not a policy choice.
5. Short close: the difference between a privacy policy and a privacy architecture. Founder voice.

**Note:** honest_metadata.json is the source for the embedded table. Keep that file updated — the whitepaper also pulls from it. One update, both surfaces stay current.

**Outreach hooks:**
- Widest audience of the pipeline — most shareable on LinkedIn
- The article people forward without being asked

---

## Article 4 — The difference between a secure server and a blind one
**Status:** Planned — structure locked AP-1
**Audience:** Technical-adjacent professionals — IT manager at a small law firm, freelance developer at a creative agency, technically curious CFO
**Product dependency:** None
**SEO targets:** "client-side encryption file transfer", "zero-knowledge file transfer explained", "what is end-to-end encryption file transfer"
**Length:** ~1,200 words. The analogy needs room.

**Structure:**
1. Two analogies running in parallel throughout: secure safety deposit box (bank staff *could* open it if compelled) vs a box where only you hold the key and no copy was ever issued.
2. How most "secure" file transfer services work: TLS in transit, AES at rest, server holds the key. What a legal notice to the provider actually returns.
3. How a blind server works: client-side encryption before upload, key lives in the URL fragment. Explain the fragment without jargon — "the bit after the # symbol in a link is never sent to a web server, by design, since 1994."
4. The Refueler model: what we store (encrypted noise + sizes/timestamps), what we can't hand over (plaintexts, keys, identities), why.
5. One paragraph on the remaining caveat — we see sizes and timing. Honest.
6. CTA: own ending, earned. Link to share.refueler.io.

**Note:** This is the conceptual centrepiece of the series. Everything else orbits it. Also the btc++ Berlin warm-up article — technical developers at the conference should have seen it or been linked to it before October.

**Outreach hooks:**
- Link from any btc++ Berlin abstract or talk materials
- The article that rewards readers who've been following the series

---

## Article 5 — Jurisdiction is not architecture: what Swiss privacy laws actually protect
**Status:** Planned — structure locked AP-1
**Audience:** Compliance professionals, legal buyers who've seen "Swiss hosting" used as a selling point
**Product dependency:** None
**SEO targets:** "Swiss file transfer privacy", "Swiss hosting privacy law", "nDSG file transfer"
**Length:** ~1,000 words + one table (four-quadrant: threat model × jurisdiction × architecture)

**Structure:**
1. What Swiss privacy law actually provides — nDSG/FADP summary, genuine strengths vs GDPR. Precise, not dismissive.
2. The compelled production question: even under Swiss law, a provider with access to plaintexts can be compelled to produce them. The threshold is higher; it is not zero.
3. The jurisdiction vs architecture distinction: if the server is blind, the jurisdiction question becomes almost academic — there's nothing to compel. If the server isn't blind, jurisdiction is the only protection.
4. Refueler's position: UK-incorporated, Cloudflare edge globally. Architectural blindness is the pitch, not Swiss jurisdiction. Honest that jurisdiction matters at the margins.
5. Four-quadrant table: threat model × jurisdiction × architecture. Readers place themselves.
6. CTA: own ending, earned.

**Outreach hooks:**
- Target compliance-focused Twitter/LinkedIn accounts
- The article that earns credibility with buyers who've been sold "Swiss" as a feature

---

## Article 6 — Why we built an anonymous payment option for a file transfer tool
**Status:** Planned — unlocks after B7 Lightning live
**Audience:** Bitcoin-adjacent professionals, privacy-curious, btc++ Berlin follow-up readers
**Product dependency:** **B7 Lightning must be live before publishing**
**SEO targets:** "Cashu blind signatures", "anonymous file transfer", "privacy file transfer Bitcoin"
**Length:** ~1,000 words. Minimal jargon — explain Cashu as you go. No maths.
**Source material:** M-01 + M-02 Cashu differentiator paragraph (ARCHITECTURAL-INSPIRATION.md). Cashu whitepaper paragraph drafted verbatim — copy directly into draft.
**Note:** "Pseudonymous is not unlinkable" is the central line. Keypair auth (Nostr/Blossom) is pseudonymous; Cashu blind signatures are unlinkable. This is the structural differentiator — rehearse it before Berlin.

**Outreach hooks:**
- Post to Bitcoin Twitter on publish
- btc++ Berlin follow-up article — link from any conference materials

---

## Article 7 — What journalists need from a file transfer tool that most of them don't have
**Status:** Planned — needs Susie introduction before drafting
**Audience:** Journalists, press freedom organisations
**Product dependency:** None
**Note:** Do not draft before Susie conversation — her input shapes the angle. She knows what journalists actually worry about vs what they think they worry about.

**Outreach hooks:**
- Susie → press freedom org contacts → first meaningful inbound links to the site
- The article that builds the audience, not just converts it

---

## Article 8 — The file transfer risk your professional indemnity insurer hasn't thought about yet
**Status:** Planned — unlocks after API planning sessions (AP-2/AP-3) complete
**Audience:** Solicitors, accountants
**Product dependency:** API planning complete
**Note:** Highest B2B conversion value in the pipeline. The article that makes the phone ring.

---

## Article 9 — What happens to your files after the link expires
**Status:** Planned
**Audience:** General, SEO long tail
**Product dependency:** None
**Note:** Explain R2 lifecycle rules, 24h post-expiry deletion, what "expired" actually means technically. Reassuring and precise.

---

## Article 10 — A freelance video editor's month with an anonymous file transfer tool
**Status:** Planned — publish last
**Audience:** Creative industry
**Product dependency:** Real user with sufficient usage history acquired
**Note:** Case study. Needs a willing subject with enough transfers to tell a real story. Publishes at or after alpha.

---

## Articles 11 and 12 — API/white-label
**Status:** Planned — unlock after AP-2 and AP-3 complete and API is built
**11:** API/white-label for professional services — IT decision-makers, practice managers
**12:** API technical integration guide (notes register, not docs) — developers at law firms/agencies

---

## Full pipeline at a glance

| # | Title (short) | Publish order | Dependency | Outreach hook |
|---|--------------|---------------|------------|---------------|
| 1 | Subpoena table | 1st | None | Legal journalists. Susie forward. |
| 2 | Client files / inbox | 2nd | None | BHODL feedback. Susie journalist angle. |
| 3 | Metadata value | 3rd | None | LinkedIn — widest reach |
| 4 | Blind vs secure server | 4th | None | btc++ Berlin warm-up |
| 5 | Jurisdiction vs architecture | 5th | None | Compliance Twitter/LinkedIn |
| 6 | Anonymous payment option | After B7 live | B7 Lightning | Bitcoin Twitter. btc++ follow-up. |
| 7 | Journalists and file transfer | Flexible | Susie intro first | Press freedom orgs → inbound links |
| 8 | PI insurer risk | After AP-2/AP-3 | API planning | Highest B2B conversion |
| 9 | After the link expires | Anytime | None | SEO long tail |
| 10 | Case study (video editor) | Last | Real user + history | Social proof — alpha |
| 11 | API / white-label notes | After API built | AP-2/AP-3 + build | IT decision-makers |
| 12 | API technical integration | After API built | AP-2/AP-3 + build | Developers at firms |

---

## Key contacts

- **Susie** — Bitcoin Policy UK. Article 7 angle / journalist introductions. Met at London + Essex meetups. Don't approach until article 2 is live and the site has something to show.
- **BHODL co-founder** — lawyer + Bitcoiner. Article 2 feedback reader. Potential case study subject for article 10. Met at meetup.

---

*"Nothing stops this train."*
