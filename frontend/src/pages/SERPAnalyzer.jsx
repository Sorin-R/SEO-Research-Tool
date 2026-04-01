import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import StatCard from '../components/StatCard';
import ScoreBadge from '../components/ScoreBadge';
import {
  analyzeSERP,
  deleteSERPAnalysisHistoryItem,
  getSERPAnalysisHistory,
  getSERPAnalysisHistoryItem,
} from '../services/api';
import { SERP_COUNTRIES } from '../constants/serpCountries';

const STORAGE_KEY = 'seo-tool:serp-analyzer:last-session';
const RANK_TRACKER_SYNC_KEY = 'seo-tool:rank-tracker:sync-event';
const HISTORY_LIMIT = 10;
const SEARCH_ENGINES = [
  { value: 'google', label: 'Google' },
  { value: 'bing', label: 'Bing' },
];
const GOOGLE_DOMAINS = [
  'google.com',
  'google.co.uk',
  'google.ca',
  'google.com.au',
  'google.co.in',
  'google.de',
  'google.fr',
  'google.es',
  'google.it',
];

export default function SERPAnalyzer() {
  const [keyword, setKeyword] = useState('');
  const [country, setCountry] = useState('US');
  const [engine, setEngine] = useState('google');
  const [searchDomain, setSearchDomain] = useState('google.com');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [liveRefreshing, setLiveRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const [loadingHistoryId, setLoadingHistoryId] = useState(null);
  const [deletingHistoryId, setDeletingHistoryId] = useState(null);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);

      if (typeof parsed.keyword === 'string') {
        setKeyword(parsed.keyword);
      }

      if (typeof parsed.country === 'string') {
        setCountry(parsed.country);
      }

      if (typeof parsed.engine === 'string') {
        setEngine(parsed.engine === 'bing' ? 'bing' : 'google');
      }

      if (typeof parsed.searchDomain === 'string') {
        setSearchDomain(parsed.searchDomain);
      }

      if (parsed.data) {
        setData(parsed.data);
        setRestoreNotice('Restored your last SERP analysis from this browser.');
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setStorageHydrated(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setHistoryLoading(true);
      setHistoryError(null);

      try {
        const result = await getSERPAnalysisHistory(HISTORY_LIMIT);
        if (!cancelled) {
          setHistory(result);
        }
      } catch (err) {
        if (!cancelled) {
          setHistoryError(err.response?.data?.error || err.message);
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }

    if (!data && !keyword.trim()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          keyword,
          country,
          engine,
          searchDomain,
          data,
          savedAt: new Date().toISOString(),
        })
      );
    } catch {
      // Ignore storage quota issues.
    }
  }, [country, data, engine, keyword, searchDomain, storageHydrated]);

  async function refreshHistory() {
    try {
      const result = await getSERPAnalysisHistory(HISTORY_LIMIT);
      setHistory(result);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(err.response?.data?.error || err.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleSearch(searchKeyword = keyword.trim(), options = {}) {
    if (!searchKeyword) return;

    const forceRefresh = !!options.forceRefresh;
    setLoading(true);
    setLiveRefreshing(forceRefresh);
    setError(null);
    setRestoreNotice(null);
    try {
      const result = await analyzeSERP(
        searchKeyword,
        forceRefresh,
        country,
        true,
        {
          engine,
          searchDomain: engine === 'bing' ? 'bing.com' : searchDomain,
        }
      );
      setData(result);
      setKeyword(result.keyword || searchKeyword);
      setCountry(result.country || country);
      setEngine(result.engine === 'bing' ? 'bing' : engine);
      setSearchDomain(result.searchDomain || searchDomain);
      setRestoreNotice(buildSERPNotice(result, forceRefresh));
      notifyRankTrackerSync(result);
      await refreshHistory();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
      setLiveRefreshing(false);
    }
  }

  async function handleLoadHistory(id) {
    setLoadingHistoryId(id);
    setError(null);

    try {
      const result = await getSERPAnalysisHistoryItem(id);
      setData(result);
      setKeyword(result.keyword || '');
      setCountry(result.country || 'US');
      setEngine(result.engine === 'bing' ? 'bing' : 'google');
      setSearchDomain(result.searchDomain || 'google.com');
      setRestoreNotice('Loaded a saved SERP analysis from history.');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoadingHistoryId(null);
    }
  }

  async function handleDeleteHistory(id) {
    setDeletingHistoryId(id);
    setHistoryError(null);
    setError(null);

    try {
      await deleteSERPAnalysisHistoryItem(id);
      setHistory((current) => current.filter((item) => String(item.id) !== String(id)));

      if (String(data?.historyId) === String(id)) {
        setData(null);
        setRestoreNotice(null);
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch (err) {
      setHistoryError(err.response?.data?.error || err.message);
    } finally {
      setDeletingHistoryId(null);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    handleSearch();
  }

  const avg = data?.averages;
  const diff = data?.difficulty;

  const chartData = data?.results
    ?.filter((r) => !r.error)
    .map((r, i) => ({
      name: `#${i + 1}`,
      words: r.wordCount,
      images: r.imageCount,
    })) || [];

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">SERP Analyzer</h2>
      <p className="text-sm text-gray-500 mb-6">
        Analyze top 10 results by engine/domain and sync tracked ranking data.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 lg:flex-row">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Enter a keyword to analyze..."
          className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          disabled={loading}
        />
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          disabled={loading}
        >
          {SERP_COUNTRIES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>
        <select
          value={engine}
          onChange={(event) => {
            const nextEngine = event.target.value === 'bing' ? 'bing' : 'google';
            setEngine(nextEngine);
            if (nextEngine === 'bing') {
              setSearchDomain('bing.com');
            } else if (searchDomain === 'bing.com') {
              setSearchDomain('google.com');
            }
          }}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          disabled={loading}
        >
          {SEARCH_ENGINES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {engine === 'google' ? (
          <select
            value={searchDomain}
            onChange={(event) => setSearchDomain(event.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            disabled={loading}
          >
            {GOOGLE_DOMAINS.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
        ) : (
          <input
            value="bing.com"
            disabled
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-100 text-gray-500"
          />
        )}
        <button
          type="submit"
          disabled={loading || !keyword.trim()}
          className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading && !liveRefreshing ? 'Searching...' : 'Search'}
        </button>
        <button
          type="button"
          onClick={() => handleSearch(keyword.trim(), { forceRefresh: true })}
          disabled={loading || !keyword.trim()}
          className="px-6 py-2.5 bg-white border border-emerald-200 text-emerald-700 text-sm font-medium rounded-lg hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading && liveRefreshing ? 'Refreshing...' : 'Live Refresh'}
        </button>
      </form>

      <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-gray-900">Recent Saved SERP Analyses</h3>
          <p className="text-sm text-gray-500">
            Your last SERP analysis is restored after refresh in this browser, and recent analyses are also saved to the backend.
          </p>
        </div>

        {historyLoading && <p className="text-sm text-gray-500">Loading saved analyses...</p>}
        {historyError && <ErrorAlert message={historyError} />}

        {!historyLoading && !historyError && history.length === 0 && (
          <p className="text-sm text-gray-500">No saved SERP analyses yet. Run a search and it will appear here.</p>
        )}

        {!historyLoading && history.length > 0 && (
          <div className="space-y-2">
            {history.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 transition-colors hover:border-indigo-300 hover:bg-indigo-50"
              >
                <button
                  type="button"
                  onClick={() => handleLoadHistory(item.id)}
                  disabled={loadingHistoryId === item.id || deletingHistoryId === item.id}
                  className="min-w-0 flex-1 text-left disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-medium text-gray-900">
                        {item.keyword} <span className="text-gray-400">· {item.country_name || item.country}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {item.total_results || 0} results
                        {item.difficulty_score != null ? ` · Difficulty ${item.difficulty_score}` : ''}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {loadingHistoryId === item.id ? 'Loading...' : formatSavedAt(item.updated_at || item.created_at)}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteHistory(item.id)}
                  disabled={loadingHistoryId === item.id || deletingHistoryId === item.id}
                  className="shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-500 hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={`Delete saved SERP analysis for ${item.keyword} in ${item.country_name || item.country}`}
                  title="Delete saved analysis"
                >
                  {deletingHistoryId === item.id ? '...' : 'X'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && <LoadingSpinner message="Scraping SERP results... This may take a minute." />}
      {error && <div className="mt-6"><ErrorAlert message={error} /></div>}

      {data && !loading && (
        <div className="mt-8 space-y-8">
          {restoreNotice && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-5 py-4 text-sm text-emerald-900">
              {restoreNotice}
            </div>
          )}

          <p className="text-sm text-gray-500">
            Scanned country: <span className="font-medium text-gray-700">{data.countryName || country}</span>
            {' · '}Engine: <span className="font-medium text-gray-700">{data.engine === 'bing' ? 'Bing' : 'Google'}</span>
            {' · '}Domain: <span className="font-medium text-gray-700">{data.searchDomain || (data.engine === 'bing' ? 'bing.com' : 'google.com')}</span>
            {data.aiOnly ? ' · Mode: AI-only' : ' · Mode: Standard'}
            {data.aiOnly && data.aiProvider ? ` · AI: ${data.aiProvider}${data.aiModel ? ` (${data.aiModel})` : ''}` : ''}
            {data.savedAt ? ` · Saved ${formatSavedAt(data.savedAt)}` : ''}
          </p>

          {/* Difficulty + Stats overview */}
          <div className="flex items-start gap-6">
            {diff && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 flex flex-col items-center">
                <ScoreBadge score={diff.score} size="lg" />
                <p className="text-sm font-medium text-gray-700 mt-2 capitalize">
                  {diff.level?.replace('_', ' ')}
                </p>
                {diff.recommendation && (
                  <p className="text-xs text-gray-500 mt-2 text-center max-w-xs">
                    {diff.recommendation}
                  </p>
                )}
              </div>
            )}

            {avg && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-1">
                <StatCard label="Avg Word Count" value={avg.avgWordCount} />
                <StatCard label="Avg Title Length" value={`${avg.avgTitleLength} chars`} />
                <StatCard label="Avg Images" value={avg.avgImages} />
                <StatCard label="Keyword in Title" value={`${avg.keywordInTitleRatio}%`} />
              </div>
            )}
          </div>

          {/* Word count chart */}
          {chartData.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Word Count by Position</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="words" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Results table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <h3 className="font-semibold text-gray-900 px-5 py-4 border-b border-gray-200">
              Top {data.results?.length || 0} Results
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Title</th>
                    <th className="px-4 py-3 text-left">URL</th>
                    <th className="px-4 py-3 text-right">Words</th>
                    <th className="px-4 py-3 text-right">Images</th>
                    <th className="px-4 py-3 text-center">KW in Title</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.results?.map((r) => (
                    <tr key={r.position} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-700">{r.position}</td>
                      <td className="px-4 py-3 text-gray-800 max-w-xs truncate" title={r.title || r.pageTitle}>
                        {r.title || r.pageTitle || '—'}
                      </td>
                      <td className="px-4 py-3 text-indigo-600 max-w-xs truncate">
                        <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">
                          {r.url ? new URL(r.url).hostname : '—'}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{r.wordCount || '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{r.imageCount ?? '—'}</td>
                      <td className="px-4 py-3 text-center">
                        {r.keywordInTitle ? (
                          <span className="text-green-600 font-medium">Yes</span>
                        ) : (
                          <span className="text-gray-400">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.fromCache && (
            <p className="text-xs text-gray-400 text-right">
              Served from cache. <button onClick={() => handleSearch(data.keyword)} className="underline hover:text-gray-600">Refresh</button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function formatSavedAt(value) {
  if (!value) {
    return 'Saved recently';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Saved recently';
  }

  return date.toLocaleString();
}

function buildSERPNotice(result, forceRefresh) {
  const sync = result?.rankTrackerSync;

  if (sync?.tracked && sync.updated > 0) {
    const websiteLabel = `${sync.updated} active website${sync.updated === 1 ? '' : 's'}`;
    const matchedLabel = sync.matched > 0
      ? ` ${sync.matched} matched the tracked domain in ${sync.country || 'that'} SERP results.`
      : ' No tracked domains were found in the latest top results.';

    return `${forceRefresh ? 'Fetched live SERP data.' : 'SERP analysis complete.'} Rank Tracker updated for ${websiteLabel}.${matchedLabel}`;
  }

  if (sync?.tracked) {
    if ((sync.activeWebsites || 0) > 0 && (sync.eligibleWebsites || 0) === 0) {
      return `This keyword is in Rank Tracker, but no active tracked websites are set to ${sync.country || 'the selected'} country.`;
    }

    return 'This keyword is in Rank Tracker, but there are no active websites available to update.';
  }

  if (forceRefresh) {
    return 'Fetched live SERP data.';
  }

  return null;
}

function notifyRankTrackerSync(result) {
  if (result?.aiOnly) {
    return;
  }

  if (!result?.rankTrackerSync?.tracked || result.rankTrackerSync.updated <= 0) {
    return;
  }

  try {
    window.localStorage.setItem(
      RANK_TRACKER_SYNC_KEY,
      JSON.stringify({
        keyword: result.keyword,
        country: result.rankTrackerSync.country || result.country || 'US',
        updated: result.rankTrackerSync.updated,
        matched: result.rankTrackerSync.matched,
        syncedAt: new Date().toISOString(),
      })
    );
  } catch {
    // Ignore storage quota issues.
  }
}
