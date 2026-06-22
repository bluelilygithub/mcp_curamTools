'use strict';

/**
 * SuggestionService — shared emitter for agents, services, and startup checks.
 * Per-user inbox scoped to org_id + user_id (table: user_suggestions).
 * Distinct from agent_suggestions (High Intent Advisor, org-only).
 */

const crypto = require('crypto');
const { pool } = require('../db');
const { isValidCategory } = require('../constants/suggestionInbox');
const { getPlatformOrgId } = require('../config/platformOrg');

function makeFingerprint(source, key) {
  const raw = `${source || 'unknown'}:${key || ''}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

function parseOrgUserIds(orgId, userId) {
  const oid = parseInt(orgId, 10);
  const uid = parseInt(userId, 10);
  if (!Number.isInteger(oid) || oid <= 0) throw new Error('Valid orgId is required');
  if (!Number.isInteger(uid) || uid <= 0) throw new Error('Valid userId is required');
  return { orgId: oid, userId: uid };
}

function normalizePayload(payload) {
  const {
    orgId,
    userId,
    category = 'other',
    title,
    body = '',
    context = null,
    source = null,
    fingerprint = null,
  } = payload ?? {};

  const ids = parseOrgUserIds(orgId, userId);
  if (!isValidCategory(category)) throw new Error(`Invalid category: ${category}`);
  if (!title || !String(title).trim()) throw new Error('title is required');

  const fp = fingerprint
    || (source ? makeFingerprint(source, payload.fingerprintKey || title) : null);

  return {
    ...ids,
    category,
    title: String(title).trim().slice(0, 500),
    body: String(body).slice(0, 8000),
    context: context ? String(context).slice(0, 2000) : null,
    source: source ? String(source).slice(0, 120) : null,
    fingerprint: fp,
  };
}

async function getPrimaryAdminForOrg(orgId) {
  const oid = parseInt(orgId, 10) || getPlatformOrgId();
  const platformOrgId = getPlatformOrgId();
  const { rows } = await pool.query(
    `SELECT u.id, u.org_id
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     WHERE ur.role_name = 'org_admin'
       AND ur.scope_type = 'global'
       AND u.org_id = $1
     ORDER BY u.id ASC
     LIMIT 1`,
    [oid],
  );
  if (rows.length) return { orgId: rows[0].org_id, userId: rows[0].id };

  if (oid === platformOrgId) return null;

  const fallback = await pool.query(
    `SELECT u.id, u.org_id
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     WHERE ur.role_name = 'org_admin'
       AND ur.scope_type = 'global'
       AND u.org_id = $1
     ORDER BY u.id ASC
     LIMIT 1`,
    [platformOrgId],
  );
  if (fallback.rows.length) {
    return { orgId: fallback.rows[0].org_id, userId: fallback.rows[0].id };
  }
  return null;
}

async function capture(payload) {
  try {
    const row = normalizePayload(payload);

    if (row.fingerprint) {
      const { rows: ignored } = await pool.query(
        `SELECT id FROM user_suggestions
         WHERE org_id = $1 AND user_id = $2 AND fingerprint = $3 AND status = 'ignore'
         LIMIT 1`,
        [row.orgId, row.userId, row.fingerprint],
      );
      if (ignored.length) return { skipped: true, reason: 'ignored' };

      const { rows: existing } = await pool.query(
        `SELECT id FROM user_suggestions
         WHERE org_id = $1 AND user_id = $2 AND fingerprint = $3 AND status <> 'ignore'
         LIMIT 1`,
        [row.orgId, row.userId, row.fingerprint],
      );

      if (existing.length) {
        const { rows } = await pool.query(
          `UPDATE user_suggestions
           SET body = $1, context = COALESCE($2, context), source = COALESCE($3, source),
               updated_at = NOW()
           WHERE id = $4
           RETURNING id, category, status, title, body, context, source, fingerprint,
                     created_at, updated_at`,
          [row.body, row.context, row.source, existing[0].id],
        );
        return { updated: true, suggestion: rows[0] };
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO user_suggestions
         (org_id, user_id, category, status, title, body, context, source, fingerprint)
       VALUES ($1, $2, $3, 'new', $4, $5, $6, $7, $8)
       RETURNING id, category, status, title, body, context, source, fingerprint,
                 created_at, updated_at`,
      [row.orgId, row.userId, row.category, row.title, row.body, row.context, row.source, row.fingerprint],
    );
    return { created: true, suggestion: rows[0] };
  } catch (err) {
    console.warn('[SuggestionService] capture failed:', err.message);
    return { error: err.message };
  }
}

async function captureIf(condition, payload) {
  if (!condition) return { skipped: true, reason: 'condition_false' };
  return capture(payload);
}

async function runStartupChecks() {
  const admin = await getPrimaryAdminForOrg(1);
  if (!admin) return;

  try {
    const { rows } = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has_vector`,
    );
    if (!rows[0]?.has_vector) {
      await capture({
        orgId: admin.orgId,
        userId: admin.userId,
        source: 'startup',
        category: 'alert',
        fingerprint: makeFingerprint('startup', 'pgvector-missing'),
        title: 'pgvector extension not installed',
        body: 'Org RAG (embeddings table), personal memory, and knowledge-base MCP need pgvector on Postgres. See knowledge_base/architecture/SUGGESTIONS_INBOX.md and setup.md.',
        context: 'PostgreSQL pg_extension',
      });
    }
  } catch (err) {
    console.warn('[SuggestionService] startup pgvector check:', err.message);
  }

  try {
    const { resolveEmbeddingConfig } = require('./embeddingResolver');
    const embedding = await resolveEmbeddingConfig(admin.orgId);
    if (!embedding.available) {
      await capture({
        orgId: admin.orgId,
        userId: admin.userId,
        source: 'startup',
        category: 'alert',
        fingerprint: makeFingerprint('startup', `embedding:${embedding.modelId || 'unset'}`),
        title: 'Embeddings unavailable — RAG model not configured',
        body: embedding.issues?.join(' ') || embedding.hint || 'Set RAG embedding model in Settings > Models.',
        context: 'Settings > Models > RAG embedding model',
      });
    }
  } catch (err) {
    console.warn('[SuggestionService] startup embedding check:', err.message);
  }
}

async function reportPersonalMemoryHealth(orgId, userId, stats) {
  const ids = parseOrgUserIds(orgId, userId);
  if (!stats || stats.total === 0) return;

  try {
    const { resolveEmbeddingConfig } = require('./embeddingResolver');
    const embedding = await resolveEmbeddingConfig(orgId);
    if (!embedding.available) {
      await capture({
        ...ids,
        source: 'PersonalMemoryService',
        category: 'alert',
        fingerprint: makeFingerprint('PersonalMemoryService', `embedding:${embedding.modelId || 'unset'}`),
        title: 'Personal memory: embeddings unavailable',
        body: embedding.issues?.join(' ') || embedding.hint || 'Configure RAG embedding model in Settings > Models.',
        context: '/settings?tab=models',
      });
    }
  } catch (err) {
    console.warn('[SuggestionService] personal memory embedding check:', err.message);
  }
}

async function reportEmbeddingFailure(orgId, userId, detail = {}) {
  const target = detail.userId
    ? { orgId: parseInt(orgId, 10), userId: parseInt(detail.userId, 10) }
    : await getPrimaryAdminForOrg(orgId);
  if (!target?.userId) return;

  await capture({
    orgId: target.orgId,
    userId: target.userId,
    source: detail.source || 'EmbeddingService',
    category: 'alert',
    fingerprint: makeFingerprint(detail.source || 'EmbeddingService', detail.key || 'embed-failed'),
    title: detail.title || 'Embedding operation failed',
    body: detail.body || detail.error || 'Unknown embedding error',
    context: detail.context || null,
  });
}

module.exports = {
  capture,
  captureIf,
  makeFingerprint,
  getPrimaryAdminForOrg,
  runStartupChecks,
  reportPersonalMemoryHealth,
  reportEmbeddingFailure,
};
