'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { pool } = require('../db');
const SuggestionService = require('../services/SuggestionService');
const {
  SUGGESTION_CATEGORIES,
  SUGGESTION_STATUSES,
  isValidCategory,
  isValidStatus,
} = require('../constants/suggestionInbox');

const router = express.Router();
router.use(requireAuth);

router.get('/meta', async (req, res) => {
  const { orgId, id: userId } = req.user;
  try {
    const { rows: statusRows } = await pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM user_suggestions WHERE org_id = $1 AND user_id = $2 GROUP BY status`,
      [orgId, userId],
    );
    const { rows: categoryRows } = await pool.query(
      `SELECT category, COUNT(*)::int AS count
       FROM user_suggestions WHERE org_id = $1 AND user_id = $2 GROUP BY category`,
      [orgId, userId],
    );
    const statusCounts = Object.fromEntries(SUGGESTION_STATUSES.map((s) => [s, 0]));
    for (const row of statusRows) statusCounts[row.status] = row.count;
    const categoryCounts = Object.fromEntries(SUGGESTION_CATEGORIES.map((c) => [c, 0]));
    for (const row of categoryRows) categoryCounts[row.category] = row.count;

    res.json({
      categories: SUGGESTION_CATEGORIES,
      statuses: SUGGESTION_STATUSES,
      statusCounts,
      categoryCounts,
      total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/count', async (req, res) => {
  const { orgId, id: userId } = req.user;
  const { status } = req.query;
  try {
    let sql = `SELECT COUNT(*)::int AS count FROM user_suggestions WHERE org_id = $1 AND user_id = $2`;
    const params = [orgId, userId];
    if (status) {
      if (!isValidStatus(status)) return res.status(400).json({ error: 'Invalid status' });
      sql += ' AND status = $3';
      params.push(status);
    }
    const { rows } = await pool.query(sql, params);
    res.json({ count: rows[0]?.count ?? 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  const { orgId, id: userId } = req.user;
  const { category, status, q } = req.query;

  let sql = `
    SELECT id, category, status, title, body, context, source, created_at, updated_at
    FROM user_suggestions WHERE org_id = $1 AND user_id = $2
  `;
  const params = [orgId, userId];
  let idx = 3;

  if (category) {
    if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
    sql += ` AND category = $${idx++}`;
    params.push(category);
  }
  if (status) {
    if (!isValidStatus(status)) return res.status(400).json({ error: 'Invalid status' });
    sql += ` AND status = $${idx++}`;
    params.push(status);
  }
  if (q) {
    const term = `%${q}%`;
    sql += ` AND (title ILIKE $${idx} OR body ILIKE $${idx + 1} OR COALESCE(context, '') ILIKE $${idx + 2})`;
    idx += 3;
    params.push(term, term, term);
  }
  sql += ' ORDER BY created_at DESC';

  try {
    const { rows } = await pool.query(sql, params);
    res.json({ suggestions: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const { orgId, id: userId } = req.user;
  try {
    const { rows } = await pool.query(
      `SELECT id, category, status, title, body, context, source, created_at, updated_at
       FROM user_suggestions WHERE id = $1 AND org_id = $2 AND user_id = $3`,
      [req.params.id, orgId, userId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { orgId, id: userId } = req.user;
  const { category = 'other', title, body = '', context = null } = req.body ?? {};

  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  const result = await SuggestionService.capture({
    orgId,
    userId,
    category,
    title,
    body,
    context,
    source: req.body?.source ?? 'manual',
  });
  if (result.error) return res.status(400).json({ error: result.error });
  if (result.skipped) return res.json({ skipped: true, reason: result.reason });
  res.status(result.created ? 201 : 200).json(result.suggestion);
});

router.patch('/:id', async (req, res) => {
  const { orgId, id: userId } = req.user;
  const { category, status, title, body, context } = req.body ?? {};

  const updates = [];
  const params = [req.params.id, orgId, userId];
  let idx = 4;

  if (category !== undefined) {
    if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
    updates.push(`category = $${idx++}`);
    params.push(category);
  }
  if (status !== undefined) {
    if (!isValidStatus(status)) return res.status(400).json({ error: 'Invalid status' });
    updates.push(`status = $${idx++}`);
    params.push(status);
  }
  if (title !== undefined) {
    if (!String(title).trim()) return res.status(400).json({ error: 'title cannot be empty' });
    updates.push(`title = $${idx++}`);
    params.push(String(title).trim());
  }
  if (body !== undefined) {
    updates.push(`body = $${idx++}`);
    params.push(String(body));
  }
  if (context !== undefined) {
    updates.push(`context = $${idx++}`);
    params.push(context ? String(context) : null);
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

  updates.push('updated_at = NOW()');

  try {
    const { rows } = await pool.query(
      `UPDATE user_suggestions SET ${updates.join(', ')}
       WHERE id = $1 AND org_id = $2 AND user_id = $3
       RETURNING id, category, status, title, body, context, source, created_at, updated_at`,
      params,
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const { orgId, id: userId } = req.user;
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM user_suggestions WHERE id = $1 AND org_id = $2 AND user_id = $3',
      [req.params.id, orgId, userId],
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
