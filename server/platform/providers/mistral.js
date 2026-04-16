'use strict';

const { createAdapter } = require('./openai-compatible');

module.exports = createAdapter({
  hostname: 'api.mistral.ai',
  path:     '/v1/chat/completions',
  envVar:   'MISTRAL_API_KEY',
  label:    'Mistral',
});
