const axios = require('axios');
const { throttle } = require('../utils/rateLimiter');

const AUTOCOMPLETE_URL =
  'https://suggestqueries.google.com/complete/search';

/**
 * Fetch Google autocomplete suggestions for a keyword.
 * Uses the Firefox client parameter which returns clean JSON.
 *
 * @param {string} keyword - The seed keyword
 * @returns {Promise<Object>} { related, longTail, questions }
 */
async function getSuggestions(keyword) {
  await throttle();

  const { data } = await axios.get(AUTOCOMPLETE_URL, {
    params: { client: 'firefox', q: keyword },
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    timeout: 10000,
  });

  // Response format: [query, [suggestions]]
  const suggestions = Array.isArray(data[1]) ? data[1] : [];

  // Categorise suggestions
  const questionWords = ['how', 'what', 'why', 'when', 'where', 'who', 'which', 'can', 'does', 'is', 'are'];
  const questions = [];
  const longTail = [];
  const related = [];

  for (const s of suggestions) {
    const lower = s.toLowerCase();
    const wordCount = s.split(/\s+/).length;

    if (questionWords.some((qw) => lower.startsWith(qw))) {
      questions.push(s);
    } else if (wordCount >= 4) {
      longTail.push(s);
    } else {
      related.push(s);
    }
  }

  return { keyword, related, longTail, questions, all: suggestions };
}

/**
 * Expand suggestions by appending each letter a-z to the keyword.
 * Produces a broader set of autocomplete ideas.
 *
 * @param {string} keyword
 * @returns {Promise<string[]>} deduplicated suggestions
 */
async function getExpandedSuggestions(keyword) {
  const seen = new Set();
  const results = [];

  // Base query
  const base = await getSuggestions(keyword);
  for (const s of base.all) {
    if (!seen.has(s)) {
      seen.add(s);
      results.push(s);
    }
  }

  // Alphabet expansion
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
  for (const letter of alphabet) {
    try {
      const expanded = await getSuggestions(`${keyword} ${letter}`);
      for (const s of expanded.all) {
        if (!seen.has(s)) {
          seen.add(s);
          results.push(s);
        }
      }
    } catch (err) {
      console.warn(`[Autocomplete] Failed for "${keyword} ${letter}":`, err.message);
    }
  }

  return results;
}

module.exports = { getSuggestions, getExpandedSuggestions };
