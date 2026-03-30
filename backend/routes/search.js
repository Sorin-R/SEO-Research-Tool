const express = require('express');
const { runSearch } = require('../search/searchService');
const { normalizeEngine, normalizeDomain } = require('../search/config');

const router = express.Router();

/**
 * POST /api/search
 * Body: { keyword, engine, domain, location? }
 */
router.post('/', async (req, res) => {
  const keyword = String(req.body?.keyword || '');
  const engine = normalizeEngine(req.body?.engine);
  const domain = normalizeDomain(req.body?.domain);
  const location = String(req.body?.location || '');

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
    });
    res.json(result);
  } catch (err) {
    const statusCode = Number(err?.statusCode) || 500;
    res.status(statusCode).json({
      error: err.message || 'Search failed.',
    });
  }
});

module.exports = router;
