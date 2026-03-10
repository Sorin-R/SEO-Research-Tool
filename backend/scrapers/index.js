const { getSuggestions, getExpandedSuggestions } = require('./googleAutocomplete');
const { fetchSERPResults, scrapePageDetails } = require('./googleSERP');
const serpApiManager = require('./serpApiManager');

async function getPeopleAlsoAsk(...args) {
  const peopleAlsoAsk = require('./peopleAlsoAsk');
  return peopleAlsoAsk.getPeopleAlsoAsk(...args);
}

module.exports = {
  getSuggestions,
  getExpandedSuggestions,
  fetchSERPResults,
  scrapePageDetails,
  getPeopleAlsoAsk,
  serpApiManager,
};
