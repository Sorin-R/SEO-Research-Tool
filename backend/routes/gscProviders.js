const express = require('express');
const router = express.Router();
const gscProviderManager = require('../services/gscProviderManager');

router.get('/', async (_req, res, next) => {
  try {
    const status = await gscProviderManager.getStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { enabled } = req.body || {};

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Boolean "enabled" field is required.' });
    }

    const updatedProvider = await gscProviderManager.toggleProvider(req.params.id, enabled);

    if (!updatedProvider) {
      return res.status(404).json({ error: `GSC provider "${req.params.id}" not found.` });
    }

    res.json(updatedProvider);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

router.patch('/:id/credentials', async (req, res, next) => {
  try {
    const { credentials } = req.body || {};

    if (!credentials || typeof credentials !== 'object' || Object.keys(credentials).length === 0) {
      return res.status(400).json({ error: 'A "credentials" object with at least one key-value pair is required.' });
    }

    const updatedProvider = await gscProviderManager.saveProviderCredentials(req.params.id, credentials);

    if (!updatedProvider) {
      return res.status(404).json({ error: `GSC provider "${req.params.id}" not found.` });
    }

    res.json(updatedProvider);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
