import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  getLocalSerpAgentStatus,
  openLocalSerpCaptchaWindow,
  searchFirstPage,
} from '../services/api';
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

type LocalAgentStatus = {
  ok: boolean;
  queue?: {
    total?: number;
    pending?: number;
    claimed?: number;
    completed?: number;
    failed?: number;
  };
  agents?: {
    total?: number;
    online?: number;
    maxAgeMs?: number;
    agents?: Array<{
      id: string;
      lastSeen: number;
      online: boolean;
      state?: {
        captchaPending?: boolean;
        captchaUrl?: string | null;
        status?: string | null;
      };
    }>;
  };
  captchaPending?: boolean;
  captchaAgents?: Array<{
    id: string;
    captchaUrl?: string | null;
    status?: string | null;
    lastSeen?: number;
  }>;
};

const DEFAULT_TARGET = 'google.com';
const LOCAL_AGENT_HISTORY_STORAGE_KEY = 'seo-tool:local-agent-serp-history';
const MAX_LOCAL_AGENT_HISTORY = 20;

type LocalAgentSavedSearch = {
  id: string;
  keyword: string;
  target: string;
  location: string;
  savedAt: string;
  response: SearchResponse;
};

function loadLocalAgentHistory(): LocalAgentSavedSearch[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_AGENT_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalAgentHistory(items: LocalAgentSavedSearch[]) {
  try {
    window.localStorage.setItem(LOCAL_AGENT_HISTORY_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore storage write failures
  }
}

export default function SimpleSerpSearch() {
  const [keyword, setKeyword] = useState('');
  const [location, setLocation] = useState('');
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [showDebug, setShowDebug] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [localAgentHistory, setLocalAgentHistory] = useState<LocalAgentSavedSearch[]>([]);
  const [localAgentStatus, setLocalAgentStatus] = useState<LocalAgentStatus | null>(null);
  const [localAgentStatusError, setLocalAgentStatusError] = useState('');
  const [openingCaptchaWindow, setOpeningCaptchaWindow] = useState(false);

  const targetParts = useMemo(() => parseSerpTarget(target), [target]);
  const screenshotPreview = data?.meta?.screenshotImageDataUrl || data?.debug?.screenshotImageDataUrl || null;
  const shouldPollLocalAgentStatus = true;
  const localAgentOnline = Number(localAgentStatus?.agents?.online || 0) > 0;
  const captchaPending = Boolean(localAgentStatus?.captchaPending);
  const activeCaptchaAgent = Array.isArray(localAgentStatus?.captchaAgents) ? localAgentStatus.captchaAgents[0] : null;

  useEffect(() => {
    setLocalAgentHistory(loadLocalAgentHistory());
  }, []);

  useEffect(() => {
    if (!shouldPollLocalAgentStatus) {
      return undefined;
    }

    let active = true;

    async function refresh() {
      try {
        const payload = await getLocalSerpAgentStatus();
        if (!active) return;
        setLocalAgentStatus(payload);
        setLocalAgentStatusError('');
      } catch (err: any) {
        if (!active) return;
        setLocalAgentStatusError(err?.response?.data?.error || err?.message || 'Failed to load Local Agent status.');
      }
    }

    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [shouldPollLocalAgentStatus]);

  function saveLocalAgentSearchRun(response: SearchResponse, targetValue: string, locationValue: string) {
    const entry: LocalAgentSavedSearch = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      keyword: response.keyword,
      target: targetValue,
      location: locationValue,
      savedAt: new Date().toISOString(),
      response,
    };

    setLocalAgentHistory((current) => {
      const deduped = current.filter((item) => !(
        item.keyword.toLowerCase() === entry.keyword.toLowerCase()
        && item.target === entry.target
        && item.location.toLowerCase() === entry.location.toLowerCase()
      ));
      const next = [entry, ...deduped].slice(0, MAX_LOCAL_AGENT_HISTORY);
      saveLocalAgentHistory(next);
      return next;
    });
  }

  function restoreLocalAgentSearch(entry: LocalAgentSavedSearch) {
    setKeyword(entry.keyword);
    setTarget(entry.target);
    setLocation(entry.location);
    setData(entry.response);
    setError('');
  }

  function deleteLocalAgentSearch(entryId: string) {
    setLocalAgentHistory((current) => {
      const next = current.filter((item) => item.id !== entryId);
      saveLocalAgentHistory(next);
      return next;
    });
  }

  async function handleOpenCaptchaWindow() {
    setOpeningCaptchaWindow(true);
    setError('');
    try {
      await openLocalSerpCaptchaWindow({
        keyword: keyword.replace(/\s+/g, ' ').trim() || 'google',
        engine: targetParts.engine,
        domain: targetParts.domain,
        location: location.replace(/\s+/g, ' ').trim(),
      });
      const payload = await getLocalSerpAgentStatus();
      setLocalAgentStatus(payload);
      setLocalAgentStatusError('');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || requestError?.message || 'Failed to open captcha window.');
    } finally {
      setOpeningCaptchaWindow(false);
    }
  }

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
        aiMode: false,
        screenshotMode: false,
        localAgentMode: true,
        highAccuracyMode: false,
        providerId: undefined,
        strictMode: false,
        verifyUrls: false,
        debug: showDebug,
      });

      setData(response);
      if (response?.meta?.localAgentMode) {
        saveLocalAgentSearchRun(response, target, sanitizedLocation);
      }
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || requestError?.message || 'Search failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">SERP Screenshot</h2>
        <p className="text-sm text-gray-500">
          Local PC Agent SERP capture using your own browser session and IP.
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

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 md:max-w-xs">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(event) => setShowDebug(event.target.checked)}
              className="h-4 w-4"
            />
            Debug Payload
          </label>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-indigo-600">
            Local PC Agent mode runs browser capture on your own computer IP and sends results back to this app.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs ${localAgentOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              Local Agent: {localAgentOnline ? 'Online' : 'Offline'}
            </span>
            {captchaPending ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                Captcha pending
              </span>
            ) : null}
            <button
              type="button"
              onClick={handleOpenCaptchaWindow}
              disabled={openingCaptchaWindow || !localAgentOnline}
              className="rounded border border-indigo-200 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {openingCaptchaWindow ? 'Opening...' : 'Open Captcha Window'}
            </button>
          </div>
          {activeCaptchaAgent?.captchaUrl ? (
            <p className="text-xs text-amber-700">
              Captcha URL: {activeCaptchaAgent.captchaUrl}
            </p>
          ) : null}
          {localAgentStatusError ? (
            <p className="text-xs text-red-600">{localAgentStatusError}</p>
          ) : null}
        </div>

        <div className="rounded-md bg-gray-50 px-3 py-2">
          <p className="text-xs font-medium text-gray-600">Local PC Agent mode</p>
          <p className="mt-1 text-xs text-gray-500">
            Local PC Agent mode sends a job to your running local agent ([backend/scripts/localSerpAgent.js]) and stores the screenshot with results.
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
            {data.meta?.blockedByEngine ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-xs text-amber-700">
                  Search engine blocked this request (captcha/consent page). Open captcha window, complete challenge, then run Search again.
                </p>
                <button
                  type="button"
                  onClick={handleOpenCaptchaWindow}
                  disabled={openingCaptchaWindow}
                  className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {openingCaptchaWindow ? 'Opening...' : 'Open Captcha Window'}
                </button>
              </div>
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
          {data.meta?.localAgentMode && screenshotPreview ? (
            <div className="border-t border-gray-200 px-4 py-4">
              <h3 className="text-sm font-semibold text-gray-900">Captured Screenshot</h3>
              <p className="mt-1 text-xs text-gray-500">
                Original screenshot used by this SERP mode.
              </p>
              <div className="mt-3 h-[80vh] w-full overflow-auto rounded-md border border-gray-200 bg-gray-50">
                <img
                  src={screenshotPreview}
                  alt={`Captured SERP screenshot for ${data.keyword}`}
                  className="block h-auto w-full min-w-full"
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">
          No search yet.
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Saved SERP Screenshots</h3>
        {localAgentHistory.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No saved Local PC Agent research yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {localAgentHistory.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 px-3 py-2">
                <button
                  type="button"
                  onClick={() => restoreLocalAgentSearch(item)}
                  className="min-w-0 flex-1 text-left text-sm text-gray-700 hover:text-indigo-600"
                >
                  <span className="font-medium text-gray-900">{item.keyword}</span>
                  <span className="text-gray-500"> · {item.target}{item.location ? ` · ${item.location}` : ''}</span>
                  <span className="ml-2 text-xs text-gray-400">{new Date(item.savedAt).toLocaleString()}</span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteLocalAgentSearch(item.id)}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

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
