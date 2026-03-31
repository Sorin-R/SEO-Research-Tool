const axios = require('axios');
const db = require('../database');
const localStore = require('../utils/localStore');
const websiteService = require('./websiteService');
const backlinkProviderManager = require('./backlinkProviderManager');
const { normalizeCountryCode } = require('../utils/searchCountry');

const DATAFORSEO_BASE_URL = 'https://api.dataforseo.com/v3';
const DEFAULT_BACKLINK_LIMIT = 100;
const MAX_BACKLINK_LIMIT = 1000;

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
    message.includes('access denied') ||
    message.includes('connection') ||
    message.includes('timeout') ||
    message.includes("doesn't exist") ||
    message.includes('does not exist') ||
    message.includes('unknown column')
  );
}

function normalizeWebsiteId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeLimit(value, fallback = DEFAULT_BACKLINK_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, MAX_BACKLINK_LIMIT);
}

function extractDomain(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return raw.replace(/^www\./, '').toLowerCase();
  }
}

function normalizeTargetForDataForSeo(website) {
  const targetUrl = String(website?.target_url || website?.targetUrl || '').trim();
  if (targetUrl) {
    try {
      const parsed = new URL(targetUrl);
      if (parsed.pathname && parsed.pathname !== '/') {
        return parsed.toString();
      }
    } catch {
      // ignore invalid target_url and fall back to domain
    }
  }

  const domain = extractDomain(website?.domain || website?.name || '');
  if (!domain) {
    throw createServiceError('Website domain is not valid for backlink lookup.', 400);
  }
  return domain;
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

async function postDataForSeo(path, payload, runtimeConfig) {
  try {
    const response = await axios.post(`${DATAFORSEO_BASE_URL}/${path}`, payload, {
      timeout: 60_000,
      auth: {
        username: runtimeConfig.login,
        password: runtimeConfig.password,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (err) {
    if (err.response?.data?.status_message) {
      throw createServiceError(
        `DataForSEO ${path} failed: ${err.response.data.status_message}`,
        502
      );
    }
    throw createServiceError(`DataForSEO ${path} failed: ${err.message}`, 502);
  }
}

function extractTaskOrThrow(apiResponse, endpointLabel) {
  const task = Array.isArray(apiResponse?.tasks) ? apiResponse.tasks[0] : null;
  if (!task) {
    throw createServiceError(`DataForSEO ${endpointLabel} returned no task.`, 502);
  }

  if (Number(task.status_code) !== 20000) {
    throw createServiceError(
      `DataForSEO ${endpointLabel} error: ${task.status_message || 'Unknown error.'}`,
      502
    );
  }

  return task;
}

function mapBacklinkItems(taskResult, maxItems) {
  const listRoot = Array.isArray(taskResult) ? taskResult[0] : null;
  const items = Array.isArray(listRoot?.items)
    ? listRoot.items
    : Array.isArray(taskResult)
      ? taskResult
      : [];

  const rows = [];
  const seen = new Set();

  for (const item of items) {
    const sourceUrl = String(item?.url_from || '').trim();
    const sourceDomain = extractDomain(item?.domain_from || sourceUrl);
    const targetUrl = String(item?.url_to || '').trim();
    if (!sourceUrl || !sourceDomain) continue;

    const dedupeKey = `${sourceUrl}::${targetUrl || sourceDomain}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const dofollow = typeof item?.dofollow === 'boolean'
      ? item.dofollow
      : (typeof item?.nofollow === 'boolean' ? !item.nofollow : null);

    rows.push({
      sourceUrl,
      sourceDomain,
      targetUrl: targetUrl || null,
      anchorText: String(item?.anchor || item?.anchor_raw || '').trim().slice(0, 240),
      dofollow,
      firstSeen: item?.first_seen || null,
      lastSeen: item?.last_seen || null,
      rank: Number(item?.rank || 0) || null,
      linkType: String(item?.link_type || '').trim() || null,
    });

    if (rows.length >= maxItems) break;
  }

  return rows;
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
    source: 'dataforseo',
    reason,
    websiteId,
    websiteDomain,
    country,
    summary: {
      backlinksCount: 0,
      referringDomainsCount: 0,
      scannedSources: 0,
      candidateSources: 0,
      fetchErrors: 0,
    },
    backlinks: [],
    scannedAt: null,
  };
}

async function runBacklinkScan({
  websiteId,
  country = 'US',
  maxBacklinks = DEFAULT_BACKLINK_LIMIT,
  includeSubdomains = true,
} = {}) {
  const normalizedWebsiteId = normalizeWebsiteId(websiteId);
  if (!normalizedWebsiteId) {
    throw createServiceError('websiteId is required.');
  }

  const website = await websiteService.getWebsiteById(normalizedWebsiteId);
  if (!website) {
    throw createServiceError('Website not found.', 404);
  }

  const runtimeConfig = await backlinkProviderManager.getActiveRuntimeConfig();
  if (!runtimeConfig?.login || !runtimeConfig?.password) {
    throw createServiceError(
      'DataForSEO backlink provider is not configured. Save API login/password and turn provider ON.',
      400
    );
  }

  const normalizedCountry = normalizeCountryCode(country || website.country || 'US');
  const target = normalizeTargetForDataForSeo(website);
  const safeLimit = normalizeLimit(maxBacklinks);

  const summaryRequest = [{
    target,
    include_subdomains: includeSubdomains !== false,
    backlinks_status_type: 'live',
  }];

  const summaryResponse = await postDataForSeo('backlinks/summary/live', summaryRequest, runtimeConfig);
  const summaryTask = extractTaskOrThrow(summaryResponse, 'backlinks/summary/live');
  const summaryResult = Array.isArray(summaryTask.result) ? summaryTask.result[0] : {};

  const backlinksRequest = [{
    target,
    mode: 'one_per_domain',
    limit: safeLimit,
  }];

  const backlinksResponse = await postDataForSeo('backlinks/backlinks/live', backlinksRequest, runtimeConfig);
  const backlinksTask = extractTaskOrThrow(backlinksResponse, 'backlinks/backlinks/live');
  const backlinks = mapBacklinkItems(backlinksTask.result, safeLimit);
  const uniqueRefDomains = new Set(backlinks.map((item) => item.sourceDomain).filter(Boolean));

  const backlinksCount = Number(summaryResult?.backlinks || 0) || backlinks.length;
  const referringDomainsCount = Number(summaryResult?.referring_domains || 0) || uniqueRefDomains.size;

  const payload = {
    available: true,
    source: 'dataforseo',
    providerId: runtimeConfig.providerId,
    providerName: runtimeConfig.providerName,
    websiteId: normalizedWebsiteId,
    websiteDomain: website.domain,
    country: normalizedCountry,
    target,
    scannedAt: new Date().toISOString(),
    summary: {
      backlinksCount,
      referringDomainsCount,
      scannedSources: backlinks.length,
      candidateSources: backlinks.length,
      fetchErrors: 0,
      rowsReturned: backlinks.length,
      limit: safeLimit,
      cost: Number(summaryTask?.cost || 0) + Number(backlinksTask?.cost || 0),
    },
    backlinks,
    errors: [],
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
      source: parsedResult.source || 'dataforseo',
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
        rowsReturned: Number(parsedResult?.summary?.rowsReturned || 0),
        limit: Number(parsedResult?.summary?.limit || 0),
        cost: Number(parsedResult?.summary?.cost || 0),
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
      source: fallback.source || 'dataforseo',
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
      source: 'dataforseo',
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
