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
 *   async (context) => { result, trace?, tokensUsed, promptVersion? }
 *   context: { orgId, userId, config, adminConfig, req }
 *   Optional `promptVersion` (short string) is persisted on `agent_runs.result.prompt_version` when set.
 *   See `server/platform/promptVersions.js` and `knowledge_base/core/PROMPT_VERSIONING.md`.
 */

const express = require('express');
const { pool } = require('../db');
const { persistRun } = require('./persistRun');
const { requireAuth } = require('../middleware/requireAuth');
const { createRateLimiter } = require('../middleware/rateLimiter');
const AgentConfigService = require('./AgentConfigService');
const CostGuardService = require('../services/CostGuardService');
const { logUsage } = require('../services/UsageLogger');
const EmbeddingService = require('../services/EmbeddingService');
const { loadLessonsForAgent, proposeLessonFromRun } = require('../services/LessonRepositoryService');
const { canRunAgent } = require('../services/PermissionService');
const ReportDependencyService = require('./ReportDependencyService');
const { validateToolData } = require('./validateToolData');
const { mergePromptVersionIntoResult } = require('./promptVersions');
const { summariseDataGapSources, buildDataGapReview } = require('./dataGapEvidence');
const {
  resolveTrustContract,
  summariseTrustContract,
  buildTrustPromptContext,
} = require('./agentTrustContract');

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

function createProgressEmitter({ res, progressLog }) {
  const emit = (type, payload) => {
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
    if (type === 'progress') {
      progressLog.push({ ts: new Date().toISOString(), text: payload.text });
    }
  };

  const done = () => {
    res.write('data: [DONE]\n\n');
    res.end();
  };

  return { emit, done };
}

async function loadRunConfig({ slug, orgId }) {
  const adminConfig = await AgentConfigService.getResolvedAdminConfig(slug, orgId);
  if (!adminConfig.model) {
    console.warn(`[${slug}] No per-agent model and no org default model (orgId=${orgId}) — check Settings > Models`);
  }

  let agentConfig;
  try {
    agentConfig = await AgentConfigService.getAgentConfig(orgId, slug);
  } catch {
    agentConfig = {};
  }

  return { adminConfig, agentConfig };
}

async function checkAgentAccess({ userId, requiredPermission, allowedRoles }) {
  const permitted = await canRunAgent(userId, requiredPermission, allowedRoles);
  return {
    permitted,
    reason: permitted ? null : 'Insufficient permissions.',
  };
}

async function startAgentRun({ slug, orgId, startTime }) {
  return persistRun({ slug, orgId, status: 'running', runAt: startTime });
}

async function resolveRunDependencies({ slug, orgId, userId, selections, trustContract, emit }) {
  try {
    const resolved = await ReportDependencyService.resolveDependencies({
      slug,
      orgId,
      userId,
      selections,
      definitions: trustContract.dependencies,
    });
    const reportDependencies = resolved.dependencies;
    const reportDependencyWarnings = resolved.warnings;
    const reportDependencyContext = ReportDependencyService.buildDependencyPromptContext(
      reportDependencies,
      reportDependencyWarnings
    );

    for (const dependency of reportDependencies) {
      emit('progress', { text: `Using ${dependency.label} from ${new Date(dependency.runAt).toLocaleDateString('en-AU')} as report dependency.` });
    }
    for (const warning of reportDependencyWarnings) {
      if (warning.reason === 'stale') {
        emit('progress', { text: `${warning.label} dependency is ${warning.ageDays} days old; proceeding with caution.` });
      }
      if (warning.reason === 'needs_review') {
        emit('progress', { text: `${warning.label} dependency is marked needs_review; inherited reasoning is unverified.` });
      }
    }

    return { reportDependencyContext, reportDependencies, reportDependencyWarnings };
  } catch (depErr) {
    if (depErr.name === 'ReportDependencyError') throw depErr;
    console.warn(`[${slug}] report dependency resolution skipped:`, depErr.message);
    return {
      reportDependencyContext: '',
      reportDependencies: [],
      reportDependencyWarnings: [],
    };
  }
}

async function loadBudgetContext({ slug, orgId, adminConfig }) {
  const budgetContext = {
    maxTaskBudgetAud: adminConfig.max_task_budget_aud ?? null,
    maxDailyBudgetAud: null,
    dailyOrgSpendAud: 0,
  };

  try {
    const orgBudget = await AgentConfigService.getOrgBudgetSettings(orgId);
    budgetContext.maxDailyBudgetAud = orgBudget.max_daily_org_budget_aud ?? null;
    if (budgetContext.maxDailyBudgetAud != null) {
      budgetContext.dailyOrgSpendAud = await CostGuardService.getDailyOrgSpendAud(orgId);
      // Pre-flight: if org is already over daily budget, abort before the run starts
      CostGuardService.check({
        taskCostAud: 0,
        maxTaskBudgetAud: null,
        dailyOrgSpendAud: budgetContext.dailyOrgSpendAud,
        maxDailyBudgetAud: budgetContext.maxDailyBudgetAud,
      });
    }
  } catch (budgetErr) {
    if (budgetErr.name === 'BudgetExceededError') throw budgetErr;
    // Non-budget errors loading budget config are non-fatal — proceed without limit
    console.error(`[${slug}] budget config load error:`, budgetErr.message);
  }

  return budgetContext;
}

function createBudgetAwareEmitter({ emit, adminConfig, budgetContext, taskCostTracker }) {
  return (text, partialTokensUsed) => {
    emit('progress', { text });
    if (partialTokensUsed) {
      taskCostTracker.value += CostGuardService.computeCostAud(partialTokensUsed, adminConfig.model, adminConfig.model_pricing);
      CostGuardService.check({
        taskCostAud: taskCostTracker.value,
        maxTaskBudgetAud: budgetContext.maxTaskBudgetAud,
        dailyOrgSpendAud: budgetContext.dailyOrgSpendAud,
        maxDailyBudgetAud: budgetContext.maxDailyBudgetAud,
      });
    }
  };
}

function buildRunContext({
  orgId,
  userId,
  agentConfig,
  adminConfig,
  runtimePromptContext,
  reportDependencies,
  reportDependencyWarnings,
  reportDependencyContext,
  trustContract,
  req,
  emit,
}) {
  return {
    orgId,
    userId,
    config: agentConfig,
    adminConfig,
    runtimePromptContext,
    reportDependencies,
    reportDependencyWarnings,
    reportDependencyContext,
    trustContract,
    req,
    emit,
  };
}

function summariseTrace(trace = []) {
  if (!Array.isArray(trace)) {
    return { iterations: 0, tool_calls: [], fallback_events: [] };
  }

  const fallbackEvents = trace
    .filter((step) => step?.type === 'fallback')
    .map((step) => ({
      from: step.from ?? null,
      to: step.to ?? null,
      reason: step.reason ?? null,
      timestamp: step.timestamp ?? null,
    }));

  const toolCalls = trace.flatMap((step) => (
    Array.isArray(step?.toolResults)
      ? step.toolResults.map((tool) => ({
          name: tool.name,
          durationMs: tool.durationMs ?? null,
          fromCache: tool.fromCache === true,
          status: tool.result?.error ? 'error' : 'ok',
        }))
      : []
  ));

  return {
    iterations: trace.filter((step) => step && step.type !== 'fallback').length,
    tool_calls: toolCalls,
    fallback_events: fallbackEvents,
  };
}

function buildResultPayload({
  slug,
  result,
  trace,
  tokensUsed,
  adminConfig,
  req,
  progressLog,
  reportDependencies,
  reportDependencyWarnings,
  trustContract,
  taskCostAud,
  promptVersion,
}) {
  const toolData   = extractToolData(trace);
  const resultData = result?.data ?? {};
  const { data_gap_sources: resultDataGapSources = {}, ...persistableResultData } = resultData;
  const dataGapSources = {
    ...summariseDataGapSources(toolData),
    ...resultDataGapSources,
  };
  const suggestions = extractSuggestions(result?.summary ?? '');
  const dataGapCheck = buildDataGapReview({
    summary: result?.summary ?? '',
    evidenceSources: dataGapSources,
    trustContract,
  });
  const boundsFailed = [
    ...validateToolData(toolData),
    ...dataGapCheck.boundsFailed,
    ...(result?.boundsFailed ?? []),
  ];
  const runStatus  = boundsFailed.length > 0 ? 'needs_review' : 'complete';

  const resultPayload = mergePromptVersionIntoResult(
    {
      summary:   result?.summary ?? '',
      data:      { ...toolData, ...persistableResultData },
      suggestions,
      ...(dataGapCheck.applies && {
        data_gaps: dataGapCheck.dataGaps,
        data_gap_review: dataGapCheck.dataGapReview,
      }),
      tokensUsed: tokensUsed ?? {},
      costAud:   taskCostAud,
      model:     adminConfig.model ?? null,
      model_source: adminConfig.model_source ?? null,
      fallback_model: adminConfig.fallback_model ?? null,
      fallback_model_source: adminConfig.fallback_model_source ?? null,
      required_capabilities: adminConfig.required_capabilities ?? [],
      model_capabilities: adminConfig.model_capabilities ?? null,
      model_pricing: adminConfig.model_pricing ?? null,
      missing_capabilities: adminConfig.missing_capabilities ?? [],
      capability_warnings: adminConfig.capability_warnings ?? [],
      fallback_capability_warnings: adminConfig.fallback_capability_warnings ?? [],
      trust_contract: summariseTrustContract(trustContract),
      trace_summary: summariseTrace(trace),
      startDate: req.body.startDate ?? null,
      endDate:   req.body.endDate   ?? null,
      progressLog,
      ...(reportDependencies.length > 0 && {
        report_dependencies: reportDependencies.map(({ summary: _summary, ...dependency }) => dependency),
        report_dependency_warnings: reportDependencyWarnings,
      }),
      // Capture prompt/response for Decision Log display
      prompt_text:  result?.prompt_text  ?? null,
      response_text: result?.response_text ?? null,
      ...(boundsFailed.length > 0 && { boundsFailed }),
    },
    promptVersion,
  );

  return { resultPayload, runStatus };
}

async function finalizeAgentRun({
  slug,
  orgId,
  userId,
  runId,
  runStatus,
  resultPayload,
  tokensUsed,
  adminConfig,
  taskCostAud,
}) {
  await persistRun({ slug, orgId, status: runStatus, result: resultPayload, runId });

  // Reflection write-back is review-only: proposals are saved under-review
  // and never injected into future runs until an admin activates them.
  proposeLessonFromRun({
    agentId: slug,
    organisationId: orgId,
    runId,
    summary: resultPayload.summary,
  }).catch((e) => console.warn(`[${slug}] lesson proposal skipped:`, e.message));

  logUsage({ orgId, userId, slug, modelId: adminConfig.model, tokensUsed: tokensUsed ?? {}, costAud: taskCostAud })
    .catch(err => console.error(`[${slug}] usage log error:`, err.message));

  // Auto-index summary for RAG — fire and forget, never blocks the response
  if (resultPayload.summary && process.env.OPENAI_API_KEY) {
    EmbeddingService.embedAndStore({
      orgId,
      sourceType: 'agent_run',
      sourceId:   runId,
      content:    resultPayload.summary,
      metadata: {
        slug,
        run_at:    new Date().toISOString(),
        startDate: resultPayload.startDate ?? null,
        endDate:   resultPayload.endDate   ?? null,
      },
    }).catch((e) => console.warn(`[${slug}] embedding failed (non-fatal):`, e.message));
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * @param {string}   slug               — agent identifier (e.g. 'google-ads-monitor')
 * @param {Function} runFn              — async (context) => { result, trace?, tokensUsed? }
 * @param {string}   requiredPermission — role or capability; org_admin always satisfies the check
 * @param {number}   [rateLimit=5]      — max runs per user per 5-minute window
 * @param {object|false} [trust]        — optional trust contract override; false disables Data Gaps enforcement
 */
function createAgentRoute({ slug, runFn, requiredPermission, rateLimit = 5, trust = {} }) {
  const router = express.Router();
  const trustContract = resolveTrustContract(slug, trust);

  // N agent runs per user per 5 minutes — default 5 for expensive report agents
  const runRateLimiter = createRateLimiter({ windowMs: 5 * 60_000, max: rateLimit });

  // ── POST /run — SSE stream ───────────────────────────────────────────────
  router.post(
    '/run',
    requireAuth,
    runRateLimiter,
    async (req, res) => {
      // SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const { orgId, id: userId } = req.user;
      const startTime = new Date();

      // Accumulate progress messages for auditing — saved into the run record on completion
      const progressLog = [];
      const { emit, done } = createProgressEmitter({ res, progressLog });
      let runId;

      let adminConfig;
      let agentConfig;
      try {
        ({ adminConfig, agentConfig } = await loadRunConfig({ slug, orgId }));
      } catch (cfgErr) {
        emit('error', { error: 'Failed to load agent config' });
        await persistRun({ slug, orgId, status: 'error', error: cfgErr.message, runId });
        return done();
      }

      const access = await checkAgentAccess({
        userId,
        requiredPermission,
        allowedRoles: adminConfig.allowed_roles,
      });
      if (!access.permitted) {
        emit('error', { error: access.reason });
        return done();
      }

      if (!adminConfig.enabled) {
        emit('error', { error: 'Agent is currently disabled by an administrator.' });
        return done();
      }

      // Insert initial 'running' row only after config/access checks pass.
      try {
        runId = await startAgentRun({ slug, orgId, startTime });
      } catch (dbErr) {
        emit('error', { error: 'Failed to record run start' });
        return done();
      }

      let reportDependencyContext = '';
      let reportDependencies = [];
      let reportDependencyWarnings = [];
      try {
        ({
          reportDependencyContext,
          reportDependencies,
          reportDependencyWarnings,
        } = await resolveRunDependencies({
          slug,
          orgId,
          userId,
          selections: req.body.reportDependencies ?? req.body.report_dependency_run_ids ?? null,
          trustContract,
          emit,
        }));
      } catch (depErr) {
        emit('error', { error: depErr.message, details: depErr.details });
        await persistRun({ slug, orgId, status: 'error', error: depErr.message, runId });
        return done();
      }

      // Budget setup — load once, check as a pure function during the run
      let budgetContext;
      try {
        budgetContext = await loadBudgetContext({ slug, orgId, adminConfig });
      } catch (budgetErr) {
        emit('error', { error: budgetErr.message });
        await persistRun({ slug, orgId, status: 'error', error: budgetErr.message, runId });
        return done();
      }

      // Accumulated task cost tracker — updated by the emit callback below
      const taskCostTracker = { value: 0 };
      const agentEmit = createBudgetAwareEmitter({
        emit,
        adminConfig,
        budgetContext,
        taskCostTracker,
      });

      // Run the agent
      try {
        emit('progress', { text: 'Starting agent run…' });
        let runtimePromptContext = '';
        try {
          runtimePromptContext = [
            buildTrustPromptContext(trustContract),
            await loadLessonsForAgent(slug, orgId),
          ].filter(Boolean).join('\n\n');
        } catch (err) {
          console.warn(`[${slug}] lessons load skipped:`, err.message);
          runtimePromptContext = buildTrustPromptContext(trustContract);
        }

        const { result, trace, tokensUsed, promptVersion } = await runFn(buildRunContext({
          orgId,
          userId,
          agentConfig,
          adminConfig,
          runtimePromptContext,
          reportDependencies,
          reportDependencyWarnings,
          reportDependencyContext,
          trustContract,
          req,
          // Extended emit: agents may optionally pass tokensUsed to trigger mid-run budget checks.
          // Agents that don't pass tokensUsed still work — cost tracking simply won't accumulate mid-run.
          emit: agentEmit,
        }));

        // Post-run budget check using final tokensUsed (catches agents that don't emit partial costs)
        if (tokensUsed) {
          const finalCostAud = CostGuardService.computeCostAud(tokensUsed, adminConfig.model, adminConfig.model_pricing);
          taskCostTracker.value = Math.max(taskCostTracker.value, finalCostAud); // use final if higher than accumulated
          CostGuardService.check({
            taskCostAud: taskCostTracker.value,
            maxTaskBudgetAud: budgetContext.maxTaskBudgetAud,
            dailyOrgSpendAud: budgetContext.dailyOrgSpendAud,
            maxDailyBudgetAud: budgetContext.maxDailyBudgetAud,
          });
        }

        const { resultPayload, runStatus } = buildResultPayload({
          slug,
          result,
          trace,
          tokensUsed,
          adminConfig,
          req,
          progressLog,
          reportDependencies,
          reportDependencyWarnings,
          trustContract,
          taskCostAud: taskCostTracker.value,
          promptVersion,
        });

        await finalizeAgentRun({
          slug,
          orgId,
          userId,
          runId,
          runStatus,
          resultPayload,
          tokensUsed,
          adminConfig,
          taskCostAud: taskCostTracker.value,
        });

        // Include runId on the streamed payload so clients can PATCH review endpoints
        // before reloading from GET /demo/runs/:id (persisted result omits this envelope field).
        emit('result', { data: { ...resultPayload, runId } });
      } catch (runErr) {
        console.error(`[${slug}] run error:`, runErr.message);
        await persistRun({
          slug, orgId, status: 'error', error: runErr.message, runId,
          result: { progressLog },
        });
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

  // ── GET /dependencies ────────────────────────────────────────────────────
  router.get('/dependencies', requireAuth, async (req, res) => {
    try {
      const { orgId } = req.user;
      const status = await ReportDependencyService.getDependencyStatus({
        slug,
        orgId,
        definitions: trustContract.dependencies,
      });
      res.json(status);
    } catch (err) {
      console.error(`[${slug}] dependencies error:`, err.message);
      res.status(500).json({ error: 'Failed to load report dependencies' });
    }
  });

  return router;
}

module.exports = {
  createAgentRoute,
  extractToolData,
  extractSuggestions,
  createProgressEmitter,
  loadRunConfig,
  checkAgentAccess,
  startAgentRun,
  resolveRunDependencies,
  loadBudgetContext,
  createBudgetAwareEmitter,
  buildRunContext,
  buildResultPayload,
  finalizeAgentRun,
};
