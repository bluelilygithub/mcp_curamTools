'use strict';

// Pre-fetch agent — no ReAct tool definitions.
// All data is fetched in Node.js inside index.js and passed to Claude in one message.

const TOOL_SLUG = 'not-interested-report';

module.exports = { TOOL_SLUG };
