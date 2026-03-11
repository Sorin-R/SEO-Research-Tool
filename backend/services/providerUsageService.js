const db = require('../database');
const localStore = require('../utils/localStore');

const DEFAULT_USAGE_BASELINES = {
  serpapi: { quota_limit: 250, remaining: 171 },
  serpstack: { quota_limit: 100, remaining: 98 },
  zenserp: { quota_limit: 50, remaining: 43 },
  searchapi: { quota_limit: 100, remaining: 96 },
  scaleserp: { quota_limit: 100, remaining: 96 },
};

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

function parseNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseQuotaLimitFromText(quotaText) {
  const quotaValue = String(quotaText || '');
  const match = quotaValue.replace(/,/g, '').match(/(\d+)/);
  return match ? parseNonNegativeInt(match[1], 0) : 0;
}

function resolveProviderDefaults(providerConfig = {}) {
  const configuredDefaults = DEFAULT_USAGE_BASELINES[providerConfig.id] || {};
  const fallbackLimit = parseQuotaLimitFromText(providerConfig.quota);
  const quotaLimit = parseNonNegativeInt(
    configuredDefaults.quota_limit ?? providerConfig.requestLimit,
    fallbackLimit
  );
  const remaining = parseNonNegativeInt(
    configuredDefaults.remaining ?? providerConfig.defaultRemaining,
    quotaLimit
  );

  return {
    quota_limit: quotaLimit,
    remaining,
  };
}

function normalizeUsageRow(row, defaults) {
  const quotaLimit = parseNonNegativeInt(row?.quota_limit, defaults.quota_limit);
  const remaining = parseNonNegativeInt(row?.remaining, defaults.remaining);
  const usedCount = parseNonNegativeInt(
    row?.used_count,
    Math.max(quotaLimit - remaining, 0)
  );

  return {
    quota_limit: quotaLimit,
    remaining: Math.min(remaining, quotaLimit > 0 ? quotaLimit : remaining),
    used_count: usedCount,
    updated_at: row?.updated_at || null,
  };
}

async function getProviderUsageMap(providerConfigs = []) {
  const defaultsByProvider = (Array.isArray(providerConfigs) ? providerConfigs : []).reduce((accumulator, providerConfig) => {
    accumulator[providerConfig.id] = resolveProviderDefaults(providerConfig);
    return accumulator;
  }, {});

  try {
    const rows = await db.query(
      `SELECT provider_id, quota_limit, remaining, used_count, updated_at
       FROM serp_provider_usage`
    );

    const rowsByProvider = rows.reduce((accumulator, row) => {
      accumulator[row.provider_id] = row;
      return accumulator;
    }, {});

    return Object.entries(defaultsByProvider).reduce((accumulator, [providerId, defaults]) => {
      accumulator[providerId] = normalizeUsageRow(rowsByProvider[providerId], defaults);
      return accumulator;
    }, {});
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[ProviderUsageService] DB unavailable, using local store for getProviderUsageMap:', err.message);
    const localUsageMap = await localStore.getSerpProviderUsageMap();

    return Object.entries(defaultsByProvider).reduce((accumulator, [providerId, defaults]) => {
      accumulator[providerId] = normalizeUsageRow(localUsageMap[providerId], defaults);
      return accumulator;
    }, {});
  }
}

async function consumeProviderUsage(providerConfig, amount = 1) {
  const providerId = providerConfig?.id;
  if (!providerId) {
    return null;
  }

  const usageDelta = Math.max(1, parseNonNegativeInt(amount, 1));
  const defaults = resolveProviderDefaults(providerConfig);

  try {
    await db.query(
      `INSERT INTO serp_provider_usage (provider_id, quota_limit, remaining, used_count)
       VALUES (?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE quota_limit = VALUES(quota_limit)`,
      [providerId, defaults.quota_limit, defaults.remaining]
    );

    await db.query(
      `UPDATE serp_provider_usage
       SET used_count = used_count + ?,
           remaining = GREATEST(0, remaining - ?)
       WHERE provider_id = ?`,
      [usageDelta, usageDelta, providerId]
    );

    const rows = await db.query(
      `SELECT provider_id, quota_limit, remaining, used_count, updated_at
       FROM serp_provider_usage
       WHERE provider_id = ?
       LIMIT 1`,
      [providerId]
    );

    return normalizeUsageRow(rows[0], defaults);
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[ProviderUsageService] DB unavailable, using local store for consumeProviderUsage:', err.message);
    const localUsage = await localStore.consumeSerpProviderUsage(providerId, usageDelta, defaults);
    return normalizeUsageRow(localUsage, defaults);
  }
}

module.exports = {
  DEFAULT_USAGE_BASELINES,
  getProviderUsageMap,
  consumeProviderUsage,
};
