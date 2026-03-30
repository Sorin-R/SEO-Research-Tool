const { resolveSearchTarget } = require('./config');
const { buildSerpPrompt } = require('./buildSerpPrompt');
const { normalizeSearchResults } = require('./normalizeSearchResults');
const googleProvider = require('./providers/googleProvider');
const bingProvider = require('./providers/bingProvider');

const providerMap = {
  google: googleProvider,
  bing: bingProvider,
};

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeKeyword(keyword) {
  return String(keyword || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function sanitizeLocation(location) {
  return String(location || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

async function runSearch({ keyword, engine, domain, location }) {
  const normalizedKeyword = sanitizeKeyword(keyword);
  if (!normalizedKeyword) {
    throw createServiceError('Keyword is required.', 400);
  }
  const normalizedLocation = sanitizeLocation(location);

  const target = resolveSearchTarget(engine, domain);
  if (!target) {
    throw createServiceError('Invalid engine/domain. Use Google.com, Google.co.uk, Bing.com, or Bing.co.uk.', 400);
  }

  const provider = providerMap[target.engine];
  if (!provider) {
    throw createServiceError(`No provider configured for engine "${target.engine}".`, 500);
  }

  const prompt = buildSerpPrompt({
    keyword: normalizedKeyword,
    engine: target.engine,
    domain: target.domain,
    location: normalizedLocation,
  });

  const rawResults = await provider.search({
    keyword: normalizedKeyword,
    target,
    numResults: 10,
    location: normalizedLocation,
    prompt,
  });

  const results = normalizeSearchResults(rawResults, 10);

  return {
    keyword: normalizedKeyword,
    engine: target.engine,
    domain: target.domain,
    location: normalizedLocation || null,
    results,
  };
}

module.exports = {
  runSearch,
};
