const express = require('express');
const router = express.Router();
const { trendService } = require('../services');

/**
 * GET /api/trends?q=vegan+cupcakes&geo=US
 * Get Google Trends interest-over-time data.
 */
router.get('/', async (req, res) => {
  const { q, geo, months } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }

  try {
    const monthsBack = parseInt(months, 10) || 12;
    const startTime = new Date(Date.now() - monthsBack * 30 * 24 * 60 * 60 * 1000);

    const result = await trendService.getInterestOverTime(q.trim(), {
      geo: geo || '',
      startTime,
    });

    res.json(result);
  } catch (err) {
    console.error('[Route /trends] Error:', err.message);
    res.status(500).json({ error: 'Trends fetch failed.', details: err.message });
  }
});

/**
 * GET /api/trends/related?q=vegan+cupcakes&geo=US
 * Get related queries (top and rising).
 */
router.get('/related', async (req, res) => {
  const { q, geo } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }

  try {
    const result = await trendService.getRelatedQueries(q.trim(), {
      geo: geo || '',
    });
    res.json(result);
  } catch (err) {
    console.error('[Route /trends/related] Error:', err.message);
    res.status(500).json({ error: 'Related queries fetch failed.', details: err.message });
  }
});

/**
 * GET /api/trends/topics?q=vegan+cupcakes
 * Get related topics.
 */
router.get('/topics', async (req, res) => {
  const { q, geo } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }

  try {
    const result = await trendService.getRelatedTopics(q.trim(), {
      geo: geo || '',
    });
    res.json(result);
  } catch (err) {
    console.error('[Route /trends/topics] Error:', err.message);
    res.status(500).json({ error: 'Related topics fetch failed.', details: err.message });
  }
});

/**
 * GET /api/trends/compare?keywords=keyword1,keyword2,keyword3
 * Compare interest between multiple keywords (max 5).
 */
router.get('/compare', async (req, res) => {
  const { keywords, geo, months } = req.query;

  if (!keywords) {
    return res.status(400).json({ error: 'Comma-separated "keywords" parameter is required.' });
  }

  const keywordList = keywords.split(',').map((k) => k.trim()).filter(Boolean);

  if (keywordList.length < 2 || keywordList.length > 5) {
    return res.status(400).json({ error: 'Provide 2-5 keywords for comparison.' });
  }

  try {
    const monthsBack = parseInt(months, 10) || 12;
    const startTime = new Date(Date.now() - monthsBack * 30 * 24 * 60 * 60 * 1000);

    const result = await trendService.compareKeywords(keywordList, {
      geo: geo || '',
      startTime,
    });

    res.json(result);
  } catch (err) {
    console.error('[Route /trends/compare] Error:', err.message);
    res.status(500).json({ error: 'Trends comparison failed.', details: err.message });
  }
});

module.exports = router;
