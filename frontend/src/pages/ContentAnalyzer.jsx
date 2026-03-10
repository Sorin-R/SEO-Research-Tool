import { useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import ScoreBadge from '../components/ScoreBadge';
import StatCard from '../components/StatCard';
import { analyzeContent } from '../services/api';

export default function ContentAnalyzer() {
  const [keyword, setKeyword] = useState('');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [mode, setMode] = useState('url'); // 'url' or 'text'
  const [compareToSerp, setCompareToSerp] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!keyword.trim()) return;
    if (mode === 'url' && !url.trim()) return;
    if (mode === 'text' && !text.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const result = await analyzeContent({
        keyword: keyword.trim(),
        url: mode === 'url' ? url.trim() : undefined,
        text: mode === 'text' ? text.trim() : undefined,
        compareToSerp,
      });
      setData(result);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
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

      {loading && <LoadingSpinner message="Analyzing content..." />}
      {error && <div className="mt-6"><ErrorAlert message={error} /></div>}

      {data && !loading && (
        <div className="mt-8 space-y-6">
          {/* Score + stats */}
          <div className="flex items-start gap-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6 flex flex-col items-center">
              <ScoreBadge score={data.seoScore} label="SEO Score" size="lg" />
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
