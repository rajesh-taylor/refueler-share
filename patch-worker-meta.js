const fs = require('fs');
const path = '/Users/rajeshtaylor/Documents/refueler-share/worker/src/index.js';
let src = fs.readFileSync(path, 'utf8');

if (src.includes('handleMeta')) {
  console.log('Already patched — nothing to do');
  process.exit(0);
}

// ── 1. Add meta route in the router, before the download block ───────────────
const OLD_ROUTE = `      const downloadMatch = path.match(/^\\/download\\/([0-9a-f-]{36})\\/(\\d{4})$/i);`;
const NEW_ROUTE = `      const metaMatch = path.match(/^\\/meta\\/([0-9a-f-]{36})$/i);
      if (request.method === 'GET' && metaMatch) {
        return timed('meta', () => handleMeta(request, env, metaMatch[1]).then(r => addCors(r, request)));
      }

      const downloadMatch = path.match(/^\\/download\\/([0-9a-f-]{36})\\/(\\d{4})$/i);`;

if (!src.includes(OLD_ROUTE)) {
  console.error('ERROR: download route anchor not found — check router in index.js');
  process.exit(1);
}
src = src.replace(OLD_ROUTE, NEW_ROUTE);
console.log('✓ Added /meta route to router');

// ── 2. Add handleMeta function before the download handler ───────────────────
const OLD_FN = `// Download — GET /download/:uuid/:chunk`;
const META_FN = `// Meta — GET /meta/:uuid
// Public, no auth. Returns filename, size, expiry, passphrase flag from manifest.
async function handleMeta(request, env, uuid) {
  const { manifest } = await safeGetManifest(env, uuid);
  if (!manifest) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({
    file_name:            manifest.file_name        ?? null,
    total_bytes:          manifest.total_bytes       ?? null,
    expiry_timestamp:     manifest.expiry_timestamp  ?? null,
    passphrase_protected: !!manifest.p2sh_secret_hash,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// Download — GET /download/:uuid/:chunk`;

if (!src.includes(OLD_FN)) {
  console.error('ERROR: download handler anchor not found');
  process.exit(1);
}
src = src.replace(OLD_FN, META_FN);
console.log('✓ Added handleMeta function');

// ── 3. Expose /meta in CORS allow-origins (addCors handles it, nothing to do)
// But add meta to Access-Control-Expose-Headers on the download response too
// (already done in previous session — X-File-Name, X-Total-Bytes, X-Expiry-Timestamp)

fs.writeFileSync(path, src);
console.log('✓ Saved worker/src/index.js');
