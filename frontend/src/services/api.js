import axios from 'axios';

export const SELECTED_WEBSITE_STORAGE_KEY = 'seo-tool:selected-website-id';

const api = axios.create({
  baseURL: '/api',
  timeout: 120000, // scraping can be slow
});

const RANK_CHECK_TIMEOUT_MS = 10 * 60 * 1000;
const FULL_RANK_JOB_TIMEOUT_MS = 30 * 60 * 1000;

function getSelectedWebsiteIdFromStorage() {
  try {
    const raw = window.localStorage.getItem(SELECTED_WEBSITE_STORAGE_KEY);
    if (!raw || raw === 'all') {
      return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function shouldScopeRequest(url = '') {
  const scopedPrefixes = ['/keywords', '/serp', '/analyze', '/site-audit', '/backlinks', '/google-ads', '/trends', '/dashboard', '/ai-serp'];
  const excludedPrefixes = ['/websites', '/serp/websites', '/serp/providers', '/serp/schedule', '/serp/jobs', '/backlinks/providers'];
  return scopedPrefixes.some((prefix) => url.startsWith(prefix))
    && !excludedPrefixes.some((prefix) => url.startsWith(prefix));
}

api.interceptors.request.use((config) => {
  const selectedWebsiteId = getSelectedWebsiteIdFromStorage();
  if (!selectedWebsiteId || !shouldScopeRequest(config.url || '')) {
    return config;
  }

  const nextConfig = { ...config };
  const method = String(nextConfig.method || 'get').toLowerCase();

  if (method === 'get' || method === 'delete') {
    nextConfig.params = nextConfig.params || {};
    if (nextConfig.params.websiteId == null) {
      nextConfig.params.websiteId = selectedWebsiteId;
    }
    return nextConfig;
  }

  if (nextConfig.data && typeof nextConfig.data === 'object' && !Array.isArray(nextConfig.data)) {
    if (nextConfig.data.websiteId == null) {
      nextConfig.data.websiteId = selectedWebsiteId;
    }
  } else {
    nextConfig.data = { websiteId: selectedWebsiteId };
  }

  return nextConfig;
});

// ---- Keywords ----

export async function researchKeyword(keyword, options = {}) {
  const { data } = await api.post('/keywords/research', {
    keyword,
    options: {
      expand: options.expand ?? true,
      ...options,
    },
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

export async function getKeywordLists() {
  const { data } = await api.get('/keywords/lists');
  return data;
}

export async function createKeywordList(name) {
  const { data } = await api.post('/keywords/lists', { name });
  return data;
}

export async function addKeywordsToList(listId, items) {
  const { data } = await api.post(`/keywords/lists/${listId}/items`, { items });
  return data;
}

export async function deleteKeywordList(id) {
  const { data } = await api.delete(`/keywords/lists/${id}`);
  return data;
}

export async function deleteKeywordListItem(listId, itemId) {
  const { data } = await api.delete(`/keywords/lists/${listId}/items/${itemId}`);
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

export async function extractCompetitorKeywords(keyword, competitorSites, options = {}) {
  const { data } = await api.post('/keywords/competitors/extract', {
    keyword,
    competitorSites,
    options,
  });
  return data;
}

export async function getTrackedKeywords(websiteId = null) {
  const { data } = await api.get('/keywords/tracked', {
    params: websiteId ? { websiteId } : undefined,
  });
  return data;
}

export async function trackKeyword(keyword, difficulty, searchVolume, websiteId = null) {
  const { data } = await api.post('/keywords/track', {
    keyword,
    difficulty,
    searchVolume,
    websiteId,
  });
  return data;
}

export async function deleteTrackedKeyword(id) {
  const { data } = await api.delete(`/keywords/tracked/${id}`);
  return data;
}

// ---- SERP ----

export async function analyzeSERP(
  keyword,
  refresh = false,
  country = 'US',
  syncTrackedRankings = true,
  options = {}
) {
  const { data } = await api.get('/serp', {
    params: {
      q: keyword,
      refresh,
      country,
      syncTrackedRankings,
      aiOnly: options.aiOnly === true,
      engine: options.engine || undefined,
      searchDomain: options.searchDomain || undefined,
    },
  });
  return data;
}

export async function getRankTrackerSchedule() {
  const { data } = await api.get('/serp/schedule');
  return data;
}

export async function updateRankTrackerSchedule(scheduleTime, searchDepth) {
  const { data } = await api.patch('/serp/schedule', {
    scheduleTime,
    searchDepth,
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

export async function getRankingHistory(keywordId, days = 30, websiteId = null, options = {}) {
  const params = { days };
  if (websiteId) params.websiteId = websiteId;
  if (options.startDate) params.startDate = options.startDate;
  if (options.endDate) params.endDate = options.endDate;
  const { data } = await api.get(`/serp/rankings/${keywordId}`, { params });
  return data;
}

export async function manualTrackRank(
  keywordId,
  keyword,
  targetDomain,
  websiteId = null,
  country = null,
  depth = null
) {
  const { data } = await api.post('/serp/track', {
    keywordId,
    keyword,
    targetDomain,
    websiteId,
    country,
    depth,
  }, {
    timeout: RANK_CHECK_TIMEOUT_MS,
  });
  return data;
}

export async function searchFirstPage({
  keyword,
  engine,
  domain,
  location,
  aiMode,
  screenshotMode,
  localAgentMode,
  highAccuracyMode,
  providerId,
  strictMode,
  verifyUrls,
  debug,
}) {
  const { data } = await api.post('/search', {
    keyword,
    engine,
    domain,
    location,
    aiMode,
    screenshotMode,
    localAgentMode,
    highAccuracyMode,
    providerId,
    strictMode,
    verifyUrls,
    debug,
  });
  return data;
}

export async function getSearchProviders() {
  const { data } = await api.get('/search/providers');
  return data;
}

export async function getLocalSerpAgentStatus() {
  const { data } = await api.get('/local-serp-agent/public-status');
  return data;
}

export async function openLocalSerpCaptchaWindow({ keyword, engine, domain, location }) {
  const { data } = await api.post('/local-serp-agent/captcha/open', {
    keyword,
    engine,
    domain,
    location,
  });
  return data;
}

export async function getTrackedWebsites(options = {}) {
  const { data } = await api.get('/websites', {
    params: {
      includeArchived: options.includeArchived ?? false,
      archivedOnly: options.archivedOnly ?? false,
      search: options.search || undefined,
      tag: options.tag || undefined,
    },
  });
  return data;
}

export async function createTrackedWebsite({ name, projectName, domain, country, tags, gscSiteUrl }) {
  const { data } = await api.post('/websites', {
    name,
    projectName,
    domain,
    country,
    tags,
    gscSiteUrl,
  });
  return data;
}

export async function updateTrackedWebsite(id, updates) {
  const { data } = await api.patch(`/websites/${id}`, updates);
  return data;
}

export async function archiveTrackedWebsite(id, archived = true) {
  const { data } = await api.post(`/websites/${id}/archive`, {
    archived,
  });
  return data;
}

export async function deleteTrackedWebsite(id) {
  const { data } = await api.delete(`/websites/${id}`);
  return data;
}

export async function getSerpProviders() {
  const { data } = await api.get('/serp/providers');
  return data;
}

export async function updateSerpProvider(providerId, enabled) {
  const { data } = await api.patch(`/serp/providers/${providerId}`, {
    enabled,
  });
  return data;
}

export async function updateSerpProviderCredentials(providerId, credentials) {
  const { data } = await api.patch(`/serp/providers/${providerId}/credentials`, {
    credentials,
  });
  return data;
}

export async function testSerpProvider(providerId, options = {}) {
  const { data } = await api.post(`/serp/providers/${providerId}/test`, {
    keyword: options.keyword || undefined,
    engine: options.engine || undefined,
    country: options.country || undefined,
  });
  return data;
}

export async function exportRankings(websiteId = null, format = 'json') {
  if (format === 'csv') {
    const { data } = await api.get('/serp/export', {
      params: { websiteId, format: 'csv' },
      responseType: 'text',
    });
    return data;
  }
  const { data } = await api.get('/serp/export', {
    params: { websiteId, format },
  });
  return data;
}

export async function getRankingTrendsSummary(websiteId = null) {
  const { data } = await api.get('/serp/trends-summary', {
    params: websiteId ? { websiteId } : undefined,
  });
  return data;
}

// ---- Backlinks ----

export async function getBacklinkProviders() {
  const { data } = await api.get('/backlinks/providers');
  return data;
}

export async function updateBacklinkProvider(providerId, enabled) {
  const { data } = await api.patch(`/backlinks/providers/${providerId}`, {
    enabled,
  });
  return data;
}

export async function updateBacklinkProviderCredentials(providerId, credentials) {
  const { data } = await api.patch(`/backlinks/providers/${providerId}/credentials`, {
    credentials,
  });
  return data;
}

export async function runBacklinkScan({
  websiteId = null,
  country = 'US',
  maxBacklinks = 100,
  includeSubdomains = true,
} = {}) {
  const { data } = await api.post('/backlinks/scan', {
    websiteId,
    country,
    maxBacklinks,
    includeSubdomains,
  });
  return data;
}

export async function getLatestBacklinkSnapshot(websiteId = null) {
  const { data } = await api.get('/backlinks/latest', {
    params: { websiteId },
  });
  return data;
}

export async function getBacklinkHistory(websiteId = null, limit = 20) {
  const { data } = await api.get('/backlinks/history', {
    params: { websiteId, limit },
  });
  return data;
}

export async function getJobHistory() {
  const { data } = await api.get('/serp/jobs');
  return data;
}

export async function runManualJob() {
  const { data } = await api.post('/serp/jobs/run', {}, {
    timeout: FULL_RANK_JOB_TIMEOUT_MS,
  });
  return data;
}

export async function getAlerts(limit = 50, unreadOnly = false) {
  const { data } = await api.get('/serp/alerts', {
    params: { limit, unreadOnly },
  });
  return data;
}

export async function markAlertsRead(alertIds = []) {
  const { data } = await api.post('/serp/alerts/read', { alertIds });
  return data;
}

// ---- Site Audit ----

export async function auditSite(url, maxPages = 25) {
  const { data } = await api.post('/site-audit', {
    url,
    maxPages,
  });
  return data;
}

export async function getSiteAuditHistory(limit = 10) {
  const { data } = await api.get('/site-audit/history', {
    params: { limit },
  });
  return data;
}

export async function getSiteAuditHistoryItem(id) {
  const { data } = await api.get(`/site-audit/history/${id}`);
  return data;
}

export async function deleteSiteAuditHistoryItem(id) {
  const { data } = await api.delete(`/site-audit/history/${id}`);
  return data;
}

// ---- Content Analysis ----

export async function analyzeContent({ keyword, text, url, title, metaDescription, compareToSerp }) {
  const { data } = await api.post('/analyze', {
    keyword,
    text,
    url,
    title,
    metaDescription,
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

function normalizeTrendOptions(options = {}) {
  const params = {
    q: String(options.keyword || '').trim(),
  };

  const geo = String(options.geo || '').trim();
  if (geo) params.geo = geo;

  const timeframe = String(options.timeframe || '').trim();
  if (timeframe) params.timeframe = timeframe;

  const startTime = String(options.startTime || '').trim();
  if (startTime) params.startTime = startTime;

  const endTime = String(options.endTime || '').trim();
  if (endTime) params.endTime = endTime;

  const category = Number.parseInt(options.category, 10);
  if (Number.isFinite(category) && category >= 0) {
    params.category = category;
  }

  const property = String(options.property || '').trim();
  if (property) params.property = property;

  const months = Number.parseInt(options.months, 10);
  if (Number.isFinite(months) && months > 0) {
    params.months = months;
  }

  const resolution = String(options.resolution || '').trim();
  if (resolution) params.resolution = resolution;

  return params;
}

export async function getTrends(options = {}) {
  const params = normalizeTrendOptions(options);
  const { data } = await api.get('/trends', {
    params,
  });
  return data;
}

export async function getRelatedQueries(options = {}) {
  const params = normalizeTrendOptions(options);
  const { data } = await api.get('/trends/related', {
    params,
  });
  return data;
}

export async function getRelatedTopics(options = {}) {
  const params = normalizeTrendOptions(options);
  const { data } = await api.get('/trends/topics', {
    params,
  });
  return data;
}

export async function compareKeywordTrends(keywords = [], options = {}) {
  const params = {
    keywords: (Array.isArray(keywords) ? keywords : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(','),
    ...normalizeTrendOptions(options),
  };
  delete params.q;

  const { data } = await api.get('/trends/compare', {
    params,
  });
  return data;
}

export async function getTrendRegions(options = {}) {
  const params = normalizeTrendOptions(options);
  const { data } = await api.get('/trends/regions', {
    params,
  });
  return data;
}

// ---- AI Providers ----

export async function getAIProviders() {
  const { data } = await api.get('/ai-providers');
  return data;
}

export async function updateAIProvider(providerId, enabled) {
  const { data } = await api.patch(`/ai-providers/${providerId}`, {
    enabled,
  });
  return data;
}

export async function updateAIProviderCredentials(providerId, credentials) {
  const { data } = await api.patch(`/ai-providers/${providerId}/credentials`, {
    credentials,
  });
  return data;
}

export async function updateAIProviderModel(providerId, model) {
  const { data } = await api.patch(`/ai-providers/${providerId}/model`, {
    model,
  });
  return data;
}

export async function testAIProviderConnection(providerId) {
  const { data } = await api.post(`/ai-providers/${providerId}/test`);
  return data;
}

// ---- Google Tools (GSC + GA4) ----

export async function getGSCProviders() {
  const { data } = await api.get('/gsc-providers');
  return data;
}

export async function updateGSCProvider(providerId, enabled) {
  const { data } = await api.patch(`/gsc-providers/${providerId}`, {
    enabled,
  });
  return data;
}

export async function updateGSCProviderCredentials(providerId, credentials) {
  const { data } = await api.patch(`/gsc-providers/${providerId}/credentials`, {
    credentials,
  });
  return data;
}

export async function testGSCProviderConnection(providerId, options = null) {
  const payload = typeof options === 'string'
    ? { siteUrl: options || undefined }
    : {
        siteUrl: options?.siteUrl || undefined,
        propertyId: options?.propertyId || undefined,
      };
  const { data } = await api.post(`/gsc-providers/${providerId}/test`, {
    ...payload,
  });
  return data;
}

// ---- Google Ads ----

export async function getGoogleAdsKeywordIdeas(keyword, bypassCache = false, country = 'US') {
  const { data } = await api.get('/google-ads/keyword-ideas', {
    params: { q: keyword, bypass_cache: bypassCache, country },
  });
  return data;
}

export async function getGoogleAdsKeywordHistory(limit = 10) {
  const { data } = await api.get('/google-ads/history', {
    params: { limit },
  });
  return data;
}

export async function getGoogleAdsKeywordHistoryItem(id) {
  const { data } = await api.get(`/google-ads/history/${id}`);
  return data;
}

export async function deleteGoogleAdsKeywordHistoryItem(id) {
  const { data } = await api.delete(`/google-ads/history/${id}`);
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

// ---- Dashboard modules ----

export async function getDashboardSerpModule({ websiteId = null, country = 'US', refresh = false } = {}) {
  const { data } = await api.get('/dashboard/serp', {
    params: {
      websiteId,
      country,
      refresh,
    },
  });
  return data;
}

export async function getDashboardSiteHealthModule({
  websiteId = null,
  dateFrom = null,
  dateTo = null,
} = {}) {
  const { data } = await api.get('/dashboard/site-health', {
    params: {
      websiteId,
      dateFrom,
      dateTo,
    },
  });
  return data;
}

export async function getDashboardAiVisibilityModule({
  websiteId = null,
  country = 'US',
  dateFrom = null,
  dateTo = null,
} = {}) {
  const { data } = await api.get('/dashboard/ai-visibility', {
    params: {
      websiteId,
      country,
      dateFrom,
      dateTo,
    },
  });
  return data;
}

export async function getDashboardTrafficModule({
  websiteId = null,
  country = 'US',
  dateFrom = null,
  dateTo = null,
} = {}) {
  const { data } = await api.get('/dashboard/traffic', {
    params: {
      websiteId,
      country,
      dateFrom,
      dateTo,
    },
  });
  return data;
}

export async function getDashboardBacklinksModule({
  websiteId = null,
  country = 'US',
  refresh = false,
} = {}) {
  const { data } = await api.get('/dashboard/backlinks', {
    params: {
      websiteId,
      country,
      refresh,
    },
  });
  return data;
}

// ---- AI SERP workspace ----

export async function runAiSerpWorkspace({
  websiteId,
  keywords,
  providers = [],
  location = '',
  maxKeywords = 15,
}) {
  const { data } = await api.post('/ai-serp/run', {
    websiteId,
    keywords,
    providers,
    location,
    maxKeywords,
  }, {
    timeout: 10 * 60 * 1000,
  });
  return data;
}

export async function getAiSerpHistory(websiteId = null, limit = 20) {
  const { data } = await api.get('/ai-serp/history', {
    params: {
      websiteId: websiteId || undefined,
      limit,
    },
  });
  return data;
}

export async function getAiSerpHistoryItem(id, websiteId = null) {
  const { data } = await api.get(`/ai-serp/history/${id}`, {
    params: {
      websiteId: websiteId || undefined,
    },
  });
  return data;
}
