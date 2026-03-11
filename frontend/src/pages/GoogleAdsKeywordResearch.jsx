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
import SearchBar from '../components/SearchBar';
import GoogleAdsKeywordTable from '../components/GoogleAdsKeywordTable';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import StatCard from '../components/StatCard';
import {
  addKeywordsToList,
  clearGoogleAdsCache,
  createKeywordList,
  getGoogleAdsCacheStats,
  getGoogleAdsKeywordIdeas,
  getKeywordLists,
  getTrackedKeywords,
  trackKeyword,
} from '../services/api';

export default function GoogleAdsKeywordResearch() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cacheStats, setCacheStats] = useState(null);
  const [lastKeyword, setLastKeyword] = useState('');
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

  async function handleSearch(keyword) {
    setLoading(true);
    setError(null);
    setLastKeyword(keyword);
    try {
      const result = await getGoogleAdsKeywordIdeas(keyword);
      setData(result);

      // Fetch cache stats
      const stats = await getGoogleAdsCacheStats();
      setCacheStats(stats);
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
    try {
      const result = await getGoogleAdsKeywordIdeas(data.keyword, true);
      setData(result);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
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

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Google Ads Keyword Research</h2>
      <p className="text-sm text-gray-500 mb-6">
        Get keyword ideas with PPC metrics: search volume, competition level, and CPC from Google Ads.
      </p>

      {/* Search */}
      <SearchBar
        onSearch={handleSearch}
        loading={loading}
        placeholder="Enter a seed keyword (e.g., vegan cupcakes)..."
        initialValue={lastKeyword}
      />

      <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={newListName}
            onChange={(event) => setNewListName(event.target.value)}
            placeholder="New list name"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={handleCreateList}
            disabled={creatingList || !newListName.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creatingList ? 'Creating...' : 'Create list'}
          </button>
        </div>

        {listsError && <ErrorAlert message={listsError} />}

        {!listsLoading && keywordLists.length > 0 && (
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700">Active list for saves</span>
            <select
              value={selectedListId}
              onChange={(event) => setSelectedListId(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {keywordLists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name} ({list.itemCount})
                </option>
              ))}
            </select>
          </label>
        )}

        {listsLoading && <p className="text-sm text-gray-500">Loading keyword lists...</p>}
      </div>

      {loading && <LoadingSpinner message="Fetching keyword ideas from Google Ads..." />}
      {error && <div className="mt-6"><ErrorAlert message={error} onRetry={() => handleSearch(lastKeyword)} /></div>}

      {data && !loading && (
        <div className="mt-8 space-y-6">
          {/* Header + Stats */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Keyword Ideas for "{data.keyword}"
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Found <span className="font-semibold text-gray-700">{data.totalIdeas}</span> related keywords
                {data.fromCache && <span className="ml-2 text-indigo-600">(cached)</span>}
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
