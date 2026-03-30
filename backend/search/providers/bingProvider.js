const { serpApiManager } = require('../../scrapers');

async function search({ keyword, target, numResults = 10, location, prompt }) {
  return serpApiManager.search(keyword, numResults, {
    engine: 'bing',
    country: target.country,
    searchDomain: target.host,
    location: String(location || '').trim() || undefined,
    promptTemplate: prompt,
  });
}

module.exports = {
  search,
};
