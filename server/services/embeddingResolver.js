'use strict';

/**
 * embeddingResolver — org-scoped embedding model from system_settings.
 */

const AgentConfigService = require('../platform/AgentConfigService');
const {
  EMBEDDING_DIM,
  getEmbeddingModelById,
  listEmbeddingModels,
  isProviderConfigured,
  validateEmbeddingModelSelection,
  isLocalRuntime,
} = require('../constants/embeddingModels');

const DEFAULT_MODEL_ID = 'text-embedding-004';

async function resolveEmbeddingConfig(orgId) {
  const oid = parseInt(orgId, 10) || 1;
  let modelId = await AgentConfigService.getOrgEmbeddingModel(oid);

  if (!modelId) {
    const fallback = listEmbeddingModels().find((m) => isProviderConfigured(m));
    modelId = fallback?.id ?? DEFAULT_MODEL_ID;
  }

  const model = getEmbeddingModelById(modelId);
  const validation = validateEmbeddingModelSelection(modelId);

  return {
    orgId: oid,
    modelId,
    model,
    provider: model?.provider ?? null,
    dimensions: model?.dimensions ?? EMBEDDING_DIM,
    available: validation.valid,
    configured: validation.configured,
    issues: validation.issues,
    sourceKey: model ? `${model.provider}:${model.id}` : null,
    hint: validation.valid
      ? `${model.label} via ${model.provider}`
      : (validation.issues[0] || 'Embedding model not configured'),
  };
}

module.exports = {
  EMBEDDING_DIM,
  resolveEmbeddingConfig,
  getEmbeddingModelById,
  listEmbeddingModels,
  validateEmbeddingModelSelection,
  isLocalRuntime,
  DEFAULT_MODEL_ID,
};
