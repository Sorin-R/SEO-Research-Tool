import { useEffect, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import { SERP_COUNTRIES } from '../constants/serpCountries';
import {
  createTrackedWebsite,
  deleteTrackedKeyword,
  deleteTrackedWebsite,
  getLatestRankings,
  getRankingHistory,
  getRankTrackerSchedule,
  getTrackedKeywords,
  getTrackedWebsites,
  trackKeyword,
  updateRankTrackerSchedule,
  updateTrackedWebsite,
} from '../services/api';

const STORAGE_KEY = 'seo-tool:rank-tracker:last-session';
const SYNC_EVENT_KEY = 'seo-tool:rank-tracker:sync-event';
const SILENT_REFRESH_COOLDOWN_MS = 5000;

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
  const lastSilentRefreshAtRef = useRef(0);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);

      if (parsed?.selectedId != null) {
        setSelectedId(Number(parsed.selectedId));
      }

      if (parsed?.selectedWebsiteId != null) {
        setSelectedWebsiteId(Number(parsed.selectedWebsiteId));
      }

      if (typeof parsed?.newKeyword === 'string') {
        setNewKeyword(parsed.newKeyword);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setStorageHydrated(true);
    }
  }, []);

  useEffect(() => {
    loadBaseData();
  }, []);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          selectedId,
          selectedWebsiteId,
          newKeyword,
        })
      );
    } catch {
      // Ignore storage quota issues.
    }
  }, [newKeyword, selectedId, selectedWebsiteId, storageHydrated]);

  useEffect(() => {
    if (loading) {
      return;
    }

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
    if (!loading) {
      reloadRankings(selectedWebsiteId);
    }
  }, [loading, selectedWebsiteId]);

  useEffect(() => {
    if (!storageHydrated || loading || restoredSelectionDone) {
      return;
    }

    if (!selectedId || !selectedWebsiteId) {
      setRestoredSelectionDone(true);
      return;
    }

    const matchedKeyword = keywords.find((item) => String(item.id) === String(selectedId));
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
    if (!restoredSelectionDone || loading || !selectedId || !selectedWebsiteId) {
      return;
    }

    const matchedKeyword = keywords.find((item) => String(item.id) === String(selectedId));

    if (!matchedKeyword) {
      setHistory([]);
      return;
    }

    let cancelled = false;

    async function reloadSelectedHistory() {
      try {
        const nextHistory = await reloadHistory(matchedKeyword.id, selectedWebsiteId, { silent: false });
        if (!cancelled) {
          setHistory(nextHistory);
        }
      } catch {
        if (!cancelled) {
          setHistory([]);
        }
      }
    }

    reloadSelectedHistory();

    return () => {
      cancelled = true;
    };
  }, [keywords, loading, restoredSelectionDone, selectedWebsiteId]);

  useEffect(() => {
    function handleStorage(event) {
      if (event.key !== SYNC_EVENT_KEY) {
        return;
      }

      refreshCurrentSelection({ silent: true });
    }

    function handleFocus() {
      refreshCurrentSelection({ silent: true });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refreshCurrentSelection({ silent: true });
      }
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

  async function loadBaseData() {
    setLoading(true);
    setError(null);

    try {
      const [trackedKeywords, trackedWebsites, trackedSchedule] = await Promise.all([
        getTrackedKeywords(),
        getTrackedWebsites(),
        getRankTrackerSchedule(),
      ]);

      setKeywords(trackedKeywords);
      setWebsites(trackedWebsites);
      setScheduleTime(trackedSchedule.scheduleTime || '06:00');
      setScheduleInfo(trackedSchedule);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function reloadRankings(websiteId, options = {}) {
    if (!websiteId) {
      setRankings([]);
      return [];
    }

    if (!options.silent) {
      setRankingsLoading(true);
    }

    try {
      const nextRankings = await getLatestRankings(websiteId);
      setRankings(nextRankings);
      return nextRankings;
    } catch (err) {
      setRankings([]);
      if (!options.silent) {
        setError(err.response?.data?.error || err.message);
      }
      return [];
    } finally {
      if (!options.silent) {
        setRankingsLoading(false);
      }
    }
  }

  async function reloadHistory(keywordId, websiteId, options = {}) {
    if (!keywordId || !websiteId) {
      setHistory([]);
      return [];
    }

    if (!options.silent) {
      setHistoryLoading(true);
    }

    try {
      const nextHistory = await getRankingHistory(keywordId, 90, websiteId);
      setHistory(nextHistory);
      return nextHistory;
    } catch (err) {
      setHistory([]);
      if (!options.silent) {
        setError(err.response?.data?.error || err.message);
      }
      return [];
    } finally {
      if (!options.silent) {
        setHistoryLoading(false);
      }
    }
  }

  async function refreshCurrentSelection(options = {}) {
    if (loading || !selectedWebsiteId) {
      return;
    }

    if (options.silent) {
      const now = Date.now();

      if (now - lastSilentRefreshAtRef.current < SILENT_REFRESH_COOLDOWN_MS) {
        return;
      }

      lastSilentRefreshAtRef.current = now;

      if (rankingsLoading || historyLoading || manualRefreshLoading) {
        return;
      }
    }

    await reloadRankings(selectedWebsiteId, options);

    if (selectedId) {
      await reloadHistory(selectedId, selectedWebsiteId, options);
    }
  }

  async function handleAddKeyword(event) {
    event.preventDefault();

    if (!newKeyword.trim() || websites.length === 0) {
      return;
    }

    try {
      await trackKeyword(newKeyword.trim());
      setNewKeyword('');
      setRestoreNotice(null);
      await loadBaseData();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  async function handleDeleteKeyword(id) {
    try {
      await deleteTrackedKeyword(id);

      if (selectedId === id) {
        setSelectedId(null);
        setHistory([]);
        setRestoreNotice(null);
      }

      await loadBaseData();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  async function handleSelectKeyword(keywordItem, options = {}) {
    const websiteId = options.websiteId || selectedWebsiteId;

    if (!websiteId) {
      return;
    }

    setSelectedId(keywordItem.id);
    setError(null);

    try {
      await reloadHistory(keywordItem.id, websiteId, { silent: false });
      setRestoreNotice(
        options.restoring
          ? `Restored ranking history for "${keywordItem.keyword}" on ${getWebsiteLabel(websites, websiteId)}.`
          : null
      );
    } catch {
      setHistory([]);
      setRestoreNotice(
        options.restoring
          ? `Restored "${keywordItem.keyword}" on ${getWebsiteLabel(websites, websiteId)}, but there is no ranking history yet.`
          : null
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleManualRefresh() {
    setManualRefreshLoading(true);
    setError(null);

    try {
      await refreshCurrentSelection({ silent: false });
      setRestoreNotice('Rank Tracker reloaded the latest saved ranking data.');
    } finally {
      setManualRefreshLoading(false);
    }
  }

  async function handleAddWebsite(event) {
    event.preventDefault();

    if (!websiteDomain.trim()) {
      return;
    }

    setWebsiteSubmitting(true);
    setError(null);

    try {
      const website = await createTrackedWebsite({
        name: websiteName,
        domain: websiteDomain,
        country: websiteCountry,
      });

      setWebsiteName('');
      setWebsiteDomain('');
      setWebsiteCountry(website.country || 'US');

      const trackedWebsites = await getTrackedWebsites();
      const persistedWebsite = trackedWebsites.find((item) => String(item.id) === String(website.id))
        || trackedWebsites.find((item) => item.domain === website.domain)
        || trackedWebsites.find((item) => item.target_url === website.target_url);

      if (!persistedWebsite) {
        throw new Error('The website was not saved by the server. Check the runtime log and try again.');
      }

      setWebsites(sortWebsites(trackedWebsites));
      setSelectedWebsiteId(persistedWebsite.id);
      setRestoreNotice(
        `Added ${getTrackingTargetLabel(persistedWebsite)} to rank tracking for ${getCountryName(persistedWebsite.country)}.`
      );
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setWebsiteSubmitting(false);
    }
  }

  async function handleSaveSchedule(event) {
    event.preventDefault();

    if (!scheduleTime) {
      return;
    }

    setScheduleSaving(true);
    setError(null);

    try {
      const updatedSchedule = await updateRankTrackerSchedule(scheduleTime);
      setScheduleTime(updatedSchedule.scheduleTime || scheduleTime);
      setScheduleInfo(updatedSchedule);
      setRestoreNotice(
        `Daily rank checks will run at ${updatedSchedule.scheduleTime} (${updatedSchedule.serverTimeZone}).`
      );
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setScheduleSaving(false);
    }
  }

  async function handleToggleWebsite(website) {
    setWebsiteBusyId(website.id);
    setError(null);

    try {
      const updated = await updateTrackedWebsite(website.id, {
        isActive: !website.is_active,
      });

      setWebsites((current) => sortWebsites(
        current.map((item) => (item.id === updated.id ? updated : item))
      ));

      setRestoreNotice(
        updated.is_active
          ? `${updated.domain} is active and will be tracked.`
          : `${updated.domain} is paused and will stop tracking until re-enabled.`
      );
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setWebsiteBusyId(null);
    }
  }

  async function handleChangeWebsiteCountry(website, country) {
    setWebsiteBusyId(website.id);
    setError(null);

    try {
      const updated = await updateTrackedWebsite(website.id, {
        country,
      });

      setWebsites((current) => sortWebsites(
        current.map((item) => (item.id === updated.id ? updated : item))
      ));

      setRestoreNotice(
        `${updated.domain} will now track rankings in ${getCountryName(updated.country)}.`
      );
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setWebsiteBusyId(null);
    }
  }

  async function handleDeleteWebsite(id) {
    setWebsiteBusyId(id);
    setError(null);

    try {
      await deleteTrackedWebsite(id);

      const remainingWebsites = websites.filter((item) => item.id !== id);
      setWebsites(sortWebsites(remainingWebsites));

      if (selectedWebsiteId === id) {
        const fallbackWebsite = remainingWebsites.find((item) => item.is_active) || remainingWebsites[0] || null;
        setSelectedWebsiteId(fallbackWebsite?.id || null);
        setHistory([]);
        setRestoreNotice(fallbackWebsite
          ? `Deleted the website. Switched to ${fallbackWebsite.domain}.`
          : 'Deleted the website. Add another site to continue rank tracking.');
      } else {
        setRestoreNotice('Website deleted.');
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setWebsiteBusyId(null);
    }
  }

  function handleSelectWebsite(websiteId) {
    setSelectedWebsiteId(websiteId);
    setRestoreNotice(null);
  }

  const selectedWebsite = websites.find((item) => String(item.id) === String(selectedWebsiteId)) || null;
  const chartData = history.map((entry) => ({
    date: entry.date,
    position: entry.position,
  }));
  const keywordsWithRank = keywords.map((keywordItem) => {
    const ranking = rankings.find((item) => item.keyword_id === keywordItem.id || item.keyword === keywordItem.keyword);

    return {
      ...keywordItem,
      latestPosition: ranking?.position ?? null,
      latestDate: ranking?.date ?? null,
    };
  });

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Rank Tracker</h2>
      <p className="text-sm text-gray-500 mb-6">
        Add one or more websites or landing pages, choose the tracking country for each one, pause or resume tracking with the slider, and monitor keyword positions per site.
      </p>

      <div className="mb-8 bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-gray-900">Tracked Websites</h3>
          <p className="text-sm text-gray-500">
            Rank tracking runs only for active websites. Add domains or full page URLs, then switch between them below.
          </p>
        </div>

        <form
          onSubmit={handleSaveSchedule}
          className="rounded-lg border border-gray-200 bg-gray-50 p-4 grid grid-cols-1 gap-3 lg:grid-cols-[220px_auto_1fr]"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Daily Check Time</label>
            <input
              type="time"
              step="60"
              value={scheduleTime}
              onChange={(event) => setScheduleTime(event.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit"
            disabled={scheduleSaving || !scheduleTime}
            className="px-6 py-2.5 bg-white border border-indigo-200 text-indigo-700 text-sm font-medium rounded-lg hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
          >
            {scheduleSaving ? 'Saving...' : 'Save Timer'}
          </button>
          <div className="text-sm text-gray-500 self-center">
            Automatic rank checks run once per day using the server timezone.
            {scheduleInfo?.serverTimeZone ? ` Current timezone: ${scheduleInfo.serverTimeZone}.` : ''}
            {scheduleInfo?.updatedAt ? ` Updated ${formatSavedAt(scheduleInfo.updatedAt)}.` : ''}
          </div>
        </form>

        <form onSubmit={handleAddWebsite} className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.2fr_220px_auto]">
          <input
            type="text"
            value={websiteName}
            onChange={(event) => setWebsiteName(event.target.value)}
            placeholder="Website name (optional)"
            className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="text"
            value={websiteDomain}
            onChange={(event) => setWebsiteDomain(event.target.value)}
            placeholder="example.com or https://example.com/service-page"
            className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <select
            value={websiteCountry}
            onChange={(event) => setWebsiteCountry(event.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {SERP_COUNTRIES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={websiteSubmitting || !websiteDomain.trim()}
            className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {websiteSubmitting ? 'Adding...' : 'Add Website'}
          </button>
        </form>

        {loading && <LoadingSpinner message="Loading websites and tracked keywords..." />}
        {error && <ErrorAlert message={error} onRetry={loadBaseData} />}
        {restoreNotice && !loading && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-5 py-4 text-sm text-emerald-900">
            {restoreNotice}
          </div>
        )}

        {!loading && websites.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 px-5 py-8 text-sm text-gray-500 text-center">
            Add a website before using Rank Tracker. Rankings are recorded separately for each website.
          </div>
        )}

        {!loading && websites.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {websites.map((website) => {
              const isSelected = String(website.id) === String(selectedWebsiteId);
              const isBusy = websiteBusyId === website.id;

              return (
                <div
                  key={website.id}
                  className={`rounded-lg border px-4 py-4 transition-colors ${
                    isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => handleSelectWebsite(website.id)}
                      className="flex-1 text-left"
                    >
                      <div className="font-medium text-gray-900">{website.name || website.domain}</div>
                      <div className="text-sm text-gray-500">{website.domain}</div>
                      {website.target_url && (
                        <div className="mt-1 text-xs text-gray-500">
                          Tracking page: {formatTrackingPage(website.target_url)}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-gray-500">
                        {website.is_active ? 'Tracking enabled' : 'Tracking paused'}
                        {` · ${getCountryName(website.country)}`}
                      </div>
                    </button>

                    <div className="flex items-center gap-3">
                      <select
                        value={website.country || 'US'}
                        onChange={(event) => {
                          event.stopPropagation();
                          handleChangeWebsiteCountry(website, event.target.value);
                        }}
                        disabled={isBusy}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
                        title="Tracking country"
                      >
                        {SERP_COUNTRIES.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.name}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={website.is_active}
                        onClick={() => handleToggleWebsite(website)}
                        disabled={isBusy}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          website.is_active ? 'bg-indigo-600' : 'bg-gray-300'
                        } ${isBusy ? 'opacity-60 cursor-not-allowed' : ''}`}
                        title={website.is_active ? 'Pause tracking' : 'Resume tracking'}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            website.is_active ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteWebsite(website.id)}
                        disabled={isBusy}
                        className="text-gray-300 hover:text-red-500 text-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        title="Delete website"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <form onSubmit={handleAddKeyword} className="flex gap-3 mb-8">
        <input
          type="text"
          value={newKeyword}
          onChange={(event) => setNewKeyword(event.target.value)}
          placeholder={websites.length === 0 ? 'Add a website first...' : 'Add a keyword to track...'}
          className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          disabled={websites.length === 0}
        />
        <button
          type="submit"
          disabled={!newKeyword.trim() || websites.length === 0}
          className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          Add Keyword
        </button>
      </form>

      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-gray-900">Tracked Keywords ({keywords.length})</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {selectedWebsite
                      ? `Showing latest rankings for ${getTrackingTargetLabel(selectedWebsite)}`
                      : 'Select or add a website to view rankings.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  disabled={!selectedWebsite || manualRefreshLoading || rankingsLoading || historyLoading}
                  className="shrink-0 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {manualRefreshLoading ? 'Refreshing...' : 'Refresh Now'}
                </button>
              </div>
            </div>

            {keywords.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-8 text-center">
                No keywords tracked yet. Add one above.
              </p>
            ) : (
              <div className="divide-y divide-gray-100 max-h-[520px] overflow-y-auto">
                {keywordsWithRank.map((keywordItem) => (
                  <div
                    key={keywordItem.id}
                    className={`flex items-center justify-between px-5 py-3 transition-colors ${
                      selectedId === keywordItem.id ? 'bg-indigo-50' : 'hover:bg-gray-50'
                    } ${selectedWebsite ? 'cursor-pointer' : 'cursor-default'}`}
                    onClick={() => selectedWebsite && handleSelectKeyword(keywordItem)}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800">{keywordItem.keyword}</p>
                      <p className="text-xs text-gray-400">
                        {selectedWebsite
                          ? keywordItem.latestPosition
                            ? `Position: #${keywordItem.latestPosition}`
                            : 'No ranking data for this website'
                          : 'Select a website first'}
                        {keywordItem.difficulty != null && ` · Difficulty: ${keywordItem.difficulty}`}
                      </p>
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeleteKeyword(keywordItem.id);
                      }}
                      className="text-gray-300 hover:text-red-500 text-lg transition-colors"
                      title="Remove keyword"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-6">
            {!selectedWebsite ? (
              <div className="text-center py-16 text-gray-400 text-sm">
                Add and select a website to start viewing ranking history.
              </div>
            ) : historyLoading || rankingsLoading ? (
              <LoadingSpinner message="Loading ranking data..." />
            ) : selectedId ? (
              chartData.length > 0 ? (
                <>
              <h3 className="font-semibold text-gray-900 mb-1">
                Ranking History — {keywords.find((item) => item.id === selectedId)?.keyword}
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Website: {selectedWebsite.domain}
                {selectedWebsite.target_url ? ` · Page: ${formatTrackingPage(selectedWebsite.target_url)}` : ''}
                {` · Country: ${getCountryName(selectedWebsite.country)}`}
                {!selectedWebsite.is_active ? ' · Tracking paused' : ''}
              </p>
                  <ResponsiveContainer width="100%" height={350}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis reversed domain={[1, 'auto']} label={{ value: 'Position', angle: -90, position: 'insideLeft' }} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="position"
                        stroke="#6366f1"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        name="Position"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <div className="text-center py-16 text-gray-400 text-sm">
                  No ranking history yet for this keyword on {getTrackingTargetLabel(selectedWebsite)}. Daily tracking only runs while the website is active.
                </div>
              )
            ) : (
              <div className="text-center py-16 text-gray-400 text-sm">
                Select a keyword to view ranking history for {getTrackingTargetLabel(selectedWebsite)}.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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

    if (rightCreated !== leftCreated) {
      return rightCreated - leftCreated;
    }

    return Number(right.id || 0) - Number(left.id || 0);
  });
}

function getCountryName(countryCode) {
  return SERP_COUNTRIES.find((item) => item.code === String(countryCode || 'US').toUpperCase())?.name || 'United States';
}

function getTrackingTargetLabel(website) {
  if (!website) {
    return 'the selected website';
  }

  return website.target_url || website.domain;
}

function formatTrackingPage(targetUrl) {
  if (!targetUrl) {
    return '';
  }

  try {
    return new URL(targetUrl).pathname || '/';
  } catch {
    return targetUrl;
  }
}

function formatSavedAt(value) {
  if (!value) {
    return 'recently';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'recently';
  }

  return date.toLocaleString();
}
