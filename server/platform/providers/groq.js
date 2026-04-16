'use strict';

const { createAdapter } = require('./openai-compatible');

module.exports = createAdapter({
  hostname: 'api.groq.com',
  path:     '/openai/v1/chat/completions',
  envVar:   'GROQ_API_KEY',
  label:    'Groq',
});
