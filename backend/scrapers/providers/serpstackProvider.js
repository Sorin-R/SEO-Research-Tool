/**
 * Serpstack Provider
 * Uses Serpstack (https://serpstack.com) for Google Search results
 * Free tier: 100 requests/month
 */

const axios = require('axios');
const { throttle } = require('../../utils/rateLimiter');

const API_URL = 'http://api.serpstack.com/search';

/**
 * Search using Serpstack
 *
 * @param {string} keyword
 * @param {number} numResults
 * @returns {Promise<Array>} Formatted search results
 */
async function search(keyword, numResults = 10) {
  const apiKey = process.env.SERPSTACK_KEY;

  if (!apiKey) {
    throw new Error('SERPSTACK_KEY not set in .env');
  }

  await throttle();

  try {
    const response = await axios.get(API_URL, {
      params: {
        access_key: apiKey,
        query: keyword,
        limit: numResults,
      },
      timeout: 15000,
    });

    if (response.data.error) {
      throw new Error(response.data.error.info || 'Serpstack error');
    }

    // Parse Serpstack response format
    const results = (response.data.organic_results || [])
      .slice(0, numResults)
      .map((result, index) => ({
        position: index + 1,
        title: result.title,
        url: result.url,
        snippet: result.snippet || '',
      }));

    return results;
  } catch (err) {
    if (err.response?.status === 403) {
      throw new Error('Serpstack: Invalid API key');
    }
    throw err;
  }
}

module.exports = { search };
