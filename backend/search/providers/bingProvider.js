const { serpApiManager } = require('../../scrapers');

async function search({ keyword, target, numResults = 10, location, prompt, providerId, strictMode = false }) {
  const baseOptions = {
    engine: 'bing',
    country: target.country,
    searchDomain: target.host,
    location: String(location || '').trim() || undefined,
    promptTemplate: prompt,
    strictMode: strictMode === true,
    withMeta: true,
    excludeProviderIds: ['local-pc-agent'],
  };

  if (providerId) {
    return serpApiManager.searchByProviderId(providerId, keyword, numResults, baseOptions);
  }

  return serpApiManager.search(keyword, numResults, baseOptions);
}

module.exports = {
  search,
};
