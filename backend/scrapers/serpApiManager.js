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

/**
 * List of SERP providers in priority order.
 * Each provider has a check() method to verify if configured.
 * Each provider has a search() method to fetch results.
 */
const providers = [
  {
    name: 'SerpAPI',
    provider: serpApiProvider,
    enabled: () => !!process.env.SERPAPI_KEY,
  },
  {
    name: 'Serpstack',
    provider: serpstackProvider,
    enabled: () => !!process.env.SERPSTACK_KEY,
  },
  {
    name: 'Zenserp',
    provider: zenserpProvider,
    enabled: () => !!process.env.ZENSERP_KEY,
  },
  {
    name: 'SearchAPI',
    provider: searchApiProvider,
    enabled: () => !!process.env.SEARCHAPI_KEY,
  },
  {
    name: 'ScaleSERP',
    provider: scaleserpProvider,
    enabled: () => !!process.env.SCALESERP_KEY,
  },
  {
    name: 'Google Custom Search',
    provider: googleSearchProvider,
    enabled: () => !!process.env.GOOGLE_SEARCH_API_KEY && !!process.env.GOOGLE_SEARCH_CX,
  },
  {
    name: 'Bing Search API',
    provider: bingSearchProvider,
    enabled: () => !!process.env.BING_SEARCH_KEY,
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
async function search(keyword, numResults = 10) {
  if (!keyword || !keyword.trim()) {
    throw new Error('Keyword is required.');
  }

  const enabledProviders = providers.filter((p) => p.enabled());

  if (enabledProviders.length === 0) {
    throw new Error(
      'No SERP providers configured. Set one of: SERPAPI_KEY, SERPSTACK_KEY, ZENSERP_KEY, ' +
      'SEARCHAPI_KEY, SCALESERP_KEY, GOOGLE_SEARCH_API_KEY+GOOGLE_SEARCH_CX, or BING_SEARCH_KEY in .env'
    );
  }

  console.log(`[SERP] ${enabledProviders.length} provider(s) configured: ${enabledProviders.map((p) => p.name).join(', ')}`);

  // Try each provider in order
  for (const config of enabledProviders) {
    try {
      console.log(`[SERP] Trying provider: ${config.name}...`);
      const results = await config.provider.search(keyword, numResults);

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
function getStatus() {
  return {
    configuredProviders: providers
      .filter((p) => p.enabled())
      .map((p) => p.name),
    totalProviders: providers.length,
    availableProviders: providers.map((p) => ({
      name: p.name,
      enabled: p.enabled(),
      envVar: getEnvVarForProvider(p.name),
    })),
  };
}

function getEnvVarForProvider(name) {
  const envMap = {
    'SerpAPI': 'SERPAPI_KEY',
    'Serpstack': 'SERPSTACK_KEY',
    'Zenserp': 'ZENSERP_KEY',
    'SearchAPI': 'SEARCHAPI_KEY',
    'ScaleSERP': 'SCALESERP_KEY',
    'Google Custom Search': 'GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_CX',
    'Bing Search API': 'BING_SEARCH_KEY',
  };
  return envMap[name] || '?';
}

module.exports = {
  search,
  getStatus,
};
