const db = require('../database');
const localStore = require('../utils/localStore');

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
    message.includes('access denied') ||
    message.includes('connection') ||
    message.includes('connect') ||
    message.includes('timeout') ||
    message.includes('not available')
  );
}

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function getProviderCredentialsMap() {
  try {
    const rows = await db.query(
      `SELECT provider_id, credential_key, credential_value, updated_at
       FROM serp_provider_credentials`
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

    console.warn('[ProviderCredentialsService] DB unavailable, using local store for getProviderCredentialsMap:', err.message);
    return localStore.getSerpProviderCredentials();
  }
}

async function updateProviderCredentials(providerId, credentials = {}) {
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
        `INSERT INTO serp_provider_credentials (provider_id, credential_key, credential_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE credential_value = VALUES(credential_value)`,
        [providerId, credentialKey, String(credentialValue).trim()]
      );
    }
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[ProviderCredentialsService] DB unavailable, using local store for updateProviderCredentials:', err.message);
    await localStore.updateSerpProviderCredentials(providerId, credentials);
  }

  const credentialsMap = await getProviderCredentialsMap();
  return credentialsMap[providerId] || {};
}

module.exports = {
  getProviderCredentialsMap,
  updateProviderCredentials,
};
