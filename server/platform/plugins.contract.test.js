'use strict';

/**
 * App plugin contract tests — framework quality gate for server/apps/* plugins.
 * No database, HTTP, or live APIs. Validates manifest shape and agent module loads.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { DEFAULT_PLUGIN_IDS, loadPluginById } = require('./loadPlugins');

const AGENTS_DIR = path.resolve(__dirname, '../agents');
const APPS_DIR = path.resolve(__dirname, '../apps');

const ALL_APP_IDS = [...DEFAULT_PLUGIN_IDS, 'starter'];

function loadAgentExport(entry) {
  const { export: exportName, module: legacyModule, appModule } = entry;
  const mod = appModule
    ? require(path.join(APPS_DIR, appModule))
    : require(path.join(AGENTS_DIR, legacyModule));
  return mod[exportName];
}

function assertManifestEntry(entry, pluginId) {
  assert.ok(entry.slug, `${pluginId}: manifest entry missing slug`);
  assert.ok(entry.export, `${pluginId}: ${entry.slug} missing export`);
  assert.ok(entry.permission, `${pluginId}: ${entry.slug} missing permission`);
  assert.ok(
    entry.module || entry.appModule,
    `${pluginId}: ${entry.slug} needs module or appModule`,
  );
  if (entry.appModule) {
    assert.ok(
      entry.appModule.startsWith(`${pluginId}/`),
      `${pluginId}: appModule should live under server/apps/${pluginId}/`,
    );
  }
}

for (const pluginId of ALL_APP_IDS) {
  test(`plugin contract: ${pluginId}`, () => {
    const plugin = loadPluginById(pluginId);

    assert.equal(plugin.id, pluginId);
    assert.ok(Array.isArray(plugin.agentManifest), `${pluginId}: agentManifest must be an array`);
    assert.ok(Array.isArray(plugin.mcpServers), `${pluginId}: mcpServers must be an array`);
    assert.equal(typeof plugin.registerRoutes, 'function', `${pluginId}: registerRoutes required`);

    const slugs = new Set();
    for (const entry of plugin.agentManifest) {
      assertManifestEntry(entry, pluginId);
      assert.ok(!slugs.has(entry.slug), `${pluginId}: duplicate slug ${entry.slug}`);
      slugs.add(entry.slug);

      const runFn = loadAgentExport(entry);
      assert.equal(typeof runFn, 'function', `${pluginId}: ${entry.slug} export must be a function`);
    }

    for (const mcp of plugin.mcpServers) {
      assert.ok(mcp.name || mcp.id, `${pluginId}: MCP entry missing name/id`);
    }

    const mockApp = { use() {} };
    assert.doesNotThrow(() => plugin.registerRoutes(mockApp), `${pluginId}: registerRoutes should not throw`);
  });
}

test('default plugins merge to unique agent slugs', () => {
  const slugs = new Set();
  for (const pluginId of DEFAULT_PLUGIN_IDS) {
    const plugin = loadPluginById(pluginId);
    for (const entry of plugin.agentManifest) {
      assert.ok(!slugs.has(entry.slug), `duplicate slug across plugins: ${entry.slug}`);
      slugs.add(entry.slug);
    }
  }
  assert.ok(slugs.size >= 30, 'expected diamond-plate + engineering agent count');
});
