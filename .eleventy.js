module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/blake3");
  eleventyConfig.addWatchTarget("src/_includes/");
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
