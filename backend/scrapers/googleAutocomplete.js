const axios = require('axios');
const { getCountryConfig, normalizeCountryCode } = require('../utils/searchCountry');

const AUTOCOMPLETE_URL =
  'https://suggestqueries.google.com/complete/search';
const AUTOCOMPLETE_DELAY_MS = parseInt(process.env.AUTOCOMPLETE_DELAY_MS, 10) || 75;
const DEFAULT_TARGET_COUNT = 1000;
const DEFAULT_MAX_REQUESTS = 140;
const DEFAULT_FOLLOWUP_BUDGET = 60;
const questionWords = ['how', 'what', 'why', 'when', 'where', 'who', 'which', 'can', 'does', 'is', 'are', 'should'];

let lastAutocompleteRequestTime = 0;

async function throttleAutocomplete() {
  const now = Date.now();
  const elapsed = now - lastAutocompleteRequestTime;

  if (elapsed < AUTOCOMPLETE_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, AUTOCOMPLETE_DELAY_MS - elapsed));
  }

  lastAutocompleteRequestTime = Date.now();
}

function normaliseSuggestion(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function categoriseSuggestions(keyword, suggestions, paaQuestions = []) {
  const questions = [];
  const longTail = [];
  const related = [];
  const seen = new Set();

  for (const item of [...suggestions, ...paaQuestions]) {
    const suggestion = normaliseSuggestion(item);
    if (!suggestion) continue;

    const key = suggestion.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const lower = key;
    const wordCount = suggestion.split(/\s+/).length;

    if (questionWords.some((qw) => lower.startsWith(qw))) {
      questions.push(suggestion);
    } else if (wordCount >= 4) {
      longTail.push(suggestion);
    } else {
      related.push(suggestion);
    }
  }

  return {
    keyword,
    related,
    longTail,
    questions,
    all: [...related, ...longTail, ...questions],
  };
}

function parseListInput(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }

  return uniqueStrings(
    String(value || '')
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function buildSeedQueries(keyword, options = {}) {
  const suffixAlphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const suffixDigits = '0123456789'.split('');
  const suffixModifiers = [
    'for',
    'with',
    'without',
    'near me',
    'best',
    'tools',
    'tips',
    'services',
    'examples',
    'ideas',
    'template',
    'strategy',
    'course',
    'guide',
    'checklist',
    'vs',
    'pricing',
    'cost',
    'near me',
    'alternative',
    'alternatives',
    'comparison',
  ];
  const prefixModifiers = [
    'best',
    'top',
    'cheap',
    'free',
    'local',
    'how',
    'what is',
    'why',
    'when',
    'where',
    'who needs',
    'examples of',
    'benefits of',
    'types of',
    'alternatives to',
    'pricing for',
    'cost of',
    'compare',
    'vs',
    'case studies for',
  ];
  const localCities = parseListInput(options.localCities);
  const localServices = parseListInput(options.localServices);
  const localSeedCombos = [];
  const serviceSeed = localServices.length > 0 ? localServices : [keyword];

  for (const service of serviceSeed) {
    for (const city of localCities) {
      localSeedCombos.push(`${service} ${city}`);
      localSeedCombos.push(`${service} in ${city}`);
      localSeedCombos.push(`${service} near ${city}`);
      localSeedCombos.push(`best ${service} ${city}`);
    }
  }

  return uniqueStrings([
    keyword,
    ...suffixAlphabet.map((token) => `${keyword} ${token}`),
    ...suffixDigits.map((token) => `${keyword} ${token}`),
    ...suffixModifiers.map((token) => `${keyword} ${token}`),
    ...prefixModifiers.map((token) => `${token} ${keyword}`),
    ...localSeedCombos,
  ]);
}

function shouldScheduleFollowup(seedKeyword, suggestion) {
  const normalizedSeed = seedKeyword.toLowerCase();
  const normalizedSuggestion = suggestion.toLowerCase();
  const wordCount = suggestion.split(/\s+/).length;

  return (
    normalizedSuggestion.includes(normalizedSeed) &&
    wordCount >= 2 &&
    wordCount <= 6 &&
    suggestion.length <= 80
  );
}

function uniqueStrings(values) {
  const seen = new Set();
  const results = [];

  for (const value of values) {
    const normalized = normaliseSuggestion(value);
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(normalized);
  }

  return results;
}

async function fetchRawSuggestions(query, options = {}) {
  await throttleAutocomplete();
  const country = normalizeCountryCode(options.country);
  const countryConfig = getCountryConfig(country);

  const { data } = await axios.get(AUTOCOMPLETE_URL, {
    params: {
      client: 'firefox',
      q: query,
      gl: countryConfig.googleGl,
      hl: countryConfig.hl,
    },
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    timeout: 10000,
  });

  return uniqueStrings(Array.isArray(data[1]) ? data[1] : []);
}

/**
 * Fetch Google autocomplete suggestions for a keyword.
 * Uses the Firefox client parameter which returns clean JSON.
 *
 * @param {string} keyword - The seed keyword
 * @returns {Promise<Object>} { related, longTail, questions }
 */
async function getSuggestions(keyword, options = {}) {
  const suggestions = await fetchRawSuggestions(keyword, options);
  return categoriseSuggestions(keyword, suggestions);
}

/**
 * Expand suggestions by appending each letter a-z to the keyword.
 * Produces a broader set of autocomplete ideas.
 *
 * @param {string} keyword
 * @returns {Promise<string[]>} deduplicated suggestions
 */
async function getExpandedSuggestions(keyword, options = {}) {
  const targetCount = Math.max(100, options.targetCount || DEFAULT_TARGET_COUNT);
  const maxRequests = Math.max(1, options.maxRequests || DEFAULT_MAX_REQUESTS);
  const followupBudget = Math.max(0, options.followupBudget || DEFAULT_FOLLOWUP_BUDGET);
  const queue = buildSeedQueries(keyword, options);
  const seenQueries = new Set(queue.map((query) => query.toLowerCase()));
  const seenSuggestions = new Set();
  const results = [];
  let requestCount = 0;
  let followupsScheduled = 0;

  while (queue.length > 0 && requestCount < maxRequests && results.length < targetCount) {
    const query = queue.shift();

    try {
      requestCount += 1;
      const suggestions = await fetchRawSuggestions(query, options);

      for (const suggestion of suggestions) {
        const key = suggestion.toLowerCase();

        if (!seenSuggestions.has(key)) {
          seenSuggestions.add(key);
          results.push(suggestion);
        }

        if (
          followupsScheduled < followupBudget &&
          shouldScheduleFollowup(keyword, suggestion)
        ) {
          const queryKey = suggestion.toLowerCase();
          if (!seenQueries.has(queryKey)) {
            seenQueries.add(queryKey);
            queue.push(suggestion);
            followupsScheduled += 1;
          }
        }

        if (results.length >= targetCount) {
          break;
        }
      }
    } catch (err) {
      console.warn(`[Autocomplete] Failed for "${query}":`, err.message);
    }
  }

  return {
    suggestions: results.slice(0, targetCount),
    requestCount,
    targetCount,
    reachedTarget: results.length >= targetCount,
  };
}

module.exports = { getSuggestions, getExpandedSuggestions, categoriseSuggestions };
