const {
  createJob,
  waitForJob,
  hasRecentAgent,
  getAgentStats,
} = require('../../search/localSerpAgentQueue');

const DEFAULT_PROVIDER_TIMEOUT_MS = Number.parseInt(process.env.LOCAL_SERP_PROVIDER_TIMEOUT_MS || '45000', 10);
const DEFAULT_AGENT_MAX_AGE_MS = Number.parseInt(process.env.LOCAL_SERP_PROVIDER_AGENT_MAX_AGE_MS || '45000', 10);

function normalizeEngine(value) {
  const engine = String(value || '').trim().toLowerCase();
  return engine === 'bing' ? 'bing' : 'google';
}

function normalizeCountry(value) {
  const country = String(value || '').trim().toUpperCase();
  return country === 'GB' ? 'GB' : 'US';
}

function resolveSearchDomain(engine, country, options = {}) {
  const fromOptions = String(options.searchDomain || options.googleDomain || '').trim().toLowerCase();
  if (fromOptions) {
    return fromOptions;
  }

  if (engine === 'bing') {
    return country === 'GB' ? 'bing.co.uk' : 'bing.com';
  }

  return country === 'GB' ? 'google.co.uk' : 'google.com';
}

function normalizeRows(rows, numResults) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, Math.max(1, Number.parseInt(numResults, 10) || 10))
    .map((row, index) => ({
      position: Number.parseInt(row?.position, 10) || (index + 1),
      title: String(row?.title || '').trim(),
      url: String(row?.url || '').trim(),
      snippet: String(row?.snippet || '').trim(),
    }))
    .filter((row) => row.title && row.url);
}

async function search(keyword, numResults = 10, options = {}) {
  const normalizedKeyword = String(keyword || '').replace(/\s+/g, ' ').trim();
  if (!normalizedKeyword) {
    throw new Error('Keyword is required.');
  }

  if (!hasRecentAgent(DEFAULT_AGENT_MAX_AGE_MS)) {
    const agentStats = getAgentStats(DEFAULT_AGENT_MAX_AGE_MS);
    throw new Error(
      `Local PC Agent is offline (online agents: ${agentStats.online}). Start "npm --prefix backend run local-serp-agent".`
    );
  }

  const engine = normalizeEngine(options.engine);
  const country = normalizeCountry(options.country);
  const location = String(options.location || '').replace(/\s+/g, ' ').trim();
  const searchDomain = resolveSearchDomain(engine, country, options);

  const queuedJob = createJob({
    keyword: normalizedKeyword,
    engine,
    searchDomain,
    country,
    location: location || null,
    requestedAt: new Date().toISOString(),
    source: 'serp-provider',
  });

  const completedJob = await waitForJob(queuedJob.id, DEFAULT_PROVIDER_TIMEOUT_MS);
  if (!completedJob) {
    throw new Error('Local PC Agent job was lost before completion.');
  }

  if (completedJob.status === 'timeout') {
    throw new Error('Local PC Agent timed out. Keep agent running and retry.');
  }

  if (completedJob.status === 'failed') {
    throw new Error(completedJob.error?.message || 'Local PC Agent failed.');
  }

  const resolvedRows = normalizeRows(completedJob.result?.results || [], numResults);
  if (resolvedRows.length === 0 && completedJob.result?.blockedByEngine) {
    throw new Error('Local PC Agent was blocked by the search engine page (captcha/consent).');
  }

  return resolvedRows;
}

module.exports = {
  search,
};
