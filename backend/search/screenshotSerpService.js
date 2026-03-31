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

function shouldHandleGoogleConsent(pageUrl) {
  const value = String(pageUrl || '').toLowerCase();
  return value.includes('consent.google') || value.includes('/sorry/');
}

const ACCEPT_PATTERNS = [
  'accept all',
  'i agree',
  'accept',
  'agree',
  'allow all',
];

const REJECT_PATTERNS = [
  'reject all',
  'continue',
  'confirm',
  'ok',
];

async function clickConsentButtonsInFrame(frame) {
  try {
    return await frame.evaluate((acceptPatterns, rejectPatterns) => {
      const candidates = Array.from(document.querySelectorAll(
        'button, input[type="submit"], input[type="button"], div[role="button"], span[role="button"], [aria-label], [jsname]'
      ));
      if (candidates.length === 0) {
        return false;
      }

      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const getNodeLabel = (node) => normalize([
        node.textContent,
        node.getAttribute('aria-label'),
        node.getAttribute('value'),
        node.getAttribute('id'),
        node.getAttribute('name'),
      ].filter(Boolean).join(' '));

      const clickByPatterns = (patterns) => {
        for (const pattern of patterns) {
          for (const node of candidates) {
            const label = getNodeLabel(node);
            if (!label || !label.includes(pattern)) {
              continue;
            }
            try {
              node.click();
              return true;
            } catch {
              // continue
            }
          }
        }
        return false;
      };

      const knownIds = ['L2AGLb', 'introAgreeButton'];
      for (const id of knownIds) {
        const node = document.getElementById(id);
        if (!node) continue;
        try {
          node.click();
          return true;
        } catch {
          // continue
        }
      }

      if (clickByPatterns(acceptPatterns)) {
        return true;
      }

      return clickByPatterns(rejectPatterns);
    }, ACCEPT_PATTERNS, REJECT_PATTERNS);
  } catch {
    return false;
  }
}

async function handleGoogleConsent(page) {
  let clicked = false;
  for (const frame of page.frames()) {
    const frameClicked = await clickConsentButtonsInFrame(frame);
    clicked = clicked || frameClicked;
  }

  if (clicked) {
    try {
      await Promise.race([
        page.waitForNavigation({
          waitUntil: 'domcontentloaded',
          timeout: 5000,
        }),
        sleep(1200),
      ]);
    } catch {
      // ignore
    }
  }

  return clicked;
}

async function waitForResults(page, engine) {
  const selectors = engine === 'bing'
    ? ['#b_results .b_algo', '#b_results']
    : ['#search .g', '#search'];

  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: 7000 });
      return true;
    } catch {
      // try next selector
    }
  }

  return false;
}

async function extractOrganicResultsFromDom(page, engine, maxResults = 10) {
  try {
    const extracted = await page.evaluate((runtimeEngine, runtimeMaxResults) => {
      const rows = [];
      const seen = new Set();

      const pushRow = (title, url) => {
        const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
        const cleanUrl = String(url || '').trim();
        if (!cleanTitle || !cleanUrl || seen.has(cleanUrl)) {
          return;
        }
        seen.add(cleanUrl);
        rows.push({
          position: rows.length + 1,
          title: cleanTitle,
          website_title: '',
          url: cleanUrl,
        });
      };

      if (runtimeEngine === 'bing') {
        const cards = Array.from(document.querySelectorAll('#b_results .b_algo'));
        for (const card of cards) {
          if (rows.length >= runtimeMaxResults) break;
          const link = card.querySelector('h2 a');
          pushRow(link?.textContent || '', link?.href || '');
        }
      } else {
        const cards = Array.from(document.querySelectorAll('#search .g'));
        for (const card of cards) {
          if (rows.length >= runtimeMaxResults) break;
          const titleNode = card.querySelector('h3');
          const link = card.querySelector('a[href^="http"]');
          pushRow(titleNode?.textContent || '', link?.href || '');
        }
      }

      return rows;
    }, engine, maxResults);

    return Array.isArray(extracted) ? extracted : [];
  } catch {
    return [];
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

    if (engine === 'google' && shouldHandleGoogleConsent(page.url())) {
      await handleGoogleConsent(page);
      await sleep(1300);
    }

    await waitForResults(page, engine);
    await sleep(1700);

    const domResults = await extractOrganicResultsFromDom(page, engine, 10);
    const containerSelector = engine === 'bing' ? '#b_results' : '#search';
    const container = await page.$(containerSelector);

    let screenshot;
    if (container) {
      screenshot = await container.screenshot({
        type: 'jpeg',
        quality: 60,
      });
    } else {
      screenshot = await page.screenshot({
        fullPage: true,
        type: 'jpeg',
        quality: 60,
      });
    }

    const finalUrl = page.url() || searchUrl;
    const isBlocked = shouldHandleGoogleConsent(finalUrl);

    const imageBase64 = Buffer.from(screenshot).toString('base64');

    return {
      searchUrl: finalUrl,
      imageBase64,
      imageDataUrl: `data:image/jpeg;base64,${imageBase64}`,
      domResults,
      isBlocked,
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
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
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
    model: String(
      DEFAULT_OPENAI_SCREENSHOT_MODEL
      || provider?.selectedModel
      || process.env.OPENAI_MODEL
      || provider?.defaultModel
      || 'gpt-4.1'
    ).trim(),
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
    'You are extracting organic SERP results from a screenshot of page 1.',
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
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: `data:image/jpeg;base64,${imageBase64}` },
            ],
          },
        ],
        text: { format: responseSchema },
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

  const fallbackDomResults = normalizeResults(screenshot.domResults || [], 10);
  const resolvedResults = extracted.results.length > 0 ? extracted.results : fallbackDomResults;

  return {
    keyword: normalizedKeyword,
    country,
    location: location || null,
    engine,
    searchDomain,
    screenshotMode: true,
    aiProvider: extracted.aiProvider,
    aiModel: extracted.aiModel,
    results: resolvedResults,
    totalResults: resolvedResults.length,
    fromCache: false,
    debugPrompt: extracted.prompt,
    screenshotUrl: screenshot.searchUrl,
    screenshotImageDataUrl: screenshot.imageDataUrl,
    usedDomFallback: extracted.results.length === 0 && fallbackDomResults.length > 0,
    blockedByEngine: Boolean(screenshot.isBlocked),
  };
}

module.exports = {
  analyzeSERPFromScreenshot,
};
