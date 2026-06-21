'use strict';

/**
 * One-off data patches for system_settings JSON values.
 */

module.exports = {
  id: '003',
  name: 'system_settings_data_patches',

  async up(client) {
    // doc-extractor max_tokens stored at old default of 4096 — bump to 16384.
    await client.query(`
      UPDATE system_settings
         SET value = jsonb_set(value, '{max_tokens}', '16384'::jsonb)
       WHERE key = 'agent_doc_extractor'
         AND (value->>'max_tokens')::int <= 4096
    `);
  },
};
