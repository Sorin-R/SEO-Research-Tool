const { getSuggestions, getExpandedSuggestions } = require('./googleAutocomplete');
const { fetchSERPResults, scrapePageDetails } = require('./googleSERP');
const { getPeopleAlsoAsk } = require('./peopleAlsoAsk');
const serpApiManager = require('./serpApiManager');

module.exports = {
  getSuggestions,
  getExpandedSuggestions,
  fetchSERPResults,
  scrapePageDetails,
  getPeopleAlsoAsk,
  serpApiManager,
};
