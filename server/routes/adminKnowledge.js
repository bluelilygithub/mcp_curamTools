'use strict';

/**
 * adminKnowledge.js — Knowledge base document management.
 * All routes require org_admin.
 *
 * Routes:
 *   POST   /api/admin/knowledge/upload  — upload PDF / DOCX / TXT / MD, extract text, embed + store
 *   POST   /api/admin/knowledge/text    — add a document by pasting raw text
 *   GET    /api/admin/knowledge         — list stored documents for this org
 *   DELETE /api/admin/knowledge/:id     — remove a document by embeddings row id
 */

const express  = require('express');
const multer   = require('multer');
const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');
const { pool } = require('../db');
const { requireAuth }  = require('../middleware/requireAuth');
const { requireRole }  = require('../middleware/requireRole');
const EmbeddingService = require('../services/EmbeddingService');

const router = express.Router();
router.use(requireAuth, requireRole(['org_admin']));

// ── Multer — memory storage, 15 MB cap ───────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok = /\.(pdf|docx|txt|md)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only PDF, DOCX, TXT, and MD files are supported.'), ok);
  },
});

// ── Text extraction ───────────────────────────────────────────────────────────

async function extractText(file) {
  const ext = file.originalname.split('.').pop().toLowerCase();

  if (ext === 'pdf') {
    const data = await pdfParse(file.buffer);
    return data.text;
  }

  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }

  // txt / md — raw UTF-8
  return file.buffer.toString('utf8');
}

function cleanText(raw) {
  return raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars except \t \n \r
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')                          // collapse 3+ blank lines → 2
    .trim();
}

function makeSourceId(title) {
  return `doc_${title.toLowerCase().replace(/\W+/g, '_').slice(0, 60)}_${Date.now()}`;
}

// ── POST /upload ──────────────────────────────────────────────────────────────

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const title    = req.body.title?.trim() || req.file.originalname.replace(/\.[^.]+$/, '');
  const category = req.body.category?.trim() || null;
  const orgId    = req.user.orgId;

  let rawText;
  try {
    rawText = await extractText(req.file);
  } catch (err) {
    return res.status(422).json({ error: `Could not extract text: ${err.message}` });
  }

  const content = cleanText(rawText);
  if (!content) return res.status(422).json({ error: 'No readable text found in this file.' });

  const sourceId = makeSourceId(title);
  const metadata = {
    title,
    category,
    filename:   req.file.originalname,
    file_type:  req.file.originalname.split('.').pop().toLowerCase(),
    char_count: content.length,
    added_at:   new Date().toISOString(),
  };

  try {
    await EmbeddingService.embedAndStore({ orgId, sourceType: 'document', sourceId, content, metadata });
  } catch (err) {
    return res.status(500).json({ error: `Embedding failed: ${err.message}` });
  }

  res.json({ ok: true, sourceId, title, charCount: content.length });
});

// ── POST /text ────────────────────────────────────────────────────────────────

router.post('/text', async (req, res) => {
  const { title, content: rawContent, category } = req.body;
  if (!title?.trim())      return res.status(400).json({ error: 'title is required.' });
  if (!rawContent?.trim()) return res.status(400).json({ error: 'content is required.' });

  const content  = cleanText(rawContent);
  const orgId    = req.user.orgId;
  const sourceId = makeSourceId(title.trim());
  const metadata = {
    title:      title.trim(),
    category:   category?.trim() || null,
    file_type:  'text',
    char_count: content.length,
    added_at:   new Date().toISOString(),
  };

  try {
    await EmbeddingService.embedAndStore({ orgId, sourceType: 'document', sourceId, content, metadata });
  } catch (err) {
    return res.status(500).json({ error: `Embedding failed: ${err.message}` });
  }

  res.json({ ok: true, sourceId, title: title.trim(), charCount: content.length });
});

// ── GET / ─────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, source_id, metadata, created_at
         FROM embeddings
        WHERE org_id = $1 AND source_type = 'document'
        ORDER BY created_at DESC`,
      [req.user.orgId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load documents.' });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM embeddings WHERE id = $1 AND org_id = $2 AND source_type = 'document' RETURNING id`,
      [req.params.id, req.user.orgId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete document.' });
  }
});

module.exports = router;
