/**
 * SerpAPI Provider
 * Uses SerpAPI (https://serpapi.com) for Google Search results
 * Free tier: 100 searches/month
 */

const axios = require('axios');
const { throttle } = require('../../utils/rateLimiter');
const { getCountryConfig } = require('../../utils/searchCountry');

const API_URL = 'https://api.serpapi.com/search';

/**
 * Search using SerpAPI
 *
 * @param {string} keyword
 * @param {number} numResults
 * @returns {Promise<Array>} Formatted search results
 */
async function search(keyword, numResults = 10, options = {}) {
  const apiKey = process.env.SERPAPI_KEY;
  const country = getCountryConfig(options.country);

  if (!apiKey) {
    throw new Error('SERPAPI_KEY not set in .env');
  }

  await throttle();

  try {
    const targetCount = Math.min(Math.max(Number.parseInt(numResults, 10) || 10, 1), 100);
    const pageSize = 10;
    const results = [];

    for (let start = 0; results.length < targetCount; start += pageSize) {
      const response = await axios.get(API_URL, {
        params: {
          q: keyword,
          api_key: apiKey,
          num: Math.min(pageSize, targetCount - results.length),
          start,
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

      const organicResults = response.data.organic_results || [];

      if (organicResults.length === 0) {
        break;
      }

      for (const result of organicResults) {
        if (results.length >= targetCount) {
          break;
        }

        results.push({
          position: result.position || (results.length + 1),
          title: result.title,
          url: result.link,
          snippet: result.snippet || '',
        });
      }

      if (organicResults.length < pageSize) {
        break;
      }

      await throttle();
    }

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
