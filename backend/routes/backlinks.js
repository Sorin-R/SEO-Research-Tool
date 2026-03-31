const express = require('express');
const { backlinkService, backlinkProviderManager } = require('../services');

const router = express.Router();

function normalizeWebsiteId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

router.get('/providers', async (_req, res, next) => {
  try {
    const status = await backlinkProviderManager.getStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

router.patch('/providers/:id', async (req, res, next) => {
  try {
    const { enabled } = req.body || {};

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Boolean "enabled" field is required.' });
    }

    const updatedProvider = await backlinkProviderManager.toggleProvider(req.params.id, enabled);

    if (!updatedProvider) {
      return res.status(404).json({ error: `Backlink provider "${req.params.id}" not found.` });
    }

    res.json(updatedProvider);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

router.patch('/providers/:id/credentials', async (req, res, next) => {
  try {
    const { credentials } = req.body || {};

    if (!credentials || typeof credentials !== 'object' || Object.keys(credentials).length === 0) {
      return res.status(400).json({ error: 'A "credentials" object with at least one key-value pair is required.' });
    }

    const updatedProvider = await backlinkProviderManager.saveProviderCredentials(req.params.id, credentials);

    if (!updatedProvider) {
      return res.status(404).json({ error: `Backlink provider "${req.params.id}" not found.` });
    }

    res.json(updatedProvider);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

router.post('/scan', async (req, res) => {
  try {
    const result = await backlinkService.runBacklinkScan({
      websiteId: normalizeWebsiteId(req.body?.websiteId),
      country: req.body?.country || 'US',
      maxBacklinks: req.body?.maxBacklinks,
      includeSubdomains: req.body?.includeSubdomains,
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
