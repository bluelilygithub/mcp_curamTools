#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { AUDIT_DIR } = require('./audit');

const lastRunMd = path.join(AUDIT_DIR, 'LAST_RUN.md');
const lastRunJson = path.join(AUDIT_DIR, 'last-run.json');

if (!fs.existsSync(lastRunMd)) {
  console.log('No test audit yet. Run: npm run test:unit  or  npm test');
  process.exit(0);
}

console.log(fs.readFileSync(lastRunMd, 'utf8'));

if (fs.existsSync(lastRunJson)) {
  console.log('---');
  console.log('JSON:', lastRunJson);
}
