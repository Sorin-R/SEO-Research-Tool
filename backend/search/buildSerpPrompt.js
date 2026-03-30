const DEFAULT_SERP_PROMPT_TEMPLATE = [
  'Search page 1 of {{search_engine}} for the keyword "{{keyword}}".',
  '',
  'Task:',
  '- Identify the organic search results shown on page 1.',
  '- Determine the ranking positions exactly as displayed on the search results page.',
  '- Open each result website to verify the final destination URL and website title.',
  '- Return the verified first 10 organic website results in the same ranking order as they appear on the search results page.',
  '',
  'Rules:',
  '- Exclude ads, sponsored results, AI answers, featured snippets, maps, image blocks, video blocks, shopping results, and "people also ask".',
  '- Only use standard organic website listings from the main results area.',
  '- Keep the exact SERP ranking position from the search page.',
  '- Access each listed website to confirm the destination URL.',
  '- If a result redirects, return the final resolved URL.',
  '- Do not change the ranking order after opening the websites.',
  '- Do not include any result that is not visibly present on page 1.',
  '- If fewer than 10 organic results are available, return only those available.',
  '- Do not include commentary or explanation outside the requested output.',
  '',
  'Output JSON format:',
  '{',
  '  "keyword": "{{keyword}}",',
  '  "search_engine": "{{search_engine}}",',
  '  "results": [',
  '    {',
  '      "position": 1,',
  '      "serp_title": "Title as shown on the search results page",',
  '      "website_title": "Title confirmed from the opened website",',
  '      "url": "https://final-destination-url.com"',
  '    }',
  '  ]',
  '}',
].join('\n');

function buildSerpPrompt({ keyword, engine, domain }) {
  const normalizedKeyword = String(keyword || '').replace(/\s+/g, ' ').trim();
  const normalizedEngine = String(engine || '').trim().toLowerCase();
  const normalizedDomain = String(domain || '').trim().toLowerCase();
  const normalizedSearchEngine = `${normalizedEngine}.${normalizedDomain}`.replace(/\.+/g, '.');

  return DEFAULT_SERP_PROMPT_TEMPLATE
    .replaceAll('{{search_engine}}', normalizedSearchEngine)
    .replaceAll('{{keyword}}', normalizedKeyword.replace(/"/g, '\\"'));
}

module.exports = {
  DEFAULT_SERP_PROMPT_TEMPLATE,
  buildSerpPrompt,
};
