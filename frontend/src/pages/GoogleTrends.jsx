import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import SearchBar from '../components/SearchBar';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import { getTrends, getRelatedQueries } from '../services/api';

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

export default function GoogleTrends() {
  const [trendData, setTrendData] = useState(null);
  const [relatedData, setRelatedData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSearch(keyword) {
    setLoading(true);
    setError(null);
    try {
      const [trends, related] = await Promise.all([
        getTrends(keyword),
        getRelatedQueries(keyword),
      ]);
      setTrendData(trends);
      setRelatedData(related);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  const chartData = trendData?.timelineData?.map((p) => ({
    date: p.date,
    interest: p.value,
  })) || [];

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Google Trends</h2>
      <p className="text-sm text-gray-500 mb-6">
        Explore search interest over time, related queries, and rising searches.
      </p>

      <SearchBar onSearch={handleSearch} loading={loading} placeholder="Enter a keyword for trends..." />

      {loading && <LoadingSpinner message="Fetching trends data..." />}
      {error && <div className="mt-6"><ErrorAlert message={error} /></div>}

      {trendData && !loading && (
        <div className="mt-8 space-y-8">
          {/* Interest over time chart */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-1">Interest Over Time</h3>
            <p className="text-xs text-gray-500 mb-4">
              "{trendData.keyword}" — {trendData.geo}
            </p>

            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="interest"
                    stroke={COLORS[0]}
                    strokeWidth={2}
                    dot={false}
                    name="Search Interest"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-gray-400 py-8 text-center">No trend data available.</p>
            )}
          </div>

          {/* Related queries */}
          {relatedData && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Top queries */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Top Related Queries</h3>
                {relatedData.top?.length > 0 ? (
                  <div className="space-y-2">
                    {relatedData.top.slice(0, 15).map((item, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{item.query}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500 rounded-full"
                              style={{ width: `${item.value}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 w-8 text-right">{item.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">No data available.</p>
                )}
              </div>

              {/* Rising queries */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Rising Searches</h3>
                {relatedData.rising?.length > 0 ? (
                  <div className="space-y-2">
                    {relatedData.rising.slice(0, 15).map((item, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{item.query}</span>
                        <span className="text-xs font-medium text-green-600">
                          {item.formattedValue || `+${item.value}%`}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">No rising searches found.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
