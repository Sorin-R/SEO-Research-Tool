const { fetchSERPResults, scrapePageDetails } = require('../scrapers/googleSERP');

/**
 * Perform a full SERP analysis for a keyword.
 * Fetches top results and scrapes each page for SEO metrics.
 *
 * @param {string} keyword
 * @param {number} numResults
 * @returns {Promise<Object>} Full analysis with per-page data and averages
 */
async function analyzeSERP(keyword, numResults = 10) {
  // Step 1: Get SERP listings
  const serpResults = await fetchSERPResults(keyword, numResults);

  if (serpResults.length === 0) {
    return {
      keyword,
      results: [],
      averages: null,
      message: 'No SERP results found. Google may be blocking requests.',
    };
  }

  // Step 2: Scrape each result page for detailed metrics
  const detailedResults = [];

  for (const result of serpResults) {
    const details = await scrapePageDetails(result.url);
    detailedResults.push({
      ...result,
      ...details,
      keywordInTitle: result.title.toLowerCase().includes(keyword.toLowerCase()),
    });
  }

  // Step 3: Compute averages
  const validResults = detailedResults.filter((r) => !r.error);
  const averages = computeAverages(validResults, keyword);

  return {
    keyword,
    results: detailedResults,
    averages,
    totalResults: detailedResults.length,
    successfulScrapes: validResults.length,
  };
}

/**
 * Compute aggregate statistics from scraped SERP pages.
 */
function computeAverages(results, keyword) {
  if (results.length === 0) return null;

  const len = results.length;
  const sum = (arr, fn) => arr.reduce((acc, item) => acc + fn(item), 0);

  const avgWordCount = Math.round(sum(results, (r) => r.wordCount) / len);
  const avgTitleLength = Math.round(
    sum(results, (r) => (r.pageTitle || r.title || '').length) / len
  );
  const avgImages = Math.round(sum(results, (r) => r.imageCount) / len);
  const avgMetaDescLength = Math.round(
    sum(results, (r) => (r.metaDescription || '').length) / len
  );

  const keywordLower = keyword.toLowerCase();
  const keywordInTitleCount = results.filter((r) =>
    (r.pageTitle || r.title || '').toLowerCase().includes(keywordLower)
  ).length;
  const keywordInTitleRatio = keywordInTitleCount / len;

  const keywordInMetaCount = results.filter((r) =>
    (r.metaDescription || '').toLowerCase().includes(keywordLower)
  ).length;
  const keywordInMetaRatio = keywordInMetaCount / len;

  return {
    avgWordCount,
    avgTitleLength,
    avgImages,
    avgMetaDescLength,
    keywordInTitleRatio: Math.round(keywordInTitleRatio * 100),
    keywordInMetaRatio: Math.round(keywordInMetaRatio * 100),
    totalResults: len,
  };
}

module.exports = { analyzeSERP, computeAverages };
