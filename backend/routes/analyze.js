const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const router = express.Router();
const { serpService, contentAnalysisService, aiProviderManager } = require('../services');

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

function isDesktopRuntime() {
  return Boolean(String(process.env.DESKTOP_ENV_PATH || '').trim());
}

function extractJsonObject(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // continue
    }
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function requireAbsoluteFilePath(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  if (!path.isAbsolute(normalized)) {
    throw new Error(`${fieldName} must be an absolute path.`);
  }

  return normalized;
}

async function readTextFileSafe(filePath, fieldName) {
  if (!filePath) {
    return null;
  }

  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`${fieldName} is not a file.`);
  }

  if (stat.size > MAX_TEXT_FILE_BYTES) {
    throw new Error(`${fieldName} is too large. Limit is ${Math.floor(MAX_TEXT_FILE_BYTES / (1024 * 1024))}MB.`);
  }

  const content = await fs.readFile(filePath, 'utf8');
  if (content.includes('\u0000')) {
    throw new Error(`${fieldName} looks like a binary file and cannot be edited as text.`);
  }

  return content;
}

/**
 * POST /api/analyze
 * Analyze content for SEO quality.
 *
 * Body: {
 *   keyword: string (required),
 *   text?: string,          // Raw article text
 *   url?: string,           // URL to fetch and analyze
 *   title?: string,         // Optional manual SEO title
 *   metaDescription?: string, // Optional manual meta description
 *   compareToSerp?: boolean // Compare against SERP competitor data
 * }
 */
router.post('/', async (req, res) => {
  const { keyword, text, url, title, metaDescription, compareToSerp, websiteId } = req.body;

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
      title: title?.trim() || undefined,
      metaDescription: metaDescription?.trim() || undefined,
      compareToSerp: !!compareToSerp,
      competitorData,
      websiteId,
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
    const history = await contentAnalysisService.getContentAnalysisHistory(req.query.limit, req.query.websiteId);
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
    const item = await contentAnalysisService.getContentAnalysisHistoryItem(req.params.id, req.query.websiteId);

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
    await contentAnalysisService.deleteContentAnalysisHistoryItem(req.params.id, req.query.websiteId);
    res.json({ message: 'Content analysis history item deleted.' });
  } catch (err) {
    console.error('[Route /analyze/history/:id DELETE] Error:', err.message);
    res.status(500).json({ error: 'Failed to delete content analysis history item.' });
  }
});

/**
 * POST /api/analyze/ai-chat
 * Use AI provider chat with optional desktop page/report file access.
 */
router.post('/ai-chat', async (req, res) => {
  const {
    message,
    providerId,
    pagePath,
    reportPath,
    reportMarkdown,
    applyChanges,
  } = req.body || {};

  const userMessage = String(message || '').trim();
  if (!userMessage) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  try {
    const normalizedPagePath = requireAbsoluteFilePath(pagePath, 'pagePath');
    const normalizedReportPath = requireAbsoluteFilePath(reportPath, 'reportPath');
    const shouldApplyChanges = applyChanges === true;

    if ((normalizedPagePath || normalizedReportPath) && !isDesktopRuntime()) {
      return res.status(400).json({
        error: 'Local file path access is available only in desktop runtime.',
      });
    }

    const pageContent = normalizedPagePath
      ? await readTextFileSafe(normalizedPagePath, 'pagePath')
      : null;
    const reportFromPath = normalizedReportPath
      ? await readTextFileSafe(normalizedReportPath, 'reportPath')
      : null;
    const reportContent = String(reportMarkdown || '').trim() || reportFromPath || '';

    const systemPrompt = [
      'You are an SEO implementation assistant editing page content.',
      'You can use the provided page file content and SEO report markdown.',
      'Return strict JSON only with this schema:',
      '{',
      '  "assistantReply": "short response for the user",',
      '  "changeSummary": ["what changed"],',
      '  "updatedPageContent": "full updated page content; return original if no change needed"',
      '}',
      'Rules:',
      '- Preserve the page structure and keep valid markup.',
      '- Focus on SEO title/meta/content improvements and readability.',
      '- If information is missing, explain in assistantReply and keep content safe.',
      '- Output valid JSON only.',
    ].join('\n');

    const promptPayload = {
      request: userMessage,
      hasPagePath: Boolean(normalizedPagePath),
      pagePath: normalizedPagePath || null,
      pageContent: pageContent || null,
      hasReport: Boolean(reportContent),
      reportPath: normalizedReportPath || null,
      reportMarkdown: reportContent || null,
      applyChanges: shouldApplyChanges,
    };

    const completion = await aiProviderManager.runProviderPrompt({
      providerId: String(providerId || '').trim() || null,
      systemPrompt,
      userPrompt: JSON.stringify(promptPayload, null, 2),
      maxTokens: 2600,
      temperature: 0.2,
    });

    const rawText = String(completion?.text || '').trim();
    const parsed = extractJsonObject(rawText);
    const assistantReply = String(parsed?.assistantReply || rawText || 'No reply.').trim();
    const changeSummary = Array.isArray(parsed?.changeSummary)
      ? parsed.changeSummary.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const updatedPageContent = typeof parsed?.updatedPageContent === 'string'
      ? parsed.updatedPageContent
      : null;

    let applied = false;
    let backupPath = null;
    let applyWarning = null;

    if (shouldApplyChanges) {
      if (!normalizedPagePath) {
        applyWarning = 'applyChanges=true but no pagePath was provided.';
      } else if (!updatedPageContent) {
        applyWarning = 'AI response did not include "updatedPageContent"; no file changes were written.';
      } else if (typeof pageContent === 'string' && updatedPageContent !== pageContent) {
        backupPath = `${normalizedPagePath}.bak-${Date.now()}`;
        await fs.writeFile(backupPath, pageContent, 'utf8');
        await fs.writeFile(normalizedPagePath, updatedPageContent, 'utf8');
        applied = true;
      } else {
        applyWarning = 'No file changes were necessary.';
      }
    }

    res.json({
      providerId: completion.providerId,
      providerName: completion.providerName,
      model: completion.model,
      assistantReply,
      changeSummary,
      pagePath: normalizedPagePath,
      reportPath: normalizedReportPath,
      applied,
      backupPath,
      applyWarning,
      warning: completion.warning || null,
      updatedPageContentPreview: updatedPageContent ? updatedPageContent.slice(0, 4000) : null,
    });
  } catch (err) {
    console.error('[Route /analyze/ai-chat] Error:', err.message);
    res.status(500).json({ error: err.message || 'AI chat request failed.' });
  }
});

module.exports = router;
