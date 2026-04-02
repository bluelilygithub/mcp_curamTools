'use strict';

const { agentOrchestrator }             = require('../../platform/AgentOrchestrator');
const AgentConfigService                = require('../../platform/AgentConfigService');
const { googleAdsStrategicReviewTools, TOOL_SLUG } = require('./tools');
const { buildSystemPrompt }             = require('./prompt');

async function runGoogleAdsStrategicReview(context) {
  const { req, emit } = context;

  const adminConfig = await AgentConfigService.getAdminConfig(TOOL_SLUG);

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

  const observations = (req?.body?.observations ?? '').trim();
  if (!observations) {
    throw new Error('No observations provided. Enter your strategic observations and try again.');
  }

  const customerId = req?.body?.customerId ?? null;

  const userMessage =
    `Date range: ${startDate} to ${endDate}\n\n` +
    `Strategic observations to review:\n\n${observations}`;

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(),
    userMessage,
    tools:         googleAdsStrategicReviewTools,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 6000,
    maxIterations: adminConfig.max_iterations ?? 8,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runGoogleAdsStrategicReview };
