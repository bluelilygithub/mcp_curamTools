'use strict';

const path = require('path');
const { localServer } = require('./manifest.shared');

const SERVER_DIR = __dirname;

const CORE_MCP_SERVERS = [
  {
    name: 'platform',
    ...localServer(path.join(SERVER_DIR, 'platform.js'), ['DATABASE_URL']),
  },
  {
    name: 'knowledge-base',
    ...localServer(path.join(SERVER_DIR, 'knowledge-base.js'), ['DATABASE_URL']),
  },
  {
    name: 'personal-memory',
    ...localServer(path.join(SERVER_DIR, 'personal-memory.js'), ['DATABASE_URL']),
  },
  {
    name: 'storage',
    ...localServer(path.join(SERVER_DIR, 'storage.js'), [
      'DATABASE_URL',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_S3_BUCKET',
      'AWS_S3_REGION',
      'STORAGE_MAX_UPLOAD_BYTES',
    ]),
  },
];

module.exports = { CORE_MCP_SERVERS };
