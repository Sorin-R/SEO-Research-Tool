const { GoogleAdsApi, ResourceNames } = require('google-ads-api');
const Cache = require('../utils/cache');

/**
 * Google Ads API Service
 * Provides keyword research data using Google Ads API KeywordPlanIdeaService.
 */

// Initialize cache for keyword ideas (10 minute TTL)
const ideaCache = new Cache(10 * 60 * 1000);

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

  const { languageId = 1000, locationId = 2840, bypassCache = false } = options;
  const cacheKey = `keyword_ideas_${keyword.toLowerCase()}`;

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
      totalIdeas: ideas.length,
      ideas,
      generatedAt: new Date().toISOString(),
    };

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
  initializeClient,
  clearCache,
  getCacheStats,
};
