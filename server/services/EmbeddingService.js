'use strict';

/**
 * EmbeddingService — org-scoped embeddings for RAG and personal memory.
 * Model selected via Settings > Models > RAG embedding model (system_settings).
 */

const { pool } = require('../db');
const { embedWithModel } = require('./embeddingProviders');
const { resolveEmbeddingConfig } = require('./embeddingResolver');

async function embedText(text, { orgId = 1 } = {}) {
  const config = await resolveEmbeddingConfig(orgId);
  if (!config.available || !config.model) {
    throw new Error(config.hint || 'Embeddings unavailable — configure RAG embedding model in Settings > Models.');
  }
  return embedWithModel(text, config.model);
}

/**
 * Embed text and store in the embeddings table.
 */
async function embedAndStore({ orgId, sourceType, sourceId = null, content, metadata = {} }) {
  const vector = await embedText(content, { orgId });
  const vectorStr = `[${vector.join(',')}]`;

  await pool.query(
    `INSERT INTO embeddings (org_id, source_type, source_id, content, metadata, embedding)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (org_id, source_type, source_id)
     DO UPDATE SET content = EXCLUDED.content, metadata = EXCLUDED.metadata, embedding = EXCLUDED.embedding`,
    [orgId, sourceType, sourceId, content, JSON.stringify(metadata), vectorStr],
  );
}

/**
 * Find the most semantically similar stored embeddings for a query.
 */
async function search({ orgId, query, sourceType = null, limit = 8 }) {
  const vector = await embedText(query, { orgId });
  const vectorStr = `[${vector.join(',')}]`;

  const params = [orgId, vectorStr, limit];
  let sql = `
    SELECT
      id,
      source_type,
      source_id,
      content,
      metadata,
      1 - (embedding <=> $2::vector) AS similarity
    FROM embeddings
    WHERE org_id = $1
  `;
  if (sourceType) { sql += ` AND source_type = $4`; params.push(sourceType); }
  sql += ` ORDER BY embedding <=> $2::vector LIMIT $3`;

  const { rows } = await pool.query(sql, params);
  return rows;
}

module.exports = { embedAndStore, search, embedText, resolveEmbeddingConfig };
