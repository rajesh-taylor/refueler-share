# dev/dl-spike — Share-DL-Spike scratch page

Service-worker streaming download test (spec `docs/Share-Download-spec-v1.md` §12). Never mirrored or shipped. The page decrypts with the browser's own `frontend/crypto.js`, served as-is.

**Mac browsers**

```bash
node /Users/rajeshtaylor/Documents/refueler-share/dev/dl-spike/serve.mjs
```

Open http://localhost:8787 → Choose File → `~/.refueler-soak/<uuid>.link` (⌘⇧G in the picker) → Download via service worker (Safari, Firefox) or Save via FSAA (Chrome).

**Phones** (relay on :8788 + a quick tunnel; URLs expire when idle, so restart for a new one)

```bash
node /Users/rajeshtaylor/Documents/refueler-share/dev/dl-spike/serve.mjs --relay
```

```bash
/opt/homebrew/Cellar/cloudflared/2026.9.3/bin/cloudflared tunnel --protocol http2 --no-autoupdate --url http://127.0.0.1:8788
```

AirDrop (or copy) the `.link` file to the phone — not by email. Data flows through the Mac's upload, so phone speeds are lower than a direct download.

Results log: `~/.refueler-soak/dl-spike.log` (no key or link). Memory: `memwatch.sh "<target dir>" >> ~/.refueler-soak/dl-spike-mem.log`.
