/**
 * Demo routes — manifest API for external client orgs.
 *
 * Public (authenticated) endpoints:
 *   GET  /api/demo/manifest        — this org's assigned agents, merged with catalog metadata
 *
 * Admin-only endpoints (org_admin of any org, including demo orgs):
 *   GET  /api/demo/admin/catalog           — full DEMO_CATALOG list
 *   GET  /api/demo/admin/manifest          — all manifest rows for this org (including disabled)
 *   PUT  /api/demo/admin/manifest/:slug    — upsert a manifest row
 *   DELETE /api/demo/admin/manifest/:slug  — remove from manifest
 *
 * All routes require auth. org_id always sourced from req.user.orgId (session context).
 */
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const { DEMO_CATALOG } = require('../demo/demoCatalog');

const router = express.Router();
router.use(requireAuth);

// ── GET /api/demo/manifest ────────────────────────────────────────────────────
// Returns this org's enabled manifest rows joined with catalog metadata.
// Ordered by sort_order ASC. is_configured signals whether the agent is ready to run.
router.get('/manifest', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT slug, enabled, label, description, sort_order, is_configured
         FROM org_agent_manifest
        WHERE org_id = $1
        ORDER BY sort_order ASC, slug ASC`,
      [req.user.orgId]
    );

    const manifest = rows
      .filter((r) => r.enabled)
      .map((r) => {
        const catalog = DEMO_CATALOG[r.slug] ?? {};
        return {
          slug:          r.slug,
          name:          r.label       ?? catalog.name        ?? r.slug,
          description:   r.description ?? catalog.description ?? '',
          icon:          catalog.icon     ?? 'box',
          category:      catalog.category ?? 'general',
          pattern:       catalog.pattern  ?? 'unknown',
          sort_order:    r.sort_order,
          is_configured: r.is_configured,
        };
      });

    res.json(manifest);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load manifest.' });
  }
});

// ── Admin manifest management ─────────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(requireRole(['org_admin']));

// GET /api/demo/admin/catalog — available agents from DEMO_CATALOG
adminRouter.get('/catalog', (req, res) => {
  const catalog = Object.entries(DEMO_CATALOG).map(([slug, meta]) => ({ slug, ...meta }));
  res.json(catalog);
});

// GET /api/demo/admin/manifest — all rows for this org (including disabled)
adminRouter.get('/manifest', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT slug, enabled, label, description, sort_order, is_configured, assigned_at
         FROM org_agent_manifest
        WHERE org_id = $1
        ORDER BY sort_order ASC, slug ASC`,
      [req.user.orgId]
    );

    // Merge with catalog metadata so the admin UI has full context
    const merged = rows.map((r) => {
      const catalog = DEMO_CATALOG[r.slug] ?? {};
      return {
        ...r,
        catalog_name:        catalog.name        ?? r.slug,
        catalog_description: catalog.description ?? '',
        catalog_icon:        catalog.icon        ?? 'box',
        catalog_category:    catalog.category    ?? 'general',
      };
    });

    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load manifest.' });
  }
});

// PUT /api/demo/admin/manifest/:slug — upsert a manifest row
adminRouter.put('/manifest/:slug', async (req, res) => {
  const { slug } = req.params;
  const {
    enabled      = true,
    label        = null,
    description  = null,
    sort_order   = 0,
    is_configured = false,
  } = req.body;

  try {
    await pool.query(
      `INSERT INTO org_agent_manifest
         (org_id, slug, enabled, label, description, sort_order, is_configured, assigned_at, assigned_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
       ON CONFLICT (org_id, slug) DO UPDATE SET
         enabled       = EXCLUDED.enabled,
         label         = EXCLUDED.label,
         description   = EXCLUDED.description,
         sort_order    = EXCLUDED.sort_order,
         is_configured = EXCLUDED.is_configured`,
      [req.user.orgId, slug, enabled, label, description, sort_order, is_configured, req.user.id]
    );
    res.json({ ok: true, slug });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update manifest.' });
  }
});

// DELETE /api/demo/admin/manifest/:slug — remove from manifest
adminRouter.delete('/manifest/:slug', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM org_agent_manifest WHERE org_id = $1 AND slug = $2`,
      [req.user.orgId, req.params.slug]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove from manifest.' });
  }
});

router.use('/admin', adminRouter);

module.exports = router;
