const db = require('../database');
const localStore = require('../utils/localStore');
const websiteService = require('./websiteService');
const keywordService = require('./keywordService');
const { runSearch } = require('../search/searchService');
const { normalizeEngine, normalizeDomain } = require('../search/config');

const MAX_KEYWORDS_PER_RUN = 25;

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeWebsiteId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanKeyword(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function splitKeywords(value) {
  if (Array.isArray(value)) {
    return value.map(cleanKeyword).filter(Boolean);
  }

  return String(value || '')
    .split(/\n|,/g)
    .map(cleanKeyword)
    .filter(Boolean);
}

function dedupeKeywords(keywords) {
  const seen = new Set();
  const deduped = [];
  for (const keyword of keywords) {
    const key = keyword.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(keyword);
  }
  return deduped;
}

function extractDomain(url) {
  if (!url) {
    return '';
  }

  const raw = String(url).trim();
  if (!raw) {
    return '';
  }

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return raw.replace(/^www\./, '').toLowerCase();
  }
}

function normalizeComparableUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `https://${hostname}${pathname}`;
  } catch {
    return '';
  }
}

function createSiteMatcher(website) {
  const websiteDomain = extractDomain(website?.domain || '');
  const targetPageUrl = normalizeComparableUrl(website?.target_url || website?.targetUrl || '');

  return (resultUrl) => {
    const comparableResultUrl = normalizeComparableUrl(resultUrl);
    if (!comparableResultUrl) {
      return false;
    }

    if (targetPageUrl && comparableResultUrl === targetPageUrl) {
      return true;
    }

    const resultDomain = extractDomain(comparableResultUrl);
    if (!resultDomain || !websiteDomain) {
      return false;
    }

    return resultDomain === websiteDomain || resultDomain.endsWith(`.${websiteDomain}`);
  };
}

function summarizeKeywordResult(keyword, results, matchSite) {
  const normalizedResults = Array.isArray(results) ? results : [];
  const mentions = normalizedResults.map((item) => {
    const position = Number.parseInt(item?.position, 10);
    const citedUrl = String(item?.url || '').trim();
    const citedDomain = extractDomain(citedUrl);
    const appearsOnSite = matchSite(citedUrl);

    return {
      keyword,
      resultPosition: Number.isFinite(position) && position > 0 ? position : null,
      citedTitle: String(item?.title || '').trim(),
      citedUrl,
      citedDomain,
      appearsOnSite,
      fetchedAt: new Date().toISOString(),
    };
  });

  const myMentions = mentions.filter((item) => item.appearsOnSite);
  const bestCitationRank = myMentions.length > 0
    ? Math.min(...myMentions.map((item) => Number(item.resultPosition) || 999).filter((value) => value > 0))
    : null;

  const competitorDensity = mentions.length > 0
    ? Number(((mentions.length - myMentions.length) / mentions.length).toFixed(4))
    : 0;

  return {
    keyword,
    citations: mentions.length,
    myCitations: myMentions.length,
    citationShare: mentions.length > 0 ? Number((myMentions.length / mentions.length).toFixed(4)) : 0,
    bestCitationRank: Number.isFinite(bestCitationRank) && bestCitationRank < 999 ? bestCitationRank : null,
    competitorDensity,
    results: mentions.map((item) => ({
      position: item.resultPosition,
      title: item.citedTitle,
      url: item.citedUrl,
      domain: item.citedDomain,
      appearsOnSite: item.appearsOnSite,
    })),
    mentions,
  };
}

async function saveRunRecord(payload, mentions) {
  const runInsertPayload = {
    websiteId: payload.websiteId,
    engine: payload.engine,
    searchDomain: payload.searchDomain,
    country: payload.country,
    location: payload.location,
    keywordCount: payload.keywordCount,
    totalCitations: payload.totalCitations,
    myCitations: payload.myCitations,
    averageBestRank: payload.averageBestRank,
    result: payload,
    mentions,
  };

  try {
    const runResult = await db.query(
      `INSERT INTO ai_serp_runs (
         website_id, engine, search_domain, country, location,
         keyword_count, total_citations, my_citations, average_best_rank, result
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.websiteId,
        payload.engine,
        payload.searchDomain,
        payload.country,
        payload.location || null,
        payload.keywordCount,
        payload.totalCitations,
        payload.myCitations,
        payload.averageBestRank,
        JSON.stringify(payload),
      ]
    );

    const runId = runResult.insertId;
    for (const mention of mentions) {
      await db.query(
        `INSERT INTO ai_serp_mentions (
           run_id, website_id, keyword, result_position, cited_title, cited_url, cited_domain, appears_on_site, fetched_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          runId,
          payload.websiteId,
          mention.keyword,
          mention.resultPosition,
          mention.citedTitle || null,
          mention.citedUrl || null,
          mention.citedDomain || null,
          mention.appearsOnSite ? 1 : 0,
          mention.fetchedAt ? new Date(mention.fetchedAt) : new Date(),
        ]
      );
    }

    return runId;
  } catch (err) {
    console.warn('[AiSerpWorkspaceService] DB unavailable, using local store for saveRunRecord:', err.message);
    return localStore.saveAiSerpRun(runInsertPayload);
  }
}

async function getHistory(websiteId, limit = 20) {
  const normalizedWebsiteId = normalizeWebsiteId(websiteId);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

  try {
    const params = [];
    let sql = `SELECT id, website_id, engine, search_domain, country, location, keyword_count,
      total_citations, my_citations, average_best_rank, created_at, updated_at
      FROM ai_serp_runs`;

    if (normalizedWebsiteId != null) {
      sql += ' WHERE website_id = ?';
      params.push(normalizedWebsiteId);
    }

    sql += ` ORDER BY created_at DESC LIMIT ${safeLimit}`;

    const rows = await db.query(sql, params);
    return rows.map((row) => ({
      ...row,
      citation_share: Number(row.total_citations || 0) > 0
        ? Number(row.my_citations || 0) / Number(row.total_citations || 1)
        : 0,
    }));
  } catch (err) {
    console.warn('[AiSerpWorkspaceService] DB unavailable, using local store for getHistory:', err.message);
    return localStore.getAiSerpRuns(normalizedWebsiteId, safeLimit);
  }
}

async function getHistoryItem(id, websiteId = null) {
  const normalizedWebsiteId = normalizeWebsiteId(websiteId);

  try {
    const params = [id];
    let sql = `SELECT * FROM ai_serp_runs WHERE id = ?`;
    if (normalizedWebsiteId != null) {
      sql += ' AND website_id = ?';
      params.push(normalizedWebsiteId);
    }
    sql += ' LIMIT 1';

    const runRows = await db.query(sql, params);
    const run = runRows[0];
    if (!run) {
      return null;
    }

    const mentions = await db.query(
      `SELECT id, run_id, website_id, keyword, result_position, cited_title, cited_url, cited_domain, appears_on_site, fetched_at
       FROM ai_serp_mentions
       WHERE run_id = ?
       ORDER BY keyword ASC, result_position ASC`,
      [run.id]
    );

    let parsedResult = run.result;
    if (typeof parsedResult === 'string') {
      try {
        parsedResult = JSON.parse(parsedResult);
      } catch {
        parsedResult = null;
      }
    }

    return {
      ...run,
      result: parsedResult || null,
      mentions,
    };
  } catch (err) {
    console.warn('[AiSerpWorkspaceService] DB unavailable, using local store for getHistoryItem:', err.message);
    return localStore.getAiSerpRunById(id, normalizedWebsiteId);
  }
}

async function runAiSerpWorkspaceScan({
  websiteId,
  keywords = [],
  engine = 'google',
  domain = 'com',
  location = '',
  verifyUrls = false,
  maxKeywords = 15,
}) {
  const normalizedWebsiteId = normalizeWebsiteId(websiteId);
  if (!normalizedWebsiteId) {
    throw createServiceError('websiteId is required.');
  }

  const normalizedEngine = normalizeEngine(engine);
  if (!normalizedEngine) {
    throw createServiceError('engine must be "google" or "bing".');
  }

  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) {
    throw createServiceError('domain must be "com" or "co.uk".');
  }

  const website = await websiteService.getWebsiteById(normalizedWebsiteId);
  if (!website) {
    throw createServiceError('Website not found.', 404);
  }

  const parsedKeywords = dedupeKeywords(splitKeywords(keywords));
  let workingKeywords = parsedKeywords;

  if (workingKeywords.length === 0) {
    const trackedKeywords = await keywordService.getTrackedKeywords(normalizedWebsiteId);
    workingKeywords = dedupeKeywords(trackedKeywords.map((entry) => cleanKeyword(entry.keyword || '')));
  }

  const safeMaxKeywords = Math.min(
    Math.max(Number.parseInt(maxKeywords, 10) || 15, 1),
    MAX_KEYWORDS_PER_RUN
  );
  workingKeywords = workingKeywords.slice(0, safeMaxKeywords);

  if (workingKeywords.length === 0) {
    throw createServiceError('Add at least one keyword or track keywords for this website first.');
  }

  const matchSite = createSiteMatcher(website);
  const keywordReports = [];
  const allMentions = [];
  const failedKeywords = [];

  for (const keyword of workingKeywords) {
    try {
      const searchResult = await runSearch({
        keyword,
        engine: normalizedEngine,
        domain: normalizedDomain,
        location: String(location || '').trim(),
        aiMode: true,
        verifyUrls: Boolean(verifyUrls),
        debug: false,
      });

      const report = summarizeKeywordResult(keyword, searchResult.results || [], matchSite);
      keywordReports.push(report);
      allMentions.push(...report.mentions);
    } catch (err) {
      failedKeywords.push({
        keyword,
        error: err?.message || 'AI SERP request failed.',
      });
    }
  }

  const totalCitations = allMentions.length;
  const myCitations = allMentions.filter((item) => item.appearsOnSite).length;
  const promptsWithMentions = keywordReports.filter((item) => item.myCitations > 0).length;
  const bestRanks = keywordReports
    .map((item) => item.bestCitationRank)
    .filter((value) => Number.isFinite(value) && value > 0);
  const averageBestRank = bestRanks.length
    ? Number((bestRanks.reduce((sum, value) => sum + value, 0) / bestRanks.length).toFixed(2))
    : null;

  const responsePayload = {
    websiteId: normalizedWebsiteId,
    websiteDomain: website.domain,
    engine: normalizedEngine,
    searchDomain: `${normalizedEngine}.${normalizedDomain}`,
    country: website.country || (normalizedDomain === 'co.uk' ? 'GB' : 'US'),
    location: String(location || '').trim() || null,
    generatedAt: new Date().toISOString(),
    keywordCount: workingKeywords.length,
    processedKeywords: keywordReports.length,
    failedKeywords,
    totalCitations,
    myCitations,
    citationShare: totalCitations > 0 ? Number((myCitations / totalCitations).toFixed(4)) : 0,
    promptsWithMentions,
    averageBestRank,
    keywordReports,
  };

  const runId = await saveRunRecord(responsePayload, allMentions);

  return {
    ...responsePayload,
    runId,
  };
}

module.exports = {
  runAiSerpWorkspaceScan,
  getHistory,
  getHistoryItem,
};
