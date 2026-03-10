/**
 * Zenserp Provider
 * Uses Zenserp (https://zenserp.com) for Google Search results
 * Free tier: 100 requests/month
 */

const axios = require('axios');
const { throttle } = require('../../utils/rateLimiter');
const { getCountryConfig } = require('../../utils/searchCountry');

const API_URL = 'https://api.zenserp.com/v2/search';

/**
 * Search using Zenserp
 *
 * @param {string} keyword
 * @param {number} numResults
 * @returns {Promise<Array>} Formatted search results
 */
async function search(keyword, numResults = 10, options = {}) {
  const apiKey = process.env.ZENSERP_KEY;
  const country = getCountryConfig(options.country);

  if (!apiKey) {
    throw new Error('ZENSERP_KEY not set in .env');
  }

  await throttle();

  try {
    const response = await axios.get(API_URL, {
      params: {
        apikey: apiKey,
        q: keyword,
        num: numResults,
        gl: country.googleGl,
        hl: country.hl,
      },
      timeout: 15000,
    });

    if (response.data.error) {
      throw new Error(response.data.error);
    }

    // Parse Zenserp response format
    const results = (response.data.organic || [])
      .slice(0, numResults)
      .map((result, index) => ({
        position: index + 1,
        title: result.title,
        url: result.url,
        snippet: result.snippet || '',
      }));

    return results;
  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 403) {
      throw new Error('Zenserp: Invalid API key');
    }
    throw err;
  }
}

module.exports = { search };
