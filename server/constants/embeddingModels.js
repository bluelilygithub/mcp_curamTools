'use strict';

/**
 * Registry of embedding-capable models for RAG and personal memory.
 * Distinct from ai_models (chat/completion catalogue).
 */

const EMBEDDING_DIM = 768;

const EMBEDDING_MODELS = [
  {
    id: 'text-embedding-004',
    provider: 'google',
    label: 'Gemini text-embedding-004',
    dimensions: 768,
    envVar: 'GEMINI_API_KEY',
    localOnly: false,
    description: 'Recommended for production when using Gemini. Powers knowledge base RAG and personal memory.',
  },
  {
    id: 'embedding-001',
    provider: 'google',
    label: 'Gemini embedding-001',
    dimensions: 768,
    envVar: 'GEMINI_API_KEY',
    localOnly: false,
    description: 'Earlier Gemini embedding model (768 dimensions).',
  },
  {
    id: 'text-embedding-3-small',
    provider: 'openai',
    label: 'OpenAI text-embedding-3-small',
    dimensions: 768,
    envVar: 'OPENAI_API_KEY',
    localOnly: false,
    openAiDimensions: 768,
    description: 'OpenAI embeddings at 768 dimensions (matches platform vector size).',
  },
  {
    id: 'nomic-embed-text',
    provider: 'ollama',
    label: 'Ollama nomic-embed-text',
    dimensions: 768,
    envVar: null,
    localOnly: true,
    description: 'Local dev only — requires Ollama with nomic-embed-text pulled.',
  },
];

const MODEL_BY_ID = Object.fromEntries(EMBEDDING_MODELS.map((m) => [m.id, m]));

function isLocalRuntime() {
  const env = String(process.env.APP_ENV || process.env.NODE_ENV || '').toLowerCase();
  return env === 'local' || env === 'development';
}

function getEmbeddingModelById(modelId) {
  if (!modelId) return null;
  return MODEL_BY_ID[String(modelId).trim()] ?? null;
}

function listEmbeddingModels({ includeLocal = null } = {}) {
  const showLocal = includeLocal ?? isLocalRuntime();
  return EMBEDDING_MODELS.filter((m) => !m.localOnly || showLocal);
}

function isProviderConfigured(modelDef) {
  if (!modelDef) return false;
  if (modelDef.provider === 'ollama') return isLocalRuntime();
  if (!modelDef.envVar) return false;
  return !!process.env[modelDef.envVar];
}

/**
 * Validate an embedding model selection for an org.
 * @returns {{ valid: boolean, issues: string[], model: object|null, configured: boolean }}
 */
function validateEmbeddingModelSelection(modelId) {
  const issues = [];
  const model = getEmbeddingModelById(modelId);

  if (!modelId) {
    return { valid: false, issues: ['Select an embedding model for RAG and personal memory.'], model: null, configured: false };
  }

  if (!model) {
    return {
      valid: false,
      issues: [
        `"${modelId}" is not an embedding model. Chat models (e.g. deepseek-v4-flash) cannot be used for RAG — choose a model from the RAG list.`,
      ],
      model: null,
      configured: false,
    };
  }

  if (model.localOnly && !isLocalRuntime()) {
    issues.push(`${model.label} is only available in local development (APP_ENV=local or NODE_ENV=development).`);
  }

  if (model.envVar && !process.env[model.envVar]) {
    issues.push(`${model.envVar} is not set — add it to environment variables and redeploy.`);
  }

  return {
    valid: issues.length === 0,
    issues,
    model,
    configured: isProviderConfigured(model),
  };
}

module.exports = {
  EMBEDDING_DIM,
  EMBEDDING_MODELS,
  getEmbeddingModelById,
  listEmbeddingModels,
  isLocalRuntime,
  isProviderConfigured,
  validateEmbeddingModelSelection,
};
