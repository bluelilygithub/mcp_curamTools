'use strict';

/**
 * Ads Bounce Analysis agent — runFn entry point.
 *
 * Identifies paid keywords sending traffic to high-bounce landing pages,
 * broken down by device type.
 */

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { adsBounceAnalysisTools, TOOL_SLUG } = require('./tools');
const { buildSystemPrompt } = require('./prompt');

async function runAdsBounceAnalysis(context) {
  const { orgId, req, emit } = context;

  const adminConfig   = await AgentConfigService.getAdminConfig(TOOL_SLUG);
  const monitorConfig = await AgentConfigService.getAgentConfig(orgId, 'google-ads-monitor');

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

  const customerId = req?.body?.customerId ?? null;

  const userMessage =
    `Analyse paid keyword bounce behaviour for the period ${startDate} to ${endDate}. ` +
    'Identify which landing pages are failing paid traffic and what device the visitors were using.';

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(monitorConfig),
    userMessage,
    tools:         adsBounceAnalysisTools,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 4096,
    maxIterations: adminConfig.max_iterations ?? 6,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runAdsBounceAnalysis };
