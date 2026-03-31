const fs = require('fs/promises');
const path = require('path');
const { normalizeCountryCode } = require('./searchCountry');

const storePath = path.join(__dirname, '../data/runtime-store.json');
const storeBackupPath = path.join(__dirname, '../data/runtime-store.backup.json');
const storeTempPath = path.join(__dirname, '../data/runtime-store.tmp.json');
const ALLOWED_SEARCH_DEPTHS = [10, 20, 50, 100];
let writeQueue = Promise.resolve();

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

function normalizeStoredGscSiteUrl(gscSiteUrl) {
  if (gscSiteUrl == null) {
    return null;
  }

  const rawValue = String(gscSiteUrl).trim();
  if (!rawValue) {
    return null;
  }

  if (/^sc-domain:/i.test(rawValue)) {
    const domainPart = rawValue.replace(/^sc-domain:/i, '').trim().toLowerCase().replace(/^www\./, '');
    if (!domainPart || domainPart.includes('/')) {
      return null;
    }
    return `sc-domain:${domainPart}`;
  }

  let value = rawValue;
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  try {
    const parsedUrl = new URL(value);
    const protocol = /^https?:$/i.test(parsedUrl.protocol) ? parsedUrl.protocol.toLowerCase() : 'https:';
    const hostname = parsedUrl.hostname.toLowerCase();
    if (!hostname) {
      return null;
    }

    const pathname = normalizePathname(parsedUrl.pathname || '/');
    const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
    return `${protocol}//${hostname}${normalizedPath}`;
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
    serpResults: [],
    rankTrackerSettings: {
      schedule_time: '06:00',
      search_depth: 10,
      updated_at: null,
    },
    serpProviderSettings: {},
    serpProviderCredentials: {},
    serpProviderUsage: {},
    backlinkProviderSettings: {},
    backlinkProviderCredentials: {},
    gscProviderSettings: {},
    gscProviderCredentials: {},
    aiProviderSettings: {},
    aiProviderCredentials: {},
    keywordResearchHistory: [],
    keywordLists: [],
    serpAnalysisHistory: [],
    aiSerpRuns: [],
    aiSerpMentions: [],
    googleAdsKeywordHistory: [],
    contentAnalysisHistory: [],
    siteAuditHistory: [],
    trafficSnapshots: [],
    backlinkSnapshots: [],
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
    return normalizeState(parsed);
  } catch {
    try {
      const backupRaw = await fs.readFile(storeBackupPath, 'utf8');
      const backupParsed = JSON.parse(backupRaw);
      return normalizeState(backupParsed);
    } catch {
      return createEmptyState();
    }
  }
}

async function writeState(state) {
  const runWrite = async () => {
    await ensureStore();
    const normalizedState = normalizeState(state);
    const payload = JSON.stringify(normalizedState, null, 2);
    const uniqueTempPath = `${storeTempPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;

    try {
      await fs.copyFile(storePath, storeBackupPath);
    } catch {
      // best-effort backup only
    }

    await fs.writeFile(uniqueTempPath, payload);

    try {
      await fs.rename(uniqueTempPath, storePath);
    } catch (err) {
      if (err?.code === 'ENOENT') {
        await ensureStore();
        await fs.writeFile(storePath, payload);
        try {
          await fs.unlink(uniqueTempPath);
        } catch {
          // ignore cleanup failures
        }
        return;
      }

      try {
        await fs.unlink(uniqueTempPath);
      } catch {
        // ignore cleanup failures
      }
      throw err;
    }
  };

  const nextWrite = writeQueue.then(runWrite, runWrite);
  writeQueue = nextWrite.catch(() => {});
  return nextWrite;
}

function normalizeState(parsed) {
  return {
    websites: Array.isArray(parsed?.websites) ? parsed.websites : [],
    keywords: Array.isArray(parsed?.keywords) ? parsed.keywords : [],
    rankings: Array.isArray(parsed?.rankings) ? parsed.rankings : [],
    serpCache: Array.isArray(parsed?.serpCache) ? parsed.serpCache : [],
    serpResults: Array.isArray(parsed?.serpResults) ? parsed.serpResults : [],
    rankTrackerSettings: parsed?.rankTrackerSettings && typeof parsed.rankTrackerSettings === 'object'
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
    serpProviderSettings: parsed?.serpProviderSettings && typeof parsed.serpProviderSettings === 'object'
      ? parsed.serpProviderSettings
      : {},
    serpProviderCredentials: parsed?.serpProviderCredentials && typeof parsed.serpProviderCredentials === 'object'
      ? parsed.serpProviderCredentials
      : {},
    serpProviderUsage: parsed?.serpProviderUsage && typeof parsed.serpProviderUsage === 'object'
      ? parsed.serpProviderUsage
      : {},
    backlinkProviderSettings: parsed?.backlinkProviderSettings && typeof parsed.backlinkProviderSettings === 'object'
      ? parsed.backlinkProviderSettings
      : {},
    backlinkProviderCredentials: parsed?.backlinkProviderCredentials && typeof parsed.backlinkProviderCredentials === 'object'
      ? parsed.backlinkProviderCredentials
      : {},
    gscProviderSettings: parsed?.gscProviderSettings && typeof parsed.gscProviderSettings === 'object'
      ? parsed.gscProviderSettings
      : {},
    gscProviderCredentials: parsed?.gscProviderCredentials && typeof parsed.gscProviderCredentials === 'object'
      ? parsed.gscProviderCredentials
      : {},
    aiProviderSettings: parsed?.aiProviderSettings && typeof parsed.aiProviderSettings === 'object'
      ? parsed.aiProviderSettings
      : {},
    aiProviderCredentials: parsed?.aiProviderCredentials && typeof parsed.aiProviderCredentials === 'object'
      ? parsed.aiProviderCredentials
      : {},
    keywordResearchHistory: Array.isArray(parsed?.keywordResearchHistory)
      ? parsed.keywordResearchHistory
      : [],
    keywordLists: Array.isArray(parsed?.keywordLists)
      ? parsed.keywordLists
      : [],
    serpAnalysisHistory: Array.isArray(parsed?.serpAnalysisHistory)
      ? parsed.serpAnalysisHistory
      : [],
    aiSerpRuns: Array.isArray(parsed?.aiSerpRuns)
      ? parsed.aiSerpRuns
      : [],
    aiSerpMentions: Array.isArray(parsed?.aiSerpMentions)
      ? parsed.aiSerpMentions
      : [],
    googleAdsKeywordHistory: Array.isArray(parsed?.googleAdsKeywordHistory)
      ? parsed.googleAdsKeywordHistory
      : [],
    contentAnalysisHistory: Array.isArray(parsed?.contentAnalysisHistory)
      ? parsed.contentAnalysisHistory
      : [],
    siteAuditHistory: Array.isArray(parsed?.siteAuditHistory)
      ? parsed.siteAuditHistory
      : [],
    trafficSnapshots: Array.isArray(parsed?.trafficSnapshots)
      ? parsed.trafficSnapshots
      : [],
    backlinkSnapshots: Array.isArray(parsed?.backlinkSnapshots)
      ? parsed.backlinkSnapshots
      : [],
  };
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

async function saveSerpResultsSnapshot({ websiteId = null, query, country = 'US', engine, results = [] }) {
  const state = await readState();
  const timestamp = nowIso();

  state.serpResults = (state.serpResults || []).filter(
    (item) => !(
      String(item.website_id ?? '') === String(websiteId ?? '')
      && String(item.query || '').toLowerCase() === String(query || '').toLowerCase()
      && String(item.country || 'US').toUpperCase() === String(country || 'US').toUpperCase()
      && String(item.engine || '').toLowerCase() === String(engine || '').toLowerCase()
    )
  );

  for (const result of results.slice(0, 10)) {
    if (!result?.url) {
      continue;
    }

    state.serpResults.push({
      id: nextId(state.serpResults),
      website_id: websiteId != null ? Number(websiteId) : null,
      query: String(query || ''),
      country: String(country || 'US').toUpperCase(),
      engine: String(engine || '').toLowerCase(),
      position: Number(result.position) || 0,
      url: String(result.url || ''),
      domain: String(result.domain || ''),
      title: String(result.title || ''),
      snippet: String(result.snippet || ''),
      fetched_at: timestamp,
    });
  }

  await writeState(state);
}

async function getSerpResultsByScope({ websiteId = null, country = null, queryList = [] }) {
  const state = await readState();
  const normalizedCountry = country ? String(country).toUpperCase() : null;
  const normalizedQueries = (Array.isArray(queryList) ? queryList : [])
    .map((query) => String(query || '').trim().toLowerCase())
    .filter(Boolean);
  const allowedQueries = new Set(normalizedQueries);

  return (state.serpResults || [])
    .filter((item) => (
      (websiteId == null || String(item.website_id ?? '') === String(websiteId))
      && (!normalizedCountry || String(item.country || '').toUpperCase() === normalizedCountry)
      && (allowedQueries.size === 0 || allowedQueries.has(String(item.query || '').trim().toLowerCase()))
    ))
    .sort((left, right) => {
      const leftTime = new Date(left.fetched_at || 0).getTime();
      const rightTime = new Date(right.fetched_at || 0).getTime();
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return (Number(left.position) || 0) - (Number(right.position) || 0);
    });
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

async function getGscProviderSettings() {
  const state = await readState();
  return { ...(state.gscProviderSettings || {}) };
}

async function getGscProviderCredentials() {
  const state = await readState();
  return { ...(state.gscProviderCredentials || {}) };
}

async function updateGscProviderSetting(providerId, isEnabled) {
  const state = await readState();
  state.gscProviderSettings = {
    ...(state.gscProviderSettings || {}),
    [providerId]: {
      is_enabled: !!isEnabled,
      updated_at: nowIso(),
    },
  };
  await writeState(state);
  return state.gscProviderSettings[providerId];
}

async function updateGscProviderCredentials(providerId, credentials = {}) {
  const state = await readState();
  const existing = state.gscProviderCredentials?.[providerId] || {};
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

  state.gscProviderCredentials = {
    ...(state.gscProviderCredentials || {}),
    [providerId]: nextCredentials,
  };

  await writeState(state);
  return state.gscProviderCredentials[providerId];
}

async function getAIProviderSettings() {
  const state = await readState();
  return { ...(state.aiProviderSettings || {}) };
}

async function getAIProviderCredentials() {
  const state = await readState();
  return { ...(state.aiProviderCredentials || {}) };
}

async function updateAIProviderSetting(providerId, isEnabled) {
  const state = await readState();
  state.aiProviderSettings = {
    ...(state.aiProviderSettings || {}),
    [providerId]: {
      is_enabled: !!isEnabled,
      updated_at: nowIso(),
    },
  };
  await writeState(state);
  return state.aiProviderSettings[providerId];
}

async function updateAIProviderCredentials(providerId, credentials = {}) {
  const state = await readState();
  const existing = state.aiProviderCredentials?.[providerId] || {};
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

  state.aiProviderCredentials = {
    ...(state.aiProviderCredentials || {}),
    [providerId]: nextCredentials,
  };

  await writeState(state);
  return state.aiProviderCredentials[providerId];
}

function parseNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function getSerpProviderUsageMap() {
  const state = await readState();
  return { ...(state.serpProviderUsage || {}) };
}

async function getBacklinkProviderSettings() {
  const state = await readState();
  return { ...(state.backlinkProviderSettings || {}) };
}

async function getBacklinkProviderCredentials() {
  const state = await readState();
  return { ...(state.backlinkProviderCredentials || {}) };
}

async function updateBacklinkProviderSetting(providerId, isEnabled) {
  const state = await readState();
  state.backlinkProviderSettings = {
    ...(state.backlinkProviderSettings || {}),
    [providerId]: {
      is_enabled: !!isEnabled,
      updated_at: nowIso(),
    },
  };
  await writeState(state);
  return state.backlinkProviderSettings[providerId];
}

async function updateBacklinkProviderCredentials(providerId, credentials = {}) {
  const state = await readState();
  const existing = state.backlinkProviderCredentials?.[providerId] || {};
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

  state.backlinkProviderCredentials = {
    ...(state.backlinkProviderCredentials || {}),
    [providerId]: nextCredentials,
  };

  await writeState(state);
  return state.backlinkProviderCredentials[providerId];
}

async function consumeSerpProviderUsage(providerId, amount = 1, defaults = {}) {
  const state = await readState();
  const current = state.serpProviderUsage?.[providerId] || {};
  const quotaLimit = parseNonNegativeInt(current.quota_limit, parseNonNegativeInt(defaults.quota_limit, 0));
  const fallbackRemaining = parseNonNegativeInt(defaults.remaining, quotaLimit);
  const currentRemaining = parseNonNegativeInt(current.remaining, fallbackRemaining);
  const currentUsed = parseNonNegativeInt(current.used_count, Math.max(quotaLimit - currentRemaining, 0));
  const usageDelta = Math.max(1, parseNonNegativeInt(amount, 1));

  const nextUsage = {
    quota_limit: quotaLimit,
    remaining: Math.max(0, currentRemaining - usageDelta),
    used_count: currentUsed + usageDelta,
    updated_at: nowIso(),
  };

  state.serpProviderUsage = {
    ...(state.serpProviderUsage || {}),
    [providerId]: nextUsage,
  };

  await writeState(state);
  return nextUsage;
}

async function saveKeyword(keyword, difficulty = null, searchVolume = null, websiteId = null) {
  const state = await readState();
  const existing = state.keywords.find(
    (item) =>
      item.keyword === keyword &&
      String(item.website_id ?? '') === String(websiteId ?? '')
  );
  const timestamp = nowIso();

  if (existing) {
    if (difficulty != null) existing.difficulty = difficulty;
    if (searchVolume != null) existing.search_volume = searchVolume;
    existing.updated_at = timestamp;
  } else {
    state.keywords.push({
      id: nextId(state.keywords),
      website_id: websiteId != null ? Number(websiteId) : null,
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
  const gscSiteUrl = normalizeStoredGscSiteUrl(website.gsc_site_url || website.gscSiteUrl);
  const country = normalizeCountryCode(website.country);
  const tags = Array.isArray(website.tags)
    ? [...new Set(website.tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean))]
    : [];
  const projectName = String(website.project_name || website.projectName || website.name || domain).trim() || domain;
  const archived = Boolean(website.archived);
  const existing = state.websites.find((item) => item.domain === domain);

  if (existing) {
    existing.name = website.name || existing.name;
    existing.project_name = projectName;
    existing.tags = tags;
    existing.archived = archived;
    existing.domain = domain;
    existing.target_url = targetUrl;
    existing.gsc_site_url = gscSiteUrl;
    existing.country = country;
    existing.is_active = website.is_active != null ? !!website.is_active : existing.is_active;
    existing.updated_at = timestamp;
    await writeState(state);
    return {
      ...existing,
      target_url: normalizeStoredTargetUrl(existing.target_url, existing.domain),
      gsc_site_url: normalizeStoredGscSiteUrl(existing.gsc_site_url),
      gscSiteUrl: normalizeStoredGscSiteUrl(existing.gsc_site_url),
      country: normalizeCountryCode(existing.country),
      project_name: existing.project_name || existing.name,
      projectName: existing.project_name || existing.name,
      tags: Array.isArray(existing.tags) ? existing.tags : [],
      archived: Boolean(existing.archived),
    };
  }

  const nextWebsite = {
    id: nextId(state.websites),
    name: website.name || domain,
    project_name: projectName,
    tags,
    archived,
    domain,
    target_url: targetUrl,
    gsc_site_url: gscSiteUrl,
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
    gsc_site_url: normalizeStoredGscSiteUrl(nextWebsite.gsc_site_url),
    gscSiteUrl: normalizeStoredGscSiteUrl(nextWebsite.gsc_site_url),
    country: normalizeCountryCode(nextWebsite.country),
    project_name: nextWebsite.project_name,
    projectName: nextWebsite.project_name,
    tags: nextWebsite.tags,
    archived: Boolean(nextWebsite.archived),
  };
}

async function getWebsites(options = {}) {
  const state = await readState();
  const includeArchived = options.includeArchived === true || options.includeArchived === 'true';
  const archivedOnly = options.archivedOnly === true || options.archivedOnly === 'true';
  const normalizedSearch = String(options.search || '').trim().toLowerCase();
  const normalizedTag = String(options.tag || '').trim().toLowerCase();

  let websites = [...state.websites].map((item) => ({
    ...item,
    target_url: normalizeStoredTargetUrl(item.target_url, item.domain),
    gsc_site_url: normalizeStoredGscSiteUrl(item.gsc_site_url || item.gscSiteUrl),
    gscSiteUrl: normalizeStoredGscSiteUrl(item.gsc_site_url || item.gscSiteUrl),
    country: normalizeCountryCode(item.country),
    project_name: item.project_name || item.name || item.domain,
    projectName: item.project_name || item.name || item.domain,
    tags: Array.isArray(item.tags) ? item.tags : [],
    archived: Boolean(item.archived),
  }));

  if (archivedOnly) {
    websites = websites.filter((item) => item.archived);
  } else if (!includeArchived) {
    websites = websites.filter((item) => !item.archived);
  }

  if (normalizedSearch) {
    websites = websites.filter((item) =>
      String(item.domain || '').toLowerCase().includes(normalizedSearch)
      || String(item.name || '').toLowerCase().includes(normalizedSearch)
      || String(item.project_name || '').toLowerCase().includes(normalizedSearch)
    );
  }

  if (normalizedTag) {
    websites = websites.filter((item) => (item.tags || []).includes(normalizedTag));
  }

  return websites.sort((left, right) => {
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
  return websites.filter((item) => item.is_active && !item.archived);
}

async function getWebsiteById(id) {
  const state = await readState();
  const website = state.websites.find((item) => String(item.id) === String(id));
  return website ? {
    ...website,
    target_url: normalizeStoredTargetUrl(website.target_url, website.domain),
    gsc_site_url: normalizeStoredGscSiteUrl(website.gsc_site_url || website.gscSiteUrl),
    gscSiteUrl: normalizeStoredGscSiteUrl(website.gsc_site_url || website.gscSiteUrl),
    country: normalizeCountryCode(website.country),
    project_name: website.project_name || website.name || website.domain,
    projectName: website.project_name || website.name || website.domain,
    tags: Array.isArray(website.tags) ? website.tags : [],
    archived: Boolean(website.archived),
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
  website.project_name = updates.project_name != null
    ? String(updates.project_name || '').trim()
    : updates.projectName != null
      ? String(updates.projectName || '').trim()
      : website.project_name || website.name;
  website.domain = nextDomain;
  if (Object.prototype.hasOwnProperty.call(updates, 'target_url')) {
    website.target_url = normalizeStoredTargetUrl(updates.target_url, nextDomain);
  } else if (!website.target_url) {
    website.target_url = null;
  }
  if (
    Object.prototype.hasOwnProperty.call(updates, 'gsc_site_url')
    || Object.prototype.hasOwnProperty.call(updates, 'gscSiteUrl')
  ) {
    website.gsc_site_url = normalizeStoredGscSiteUrl(updates.gsc_site_url ?? updates.gscSiteUrl);
  } else if (!website.gsc_site_url) {
    website.gsc_site_url = null;
  }
  if (updates.country != null) {
    website.country = normalizeCountryCode(updates.country);
  } else if (!website.country) {
    website.country = 'US';
  }
  if (updates.is_active != null) {
    website.is_active = !!updates.is_active;
  }
  if (updates.archived != null) {
    website.archived = !!updates.archived;
    if (website.archived) {
      website.is_active = false;
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'tags')) {
    website.tags = Array.isArray(updates.tags)
      ? [...new Set(updates.tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean))]
      : [];
  }
  website.updated_at = timestamp;

  await writeState(state);
  return {
    ...website,
    target_url: normalizeStoredTargetUrl(website.target_url, website.domain),
    gsc_site_url: normalizeStoredGscSiteUrl(website.gsc_site_url || website.gscSiteUrl),
    gscSiteUrl: normalizeStoredGscSiteUrl(website.gsc_site_url || website.gscSiteUrl),
    country: normalizeCountryCode(website.country),
    project_name: website.project_name || website.name || website.domain,
    projectName: website.project_name || website.name || website.domain,
    tags: Array.isArray(website.tags) ? website.tags : [],
    archived: Boolean(website.archived),
  };
}

async function deleteWebsite(id) {
  const state = await readState();
  state.websites = state.websites.filter((item) => String(item.id) !== String(id));
  state.keywords = state.keywords.filter((item) => String(item.website_id ?? '') !== String(id));
  state.rankings = state.rankings.filter((item) => String(item.website_id) !== String(id));
  state.aiSerpRuns = state.aiSerpRuns.filter((item) => String(item.website_id ?? '') !== String(id));
  state.aiSerpMentions = state.aiSerpMentions.filter((item) => String(item.website_id ?? '') !== String(id));
  state.keywordResearchHistory = state.keywordResearchHistory.filter((item) => String(item.website_id ?? '') !== String(id));
  state.keywordLists = state.keywordLists.filter((item) => String(item.website_id ?? '') !== String(id));
  state.serpAnalysisHistory = state.serpAnalysisHistory.filter((item) => String(item.website_id ?? '') !== String(id));
  state.googleAdsKeywordHistory = state.googleAdsKeywordHistory.filter((item) => String(item.website_id ?? '') !== String(id));
  state.contentAnalysisHistory = state.contentAnalysisHistory.filter((item) => String(item.website_id ?? '') !== String(id));
  state.siteAuditHistory = state.siteAuditHistory.filter((item) => String(item.website_id ?? '') !== String(id));
  state.backlinkSnapshots = state.backlinkSnapshots.filter((item) => String(item.website_id ?? '') !== String(id));
  await writeState(state);
}

async function getTrackedKeywords(websiteId = null) {
  const state = await readState();
  return [...state.keywords]
    .filter((item) => (
      websiteId == null
        ? true
        : String(item.website_id ?? '') === String(websiteId)
          || item.website_id == null
    ))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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
  const keywordsById = new Map(state.keywords.map((item) => [String(item.id), item]));

  for (const ranking of state.rankings) {
    if (websiteId != null && String(ranking.website_id ?? '') !== String(websiteId)) {
      continue;
    }

    const keywordRow = keywordsById.get(String(ranking.keyword_id));
    if (!keywordRow) {
      continue;
    }

    if (keywordRow.website_id != null && String(keywordRow.website_id) !== String(ranking.website_id ?? '')) {
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
      keyword: keywordsById.get(String(ranking.keyword_id))?.keyword || '',
      website_name: state.websites.find((item) => String(item.id) === String(ranking.website_id))?.name || null,
      website_domain: state.websites.find((item) => String(item.id) === String(ranking.website_id))?.domain || null,
    }))
    .sort((a, b) => {
      const websiteOrder = (a.website_domain || '').localeCompare(b.website_domain || '');
      return websiteOrder !== 0 ? websiteOrder : a.keyword.localeCompare(b.keyword);
    });
}

async function saveKeywordResearchHistory(result, maxEntries = 12, websiteId = null) {
  const state = await readState();
  const timestamp = nowIso();
  const keywordKey = String(result.keyword || '').trim().toLowerCase();
  const existing = state.keywordResearchHistory.find(
    (item) => item.keyword_key === keywordKey && String(item.website_id ?? '') === String(websiteId ?? '')
  );

  if (existing) {
    existing.keyword = result.keyword;
    existing.total_suggestions = result.totalSuggestions || result.allSuggestions?.length || 0;
    existing.deep_scan = !!result.deepScan;
    existing.result = result;
    existing.updated_at = timestamp;
  } else {
    state.keywordResearchHistory.push({
      id: nextId(state.keywordResearchHistory),
      website_id: websiteId != null ? Number(websiteId) : null,
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

  return state.keywordResearchHistory.find(
    (item) => item.keyword_key === keywordKey && String(item.website_id ?? '') === String(websiteId ?? '')
  )?.id || null;
}

async function getKeywordResearchHistory(limit = 10, websiteId = null) {
  const state = await readState();

  return state.keywordResearchHistory
    .filter((item) => (
      websiteId == null
        ? true
        : String(item.website_id ?? '') === String(websiteId)
    ))
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

async function getKeywordResearchHistoryItem(id, websiteId = null) {
  const state = await readState();
  const item = state.keywordResearchHistory.find(
    (entry) =>
      String(entry.id) === String(id)
      && (websiteId == null || String(entry.website_id ?? '') === String(websiteId))
  );

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

function normalizeKeywordListName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

function normalizeListKeyword(keyword) {
  return String(keyword || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function getKeywordLists(websiteId = null) {
  const state = await readState();

  return state.keywordLists
    .filter((list) => (
      websiteId == null
        ? true
        : String(list.website_id ?? '') === String(websiteId)
    ))
    .map((list) => ({
      id: list.id,
      name: list.name,
      items: Array.isArray(list.items) ? list.items : [],
      itemCount: Array.isArray(list.items) ? list.items.length : 0,
      created_at: list.created_at,
      updated_at: list.updated_at,
    }))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

async function createKeywordList(name, maxLists = 20, websiteId = null) {
  const state = await readState();
  const normalizedName = normalizeKeywordListName(name);

  if (!normalizedName) {
    throw new Error('List name is required.');
  }

  const existing = state.keywordLists.find(
    (list) =>
      list.name.toLowerCase() === normalizedName.toLowerCase()
      && String(list.website_id ?? '') === String(websiteId ?? '')
  );
  if (existing) {
    return {
      ...existing,
      itemCount: Array.isArray(existing.items) ? existing.items.length : 0,
    };
  }

  const currentScopeCount = state.keywordLists.filter(
    (list) => String(list.website_id ?? '') === String(websiteId ?? '')
  ).length;
  if (currentScopeCount >= maxLists) {
    throw new Error(`You can save up to ${maxLists} keyword lists.`);
  }

  const timestamp = nowIso();
  const list = {
    id: nextId(state.keywordLists),
    website_id: websiteId != null ? Number(websiteId) : null,
    name: normalizedName,
    items: [],
    created_at: timestamp,
    updated_at: timestamp,
  };

  state.keywordLists.push(list);
  await writeState(state);

  return {
    ...list,
    itemCount: 0,
  };
}

async function addKeywordsToList(listId, items = [], websiteId = null) {
  const state = await readState();
  const list = state.keywordLists.find(
    (entry) =>
      String(entry.id) === String(listId)
      && (websiteId == null || String(entry.website_id ?? '') === String(websiteId))
  );

  if (!list) {
    throw new Error('Keyword list not found.');
  }

  list.items = Array.isArray(list.items) ? list.items : [];
  let nextItemId = list.items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;

  for (const item of items) {
    const normalizedKeyword = String(item.keyword || '').replace(/\s+/g, ' ').trim();
    if (!normalizedKeyword) continue;

    const existing = list.items.find((entry) => normalizeListKeyword(entry.keyword) === normalizeListKeyword(normalizedKeyword));

    if (existing) {
      existing.intent = item.intent || existing.intent || null;
      existing.clusterLabel = item.clusterLabel || existing.clusterLabel || null;
      existing.priorityScore = item.priorityScore ?? existing.priorityScore ?? null;
      existing.recommendedPageType = item.recommendedPageType || existing.recommendedPageType || null;
      existing.sourceKeyword = item.sourceKeyword || existing.sourceKeyword || null;
      existing.notes = [...new Set([...(existing.notes || []), ...(item.notes || [])])];
    } else {
      list.items.push({
        id: nextItemId,
        keyword: normalizedKeyword,
        intent: item.intent || null,
        clusterLabel: item.clusterLabel || null,
        priorityScore: item.priorityScore ?? null,
        recommendedPageType: item.recommendedPageType || null,
        sourceKeyword: item.sourceKeyword || null,
        notes: Array.isArray(item.notes) ? item.notes : [],
      });
      nextItemId += 1;
    }
  }

  list.items = list.items.sort((a, b) => {
    const scoreA = Number(a.priorityScore) || 0;
    const scoreB = Number(b.priorityScore) || 0;
    return scoreB - scoreA || a.keyword.localeCompare(b.keyword);
  });
  list.updated_at = nowIso();
  await writeState(state);

  return {
    ...list,
    itemCount: list.items.length,
  };
}

async function deleteKeywordList(id) {
  const state = await readState();
  const beforeCount = state.keywordLists.length;
  state.keywordLists = state.keywordLists.filter((entry) => String(entry.id) !== String(id));

  if (state.keywordLists.length !== beforeCount) {
    await writeState(state);
  }
}

async function deleteKeywordListItem(listId, itemId) {
  const state = await readState();
  const list = state.keywordLists.find((entry) => String(entry.id) === String(listId));

  if (!list) {
    throw new Error('Keyword list not found.');
  }

  const beforeCount = Array.isArray(list.items) ? list.items.length : 0;
  list.items = (list.items || []).filter((entry) => String(entry.id) !== String(itemId));

  if (list.items.length !== beforeCount) {
    list.updated_at = nowIso();
    await writeState(state);
  }
}

async function saveSerpAnalysisHistory(result, maxEntries = 12, websiteId = null) {
  const state = await readState();
  const timestamp = nowIso();
  const keyword = String(result.keyword || '').trim();
  const country = String(result.country || 'US').trim().toUpperCase();
  const entryKey = `${keyword.toLowerCase()}::${country}::${websiteId ?? 'global'}`;
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
      website_id: websiteId != null ? Number(websiteId) : null,
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

async function getSerpAnalysisHistory(limit = 10, websiteId = null) {
  const state = await readState();

  return state.serpAnalysisHistory
    .filter((item) => (
      websiteId == null
        ? true
        : String(item.website_id ?? '') === String(websiteId)
    ))
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

async function getSerpAnalysisHistoryItem(id, websiteId = null) {
  const state = await readState();
  const item = state.serpAnalysisHistory.find(
    (entry) =>
      String(entry.id) === String(id)
      && (websiteId == null || String(entry.website_id ?? '') === String(websiteId))
  );

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

async function saveAiSerpRun(payload = {}) {
  const state = await readState();
  const timestamp = nowIso();
  const runId = nextId(state.aiSerpRuns);
  const mentionsInput = Array.isArray(payload.mentions) ? payload.mentions : [];

  state.aiSerpRuns.push({
    id: runId,
    website_id: payload.websiteId != null ? Number(payload.websiteId) : null,
    engine: String(payload.engine || 'llm').toLowerCase(),
    search_domain: String(payload.searchDomain || '').trim().toLowerCase() || null,
    country: String(payload.country || 'US').trim().toUpperCase(),
    location: String(payload.location || '').trim() || null,
    keyword_count: Number(payload.keywordCount || 0),
    total_citations: Number(payload.totalCitations || mentionsInput.length),
    my_citations: Number(payload.myCitations || 0),
    average_best_rank: payload.averageBestRank != null ? Number(payload.averageBestRank) : null,
    result: payload.result || null,
    created_at: timestamp,
    updated_at: timestamp,
  });

  for (const mention of mentionsInput) {
    state.aiSerpMentions.push({
      id: nextId(state.aiSerpMentions),
      run_id: runId,
      website_id: payload.websiteId != null ? Number(payload.websiteId) : null,
      provider_id: String(mention.providerId || '').trim() || null,
      provider_name: String(mention.providerName || '').trim() || null,
      provider_model: String(mention.model || '').trim() || null,
      keyword: String(mention.keyword || '').trim(),
      result_position: mention.resultPosition != null ? Number(mention.resultPosition) : null,
      cited_title: String(mention.citedTitle || '').trim() || null,
      cited_url: String(mention.citedUrl || '').trim() || null,
      cited_domain: String(mention.citedDomain || '').trim() || null,
      appears_on_site: mention.appearsOnSite ? 1 : 0,
      fetched_at: mention.fetchedAt || timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  await writeState(state);
  return runId;
}

async function getAiSerpRuns(websiteId = null, limit = 20) {
  const state = await readState();
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

  return state.aiSerpRuns
    .filter((item) => (
      websiteId == null
        ? true
        : String(item.website_id ?? '') === String(websiteId)
    ))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, safeLimit)
    .map((item) => ({
      id: item.id,
      website_id: item.website_id,
      engine: item.engine,
      search_domain: item.search_domain,
      country: item.country,
      location: item.location,
      keyword_count: item.keyword_count,
      total_citations: item.total_citations,
      my_citations: item.my_citations,
      average_best_rank: item.average_best_rank,
      created_at: item.created_at,
      updated_at: item.updated_at,
      citation_share: item.total_citations > 0
        ? Number(item.my_citations || 0) / Number(item.total_citations || 1)
        : 0,
    }));
}

async function getAiSerpRunById(id, websiteId = null) {
  const state = await readState();
  const run = state.aiSerpRuns.find((item) => (
    String(item.id) === String(id)
    && (websiteId == null || String(item.website_id ?? '') === String(websiteId))
  ));

  if (!run) {
    return null;
  }

  const mentions = state.aiSerpMentions
    .filter((item) => String(item.run_id) === String(run.id))
    .sort((a, b) => {
      const keyA = `${String(a.keyword || '').toLowerCase()}::${Number(a.result_position) || 999}`;
      const keyB = `${String(b.keyword || '').toLowerCase()}::${Number(b.result_position) || 999}`;
      return keyA.localeCompare(keyB);
    });

  return {
    ...run,
    mentions: mentions.map((item) => ({
      ...item,
      provider_id: item.provider_id || null,
      provider_name: item.provider_name || null,
      provider_model: item.provider_model || null,
    })),
    result: run.result || null,
  };
}

async function getAiSerpMentions({ websiteId = null, dateFrom = null, dateTo = null } = {}) {
  const state = await readState();

  return state.aiSerpMentions.filter((item) => {
    if (websiteId != null && String(item.website_id ?? '') !== String(websiteId)) {
      return false;
    }

    const parsed = new Date(item.fetched_at || item.created_at || 0);
    if (Number.isNaN(parsed.getTime())) {
      return false;
    }

    if (dateFrom && parsed < dateFrom) {
      return false;
    }

    if (dateTo && parsed > dateTo) {
      return false;
    }

    return true;
  });
}

async function saveGoogleAdsKeywordHistory(result, maxEntries = 12, websiteId = null) {
  const state = await readState();
  const timestamp = nowIso();
  const keyword = String(result.keyword || '').trim();
  const country = String(result.country || 'US').trim().toUpperCase();
  const entryKey = `${keyword.toLowerCase()}::${country}::${websiteId ?? 'global'}`;
  const existing = state.googleAdsKeywordHistory.find((item) => item.entry_key === entryKey);

  if (existing) {
    existing.keyword = keyword;
    existing.country = country;
    existing.country_name = result.countryName || country;
    existing.total_ideas = result.totalIdeas || result.ideas?.length || 0;
    existing.result = result;
    existing.updated_at = timestamp;
  } else {
    state.googleAdsKeywordHistory.push({
      id: nextId(state.googleAdsKeywordHistory),
      website_id: websiteId != null ? Number(websiteId) : null,
      entry_key: entryKey,
      keyword,
      country,
      country_name: result.countryName || country,
      total_ideas: result.totalIdeas || result.ideas?.length || 0,
      result,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  state.googleAdsKeywordHistory = state.googleAdsKeywordHistory
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, maxEntries);

  await writeState(state);

  return state.googleAdsKeywordHistory.find((item) => item.entry_key === entryKey)?.id || null;
}

async function getGoogleAdsKeywordHistory(limit = 10, websiteId = null) {
  const state = await readState();

  return state.googleAdsKeywordHistory
    .filter((item) => (
      websiteId == null
        ? true
        : String(item.website_id ?? '') === String(websiteId)
    ))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, Math.max(1, Number(limit) || 10))
    .map((item) => ({
      id: item.id,
      keyword: item.keyword,
      country: item.country,
      country_name: item.country_name,
      total_ideas: item.total_ideas,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
}

async function getGoogleAdsKeywordHistoryItem(id, websiteId = null) {
  const state = await readState();
  const item = state.googleAdsKeywordHistory.find(
    (entry) =>
      String(entry.id) === String(id)
      && (websiteId == null || String(entry.website_id ?? '') === String(websiteId))
  );

  if (!item) {
    return null;
  }

  return {
    ...item.result,
    historyId: item.id,
    savedAt: item.updated_at,
  };
}

async function deleteGoogleAdsKeywordHistoryItem(id) {
  const state = await readState();
  const beforeCount = state.googleAdsKeywordHistory.length;
  state.googleAdsKeywordHistory = state.googleAdsKeywordHistory.filter((entry) => String(entry.id) !== String(id));

  if (state.googleAdsKeywordHistory.length !== beforeCount) {
    await writeState(state);
  }
}

async function saveContentAnalysisHistory(payload, maxEntries = 12, websiteId = null) {
  const state = await readState();
  const timestamp = nowIso();

  state.contentAnalysisHistory.push({
    id: nextId(state.contentAnalysisHistory),
    website_id: websiteId != null ? Number(websiteId) : null,
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

async function getContentAnalysisHistory(limit = 10, websiteId = null) {
  const state = await readState();

  return state.contentAnalysisHistory
    .filter((item) => (
      websiteId == null
        ? true
        : String(item.website_id ?? '') === String(websiteId)
    ))
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

async function getContentAnalysisHistoryItem(id, websiteId = null) {
  const state = await readState();
  const item = state.contentAnalysisHistory.find(
    (entry) =>
      String(entry.id) === String(id)
      && (websiteId == null || String(entry.website_id ?? '') === String(websiteId))
  );

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

async function saveSiteAuditHistory(payload, maxEntries = 12, websiteId = null) {
  const state = await readState();
  const timestamp = nowIso();

  state.siteAuditHistory.push({
    id: nextId(state.siteAuditHistory),
    website_id: websiteId != null ? Number(websiteId) : null,
    url: payload.url,
    total_pages: payload.result?.crawledPages ?? null,
    audit_score: payload.result?.auditScore ?? null,
    max_pages: payload.maxPages ?? payload.result?.maxPages ?? null,
    payload,
    created_at: timestamp,
    updated_at: timestamp,
  });

  state.siteAuditHistory = state.siteAuditHistory
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, maxEntries);

  await writeState(state);
  return state.siteAuditHistory[0]?.id || null;
}

async function getSiteAuditHistory(limit = 10, websiteId = null) {
  const state = await readState();

  return state.siteAuditHistory
    .filter((item) => (
      websiteId == null
        ? true
        : String(item.website_id ?? '') === String(websiteId)
    ))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, Math.max(1, Number(limit) || 10))
    .map((item) => ({
      id: item.id,
      url: item.url,
      total_pages: item.total_pages,
      audit_score: item.audit_score,
      max_pages: item.max_pages,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
}

async function getSiteAuditHistoryItem(id, websiteId = null) {
  const state = await readState();
  const item = state.siteAuditHistory.find(
    (entry) =>
      String(entry.id) === String(id)
      && (websiteId == null || String(entry.website_id ?? '') === String(websiteId))
  );

  if (!item) {
    return null;
  }

  return {
    ...item.payload.result,
    historyId: item.id,
    savedAt: item.updated_at,
  };
}

async function deleteSiteAuditHistoryItem(id) {
  const state = await readState();
  const beforeCount = state.siteAuditHistory.length;
  state.siteAuditHistory = state.siteAuditHistory.filter((entry) => String(entry.id) !== String(id));

  if (state.siteAuditHistory.length !== beforeCount) {
    await writeState(state);
  }
}

async function saveBacklinkSnapshot(payload = {}) {
  const state = await readState();
  const timestamp = nowIso();
  const snapshotDate = String(payload.snapshotDate || timestamp).slice(0, 10);
  const websiteId = payload.websiteId != null ? Number(payload.websiteId) : null;
  const summary = payload.summary || {};

  const row = {
    id: nextId(state.backlinkSnapshots || []),
    website_id: websiteId,
    snapshot_date: snapshotDate,
    backlinks_count: Number(summary.backlinksCount || 0),
    referring_domains_count: Number(summary.referringDomainsCount || 0),
    result: payload,
    created_at: timestamp,
    updated_at: timestamp,
  };

  state.backlinkSnapshots = Array.isArray(state.backlinkSnapshots) ? state.backlinkSnapshots : [];
  state.backlinkSnapshots.push(row);
  await writeState(state);
  return row.id;
}

async function getLatestBacklinkSnapshot(websiteId = null) {
  const state = await readState();
  const snapshots = (state.backlinkSnapshots || [])
    .filter((item) => (
      websiteId == null
        ? true
        : String(item.website_id ?? '') === String(websiteId)
    ))
    .sort((left, right) => {
      const leftDate = `${left.snapshot_date || ''}::${left.id || 0}`;
      const rightDate = `${right.snapshot_date || ''}::${right.id || 0}`;
      return rightDate.localeCompare(leftDate);
    });

  const item = snapshots[0];
  if (!item) {
    return null;
  }

  const payload = item.result || {};
  return {
    ...payload,
    snapshotId: item.id,
    snapshotDate: item.snapshot_date,
    summary: {
      ...(payload.summary || {}),
      backlinksCount: Number(item.backlinks_count || payload?.summary?.backlinksCount || 0),
      referringDomainsCount: Number(item.referring_domains_count || payload?.summary?.referringDomainsCount || 0),
    },
  };
}

async function getBacklinkHistory(websiteId = null, limit = 20) {
  const state = await readState();
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 120);

  return (state.backlinkSnapshots || [])
    .filter((item) => (
      websiteId == null
        ? true
        : String(item.website_id ?? '') === String(websiteId)
    ))
    .sort((left, right) => {
      const leftDate = `${left.snapshot_date || ''}::${left.id || 0}`;
      const rightDate = `${right.snapshot_date || ''}::${right.id || 0}`;
      return rightDate.localeCompare(leftDate);
    })
    .slice(0, safeLimit)
    .map((item) => ({
      id: item.id,
      website_id: item.website_id,
      snapshot_date: item.snapshot_date,
      backlinks_count: Number(item.backlinks_count || 0),
      referring_domains_count: Number(item.referring_domains_count || 0),
      created_at: item.created_at,
    }));
}

module.exports = {
  getCachedSERP,
  saveSerpCache,
  saveSerpResultsSnapshot,
  getSerpResultsByScope,
  getRankTrackerSettings,
  updateRankTrackerSettings,
  getSerpProviderSettings,
  getSerpProviderCredentials,
  getSerpProviderUsageMap,
  getBacklinkProviderSettings,
  getBacklinkProviderCredentials,
  updateSerpProviderSetting,
  updateSerpProviderCredentials,
  updateBacklinkProviderSetting,
  updateBacklinkProviderCredentials,
  consumeSerpProviderUsage,
  getGscProviderSettings,
  getGscProviderCredentials,
  updateGscProviderSetting,
  updateGscProviderCredentials,
  getAIProviderSettings,
  getAIProviderCredentials,
  updateAIProviderSetting,
  updateAIProviderCredentials,
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
  getKeywordLists,
  createKeywordList,
  addKeywordsToList,
  deleteKeywordList,
  deleteKeywordListItem,
  saveSerpAnalysisHistory,
  getSerpAnalysisHistory,
  getSerpAnalysisHistoryItem,
  deleteSerpAnalysisHistoryItem,
  saveAiSerpRun,
  getAiSerpRuns,
  getAiSerpRunById,
  getAiSerpMentions,
  saveGoogleAdsKeywordHistory,
  getGoogleAdsKeywordHistory,
  getGoogleAdsKeywordHistoryItem,
  deleteGoogleAdsKeywordHistoryItem,
  saveContentAnalysisHistory,
  getContentAnalysisHistory,
  getContentAnalysisHistoryItem,
  deleteContentAnalysisHistoryItem,
  saveSiteAuditHistory,
  getSiteAuditHistory,
  getSiteAuditHistoryItem,
  deleteSiteAuditHistoryItem,
  saveBacklinkSnapshot,
  getLatestBacklinkSnapshot,
  getBacklinkHistory,
};
