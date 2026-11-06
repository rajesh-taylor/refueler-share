// eleventy.gate.js — the gate page on gate.share.refueler.io (Turnstile-Gate-1 · 6 Nov 2026).
// Builds src/gate/*.njk → dist-gate/ (gitignored). HTML + robots.txt only: gate.js and gate.css
// are copied into dist-gate/v/<sha>/ by bin/ship-app.sh (AG_FILES), which sets APP_SHA, in the
// same build (and the same twice-build comparison) as the app. Run:
//   APP_SHA=<shortsha> npx eleventy --config=eleventy.gate.js
module.exports = function (eleventyConfig) {
  const sha = process.env.APP_SHA || 'dev';
  if (!/^[0-9a-z]{3,40}$/.test(sha)) throw new Error(`eleventy.gate.js: bad APP_SHA "${sha}"`);
  eleventyConfig.addGlobalData('assetBase', `/v/${sha}`);
  return {
    dir: { input: 'src/gate', output: 'dist-gate', includes: '../_includes', data: '../_data' },
    templateFormats: ['njk'],
    htmlTemplateEngine: 'njk',
  };
};
