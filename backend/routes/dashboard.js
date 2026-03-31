const express = require('express');
const router = express.Router();
const { getSerpDashboardModule } = require('../services/serpDashboardService');
const { getAiVisibilityDashboardModule } = require('../services/aiVisibilityDashboardService');
const { gscProviderManager, websiteService, backlinkService } = require('../services');

function normalizeWebsiteId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

router.get('/serp', async (req, res) => {
  try {
    const moduleData = await getSerpDashboardModule({
      websiteId: req.query.websiteId,
      country: req.query.country || 'US',
      refresh: req.query.refresh === 'true',
    });
    res.json(moduleData);
  } catch (err) {
    console.error('[Route /dashboard/serp] Error:', err.message);
    res.status(500).json({
      error: 'Failed to build SERP dashboard module.',
      details: err.message,
    });
  }
});

router.get('/ai-visibility', async (req, res) => {
  try {
    const moduleData = await getAiVisibilityDashboardModule({
      websiteId: req.query.websiteId,
      country: req.query.country || 'US',
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
    });
    res.json(moduleData);
  } catch (err) {
    console.error('[Route /dashboard/ai-visibility] Error:', err.message);
    res.status(500).json({
      error: 'Failed to build AI Visibility dashboard module.',
      details: err.message,
    });
  }
});

router.get('/traffic', async (req, res) => {
  try {
    const websiteId = normalizeWebsiteId(req.query.websiteId);
    if (!websiteId) {
      return res.json({
        available: false,
        source: 'estimate',
        reason: 'website-required',
      });
    }

    const website = await websiteService.getWebsiteById(websiteId);
    if (!website) {
      return res.json({
        available: false,
        source: 'estimate',
        reason: 'website-not-found',
      });
    }

    const siteUrl = String(website.gsc_site_url || website.gscSiteUrl || '').trim();
    if (!siteUrl) {
      return res.json({
        available: false,
        source: 'estimate',
        reason: 'missing-website-gsc-site-url',
      });
    }

    const summary = await gscProviderManager.getOrganicTrafficSummary({
      siteUrl,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      country: req.query.country || null,
    });

    res.json({
      available: true,
      ...summary,
    });
  } catch (err) {
    const message = err.statusCode && err.statusCode < 500
      ? err.message
      : 'GSC traffic not available.';

    res.json({
      available: false,
      source: 'estimate',
      reason: 'gsc-unavailable',
      message,
    });
  }
});

router.get('/backlinks', async (req, res) => {
  try {
    const moduleData = await backlinkService.getDashboardBacklinksModule({
      websiteId: normalizeWebsiteId(req.query.websiteId),
      country: req.query.country || 'US',
      refresh: req.query.refresh === 'true',
    });
    res.json(moduleData);
  } catch (err) {
    console.error('[Route /dashboard/backlinks] Error:', err.message);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to build backlinks dashboard module.',
    });
  }
});

module.exports = router;
