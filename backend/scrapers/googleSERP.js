const axios = require('axios');
const cheerio = require('cheerio');
const { throttle } = require('../utils/rateLimiter');
const { countWords } = require('../utils/helpers');
const serpApiManager = require('./serpApiManager');

/**
 * Fetch top Google search results for a keyword.
 * Uses multi-provider SERP API system with automatic fallback.
 *
 * @param {string} keyword
 * @param {number} numResults - Number of results to fetch (max 10)
 * @returns {Promise<Array>} Array of { position, title, url, snippet }
 */
async function fetchSERPResults(keyword, numResults = 10, options = {}) {
  try {
    // Use multi-provider SERP API manager
    return await serpApiManager.search(keyword, numResults, options);
  } catch (err) {
    console.error('[SERP] Error:', err.message);
    throw new Error(
      `SERP search failed: ${err.message}. ` +
      'Make sure you have configured at least one SERP API provider in .env'
    );
  }
}

/**
 * Scrape detailed page data (meta description, H1s, word count, image count)
 * for a given URL using Axios + Cheerio.
 *
 * @param {string} url
 * @returns {Promise<Object>}
 */
async function scrapePageDetails(url) {
  await throttle();

  try {
    console.log(`[SERP] Scraping details from: ${url}`);

    const { data: html } = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 15000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(html);

    // Meta description
    const metaDescription =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      '';

    // H1 headings
    const h1s = [];
    $('h1').each((_, el) => {
      const text = $(el).text().trim();
      if (text) h1s.push(text);
    });

    // All headings structure
    const headings = { h1: [], h2: [], h3: [] };
    ['h1', 'h2', 'h3'].forEach((tag) => {
      $(tag).each((_, el) => {
        const text = $(el).text().trim();
        if (text) headings[tag].push(text);
      });
    });

    // Body text word count (strip scripts, styles, nav, footer)
    $('script, style, nav, footer, header, aside, [role="complementary"]').remove();
    const bodyText = $('body').text();
    const wordCount = countWords(bodyText);

    // Image count
    const imageCount = $('img').length;

    // Title tag
    const pageTitle = $('title').text().trim();

    return {
      url,
      pageTitle,
      metaDescription: metaDescription.trim(),
      h1s,
      headings,
      wordCount,
      imageCount,
    };
  } catch (err) {
    console.warn(`[SERP] Failed to scrape ${url}: ${err.message}`);
    return {
      url,
      pageTitle: '',
      metaDescription: '',
      h1s: [],
      headings: { h1: [], h2: [], h3: [] },
      wordCount: 0,
      imageCount: 0,
      error: err.message,
    };
  }
}

module.exports = { fetchSERPResults, scrapePageDetails };
