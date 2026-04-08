#!/usr/bin/env node

const os = require('os');
const path = require('path');
const axios = require('axios');

const API_BASE_URL = String(process.env.LOCAL_SERP_BACKEND_URL || 'http://localhost:3001/api').replace(/\/+$/, '');
const AGENT_TOKEN = String(process.env.LOCAL_SERP_AGENT_TOKEN || '').trim();
const AGENT_ID = String(process.env.LOCAL_SERP_AGENT_ID || `${os.hostname()}-local-serp-agent`).trim();
const DEFAULT_POLL_MS = Number.parseInt(process.env.LOCAL_SERP_AGENT_POLL_MS || '2000', 10);
const USER_DATA_DIR = String(
  process.env.LOCAL_SERP_AGENT_USER_DATA_DIR || path.join(os.homedir(), '.local-serp-agent-profile')
).trim();
const USER_AGENT = String(
  process.env.LOCAL_SERP_AGENT_USER_AGENT
  || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
).trim();
const CHROME_EXECUTABLE_PATH = String(process.env.LOCAL_SERP_AGENT_CHROME_PATH || '').trim();
const USE_VALENTIN_LOCATION_HELPER = String(process.env.LOCAL_SERP_AGENT_USE_VALENTIN || 'true').trim().toLowerCase() !== 'false';
const VALENTIN_BASE_URL = String(process.env.LOCAL_SERP_AGENT_VALENTIN_BASE_URL || 'https://valentin.app').replace(/\/+$/, '');
const VALENTIN_GEOCODE_TIMEOUT_MS = Number.parseInt(process.env.LOCAL_SERP_AGENT_VALENTIN_TIMEOUT_MS || '8000', 10);
const VALENTIN_GEOCODE_CACHE_TTL_MS = Number.parseInt(process.env.LOCAL_SERP_AGENT_VALENTIN_CACHE_TTL_MS || '900000', 10);

const valentinGeocodeCache = new Map();

let agentState = {
  status: 'idle',
  captchaPending: false,
  captchaUrl: null,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Number.isFinite(ms) ? ms : 1000));
}

function setAgentState(nextState = {}) {
  agentState = {
    ...agentState,
    ...nextState,
  };
}

function getAgentStatePayload() {
  return {
    status: String(agentState.status || 'idle').trim() || 'idle',
    captchaPending: Boolean(agentState.captchaPending),
    captchaUrl: agentState.captchaUrl ? String(agentState.captchaUrl).trim() : null,
  };
}

function isDetachedFrameError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('detached frame') || message.includes('execution context was destroyed');
}

function safePageUrl(page, fallback = '') {
  try {
    return page.url() || fallback;
  } catch {
    return fallback;
  }
}

function resolveHeadlessMode() {
  const defaultMode = 'new';
  const raw = String(process.env.LOCAL_SERP_AGENT_HEADLESS || defaultMode).trim().toLowerCase();
  if (raw === 'new') {
    return 'new';
  }
  return raw === 'true';
}

function loadPuppeteer() {
  try {
    return { launcher: require('puppeteer'), mode: 'puppeteer' };
  } catch {
    // ignore
  }

  try {
    return { launcher: require('puppeteer-core'), mode: 'puppeteer-core' };
  } catch {
    return null;
  }
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

function normalizeLanguageParams(country) {
  if (country === 'GB') {
    return { gl: 'uk', hl: 'en', geocodeGl: 'GB' };
  }

  return { gl: 'us', hl: 'en', geocodeGl: 'US' };
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundCoordinate(value) {
  const finite = toFiniteNumber(value);
  if (finite == null) {
    return null;
  }
  return Math.floor(finite * 1e7) / 1e7;
}

function generateValentinUule(latitude, longitude) {
  const lat = Math.round(1e7 * latitude);
  const lng = Math.round(1e7 * longitude);
  const timestamp = String(Math.floor(Date.now() * 1000));
  const radius = 150 * 620;
  const payload = [
    'role:', 1,
    '\nproducer:', 12,
    '\nprovenance:', 6,
    '\ntimestamp:', timestamp,
    '\nlatlng{\nlatitude_e7:', lat,
    '\nlongitude_e7:', lng,
    '\n}\nradius:', radius,
  ].join('');

  return `a ${Buffer.from(payload, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_')}`;
}

function getCachedValentinGeocode(cacheKey) {
  const current = valentinGeocodeCache.get(cacheKey);
  if (!current) {
    return null;
  }

  if ((Date.now() - current.savedAt) > VALENTIN_GEOCODE_CACHE_TTL_MS) {
    valentinGeocodeCache.delete(cacheKey);
    return null;
  }

  return current.value;
}

async function geocodeLocationViaValentin(location, country) {
  const normalizedLocation = normalizeLocation(location);
  if (!normalizedLocation || !USE_VALENTIN_LOCATION_HELPER) {
    return null;
  }

  const language = normalizeLanguageParams(country);
  const cacheKey = `${language.geocodeGl}:${normalizedLocation.toLowerCase()}`;
  const cached = getCachedValentinGeocode(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await axios.get(`${VALENTIN_BASE_URL}/geocode`, {
    params: {
      address: normalizedLocation.toLowerCase(),
      hl: language.hl,
      gl: language.geocodeGl,
    },
    timeout: VALENTIN_GEOCODE_TIMEOUT_MS,
  });

  const firstResult = response?.data?.results?.[0];
  const latitude = roundCoordinate(firstResult?.geometry?.location?.lat);
  const longitude = roundCoordinate(firstResult?.geometry?.location?.lng);

  if (latitude == null || longitude == null) {
    return null;
  }

  const resolved = {
    latitude,
    longitude,
    formattedAddress: String(firstResult?.formatted_address || normalizedLocation).trim() || normalizedLocation,
    source: 'valentin-app-geocode',
  };

  valentinGeocodeCache.set(cacheKey, {
    savedAt: Date.now(),
    value: resolved,
  });

  return resolved;
}

async function buildSearchUrl({ keyword, engine, searchDomain, country, location }) {
  const normalizedKeyword = normalizeKeyword(keyword);
  const normalizedLocation = normalizeLocation(location);
  const normalizedDomain = normalizeSearchDomain(searchDomain, engine);

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
    return {
      url: url.toString(),
      locationContext: null,
    };
  }

  const language = normalizeLanguageParams(country);
  const url = new URL(`https://${normalizedDomain}/search`);
  url.searchParams.set('q', normalizedKeyword);
  url.searchParams.set('num', '10');
  url.searchParams.set('gl', language.gl);
  url.searchParams.set('hl', language.hl);
  url.searchParams.set('ie', 'utf-8');
  url.searchParams.set('oe', 'utf-8');
  url.searchParams.set('pws', '0');

  let locationContext = null;
  if (normalizedLocation) {
    try {
      locationContext = await geocodeLocationViaValentin(normalizedLocation, country);
    } catch (error) {
      console.warn(`[LocalAgent] Valentin geocode failed for "${normalizedLocation}": ${error.message}`);
    }
  }

  if (locationContext?.latitude != null && locationContext?.longitude != null) {
    url.searchParams.set('uule', generateValentinUule(locationContext.latitude, locationContext.longitude));
  } else if (normalizedLocation) {
    url.searchParams.set('near', normalizedLocation);
  }

  return {
    url: url.toString(),
    locationContext,
  };
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
  'reject',
  'continue without accepting',
  'only necessary',
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

      const knownRejectIds = ['W0wltc'];
      for (const id of knownRejectIds) {
        const node = document.getElementById(id);
        if (!node) continue;
        try {
          node.click();
          return true;
        } catch {
          // continue
        }
      }

      if (clickByPatterns(rejectPatterns)) {
        return true;
      }

      const knownAcceptIds = ['L2AGLb', 'introAgreeButton'];
      for (const id of knownAcceptIds) {
        const node = document.getElementById(id);
        if (!node) continue;
        try {
          node.click();
          return true;
        } catch {
          // continue
        }
      }

      return clickByPatterns(acceptPatterns);
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
      const blockedHosts = new Set([
        'google.com',
        'www.google.com',
        'google.co.uk',
        'www.google.co.uk',
        'webcache.googleusercontent.com',
        'accounts.google.com',
        'support.google.com',
        'policies.google.com',
      ]);

      const resolveCandidateUrl = (rawHref) => {
        const value = String(rawHref || '').trim();
        if (!value) return '';

        let resolved;
        try {
          resolved = new URL(value, window.location.origin);
        } catch {
          return '';
        }

        const host = resolved.hostname.toLowerCase();
        const path = resolved.pathname.toLowerCase();

        // Google frequently wraps organic links as /url?q=<target> or /url?url=<target>.
        if ((host.endsWith('google.com') || host.endsWith('google.co.uk')) && path === '/url') {
          const target = resolved.searchParams.get('q') || resolved.searchParams.get('url');
          if (!target) return '';
          try {
            const parsedTarget = new URL(target);
            if (!/^https?:$/i.test(parsedTarget.protocol)) return '';
            return parsedTarget.toString();
          } catch {
            return '';
          }
        }

        if (!/^https?:$/i.test(resolved.protocol)) {
          return '';
        }

        return resolved.toString();
      };

      const pushRow = (title, url) => {
        const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
        const cleanUrl = resolveCandidateUrl(url);
        if (!cleanTitle || !cleanUrl || seen.has(cleanUrl)) {
          return;
        }
        seen.add(cleanUrl);
        rows.push({
          position: rows.length + 1,
          title: cleanTitle,
          url: cleanUrl,
        });
      };

      const isOrganicCandidateUrl = (rawUrl) => {
        const value = resolveCandidateUrl(rawUrl);
        if (!value) return false;

        try {
          const parsed = new URL(value);
          const host = parsed.hostname.toLowerCase();
          if (blockedHosts.has(host)) return false;
          if (host.endsWith('.google.com') || host.endsWith('.google.co.uk')) return false;

          const path = parsed.pathname.toLowerCase();
          if (path.startsWith('/search')) return false;
          if (path.startsWith('/aclk')) return false;
          return true;
        } catch {
          return false;
        }
      };

      const isBadSerpTitle = (rawTitle) => {
        const title = String(rawTitle || '').replace(/\s+/g, ' ').trim();
        if (!title) return true;
        return /^(map|maps|directions|website|call)$/i.test(title);
      };

      const pickMainGoogleLinkFromCard = (card) => {
        const anchors = Array.from(card.querySelectorAll('a[href]'));
        for (const anchor of anchors) {
          const h3 = anchor.querySelector('h3');
          if (!h3) continue;
          if (!isOrganicCandidateUrl(anchor.href)) continue;
          const title = String(h3.textContent || '').replace(/\s+/g, ' ').trim();
          if (isBadSerpTitle(title)) continue;
          return { title, href: anchor.href };
        }

        const h3 = card.querySelector('h3');
        const fallbackAnchor = h3?.closest('a[href]');
        if (h3 && fallbackAnchor && isOrganicCandidateUrl(fallbackAnchor.href)) {
          const title = String(h3.textContent || '').replace(/\s+/g, ' ').trim();
          if (!isBadSerpTitle(title)) {
            return { title, href: fallbackAnchor.href };
          }
        }

        return null;
      };

      if (runtimeEngine === 'bing') {
        const cards = Array.from(document.querySelectorAll('#b_results .b_algo'));
        for (const card of cards) {
          if (rows.length >= runtimeMaxResults) break;
          const link = card.querySelector('h2 a');
          pushRow(link?.textContent || '', link?.href || '');
        }
      } else {
        const cardSelectors = ['#search .MjjYud', '#search .g', '#search [data-sokoban-container]'];
        const uniqueCards = [];
        const seenCards = new Set();
        for (const selector of cardSelectors) {
          const candidates = Array.from(document.querySelectorAll(selector));
          for (const node of candidates) {
            if (seenCards.has(node)) continue;
            seenCards.add(node);
            uniqueCards.push(node);
          }
        }

        for (const card of uniqueCards) {
          if (rows.length >= runtimeMaxResults) break;

          const cardText = String(card.textContent || '').toLowerCase();
          if (cardText.includes('people also ask') || cardText.includes('sponsored')) {
            continue;
          }

          const mainLink = pickMainGoogleLinkFromCard(card);
          if (!mainLink) {
            continue;
          }

          pushRow(mainLink.title, mainLink.href);
        }

        if (rows.length < runtimeMaxResults) {
          const titleNodes = Array.from(document.querySelectorAll('#search h3'));
          for (const titleNode of titleNodes) {
            if (rows.length >= runtimeMaxResults) break;
            const titleText = String(titleNode.textContent || '').replace(/\s+/g, ' ').trim();
            if (isBadSerpTitle(titleText)) continue;

            const card = titleNode.closest('.MjjYud, .g, [data-sokoban-container], [data-hveid]');
            if (card) {
              const firstH3 = card.querySelector('h3');
              if (firstH3 && firstH3 !== titleNode) {
                continue;
              }

              const cardText = String(card.textContent || '').toLowerCase();
              if (cardText.includes('people also ask') || cardText.includes('sponsored')) {
                continue;
              }
            }

            const anchor = titleNode.closest('a[href]')
              || titleNode.parentElement?.querySelector('a[href]')
              || titleNode.parentElement?.parentElement?.querySelector('a[href]');

            const href = anchor?.href || '';
            if (!isOrganicCandidateUrl(href)) continue;
            pushRow(titleText, href);
          }
        }
      }

      return rows;
    }, engine, maxResults);

    return Array.isArray(extracted) ? extracted : [];
  } catch {
    return [];
  }
}

async function captureSerpLocally(payload) {
  const puppeteerRuntime = loadPuppeteer();
  if (!puppeteerRuntime) {
    throw new Error('Neither puppeteer nor puppeteer-core is installed.');
  }

  if (puppeteerRuntime.mode === 'puppeteer-core' && !CHROME_EXECUTABLE_PATH) {
    throw new Error('LOCAL_SERP_AGENT_CHROME_PATH is required when using puppeteer-core.');
  }

  const searchTarget = await buildSearchUrl({
    keyword: payload.keyword,
    engine: payload.engine,
    searchDomain: payload.searchDomain,
    country: payload.country,
    location: payload.location,
  });
  const searchUrl = searchTarget.url;

  const launchOptions = {
    headless: resolveHeadlessMode(),
    userDataDir: USER_DATA_DIR || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1366,2300',
    ],
  };

  if (CHROME_EXECUTABLE_PATH) {
    launchOptions.executablePath = CHROME_EXECUTABLE_PATH;
  }

  const browser = await puppeteerRuntime.launcher.launch(launchOptions);

  try {
    let lastError = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let page = null;
      try {
        page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 2300 });
        await page.setUserAgent(USER_AGENT);
        await page.setExtraHTTPHeaders({
          'accept-language': payload.country === 'GB' ? 'en-GB,en;q=0.9' : 'en-US,en;q=0.9',
        });
        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        await page.goto(searchUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        });

        if (payload.engine === 'google' && shouldHandleGoogleConsent(safePageUrl(page, searchUrl))) {
          await handleGoogleConsent(page);
          await sleep(1300);
        }

        const currentUrl = safePageUrl(page, searchUrl);
        if (payload.engine === 'google' && shouldHandleGoogleConsent(currentUrl)) {
          const blockedScreenshotBuffer = await page.screenshot({
            fullPage: true,
            type: 'jpeg',
            quality: 60,
          });
          const blockedImageBase64 = Buffer.from(blockedScreenshotBuffer).toString('base64');
        return {
          results: [],
          screenshotUrl: currentUrl,
          screenshotImageDataUrl: `data:image/jpeg;base64,${blockedImageBase64}`,
          blockedByEngine: true,
          debug: {
            capturedUrl: currentUrl,
            attempt,
            blockReason: 'captcha-or-consent',
            locationContext: searchTarget.locationContext || null,
            usedValentinLocationHelper: Boolean(searchTarget.locationContext),
          },
        };
      }

        await waitForResults(page, payload.engine);
        await sleep(1200);

        const domResults = await extractOrganicResultsFromDom(page, payload.engine, 10);
        const containerSelector = payload.engine === 'bing' ? '#b_results' : '#search';
        const container = await page.$(containerSelector);

        let screenshotBuffer;
        if (container) {
          screenshotBuffer = await container.screenshot({
            type: 'jpeg',
            quality: 60,
          });
        } else {
          screenshotBuffer = await page.screenshot({
            fullPage: true,
            type: 'jpeg',
            quality: 60,
          });
        }

        const finalUrl = safePageUrl(page, searchUrl);
        const imageBase64 = Buffer.from(screenshotBuffer).toString('base64');

        return {
          results: domResults,
          screenshotUrl: finalUrl,
          screenshotImageDataUrl: `data:image/jpeg;base64,${imageBase64}`,
          blockedByEngine: payload.engine === 'google' && shouldHandleGoogleConsent(finalUrl),
          debug: {
            capturedUrl: finalUrl,
            attempt,
            locationContext: searchTarget.locationContext || null,
            usedValentinLocationHelper: Boolean(searchTarget.locationContext),
          },
        };
      } catch (error) {
        lastError = error;

        if (isDetachedFrameError(error) && attempt < 2) {
          console.warn('[LocalAgent] Detached frame detected, retrying capture...');
          await sleep(700);
          continue;
        }

        throw error;
      } finally {
        if (page) {
          try {
            await page.close();
          } catch {
            // ignore close errors
          }
        }
      }
    }

    throw lastError || new Error('Local SERP capture failed.');
  } finally {
    await browser.close();
  }
}

function buildHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (AGENT_TOKEN) {
    headers['x-local-agent-token'] = AGENT_TOKEN;
  }
  return headers;
}

async function pollJob() {
  const { data } = await axios.post(
    `${API_BASE_URL}/local-serp-agent/poll`,
    {
      agentId: AGENT_ID,
      state: getAgentStatePayload(),
    },
    {
      headers: buildHeaders(),
      timeout: 30000,
    }
  );
  return data;
}

async function postHeartbeat() {
  await axios.post(
    `${API_BASE_URL}/local-serp-agent/heartbeat`,
    {
      agentId: AGENT_ID,
      state: getAgentStatePayload(),
    },
    {
      headers: buildHeaders(),
      timeout: 10000,
    }
  );
}

async function completeJob(jobId, payload) {
  await axios.post(
    `${API_BASE_URL}/local-serp-agent/jobs/${encodeURIComponent(jobId)}/complete`,
    payload,
    {
      headers: buildHeaders(),
      timeout: 30000,
    }
  );
}

async function failJob(jobId, error, meta = null) {
  await axios.post(
    `${API_BASE_URL}/local-serp-agent/jobs/${encodeURIComponent(jobId)}/fail`,
    {
      error,
      meta,
    },
    {
      headers: buildHeaders(),
      timeout: 30000,
    }
  );
}

async function processJob(job) {
  const jobId = job?.id;
  const payload = job?.payload || {};
  if (!jobId) {
    return;
  }

  try {
    if (payload?.type === 'captcha-helper') {
      throw new Error('Manual captcha helper is disabled. Retry a normal SERP scan.');
    }

    setAgentState({
      status: 'working',
      captchaPending: false,
      captchaUrl: null,
    });
    try {
      await postHeartbeat();
    } catch {
      // ignore heartbeat errors
    }

    const result = await captureSerpLocally(payload);

    setAgentState({
      status: 'idle',
      captchaPending: false,
      captchaUrl: null,
    });
    try {
      await postHeartbeat();
    } catch {
      // ignore heartbeat errors
    }

    await completeJob(jobId, result);
    const resultCount = Array.isArray(result.results) ? result.results.length : 0;
    console.log(`[LocalAgent] Completed job ${jobId} with ${resultCount} results.`);
  } catch (error) {
    const message = error?.message || 'Failed to process local SERP job.';
    setAgentState({
      status: 'idle',
      captchaPending: false,
      captchaUrl: null,
    });
    try {
      await postHeartbeat();
    } catch {
      // ignore heartbeat errors
    }
    try {
      await failJob(jobId, message);
    } catch {
      // ignore nested transport errors
    }
    console.error(`[LocalAgent] Job ${jobId} failed: ${message}`);
  }
}

async function run() {
  console.log(`[LocalAgent] Starting local SERP agent as "${AGENT_ID}"`);
  console.log(`[LocalAgent] Backend API: ${API_BASE_URL}`);
  console.log(`[LocalAgent] Token provided: ${AGENT_TOKEN ? 'yes' : 'no'}`);
  console.log(`[LocalAgent] Headless mode: ${resolveHeadlessMode() === false ? 'off (visible browser)' : String(resolveHeadlessMode())}`);
  console.log(`[LocalAgent] User profile dir: ${USER_DATA_DIR}`);
  const runtime = loadPuppeteer();
  console.log(`[LocalAgent] Puppeteer runtime: ${runtime?.mode || 'missing'}`);
  if (CHROME_EXECUTABLE_PATH) {
    console.log(`[LocalAgent] Browser executable: ${CHROME_EXECUTABLE_PATH}`);
  }
  console.log('[LocalAgent] Manual captcha handling: disabled');
  setAgentState({
    status: 'idle',
    captchaPending: false,
    captchaUrl: null,
  });
  try {
    await postHeartbeat();
  } catch {
    // ignore startup heartbeat errors
  }

  while (true) {
    try {
      const payload = await pollJob();
      if (!payload?.job) {
        await sleep(Number(payload?.pollAfterMs || DEFAULT_POLL_MS));
        continue;
      }

      await processJob(payload.job);
    } catch (error) {
      const message = error?.response?.data?.error || error?.message || 'Polling failed.';
      console.error(`[LocalAgent] Poll error: ${message}`);
      await sleep(DEFAULT_POLL_MS);
    }
  }
}

run().catch((error) => {
  console.error(`[LocalAgent] Fatal error: ${error?.message || error}`);
  process.exit(1);
});
