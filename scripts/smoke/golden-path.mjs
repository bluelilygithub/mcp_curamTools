#!/usr/bin/env node
/**
 * Golden-path smoke — least-disruptive platform stability check.
 *
 * Does NOT call live agent APIs, Anthropic, S3, or the database.
 * Validates that shared server modules load and (when Chromium exists)
 * the markdown → PDF path used by export and demo email still produces bytes.
 *
 * Run from repository root (after `cd server && npm install`):
 *   npm run smoke:golden-path
 *   npm test
 *
 * Exit codes: 0 success, 1 failure. Phase 2 skips with exit 0 if no Chromium.
 */
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);

function log(msg) {
  console.log(`[golden-path] ${msg}`);
}

async function main() {
  log('Phase 1: load platform modules (no HTTP, no DB, no API keys)...');

  require(path.join(root, 'server', 'services', 'markdownPdfBuffer.js'));
  require(path.join(root, 'server', 'routes', 'export.js'));
  require(path.join(root, 'server', 'platform', 'createAgentRoute.js'));

  const tenderPath = path.join(root, 'server', 'agents', 'demoSuite', 'tenderResponse', 'index.js');
  if (!fs.existsSync(tenderPath)) {
    throw new Error(`Missing tender agent file: ${tenderPath}`);
  }
  const tenderSrc = fs.readFileSync(tenderPath, 'utf8');
  if (!tenderSrc.includes('runTenderResponse') || !tenderSrc.includes('module.exports')) {
    throw new Error('tenderResponse/index.js should export runTenderResponse');
  }
  const chk = spawnSync(process.execPath, ['--check', tenderPath], { encoding: 'utf8' });
  if (chk.status !== 0) {
    throw new Error(`tender agent syntax check failed: ${chk.stderr || chk.stdout || 'unknown'}`);
  }

  log('Phase 1 OK — markdownPdfBuffer, export route, createAgentRoute, tender agent file present and parseable.');

  const {
    getChromiumPath,
    renderMarkdownOrHtmlToPdfBuffer,
  } = require(path.join(root, 'server', 'services', 'markdownPdfBuffer.js'));

  const chromiumPath = getChromiumPath();
  if (!chromiumPath) {
    log('Phase 2 SKIP: no system Chromium found (markdown→PDF not exercised — normal on many dev machines).');
    log('Golden path smoke finished successfully.');
    return;
  }

  log(`Phase 2: markdown → PDF via Puppeteer (${chromiumPath})...`);
  const buf = await renderMarkdownOrHtmlToPdfBuffer({
    content:     '# Golden path\n\nShared **markdownPdfBuffer** smoke — demo exports use this path.',
    contentType: 'markdown',
    title:       'Golden path smoke',
  });

  if (!Buffer.isBuffer(buf) || buf.length < 400) {
    throw new Error(`PDF buffer missing or too small (${buf?.length ?? 0} bytes)`);
  }

  log(`Phase 2 OK — PDF buffer ${buf.length} bytes.`);
  log('Golden path smoke finished successfully.');
}

main().catch((err) => {
  console.error('[golden-path] FAILED:', err?.message ?? err);
  process.exit(1);
});
