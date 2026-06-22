'use strict';

/**
 * createPlatform integration tests — Express wiring without start() (no DB/MCP boot).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { createPlatform } = require('./createPlatform');
const { AgentScheduler } = require('./AgentScheduler');

test.after(() => {
  AgentScheduler.stopAll();
});

function request(app, method, urlPath) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request(
        { hostname: '127.0.0.1', port, path: urlPath, method },
        (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, body });
          });
        },
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

test('createPlatform resolves default plugins', () => {
  const platform = createPlatform();
  assert.equal(platform.plugins.length, 2);
  assert.deepEqual(platform.plugins.map((p) => p.id), ['diamond-plate', 'engineering']);
  assert.ok(platform.agentManifest.length > 30);
  assert.ok(platform.mcpServers.length >= 4);
  assert.equal(typeof platform.start, 'function');
});

test('createPlatform with starter mounts /api/starter/health', async () => {
  const { app } = createPlatform({ pluginIds: ['starter'] });
  const res = await request(app, 'GET', '/api/starter/health');
  assert.equal(res.status, 401, 'starter health route should exist behind requireAuth');
});

test('createPlatform mounts engineering demo routes', async () => {
  const { app } = createPlatform({ pluginIds: ['engineering'] });
  const res = await request(app, 'GET', '/api/demo/manifest');
  assert.equal(res.status, 401, 'demo manifest route should exist behind requireAuth');
});

test('createPlatform mounts starter agent route', async () => {
  const { app } = createPlatform({ pluginIds: ['starter'] });
  const res = await request(app, 'POST', '/api/agents/starter-hello/run');
  assert.equal(res.status, 401, 'starter agent route should exist behind requireAuth');
});
