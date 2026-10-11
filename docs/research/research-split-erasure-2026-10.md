# Splitting encrypted data across providers and relays: research answers

As of **11 October 2026**. This is research for a later design session, not a design. Nothing here is legal advice.

> **Reviewed — Research-Review-1 · 11 Oct 2026 (outcomes in Share-Master-Context rows 16b / 19 / 20 / 23).**
> - **Confirmed at source:** Privy 0.0.3→0.0.4 diff; noble audit excludes `blake3`; NIP-40 quotes; no splitting NIP; Bellare–Rogaway + Bastion abstracts; Tahoe GC off by default; Hetzner OS Ceph / 64 KB minimum / versioning + object lock; R2 delete "irreversible"; `reed-solomon-simd` 3.1.0; MinIO archived.
> - **Corrected:** Storj monthly minimum is **$5**, not $50 (Q2 table).
> - **Does not match Share:** the deletion latch is an R2 conditional put on the manifest, not D1 (D1 is banned) — Q4's Time Travel caveat does not apply. Our manifest is Worker-written, not encrypted under the user key (Q5). Per-piece hashes must be **BLAKE3**, not SHA-256 (SHA-256 is locked to OTS). merkle-spec §1 leaves are the *stored* bytes, so "Merkle unchanged" needs option (a) (logical-chunk root + piece hashes in a sidecar v2).
> - **Not re-verified:** Hetzner Storage Box snapshots, Hetzner prices, Cure53 PDF contents, Zellic audit.

**Legend**
- ✅ **verified**: I read it this session in a primary source (paper, spec, official docs, vendor pricing page, the library's own published source or registry entry). Where I could only read a search-engine extract of the primary page, I say so.
- 🟡 **secondary**: forum post, blog, press, aggregator. Probably right, not proven.
- 🔵 **inferred**: my reasoning from verified facts. Check it before relying on it.
- 📚 **standard citation from memory**: a well-known paper or RFC I did not re-fetch this session.
- **Not found** means I looked and found nothing.

**How sources were read.** Searches and fetches ran on 11 Oct 2026. GitHub repositories were not reachable from this session, so library facts come from npm, crates.io and PyPI registry data and from the published npm tarballs, which I downloaded and read. The Resch–Plank FAST 2011 PDF returned HTTP 503, so its details come from the USENIX slides, the USENIX listing and a 2017 survey. Prices are as seen today and exclude VAT.

---

## Plain-English summary

**Three tools, three different jobs.**
- **Erasure coding** (Reed-Solomon, or plain XOR parity for 2-of-3) is about **survival**. Cut a chunk into pieces so that any 2 of 3 rebuild it. It provides **no secrecy at all**: in the usual "systematic" form, piece 1 literally *is* the first half of your ciphertext.
- **Shamir secret sharing** is about **secrecy**. Fewer than k shares reveal nothing, even to an attacker with unlimited computing power. But every share is as big as the whole secret, so 2-of-3 costs **3×** storage. It also has **no integrity**: a bad share silently produces a wrong answer.
- **AONT-RS / Krawczyk "Secret Sharing Made Short"** is the middle road used by Cleversafe/IBM. Encrypt under a fresh key, erasure-code the result, and hide the key across the pieces. You get erasure-coding storage cost (**~1.5×** for 2-of-3) and "fewer than k pieces reveal nothing" (computationally, not mathematically).

**Is Shamir needed when the data is already encrypted?**
- **For (A) storage: not over the data, no.** If all you want is "losing one provider loses nothing", plain erasure coding is enough, and Shamir over 32 MiB chunks would be wasteful.
- **But (A) also promises "no single provider holds a whole ciphertext".** That promise is **weaker than it sounds** with plain erasure coding.
  - Your chunks are AES-GCM, which is counter mode underneath. If a share link ever leaks, whoever holds one systematic piece can decrypt *that half* of the file without the other half.
  - Even the parity piece leaks the XOR of the two plaintext halves.
  - Getting the property you actually want needs a small Krawczyk-style layer: a second key that can only be rebuilt from k pieces. That key is only 32 bytes, so Shamir it, not the data.
- **For (B) Nostr messages: yes, Shamir over the ciphertext fits.** Messages are kilobytes, so 3× storage is nothing, and an audited library exists.
  - It only helps if relays don't hand every share to anyone who asks. NIP-40 itself says expired events "are publicly accessible" and relays "MAY persist them indefinitely".

**Deletion.** You can't make n providers *prove* they deleted. You can make it not matter:
1. Keep one small key share **behind your existing single deletion latch**. Destroying it makes every piece everywhere unreadable (crypto-shredding).
2. Then delete the pieces as belt-and-braces, and word the promise honestly.

**Recommendation.**
- **(A):** 2-of-3, one piece per provider (R2, Hetzner Object Storage, your node), with the Krawczyk layer. Its key is split between the latch and the pieces.
  - Per-piece hashes catch a bad piece before decryption. The existing Merkle tree stays exactly where it is.
  - Do the coding in the browser. Don't repair short-lived files.
  - 3-of-5 buys nothing with only three providers.
- **(B):** Shamir 2-of-3 with Privy's audited library, gift-wrapped and expiring, on relays that gate reads behind authentication. Otherwise it is security theatre with extra steps.

---

## Read these five first

1. 🔵 **Plain erasure coding over AES-GCM ciphertext does not stop a single provider learning anything once a share link leaks.**
   - GCM is CTR mode plus a tag. With the key and the (counter-derived) nonces, any contiguous slice of ciphertext decrypts on its own; the tag is optional for an attacker.
   - A systematic 2-of-3 split puts half of each chunk's ciphertext, verbatim, at each data provider.
   - This is exactly the threat Bastion addresses: "data confidentiality even when the encryption key is exposed, as long as the adversary cannot compromise all storage servers" ([Karame et al., ePrint 2014/556](https://eprint.iacr.org/2014/556) ✅ abstract; journal version IEEE TCC 2017 🟡).
2. ✅ **Privy's `shamir-secret-sharing` 0.0.4 is not byte-identical to the audited code, and that is fine.**
   - Cure53 audited commit `3383ad9` in Feb 2023 (report dated 24 Apr 2023) and rated "degree of polynomial might be less than t-1" **High**.
   - 0.0.4 (10 Jan 2025) deliberately **removed** that fix. I diffed the 0.0.3 and 0.0.4 tarballs.
   - Privy says Cure53 reversed its own finding in April 2024, and that forcing non-zero coefficients "violates the uniform random sampling requirement" ([Privy blog, 10 Jan 2025](https://privy.io/blog/zero-leading-coefficients-cryptography) ✅).
   - 🔵 The current code is textbook Shamir. Still, your audit trail should say "audited 2023; one deliberate, published change since".
3. ✅ **Not found:** any audited, open-source AONT-RS implementation, or any audited JS/WASM Reed-Solomon library.
   - Reed-Solomon isn't a secrecy primitive, so the absence of an audit matters less: bugs show up as failed hash checks and fail closed.
   - The secrecy must come from audited parts: WebCrypto AES-GCM/HKDF and Privy Shamir.
4. ✅ **No NIP defines secret-sharing or erasure-coding events across relays.** I checked the NIP index for Shamir, threshold, splitting, erasure and FROST. (B) would be a Refueler-only event format that other clients cannot read.
5. ✅ **Hidden retention traps on the providers you named.**
   - Hetzner Object Storage supports **versioning and object lock**. On a versioned bucket, a DELETE normally just adds a delete marker 🟡 (general S3 behaviour, not Hetzner-specific).
   - Hetzner **Storage Box** BX11 includes **10 snapshots** ✅, which would quietly keep "deleted" pieces.
   - Cloudflare **D1 Time Travel** keeps restorable history for **30 days** on paid plans ✅. That applies if the latch lives in D1.

---

## Q1. Erasure coding vs secret sharing vs AONT-RS

### What each actually guarantees

| Scheme | Fewer than k pieces reveal… | Storage for 2-of-3 | Integrity built in? | Source |
|---|---|---|---|---|
| **Systematic Reed-Solomon / XOR parity** | **Everything in that piece.** A data piece *is* a slice of the input. | 1.5× | No | 🔵 by construction |
| **Rabin IDA** (non-systematic) | Linear combinations of the input. "Not secret" in any formal sense. | 1.5× | No | 📚 Rabin, *JACM* 36(2), 1989 |
| **Shamir** | **Nothing**, information-theoretically, provided coefficients are uniformly random | **3×** (each share = secret size + 1 byte) | **No.** Forged shares go undetected (Tompa–Woll, 1988/89) | 📚 Shamir, *CACM* 22(11), 1979; ✅ Privy README "not responsible for verifying the result"; 🟡 [Tompa–Woll summary](https://researchonline.jcu.edu.au/504/) |
| **Krawczyk SSMS**: encrypt under random K, IDA the ciphertext, Shamir K | Nothing, computationally | 1.5× + one key share per piece (~33 B) | Not robust as originally stated; Bellare–Rogaway give a robust variant using commitments | 🟡 descriptions; ✅ [Bellare & Rogaway, CCS 2007 / ePrint 2006/449](https://eprint.iacr.org/2006/449) |
| **AONT-RS**: Rivest-style AONT with key folded into the package, then systematic RS | Nothing, computationally | 1.5× + one hash-sized block | **Yes**, via a "canary" checked after decoding (detects, does not locate) | ✅ [USENIX FAST '11 listing](https://www.usenix.org/conference/fast11/aont-rs-blending-security-and-performance-dispersed-storage-systems); ✅ [Resch slides](https://static.usenix.org/events/fast11/tech/slides/resch.pdf): "developed at Cleversafe in 2007", claims vs SSMS "encoding is faster, integrity is protected, output is shorter" |
| **Bastion / Kapusta–Memmi–Rambaud**: encrypt, linear post-transform, disperse | Nothing, **even with the encryption key**, unless the attacker has *all* pieces (or all but one, in Kapusta) | ~1× + transform | No | ✅ [ePrint 2014/556](https://eprint.iacr.org/2014/556); ✅ [arXiv 1901.08083](https://arxiv.org/abs/1901.08083) (v4, Feb 2020) |

Notes:
- ✅ **Bellare–Rogaway (CCS 2007)** showed Krawczyk's 1993 scheme "need not be secure" if the cipher is only one-query indistinguishable. It is secure if the cipher also resists key recovery from one query ("key1"). 🔵 AES-GCM under a fresh random key is the standard example of a cipher that meets both.
- ✅ The AONT-LT paper ([arXiv 1405.7586](https://arxiv.org/abs/1405.7586)) and the 2017 fragmentation survey ([arXiv 1706.05960](https://arxiv.org/abs/1706.05960)) both describe AONT-RS as AONT then **systematic** RS.
- 🟡 An AONT on its own is only as strong as the attacker's inability to get *all* of the package. A 2019 analysis notes that "an attacker knowing the first key can decrypt the fragment of the ciphertext in her possession". This is the same CTR-slice point as Read-first 1.

### Which fits (A) storage

- 🔵 **Availability only** ("lose one provider, lose nothing"): systematic erasure coding is enough. For 2-of-3, **XOR parity is all the maths you need**: pieces are `A`, `B`, `A⊕B`, and any two rebuild the chunk. No library is involved.
- 🔵 **"No single provider/jurisdiction holds anything usable, even if a share link leaks later"**: you need the Krawczyk/AONT idea on top. Plain erasure coding fails here (Read-first 1).
- 🔵 **Recommended construction, built only from audited parts.** Call it "SSMS-from-parts":
  1. Per file, generate `K_d` (32 random bytes). Derive per-chunk keys `K_d,i = HKDF(K_d, "disperse" ‖ i)` (WebCrypto HKDF).
  2. `D_i = AES-256-GCM(K_d,i, C_i)`, where `C_i` is today's ciphertext chunk (WebCrypto).
  3. Erasure-code `D_i` into n pieces (XOR parity for 2-of-3, or RS for anything else).
  4. Protect `K_d`. Option 1 (pure Krawczyk): Shamir-split `K_d` k-of-n with Privy and put one share in each piece's header. Option 2 (recommended, see Q4): `K_d = HKDF(K_c ‖ K_s)`. `K_c` sits behind your deletion latch; `K_s` is Shamir-split across the pieces.
  - Result: one piece plus a leaked share link gives nothing. Cost: one extra AES-GCM pass per chunk, plus about 50 bytes per piece.
  - 🔵 This is a *composition* of audited primitives, not a new primitive. It still deserves a written spec and a review. Your "no hand-rolled crypto" rule is satisfied in letter. Get a reviewer to confirm the spirit.
- 🔵 **Shamir over the 32 MiB data itself: no.** It costs 3× storage and runs a GF(2^8) loop per byte per share in JavaScript. And it buys only an information-theoretic guarantee you can't use, because the data is AES-encrypted anyway.

### Which fits (B) messages

- 🔵 **Shamir over the NIP-44 ciphertext, directly.** Messages are small: NIP-44 v2 caps plaintext at 65,535 bytes 📚. So 3× is a few kilobytes, and you avoid inventing a key-wrapping format. Privy's library takes the bytes and returns shares of `len + 1` bytes ✅ (source read).
- 🔵 Krawczyk would save space only on large payloads. It isn't worth the extra format for chat-sized messages.

---

## Q2. Prior art and what went wrong

| System | What it does | Lessons for you |
|---|---|---|
| **Tahoe-LAFS** | Encrypt, segment, erasure-code each segment with **zfec**. Defaults k=3, happy=7, N=10. Merkle hashes over ciphertext and shares in a "Capability Extension Block" whose hash is in the read capability ✅ [architecture doc](https://tahoe-lafs.readthedocs.io/en/stable/architecture.html) | **Your layering is theirs.** Encrypt first, code the ciphertext, and verify pieces with hashes the reader already trusts. **Deletion is weak:** shares are only freed when leases lapse, and "Garbage collection is not enabled by default" ✅. **Upload is ~3.3× the file** with defaults, and the docs call out slow asymmetric uplinks ✅. zfec 1.6.0.0 (Nov 2024) is **GPL-2+** ✅ PyPI. |
| **Storj** | Client-side encryption, then RS with historically **29 needed / 80 kept** (~2.76×). Uploads start to more nodes and cancel the slow tail 🟡 ([forum](https://forum.storj.io/t/future-changes-to-reed-solomon-numbers/9921), [2018 code](https://gitea.hillion.co.uk/JakeHillion/storj/commit/f1a82e588c81a42dcce280b98f900c4821150fee)) | **Deletion is lazy.** Nodes learn what to drop from periodic bloom filters, false positives keep some garbage, and dropped pieces sit in a 7-day trash 🟡 ([design doc](https://gitea.hillion.co.uk/JakeHillion/storj/src/commit/44359e8bb3a1b848d467c32b02d39cf8119b8eca/docs/design/garbage-collection.md), [forum](https://forum.storj.io/t/trash-stored-more-than-7-days-168h/8012)). **Small files hurt.** They once charged a per-segment fee ($0.0000088/segment-month, 64 MB default segment ✅ [legacy pricing](https://storj.dev/dcs/pricing/legacy)). They now bill a 50 KB minimum per object, a **30-day minimum retention** and a $50/month minimum from 1 Jul 2026 (✅ via search extract of [storj.dev pricing](https://storj.dev/dcs/pricing/simplified)). Minimum-retention billing punishes destroy-after-download. |
| **Sia (renterd)** | Default redundancy **30-10** on mainnet (3×) ✅ [docs](https://docs.sia.tech/store-your-data/setting-up-renterd/managing-your-files) | 🔵 The renter owns repair: hosts churn, health drops, and *your* software must re-upload. 3× is the price of untrusted hosts. With three providers you trust contractually, 1.5× is enough. |
| **Filecoin / IPFS** | Filecoin replicates sealed sectors with no protocol-level erasure coding (🔵 from spec reading). Deals end when they expire or the sector is terminated for faults ✅ [spec](https://spec.filecoin.io/systems/filecoin_markets/onchain_storage_market/storage_deal_states/) | **No client-side early delete** in the deal lifecycle 🔵. A community note says providers "can't remove expired deal data from sectors" 🟡. IPFS copies persist wherever pinned 🟡. **Incompatible with destroy-after-download.** |
| **Cleversafe → IBM Cloud Object Storage** | Encrypt, then dispersal ("SecureSlice"). AONT-RS developed there in 2007 ✅ slides; IBM bought Cleversafe in 2015 🟡 [press](https://www.networkworld.com/article/956314/ibms-cleversafe-storage-platform-is-becoming-a-cloud-service.html) | Proof that AONT-RS works commercially at scale. 🔵 Cleversafe filed many dispersal patents in 2005–2010. Some may still be in force for a few more years. **Freedom-to-operate is an open decision** if you copy AONT-RS exactly. Krawczyk (1993), Rabin (1989) and Shamir (1979) are long out of patent. |
| **MinIO** | Per-object RS erasure coding. Small objects stored inline 🔵 | 🟡 Community edition removed web-UI features (May 2025), stopped publishing binaries (Oct 2025), went to maintenance mode (Dec 2025) and was archived in 2026 ([write-up](https://glukhov.org/data-infrastructure/object-storage/minio-dead/), [itsfoss](https://itsfoss.com/news/minio-moves-away-from-open-source/)). **Don't build your self-hosted node on MinIO CE.** Garage, SeaweedFS and Ceph RGW are the usual alternatives 🟡. |
| **Ceph EC** | k+m pools; Hetzner Object Storage itself runs on Ceph ✅ [Hetzner docs](https://docs.hetzner.com/storage/object-storage/overview/) | **Small-object amplification.** Each of the k+m chunks pays the minimum allocation, so a 4+2 pool stores anything under 16 KiB as six 4 KiB chunks 🟡 ([ceph-users](https://lists.ceph.io/hyperkitty/list/ceph-users@ceph.io/thread/GCOAUETNU6EWY6C7ZY4GA2YHFDC7NN6O/), [IBM](https://www.ibm.com/support/pages/node/7229530)). Tentacle (20.2) adds `allow_ec_optimizations` to cut the padding 🟡. |
| **Facebook / HDFS** | RS(10,4) and later LRC | ✅ "XORing Elephants" estimates repair traffic at 10–20% of a 3,000-node cluster's network ([arXiv 1301.3791](https://arxiv.org/abs/1301.3791)). 🟡 Hitchhiker found 98% of repairs were single-block. **Repair is the hidden cost of erasure coding.** 🔵 At n=3 with short-lived files you can mostly skip it (Q6). |
| **Codex → "Logos Storage"; Waku** | Codex: erasure coding, lazy repair, ZK remote auditing 🟡 [free.technology](https://free.technology/codex). Rename to Logos Storage seen; mainnet date unconfirmed 🟡 | ✅ Waku says Store is "designed to temporarily store messages" with no availability guarantee, and points long-term storage at Codex ([Waku FAQ](https://docs.waku.org/learn/faq), via extract). Nothing directly reusable for you today. |
| **Nostr** | **No NIP for secret sharing or splitting** ✅ [NIP index](https://nips.nostr.com/). Blossom (NIP-B7) stores blobs by hash with a BUD-02 delete endpoint 🟡 | ✅ NIP-40: "Relays MAY NOT delete expired messages immediately… and MAY persist them indefinitely". Also: "don't consider expiring messages as a security feature". ✅ NIP-62 (draft, updated 2026-06-13): relays named in a vanish request "MUST fully delete". 🟡 A re-uploaded Blossom blob can't be invalidated by the original uploader. 🟡 Academic precedent for Shamir-over-relays messaging exists ([Wichita State thesis](https://soar.wichita.edu/items/954e106d-b4d4-499e-b3e3-bd7c27f4b490)). |

**Patterns across all of them.** 🔵
- Every system that does this well encrypts **first** and codes the ciphertext.
- Every one verifies pieces against hashes the reader already trusts.
- Every one finds **deletion** the hardest promise to keep.
- Every one pays a **small-file tax**: per-object minimums, per-request overhead, tail latency.

---

## Q3. Libraries usable in a browser and a Cloudflare Worker

### Shamir

| Library | Version (date) | Licence | Audit | Notes |
|---|---|---|---|---|
| **`shamir-secret-sharing`** (Privy) | **0.0.4** (10 Jan 2025); previous 0.0.3 (17 Aug 2023) ✅ npm | Apache-2.0 ✅ | **Cure53, Feb 2023** (2 days, 2 testers, commit `3383ad9`; 1 High, 2 Info) ✅ [report](https://cure53.de/audit-report_privy-sss-library.pdf). **Zellic, Jul 2023** 🟡 per Privy | Zero dependencies. GF(2^8) with polynomial x⁸+x⁴+x³+x+1, tables taken from **HashiCorp Vault's** `shamir/tables.go` ✅ source comment. 2–255 shares. Share = secret + 1 byte (last byte = x-coordinate). Uses `crypto.getRandomValues`. The README warns JS can't be truly constant-time ✅. External contributions are not accepted ✅. |
| `secrets.js-grempe` | 2.0.0 (Sep 2019) ✅ npm | MIT | 🟡 a 2019 review is claimed by a third-party listing only | Stale. Avoid. |
| `@noble/*` / `@scure/*` | n/a | n/a | n/a | **Not found.** No Shamir package from Paul Miller's audited suites. |

🔵 **Known-answer tests for Shamir.**
- `split()` draws its own randomness and has no hook to inject it, so you **cannot** pin `split` output.
- You **can** pin `combine()`, which is deterministic:
  - generate fixed share sets once and freeze them;
  - cross-check them against HashiCorp Vault's Go `shamir.Combine`, which uses the same field tables;
  - add property tests (`combine(any k of split(s)) == s`, and fewer than k ≠ s for random s).

### Erasure coding

| Library | Version (date) | Licence | Browser/Worker | Audit |
|---|---|---|---|---|
| **XOR parity** (your own ~20 lines) | n/a | n/a | Native JS | Not needed. 🔵 Handles 2-of-3 and any k-of-(k+1). Trivial known-answer tests. |
| `reed-solomon-simd` (Rust) | **3.1.0** (14 Oct 2025) ✅ crates.io | MIT AND BSD-3-Clause ✅ | 🔵 compile to WASM yourself. The README does not mention wasm32 ✅. Leopard-RS based, O(n log n); shards must be even length, and multiples of 64 bytes stay compatible across versions ✅ | **Not found** |
| `reed-solomon-erasure` (Rust) | 6.0.0 (Sep 2022) ✅ | MIT ✅ | 🔵 pure-Rust build should target WASM. Slow-moving. | **Not found** |
| `@subspace/reed-solomon-erasure.wasm` | 0.2.5 (2019) ✅ npm | MIT | Ready-made WASM, but **stale** | **Not found** |
| `@ronomon/reed-solomon` | 6.0.0 (2019) ✅ npm | MIT | Node native addon. **Not browser.** | **Not found** |
| `zfec` (Tahoe) | 1.6.0.0 (Nov 2024) ✅ PyPI | **GPL-2+** | Python/C. Not browser. | **Not found** |

🔵 **Recommendation.**
- **Use XOR parity for 2-of-3 and add no dependency.** Only reach for `reed-solomon-simd`→WASM if you later need n−k ≥ 2.
- **Known-answer tests for RS:** freeze vectors from two independent implementations and require byte equality. Your per-piece hashes make any coder bug fail closed rather than corrupt silently.

### Supporting primitives (already in your stack or native)

- **WebCrypto** AES-GCM, HKDF and SHA-256 are native in browsers and Workers. 📚 Use NIST CAVP / Wycheproof vectors for GCM and RFC 5869 Appendix A for HKDF.
- **BLAKE3:** ✅ `@noble/hashes` 2.4.0 (27 Aug 2026, MIT) says its Cure53 audit (Jan 2022, v1.0.0) covered "everything, besides `blake3`…". 🔵 If your Merkle tree uses noble's BLAKE3, that module is **unaudited**. Use SHA-256 (WebCrypto) for the new per-piece hashes, so this layer adds no unaudited code.

### Cloudflare Worker fit

- ✅ The 128 MB memory limit is **per isolate, including WASM**. Request body limit is 100 MB on Free/Pro. CPU time is up to 5 min on paid plans (default 30 s) ([limits](https://developers.cloudflare.com/workers/platform/limits/)).
- 🔵 Encoding a 32 MiB chunk to 3 × 16 MiB needs about 80 MiB of buffers. That fits, but leaves little headroom on a shared isolate. **Encode and decode in the browser.**
- The Worker should only hand out per-provider upload/download authority and record state. A server-side repair job (Q6) is the one place it would touch piece bytes.

---

## Q4. Deletion: making "deleted" true across n providers

### What each provider actually says

| Provider | What's documented | Gaps / traps |
|---|---|---|
| **Cloudflare R2** | ✅ "Deleting objects from a bucket is irreversible". Lifecycle expiry within ~24 h. `DeleteObject` is a **free** operation ([pricing](https://developers.cloudflare.com/r2/pricing/), updated 1 Oct 2026) | **Not found:** any statement on physical erasure or backup retention after delete. Bucket locks override deletes ✅. |
| **Hetzner Object Storage** | ✅ Ceph-based; objects immutable; DELETE is a free API call; object lock and versioning offered | **Not found:** retention after delete. 🟡 On a versioned bucket a DELETE leaves old versions. **Keep versioning and object lock off on shard buckets, and assert that in a startup check.** |
| **Hetzner Storage Box** | ✅ BX11 includes **10 snapshots** | 🔵 Snapshots keep deleted pieces until they rotate. **Don't use Storage Box for pieces**, or disable the snapshot plan. |
| **Your own node** | Whatever you configure | 🔵 No snapshots or backups on the shard volume. Full-disk encryption with a key you destroy at decommission. SSD wear-levelling means "overwrite" is not "erase". |
| **The latch store** (wherever it lives today) | ✅ D1 Time Travel restores any minute of the last **30 days** (Paid) / 7 days (Free), always on ([docs](https://developers.cloudflare.com/d1/reference/time-travel/)) | 🔵 A key "destroyed" in D1 is recoverable by whoever can restore the database for up to 30 days. Say so. (Your earlier research flagged D1 and the Durable Objects house-policy question; that decision applies here too.) |

### Making one latch control n providers

🔵 **Crypto-shred first, delete second.**
1. **The latch holds `K_c`**, one half of the dispersal key (Q1, option 2). Every piece holds a Shamir share of `K_s`. `K_d = HKDF(K_c ‖ K_s)`.
2. On download completion (or expiry), **flip the latch and destroy `K_c`** in one transaction. From that instant, every piece at every provider is ciphertext under a key that no longer exists, whatever any provider does next. A share-link leak doesn't change that.
3. **Then fan out the piece deletes.** Record each piece in a tombstone table (`pending → confirmed / failed`), retry with backoff, and run a daily reconciliation that lists each bucket by prefix to find orphans.
4. **Fail closed:** downloads check the latch *before* fetching any piece. Fewer than k valid pieces is an error, never partial output.

Notes:
- 🔵 This keeps your **single** deletion latch. Providers become a defence-in-depth layer, not the thing your promise depends on.
- 🔵 Trade-off: the server now holds `K_c`. It is useless without `K_s` (k pieces) **and** the share-link key, so the server still learns nothing. But it is a server-held key, and that changes your "zero-knowledge" wording. **Open decision.**
- 🔵 Without option 2 (pure Krawczyk): deleting any n−k+1 pieces destroys the data. For 2-of-3, that is deleting at **two** providers you control (R2 plus your node). The third provider's "promise" is then mathematically irrelevant.

### Saying it honestly (draft copy for the design session) 🔵

> **Deleted means:** the key Refueler held for this file was destroyed when you downloaded it. Our database backups of that key expire within 30 days. The encrypted pieces were then deleted at Cloudflare, Hetzner and our own server, and each deletion was confirmed. Any one piece is unreadable on its own, even with your link. We can't inspect another company's hardware. That's why we destroy the key first instead of relying on their deletion.

Avoid "permanently erased everywhere". Nobody can prove that for third-party disks.

---

## Q5. Integrity: where the piece layer sits relative to the Merkle tree

🔵 **Stacking order (top = what the user sees):**

```
plaintext
  └─ user key: AES-256-GCM STREAM ─► C_i            ← existing; Merkle leaves (BLAKE3, RFC 6962-style) over C_i — UNCHANGED
        └─ K_d,i: AES-256-GCM ─► D_i                ← new: dispersal layer (the GCM tag is a second integrity check)
              └─ XOR / RS ─► piece P_i,j (+ header: x-coord, Shamir share of K_s, version)
                    └─ h_i,j = SHA-256("refueler-piece-v1" ‖ file_id ‖ i ‖ j ‖ P_i,j)   ← new: per-piece hash
```

**Download order, failing closed at each step:**
1. Check the latch.
2. Fetch k pieces.
3. **Check each piece against `h_i,j` before using it.** On a mismatch, discard that piece and fetch another. Error if fewer than k are good.
4. Combine the `K_s` shares and derive `K_d,i`.
5. Decode `D_i`, then GCM-open it with `K_d,i`.
6. Check `C_i` against its Merkle leaf.
7. STREAM-decrypt with the user key.

**Why three checks?** 🔵
- The **per-piece hash** is the only one that says *which* piece is bad, so you can route around a corrupt or malicious provider.
- GCM and Merkle can only say "something below me is wrong".
- The per-piece hash also covers the Shamir share in the header. That closes the Tompa–Woll forged-share problem (Q1), provided the hash list itself is authentic.

**Where the hash list lives.** 🔵
- Put it in the manifest your users already trust: encrypted and authenticated under the user key, and bound to the Merkle root.
- Also keep a plaintext copy server-side so the Worker can verify uploads and run repair without any key.
- Hashes of random-looking ciphertext reveal nothing useful.
- A 1 GiB file is 32 chunks × 3 pieces × 32 B = **3 KiB** of hashes. A flat list is fine; no second tree is needed.

**Why the Merkle tree stays where it is.** 🔵 Keeping it over `C_i` means your end-to-end integrity claim doesn't depend on the dispersal layer at all. You can add, change or remove dispersal without touching the Merkle format or its known-answer tests.

---

## Q6. Cost model: 2-of-3 and 3-of-5 at 32 MiB chunks

### Piece sizes per 32 MiB chunk (🔵 arithmetic)

| Scheme | Piece size | Total stored | Overhead |
|---|---|---|---|
| Today (1 copy on R2) | 32 MiB | 32 MiB | 1.00× |
| **2-of-3** | 16 MiB (+~70 B header) | 48 MiB | **1.50×** |
| **3-of-5** | 11,184,832 B (padded to ×64) | ~53.3 MiB | **1.67×** |

🔵 **3-of-5 with only three providers is a trap.** Some provider must hold two pieces (layout 2/2/1). Losing a two-piece provider leaves exactly 3 pieces, with no slack. That is the same fault tolerance as 2-of-3 for more storage. 3-of-5 only earns its keep with **five independent locations**.

### Monthly storage per 1 TB of user ciphertext (one piece per provider)

| | Today | 2-of-3 (R2 / Hetzner OS / own node) |
|---|---|---|
| R2 at $0.015/GB-month ✅ | 1,000 GB → **$15.00** | 500 GB → **$7.50** |
| Hetzner Object Storage | none | 500 GB, inside the 1 TB included in the base fee ✅. Base reported at **€6.49/month** after the 1 Apr 2026 rise 🟡 ([sliplane](https://sliplane.io/blog/cheap-object-storage-providers-europe), [agentdeals](https://agentdeals.dev/hetzner-pricing-2026)). Above quota, sources disagree: about €6–9/TB-month 🟡. **Check hetzner.com before budgeting.** |
| Own node | none | 500 GB of your disk and power |
| **Total stored** | 1.0 TB | **1.5 TB** |

🔵 At 10 TB:
- Today: R2 costs $150/month.
- 2-of-3: R2 $75, plus Hetzner (5 TB) at roughly €30–45, plus your node.
- R2 operations per chunk don't increase: R2 receives one PUT and serves at most one GET per chunk, as now.
- Hetzner bills no request fees ✅. Deletes are free on both ✅.

### Bandwidth

- **Download:** fetch k pieces, so **1.0×** the chunk, as today.
  - R2 egress is free ✅.
  - Hetzner egress counts against 1 TB/month included, then about €1/TB 🟡.
  - 🔵 Fetching k+1 and taking the first k (Storj's tail trick) costs 1.5× egress and hides a slow provider.
- **Upload (the real cost, paid by your user's uplink):** 🔵 1.5× (2-of-3) or 1.67× (3-of-5).
  - A 1 GiB file on a 20 Mbit/s uplink: **7.2 min today → 10.7 min (2-of-3) → 11.9 min (3-of-5)**.
  - On a 50 Mbit/s uplink: 2.9 → 4.3 → 4.8 min.
  - This is Tahoe's documented "asymmetric link" complaint ✅.
- **Privacy:** 🔵 if browsers talk to providers directly, **each provider sees the viewer's IP**. That is three companies instead of one. Proxying through the Worker hides it, but routes Hetzner egress through Cloudflare (same Hetzner egress charge, more Worker time). **Open decision.**

### Availability (🔵 arithmetic, independent failures)

- If each provider is up 95% of the time: P(at least 2 of 3) = **99.28%**, against 95% for one provider.
- At 99% each: 99.97%.
- 🔵 The same maths makes (B) *more* reliable than a single relay, not less.

### Small files (one chunk ≤ 32 MiB)

- 🔵 Money is irrelevant. A 10 KB file becomes three pieces of ~5 KB.
  - Hetzner bills a **64 KB minimum per object** ✅, so it is billed as 64 KB.
  - **Not found:** any minimum object size on R2's pricing page.
- 🔵 What changes is **latency and failure surface**: 3 parallel PUTs on upload and 2 GETs on download, so wall-clock time is set by the slower provider.
  - Your own node will probably be the slow one. Make it the parity piece, the one you normally don't fetch.
- 🔵 Don't special-case small files. One code path keeps the privacy promise uniform, and the extra cost is milliseconds.
- **Avoid providers with minimum retention billing:** Storj's 30-day minimum ✅ extract, and the like. Destroy-after-download would pay for 30 days on every file.

### Repair

- 🔵 For **destroy-after-download and short-TTL files, don't repair.**
  - If a provider dies, existing files run on 2 of 3 (still readable) until they expire.
  - New uploads go to a replacement provider.
  - This avoids the whole Facebook/HDFS repair-traffic problem.
- 🔵 For long-lived files, a Worker can rebuild a missing piece from 2 others **without any user key**, because the coding runs over ciphertext.
  - But recreating that piece's Shamir share of `K_s` means interpolating `K_s`, so **the repairer learns `K_s`**.
  - Under option 2 the server already holds `K_c`, so it would then hold `K_d`. It still lacks the user key.
  - Decide whether that's acceptable before offering long-lived dispersed files.

---

## Q7. Recommendation for the design session

### (A) Storage: build it, in this shape 🔵

1. **2-of-3, one piece per provider:** R2, Hetzner **Object Storage** (versioning and lock off; not Storage Box), and your node (not MinIO CE).
2. **Coding:** XOR parity, with no new dependency. Put pieces A and B on the two fast providers and A⊕B on your node.
3. **Dispersal layer:** the SSMS-from-parts construction from Q1 (WebCrypto AES-GCM + HKDF, Privy Shamir for `K_s` only).
4. **Deletion:** `K_c` behind the existing latch, destroyed on download or expiry. Then confirmed fan-out deletes, a tombstone table and daily reconciliation.
5. **Integrity:** per-piece SHA-256 in the authenticated manifest. The Merkle tree is unchanged over `C_i`. Fail closed at all four checks.
6. **Where code runs:** encode and decode in the browser. The Worker hands out upload/download authority, tracks state and runs any repair.
7. **No repair** for ephemeral files.
8. **Known-answer tests:**
   - frozen Shamir `combine` vectors, cross-checked with Vault;
   - XOR parity vectors;
   - GCM and HKDF vectors from NIST CAVP, Wycheproof and RFC 5869;
   - an end-to-end vector (fixed keys → fixed pieces → fixed hashes), made possible by injecting `K_d` in tests.

### (B) Nostr messages: build it only if the relays co-operate 🔵

1. Shamir **2-of-3** over the NIP-44 ciphertext with Privy.
2. Each share goes in its own **NIP-59 gift wrap** with a distinct ephemeral key, so a crawler can't group shares by author. Each carries a **NIP-40 expiration**.
3. Send to **three relays run by different operators**, in different jurisdictions, that **restrict reads of kind 1059 to the authenticated recipient (NIP-42)**.
4. **State the limit plainly.** Shamir protects against up to k−1 relays that keep data past expiry. It does **not** protect against:
   - a crawler or archive that collects k shares while they're live;
   - anyone holding the recipient's leaked key while ≥k relays still serve the shares (they can authenticate as the recipient).
   - It defends against "a relay kept it". It does not defend against "everything is public".
5. Expect no interoperability: other clients will see gift wraps they can't open. Consider a NIP draft later.

### Open decisions

1. **Threat model for (A):** is "share link leaks later + one provider retains data" in scope? If not, drop the dispersal layer and use XOR parity alone for availability.
2. **Server-held `K_c`** (true one-latch crypto-shredding) **vs pure Krawczyk** (no server key; deletion needs two confirmed provider deletes). This affects your "zero-knowledge" wording.
3. **Latch store retention:** D1's 30-day Time Travel vs somewhere with shorter or no history. This ties to the earlier Durable Objects house-policy question.
4. **Direct-to-provider vs proxied downloads:** viewer IP exposure to three companies vs extra Worker load.
5. **XOR parity (our ~20 lines) vs a Reed-Solomon library:** whether "no hand-rolled crypto" extends to non-crypto coding maths.
6. **Composition review:** who signs off the SSMS-from-parts spec, given no audited AONT-RS exists. **Freedom-to-operate** if you copy Cleversafe's AONT-RS rather than Krawczyk.
7. **Privy library pinning:** pin 0.0.4 exactly and vendor it, and note the post-audit change in your security docs.
8. **Third provider identity:** your own node, or a second commercial provider? Your node is cheapest; a second company has stronger durability.
9. **(B) go/no-go:** depends on finding three independent relays with authentication-gated reads that honour NIP-40.
10. **Long-lived files:** offer them at all? If so, is a repairer learning `K_s` acceptable?

---

## Sources (all accessed 11 Oct 2026)

**Papers and specs**
- Resch & Plank, "AONT-RS", USENIX FAST '11, Feb 2011: [listing](https://www.usenix.org/conference/fast11/aont-rs-blending-security-and-performance-dispersed-storage-systems), [slides](https://static.usenix.org/events/fast11/tech/slides/resch.pdf); [PDF](https://web.eecs.utk.edu/~jplank/plank/papers/FAST-2011.pdf) returned 503.
- Bellare & Rogaway, "Robust Computational Secret Sharing…", CCS 2007: [ePrint 2006/449](https://eprint.iacr.org/2006/449), [PDF](https://www.cs.ucdavis.edu/~rogaway/papers/rcss.pdf).
- Karame, Soriente, Lichota, Capkun, "Bastion": [ePrint 2014/556](https://eprint.iacr.org/2014/556).
- Kapusta, Memmi, Rambaud, "Revisiting Shared Data Protection Against Key Exposure": [arXiv 1901.08083](https://arxiv.org/abs/1901.08083).
- "AONT-LT" (2014): [arXiv 1405.7586](https://arxiv.org/abs/1405.7586).
- Fragmentation-for-data-protection survey (2017): [arXiv 1706.05960](https://arxiv.org/abs/1706.05960).
- Sathiamoorthy et al., "XORing Elephants": [arXiv 1301.3791](https://arxiv.org/abs/1301.3791).
- Hitchhiker summary: [acolyer.org](https://blog.acolyer.org/2014/12/17/a-hitchhikers-guide-to-fast-and-efficient-data-reconstruction-in-erasure-coded-data-centers/).
- Tompa–Woll and cheating prevention: [JCU](https://researchonline.jcu.edu.au/504/).
- 📚 Not re-fetched: Shamir, CACM 1979; Rabin, JACM 1989; Krawczyk, CRYPTO '93; Rivest, FSE 1997; RFC 5869.
- Nostr: [NIP index](https://nips.nostr.com/), [NIP-40](https://nips.nostr.com/40), [NIP-62](https://nips.nostr.com/62).
- Filecoin: [deal states](https://spec.filecoin.io/systems/filecoin_markets/onchain_storage_market/storage_deal_states/).

**Libraries**
- Privy: npm [`shamir-secret-sharing`](https://www.npmjs.com/package/shamir-secret-sharing) (0.0.3 and 0.0.4 tarballs read), [README](https://unpkg.com/shamir-secret-sharing@0.0.4/README.md), [Cure53 report](https://cure53.de/audit-report_privy-sss-library.pdf), [Privy blog](https://privy.io/blog/zero-leading-coefficients-cryptography).
- Erasure coding: crates.io `reed-solomon-simd` ([repo](https://github.com/AndersTrier/reed-solomon-simd)), `reed-solomon-erasure`, `reed-solomon-16`; npm `@subspace/reed-solomon-erasure.wasm`, `@ronomon/reed-solomon`, `secrets.js-grempe`; PyPI `zfec`.
- Hashes: [`@noble/hashes` README](https://unpkg.com/@noble/hashes@2.4.0/README.md).

**Systems and providers**
- Tahoe-LAFS: [architecture](https://tahoe-lafs.readthedocs.io/en/stable/architecture.html).
- Storj: [legacy pricing](https://storj.dev/dcs/pricing/legacy), [simplified pricing](https://storj.dev/dcs/pricing/simplified), [GC design](https://gitea.hillion.co.uk/JakeHillion/storj/src/commit/44359e8bb3a1b848d467c32b02d39cf8119b8eca/docs/design/garbage-collection.md), [forum](https://forum.storj.io/t/future-changes-to-reed-solomon-numbers/9921).
- Sia: [renterd docs](https://docs.sia.tech/store-your-data/setting-up-renterd/managing-your-files).
- MinIO: [glukhov.org](https://glukhov.org/data-infrastructure/object-storage/minio-dead/), [itsfoss](https://itsfoss.com/news/minio-moves-away-from-open-source/).
- Ceph: [IBM](https://www.ibm.com/support/pages/node/7229530), [ceph-users](https://lists.ceph.io/hyperkitty/list/ceph-users@ceph.io/thread/GCOAUETNU6EWY6C7ZY4GA2YHFDC7NN6O/).
- Codex: [free.technology](https://free.technology/codex). Waku: [FAQ](https://docs.waku.org/learn/faq).
- Cloudflare: [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [R2 delete objects](https://developers.cloudflare.com/r2/objects/delete-objects/).
- Hetzner: [Object Storage docs](https://docs.hetzner.com/storage/object-storage/overview/), [product page](https://www.hetzner.com/storage/object-storage/), [Storage Box BX11](https://www.hetzner.com/storage/storage-box/bx11/), [price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/).
- Third-party pricing: [sliplane](https://sliplane.io/blog/cheap-object-storage-providers-europe), [agentdeals](https://agentdeals.dev/hetzner-pricing-2026).
