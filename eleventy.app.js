// eleventy.app.js — share.refueler.io standalone app (X5-1 · 14 Oct 2026).
// Builds src/app/*.njk → dist/ (gitignored). HTML + manifest only: the assets are
// copied into dist/v/<sha>/ by bin/ship-app.sh, which sets APP_SHA. Run:
//   APP_SHA=<shortsha> [APP_PREV=<shortsha>] npx eleventy --config=eleventy.app.js
// The old page's build (.eleventy.js → frontend/) is untouched.
module.exports = function (eleventyConfig) {
  const sha = process.env.APP_SHA || 'dev';
  if (!/^[0-9a-z]{3,40}$/.test(sha)) throw new Error(`eleventy.app.js: bad APP_SHA "${sha}"`);
  // Share-Release-1b: the release kept beside this one (ship-app.sh passes it), for /verify/'s
  // rebuild line. Empty → "none" (a --check / --ci build, or nothing was live).
  const prev = process.env.APP_PREV || '';
  if (prev && !/^[0-9a-f]{10}$/.test(prev)) throw new Error(`eleventy.app.js: bad APP_PREV "${prev}"`);
  eleventyConfig.addGlobalData('assetBase', `/v/${sha}`);
  eleventyConfig.addGlobalData('release', { sha, prev: prev || 'none' });
  return {
    dir: { input: 'src/app', output: 'dist', includes: '../_includes', data: '../_data' },
    templateFormats: ['njk'],
    htmlTemplateEngine: 'njk',
  };
};
