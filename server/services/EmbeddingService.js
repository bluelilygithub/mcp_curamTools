'use strict';

/**
 * EmbeddingService — generates text embeddings via OpenAI and stores/retrieves
 * them in the pgvector embeddings table.
 *
 * Model: text-embedding-3-small (1536 dimensions, ~$0.00002 per 1k tokens)
 * No external package required — uses Node's built-in https.
 *
 * Required env var: OPENAI_API_KEY
 */

const https  = require('https');
const { pool } = require('../db');
const logger = require('../utils/logger');

const MODEL      = 'text-embedding-3-small';
const DIMENSIONS = 1536;
const MAX_CHARS  = 30000; // ~7500 tokens — well within 8192 token limit

// ── OpenAI embedding call ─────────────────────────────────────────────────────

function fetchEmbedding(text) {
  return new Promise((resolve, reject) => {
    if (!process.env.OPENAI_API_KEY) {
      return reject(new Error('OPENAI_API_KEY is not set — cannot generate embeddings.'));
    }

    const input = String(text).slice(0, MAX_CHARS);
    const body  = JSON.stringify({ model: MODEL, input });

    const req = https.request(
      {
        hostname: 'api.openai.com',
        path:     '/v1/embeddings',
        method:   'POST',
        headers: {
          Authorization:  `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(`OpenAI: ${parsed.error.message}`));
            resolve(parsed.data[0].embedding);
          } catch (e) {
            reject(new Error(`Failed to parse OpenAI response: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Store embedding ───────────────────────────────────────────────────────────

/**
 * Embed text and store in the embeddings table.
 *
 * @param {object} opts
 * @param {number}  opts.orgId
 * @param {string}  opts.sourceType  — 'agent_run' | 'document' | etc.
 * @param {string}  [opts.sourceId]  — ID of the source record
 * @param {string}  opts.content     — text to embed and store
 * @param {object}  [opts.metadata]  — arbitrary JSON (slug, title, dates, etc.)
 */
async function embedAndStore({ orgId, sourceType, sourceId = null, content, metadata = {} }) {
  const vector = await fetchEmbedding(content);

  // pgvector expects the vector as a string like '[0.1, 0.2, ...]'
  const vectorStr = `[${vector.join(',')}]`;

  await pool.query(
    `INSERT INTO embeddings (org_id, source_type, source_id, content, metadata, embedding)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (org_id, source_type, source_id)
     DO UPDATE SET content = EXCLUDED.content, metadata = EXCLUDED.metadata, embedding = EXCLUDED.embedding`,
    [orgId, sourceType, sourceId, content, JSON.stringify(metadata), vectorStr]
  );
}

// ── Similarity search ─────────────────────────────────────────────────────────

/**
 * Find the most semantically similar stored embeddings for a query.
 *
 * @param {object} opts
 * @param {number}  opts.orgId
 * @param {string}  opts.query
 * @param {string}  [opts.sourceType]  — optional filter
 * @param {number}  [opts.limit]       — default 8
 * @returns {Promise<Array>}
 */
async function search({ orgId, query, sourceType = null, limit = 8 }) {
  const vector    = await fetchEmbedding(query);
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

module.exports = { embedAndStore, search };
