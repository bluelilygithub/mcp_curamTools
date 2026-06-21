'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getAppliedMigrationIds, loadMigrations } = require('./runner');

test('loadMigrations returns ordered registry with id, name, up', () => {
  const migrations = loadMigrations();
  assert.ok(migrations.length >= 3);
  const ids = migrations.map((m) => m.id);
  assert.deepEqual(ids, [...ids].sort());
  for (const migration of migrations) {
    assert.match(migration.id, /^\d{3}$/);
    assert.ok(migration.name);
    assert.equal(typeof migration.up, 'function');
  }
});

test('getAppliedMigrationIds returns set of applied ids', async () => {
  const pool = {
    query: async () => ({ rows: [{ id: '001' }, { id: '002' }] }),
  };
  const applied = await getAppliedMigrationIds(pool);
  assert.equal(applied.size, 2);
  assert.ok(applied.has('001'));
  assert.ok(applied.has('002'));
});
