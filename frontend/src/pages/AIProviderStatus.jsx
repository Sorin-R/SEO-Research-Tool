import { useEffect, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import {
  getAIProviders,
  updateAIProvider,
  updateAIProviderCredentials,
  updateAIProviderModel,
} from '../services/api';

export default function AIProviderStatus() {
  const [providers, setProviders] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyProviderId, setBusyProviderId] = useState(null);
  const [savingCredentialsId, setSavingCredentialsId] = useState(null);
  const [savingModelProviderId, setSavingModelProviderId] = useState(null);
  const [credentialDrafts, setCredentialDrafts] = useState({});
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    fetchProviderStatus();
  }, []);

  async function fetchProviderStatus() {
    setLoading(true);
    setError(null);

    try {
      const data = await getAIProviders();
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

      const nextDetails = current.details.map((entry) =>
        entry.id === updatedProvider.id ? updatedProvider : entry
      );

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
    if (!provider.configured) return;

    setBusyProviderId(provider.id);
    setError(null);

    try {
      const updatedProvider = await updateAIProvider(provider.id, !provider.enabled);
      applyUpdatedProvider(updatedProvider);
      setNotice(
        updatedProvider.enabled
          ? `${updatedProvider.name} is ON and available for AI tasks.`
          : `${updatedProvider.name} is OFF and will be skipped.`
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
      const updatedProvider = await updateAIProviderCredentials(provider.id, credentials);
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

  async function handleModelSwitch(provider, model) {
    if (!provider?.id || !model || provider.selectedModel === model) {
      return;
    }

    setSavingModelProviderId(provider.id);
    setError(null);

    try {
      const updatedProvider = await updateAIProviderModel(provider.id, model);
      applyUpdatedProvider(updatedProvider);
      setNotice(`${updatedProvider.name} model switched to ${updatedProvider.selectedModel}.`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSavingModelProviderId(null);
    }
  }

  if (loading) return <LoadingSpinner message="Loading AI provider status..." />;
  if (error && !providers) return <ErrorAlert message={error} onRetry={fetchProviderStatus} />;

  const providerDetails = providers?.details || [];
  const configuredCount = providerDetails.filter((p) => p.configured).length;
  const activeCount = providerDetails.filter((p) => p.active).length;
  const totalProviders = providerDetails.length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">AI Providers</h2>
        <p className="text-sm text-gray-500">
          Configure and manage AI provider API keys. These providers power keyword filtering, content analysis, and other AI-driven features across the tool.
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
              Save API credentials, then turn providers on or off. Active providers are available for AI-powered features.
            </p>
          </div>

          <div className="divide-y divide-gray-100">
            {providerDetails.map((provider) => {
              const isBusy = busyProviderId === provider.id;
              const isSavingCredentials = savingCredentialsId === provider.id;
              const providerDraft = credentialDrafts[provider.id] || {};

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
                  </div>

                  <div className="mt-3 space-y-3">
                    <div className="text-xs font-medium text-gray-700 mb-1">Models</div>
                    <div className="flex flex-wrap gap-2">
                      {provider.models.map((model) => (
                        <button
                          key={model}
                          type="button"
                          onClick={() => handleModelSwitch(provider, model)}
                          disabled={savingModelProviderId === provider.id || model === provider.selectedModel}
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
                            model === provider.selectedModel
                              ? 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                              : 'bg-gray-100 text-gray-600 border border-transparent hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700'
                          }`}
                        >
                          {model}
                          {model === provider.selectedModel && (
                            <span className="ml-1 text-[10px] opacity-70">
                              ({provider.selectedModelSource === 'saved' ? 'selected' : provider.selectedModelSource || 'selected'})
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
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

          <div className="bg-violet-50 border border-violet-200 rounded-lg p-5">
            <h3 className="font-semibold text-violet-900">How it works</h3>
            <ul className="mt-3 space-y-2 text-sm text-violet-800">
              <li>Save the API key in the field beside each provider.</li>
              <li>Configured + ON: the provider is available for AI-powered features like keyword filtering and content analysis.</li>
              <li>Configured + OFF: the API key stays saved, but the provider is skipped.</li>
              <li>Env values still work too, but this page can store and update credentials directly.</li>
            </ul>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
            <h3 className="font-semibold text-blue-900">Quick Links</h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <a href="https://build.nvidia.com/" target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                  NVIDIA Build (NVAPI)
                </a>
              </li>
              <li>
                <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                  DeepSeek Platform
                </a>
              </li>
              <li>
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                  OpenAI API Keys
                </a>
              </li>
              <li>
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                  Google AI Studio (Gemini)
                </a>
              </li>
              <li>
                <a href="https://console.x.ai/" target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                  xAI Console (Grok)
                </a>
              </li>
              <li>
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                  Anthropic Console (Claude)
                </a>
              </li>
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
