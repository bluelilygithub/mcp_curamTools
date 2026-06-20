/**
 * knowledge-base.js — Stdio MCP server for RAG (retrieval-augmented generation).
 *
 * Embeddings use the org RAG model from Settings > Models (system_settings.embedding_model).
 *
 * Required env vars:
 *   DATABASE_URL — PostgreSQL connection string
 *   Provider key for selected embedding model (e.g. GEMINI_API_KEY, OPENAI_API_KEY)
 */

'use strict';

const { Pool } = require('pg');
const readline = require('readline');
const EmbeddingService = require('../services/EmbeddingService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const MAX_CHARS = 30000;

function getTrustedOrgId(args) {
  const orgId = parseInt(args.__trusted_org_id, 10);
  if (!Number.isInteger(orgId) || orgId <= 0) {
    throw new Error('Trusted organisation scope is required.');
  }
  return orgId;
}

function clampInt(value, fallback, min, max) {
  const parsed = parseInt(value ?? fallback, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

const TOOLS = [
  {
    name: 'search_knowledge',
    description: 'Semantic similarity search across all indexed content — agent report summaries and custom documents. Use to find relevant context for any question. Returns the most similar stored content chunks ranked by similarity.',
    inputSchema: {
      type: 'object',
      properties: {
        query:       { type: 'string', description: 'Natural language query — what you are looking for.' },
        source_type: { type: 'string', description: 'Optional filter: "agent_run" for report history, "document" for manually added docs.' },
        limit:       { type: 'number', description: 'Max results to return. Default 8.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_document',
    description: 'Add a custom document to the knowledge base. Use to store product information, SOPs, competitor research, strategic notes, or any reference material the agent should be able to retrieve.',
    inputSchema: {
      type: 'object',
      properties: {
        title:    { type: 'string', description: 'Document title.' },
        content:  { type: 'string', description: 'Full document text.' },
        category: { type: 'string', description: 'Optional category label (e.g. "product", "competitor", "sop").' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'list_knowledge_sources',
    description: 'Lists what is indexed in the knowledge base — source types, counts, and most recent entry dates.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

async function callTool(name, args = {}) {
  const orgId = getTrustedOrgId(args);

  switch (name) {

    case 'search_knowledge': {
      const query = String(args.query || '').trim().slice(0, MAX_CHARS);
      if (!query) throw new Error('query is required');
      const limit = clampInt(args.limit, 8, 1, 20);
      const rows = await EmbeddingService.search({
        orgId,
        query,
        sourceType: args.source_type || null,
        limit,
      });
      return rows.map((r) => ({
        source_type: r.source_type,
        source_id:   r.source_id,
        metadata:    r.metadata,
        similarity:  parseFloat(r.similarity).toFixed(4),
        content:     r.content,
      }));
    }

    case 'add_document': {
      const content = String(args.content || '').slice(0, MAX_CHARS);
      const title = String(args.title || '').trim().slice(0, 160);
      if (!title || !content) throw new Error('title and content are required');
      const metadata = { title, category: args.category ? String(args.category).slice(0, 80) : null, added_at: new Date().toISOString() };
      const sourceId = `doc_${title.toLowerCase().replace(/\W+/g, '_').slice(0, 60)}`;

      await EmbeddingService.embedAndStore({
        orgId,
        sourceType: 'document',
        sourceId,
        content,
        metadata,
      });

      return { ok: true, source_id: sourceId, title };
    }

    case 'list_knowledge_sources': {
      const { rows } = await pool.query(
        `SELECT
           source_type,
           metadata->>'category' AS category,
           COUNT(*)::int          AS count,
           MAX(created_at)        AS last_indexed
         FROM embeddings
         WHERE org_id = $1
         GROUP BY source_type, metadata->>'category'
         ORDER BY source_type, count DESC`,
        [orgId],
      );
      return rows;
    }

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
          serverInfo:      { name: 'knowledge-base-mcp', version: '1.0.0' },
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

rl.on('close', async () => { await pool.end(); process.exit(0); });
