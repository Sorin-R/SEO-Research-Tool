import { useEffect, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import {
  getGSCProviders,
  updateGSCProvider,
  updateGSCProviderCredentials,
  testGSCProviderConnection,
} from '../services/api';

export default function GSCProviderStatus() {
  const [providers, setProviders] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyProviderId, setBusyProviderId] = useState(null);
  const [savingCredentialsId, setSavingCredentialsId] = useState(null);
  const [testingProviderId, setTestingProviderId] = useState(null);
  const [credentialDrafts, setCredentialDrafts] = useState({});
  const [connectionChecks, setConnectionChecks] = useState({});
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    fetchProviderStatus();
  }, []);

  async function fetchProviderStatus() {
    setLoading(true);
    setError(null);

    try {
      const data = await getGSCProviders();
      setProviders(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  function applyUpdatedProvider(updatedProvider) {
    setProviders((current) => {
      if (!current) {
        return current;
      }

      const nextDetails = current.details.map((entry) => (
        entry.id === updatedProvider.id ? updatedProvider : entry
      ));

      return {
        ...current,
        configured: nextDetails.filter((entry) => entry.configured).map((entry) => entry.name),
        active: nextDetails.filter((entry) => entry.active).map((entry) => entry.name),
        available: nextDetails.map((entry) => entry.name),
        details: nextDetails,
      };
    });
  }

  function handleCredentialChange(providerId, fieldName, value) {
    setCredentialDrafts((current) => ({
      ...current,
      [providerId]: {
        ...(current[providerId] || {}),
        [fieldName]: value,
      },
    }));
  }

  async function handleSaveCredentials(provider) {
    const draft = credentialDrafts[provider.id] || {};
    const credentials = Object.entries(draft).reduce((accumulator, [fieldName, value]) => {
      const normalizedValue = String(value || '').trim();

      if (normalizedValue) {
        accumulator[fieldName] = normalizedValue;
      }

      return accumulator;
    }, {});

    if (Object.keys(credentials).length === 0) {
      setError('Enter at least one credential value before saving.');
      return;
    }

    setSavingCredentialsId(provider.id);
    setError(null);

    try {
      const updatedProvider = await updateGSCProviderCredentials(provider.id, credentials);
      applyUpdatedProvider(updatedProvider);
      setCredentialDrafts((current) => ({
        ...current,
        [provider.id]: {},
      }));
      setNotice(`${updatedProvider.name} credentials were saved on the server.`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSavingCredentialsId(null);
    }
  }

  async function handleToggleProvider(provider) {
    if (!provider.configured) {
      return;
    }

    setBusyProviderId(provider.id);
    setError(null);

    try {
      const updatedProvider = await updateGSCProvider(provider.id, !provider.enabled);
      applyUpdatedProvider(updatedProvider);
      setNotice(
        updatedProvider.enabled
          ? `${updatedProvider.name} is ON and available for Search Console data ingestion.`
          : `${updatedProvider.name} is OFF and will be skipped.`
      );
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusyProviderId(null);
    }
  }

  async function handleTestConnection(provider) {
    if (!provider?.id || !provider.configured) {
      return;
    }

    setTestingProviderId(provider.id);
    setError(null);

    try {
      const result = await testGSCProviderConnection(provider.id);
      setConnectionChecks((current) => ({
        ...current,
        [provider.id]: result,
      }));

      if (result.siteMatched) {
        setNotice(`GSC test successful. Property matched: ${result.matchedSiteUrl || result.configuredSiteUrl}.`);
      } else {
        setNotice('GSC connected, but configured site URL was not found in your accessible properties.');
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setTestingProviderId(null);
    }
  }

  if (loading) {
    return <LoadingSpinner message="Loading Google Search Console provider..." />;
  }

  if (error && !providers) {
    return <ErrorAlert message={error} onRetry={fetchProviderStatus} />;
  }

  const providerDetails = providers?.details || [];
  const configuredCount = providerDetails.filter((provider) => provider.configured).length;
  const activeCount = providerDetails.filter((provider) => provider.active).length;
  const totalProviders = providerDetails.length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Google Search Console Provider</h2>
        <p className="text-sm text-gray-500">
          Save OAuth credentials and the target Search Console property here. Credentials are stored server-side and can be updated anytime.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard label="Total Providers" value={totalProviders} tone="blue" />
        <SummaryCard label="Configured" value={configuredCount} tone="green" />
        <SummaryCard label="Active" value={activeCount} suffix={`/${totalProviders}`} tone="amber" />
      </div>

      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-5 py-4 text-sm text-emerald-900">
          {notice}
        </div>
      )}

      {error && <ErrorAlert message={error} onRetry={fetchProviderStatus} />}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_320px] gap-6">
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">Provider Controls</h3>
            <p className="text-sm text-gray-500 mt-1">
              Add required OAuth values, save, then switch provider ON.
            </p>
          </div>

          <div className="divide-y divide-gray-100">
            {providerDetails.map((provider) => {
              const isBusy = busyProviderId === provider.id;
              const isSavingCredentials = savingCredentialsId === provider.id;
              const isTestingConnection = testingProviderId === provider.id;
              const providerDraft = credentialDrafts[provider.id] || {};
              const connectionCheck = connectionChecks[provider.id];

              return (
                <div key={provider.id} className={`px-5 py-5 ${provider.active ? 'bg-emerald-50/50' : ''}`}>
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <a
                          href={provider.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-indigo-600 hover:underline text-base"
                        >
                          {provider.name}
                        </a>
                        <StatusPill provider={provider} />
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{provider.description}</p>
                      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-500">
                        <span>Setup: {provider.setupTime}</span>
                        <span className="text-gray-300">|</span>
                        <span>{provider.quota}</span>
                        <span className="text-gray-300">|</span>
                        <span>{provider.quotaType}</span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleTestConnection(provider)}
                        disabled={!provider.configured || isTestingConnection}
                        className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                        title={!provider.configured ? 'Save required credentials first' : 'Test Search Console connection'}
                      >
                        {isTestingConnection ? 'Testing...' : 'Test Connection'}
                      </button>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={provider.enabled}
                        onClick={() => handleToggleProvider(provider)}
                        disabled={!provider.configured || isBusy}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                          provider.enabled ? 'bg-indigo-600' : 'bg-gray-300'
                        } ${!provider.configured || isBusy ? 'cursor-not-allowed opacity-60' : ''}`}
                        title={
                          !provider.configured
                            ? 'Add the required credentials first'
                            : provider.enabled
                              ? 'Turn provider OFF'
                              : 'Turn provider ON'
                        }
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            provider.enabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {provider.fields.map((field) => (
                      <div key={field.name} className="space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <label className="text-xs font-medium text-gray-700">
                            {field.label}
                            {field.required ? '' : ' (Optional)'}
                          </label>
                          <span className="text-[11px] text-gray-500">
                            {field.hasValue
                              ? field.source === 'saved'
                                ? 'Saved in app'
                                : 'Using env'
                              : field.required
                                ? 'Missing'
                                : 'Optional'}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={providerDraft[field.name] || ''}
                            onChange={(event) => handleCredentialChange(provider.id, field.name, event.target.value)}
                            placeholder={field.hasValue ? 'Replace saved value' : `Enter ${field.label.toLowerCase()}`}
                            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveCredentials(provider)}
                            disabled={isSavingCredentials}
                            className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isSavingCredentials ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                        <code className="block rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-700">
                          {field.name}
                        </code>
                      </div>
                    ))}
                  </div>

                  {connectionCheck && (
                    <div
                      className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
                        connectionCheck.siteMatched
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : 'border-amber-200 bg-amber-50 text-amber-900'
                      }`}
                    >
                      <div className="font-medium">
                        {connectionCheck.siteMatched ? 'Connection OK' : 'Connected, site mismatch'}
                      </div>
                      <div className="mt-1">
                        Configured: <code>{connectionCheck.configuredSiteUrl || 'N/A'}</code>
                      </div>
                      {connectionCheck.matchedSiteUrl && (
                        <div className="mt-1">
                          Matched: <code>{connectionCheck.matchedSiteUrl}</code>
                        </div>
                      )}
                      <div className="mt-1 text-[11px] opacity-80">
                        Accessible properties: {connectionCheck.totalAccessibleProperties}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900">Current Summary</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500">Total Providers</dt>
                <dd className="font-medium text-gray-900">{totalProviders}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500">Configured</dt>
                <dd className="font-medium text-emerald-700">{configuredCount}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500">Active</dt>
                <dd className="font-medium text-emerald-700">{activeCount}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500">Not Configured</dt>
                <dd className="font-medium text-amber-700">{totalProviders - configuredCount}</dd>
              </div>
            </dl>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
            <h3 className="font-semibold text-blue-900">OAuth Notes</h3>
            <ul className="mt-3 space-y-2 text-sm text-blue-800">
              <li>Use OAuth credentials for the same Google Cloud project where Search Console API is enabled.</li>
              <li>The Search Console property URL must be exact, for example `sc-domain:example.com`.</li>
              <li>After saving credentials, switch provider ON to allow Search Console features to use it.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, suffix = '', tone = 'blue' }) {
  const tones = {
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
  };

  return (
    <div className={`rounded-lg border p-5 ${tones[tone] || tones.blue}`}>
      <div className="text-sm opacity-80">{label}</div>
      <div className="mt-2 text-2xl font-bold">
        {value}
        {suffix && <span className="ml-1 text-base font-medium">{suffix}</span>}
      </div>
    </div>
  );
}

function StatusPill({ provider }) {
  if (!provider.configured) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
        Not configured
      </span>
    );
  }

  if (provider.active) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
        Active
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
      Configured but off
    </span>
  );
}
