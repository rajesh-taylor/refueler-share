<!--
DRAFT · Refueler Notes · 14 Oct 2026 (X5-1a). Not for publishing yet.
Release: at the alpha (after X5-2), as part of tester onboarding (Rajesh, 14 Oct).
Before publishing (editor's notes, delete then):
1. X5-1b must have shipped: "What reaches us without asking" is checked against the
   error reports the page sends after X5-1b, line by line.
2. Add a second table for phone browsers: Safari on iPhone, Chrome on Android, Firefox on
   Android, and Vanadium on GrapheneOS (Rajesh: that group must be covered). Check each
   console route on the real devices (iPhone 13 mini, Pixel 9a).
3. Claims cover Share pages only (no analytics script there). refueler.io's own site
   analytics (page views on its homepage/Notes) is a separate, per-product decision.
4. Links: status page and app address change at X5-2 (share.refueler.io).
5. Suggested slug: /notes/when-a-transfer-doesnt-work/ · topics: Help, Privacy, File transfer.
-->

# When a transfer doesn't work

Share has no analytics script and no session recording, so when an upload or download goes wrong in your browser, we usually can't see it. This page explains what you can check yourself, and what to send us if you'd like help. You decide what to share.

## What reaches us without asking

Very little, by design.

- **Cloudflare**, which runs our servers, sees each request it carries, including your IP address, as any network host does. That's how the internet works, not an extra we added.
- **When a step fails**, the page sends us a short note: which step, the error code, and the first eight characters of the transfer's ID. Never the file, never its name, never the key in your link, never your password.

That's enough for us to notice that something is failing for many people at once. It isn't enough to tell us what went wrong for *you*. For that, we need your help.

## Check these first

Most failures come from one of these, roughly in this order.

1. **Is Share having a problem?** Look at the [status page](https://refueler.io/share/status/). If there's a notice, the fix is ours. Try again later.
2. **Content blockers.** Share needs two things a blocker might stop: Cloudflare's "are you a person" check (`challenges.cloudflare.com`) and our server (`api.share.refueler.io`). Allow both for this site, or try once with the blocker off.
3. **A VPN.** Some VPN exits fail Cloudflare's check. If the check never finishes, try another location or switch it off for one try.
4. **The tab went to sleep.** Large transfers run in your browser, so the tab has to stay open and the computer awake. If a laptop lid closed or a phone locked, go back to Share and choose the same file: an upload carries on where it stopped. A download starts again from the beginning, so open the link again.
5. **Private windows.** Some private modes limit what a page may store, which stops an upload resuming. A normal window works best for big files.
6. **Space on your device.** A download needs room for the whole file.
7. **Another browser.** If it fails in one browser, try another. That tells us whether the problem is the browser or the transfer, which halves the search.

## If it still fails

### What to write down

- what the page said, word for word (a screenshot is ideal)
- your browser and its version, and your device (for example "Safari 19 on a MacBook" or "Chrome on a Pixel 9a")
- roughly how big the file was
- roughly when it happened, and your time zone
- what you'd already tried from the list above

### The browser console (optional)

Your browser keeps a log of errors that the page never shows. On a computer you can open it:

| Browser | How to open the console |
|---|---|
| Safari | Settings → Advanced → tick *Show features for web developers*, then Develop → Show JavaScript Console |
| Chrome, Edge, Brave | ⌥ ⌘ J on a Mac, Ctrl Shift J on Windows or Linux |
| Firefox | ⌥ ⌘ K on a Mac, Ctrl Shift K on Windows or Linux |

Repeat the step that failed, then copy the lines shown in red. On a phone this is harder; a screenshot of the page is fine.

### What never to send us

**Don't send the whole Share link.** Everything after the `#` is the key to the file, and anyone holding it can open the file. The `#` part never reaches our servers, and we'd rather keep it that way.

If we need to find the transfer, the part *before* the `#` is enough (it looks like `…/?uuid=1a2b3c4d-…`). Sending it tells us which transfer was yours; sending nothing is also fine.

Before you paste console lines, look for a `#` followed by a long run of letters and numbers, and delete it. Never send the password either; we don't need it, and we couldn't use it.

## How to reach us

Email **support@refueler.io** with whatever you're happy to share from the lists above. A plain description is a good start.

## Why it works this way

Measuring every visitor would make problems easier for us to spot. It would also mean running someone else's code on the page that encrypts your files, and collecting details about people who never asked for help. We'd rather ask the few who need help, and let them decide what to tell us.
