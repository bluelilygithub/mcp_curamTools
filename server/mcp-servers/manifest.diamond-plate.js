'use strict';

const path = require('path');
const { localServer } = require('./manifest.shared');

const SERVER_DIR = __dirname;

const DIAMOND_PLATE_MCP_SERVERS = [
  {
    name: 'google-ads',
    ...localServer(path.join(SERVER_DIR, 'google-ads.js'), [
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
    ...localServer(path.join(SERVER_DIR, 'google-analytics.js'), [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REFRESH_TOKEN',
      'GOOGLE_GA4_PROPERTY_ID',
    ]),
  },
  {
    name: 'wordpress',
    ...localServer(path.join(SERVER_DIR, 'wordpress.js'), [
      'WP_DB_HOST',
      'WP_DB_NAME',
      'WP_DB_USER',
      'WP_DB_PASS',
      'WP_DB_PORT',
    ]),
  },
];

module.exports = { DIAMOND_PLATE_MCP_SERVERS };
