const fs = require('fs/promises');
const path = require('path');

const storePath = path.join(__dirname, '../data/runtime-store.json');

function createEmptyState() {
  return {
    keywords: [],
    rankings: [],
    serpCache: [],
    keywordResearchHistory: [],
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
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      rankings: Array.isArray(parsed.rankings) ? parsed.rankings : [],
      serpCache: Array.isArray(parsed.serpCache) ? parsed.serpCache : [],
      keywordResearchHistory: Array.isArray(parsed.keywordResearchHistory)
        ? parsed.keywordResearchHistory
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

async function saveRanking({ keywordId, url, position, title, date }) {
  const state = await readState();
  const timestamp = nowIso();
  const existing = state.rankings.find(
    (item) => String(item.keyword_id) === String(keywordId) && item.date === date
  );

  if (existing) {
    existing.url = url;
    existing.position = position;
    existing.title = title;
  } else {
    state.rankings.push({
      id: nextId(state.rankings),
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

async function getRankingHistory(keywordId, days = 30) {
  const state = await readState();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return state.rankings
    .filter(
      (item) =>
        String(item.keyword_id) === String(keywordId) &&
        new Date(item.date) >= cutoff
    )
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function getLatestRankings() {
  const state = await readState();
  const latestByKeyword = new Map();

  for (const ranking of state.rankings) {
    const current = latestByKeyword.get(ranking.keyword_id);

    if (!current || new Date(ranking.date) > new Date(current.date)) {
      latestByKeyword.set(ranking.keyword_id, ranking);
    }
  }

  return [...latestByKeyword.values()]
    .map((ranking) => ({
      ...ranking,
      keyword:
        state.keywords.find((item) => String(item.id) === String(ranking.keyword_id))?.keyword || '',
    }))
    .sort((a, b) => a.keyword.localeCompare(b.keyword));
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

module.exports = {
  getCachedSERP,
  saveSerpCache,
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
};
