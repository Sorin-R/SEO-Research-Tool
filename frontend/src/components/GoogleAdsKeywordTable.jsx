/**
 * GoogleAdsKeywordTable
 * Displays Google Ads keyword ideas in a sortable, filterable table.
 */

import { useState } from 'react';

export default function GoogleAdsKeywordTable({ ideas = [], keyword, loading = false }) {
  const [sortBy, setSortBy] = useState('avgMonthlySearches');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState('');

  if (loading) {
    return (
      <div className="text-center py-8 text-gray-400">
        <div className="inline-block w-8 h-8 border-4 border-gray-200 border-t-indigo-600 rounded-full animate-spin" />
        <p className="mt-2 text-sm">Fetching keyword ideas from Google Ads...</p>
      </div>
    );
  }

  if (!ideas || ideas.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        No keyword ideas found. Try a different seed keyword.
      </div>
    );
  }

  // Filter ideas
  const filtered = ideas.filter((idea) =>
    idea.keyword.toLowerCase().includes(filter.toLowerCase())
  );

  // Sort ideas
  const sorted = [...filtered].sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];

    // Handle string comparisons
    if (typeof aVal === 'string') {
      aVal = aVal.toLowerCase();
      bVal = bVal.toLowerCase();
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }

    // Numeric comparisons
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ column }) => {
    if (sortBy !== column) return <span className="text-gray-300">⇅</span>;
    return sortDir === 'asc' ? <span className="text-indigo-600">↑</span> : <span className="text-indigo-600">↓</span>;
  };

  return (
    <div className="space-y-4">
      {/* Filter input */}
      <input
        type="text"
        placeholder="Filter keywords..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">
                <button
                  onClick={() => handleSort('keyword')}
                  className="flex items-center gap-1 hover:text-indigo-600"
                >
                  Keyword
                  <SortIcon column="keyword" />
                </button>
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                <button
                  onClick={() => handleSort('avgMonthlySearches')}
                  className="flex items-center justify-end gap-1 hover:text-indigo-600 w-full"
                >
                  Avg Monthly Searches
                  <SortIcon column="avgMonthlySearches" />
                </button>
              </th>
              <th className="px-4 py-3 text-center font-semibold">
                <button
                  onClick={() => handleSort('competition')}
                  className="flex items-center justify-center gap-1 hover:text-indigo-600 w-full"
                >
                  Competition
                  <SortIcon column="competition" />
                </button>
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                <button
                  onClick={() => handleSort('cpc')}
                  className="flex items-center justify-end gap-1 hover:text-indigo-600 w-full"
                >
                  Avg CPC
                  <SortIcon column="cpc" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((idea, i) => (
              <tr key={i} className="hover:bg-indigo-50 transition-colors">
                <td className="px-4 py-3 text-gray-800 font-medium">{idea.keyword}</td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {idea.avgMonthlySearches.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-center">
                  <CompetitionBadge level={idea.competition} />
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
                  ${idea.cpc.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between text-xs text-gray-500 px-1">
        <p>
          Showing <span className="font-semibold">{sorted.length}</span> of{' '}
          <span className="font-semibold">{ideas.length}</span> keywords
        </p>
        {sorted.length > 0 && (
          <div className="flex items-center gap-4 text-right">
            <div>
              Avg Search Volume:{' '}
              <span className="font-semibold text-gray-700">
                {Math.round(sorted.reduce((sum, i) => sum + i.avgMonthlySearches, 0) / sorted.length).toLocaleString()}
              </span>
            </div>
            <div>
              Avg CPC:{' '}
              <span className="font-semibold text-gray-700">
                ${(sorted.reduce((sum, i) => sum + i.cpc, 0) / sorted.length).toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CompetitionBadge({ level }) {
  const styles = {
    LOW: 'bg-green-100 text-green-800 border-green-300',
    MEDIUM: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    HIGH: 'bg-orange-100 text-orange-800 border-orange-300',
    VERY_HIGH: 'bg-red-100 text-red-800 border-red-300',
    UNKNOWN: 'bg-gray-100 text-gray-800 border-gray-300',
  };

  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium border ${styles[level] || styles.UNKNOWN}`}>
      {level?.replace('_', ' ')}
    </span>
  );
}
