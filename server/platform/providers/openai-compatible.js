'use strict';

/**
 * openai-compatible.js — Factory for OpenAI Chat Completions-compatible providers.
 *
 * Used by: openai.js, mistral.js, deepseek.js, xai.js, groq.js.
 *
 * All these providers share the same request/response format — they differ only
 * in hostname, path, and the env var that holds the API key.
 *
 * Uses https.request throughout (fetch silently fails on Railway).
 *
 * Response is normalised to the platform-standard Anthropic format:
 *   { content: [...], stop_reason: string, usage: { input_tokens, output_tokens, ... } }
 *
 * Message conversion:
 *   The platform always passes Anthropic-native message arrays to provider.chat().
 *   This adapter converts them to OpenAI Chat format before sending and converts
 *   the response back to Anthropic format.
 */

const https = require('https');

// ── HTTP helper ───────────────────────────────────────────────────────────────

function httpsPost(hostname, apiPath, extraHeaders, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path:    apiPath,
        method:  'POST',
        headers: {
          'content-type':   'application/json',
          'content-length': Buffer.byteLength(bodyStr),
          ...extraHeaders,
        },
      },
      (resp) => {
        let data = '';
        resp.on('data', (c) => { data += c; });
        resp.on('end', () => {
          try { resolve({ status: resp.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: resp.statusCode, body: data }); }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── Anthropic → OpenAI format conversion ─────────────────────────────────────

/**
 * Convert Anthropic tool definitions to OpenAI function-calling format.
 * Anthropic: { name, description, input_schema }
 * OpenAI:    { type: 'function', function: { name, description, parameters } }
 */
function convertTools(tools) {
  if (!tools || !tools.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name:        t.name,
      description: t.description || '',
      parameters:  t.input_schema || { type: 'object', properties: {} },
    },
  }));
}

/**
 * Convert an Anthropic-native messages array to OpenAI Chat messages array.
 *
 * Anthropic assistant messages with tool_use blocks become { role:'assistant', tool_calls:[...] }.
 * Anthropic user messages with tool_result blocks become { role:'tool', tool_call_id, content } entries.
 */
function convertMessages(messages) {
  const result = [];

  for (const msg of messages) {
    // Plain string content — pass through
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }
    if (!Array.isArray(msg.content)) continue;

    if (msg.role === 'assistant') {
      const textParts    = msg.content.filter((b) => b.type === 'text');
      const toolUseParts = msg.content.filter((b) => b.type === 'tool_use');
      const oaiMsg       = { role: 'assistant' };
      if (textParts.length)    oaiMsg.content    = textParts.map((b) => b.text).join('');
      if (toolUseParts.length) {
        oaiMsg.tool_calls = toolUseParts.map((b) => ({
          id:   b.id,
          type: 'function',
          function: {
            name:      b.name,
            arguments: JSON.stringify(b.input || {}),
          },
        }));
      }
      result.push(oaiMsg);
    } else {
      // user role — may contain tool_result blocks
      const toolResults = msg.content.filter((b) => b.type === 'tool_result');
      const textBlocks  = msg.content.filter((b) => b.type === 'text');

      for (const tr of toolResults) {
        const content = typeof tr.content === 'string'
          ? tr.content
          : (Array.isArray(tr.content) ? tr.content.map((b) => b.text || '').join('') : '');
        result.push({ role: 'tool', tool_call_id: tr.tool_use_id, content });
      }

      if (textBlocks.length) {
        result.push({ role: 'user', content: textBlocks.map((b) => b.text).join('') });
      }
    }
  }

  return result;
}

// ── OpenAI → Anthropic format conversion ─────────────────────────────────────

function convertResponse(oaiBody, label) {
  if (!oaiBody?.choices?.length) {
    throw new Error(oaiBody?.error?.message || `${label}: empty response`);
  }

  const choice = oaiBody.choices[0];
  const msg    = choice.message;
  const content = [];

  if (msg?.content) content.push({ type: 'text', text: msg.content });

  if (msg?.tool_calls?.length) {
    for (const tc of msg.tool_calls) {
      content.push({
        type:  'tool_use',
        id:    tc.id,
        name:  tc.function.name,
        input: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
      });
    }
  }

  let stop_reason = 'end_turn';
  if (choice.finish_reason === 'tool_calls') stop_reason = 'tool_use';
  else if (choice.finish_reason === 'length') stop_reason = 'max_tokens';

  return {
    content,
    stop_reason,
    usage: {
      input_tokens:                oaiBody.usage?.prompt_tokens     ?? 0,
      output_tokens:               oaiBody.usage?.completion_tokens ?? 0,
      cache_read_input_tokens:     0,
      cache_creation_input_tokens: 0,
    },
  };
}

// ── Adapter factory ───────────────────────────────────────────────────────────

/**
 * Create an OpenAI-compatible provider adapter.
 *
 * @param {object} opts
 * @param {string} opts.hostname  — API hostname, e.g. 'api.openai.com'
 * @param {string} opts.path      — API path, e.g. '/v1/chat/completions'
 * @param {string} opts.envVar    — Name of the API key environment variable
 * @param {string} opts.label     — Human-readable name used in error messages
 */
function createAdapter({ hostname, path: apiPath, envVar, label }) {
  return {
    async chat({ model, max_tokens, system, messages, tools }) {
      const apiKey = process.env[envVar];
      if (!apiKey) throw new Error(`${label} API key (${envVar}) is not set.`);

      const body = {
        model,
        max_tokens,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          ...convertMessages(messages),
        ],
      };

      const oaiTools = convertTools(tools);
      if (oaiTools) {
        body.tools       = oaiTools;
        body.tool_choice = 'auto';
      }

      const { status, body: responseBody } = await httpsPost(
        hostname,
        apiPath,
        { authorization: `Bearer ${apiKey}` },
        body
      );

      if (status !== 200) {
        const errMsg = responseBody?.error?.message ?? `HTTP ${status}`;
        throw new Error(`${label}: ${errMsg}`);
      }

      return convertResponse(responseBody, label);
    },
  };
}

module.exports = { createAdapter, httpsPost };
