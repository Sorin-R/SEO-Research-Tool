import { useEffect, useMemo, useState } from 'react';
import { SERP_COUNTRIES } from '../constants/serpCountries';
import {
  archiveTrackedWebsite,
  createTrackedWebsite,
  deleteTrackedWebsite,
  getTrackedWebsites,
  testGSCProviderConnection,
  updateTrackedWebsite,
} from '../services/api';
import { useWebsiteContext } from '../context/WebsiteContext';
import ErrorAlert from '../components/ErrorAlert';
import LoadingSpinner from '../components/LoadingSpinner';

function normalizeTags(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function tagsToText(tags) {
  return Array.isArray(tags) ? tags.join(', ') : '';
}

export default function Websites() {
  const { selectedWebsiteId, setSelectedWebsiteId, refreshWebsites: refreshGlobalWebsites } = useWebsiteContext();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [testingGscId, setTestingGscId] = useState(null);
  const [gscTests, setGscTests] = useState({});
  const [error, setError] = useState(null);

  const [domain, setDomain] = useState('');
  const [projectName, setProjectName] = useState('');
  const [country, setCountry] = useState('US');
  const [tagsInput, setTagsInput] = useState('');
  const [gscSiteUrl, setGscSiteUrl] = useState('');

  useEffect(() => {
    loadWebsites();
  }, [statusFilter]);

  async function loadWebsites(options = {}) {
    setLoading(true);
    setError(null);
    try {
      const includeArchived = statusFilter !== 'active';
      const archivedOnly = statusFilter === 'archived';
      const websites = await getTrackedWebsites({
        includeArchived,
        archivedOnly,
        search: options.search ?? search,
      });
      setItems(Array.isArray(websites) ? websites : []);
      await refreshGlobalWebsites();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load websites.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (!domain.trim()) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await createTrackedWebsite({
        domain: domain.trim(),
        projectName: projectName.trim(),
        country,
        tags: normalizeTags(tagsInput),
        gscSiteUrl: gscSiteUrl.trim() || null,
      });
      setDomain('');
      setProjectName('');
      setCountry('US');
      setTagsInput('');
      setGscSiteUrl('');
      await loadWebsites();
      if (created?.id) {
        setSelectedWebsiteId(created.id);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create website.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(item, updates) {
    setBusyId(item.id);
    setError(null);
    try {
      const updated = await updateTrackedWebsite(item.id, updates);
      setItems((current) => current.map((row) => (row.id === item.id ? updated : row)));
      await refreshGlobalWebsites();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update website.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleArchive(item, archived) {
    setBusyId(item.id);
    setError(null);
    try {
      await archiveTrackedWebsite(item.id, archived);
      await loadWebsites();
      if (archived && String(selectedWebsiteId) === String(item.id)) {
        setSelectedWebsiteId(null);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to archive website.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(item) {
    setBusyId(item.id);
    setError(null);
    try {
      await deleteTrackedWebsite(item.id);
      await loadWebsites();
      if (String(selectedWebsiteId) === String(item.id)) {
        setSelectedWebsiteId(null);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete website.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleTestGSC(item, siteUrl) {
    const candidateSiteUrl = String(siteUrl || item.gsc_site_url || item.gscSiteUrl || '').trim();
    if (!candidateSiteUrl) {
      setError('Enter and save a GSC property for this website first.');
      return;
    }

    setTestingGscId(item.id);
    setError(null);
    try {
      const result = await testGSCProviderConnection('google-search-console', candidateSiteUrl);
      setGscTests((current) => ({
        ...current,
        [item.id]: result,
      }));
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to test GSC connection.');
    } finally {
      setTestingGscId(null);
    }
  }

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return items;
    }

    return items.filter((item) =>
      String(item.domain || '').toLowerCase().includes(query)
      || String(item.project_name || item.projectName || item.name || '').toLowerCase().includes(query)
      || String(item.name || '').toLowerCase().includes(query)
      || (item.tags || []).some((tag) => String(tag).toLowerCase().includes(query))
    );
  }, [items, search]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900">Websites</h2>
        <p className="text-sm text-gray-600 mt-1">
          Manage unlimited websites/projects, switch quickly, and scope dashboard modules by selected website.
        </p>
      </div>

      {error && <ErrorAlert message={error} />}

      <form onSubmit={handleCreate} className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <input
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="Domain or URL (required)"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          />
          <input
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="Project name"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
          />
          <select
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          >
            {SERP_COUNTRIES.map((entry) => (
              <option key={entry.code} value={entry.code}>{entry.name}</option>
            ))}
          </select>
          <input
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="Tags (comma separated)"
            value={tagsInput}
            onChange={(event) => setTagsInput(event.target.value)}
          />
          <input
            className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
            placeholder="GSC property (optional): sc-domain:example.com or https://www.example.com/"
            value={gscSiteUrl}
            onChange={(event) => setGscSiteUrl(event.target.value)}
          />
        </div>
        <div className="mt-3">
          <button
            type="submit"
            disabled={submitting || !domain.trim()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {submitting ? 'Adding...' : 'Add Website'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          One GSC OAuth token can be reused across many websites. Set each website property here.
        </p>
      </form>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <input
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="Search websites..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="active">Active</option>
            <option value="all">All</option>
            <option value="archived">Archived</option>
          </select>
          <button
            type="button"
            onClick={() => loadWebsites({ search })}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading websites..." />
      ) : (
        <div className="space-y-3">
          {filteredItems.length === 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-600">
              No websites found for this filter.
            </div>
          )}

          {filteredItems.map((item) => (
            <WebsiteCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              testingGsc={testingGscId === item.id}
              gscTestResult={gscTests[item.id] || null}
              selected={String(selectedWebsiteId) === String(item.id)}
              onSelect={() => setSelectedWebsiteId(item.id)}
              onUpdate={handleUpdate}
              onTestGSC={handleTestGSC}
              onArchive={handleArchive}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WebsiteCard({
  item,
  busy,
  testingGsc,
  gscTestResult,
  selected,
  onSelect,
  onUpdate,
  onTestGSC,
  onArchive,
  onDelete,
}) {
  const [projectName, setProjectName] = useState(item.project_name || item.projectName || item.name || '');
  const [country, setCountry] = useState(item.country || 'US');
  const [tagsInput, setTagsInput] = useState(tagsToText(item.tags));
  const [gscSiteUrl, setGscSiteUrl] = useState(item.gsc_site_url || item.gscSiteUrl || '');

  useEffect(() => {
    setProjectName(item.project_name || item.projectName || item.name || '');
    setCountry(item.country || 'US');
    setTagsInput(tagsToText(item.tags));
    setGscSiteUrl(item.gsc_site_url || item.gscSiteUrl || '');
  }, [item]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">{item.domain}</div>
          <div className="text-xs text-gray-500">
            Project: {item.project_name || item.projectName || item.name || item.domain}
            {' · '}
            {item.archived ? 'Archived' : 'Active'}
            {item.is_active ? ' · Tracking ON' : ' · Tracking OFF'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSelect}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              selected ? 'bg-emerald-600 text-white' : 'border border-gray-300 text-gray-700'
            }`}
          >
            {selected ? 'Selected' : 'Select'}
          </button>
          <button
            type="button"
            onClick={() => onArchive(item, !item.archived)}
            disabled={busy}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700"
          >
            {item.archived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            type="button"
            onClick={() => onDelete(item)}
            disabled={busy}
            className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <input
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
          placeholder="Project name"
        />
        <select
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={country}
          onChange={(event) => setCountry(event.target.value)}
        >
          {SERP_COUNTRIES.map((entry) => (
            <option key={entry.code} value={entry.code}>{entry.name}</option>
          ))}
        </select>
        <input
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={tagsInput}
          onChange={(event) => setTagsInput(event.target.value)}
          placeholder="tag1, tag2"
        />
      </div>

      <div className="mt-3">
        <input
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={gscSiteUrl}
          onChange={(event) => setGscSiteUrl(event.target.value)}
          placeholder="GSC property: sc-domain:example.com or https://www.example.com/"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onUpdate(item, {
            projectName: projectName.trim(),
            country,
            tags: normalizeTags(tagsInput),
            gscSiteUrl: gscSiteUrl.trim() || null,
          })}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Save Changes
        </button>

        <button
          type="button"
          disabled={busy || testingGsc}
          onClick={() => onTestGSC(item, gscSiteUrl)}
          className="rounded-md border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 disabled:opacity-60"
        >
          {testingGsc ? 'Testing...' : 'Test GSC'}
        </button>
      </div>

      {gscTestResult && (
        <div
          className={`mt-3 rounded-md border px-3 py-2 text-xs ${
            gscTestResult.siteMatched
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <div className="font-semibold">
            {gscTestResult.siteMatched ? 'GSC Connection OK' : 'GSC Connected, site mismatch'}
          </div>
          <div className="mt-1">Configured: <code>{gscTestResult.configuredSiteUrl || 'N/A'}</code></div>
          {gscTestResult.matchedSiteUrl && (
            <div className="mt-1">Matched: <code>{gscTestResult.matchedSiteUrl}</code></div>
          )}
          <div className="mt-1 text-[11px] opacity-80">
            Accessible properties: {gscTestResult.totalAccessibleProperties}
          </div>
        </div>
      )}

      {!gscTestResult && (item.gsc_site_url || item.gscSiteUrl) && (
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          Saved GSC property: <code>{item.gsc_site_url || item.gscSiteUrl}</code>
        </div>
      )}
    </div>
  );
}
