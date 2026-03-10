const db = require('../database');
const { getSuggestions, getExpandedSuggestions } = require('../scrapers/googleAutocomplete');
const { getPeopleAlsoAsk } = require('../scrapers/peopleAlsoAsk');

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
  const suggestions = await getSuggestions(keyword);

  let paaQuestions = [];
  try {
    paaQuestions = await getPeopleAlsoAsk(keyword);
  } catch (err) {
    console.warn('[KeywordService] PAA fetch failed:', err.message);
  }

  // Merge PAA questions into the questions list
  const allQuestions = [
    ...suggestions.questions,
    ...paaQuestions.filter((q) => !suggestions.questions.includes(q)),
  ];

  let expandedSuggestions = [];
  if (options.expand) {
    expandedSuggestions = await getExpandedSuggestions(keyword);
  }

  return {
    keyword,
    related: suggestions.related,
    longTail: suggestions.longTail,
    questions: allQuestions,
    allSuggestions: suggestions.all,
    expanded: expandedSuggestions,
    paaQuestions,
  };
}

// ---- Database operations for tracked keywords ----

/**
 * Save a keyword to the tracking list.
 */
async function saveKeyword(keyword, difficulty = null, searchVolume = null) {
  const result = await db.query(
    `INSERT INTO keywords (keyword, difficulty, search_volume)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       difficulty = COALESCE(?, difficulty),
       search_volume = COALESCE(?, search_volume),
       updated_at = CURRENT_TIMESTAMP`,
    [keyword, difficulty, searchVolume, difficulty, searchVolume]
  );
  return result;
}

/**
 * Get all tracked keywords.
 */
async function getTrackedKeywords() {
  return db.query(
    'SELECT * FROM keywords ORDER BY created_at DESC'
  );
}

/**
 * Get a single tracked keyword by ID.
 */
async function getKeywordById(id) {
  const rows = await db.query('SELECT * FROM keywords WHERE id = ?', [id]);
  return rows[0] || null;
}

/**
 * Delete a tracked keyword.
 */
async function deleteKeyword(id) {
  return db.query('DELETE FROM keywords WHERE id = ?', [id]);
}

module.exports = {
  researchKeyword,
  saveKeyword,
  getTrackedKeywords,
  getKeywordById,
  deleteKeyword,
};
