// The harness's /kat/ page (H2 Browser-KAT-1). Loads the real built modules from /v/<release>/,
// under the real CSP (serve-app.mjs), and runs test-vectors/run.mjs. Copied in by build.sh;
// never in dist/ and never released.
const report = (o) => {
  window.__kat = o;
  document.getElementById('out').textContent = JSON.stringify(o, null, 1);
};
try {
  const { rel } = await (await fetch('/kat/rel.json')).json();
  const v = await (await fetch('/kat/v1.json')).json();
  const base = `/v/${rel}`;
  const [crypto_, fragment, cashu, noble, merkle, { runVectors }] = await Promise.all([
    import(`${base}/crypto.js`), import(`${base}/fragment.js`), import(`${base}/cashu-crypto.js`),
    import(`${base}/noble-blake3.js`), import(`${base}/merkle.js`), import('/kat/run.mjs'),
  ]);
  const results = await runVectors(v, { crypto: crypto_, fragment, cashu, noble, merkle });
  report({ done: true, rel, schema: v.schema, blake3: crypto_.blake3Impl(), results });
} catch (e) {
  report({ done: true, fatal: `${e?.name}: ${e?.message}`, results: [] });
}
