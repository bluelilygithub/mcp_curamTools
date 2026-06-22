'use strict';

/**
 * Minimal agent — no MCP, no LLM. Demonstrates createAgentRoute + app-local module.
 *
 * POST /api/agents/starter-hello/run  { "message": "optional" }
 */

async function runStarterHello(context) {
  const { orgId, userId, req } = context;
  const message = typeof req?.body?.message === 'string' && req.body.message.trim()
    ? req.body.message.trim()
    : 'Hello from the starter app';

  return {
    result: {
      text: `Starter agent (org ${orgId}, user ${userId}): ${message}`,
      app:  'starter',
    },
    tokensUsed: 0,
  };
}

module.exports = { runStarterHello };
