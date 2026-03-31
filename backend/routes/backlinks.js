const express = require('express');
const { backlinkService } = require('../services');

const router = express.Router();

function normalizeWebsiteId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

router.post('/scan', async (req, res) => {
  try {
    const result = await backlinkService.runBacklinkScan({
      websiteId: normalizeWebsiteId(req.body?.websiteId),
      country: req.body?.country || 'US',
      maxSources: req.body?.maxSources,
    });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to run backlink scan.',
    });
  }
});

router.get('/latest', async (req, res) => {
  try {
    const result = await backlinkService.getLatestBacklinkSnapshot(
      normalizeWebsiteId(req.query.websiteId)
    );
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to get latest backlink snapshot.',
    });
  }
});

router.get('/history', async (req, res) => {
  try {
    const rows = await backlinkService.getBacklinkHistory(
      normalizeWebsiteId(req.query.websiteId),
      req.query.limit
    );
    res.json(rows);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to get backlink history.',
    });
  }
});

module.exports = router;

