# Live-music streaming app: research answers

As of **9 October 2026**. These are boundaries and sources, not legal, tax or financial advice.

**Legend**
- ✅ confirmed by a primary source: statute, regulator, spec, official docs or vendor pricing page.
- 🟡 secondary source: law-firm note, blog, forum, press or competitor page.
- 🔵 my inference.
- 🆕 changed in 2025 or 2026, or is announced for 2027.
- **Not found** means I looked and found nothing.

**How sources were read.** Searches ran on 9 Oct 2026. Several primary sites (legislation.gov.uk, developers.cloudflare.com) blocked direct fetching from this environment, so some primary facts were read through search-engine extracts of the primary page. Those are still marked ✅ when the extract was the primary page itself. Prices are in USD unless stated, and were seen on 9 Oct 2026.

---

## Read these five first

1. 🆕 **House-policy collision (R2).** Cloudflare's own "How R2 works" page says R2's **Metadata Service is built on Durable Objects** ✅.
   - **Queues** were rebuilt on Durable Objects in Oct 2024 ✅. **D1** is widely described as built on them 🟡.
   - Since Aug 2025, **Workers KV** stores small values in "the same distributed database that powers R2 and Durable Objects" ✅.
   - If the policy means "nothing built on Durable Objects", then R2, D1 and Queues are out, and KV is arguable.
   - If it means "our code never calls the Durable Objects API", R2 is fine. **You need to decide which before B4 and C1 are designed.**
2. 🆕 **Online Safety Act: you are in scope from day one.** Viewers' live video and messages are both user-generated content.
   - The "limited functionality" exemption fails, because the video is not the platform's own content.
   - The duty to report child sexual abuse material to the NCA has been **in force since 7 April 2026** ✅.
   - Ofcom's livestream measures (no comments or gifts on children's livestreams) are consulted on but **still not final** 🟡.
3. 🆕 **UK cryptoasset regime.** It goes live on **25 Oct 2027**. The FCA application window runs **30 Sep 2026 to 28 Feb 2027** ✅/🟡.
   - Anything where the platform holds or redeems viewers' ecash, or runs a mint, sits squarely inside it.
   - Tokens locked to the creator's own key, which the platform only verifies, are the cleanest design for staying outside.
4. 🆕 **EU VAT for live virtual events moved to the customer's location from 1 Jan 2025** 🟡.
   - A UK seller selling to EU consumers owes VAT from the first euro through non-Union OSS, and must keep **evidence of where the customer is**.
   - That clashes head-on with "the platform never learns who paid".
5. **Cheapest viable live route.** Ingest on a Hetzner box, write HLS to object storage, and serve through Cloudflare with a Worker doing the 402 check.
   - That is roughly **$0 to $5 per 1,000-viewer show**, against $120 to $600 on managed services. It relies on R2, so see point 1.

---

# GROUP A: Needed this month

## A1. Online Safety Act 2023: scope

**Is a paid 140-character message feed a "user-to-user service"?**
- **Yes.** ✅ Section 3(1): content generated, uploaded or shared by one user that "may be encountered by another user" makes a service user-to-user. A feed every viewer sees meets that test.
- 🔵 The creator's **live video is also user-generated content** encountered by viewers. Even with comments switched off, the service is user-to-user because of the video.
- ✅ No accounts are needed for this. The test is about functionality, not registration ([Ofcom regulation checker](https://www.ofcom.org.uk/os-toolkit/regulation-checker/regulation-checker), seen 9 Oct 2026; [bratby.law](https://bratby.law/does-the-online-safety-act-apply/), 2025).

**Does the Schedule 1, paragraph 4 "limited functionality" exemption apply?**
- ✅ Paragraph 4 only exempts a service whose *only* user-generated content is comments, reviews or reactions on **"provider content"**. Provider content means content published by or on behalf of the provider ([Sch. 1](https://www.legislation.gov.uk/ukpga/2023/50/schedule/1); wording of para 4(2) seen via secondary extract 🟡).
- 🔵 **For your multi-creator platform: no.**
  - The video belongs to the creator, so it is not provider content.
  - The video is itself user-generated content, so the "only" condition fails twice over.
- 🔵 **For a venue streaming only its own gigs on its own server: possibly yes.** The venue is both the provider and the publisher, so comments on its own video could be "comments on provider content".
  - It falls away the moment guests, other acts' streams, or anything beyond comments, reactions and identifying content appears.
- ✅ No other Schedule 1 exemption fits: email, SMS or MMS; one-to-one live aural communication; internal business services; public bodies; education.

**Do paid messages, no accounts, a sole-trader provider, or few UK users change anything?**
- Paid messages: no change 🔵. Payment adds friction, which helps your risk assessment, but it is not an exemption.
- No accounts: no change ✅ (see above).
- Sole trader: no change ✅. Section 226(3) treats individuals as the provider when no entity controls access ([s.226](https://legislation.gov.uk/cy/ukpga/2023/50/section/226/2024-01-31?view=plain)).
- Few UK users: no change ✅. "Links with the UK" (s.4) is met if the UK is a target market, or there is a significant number of UK users. A UK-based founder marketing in the UK meets it. **There is no minimum-user threshold.**
- Ofcom enforces against small services:
  - It reviewed 104 risk-assessment records in 2025 🟡 ([Ofcom bulletin, Dec 2025](https://www.globaldatinginsights.com/knowledge-partners/ofcom/ofcom-online-safety-bulletin-december-2025/)).
  - It fined 4chan £20,000 for ignoring information requests about its risk assessment 🟡 ([Computing, Oct 2025](https://www.computing.co.uk/news/2025/legislation-regulation/ofcom-fines-4chan-twenty-thousand)).

**Duties from day one, and the smallest compliant set for a tiny, low-risk service**

Ofcom sizes services as "large" (over 7m monthly UK users) or smaller, then by risk: low, specific or multi-risk ✅ ([Osborne Clarke on the final codes, Dec 2024](https://www.osborneclarke.com/insights/ofcom-publishes-final-illegal-content-risk-assessment-guidance-and-codes-practice-under-uk)). The minimum set:

1. **Illegal content risk assessment.**
   - Written, using Ofcom's Risk Profiles. It was due by 16 March 2025 for existing services ✅; new services do it before launch 🔵.
   - Keep it under review, and redo it before any significant change, such as adding live video, guests or DMs.
   - 🔵 Livestreaming is a named risk factor in Ofcom's risk register for grooming and CSEA, so expect it to push you towards "specific risk" for those harms.
2. **Children's access assessment** ✅ (deadline for existing services was 16 April 2025).
   - Without highly effective age assurance, stage 1 (can children access it?) is "yes".
   - Stage 2 asks whether there is a "significant number" of child users, or the service is likely to attract them. 🔵 A live-music service plausibly fails that test.
   - If children are likely to access it, a **children's risk assessment** and the Protection of Children Codes apply (in force 25 July 2025 ✅, [RPC, May 2025](https://www.rpclegal.com/thinking/tech/online-safety-act-2023-children-codes-published-by-ofcom/)).
3. **Records** of every assessment and of the measures you took (s.23) ✅.
4. **Code measures that apply to all user-to-user services, including small low-risk ones** 🟡 (from the Dec 2024 codes as summarised by law firms; check Ofcom's codes text):
   - A **named individual accountable** for illegal-content and complaints duties.
   - A **content moderation function** that reviews suspected illegal content and **takes it down swiftly**.
   - A **reporting and complaints route** that is easy to find and use, acknowledges complaints and allows appeals.
   - **Terms of service** that say how users are protected from illegal content, written clearly.
5. **CSEA reporting to the NCA** 🆕 ✅ (see E1 and E2). This means registering with the NCA and reporting any CSEA content you detect.
6. **Respond to Ofcom information notices.** Ignoring them is what got 4chan fined.

Not applicable: fees ✅ (only above £250m qualifying worldwide revenue) and categorisation ✅ (thresholds start at 3m users).

**Who is the "provider" if a venue runs the open-source software on its own server?**
- ✅ Section 226(2): the provider is "the entity that has control over who can use the user-to-user part of the service". The venue running its own instance is the provider of that instance.
- 🔵 You, as author of the software, are not the provider of their instance.
- 🔵 If you host instances for venues (managed SaaS) and you control access, you are likely the provider, or at least a co-candidate. Your contract and the admin panel decide it.

**So what:** Treat the paid feed as an in-scope user-to-user service now: one written risk assessment, a children's access assessment, a report button, a takedown process, a named person, plain terms and NCA registration. A weekend of paperwork beats a £20k fine.

---

## A2. Moderation without accounts, for a paid live comment feed

**Practical patterns**
- **Word and phrase filters**
  - Lists: the "List of Dirty, Naughty, Obscene and Otherwise Bad Words" on GitHub (multi-language) 🟡; build your own per-creator lists on top.
  - Unicode evasion: normalise with Unicode NFKC, then map look-alike characters using the **Unicode TR39 confusables "skeleton"** ✅ (Unicode standard). Then fold leetspeak (0→o, 1→i, $→s) and strip zero-width and combining marks 🔵.
  - False positives: the "Scunthorpe problem". Match on word boundaries and keep an allow-list 🔵.
  - Other languages: per-language lists are weak; a classifier does better. **Llama Guard runs on Cloudflare Workers AI** 🟡, which keeps text off third-party moderation APIs.
- **Rate limits.** The payment is itself the rate limit. Add a per-browser-key cooldown, for example one message per 10 s 🔵.
- **Slow mode.** A room-wide minimum interval, switched by the host 🔵.
- **Hold for review.** Anything matching a soft list goes to a queue, visible only to the sender and moderators until approved. YouTube works the same way ✅.
- **Host "comments off" switch.** A room flag checked on every post. It must also stop new tip-plus-message payments, not just hide messages 🔵.
- **Moderators without accounts.** The host creates a **moderator capability link** 🔵:
  - It holds a random 128-bit token, scoped to one show.
  - It can be revoked or rotated, and the server stores only a hash of it.
  - Keep the token in the URL fragment so it never reaches server logs.

**What can "block this viewer" act on, and what does each cost in privacy?** 🔵

| Handle | Strength | Privacy cost |
|---|---|---|
| A **browser-held keypair**, new for each show (pubkey sent with each message) | Defeated by clearing storage, but the next message still costs money | Lowest: pseudonymous and unlinkable across shows if rotated |
| **The payment** | Cashu ecash is **unlinkable by design** (blind signatures), so you *cannot* block by payment ✅. A Lightning payment hash identifies a payment, not a person | None, but useless for blocking |
| **IP address** | Strong short-term. Over-blocks behind CGNAT and **venue Wi-Fi, where the whole room shares one IP** | Highest. An IP address is personal data under UK GDPR ✅ (ICO position). If used at all: keyed hash, held in memory, deleted at show end |

Recommendation 🔵: a per-show browser key, the payment friction, and a short-lived hashed-IP rate limit. Never a persistent IP blocklist.

**How the big platforms do it**
- **YouTube live chat** ✅ ([moderate live chat](https://support.google.com/youtube/answer/9826490); [comment settings](https://support.google.com/youtube/answer/9483359), seen 9 Oct 2026):
  - "Blocked words": messages containing or closely matching them are blocked.
  - "Hold potentially inappropriate messages": None, Basic or Strict.
  - Moderators, slow mode, and subscriber-only or members-only modes.
- **Twitch AutoMod** 🟡 (sources conflict on the exact category list):
  - Levels 0 to 4 across categories such as discrimination, sexual content, hostility and profanity.
  - Held messages wait for a moderator. There are blocked and permitted terms lists.
  - **Shield Mode** (since Nov 2022) tightens everything with one click ([Twitch blog, 2017](https://blog.twitch.tv/en/2017/05/18/automod-2-0-personalization-update-445c148098f8); [Brandbastion guide](https://blog.brandbastion.com/how-to-set-up-twitch-moderation-and-keep-chat-safe)).
- **Instagram Hidden Words** 🟡: a default offensive-term filter plus custom words and emojis, applied to comments and message requests. Whether it applies to Live comments too: **not confirmed**.
- **zap.stream / Nostr** 🟡: moderation is client-side. The streamer's and moderators' **mute lists** (NIP-51) and reports (NIP-56) decide what each client hides. Relays may still carry the content. Exact zap.stream behaviour: not confirmed.

**What happens to the money when a paid message is removed?**
- **YouTube Super Chat** ✅: moderated or removed Super Chats are **not refunded** ([YouTube Help](https://support.google.com/youtube/answer/9178363)).
  - For removals for policy breaches, YouTube says it donates its share to charity. That is confirmed for **Super Thanks**; for Super Chat it is only 🟡 ([Creator Essentials glossary](https://www.creatoressentials.com/glossary/super-chat/)).
  - The creator's share on removed Super Chats: **not found** in an official source.
- 🔵 **Your model:** the tip has already reached the creator, so the platform has nothing to refund. Put "removal ≠ refund; creator may refund at their discretion" in the terms and on the pay button.

**So what:** Ship a key per show, a filter with confusables handling, a hold queue, slow mode, comments-off and moderator links. Blocking by IP is a liability at venues, and blocking by payment is impossible with ecash, which is the point of ecash.

---

# GROUP B: Live video route

## B1. Going live from a phone browser

**Can iOS Safari (18 and 26) and Android Chrome publish over WHIP today?**
- **Yes, in principle** ✅. WHIP is just an HTTP POST of an SDP offer plus a standard RTCPeerConnection, which both browsers support.
  - 🆕 WHIP became **RFC 9725 in 2025** ✅ (IETF). WHEP is still an IETF draft 🟡.
  - Any JavaScript WHIP client works; there is no special browser support to wait for.

**Limits**
- **Screen lock and background tabs**
  - iOS: **capture stops**. WebKit bug reports show camera tracks ending or losing video after backgrounding or a lock-unlock. Audio may keep going while video stops 🟡 ([WebKit 259337](https://bugs.webkit.org/show_bug.cgi?id=259337); Flashphoner forum).
  - Android: background camera access is blocked for any app not in the foreground, Chrome included 🟡.
  - 🔵 Plan on: keep the screen on with the **Screen Wake Lock API** (Safari 16.4+ ✅), tell the creator to disable auto-lock, and auto-resume (re-call getUserMedia, then restart WHIP) on `visibilitychange`.
- **Codecs**
  - Both browsers: H.264 and VP8 ✅. VP9 is widely available 🟡.
  - AV1 in WebRTC: Chrome yes 🟡; Safari **not confirmed** (one third-party guide says no).
  - 🔵 Use **H.264** for compatibility with ingest servers, which often can't take VP9 or AV1 over WebRTC.
- **Resolution and frame rate.** 720p30 is reliable; 1080p30 works on recent iPhones. Apple publishes no browser cap 🔵. Request it with `width`/`height`/`frameRate` constraints and read back `getSettings()`.
- **Portrait vs landscape**
  - 🟡/🔵 libwebrtc often **signals rotation in an RTP header extension** (CVO) instead of rotating pixels.
  - Ingest servers that ignore CVO produce **sideways video**. Test MediaMTX and SRS with a portrait iPhone before promising vertical.

**Music: can echo cancellation, noise suppression and auto gain be turned off, and does iOS honour it?**
- Chrome Android: generally honours all three set to `false` 🔵.
- iOS Safari:
  - **`echoCancellation:false` is honoured** in that it changes the capture path: reports show stereo or left-channel-only tracks when it's off 🟡 ([WebKit 281978](https://bugs.webkit.org/show_bug.cgi?id=281978), Oct 2024; [Apple forums](https://developer.apple.com/forums/thread/804765), Safari 26).
  - **`noiseSuppression` is listed as unsupported on iOS** (MDN compatibility data 🟡).
  - Full "raw" capture: **not confirmed**. Test on a device.
- 🔵 Better audio for musicians: an external USB interface (iPhone 15+ has USB-C), and mono downmix done in Web Audio.

**Thermal and battery over 2 hours**
- **Not found** as measured data.
- 🔵 Expect: hardware H.264 at 720p30 is sustainable when plugged in. 1080p plus screen-on plus 5G uplink risks thermal frame-rate drops after 30 to 60 minutes. Advise mains power, 720p, no case, and Wi-Fi.

**What changed in WebKit's WebRTC in 2025–26** 🆕 ✅
- Safari 26.0: RTCEncodedFrame constructors and serialisation, CSRC exposure, and fec/rtx removed from encoding parameters ([WebKit, Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
- Safari 26.2: `encrypted` RTP header extensions ([WebKit, Safari 26.2](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/)).
- Safari 26.5: `maxFramerate: 0` allowed ([WebKit, Safari 26.5](https://webkit.org/blog/17938/webkit-features-for-safari-26-5/)).
- Safari 26.6: relay-only ICE fix ([WebKit, Safari 26.6](https://webkit.org/blog/18178/webkit-features-for-safari-26-6/)).
- Safari 18.4: MediaRecorder WebM/VP9/AV1 (see B8) 🟡.
- RTCRtpScriptTransform (encoded transforms) has shipped since Safari 15.4 ✅. That matters for B2's key-rotation idea.

**So what:** Browser WHIP from a phone works, but only with the screen on and the page in front. Build auto-resume and a "keep this screen open" UI. Test portrait rotation and audio processing on real iPhones before promising musicians anything.

---

## B2. Delivery protocol for a per-segment paywall

**Latency and player support**

| | Glass-to-glass latency | iOS Safari | Android Chrome | Poor mobile network |
|---|---|---|---|---|
| WebRTC / WHEP | ~0.3–1 s 🟡 | Native RTCPeerConnection ✅ | ✅ | Degrades quality fast; small buffer, so stutters rather than stalls 🔵 |
| LL-HLS | ~2–5 s 🟡 | Native ✅; hls.js via **Managed Media Source on iPhone since iOS 17.1** ✅ | hls.js (MSE) ✅ | Recovers well; parts and blocking reloads add request load 🔵 |
| HLS, 2 s segments | ~6–10 s 🔵 | Native, or MMS + hls.js | hls.js | Robust |
| HLS, 10 s segments | ~30 s+ 🔵 | same | same | Most robust |

- ✅ RFC 8216 §6.3.3: players should not start less than **3 target durations** from the live edge. With 10 s segments that alone is about 30 s.
- 🔵 Your 10 s payment unit therefore pushes you to *pay* per 10 s while *delivering* in shorter segments.

**Which protocols allow per-segment or per-time-slice authorisation?**
- **Plain HLS: yes, simplest.** Every segment is a separate GET, so the Worker returns 402 or 200 per segment.
- 🔵 **Better pattern: gate the key, not the segment.**
  - HLS supports **AES-128 or SAMPLE-AES with a key per segment** via `EXT-X-KEY` ✅ (RFC 8216 §4.3.2.4).
  - Encrypt each 10 s slice with its own key and make the **key URI** the 402 endpoint.
  - Segments then become identical for everyone and fully CDN-cacheable; only the tiny key fetch is paid.
- **iPhone caveat** 🔵: the native Safari player cannot run a 402 challenge or add custom headers.
  - Use **hls.js on Managed Media Source** (iOS 17.1+) with a custom loader that pays on 402 and retries.
  - MMS cannot AirPlay without a native HLS fallback ✅/🟡 ([Radiant Media Player](https://radiantmediaplayer.com/blog/at-last-safari-17.1-now-brings-the-new-managed-media-source-api-to-iphone.html); [WebKit 274142](https://bugs.webkit.org/show_bug.cgi?id=274142)).

**Do LL-HLS partial segments, preload hints and blocking playlist reloads break per-request payment?** They complicate it 🔵:
- **Parts** (~0.3–1 s each) multiply requests. Authorise on the *parent* media sequence number, not per part. One payment unlocks every part of that 10 s slice.
- **Preload hints** make the player request a part *before it exists*. A 402 on a hint is a wasted payment round-trip. Pay ahead, one slice early.
- **Blocking playlist reloads** hold requests open up to 3× target duration ✅ ([Fora Soft glossary](https://www.forasoft.com/learn/video-streaming/glossary/terms-streaming/blocking-playlist-reload)). Never gate the playlist with 402; gate media or keys only.
- Some CDNs check tokens only at the start of a connection 🟡 ([Tenbyte docs](https://docs.tenbyte.io/docs/cdn/distributions/access-rules/token-authentication)).
- 🔵 **Practical answer:** pay per 10 s slice and receive a short-lived bearer **access token** (an HMAC over room, slice range and expiry). The loader attaches it to every part and key request, and only the token refresh hits 402.

**How would WebRTC be gated every 10 seconds?** 🔵
- **(a) Server kill-switch.** The viewer pays over a data channel or HTTP, the app server keeps a "paid until" time, and on expiry asks the SFU to close that viewer's subscribed tracks. Cloudflare Realtime exposes track close via its API 🟡.
- **(b) Rotating media keys.** Encrypt frames with RTCRtpScriptTransform (SFrame-style) and rotate the key every 10 s. Only paying viewers get the next key over the data channel.
  - Safari has supported this since 15.4 ✅. Chrome's standard-track support: not confirmed.
  - This mirrors the HLS key-gating idea and needs no SFU cooperation.

**So what:** For a 10 s pay unit, use HLS with 2 s segments, keys rotating every 10 s and a 402 on the key, played through hls.js on Managed Media Source. Keep WebRTC for guests (C4) and an optional "front row" low-latency tier gated by key rotation.

---

## B3. Cost table: one 2-hour show

**Assumptions**
- 120 min show; every viewer watches the whole show; one rendition (no adaptive ladder).
- 720p at 2.5 Mbps = **2.25 GB per viewer**; 1080p at 5 Mbps = **4.5 GB per viewer**.
- Totals by audience size:

| Viewers | Viewer-minutes | Viewer-hours | GB at 720p | GB at 1080p |
|---|---|---|---|---|
| 10 | 1,200 | 20 | 22.5 | 45 |
| 100 | 12,000 | 200 | 225 | 450 |
| 1,000 | 120,000 | 2,000 | 2,250 | 4,500 |

- "First" = first show in the month, using that month's free allowance. "Marginal" = after the allowance is used up. All USD.

**Unit prices used** (seen 9 Oct 2026)
- **Cloudflare Stream** ✅: $1 per 1,000 minutes delivered, any resolution; storage $5 per 1,000 minutes prepaid; ingest and encode free ([Stream pricing](https://developers.cloudflare.com/stream/pricing/)).
- **Cloudflare Realtime SFU** ✅: $0.05/GB egress, 1,000 GB/month free, shared with TURN ([Realtime pricing](https://developers.cloudflare.com/realtime/sfu/pricing)).
- **Mux** 🟡: delivery $0.0008/min at 720p, ×1.25 for 1080p; 100k delivered minutes free per month; $20/month credit ([VSLBench, read 28 Sep 2026](https://vslbench.com/reviews/mux/pricing)).
  - ✅ Live streams must use "plus" or "premium" quality, which carries a per-minute encoding charge ([Mux docs](https://www.mux.com/docs/pricing/video)). **The live encoding rate itself was not found.**
- **LiveKit Cloud** 🟡 (official page not retrieved; [checkthat.ai](https://checkthat.ai/brands/livekit/pricing)):
  - Build: free, 5k participant-min, 50 GB.
  - Ship: $50/month, 150k participant-min, 250 GB; then $0.0005/min and $0.12/GB.
  - Scale: $500/month, 3 TB, $0.10/GB.
- **Amazon IVS** 🟡 ([VideoSDK](https://www.videosdk.live/blog/amazon-ivs-pricing-and-alternatives); [AWS IVS pricing](https://aws.amazon.com/ivs/pricing/) structure ✅):
  - Low-latency input: Standard $2.00/h (adaptive ladder) or Basic $0.20/h.
  - Output, North America first tier: HD $0.072 per viewer-hour, Full HD $0.144. Europe is about the same 🟡.
  - Real-time stages: $0.072 per participant-hour; input capped at **720p** ✅ ([IVS features](https://aws.amazon.com/ivs/features/)).
- **Bunny Stream Live:** closed preview 🟡 ([Bunny changelog](https://bunny.net/docs/stream/changelog)). **Pricing not found.**
  - For self-made HLS, Bunny's CDN is about **$0.01/GB in Europe and North America**, and its "volume" network about $0.005/GB 🟡 ([Bitdoze review](https://www.bitdoze.com/bunny-net-review/)).
- **Hetzner** ✅ ([price adjustment of 15 June 2026](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)):
  - CX23 **€5.49/month** (was €3.99); CCX13, with dedicated vCPUs for transcoding, **€42.99/month** (was €15.99). Excluding VAT and IPv4.
  - 20 TB/month traffic included in the EU; overage about €1/TB 🟡.
- **R2** 🟡/✅: storage $0.015/GB-month; Class A $4.50/M; Class B $0.36/M; free tier reportedly 10 GB, 1M Class A and 10M Class B per month; **no egress fees** ([Filebase, 2026](https://filebase.com/blog/cloudflare-r2-pricing-costs-savings-and-alternatives-in-2026/)).
- **Workers Paid** 🟡: $5/month; 10M requests included, then $0.30/M; 30M CPU-ms included, then $0.02 per million CPU-ms.

**Per-show cost (USD)**

| Option | 10 × 720p | 100 × 720p | 1,000 × 720p | 10 × 1080p | 100 × 1080p | 1,000 × 1080p |
|---|---|---|---|---|---|---|
| Cloudflare Stream (HLS, ~6–20 s latency) | 1.20 | 12 | **120** | 1.20 | 12 | **120** |
| Cloudflare Realtime SFU (WHEP), first / marginal | 0 / 1.13 | 0 / 11.25 | **62.50 / 112.50** | 0 / 2.25 | 0 / 22.50 | **175 / 225** |
| Mux delivery only, first / marginal (+ unknown live encoding) | 0 / 0.96 | 0 / 9.60 | **16 / 96** | 0 / 1.20 | 0 / 12 | **20 / 120** |
| LiveKit Cloud (all viewers on WebRTC), first / marginal | 0 (Build) | 50 (Ship) / 33 | **290 / 330** | 0 (Build) | 74 / 60 | **560 / 600** |
| IVS low-latency (Standard input $4 + output) | 5.44 | 18.40 | **148** | 6.88 | 32.80 | **292** |
| IVS real-time stage (max 720p) | ~1.58 | ~14.50 | **~144** | n/a | n/a | n/a |
| Bunny CDN delivering your own HLS (standard / volume) | 0.23 | 2.25 | **22.50 / 11.25** | 0.45 | 4.50 | **45 / 22.50** |
| **Hetzner + R2 + Worker with 402** (marginal) | ~0 | ~0 | **~0.40–4.75** | ~0 | ~0 | **~0.40–4.75** |

Cloudflare Stream also needs a $5/month storage minimum if you record 🔵.

**How the self-run line was worked out** 🔵
- **Fixed:** €5.49/month for a passthrough CX23 (€42.99 if it transcodes), plus $5/month Workers Paid.
- **Upload:** the box sends one copy to R2, 2.25 or 4.5 GB per show, well inside its 20 TB.
- **R2 Class A (writes):** 1,440 PUTs per show at 10 s segments, 7,200 at 2 s. Free.
- **R2 Class B (reads):** worst case with no edge cache, 1.44M–7.2M per show at 1,000 viewers, about $0.52–2.59 once past 10M per month. With edge caching it's near $0.
- **Workers:** the same 1.44M–7.2M requests, about $0.43–2.16 once past the included 10M. CPU is about 1–3 ms per request (signature and DLEQ checks), inside the included allowance at this scale.
- **Egress:** $0.

**Caveats**
- The self-run route depends on R2 (see "Read these five first", point 1) and on Cloudflare's video terms (B4).
- Serving directly from Hetzner is not a substitute:
  - 1,000 × 2.5 Mbps is **2.5 Gbps sustained**, and each 720p show uses 2.25 TB of the 20 TB allowance 🔵.
  - The NIC throughput Hetzner guarantees for a cloud VM was **not found**.

**So what:** The managed services charge $100 to $600 for a 1,000-viewer show; self-run plus Cloudflare costs pocket change. The whole cost advantage rests on whether R2's Durable Objects metadata layer is allowed under house policy.

---

## B4. Cloudflare R2 plus CDN as a live HLS origin

**R2 Class A and B costs for 1,000 viewers.** See B3: writes are free-tier trivial, and reads are $0–2.59 per show worst case. 🔵 Use a Worker that does the 402 check, then serves from the Cache API or a cached fetch, so most reads never reach R2.

**Caching a fast-changing playlist** 🔵
- **Media playlist:** `Cache-Control: max-age=1` (no more than half the part or segment duration) and `stale-while-revalidate=1`. Respect the origin header.
  - Cloudflare's Edge TTL override minimums differ by plan 🟡, so rely on origin headers, not Cache Rules.
  - **R2 is strongly consistent** ✅ ([How R2 works](https://developers.cloudflare.com/r2/how-r2-works/)), so a 1 s TTL is safe.
- **Segments and keys-ciphertext:** immutable, `max-age=31536000`.
- **Key responses:** `no-store`, since they are per payment.
- Alternative: the Worker builds the playlist from a tiny "latest MSN" object, which avoids a playlist PUT per segment.

**Worker CPU and request costs.** See B3: about $0.43–2.16 per 1,000-viewer show beyond the included 10M requests per month.
- 🟡 The Free plan allows 10 ms CPU per request and 100k requests a day, which is not enough for a show.
- 🟡 Paid: 30 s CPU by default, up to 5 min. Waiting on the network doesn't count as CPU ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)).

**Cloudflare's terms on serving video**
- ✅ **16 May 2023:** the old self-serve §2.8 ban was replaced by a CDN-only restriction in the Service-Specific Terms.
  - Video and large files are allowed through the CDN **when hosted on Cloudflare Stream, Images or R2**.
  - Video hosted elsewhere and pushed through the plain CDN is still restricted ([Cloudflare blog](https://blog.cloudflare.com/updated-tos/); [Service-Specific Terms](https://www.cloudflare.com/service-specific-terms-application-services)).
- **Free and Pro plans:** 🔵 yes. The test is *where the bytes are hosted*, not the zone plan. To be safe, use the Paid Workers plan and serve from R2 via a Worker or an R2 custom domain.
- **2025–26 updates to these terms: not found.**
- 🔵 **Do not** proxy HLS from the Hetzner box through the orange-cloud CDN directly. That is exactly the "hosted elsewhere" case.
- 🆕 R2's metadata is built on Durable Objects ✅. That is a policy issue, not a terms issue.

**So what:** R2 plus a Worker is permitted for video on cheap plans, costs almost nothing at 1,000 viewers, and is strongly consistent. Your blocker is internal policy, not Cloudflare's terms. If R2 is vetoed, Bunny CDN plus Bunny Storage is the next-cheapest compliant route.

---

## B5. RTMP, SRT and WHIP ingest

**The cheapest robust ingest servers** (all free, open source; descriptions 🟡/🔵 unless marked)

| | Inputs | Outputs | Notes |
|---|---|---|---|
| **MediaMTX** (Go, single binary) | RTMP(S), SRT, WHIP, RTSP | HLS and LL-HLS, WebRTC/WHEP, recording | Per-path auth with an HTTP webhook or JWT. Easiest on a €5 VPS. No built-in transcoding; uses ffmpeg hooks |
| **SRS** (C++) | RTMP, SRT, WHIP | HLS, WebRTC, HTTP-FLV | Mature; good at RTMP to WebRTC |
| **OvenMediaEngine** | RTMP, SRT, WHIP | LL-HLS, WebRTC | **Built-in adaptive transcoding**; signed-policy auth; heavier |
| **nginx-rtmp** | RTMP | HLS | Effectively unmaintained upstream; avoid for new work |
| **Cloudflare Stream live inputs** | RTMPS, SRT, WHIP (beta) | HLS/DASH, WHEP (beta) | Managed; per-input keys; $1 per 1,000 minutes delivered ✅ |

**RTMPS vs SRT vs WHIP from OBS**
- OBS gained **WHIP output in 30.0** (Nov 2023) ✅ ([OBS WHIP guide](https://obsproject.com/kb/whip-streaming-guide)). SRT has been in OBS since v27 🟡.
- WHIP simulcast (several quality layers): the OBS knowledge base said "not yet in a release" as of 32.0.1; one vendor says it is supported from **32.1.0** 🆕🟡 ([GetStream WHIP docs](https://getstream.io/video/docs/api/streaming/whip/)).
- 🔵 Default to **SRT** for streamers on flaky uplinks: it has packet-loss recovery and a configurable latency buffer.
- 🔵 Offer **RTMPS** for compatibility: Streamlabs, Restream and every hardware encoder support it.
- 🔵 Offer **WHIP** for sub-second latency and browser publishing.

**Transcode an adaptive ladder, or pass through?** 🔵
- Pass through by default: near-zero CPU, so a €5.49 CX23 handles several streams.
- A 1080p to 720p/480p/360p ladder with x264 veryfast needs about **4–6 dedicated vCPUs per stream**, roughly a CCX13 (€42.99/month) or bigger per concurrent show.
- Cheaper: have the encoder do it, with OBS Enhanced Broadcasting or multitrack, or WHIP simulcast; or offer one extra low rendition only.

**Per-streamer stream keys without accounts** 🔵
- Issue a key as a **capability**: 128-bit random, shown once, stored as a hash, bound to one show or "channel".
- **Rotate** by issuing a new link; **revoke** by deleting the hash.
- The ingest server checks keys through MediaMTX's auth webhook against your SQLite.
- Optionally let the creator protect the "channel" with a passphrase-derived keypair, so recovery needs no email.

**So what:** MediaMTX on the €5 box, with SRT, RTMPS and WHIP in, LL-HLS out, keys checked by webhook and passthrough only. Transcoding is the line item that turns a €5 box into a €43 one.

---

## B6. Multistream and relay out

**Options**
- **Restream** 🟡 (mid-2026 reviews, [Learning Revolution](https://www.learningrevolution.net/restream-review/)):
  - Free: 2 channels with a watermark. Standard: about $16/month (annual) or $19 (monthly), 3 channels.
  - Professional: $39/$49, 5 channels, 1080p. Business: $199–299, 8 channels, SRT in.
- **Streamlabs Multistream** ✅/🟡: needs **Ultra ($27/month or $189/year)** for 3+ destinations.
  - Dual output (1 horizontal + 1 vertical) is **free** ✅ ([Streamlabs Dual Output](https://streamlabs.com/multistream/dual-output)).
- **Cloudflare Stream live outputs** ✅: **up to 50 RTMP or SRT outputs per live input**, toggled mid-broadcast. Each output's minutes are billed as delivery at $1/1,000 min, so **6 platforms × 120 min = $0.72 per show** ([Stream simulcasting](https://developers.cloudflare.com/stream/stream-live/simulcasting)).
- **Self-relay with ffmpeg or MediaMTX** 🔵: `-c copy` per destination uses almost no CPU. It needs about 6 × 5 Mbps = 30 Mbps upstream from the VPS, within the 20 TB at this scale.

**Platform rules and RTMP access**
- **Twitch** ✅/🟡: simulcast restrictions lifted on **20 Oct 2023** for Partners and Affiliates, except under exclusivity deals ([Restream on Twitch rules](https://restream.io/blog/twitch-multistreaming-rules-explained/)). Conditions:
  - The Twitch experience must be at least as good as elsewhere.
  - **No merged chat shown on the Twitch broadcast**.
  - Don't send Twitch viewers to the concurrent stream elsewhere.
- **YouTube, Kick:** simulcast allowed. Kick Partner payouts may be reduced when multistreaming 🟡.
- **Facebook:** RTMP with persistent keys via Live Producer 🔵.
- **Instagram** 🆕🟡:
  - RTMP via **Live Producer**, desktop only, for **Professional accounts**, with a key that **expires per session** ([StreamYard, Jan 2026](https://streamyard.com/blog/streaming-software-for-instagram-live)).
  - From **Aug 2025**, Live requires a **public account with 1,000+ followers** ([PetaPixel, 4 Aug 2025](https://petapixel.com/2025/08/04/you-need-1000-followers-to-livestream-on-instagram-now/)).
  - The cap on session length via RTMP is unclear: about 1 h per StreamYard vs 4 h in-app 🟡.
- **TikTok** 🟡: stream keys need about **18+ and ~1,000 followers**, and are **not guaranteed**; some regions lack them. LIVE Studio is the keyless route ([Dacast, 2026](https://www.dacast.com/blog/how-to-live-stream-on-tik-tok)).

**Patterns so a free public stream doesn't undercut a paid one** 🔵
- First song or first 10 minutes public on all platforms, then the outputs switch off (Cloudflare can toggle per output ✅) and a slate says "continue at …".
- ⚠️ Twitch's "don't drive viewers to a concurrent stream" rule makes promoting a *simultaneous* paid stream on Twitch risky. End the Twitch output first, then promote.
- Public 480p with a watermark; paid HD with the full set and no talk-over.
- Public "lobby" stream before doors, as on YouTube premieres; paid show after.
- Paid replay only.

**So what:** For a solo developer, Cloudflare Stream live outputs (pennies, toggleable) or an ffmpeg relay are enough. Don't build a Restream competitor, and read each platform's simulcast clause before the teaser pattern goes live.

---

## B7. Vertical and horizontal at once

**How the tools produce both formats**
- **Streamlabs Dual Output** ✅: two canvases with separate scenes, encoded locally; free for one destination per orientation.
- **OBS + Aitum Vertical plugin** 🟡: a second canvas and output in OBS, free.
- **Twitch Dual Format** 🆕🟡: built on Enhanced Broadcasting (the creator's GPU encodes a ladder), announced **May 2025** with Aitum, and still **beta at TwitchCon Europe 2026** ([Twitch blog, 31 May 2025](https://blog.twitch.tv/en/2025/05/31/ten-years-of-twitchcon-here-s-what-we-announced-in-rotterdam)). Enhanced Broadcasting needs a capable GPU and about 12 Mbps upload 🟡.
- **Server-side** 🔵: ffmpeg crop from 16:9 to 9:16 (centre crop keeps only about 32% of the width), or pillarbox with a blurred fill.

**Is server-side reframing good enough for a single phone camera?** 🔵
- Shoot in the orientation of your main audience.
- Portrait to landscape with a blurred fill looks acceptable for music.
- Landscape to portrait by centre crop works only if the performer stays centred. A drummer plus guitarist will be cut off.
- Smart reframing (subject tracking) is extra GPU work and not worth it at first.

**Cost of the extra rendition** 🔵
- About 1–2 vCPUs per 720×1280 x264 rendition, roughly the step from a CX23 to a CPX or CCX box (€19–43/month after the June 2026 rise ✅).
- Delivery doubles only for viewers who watch both formats (they won't).

**So what:** Let the creator's OBS or Streamlabs do dual output when they have it. Server-side, offer a blurred-fill vertical only, and only once someone pays for vertical.

---

## B8. Recording and replay

**Recording to object storage (R2)** 🔵 (arithmetic) / ✅ (unit price)
- **720p (2.5 Mbps):** 1.125 GB per hour, about **$0.017 per hour of recording per month** on R2.
- **1080p (5 Mbps):** 2.25 GB per hour, about **$0.034 per hour per month**.
- Storage cost is negligible; the cost is the *decision to hold content*.
- **Reusing the live segments as VOD** ✅ (RFC 8216): keep the segments, write a final playlist with `#EXT-X-PLAYLIST-TYPE:VOD` and `#EXT-X-ENDLIST`. The same 402 per-segment or per-key gate works unchanged.
- **Retention and deletion:** R2 lifecycle rules can auto-delete after N days 🟡. Set a short default (e.g. 30 days), with deletion at the creator's request.

**Alternative where the platform stores nothing**
- **Recording in the creator's browser (MediaRecorder)**
  - Formats: iOS Safari produces **MP4 (H.264/AAC)** since 14.3, and 🆕 **WebM/VP9/AV1 since iOS 18.4** 🟡 ([Addpipe](https://addpipe.com/media-recorder-api-demo/)). Early 18.4 WebM had a **rotation bug** 🟡 ([WebKit 293309](https://bugs.webkit.org/show_bug.cgi?id=293309)). Use MP4 on iOS. Chrome Android records WebM, and MP4 in recent versions 🟡.
  - File size: about **2.25 GB at 720p or 4.5 GB at 1080p for 2 hours** (encoder bitrate may differ).
  - Memory: 🔵 don't hold Blobs in RAM for 2 hours. Use `timeslice` chunks written to the **Origin Private File System**, and test the quota on the device. Capture and recording both **stop if the page is backgrounded** (B1).
- **Recording on the ingest box** 🔵: MediaMTX can record to fMP4 per path. Hand the creator a one-time download link, then **delete after N hours**. The platform holds the file only transiently, which is a much smaller privacy and moderation surface than a library.

**So what:** Replays on R2 cost nothing in storage but make you a host of on-demand content (moderation, PRS rights, takedowns). Recording on the ingest box with a one-time handover is the privacy-first default; sell replays only when a creator opts in.

---

# GROUP C: The live room

## C1. Real-time fan-out on Cloudflare without Durable Objects

**Assumed load** 🔵: about 2 fan-out events per second (messages, aggregated reactions, viewer count), each about 300 bytes. Per 2-hour show:
- 1,000 viewers: about 14.4M deliveries and about 4.3 GB.
- 10,000-viewer burst: 10× that.

| Option | Durable Objects underneath? | Latency | Cost per show at 1,000 viewers | Complexity / notes |
|---|---|---|---|---|
| **SSE from a Worker** | Not inherently, but needs a shared store | depends on store | ~1 request per connection + tiny CPU 🟡 | Workers have **no shared memory between connections**, so each SSE Worker must poll a store. KV is ≤60 s stale ✅; the Cache API is per data centre; **D1 🟡 and R2 metadata ✅ run on Durable Objects**. Ends up polling your VPS anyway |
| **Short polling of a micro-cached JSON** (VPS origin, `max-age=1` via the CDN, or a Worker plus Cache API) | No | 1–3 s | **$0** via the plain CDN (not video, so fine on any plan); ~$1 if a Worker sits in front (3.6M polls at 1 per 2 s) | **Simplest robust option.** Origin sees about one request per second per data centre, not per viewer 🔵 |
| Polling **Workers KV** | KV's storage moved to "the database that powers R2 and DO" in 2025 ✅ | **up to 60 s+** ✅ ([KV docs](https://developers.cloudflare.com/kv/concepts/how-kv-works/)) | cheap | Too stale for chat; fine for an "N watching" count |
| **Cloudflare Queues** | **Yes**: rebuilt on DO (Oct 2024) ✅ | n/a | n/a | Also not a browser fan-out primitive. Excluded |
| **Cloudflare Pub/Sub** | unknown | n/a | **No pricing** | **Private beta with waitlist since 2022**, MQTT; not viable 🟡 ([Pub/Sub docs](https://developers.cloudflare.com/pub-sub)) |
| **Cloudflare Realtime data channels** | Not found | <0.5 s | $0.05/GB after 1 TB free; ~4 GB, so **$0** ✅ | Good if viewers already use WHEP. Overkill for HLS viewers |
| **SSE or WebSocket from a small VPS, proxied through Cloudflare** | No | <0.5 s | **$0** on Cloudflare; €5.49 box | **~100 s idle timeout on Free, Pro and Business** 🟡, so heartbeat every ~30 s. Disable compression and buffering on `text/event-stream`. Node handles 10k idle SSE connections on a small box 🔵 |
| **Ably** | No | <0.1–0.5 s | $29/month + **$2.50 per million messages, counted with fan-out** ✅, so ~**$36** per show | Managed; 10k burst about $360 ([Ably pricing](https://ably.com/pricing)) |
| **Pusher Channels** | No | <0.5 s | Priced by peak connections and messages per day: 1,000 connections exceeds Startup ($49, 500 connections); 14.4M deliveries per day needs a high tier 🟡 | Expensive at fan-out ([BudgetForge, 2026](https://www.budgetforge.dev/tools/pusher-pricing-2026)) |
| **Supabase Realtime** | No | <0.5 s | Pro $25/month base; overage rates for messages and peak connections: **not confirmed** 🟡 | Ties you to Supabase Postgres |
| **Nostr relays** (public, or self-hosted strfry) | No | <1 s | Public relays free; strfry on the VPS ~€0 extra | Public, effectively permanent, signed. Public relays see viewer IPs. Good for interop (C5), not for a private room |

**Durable Objects flags** ✅ unless marked:
- PartyKit: built to expose DO; acquired by Cloudflare in Apr 2024 ([Cloudflare blog](https://blog.cloudflare.com/cloudflare-acquires-partykit)).
- WebSocket Hibernation API: a DO feature.
- Agents SDK: built on DO 🟡.
- Queues ✅; D1 🟡; R2 metadata ✅; Workflows and Containers 🟡.

**So what:** For 10 to 1,000 viewers, micro-cached JSON polling through Cloudflare (1–3 s) plus SSE from the VPS for anyone who wants it is effectively free and has no DO dependency. Reach for Ably only for a 10k burst you can bill for.

---

## C2. Reactions (hearts) at scale

**How the big platforms batch and aggregate**
- **Not found** in primary engineering sources for Instagram, YouTube or Twitch in 2025–26.
- 🔵 The common pattern:
  - The client animates its own taps instantly.
  - It batches taps into "n hearts in the last 1–2 s".
  - The server sums them per room per second and broadcasts one aggregated count.
  - Clients render a *rate* (more floating hearts), not each heart.
  - YouTube's live "reactions" are visibly sampled and aggregated in the UI 🔵.

**Limiting abuse with no accounts** 🔵
- Server-side clamp per connection: at most N per second, excess silently dropped.
- Accept only batched counts, so one request carries at most M hearts.
- A per-show browser key plus a short-lived hashed-IP limit.
- Optional **Cloudflare Turnstile** on the first reaction, which is more privacy-friendly than a CAPTCHA 🟡.
- Or make big reactions cost 1 sat ("super hearts"): payment is the cleanest rate limit.
- Display aggregated rates, so inflating the count gains nothing visible.

**So what:** Hearts are a client animation plus a per-second server sum. Abuse control is clamping, not identity.

---

## C3. Viewer presence without tracking

**Ways to show "N watching" without per-person IDs** 🔵

| Method | Accuracy | Notes |
|---|---|---|
| **Count paid slices**: payments or key fetches for the current 10 s slice | **Exact for paying viewers** | No identifiers needed; your payment design already gives it |
| Count open SSE or WebSocket connections | Exact per server | Over-counts duplicate tabs |
| Heartbeats carrying a **random nonce that rotates every minute**, de-duplicated in a 30 s window | About ±5% | Nonces can't be linked across minutes |
| HyperLogLog over those nonces | ~1–2% error | Only needed at 10k+ |
| Count segment GETs ÷ segments per window | Rough (CDN caching hides requests) | Only usable at the Worker |

**What would Instagram-style "X joined" notices reveal?** 🔵
- They reveal identity (if names exist) and **exact join timing**.
- Combined with chat timing, that lets anyone correlate a pseudonymous message author to a join, and lets a creator see who arrived.
- Privacy-first alternative: show only "the room is filling" (a count curve), plus an optional **self-announced** "Sam from Leeds is here", sent by the viewer as a free message.

**So what:** You get an honest, identity-free viewer count for free from per-slice payments. Never auto-announce joins.

---

## C4. Guests and co-hosts in the browser (2–4 people composited)

**Options**
- **Cloudflare Realtime SFU** ✅: WHIP/WHEP plus a native API, $0.05/GB after 1 TB free. Composite elsewhere.
- **LiveKit** (open-source SFU, or Cloud) 🟡: **Egress** does room composite to RTMP or HLS using headless Chrome. That is CPU-heavy, about 2–4 vCPUs per 1080p composite 🔵.
- **mediasoup** 🔵: a Node library, maximum control, most work.
- **Janus** 🔵: C, with a VideoRoom plugin and RTP forwarders out to ffmpeg.
- **Jitsi** 🔵: a full conferencing app; recording via Jibri is heavy (a Chrome instance per room).
- **VDO.Ninja model** 🔵: peer-to-peer WebRTC from guests into the host's OBS browser sources. **No server cost**, but the host needs OBS and upload bandwidth for every guest.

**Request-to-join and invites with no accounts** 🔵
- A **one-time invite link** (128-bit token in the URL fragment, single use, expires in about 15 minutes, bound to the show).
- Or **"knock"**: the guest types a display name, and the host sees approve or deny over the room channel.
- An approved guest gets a short-lived WHIP publish token for the SFU.

**Compositing on a server vs in the host's browser**
- Browser: `canvas.captureStream()` then WHIP. Safari has supported `captureStream` on canvas for years ✅.
- 🔵 On iPhone, decoding 3 incoming videos, drawing a 720p30 canvas and encoding the output is **marginal**. It is thermally risky over 2 hours and dies if backgrounded (B1). Reliable on a laptop, not on a phone.
- Server: ffmpeg or GStreamer pulling WHEP from the SFU and mixing. One CCX-class box per show (€19–43/month) 🔵.

**Cost for 2 guests × 2 hours** 🔵
- Cloudflare Realtime: host plus 2 guests, each downloading the other two at ~1.5 Mbps, is about **8 GB**. Inside the free 1 TB, so **$0** (marginal $0.40).
- LiveKit Cloud: 3 participants × 120 min = 360 participant-minutes, inside Build's free tier, so **$0** 🟡. Egress composite pricing: **not found**.
- Self-hosted SFU on the VPS: €0 extra unless you composite on the server.

**So what:** Use the Cloudflare Realtime SFU for guests and composite in the *host's laptop browser* or OBS. Phone-as-studio for multi-guest shows is a 2027 feature.

---

## C5. Nostr interop

**Current state of the specs**
- ✅ NIP-53 live events: kind **30311**, addressable. Live chat: kind **1311**, linked by the `a` tag.
- ✅ NIP-57 zaps: kinds 9734 and 9735.
- ✅ NIP-61 nutzaps: the recipient publishes kind **10019** (relays, accepted mints, P2PK pubkey); the sender publishes kind **9321** with a **P2PK-locked Cashu token** ([NIP-61](https://nips.4rs.nl/nips/61)).

**Which apps use them**
- **zap.stream**: the main NIP-53 client. HLS-based, with a self-hostable Rust server; fee reported at about 21 sats/min 🟡 ([OpenSats](https://opensats.org/projects/zapstream)).
- **Fountain** added Nostr livestreams in **Feb 2025** 🟡.
- Amethyst and Primal live features: **not confirmed**.
- Nutzap support is shipping in smaller clients (SatShoot v0.2.0, and the NDK wallet library); "experimental, small amounts" 🟡.

**How many shows run on them:** **not found**. 🔵 Small: tens of concurrent streams, not thousands.

**Can a non-Nostr web app show that chat as a second comment source, and post to it?** 🔵 Yes.
- **Read:** subscribe over WebSocket to relays for `kinds:[1311]` with `#a:["30311:<pubkey>:<d>"]`.
- **Post:** sign with a **key generated in the browser for that show** (no account), or a NIP-07 extension if the viewer has one.
- Optionally publish your show as a 30311 event, so zap.stream users can find it.

**Moderation and Online Safety Act implications** 🔵
- Content pulled from relays and shown on your service is plausibly "user-generated content … encountered by means of the service", so treat it as in scope.
- Apply the same filters, an off switch per room, the host's mute list (NIP-51), and an "external chat hidden by default" setting.
- Remember that relay content cannot be deleted by you; you can only stop displaying it.

**So what:** Nostr chat is a cheap, account-free second source and a discovery channel. Show it filtered and off by default, and treat it as your content for Online Safety Act purposes.

---

# GROUP D: Money

## D1. Non-custodial tipping UX in the browser

**How each mechanism works, and whether it works on iOS Safari with no app**

| Mechanism | How it pays the creator directly | iOS Safari, no app installed? |
|---|---|---|
| **Lightning address** (LNURL-pay, LUD-16/06) | The browser fetches `/.well-known/lnurlp/<name>` and gets a BOLT11 invoice from the *creator's* wallet. Used by zap.stream, Stacker News, Wavlake and Primal 🟡 | **Yes, if the viewer has the in-page Cashu wallet**: it pays the invoice via mint "melt" (NUT-05 ✅). Otherwise a QR code (no use on the same phone) or a `lightning:` link to an installed app |
| **BOLT12 offers** | A reusable offer. Supported natively in Core Lightning, LDK and Eclair; **LND not native** (LNDK or experimental) 🟡 ([Spark research, 2026](https://www.spark.money/research/lightning-bolt12-adoption-progress)) | Only through a wallet or mint that can pay BOLT12; mint support for BOLT12: not confirmed |
| **Nostr Wallet Connect** (NIP-47) | The viewer connects a remote wallet (Alby Hub, Coinos, Primal etc. 🟡) with a **budget** ✅; the page asks it to pay the creator's invoice | **Yes**: it is just a connection string over relays. The best no-app UX if the viewer already has an NWC wallet |
| **WebLN** | A browser extension injects `window.webln` | Mostly desktop; on iOS only via the extension, so effectively **no** 🔵 |
| **Cashu payment request** (NUT-18) to the creator's wallet | `creqA…` request; the token is delivered over Nostr DM or HTTP POST to the creator's wallet ✅/🟡 | **Yes**, from the in-page wallet; the creator's wallet must accept or redeem later |
| **Nutzaps** (NIP-61) | The token is locked to the creator's key and posted to relays; the creator redeems later ✅ | **Yes**; offline-tolerant for the creator |

**Podcasting 2.0 value-for-value** 🟡: keysend streaming split by the `<podcast:value>` tag, usually sent **per minute**, from app-integrated or custodial wallets (Fountain etc.).

**Where users drop off** 🔵, in order:
1. No wallet.
2. Funding the wallet (on-ramp KYC).
3. QR-on-the-same-phone dead end.
4. Invoice expiry or route failure.
5. Fee confusion.

The in-page Cashu wallet removes 1, 3 and 4. It does not remove 2.

**Minimum amounts and fees** 🔵/🟡
- LNURL `minSendable` is usually 1 sat.
- Lightning routing fees are tiny, but mints keep a **fee reserve** when melting (often about 1–2% or a minimum of a few sats).
- A 1-sat tip via melt can therefore fail or cost more than it sends. **Set the minimum tip to about 21–100 sats.**

**2025–26 changes** 🆕
- NWC tooling keeps growing (Alby Hub replaced the older Alby NWC server) 🟡.
- BOLT12 is mainstream outside LND, and Strike can send to offers 🟡.
- Cashu: NUT-26 bech32m payment requests (`creqB`) 🟡, Spilman-channel and batched-mint NUT drafts (Oct–Dec 2025) 🟡, and NUT-24 HTTP 402 in use in Blossom clients 🟡 ([Net::Blossom, Jul 2026](https://metacpan.org/dist/Net-Blossom)).

**So what:** The in-page Cashu wallet paying the creator's Lightning address via melt (or a nutzap) is the only path that works for a stranger on an iPhone with nothing installed. Offer NWC as the second button and set a sensible minimum tip.

---

## D2. Paying every 10 seconds without a custodian

**Options compared** 🔵 unless marked

| Option | Platform custody? | Works per 10 s? | Problems |
|---|---|---|---|
| NWC with a budget | No funds held, but the **app holds spending authority** over the viewer's wallet | 720 Lightning payments a show; 1–5 s each; failures | The wallet sees every payee; fees; latency |
| Keysend streaming (Podcasting 2.0) | No | Usually batched per minute | Needs node-backed or custodial wallets; LND-centric |
| Cashu tokens from the viewer's wallet, **sent to the gate** | **Yes, if the gate receives bearer tokens it can spend** | Excellent (instant, offline) | That *is* custody, unless the tokens are forwarded instantly |
| Cashu payment channels (Spilman) 🆕 | No: 2-of-2 between viewer and creator; the gate only checks viewer signatures | **Ideal**: each 10 s is just a new signature | **Draft spec plus experimental Rust crate** (`cdk-spilman`); "not ready for real sats" 🟡 ([BTC++ insider, Oct 2025](https://insider.btcpp.dev/p/last-week-in-bitcoin-oct-27-nov-2); [docs.rs](https://docs.rs/cdk-spilman/latest/)) |
| **Tokens P2PK-locked to the creator's key** (NUT-11) | **No**: only the creator's key, or the refund key after locktime, can spend ✅ | Yes | Replay and refund-window handling, below |

**Can a gate verify a P2PK-locked token is valid and unspent without redeeming it?** ✅ Yes, in three steps, none of which spends the token:
1. **Valid:** check the mint's signature offline with the **NUT-12 DLEQ proof** carried in the token ✅. Check the `P2PK` secret names the creator's pubkey ✅ ([NUT-11](https://github.com/cashubtc/nuts/blob/main/11.md)).
2. **Unspent now:** **NUT-07 `checkstate`** returns UNSPENT, PENDING or SPENT for each proof, keyed by `Y = hash_to_curve(secret)`, without redeeming ✅ (implemented in Nutshell, CDK and cashu-ts 🟡).
3. **Not replayed:** the gate must store each proof's `Y` and reject repeats 🔵. This is a per-proof record, not a per-person one.

**Who carries the double-spend risk?** 🔵
- **The viewer can't double-spend.** Locking happens in a mint swap that consumes the viewer's original proofs. The locked proofs are new and spendable only by the creator's key.
- **The residual risks fall on the creator:**
  - (a) If a **refund key plus locktime** is set, the viewer can reclaim after locktime, so the creator must redeem before it. Use long locktimes or none.
  - (b) **Mint solvency.**
  - (c) Accepting a token from a mint the creator doesn't trust. Restrict to the creator's listed mints, as in kind 10019.
- **The platform carries none.**

**Which option keeps the platform clearly out of custody while still gating access?** 🔵
- **Tokens P2PK-locked to the creator today**, with the gate verifying via DLEQ, NUT-07 and a replay set.
- **Spilman channels to the creator later**, when the spec stabilises. They cut mint load from 720 swaps a show to two.

**So what:** Lock tokens to the creator, have the gate verify without spending, and keep a replay set. That is the design that keeps you a software provider rather than a custodian.

---

## D3. UK regulatory boundary

Not legal advice: this gives the lines and the sources.

**The frameworks**
- **PSRs 2017** regulate payment services involving "**funds**" (banknotes, coins, scriptural money, e-money). 🔵 The FCA's view is that unbacked cryptoassets like bitcoin are not "funds", so pure-bitcoin flows generally fall outside the PSRs. Fiat legs bring them back in.
  - **Commercial agent exclusion:** the agent must be authorised to negotiate or conclude on behalf of **only the payer or only the payee** ✅ ([FCA CAE page](https://www.fca.org.uk/firms/commercial-agent-exclusion-cae)).
  - **Technical service provider exclusion:** the provider must never **enter into possession of the funds** 🟡.
  - **Limited network exclusion:** instruments usable only in a limited network; you must notify the FCA above €1m in 12 months 🟡 ([PERG 15](https://handbook.fca.org.uk/handbook/perg15)).
- **EMRs 2011:** e-money is a claim on the issuer, **issued on receipt of funds**. 🔵 Ecash denominated in sats and issued against bitcoin is probably *not* e-money; ecash in **GBP or USD units issued against fiat probably is**.
- **MLRs 2017, regulation 14A** ✅: **cryptoasset exchange providers** and **custodian wallet providers** (safeguarding cryptoassets or private keys *on behalf of customers*) must register with the FCA ([Elliptic country guide](https://elliptic.co/country-guides/united-kingdom)).
- 🆕 **New UK cryptoasset regime** under FSMA ✅/🟡:
  - Cryptoassets Regulations **laid Dec 2025 and made Feb 2026** ([A&O Shearman](https://www.aoshearman.com/en/insights/ao-shearman-on-fintech-and-digital-assets/uk-future-crypto-framework-the-countdown-begins); [Baker McKenzie, Feb 2026](https://www.bakermckenzie.com/en/insight/publications/2026/02/united-kingdom-new-cryptoassets-regime-published)).
  - FCA final rules in **PS26/9 to PS26/13 on 30 Jun 2026** ([Freshfields, Jul 2026](https://www.freshfields.com/en/our-thinking/briefings/2026/07/set-in-stone-five-landmark-crypto-policy-statements); [Latham](https://www.lw.com/en/insights/the-race-is-on-fca-publishes-final-rules-for-uk-cryptoasset-regime)).
  - **Application window 30 Sep 2026 to 28 Feb 2027; regime live 25 Oct 2027** ([Freeths, 2026](https://www.freeths.co.uk/insights-events/legal-articles/2026/authorise-or-exit-the-fca-s-crypto-regime-is-almost-here-are-you-ready/)).
  - New regulated activities include **safeguarding qualifying cryptoassets**, dealing and arranging, operating trading platforms, staking, and **issuing qualifying stablecoins**.
- **Cryptoasset financial promotions** ✅: since **8 Oct 2023**, promoting "qualifying cryptoassets" is restricted under FSMA s.21. The communication must come from, or be approved by, an authorised person, an MLR-registered firm, or fit an exemption ([CMS](https://cms.law/en/gbr/legal-updates/fca-publishes-final-rules-and-supplementary-draft-guidance-on-financial-promotions-for-cryptoassets2)).
- 🆕 **Property (Digital Assets etc) Act 2025**, Royal Assent and in force **2 Dec 2025** ✅: a "third category" of personal property, which helps bearer-token ownership arguments ([Law Commission](https://lawcom.gov.uk/news/the-property-digital-assets-etc-act-2025-has-received-royal-assent/)).

**Placing each case on the line** 🔵 (boundary reading, not advice)

| Case | Where it sits |
|---|---|
| **(a)** Tips straight to the creator's own Lightning address | **Outside.** The platform shows an address or invoice and never holds value or keys. No PSRs (bitcoin, no funds), not a custodian, not an exchange |
| **(b)** Platform redeems viewers' ecash and pays the creator later | **Inside.** It holds cryptoassets on behalf of customers: a **custodian wallet provider** under the MLRs now, and **safeguarding** (plus possibly arranging) under the 2027 regime. With fiat in the loop, payment services as well |
| **(c)** Tokens locked to the creator's key; platform only verifies | **Most likely outside.** No control over value. Residual question: whether verifying and gating is "arranging deals in qualifying cryptoassets". 🔵 Paying for a service is not an investment deal, but **check the 2026 SI's exclusions** |
| **(d)** Running an ecash mint for creators | **Inside.** Holding the bitcoin that backs bearer tokens is custody; issuing fiat-unit tokens risks **e-money** or **qualifying stablecoin issuance** |
| **(e)** Venue tickets sold as bearer tokens | Probably **outside** crypto rules if the token is a **right to attend** (a non-fungible ticket rather than a qualifying cryptoasset) 🔵. If the *ticket* is bought with ecash, see (a)–(c). If ticket tokens become spendable credit, look at **limited network** / e-money |
| **(f)** Platform charges its own software fee in bitcoin or fiat | **Outside** payment-services rules: you are the payee for your own services. Fiat card payments are the processor's regulated activity. Accepting bitcoin for your own fee is not exchange or custody |
| **(g)** "Tip in sats" button and explanatory copy | Neutral, factual copy ("pay the artist in bitcoin over Lightning") is very likely **not** an invitation to engage in investment activity. Copy that encourages *buying* bitcoin, mentions price gains, or links to exchanges with inducements **can be a financial promotion**. Keep it functional, no returns, no "buy" calls to action |

**So what:** Design (c), the tokens locked to the creator, and you stay a software provider. (b) and (d) put you in FCA authorisation territory from **25 Oct 2027**, with MLR registration needed before that, and that is not a solo-founder job.

---

## D4. UK ticketing and consumer law

**Cancellation rights (Consumer Contracts Regulations 2013)** ✅ ([CCR Part 3](https://www.legislation.gov.uk/uksi/2013/3134/part/3))
- **Regulation 28(1)(g):** no cancellation right for **services related to leisure activities** with a **specific date or period**. 🔵 A ticket for a specific live gig or stream date fits.
- **Regulation 37:** the right to cancel **digital content** not on a tangible medium is lost once supply begins, **if** the consumer gave express consent **and** acknowledged losing the right.
- 🔵 Pay-per-segment is immediate digital-content supply. Show a one-tap "start now; I lose my 14-day right" consent before the first payment.
- 🔵 You still owe pre-contract information (trader identity and address) and a **confirmation on a durable medium**. With no email, offer a downloadable or saveable receipt.

**Price transparency and drip pricing (DMCC Act 2024)** 🆕
- The drip-pricing ban took effect **6 Apr 2025** ✅: an invitation to purchase must show the **total price including unavoidable fees** ([Taylor Wessing, Apr 2025](https://www.taylorwessing.com/en/insights-and-events/insights/2025/04/dmcca-drip-pricing)).
- Where a fee varies, the way it is calculated must be shown 🟡.
- The CMA can fine up to **10% of global turnover**. Its first DMCC pricing investigations include **ticket resellers** 🟡.
- 🔵 Show the GBP equivalent alongside sats, include any platform fee, and explain the mint or Lightning fee reserve up front.

**Resale rules**
- ✅ **Consumer Rights Act 2015 ss.90–95**: secondary-ticketing information duties on resale facilities and sellers (seat, restrictions, face value, seller identity if a trader).
- 🆕 **Resale cap:** the government committed to a cap at face value plus unavoidable fees, plus platform fee caps and per-person limits. As of **Sep 2026 the draft Ticket Tout Ban Bill is not yet published**; law is likely 2027–28 🟡 ([Commons Library, 13 Jan 2026](https://researchbriefings.files.parliament.uk/documents/SN04715/SN04715.pdf); [Full Fact](https://fullfact.org/government-tracker/ticket-resales-consumer-protections/); [TicketNews, Sep 2026](https://www.ticketnews.com/2026/09/uk-ticket-resale-cap-bill-offshore-enforcement/)).
- 🔵 **Transferable bearer tickets will create a secondary market.** If your software facilitates resale, CRA s.90 duties and the coming cap apply. Consider tokens that are transferable but **price-capped at the facility you control**.

**Who is the trader when the money goes straight to the venue or artist?** 🔵
- The **venue or artist** is the trader for the ticket and must be identified.
- **You are still a "trader"** for your own commercial practices: interface design, fee display, your own fee. The DMCC unfair-practices regime covers anyone acting for a trader ✅/🟡.

**VAT: who makes the supply when the platform never receives the money?**
- 🔵 If your terms make the artist or venue the seller and you a disclosed technology provider, **they make the supply**; you supply software or services to them.
- 🆕 UK: HMRC **consulted Jun–Aug 2026** on widening marketplace deemed-supplier rules. That consultation concerns goods; a deemed-supplier rule for **digital services** in the UK was **not found** 🟡 ([VATupdate, Jul 2026](https://www.vatupdate.com/2026/07/10/uk-vat-consultation-2026-hmrc-proposes-expanding-deemed-supplier-rules-for-online-marketplaces/)).
- The UK VAT registration threshold is £90,000 (since Apr 2024).
- 🆕 **EU: live virtual events have been taxed where the consumer is since 1 Jan 2025.** Non-EU sellers have **no threshold**, use non-Union OSS, and **must keep evidence of customer location** 🟡 ([MHA](https://mha.co.uk/insights/eu-vat-changes-for-virtual-events)).
- 🔵 This collides with "never learn who paid". Options:
  - geo-block or price-exclude EU consumers;
  - collect only a *country* self-declaration plus a coarse IP country, kept separately from payments;
  - or have creators register for OSS.

**So what:** No-refund leisure-date tickets and the per-segment consent screen are fine, provided fees are shown up front. EU VAT location evidence is the real privacy problem, so decide your EU stance before selling a single EU ticket.

---

## D5. Benchmarks for the gap table

**Streamlabs (2026)**
- **Ultra: $27/month or $189/year** 🟡 ([Streamlabs Ultra](https://streamlabs.com/ultra)). Includes:
  - multistream to many destinations;
  - **Collab Cam (up to 11 guests)**;
  - **10 GB cloud storage**;
  - Pro versions of Streamlabs apps and Stream Shift (switch devices mid-stream).
- **Ultra+: ~$79/month** 🟡: 30 GB storage, 30 automations, and a dedicated contact. Some list this price only as an estimate.
- **Free: Dual Output, one horizontal plus one vertical** ✅ ([Streamlabs Dual Output](https://streamlabs.com/multistream/dual-output)).
- Not found or not confirmed: tip page fees (processor fees apply; Streamlabs' own cut), merch status in 2026, and the chatbot (Cloudbot, believed free 🔵).

**Instagram Live in the UK**
- Guests: up to 3 (4 on screen), with request to join 🔵.
- Moderators assignable during a Live 🔵.
- Hidden Words: exists, but whether it covers Live comments is **not confirmed**.
- Badges: UK availability **not confirmed**.
- Replays: archive about 30 days, plus share as replay 🔵.
- Practice mode: introduced 2022 🔵 (not reconfirmed).
- Follower notifications: yes 🔵.
- 🆕 **Apr 2025:** under-16s need **parental permission** to go Live; UK among the first markets ✅/🟡 ([6abc/AP](https://6abc.action.news/16143850)).
- 🆕 **Aug 2025:** Live needs a **public account with ≥1,000 followers** 🟡 ([PetaPixel](https://petapixel.com/2025/08/04/you-need-1000-followers-to-livestream-on-instagram-now/)).
- 🆕 **Sep 2026:** creators can **boost a Live as an ad** from the composer 🟡 ([Mentionlytics](https://www.mentionlytics.com/blog/instagram-new-features/)).
- 🆕 Twitch Dual Format beta (May 2025) and Streamlabs' free Dual Output raise the bar for "vertical + horizontal".

**So what:** Your honest gaps are guests, multistream and dual output. Your honest wins are no account, no 1,000-follower gate, per-segment pay and tips straight to the artist. Instagram's 2025 follower gate is a gift to your pitch for small artists.

---

# GROUP E: Safety, rights, accessibility

## E1. Online Safety Act duties for a small UK live-video host

**Illegal content risk assessment and codes** ✅: risk assessments were due **16 Mar 2025**, and the codes applied from **17 Mar 2025** (see A1).

**Children's access assessment and child safety duties** ✅
- Access assessments were due **16 Apr 2025**.
- Children's risk assessments were due **24 Jul 2025**.
- The Protection of Children Codes have applied since **25 Jul 2025** ([Latham, Jun 2025](https://www.latham.london/2025/06/uk-online-safety-act-summer-2025-deadlines/)).

**Which measures apply to small low-risk vs multi-risk services** 🟡
- **Low risk:** the core set in A1.
- **Specific or multi-risk** (medium or high for one, or two or more, harms): extra measures, for example moderation targets, staff training and user controls.
- 🆕 Ofcom consulted in 2025 on extending **blocking, muting and comment-disabling user controls** to smaller services likely to be accessed by children. Pending ([Ofcom user controls consultation](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/consultation-illegal-harms-user-controls)).

**Livestream-specific measures** 🆕
- Ofcom's **Additional Safety Measures** consultation (published 30 Jun 2025, closed 20 Oct 2025) proposes:
  - **no comments, reactions, gifts or recording on children's livestreams**;
  - easy reporting of livestreams showing **imminent physical harm**;
  - human moderators available while livestreaming is offered;
  - proactive technology for CSAM in livestreams for some services 🟡.
- **Final statement: still "pending" as of Ofcom's 12 May 2026 page update.** The hash-matching for intimate image abuse part was finalised separately in May 2026 🟡 ([Ofcom ASM page](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/online-safety-additional-safety-measures); [Ofcom roadmap](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/roadmap-to-regulation)).
- ⚠️ "Under-18 streamers won't earn donations" was the press reading in Sep 2025 🟡 ([Esports News UK](https://esports-news.co.uk/2025/09/26/ofcom-proposol-stops-under-18-uk-streamers-from-earning-donations)). 🔵 That directly hits a tip model, so plan **adult-only creators** (age check on creators, not viewers).

**CSEA reporting to the NCA: commenced?** 🆕 ✅ **Yes, from 7 Apr 2026**
- Section 66 and the s.69 offence were brought in by **SI 2026/262**.
- The reporting details (NCA registration, report contents, timeframes, retention) are in **SI 2026/268**.
- An earlier 3 Nov 2025 start was abandoned because the NCA's portal and API were not ready ([SI 2026/262](https://www.legislation.gov.uk/uksi/2026/262/made); [SI 2026/268](https://www.legislation.gov.uk/uksi/2026/268/made)).

**Categorisation, fees and enforcement against small services**
- 🆕 **Categorisation register published 10 Jul 2026** 🟡:
  - Category 1: over 34m UK users with a recommender system, or over 7m with a recommender plus resharing.
  - Category 2B: over 3m with direct messages ([Fieldfisher](https://www.fieldfisher.com/en/insights/ofcom-publishes-its-register-what-categorised-services-must-do-now)).
- **Fees:** only above **£250m qualifying worldwide revenue**, with an exemption below £10m UK revenue ✅ ([Ofcom fees page](https://www.ofcom.org.uk/online-safety/online-safety-fees-and-penalties)).
- **Enforcement** 🟡:
  - 4chan: £20k (Oct 2025), then more for age checks, risk assessment and terms.
  - An unnamed suicide forum: £950k.
  - Programmes on small "high-risk" services ([Slaughter and May](https://thelens.slaughterandmay.com/post/102lqgc/uk-and-eu-ramp-up-online-safety-enforcement-ofcom-issues-first-osa-fine-as-commi)).

**Does any of this change if a venue self-hosts the software?** 🔵 Duties attach to each **provider** (s.226 control test). A self-hosting venue carries its own duties; you carry duties only for instances you control.

**EU Digital Services Act duties for a non-EU micro-provider** 🟡/🔵
- If you have a "substantial connection" to the EU (significant user numbers or targeting), you are an intermediary.
- As a hosting service: notice and action (Art 16), statements of reasons (Art 17), and reporting threats to life (Art 18).
- Points of contact (Arts 11–12) and an **EU legal representative (Art 13)**, which micro-enterprises are not exempt from.
- **Art 19** exempts micro and small online platforms from most of Section 3 (Arts 20–28), except Art 24(3) ([Art 19 text](https://www.springlex.eu/en/packages/dsa/dsa-regulation/article-19/)).
- 🔵 Not targeting the EU (no EU languages, currency or marketing) reduces the "substantial connection" risk.

**So what:** Before launch you need adult-only creators, an NCA registration, a report button with an "imminent harm" path, and a re-run risk assessment that names livestreaming. Watch for Ofcom's livestream statement, likely late 2026.

---

## E2. CSAM and live video in practice

**What detection is feasible for a small service**
- **Image and frame hash matching**
  - **Cloudflare CSAM Scanning Tool**: free; compares content served *through the Cloudflare cache* against NCMEC and other lists ✅. **It reports to NCMEC (US), not the NCA** ✅; the terms say it does not discharge your own legal duties ([CF CSAM docs](https://developers.cloudflare.com/cache/reference/csam-scanning/)). Plan eligibility: **not found** 🔵 (believed available on all plans). Video coverage: not confirmed.
  - **PhotoDNA Cloud Service**: **free for qualified organisations after third-party vetting**; **images only** ✅ ([Microsoft PhotoDNA](https://www.microsoft.com/en-us/photodna/cloudservice)).
  - 🆕 **IWF Image Intercept**: announced **8 May 2025** as a **free tool for smaller eligible UK platforms**, using PhotoDNA and the IWF hash list. General availability is **not confirmed** 🟡 ([IWF](https://www.iwf.org.uk/our-technology/image-intercept)).
  - **Thorn Safer**: commercial; **pricing not found**.
- **Live-video classifiers:** commercial only (Thorn, Hive, Google Content Safety API by application) 🔵. Not proportionate at your scale.

**What Ofcom actually expects at small scale** 🟡
- Hash-matching measures in the codes target **large** services, and **file-sharing or file-storage** services, with CSAM risk.
- A small livestream service mainly needs:
  - **effective reporting** and **swift takedown**;
  - a **risk assessment** that addresses livestream CSEA risk;
  - **NCA reporting** of anything detected.
- Watch the pending livestream measures.

**Operational steps** 🔵
- A **"Report" button** on every stream and message, with an **"a child is at risk / imminent harm" fast path** that pages the founder.
- **Kill switch:** end the stream or room instantly; revoke the stream key.
- **Takedown target:** minutes for live, under 24 h for VOD.
- **Evidence preservation:** keep a few minutes of rolling ingest buffer per stream so you can freeze evidence on a report. Retain under SI 2026/268's retention rule (period: check the SI).
  - **Do not** view or download suspected CSAM beyond what reporting requires.
- **Routes:** the NCA (statutory, via its portal, 🆕 2026), the IWF (reporting at iwf.org.uk), and police on 999 for imminent risk.

**So what:** At your size, CSAM work means fast reporting and takedown, rolling evidence capture, NCA registration and adult-only creators. Apply for IWF Image Intercept and PhotoDNA if you ever host images or VOD.

---

## E3. Music rights for live-streaming a UK gig of the artist's own songs

**Does an artist who is a PRS member still need a licence?**
- PRS members **assign** their performing and communication-to-the-public rights to PRS. So yes, a licence is still needed, even for their own songs 🔵 (standard PRS membership model).
- ✅ **PRS offers a no-cost licence** to members performing an **online ticketed live concert exclusively of their own works** ([PRS online licences](https://www2.prsformusic.com/licences/using-music-online); [Music Business Worldwide, 2021](https://musicbusinessworldwide.com/victory-for-writer-performers-prs-for-music-u-turns-over-license-fee-for-small-scale-live-stream-concerts)).
  - Co-writers who aren't PRS members, publishers' shares, or any cover song break "exclusively own works" 🔵.
- Other events (2021 basis, **2026 rates not found**) 🟡:
  - small events: a fixed fee (originally £22.50/£45 bands; later up to £1,500 revenue, fixed or bespoke);
  - larger events: an interim **10%** of revenue ([Music Week](https://www.musicweek.com/live/read/prs-for-music-introduces-discounted-rate-for-livestream-licence-following-healthy-debate/083204)).

**Who must hold it: the artist, the venue or the platform?** 🔵
- The **event promoter** (the artist or venue selling access) takes the online live concert licence.
- A platform that itself communicates music to the public may need its own PRS online licence. Platform-level deals exist for YouTube.
- **Replays add reproduction (mechanical, MCPS) rights**: on-demand is different from live.

**PPL** 🔵: only if **sound recordings** are played: walk-in music, backing tracks you don't own, DJ sets. The artist's own masters are cleared by the artist. PPL webcasting is a separate licence; check with PPL.

**How Twitch, YouTube and Fountain handle it**
- **YouTube:** holds PRS licences at platform level 🟡.
- **Twitch:** UK collecting-society deal **not found** (it has US publisher deals; DMCA risk on recorded music) 🔵.
- **Fountain:** **not found**.

**2025–26 changes to PRS online tariffs:** **not found**. All the sources I found date from 2020–21. Call PRS licensing on 020 3741 3888 or email applications@prsformusic.com ✅ (contact details from the PRS page).

**So what:** Own-songs-only PRS members can get a free PRS online live concert licence; get each artist to tick a box confirming "own works only, all writers PRS". Anything else needs a paid event licence, so price it in or block covers.

---

## E4. Live captions in the browser

**On-device: the Web Speech API**
- Chrome uses a **server** (Google) by default ✅.
- 🆕 On-device recognition (`processLocally`, `available()`, `install()`) passed **intent to ship in Jan 2025**, on desktop first ✅ ([Blink intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/VNOok2dbmHM/m/TQpe9shjCgAJ); [MDN processLocally](https://developer.mozilla.org/docs/Web/API/SpeechRecognition/processLocally)).
- Safari supports SpeechRecognition; whether it runs **on-device or via Apple servers is not found**.
- 🔵 The API listens to the microphone, so it suits captioning the *host's* mic, not an incoming stream.

**Whisper in the browser** 🔵/✅
- transformers.js with WebGPU. 🆕 **WebGPU shipped in Safari 26** (iOS 26) ✅ ([WebKit, Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
- Whisper tiny or base runs on a recent iPhone, but alongside encoding on the broadcasting phone it's a thermal problem.
- 🔵 A twist: run it on the *viewer's* device against the received audio. That is private and free to you, but slow on older phones.

**Server-side streaming speech-to-text, cost per 2-hour show** (USD, seen 9 Oct 2026)
- **Workers AI Whisper large-v3-turbo:** **$0.0005 per audio minute**, so **$0.06** ✅ ([Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)). Batch HTTP: chunk per 10 s segment, which aligns neatly with your segments.
- **Deepgram Nova-3 via Workers AI WebSocket:** $0.0092/min, so **$1.10** ✅.
- **Deepgram direct streaming:** $0.0048–0.0077/min, so $0.58–0.92 🟡 (sources conflict).
- **AssemblyAI Universal-Streaming:** about $0.15/h, so ~$0.30 🟡 **not confirmed**.

**Delivery** ✅/🔵
- **WebVTT subtitle rendition inside HLS** (`EXT-X-MEDIA TYPE=SUBTITLES`, segmented VTT with `X-TIMESTAMP-MAP`, RFC 8216). Native Safari renders it and hls.js supports it; captions stay in sync with segments.
- A separate text channel (SSE) is lower latency but drifts. 🔵 Use HLS VTT for paid viewers.

**Accuracy on sung vocals** 🔵
- **Not found** as current measured data for 2025–26 models.
- Expect much worse than speech: sustained vowels, reverb, instruments.
- Better: **artist-supplied lyrics**, cued manually or aligned automatically, plus automatic speech recognition for between-song talk.

**Do auto-transcribed lyrics raise copyright issues?** 🔵
- Lyrics are literary works; displaying them is reproduction and communication.
- With the artist's own songs, the artist's consent covers it only if they control the publishing. Publishers often control lyric rights.
- CDPA s.31A–F accessible-copy exceptions are framed around disabled persons' access. 🔵 Captions for everyone are wider than that.
- Get a lyrics permission tick-box alongside the PRS one.

**What WCAG 2.2 and UK law expect**
- **WCAG 2.2 SC 1.2.4 Captions (Live) is Level AA** ✅ ([WCAG 2.2](https://www.w3.org/TR/WCAG22/)).
- **Equality Act 2010:** service providers owe an **anticipatory duty to make reasonable adjustments** (ss.20, 29) ✅. No UK statute mandates WCAG for private services ✅.
- 🆕 The **European Accessibility Act** applies from **28 Jun 2025** to e-commerce and audiovisual services for EU consumers. **Microenterprise service providers are exempt** ✅ (Directive 2019/882).
- 🔵 For a small private service, "reasonable" probably means offering captions where feasible, for example automatic captions on talk segments plus artist lyrics. Not perfect live captions.

**So what:** Workers AI Whisper per 10 s segment as HLS WebVTT costs about 6 cents a show. Lyrics need the artist's (and publisher's) say-so, and sung-word accuracy is poor, so pair automatic captions with artist-supplied lyrics.

---

## Not found (consolidated)

- Measured iPhone thermal and battery figures for 2-hour browser WebRTC.
- Mux live encoding rate (2026).
- Bunny Stream Live pricing.
- Hetzner cloud NIC throughput guarantee.
- Cloudflare 2025–26 changes to the video-on-CDN terms.
- Whether Cloudflare Realtime or Stream run on Durable Objects.
- Safari Web Speech on-device vs server.
- Primal and Amethyst live features; counts of NIP-53 shows.
- Thorn Safer pricing.
- PRS online tariff changes in 2025–26; Twitch's UK PRS deal; Fountain's licensing.
- AssemblyAI streaming price (unconfirmed).
- Streamlabs tip fees and merch status.
- Instagram Live in the UK: Hidden Words on Live, Badges, practice mode (2026 confirmation).
- A UK deemed-supplier rule for digital services.
- Ofcom's final livestream statement (pending).

## Decisions this research forces

1. **Durable Objects policy scope:** does it cover R2, KV, D1 and Queues? This blocks B4 and C1.
2. **Creators adults-only?** This de-risks the pending Ofcom livestream measures and the tips-to-children issue.
3. **EU stance:** block, self-declare country, or creators handle OSS?
4. **Payment primitive:** tokens P2PK-locked to the creator now; Spilman channels later.
