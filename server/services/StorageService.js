'use strict';

/**
 * StorageService — S3 file storage for the platform.
 *
 * Thin wrapper around @aws-sdk/client-s3. Follows the same optional-integration
 * pattern as EmbeddingService: if S3 is not configured, callers receive a
 * structured error rather than a hard throw — storage is an enhancement, not
 * a hard dependency.
 *
 * Required env vars:
 *   AWS_ACCESS_KEY_ID      — IAM user access key
 *   AWS_SECRET_ACCESS_KEY  — IAM user secret key
 *
 * Stored in system_settings under key 'storage_settings' per org:
 *   {
 *     "enabled":          true,
 *     "default_behaviour": "store_original" | "store_redacted" | "do_not_store",
 *     "aws_bucket":       "my-bucket",
 *     "aws_region":       "ap-southeast-2"
 *   }
 */

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ── Client factory — one client per region, cached ───────────────────────────

const clientCache = new Map();

function getClient(region) {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set');
  }
  if (!clientCache.has(region)) {
    clientCache.set(region, new S3Client({
      region,
      credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    }));
  }
  return clientCache.get(region);
}

// ── put — upload bytes to S3 ──────────────────────────────────────────────────

/**
 * Upload a file to S3.
 *
 * @param {object} opts
 * @param {string}  opts.bucket      — S3 bucket name
 * @param {string}  opts.region      — AWS region
 * @param {string}  opts.key         — Object key (path within bucket)
 * @param {Buffer}  opts.body        — File bytes
 * @param {string}  opts.contentType — MIME type
 * @param {object}  [opts.metadata]  — Optional string key/value pairs for S3 object metadata
 * @returns {Promise<{ storageKey: string }>}
 */
async function put({ bucket, region, key, body, contentType, metadata = {} }) {
  const client = getClient(region);
  await client.send(new PutObjectCommand({
    Bucket:      bucket,
    Key:         key,
    Body:        body,
    ContentType: contentType,
    Metadata:    Object.fromEntries(
      Object.entries(metadata).map(([k, v]) => [k, String(v)])
    ),
    ServerSideEncryption: 'AES256',
  }));
  return { storageKey: key };
}

// ── getSignedDownloadUrl — pre-signed GET URL ─────────────────────────────────

/**
 * Generate a pre-signed URL for downloading a file. Expires after expiresIn seconds.
 *
 * @param {object} opts
 * @param {string}  opts.bucket
 * @param {string}  opts.region
 * @param {string}  opts.key
 * @param {number}  [opts.expiresIn]  — seconds; default 3600 (1 hour)
 * @returns {Promise<{ url: string, expiresAt: string }>}
 */
async function getSignedDownloadUrl({ bucket, region, key, expiresIn = 3600 }) {
  const client  = getClient(region);
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url     = await getSignedUrl(client, command, { expiresIn });
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  return { url, expiresAt };
}

// ── remove — delete a single object ──────────────────────────────────────────

/**
 * Delete an object from S3.
 *
 * @param {object} opts
 * @param {string}  opts.bucket
 * @param {string}  opts.region
 * @param {string}  opts.key
 * @returns {Promise<{ deleted: true }>}
 */
async function remove({ bucket, region, key }) {
  const client = getClient(region);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  return { deleted: true };
}

// ── list — list objects under a prefix ────────────────────────────────────────

/**
 * List objects under a key prefix (usually org-scoped).
 *
 * @param {object} opts
 * @param {string}  opts.bucket
 * @param {string}  opts.region
 * @param {string}  opts.prefix      — e.g. "org/42/"
 * @param {number}  [opts.maxKeys]   — default 100
 * @returns {Promise<Array<{ key, size, lastModified, contentType }>>}
 */
async function list({ bucket, region, prefix, maxKeys = 100 }) {
  const client = getClient(region);
  const res = await client.send(new ListObjectsV2Command({
    Bucket:  bucket,
    Prefix:  prefix,
    MaxKeys: maxKeys,
  }));
  return (res.Contents ?? []).map((obj) => ({
    key:          obj.Key,
    size:         obj.Size,
    lastModified: obj.LastModified?.toISOString() ?? null,
  }));
}

// ── healthCheck — verify bucket is reachable ──────────────────────────────────

/**
 * Confirm the bucket exists and credentials are valid.
 * Uses HeadBucket — does not list or download any objects.
 *
 * @param {object} opts
 * @param {string}  opts.bucket
 * @param {string}  opts.region
 * @returns {Promise<{ ok: true, bucket: string, region: string }>}
 */
async function healthCheck({ bucket, region }) {
  const client = getClient(region);
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  return { ok: true, bucket, region };
}

module.exports = { put, getSignedDownloadUrl, remove, list, healthCheck };
