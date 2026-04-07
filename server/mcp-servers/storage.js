/**
 * storage.js — Stdio MCP server for S3 file storage.
 *
 * Exposes four tools to agents operating in a ReAct loop:
 *   storage_put_file    — upload bytes (base64) to S3, returns storageKey
 *   storage_get_file    — get a pre-signed download URL for a stored file
 *   storage_list_files  — list an org's stored files with metadata
 *   storage_delete_file — remove a file by storageKey
 *
 * Required env vars:
 *   AWS_ACCESS_KEY_ID      — IAM user access key
 *   AWS_SECRET_ACCESS_KEY  — IAM user secret key
 *   AWS_S3_BUCKET          — default bucket (overridable per org via storage_settings)
 *   AWS_S3_REGION          — default region (overridable per org via storage_settings)
 *
 * Storage settings per org live in system_settings under key 'storage_settings':
 *   { enabled, default_behaviour, aws_bucket, aws_region }
 * Credentials stay as env vars — they are secrets, not config.
 */

'use strict';

const readline = require('readline');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Pool }         = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── S3 client (shared, one region) ───────────────────────────────────────────

function getClient(region) {
  return new S3Client({
    region,
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

// ── Resolve storage config for an org ────────────────────────────────────────

async function getStorageConfig(orgId) {
  const res = await pool.query(
    `SELECT value FROM system_settings WHERE org_id = $1 AND key = 'storage_settings' LIMIT 1`,
    [orgId]
  );
  const settings = res.rows[0]?.value ?? {};
  return {
    bucket: settings.aws_bucket ?? process.env.AWS_S3_BUCKET ?? '',
    region: settings.aws_region ?? process.env.AWS_S3_REGION ?? 'ap-southeast-2',
  };
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'storage_put_file',
    description: 'Upload a file to S3 storage. Accepts base64-encoded bytes and a content type. Returns a storageKey that can be used to retrieve or delete the file later.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id:       { type: 'number',  description: 'Organisation ID.' },
        filename:     { type: 'string',  description: 'Original filename including extension (e.g. invoice.pdf).' },
        content_type: { type: 'string',  description: 'MIME type of the file (e.g. application/pdf, image/png).' },
        data_base64:  { type: 'string',  description: 'Base64-encoded file bytes.' },
        label:        { type: 'string',  description: 'Optional human-readable label for this file.' },
      },
      required: ['org_id', 'filename', 'content_type', 'data_base64'],
    },
  },
  {
    name: 'storage_get_file',
    description: 'Get a pre-signed download URL for a stored file. The URL expires after 1 hour. Returns the URL and its expiry time.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id:      { type: 'number', description: 'Organisation ID.' },
        storage_key: { type: 'string', description: 'The storageKey returned when the file was uploaded.' },
        expires_in:  { type: 'number', description: 'URL expiry in seconds. Default 3600 (1 hour). Max 86400 (24 hours).' },
      },
      required: ['org_id', 'storage_key'],
    },
  },
  {
    name: 'storage_list_files',
    description: 'List files stored for an organisation. Returns key, filename, size, and upload date for each file.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id:   { type: 'number', description: 'Organisation ID.' },
        max_keys: { type: 'number', description: 'Maximum number of results to return. Default 50, max 200.' },
      },
      required: ['org_id'],
    },
  },
  {
    name: 'storage_delete_file',
    description: 'Permanently delete a stored file by its storageKey.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id:      { type: 'number', description: 'Organisation ID.' },
        storage_key: { type: 'string', description: 'The storageKey of the file to delete.' },
      },
      required: ['org_id', 'storage_key'],
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function callTool(name, args = {}) {
  const { bucket, region } = await getStorageConfig(args.org_id);

  if (!bucket) throw new Error('S3 bucket not configured — set AWS_S3_BUCKET env var or configure storage_settings');
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS credentials not set — AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required');
  }

  const client = getClient(region);

  switch (name) {

    case 'storage_put_file': {
      const body = Buffer.from(args.data_base64, 'base64');
      const ts   = Date.now();
      const safe = (args.filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      const key  = `org/${args.org_id}/${ts}-${safe}`;

      await client.send(new PutObjectCommand({
        Bucket:               bucket,
        Key:                  key,
        Body:                 body,
        ContentType:          args.content_type,
        ServerSideEncryption: 'AES256',
        Metadata: {
          org_id:   String(args.org_id),
          filename: args.filename,
          ...(args.label ? { label: args.label } : {}),
        },
      }));

      return { storageKey: key, bucket, size: body.length };
    }

    case 'storage_get_file': {
      const expiresIn = Math.min(args.expires_in ?? 3600, 86400);
      const command   = new GetObjectCommand({ Bucket: bucket, Key: args.storage_key });
      const url       = await getSignedUrl(client, command, { expiresIn });
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      return { url, expiresAt, storageKey: args.storage_key };
    }

    case 'storage_list_files': {
      const maxKeys = Math.min(args.max_keys ?? 50, 200);
      const prefix  = `org/${args.org_id}/`;
      const res     = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: maxKeys }));
      const files   = (res.Contents ?? []).map((obj) => ({
        storageKey:   obj.Key,
        filename:     obj.Key.replace(prefix, '').replace(/^\d+-/, ''),
        size:         obj.Size,
        lastModified: obj.LastModified?.toISOString() ?? null,
      }));
      return { files, count: files.length, prefix };
    }

    case 'storage_delete_file': {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: args.storage_key }));
      return { deleted: true, storageKey: args.storage_key };
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
          serverInfo:      { name: 'storage-mcp', version: '1.0.0' },
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
