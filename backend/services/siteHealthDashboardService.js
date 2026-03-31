const axios = require('axios');
const db = require('../database');
const localStore = require('../utils/localStore');
const siteAuditService = require('./siteAuditService');

const USER_AGENT = 'Mozilla/5.0 (compatible; SEOResearchTool/1.0; +https://hostinger.com)';
const CHECK_KEYS = [
  'broken-links',
  'redirects',
  'missing-titles',
  'duplicate-titles',
  'missing-meta',
  'missing-h1',
  'canonical-issues',
  'robots-txt',
  'sitemap',
  'noindex',
];

const CHECK_DEFINITIONS = {
  'broken-links': {
    key: 'broken-links',
    label: 'Broken links',
    severity: 'critical',
    recommendation: 'Fix or redirect broken internal URLs and remove dead links from templates/navigation.',
  },
  redirects: {
    key: 'redirects',
    label: 'Redirects',
    severity: 'low',
    recommendation: 'Update internal links to point directly at final URLs to reduce crawl hops.',
  },
  'missing-titles': {
    key: 'missing-titles',
    label: 'Missing titles',
    severity: 'high',
    recommendation: 'Add unique title tags for each affected page, aligned with page intent.',
  },
  'duplicate-titles': {
    key: 'duplicate-titles',
    label: 'Duplicate titles',
    severity: 'medium',
    recommendation: 'Rewrite duplicate titles so each page has a unique search intent target.',
  },
  'missing-meta': {
    key: 'missing-meta',
    label: 'Missing meta',
    severity: 'medium',
    recommendation: 'Add concise, unique meta descriptions for pages with missing snippets.',
  },
  'missing-h1': {
    key: 'missing-h1',
    label: 'Missing H1',
    severity: 'medium',
    recommendation: 'Add one clear H1 on each page that reflects the primary topic.',
  },
  'canonical-issues': {
    key: 'canonical-issues',
    label: 'Canonical issues',
    severity: 'medium',
    recommendation: 'Add self-referencing canonicals or fix canonical targets on affected URLs.',
  },
  'robots-txt': {
    key: 'robots-txt',
    label: 'Robots.txt',
    severity: 'high',
    recommendation: 'Publish a valid robots.txt at the root and ensure it does not block critical pages.',
  },
  sitemap: {
    key: 'sitemap',
    label: 'Sitemap',
    severity: 'high',
    recommendation: 'Provide a reachable XML sitemap and reference it in robots.txt when possible.',
  },
  noindex: {
    key: 'noindex',
    label: 'Noindex',
    severity: 'low',
    recommendation: 'Review noindex usage and remove it from pages meant to rank organically.',
  },
};

function normalizeWebsiteId(value) {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeSeverity(value) {
  const severity = String(value || '').toLowerCase().trim();
  if (severity === 'critical' || severity === 'high' || severity === 'medium' || severity === 'low') {
    return severity;
  }
  return 'low';
}

function compareSeverity(left, right) {
  const order = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return (order[left] ?? 9) - (order[right] ?? 9);
}

function toSiteRootUrl(value) {
  let raw = String(value || '').trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }
  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch {
    return null;
  }
}

function toSqlDateTime(value) {
  const parsed = parseDate(value) || new Date();
  const pad = (num) => String(num).padStart(2, '0');
  return [
    `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}`,
    `${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}:${pad(parsed.getUTCSeconds())}`,
  ].join(' ');
}

function dedupePageUrls(urls = []) {
  const seen = new Set();
  const result = [];
  for (const item of urls) {
    const url = String(item || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

function hasIssue(page, issueId) {
  return Array.isArray(page?.issues) && page.issues.some((issue) => issue.id === issueId);
}

function buildIssueChecks(auditResult, technicalChecks) {
  const pages = Array.isArray(auditResult?.pages) ? auditResult.pages : [];

  const brokenLinkPages = dedupePageUrls(
    pages
      .filter((page) => (
        (page?.statusCode != null && Number(page.statusCode) >= 400)
        || Number(page?.brokenInternalLinks || 0) > 0
        || hasIssue(page, 'broken-page')
        || hasIssue(page, 'broken-internal-link')
      ))
      .map((page) => page.url)
  );

  const redirects = dedupePageUrls(
    pages.filter((page) => page?.redirected === true || hasIssue(page, 'redirect-page')).map((page) => page.url)
  );

  const missingTitles = dedupePageUrls(
    pages.filter((page) => !String(page?.title || '').trim() || hasIssue(page, 'missing-title')).map((page) => page.url)
  );

  const duplicateTitles = dedupePageUrls(
    pages.filter((page) => hasIssue(page, 'duplicate-title')).map((page) => page.url)
  );

  const missingMeta = dedupePageUrls(
    pages
      .filter((page) => Number(page?.metaDescriptionLength || 0) <= 0 || hasIssue(page, 'missing-meta-description'))
      .map((page) => page.url)
  );

  const missingH1 = dedupePageUrls(
    pages.filter((page) => Number(page?.h1Count || 0) <= 0 || hasIssue(page, 'missing-h1')).map((page) => page.url)
  );

  const canonicalIssues = dedupePageUrls(
    pages.filter((page) => !String(page?.canonical || '').trim() || hasIssue(page, 'missing-canonical')).map((page) => page.url)
  );

  const noindexPages = dedupePageUrls(
    pages.filter((page) => page?.noindex === true || hasIssue(page, 'noindex-page')).map((page) => page.url)
  );

  const robotsFail = technicalChecks.robotsTxt.status !== 'pass';
  const sitemapFail = technicalChecks.sitemap.status !== 'pass';

  return [
    {
      ...CHECK_DEFINITIONS['broken-links'],
      scope: 'page',
      count: brokenLinkPages.length,
      affectedPages: brokenLinkPages,
      status: brokenLinkPages.length > 0 ? 'fail' : 'pass',
    },
    {
      ...CHECK_DEFINITIONS.redirects,
      scope: 'page',
      count: redirects.length,
      affectedPages: redirects,
      status: redirects.length > 0 ? 'fail' : 'pass',
    },
    {
      ...CHECK_DEFINITIONS['missing-titles'],
      scope: 'page',
      count: missingTitles.length,
      affectedPages: missingTitles,
      status: missingTitles.length > 0 ? 'fail' : 'pass',
    },
    {
      ...CHECK_DEFINITIONS['duplicate-titles'],
      scope: 'page',
      count: duplicateTitles.length,
      affectedPages: duplicateTitles,
      status: duplicateTitles.length > 0 ? 'fail' : 'pass',
    },
    {
      ...CHECK_DEFINITIONS['missing-meta'],
      scope: 'page',
      count: missingMeta.length,
      affectedPages: missingMeta,
      status: missingMeta.length > 0 ? 'fail' : 'pass',
    },
    {
      ...CHECK_DEFINITIONS['missing-h1'],
      scope: 'page',
      count: missingH1.length,
      affectedPages: missingH1,
      status: missingH1.length > 0 ? 'fail' : 'pass',
    },
    {
      ...CHECK_DEFINITIONS['canonical-issues'],
      scope: 'page',
      count: canonicalIssues.length,
      affectedPages: canonicalIssues,
      status: canonicalIssues.length > 0 ? 'fail' : 'pass',
    },
    {
      ...CHECK_DEFINITIONS['robots-txt'],
      scope: 'site',
      count: robotsFail ? 1 : 0,
      affectedPages: [],
      status: technicalChecks.robotsTxt.status,
      details: technicalChecks.robotsTxt,
      severity: robotsFail ? CHECK_DEFINITIONS['robots-txt'].severity : 'low',
    },
    {
      ...CHECK_DEFINITIONS.sitemap,
      scope: 'site',
      count: sitemapFail ? 1 : 0,
      affectedPages: [],
      status: technicalChecks.sitemap.status,
      details: technicalChecks.sitemap,
      severity: sitemapFail ? CHECK_DEFINITIONS.sitemap.severity : 'low',
    },
    {
      ...CHECK_DEFINITIONS.noindex,
      scope: 'page',
      count: noindexPages.length,
      affectedPages: noindexPages,
      status: noindexPages.length > 0 ? 'fail' : 'pass',
    },
  ];
}

function buildIssueRowsFromChecks({
  checks,
  websiteId,
  siteAuditId,
  detectedAt,
}) {
  const rows = [];

  for (const check of checks) {
    if (check.count <= 0) {
      continue;
    }

    if (check.scope === 'site') {
      rows.push({
        website_id: websiteId,
        site_audit_id: siteAuditId,
        scope: 'site',
        page_url: null,
        issue_key: check.key,
        issue_label: check.label,
        severity: normalizeSeverity(check.severity),
        recommendation: check.recommendation,
        detected_at: detectedAt,
      });
      continue;
    }

    for (const pageUrl of check.affectedPages) {
      rows.push({
        website_id: websiteId,
        site_audit_id: siteAuditId,
        scope: 'page',
        page_url: pageUrl,
        issue_key: check.key,
        issue_label: check.label,
        severity: normalizeSeverity(check.severity),
        recommendation: check.recommendation,
        detected_at: detectedAt,
      });
    }
  }

  return rows;
}

function summarizeIssueCounts(issueRows = [], checks = []) {
  const counts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const row of issueRows) {
    const severity = normalizeSeverity(row.severity);
    counts[severity] += 1;
  }

  const failingChecks = checks.filter((check) => check.count > 0).length;
  const totalChecks = CHECK_KEYS.length;
  const passedChecks = Math.max(totalChecks - failingChecks, 0);

  return {
    ...counts,
    total: counts.critical + counts.high + counts.medium + counts.low,
    failingChecks,
    passedChecks,
    totalChecks,
  };
}

function computeSiteHealthScore(issueCounts, crawledPages) {
  if (!issueCounts || issueCounts.total <= 0) {
    return 100;
  }

  const weights = {
    critical: 12,
    high: 8,
    medium: 4,
    low: 2,
  };

  const weightedPenalty = (
    issueCounts.critical * weights.critical
    + issueCounts.high * weights.high
    + issueCounts.medium * weights.medium
    + issueCounts.low * weights.low
  );

  const normalizedPages = Math.max(Number(crawledPages) || 1, 1);
  const maxPenalty = (normalizedPages * weights.critical) + 40;
  const score = Math.round(100 - ((weightedPenalty / maxPenalty) * 100));
  return Math.max(0, Math.min(100, score));
}

function scoreGrade(score) {
  const value = Number(score) || 0;
  if (value >= 90) return 'excellent';
  if (value >= 75) return 'good';
  if (value >= 60) return 'needs-attention';
  return 'critical';
}

function buildTopIssues(checks = []) {
  return checks
    .filter((check) => check.count > 0)
    .sort((left, right) => {
      const severityOrder = compareSeverity(left.severity, right.severity);
      if (severityOrder !== 0) return severityOrder;
      return Number(right.count || 0) - Number(left.count || 0);
    })
    .slice(0, 10)
    .map((check) => ({
      key: check.key,
      label: check.label,
      severity: normalizeSeverity(check.severity),
      count: check.count,
      recommendation: check.recommendation,
      status: check.status,
      samplePages: (check.affectedPages || []).slice(0, 3),
      details: check.details || null,
    }));
}

function buildAffectedPages(issueRows = []) {
  const pageMap = new Map();

  for (const row of issueRows) {
    if (!row.page_url) continue;
    const key = String(row.page_url);
    const existing = pageMap.get(key) || {
      url: key,
      issues: [],
      highestSeverity: 'low',
    };

    existing.issues.push({
      key: row.issue_key,
      label: row.issue_label,
      severity: normalizeSeverity(row.severity),
      recommendation: row.recommendation || null,
    });

    if (compareSeverity(normalizeSeverity(row.severity), existing.highestSeverity) < 0) {
      existing.highestSeverity = normalizeSeverity(row.severity);
    }

    pageMap.set(key, existing);
  }

  return [...pageMap.values()]
    .map((entry) => ({
      url: entry.url,
      issueCount: entry.issues.length,
      highestSeverity: entry.highestSeverity,
      issues: entry.issues,
    }))
    .sort((left, right) => {
      const severityOrder = compareSeverity(left.highestSeverity, right.highestSeverity);
      if (severityOrder !== 0) return severityOrder;
      if (right.issueCount !== left.issueCount) return right.issueCount - left.issueCount;
      return left.url.localeCompare(right.url);
    })
    .slice(0, 25);
}

async function persistSiteIssues(issueRows, siteAuditId, websiteId) {
  try {
    if (siteAuditId != null) {
      await db.query('DELETE FROM site_issues WHERE site_audit_id = ?', [siteAuditId]);
    } else if (websiteId != null) {
      await db.query('DELETE FROM site_issues WHERE website_id = ?', [websiteId]);
    }

    if (issueRows.length > 0) {
      await Promise.all(
        issueRows.map((row) => (
          db.query(
            `INSERT INTO site_issues (
              website_id,
              site_audit_id,
              scope,
              page_url,
              issue_key,
              issue_label,
              severity,
              recommendation,
              detected_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.website_id,
              row.site_audit_id,
              row.scope,
              row.page_url,
              row.issue_key,
              row.issue_label,
              normalizeSeverity(row.severity),
              row.recommendation,
              row.detected_at,
            ]
          )
        ))
      );
    }
  } catch (err) {
    console.warn('[SiteHealthDashboardService] DB unavailable, using local store for site issues:', err.message);
    await localStore.replaceSiteIssuesForAudit(siteAuditId, websiteId, issueRows);
  }
}

function extractSitemapUrlsFromRobots(content = '') {
  const matches = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^sitemap:/i.test(line))
    .map((line) => line.replace(/^sitemap:\s*/i, '').trim())
    .filter(Boolean);

  return dedupePageUrls(matches);
}

async function fetchText(url) {
  const response = await axios.get(url, {
    timeout: 10000,
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/plain,text/xml,application/xml,text/html',
    },
  });
  return response;
}

async function getTechnicalFileChecks(siteUrl) {
  const rootUrl = toSiteRootUrl(siteUrl);
  if (!rootUrl) {
    return {
      robotsTxt: {
        status: 'warning',
        message: 'Could not determine site root URL for robots.txt check.',
        url: null,
      },
      sitemap: {
        status: 'warning',
        message: 'Could not determine site root URL for sitemap check.',
        url: null,
      },
    };
  }

  const robotsUrl = `${rootUrl}/robots.txt`;
  const robotsResult = {
    status: 'fail',
    message: 'robots.txt missing or unreachable.',
    url: robotsUrl,
  };

  const sitemapCandidates = [];

  try {
    const robotsResponse = await fetchText(robotsUrl);
    if (robotsResponse.status >= 200 && robotsResponse.status < 300) {
      robotsResult.status = 'pass';
      robotsResult.message = 'robots.txt is reachable.';
      const discovered = extractSitemapUrlsFromRobots(robotsResponse.data);
      sitemapCandidates.push(...discovered);
    } else {
      robotsResult.message = `robots.txt returned HTTP ${robotsResponse.status}.`;
    }
  } catch (err) {
    robotsResult.status = 'warning';
    robotsResult.message = `robots.txt check failed: ${err.message}`;
  }

  sitemapCandidates.push(`${rootUrl}/sitemap.xml`);
  const uniqueCandidates = dedupePageUrls(sitemapCandidates);

  const sitemapResult = {
    status: 'fail',
    message: 'No reachable sitemap found.',
    url: uniqueCandidates[0] || `${rootUrl}/sitemap.xml`,
  };

  for (const candidate of uniqueCandidates) {
    try {
      const response = await fetchText(candidate);
      const body = typeof response.data === 'string' ? response.data.toLowerCase() : '';
      const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
      const looksLikeSitemap = body.includes('<urlset') || body.includes('<sitemapindex') || contentType.includes('xml');

      if (response.status >= 200 && response.status < 300 && looksLikeSitemap) {
        sitemapResult.status = 'pass';
        sitemapResult.message = 'Sitemap is reachable.';
        sitemapResult.url = candidate;
        break;
      }

      if (response.status >= 200 && response.status < 300 && !looksLikeSitemap) {
        sitemapResult.status = 'warning';
        sitemapResult.message = `Sitemap URL responded but does not look like XML: ${candidate}`;
        sitemapResult.url = candidate;
      }
    } catch (err) {
      sitemapResult.status = sitemapResult.status === 'pass' ? 'pass' : 'warning';
      sitemapResult.message = sitemapResult.status === 'pass'
        ? sitemapResult.message
        : `Sitemap checks encountered errors: ${err.message}`;
    }
  }

  return {
    robotsTxt: robotsResult,
    sitemap: sitemapResult,
  };
}

function filterHistoryByDate(rows, dateFrom, dateTo) {
  const start = parseDate(dateFrom);
  const end = parseDate(dateTo);

  if (!start && !end) {
    return rows;
  }

  return rows.filter((row) => {
    const raw = row?.updated_at || row?.created_at;
    const parsed = parseDate(raw);
    if (!parsed) return false;
    if (start && parsed < start) return false;
    if (end && parsed > end) return false;
    return true;
  });
}

async function getSiteHealthDashboardModule({
  websiteId = null,
  dateFrom = null,
  dateTo = null,
} = {}) {
  const normalizedWebsiteId = normalizeWebsiteId(websiteId);
  const historyRows = await siteAuditService.getSiteAuditHistory(100, normalizedWebsiteId);
  const filteredHistory = filterHistoryByDate(historyRows, dateFrom, dateTo)
    .sort((left, right) => new Date(right.updated_at || right.created_at) - new Date(left.updated_at || left.created_at));
  const sortedFullHistory = [...historyRows]
    .sort((left, right) => new Date(right.updated_at || right.created_at) - new Date(left.updated_at || left.created_at));
  const usedRangeFallback = filteredHistory.length === 0 && sortedFullHistory.length > 0;
  const scopedHistory = usedRangeFallback ? sortedFullHistory : filteredHistory;

  const latestHistory = scopedHistory[0] || null;
  if (!latestHistory) {
    return {
      available: false,
      source: 'site-audit',
      reason: 'no-site-audits',
      metadata: {
        websiteId: normalizedWebsiteId,
        checks: CHECK_KEYS,
        dateRangeFallback: false,
      },
      score: {
        value: null,
        grade: null,
      },
      issueCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        total: 0,
        failingChecks: 0,
        passedChecks: CHECK_KEYS.length,
        totalChecks: CHECK_KEYS.length,
      },
      checks: [],
      topIssues: [],
      affectedPages: [],
      insights: [],
    };
  }

  const latestAudit = await siteAuditService.getSiteAuditHistoryItem(latestHistory.id, normalizedWebsiteId);
  if (!latestAudit) {
    return {
      available: false,
      source: 'site-audit',
      reason: 'latest-audit-missing',
      metadata: {
        websiteId: normalizedWebsiteId,
        auditId: latestHistory.id,
        checks: CHECK_KEYS,
        dateRangeFallback: usedRangeFallback,
      },
      score: {
        value: null,
        grade: null,
      },
      issueCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        total: 0,
        failingChecks: 0,
        passedChecks: CHECK_KEYS.length,
        totalChecks: CHECK_KEYS.length,
      },
      checks: [],
      topIssues: [],
      affectedPages: [],
      insights: [],
    };
  }

  const technicalChecks = await getTechnicalFileChecks(latestAudit.url || latestHistory.url);
  const checks = buildIssueChecks(latestAudit, technicalChecks);
  const detectedAt = latestAudit.checkedAt || latestHistory.updated_at || latestHistory.created_at || new Date().toISOString();
  const issueRows = buildIssueRowsFromChecks({
    checks,
    websiteId: normalizedWebsiteId,
    siteAuditId: latestHistory.id,
    detectedAt: toSqlDateTime(detectedAt),
  });
  await persistSiteIssues(issueRows, latestHistory.id, normalizedWebsiteId);

  const issueCounts = summarizeIssueCounts(issueRows, checks);
  const scoreValue = computeSiteHealthScore(issueCounts, latestAudit.crawledPages || latestHistory.total_pages || 0);
  const topIssues = buildTopIssues(checks);
  const affectedPages = buildAffectedPages(issueRows);

  const insights = topIssues.slice(0, 4).map((issue) => (
    `${issue.label}: ${issue.count} affected ${issue.count === 1 ? 'item' : 'items'}. ${issue.recommendation}`
  ));

  return {
    available: true,
    source: 'site-audit+http-checks',
    metadata: {
      websiteId: normalizedWebsiteId,
      auditId: latestHistory.id,
      checkedAt: detectedAt,
      url: latestAudit.url || latestHistory.url,
      crawledPages: latestAudit.crawledPages || latestHistory.total_pages || 0,
      checks: CHECK_KEYS,
      dateRangeFallback: usedRangeFallback,
    },
    score: {
      value: scoreValue,
      grade: scoreGrade(scoreValue),
    },
    issueCounts,
    checks,
    topIssues,
    affectedPages,
    insights,
  };
}

module.exports = {
  getSiteHealthDashboardModule,
};
