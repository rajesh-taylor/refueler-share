# Refueler Share: served-code integrity and OHTTP research brief

Compiled 2026-10-10. Revision 2: re-checked against primary sources with full network access. Research only.

**Confidence key:**
- **H**: primary source read in full.
- **M**: primary source read only in part, or the claim combines primary facts.
- **L**: secondary source, or our own inference. Inferences are marked *(inference)*.

"Fetched" means the page shows no publication date and was read on 2026-10-10.

## Summary

- WEBCAT is in **alpha**:
  - The Firefox add-on is at v3.0.0 (updated 2026-09-29) with about 32 daily users.
  - 16 domains are enrolled; 5 of them are FPF demos.
  - It runs on desktop Firefox only. It is untested on Firefox for Android and doesn't work on Tor Browser.
  - FPF is heading for a beta. The Ethereum Foundation grant (2026-08-05) funds a verification library that wallets can embed, research into Chromium support, and an independent audit.
- **WAICT** (Mozilla, Cloudflare, FPF, Meta) is the browser-native route. A prototype sits behind a pref in Firefox Nightly, and no other browser has stated a position yet. The design is converging with WEBCAT's.
- A close peer already ships this model: **Osservatorio Nessuno's uploader** is WEBCAT-enrolled, encrypts in the browser with age, and offers a CLI fallback plus an onion service.
- Current WEBCAT rules:
  - `script-src` is limited to `'self'`, hashes and `'wasm-unsafe-eval'`.
  - `frame-src` is **unrestricted**, and the docs tell sites to put CAPTCHAs in **sandboxed iframes** and talk to them with `postMessage`. So Turnstile can stay, but only inside a frame from a separate origin that isn't enrolled.
- Cloudflare Pages has three traps for WEBCAT. Each has a fix:
  1. It auto-generates `Link` headers from `<link rel=modulepreload/preload>`, and WEBCAT blocks the `Link` header. Fix: add `! Link` to `_headers`.
  2. Its `.html` → extensionless redirects must stay relative.
  3. The CSP header must match the manifest character for character on every response, error pages included.
- Cloudflare's injected features can all be switched off. `Cache-Control: no-transform` stops Web Analytics injection and email obfuscation. Rocket Loader and challenge pages are zone settings.
- Enrollment is per subdomain, capped at **5 per site**, free, and changes have a cool-down of **1 day in alpha and 7 days after**. So Share needs its own subdomain.
- For GrapheneOS, a WebView wrapper with the files bundled inside the APK avoids fresh code per visit. A TWA doesn't: it is "rendered by the user's browser" from the live site.
- **OHTTP is now practical:**
  - **Relay:** oblivious.network offers self-serve relays from **$15/month** (2.62M requests). Its relay appears to run on Fastly, not Cloudflare *(inference from headers)*.
  - **Gateway:** Cloudflare's managed **OHTTP Gateway** (closed beta, 2026-10-02) refuses requests sent from Cloudflare-hosted relays. That enforces the rule that relay and gateway must be separate.
- The core OHTTP limit stands. Direct 32 MiB transfers through presigned URLs reveal the client's IP together with the object key, so OHTTP only buys privacy for calls that can't be tied to an upload, such as credential issuance.

## Decisions for Rajesh

1. **Give Share its own origin (e.g. `share.refueler.io`).** WEBCAT enrolls a (sub)domain, and WAICT is origin-scoped. Note the 5-subdomain cap per site. **Recommend: yes, before any enrollment.**
2. **Where Turnstile lives.**
   - Option (a), sandboxed frame: a minimal non-enrolled page (e.g. `gate.refueler.io`) loads Turnstile inside a sandboxed `<iframe>` on the Share page. It returns a blind-signed upload credential through `postMessage`, and the gate never sees file keys. This is what WEBCAT's docs prescribe.
   - Option (b): self-hosted proof-of-work.
   - Option (c): Cashu-paid credentials.
   - **Recommend (a), with (c) as an add-on.** Test which sandbox flags Turnstile needs; see Open question 3.
3. **Canonical hash.** WEBCAT `files` and WAICT v1 are both **SHA-256** base64url. **Recommend SHA-256 only.** WEBCAT's CSP also accepts `sha384` script hashes, but we don't need inline hashes.
4. **Signing scheme.** Sigsum signs offline, needs no GitHub OIDC, and supports thresholds; its tools sign through **ssh-agent**, so a hardware token can hold the key. Sigstore support is "a work in progress". **Recommend Sigsum.** Use FPF's *test* Sigsum log during alpha, as their docs advise, and switch to a production log policy at beta.
5. **Signer set.** The docs example is 2 keys with `threshold 1`; every enrollment change costs a cool-down. **Recommend:** a primary key in a hardware token via ssh-agent, plus a backup key kept offline elsewhere. Move to 2-of-3 only if a second person joins.
6. **Android app form.** **Recommend:** a hand-written WebView wrapper that serves the 27 files through `WebViewAssetLoader`, with the same CSP as the web build. Not a TWA (live code) and not Capacitor (a large dependency tree to make reproducible).
7. **APK signing key.**
   - Keep it separate from the manifest key. Android refuses updates signed with a different key.
   - Zapstore's one-time certificate linking (NIP-C1) needs the keystore file (`.jks`/`.p12`/`.pem`), so a key that exists only in hardware won't work there.
   - **Recommend:** a file-based keystore, stored encrypted and offline, used only on a clean machine at release. Publish the SHA-256 certificate fingerprint in the README, on refueler.io and through the Zapstore link.
8. **WEBCAT timing.** **Recommend:**
   - Comply now: CSP, no inline JS, `! Link`, `no-transform`, and the manifest built in the ship script.
   - Enroll a staging subdomain during alpha. A 1-day cool-down makes mistakes cheap.
   - Don't market "verified" until WEBCAT reaches beta or WAICT ships in a stable browser.
9. **OHTTP go/no-go.**
   - Viable now: an oblivious.network relay plus our own gateway, either our Worker or Cloudflare's managed gateway once it's out of beta.
   - **Recommend:** a pilot for **credential issuance only**, with honest wording (below). Keep bulk transfers direct and say so.
10. **Gateway keys.**
    - RFC 9458 requires the gateway key configuration to be authenticated and consistent across clients. Cloudflare's managed gateway rotates keys itself, so our releases can't pin them.
    - **Recommend:** our own Worker gateway, with its key configuration pinned in the signed manifest and APK. Use Cloudflare's gateway only if pinning is dropped.
11. **Cloudflare settings for the Share host.**
    - Turn off: Web Analytics auto-inject, Email Obfuscation, Rocket Loader, Bot Fight Mode, challenge and Under-Attack rules.
    - Send `Cache-Control: no-transform` on HTML and JS.
    - In `_headers`: one identical CSP on every path, plus `! Link`.
    - **Recommend: yes.**
12. **Never redirect a share link off-origin.** Browsers carry the URL fragment (our key) across `Location` redirects, and WEBCAT now blocks non-relative redirects for this reason. **Recommend:** audit the Pages redirect behaviour and any short-link plans.

## Topic 1 findings

### 1.1 WEBCAT: status and architecture

| Item | Finding | Source | Date | Conf. |
|---|---|---|---|---|
| History | First announced 2025-03-19. Alpha 2026-03-03. FPF post 2026-08-06 says "WEBCAT is in alpha today". | [webcat.tech](https://webcat.tech/), [SecureDrop: alpha](https://securedrop.org/news/webcat-alpha/), [FPF: tamper-evident seal](https://freedom.press/tech/news/webcat-a-tamper-evident-seal-for-the-open-web/) | 2025-03-19 / 2026-03-03 / 2026-08-06 | H |
| Extension | Firefox add-on v3.0.0, last updated 2026-09-29, about 32 average daily users. | [AMO API](https://addons.mozilla.org/api/v5/addons/addon/webcat/) | fetched | H |
| Browsers | Firefox only. Manifest V2 blocks Chromium. "Untested on Firefox for Android", "known not to work on Tor Browser". Tor Browser integration work with the Tor Project started in 2026. | [docs.webcat.tech](https://docs.webcat.tech/print.html), [SecureDrop: alpha](https://securedrop.org/news/webcat-alpha/) | fetched / 2026-03-03 | H |
| Roadmap | Heading toward beta. EF grant funds a **verification library that wallets can embed** (no separate extension), Chromium research, an **independent security audit** and an ERC standard. | [SecureDrop update](https://securedrop.org/news/webcat-update-independent-evaluation-waict-and-a-growing-team/), [EF blog](https://blog.ethereum.org/en/2026/08/05/1ts-grant) | 2026-05-04 / 2026-08-05 | H |
| Enrollment system | Permissioned CometBFT chain run by independent organisations; changes need 2/3. Oracles observe `/.well-known/webcat/enrollment.json`. | [docs.webcat.tech](https://docs.webcat.tech/print.html), [spec enrollment.md](https://github.com/freedomofpress/webcat-spec/blob/main/enrollment.md) | fetched | H |
| Cool-down | **1 day in alpha, 7 days thereafter.** Changes are public and revertible during it. | [docs.webcat.tech glossary](https://docs.webcat.tech/print.html) | fetched | H |
| Limits and cost | Free. "We allow only 5 subdomains per site." Enrolled list at `webcat.freedom.press/list.json`. | [docs.webcat.tech FAQ](https://docs.webcat.tech/print.html) | fetched | H |
| Files served | `/.well-known/webcat/enrollment.json`, `manifest.json`, `bundle.json`, plus `enrollment-prev.json` and `bundle-prev.json` during transitions. | [docs.webcat.tech](https://docs.webcat.tech/print.html) | fetched | H |
| Manifest | Fields: `app` (repo), `version` (tag), `default_csp`, `files` (path → SHA-256 base64url), `default_index`, `default_fallback`, `wasm`, `extra_csp`. Signatures and Sigsum proofs must meet the enrollment `threshold`. | [spec manifest.md](https://github.com/freedomofpress/webcat-spec/blob/main/manifest.md), [SecureDrop: auditable runtimes](https://securedrop.org/news/webcat-towards-auditable-web-application-runtimes/) | 2025-12-18 | H |
| Enforcement scope | HTML, JS and CSS are always enforced. Other assets are checked only if listed in the manifest, otherwise streamed through. | [SecureDrop: auditable runtimes](https://securedrop.org/news/webcat-towards-auditable-web-application-runtimes/) | 2025-12-18 | H |
| Site requirements | Fully static; no inline JS; minimum `index.html` and `error.html`; no `eval` or blob workers. | [docs.webcat.tech: requirements](https://docs.webcat.tech/print.html) | fetched | H |
| CSP rules (current) | `script-src`: `'none'`, `'self'`, `'wasm-unsafe-eval'` or sha256/384/512 hashes; scripts from **other origins aren't allowed, even enrolled ones**. `frame-src`/`child-src`: **unrestricted**. `worker-src`: `'self'`/`'none'`. `object-src 'none'`. No nonces. One policy only, no commas. | [docs.webcat.tech: CSP](https://docs.webcat.tech/print.html) | fetched | H |
| Spec vs docs | The GitHub `csp.md` (WIP) still says hashes are banned and frames are restricted. The docs site is newer and more permissive. | [spec csp.md](https://github.com/freedomofpress/webcat-spec/blob/main/csp.md) | fetched | H |
| CSP header matching | Must match the manifest "character for character" on **every** response, error pages and assets included. Responses from the browser cache are exempt. Watch for CDNs that rewrite headers. | [docs.webcat.tech: CSP](https://docs.webcat.tech/print.html) | fetched | H |
| Header bans | `Location` only relative (`/`, `./`, `../`). `Refresh` blocked. **`Link` blocked.** WEBCAT adds `Origin-Agent-Cluster: ?1`. | [docs.webcat.tech: requirements](https://docs.webcat.tech/print.html) | fetched | H |
| CAPTCHAs | Google and Cloudflare CAPTCHAs named as incompatible scripts. Guidance: "Set the sandbox attribute on frames that embed unverified content, such as CAPTCHAs… never allow-same-origin for content you do not control… postMessage". | [docs.webcat.tech](https://docs.webcat.tech/print.html), [SecureDrop: auditable runtimes](https://securedrop.org/news/webcat-towards-auditable-web-application-runtimes/) | fetched / 2025-12-18 | H |
| Independent evaluation | "Trust on Reload" (WWW 2026, MPI/CISPA) found 9 pitfalls and 18 bugs across five tools. WEBCAT gives "the broadest security guarantees". Pitfall **P3**: `Location` redirects preserve the URL fragment and can leak secrets held there. Fixed since. | [SecureDrop update](https://securedrop.org/news/webcat-update-independent-evaluation-waict-and-a-growing-team/), [CISPA](https://cispa.de/en/research/publications/213253-trust-on-reload-securing-browser-based-end-to-end-encryption) | 2026-05-04 / 2026-04-12 | H |
| Performance | Overhead up to 20% (cold) and 25% (warm) on enrolled domains. | [IACR 2025/797](https://eprint.iacr.org/2025/797) | 2025-05-04 | H |
| Deployments | 16 enrolled domains, including **upload.osservatorionessuno.org** and **verification-center.tinfoil.sh** (in production as an iframe at chat.tinfoil.sh). The rest are small sites and FPF demos. | [list.json](https://webcat.freedom.press/list.json), [docs: examples](https://docs.webcat.tech/print.html) | fetched (block 325832) | H |
| Peer: Osservatorio Nessuno | Browser-side `age` encryption. A CLI command is shown as an alternative, plus an onion service. CSP: `default-src 'none'; script-src 'self'; … frame-ancestors 'none'`. Manifest `app` points to GitHub, `version v0.4`. | [upload.osservatorionessuno.org](https://upload.osservatorionessuno.org/), [its manifest](https://upload.osservatorionessuno.org/.well-known/webcat/manifest.json) | fetched | H |
| Known limits | Protects only extension users. Compromise of the enrollment infrastructure could unenroll a site. Alpha "might not yet provide the intended security guarantees". | [docs FAQ](https://docs.webcat.tech/print.html), [SecureDrop: alpha](https://securedrop.org/news/webcat-alpha/) | fetched | H |

### 1.2 Alternatives to WEBCAT

| Item | Finding | Source | Date | Conf. |
|---|---|---|---|---|
| WAICT status | Prototype behind a pref in Firefox Nightly. "Other browsers have not yet indicated a position." Demo: Cloudflare's Orange Meets (MLS E2EE video) integrated with WAICT. | [Mozilla Hacks](https://hacks.mozilla.org/2026/05/trustworthy-javascript-for-the-open-web/), [waict.dev](https://waict.dev/) | 2026-05-05 | H |
| WAICT design | Opt-in header `Integrity-Policy-WAICT-v1`; manifest of URL, wasm, inline and eval hashes (SHA-256); external URLs allowed; cross-origin frames are covered only if that origin opts in. | [waict-integrity-spec](https://github.com/waict-wg/waict-integrity-spec) | fetched (draft) | H |
| WAICT transparency | Per-site hash chains in a prefix tree. Witnesses co-sign. Witness signatures valid for about a week, so sites must refresh weekly even with no changes. Cloudflare plans to run a transparency service and a witness. A WEBCAT-style signer extension is supported, with a 24h cool-down idea. | [Cloudflare blog](https://blog.cloudflare.com/improving-the-trustworthiness-of-javascript-on-the-web/) | 2025-10-16 | H |
| WAICT vs WEBCAT | Converging on the active/passive asset split, Wasm enforcement and default-fallback pages. Differences: WEBCAT is stricter on dynamic code, HTTP headers and CSP. | [SecureDrop update](https://securedrop.org/news/webcat-update-independent-evaluation-waict-and-a-growing-team/) | 2026-05-04 | H |
| Meta Code Verify | Extension for Chrome, Firefox, Edge and Safari covering Facebook, Messenger, Instagram and WhatsApp Web. Hash manifest; **warns rather than blocks**. Works only for Meta's own sites. | [meta-code-verify](https://github.com/facebookincubator/meta-code-verify), [waict.dev](https://waict.dev/) | fetched | H |
| Chrome Isolated Web Apps | Signed Web Bundles. Install only on managed ChromeOS and select partners; Google allowlist since Chrome 143. Unmanaged and cross-platform support is a future goal. | [developer.chrome.com IWA](https://developer.chrome.com/docs/iwa/introduction), [blink-dev PSA](https://groups.google.com/a/chromium.org/g/blink-dev/c/iTCPaBw6HxU/m/xSwr3FDWAgAJ) | fetched | H |
| SRI + CSP alone | A hacked first-party server "can modify the code to remove or change the integrity hashes". | [docs.webcat.tech FAQ](https://docs.webcat.tech/print.html) | fetched | H |
| Sigstore / Rekor | A signer and transparency option inside WEBCAT, not an enforcement point. Automated through GitHub Actions; WEBCAT support is "a work in progress". | [webcat-cli](https://github.com/freedomofpress/webcat-cli) | fetched | H |

### 1.3 Obstacles specific to our stack

| Item | Finding | Source | Date | Conf. |
|---|---|---|---|---|
| Turnstile CSP | Needs `script-src` and `frame-src` for `https://challenges.cloudflare.com`, or a nonce, or `strict-dynamic`. In the main page this is impossible under WEBCAT. In a sandboxed child frame on our own non-enrolled origin it's allowed. | [CF Turnstile CSP](https://developers.cloudflare.com/turnstile/reference/content-security-policy/), [docs.webcat.tech](https://docs.webcat.tech/print.html) | fetched | H |
| Turnstile in a sandbox | No Cloudflare doc on which sandbox flags Turnstile needs. Running `allow-scripts` together with `allow-same-origin` lets framed content escape the sandbox, which is fine for *our* gate origin but not for third-party content *(inference)*. | — | — | L |
| Pages `Link` headers | Pages **automatically generates `Link` headers** from `<link rel=preload/modulepreload/preconnect>`. Disable with `! Link` in `_headers`. WEBCAT blocks `Link`. | [CF Pages Early Hints](https://developers.cloudflare.com/pages/configuration/early-hints/) | fetched | H |
| Pages redirects | `/x.html` → `/x` and `/dir/index.html` → `/dir/`. Must be relative for WEBCAT. Whether Pages emits a relative `Location` is not verified. | [CF Pages serving](https://developers.cloudflare.com/pages/configuration/serving-pages/) | fetched | H / L |
| Pages caching | Pages sends `ETag` and `Cache-Control: public, max-age=0, must-revalidate`, and `no-transform` on encoded assets. Edge cache lasts until the next deploy. Pages with no top-level `404.html` fall into SPA mode. | [CF Pages serving](https://developers.cloudflare.com/pages/configuration/serving-pages/) | fetched | H |
| WEBCAT on Pages | WEBCAT docs give a Cloudflare Pages example. Per-path `_headers` rules map to `extra_csp`. | [docs.webcat.tech](https://docs.webcat.tech/print.html) | fetched | H |
| Web Analytics | Auto-injects the beacon on every page of every subdomain in a proxied zone (on by default for former Browser Insights zones). Blocked by `Cache-Control: no-transform`. | [CF Web Analytics](https://developers.cloudflare.com/web-analytics/get-started/) | fetched | H |
| Email obfuscation | On by default; rewrites HTML and injects `email-decode.min.js`. Skipped with `no-transform`. | [CF Email Obfuscation](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/) | fetched | H |
| Rocket Loader | Rewrites scripts. Turn it off. | [CF Rocket Loader](https://developers.cloudflare.com/speed/optimization/content/rocket-loader/) | fetched | H |
| Challenge pages | Cloudflare serves its own HTML whose CSP you can't set. On an enrolled host that is a guaranteed integrity failure *(inference)*. | [CF Turnstile CSP note](https://developers.cloudflare.com/turnstile/reference/content-security-policy/) | fetched | H / L |

### 1.4 Installable app for GrapheneOS

| Item | Finding | Source | Date | Conf. |
|---|---|---|---|---|
| TWA | "Rendered by the user's browser", fetched from the web. Chrome 72+; other browsers may implement the protocol. Fresh code per visit, so no integrity gain. | [Android: TWA overview](https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities) | updated 2026-02-26 | H |
| WebView + bundled assets | `WebViewAssetLoader` serves APK-bundled files at `https://appassets.androidplatform.net/`. The code is fixed inside the signed APK. | [androidx WebViewAssetLoader](https://developer.android.com/reference/kotlin/androidx/webkit/WebViewAssetLoader) | fetched | M |
| GrapheneOS WebView | Vanadium provides the system WebView and it can't be swapped. | [GrapheneOS forum](https://discuss.grapheneos.org/d/8656-can-we-change-the-default-webview) | forum | L |
| F-Droid reproducible builds | Verification copies the signature onto F-Droid's own build (v2/v3 signatures cover every byte). With `Binaries:` + `AllowedAPKSigningKeys`, F-Droid **publishes the developer-signed APK** only if the rebuild matches. | [F-Droid: Reproducible Builds](https://f-droid.org/en/docs/Reproducible_Builds/) | fetched | H |
| Fingerprint format | Package name plus the colon-hex SHA-256 of the signing certificate, checked with `apksigner verify --print-certs`. Proton publishes certificate (not APK) SHA-256 values on its download pages. | [AppVerifier](https://github.com/soupslurpr/AppVerifier), [Proton](https://proton.me/support/verify-apks) | fetched | H |
| Obtainium | Shows the certificate. Users check it with AppVerifier against the published fingerprint. After that, Android enforces the same signer on updates. | [Obtainium](https://github.com/ImranR98/Obtainium) | fetched | H / L |
| Zapstore | Free, no review queue. The relay whitelists you by fetching `zapstore.yaml` (with `pubkey`) from GitHub, GitLab, Codeberg or Gitea. Signing via nsec, NIP-46 bunker or NIP-07. **Certificate linking (NIP-C1)** is a one-time step needing the APK keystore file. Zapstore compares APK certificates to the linked identity. The indexer may list a GitHub app before you self-publish. | [Zapstore FAQ](https://zapstore.dev/docs/faq), [Zapstore publish](https://zapstore.dev/docs/publish), [zsp](https://github.com/zapstore/zsp) | fetched | H |
| Key rotation | "Android will refuse updates signed with a different key." Rotation forces users to reinstall. | [Zapstore FAQ](https://zapstore.dev/docs/faq) | fetched | H |

### 1.5 Release discipline

| Item | Finding | Source | Date | Conf. |
|---|---|---|---|---|
| Release manifest | Use WEBCAT's manifest as-is (above) and keep extras (commit hash, APK fingerprint, gateway key configuration) in a sidecar file. Canonical-JSON signing makes extra fields risky *(inference)*. | [manifest.md](https://github.com/freedomofpress/webcat-spec/blob/main/manifest.md) | fetched | H / L |
| Tooling | `webcat-cli`: `enrollment create`, `manifest generate` (hashes every file in the directory; `--exclude` available), `manifest sign`, `bundle create`, `manifest verify`. Needs Node 20 or later plus Go `sigsum-key` and `sigsum-submit`. | [docs.webcat.tech: manual signing](https://docs.webcat.tech/print.html) | fetched | H |
| Hardware key | Sigsum tools accept a *public* key file and sign through `${SSH_AUTH_SOCK}`: "recommended that keys are stored in a hardware token". `sigsum-agent` supports a YubiHSM; YubiKey and TKey support is "under consideration". A YubiKey OpenPGP Ed25519 key behind gpg-agent's SSH support should work but is untested *(inference)*. | [sigsum-go tools.md](https://git.glasklar.is/sigsum/core/sigsum-go/-/blob/main/doc/tools.md), [key-mgmt](https://git.glasklar.is/sigsum/core/key-mgmt) | fetched | H / L |
| Sigsum log choice | WEBCAT docs use the test log `test.sigsum.org/barreleye` with PoC witnesses: "at this stage we recommend not using a prod policy". | [docs.webcat.tech](https://docs.webcat.tech/print.html) | fetched | H |
| Reproducibility in CI | Merging an updated manifest must not change other files or version stamps. Derive the version from the git commit time and clamp mtimes. Ignore `.well-known/webcat/` paths to avoid CI loops. | [docs.webcat.tech: GitHub Actions](https://docs.webcat.tech/print.html) | fetched | H |
| `max_age` | Example value 15552000 s (180 days). Manifests expire after this. | [docs.webcat.tech](https://docs.webcat.tech/print.html) | fetched | H |
| Deploy consistency | Pages revalidates via ETag on every load, and WEBCAT exempts browser-cached responses from the header check. A residual risk is an old page holding modules from mixed versions; versioned paths per release remove it *(inference)*. | [CF Pages serving](https://developers.cloudflare.com/pages/configuration/serving-pages/), [docs.webcat.tech](https://docs.webcat.tech/print.html) | fetched | M |
| Ship-script gate | Refuse to deploy unless: built hashes = manifest; Sigsum proof present; `_headers` CSP == `default_csp` byte for byte; `! Link` present; `no-transform` present; no inline `<script>`; no off-origin redirects *(inference)*. | — | — | L |

### 1.6 Competitors

| Item | Finding | Source | Date | Conf. |
|---|---|---|---|---|
| Osservatorio Nessuno | **Verifiable web** (WEBCAT-enrolled) plus a CLI plus onion. The closest model to Share's plan. | [uploader](https://upload.osservatorionessuno.org/) | fetched | H |
| Tinfoil | Uses WEBCAT in production for its attestation-verification iframe. | [docs.webcat.tech: examples](https://docs.webcat.tech/print.html) | fetched | H |
| WhatsApp / Meta | Verifiable web via the Code Verify extension (warns, doesn't block). Now co-authoring WAICT. | [meta-code-verify](https://github.com/facebookincubator/meta-code-verify), [Mozilla Hacks](https://hacks.mozilla.org/2026/05/trustworthy-javascript-for-the-open-web/) | 2026-05-05 | H |
| Proton | No served-code verification found for web. Publishes APK certificate SHA-256 values. Its FOSDEM 2020 talk called open source "necessary, but… not sufficient". | [Proton verify-apks](https://proton.me/support/verify-apks), [FOSDEM 2020](https://archive.fosdem.org/2020/schedule/event/dip_securing_protonmail/) | fetched / 2020 | H / M |
| Bitwarden | A WEBCAT port exists, but it was built by the WEBCAT team, not Bitwarden. | [IACR 2025/797](https://eprint.iacr.org/2025/797), [SecureDrop: alpha](https://securedrop.org/news/webcat-alpha/) | 2025 / 2026 | H |
| wormhole.app | 128-bit AES-GCM, key in the fragment, WebRTC P2P or server copy. Says TLS "ensures that the Wormhole webpage code is not modified by attackers". No defence against a compromised server. | [wormhole.app/security](https://wormhole.app/security) | fetched | H |
| crypt.fyi | Apache-2.0, AES-256-GCM (README also mentions ML-KEM), strict CSP, npm CLI. No code verification found. | [osbytes/crypt.fyi](https://github.com/osbytes/crypt.fyi) | excerpt | M |
| Tresorit Send | Client-side encryption in the browser. No integrity mechanism found. | [Tresorit blog](https://tresorit.com/blog/tresorit-opens-its-end-to-end-encrypted-file-sharing-service-to-the-public) | — | L |
| SwissTransfer | Appears to be server-side encryption only, not end-to-end. | [europeanpurpose.com](https://europeanpurpose.com/alternative-to/wetransfer) | — | L |
| Signal | Native only. No official statement found citing served-code risk as the reason. | [Computerworld](https://www.computerworld.com/article/1639074/encrypted-messaging-app-signal-now-available-for-desktops.html) | ~2016 | L |
| Pattern | The large players are standardising (WAICT) and shipping nothing for users yet. The small privacy tools that enrolled early are the only ones with enforced verification *(inference)*. | — | — | L |

## Topic 2 findings

| Item | Finding | Source | Date | Conf. |
|---|---|---|---|---|
| Non-collusion | "The Oblivious Relay Resource cannot be operated by the same entity as the Oblivious Gateway Resource." | [RFC 9458 §6](https://www.rfc-editor.org/rfc/rfc9458#section-6) | 2024-01 | H |
| Cloudflare OHTTP Relay | Formerly Privacy Gateway. Enterprise, closed beta. Logs client IP, target, metadata and timestamp for **about 124 days**. Not usable with a Cloudflare-hosted backend (Cloudflare would see both halves). | [CF OHTTP Relay](https://developers.cloudflare.com/ohttp-relay/), [legal](https://developers.cloudflare.com/ohttp-relay/reference/legal/) | fetched | H |
| Cloudflare OHTTP Gateway | **Announced 2026-10-02**, closed beta with a waitlist, paid zone add-on. Endpoint `/.well-known/ohttp-gateway` (GET returns keys, POST takes requests). Cloudflare manages the keys. Cloudflare Access (mTLS and other policies) authenticates relays. Supports chunked OHTTP. It "will refuse to decrypt requests sent from Cloudflare Workers or from proxied hosts". | [Cloudflare blog](https://blog.cloudflare.com/announcing-cloudflare-ohttp-gateway/) | 2026-10-02 | H |
| oblivious.network | Self-serve relay, live in seconds. **$15/month for 2.62M requests**, $50/month for 13.1M. Forwards only `message/ohttp-req`/`-res` (and chunked), drops all other headers. Optional mTLS client certificate to the gateway. Planned: Privacy Pass authentication. Oblivious Network LLC, Wyoming law. Its privacy policy has no OHTTP-specific retention period. | [pricing](https://oblivious.network/pricing), [relay reference](https://oblivious.network/docs/oblivious/reference/), [mTLS](https://oblivious.network/docs/oblivious/mutual_tls/), [roadmap](https://oblivious.network/docs/oblivious/roadmap/), [terms](https://oblivious.network/terms) | fetched | H |
| oblivious.network hosting | The relay answers with `x-served-by: cache-iad-…`, the Fastly naming style, so it is probably on Fastly rather than Cloudflare. Its marketing site is on Cloudflare and Fly.io *(inference from headers)*. | live headers | 2026-10-10 | L |
| Fastly | Bespoke relay. Per oblivious.network, only for customers on enterprise support of $2,000/month or more (competitor's claim). Strips non-required headers. Runs Google's Privacy Sandbox relay. | [Fastly PR](https://www.fastly.com/press/press-releases/google-selects-fastly-oblivious-http-relay-for-privacy-sandbox), [oblivious.network providers](https://oblivious.network/docs/ohttp/providers/) | 2023-03-15 / fetched | H / M |
| Payjoin (BIP77) relays | Forward only to gateways advertising the BIP77 purpose string. Not usable for Refueler without the operator's explicit agreement. Fixed **8192-byte** padded messages are a pattern worth copying. | [BIP 77](https://github.com/bitcoin/bips/blob/master/bip-0077.md) | Draft v0.2.0 | H |
| Worker as gateway | `hpke-js` runs on Workers, passes RFC 9180 and Wycheproof vectors, and is "not been formally audited". Implementations listed on ohttp.info: `thibmeu/ohttp-ts`, `chris-wood/ohttp-go`, `openpcc/ohttp`, `martinthomson/ohttp` (Rust), Apple Swift. `chris-wood/ohttp-js` targets draft-06. No audited JS library found. | [hpke-js](https://github.com/dajiaji/hpke-js), [ohttp.info](https://ohttp.info/), [ohttp-js](https://github.com/chris-wood/ohttp-js) | fetched | H |
| Formal analysis | Cloudflare has a Tamarin formal analysis of OHTTP's privacy properties. | [ohttp.info](https://ohttp.info/) | fetched | M |
| Key configuration | Clients MUST use a key configuration that is integrity-protected and attributable to the gateway (§6.1), and MUST be protected against configurations that let the gateway track them (§7). RFC 9540 adds DNS SVCB discovery. Fetching keys directly reveals your IP to the gateway; fetch them through a proxy or pin them in the release. | [RFC 9458 §6.1, §7](https://www.rfc-editor.org/rfc/rfc9458#section-6.1), [RFC 9540](https://www.rfc-editor.org/rfc/rfc9540), [ohttp.info](https://ohttp.info/) | 2024 | H |
| Forward secrecy | None if the gateway key leaks: recorded ciphertexts become readable. Rotate keys. | [RFC 9458 §6.6](https://www.rfc-editor.org/rfc/rfc9458#section-6.6), [ohttp.info](https://ohttp.info/) | 2024-01 | H |
| Fresh context | A new HPKE context per request (§6.1). | [RFC 9458 §6.1](https://www.rfc-editor.org/rfc/rfc9458#section-6.1) | 2024-01 | H |
| Traffic analysis | The relay sees message boundaries and timing. Pad messages and consider delays; high relay volume helps (§6.2.3). | [RFC 9458 §6.2.3](https://www.rfc-editor.org/rfc/rfc9458#section-6.2.3) | 2024-01 | H |
| Abuse controls | Relays MAY rate-limit, but differential treatment shrinks the anonymity set (§6.2.1). The gateway may need an agreement with the relay (§6.2.2). In practice: mTLS from the relay, plus per-request **anonymous tokens**. oblivious.network plans Privacy Pass support. | [RFC 9458 §6.2.1–6.2.2](https://www.rfc-editor.org/rfc/rfc9458#section-6.2.1), [oblivious.network roadmap](https://oblivious.network/docs/oblivious/roadmap/) | 2024-01 / fetched | H |
| Applicability | Useful "only… for an application that does not carry state between requests" (§2.1). | [RFC 9458 §2.1](https://www.rfc-editor.org/rfc/rfc9458#section-2.1) | 2024-01 | H |
| Direct bulk transfers | A presigned PUT or GET reveals client IP + object key to the storage operator (Cloudflare R2 is the same company), and the gateway issued that key. So OHTTP on initiate/finalise for the same upload hides almost nothing *(inference)*. | — | — | L (strong) |
| Turnstile + OHTTP | The Turnstile solve talks to Cloudflare from the client's IP. So the solve should only *issue* blind credentials, which are *redeemed* later over OHTTP. Never send the Turnstile token itself over OHTTP *(inference)*. | — | — | L |
| VPN / Tor | OHTTP adds little for Tor users but does no harm. Neither VPN nor Tor fixes the bulk-transfer link unless bulk transfers also go through the VPN or Tor. | — | — | L |

**Claim wording** for the scope in Decision 9: "Requests for upload credentials travel through an independent relay operated by Oblivious Network. The relay sees your IP address but not the request; Refueler sees the request but not your IP address. File uploads and downloads go directly to our storage provider (Cloudflare), which sees your IP address for those transfers. Use Tor or a VPN if that matters to you."

**What still leaks:**
- Your IP address for bulk transfers.
- The relay learns that you use Refueler, and when.
- Request sizes and timing, unless padded.
- Cloudflare (our host) sees all request content.
- Relay and Refueler could collude.
- Gateway key compromise exposes recorded requests.

## Cross-repo notes

For BRIDGE.md. These apply to refueler.io site/POS, Relay, Refill and NutPub as well as Share.

- **One subdomain per key-handling app**, with a static frontend, no inline JS and `script-src 'self'`. WEBCAT's cap is **5 subdomains per site**, so plan which products get one.
- **Cloudflare zone hygiene** on every key-handling host:
  - `Cache-Control: no-transform`.
  - `! Link` in Pages `_headers`.
  - One CSP string, identical in config and server.
  - Web Analytics auto-inject, Email Obfuscation and Rocket Loader off.
  - No challenge rules.
- **Web Analytics auto-inject covers every subdomain in the zone by default**, which breaks any WEBCAT host.
- **Fragment safety:** never let a URL carrying a key in its fragment pass through a cross-origin redirect (WEBCAT pitfall P3).
- **Third-party widgets** (CAPTCHA, payment) only in sandboxed cross-origin iframes, talking through `postMessage` with origin checks.
- **Shared release tooling:** one ship-script module (WEBCAT manifest + Sigsum through ssh-agent + fingerprint publishing). Use separate signer keys per product *(recommendation)*.
- **Shared Android pattern:** WebView wrapper with bundled assets; Obtainium + AppVerifier; Zapstore through `zsp`, `zapstore.yaml` and NIP-C1 certificate linking; F-Droid `AllowedAPKSigningKeys` once builds are reproducible.
- **Cashu as anonymous abuse control** behind an OHTTP gateway: one shared credential-issuer design could serve Share, Refill and NutPub *(inference; product internals not reviewed)*.
- **One shared OHTTP gateway Worker plus one oblivious.network relay** could serve all products' small control calls. Sharing one key configuration gives a larger anonymity set.
- **WEBCAT's wallet verification library** (EF grant) may matter for any Bitcoin/Cashu wallet-facing frontend. Watch for its release.

## Open questions / unverified

1. Does Cloudflare Pages emit a *relative* `Location` on its `.html` and trailing-slash redirects? If not, WEBCAT blocks them. Test with curl on a staging subdomain.
2. Do WEBCAT's checks hold on Firefox for Android ("untested")? This matters for GrapheneOS users who use Firefox rather than Vanadium.
3. Which sandbox flags does Turnstile need inside an iframe? Is `allow-same-origin` required? It's acceptable on our own gate origin but needs testing.
4. Do YubiKey OpenPGP Ed25519 keys through gpg-agent's SSH support work with `sigsum-submit`? Not tested.
5. When will WEBCAT reach beta (cool-down rises to 7 days) and switch to production Sigsum logs?
6. What does oblivious.network retain on its relays? Its privacy policy has no OHTTP-specific retention period. Ask before the pilot, and get it in writing.
7. Is oblivious.network's relay really on Fastly? Inferred from `x-served-by`. Confirm with the operator.
8. When will Cloudflare's OHTTP Gateway reach GA and at what price? Can customers pin or export the key configuration?
9. Is `ohttp-ts` (thibmeu) or WASM `ohttp` (Rust) production-ready on Workers? No audit found for any JS OHTTP stack.
10. Is the 2/3 supermajority enrollment chain's validator set public?
11. Is the Isolated Web Apps rollout to unmanaged desktop or Android dated? Not found.
