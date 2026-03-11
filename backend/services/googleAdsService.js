const { GoogleAdsApi, ResourceNames } = require('google-ads-api');
const Cache = require('../utils/cache');
const db = require('../database/connection');
const localStore = require('../utils/localStore');

/**
 * Google Ads API Service
 * Provides keyword research data using Google Ads API KeywordPlanIdeaService.
 */

// Initialize cache for keyword ideas (10 minute TTL)
const ideaCache = new Cache(10 * 60 * 1000);
const MAX_HISTORY_ENTRIES = 12;

// Google Ads client initialization
let client = null;
let customer = null;

/**
 * Initialize the Google Ads client.
 * Requires environment variables:
 *   - GOOGLE_ADS_CLIENT_ID
 *   - GOOGLE_ADS_CLIENT_SECRET
 *   - GOOGLE_ADS_DEVELOPER_TOKEN
 *   - GOOGLE_ADS_REFRESH_TOKEN
 *   - GOOGLE_ADS_LOGIN_CUSTOMER_ID
 */
function initializeClient() {
  if (customer) return customer;

  const requiredEnvs = [
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_REFRESH_TOKEN',
    'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
  ];

  const missing = requiredEnvs.filter((env) => !process.env[env]);
  if (missing.length > 0) {
    console.warn(
      `[GoogleAdsService] Missing credentials: ${missing.join(', ')}. Google Ads features will be unavailable.`
    );
    return null;
  }

  try {
    const customerId = normalizeCustomerId(
      process.env.GOOGLE_ADS_CUSTOMER_ID || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
    );
    const loginCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);

    client = new GoogleAdsApi({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    });

    customer = client.Customer({
      customer_id: customerId,
      login_customer_id: loginCustomerId,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    });

    console.log('[GoogleAdsService] Client initialized successfully.');
    return customer;
  } catch (err) {
    console.error('[GoogleAdsService] Initialization failed:', err.message);
    return null;
  }
}

/**
 * Generate keyword ideas using Google Ads KeywordPlanIdeaService.
 *
 * @param {string} keyword - Seed keyword
 * @param {Object} [options] - Additional options
 * @param {string} [options.languageId] - Language code (default: 1000 for English)
 * @param {string} [options.locationId] - Location code (default: 2840 for United States)
 * @param {boolean} [options.bypassCache] - Skip cache and fetch fresh data
 * @returns {Promise<Array>} Array of keyword ideas with metrics
 */
async function generateKeywordIdeas(keyword, options = {}) {
  if (!keyword || !keyword.trim()) {
    throw new Error('Keyword is required.');
  }

  const {
    languageId = 1000,
    locationId = 2840,
    country = 'US',
    countryName = 'United States',
    bypassCache = false,
  } = options;
  const cacheKey = `keyword_ideas_${String(country || 'US').toUpperCase()}_${languageId}_${locationId}_${keyword.toLowerCase()}`;

  // Check cache first
  if (!bypassCache) {
    const cached = ideaCache.get(cacheKey);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  const adsCustomer = initializeClient();
  if (!adsCustomer) {
    throw new Error('Google Ads API is not configured. Check your credentials in .env');
  }

  try {
    const customerId = normalizeCustomerId(
      process.env.GOOGLE_ADS_CUSTOMER_ID || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
    );

    const response = await adsCustomer.keywordPlanIdeas.generateKeywordIdeas({
      customer_id: customerId,
      language: ResourceNames.languageConstant(languageId),
      geo_target_constants: [ResourceNames.geoTargetConstant(locationId)],
      keyword_seed: {
        keywords: [keyword],
      },
      page_size: 100,
    });

    const rawIdeas = Array.isArray(response)
      ? response
      : Array.isArray(response?.results)
        ? response.results
        : [];

    // Parse and format the results
    const ideas = rawIdeas
      .map((idea) => ({
        keyword: idea.text,
        avgMonthlySearches: parseIntegerMetric(idea.keyword_idea_metrics?.avg_monthly_searches),
        competition: normalizeCompetition(
          idea.keyword_idea_metrics?.competition,
          idea.keyword_idea_metrics?.competition_index
        ),
        cpc: normalizeCpc(idea.keyword_idea_metrics),
        competitionLevel: normalizeCompetition(
          idea.keyword_idea_metrics?.competition,
          idea.keyword_idea_metrics?.competition_index
        ),
      }))
      .sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches);

    const result = {
      keyword,
      country: String(country || 'US').toUpperCase(),
      countryName,
      totalIdeas: ideas.length,
      ideas,
      generatedAt: new Date().toISOString(),
    };

    try {
      const historyId = await persistGoogleAdsKeywordHistory(result);
      if (historyId) {
        result.historyId = historyId;
      }
    } catch (historyError) {
      console.warn('[GoogleAdsService] Failed to persist keyword idea history:', historyError.message);
    }

    // Cache the result
    ideaCache.set(cacheKey, result);

    return { ...result, fromCache: false };
  } catch (err) {
    const message = getGoogleAdsErrorMessage(err);
    console.error('[GoogleAdsService] generateKeywordIdeas error:', message);
    throw new Error(`Google Ads API error: ${message}`);
  }
}

function normalizeCustomerId(customerId) {
  return String(customerId || '').replace(/-/g, '').trim();
}

function clampLimit(limit, min = 1, max = MAX_HISTORY_ENTRIES) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed)) {
    return max;
  }

  return Math.min(max, Math.max(min, parsed));
}

function parseStoredResult(result) {
  if (!result) {
    return null;
  }

  if (typeof result === 'string') {
    try {
      return JSON.parse(result);
    } catch {
      return null;
    }
  }

  return result;
}

function parseIntegerMetric(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getGoogleAdsErrorMessage(err) {
  if (Array.isArray(err?.errors) && err.errors.length > 0) {
    return err.errors.map((error) => error.message).filter(Boolean).join(' | ');
  }

  return err?.details || err?.message || 'Unknown Google Ads error';
}

/**
 * Normalize competition index (0-100) to human-readable labels.
 */
function normalizeCompetition(level, index) {
  const normalizedLevel = String(level || '').toUpperCase().trim();
  if (['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'].includes(normalizedLevel)) {
    return normalizedLevel;
  }

  const numericIndex = Number.parseInt(index, 10);
  if (!Number.isFinite(numericIndex)) return 'UNKNOWN';
  if (numericIndex <= 25) return 'LOW';
  if (numericIndex <= 50) return 'MEDIUM';
  if (numericIndex <= 75) return 'HIGH';
  return 'VERY_HIGH';
}

function normalizeCpc(metrics = {}) {
  const averageCpcMicros = Number.parseInt(metrics.average_cpc_micros, 10);
  if (Number.isFinite(averageCpcMicros) && averageCpcMicros > 0) {
    return averageCpcMicros / 1000000;
  }

  const lowTopOfPage = Number.parseInt(metrics.low_top_of_page_bid_micros, 10);
  const highTopOfPage = Number.parseInt(metrics.high_top_of_page_bid_micros, 10);

  if (Number.isFinite(lowTopOfPage) && Number.isFinite(highTopOfPage) && lowTopOfPage > 0 && highTopOfPage > 0) {
    return ((lowTopOfPage + highTopOfPage) / 2) / 1000000;
  }

  if (Number.isFinite(highTopOfPage) && highTopOfPage > 0) {
    return highTopOfPage / 1000000;
  }

  if (Number.isFinite(lowTopOfPage) && lowTopOfPage > 0) {
    return lowTopOfPage / 1000000;
  }

  return 0;
}

async function persistGoogleAdsKeywordHistory(result) {
  const keyword = String(result.keyword || '').trim();
  const country = String(result.country || 'US').trim().toUpperCase();

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
       FROM google_ads_keyword_history
       WHERE LOWER(keyword) = LOWER(?) AND country = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [keyword, country]
    );

    let historyId;

    if (existing.length > 0) {
      historyId = existing[0].id;

      await db.query(
        `UPDATE google_ads_keyword_history
         SET keyword = ?, country = ?, country_name = ?, result = ?, total_ideas = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          keyword,
          country,
          payload.countryName || country,
          JSON.stringify(payload),
          payload.totalIdeas || payload.ideas?.length || 0,
          historyId,
        ]
      );

      await db.query(
        `DELETE FROM google_ads_keyword_history
         WHERE LOWER(keyword) = LOWER(?) AND country = ? AND id <> ?`,
        [keyword, country, historyId]
      );
    } else {
      const insertResult = await db.query(
        `INSERT INTO google_ads_keyword_history (keyword, country, country_name, result, total_ideas)
         VALUES (?, ?, ?, ?, ?)`,
        [
          keyword,
          country,
          payload.countryName || country,
          JSON.stringify(payload),
          payload.totalIdeas || payload.ideas?.length || 0,
        ]
      );
      historyId = insertResult.insertId;
    }

    await db.query(
      `DELETE FROM google_ads_keyword_history
       WHERE id NOT IN (
         SELECT id FROM (
           SELECT id
           FROM google_ads_keyword_history
           ORDER BY updated_at DESC
           LIMIT ${MAX_HISTORY_ENTRIES}
         ) AS recent_google_ads_history
       )`
    );

    return historyId;
  } catch (err) {
    console.warn('[GoogleAdsService] DB unavailable, using local store for saveGoogleAdsKeywordHistory:', err.message);
    return localStore.saveGoogleAdsKeywordHistory(payload, MAX_HISTORY_ENTRIES);
  }
}

async function getGoogleAdsKeywordHistory(limit = 10) {
  const safeLimit = clampLimit(limit);

  try {
    return await db.query(
      `SELECT id, keyword, country, country_name, total_ideas, created_at, updated_at
       FROM google_ads_keyword_history
       ORDER BY updated_at DESC
       LIMIT ${safeLimit}`
    );
  } catch (err) {
    console.warn('[GoogleAdsService] DB unavailable, using local store for getGoogleAdsKeywordHistory:', err.message);
    return localStore.getGoogleAdsKeywordHistory(safeLimit);
  }
}

async function getGoogleAdsKeywordHistoryItem(id) {
  try {
    const rows = await db.query(
      `SELECT id, result, updated_at
       FROM google_ads_keyword_history
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
    console.warn('[GoogleAdsService] DB unavailable, using local store for getGoogleAdsKeywordHistoryItem:', err.message);
    return localStore.getGoogleAdsKeywordHistoryItem(id);
  }
}

async function deleteGoogleAdsKeywordHistoryItem(id) {
  try {
    await db.query('DELETE FROM google_ads_keyword_history WHERE id = ?', [id]);
  } catch (err) {
    console.warn('[GoogleAdsService] DB unavailable, using local store for deleteGoogleAdsKeywordHistoryItem:', err.message);
    await localStore.deleteGoogleAdsKeywordHistoryItem(id);
  }
}

/**
 * Clear the keyword ideas cache.
 * Useful for manual cache invalidation.
 */
function clearCache() {
  ideaCache.clear();
  console.log('[GoogleAdsService] Cache cleared.');
}

/**
 * Get cache statistics.
 */
function getCacheStats() {
  return ideaCache.stats();
}

module.exports = {
  generateKeywordIdeas,
  getGoogleAdsKeywordHistory,
  getGoogleAdsKeywordHistoryItem,
  deleteGoogleAdsKeywordHistoryItem,
  initializeClient,
  clearCache,
  getCacheStats,
};
