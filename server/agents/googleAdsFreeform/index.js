'use strict';

/**
 * Google Ads Freeform agent — runFn entry point.
 *
 * Answers ad-hoc questions about Google Ads data. The user's question is
 * passed in req.body.question. The agent selects the minimum tools needed.
 *
 * context shape (from createAgentRoute):
 *   { orgId, userId, config, adminConfig, req, emit }
 *
 * req.body may contain:
 *   { question }    — required: the user's question
 *   { customerId }  — optional: target a specific customer account
 *   { startDate, endDate } or { days } — optional date range
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { googleAdsFreeformTools, TOOL_SLUG } = require('./tools');
const { buildSystemPrompt } = require('./prompt');

async function runGoogleAdsFreeform(context) {
  const { orgId, req, emit } = context;

  const config = Object.keys(context.config ?? {}).length > 0
    ? context.config
    : await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);

  const adminConfig = Object.keys(context.adminConfig ?? {}).length > 0
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

  const question   = req?.body?.question   ?? 'Give me an overview of account performance.';
  const customerId = req?.body?.customerId ?? null;

  // Optional date range forwarded to tool context
  let startDate = req?.body?.startDate ?? null;
  let endDate   = req?.body?.endDate   ?? null;
  if (!startDate || !endDate) {
    const days  = req?.body?.days ?? 30;
    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    startDate = start.toISOString().slice(0, 10);
    endDate   = end.toISOString().slice(0, 10);
  }

  const customerConfig = customerId
    ? await AgentConfigService.getAgentConfigForCustomer(orgId, TOOL_SLUG, customerId)
    : config;

  const customerVars = customerId
    ? { customer_id: customerId, customer_name: customerConfig.customer_name ?? customerId }
    : {};

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(customerConfig, customerVars),
    userMessage:   question,
    tools:         googleAdsFreeformTools,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 8192,
    maxIterations: adminConfig.max_iterations ?? 12,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runGoogleAdsFreeform };
