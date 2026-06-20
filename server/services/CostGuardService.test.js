'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BudgetExceededError,
  computeCostAud,
  check,
  getRatesForModel,
  describePricingForModel,
} = require('./CostGuardService');

test('computeCostAud returns zero for empty token usage', () => {
  assert.equal(computeCostAud({}, 'deepseek-chat'), 0);
});

test('computeCostAud scales input and output tokens by model rates', () => {
  const rates = getRatesForModel('deepseek-chat');
  const expected = 1_000_000 * rates.input + 500_000 * rates.output;
  const cost = computeCostAud(
    { input: 1_000_000, output: 500_000 },
    'deepseek-chat',
  );
  assert.ok(cost > 0);
  assert.equal(cost, expected);
});

test('computeCostAud prefers model catalogue pricing when configured', () => {
  const catalogue = {
    id: 'custom-model',
    inputPricePer1M: 1.0,
    outputPricePer1M: 2.0,
  };
  const cost = computeCostAud(
    { input: 1_000_000, output: 1_000_000 },
    'custom-model',
    catalogue,
  );
  // 1 USD/M input + 2 USD/M output → 3 USD × AUD_PER_USD (1.55)
  assert.equal(cost, 3 * 1.55);
});

test('getRatesForModel falls back to Sonnet rates for unknown models', () => {
  const sonnetRates = getRatesForModel('claude-sonnet-4-6');
  const unknownRates = getRatesForModel('totally-unknown-model-xyz');
  assert.deepEqual(unknownRates, sonnetRates);
});

test('describePricingForModel reports configured vs fallback pricing', () => {
  const fallback = describePricingForModel('unknown-model');
  assert.equal(fallback.hasConfiguredPricing, false);
  assert.match(fallback.label, /Fallback Sonnet/);

  const configured = describePricingForModel('my-model', {
    id: 'my-model',
    inputPricePer1M: 1,
    outputPricePer1M: 2,
  });
  assert.equal(configured.hasConfiguredPricing, true);
  assert.equal(configured.source, 'configured_model');
});

test('check passes when under task and daily limits', () => {
  assert.doesNotThrow(() => check({
    taskCostAud: 0.5,
    maxTaskBudgetAud: 2.0,
    dailyOrgSpendAud: 1.0,
    maxDailyBudgetAud: 5.0,
  }));
});

test('check passes when limits are null (unlimited)', () => {
  assert.doesNotThrow(() => check({
    taskCostAud: 999,
    maxTaskBudgetAud: null,
    dailyOrgSpendAud: 999,
    maxDailyBudgetAud: null,
  }));
});

test('check throws BudgetExceededError when task budget exceeded', () => {
  assert.throws(() => check({
    taskCostAud: 2.0,
    maxTaskBudgetAud: 2.0,
    dailyOrgSpendAud: 0,
    maxDailyBudgetAud: 100,
  }), (err) => {
    assert.ok(err instanceof BudgetExceededError);
    assert.equal(err.type, 'task');
    assert.equal(err.limit, 2.0);
    assert.equal(err.actual, 2.0);
    assert.match(err.message, /Task budget exceeded/);
    return true;
  });
});

test('check throws BudgetExceededError when daily org budget exceeded', () => {
  assert.throws(() => check({
    taskCostAud: 1.0,
    maxTaskBudgetAud: null,
    dailyOrgSpendAud: 4.5,
    maxDailyBudgetAud: 5.0,
  }), (err) => {
    assert.ok(err instanceof BudgetExceededError);
    assert.equal(err.type, 'daily_org');
    assert.equal(err.limit, 5.0);
    assert.equal(err.actual, 5.5);
    assert.match(err.message, /Daily org budget exceeded/);
    return true;
  });
});

test('task limit is checked before daily limit', () => {
  assert.throws(() => check({
    taskCostAud: 10,
    maxTaskBudgetAud: 5,
    dailyOrgSpendAud: 100,
    maxDailyBudgetAud: 50,
  }), (err) => err.type === 'task');
});
