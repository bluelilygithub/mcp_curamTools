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
// Agents slot in here when built. Example:
//
// const { createAgentRoute } = require('../platform/createAgentRoute');
// const { runGoogleAdsMonitor } = require('../agents/googleAdsMonitor');
// agentsRouter.use(
//   '/google-ads-monitor',
//   createAgentRoute({ slug: 'google-ads-monitor', runFn: runGoogleAdsMonitor, requiredPermission: 'ads_operator' })
// );

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
