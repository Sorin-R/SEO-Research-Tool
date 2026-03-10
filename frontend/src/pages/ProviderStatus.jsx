/**
 * ProviderStatus Component
 * Shows configured SERP providers and their status
 */

import { useState, useEffect } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';

export default function ProviderStatus() {
  const [providers, setProviders] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchProviderStatus();
  }, []);

  async function fetchProviderStatus() {
    try {
      const response = await fetch('/api/serp/providers');
      const data = await response.json();
      setProviders(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <LoadingSpinner message="Loading provider status..." />;
  if (error) return <ErrorAlert message={error} onRetry={fetchProviderStatus} />;

  const { configured = [], available = [] } = providers || {};
  const configuredCount = configured.length;
  const totalQuota = calculateQuota(configured);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">SERP Providers</h2>
        <p className="text-sm text-gray-500">
          Configured providers: {configuredCount} | Total free quota: ~{totalQuota} searches/month
        </p>
      </div>

      {/* Configured Providers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            ✅ Configured ({configuredCount})
          </h3>
          {configured.length === 0 ? (
            <p className="text-sm text-gray-500">No providers configured yet.</p>
          ) : (
            <div className="space-y-3">
              {configured.map((name) => (
                <div
                  key={name}
                  className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg"
                >
                  <span className="text-green-600 text-lg">✓</span>
                  <span className="font-medium text-gray-800">{name}</span>
                  <span className="ml-auto text-xs text-green-600">Active</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Available but not configured */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            ➕ Not Configured ({available.length - configuredCount})
          </h3>
          {available.length === configuredCount ? (
            <p className="text-sm text-gray-500">All providers are configured!</p>
          ) : (
            <div className="space-y-3">
              {available
                .filter((p) => !configured.includes(p))
                .map((name) => (
                  <div
                    key={name}
                    className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg"
                  >
                    <span className="text-gray-400 text-lg">○</span>
                    <span className="font-medium text-gray-600">{name}</span>
                    <span className="ml-auto text-xs text-gray-500">Not configured</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Provider Details */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Provider Details</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Provider</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Free Tier</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Quota Type</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Setup</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[
                {
                  name: 'SerpAPI',
                  tier: '100/month',
                  type: 'Monthly',
                  setup: '2 min',
                  link: 'https://serpapi.com/',
                },
                {
                  name: 'Serpstack',
                  tier: '100/month',
                  type: 'Monthly',
                  setup: '2 min',
                  link: 'https://serpstack.com/',
                },
                {
                  name: 'Zenserp',
                  tier: '100/month',
                  type: 'Monthly',
                  setup: '2 min',
                  link: 'https://zenserp.com/',
                },
                {
                  name: 'SearchAPI',
                  tier: '100/month',
                  type: 'Monthly',
                  setup: '2 min',
                  link: 'https://www.searchapi.io/',
                },
                {
                  name: 'ScaleSERP',
                  tier: '100/month',
                  type: 'Monthly',
                  setup: '2 min',
                  link: 'https://www.scaleserp.com/',
                },
                {
                  name: 'Google Custom Search',
                  tier: '100/day',
                  type: 'Daily',
                  setup: '10 min',
                  link: 'https://programmablesearchengine.google.com/',
                },
                {
                  name: 'Bing Search API',
                  tier: '~1000/month',
                  type: 'Monthly',
                  setup: '3 min',
                  link: 'https://www.microsoft.com/en-us/bing/apis/bing-web-search-api',
                },
              ].map((p) => {
                const isConfigured = configured.includes(p.name);
                return (
                  <tr key={p.name} className={isConfigured ? 'bg-green-50' : ''}>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      <a
                        href={p.link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 hover:underline"
                      >
                        {p.name}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{p.tier}</td>
                    <td className="px-4 py-3 text-gray-600">{p.type}</td>
                    <td className="px-4 py-3 text-gray-600">{p.setup}</td>
                    <td className="px-4 py-3 text-center">
                      {isConfigured ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <span>✓</span> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                          <span>○</span> Not configured
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="font-semibold text-blue-900 mb-2">📖 How to Add More Providers</h3>
        <ol className="text-sm text-blue-800 space-y-2">
          <li>1. Sign up for any provider above (2-10 minutes)</li>
          <li>2. Copy your API key from their dashboard</li>
          <li>3. Add to <code className="bg-blue-100 px-2 py-1 rounded">backend/.env</code></li>
          <li>4. Restart backend: <code className="bg-blue-100 px-2 py-1 rounded">npm run dev</code></li>
          <li>5. System automatically uses configured providers!</li>
        </ol>
      </div>

      {/* Benefits */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
        <h3 className="font-semibold text-amber-900 mb-2">💡 Pro Tips</h3>
        <ul className="text-sm text-amber-800 space-y-2">
          <li>✓ You only need <strong>1 provider</strong> to get started</li>
          <li>✓ Add <strong>multiple providers</strong> for unlimited quota (system tries each in order)</li>
          <li>✓ <strong>7 providers combined</strong> = 600-700 free searches/month</li>
          <li>✓ No configuration needed in frontend - backend handles everything automatically</li>
        </ul>
      </div>
    </div>
  );
}

function calculateQuota(providers) {
  const quotas = {
    'SerpAPI': 100,
    'Serpstack': 100,
    'Zenserp': 100,
    'SearchAPI': 100,
    'ScaleSERP': 100,
    'Google Custom Search': 3000, // 100/day
    'Bing Search API': 1000,
  };

  return providers.reduce((total, name) => total + (quotas[name] || 0), 0);
}
