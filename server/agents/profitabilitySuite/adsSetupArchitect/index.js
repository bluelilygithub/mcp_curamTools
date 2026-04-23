'use strict';

const { agentOrchestrator } = require('../../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../../platform/AgentConfigService');
const { adsSetupArchitectTools, TOOL_SLUG } = require('./tools');
const { buildSystemPrompt } = require('./prompt');

async function runAdsSetupArchitect(context) {
  const { emit } = context;

  const adminConfig = await AgentConfigService.getAdminConfig(TOOL_SLUG);
  const customerId  = context.req?.body?.customerId ?? null;

  const userMessage = 
    'Analyze the competitive landscape and design a comprehensive Google Ads setup blueprint for Diamond Plate Australia. ' +
    'Identify high-intent keywords, propose a campaign structure, and generate high-converting RSA copy based on the 10 competitors configured in the settings.';

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(),
    userMessage,
    tools:         adsSetupArchitectTools,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 8192,
    maxIterations: adminConfig.max_iterations ?? 15, // High iterations needed for multiple competitor analysis
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runAdsSetupArchitect };
