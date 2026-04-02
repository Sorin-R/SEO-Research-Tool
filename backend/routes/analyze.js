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

function normalizeLineEndings(value) {
  return String(value || '').replace(/\r\n/g, '\n');
}

function extractLongestCodeBlock(text) {
  const input = String(text || '');
  const matches = [...input.matchAll(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g)];
  if (!matches.length) {
    return '';
  }

  return matches
    .map((entry) => String(entry?.[1] || ''))
    .sort((left, right) => right.length - left.length)[0]
    .trim();
}

function extractUpdatedPageContentFromPayload(payload, rawText) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const directCandidates = [
    source.updatedPageContent,
    source.updated_page_content,
    source.updatedContent,
    source.updated_content,
    source.pageContent,
    source.page_content,
    source.updatedHtml,
    source.updated_html,
    source.html,
    source.content,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return normalizeLineEndings(candidate);
    }
  }

  if (source.result && typeof source.result === 'object') {
    const nested = extractUpdatedPageContentFromPayload(source.result, rawText);
    if (nested) {
      return nested;
    }
  }

  const codeBlock = extractLongestCodeBlock(rawText);
  if (codeBlock) {
    return normalizeLineEndings(codeBlock);
  }

  return '';
}

async function retryForUpdatedPageContent({
  providerId,
  originalRequest,
  originalPageContent,
  reportContent,
  previousRawOutput,
}) {
  const systemPrompt = [
    'You are formatting output for a content update pipeline.',
    'Return strict JSON only with exactly these keys:',
    '{ "assistantReply": "...", "changeSummary": ["..."], "updatedPageContent": "..." }',
    'Rules:',
    '- updatedPageContent MUST contain the full final page content.',
    '- If prior output is unusable, rewrite from the original page content + report.',
    '- No markdown fences, no explanations, JSON only.',
  ].join('\n');

  const userPrompt = JSON.stringify(
    {
      request: originalRequest,
      previousModelOutput: previousRawOutput,
      originalPageContent,
      reportMarkdown: reportContent,
    },
    null,
    2
  );

  const repaired = await aiProviderManager.runProviderPrompt({
    providerId: String(providerId || '').trim() || null,
    systemPrompt,
    userPrompt,
    maxTokens: 3200,
    temperature: 0.1,
  });

  const rawText = String(repaired?.text || '').trim();
  const parsed = extractJsonObject(rawText);
  const updatedPageContent = extractUpdatedPageContentFromPayload(parsed, rawText);
  const assistantReply = String(parsed?.assistantReply || rawText || '').trim();
  const changeSummary = Array.isArray(parsed?.changeSummary)
    ? parsed.changeSummary.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

  return {
    updatedPageContent,
    assistantReply,
    changeSummary,
  };
}

async function retryForPlainUpdatedPageContent({
  providerId,
  originalRequest,
  originalPageContent,
  reportContent,
}) {
  const systemPrompt = [
    'You are an SEO page editor.',
    'Return ONLY the complete updated page content.',
    'Rules:',
    '- Do not return JSON.',
    '- Do not add explanations.',
    '- Preserve valid page structure.',
    '- Apply SEO improvements using the report + request.',
  ].join('\n');

  const userPrompt = JSON.stringify(
    {
      request: originalRequest,
      originalPageContent,
      reportMarkdown: reportContent,
    },
    null,
    2
  );

  const repaired = await aiProviderManager.runProviderPrompt({
    providerId: String(providerId || '').trim() || null,
    systemPrompt,
    userPrompt,
    maxTokens: 3600,
    temperature: 0.1,
  });

  const rawText = String(repaired?.text || '').trim();
  if (!rawText) {
    return '';
  }

  const codeBlock = extractLongestCodeBlock(rawText);
  if (codeBlock) {
    return normalizeLineEndings(codeBlock);
  }

  return normalizeLineEndings(rawText);
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
 * Use AI provider chat with required desktop page/report file access.
 */
router.post('/ai-chat', async (req, res) => {
  const {
    message,
    providerId,
    pagePath,
    reportPath,
  } = req.body || {};

  const userMessage = String(message || '').trim();
  if (!userMessage) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  try {
    const normalizedPagePath = requireAbsoluteFilePath(pagePath, 'pagePath');
    const normalizedReportPath = requireAbsoluteFilePath(reportPath, 'reportPath');
    const shouldApplyChanges = true;

    if (!normalizedPagePath) {
      return res.status(400).json({ error: 'pagePath is required and must be an absolute path.' });
    }

    if (!normalizedReportPath) {
      return res.status(400).json({ error: 'reportPath is required and must be an absolute path.' });
    }

    if (!isDesktopRuntime()) {
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
    const reportContent = String(reportFromPath || '').trim();

    if (!reportContent) {
      return res.status(400).json({ error: 'Existing .md report file is empty or unreadable.' });
    }

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
    let assistantReply = String(parsed?.assistantReply || rawText || 'No reply.').trim();
    let changeSummary = Array.isArray(parsed?.changeSummary)
      ? parsed.changeSummary.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    let updatedPageContent = extractUpdatedPageContentFromPayload(parsed, rawText);

    if (!updatedPageContent) {
      try {
        const repaired = await retryForUpdatedPageContent({
          providerId: String(providerId || '').trim() || null,
          originalRequest: userMessage,
          originalPageContent: pageContent,
          reportContent,
          previousRawOutput: rawText,
        });

        if (repaired.updatedPageContent) {
          updatedPageContent = repaired.updatedPageContent;
        }

        if (repaired.assistantReply) {
          assistantReply = repaired.assistantReply;
        }

        if (repaired.changeSummary.length > 0) {
          changeSummary = repaired.changeSummary;
        }
      } catch (retryError) {
        console.warn('[Route /analyze/ai-chat] Retry formatter failed:', retryError.message);
      }
    }

    if (!updatedPageContent) {
      try {
        const plainContent = await retryForPlainUpdatedPageContent({
          providerId: String(providerId || '').trim() || null,
          originalRequest: userMessage,
          originalPageContent: pageContent,
          reportContent,
        });

        if (plainContent) {
          updatedPageContent = plainContent;
          if (!assistantReply) {
            assistantReply = 'Applied changes from plain content fallback.';
          }
          if (changeSummary.length === 0) {
            changeSummary = ['Applied fallback page rewrite using report guidance.'];
          }
        }
      } catch (fallbackError) {
        console.warn('[Route /analyze/ai-chat] Plain fallback failed:', fallbackError.message);
      }
    }

    let applied = false;
    let backupPath = null;
    let applyWarning = null;

    if (shouldApplyChanges) {
      if (!updatedPageContent) {
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
