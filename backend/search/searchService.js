const { resolveSearchTarget } = require('./config');
const { buildSerpPrompt } = require('./buildSerpPrompt');
const { normalizeSearchResults } = require('./normalizeSearchResults');
const { verifySearchResults } = require('./verifySearchResults');
const { analyzeSERPWithAI } = require('../services/aiSerpService');
const { analyzeSERPFromScreenshot } = require('./screenshotSerpService');
const { createJob, waitForJob } = require('./localSerpAgentQueue');
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

function isLocalBlockedAttempt(attempt = {}) {
  return (
    String(attempt.providerId || '') === 'local-pc-agent'
    && String(attempt.error || '').toLowerCase().includes('blocked')
  );
}

function isOnlyLocalBlockedFailure(err) {
  const attempts = Array.isArray(err?.attempts) ? err.attempts : [];
  if (attempts.length !== 1) {
    return false;
  }
  return isLocalBlockedAttempt(attempts[0]);
}

async function runSearch({ keyword, engine, domain, location, aiMode, screenshotMode, localAgentMode, highAccuracyMode, providerId, strictMode, verifyUrls, debug }) {
  const normalizedKeyword = sanitizeKeyword(keyword);
  if (!normalizedKeyword) {
    throw createServiceError('Keyword is required.', 400);
  }
  const normalizedLocation = sanitizeLocation(location);
  const aiModeEnabled = toBooleanFlag(aiMode, false);
  const screenshotModeEnabled = toBooleanFlag(screenshotMode, false);
  const localAgentModeEnabled = toBooleanFlag(localAgentMode, false);
  const normalizedProviderId = String(providerId || '').trim();
  const accuracyModeEnabled = toBooleanFlag(highAccuracyMode, false);
  const strictModeEnabled = toBooleanFlag(strictMode, accuracyModeEnabled);
  const verifyUrlsEnabled = toBooleanFlag(verifyUrls, accuracyModeEnabled);
  const debugEnabled = toBooleanFlag(debug, false);

  const target = resolveSearchTarget(engine, domain);
  if (!target) {
    throw createServiceError('Invalid engine/domain. Use Google.com, Google.co.uk, Bing.com, or Bing.co.uk.', 400);
  }

  if (screenshotModeEnabled) {
    const screenshotResult = await analyzeSERPFromScreenshot(normalizedKeyword, {
      engine: target.engine,
      searchDomain: target.host,
      country: target.country,
      location: normalizedLocation,
      numResults: 10,
    });

    const normalizedResults = normalizeSearchResults(screenshotResult.results || [], 10);
    const verification = await verifySearchResults(normalizedResults, {
      enabled: verifyUrlsEnabled,
    });

    const response = {
      keyword: normalizedKeyword,
      engine: target.engine,
      domain: target.domain,
      location: normalizedLocation || null,
      results: verification.results,
      meta: {
        screenshotMode: true,
        aiMode: false,
        aiProvider: screenshotResult.aiProvider || null,
        aiModel: screenshotResult.aiModel || null,
        selectedProviderId: 'screenshot-ai-serp',
        selectedProviderName: 'Screenshot AI OCR',
        redirectsVerified: verifyUrlsEnabled,
        verification: verification.stats,
        screenshotImageDataUrl: screenshotResult.screenshotImageDataUrl || null,
        blockedByEngine: Boolean(screenshotResult.blockedByEngine),
      },
    };

    if (debugEnabled) {
      response.debug = {
        prompt: screenshotResult.debugPrompt || 'Screenshot OCR mode',
        providerAttempts: [],
        normalizedResultCount: normalizedResults.length,
        screenshotUrl: screenshotResult.screenshotUrl || null,
        screenshotImageDataUrl: screenshotResult.screenshotImageDataUrl || null,
        usedDomFallback: Boolean(screenshotResult.usedDomFallback),
        blockedByEngine: Boolean(screenshotResult.blockedByEngine),
      };
    }

    return response;
  }

  if (localAgentModeEnabled) {
    const queuedJob = createJob({
      keyword: normalizedKeyword,
      engine: target.engine,
      searchDomain: target.host,
      country: target.country,
      location: normalizedLocation || null,
      requestedAt: new Date().toISOString(),
    });

    const completedJob = await waitForJob(queuedJob.id);
    if (!completedJob) {
      throw createServiceError('Local PC SERP job could not be loaded.', 500);
    }

    if (completedJob.status === 'timeout') {
      throw createServiceError(
        'Local PC agent did not respond in time. Keep your local agent running and try again.',
        504
      );
    }

    if (completedJob.status === 'failed') {
      const failReason = completedJob.error?.message || 'Local PC agent failed.';
      throw createServiceError(failReason, 502);
    }

    const localResult = completedJob.result || {};
    const normalizedResults = normalizeSearchResults(localResult.results || [], 10);
    const verification = await verifySearchResults(normalizedResults, {
      enabled: verifyUrlsEnabled,
    });

    const response = {
      keyword: normalizedKeyword,
      engine: target.engine,
      domain: target.domain,
      location: normalizedLocation || null,
      results: verification.results,
      meta: {
        localAgentMode: true,
        aiMode: false,
        selectedProviderId: 'local-pc-agent',
        selectedProviderName: 'Local PC Agent',
        redirectsVerified: verifyUrlsEnabled,
        verification: verification.stats,
        screenshotImageDataUrl: localResult.screenshotImageDataUrl || null,
        blockedByEngine: Boolean(localResult.blockedByEngine),
      },
    };

    if (debugEnabled) {
      response.debug = {
        prompt: 'Local PC Agent mode uses your own machine browser for SERP capture.',
        providerAttempts: [],
        normalizedResultCount: normalizedResults.length,
        screenshotUrl: localResult.screenshotUrl || null,
        screenshotImageDataUrl: localResult.screenshotImageDataUrl || null,
        blockedByEngine: Boolean(localResult.blockedByEngine),
        localAgentJobId: queuedJob.id,
        localAgentDebug: localResult.debug || null,
      };
    }

    return response;
  }

  if (aiModeEnabled) {
    const aiResult = await analyzeSERPWithAI(normalizedKeyword, {
      engine: target.engine,
      searchDomain: target.host,
      country: target.country,
      location: normalizedLocation,
      numResults: 10,
    });

    const normalizedResults = normalizeSearchResults(aiResult.results || [], 10);
    const verification = await verifySearchResults(normalizedResults, {
      enabled: verifyUrlsEnabled,
    });

    const response = {
      keyword: normalizedKeyword,
      engine: target.engine,
      domain: target.domain,
      location: normalizedLocation || null,
      results: verification.results,
      meta: {
        aiMode: true,
        aiProvider: aiResult.aiProvider || null,
        aiModel: aiResult.aiModel || null,
        selectedProviderId: 'ai-serp',
        selectedProviderName: aiResult.aiProvider || 'AI SERP',
        redirectsVerified: verifyUrlsEnabled,
        verification: verification.stats,
      },
    };

    if (debugEnabled) {
      response.debug = {
        prompt: 'AI SERP mode uses backend aiSerpService structured prompt.',
        providerAttempts: [],
        normalizedResultCount: normalizedResults.length,
      };
    }

    return response;
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

  let providerResponse;
  let providerAttempts = [];

  try {
    providerResponse = await provider.search({
      keyword: normalizedKeyword,
      target,
      numResults: 10,
      location: normalizedLocation,
      providerId: normalizedProviderId || undefined,
      strictMode: strictModeEnabled,
      prompt,
    });
  } catch (err) {
    if (!isOnlyLocalBlockedFailure(err)) {
      throw err;
    }

    providerAttempts = Array.isArray(err.attempts) ? err.attempts : [];
    providerResponse = {
      results: [],
      meta: {
        selectedProviderId: 'local-pc-agent',
        selectedProviderName: 'Local PC Agent',
        attempts: providerAttempts,
        blockedByEngine: true,
      },
    };
  }
  const providerResults = Array.isArray(providerResponse)
    ? providerResponse
    : (providerResponse?.results || []);
  const providerMeta = providerResponse?.meta || null;
  if (providerAttempts.length === 0 && Array.isArray(providerMeta?.attempts)) {
    providerAttempts = providerMeta.attempts;
  }

  const normalizedResults = normalizeSearchResults(providerResults, 10);
  const verification = await verifySearchResults(normalizedResults, {
    enabled: verifyUrlsEnabled,
  });
  const results = verification.results;

  const meta = {
    aiMode: false,
    highAccuracyMode: accuracyModeEnabled,
    strictMode: strictModeEnabled,
    providerLock: normalizedProviderId || null,
    selectedProviderId: providerMeta?.selectedProviderId || null,
    selectedProviderName: providerMeta?.selectedProviderName || null,
    redirectsVerified: verifyUrlsEnabled,
    verification: verification.stats,
    blockedByEngine: Boolean(providerMeta?.blockedByEngine),
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
      providerAttempts,
      normalizedResultCount: normalizedResults.length,
    };
  }

  return response;
}

module.exports = {
  runSearch,
};
