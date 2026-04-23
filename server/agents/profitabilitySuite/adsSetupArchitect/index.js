'use strict';

const { agentOrchestrator } = require('../../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../../platform/AgentConfigService');
const { adsSetupArchitectTools, TOOL_SLUG } = require('./tools');
const { buildSystemPrompt } = require('./prompt');

async function runAdsSetupArchitect(context) {
  const { emit } = context;

  const adminConfig = Object.keys(context.adminConfig ?? {}).length > 0
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

  const model      = context.req?.body?.model || adminConfig.model || 'claude-sonnet-4-6';
  const customerId = context.req?.body?.customerId ?? null;

  const userMessage =
    'Analyze the competitive landscape and design a comprehensive Google Ads setup blueprint for Diamond Plate Australia. ' +
    'Identify high-intent keywords, propose a campaign structure, and generate high-converting RSA copy based on the 10 competitors configured in the settings.';

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(adminConfig),
    userMessage,
    tools:         adsSetupArchitectTools,
    model,
    maxTokens:     adminConfig.max_tokens     ?? 8192,
    maxIterations: adminConfig.max_iterations ?? 20,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runAdsSetupArchitect };
