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

async function fetchGoogleAccessToken(credentials) {
  const tokenPayload = new URLSearchParams({
    client_id: credentials.GOOGLE_SEARCH_CONSOLE_CLIENT_ID,
    client_secret: credentials.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET,
    refresh_token: credentials.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN,
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

function getGoogleTokenErrorMessage(err) {
  const apiError = String(err?.response?.data?.error || '').trim();
  const apiDescription = String(err?.response?.data?.error_description || '').trim();
  const fallbackMessage = apiDescription || apiError || err?.message || 'Unknown Google token error';
  const normalized = `${apiError} ${apiDescription}`.toLowerCase();

  if (normalized.includes('invalid_rapt') || normalized.includes('reauth')) {
    return 'reauth required (invalid_rapt). Refresh token expired or requires re-consent. Generate a new refresh token with access_type=offline and prompt=consent, then save it in GSC Providers.';
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

async function toggleProvider(providerId, enabled) {
  const definition = GSC_PROVIDERS.find((provider) => provider.id === providerId);

  if (!definition) {
    throw createServiceError(`Unknown GSC provider: ${providerId}`, 404);
  }

  await updateSetting(providerId, enabled);
  return getProviderById(providerId);
}

async function saveProviderCredentials(providerId, credentials) {
  const definition = getProviderDefinition(providerId);

  if (!definition) {
    throw createServiceError(`Unknown GSC provider: ${providerId}`, 404);
  }

  await updateCredentials(providerId, credentials);
  return getProviderById(providerId);
}

async function testProviderConnection(providerId, options = {}) {
  const provider = getProviderDefinition(providerId);

  if (!provider) {
    throw createServiceError(`Unknown GSC provider: ${providerId}`, 404);
  }

  const credentialsMap = await getCredentialsMap();
  const credentials = getResolvedProviderCredentials(provider, credentialsMap);
  const missingFields = provider.fields
    .filter((field) => field.required !== false && !credentials[field.name])
    .map((field) => field.name);

  if (missingFields.length > 0) {
    throw createServiceError(`Missing required credentials: ${missingFields.join(', ')}`);
  }

  let accessToken;
  try {
    accessToken = await fetchGoogleAccessToken(credentials);
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

async function getOrganicTrafficSummary(options = {}) {
  const providerId = 'google-search-console';
  const providerStatus = await getProviderById(providerId);
  if (!providerStatus) {
    throw createServiceError('Google Search Console provider is not available.', 404);
  }

  if (!providerStatus.active) {
    throw createServiceError('Google Search Console provider is not active.', 412);
  }

  const provider = getProviderDefinition(providerId);
  const credentialsMap = await getCredentialsMap();
  const credentials = getResolvedProviderCredentials(provider, credentialsMap);
  const missingFields = provider.fields
    .filter((field) => field.required !== false && !credentials[field.name])
    .map((field) => field.name);

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

  const defaultRange = getDefaultDateRange();
  const startDate = toIsoDate(options.dateFrom) || defaultRange.startDate;
  const endDate = toIsoDate(options.dateTo) || defaultRange.endDate;

  if (!startDate || !endDate) {
    throw createServiceError('Invalid date range for GSC traffic query.');
  }

  if (new Date(startDate) > new Date(endDate)) {
    throw createServiceError('Invalid date range: start date is after end date.');
  }

  let accessToken;
  try {
    accessToken = await fetchGoogleAccessToken(credentials);
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

module.exports = {
  getStatus,
  getProviderById,
  toggleProvider,
  saveProviderCredentials,
  testProviderConnection,
  getOrganicTrafficSummary,
};
