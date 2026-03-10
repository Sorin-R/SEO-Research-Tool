const express = require('express');
const router = express.Router();
const { siteAuditService } = require('../services');

router.post('/', async (req, res) => {
  const { url, maxPages } = req.body || {};

  if (!url || !String(url).trim()) {
    return res.status(400).json({ error: 'Site URL is required.' });
  }

  try {
    const result = await siteAuditService.analyzeAndStoreSiteAudit({
      url: String(url).trim(),
      maxPages,
    });

    res.json(result);
  } catch (err) {
    console.error('[Route /site-audit] Error:', err.message);
    res.status(500).json({ error: 'Site audit failed.', details: err.message });
  }
});

router.get('/history', async (req, res) => {
  try {
    const history = await siteAuditService.getSiteAuditHistory(req.query.limit);
    res.json(history);
  } catch (err) {
    console.error('[Route /site-audit/history] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch site audit history.' });
  }
});

router.get('/history/:id', async (req, res) => {
  try {
    const item = await siteAuditService.getSiteAuditHistoryItem(req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Site audit history item not found.' });
    }

    res.json(item);
  } catch (err) {
    console.error('[Route /site-audit/history/:id] Error:', err.message);
    res.status(500).json({ error: 'Failed to load site audit history item.' });
  }
});

router.delete('/history/:id', async (req, res) => {
  try {
    await siteAuditService.deleteSiteAuditHistoryItem(req.params.id);
    res.json({ message: 'Site audit history item deleted.' });
  } catch (err) {
    console.error('[Route /site-audit/history/:id DELETE] Error:', err.message);
    res.status(500).json({ error: 'Failed to delete site audit history item.' });
  }
});

module.exports = router;
