'use strict';

/**
 * Export route — server-side PDF generation via headless Chromium.
 *
 * POST /api/export/pdf
 *   Body: { content, contentType?, title?, filename?, extraStyles? }
 *   contentType: 'markdown' (default) | 'html'
 *   Returns: application/pdf
 *
 * Uses puppeteer-core + system Chromium (installed via apk in Dockerfile).
 * Falls back gracefully if Chromium is not available.
 *
 * Reusable: any tool in the platform calls this endpoint — do not add
 * tool-specific logic here. Keep it a generic HTML/markdown → PDF converter.
 */

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { getChromiumPath, renderMarkdownOrHtmlToPdfBuffer } = require('../services/markdownPdfBuffer');

const router = express.Router();
router.use(requireAuth);

router.post('/pdf', async (req, res) => {
  const {
    content,
    contentType = 'markdown',
    title       = 'Export',
    filename    = 'export.pdf',
    extraStyles = '',
  } = req.body ?? {};

  if (!content) {
    return res.status(400).json({ error: 'content is required' });
  }

  if (!getChromiumPath()) {
    return res.status(503).json({
      error: 'PDF export is not available in this environment (Chromium not found). Use text export instead.',
    });
  }

  try {
    const pdfBuffer = await renderMarkdownOrHtmlToPdfBuffer({
      content,
      contentType,
      title,
      extraStyles,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch (err) {
    console.error('[export/pdf] Puppeteer error:', err.message);
    return res.status(500).json({ error: 'PDF generation failed: ' + err.message });
  }
});

module.exports = router;
