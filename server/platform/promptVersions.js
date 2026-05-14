'use strict';

/**
 * Prompt lineage labels for agent runs (createAgentRoute HTTP, AgentScheduler cron).
 *
 * When a runFn returns `{ promptVersion: '<label>' }` (HTTP: top-level return;
 * scheduler: same envelope or on each multi-customer item), the platform persists it
 * on `agent_runs.result.prompt_version` for audits and regression triage.
 *
 * Convention: `slug@N` where N increments when **system or stage prompts** for that
 * slug change in a way that could affect behaviour. Bump in this file and note in
 * root CHANGELOG — see `knowledge_base/core/PROMPT_VERSIONING.md`.
 */

/** @type {Record<string, string>} */
const BY_SLUG = {
  'demo-tender-response': 'demo-tender-response@1',
};

/**
 * @param {string} slug
 * @returns {string | null}
 */
function getPromptVersion(slug) {
  if (typeof slug !== 'string' || !slug.trim()) return null;
  return BY_SLUG[slug] ?? null;
}

/**
 * @param {unknown} promptVersion
 * @returns {string|null}
 */
function normalizePromptVersion(promptVersion) {
  if (typeof promptVersion !== 'string' || !promptVersion.trim()) return null;
  return promptVersion.trim().slice(0, 160);
}

/**
 * Shallow-merge `prompt_version` into the JSON persisted on `agent_runs.result`.
 * @param {unknown} base
 * @param {unknown} promptVersion
 * @returns {unknown}
 */
function mergePromptVersionIntoResult(base, promptVersion) {
  const pv = normalizePromptVersion(promptVersion);
  if (!pv) return base;
  if (base && typeof base === 'object' && !Array.isArray(base)) {
    return { ...base, prompt_version: pv };
  }
  if (base === null || base === undefined) {
    return { prompt_version: pv };
  }
  return { value: base, prompt_version: pv };
}

module.exports = {
  getPromptVersion,
  BY_SLUG,
  normalizePromptVersion,
  mergePromptVersionIntoResult,
};
