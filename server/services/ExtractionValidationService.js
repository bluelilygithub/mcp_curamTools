'use strict';

const AgentConfigService = require('../platform/AgentConfigService');
const { getProvider } = require('../platform/AgentOrchestrator');

const DEFAULT_MAX_VALIDATION_CHARS = 12000;
const VALIDATION_MAX_TOKENS = 1200;

const ISSUE_TYPES = [
  'missing_fields',
  'low_ocr_confidence',
  'ambiguous_table_mapping',
  'schema_drift',
  'inconsistent_values',
  'unsupported_claim',
  'truncated_output',
  'policy_or_privacy_risk',
  'none',
];

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeTokens(usage = {}) {
  return {
    input:      usage.input      ?? usage.input_tokens                ?? 0,
    output:     usage.output     ?? usage.output_tokens               ?? 0,
    cacheRead:  usage.cacheRead  ?? usage.cache_read_input_tokens     ?? 0,
    cacheWrite: usage.cacheWrite ?? usage.cache_creation_input_tokens ?? 0,
  };
}

function sumTokens(a = {}, b = {}) {
  return {
    input:      (a.input      ?? 0) + (b.input      ?? 0),
    output:     (a.output     ?? 0) + (b.output     ?? 0),
    cacheRead:  (a.cacheRead  ?? 0) + (b.cacheRead  ?? 0),
    cacheWrite: (a.cacheWrite ?? 0) + (b.cacheWrite ?? 0),
  };
}

function redactForValidation(value, depth = 0) {
  if (depth > 8) return '[Max depth reached]';
  if (value == null) return value;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => redactForValidation(item, depth + 1));
  if (typeof value === 'object') {
    const redacted = {};
    for (const [key, child] of Object.entries(value)) {
      if (['file_data', 'fileData', 'buffer', 'prompt_text', 'response_text'].includes(key)) {
        redacted[key] = '[redacted]';
      } else {
        redacted[key] = redactForValidation(child, depth + 1);
      }
    }
    return redacted;
  }
  if (typeof value === 'string' && value.length > 4000) return `${value.slice(0, 4000)}\n[truncated]`;
  return value;
}

function compactJson(value, maxChars = DEFAULT_MAX_VALIDATION_CHARS) {
  const text = JSON.stringify(redactForValidation(value), null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[validation payload truncated]`;
}

function parseJsonObject(text) {
  const stripped = String(text || '').replace(/```(?:json)?\s*/gi, '').trim();
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first === -1 || last <= first) {
    throw new Error(`Validation model returned no JSON object: ${stripped.slice(0, 200)}`);
  }
  return JSON.parse(stripped.slice(first, last + 1));
}

function buildSystemPrompt() {
  return `You validate AI extraction output for engineering/document agents.

You are not re-running the extraction. Your job is to score whether the provided structured output is reliable enough to hand to the client.

Return ONLY JSON with this exact shape:
{
  "confidence": 0.0,
  "issue_types": ["missing_fields"],
  "issue_summary": "Short explanation of the main quality risks.",
  "evidence": ["Specific signal from the output that supports the score."],
  "recommended_route": "accept | escalate_model"
}

Scoring:
- 0.90-1.00: complete, internally consistent, schema-aligned, well grounded.
- 0.75-0.89: usable but some ambiguity or minor gaps.
- 0.55-0.74: material uncertainty; stronger model review is warranted.
- 0.00-0.54: low confidence; stronger model review is required.

Allowed issue_types: ${ISSUE_TYPES.join(', ')}.
Use "none" only when there are no meaningful issues.
Do not invent source-document facts that are not in the supplied output.`;
}

function buildUserPrompt({ slug, phase, threshold, extraction, firstPass = null }) {
  return [
    `Agent slug: ${slug}`,
    `Validation phase: ${phase}`,
    `Configured accept threshold: ${threshold}`,
    firstPass ? `First pass score: ${firstPass.confidence}; issues: ${(firstPass.issue_types ?? []).join(', ')}` : null,
    '',
    'Structured output to validate:',
    compactJson(extraction),
  ].filter(Boolean).join('\n');
}

async function callValidationModel({ model, customProviders, slug, phase, threshold, extraction, firstPass, providerFactory }) {
  const provider = providerFactory ? providerFactory(model, customProviders) : getProvider(model, customProviders);
  const response = await provider.chat({
    model,
    max_tokens: VALIDATION_MAX_TOKENS,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserPrompt({ slug, phase, threshold, extraction, firstPass }) }],
  });
  const text = response.content?.find((block) => block.type === 'text')?.text ?? response.text ?? '';
  const parsed = parseJsonObject(text);
  const confidence = clampConfidence(parsed.confidence);
  const issueTypes = Array.isArray(parsed.issue_types)
    ? parsed.issue_types.map(String).filter((issue) => ISSUE_TYPES.includes(issue))
    : [];

  return {
    task: phase === 'first_pass' ? 'validate_cheap_extraction' : 'validate_escalated_extraction',
    model,
    confidence,
    issue_types: issueTypes.length > 0 ? issueTypes : ['none'],
    issue_summary: String(parsed.issue_summary ?? '').slice(0, 1000),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String).slice(0, 8) : [],
    route: confidence >= threshold ? 'accept' : 'escalate_model',
    performed_at: new Date().toISOString(),
    tokensUsed: normalizeTokens(response.usage),
  };
}

async function resolveConfig({ orgId, adminConfig = {} }) {
  const global = await AgentConfigService.getTieredValidationSettings(orgId);
  const override = adminConfig.tiered_validation_threshold_override;
  return {
    enabled: adminConfig.tiered_validation_enabled === true,
    confidence_threshold: override == null || override === ''
      ? clampConfidence(global.confidence_threshold)
      : clampConfidence(override),
    escalation_model: global.escalation_model ?? null,
    global,
    threshold_source: override == null || override === '' ? 'global' : 'agent_override',
  };
}

async function runTieredValidation({
  orgId,
  slug,
  adminConfig,
  primaryModel,
  customProviders = [],
  extraction,
  emit = null,
  providerFactory = null,
  validationConfig = null,
}) {
  const config = validationConfig ?? await resolveConfig({ orgId, adminConfig });
  const base = {
    enabled: config.enabled,
    task_performed: false,
    final_decision: config.enabled ? null : 'skipped_disabled',
    threshold: config.confidence_threshold,
    threshold_source: config.threshold_source,
    escalation_model: config.escalation_model,
    first_pass: null,
    escalation_pass: null,
    tokensUsed: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  if (!config.enabled) return base;
  if (!primaryModel) {
    return { ...base, final_decision: 'skipped_no_primary_model' };
  }

  if (typeof emit === 'function') emit('Running extraction validation…');
  const firstPass = await callValidationModel({
    model: primaryModel,
    customProviders,
    slug,
    phase: 'first_pass',
    threshold: config.confidence_threshold,
    extraction,
    providerFactory,
  });

  let tokensUsed = sumTokens(base.tokensUsed, firstPass.tokensUsed);
  const result = { ...base, task_performed: true, first_pass: firstPass, tokensUsed };

  if (firstPass.confidence >= config.confidence_threshold) {
    if (typeof emit === 'function') emit(`Extraction validation accepted (${Math.round(firstPass.confidence * 100)}% confidence).`, firstPass.tokensUsed);
    return { ...result, final_decision: 'accepted_first_pass' };
  }

  const escalationModel = config.escalation_model;
  if (!escalationModel || escalationModel === primaryModel) {
    if (typeof emit === 'function') emit('Extraction validation could not escalate because no distinct escalation model is configured.', firstPass.tokensUsed);
    return { ...result, final_decision: 'needs_review_no_escalation_model' };
  }

  if (typeof emit === 'function') emit(`Extraction validation escalating to ${escalationModel}…`, firstPass.tokensUsed);
  const escalationPass = await callValidationModel({
    model: escalationModel,
    customProviders,
    slug,
    phase: 'escalation_pass',
    threshold: config.confidence_threshold,
    extraction,
    firstPass,
    providerFactory,
  });
  tokensUsed = sumTokens(tokensUsed, escalationPass.tokensUsed);

  const finalDecision = escalationPass.confidence >= config.confidence_threshold
    ? 'accepted_after_escalation'
    : 'needs_review_after_escalation';
  if (typeof emit === 'function') {
    const pct = Math.round(escalationPass.confidence * 100);
    emit(`Escalated extraction validation ${finalDecision === 'accepted_after_escalation' ? 'accepted' : 'requires review'} (${pct}% confidence).`, escalationPass.tokensUsed);
  }

  return {
    ...result,
    escalation_pass: escalationPass,
    final_decision: finalDecision,
    tokensUsed,
  };
}

function needsHumanReview(validation) {
  return /^needs_review/.test(validation?.final_decision ?? '');
}

module.exports = {
  ISSUE_TYPES,
  runTieredValidation,
  resolveConfig,
  needsHumanReview,
  normalizeTokens,
  sumTokens,
  compactJson,
};
