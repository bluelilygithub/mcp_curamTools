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

// ── Demo run endpoints ────────────────────────────────────────────────────
// These endpoints serve the document analyzer HITL review flow.
// All scoped to req.user.orgId — no cross-org access possible.
//
// GET  /api/demo/runs                          — list recent runs for this org
// GET  /api/demo/runs/:runId                   — full run result (current review state)
// PATCH /api/demo/runs/:runId/review/:findingId — update a single finding's review state

// GET /api/demo/runs?slug=demo-document-analyzer&limit=10
router.get('/runs', async (req, res) => {
  try {
    const slug  = req.query.slug  ?? 'demo-document-analyzer';
    const limit = Math.min(parseInt(req.query.limit ?? '10', 10), 50);

    const { rows } = await pool.query(
      `SELECT id, slug, status, error, run_at, completed_at,
              result->'summary'                          AS summary,
              result->'data'->'document_type'            AS document_type,
              result->'data'->'file_name'                AS file_name,
              result->'data'->'pending_review_count'     AS pending_review_count
         FROM agent_runs
        WHERE org_id = $1 AND slug = $2
        ORDER BY run_at DESC
        LIMIT $3`,
      [req.user.orgId, slug, limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load runs.' });
  }
});

// GET /api/demo/runs/:runId — full result including current finding review states
router.get('/runs/:runId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, slug, status, error, run_at, completed_at, result
         FROM agent_runs
        WHERE id = $1 AND org_id = $2`,
      [req.params.runId, req.user.orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Run not found.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load run.' });
  }
});

// PATCH /api/demo/runs/:runId/review/:findingId
// Body: { status, comment }
// status must be one of: approved | rejected | resubmit
// Low-confidence findings (confidence < 0.7) and cross-stage conflicts require a comment.
router.patch('/runs/:runId/review/:findingId', async (req, res) => {
  const VALID_STATUSES = new Set(['approved', 'rejected', 'resubmit']);
  const { runId, findingId } = req.params;
  const { status, comment }  = req.body ?? {};

  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: `Invalid status. Must be: ${[...VALID_STATUSES].join(' | ')}` });
  }

  try {
    // Load the run — scoped to org_id, prevents cross-org writes
    const { rows } = await pool.query(
      `SELECT id, result FROM agent_runs WHERE id = $1 AND org_id = $2`,
      [runId, req.user.orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Run not found.' });

    const result = rows[0].result ?? {};
    const data   = result.data    ?? {};

    // Find the finding in all_findings and update it in place
    let found = false;
    const allFindings = (data.all_findings ?? []).map((f) => {
      if (f.finding_id !== findingId) return f;

      // Enforce comment requirement for low-confidence or cross-stage conflict findings
      const isLowConfidence = typeof f.confidence === 'number' && f.confidence < 0.7;
      const isCrossStage    = f.also_flagged_deterministic || f.also_flagged_probabilistic;
      if ((isLowConfidence || isCrossStage) && status === 'approved' && !comment?.trim()) {
        return { ...f, _validation_error: 'Comment required before approving this finding.' };
      }

      found = true;
      return {
        ...f,
        status,
        comment:     comment?.trim() ?? null,
        reviewed_by: req.user.email ?? req.user.id,
        reviewed_at: new Date().toISOString(),
        _validation_error: undefined,
      };
    });

    // Surface validation errors before writing
    const validationErr = allFindings.find((f) => f._validation_error);
    if (validationErr) {
      return res.status(422).json({ error: validationErr._validation_error });
    }
    if (!found) return res.status(404).json({ error: 'Finding not found in run.' });

    // Sync the same finding into the stage-specific arrays
    const syncFinding = (arr) => (arr ?? []).map((f) => {
      const updated = allFindings.find((u) => u.finding_id === f.finding_id);
      return updated ?? f;
    });

    const pending_review_count = allFindings.filter((f) => f.status === 'pending_review').length;

    // Add review action to the trace
    const trace = data.trace ?? [];
    trace.push({
      step:        'review_action',
      timestamp:   new Date().toISOString(),
      finding_id:  findingId,
      finding_label: allFindings.find((f) => f.finding_id === findingId)?.label ?? findingId,
      decision:    status,
      reviewed_by: req.user.email ?? req.user.id,
      comment:     comment?.trim() ?? null,
    });

    const updatedData = {
      ...data,
      all_findings:           allFindings,
      deterministic_findings: syncFinding(data.deterministic_findings),
      probabilistic_findings: syncFinding(data.probabilistic_findings),
      pending_review_count,
      trace,
    };

    await pool.query(
      `UPDATE agent_runs
          SET result = jsonb_set(result, '{data}', $1::jsonb)
        WHERE id = $2 AND org_id = $3`,
      [JSON.stringify(updatedData), runId, req.user.orgId]
    );

    res.json({
      ok:                   true,
      finding_id:           findingId,
      status,
      pending_review_count,
    });
  } catch (err) {
    console.error('[demo/review PATCH]', err.message);
    res.status(500).json({ error: 'Failed to update review.' });
  }
});

module.exports = router;
