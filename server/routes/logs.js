/**
 * logs.js — Unified API for the two-container logging architecture.
 *
 * Container 1 — Transaction Log (transaction_logs):
 *   GET  /api/logs/transactions          — list transactions, filterable
 *   GET  /api/logs/transactions/export    — export as JSON
 *   GET  /api/logs/transactions/:id      — single transaction with linked events
 *
 * Container 2 — Agent Event Log (agent_event_logs):
 *   GET  /api/logs/events                — list events, filterable by agent_slug + event_type
 *   GET  /api/logs/events/export          — export as JSON
 *   GET  /api/logs/events/:id            — single event
 *
 * Agent Field Declarations:
 *   GET  /api/logs/agent-fields          — all agent field declarations
 *   GET  /api/logs/agent-fields/:slug    — fields for a specific agent
 *
 * All routes require auth. org_id always sourced from req.user.orgId.
 */
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { getAgentFields, getAllAgentFields } = require('../platform/TransactionLogger');

const router = express.Router();
router.use(requireAuth);

// ── Container 1: Transaction Log ─────────────────────────────────────────────

// GET /api/logs/transactions
// Query params: agent_slug, status, action, limit (default 50), offset
router.get('/transactions', async (req, res) => {
  try {
    const { agent_slug, status, action, session_id, limit = 50, offset = 0 } = req.query;
    const params = [req.user.orgId];
    const conditions = ['org_id = $1'];
    let idx = 2;

    if (agent_slug) {
      conditions.push(`agent_slug = $${idx++}`);
      params.push(agent_slug);
    }
    if (status) {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }
    if (action) {
      conditions.push(`action ILIKE $${idx++}`);
      params.push(`%${action}%`);
    }
    if (session_id) {
      conditions.push(`session_id = $${idx++}`);
      params.push(session_id);
    }

    const cappedLimit = Math.min(parseInt(limit, 10) || 50, 200);
    const safeOffset  = Math.max(parseInt(offset, 10) || 0, 0);

    const { rows } = await pool.query(
      `SELECT id, session_id, agent_slug, action, document_ref, outcome, status, metadata, created_at
         FROM transaction_logs
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, cappedLimit, safeOffset]
    );

    // Get total count for pagination
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM transaction_logs WHERE ${conditions.join(' AND ')}`,
      params
    );

    res.json({
      transactions: rows,
      total: parseInt(countResult.rows[0].count, 10),
      limit: cappedLimit,
      offset: safeOffset,
    });
  } catch (err) {
    console.error('[logs/transactions]', err.message);
    res.status(500).json({ error: 'Failed to load transactions.' });
  }
});

// GET /api/logs/transactions/export
router.get('/transactions/export', async (req, res) => {
  try {
    const { agent_slug, status } = req.query;
    const params = [req.user.orgId];
    const conditions = ['org_id = $1'];
    let idx = 2;

    if (agent_slug) {
      conditions.push(`agent_slug = $${idx++}`);
      params.push(agent_slug);
    }
    if (status) {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }

    const { rows } = await pool.query(
      `SELECT id, session_id, agent_slug, action, document_ref, outcome, status, metadata, created_at
         FROM transaction_logs
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC`,
      params
    );

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="transaction-log.json"');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export transactions.' });
  }
});

// GET /api/logs/transactions/:id — single transaction with linked events
router.get('/transactions/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, session_id, agent_slug, action, document_ref, outcome, status, metadata, created_at
         FROM transaction_logs
        WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.user.orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Transaction not found.' });

    const tx = rows[0];

    // Fetch linked events from Container 2
    const { rows: events } = await pool.query(
      `SELECT id, event_type, event_label, event_detail, event_timestamp, fields
         FROM agent_event_logs
        WHERE session_id = $1 AND org_id = $2
        ORDER BY event_timestamp ASC`,
      [tx.session_id, req.user.orgId]
    );

    res.json({ ...tx, events });
  } catch (err) {
    console.error('[logs/transactions/:id]', err.message);
    res.status(500).json({ error: 'Failed to load transaction.' });
  }
});

// ── Container 2: Agent Event Log ─────────────────────────────────────────────

// GET /api/logs/events
// Query params: agent_slug, event_type, limit (default 50), offset
router.get('/events', async (req, res) => {
  try {
    const { agent_slug, event_type, session_id, limit = 50, offset = 0 } = req.query;
    const params = [req.user.orgId];
    const conditions = ['org_id = $1'];
    let idx = 2;

    if (agent_slug) {
      conditions.push(`agent_slug = $${idx++}`);
      params.push(agent_slug);
    }
    if (event_type) {
      conditions.push(`event_type = $${idx++}`);
      params.push(event_type);
    }
    if (session_id) {
      conditions.push(`session_id = $${idx++}`);
      params.push(session_id);
    }

    const cappedLimit = Math.min(parseInt(limit, 10) || 50, 200);
    const safeOffset  = Math.max(parseInt(offset, 10) || 0, 0);

    const { rows } = await pool.query(
      `SELECT id, session_id, agent_slug, event_type, event_label, event_detail, event_timestamp, fields
         FROM agent_event_logs
        WHERE ${conditions.join(' AND ')}
        ORDER BY event_timestamp DESC
        LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, cappedLimit, safeOffset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM agent_event_logs WHERE ${conditions.join(' AND ')}`,
      params
    );

    res.json({
      events: rows,
      total: parseInt(countResult.rows[0].count, 10),
      limit: cappedLimit,
      offset: safeOffset,
    });
  } catch (err) {
    console.error('[logs/events]', err.message);
    res.status(500).json({ error: 'Failed to load events.' });
  }
});

// GET /api/logs/events/export
router.get('/events/export', async (req, res) => {
  try {
    const { agent_slug, event_type } = req.query;
    const params = [req.user.orgId];
    const conditions = ['org_id = $1'];
    let idx = 2;

    if (agent_slug) {
      conditions.push(`agent_slug = $${idx++}`);
      params.push(agent_slug);
    }
    if (event_type) {
      conditions.push(`event_type = $${idx++}`);
      params.push(event_type);
    }

    const { rows } = await pool.query(
      `SELECT id, session_id, agent_slug, event_type, event_label, event_detail, event_timestamp, fields
         FROM agent_event_logs
        WHERE ${conditions.join(' AND ')}
        ORDER BY event_timestamp DESC`,
      params
    );

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="agent-event-log.json"');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export events.' });
  }
});

// GET /api/logs/events/:id — single event
router.get('/events/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, session_id, agent_slug, event_type, event_label, event_detail, event_timestamp, fields
         FROM agent_event_logs
        WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.user.orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Event not found.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load event.' });
  }
});

// ── Agent Field Declarations ─────────────────────────────────────────────────

// GET /api/logs/agent-fields — all agents' field declarations
router.get('/agent-fields', async (req, res) => {
  try {
    const fields = await getAllAgentFields();
    res.json(fields);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load agent fields.' });
  }
});

// GET /api/logs/agent-fields/:slug — fields for a specific agent
router.get('/agent-fields/:slug', async (req, res) => {
  try {
    const fields = await getAgentFields(req.params.slug);
    res.json(fields);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load agent fields.' });
  }
});

module.exports = router;
