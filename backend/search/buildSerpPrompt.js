const DEFAULT_SERP_PROMPT_TEMPLATE =
  "Search the first page of {engine}.{domain} for the keyword '{keyword}' and return the first 10 organic website results in order, excluding ads where possible.";

function buildSerpPrompt({ keyword, engine, domain }) {
  const normalizedKeyword = String(keyword || '').replace(/\s+/g, ' ').trim();
  const normalizedEngine = String(engine || '').trim().toLowerCase();
  const normalizedDomain = String(domain || '').trim().toLowerCase();

  return DEFAULT_SERP_PROMPT_TEMPLATE
    .replace('{engine}', normalizedEngine)
    .replace('{domain}', normalizedDomain)
    .replace('{keyword}', normalizedKeyword.replace(/'/g, "\\'"));
}

module.exports = {
  DEFAULT_SERP_PROMPT_TEMPLATE,
  buildSerpPrompt,
};
