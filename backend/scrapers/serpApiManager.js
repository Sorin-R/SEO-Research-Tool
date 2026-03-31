/**
 * Multi-Provider SERP API Manager
 * Supports 7 different SERP providers with automatic fallback.
 * Tries providers in order until one succeeds.
 */

const serpApiProvider = require('./providers/serpApiProvider');
const serpstackProvider = require('./providers/serpstackProvider');
const zenserpProvider = require('./providers/zenserpProvider');
const searchApiProvider = require('./providers/searchApiProvider');
const scaleserpProvider = require('./providers/scaleserpProvider');
const googleSearchProvider = require('./providers/googleSearchProvider');
const bingSearchProvider = require('./providers/bingSearchProvider');
const localPcAgentProvider = require('./providers/localPcAgentProvider');
const providerCredentialsService = require('../services/providerCredentialsService');
const providerSettingsService = require('../services/providerSettingsService');
const providerUsageService = require('../services/providerUsageService');

function hasConfiguredValue(value) {
  if (!value) return false;

  const normalized = String(value).trim().toLowerCase();
  return normalized !== '' && normalized !== 'your_key_here';
}

/**
 * List of SERP providers in priority order.
 * Each provider has a check() method to verify if configured.
 * Each provider has a search() method to fetch results.
 */
const providers = [
  {
    id: 'local-pc-agent',
    name: 'Local PC Agent',
    provider: localPcAgentProvider,
    supportedEngines: ['google', 'bing'],
    docsUrl: 'https://github.com/Sorin-R/SEO-Research-Tool',
    quota: 'Local PC session',
    quotaType: 'Runtime',
    setupTime: '1 min',
    requestLimit: 0,
    defaultRemaining: 0,
    fields: [],
    defaultEnabled: false,
    skipUsage: true,
  },
  {
    id: 'serpapi',
    name: 'SerpAPI',
    provider: serpApiProvider,
    supportedEngines: ['google', 'bing'],
    docsUrl: 'https://serpapi.com/',
    quota: '100/month',
    quotaType: 'Monthly',
    setupTime: '2 min',
    requestLimit: 250,
    defaultRemaining: 171,
    fields: [
      { key: 'SERPAPI_KEY', label: 'API Key' },
    ],
  },
  {
    id: 'serpstack',
    name: 'Serpstack',
    provider: serpstackProvider,
    supportedEngines: ['google'],
    docsUrl: 'https://serpstack.com/',
    quota: '100/month',
    quotaType: 'Monthly',
    setupTime: '2 min',
    requestLimit: 100,
    defaultRemaining: 98,
    fields: [
      { key: 'SERPSTACK_KEY', label: 'API Key' },
    ],
  },
  {
    id: 'zenserp',
    name: 'Zenserp',
    provider: zenserpProvider,
    supportedEngines: ['google'],
    docsUrl: 'https://zenserp.com/',
    quota: '100/month',
    quotaType: 'Monthly',
    setupTime: '2 min',
    requestLimit: 50,
    defaultRemaining: 43,
    fields: [
      { key: 'ZENSERP_KEY', label: 'API Key' },
    ],
  },
  {
    id: 'searchapi',
    name: 'SearchAPI',
    provider: searchApiProvider,
    supportedEngines: ['google', 'bing'],
    docsUrl: 'https://www.searchapi.io/',
    quota: '100/month',
    quotaType: 'Monthly',
    setupTime: '2 min',
    requestLimit: 100,
    defaultRemaining: 96,
    fields: [
      { key: 'SEARCHAPI_KEY', label: 'API Key' },
    ],
  },
  {
    id: 'scaleserp',
    name: 'ScaleSERP',
    provider: scaleserpProvider,
    supportedEngines: ['google'],
    docsUrl: 'https://www.scaleserp.com/',
    quota: '100/month',
    quotaType: 'Monthly',
    setupTime: '2 min',
    requestLimit: 100,
    defaultRemaining: 96,
    fields: [
      { key: 'SCALESERP_KEY', label: 'API Key' },
    ],
  },
  {
    id: 'google-custom-search',
    name: 'Google Custom Search',
    provider: googleSearchProvider,
    supportedEngines: ['google'],
    docsUrl: 'https://programmablesearchengine.google.com/',
    quota: '100/day',
    quotaType: 'Daily',
    setupTime: '10 min',
    requestLimit: 100,
    defaultRemaining: 100,
    fields: [
      { key: 'GOOGLE_SEARCH_API_KEY', label: 'API Key' },
      { key: 'GOOGLE_SEARCH_CX', label: 'Search Engine ID' },
    ],
  },
  {
    id: 'bing-search-api',
    name: 'Bing Search API',
    provider: bingSearchProvider,
    supportedEngines: ['bing'],
    docsUrl: 'https://www.microsoft.com/en-us/bing/apis/bing-web-search-api',
    quota: '~1000/month',
    quotaType: 'Monthly',
    setupTime: '3 min',
    requestLimit: 1000,
    defaultRemaining: 1000,
    fields: [
      { key: 'BING_SEARCH_KEY', label: 'API Key' },
    ],
  },
];

/**
 * Search using the first available provider.
 * Automatically falls back to the next provider if one fails.
 *
 * @param {string} keyword
 * @param {number} numResults
 * @returns {Promise<Array>} Search results
 */
async function search(keyword, numResults = 10, options = {}) {
  if (!keyword || !keyword.trim()) {
    throw new Error('Keyword is required.');
  }

  const engine = normalizeEngine(options.engine);
  const excludedProviderIds = new Set(
    Array.isArray(options.excludeProviderIds)
      ? options.excludeProviderIds.map((entry) => String(entry || '').trim()).filter(Boolean)
      : []
  );
  const providerContexts = await getProviderContexts();
  let enabledProviders = providerContexts.filter(
    (providerContext) =>
      providerContext.detail.active
      && providerSupportsEngine(providerContext.config, engine)
      && !excludedProviderIds.has(providerContext.config.id)
  );

  if (enabledProviders.length === 0 && excludedProviderIds.size > 0) {
    enabledProviders = providerContexts.filter(
      (providerContext) =>
        providerContext.detail.active
        && providerSupportsEngine(providerContext.config, engine)
    );
  }

  if (enabledProviders.length === 0) {
    throw new Error(
      'No active SERP providers available. Configure a provider API key and make sure its toggle is ON.'
    );
  }

  console.log(
    `[SERP] ${enabledProviders.length} provider(s) configured: ${enabledProviders.map((providerContext) => providerContext.detail.name).join(', ')}`
  );
  const attempts = [];

  // Try each provider in order
  for (const providerContext of enabledProviders) {
    try {
      console.log(`[SERP] Trying provider: ${providerContext.detail.name}...`);
      const results = await providerContext.config.provider.search(keyword, numResults, {
        ...options,
        engine,
        credentials: providerContext.credentials,
      });
      await consumeProviderUsageSafe(providerContext.config);

      if (results && results.length > 0) {
        const normalizedResults = normalizeProviderResults(results, numResults);
        console.log(`[SERP] ✓ ${providerContext.detail.name} returned ${normalizedResults.length} results`);
        if (options.withMeta === true) {
          attempts.push({
            providerId: providerContext.config.id,
            providerName: providerContext.detail.name,
            success: true,
            returnedResults: normalizedResults.length,
          });

          return {
            results: normalizedResults,
            meta: {
              selectedProviderId: providerContext.config.id,
              selectedProviderName: providerContext.detail.name,
              attempts,
            },
          };
        }
        return normalizedResults;
      }

      console.warn(`[SERP] ${providerContext.detail.name} returned no results, trying next provider...`);
      attempts.push({
        providerId: providerContext.config.id,
        providerName: providerContext.detail.name,
        success: false,
        returnedResults: 0,
        error: 'Provider returned no results',
      });
    } catch (err) {
      console.warn(`[SERP] ${providerContext.detail.name} failed: ${err.message}, trying next provider...`);
      attempts.push({
        providerId: providerContext.config.id,
        providerName: providerContext.detail.name,
        success: false,
        returnedResults: 0,
        error: err.message,
      });
    }
  }

  const error = new Error(
    'All configured SERP providers failed. Check your API keys and quota. ' +
    'Free tiers may have monthly limits.'
  );
  if (options.withMeta === true) {
    error.attempts = attempts;
  }
  throw error;
}

async function searchByProviderId(providerId, keyword, numResults = 10, options = {}) {
  const engine = normalizeEngine(options.engine);
  const providerContext = (await getProviderContexts()).find(
    (context) => context.config.id === providerId
  );

  if (!providerContext) {
    throw new Error(`Provider not found: ${providerId}`);
  }

  if (!providerContext.detail.active) {
    throw new Error(`Provider "${providerContext.detail.name}" is not active.`);
  }

  if (!providerSupportsEngine(providerContext.config, engine)) {
    throw new Error(`Provider "${providerContext.detail.name}" does not support ${engine} engine.`);
  }

  const results = await providerContext.config.provider.search(keyword, numResults, {
    ...options,
    engine,
    credentials: providerContext.credentials,
  });
  await consumeProviderUsageSafe(providerContext.config);
  const normalizedResults = normalizeProviderResults(results, numResults);

  if (options.withMeta === true) {
    return {
      results: normalizedResults,
      meta: {
        selectedProviderId: providerContext.config.id,
        selectedProviderName: providerContext.detail.name,
        attempts: [
          {
            providerId: providerContext.config.id,
            providerName: providerContext.detail.name,
            success: true,
            returnedResults: normalizedResults.length,
          },
        ],
      },
    };
  }

  return normalizedResults;
}

async function consumeProviderUsageSafe(providerConfig) {
  if (providerConfig?.skipUsage) {
    return;
  }

  try {
    await providerUsageService.consumeProviderUsage(providerConfig, 1);
  } catch (err) {
    console.warn(
      `[SERP] Failed to update usage counter for ${providerConfig?.name || providerConfig?.id || 'provider'}: ${err.message}`
    );
  }
}

function normalizeProviderResults(results, numResults) {
  return (Array.isArray(results) ? results : [])
    .map((result, index) => {
      const normalizedUrl = normalizeResultUrl(result?.url || result?.link || result?.href || '');

      return {
        position: Number.isFinite(Number(result?.position)) ? Number(result.position) : index + 1,
        title: String(result?.title || '').trim(),
        url: normalizedUrl,
        snippet: String(result?.snippet || '').trim(),
      };
    })
    .filter((result) => result.url)
    .slice(0, numResults);
}

function normalizeResultUrl(rawUrl) {
  let current = String(rawUrl || '').trim();

  if (!current) {
    return '';
  }

  // Some providers return Google redirect links; unwrap repeatedly if needed.
  for (let i = 0; i < 3; i += 1) {
    const destination = extractGoogleRedirectDestination(current);
    if (!destination || destination === current) {
      break;
    }
    current = destination;
  }

  if (current.startsWith('//')) {
    current = `https:${current}`;
  }

  if (!/^https?:\/\//i.test(current)) {
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(current)) {
      current = `https://${current}`;
    } else {
      return '';
    }
  }

  try {
    const parsed = new URL(current);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function extractGoogleRedirectDestination(inputUrl) {
  const candidate = String(inputUrl || '').trim();
  if (!candidate) {
    return '';
  }

  const absoluteCandidate = candidate.startsWith('/url?') ? `https://www.google.com${candidate}` : candidate;

  try {
    const parsed = new URL(absoluteCandidate);
    const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const isGoogleHost =
      hostname === 'google.com' ||
      hostname.startsWith('google.') ||
      hostname.endsWith('.google.com') ||
      hostname.endsWith('.google.co.uk');

    if (!isGoogleHost) {
      return '';
    }

    if (!['/url', '/imgres', '/aclk'].includes(parsed.pathname)) {
      return '';
    }

    const targetParams = ['url', 'q', 'adurl', 'imgurl', 'uddg'];
    for (const paramName of targetParams) {
      const value = parsed.searchParams.get(paramName);
      if (!value) {
        continue;
      }

      const decoded = decodeMaybeEncoded(value);
      if (/^https?:\/\//i.test(decoded)) {
        return decoded;
      }
    }

    return '';
  } catch {
    return '';
  }
}

function decodeMaybeEncoded(value) {
  let current = String(value || '').trim();
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        break;
      }
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

/**
 * Get status of all configured providers.
 * Useful for debugging.
 */
async function getStatus() {
  const providerContexts = await getProviderContexts();
  const availableProviders = providerContexts.map((providerContext) => providerContext.detail);

  return {
    configuredProviders: availableProviders
      .filter((providerConfig) => providerConfig.configured)
      .map((providerConfig) => providerConfig.name),
    activeProviders: availableProviders
      .filter((providerConfig) => providerConfig.active)
      .map((providerConfig) => providerConfig.name),
    totalProviders: providers.length,
    availableProviders,
  };
}

async function updateProviderState(providerId, isEnabled) {
  const providerConfig = providers.find((entry) => entry.id === providerId);

  if (!providerConfig) {
    const error = new Error('Provider not found.');
    error.statusCode = 404;
    throw error;
  }

  await providerSettingsService.updateProviderSetting(providerId, isEnabled);
  const status = await getStatus();

  return status.availableProviders.find((entry) => entry.id === providerId) || null;
}

async function updateProviderCredentials(providerId, credentials) {
  const providerConfig = providers.find((entry) => entry.id === providerId);

  if (!providerConfig) {
    const error = new Error('Provider not found.');
    error.statusCode = 404;
    throw error;
  }

  const allowedFields = new Set(providerConfig.fields.map((field) => field.key));
  const normalizedCredentials = Object.entries(credentials || {}).reduce((accumulator, [key, value]) => {
    if (allowedFields.has(key) && hasConfiguredValue(value)) {
      accumulator[key] = String(value).trim();
    }
    return accumulator;
  }, {});

  if (Object.keys(normalizedCredentials).length === 0) {
    const error = new Error('At least one credential value is required.');
    error.statusCode = 400;
    throw error;
  }

  await providerCredentialsService.updateProviderCredentials(providerId, normalizedCredentials);
  const status = await getStatus();

  return status.availableProviders.find((entry) => entry.id === providerId) || null;
}

function isProviderEnabled(providerConfig, settings = {}) {
  if (!providerConfig) {
    return true;
  }

  if (!settings[providerConfig.id]) {
    return providerConfig.defaultEnabled !== false;
  }

  return Boolean(settings[providerConfig.id].is_enabled);
}

async function getProviderContexts() {
  const [settings, credentialsMap, usageMap] = await Promise.all([
    providerSettingsService.getProviderSettingsMap(),
    providerCredentialsService.getProviderCredentialsMap(),
    providerUsageService.getProviderUsageMap(providers),
  ]);

  return providers.map((providerConfig) => {
    const detail = buildProviderDetail(
      providerConfig,
      settings,
      credentialsMap[providerConfig.id] || {},
      usageMap[providerConfig.id] || null
    );

    return {
      config: providerConfig,
      detail,
      credentials: buildResolvedCredentials(providerConfig, credentialsMap[providerConfig.id] || {}),
    };
  });
}

function buildProviderDetail(providerConfig, settings, storedCredentials, usage) {
  const fields = providerConfig.fields.map((fieldConfig) => {
    const resolvedCredential = resolveCredential(fieldConfig.key, storedCredentials);

    return {
      name: fieldConfig.key,
      label: fieldConfig.label,
      hasValue: hasConfiguredValue(resolvedCredential.value),
      source: resolvedCredential.source,
      updatedAt: resolvedCredential.updatedAt,
    };
  });

  const configured = fields.every((field) => field.hasValue);
  const enabled = isProviderEnabled(providerConfig, settings);

  return {
    id: providerConfig.id,
    name: providerConfig.name,
    supportedEngines: Array.isArray(providerConfig.supportedEngines) ? providerConfig.supportedEngines : ['google'],
    configured,
    enabled,
    active: configured && enabled,
    envVars: providerConfig.fields.map((field) => field.key),
    fields,
    docsUrl: providerConfig.docsUrl,
    quota: providerConfig.quota,
    quotaType: providerConfig.quotaType,
    usage: providerConfig.skipUsage
      ? null
      : {
          limit: Number(usage?.quota_limit) || Number(providerConfig.requestLimit) || 0,
          remaining: Number(usage?.remaining) || 0,
          used: Number(usage?.used_count) || 0,
          display: `${Number(usage?.quota_limit) || Number(providerConfig.requestLimit) || 0}/${Number(usage?.remaining) || 0}`,
          format: 'limit/remaining',
        },
    setupTime: providerConfig.setupTime,
    updatedAt: settings[providerConfig.id]?.updated_at || null,
  };
}

function buildResolvedCredentials(providerConfig, storedCredentials) {
  return providerConfig.fields.reduce((accumulator, fieldConfig) => {
    accumulator[fieldConfig.key] = resolveCredential(fieldConfig.key, storedCredentials).value;
    return accumulator;
  }, {});
}

function normalizeEngine(engine) {
  const normalized = String(engine || 'google').trim().toLowerCase();
  return normalized === 'bing' ? 'bing' : 'google';
}

function providerSupportsEngine(providerConfig, engine) {
  const supportedEngines = Array.isArray(providerConfig.supportedEngines)
    ? providerConfig.supportedEngines
    : ['google'];
  return supportedEngines.includes(normalizeEngine(engine));
}

function resolveCredential(fieldKey, storedCredentials) {
  const saved = storedCredentials?.[fieldKey];

  if (hasConfiguredValue(saved?.value)) {
    return {
      value: saved.value,
      source: 'saved',
      updatedAt: saved.updated_at || null,
    };
  }

  if (hasConfiguredValue(process.env[fieldKey])) {
    return {
      value: process.env[fieldKey],
      source: 'env',
      updatedAt: null,
    };
  }

  return {
    value: '',
    source: null,
    updatedAt: null,
  };
}

module.exports = {
  search,
  searchByProviderId,
  getStatus,
  updateProviderState,
  updateProviderCredentials,
};
