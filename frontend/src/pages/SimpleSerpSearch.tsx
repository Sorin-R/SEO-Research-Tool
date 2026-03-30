import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { searchFirstPage } from '../services/api';
import { buildSerpPrompt } from '../lib/buildSerpPrompt';
import { parseSerpTarget, SERP_TARGET_OPTIONS } from '../lib/serpTargets';

type SearchResultItem = {
  position: number;
  title: string;
  url: string;
};

type SearchResponse = {
  keyword: string;
  engine: 'google' | 'bing';
  domain: 'com' | 'co.uk';
  location?: string | null;
  results: SearchResultItem[];
};

const DEFAULT_TARGET = 'google.com';

export default function SimpleSerpSearch() {
  const [keyword, setKeyword] = useState('');
  const [location, setLocation] = useState('');
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);

  const targetParts = useMemo(() => parseSerpTarget(target), [target]);
  const promptPreview = useMemo(
    () =>
      buildSerpPrompt({
        keyword,
        engine: targetParts.engine,
        domain: targetParts.domain,
        location,
      }),
    [keyword, location, targetParts.domain, targetParts.engine]
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const sanitizedKeyword = keyword.replace(/\s+/g, ' ').trim();
    const sanitizedLocation = location.replace(/\s+/g, ' ').trim();
    if (!sanitizedKeyword) {
      setError('Please enter a keyword.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await searchFirstPage({
        keyword: sanitizedKeyword,
        engine: targetParts.engine,
        domain: targetParts.domain,
        location: sanitizedLocation,
      });

      setData(response);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || requestError?.message || 'Search failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">SERP Search MVP</h2>
        <p className="text-sm text-gray-500">
          Enter one keyword, pick a search target, and fetch the first 10 organic results in ranked order.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_220px_auto]">
          <input
            type="text"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="Enter keyword..."
            className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
            disabled={loading}
          />
          <input
            type="text"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Location (city), e.g. London"
            className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
            disabled={loading}
          />
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
            disabled={loading}
          >
            {SERP_TARGET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        <div className="rounded-md bg-gray-50 px-3 py-2">
          <p className="text-xs font-medium text-gray-600">Default prompt template used by search logic</p>
          <p className="mt-1 text-xs text-gray-500">{promptPreview}</p>
        </div>
      </form>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {data ? (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="border-b border-gray-200 px-4 py-3">
            <p className="text-sm text-gray-600">
              Keyword: <span className="font-medium text-gray-900">{data.keyword}</span>
              {' · '}
              Target:{' '}
              <span className="font-medium text-gray-900">
                {data.engine}.{data.domain}
              </span>
              {data.location ? (
                <>
                  {' · '}
                  Location: <span className="font-medium text-gray-900">{data.location}</span>
                </>
              ) : null}
            </p>
          </div>

          {data.results.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-500">No results returned.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.results.map((row) => (
                <li key={`${row.position}-${row.url}`} className="px-4 py-3">
                  <p className="text-xs font-medium text-gray-500">#{row.position}</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">{row.title}</p>
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block break-all text-xs text-indigo-600 hover:underline"
                  >
                    {row.url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">
          No search yet.
        </div>
      )}
    </div>
  );
}
