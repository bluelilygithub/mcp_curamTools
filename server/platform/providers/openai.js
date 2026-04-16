'use strict';

const { createAdapter } = require('./openai-compatible');

module.exports = createAdapter({
  hostname: 'api.openai.com',
  path:     '/v1/chat/completions',
  envVar:   'OPENAI_API_KEY',
  label:    'OpenAI',
});
