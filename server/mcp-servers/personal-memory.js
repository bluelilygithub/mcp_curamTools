/**
 * personal-memory.js — Stdio MCP server for per-user semantic memory.
 *
 * Thoughts are scoped to org_id + user_id (injected as trusted context).
 * Any org member can capture and search their own memories.
 *
 * Required env vars:
 *   DATABASE_URL    — PostgreSQL connection string
 *   OPENAI_API_KEY  — for text-embedding-3-small
 */

'use strict';

const readline = require('readline');
const PersonalMemoryService = require('../services/PersonalMemoryService');

function getTrustedOrgId(args) {
  const orgId = parseInt(args.__trusted_org_id, 10);
  if (!Number.isInteger(orgId) || orgId <= 0) {
    throw new Error('Trusted organisation scope is required.');
  }
  return orgId;
}

function getTrustedUserId(args) {
  const userId = parseInt(args.__trusted_user_id, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('Trusted user scope is required.');
  }
  return userId;
}

function clampInt(value, fallback, min, max) {
  const parsed = parseInt(value ?? fallback, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

const TOOLS = [
  {
    name: 'capture_thought',
    description: 'Store a personal note or memory for the current user. Use for preferences, decisions, context to recall later, or anything the user wants remembered across sessions. Duplicate content updates the existing entry.',
    inputSchema: {
      type: 'object',
      properties: {
        content:  { type: 'string', description: 'The thought or note to remember.' },
        metadata: { type: 'object', description: 'Optional tags, e.g. { "source": "conversation", "topic": "budget" }.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'search_thoughts',
    description: 'Semantic search over the current user\'s personal memories. Finds conceptually related notes, not just keyword matches.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language query — what you want to recall.' },
        limit: { type: 'number', description: 'Max results. Default 8.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_thoughts',
    description: 'List the current user\'s recent personal memories (newest first).',
    inputSchema: {
      type: 'object',
      properties: {
        limit:  { type: 'number', description: 'Max results. Default 20.' },
        offset: { type: 'number', description: 'Pagination offset. Default 0.' },
      },
    },
  },
  {
    name: 'thought_stats',
    description: 'Summary of how many personal memories the current user has stored.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

async function callTool(name, args = {}) {
  const orgId = getTrustedOrgId(args);
  const userId = getTrustedUserId(args);

  switch (name) {
    case 'capture_thought':
      return PersonalMemoryService.capture({
        orgId,
        userId,
        content: args.content,
        metadata: args.metadata,
      });

    case 'search_thoughts':
      return PersonalMemoryService.search({
        orgId,
        userId,
        query: args.query,
        limit: clampInt(args.limit, 8, 1, 20),
      });

    case 'list_thoughts':
      return PersonalMemoryService.list({
        orgId,
        userId,
        limit: clampInt(args.limit, 20, 1, 50),
        offset: clampInt(args.offset, 0, 0, 10_000),
      });

    case 'thought_stats':
      return PersonalMemoryService.stats({ orgId, userId });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function send(obj)              { process.stdout.write(JSON.stringify(obj) + '\n'); }
function respond(id, result)    { send({ jsonrpc: '2.0', id, result }); }
function respondError(id, c, m) { send({ jsonrpc: '2.0', id, error: { code: c, message: m } }); }

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  const { id, method, params = {} } = msg;

  try {
    switch (method) {
      case 'initialize':
        respond(id, {
          protocolVersion: '2024-11-05',
          capabilities:    { tools: {} },
          serverInfo:      { name: 'personal-memory-mcp', version: '1.0.0' },
        });
        break;
      case 'notifications/initialized': break;
      case 'tools/list':
        respond(id, { tools: TOOLS });
        break;
      case 'tools/call': {
        const result = await callTool(params.name, params.arguments || {});
        respond(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        break;
      }
      default:
        respondError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    respondError(id, -32000, err.message);
  }
});

rl.on('close', () => { process.exit(0); });
