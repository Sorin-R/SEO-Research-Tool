const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../database');
const localStore = require('../utils/localStore');
const websiteService = require('./websiteService');
const { normalizeCountryCode } = require('../utils/searchCountry');

const DEFAULT_MAX_SOURCES = 40;
const MAX_SOURCES_HARD_LIMIT = 120;

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function shouldUseLocalFallback(err) {
  if (!err) return false;

  const fallbackCodes = new Set([
    'ER_ACCESS_DENIED_ERROR',
    'ER_NO_SUCH_TABLE',
    'ER_BAD_FIELD_ERROR',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT',
    'PROTOCOL_CONNECTION_LOST',
  ]);

  if (fallbackCodes.has(err.code)) return true;

  const message = String(err.message || '').toLowerCase();
  return (
    message.includes('access denied')
    || message.includes('connection')
    || message.includes('timeout')
    || message.includes("doesn't exist")
    || message.includes('does not exist')
    || message.includes('unknown column')
  );
}

function normalizeWebsiteId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractDomain(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return raw.replace(/^www\./, '').toLowerCase();
  }
}

function normalizeUrl(url, baseUrl = null) {
  const raw = String(url || '').trim();
  if (!raw) return '';

  try {
    const parsed = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function isTargetDomain(linkDomain, targetDomain) {
  if (!linkDomain || !targetDomain) {
    return false;
  }
  return linkDomain === targetDomain || linkDomain.endsWith(`.${targetDomain}`);
}

function parseSnapshotResult(row) {
  let parsedResult = row?.result || null;
  if (typeof parsedResult === 'string') {
    try {
      parsedResult = JSON.parse(parsedResult);
    } catch {
      parsedResult = null;
    }
  }
  return parsedResult;
}

async function getCandidateSourceRows({ websiteId, country, targetDomain, maxSources }) {
  const safeLimit = Math.min(Math.max(Number(maxSources) || DEFAULT_MAX_SOURCES, 1), MAX_SOURCES_HARD_LIMIT);

  try {
    const rows = await db.query(
      `SELECT url, domain, query, fetched_at
       FROM serp_results
       WHERE website_id = ?
         AND country = ?
         AND url IS NOT NULL
         AND url <> ''
       ORDER BY fetched_at DESC
       LIMIT ?`,
      [websiteId, country, safeLimit * 6]
    );

    const deduped = [];
    const seenUrls = new Set();
    for (const row of rows) {
      const sourceUrl = normalizeUrl(row.url);
      if (!sourceUrl || seenUrls.has(sourceUrl)) continue;
      seenUrls.add(sourceUrl);

      const sourceDomain = extractDomain(row.domain || sourceUrl);
      if (!sourceDomain || isTargetDomain(sourceDomain, targetDomain)) continue;

      deduped.push({
        sourceUrl,
        sourceDomain,
        query: row.query || '',
        fetchedAt: row.fetched_at || null,
      });

      if (deduped.length >= safeLimit) break;
    }

    return deduped;
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[BacklinkService] DB unavailable, using local store for candidate sources:', err.message);
    const rows = await localStore.getSerpResultsByScope({
      websiteId,
      country,
      queryList: [],
    });

    const deduped = [];
    const seenUrls = new Set();
    for (const row of rows) {
      const sourceUrl = normalizeUrl(row.url);
      if (!sourceUrl || seenUrls.has(sourceUrl)) continue;
      seenUrls.add(sourceUrl);

      const sourceDomain = extractDomain(row.domain || sourceUrl);
      if (!sourceDomain || isTargetDomain(sourceDomain, targetDomain)) continue;

      deduped.push({
        sourceUrl,
        sourceDomain,
        query: row.query || '',
        fetchedAt: row.fetched_at || null,
      });

      if (deduped.length >= safeLimit) break;
    }

    return deduped;
  }
}

async function discoverLinksFromSource(sourceRow, targetDomain) {
  const response = await axios.get(sourceRow.sourceUrl, {
    timeout: 12000,
    maxRedirects: 5,
    validateStatus: (statusCode) => statusCode >= 200 && statusCode < 400,
    headers: {
      'User-Agent': 'SEOResearchToolBacklinkCrawler/1.0 (+https://localhost)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
  if (!contentType.includes('text/html')) {
    return [];
  }

  const html = String(response.data || '');
  if (!html.trim()) {
    return [];
  }

  const $ = cheerio.load(html);
  const discoveries = [];
  const seen = new Set();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const targetUrl = normalizeUrl(href, response.request?.res?.responseUrl || sourceRow.sourceUrl);
    if (!targetUrl) return;

    const targetLinkDomain = extractDomain(targetUrl);
    if (!isTargetDomain(targetLinkDomain, targetDomain)) return;

    const dedupeKey = `${sourceRow.sourceUrl}::${targetUrl}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const anchorText = String($(element).text() || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    const rel = String($(element).attr('rel') || '').toLowerCase();

    discoveries.push({
      sourceUrl: sourceRow.sourceUrl,
      sourceDomain: sourceRow.sourceDomain,
      targetUrl,
      targetDomain: targetLinkDomain,
      anchorText,
      nofollow: rel.includes('nofollow'),
      query: sourceRow.query || '',
      discoveredAt: new Date().toISOString(),
    });
  });

  return discoveries;
}

async function saveSnapshot(payload) {
  const snapshotDate = new Date().toISOString().slice(0, 10);

  try {
    const result = await db.query(
      `INSERT INTO backlink_snapshots (
         website_id, snapshot_date, backlinks_count, referring_domains_count, result
       ) VALUES (?, ?, ?, ?, ?)`,
      [
        payload.websiteId,
        snapshotDate,
        payload.summary.backlinksCount,
        payload.summary.referringDomainsCount,
        JSON.stringify(payload),
      ]
    );

    return result?.insertId || null;
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[BacklinkService] DB unavailable, using local store for saveSnapshot:', err.message);
    return localStore.saveBacklinkSnapshot(payload);
  }
}

function createEmptyResult(websiteId, websiteDomain, country, reason = 'no-data') {
  return {
    available: false,
    source: 'free-crawler',
    reason,
    websiteId,
    websiteDomain,
    country,
    summary: {
      backlinksCount: 0,
      referringDomainsCount: 0,
      scannedSources: 0,
      candidateSources: 0,
    },
    backlinks: [],
    scannedAt: null,
  };
}

async function runBacklinkScan({
  websiteId,
  country = 'US',
  maxSources = DEFAULT_MAX_SOURCES,
} = {}) {
  const normalizedWebsiteId = normalizeWebsiteId(websiteId);
  if (!normalizedWebsiteId) {
    throw createServiceError('websiteId is required.');
  }

  const website = await websiteService.getWebsiteById(normalizedWebsiteId);
  if (!website) {
    throw createServiceError('Website not found.', 404);
  }

  const targetDomain = extractDomain(website.domain || '');
  const normalizedCountry = normalizeCountryCode(country || website.country || 'US');
  const candidates = await getCandidateSourceRows({
    websiteId: normalizedWebsiteId,
    country: normalizedCountry,
    targetDomain,
    maxSources,
  });

  const backlinks = [];
  const errors = [];

  for (const sourceRow of candidates) {
    try {
      const discovered = await discoverLinksFromSource(sourceRow, targetDomain);
      backlinks.push(...discovered);
    } catch (err) {
      errors.push({
        sourceUrl: sourceRow.sourceUrl,
        error: err.message || 'Failed to fetch source page.',
      });
    }
  }

  const uniqueBacklinks = [];
  const seenBacklinks = new Set();
  for (const item of backlinks) {
    const key = `${item.sourceUrl}::${item.targetUrl}`;
    if (seenBacklinks.has(key)) continue;
    seenBacklinks.add(key);
    uniqueBacklinks.push(item);
  }

  const referringDomains = new Set(uniqueBacklinks.map((item) => item.sourceDomain).filter(Boolean));
  const payload = {
    available: true,
    source: 'free-crawler',
    websiteId: normalizedWebsiteId,
    websiteDomain: website.domain,
    country: normalizedCountry,
    scannedAt: new Date().toISOString(),
    summary: {
      backlinksCount: uniqueBacklinks.length,
      referringDomainsCount: referringDomains.size,
      scannedSources: candidates.length,
      candidateSources: candidates.length,
      fetchErrors: errors.length,
    },
    backlinks: uniqueBacklinks.slice(0, 500),
    errors: errors.slice(0, 50),
  };

  const snapshotId = await saveSnapshot(payload);

  return {
    ...payload,
    snapshotId,
  };
}

async function getLatestBacklinkSnapshot(websiteId) {
  const normalizedWebsiteId = normalizeWebsiteId(websiteId);
  if (!normalizedWebsiteId) {
    return createEmptyResult(null, null, null, 'website-required');
  }

  const website = await websiteService.getWebsiteById(normalizedWebsiteId);
  if (!website) {
    return createEmptyResult(normalizedWebsiteId, null, null, 'website-not-found');
  }

  try {
    const rows = await db.query(
      `SELECT id, website_id, snapshot_date, backlinks_count, referring_domains_count, result, created_at
       FROM backlink_snapshots
       WHERE website_id = ?
       ORDER BY snapshot_date DESC, id DESC
       LIMIT 1`,
      [normalizedWebsiteId]
    );

    const row = rows[0];
    if (!row) {
      return createEmptyResult(normalizedWebsiteId, website.domain, website.country || 'US', 'no-snapshot');
    }

    const parsedResult = parseSnapshotResult(row) || {};
    return {
      available: true,
      source: 'free-crawler',
      websiteId: normalizedWebsiteId,
      websiteDomain: website.domain,
      country: parsedResult.country || website.country || 'US',
      scannedAt: parsedResult.scannedAt || row.created_at || null,
      summary: {
        backlinksCount: Number(row.backlinks_count || parsedResult?.summary?.backlinksCount || 0),
        referringDomainsCount: Number(row.referring_domains_count || parsedResult?.summary?.referringDomainsCount || 0),
        scannedSources: Number(parsedResult?.summary?.scannedSources || 0),
        candidateSources: Number(parsedResult?.summary?.candidateSources || 0),
        fetchErrors: Number(parsedResult?.summary?.fetchErrors || 0),
      },
      backlinks: Array.isArray(parsedResult.backlinks) ? parsedResult.backlinks : [],
      snapshotId: row.id,
      snapshotDate: row.snapshot_date,
    };
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[BacklinkService] DB unavailable, using local store for latest snapshot:', err.message);
    const fallback = await localStore.getLatestBacklinkSnapshot(normalizedWebsiteId);
    if (!fallback) {
      return createEmptyResult(normalizedWebsiteId, website.domain, website.country || 'US', 'no-snapshot');
    }
    return {
      ...fallback,
      available: true,
      source: 'free-crawler',
      websiteId: normalizedWebsiteId,
      websiteDomain: website.domain,
    };
  }
}

async function getBacklinkHistory(websiteId, limit = 20) {
  const normalizedWebsiteId = normalizeWebsiteId(websiteId);
  if (!normalizedWebsiteId) {
    return [];
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 120);

  try {
    const rows = await db.query(
      `SELECT id, website_id, snapshot_date, backlinks_count, referring_domains_count, created_at
       FROM backlink_snapshots
       WHERE website_id = ?
       ORDER BY snapshot_date DESC, id DESC
       LIMIT ?`,
      [normalizedWebsiteId, safeLimit]
    );

    return rows.map((row) => ({
      id: row.id,
      website_id: row.website_id,
      snapshot_date: row.snapshot_date,
      backlinks_count: Number(row.backlinks_count || 0),
      referring_domains_count: Number(row.referring_domains_count || 0),
      created_at: row.created_at,
    }));
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[BacklinkService] DB unavailable, using local store for history:', err.message);
    return localStore.getBacklinkHistory(normalizedWebsiteId, safeLimit);
  }
}

async function getDashboardBacklinksModule({
  websiteId,
  country = 'US',
  refresh = false,
} = {}) {
  const normalizedWebsiteId = normalizeWebsiteId(websiteId);
  if (!normalizedWebsiteId) {
    return {
      available: false,
      source: 'free-crawler',
      reason: 'website-required',
      summary: null,
    };
  }

  if (refresh) {
    try {
      return await runBacklinkScan({
        websiteId: normalizedWebsiteId,
        country,
      });
    } catch (err) {
      console.warn('[BacklinkService] Refresh scan failed, returning latest snapshot if any:', err.message);
    }
  }

  return getLatestBacklinkSnapshot(normalizedWebsiteId);
}

module.exports = {
  runBacklinkScan,
  getLatestBacklinkSnapshot,
  getBacklinkHistory,
  getDashboardBacklinksModule,
};

