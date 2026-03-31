const db = require('../database');
const localStore = require('../utils/localStore');

const BACKLINK_PROVIDERS = [
  {
    id: 'dataforseo',
    name: 'DataForSEO Backlinks',
    description: 'Use DataForSEO Backlinks API to fetch backlink and referring domain metrics.',
    docsUrl: 'https://docs.dataforseo.com/v3/backlinks-summary-live/',
    fields: [
      { name: 'DATAFORSEO_LOGIN', label: 'API Login', envKey: 'DATAFORSEO_LOGIN' },
      { name: 'DATAFORSEO_PASSWORD', label: 'API Password', envKey: 'DATAFORSEO_PASSWORD' },
    ],
    quota: 'Pay-as-you-go',
    quotaType: 'Per request',
    setupTime: '~3 min',
  },
];

function shouldUseLocalFallback(err) {
  if (!err) return false;

  const fallbackCodes = new Set([
    'ER_ACCESS_DENIED_ERROR',
    'ER_NO_SUCH_TABLE',
    'ER_BAD_FIELD_ERROR',
    'ER_DUP_FIELDNAME',
    'ER_PARSE_ERROR',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT',
    'PROTOCOL_CONNECTION_LOST',
  ]);

  if (fallbackCodes.has(err.code)) return true;

  const message = String(err.message || '').toLowerCase();
  return (
    message.includes('access denied') ||
    message.includes('connection') ||
    message.includes('connect') ||
    message.includes('timeout') ||
    message.includes('not available') ||
    message.includes("doesn't exist") ||
    message.includes('does not exist') ||
    message.includes('unknown column') ||
    message.includes('no such table')
  );
}

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function hasConfiguredValue(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  return !normalized.toLowerCase().startsWith('your_');
}

async function getCredentialsMap() {
  try {
    const rows = await db.query(
      `SELECT provider_id, credential_key, credential_value, updated_at
       FROM backlink_provider_credentials`
    );

    return rows.reduce((acc, row) => {
      if (!acc[row.provider_id]) acc[row.provider_id] = {};
      acc[row.provider_id][row.credential_key] = {
        value: row.credential_value,
        updated_at: row.updated_at || null,
      };
      return acc;
    }, {});
  } catch (err) {
    if (!shouldUseLocalFallback(err)) throw err;
    console.warn('[BacklinkProviderManager] DB unavailable for credentials, using local store:', err.message);
    return localStore.getBacklinkProviderCredentials();
  }
}

async function updateCredentials(providerId, credentials = {}) {
  if (!providerId || !String(providerId).trim()) {
    throw createServiceError('Provider id is required.');
  }

  const entries = Object.entries(credentials).filter(([, value]) => hasConfiguredValue(value));
  if (entries.length === 0) {
    throw createServiceError('At least one credential value is required.');
  }

  try {
    for (const [credentialKey, credentialValue] of entries) {
      await db.query(
        `INSERT INTO backlink_provider_credentials (provider_id, credential_key, credential_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE credential_value = VALUES(credential_value)`,
        [providerId, credentialKey, String(credentialValue).trim()]
      );
    }
  } catch (err) {
    if (!shouldUseLocalFallback(err)) throw err;
    console.warn('[BacklinkProviderManager] DB unavailable for updateCredentials, using local store:', err.message);
    await localStore.updateBacklinkProviderCredentials(providerId, credentials);
  }
}

async function getSettingsMap() {
  try {
    const rows = await db.query(
      `SELECT provider_id, is_enabled, updated_at
       FROM backlink_provider_settings`
    );

    return rows.reduce((acc, row) => {
      acc[row.provider_id] = {
        is_enabled: Boolean(row.is_enabled),
        updated_at: row.updated_at || null,
      };
      return acc;
    }, {});
  } catch (err) {
    if (!shouldUseLocalFallback(err)) throw err;
    console.warn('[BacklinkProviderManager] DB unavailable for settings, using local store:', err.message);
    return localStore.getBacklinkProviderSettings();
  }
}

async function updateSetting(providerId, isEnabled) {
  if (!providerId || !String(providerId).trim()) {
    throw createServiceError('Provider id is required.');
  }

  try {
    await db.query(
      `INSERT INTO backlink_provider_settings (provider_id, is_enabled)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled)`,
      [providerId, isEnabled ? 1 : 0]
    );
  } catch (err) {
    if (!shouldUseLocalFallback(err)) throw err;
    console.warn('[BacklinkProviderManager] DB unavailable for updateSetting, using local store:', err.message);
    await localStore.updateBacklinkProviderSetting(providerId, isEnabled);
  }
}

function resolveCredentialValue(provider, fieldName, credentialsMap) {
  const saved = credentialsMap[provider.id]?.[fieldName];
  if (hasConfiguredValue(saved?.value)) {
    return { value: String(saved.value).trim(), source: 'saved' };
  }

  const field = provider.fields.find((item) => item.name === fieldName);
  const envValue = field?.envKey ? process.env[field.envKey] : '';
  if (hasConfiguredValue(envValue)) {
    return { value: String(envValue).trim(), source: 'env' };
  }

  return { value: '', source: null };
}

async function getProviderDetails() {
  const [credentialsMap, settingsMap] = await Promise.all([
    getCredentialsMap(),
    getSettingsMap(),
  ]);

  return BACKLINK_PROVIDERS.map((provider) => {
    const fields = provider.fields.map((field) => {
      const resolved = resolveCredentialValue(provider, field.name, credentialsMap);
      return {
        name: field.name,
        label: field.label,
        hasValue: Boolean(resolved.value),
        source: resolved.source,
      };
    });

    const configured = fields.every((field) => field.hasValue);
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

async function toggleProvider(providerId, enabled) {
  const definition = BACKLINK_PROVIDERS.find((provider) => provider.id === providerId);
  if (!definition) {
    throw createServiceError(`Unknown backlink provider: ${providerId}`, 404);
  }

  await updateSetting(providerId, enabled);
  return getProviderById(providerId);
}

async function saveProviderCredentials(providerId, credentials = {}) {
  const definition = BACKLINK_PROVIDERS.find((provider) => provider.id === providerId);
  if (!definition) {
    throw createServiceError(`Unknown backlink provider: ${providerId}`, 404);
  }

  const allowedFields = new Set(definition.fields.map((field) => field.name));
  const filteredCredentials = Object.entries(credentials || {}).reduce((acc, [key, value]) => {
    if (allowedFields.has(key) && hasConfiguredValue(value)) {
      acc[key] = String(value).trim();
    }
    return acc;
  }, {});

  if (Object.keys(filteredCredentials).length === 0) {
    throw createServiceError('At least one valid credential value is required.');
  }

  await updateCredentials(providerId, filteredCredentials);
  return getProviderById(providerId);
}

async function getActiveRuntimeConfig() {
  const [details, credentialsMap] = await Promise.all([
    getProviderDetails(),
    getCredentialsMap(),
  ]);

  const activeProvider = details.find((provider) => provider.active);
  if (!activeProvider) {
    return null;
  }

  const definition = BACKLINK_PROVIDERS.find((provider) => provider.id === activeProvider.id);
  if (!definition) {
    return null;
  }

  const runtimeCredentials = definition.fields.reduce((acc, field) => {
    acc[field.name] = resolveCredentialValue(definition, field.name, credentialsMap).value;
    return acc;
  }, {});

  return {
    providerId: activeProvider.id,
    providerName: activeProvider.name,
    login: runtimeCredentials.DATAFORSEO_LOGIN || '',
    password: runtimeCredentials.DATAFORSEO_PASSWORD || '',
  };
}

module.exports = {
  getStatus,
  getProviderById,
  toggleProvider,
  saveProviderCredentials,
  getActiveRuntimeConfig,
};
