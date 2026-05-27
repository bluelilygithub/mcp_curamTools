'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const AgentConfigService = require('../platform/AgentConfigService');
const ExtractionValidationService = require('./ExtractionValidationService');

function providerFactoryFor(responses) {
  const calls = [];
  return {
    calls,
    providerFactory(model) {
      calls.push(model);
      return {
        async chat() {
          const next = responses.shift();
          return {
            content: [{ type: 'text', text: JSON.stringify(next.body) }],
            usage: next.usage ?? { input_tokens: 10, output_tokens: 5 },
          };
        },
      };
    },
  };
}

test('accepts high-confidence first pass without escalation', async () => {
  const providers = providerFactoryFor([
    { body: { confidence: 0.93, issue_types: ['none'], issue_summary: 'clean', evidence: [], recommended_route: 'accept' } },
  ]);

  const result = await ExtractionValidationService.runTieredValidation({
    orgId: 1,
    slug: 'spec-validator',
    adminConfig: {},
    primaryModel: 'cheap-model',
    extraction: { fields: [{ name: 'total', value: '$10' }] },
    validationConfig: {
      enabled: true,
      confidence_threshold: 0.85,
      escalation_model: 'strong-model',
      threshold_source: 'global',
    },
    providerFactory: providers.providerFactory,
  });

  assert.equal(result.task_performed, true);
  assert.equal(result.final_decision, 'accepted_first_pass');
  assert.deepEqual(providers.calls, ['cheap-model']);
});

test('escalates below-threshold output and accepts if stronger model passes', async () => {
  const providers = providerFactoryFor([
    { body: { confidence: 0.66, issue_types: ['ambiguous_table_mapping'], issue_summary: 'unclear', evidence: ['columns ambiguous'], recommended_route: 'escalate_model' } },
    { body: { confidence: 0.89, issue_types: ['none'], issue_summary: 'reviewed', evidence: ['schema consistent'], recommended_route: 'accept' } },
  ]);

  const result = await ExtractionValidationService.runTieredValidation({
    orgId: 1,
    slug: 'demo-tender-response',
    adminConfig: {},
    primaryModel: 'cheap-model',
    extraction: { requirements: [{ id: 'R1', draft: '...' }] },
    validationConfig: {
      enabled: true,
      confidence_threshold: 0.85,
      escalation_model: 'strong-model',
      threshold_source: 'global',
    },
    providerFactory: providers.providerFactory,
  });

  assert.equal(result.final_decision, 'accepted_after_escalation');
  assert.equal(result.first_pass.route, 'escalate_model');
  assert.equal(result.escalation_pass.route, 'accept');
  assert.deepEqual(providers.calls, ['cheap-model', 'strong-model']);
});

test('requires human review only after escalation also misses threshold', async () => {
  const providers = providerFactoryFor([
    { body: { confidence: 0.52, issue_types: ['missing_fields'], issue_summary: 'gaps', evidence: [], recommended_route: 'escalate_model' } },
    { body: { confidence: 0.71, issue_types: ['missing_fields'], issue_summary: 'still gaps', evidence: [], recommended_route: 'escalate_model' } },
  ]);

  const result = await ExtractionValidationService.runTieredValidation({
    orgId: 1,
    slug: 'spec-validator',
    adminConfig: {},
    primaryModel: 'cheap-model',
    extraction: { pipe_segments: [] },
    validationConfig: {
      enabled: true,
      confidence_threshold: 0.85,
      escalation_model: 'strong-model',
      threshold_source: 'agent_override',
    },
    providerFactory: providers.providerFactory,
  });

  assert.equal(result.final_decision, 'needs_review_after_escalation');
  assert.equal(ExtractionValidationService.needsHumanReview(result), true);
});

test('disabled pipeline logs skipped state without model calls', async () => {
  const providers = providerFactoryFor([]);
  const result = await ExtractionValidationService.runTieredValidation({
    orgId: 1,
    slug: 'demo-document-analyzer',
    primaryModel: 'cheap-model',
    extraction: {},
    validationConfig: {
      enabled: false,
      confidence_threshold: 0.85,
      escalation_model: 'strong-model',
      threshold_source: 'global',
    },
    providerFactory: providers.providerFactory,
  });

  assert.equal(result.task_performed, false);
  assert.equal(result.final_decision, 'skipped_disabled');
  assert.deepEqual(providers.calls, []);
});

test('threshold override falls back only when missing or blank', async () => {
  const original = AgentConfigService.getTieredValidationSettings;
  AgentConfigService.getTieredValidationSettings = async () => ({
    confidence_threshold: 0.85,
    escalation_model: 'global-strong-model',
  });

  try {
    const missing = await ExtractionValidationService.resolveConfig({
      orgId: 1,
      adminConfig: { tiered_validation_enabled: true },
    });
    assert.equal(missing.confidence_threshold, 0.85);
    assert.equal(missing.threshold_source, 'global');

    const blank = await ExtractionValidationService.resolveConfig({
      orgId: 1,
      adminConfig: { tiered_validation_enabled: true, tiered_validation_threshold_override: '' },
    });
    assert.equal(blank.confidence_threshold, 0.85);
    assert.equal(blank.threshold_source, 'global');

    const zero = await ExtractionValidationService.resolveConfig({
      orgId: 1,
      adminConfig: { tiered_validation_enabled: true, tiered_validation_threshold_override: 0 },
    });
    assert.equal(zero.confidence_threshold, 0);
    assert.equal(zero.threshold_source, 'agent_override');

    const explicit = await ExtractionValidationService.resolveConfig({
      orgId: 1,
      adminConfig: { tiered_validation_enabled: true, tiered_validation_threshold_override: 0.92 },
    });
    assert.equal(explicit.confidence_threshold, 0.92);
    assert.equal(explicit.threshold_source, 'agent_override');
  } finally {
    AgentConfigService.getTieredValidationSettings = original;
  }
});
