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
    screenshotMode?: boolean;
    localAgentMode?: boolean;
    aiMode?: boolean;
    aiProvider?: string | null;
    aiModel?: string | null;
    highAccuracyMode?: boolean;
    strictMode?: boolean;
    providerLock?: string | null;
    selectedProviderId?: string | null;
    selectedProviderName?: string | null;
    redirectsVerified?: boolean;
    screenshotImageDataUrl?: string | null;
    blockedByEngine?: boolean;
    verification?: {
      enabled?: boolean;
      verifiedCount?: number;
      failedCount?: number;
    };
  };
  debug?: {
    prompt?: string;
    screenshotUrl?: string | null;
    screenshotImageDataUrl?: string | null;
    usedDomFallback?: boolean;
    blockedByEngine?: boolean;
    localAgentJobId?: string;
    localAgentDebug?: any;
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
  const [searchMode, setSearchMode] = useState<'standard' | 'ai' | 'screenshot' | 'local-agent'>('standard');
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
  const screenshotPreview = data?.meta?.screenshotImageDataUrl || data?.debug?.screenshotImageDataUrl || null;

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
        aiMode: searchMode === 'ai',
        screenshotMode: searchMode === 'screenshot',
        localAgentMode: searchMode === 'local-agent',
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
            value={searchMode}
            onChange={(event) => setSearchMode(event.target.value as 'standard' | 'ai' | 'screenshot' | 'local-agent')}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
            disabled={loading}
          >
            <option value="standard">Standard SERP</option>
            <option value="ai">AI SERP</option>
            <option value="screenshot">Screenshot OCR SERP</option>
            <option value="local-agent">Local PC Agent SERP</option>
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
              disabled={searchMode !== 'standard'}
            />
            High Accuracy Mode
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={strictMode}
              onChange={(event) => setStrictMode(event.target.checked)}
              className="h-4 w-4"
              disabled={searchMode !== 'standard' || !highAccuracyMode}
            />
            Strict Geo Params
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={verifyUrls}
              onChange={(event) => setVerifyUrls(event.target.checked)}
              className="h-4 w-4"
              disabled={searchMode !== 'standard' || !highAccuracyMode}
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
            disabled={providersLoading || searchMode !== 'standard'}
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
        {searchMode === 'ai' ? (
          <p className="text-xs text-indigo-600">
            AI SERP uses your active AI provider from AI Providers (OpenAI/NVIDIA).
          </p>
        ) : null}
        {searchMode === 'screenshot' ? (
          <p className="text-xs text-indigo-600">
            Screenshot OCR SERP opens the engine page, captures a screenshot, then extracts top websites with OpenAI vision.
          </p>
        ) : null}
        {searchMode === 'local-agent' ? (
          <p className="text-xs text-indigo-600">
            Local PC Agent mode runs browser capture on your own computer IP and sends results back to this app.
          </p>
        ) : null}

        <div className="rounded-md bg-gray-50 px-3 py-2">
          <p className="text-xs font-medium text-gray-600">
            {searchMode === 'ai'
              ? 'AI SERP prompt source'
              : searchMode === 'screenshot'
                ? 'Screenshot OCR prompt source'
                : searchMode === 'local-agent'
                  ? 'Local PC Agent mode'
                : 'Default prompt template used by search logic'}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {searchMode === 'ai'
              ? 'AI SERP mode uses backend aiSerpService structured prompt and active AI model.'
              : searchMode === 'screenshot'
                ? 'Screenshot mode uses browser screenshot + OpenAI vision extraction prompt on the backend.'
                : searchMode === 'local-agent'
                  ? 'Local PC Agent mode sends a job to your running local agent (backend/scripts/localSerpAgent.js).'
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
              {data.meta?.screenshotMode ? (
                <>
                  {' · '}
                  Mode: <span className="font-medium text-gray-900">Screenshot OCR</span>
                </>
              ) : null}
              {data.meta?.localAgentMode ? (
                <>
                  {' · '}
                  Mode: <span className="font-medium text-gray-900">Local PC Agent</span>
                </>
              ) : null}
            </p>
            {data.meta?.verification?.enabled ? (
              <p className="mt-1 text-xs text-gray-500">
                Redirect verification: {data.meta.verification.verifiedCount || 0} verified / {data.meta.verification.failedCount || 0} failed
              </p>
            ) : null}
            {(data.meta?.screenshotMode || data.meta?.localAgentMode) && data.meta?.blockedByEngine ? (
              <p className="mt-1 text-xs text-amber-700">
                Search engine blocked this capture (captcha/consent page). Screenshot is shown below for debugging.
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
          {(data.meta?.screenshotMode || data.meta?.localAgentMode) && screenshotPreview ? (
            <div className="border-t border-gray-200 px-4 py-4">
              <h3 className="text-sm font-semibold text-gray-900">Captured Screenshot</h3>
              <p className="mt-1 text-xs text-gray-500">
                Original screenshot used by this SERP mode.
              </p>
              <img
                src={screenshotPreview}
                alt={`Captured SERP screenshot for ${data.keyword}`}
                className="mt-3 w-full rounded-md border border-gray-200"
              />
            </div>
          ) : null}
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
          {data.debug.screenshotUrl ? (
            <p className="mt-1 text-xs text-gray-600">Captured URL: {data.debug.screenshotUrl}</p>
          ) : null}
          {data.debug.usedDomFallback ? (
            <p className="mt-1 text-xs text-amber-600">Used DOM fallback because OCR returned no rows.</p>
          ) : null}
          {data.debug.blockedByEngine ? (
            <p className="mt-1 text-xs text-amber-600">Engine appears to have blocked the screenshot request.</p>
          ) : null}
          {data.debug.localAgentJobId ? (
            <p className="mt-1 text-xs text-gray-600">Local Agent Job ID: {data.debug.localAgentJobId}</p>
          ) : null}
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
