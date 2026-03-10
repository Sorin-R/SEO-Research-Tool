const express = require('express');
const router = express.Router();
const { analyzeContent } = require('../analyzers/contentAnalyzer');
const { serpService } = require('../services');

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

    const result = await analyzeContent({
      text: text || undefined,
      url: url || undefined,
      keyword: keyword.trim(),
      competitorData,
    });

    res.json(result);
  } catch (err) {
    console.error('[Route /analyze] Error:', err.message);
    res.status(500).json({ error: 'Content analysis failed.', details: err.message });
  }
});

module.exports = router;
