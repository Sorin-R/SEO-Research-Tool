import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

const HELP_CONTENT = {
  '/': {
    title: 'Dashboard',
    summary: 'Aggregates KPI modules for the selected website scope and date range.',
    howItWorks: [
      'Pulls the latest saved module data (traffic, keywords, rankings, audits, AI visibility).',
      'Applies website/country/date filters from the header.',
      'Shows KPI cards and module tables based on available datasets.',
    ],
    extraction: [
      'Does not crawl directly from this screen; it reads data already collected by tool modules.',
      'If a source is unavailable, it shows modeled/estimated values where supported.',
    ],
  },
  '/websites': {
    title: 'Websites',
    summary: 'Creates and manages tracked websites/projects for all modules.',
    howItWorks: [
      'Adds website records with domain, project name, country, and optional tags.',
      'Lets you update, archive, and switch active website scope.',
      'Used as the primary scope key for rankings, keywords, and dashboard modules.',
    ],
    extraction: [
      'No SERP crawl here; this page stores website metadata used by other tools.',
    ],
  },
  '/keywords': {
    title: 'Keyword Research',
    summary: 'Generates, filters, clusters, and scores keyword opportunities.',
    howItWorks: [
      'Expands seed keyword ideas with internal heuristics and external suggestion sources.',
      'Applies include/exclude, intent, and strategy filters.',
      'Ranks keywords by priority/opportunity and lets you track or save to lists.',
    ],
    extraction: [
      'Reads keyword suggestions from configured sources and optional AI filter pass.',
      'SERP enrichment metrics are computed from fetched top results when enabled.',
    ],
  },
  '/competitor-keywords': {
    title: 'Competitor Keywords',
    summary: 'Extracts keyword patterns from competitor domains.',
    howItWorks: [
      'Takes one or more competitor sites and scans their visible keyword signals.',
      'Normalizes and deduplicates terms, then scores/sorts output.',
      'Supports tracking and saving selected terms.',
    ],
    extraction: [
      'Collects terms from competitor page content/metadata and related SERP signals.',
    ],
  },
  '/google-ads': {
    title: 'Google Ads Keywords',
    summary: 'Fetches keyword ideas and competition metrics from Google Ads integration.',
    howItWorks: [
      'Runs keyword-idea requests for seed terms and country.',
      'Displays CPC/competition metrics and suggestion lists.',
      'Allows Save to List and Track actions on selected ideas.',
    ],
    extraction: [
      'Data is retrieved from Google Ads API responses using configured credentials.',
    ],
  },
  '/serp': {
    title: 'SERP Analyzer',
    summary: 'Runs SERP analysis for target keyword/engine/country and syncs rank signals.',
    howItWorks: [
      'Queries active SERP providers in configured priority/fallback order.',
      'Normalizes top results and stores snapshots/history.',
      'Can sync matching results into Rank Tracker data.',
    ],
    extraction: [
      'Uses configured SERP providers and provider credentials on the backend.',
      'Stores normalized rank rows in database/local store.',
    ],
  },
  '/search': {
    title: 'SERP Screenshot',
    summary: 'Runs Local PC Agent SERP capture with screenshot evidence.',
    howItWorks: [
      'Queues a local-agent job for your machine/browser session.',
      'Agent captures visible SERP and extracts organic results from page DOM.',
      'Stores screenshot + extracted rows and lets you reload saved runs.',
    ],
    extraction: [
      'Uses your local browser/IP, not third-party SERP APIs.',
      'If blocked by consent/captcha, the run is marked blocked and returns screenshot evidence for debugging.',
    ],
  },
  '/ai-serp': {
    title: 'SERP AI Ranking',
    summary: 'Compares citation/ranking visibility across selected LLM providers.',
    howItWorks: [
      'Runs provider prompts per keyword for OpenAI, Gemini, and Grok.',
      'Normalizes returned cited URLs into ranking rows.',
      'Computes my citations, citation share, competitor density, and best rank.',
    ],
    extraction: [
      'Data is extracted from LLM responses/citations, not direct Google/Bing raw SERP.',
      'Provider failures (auth/rate/billing) are tracked per keyword/provider.',
    ],
  },
  '/analyze': {
    title: 'Content Analyzer',
    summary: 'Scores content quality/SEO checks and gives improvement guidance.',
    howItWorks: [
      'Analyzes supplied URL/content for structure, readability, and SEO fields.',
      'Runs rule-based checks and computed scoring.',
      'Highlights issues and optimization opportunities.',
    ],
    extraction: [
      'Extracts content from provided page input/URL and evaluates with local rules plus optional AI.',
    ],
  },
  '/trends': {
    title: 'Google Trends',
    summary: 'Shows trend interest over time and related queries/topics.',
    howItWorks: [
      'Requests trends time-series and related entities for selected geo/time.',
      'Renders trend curves and related expansions.',
      'Supports compare mode for multiple terms.',
    ],
    extraction: [
      'Data is pulled from Google Trends integration endpoints on the backend.',
    ],
  },
  '/rank-tracker': {
    title: 'Rank Tracker',
    summary: 'Tracks saved keywords across websites with history and scheduled checks.',
    howItWorks: [
      'Stores tracked keywords by website and country.',
      'Runs manual or scheduled checks and writes rank history.',
      'Displays latest rank, movement, and history charts/tables.',
    ],
    extraction: [
      'Rank rows are extracted from SERP provider responses or local-agent checks.',
      'All ranks are normalized to comparable position format.',
    ],
  },
  '/site-audit': {
    title: 'Site Audit',
    summary: 'Crawls pages and reports technical SEO issues with severity.',
    howItWorks: [
      'Crawls target site pages and runs technical checks.',
      'Flags issues like missing metadata, broken links, canonical/noindex/robots/sitemap problems.',
      'Computes site health score from weighted issue counts.',
    ],
    extraction: [
      'Data comes from on-page HTML extraction and link crawl graph analysis.',
    ],
  },
  '/providers': {
    title: 'SERP Providers',
    summary: 'Configures API credentials and toggles for SERP data providers.',
    howItWorks: [
      'Save provider credentials and enable/disable each provider.',
      'Provider order/fallback determines which source handles search requests.',
      'Usage counters update as providers are consumed.',
    ],
    extraction: [
      'No extraction on this page; it manages backend provider connectivity used by SERP tools.',
    ],
  },
  '/backlink-providers': {
    title: 'Backlink Providers',
    summary: 'Configures backlink data source credentials and availability.',
    howItWorks: [
      'Stores and validates backlink provider credentials.',
      'Controls which provider is active for backlink scans.',
      'Feeds backlink modules with provider responses.',
    ],
    extraction: [
      'No direct crawl here; extraction happens during backlink scan requests.',
    ],
  },
  '/ai-providers': {
    title: 'AI Providers',
    summary: 'Configures AI keys/models and tests provider connectivity.',
    howItWorks: [
      'Save credentials and select model per AI provider.',
      'Enable/disable provider availability for AI-powered modules.',
      'Use Test API button to validate selected model + credentials.',
    ],
    extraction: [
      'No analysis extraction here; this page controls upstream AI runtimes used by other tools.',
    ],
  },
  '/gsc-providers': {
    title: 'GSC Providers',
    summary: 'Connects Google Search Console OAuth credentials and site mapping.',
    howItWorks: [
      'Stores OAuth client/refresh credentials and default site URL.',
      'Tests property access and reports site match status.',
      'Enables real GSC traffic/query data where available.',
    ],
    extraction: [
      'Data is extracted from Search Console API for verified properties only.',
    ],
  },
};

const DEFAULT_HELP = {
  title: 'Page Help',
  summary: 'This page does not have a dedicated tool note yet.',
  howItWorks: [
    'Use this popup to understand what this page does and where data comes from.',
  ],
  extraction: [
    'Data extraction details depend on the active module and configured providers.',
  ],
};

export default function PageHelpPanel() {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const help = useMemo(
    () => HELP_CONTENT[location.pathname] || DEFAULT_HELP,
    [location.pathname]
  );

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 top-1/2 z-40 -translate-y-1/2 rounded-l-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-medium text-indigo-700 shadow-sm hover:bg-indigo-50"
      >
        How this page works
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{help.title}</h3>
                <p className="mt-1 text-sm text-gray-600">{help.summary}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <section>
                <h4 className="text-sm font-semibold text-gray-900">How the tool works</h4>
                <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
                  {help.howItWorks.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>

              <section>
                <h4 className="text-sm font-semibold text-gray-900">How data is extracted</h4>
                <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
                  {help.extraction.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
