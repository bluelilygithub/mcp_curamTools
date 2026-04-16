'use strict';

/**
 * Search Term Intelligence — tool definitions.
 *
 * Pre-fetch architecture: all data is fetched in Node.js before Claude runs.
 * No ReAct loop — data requirements are fixed.
 *
 * Required MCP servers:
 *   - Google Ads       (args include 'google-ads.js')
 *   - Google Analytics (args include 'google-analytics.js')
 *   - WordPress        (args include 'wordpress.js')
 */

const TOOL_SLUG = 'search-term-intelligence';

module.exports = { TOOL_SLUG };
