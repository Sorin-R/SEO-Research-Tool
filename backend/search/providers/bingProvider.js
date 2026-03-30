const { serpApiManager } = require('../../scrapers');

async function search({ keyword, target, numResults = 10, prompt }) {
  return serpApiManager.search(keyword, numResults, {
    engine: 'bing',
    country: target.country,
    searchDomain: target.host,
    promptTemplate: prompt,
  });
}

module.exports = {
  search,
};
