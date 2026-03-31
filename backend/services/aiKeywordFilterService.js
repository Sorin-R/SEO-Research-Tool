const axios = require('axios');
const aiProviderManager = require('./aiProviderManager');

const DEFAULT_PROMPT =
  'Keep only the keywords that are the closest match to the seed keyword. Remove broad, weak, or loosely related phrases.';
const DEFAULT_RESEARCH_PROMPT =
  'Generate the closest, highest-intent keywords a real buyer would search for around the seed keyword. Favor commercially useful, tightly relevant terms and avoid weak tangents.';
const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-3-27b-it:free';
const DEFAULT_OPENROUTER_BASE_URL = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const DEFAULT_OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const DEFAULT_NVIDIA_MODEL = process.env.NVAPI_MODEL || 'meta/llama-3.3-70b-instruct';
const DEFAULT_NVIDIA_BASE_URL = (process.env.NVAPI_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
const NVIDIA_TEMPERATURE = Number.parseFloat(process.env.NVAPI_TEMPERATURE || '0.2');
const NVIDIA_TOP_P = Number.parseFloat(process.env.NVAPI_TOP_P || '0.7');
const NVIDIA_MAX_TOKENS = Number.parseInt(process.env.NVAPI_MAX_TOKENS || '1024', 10);
const DEFAULT_AI_TIMEOUT_MS = Number.parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '120000', 10);
const NVAPI_TIMEOUT_MS = Number.parseInt(process.env.NVAPI_TIMEOUT_MS || '180000', 10);
const NVAPI_DEEPSEEK_TIMEOUT_MS = Number.parseInt(process.env.NVAPI_DEEPSEEK_TIMEOUT_MS || '300000', 10);
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

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getAiRequestTimeoutMs(runtime) {
  if (runtime?.id === 'nvidia') {
    const model = String(runtime.model || '').toLowerCase();
    if (model.includes('deepseek')) {
      return parsePositiveInteger(NVAPI_DEEPSEEK_TIMEOUT_MS, 300000);
    }

    return parsePositiveInteger(NVAPI_TIMEOUT_MS, 180000);
  }

  return parsePositiveInteger(DEFAULT_AI_TIMEOUT_MS, 120000);
}

function normalisePrompt(prompt) {
  return prompt && prompt.trim() ? prompt.trim() : DEFAULT_PROMPT;
}

function normaliseResearchPrompt(prompt) {
  return prompt && prompt.trim() ? prompt.trim() : DEFAULT_RESEARCH_PROMPT;
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
      intent: typeof item.intent === 'string' ? item.intent.trim() : '',
      recommendedPageType: typeof item.recommendedPageType === 'string' ? item.recommendedPageType.trim() : '',
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
  return parseStructuredText(rawText);
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

function collectFencedJsonBlocks(value) {
  const text = String(value || '');
  const pattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  const blocks = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match[1] && match[1].trim()) {
      blocks.push(match[1].trim());
    }
  }

  return blocks;
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
    throw createServiceError('AI did not return a structured keyword response.', 502);
  }

  const candidates = [];
  const cleaned = stripMarkdownFences(rawText);
  const fencedBlocks = collectFencedJsonBlocks(rawText);
  const extractedJson = extractFirstJsonBlock(rawText);

  if (cleaned) {
    candidates.push(cleaned);
  }

  for (const block of fencedBlocks) {
    candidates.push(block);
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
      // Try next candidate.
    }
  }

  throw createServiceError('AI returned an invalid keyword payload.', 502);
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

function buildSchemaPrompt(schema) {
  return [
    'Return only valid JSON.',
    'Do not include markdown fences or any non-JSON text.',
    'The JSON must match this schema exactly:',
    JSON.stringify(schema),
  ].join('\n');
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

function formatListSection(label, values = []) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (list.length === 0) {
    return `${label}: none`;
  }

  return `${label}: ${list.join(', ')}`;
}

function buildResearchInput({ seedKeyword, prompt, maxResults, options = {} }) {
  return [
    `Seed keyword: ${seedKeyword}`,
    `Country: ${options.countryName || options.country || 'US'}`,
    `Target audience: ${options.targetAudience || 'not specified'}`,
    formatListSection('Preferred intents', options.intents),
    formatListSection('Include terms', options.includeTerms),
    formatListSection('Exclude terms', options.excludeTerms),
    formatListSection('Modifier terms', options.modifierTerms),
    formatListSection('Brand terms', options.brandTerms),
    formatListSection('Local cities', options.localCities),
    formatListSection('Local services', options.localServices),
    formatListSection('Competitor domains', options.competitorDomains),
    `Target domain: ${options.targetDomain || 'not specified'}`,
    `Questions only: ${options.questionsOnly ? 'yes' : 'no'}`,
    '',
    'Research goal:',
    prompt,
    '',
    `Generate the best ${maxResults} keywords or fewer if only a smaller number is truly strong.`,
    'Keep the list tightly aligned to the seed keyword and the research goal.',
    'Do not include junk, vague tangents, or barely related phrases.',
    'Return only distinct keyword phrases users would actually search for.',
  ].join('\n');
}

async function requestFilterPass({ runtime, seedKeyword, prompt, keywords, maxResults }) {
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
    const userInput = buildFilterInput({
      seedKeyword,
      prompt,
      maxResults,
      keywords,
    });
    const requestTimeoutMs = getAiRequestTimeoutMs(runtime);

    let parsed;

    if (runtime.requestMode === 'chat_completions') {
      const requestBody = {
        model: runtime.model,
        temperature: Number.isFinite(NVIDIA_TEMPERATURE) ? NVIDIA_TEMPERATURE : 0.2,
        top_p: Number.isFinite(NVIDIA_TOP_P) ? NVIDIA_TOP_P : 0.7,
        max_tokens: Number.isFinite(NVIDIA_MAX_TOKENS) ? NVIDIA_MAX_TOKENS : 1024,
        messages: [
          {
            role: 'system',
            content: buildSchemaPrompt(responseSchema.schema),
          },
          {
            role: 'user',
            content: userInput,
          },
        ],
      };

      if (runtime.id === 'nvidia') {
        requestBody.chat_template_kwargs = { thinking: false };
      }

      const { data } = await axios.post(
        `${runtime.baseUrl}/chat/completions`,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${runtime.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: requestTimeoutMs,
        }
      );

      parsed = parseStructuredText(extractChatCompletionText(data));
    } else {
      const { data } = await axios.post(
        `${runtime.baseUrl}/responses`,
        {
          model: runtime.model,
          store: false,
          input: userInput,
          text: {
            format: responseSchema,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${runtime.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: requestTimeoutMs,
        }
      );

      parsed = parseStructuredPayload(data);
    }

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
        `AI keyword filtering could not authenticate with ${runtime.name || 'the selected provider'}.`,
        502
      );
    }

    if (upstreamStatus === 429) {
      throw createServiceError('AI keyword filtering is rate limited right now. Try again shortly.', 429);
    }

    throw createServiceError(`AI keyword filtering failed: ${upstreamMessage}`, 502);
  }
}

async function requestResearchPass({ runtime, seedKeyword, prompt, options, maxResults }) {
  const responseSchema = {
    type: 'json_schema',
    name: 'keyword_generation_result',
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
              intent: {
                type: 'string',
              },
              recommendedPageType: {
                type: 'string',
              },
            },
            required: ['keyword', 'score', 'reason', 'intent', 'recommendedPageType'],
            additionalProperties: false,
          },
        },
      },
      required: ['summary', 'keywords'],
      additionalProperties: false,
    },
  };

  try {
    const userInput = buildResearchInput({
      seedKeyword,
      prompt,
      maxResults,
      options,
    });
    const requestTimeoutMs = getAiRequestTimeoutMs(runtime);

    let parsed;

    if (runtime.requestMode === 'chat_completions') {
      const requestBody = {
        model: runtime.model,
        temperature: Number.isFinite(NVIDIA_TEMPERATURE) ? NVIDIA_TEMPERATURE : 0.2,
        top_p: Number.isFinite(NVIDIA_TOP_P) ? NVIDIA_TOP_P : 0.7,
        max_tokens: Number.isFinite(NVIDIA_MAX_TOKENS) ? NVIDIA_MAX_TOKENS : 1024,
        messages: [
          {
            role: 'system',
            content: buildSchemaPrompt(responseSchema.schema),
          },
          {
            role: 'user',
            content: userInput,
          },
        ],
      };

      if (runtime.id === 'nvidia') {
        requestBody.chat_template_kwargs = { thinking: false };
      }

      const { data } = await axios.post(
        `${runtime.baseUrl}/chat/completions`,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${runtime.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: requestTimeoutMs,
        }
      );

      parsed = parseStructuredText(extractChatCompletionText(data));
    } else {
      const { data } = await axios.post(
        `${runtime.baseUrl}/responses`,
        {
          model: runtime.model,
          store: false,
          input: userInput,
          text: {
            format: responseSchema,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${runtime.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: requestTimeoutMs,
        }
      );

      parsed = parseStructuredPayload(data);
    }

    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      keywords: mergeRankedKeywords(parsed.keywords).slice(0, maxResults),
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    const upstreamStatus = error.response?.status;
    const upstreamMessage = error.response?.data?.error?.message || error.message;

    if (upstreamStatus === 401 || upstreamStatus === 403) {
      throw createServiceError(
        `AI keyword research could not authenticate with ${runtime.name || 'the selected provider'}.`,
        502
      );
    }

    if (upstreamStatus === 429) {
      throw createServiceError('AI keyword research is rate limited right now. Try again shortly.', 429);
    }

    throw createServiceError(`AI keyword research failed: ${upstreamMessage}`, 502);
  }
}

async function resolveKeywordAIRuntime() {
  const providerRuntime = await aiProviderManager.getKeywordAIRuntimeConfig();
  if (providerRuntime?.apiKey) {
    return providerRuntime;
  }

  const openRouterApiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (openRouterApiKey) {
    return {
      id: 'openrouter',
      name: 'OpenRouter',
      apiKey: openRouterApiKey,
      baseUrl: DEFAULT_OPENROUTER_BASE_URL,
      model: String(process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL).trim(),
      requestMode: 'chat_completions',
    };
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
    'AI keyword features are not configured. Add an API key in AI Providers (OpenRouter, OpenAI, or NVIDIA), or set OPENROUTER_API_KEY/OPENAI_API_KEY/NVAPI_API_KEY on the backend.'
  );
}

async function filterKeywordsWithAI({ seedKeyword, keywords, prompt, maxResults }) {
  if (!seedKeyword || !seedKeyword.trim()) {
    throw createServiceError('Seed keyword is required for AI filtering.');
  }

  const uniqueKeywords = normaliseKeywords(keywords);
  if (uniqueKeywords.length === 0) {
    throw createServiceError('No keywords were provided for AI filtering.');
  }

  const runtime = await resolveKeywordAIRuntime();
  const selectedPrompt = normalisePrompt(prompt);
  const resultLimit = clamp(Number.parseInt(maxResults, 10) || DEFAULT_MAX_RESULTS, 5, MAX_RESULTS_LIMIT);

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
        runtime,
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
    runtime,
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
    model: runtime.model,
    provider: runtime.name,
    passCount,
    summary: finalResult.summary,
    keywords: finalResult.keywords.slice(0, resultLimit),
  };
}

async function generateKeywordsWithAI({ seedKeyword, prompt, maxResults, options = {} }) {
  if (!seedKeyword || !seedKeyword.trim()) {
    throw createServiceError('Seed keyword is required for AI keyword research.');
  }

  const runtime = await resolveKeywordAIRuntime();
  const selectedPrompt = normaliseResearchPrompt(prompt);
  const resultLimit = clamp(Number.parseInt(maxResults, 10) || DEFAULT_MAX_RESULTS, 10, MAX_RESULTS_LIMIT);
  const generated = await requestResearchPass({
    runtime,
    seedKeyword,
    prompt: selectedPrompt,
    options,
    maxResults: resultLimit,
  });

  return {
    keyword: seedKeyword.trim(),
    prompt: selectedPrompt,
    selectedCount: generated.keywords.length,
    model: runtime.model,
    provider: runtime.name,
    summary: generated.summary,
    keywords: generated.keywords,
  };
}

module.exports = {
  DEFAULT_AI_FILTER_PROMPT: DEFAULT_PROMPT,
  DEFAULT_AI_RESEARCH_PROMPT: DEFAULT_RESEARCH_PROMPT,
  filterKeywordsWithAI,
  generateKeywordsWithAI,
};
