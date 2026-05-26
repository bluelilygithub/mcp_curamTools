/**
 * agents.js — mount point for all agent routes.
 * Exports { agentsRouter, agentConfigsRouter } — both mounted in index.js.
 *
 * Each agent calls createAgentRoute() to register its SSE run + history endpoints.
 * Agent configs (operator settings) are served via agentConfigsRouter.
 *
 * To add a new agent:
 *   1. Create server/agents/<slug>/index.js
 *   2. Import and register here using createAgentRoute()
 */
const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const AgentConfigService = require('../platform/AgentConfigService');
const { pool } = require('../db');

const agentsRouter = express.Router();
const agentConfigsRouter = express.Router();

// ── Agent registrations ───────────────────────────────────────────────────

const { createAgentRoute } = require('../platform/createAgentRoute');
const { AgentScheduler }   = require('../platform/AgentScheduler');
const { send: sendEmail }  = require('../services/EmailService');

/**
 * Isolate per-agent load failures so one broken module cannot take down all 31+ agents.
 * Returns the named export on success, null on failure (logs the error).
 */
function tryLoad(modulePath, exportName, slug) {
  try {
    return require(modulePath)[exportName] ?? null;
  } catch (err) {
    console.error(`[agents] ⚠ Failed to load agent "${slug}": ${err.message}`);
    return null;
  }
}

/**
 * Registers an agent route. When runFn is null (load failure), mounts a 503 stub
 * so the broken agent is visible without affecting other routes.
 */
function registerAgent(path, opts) {
  const { slug, runFn, requiredPermission, rateLimit } = opts;
  if (!runFn) {
    agentsRouter.all(`/${slug}/*`, (req, res) =>
      res.status(503).json({ error: `Agent "${slug}" unavailable — module failed to load. Check server logs.` })
    );
    agentsRouter.all(`/${slug}`, (req, res) =>
      res.status(503).json({ error: `Agent "${slug}" unavailable — module failed to load. Check server logs.` })
    );
    return;
  }
  agentsRouter.use(path, createAgentRoute({ slug, runFn, requiredPermission, rateLimit }));
}

// ── Google Ads Monitor ────────────────────────────────────────────────────
const runGoogleAdsMonitor      = tryLoad('../agents/googleAdsMonitor',      'runGoogleAdsMonitor',      'google-ads-monitor');
const runGoogleAdsFreeform     = tryLoad('../agents/googleAdsFreeform',     'runGoogleAdsFreeform',     'google-ads-freeform');
const runGoogleAdsChangeImpact = tryLoad('../agents/googleAdsChangeImpact', 'runGoogleAdsChangeImpact', 'google-ads-change-impact');
const runGoogleAdsChangeAudit  = tryLoad('../agents/googleAdsChangeAudit',  'runGoogleAdsChangeAudit',  'google-ads-change-audit');

registerAgent('/google-ads-monitor',      { slug: 'google-ads-monitor',      runFn: runGoogleAdsMonitor,      requiredPermission: 'ads_operator' });
if (runGoogleAdsMonitor) AgentScheduler.register({ slug: 'google-ads-monitor', schedule: '0 6,18 * * *', runFn: runGoogleAdsMonitor });

// ── Google Ads Freeform ───────────────────────────────────────────────────
registerAgent('/google-ads-freeform',     { slug: 'google-ads-freeform',     runFn: runGoogleAdsFreeform,     requiredPermission: 'ads_operator' });

// ── Google Ads Change Impact ──────────────────────────────────────────────
registerAgent('/google-ads-change-impact',{ slug: 'google-ads-change-impact', runFn: runGoogleAdsChangeImpact, requiredPermission: 'ads_operator' });

// ── Google Ads Change Audit ───────────────────────────────────────────────
registerAgent('/google-ads-change-audit', { slug: 'google-ads-change-audit',  runFn: runGoogleAdsChangeAudit,  requiredPermission: 'ads_operator' });

// ── Ads Bounce Analysis ───────────────────────────────────────────────────
const runAdsBounceAnalysis    = tryLoad('../agents/adsBounceAnalysis',    'runAdsBounceAnalysis',    'ads-bounce-analysis');
registerAgent('/ads-bounce-analysis',     { slug: 'ads-bounce-analysis',     runFn: runAdsBounceAnalysis,    requiredPermission: 'ads_operator' });

// ── Auction Insights ──────────────────────────────────────────────────────
const runAuctionInsights      = tryLoad('../agents/auctionInsights',      'runAuctionInsights',      'auction-insights');
registerAgent('/auction-insights',        { slug: 'auction-insights',        runFn: runAuctionInsights,      requiredPermission: 'ads_operator' });

// ── Competitor Keyword Intel ──────────────────────────────────────────────
const runCompetitorKeywordIntel = tryLoad('../agents/competitorKeywordIntel', 'runCompetitorKeywordIntel', 'competitor-keyword-intel');
registerAgent('/competitor-keyword-intel',{ slug: 'competitor-keyword-intel', runFn: runCompetitorKeywordIntel, requiredPermission: 'ads_operator' });

// ── Google Ads Strategic Review ───────────────────────────────────────────
const runGoogleAdsStrategicReview = tryLoad('../agents/googleAdsStrategicReview', 'runGoogleAdsStrategicReview', 'google-ads-strategic-review');
registerAgent('/google-ads-strategic-review', { slug: 'google-ads-strategic-review', runFn: runGoogleAdsStrategicReview, requiredPermission: 'ads_operator' });

// ── Keyword Opportunity ───────────────────────────────────────────────────
const runKeywordOpportunity   = tryLoad('../agents/keywordOpportunity',   'runKeywordOpportunity',   'keyword-opportunity');
registerAgent('/keyword-opportunity',     { slug: 'keyword-opportunity',     runFn: runKeywordOpportunity,   requiredPermission: 'ads_operator' });

// ── Ads Copy Gate ─────────────────────────────────────────────────────────
const runAdsCopyGate          = tryLoad('../agents/adsCopyGate',          'runAdsCopyGate',          'ads-copy-gate');
registerAgent('/ads-copy-gate',           { slug: 'ads-copy-gate',           runFn: runAdsCopyGate,          requiredPermission: 'ads_operator' });

// ── Ads Copy Playbook ─────────────────────────────────────────────────────
const runAdsCopyPlaybook      = tryLoad('../agents/adsCopyPlaybook',      'runAdsCopyPlaybook',      'ads-copy-playbook');
registerAgent('/ads-copy-playbook',       { slug: 'ads-copy-playbook',       runFn: runAdsCopyPlaybook,      requiredPermission: 'ads_operator' });

// ── Ads Setup Architect ───────────────────────────────────────────────────
const runAdsSetupArchitect    = tryLoad('../agents/profitabilitySuite/adsSetupArchitect', 'runAdsSetupArchitect', 'ads-setup-architect');
registerAgent('/ads-setup-architect',     { slug: 'ads-setup-architect',     runFn: runAdsSetupArchitect,    requiredPermission: 'ads_operator' });

// ── Ads Copy Diagnostic ───────────────────────────────────────────────────
const runAdsCopyDiagnostic    = tryLoad('../agents/adsCopyDiagnostic',    'runAdsCopyDiagnostic',    'ads-copy-diagnostic');
registerAgent('/ads-copy-diagnostic',     { slug: 'ads-copy-diagnostic',     runFn: runAdsCopyDiagnostic,    requiredPermission: 'ads_operator' });

// ── Ads Attribution Summary ───────────────────────────────────────────────
const runAdsAttributionSummary = tryLoad('../agents/adsAttributionSummary', 'runAdsAttributionSummary', 'ads-attribution-summary');
registerAgent('/ads-attribution-summary', { slug: 'ads-attribution-summary', runFn: runAdsAttributionSummary, requiredPermission: 'ads_operator' });

// ── WP Theme Extractor ────────────────────────────────────────────────────
const runWpThemeExtractor     = tryLoad('../agents/wpThemeExtractor',     'runWpThemeExtractor',     'wp-theme-extractor');
registerAgent('/wp-theme-extractor',      { slug: 'wp-theme-extractor',      runFn: runWpThemeExtractor,     requiredPermission: 'org_member', rateLimit: 20 });

// ── DiamondPlate Data ─────────────────────────────────────────────────────
const runDiamondplateData     = tryLoad('../agents/diamondplateData',     'runDiamondplateData',     'diamondplate-data');
registerAgent('/diamondplate-data',       { slug: 'diamondplate-data',       runFn: runDiamondplateData,     requiredPermission: 'org_member' });

// ── Search Term Intelligence ──────────────────────────────────────────────
const runSearchTermIntelligence = tryLoad('../agents/searchTermIntelligence', 'runSearchTermIntelligence', 'search-term-intelligence');
registerAgent('/search-term-intelligence',{ slug: 'search-term-intelligence', runFn: runSearchTermIntelligence, requiredPermission: 'org_member' });

// ── Daypart Intelligence ──────────────────────────────────────────────────
const runDaypartIntelligence  = tryLoad('../agents/daypartIntelligence',  'runDaypartIntelligence',  'daypart-intelligence');
registerAgent('/daypart-intelligence',    { slug: 'daypart-intelligence',    runFn: runDaypartIntelligence,  requiredPermission: 'ads_operator' });

// ── Cost Per Booked Job ───────────────────────────────────────────────────
const runCostPerBookedJob     = tryLoad('../agents/costPerBookedJob',     'runCostPerBookedJob',     'cost-per-booked-job');
registerAgent('/cost-per-booked-job',     { slug: 'cost-per-booked-job',     runFn: runCostPerBookedJob,     requiredPermission: 'ads_operator' });

// ── Lead Velocity ─────────────────────────────────────────────────────────
const runLeadVelocity         = tryLoad('../agents/leadVelocity',         'runLeadVelocity',         'lead-velocity');
registerAgent('/lead-velocity',           { slug: 'lead-velocity',           runFn: runLeadVelocity,         requiredPermission: 'org_member' });

// ── AI Visibility Monitor ─────────────────────────────────────────────────
const runAiVisibilityMonitor  = tryLoad('../agents/aiVisibilityMonitor',  'runAiVisibilityMonitor',  'ai-visibility-monitor');
registerAgent('/ai-visibility-monitor',   { slug: 'ai-visibility-monitor',   runFn: runAiVisibilityMonitor,  requiredPermission: 'org_member' });
if (runAiVisibilityMonitor) AgentScheduler.register({ slug: 'ai-visibility-monitor', schedule: '0 7 * * 1', runFn: runAiVisibilityMonitor });

// ── Not Interested Report ─────────────────────────────────────────────────
const runNotInterestedReport  = tryLoad('../agents/notInterestedReport',  'runNotInterestedReport',  'not-interested-report');
registerAgent('/not-interested-report',   { slug: 'not-interested-report',   runFn: runNotInterestedReport,  requiredPermission: 'org_admin' });

// ── Geo Heatmap ───────────────────────────────────────────────────────────
const runGeoHeatmap           = tryLoad('../agents/geoHeatmap',           'runGeoHeatmap',           'geo-heatmap');
registerAgent('/geo-heatmap',             { slug: 'geo-heatmap',             runFn: runGeoHeatmap,           requiredPermission: 'org_member' });

// ── High Intent Advisor ───────────────────────────────────────────────────
const runHighIntentAdvisor    = tryLoad('../agents/highIntentAdvisor',    'runHighIntentAdvisor',    'high-intent-advisor');
registerAgent('/high-intent-advisor',     { slug: 'high-intent-advisor',     runFn: runHighIntentAdvisor,    requiredPermission: 'org_admin' });
// AgentScheduler cron registration deferred — add after manual QA

// GET /api/agents/high-intent-advisor/suggestions
agentsRouter.get('/high-intent-advisor/suggestions', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, category, priority, suggestion_text, rationale, status,
              baseline_metrics, outcome_metrics, outcome_notes, acted_on_at,
              reviewed_at, created_at, run_id
       FROM agent_suggestions
       WHERE org_id = $1 AND status IN ('pending', 'monitoring')
       ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                created_at DESC`,
      [req.user.orgId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[high-intent-advisor/suggestions GET]', err.message);
    res.status(500).json({ error: 'Failed to load suggestions.' });
  }
});

// GET /api/agents/high-intent-advisor/suggestions/history
agentsRouter.get('/high-intent-advisor/suggestions/history', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, category, priority, suggestion_text, rationale, status,
              outcome_notes, acted_on_at, reviewed_at, created_at
       FROM agent_suggestions
       WHERE org_id = $1 AND status IN ('acted_on', 'dismissed')
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.orgId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[high-intent-advisor/suggestions/history GET]', err.message);
    res.status(500).json({ error: 'Failed to load suggestion history.' });
  }
});

// PATCH /api/agents/high-intent-advisor/suggestions/:id
agentsRouter.patch('/high-intent-advisor/suggestions/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, outcome_notes, acted_on_at, user_action, user_reason } = req.body;

    const { rows } = await pool.query(
      `UPDATE agent_suggestions
       SET status        = COALESCE($1, status),
           outcome_notes = COALESCE($2, outcome_notes),
           acted_on_at   = COALESCE($3, acted_on_at),
           user_action   = COALESCE($4, user_action),
           user_reason   = COALESCE($5, user_reason)
       WHERE id = $6 AND org_id = $7
       RETURNING *`,
      [status ?? null, outcome_notes ?? null, acted_on_at ?? null,
       user_action ?? null, user_reason ?? null, id, req.user.orgId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Suggestion not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[high-intent-advisor/suggestions PATCH]', err.message);
    res.status(500).json({ error: 'Failed to update suggestion.' });
  }
});

// Email report — POST /api/agents/google-ads-monitor/email
agentsRouter.post('/google-ads-monitor/email', requireAuth, async (req, res) => {
  try {
    const { to, result, startDate, endDate } = req.body;
    if (!to || !result) return res.status(400).json({ error: 'Missing required fields.' });

    const subject = `Google Ads Report: ${startDate} to ${endDate}`;

    // Plain text — just the summary
    const text = result.summary
      ? result.summary.replace(/<[^>]+>/g, '').replace(/#{1,3}\s/g, '').trim()
      : 'See Google Ads report.';

    // HTML — summary + campaign table
    const campaigns = result.data?.get_campaign_performance ?? [];
    const fmt = (n) => `$${Number(n ?? 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmtN = (n) => Math.round(n ?? 0).toLocaleString('en-AU');
    const fmtPct = (n) => `${(Number(n ?? 0) * 100).toFixed(1)}%`;

    const campaignRows = campaigns.map((c) => {
      const cpa = c.conversions > 0 ? c.cost / c.conversions : null;
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${c.name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${fmtN(c.impressions)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${fmtN(c.clicks)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${fmtPct(c.ctr)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${fmt(c.cost)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${c.conversions?.toFixed(1) ?? '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${cpa != null ? fmt(cpa) : '—'}</td>
      </tr>`;
    }).join('');

    const summaryHtml = (result.summary ?? '')
      .replace(/### (.+)/g, '<h3 style="font-size:15px;margin:16px 0 6px;color:#1e293b">$1</h3>')
      .replace(/## (.+)/g, '<h2 style="font-size:17px;margin:20px 0 8px;color:#1e293b">$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^- (.+)/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul style="padding-left:20px;margin:8px 0">$1</ul>')
      .replace(/\n\n/g, '</p><p style="margin:8px 0;line-height:1.6">')
      .replace(/\n/g, '<br>');

    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:700px;margin:0 auto;color:#1e293b">
        <h1 style="font-size:20px;font-weight:700;margin-bottom:4px">Google Ads Report</h1>
        <p style="color:#64748b;margin-bottom:20px">${startDate} to ${endDate}</p>
        <p style="margin:8px 0;line-height:1.6">${summaryHtml}</p>
        ${campaigns.length > 0 ? `
        <h2 style="font-size:16px;font-weight:600;margin:24px 0 10px">Campaign Performance</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f8fafc">
              <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;color:#64748b">Campaign</th>
              <th style="padding:6px 10px;text-align:right;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;color:#64748b">Impressions</th>
              <th style="padding:6px 10px;text-align:right;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;color:#64748b">Clicks</th>
              <th style="padding:6px 10px;text-align:right;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;color:#64748b">CTR</th>
              <th style="padding:6px 10px;text-align:right;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;color:#64748b">Cost</th>
              <th style="padding:6px 10px;text-align:right;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;color:#64748b">Conv.</th>
              <th style="padding:6px 10px;text-align:right;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;color:#64748b">CPA</th>
            </tr>
          </thead>
          <tbody>${campaignRows}</tbody>
        </table>` : ''}
      </div>`;

    await sendEmail({ to, subject, html, text });
    res.json({ ok: true });
  } catch (err) {
    console.error('[google-ads-monitor email]', err.message);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

// ── Demo Suite — Document Analyzer ───────────────────────────────────────
const runDocumentAnalyzer = tryLoad('../agents/demoSuite/documentAnalyzer', 'runDocumentAnalyzer', 'demo-document-analyzer');
registerAgent('/demo-document-analyzer',  { slug: 'demo-document-analyzer',  runFn: runDocumentAnalyzer,  requiredPermission: 'org_member', rateLimit: 20 });

// ── Spec Validator (internal + demo) ─────────────────────────────────────
const runSpecValidator    = tryLoad('../agents/specValidator/index',         'runSpecValidator',    'spec-validator');
registerAgent('/spec-validator',          { slug: 'spec-validator',          runFn: runSpecValidator,     requiredPermission: 'org_member', rateLimit: 10 });
registerAgent('/demo-spec-validator',     { slug: 'demo-spec-validator',     runFn: runSpecValidator,     requiredPermission: 'org_member', rateLimit: 20 });

// ── Demo Suite — Tender Response Generator ───────────────────────────────
const runTenderResponse   = tryLoad('../agents/demoSuite/tenderResponse',    'runTenderResponse',   'demo-tender-response');
registerAgent('/demo-tender-response',    { slug: 'demo-tender-response',    runFn: runTenderResponse,    requiredPermission: 'org_member', rateLimit: 10 });

// ── Agent config routes (/api/agent-configs/:slug) ────────────────────────

// GET /api/agent-configs/:slug — operator config (any authenticated user)
agentConfigsRouter.get('/:slug', requireAuth, async (req, res) => {
  try {
    const config = await AgentConfigService.getAgentConfig(req.user.orgId, req.params.slug);
    res.json(config);
  } catch (err) {
    console.error('[agent-configs GET]', err.message);
    res.status(500).json({ error: 'Failed to load agent config.' });
  }
});

// PUT /api/agent-configs/:slug — operator config update (org_admin only)
agentConfigsRouter.put('/:slug', requireAuth, requireRole(['org_admin']), async (req, res) => {
  try {
    const { AgentScheduler } = require('../platform/AgentScheduler');
    const patch = req.body;
    const updated = await AgentConfigService.updateAgentConfig(
      req.user.orgId,
      req.params.slug,
      patch,
      req.user.id
    );

    // Hot-reload schedule if it changed
    if (patch.schedule && AgentScheduler.getSchedule(req.params.slug)) {
      AgentScheduler.updateSchedule(req.params.slug, patch.schedule);
    }

    res.json(updated);
  } catch (err) {
    console.error('[agent-configs PUT]', err.message);
    res.status(500).json({ error: 'Failed to update agent config.' });
  }
});

// GET /api/agent-configs/:slug/preview-prompt — preview rendered system prompt
agentConfigsRouter.get('/:slug/preview-prompt', requireAuth, async (req, res) => {
  try {
    const { slug } = req.params;
    const customerId = req.query.customerId ?? null;
    const config = customerId
      ? await AgentConfigService.getAgentConfigForCustomer(req.user.orgId, slug, customerId)
      : await AgentConfigService.getAgentConfig(req.user.orgId, slug);

    // Dynamically load the agent's buildSystemPrompt if it exists
    let preview = null;
    try {
      const agentDir = slug.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // kebab → camel
      const { buildSystemPrompt } = require(`../agents/${agentDir}/prompt`);
      const customerVars = customerId
        ? { customer_id: customerId, customer_name: config.customer_name ?? customerId }
        : {};
      preview = buildSystemPrompt(config, customerVars);
    } catch {
      preview = '(No prompt builder found for this agent.)';
    }

    res.json({ preview });
  } catch (err) {
    console.error('[agent-configs preview-prompt]', err.message);
    res.status(500).json({ error: 'Failed to preview prompt.' });
  }
});

// GET /api/agent-configs/:slug/customers — list customer-specific configs
agentConfigsRouter.get('/:slug/customers', requireAuth, async (req, res) => {
  try {
    const rows = await AgentConfigService.listCustomerConfigs(req.user.orgId, req.params.slug);
    res.json(rows);
  } catch (err) {
    console.error('[agent-configs customers GET]', err.message);
    res.status(500).json({ error: 'Failed to load customer configs.' });
  }
});

// PUT /api/agent-configs/:slug/customers/:customerId — upsert customer-specific config
agentConfigsRouter.put('/:slug/customers/:customerId', requireAuth, requireRole(['org_admin']), async (req, res) => {
  try {
    const updated = await AgentConfigService.updateAgentConfigForCustomer(
      req.user.orgId,
      req.params.slug,
      req.params.customerId,
      req.body,
      req.user.id
    );
    res.json(updated);
  } catch (err) {
    console.error('[agent-configs customers PUT]', err.message);
    res.status(500).json({ error: 'Failed to update customer config.' });
  }
});

// GET /api/agent-configs/:slug/meta — prompt metadata (updated_at, editor, model)
agentConfigsRouter.get('/:slug/meta', requireAuth, async (req, res) => {
  try {
    const meta = await AgentConfigService.getAgentConfigMeta(req.user.orgId, req.params.slug);
    res.json(meta);
  } catch (err) {
    console.error('[agent-configs meta GET]', err.message);
    res.status(500).json({ error: 'Failed to load agent config meta.' });
  }
});

// GET /api/agent-configs/:slug/flags — open prompt flags
agentConfigsRouter.get('/:slug/flags', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, reason, flagged_at
         FROM prompt_flags
        WHERE org_id = $1 AND slug = $2 AND resolved_at IS NULL
        ORDER BY flagged_at DESC`,
      [req.user.orgId, req.params.slug]
    );
    res.json(rows);
  } catch (err) {
    console.error('[agent-configs flags GET]', err.message);
    res.status(500).json({ error: 'Failed to load prompt flags.' });
  }
});

// POST /api/agent-configs/:slug/flags/:id/resolve — resolve a prompt flag
agentConfigsRouter.post('/:slug/flags/:id/resolve', requireAuth, requireRole(['org_admin']), async (req, res) => {
  try {
    await pool.query(
      `UPDATE prompt_flags
          SET resolved_at = NOW(), resolved_by = $1
        WHERE id = $2 AND org_id = $3 AND slug = $4`,
      [req.user.id, req.params.id, req.user.orgId, req.params.slug]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[agent-configs flags resolve]', err.message);
    res.status(500).json({ error: 'Failed to resolve flag.' });
  }
});

// ── AI Visibility Prompt Management ─────────────────────────────────────────
// GET    /api/agents/ai-visibility-monitor/prompts        — list all prompts for org
// POST   /api/agents/ai-visibility-monitor/prompts        — create new prompt
// PUT    /api/agents/ai-visibility-monitor/prompts/:id    — update prompt (text, label, category, is_active, sort_order)
// DELETE /api/agents/ai-visibility-monitor/prompts/:id    — delete prompt

agentsRouter.get('/ai-visibility-monitor/prompts', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, prompt_text, category, label, is_active, sort_order, created_at, updated_at
         FROM ai_visibility_prompts
        WHERE org_id = $1
        ORDER BY sort_order, id`,
      [req.user.orgId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[ai-visibility-prompts GET]', err.message);
    res.status(500).json({ error: 'Failed to load prompts.' });
  }
});

agentsRouter.post('/ai-visibility-monitor/prompts', requireAuth, async (req, res) => {
  try {
    const { prompt_text, category = 'general', label = null, sort_order = 0 } = req.body;
    if (!prompt_text || !prompt_text.trim()) {
      return res.status(400).json({ error: 'prompt_text is required.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO ai_visibility_prompts
         (org_id, prompt_text, category, label, is_active, sort_order)
       VALUES ($1, $2, $3, $4, true, $5)
       RETURNING id, prompt_text, category, label, is_active, sort_order, created_at, updated_at`,
      [req.user.orgId, prompt_text.trim().slice(0, 500), String(category).slice(0, 50), label ? String(label).slice(0, 200) : null, Number(sort_order) || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[ai-visibility-prompts POST]', err.message);
    res.status(500).json({ error: 'Failed to create prompt.' });
  }
});

agentsRouter.put('/ai-visibility-monitor/prompts/:id', requireAuth, async (req, res) => {
  try {
    const { prompt_text, category, label, is_active, sort_order } = req.body;
    const { rows } = await pool.query(
      `UPDATE ai_visibility_prompts
          SET prompt_text = COALESCE($1, prompt_text),
              category    = COALESCE($2, category),
              label       = $3,
              is_active   = COALESCE($4, is_active),
              sort_order  = COALESCE($5, sort_order),
              updated_at  = NOW()
        WHERE id = $6 AND org_id = $7
        RETURNING id, prompt_text, category, label, is_active, sort_order, created_at, updated_at`,
      [
        prompt_text ? prompt_text.trim().slice(0, 500) : null,
        category    ? String(category).slice(0, 50)    : null,
        label !== undefined ? (label ? String(label).slice(0, 200) : null) : undefined,
        is_active   !== undefined ? Boolean(is_active) : null,
        sort_order  !== undefined ? Number(sort_order) : null,
        req.params.id,
        req.user.orgId,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Prompt not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[ai-visibility-prompts PUT]', err.message);
    res.status(500).json({ error: 'Failed to update prompt.' });
  }
});

agentsRouter.delete('/ai-visibility-monitor/prompts/:id', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM ai_visibility_prompts WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user.orgId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Prompt not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[ai-visibility-prompts DELETE]', err.message);
    res.status(500).json({ error: 'Failed to delete prompt.' });
  }
});

module.exports = { agentsRouter, agentConfigsRouter };
