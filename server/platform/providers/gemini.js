'use strict';

/**
 * gemini.js — Google Gemini provider adapter stub for AgentOrchestrator.
 *
 * TODO: implement when Gemini support is added to the platform.
 *
 * When implemented, this module must export a `chat(params)` function that:
 *   - Accepts the same params as the Anthropic provider (model, max_tokens, system,
 *     messages, tools, thinking)
 *   - Translates Anthropic-format messages and tool schemas into Gemini API format
 *   - Returns a normalised response: { content, stop_reason, usage }
 *     where content blocks follow the Anthropic-style type discriminant
 *     (type: 'text' | 'tool_use' | 'thinking')
 *
 * Relevant Gemini docs:
 *   https://ai.google.dev/api/generate-content
 *   https://ai.google.dev/api/caching  (for context caching — Gemini equivalent of prompt caching)
 *
 * Key translation points:
 *   - Gemini uses `contents[]` not `messages[]`
 *   - Gemini roles: 'user' | 'model' (not 'assistant')
 *   - Gemini tool format: `functionDeclarations[]` vs Anthropic `tools[]`
 *   - Gemini finish reason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' vs Anthropic 'end_turn' | 'tool_use'
 *   - Gemini function calls: `parts[].functionCall` vs Anthropic `tool_use` blocks
 */

async function chat(_params) {
  throw new Error(
    'Gemini provider is not yet implemented. ' +
    'Set adminConfig.model to a claude-* model ID until Gemini support is added.'
  );
}

module.exports = { chat };
