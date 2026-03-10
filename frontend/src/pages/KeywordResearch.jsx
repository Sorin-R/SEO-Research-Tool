import { useEffect, useState } from 'react';
import SearchBar from '../components/SearchBar';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import {
  addKeywordsToList,
  createKeywordList,
  deleteKeywordList,
  deleteKeywordListItem,
  deleteKeywordResearchHistoryItem,
  filterKeywordsWithAI,
  getTrackedKeywords,
  getKeywordLists,
  getKeywordResearchHistory,
  getKeywordResearchHistoryItem,
  researchKeyword,
  trackKeyword,
} from '../services/api';

const DEFAULT_AI_PROMPT =
  'Keep only the keywords that are the closest match to the seed keyword. Remove broad, weak, or loosely related phrases.';
const STORAGE_KEY = 'seo-tool:keyword-research:last-session';
const HISTORY_LIMIT = 10;
const MAX_VISIBLE_KEYWORDS = 150;
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
const INTENT_OPTIONS = [
  ['informational', 'Informational'],
  ['commercial', 'Commercial'],
  ['transactional', 'Transactional'],
  ['local', 'Local'],
  ['navigational', 'Navigational'],
];

function createDefaultOptions() {
  return {
    expand: true,
    country: 'US',
    goalPrompt: '',
    includeTerms: '',
    excludeTerms: '',
    modifierTerms: '',
    intents: [],
    minWords: '',
    maxWords: '',
    brandedMode: 'all',
    brandTerms: '',
    questionsOnly: false,
    localCities: '',
    localServices: '',
    competitorDomains: '',
    targetDomain: '',
    includeTrends: false,
    trendTopN: 5,
    enrichTopN: 5,
    targetCount: 1000,
    targetAudience: '',
  };
}

function buildOptionsFromResult(result) {
  if (!result) {
    return createDefaultOptions();
  }

  return {
    expand: result.researchOptions?.expand ?? result.deepScan ?? true,
    country: result.country || 'US',
    goalPrompt: result.researchOptions?.goalPrompt || '',
    includeTerms: (result.filtersApplied?.includeTerms || []).join(', '),
    excludeTerms: (result.filtersApplied?.excludeTerms || []).join(', '),
    modifierTerms: (result.filtersApplied?.modifierTerms || []).join(', '),
    intents: result.filtersApplied?.intents || [],
    minWords: result.filtersApplied?.minWords || '',
    maxWords: result.filtersApplied?.maxWords || '',
    brandedMode: result.filtersApplied?.brandedMode || 'all',
    brandTerms: (result.researchOptions?.brandTerms || []).join(', '),
    questionsOnly: result.filtersApplied?.questionsOnly || false,
    localCities: (result.localSeo?.cities || []).join(', '),
    localServices: (result.localSeo?.services || []).join(', '),
    competitorDomains: (result.competitorMode?.competitorDomains || []).join(', '),
    targetDomain: result.competitorMode?.targetDomain || '',
    includeTrends: result.researchOptions?.includeTrends || false,
    trendTopN: result.researchOptions?.trendTopN || 5,
    enrichTopN: result.researchOptions?.enrichTopN || 5,
    targetCount: result.researchOptions?.targetCount || 1000,
    targetAudience: result.researchOptions?.targetAudience || '',
  };
}

function formatSavedAt(value) {
  if (!value) {
    return 'Saved recently';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Saved recently' : date.toLocaleString();
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? '');
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function downloadCsv(filename, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function KeywordResearch() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tracked, setTracked] = useState(new Set());
  const [searchValue, setSearchValue] = useState('');
  const [options, setOptions] = useState(createDefaultOptions);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const [loadingHistoryId, setLoadingHistoryId] = useState(null);
  const [deletingHistoryId, setDeletingHistoryId] = useState(null);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState(null);
  const [aiPrompt, setAiPrompt] = useState(DEFAULT_AI_PROMPT);
  const [aiMaxResults, setAiMaxResults] = useState(100);
  const [aiData, setAiData] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [keywordLists, setKeywordLists] = useState([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [listsError, setListsError] = useState(null);
  const [selectedListId, setSelectedListId] = useState('');
  const [newListName, setNewListName] = useState('');
  const [creatingList, setCreatingList] = useState(false);
  const [savingList, setSavingList] = useState(false);
  const [deletingListId, setDeletingListId] = useState(null);
  const [deletingListItemKey, setDeletingListItemKey] = useState(null);
  const [selectedClusterKey, setSelectedClusterKey] = useState('');
  const [showAllKeywords, setShowAllKeywords] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);

      if (parsed?.data) {
        setData(parsed.data);
        setSearchValue(parsed.data.keyword || '');
        setRestoreNotice('Restored your last keyword research from this browser.');
      }

      if (parsed?.options) {
        setOptions({
          ...createDefaultOptions(),
          ...parsed.options,
        });
      }

      if (parsed?.aiData) {
        setAiData(parsed.aiData);
      }

      if (typeof parsed?.aiPrompt === 'string' && parsed.aiPrompt.trim()) {
        setAiPrompt(parsed.aiPrompt);
      }

      if (parsed?.aiMaxResults) {
        setAiMaxResults(parsed.aiMaxResults);
      }

      if (parsed?.selectedListId) {
        setSelectedListId(String(parsed.selectedListId));
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setStorageHydrated(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setHistoryLoading(true);
      setHistoryError(null);

      try {
        const result = await getKeywordResearchHistory(HISTORY_LIMIT);
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
        // Ignore tracked keyword preload failures.
      }
    }

    loadHistory();
    loadLists();
    loadTracked();

    return () => {
      cancelled = true;
    };
  }, [selectedListId]);

  useEffect(() => {
    if (!data?.clusters?.length) {
      setSelectedClusterKey('');
      return;
    }

    if (!selectedClusterKey || !data.clusters.some((cluster) => cluster.key === selectedClusterKey)) {
      setSelectedClusterKey(data.clusters[0].key);
    }
  }, [data, selectedClusterKey]);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }

    if (!data) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        data,
        options,
        aiData,
        aiPrompt,
        aiMaxResults,
        selectedListId,
        savedAt: new Date().toISOString(),
      })
    );
  }, [data, options, aiData, aiPrompt, aiMaxResults, selectedListId, storageHydrated]);

  async function refreshHistory() {
    try {
      const result = await getKeywordResearchHistory(HISTORY_LIMIT);
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

  async function handleSearch(keyword) {
    setLoading(true);
    setError(null);
    setAiData(null);
    setAiError(null);
    setRestoreNotice(null);
    setShowAllKeywords(false);

    try {
      const result = await researchKeyword(keyword, options);
      setData(result);
      setSearchValue(result.keyword || keyword);
      await refreshHistory();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleTrack(keyword) {
    try {
      await trackKeyword(keyword);
      setTracked((prev) => new Set(prev).add(keyword));
    } catch {
      // Ignore duplicate tracking attempts.
    }
  }

  async function handleAiFilter() {
    if (!data?.keyword || !data?.keywords?.length) {
      return;
    }

    setAiLoading(true);
    setAiError(null);

    try {
      const result = await filterKeywordsWithAI({
        keyword: data.keyword,
        keywords: data.keywords.map((item) => item.keyword),
        prompt: aiPrompt,
        maxResults: aiMaxResults,
      });
      setAiData(result);
    } catch (err) {
      setAiError(err.response?.data?.error || err.message);
    } finally {
      setAiLoading(false);
    }
  }

  async function handleLoadHistory(id) {
    setLoadingHistoryId(id);
    setError(null);
    setAiError(null);

    try {
      const result = await getKeywordResearchHistoryItem(id);
      setData(result);
      setAiData(null);
      setSearchValue(result.keyword || '');
      setOptions(buildOptionsFromResult(result));
      setRestoreNotice('Loaded a saved keyword research result from history.');
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
    setAiError(null);

    try {
      await deleteKeywordResearchHistoryItem(id);
      setHistory((current) => current.filter((item) => String(item.id) !== String(id)));

      if (String(data?.historyId) === String(id)) {
        setData(null);
        setAiData(null);
        setRestoreNotice(null);
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch (err) {
      setHistoryError(err.response?.data?.error || err.message);
    } finally {
      setDeletingHistoryId(null);
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

  async function handleDeleteList(listId) {
    setDeletingListId(listId);
    setListsError(null);

    try {
      await deleteKeywordList(listId);
      await refreshLists();
    } catch (err) {
      setListsError(err.response?.data?.error || err.message);
    } finally {
      setDeletingListId(null);
    }
  }

  async function handleDeleteListItem(listId, itemId) {
    const actionKey = `${listId}:${itemId}`;
    setDeletingListItemKey(actionKey);
    setListsError(null);

    try {
      await deleteKeywordListItem(listId, itemId);
      await refreshLists(listId);
    } catch (err) {
      setListsError(err.response?.data?.error || err.message);
    } finally {
      setDeletingListItemKey(null);
    }
  }

  async function saveItemsToSelectedList(items) {
    if (!selectedListId) {
      setListsError('Create or select a keyword list first.');
      return;
    }

    setSavingList(true);
    setListsError(null);

    try {
      await addKeywordsToList(selectedListId, items);
      await refreshLists(selectedListId);
    } catch (err) {
      setListsError(err.response?.data?.error || err.message);
    } finally {
      setSavingList(false);
    }
  }

  function updateOption(key, value) {
    setOptions((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function toggleIntent(intent) {
    setOptions((current) => ({
      ...current,
      intents: current.intents.includes(intent)
        ? current.intents.filter((item) => item !== intent)
        : [...current.intents, intent],
    }));
  }

  const selectedCluster = data?.clusters?.find((cluster) => cluster.key === selectedClusterKey) || data?.clusters?.[0] || null;
  const visibleKeywords = showAllKeywords ? data?.keywords || [] : (data?.keywords || []).slice(0, MAX_VISIBLE_KEYWORDS);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Keyword Research</h2>
        <p className="text-sm text-gray-500">
          Expand keywords, cluster them by intent/topic, score opportunities, enrich top terms with SERP signals, save lists, and build content briefs.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        <SearchBar
          onSearch={handleSearch}
          loading={loading}
          placeholder="Enter a seed keyword..."
          initialValue={searchValue}
        />

        <div className="grid gap-4 lg:grid-cols-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Country</span>
            <select
              value={options.country}
              onChange={(event) => updateOption('country', event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {COUNTRY_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Target Count</span>
            <input
              type="number"
              min="100"
              max="1500"
              value={options.targetCount}
              onChange={(event) => updateOption('targetCount', event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">SERP Enrichment Top N</span>
            <input
              type="number"
              min="0"
              max="20"
              value={options.enrichTopN}
              onChange={(event) => updateOption('enrichTopN', event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Trend Overlay Top N</span>
            <input
              type="number"
              min="0"
              max="10"
              value={options.trendTopN}
              onChange={(event) => updateOption('trendTopN', event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={!options.includeTrends}
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Strategy Prompt</span>
            <textarea
              value={options.goalPrompt}
              onChange={(event) => updateOption('goalPrompt', event.target.value)}
              rows={4}
              placeholder="Explain the offer, audience, funnel stage, and how tightly you want the keywords grouped around the seed term."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
          </label>

          <div className="grid gap-4">
            <label className="space-y-1">
              <span className="text-sm font-medium text-gray-700">Include Terms</span>
              <textarea
                value={options.includeTerms}
                onChange={(event) => updateOption('includeTerms', event.target.value)}
                rows={2}
                placeholder="Comma-separated terms that must appear"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium text-gray-700">Exclude Terms</span>
              <textarea
                value={options.excludeTerms}
                onChange={(event) => updateOption('excludeTerms', event.target.value)}
                rows={2}
                placeholder="Comma-separated terms to remove"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              />
            </label>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Modifier Filter</span>
            <input
              type="text"
              value={options.modifierTerms}
              onChange={(event) => updateOption('modifierTerms', event.target.value)}
              placeholder="best, vs, pricing"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Min Words</span>
            <input
              type="number"
              min="0"
              value={options.minWords}
              onChange={(event) => updateOption('minWords', event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Max Words</span>
            <input
              type="number"
              min="0"
              value={options.maxWords}
              onChange={(event) => updateOption('maxWords', event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Branded Filter</span>
            <select
              value={options.brandedMode}
              onChange={(event) => updateOption('brandedMode', event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All keywords</option>
              <option value="branded">Branded only</option>
              <option value="non-branded">Non-branded only</option>
            </select>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Brand Terms</span>
            <input
              type="text"
              value={options.brandTerms}
              onChange={(event) => updateOption('brandTerms', event.target.value)}
              placeholder="Brand/domain words used to flag branded queries"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Target Audience</span>
            <input
              type="text"
              value={options.targetAudience}
              onChange={(event) => updateOption('targetAudience', event.target.value)}
              placeholder="SMB founders, enterprise buyers, local customers..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Local SEO Cities</span>
            <textarea
              value={options.localCities}
              onChange={(event) => updateOption('localCities', event.target.value)}
              rows={2}
              placeholder="London, Manchester, Leeds"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Local SEO Services</span>
            <textarea
              value={options.localServices}
              onChange={(event) => updateOption('localServices', event.target.value)}
              rows={2}
              placeholder="AI agency, SEO consultant"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Competitor Domains</span>
            <textarea
              value={options.competitorDomains}
              onChange={(event) => updateOption('competitorDomains', event.target.value)}
              rows={2}
              placeholder="competitor.com, rival.co.uk"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Target Domain</span>
            <input
              type="text"
              value={options.targetDomain}
              onChange={(event) => updateOption('targetDomain', event.target.value)}
              placeholder="yourdomain.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium text-gray-700">Intent Filters</span>
          <div className="flex flex-wrap gap-3">
            {INTENT_OPTIONS.map(([value, label]) => (
              <label key={value} className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={options.intents.includes(value)}
                  onChange={() => toggleIntent(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={options.expand}
              onChange={(event) => updateOption('expand', event.target.checked)}
            />
            Deep autocomplete scan
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={options.questionsOnly}
              onChange={(event) => updateOption('questionsOnly', event.target.checked)}
            />
            Questions only
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={options.includeTrends}
              onChange={(event) => updateOption('includeTrends', event.target.checked)}
            />
            Include Google Trends overlay
          </label>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
        <Panel
          title="Recent Saved Searches"
          description="The latest session restores after refresh in this browser, and the backend keeps a search history you can reload."
        >
          {historyLoading && <p className="text-sm text-gray-500">Loading saved searches...</p>}
          {historyError && <ErrorAlert message={historyError} />}

          {!historyLoading && !historyError && history.length === 0 && (
            <p className="text-sm text-gray-500">No saved keyword research yet. Run a search and it will appear here.</p>
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
                    className="min-w-0 flex-1 text-left disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="font-medium text-gray-900">{item.keyword}</div>
                        <div className="text-xs text-gray-500">
                          {item.total_suggestions || 0} suggestions
                          {item.deep_scan ? ' • deep scan' : ''}
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
                  >
                    {deletingHistoryId === item.id ? '...' : 'X'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Saved Lists"
          description="Move winning keywords into reusable lists like Blog ideas, Money pages, low competition, or client-specific buckets."
        >
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

          {listsLoading && <p className="text-sm text-gray-500">Loading keyword lists...</p>}
          {listsError && <ErrorAlert message={listsError} />}

          {!listsLoading && keywordLists.length > 0 && (
            <div className="space-y-4">
              <label className="space-y-1 block">
                <span className="text-sm font-medium text-gray-700">Active list for quick save</span>
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

              <div className="space-y-3">
                {keywordLists.map((list) => (
                  <div key={list.id} className="rounded-lg border border-gray-200">
                    <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
                      <div>
                        <div className="font-medium text-gray-900">{list.name}</div>
                        <div className="text-xs text-gray-500">
                          {list.itemCount} saved keyword{list.itemCount === 1 ? '' : 's'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteList(list.id)}
                        disabled={deletingListId === list.id}
                        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-500 hover:border-red-300 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {deletingListId === list.id ? '...' : 'X'}
                      </button>
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      {list.items?.length ? (
                        list.items.slice(0, 8).map((item) => (
                          <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
                            <div className="min-w-0">
                              <div className="font-medium text-sm text-gray-900">{item.keyword}</div>
                              <div className="text-xs text-gray-500">
                                {[item.intent, item.clusterLabel, item.recommendedPageType].filter(Boolean).join(' • ')}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteListItem(list.id, item.id)}
                              disabled={deletingListItemKey === `${list.id}:${item.id}`}
                              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-500 hover:border-red-300 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {deletingListItemKey === `${list.id}:${item.id}` ? '...' : 'X'}
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-gray-500">No keywords saved in this list yet.</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {loading && <LoadingSpinner message="Researching keywords, building clusters, and scoring opportunities..." />}
      {error && <ErrorAlert message={error} onRetry={() => handleSearch(searchValue)} />}

      {data && !loading && (
        <div className="space-y-6">
          {restoreNotice && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-5 py-4 text-sm text-emerald-900">
              {restoreNotice}
            </div>
          )}

          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 text-sm text-gray-600">
              Found <span className="font-semibold text-gray-900">{data.totalSuggestions || 0}</span> filtered keywords
              {' '}from <span className="font-semibold text-gray-900">{data.rawSuggestionCount || 0}</span> raw suggestions
              {data.deepScan ? ' using deep scan' : ''} in {data.countryName || data.country}.
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => downloadCsv(`${data.keyword.replace(/\s+/g, '-')}-keywords.csv`, data.csvRows || [])}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => saveItemsToSelectedList((data.keywords || []).slice(0, 25).map(mapKeywordToListItem(data.keyword)))}
                disabled={savingList || !selectedListId || !(data.keywords || []).length}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingList ? 'Saving...' : 'Save top 25 to list'}
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-4 md:grid-cols-2">
            <MetricCard label="Clusters" value={data.summary?.totalClusters || 0} />
            <MetricCard label="Questions" value={data.summary?.questionsCount || 0} />
            <MetricCard label="Local terms" value={data.summary?.localCount || 0} />
            <MetricCard label="Gap keywords" value={data.competitorGapSummary?.totalGapKeywords || 0} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <Panel title="Top Opportunities" description="Priority score blends relevance, business intent, difficulty estimate, trend signal, and SERP opportunity.">
              <KeywordRows
                keywords={(data.keywords || []).slice(0, 20)}
                tracked={tracked}
                onTrack={handleTrack}
                onSaveToList={(keyword) => saveItemsToSelectedList([mapKeywordToListItem(data.keyword)(keyword)])}
                savingList={savingList}
                canSave={!!selectedListId}
              />
            </Panel>

            <Panel title="Signals" description="Quick status of the enrichment layers applied to this run.">
              <div className="space-y-3 text-sm text-gray-700">
                <SignalLine
                  label="SERP enrichment"
                  value={
                    data.serpEnrichment?.enabled
                      ? `${data.serpEnrichment.processed} processed${data.serpEnrichment.failed ? ` • ${data.serpEnrichment.failed} failed` : ''}`
                      : 'Disabled'
                  }
                />
                <SignalLine
                  label="Trend overlay"
                  value={
                    data.trendOverlay?.enabled
                      ? `${data.trendOverlay.processed} processed${data.trendOverlay.failed ? ` • ${data.trendOverlay.failed} failed` : ''}`
                      : 'Disabled'
                  }
                />
                <SignalLine label="Country" value={data.countryName || data.country} />
                <SignalLine label="Request count" value={data.requestCount || 1} />
                <SignalLine label="Reached target" value={data.reachedTarget ? 'Yes' : 'No'} />
              </div>

              {(data.competitorGapSummary?.topGapKeywords || []).length > 0 && (
                <div className="mt-4 space-y-2">
                  <h4 className="font-semibold text-gray-900">Top competitor gaps</h4>
                  {data.competitorGapSummary.topGapKeywords.slice(0, 5).map((item) => (
                    <div key={item.keyword} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      <div className="font-medium">{item.keyword}</div>
                      <div className="text-xs">
                        Competitors: {item.competitors.join(', ')} • Opportunity {item.opportunityScore}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Intent Clusters and Page Targets" description="Clusters show which keywords should live on one page, what page type to build, and a ready-made content brief.">
            <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
              <div className="space-y-2">
                {data.clusters?.map((cluster) => (
                  <button
                    key={cluster.key}
                    type="button"
                    onClick={() => setSelectedClusterKey(cluster.key)}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                      selectedCluster?.key === cluster.key
                        ? 'border-indigo-400 bg-indigo-50'
                        : 'border-gray-200 bg-gray-50 hover:border-indigo-200 hover:bg-indigo-50'
                    }`}
                  >
                    <div className="font-medium text-gray-900">{cluster.label}</div>
                    <div className="text-xs text-gray-500">
                      {cluster.keywordCount} keywords • {cluster.intent} • {cluster.recommendedPageType}
                    </div>
                  </button>
                ))}
              </div>

              {selectedCluster && (
                <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-5">
                  <div className="flex flex-wrap gap-3 justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{selectedCluster.label}</h3>
                      <p className="text-sm text-gray-500">
                        Primary keyword: {selectedCluster.primaryKeyword} • {selectedCluster.keywordCount} keywords
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => saveItemsToSelectedList(selectedCluster.keywords.map(mapKeywordToListItem(data.keyword)))}
                      disabled={savingList || !selectedListId}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Save cluster to list
                    </button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2">Keyword set</h4>
                      <KeywordPills keywords={selectedCluster.keywords.slice(0, 18).map((item) => item.keyword)} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2">Brief</h4>
                      <BriefBlock brief={selectedCluster.brief} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="AI Keyword Filter" description="Use AI after the scrape when you want a tighter shortlist aligned to the exact business goal.">
            <div className="space-y-4">
              <label className="space-y-1 block">
                <span className="text-sm font-medium text-gray-700">AI Instructions</span>
                <textarea
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  rows={4}
                  placeholder="Explain the business, search intent, target audience, and how tightly the keywords should match the seed keyword."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                />
              </label>

              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <label className="space-y-1 block md:w-48">
                  <span className="text-sm font-medium text-gray-700">Max Results</span>
                  <input
                    type="number"
                    min="5"
                    max="250"
                    value={aiMaxResults}
                    onChange={(event) => setAiMaxResults(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </label>

                <button
                  type="button"
                  onClick={handleAiFilter}
                  disabled={aiLoading || !(data.keywords || []).length}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {aiLoading ? 'Filtering...' : 'Filter with AI'}
                </button>
              </div>

              <p className="text-xs text-gray-500">
                Requires <code>OPENAI_API_KEY</code> on the backend.
              </p>
              {aiError && <ErrorAlert message={aiError} />}
              {aiLoading && <LoadingSpinner message="Filtering keywords with AI..." />}
              {aiData && !aiLoading && (
                <AIKeywordSection
                  data={aiData}
                  tracked={tracked}
                  onTrack={handleTrack}
                  onSaveToList={(keyword) => saveItemsToSelectedList([{ keyword, sourceKeyword: data.keyword }])}
                  canSave={!!selectedListId}
                  savingList={savingList}
                />
              )}
            </div>
          </Panel>

          <Panel title="All Scored Keywords" description="Includes intent, cluster, trend, competitor gap, recommended page type, and save/track actions.">
            <div className="space-y-4">
              <KeywordRows
                keywords={visibleKeywords}
                tracked={tracked}
                onTrack={handleTrack}
                onSaveToList={(keyword) => saveItemsToSelectedList([mapKeywordToListItem(data.keyword)(keyword)])}
                savingList={savingList}
                canSave={!!selectedListId}
              />

              {(data.keywords || []).length > MAX_VISIBLE_KEYWORDS && (
                <div className="flex items-center justify-between gap-4 text-sm text-gray-500">
                  <span>
                    Showing {visibleKeywords.length} of {data.keywords.length} keywords.
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAllKeywords((current) => !current)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700"
                  >
                    {showAllKeywords ? 'Show fewer rows' : 'Show all rows'}
                  </button>
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function mapKeywordToListItem(sourceKeyword) {
  return (item) => ({
    keyword: item.keyword,
    intent: item.intent || null,
    clusterLabel: item.clusterLabel || null,
    priorityScore: item.priorityScore ?? null,
    recommendedPageType: item.recommendedPageType || null,
    notes: item.notes || [],
    sourceKeyword,
  });
}

function Panel({ title, description, children }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {description && <p className="text-sm text-gray-500">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}

function SignalLine({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <span className="font-medium text-gray-900">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function KeywordPills({ keywords }) {
  if (!keywords?.length) {
    return <p className="text-sm text-gray-500">No keywords in this cluster yet.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {keywords.map((keyword) => (
        <span key={keyword} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700">
          {keyword}
        </span>
      ))}
    </div>
  );
}

function BriefBlock({ brief }) {
  if (!brief) {
    return <p className="text-sm text-gray-500">No brief generated.</p>;
  }

  return (
    <div className="space-y-3 text-sm text-gray-700">
      <div>
        <div className="font-semibold text-gray-900">Headline</div>
        <div>{brief.headline}</div>
      </div>
      <div>
        <div className="font-semibold text-gray-900">Title Ideas</div>
        <ul className="list-disc pl-5 space-y-1">
          {brief.titleIdeas?.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
      <div>
        <div className="font-semibold text-gray-900">H2s</div>
        <ul className="list-disc pl-5 space-y-1">
          {brief.h2s?.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
      <div>
        <div className="font-semibold text-gray-900">FAQs</div>
        <ul className="list-disc pl-5 space-y-1">
          {brief.faqs?.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
      <div>
        <div className="font-semibold text-gray-900">Internal Links</div>
        <ul className="list-disc pl-5 space-y-1">
          {brief.internalLinks?.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </div>
  );
}

function KeywordRows({ keywords, tracked, onTrack, onSaveToList, savingList, canSave }) {
  if (!keywords?.length) {
    return <p className="text-sm text-gray-500">No keywords found for the current filters.</p>;
  }

  return (
    <div className="space-y-3">
      {keywords.map((item) => (
        <div key={item.keyword} className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">{item.keyword}</span>
                <Badge>{item.intent}</Badge>
                <Badge>Priority {item.priorityScore}</Badge>
                {typeof item.opportunityScore === 'number' && <Badge>Opportunity {item.opportunityScore}</Badge>}
                {typeof item.difficultyEstimate === 'number' && <Badge>Difficulty {item.difficultyEstimate}</Badge>}
                {item.trend?.direction && item.trend.direction !== 'unknown' && <Badge>Trend {item.trend.direction}</Badge>}
                {item.competitorGap?.isGap && <Badge tone="warning">Gap</Badge>}
              </div>

              <div className="text-sm text-gray-600">
                {[
                  item.clusterLabel,
                  item.recommendedPageType,
                  item.wordCount ? `${item.wordCount} words` : null,
                  item.brandedStatus && item.brandedStatus !== 'unknown' ? item.brandedStatus : null,
                ].filter(Boolean).join(' • ')}
              </div>

              {(item.notes || []).length > 0 && (
                <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
                  {item.notes.slice(0, 3).map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}

              {item.enrichment?.resultSample?.length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                  {item.enrichment.resultSample.map((result) => (
                    <span key={`${item.keyword}-${result.position}-${result.domain}`}>
                      #{result.position} {result.domain}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onTrack(item.keyword)}
                disabled={tracked.has(item.keyword)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  tracked.has(item.keyword)
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                {tracked.has(item.keyword) ? 'Tracked' : 'Track'}
              </button>
              <button
                type="button"
                onClick={() => onSaveToList(item)}
                disabled={savingList || !canSave}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save to list
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Badge({ children, tone = 'default' }) {
  const toneClasses = tone === 'warning'
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-gray-200 bg-white text-gray-700';

  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${toneClasses}`}>
      {children}
    </span>
  );
}

function AIKeywordSection({ data, tracked, onTrack, onSaveToList, canSave, savingList }) {
  if (!data?.keywords?.length) {
    return null;
  }

  return (
    <div className="space-y-3">
      {data.summary && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          {data.summary}
        </div>
      )}

      {data.keywords.map((item) => (
        <div
          key={item.keyword}
          className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 md:flex-row md:items-start md:justify-between"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">{item.keyword}</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-indigo-700 border border-indigo-200">
                {item.score}/100
              </span>
            </div>
            <p className="text-sm text-gray-600">{item.reason}</p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onTrack(item.keyword)}
              disabled={tracked.has(item.keyword)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                tracked.has(item.keyword)
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50'
              }`}
            >
              {tracked.has(item.keyword) ? 'Tracked' : 'Track'}
            </button>
            <button
              type="button"
              onClick={() => onSaveToList(item.keyword)}
              disabled={savingList || !canSave}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save to list
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
