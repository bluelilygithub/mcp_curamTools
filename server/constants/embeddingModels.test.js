'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EMBEDDING_DIM,
  getEmbeddingModelById,
  listEmbeddingModels,
  validateEmbeddingModelSelection,
  isProviderConfigured,
} = require('./embeddingModels');

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('EMBEDDING_DIM is 768 for platform vector columns', () => {
  assert.equal(EMBEDDING_DIM, 768);
});

test('getEmbeddingModelById returns registry entry for known models', () => {
  const model = getEmbeddingModelById('text-embedding-004');
  assert.equal(model.provider, 'google');
  assert.equal(model.dimensions, 768);
  assert.equal(model.envVar, 'GEMINI_API_KEY');
});

test('getEmbeddingModelById returns null for chat model ids', () => {
  assert.equal(getEmbeddingModelById('deepseek-v4-flash'), null);
  assert.equal(getEmbeddingModelById('kimi-k2.6'), null);
});

test('validateEmbeddingModelSelection rejects empty selection', () => {
  const result = validateEmbeddingModelSelection(null);
  assert.equal(result.valid, false);
  assert.match(result.issues[0], /Select an embedding model/);
});

test('validateEmbeddingModelSelection rejects chat models', () => {
  const result = validateEmbeddingModelSelection('deepseek-v4-flash');
  assert.equal(result.valid, false);
  assert.match(result.issues[0], /not an embedding model/);
  assert.match(result.issues[0], /deepseek-v4-flash/);
});

test('validateEmbeddingModelSelection requires GEMINI_API_KEY for Gemini models', () => {
  withEnv({ GEMINI_API_KEY: undefined, NODE_ENV: 'production' }, () => {
    const result = validateEmbeddingModelSelection('text-embedding-004');
    assert.equal(result.valid, false);
    assert.match(result.issues[0], /GEMINI_API_KEY/);
  });
});

test('validateEmbeddingModelSelection accepts Gemini when key is set', () => {
  withEnv({ GEMINI_API_KEY: 'test-key', NODE_ENV: 'production' }, () => {
    const result = validateEmbeddingModelSelection('text-embedding-004');
    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);
    assert.equal(result.model.id, 'text-embedding-004');
    assert.equal(result.configured, true);
  });
});

test('validateEmbeddingModelSelection rejects Ollama model outside local runtime', () => {
  withEnv({ NODE_ENV: 'production', APP_ENV: undefined }, () => {
    const result = validateEmbeddingModelSelection('nomic-embed-text');
    assert.equal(result.valid, false);
    assert.match(result.issues[0], /local development/);
  });
});

test('validateEmbeddingModelSelection accepts Ollama in development', () => {
  withEnv({ NODE_ENV: 'development' }, () => {
    const result = validateEmbeddingModelSelection('nomic-embed-text');
    assert.equal(result.valid, true);
    assert.equal(isProviderConfigured(result.model), true);
  });
});

test('listEmbeddingModels excludes local-only models in production', () => {
  withEnv({ NODE_ENV: 'production' }, () => {
    const ids = listEmbeddingModels().map((m) => m.id);
    assert.ok(ids.includes('text-embedding-004'));
    assert.ok(!ids.includes('nomic-embed-text'));
  });
});

test('listEmbeddingModels includes Ollama in development', () => {
  withEnv({ NODE_ENV: 'development' }, () => {
    const ids = listEmbeddingModels().map((m) => m.id);
    assert.ok(ids.includes('nomic-embed-text'));
  });
});
