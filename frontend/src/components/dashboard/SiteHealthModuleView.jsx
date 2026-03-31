import LoadingSpinner from '../LoadingSpinner';

function severityBadgeClass(severity) {
  if (severity === 'critical') return 'bg-red-100 text-red-800';
  if (severity === 'high') return 'bg-orange-100 text-orange-800';
  if (severity === 'medium') return 'bg-amber-100 text-amber-800';
  return 'bg-blue-100 text-blue-800';
}

export default function SiteHealthModuleView({
  moduleData,
  loading = false,
  error = null,
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <LoadingSpinner message="Loading site health module..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!moduleData?.available) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
        No site health data for this website/date range. Run a Site Audit first, or widen the dashboard date range.
      </div>
    );
  }

  const issueCounts = moduleData.issueCounts || {};
  const topIssues = Array.isArray(moduleData.topIssues) ? moduleData.topIssues : [];
  const affectedPages = Array.isArray(moduleData.affectedPages) ? moduleData.affectedPages : [];
  const score = Number(moduleData.score?.value || 0);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Site Health Score</p>
            <p className="mt-2 text-3xl font-semibold text-gray-900">{score}/100</p>
            <p className="mt-1 text-sm text-gray-500">
              {moduleData.metadata?.crawledPages || 0} pages crawled • {issueCounts.passedChecks || 0}/{issueCounts.totalChecks || 10} checks passed
            </p>
            {moduleData.metadata?.dateRangeFallback ? (
              <p className="mt-1 text-xs text-amber-700">
                No audits in the selected date range. Showing latest available audit for this website.
              </p>
            ) : null}
          </div>
          <div className="text-sm text-gray-600 max-w-xl">
            {(moduleData.insights || []).slice(0, 2).map((line) => (
              <p key={line} className="mb-1 last:mb-0">{line}</p>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { key: 'critical', label: 'Critical' },
          { key: 'high', label: 'High' },
          { key: 'medium', label: 'Medium' },
          { key: 'low', label: 'Low' },
        ].map((entry) => (
          <div key={entry.key} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{entry.label}</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{Number(issueCounts[entry.key] || 0)}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h4 className="text-sm font-semibold text-gray-900">Top Issues</h4>
        </div>
        {topIssues.length === 0 ? (
          <p className="px-4 py-5 text-sm text-gray-500">No issues detected in the required checks.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Issue</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Count</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {topIssues.map((issue) => (
                  <tr key={issue.key}>
                    <td className="px-4 py-3 text-gray-900">{issue.label}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${severityBadgeClass(issue.severity)}`}>
                        {issue.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{issue.count}</td>
                    <td className="px-4 py-3 text-gray-600">{issue.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h4 className="text-sm font-semibold text-gray-900">Affected Pages</h4>
        </div>
        {affectedPages.length === 0 ? (
          <p className="px-4 py-5 text-sm text-gray-500">No affected pages for the required checks.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Page</th>
                  <th className="px-4 py-3">Highest Severity</th>
                  <th className="px-4 py-3">Issue Count</th>
                  <th className="px-4 py-3">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {affectedPages.map((page) => (
                  <tr key={page.url}>
                    <td className="px-4 py-3">
                      <a href={page.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline break-all">
                        {page.url}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${severityBadgeClass(page.highestSeverity)}`}>
                        {page.highestSeverity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{page.issueCount}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {(page.issues || []).slice(0, 3).map((issue) => issue.label).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
