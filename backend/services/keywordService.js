const db = require('../database');
const {
  getSuggestions,
  getExpandedSuggestions,
  categoriseSuggestions,
} = require('../scrapers/googleAutocomplete');
const { filterKeywordsWithAI, DEFAULT_AI_FILTER_PROMPT } = require('./aiKeywordFilterService');
const localStore = require('../utils/localStore');

const MAX_RESEARCH_HISTORY_ENTRIES = 12;

function clampLimit(limit, min, max) {
  return Math.min(Math.max(Number.parseInt(limit, 10) || min, min), max);
}

function parseStoredResult(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function persistResearchHistory(result) {
  const keyword = result.keyword?.trim();

  if (!keyword) {
    return null;
  }

  const payload = {
    ...result,
    keyword,
  };

  try {
    const existing = await db.query(
      `SELECT id
       FROM keyword_research_history
       WHERE LOWER(keyword) = LOWER(?)
       ORDER BY updated_at DESC
       LIMIT 1`,
      [keyword]
    );

    let historyId;

    if (existing.length > 0) {
      historyId = existing[0].id;

      await db.query(
        `UPDATE keyword_research_history
         SET keyword = ?, result = ?, total_suggestions = ?, deep_scan = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          keyword,
          JSON.stringify(payload),
          payload.totalSuggestions || payload.allSuggestions?.length || 0,
          payload.deepScan ? 1 : 0,
          historyId,
        ]
      );

      await db.query(
        `DELETE FROM keyword_research_history
         WHERE LOWER(keyword) = LOWER(?) AND id <> ?`,
        [keyword, historyId]
      );
    } else {
      const insertResult = await db.query(
        `INSERT INTO keyword_research_history (keyword, result, total_suggestions, deep_scan)
         VALUES (?, ?, ?, ?)`,
        [
          keyword,
          JSON.stringify(payload),
          payload.totalSuggestions || payload.allSuggestions?.length || 0,
          payload.deepScan ? 1 : 0,
        ]
      );
      historyId = insertResult.insertId;
    }

    await db.query(
      `DELETE FROM keyword_research_history
       WHERE id NOT IN (
         SELECT id FROM (
           SELECT id
           FROM keyword_research_history
           ORDER BY updated_at DESC
           LIMIT ${MAX_RESEARCH_HISTORY_ENTRIES}
         ) AS recent_history
       )`
    );

    return historyId;
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for saveKeywordResearchHistory:', err.message);
    return localStore.saveKeywordResearchHistory(payload, MAX_RESEARCH_HISTORY_ENTRIES);
  }
}

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

  const result = {
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

  try {
    const historyId = await persistResearchHistory(result);
    if (historyId) {
      result.historyId = historyId;
    }
  } catch (err) {
    console.warn('[KeywordService] Failed to persist research history:', err.message);
  }

  return result;
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

async function getKeywordResearchHistory(limit = 10) {
  const safeLimit = clampLimit(limit, 1, MAX_RESEARCH_HISTORY_ENTRIES);

  try {
    return await db.query(
      `SELECT id, keyword, total_suggestions, deep_scan, created_at, updated_at
       FROM keyword_research_history
       ORDER BY updated_at DESC
       LIMIT ${safeLimit}`
    );
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for getKeywordResearchHistory:', err.message);
    return localStore.getKeywordResearchHistory(safeLimit);
  }
}

async function getKeywordResearchHistoryItem(id) {
  try {
    const rows = await db.query(
      `SELECT id, result, updated_at
       FROM keyword_research_history
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    const row = rows[0];

    if (!row) {
      return null;
    }

    const parsedResult = parseStoredResult(row.result);

    return parsedResult
      ? {
          ...parsedResult,
          historyId: row.id,
          savedAt: row.updated_at,
        }
      : null;
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for getKeywordResearchHistoryItem:', err.message);
    return localStore.getKeywordResearchHistoryItem(id);
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
  getKeywordResearchHistory,
  getKeywordResearchHistoryItem,
};
