# Share design theory — v1

> **Part 1 of 2** · Design-Theory-Opus-1 · 13 Oct 2026 · **Proposals only — nothing here is locked until Rajesh agrees it section by section.**
> Part 2 (Design-Theory-Opus-2) appends: motion, haptics, components, the stage chip, the Account / rail indicator, the A/B test plan.
> Built for X5-1: Share's standalone layout at `share.refueler.io` is built once, to these rules.
> Specimen: `dev/share-harness/specimen/` — `python3 -m http.server 8093 --directory dev/share-harness/specimen`, then http://localhost:8093/ in Safari (Carbon / Paper at the top right). Launch config `design-specimen`.

**Aim.** Share should feel unlike every other file-transfer service: no ads, no upsell banners, no juvenile colour. Calm, precise, watchmaker-grade — a well-made instrument that does one thing and says little about it.

**Sources.** Token source `refueler.io/src/assets/css/global.css` (DESIGN-TOKENS.md is stale). Live CSS `frontend/share.css`. Mocks `docs/drafts/share-upload-mock-v3.html`, `share-receiver-mock-v5.html`. X5 limits `docs/research/served-code-and-ohttp-2026-10.md`. Decisions from Share-Progress-1 (calm progress), Share-Receiver-1 (type rule, wording), B12-4a-2 (sign-in).

---

## 1. Audit — what's live now

Rendered in the preview harness (`dev/share-harness`, the canonical page inside a copy of refueler.io) at 1280 × 860 and 375 × 812, Carbon and Paper. Chromium in the app's browser pane, **not Safari** — Safari check comes when Rajesh opens the specimen. Contrast measured from computed styles in the page.

### 1.1 What already feels calm — keep

| Screen | What works |
|---|---|
| Upload · uploading | The best screen we have. One serif word ("Uploading."), one mono figure, a 1 px track, two quiet words. Nothing else. This is the reference for every other screen. |
| Receiver · ready | Eyebrow, one sentence headline, a three-row ledger, one button, one fine line. Holds at 375 px without change. |
| Receiver · done | "Downloaded." + two rows + one hairline sentence + one quiet link. |
| Everywhere | The type rule (serif = the one headline, mono capitals = labels, DM Sans = everything read). Hairline rules, no shadows, no gradients, no icons. Middot separators. Arrival stagger (0.5 s, once). Fade only the changing figure. |
| Link ready | Copy / QR as a pair; QR on request, not by default. |

### 1.2 What doesn't — change

| # | Where | Finding | Why it isn't calm |
|---|---|---|---|
| A-1 | Everywhere | **Ledger labels and `--fg-subtle` text fail contrast**: 3.05 : 1 on Carbon, **2.30 : 1** on Paper (AA needs 4.5 : 1). Hits FILE / SIZE / AVAILABLE UNTIL, the "7 days after upload" placeholder value, the footer. Labels are also the smallest text (10.5 px). | Precision you can't read isn't precision. A watch dial's minute track is fine but never faint. |
| A-2 | Sign-in | Full-width email field inside a ledger row; full-width 520 px button for a one-field form. | A ledger is for facts, not for typing. A form that spans the sheet looks like a web form, not an instrument. |
| A-3 | Sign-in · signed in | Three stacked actions — "Send a file" and "Sign out" as equal 520 px buttons, then "Sign out everywhere". | Two equal buttons = two actions. Sign out is the rare one. |
| A-4 | Upload · chosen (375 px) | The page is 1,093 px tall; **"Encrypt and upload" is below the fold**. ~125 px of that is refueler.io chrome (hamburger, theme pill, Send / Plans / Status pill). | The one action on the screen is the one you can't see. |
| A-5 | Upload · chosen | Every row says something: password note is two sentences; the facts line repeats under a file already chosen. | Says on the second screen what the first already said. |
| A-6 | Upload · ready | 30-word lede, then the whole 200-character link printed in full, then the ledger. | The longest text block in the product sits on the screen where the person only needs to press Copy. |
| A-7 | Upload · account row | "Uploading as Citizen · Send without my account" is one row among five, same weight as Size. | The rail you're on is a choice with consequences; it reads as a footnote. (Part 2 designs the indicator.) |
| A-8 | Upload vs receiver | Two sheet widths: upload 520 px, receiver / sign-in 480 px. | Same family of pages, different measure. |
| A-9 | Status banner + maintenance modal | 🔧 and ⚠️ emoji; "Got it"; modal has a 3 px gold top border. | Emoji is the juvenile register we're leaving. |
| A-10 | Surfaces | Carbon `--surface` `#26282C` and `--input-bg` `#252525` are cool / neutral greys on a warm ground (`#1A1917`). | Slight blue cast under the cream type; reads "web app dark mode", not paper-and-ink. |
| A-11 | Status colours | `--danger #E05252`, `--success #27AE60` are saturated UI-kit colours (Legend bans red outright); on Paper both fail as text (2.96, 2.23). | The juvenile colour, exactly. |
| A-12 | Facts line at 375 px | Wraps leaving a dangling middot at the line end ("No account or email needed ·"). | Small, but the kind of thing a watchmaker notices. |

### 1.3 Small bugs found on the way (for the build, not design)

- **Day count disagrees.** Link ready says "in 7 days"; the recipient opening it a minute later sees "in 6 days" for the same expiry. `share.js:254` rounds (`Math.round`), `download-time.js:37` floors. Pick one (floor, and say "7 days" only when ≥ 7 × 24 h remain).
- Finished screen: "Refueler's" has a straight apostrophe (everything else is curly).
- Input edges are 1.69 : 1 (Carbon) and 1.44 : 1 (Paper) against the page; WCAG 1.4.11 wants 3 : 1 for the edge that identifies a field.

---

## 2. Competitor scan

First screen, desktop, observed 13 Oct 2026 in the app's browser pane (Chromium). Cookie banners declined where a decline was offered; no terms accepted, nothing uploaded.

| Service | Layout | Colour | Ads / upsell on the first screen | Text on the first screen | Motion / other |
|---|---|---|---|---|---|
| [WeTransfer](https://wetransfer.com/) | Left icon rail (Send, Request, Albums, Showcase, Sign), top nav, a small card on a large dark canvas | Black + bright blue buttons | Notification badge, "Sign up"; the canvas is WeTransfer's ad-wallpaper space (none served to us before the gate) | Terms gate first: "You're almost there… I agree". Consent banner: "**We and our 667 partners** store and access personal data" | Upload blocked until you accept terms |
| [Smash](https://fromsmash.com/) | One round button centre-screen on a full-bleed colour gradient | Red → orange → blue gradient | "Get Smash Pro 🚀" in the header; app-rating badge | Tooltip "Click to send your files"; ~1,000 words of SEO copy below the fold | Cookie banner "Cookies? Cookies!… I looove cookies!" (motion of the gradient not checked) |
| [SwissTransfer](https://www.swisstransfer.com/) | Centred card over a full-bleed mountain photo with photographer credit | White card, green ticks, green "I agree" | "Get SwissTransfer Pro" + Infomaniak logo | Four ticked feature lines + terms gate; long FAQ below | Terms gate before upload |
| [Wormhole](https://wormhole.app/) | Two-column card on a full-bleed purple nebula image | Purple / magenta | "Get product updates"; "Security by Socket" | Dashed drop zone, "Or drag stuff here", one paragraph pitch | No gate; closest to us in intent (E2E, expiring link) |
| [Filemail](https://www.filemail.com/) | Classic SaaS: 7-item nav, Title Case headline, big dashed box | White + bright blue | "Get More With A Filemail Subscription", plans comparison, "7-Day Trial" | Title Case on everything; long SEO copy | Consent: "I agree" or "Change my preferences" — no one-click reject |
| Proton Drive (shared link) | Not observed directly (no link to hand). Per Proton: password prompt if set, then download; no Proton account needed for the recipient ([support](https://proton.me/support/drive-shareable-link), [blog](https://proton.me/news/file-sharing-proton-drive)) | Proton purple (proton.me) | — | — | Proton is a peer, not a foil (editorial rule) |

**The pattern.** Every one of them fills the first screen with something that isn't the file: a wallpaper, a gradient, a photo, a terms gate, a consent wall, a Pro button. Brand is carried by colour volume. Copy is either cute ("I looove cookies") or SEO (Title Case, "Any Size").

**What we deliberately don't do.**
1. No full-bleed imagery, gradients or wallpapers — the ground is plain Carbon or Paper.
2. No upsell on any working screen (upload, receive, sign-in). Plans live on their own page, reached by choice.
3. No terms gate or consent wall before the action. (We set no tracking cookies; the theme cookie is a preference.)
4. No cute copy, no exclamation marks, no Title Case, no emoji.
5. No SEO text on the app page. The X5 landing at `refueler.io/share/` can explain; the app at `share.refueler.io` just works.
6. No colour carrying the brand. The brand is the type, the rules and the pace.

---

## 3. Principles

Eight rules. Each has a **do** and a **don't** taken from our own screens.

**P1 · One action per screen.** Each screen has one primary button. Everything else is a quiet text link.
- *Do:* Receiver ready — one "Download".
- *Don't:* Signed in — "Send a file" and "Sign out" as equal buttons (A-3).

**P2 · Less text. Say it once.** A screen carries a headline, at most one short lede, the ledger, and at most one fine line (budget in §5).
- *Do:* "Uploading." + figure + "Keep this tab open".
- *Don't:* The facts line still showing under a file you've already chosen (A-5).

**P3 · Nothing moves unless the person moved it.** Movement answers an action: a choice, a drop, a press, progress the person started. No ambient motion, no carousels, no attention pulses. (Part 2 sets the motion vocabulary.)
- *Do:* Arrival stagger once per sheet; only the changed figure fades.
- *Don't:* A banner sliding in on page load for something the person didn't do (status banner's `banner-in`).

**P4 · Steady cadence.** Live figures change on a slow, even beat — words every 2 s, time left every 5 s — and never claim more than has happened.
- *Do:* Share-Progress-1's throttled readout.
- *Don't:* A figure that ticks every frame, or a % that jumps a whole part at a time.

**P5 · The sentence carries the signal.** State is said in words; colour and weight only support it. No badges, no fills, no icons for state.
- *Do:* "The link works once, then the file is deleted." with a single brass hairline.
- *Don't:* ⚠️ + a tinted box (A-9).

**P6 · A control is as wide as what it holds.** Fields fit their content; buttons fit their word. Full width only on a phone, where the thumb needs it, and for things that are genuinely long (the link).
- *Do:* The QR shown at its own size.
- *Don't:* A one-line email field and its button spanning 520 px (A-2).

**P7 · Legible precision.** Small is fine; faint isn't. Every piece of text meets WCAG AA (4.5 : 1) in both themes; field edges meet 3 : 1. Figures that change are set in Plex Mono so digits don't shift.
- *Do:* The mono percentage.
- *Don't:* 10.5 px labels at 2.30 : 1 on Paper (A-1).

**P8 · Honest scope first.** Say the limit beside the strength, in the same plain voice; never sell on a working screen.
- *Do:* "Free transfers go up to 4 GB. Paid plans for larger files aren't open yet."
- *Don't:* "Unlimited", "ultra secure", or a Pro button next to the upload.

---

## 4. Type, colour, layout

### 4.1 Type scale — seven steps (today ~13 sizes in use)

| Token | Size / line | Face | Use | Replaces |
|---|---|---|---|---|
| `--t-label` | 11 / 1.6, +0.14 em, caps | IBM Plex Mono 500 | Ledger labels, eyebrow | 10.5, 11 |
| `--t-fine` | 13 / 1.5 | DM Sans 400 | Fine lines, notes under values, readout | 12, 12.5, 13, 13.5 |
| `--t-body` | 15 / 1.55 | DM Sans 400 (300 only for ledes) | Values, ledes, buttons (500), links | 14, 15, 15.5 |
| `--t-input` | 16 | DM Sans 400 | Inputs only (iOS Safari zooms below 16) | 15, 16 |
| `--t-title` | 21 / 1.3 | Source Serif 4 300 | Card titles (Notes card) | 21 |
| `--t-head` | clamp(30, 5vw, 40) / 1.12 | Source Serif 4 300 | The one headline | same |
| `--t-figure` | clamp(44, 8vw, 64) / 1 | IBM Plex Mono 400 | Live figures (%, later: clock-like values) | same |

- DM Sans 300 only at 15 px and above (thin strokes on Carbon break up at 13 px).
- `font-variant-numeric: tabular-nums` does nothing with DM Sans as loaded; anything that changes while you watch goes in Plex Mono.
- **X5 font set:** self-hosted WOFF2, three families only — Source Serif 4 (300), DM Sans (variable, 300–500), IBM Plex Mono (400, 500). Satoshi is used only by the wordmark and nav; on the standalone layout the wordmark becomes an inline SVG and Satoshi isn't loaded. Today's fonts come from Google Fonts + Fontshare, which X5's CSP rules out.

### 4.2 Measure

- **Sheet: 480 px** content width for every Share screen (upload moves from 520). Ledger label column 118 → **132 px** (at 11 px labels, "AVAILABLE UNTIL" wraps in 118).
- Lede ≤ 40 ch · fine lines ≤ 52 ch · any running text ≤ 60 ch. Headline `text-wrap: balance`.

### 4.3 Spacing scale

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64` px. Today 17 distinct values (3 … 48). Hairline offsets (1–3 px) are exempt.
- Eyebrow → headline 16 · headline → lede 12 · lede → ledger 32 · ledger row padding 16 (12 on phone) · ledger → action 32 · action → fine 12 · sheet → send-another 48.

### 4.4 Width rules (P6)

| Element | Desktop (≥ 441 px) | Phone (≤ 440 px) |
|---|---|---|
| Primary button | Width of its words, min 160 px, left edge on the text column | Full width |
| Button pair (Copy / QR, Try again / Start over) | Two intrinsic buttons, left-aligned, 12 px gap | Two equal halves |
| Email field | `min(100%, 352px)` | Full width |
| Password field | `min(100%, 288px)` | Full width |
| Link box | Full sheet (it holds a long thing) — but shows the link truncated to two lines; Copy copies all of it | Same |
| Secondary actions | Text links, never buttons | Same |
| Forms | Label above the field (mono caps); **forms never sit inside a ledger** — the ledger is for facts | Same |

**Phone fold rule:** on arrival at chosen (options closed), the primary button is visible on a 375 × 667 viewport without scrolling. Opening the password field may push it down — the person moved it (P3). The standalone X5 header (wordmark · account · theme, one 48 px row, no section pill) recovers ~125 px; row padding 12 and dropping the mono label on switch rows (the switch says what the row is) recover the rest. Specimen: button bottom at 630 px.

### 4.5 Colour roles

Contrast is against the page ground. ✗ = fails AA for its use.

| Role (token) | Used for | Carbon now | **Carbon proposed** | Paper now | **Paper proposed** |
|---|---|---|---|---|---|
| Ground `--bg` | Page | `#1A1917` | keep | `#E8E2D8` | keep |
| Ink `--fg` | Headline, values, primary button fill | `#F5F0E8` 15.5 | keep | `#1A1A1A` 13.5 | keep |
| Ink 2 `--fg-muted` | Ledes, fine, links | `#B0AAA2` 7.6 | keep | `#5A5550` 5.7 | keep |
| Ink 3 `--fg-subtle` | Labels, placeholders, footer | `#6A6560` 3.05 ✗ | **`#8F897F` 5.06** | `#9A9590` 2.30 ✗ | **`#67625C` 4.69** |
| Rule | Ledger hairlines | fg 10 % | keep | fg 12 % | keep |
| Rule strong | Slip edge, ghost button | fg 22 % | keep | fg 26 % | keep |
| Field fill `--input-bg` | Inputs | `#252525` (neutral) | **`#24221F`** (warm) | `#CCC7BE` (darker than paper) | **`#F3EEE6`** (lighter: a sheet to write on) |
| Field edge `--input-border` | Input outline | fg 18 % = 1.69 ✗ | **`#6E695F` 3.22** | fg 18 % = 1.44 ✗ | **`#847D72` 3.16** |
| Raised `--surface` | Modal, panel fill | `#26282C` (cool) | **`#24221F`** | `#DAD4CA` | keep |
| **Accent — brass** | Focus ring, drop frame, the "once" hairline. Never a button, never a fill, never body text | `#C8A96E` 7.8 | keep | `#C8A96E` 1.74 (share.css uses `#9A7A3E` 3.12) | **`#7A5F2E` 4.65** |

**One accent.** Brass is the only hue on a working screen. It marks the one thing that matters at that moment (focus, a drop target, an irreversible line, the tip of a moving bar). If two things are brass, one of them is wrong.

### 4.6 Status — no status colours (revised 13 Oct after Rajesh's review · **gold over coral decided by Rajesh, 13 Oct**)

This is the first time Share introduces colour beyond ink, so it starts as small as it can, and in step with Legend.

**Legend's rule, checked** (`refueler-legend/legend-design-spec.md`, `legend-ui-modes.md`): "No red. No alarm iconography. Precision is the signal, not colour." Errors are "a single plain sentence". Unreachable and reduced states use secondary text, "not amber, not red". The only state colour in all of Legend is one muted amber, `--canary-expired` (`#B8860B` Paper / `#C9A227` Carbon), for an expired canary. The accent is gold `#C8A96E`, restricted, never orange. Legend has no tokens of its own; it inherits `global.css`.

**The Polaris reference** (jaeger-lecoultre.com/gb-en/watches/polaris, sampled from the product images 13 Oct): a dark graded dial (blue, olive, slate or black), aged-cream lume on hands and numerals (≈ `#D9D5AA`), polished steel, and **one** small coral marker — the triangle at 12 and the tip of the seconds hand (≈ `#F47630`). Everything else is ink on a dark ground. That is the same structure as Carbon + Paper inks + one accent.

**So Share uses two colours, and v1 needs only one:**

| Role | Token | Carbon | Paper | Share v1 use |
|---|---|---|---|---|
| Accent (the 12 o'clock marker) | `--accent` | `#C8A96E` 7.83 | `#7A5F2E` 4.65 | Focus ring, drop frame, the "once" hairline, the tip of the progress bar |
| Attention (Legend's amber, shared) | `--attention` (= Legend `--canary-expired`) | `#C9A227` 7.26 | **`#805E0A` 4.63** (Legend's `#B8860B` is 2.53 ✗) | **None.** Reserved so the suite has one amber, not two |

- **Faults, cautions and done states are said in ink.** "That password doesn't open this file." is a plain sentence in `--fg`; the field edge turns `--fg`. "Deleted from Refueler's servers." needs no green.
- The part-1 draft's fault / caution / settled palette (terracotta, umber, verdigris) is **withdrawn**.
- **Gold, not Polaris coral — decided (Rajesh, 13 Oct).** The coral sits next to the orange the suite abolished (`#F5820A` / `#D4690A`), and Legend's spec says "gold… never orange". Share takes the Polaris *grammar* — one small marker at the reference point — not its hue. JLC's own finest Polaris (the pink-gold Perpetual Calendar) makes the same move: the metal becomes the accent and the colour shrinks to a hairline.
- The progress bar's accent tip is a preview of Part 2's watchmaker A/B (the "hand tip"); it is the accent's one place on the uploading screen.

### 4.6a Lessons from the Polaris (Rajesh's screenshots, 13 Oct)

Share and Legend share this aesthetic — calm, considered, understated luxury — so these apply to both.

1. **Legible at all times.** JLC's own claim for the Polaris dial: it puts legibility first "without the slightest compromise in aesthetics". That is P7. The lume photograph is the Carbon theme: in the dark, only the inks and markers remain, and they stay readable. Our contrast fixes are the same promise.
2. **Segments by tone and texture, not colour.** The dial separates its zones with "opaline, grained and sunrayed" surfaces and hairline tracks. Share separates the slip, the ledger and the page with one tone step and hairlines — never with colour.
3. **The accent marks a reference point.** Orange appears only on the 12 triangle, the seconds-hand tip, the "60" and "30" on the chronograph totalisers, and a few minute dots. Our gold appears only where the eye should land first: focus, the drop target, the irreversible line, the tip of the moving bar.
4. **The more precious, the quieter.** The perpetual calendar (two to three times the price) swaps colour for metal: rose-gold hands and indices, one red tip, one red "31". Restraint reads as value.
5. **The date window.** A small framed figure that changes once a day, set in a fixed face. That is our Plex Mono live figure (calm-progress-ui); Part 2 develops it.
6. **The graded dial (open, for Part 2's A/B).** Every Polaris dial is lighter at the centre and darker at the edge. A barely perceptible radial lift behind the sheet on Carbon (1–2 %) could echo it. Default stays flat; test only if it doesn't band on ordinary screens.

### 4.7 Tokens to change (flag list for X5-1)

1. `global.css` `--fg-subtle` both themes (A-1). Affects all of refueler.io **and Legend** (Legend inherits `global.css` and its spec quotes the same failing values) — so this is a suite fix, decided once; Share's standalone build carries the fixed values from X5-1.
2. `global.css` Carbon `--surface`, `--surface-raised`, `--input-bg` → warm (A-10).
3. `--input-border` both themes → solid colours at ≥ 3 : 1.
4. `--danger`, `--warn`, `--success` → **removed from Share's file** (A-11); one `--attention` token shared with Legend (`--canary-expired`), Paper value darkened to `#805E0A` for AA — **Legend's own Paper value fails too (2.53)**, so the fix belongs in the shared tokens.
5. Paper accent as text → `#7A5F2E`; drop `--rx-accent #9A7A3E`.
6. **One token file for Share** at X5-1. Today there are three: `global.css` (live), `share-tokens.css` (Paper `#F5F0E8`, older), `share.css` `--rx-*` (fonts + rules re-declared because global.css lacks them). X5-1 ships one `share-tokens.css` rebuilt from global.css + this section; `--rx-*` folds into it; DESIGN-TOKENS.md is deleted or rewritten.
7. Emoji out of the status banner and maintenance modal (A-9); "Got it" → "Close".

---

## 5. Copy cadence

### 5.1 Budget per screen

| Part | Allowance |
|---|---|
| Eyebrow | 1–3 words, mono caps |
| Headline | One sentence, ≤ 7 words, ends with a full stop |
| Lede | Optional; one sentence, ≤ 20 words |
| Ledger | Facts only; a row's note ≤ 12 words |
| Fine line | Optional; one, ≤ 12 words |
| Buttons | 1–3 words, a verb first ("Copy link", not "Click to copy") |
| **Total running text** | **≤ 40 words** excluding labels and the link itself |

Today: upload chosen ≈ 55 words; link ready ≈ 50; receiver ready ≈ 20; uploading ≈ 6.

### 5.2 Where detail goes instead

1. **The email** — sign-in mechanics, how long a link lasts, what "sign out everywhere" does (already the B12-4a-2 rule).
2. **A disclosure line** — one quiet "How this works" link under the ledger that opens a short paragraph in place (no modal). For: the key living in the link, the password hash, delete-after-download timing.
3. **Legend** — anything that is a policy or a promise (retention, what the server sees, what "deleted" means). Working screens link to it; they never paraphrase it.

### 5.3 Proposed rewrites

| Screen | Now | Proposed |
|---|---|---|
| Link ready · lede (30 words) | "The key to the file is inside the link. Anyone who has the link can download the file, so send it only to the person it's for." | "Anyone with this link can open the file. Send it only to the person it's for." (16) — "the key is inside the link" moves to the disclosure |
| Chosen · password note | "Send it separately from the link. Refueler stores only a hash of it." | "Send it separately from the link." — the hash line moves to the disclosure |
| Chosen · facts line | Shown on empty **and** chosen | Empty view only |
| Signed in | Send a file / Sign out / Sign out everywhere | **Send a file** · then text links "Sign out · Sign out everywhere" |
| Finished (DAD) | "Transfer permanently deleted from Refueler's servers." | "Deleted from Refueler's servers." (curly apostrophe; "transfer" and "permanently" add nothing the reader can check) |
| Status banner | "🔧 Scheduled maintenance: …" / "⚠️ Some services are degraded — we are investigating." | e.g. "Maintenance: Tue 20 Oct, 02:00–02:30." / "Some uploads are failing. We're looking at it." — no icon (the text itself comes from `/status`) |

---

## 6. Open questions for Rajesh

1. **Receiver "Download" width.** P6 says intrinsic on desktop. The receiver card is the one place a full-width bar arguably earns it (it's the whole page). Recommend: same rule everywhere, for one consistent hand.
2. **Sign-in eyebrow "Citizen".** Shown before we know who you are. Keep (it names the plan you're signing in to), or "Account"? Recommend keep — Part 2's Account indicator uses the same word.
3. **Link box.** Show the link truncated to two lines with Copy copying all of it? Recommend yes — less key material on screen for a shoulder to read, and the box stops dominating.
4. **Paper input fill lighter than the page** (`#F3EEE6`)? Recommend yes — writing on a fresh sheet; today's darker fill reads as disabled.
5. **Token ownership after X5.** Share's standalone build owns its token file; refueler.io's `global.css` adopts the contrast fixes separately (refueler.io is frozen until Share is near complete). Recommend that split.
6. **Legend's token block is out of date.** `legend-design-spec.md` §Design tokens lists Carbon `--fg #E8E2D8`, `--surface #242424`; `global.css` has `#F5F0E8`, `#26282C`. Legend says it inherits `global.css`, so the spec text is what's stale. Recommend: fix the Legend spec when the suite contrast fix lands (one session, refueler-legend repo).
7. ~~Accent hue.~~ **Decided 13 Oct: gold.** Legend's spec carries a pointer to this section (`refueler-legend/legend-design-spec.md` §Design tokens).

---

*Part 2 — motion, haptics, components, stage chip, Account / rail indicator, A/B plan — appended by Design-Theory-Opus-2.*
