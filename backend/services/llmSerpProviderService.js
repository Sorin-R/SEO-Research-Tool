const axios = require('axios');
const aiProviderManager = require('./aiProviderManager');

const SUPPORTED_LLM_PROVIDER_IDS = ['openai', 'gemini', 'grok'];
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '120000', 10);

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

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

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
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
        if (!opener) break;

        const validPair = (opener === '{' && char === '}') || (opener === '[' && char === ']');
        if (!validPair) break;

        if (stack.length === 0) {
          return text.slice(startIndex, index + 1).trim();
        }
      }
    }
  }

  return '';
}

function parseStructuredJson(rawText) {
  if (!rawText) {
    throw createServiceError('LLM SERP provider returned empty output.', 502);
  }

  const candidates = [];
  const stripped = stripMarkdownFences(rawText);
  const extracted = extractFirstJsonBlock(rawText);
  if (stripped) candidates.push(stripped);
  if (extracted) candidates.push(extracted);

  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = normalizeJsonText(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    try {
      return JSON.parse(normalized);
    } catch {
      // continue
    }
  }

  throw createServiceError('LLM SERP provider returned invalid JSON.', 502);
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
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      return '';
    })
    .join('\n')
    .trim();
}

function normalizeResults(results, maxResults = 10) {
  const rows = [];
  const seen = new Set();

  for (const item of Array.isArray(results) ? results : []) {
    const url = normalizeUrl(item?.url);
    if (!url || seen.has(url)) continue;

    const title = String(item?.title || '').trim();
    const snippet = String(item?.snippet || '').trim();
    const domain = extractDomain(url);
    const position = Number.parseInt(item?.position, 10);

    rows.push({
      position: Number.isFinite(position) && position > 0 ? position : null,
      title,
      url,
      snippet,
      domain,
    });

    seen.add(url);
    if (rows.length >= maxResults) break;
  }

  rows.sort((a, b) => (a.position || 999) - (b.position || 999));

  return rows.slice(0, maxResults).map((row, index) => ({
    ...row,
    position: index + 1,
  }));
}

function buildLlmSerpPrompt({ keyword, country, location, maxResults }) {
  return [
    'Return JSON only.',
    'Task: Provide LLM citation-style ranking for one keyword.',
    `Keyword: ${keyword}`,
    `Country hint: ${country}`,
    `Location hint: ${String(location || '').trim() || 'not specified'}`,
    `Return top ${maxResults} cited or recommended websites in rank order as this model would surface them.`,
    'Exclude ads, maps, images, shopping blocks, and social profile cards.',
    'Return schema:',
    '{"results":[{"position":1,"title":"...","url":"https://...","snippet":"..."}]}',
  ].join('\n');
}

async function resolveRuntime(providerId) {
  const provider = await aiProviderManager.getProviderById(providerId);
  if (!provider) {
    throw createServiceError(`Unknown AI provider "${providerId}".`, 404);
  }

  if (!provider.active) {
    throw createServiceError(`${provider.name} is not active in AI Providers.`, 412);
  }

  const apiKey = await aiProviderManager.getProviderApiKey(providerId);
  if (!apiKey) {
    throw createServiceError(`${provider.name} API key is missing.`, 412);
  }

  return {
    id: provider.id,
    name: provider.name,
    apiKey,
    baseUrl: String(provider.baseUrl || '').replace(/\/+$/, ''),
    model: provider.selectedModel || provider.defaultModel,
    requestMode: provider.requestMode || 'responses',
  };
}

async function requestOpenAiLike(runtime, prompt, maxResults) {
  const schema = {
    type: 'json_schema',
    name: 'llm_serp_ranking',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              position: { type: 'integer', minimum: 1, maximum: maxResults },
              title: { type: 'string' },
              url: { type: 'string' },
              snippet: { type: 'string' },
            },
            required: ['position', 'title', 'url', 'snippet'],
            additionalProperties: false,
          },
        },
      },
      required: ['results'],
      additionalProperties: false,
    },
  };

  const response = await axios.post(
    `${runtime.baseUrl}/responses`,
    {
      model: runtime.model,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: prompt }],
        },
      ],
      text: { format: schema },
    },
    {
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: DEFAULT_TIMEOUT_MS,
    }
  );

  const text = extractResponseText(response.data);
  return parseStructuredJson(text);
}

async function requestChatCompletions(runtime, prompt) {
  const response = await axios.post(
    `${runtime.baseUrl}/chat/completions`,
    {
      model: runtime.model,
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 1800,
      messages: [
        {
          role: 'system',
          content: 'Return JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: DEFAULT_TIMEOUT_MS,
    }
  );

  const text = extractChatCompletionText(response.data);
  return parseStructuredJson(text);
}

async function requestGemini(runtime, prompt) {
  const endpoint = `${runtime.baseUrl}/models/${encodeURIComponent(runtime.model)}:generateContent?key=${encodeURIComponent(runtime.apiKey)}`;
  const response = await axios.post(
    endpoint,
    {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    },
    {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: DEFAULT_TIMEOUT_MS,
    }
  );

  const text = String(
    response?.data?.candidates?.[0]?.content?.parts?.[0]?.text
    || response?.data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n')
    || ''
  ).trim();

  return parseStructuredJson(text);
}

async function requestProviderResults({ runtime, keyword, country, location, maxResults }) {
  const prompt = buildLlmSerpPrompt({
    keyword,
    country,
    location,
    maxResults,
  });

  try {
    let payload;
    if (runtime.id === 'openai') {
      payload = await requestOpenAiLike(runtime, prompt, maxResults);
    } else if (runtime.id === 'gemini') {
      payload = await requestGemini(runtime, prompt, maxResults);
    } else {
      payload = await requestChatCompletions(runtime, prompt);
    }

    return normalizeResults(payload?.results, maxResults);
  } catch (err) {
    const statusCode = Number(err?.response?.status || 0);
    const upstreamMessage = err?.response?.data?.error?.message
      || err?.response?.data?.error
      || err?.response?.data?.message
      || err.message;

    if (statusCode === 401 || statusCode === 403) {
      throw createServiceError(`${runtime.name} authentication failed: ${upstreamMessage}`, 401);
    }
    if (statusCode === 429) {
      throw createServiceError(`${runtime.name} is rate limited right now.`, 429);
    }

    throw createServiceError(`${runtime.name} LLM SERP request failed: ${upstreamMessage}`, 502);
  }
}

async function runLlmSerpForProviders({
  keyword,
  country = 'US',
  location = '',
  maxResults = 10,
  providerIds = [],
}) {
  const normalizedKeyword = String(keyword || '').replace(/\s+/g, ' ').trim();
  if (!normalizedKeyword) {
    throw createServiceError('Keyword is required for LLM SERP.');
  }

  const requested = Array.isArray(providerIds) ? providerIds : [];
  const normalizedRequested = requested
    .map((providerId) => String(providerId || '').trim().toLowerCase())
    .filter((providerId) => SUPPORTED_LLM_PROVIDER_IDS.includes(providerId));
  const finalProviderIds = normalizedRequested.length > 0
    ? [...new Set(normalizedRequested)]
    : [...SUPPORTED_LLM_PROVIDER_IDS];

  const runs = [];
  const failures = [];
  for (const providerId of finalProviderIds) {
    try {
      const runtime = await resolveRuntime(providerId);
      const results = await requestProviderResults({
        runtime,
        keyword: normalizedKeyword,
        country: String(country || 'US').trim().toUpperCase(),
        location,
        maxResults: Math.min(Math.max(Number(maxResults) || 10, 1), 10),
      });
      runs.push({
        providerId: runtime.id,
        providerName: runtime.name,
        model: runtime.model,
        keyword: normalizedKeyword,
        results,
      });
    } catch (err) {
      failures.push({
        providerId,
        keyword: normalizedKeyword,
        error: err?.message || 'Provider request failed.',
      });
    }
  }

  if (runs.length === 0) {
    const reason = failures[0]?.error || 'No LLM providers returned results.';
    throw createServiceError(reason, 502);
  }

  return { runs, failures };
}

module.exports = {
  SUPPORTED_LLM_PROVIDER_IDS,
  runLlmSerpForProviders,
};
