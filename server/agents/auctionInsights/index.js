'use strict';

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { auctionInsightsTools, TOOL_SLUG } = require('./tools');
const { buildSystemPrompt } = require('./prompt');

async function runAuctionInsights(context) {
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

  const customerId = req?.body?.customerId ?? null;

  const userMessage =
    `Analyse auction competition for Diamond Plate Australia from ${startDate} to ${endDate}. ` +
    'Identify which competitors are most aggressively bidding in the same auctions, ' +
    'and where Diamond Plate is losing impression share to rank vs budget.';

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(),
    userMessage,
    tools:         auctionInsightsTools,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 4096,
    maxIterations: adminConfig.max_iterations ?? 6,
    onStep:        emit,
    context:       { ...context, startDate, endDate, toolSlug: TOOL_SLUG, customerId },
  });

  return { result, trace, tokensUsed };
}

module.exports = { runAuctionInsights };
