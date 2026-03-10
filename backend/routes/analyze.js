const express = require('express');
const router = express.Router();
const { serpService, contentAnalysisService } = require('../services');

/**
 * POST /api/analyze
 * Analyze content for SEO quality.
 *
 * Body: {
 *   keyword: string (required),
 *   text?: string,          // Raw article text
 *   url?: string,           // URL to fetch and analyze
 *   compareToSerp?: boolean // Compare against SERP competitor data
 * }
 */
router.post('/', async (req, res) => {
  const { keyword, text, url, compareToSerp } = req.body;

  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ error: 'Keyword is required.' });
  }

  if (!text && !url) {
    return res.status(400).json({ error: 'Either "text" or "url" must be provided.' });
  }

  try {
    let competitorData = null;

    // Optionally pull competitor data from SERP to find content gaps
    if (compareToSerp) {
      const serpAnalysis = await serpService.getSERPAnalysis(keyword.trim());

      if (serpAnalysis.averages) {
        // Extract common topics from competitor headings
        const allH2s = serpAnalysis.results
          .filter((r) => r.headings?.h2)
          .flatMap((r) => r.headings.h2);

        // Count topic frequency and keep the most common
        const topicCounts = {};
        for (const h2 of allH2s) {
          const normalized = h2.toLowerCase().trim();
          topicCounts[normalized] = (topicCounts[normalized] || 0) + 1;
        }

        const commonTopics = Object.entries(topicCounts)
          .filter(([, count]) => count >= 2)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([topic]) => topic);

        competitorData = {
          ...serpAnalysis.averages,
          commonTopics,
        };
      }
    }

    const result = await contentAnalysisService.analyzeAndStoreContent({
      text: text || undefined,
      url: url || undefined,
      keyword: keyword.trim(),
      compareToSerp: !!compareToSerp,
      competitorData,
    });

    res.json(result);
  } catch (err) {
    console.error('[Route /analyze] Error:', err.message);
    res.status(500).json({ error: 'Content analysis failed.', details: err.message });
  }
});

/**
 * GET /api/analyze/history?limit=10
 * Get recent saved content analyses.
 */
router.get('/history', async (req, res) => {
  try {
    const history = await contentAnalysisService.getContentAnalysisHistory(req.query.limit);
    res.json(history);
  } catch (err) {
    console.error('[Route /analyze/history] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch content analysis history.' });
  }
});

/**
 * GET /api/analyze/history/:id
 * Restore a saved content analysis.
 */
router.get('/history/:id', async (req, res) => {
  try {
    const item = await contentAnalysisService.getContentAnalysisHistoryItem(req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Content analysis history item not found.' });
    }

    res.json(item);
  } catch (err) {
    console.error('[Route /analyze/history/:id] Error:', err.message);
    res.status(500).json({ error: 'Failed to load content analysis history item.' });
  }
});

router.delete('/history/:id', async (req, res) => {
  try {
    await contentAnalysisService.deleteContentAnalysisHistoryItem(req.params.id);
    res.json({ message: 'Content analysis history item deleted.' });
  } catch (err) {
    console.error('[Route /analyze/history/:id DELETE] Error:', err.message);
    res.status(500).json({ error: 'Failed to delete content analysis history item.' });
  }
});

module.exports = router;
