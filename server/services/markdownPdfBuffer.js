'use strict';

/**
 * markdownPdfBuffer — shared markdown/HTML → PDF buffer for export route and demo email.
 * Mirrors server/routes/export.js rendering so email attachments match downloaded PDFs.
 */

const puppeteer = require('puppeteer-core');
const { marked } = require('marked');
const fs         = require('fs');

function getChromiumPath() {
  const candidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* skip */ }
  }
  return null;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtmlShell({ title, bodyHtml, extraStyles = '' }) {
  const date = new Date().toLocaleString('en-AU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>${escHtml(title || 'Export')}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Georgia', 'Times New Roman', serif;
    font-size: 13px;
    line-height: 1.7;
    color: #1a1a1a;
    background: #fff;
    padding: 32px 40px;
    max-width: 900px;
    margin: 0 auto;
  }

  .export-header {
    border-bottom: 2px solid #1a1a1a;
    padding-bottom: 10px;
    margin-bottom: 24px;
  }
  .export-header h1 {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .export-header .meta {
    font-size: 11px;
    color: #666;
    margin-top: 4px;
    font-family: 'Helvetica Neue', Arial, sans-serif;
  }

  h1, h2, h3, h4 {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-weight: 700;
    margin-top: 1.6em;
    margin-bottom: 0.5em;
    line-height: 1.3;
    color: #111;
  }
  h1 { font-size: 18px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
  h2 { font-size: 15px; }
  h3 { font-size: 13px; }
  h4 { font-size: 12px; color: #444; }

  p { margin: 0.6em 0; }

  ul, ol { padding-left: 1.4em; margin: 0.5em 0; }
  li { margin: 0.2em 0; }

  strong, b { font-weight: 700; }
  em, i { font-style: italic; }

  code {
    font-family: 'Courier New', monospace;
    font-size: 11.5px;
    background: #f4f4f4;
    border: 1px solid #e0e0e0;
    border-radius: 3px;
    padding: 1px 4px;
  }
  pre {
    background: #f4f4f4;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 10px 12px;
    overflow-x: auto;
    margin: 0.8em 0;
  }
  pre code { background: none; border: none; padding: 0; }

  blockquote {
    border-left: 3px solid #ccc;
    padding-left: 12px;
    color: #555;
    margin: 0.8em 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.8em 0;
    font-size: 12px;
  }
  th {
    background: #f0f0f0;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 6px 10px;
    border: 1px solid #ddd;
    text-align: left;
  }
  td {
    padding: 5px 10px;
    border: 1px solid #ddd;
    vertical-align: top;
  }
  tr:nth-child(even) td { background: #fafafa; }

  hr { border: none; border-top: 1px solid #ddd; margin: 1.2em 0; }

  a { color: #1a1a1a; text-decoration: underline; }

  .chat-turn { margin: 10px 0; }
  .chat-role {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #888;
    margin-bottom: 4px;
  }
  .chat-bubble {
    padding: 9px 13px;
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
  }
  .chat-bubble.user {
    background: #f0f4ff;
    border-left: 3px solid #4a6cf7;
  }
  .chat-bubble.assistant {
    background: #f8f8f8;
    border-left: 3px solid #bbb;
  }
  .chat-divider {
    border: none;
    border-top: 1px solid #e8e8e8;
    margin: 8px 0;
  }

  @media print {
    body { padding: 0; }
    .export-header { page-break-after: avoid; }
    h1, h2, h3 { page-break-after: avoid; }
    pre, table, blockquote { page-break-inside: avoid; }
  }

  ${extraStyles}
</style>
</head>
<body>
  <div class="export-header">
    <h1>${escHtml(title || 'Export')}</h1>
    <p class="meta">Exported ${date}</p>
  </div>
  <div class="export-body">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

/**
 * @param {object} opts
 * @param {string} opts.content
 * @param {string} [opts.contentType] 'markdown' | 'html'
 * @param {string} [opts.title]
 * @param {string} [opts.extraStyles]
 * @returns {Promise<Buffer>}
 */
async function renderMarkdownOrHtmlToPdfBuffer({
  content,
  contentType = 'markdown',
  title       = 'Export',
  extraStyles = '',
}) {
  if (!content) {
    throw new Error('content is required');
  }

  const chromiumPath = getChromiumPath();
  if (!chromiumPath) {
    throw new Error('PDF export is not available in this environment (Chromium not found).');
  }

  let bodyHtml;
  if (contentType === 'html') {
    bodyHtml = content;
  } else {
    bodyHtml = marked.parse(content, { gfm: true, breaks: false });
  }

  const fullHtml = buildHtmlShell({ title, bodyHtml, extraStyles });

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromiumPath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
      ],
      headless: true,
    });

    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

    return await page.pdf({
      format:              'A4',
      printBackground:     true,
      margin:              { top: '20mm', right: '18mm', bottom: '20mm', left: '18mm' },
      displayHeaderFooter: true,
      headerTemplate:      '<div></div>',
      footerTemplate:      `<div style="font-size:9px;color:#aaa;width:100%;text-align:center;padding:4px 0">
                            Page <span class="pageNumber"></span> of <span class="totalPages"></span>
                          </div>`,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = {
  getChromiumPath,
  renderMarkdownOrHtmlToPdfBuffer,
};
