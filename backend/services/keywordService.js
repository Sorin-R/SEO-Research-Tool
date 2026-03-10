const db = require('../database');
const {
  getSuggestions,
  getExpandedSuggestions,
  categoriseSuggestions,
} = require('../scrapers/googleAutocomplete');
const { fetchSERPResults } = require('../scrapers/googleSERP');
const {
  filterKeywordsWithAI,
  DEFAULT_AI_FILTER_PROMPT,
  DEFAULT_AI_RESEARCH_PROMPT,
  generateKeywordsWithAI,
} = require('./aiKeywordFilterService');
const { extractCompetitorKeywords } = require('./competitorKeywordExtractionService');
const trendService = require('./trendService');
const localStore = require('../utils/localStore');
const { getCountryConfig, normalizeCountryCode } = require('../utils/searchCountry');
const {
  applyKeywordFilters,
  buildClusters,
  buildCompetitorGapSummary,
  buildCsvRows,
  buildKeywordObjects,
  buildResearchSummary,
  canonicalizeKeyword,
  getRootDomain,
  isForumDomain,
  isWeakDomain,
  normalizeKeywordText,
  parseListInput,
  uniqueStrings,
  updateKeywordScoresWithSignals,
} = require('./keywordResearchEnhancer');

const MAX_RESEARCH_HISTORY_ENTRIES = 12;
const MAX_KEYWORD_LISTS = 20;

function clampLimit(limit, min, max) {
  return Math.min(Math.max(Number.parseInt(limit, 10) || min, min), max);
}

function parseStoredResult(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseStoredItems(value) {
  const parsed = parseStoredResult(value);
  return Array.isArray(parsed) ? parsed : [];
}

function normaliseResearchOptions(options = {}) {
  const country = normalizeCountryCode(options.country);
  const enrichTopN = clampLimit(options.enrichTopN || 0, 0, 20);
  const trendTopN = clampLimit(options.trendTopN || 0, 0, 10);
  const expand = options.expand !== false && options.expand !== 'false';

  return {
    expand,
    country,
    countryName: getCountryConfig(country).name,
    targetCount: clampLimit(options.targetCount || 1000, 50, 1500),
    enrichTopN,
    includeTrends: options.includeTrends === true || options.includeTrends === 'true',
    trendTopN,
    goalPrompt: String(options.goalPrompt || '').trim(),
    includeTerms: parseListInput(options.includeTerms),
    excludeTerms: parseListInput(options.excludeTerms),
    modifierTerms: parseListInput(options.modifierTerms),
    brandTerms: parseListInput(options.brandTerms),
    localCities: parseListInput(options.localCities),
    localServices: parseListInput(options.localServices),
    competitorDomains: parseListInput(options.competitorDomains).map((domain) => getRootDomain(domain)).filter(Boolean),
    targetDomain: getRootDomain(options.targetDomain),
    questionsOnly: options.questionsOnly === true || options.questionsOnly === 'true',
    intents: Array.isArray(options.intents) ? options.intents.filter(Boolean) : [],
    minWords: Number.parseInt(options.minWords, 10) || 0,
    maxWords: Number.parseInt(options.maxWords, 10) || 0,
    brandedMode: String(options.brandedMode || 'all'),
    targetAudience: String(options.targetAudience || '').trim(),
    aiResearchEnabled: options.aiResearchEnabled === true || options.aiResearchEnabled === 'true',
    aiResearchCount: clampLimit(options.aiResearchCount || 100, 10, 250),
    aiResearchPrompt: String(options.aiResearchPrompt || '').trim(),
  };
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildLocalVariants(seedKeyword, options) {
  if (options.localCities.length === 0) {
    return [];
  }

  const baseServices = options.localServices.length > 0 ? options.localServices : [seedKeyword];
  const results = [];

  for (const service of baseServices) {
    for (const city of options.localCities) {
      results.push(`${service} ${city}`);
      results.push(`${service} in ${city}`);
      results.push(`${service} near me`);
      results.push(`best ${service} ${city}`);
    }
  }

  return uniqueStrings(results);
}

function applyAiResearchSignals(keywords, aiResearch) {
  if (!aiResearch?.keywords?.length) {
    return keywords;
  }

  const aiKeywordMap = new Map(
    aiResearch.keywords.map((item) => [canonicalizeKeyword(item.keyword), item])
  );

  return keywords.map((item) => {
    const aiMatch = aiKeywordMap.get(item.canonicalKeyword);

    if (!aiMatch) {
      return item;
    }

    return {
      ...item,
      aiResearchScore: aiMatch.score,
      aiResearchReason: aiMatch.reason,
      aiSuggestedIntent: aiMatch.intent || item.intent,
      aiSuggestedPageType: aiMatch.recommendedPageType || item.recommendedPageType,
      notes: uniqueStrings([
        ...item.notes,
        aiMatch.reason ? `AI research: ${aiMatch.reason}` : null,
      ].filter(Boolean)),
    };
  });
}

async function getPaaQuestions(keyword) {
  try {
    const { getPeopleAlsoAsk } = require('../scrapers/peopleAlsoAsk');
    return await getPeopleAlsoAsk(keyword);
  } catch (err) {
    console.warn('[KeywordService] PAA fetch failed:', err.message);
    return [];
  }
}

async function addTrendOverlay(keywords, options) {
  if (!options.includeTrends || options.trendTopN <= 0 || keywords.length === 0) {
    return {
      enabled: false,
      processed: 0,
      failed: 0,
    };
  }

  let processed = 0;
  let failed = 0;

  for (const item of keywords.slice(0, options.trendTopN)) {
    try {
      const trend = await trendService.getInterestOverTime(item.keyword, {
        geo: options.country,
      });
      const values = trend.timelineData.map((point) => Number(point.value) || 0).filter((value) => value >= 0);
      const recentAverage = average(values.slice(-4));
      const previousAverage = average(values.slice(-8, -4));
      const delta = recentAverage - previousAverage;

      item.trend = {
        direction: delta > 4 ? 'rising' : delta < -4 ? 'falling' : 'flat',
        score: Math.round(recentAverage),
        recentAverage: Math.round(recentAverage),
        previousAverage: Math.round(previousAverage),
        samplePoints: values.length,
      };
      processed += 1;
    } catch (err) {
      item.trend = {
        direction: 'unknown',
        score: 50,
        error: err.message,
      };
      failed += 1;
    }
  }

  return {
    enabled: true,
    processed,
    failed,
  };
}

function matchesDomain(resultUrl, targetDomain) {
  if (!targetDomain) {
    return false;
  }

  const hostname = getRootDomain(resultUrl);
  return hostname === targetDomain || hostname.endsWith(`.${targetDomain}`);
}

async function addSerpEnrichment(keywords, options) {
  if (options.enrichTopN <= 0 || keywords.length === 0) {
    return {
      enabled: false,
      processed: 0,
      failed: 0,
    };
  }

  let processed = 0;
  let failed = 0;

  for (const item of keywords.slice(0, options.enrichTopN)) {
    try {
      const results = await fetchSERPResults(item.keyword, 10, { country: options.country });
      const titleMatchCount = results.filter((result) => String(result.title || '').toLowerCase().includes(item.keyword.toLowerCase())).length;
      const weakDomainCount = results.filter((result) => isWeakDomain(getRootDomain(result.url))).length;
      const forumCount = results.filter((result) => isForumDomain(getRootDomain(result.url))).length;
      const redditCount = results.filter((result) => getRootDomain(result.url).includes('reddit.com')).length;
      const matchedCompetitors = options.competitorDomains.filter((domain) =>
        results.some((result) => matchesDomain(result.url, domain))
      );
      const targetMatch = options.targetDomain
        ? results.find((result) => matchesDomain(result.url, options.targetDomain))
        : null;

      item.enrichment = {
        weakDomainCount,
        forumCount,
        redditCount,
        titleMatchRatio: results.length ? Math.round((titleMatchCount / results.length) * 100) : 0,
        matchedCompetitors,
        targetPosition: targetMatch?.position ?? null,
        targetPresent: !!targetMatch,
        resultSample: results.slice(0, 3).map((result) => ({
          position: result.position,
          title: result.title,
          domain: getRootDomain(result.url),
        })),
      };

      item.competitorGap = {
        isGap: matchedCompetitors.length > 0 && !!options.targetDomain && !targetMatch,
        matchedCompetitors,
      };

      processed += 1;
    } catch (err) {
      item.enrichment = {
        error: err.message,
        weakDomainCount: 0,
        forumCount: 0,
        redditCount: 0,
        titleMatchRatio: 0,
        matchedCompetitors: [],
        targetPosition: null,
        targetPresent: false,
      };
      item.competitorGap = {
        isGap: false,
        matchedCompetitors: [],
      };
      failed += 1;
    }
  }

  return {
    enabled: true,
    processed,
    failed,
  };
}

async function persistResearchHistory(result) {
  const keyword = result.keyword?.trim();

  if (!keyword) {
    return null;
  }

  const payload = {
    ...result,
    keyword,
  };

  try {
    const existing = await db.query(
      `SELECT id
       FROM keyword_research_history
       WHERE LOWER(keyword) = LOWER(?)
       ORDER BY updated_at DESC
       LIMIT 1`,
      [keyword]
    );

    let historyId;

    if (existing.length > 0) {
      historyId = existing[0].id;

      await db.query(
        `UPDATE keyword_research_history
         SET keyword = ?, result = ?, total_suggestions = ?, deep_scan = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          keyword,
          JSON.stringify(payload),
          payload.totalSuggestions || payload.allSuggestions?.length || 0,
          payload.deepScan ? 1 : 0,
          historyId,
        ]
      );

      await db.query(
        `DELETE FROM keyword_research_history
         WHERE LOWER(keyword) = LOWER(?) AND id <> ?`,
        [keyword, historyId]
      );
    } else {
      const insertResult = await db.query(
        `INSERT INTO keyword_research_history (keyword, result, total_suggestions, deep_scan)
         VALUES (?, ?, ?, ?)`,
        [
          keyword,
          JSON.stringify(payload),
          payload.totalSuggestions || payload.allSuggestions?.length || 0,
          payload.deepScan ? 1 : 0,
        ]
      );
      historyId = insertResult.insertId;
    }

    await db.query(
      `DELETE FROM keyword_research_history
       WHERE id NOT IN (
         SELECT id FROM (
           SELECT id
           FROM keyword_research_history
           ORDER BY updated_at DESC
           LIMIT ${MAX_RESEARCH_HISTORY_ENTRIES}
         ) AS recent_history
       )`
    );

    return historyId;
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for saveKeywordResearchHistory:', err.message);
    return localStore.saveKeywordResearchHistory(payload, MAX_RESEARCH_HISTORY_ENTRIES);
  }
}

async function researchKeyword(keyword, inputOptions = {}) {
  const seedKeyword = normalizeKeywordText(keyword);
  const options = normaliseResearchOptions(inputOptions);
  const aiResearch = options.aiResearchEnabled
    ? await generateKeywordsWithAI({
        seedKeyword,
        prompt: options.aiResearchPrompt || options.goalPrompt,
        maxResults: options.aiResearchCount,
        options,
      })
    : null;
  const expansion = options.expand
    ? await getExpandedSuggestions(seedKeyword, {
        targetCount: options.targetCount,
        country: options.country,
        localCities: options.localCities,
        localServices: options.localServices,
      })
    : null;

  const baseSuggestions = expansion
    ? categoriseSuggestions(seedKeyword, expansion.suggestions)
    : await getSuggestions(seedKeyword, {
        country: options.country,
      });

  const paaQuestions = await getPaaQuestions(seedKeyword);
  const localVariants = buildLocalVariants(seedKeyword, options);
  const rawSuggestions = uniqueStrings([
    ...(aiResearch?.keywords || []).map((item) => item.keyword),
    ...(expansion ? expansion.suggestions : baseSuggestions.all),
    ...paaQuestions,
    ...localVariants,
  ]);

  let keywords = applyAiResearchSignals(buildKeywordObjects(seedKeyword, rawSuggestions, options), aiResearch);
  const serpEnrichment = await addSerpEnrichment(keywords, options);
  const trendOverlay = await addTrendOverlay(keywords, options);
  keywords = updateKeywordScoresWithSignals(keywords);

  const filteredKeywords = applyKeywordFilters(keywords, options);
  const clusters = buildClusters(seedKeyword, filteredKeywords, options);
  const summary = buildResearchSummary(seedKeyword, filteredKeywords, clusters);

  const questionKeywords = filteredKeywords.filter((item) => item.isQuestion).map((item) => item.keyword);
  const longTailKeywords = filteredKeywords.filter((item) => !item.isQuestion && item.wordCount >= 4).map((item) => item.keyword);
  const relatedKeywords = filteredKeywords.filter((item) => !item.isQuestion && item.wordCount < 4).map((item) => item.keyword);

  const result = {
    keyword: seedKeyword,
    country: options.country,
    countryName: options.countryName,
    related: relatedKeywords,
    longTail: longTailKeywords,
    questions: questionKeywords,
    allSuggestions: filteredKeywords.map((item) => item.keyword),
    rawSuggestions,
    keywords: filteredKeywords,
    clusters,
    summary,
    competitorGapSummary: buildCompetitorGapSummary(filteredKeywords),
    csvRows: buildCsvRows(filteredKeywords),
    paaQuestions,
    totalSuggestions: filteredKeywords.length,
    rawSuggestionCount: rawSuggestions.length,
    deepScan: !!options.expand,
    reachedTarget: expansion?.reachedTarget || false,
    requestCount: expansion?.requestCount || 1,
    filtersApplied: {
      includeTerms: options.includeTerms,
      excludeTerms: options.excludeTerms,
      modifierTerms: options.modifierTerms,
      intents: options.intents,
      minWords: options.minWords || null,
      maxWords: options.maxWords || null,
      brandedMode: options.brandedMode,
      questionsOnly: options.questionsOnly,
    },
    localSeo: {
      cities: options.localCities,
      services: options.localServices,
      generatedCount: localVariants.length,
    },
    competitorMode: {
      competitorDomains: options.competitorDomains,
      targetDomain: options.targetDomain || null,
    },
    serpEnrichment,
    trendOverlay,
    aiResearch: aiResearch
      ? {
          enabled: true,
          summary: aiResearch.summary,
          selectedCount: aiResearch.selectedCount,
          model: aiResearch.model,
          prompt: aiResearch.prompt,
          keywords: aiResearch.keywords,
        }
      : {
          enabled: false,
          summary: '',
          selectedCount: 0,
          model: null,
          prompt: options.aiResearchPrompt || '',
          keywords: [],
        },
    researchOptions: {
      expand: options.expand,
      targetCount: options.targetCount,
      country: options.country,
      goalPrompt: options.goalPrompt,
      brandTerms: options.brandTerms,
      targetAudience: options.targetAudience,
      includeTrends: options.includeTrends,
      trendTopN: options.trendTopN,
      enrichTopN: options.enrichTopN,
      aiResearchEnabled: options.aiResearchEnabled,
      aiResearchCount: options.aiResearchCount,
      aiResearchPrompt: options.aiResearchPrompt,
    },
  };

  try {
    const historyId = await persistResearchHistory(result);
    if (historyId) {
      result.historyId = historyId;
    }
  } catch (err) {
    console.warn('[KeywordService] Failed to persist research history:', err.message);
  }

  return result;
}

// ---- Database operations for tracked keywords ----

async function saveKeyword(keyword, difficulty = null, searchVolume = null) {
  try {
    return await db.query(
      `INSERT INTO keywords (keyword, difficulty, search_volume)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         difficulty = COALESCE(?, difficulty),
         search_volume = COALESCE(?, search_volume),
         updated_at = CURRENT_TIMESTAMP`,
      [keyword, difficulty, searchVolume, difficulty, searchVolume]
    );
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for saveKeyword:', err.message);
    return localStore.saveKeyword(keyword, difficulty, searchVolume);
  }
}

async function getTrackedKeywords() {
  try {
    return await db.query('SELECT * FROM keywords ORDER BY created_at DESC');
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for getTrackedKeywords:', err.message);
    return localStore.getTrackedKeywords();
  }
}

async function getKeywordById(id) {
  try {
    const rows = await db.query('SELECT * FROM keywords WHERE id = ?', [id]);
    return rows[0] || null;
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for getKeywordById:', err.message);
    return localStore.getKeywordById(id);
  }
}

async function deleteKeyword(id) {
  try {
    return await db.query('DELETE FROM keywords WHERE id = ?', [id]);
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for deleteKeyword:', err.message);
    return localStore.deleteKeyword(id);
  }
}

async function getKeywordResearchHistory(limit = 10) {
  const safeLimit = clampLimit(limit, 1, MAX_RESEARCH_HISTORY_ENTRIES);

  try {
    return await db.query(
      `SELECT id, keyword, total_suggestions, deep_scan, created_at, updated_at
       FROM keyword_research_history
       ORDER BY updated_at DESC
       LIMIT ${safeLimit}`
    );
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for getKeywordResearchHistory:', err.message);
    return localStore.getKeywordResearchHistory(safeLimit);
  }
}

async function getKeywordResearchHistoryItem(id) {
  try {
    const rows = await db.query(
      `SELECT id, result, updated_at
       FROM keyword_research_history
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    const row = rows[0];

    if (!row) {
      return null;
    }

    const parsedResult = parseStoredResult(row.result);

    return parsedResult
      ? {
          ...parsedResult,
          historyId: row.id,
          savedAt: row.updated_at,
        }
      : null;
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for getKeywordResearchHistoryItem:', err.message);
    return localStore.getKeywordResearchHistoryItem(id);
  }
}

async function deleteKeywordResearchHistoryItem(id) {
  try {
    await db.query('DELETE FROM keyword_research_history WHERE id = ?', [id]);
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for deleteKeywordResearchHistoryItem:', err.message);
    await localStore.deleteKeywordResearchHistoryItem(id);
  }
}

async function getKeywordLists() {
  try {
    const rows = await db.query(
      `SELECT id, name, items, created_at, updated_at
       FROM keyword_lists
       ORDER BY updated_at DESC`
    );

    return rows.map((row) => {
      const items = parseStoredItems(row.items);
      return {
        id: row.id,
        name: row.name,
        items,
        itemCount: items.length,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for getKeywordLists:', err.message);
    return localStore.getKeywordLists();
  }
}

async function createKeywordList(name) {
  const normalizedName = normalizeKeywordText(name);

  if (!normalizedName) {
    throw new Error('List name is required.');
  }

  try {
    const existing = await db.query(
      `SELECT id, name, items, created_at, updated_at
       FROM keyword_lists
       WHERE LOWER(name) = LOWER(?)
       LIMIT 1`,
      [normalizedName]
    );

    if (existing.length > 0) {
      const row = existing[0];
      const items = parseStoredItems(row.items);
      return {
        id: row.id,
        name: row.name,
        items,
        itemCount: items.length,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    }

    const totalRows = await db.query('SELECT COUNT(*) AS total FROM keyword_lists');
    if ((totalRows[0]?.total || 0) >= MAX_KEYWORD_LISTS) {
      throw new Error(`You can save up to ${MAX_KEYWORD_LISTS} keyword lists.`);
    }

    const insertResult = await db.query(
      `INSERT INTO keyword_lists (name, items)
       VALUES (?, ?)`,
      [normalizedName, JSON.stringify([])]
    );

    return {
      id: insertResult.insertId,
      name: normalizedName,
      items: [],
      itemCount: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  } catch (err) {
    if (/You can save up to/.test(err.message)) {
      throw err;
    }

    console.warn('[KeywordService] DB unavailable, using local store for createKeywordList:', err.message);
    return localStore.createKeywordList(normalizedName, MAX_KEYWORD_LISTS);
  }
}

async function addKeywordsToList(listId, items = []) {
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((item) => ({
      keyword: normalizeKeywordText(item.keyword),
      intent: item.intent || null,
      clusterLabel: item.clusterLabel || null,
      priorityScore: item.priorityScore ?? null,
      recommendedPageType: item.recommendedPageType || null,
      notes: Array.isArray(item.notes) ? item.notes : [],
      sourceKeyword: item.sourceKeyword || null,
    }))
    .filter((item) => item.keyword);

  if (normalizedItems.length === 0) {
    throw new Error('At least one keyword is required.');
  }

  try {
    const rows = await db.query(
      `SELECT id, name, items, created_at, updated_at
       FROM keyword_lists
       WHERE id = ?
       LIMIT 1`,
      [listId]
    );
    const row = rows[0];

    if (!row) {
      throw new Error('Keyword list not found.');
    }

    const existingItems = parseStoredItems(row.items);
    const maxItemId = existingItems.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
    let nextItemId = maxItemId + 1;
    const mergedByKeyword = new Map(
      existingItems.map((item) => [canonicalizeKeyword(item.keyword), item])
    );

    for (const item of normalizedItems) {
      const key = canonicalizeKeyword(item.keyword);
      const existing = mergedByKeyword.get(key);

      if (existing) {
        mergedByKeyword.set(key, {
          ...existing,
          ...item,
          notes: uniqueStrings([...(existing.notes || []), ...(item.notes || [])]),
        });
      } else {
        mergedByKeyword.set(key, {
          id: nextItemId,
          ...item,
        });
        nextItemId += 1;
      }
    }

    const mergedItems = [...mergedByKeyword.values()].sort((a, b) => {
      const scoreA = Number(a.priorityScore) || 0;
      const scoreB = Number(b.priorityScore) || 0;
      return scoreB - scoreA || a.keyword.localeCompare(b.keyword);
    });

    await db.query(
      `UPDATE keyword_lists
       SET items = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify(mergedItems), listId]
    );

    return {
      id: row.id,
      name: row.name,
      items: mergedItems,
      itemCount: mergedItems.length,
      created_at: row.created_at,
      updated_at: new Date().toISOString(),
    };
  } catch (err) {
    if (err.message === 'Keyword list not found.') {
      throw err;
    }

    console.warn('[KeywordService] DB unavailable, using local store for addKeywordsToList:', err.message);
    return localStore.addKeywordsToList(listId, normalizedItems);
  }
}

async function deleteKeywordList(id) {
  try {
    await db.query('DELETE FROM keyword_lists WHERE id = ?', [id]);
  } catch (err) {
    console.warn('[KeywordService] DB unavailable, using local store for deleteKeywordList:', err.message);
    await localStore.deleteKeywordList(id);
  }
}

async function deleteKeywordListItem(listId, itemId) {
  try {
    const rows = await db.query(
      `SELECT id, name, items, created_at, updated_at
       FROM keyword_lists
       WHERE id = ?
       LIMIT 1`,
      [listId]
    );
    const row = rows[0];

    if (!row) {
      throw new Error('Keyword list not found.');
    }

    const items = parseStoredItems(row.items).filter((item) => String(item.id) !== String(itemId));

    await db.query(
      `UPDATE keyword_lists
       SET items = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify(items), listId]
    );
  } catch (err) {
    if (err.message === 'Keyword list not found.') {
      throw err;
    }

    console.warn('[KeywordService] DB unavailable, using local store for deleteKeywordListItem:', err.message);
    await localStore.deleteKeywordListItem(listId, itemId);
  }
}

module.exports = {
  DEFAULT_AI_FILTER_PROMPT,
  DEFAULT_AI_RESEARCH_PROMPT,
  filterKeywordsWithAI,
  generateKeywordsWithAI,
  extractCompetitorKeywords,
  researchKeyword,
  saveKeyword,
  getTrackedKeywords,
  getKeywordById,
  deleteKeyword,
  getKeywordResearchHistory,
  getKeywordResearchHistoryItem,
  deleteKeywordResearchHistoryItem,
  getKeywordLists,
  createKeywordList,
  addKeywordsToList,
  deleteKeywordList,
  deleteKeywordListItem,
};
