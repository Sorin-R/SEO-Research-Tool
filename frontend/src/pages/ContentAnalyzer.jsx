import { useEffect, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import ScoreBadge from '../components/ScoreBadge';
import StatCard from '../components/StatCard';
import {
  analyzeContent,
  deleteContentAnalysisHistoryItem,
  getContentAnalysisHistory,
  getContentAnalysisHistoryItem,
} from '../services/api';

const STORAGE_KEY = 'seo-tool:content-analyzer:last-session';
const HISTORY_LIMIT = 10;

export default function ContentAnalyzer() {
  const [keyword, setKeyword] = useState('');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [mode, setMode] = useState('url'); // 'url' or 'text'
  const [compareToSerp, setCompareToSerp] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
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

      if (typeof parsed.keyword === 'string') setKeyword(parsed.keyword);
      if (typeof parsed.url === 'string') setUrl(parsed.url);
      if (typeof parsed.text === 'string') setText(parsed.text);
      if (parsed.mode === 'url' || parsed.mode === 'text') setMode(parsed.mode);
      if (typeof parsed.compareToSerp === 'boolean') setCompareToSerp(parsed.compareToSerp);

      if (parsed.data) {
        setData(parsed.data);
        setRestoreNotice('Restored your last content analysis from this browser.');
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
        const result = await getContentAnalysisHistory(HISTORY_LIMIT);
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

    if (!data && !keyword.trim() && !url.trim() && !text.trim()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          keyword,
          url,
          text,
          mode,
          compareToSerp,
          data,
          savedAt: new Date().toISOString(),
        })
      );
    } catch {
      // Ignore storage quota issues.
    }
  }, [compareToSerp, data, keyword, mode, storageHydrated, text, url]);

  async function refreshHistory() {
    try {
      const result = await getContentAnalysisHistory(HISTORY_LIMIT);
      setHistory(result);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(err.response?.data?.error || err.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!keyword.trim()) return;
    if (mode === 'url' && !url.trim()) return;
    if (mode === 'text' && !text.trim()) return;

    setLoading(true);
    setError(null);
    setRestoreNotice(null);
    try {
      const result = await analyzeContent({
        keyword: keyword.trim(),
        url: mode === 'url' ? url.trim() : undefined,
        text: mode === 'text' ? text.trim() : undefined,
        compareToSerp,
      });
      setData(result);
      await refreshHistory();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadHistory(id) {
    setLoadingHistoryId(id);
    setError(null);

    try {
      const result = await getContentAnalysisHistoryItem(id);
      setData(result);
      setKeyword(result.keyword || '');
      setUrl(result.url || '');
      setText(result.inputText || '');
      setMode(result.inputMode === 'text' ? 'text' : 'url');
      setCompareToSerp(!!result.compareToSerp);
      setRestoreNotice('Loaded a saved content analysis from history.');
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
      await deleteContentAnalysisHistoryItem(id);
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

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Content Analyzer</h2>
      <p className="text-sm text-gray-500 mb-6">
        Analyze your content for SEO quality. Paste text or provide a URL.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        {/* Keyword input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Target Keyword</label>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="e.g., vegan cupcakes"
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Mode toggle */}
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={mode === 'url'}
              onChange={() => setMode('url')}
              className="accent-indigo-600"
            />
            Analyze URL
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={mode === 'text'}
              onChange={() => setMode('text')}
              className="accent-indigo-600"
            />
            Paste Text
          </label>
        </div>

        {/* URL or text input */}
        {mode === 'url' ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Article Text</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your article content here..."
              rows={8}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
          </div>
        )}

        {/* Compare to SERP */}
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={compareToSerp}
            onChange={(e) => setCompareToSerp(e.target.checked)}
            className="accent-indigo-600"
          />
          Compare against SERP competitors (slower but finds content gaps)
        </label>

        <button
          type="submit"
          disabled={loading || !keyword.trim()}
          className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Analyzing...' : 'Analyze Content'}
        </button>
      </form>

      <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-gray-900">Recent Saved Content Analyses</h3>
          <p className="text-sm text-gray-500">
            Your last content analysis is restored after refresh in this browser, and recent analyses are also saved to the backend.
          </p>
        </div>

        {historyLoading && <p className="text-sm text-gray-500">Loading saved analyses...</p>}
        {historyError && <ErrorAlert message={historyError} />}

        {!historyLoading && !historyError && history.length === 0 && (
          <p className="text-sm text-gray-500">No saved content analyses yet. Run one and it will appear here.</p>
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
                      <div className="font-medium text-gray-900">{item.keyword}</div>
                      <div className="text-xs text-gray-500">
                        {item.input_mode === 'url'
                          ? item.url || 'URL analysis'
                          : 'Pasted text analysis'}
                        {item.compare_to_serp ? ' · SERP comparison' : ''}
                        {item.seo_score != null ? ` · Score ${item.seo_score}` : ''}
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
                  aria-label={`Delete saved content analysis for ${item.keyword}`}
                  title="Delete saved analysis"
                >
                  {deletingHistoryId === item.id ? '...' : 'X'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && <LoadingSpinner message="Analyzing content..." />}
      {error && <div className="mt-6"><ErrorAlert message={error} /></div>}

      {data && !loading && (
        <div className="mt-8 space-y-6">
          {restoreNotice && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-5 py-4 text-sm text-emerald-900">
              {restoreNotice}
            </div>
          )}

          {/* Score + stats */}
          <div className="flex items-start gap-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6 flex flex-col items-center">
              <ScoreBadge score={data.seoScore} label="SEO Score" size="lg" />
              {data.savedAt && (
                <p className="mt-3 text-xs text-gray-500">
                  Saved {formatSavedAt(data.savedAt)}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-1">
              <StatCard label="Word Count" value={data.wordCount} sub={`Target: ${data.recommendedWordCount}`} />
              <StatCard label="Keyword Density" value={`${data.keywordDensity}%`} sub={`${data.keywordCount} occurrences`} />
              <StatCard label="Headings" value={data.headings.h1 + data.headings.h2 + data.headings.h3} sub={`H1:${data.headings.h1} H2:${data.headings.h2} H3:${data.headings.h3}`} />
              <StatCard label="Images" value={data.imageCount} />
            </div>
          </div>

          {/* Suggestions */}
          {data.suggestions?.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-3">Improvement Suggestions</h3>
              <ul className="space-y-2">
                {data.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-amber-500 mt-0.5">&#9679;</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing topics */}
          {data.missingTopics?.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-3">Missing Topics</h3>
              <p className="text-xs text-gray-500 mb-3">Topics your competitors cover but your content doesn't mention:</p>
              <div className="flex flex-wrap gap-2">
                {data.missingTopics.map((topic) => (
                  <span key={topic} className="bg-red-50 text-red-700 border border-red-200 px-3 py-1 rounded-md text-sm">
                    {topic}
                  </span>
                ))}
              </div>
            </div>
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
