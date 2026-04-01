/**
 * knowledge-base.js — Stdio MCP server for RAG (retrieval-augmented generation).
 *
 * Stores and retrieves text embeddings from the pgvector embeddings table.
 * Supports semantic search across agent run summaries and custom documents.
 *
 * Required env vars:
 *   DATABASE_URL    — PostgreSQL connection string
 *   OPENAI_API_KEY  — for generating embeddings via text-embedding-3-small
 */

'use strict';

const https    = require('https');
const { Pool } = require('pg');
const readline = require('readline');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const EMBED_MODEL = 'text-embedding-3-small';
const MAX_CHARS   = 30000;

// ── Embedding helper ──────────────────────────────────────────────────────────

function fetchEmbedding(text) {
  return new Promise((resolve, reject) => {
    const input = String(text).slice(0, MAX_CHARS);
    const body  = JSON.stringify({ model: EMBED_MODEL, input });

    const req = https.request(
      {
        hostname: 'api.openai.com',
        path:     '/v1/embeddings',
        method:   'POST',
        headers: {
          Authorization:    `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(`OpenAI: ${parsed.error.message}`));
            resolve(parsed.data[0].embedding);
          } catch (e) {
            reject(new Error(`Failed to parse OpenAI response: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_knowledge',
    description: 'Semantic similarity search across all indexed content — agent report summaries and custom documents. Use to find relevant context for any question. Returns the most similar stored content chunks ranked by similarity.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id:      { type: 'number', description: 'Organisation ID.' },
        query:       { type: 'string', description: 'Natural language query — what you are looking for.' },
        source_type: { type: 'string', description: 'Optional filter: "agent_run" for report history, "document" for manually added docs.' },
        limit:       { type: 'number', description: 'Max results to return. Default 8.' },
      },
      required: ['org_id', 'query'],
    },
  },
  {
    name: 'add_document',
    description: 'Add a custom document to the knowledge base. Use to store product information, SOPs, competitor research, strategic notes, or any reference material the agent should be able to retrieve.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id:   { type: 'number', description: 'Organisation ID.' },
        title:    { type: 'string', description: 'Document title.' },
        content:  { type: 'string', description: 'Full document text.' },
        category: { type: 'string', description: 'Optional category label (e.g. "product", "competitor", "sop").' },
      },
      required: ['org_id', 'title', 'content'],
    },
  },
  {
    name: 'list_knowledge_sources',
    description: 'Lists what is indexed in the knowledge base — source types, counts, and most recent entry dates.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'number', description: 'Organisation ID.' },
      },
      required: ['org_id'],
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function callTool(name, args = {}) {
  switch (name) {

    case 'search_knowledge': {
      const limit  = Math.min(args.limit || 8, 20);
      const vector = await fetchEmbedding(args.query);
      const vecStr = `[${vector.join(',')}]`;

      const params = [args.org_id, vecStr, limit];
      let sql = `
        SELECT
          id,
          source_type,
          source_id,
          content,
          metadata,
          1 - (embedding <=> $2::vector) AS similarity
        FROM embeddings
        WHERE org_id = $1
      `;
      if (args.source_type) { sql += ` AND source_type = $4`; params.push(args.source_type); }
      sql += ` ORDER BY embedding <=> $2::vector LIMIT $3`;

      const { rows } = await pool.query(sql, params);
      return rows.map((r) => ({
        source_type: r.source_type,
        source_id:   r.source_id,
        metadata:    r.metadata,
        similarity:  parseFloat(r.similarity).toFixed(4),
        content:     r.content,
      }));
    }

    case 'add_document': {
      const content  = args.content;
      const metadata = { title: args.title, category: args.category ?? null, added_at: new Date().toISOString() };
      const sourceId = `doc_${args.title.toLowerCase().replace(/\W+/g, '_').slice(0, 60)}`;

      const vector = await fetchEmbedding(content);
      const vecStr = `[${vector.join(',')}]`;

      await pool.query(
        `INSERT INTO embeddings (org_id, source_type, source_id, content, metadata, embedding)
         VALUES ($1, 'document', $2, $3, $4, $5::vector)
         ON CONFLICT (org_id, source_type, source_id)
         DO UPDATE SET content = EXCLUDED.content, metadata = EXCLUDED.metadata, embedding = EXCLUDED.embedding`,
        [args.org_id, sourceId, content, JSON.stringify(metadata), vecStr]
      );

      return { ok: true, source_id: sourceId, title: args.title };
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
        [args.org_id]
      );
      return rows;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── JSON-RPC transport ────────────────────────────────────────────────────────

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
