'use strict';

/**
 * anthropic.js — Anthropic Claude provider adapter for AgentOrchestrator.
 *
 * Wraps the Anthropic SDK and normalises the response into the provider-neutral
 * format expected by AgentOrchestrator:
 *
 *   chat(params) → { content, stop_reason, usage }
 *
 *   content: [{ type: 'text'|'thinking'|'tool_use', text?, thinking?, id?, name?, input? }]
 *   stop_reason: 'end_turn' | 'tool_use'
 *   usage: { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }
 *
 * Message format (input):
 *   Anthropic-native. tool_use / tool_result content blocks are passed through as-is.
 */

const Anthropic = require('@anthropic-ai/sdk');

let _client;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

/**
 * Send a chat request and return a normalised response.
 *
 * @param {object} params
 * @param {string} params.model
 * @param {number} params.max_tokens
 * @param {string} params.system
 * @param {Array}  params.messages
 * @param {Array}  [params.tools]
 * @param {object} [params.thinking]
 * @returns {Promise<{ content, stop_reason, usage }>}
 */
async function chat({ model, max_tokens, system, messages, tools, thinking }) {
  const apiParams = { model, max_tokens, system, messages };
  if (tools?.length) apiParams.tools = tools;
  if (thinking?.enabled) {
    apiParams.thinking = { type: 'enabled', budget_tokens: thinking.budgetTokens ?? 10000 };
  }

  const response = await getClient().messages.create(apiParams);

  return {
    content:     response.content,
    stop_reason: response.stop_reason,
    usage: {
      input_tokens:                response.usage?.input_tokens                ?? 0,
      output_tokens:               response.usage?.output_tokens               ?? 0,
      cache_read_input_tokens:     response.usage?.cache_read_input_tokens     ?? 0,
      cache_creation_input_tokens: response.usage?.cache_creation_input_tokens ?? 0,
    },
  };
}

module.exports = { chat };
