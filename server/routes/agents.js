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

const agentsRouter = express.Router();
const agentConfigsRouter = express.Router();

// ── Agent registrations ───────────────────────────────────────────────────

const { createAgentRoute } = require('../platform/createAgentRoute');
const { AgentScheduler }   = require('../platform/AgentScheduler');
const { send: sendEmail }  = require('../services/EmailService');

// ── Google Ads Monitor ────────────────────────────────────────────────────
const { runGoogleAdsMonitor } = require('../agents/googleAdsMonitor');

agentsRouter.use(
  '/google-ads-monitor',
  createAgentRoute({
    slug:               'google-ads-monitor',
    runFn:              runGoogleAdsMonitor,
    requiredPermission: 'ads_operator',
  })
);

AgentScheduler.register({
  slug:     'google-ads-monitor',
  schedule: '0 6,18 * * *',
  runFn:    runGoogleAdsMonitor,
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

module.exports = { agentsRouter, agentConfigsRouter };
