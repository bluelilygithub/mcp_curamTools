'use strict';

const { pool } = require('../db');

const CHAIN_DEFINITIONS = {
  'ads-copy-playbook': [
    {
      slug: 'ads-copy-diagnostic',
      label: 'Copy Diagnostic',
      required: true,
      maxAgeDays: 7,
      allowedStatuses: ['complete', 'needs_review'],
      usage: 'confirmed diagnostic input',
    },
  ],
  'ads-copy-gate': [
    {
      slug: 'ads-copy-playbook',
      label: 'Copy Playbook',
      required: true,
      maxAgeDays: 7,
      allowedStatuses: ['complete', 'needs_review'],
      usage: 'primary gated playbook',
    },
    {
      slug: 'ads-copy-diagnostic',
      label: 'Copy Diagnostic',
      required: true,
      maxAgeDays: 14,
      allowedStatuses: ['complete', 'needs_review'],
      usage: 'supporting diagnostic context',
    },
  ],
};

class ReportDependencyError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ReportDependencyError';
    this.details = details;
  }
}

function getChainDefinition(slug) {
  return CHAIN_DEFINITIONS[slug] ?? [];
}

function ageDays(runAt) {
  if (!runAt) return null;
  return (Date.now() - new Date(runAt).getTime()) / 86_400_000;
}

function getSummary(result) {
  if (!result) return '';
  if (typeof result.summary === 'string') return result.summary;
  return JSON.stringify(result);
}

function normalizeSelections(selections = []) {
  if (Array.isArray(selections)) {
    return Object.fromEntries(selections.filter((s) => s?.slug && s?.runId).map((s) => [s.slug, s.runId]));
  }
  if (selections && typeof selections === 'object') return selections;
  return {};
}

function rowToDependency(def, row, selectedByUserId = null) {
  if (!row) return null;
  const age = ageDays(row.run_at);
  const stale = def.maxAgeDays != null && age != null && age > def.maxAgeDays;
  return {
    slug: def.slug,
    label: def.label,
    usage: def.usage,
    required: def.required !== false,
    runId: row.id,
    status: row.status,
    runAt: row.run_at,
    completedAt: row.completed_at,
    selectedByUserId,
    selectedAt: new Date().toISOString(),
    stale,
    ageDays: age == null ? null : Math.round(age * 10) / 10,
    maxAgeDays: def.maxAgeDays ?? null,
    summary: getSummary(row.result),
  };
}

async function loadDependencyRun(orgId, def, selectedRunId = null) {
  if (selectedRunId) {
    const { rows } = await pool.query(
      `SELECT id, slug, status, result, run_at, completed_at
         FROM agent_runs
        WHERE org_id = $1
          AND slug = $2
          AND id = $3
          AND status = ANY($4)
        LIMIT 1`,
      [orgId, def.slug, selectedRunId, def.allowedStatuses]
    );
    return rows[0] ?? null;
  }

  const { rows } = await pool.query(
    `SELECT id, slug, status, result, run_at, completed_at
       FROM agent_runs
      WHERE org_id = $1
        AND slug = $2
        AND status = ANY($3)
      ORDER BY run_at DESC
      LIMIT 1`,
    [orgId, def.slug, def.allowedStatuses]
  );
  return rows[0] ?? null;
}

async function resolveDependencies({ slug, orgId, userId = null, selections = null }) {
  const definitions = getChainDefinition(slug);
  const selectedBySlug = normalizeSelections(selections);
  const dependencies = [];
  const warnings = [];
  const missing = [];

  for (const def of definitions) {
    const row = await loadDependencyRun(orgId, def, selectedBySlug[def.slug] ?? null);
    if (!row) {
      const detail = {
        slug: def.slug,
        label: def.label,
        required: def.required !== false,
        reason: selectedBySlug[def.slug] ? 'selected_run_unavailable' : 'no_suitable_run',
      };
      if (def.required !== false) missing.push(detail);
      warnings.push(detail);
      continue;
    }

    const dependency = rowToDependency(def, row, userId);
    dependencies.push(dependency);

    if (dependency.stale) {
      warnings.push({
        slug: def.slug,
        label: def.label,
        reason: 'stale',
        ageDays: dependency.ageDays,
        maxAgeDays: dependency.maxAgeDays,
      });
    }
    if (dependency.status === 'needs_review') {
      warnings.push({
        slug: def.slug,
        label: def.label,
        reason: 'needs_review',
      });
    }
  }

  if (missing.length > 0) {
    throw new ReportDependencyError(
      `Missing required report dependency: ${missing.map((d) => d.label).join(', ')}`,
      missing
    );
  }

  return { definitions, dependencies, warnings };
}

async function getDependencyStatus({ slug, orgId }) {
  const definitions = getChainDefinition(slug);
  const requirements = [];

  for (const def of definitions) {
    const row = await loadDependencyRun(orgId, def);
    const latestRun = rowToDependency(def, row);
    requirements.push({
      slug: def.slug,
      label: def.label,
      required: def.required !== false,
      maxAgeDays: def.maxAgeDays ?? null,
      allowedStatuses: def.allowedStatuses,
      usage: def.usage,
      latestRun: latestRun
        ? {
            runId: latestRun.runId,
            status: latestRun.status,
            runAt: latestRun.runAt,
            stale: latestRun.stale,
            ageDays: latestRun.ageDays,
          }
        : null,
    });
  }

  return { slug, hasDependencies: requirements.length > 0, requirements };
}

function buildDependencyPromptContext(dependencies = [], warnings = []) {
  if (!dependencies.length) return '';

  const warningLines = warnings.map((w) => {
    if (w.reason === 'stale') return `- ${w.label} is stale (${w.ageDays} days old; max ${w.maxAgeDays}). Treat inherited reasoning cautiously.`;
    if (w.reason === 'needs_review') return `- ${w.label} is marked needs_review. Treat inherited reasoning as unverified.`;
    return `- ${w.label}: ${w.reason}`;
  });

  return [
    '## Report Dependency Context',
    '',
    'The following prior reports are explicit dependencies for this run. They are inherited reasoning artefacts, not raw source data. Use them as accountable context and disclose reliance where relevant.',
    '',
    ...dependencies.map((d) => [
      `### ${d.label}`,
      `- Run ID: ${d.runId}`,
      `- Status: ${d.status}`,
      `- Run at: ${d.runAt}`,
      `- Usage: ${d.usage}`,
    ].join('\n')),
    warningLines.length ? `## Dependency Warnings\n\n${warningLines.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

module.exports = {
  CHAIN_DEFINITIONS,
  ReportDependencyError,
  getChainDefinition,
  resolveDependencies,
  getDependencyStatus,
  buildDependencyPromptContext,
};
