# Share design theory — v1

> **X5-2 (15 Oct 2026):** Share moved to `https://share.refueler.io` (shipped by `bin/ship-app.sh`). Mentions below of `refueler.io/share/` as the app, `ship-frontend.sh`, `sync-share.sh`, `share-mirror.sh`, the pre-push hook or `mirror-check.yml` are historical. `refueler.io/share/` is now a landing page; Plans and Status stay on refueler.io.

> **Parts 1 and 2** · Design-Theory-Opus-1 + -2 · 13 Oct 2026 · **Proposals only — nothing here is locked until Rajesh agrees it section by section.** Decided items are marked *Decided (Rajesh, date)*.
> Part 1 (§1–§6): audit, competitors, principles, type / colour / layout, copy. Part 2 (§7–§12): motion, haptics, components, the stage chip, the account indicator, the A/B plan.
> Built for X5-1: Share's standalone layout at `share.refueler.io` is built once, to these rules. **Share and Legend share one watchmaker aesthetic** — each Part 2 section ends with how it applies to Legend.
> Specimen: `dev/share-harness/specimen/` — `python3 -m http.server 8093 --directory dev/share-harness/specimen`, then http://localhost:8093/ in Safari (theme, stage, dial and reduced-motion controls at the top). Launch config `design-specimen`. From a phone on the same Wi-Fi: `http://<Mac LAN IP>:8093` (Mullvad: "Local network sharing" on).

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

Eight rules. Each has a **do** and a **don't** taken from our own screens. *Decided (Rajesh, 13 Oct): all eight as written.*

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

### 5.3 Rewrites — *decided (Rajesh, 13 Oct): all as proposed*

| Screen | Now | Proposed |
|---|---|---|
| Link ready · lede (30 words) | "The key to the file is inside the link. Anyone who has the link can download the file, so send it only to the person it's for." | **"Anyone with this link can open the file."** (8) — *Decided (Rajesh, 13 Oct): one sentence; the warning is in the fact.* "The key is inside the link" moves to the disclosure |
| Chosen · password note | "Send it separately from the link. Refueler stores only a hash of it." | "Send it separately from the link." — the hash line moves to the disclosure |
| Chosen · facts line | Shown on empty **and** chosen | Empty view only |
| Signed in | Send a file / Sign out / Sign out everywhere | **Send a file** · then text links "Sign out · Sign out everywhere" |
| Finished (DAD) | "Transfer permanently deleted from Refueler's servers." | "Deleted from Refueler's servers." (curly apostrophe; "transfer" and "permanently" add nothing the reader can check) |
| Status banner | "🔧 Scheduled maintenance: …" / "⚠️ Some services are degraded — we are investigating." | e.g. "Maintenance: Tue 20 Oct, 02:00–02:30." / "Some uploads are failing. We're looking at it." — no icon (the text itself comes from `/status`) |

---

## 6. Open questions for Rajesh — answered 13 Oct

*Decided (Rajesh, 13 Oct 2026), all as recommended:*

1. **Receiver "Download" width** → **intrinsic everywhere.** One rule (§4.4): a button is as wide as its words on desktop, full width ≤ 440 px. No exception for the receiver card.
2. **Sign-in eyebrow** → **keep "Citizen".** §11's account indicator uses the same word.
3. **Link box** → **two lines**, Copy and QR carry the whole link (component in §9).
4. **Paper field fill** → **lighter than the page, `#F3EEE6`.**
5. **Token ownership after X5** → **split.** Share's standalone build owns one `share-tokens.css` from X5-1; refueler.io's `global.css` takes the contrast fixes separately — done 14 Oct 2026 (X5-1a: `--fg-subtle` both themes, warm Carbon surfaces and field, solid field edges).
6. **Legend's stale token block** → **fixed with the suite contrast fix** (one session in `refueler-legend`), not before.
7. **Accent hue** → gold (decided earlier the same day). Legend's spec carries a pointer to §4.6.

---

# Part 2 — Design-Theory-Opus-2 (13 Oct 2026)

Proposals only. Every section ends with **Legend:** — how the same rule applies there. Specimen sections named in each.

## 7. Motion

### 7.1 Four verbs, one easing

Nothing moves unless the person moved it (P3). When something does move, it uses one of four verbs — and only opacity and a 6 px rise. Nothing scales, bounces, slides in from the side, rotates or loops.

| Verb | What it answers | Movement | Duration | Today |
|---|---|---|---|---|
| **Arrive** | A new sheet (page open, a step finished) | Each line fades up 6 px, 170 ms apart, button last. **Once per sheet**, never on a re-render or a theme switch | 500 ms per line | `.rx-arrive` (receiver) |
| **Settle** | One thing appearing because the person pressed something (password field, QR, a disclosure opening, the account row changing) | The same fade-up, one element, no stagger. Closing is instant | 500 ms | — |
| **Fade the changed figure** | A live value changing (amount sent, time left, "Copied") | Opacity .25 → 1 on the changed words only; the words around them stay still | 450 ms | `setCalmText` / `setProgressWords` |
| **Press** | A tap or click | A tone step: the button fill darkens one step (`--fg` 78 %) while pressed; a ghost button takes the slip tone. No ripple, no scale | 200 ms | `opacity .88` on hover only |

Two existing movements stay as they are and need no verb: the **switch knob** (200 ms slide, the touch timing — it *is* the control) and the **theme turn** (Legend's 0.35 s on all tokens at once). The **progress bar** glides linearly between 100 ms ticks; that is information, not decoration.

**The touch (decided, Rajesh, 13 Oct).** Every change the person causes by touching something — field edge, switch knob and track, button press and hover, link colour — has the feel of the receiver's password field: **200 ms, one small tone step**. That field isn't a long animation: `global.css` fades its edge over 0.2 s from steel (`--input-border`) to Ink 2 (`--fg-muted`) — a small step, done gently. Smoothness comes from small changes, not slow ones. So: no opacity flashes (today's `.rx-btn:hover` `.88`, `:disabled` `.35`), no jumps of more than one tone.

**Tokens** (one file at X5-1): `--ease: cubic-bezier(.2,.7,.2,1)` (already in `share.css`) · `--d-touch 200ms` (press, knob, field edge, link colour — one value) · `--d-fade 450ms` · `--d-arrive 500ms` · `--stagger 170ms` (must equal `RX_STAGGER_MS` in `download-sheets.js`).

### 7.2 What may never move

- Anything the person didn't cause: no ambient motion, no attention pulse, no shimmer, no carousel, no auto-scroll, no parallax.
- **No spinner.** Waiting is said in words that change (Legend already does this: "Text updates only — no spinner").
- **No pulse.** `frontend/status.css` pulses the status dot (`pulse-red`, `pulse-amber`, with `#C0392B`) — breaks P3, the no-red rule and Legend's "No pulse". Remove when the status page is next touched (refueler.io owns Status; the file is still in `SM_CSS`).
- **No slide-in banner.** `banner-in` (in `global.css` and `share-tokens.css`) goes at X5-1: the status line simply is there when the page arrives.
- **No shake** on a wrong password. That is the alarm register.
- The headline and ledger values never move after arrival, except live figures (fade only).

### 7.3 Reduced motion

`prefers-reduced-motion: reduce` turns off arrive, settle, fade and every transition: things appear at once. Press keeps its tone step (a colour change, not movement). The progress bar still advances — it is the information — but in steps, without the glide. The specimen's "Reduced motion" toggle does the same, so it can be judged without changing the OS setting. Test with the real setting: macOS *System Settings › Accessibility › Display › Reduce motion*; iOS *Settings › Accessibility › Motion › Reduce Motion*.

### 7.4 Safari and iOS

- Animate `opacity` and `transform` only. Never `height`: Safari can't animate to `auto`, so a disclosure opens instantly and its *contents* settle.
- Hover styles only under `@media (hover: hover)` — iOS keeps a tapped element "hovered" until the next tap.
- `-webkit-tap-highlight-color: transparent` on the page, so the grey iOS tap flash doesn't replace our press state.
- Restarting a CSS animation needs a reflow (`void el.offsetWidth`) — `setCalmText` already does it; keep it.
- Background tabs: timers drop to once a second or stop. Steady progress catches up when the tab returns — never past the bytes that really moved — so a jump on return is honest. Nothing depends on 60 fps (Low Power Mode caps at 30).
- `text-wrap: balance` needs Safari 17.5; `color-mix()` needs 16.2. Both fall back harmlessly.

Specimen: *Motion · four verbs, one easing*.

**Legend:** the vocabulary is a ceiling, not a quota. Legend's own rules are stricter and stand: no animation on result arrival, no pulse, PIR progress is "text updates only", stewardship mode has no motion at all. So Legend uses **press** and the theme turn, and nothing else. If Legend ever wants its PIR lines to fade, that is a Legend spec change, not something this section grants.

## 8. Haptics

### 8.1 What a web page can actually do

| Platform | Vibration API (`navigator.vibrate`) | Other haptics |
|---|---|---|
| Safari, macOS and iOS | **Doesn't exist.** Never has. | iOS 18 Safari ticks when a native `<input type="checkbox" switch>` is toggled (the `switch` attribute shipped in Safari 17.4). The page can't call it; it comes with the control. |
| Chrome on Android, **Vanadium** (GrapheneOS), Brave Android | Works, but only right after a tap (user activation) and only while the page is visible — the spec returns false for a hidden page. | — |
| Firefox Android | Not checked; don't rely on it. | — |
| Desktop browsers | No vibration hardware. | — |

So "vibrate when the upload finishes" is impossible where it would matter: the upload finishes while the person is looking elsewhere (tab hidden → refused), and Safari users — Rajesh's first concern — get nothing anyway. A buzz from a page you aren't looking at is the notification register; that belongs to the OS or the future Nostr notice (row 19), not the page.

### 8.2 Proposal: off in v1

*Rajesh (13 Oct) wants switches and presses to feel as smooth as the receiver's password field — that's the visual touch in §7.1 (200 ms, one tone step), not vibration. Vibration stays off.*

- **No `navigator.vibrate` calls in v1.**
- **One candidate, for the A/B (§12):** the *copy tick* — 10 ms, once, when "Copy link" succeeds, Android only. On a phone, copying gives no physical sign it worked; one tick is the watch-crown click. Never a pattern of pulses, never on an error, never under reduced motion (there's no "reduce haptics" setting on the web, so reduced motion stands in).
- **Free on iPhone:** if X5-1 builds the two upload switches (password, delete after download) on an `<input type="checkbox" switch>`, iOS 18 ticks them with no code. The specimen has both a native switch and our styled one with the `switch` attribute underneath — **check on the iPhone 13 mini whether ours ticks too.** Using the control as intended is fine; clicking a hidden switch from script to fake haptics elsewhere is a trick — no.
- **Never:** download finished, wrong password, a status change, anything not under the person's thumb.

Specimen: *Haptics · proposed off in v1* (open it from the Pixel and the iPhone on the same Wi-Fi).

**Legend:** none. Stewardship mode is about stillness; a tick on copying an address would be the only conceivable use, and only if Share adopts the copy tick first.

## 9. Components

Built from the Part 1 tokens. Every interactive one shares: focus = the gold ring (`2px solid --accent`, offset 3 px) on `:focus-visible`; hover only with a mouse; press per §7.1.

| Component | Anatomy | States | Width | Never |
|---|---|---|---|---|
| **Button** | Ink fill `--fg`, ground-colour words, DM Sans 500 15, radius 8, padding 15 × 24, min 160 px. **Ghost**: no fill, `--rule-strong` hairline | Rest · hover (fill 90 %) · press (78 %, 120 ms) · focus ring · **busy** — the word says what's happening ("Unlocking") and presses are ignored | Its words (desktop); full width ≤ 440 px; a pair = two halves | A disabled grey button: a button appears when it can act. Gold. Icons. Two primaries on one screen (P1) |
| **Text link** | DM Sans, `--fg-muted`, 1 px underline in `--rule-strong`, offset 3 | Hover → `--fg`; focus ring | Its words | Gold. A button shape. "Click here". An arrow, except "→" for a link that leaves the page |
| **Switch** | 34 × 20 track, edge `--input-border` (3 : 1), knob `--fg-muted`; label to the right says what *on* means | Off · on (ink track, ground-colour knob, 200 ms) · focus ring on the track | Its label | Colour for on. "On / off" words. A switch that acts on its own — it only sets a choice |
| **Field** | Mono-caps label **above**; fill `--input-bg`; edge `--input-border`; 16 px text (iOS zoom); radius 8; padding 12 × 14 | Rest · focus (edge → `--fg` + gold ring) · **wrong** — edge 2 px of ink (inset, no shift), one sentence below in `--fg`: "That password doesn't open this file." Value kept, selected, for retyping | Email `min(100%, 352px)`; password `min(100%, 288px)`; full ≤ 440 px | Red. A shake. An icon in the field. A field inside a ledger row |
| **Ledger row** | Label column 132 px, Plex Mono 500 11 caps `--fg-subtle`; value DM Sans 15 `--fg`; note ≤ 12 words, 13 `--fg-muted`; hairline `--rule` between rows | Static. Live values in Plex Mono, fade per §7.1 | Full sheet; ≤ 440 px label above value, padding 12 | Colour in a value. Inputs (forms aren't ledgers). A row with nothing the reader can check |
| **Slip** | The ledger of *things you set before sending*, **Carbon:** one tone step up, `--slip-bg #201F1C` + a `--rule` hairline (labels 4.75, switch edge 3.02). **Paper: hairline only** (`--rule-strong`, no fill) — *decided (Rajesh, 13 Oct)*: three near-whites (page, slip, field) was one step too many; the field stays the one lighter sheet to write on. (A darker Paper step `#DFD9CF` would also fail AA: labels 4.30, switch edge 2.90.) Radius 10 | — | Full sheet | A second colour. A shadow. Facts after sending (those sit on the page) |
| **Link box** | Plex Mono 13 / 1.5, fill `--input-bg`, edge `--input-border`, radius 8; **two lines then an ellipsis** (*decided 13 Oct*) — clamp on an inner element, or the third line shows in the padding | Static; not an input (no phone keyboard) | Full sheet | The whole link on screen. A text field. Editing |
| **Disclosure** | Native `<details>`: the summary is a text link ("How this link works"), the body ≤ 60 words, 13 `--fg-muted`, ≤ 52 ch | Closed · open (summary → `--fg`, body settles in; closing is instant) | Sheet | A chevron or ＋. A modal. Policy text — that lives in Legend (§5.2) |
| **Notice** | One sentence, 15 `--fg`, a 1 px hairline on the left, padding 14 | Hairline `--rule-strong`; **gold only on the irreversible line** ("The link works once, then the file is deleted.") | ≤ 52 ch | An icon, emoji, fill, close button or slide-in. Amber (reserved, §4.6) |
| **QR** | Shown on request ("Show QR code" ↔ "Hide QR code"); dark modules `#1A1917` on a paper tile `#F5F0E8` **in both themes** (scanners want dark on light), 4-module quiet zone, whole pixels per module, radius 8; one fine line: "Scan with a phone's camera to download it there." | Hidden · shown (settles in) | ≤ 260 px desktop, ≤ 220 px phone | A logo in the middle. Inverted (light on dark). Shown by default |

The live page already gets the QR right (`share.js` `_renderQr`, U-9 / F-16 / F-19); the specimen reuses it.

**Copy-link press.** "Copy link" → "Copied" (fade), back after 2 s (fade). The button keeps its width (min 160 px), so nothing jumps.

Specimen: *Components · from the part 1 tokens*.

**Legend:** the same set, with three Legend-specific rules. (1) **Never truncate an address or TXID** — Legend's reader checks characters; Legend's long strings use the link-box styling *without* the clamp. (2) Legend's result is facts, so it is a **ledger on the page**, not a slip. (3) Legend's short explainers (privacy explainer) could become disclosures instead of modals; modals stay for flows (batch input). Proposal only — a Legend design session decides.

## 10. Stage chip

*Share-PreAlpha-1 folded in (13 Oct).*

- **Words:** `Pre-alpha` on the X5-1 staging host → `Alpha` from X5-2 cutover → `Beta` later → gone at 1.0. Sentence case in the source; CSS sets the caps.
- **Form:** Plex Mono 500 10 px, caps, `--fg-muted`, a 1 px `--rule-strong` hairline, radius 4, padding 4 × 6. **Ink and a hairline — never a coloured badge**, never gold, never amber.
- **Place:** in the X5 standalone header, directly after the wordmark: `Refueler Share  [ALPHA]` · then, right-aligned, account (§11) · theme. One 48 px row; fits at 375 px (specimen, all phone frames: no overflow).
- **Both modes.** The receiver sees it too — the recipient is running alpha code as much as the sender.
- **It's a link** to one short paragraph on the X5 landing page (`refueler.io/share/`, "What alpha means"): things will change; links made now may stop working before 1.0; don't send anything you can't send again. Honest scope (P8) in one place, not on every screen.
- **Decided (Rajesh, 13 Oct) — now, not at X5-1:** the chip goes on the **live page now, in the eyebrow row** (both modes; not a link yet — the landing page doesn't exist), then moves to the header at X5-1. The refueler.io homepage Share entry gets the same chip in the same small ship (Rajesh OK'd editing refueler.io from this repo for it). Supersedes the 13 Oct "no chip on the old mirror".
- Not in emails, not in MCP output.

Specimen: the *Stage* control at the top switches every header.

**Legend:** the same chip, same rule, beside "Legend" when Legend has a public build.

## 11. Account / rail indicator

A-7: "Uploading as Citizen · Send without my account" is one row among five and reads as a footnote, but it decides the size cap, whose storage is used, and what's linked to an account.

### 11.1 Two places, one job each

| Where | Says | Signed in, paid Citizen | Signed out | Receiver page |
|---|---|---|---|---|
| **Header**, right, before the theme | **Who this browser is** | `Citizen` — a text link to the signed-in page (Send a file · Sign out · Sign out everywhere) | `Sign in` — a quiet text link, the only entry point | **Nothing.** A recipient never needs an account; "Sign in" there would suggest they do |
| **Slip, first row "Send as"** | **What this upload uses, and what that means** | `Citizen` · *Send without my account* — note "Counts toward your 100 GB." | Row absent | — |
| ~~Same row after one press~~ | | ~~`Without my account` · *Use my account*~~ — **withdrawn, see 11.1a** | | |

### 11.1a No "Send without my account" when signed in — *decided (Rajesh, 13 Oct)*

Reverses B12-4a-2's one-tap opt-out. Rajesh's reason: signed-in people will assume an upload is tracked whatever the button says, and the option invites them to expect account-side tracking either way. **Pushback checked, and it supports him:** the claim "Not linked to your account" would overclaim — the same browser asked `/chambers/session` *with* the cookie seconds earlier, so the Worker sees a signed-in check and a cookie-less upload from the same address moments apart. Unlinked is only honest in a private window or after signing out.

- Signed in, paid: every upload is a Citizen upload. The "Send as" row becomes a plain fact — `Citizen` · **"63 GB free"** (*decided, Rajesh, 13 Oct*; replaces "Counts toward your 100 GB." — needs `/chambers/session` to return free space, B12-4b / Chambers-Design). Until then the live row reads "Uploading as Citizen".
- **Only when the 100 GB is full** does Pro Bono appear, as a way through, not a privacy option: e.g. "Your 100 GB is full. Send this one free, up to 4 GB?" — wording for Chambers-Design; it must not say "not linked".
- Someone who wants an unlinked transfer signs out or uses a private window; the account page (Chambers) can say so in one line.
- Build: **the live toggle stays until this is built properly** (Rajesh, 13 Oct: don't remove it while it's the only way to send when the 100 GB is full). Chambers-Design designs the full-storage offer; X5-1 or B12-4b builds it and removes the toggle in the same change.

- **Never the email address** in the header — screenshots and shoulders. The plan name is enough.
- **Size moves into the File row's note** ("3.2 MB" under the file name) and the expiry note joins its date line, so the extra row costs nothing: Citizen chosen at 375 px keeps "Encrypt and upload" above the fold (specimen: button bottom 652 px of 667).
- **Signed out mid-page** (initiate 401/403, today's `dropAccount`): header → "Sign in"; row → gone; one sentence goes back to the chosen file (B12-4a-2 behaviour, unchanged).
- **One request, as now.** `loadAccount`'s single `/chambers/session` call feeds both places. The receiver page makes no call to the auth host at all (already true; keep it — it means opening a link never sends a cookie anywhere).
- **Open for Chambers-Design:** a signed-in Citizen whose plan has lapsed. Today the page shows nothing (unpaid → Pro Bono silently). Proposed: header "Citizen", row "Without my account" with the note "Your Citizen plan isn't active. Free up to 4 GB." — needs `/chambers/session` to say "signed in, unpaid", which it partly does (`tier`).

### 11.2 What feeds Chambers-Design

"Send as" is the rail slot. It holds whatever principal the upload will be charged to: `Citizen` (identity rail, today) · `Without my account` (Pro Bono) · later `Credits on this device` (anonymous rail, B7 — bearer, nothing to sign in to, so the header shows no name, only the slip row) · a Chartered org's own label in Custom House. The header slot only ever shows an *identity* (Citizen, Sovereign, an org) — never a balance, never a credit count. Chambers-Design decides the area's name and whether Sovereign's local ledger shows in this row.

Specimen: *Stage chip · account* (Citizen), *Account · sending without my account*, *Receiver · ready*; the "Send without my account" link in each frame works.

**Legend:** Legend's credential status icon (a small gold circle, filled / outlined) carries state in colour and shape — the one place Legend breaks "the sentence carries the signal" and "gold marks a reference point". Proposal for a Legend design session: replace it with the same header text slot — e.g. `Private queries` as a text link to the credential modal — so the suite has one indicator. Not decided; noted in Legend's spec.

## 12. The A/B plan — about 30 users, no analytics

### 12.1 What's tested

| # | Variant | vs | Where |
|---|---|---|---|
| P-1 | **Date window** — the % in a small framed aperture, one tone in | Plain % (live today) | Uploading + downloading |
| P-2 | **Minute track** — a tick every 5 %, longer every 25 %, under the line | Plain line | Same |
| P-3 | **Hand tip** — a 2 × 9 px gold tip on the fill | No tip | Same |
| G | **Graded dial** — the Carbon ground lifts 1 % or 2 % toward the centre, with or without fine dither | Flat | Whole page, Carbon only |

**Decided (Rajesh, 13 Oct), first round:** P-3 **hand tip (B) chosen**; P-1 date window and P-2 minute track **dropped** (the window reads as a field, the track is busy at 375 px). G: **Carbon Dial 1 % with dither is the default from X5-1**; 2 % reads as a spotlight; **Paper stays flat** (a printed sheet isn't graded; a lighter centre on a light ground reads as glare). Then **a month of alpha feedback** (from X5-2) before revisiting — this replaces the four-screen gate below, with one ten-minute look on an ordinary non-Apple screen before X5-1 ships. Round 3's `rs-dial` preference is no longer needed for P-1–P-3. In production the dither is a small static PNG tile (`img-src 'self'`), not a canvas data URL.
| H | **Copy tick** — 10 ms on Android | None | Link ready |

Specimen: *Progress · the watchmaker variants* (A plain · B tip · C track · D window · E all three, one simulated 3.2 GB upload at the live cadence) and the *Dial* / *Dither* controls at the top.

### 12.2 Method — three rounds, no telemetry

1. **Rajesh's pass (now, before X5-1).** Safari on the MacBook with Mullvad on, then the iPhone 13 mini and the Pixel 9a. Strike anything he doesn't want; keep a shortlist. He is the design authority — the panel informs, it doesn't vote him down.
2. **Taste panel (X5-1 staging).** Five to eight people whose eye he trusts, in person or over Signal, looking at the specimen on their own device. Two questions per item: *"Which would you rather watch for ten minutes?"* and *"Did either feel busy, slow or like it was selling you something?"* Counts only, no names, kept off-repo.
3. **Local preference in the alpha (X5-2 → decision).** The uploading screen carries one fine-line text link under the readout, **alpha only**: `Plain dial · Watch dial`. First visit picks one at random; the choice is kept in `localStorage` (`rs-dial`) in that browser and **never sent** — no cookie, no request, no server flag. In Rajesh's normal alpha check-in: *"Did you switch the dial? Which one did you keep?"* The setting people keep is the signal. The link is removed when the decision is made.

### 12.3 What decides each

| Item | Ship it if | Otherwise |
|---|---|---|
| P-1 date window | Rajesh keeps it after round 1 **and** most of the panel prefer it **and** it reads at 375 px without wrapping | Plain % |
| P-2 minute track | Nobody in the panel calls it busy at 375 px | Plain line |
| P-3 hand tip | Nobody reads it as a cursor, a fault or a second colour | No tip |
| G graded dial | **No banding** (rings) on all four: MacBook, iPhone 13 mini, Pixel 9a, one ordinary non-Apple screen — with dither if needed — **and** nobody notices it as a spotlight without being told | **Flat** (the default) |
| H copy tick | Rajesh on the Pixel says "crown click", not "notification", **and** no Android alpha user wants it gone | Off (the default) |

**Ties go to the plainer variant** (§4.6a: the more precious, the quieter). Thirty people is a taste panel, not a statistic — the plan says so rather than pretending otherwise.

**Never:** an analytics script, an event ping, a server-side experiment flag, a fingerprint, or "which variant converted better". Share has nothing to convert.

**Legend:** same three rounds. Legend has no progress bar (PIR is text), so only G (graded dial) and P-1's *framing* (a balance or block height in a date window) are candidates — and stewardship mode's stillness rule outranks any variant.

---

## 13. Review round 1 — what was decided (13 Oct, with Rajesh)

Principles (§3) and copy rewrites (§5.3) as written · §6 answers · hand tip; Carbon Dial 1 % + dither, Paper flat, one month of alpha feedback · the touch (200 ms, one tone step) · lede one sentence · Paper slip hairline only · no "Send without my account" while signed in; Pro Bono only when the 100 GB is full (the live toggle stays until that offer is built) · "63 GB free" · **Pre-alpha chip on the live page now** in the eyebrow row (specimen: *Live page now*), header from X5-1, refueler.io homepage entry in the same ship.

Still proposals: §7 motion detail, §8 haptics (pending the iPhone / Pixel checks), §9 components detail, §11.2 rail slot. **Next design rounds (Rajesh):** Chambers-Design builds the account page out fully; a further design round follows a few weeks later, once the alpha has lived with these changes (alongside the dial feedback).

*End of Part 2. Next: Share-PreAlpha-1 (chip ship) → X5-Plan builds the standalone layout from §4 + §7–§11.*
