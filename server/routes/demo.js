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
const StorageService = require('../services/StorageService');

const router = express.Router();
router.use(requireAuth);

// ── GET /api/demo/manifest ────────────────────────────────────────────────────
// Returns agents for this org. Catalog entries are shown by default; org_agent_manifest
// rows override labels/descriptions and can explicitly disable an agent (enabled=false).
// Ordered by sort_order ASC then slug ASC.
router.get('/manifest', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT slug, enabled, label, description, sort_order, is_configured
         FROM org_agent_manifest
        WHERE org_id = $1
        ORDER BY sort_order ASC, slug ASC`,
      [req.user.orgId]
    );

    // Build a map of DB overrides keyed by slug
    const dbMap = {};
    for (const r of rows) dbMap[r.slug] = r;

    // Union catalog (default enabled) with DB overrides
    const manifest = Object.entries(DEMO_CATALOG)
      .map(([slug, catalog], idx) => {
        const r = dbMap[slug];
        if (r && !r.enabled) return null; // explicitly disabled by admin
        return {
          slug,
          name:          r?.label       ?? catalog.name        ?? slug,
          description:   r?.description ?? catalog.description ?? '',
          icon:          catalog.icon     ?? 'box',
          category:      catalog.category ?? 'general',
          pattern:       catalog.pattern  ?? 'unknown',
          sort_order:    r?.sort_order   ?? idx,
          is_configured: r?.is_configured ?? true,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.sort_order - b.sort_order || a.slug.localeCompare(b.slug));

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

// ── DELETE /api/demo/runs — empty all runs for this org ───────────────────
router.delete('/runs', async (req, res) => {
  try {
    await pool.query('DELETE FROM agent_runs WHERE org_id = $1', [req.user.orgId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to empty runs.' });
  }
});

// ── GET /api/demo/runs/export — export all runs as JSON ───────────────────
router.get('/runs/export', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, slug, status, error, run_at, completed_at, result
         FROM agent_runs
        WHERE org_id = $1
        ORDER BY run_at DESC`,
      [req.user.orgId]
    );
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="demo-runs.json"');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export runs.' });
  }
});

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
    const limit = Math.min(parseInt(req.query.limit ?? '10', 10), 50);
    // Accept comma-separated slugs or omit to see all demo runs
    const slugs = req.query.slug
      ? req.query.slug.split(',').map((s) => s.trim()).filter(Boolean)
      : null;

    const SELECT = `SELECT id, slug, status, error, run_at, completed_at,
              result->'summary'                          AS summary,
              result->'data'->'document_type'            AS document_type,
              result->'data'->'file_name'                AS file_name,
              result->'data'->'pending_review_count'     AS pending_review_count,
              result->'data'->'s3'                       AS s3,
              result->'tokensUsed'                       AS tokens_used,
              result->'costAud'                          AS cost_aud
         FROM agent_runs`;

    let rows;
    if (slugs) {
      const placeholders = slugs.map((_, i) => `$${i + 2}`).join(', ');
      ({ rows } = await pool.query(
        `${SELECT} WHERE org_id = $1 AND slug IN (${placeholders}) ORDER BY run_at DESC LIMIT $${slugs.length + 2}`,
        [req.user.orgId, ...slugs, limit]
      ));
    } else {
      ({ rows } = await pool.query(
        `${SELECT} WHERE org_id = $1 ORDER BY run_at DESC LIMIT $2`,
        [req.user.orgId, limit]
      ));
    }
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

      // Rejected findings are permanently blocked — no transition out of rejected
      if (f.status === 'rejected') {
        return { ...f, _validation_error: 'Rejected findings cannot be re-approved. Submit a corrected document for a new run.' };
      }

      // Cross-stage overlap: comment required before approving (only approval exception)
      const isCrossStage = f.also_flagged_deterministic || f.also_flagged_probabilistic;
      if (status === 'approved' && isCrossStage && !comment?.trim()) {
        return { ...f, _validation_error: 'Comment required before approving this finding.' };
      }
      // Reject and resubmit always require a comment
      if (status === 'rejected' && !comment?.trim()) {
        return { ...f, _validation_error: 'A comment is required when rejecting a finding. Explain why the finding cannot be accepted so the design engineer knows what must be corrected.' };
      }
      if (status === 'resubmit' && !comment?.trim()) {
        return { ...f, _validation_error: 'A comment is required when requesting resubmission. Describe what the engineer must correct before resubmitting.' };
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

// ── POST /api/demo/runs/:runId/save-to-s3 ─────────────────────────────────
// Saves the uploaded file from a document analyzer run to S3.
// The file is stored under: {orgName}/{fileName}
// If the folder (prefix) doesn't exist, S3 creates it implicitly via the key.
// Returns a pre-signed download URL.
router.post('/runs/:runId/save-to-s3', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, result FROM agent_runs WHERE id = $1 AND org_id = $2`,
      [req.params.runId, req.user.orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Run not found.' });

    const result = rows[0].result ?? {};
    const data   = result.data    ?? {};

    const fileData  = data.file_data;
    const fileName  = data.file_name;
    const mimeType  = data.mime_type ?? 'application/octet-stream';
    const orgName   = req.user.orgName ?? 'Default Organisation';

    if (!fileData || !fileName) {
      return res.status(400).json({ error: 'No file data available for this run.' });
    }

    const bucket = process.env.AWS_S3_BUCKET;
    const region = process.env.AWS_S3_REGION ?? 'ap-southeast-2';

    if (!bucket) {
      return res.status(500).json({ error: 'AWS S3 bucket not configured.' });
    }

    // S3 key: {orgName}/{fileName}
    // S3 doesn't have real folders — the prefix acts as a folder implicitly.
    const key = `${orgName}/${fileName}`;

    const fileBuf = Buffer.from(fileData, 'base64');

    await StorageService.put({ bucket, region, key, body: fileBuf, contentType: mimeType });

    // Generate a pre-signed download URL (expires in 7 days)
    const { url, expiresAt } = await StorageService.getSignedDownloadUrl({
      bucket, region, key, expiresIn: 7 * 24 * 3600,
    });

    res.json({ ok: true, storageKey: key, url, expiresAt });
  } catch (err) {
    console.error('[demo/save-to-s3]', err.message);
    res.status(500).json({ error: `Failed to save to S3: ${err.message}` });
  }
});

// ── GET /api/demo/runs/:runId/download ────────────────────────────────────
// Serves the original uploaded file directly from the database (base64).
// Works without S3 — the file data is stored in result.data.file_data.
// Falls back to S3 pre-signed URL if available and DB data is missing.
router.get('/runs/:runId/download', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, result FROM agent_runs WHERE id = $1 AND org_id = $2`,
      [req.params.runId, req.user.orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Run not found.' });

    const result = rows[0].result ?? {};
    const data   = result.data    ?? {};

    // Try DB base64 first
    if (data.file_data && data.file_name) {
      const fileBuf  = Buffer.from(data.file_data, 'base64');
      const mimeType = data.mime_type ?? 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${data.file_name}"`);
      res.setHeader('Content-Length', fileBuf.length);
      return res.send(fileBuf);
    }

    // Fallback: redirect to S3 pre-signed URL if available
    if (data.s3?.url) {
      return res.redirect(data.s3.url);
    }

    return res.status(404).json({ error: 'No file data available for this run.' });
  } catch (err) {
    res.status(500).json({ error: `Failed to download file: ${err.message}` });
  }
});

// ── POST /api/demo/runs/:runId/email-certificate ──────────────────────────
// Generates the compliance certificate as a PDF and emails it to the
// supplied address. Accepts the pre-built certificate HTML from the client
// to avoid re-fetching all run data server-side.
router.post('/runs/:runId/email-certificate', async (req, res) => {
  const { to, html, title, filename } = req.body ?? {};
  if (!to?.trim())   return res.status(400).json({ error: 'Recipient email is required.' });
  if (!html?.trim()) return res.status(400).json({ error: 'Certificate HTML is required.' });

  // Verify run belongs to this org before sending
  const { rows } = await pool.query(
    `SELECT id FROM agent_runs WHERE id = $1 AND org_id = $2`,
    [req.params.runId, req.user.orgId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Run not found.' });

  // Generate PDF via Puppeteer (same pattern as routes/export.js)
  const puppeteer = require('puppeteer-core');
  const fs        = require('fs');
  const chromiumCandidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  const chromiumPath = chromiumCandidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) ?? null;
  if (!chromiumPath) {
    return res.status(503).json({ error: 'PDF generation not available in this environment.' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromiumPath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'],
      headless: true,
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4', printBackground: true,
      margin: { top: '20mm', right: '18mm', bottom: '20mm', left: '18mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="font-size:9px;color:#aaa;width:100%;text-align:center;padding:4px 0">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });

    const { send: sendEmail } = require('../services/EmailService');
    const certTitle    = title ?? 'Document Analysis Compliance Certificate';
    const certFilename = filename ?? 'compliance-certificate.pdf';
    await sendEmail({
      to:      to.trim(),
      subject: certTitle,
      html:    `<p>Please find the compliance certificate attached.</p><p>Generated by Curam Engineering AI Document Analyzer.</p>`,
      text:    `Compliance certificate attached.\n\nGenerated by Curam Engineering AI Document Analyzer.`,
      attachments: [{ filename: certFilename, content: pdfBuffer, contentType: 'application/pdf' }],
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[demo/email-certificate]', err.message);
    res.status(500).json({ error: `Failed to send certificate: ${err.message}` });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// ── POST /api/demo/runs/:runId/resubmit ───────────────────────────────────
// Re-examines all findings currently marked 'resubmit', incorporating the
// reviewer's comment, and returns a revised AI assessment for each.
router.post('/runs/:runId/resubmit', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, result FROM agent_runs WHERE id = $1 AND org_id = $2`,
      [req.params.runId, req.user.orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Run not found.' });

    const result  = rows[0].result ?? {};
    const data    = result.data ?? {};
    const extractedText  = data.extracted_text ?? '';
    const fileName       = data.file_name ?? 'document';
    const documentType   = data.document_type ?? 'unknown';

    const flagged = (data.all_findings ?? []).filter((f) => f.status === 'resubmit');
    if (!flagged.length) {
      return res.status(400).json({ error: 'No findings marked for resubmission.' });
    }

    const findingsText = flagged.map((f, i) => {
      const excerpt = f.stage === 'deterministic'
        ? (f.matched_text ?? []).slice(0, 1).join('; ')
        : (f.excerpt ?? '');
      return [
        `Finding ${i + 1} (ID: ${f.finding_id})`,
        `Label: ${f.label}`,
        `Stage: ${f.stage}`,
        `Original assessment: ${f.description ?? f.action ?? ''}`,
        excerpt ? `Document excerpt: "${excerpt}"` : null,
        `Reviewer comment: ${f.comment ?? '(no comment provided)'}`,
      ].filter(Boolean).join('\n');
    }).join('\n\n---\n\n');

    const contextPrompt = `The following findings from an engineering document analysis have been flagged by a reviewer for re-examination. For each, provide a revised assessment that directly addresses the reviewer's comment.

Document: "${fileName}" (type: ${documentType})

Document text (abridged for context):
${extractedText.slice(0, 5000)}${extractedText.length > 5000 ? '\n[Text truncated]' : ''}

---

Flagged findings:

${findingsText}

---

Return ONLY a JSON object — no markdown fences, no explanation:
{
  "assessments": [
    {
      "finding_id": "<finding_id from above>",
      "revised_assessment": "<2-3 sentences directly addressing the reviewer comment and the document evidence>",
      "key_points": ["<brief key point>", "<brief key point>"]
    }
  ]
}`;

    const AgentConfigService = require('../platform/AgentConfigService');
    const { getProvider }    = require('../platform/AgentOrchestrator');
    const { buildSystemPrompt } = require('../agents/demoDocumentAnalyzer/prompt');

    const customProviders = await AgentConfigService.getCustomProviders(req.user.orgId).catch(() => []);
    const adminConfig     = await AgentConfigService.getAdminConfig('demo-document-analyzer').catch(() => ({}));
    const orgDefaultModel = adminConfig.model ?? await AgentConfigService.getOrgDefaultModel(req.user.orgId).catch(() => null);
    const model           = orgDefaultModel ?? 'deepseek-chat';
    const maxTokens       = adminConfig.max_tokens ?? 4096;
    const fallback        = adminConfig.fallback_model ?? null;
    const agentConfig     = await AgentConfigService.getAgentConfig(req.user.orgId, 'demo-document-analyzer').catch(() => ({}));
    const systemPrompt    = buildSystemPrompt(agentConfig);

    async function callModel(modelId) {
      const provider = getProvider(modelId, customProviders);
      return provider.chat({
        model: modelId,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: [{ type: 'text', text: contextPrompt }] }],
      });
    }

    let response;
    try {
      response = await callModel(model);
    } catch (primaryErr) {
      if (fallback) {
        response = await callModel(fallback);
      } else {
        throw primaryErr;
      }
    }

    const textBlock = response.content?.find((b) => b.type === 'text');
    if (!textBlock) throw new Error('No text response from model.');

    let parsed;
    try {
      let candidate = textBlock.text.replace(/```(?:json)?\s*/gi, '').trim();
      const first = candidate.indexOf('{');
      const last  = candidate.lastIndexOf('}');
      if (first !== -1 && last > first) candidate = candidate.slice(first, last + 1);
      parsed = JSON.parse(candidate);
    } catch {
      throw new Error('Model returned invalid JSON for resubmit assessments.');
    }

    res.json({ findings: parsed.assessments ?? [], model });
  } catch (err) {
    console.error('[demo/resubmit]', err.message);
    res.status(500).json({ error: `Failed to resubmit: ${err.message}` });
  }
});

// ── POST /api/demo/runs/:runId/follow-up ──────────────────────────────────
// Allows the user to ask a follow-up question about a previously analysed document.
// The LLM receives the original extracted text, findings, summary, and the new question
// so it can answer contextually — even if the question is unrelated to the previous analysis.
// Slug → prompt module + config slug mapping for follow-up Q&A
const FOLLOW_UP_PROMPT_MAP = {
  'spec-validator':      { promptModule: '../agents/specValidator/prompt',      configSlug: 'spec-validator'      },
  'demo-spec-validator': { promptModule: '../agents/specValidator/prompt',      configSlug: 'demo-spec-validator' },
  'demo-document-analyzer': { promptModule: '../agents/demoDocumentAnalyzer/prompt', configSlug: 'demo-document-analyzer' },
};

router.post('/runs/:runId/follow-up', async (req, res) => {
  const { question, agentSlug } = req.body ?? {};
  if (!question?.trim()) {
    return res.status(400).json({ error: 'Question is required.' });
  }

  // Resolve prompt module and config slug — default to document analyzer for backwards compat
  const slugKey    = FOLLOW_UP_PROMPT_MAP[agentSlug] ? agentSlug : 'demo-document-analyzer';
  const { promptModule, configSlug } = FOLLOW_UP_PROMPT_MAP[slugKey];
  const isSpecValidator = slugKey === 'spec-validator' || slugKey === 'demo-spec-validator';

  try {
    // Load the run — scoped to org_id
    const { rows } = await pool.query(
      `SELECT id, result FROM agent_runs WHERE id = $1 AND org_id = $2`,
      [req.params.runId, req.user.orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Run not found.' });

    const result = rows[0].result ?? {};
    const data   = result.data    ?? {};

    let contextPrompt;

    if (isSpecValidator) {
      // Spec validator context: findings with stated vs calculated values
      const findings = data.all_findings ?? [];
      const fileName = data.file_name ?? 'document';
      const findingsContext = findings
        .map((f) => {
          const det  = f.check_status ? ` | stated: ${f.stated_value} ${f.unit ?? ''} | calculated: ${f.calculated_value ?? 'n/a'} ${f.unit ?? ''} | Python status: ${f.check_status}` : '';
          return `- [${f.stage ?? f.check_status ?? 'finding'}] ${f.label} (confidence: ${f.confidence ?? 1.0})${det}: ${f.description ?? ''}`;
        })
        .join('\n');

      contextPrompt = `The following context is from a previously validated hydraulic specification document.

Document: "${fileName}"

## Findings (${findings.length} total)
${findingsContext || 'No findings were identified.'}

---

Reviewer question: ${question.trim()}

If this question relates to the discrepancies or remediation options from this validation run, answer it directly using the context provided. If it is unrelated to these findings, decline and explain that you can only answer questions about the discrepancies from this run. Use markdown formatting in your response.`;
    } else {
      // Document analyzer context
      const extractedText = data.extracted_text ?? '';
      const summary       = result.summary ?? '';
      const findings      = data.all_findings ?? [];
      const documentType  = data.document_type ?? 'unknown';
      const fileName      = data.file_name ?? 'document';

      const findingsContext = findings
        .map((f) => `- [${f.stage}] ${f.label} (confidence: ${f.confidence}): ${f.description ?? ''}`)
        .join('\n');

      contextPrompt = `The following context is from a previously analysed document.

Document: "${fileName}" (type: ${documentType})

## Summary
${summary}

## Extracted Text (abridged)
${extractedText.slice(0, 8000)}${extractedText.length > 8000 ? '\n\n[Text truncated to 8000 characters]' : ''}

## Findings
${findingsContext || 'No findings were identified.'}

---

Reviewer question: ${question.trim()}

If this question is about the document above, answer it directly using the context provided. If it is unrelated to this document, decline and explain that you can only answer questions about the analysed document. Use markdown formatting in your response.`;
    }

    // Get provider and model config
    const AgentConfigService = require('../platform/AgentConfigService');
    const { getProvider } = require('../platform/AgentOrchestrator');

    const customProviders = await AgentConfigService.getCustomProviders(req.user.orgId).catch(() => []);
    const adminConfig = await AgentConfigService.getAdminConfig(configSlug).catch(() => ({}));
    const orgDefaultModel = adminConfig.model ?? await AgentConfigService.getOrgDefaultModel(req.user.orgId).catch(() => null);
    const model    = orgDefaultModel ?? 'deepseek-chat';
    const maxTokens = adminConfig.max_tokens ?? 4096;
    const fallback  = adminConfig.fallback_model ?? null;

    const { buildSystemPrompt } = require(promptModule);
    const agentConfig = await AgentConfigService.getAgentConfig(req.user.orgId, configSlug).catch(() => ({}));
    const systemPrompt = buildSystemPrompt(agentConfig);

    async function callModel(modelId) {
      const provider = getProvider(modelId, customProviders);
      return provider.chat({
        model: modelId,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: [{ type: 'text', text: contextPrompt }] }],
      });
    }

    let response;
    try {
      response = await callModel(model);
    } catch (primaryErr) {
      if (fallback) {
        try {
          response = await callModel(fallback);
        } catch (fallbackErr) {
          throw new Error(`Both primary (${model}) and fallback (${fallback}) models failed. Primary: ${primaryErr.message}`);
        }
      } else {
        throw primaryErr;
      }
    }

    const textBlock = response.content?.find((b) => b.type === 'text');
    if (!textBlock) throw new Error('No text response from model.');

    // Persist Q&A pair to run record so it survives page refresh/navigation
    pool.query(
      `UPDATE agent_runs
          SET result = jsonb_set(
            result,
            '{data,follow_up_history}',
            COALESCE(result->'data'->'follow_up_history', '[]'::jsonb) || $1::jsonb
          )
        WHERE id = $2 AND org_id = $3`,
      [
        JSON.stringify([{ question, answer: textBlock.text, model, timestamp: new Date().toISOString() }]),
        req.params.runId,
        req.user.orgId,
      ]
    ).catch((err) => console.error('[demo/follow-up] persist error:', err.message));

    res.json({
      answer: textBlock.text,
      model,
      tokensUsed: response.usage ?? {},
    });
  } catch (err) {
    console.error('[demo/follow-up]', err.message);
    res.status(500).json({ error: `Failed to answer follow-up: ${err.message}` });
  }
});

// ── GET /api/demo/tender-evidence ─────────────────────────────────────────
// Lists evidence pack files for the pre-run browser in TenderResponseGenerator.
router.get('/tender-evidence', async (req, res) => {
  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_S3_REGION ?? 'ap-southeast-2';
  const prefix = 'curam engineering/evidence-pack/';

  if (!bucket) {
    return res.status(200).json({ files: [], error: 'S3 not configured.' });
  }

  try {
    const files = await StorageService.list({ bucket, region, prefix, maxKeys: 50 });
    const expiresIn = 3600;
    const enriched = await Promise.all(
      files.map(async (f) => {
        try {
          const { url, expiresAt } = await StorageService.getSignedDownloadUrl({
            bucket,
            region,
            key: f.key,
            expiresIn,
          });
          return { ...f, downloadUrl: url, downloadUrlExpiresAt: expiresAt };
        } catch (signErr) {
          console.warn('[demo/tender-evidence] presign failed for', f.key, signErr.message);
          return { ...f, downloadUrl: null };
        }
      })
    );
    res.json({ files: enriched });
  } catch (err) {
    console.error('[demo/tender-evidence]', err.message);
    res.status(500).json({ error: 'Failed to list evidence pack.' });
  }
});

// ── PATCH /api/demo/runs/:runId/tender-review/:requirementId ─────────────
// HITL review for tender response drafts.
// Body: { status, comment, edited_text }
// status: approved | edited | rejected
// edited state: edited_text required; preserves original_draft on first edit.
// rejected state: comment required.
router.patch('/runs/:runId/tender-review/:requirementId', async (req, res) => {
  const VALID_STATUSES = new Set(['approved', 'edited', 'rejected']);
  const { runId, requirementId } = req.params;
  const { status, comment, edited_text } = req.body ?? {};

  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: `Invalid status. Must be: ${[...VALID_STATUSES].join(' | ')}` });
  }
  if (status === 'edited' && !edited_text?.trim()) {
    return res.status(400).json({ error: 'edited_text is required when status is "edited".' });
  }
  if (status === 'rejected' && !comment?.trim()) {
    return res.status(400).json({ error: 'A comment is required when rejecting a draft.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, result FROM agent_runs WHERE id = $1 AND org_id = $2`,
      [runId, req.user.orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Run not found.' });

    const result = rows[0].result ?? {};
    const data   = result.data    ?? {};

    let found = false;
    const requirements = (data.requirements ?? []).map((r) => {
      if (r.requirement_id !== requirementId && r.finding_id !== requirementId) return r;
      if (r.status === 'blocked') return r; // blocked requirements cannot be reviewed

      found = true;
      const updated = {
        ...r,
        status,
        comment:     comment?.trim() ?? null,
        reviewed_by: req.user.email ?? req.user.id,
        reviewed_at: new Date().toISOString(),
      };

      if (status === 'edited') {
        updated.edited_text    = edited_text.trim();
        // preserve original_draft on first edit — subsequent edits keep the initial draft
        updated.original_draft = r.original_draft ?? r.draft_response;
      }

      return updated;
    });

    if (!found) return res.status(404).json({ error: 'Requirement not found in run.' });

    const pending_review_count = requirements.filter((r) => r.status === 'pending').length;

    const trace = data.trace ?? [];
    trace.push({
      step:           'review_action',
      timestamp:      new Date().toISOString(),
      requirement_id: requirementId,
      decision:       status,
      reviewed_by:    req.user.email ?? req.user.id,
      comment:        comment?.trim() ?? null,
      ...(status === 'edited' ? { edited_text: edited_text?.trim() } : {}),
    });

    const updatedData = { ...data, requirements, pending_review_count, trace };

    await pool.query(
      `UPDATE agent_runs SET result = jsonb_set(result, '{data}', $1::jsonb) WHERE id = $2 AND org_id = $3`,
      [JSON.stringify(updatedData), runId, req.user.orgId]
    );

    res.json({ ok: true, requirement_id: requirementId, status, pending_review_count });
  } catch (err) {
    console.error('[demo/tender-review PATCH]', err.message);
    res.status(500).json({ error: 'Failed to update review.' });
  }
});

module.exports = router;
