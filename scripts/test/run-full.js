#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');
const { writeAudit, parseNodeTestSummary, gitShortSha, ROOT } = require('./audit');

const started = Date.now();
const phases = [];

function runPhase(name, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    stdio: options.inheritOutput ? 'inherit' : 'pipe',
  });

  const output = options.inheritOutput ? '' : `${result.stdout || ''}${result.stderr || ''}`;
  if (!options.inheritOutput) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  const phase = {
    name,
    passed: result.status === 0,
    exitCode: result.status ?? 1,
  };

  if (name === 'unit') {
    phase.nodeTest = parseNodeTestSummary(output);
  }
  if (name === 'smoke') {
    phase.smokeSkipped = output.includes('Phase 2 SKIP');
  }

  phases.push(phase);
  return result.status === 0;
}

const unitOk = runPhase(
  'unit',
  process.execPath,
  [path.join(ROOT, 'scripts', 'test', 'run-unit.js')],
  { inheritOutput: true },
);

const smokeOk = unitOk
  ? runPhase('smoke', process.execPath, [path.join(ROOT, 'scripts', 'smoke', 'golden-path.mjs')], { inheritOutput: true })
  : false;

const passed = unitOk && smokeOk;
const unitPhase = phases.find((p) => p.name === 'unit');
const smokePhase = phases.find((p) => p.name === 'smoke');

writeAudit({
  suite: 'full',
  command: 'npm test',
  passed,
  exitCode: passed ? 0 : 1,
  durationMs: Date.now() - started,
  nodeTest: unitPhase?.nodeTest ?? null,
  smokeSkipped: smokePhase?.smokeSkipped ?? false,
  phases,
  gitCommit: gitShortSha(),
  hostname: os.hostname(),
});

process.exit(passed ? 0 : 1);
