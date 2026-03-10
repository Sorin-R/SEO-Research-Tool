import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 120000, // scraping can be slow
});

// ---- Keywords ----

export async function researchKeyword(keyword, expand = true) {
  const { data } = await api.get('/keywords', {
    params: { q: keyword, expand },
  });
  return data;
}

export async function getKeywordResearchHistory(limit = 10) {
  const { data } = await api.get('/keywords/history', {
    params: { limit },
  });
  return data;
}

export async function getKeywordResearchHistoryItem(id) {
  const { data } = await api.get(`/keywords/history/${id}`);
  return data;
}

export async function deleteKeywordResearchHistoryItem(id) {
  const { data } = await api.delete(`/keywords/history/${id}`);
  return data;
}

export async function filterKeywordsWithAI({ keyword, keywords, prompt, maxResults }) {
  const { data } = await api.post('/keywords/filter', {
    keyword,
    keywords,
    prompt,
    maxResults,
  });
  return data;
}

export async function getTrackedKeywords() {
  const { data } = await api.get('/keywords/tracked');
  return data;
}

export async function trackKeyword(keyword, difficulty, searchVolume) {
  const { data } = await api.post('/keywords/track', {
    keyword,
    difficulty,
    searchVolume,
  });
  return data;
}

export async function deleteTrackedKeyword(id) {
  const { data } = await api.delete(`/keywords/tracked/${id}`);
  return data;
}

// ---- SERP ----

export async function analyzeSERP(keyword, refresh = false, country = 'US') {
  const { data } = await api.get('/serp', {
    params: { q: keyword, refresh, country },
  });
  return data;
}

export async function getSERPAnalysisHistory(limit = 10) {
  const { data } = await api.get('/serp/history', {
    params: { limit },
  });
  return data;
}

export async function getSERPAnalysisHistoryItem(id) {
  const { data } = await api.get(`/serp/history/${id}`);
  return data;
}

export async function deleteSERPAnalysisHistoryItem(id) {
  const { data } = await api.delete(`/serp/history/${id}`);
  return data;
}

export async function getLatestRankings(websiteId = null) {
  const { data } = await api.get('/serp/rankings', {
    params: websiteId ? { websiteId } : undefined,
  });
  return data;
}

export async function getRankingHistory(keywordId, days = 30, websiteId = null) {
  const { data } = await api.get(`/serp/rankings/${keywordId}`, {
    params: websiteId ? { days, websiteId } : { days },
  });
  return data;
}

export async function manualTrackRank(keywordId, keyword, targetDomain, websiteId = null) {
  const { data } = await api.post('/serp/track', {
    keywordId,
    keyword,
    targetDomain,
    websiteId,
  });
  return data;
}

export async function getTrackedWebsites() {
  const { data } = await api.get('/serp/websites');
  return data;
}

export async function createTrackedWebsite({ name, domain }) {
  const { data } = await api.post('/serp/websites', {
    name,
    domain,
  });
  return data;
}

export async function updateTrackedWebsite(id, updates) {
  const { data } = await api.patch(`/serp/websites/${id}`, updates);
  return data;
}

export async function deleteTrackedWebsite(id) {
  const { data } = await api.delete(`/serp/websites/${id}`);
  return data;
}

// ---- Content Analysis ----

export async function analyzeContent({ keyword, text, url, compareToSerp }) {
  const { data } = await api.post('/analyze', {
    keyword,
    text,
    url,
    compareToSerp,
  });
  return data;
}

export async function getContentAnalysisHistory(limit = 10) {
  const { data } = await api.get('/analyze/history', {
    params: { limit },
  });
  return data;
}

export async function getContentAnalysisHistoryItem(id) {
  const { data } = await api.get(`/analyze/history/${id}`);
  return data;
}

export async function deleteContentAnalysisHistoryItem(id) {
  const { data } = await api.delete(`/analyze/history/${id}`);
  return data;
}

// ---- Trends ----

export async function getTrends(keyword, geo = '', months = 12) {
  const { data } = await api.get('/trends', {
    params: { q: keyword, geo, months },
  });
  return data;
}

export async function getRelatedQueries(keyword, geo = '') {
  const { data } = await api.get('/trends/related', {
    params: { q: keyword, geo },
  });
  return data;
}

export async function getRelatedTopics(keyword, geo = '') {
  const { data } = await api.get('/trends/topics', {
    params: { q: keyword, geo },
  });
  return data;
}

export async function compareKeywordTrends(keywords, geo = '', months = 12) {
  const { data } = await api.get('/trends/compare', {
    params: { keywords: keywords.join(','), geo, months },
  });
  return data;
}

// ---- Google Ads ----

export async function getGoogleAdsKeywordIdeas(keyword, bypassCache = false) {
  const { data } = await api.get('/google-ads/keyword-ideas', {
    params: { q: keyword, bypass_cache: bypassCache },
  });
  return data;
}

export async function getGoogleAdsCacheStats() {
  const { data } = await api.get('/google-ads/cache-stats');
  return data;
}

export async function clearGoogleAdsCache() {
  const { data } = await api.post('/google-ads/cache/clear');
  return data;
}
