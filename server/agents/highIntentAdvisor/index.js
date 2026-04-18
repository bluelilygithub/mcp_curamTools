'use strict';

const { agentOrchestrator }                    = require('../../platform/AgentOrchestrator');
const AgentConfigService                        = require('../../platform/AgentConfigService');
const { pool }                                  = require('../../db');
const { highIntentAdvisorTools, TOOL_SLUG }    = require('./tools');
const { buildSystemPrompt }                    = require('./prompt');

async function runHighIntentAdvisor(context) {
  const { orgId, userId, emit, config = {} } = context;

  const adminConfig = await AgentConfigService.getAdminConfig(TOOL_SLUG);

  const todayDate = config.todayDate ?? new Date().toISOString().slice(0, 10);
  const timezone  = config.timezone  ?? 'UTC';

  const userMessage =
    `Today is ${todayDate} (timezone: ${timezone}).\n\n` +
    `Run the three-phase High Intent Advisor analysis for Diamond Plate Australia. ` +
    `Phase 1: review pending suggestions. Phase 2: gather current data. ` +
    `Phase 3: generate new evidence-backed suggestions.`;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config),
    userMessage,
    tools:         highIntentAdvisorTools,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 4096,
    maxIterations: adminConfig.max_iterations ?? 25,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { orgId, userId, toolSlug: TOOL_SLUG, customerId: null },
  });

  // ── Parse structured suggestions from agent output ────────────────────────
  const suggestionMatches = [...result.matchAll(/<suggestion>([\s\S]*?)<\/suggestion>/g)];

  let savedCount = 0;
  const runId = trace?.[0]?.runId ?? null;

  for (const match of suggestionMatches) {
    try {
      const raw = match[1].trim();
      const parsed = JSON.parse(raw);

      const { category, priority, suggestion_text, rationale, baseline_metrics } = parsed;

      if (!category || !priority || !suggestion_text || !rationale) continue;

      const validCategories = ['keyword', 'budget', 'landing_page', 'audience', 'search_term', 'device', 'scheduling'];
      const validPriorities = ['high', 'medium', 'low'];

      if (!validCategories.includes(category)) continue;
      if (!validPriorities.includes(priority)) continue;

      await pool.query(
        `INSERT INTO agent_suggestions
           (org_id, run_id, slug, category, priority, suggestion_text, rationale, baseline_metrics)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          orgId,
          runId,
          TOOL_SLUG,
          category,
          priority,
          suggestion_text,
          rationale,
          JSON.stringify(baseline_metrics ?? {}),
        ]
      );

      savedCount++;
    } catch (_parseErr) {
      // Malformed suggestion block — skip without failing the run
    }
  }

  if (emit) emit(`Run complete — ${savedCount} suggestion${savedCount === 1 ? '' : 's'} saved.`);

  const summaryText =
    `High Intent Advisor run complete. ` +
    `${savedCount} new suggestion${savedCount === 1 ? '' : 's'} generated and saved. ` +
    `See the advisor page to review and act on suggestions.`;

  return { result: summaryText, trace, tokensUsed };
}

module.exports = { runHighIntentAdvisor };
