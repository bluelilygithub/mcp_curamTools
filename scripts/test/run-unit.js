#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');
const { writeAudit, parseNodeTestSummary, gitShortSha, ROOT } = require('./audit');

const SERVER = path.join(ROOT, 'server');
const started = Date.now();

const testFiles = [
  'constants/embeddingModels.test.js',
  'services/CostGuardService.test.js',
  'services/ExtractionValidationService.test.js',
  'services/FileIntakeService.test.js',
  'agents/docExtractor/index.test.js',
];

const result = spawnSync(
  process.execPath,
  ['--test', ...testFiles],
  { cwd: SERVER, encoding: 'utf8' },
);

const output = `${result.stdout || ''}${result.stderr || ''}`;
const nodeTest = parseNodeTestSummary(output);
const passed = result.status === 0;

writeAudit({
  suite: 'unit',
  command: 'npm run test:unit',
  passed,
  exitCode: result.status ?? 1,
  durationMs: Date.now() - started,
  nodeTest,
  gitCommit: gitShortSha(),
  hostname: os.hostname(),
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

process.exit(passed ? 0 : 1);
