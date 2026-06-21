'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = __dirname;

/**
 * Lightweight migration runner — versioned, one transaction per migration.
 * Baseline tables live in db.js initSchema(); incremental changes go here.
 */

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrationIds(pool) {
  const { rows } = await pool.query(
    'SELECT id FROM schema_migrations ORDER BY id'
  );
  return new Set(rows.map((row) => row.id));
}

function loadMigrations() {
  const indexPath = path.join(MIGRATIONS_DIR, 'index.js');
  if (fs.existsSync(indexPath)) {
    return require('./index');
  }
  return [];
}

async function runMigrations(pool, { log = console.log } = {}) {
  await ensureMigrationsTable(pool);
  const applied = await getAppliedMigrationIds(pool);
  const migrations = loadMigrations();

  for (const migration of migrations) {
    if (!migration?.id || !migration?.name || typeof migration.up !== 'function') {
      throw new Error(`Invalid migration module: ${JSON.stringify(migration?.id ?? migration?.name ?? 'unknown')}`);
    }
    if (applied.has(migration.id)) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await migration.up(client);
      await client.query(
        'INSERT INTO schema_migrations (id, name) VALUES ($1, $2)',
        [migration.id, migration.name]
      );
      await client.query('COMMIT');
      log(`[migrations] Applied ${migration.id}_${migration.name}`);
    } catch (err) {
      await client.query('ROLLBACK');
      err.message = `Migration ${migration.id}_${migration.name} failed: ${err.message}`;
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = {
  ensureMigrationsTable,
  getAppliedMigrationIds,
  loadMigrations,
  runMigrations,
};
