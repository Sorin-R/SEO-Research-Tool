const axios = require('axios');

const TOKEN_SCOPE = 'https://ai.azure.com/.default';
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const TOKEN_TIMEOUT_MS = Number.parseInt(process.env.AZURE_AI_TOKEN_TIMEOUT_MS || '15000', 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.AZURE_AI_WEB_SEARCH_TIMEOUT_MS || '45000', 10);
const DEFAULT_MODEL = process.env.AZURE_AI_MODEL_DEPLOYMENT_NAME || 'gpt-5-mini';

let tokenCache = {
  accessToken: '',
  expiresAt: 0,
  cacheKey: '',
};

function createProviderError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function extractDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function normalizeKeyword(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildCacheKey(tenantId, clientId, clientSecret) {
  return `${tenantId}::${clientId}::${clientSecret.slice(0, 8)}`;
}

function resolveCredential(key, options = {}) {
  const fromOptions = String(options.credentials?.[key] || '').trim();
  if (fromOptions) return fromOptions;
  return String(process.env[key] || '').trim();
}

async function fetchAccessToken(credentials = {}) {
  const staticToken = String(credentials.agentToken || '').trim();
  if (staticToken) {
    return staticToken;
  }

  const tenantId = String(credentials.tenantId || '').trim();
  const clientId = String(credentials.clientId || '').trim();
  const clientSecret = String(credentials.clientSecret || '').trim();

  if (!tenantId || !clientId || !clientSecret) {
    throw createProviderError(
      'Azure Foundry auth missing. Configure AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET (or AZURE_AI_AGENT_TOKEN).',
      412
    );
  }

  const cacheKey = buildCacheKey(tenantId, clientId, clientSecret);
  if (
    tokenCache.cacheKey === cacheKey
    && tokenCache.accessToken
    && Date.now() + TOKEN_REFRESH_SKEW_MS < tokenCache.expiresAt
  ) {
    return tokenCache.accessToken;
  }

  const tokenEndpoint = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: TOKEN_SCOPE,
  }).toString();

  const { data } = await axios.post(tokenEndpoint, tokenBody, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: TOKEN_TIMEOUT_MS,
  });

  const accessToken = String(data?.access_token || '').trim();
  const expiresIn = Number.parseInt(data?.expires_in, 10) || 3600;
  if (!accessToken) {
    throw createProviderError('Azure token request failed: access_token missing.', 502);
  }

  tokenCache = {
    accessToken,
    expiresAt: Date.now() + (expiresIn * 1000),
    cacheKey,
  };

  return accessToken;
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
        if (!escaped && char === '"') inString = false;
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
        const valid = (opener === '{' && char === '}') || (opener === '[' && char === ']');
        if (!valid) break;
        if (stack.length === 0) return text.slice(startIndex, index + 1).trim();
      }
    }
  }

  return '';
}

function parseStructuredResults(rawText) {
  if (!rawText) return null;

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
      const parsed = JSON.parse(normalized);
      const rows = Array.isArray(parsed) ? parsed : parsed?.results;
      if (!Array.isArray(rows)) continue;
      return rows;
    } catch {
      // try next
    }
  }

  return null;
}

function collectOutputText(payload) {
  const outputText = String(payload?.output_text || '').trim();
  if (outputText) return outputText;

  const parts = [];
  const buckets = [];
  if (Array.isArray(payload?.output_items)) buckets.push(payload.output_items);
  if (Array.isArray(payload?.output)) buckets.push(payload.output);

  for (const bucket of buckets) {
    for (const item of bucket) {
      if (!Array.isArray(item?.content)) continue;
      for (const part of item.content) {
        const text = String(part?.text || '').trim();
        if (text) parts.push(text);
      }
    }
  }

  return parts.join('\n').trim();
}

function collectCitationUrls(payload) {
  const urls = [];
  const seen = new Set();
  const buckets = [];
  if (Array.isArray(payload?.output_items)) buckets.push(payload.output_items);
  if (Array.isArray(payload?.output)) buckets.push(payload.output);

  for (const bucket of buckets) {
    for (const item of bucket) {
      if (!Array.isArray(item?.content)) continue;
      for (const part of item.content) {
        const annotations = Array.isArray(part?.annotations) ? part.annotations : [];
        for (const annotation of annotations) {
          if (annotation?.type !== 'url_citation') continue;
          const normalized = normalizeUrl(annotation?.url);
          if (!normalized || seen.has(normalized)) continue;
          seen.add(normalized);
          urls.push(normalized);
        }
      }
    }
  }

  return urls;
}

function normalizeRows(items, numResults, fallbackSnippet = '') {
  const rows = [];
  const seen = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    const url = normalizeUrl(item?.url || item?.link || item?.href);
    if (!url || seen.has(url)) continue;

    const title = String(item?.title || '').trim() || extractDomain(url) || url;
    const snippet = String(item?.snippet || '').trim() || fallbackSnippet;
    rows.push({
      position: rows.length + 1,
      title,
      url,
      snippet: snippet.slice(0, 280),
    });
    seen.add(url);
    if (rows.length >= numResults) break;
  }

  return rows;
}

function buildPrompt(keyword, options, numResults) {
  const country = String(options.country || 'US').trim().toUpperCase();
  const location = String(options.location || '').replace(/\s+/g, ' ').trim();
  const target = options.engine === 'bing' ? 'bing.com' : String(options.searchDomain || 'google.com');

  return [
    `Search target hint: ${target}`,
    `Country hint: ${country}`,
    `Location hint: ${location || 'not specified'}`,
    `Keyword: ${keyword}`,
    `Return exactly up to ${numResults} organic website results from page 1 in ranking order.`,
    'Exclude ads, maps, videos, shopping, and people-also-ask blocks.',
    'Return JSON only with this schema:',
    '{"results":[{"position":1,"title":"...","url":"https://...","snippet":"..."}]}',
  ].join('\n');
}

function buildWebSearchTool(options = {}) {
  const country = String(options.country || 'US').trim().toUpperCase();
  const location = String(options.location || '').replace(/\s+/g, ' ').trim();
  const tool = { type: 'web_search' };

  if (location) {
    const firstSegment = location.split(',')[0].trim();
    tool.user_location = {
      type: 'approximate',
      country,
      city: firstSegment || undefined,
      region: firstSegment || undefined,
    };
  } else {
    tool.user_location = {
      type: 'approximate',
      country,
    };
  }

  return tool;
}

async function search(keyword, numResults = 10, options = {}) {
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedKeyword) {
    throw new Error('Keyword is required.');
  }

  const projectEndpoint = resolveCredential('AZURE_AI_PROJECT_ENDPOINT', options);
  const deploymentName = resolveCredential('AZURE_AI_MODEL_DEPLOYMENT_NAME', options) || DEFAULT_MODEL;
  const staticAgentToken = resolveCredential('AZURE_AI_AGENT_TOKEN', options);

  if (!projectEndpoint) {
    throw new Error('AZURE_AI_PROJECT_ENDPOINT not set.');
  }

  if (!deploymentName) {
    throw new Error('AZURE_AI_MODEL_DEPLOYMENT_NAME not set.');
  }

  const credentials = {
    agentToken: staticAgentToken,
    tenantId: resolveCredential('AZURE_TENANT_ID', options),
    clientId: resolveCredential('AZURE_CLIENT_ID', options),
    clientSecret: resolveCredential('AZURE_CLIENT_SECRET', options),
  };

  let accessToken;
  try {
    accessToken = await fetchAccessToken(credentials);
  } catch (error) {
    throw new Error(error?.message || 'Azure Foundry token request failed.');
  }

  const safeNumResults = Math.min(Math.max(Number.parseInt(numResults, 10) || 10, 1), 10);
  const requestBody = {
    model: deploymentName,
    input: buildPrompt(normalizedKeyword, options, safeNumResults),
    tool_choice: 'required',
    tools: [buildWebSearchTool(options)],
    temperature: 0.1,
  };

  try {
    const endpoint = `${String(projectEndpoint).replace(/\/+$/, '')}/openai/v1/responses`;
    let response;
    try {
      response = await axios.post(endpoint, requestBody, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      });
    } catch (firstError) {
      const status = Number(firstError?.response?.status || 0);
      if (status === 400) {
        // Some Azure deployments reject optional tool properties. Retry with minimal web_search tool payload.
        const fallbackBody = {
          ...requestBody,
          tools: [{ type: 'web_search' }],
        };
        response = await axios.post(endpoint, fallbackBody, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: REQUEST_TIMEOUT_MS,
        });
      } else {
        throw firstError;
      }
    }
    const { data } = response;
    const outputText = collectOutputText(data);
    const parsedRows = parseStructuredResults(outputText);
    const structuredRows = normalizeRows(parsedRows, safeNumResults, outputText);
    if (structuredRows.length > 0) {
      return structuredRows;
    }

    const citationRows = normalizeRows(
      collectCitationUrls(data).map((url) => ({ url })),
      safeNumResults,
      outputText
    );

    if (citationRows.length > 0) {
      return citationRows;
    }

    throw new Error('No web citations returned by Azure Foundry Web Search.');
  } catch (error) {
    const status = Number(error?.response?.status || 0);
    const upstreamMessage = error?.response?.data?.error?.message
      || error?.response?.data?.message
      || error?.message
      || 'Unknown error';

    if (status === 401 || status === 403) {
      throw new Error(`Azure Foundry Web Search authentication failed: ${upstreamMessage}`);
    }

    if (status === 429) {
      throw new Error('Azure Foundry Web Search rate-limited the request. Try again shortly.');
    }

    throw new Error(`Azure Foundry Web Search failed: ${upstreamMessage}`);
  }
}

module.exports = {
  search,
};
