import { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import {
  getTrackedKeywords,
  deleteTrackedKeyword,
  trackKeyword,
  getLatestRankings,
  getRankingHistory,
} from '../services/api';

export default function RankTracker() {
  const [keywords, setKeywords] = useState([]);
  const [rankings, setRankings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [history, setHistory] = useState([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [kws, ranks] = await Promise.all([
        getTrackedKeywords(),
        getLatestRankings().catch(() => []),
      ]);
      setKeywords(kws);
      setRankings(ranks);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    try {
      await trackKeyword(newKeyword.trim());
      setNewKeyword('');
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  async function handleDelete(id) {
    try {
      await deleteTrackedKeyword(id);
      if (selectedId === id) {
        setSelectedId(null);
        setHistory([]);
      }
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  async function handleSelectKeyword(kw) {
    setSelectedId(kw.id);
    setHistoryLoading(true);
    try {
      const h = await getRankingHistory(kw.id, 90);
      setHistory(h);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  const chartData = history.map((r) => ({
    date: r.date,
    position: r.position,
  }));

  // Merge keyword data with latest ranking
  const keywordsWithRank = keywords.map((kw) => {
    const rank = rankings.find((r) => r.keyword_id === kw.id || r.keyword === kw.keyword);
    return { ...kw, latestPosition: rank?.position ?? null, latestDate: rank?.date ?? null };
  });

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Rank Tracker</h2>
      <p className="text-sm text-gray-500 mb-6">
        Track keyword positions over time. Rankings are checked daily at 6:00 AM.
      </p>

      {/* Add keyword form */}
      <form onSubmit={handleAdd} className="flex gap-3 mb-8">
        <input
          type="text"
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
          placeholder="Add a keyword to track..."
          className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={!newKeyword.trim()}
          className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          Add Keyword
        </button>
      </form>

      {loading && <LoadingSpinner message="Loading tracked keywords..." />}
      {error && <ErrorAlert message={error} onRetry={loadData} />}

      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Keyword list */}
          <div className="lg:col-span-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
            <h3 className="font-semibold text-gray-900 px-5 py-4 border-b border-gray-200">
              Tracked Keywords ({keywords.length})
            </h3>

            {keywords.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-8 text-center">
                No keywords tracked yet. Add one above.
              </p>
            ) : (
              <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
                {keywordsWithRank.map((kw) => (
                  <div
                    key={kw.id}
                    className={`flex items-center justify-between px-5 py-3 cursor-pointer transition-colors ${
                      selectedId === kw.id ? 'bg-indigo-50' : 'hover:bg-gray-50'
                    }`}
                    onClick={() => handleSelectKeyword(kw)}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800">{kw.keyword}</p>
                      <p className="text-xs text-gray-400">
                        {kw.latestPosition
                          ? `Position: #${kw.latestPosition}`
                          : 'No ranking data'}
                        {kw.difficulty != null && ` · Difficulty: ${kw.difficulty}`}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(kw.id);
                      }}
                      className="text-gray-300 hover:text-red-500 text-lg transition-colors"
                      title="Remove keyword"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ranking history chart */}
          <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-6">
            {selectedId ? (
              historyLoading ? (
                <LoadingSpinner message="Loading ranking history..." />
              ) : chartData.length > 0 ? (
                <>
                  <h3 className="font-semibold text-gray-900 mb-4">
                    Ranking History — {keywords.find((k) => k.id === selectedId)?.keyword}
                  </h3>
                  <ResponsiveContainer width="100%" height={350}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis reversed domain={[1, 'auto']} label={{ value: 'Position', angle: -90, position: 'insideLeft' }} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="position"
                        stroke="#6366f1"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        name="Position"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <div className="text-center py-16 text-gray-400 text-sm">
                  No ranking history yet. Rankings are recorded daily by the cron job.
                </div>
              )
            ) : (
              <div className="text-center py-16 text-gray-400 text-sm">
                Select a keyword to view ranking history.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
