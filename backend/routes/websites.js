const express = require('express');
const router = express.Router();
const { websiteService } = require('../services');

router.get('/', async (req, res) => {
  try {
    const websites = await websiteService.getWebsites({
      includeArchived: req.query.includeArchived,
      archivedOnly: req.query.archivedOnly,
      search: req.query.search,
      tag: req.query.tag,
    });
    res.json(websites);
  } catch (err) {
    console.error('[Route /websites] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch websites.' });
  }
});

router.post('/', async (req, res) => {
  const { domain, name, projectName, country, tags, gscSiteUrl } = req.body || {};

  if (!domain || !String(domain).trim()) {
    return res.status(400).json({ error: 'Website domain is required.' });
  }

  try {
    const website = await websiteService.createWebsite({
      domain,
      name,
      projectName,
      country,
      tags,
      gscSiteUrl,
      isActive: true,
      archived: false,
    });
    res.status(201).json(website);
  } catch (err) {
    console.error('[Route /websites POST] Error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create website.' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const website = await websiteService.updateWebsite(req.params.id, req.body || {});
    res.json(website);
  } catch (err) {
    console.error('[Route /websites/:id PATCH] Error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update website.' });
  }
});

router.post('/:id/archive', async (req, res) => {
  const archived = req.body?.archived !== false;

  try {
    const website = await websiteService.archiveWebsite(req.params.id, archived);
    res.json(website);
  } catch (err) {
    console.error('[Route /websites/:id/archive POST] Error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to archive website.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await websiteService.deleteWebsite(req.params.id);
    res.json({ message: 'Website deleted.' });
  } catch (err) {
    console.error('[Route /websites/:id DELETE] Error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to delete website.' });
  }
});

module.exports = router;
