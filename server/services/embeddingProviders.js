'use strict';

/**
 * Low-level embedding API calls — OpenAI, Gemini, Ollama.
 */

const https = require('https');

const MAX_CHARS = 30000;

const GEMINI_ENDPOINTS = [
  (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
  (model) => `https://generativelanguage.googleapis.com/v1/models/${model}:embedContent`,
];

function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
}

function httpsPost(hostname, path, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function embedWithOpenAI(text, modelDef) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');

  const input = String(text).slice(0, MAX_CHARS);
  const payload = {
    model: modelDef.id,
    input,
  };
  if (modelDef.openAiDimensions) {
    payload.dimensions = modelDef.openAiDimensions;
  }

  const { status, body } = await httpsPost(
    'api.openai.com',
    '/v1/embeddings',
    { Authorization: `Bearer ${apiKey}` },
    payload,
  );

  if (status !== 200 || body?.error) {
    throw new Error(body?.error?.message || `OpenAI embeddings failed (${status})`);
  }

  return body.data?.[0]?.embedding ?? null;
}

async function embedWithGemini(text, modelDef) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');

  const input = String(text).slice(0, MAX_CHARS);
  let lastError = 'Gemini embed failed';

  for (const buildUrl of GEMINI_ENDPOINTS) {
    const url = new URL(`${buildUrl(modelDef.id)}?key=${apiKey}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text: input }] } }),
    });

    if (res.ok) {
      const data = await res.json();
      return data.embedding?.values ?? null;
    }

    if (res.status !== 404) {
      const msg = await res.text().catch(() => '');
      throw new Error(`Gemini embed failed (${res.status}): ${msg.slice(0, 200)}`);
    }

    lastError = await res.text().catch(() => lastError);
  }

  throw new Error(lastError.slice(0, 200));
}

async function embedWithOllama(text, modelDef) {
  const input = String(text).slice(0, MAX_CHARS);
  const base = ollamaBaseUrl();
  const attempts = [
    { path: '/api/embed', body: { model: modelDef.id, input } },
    { path: '/api/embeddings', body: { model: modelDef.id, prompt: input } },
  ];

  for (const { path, body } of attempts) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const vector = data.embeddings?.[0] || data.embedding;
      if (Array.isArray(vector) && vector.length > 0) return vector;
    } catch (err) {
      console.warn(`[embeddingProviders] Ollama ${path}:`, err.message);
    }
  }

  throw new Error(`Ollama embed failed for ${modelDef.id}. Start Ollama and run: ollama pull ${modelDef.id}`);
}

async function embedWithModel(text, modelDef) {
  if (!modelDef) throw new Error('Embedding model is not configured.');

  let vector;
  if (modelDef.provider === 'openai') {
    vector = await embedWithOpenAI(text, modelDef);
  } else if (modelDef.provider === 'google') {
    vector = await embedWithGemini(text, modelDef);
  } else if (modelDef.provider === 'ollama') {
    vector = await embedWithOllama(text, modelDef);
  } else {
    throw new Error(`Unsupported embedding provider: ${modelDef.provider}`);
  }

  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error(`Embedding API returned an empty vector for ${modelDef.id}`);
  }

  if (vector.length !== modelDef.dimensions) {
    throw new Error(
      `Dimension mismatch for ${modelDef.id}: got ${vector.length}, expected ${modelDef.dimensions}`,
    );
  }

  return vector;
}

module.exports = {
  embedWithModel,
  embedWithOpenAI,
  embedWithGemini,
  embedWithOllama,
  ollamaBaseUrl,
};
