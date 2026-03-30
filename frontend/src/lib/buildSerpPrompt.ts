export type SerpEngine = 'google' | 'bing';
export type SerpDomain = 'com' | 'co.uk';

export const DEFAULT_SERP_PROMPT_TEMPLATE =
  "Search the first page of {engine}.{domain} for the keyword '{keyword}' and return the first 10 organic website results in order, excluding ads where possible.";

export function buildSerpPrompt({
  keyword,
  engine,
  domain,
}: {
  keyword: string;
  engine: SerpEngine;
  domain: SerpDomain;
}): string {
  const normalizedKeyword = String(keyword || '').replace(/\s+/g, ' ').trim();

  return DEFAULT_SERP_PROMPT_TEMPLATE
    .replace('{engine}', engine)
    .replace('{domain}', domain)
    .replace('{keyword}', normalizedKeyword.replace(/'/g, "\\'"));
}
