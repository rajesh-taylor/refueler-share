# Share-Brand-Terminology — refueler-share
> **Session:** Share-Brand-Opus-1 · **Date:** 11 Sep 2026 · **Version:** 1.1 (locked — all decisions confirmed)
> Pin alongside `Share-Master-Context.md`, `CLAUDE.md`, `share-sessions.md`.
> Supersedes the S90 line *"Citizen (free). Sovereign (paid)."* — see §7 hazard.

---

## 0. The decision, in one line

| Slot | Locked name | Rail | Payment |
|------|-------------|------|---------|
| Free | **Pro Bono** ✓ | — | Public good |
| Paid, identity | **Citizen** ✓ | **Registered** ✓ | Stripe (GBP) |
| Paid, anonymous | **Sovereign** ✓ | **Bearer** ✓ | Lightning (sats) |
| Commercial / API | **Chartered** ✓ | Registered or Bearer | Stripe / invoice or Lightning |

Rails, user-facing: **Registered** (identity) and **Bearer** (anonymous).

The two paid tiers are the **same price and the same feature set**. They differ only in rail — in *how you appear*. That is the point, not a footnote.

---

## 1. Tier names & the structural decision

### The structural call: split the paid tier by rail, not by feature.

The current model is one paid tier (Sovereign) with two rails hidden inside it as a payment toggle. That buries the single most important decision your customer makes. For a privacy product sold to lawyers and financiers, the identity posture *is* the product — the storage limits and expiry windows are commodity. Naming the rails as tiers turns a payment-method toggle into a first-class, dignified choice: *how do you wish to appear on this transfer?*

So the paid tier splits into two named postures at identical price and features. On the pricing page they are not a ladder — Sovereign is not "more" than Citizen. They are a **binary**: named, or no one. Present them side by side under a heading like *"Choose how you appear,"* never stacked as tiers ascending in value.

### Pro Bono — the free tier *(recommended; alt: Commoner)*

Names the *act of provision*, not the recipient. Refueler provides the free tier **pro bono publico** — for the public good — and says so in the target market's own dignified Latin. It carries none of Welfare's stigma (see §4), it puts the nobility on the giver's side, and it keeps the unapologetic, anti-aspirational energy you were reaching for. Being on the Pro Bono tier does not say *you are poor*; it says *this is our contribution to the commons, and you are welcome to it.* In law, pro bono is associated with principle and access, not charity received — exactly the reframe you want.

- **Alternative: Commoner.** Choose this if a perfectly parallel four-part civic set matters more than the legal in-joke. *Commoner → Citizen → Sovereign* is a clean, honest hierarchy, and — crucially — in British constitutional usage "commoner" is not an insult: the Commons is where power sits, the PM is a commoner, Churchill was a commoner. It defuses the demeaning read on its own terms. It is universal English where Pro Bono is legal-specific.
- **Criterion:** lead **Pro Bono** for audience-native dignity and for honouring the instinct behind "Welfare." Switch to **Commoner** if you want the set to read as one unbroken vocabulary.

### Citizen — identity-rail paid (Registered)

The best word in the set, and it lands on the right tier. A citizen has **declared themselves**: named, on the electoral roll, accountable, holding rights *and* obligations. That is the identity rail precisely — an email, an invoice, a billing relationship your customer's compliance team is content to whitelist. The solicitor billing through the firm is a Citizen: they need a paper trail, and Citizen gives them one without apology.

### Sovereign — anonymous-rail paid (Bearer)

Self-ruling, self-custodied, answerable to no one, beyond the register. The Bitcoin canon is explicit here — *The Sovereign Individual* is foundational cypherpunk text — and the gold **Sovereign** coin gives it a hard-money, City-of-London second meaning that the fiat rail can never claim. This is the fullest expression of the product's mission: the whole system exists to make anonymous encrypted transfer possible, and Sovereign is what that looks like when someone chooses it. Citizen is the pragmatic, accountable posture; Sovereign is the true north. Different, not better — but Sovereign is the one that is *most the product.*

### Chartered — commercial / API ✓

**Chartered** is a status, not a document. "A Charter" is a piece of paper; "Chartered" is what you *are* — Chartered Accountant, Chartered Surveyor, Chartered Engineer. Your buyers hold Chartered designations. The word describes what they are, and now it describes what their API relationship is. It also reads as an adjective modifying their access: they are a Chartered operator of Refueler Share. Decisively stronger than the noun form.

A charter is also a formal grant of commercial rights under terms — rate card, HMAC credentials, defined counterparty — so both readings land simultaneously for a careful reader. The City was *built* on chartered companies. It sits as the commercial estate beside the three civic statuses.

- **Rejected: Merchant.** Interferes with the Merchant liberty product and the Merchant app/project. Do not use in the Share tier set.
- **Rejected: Freeman.** Thematically perfect — Freedom of the City was historically the right to trade — but collides fatally with the *free* tier. Do not use it.

---

## 2. Rail names (user-facing)

Internal architecture names stay *identity rail* / *anonymous rail*. User-facing, use the financial-instruments pair the City already knows:

| Rail | User-facing name | Why |
|------|------------------|-----|
| Identity (Stripe) | **Registered** | A registered instrument has a named owner on a register. Maps exactly to the Stripe/Supabase row — you are on the register. |
| Anonymous (Lightning) | **Bearer** | A bearer instrument (bearer bond, bearer share) is owned by whoever holds it, no registered owner. Maps exactly to bearer Cashu tokens held locally — the server cannot see the holder or the balance. Your own README already says "bearer Cashu tokens." |

This pair is precise, native to the audience, and self-explaining. On the **Citizen** and **Sovereign** tiers the rail is baked into the tier name, so you rarely say it aloud. You need it chiefly on **Chartered**, where a firm chooses its posture: *"Chartered · Registered"* or *"Chartered · Bearer."*

Mapping, for the record: **Citizen = the Registered posture, personified. Sovereign = the Bearer posture, personified.** Tiers are the *identity*; rails are the *mechanism*.

---

## 3. Vocabulary set — the London register

Use sparingly. The register is a seasoning, not a costume; one well-placed word beats five. Every term below earns its place by being both accurate *and* native to the City/legal/mercantile voice.

| Term | Register | Use for |
|------|----------|---------|
| **Lodge / Lodged** | Court registry | Upload. *"Lodge a transfer."* Documents are lodged, not uploaded. |
| **Collect / Collection** | Legal / postal | Download. Already your word ("collection receipts") — reinforce it everywhere over "download." |
| **Sealed / Under seal** | Legal instruments | An encrypted transfer. *"Sealed in your browser."* |
| **Struck off** | Roll of solicitors | Destroy-after-download / deletion. *"Struck off after collection."* |
| **In camera** | Court procedure | A private / anonymous transfer. Latin, dignified, unmistakably about closed doors. |
| **Bearer** | Bearer instruments | The anonymous credential / token. See §2. |
| **On the register** | Company / land registry | The identity posture. *"You are on the register."* |
| **Chambers** | Inns of Court | The account / dashboard area. *"Your Chambers."* |
| **Enrolment** | Solicitors' roll | Onboarding. You enrol; you are not "signed up." |
| **By hand** | Discreet delivery | No-intermediary, no-trace framing. *"Delivered by hand"* — no courier, no record. |
| **Freehold / Leasehold** | Property | Permanent record = *freehold* (held for good); an expiring transfer = *leasehold* (time-limited). A quietly perfect metaphor for the OTS feature vs the expiry window. |
| **Conduit** | City waterworks / law | The blind relay. The Worker is a *conduit* — and the old City conduits were a free public good, which rhymes with the Pro Bono tier. |
| **At your discretion / Discretion** | The City runs on it | Settings, privacy choices, the tone of the whole thing. |

---

## 4. "Welfare Queen" / "Welfare" — the honest verdict

**"Welfare Queen": no, unreservedly.** It is a loaded American political slur — Reagan-era, racially coded, misogynistic in origin. On a UK pricing page it reads as imported culture-war vocabulary, and it will become the single most-screenshotted thing about the product, in the worst way. No partner at a Magic Circle firm selects a tier called Welfare Queen; no bank's compliance officer whitelists it. It fails at the exact audience you cannot afford to lose.

**"Welfare" alone: also no, for this audience.** In British English, welfare *is* the benefits system — the DWP, Universal Credit, dependency, the state. Your buyer does not want the association, and — the deeper flaw — your free-tier user and your paying customer are the *same person* at different moments. The barrister who tries the free tier before their firm pays should never have been briefly filed under "welfare." The name puts the stigma on the *taker*. Good free-tier naming puts the nobility on the *giver*.

**But the instinct is right, and worth keeping.** Blunt, unapologetic, public-good, anti-aspiration, refusing the freemium gloss — that is the correct posture for this tier, and it is rare that a founder reaches for it. The fix is not to soften the instinct but to *land* it: **Pro Bono** is the same sentiment — *for the public good*, freely given, unashamed — in the audience's own dignified Latin, with the stigma removed and the nobility on the right side of the transaction. **Commoner** is the alternative that keeps the bluntness inside a clean civic set. Either honours what "Welfare" was reaching for; neither carries its cost.

---

## 5. Product voice — the editorial invariant

> Refueler Share writes the way the City speaks: plainly, in the active voice, with nothing wasted and nothing oversold. It states architecture as fact and lets the reader draw the conclusion — it never argues that privacy is good, it simply arranges matters so that betrayal is impossible and says so once. It assumes an intelligent reader handling serious matters and never talks down to them. It reaches for the legal and mercantile register of London — *lodge, collect, sealed, on the register, by hand* — before the vocabulary of software. It never says *users, seamless, powerful, revolutionary,* or *trust us*; it never exclaims; it never flatters; it never uses American English. Its wit is dry, brief, and spent at most once a page. What it always implies, and never states outright: you are in careful hands, the arrangements are permanent, and we have built things so that even we cannot let you down.

This paragraph is the reference for every future copy session. When a line of copy is in doubt, it is measured against this.

---

## 6. Updated tier table (drop into README.md)

Replace the current **Tiers** table with:

```markdown
| Tier | Storage | Expiry | Rail | Payment |
|------|---------|--------|------|---------|
| **Pro Bono** | 4 GB | 7 days | — | Public good |
| **Citizen** | 100 GB | 1 / 7 / 30 / 90 days | Registered | Stripe — GBP |
| **Sovereign** | 100 GB | 1 / 7 / 30 / 90 days | Bearer | Lightning — sats |
| **Chartered** | 250 GB + pay-per-GB overage | 90 days | Registered or Bearer | Stripe / invoice, or Lightning |

**Citizen and Sovereign are the same product at the same price.** They differ only in rail —
whether you appear on the register (Registered) or hold your access as a bearer credential with
no identity at any layer (Bearer). The rail is a privacy choice, declared at onboarding, not a
tier upgrade.
```

---

## 7. Migration checklist — every surface, and one hazard to respect first

### ⚠️ The hazard: this is a *reassignment*, not an addition.

Two live words change meaning. Naive find-and-replace will corrupt logic and copy alike:

- **Citizen** flips: *free* → *identity-rail paid.* Every current `tier === 'citizen'` check today gates the **free** tier. After the rename the *word* means paid — so any stale check reasoning by name becomes catastrophically wrong.
- **Sovereign** narrows: *all paid* → *anonymous-rail paid only.* Every current *"Sovereign tier only"* actually means *"any paid tier."* Permanent record and the availability window are gated by **paid-vs-free**, not by rail — so those references must become *"Citizen and Sovereign"* / *"paid tiers,"* **not** rewritten to mean anonymous-only.

**Recommendation for the implementing code session:** decouple **display names** from **logic keys**. Introduce stable internal enum values divorced from the display words — e.g. `free`, `paid_registered`, `paid_bearer`, `chartered` — and drive all UI text through a display-name map. Change display strings freely; never let the Citizen/Sovereign reassignment touch tier-gating logic. This neutralises the whole hazard in one architectural move.

### The surfaces

1. **README.md** — the Tiers table (§6); *and* every prose mention. Re-examine each "Sovereign"/"Citizen": the permanent-record and availability-window lines ("Sovereign subscribers…", "Sovereign tier only") describe **paid-vs-free** gating → *"Citizen and Sovereign"* / *"paid tiers."* The Security table's "Citizen tier" (free) → **Pro Bono**. The Build Status prose.
2. **Worker tier constants** (`worker/src/index.js`, any constants module) — tier strings, gating logic, storage/expiry limits by tier, the `personal_api` plan string. Apply the decouple recommendation above. The 426 tests reference tier names — update fixtures in lockstep.
3. **Stripe** — Product *display name* ("Sovereign", `prod_Urre2e3PQgr5Uq`) and price *nicknames* shown on invoices/receipts/portal. **Rename display names only.** Do **not** touch price IDs or lookup keys (`share-max-monthly` etc.) — they are tier-neutral and load-bearing. Note the new split: the identity rail's paid product is now **Citizen**; **Sovereign** is the Lightning/Bearer posture (off-Stripe), so the Stripe product arguably renames to **Citizen**, not Sovereign. Confirm before changing.
4. **Supabase** — `subscribers.tier` stored *values*. Prefer keeping stored enum values stable behind the decoupled keys; if you must rename, it is a migration, not an edit. RLS deny-all is unaffected.
5. **Admin ops dashboard** — every tier label in `/admin` surfaces, AE metric groupings, subscriber tier display.
6. **Harbourmaster client dashboard** — tier / plan labels, the onboarding **rail-selection** copy (now *Registered* vs *Bearer*), credential and plan display.
7. **User-facing frontend copy** — pricing page (`upgrade.html`), onboarding / rail selection, tier badges, buttons, empty states, receipt copy, the portal redirect page. Templates in `refueler-io/src/share/` (`.njk`) and copy in `refueler-share/frontend/` — remember the sync direction and `bin/sync-share.sh`; never edit the generated `refueler.io/src/share/assets/`.
8. **MCP capabilities** — `refueler_capabilities` payload (tier / plan fields), the `personal_api` plan name, rate-card copy, and tool descriptions that name tiers.
9. **Context docs** — `Share-Master-Context.md`, `REFUELER-BRIDGE.md`, `CLAUDE.md`, `share-sessions.md`. Update the tier vocabulary and retire the stale S90 line *"Citizen (free). Sovereign (paid)."* so no future session inherits the old meanings.
10. **Feature-gating copy** — every *"Sovereign tier only"* on permanent record / availability window → *"Citizen and Sovereign"* / *"paid tiers"* (see hazard). This is the item most likely to be got wrong by mechanical replacement.

---

*"The register knows some. The rest went by hand."*
