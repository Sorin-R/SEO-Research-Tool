/**
 * GoogleAdsKeywordResearch Page
 * Integrates Google Ads API for keyword research with PPC metrics.
 * Shows:
 * - Keyword ideas
 * - Monthly search volume
 * - Competition levels
 * - Average CPC (Cost Per Click)
 */

import { useState } from 'react';
import SearchBar from '../components/SearchBar';
import GoogleAdsKeywordTable from '../components/GoogleAdsKeywordTable';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import StatCard from '../components/StatCard';
import { getGoogleAdsKeywordIdeas, getGoogleAdsCacheStats, clearGoogleAdsCache } from '../services/api';

export default function GoogleAdsKeywordResearch() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cacheStats, setCacheStats] = useState(null);
  const [lastKeyword, setLastKeyword] = useState('');

  async function handleSearch(keyword) {
    setLoading(true);
    setError(null);
    setLastKeyword(keyword);
    try {
      const result = await getGoogleAdsKeywordIdeas(keyword);
      setData(result);

      // Fetch cache stats
      const stats = await getGoogleAdsCacheStats();
      setCacheStats(stats);
    } catch (err) {
      const errorMsg =
        err.response?.data?.error ||
        err.message ||
        'Failed to fetch keyword ideas from Google Ads API.';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }

  async function handleClearCache() {
    try {
      await clearGoogleAdsCache();
      alert('Cache cleared successfully!');
      setCacheStats({ cacheStats: { size: 0, ttlMinutes: 10 } });
    } catch (err) {
      alert('Failed to clear cache: ' + err.message);
    }
  }

  async function handleBypassCache() {
    if (!data?.keyword) return;
    setLoading(true);
    try {
      const result = await getGoogleAdsKeywordIdeas(data.keyword, true);
      setData(result);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Google Ads Keyword Research</h2>
      <p className="text-sm text-gray-500 mb-6">
        Get keyword ideas with PPC metrics: search volume, competition level, and CPC from Google Ads.
      </p>

      {/* Search */}
      <SearchBar
        onSearch={handleSearch}
        loading={loading}
        placeholder="Enter a seed keyword (e.g., vegan cupcakes)..."
        initialValue={lastKeyword}
      />

      {loading && <LoadingSpinner message="Fetching keyword ideas from Google Ads..." />}
      {error && <div className="mt-6"><ErrorAlert message={error} onRetry={() => handleSearch(lastKeyword)} /></div>}

      {data && !loading && (
        <div className="mt-8 space-y-6">
          {/* Header + Stats */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Keyword Ideas for "{data.keyword}"
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Found <span className="font-semibold text-gray-700">{data.totalIdeas}</span> related keywords
                {data.fromCache && <span className="ml-2 text-indigo-600">(cached)</span>}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              {data.fromCache && (
                <button
                  onClick={handleBypassCache}
                  disabled={loading}
                  className="px-3 py-2 text-xs font-medium text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 rounded-lg transition-colors"
                  title="Fetch fresh data from API"
                >
                  Refresh
                </button>
              )}
              {cacheStats && (
                <button
                  onClick={handleClearCache}
                  className="px-3 py-2 text-xs font-medium text-gray-600 hover:text-gray-700 border border-gray-200 hover:border-gray-300 rounded-lg transition-colors"
                  title="Clear cached results"
                >
                  Clear Cache
                </button>
              )}
            </div>
          </div>

          {/* Quick stats */}
          {data.ideas && data.ideas.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard
                label="Top Search Volume"
                value={Math.max(...data.ideas.map((i) => i.avgMonthlySearches)).toLocaleString()}
                sub={data.ideas.find((i) => i.avgMonthlySearches === Math.max(...data.ideas.map((x) => x.avgMonthlySearches)))?.keyword}
              />
              <StatCard
                label="Avg Search Volume"
                value={Math.round(data.ideas.reduce((sum, i) => sum + i.avgMonthlySearches, 0) / data.ideas.length).toLocaleString()}
              />
              <StatCard
                label="Avg CPC"
                value={`$${(data.ideas.reduce((sum, i) => sum + i.cpc, 0) / data.ideas.length).toFixed(2)}`}
              />
            </div>
          )}

          {/* Keyword table */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <GoogleAdsKeywordTable ideas={data.ideas} keyword={data.keyword} loading={loading} />
          </div>

          {/* Cache info */}
          {cacheStats && (
            <div className="text-xs text-gray-400 text-right">
              <p>Cache: {cacheStats.cacheStats.size} entries • {cacheStats.cacheStats.ttlMinutes}min TTL</p>
            </div>
          )}
        </div>
      )}

      {/* Initial state - show tips */}
      {!data && !loading && (
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">💡 Tips</h3>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Start with broad keywords to get more ideas</li>
            <li>• Competition level: LOW is easier to rank for, HIGH is more competitive</li>
            <li>• CPC indicates advertiser demand (higher CPC = higher intent)</li>
            <li>• Results are cached for 10 minutes to improve performance</li>
            <li>• Requires Google Ads API credentials configured in .env</li>
          </ul>
        </div>
      )}
    </div>
  );
}
