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
 * Return the loaded adapter ({ chat }) for a model ID.
 * Node's require() caches the module — no repeated file I/O.
 *
 * @param {string} modelId
 * @returns {{ chat: Function }}
 */
function getAdapter(modelId) {
  const prov = resolveProvider(modelId);
  return require(path.join(__dirname, 'providers', prov.adapter));
}

module.exports = { PROVIDERS, resolveProvider, getAdapter };
