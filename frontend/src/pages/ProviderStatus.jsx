import { useEffect, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import {
  getSerpProviders,
  updateSerpProvider,
  updateSerpProviderCredentials,
} from '../services/api';

export default function ProviderStatus() {
  const [providers, setProviders] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyProviderId, setBusyProviderId] = useState(null);
  const [savingCredentialsId, setSavingCredentialsId] = useState(null);
  const [credentialDrafts, setCredentialDrafts] = useState({});
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    fetchProviderStatus();
  }, []);

  async function fetchProviderStatus() {
    setLoading(true);
    setError(null);

    try {
      const data = await getSerpProviders();
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

  async function handleToggleProvider(provider) {
    if (!provider.configured) {
      return;
    }

    setBusyProviderId(provider.id);
    setError(null);

    try {
      const updatedProvider = await updateSerpProvider(provider.id, !provider.enabled);
      applyUpdatedProvider(updatedProvider);

      setNotice(
        updatedProvider.enabled
          ? `${updatedProvider.name} is ON and available for SERP lookups.`
          : `${updatedProvider.name} is OFF and will be skipped during SERP lookups.`
      );
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusyProviderId(null);
    }
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
      setError('Enter at least one API credential value before saving.');
      return;
    }

    setSavingCredentialsId(provider.id);
    setError(null);

    try {
      const updatedProvider = await updateSerpProviderCredentials(provider.id, credentials);
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

  if (loading) return <LoadingSpinner message="Loading provider status..." />;
  if (error && !providers) return <ErrorAlert message={error} onRetry={fetchProviderStatus} />;

  const providerDetails = providers?.details || [];
  const configuredCount = providerDetails.filter((provider) => provider.configured).length;
  const activeCount = providerDetails.filter((provider) => provider.active).length;
  const inactiveConfiguredCount = providerDetails.filter(
    (provider) => provider.configured && !provider.enabled
  ).length;
  const totalActiveRemaining = calculateRemaining(providerDetails.filter((provider) => provider.active));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">SERP Providers</h2>
        <p className="text-sm text-gray-500">
          Add provider API credentials from this page and choose which configured providers are allowed to run. Saved credentials stay on the server and are not shown again in plain text.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard label="Configured APIs" value={configuredCount} tone="blue" />
        <SummaryCard label="Active Providers" value={activeCount} tone="green" />
        <SummaryCard label="Active Remaining" value={totalActiveRemaining} tone="amber" />
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
              Save credentials, then turn providers on or off without editing env files manually.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Provider</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Credentials</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Remaining</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Toggle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {providerDetails.map((provider) => {
                  const isBusy = busyProviderId === provider.id;
                  const isSavingCredentials = savingCredentialsId === provider.id;
                  const providerDraft = credentialDrafts[provider.id] || {};

                  return (
                    <tr key={provider.id} className={provider.active ? 'bg-emerald-50/50' : ''}>
                      <td className="px-4 py-4 align-top">
                        <a
                          href={provider.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-indigo-600 hover:underline"
                        >
                          {provider.name}
                        </a>
                        <div className="mt-1 text-xs text-gray-500">
                          Setup: {provider.setupTime}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="space-y-3 min-w-[280px]">
                          {provider.fields.map((field) => (
                            <div key={field.name} className="space-y-1">
                              <div className="flex items-center justify-between gap-3">
                                <label className="text-xs font-medium text-gray-700">{field.label}</label>
                                <span className="text-[11px] text-gray-500">
                                  {field.hasValue
                                    ? field.source === 'saved'
                                      ? 'Saved in app'
                                      : 'Using env'
                                    : 'Missing'}
                                </span>
                              </div>
                              <input
                                type="password"
                                value={providerDraft[field.name] || ''}
                                onChange={(event) => handleCredentialChange(provider.id, field.name, event.target.value)}
                                placeholder={field.hasValue ? 'Replace saved value' : `Enter ${field.label.toLowerCase()}`}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                autoComplete="off"
                              />
                              <code className="block rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-700">
                                {field.name}
                              </code>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => handleSaveCredentials(provider)}
                            disabled={isSavingCredentials}
                            className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isSavingCredentials ? 'Saving...' : 'Save Credentials'}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top text-gray-600">
                        {provider.usage?.display ? (
                          <>
                            <span className="font-medium text-gray-800">{provider.usage.display}</span>
                            <div className="mt-1 text-xs text-gray-500">Total / Remaining</div>
                          </>
                        ) : (
                          <>
                            {provider.quota}
                            <div className="mt-1 text-xs text-gray-500">{provider.quotaType}</div>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <StatusPill provider={provider} />
                      </td>
                      <td className="px-4 py-4 align-top text-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={provider.enabled}
                          onClick={() => handleToggleProvider(provider)}
                          disabled={!provider.configured || isBusy}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            provider.enabled ? 'bg-indigo-600' : 'bg-gray-300'
                          } ${!provider.configured || isBusy ? 'cursor-not-allowed opacity-60' : ''}`}
                          title={
                            !provider.configured
                              ? 'Add the API key first'
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900">Current Summary</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500">Configured</dt>
                <dd className="font-medium text-gray-900">{configuredCount}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500">On</dt>
                <dd className="font-medium text-emerald-700">{activeCount}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-500">Configured but Off</dt>
                <dd className="font-medium text-amber-700">{inactiveConfiguredCount}</dd>
              </div>
            </dl>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
            <h3 className="font-semibold text-blue-900">How it works</h3>
            <ul className="mt-3 space-y-2 text-sm text-blue-800">
              <li>Save the API key in the field beside each provider.</li>
              <li>Configured + ON: the provider can be used for SERP requests.</li>
              <li>Configured + OFF: the API key stays saved, but the provider is skipped.</li>
              <li>Usage counters show as total/remaining and decrease after each successful provider request.</li>
              <li>Baseline calculation: {'{ SerpAPI 250/171, Serpstack 100/98, Zenserp 50/43, SearchAPI 100/96, ScaleSERP 100/96 }'}.</li>
              <li>Env values still work too, but this page can now store and update provider credentials directly.</li>
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

function calculateRemaining(providers) {
  return providers.reduce((total, provider) => total + (Number(provider.usage?.remaining) || 0), 0);
}
