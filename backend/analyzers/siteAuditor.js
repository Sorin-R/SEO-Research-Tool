const axios = require('axios');
const cheerio = require('cheerio');
const { clamp, countWords } = require('../utils/helpers');
const { throttle } = require('../utils/rateLimiter');

const DEFAULT_MAX_PAGES = 25;
const MAX_MAX_PAGES = 50;
const THIN_CONTENT_WORDS = 200;
const TITLE_MIN_LENGTH = 30;
const TITLE_MAX_LENGTH = 60;
const META_MIN_LENGTH = 70;
const META_MAX_LENGTH = 160;
const SLOW_PAGE_MS = 2500;
const SKIP_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|mp3|zip|rar|webm|avi|mov|css|js|xml|json|txt)$/i;
const USER_AGENT = 'Mozilla/5.0 (compatible; SEOResearchTool/1.0; +https://hostinger.com)';

const ISSUE_DEFINITIONS = {
  brokenPage: {
    id: 'broken-page',
    label: 'Broken pages',
    severity: 'high',
    description: 'Pages returning 4xx or 5xx responses waste crawl budget and frustrate users.',
  },
  brokenInternalLink: {
    id: 'broken-internal-link',
    label: 'Broken internal links',
    severity: 'high',
    description: 'Internal links pointing to broken pages weaken crawl paths and user journeys.',
  },
  missingTitle: {
    id: 'missing-title',
    label: 'Missing title tags',
    severity: 'high',
    description: 'Pages without title tags lose a key ranking and click-through signal.',
  },
  duplicateTitle: {
    id: 'duplicate-title',
    label: 'Duplicate title tags',
    severity: 'medium',
    description: 'Duplicate titles make it harder for search engines to understand page uniqueness.',
  },
  missingMeta: {
    id: 'missing-meta-description',
    label: 'Missing meta descriptions',
    severity: 'medium',
    description: 'Missing descriptions reduce control over how pages appear in search results.',
  },
  duplicateMeta: {
    id: 'duplicate-meta-description',
    label: 'Duplicate meta descriptions',
    severity: 'medium',
    description: 'Duplicate meta descriptions often signal thin or duplicated page messaging.',
  },
  missingH1: {
    id: 'missing-h1',
    label: 'Missing H1 tags',
    severity: 'medium',
    description: 'Missing H1 headings weaken topical structure for users and crawlers.',
  },
  thinContent: {
    id: 'thin-content',
    label: 'Thin content pages',
    severity: 'medium',
    description: 'Pages with very little body content may struggle to rank or satisfy intent.',
  },
  noindex: {
    id: 'noindex-page',
    label: 'Noindex pages',
    severity: 'low',
    description: 'Noindex pages are excluded from Google and should be intentional.',
  },
  missingCanonical: {
    id: 'missing-canonical',
    label: 'Missing canonical tags',
    severity: 'low',
    description: 'Canonical tags help search engines consolidate duplicate or similar URLs.',
  },
  slowPage: {
    id: 'slow-page',
    label: 'Slow pages',
    severity: 'low',
    description: 'Slow responses can hurt user experience and crawl efficiency.',
  },
  imagesWithoutAlt: {
    id: 'images-without-alt',
    label: 'Images missing alt text',
    severity: 'low',
    description: 'Missing alt text weakens accessibility and image SEO relevance.',
  },
  redirectPage: {
    id: 'redirect-page',
    label: 'Redirecting URLs',
    severity: 'low',
    description: 'Internal URLs that redirect add unnecessary hops for users and crawlers.',
  },
};

async function auditSite(inputUrl, options = {}) {
  const rootUrl = normalizeSiteUrl(inputUrl);
  const maxPages = clamp(Number.parseInt(options.maxPages, 10) || DEFAULT_MAX_PAGES, 1, MAX_MAX_PAGES);
  const site = new URL(rootUrl);
  const canonicalHost = stripWww(site.hostname);
  const queue = [{ url: rootUrl, depth: 0 }];
  const visited = new Set();
  const pages = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const next = queue.shift();
    const normalizedUrl = normalizeInternalUrl(next.url, rootUrl, canonicalHost);

    if (!normalizedUrl || visited.has(normalizedUrl)) {
      continue;
    }

    visited.add(normalizedUrl);
    await throttle();

    const pageResult = await crawlPage(normalizedUrl, rootUrl, canonicalHost, next.depth);
    pages.push(pageResult);

    for (const internalLink of pageResult.discoveredInternalLinks) {
      if (visited.has(internalLink)) {
        continue;
      }

      if (queue.some((entry) => entry.url === internalLink)) {
        continue;
      }

      queue.push({
        url: internalLink,
        depth: next.depth + 1,
      });
    }
  }

  if (pages.length === 0) {
    throw new Error('Could not crawl any pages for this site.');
  }

  const duplicates = findDuplicates(pages);
  const brokenInternalLinks = collectBrokenInternalLinks(pages);
  const pageRows = pages.map((page) => buildPageRow(page, duplicates, brokenInternalLinks));
  const totals = calculateTotals(pageRows, brokenInternalLinks);
  const topIssues = buildTopIssues(totals);
  const auditScore = calculateAuditScore(pageRows.length, totals);

  return {
    url: rootUrl,
    host: canonicalHost,
    maxPages,
    crawledPages: pageRows.length,
    auditScore,
    checkedAt: new Date().toISOString(),
    totals,
    topIssues,
    pages: pageRows.sort(comparePagesByPriority),
    brokenInternalLinks: brokenInternalLinks.slice(0, 50),
  };
}

async function crawlPage(requestUrl, siteUrl, canonicalHost, depth) {
  const startedAt = Date.now();

  try {
    const response = await axios.get(requestUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    const finalUrl = normalizeInternalUrl(
      response.request?.res?.responseUrl || requestUrl,
      siteUrl,
      canonicalHost
    ) || requestUrl;
    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
    const loadTimeMs = Date.now() - startedAt;

    if (!isHtml || response.status >= 400) {
      return {
        url: finalUrl,
        requestedUrl: requestUrl,
        depth,
        statusCode: response.status,
        redirected: finalUrl !== requestUrl,
        loadTimeMs,
        title: '',
        titleLength: 0,
        metaDescription: '',
        metaDescriptionLength: 0,
        canonical: null,
        h1Count: 0,
        wordCount: 0,
        imageCount: 0,
        imagesWithoutAlt: 0,
        internalLinkCount: 0,
        externalLinkCount: 0,
        noindex: hasNoindexHeader(response.headers['x-robots-tag']),
        discoveredInternalLinks: [],
      };
    }

    const $ = cheerio.load(typeof response.data === 'string' ? response.data : '');
    $('script, style, noscript').remove();

    const title = $('title').first().text().trim();
    const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';
    const canonicalHref = $('link[rel="canonical"]').attr('href');
    const canonical = canonicalHref
      ? normalizeInternalUrl(canonicalHref, finalUrl, canonicalHost) || canonicalHref.trim()
      : null;
    const metaRobots = $('meta[name="robots"]').attr('content')?.trim() || '';
    const noindex = /noindex/i.test(metaRobots) || hasNoindexHeader(response.headers['x-robots-tag']);
    const h1Count = $('h1').filter((_, element) => $(element).text().trim()).length;

    const bodyClone = $('body').clone();
    bodyClone.find('nav, footer, header, aside, script, style').remove();
    const bodyText = bodyClone.text().replace(/\s+/g, ' ').trim();
    const wordCount = countWords(bodyText);

    const images = $('img').toArray();
    const imagesWithoutAlt = images.filter((image) => !($(image).attr('alt') || '').trim()).length;

    const discoveredInternalLinks = [];
    let externalLinkCount = 0;

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      const normalizedHref = normalizeInternalUrl(href, finalUrl, canonicalHost);

      if (normalizedHref) {
        if (!discoveredInternalLinks.includes(normalizedHref)) {
          discoveredInternalLinks.push(normalizedHref);
        }
        return;
      }

      const absoluteHref = safeResolveUrl(href, finalUrl);
      if (absoluteHref && isHttpUrl(absoluteHref)) {
        externalLinkCount += 1;
      }
    });

    return {
      url: finalUrl,
      requestedUrl: requestUrl,
      depth,
      statusCode: response.status,
      redirected: finalUrl !== requestUrl,
      loadTimeMs,
      title,
      titleLength: title.length,
      metaDescription,
      metaDescriptionLength: metaDescription.length,
      canonical,
      h1Count,
      wordCount,
      imageCount: images.length,
      imagesWithoutAlt,
      internalLinkCount: discoveredInternalLinks.length,
      externalLinkCount,
      noindex,
      discoveredInternalLinks,
    };
  } catch (error) {
    return {
      url: requestUrl,
      requestedUrl: requestUrl,
      depth,
      statusCode: null,
      redirected: false,
      loadTimeMs: Date.now() - startedAt,
      title: '',
      titleLength: 0,
      metaDescription: '',
      metaDescriptionLength: 0,
      canonical: null,
      h1Count: 0,
      wordCount: 0,
      imageCount: 0,
      imagesWithoutAlt: 0,
      internalLinkCount: 0,
      externalLinkCount: 0,
      noindex: false,
      fetchError: error.message,
      discoveredInternalLinks: [],
    };
  }
}

function buildPageRow(page, duplicates, brokenInternalLinks) {
  const brokenLinkMatches = brokenInternalLinks.filter((entry) => entry.source === page.url);
  const issues = [];

  if (page.statusCode == null || page.statusCode >= 400) issues.push(ISSUE_DEFINITIONS.brokenPage);
  if (page.redirected) issues.push(ISSUE_DEFINITIONS.redirectPage);
  if (!page.title) issues.push(ISSUE_DEFINITIONS.missingTitle);
  if (page.title && duplicates.duplicateTitles.has(normalizeComparableText(page.title))) issues.push(ISSUE_DEFINITIONS.duplicateTitle);
  if (!page.metaDescription) issues.push(ISSUE_DEFINITIONS.missingMeta);
  if (
    page.metaDescription &&
    duplicates.duplicateMetaDescriptions.has(normalizeComparableText(page.metaDescription))
  ) {
    issues.push(ISSUE_DEFINITIONS.duplicateMeta);
  }
  if (page.h1Count === 0) issues.push(ISSUE_DEFINITIONS.missingH1);
  if (page.wordCount > 0 && page.wordCount < THIN_CONTENT_WORDS) issues.push(ISSUE_DEFINITIONS.thinContent);
  if (page.noindex) issues.push(ISSUE_DEFINITIONS.noindex);
  if (!page.canonical && page.statusCode && page.statusCode < 400) issues.push(ISSUE_DEFINITIONS.missingCanonical);
  if (page.loadTimeMs >= SLOW_PAGE_MS) issues.push(ISSUE_DEFINITIONS.slowPage);
  if (page.imagesWithoutAlt > 0) issues.push(ISSUE_DEFINITIONS.imagesWithoutAlt);
  if (brokenLinkMatches.length > 0) issues.push(ISSUE_DEFINITIONS.brokenInternalLink);

  return {
    url: page.url,
    path: buildDisplayPath(page.url),
    statusCode: page.statusCode,
    redirected: page.redirected,
    loadTimeMs: page.loadTimeMs,
    depth: page.depth,
    title: page.title,
    titleLength: page.titleLength,
    metaDescriptionLength: page.metaDescriptionLength,
    h1Count: page.h1Count,
    wordCount: page.wordCount,
    imageCount: page.imageCount,
    imagesWithoutAlt: page.imagesWithoutAlt,
    internalLinkCount: page.internalLinkCount,
    externalLinkCount: page.externalLinkCount,
    noindex: page.noindex,
    canonical: page.canonical,
    brokenInternalLinks: brokenLinkMatches.length,
    fetchError: page.fetchError || null,
    issues: issues.map((issue) => ({
      id: issue.id,
      label: issue.label,
      severity: issue.severity,
    })),
  };
}

function calculateTotals(pageRows, brokenInternalLinks) {
  const totalImagesWithoutAlt = pageRows.reduce((sum, page) => sum + (page.imagesWithoutAlt || 0), 0);

  return {
    brokenPages: pageRows.filter((page) => page.statusCode == null || page.statusCode >= 400).length,
    redirectPages: pageRows.filter((page) => page.redirected).length,
    missingTitles: pageRows.filter((page) => !page.title).length,
    duplicateTitles: pageRows.filter((page) => page.issues.some((issue) => issue.id === ISSUE_DEFINITIONS.duplicateTitle.id)).length,
    missingMetaDescriptions: pageRows.filter((page) => page.metaDescriptionLength === 0).length,
    duplicateMetaDescriptions: pageRows.filter((page) => page.issues.some((issue) => issue.id === ISSUE_DEFINITIONS.duplicateMeta.id)).length,
    missingH1: pageRows.filter((page) => page.h1Count === 0).length,
    thinContentPages: pageRows.filter((page) => page.wordCount > 0 && page.wordCount < THIN_CONTENT_WORDS).length,
    noindexPages: pageRows.filter((page) => page.noindex).length,
    missingCanonical: pageRows.filter((page) => !page.canonical && page.statusCode && page.statusCode < 400).length,
    slowPages: pageRows.filter((page) => page.loadTimeMs >= SLOW_PAGE_MS).length,
    imagesWithoutAlt: totalImagesWithoutAlt,
    brokenInternalLinks: brokenInternalLinks.length,
    pagesWithIssues: pageRows.filter((page) => page.issues.length > 0).length,
  };
}

function buildTopIssues(totals) {
  const issueCounts = [
    { ...ISSUE_DEFINITIONS.brokenPage, count: totals.brokenPages },
    { ...ISSUE_DEFINITIONS.brokenInternalLink, count: totals.brokenInternalLinks },
    { ...ISSUE_DEFINITIONS.missingTitle, count: totals.missingTitles },
    { ...ISSUE_DEFINITIONS.duplicateTitle, count: totals.duplicateTitles },
    { ...ISSUE_DEFINITIONS.missingMeta, count: totals.missingMetaDescriptions },
    { ...ISSUE_DEFINITIONS.duplicateMeta, count: totals.duplicateMetaDescriptions },
    { ...ISSUE_DEFINITIONS.missingH1, count: totals.missingH1 },
    { ...ISSUE_DEFINITIONS.thinContent, count: totals.thinContentPages },
    { ...ISSUE_DEFINITIONS.noindex, count: totals.noindexPages },
    { ...ISSUE_DEFINITIONS.missingCanonical, count: totals.missingCanonical },
    { ...ISSUE_DEFINITIONS.slowPage, count: totals.slowPages },
    { ...ISSUE_DEFINITIONS.imagesWithoutAlt, count: totals.imagesWithoutAlt },
    { ...ISSUE_DEFINITIONS.redirectPage, count: totals.redirectPages },
  ];

  return issueCounts
    .filter((issue) => issue.count > 0)
    .sort((left, right) => {
      const severityOrder = compareSeverity(left.severity, right.severity);
      if (severityOrder !== 0) return severityOrder;
      return right.count - left.count;
    })
    .slice(0, 8);
}

function calculateAuditScore(totalPages, totals) {
  if (totalPages <= 0) {
    return 0;
  }

  const weightedPenalty = (
    (totals.brokenPages / totalPages) * 28 +
    (totals.brokenInternalLinks / Math.max(totalPages, 1)) * 16 +
    (totals.missingTitles / totalPages) * 12 +
    (totals.duplicateTitles / totalPages) * 10 +
    (totals.missingMetaDescriptions / totalPages) * 8 +
    (totals.duplicateMetaDescriptions / totalPages) * 7 +
    (totals.missingH1 / totalPages) * 8 +
    (totals.thinContentPages / totalPages) * 8 +
    (totals.noindexPages / totalPages) * 4 +
    (totals.missingCanonical / totalPages) * 4 +
    (totals.slowPages / totalPages) * 5 +
    (Math.min(totals.imagesWithoutAlt, totalPages * 3) / Math.max(totalPages, 1)) * 3 +
    (totals.redirectPages / totalPages) * 3
  );

  return clamp(Math.round(100 - weightedPenalty), 0, 100);
}

function collectBrokenInternalLinks(pages) {
  const pageStatusMap = new Map(
    pages.map((page) => [page.url, page.statusCode])
  );
  const brokenLinks = [];

  for (const page of pages) {
    for (const internalLink of page.discoveredInternalLinks) {
      const targetStatus = pageStatusMap.get(internalLink);
      if (targetStatus != null && targetStatus >= 400) {
        brokenLinks.push({
          source: page.url,
          target: internalLink,
          statusCode: targetStatus,
        });
      }
    }
  }

  return uniqueBrokenLinks(brokenLinks);
}

function uniqueBrokenLinks(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.source}::${entry.target}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function findDuplicates(pages) {
  const titleCounts = new Map();
  const metaCounts = new Map();

  for (const page of pages) {
    if (page.title) {
      const normalizedTitle = normalizeComparableText(page.title);
      titleCounts.set(normalizedTitle, (titleCounts.get(normalizedTitle) || 0) + 1);
    }

    if (page.metaDescription) {
      const normalizedMeta = normalizeComparableText(page.metaDescription);
      metaCounts.set(normalizedMeta, (metaCounts.get(normalizedMeta) || 0) + 1);
    }
  }

  return {
    duplicateTitles: new Set(
      [...titleCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([value]) => value)
    ),
    duplicateMetaDescriptions: new Set(
      [...metaCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([value]) => value)
    ),
  };
}

function comparePagesByPriority(left, right) {
  const severityComparison = compareSeverity(highestSeverity(left.issues), highestSeverity(right.issues));
  if (severityComparison !== 0) return severityComparison;

  if (right.issues.length !== left.issues.length) {
    return right.issues.length - left.issues.length;
  }

  return String(left.path || left.url).localeCompare(String(right.path || right.url));
}

function highestSeverity(issues = []) {
  if (issues.some((issue) => issue.severity === 'high')) return 'high';
  if (issues.some((issue) => issue.severity === 'medium')) return 'medium';
  return 'low';
}

function compareSeverity(left, right) {
  const order = { high: 0, medium: 1, low: 2 };
  return (order[left] ?? 3) - (order[right] ?? 3);
}

function normalizeSiteUrl(value) {
  let normalized = String(value || '').trim();

  if (!normalized) {
    throw new Error('Site URL is required.');
  }

  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  const parsedUrl = new URL(normalized);
  parsedUrl.hash = '';
  parsedUrl.search = '';

  return `${parsedUrl.origin}${normalizePathname(parsedUrl.pathname)}`;
}

function normalizeInternalUrl(href, baseUrl, canonicalHost) {
  const resolvedUrl = safeResolveUrl(href, baseUrl);

  if (!resolvedUrl || !isHttpUrl(resolvedUrl)) {
    return null;
  }

  if (stripWww(resolvedUrl.hostname) !== canonicalHost) {
    return null;
  }

  if (SKIP_EXTENSIONS.test(resolvedUrl.pathname)) {
    return null;
  }

  resolvedUrl.hash = '';
  resolvedUrl.search = '';
  return `${resolvedUrl.origin}${normalizePathname(resolvedUrl.pathname)}`;
}

function safeResolveUrl(href, baseUrl) {
  if (!href || typeof href !== 'string') {
    return null;
  }

  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || /^javascript:/i.test(trimmed) || /^mailto:/i.test(trimmed) || /^tel:/i.test(trimmed)) {
    return null;
  }

  try {
    return new URL(trimmed, baseUrl);
  } catch {
    return null;
  }
}

function normalizePathname(pathname) {
  const value = String(pathname || '/').trim();
  if (!value || value === '/') {
    return '/';
  }

  const normalized = value.startsWith('/') ? value : `/${value}`;
  return normalized.replace(/\/+$/, '') || '/';
}

function stripWww(hostname) {
  return String(hostname || '').replace(/^www\./i, '').toLowerCase();
}

function buildDisplayPath(url) {
  try {
    const parsedUrl = new URL(url);
    const pathname = normalizePathname(parsedUrl.pathname);
    return pathname === '/' ? parsedUrl.hostname : pathname;
  } catch {
    return url;
  }
}

function normalizeComparableText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function hasNoindexHeader(value) {
  return /noindex/i.test(String(value || ''));
}

function isHttpUrl(url) {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

module.exports = {
  auditSite,
};
