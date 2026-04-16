'use strict';

const { createAdapter } = require('./openai-compatible');

module.exports = createAdapter({
  hostname: 'api.x.ai',
  path:     '/v1/chat/completions',
  envVar:   'XAI_API_KEY',
  label:    'xAI (Grok)',
});
