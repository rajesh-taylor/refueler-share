module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/blake3");
  eleventyConfig.addWatchTarget("src/_includes/");
  // X5-1: src/app/ is the share.refueler.io build (eleventy.app.js → dist/), never this one.
  eleventyConfig.ignores.add("src/app/**");
  return {
    dir: {
      input:    "src",
      output:   "frontend",
      includes: "_includes",
      data:     "_data",
    },
    templateFormats: ["njk", "html"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
