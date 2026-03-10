const express = require('express');
const router = express.Router();
const { serpService } = require('../services');
const { serpApiManager } = require('../scrapers');
const { normalizeCountryCode } = require('../utils/searchCountry');

/**
 * GET /api/serp?q=vegan+cupcakes&refresh=false
 * Get full SERP analysis with difficulty score.
 */
router.get('/', async (req, res) => {
  const { q, refresh, country } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }

  try {
    const result = await serpService.getSERPAnalysis(q.trim(), {
      forceRefresh: refresh === 'true',
      country: normalizeCountryCode(country),
    });
    res.json(result);
  } catch (err) {
    console.error('[Route /serp] Error:', err.message);
    res.status(500).json({ error: 'SERP analysis failed.', details: err.message });
  }
});

/**
 * GET /api/serp/rankings
 * Get the latest rankings for all tracked keywords.
 */
router.get('/rankings', async (req, res) => {
  try {
    const rankings = await serpService.getLatestRankings();
    res.json(rankings);
  } catch (err) {
    console.error('[Route /serp/rankings] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch rankings.' });
  }
});

/**
 * GET /api/serp/rankings/:keywordId?days=30
 * Get ranking history for a specific keyword.
 */
router.get('/rankings/:keywordId', async (req, res) => {
  const { keywordId } = req.params;
  const days = parseInt(req.query.days, 10) || 30;

  try {
    const history = await serpService.getRankingHistory(keywordId, days);
    res.json(history);
  } catch (err) {
    console.error('[Route /serp/rankings/:id] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch ranking history.' });
  }
});

/**
 * POST /api/serp/track
 * Manually trigger rank tracking for a keyword.
 * Body: { keywordId, keyword, targetDomain }
 */
router.post('/track', async (req, res) => {
  const { keywordId, keyword, targetDomain } = req.body;

  if (!keywordId || !keyword || !targetDomain) {
    return res.status(400).json({
      error: 'keywordId, keyword, and targetDomain are required.',
    });
  }

  try {
    const result = await serpService.trackRanking(keywordId, keyword, targetDomain);
    res.json(result);
  } catch (err) {
    console.error('[Route /serp/track] Error:', err.message);
    res.status(500).json({ error: 'Rank tracking failed.', details: err.message });
  }
});

/**
 * GET /api/serp/providers
 * Get status of all configured SERP providers.
 */
router.get('/providers', async (req, res) => {
  try {
    const status = serpApiManager.getStatus();

    res.json({
      configured: status.configuredProviders,
      available: status.availableProviders.map(p => p.name),
      details: status.availableProviders,
    });
  } catch (err) {
    console.error('[Route /serp/providers] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch provider status.', details: err.message });
  }
});

module.exports = router;
