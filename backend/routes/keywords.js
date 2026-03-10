const express = require('express');
const router = express.Router();
const { keywordService } = require('../services');

/**
 * GET /api/keywords?q=vegan+cupcakes&expand=false
 * Research a keyword: autocomplete suggestions, PAA questions, categorized results.
 */
router.get('/', async (req, res) => {
  const { q, expand, country, includeTerms, excludeTerms, modifierTerms, minWords, maxWords, questionsOnly, brandedMode } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }

  try {
    const result = await keywordService.researchKeyword(q.trim(), {
      expand: expand === 'true',
      country,
      includeTerms,
      excludeTerms,
      modifierTerms,
      minWords,
      maxWords,
      questionsOnly,
      brandedMode,
    });
    res.json(result);
  } catch (err) {
    console.error('[Route /keywords] Error:', err.message);
    res.status(500).json({ error: 'Keyword research failed.', details: err.message });
  }
});

router.post('/research', async (req, res) => {
  const { keyword, options } = req.body || {};

  if (!keyword || !String(keyword).trim()) {
    return res.status(400).json({ error: 'Keyword is required.' });
  }

  try {
    const result = await keywordService.researchKeyword(String(keyword).trim(), options || {});
    res.json(result);
  } catch (err) {
    console.error('[Route /keywords/research] Error:', err.message);
    res.status(500).json({ error: 'Keyword research failed.', details: err.message });
  }
});

/**
 * POST /api/keywords/filter
 * AI-filter a keyword list using the seed keyword and a custom prompt.
 * Body: { keyword, keywords, prompt?, maxResults? }
 */
router.post('/filter', async (req, res) => {
  const { keyword, keywords, prompt, maxResults } = req.body || {};

  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ error: 'Seed keyword is required.' });
  }

  if (!Array.isArray(keywords) || keywords.length === 0) {
    return res.status(400).json({ error: 'A keywords array is required.' });
  }

  try {
    const result = await keywordService.filterKeywordsWithAI({
      seedKeyword: keyword.trim(),
      keywords,
      prompt,
      maxResults,
    });
    res.json(result);
  } catch (err) {
    console.error('[Route /keywords/filter] Error:', err.message);
    res.status(err.statusCode || 500).json({
      error: err.message || 'AI keyword filtering failed.',
    });
  }
});

/**
 * GET /api/keywords/history?limit=10
 * Get recent saved keyword research runs.
 */
router.get('/history', async (req, res) => {
  try {
    const history = await keywordService.getKeywordResearchHistory(req.query.limit);
    res.json(history);
  } catch (err) {
    console.error('[Route /keywords/history] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch keyword research history.' });
  }
});

/**
 * GET /api/keywords/history/:id
 * Restore a saved keyword research result.
 */
router.get('/history/:id', async (req, res) => {
  try {
    const item = await keywordService.getKeywordResearchHistoryItem(req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Keyword research history item not found.' });
    }

    res.json(item);
  } catch (err) {
    console.error('[Route /keywords/history/:id] Error:', err.message);
    res.status(500).json({ error: 'Failed to load keyword research history item.' });
  }
});

router.delete('/history/:id', async (req, res) => {
  try {
    await keywordService.deleteKeywordResearchHistoryItem(req.params.id);
    res.json({ message: 'Keyword research history item deleted.' });
  } catch (err) {
    console.error('[Route /keywords/history/:id DELETE] Error:', err.message);
    res.status(500).json({ error: 'Failed to delete keyword research history item.' });
  }
});

router.get('/lists', async (req, res) => {
  try {
    const lists = await keywordService.getKeywordLists();
    res.json(lists);
  } catch (err) {
    console.error('[Route /keywords/lists] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch keyword lists.' });
  }
});

router.post('/lists', async (req, res) => {
  try {
    const list = await keywordService.createKeywordList(req.body?.name);
    res.json(list);
  } catch (err) {
    console.error('[Route /keywords/lists POST] Error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to create keyword list.' });
  }
});

router.post('/lists/:id/items', async (req, res) => {
  try {
    const list = await keywordService.addKeywordsToList(req.params.id, req.body?.items);
    res.json(list);
  } catch (err) {
    console.error('[Route /keywords/lists/:id/items POST] Error:', err.message);
    res.status(err.message === 'Keyword list not found.' ? 404 : 400).json({
      error: err.message || 'Failed to add keywords to list.',
    });
  }
});

router.delete('/lists/:id', async (req, res) => {
  try {
    await keywordService.deleteKeywordList(req.params.id);
    res.json({ message: 'Keyword list deleted.' });
  } catch (err) {
    console.error('[Route /keywords/lists/:id DELETE] Error:', err.message);
    res.status(500).json({ error: 'Failed to delete keyword list.' });
  }
});

router.delete('/lists/:listId/items/:itemId', async (req, res) => {
  try {
    await keywordService.deleteKeywordListItem(req.params.listId, req.params.itemId);
    res.json({ message: 'Keyword list item deleted.' });
  } catch (err) {
    console.error('[Route /keywords/lists/:listId/items/:itemId DELETE] Error:', err.message);
    res.status(err.message === 'Keyword list not found.' ? 404 : 500).json({
      error: err.message || 'Failed to delete keyword list item.',
    });
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
