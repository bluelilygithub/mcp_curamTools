'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  DEFAULT_PLUGIN_IDS,
  parsePluginIds,
  loadPluginById,
  resolvePluginIds,
  resolvePlugins,
  APPS_DIR,
} = require('./loadPlugins');

function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('parsePluginIds splits and dedupes', () => {
  assert.deepEqual(parsePluginIds('a, b,a'), ['a', 'b']);
  assert.deepEqual(parsePluginIds(''), []);
});

test('loadPluginById loads diamond-plate plugin', () => {
  const plugin = loadPluginById('diamond-plate');
  assert.equal(plugin.id, 'diamond-plate');
  assert.ok(Array.isArray(plugin.agentManifest));
});

test('loadPluginById rejects _template path', () => {
  assert.throws(() => loadPluginById('_template'), /Invalid plugin id/);
});

test('resolvePluginIds defaults without env', () => {
  withEnv({ PLATFORM_PLUGINS: undefined, EXTRA_PLUGINS: undefined }, () => {
    assert.deepEqual(resolvePluginIds(), DEFAULT_PLUGIN_IDS);
  });
});

test('resolvePluginIds PLATFORM_PLUGINS replaces defaults', () => {
  withEnv({ PLATFORM_PLUGINS: 'engineering', EXTRA_PLUGINS: 'starter' }, () => {
    assert.deepEqual(resolvePluginIds(), ['engineering']);
  });
});

test('resolvePluginIds EXTRA_PLUGINS appends', () => {
  withEnv({ PLATFORM_PLUGINS: undefined, EXTRA_PLUGINS: 'starter' }, () => {
    assert.deepEqual(resolvePluginIds(), [...DEFAULT_PLUGIN_IDS, 'starter']);
  });
});

test('resolvePlugins returns plugin objects', () => {
  withEnv({ PLATFORM_PLUGINS: undefined, EXTRA_PLUGINS: undefined }, () => {
    const plugins = resolvePlugins();
    assert.equal(plugins.length, 2);
    assert.equal(plugins[0].id, 'diamond-plate');
    assert.equal(plugins[1].id, 'engineering');
  });
});

test('starter plugin file exists under apps dir', () => {
  const starterPath = path.join(APPS_DIR, 'starter', 'plugin.js');
  assert.ok(starterPath.includes('starter'));
  const plugin = loadPluginById('starter');
  assert.equal(plugin.id, 'starter');
});
