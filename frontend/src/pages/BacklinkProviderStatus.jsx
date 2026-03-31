import { useEffect, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import {
  getBacklinkProviders,
  updateBacklinkProvider,
  updateBacklinkProviderCredentials,
} from '../services/api';

export default function BacklinkProviderStatus() {
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
      const data = await getBacklinkProviders();
      setProviders(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  function applyUpdatedProvider(updatedProvider) {
    setProviders((current) => {
      if (!current) return current;

      const details = (current.details || []).map((provider) => (
        provider.id === updatedProvider.id ? updatedProvider : provider
      ));

      return {
        ...current,
        details,
        configured: details.filter((provider) => provider.configured).map((provider) => provider.name),
        active: details.filter((provider) => provider.active).map((provider) => provider.name),
        available: details.map((provider) => provider.name),
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
    const credentials = Object.entries(draft).reduce((acc, [key, value]) => {
      const normalized = String(value || '').trim();
      if (normalized) {
        acc[key] = normalized;
      }
      return acc;
    }, {});

    if (Object.keys(credentials).length === 0) {
      setError('Enter at least one credential value before saving.');
      return;
    }

    setSavingCredentialsId(provider.id);
    setError(null);

    try {
      const updatedProvider = await updateBacklinkProviderCredentials(provider.id, credentials);
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
      const updatedProvider = await updateBacklinkProvider(provider.id, !provider.enabled);
      applyUpdatedProvider(updatedProvider);
      setNotice(
        updatedProvider.enabled
          ? `${updatedProvider.name} is ON and ready for backlink scans.`
          : `${updatedProvider.name} is OFF and backlink scans will be skipped.`
      );
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusyProviderId(null);
    }
  }

  if (loading) return <LoadingSpinner message="Loading backlink provider..." />;
  if (error && !providers) return <ErrorAlert message={error} onRetry={fetchProviderStatus} />;

  const providerDetails = providers?.details || [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Backlink Provider</h2>
        <p className="text-sm text-gray-500">
          Add DataForSEO API credentials from <a className="text-indigo-600 hover:underline" href="https://app.dataforseo.com/api-access" target="_blank" rel="noreferrer">app.dataforseo.com/api-access</a>, then switch provider ON.
        </p>
      </div>

      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
          {notice}
        </div>
      ) : null}

      {error ? <ErrorAlert message={error} onRetry={fetchProviderStatus} /> : null}

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Provider Controls</h3>
          <p className="text-sm text-gray-500 mt-1">Save credentials and toggle provider state from here.</p>
        </div>

        {providerDetails.map((provider) => {
          const isBusy = busyProviderId === provider.id;
          const isSaving = savingCredentialsId === provider.id;
          const draft = credentialDrafts[provider.id] || {};

          return (
            <div key={provider.id} className={`px-5 py-5 border-b border-gray-100 last:border-b-0 ${provider.active ? 'bg-emerald-50/40' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <a className="font-semibold text-indigo-600 hover:underline" href={provider.docsUrl} target="_blank" rel="noreferrer">
                    {provider.name}
                  </a>
                  <p className="text-sm text-gray-600 mt-1">{provider.description}</p>
                  <div className="mt-2 text-xs text-gray-500">
                    Setup: {provider.setupTime} | {provider.quota} | {provider.quotaType}
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={provider.enabled}
                  onClick={() => handleToggleProvider(provider)}
                  disabled={!provider.configured || isBusy}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    provider.enabled ? 'bg-indigo-600' : 'bg-gray-300'
                  } ${!provider.configured || isBusy ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      provider.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {provider.fields.map((field) => (
                  <div key={field.name} className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs font-medium text-gray-700">{field.label}</label>
                      <span className="text-[11px] text-gray-500">
                        {field.hasValue ? (field.source === 'saved' ? 'Saved in app' : 'Using env') : 'Missing'}
                      </span>
                    </div>
                    <input
                      type="password"
                      value={draft[field.name] || ''}
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
              </div>

              <button
                type="button"
                onClick={() => handleSaveCredentials(provider)}
                disabled={isSaving}
                className="mt-4 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? 'Saving...' : 'Save Credentials'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
