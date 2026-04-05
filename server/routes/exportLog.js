/**
 * Export Log — generic reusable log for any tool that exports data.
 *
 * POST /api/export-log
 *   Body: { tool_slug, run_ids, format, field_count }
 *
 * GET /api/export-log?tool_slug=doc-extractor&limit=50
 *   Returns recent export events for the caller's org (admins see all users).
 */
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── POST /api/export-log ───────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const orgId  = req.user.org_id;
    const userId = req.user.id;

    const toolSlug  = String(req.body.tool_slug  ?? '').trim().slice(0, 100);
    const format    = String(req.body.format     ?? '').trim().slice(0, 20);
    const fieldCount = Number.isFinite(Number(req.body.field_count))
      ? Math.max(0, Math.floor(Number(req.body.field_count)))
      : null;

    // run_ids must be an array of strings (UUIDs or equivalent)
    const rawIds = req.body.run_ids;
    const runIds = Array.isArray(rawIds)
      ? rawIds.map((id) => String(id).trim()).filter(Boolean).slice(0, 500)
      : [];

    if (!toolSlug) return res.status(400).json({ error: 'tool_slug is required' });
    if (!format)   return res.status(400).json({ error: 'format is required' });

    const result = await pool.query(
      `INSERT INTO export_logs (org_id, user_id, tool_slug, run_ids, format, field_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [orgId, userId, toolSlug, runIds, format, fieldCount]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[export-log] POST error:', err.message);
    res.status(500).json({ error: 'Failed to write export log' });
  }
});

// ── GET /api/export-log ────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const orgId = req.user.org_id;
    const isAdmin = req.user.roles?.some(
      (r) => r.scope_type === 'global' && r.name === 'org_admin'
    );

    const toolSlug = req.query.tool_slug ? String(req.query.tool_slug).trim() : null;
    const limit    = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '50', 10) || 50));

    const conditions = ['el.org_id = $1'];
    const params     = [orgId];

    if (!isAdmin) {
      params.push(req.user.id);
      conditions.push(`el.user_id = $${params.length}`);
    }
    if (toolSlug) {
      params.push(toolSlug);
      conditions.push(`el.tool_slug = $${params.length}`);
    }

    params.push(limit);
    const rows = await pool.query(
      `SELECT el.id, el.tool_slug, el.run_ids, el.format, el.field_count, el.created_at,
              u.email AS user_email
         FROM export_logs el
         LEFT JOIN users u ON u.id = el.user_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY el.created_at DESC
        LIMIT $${params.length}`,
      params
    );

    res.json(rows.rows);
  } catch (err) {
    console.error('[export-log] GET error:', err.message);
    res.status(500).json({ error: 'Failed to fetch export logs' });
  }
});

module.exports = router;
