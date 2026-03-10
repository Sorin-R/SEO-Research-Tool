/**
 * SearchAPI Provider
 * Uses SearchAPI (https://www.searchapi.io) for search results
 * Free tier: 100 requests/month
 */

const axios = require('axios');
const { throttle } = require('../../utils/rateLimiter');
const { getCountryConfig } = require('../../utils/searchCountry');

const API_URL = 'https://www.searchapi.io/api/v1/search';

/**
 * Search using SearchAPI
 *
 * @param {string} keyword
 * @param {number} numResults
 * @returns {Promise<Array>} Formatted search results
 */
async function search(keyword, numResults = 10, options = {}) {
  const apiKey = process.env.SEARCHAPI_KEY;
  const country = getCountryConfig(options.country);

  if (!apiKey) {
    throw new Error('SEARCHAPI_KEY not set in .env');
  }

  await throttle();

  try {
    const targetCount = Math.min(Math.max(Number.parseInt(numResults, 10) || 10, 1), 100);
    const response = await axios.get(API_URL, {
      params: {
        api_key: apiKey,
        q: keyword,
        num: targetCount > 10 ? targetCount : 10,
        engine: targetCount > 10 ? 'google_rank_tracking' : 'google',
        gl: country.googleGl,
        hl: country.hl,
        google_domain: country.googleDomain,
      },
      timeout: 15000,
    });

    if (response.data.error) {
      throw new Error(response.data.error);
    }

    const results = (response.data.organic_results || [])
      .slice(0, targetCount)
      .map((result, index) => ({
        position: result.position || (index + 1),
        title: result.title,
        url: result.link,
        snippet: result.snippet || '',
      }));

    return results;
  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 403) {
      throw new Error('SearchAPI: Invalid API key');
    }
    throw err;
  }
}

module.exports = { search };
