import { useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import LoadingSpinner from '../components/LoadingSpinner';
import { useWebsiteContext } from '../context/WebsiteContext';
import { getAiSerpHistory, getAiSerpHistoryItem, runAiSerpWorkspace } from '../services/api';

const LLM_PROVIDER_OPTIONS = [
  { id: 'openai', label: 'ChatGPT (OpenAI)' },
  { id: 'gemini', label: 'Gemini (Google)' },
  { id: 'gemini-vertex', label: 'Gemini Vertex (OAuth2)' },
  { id: 'grok', label: 'Grok (xAI)' },
];

function splitKeywords(value) {
  return String(value || '')
    .split(/\n|,/g)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function formatPercent(value) {
  const numeric = Number(value || 0);
  return `${(numeric * 100).toFixed(1)}%`;
}

export default function AiSerpWorkspace() {
  const { selectedWebsiteId, selectedWebsite } = useWebsiteContext();

  const [keywordsInput, setKeywordsInput] = useState('');
  const [providers, setProviders] = useState(['openai', 'gemini', 'grok']);
  const [location, setLocation] = useState('');
  const [maxKeywords, setMaxKeywords] = useState(15);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const canRun = Boolean(selectedWebsiteId);

  useEffect(() => {
    if (!selectedWebsiteId) {
      setHistory([]);
      return;
    }

    let active = true;
    setHistoryLoading(true);
    setHistoryError('');

    getAiSerpHistory(selectedWebsiteId, 20)
      .then((rows) => {
        if (!active) return;
        setHistory(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        if (!active) return;
        setHistoryError(err?.response?.data?.error || err?.message || 'Failed to load AI SERP history.');
      })
      .finally(() => {
        if (active) {
          setHistoryLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedWebsiteId]);

  const runSummary = useMemo(() => {
    if (!result) {
      return null;
    }

    return {
      keywords: Number(result.keywordCount || 0),
      processed: Number(result.processedKeywords || 0),
      failed: Array.isArray(result.failedKeywords) ? result.failedKeywords.length : 0,
      totalCitations: Number(result.totalCitations || 0),
      myCitations: Number(result.myCitations || 0),
      citationShare: formatPercent(result.citationShare || 0),
      promptsWithMentions: Number(result.promptsWithMentions || 0),
      averageBestRank: result.averageBestRank != null ? Number(result.averageBestRank).toFixed(2) : 'N/A',
    };
  }, [result]);

  async function handleRun(event) {
    event.preventDefault();
    if (!selectedWebsiteId) {
      setError('Select a website first.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const payload = await runAiSerpWorkspace({
        websiteId: selectedWebsiteId,
        keywords: splitKeywords(keywordsInput),
        providers,
        location,
        maxKeywords,
      });

      setResult(payload);
      const refreshedHistory = await getAiSerpHistory(selectedWebsiteId, 20);
      setHistory(Array.isArray(refreshedHistory) ? refreshedHistory : []);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to run AI SERP scan.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadHistory(runId) {
    if (!selectedWebsiteId || !runId) return;

    setHistoryError('');
    try {
      const historyItem = await getAiSerpHistoryItem(runId, selectedWebsiteId);
      if (historyItem?.result) {
        setResult(historyItem.result);
      }
    } catch (err) {
      setHistoryError(err?.response?.data?.error || err?.message || 'Failed to load saved run.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">AI SERP Workspace</h2>
        <p className="text-sm text-gray-500">
          Run LLM ranking/citation scans across ChatGPT, Gemini, and Grok for the selected website.
        </p>
      </div>

      {!canRun ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Select a website from the sidebar scope selector first.
        </div>
      ) : null}

      <form onSubmit={handleRun} className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <input
            type="text"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Location (optional)"
            className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
            disabled={loading}
          />
          <input
            type="number"
            min={1}
            max={25}
            value={maxKeywords}
            onChange={(event) => setMaxKeywords(Number(event.target.value) || 15)}
            className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
            disabled={loading}
          />
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">LLM providers</p>
          <div className="grid gap-2 md:grid-cols-3">
            {LLM_PROVIDER_OPTIONS.map((option) => (
              <label key={option.id} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={providers.includes(option.id)}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setProviders((current) => [...new Set([...current, option.id])]);
                    } else {
                      setProviders((current) => current.filter((item) => item !== option.id));
                    }
                  }}
                  disabled={loading}
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>

        <textarea
          value={keywordsInput}
          onChange={(event) => setKeywordsInput(event.target.value)}
          placeholder="Optional custom keywords (newline or comma-separated). Leave empty to use tracked keywords."
          rows={4}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
          disabled={loading}
        />

        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Leave keywords empty to run against tracked keywords for {selectedWebsite?.domain || 'selected site'}.
          </p>

          <button
            type="submit"
            disabled={loading || !canRun || providers.length === 0}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? 'Running LLM Scan...' : 'Run LLM Ranking Scan'}
          </button>
        </div>
      </form>

      {error ? <ErrorAlert message={error} /> : null}

      {runSummary ? (
        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard title="Citation Share" value={runSummary.citationShare} subtitle={`${runSummary.myCitations} / ${runSummary.totalCitations} citations`} />
          <MetricCard title="Prompts With Mentions" value={String(runSummary.promptsWithMentions)} subtitle={`${runSummary.processed} provider-prompts processed`} />
          <MetricCard title="Average Best Rank" value={String(runSummary.averageBestRank)} subtitle="Across prompts with mentions" />
          <MetricCard title="Failed Prompts" value={String(runSummary.failed)} subtitle={`Run keywords: ${runSummary.keywords}`} />
        </div>
      ) : null}

      {result?.failedKeywords?.length ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {result.failedKeywords.length} keywords failed during this run.
        </div>
      ) : null}

      {result?.providersUsed?.length ? (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="border-b border-gray-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Provider Summary</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Provider</th>
                  <th className="px-4 py-3 text-left">Model</th>
                  <th className="px-4 py-3 text-left">Prompts</th>
                  <th className="px-4 py-3 text-left">My/Total Citations</th>
                  <th className="px-4 py-3 text-left">Citation Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.providersUsed.map((item) => (
                  <tr key={`${item.providerId}-${item.model || ''}`}>
                    <td className="px-4 py-3 text-gray-900">{item.providerName || item.providerId}</td>
                    <td className="px-4 py-3 text-gray-700">{item.model || 'N/A'}</td>
                    <td className="px-4 py-3 text-gray-700">{item.prompts}</td>
                    <td className="px-4 py-3 text-gray-700">{item.myCitations} / {item.citations}</td>
                    <td className="px-4 py-3 text-gray-700">{formatPercent(item.citationShare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {result?.keywordReports?.length ? (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="border-b border-gray-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Keyword Citation Results</h3>
            <p className="mt-1 text-xs text-gray-500">
              Website: {selectedWebsite?.domain || 'N/A'} · Mode: LLM ranking by provider
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Provider</th>
                  <th className="px-4 py-3 text-left">Keyword</th>
                  <th className="px-4 py-3 text-left">Best Rank</th>
                  <th className="px-4 py-3 text-left">My Citations</th>
                  <th className="px-4 py-3 text-left">Citation Share</th>
                  <th className="px-4 py-3 text-left">Competitor Density</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.keywordReports.map((item) => (
                  <tr key={`${item.providerId || 'provider'}-${item.keyword}`}>
                    <td className="px-4 py-3 text-gray-700">
                      {item.providerName || item.providerId || 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-gray-900">{item.keyword}</td>
                    <td className="px-4 py-3 text-gray-700">{item.bestCitationRank ?? 'N/A'}</td>
                    <td className="px-4 py-3 text-gray-700">{item.myCitations} / {item.citations}</td>
                    <td className="px-4 py-3 text-gray-700">{formatPercent(item.citationShare)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatPercent(item.competitorDensity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Recent AI SERP Runs</h3>

        {historyLoading ? (
          <div className="mt-3"><LoadingSpinner message="Loading AI SERP history..." /></div>
        ) : null}
        {historyError ? <p className="mt-3 text-sm text-red-600">{historyError}</p> : null}

        {!historyLoading && !historyError && history.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No runs yet for this website.</p>
        ) : null}

        {!historyLoading && history.length > 0 ? (
          <ul className="mt-3 divide-y divide-gray-100">
            {history.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {item.search_domain || 'llm-ranking'} · {item.country}
                  </p>
                  <p className="text-xs text-gray-500">
                    {item.keyword_count} keywords · {item.my_citations}/{item.total_citations} citations · {new Date(item.created_at).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleLoadHistory(item.id)}
                  className="rounded-md border border-indigo-200 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                >
                  Load
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtitle }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
    </div>
  );
}
