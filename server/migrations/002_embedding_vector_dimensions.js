'use strict';

const { EMBEDDING_DIM } = require('../constants/embeddingModels');

/**
 * Align embeddings.personal_thoughts vector columns to the configured dimension.
 * Clears existing vectors when the column type changes (irreversible).
 */

async function migrateEmbeddingVectorDim(client, targetDim) {
  for (const table of ['embeddings', 'personal_thoughts']) {
    const { rows } = await client.query(`
      SELECT format_type(a.atttypid, a.atttypmod) AS coltype
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = $1 AND a.attname = 'embedding' AND NOT a.attisdropped
    `, [table]);

    const coltype = rows[0]?.coltype || '';
    const expected = `vector(${targetDim})`;
    if (coltype === expected) continue;
    if (!coltype.startsWith('vector(')) continue;

    console.warn(`[migrations] Migrating ${table}.embedding to ${expected} — existing vectors cleared`);
    await client.query(`UPDATE ${table} SET embedding = NULL WHERE embedding IS NOT NULL`);
    await client.query(`ALTER TABLE ${table} DROP COLUMN embedding`);
    await client.query(`ALTER TABLE ${table} ADD COLUMN embedding ${expected}`);
  }
}

module.exports = {
  id: '002',
  name: 'embedding_vector_dimensions',

  async up(client) {
    await migrateEmbeddingVectorDim(client, EMBEDDING_DIM);
  },
};
