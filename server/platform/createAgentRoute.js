/**
 * createAgentRoute — platform routing factory.
 * Returns an Express router with POST /run (SSE) and GET /history.
 * Zero agent-specific code lives here.
 *
 * Usage:
 *   const router = createAgentRoute({ slug, runFn, requiredPermission });
 *   app.use('/api/agents/my-agent', router);
 *
 * runFn signature:
 *   async (context) => { result, tokensUsed }
 *   context: { orgId, userId, config, adminConfig, req }
 */
const express = require('express');
const { pool } = require('../db');
const { persistRun } = require('./persistRun');
const { requireAuth } = require('../middleware/requireAuth');
const { requireRole } = require('../middleware/requireRole');
const AgentConfigService = require('./AgentConfigService');
const CostGuardService = require('../services/CostGuardService');
const { logUsage } = require('../services/UsageLogger');

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Walk an agent trace and key each tool result by tool name.
 * Returns a JSONB-ready object: { [toolName]: result }
 * Generic — no agent-specific knowledge.
 */
function extractToolData(trace) {
  if (!Array.isArray(trace)) return {};
  const data = {};
  for (const step of trace) {
    if (Array.isArray(step.toolResults)) {
      for (const tr of step.toolResults) {
        if (tr.name) data[tr.name] = tr.result;
      }
    }
  }
  return data;
}

/**
 * Parse the ### Recommendations numbered list from agent output.
 * Items 1-2 → high, 3-5 → medium, 6+ → low.
 */
function extractSuggestions(text) {
  if (!text) return [];
  const match = text.match(/###\s*Recommendations?\s*\n([\s\S]*?)(?=\n###|\n##|$)/i);
  if (!match) return [];
  const items = match[1]
    .split('\n')
    .map((l) => l.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
  return items.map((text, i) => ({
    text,
    priority: i < 2 ? 'high' : i < 5 ? 'medium' : 'low',
  }));
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * @param {string}   slug               — agent identifier (e.g. 'google-ads-monitor')
 * @param {Function} runFn              — async (context) => { result, trace?, tokensUsed? }
 * @param {string}   requiredPermission — role name; org_admin always satisfies the check
 */
function createAgentRoute({ slug, runFn, requiredPermission }) {
  const router = express.Router();

  // ── POST /run — SSE stream ───────────────────────────────────────────────
  router.post(
    '/run',
    requireAuth,
    requireRole(['org_admin', requiredPermission].filter(Boolean)),
    async (req, res) => {
      // SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const emit = (type, payload) => {
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
      };
      const done = () => {
        res.write('data: [DONE]\n\n');
        res.end();
      };

      const { orgId, id: userId } = req.user;
      const startTime = new Date();

      // Insert initial 'running' row
      let runId;
      try {
        runId = await persistRun({ slug, orgId, status: 'running', runAt: startTime });
      } catch (dbErr) {
        emit('error', { error: 'Failed to record run start' });
        return done();
      }

      // Load admin config and check kill switch
      let adminConfig;
      try {
        adminConfig = await AgentConfigService.getAdminConfig(slug);
      } catch (cfgErr) {
        emit('error', { error: 'Failed to load agent config' });
        await persistRun({ slug, orgId, status: 'error', error: cfgErr.message, runId });
        return done();
      }

      if (!adminConfig.enabled) {
        emit('error', { error: 'Agent is currently disabled by an administrator.' });
        await persistRun({ slug, orgId, status: 'error', error: 'Agent disabled', runId });
        return done();
      }

      // Load operator config
      let agentConfig;
      try {
        agentConfig = await AgentConfigService.getAgentConfig(orgId, slug);
      } catch (cfgErr) {
        agentConfig = {};
      }

      // Budget setup — load once, check as a pure function during the run
      const maxTaskBudgetAud = adminConfig.max_task_budget_aud ?? null;
      let maxDailyBudgetAud = null;
      let dailyOrgSpendAud = 0;
      try {
        const orgBudget = await AgentConfigService.getOrgBudgetSettings(orgId);
        maxDailyBudgetAud = orgBudget.max_daily_org_budget_aud ?? null;
        if (maxDailyBudgetAud != null) {
          dailyOrgSpendAud = await CostGuardService.getDailyOrgSpendAud(orgId);
          // Pre-flight: if org is already over daily budget, abort before the run starts
          CostGuardService.check({ taskCostAud: 0, maxTaskBudgetAud: null, dailyOrgSpendAud, maxDailyBudgetAud });
        }
      } catch (budgetErr) {
        if (budgetErr.name === 'BudgetExceededError') {
          emit('error', { error: budgetErr.message });
          await persistRun({ slug, orgId, status: 'error', error: budgetErr.message, runId });
          return done();
        }
        // Non-budget errors loading budget config are non-fatal — proceed without limit
        console.error(`[${slug}] budget config load error:`, budgetErr.message);
      }

      // Accumulated task cost tracker — updated by the emit callback below
      let taskCostAud = 0;

      // Run the agent
      try {
        emit('progress', { text: 'Starting agent run…' });

        const { result, trace, tokensUsed } = await runFn({
          orgId,
          userId,
          config: agentConfig,
          adminConfig,
          req,
          // Extended emit: agents may optionally pass tokensUsed to trigger mid-run budget checks.
          // Agents that don't pass tokensUsed still work — cost tracking simply won't accumulate mid-run.
          emit: (text, partialTokensUsed) => {
            emit('progress', { text });
            if (partialTokensUsed) {
              taskCostAud += CostGuardService.computeCostAud(partialTokensUsed);
              CostGuardService.check({ taskCostAud, maxTaskBudgetAud, dailyOrgSpendAud, maxDailyBudgetAud });
            }
          },
        });

        // Post-run budget check using final tokensUsed (catches agents that don't emit partial costs)
        if (tokensUsed) {
          const finalCostAud = CostGuardService.computeCostAud(tokensUsed);
          taskCostAud = Math.max(taskCostAud, finalCostAud); // use final if higher than accumulated
          CostGuardService.check({ taskCostAud, maxTaskBudgetAud, dailyOrgSpendAud, maxDailyBudgetAud });
        }

        const toolData = extractToolData(trace);
        const suggestions = extractSuggestions(result?.summary ?? '');

        const resultPayload = {
          summary:   result?.summary ?? '',
          data:      { ...toolData, ...(result?.data ?? {}) },
          suggestions,
          tokensUsed: tokensUsed ?? {},
          costAud:   taskCostAud,
          startDate: req.body.startDate ?? null,
          endDate:   req.body.endDate   ?? null,
        };

        await persistRun({ slug, orgId, status: 'complete', result: resultPayload, runId });

        logUsage({ orgId, userId, slug, modelId: adminConfig.model, tokensUsed: tokensUsed ?? {}, costAud: taskCostAud })
          .catch(err => console.error(`[${slug}] usage log error:`, err.message));

        emit('result', { data: resultPayload });
      } catch (runErr) {
        console.error(`[${slug}] run error:`, runErr.message);
        await persistRun({ slug, orgId, status: 'error', error: runErr.message, runId });
        emit('error', { error: runErr.message });
      }

      done();
    }
  );

  // ── GET /history ─────────────────────────────────────────────────────────
  router.get('/history', requireAuth, async (req, res) => {
    try {
      const { orgId } = req.user;
      const rows = await pool.query(
        `SELECT id, slug, status, result, error, run_at, completed_at
           FROM agent_runs
          WHERE org_id = $1 AND slug = $2
          ORDER BY run_at DESC
          LIMIT 20`,
        [orgId, slug]
      );
      res.json(rows.rows);
    } catch (err) {
      console.error(`[${slug}] history error:`, err.message);
      res.status(500).json({ error: 'Failed to load history' });
    }
  });

  return router;
}

module.exports = { createAgentRoute, extractToolData, extractSuggestions };
