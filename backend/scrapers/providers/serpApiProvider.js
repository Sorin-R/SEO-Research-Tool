/**
 * SerpAPI Provider
 * Uses SerpAPI (https://serpapi.com) for Google Search results
 * Free tier: 100 searches/month
 */

const axios = require('axios');
const { throttle } = require('../../utils/rateLimiter');
const { getCountryConfig } = require('../../utils/searchCountry');

const API_URL = 'https://serpapi.com/search';

/**
 * Search using SerpAPI
 *
 * @param {string} keyword
 * @param {number} numResults
 * @returns {Promise<Array>} Formatted search results
 */
async function search(keyword, numResults = 10, options = {}) {
  const apiKey = options.credentials?.SERPAPI_KEY || process.env.SERPAPI_KEY;
  const country = getCountryConfig(options.country);

  if (!apiKey) {
    throw new Error('SERPAPI_KEY not set in .env');
  }

  await throttle();

  try {
    const response = await axios.get(API_URL, {
      params: {
        q: keyword,
        api_key: apiKey,
        num: Math.min(numResults, 10),
        engine: 'google',
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
      .slice(0, numResults)
      .map((result) => ({
        position: result.position,
        title: result.title,
        url: result.link,
        snippet: result.snippet || '',
      }));

    return results;
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error('Invalid SerpAPI key');
    }
    if (err.response?.status === 402) {
      throw new Error('SerpAPI: No credits remaining (free tier limit reached)');
    }
    throw err;
  }
}

module.exports = { search };
