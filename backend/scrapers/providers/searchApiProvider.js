/**
 * SearchAPI Provider
 * Uses SearchAPI (https://www.searchapi.io) for search results
 * Free tier: 100 requests/month
 */

const axios = require('axios');
const { throttle } = require('../../utils/rateLimiter');

const API_URL = 'https://www.searchapi.io/api/v1/search';

/**
 * Search using SearchAPI
 *
 * @param {string} keyword
 * @param {number} numResults
 * @returns {Promise<Array>} Formatted search results
 */
async function search(keyword, numResults = 10) {
  const apiKey = process.env.SEARCHAPI_KEY;

  if (!apiKey) {
    throw new Error('SEARCHAPI_KEY not set in .env');
  }

  await throttle();

  try {
    const response = await axios.get(API_URL, {
      params: {
        api_key: apiKey,
        q: keyword,
        num: numResults,
        engine: 'google',
      },
      timeout: 15000,
    });

    if (response.data.error) {
      throw new Error(response.data.error);
    }

    // Parse SearchAPI response format
    const results = (response.data.organic_results || [])
      .slice(0, numResults)
      .map((result, index) => ({
        position: index + 1,
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
