const fs = require('fs/promises');
const path = require('path');
const { normalizeCountryCode } = require('./searchCountry');

const storePath = path.join(__dirname, '../data/runtime-store.json');
const ALLOWED_SEARCH_DEPTHS = [10, 20, 50, 100];

function normalizePathname(pathname) {
  const value = String(pathname || '/').trim();
  if (!value || value === '/') {
    return '/';
  }

  const normalized = value.startsWith('/') ? value : `/${value}`;
  return normalized.replace(/\/+$/, '') || '/';
}

function normalizeStoredTargetUrl(targetUrl, fallbackDomain = '') {
  if (!targetUrl || !String(targetUrl).trim()) {
    return null;
  }

  let value = String(targetUrl).trim();

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  try {
    const parsedUrl = new URL(value);
    const hostname = parsedUrl.hostname.replace(/^www\./, '').trim().toLowerCase() || fallbackDomain;
    const pathname = normalizePathname(parsedUrl.pathname);

    if (!hostname || pathname === '/') {
      return null;
    }

    return `https://${hostname}${pathname}`;
  } catch {
    return null;
  }
}

function normalizeStoredSearchDepth(searchDepth) {
  const value = Number.parseInt(searchDepth, 10);
  return ALLOWED_SEARCH_DEPTHS.includes(value) ? value : 10;
}

function createEmptyState() {
  return {
    websites: [],
    keywords: [],
    rankings: [],
    serpCache: [],
    rankTrackerSettings: {
      schedule_time: '06:00',
      search_depth: 10,
      updated_at: null,
    },
    serpProviderSettings: {},
    serpProviderCredentials: {},
    keywordResearchHistory: [],
    serpAnalysisHistory: [],
    contentAnalysisHistory: [],
  };
}

async function ensureStore() {
  await fs.mkdir(path.dirname(storePath), { recursive: true });

  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, JSON.stringify(createEmptyState(), null, 2));
  }
}

async function readState() {
  await ensureStore();

  try {
    const raw = await fs.readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);

    return {
      websites: Array.isArray(parsed.websites) ? parsed.websites : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      rankings: Array.isArray(parsed.rankings) ? parsed.rankings : [],
      serpCache: Array.isArray(parsed.serpCache) ? parsed.serpCache : [],
      rankTrackerSettings: parsed.rankTrackerSettings && typeof parsed.rankTrackerSettings === 'object'
        ? {
            schedule_time: typeof parsed.rankTrackerSettings.schedule_time === 'string'
              ? parsed.rankTrackerSettings.schedule_time
              : '06:00',
            search_depth: normalizeStoredSearchDepth(parsed.rankTrackerSettings.search_depth),
            updated_at: parsed.rankTrackerSettings.updated_at || null,
          }
        : {
            schedule_time: '06:00',
            search_depth: 10,
            updated_at: null,
          },
      serpProviderSettings: parsed.serpProviderSettings && typeof parsed.serpProviderSettings === 'object'
        ? parsed.serpProviderSettings
        : {},
      serpProviderCredentials: parsed.serpProviderCredentials && typeof parsed.serpProviderCredentials === 'object'
        ? parsed.serpProviderCredentials
        : {},
      keywordResearchHistory: Array.isArray(parsed.keywordResearchHistory)
        ? parsed.keywordResearchHistory
        : [],
      serpAnalysisHistory: Array.isArray(parsed.serpAnalysisHistory)
        ? parsed.serpAnalysisHistory
        : [],
      contentAnalysisHistory: Array.isArray(parsed.contentAnalysisHistory)
        ? parsed.contentAnalysisHistory
        : [],
    };
  } catch {
    return createEmptyState();
  }
}

async function writeState(state) {
  await ensureStore();
  await fs.writeFile(storePath, JSON.stringify(state, null, 2));
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function nowIso() {
  return new Date().toISOString();
}

async function getCachedSERP(keyword, maxAgeMs) {
  const state = await readState();
  const match = state.serpCache
    .filter((entry) => entry.keyword === keyword)
    .sort((a, b) => new Date(b.fetched_at) - new Date(a.fetched_at))[0];

  if (!match) return null;

  const age = Date.now() - new Date(match.fetched_at).getTime();
  if (age > maxAgeMs) return null;

  return match.results || null;
}

async function saveSerpCache(keyword, results) {
  const state = await readState();

  state.serpCache.push({
    id: nextId(state.serpCache),
    keyword,
    results,
    fetched_at: nowIso(),
  });

  if (state.serpCache.length > 50) {
    state.serpCache = state.serpCache
      .sort((a, b) => new Date(b.fetched_at) - new Date(a.fetched_at))
      .slice(0, 50);
  }

  await writeState(state);
}

async function getRankTrackerSettings() {
  const state = await readState();
  return {
    schedule_time: state.rankTrackerSettings?.schedule_time || '06:00',
    search_depth: normalizeStoredSearchDepth(state.rankTrackerSettings?.search_depth),
    updated_at: state.rankTrackerSettings?.updated_at || null,
  };
}

async function updateRankTrackerSettings(scheduleTime, searchDepth = 10) {
  const state = await readState();
  state.rankTrackerSettings = {
    schedule_time: scheduleTime,
    search_depth: normalizeStoredSearchDepth(searchDepth),
    updated_at: nowIso(),
  };
  await writeState(state);
  return state.rankTrackerSettings;
}

async function getSerpProviderSettings() {
  const state = await readState();
  return { ...(state.serpProviderSettings || {}) };
}

async function getSerpProviderCredentials() {
  const state = await readState();
  return { ...(state.serpProviderCredentials || {}) };
}

async function updateSerpProviderSetting(providerId, isEnabled) {
  const state = await readState();
  state.serpProviderSettings = {
    ...(state.serpProviderSettings || {}),
    [providerId]: {
      is_enabled: !!isEnabled,
      updated_at: nowIso(),
    },
  };
  await writeState(state);
  return state.serpProviderSettings[providerId];
}

async function updateSerpProviderCredentials(providerId, credentials = {}) {
  const state = await readState();
  const existing = state.serpProviderCredentials?.[providerId] || {};
  const nextCredentials = { ...existing };
  const timestamp = nowIso();

  for (const [credentialKey, credentialValue] of Object.entries(credentials)) {
    const normalizedValue = String(credentialValue || '').trim();

    if (!normalizedValue) {
      continue;
    }

    nextCredentials[credentialKey] = {
      value: normalizedValue,
      updated_at: timestamp,
    };
  }

  state.serpProviderCredentials = {
    ...(state.serpProviderCredentials || {}),
    [providerId]: nextCredentials,
  };

  await writeState(state);
  return state.serpProviderCredentials[providerId];
}

async function saveKeyword(keyword, difficulty = null, searchVolume = null) {
  const state = await readState();
  const existing = state.keywords.find((item) => item.keyword === keyword);
  const timestamp = nowIso();

  if (existing) {
    if (difficulty != null) existing.difficulty = difficulty;
    if (searchVolume != null) existing.search_volume = searchVolume;
    existing.updated_at = timestamp;
  } else {
    state.keywords.push({
      id: nextId(state.keywords),
      keyword,
      difficulty,
      search_volume: searchVolume,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  await writeState(state);
}

async function saveWebsite(website) {
  const state = await readState();
  const timestamp = nowIso();
  const domain = String(website.domain || '').trim().toLowerCase();
  const targetUrl = normalizeStoredTargetUrl(website.target_url, domain);
  const country = normalizeCountryCode(website.country);
  const existing = state.websites.find((item) => item.domain === domain);

  if (existing) {
    existing.name = website.name || existing.name;
    existing.domain = domain;
    existing.target_url = targetUrl;
    existing.country = country;
    existing.is_active = website.is_active != null ? !!website.is_active : existing.is_active;
    existing.updated_at = timestamp;
    await writeState(state);
    return {
      ...existing,
      target_url: normalizeStoredTargetUrl(existing.target_url, existing.domain),
      country: normalizeCountryCode(existing.country),
    };
  }

  const nextWebsite = {
    id: nextId(state.websites),
    name: website.name || domain,
    domain,
    target_url: targetUrl,
    country,
    is_active: website.is_active != null ? !!website.is_active : true,
    created_at: timestamp,
    updated_at: timestamp,
  };

  state.websites.push(nextWebsite);
  await writeState(state);
  return {
    ...nextWebsite,
    target_url: normalizeStoredTargetUrl(nextWebsite.target_url, nextWebsite.domain),
    country: normalizeCountryCode(nextWebsite.country),
  };
}

async function getWebsites() {
  const state = await readState();
  return [...state.websites].map((item) => ({
    ...item,
    target_url: normalizeStoredTargetUrl(item.target_url, item.domain),
    country: normalizeCountryCode(item.country),
  })).sort((left, right) => {
    const leftCreated = new Date(left.created_at || 0).getTime();
    const rightCreated = new Date(right.created_at || 0).getTime();

    if (rightCreated !== leftCreated) {
      return rightCreated - leftCreated;
    }

    return Number(right.id || 0) - Number(left.id || 0);
  });
}

async function getActiveWebsites() {
  const websites = await getWebsites();
  return websites.filter((item) => item.is_active);
}

async function getWebsiteById(id) {
  const state = await readState();
  const website = state.websites.find((item) => String(item.id) === String(id));
  return website ? {
    ...website,
    target_url: normalizeStoredTargetUrl(website.target_url, website.domain),
    country: normalizeCountryCode(website.country),
  } : null;
}

async function updateWebsite(id, updates = {}) {
  const state = await readState();
  const website = state.websites.find((item) => String(item.id) === String(id));

  if (!website) {
    return null;
  }

  const timestamp = nowIso();
  const nextDomain = updates.domain != null
    ? String(updates.domain).trim().toLowerCase()
    : website.domain;

  website.name = updates.name != null ? updates.name : website.name;
  website.domain = nextDomain;
  if (Object.prototype.hasOwnProperty.call(updates, 'target_url')) {
    website.target_url = normalizeStoredTargetUrl(updates.target_url, nextDomain);
  } else if (!website.target_url) {
    website.target_url = null;
  }
  if (updates.country != null) {
    website.country = normalizeCountryCode(updates.country);
  } else if (!website.country) {
    website.country = 'US';
  }
  if (updates.is_active != null) {
    website.is_active = !!updates.is_active;
  }
  website.updated_at = timestamp;

  await writeState(state);
  return {
    ...website,
    target_url: normalizeStoredTargetUrl(website.target_url, website.domain),
    country: normalizeCountryCode(website.country),
  };
}

async function deleteWebsite(id) {
  const state = await readState();
  state.websites = state.websites.filter((item) => String(item.id) !== String(id));
  state.rankings = state.rankings.filter((item) => String(item.website_id) !== String(id));
  await writeState(state);
}

async function getTrackedKeywords() {
  const state = await readState();
  return [...state.keywords].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function getKeywordById(id) {
  const state = await readState();
  return state.keywords.find((item) => String(item.id) === String(id)) || null;
}

async function deleteKeyword(id) {
  const state = await readState();
  state.keywords = state.keywords.filter((item) => String(item.id) !== String(id));
  state.rankings = state.rankings.filter((item) => String(item.keyword_id) !== String(id));
  await writeState(state);
}

async function saveRanking({ keywordId, websiteId = null, url, position, title, date }) {
  const state = await readState();
  const timestamp = nowIso();
  const existing = state.rankings.find(
    (item) =>
      String(item.keyword_id) === String(keywordId) &&
      String(item.website_id ?? '') === String(websiteId ?? '') &&
      item.date === date
  );

  if (existing) {
    existing.url = url;
    existing.position = position;
    existing.title = title;
  } else {
    state.rankings.push({
      id: nextId(state.rankings),
      website_id: websiteId != null ? Number(websiteId) : null,
      keyword_id: Number(keywordId),
      url,
      position,
      title,
      date,
      created_at: timestamp,
    });
  }

  await writeState(state);
}

async function getRankingHistory(keywordId, days = 30, websiteId = null) {
  const state = await readState();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return state.rankings
    .filter(
      (item) =>
        String(item.keyword_id) === String(keywordId) &&
        (websiteId == null || String(item.website_id ?? '') === String(websiteId)) &&
        new Date(item.date) >= cutoff
    )
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function getLatestRankings(websiteId = null) {
  const state = await readState();
  const latestByKeyword = new Map();

  for (const ranking of state.rankings) {
    if (websiteId != null && String(ranking.website_id ?? '') !== String(websiteId)) {
      continue;
    }

    const key = `${ranking.website_id ?? 'none'}::${ranking.keyword_id}`;
    const current = latestByKeyword.get(key);

    if (!current || new Date(ranking.date) > new Date(current.date)) {
      latestByKeyword.set(key, ranking);
    }
  }

  return [...latestByKeyword.values()]
    .map((ranking) => ({
      ...ranking,
      keyword: state.keywords.find((item) => String(item.id) === String(ranking.keyword_id))?.keyword || '',
      website_name: state.websites.find((item) => String(item.id) === String(ranking.website_id))?.name || null,
      website_domain: state.websites.find((item) => String(item.id) === String(ranking.website_id))?.domain || null,
    }))
    .sort((a, b) => {
      const websiteOrder = (a.website_domain || '').localeCompare(b.website_domain || '');
      return websiteOrder !== 0 ? websiteOrder : a.keyword.localeCompare(b.keyword);
    });
}

async function saveKeywordResearchHistory(result, maxEntries = 12) {
  const state = await readState();
  const timestamp = nowIso();
  const keywordKey = String(result.keyword || '').trim().toLowerCase();
  const existing = state.keywordResearchHistory.find((item) => item.keyword_key === keywordKey);

  if (existing) {
    existing.keyword = result.keyword;
    existing.total_suggestions = result.totalSuggestions || result.allSuggestions?.length || 0;
    existing.deep_scan = !!result.deepScan;
    existing.result = result;
    existing.updated_at = timestamp;
  } else {
    state.keywordResearchHistory.push({
      id: nextId(state.keywordResearchHistory),
      keyword: result.keyword,
      keyword_key: keywordKey,
      total_suggestions: result.totalSuggestions || result.allSuggestions?.length || 0,
      deep_scan: !!result.deepScan,
      result,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  state.keywordResearchHistory = state.keywordResearchHistory
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, maxEntries);

  await writeState(state);

  return state.keywordResearchHistory.find((item) => item.keyword_key === keywordKey)?.id || null;
}

async function getKeywordResearchHistory(limit = 10) {
  const state = await readState();

  return state.keywordResearchHistory
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, Math.max(1, Number(limit) || 10))
    .map((item) => ({
      id: item.id,
      keyword: item.keyword,
      total_suggestions: item.total_suggestions,
      deep_scan: item.deep_scan,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
}

async function getKeywordResearchHistoryItem(id) {
  const state = await readState();
  const item = state.keywordResearchHistory.find((entry) => String(entry.id) === String(id));

  if (!item) {
    return null;
  }

  return {
    ...item.result,
    historyId: item.id,
    savedAt: item.updated_at,
  };
}

async function deleteKeywordResearchHistoryItem(id) {
  const state = await readState();
  const beforeCount = state.keywordResearchHistory.length;
  state.keywordResearchHistory = state.keywordResearchHistory.filter((entry) => String(entry.id) !== String(id));

  if (state.keywordResearchHistory.length !== beforeCount) {
    await writeState(state);
  }
}

async function saveSerpAnalysisHistory(result, maxEntries = 12) {
  const state = await readState();
  const timestamp = nowIso();
  const keyword = String(result.keyword || '').trim();
  const country = String(result.country || 'US').trim().toUpperCase();
  const entryKey = `${keyword.toLowerCase()}::${country}`;
  const existing = state.serpAnalysisHistory.find((item) => item.entry_key === entryKey);

  if (existing) {
    existing.keyword = keyword;
    existing.country = country;
    existing.country_name = result.countryName || country;
    existing.total_results = result.totalResults || result.results?.length || 0;
    existing.difficulty_score = result.difficulty?.score ?? null;
    existing.result = result;
    existing.updated_at = timestamp;
  } else {
    state.serpAnalysisHistory.push({
      id: nextId(state.serpAnalysisHistory),
      entry_key: entryKey,
      keyword,
      country,
      country_name: result.countryName || country,
      total_results: result.totalResults || result.results?.length || 0,
      difficulty_score: result.difficulty?.score ?? null,
      result,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  state.serpAnalysisHistory = state.serpAnalysisHistory
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, maxEntries);

  await writeState(state);

  return state.serpAnalysisHistory.find((item) => item.entry_key === entryKey)?.id || null;
}

async function getSerpAnalysisHistory(limit = 10) {
  const state = await readState();

  return state.serpAnalysisHistory
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, Math.max(1, Number(limit) || 10))
    .map((item) => ({
      id: item.id,
      keyword: item.keyword,
      country: item.country,
      country_name: item.country_name,
      total_results: item.total_results,
      difficulty_score: item.difficulty_score,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
}

async function getSerpAnalysisHistoryItem(id) {
  const state = await readState();
  const item = state.serpAnalysisHistory.find((entry) => String(entry.id) === String(id));

  if (!item) {
    return null;
  }

  return {
    ...item.result,
    historyId: item.id,
    savedAt: item.updated_at,
  };
}

async function deleteSerpAnalysisHistoryItem(id) {
  const state = await readState();
  const beforeCount = state.serpAnalysisHistory.length;
  state.serpAnalysisHistory = state.serpAnalysisHistory.filter((entry) => String(entry.id) !== String(id));

  if (state.serpAnalysisHistory.length !== beforeCount) {
    await writeState(state);
  }
}

async function saveContentAnalysisHistory(payload, maxEntries = 12) {
  const state = await readState();
  const timestamp = nowIso();

  state.contentAnalysisHistory.push({
    id: nextId(state.contentAnalysisHistory),
    keyword: payload.keyword,
    url: payload.url || null,
    input_mode: payload.inputMode,
    compare_to_serp: !!payload.compareToSerp,
    seo_score: payload.result?.seoScore ?? null,
    word_count: payload.result?.wordCount ?? null,
    payload,
    created_at: timestamp,
    updated_at: timestamp,
  });

  state.contentAnalysisHistory = state.contentAnalysisHistory
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, maxEntries);

  await writeState(state);

  return state.contentAnalysisHistory[0]?.id || null;
}

async function getContentAnalysisHistory(limit = 10) {
  const state = await readState();

  return state.contentAnalysisHistory
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, Math.max(1, Number(limit) || 10))
    .map((item) => ({
      id: item.id,
      keyword: item.keyword,
      url: item.url,
      input_mode: item.input_mode,
      compare_to_serp: item.compare_to_serp,
      seo_score: item.seo_score,
      word_count: item.word_count,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
}

async function getContentAnalysisHistoryItem(id) {
  const state = await readState();
  const item = state.contentAnalysisHistory.find((entry) => String(entry.id) === String(id));

  if (!item) {
    return null;
  }

  return {
    ...item.payload.result,
    historyId: item.id,
    savedAt: item.updated_at,
    inputMode: item.payload.inputMode,
    inputText: item.payload.inputText,
    inputTitle: item.payload.inputTitle || '',
    inputMetaDescription: item.payload.inputMetaDescription || '',
    compareToSerp: item.payload.compareToSerp,
    url: item.payload.url || null,
    keyword: item.payload.keyword,
  };
}

async function deleteContentAnalysisHistoryItem(id) {
  const state = await readState();
  const beforeCount = state.contentAnalysisHistory.length;
  state.contentAnalysisHistory = state.contentAnalysisHistory.filter((entry) => String(entry.id) !== String(id));

  if (state.contentAnalysisHistory.length !== beforeCount) {
    await writeState(state);
  }
}

module.exports = {
  getCachedSERP,
  saveSerpCache,
  getRankTrackerSettings,
  updateRankTrackerSettings,
  getSerpProviderSettings,
  getSerpProviderCredentials,
  updateSerpProviderSetting,
  updateSerpProviderCredentials,
  saveWebsite,
  getWebsites,
  getActiveWebsites,
  getWebsiteById,
  updateWebsite,
  deleteWebsite,
  saveKeyword,
  getTrackedKeywords,
  getKeywordById,
  deleteKeyword,
  saveRanking,
  getRankingHistory,
  getLatestRankings,
  saveKeywordResearchHistory,
  getKeywordResearchHistory,
  getKeywordResearchHistoryItem,
  deleteKeywordResearchHistoryItem,
  saveSerpAnalysisHistory,
  getSerpAnalysisHistory,
  getSerpAnalysisHistoryItem,
  deleteSerpAnalysisHistoryItem,
  saveContentAnalysisHistory,
  getContentAnalysisHistory,
  getContentAnalysisHistoryItem,
  deleteContentAnalysisHistoryItem,
};
