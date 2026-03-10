# Keyword Research Guide

## What the tool does

The `Keyword Research` page helps you turn one seed keyword into a structured keyword plan.

It can:

- generate large autocomplete keyword sets
- cluster keywords by topic and intent
- score keywords by relevance and opportunity
- filter keywords by intent, modifiers, word count, branded terms, and more
- enrich top keywords with SERP signals
- overlay Google Trends data
- find competitor gap keywords
- generate local SEO keyword variants
- save keywords into named lists
- export results to CSV
- create cluster-based content briefs

## Basic workflow

1. Open `Keyword Research`.
2. Enter a seed keyword.
3. Choose the country you want to research.
4. Click `Search`.
5. Review the `Top Opportunities`, `Intent Clusters and Page Targets`, and `All Scored Keywords` sections.

## Best way to use it

### 1. Start with a clear seed keyword

Use a seed keyword that matches the page or service you want to rank.

Examples:

- `ai agency`
- `seo consultant london`
- `b2b lead generation agency`

### 2. Set the research options before searching

Use the controls at the top to shape the output:

- `Country`: research a specific market
- `Target Count`: how many suggestions to try to collect
- `Deep autocomplete scan`: expands the suggestion crawl
- `SERP Enrichment Top N`: checks top results for the best-scoring keywords
- `Trend Overlay Top N`: adds Google Trends signals

### 3. Use filters to tighten the list

You can filter by:

- `Include Terms`
- `Exclude Terms`
- `Modifier Filter`
- `Intent Filters`
- `Min Words` / `Max Words`
- `Branded Filter`
- `Questions only`

Examples:

- Include: `ai, agency`
- Exclude: `jobs, course, salary`
- Modifiers: `best, pricing, vs`

## Advanced features

### Strategy Prompt

Use `Strategy Prompt` to explain what you want the tool to prioritize.

Example:

`Focus on keywords for businesses looking to hire an AI agency. Prioritize commercial and transactional terms, and avoid broad educational searches.`

This helps the scoring and clustering stay closer to the real goal.

### Brand Terms

Add your brand or domain words if you want to separate branded vs non-branded keywords.

Examples:

- `ronins`
- `ronins ai`
- `ronins agency`

### Local SEO

Use:

- `Local SEO Cities`
- `Local SEO Services`

Example:

- Cities: `London, Manchester, Leeds`
- Services: `AI agency, SEO consultant`

This generates extra local variations like:

- `ai agency london`
- `seo consultant in manchester`

### Competitor Gap

Add:

- `Competitor Domains`
- `Target Domain`

The tool then highlights keywords where competitors appear in the SERP and your target domain does not.

Example:

- Competitors: `competitor1.com, competitor2.co.uk`
- Target: `yourdomain.com`

### Trends

Enable `Include Google Trends overlay` if you want the tool to flag:

- rising keywords
- flat keywords
- falling keywords

Use this to avoid investing in weak or declining topics.

## Understanding the results

### Top Opportunities

This is the fastest shortlist.

Each keyword can include:

- intent
- priority score
- opportunity score
- difficulty estimate
- trend direction
- competitor gap flag
- recommended page type

### Intent Clusters and Page Targets

This section groups keywords that should usually live on the same page.

Each cluster shows:

- primary keyword
- intent
- page type recommendation
- grouped keywords
- content brief

Use this to decide:

- which keywords belong on one page
- which keywords need separate pages

### Content Brief

Each cluster can generate a brief with:

- title ideas
- H2 suggestions
- FAQs
- internal link suggestions

Use this when moving from keyword research into content planning.

### All Scored Keywords

This is the full dataset after scoring and filtering.

Use it when you want to:

- inspect everything
- save keywords to a list
- track selected keywords
- export the full set

## Saved Lists

Saved lists help you organize keywords into reusable buckets.

Examples:

- `Blog ideas`
- `Money pages`
- `Low competition`
- `Client A`

Typical workflow:

1. Create a list.
2. Select it as the active list.
3. Save single keywords, top opportunities, or whole clusters into it.

## AI Keyword Filter

Use the AI filter after the scrape if you want a tighter shortlist.

Best use cases:

- remove weak or broad keywords
- keep only buyer-intent terms
- narrow results to a specific audience
- sort keywords around a very specific offer

Example AI prompt:

`Keep only keywords that match businesses actively looking to hire an AI agency. Remove educational, broad, and low-intent keywords.`

## Exporting

Use `Export CSV` to download the current keyword set.

The export includes fields like:

- keyword
- intent
- cluster
- priority score
- opportunity score
- difficulty estimate
- trend direction
- recommended page type
- notes

## Recommended workflow for real use

1. Search a seed keyword.
2. Add include/exclude terms.
3. Filter by intent.
4. Enable SERP enrichment for top keywords.
5. Enable trends if needed.
6. Review `Top Opportunities`.
7. Review `Intent Clusters and Page Targets`.
8. Save the best keywords to lists.
9. Export CSV.
10. Track the final keywords in `Rank Tracker`.

## Troubleshooting

### Too many broad keywords

- add `Include Terms`
- add `Exclude Terms`
- use `Strategy Prompt`
- use the AI filter

### Not enough local keywords

- add more cities
- add more service terms
- keep deep scan enabled

### Competitor gap is empty

- make sure competitor domains are correct
- add your target domain
- enable SERP enrichment

### Trend data is missing

- enable `Include Google Trends overlay`
- lower `Trend Overlay Top N` if requests are failing

### Saving to lists does not work

- create a list first
- select it as the active list

## Quick example

For a company selling AI agency services in the UK:

1. Seed keyword: `ai agency`
2. Country: `GB`
3. Include Terms: `ai, agency`
4. Exclude Terms: `jobs, course, salary`
5. Competitors: add 2-3 competing agency domains
6. Target Domain: your own domain
7. Local Cities: `London, Manchester`
8. Local Services: `AI agency`
9. SERP Enrichment Top N: `5`
10. Trends: `On`

Then:

- save the best clusters to `Money pages`
- save informational clusters to `Blog ideas`
- export CSV
- track the final target terms
