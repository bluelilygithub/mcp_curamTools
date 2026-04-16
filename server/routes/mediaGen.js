'use strict';

/**
 * Media Generator — Fal.ai image and video generation.
 *
 * Routes:
 *   POST /generate        — Submit a generation job; streams SSE progress
 *   GET  /runs            — Paginated history of runs for the current org
 *   GET  /runs/:id        — Single run detail
 *   DELETE /runs/:id      — Soft delete
 *
 * Env var: SEEDANCE_API_KEY — Fal.ai API key
 *
 * Fal.ai API (https.request throughout — Railway-safe):
 *   Submit:  POST  https://queue.fal.run/{model}
 *   Status:  GET   https://queue.fal.run/{model}/requests/{id}/status
 *   Result:  GET   https://queue.fal.run/{model}/requests/{id}
 *   Storage: POST  https://storage.fal.run   (multipart, returns { url })
 */

const https   = require('https');
const express = require('express');
const multer  = require('multer');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Reference image must be an image file'));
    }
    cb(null, true);
  },
});

const MAX_PROMPT_LEN = 2000;
const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 90; // 6 minutes

// ── Fal.ai helpers ──────────────────────────────────────────────────────────

/**
 * Make a JSON request to Fal.ai. Uses https.request (fetch silently fails on Railway).
 */
function falJson(method, hostname, path, apiKey, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
    const req = https.request(
      {
        hostname,
        path,
        method,
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(body ? { 'Content-Length': body.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          if (res.statusCode >= 400) {
            return reject(new Error(`Fal.ai HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
          }
          try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Upload an image buffer to Fal.ai storage.
 * Returns the CDN URL string.
 */
function uploadToFalStorage(buffer, mimetype, apiKey) {
  return new Promise((resolve, reject) => {
    const ext      = (mimetype.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const filename = `reference.${ext}`;
    const boundary = `FalBoundary${Date.now()}`;

    const hdr  = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimetype}\r\n\r\n`,
    );
    const ftr  = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([hdr, buffer, ftr]);

    const req = https.request(
      {
        hostname: 'storage.fal.run',
        path: '/',
        method: 'POST',
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          if (res.statusCode >= 400) {
            return reject(new Error(`Fal.ai storage upload failed (HTTP ${res.statusCode}): ${raw.slice(0, 200)}`));
          }
          try {
            const parsed = JSON.parse(raw);
            resolve(parsed.url || parsed.file_url || null);
          } catch {
            reject(new Error('Unexpected response from Fal.ai storage'));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Determine whether a model produces video or image output.
 * Checks path segments — any model with a video-generation path is video.
 */
function modelType(modelId) {
  const id = (modelId || '').toLowerCase();
  if (id.includes('text-to-video') || id.includes('image-to-video')) return 'video';
  if (id.includes('seedance'))  return 'video';
  if (id.includes('kling'))     return 'video';
  if (id.includes('sora'))      return 'video';
  if (id.includes('svd'))       return 'video';
  if (id.includes('pixverse'))  return 'video';
  if (id.includes('wan'))       return 'video';
  return 'image';
}

/**
 * Build the generation payload for the given model.
 * Seedance: { prompt, image_url?, duration, aspect_ratio }
 * FLUX/image: { prompt, image_url?, image_size }
 */
function buildPayload(modelId, prompt, imageUrl, opts) {
  const { duration, aspectRatio } = opts;
  if (modelType(modelId) === 'video') {
    const payload = { prompt };
    if (imageUrl)    payload.image_url    = imageUrl;
    if (duration)    payload.duration     = String(duration);
    if (aspectRatio) payload.aspect_ratio = aspectRatio;
    return payload;
  }
  // Image models (FLUX etc.)
  const sizeMap = {
    '1:1':  'square_hd',
    '16:9': 'landscape_16_9',
    '9:16': 'portrait_16_9',
    '4:3':  'landscape_4_3',
    '3:4':  'portrait_4_3',
  };
  const payload = { prompt, num_images: 1 };
  if (imageUrl)    payload.image_url   = imageUrl;
  if (aspectRatio) payload.image_size  = sizeMap[aspectRatio] || 'landscape_4_3';
  return payload;
}

// ── SSE helper ──────────────────────────────────────────────────────────────

function sseWrite(res, data) {
  try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client disconnected */ }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Default model library (used when org hasn't saved a custom list) ────────

const DEFAULT_MODELS = [
  // Text → Video
  { id: 'fal-ai/seedance-1-lite',                           label: 'Seedance 1 Lite',     group: 'Text → Video', type: 'video', requiresImage: false },
  { id: 'fal-ai/seedance-2.0/text-to-video',                label: 'Seedance 2.0',        group: 'Text → Video', type: 'video', requiresImage: false },
  { id: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',  label: 'Kling 2.5 Turbo Pro', group: 'Text → Video', type: 'video', requiresImage: false },
  { id: 'fal-ai/kling-video/v3/text-to-video',              label: 'Kling 3.0',           group: 'Text → Video', type: 'video', requiresImage: false },
  { id: 'fal-ai/sora-2/text-to-video',                      label: 'Sora 2',              group: 'Text → Video', type: 'video', requiresImage: false },
  { id: 'fal-ai/pixverse/v6/text-to-video',                 label: 'Pixverse V6',         group: 'Text → Video', type: 'video', requiresImage: false },
  { id: 'fal-ai/fast-svd/text-to-video',                    label: 'Fast SVD',            group: 'Text → Video', type: 'video', requiresImage: false },
  // Image → Video
  { id: 'fal-ai/minimax-video/image-to-video',              label: 'MiniMax (Hailuo AI)', group: 'Image → Video', type: 'video', requiresImage: true },
  { id: 'fal-ai/sora-2/image-to-video',                     label: 'Sora 2',              group: 'Image → Video', type: 'video', requiresImage: true },
  { id: 'fal-ai/wan-2.2/image-to-video',                    label: 'Wan 2.2',             group: 'Image → Video', type: 'video', requiresImage: true },
  { id: 'fal-ai/seedance-2.0/image-to-video',               label: 'Seedance 2.0',        group: 'Image → Video', type: 'video', requiresImage: true },
  { id: 'fal-ai/pika/v2.2/image-to-video',                  label: 'Pika 2.2',            group: 'Image → Video', type: 'video', requiresImage: true },
  { id: 'fal-ai/fast-svd/image-to-video',                   label: 'Fast SVD',            group: 'Image → Video', type: 'video', requiresImage: true },
  // Image → Image
  { id: 'fal-ai/flux/dev/image-to-image',                   label: 'FLUX Dev',            group: 'Image → Image', type: 'image', requiresImage: true },
  { id: 'fal-ai/flux/pro/image-to-image',                   label: 'FLUX Pro',            group: 'Image → Image', type: 'image', requiresImage: true },
  { id: 'fal-ai/flux-lora/image-to-image',                  label: 'FLUX LoRA',           group: 'Image → Image', type: 'image', requiresImage: true },
  { id: 'fal-ai/glm-image/image-to-image',                  label: 'GLM Image',           group: 'Image → Image', type: 'image', requiresImage: true },
  { id: 'fal-ai/uno',                                        label: 'UNO',                 group: 'Image → Image', type: 'image', requiresImage: true },
  // Text → Image
  { id: 'fal-ai/flux/schnell',                               label: 'FLUX Schnell',        group: 'Text → Image', type: 'image', requiresImage: false },
  { id: 'fal-ai/black-forest-labs/flux.1schnell',            label: 'FLUX.1 Schnell',      group: 'Text → Image', type: 'image', requiresImage: false },
  { id: 'fal-ai/flux/dev',                                   label: 'FLUX Dev',            group: 'Text → Image', type: 'image', requiresImage: false },
  { id: 'fal-ai/flux/pro',                                   label: 'FLUX Pro',            group: 'Text → Image', type: 'image', requiresImage: false },
  { id: 'fal-ai/flux/kontext',                               label: 'FLUX Kontext',        group: 'Text → Image', type: 'image', requiresImage: false },
  { id: 'fal-ai/ideogram/v2',                                label: 'Ideogram 2.0',        group: 'Text → Image', type: 'image', requiresImage: false },
];

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /models — return org's saved model list, or defaults if none saved.
 */
router.get('/models', requireAuth, async (req, res) => {
  const { orgId } = req.user;
  try {
    const r = await pool.query(
      `SELECT value FROM system_settings WHERE org_id=$1 AND key='fal_models' LIMIT 1`,
      [orgId],
    );
    const models = r.rows[0]?.value ?? DEFAULT_MODELS;
    res.json(models);
  } catch (err) {
    console.error('[media-gen] GET /models:', err.message);
    res.status(500).json({ error: 'Failed to load models.' });
  }
});

/**
 * PUT /models — save org's model list.
 */
router.put('/models', requireAuth, async (req, res) => {
  const { orgId, id: userId } = req.user;
  const models = req.body;
  if (!Array.isArray(models)) return res.status(400).json({ error: 'Body must be an array.' });
  try {
    await pool.query(
      `INSERT INTO system_settings (org_id, key, value, updated_by)
       VALUES ($1, 'fal_models', $2::jsonb, $3)
       ON CONFLICT (org_id, key) DO UPDATE
         SET value=$2::jsonb, updated_by=$3, updated_at=NOW()`,
      [orgId, JSON.stringify(models), userId],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[media-gen] PUT /models:', err.message);
    res.status(500).json({ error: 'Failed to save models.' });
  }
});

/**
 * POST /test-model
 * Body: { modelId }
 * Submits a minimal request to Fal.ai to verify the model ID is valid.
 * Immediately cancels the queued job to avoid burning credits.
 * Returns { ok: true, requestId } or { ok: false, error }.
 */
router.post('/test-model', requireAuth, async (req, res) => {
  const apiKey = process.env.SEEDANCE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'SEEDANCE_API_KEY not configured.' });

  const modelId = (req.body.modelId || '').trim();
  if (!modelId) return res.status(400).json({ error: 'modelId is required.' });

  const modelPath = modelId.startsWith('/') ? modelId : `/${modelId}`;
  const mType     = modelType(modelId);
  const payload   = mType === 'video'
    ? { prompt: 'a test scene', duration: '5', aspect_ratio: '16:9' }
    : { prompt: 'a test image', num_images: 1 };

  try {
    const submitted = await falJson('POST', 'queue.fal.run', modelPath, apiKey, payload);
    const requestId = submitted.request_id;
    if (!requestId) {
      return res.json({ ok: false, error: `No request_id returned. Response: ${JSON.stringify(submitted).slice(0, 200)}` });
    }
    // Cancel immediately (fire-and-forget — ignore cancel errors)
    falJson('PUT', 'queue.fal.run', `${modelPath}/requests/${requestId}/cancel`, apiKey, null)
      .catch(() => {});
    res.json({ ok: true, requestId });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

/**
 * POST /generate
 * Body: multipart/form-data
 *   model         — Fal.ai model ID  (default: fal-ai/seedance-1-lite)
 *   prompt        — text description (required)
 *   duration      — video seconds: "5" | "10"  (default: "5", video only)
 *   aspectRatio   — "16:9" | "9:16" | "1:1" | "4:3" | "3:4"  (default: "16:9")
 *   referenceImage — image file (optional)
 *
 * Streams SSE events:
 *   { type: 'status',    message }
 *   { type: 'submitted', requestId, runId }
 *   { type: 'progress',  status, elapsed }
 *   { type: 'complete',  result, runId, outputType }
 *   { type: 'error',     message }
 */
router.post(
  '/generate',
  requireAuth,
  (req, res, next) => {
    upload.single('referenceImage')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req, res) => {
    const apiKey = process.env.SEEDANCE_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'SEEDANCE_API_KEY is not configured on the server.' });
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders();

    const { id: userId, orgId } = req.user;
    const model       = ((req.body.model       || 'fal-ai/seedance-1-lite')).trim();
    const prompt      = ((req.body.prompt      || '')).trim().slice(0, MAX_PROMPT_LEN);
    const duration    = req.body.duration    || '5';
    const aspectRatio = req.body.aspectRatio || '16:9';
    const outType     = modelType(model);

    if (!prompt) {
      sseWrite(res, { type: 'error', message: 'A prompt is required.' });
      return res.end();
    }

    let runId = null;

    try {
      // 1. Upload reference image if provided
      let imageUrl = null;
      if (req.file) {
        sseWrite(res, { type: 'status', message: 'Uploading reference image to Fal.ai…' });
        imageUrl = await uploadToFalStorage(req.file.buffer, req.file.mimetype, apiKey);
        sseWrite(res, { type: 'status', message: 'Reference image uploaded.' });
      }

      // 2. Build payload and submit
      const payload = buildPayload(model, prompt, imageUrl, { duration, aspectRatio });
      sseWrite(res, { type: 'status', message: 'Submitting generation request…' });

      const modelPath = model.startsWith('/') ? model : `/${model}`;
      const submitted = await falJson('POST', 'queue.fal.run', modelPath, apiKey, payload);
      const requestId = submitted.request_id;

      if (!requestId) {
        throw new Error(`Fal.ai did not return a request_id. Response: ${JSON.stringify(submitted).slice(0, 200)}`);
      }

      // 3. Save pending run
      const ins = await pool.query(
        `INSERT INTO media_gen_runs
           (org_id, user_id, model, output_type, prompt, reference_image_url,
            duration, aspect_ratio, fal_request_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
         RETURNING id`,
        [orgId, userId, model, outType, prompt, imageUrl, duration, aspectRatio, requestId],
      );
      runId = ins.rows[0].id;
      sseWrite(res, { type: 'submitted', requestId, runId });

      // 4. Poll status
      const statusPath = `${modelPath}/requests/${requestId}/status`;
      const startMs    = Date.now();
      let   result     = null;

      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_INTERVAL_MS);

        const statusRes = await falJson('GET', 'queue.fal.run', statusPath, apiKey, null);
        const elapsed   = Math.round((Date.now() - startMs) / 1000);

        if (statusRes.status === 'COMPLETED') {
          // Fetch the result
          result = await falJson('GET', 'queue.fal.run', `${modelPath}/requests/${requestId}`, apiKey, null);
          break;
        }

        if (statusRes.status === 'FAILED') {
          throw new Error(`Fal.ai generation failed: ${JSON.stringify(statusRes).slice(0, 300)}`);
        }

        sseWrite(res, {
          type:    'progress',
          status:  statusRes.status,
          elapsed,
          attempt: i + 1,
        });
      }

      if (!result) {
        throw new Error('Generation timed out after 6 minutes.');
      }

      // 5. Save result
      await pool.query(
        `UPDATE media_gen_runs
         SET status='completed', result=$1, completed_at=NOW()
         WHERE id=$2`,
        [JSON.stringify(result), runId],
      );

      sseWrite(res, { type: 'complete', result, runId, outputType: outType });

    } catch (err) {
      console.error('[media-gen] generation error:', err.message);
      if (runId) {
        await pool.query(
          `UPDATE media_gen_runs SET status='failed', error=$1 WHERE id=$2`,
          [err.message, runId],
        ).catch(() => {});
      }
      sseWrite(res, { type: 'error', message: err.message });
    }

    res.end();
  },
);

/**
 * GET /runs
 * Query: page, limit, search
 */
router.get('/runs', requireAuth, async (req, res) => {
  const { orgId } = req.user;
  const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
  const limit  = Math.min(50, parseInt(req.query.limit, 10) || 20);
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim();

  try {
    const conditions = ['org_id = $1', 'deleted_at IS NULL'];
    const params = [orgId];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`prompt ILIKE $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const [rowsRes, countRes] = await Promise.all([
      pool.query(
        `SELECT id, model, output_type, prompt, status, error,
                duration, aspect_ratio, created_at, completed_at,
                result->'video'->>'url'  AS video_url,
                result->'images'->0->>'url' AS image_url
         FROM media_gen_runs
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      pool.query(`SELECT COUNT(*) FROM media_gen_runs WHERE ${where}`, params),
    ]);

    res.json({
      runs:  rowsRes.rows,
      total: parseInt(countRes.rows[0].count, 10),
      page,
      limit,
    });
  } catch (err) {
    console.error('[media-gen] GET /runs:', err.message);
    res.status(500).json({ error: 'Failed to load run history.' });
  }
});

/**
 * GET /runs/:id
 */
router.get('/runs/:id', requireAuth, async (req, res) => {
  const { orgId } = req.user;
  try {
    const r = await pool.query(
      `SELECT * FROM media_gen_runs WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`,
      [req.params.id, orgId],
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Run not found.' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load run.' });
  }
});

/**
 * DELETE /runs/:id   — soft delete
 */
router.delete('/runs/:id', requireAuth, async (req, res) => {
  const { orgId } = req.user;
  try {
    await pool.query(
      `UPDATE media_gen_runs SET deleted_at=NOW() WHERE id=$1 AND org_id=$2`,
      [req.params.id, orgId],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete run.' });
  }
});

module.exports = router;
