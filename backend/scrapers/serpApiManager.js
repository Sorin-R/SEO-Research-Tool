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
const providerSettingsService = require('../services/providerSettingsService');

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
    id: 'serpapi',
    name: 'SerpAPI',
    provider: serpApiProvider,
    docsUrl: 'https://serpapi.com/',
    quota: '100/month',
    quotaType: 'Monthly',
    setupTime: '2 min',
    envVars: ['SERPAPI_KEY'],
    isConfigured: () => hasConfiguredValue(process.env.SERPAPI_KEY),
  },
  {
    id: 'serpstack',
    name: 'Serpstack',
    provider: serpstackProvider,
    docsUrl: 'https://serpstack.com/',
    quota: '100/month',
    quotaType: 'Monthly',
    setupTime: '2 min',
    envVars: ['SERPSTACK_KEY'],
    isConfigured: () => hasConfiguredValue(process.env.SERPSTACK_KEY),
  },
  {
    id: 'zenserp',
    name: 'Zenserp',
    provider: zenserpProvider,
    docsUrl: 'https://zenserp.com/',
    quota: '100/month',
    quotaType: 'Monthly',
    setupTime: '2 min',
    envVars: ['ZENSERP_KEY'],
    isConfigured: () => hasConfiguredValue(process.env.ZENSERP_KEY),
  },
  {
    id: 'searchapi',
    name: 'SearchAPI',
    provider: searchApiProvider,
    docsUrl: 'https://www.searchapi.io/',
    quota: '100/month',
    quotaType: 'Monthly',
    setupTime: '2 min',
    envVars: ['SEARCHAPI_KEY'],
    isConfigured: () => hasConfiguredValue(process.env.SEARCHAPI_KEY),
  },
  {
    id: 'scaleserp',
    name: 'ScaleSERP',
    provider: scaleserpProvider,
    docsUrl: 'https://www.scaleserp.com/',
    quota: '100/month',
    quotaType: 'Monthly',
    setupTime: '2 min',
    envVars: ['SCALESERP_KEY'],
    isConfigured: () => hasConfiguredValue(process.env.SCALESERP_KEY),
  },
  {
    id: 'google-custom-search',
    name: 'Google Custom Search',
    provider: googleSearchProvider,
    docsUrl: 'https://programmablesearchengine.google.com/',
    quota: '100/day',
    quotaType: 'Daily',
    setupTime: '10 min',
    envVars: ['GOOGLE_SEARCH_API_KEY', 'GOOGLE_SEARCH_CX'],
    isConfigured: () =>
      hasConfiguredValue(process.env.GOOGLE_SEARCH_API_KEY) &&
      hasConfiguredValue(process.env.GOOGLE_SEARCH_CX),
  },
  {
    id: 'bing-search-api',
    name: 'Bing Search API',
    provider: bingSearchProvider,
    docsUrl: 'https://www.microsoft.com/en-us/bing/apis/bing-web-search-api',
    quota: '~1000/month',
    quotaType: 'Monthly',
    setupTime: '3 min',
    envVars: ['BING_SEARCH_KEY'],
    isConfigured: () => hasConfiguredValue(process.env.BING_SEARCH_KEY),
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

  const settings = await providerSettingsService.getProviderSettingsMap();
  const enabledProviders = providers.filter((providerConfig) => (
    providerConfig.isConfigured() && isProviderEnabled(providerConfig.id, settings)
  ));

  if (enabledProviders.length === 0) {
    throw new Error(
      'No active SERP providers available. Configure a provider API key and make sure its toggle is ON.'
    );
  }

  console.log(`[SERP] ${enabledProviders.length} provider(s) configured: ${enabledProviders.map((p) => p.name).join(', ')}`);

  // Try each provider in order
  for (const config of enabledProviders) {
    try {
      console.log(`[SERP] Trying provider: ${config.name}...`);
      const results = await config.provider.search(keyword, numResults, options);

      if (results && results.length > 0) {
        console.log(`[SERP] ✓ ${config.name} returned ${results.length} results`);
        return results;
      }

      console.warn(`[SERP] ${config.name} returned no results, trying next provider...`);
    } catch (err) {
      console.warn(`[SERP] ${config.name} failed: ${err.message}, trying next provider...`);
    }
  }

  throw new Error(
    'All configured SERP providers failed. Check your API keys and quota. ' +
    'Free tiers may have monthly limits.'
  );
}

/**
 * Get status of all configured providers.
 * Useful for debugging.
 */
async function getStatus() {
  const settings = await providerSettingsService.getProviderSettingsMap();
  const availableProviders = providers.map((providerConfig) => ({
    id: providerConfig.id,
    name: providerConfig.name,
    configured: providerConfig.isConfigured(),
    enabled: isProviderEnabled(providerConfig.id, settings),
    active: providerConfig.isConfigured() && isProviderEnabled(providerConfig.id, settings),
    envVars: providerConfig.envVars,
    docsUrl: providerConfig.docsUrl,
    quota: providerConfig.quota,
    quotaType: providerConfig.quotaType,
    setupTime: providerConfig.setupTime,
    updatedAt: settings[providerConfig.id]?.updated_at || null,
  }));

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

function isProviderEnabled(providerId, settings = {}) {
  if (!settings[providerId]) {
    return true;
  }

  return Boolean(settings[providerId].is_enabled);
}

module.exports = {
  search,
  getStatus,
  updateProviderState,
};
