import { useState } from 'react';
import SearchBar from '../components/SearchBar';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import { researchKeyword, trackKeyword } from '../services/api';

export default function KeywordResearch() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tracked, setTracked] = useState(new Set());

  async function handleSearch(keyword) {
    setLoading(true);
    setError(null);
    try {
      const result = await researchKeyword(keyword);
      setData(result);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleTrack(keyword) {
    try {
      await trackKeyword(keyword);
      setTracked((prev) => new Set(prev).add(keyword));
    } catch {
      // Silently fail — keyword may already be tracked
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Keyword Research</h2>
      <p className="text-sm text-gray-500 mb-6">
        Discover related keywords, long-tail variations, and questions people ask.
      </p>

      <SearchBar onSearch={handleSearch} loading={loading} placeholder="Enter a seed keyword..." />

      {loading && <LoadingSpinner message="Fetching keyword suggestions..." />}
      {error && <div className="mt-6"><ErrorAlert message={error} onRetry={() => handleSearch(data?.keyword)} /></div>}

      {data && !loading && (
        <div className="mt-8 space-y-8">
          {/* Related keywords */}
          <KeywordSection
            title="Related Keywords"
            keywords={data.related}
            onTrack={handleTrack}
            tracked={tracked}
          />

          {/* Long-tail keywords */}
          <KeywordSection
            title="Long-Tail Keywords"
            keywords={data.longTail}
            onTrack={handleTrack}
            tracked={tracked}
          />

          {/* Questions */}
          <KeywordSection
            title="Question Keywords"
            keywords={data.questions}
            onTrack={handleTrack}
            tracked={tracked}
          />

          {/* All suggestions */}
          <KeywordSection
            title="All Suggestions"
            keywords={data.allSuggestions}
            onTrack={handleTrack}
            tracked={tracked}
            defaultCollapsed
          />
        </div>
      )}
    </div>
  );
}

function KeywordSection({ title, keywords, onTrack, tracked, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (!keywords || keywords.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <h3 className="font-semibold text-gray-900">
          {title} <span className="text-sm font-normal text-gray-400">({keywords.length})</span>
        </h3>
        <span className="text-gray-400 text-sm">{collapsed ? 'Show' : 'Hide'}</span>
      </button>

      {!collapsed && (
        <div className="px-5 pb-4">
          <div className="flex flex-wrap gap-2">
            {keywords.map((kw) => (
              <div
                key={kw}
                className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-md px-3 py-1.5 text-sm"
              >
                <span className="text-gray-700">{kw}</span>
                <button
                  onClick={() => onTrack(kw)}
                  className={`ml-1 text-xs px-1.5 py-0.5 rounded transition-colors ${
                    tracked.has(kw)
                      ? 'text-green-600 cursor-default'
                      : 'text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50'
                  }`}
                  disabled={tracked.has(kw)}
                  title={tracked.has(kw) ? 'Tracked' : 'Add to tracker'}
                >
                  {tracked.has(kw) ? '✓' : '+'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
