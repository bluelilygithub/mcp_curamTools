'use strict';

/**
 * docExtractor routes — platform-native document extraction tool.
 *
 * Platform integration:
 *   - Model resolved via getRecommendedModel() when admin hasn't set one explicitly
 *   - Daily org budget checked via CostGuardService before processing any file
 *   - Per-file task budget checked after each extraction
 *   - Rate limiter is user-ID keyed (falls back to IP) — not IP-only
 *   - Field inputs are length-capped at the boundary before reaching the agent
 *   - GET /runs returns field_count (not full JSONB result) for list efficiency
 *   - GET /runs/:runId returns full result for the view panel
 *
 * POST /api/doc-extractor/extract
 *   Accepts one or more files. Allowed MIME types and max file size are read
 *   from admin config at request time. Rate-limited: 5 per user per 5 minutes.
 *
 * GET /api/doc-extractor/runs
 *   Paginated run history. Search (?q) matches label OR filename via pg_trgm GIN index.
 *
 * GET /api/doc-extractor/runs/:runId
 *   Full result for a single run — used by the View panel.
 */

const express = require('express');
const multer  = require('multer');
const { requireAuth }         = require('../middleware/requireAuth');
const { createRateLimiter }   = require('../middleware/rateLimiter');
const { pool }                = require('../db');
const { runDocExtraction }    = require('../agents/docExtractor');
const { canUseModel, isOrgAdmin } = require('../services/PermissionService');
const { logUsage }            = require('../services/UsageLogger');
const { computeCostAud, getDailyOrgSpendAud, check: checkBudget, BudgetExceededError } = require('../services/CostGuardService');
const { requireRole }         = require('../middleware/requireRole');
const AgentConfigService      = require('../platform/AgentConfigService');

const router = express.Router();

// User-ID-keyed rate limiter — consistent with all other agent run endpoints.
// createRateLimiter already prefers req.user.id over IP when requireAuth has run.
const extractRateLimiter = createRateLimiter({ windowMs: 5 * 60_000, max: 5 });

// Multer hard ceiling — actual per-request limit comes from adminConfig.
// Prevents loading enormous files into memory before the config check fires.
const HARD_MAX_BYTES = 50 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: HARD_MAX_BYTES },
});

// Input field length caps — enforced at the boundary before any DB write or LLM call.
const MAX_LABEL_LEN        = 200;
const MAX_PURPOSE_LEN      = 100;
const MAX_INSTRUCTIONS_LEN = 2000;

// ── POST /extract ──────────────────────────────────────────────────────────────

router.post(
  '/extract',
  requireAuth,
  extractRateLimiter,
  upload.array('file', 20),
  async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const { orgId, id: userId } = req.user;

    // ── Admin config ───────────────────────────────────────────────────────
    const adminConfig = await AgentConfigService.getAdminConfig('doc-extractor');

    if (!adminConfig.enabled) {
      return res.status(403).json({ error: 'Document Extractor is currently disabled by an administrator.' });
    }

    const allowedMimes = new Set(
      adminConfig.allowed_mime_types ?? ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
    );
    const maxBytes = adminConfig.max_file_bytes ?? (20 * 1024 * 1024);

    // ── File count check ───────────────────────────────────────────────────
    const maxFilesPerBatch = adminConfig.max_files_per_batch ?? 20;
    if (req.files.length > maxFilesPerBatch) {
      return res.status(400).json({
        error: `Too many files. This organisation allows up to ${maxFilesPerBatch} file${maxFilesPerBatch === 1 ? '' : 's'} per upload.`,
      });
    }

    // ── Validate all files before processing any ───────────────────────────
    for (const f of req.files) {
      if (!allowedMimes.has(f.mimetype)) {
        return res.status(400).json({
          error: `File "${f.originalname}": type "${f.mimetype}" is not allowed. Permitted: ${[...allowedMimes].join(', ')}.`,
        });
      }
      if (f.size > maxBytes) {
        return res.status(400).json({
          error: `File "${f.originalname}" is ${(f.size / 1024 / 1024).toFixed(1)} MB — exceeds the ${(maxBytes / 1024 / 1024).toFixed(0)} MB limit.`,
        });
      }
    }

    // ── Model resolution ───────────────────────────────────────────────────
    // If admin hasn't set a model, resolve the best available from the live catalogue
    // via getRecommendedModel rather than falling back to a hardcoded string.
    let model = adminConfig.model || null;
    if (!model) {
      const modelsRow = await pool.query(
        `SELECT value FROM system_settings WHERE key = 'ai_models' LIMIT 1`
      );
      const allModels = modelsRow.rows[0]?.value ?? [];
      const rec = AgentConfigService.getRecommendedModel('doc-extractor', allModels);
      model = rec?.id ?? 'claude-sonnet-4-6'; // absolute last resort
    }

    // Allow a user-supplied model override if they have permission
    if (req.body.model) {
      const requested = req.body.model.trim();
      const allowed   = await canUseModel(userId, 'doc-extractor', requested);
      if (!allowed) {
        return res.status(403).json({ error: `Model "${requested}" is not permitted for this tool.` });
      }
      model = requested;
    }

    // ── Budget check — load today's org spend once before the batch ────────
    const dailyOrgSpendAud = await getDailyOrgSpendAud(orgId);

    // ── Sanitise and cap input fields at the platform boundary ────────────
    const batchLabel   = (req.body.label        || '').trim().slice(0, MAX_LABEL_LEN)        || null;
    const purpose      = (req.body.purpose       || '').trim().slice(0, MAX_PURPOSE_LEN)      || null;
    const instructions = (req.body.instructions  || '').trim().slice(0, MAX_INSTRUCTIONS_LEN) || null;

    // ── Process each file ─────────────────────────────────────────────────
    const results = [];
    let batchCostAud = 0;

    for (let fi = 0; fi < req.files.length; fi++) {
      const { originalname, mimetype, buffer } = req.files[fi];

      // Label: single file → label as-is; multi-file → label, label-1, label-2, …
      const label = batchLabel
        ? (req.files.length === 1 ? batchLabel : fi === 0 ? batchLabel : `${batchLabel}-${fi}`)
        : null;

      // Insert pending run — row exists even if extraction crashes
      let runId;
      try {
        const { rows } = await pool.query(
          `INSERT INTO doc_extraction_runs
             (org_id, user_id, filename, mime_type, model, status, label, purpose, instructions)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)
           RETURNING id`,
          [orgId, userId, originalname, mimetype, model, label, purpose, instructions]
        );
        runId = rows[0].id;
      } catch (err) {
        console.error('[doc-extractor] Failed to create run record:', err.message);
        results.push({ filename: originalname, error: 'Failed to initialise extraction run.' });
        continue;
      }

      try {
        const result = await runDocExtraction({
          imageBuffer:  buffer,
          mimeType:     mimetype,
          model,
          maxTokens:    adminConfig.max_tokens,
          instructions,
          maxPdfPages:  adminConfig.max_pdf_pages ?? 10,
          pdfDpi:       adminConfig.pdf_dpi       ?? 150,
        });

        const costAud = computeCostAud({
          input:      result.tokensUsed?.input_tokens                ?? 0,
          output:     result.tokensUsed?.output_tokens               ?? 0,
          cacheRead:  result.tokensUsed?.cache_read_input_tokens     ?? 0,
          cacheWrite: result.tokensUsed?.cache_creation_input_tokens ?? 0,
        });
        batchCostAud += costAud;

        // Check per-file task budget and daily org budget
        checkBudget({
          taskCostAud:      costAud,
          maxTaskBudgetAud: adminConfig.max_task_budget_aud ?? null,
          dailyOrgSpendAud,
          maxDailyBudgetAud: null, // reads from org budget settings if needed
        });

        await pool.query(
          `UPDATE doc_extraction_runs
              SET status = 'completed', result = $1, completed_at = NOW()
            WHERE id = $2`,
          [JSON.stringify(result), runId]
        );

        logUsage({
          orgId, userId, slug: 'doc-extractor', modelId: model,
          tokensUsed: {
            input:  result.tokensUsed?.input_tokens  ?? 0,
            output: result.tokensUsed?.output_tokens ?? 0,
          },
          costAud,
        }).catch((err) => console.error('[doc-extractor] logUsage failed:', err.message));

        results.push({ runId, filename: originalname, label, result });

      } catch (err) {
        const isBudget = err instanceof BudgetExceededError;
        console.error(`[doc-extractor] ${isBudget ? 'Budget exceeded' : 'Extraction failed'}:`, err.message);

        await pool.query(
          `UPDATE doc_extraction_runs
              SET status = 'failed', error = $1, completed_at = NOW()
            WHERE id = $2`,
          [err.message, runId]
        );

        results.push({ runId, filename: originalname, label, error: err.message });

        // Budget exceeded — stop the batch immediately rather than spending more
        if (isBudget) break;
      }
    }

    // Single-file: original response shape for backwards compatibility
    if (results.length === 1) {
      const r = results[0];
      if (r.error && !r.runId) return res.status(500).json({ error: r.error });
      if (r.error)             return res.status(500).json({ runId: r.runId, error: r.error });
      return res.json({ runId: r.runId, result: r.result });
    }

    return res.json({ batch: results });
  }
);

// ── GET /runs — paginated, searchable list (no full JSONB result) ──────────────
// Returns field_count instead of full result JSONB — callers use GET /runs/:runId
// to fetch the full payload for the view panel. Keeps list payloads small.

router.get('/runs', requireAuth, async (req, res) => {
  try {
    const { orgId, id: userId } = req.user;
    const admin = await isOrgAdmin(userId);

    const page           = Math.max(1, parseInt(req.query.page)  || 1);
    const limit          = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset         = (page - 1) * limit;
    const search         = (req.query.q || '').trim();
    const includeDeleted = admin && req.query.include_deleted === 'true';

    const params     = [orgId];
    const conditions = [];

    if (!admin) {
      params.push(userId);
      conditions.push(`user_id = $${params.length}`);
    }

    if (!includeDeleted) {
      conditions.push('deleted_at IS NULL');
    }

    if (search) {
      params.push(`%${search}%`);
      // Both columns are covered by the GIN trgm index on (COALESCE(label,'') || ' ' || filename)
      conditions.push(`(label ILIKE $${params.length} OR filename ILIKE $${params.length})`);
    }

    const where = conditions.length ? 'AND ' + conditions.join(' AND ') : '';

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM doc_extraction_runs WHERE org_id = $1 ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT id, filename, label, purpose, mime_type, model,
              CASE
                WHEN status = 'pending' AND created_at < NOW() - INTERVAL '5 minutes'
                THEN 'stale'
                ELSE status
              END AS status,
              -- field_count only — full result fetched separately via GET /runs/:runId
              COALESCE(jsonb_array_length(result->'fields'), 0) AS field_count,
              error, created_at, completed_at, deleted_at, user_id
         FROM doc_extraction_runs
        WHERE org_id = $1 ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ rows, total, page, limit, isAdmin: admin });
  } catch (err) {
    console.error('[doc-extractor] Failed to fetch runs:', err.message);
    res.status(500).json({ error: 'Failed to fetch extraction history.' });
  }
});

// ── GET /runs/:runId — full result for the view panel ─────────────────────────
// Separate from the list endpoint so the list stays lean.
// Non-admins may only fetch their own runs.

router.get('/runs/:runId', requireAuth, async (req, res) => {
  try {
    const { orgId, id: userId } = req.user;
    const admin = await isOrgAdmin(userId);

    const ownerClause = admin ? '' : 'AND user_id = $3';
    const params = admin
      ? [req.params.runId, orgId]
      : [req.params.runId, orgId, userId];

    const { rows } = await pool.query(
      `SELECT id, filename, label, purpose, instructions, mime_type, model,
              CASE
                WHEN status = 'pending' AND created_at < NOW() - INTERVAL '5 minutes'
                THEN 'stale'
                ELSE status
              END AS status,
              result, error, created_at, completed_at, deleted_at
         FROM doc_extraction_runs
        WHERE id = $1 AND org_id = $2 ${ownerClause}`,
      params
    );

    if (!rows[0]) return res.status(404).json({ error: 'Run not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[doc-extractor] Failed to fetch run:', err.message);
    res.status(500).json({ error: 'Failed to fetch run.' });
  }
});

// ── DELETE /runs/:runId — soft delete ─────────────────────────────────────────

router.delete('/runs/:runId', requireAuth, async (req, res) => {
  try {
    const { orgId, id: userId } = req.user;
    const admin = await isOrgAdmin(userId);

    const ownershipClause = admin ? '' : 'AND user_id = $3';
    const params = admin
      ? [req.params.runId, orgId]
      : [req.params.runId, orgId, userId];

    const { rowCount } = await pool.query(
      `UPDATE doc_extraction_runs
          SET deleted_at = NOW()
        WHERE id = $1 AND org_id = $2 ${ownershipClause}
          AND deleted_at IS NULL`,
      params
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Run not found or already deleted.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[doc-extractor] Failed to delete run:', err.message);
    res.status(500).json({ error: 'Failed to delete run.' });
  }
});

// ── POST /runs/:runId/restore — admin only ────────────────────────────────────

router.post('/runs/:runId/restore', requireAuth, requireRole(['org_admin']), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE doc_extraction_runs
          SET deleted_at = NULL
        WHERE id = $1 AND org_id = $2`,
      [req.params.runId, req.user.orgId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Run not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[doc-extractor] Failed to restore run:', err.message);
    res.status(500).json({ error: 'Failed to restore run.' });
  }
});

module.exports = router;
