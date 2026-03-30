import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { getSearchProviders, searchFirstPage } from '../services/api';
import { buildSerpPrompt } from '../lib/buildSerpPrompt';
import { parseSerpTarget, SERP_TARGET_OPTIONS } from '../lib/serpTargets';

type SearchResultItem = {
  position: number;
  title: string;
  url: string;
  websiteTitle?: string;
  verified?: boolean;
  verifyError?: string | null;
};

type SearchResponse = {
  keyword: string;
  engine: 'google' | 'bing';
  domain: 'com' | 'co.uk';
  location?: string | null;
  results: SearchResultItem[];
  meta?: {
    aiMode?: boolean;
    aiProvider?: string | null;
    aiModel?: string | null;
    highAccuracyMode?: boolean;
    strictMode?: boolean;
    providerLock?: string | null;
    selectedProviderId?: string | null;
    selectedProviderName?: string | null;
    redirectsVerified?: boolean;
    verification?: {
      enabled?: boolean;
      verifiedCount?: number;
      failedCount?: number;
    };
  };
  debug?: {
    prompt?: string;
    providerAttempts?: Array<{
      providerId: string;
      providerName: string;
      success: boolean;
      returnedResults?: number;
      error?: string;
    }>;
    normalizedResultCount?: number;
  };
};

type ProviderEntry = {
  id: string;
  name: string;
  active: boolean;
  configured: boolean;
  supportedEngines?: string[];
};

const DEFAULT_TARGET = 'google.com';

export default function SimpleSerpSearch() {
  const [keyword, setKeyword] = useState('');
  const [location, setLocation] = useState('');
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [aiMode, setAiMode] = useState(false);
  const [highAccuracyMode, setHighAccuracyMode] = useState(true);
  const [strictMode, setStrictMode] = useState(true);
  const [verifyUrls, setVerifyUrls] = useState(true);
  const [showDebug, setShowDebug] = useState(true);
  const [providerId, setProviderId] = useState('');
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState('');
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
  const providerOptions = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.active
          && (provider.supportedEngines || ['google']).includes(targetParts.engine)
      ),
    [providers, targetParts.engine]
  );

  useEffect(() => {
    let alive = true;

    async function loadProviders() {
      setProvidersLoading(true);
      setProvidersError('');

      try {
        const payload = await getSearchProviders();
        if (!alive) return;
        setProviders(Array.isArray(payload.providers) ? payload.providers : []);
      } catch (err: any) {
        if (!alive) return;
        setProvidersError(err?.response?.data?.error || err?.message || 'Failed to load providers.');
      } finally {
        if (alive) {
          setProvidersLoading(false);
        }
      }
    }

    loadProviders();
    return () => {
      alive = false;
    };
  }, []);

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
        aiMode,
        highAccuracyMode,
        providerId: providerId || undefined,
        strictMode,
        verifyUrls,
        debug: showDebug,
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
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_220px_180px_auto]">
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
          <select
            value={aiMode ? 'ai' : 'standard'}
            onChange={(event) => setAiMode(event.target.value === 'ai')}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
            disabled={loading}
          >
            <option value="standard">Standard SERP</option>
            <option value="ai">AI SERP</option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={highAccuracyMode}
              onChange={(event) => setHighAccuracyMode(event.target.checked)}
              className="h-4 w-4"
              disabled={aiMode}
            />
            High Accuracy Mode
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={strictMode}
              onChange={(event) => setStrictMode(event.target.checked)}
              className="h-4 w-4"
              disabled={aiMode || !highAccuracyMode}
            />
            Strict Geo Params
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={verifyUrls}
              onChange={(event) => setVerifyUrls(event.target.checked)}
              className="h-4 w-4"
              disabled={aiMode || !highAccuracyMode}
            />
            Verify Redirects
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(event) => setShowDebug(event.target.checked)}
              className="h-4 w-4"
            />
            Debug Payload
          </label>
          <select
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            disabled={providersLoading || aiMode}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Provider: Auto fallback</option>
            {providerOptions.map((provider) => (
              <option key={provider.id} value={provider.id}>
                Provider: {provider.name}
              </option>
            ))}
          </select>
        </div>
        {providersError ? (
          <p className="text-xs text-red-600">{providersError}</p>
        ) : null}
        {aiMode ? (
          <p className="text-xs text-indigo-600">
            AI SERP uses your active AI provider from AI Providers (OpenAI/NVIDIA).
          </p>
        ) : null}

        <div className="rounded-md bg-gray-50 px-3 py-2">
          <p className="text-xs font-medium text-gray-600">
            {aiMode ? 'AI SERP prompt source' : 'Default prompt template used by search logic'}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {aiMode
              ? 'AI SERP mode uses backend aiSerpService structured prompt and active AI model.'
              : promptPreview}
          </p>
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
              {data.meta?.selectedProviderName ? (
                <>
                  {' · '}
                  Provider: <span className="font-medium text-gray-900">{data.meta.selectedProviderName}</span>
                </>
              ) : null}
              {data.meta?.aiMode && data.meta?.aiModel ? (
                <>
                  {' · '}
                  Model: <span className="font-medium text-gray-900">{data.meta.aiModel}</span>
                </>
              ) : null}
            </p>
            {data.meta?.verification?.enabled ? (
              <p className="mt-1 text-xs text-gray-500">
                Redirect verification: {data.meta.verification.verifiedCount || 0} verified / {data.meta.verification.failedCount || 0} failed
              </p>
            ) : null}
          </div>

          {data.results.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-500">No results returned.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.results.map((row) => (
                <li key={`${row.position}-${row.url}`} className="px-4 py-3">
                  <p className="text-xs font-medium text-gray-500">#{row.position}</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">{row.title}</p>
                  {row.websiteTitle ? (
                    <p className="mt-1 text-xs text-gray-500">Website title: {row.websiteTitle}</p>
                  ) : null}
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block break-all text-xs text-indigo-600 hover:underline"
                  >
                    {row.url}
                  </a>
                  {row.verifyError ? (
                    <p className="mt-1 text-xs text-amber-600">Verification warning: {row.verifyError}</p>
                  ) : null}
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

      {showDebug && data?.debug ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">Debug Payload</h3>
          <p className="mt-2 text-xs font-medium text-gray-600">Provider attempts</p>
          <div className="mt-1 space-y-1">
            {(data.debug.providerAttempts || []).map((attempt, index) => (
              <p key={`${attempt.providerId}-${index}`} className="text-xs text-gray-600">
                {attempt.providerName} ({attempt.providerId}) - {attempt.success ? `OK (${attempt.returnedResults || 0})` : `Fail (${attempt.error || 'unknown'})`}
              </p>
            ))}
          </div>
          <p className="mt-3 text-xs font-medium text-gray-600">Prompt used</p>
          <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-gray-50 p-2 text-xs text-gray-600 whitespace-pre-wrap">
            {data.debug.prompt}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
