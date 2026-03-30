const { resolveSearchTarget } = require('./config');
const { buildSerpPrompt } = require('./buildSerpPrompt');
const { normalizeSearchResults } = require('./normalizeSearchResults');
const { verifySearchResults } = require('./verifySearchResults');
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

function toBooleanFlag(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

async function runSearch({ keyword, engine, domain, location, highAccuracyMode, providerId, strictMode, verifyUrls, debug }) {
  const normalizedKeyword = sanitizeKeyword(keyword);
  if (!normalizedKeyword) {
    throw createServiceError('Keyword is required.', 400);
  }
  const normalizedLocation = sanitizeLocation(location);
  const normalizedProviderId = String(providerId || '').trim();
  const accuracyModeEnabled = toBooleanFlag(highAccuracyMode, false);
  const strictModeEnabled = toBooleanFlag(strictMode, accuracyModeEnabled);
  const verifyUrlsEnabled = toBooleanFlag(verifyUrls, accuracyModeEnabled);
  const debugEnabled = toBooleanFlag(debug, false);

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

  const providerResponse = await provider.search({
    keyword: normalizedKeyword,
    target,
    numResults: 10,
    location: normalizedLocation,
    providerId: normalizedProviderId || undefined,
    strictMode: strictModeEnabled,
    prompt,
  });
  const providerResults = Array.isArray(providerResponse)
    ? providerResponse
    : (providerResponse?.results || []);
  const providerMeta = providerResponse?.meta || null;

  const normalizedResults = normalizeSearchResults(providerResults, 10);
  const verification = await verifySearchResults(normalizedResults, {
    enabled: verifyUrlsEnabled,
  });
  const results = verification.results;

  const meta = {
    highAccuracyMode: accuracyModeEnabled,
    strictMode: strictModeEnabled,
    providerLock: normalizedProviderId || null,
    selectedProviderId: providerMeta?.selectedProviderId || null,
    selectedProviderName: providerMeta?.selectedProviderName || null,
    redirectsVerified: verifyUrlsEnabled,
    verification: verification.stats,
  };

  const response = {
    keyword: normalizedKeyword,
    engine: target.engine,
    domain: target.domain,
    location: normalizedLocation || null,
    results,
    meta,
  };

  if (debugEnabled) {
    response.debug = {
      prompt,
      providerAttempts: Array.isArray(providerMeta?.attempts) ? providerMeta.attempts : [],
      normalizedResultCount: normalizedResults.length,
    };
  }

  return response;
}

module.exports = {
  runSearch,
};
