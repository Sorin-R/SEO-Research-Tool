import { useState } from 'react';
import SearchBar from '../components/SearchBar';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import { filterKeywordsWithAI, researchKeyword, trackKeyword } from '../services/api';

const DEFAULT_AI_PROMPT =
  'Keep only the keywords that are the closest match to the seed keyword. Remove broad, weak, or loosely related phrases.';

export default function KeywordResearch() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tracked, setTracked] = useState(new Set());
  const [aiPrompt, setAiPrompt] = useState(DEFAULT_AI_PROMPT);
  const [aiMaxResults, setAiMaxResults] = useState(100);
  const [aiData, setAiData] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  async function handleSearch(keyword) {
    setLoading(true);
    setError(null);
    setAiData(null);
    setAiError(null);
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

  async function handleAiFilter() {
    if (!data?.keyword || !data?.allSuggestions?.length) {
      return;
    }

    setAiLoading(true);
    setAiError(null);

    try {
      const result = await filterKeywordsWithAI({
        keyword: data.keyword,
        keywords: data.allSuggestions,
        prompt: aiPrompt,
        maxResults: aiMaxResults,
      });
      setAiData(result);
    } catch (err) {
      setAiError(err.response?.data?.error || err.message);
    } finally {
      setAiLoading(false);
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
          <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 text-sm text-gray-600">
            Found <span className="font-semibold text-gray-900">{data.totalSuggestions || data.allSuggestions?.length || 0}</span> keyword suggestions
            {data.deepScan ? ' using deep scan' : ''}
            {data.reachedTarget ? ' (1000+ target reached).' : '.'}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
            <div className="flex flex-col gap-1">
              <h3 className="font-semibold text-gray-900">AI Keyword Filter</h3>
              <p className="text-sm text-gray-500">
                Tell the AI what you are trying to rank for, and it will keep only the keywords that best match that goal.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">AI Instructions</label>
              <textarea
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                rows={4}
                placeholder="Explain the business, search intent, target audience, and how tightly the keywords should match the seed keyword."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              />
            </div>

            <div className="flex flex-col gap-4 md:flex-row md:items-end">
              <div className="w-full md:w-48">
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Results</label>
                <input
                  type="number"
                  min="5"
                  max="250"
                  value={aiMaxResults}
                  onChange={(event) => setAiMaxResults(event.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <button
                type="button"
                onClick={handleAiFilter}
                disabled={aiLoading || !data.allSuggestions?.length}
                className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {aiLoading ? 'Filtering...' : 'Filter Keywords with AI'}
              </button>
            </div>

            <p className="text-xs text-gray-500">
              This runs after the keyword scrape and requires <code>OPENAI_API_KEY</code> on the backend.
            </p>

            {aiError && <ErrorAlert message={aiError} />}
          </div>

          {aiLoading && <LoadingSpinner message="Filtering keywords with AI..." />}

          {aiData && !aiLoading && (
            <AIKeywordSection
              data={aiData}
              onTrack={handleTrack}
              tracked={tracked}
            />
          )}

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

function AIKeywordSection({ data, onTrack, tracked }) {
  if (!data?.keywords?.length) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold text-gray-900">
          AI Filtered Keywords <span className="text-sm font-normal text-gray-400">({data.selectedCount})</span>
        </h3>
        <p className="text-sm text-gray-500">
          Reviewed {data.totalCandidates} suggestions in {data.passCount} AI pass{data.passCount === 1 ? '' : 'es'} using {data.model}.
        </p>
      </div>

      {data.summary && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          {data.summary}
        </div>
      )}

      <div className="space-y-3">
        {data.keywords.map((item) => (
          <div
            key={item.keyword}
            className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 md:flex-row md:items-start md:justify-between"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{item.keyword}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-indigo-700 border border-indigo-200">
                  {item.score}/100
                </span>
              </div>
              <p className="text-sm text-gray-600">{item.reason}</p>
            </div>

            <button
              onClick={() => onTrack(item.keyword)}
              className={`shrink-0 self-start text-xs px-2 py-1 rounded transition-colors ${
                tracked.has(item.keyword)
                  ? 'text-green-600 cursor-default bg-white border border-green-200'
                  : 'text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 bg-white border border-indigo-200'
              }`}
              disabled={tracked.has(item.keyword)}
              title={tracked.has(item.keyword) ? 'Tracked' : 'Add to tracker'}
            >
              {tracked.has(item.keyword) ? 'Tracked' : 'Track keyword'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
