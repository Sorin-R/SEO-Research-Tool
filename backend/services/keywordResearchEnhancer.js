const QUESTION_PREFIXES = ['how', 'what', 'why', 'when', 'where', 'who', 'which', 'can', 'does', 'is', 'are', 'should'];
const TRANSACTIONAL_TERMS = ['buy', 'price', 'pricing', 'cost', 'quote', 'service', 'services', 'agency', 'company', 'hire', 'provider', 'software', 'tool', 'tools', 'package', 'packages'];
const COMMERCIAL_TERMS = ['best', 'top', 'review', 'reviews', 'vs', 'versus', 'compare', 'comparison', 'alternative', 'alternatives', 'platform', 'solution', 'solutions'];
const INFORMATIONAL_TERMS = ['guide', 'tips', 'tutorial', 'template', 'examples', 'example', 'learn', 'checklist', 'strategy', 'meaning', 'ideas'];
const LOCAL_TERMS = ['near me', 'nearby', 'local', 'in ', 'around '];
const PAGE_TYPE_BY_INTENT = {
  informational: 'Guide / article',
  commercial: 'Comparison / category page',
  transactional: 'Service / money page',
  local: 'Local landing page',
  navigational: 'Homepage / brand page',
};
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'best',
  'by',
  'for',
  'from',
  'how',
  'in',
  'into',
  'is',
  'me',
  'near',
  'of',
  'on',
  'or',
  'the',
  'to',
  'top',
  'vs',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
]);
const QUESTION_WORDS_SET = new Set(QUESTION_PREFIXES);
const WEAK_DOMAIN_TERMS = ['wordpress.com', 'blogspot.com', 'medium.com', 'substack.com', 'wixsite.com', 'weebly.com'];
const FORUM_DOMAIN_TERMS = ['reddit.com', 'quora.com', 'forum', 'community', 'discuss', 'stackoverflow.com'];

function normalizeKeywordText(value) {
  return String(value || '')
    .replace(/[|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function simpleSingularize(token) {
  if (token.endsWith('ies') && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith('sses') || token.endsWith('ss')) {
    return token;
  }

  if (token.endsWith('s') && token.length > 3) {
    return token.slice(0, -1);
  }

  return token;
}

function tokenize(value) {
  return normalizeKeywordText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(simpleSingularize);
}

function canonicalizeKeyword(value) {
  const tokens = tokenize(value);
  return tokens.join(' ');
}

function uniqueStrings(values) {
  const seen = new Set();
  const results = [];

  for (const value of values || []) {
    const normalized = normalizeKeywordText(value);
    if (!normalized) continue;

    const key = canonicalizeKeyword(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(normalized);
  }

  return results;
}

function parseListInput(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }

  return uniqueStrings(
    String(value || '')
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function getRootDomain(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let url = raw;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  }
}

function keywordContainsAny(keyword, phrases) {
  const lower = String(keyword || '').toLowerCase();
  return phrases.some((phrase) => lower.includes(String(phrase || '').toLowerCase()));
}

function inferIntent(keyword, options = {}) {
  const lower = String(keyword || '').toLowerCase();
  const brandTerms = parseListInput(options.brandTerms).map((term) => term.toLowerCase());

  if (brandTerms.length > 0 && brandTerms.some((term) => lower.includes(term))) {
    return 'navigational';
  }

  if (LOCAL_TERMS.some((term) => lower.includes(term)) || parseListInput(options.localCities).some((city) => lower.includes(city.toLowerCase()))) {
    return 'local';
  }

  if (TRANSACTIONAL_TERMS.some((term) => lower.includes(term))) {
    return 'transactional';
  }

  if (COMMERCIAL_TERMS.some((term) => lower.includes(term))) {
    return 'commercial';
  }

  if (QUESTION_PREFIXES.some((prefix) => lower.startsWith(`${prefix} `)) || INFORMATIONAL_TERMS.some((term) => lower.includes(term))) {
    return 'informational';
  }

  return options.defaultIntent || 'informational';
}

function detectModifiers(keyword) {
  const lower = String(keyword || '').toLowerCase();
  const tags = [];
  const allModifiers = [
    ...QUESTION_PREFIXES,
    'best',
    'top',
    'compare',
    'comparison',
    'vs',
    'pricing',
    'price',
    'cost',
    'near me',
    'template',
    'guide',
    'checklist',
    'services',
    'agency',
    'alternatives',
  ];

  for (const modifier of allModifiers) {
    if (lower.includes(modifier)) {
      tags.push(modifier);
    }
  }

  return uniqueStrings(tags);
}

function extractTopicTokens(keyword, seedKeyword, options = {}) {
  const seedTokens = new Set(tokenize(seedKeyword));
  const cityTokens = new Set(parseListInput(options.localCities).flatMap((city) => tokenize(city)));
  const serviceTokens = new Set(parseListInput(options.localServices).flatMap((service) => tokenize(service)));

  return tokenize(keyword).filter((token) => {
    if (STOP_WORDS.has(token)) return false;
    if (seedTokens.has(token)) return false;
    if (cityTokens.has(token)) return false;
    if (serviceTokens.has(token)) return false;
    return true;
  });
}

function buildClusterLabel(topicTokens, seedKeyword, intent) {
  if (!topicTokens.length) {
    return `${seedKeyword} (${intent})`;
  }

  return `${topicTokens.slice(0, 4).join(' ')} (${intent})`;
}

function recommendPageType(intent, keyword) {
  if (intent === 'local' && /service|agency|company|hire/i.test(keyword)) {
    return 'Local service page';
  }

  return PAGE_TYPE_BY_INTENT[intent] || 'Dedicated supporting page';
}

function calculateDifficultyEstimate(keyword, intent) {
  const wordCount = tokenize(keyword).length;
  let score = 50;

  if (wordCount >= 4) score -= 8;
  if (wordCount >= 6) score -= 6;
  if (keywordContainsAny(keyword, COMMERCIAL_TERMS)) score += 10;
  if (intent === 'transactional') score += 12;
  if (intent === 'local') score -= 5;
  if (keywordContainsAny(keyword, ['best', 'top', 'agency', 'services'])) score += 6;
  if (keywordContainsAny(keyword, ['how', 'what', 'template', 'checklist', 'ideas'])) score -= 7;

  return Math.max(10, Math.min(85, Math.round(score)));
}

function calculateRelevanceScore(keyword, seedKeyword, options = {}) {
  const seedTokens = tokenize(seedKeyword);
  const keywordTokens = tokenize(keyword);
  const overlap = keywordTokens.filter((token) => seedTokens.includes(token)).length;
  const overlapRatio = seedTokens.length ? overlap / seedTokens.length : 0;
  const exactPhrase = String(keyword || '').toLowerCase().includes(String(seedKeyword || '').toLowerCase());
  const promptTerms = parseListInput(options.goalPrompt).flatMap((entry) => tokenize(entry));
  const promptOverlap = promptTerms.filter((token) => keywordTokens.includes(token)).length;

  let score = overlapRatio * 70;
  if (exactPhrase) score += 20;
  score += Math.min(promptOverlap * 3, 10);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateBusinessIntentScore(intent, keyword) {
  let score = 35;

  if (intent === 'transactional') score = 92;
  if (intent === 'commercial') score = 78;
  if (intent === 'local') score = 88;
  if (intent === 'navigational') score = 55;

  if (keywordContainsAny(keyword, ['price', 'pricing', 'cost', 'quote'])) {
    score += 5;
  }

  if (keywordContainsAny(keyword, ['template', 'example', 'ideas'])) {
    score -= 8;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateOpportunityScore({ difficultyEstimate, businessIntentScore, trendScore = 50, enrichment }) {
  const weakDomainBoost = enrichment?.weakDomainCount ? Math.min(enrichment.weakDomainCount * 4, 12) : 0;
  const forumBoost = enrichment?.forumCount ? Math.min(enrichment.forumCount * 3, 9) : 0;
  const titleMatchPenalty = typeof enrichment?.titleMatchRatio === 'number'
    ? Math.max(0, (enrichment.titleMatchRatio - 60) * 0.2)
    : 0;

  const base = (100 - difficultyEstimate) * 0.45 + businessIntentScore * 0.3 + trendScore * 0.25;
  return Math.max(0, Math.min(100, Math.round(base + weakDomainBoost + forumBoost - titleMatchPenalty)));
}

function detectBrandedStatus(keyword, options = {}) {
  const brandTerms = parseListInput(options.brandTerms);
  if (brandTerms.length === 0) {
    return 'unknown';
  }

  const lower = String(keyword || '').toLowerCase();
  return brandTerms.some((term) => lower.includes(term.toLowerCase())) ? 'branded' : 'non-branded';
}

function normalizeKeywordObjects(keywords) {
  const deduped = new Map();

  for (const item of keywords) {
    const key = item.canonicalKeyword;
    const existing = deduped.get(key);

    if (!existing || item.priorityScore > existing.priorityScore || item.keyword.length > existing.keyword.length) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()];
}

function buildKeywordObjects(seedKeyword, keywords, options = {}) {
  const list = uniqueStrings(keywords);

  const keywordObjects = list.map((keyword) => {
    const normalized = normalizeKeywordText(keyword);
    const canonicalKeyword = canonicalizeKeyword(normalized);
    const wordCount = tokenize(normalized).length;
    const intent = inferIntent(normalized, options);
    const modifiers = detectModifiers(normalized);
    const brandedStatus = detectBrandedStatus(normalized, options);
    const topicTokens = extractTopicTokens(normalized, seedKeyword, options);
    const clusterTokens = [...topicTokens.slice(0, 2)].sort();
    const clusterLabel = buildClusterLabel(clusterTokens, seedKeyword, intent);
    const clusterKey = `${intent}::${clusterTokens.join('-') || canonicalizeKeyword(seedKeyword)}`;
    const recommendedPageType = recommendPageType(intent, normalized);
    const relevanceScore = calculateRelevanceScore(normalized, seedKeyword, options);
    const businessIntentScore = calculateBusinessIntentScore(intent, normalized);
    const difficultyEstimate = calculateDifficultyEstimate(normalized, intent);
    const priorityScore = Math.round((relevanceScore * 0.45) + (businessIntentScore * 0.35) + ((100 - difficultyEstimate) * 0.2));

    return {
      keyword: normalized,
      canonicalKeyword,
      wordCount,
      intent,
      modifiers,
      brandedStatus,
      isQuestion: QUESTION_PREFIXES.some((prefix) => normalized.toLowerCase().startsWith(`${prefix} `)) || normalized.includes('?'),
      isLocal: intent === 'local',
      topicTokens: clusterTokens,
      clusterKey,
      clusterLabel,
      recommendedPageType,
      relevanceScore,
      businessIntentScore,
      difficultyEstimate,
      priorityScore,
      searchPatternScore: modifiers.length * 8 + (wordCount >= 4 ? 10 : 0),
      notes: [],
    };
  });

  return normalizeKeywordObjects(keywordObjects).sort((a, b) => b.priorityScore - a.priorityScore || a.keyword.localeCompare(b.keyword));
}

function applyKeywordFilters(keywords, filters = {}) {
  const includeTerms = parseListInput(filters.includeTerms).map((term) => term.toLowerCase());
  const excludeTerms = parseListInput(filters.excludeTerms).map((term) => term.toLowerCase());
  const modifierTerms = parseListInput(filters.modifierTerms).map((term) => term.toLowerCase());
  const intents = Array.isArray(filters.intents) ? filters.intents.filter(Boolean) : [];
  const minWords = Number.parseInt(filters.minWords, 10) || 0;
  const maxWords = Number.parseInt(filters.maxWords, 10) || 0;
  const brandedMode = String(filters.brandedMode || 'all');
  const questionsOnly = filters.questionsOnly === true || filters.questionsOnly === 'true';

  return keywords.filter((item) => {
    const lower = item.keyword.toLowerCase();

    if (includeTerms.length > 0 && !includeTerms.every((term) => lower.includes(term))) {
      return false;
    }

    if (excludeTerms.some((term) => lower.includes(term))) {
      return false;
    }

    if (modifierTerms.length > 0 && !modifierTerms.some((term) => lower.includes(term))) {
      return false;
    }

    if (intents.length > 0 && !intents.includes(item.intent)) {
      return false;
    }

    if (minWords && item.wordCount < minWords) {
      return false;
    }

    if (maxWords && item.wordCount > maxWords) {
      return false;
    }

    if (questionsOnly && !item.isQuestion) {
      return false;
    }

    if (brandedMode === 'branded' && item.brandedStatus !== 'branded') {
      return false;
    }

    if (brandedMode === 'non-branded' && item.brandedStatus !== 'non-branded') {
      return false;
    }

    return true;
  });
}

function buildClusterBrief(cluster, seedKeyword, options = {}) {
  const topKeywords = cluster.keywords.slice(0, 6).map((item) => item.keyword);
  const questionKeywords = cluster.keywords.filter((item) => item.isQuestion).slice(0, 5).map((item) => item.keyword);
  const mainPhrase = cluster.keywords[0]?.keyword || seedKeyword;
  const intentPhrase = cluster.intent === 'transactional' ? 'service' : cluster.intent === 'commercial' ? 'comparison' : 'guide';

  return {
    headline: `${mainPhrase} ${intentPhrase}`.trim(),
    titleIdeas: uniqueStrings([
      `${mainPhrase}: ${cluster.intent === 'commercial' ? 'best options and comparisons' : 'what to know'}`,
      `${seedKeyword}: ${cluster.label.replace(/\s+\(.+\)$/, '')}`,
      `${mainPhrase} for ${options.targetAudience || 'buyers and decision-makers'}`,
    ]).slice(0, 3),
    h2s: uniqueStrings([
      `What ${mainPhrase} means`,
      `When to use ${mainPhrase}`,
      `Best ${cluster.label.replace(/\s+\(.+\)$/, '')} options`,
      `How to choose the right ${seedKeyword}`,
      `Common mistakes and FAQs`,
    ]).slice(0, 5),
    faqs: uniqueStrings(questionKeywords.length > 0 ? questionKeywords : [
      `What is the best ${seedKeyword}?`,
      `How much does ${seedKeyword} cost?`,
      `How do you choose ${seedKeyword}?`,
    ]).slice(0, 5),
    internalLinks: uniqueStrings([
      `${seedKeyword} services`,
      `${seedKeyword} case studies`,
      `${seedKeyword} pricing`,
      `${seedKeyword} audit`,
    ]).slice(0, 4),
    notes: [
      `Target a ${cluster.recommendedPageType.toLowerCase()} for this cluster.`,
      `Primary keyword: ${mainPhrase}.`,
      topKeywords.length > 1 ? `Secondary terms: ${topKeywords.slice(1, 4).join(', ')}.` : null,
    ].filter(Boolean),
  };
}

function buildClusters(seedKeyword, keywords, options = {}) {
  const buckets = new Map();

  for (const item of keywords) {
    const existing = buckets.get(item.clusterKey) || {
      id: item.clusterKey,
      key: item.clusterKey,
      label: item.clusterLabel,
      intent: item.intent,
      recommendedPageType: item.recommendedPageType,
      keywords: [],
    };

    existing.keywords.push(item);
    buckets.set(item.clusterKey, existing);
  }

  return [...buckets.values()]
    .map((cluster) => {
      const sortedKeywords = cluster.keywords.sort((a, b) => b.priorityScore - a.priorityScore || a.keyword.localeCompare(b.keyword));

      return {
        ...cluster,
        primaryKeyword: sortedKeywords[0]?.keyword || seedKeyword,
        keywordCount: sortedKeywords.length,
        questionsCount: sortedKeywords.filter((item) => item.isQuestion).length,
        averagePriorityScore: Math.round(sortedKeywords.reduce((sum, item) => sum + item.priorityScore, 0) / Math.max(sortedKeywords.length, 1)),
        keywords: sortedKeywords,
        brief: buildClusterBrief(
          {
            ...cluster,
            keywords: sortedKeywords,
          },
          seedKeyword,
          options
        ),
      };
    })
    .sort((a, b) => b.keywordCount - a.keywordCount || b.averagePriorityScore - a.averagePriorityScore);
}

function buildResearchSummary(seedKeyword, keywords, clusters) {
  const intentCounts = keywords.reduce((acc, item) => {
    acc[item.intent] = (acc[item.intent] || 0) + 1;
    return acc;
  }, {});
  const questionsCount = keywords.filter((item) => item.isQuestion).length;
  const localCount = keywords.filter((item) => item.isLocal).length;
  const brandedCounts = keywords.reduce((acc, item) => {
    acc[item.brandedStatus] = (acc[item.brandedStatus] || 0) + 1;
    return acc;
  }, {});

  return {
    seedKeyword,
    totalKeywords: keywords.length,
    totalClusters: clusters.length,
    questionsCount,
    localCount,
    intentCounts,
    brandedCounts,
    topOpportunities: keywords.slice(0, 10).map((item) => item.keyword),
  };
}

function updateKeywordScoresWithSignals(keywords) {
  return keywords
    .map((item) => {
      const trendScore = typeof item.trend?.score === 'number' ? item.trend.score : 50;
      const opportunityScore = calculateOpportunityScore({
        difficultyEstimate: item.difficultyEstimate,
        businessIntentScore: item.businessIntentScore,
        trendScore,
        enrichment: item.enrichment,
      });
      const priorityScore = Math.round(
        (item.relevanceScore * 0.35) +
        (item.businessIntentScore * 0.25) +
        (opportunityScore * 0.3) +
        ((100 - item.difficultyEstimate) * 0.1)
      );

      const notes = [...item.notes];
      if (item.enrichment?.forumCount > 0) {
        notes.push(`Forums/UGC appear ${item.enrichment.forumCount} times in the top results.`);
      }
      if (item.enrichment?.weakDomainCount > 0) {
        notes.push(`Weak or UGC-style domains appear ${item.enrichment.weakDomainCount} times.`);
      }
      if (item.competitorGap?.isGap) {
        notes.push(`Competitors rank while the target domain does not.`);
      }
      if (item.trend?.direction === 'falling') {
        notes.push('Trend is softening compared to the previous period.');
      }
      if (item.trend?.direction === 'rising') {
        notes.push('Trend is rising.');
      }

      return {
        ...item,
        trendScore,
        opportunityScore,
        priorityScore,
        notes: uniqueStrings(notes),
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore || a.keyword.localeCompare(b.keyword));
}

function buildCsvRows(keywords) {
  return keywords.map((item) => ({
    keyword: item.keyword,
    intent: item.intent,
    cluster: item.clusterLabel,
    priorityScore: item.priorityScore,
    opportunityScore: item.opportunityScore ?? '',
    difficultyEstimate: item.difficultyEstimate,
    trendDirection: item.trend?.direction || '',
    trendScore: item.trend?.score ?? '',
    competitorGap: item.competitorGap?.isGap ? 'Yes' : 'No',
    recommendedPageType: item.recommendedPageType,
    notes: Array.isArray(item.notes) ? item.notes.join(' | ') : '',
  }));
}

function buildCompetitorGapSummary(keywords) {
  const gapKeywords = keywords.filter((item) => item.competitorGap?.isGap);

  return {
    totalGapKeywords: gapKeywords.length,
    topGapKeywords: gapKeywords.slice(0, 10).map((item) => ({
      keyword: item.keyword,
      competitors: item.competitorGap?.matchedCompetitors || [],
      opportunityScore: item.opportunityScore ?? item.priorityScore,
    })),
  };
}

function isWeakDomain(hostname) {
  return WEAK_DOMAIN_TERMS.some((term) => hostname.includes(term));
}

function isForumDomain(hostname) {
  return FORUM_DOMAIN_TERMS.some((term) => hostname.includes(term));
}

module.exports = {
  buildClusterBrief,
  buildClusters,
  buildCompetitorGapSummary,
  buildCsvRows,
  buildKeywordObjects,
  buildResearchSummary,
  canonicalizeKeyword,
  detectBrandedStatus,
  getRootDomain,
  inferIntent,
  isForumDomain,
  isWeakDomain,
  normalizeKeywordText,
  parseListInput,
  recommendPageType,
  uniqueStrings,
  applyKeywordFilters,
  updateKeywordScoresWithSignals,
};
