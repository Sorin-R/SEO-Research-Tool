const express = require('express');
const { runSearch } = require('../search/searchService');
const { normalizeEngine, normalizeDomain } = require('../search/config');
const { serpApiManager } = require('../scrapers');

const router = express.Router();

router.get('/providers', async (_req, res) => {
  try {
    const status = await serpApiManager.getStatus();
    res.json({
      providers: status.availableProviders || [],
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || 'Failed to load search providers.',
    });
  }
});

/**
 * POST /api/search
 * Body: { keyword, engine, domain, location?, aiMode?, screenshotMode?, highAccuracyMode?, providerId?, strictMode?, verifyUrls?, debug? }
 */
router.post('/', async (req, res) => {
  const keyword = String(req.body?.keyword || '');
  const engine = normalizeEngine(req.body?.engine);
  const domain = normalizeDomain(req.body?.domain);
  const location = String(req.body?.location || '');
  const aiMode = req.body?.aiMode;
  const screenshotMode = req.body?.screenshotMode;
  const highAccuracyMode = req.body?.highAccuracyMode;
  const providerId = String(req.body?.providerId || '');
  const strictMode = req.body?.strictMode;
  const verifyUrls = req.body?.verifyUrls;
  const debug = req.body?.debug;

  if (!keyword.trim()) {
    return res.status(400).json({ error: 'keyword is required.' });
  }

  if (!engine) {
    return res.status(400).json({ error: 'engine must be "google" or "bing".' });
  }

  if (!domain) {
    return res.status(400).json({ error: 'domain must be "com" or "co.uk".' });
  }

  try {
    const result = await runSearch({
      keyword,
      engine,
      domain,
      location,
      aiMode,
      screenshotMode,
      highAccuracyMode,
      providerId,
      strictMode,
      verifyUrls,
      debug,
    });
    res.json(result);
  } catch (err) {
    const statusCode = Number(err?.statusCode) || 500;
    const payload = {
      error: err.message || 'Search failed.',
    };
    if (Array.isArray(err?.attempts)) {
      payload.attempts = err.attempts;
    }
    res.status(statusCode).json(payload);
  }
});

module.exports = router;
