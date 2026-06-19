'use strict';

const path = require('path');

const SERVER_DIR = __dirname;

function localServer(file, requiredEnv = []) {
  return {
    transportType: 'stdio',
    endpointUrl: null,
    config: {
      command: process.execPath,
      args: [path.join(SERVER_DIR, file)],
      requiredEnv,
    },
  };
}

const BUILTIN_MCP_SERVERS = [
  {
    name: 'google-ads',
    ...localServer('google-ads.js', [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REFRESH_TOKEN',
      'GOOGLE_ADS_CUSTOMER_ID',
      'GOOGLE_ADS_MANAGER_ID',
      'GOOGLE_ADS_DEVELOPER_TOKEN',
      'GOOGLE_ADS_ALLOWED_CUSTOMER_IDS',
    ]),
  },
  {
    name: 'google-analytics',
    ...localServer('google-analytics.js', [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REFRESH_TOKEN',
      'GOOGLE_GA4_PROPERTY_ID',
    ]),
  },
  {
    name: 'wordpress',
    ...localServer('wordpress.js', [
      'WP_DB_HOST',
      'WP_DB_NAME',
      'WP_DB_USER',
      'WP_DB_PASS',
      'WP_DB_PORT',
    ]),
  },
  {
    name: 'platform',
    ...localServer('platform.js', ['DATABASE_URL']),
  },
  {
    name: 'knowledge-base',
    ...localServer('knowledge-base.js', ['DATABASE_URL', 'OPENAI_API_KEY']),
  },
  {
    name: 'personal-memory',
    ...localServer('personal-memory.js', ['DATABASE_URL', 'OPENAI_API_KEY']),
  },
  {
    name: 'storage',
    ...localServer('storage.js', [
      'DATABASE_URL',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_S3_BUCKET',
      'AWS_S3_REGION',
      'STORAGE_MAX_UPLOAD_BYTES',
    ]),
  },
];

module.exports = { BUILTIN_MCP_SERVERS };
