const db = require('../database');
const localStore = require('../utils/localStore');
const websiteService = require('./websiteService');
const keywordService = require('./keywordService');
const { normalizeCountryCode } = require('../utils/searchCountry');

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'of',
  'on', 'or', 'that', 'the', 'this', 'to', 'was', 'what', 'when', 'where', 'who', 'will', 'with', 'you',
  'your', 'vs', 'best', 'top', 'guide', 'tips', 'can', 'not', 'we', 'our', 'from', 'into', 'about',
]);

function normalizeWebsiteId(value) {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeDivide(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return numerator / denominator;
}

function parseStoredPayload(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeDateInput(value, endOfDay = false) {
  if (!value) {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const input = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}${endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z'}`
    : raw;

  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateKey(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toISOString().slice(0, 10);
}

function extractDomain(url) {
  if (!url) {
    return '';
  }

  try {
    return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return String(url || '').replace(/^www\./, '').toLowerCase();
  }
}

function normalizeKeywordTerm(input) {
  let term = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!term || term.length < 3) {
    return '';
  }

  if (STOP_WORDS.has(term)) {
    return '';
  }

  if (term.endsWith('ies') && term.length > 4) {
    term = `${term.slice(0, -3)}y`;
  } else if (term.endsWith('es') && term.length > 4) {
    term = term.slice(0, -2);
  } else if (term.endsWith('s') && term.length > 3) {
    term = term.slice(0, -1);
  }

  return STOP_WORDS.has(term) ? '' : term;
}

function tokenize(text) {
  const normalizedTokens = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(normalizeKeywordTerm)
    .filter(Boolean);

  const terms = new Set(normalizedTokens);

  for (let index = 0; index < normalizedTokens.length - 1; index += 1) {
    const phrase = `${normalizedTokens[index]} ${normalizedTokens[index + 1]}`.trim();
    if (phrase.length >= 5) {
      terms.add(phrase);
    }
  }

  return [...terms];
}

function rowMatchesMyDomain(row, myDomains) {
  const domain = String(row?.domain || '').toLowerCase();
  if (!domain) return false;
  return [...myDomains].some((myDomain) => domain === myDomain || domain.endsWith(`.${myDomain}`));
}

function buildKeywordCoverageSet(rows) {
  const set = new Set();
  for (const row of rows) {
    tokenize(`${row.title || ''} ${row.snippet || ''}`).forEach((term) => set.add(term));
  }
  return set;
}

function extractBrandTerms(website) {
  if (!website) {
    return [];
  }

  const terms = new Set();
  const candidates = [
    website.name,
    website.project_name,
    website.projectName,
    extractDomain(website.domain || ''),
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) {
      continue;
    }

    terms.add(normalized);

    normalized
      .split(' ')
      .map(normalizeKeywordTerm)
      .filter(Boolean)
      .forEach((token) => terms.add(token));

    normalized
      .split(/[\s.-]+/)
      .map(normalizeKeywordTerm)
      .filter(Boolean)
      .forEach((token) => terms.add(token));
  }

  return [...terms].filter((term) => term.length >= 3);
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rankWeight(position) {
  const normalized = Number(position) || 100;
  return clamp((11 - normalized) / 10, 0.05, 1);
}

function buildTrendFromRows(rows, myDomains, staticSignals) {
  const byDate = new Map();

  for (const row of rows) {
    const key = toDateKey(row.fetched_at || row.created_at || new Date());
    if (!key) {
      continue;
    }
    if (!byDate.has(key)) {
      byDate.set(key, []);
    }
    byDate.get(key).push(row);
  }

  return [...byDate.entries()]
    .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
    .map(([date, dayRows]) => {
      const totalWeight = dayRows.reduce((sum, row) => sum + rankWeight(row.position), 0);
      const myRows = dayRows.filter((row) => rowMatchesMyDomain(row, myDomains));
      const myWeight = myRows.reduce((sum, row) => sum + rankWeight(row.position), 0);
      const uniqueMyPages = new Set(myRows.map((row) => row.url).filter(Boolean));
      const uniqueQueries = new Set(dayRows.map((row) => row.query).filter(Boolean));

      const dayDomainCitation = safeDivide(myRows.length, dayRows.length);
      const dayShareOfVoice = safeDivide(myWeight, totalWeight);
      const dayPageCitation = safeDivide(uniqueMyPages.size, Math.max(1, uniqueQueries.size));
      const normalizedPrimaryBrandTerm = String(staticSignals.primaryBrandTerm || '').trim().toLowerCase();
      const dayMention = safeDivide(
        dayRows.filter((row) => {
          if (rowMatchesMyDomain(row, myDomains)) {
            return true;
          }
          if (!normalizedPrimaryBrandTerm) {
            return false;
          }
          return String(row.title || '').toLowerCase().includes(normalizedPrimaryBrandTerm);
        }).length,
        dayRows.length
      );

      const daySerpScore = (
        (dayMention * 0.2) +
        (dayDomainCitation * 0.35) +
        (dayPageCitation * 0.2) +
        (dayShareOfVoice * 0.25)
      ) * 100;

      const dayScore = Math.round(clamp(
        (daySerpScore * 0.8) + (staticSignals.staticQualityScore * 0.2),
        0,
        100
      ));

      return {
        date,
        score: dayScore,
        mentionRate: Math.round(dayMention * 100),
        shareOfVoice: Math.round(dayShareOfVoice * 100),
        myCitations: myRows.length,
        totalCitations: dayRows.length,
      };
    });
}

function buildTopPages(myRows, queryCount) {
  const byPage = new Map();

  for (const row of myRows) {
    if (!row.url) {
      continue;
    }

    if (!byPage.has(row.url)) {
      byPage.set(row.url, {
        url: row.url,
        domain: row.domain,
        mentions: 0,
        bestRank: null,
        weightedVisibility: 0,
        engines: new Set(),
        queries: new Set(),
      });
    }

    const page = byPage.get(row.url);
    page.mentions += 1;
    page.weightedVisibility += rankWeight(row.position);
    page.engines.add(row.engine);
    if (row.query) {
      page.queries.add(row.query);
    }
    if (page.bestRank == null || Number(row.position) < page.bestRank) {
      page.bestRank = Number(row.position);
    }
  }

  return [...byPage.values()]
    .map((page) => {
      const mentionRate = safeDivide(page.mentions, Math.max(1, queryCount * 2));
      const bestRankBoost = page.bestRank != null ? clamp((11 - page.bestRank) / 10, 0, 1) : 0;
      const likelihood = Math.round(clamp((mentionRate * 60) + (bestRankBoost * 40), 0, 100));
      return {
        url: page.url,
        domain: page.domain,
        mentions: page.mentions,
        bestRank: page.bestRank,
        engineCount: page.engines.size,
        queryCount: page.queries.size,
        modeledCitationLikelihood: likelihood,
      };
    })
    .sort((left, right) => (
      right.modeledCitationLikelihood - left.modeledCitationLikelihood
      || right.mentions - left.mentions
      || (left.bestRank || 999) - (right.bestRank || 999)
    ))
    .slice(0, 10);
}

function buildCompetitorComparison(rows, myDomains) {
  const byDomain = new Map();
  let totalWeight = 0;

  for (const row of rows) {
    const domain = String(row.domain || '').toLowerCase();
    if (!domain) {
      continue;
    }

    if (!byDomain.has(domain)) {
      byDomain.set(domain, {
        domain,
        citations: 0,
        weighted: 0,
      });
    }

    const entry = byDomain.get(domain);
    const weight = rankWeight(row.position);
    entry.citations += 1;
    entry.weighted += weight;
    totalWeight += weight;
  }

  const domains = [...byDomain.values()]
    .map((entry) => ({
      domain: entry.domain,
      citations: entry.citations,
      weightedVisibility: Number(entry.weighted.toFixed(3)),
      shareOfVoice: Math.round(safeDivide(entry.weighted, totalWeight) * 100),
      isMySite: rowMatchesMyDomain({ domain: entry.domain }, myDomains),
    }))
    .sort((left, right) => (
      right.shareOfVoice - left.shareOfVoice
      || right.citations - left.citations
      || left.domain.localeCompare(right.domain)
    ));

  const mine = domains.filter((entry) => entry.isMySite);
  const myShare = mine.reduce((sum, entry) => sum + entry.shareOfVoice, 0);
  const topCompetitor = domains.find((entry) => !entry.isMySite) || null;

  return {
    domains: domains.slice(0, 12),
    summary: {
      myShareOfVoice: myShare,
      topCompetitor: topCompetitor ? topCompetitor.domain : null,
      topCompetitorShare: topCompetitor ? topCompetitor.shareOfVoice : 0,
      gapToLeader: topCompetitor ? Math.max(0, topCompetitor.shareOfVoice - myShare) : 0,
    },
  };
}

function buildMissingTopics({
  competitorRows,
  myRows,
  trackedKeywords,
  contentRows,
}) {
  const competitorTermCounts = new Map();

  for (const row of competitorRows) {
    tokenize(`${row.title || ''} ${row.snippet || ''}`).forEach((term) => {
      competitorTermCounts.set(term, (competitorTermCounts.get(term) || 0) + 1);
    });
  }

  const myCoverageTerms = buildKeywordCoverageSet(myRows);
  for (const keyword of trackedKeywords) {
    tokenize(keyword.keyword || '').forEach((term) => myCoverageTerms.add(term));
  }

  const missingFromSerp = [...competitorTermCounts.entries()]
    .filter(([term]) => !myCoverageTerms.has(term))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 20)
    .map(([topic, frequency]) => ({
      topic,
      frequency,
      source: 'serp-term-frequency',
    }));

  const missingFromContent = new Map();
  for (const row of contentRows) {
    const payload = parseStoredPayload(row.analysis_data);
    const topics = payload?.result?.missingTopics || [];
    for (const topic of topics) {
      const normalized = normalizeKeywordTerm(topic);
      if (!normalized) {
        continue;
      }
      missingFromContent.set(normalized, (missingFromContent.get(normalized) || 0) + 1);
    }
  }

  const missingFromContentList = [...missingFromContent.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 20)
    .map(([topic, frequency]) => ({
      topic,
      frequency,
      source: 'content-gap-analysis',
    }));

  const merged = new Map();
  for (const item of [...missingFromSerp, ...missingFromContentList]) {
    const existing = merged.get(item.topic);
    if (!existing) {
      merged.set(item.topic, { ...item });
      continue;
    }
    existing.frequency += item.frequency;
    if (!existing.source.includes(item.source)) {
      existing.source = `${existing.source},${item.source}`;
    }
  }

  return [...merged.values()]
    .sort((left, right) => right.frequency - left.frequency)
    .slice(0, 15);
}

function buildContentStructureScore(contentRows) {
  if (!contentRows.length) {
    return 0;
  }

  const scores = contentRows.map((row) => {
    const payload = parseStoredPayload(row.analysis_data);
    const result = payload?.result || {};

    let checksPassed = 0;
    const checksTotal = 6;

    if (result.pageTitleLength > 0) checksPassed += 1;
    if (result.metaDescriptionLength > 0) checksPassed += 1;
    if ((result.headings?.h1 || 0) > 0) checksPassed += 1;
    if ((result.internalLinkCount || 0) > 0) checksPassed += 1;
    if (result.keywordInFirstParagraph) checksPassed += 1;
    if ((result.readability?.transitionWordPercentage || 0) >= 25) checksPassed += 1;

    return safeDivide(checksPassed, checksTotal);
  });

  return average(scores);
}

function computeMainScore({
  brandMentionRate,
  domainCitationRate,
  pageCitationRate,
  shareOfVoiceRate,
  contentStructureRate,
  topicalCoverageRate,
  dataConfidence,
}) {
  const rawScore = (
    (brandMentionRate * 0.2) +
    (domainCitationRate * 0.25) +
    (pageCitationRate * 0.15) +
    (shareOfVoiceRate * 0.2) +
    (contentStructureRate * 0.1) +
    (topicalCoverageRate * 0.1)
  ) * 100;

  const confidenceMultiplier = 0.7 + (clamp(dataConfidence, 0, 1) * 0.3);
  return Math.round(clamp(rawScore * confidenceMultiplier, 0, 100));
}

async function resolveScopeWebsites(websiteId) {
  if (websiteId != null) {
    const single = await websiteService.getWebsiteById(websiteId);
    return single ? [single] : [];
  }
  return websiteService.getActiveWebsites();
}

async function getSerpRows({ websiteId, country, dateFrom, dateTo }) {
  const params = [country];
  let sql = `SELECT id, website_id, query, country, engine, position, url, domain, title, snippet, fetched_at
     FROM serp_results
     WHERE country = ?`;

  if (websiteId != null) {
    sql += ' AND website_id = ?';
    params.push(websiteId);
  }

  if (dateFrom) {
    sql += ' AND fetched_at >= ?';
    params.push(dateFrom.toISOString().slice(0, 19).replace('T', ' '));
  }
  if (dateTo) {
    sql += ' AND fetched_at <= ?';
    params.push(dateTo.toISOString().slice(0, 19).replace('T', ' '));
  }

  sql += ' ORDER BY fetched_at ASC, query ASC, engine ASC, position ASC';

  try {
    return await db.query(sql, params);
  } catch (err) {
    console.warn('[AIVisibilityService] DB unavailable, using local store for getSerpRows:', err.message);
    const fallbackRows = await localStore.getSerpResultsByScope({
      websiteId,
      country,
      queryList: [],
    });

    return fallbackRows.filter((row) => {
      const parsed = new Date(row.fetched_at || row.created_at || 0);
      if (Number.isNaN(parsed.getTime())) {
        return false;
      }
      if (dateFrom && parsed < dateFrom) return false;
      if (dateTo && parsed > dateTo) return false;
      return true;
    });
  }
}

async function getContentRows({ websiteId, dateFrom, dateTo }) {
  const params = [];
  let sql = `SELECT id, website_id, keyword, url, seo_score, analysis_data, created_at
     FROM content_analyses
     WHERE 1=1`;

  if (websiteId != null) {
    sql += ' AND website_id = ?';
    params.push(websiteId);
  }

  if (dateFrom) {
    sql += ' AND created_at >= ?';
    params.push(dateFrom.toISOString().slice(0, 19).replace('T', ' '));
  }

  if (dateTo) {
    sql += ' AND created_at <= ?';
    params.push(dateTo.toISOString().slice(0, 19).replace('T', ' '));
  }

  sql += ' ORDER BY created_at DESC LIMIT 200';

  try {
    return await db.query(sql, params);
  } catch (err) {
    console.warn('[AIVisibilityService] DB unavailable, using local store for getContentRows:', err.message);
    const history = await localStore.getContentAnalysisHistory(200, websiteId);
    return history.filter((row) => {
      const parsed = new Date(row.created_at || 0);
      if (Number.isNaN(parsed.getTime())) {
        return false;
      }
      if (dateFrom && parsed < dateFrom) return false;
      if (dateTo && parsed > dateTo) return false;
      return true;
    });
  }
}

async function getAiSerpRows({ websiteId, country, dateFrom, dateTo }) {
  const params = [country];
  let sql = `SELECT m.id, m.website_id, m.keyword AS query, m.result_position AS position,
    m.cited_url AS url, m.cited_domain AS domain, m.cited_title AS title,
    NULL AS snippet, m.fetched_at, m.appears_on_site
    FROM ai_serp_mentions m
    INNER JOIN ai_serp_runs r ON r.id = m.run_id
    WHERE r.country = ?`;

  if (websiteId != null) {
    sql += ' AND m.website_id = ?';
    params.push(websiteId);
  }

  if (dateFrom) {
    sql += ' AND m.fetched_at >= ?';
    params.push(dateFrom.toISOString().slice(0, 19).replace('T', ' '));
  }

  if (dateTo) {
    sql += ' AND m.fetched_at <= ?';
    params.push(dateTo.toISOString().slice(0, 19).replace('T', ' '));
  }

  sql += ' ORDER BY m.fetched_at ASC, m.keyword ASC, m.result_position ASC';

  try {
    return await db.query(sql, params);
  } catch (err) {
    console.warn('[AIVisibilityService] DB unavailable, using local store for getAiSerpRows:', err.message);
    const fallbackRows = await localStore.getAiSerpMentions({
      websiteId,
      dateFrom,
      dateTo,
    });

    return fallbackRows
      .map((row) => ({
        id: row.id,
        website_id: row.website_id,
        query: row.keyword,
        position: row.result_position,
        url: row.cited_url,
        domain: row.cited_domain,
        title: row.cited_title,
        snippet: null,
        fetched_at: row.fetched_at || row.created_at,
        appears_on_site: row.appears_on_site,
      }))
      .filter((row) => {
        const parsed = new Date(row.fetched_at || 0);
        if (Number.isNaN(parsed.getTime())) {
          return false;
        }
        if (dateFrom && parsed < dateFrom) return false;
        if (dateTo && parsed > dateTo) return false;
        return true;
      });
  }
}

async function saveAiVisibilitySnapshot({
  websiteId,
  country,
  score,
  breakdown,
}) {
  const metricDate = toDateKey(new Date());
  if (!metricDate) {
    return;
  }

  try {
    if (websiteId == null) {
      await db.query(
        `DELETE FROM ai_visibility_snapshots
         WHERE website_id IS NULL
           AND country = ?
           AND metric_date = ?`,
        [country, metricDate]
      );

      await db.query(
        `INSERT INTO ai_visibility_snapshots (
           website_id, country, metric_date, score, modeled, data_source, breakdown
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          null,
          country,
          metricDate,
          score,
          1,
          'proxy',
          JSON.stringify(breakdown || {}),
        ]
      );
      return;
    }

    await db.query(
      `INSERT INTO ai_visibility_snapshots (
         website_id, country, metric_date, score, modeled, data_source, breakdown
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         score = VALUES(score),
         modeled = VALUES(modeled),
         data_source = VALUES(data_source),
         breakdown = VALUES(breakdown),
         updated_at = CURRENT_TIMESTAMP`,
      [
        websiteId,
        country,
        metricDate,
        score,
        1,
        'proxy',
        JSON.stringify(breakdown || {}),
      ]
    );
  } catch (err) {
    // Non-fatal: this table may not exist on all deployments yet.
    console.warn('[AIVisibilityService] Could not persist ai_visibility snapshot:', err.message);
  }
}

async function getSnapshotTrend({
  websiteId,
  country,
  dateFrom,
  dateTo,
}) {
  const params = [country];
  let sql = `SELECT metric_date, score, breakdown
     FROM ai_visibility_snapshots
     WHERE country = ?`;

  if (websiteId == null) {
    sql += ' AND website_id IS NULL';
  } else {
    sql += ' AND website_id = ?';
    params.push(websiteId);
  }

  if (dateFrom) {
    sql += ' AND metric_date >= ?';
    params.push(toDateKey(dateFrom));
  }

  if (dateTo) {
    sql += ' AND metric_date <= ?';
    params.push(toDateKey(dateTo));
  }

  sql += ' ORDER BY metric_date ASC';

  try {
    const rows = await db.query(sql, params);
    return rows.map((row) => {
      const breakdown = parseStoredPayload(row.breakdown) || {};
      return {
        date: toDateKey(row.metric_date),
        score: Math.round(Number(row.score) || 0),
        mentionRate: Math.round(Number(breakdown.brandMentionRate || 0) * 100),
        shareOfVoice: Math.round(Number(breakdown.shareOfVoiceRate || 0) * 100),
        myCitations: Number(breakdown.myCitations || 0),
        totalCitations: Number(breakdown.totalCitations || 0),
      };
    });
  } catch {
    return [];
  }
}

/**
 * AI Visibility score is currently modeled using proxy signals (DASHBOARD.md):
 * - brand/domain/page mentions from Google+Bing top SERP results
 * - weighted share of voice by ranking position
 * - content structure readiness from content analysis outputs
 * - topical coverage from SERP terms vs tracked/my-covered terms
 * This shape keeps `modeled`, `dataSource`, and `components` explicit so a future
 * direct AI-answer provider can replace/extend each signal without a breaking API.
 */
async function getAiVisibilityDashboardModule({
  websiteId = null,
  country = 'US',
  dateFrom = null,
  dateTo = null,
}) {
  const normalizedWebsiteId = normalizeWebsiteId(websiteId);
  const normalizedCountry = normalizeCountryCode(country);
  const normalizedDateFrom = normalizeDateInput(dateFrom, false);
  const normalizedDateTo = normalizeDateInput(dateTo, true);

  const [scopeWebsites, trackedKeywords, serpRows, contentRows, aiSerpRows] = await Promise.all([
    resolveScopeWebsites(normalizedWebsiteId),
    keywordService.getTrackedKeywords(normalizedWebsiteId),
    getSerpRows({
      websiteId: normalizedWebsiteId,
      country: normalizedCountry,
      dateFrom: normalizedDateFrom,
      dateTo: normalizedDateTo,
    }),
    getContentRows({
      websiteId: normalizedWebsiteId,
      dateFrom: normalizedDateFrom,
      dateTo: normalizedDateTo,
    }),
    getAiSerpRows({
      websiteId: normalizedWebsiteId,
      country: normalizedCountry,
      dateFrom: normalizedDateFrom,
      dateTo: normalizedDateTo,
    }),
  ]);

  const myDomains = new Set(
    scopeWebsites
      .map((website) => extractDomain(website.domain || ''))
      .filter(Boolean)
  );

  const brandTerms = new Set();
  scopeWebsites.forEach((website) => {
    extractBrandTerms(website).forEach((term) => brandTerms.add(term));
  });

  const primaryBrandTerm = [...brandTerms][0] || '';
  const sourceRows = aiSerpRows;
  const totalRows = sourceRows.length;
  const queryCount = new Set(sourceRows.map((row) => row.query).filter(Boolean)).size;
  const myRows = sourceRows.filter((row) => (
    Number(row.appears_on_site) === 1 || rowMatchesMyDomain(row, myDomains)
  ));
  const competitorRows = sourceRows.filter((row) => (
    !(Number(row.appears_on_site) === 1 || rowMatchesMyDomain(row, myDomains))
  ));
  const totalWeight = sourceRows.reduce((sum, row) => sum + rankWeight(row.position), 0);
  const myWeight = myRows.reduce((sum, row) => sum + rankWeight(row.position), 0);
  const uniqueMyPages = new Set(myRows.map((row) => row.url).filter(Boolean));

  const brandMentionCount = sourceRows.filter((row) => {
    if (rowMatchesMyDomain(row, myDomains)) {
      return true;
    }
    const text = `${row.title || ''} ${row.snippet || ''}`.toLowerCase();
    return [...brandTerms].some((term) => text.includes(term));
  }).length;

  const brandMentionRate = safeDivide(brandMentionCount, totalRows);
  const domainCitationRate = safeDivide(myRows.length, totalRows);
  const pageCitationRate = safeDivide(uniqueMyPages.size, Math.max(1, queryCount));
  const shareOfVoiceRate = safeDivide(myWeight, totalWeight);
  const contentStructureRate = 0;
  const aiTotalRows = sourceRows.length;
  const aiMyRows = myRows;
  const aiKeywordSet = new Set(sourceRows.map((row) => String(row.query || '').trim().toLowerCase()).filter(Boolean));
  const aiCoveredKeywordSet = new Set(aiMyRows.map((row) => String(row.query || '').trim().toLowerCase()).filter(Boolean));
  const aiCitationRate = safeDivide(aiMyRows.length, aiTotalRows);
  const aiPromptCoverageRate = safeDivide(aiCoveredKeywordSet.size, aiKeywordSet.size || 1);

  const competitorTermCounts = new Map();
  for (const row of competitorRows) {
    tokenize(`${row.title || ''} ${row.snippet || ''}`).forEach((term) => {
      competitorTermCounts.set(term, (competitorTermCounts.get(term) || 0) + 1);
    });
  }
  const dominantCompetitorTerms = [...competitorTermCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 40)
    .map(([term]) => term);

  const myCoverageTerms = buildKeywordCoverageSet(myRows);
  trackedKeywords.forEach((item) => tokenize(item.keyword || '').forEach((term) => myCoverageTerms.add(term)));
  const coveredDominantTopicCount = dominantCompetitorTerms.filter((term) => myCoverageTerms.has(term)).length;
  const topicalCoverageRate = safeDivide(coveredDominantTopicCount, dominantCompetitorTerms.length || 1);

  const dataConfidence = clamp(Math.min(aiTotalRows, 120) / 120, 0, 1);

  const proxyScore = computeMainScore({
    brandMentionRate,
    domainCitationRate,
    pageCitationRate,
    shareOfVoiceRate,
    contentStructureRate,
    topicalCoverageRate,
    dataConfidence,
  });
  const hasAiCitationData = aiTotalRows > 0;
  const aiCitationScore = Math.round(((aiCitationRate * 0.7) + (aiPromptCoverageRate * 0.3)) * 100);
  const score = hasAiCitationData ? aiCitationScore : 0;

  const staticQualityScore = Math.round(((contentStructureRate * 0.55) + (topicalCoverageRate * 0.45)) * 100);
  const trendFromRows = buildTrendFromRows(sourceRows, myDomains, {
    staticQualityScore,
    primaryBrandTerm,
  });

  await saveAiVisibilitySnapshot({
    websiteId: normalizedWebsiteId,
    country: normalizedCountry,
    score,
    breakdown: {
      brandMentionRate,
      domainCitationRate,
      pageCitationRate,
      shareOfVoiceRate,
      contentStructureRate,
      topicalCoverageRate,
      myCitations: myRows.length,
      totalCitations: totalRows,
      aiCitationRate,
      aiPromptCoverageRate,
      aiCitationRows: aiTotalRows,
    },
  });

  const snapshotTrend = await getSnapshotTrend({
    websiteId: normalizedWebsiteId,
    country: normalizedCountry,
    dateFrom: normalizedDateFrom,
    dateTo: normalizedDateTo,
  });

  const trendByDate = new Map();
  snapshotTrend.forEach((entry) => trendByDate.set(entry.date, entry));
  trendFromRows.forEach((entry) => trendByDate.set(entry.date, entry));
  const mergedTrend = [...trendByDate.values()].sort((left, right) => left.date.localeCompare(right.date));

  const topPages = buildTopPages(myRows, queryCount);
  const competitorComparison = buildCompetitorComparison(sourceRows, myDomains);
  const missingTopics = buildMissingTopics({
    competitorRows,
    myRows,
    trackedKeywords,
    contentRows,
  });

  const opportunities = [];
  if (domainCitationRate < 0.15 && totalRows > 0) {
    opportunities.push('Low domain citation rate in top SERP sets. Expand pages for tracked intent clusters.');
  }
  if (pageCitationRate < 0.2 && totalRows > 0) {
    opportunities.push('Few distinct pages are visible. Build multiple purpose-specific pages instead of one URL.');
  }
  if (topicalCoverageRate < 0.4 && dominantCompetitorTerms.length > 0) {
    opportunities.push('Topical coverage is weak versus recurring competitor terms. Prioritize missing-topic clusters.');
  }
  if (contentStructureRate < 0.55 && contentRows.length > 0) {
    opportunities.push('Structured content readiness is below target. Improve H1/meta/internal links and first-paragraph keyword placement.');
  }
  if (hasAiCitationData && aiCitationRate < 0.15) {
    opportunities.push('AI SERP citation share is low. Build pages that directly answer tracked prompt intent and include stronger entity cues.');
  }
  if (hasAiCitationData && aiPromptCoverageRate < 0.35) {
    opportunities.push('Your site appears in too few AI prompt sets. Expand coverage for missing question variants.');
  }

  return {
    metadata: {
      websiteId: normalizedWebsiteId,
      country: normalizedCountry,
      modeled: !hasAiCitationData,
      dataSource: hasAiCitationData ? 'ai-serp' : 'none',
      modelVersion: 'ai-visibility-proxy-v1',
      generatedAt: new Date().toISOString(),
      notes: [
        hasAiCitationData
          ? 'AI-only score from AI SERP citation data.'
          : 'No AI SERP citation data yet. Run AI SERP Workspace scans first.',
        hasAiCitationData
          ? 'AI SERP data is sourced from workspace scans.'
          : 'Score remains 0 until AI SERP citations are available in this scope.',
      ],
      sampleSize: {
        serpRows: 0,
        trackedQueries: queryCount,
        contentAnalyses: 0,
        aiSerpCitations: aiTotalRows,
        aiSerpPrompts: aiKeywordSet.size,
      },
    },
    score: {
      value: score,
      modeled: !hasAiCitationData,
      confidence: Math.round(dataConfidence * 100),
      components: {
        brandMentions: Math.round(brandMentionRate * 100),
        domainMentions: Math.round(domainCitationRate * 100),
        pageMentions: Math.round(pageCitationRate * 100),
        shareOfVoice: Math.round(shareOfVoiceRate * 100),
        contentStructure: Math.round(contentStructureRate * 100),
        topicalCoverage: Math.round(topicalCoverageRate * 100),
        aiCitationShare: Math.round(aiCitationRate * 100),
        aiPromptCoverage: Math.round(aiPromptCoverageRate * 100),
      },
    },
    trend: mergedTrend.slice(-30),
    topPages,
    competitorComparison,
    missingTopics,
    opportunities,
  };
}

module.exports = {
  getAiVisibilityDashboardModule,
};
