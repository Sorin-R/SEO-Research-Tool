import { useEffect, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  addKeywordsToList,
  createKeywordList,
  extractCompetitorKeywords,
  getKeywordLists,
  getTrackedKeywords,
  trackKeyword,
} from '../services/api';

const STORAGE_KEY = 'seo-tool:competitor-keywords:last-session';

function createDefaultOptions() {
  return {
    competitorDomains: '',
    maxSites: 3,
    maxPagesPerSite: 5,
    keywordLimit: 100,
    goalPrompt: '',
    brandTerms: '',
    localCities: '',
    localServices: '',
    targetAudience: '',
  };
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

function buildCsvRowsFromCompetitorKeywords(keywords = []) {
  return keywords.map((item) => ({
    keyword: item.keyword,
    intent: item.intent || '',
    cluster: item.clusterLabel || '',
    priorityScore: item.priorityScore ?? '',
    opportunityScore: item.opportunityScore ?? '',
    difficultyEstimate: item.difficultyEstimate ?? '',
    extractionScore: item.extractionScore ?? '',
    sourceSiteCount: item.sourceSiteCount ?? 0,
    sourcePageCount: item.sourcePageCount ?? 0,
    sourceDomains: (item.sourceDomains || []).join(' | '),
    samplePages: (item.sourcePages || []).join(' | '),
    recommendedPageType: item.recommendedPageType || '',
    notes: Array.isArray(item.notes) ? item.notes.join(' | ') : '',
  }));
}

function buildClusterSummaryCsvRows(clusters = []) {
  return (Array.isArray(clusters) ? clusters : []).map((cluster) => ({
    cluster: cluster.label || '',
    primaryKeyword: cluster.primaryKeyword || '',
    intent: cluster.intent || '',
    recommendedPageType: cluster.recommendedPageType || '',
    keywordCount: cluster.keywordCount ?? 0,
    averagePriorityScore: cluster.averagePriorityScore ?? '',
    keywords: (cluster.keywords || []).map((item) => item.keyword).join(' | '),
  }));
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

export default function CompetitorKeywords() {
  const [seedKeyword, setSeedKeyword] = useState('');
  const [options, setOptions] = useState(createDefaultOptions);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
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
  const [selectedClusterKey, setSelectedClusterKey] = useState('');
  const [showAllClusterKeywords, setShowAllClusterKeywords] = useState(false);
  const [storageHydrated, setStorageHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);
      setSeedKeyword(parsed?.seedKeyword || '');
      setOptions({
        ...createDefaultOptions(),
        ...(parsed?.options || {}),
      });
      setData(parsed?.data || null);

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

    async function loadTracked() {
      try {
        const result = await getTrackedKeywords();
        if (!cancelled) {
          setTracked(new Set((result || []).map((item) => item.keyword)));
        }
      } catch {
        // Ignore preload failures.
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

    loadTracked();
    loadLists();

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
    setShowAllClusterKeywords(false);
  }, [selectedClusterKey, data?.seedKeyword]);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }

    if (!seedKeyword && !data) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        seedKeyword,
        options,
        data,
        selectedListId,
        savedAt: new Date().toISOString(),
      })
    );
  }, [seedKeyword, options, data, selectedListId, storageHydrated]);

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

  async function handleExtract(keywordOverride = null) {
    const activeKeyword = String(keywordOverride || seedKeyword || '').trim();

    if (!activeKeyword) {
      setError('Seed keyword is required.');
      return;
    }

    setSeedKeyword(activeKeyword);
    setLoading(true);
    setError(null);

    try {
      const result = await extractCompetitorKeywords(activeKeyword, options.competitorDomains, {
        maxSites: options.maxSites,
        maxPagesPerSite: options.maxPagesPerSite,
        keywordLimit: options.keywordLimit,
        goalPrompt: options.goalPrompt,
        brandTerms: options.brandTerms,
        localCities: options.localCities,
        localServices: options.localServices,
        targetAudience: options.targetAudience,
      });

      setData(result);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleTrack(keyword) {
    try {
      await trackKeyword(keyword);
      setTracked((current) => new Set(current).add(keyword));
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

  function updateOption(key, value) {
    setOptions((current) => ({
      ...current,
      [key]: value,
    }));
  }

  const selectedCluster = data?.clusters?.find((cluster) => cluster.key === selectedClusterKey) || data?.clusters?.[0] || null;
  const savedKeywordSet = new Set(
    keywordLists.flatMap((list) => (Array.isArray(list.items) ? list.items : []).map((item) => String(item.keyword || '').toLowerCase()))
  );
  const isSelectedClusterSaved = !!selectedCluster?.keywords?.length
    && selectedCluster.keywords.every((item) => savedKeywordSet.has(String(item.keyword || '').toLowerCase()));

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Competitor Keywords</h2>
        <p className="text-sm text-gray-500">
          Crawl competitor sites directly, extract keyword ideas from their pages, then track, save, cluster, and export them without using the main keyword research workflow.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        <div className="flex gap-3">
          <input
            type="text"
            value={seedKeyword}
            onChange={(event) => setSeedKeyword(event.target.value)}
            placeholder="Enter the seed keyword..."
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => handleExtract()}
            disabled={loading || !seedKeyword.trim() || !options.competitorDomains.trim()}
            className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Extracting...' : 'Extract keywords'}
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Competitor Domains or URLs</span>
            <textarea
              value={options.competitorDomains}
              onChange={(event) => updateOption('competitorDomains', event.target.value)}
              rows={4}
              placeholder={'https://www.ronins.co.uk/ai-agency/\nwagada.co.uk\nterraconnect.co.uk'}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
          </label>

          <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-900">
            <div className="font-semibold text-sky-950">How this works</div>
            <p className="mt-1">
              Enter competitor homepages or specific URLs, then this tool crawls a limited number of pages per site and extracts phrases from titles, headings, URL paths, and repeated body copy.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Competitor Sites to Crawl</span>
            <input
              type="number"
              min="1"
              max="5"
              value={options.maxSites}
              onChange={(event) => updateOption('maxSites', event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Pages Per Competitor</span>
            <input
              type="number"
              min="1"
              max="12"
              value={options.maxPagesPerSite}
              onChange={(event) => updateOption('maxPagesPerSite', event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Extracted Keyword Limit</span>
            <input
              type="number"
              min="20"
              max="250"
              value={options.keywordLimit}
              onChange={(event) => updateOption('keywordLimit', event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Strategy Prompt</span>
            <textarea
              value={options.goalPrompt}
              onChange={(event) => updateOption('goalPrompt', event.target.value)}
              rows={3}
              placeholder="Explain the offer, audience, and how tightly the extracted keywords should stay around the seed term."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
          </label>

          <div className="grid gap-4">
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
      </div>

      <Panel title="Saved Lists" description="Choose where extracted keywords should go when you use Save to list.">
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
      </Panel>

      {loading && <LoadingSpinner message="Crawling competitor sites and extracting keyword ideas..." />}
      {error && <ErrorAlert message={error} onRetry={() => handleExtract()} />}

      {data && !loading && (
        <div className="space-y-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 text-sm text-gray-600">
              Extracted <span className="font-semibold text-gray-900">{(data.keywords || []).length}</span> keywords
              {' '}from <span className="font-semibold text-gray-900">{data.summary?.totalPagesCrawled || 0}</span> pages
              {' '}across <span className="font-semibold text-gray-900">{data.summary?.totalCompetitorSites || 0}</span> competitor sites.
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() =>
                  downloadCsv(
                    `${seedKeyword.replace(/\s+/g, '-')}-competitor-keywords.csv`,
                    buildCsvRowsFromCompetitorKeywords(data.keywords || [])
                  )
                }
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700"
              >
                Export competitor CSV
              </button>
              <button
                type="button"
                onClick={() =>
                  openSaveListDialog(
                    (data.keywords || []).slice(0, 25).map(mapKeywordToListItem(seedKeyword)),
                    'Save top extracted keywords'
                  )
                }
                disabled={savingList || keywordLists.length === 0 || !(data.keywords || []).length}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingList ? 'Saving...' : 'Save top extracted keywords'}
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-4 md:grid-cols-2">
            <MetricCard label="Sites crawled" value={data.summary?.totalCompetitorSites || 0} />
            <MetricCard label="Pages crawled" value={data.summary?.totalPagesCrawled || 0} />
            <MetricCard label="Extracted keywords" value={(data.keywords || []).length} />
            <MetricCard label="Clusters" value={data.summary?.totalClusters || 0} />
          </div>

          <Panel title="Crawled Competitor Sites" description="Quick crawl summary per competitor source.">
            <div className="grid gap-3 lg:grid-cols-2">
              {(data.competitorSites || []).map((site) => (
                <div key={site.siteUrl} className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                  <div className="font-medium text-gray-900">{site.domain}</div>
                  <div className="mt-1 text-sm text-gray-600">
                    {(site.pagesCrawled || 0)} pages crawled • {(site.successfulPages || 0)} successful
                    {site.failedPages ? ` • ${site.failedPages} failed` : ''}
                  </div>
                  {site.error && <div className="mt-2 text-xs text-red-600">{site.error}</div>}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Extracted Keywords" description="Directly extracted competitor terms with save, track, and export support.">
            <KeywordRows
              keywords={data.keywords || []}
              tracked={tracked}
              savedKeywords={savedKeywordSet}
              onTrack={handleTrack}
              onSaveToList={(keyword) => openSaveListDialog([mapKeywordToListItem(seedKeyword)(keyword)], 'Save competitor keyword to list')}
              savingList={savingList}
              canSave={keywordLists.length > 0}
            />
          </Panel>

          <Panel
            title="Intent Clusters and Page Targets"
            description="Grouped competitor keywords that likely belong on the same page."
            actions={
              <button
                type="button"
                onClick={() =>
                  downloadCsv(
                    `${seedKeyword.replace(/\s+/g, '-')}-competitor-cluster-summary.csv`,
                    buildClusterSummaryCsvRows(data.clusters || [])
                  )
                }
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700"
              >
                Export cluster summary CSV
              </button>
            }
          >
            <div className="grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
              <div className="space-y-2">
                {(data.clusters || []).map((cluster) => (
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
                      {cluster.keywordCount} keywords • {cluster.intent} • Avg score {cluster.averagePriorityScore}
                    </div>
                  </button>
                ))}
              </div>

              {selectedCluster ? (
                <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{selectedCluster.label}</h3>
                      <p className="text-sm text-gray-500">
                        Primary keyword: {selectedCluster.primaryKeyword} • {selectedCluster.keywordCount} keywords • {selectedCluster.recommendedPageType}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openSaveListDialog(selectedCluster.keywords.map(mapKeywordToListItem(seedKeyword)), 'Save cluster to list')}
                      disabled={savingList || keywordLists.length === 0 || isSelectedClusterSaved}
                      className={`rounded-lg px-4 py-2 text-sm font-medium ${
                        isSelectedClusterSaved
                          ? 'border border-green-200 bg-green-50 text-green-700'
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {isSelectedClusterSaved ? 'Saved' : 'Save cluster to list'}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAllClusterKeywords((current) => !current)}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700"
                    >
                      {showAllClusterKeywords ? 'Show less keywords' : `Show all keywords (${selectedCluster.keywordCount})`}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadCsv(
                          `${seedKeyword.replace(/\s+/g, '-')}-${selectedCluster.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-cluster.csv`,
                          buildCsvRowsFromCompetitorKeywords(selectedCluster.keywords || [])
                        )
                      }
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700"
                    >
                      Export cluster CSV
                    </button>
                  </div>

                  <ClusterKeywordList
                    keywords={showAllClusterKeywords ? selectedCluster.keywords : selectedCluster.keywords.slice(0, 12)}
                    tracked={tracked}
                    savedKeywords={savedKeywordSet}
                    onTrack={handleTrack}
                    onSaveToList={(keyword) => openSaveListDialog([mapKeywordToListItem(seedKeyword)(keyword)], 'Save competitor keyword to list')}
                    savingList={savingList}
                    canSave={keywordLists.length > 0}
                  />

                  {!showAllClusterKeywords && selectedCluster.keywordCount > 12 && (
                    <p className="text-xs text-gray-500">
                      Showing 12 of {selectedCluster.keywordCount} keywords in this cluster.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500">No clusters yet.</p>
              )}
            </div>
          </Panel>
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
    </div>
  );
}

function Panel({ title, description, actions, children }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          {description && <p className="text-sm text-gray-500">{description}</p>}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
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

function KeywordRows({ keywords, tracked, savedKeywords, onTrack, onSaveToList, savingList, canSave }) {
  if (!keywords?.length) {
    return <p className="text-sm text-gray-500">No keywords extracted yet.</p>;
  }

  return (
    <div className="space-y-3">
      {keywords.map((item) => {
        const isSaved = savedKeywords?.has(String(item.keyword || '').toLowerCase());

        return (
          <div key={item.keyword} className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">{item.keyword}</span>
                  <Badge>{item.intent}</Badge>
                  <Badge>Priority {item.priorityScore}</Badge>
                  {typeof item.opportunityScore === 'number' && <Badge>Opportunity {item.opportunityScore}</Badge>}
                  {typeof item.difficultyEstimate === 'number' && <Badge>Difficulty {item.difficultyEstimate}</Badge>}
                  {typeof item.extractionScore === 'number' && <Badge>Extract {item.extractionScore}</Badge>}
                  {typeof item.sourceSiteCount === 'number' && item.sourceSiteCount > 0 && <Badge>Sites {item.sourceSiteCount}</Badge>}
                </div>

                <div className="text-sm text-gray-600">
                  {[
                    item.clusterLabel,
                    item.recommendedPageType,
                    item.wordCount ? `${item.wordCount} words` : null,
                  ].filter(Boolean).join(' • ')}
                </div>

                {(item.notes || []).length > 0 && (
                  <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
                    {item.notes.slice(0, 3).map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
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
                  disabled={savingList || !canSave || isSaved}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                    isSaved
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-indigo-300 hover:text-indigo-700'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isSaved ? 'Saved' : 'Save to list'}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClusterKeywordList({ keywords, tracked, savedKeywords, onTrack, onSaveToList, savingList, canSave }) {
  if (!keywords?.length) {
    return <p className="text-sm text-gray-500">No keywords in this cluster yet.</p>;
  }

  return (
    <div className="space-y-2">
      {keywords.map((item) => {
        const keyword = typeof item === 'string' ? item : item.keyword;
        const isTracked = tracked.has(keyword);
        const isSaved = savedKeywords?.has(String(keyword || '').toLowerCase());

        return (
          <div key={keyword} className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium text-sm text-gray-900">{keyword}</div>
              {typeof item === 'object' && (
                <div className="text-xs text-gray-500">
                  {[item.intent, item.recommendedPageType, item.wordCount ? `${item.wordCount} words` : null].filter(Boolean).join(' • ')}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onTrack(keyword)}
                disabled={isTracked}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  isTracked
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                {isTracked ? 'Tracked' : 'Track'}
              </button>
              <button
                type="button"
                onClick={() => onSaveToList(item)}
                disabled={savingList || !canSave || isSaved}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  isSaved
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-indigo-300 hover:text-indigo-700'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isSaved ? 'Saved' : 'Save to list'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
