'use strict';

const https = require('https');
const http  = require('http');

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { buildSystemPrompt } = require('./prompt');

const TOOL_SLUG      = 'wp-theme-extractor';
const MAX_HTML_BYTES = 100_000; // ~100KB — enough for structure analysis
const MAX_REDIRECTS  = 5;

function fetchHtml(rawUrl, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));

    let url;
    try { url = new URL(rawUrl); }
    catch { return reject(new Error(`Invalid URL: ${rawUrl}`)); }

    const lib = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port:     url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80),
      path:     (url.pathname || '/') + (url.search || ''),
      method:   'GET',
      headers: {
        'User-Agent':       'Mozilla/5.0 (compatible; WPThemeExtractor/1.0)',
        'Accept':           'text/html,application/xhtml+xml,*/*',
        'Accept-Encoding':  'identity',
        'Cache-Control':    'no-cache',
      },
      timeout: 20_000,
    };

    const req = lib.request(options, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${url.protocol}//${url.hostname}${res.headers.location}`;
        return fetchHtml(next, redirectsLeft - 1).then(resolve).catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} fetching ${rawUrl}`));
      }

      const chunks = [];
      let total = 0;

      res.on('data', (chunk) => {
        total += chunk.length;
        if (total <= MAX_HTML_BYTES) {
          chunks.push(chunk);
        } else {
          const remaining = MAX_HTML_BYTES - (total - chunk.length);
          if (remaining > 0) chunks.push(chunk.slice(0, remaining));
          res.destroy();
        }
      });

      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });

    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out after 20s')); });
    req.end();
  });
}

function preClean(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{3,}/g, '  ');
}

function parseThemeJson(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const start = stripped.indexOf('{');
  const end   = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model response');
  return JSON.parse(stripped.slice(start, end + 1));
}

async function runWpThemeExtractor(context) {
  const { req, emit } = context;

  const url      = (req?.body?.url ?? '').trim();
  const pageType = req?.body?.pageType ?? 'homepage'; // 'homepage' | 'post-page'

  if (!url) throw new Error('URL is required');

  const adminConfig = await AgentConfigService.getAdminConfig(TOOL_SLUG);

  emit(`Fetching ${url}…`);

  let rawHtml;
  try {
    rawHtml = await fetchHtml(url);
  } catch (e) {
    throw new Error(`Could not fetch URL: ${e.message}`);
  }

  const html    = preClean(rawHtml);
  const sizeKb  = Math.round(Buffer.byteLength(html, 'utf-8') / 1024);
  const mainFilename = pageType === 'post-page' ? 'single.php' : 'front-page.php';

  emit(`Fetched ${sizeKb}KB of HTML. Generating WordPress theme…`);

  const userMessage =
    `URL: ${url}\n` +
    `Page type toggle: ${pageType === 'post-page' ? 'Post/Page' : 'Homepage'}\n` +
    `Set mainTemplate.filename to "${mainFilename}".\n\n` +
    `HTML (may be truncated at 100KB):\n---\n${html}\n---`;

  const { result: raw, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(),
    userMessage,
    tools:         [],
    maxIterations: 1,
    model:         adminConfig.model          ?? 'claude-sonnet-4-6',
    maxTokens:     adminConfig.max_tokens     ?? 16384,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context:       { ...context, toolSlug: TOOL_SLUG },
  });

  const rawText = raw?.summary ?? '';

  let files;
  try {
    files = parseThemeJson(rawText);
  } catch (e) {
    throw new Error(`Theme JSON parse failed: ${e.message}. Raw (first 300 chars): ${rawText.slice(0, 300)}`);
  }

  return {
    result: {
      summary: files.summary ?? 'WP theme extracted successfully.',
      data: {
        files,
        url,
        pageType,
        mainFilename,
        fetchedKb: sizeKb,
      },
    },
    trace,
    tokensUsed,
  };
}

module.exports = { runWpThemeExtractor };
