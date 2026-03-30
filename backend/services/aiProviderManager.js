/**
 * AI Provider Manager
 *
 * Manages multiple AI providers (DeepSeek, ChatGPT, Gemini, Grok, Claude)
 * with credential management, enable/disable toggles, and status reporting.
 * Follows the same pattern as the SERP provider system.
 */

const db = require('../database');
const localStore = require('../utils/localStore');

// ---------------------------------------------------------------------------
// Provider Definitions
// ---------------------------------------------------------------------------

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
    id: 'gemini',
    name: 'Gemini (Google)',
    description: 'Google\'s multimodal AI with generous free tier and fast inference speeds.',
    docsUrl: 'https://ai.google.dev/docs',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    defaultModel: 'gemini-2.0-flash',
    fields: [
      { name: 'GOOGLE_AI_API_KEY', label: 'API Key', envKey: 'GOOGLE_AI_API_KEY' },
    ],
    quota: '1,500 req/day free',
    quotaType: 'Free tier + pay-as-you-go',
    setupTime: '~2 min',
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

  if (provider.id === 'nvidia') {
    return String(process.env.NVAPI_BASE_URL || provider.baseUrl || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
  }

  return String(provider.baseUrl || '').replace(/\/+$/, '');
}

function resolveProviderModel(provider, credentialsMap = {}) {
  const savedModel = String(credentialsMap[provider.id]?.MODEL?.value || '').trim();
  if (savedModel && provider.models.includes(savedModel)) {
    return {
      model: savedModel,
      source: 'saved',
    };
  }

  const envModel = provider.modelEnvKey ? String(process.env[provider.modelEnvKey] || '').trim() : '';
  if (envModel && provider.models.includes(envModel)) {
    return {
      model: envModel,
      source: 'env',
    };
  }

  return {
    model: String(provider.defaultModel || '').trim(),
    source: 'default',
  };
}

async function getProviderDetails() {
  const credentialsMap = await getAICredentialsMap();
  const settingsMap = await getAISettingsMap();

  return AI_PROVIDERS.map((provider) => {
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
    const resolvedModel = resolveProviderModel(provider, credentialsMap);

    return {
      id: provider.id,
      name: provider.name,
      description: provider.description,
      docsUrl: provider.docsUrl,
      baseUrl: resolveProviderBaseUrl(provider),
      models: provider.models,
      defaultModel: provider.defaultModel,
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
    };
  });
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

  if (!definition.models.includes(normalizedModel)) {
    throw createServiceError(`Model "${normalizedModel}" is not available for ${definition.name}.`);
  }

  await updateAICredentials(providerId, { MODEL: normalizedModel });
  return getProviderById(providerId);
}

async function getKeywordAIRuntimeConfig() {
  const credentialsMap = await getAICredentialsMap();
  const settingsMap = await getAISettingsMap();
  const supportedProviderIds = ['nvidia', 'openai'];

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

module.exports = {
  AI_PROVIDERS,
  getStatus,
  getProviderById,
  getProviderDetails,
  toggleProvider,
  saveProviderCredentials,
  updateProviderModel,
  getProviderApiKey,
  getKeywordAIRuntimeConfig,
  getAICredentialsMap,
  getAISettingsMap,
};
