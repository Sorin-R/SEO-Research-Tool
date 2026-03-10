import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import StatCard from '../components/StatCard';
import ScoreBadge from '../components/ScoreBadge';
import { analyzeSERP } from '../services/api';
import { SERP_COUNTRIES } from '../constants/serpCountries';

export default function SERPAnalyzer() {
  const [keyword, setKeyword] = useState('');
  const [country, setCountry] = useState('US');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSearch(searchKeyword = keyword.trim()) {
    if (!searchKeyword) return;

    setLoading(true);
    setError(null);
    try {
      const result = await analyzeSERP(searchKeyword, false, country);
      setData(result);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
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
        Analyze top 10 Google results for any keyword. Get word counts, meta data, and difficulty scores.
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
        <button
          type="submit"
          disabled={loading || !keyword.trim()}
          className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {loading && <LoadingSpinner message="Scraping SERP results... This may take a minute." />}
      {error && <div className="mt-6"><ErrorAlert message={error} /></div>}

      {data && !loading && (
        <div className="mt-8 space-y-8">
          <p className="text-sm text-gray-500">
            Scanned country: <span className="font-medium text-gray-700">{data.countryName || country}</span>
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
