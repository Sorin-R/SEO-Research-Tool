import { useEffect, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import ScoreBadge from '../components/ScoreBadge';
import StatCard from '../components/StatCard';
import {
  auditSite,
  deleteSiteAuditHistoryItem,
  getSiteAuditHistory,
  getSiteAuditHistoryItem,
} from '../services/api';

const STORAGE_KEY = 'seo-tool:site-audit:last-session';
const HISTORY_LIMIT = 10;
const MAX_PAGE_OPTIONS = [10, 25, 50];

export default function SiteAudit() {
  const [url, setUrl] = useState('');
  const [maxPages, setMaxPages] = useState(25);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const [loadingHistoryId, setLoadingHistoryId] = useState(null);
  const [deletingHistoryId, setDeletingHistoryId] = useState(null);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);

      if (typeof parsed.url === 'string') {
        setUrl(parsed.url);
      }

      if (MAX_PAGE_OPTIONS.includes(parsed.maxPages)) {
        setMaxPages(parsed.maxPages);
      }

      if (parsed.data) {
        setData(parsed.data);
        setRestoreNotice('Restored your last site audit from this browser.');
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
        const result = await getSiteAuditHistory(HISTORY_LIMIT);
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

    if (!data && !url.trim()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          url,
          maxPages,
          data,
          savedAt: new Date().toISOString(),
        })
      );
    } catch {
      // Ignore storage quota issues.
    }
  }, [data, maxPages, storageHydrated, url]);

  async function refreshHistory() {
    try {
      const result = await getSiteAuditHistory(HISTORY_LIMIT);
      setHistory(result);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(err.response?.data?.error || err.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    await runAudit();
  }

  async function runAudit() {
    if (!url.trim()) {
      return;
    }

    setLoading(true);
    setError(null);
    setRestoreNotice(null);

    try {
      const result = await auditSite(url.trim(), maxPages);
      setData(result);
      await refreshHistory();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadHistory(id) {
    setLoadingHistoryId(id);
    setError(null);

    try {
      const result = await getSiteAuditHistoryItem(id);
      setData(result);
      setUrl(result.url || '');
      setMaxPages(MAX_PAGE_OPTIONS.includes(result.maxPages) ? result.maxPages : 25);
      setRestoreNotice('Loaded a saved site audit from history.');
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
      await deleteSiteAuditHistoryItem(id);
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

  function handleDownloadReport() {
    if (!data) {
      return;
    }

    const report = buildSiteAuditReportMarkdown(data);
    const domainPart = sanitizeFilenamePart(data.url || 'site-audit');
    const timestampPart = new Date().toISOString().slice(0, 10);
    downloadMarkdownFile(`site-audit-${domainPart}-${timestampPart}.md`, report);
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Site Audit</h2>
      <p className="text-sm text-gray-500 mb-6">
        Crawl a site like a lightweight technical SEO audit and surface the issues that most often block organic growth.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_180px_auto] gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Website URL</label>
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Crawl Limit</label>
            <select
              value={maxPages}
              onChange={(event) => setMaxPages(Number(event.target.value))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {MAX_PAGE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value} pages
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="self-end px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Auditing...' : 'Run Audit'}
          </button>
        </div>
      </form>

      {loading && <LoadingSpinner message="Crawling site and checking SEO issues..." />}
      {error && <ErrorAlert message={error} onRetry={runAudit} />}
      {restoreNotice && !loading && (
        <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-lg px-5 py-4 text-sm text-emerald-900">
          {restoreNotice}
        </div>
      )}

      {data && !loading && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleDownloadReport}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50"
          >
            Download .md Report
          </button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
        <div className="space-y-6">
          {data ? (
            <>
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <ScoreBadge score={data.auditScore || 0} label="Audit Score" size="lg" />
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{data.url}</h3>
                      <p className="text-sm text-gray-500">
                        Crawled {data.crawledPages} page{data.crawledPages === 1 ? '' : 's'} at {formatDateTime(data.checkedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    Health score is based on broken pages, missing metadata, thin content, slow responses, and crawlability issues.
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Pages Crawled" value={data.crawledPages} />
                <StatCard label="Pages With Issues" value={data.totals?.pagesWithIssues ?? 0} />
                <StatCard label="Broken Pages" value={data.totals?.brokenPages ?? 0} />
                <StatCard label="Broken Internal Links" value={data.totals?.brokenInternalLinks ?? 0} />
                <StatCard label="Missing Titles" value={data.totals?.missingTitles ?? 0} />
                <StatCard label="Missing Meta" value={data.totals?.missingMetaDescriptions ?? 0} />
                <StatCard label="Duplicate Titles" value={data.totals?.duplicateTitles ?? 0} />
                <StatCard label="Thin Content" value={data.totals?.thinContentPages ?? 0} />
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Top Issues</h3>
                {data.topIssues?.length ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {data.topIssues.map((issue) => (
                      <div
                        key={issue.id}
                        className={`rounded-lg border p-4 ${severityCardClasses(issue.severity)}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium">{issue.label}</div>
                          <div className="text-sm font-semibold">{issue.count}</div>
                        </div>
                        <p className="mt-2 text-sm opacity-80">{issue.description}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No major issues were found in the crawled pages.</p>
                )}
              </div>

              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-200">
                  <h3 className="font-semibold text-gray-900">Crawled Pages</h3>
                  <p className="text-sm text-gray-500 mt-1">Pages are sorted by severity and number of issues.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">Page</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">Content</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">Issues</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.pages?.map((page) => (
                        <tr key={page.url}>
                          <td className="px-4 py-4 align-top min-w-[260px]">
                            <a
                              href={page.url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-indigo-600 hover:underline"
                            >
                              {page.path}
                            </a>
                            <div className="mt-1 text-xs text-gray-500 break-all">{page.url}</div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="font-medium text-gray-800">
                              {page.statusCode != null ? page.statusCode : 'Error'}
                              {page.redirected ? ' · Redirect' : ''}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {page.loadTimeMs} ms
                              {page.noindex ? ' · noindex' : ''}
                            </div>
                          </td>
                          <td className="px-4 py-4 align-top text-gray-600">
                            <div>Words: {page.wordCount}</div>
                            <div className="mt-1">H1: {page.h1Count}</div>
                            <div className="mt-1">Title: {page.titleLength || 0} chars</div>
                            <div className="mt-1">Meta: {page.metaDescriptionLength || 0} chars</div>
                            <div className="mt-1">Images w/o alt: {page.imagesWithoutAlt}</div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            {page.issues?.length ? (
                              <div className="flex flex-wrap gap-2">
                                {page.issues.map((issue) => (
                                  <span
                                    key={`${page.url}-${issue.id}`}
                                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${severityPillClasses(issue.severity)}`}
                                  >
                                    {issue.label}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-sm text-emerald-600 font-medium">No issues found</span>
                            )}
                            {page.fetchError && (
                              <div className="mt-2 text-xs text-red-600">{page.fetchError}</div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            !loading && (
              <div className="bg-white rounded-lg border border-dashed border-gray-300 px-6 py-16 text-center text-sm text-gray-500">
                Run a site audit to inspect technical SEO issues across internal pages.
              </div>
            )
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="font-semibold text-gray-900">Saved Audits</h3>
              {historyLoading && <span className="text-xs text-gray-400">Loading...</span>}
            </div>

            {historyError && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {historyError}
              </div>
            )}

            {history.length === 0 && !historyLoading ? (
              <p className="text-sm text-gray-500">No saved site audits yet.</p>
            ) : (
              <div className="space-y-3">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-gray-200 p-3 hover:border-indigo-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => handleLoadHistory(item.id)}
                        disabled={loadingHistoryId === item.id}
                        className="text-left flex-1"
                      >
                        <div className="font-medium text-gray-900 break-all">{item.url}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          Score {item.audit_score ?? '—'} · {item.total_pages ?? 0} pages · {formatDateTime(item.updated_at || item.created_at)}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteHistory(item.id)}
                        disabled={deletingHistoryId === item.id}
                        className="text-gray-300 hover:text-red-500 text-lg transition-colors disabled:opacity-60"
                        title="Delete saved audit"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
            <h3 className="font-semibold text-blue-900">Audit Checks</h3>
            <ul className="mt-3 space-y-2 text-sm text-blue-800">
              <li>Broken pages and broken internal links</li>
              <li>Missing or duplicate title tags and meta descriptions</li>
              <li>Missing H1s, thin content, and noindex pages</li>
              <li>Missing canonicals, slow responses, and images without alt text</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function severityCardClasses(severity) {
  if (severity === 'high') return 'border-red-200 bg-red-50 text-red-900';
  if (severity === 'medium') return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-blue-200 bg-blue-50 text-blue-900';
}

function severityPillClasses(severity) {
  if (severity === 'high') return 'bg-red-100 text-red-800';
  if (severity === 'medium') return 'bg-amber-100 text-amber-800';
  return 'bg-blue-100 text-blue-800';
}

function formatDateTime(value) {
  if (!value) return 'Saved recently';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Saved recently';

  return date.toLocaleString();
}

function downloadMarkdownFile(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
  const fileUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = fileUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(fileUrl);
}

function sanitizeFilenamePart(value) {
  return String(value || 'report')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'report';
}

function formatMetric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildSiteAuditReportMarkdown(result) {
  const lines = [];
  lines.push('# Site Audit Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`URL: ${result.url || 'N/A'}`);
  lines.push(`Checked At: ${result.checkedAt || 'N/A'}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(`- Audit Score: ${formatMetric(result.auditScore)}/100`);
  lines.push(`- Pages Crawled: ${formatMetric(result.crawledPages)}`);
  lines.push(`- Pages With Issues: ${formatMetric(result.totals?.pagesWithIssues)}`);
  lines.push(`- Broken Pages: ${formatMetric(result.totals?.brokenPages)}`);
  lines.push(`- Broken Internal Links: ${formatMetric(result.totals?.brokenInternalLinks)}`);
  lines.push(`- Missing Titles: ${formatMetric(result.totals?.missingTitles)}`);
  lines.push(`- Missing Meta Descriptions: ${formatMetric(result.totals?.missingMetaDescriptions)}`);
  lines.push(`- Duplicate Titles: ${formatMetric(result.totals?.duplicateTitles)}`);
  lines.push(`- Thin Content Pages: ${formatMetric(result.totals?.thinContentPages)}`);
  lines.push('');

  lines.push('## Top Issues');
  lines.push('');
  if (Array.isArray(result.topIssues) && result.topIssues.length > 0) {
    for (const issue of result.topIssues) {
      lines.push(`- [${String(issue.severity || 'low').toUpperCase()}] ${issue.label}: ${formatMetric(issue.count)} pages`);
      if (issue.description) {
        lines.push(`  ${issue.description}`);
      }
    }
  } else {
    lines.push('- No major issues found.');
  }
  lines.push('');

  lines.push('## Affected Pages');
  lines.push('');
  if (Array.isArray(result.pages) && result.pages.length > 0) {
    for (const page of result.pages) {
      lines.push(`### ${page.path || page.url || 'Page'}`);
      lines.push('');
      lines.push(`- URL: ${page.url || 'N/A'}`);
      lines.push(`- Status: ${page.statusCode != null ? page.statusCode : 'Error'}${page.redirected ? ' (redirect)' : ''}`);
      lines.push(`- Load Time: ${formatMetric(page.loadTimeMs)} ms`);
      lines.push(`- Noindex: ${page.noindex ? 'Yes' : 'No'}`);
      lines.push(`- Words: ${formatMetric(page.wordCount)}`);
      lines.push(`- H1 Count: ${formatMetric(page.h1Count)}`);
      lines.push(`- Title Length: ${formatMetric(page.titleLength)} chars`);
      lines.push(`- Meta Description Length: ${formatMetric(page.metaDescriptionLength)} chars`);
      lines.push(`- Images Without Alt: ${formatMetric(page.imagesWithoutAlt)}`);

      if (Array.isArray(page.issues) && page.issues.length > 0) {
        lines.push('- Issues:');
        for (const issue of page.issues) {
          lines.push(`  - [${String(issue.severity || 'low').toUpperCase()}] ${issue.label}`);
        }
      } else {
        lines.push('- Issues: None');
      }

      if (page.fetchError) {
        lines.push(`- Fetch Error: ${page.fetchError}`);
      }
      lines.push('');
    }
  } else {
    lines.push('No pages were included in this audit result.');
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}
