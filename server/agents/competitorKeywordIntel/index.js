'use strict';

/**
 * Competitor Keyword Intel agent — runFn entry point.
 *
 * Uses the Google Ads Keyword Plan Idea Service to identify competitor keywords
 * and gaps for Diamond Plate Australia's graphene ceramic coating market.
 */

const { agentOrchestrator }  = require('../../platform/AgentOrchestrator');
const AgentConfigService     = require('../../platform/AgentConfigService');
const { competitorKeywordIntelTools, TOOL_SLUG } = require('./tools');
const { buildSystemPrompt }  = require('./prompt');

async function runCompetitorKeywordIntel(context) {
  const { emit } = context;

  const adminConfig = await AgentConfigService.getAdminConfig(TOOL_SLUG);
  const customerId  = context.req?.body?.customerId ?? null;

  const userMessage =
    'Analyse the keyword landscape for Diamond Plate Australia. ' +
    'Check our own active keywords, expand from seed terms, and pull keyword ideas from ' +
    'the top 3 competitors. Identify gaps — high-value keywords we are not bidding on ' +
    'that competitors own, with a focus on graphene-specific and location-based opportunities.';

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(),
    userMessage,
    tools:         competitorKeywordIntelTools,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 6144,
    maxIterations: adminConfig.max_iterations ?? 10,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runCompetitorKeywordIntel };
