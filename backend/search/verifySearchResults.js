const axios = require('axios');

function extractWebsiteTitle(html) {
  const text = String(html || '');
  const match = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) {
    return '';
  }

  return match[1]
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function normalizeFinalUrl(value, fallbackUrl) {
  const candidate = String(value || fallbackUrl || '').trim();
  if (!candidate) {
    return String(fallbackUrl || '').trim();
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return String(fallbackUrl || '').trim();
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(fallbackUrl || '').trim();
  }
}

async function verifySingleResult(result, timeoutMs) {
  const fallback = {
    ...result,
    websiteTitle: '',
    resolvedUrl: String(result.url || ''),
    verified: false,
    verifyError: null,
  };

  try {
    const response = await axios.get(result.url, {
      timeout: timeoutMs,
      maxRedirects: 6,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: [(data) => data],
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SERP-Accuracy-Validator/1.0)',
      },
    });

    const finalUrl = normalizeFinalUrl(
      response?.request?.res?.responseUrl || response?.request?.responseURL || response?.config?.url,
      result.url
    );
    const websiteTitle = extractWebsiteTitle(response?.data);

    return {
      ...result,
      url: finalUrl || result.url,
      resolvedUrl: finalUrl || result.url,
      websiteTitle: websiteTitle || '',
      verified: true,
      verifyError: null,
    };
  } catch (err) {
    return {
      ...fallback,
      verifyError: err.message || 'Verification failed',
    };
  }
}

async function verifySearchResults(results = [], options = {}) {
  const enabled = options.enabled === true;
  const timeoutMs = Number.parseInt(options.timeoutMs, 10) || 12000;

  if (!enabled) {
    return {
      results: Array.isArray(results) ? results : [],
      stats: {
        enabled: false,
        verifiedCount: 0,
        failedCount: 0,
      },
    };
  }

  const list = Array.isArray(results) ? results : [];
  const verified = [];

  for (const result of list) {
    // Keep order identical to SERP positions.
    // Sequential verification is slower but more stable under rate-limits.
    // eslint-disable-next-line no-await-in-loop
    const checked = await verifySingleResult(result, timeoutMs);
    verified.push(checked);
  }

  const verifiedCount = verified.filter((item) => item.verified).length;

  return {
    results: verified,
    stats: {
      enabled: true,
      verifiedCount,
      failedCount: Math.max(0, verified.length - verifiedCount),
    },
  };
}

module.exports = {
  verifySearchResults,
};
