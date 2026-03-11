const express = require('express');
const router = express.Router();
const {
  generateKeywordIdeas,
  getGoogleAdsKeywordHistory,
  getGoogleAdsKeywordHistoryItem,
  deleteGoogleAdsKeywordHistoryItem,
  clearCache,
  getCacheStats,
} = require('../services/googleAdsService');
const { getGoogleAdsCountryConfig } = require('../utils/googleAdsCountry');

/**
 * GET /api/google-ads/keyword-ideas?q=keyword&bypass_cache=false
 *
 * Generate keyword ideas using Google Ads API.
 * Includes metrics: search volume, competition, CPC.
 *
 * Query params:
 *   - q (required): Seed keyword
 *   - bypass_cache (optional): Set to 'true' to skip cache
 *   - language_id (optional): Google language code (default: 1000 = English)
 *   - location_id (optional): Google location code (default: 2840 = United States)
 */
router.get('/keyword-ideas', async (req, res) => {
  const { q, bypass_cache, language_id, location_id, country } = req.query;

  // Validate keyword
  if (!q || !q.trim()) {
    return res.status(400).json({
      error: 'Keyword query parameter "q" is required.',
    });
  }

  try {
    const countryConfig = getGoogleAdsCountryConfig(country);
    const result = await generateKeywordIdeas(q.trim(), {
      country: countryConfig.code,
      countryName: countryConfig.name,
      languageId: language_id ? parseInt(language_id, 10) : countryConfig.languageId,
      locationId: location_id ? parseInt(location_id, 10) : countryConfig.locationId,
      bypassCache: bypass_cache === 'true',
    });

    res.json(result);
  } catch (err) {
    console.error('[Route /google-ads/keyword-ideas] Error:', err.message);
    res.status(500).json({
      error: err.message,
      details: 'Failed to generate keyword ideas. Check API credentials.',
    });
  }
});

router.get('/history', async (req, res) => {
  try {
    const history = await getGoogleAdsKeywordHistory(req.query.limit);
    res.json(history);
  } catch (err) {
    console.error('[Route /google-ads/history] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch Google Ads keyword research history.' });
  }
});

router.get('/history/:id', async (req, res) => {
  try {
    const item = await getGoogleAdsKeywordHistoryItem(req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Google Ads keyword research history item not found.' });
    }

    res.json(item);
  } catch (err) {
    console.error('[Route /google-ads/history/:id] Error:', err.message);
    res.status(500).json({ error: 'Failed to load Google Ads keyword research history item.' });
  }
});

router.delete('/history/:id', async (req, res) => {
  try {
    await deleteGoogleAdsKeywordHistoryItem(req.params.id);
    res.json({ message: 'Google Ads keyword research history item deleted.' });
  } catch (err) {
    console.error('[Route /google-ads/history/:id DELETE] Error:', err.message);
    res.status(500).json({ error: 'Failed to delete Google Ads keyword research history item.' });
  }
});

/**
 * GET /api/google-ads/cache-stats
 * Returns cache statistics for debugging/monitoring.
 */
router.get('/cache-stats', (req, res) => {
  const stats = getCacheStats();
  res.json({ cacheStats: stats });
});

/**
 * POST /api/google-ads/cache/clear
 * Manually clear the keyword ideas cache.
 * Useful for forcing a refresh of all cached data.
 */
router.post('/cache/clear', (req, res) => {
  try {
    clearCache();
    res.json({ message: 'Cache cleared successfully.' });
  } catch (err) {
    console.error('[Route /google-ads/cache/clear] Error:', err.message);
    res.status(500).json({ error: 'Failed to clear cache.' });
  }
});

module.exports = router;
