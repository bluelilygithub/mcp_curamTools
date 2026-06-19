'use strict';

/**
 * PersonalMemoryService — per-user semantic memory within an organisation.
 *
 * Distinct from org-wide embeddings (RAG) and agent_lessons (curated rules).
 * Every query is scoped to org_id + user_id.
 */

const crypto = require('crypto');
const { pool } = require('../db');
const { embedText } = require('./EmbeddingService');

const MAX_CONTENT_CHARS = 30000;

function normalizeContent(text) {
  return String(text || '').trim().slice(0, MAX_CONTENT_CHARS);
}

function contentFingerprint(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function parseOrgUserIds(orgId, userId) {
  const parsedOrgId = parseInt(orgId, 10);
  const parsedUserId = parseInt(userId, 10);
  if (!Number.isInteger(parsedOrgId) || parsedOrgId <= 0) {
    throw new Error('Valid org_id is required.');
  }
  if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
    throw new Error('Valid user_id is required.');
  }
  return { orgId: parsedOrgId, userId: parsedUserId };
}

function clampInt(value, fallback, min, max) {
  const parsed = parseInt(value ?? fallback, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

/**
 * Capture or update a thought for the current user (deduped by content hash).
 */
async function capture({ orgId, userId, content, metadata = {} }) {
  const ids = parseOrgUserIds(orgId, userId);
  const normalized = normalizeContent(content);
  if (!normalized) throw new Error('content is required');

  const fingerprint = contentFingerprint(normalized);
  const vector = await embedText(normalized);
  const vectorStr = `[${vector.join(',')}]`;
  const meta = metadata && typeof metadata === 'object' ? metadata : {};

  const { rows } = await pool.query(
    `INSERT INTO personal_thoughts (org_id, user_id, content, content_fingerprint, metadata, embedding)
     VALUES ($1, $2, $3, $4, $5, $6::vector)
     ON CONFLICT (org_id, user_id, content_fingerprint)
     DO UPDATE SET
       content = EXCLUDED.content,
       metadata = personal_thoughts.metadata || EXCLUDED.metadata,
       embedding = EXCLUDED.embedding,
       updated_at = NOW()
     RETURNING id, created_at, updated_at,
       (xmax = 0) AS inserted`,
    [ids.orgId, ids.userId, normalized, fingerprint, JSON.stringify(meta), vectorStr]
  );

  const row = rows[0];
  return {
    id: row.id,
    created: Boolean(row.inserted),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Semantic search over the user's thoughts.
 */
async function search({ orgId, userId, query, limit = 8 }) {
  const ids = parseOrgUserIds(orgId, userId);
  const q = normalizeContent(query);
  if (!q) throw new Error('query is required');

  const cappedLimit = clampInt(limit, 8, 1, 20);
  const vector = await embedText(q);
  const vectorStr = `[${vector.join(',')}]`;

  const { rows } = await pool.query(
    `SELECT
       id,
       content,
       metadata,
       created_at,
       updated_at,
       1 - (embedding <=> $3::vector) AS similarity
     FROM personal_thoughts
     WHERE org_id = $1 AND user_id = $2
     ORDER BY embedding <=> $3::vector
     LIMIT $4`,
    [ids.orgId, ids.userId, vectorStr, cappedLimit]
  );

  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    metadata: r.metadata,
    similarity: parseFloat(r.similarity).toFixed(4),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

/**
 * List recent thoughts (newest first).
 */
async function list({ orgId, userId, limit = 20, offset = 0 }) {
  const ids = parseOrgUserIds(orgId, userId);
  const cappedLimit = clampInt(limit, 20, 1, 50);
  const cappedOffset = clampInt(offset, 0, 0, 10_000);

  const { rows } = await pool.query(
    `SELECT id, content, metadata, created_at, updated_at
     FROM personal_thoughts
     WHERE org_id = $1 AND user_id = $2
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [ids.orgId, ids.userId, cappedLimit, cappedOffset]
  );

  return rows;
}

/**
 * Summary stats for the user's memory store.
 */
async function stats({ orgId, userId }) {
  const ids = parseOrgUserIds(orgId, userId);

  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       MIN(created_at) AS oldest,
       MAX(created_at) AS newest
     FROM personal_thoughts
     WHERE org_id = $1 AND user_id = $2`,
    [ids.orgId, ids.userId]
  );

  return rows[0] ?? { total: 0, oldest: null, newest: null };
}

/**
 * Delete a single thought (must belong to the user).
 */
async function remove({ orgId, userId, id }) {
  const ids = parseOrgUserIds(orgId, userId);
  if (!id) throw new Error('id is required');

  const { rowCount } = await pool.query(
    `DELETE FROM personal_thoughts
     WHERE id = $1 AND org_id = $2 AND user_id = $3`,
    [id, ids.orgId, ids.userId]
  );

  if (rowCount === 0) throw new Error('Thought not found.');
  return { deleted: true, id };
}

module.exports = { capture, search, list, stats, remove };
