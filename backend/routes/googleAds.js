const express = require('express');
const router = express.Router();
const { generateKeywordIdeas, clearCache, getCacheStats } = require('../services/googleAdsService');

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
  const { q, bypass_cache, language_id, location_id } = req.query;

  // Validate keyword
  if (!q || !q.trim()) {
    return res.status(400).json({
      error: 'Keyword query parameter "q" is required.',
    });
  }

  try {
    const result = await generateKeywordIdeas(q.trim(), {
      languageId: language_id ? parseInt(language_id, 10) : 1000,
      locationId: location_id ? parseInt(location_id, 10) : 2840,
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
