import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush,
  BarChart, Bar, Cell,
} from 'recharts';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import { SERP_COUNTRIES } from '../constants/serpCountries';
import {
  createTrackedWebsite,
  deleteTrackedKeyword,
  deleteTrackedWebsite,
  exportRankings,
  getAlerts,
  getJobHistory,
  getLatestRankings,
  getRankingHistory,
  getRankingTrendsSummary,
  getRankTrackerSchedule,
  getTrackedKeywords,
  getTrackedWebsites,
  manualTrackRank,
  markAlertsRead,
  SELECTED_WEBSITE_STORAGE_KEY,
  trackKeyword,
  updateRankTrackerSchedule,
  updateTrackedWebsite,
} from '../services/api';

const STORAGE_KEY = 'seo-tool:rank-tracker:last-session';
const SYNC_EVENT_KEY = 'seo-tool:rank-tracker:sync-event';
const SILENT_REFRESH_COOLDOWN_MS = 5000;
const RANK_TRACKING_DEPTHS = [10, 20, 50, 100];

export default function RankTracker() {
  const [keywords, setKeywords] = useState([]);
  const [websites, setWebsites] = useState([]);
  const [rankings, setRankings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedWebsiteId, setSelectedWebsiteId] = useState(null);
  const [history, setHistory] = useState([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [websiteName, setWebsiteName] = useState('');
  const [websiteDomain, setWebsiteDomain] = useState('');
  const [websiteCountry, setWebsiteCountry] = useState('US');
  const [scheduleTime, setScheduleTime] = useState('06:00');
  const [searchDepth, setSearchDepth] = useState(10);
  const [scheduleInfo, setScheduleInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [websiteSubmitting, setWebsiteSubmitting] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [manualRefreshLoading, setManualRefreshLoading] = useState(false);
  const [websiteBusyId, setWebsiteBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [restoreNotice, setRestoreNotice] = useState(null);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [restoredSelectionDone, setRestoredSelectionDone] = useState(false);

  // New state for improvements
  const [keywordFilter, setKeywordFilter] = useState('');
  const [selectedKeywordIds, setSelectedKeywordIds] = useState(new Set());
  const [checkingKeywordId, setCheckingKeywordId] = useState(null);
  const [fullJobRunning, setFullJobRunning] = useState(false);
  const [fullJobProgress, setFullJobProgress] = useState(null);
  const [activeTab, setActiveTab] = useState('rankings');
  const [trendsSummary, setTrendsSummary] = useState(null);
  const [jobHistoryList, setJobHistoryList] = useState([]);
  const [alertsList, setAlertsList] = useState([]);
  const [unreadAlertCount, setUnreadAlertCount] = useState(0);
  const [dateRange, setDateRange] = useState('90');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const lastSilentRefreshAtRef = useRef(0);
  const autoSelectionWebsiteIdRef = useRef(null);
  const autoSelectionSettledRef = useRef(false);

  // ---- Storage hydration ----
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (parsed?.selectedId != null) setSelectedId(Number(parsed.selectedId));
      if (parsed?.selectedWebsiteId != null) setSelectedWebsiteId(Number(parsed.selectedWebsiteId));
      if (typeof parsed?.newKeyword === 'string') setNewKeyword(parsed.newKeyword);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setStorageHydrated(true);
    }
  }, []);

  useEffect(() => { loadBaseData(); }, []);

  useEffect(() => {
    if (!storageHydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedId, selectedWebsiteId, newKeyword }));
    } catch { /* ignore */ }
  }, [newKeyword, selectedId, selectedWebsiteId, storageHydrated]);

  useEffect(() => {
    try {
      if (selectedWebsiteId == null) {
        window.localStorage.setItem(SELECTED_WEBSITE_STORAGE_KEY, 'all');
      } else {
        window.localStorage.setItem(SELECTED_WEBSITE_STORAGE_KEY, String(selectedWebsiteId));
      }
    } catch {
      // ignore storage failures
    }
  }, [selectedWebsiteId]);

  useEffect(() => {
    if (loading) return;
    if (websites.length === 0) {
      setSelectedWebsiteId(null);
      setRankings([]);
      setHistory([]);
      return;
    }
    const selectedExists = websites.some((item) => String(item.id) === String(selectedWebsiteId));
    if (!selectedExists) {
      const nextWebsite = websites.find((item) => item.is_active) || websites[0];
      setSelectedWebsiteId(nextWebsite.id);
    }
  }, [loading, websites, selectedWebsiteId]);

  useEffect(() => {
    if (!loading) reloadRankings(selectedWebsiteId);
  }, [loading, selectedWebsiteId]);

  useEffect(() => {
    if (!storageHydrated || loading || restoredSelectionDone) return;
    if (!selectedId || !selectedWebsiteId) {
      setRestoredSelectionDone(true);
      return;
    }
    const scopedKeywords = keywords.filter((item) => (
      item.website_id == null || String(item.website_id) === String(selectedWebsiteId)
    ));
    const matchedKeyword = scopedKeywords.find((item) => String(item.id) === String(selectedId));
    const matchedWebsite = websites.find((item) => String(item.id) === String(selectedWebsiteId));
    if (!matchedKeyword || !matchedWebsite) {
      setSelectedId(null);
      setRestoreNotice(null);
      setRestoredSelectionDone(true);
      return;
    }
    handleSelectKeyword(matchedKeyword, { restoring: true, websiteId: selectedWebsiteId }).finally(() => {
      setRestoredSelectionDone(true);
    });
  }, [keywords, loading, restoredSelectionDone, selectedId, selectedWebsiteId, storageHydrated, websites]);

  useEffect(() => {
    if (!restoredSelectionDone || loading || !selectedId || !selectedWebsiteId) return;
    const scopedKeywords = keywords.filter((item) => (
      item.website_id == null || String(item.website_id) === String(selectedWebsiteId)
    ));
    const matchedKeyword = scopedKeywords.find((item) => String(item.id) === String(selectedId));
    if (!matchedKeyword) { setHistory([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const h = await reloadHistory(matchedKeyword.id, selectedWebsiteId, { silent: false });
        if (!cancelled) setHistory(h);
      } catch { if (!cancelled) setHistory([]); }
    })();
    return () => { cancelled = true; };
  }, [keywords, loading, restoredSelectionDone, selectedWebsiteId]);

  useEffect(() => {
    function handleStorage(event) {
      if (event.key !== SYNC_EVENT_KEY) return;
      refreshCurrentSelection({ silent: true });
    }
    function handleFocus() { refreshCurrentSelection({ silent: true }); }
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') refreshCurrentSelection({ silent: true });
    }
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [selectedId, selectedWebsiteId, loading, restoredSelectionDone]);

  useEffect(() => {
    if (String(autoSelectionWebsiteIdRef.current ?? '') !== String(selectedWebsiteId ?? '')) {
      autoSelectionWebsiteIdRef.current = selectedWebsiteId;
      autoSelectionSettledRef.current = false;
    }
    const scopedKeywords = keywords.filter((item) => (
      item.website_id == null || String(item.website_id) === String(selectedWebsiteId)
    ));
    if (loading || rankingsLoading || !selectedWebsiteId || scopedKeywords.length === 0) return;
    const firstRankedKeyword = scopedKeywords.find((kw) =>
      rankings.some((r) => String(r.keyword_id) === String(kw.id) || r.keyword === kw.keyword)
    );
    const selectedHasRanking = selectedId != null && rankings.some((r) => String(r.keyword_id) === String(selectedId));
    if (!firstRankedKeyword) return;
    if (autoSelectionSettledRef.current) return;
    if (selectedId == null || !selectedHasRanking) {
      autoSelectionSettledRef.current = true;
      handleSelectKeyword(firstRankedKeyword, { websiteId: selectedWebsiteId, autoSelected: true });
    } else {
      autoSelectionSettledRef.current = true;
    }
  }, [keywords, loading, rankings, rankingsLoading, selectedId, selectedWebsiteId]);

  // Load tab data
  useEffect(() => {
    if (loading) return;
    if (activeTab === 'trends') loadTrendsSummary();
    if (activeTab === 'jobs') loadJobHistoryData();
    if (activeTab === 'alerts') loadAlertsData();
  }, [activeTab, loading, selectedWebsiteId]);

  // Load unread count on mount
  useEffect(() => {
    if (!loading) {
      getAlerts(1, true).then((r) => setUnreadAlertCount(r.unreadCount || 0)).catch(() => {});
    }
  }, [loading]);

  // ---- Data loaders ----
  async function loadBaseData() {
    setLoading(true);
    setError(null);
    try {
      const [trackedKeywords, trackedWebsites, trackedSchedule] = await Promise.all([
        getTrackedKeywords('all'),
        getTrackedWebsites(),
        getRankTrackerSchedule(),
      ]);
      setKeywords(trackedKeywords);
      setWebsites(trackedWebsites);
      setScheduleTime(trackedSchedule.scheduleTime || '06:00');
      setSearchDepth(trackedSchedule.searchDepth || 10);
      setScheduleInfo(trackedSchedule);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function reloadRankings(websiteId, options = {}) {
    if (!websiteId) { setRankings([]); return []; }
    if (!options.silent) setRankingsLoading(true);
    try {
      const r = await getLatestRankings(websiteId);
      setRankings(r);
      return r;
    } catch (err) {
      setRankings([]);
      if (!options.silent) setError(err.response?.data?.error || err.message);
      return [];
    } finally {
      if (!options.silent) setRankingsLoading(false);
    }
  }

  async function reloadHistory(keywordId, websiteId, options = {}) {
    if (!keywordId || !websiteId) { setHistory([]); return []; }
    if (!options.silent) setHistoryLoading(true);
    try {
      const historyOptions = {};
      if (dateRange === 'custom' && customStartDate && customEndDate) {
        historyOptions.startDate = customStartDate;
        historyOptions.endDate = customEndDate;
      }
      const h = await getRankingHistory(keywordId, Number(dateRange) || 90, websiteId, historyOptions);
      setHistory(h);
      return h;
    } catch (err) {
      setHistory([]);
      if (!options.silent) setError(err.response?.data?.error || err.message);
      return [];
    } finally {
      if (!options.silent) setHistoryLoading(false);
    }
  }

  async function refreshCurrentSelection(options = {}) {
    if (loading || !selectedWebsiteId) return;
    if (options.silent) {
      const now = Date.now();
      if (now - lastSilentRefreshAtRef.current < SILENT_REFRESH_COOLDOWN_MS) return;
      lastSilentRefreshAtRef.current = now;
      if (rankingsLoading || historyLoading || manualRefreshLoading) return;
    }
    await reloadRankings(selectedWebsiteId, options);
    if (selectedId) await reloadHistory(selectedId, selectedWebsiteId, options);
  }

  async function loadTrendsSummary() {
    try { setTrendsSummary(await getRankingTrendsSummary(selectedWebsiteId)); }
    catch { setTrendsSummary(null); }
  }

  async function loadJobHistoryData() {
    try { setJobHistoryList(await getJobHistory()); }
    catch { setJobHistoryList([]); }
  }

  async function loadAlertsData() {
    try {
      const r = await getAlerts(50, false);
      setAlertsList(r.alerts || []);
      setUnreadAlertCount(r.unreadCount || 0);
    } catch { setAlertsList([]); setUnreadAlertCount(0); }
  }

  // ---- Handlers ----
  async function handleAddKeyword(event) {
    event.preventDefault();
    if (!newKeyword.trim() || websites.length === 0) return;
    try {
      await trackKeyword(newKeyword.trim(), null, null, selectedWebsiteId);
      setNewKeyword('');
      setRestoreNotice(null);
      await loadBaseData();
    } catch (err) { setError(err.response?.data?.error || err.message); }
  }

  async function handleDeleteKeyword(id) {
    try {
      await deleteTrackedKeyword(id);
      if (selectedId === id) { setSelectedId(null); setHistory([]); setRestoreNotice(null); }
      setSelectedKeywordIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      await loadBaseData();
    } catch (err) { setError(err.response?.data?.error || err.message); }
  }

  async function handleBulkDeleteKeywords() {
    if (selectedKeywordIds.size === 0) return;
    const ids = [...selectedKeywordIds];
    for (const id of ids) {
      try { await deleteTrackedKeyword(id); } catch { /* continue */ }
    }
    setSelectedKeywordIds(new Set());
    if (selectedId && ids.includes(selectedId)) { setSelectedId(null); setHistory([]); }
    await loadBaseData();
    setRestoreNotice(`Deleted ${ids.length} keyword(s).`);
  }

  async function handleSelectKeyword(keywordItem, options = {}) {
    const websiteId = options.websiteId || selectedWebsiteId;
    if (!websiteId) return;
    setSelectedId(keywordItem.id);
    setError(null);
    try {
      await reloadHistory(keywordItem.id, websiteId, { silent: false });
      setRestoreNotice(
        options.restoring
          ? `Restored ranking history for "${keywordItem.keyword}" on ${getWebsiteLabel(websites, websiteId)}.`
          : options.autoSelected
            ? `Showing current ranking data for "${keywordItem.keyword}" on ${getWebsiteLabel(websites, websiteId)}.`
            : null
      );
    } catch {
      setHistory([]);
      setRestoreNotice(
        options.restoring
          ? `Restored "${keywordItem.keyword}" on ${getWebsiteLabel(websites, websiteId)}, but there is no ranking history yet.`
          : null
      );
    } finally { setHistoryLoading(false); }
  }

  async function handleCheckNowKeyword(keywordItem) {
    if (!selectedWebsiteId || checkingKeywordId || fullJobRunning) return;
    const website = websites.find((w) => String(w.id) === String(selectedWebsiteId));
    if (!website) return;
    setCheckingKeywordId(keywordItem.id);
    setError(null);
    try {
      const result = await manualTrackRank(
        keywordItem.id, keywordItem.keyword, website.target_url || website.domain,
        website.id, website.country
      );
      await reloadRankings(selectedWebsiteId);
      if (selectedId === keywordItem.id) await reloadHistory(keywordItem.id, selectedWebsiteId, { silent: false });
      setRestoreNotice(
        result.position != null
          ? `"${keywordItem.keyword}" is at position #${result.position} on ${website.domain}.`
          : `"${keywordItem.keyword}" was not found in top results for ${website.domain}.`
      );
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setCheckingKeywordId(null); }
  }

  async function handleRunFullJob() {
    if (!selectedWebsiteId || fullJobRunning) return;
    const website = websites.find((w) => String(w.id) === String(selectedWebsiteId));
    if (!website) return;
    const queue = keywordsWithRank
      .filter((kw) => (
        kw.website_id == null || String(kw.website_id) === String(selectedWebsiteId)
      ));
    if (queue.length === 0) {
      setRestoreNotice(`No keywords to check for ${getTrackingTargetLabel(website)}.`);
      return;
    }

    setFullJobRunning(true);
    setError(null);
    setRestoreNotice(null);
    try {
      let found = 0;
      let notFound = 0;
      let failed = 0;

      for (let index = 0; index < queue.length; index += 1) {
        const keywordItem = queue[index];
        setCheckingKeywordId(keywordItem.id);
        setFullJobProgress({
          current: index + 1,
          total: queue.length,
          keyword: keywordItem.keyword,
        });

        try {
          const result = await manualTrackRank(
            keywordItem.id,
            keywordItem.keyword,
            website.target_url || website.domain,
            website.id,
            website.country
          );

          if (result.position != null) found += 1;
          else notFound += 1;
        } catch {
          failed += 1;
        }
      }

      await reloadRankings(selectedWebsiteId);
      if (selectedId) {
        await reloadHistory(selectedId, selectedWebsiteId, { silent: false });
      }
      setRestoreNotice(
        `Full check complete for ${getTrackingTargetLabel(website)}. ` +
        `Checked ${queue.length} keywords. Found: ${found}, Not found: ${notFound}, Failed: ${failed}.`
      );
      if (failed > 0) {
        setError(`${failed} keyword check(s) failed during the full run. Please retry those keywords.`);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setCheckingKeywordId(null);
      setFullJobProgress(null);
      setFullJobRunning(false);
    }
  }

  async function handleManualRefresh() {
    setManualRefreshLoading(true);
    setError(null);
    try {
      await refreshCurrentSelection({ silent: false });
      setRestoreNotice('Rank Tracker reloaded the latest saved ranking data.');
    } finally { setManualRefreshLoading(false); }
  }

  async function handleAddWebsite(event) {
    event.preventDefault();
    if (!websiteDomain.trim()) return;
    setWebsiteSubmitting(true);
    setError(null);
    try {
      const website = await createTrackedWebsite({ name: websiteName, domain: websiteDomain, country: websiteCountry });
      setWebsiteName('');
      setWebsiteDomain('');
      setWebsiteCountry(website.country || 'US');
      const trackedWebsites = await getTrackedWebsites();
      const persistedWebsite = trackedWebsites.find((item) => String(item.id) === String(website.id))
        || trackedWebsites.find((item) => item.domain === website.domain)
        || trackedWebsites.find((item) => item.target_url === website.target_url);
      if (!persistedWebsite) throw new Error('The website was not saved by the server.');
      setWebsites(sortWebsites(trackedWebsites));
      setSelectedWebsiteId(persistedWebsite.id);
      setRestoreNotice(`Added ${getTrackingTargetLabel(persistedWebsite)} to rank tracking.`);
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setWebsiteSubmitting(false); }
  }

  async function handleSaveSchedule(event) {
    event.preventDefault();
    if (!scheduleTime || !searchDepth) return;
    setScheduleSaving(true);
    setError(null);
    try {
      const s = await updateRankTrackerSchedule(scheduleTime, searchDepth);
      setScheduleTime(s.scheduleTime || scheduleTime);
      setSearchDepth(s.searchDepth || searchDepth);
      setScheduleInfo(s);
      setRestoreNotice(`Daily checks at ${s.scheduleTime} (${s.serverTimeZone}), top ${s.searchDepth} results.`);
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setScheduleSaving(false); }
  }

  async function handleToggleWebsite(website) {
    setWebsiteBusyId(website.id);
    setError(null);
    try {
      const updated = await updateTrackedWebsite(website.id, { isActive: !website.is_active });
      setWebsites((c) => sortWebsites(c.map((i) => (i.id === updated.id ? updated : i))));
      setRestoreNotice(updated.is_active ? `${updated.domain} is active.` : `${updated.domain} is paused.`);
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setWebsiteBusyId(null); }
  }

  async function handleChangeWebsiteCountry(website, country) {
    setWebsiteBusyId(website.id);
    setError(null);
    try {
      const updated = await updateTrackedWebsite(website.id, { country });
      setWebsites((c) => sortWebsites(c.map((i) => (i.id === updated.id ? updated : i))));
      setRestoreNotice(`${updated.domain} now tracks in ${getCountryName(updated.country)}.`);
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setWebsiteBusyId(null); }
  }

  async function handleDeleteWebsite(id) {
    setWebsiteBusyId(id);
    setError(null);
    try {
      await deleteTrackedWebsite(id);
      const remaining = websites.filter((i) => i.id !== id);
      setWebsites(sortWebsites(remaining));
      if (selectedWebsiteId === id) {
        const fb = remaining.find((i) => i.is_active) || remaining[0] || null;
        setSelectedWebsiteId(fb?.id || null);
        setHistory([]);
        setRestoreNotice(fb ? `Switched to ${fb.domain}.` : 'Add another site to continue.');
      } else { setRestoreNotice('Website deleted.'); }
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setWebsiteBusyId(null); }
  }

  function handleSelectWebsite(websiteId) {
    setSelectedWebsiteId(websiteId);
    setRestoreNotice(null);
  }

  async function handleExport(format) {
    try {
      const data = await exportRankings(selectedWebsiteId, format);
      const blob = format === 'csv'
        ? new Blob([data], { type: 'text/csv' })
        : new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rankings.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setRestoreNotice(`Rankings exported as ${format.toUpperCase()}.`);
    } catch (err) { setError(err.response?.data?.error || err.message); }
  }

  async function handleMarkAlertsRead() {
    try {
      await markAlertsRead([]);
      setUnreadAlertCount(0);
      setAlertsList((prev) => prev.map((a) => ({ ...a, is_read: 1 })));
    } catch { /* ignore */ }
  }

  function handleToggleKeywordSelection(keywordId) {
    setSelectedKeywordIds((prev) => {
      const n = new Set(prev);
      if (n.has(keywordId)) n.delete(keywordId); else n.add(keywordId);
      return n;
    });
  }

  // ---- Memoized values ----
  const selectedWebsite = useMemo(
    () => websites.find((i) => String(i.id) === String(selectedWebsiteId)) || null,
    [websites, selectedWebsiteId]
  );

  const chartData = useMemo(
    () => history.map((e) => ({ date: e.date, position: e.position })),
    [history]
  );

  const keywordsWithRank = useMemo(() => keywords
    .filter((kw) => (
      selectedWebsiteId != null
        ? kw.website_id == null || String(kw.website_id) === String(selectedWebsiteId)
        : true
    ))
    .map((kw) => {
      const r = rankings.find((i) => i.keyword_id === kw.id || i.keyword === kw.keyword);
      const position = r?.position ?? null;
      const previousPosition = r?.previous_position ?? null;
      const delta = (previousPosition != null && position != null) ? previousPosition - position : null;
      return { ...kw, latestPosition: position, latestDate: r?.date ?? null, previousPosition, delta };
    }), [keywords, rankings, selectedWebsiteId]);

  const filteredKeywords = useMemo(() => {
    if (!keywordFilter.trim()) return keywordsWithRank;
    const f = keywordFilter.trim().toLowerCase();
    return keywordsWithRank.filter((kw) => kw.keyword.toLowerCase().includes(f));
  }, [keywordsWithRank, keywordFilter]);

  useEffect(() => {
    if (!selectedId || !selectedWebsiteId) {
      return;
    }

    const existsInSelectedWebsite = keywordsWithRank.some((item) => String(item.id) === String(selectedId));
    if (!existsInSelectedWebsite) {
      setSelectedId(null);
      setHistory([]);
    }
  }, [keywordsWithRank, selectedId, selectedWebsiteId]);

  function handleSelectAllKeywords() {
    if (selectedKeywordIds.size === filteredKeywords.length) setSelectedKeywordIds(new Set());
    else setSelectedKeywordIds(new Set(filteredKeywords.map((k) => k.id)));
  }

  // ---- Render ----
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Rank Tracker</h2>
      <p className="text-sm text-gray-500 mb-6">
        Track keyword positions across websites with daily automated checks, position change alerts, and trend analysis.
      </p>

      {/* Websites Section */}
      <div className="mb-8 bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-gray-900">Tracked Websites</h3>
          <p className="text-sm text-gray-500">Add domains or page URLs. Rankings are tracked separately per website.</p>
        </div>

        <form onSubmit={handleSaveSchedule} className="rounded-lg border border-gray-200 bg-gray-50 p-4 grid grid-cols-1 gap-3 lg:grid-cols-[220px_160px_auto_1fr]">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Daily Check Time</label>
            <input type="time" step="60" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search Depth</label>
            <select value={searchDepth} onChange={(e) => setSearchDepth(Number(e.target.value))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {RANK_TRACKING_DEPTHS.map((d) => <option key={d} value={d}>Top {d}</option>)}
            </select>
          </div>
          <button type="submit" disabled={scheduleSaving}
            className="px-6 py-2.5 bg-white border border-indigo-200 text-indigo-700 text-sm font-medium rounded-lg hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end">
            {scheduleSaving ? 'Saving...' : 'Save Settings'}
          </button>
          <div className="text-sm text-gray-500 self-center">
            Daily checks scan top {scheduleInfo?.searchDepth || searchDepth} results.
            {scheduleInfo?.serverTimeZone ? ` TZ: ${scheduleInfo.serverTimeZone}.` : ''}
          </div>
        </form>

        <form onSubmit={handleAddWebsite} className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.2fr_220px_auto]">
          <input type="text" value={websiteName} onChange={(e) => setWebsiteName(e.target.value)} placeholder="Name (optional)"
            className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <input type="text" value={websiteDomain} onChange={(e) => setWebsiteDomain(e.target.value)} placeholder="example.com or full URL"
            className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <select value={websiteCountry} onChange={(e) => setWebsiteCountry(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
            {SERP_COUNTRIES.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
          <button type="submit" disabled={websiteSubmitting || !websiteDomain.trim()}
            className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {websiteSubmitting ? 'Adding...' : 'Add Website'}
          </button>
        </form>

        {loading && <LoadingSpinner message="Loading websites and tracked keywords..." />}
        {error && <ErrorAlert message={error} onRetry={loadBaseData} />}
        {restoreNotice && !loading && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-5 py-4 text-sm text-emerald-900">{restoreNotice}</div>
        )}

        {!loading && websites.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 px-5 py-8 text-sm text-gray-500 text-center">
            Add a website before using Rank Tracker.
          </div>
        )}

        {!loading && websites.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {websites.map((website) => {
              const isSelected = String(website.id) === String(selectedWebsiteId);
              const isBusy = websiteBusyId === website.id;
              return (
                <div key={website.id}
                  className={`rounded-lg border px-4 py-4 transition-colors ${isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" onClick={() => handleSelectWebsite(website.id)} className="flex-1 text-left">
                      <div className="font-medium text-gray-900">{website.name || website.domain}</div>
                      <div className="text-sm text-gray-500">{website.domain}</div>
                      {website.target_url && <div className="mt-1 text-xs text-gray-500">Page: {formatTrackingPage(website.target_url)}</div>}
                      <div className="mt-1 text-xs text-gray-500">
                        {website.is_active ? 'Active' : 'Paused'} &middot; {getCountryName(website.country)}
                      </div>
                    </button>
                    <div className="flex items-center gap-3">
                      <select value={website.country || 'US'} onChange={(e) => { e.stopPropagation(); handleChangeWebsiteCountry(website, e.target.value); }}
                        disabled={isBusy} className="px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60">
                        {SERP_COUNTRIES.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
                      </select>
                      <button type="button" role="switch" aria-checked={website.is_active} onClick={() => handleToggleWebsite(website)} disabled={isBusy}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${website.is_active ? 'bg-indigo-600' : 'bg-gray-300'} ${isBusy ? 'opacity-60 cursor-not-allowed' : ''}`}
                        title={website.is_active ? 'Pause' : 'Resume'}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${website.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                      <button type="button" onClick={() => handleDeleteWebsite(website.id)} disabled={isBusy}
                        className="text-gray-300 hover:text-red-500 text-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed" title="Delete">&times;</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Keyword */}
      <form onSubmit={handleAddKeyword} className="flex gap-3 mb-6">
        <input type="text" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)}
          placeholder={websites.length === 0 ? 'Add a website first...' : 'Add a keyword to track...'}
          className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          disabled={websites.length === 0} />
        <button type="submit" disabled={!newKeyword.trim() || websites.length === 0}
          className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          Add Keyword
        </button>
      </form>

      {/* Tab Navigation */}
      {!loading && (
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          {[
            { key: 'rankings', label: 'Rankings' },
            { key: 'trends', label: 'Trends Dashboard' },
            { key: 'jobs', label: 'Job History' },
            { key: 'alerts', label: `Alerts${unreadAlertCount > 0 ? ` (${unreadAlertCount})` : ''}` },
          ].map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Rankings Tab */}
      {!loading && activeTab === 'rankings' && (
        <>
          {/* Action Bar */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <input type="text" value={keywordFilter} onChange={(e) => setKeywordFilter(e.target.value)}
              placeholder="Filter keywords..." className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-48" />
            <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 180 days</option>
              <option value="365">Last year</option>
              <option value="custom">Custom range</option>
            </select>
            {dateRange === 'custom' && (
              <>
                <input type="date" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                <input type="date" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </>
            )}
            <div className="flex-1" />
            <button type="button" onClick={handleManualRefresh} disabled={!selectedWebsite || manualRefreshLoading || rankingsLoading}
              className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-60">
              {manualRefreshLoading ? 'Refreshing...' : 'Refresh Data'}
            </button>
            <button type="button" onClick={handleRunFullJob} disabled={!selectedWebsite || fullJobRunning}
              className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-medium text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-60">
              {fullJobRunning && fullJobProgress
                ? `Running ${fullJobProgress.current}/${fullJobProgress.total}`
                : fullJobRunning
                  ? 'Running...'
                  : 'Run Full Check'}
            </button>
            {fullJobRunning && fullJobProgress && (
              <span className="text-xs text-gray-500">
                Checking: {fullJobProgress.keyword}
              </span>
            )}
            <button type="button" onClick={() => handleExport('csv')}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50">Export CSV</button>
            <button type="button" onClick={() => handleExport('json')}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50">Export JSON</button>
            {selectedKeywordIds.size > 0 && (
              <button type="button" onClick={handleBulkDeleteKeywords}
                className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:border-red-300 hover:bg-red-50">
                Delete Selected ({selectedKeywordIds.size})
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Keywords List */}
            <div className="lg:col-span-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">Keywords ({filteredKeywords.length})</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      {selectedWebsite ? `Rankings for ${getTrackingTargetLabel(selectedWebsite)}` : 'Select a website.'}
                    </p>
                  </div>
                  {filteredKeywords.length > 0 && (
                    <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                      <input type="checkbox" checked={selectedKeywordIds.size === filteredKeywords.length && filteredKeywords.length > 0}
                        onChange={handleSelectAllKeywords} className="rounded border-gray-300" />
                      All
                    </label>
                  )}
                </div>
              </div>

              {filteredKeywords.length === 0 ? (
                <p className="text-sm text-gray-400 px-5 py-8 text-center">
                  {keywordsWithRank.length === 0 ? 'No keywords tracked for this website yet.' : 'No keywords match your filter.'}
                </p>
              ) : (
                <div className="divide-y divide-gray-100 max-h-[520px] overflow-y-auto">
                  {filteredKeywords.map((kw) => (
                    <div key={kw.id}
                      className={`flex items-center gap-2 px-4 py-3 transition-colors ${selectedId === kw.id ? 'bg-indigo-50' : 'hover:bg-gray-50'} ${selectedWebsite ? 'cursor-pointer' : 'cursor-default'}`}
                      onClick={() => selectedWebsite && handleSelectKeyword(kw)}>
                      <input type="checkbox" checked={selectedKeywordIds.has(kw.id)}
                        onChange={(e) => { e.stopPropagation(); handleToggleKeywordSelection(kw.id); }}
                        className="rounded border-gray-300 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{kw.keyword}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {renderPositionBadge(kw.latestPosition, kw.delta)}
                          {kw.latestDate && <span className="text-xs text-gray-400">{kw.latestDate}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); handleCheckNowKeyword(kw); }}
                          disabled={fullJobRunning || checkingKeywordId === kw.id || !selectedWebsite}
                          className="text-xs px-2 py-1 rounded border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                          title="Check position now">
                          {checkingKeywordId === kw.id ? '...' : 'Check'}
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteKeyword(kw.id); }}
                          className="text-gray-300 hover:text-red-500 text-lg transition-colors" title="Remove">&times;</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Chart */}
            <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-6">
              {!selectedWebsite ? (
                <div className="text-center py-16 text-gray-400 text-sm">Add and select a website to view ranking history.</div>
              ) : historyLoading || rankingsLoading ? (
                <LoadingSpinner message="Loading ranking data..." />
              ) : selectedId ? (
                chartData.length > 0 ? (
                  <>
                    <h3 className="font-semibold text-gray-900 mb-1">
                      Ranking History &mdash; {keywordsWithRank.find((i) => i.id === selectedId)?.keyword}
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">
                      {selectedWebsite.domain}
                      {selectedWebsite.target_url ? ` · ${formatTrackingPage(selectedWebsite.target_url)}` : ''}
                      {` · ${getCountryName(selectedWebsite.country)}`}
                      {!selectedWebsite.is_active ? ' · Paused' : ''}
                    </p>
                    <ResponsiveContainer width="100%" height={350}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis reversed domain={[1, 'auto']} label={{ value: 'Position', angle: -90, position: 'insideLeft' }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="position" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} name="Position" />
                        {chartData.length > 10 && <Brush dataKey="date" height={30} stroke="#6366f1" travellerWidth={8} />}
                      </LineChart>
                    </ResponsiveContainer>
                  </>
                ) : (
                  <div className="text-center py-16 text-gray-400 text-sm">
                    No ranking history for this keyword on {getTrackingTargetLabel(selectedWebsite)}.
                  </div>
                )
              ) : (
                <div className="text-center py-16 text-gray-400 text-sm">Select a keyword to view ranking history.</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Trends Dashboard Tab */}
      {!loading && activeTab === 'trends' && (
        <div className="space-y-6">
          {!trendsSummary ? <LoadingSpinner message="Loading trends..." /> : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {[
                  { label: 'Total Keywords', value: trendsSummary.totalKeywords, color: 'text-gray-900' },
                  { label: 'Ranked', value: trendsSummary.ranked, color: 'text-blue-700' },
                  { label: 'Not Ranked', value: trendsSummary.notRanked, color: 'text-gray-500' },
                  { label: 'Improved', value: trendsSummary.improved, color: 'text-emerald-700' },
                  { label: 'Declined', value: trendsSummary.declined, color: 'text-red-600' },
                  { label: 'Unchanged', value: trendsSummary.unchanged, color: 'text-gray-500' },
                ].map((s) => (
                  <div key={s.label} className="bg-white rounded-lg border border-gray-200 p-4">
                    <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 mb-1">Avg Position</p>
                  <p className="text-2xl font-bold text-gray-900">{trendsSummary.avgPosition ?? 'N/A'}</p>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 mb-1">Best Position</p>
                  <p className="text-2xl font-bold text-emerald-700">#{trendsSummary.bestPosition ?? 'N/A'}</p>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 mb-1">Worst Position</p>
                  <p className="text-2xl font-bold text-red-600">#{trendsSummary.worstPosition ?? 'N/A'}</p>
                </div>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Position Distribution</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={[
                    { name: 'Top 3', count: trendsSummary.top3 },
                    { name: 'Top 10', count: trendsSummary.top10 - trendsSummary.top3 },
                    { name: 'Top 20', count: trendsSummary.top20 - trendsSummary.top10 },
                    { name: '20+', count: trendsSummary.ranked - trendsSummary.top20 },
                    { name: 'Not Ranked', count: trendsSummary.notRanked },
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" name="Keywords">
                      {['#10b981', '#3b82f6', '#f59e0b', '#6b7280', '#d1d5db'].map((color, i) => (
                        <Cell key={i} fill={color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      )}

      {/* Job History Tab */}
      {!loading && activeTab === 'jobs' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Job Run History</h3>
            <button type="button" onClick={loadJobHistoryData} className="text-xs text-indigo-600 hover:text-indigo-700">Refresh</button>
          </div>
          {jobHistoryList.length === 0 ? (
            <p className="text-sm text-gray-400 px-5 py-8 text-center">No job runs recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500">Source</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500">Status</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500">Keywords</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500">Websites</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500">Updated</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500">Found</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500">Failed</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500">Started</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {jobHistoryList.map((job) => {
                    const dur = job.finished_at && job.started_at ? Math.round((new Date(job.finished_at) - new Date(job.started_at)) / 1000) : null;
                    return (
                      <tr key={job.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded ${job.source === 'Manual' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-700'}`}>{job.source}</span></td>
                        <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded ${job.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : job.status === 'running' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{job.status}</span></td>
                        <td className="px-4 py-3 text-gray-700">{job.processed_keywords}</td>
                        <td className="px-4 py-3 text-gray-700">{job.processed_websites}</td>
                        <td className="px-4 py-3 text-gray-700">{job.updated_count}</td>
                        <td className="px-4 py-3 text-emerald-600">{job.matched_count}</td>
                        <td className="px-4 py-3 text-red-500">{job.failed_count}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatSavedAt(job.started_at)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{dur != null ? `${dur}s` : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Alerts Tab */}
      {!loading && activeTab === 'alerts' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Ranking Alerts</h3>
            <div className="flex items-center gap-2">
              {unreadAlertCount > 0 && (
                <button type="button" onClick={handleMarkAlertsRead} className="text-xs text-indigo-600 hover:text-indigo-700">Mark all read</button>
              )}
              <button type="button" onClick={loadAlertsData} className="text-xs text-indigo-600 hover:text-indigo-700">Refresh</button>
            </div>
          </div>
          {alertsList.length === 0 ? (
            <p className="text-sm text-gray-400 px-5 py-8 text-center">
              No alerts yet. Alerts trigger when a keyword moves 5+ positions.
            </p>
          ) : (
            <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
              {alertsList.map((alert) => (
                <div key={alert.id} className={`px-5 py-3 ${alert.is_read ? '' : 'bg-indigo-50'}`}>
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 text-lg ${alert.alert_type === 'improved' ? 'text-emerald-500' : 'text-red-500'}`}>
                      {alert.alert_type === 'improved' ? '\u2191' : '\u2193'}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm text-gray-800">{alert.message}</p>
                      <p className="text-xs text-gray-400 mt-1">{formatSavedAt(alert.created_at)}</p>
                    </div>
                    {!alert.is_read && <span className="w-2 h-2 rounded-full bg-indigo-500 mt-2 shrink-0" />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Render helpers ----

function renderDelta(delta) {
  if (delta == null) return null;
  if (delta > 0) return <span className="text-emerald-600 font-medium ml-1" title={`Improved by ${delta}`}>+{delta}</span>;
  if (delta < 0) return <span className="text-red-500 font-medium ml-1" title={`Dropped by ${Math.abs(delta)}`}>{delta}</span>;
  return <span className="text-gray-400 ml-1" title="No change">=</span>;
}

function renderPositionBadge(position, delta) {
  if (position == null) {
    return <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">Not ranked</span>;
  }
  const color = position <= 3 ? 'bg-emerald-100 text-emerald-800'
    : position <= 10 ? 'bg-blue-100 text-blue-800'
    : position <= 20 ? 'bg-yellow-100 text-yellow-800'
    : 'bg-gray-100 text-gray-700';
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${color}`}>
      #{position}{renderDelta(delta)}
    </span>
  );
}

function getWebsiteLabel(websites, websiteId) {
  const website = websites.find((item) => String(item.id) === String(websiteId));
  return website ? getTrackingTargetLabel(website) : 'the selected website';
}

function sortWebsites(websites) {
  return [...websites].sort((left, right) => {
    const leftCreated = new Date(left.created_at || 0).getTime();
    const rightCreated = new Date(right.created_at || 0).getTime();
    if (rightCreated !== leftCreated) return rightCreated - leftCreated;
    return Number(right.id || 0) - Number(left.id || 0);
  });
}

function getCountryName(countryCode) {
  return SERP_COUNTRIES.find((item) => item.code === String(countryCode || 'US').toUpperCase())?.name || 'United States';
}

function getTrackingTargetLabel(website) {
  if (!website) return 'the selected website';
  return website.target_url || website.domain;
}

function formatTrackingPage(targetUrl) {
  if (!targetUrl) return '';
  try { return new URL(targetUrl).pathname || '/'; }
  catch { return targetUrl; }
}

function formatSavedAt(value) {
  if (!value) return 'recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleString();
}
