const express = require('express');
const router = express.Router();
const { keywordService } = require('../services');

/**
 * GET /api/keywords?q=vegan+cupcakes&expand=false
 * Research a keyword: autocomplete suggestions, PAA questions, categorized results.
 */
router.get('/', async (req, res) => {
  const { q, expand } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }

  try {
    const result = await keywordService.researchKeyword(q.trim(), {
      expand: expand === 'true',
    });
    res.json(result);
  } catch (err) {
    console.error('[Route /keywords] Error:', err.message);
    res.status(500).json({ error: 'Keyword research failed.', details: err.message });
  }
});

/**
 * GET /api/keywords/tracked
 * Get all tracked keywords from the database.
 */
router.get('/tracked', async (req, res) => {
  try {
    const keywords = await keywordService.getTrackedKeywords();
    res.json(keywords);
  } catch (err) {
    console.error('[Route /keywords/tracked] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tracked keywords.' });
  }
});

/**
 * POST /api/keywords/track
 * Add a keyword to the tracking list.
 * Body: { keyword, difficulty?, searchVolume? }
 */
router.post('/track', async (req, res) => {
  const { keyword, difficulty, searchVolume } = req.body;

  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ error: 'Keyword is required.' });
  }

  try {
    await keywordService.saveKeyword(keyword.trim(), difficulty, searchVolume);
    res.json({ message: 'Keyword tracked successfully.', keyword: keyword.trim() });
  } catch (err) {
    console.error('[Route /keywords/track] Error:', err.message);
    res.status(500).json({ error: 'Failed to track keyword.' });
  }
});

/**
 * DELETE /api/keywords/tracked/:id
 * Remove a keyword from tracking.
 */
router.delete('/tracked/:id', async (req, res) => {
  try {
    await keywordService.deleteKeyword(req.params.id);
    res.json({ message: 'Keyword removed from tracking.' });
  } catch (err) {
    console.error('[Route /keywords/tracked/:id] Error:', err.message);
    res.status(500).json({ error: 'Failed to delete keyword.' });
  }
});

module.exports = router;
