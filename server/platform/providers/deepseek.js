'use strict';

const { createAdapter } = require('./openai-compatible');

module.exports = createAdapter({
  hostname: 'api.deepseek.com',
  path:     '/v1/chat/completions',
  envVar:   'DEEPSEEK_API_KEY',
  label:    'DeepSeek',
});
