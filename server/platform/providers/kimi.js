'use strict';

const { createAdapter } = require('./openai-compatible');

module.exports = createAdapter({
  hostname: 'api.moonshot.ai',
  path:     '/v1/chat/completions',
  envVar:   'KIMI_API_KEY',
  label:    'Kimi',
});
