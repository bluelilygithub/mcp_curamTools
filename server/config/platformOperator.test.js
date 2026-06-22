'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isPlatformOperator, resolveScopedOrgId } = require('./platformOperator');

test('isPlatformOperator is false for demo org users', async () => {
  const result = await isPlatformOperator({
    id: 1,
    orgId: 1,
    orgType: 'demo',
  });
  assert.equal(result, false);
});

test('resolveScopedOrgId pins non-operators to own org', async () => {
  const operator = { id: 2, orgId: 5, orgType: 'internal' };
  const scoped = await resolveScopedOrgId(operator, '99');
  assert.equal(scoped, 5);
});

test('resolveScopedOrgId keeps own org when no query param', async () => {
  const operator = { id: 2, orgId: 5, orgType: 'internal' };
  const scoped = await resolveScopedOrgId(operator, undefined);
  assert.equal(scoped, 5);
});
