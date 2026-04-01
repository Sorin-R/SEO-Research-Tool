/**
 * AI Provider Manager
 *
 * Manages multiple AI providers (DeepSeek, ChatGPT, OpenRouter, Gemini, Grok, Claude)
 * with credential management, enable/disable toggles, and status reporting.
 * Follows the same pattern as the SERP provider system.
 */

const axios = require('axios');
const db = require('../database');
const localStore = require('../utils/localStore');

// ---------------------------------------------------------------------------
// Provider Definitions
// ---------------------------------------------------------------------------

const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_FALLBACK_FREE_MODELS = [
  'google/gemma-3-27b-it:free',
  'google/gemma-3-12b-it:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'deepseek/deepseek-r1:free',
  'qwen/qwen2.5-vl-72b-instruct:free',
];
const OPENROUTER_MODEL_CACHE_TTL_MS = Number.parseInt(process.env.OPENROUTER_MODEL_CACHE_TTL_MS || '900000', 10);
const OPENROUTER_MODEL_FETCH_TIMEOUT_MS = Number.parseInt(process.env.OPENROUTER_MODEL_FETCH_TIMEOUT_MS || '5000', 10);
const PROVIDER_TEST_TIMEOUT_MS = Number.parseInt(process.env.AI_PROVIDER_TEST_TIMEOUT_MS || '30000', 10);

let openRouterFreeModelCache = {
  models: [...OPENROUTER_FALLBACK_FREE_MODELS],
  fetchedAt: 0,
};

const AI_PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'High-performance AI models with competitive pricing and strong reasoning capabilities.',
    docsUrl: 'https://platform.deepseek.com/api-docs',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    fields: [
      { name: 'DEEPSEEK_API_KEY', label: 'API Key', envKey: 'DEEPSEEK_API_KEY' },
    ],
    quota: 'Pay-as-you-go',
    quotaType: 'Token-based billing',
    setupTime: '~2 min',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA (NVAPI)',
    description: 'NVIDIA NIM OpenAI-compatible endpoint, including DeepSeek models served via build.nvidia.com.',
    docsUrl: 'https://build.nvidia.com/',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    modelEnvKey: 'NVAPI_MODEL',
    models: ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-v3.1', 'deepseek-ai/deepseek-v3.2'],
    defaultModel: 'meta/llama-3.3-70b-instruct',
    requestMode: 'chat_completions',
    fields: [
      { name: 'NVAPI_API_KEY', label: 'API Key', envKey: 'NVAPI_API_KEY' },
    ],
    quota: 'Depends on NVIDIA account plan',
    quotaType: 'Usage-based billing',
    setupTime: '~2 min',
  },
  {
    id: 'openai',
    name: 'ChatGPT (OpenAI)',
    description: 'Industry-leading OpenAI models including the latest GPT-5 family for strong reasoning and generation quality.',
    docsUrl: 'https://platform.openai.com/docs/guides/latest-model',
    baseUrl: 'https://api.openai.com/v1',
    modelEnvKey: 'OPENAI_MODEL',
    models: [
      'gpt-5.4',
      'gpt-5.4-pro',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5-chat-latest',
      'gpt-5',
      'gpt-5-mini',
      'gpt-5-nano',
      'o3',
      'o4-mini',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
    ],
    defaultModel: 'gpt-5.4-mini',
    requestMode: 'responses',
    fields: [
      { name: 'OPENAI_API_KEY', label: 'API Key', envKey: 'OPENAI_API_KEY' },
    ],
    quota: 'Pay-as-you-go',
    quotaType: 'Token-based billing',
    setupTime: '~2 min',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified OpenAI-compatible gateway with broad model support. Free-tier models are auto-discovered.',
    docsUrl: 'https://openrouter.ai/docs',
    baseUrl: OPENROUTER_DEFAULT_BASE_URL,
    modelEnvKey: 'OPENROUTER_MODEL',
    models: OPENROUTER_FALLBACK_FREE_MODELS,
    defaultModel: OPENROUTER_FALLBACK_FREE_MODELS[0],
    requestMode: 'chat_completions',
    fields: [
      { name: 'OPENROUTER_API_KEY', label: 'API Key', envKey: 'OPENROUTER_API_KEY' },
    ],
    quota: 'Free models + paid routing',
    quotaType: 'Per-model usage billing',
    setupTime: '~2 min',
  },
  {
    id: 'gemini',
    name: 'Gemini (Google)',
    description: 'Google\'s multimodal AI with generous free tier and fast inference speeds.',
    docsUrl: 'https://ai.google.dev/docs',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
    fields: [
      { name: 'GOOGLE_AI_API_KEY', label: 'API Key', envKey: 'GOOGLE_AI_API_KEY' },
    ],
    quota: '1,500 req/day free',
    quotaType: 'Free tier + pay-as-you-go',
    setupTime: '~2 min',
  },
  {
    id: 'gemini-vertex',
    name: 'Gemini Vertex (OAuth2)',
    description: 'Gemini via Google Cloud Vertex AI using OAuth2 refresh token credentials.',
    docsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference',
    baseUrl: 'https://aiplatform.googleapis.com/v1',
    requestMode: 'vertex_oauth2',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-001'],
    defaultModel: 'gemini-2.5-flash',
    fields: [
      { name: 'GOOGLE_VERTEX_PROJECT_ID', label: 'GCP Project ID', envKey: 'GOOGLE_VERTEX_PROJECT_ID' },
      { name: 'GOOGLE_VERTEX_LOCATION', label: 'GCP Location', envKey: 'GOOGLE_VERTEX_LOCATION' },
      { name: 'GOOGLE_VERTEX_CLIENT_ID', label: 'OAuth Client ID', envKey: 'GOOGLE_VERTEX_CLIENT_ID' },
      { name: 'GOOGLE_VERTEX_CLIENT_SECRET', label: 'OAuth Client Secret', envKey: 'GOOGLE_VERTEX_CLIENT_SECRET' },
      { name: 'GOOGLE_VERTEX_REFRESH_TOKEN', label: 'OAuth Refresh Token', envKey: 'GOOGLE_VERTEX_REFRESH_TOKEN' },
    ],
    quota: 'Google Cloud billing + Vertex quotas',
    quotaType: 'Project quotas + model rate limits',
    setupTime: '~8 min',
  },
  {
    id: 'grok',
    name: 'Grok (xAI)',
    description: 'xAI\'s conversational AI with real-time knowledge and strong analytical capabilities.',
    docsUrl: 'https://docs.x.ai/docs',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-3', 'grok-3-mini', 'grok-2'],
    defaultModel: 'grok-3-mini',
    fields: [
      { name: 'XAI_API_KEY', label: 'API Key', envKey: 'XAI_API_KEY' },
    ],
    quota: '$25/month free credit',
    quotaType: 'Free credit + pay-as-you-go',
    setupTime: '~3 min',
  },
  {
    id: 'claude',
    name: 'Claude (Anthropic)',
    description: 'Anthropic\'s AI assistant excelling at analysis, writing, and complex reasoning tasks.',
    docsUrl: 'https://docs.anthropic.com/en/docs/welcome',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414'],
    defaultModel: 'claude-sonnet-4-20250514',
    fields: [
      { name: 'ANTHROPIC_API_KEY', label: 'API Key', envKey: 'ANTHROPIC_API_KEY' },
    ],
    quota: 'Pay-as-you-go',
    quotaType: 'Token-based billing',
    setupTime: '~2 min',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shouldUseLocalFallback(err) {
  if (!err) return false;

  const fallbackCodes = new Set([
    'ER_ACCESS_DENIED_ERROR',
    'ER_NO_SUCH_TABLE',
    'ER_BAD_FIELD_ERROR',
    'ER_DUP_FIELDNAME',
    'ER_PARSE_ERROR',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT',
    'PROTOCOL_CONNECTION_LOST',
  ]);

  if (fallbackCodes.has(err.code)) return true;

  const message = String(err.message || '').toLowerCase();
  return (
    message.includes('access denied') ||
    message.includes('connection') ||
    message.includes('connect') ||
    message.includes('timeout') ||
    message.includes('not available') ||
    message.includes("doesn't exist") ||
    message.includes('does not exist') ||
    message.includes('unknown column') ||
    message.includes('no such table')
  );
}

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function uniqueModelList(models, fallback = []) {
  const list = Array.isArray(models) ? models : fallback;
  const seen = new Set();
  const output = [];

  for (const value of list) {
    const model = String(value || '').trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    output.push(model);
  }

  return output;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function isOpenRouterModelFree(model) {
  if (!model || typeof model !== 'object') return false;

  const id = String(model.id || '').trim().toLowerCase();
  const name = String(model.name || '').trim().toLowerCase();
  if (id.includes(':free') || name.includes(' free')) {
    return true;
  }

  const pricing = model.pricing && typeof model.pricing === 'object'
    ? model.pricing
    : {};
  const numericValues = Object.values(pricing)
    .map((value) => toNumber(value))
    .filter((value) => value != null);

  if (numericValues.length === 0) {
    return false;
  }

  return numericValues.every((value) => value <= 0);
}

async function fetchOpenRouterFreeModels(provider, credentialsMap = {}) {
  const ttlMs = toPositiveInteger(OPENROUTER_MODEL_CACHE_TTL_MS, 900000);
  if (Date.now() - openRouterFreeModelCache.fetchedAt < ttlMs && openRouterFreeModelCache.models.length > 0) {
    return [...openRouterFreeModelCache.models];
  }

  const apiKey = resolveCredentialValue(provider, 'OPENROUTER_API_KEY', credentialsMap).value;
  const endpoint = `${resolveProviderBaseUrl(provider) || OPENROUTER_DEFAULT_BASE_URL}/models`;
  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const { data } = await axios.get(endpoint, {
      headers,
      timeout: toPositiveInteger(OPENROUTER_MODEL_FETCH_TIMEOUT_MS, 5000),
    });

    const rows = Array.isArray(data?.data) ? data.data : [];
    const discovered = rows
      .filter((item) => item && item.archived !== true)
      .filter((item) => isOpenRouterModelFree(item))
      .map((item) => String(item.id || '').trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));

    const models = uniqueModelList(discovered, OPENROUTER_FALLBACK_FREE_MODELS);
    openRouterFreeModelCache = {
      models: models.length > 0 ? models : [...OPENROUTER_FALLBACK_FREE_MODELS],
      fetchedAt: Date.now(),
    };
  } catch (err) {
    console.warn('[AIProviderManager] OpenRouter model discovery failed, using cached/fallback list:', err.message);
    if (openRouterFreeModelCache.models.length === 0) {
      openRouterFreeModelCache = {
        models: [...OPENROUTER_FALLBACK_FREE_MODELS],
        fetchedAt: Date.now(),
      };
    }
  }

  return [...openRouterFreeModelCache.models];
}

async function resolveProviderModels(provider, credentialsMap = {}) {
  if (provider.id === 'openrouter') {
    return fetchOpenRouterFreeModels(provider, credentialsMap);
  }

  return uniqueModelList(provider.models);
}

// ---------------------------------------------------------------------------
// Credential Management (DB + env fallback)
// ---------------------------------------------------------------------------

async function getAICredentialsMap() {
  try {
    const rows = await db.query(
      `SELECT provider_id, credential_key, credential_value, updated_at
       FROM ai_provider_credentials`
    );

    return rows.reduce((acc, row) => {
      if (!acc[row.provider_id]) acc[row.provider_id] = {};
      acc[row.provider_id][row.credential_key] = {
        value: row.credential_value,
        updated_at: row.updated_at || null,
      };
      return acc;
    }, {});
  } catch (err) {
    if (!shouldUseLocalFallback(err)) throw err;
    console.warn('[AIProviderManager] DB unavailable for credentials, using local store:', err.message);
    return localStore.getAIProviderCredentials ? localStore.getAIProviderCredentials() : {};
  }
}

async function updateAICredentials(providerId, credentials = {}) {
  if (!providerId || !String(providerId).trim()) {
    throw createServiceError('Provider id is required.');
  }

  const entries = Object.entries(credentials).filter(([, value]) => String(value || '').trim());
  if (entries.length === 0) {
    throw createServiceError('At least one credential value is required.');
  }

  try {
    for (const [credentialKey, credentialValue] of entries) {
      await db.query(
        `INSERT INTO ai_provider_credentials (provider_id, credential_key, credential_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE credential_value = VALUES(credential_value)`,
        [providerId, credentialKey, String(credentialValue).trim()]
      );
    }
  } catch (err) {
    if (!shouldUseLocalFallback(err)) throw err;
    console.warn('[AIProviderManager] DB unavailable for updateAICredentials, using local store:', err.message);
    if (localStore.updateAIProviderCredentials) {
      await localStore.updateAIProviderCredentials(providerId, credentials);
    }
  }

  return getAICredentialsMap();
}

// ---------------------------------------------------------------------------
// Settings Management (enabled/disabled)
// ---------------------------------------------------------------------------

async function getAISettingsMap() {
  try {
    const rows = await db.query(
      `SELECT provider_id, is_enabled, updated_at
       FROM ai_provider_settings`
    );

    return rows.reduce((acc, row) => {
      acc[row.provider_id] = {
        is_enabled: Boolean(row.is_enabled),
        updated_at: row.updated_at || null,
      };
      return acc;
    }, {});
  } catch (err) {
    if (!shouldUseLocalFallback(err)) throw err;
    console.warn('[AIProviderManager] DB unavailable for settings, using local store:', err.message);
    return localStore.getAIProviderSettings ? localStore.getAIProviderSettings() : {};
  }
}

async function updateAISetting(providerId, isEnabled) {
  if (!providerId || !String(providerId).trim()) {
    throw createServiceError('Provider id is required.');
  }

  try {
    await db.query(
      `INSERT INTO ai_provider_settings (provider_id, is_enabled)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled)`,
      [providerId, isEnabled ? 1 : 0]
    );
  } catch (err) {
    if (!shouldUseLocalFallback(err)) throw err;
    console.warn('[AIProviderManager] DB unavailable for updateAISetting, using local store:', err.message);
    if (localStore.updateAIProviderSetting) {
      await localStore.updateAIProviderSetting(providerId, isEnabled);
    }
  }
}

// ---------------------------------------------------------------------------
// Status / Provider Details
// ---------------------------------------------------------------------------

function resolveCredentialValue(provider, fieldName, credentialsMap) {
  // 1. Check DB/local-store saved credentials
  const saved = credentialsMap[provider.id]?.[fieldName];
  if (saved?.value) {
    return { value: saved.value, source: 'saved' };
  }

  // 2. Check environment variable
  const field = provider.fields.find((f) => f.name === fieldName);
  const envValue = field?.envKey ? process.env[field.envKey] : undefined;
  if (envValue && envValue.trim() && !envValue.startsWith('your_')) {
    return { value: envValue.trim(), source: 'env' };
  }

  return { value: null, source: null };
}

function resolveProviderBaseUrl(provider) {
  if (provider.id === 'openai') {
    return String(process.env.OPENAI_BASE_URL || provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  if (provider.id === 'openrouter') {
    return String(process.env.OPENROUTER_BASE_URL || provider.baseUrl || OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  if (provider.id === 'nvidia') {
    return String(process.env.NVAPI_BASE_URL || provider.baseUrl || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
  }

  return String(provider.baseUrl || '').replace(/\/+$/, '');
}

function resolveProviderModel(provider, credentialsMap = {}, availableModels = []) {
  const models = uniqueModelList(availableModels, provider.models);
  const savedModel = String(credentialsMap[provider.id]?.MODEL?.value || '').trim();
  if (savedModel && (models.length === 0 || models.includes(savedModel))) {
    return {
      model: savedModel,
      source: 'saved',
    };
  }

  const envModel = provider.modelEnvKey ? String(process.env[provider.modelEnvKey] || '').trim() : '';
  if (envModel && (models.length === 0 || models.includes(envModel))) {
    return {
      model: envModel,
      source: 'env',
    };
  }

  const fallbackModel = models.includes(provider.defaultModel)
    ? provider.defaultModel
    : (models[0] || provider.defaultModel);

  return {
    model: String(fallbackModel || '').trim(),
    source: 'default',
  };
}

async function getProviderDetails() {
  const credentialsMap = await getAICredentialsMap();
  const settingsMap = await getAISettingsMap();
  const details = [];

  for (const provider of AI_PROVIDERS) {
    const models = await resolveProviderModels(provider, credentialsMap);
    const fields = provider.fields.map((field) => {
      const resolved = resolveCredentialValue(provider, field.name, credentialsMap);
      return {
        name: field.name,
        label: field.label,
        hasValue: Boolean(resolved.value),
        source: resolved.source,
      };
    });

    const configured = fields.every((f) => f.hasValue);
    const setting = settingsMap[provider.id];
    const enabled = setting ? setting.is_enabled : true; // default enabled
    const active = configured && enabled;
    const resolvedModel = resolveProviderModel(provider, credentialsMap, models);
    const defaultModel = models.includes(provider.defaultModel)
      ? provider.defaultModel
      : (models[0] || provider.defaultModel);

    details.push({
      id: provider.id,
      name: provider.name,
      description: provider.description,
      docsUrl: provider.docsUrl,
      baseUrl: resolveProviderBaseUrl(provider),
      models,
      defaultModel,
      selectedModel: resolvedModel.model,
      selectedModelSource: resolvedModel.source,
      requestMode: provider.requestMode || 'responses',
      fields,
      configured,
      enabled,
      active,
      quota: provider.quota,
      quotaType: provider.quotaType,
      setupTime: provider.setupTime,
    });
  }

  return details;
}

async function getStatus() {
  const details = await getProviderDetails();
  return {
    available: details.map((p) => p.name),
    configured: details.filter((p) => p.configured).map((p) => p.name),
    active: details.filter((p) => p.active).map((p) => p.name),
    details,
  };
}

async function getProviderById(providerId) {
  const details = await getProviderDetails();
  return details.find((p) => p.id === providerId) || null;
}

async function toggleProvider(providerId, enabled) {
  const definition = AI_PROVIDERS.find((p) => p.id === providerId);
  if (!definition) {
    throw createServiceError(`Unknown AI provider: ${providerId}`, 404);
  }

  await updateAISetting(providerId, enabled);
  return getProviderById(providerId);
}

async function saveProviderCredentials(providerId, credentials) {
  const definition = AI_PROVIDERS.find((p) => p.id === providerId);
  if (!definition) {
    throw createServiceError(`Unknown AI provider: ${providerId}`, 404);
  }

  await updateAICredentials(providerId, credentials);
  return getProviderById(providerId);
}

async function updateProviderModel(providerId, model) {
  const definition = AI_PROVIDERS.find((entry) => entry.id === providerId);

  if (!definition) {
    throw createServiceError(`Unknown AI provider: ${providerId}`, 404);
  }

  const normalizedModel = String(model || '').trim();
  if (!normalizedModel) {
    throw createServiceError('Model is required.');
  }

  const credentialsMap = await getAICredentialsMap();
  const availableModels = await resolveProviderModels(definition, credentialsMap);
  if (availableModels.length > 0 && !availableModels.includes(normalizedModel)) {
    throw createServiceError(`Model "${normalizedModel}" is not available for ${definition.name}.`);
  }

  await updateAICredentials(providerId, { MODEL: normalizedModel });
  return getProviderById(providerId);
}

async function getKeywordAIRuntimeConfig() {
  const credentialsMap = await getAICredentialsMap();
  const settingsMap = await getAISettingsMap();
  const supportedProviderIds = ['openrouter', 'nvidia', 'openai'];

  for (const providerId of supportedProviderIds) {
    const provider = AI_PROVIDERS.find((entry) => entry.id === providerId);

    if (!provider) {
      continue;
    }

    const setting = settingsMap[provider.id];
    const enabled = setting ? setting.is_enabled : true;
    if (!enabled) {
      continue;
    }

    const primaryField = provider.fields[0];
    if (!primaryField) {
      continue;
    }

    const resolvedCredential = resolveCredentialValue(provider, primaryField.name, credentialsMap);
    if (!resolvedCredential.value) {
      continue;
    }

    return {
      id: provider.id,
      name: provider.name,
      apiKey: resolvedCredential.value,
      baseUrl: resolveProviderBaseUrl(provider),
      model: resolveProviderModel(provider, credentialsMap).model,
      requestMode: provider.requestMode || 'responses',
    };
  }

  return null;
}

/**
 * Get the API key for a specific provider (used by other services).
 */
async function getProviderApiKey(providerId) {
  const definition = AI_PROVIDERS.find((p) => p.id === providerId);
  if (!definition) return null;

  const credentialsMap = await getAICredentialsMap();
  const primaryField = definition.fields[0];
  if (!primaryField) return null;

  const resolved = resolveCredentialValue(definition, primaryField.name, credentialsMap);
  return resolved.value;
}

async function getProviderCredentials(providerId) {
  const definition = AI_PROVIDERS.find((entry) => entry.id === providerId);
  if (!definition) {
    return null;
  }

  const credentialsMap = await getAICredentialsMap();
  const result = {};
  for (const field of definition.fields) {
    const resolved = resolveCredentialValue(definition, field.name, credentialsMap);
    result[field.name] = resolved.value || null;
  }

  const models = await resolveProviderModels(definition, credentialsMap);
  const resolvedModel = resolveProviderModel(definition, credentialsMap, models);
  result.MODEL = resolvedModel.model || definition.defaultModel || null;

  return result;
}

function resolveTestRequestMode(provider) {
  if (provider.id === 'gemini') return 'gemini';
  if (provider.id === 'gemini-vertex') return 'vertex_oauth2';
  if (provider.id === 'claude') return 'anthropic_messages';
  if (provider.id === 'openai') return 'responses';
  if (provider.id === 'nvidia' || provider.id === 'openrouter' || provider.id === 'grok' || provider.id === 'deepseek') {
    return 'chat_completions';
  }

  return provider.requestMode === 'chat_completions' ? 'chat_completions' : 'responses';
}

function extractProviderApiKey(provider, credentials = {}) {
  if (!provider?.fields?.length) return '';
  const primaryField = provider.fields[0];
  return String(credentials[primaryField.name] || '').trim();
}

function extractUpstreamErrorMessage(err) {
  return String(
    err?.response?.data?.error?.message
    || err?.response?.data?.error
    || err?.response?.data?.message
    || err?.message
    || 'Unknown provider error.'
  ).trim();
}

async function fetchGoogleOAuthAccessTokenForVertex(credentials = {}) {
  const clientId = String(credentials.GOOGLE_VERTEX_CLIENT_ID || '').trim();
  const clientSecret = String(credentials.GOOGLE_VERTEX_CLIENT_SECRET || '').trim();
  const refreshToken = String(credentials.GOOGLE_VERTEX_REFRESH_TOKEN || '').trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw createServiceError('Gemini Vertex credentials are incomplete.', 412);
  }

  const response = await axios.post(
    'https://oauth2.googleapis.com/token',
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: PROVIDER_TEST_TIMEOUT_MS,
    }
  );

  const accessToken = String(response?.data?.access_token || '').trim();
  if (!accessToken) {
    throw createServiceError('Gemini Vertex token exchange returned no access token.', 502);
  }

  return accessToken;
}

async function requestProviderTest(provider, credentials = {}) {
  const model = String(provider.selectedModel || provider.defaultModel || credentials.MODEL || '').trim();
  if (!model) {
    throw createServiceError(`No model selected for ${provider.name}.`, 400);
  }

  const requestMode = resolveTestRequestMode(provider);
  const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '');
  const apiKey = extractProviderApiKey(provider, credentials);

  if (requestMode !== 'vertex_oauth2' && requestMode !== 'gemini' && requestMode !== 'anthropic_messages' && !apiKey) {
    throw createServiceError(`${provider.name} API key is missing.`, 412);
  }

  if (requestMode === 'gemini') {
    const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    await axios.post(
      endpoint,
      {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Reply with exactly: OK' }],
          },
        ],
        generationConfig: {
          temperature: 0,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: PROVIDER_TEST_TIMEOUT_MS,
      }
    );
    return requestMode;
  }

  if (requestMode === 'vertex_oauth2') {
    const projectId = String(credentials.GOOGLE_VERTEX_PROJECT_ID || '').trim();
    const location = String(credentials.GOOGLE_VERTEX_LOCATION || '').trim().toLowerCase();
    if (!projectId || !location) {
      throw createServiceError('Gemini Vertex requires GOOGLE_VERTEX_PROJECT_ID and GOOGLE_VERTEX_LOCATION.', 412);
    }

    const accessToken = await fetchGoogleOAuthAccessTokenForVertex(credentials);
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    await axios.post(
      endpoint,
      {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Reply with exactly: OK' }],
          },
        ],
        generationConfig: {
          temperature: 0,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: PROVIDER_TEST_TIMEOUT_MS,
      }
    );
    return requestMode;
  }

  if (requestMode === 'anthropic_messages') {
    await axios.post(
      `${baseUrl}/messages`,
      {
        model,
        max_tokens: 16,
        messages: [
          {
            role: 'user',
            content: 'Reply with exactly: OK',
          },
        ],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: PROVIDER_TEST_TIMEOUT_MS,
      }
    );
    return requestMode;
  }

  if (requestMode === 'chat_completions') {
    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        temperature: 0,
        max_tokens: 16,
        messages: [
          {
            role: 'user',
            content: 'Reply with exactly: OK',
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: PROVIDER_TEST_TIMEOUT_MS,
      }
    );

    const firstContent = String(response?.data?.choices?.[0]?.message?.content || '').trim();
    if (!firstContent && !Array.isArray(response?.data?.choices)) {
      throw createServiceError(`${provider.name} returned an unexpected response payload.`, 502);
    }

    return requestMode;
  }

  // Default: OpenAI-style responses API
  await axios.post(
    `${baseUrl}/responses`,
    {
      model,
      input: 'Reply with exactly: OK',
      max_output_tokens: 16,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: PROVIDER_TEST_TIMEOUT_MS,
    }
  );

  return 'responses';
}

async function testProviderConnection(providerId) {
  const provider = await getProviderById(providerId);
  if (!provider) {
    throw createServiceError(`Unknown AI provider: ${providerId}`, 404);
  }

  const credentials = await getProviderCredentials(provider.id);
  if (!provider.configured) {
    throw createServiceError(`${provider.name} is not configured. Add required credentials first.`, 412);
  }

  const startedAt = Date.now();

  try {
    const requestMode = await requestProviderTest(provider, credentials || {});
    return {
      providerId: provider.id,
      providerName: provider.name,
      connected: true,
      model: provider.selectedModel || provider.defaultModel || credentials?.MODEL || null,
      requestMode,
      responseTimeMs: Date.now() - startedAt,
      message: `${provider.name} test successful.`,
    };
  } catch (err) {
    if (err.statusCode) {
      throw err;
    }

    const statusCode = Number(err?.response?.status || 0);
    const upstreamMessage = extractUpstreamErrorMessage(err);

    if (statusCode === 401 || statusCode === 403) {
      throw createServiceError(`${provider.name} authentication failed: ${upstreamMessage}`, 401);
    }

    if (statusCode === 429) {
      throw createServiceError(`${provider.name} is rate limited right now.`, 429);
    }

    throw createServiceError(`${provider.name} test failed: ${upstreamMessage}`, 502);
  }
}

module.exports = {
  AI_PROVIDERS,
  getStatus,
  getProviderById,
  getProviderDetails,
  toggleProvider,
  saveProviderCredentials,
  updateProviderModel,
  getProviderApiKey,
  getProviderCredentials,
  testProviderConnection,
  getKeywordAIRuntimeConfig,
  getAICredentialsMap,
  getAISettingsMap,
};
