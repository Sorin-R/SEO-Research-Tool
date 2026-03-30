#!/usr/bin/env node

const os = require('os');
const path = require('path');
const axios = require('axios');

const API_BASE_URL = String(process.env.LOCAL_SERP_BACKEND_URL || 'http://localhost:3001/api').replace(/\/+$/, '');
const AGENT_TOKEN = String(process.env.LOCAL_SERP_AGENT_TOKEN || '').trim();
const AGENT_ID = String(process.env.LOCAL_SERP_AGENT_ID || `${os.hostname()}-local-serp-agent`).trim();
const DEFAULT_POLL_MS = Number.parseInt(process.env.LOCAL_SERP_AGENT_POLL_MS || '2000', 10);
const CAPTCHA_WAIT_MS = Number.parseInt(process.env.LOCAL_SERP_AGENT_CAPTCHA_WAIT_MS || '180000', 10);
const USER_DATA_DIR = String(
  process.env.LOCAL_SERP_AGENT_USER_DATA_DIR || path.join(os.homedir(), '.local-serp-agent-profile')
).trim();
const MANUAL_CAPTCHA_ENABLED = String(process.env.LOCAL_SERP_AGENT_MANUAL_CAPTCHA || 'true').trim().toLowerCase() !== 'false';
const USER_AGENT = String(
  process.env.LOCAL_SERP_AGENT_USER_AGENT
  || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
).trim();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Number.isFinite(ms) ? ms : 1000));
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
  const raw = String(process.env.LOCAL_SERP_AGENT_HEADLESS || 'false').trim().toLowerCase();
  if (raw === 'new') {
    return 'new';
  }
  return raw === 'true';
}

function loadPuppeteer() {
  try {
    return require('puppeteer');
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

function buildSearchUrl({ keyword, engine, searchDomain, country, location }) {
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

function shouldHandleGoogleConsent(pageUrl) {
  const value = String(pageUrl || '').toLowerCase();
  return value.includes('consent.google') || value.includes('/sorry/');
}

async function handleGoogleConsent(page) {
  try {
    await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, input[type="submit"], div[role="button"]'));
      const clickByPattern = (pattern) => {
        for (const node of candidates) {
          const text = String(node.textContent || node.value || '').trim().toLowerCase();
          if (pattern.test(text)) {
            node.click();
            return true;
          }
        }
        return false;
      };

      if (!clickByPattern(/accept all|i agree|accept/)) {
        clickByPattern(/reject all|continue|confirm|ok/);
      }
    });
  } catch {
    // best-effort only
  }
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
          url: cleanUrl,
        });
      };

      const isOrganicCandidateUrl = (rawUrl) => {
        const value = String(rawUrl || '').trim();
        if (!value) return false;
        if (!/^https?:\/\//i.test(value)) return false;

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

        if (rows.length < runtimeMaxResults) {
          const root = document.querySelector('#search') || document.body;

          const titleNodes = Array.from(root.querySelectorAll('h3'));
          for (const titleNode of titleNodes) {
            if (rows.length >= runtimeMaxResults) break;

            const anchor = titleNode.closest('a[href^="http"]')
              || titleNode.parentElement?.querySelector('a[href^="http"]')
              || titleNode.parentElement?.parentElement?.querySelector('a[href^="http"]');

            const href = anchor?.href || '';
            if (!isOrganicCandidateUrl(href)) continue;
            pushRow(titleNode.textContent || '', href);
          }
        }

        if (rows.length < runtimeMaxResults) {
          const root = document.querySelector('#search') || document.body;
          const anchors = Array.from(root.querySelectorAll('a[href^="http"]'));

          for (const anchor of anchors) {
            if (rows.length >= runtimeMaxResults) break;
            const href = anchor.href || '';
            if (!isOrganicCandidateUrl(href)) continue;

            const titleNode = anchor.querySelector('h3')
              || anchor.closest('div')?.querySelector('h3')
              || anchor.parentElement?.querySelector('h3');
            const fallbackTitle = titleNode?.textContent || anchor.textContent || '';

            if (!String(fallbackTitle || '').trim()) continue;
            pushRow(fallbackTitle, href);
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
  const puppeteer = loadPuppeteer();
  if (!puppeteer) {
    throw new Error('Puppeteer is not installed. Run: npm --prefix backend install');
  }

  const searchUrl = buildSearchUrl({
    keyword: payload.keyword,
    engine: payload.engine,
    searchDomain: payload.searchDomain,
    country: payload.country,
    location: payload.location,
  });

  const browser = await puppeteer.launch({
    headless: resolveHeadlessMode(),
    userDataDir: USER_DATA_DIR || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1366,2300',
    ],
  });

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

        if (payload.engine === 'google' && shouldHandleGoogleConsent(safePageUrl(page, searchUrl)) && MANUAL_CAPTCHA_ENABLED) {
          const waitUntil = Date.now() + CAPTCHA_WAIT_MS;
          console.log('[LocalAgent] Google block/captcha detected. Solve it in the opened browser window...');

          while (Date.now() < waitUntil) {
            const currentUrl = safePageUrl(page, searchUrl);
            if (!shouldHandleGoogleConsent(currentUrl)) {
              break;
            }
            await handleGoogleConsent(page);
            await sleep(1500);
          }
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
    { agentId: AGENT_ID },
    {
      headers: buildHeaders(),
      timeout: 30000,
    }
  );
  return data;
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
    const result = await captureSerpLocally(payload);
    await completeJob(jobId, result);
    const resultCount = Array.isArray(result.results) ? result.results.length : 0;
    console.log(`[LocalAgent] Completed job ${jobId} with ${resultCount} results.`);
  } catch (error) {
    const message = error?.message || 'Failed to process local SERP job.';
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
  console.log(`[LocalAgent] Manual captcha handling: ${MANUAL_CAPTCHA_ENABLED ? 'enabled' : 'disabled'}`);

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
