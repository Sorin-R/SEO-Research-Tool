/**
 * Bing Search API Provider
 * Uses Bing Web Search API (https://www.microsoft.com/en-us/bing/apis/bing-web-search-api)
 * Free tier: 3 requests/second, ~1000/month
 */

const axios = require('axios');
const { throttle } = require('../../utils/rateLimiter');
const { getCountryConfig } = require('../../utils/searchCountry');

const API_URL = 'https://api.bing.microsoft.com/v7.0/search';

/**
 * Search using Bing Search API
 *
 * @param {string} keyword
 * @param {number} numResults
 * @returns {Promise<Array>} Formatted search results
 */
async function search(keyword, numResults = 10, options = {}) {
  const apiKey = options.credentials?.BING_SEARCH_KEY || process.env.BING_SEARCH_KEY;
  const country = getCountryConfig(options.country);

  if (!apiKey) {
    throw new Error('BING_SEARCH_KEY not set in .env');
  }

  await throttle();

  try {
    const response = await axios.get(API_URL, {
      params: {
        q: keyword,
        count: Math.min(numResults, 50),
        mkt: country.bingMarket,
      },
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
      },
      timeout: 15000,
    });

    // Parse Bing Search response format
    const results = (response.data.webPages?.value || [])
      .slice(0, numResults)
      .map((result, index) => ({
        position: index + 1,
        title: result.name,
        url: result.url,
        snippet: result.snippet || '',
      }));

    return results;
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error('Bing Search: Invalid API key');
    }
    if (err.response?.status === 429) {
      throw new Error('Bing Search: Rate limit exceeded');
    }
    throw err;
  }
}

module.exports = { search };
