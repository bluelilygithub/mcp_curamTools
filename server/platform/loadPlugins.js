'use strict';

/**
 * Resolve which app plugins to load at boot.
 *
 * Env:
 *   PLATFORM_PLUGINS — comma-separated plugin folder names under server/apps/
 *                      (replaces defaults when set)
 *   EXTRA_PLUGINS    — append additional plugins (e.g. starter for local dev)
 *
 * Each plugin is server/apps/<id>/plugin.js
 */

const path = require('path');

const DEFAULT_PLUGIN_IDS = ['diamond-plate', 'engineering'];
const APPS_DIR = path.resolve(__dirname, '../apps');

function parsePluginIds(raw) {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
}

function loadPluginById(id) {
  if (!id || id.startsWith('_')) {
    throw new Error(`Invalid plugin id "${id}" — use a folder name under server/apps/ (not _template).`);
  }
  const pluginPath = path.join(APPS_DIR, id, 'plugin.js');
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const plugin = require(pluginPath);
  if (!plugin?.id) {
    throw new Error(`Plugin at ${pluginPath} must export id.`);
  }
  if (plugin.id !== id) {
    throw new Error(`Plugin folder "${id}" exports id "${plugin.id}" — they must match.`);
  }
  return plugin;
}

function resolvePluginIds(options = {}) {
  if (Array.isArray(options.pluginIds)) {
    return options.pluginIds;
  }
  const fromEnv = parsePluginIds(process.env.PLATFORM_PLUGINS);
  if (fromEnv.length > 0) return fromEnv;
  const extra = parsePluginIds(process.env.EXTRA_PLUGINS);
  return [...DEFAULT_PLUGIN_IDS, ...extra];
}

function resolvePlugins(options = {}) {
  if (Array.isArray(options.plugins)) {
    return options.plugins;
  }
  return resolvePluginIds(options).map(loadPluginById);
}

module.exports = {
  DEFAULT_PLUGIN_IDS,
  APPS_DIR,
  parsePluginIds,
  loadPluginById,
  resolvePluginIds,
  resolvePlugins,
};
