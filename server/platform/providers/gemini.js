'use strict';

/**
 * gemini.js — Google Gemini provider adapter for AgentOrchestrator.
 *
 * Translates between the platform's Anthropic-native message format and
 * the Gemini REST API (generativelanguage.googleapis.com).
 *
 * Uses https.request throughout (fetch silently fails on Railway).
 *
 * Key translation points:
 *   - Anthropic `system`      → Gemini `system_instruction`
 *   - Anthropic `messages[]`  → Gemini `contents[]`
 *   - Anthropic role 'assistant' → Gemini role 'model'
 *   - Anthropic `tools[].input_schema` → Gemini `functionDeclarations[].parameters`
 *   - Anthropic `tool_use` blocks → Gemini `functionCall` parts
 *   - Anthropic `tool_result` blocks → Gemini `functionResponse` parts
 *   - Gemini `STOP`      → Anthropic `end_turn`
 *   - Gemini `MAX_TOKENS` → Anthropic `max_tokens`
 *   - Gemini `usageMetadata.promptTokenCount` → Anthropic `input_tokens`
 */

const https = require('https');

// ── HTTP helper ───────────────────────────────────────────────────────────────

function httpsPost(hostname, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path:   apiPath,
        method: 'POST',
        headers: {
          'content-type':   'application/json',
          'content-length': Buffer.byteLength(payload),
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
    req.write(payload);
    req.end();
  });
}

// ── Anthropic → Gemini format conversion ─────────────────────────────────────

/**
 * Convert Anthropic tool definitions to Gemini functionDeclarations format.
 */
function convertTools(tools) {
  if (!tools || !tools.length) return undefined;
  return [{
    function_declarations: tools.map((t) => ({
      name:        t.name,
      description: t.description || '',
      parameters:  t.input_schema || { type: 'object', properties: {} },
    })),
  }];
}

/**
 * Convert Anthropic-native messages to Gemini contents[].
 *
 * Builds a map of tool_use id → function name as it processes assistant messages,
 * so tool_result blocks can be converted to functionResponse with the correct name.
 */
function convertMessages(messages) {
  const idToName = {};
  const contents = [];

  for (const msg of messages) {
    const { role, content } = msg;

    // Plain string content
    if (typeof content === 'string') {
      contents.push({
        role:  role === 'assistant' ? 'model' : 'user',
        parts: [{ text: content }],
      });
      continue;
    }

    if (!Array.isArray(content)) continue;

    const geminiRole = role === 'assistant' ? 'model' : 'user';

    // User messages containing only tool_result blocks → functionResponse parts
    if (role === 'user' && content.every((b) => b.type === 'tool_result')) {
      const parts = content.map((b) => ({
        functionResponse: {
          name:     idToName[b.tool_use_id] ?? b.tool_use_id,
          response: {
            result: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
          },
        },
      }));
      contents.push({ role: 'user', parts });
      continue;
    }

    // Mixed content (assistant with text + tool_use, or user with text)
    const parts = [];
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        parts.push({ text: block.text });
      } else if (block.type === 'tool_use') {
        idToName[block.id] = block.name;
        parts.push({ functionCall: { name: block.name, args: block.input ?? {} } });
      }
      // thinking blocks are skipped — Gemini has no equivalent
    }
    if (parts.length > 0) {
      contents.push({ role: geminiRole, parts });
    }
  }

  return contents;
}

// ── Gemini → Anthropic format conversion ─────────────────────────────────────

function convertResponse(geminiBody) {
  if (!geminiBody?.candidates?.length) {
    const errMsg = geminiBody?.error?.message ?? 'Gemini returned no candidates';
    throw new Error(`Gemini API error: ${errMsg}`);
  }

  const candidate = geminiBody.candidates[0];
  const content   = [];
  let   stopReason = 'end_turn';

  for (const part of candidate.content?.parts ?? []) {
    if (typeof part.text === 'string') {
      content.push({ type: 'text', text: part.text });
    } else if (part.functionCall) {
      stopReason = 'tool_use';
      // Generate a stable id for this function call
      content.push({
        type:  'tool_use',
        id:    `fc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name:  part.functionCall.name,
        input: part.functionCall.args ?? {},
      });
    }
  }

  const finishReason = candidate.finishReason;
  if (finishReason === 'MAX_TOKENS') stopReason = 'max_tokens';

  const usage = geminiBody.usageMetadata ?? {};

  return {
    content,
    stop_reason: stopReason,
    usage: {
      input_tokens:                usage.promptTokenCount      ?? 0,
      output_tokens:               usage.candidatesTokenCount  ?? 0,
      cache_read_input_tokens:     0,
      cache_creation_input_tokens: 0,
    },
  };
}

// ── Adapter ───────────────────────────────────────────────────────────────────

async function chat({ model, max_tokens, system, messages, tools }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');

  // system can be a plain string or an Anthropic cache_control array
  const systemText = Array.isArray(system)
    ? system.map((b) => (typeof b === 'string' ? b : b.text ?? '')).join('\n')
    : (system ?? null);

  const body = {
    contents:          convertMessages(messages),
    generation_config: { max_output_tokens: max_tokens ?? 8192 },
  };

  if (systemText) {
    body.system_instruction = { parts: [{ text: systemText }] };
  }

  const geminiTools = convertTools(tools);
  if (geminiTools) body.tools = geminiTools;

  const { status, body: responseBody } = await httpsPost(
    'generativelanguage.googleapis.com',
    `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
    body
  );

  if (status !== 200) {
    const errMsg = responseBody?.error?.message ?? `HTTP ${status}`;
    throw new Error(`Gemini API error: ${errMsg}`);
  }

  return convertResponse(responseBody);
}

module.exports = { chat };
