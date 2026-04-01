const db = require('../database');
const localStore = require('../utils/localStore');
const axios = require('axios');

const GSC_PROVIDERS = [
  {
    id: 'google-search-console',
    name: 'Google Search Console',
    description: 'Connect Search Console to use verified Google query and page performance data.',
    docsUrl: 'https://developers.google.com/webmaster-tools/v1/quickstart/quickstart-js',
    fields: [
      {
        name: 'GOOGLE_SEARCH_CONSOLE_CLIENT_ID',
        label: 'OAuth Client ID',
        envKey: 'GOOGLE_SEARCH_CONSOLE_CLIENT_ID',
        required: true,
      },
      {
        name: 'GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET',
        label: 'OAuth Client Secret',
        envKey: 'GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET',
        required: true,
      },
      {
        name: 'GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN',
        label: 'OAuth Refresh Token',
        envKey: 'GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN',
        required: true,
      },
      {
        name: 'GOOGLE_SEARCH_CONSOLE_SITE_URL',
        label: 'Default Site URL (optional fallback)',
        envKey: 'GOOGLE_SEARCH_CONSOLE_SITE_URL',
        required: false,
      },
    ],
    quota: 'Google API quotas apply',
    quotaType: 'Per-minute + per-day',
    setupTime: '~5 min',
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics (GA4)',
    description: 'Connect GA4 Data API to use users, sessions, engagement, and conversion metrics.',
    docsUrl: 'https://developers.google.com/analytics/devguides/reporting/data/v1',
    fields: [
      {
        name: 'GOOGLE_ANALYTICS_CLIENT_ID',
        label: 'OAuth Client ID',
        envKey: 'GOOGLE_ANALYTICS_CLIENT_ID',
        fallbackEnvKeys: ['GOOGLE_SEARCH_CONSOLE_CLIENT_ID'],
        fallbackFromProviders: [
          { providerId: 'google-search-console', credentialKey: 'GOOGLE_SEARCH_CONSOLE_CLIENT_ID' },
        ],
        required: true,
      },
      {
        name: 'GOOGLE_ANALYTICS_CLIENT_SECRET',
        label: 'OAuth Client Secret',
        envKey: 'GOOGLE_ANALYTICS_CLIENT_SECRET',
        fallbackEnvKeys: ['GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET'],
        fallbackFromProviders: [
          { providerId: 'google-search-console', credentialKey: 'GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET' },
        ],
        required: true,
      },
      {
        name: 'GOOGLE_ANALYTICS_REFRESH_TOKEN',
        label: 'OAuth Refresh Token',
        envKey: 'GOOGLE_ANALYTICS_REFRESH_TOKEN',
        fallbackEnvKeys: ['GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN'],
        fallbackFromProviders: [
          { providerId: 'google-search-console', credentialKey: 'GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN' },
        ],
        required: true,
      },
      {
        name: 'GOOGLE_ANALYTICS_PROPERTY_ID',
        label: 'GA4 Property ID (numbers only)',
        envKey: 'GOOGLE_ANALYTICS_PROPERTY_ID',
        required: true,
      },
    ],
    quota: 'Google API quotas apply',
    quotaType: 'Per-minute + per-day',
    setupTime: '~5 min',
  },
];

function shouldUseLocalFallback(err) {
  if (!err) {
    return false;
  }

  const fallbackCodes = new Set([
    'ER_ACCESS_DENIED_ERROR',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT',
    'PROTOCOL_CONNECTION_LOST',
  ]);

  if (fallbackCodes.has(err.code)) {
    return true;
  }

  const message = String(err.message || '').toLowerCase();
  return (
    message.includes('access denied')
    || message.includes('connection')
    || message.includes('connect')
    || message.includes('timeout')
    || message.includes('not available')
  );
}

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function getCredentialsMap() {
  try {
    const rows = await db.query(
      `SELECT provider_id, credential_key, credential_value, updated_at
       FROM gsc_provider_credentials`
    );

    return rows.reduce((accumulator, row) => {
      if (!accumulator[row.provider_id]) {
        accumulator[row.provider_id] = {};
      }

      accumulator[row.provider_id][row.credential_key] = {
        value: row.credential_value,
        updated_at: row.updated_at || null,
      };

      return accumulator;
    }, {});
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[GSCProviderManager] DB unavailable for credentials, using local store:', err.message);
    return localStore.getGscProviderCredentials();
  }
}

async function updateCredentials(providerId, credentials = {}) {
  if (!providerId || !String(providerId).trim()) {
    throw createServiceError('Provider id is required.');
  }

  const entries = Object.entries(credentials).filter(([, value]) => String(value || '').trim());

  if (entries.length === 0) {
    throw createServiceError('At least one credential value is required.');
  }

  try {
    for (const [credentialKey, credentialValue] of entries) {
      await db.query(
        `INSERT INTO gsc_provider_credentials (provider_id, credential_key, credential_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE credential_value = VALUES(credential_value)`,
        [providerId, credentialKey, String(credentialValue).trim()]
      );
    }
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[GSCProviderManager] DB unavailable for updateCredentials, using local store:', err.message);
    await localStore.updateGscProviderCredentials(providerId, credentials);
  }

  const credentialsMap = await getCredentialsMap();
  return credentialsMap[providerId] || {};
}

async function getSettingsMap() {
  try {
    const rows = await db.query(
      `SELECT provider_id, is_enabled, updated_at
       FROM gsc_provider_settings`
    );

    return rows.reduce((accumulator, row) => {
      accumulator[row.provider_id] = {
        is_enabled: Boolean(row.is_enabled),
        updated_at: row.updated_at || null,
      };
      return accumulator;
    }, {});
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[GSCProviderManager] DB unavailable for settings, using local store:', err.message);
    return localStore.getGscProviderSettings();
  }
}

async function updateSetting(providerId, isEnabled) {
  if (!providerId || !String(providerId).trim()) {
    throw createServiceError('Provider id is required.');
  }

  try {
    await db.query(
      `INSERT INTO gsc_provider_settings (provider_id, is_enabled)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled)`,
      [providerId, isEnabled ? 1 : 0]
    );
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[GSCProviderManager] DB unavailable for updateSetting, using local store:', err.message);
    await localStore.updateGscProviderSetting(providerId, isEnabled);
  }
}

function resolveCredentialValue(provider, fieldName, credentialsMap) {
  const saved = credentialsMap[provider.id]?.[fieldName];
  if (saved?.value) {
    return { value: saved.value, source: 'saved' };
  }

  const field = provider.fields.find((entry) => entry.name === fieldName);
  const envValue = field?.envKey ? process.env[field.envKey] : undefined;
  if (envValue && envValue.trim() && !envValue.startsWith('your_')) {
    return { value: envValue.trim(), source: 'env' };
  }

  const fallbackFromProviders = Array.isArray(field?.fallbackFromProviders)
    ? field.fallbackFromProviders
    : [];
  for (const fallbackEntry of fallbackFromProviders) {
    const fallbackProviderId = String(fallbackEntry?.providerId || '').trim();
    const fallbackCredentialKey = String(fallbackEntry?.credentialKey || '').trim();
    if (!fallbackProviderId || !fallbackCredentialKey) {
      continue;
    }

    const fallbackSaved = credentialsMap[fallbackProviderId]?.[fallbackCredentialKey];
    if (fallbackSaved?.value) {
      return { value: fallbackSaved.value, source: 'saved-fallback' };
    }
  }

  const fallbackEnvKeys = Array.isArray(field?.fallbackEnvKeys) ? field.fallbackEnvKeys : [];
  for (const fallbackEnvKey of fallbackEnvKeys) {
    const fallbackEnvValue = String(process.env[fallbackEnvKey] || '').trim();
    if (fallbackEnvValue && !fallbackEnvValue.startsWith('your_')) {
      return { value: fallbackEnvValue, source: 'env-fallback' };
    }
  }

  return { value: null, source: null };
}

async function getProviderDetails() {
  const credentialsMap = await getCredentialsMap();
  const settingsMap = await getSettingsMap();

  return GSC_PROVIDERS.map((provider) => {
    const fields = provider.fields.map((field) => {
      const resolved = resolveCredentialValue(provider, field.name, credentialsMap);
      return {
        name: field.name,
        label: field.label,
        required: field.required !== false,
        hasValue: Boolean(resolved.value),
        source: resolved.source,
      };
    });

    const configured = fields.every((field) => !field.required || field.hasValue);
    const setting = settingsMap[provider.id];
    const enabled = setting ? setting.is_enabled : true;
    const active = configured && enabled;

    return {
      id: provider.id,
      name: provider.name,
      description: provider.description,
      docsUrl: provider.docsUrl,
      fields,
      configured,
      enabled,
      active,
      quota: provider.quota,
      quotaType: provider.quotaType,
      setupTime: provider.setupTime,
    };
  });
}

async function getStatus() {
  const details = await getProviderDetails();
  return {
    available: details.map((provider) => provider.name),
    configured: details.filter((provider) => provider.configured).map((provider) => provider.name),
    active: details.filter((provider) => provider.active).map((provider) => provider.name),
    details,
  };
}

async function getProviderById(providerId) {
  const details = await getProviderDetails();
  return details.find((provider) => provider.id === providerId) || null;
}

function getProviderDefinition(providerId) {
  return GSC_PROVIDERS.find((provider) => provider.id === providerId) || null;
}

function toIsoDate(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return {
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
  };
}

function normalizeSiteValue(value) {
  const input = String(value || '').trim();
  if (!input) {
    return '';
  }

  if (input.toLowerCase().startsWith('sc-domain:')) {
    return input.toLowerCase();
  }

  return input
    .toLowerCase()
    .replace(/\/+$/, '/');
}

function getResolvedProviderCredentials(provider, credentialsMap) {
  return provider.fields.reduce((accumulator, field) => {
    const resolved = resolveCredentialValue(provider, field.name, credentialsMap);
    accumulator[field.name] = resolved.value ? String(resolved.value).trim() : '';
    return accumulator;
  }, {});
}

async function fetchGoogleAccessTokenFromOAuth({ clientId, clientSecret, refreshToken }) {
  const normalizedClientId = String(clientId || '').trim();
  const normalizedClientSecret = String(clientSecret || '').trim();
  const normalizedRefreshToken = String(refreshToken || '').trim();

  if (!normalizedClientId || !normalizedClientSecret || !normalizedRefreshToken) {
    throw createServiceError('Google OAuth credentials are incomplete.');
  }

  const tokenPayload = new URLSearchParams({
    client_id: normalizedClientId,
    client_secret: normalizedClientSecret,
    refresh_token: normalizedRefreshToken,
    grant_type: 'refresh_token',
  });

  const tokenResponse = await axios.post(
    'https://oauth2.googleapis.com/token',
    tokenPayload.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 20000,
    }
  );

  return String(tokenResponse?.data?.access_token || '').trim();
}

async function fetchGoogleAccessToken(credentials) {
  return fetchGoogleAccessTokenFromOAuth({
    clientId: credentials.GOOGLE_SEARCH_CONSOLE_CLIENT_ID,
    clientSecret: credentials.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET,
    refreshToken: credentials.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN,
  });
}

function getGoogleTokenErrorMessage(err) {
  const apiError = String(err?.response?.data?.error || '').trim();
  const apiDescription = String(err?.response?.data?.error_description || '').trim();
  const fallbackMessage = apiDescription || apiError || err?.message || 'Unknown Google token error';
  const normalized = `${apiError} ${apiDescription}`.toLowerCase();

  if (normalized.includes('invalid_rapt') || normalized.includes('reauth')) {
    return 'reauth required (invalid_rapt). Refresh token expired or requires re-consent. Generate a new refresh token with access_type=offline and prompt=consent, then save it in Google Tools.';
  }

  if (normalized.includes('invalid_grant')) {
    return 'invalid_grant. Refresh token is invalid/revoked. Generate and save a new refresh token.';
  }

  return fallbackMessage;
}

async function runSearchAnalyticsQuery(accessToken, siteUrl, requestBody) {
  const response = await axios.post(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    requestBody,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 25000,
    }
  );

  return response?.data || {};
}

function normalizeSearchAnalyticsRows(responseData, dimensions = []) {
  const rows = Array.isArray(responseData?.rows) ? responseData.rows : [];
  return rows.map((row) => {
    const mapped = {
      clicks: Number(row?.clicks || 0) || 0,
      impressions: Number(row?.impressions || 0) || 0,
      ctr: Number(row?.ctr || 0) || 0,
      position: Number(row?.position || 0) || 0,
    };

    const keys = Array.isArray(row?.keys) ? row.keys : [];
    dimensions.forEach((dimension, index) => {
      mapped[dimension] = String(keys[index] || '').trim();
    });

    return mapped;
  });
}

function normalizeGaPropertyId(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '';
  }

  const normalized = rawValue.replace(/^properties\//i, '').trim();
  if (!/^\d+$/.test(normalized)) {
    throw createServiceError('Google Analytics property ID must be numeric (for example: 123456789).');
  }

  return normalized;
}

async function runGa4Report(accessToken, propertyId, requestBody) {
  const normalizedPropertyId = normalizeGaPropertyId(propertyId);
  const response = await axios.post(
    `https://analyticsdata.googleapis.com/v1beta/properties/${normalizedPropertyId}:runReport`,
    requestBody,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 25000,
    }
  );

  return response?.data || {};
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseGaMetricRows(responseData, dimensions = [], metrics = []) {
  const rows = Array.isArray(responseData?.rows) ? responseData.rows : [];
  return rows.map((row) => {
    const entry = {};
    const dimensionValues = Array.isArray(row?.dimensionValues) ? row.dimensionValues : [];
    const metricValues = Array.isArray(row?.metricValues) ? row.metricValues : [];

    dimensions.forEach((dimensionName, index) => {
      entry[dimensionName] = String(dimensionValues[index]?.value || '').trim();
    });

    metrics.forEach((metricName, index) => {
      entry[metricName] = toNumber(metricValues[index]?.value, 0);
    });

    return entry;
  });
}

async function toggleProvider(providerId, enabled) {
  const definition = GSC_PROVIDERS.find((provider) => provider.id === providerId);

  if (!definition) {
    throw createServiceError(`Unknown Google Tools provider: ${providerId}`, 404);
  }

  await updateSetting(providerId, enabled);
  return getProviderById(providerId);
}

async function saveProviderCredentials(providerId, credentials) {
  const definition = getProviderDefinition(providerId);

  if (!definition) {
    throw createServiceError(`Unknown Google Tools provider: ${providerId}`, 404);
  }

  await updateCredentials(providerId, credentials);
  return getProviderById(providerId);
}

function getMissingRequiredFields(provider, credentials) {
  return provider.fields
    .filter((field) => field.required !== false && !credentials[field.name])
    .map((field) => field.name);
}

async function getGoogleAccessTokenForProvider(provider, credentials) {
  if (provider.id === 'google-analytics') {
    return fetchGoogleAccessTokenFromOAuth({
      clientId: credentials.GOOGLE_ANALYTICS_CLIENT_ID,
      clientSecret: credentials.GOOGLE_ANALYTICS_CLIENT_SECRET,
      refreshToken: credentials.GOOGLE_ANALYTICS_REFRESH_TOKEN,
    });
  }

  return fetchGoogleAccessToken(credentials);
}

async function testSearchConsoleConnection(provider, credentials, options = {}) {
  let accessToken;
  try {
    accessToken = await getGoogleAccessTokenForProvider(provider, credentials);
  } catch (err) {
    const apiMessage = getGoogleTokenErrorMessage(err);
    throw createServiceError(`Google token request failed: ${apiMessage}`, 502);
  }

  if (!accessToken) {
    throw createServiceError('Google token request failed: no access token received.', 502);
  }

  let siteEntries = [];
  try {
    const sitesResponse = await axios.get('https://www.googleapis.com/webmasters/v3/sites', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 20000,
    });

    siteEntries = Array.isArray(sitesResponse?.data?.siteEntry) ? sitesResponse.data.siteEntry : [];
  } catch (err) {
    const apiMessage = err.response?.data?.error?.message || err.response?.data?.error || err.message;
    throw createServiceError(`Search Console API request failed: ${apiMessage}`, 502);
  }

  const configuredSiteUrl = String(options.siteUrl || credentials.GOOGLE_SEARCH_CONSOLE_SITE_URL || '').trim();
  const normalizedConfiguredSite = normalizeSiteValue(configuredSiteUrl);
  const matchedSite = normalizedConfiguredSite
    ? siteEntries.find((entry) => normalizeSiteValue(entry?.siteUrl) === normalizedConfiguredSite)
    : null;

  return {
    providerId: provider.id,
    connected: true,
    siteMatched: normalizedConfiguredSite ? Boolean(matchedSite) : null,
    configuredSiteUrl,
    matchedSiteUrl: matchedSite?.siteUrl || null,
    totalAccessibleProperties: siteEntries.length,
    sampleProperties: siteEntries
      .map((entry) => String(entry?.siteUrl || '').trim())
      .filter(Boolean)
      .slice(0, 10),
    message: !normalizedConfiguredSite
      ? 'Connection successful. No site URL provided, so only account access was verified.'
      : matchedSite
        ? 'Connection successful and configured site is accessible.'
        : 'Connected to Search Console, but configured site URL is not in accessible properties.',
  };
}

async function testGoogleAnalyticsConnection(provider, credentials, options = {}) {
  let accessToken;
  try {
    accessToken = await getGoogleAccessTokenForProvider(provider, credentials);
  } catch (err) {
    const apiMessage = getGoogleTokenErrorMessage(err);
    throw createServiceError(`Google token request failed: ${apiMessage}`, 502);
  }

  if (!accessToken) {
    throw createServiceError('Google token request failed: no access token received.', 502);
  }

  const rawPropertyId = String(options.propertyId || credentials.GOOGLE_ANALYTICS_PROPERTY_ID || '').trim();
  const propertyId = normalizeGaPropertyId(rawPropertyId);
  if (!propertyId) {
    throw createServiceError('No Google Analytics property ID configured.');
  }

  let responseData;
  try {
    responseData = await runGa4Report(accessToken, propertyId, {
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      metrics: [{ name: 'totalUsers' }, { name: 'sessions' }],
      limit: 1,
    });
  } catch (err) {
    const apiMessage = err.response?.data?.error?.message || err.response?.data?.error || err.message;
    throw createServiceError(`Google Analytics API request failed: ${apiMessage}`, 502);
  }

  const sample = parseGaMetricRows(responseData, [], ['totalUsers', 'sessions'])[0] || null;
  return {
    providerId: provider.id,
    connected: true,
    propertyId,
    sampleUsers: sample?.totalUsers || 0,
    sampleSessions: sample?.sessions || 0,
    message: 'Connection successful and GA4 property is accessible.',
  };
}

async function testProviderConnection(providerId, options = {}) {
  const provider = getProviderDefinition(providerId);

  if (!provider) {
    throw createServiceError(`Unknown Google Tools provider: ${providerId}`, 404);
  }

  const credentialsMap = await getCredentialsMap();
  const credentials = getResolvedProviderCredentials(provider, credentialsMap);
  const missingFields = getMissingRequiredFields(provider, credentials);

  if (missingFields.length > 0) {
    throw createServiceError(`Missing required credentials: ${missingFields.join(', ')}`);
  }

  if (provider.id === 'google-analytics') {
    return testGoogleAnalyticsConnection(provider, credentials, options);
  }

  return testSearchConsoleConnection(provider, credentials, options);
}

function getNormalizedDateRange(options = {}) {
  const defaultRange = getDefaultDateRange();
  const startDate = toIsoDate(options.dateFrom) || defaultRange.startDate;
  const endDate = toIsoDate(options.dateTo) || defaultRange.endDate;

  if (!startDate || !endDate) {
    throw createServiceError('Invalid date range for Google traffic query.');
  }

  if (new Date(startDate) > new Date(endDate)) {
    throw createServiceError('Invalid date range: start date is after end date.');
  }

  return { startDate, endDate };
}

async function getSearchConsoleTrafficSummary(options = {}) {
  const providerId = 'google-search-console';
  const providerStatus = await getProviderById(providerId);
  if (!providerStatus || !providerStatus.active) {
    throw createServiceError('Google Search Console provider is not active.', 412);
  }

  const provider = getProviderDefinition(providerId);
  const credentialsMap = await getCredentialsMap();
  const credentials = getResolvedProviderCredentials(provider, credentialsMap);
  const missingFields = getMissingRequiredFields(provider, credentials);
  if (missingFields.length > 0) {
    throw createServiceError(`Missing required credentials: ${missingFields.join(', ')}`);
  }

  const configuredSiteUrl = String(options.siteUrl || credentials.GOOGLE_SEARCH_CONSOLE_SITE_URL || '').trim();
  if (!configuredSiteUrl) {
    throw createServiceError('No GSC site URL configured for this website.');
  }

  const normalizedSiteUrl = /^sc-domain:/i.test(configuredSiteUrl)
    ? configuredSiteUrl.replace(/^sc-domain:/i, 'sc-domain:')
    : configuredSiteUrl.replace(/\/+$/, '/');

  const { startDate, endDate } = getNormalizedDateRange(options);

  let accessToken;
  try {
    accessToken = await getGoogleAccessTokenForProvider(provider, credentials);
  } catch (err) {
    const apiMessage = getGoogleTokenErrorMessage(err);
    throw createServiceError(`Google token request failed: ${apiMessage}`, 502);
  }

  if (!accessToken) {
    throw createServiceError('Google token request failed: no access token received.', 502);
  }

  let response;
  try {
    response = await runSearchAnalyticsQuery(accessToken, normalizedSiteUrl, {
      startDate,
      endDate,
      rowLimit: 1,
      startRow: 0,
    });
  } catch (err) {
    const apiMessage = err.response?.data?.error?.message || err.response?.data?.error || err.message;
    throw createServiceError(`Search Console traffic query failed: ${apiMessage}`, 502);
  }

  let topQueries = [];
  let topPages = [];
  let deviceBreakdown = [];
  let countryBreakdown = [];

  try {
    const [queryData, pageData, deviceData, countryData] = await Promise.all([
      runSearchAnalyticsQuery(accessToken, normalizedSiteUrl, {
        startDate,
        endDate,
        dimensions: ['query'],
        rowLimit: 10,
        startRow: 0,
      }),
      runSearchAnalyticsQuery(accessToken, normalizedSiteUrl, {
        startDate,
        endDate,
        dimensions: ['page'],
        rowLimit: 10,
        startRow: 0,
      }),
      runSearchAnalyticsQuery(accessToken, normalizedSiteUrl, {
        startDate,
        endDate,
        dimensions: ['device'],
        rowLimit: 10,
        startRow: 0,
      }),
      runSearchAnalyticsQuery(accessToken, normalizedSiteUrl, {
        startDate,
        endDate,
        dimensions: ['country'],
        rowLimit: 10,
        startRow: 0,
      }),
    ]);

    topQueries = normalizeSearchAnalyticsRows(queryData, ['query']);
    topPages = normalizeSearchAnalyticsRows(pageData, ['page']);
    deviceBreakdown = normalizeSearchAnalyticsRows(deviceData, ['device']);
    countryBreakdown = normalizeSearchAnalyticsRows(countryData, ['country']);
  } catch (err) {
    console.warn('[GSCProviderManager] Extended Search Analytics breakdown failed:', err.message);
  }

  const row = Array.isArray(response?.rows) ? response.rows[0] : null;
  const clicks = Number(row?.clicks || 0);
  const impressions = Number(row?.impressions || 0);
  const ctr = Number(row?.ctr || 0);
  const avgPosition = Number(row?.position || 0);

  const topQuery = topQueries[0] || null;
  const topPage = topPages[0] || null;

  return {
    available: true,
    source: 'gsc',
    providerId,
    siteUrl: normalizedSiteUrl,
    dateFrom: startDate,
    dateTo: endDate,
    summary: {
      clicks: Number.isFinite(clicks) ? clicks : 0,
      impressions: Number.isFinite(impressions) ? impressions : 0,
      ctr: Number.isFinite(ctr) ? ctr : 0,
      averagePosition: Number.isFinite(avgPosition) ? avgPosition : 0,
    },
    topQueries,
    topPages,
    deviceBreakdown,
    countryBreakdown,
    highlights: {
      topQuery: topQuery ? {
        query: topQuery.query || '',
        clicks: topQuery.clicks,
        impressions: topQuery.impressions,
        ctr: topQuery.ctr,
        position: topQuery.position,
      } : null,
      topPage: topPage ? {
        page: topPage.page || '',
        clicks: topPage.clicks,
        impressions: topPage.impressions,
        ctr: topPage.ctr,
        position: topPage.position,
      } : null,
      topDevice: deviceBreakdown[0] || null,
      topCountry: countryBreakdown[0] || null,
    },
  };
}

async function getGoogleAnalyticsTrafficSummary(options = {}) {
  const providerId = 'google-analytics';
  const providerStatus = await getProviderById(providerId);
  if (!providerStatus || !providerStatus.active) {
    throw createServiceError('Google Analytics provider is not active.', 412);
  }

  const provider = getProviderDefinition(providerId);
  const credentialsMap = await getCredentialsMap();
  const credentials = getResolvedProviderCredentials(provider, credentialsMap);
  const missingFields = getMissingRequiredFields(provider, credentials);
  if (missingFields.length > 0) {
    throw createServiceError(`Missing required credentials: ${missingFields.join(', ')}`);
  }

  const rawPropertyId = String(options.gaPropertyId || credentials.GOOGLE_ANALYTICS_PROPERTY_ID || '').trim();
  const propertyId = normalizeGaPropertyId(rawPropertyId);
  if (!propertyId) {
    throw createServiceError('No Google Analytics property ID configured for this website.');
  }

  const { startDate, endDate } = getNormalizedDateRange(options);

  let accessToken;
  try {
    accessToken = await getGoogleAccessTokenForProvider(provider, credentials);
  } catch (err) {
    const apiMessage = getGoogleTokenErrorMessage(err);
    throw createServiceError(`Google token request failed: ${apiMessage}`, 502);
  }

  if (!accessToken) {
    throw createServiceError('Google token request failed: no access token received.', 502);
  }

  const metricNames = [
    'totalUsers',
    'sessions',
    'engagedSessions',
    'engagementRate',
    'averageSessionDuration',
    'conversions',
    'screenPageViews',
    'bounceRate',
  ];

  let summaryData;
  try {
    summaryData = await runGa4Report(accessToken, propertyId, {
      dateRanges: [{ startDate, endDate }],
      metrics: metricNames.map((name) => ({ name })),
      limit: 1,
    });
  } catch (err) {
    const apiMessage = err.response?.data?.error?.message || err.response?.data?.error || err.message;
    throw createServiceError(`Google Analytics traffic query failed: ${apiMessage}`, 502);
  }

  let topPages = [];
  let deviceBreakdown = [];
  let countryBreakdown = [];
  try {
    const [pagesData, devicesData, countriesData] = await Promise.all([
      runGa4Report(accessToken, propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'conversions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      }),
      runGa4Report(accessToken, propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      }),
      runGa4Report(accessToken, propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      }),
    ]);

    topPages = parseGaMetricRows(
      pagesData,
      ['landingPagePlusQueryString'],
      ['sessions', 'totalUsers', 'conversions']
    ).map((row) => ({
      page: row.landingPagePlusQueryString,
      sessions: row.sessions,
      users: row.totalUsers,
      conversions: row.conversions,
    }));

    deviceBreakdown = parseGaMetricRows(devicesData, ['deviceCategory'], ['sessions']).map((row) => ({
      device: row.deviceCategory,
      sessions: row.sessions,
    }));

    countryBreakdown = parseGaMetricRows(countriesData, ['country'], ['sessions', 'totalUsers']).map((row) => ({
      country: row.country,
      sessions: row.sessions,
      users: row.totalUsers,
    }));
  } catch (err) {
    console.warn('[GSCProviderManager] Extended GA4 breakdown failed:', err.message);
  }

  const summaryRow = parseGaMetricRows(summaryData, [], metricNames)[0] || {};
  const topPage = topPages[0] || null;

  return {
    available: true,
    source: 'ga4',
    providerId,
    propertyId,
    dateFrom: startDate,
    dateTo: endDate,
    summary: {
      users: summaryRow.totalUsers || 0,
      sessions: summaryRow.sessions || 0,
      engagedSessions: summaryRow.engagedSessions || 0,
      engagementRate: summaryRow.engagementRate || 0,
      averageSessionDuration: summaryRow.averageSessionDuration || 0,
      conversions: summaryRow.conversions || 0,
      screenPageViews: summaryRow.screenPageViews || 0,
      bounceRate: summaryRow.bounceRate || 0,
    },
    topPages,
    deviceBreakdown,
    countryBreakdown,
    highlights: {
      topPage,
      topDevice: deviceBreakdown[0] || null,
      topCountry: countryBreakdown[0] || null,
    },
  };
}

async function getOrganicTrafficSummary(options = {}) {
  const warnings = [];
  const { startDate, endDate } = getNormalizedDateRange(options);
  let gscData = null;
  let ga4Data = null;

  try {
    gscData = await getSearchConsoleTrafficSummary({
      ...options,
      dateFrom: startDate,
      dateTo: endDate,
    });
  } catch (err) {
    warnings.push(`GSC unavailable: ${err.message}`);
  }

  try {
    ga4Data = await getGoogleAnalyticsTrafficSummary({
      ...options,
      dateFrom: startDate,
      dateTo: endDate,
    });
  } catch (err) {
    warnings.push(`GA4 unavailable: ${err.message}`);
  }

  if (!gscData && !ga4Data) {
    throw createServiceError('Google traffic providers are not available. Configure Google Tools and website mapping.', 412);
  }

  const sources = [];
  if (gscData) {
    sources.push('gsc');
  }
  if (ga4Data) {
    sources.push('ga4');
  }

  return {
    available: true,
    source: sources.join('+'),
    sources,
    providerId: sources[0] || null,
    siteUrl: gscData?.siteUrl || null,
    gaPropertyId: ga4Data?.propertyId || null,
    dateFrom: startDate,
    dateTo: endDate,
    summary: {
      clicks: gscData?.summary?.clicks || 0,
      impressions: gscData?.summary?.impressions || 0,
      ctr: gscData?.summary?.ctr || 0,
      averagePosition: gscData?.summary?.averagePosition || 0,
      users: ga4Data?.summary?.users || 0,
      sessions: ga4Data?.summary?.sessions || 0,
      engagedSessions: ga4Data?.summary?.engagedSessions || 0,
      engagementRate: ga4Data?.summary?.engagementRate || 0,
      averageSessionDuration: ga4Data?.summary?.averageSessionDuration || 0,
      conversions: ga4Data?.summary?.conversions || 0,
      screenPageViews: ga4Data?.summary?.screenPageViews || 0,
      bounceRate: ga4Data?.summary?.bounceRate || 0,
    },
    topQueries: gscData?.topQueries || [],
    topPages: gscData?.topPages || [],
    deviceBreakdown: gscData?.deviceBreakdown || [],
    countryBreakdown: gscData?.countryBreakdown || [],
    highlights: {
      topQuery: gscData?.highlights?.topQuery || null,
      topPage: gscData?.highlights?.topPage || null,
      topDevice: gscData?.highlights?.topDevice || null,
      topCountry: gscData?.highlights?.topCountry || null,
      gaTopPage: ga4Data?.highlights?.topPage || null,
      gaTopDevice: ga4Data?.highlights?.topDevice || null,
      gaTopCountry: ga4Data?.highlights?.topCountry || null,
    },
    ga4: ga4Data,
    gsc: gscData,
    warnings,
  };
}

module.exports = {
  getStatus,
  getProviderById,
  toggleProvider,
  saveProviderCredentials,
  testProviderConnection,
  getOrganicTrafficSummary,
};
