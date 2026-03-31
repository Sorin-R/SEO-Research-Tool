const axios = require('axios');
const cheerio = require('cheerio');
const { throttle } = require('../utils/rateLimiter');
const { countWords } = require('../utils/helpers');
const serpApiManager = require('./serpApiManager');

/**
 * Fetch top Google search results for a keyword.
 * Uses multi-provider SERP API system with automatic fallback.
 *
 * @param {string} keyword
 * @param {number} numResults - Number of results to fetch (max 10)
 * @returns {Promise<Array>} Array of { position, title, url, snippet }
 */
async function fetchSERPResults(keyword, numResults = 10, options = {}) {
  const requireLocalPcAgent = options.requireLocalPcAgent === true;
  const preferLocalPcAgent = options.preferLocalPcAgent === true || requireLocalPcAgent;
  const lockedProviderId = String(options.providerId || '').trim();

  try {
    if (lockedProviderId) {
      return await serpApiManager.searchByProviderId(lockedProviderId, keyword, numResults, options);
    }

    if (preferLocalPcAgent) {
      try {
        const localResults = await serpApiManager.searchByProviderId('local-pc-agent', keyword, numResults, options);
        if (Array.isArray(localResults) && localResults.length > 0) {
          return localResults;
        }
        if (requireLocalPcAgent) {
          throw new Error('Local PC Agent returned no results.');
        }
      } catch (localErr) {
        if (requireLocalPcAgent) {
          throw new Error(`Local PC Agent required for this check but failed: ${localErr.message}`);
        }
      }
    }

    // Use multi-provider SERP API manager
    return await serpApiManager.search(keyword, numResults, options);
  } catch (err) {
    if (requireLocalPcAgent) {
      throw err;
    }

    console.warn('[SERP] Provider-based search failed, trying public fallback:', err.message);

    try {
      const fallbackStrategies = [
        { name: 'DuckDuckGo HTML', fetcher: fetchDuckDuckGoResults },
        { name: 'Bing HTML', fetcher: fetchBingHtmlResults },
      ];

      for (const strategy of fallbackStrategies) {
        const fallbackResults = await strategy.fetcher(keyword, numResults, options);
        if (fallbackResults.length > 0) {
          console.log(`[SERP] ✓ Public fallback (${strategy.name}) returned ${fallbackResults.length} results`);
          return fallbackResults;
        }
      }
    } catch (fallbackError) {
      console.warn('[SERP] Public fallback failed:', fallbackError.message);
    }

    throw new Error(
      `SERP search failed: ${err.message}. ` +
      'Configure at least one SERP provider API key in SERP Providers, or retry.'
    );
  }
}

async function fetchDuckDuckGoResults(keyword, numResults = 10, options = {}) {
  const region = getDuckDuckGoRegion(options.country);
  const { data: html } = await axios.get('https://html.duckduckgo.com/html/', {
    params: {
      q: keyword,
      kl: region,
    },
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(html);
  const rows = [];

  $('.result').each((index, element) => {
    if (rows.length >= numResults) {
      return false;
    }

    const anchor = $(element).find('.result__a').first();
    const title = anchor.text().trim();
    const rawHref = anchor.attr('href') || '';
    const url = normalizeDuckDuckGoUrl(rawHref);
    const snippet = $(element).find('.result__snippet').first().text().trim();

    if (!url || !title) {
      return undefined;
    }

    rows.push({
      position: index + 1,
      title,
      url,
      snippet,
    });

    return undefined;
  });

  return rows;
}

async function fetchBingHtmlResults(keyword, numResults = 10, options = {}) {
  const language = getBingLanguage(options.country);
  const { data: html } = await axios.get('https://www.bing.com/search', {
    params: {
      q: keyword,
      setLang: language,
    },
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(html);
  const rows = [];

  $('.b_algo').each((index, element) => {
    if (rows.length >= numResults) {
      return false;
    }

    const anchor = $(element).find('h2 a').first();
    const title = anchor.text().trim();
    const href = anchor.attr('href') || '';
    const url = normalizeBingResultUrl(href);
    const snippet = $(element).find('.b_caption p').first().text().trim()
      || $(element).find('p').first().text().trim();

    if (!url || !title) {
      return undefined;
    }

    rows.push({
      position: index + 1,
      title,
      url,
      snippet,
    });

    return undefined;
  });

  return rows;
}

function getDuckDuckGoRegion(countryCode) {
  const code = String(countryCode || 'US').toUpperCase();
  const regionMap = {
    US: 'us-en',
    GB: 'uk-en',
    CA: 'ca-en',
    AU: 'au-en',
    DE: 'de-de',
    FR: 'fr-fr',
    ES: 'es-es',
    IT: 'it-it',
    NL: 'nl-nl',
    IN: 'in-en',
    BR: 'br-pt',
    MX: 'mx-es',
    JP: 'jp-jp',
  };
  return regionMap[code] || 'us-en';
}

function getBingLanguage(countryCode) {
  const code = String(countryCode || 'US').toUpperCase();
  const languageMap = {
    US: 'en-US',
    GB: 'en-GB',
    CA: 'en-CA',
    AU: 'en-AU',
    DE: 'de-DE',
    FR: 'fr-FR',
    ES: 'es-ES',
    IT: 'it-IT',
    NL: 'nl-NL',
    IN: 'en-IN',
    BR: 'pt-BR',
    MX: 'es-MX',
    JP: 'ja-JP',
  };
  return languageMap[code] || 'en-US';
}

function normalizeDuckDuckGoUrl(rawUrl) {
  let value = String(rawUrl || '').trim();
  if (!value) {
    return '';
  }

  if (value.startsWith('//')) {
    value = `https:${value}`;
  }

  if (value.startsWith('/')) {
    value = `https://duckduckgo.com${value}`;
  }

  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();

    if (hostname.endsWith('duckduckgo.com') && parsed.pathname === '/l/') {
      const encodedTarget = parsed.searchParams.get('uddg') || parsed.searchParams.get('u');
      if (encodedTarget) {
        return decodeMany(encodedTarget);
      }
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }

    return parsed.toString();
  } catch {
    return '';
  }
}

function decodeMany(value) {
  let current = String(value || '').trim();

  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        break;
      }
      current = decoded;
    } catch {
      break;
    }
  }

  return /^https?:\/\//i.test(current) ? current : '';
}

function normalizeBingResultUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) {
    return '';
  }

  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();

    if (hostname.endsWith('bing.com') && parsed.pathname === '/ck/a') {
      const encodedTarget = parsed.searchParams.get('u');
      if (encodedTarget) {
        const decoded = decodeBingTarget(encodedTarget);
        if (decoded) {
          return decoded;
        }
      }
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }

    return parsed.toString();
  } catch {
    return '';
  }
}

function decodeBingTarget(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const maybeBase64 = raw.startsWith('a1') ? raw.slice(2) : raw;

  try {
    const decoded = Buffer.from(maybeBase64, 'base64').toString('utf8').trim();
    return /^https?:\/\//i.test(decoded) ? decoded : '';
  } catch {
    return '';
  }
}

/**
 * Scrape detailed page data (meta description, H1s, word count, image count)
 * for a given URL using Axios + Cheerio.
 *
 * @param {string} url
 * @returns {Promise<Object>}
 */
async function scrapePageDetails(url) {
  await throttle();

  try {
    console.log(`[SERP] Scraping details from: ${url}`);

    const { data: html } = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 15000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(html);

    // Meta description
    const metaDescription =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      '';

    // H1 headings
    const h1s = [];
    $('h1').each((_, el) => {
      const text = $(el).text().trim();
      if (text) h1s.push(text);
    });

    // All headings structure
    const headings = { h1: [], h2: [], h3: [] };
    ['h1', 'h2', 'h3'].forEach((tag) => {
      $(tag).each((_, el) => {
        const text = $(el).text().trim();
        if (text) headings[tag].push(text);
      });
    });

    // Body text word count (strip scripts, styles, nav, footer)
    $('script, style, nav, footer, header, aside, [role="complementary"]').remove();
    const bodyText = $('body').text();
    const wordCount = countWords(bodyText);

    // Image count
    const imageCount = $('img').length;

    // Title tag
    const pageTitle = $('title').text().trim();

    return {
      url,
      pageTitle,
      metaDescription: metaDescription.trim(),
      h1s,
      headings,
      wordCount,
      imageCount,
    };
  } catch (err) {
    console.warn(`[SERP] Failed to scrape ${url}: ${err.message}`);
    return {
      url,
      pageTitle: '',
      metaDescription: '',
      h1s: [],
      headings: { h1: [], h2: [], h3: [] },
      wordCount: 0,
      imageCount: 0,
      error: err.message,
    };
  }
}

module.exports = { fetchSERPResults, scrapePageDetails };
