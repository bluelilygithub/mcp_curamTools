'use strict';

const https = require('https');
const http  = require('http');

const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { buildSystemPrompt } = require('./prompt');

const TOOL_SLUG       = 'wp-theme-extractor';
const MAX_HTML_BYTES  = 80_000;  // HTML structure after CSS stripped
const MAX_CSS_BYTES   = 60_000;  // inline + external CSS combined
const MAX_EXT_CSS     = 3;       // max external stylesheets to fetch
const MAX_REDIRECTS   = 5;

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
        'User-Agent':      'Mozilla/5.0 (compatible; WPThemeExtractor/1.0)',
        'Accept':          'text/html,text/css,application/xhtml+xml,*/*',
        'Accept-Encoding': 'identity',
        'Cache-Control':   'no-cache',
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
      const limit = 200_000; // generous fetch limit; callers slice as needed

      res.on('data', (chunk) => {
        total += chunk.length;
        if (total <= limit) {
          chunks.push(chunk);
        } else {
          const remaining = limit - (total - chunk.length);
          if (remaining > 0) chunks.push(chunk.slice(0, remaining));
          res.destroy();
        }
      });

      res.on('end',   () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });

    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out after 20s')); });
    req.end();
  });
}

// ── CSS extraction helpers ─────────────────────────────────────────────────

function extractStyleBlocks(html) {
  const parts = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const content = m[1].trim();
    if (content) parts.push(content);
  }
  return parts.join('\n\n');
}

function stripStyleBlocks(html) {
  return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
}

function extractLinkedCssUrls(html, baseUrl) {
  const urls = [];
  // match both attribute orders: rel then href, href then rel
  const patterns = [
    /<link\b[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
    /<link\b[^>]+href=["']([^"']+)["'][^>]+rel=["']stylesheet["'][^>]*\/?>/gi,
  ];
  const skip = ['fonts.googleapis', 'fontawesome', 'font-awesome', 'cdn.jsdelivr',
                'cdnjs.cloudflare', 'ajax.googleapis', 'print', 'admin-bar'];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const href = m[1];
      if (!href || skip.some(s => href.includes(s))) continue;
      try {
        const absolute = href.startsWith('http') ? href : new URL(href, baseUrl).href;
        if (!urls.includes(absolute)) urls.push(absolute);
      } catch { /* skip invalid URLs */ }
    }
  }
  return urls.slice(0, MAX_EXT_CSS);
}

// ── HTML cleaner ───────────────────────────────────────────────────────────

function preClean(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{3,}/g, '  ');
}

// ── JSON parser ────────────────────────────────────────────────────────────

function parseThemeJson(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const start = stripped.indexOf('{');
  const end   = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model response');
  return JSON.parse(stripped.slice(start, end + 1));
}

// ── Main agent function ────────────────────────────────────────────────────

async function runWpThemeExtractor(context) {
  const { req, emit } = context;

  const url        = (req?.body?.url  ?? '').trim();
  const pastedHtml = (req?.body?.html ?? '').trim();
  const pageType   =  req?.body?.pageType ?? 'homepage';

  if (!url && !pastedHtml) throw new Error('Provide either a URL or paste HTML directly.');

  const adminConfig = await AgentConfigService.getAdminConfig(TOOL_SLUG);

  let rawHtml;
  let sourceLabel;

  if (pastedHtml) {
    rawHtml     = pastedHtml.slice(0, 500_000); // generous for pasted content
    sourceLabel = 'pasted HTML';
    emit('Processing pasted HTML…');
  } else {
    emit(`Fetching ${url}…`);
    try {
      rawHtml = await fetchHtml(url);
    } catch (e) {
      throw new Error(`Could not fetch URL: ${e.message}`);
    }
    sourceLabel = url;
  }

  // ── CSS extraction ───────────────────────────────────────────────────────

  emit('Extracting CSS…');

  const inlineCss = extractStyleBlocks(rawHtml);

  // Fetch external stylesheets (works for both URL and paste modes — parse link tags)
  const baseUrl     = url || 'https://example.com';
  const cssUrls     = extractLinkedCssUrls(rawHtml, baseUrl);
  const cssResults  = await Promise.allSettled(
    cssUrls.map(u => fetchHtml(u).catch(() => ''))
  );
  const externalCss = cssResults
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value)
    .join('\n\n')
    .slice(0, MAX_CSS_BYTES);

  const allCss = [inlineCss, externalCss].filter(Boolean).join('\n\n').slice(0, MAX_CSS_BYTES);

  if (cssUrls.length > 0) {
    const fetched = cssResults.filter(r => r.status === 'fulfilled' && r.value).length;
    emit(`Fetched ${fetched}/${cssUrls.length} linked stylesheet(s)…`);
  }

  // ── HTML structure ───────────────────────────────────────────────────────

  const htmlBody = preClean(stripStyleBlocks(rawHtml))
    .slice(0, Buffer.byteLength(preClean(stripStyleBlocks(rawHtml)), 'utf-8') > MAX_HTML_BYTES
      ? MAX_HTML_BYTES
      : undefined);

  const cssKb  = Math.round(Buffer.byteLength(allCss,  'utf-8') / 1024);
  const htmlKb = Math.round(Buffer.byteLength(htmlBody,'utf-8') / 1024);

  emit(`${cssKb}KB CSS + ${htmlKb}KB HTML ready. Generating WordPress theme…`);

  const mainFilename = pageType === 'post-page' ? 'single.php' : 'front-page.php';

  const userMessage =
    `Source: ${sourceLabel}\n` +
    `Page type toggle: ${pageType === 'post-page' ? 'Post/Page' : 'Homepage'}\n` +
    `Set mainTemplate.filename to "${mainFilename}".\n\n` +
    (allCss
      ? `SITE CSS (${cssKb}KB — inline <style> blocks${externalCss ? ' + linked stylesheets' : ''} — use these values directly for colours, fonts, spacing):\n---\n${allCss}\n---\n\n`
      : '') +
    `HTML structure (scripts, inline styles, comments stripped; may be truncated):\n---\n${htmlBody}\n---`;

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
        url: sourceLabel,
        pageType,
        mainFilename,
        cssKb,
        htmlKb,
      },
    },
    trace,
    tokensUsed,
  };
}

module.exports = { runWpThemeExtractor };
