const express = require('express');
const router = express.Router();
const { serpService, websiteService } = require('../services');
const rankTrackerSettingsService = require('../services/rankTrackerSettingsService');
const { rescheduleRankTrackerScheduler } = require('../services/rankTrackerScheduler');
const { serpApiManager } = require('../scrapers');
const { normalizeCountryCode } = require('../utils/searchCountry');

/**
 * GET /api/serp?q=vegan+cupcakes&refresh=false
 * Get full SERP analysis with difficulty score.
 */
router.get('/', async (req, res) => {
  const { q, refresh, country, syncTrackedRankings } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }

  try {
    const normalizedCountry = normalizeCountryCode(country);
    const result = await serpService.getSERPAnalysis(q.trim(), {
      forceRefresh: refresh === 'true',
      country: normalizedCountry,
    });

    if (syncTrackedRankings !== 'false') {
      result.rankTrackerSync = await serpService.syncTrackedRankingsFromResults(
        result.keyword,
        result.results || [],
        normalizedCountry
      );
    }

    res.json(result);
  } catch (err) {
    console.error('[Route /serp] Error:', err.message);
    res.status(500).json({ error: 'SERP analysis failed.', details: err.message });
  }
});

router.get('/schedule', async (_req, res) => {
  try {
    const settings = await rankTrackerSettingsService.getRankTrackerSchedule();
    res.json(settings);
  } catch (err) {
    console.error('[Route /serp/schedule GET] Error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to load rank tracker schedule.' });
  }
});

router.patch('/schedule', async (req, res) => {
  const { scheduleTime } = req.body || {};

  try {
    const settings = await rescheduleRankTrackerScheduler(scheduleTime);
    res.json(settings);
  } catch (err) {
    console.error('[Route /serp/schedule PATCH] Error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update rank tracker schedule.' });
  }
});

/**
 * GET /api/serp/history?limit=10
 * Get recent saved SERP analyses.
 */
router.get('/history', async (req, res) => {
  try {
    const history = await serpService.getSERPAnalysisHistory(req.query.limit);
    res.json(history);
  } catch (err) {
    console.error('[Route /serp/history] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch SERP analysis history.' });
  }
});

/**
 * GET /api/serp/history/:id
 * Restore a saved SERP analysis result.
 */
router.get('/history/:id', async (req, res) => {
  try {
    const item = await serpService.getSERPAnalysisHistoryItem(req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'SERP analysis history item not found.' });
    }

    res.json(item);
  } catch (err) {
    console.error('[Route /serp/history/:id] Error:', err.message);
    res.status(500).json({ error: 'Failed to load SERP analysis history item.' });
  }
});

router.delete('/history/:id', async (req, res) => {
  try {
    await serpService.deleteSERPAnalysisHistoryItem(req.params.id);
    res.json({ message: 'SERP analysis history item deleted.' });
  } catch (err) {
    console.error('[Route /serp/history/:id DELETE] Error:', err.message);
    res.status(500).json({ error: 'Failed to delete SERP analysis history item.' });
  }
});

/**
 * GET /api/serp/rankings
 * Get the latest rankings for all tracked keywords.
 */
router.get('/rankings', async (req, res) => {
  try {
    const rankings = await serpService.getLatestRankings(req.query.websiteId || null);
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
    const history = await serpService.getRankingHistory(keywordId, days, req.query.websiteId || null);
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
  const { keywordId, keyword, websiteId, targetDomain, country } = req.body;

  if (!keywordId || !keyword) {
    return res.status(400).json({
      error: 'keywordId and keyword are required.',
    });
  }

  try {
    let resolvedTargetDomain = targetDomain;
    let resolvedCountry = normalizeCountryCode(country);

    if (!resolvedTargetDomain && websiteId) {
      const website = await websiteService.getWebsiteById(websiteId);

      if (!website) {
        return res.status(404).json({ error: 'Website not found.' });
      }

      resolvedTargetDomain = website.target_url || website.domain;
      resolvedCountry = normalizeCountryCode(website.country);
    }

    if (!resolvedTargetDomain) {
      return res.status(400).json({
        error: 'websiteId or targetDomain is required.',
      });
    }

    const result = await serpService.trackRanking(
      keywordId,
      keyword,
      resolvedTargetDomain,
      websiteId || null,
      resolvedCountry
    );
    res.json(result);
  } catch (err) {
    console.error('[Route /serp/track] Error:', err.message);
    res.status(500).json({ error: 'Rank tracking failed.', details: err.message });
  }
});

router.get('/websites', async (_req, res) => {
  try {
    const websites = await websiteService.getWebsites();
    res.json(websites);
  } catch (err) {
    console.error('[Route /serp/websites] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tracked websites.' });
  }
});

router.post('/websites', async (req, res) => {
  const { name, domain, country } = req.body || {};

  if (!domain || !String(domain).trim()) {
    return res.status(400).json({ error: 'Website domain is required.' });
  }

  try {
    const website = await websiteService.createWebsite({ name, domain, country, isActive: true });
    res.status(201).json(website);
  } catch (err) {
    console.error('[Route /serp/websites POST] Error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create website.' });
  }
});

router.patch('/websites/:id', async (req, res) => {
  const { name, domain, country, isActive } = req.body || {};

  try {
    const website = await websiteService.updateWebsite(req.params.id, {
      name,
      domain,
      country,
      isActive,
    });
    res.json(website);
  } catch (err) {
    console.error('[Route /serp/websites/:id PATCH] Error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update website.' });
  }
});

router.delete('/websites/:id', async (req, res) => {
  try {
    await websiteService.deleteWebsite(req.params.id);
    res.json({ message: 'Website deleted.' });
  } catch (err) {
    console.error('[Route /serp/websites/:id DELETE] Error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to delete website.' });
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
