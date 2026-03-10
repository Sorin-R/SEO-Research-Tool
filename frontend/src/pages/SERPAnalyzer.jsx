import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import SearchBar from '../components/SearchBar';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import StatCard from '../components/StatCard';
import ScoreBadge from '../components/ScoreBadge';
import { analyzeSERP } from '../services/api';

export default function SERPAnalyzer() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSearch(keyword) {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeSERP(keyword);
      setData(result);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
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

      <SearchBar onSearch={handleSearch} loading={loading} placeholder="Enter a keyword to analyze..." />

      {loading && <LoadingSpinner message="Scraping SERP results... This may take a minute." />}
      {error && <div className="mt-6"><ErrorAlert message={error} /></div>}

      {data && !loading && (
        <div className="mt-8 space-y-8">
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
