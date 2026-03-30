const axios = require('axios');
const aiProviderManager = require('./aiProviderManager');

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const DEFAULT_OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const DEFAULT_NVIDIA_MODEL = process.env.NVAPI_MODEL || 'meta/llama-3.3-70b-instruct';
const DEFAULT_NVIDIA_BASE_URL = (process.env.NVAPI_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
const DEFAULT_AI_TIMEOUT_MS = Number.parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '120000', 10);

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeKeyword(value) {
  return String(value || '').trim();
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

function extractChatCompletionText(payload) {
  const firstChoice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const messageContent = firstChoice?.message?.content;

  if (typeof messageContent === 'string' && messageContent.trim()) {
    return messageContent.trim();
  }

  if (!Array.isArray(messageContent)) {
    return '';
  }

  return messageContent
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (typeof part?.text === 'string') {
        return part.text;
      }
      return '';
    })
    .join('\n')
    .trim();
}

function normalizeJsonText(value) {
  return String(value || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, '\'')
    .trim();
}

function stripMarkdownFences(value) {
  return String(value || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractFirstJsonBlock(value) {
  const text = String(value || '');
  const openingIndexes = [];

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{' || char === '[') {
      openingIndexes.push(index);
    }
  }

  for (const startIndex of openingIndexes) {
    const stack = [];
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        if (!escaped && char === '"') {
          inString = false;
        }
        escaped = !escaped && char === '\\';
        continue;
      }

      if (char === '"') {
        inString = true;
        escaped = false;
        continue;
      }

      if (char === '{' || char === '[') {
        stack.push(char);
        continue;
      }

      if (char === '}' || char === ']') {
        const opener = stack.pop();
        if (!opener) {
          break;
        }

        const validPair = (opener === '{' && char === '}') || (opener === '[' && char === ']');
        if (!validPair) {
          break;
        }

        if (stack.length === 0) {
          return text.slice(startIndex, index + 1).trim();
        }
      }
    }
  }

  return '';
}

function parseStructuredText(rawText) {
  if (!rawText) {
    throw createServiceError('AI did not return a structured SERP payload.', 502);
  }

  const candidates = [];
  const cleaned = stripMarkdownFences(rawText);
  const extractedJson = extractFirstJsonBlock(rawText);

  if (cleaned) {
    candidates.push(cleaned);
  }

  if (extractedJson) {
    candidates.push(extractedJson);
  }

  const seen = new Set();
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeJsonText(candidate);
    if (!normalizedCandidate || seen.has(normalizedCandidate)) {
      continue;
    }
    seen.add(normalizedCandidate);

    try {
      return JSON.parse(normalizedCandidate);
    } catch {
      // try next
    }
  }

  throw createServiceError('AI returned an invalid SERP payload.', 502);
}

function toValidUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeEngine(value) {
  return String(value || 'google').toLowerCase() === 'bing' ? 'bing' : 'google';
}

function normalizeSearchDomain(value, engine) {
  const raw = String(value || '').trim().toLowerCase();

  if (engine === 'bing') {
    return 'bing.com';
  }

  if (!raw) {
    return 'google.com';
  }

  const looksGoogle = /^([a-z0-9-]+\.)?google\.[a-z.]+$/.test(raw);
  return looksGoogle ? raw : 'google.com';
}

function resolveResultRows(keyword, payloadResults, maxResults = 10) {
  const normalizedKeyword = normalizeKeyword(keyword).toLowerCase();
  const rows = [];
  const seenUrls = new Set();

  for (const candidate of Array.isArray(payloadResults) ? payloadResults : []) {
    const url = toValidUrl(candidate?.url);
    if (!url || seenUrls.has(url)) {
      continue;
    }

    const title = String(candidate?.title || '').trim();
    const snippet = String(candidate?.snippet || '').trim();
    const positionValue = Number.parseInt(candidate?.position, 10);

    rows.push({
      position: Number.isFinite(positionValue) && positionValue > 0 ? positionValue : null,
      title,
      url,
      snippet,
      pageTitle: title,
      metaDescription: snippet,
      wordCount: snippet ? snippet.split(/\s+/).filter(Boolean).length : 0,
      imageCount: null,
      keywordInTitle: normalizedKeyword ? title.toLowerCase().includes(normalizedKeyword) : false,
    });

    seenUrls.add(url);

    if (rows.length >= maxResults) {
      break;
    }
  }

  rows.sort((left, right) => {
    const leftPosition = left.position ?? 9999;
    const rightPosition = right.position ?? 9999;
    return leftPosition - rightPosition;
  });

  return rows
    .slice(0, maxResults)
    .map((row, index) => ({
      ...row,
      position: index + 1,
    }));
}

function computeAverages(results, keyword) {
  if (!results.length) {
    return null;
  }

  const len = results.length;
  const sumWordCount = results.reduce((sum, row) => sum + (Number(row.wordCount) || 0), 0);
  const sumTitleLength = results.reduce((sum, row) => sum + String(row.title || '').length, 0);
  const sumImageCount = results.reduce((sum, row) => sum + (Number(row.imageCount) || 0), 0);
  const sumSnippetLength = results.reduce((sum, row) => sum + String(row.snippet || '').length, 0);
  const keywordLower = normalizeKeyword(keyword).toLowerCase();

  const keywordInTitleCount = results.filter(
    (row) => String(row.title || '').toLowerCase().includes(keywordLower)
  ).length;

  const keywordInMetaCount = results.filter(
    (row) => String(row.snippet || '').toLowerCase().includes(keywordLower)
  ).length;

  return {
    avgWordCount: Math.round(sumWordCount / len),
    avgTitleLength: Math.round(sumTitleLength / len),
    avgImages: Math.round(sumImageCount / len),
    avgMetaDescLength: Math.round(sumSnippetLength / len),
    keywordInTitleRatio: Math.round((keywordInTitleCount / len) * 100),
    keywordInMetaRatio: Math.round((keywordInMetaCount / len) * 100),
    totalResults: len,
  };
}

function buildSchemaPrompt(schema) {
  return [
    'Return only valid JSON.',
    'Do not include markdown fences or explanatory text.',
    'The JSON must match this schema exactly:',
    JSON.stringify(schema),
  ].join('\n');
}

function buildUserPrompt({ keyword, engine, searchDomain, country, numResults }) {
  return [
    `Task: Return the top ${numResults} organic SERP results for this query.`,
    `Keyword: ${keyword}`,
    `Search engine: ${engine}`,
    `Search domain: ${searchDomain}`,
    `Country hint: ${country}`,
    '',
    'Rules:',
    '- Return only organic web results (no ads, no maps pack, no videos carousel metadata).',
    '- Use unique result URLs.',
    '- Include title, URL, and short snippet.',
    '- Keep position as 1..10.',
  ].join('\n');
}

async function resolveKeywordAIRuntime() {
  const providerRuntime = await aiProviderManager.getKeywordAIRuntimeConfig();
  if (providerRuntime?.apiKey) {
    return providerRuntime;
  }

  const openAiApiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (openAiApiKey) {
    return {
      id: 'openai',
      name: 'ChatGPT (OpenAI)',
      apiKey: openAiApiKey,
      baseUrl: DEFAULT_OPENAI_BASE_URL,
      model: String(process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim(),
      requestMode: 'responses',
    };
  }

  const nvApiKey = String(process.env.NVAPI_API_KEY || '').trim();
  if (nvApiKey) {
    return {
      id: 'nvidia',
      name: 'NVIDIA (NVAPI)',
      apiKey: nvApiKey,
      baseUrl: DEFAULT_NVIDIA_BASE_URL,
      model: String(process.env.NVAPI_MODEL || DEFAULT_NVIDIA_MODEL).trim(),
      requestMode: 'chat_completions',
    };
  }

  throw createServiceError(
    'AI SERP mode is not configured. Add an API key in AI Providers (OpenAI or NVIDIA), or set OPENAI_API_KEY/NVAPI_API_KEY on the backend.'
  );
}

async function requestAiSerpPayload({ runtime, keyword, engine, searchDomain, country, numResults }) {
  const responseSchema = {
    type: 'json_schema',
    name: 'ai_serp_top_results',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        engine: { type: 'string' },
        searchDomain: { type: 'string' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              position: { type: 'integer', minimum: 1, maximum: 10 },
              title: { type: 'string' },
              url: { type: 'string' },
              snippet: { type: 'string' },
            },
            required: ['position', 'title', 'url', 'snippet'],
            additionalProperties: false,
          },
        },
      },
      required: ['engine', 'searchDomain', 'results'],
      additionalProperties: false,
    },
  };

  const userPrompt = buildUserPrompt({
    keyword,
    engine,
    searchDomain,
    country,
    numResults,
  });

  try {
    let parsedPayload;

    if (runtime.requestMode === 'chat_completions') {
      const requestBody = {
        model: runtime.model,
        temperature: 0.2,
        top_p: 0.8,
        max_tokens: 1400,
        messages: [
          {
            role: 'system',
            content: buildSchemaPrompt(responseSchema.schema),
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      };

      const response = await axios.post(
        `${runtime.baseUrl}/chat/completions`,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${runtime.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: DEFAULT_AI_TIMEOUT_MS,
        }
      );

      const responseText = extractChatCompletionText(response.data);
      parsedPayload = parseStructuredText(responseText);
    } else {
      const requestBody = {
        model: runtime.model,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: buildSchemaPrompt(responseSchema.schema),
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: userPrompt,
              },
            ],
          },
        ],
        text: {
          format: responseSchema,
        },
      };

      const response = await axios.post(
        `${runtime.baseUrl}/responses`,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${runtime.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: DEFAULT_AI_TIMEOUT_MS,
        }
      );

      const responseText = extractResponseText(response.data);
      parsedPayload = parseStructuredText(responseText);
    }

    if (!parsedPayload || typeof parsedPayload !== 'object') {
      throw createServiceError('AI returned an empty SERP response.', 502);
    }

    return parsedPayload;
  } catch (err) {
    if (err.statusCode) {
      throw err;
    }

    const upstreamStatus = Number(err?.response?.status || 0);
    const upstreamMessage = err?.response?.data?.error?.message
      || err?.response?.data?.error
      || err.message;

    if (upstreamStatus === 401 || upstreamStatus === 403) {
      throw createServiceError(`AI SERP authentication failed: ${upstreamMessage}`, 401);
    }

    if (upstreamStatus === 429) {
      throw createServiceError('AI SERP mode is rate limited right now. Try again shortly.', 429);
    }

    throw createServiceError(`AI SERP request failed: ${upstreamMessage}`, 502);
  }
}

async function analyzeSERPWithAI(keyword, options = {}) {
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedKeyword) {
    throw createServiceError('Keyword is required for AI SERP mode.');
  }

  const engine = normalizeEngine(options.engine);
  const searchDomain = normalizeSearchDomain(options.searchDomain, engine);
  const country = String(options.country || 'US').trim().toUpperCase() || 'US';
  const numResults = Math.min(Math.max(Number.parseInt(options.numResults, 10) || 10, 1), 10);
  const runtime = await resolveKeywordAIRuntime();
  const aiPayload = await requestAiSerpPayload({
    runtime,
    keyword: normalizedKeyword,
    engine,
    searchDomain,
    country,
    numResults,
  });

  const results = resolveResultRows(normalizedKeyword, aiPayload.results, numResults);
  const averages = computeAverages(results, normalizedKeyword);

  return {
    keyword: normalizedKeyword,
    country,
    engine,
    searchDomain,
    aiOnly: true,
    aiProvider: runtime.name,
    aiModel: runtime.model,
    results,
    averages,
    totalResults: results.length,
    successfulScrapes: results.length,
    fromCache: false,
    message: 'AI-only SERP mode (experimental).',
  };
}

module.exports = {
  analyzeSERPWithAI,
};
