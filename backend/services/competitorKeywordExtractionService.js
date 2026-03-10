const { crawlPage, normalizeSiteUrl, normalizeInternalUrl } = require('../analyzers/siteAuditor');
const { throttle } = require('../utils/rateLimiter');
const {
  buildClusters,
  buildKeywordObjects,
  buildResearchSummary,
  canonicalizeKeyword,
  getRootDomain,
  normalizeKeywordText,
  parseListInput,
  uniqueStrings,
  updateKeywordScoresWithSignals,
} = require('./keywordResearchEnhancer');

const DEFAULT_MAX_SITES = 3;
const MAX_MAX_SITES = 5;
const DEFAULT_MAX_PAGES_PER_SITE = 5;
const MAX_MAX_PAGES_PER_SITE = 12;
const DEFAULT_KEYWORD_LIMIT = 100;
const MAX_KEYWORD_LIMIT = 250;
const MIN_PHRASE_WORDS = 2;
const MAX_PHRASE_WORDS = 8;
const BODY_NGRAM_MIN = 2;
const BODY_NGRAM_MAX = 5;
const BODY_NGRAM_MIN_COUNT = 2;
const BODY_NGRAM_PAGE_LIMIT = 6;
const PATH_SKIP_TOKENS = new Set([
  'blog',
  'blogs',
  'category',
  'categories',
  'tag',
  'tags',
  'page',
  'pages',
  'author',
  'authors',
  'post',
  'posts',
  'news',
  'article',
  'articles',
  'index',
  'home',
]);
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'this',
  'to',
  'was',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  'your',
]);
const CANDIDATE_WEIGHTS = {
  title: 6,
  h1: 5,
  h2: 3,
  path: 2,
  body: 1,
};

function clamp(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.min(Math.max(number, min), max);
}

function tokenizeText(value) {
  return normalizeKeywordText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function buildSeedTokenSet(seedKeyword) {
  return new Set(tokenizeText(seedKeyword).filter((token) => token.length > 1));
}

function normalizeExtractionOptions(input = {}) {
  return {
    maxSites: clamp(input.maxSites || DEFAULT_MAX_SITES, 1, MAX_MAX_SITES),
    maxPagesPerSite: clamp(input.maxPagesPerSite || DEFAULT_MAX_PAGES_PER_SITE, 1, MAX_MAX_PAGES_PER_SITE),
    keywordLimit: clamp(input.keywordLimit || DEFAULT_KEYWORD_LIMIT, 20, MAX_KEYWORD_LIMIT),
    goalPrompt: String(input.goalPrompt || '').trim(),
    brandTerms: parseListInput(input.brandTerms),
    localCities: parseListInput(input.localCities),
    localServices: parseListInput(input.localServices),
    targetAudience: String(input.targetAudience || '').trim(),
  };
}

function splitCompetitorInputs(inputSites) {
  if (Array.isArray(inputSites)) {
    return inputSites
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  return String(inputSites || '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCompetitorSites(inputSites, maxSites) {
  const values = splitCompetitorInputs(inputSites);
  const seen = new Set();
  const normalized = [];

  for (const value of values) {
    try {
      const siteUrl = normalizeSiteUrl(value);
      const key = getRootDomain(siteUrl);

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      normalized.push(siteUrl);

      if (normalized.length >= maxSites) {
        break;
      }
    } catch {
      // Ignore invalid URLs/domains.
    }
  }

  return normalized;
}

async function crawlCompetitorSite(siteUrl, maxPagesPerSite) {
  const rootUrl = normalizeSiteUrl(siteUrl);
  const site = new URL(rootUrl);
  const canonicalHost = site.hostname.replace(/^www\./i, '').toLowerCase();
  const queue = [{ url: rootUrl, depth: 0 }];
  const visited = new Set();
  const pages = [];

  while (queue.length > 0 && pages.length < maxPagesPerSite) {
    const next = queue.shift();
    const normalizedUrl = normalizeInternalUrl(next.url, rootUrl, canonicalHost);

    if (!normalizedUrl || visited.has(normalizedUrl)) {
      continue;
    }

    visited.add(normalizedUrl);
    await throttle();

    const pageResult = await crawlPage(normalizedUrl, rootUrl, canonicalHost, next.depth);
    pages.push(pageResult);

    for (const internalLink of pageResult.discoveredInternalLinks || []) {
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

  return {
    siteUrl: rootUrl,
    domain: canonicalHost,
    pages,
  };
}

function splitPhraseCandidates(text) {
  const normalized = normalizeKeywordText(text);

  if (!normalized) {
    return [];
  }

  return uniqueStrings([
    normalized,
    ...normalized
      .split(/\s*[|:•]\s*|\s+-\s+|\s+\/\s+/)
      .map((item) => normalizeKeywordText(item))
      .filter(Boolean),
  ]);
}

function isUsablePhrase(value) {
  const normalized = normalizeKeywordText(value);

  if (!normalized) {
    return false;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return false;
  }

  const tokens = tokenizeText(normalized);
  if (tokens.length < MIN_PHRASE_WORDS || tokens.length > MAX_PHRASE_WORDS) {
    return false;
  }

  if (tokens.every((token) => STOP_WORDS.has(token))) {
    return false;
  }

  const firstToken = tokens[0];
  const lastToken = tokens[tokens.length - 1];
  if (STOP_WORDS.has(firstToken) || STOP_WORDS.has(lastToken)) {
    return false;
  }

  if (tokens.some((token) => token.length > 30)) {
    return false;
  }

  return true;
}

function extractPathCandidate(pageUrl) {
  try {
    const parsed = new URL(pageUrl);
    const pathTokens = parsed.pathname
      .split('/')
      .flatMap((segment) => segment.split(/[-_]+/))
      .map((token) => token.toLowerCase().trim())
      .filter((token) => token && !PATH_SKIP_TOKENS.has(token) && !/^\d+$/.test(token));

    if (pathTokens.length < MIN_PHRASE_WORDS) {
      return null;
    }

    const candidate = normalizeKeywordText(pathTokens.join(' '));
    return isUsablePhrase(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function extractRepeatedBodyCandidates(bodyText, seedTokens) {
  if (!bodyText || seedTokens.size === 0) {
    return [];
  }

  const tokens = tokenizeText(bodyText).filter((token) => token.length > 1);
  if (tokens.length < 10) {
    return [];
  }

  const counts = new Map();

  for (let size = BODY_NGRAM_MIN; size <= BODY_NGRAM_MAX; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const gramTokens = tokens.slice(index, index + size);

      if (!gramTokens.some((token) => seedTokens.has(token))) {
        continue;
      }

      if (STOP_WORDS.has(gramTokens[0]) || STOP_WORDS.has(gramTokens[gramTokens.length - 1])) {
        continue;
      }

      if (gramTokens.every((token) => STOP_WORDS.has(token))) {
        continue;
      }

      const candidate = gramTokens.join(' ');
      if (!isUsablePhrase(candidate)) {
        continue;
      }

      counts.set(candidate, (counts.get(candidate) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= BODY_NGRAM_MIN_COUNT)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, BODY_NGRAM_PAGE_LIMIT)
    .map(([phrase]) => phrase);
}

function addCandidate(aggregated, keyword, sourceType, page, site) {
  if (!isUsablePhrase(keyword)) {
    return;
  }

  const key = canonicalizeKeyword(keyword);
  if (!key) {
    return;
  }

  const existing = aggregated.get(key) || {
    keyword,
    totalWeight: 0,
    titleHits: 0,
    h1Hits: 0,
    h2Hits: 0,
    pathHits: 0,
    bodyHits: 0,
    sourceDomains: new Set(),
    sourcePages: new Set(),
  };

  if (keyword.length > existing.keyword.length) {
    existing.keyword = keyword;
  }

  existing.totalWeight += CANDIDATE_WEIGHTS[sourceType] || 1;
  existing.sourceDomains.add(site.domain);
  existing.sourcePages.add(page.url);

  if (sourceType === 'title') existing.titleHits += 1;
  if (sourceType === 'h1') existing.h1Hits += 1;
  if (sourceType === 'h2') existing.h2Hits += 1;
  if (sourceType === 'path') existing.pathHits += 1;
  if (sourceType === 'body') existing.bodyHits += 1;

  aggregated.set(key, existing);
}

function collectKeywordCandidates(siteResult, seedTokens) {
  const aggregated = new Map();

  for (const page of siteResult.pages || []) {
    if (!page || page.statusCode == null || page.statusCode >= 400) {
      continue;
    }

    for (const candidate of splitPhraseCandidates(page.title)) {
      addCandidate(aggregated, candidate, 'title', page, siteResult);
    }

    for (const candidate of page.h1Texts || []) {
      addCandidate(aggregated, candidate, 'h1', page, siteResult);
    }

    for (const candidate of page.h2Texts || []) {
      addCandidate(aggregated, candidate, 'h2', page, siteResult);
    }

    const pathCandidate = extractPathCandidate(page.url);
    if (pathCandidate) {
      addCandidate(aggregated, pathCandidate, 'path', page, siteResult);
    }

    for (const candidate of extractRepeatedBodyCandidates(page.bodyText, seedTokens)) {
      addCandidate(aggregated, candidate, 'body', page, siteResult);
    }
  }

  return aggregated;
}

function buildCompetitorCsvRows(keywords = []) {
  return keywords.map((item) => ({
    keyword: item.keyword,
    intent: item.intent || '',
    cluster: item.clusterLabel || '',
    priorityScore: item.priorityScore ?? '',
    opportunityScore: item.opportunityScore ?? '',
    difficultyEstimate: item.difficultyEstimate ?? '',
    extractionScore: item.extractionScore ?? '',
    sourceSiteCount: item.sourceSiteCount ?? 0,
    sourcePageCount: item.sourcePageCount ?? 0,
    sourceDomains: (item.sourceDomains || []).join(' | '),
    samplePages: (item.sourcePages || []).join(' | '),
    recommendedPageType: item.recommendedPageType || '',
    notes: Array.isArray(item.notes) ? item.notes.join(' | ') : '',
  }));
}

async function extractCompetitorKeywords({ seedKeyword, competitorSites, options = {} }) {
  const normalizedSeedKeyword = normalizeKeywordText(seedKeyword);
  if (!normalizedSeedKeyword) {
    throw new Error('Seed keyword is required.');
  }

  const extractionOptions = normalizeExtractionOptions(options);
  const normalizedSites = normalizeCompetitorSites(competitorSites, extractionOptions.maxSites);

  if (normalizedSites.length === 0) {
    throw new Error('Add at least one valid competitor site or domain.');
  }

  const seedTokens = buildSeedTokenSet(normalizedSeedKeyword);
  const crawledSites = [];

  for (const site of normalizedSites) {
    try {
      const result = await crawlCompetitorSite(site, extractionOptions.maxPagesPerSite);
      crawledSites.push(result);
    } catch (err) {
      crawledSites.push({
        siteUrl: site,
        domain: getRootDomain(site),
        pages: [],
        error: err.message,
      });
    }
  }

  const aggregated = new Map();

  for (const siteResult of crawledSites) {
    const siteCandidates = collectKeywordCandidates(siteResult, seedTokens);

    for (const [key, value] of siteCandidates.entries()) {
      const existing = aggregated.get(key) || {
        keyword: value.keyword,
        totalWeight: 0,
        titleHits: 0,
        h1Hits: 0,
        h2Hits: 0,
        pathHits: 0,
        bodyHits: 0,
        sourceDomains: new Set(),
        sourcePages: new Set(),
      };

      if (value.keyword.length > existing.keyword.length) {
        existing.keyword = value.keyword;
      }

      existing.totalWeight += value.totalWeight;
      existing.titleHits += value.titleHits;
      existing.h1Hits += value.h1Hits;
      existing.h2Hits += value.h2Hits;
      existing.pathHits += value.pathHits;
      existing.bodyHits += value.bodyHits;

      for (const domain of value.sourceDomains) {
        existing.sourceDomains.add(domain);
      }

      for (const pageUrl of value.sourcePages) {
        existing.sourcePages.add(pageUrl);
      }

      aggregated.set(key, existing);
    }
  }

  if (aggregated.size === 0) {
    throw new Error('No competitor keywords were extracted. Try adding stronger competitor sites or a broader seed keyword.');
  }

  const keywordMetadata = new Map(aggregated.entries());
  const maxWeight = Math.max(...[...keywordMetadata.values()].map((item) => item.totalWeight), 1);
  let keywords = updateKeywordScoresWithSignals(
    buildKeywordObjects(
      normalizedSeedKeyword,
      [...keywordMetadata.values()].map((item) => item.keyword),
      extractionOptions
    )
  );

  keywords = keywords
    .map((item) => {
      const metadata = keywordMetadata.get(item.canonicalKeyword);
      const sourceDomains = [...(metadata?.sourceDomains || [])].sort();
      const sourcePages = [...(metadata?.sourcePages || [])].sort();
      const sourceSiteCount = sourceDomains.length;
      const sourcePageCount = sourcePages.length;
      const extractionScore = Math.min(
        100,
        Math.round(
          ((metadata?.totalWeight || 0) / maxWeight) * 70
          + Math.min(sourceSiteCount * 12, 20)
          + Math.min(sourcePageCount * 2, 10)
        )
      );
      const opportunityScore = Math.round(((item.opportunityScore || item.priorityScore) * 0.8) + (extractionScore * 0.2));
      const priorityScore = Math.round((item.priorityScore * 0.72) + (extractionScore * 0.28));

      return {
        ...item,
        extractionScore,
        opportunityScore,
        priorityScore,
        sourceDomains,
        sourcePages: sourcePages.slice(0, 5),
        sourceSiteCount,
        sourcePageCount,
        extractionSignals: {
          titleHits: metadata?.titleHits || 0,
          h1Hits: metadata?.h1Hits || 0,
          h2Hits: metadata?.h2Hits || 0,
          pathHits: metadata?.pathHits || 0,
          bodyHits: metadata?.bodyHits || 0,
        },
        notes: uniqueStrings([
          ...(item.notes || []),
          sourceSiteCount > 0 ? `Found on ${sourceSiteCount} competitor site${sourceSiteCount === 1 ? '' : 's'}.` : null,
          sourcePageCount > 0 ? `Seen on ${sourcePageCount} competitor page${sourcePageCount === 1 ? '' : 's'}.` : null,
          metadata?.titleHits ? `Appears in competitor titles ${metadata.titleHits} time${metadata.titleHits === 1 ? '' : 's'}.` : null,
          metadata?.h1Hits ? `Appears in H1 headings ${metadata.h1Hits} time${metadata.h1Hits === 1 ? '' : 's'}.` : null,
          metadata?.h2Hits ? `Appears in H2 headings ${metadata.h2Hits} time${metadata.h2Hits === 1 ? '' : 's'}.` : null,
          metadata?.bodyHits ? `Repeated in competitor body copy ${metadata.bodyHits} time${metadata.bodyHits === 1 ? '' : 's'}.` : null,
          sourceDomains.length > 0 ? `Source sites: ${sourceDomains.slice(0, 3).join(', ')}${sourceDomains.length > 3 ? '...' : ''}.` : null,
        ].filter(Boolean)),
      };
    })
    .sort((left, right) => right.priorityScore - left.priorityScore || right.extractionScore - left.extractionScore || left.keyword.localeCompare(right.keyword))
    .slice(0, extractionOptions.keywordLimit);

  const clusters = buildClusters(normalizedSeedKeyword, keywords, extractionOptions);
  const summary = {
    ...buildResearchSummary(normalizedSeedKeyword, keywords, clusters),
    totalCompetitorSites: crawledSites.filter((site) => (site.pages || []).length > 0).length,
    totalPagesCrawled: crawledSites.reduce((sum, site) => sum + ((site.pages || []).length), 0),
  };

  return {
    seedKeyword: normalizedSeedKeyword,
    competitorSites: crawledSites.map((site) => ({
      siteUrl: site.siteUrl,
      domain: site.domain,
      pagesCrawled: (site.pages || []).length,
      successfulPages: (site.pages || []).filter((page) => page.statusCode && page.statusCode < 400).length,
      failedPages: (site.pages || []).filter((page) => page.statusCode == null || page.statusCode >= 400).length,
      error: site.error || null,
    })),
    keywords,
    clusters,
    summary,
    csvRows: buildCompetitorCsvRows(keywords),
    extractionOptions,
    extractedAt: new Date().toISOString(),
  };
}

module.exports = {
  extractCompetitorKeywords,
};
