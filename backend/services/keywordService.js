const db = require('../database');
const {
  getSuggestions,
  getExpandedSuggestions,
  categoriseSuggestions,
} = require('../scrapers/googleAutocomplete');
const { filterKeywordsWithAI, DEFAULT_AI_FILTER_PROMPT } = require('./aiKeywordFilterService');
const localStore = require('../utils/localStore');

/**
 * Research a keyword: gather autocomplete suggestions, PAA questions,
 * and optionally expand with alphabet technique.
 *
 * @param {string} keyword
 * @param {Object} [options]
 * @param {boolean} [options.expand] - Use alphabet expansion (slower, more results)
 * @returns {Promise<Object>}
 */
async function researchKeyword(keyword, options = {}) {
  const expansion = options.expand
    ? await getExpandedSuggestions(keyword, {
        targetCount: options.targetCount || 1000,
      })
    : null;
  const baseSuggestions = expansion
    ? categoriseSuggestions(keyword, expansion.suggestions)
    : await getSuggestions(keyword);

  let paaQuestions = [];
  try {
    const { getPeopleAlsoAsk } = require('../scrapers/peopleAlsoAsk');
    paaQuestions = await getPeopleAlsoAsk(keyword);
  } catch (err) {
    console.warn('[KeywordService] PAA fetch failed:', err.message);
  }

  // Merge PAA questions into the questions list
  const allQuestions = [
    ...baseSuggestions.questions,
    ...paaQuestions.filter((q) => !baseSuggestions.questions.includes(q)),
  ];
  const allSuggestions = expansion ? expansion.suggestions : baseSuggestions.all;

  return {
    keyword,
    related: baseSuggestions.related,
    longTail: baseSuggestions.longTail,
    questions: allQuestions,
    allSuggestions,
    expanded: allSuggestions,
    paaQuestions,
    totalSuggestions: allSuggestions.length,
    deepScan: !!options.expand,
    reachedTarget: expansion?.reachedTarget || false,
    requestCount: expansion?.requestCount || 1,
  };
}

// ---- Database operations for tracked keywords ----

/**
 * Save a keyword to the tracking list.
 */
async function saveKeyword(keyword, difficulty = null, searchVolume = null) {
  try {
    return await db.query(
      `INSERT INTO keywords (keyword, difficulty, search_volume)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         difficulty = COALESCE(?, difficulty),
         search_volume = COALESCE(?, search_volume),
         updated_at = CURRENT_TIMESTAMP`,
      [keyword, difficulty, searchVolume, difficulty, searchVolume]
    );
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for saveKeyword:', err.message);
    return localStore.saveKeyword(keyword, difficulty, searchVolume);
  }
}

/**
 * Get all tracked keywords.
 */
async function getTrackedKeywords() {
  try {
    return await db.query(
      'SELECT * FROM keywords ORDER BY created_at DESC'
    );
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for getTrackedKeywords:', err.message);
    return localStore.getTrackedKeywords();
  }
}

/**
 * Get a single tracked keyword by ID.
 */
async function getKeywordById(id) {
  try {
    const rows = await db.query('SELECT * FROM keywords WHERE id = ?', [id]);
    return rows[0] || null;
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for getKeywordById:', err.message);
    return localStore.getKeywordById(id);
  }
}

/**
 * Delete a tracked keyword.
 */
async function deleteKeyword(id) {
  try {
    return await db.query('DELETE FROM keywords WHERE id = ?', [id]);
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for deleteKeyword:', err.message);
    return localStore.deleteKeyword(id);
  }
}

module.exports = {
  DEFAULT_AI_FILTER_PROMPT,
  filterKeywordsWithAI,
  researchKeyword,
  saveKeyword,
  getTrackedKeywords,
  getKeywordById,
  deleteKeyword,
};
