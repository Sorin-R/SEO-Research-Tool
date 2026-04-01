import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import {
  compareKeywordTrends,
  getRelatedQueries,
  getRelatedTopics,
  getTrendRegions,
  getTrends,
} from '../services/api';

const LINE_COLORS = ['#4f46e5', '#ef4444', '#10b981', '#f59e0b', '#0ea5e9'];

const COUNTRY_OPTIONS = [
  { value: '', label: 'Worldwide' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'CA', label: 'Canada' },
  { value: 'AU', label: 'Australia' },
  { value: 'IN', label: 'India' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'ES', label: 'Spain' },
  { value: 'IT', label: 'Italy' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'BR', label: 'Brazil' },
  { value: 'MX', label: 'Mexico' },
  { value: 'JP', label: 'Japan' },
  { value: 'KR', label: 'South Korea' },
];

const TIMEFRAME_OPTIONS = [
  { value: 'now 1-H', label: 'Past hour' },
  { value: 'now 4-H', label: 'Past 4 hours' },
  { value: 'now 1-d', label: 'Past day' },
  { value: 'now 7-d', label: 'Past 7 days' },
  { value: 'today 1-m', label: 'Past 30 days' },
  { value: 'today 3-m', label: 'Past 90 days' },
  { value: 'today 12-m', label: 'Past 12 months' },
  { value: 'today 5-y', label: 'Past 5 years' },
  { value: 'all', label: '2004 - Present' },
  { value: 'custom', label: 'Custom range' },
];

const PROPERTY_OPTIONS = [
  { value: '', label: 'Web Search' },
  { value: 'images', label: 'Image Search' },
  { value: 'news', label: 'News Search' },
  { value: 'youtube', label: 'YouTube Search' },
  { value: 'froogle', label: 'Google Shopping' },
];

const CATEGORY_OPTIONS = [
  { value: 0, label: 'All Categories' },
  { value: 3, label: 'Arts & Entertainment' },
  { value: 5, label: 'Autos & Vehicles' },
  { value: 11, label: 'Business & Industrial' },
  { value: 12, label: 'Computers & Electronics' },
  { value: 13, label: 'Finance' },
  { value: 14, label: 'Food & Drink' },
  { value: 18, label: 'Health' },
  { value: 25, label: 'News' },
  { value: 32, label: 'Shopping' },
  { value: 33, label: 'Sports' },
  { value: 34, label: 'Travel & Transportation' },
];

function parseKeywords(primaryKeyword, compareInput) {
  const parsed = [primaryKeyword, ...(compareInput || '').split(/[\n,]/g)]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return [...new Set(parsed)].slice(0, 5);
}

export default function GoogleTrends() {
  const [keyword, setKeyword] = useState('');
  const [compareInput, setCompareInput] = useState('');
  const [geo, setGeo] = useState('');
  const [timeframe, setTimeframe] = useState('today 12-m');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [property, setProperty] = useState('');
  const [category, setCategory] = useState(0);
  const [resolution, setResolution] = useState('COUNTRY');

  const [trendData, setTrendData] = useState(null);
  const [relatedQueries, setRelatedQueries] = useState(null);
  const [relatedTopics, setRelatedTopics] = useState(null);
  const [regionData, setRegionData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const keywords = useMemo(() => parseKeywords(keyword, compareInput), [keyword, compareInput]);
  const isCompareMode = keywords.length > 1;

  const chartData = useMemo(() => {
    if (!trendData?.timelineData) {
      return [];
    }

    if (isCompareMode) {
      return trendData.timelineData.map((point) => {
        const row = { date: point.date };
        keywords.forEach((term, index) => {
          row[term] = point.values?.[index] ?? 0;
        });
        return row;
      });
    }

    return trendData.timelineData.map((point) => ({
      date: point.date,
      [keywords[0] || 'Interest']: point.value ?? 0,
    }));
  }, [isCompareMode, keywords, trendData]);

  const topRegions = useMemo(() => {
    const rows = Array.isArray(regionData?.regions) ? regionData.regions : [];
    return [...rows].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 20);
  }, [regionData]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!keyword.trim()) {
      return;
    }

    if (timeframe === 'custom') {
      if (!startDate || !endDate) {
        setError('Custom date range requires both start and end dates.');
        return;
      }
      if (new Date(startDate) > new Date(endDate)) {
        setError('Custom start date must be before end date.');
        return;
      }
    }

    const queryKeywords = parseKeywords(keyword, compareInput);
    if (queryKeywords.length === 0) {
      return;
    }

    const options = {
      keyword: queryKeywords[0],
      geo,
      property,
      category,
      timeframe: timeframe === 'custom' ? '' : timeframe,
      startTime: timeframe === 'custom' && startDate ? `${startDate}T00:00:00.000Z` : '',
      endTime: timeframe === 'custom' && endDate ? `${endDate}T23:59:59.999Z` : '',
      resolution,
    };

    setLoading(true);
    setError(null);

    try {
      const [trendResponse, relatedQueriesResponse, relatedTopicsResponse, regionResponse] = await Promise.all([
        queryKeywords.length > 1
          ? compareKeywordTrends(queryKeywords, options)
          : getTrends(options),
        getRelatedQueries(options),
        getRelatedTopics(options),
        getTrendRegions(options),
      ]);

      setTrendData(trendResponse);
      setRelatedQueries(relatedQueriesResponse);
      setRelatedTopics(relatedTopicsResponse);
      setRegionData(regionResponse);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch trends data.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Google Trends</h2>
      <p className="text-sm text-gray-500 mb-6">
        Explore interest over time with country, date range, search type, category, and compare terms.
      </p>

      <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Primary keyword
            </label>
            <input
              type="text"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="e.g. ai agency"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              disabled={loading}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Compare keywords (optional)
            </label>
            <input
              type="text"
              value={compareInput}
              onChange={(event) => setCompareInput(event.target.value)}
              placeholder="keyword 2, keyword 3, keyword 4"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              disabled={loading}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Country
            </label>
            <select
              value={geo}
              onChange={(event) => setGeo(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              disabled={loading}
            >
              {COUNTRY_OPTIONS.map((option) => (
                <option key={option.value || 'worldwide'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Date range
            </label>
            <select
              value={timeframe}
              onChange={(event) => setTimeframe(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              disabled={loading}
            >
              {TIMEFRAME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {timeframe === 'custom' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                  Start date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
                  End date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  disabled={loading}
                />
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Search type
            </label>
            <select
              value={property}
              onChange={(event) => setProperty(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              disabled={loading}
            >
              {PROPERTY_OPTIONS.map((option) => (
                <option key={option.value || 'web'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Category
            </label>
            <select
              value={category}
              onChange={(event) => setCategory(Number.parseInt(event.target.value, 10) || 0)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              disabled={loading}
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Regional breakdown
            </label>
            <select
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              disabled={loading}
            >
              <option value="COUNTRY">Country</option>
              <option value="REGION">Region/State</option>
              <option value="CITY">City</option>
              <option value="DMA">DMA</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Supports up to 5 comparison keywords.
          </p>
          <button
            type="submit"
            disabled={loading || !keyword.trim()}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Fetching...' : 'Search Trends'}
          </button>
        </div>
      </form>

      {loading && <div className="mt-6"><LoadingSpinner message="Fetching trends data..." /></div>}
      {error && <div className="mt-6"><ErrorAlert message={error} /></div>}

      {!loading && trendData && (
        <div className="mt-8 space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="mb-1 font-semibold text-gray-900">Interest Over Time</h3>
            <p className="mb-4 text-xs text-gray-500">
              {isCompareMode ? keywords.join(' vs ') : keywords[0]} - {trendData.geo}
            </p>

            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  {keywords.map((term, index) => (
                    <Line
                      key={term}
                      type="monotone"
                      dataKey={term}
                      stroke={LINE_COLORS[index % LINE_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-center text-sm text-gray-400">No trend data available for this selection.</p>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-4 font-semibold text-gray-900">Top Related Queries</h3>
              {relatedQueries?.top?.length > 0 ? (
                <div className="space-y-2">
                  {relatedQueries.top.slice(0, 15).map((item, index) => (
                    <div key={`${item.query}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-gray-700">{item.query}</span>
                      <span className="text-xs text-gray-500">{item.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No related queries found.</p>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-4 font-semibold text-gray-900">Rising Searches</h3>
              {relatedQueries?.rising?.length > 0 ? (
                <div className="space-y-2">
                  {relatedQueries.rising.slice(0, 15).map((item, index) => (
                    <div key={`${item.query}-${index}`} className="flex items-center justify-between gap-3 text-sm">
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

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-4 font-semibold text-gray-900">Related Topics</h3>
              {relatedTopics?.top?.length > 0 ? (
                <div className="space-y-2">
                  {relatedTopics.top.slice(0, 15).map((item, index) => (
                    <div key={`${item.title}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-gray-700">{item.title}</span>
                      <span className="text-xs text-gray-500">{item.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No related topics found.</p>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-4 font-semibold text-gray-900">Interest by Region</h3>
              {topRegions.length > 0 ? (
                <div className="space-y-2">
                  {topRegions.map((item, index) => (
                    <div key={`${item.code || item.location}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-gray-700">{item.location}</span>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${item.value}%` }} />
                        </div>
                        <span className="w-8 text-right text-xs text-gray-500">{item.value}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No regional data found.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
