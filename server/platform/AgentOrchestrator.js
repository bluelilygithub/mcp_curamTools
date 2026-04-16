'use strict';

/**
 * AgentOrchestrator — platform-level ReAct loop engine.
 *
 * Tool-agnostic: nothing in this file knows about any specific domain.
 * Provider-agnostic: model selection routes to the correct provider adapter
 * (currently Anthropic; Gemini stub in providers/gemini.js).
 * Shared by every agent in MCP_curamTools.
 *
 * Usage:
 *   const { agentOrchestrator } = require('../platform/AgentOrchestrator');
 *   const { result, trace, iterations, tokensUsed } = await agentOrchestrator.run({ ... });
 *
 * runFn in createAgentRoute receives context.emit — pass it as onStep so mid-run
 * budget checks can fire on each iteration.
 */

const DEFAULT_MODEL           = 'claude-sonnet-4-6';
const MAX_ITERATIONS_HARD_CAP = 20;

// ─── Provider selection ───────────────────────────────────────────────────────

function getProvider(model) {
  return require('./providerRegistry').getAdapter(model ?? '');
}

// ─── AgentError ───────────────────────────────────────────────────────────────

/**
 * Thrown by AgentOrchestrator. Always includes the partial trace and iteration
 * count so createAgentRoute can persist a meaningful error record.
 */
class AgentError extends Error {
  constructor(message, { iterations, trace, cause } = {}) {
    super(message);
    this.name       = 'AgentError';
    this.iterations = iterations ?? 0;
    this.trace      = trace      ?? [];
    if (cause !== undefined) this.cause = cause;
  }
}

// ─── AgentOrchestrator ────────────────────────────────────────────────────────

class AgentOrchestrator {
  /**
   * Execute a ReAct loop: call model → parse tool calls → execute tools →
   * feed results back → repeat until no tool calls or maxIterations reached.
   *
   * @param {object}   params
   * @param {string}   params.systemPrompt          — System prompt
   * @param {string}   params.userMessage           — Initial user message
   * @param {Array}    [params.conversationHistory] — Prior turns: [{ role, content }].
   *                                                  Unknown fields (e.g. toolCalls) are stripped
   *                                                  before sending to the provider.
   * @param {Array}    [params.tools=[]]            — Tool definitions: { name, description,
   *                                                  input_schema, execute(input, context) }
   *                                                  execute() is stripped before sending to model.
   * @param {number}   [params.maxIterations=10]    — Max loop iterations. Clamped to 20.
   * @param {Function} [params.onStep]              — Optional callback(text, tokensUsed) called
   *                                                  after each step.
   * @param {object}   params.context               — REQUIRED. Must contain orgId.
   *                                                  Passed through to every tool.execute() call.
   * @param {string}   [params.model]               — Model ID. Prefix determines provider:
   *                                                  'claude-*' → Anthropic, 'gemini-*' → Gemini.
   * @param {number}   [params.maxTokens=8192]      — Max output tokens per model response.
   * @param {object}   [params.thinking]            — Extended thinking config.
   * @param {boolean}  [params.thinking.enabled=false]
   * @param {number}   [params.thinking.budgetTokens=10000]
   * @param {string}   [params.fallbackModel]       — Optional. If the primary model fails on
   *                                                  iteration 1, retry once with this model.
   *
   * @returns {Promise<{ result: { summary: string }, trace: Array, iterations: number, tokensUsed: object }>}
   * @throws  {AgentError}
   */
  async run({
    systemPrompt,
    userMessage,
    conversationHistory = [],
    tools = [],
    maxIterations = 10,
    onStep = null,
    context,
    model = DEFAULT_MODEL,
    maxTokens = 8192,
    thinking = { enabled: false, budgetTokens: 10000 },
    fallbackModel = null,
  }) {
    if (!context?.orgId) {
      throw new AgentError(
        'context.orgId is required — tool executions must always be org-scoped',
        { iterations: 0, trace: [] }
      );
    }

    const capped   = Math.min(maxIterations, MAX_ITERATIONS_HARD_CAP);
    const provider = getProvider(model);

    // Strip execute + meta fields from tool defs before sending to model
    const providerTools = tools.length > 0
      ? tools.map(({ execute: _e, requiredPermissions: _p, toolSlug: _s, ...schema }) => schema)
      : undefined;

    const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]));

    // Strip any non-standard fields from stored history before passing to provider
    const cleanHistory = conversationHistory.map(({ role, content }) => ({ role, content }));

    const messages = cleanHistory.length > 0
      ? [...cleanHistory, { role: 'user', content: userMessage }]
      : [{ role: 'user', content: userMessage }];

    const trace      = [];
    const tokensUsed = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

    for (let iteration = 1; iteration <= capped; iteration++) {
      let response;
      try {
        response = await provider.chat({
          model,
          max_tokens: maxTokens,
          system:     systemPrompt,
          messages,
          tools:      providerTools,
          thinking,
        });
      } catch (err) {
        if (iteration === 1 && fallbackModel && fallbackModel !== model) {
          const alertMsg = `⚠ Model "${model}" failed (${err.message}). Switching to fallback: "${fallbackModel}".`;
          console.warn('[AgentOrchestrator] provider fallback', {
            primaryModel: model, fallbackModel, error: err.message, orgId: context.orgId,
          });
          if (typeof onStep === 'function') onStep(alertMsg, tokensUsed);

          try {
            response = await getProvider(fallbackModel).chat({
              model:      fallbackModel,
              max_tokens: maxTokens,
              system:     systemPrompt,
              messages,
              tools:      providerTools,
              thinking,
            });
            trace.push({
              iteration: 0,
              type:      'fallback',
              from:      model,
              to:        fallbackModel,
              reason:    err.message,
              timestamp: new Date().toISOString(),
            });
            model = fallbackModel;
          } catch (fallbackErr) {
            console.error('[AgentOrchestrator] fallback also failed', {
              fallbackModel, error: fallbackErr.message, orgId: context.orgId,
            });
            throw new AgentError(
              `Primary model "${model}" and fallback "${fallbackModel}" both failed. Primary: ${err.message}. Fallback: ${fallbackErr.message}`,
              { iterations: iteration, trace, cause: fallbackErr }
            );
          }
        } else {
          console.error('[AgentOrchestrator] provider error', {
            error: err.message, iteration, model, orgId: context.orgId,
          });
          throw new AgentError(
            `Model API error on iteration ${iteration}: ${err.message}`,
            { iterations: iteration, trace, cause: err }
          );
        }
      }

      // Accumulate tokens
      const u = response.usage ?? {};
      tokensUsed.input      += u.input_tokens                ?? 0;
      tokensUsed.output     += u.output_tokens               ?? 0;
      tokensUsed.cacheRead  += u.cache_read_input_tokens     ?? 0;
      tokensUsed.cacheWrite += u.cache_creation_input_tokens ?? 0;

      // Build trace step
      const step = {
        iteration,
        timestamp:   new Date().toISOString(),
        thinking:    null,
        text:        null,
        toolCalls:   [],
        toolResults: [],
      };

      for (const block of response.content) {
        if (block.type === 'thinking') {
          step.thinking = block.thinking;
        } else if (block.type === 'text') {
          step.text = (step.text ?? '') + block.text;
        } else if (block.type === 'tool_use') {
          step.toolCalls.push({ id: block.id, name: block.name, input: block.input });
        }
      }

      // Terminal: no tool calls
      if (response.stop_reason !== 'tool_use' || step.toolCalls.length === 0) {
        trace.push(step);
        if (typeof onStep === 'function') {
          onStep(`Completed in ${iteration} iteration${iteration === 1 ? '' : 's'}.`, tokensUsed);
        }
        return { result: { summary: step.text ?? '' }, trace, iterations: iteration, tokensUsed };
      }

      // Execute tools
      const toolResultBlocks = [];

      for (const toolCall of step.toolCalls) {
        const t0 = Date.now();
        let result;

        const tool = toolMap[toolCall.name];
        if (!tool) {
          console.warn('[AgentOrchestrator] unknown tool:', toolCall.name);
          result = { error: `Tool not found: ${toolCall.name}` };
        } else {
          try {
            if (typeof onStep === 'function') onStep(`Running ${toolCall.name}…`, tokensUsed);
            result = await tool.execute(toolCall.input, context);
          } catch (err) {
            console.warn('[AgentOrchestrator] tool error', { tool: toolCall.name, error: err.message });
            result = { error: err.message ?? 'Tool execution failed' };
          }
        }

        const durationMs = Date.now() - t0;
        step.toolResults.push({ id: toolCall.id, name: toolCall.name, result, durationMs });

        toolResultBlocks.push({
          type:        'tool_result',
          tool_use_id: toolCall.id,
          content:     JSON.stringify(result),
        });
      }

      // Preserve full response content (including thinking blocks) per Anthropic API requirement
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user',      content: toolResultBlocks });

      trace.push(step);
      if (typeof onStep === 'function') onStep(`Iteration ${iteration} complete.`, tokensUsed);
    }

    throw new AgentError(
      `Agent exceeded maximum iterations (${capped})`,
      { iterations: capped, trace }
    );
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const agentOrchestrator = new AgentOrchestrator();

module.exports = { AgentOrchestrator, AgentError, agentOrchestrator, getProvider };
