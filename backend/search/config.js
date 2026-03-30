const ALLOWED_ENGINES = ['google', 'bing'];
const ALLOWED_DOMAINS = ['com', 'co.uk'];

function normalizeEngine(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_ENGINES.includes(normalized) ? normalized : '';
}

function normalizeDomain(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_DOMAINS.includes(normalized) ? normalized : '';
}

function resolveSearchTarget(engine, domain) {
  const normalizedEngine = normalizeEngine(engine);
  const normalizedDomain = normalizeDomain(domain);

  if (!normalizedEngine) {
    return null;
  }

  if (!normalizedDomain) {
    return null;
  }

  return {
    engine: normalizedEngine,
    domain: normalizedDomain,
    host: `${normalizedEngine}.${normalizedDomain}`,
    country: normalizedDomain === 'co.uk' ? 'GB' : 'US',
  };
}

module.exports = {
  ALLOWED_ENGINES,
  ALLOWED_DOMAINS,
  normalizeEngine,
  normalizeDomain,
  resolveSearchTarget,
};
