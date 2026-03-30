const axios = require('axios');
const aiProviderManager = require('../services/aiProviderManager');

const DEFAULT_OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const DEFAULT_AI_TIMEOUT_MS = Number.parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '120000', 10);
const DEFAULT_OPENAI_SCREENSHOT_MODEL = process.env.OPENAI_SCREENSHOT_MODEL || 'gpt-4.1';

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeKeyword(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeLocation(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSearchDomain(value, engine) {
  const raw = String(value || '').trim().toLowerCase();
  if (engine === 'bing') {
    return raw || 'bing.com';
  }
  return raw || 'google.com';
}

function buildSearchUrl({ keyword, engine, searchDomain, country, location }) {
  const normalizedKeyword = normalizeKeyword(keyword);
  const normalizedLocation = normalizeLocation(location);
  const normalizedDomain = normalizeSearchDomain(searchDomain, engine);

  if (!normalizedKeyword) {
    throw createServiceError('Keyword is required for screenshot SERP mode.');
  }

  if (engine === 'bing') {
    const url = new URL(`https://${normalizedDomain}/search`);
    url.searchParams.set('q', normalizedKeyword);
    if (country === 'GB') {
      url.searchParams.set('cc', 'GB');
      url.searchParams.set('setlang', 'en-GB');
    } else {
      url.searchParams.set('cc', 'US');
      url.searchParams.set('setlang', 'en-US');
    }
    if (normalizedLocation) {
      url.searchParams.set('loc', normalizedLocation);
    }
    return url.toString();
  }

  const url = new URL(`https://${normalizedDomain}/search`);
  url.searchParams.set('q', normalizedKeyword);
  url.searchParams.set('num', '10');
  if (country === 'GB') {
    url.searchParams.set('gl', 'uk');
    url.searchParams.set('hl', 'en');
  } else {
    url.searchParams.set('gl', 'us');
    url.searchParams.set('hl', 'en');
  }
  if (normalizedLocation) {
    url.searchParams.set('near', normalizedLocation);
  }
  return url.toString();
}

async function sleep(ms) {
  const duration = Number.isFinite(Number(ms)) ? Number(ms) : 0;
  if (duration <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, duration));
}

function loadPuppeteer() {
  try {
    return require('puppeteer');
  } catch {
    return null;
  }
}

async function captureSerpScreenshot({ keyword, engine, searchDomain, country, location }) {
  const puppeteer = loadPuppeteer();
  if (!puppeteer) {
    throw createServiceError(
      'Screenshot SERP mode requires puppeteer, but it is not installed in this backend runtime.',
      501
    );
  }

  const searchUrl = buildSearchUrl({
    keyword,
    engine,
    searchDomain,
    country,
    location,
  });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 2300 });
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await sleep(1800);

    const screenshot = await page.screenshot({
      fullPage: true,
      type: 'jpeg',
      quality: 60,
    });

    return {
      searchUrl,
      imageBase64: Buffer.from(screenshot).toString('base64'),
    };
  } finally {
    await browser.close();
  }
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
  const normalized = String(rawText || '').trim();
  if (!normalized) {
    throw createServiceError('AI did not return a structured screenshot payload.', 502);
  }

  const candidates = [
    normalized.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim(),
    extractFirstJsonBlock(normalized),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next
    }
  }

  throw createServiceError('AI returned an invalid screenshot payload.', 502);
}

function normalizeResults(payloadResults, maxResults = 10) {
  const seenUrls = new Set();
  const rows = [];

  for (const item of Array.isArray(payloadResults) ? payloadResults : []) {
    const title = String(item?.title || item?.serp_title || '').replace(/\s+/g, ' ').trim();
    let url = String(item?.url || '').trim();
    if (!title || !url) continue;

    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        continue;
      }
      url = parsed.toString();
    } catch {
      continue;
    }

    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    rows.push({
      position: rows.length + 1,
      title,
      url,
      websiteTitle: String(item?.website_title || '').replace(/\s+/g, ' ').trim() || '',
    });

    if (rows.length >= maxResults) break;
  }

  return rows;
}

async function resolveOpenAiRuntime() {
  const provider = await aiProviderManager.getProviderById('openai');
  const apiKey = await aiProviderManager.getProviderApiKey('openai');

  if (!apiKey) {
    throw createServiceError(
      'Screenshot SERP mode requires an OpenAI API key (configure OPENAI_API_KEY in AI Providers).',
      400
    );
  }

  return {
    apiKey,
    baseUrl: String(process.env.OPENAI_BASE_URL || provider?.baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, ''),
    model: String(DEFAULT_OPENAI_SCREENSHOT_MODEL || provider?.selectedModel || process.env.OPENAI_MODEL || provider?.defaultModel || 'gpt-4.1').trim(),
    providerName: provider?.name || 'ChatGPT (OpenAI)',
  };
}

async function extractResultsFromScreenshot({ imageBase64, keyword, engine, searchDomain, country, location }) {
  const runtime = await resolveOpenAiRuntime();

  const responseSchema = {
    type: 'json_schema',
    name: 'serp_screenshot_extract',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              position: { type: 'integer', minimum: 1, maximum: 10 },
              title: { type: 'string' },
              website_title: { type: 'string' },
              url: { type: 'string' },
            },
            required: ['position', 'title', 'website_title', 'url'],
            additionalProperties: false,
          },
        },
      },
      required: ['results'],
      additionalProperties: false,
    },
  };

  const prompt = [
    `You are extracting organic SERP results from a screenshot of page 1.`,
    `Keyword: ${keyword}`,
    `Engine: ${engine}`,
    `Domain: ${searchDomain}`,
    `Country hint: ${country}`,
    `Location hint: ${normalizeLocation(location) || 'not specified'}`,
    '',
    'Return the first 10 organic website results in ranking order.',
    'Exclude ads, sponsored blocks, AI answers, featured snippets, maps, videos, shopping, and people-also-ask.',
    'Return valid JSON only.',
  ].join('\n');

  try {
    const { data } = await axios.post(
      `${runtime.baseUrl}/responses`,
      {
        model: runtime.model,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: prompt,
              },
              {
                type: 'input_image',
                image_url: `data:image/jpeg;base64,${imageBase64}`,
              },
            ],
          },
        ],
        text: {
          format: responseSchema,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${runtime.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: DEFAULT_AI_TIMEOUT_MS,
      }
    );

    const parsed = parseStructuredText(extractResponseText(data));
    return {
      aiProvider: runtime.providerName,
      aiModel: runtime.model,
      prompt,
      results: normalizeResults(parsed?.results || [], 10),
    };
  } catch (err) {
    const upstreamStatus = Number(err?.response?.status || 0);
    const upstreamMessage = err?.response?.data?.error?.message
      || err?.response?.data?.error
      || err.message;

    if (upstreamStatus === 400) {
      throw createServiceError(
        `Screenshot OCR request rejected by OpenAI: ${upstreamMessage}. Try OPENAI_SCREENSHOT_MODEL=gpt-4.1`,
        400
      );
    }

    if (upstreamStatus === 401 || upstreamStatus === 403) {
      throw createServiceError(`Screenshot OCR authentication failed: ${upstreamMessage}`, 401);
    }

    if (upstreamStatus === 429) {
      throw createServiceError('Screenshot OCR is rate limited right now. Try again shortly.', 429);
    }

    throw createServiceError(`Screenshot OCR failed: ${upstreamMessage}`, 502);
  }
}

async function analyzeSERPFromScreenshot(keyword, options = {}) {
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedKeyword) {
    throw createServiceError('Keyword is required for screenshot SERP mode.');
  }

  const engine = String(options.engine || 'google').trim().toLowerCase() === 'bing' ? 'bing' : 'google';
  const searchDomain = normalizeSearchDomain(options.searchDomain, engine);
  const country = String(options.country || 'US').trim().toUpperCase() || 'US';
  const location = normalizeLocation(options.location);

  const screenshot = await captureSerpScreenshot({
    keyword: normalizedKeyword,
    engine,
    searchDomain,
    country,
    location,
  });

  const extracted = await extractResultsFromScreenshot({
    imageBase64: screenshot.imageBase64,
    keyword: normalizedKeyword,
    engine,
    searchDomain,
    country,
    location,
  });

  return {
    keyword: normalizedKeyword,
    country,
    location: location || null,
    engine,
    searchDomain,
    screenshotMode: true,
    aiProvider: extracted.aiProvider,
    aiModel: extracted.aiModel,
    results: extracted.results,
    totalResults: extracted.results.length,
    fromCache: false,
    debugPrompt: extracted.prompt,
    screenshotUrl: screenshot.searchUrl,
  };
}

module.exports = {
  analyzeSERPFromScreenshot,
};
