'use strict';

const { TOOL_SCHEMAS } = require('./toolSchemas');

/**
 * validateToolData — post-run integrity check for tool results.
 *
 * Pure function: no IO, no side effects.
 * Returns boundsFailed entries to be attached to the run result payload.
 * An empty array means all checked tools passed.
 *
 * @param {object} toolData  — { [toolName]: result } from extractToolData
 * @param {object} [schemas] — override for testing; defaults to TOOL_SCHEMAS
 * @returns {Array<{ tool: string, message: string }>}
 */
function validateToolData(toolData, schemas = TOOL_SCHEMAS) {
  if (!toolData || typeof toolData !== 'object') return [];

  const boundsFailed = [];

  for (const [toolName, result] of Object.entries(toolData)) {
    const validate = schemas[toolName];
    if (!validate) continue;

    let failures;
    try {
      failures = validate(result);
    } catch (err) {
      failures = [`validator threw: ${err.message}`];
    }

    for (const message of failures) {
      boundsFailed.push({ tool: toolName, message });
    }
  }

  return boundsFailed;
}

module.exports = { validateToolData };
