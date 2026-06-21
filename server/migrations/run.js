#!/usr/bin/env node
'use strict';

/**
 * Standalone migration runner — applies pending migrations without starting the server.
 *
 *   node migrations/run.js
 *   npm run migrate
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { pool } = require('../db');
const { runMigrations } = require('./runner');

runMigrations(pool)
  .then(() => {
    console.log('[migrations] Up to date');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[migrations] Failed:', err.message);
    process.exit(1);
  });
