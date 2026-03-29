'use strict';

/**
 * AgentOrchestrator — platform-level ReAct loop engine.
 *
 * Tool-agnostic: nothing in this file knows about any specific domain.
 * Shared by every agent in MCP_curamTools.
 *
 * Usage:
 *   const { agentOrchestrator } = require('../platform/AgentOrchestrator');
 *   const { result, trace, iterations, tokensUsed } = await agentOrchestrator.run({ ... });
 *
 * runFn in createAgentRoute receives context.emit — pass it as onStep so mid-run
 * budget checks can fire on each iteration.
 */

const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL          = 'claude-sonnet-4-6';
const MAX_ITERATIONS_HARD_CAP = 20;

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
  constructor() {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  /**
   * Execute a ReAct loop: call Claude → parse tool calls → execute tools →
   * feed results back → repeat until no tool calls or maxIterations reached.
   *
   * @param {object}   params
   * @param {string}   params.systemPrompt          — System prompt
   * @param {string}   params.userMessage           — Initial user message
   * @param {Array}    [params.tools=[]]            — Tool definitions: { name, description,
   *                                                  input_schema, execute(input, context) }
   *                                                  execute() is stripped before sending to Claude.
   * @param {number}   [params.maxIterations=10]    — Max loop iterations. Clamped to 20.
   * @param {Function} [params.onStep]              — Optional callback(text, tokensUsed) called
   *                                                  after each step — maps to createAgentRoute's emit.
   * @param {object}   params.context               — REQUIRED. Must contain orgId.
   *                                                  Passed through to every tool.execute() call.
   * @param {string}   [params.model]               — Claude model ID.
   * @param {number}   [params.maxTokens=8192]      — Max output tokens per Claude response.
   * @param {object}   [params.thinking]            — Extended thinking.
   * @param {boolean}  [params.thinking.enabled=false]
   * @param {number}   [params.thinking.budgetTokens=10000]
   *
   * @returns {Promise<{ result: { summary: string }, trace: Array, iterations: number, tokensUsed: object }>}
   * @throws  {AgentError}
   */
  async run({
    systemPrompt,
    userMessage,
    tools = [],
    maxIterations = 10,
    onStep = null,
    context,
    model = DEFAULT_MODEL,
    maxTokens = 8192,
    thinking = { enabled: false, budgetTokens: 10000 },
  }) {
    if (!context?.orgId) {
      throw new AgentError(
        'context.orgId is required — tool executions must always be org-scoped',
        { iterations: 0, trace: [] }
      );
    }

    const capped = Math.min(maxIterations, MAX_ITERATIONS_HARD_CAP);

    // Strip execute from tool defs before sending to Anthropic
    const anthropicTools = tools.length > 0
      ? tools.map(({ execute: _exec, requiredPermissions: _p, toolSlug: _s, ...schema }) => schema)
      : undefined;

    const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]));

    const messages  = [{ role: 'user', content: userMessage }];
    const trace     = [];
    const tokensUsed = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

    for (let iteration = 1; iteration <= capped; iteration++) {
      const apiParams = {
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      };

      if (anthropicTools) apiParams.tools = anthropicTools;

      if (thinking?.enabled) {
        apiParams.thinking = {
          type:          'enabled',
          budget_tokens: thinking.budgetTokens ?? 10000,
        };
      }

      let response;
      try {
        response = await this.anthropic.messages.create(apiParams);
      } catch (err) {
        console.error('[AgentOrchestrator] Anthropic API error', {
          error: err.message, iteration, model, orgId: context.orgId,
        });
        throw new AgentError(
          `Claude API error on iteration ${iteration}: ${err.message}`,
          { iterations: iteration, trace, cause: err }
        );
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

module.exports = { AgentOrchestrator, AgentError, agentOrchestrator };
