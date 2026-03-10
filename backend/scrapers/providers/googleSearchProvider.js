/**
 * Google Custom Search Provider
 * Uses Google Custom Search API (https://programmablesearchengine.google.com)
 * Free tier: 100 searches/day
 */

const axios = require('axios');
const { throttle } = require('../../utils/rateLimiter');
const { getCountryConfig } = require('../../utils/searchCountry');

const API_URL = 'https://www.googleapis.com/customsearch/v1';

/**
 * Search using Google Custom Search API
 *
 * @param {string} keyword
 * @param {number} numResults
 * @returns {Promise<Array>} Formatted search results
 */
async function search(keyword, numResults = 10, options = {}) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  const country = getCountryConfig(options.country);

  if (!apiKey || !cx) {
    throw new Error('GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX not set in .env');
  }

  await throttle();

  try {
    const targetCount = Math.min(Math.max(Number.parseInt(numResults, 10) || 10, 1), 100);
    const pageSize = 10;
    const results = [];

    for (let start = 1; results.length < targetCount && start <= 91; start += pageSize) {
      const response = await axios.get(API_URL, {
        params: {
          q: keyword,
          key: apiKey,
          cx: cx,
          num: Math.min(pageSize, targetCount - results.length),
          start,
          gl: country.googleGl,
          cr: country.googleCr,
          hl: country.hl,
        },
        timeout: 15000,
      });

      if (response.data.error) {
        throw new Error(response.data.error.message || 'Google Search API error');
      }

      const items = response.data.items || [];

      if (items.length === 0) {
        break;
      }

      for (const item of items) {
        if (results.length >= targetCount) {
          break;
        }

        results.push({
          position: results.length + 1,
          title: item.title,
          url: item.link,
          snippet: item.snippet || '',
        });
      }

      if (items.length < pageSize) {
        break;
      }

      await throttle();
    }

    return results;
  } catch (err) {
    if (err.response?.status === 403) {
      throw new Error('Google Search: Daily quota exceeded or API not enabled');
    }
    if (err.response?.status === 400) {
      throw new Error('Google Search: Invalid API key or CX');
    }
    throw err;
  }
}

module.exports = { search };
