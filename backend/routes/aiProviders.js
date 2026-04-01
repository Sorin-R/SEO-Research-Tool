/**
 * AI Providers API Routes
 *
 * GET    /api/ai-providers              - List all AI providers with status
 * PATCH  /api/ai-providers/:id          - Toggle provider enabled/disabled
 * PATCH  /api/ai-providers/:id/credentials - Save provider credentials
 */

const express = require('express');
const router = express.Router();
const aiProviderManager = require('../services/aiProviderManager');

// GET /api/ai-providers — List all providers with status
router.get('/', async (req, res, next) => {
  try {
    const status = await aiProviderManager.getStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/ai-providers/:id — Toggle enabled/disabled
router.patch('/:id', async (req, res, next) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Boolean "enabled" field is required.' });
    }

    const updatedProvider = await aiProviderManager.toggleProvider(req.params.id, enabled);

    if (!updatedProvider) {
      return res.status(404).json({ error: `AI provider "${req.params.id}" not found.` });
    }

    res.json(updatedProvider);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

// PATCH /api/ai-providers/:id/credentials — Save credentials
router.patch('/:id/credentials', async (req, res, next) => {
  try {
    const { credentials } = req.body;

    if (!credentials || typeof credentials !== 'object' || Object.keys(credentials).length === 0) {
      return res.status(400).json({ error: 'A "credentials" object with at least one key-value pair is required.' });
    }

    const updatedProvider = await aiProviderManager.saveProviderCredentials(req.params.id, credentials);

    if (!updatedProvider) {
      return res.status(404).json({ error: `AI provider "${req.params.id}" not found.` });
    }

    res.json(updatedProvider);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

// PATCH /api/ai-providers/:id/model — Select model
router.patch('/:id/model', async (req, res, next) => {
  try {
    const { model } = req.body || {};

    if (!model || !String(model).trim()) {
      return res.status(400).json({ error: 'A non-empty "model" value is required.' });
    }

    const updatedProvider = await aiProviderManager.updateProviderModel(req.params.id, model);

    if (!updatedProvider) {
      return res.status(404).json({ error: `AI provider "${req.params.id}" not found.` });
    }

    res.json(updatedProvider);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/ai-providers/:id/test — Test provider with selected model
router.post('/:id/test', async (req, res, next) => {
  try {
    const result = await aiProviderManager.testProviderConnection(req.params.id);
    res.json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
