/**
 * GoogleAdsKeywordResearch Page
 * Integrates Google Ads API for keyword research with PPC metrics.
 * Shows:
 * - Keyword ideas
 * - Monthly search volume
 * - Competition levels
 * - Average CPC (Cost Per Click)
 */

import { useEffect, useState } from 'react';
import GoogleAdsKeywordTable from '../components/GoogleAdsKeywordTable';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import StatCard from '../components/StatCard';
import {
  addKeywordsToList,
  clearGoogleAdsCache,
  createKeywordList,
  getGoogleAdsCacheStats,
  deleteGoogleAdsKeywordHistoryItem,
  getGoogleAdsKeywordHistory,
  getGoogleAdsKeywordHistoryItem,
  getGoogleAdsKeywordIdeas,
  getKeywordLists,
  getTrackedKeywords,
  trackKeyword,
} from '../services/api';

const STORAGE_KEY = 'seo-tool:google-ads-keyword-research:last-session';
const HISTORY_LIMIT = 10;

const COUNTRY_OPTIONS = [
  ['US', 'United States'],
  ['GB', 'United Kingdom'],
  ['CA', 'Canada'],
  ['AU', 'Australia'],
  ['DE', 'Germany'],
  ['FR', 'France'],
  ['ES', 'Spain'],
  ['IT', 'Italy'],
  ['NL', 'Netherlands'],
  ['IN', 'India'],
  ['BR', 'Brazil'],
  ['MX', 'Mexico'],
  ['JP', 'Japan'],
];

export default function GoogleAdsKeywordResearch() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cacheStats, setCacheStats] = useState(null);
  const [lastKeyword, setLastKeyword] = useState('');
  const [country, setCountry] = useState('US');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const [loadingHistoryId, setLoadingHistoryId] = useState(null);
  const [deletingHistoryId, setDeletingHistoryId] = useState(null);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState(null);
  const [tracked, setTracked] = useState(new Set());
  const [keywordLists, setKeywordLists] = useState([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [listsError, setListsError] = useState(null);
  const [selectedListId, setSelectedListId] = useState('');
  const [newListName, setNewListName] = useState('');
  const [creatingList, setCreatingList] = useState(false);
  const [savingList, setSavingList] = useState(false);
  const [saveDialogItems, setSaveDialogItems] = useState([]);
  const [saveDialogLabel, setSaveDialogLabel] = useState('Save to list');
  const [saveDialogListId, setSaveDialogListId] = useState('');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);

      if (typeof parsed.lastKeyword === 'string') {
        setLastKeyword(parsed.lastKeyword);
      }

      if (typeof parsed.country === 'string') {
        setCountry(parsed.country);
      }

      if (parsed.data) {
        setData(parsed.data);
        setRestoreNotice('Restored your last Google Ads keyword search from this browser.');
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setStorageHydrated(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadLists() {
      setListsLoading(true);
      setListsError(null);

      try {
        const result = await getKeywordLists();
        if (!cancelled) {
          setKeywordLists(result);
          if (!selectedListId && result[0]?.id) {
            setSelectedListId(String(result[0].id));
          }
        }
      } catch (err) {
        if (!cancelled) {
          setListsError(err.response?.data?.error || err.message);
        }
      } finally {
        if (!cancelled) {
          setListsLoading(false);
        }
      }
    }

    async function loadTracked() {
      try {
        const result = await getTrackedKeywords();
        if (!cancelled) {
          setTracked(new Set((result || []).map((item) => item.keyword)));
        }
      } catch {
        // Ignore tracked preload failures.
      }
    }

    loadLists();
    loadTracked();

    return () => {
      cancelled = true;
    };
  }, [selectedListId]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setHistoryLoading(true);
      setHistoryError(null);

      try {
        const result = await getGoogleAdsKeywordHistory(HISTORY_LIMIT);
        if (!cancelled) {
          setHistory(result);
        }
      } catch (err) {
        if (!cancelled) {
          setHistoryError(err.response?.data?.error || err.message);
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }

    if (!data && !lastKeyword.trim()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          data,
          country,
          lastKeyword,
          savedAt: new Date().toISOString(),
        })
      );
    } catch {
      // Ignore storage quota issues.
    }
  }, [country, data, lastKeyword, storageHydrated]);

  async function handleSearch(keyword) {
    setLoading(true);
    setError(null);
    setRestoreNotice(null);
    setLastKeyword(keyword);
    try {
      const result = await getGoogleAdsKeywordIdeas(keyword, false, country);
      setData(result);
      setLastKeyword(result.keyword || keyword);
      setCountry(result.country || country);
      setRestoreNotice(buildGoogleAdsNotice(result));

      // Fetch cache stats
      const stats = await getGoogleAdsCacheStats();
      setCacheStats(stats);
      await refreshHistory();
    } catch (err) {
      const errorMsg =
        err.response?.data?.error ||
        err.message ||
        'Failed to fetch keyword ideas from Google Ads API.';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }

  async function handleClearCache() {
    try {
      await clearGoogleAdsCache();
      alert('Cache cleared successfully!');
      setCacheStats({ cacheStats: { size: 0, ttlMinutes: 10 } });
    } catch (err) {
      alert('Failed to clear cache: ' + err.message);
    }
  }

  async function handleBypassCache() {
    if (!data?.keyword) return;
    setLoading(true);
    setError(null);
    setRestoreNotice(null);
    try {
      const result = await getGoogleAdsKeywordIdeas(data.keyword, true, country);
      setData(result);
      setLastKeyword(result.keyword || data.keyword);
      setCountry(result.country || country);
      setRestoreNotice(buildGoogleAdsNotice(result, true));
      await refreshHistory();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshHistory() {
    try {
      const result = await getGoogleAdsKeywordHistory(HISTORY_LIMIT);
      setHistory(result);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(err.response?.data?.error || err.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function refreshLists(preferredListId = null) {
    try {
      const result = await getKeywordLists();
      setKeywordLists(result);
      setListsError(null);

      if (preferredListId) {
        setSelectedListId(String(preferredListId));
      } else if (!result.some((list) => String(list.id) === String(selectedListId))) {
        setSelectedListId(result[0]?.id ? String(result[0].id) : '');
      }
    } catch (err) {
      setListsError(err.response?.data?.error || err.message);
    } finally {
      setListsLoading(false);
    }
  }

  async function handleTrack(idea) {
    try {
      await trackKeyword(idea.keyword, null, idea.avgMonthlySearches);
      setTracked((current) => new Set(current).add(idea.keyword));
    } catch {
      // Ignore duplicate tracking attempts.
    }
  }

  async function handleCreateList() {
    if (!newListName.trim()) {
      return;
    }

    setCreatingList(true);
    setListsError(null);

    try {
      const result = await createKeywordList(newListName.trim());
      setNewListName('');
      await refreshLists(result.id);
    } catch (err) {
      setListsError(err.response?.data?.error || err.message);
    } finally {
      setCreatingList(false);
    }
  }

  async function saveItemsToList(listId, items) {
    if (!listId) {
      setListsError('Create or select a keyword list first.');
      return false;
    }

    setSavingList(true);
    setListsError(null);

    try {
      await addKeywordsToList(listId, items);
      await refreshLists(listId);
      return true;
    } catch (err) {
      setListsError(err.response?.data?.error || err.message);
      return false;
    } finally {
      setSavingList(false);
    }
  }

  function openSaveListDialog(items, label = 'Save to list') {
    if (!Array.isArray(items) || items.length === 0) {
      return;
    }

    if (keywordLists.length === 0) {
      setListsError('Create a keyword list first.');
      return;
    }

    setSaveDialogItems(items);
    setSaveDialogLabel(label);
    setSaveDialogListId(selectedListId || String(keywordLists[0].id));
  }

  function closeSaveListDialog() {
    setSaveDialogItems([]);
    setSaveDialogLabel('Save to list');
    setSaveDialogListId('');
  }

  async function confirmSaveToList() {
    if (!saveDialogListId || saveDialogItems.length === 0) {
      return;
    }

    const saved = await saveItemsToList(saveDialogListId, saveDialogItems);
    if (saved) {
      closeSaveListDialog();
    }
  }

  const savedKeywordSet = new Set(
    keywordLists.flatMap((list) => (Array.isArray(list.items) ? list.items : []).map((item) => String(item.keyword || '').toLowerCase()))
  );

  function handleSearchSubmit(event) {
    event.preventDefault();
    if (!lastKeyword.trim() || loading) {
      return;
    }

    handleSearch(lastKeyword.trim());
  }

  async function handleLoadHistory(id) {
    setLoadingHistoryId(id);
    setError(null);

    try {
      const result = await getGoogleAdsKeywordHistoryItem(id);
      setData(result);
      setLastKeyword(result.keyword || '');
      setCountry(result.country || 'US');
      setRestoreNotice('Loaded a saved Google Ads keyword search from history.');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoadingHistoryId(null);
    }
  }

  async function handleDeleteHistory(id) {
    setDeletingHistoryId(id);
    setHistoryError(null);
    setError(null);

    try {
      await deleteGoogleAdsKeywordHistoryItem(id);
      setHistory((current) => current.filter((item) => String(item.id) !== String(id)));

      if (String(data?.historyId) === String(id)) {
        setData(null);
        setRestoreNotice(null);
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch (err) {
      setHistoryError(err.response?.data?.error || err.message);
    } finally {
      setDeletingHistoryId(null);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Google Ads Keyword Research</h2>
      <p className="text-sm text-gray-500 mb-6">
        Get keyword ideas with PPC metrics: search volume, competition level, and CPC from Google Ads.
      </p>

      <form onSubmit={handleSearchSubmit} className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="min-w-[280px] flex-1 space-y-1">
            <span className="text-sm font-medium text-gray-700">Seed Keyword</span>
            <input
              type="text"
              value={lastKeyword}
              onChange={(event) => setLastKeyword(event.target.value)}
              placeholder="Enter a seed keyword (e.g., vegan cupcakes)..."
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={loading}
            />
          </label>

          <label className="w-full sm:w-56 space-y-1">
            <span className="text-sm font-medium text-gray-700">Country</span>
            <select
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {COUNTRY_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {!listsLoading && keywordLists.length > 0 && (
            <label className="w-full sm:w-64 space-y-1">
              <span className="text-sm font-medium text-gray-700">Active List</span>
              <select
                value={selectedListId}
                onChange={(event) => setSelectedListId(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {keywordLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name} ({list.itemCount})
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="w-full sm:w-56 space-y-1">
            <span className="text-sm font-medium text-gray-700">New List</span>
            <input
              type="text"
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
              placeholder="New list name"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          <button
            type="button"
            onClick={handleCreateList}
            disabled={creatingList || !newListName.trim()}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creatingList ? 'Creating...' : 'Create list'}
          </button>

          <button
            type="submit"
            disabled={loading || !lastKeyword.trim()}
            className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {listsLoading && <p className="mt-3 text-sm text-gray-500">Loading keyword lists...</p>}
        {listsError && <div className="mt-3"><ErrorAlert message={listsError} /></div>}
      </form>

      <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-gray-900">Recent Saved Searches</h3>
          <p className="text-sm text-gray-500">
            Your last Google Ads keyword search restores after refresh in this browser, and recent searches are also saved to the backend.
          </p>
        </div>

        {historyLoading && <p className="text-sm text-gray-500">Loading saved searches...</p>}
        {historyError && <ErrorAlert message={historyError} />}

        {!historyLoading && !historyError && history.length === 0 && (
          <p className="text-sm text-gray-500">No saved Google Ads searches yet. Run a search and it will appear here.</p>
        )}

        {!historyLoading && history.length > 0 && (
          <div className="space-y-2">
            {history.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 transition-colors hover:border-indigo-300 hover:bg-indigo-50"
              >
                <button
                  type="button"
                  onClick={() => handleLoadHistory(item.id)}
                  disabled={loadingHistoryId === item.id || deletingHistoryId === item.id}
                  className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-medium text-gray-900">
                        {item.keyword} <span className="text-gray-400">· {item.country_name || item.country}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {item.total_ideas || 0} keyword ideas
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {loadingHistoryId === item.id ? 'Loading...' : formatSavedAt(item.updated_at || item.created_at)}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteHistory(item.id)}
                  disabled={loadingHistoryId === item.id || deletingHistoryId === item.id}
                  className="shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-500 hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={`Delete saved Google Ads search for ${item.keyword}`}
                  title="Delete saved search"
                >
                  {deletingHistoryId === item.id ? '...' : 'X'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && <LoadingSpinner message="Fetching keyword ideas from Google Ads..." />}
      {error && <div className="mt-6"><ErrorAlert message={error} onRetry={() => handleSearch(lastKeyword)} /></div>}

      {data && !loading && (
        <div className="mt-8 space-y-6">
          {restoreNotice && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-5 py-4 text-sm text-emerald-900">
              {restoreNotice}
            </div>
          )}

          {/* Header + Stats */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Keyword Ideas for "{data.keyword}"
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Found <span className="font-semibold text-gray-700">{data.totalIdeas}</span> related keywords
                {' '}in <span className="font-semibold text-gray-700">{data.countryName || getCountryLabel(country)}</span>
                {data.fromCache && <span className="ml-2 text-indigo-600">(cached)</span>}
                {data.savedAt ? <span className="ml-2">· Saved {formatSavedAt(data.savedAt)}</span> : null}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              {data.fromCache && (
                <button
                  onClick={handleBypassCache}
                  disabled={loading}
                  className="px-3 py-2 text-xs font-medium text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 rounded-lg transition-colors"
                  title="Fetch fresh data from API"
                >
                  Refresh
                </button>
              )}
              {cacheStats && (
                <button
                  onClick={handleClearCache}
                  className="px-3 py-2 text-xs font-medium text-gray-600 hover:text-gray-700 border border-gray-200 hover:border-gray-300 rounded-lg transition-colors"
                  title="Clear cached results"
                >
                  Clear Cache
                </button>
              )}
            </div>
          </div>

          {/* Quick stats */}
          {data.ideas && data.ideas.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard
                label="Top Search Volume"
                value={Math.max(...data.ideas.map((i) => i.avgMonthlySearches)).toLocaleString()}
                sub={data.ideas.find((i) => i.avgMonthlySearches === Math.max(...data.ideas.map((x) => x.avgMonthlySearches)))?.keyword}
              />
              <StatCard
                label="Avg Search Volume"
                value={Math.round(data.ideas.reduce((sum, i) => sum + i.avgMonthlySearches, 0) / data.ideas.length).toLocaleString()}
              />
              <StatCard
                label="Avg CPC"
                value={`$${(data.ideas.reduce((sum, i) => sum + i.cpc, 0) / data.ideas.length).toFixed(2)}`}
              />
            </div>
          )}

          {/* Keyword table */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <GoogleAdsKeywordTable
              ideas={data.ideas}
              keyword={data.keyword}
              loading={loading}
              tracked={tracked}
              savedKeywords={savedKeywordSet}
              onTrack={handleTrack}
              onSaveToList={(idea) => openSaveListDialog([mapGoogleAdsIdeaToListItem(data.keyword)(idea)], 'Save keyword to list')}
              savingList={savingList}
              canSave={keywordLists.length > 0}
            />
          </div>

          {/* Cache info */}
          {cacheStats && (
            <div className="text-xs text-gray-400 text-right">
              <p>Cache: {cacheStats.cacheStats.size} entries • {cacheStats.cacheStats.ttlMinutes}min TTL</p>
            </div>
          )}
        </div>
      )}

      {saveDialogItems.length > 0 && (
        <SaveListDialog
          title={saveDialogLabel}
          lists={keywordLists}
          selectedListId={saveDialogListId}
          onChangeList={setSaveDialogListId}
          onClose={closeSaveListDialog}
          onConfirm={confirmSaveToList}
          itemCount={saveDialogItems.length}
          previewKeywords={saveDialogItems.slice(0, 5).map((item) => item.keyword)}
          saving={savingList}
        />
      )}

      {/* Initial state - show tips */}
      {!data && !loading && (
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">💡 Tips</h3>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Start with broad keywords to get more ideas</li>
            <li>• Competition level: LOW is easier to rank for, HIGH is more competitive</li>
            <li>• CPC indicates advertiser demand (higher CPC = higher intent)</li>
            <li>• Results are cached for 10 minutes to improve performance</li>
            <li>• Requires Google Ads API credentials configured in .env</li>
          </ul>
        </div>
      )}
    </div>
  );
}

function getCountryLabel(countryCode) {
  return COUNTRY_OPTIONS.find(([value]) => value === String(countryCode || 'US').toUpperCase())?.[1] || 'United States';
}

function buildGoogleAdsNotice(result, forceRefresh = false) {
  if (result?.fromCache && !forceRefresh) {
    return 'Loaded the cached Google Ads keyword ideas for this keyword and country.';
  }

  if (forceRefresh) {
    return 'Fetched fresh Google Ads keyword ideas and updated the saved search.';
  }

  return 'Saved this Google Ads keyword search so you can reopen it later.';
}

function formatSavedAt(value) {
  if (!value) {
    return 'Just now';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Just now';
  }

  return parsed.toLocaleString();
}

function mapGoogleAdsIdeaToListItem(sourceKeyword) {
  return (idea) => ({
    keyword: idea.keyword,
    intent: null,
    clusterLabel: null,
    priorityScore: null,
    recommendedPageType: null,
    notes: [
      `Google Ads monthly searches: ${Number(idea.avgMonthlySearches || 0).toLocaleString()}.`,
      `Google Ads competition: ${idea.competition || 'UNKNOWN'}.`,
      `Google Ads CPC: $${Number(idea.cpc || 0).toFixed(2)}.`,
    ],
    sourceKeyword,
  });
}

function SaveListDialog({
  title,
  lists,
  selectedListId,
  onChangeList,
  onClose,
  onConfirm,
  itemCount,
  previewKeywords,
  saving,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            <p className="mt-1 text-sm text-gray-500">
              Choose which saved list should receive {itemCount} keyword{itemCount === 1 ? '' : 's'}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-500 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
          >
            X
          </button>
        </div>

        <label className="mt-4 block space-y-1">
          <span className="text-sm font-medium text-gray-700">Saved List</span>
          <select
            value={selectedListId}
            onChange={(event) => onChangeList(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({list.itemCount})
              </option>
            ))}
          </select>
        </label>

        {previewKeywords.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="text-sm font-medium text-gray-700">Preview</div>
            <div className="flex flex-wrap gap-2">
              {previewKeywords.map((keyword) => (
                <span key={keyword} className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm text-gray-700">
                  {keyword}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving || !selectedListId}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save to list'}
          </button>
        </div>
      </div>
    </div>
  );
}
