'use strict';

/**
 * providerRegistry.js — Central map of AI providers.
 *
 * Defines every supported provider: its display label, the env var that holds
 * its API key, which model-ID prefixes it owns, and the filename of its adapter.
 *
 * Used by:
 *   - AgentOrchestrator.getProvider()  → route model → correct adapter
 *   - GET  /admin/model-status         → report which API keys are set
 *   - POST /admin/models/:id/test      → call the right adapter for a test ping
 */

const path = require('path');

const PROVIDERS = {
  anthropic: {
    label:         'Anthropic',
    envVar:        'ANTHROPIC_API_KEY',
    modelPrefixes: ['claude-'],
    adapter:       'anthropic',
  },
  google: {
    label:         'Google',
    envVar:        'GEMINI_API_KEY',
    modelPrefixes: ['gemini-'],
    adapter:       'gemini',
  },
  openai: {
    label:         'OpenAI',
    envVar:        'OPENAI_API_KEY',
    modelPrefixes: ['gpt-', 'o1-', 'o3-', 'o4-', 'chatgpt-'],
    adapter:       'openai',
  },
  mistral: {
    label:         'Mistral',
    envVar:        'MISTRAL_API_KEY',
    modelPrefixes: ['mistral-', 'codestral-', 'open-mistral-', 'open-codestral-', 'pixtral-'],
    adapter:       'mistral',
  },
  deepseek: {
    label:         'DeepSeek',
    envVar:        'DEEPSEEK_API_KEY',
    modelPrefixes: ['deepseek-'],
    adapter:       'deepseek',
  },
  xai: {
    label:         'xAI (Grok)',
    envVar:        'XAI_API_KEY',
    modelPrefixes: ['grok-'],
    adapter:       'xai',
  },
  groq: {
    label:         'Groq',
    envVar:        'GROQ_API_KEY',
    modelPrefixes: ['llama-', 'meta-llama', 'mixtral-8x', 'gemma-'],
    adapter:       'groq',
  },
};

/**
 * Return the provider entry for a model ID.
 * Checks each provider's modelPrefixes in registration order.
 * Falls back to Anthropic for any unrecognised prefix.
 *
 * @param {string} modelId
 * @returns {object} PROVIDERS entry
 */
function resolveProvider(modelId) {
  if (!modelId) return PROVIDERS.anthropic;
  const lower = modelId.toLowerCase();
  for (const prov of Object.values(PROVIDERS)) {
    for (const prefix of prov.modelPrefixes) {
      if (lower.startsWith(prefix.toLowerCase())) return prov;
    }
  }
  return PROVIDERS.anthropic;
}

/**
 * Try to build an on-the-fly OpenAI-compatible adapter for an unknown provider.
 *
 * Convention (set both in Railway / .env):
 *   {PREFIX}_API_KEY   — e.g. SEEDANCE_API_KEY
 *   {PREFIX}_BASE_URL  — e.g. SEEDANCE_BASE_URL=https://api.seedance.ai/v1/chat/completions
 *
 * PREFIX is derived from the model ID: everything before the first '-'.
 * e.g. model ID "seedance-v3" → prefix "SEEDANCE"
 *
 * Returns null if the env vars are not set or the URL is invalid.
 *
 * @param {string} modelId
 * @returns {{ chat: Function }|null}
 */
function getDynamicAdapter(modelId) {
  const dashIdx = (modelId || '').indexOf('-');
  if (dashIdx < 1) return null;

  const prefix = modelId.slice(0, dashIdx).toUpperCase();
  const keyVar = `${prefix}_API_KEY`;
  const urlVar = `${prefix}_BASE_URL`;

  const apiKey  = process.env[keyVar];
  const baseUrl = process.env[urlVar];
  if (!apiKey || !baseUrl) return null;

  try {
    const parsed = new URL(baseUrl);
    const { createAdapter } = require('./providers/openai-compatible');
    return createAdapter({
      hostname: parsed.hostname,
      path:     parsed.pathname + (parsed.search || ''),
      envVar:   keyVar,
      label:    prefix,
    });
  } catch {
    return null;
  }
}

/**
 * Build an adapter from a custom provider config object
 * { key, label, apiKeyEnv, baseUrl }
 */
function buildCustomAdapter(cp) {
  const { createAdapter } = require('./providers/openai-compatible');
  const parsed = new URL(cp.baseUrl);
  return createAdapter({
    hostname: parsed.hostname,
    path:     parsed.pathname + (parsed.search || ''),
    envVar:   cp.apiKeyEnv,
    label:    cp.label || cp.key,
  });
}

/**
 * Return the loaded adapter for a model ID.
 * customProviders is an optional array of { key, label, apiKeyEnv, baseUrl }
 * loaded from the DB by the caller (AgentOrchestrator).
 *
 * Resolution order:
 *   1. Registered provider prefixes (hardcoded, fast)
 *   2. Custom providers from DB (passed in as array)
 *   3. Dynamic env var convention (PREFIX_API_KEY + PREFIX_BASE_URL)
 *   4. Anthropic fallback
 */
function getAdapterWithCustom(modelId, customProviders) {
  const lower = (modelId ?? '').toLowerCase();

  // 1. Hardcoded registry
  for (const prov of Object.values(PROVIDERS)) {
    for (const prefix of prov.modelPrefixes) {
      if (lower.startsWith(prefix.toLowerCase())) {
        return require(path.join(__dirname, 'providers', prov.adapter));
      }
    }
  }

  // 2. Custom providers from DB
  for (const cp of (customProviders || [])) {
    if (!cp.key || !cp.baseUrl || !cp.apiKeyEnv) continue;
    const cpKey = cp.key.toLowerCase();
    if (lower === cpKey || lower.startsWith(cpKey + '-')) {
      try { return buildCustomAdapter(cp); } catch { /* bad URL — skip */ }
    }
  }

  // 3. Dynamic env var convention (PREFIX_API_KEY + PREFIX_BASE_URL)
  const dynamic = getDynamicAdapter(modelId ?? '');
  if (dynamic) return dynamic;

  // 4. Anthropic fallback
  return require(path.join(__dirname, 'providers', PROVIDERS.anthropic.adapter));
}

/**
 * Synchronous single-argument version (no custom providers).
 * Used by admin test endpoint and anywhere orgId is unavailable.
 */
function getAdapter(modelId) {
  return getAdapterWithCustom(modelId, []);
}

module.exports = { PROVIDERS, resolveProvider, getAdapter, getAdapterWithCustom, buildCustomAdapter, getDynamicAdapter };
