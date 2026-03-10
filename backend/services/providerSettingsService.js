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

async function getProviderSettingsMap() {
  try {
    const rows = await db.query(
      `SELECT provider_id, is_enabled, updated_at
       FROM serp_provider_settings`
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

    console.warn('[ProviderSettingsService] DB unavailable, using local store for getProviderSettingsMap:', err.message);
    return localStore.getSerpProviderSettings();
  }
}

async function updateProviderSetting(providerId, isEnabled) {
  if (!providerId || !String(providerId).trim()) {
    throw createServiceError('Provider id is required.');
  }

  try {
    await db.query(
      `INSERT INTO serp_provider_settings (provider_id, is_enabled)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled)`,
      [providerId, isEnabled ? 1 : 0]
    );

    const rows = await db.query(
      `SELECT provider_id, is_enabled, updated_at
       FROM serp_provider_settings
       WHERE provider_id = ?
       LIMIT 1`,
      [providerId]
    );

    return rows[0]
      ? {
          provider_id: rows[0].provider_id,
          is_enabled: Boolean(rows[0].is_enabled),
          updated_at: rows[0].updated_at || null,
        }
      : null;
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[ProviderSettingsService] DB unavailable, using local store for updateProviderSetting:', err.message);
    const saved = await localStore.updateSerpProviderSetting(providerId, isEnabled);

    return saved
      ? {
          provider_id: providerId,
          is_enabled: Boolean(saved.is_enabled),
          updated_at: saved.updated_at || null,
        }
      : null;
  }
}

module.exports = {
  getProviderSettingsMap,
  updateProviderSetting,
};
