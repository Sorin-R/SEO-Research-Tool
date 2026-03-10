const db = require('../database');
const { analyzeSERP } = require('../analyzers/serpAnalyzer');
const { calculateDifficulty } = require('../analyzers/keywordDifficulty');
const localStore = require('../utils/localStore');
const { getCountryConfig, normalizeCountryCode } = require('../utils/searchCountry');

/**
 * SERP cache duration in milliseconds (6 hours).
 * Avoids redundant scraping for recent queries.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SERP_HISTORY_ENTRIES = 12;

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

async function persistSERPAnalysisHistory(result) {
  const keyword = result.keyword?.trim();
  const country = normalizeCountryCode(result.country);

  if (!keyword) {
    return null;
  }

  const payload = {
    ...result,
    keyword,
    country,
  };

  try {
    const existing = await db.query(
      `SELECT id
       FROM serp_analysis_history
       WHERE LOWER(keyword) = LOWER(?) AND country = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [keyword, country]
    );

    let historyId;

    if (existing.length > 0) {
      historyId = existing[0].id;

      await db.query(
        `UPDATE serp_analysis_history
         SET keyword = ?, country = ?, result = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [keyword, country, JSON.stringify(payload), historyId]
      );
    } else {
      const insertResult = await db.query(
        `INSERT INTO serp_analysis_history (keyword, country, result)
         VALUES (?, ?, ?)`,
        [keyword, country, JSON.stringify(payload)]
      );
      historyId = insertResult.insertId;
    }

    await db.query(
      `DELETE FROM serp_analysis_history
       WHERE id NOT IN (
         SELECT id FROM (
           SELECT id
           FROM serp_analysis_history
           ORDER BY updated_at DESC
           LIMIT ${MAX_SERP_HISTORY_ENTRIES}
         ) AS recent_serp_history
       )`
    );

    return historyId;
  } catch (err) {
    console.warn('[SERPService] DB unavailable, using local store for persistSERPAnalysisHistory:', err.message);
    return localStore.saveSerpAnalysisHistory(payload, MAX_SERP_HISTORY_ENTRIES);
  }
}

/**
 * Get SERP analysis for a keyword, using cache when available.
 *
 * @param {string} keyword
 * @param {Object} [options]
 * @param {boolean} [options.forceRefresh] - Bypass cache
 * @returns {Promise<Object>}
 */
async function getSERPAnalysis(keyword, options = {}) {
  const country = normalizeCountryCode(options.country);
  const countryConfig = getCountryConfig(country);
  const cacheKey = buildCacheKey(keyword, country);
  let result;

  // Check cache first (unless forced refresh)
  if (!options.forceRefresh) {
    const cached = await getCachedSERP(cacheKey);
    if (cached) {
      result = {
        ...cached,
        country,
        countryName: countryConfig.name,
        fromCache: true,
      };
    }
  }

  if (!result) {
    // Perform fresh analysis
    const analysis = await analyzeSERP(keyword, 10, { country });

    // Calculate difficulty
    const difficulty = calculateDifficulty(analysis);

    result = {
      ...analysis,
      country,
      countryName: countryConfig.name,
      difficulty,
      fromCache: false,
    };

    // Cache the results
    await cacheSERPResults(cacheKey, result);
  }

  try {
    const historyId = await persistSERPAnalysisHistory(result);
    if (historyId) {
      result.historyId = historyId;
    }
  } catch (err) {
    console.warn('[SERPService] Failed to persist SERP analysis history:', err.message);
  }

  return result;
}

/**
 * Check the DB cache for recent SERP results.
 */
async function getCachedSERP(keyword) {
  let rows;

  try {
    rows = await db.query(
      `SELECT results, fetched_at FROM serp_cache
       WHERE keyword = ?
       ORDER BY fetched_at DESC
       LIMIT 1`,
      [keyword]
    );
  } catch (err) {
    console.warn('[SERPService] DB unavailable, using local store for getCachedSERP:', err.message);
    return localStore.getCachedSERP(keyword, CACHE_TTL_MS);
  }

  if (rows.length === 0) return null;

  const row = rows[0];
  const age = Date.now() - new Date(row.fetched_at).getTime();

  if (age > CACHE_TTL_MS) return null;

  try {
    return JSON.parse(row.results);
  } catch {
    return null;
  }
}

/**
 * Store SERP results in the cache table.
 */
async function cacheSERPResults(keyword, results) {
  try {
    await db.query(
      'INSERT INTO serp_cache (keyword, results) VALUES (?, ?)',
      [keyword, JSON.stringify(results)]
    );
  } catch (err) {
    console.warn('[SERPService] DB unavailable, using local store for cacheSERPResults:', err.message);
    await localStore.saveSerpCache(keyword, results);
  }
}

function findResultForDomain(results, targetDomain) {
  const domainLower = String(targetDomain || '').toLowerCase();

  return results.find((result) => {
    try {
      const hostname = new URL(result.url).hostname.replace(/^www\./, '').toLowerCase();
      return hostname.includes(domainLower);
    } catch {
      return false;
    }
  });
}

async function persistRankingRecord({ keywordId, websiteId = null, url, position, title, date }) {
  try {
    await db.query(
      `INSERT INTO rankings (website_id, keyword_id, url, position, title, date)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         position = ?, url = ?, title = ?`,
      [websiteId, keywordId, url, position, title, date, position, url, title]
    );
  } catch (err) {
    console.warn('[SERPService] DB unavailable, using local store for persistRankingRecord:', err.message);
    await localStore.saveRanking({ keywordId, websiteId, url, position, title, date });
  }
}

async function trackRankingFromResults(keywordId, keyword, targetDomain, websiteId = null, results = [], date = null) {
  const match = findResultForDomain(results, targetDomain);
  const position = match ? match.position : null;
  const url = match ? match.url : null;
  const title = match ? match.title : null;
  const rankingDate = date || new Date().toISOString().split('T')[0];

  await persistRankingRecord({
    keywordId,
    websiteId,
    url,
    position,
    title,
    date: rankingDate,
  });

  return {
    keywordId,
    websiteId,
    keyword,
    position,
    url,
    title,
    date: rankingDate,
  };
}

async function getTrackedKeywordByText(keyword) {
  try {
    const rows = await db.query(
      `SELECT *
       FROM keywords
       WHERE LOWER(keyword) = LOWER(?)
       LIMIT 1`,
      [keyword]
    );

    return rows[0] || null;
  } catch (err) {
    console.warn('[SERPService] DB unavailable, using local store for getTrackedKeywordByText:', err.message);
    const keywords = await localStore.getTrackedKeywords();
    return keywords.find((item) => String(item.keyword).toLowerCase() === String(keyword).toLowerCase()) || null;
  }
}

async function getActiveTrackedWebsites() {
  try {
    return await db.query(
      'SELECT * FROM websites WHERE is_active = 1 ORDER BY updated_at DESC, created_at DESC'
    );
  } catch (err) {
    console.warn('[SERPService] DB unavailable, using local store for getActiveTrackedWebsites:', err.message);
    return localStore.getActiveWebsites();
  }
}

// ---- Rank tracking ----

/**
 * Record the current ranking position for a tracked keyword.
 *
 * @param {number} keywordId - ID from keywords table
 * @param {string} keyword - The keyword text
 * @param {string} targetDomain - The user's domain to track position for
 * @returns {Promise<Object>} Ranking record
 */
async function trackRanking(keywordId, keyword, targetDomain, websiteId = null) {
  const analysis = await analyzeSERP(keyword, 10);
  return trackRankingFromResults(keywordId, keyword, targetDomain, websiteId, analysis.results);
}

/**
 * Get ranking history for a keyword.
 */
async function getRankingHistory(keywordId, days = 30, websiteId = null) {
  try {
    const params = [keywordId, days];
    let sql = `SELECT r.*, k.keyword, w.name AS website_name, w.domain AS website_domain
       FROM rankings r
       INNER JOIN keywords k ON k.id = r.keyword_id
       LEFT JOIN websites w ON w.id = r.website_id
       WHERE keyword_id = ?
         AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    `;

    if (websiteId != null) {
      sql += ' AND r.website_id = ?';
      params.push(websiteId);
    }

    sql += ' ORDER BY date ASC';

    return await db.query(sql, params);
  } catch (err) {
    console.warn('[SERPService] DB unavailable, using local store for getRankingHistory:', err.message);
    return localStore.getRankingHistory(keywordId, days, websiteId);
  }
}

/**
 * Get the latest ranking for all tracked keywords.
 */
async function getLatestRankings(websiteId = null) {
  try {
    const params = [];
    let sql = `SELECT r.*, k.keyword, w.name AS website_name, w.domain AS website_domain
       FROM rankings r
       INNER JOIN keywords k ON k.id = r.keyword_id
       LEFT JOIN websites w ON w.id = r.website_id
       WHERE r.date = (
         SELECT MAX(r2.date) FROM rankings r2 WHERE r2.keyword_id = r.keyword_id
           AND COALESCE(r2.website_id, 0) = COALESCE(r.website_id, 0)
       )
    `;

    if (websiteId != null) {
      sql += ' AND r.website_id = ?';
      params.push(websiteId);
    }

    sql += ' ORDER BY w.domain, k.keyword';

    return await db.query(sql, params);
  } catch (err) {
    console.warn('[SERPService] DB unavailable, using local store for getLatestRankings:', err.message);
    return localStore.getLatestRankings(websiteId);
  }
}

async function getSERPAnalysisHistory(limit = 10) {
  const safeLimit = clampLimit(limit, 1, MAX_SERP_HISTORY_ENTRIES);

  try {
    const rows = await db.query(
      `SELECT id, keyword, country, result, created_at, updated_at
       FROM serp_analysis_history
       ORDER BY updated_at DESC
       LIMIT ${safeLimit}`
    );

    return rows
      .map((row) => {
        const parsed = parseStoredResult(row.result);

        return {
          id: row.id,
          keyword: row.keyword,
          country: row.country,
          country_name: parsed?.countryName || row.country,
          total_results: parsed?.totalResults || parsed?.results?.length || 0,
          difficulty_score: parsed?.difficulty?.score ?? null,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      });
  } catch (err) {
    console.warn('[SERPService] DB unavailable, using local store for getSERPAnalysisHistory:', err.message);
    return localStore.getSerpAnalysisHistory(safeLimit);
  }
}

async function getSERPAnalysisHistoryItem(id) {
  try {
    const rows = await db.query(
      `SELECT id, result, updated_at
       FROM serp_analysis_history
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    const parsed = parseStoredResult(row.result);

    return parsed
      ? {
          ...parsed,
          historyId: row.id,
          savedAt: row.updated_at,
        }
      : null;
  } catch (err) {
    console.warn('[SERPService] DB unavailable, using local store for getSERPAnalysisHistoryItem:', err.message);
    return localStore.getSerpAnalysisHistoryItem(id);
  }
}

async function deleteSERPAnalysisHistoryItem(id) {
  try {
    await db.query('DELETE FROM serp_analysis_history WHERE id = ?', [id]);
  } catch (err) {
    console.warn('[SERPService] DB unavailable, using local store for deleteSERPAnalysisHistoryItem:', err.message);
    await localStore.deleteSerpAnalysisHistoryItem(id);
  }
}

async function syncTrackedRankingsFromResults(keyword, results, country = 'US') {
  const trackedKeyword = await getTrackedKeywordByText(keyword);

  if (!trackedKeyword) {
    return {
      tracked: false,
      updated: 0,
      matched: 0,
      country,
    };
  }

  const websites = await getActiveTrackedWebsites();

  if (websites.length === 0) {
    return {
      tracked: true,
      keywordId: trackedKeyword.id,
      updated: 0,
      matched: 0,
      country,
      websites: [],
    };
  }

  const updates = [];

  for (const website of websites) {
    const ranking = await trackRankingFromResults(
      trackedKeyword.id,
      trackedKeyword.keyword,
      website.domain,
      website.id,
      results
    );

    updates.push({
      websiteId: website.id,
      websiteDomain: website.domain,
      position: ranking.position,
    });
  }

  return {
    tracked: true,
    keywordId: trackedKeyword.id,
    updated: updates.length,
    matched: updates.filter((item) => item.position != null).length,
    country,
    websites: updates,
  };
}

module.exports = {
  getSERPAnalysis,
  trackRanking,
  syncTrackedRankingsFromResults,
  getRankingHistory,
  getLatestRankings,
  getSERPAnalysisHistory,
  getSERPAnalysisHistoryItem,
  deleteSERPAnalysisHistoryItem,
};

function buildCacheKey(keyword, country) {
  return `${normalizeCountryCode(country)}::${keyword.trim().toLowerCase()}`;
}
