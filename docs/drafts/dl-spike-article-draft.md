# Draft — Notes article (informational): a 100 GiB encrypted download in Safari

> Draft 1 · Share-DL-Spike · 10 Oct 2026. Target: refueler.io/notes/, about a week after 10 Oct. Before posting: re-check the "today" paragraph against what is live (DL-1 may have shipped), add the Pixel / screen-lock results if run, and link the spike code once `dev/dl-spike/` is pushed. Voice: CLAUDE.md "Editorial voice".

---

## A 100 GiB encrypted download in Safari, measured

This note records one test. We wanted to know whether Safari can save a very large file that is decrypted inside the browser without holding the file in memory. Nobody we could find had published a result above 1.41 GB, and that one was on an iPhone.

**How it works.** Refueler Share encrypts files in the sender's browser in 32 MiB parts. The recipient's browser has to fetch each part, check it, decrypt it and write it to disk. Chrome and Edge can write straight to a file the user picks. Safari and Firefox can't, so the usual fallback is to build the whole file in memory and save it at the end. At 100 GiB that fails.

The alternative is a service worker: a small script the browser runs beside the page. Ours fetches the encrypted parts, decrypts them with the same code the page uses, and hands the plaintext to the browser as an ordinary download with its exact size. The browser's own download manager writes it to disk, shows progress and time left, and asks where to save it.

**What we ran.** One 100 GiB file, generated so its SHA-256 was known before upload. One Mac (macOS 26.6.2), a USB SSD, a home connection with a VPN on. Then 5 GiB in Firefox, Chrome and on an iPhone.

| Browser | Size | Time | Speed | Result |
|---|---|---|---|---|
| Safari 26.6.2, macOS | 100 GiB | 1 h 37 m 55 s | 17.4 MiB/s | SHA-256 matches; browser memory stayed between 0.5 and 1.3 GiB after the first few minutes |
| Firefox 157, macOS | 5 GiB | 5 m 58 s | 14.3 MiB/s | SHA-256 matches; also survived a deliberate 3-minute pause |
| Safari, iPhone 13 mini | 5 GiB | 28 m 43 s | 3.0 MiB/s* | SHA-256 matches |
| Chrome 154 (save-file picker, not a service worker) | 5 GiB | 5 m 06 s | 16.7 MiB/s | SHA-256 matches; the final save step took 17 s |

\* The iPhone test was relayed through the Mac's home upload, which set the speed.

Every part also passed the server's check that the stored encrypted part is the one the sender uploaded. That check is about storage. The recipient's own check is the decryption, which fails if a part was changed, swapped or dropped, and the SHA-256 above.

**What we didn't test.** One run per browser, one Mac, one iPhone. No Android yet: a Pixel on GrapheneOS is next. No 100 GiB run in Firefox or Chrome. We haven't yet locked an iPhone mid-download to see what happens.

**What it changes.** Today the live Share page still uses the in-memory fallback in Safari and Firefox, which limits how large a download those browsers can handle. The service-worker download replaces it in the next download update, and this test is why we're confident it will work. The test code is public under Apache 2.0, so you can run it yourself.

Two details for anyone building the same thing:
- Firefox showed the size and asked whether to open or save, but saved to its default folder even with "Always ask where to save files" switched on.
- On an exFAT drive, Chrome creates an empty file under the final name as soon as the download starts. Don't mistake it for a failed download.
