/**
 * substitutePromptVars — replace {{variable}} placeholders in a prompt template.
 *
 * Variables are double-brace delimited, matching the email template convention.
 * Unknown placeholders are left as-is (no silent data loss).
 *
 * @param {string} template   — prompt string with {{var}} placeholders
 * @param {object} vars       — key/value map of substitutions
 * @returns {string}
 *
 * @example
 * substitutePromptVars('Focus on {{customer_name}} ({{customer_id}}).', {
 *   customer_name: 'Acme Corp',
 *   customer_id:   '123-456-7890',
 * });
 * // → 'Focus on Acme Corp (123-456-7890).'
 */
function substitutePromptVars(template, vars = {}) {
  if (!template) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match;
  });
}

module.exports = { substitutePromptVars };
