const db = require('../database');
const { analyzeSERP } = require('../analyzers/serpAnalyzer');
const { calculateDifficulty } = require('../analyzers/keywordDifficulty');

/**
 * SERP cache duration in milliseconds (6 hours).
 * Avoids redundant scraping for recent queries.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Get SERP analysis for a keyword, using cache when available.
 *
 * @param {string} keyword
 * @param {Object} [options]
 * @param {boolean} [options.forceRefresh] - Bypass cache
 * @returns {Promise<Object>}
 */
async function getSERPAnalysis(keyword, options = {}) {
  // Check cache first (unless forced refresh)
  if (!options.forceRefresh) {
    const cached = await getCachedSERP(keyword);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  // Perform fresh analysis
  const analysis = await analyzeSERP(keyword);

  // Calculate difficulty
  const difficulty = calculateDifficulty(analysis);

  const result = {
    ...analysis,
    difficulty,
    fromCache: false,
  };

  // Cache the results
  await cacheSERPResults(keyword, result);

  return result;
}

/**
 * Check the DB cache for recent SERP results.
 */
async function getCachedSERP(keyword) {
  const rows = await db.query(
    `SELECT results, fetched_at FROM serp_cache
     WHERE keyword = ?
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [keyword]
  );

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
    console.warn('[SERPService] Cache write failed:', err.message);
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
async function trackRanking(keywordId, keyword, targetDomain) {
  const analysis = await analyzeSERP(keyword, 10);

  // Find the target domain in results
  const domainLower = targetDomain.toLowerCase();
  const match = analysis.results.find((r) => {
    try {
      const hostname = new URL(r.url).hostname.replace(/^www\./, '').toLowerCase();
      return hostname.includes(domainLower);
    } catch {
      return false;
    }
  });

  const position = match ? match.position : null;
  const url = match ? match.url : null;
  const title = match ? match.title : null;
  const today = new Date().toISOString().split('T')[0];

  await db.query(
    `INSERT INTO rankings (keyword_id, url, position, title, date)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       position = ?, url = ?, title = ?`,
    [keywordId, url, position, title, today, position, url, title]
  );

  return { keywordId, keyword, position, url, title, date: today };
}

/**
 * Get ranking history for a keyword.
 */
async function getRankingHistory(keywordId, days = 30) {
  return db.query(
    `SELECT * FROM rankings
     WHERE keyword_id = ?
       AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     ORDER BY date ASC`,
    [keywordId, days]
  );
}

/**
 * Get the latest ranking for all tracked keywords.
 */
async function getLatestRankings() {
  return db.query(
    `SELECT r.*, k.keyword
     FROM rankings r
     INNER JOIN keywords k ON k.id = r.keyword_id
     WHERE r.date = (
       SELECT MAX(r2.date) FROM rankings r2 WHERE r2.keyword_id = r.keyword_id
     )
     ORDER BY k.keyword`
  );
}

module.exports = {
  getSERPAnalysis,
  trackRanking,
  getRankingHistory,
  getLatestRankings,
};
