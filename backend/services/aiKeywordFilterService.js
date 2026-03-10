const axios = require('axios');

const DEFAULT_PROMPT =
  'Keep only the keywords that are the closest match to the seed keyword. Remove broad, weak, or loosely related phrases.';
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const DEFAULT_MAX_RESULTS = 100;
const MAX_RESULTS_LIMIT = 250;
const PASS_CHUNK_SIZE = 180;
const FINAL_PASS_LIMIT = 240;

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalisePrompt(prompt) {
  return prompt && prompt.trim() ? prompt.trim() : DEFAULT_PROMPT;
}

function normaliseKeywords(keywords = []) {
  const seen = new Set();
  const uniqueKeywords = [];

  for (const keyword of keywords) {
    if (typeof keyword !== 'string') continue;
    const cleaned = keyword.trim();
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    uniqueKeywords.push(cleaned);
  }

  return uniqueKeywords;
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function mergeRankedKeywords(rankedKeywords) {
  const byKeyword = new Map();

  for (const item of rankedKeywords) {
    if (!item || typeof item.keyword !== 'string') continue;

    const keyword = item.keyword.trim();
    if (!keyword) continue;

    const existing = byKeyword.get(keyword.toLowerCase());
    const nextItem = {
      keyword,
      score: Number.isFinite(item.score) ? clamp(Math.round(item.score), 0, 100) : 0,
      reason: typeof item.reason === 'string' ? item.reason.trim() : '',
    };

    if (!existing || nextItem.score > existing.score) {
      byKeyword.set(keyword.toLowerCase(), nextItem);
    }
  }

  return Array.from(byKeyword.values()).sort((left, right) => right.score - left.score);
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (!Array.isArray(payload?.output)) {
    return '';
  }

  const parts = [];

  for (const item of payload.output) {
    if (!Array.isArray(item?.content)) continue;

    for (const contentItem of item.content) {
      if (typeof contentItem?.text === 'string' && contentItem.text.trim()) {
        parts.push(contentItem.text.trim());
      }
    }
  }

  return parts.join('\n').trim();
}

function parseStructuredPayload(payload) {
  const rawText = extractResponseText(payload);

  if (!rawText) {
    throw createServiceError('AI did not return a structured keyword response.', 502);
  }

  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw createServiceError('AI returned an invalid keyword payload.', 502);
  }
}

function buildFilterInput({ seedKeyword, prompt, maxResults, keywords }) {
  return [
    `Seed keyword: ${seedKeyword}`,
    '',
    'Filtering goal:',
    prompt,
    '',
    `Return the best ${maxResults} keywords or fewer if only a smaller number is truly relevant.`,
    'Use only exact keywords from the candidate list. Do not invent or rewrite terms.',
    'Sort the final list from most relevant to least relevant.',
    '',
    'Candidate keywords:',
    ...keywords.map((keyword, index) => `${index + 1}. ${keyword}`),
  ].join('\n');
}

async function requestFilterPass({ apiKey, baseUrl, model, seedKeyword, prompt, keywords, maxResults }) {
  const responseSchema = {
    type: 'json_schema',
    name: 'keyword_filter_result',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
        },
        keywords: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              keyword: {
                type: 'string',
              },
              score: {
                type: 'integer',
                minimum: 0,
                maximum: 100,
              },
              reason: {
                type: 'string',
              },
            },
            required: ['keyword', 'score', 'reason'],
            additionalProperties: false,
          },
        },
      },
      required: ['summary', 'keywords'],
      additionalProperties: false,
    },
  };

  try {
    const { data } = await axios.post(
      `${baseUrl}/responses`,
      {
        model,
        store: false,
        input: buildFilterInput({
          seedKeyword,
          prompt,
          maxResults,
          keywords,
        }),
        text: {
          format: responseSchema,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 120000,
      }
    );

    const parsed = parseStructuredPayload(data);

    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      keywords: mergeRankedKeywords(parsed.keywords),
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    const upstreamStatus = error.response?.status;
    const upstreamMessage = error.response?.data?.error?.message || error.message;

    if (upstreamStatus === 401 || upstreamStatus === 403) {
      throw createServiceError(
        'AI keyword filtering could not authenticate. Check OPENAI_API_KEY and OPENAI_MODEL.',
        502
      );
    }

    if (upstreamStatus === 429) {
      throw createServiceError('AI keyword filtering is rate limited right now. Try again shortly.', 429);
    }

    throw createServiceError(`AI keyword filtering failed: ${upstreamMessage}`, 502);
  }
}

async function filterKeywordsWithAI({ seedKeyword, keywords, prompt, maxResults }) {
  if (!seedKeyword || !seedKeyword.trim()) {
    throw createServiceError('Seed keyword is required for AI filtering.');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw createServiceError('AI keyword filtering is not configured. Set OPENAI_API_KEY on the backend.');
  }

  const uniqueKeywords = normaliseKeywords(keywords);
  if (uniqueKeywords.length === 0) {
    throw createServiceError('No keywords were provided for AI filtering.');
  }

  const selectedPrompt = normalisePrompt(prompt);
  const resultLimit = clamp(Number.parseInt(maxResults, 10) || DEFAULT_MAX_RESULTS, 5, MAX_RESULTS_LIMIT);
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const baseUrl = DEFAULT_BASE_URL;

  let passCount = 0;
  let workingKeywords = uniqueKeywords;

  if (workingKeywords.length > PASS_CHUNK_SIZE) {
    const chunks = chunkItems(workingKeywords, PASS_CHUNK_SIZE);
    const shortlistPerChunk = clamp(
      Math.ceil((resultLimit * 4) / chunks.length),
      Math.max(15, Math.ceil(resultLimit / Math.max(chunks.length, 1))),
      60
    );
    const mergedShortlist = [];

    for (const chunk of chunks) {
      const partialResult = await requestFilterPass({
        apiKey,
        baseUrl,
        model,
        seedKeyword,
        prompt: selectedPrompt,
        keywords: chunk,
        maxResults: shortlistPerChunk,
      });
      passCount += 1;
      mergedShortlist.push(...partialResult.keywords);
    }

    workingKeywords = mergeRankedKeywords(mergedShortlist)
      .slice(0, FINAL_PASS_LIMIT)
      .map((item) => item.keyword);
  }

  const finalResult = await requestFilterPass({
    apiKey,
    baseUrl,
    model,
    seedKeyword,
    prompt: selectedPrompt,
    keywords: workingKeywords,
    maxResults: resultLimit,
  });
  passCount += 1;

  return {
    keyword: seedKeyword.trim(),
    prompt: selectedPrompt,
    totalCandidates: uniqueKeywords.length,
    shortlistedCandidates: workingKeywords.length,
    selectedCount: finalResult.keywords.length,
    model,
    passCount,
    summary: finalResult.summary,
    keywords: finalResult.keywords.slice(0, resultLimit),
  };
}

module.exports = {
  DEFAULT_AI_FILTER_PROMPT: DEFAULT_PROMPT,
  filterKeywordsWithAI,
};
