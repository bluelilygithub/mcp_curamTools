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
 *
 * ── Prompt caching ────────────────────────────────────────────────────────────
 *
 * The system prompt is wrapped in a content block with cache_control: { type: 'ephemeral' }.
 * This tells Anthropic to cache the system prompt after the first call in a sequence.
 *
 * HOW IT WORKS:
 *   Anthropic's API uses a "prefix cache" keyed on the exact token sequence up to the
 *   cache_control marker. On the first call, Anthropic processes and stores the system
 *   prompt tokens. On subsequent calls within the TTL with the same prompt, those tokens
 *   are served from cache — the model doesn't re-process them.
 *
 * PRICING (Claude Sonnet):
 *   Normal input:       $3.00 / 1M tokens
 *   Cache write:        $3.75 / 1M tokens  (first call — 25% premium to store)
 *   Cache read:         $0.30 / 1M tokens  (subsequent calls — 90% discount)
 *   Cache TTL:          5 minutes (resets on each hit)
 *
 * WHY THIS MATTERS FOR REACT AGENTS:
 *   In a ReAct loop, the system prompt is re-sent on EVERY iteration. A 3,500-token
 *   system prompt across 5 iterations costs 17,500 tokens normally. With caching:
 *     - Iteration 1 (write):  3,500 × $3.75/1M = $0.013
 *     - Iterations 2–5 (read): 4 × 3,500 × $0.30/1M = $0.004
 *     - Total: ~$0.017  vs  $0.052 uncached  → 67% reduction on the system prompt portion
 *
 * WHY THIS MATTERS FOR THE CONVERSATION AGENT:
 *   Each new user message triggers a fresh ReAct loop. As long as turns happen within
 *   5 minutes of each other (typical for active use), the system prompt is read from
 *   cache on every iteration of every turn — not just within one turn.
 *
 * WHAT IS NOT CACHED HERE:
 *   - The messages array (conversation history + tool results) — this changes every call
 *     so it cannot be cached without more complex cache_control placement on message blocks.
 *   - Tool schemas — cached implicitly only if they appear before the cache_control marker
 *     (they don't in our current implementation).
 *
 * MINIMUM CACHEABLE SIZE:
 *   Anthropic requires at least 1,024 tokens to be eligible for caching (Claude Sonnet/Opus).
 *   All agent system prompts in this platform exceed this threshold.
 *
 * USAGE TRACKING:
 *   The normalised usage object returns cache_read_input_tokens and cache_creation_input_tokens
 *   separately. These are already stored in tokensUsed and logged via UsageLogger.
 *   In the conversation view, the ↑ token count shows input_tokens (non-cached reads);
 *   cache reads are a separate field — not currently shown in the UI but available in DB logs.
 */

const Anthropic = require('@anthropic-ai/sdk');

const CACHE_MIN_TOKENS = 1024; // Anthropic minimum; all our prompts exceed this

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
  // Wrap system prompt in a content block with cache_control.
  // This enables Anthropic's prefix cache — the system prompt tokens are stored
  // after the first call and served at 10% of normal price on subsequent calls
  // within the 5-minute TTL.
  //
  // Only applied when the system prompt is long enough to be worth caching.
  // Short prompts (< 1024 tokens) fall back to plain string format.
  const systemParam = system && system.length >= CACHE_MIN_TOKENS
    ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    : system;

  const apiParams = { model, max_tokens, system: systemParam, messages };

  // Cache tool schemas alongside the system prompt.
  // Anthropic's prefix cache treats the tool array as part of the static context prefix.
  // Adding cache_control to the LAST tool in the array marks the end of the cacheable
  // block — Anthropic caches everything from the start of the tools array up to that marker.
  //
  // This is safe because our tool arrays are defined statically (same order every call),
  // so the cache key is stable. A different tool count (e.g. conversation agent vs report
  // agent) produces a different cache key — each agent warms its own cache entry.
  //
  // Combined with system prompt caching, the total cached static input for the conversation
  // agent is ~6,800 tokens (3,500 system + 3,300 tools), saving ~80% on those tokens
  // across ReAct iterations.
  if (tools?.length) {
    const withCache = tools.map((t, i) =>
      i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t
    );
    apiParams.tools = withCache;
  }

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
