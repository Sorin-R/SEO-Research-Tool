const db = require('../database');
const { analyzeSERP } = require('../analyzers/serpAnalyzer');
const { calculateDifficulty } = require('../analyzers/keywordDifficulty');
const { fetchSERPResults } = require('../scrapers/googleSERP');
const { analyzeSERPWithAI } = require('./aiSerpService');
const localStore = require('../utils/localStore');
const { getCountryConfig, normalizeCountryCode } = require('../utils/searchCountry');

/**
 * SERP cache duration in milliseconds (6 hours).
 * Avoids redundant scraping for recent queries.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SERP_HISTORY_ENTRIES = 12;
let rankingsSchemaRepairPromise = null;
const ALLOWED_TRACKING_DEPTHS = [10, 20, 50, 100];

function clampLimit(limit, min, max) {
  return Math.min(Math.max(Number.parseInt(limit, 10) || min, min), max);
}

function normalizeWebsiteId(value) {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

function normalizeTrackingDepth(depth) {
  const value = Number.parseInt(depth, 10);
  return ALLOWED_TRACKING_DEPTHS.includes(value) ? value : 10;
}

async function persistSERPAnalysisHistory(result, websiteId = null) {
  const keyword = result.keyword?.trim();
  const country = normalizeCountryCode(result.country);

  if (!keyword) {
    return null;
  }

  const payload = {
    ...result,
    keyword,
    country,
    websiteId,
  };

  try {
    const existing = await db.query(
      `SELECT id
       FROM serp_analysis_history
       WHERE LOWER(keyword) = LOWER(?)
         AND country = ?
         AND website_id <=> ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [keyword, country, websiteId]
    );

    let historyId;

    if (existing.length > 0) {
      historyId = existing[0].id;

      await db.query(
        `UPDATE serp_analysis_history
         SET website_id = ?, keyword = ?, country = ?, result = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [websiteId, keyword, country, JSON.stringify(payload), historyId]
      );
    } else {
      const insertResult = await db.query(
        `INSERT INTO serp_analysis_history (website_id, keyword, country, result)
         VALUES (?, ?, ?, ?)`,
        [websiteId, keyword, country, JSON.stringify(payload)]
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
    return localStore.saveSerpAnalysisHistory(payload, MAX_SERP_HISTORY_ENTRIES, websiteId);
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
  const websiteId = normalizeWebsiteId(options.websiteId);
  const aiOnly = options.aiOnly === true || options.aiOnly === 'true';
  const engine = normalizeSearchEngine(options.engine);
  const searchDomain = normalizeSearchDomain(options.searchDomain, engine, country);
  const countryConfig = getCountryConfig(country);
  const cacheKey = buildCacheKey(keyword, country, {
    aiOnly,
    engine,
    searchDomain,
  });
  let result;

  // Check cache first (unless forced refresh)
  if (!options.forceRefresh) {
    const cached = await getCachedSERP(cacheKey);
    if (cached) {
      result = {
        ...cached,
        country,
        countryName: countryConfig.name,
        engine: cached.engine || engine,
        searchDomain: cached.searchDomain || searchDomain,
        aiOnly: Boolean(cached.aiOnly),
        fromCache: true,
      };
    }
  }

  if (!result) {
    // Perform fresh analysis
    const analysis = aiOnly
      ? await analyzeSERPWithAI(keyword, {
          country,
          engine,
          searchDomain,
          numResults: 10,
        })
      : await analyzeSERP(keyword, 10, {
          country,
          engine,
        });

    // Calculate difficulty
    const difficulty = calculateDifficulty(analysis);

    result = {
      ...analysis,
      country,
      countryName: countryConfig.name,
      engine,
      searchDomain,
      aiOnly,
      difficulty,
      fromCache: false,
    };

    // Cache the results
    await cacheSERPResults(cacheKey, result);
  }

  try {
    const persistedHistoryId = await persistSERPAnalysisHistory(result, websiteId);
    if (persistedHistoryId) {
      result.historyId = persistedHistoryId;
    }
  } catch (err) {
    console.warn('[SERPService] Failed to persist SERP analysis history:', err.message);
  }

  return result;
}

async function getRankTrackingResults(keyword, options = {}) {
  return fetchSERPResults(keyword, normalizeTrackingDepth(options.numResults), {
    country: normalizeCountryCode(options.country),
  });
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
  const target = parseTrackingTarget(targetDomain);

  if (!target) {
    return null;
  }

  return results.find((result) => {
    try {
      const resultUrl = new URL(result.url);
      const hostname = resultUrl.hostname.replace(/^www\./, '').toLowerCase();

      if (target.type === 'page') {
        return buildComparablePageUrl(resultUrl) === target.value;
      }

      return hostname === target.value || hostname.endsWith(`.${target.value}`);
    } catch {
      return false;
    }
  });
}

function parseTrackingTarget(targetValue) {
  const raw = String(targetValue || '').trim();

  if (!raw) {
    return null;
  }

  let normalized = raw;

  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  try {
    const parsedUrl = new URL(normalized);
    const hostname = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
    const pathname = normalizePathname(parsedUrl.pathname);

    if (!hostname) {
      return null;
    }

    if (pathname !== '/') {
      return {
        type: 'page',
        value: `https://${hostname}${pathname}`,
      };
    }

    return {
      type: 'domain',
      value: hostname,
    };
  } catch {
    return null;
  }
}

function buildComparablePageUrl(value) {
  const parsedUrl = value instanceof URL ? value : new URL(value);
  const hostname = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
  return `https://${hostname}${normalizePathname(parsedUrl.pathname)}`;
}

function normalizePathname(pathname) {
  const value = String(pathname || '/').trim();

  if (!value || value === '/') {
    return '/';
  }

  const normalized = value.startsWith('/') ? value : `/${value}`;
  return normalized.replace(/\/+$/, '') || '/';
}

async function persistRankingRecord({ keywordId, websiteId = null, url, position, title, date }) {
  try {
    await upsertRankingRecord({ keywordId, websiteId, url, position, title, date });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      try {
        const repaired = await ensureRankingsSchemaForWrites();

        if (repaired) {
          await upsertRankingRecord({ keywordId, websiteId, url, position, title, date });
          return;
        }
      } catch (repairErr) {
        console.warn('[SERPService] Failed to repair rankings schema after duplicate insert:', repairErr.message);
      }
    }

    console.warn('[SERPService] DB unavailable, using local store for persistRankingRecord:', err.message);
    await localStore.saveRanking({ keywordId, websiteId, url, position, title, date });
  }
}

async function upsertRankingRecord({ keywordId, websiteId = null, url, position, title, date }) {
  const existingRows = await db.query(
    `SELECT id
     FROM rankings
     WHERE website_id <=> ?
       AND keyword_id = ?
       AND date = ?
     LIMIT 1`,
    [websiteId, keywordId, date]
  );

  if (existingRows.length > 0) {
    await db.query(
      `UPDATE rankings
       SET position = ?, url = ?, title = ?
       WHERE id = ?`,
      [position, url, title, existingRows[0].id]
    );
    return;
  }

  await db.query(
    `INSERT INTO rankings (website_id, keyword_id, url, position, title, date)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [websiteId, keywordId, url, position, title, date]
  );
}

async function ensureRankingsSchemaForWrites() {
  if (typeof db.ensureRankingsWebsiteSchema !== 'function') {
    return false;
  }

  if (!rankingsSchemaRepairPromise) {
    rankingsSchemaRepairPromise = db.ensureRankingsWebsiteSchema()
      .then(() => true)
      .catch((err) => {
        console.warn('[SERPService] Rankings schema repair failed:', err.message);
        return false;
      })
      .finally(() => {
        rankingsSchemaRepairPromise = null;
      });
  }

  return rankingsSchemaRepairPromise;
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
    const rows = await db.query(
      'SELECT * FROM websites WHERE is_active = 1 ORDER BY updated_at DESC, created_at DESC'
    );
    return rows.map((row) => ({
      ...row,
      country: normalizeCountryCode(row.country),
    }));
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
async function trackRanking(keywordId, keyword, targetDomain, websiteId = null, country = 'US', depth = 10) {
  const results = await getRankTrackingResults(keyword, {
    country: normalizeCountryCode(country),
    numResults: depth,
  });
  return trackRankingFromResults(keywordId, keyword, targetDomain, websiteId, results);
}

/**
 * Get ranking history for a keyword.
 */
async function getRankingHistory(keywordId, days = 30, websiteId = null, options = {}) {
  try {
    const params = [keywordId];
    let sql = `SELECT r.*, k.keyword, w.name AS website_name, w.domain AS website_domain
       FROM rankings r
       INNER JOIN keywords k ON k.id = r.keyword_id
       LEFT JOIN websites w ON w.id = r.website_id
       WHERE keyword_id = ?
    `;

    if (options.startDate && options.endDate) {
      sql += ' AND date >= ? AND date <= ?';
      params.push(options.startDate, options.endDate);
    } else {
      sql += ' AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)';
      params.push(days);
    }

    if (websiteId != null) {
      sql += ' AND r.website_id = ?';
      params.push(websiteId);
    }

    sql += ' ORDER BY date ASC';

    const rows = await db.query(sql, params);
    const localRows = await getLocalRankingHistoryRows(keywordId, days, websiteId);

    if (websiteId == null) {
      return mergeRankingHistoryRows(rows, localRows);
    }

    const orphanedRows = await getOrphanedRankingHistory(keywordId, days, websiteId);
    return mergeRankingHistoryRows(rows, mergeRankingHistoryRows(orphanedRows, localRows));
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
    let sql = `SELECT r.*, k.keyword, w.name AS website_name, w.domain AS website_domain,
       (SELECT r3.position FROM rankings r3
        WHERE r3.keyword_id = r.keyword_id
          AND COALESCE(r3.website_id, 0) = COALESCE(r.website_id, 0)
          AND r3.date < r.date
        ORDER BY r3.date DESC LIMIT 1) AS previous_position
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

    const rows = await db.query(sql, params);
    const localRows = await getLocalLatestRankingRows(websiteId);

    if (websiteId == null) {
      return mergeLatestRankingRows(rows, localRows);
    }

    const orphanedRows = await getOrphanedLatestRankings(websiteId);
    return mergeLatestRankingRows(rows, mergeLatestRankingRows(orphanedRows, localRows));
  } catch (err) {
    console.warn('[SERPService] DB unavailable, using local store for getLatestRankings:', err.message);
    return localStore.getLatestRankings(websiteId);
  }
}

async function getSERPAnalysisHistory(limit = 10, websiteId = null) {
  const safeLimit = clampLimit(limit, 1, MAX_SERP_HISTORY_ENTRIES);
  const normalizedWebsiteId = normalizeWebsiteId(websiteId);

  try {
    const params = [];
    let sql = `SELECT id, website_id, keyword, country, result, created_at, updated_at
       FROM serp_analysis_history`;
    if (normalizedWebsiteId != null) {
      sql += ' WHERE website_id = ?';
      params.push(normalizedWebsiteId);
    }
    sql += ` ORDER BY updated_at DESC
       LIMIT ${safeLimit}`;

    const rows = await db.query(
      sql,
      params
    );

    return rows
      .map((row) => {
        const parsed = parseStoredResult(row.result);

        return {
          id: row.id,
          website_id: row.website_id ?? null,
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
    return localStore.getSerpAnalysisHistory(safeLimit, normalizedWebsiteId);
  }
}

async function getSERPAnalysisHistoryItem(id, websiteId = null) {
  const normalizedWebsiteId = normalizeWebsiteId(websiteId);
  try {
    const params = [id];
    let sql = `SELECT id, website_id, result, updated_at
       FROM serp_analysis_history
       WHERE id = ?`;
    if (normalizedWebsiteId != null) {
      sql += ' AND website_id = ?';
      params.push(normalizedWebsiteId);
    }
    sql += ' LIMIT 1';

    const rows = await db.query(
      sql,
      params
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
          websiteId: row.website_id ?? null,
        }
      : null;
  } catch (err) {
    console.warn('[SERPService] DB unavailable, using local store for getSERPAnalysisHistoryItem:', err.message);
    return localStore.getSerpAnalysisHistoryItem(id, normalizedWebsiteId);
  }
}

async function deleteSERPAnalysisHistoryItem(id, websiteId = null) {
  const normalizedWebsiteId = normalizeWebsiteId(websiteId);
  try {
    if (normalizedWebsiteId == null) {
      await db.query('DELETE FROM serp_analysis_history WHERE id = ?', [id]);
    } else {
      await db.query('DELETE FROM serp_analysis_history WHERE id = ? AND website_id = ?', [id, normalizedWebsiteId]);
    }
  } catch (err) {
    console.warn('[SERPService] DB unavailable, using local store for deleteSERPAnalysisHistoryItem:', err.message);
    await localStore.deleteSerpAnalysisHistoryItem(id);
  }
}

async function syncTrackedRankingsFromResults(keyword, results, country = 'US') {
  const normalizedCountry = normalizeCountryCode(country);
  const trackedKeyword = await getTrackedKeywordByText(keyword);

  if (!trackedKeyword) {
    return {
      tracked: false,
      updated: 0,
      matched: 0,
      country: normalizedCountry,
    };
  }

  const activeWebsites = await getActiveTrackedWebsites();
  const websites = activeWebsites.filter(
    (website) => normalizeCountryCode(website.country) === normalizedCountry
  );

  if (websites.length === 0) {
    return {
      tracked: true,
      keywordId: trackedKeyword.id,
      updated: 0,
      matched: 0,
      country: normalizedCountry,
      activeWebsites: activeWebsites.length,
      eligibleWebsites: 0,
      websites: [],
    };
  }

  const updates = [];

  for (const website of websites) {
    const ranking = await trackRankingFromResults(
      trackedKeyword.id,
      trackedKeyword.keyword,
      website.target_url || website.domain,
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
    country: normalizedCountry,
    activeWebsites: activeWebsites.length,
    eligibleWebsites: websites.length,
    websites: updates,
  };
}

async function exportRankings(websiteId, format = 'json') {
  const rankings = await getLatestRankings(websiteId);
  if (format === 'csv') {
    const header = 'Keyword,Position,Previous Position,Change,URL,Date,Website';
    const rows = rankings.map((r) => {
      const delta = r.previous_position != null && r.position != null
        ? r.previous_position - r.position
        : '';
      return [
        `"${(r.keyword || '').replace(/"/g, '""')}"`,
        r.position ?? 'N/A',
        r.previous_position ?? 'N/A',
        delta,
        `"${(r.url || '').replace(/"/g, '""')}"`,
        r.date || '',
        `"${(r.website_domain || '').replace(/"/g, '""')}"`,
      ].join(',');
    });
    return [header, ...rows].join('\n');
  }
  return rankings;
}

async function getRankingTrendsSummary(websiteId) {
  const rankings = await getLatestRankings(websiteId);
  const ranked = rankings.filter((r) => r.position != null);
  const notRanked = rankings.filter((r) => r.position == null);
  const improved = rankings.filter((r) => r.previous_position != null && r.position != null && r.position < r.previous_position);
  const declined = rankings.filter((r) => r.previous_position != null && r.position != null && r.position > r.previous_position);
  const unchanged = rankings.filter((r) => r.previous_position != null && r.position != null && r.position === r.previous_position);

  const positions = ranked.map((r) => r.position);
  const avgPosition = positions.length > 0 ? (positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(1) : null;
  const bestPosition = positions.length > 0 ? Math.min(...positions) : null;
  const worstPosition = positions.length > 0 ? Math.max(...positions) : null;

  const top3 = ranked.filter((r) => r.position <= 3).length;
  const top10 = ranked.filter((r) => r.position <= 10).length;
  const top20 = ranked.filter((r) => r.position <= 20).length;

  return {
    totalKeywords: rankings.length,
    ranked: ranked.length,
    notRanked: notRanked.length,
    improved: improved.length,
    declined: declined.length,
    unchanged: unchanged.length,
    avgPosition,
    bestPosition,
    worstPosition,
    top3,
    top10,
    top20,
  };
}

async function getAlerts(limit = 50, unreadOnly = false) {
  try {
    let sql = `SELECT a.*, k.keyword, w.domain AS website_domain
       FROM ranking_alerts a
       INNER JOIN keywords k ON k.id = a.keyword_id
       LEFT JOIN websites w ON w.id = a.website_id`;
    const params = [];
    if (unreadOnly) {
      sql += ' WHERE a.is_read = 0';
    }
    sql += ' ORDER BY a.created_at DESC LIMIT ?';
    params.push(Math.min(Math.max(limit, 1), 200));
    return await db.query(sql, params);
  } catch {
    return [];
  }
}

async function markAlertsRead(alertIds = []) {
  if (alertIds.length === 0) return;
  try {
    const placeholders = alertIds.map(() => '?').join(',');
    await db.query(
      `UPDATE ranking_alerts SET is_read = 1 WHERE id IN (${placeholders})`,
      alertIds
    );
  } catch {
    // non-critical
  }
}

async function markAllAlertsRead() {
  try {
    await db.query('UPDATE ranking_alerts SET is_read = 1 WHERE is_read = 0');
  } catch {
    // non-critical
  }
}

async function getUnreadAlertCount() {
  try {
    const rows = await db.query('SELECT COUNT(*) AS cnt FROM ranking_alerts WHERE is_read = 0');
    return rows[0]?.cnt || 0;
  } catch {
    return 0;
  }
}

module.exports = {
  getSERPAnalysis,
  getRankTrackingResults,
  trackRanking,
  syncTrackedRankingsFromResults,
  getRankingHistory,
  getLatestRankings,
  getSERPAnalysisHistory,
  getSERPAnalysisHistoryItem,
  deleteSERPAnalysisHistoryItem,
  exportRankings,
  getRankingTrendsSummary,
  getAlerts,
  markAlertsRead,
  markAllAlertsRead,
  getUnreadAlertCount,
};

function normalizeSearchEngine(value) {
  return String(value || 'google').toLowerCase() === 'bing' ? 'bing' : 'google';
}

function normalizeSearchDomain(value, engine, country) {
  const resolvedEngine = normalizeSearchEngine(engine);

  if (resolvedEngine === 'bing') {
    return 'bing.com';
  }

  const raw = String(value || '').trim().toLowerCase();
  if (/^([a-z0-9-]+\.)?google\.[a-z.]+$/.test(raw)) {
    return raw;
  }

  return getCountryConfig(country).googleDomain || 'google.com';
}

function buildCacheKey(keyword, country, options = {}) {
  const prefix = options.aiOnly ? 'ai' : 'standard';
  const engine = normalizeSearchEngine(options.engine);
  const domain = normalizeSearchDomain(options.searchDomain, engine, country);
  return `${prefix}::${engine}::${domain}::${normalizeCountryCode(country)}::${keyword.trim().toLowerCase()}`;
}

async function getWebsiteByIdForMatching(websiteId) {
  try {
    const rows = await db.query('SELECT * FROM websites WHERE id = ? LIMIT 1', [websiteId]);
    return rows[0] || null;
  } catch {
    return localStore.getWebsiteById(websiteId);
  }
}

function rowMatchesWebsiteTarget(row, website) {
  if (!website || !row?.url) {
    return false;
  }

  return Boolean(findResultForDomain([{ url: row.url }], website.target_url || website.domain));
}

async function getOrphanedRankingHistory(keywordId, days, websiteId) {
  const website = await getWebsiteByIdForMatching(websiteId);

  if (!website) {
    return [];
  }

  const rows = await db.query(
    `SELECT r.*, k.keyword
     FROM rankings r
     INNER JOIN keywords k ON k.id = r.keyword_id
     LEFT JOIN websites w ON w.id = r.website_id
     WHERE r.keyword_id = ?
       AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       AND w.id IS NULL
     ORDER BY date ASC`,
    [keywordId, days]
  );

  return rows
    .filter((row) => rowMatchesWebsiteTarget(row, website))
    .map((row) => ({
      ...row,
      website_name: website.name || website.domain,
      website_domain: website.domain,
    }));
}

async function getOrphanedLatestRankings(websiteId) {
  const website = await getWebsiteByIdForMatching(websiteId);

  if (!website) {
    return [];
  }

  const rows = await db.query(
    `SELECT r.*, k.keyword
     FROM rankings r
     INNER JOIN keywords k ON k.id = r.keyword_id
     LEFT JOIN websites w ON w.id = r.website_id
     WHERE w.id IS NULL
     ORDER BY r.date DESC, r.created_at DESC`
  );

  const matchedRows = rows.filter((row) => rowMatchesWebsiteTarget(row, website));
  const latestByKeyword = new Map();

  for (const row of matchedRows) {
    if (!latestByKeyword.has(row.keyword_id)) {
      latestByKeyword.set(row.keyword_id, {
        ...row,
        website_name: website.name || website.domain,
        website_domain: website.domain,
      });
    }
  }

  return [...latestByKeyword.values()].sort((left, right) =>
    String(left.keyword || '').localeCompare(String(right.keyword || ''))
  );
}

function mergeLatestRankingRows(primaryRows = [], fallbackRows = []) {
  const merged = new Map();

  for (const row of fallbackRows) {
    const key = String(row.keyword_id);
    merged.set(key, pickPreferredRankingRow(merged.get(key), row));
  }

  for (const row of primaryRows) {
    const key = String(row.keyword_id);
    merged.set(key, pickPreferredRankingRow(merged.get(key), row));
  }

  return [...merged.values()].sort((left, right) =>
    String(left.keyword || '').localeCompare(String(right.keyword || ''))
  );
}

function mergeRankingHistoryRows(primaryRows = [], fallbackRows = []) {
  const merged = new Map();

  for (const row of fallbackRows) {
    const key = String(row.date);
    merged.set(key, pickPreferredRankingRow(merged.get(key), row));
  }

  for (const row of primaryRows) {
    const key = String(row.date);
    merged.set(key, pickPreferredRankingRow(merged.get(key), row));
  }

  return [...merged.values()].sort((left, right) =>
    new Date(left.date).getTime() - new Date(right.date).getTime()
  );
}

async function getLocalRankingHistoryRows(keywordId, days, websiteId) {
  try {
    return await localStore.getRankingHistory(keywordId, days, websiteId);
  } catch {
    return [];
  }
}

async function getLocalLatestRankingRows(websiteId) {
  try {
    return await localStore.getLatestRankings(websiteId);
  } catch {
    return [];
  }
}

function pickPreferredRankingRow(existing, candidate) {
  if (!existing) {
    return candidate;
  }

  const freshnessComparison = compareRankingFreshness(existing, candidate);

  if (freshnessComparison > 0) {
    return candidate;
  }

  if (freshnessComparison < 0) {
    return existing;
  }

  const existingHasPosition = existing.position != null;
  const candidateHasPosition = candidate.position != null;

  if (candidateHasPosition && !existingHasPosition) {
    return candidate;
  }

  return existing;
}

function compareRankingFreshness(left = {}, right = {}) {
  const leftDate = new Date(left.date || 0).getTime();
  const rightDate = new Date(right.date || 0).getTime();

  if (leftDate !== rightDate) {
    return rightDate - leftDate;
  }

  const leftCreated = new Date(left.updated_at || left.created_at || 0).getTime();
  const rightCreated = new Date(right.updated_at || right.created_at || 0).getTime();

  if (leftCreated !== rightCreated) {
    return rightCreated - leftCreated;
  }

  return 0;
}
