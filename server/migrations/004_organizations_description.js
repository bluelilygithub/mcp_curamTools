'use strict';

/** Add operator notes field to organizations. */
module.exports = {
  id: '004',
  name: 'organizations_description',
  async up(client) {
    await client.query(`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS description TEXT
    `);
  },
};
