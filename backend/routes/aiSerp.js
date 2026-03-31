const express = require('express');
const { aiSerpWorkspaceService } = require('../services');

const router = express.Router();

function normalizeWebsiteId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

router.post('/run', async (req, res) => {
  try {
    const result = await aiSerpWorkspaceService.runAiSerpWorkspaceScan({
      websiteId: normalizeWebsiteId(req.body?.websiteId),
      keywords: req.body?.keywords || [],
      providers: req.body?.providers || [],
      location: req.body?.location,
      maxKeywords: req.body?.maxKeywords,
    });

    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to run AI SERP workspace scan.',
    });
  }
});

router.get('/history', async (req, res) => {
  try {
    const rows = await aiSerpWorkspaceService.getHistory(
      normalizeWebsiteId(req.query.websiteId),
      req.query.limit
    );
    res.json(rows);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to fetch AI SERP history.',
    });
  }
});

router.get('/history/:id', async (req, res) => {
  try {
    const item = await aiSerpWorkspaceService.getHistoryItem(
      req.params.id,
      normalizeWebsiteId(req.query.websiteId)
    );

    if (!item) {
      return res.status(404).json({ error: 'AI SERP history item not found.' });
    }

    res.json(item);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to fetch AI SERP history item.',
    });
  }
});

module.exports = router;
