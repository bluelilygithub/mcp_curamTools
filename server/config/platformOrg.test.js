'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getPlatformOrgId, resolveOrgId, isPlatformOrg } = require('./platformOrg');

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('getPlatformOrgId defaults to 1', () => {
  withEnv({ PLATFORM_ORG_ID: undefined }, () => {
    assert.equal(getPlatformOrgId(), 1);
  });
});

test('getPlatformOrgId reads PLATFORM_ORG_ID env', () => {
  withEnv({ PLATFORM_ORG_ID: '42' }, () => {
    assert.equal(getPlatformOrgId(), 42);
  });
});

test('resolveOrgId falls back to platform org for invalid input', () => {
  withEnv({ PLATFORM_ORG_ID: '7' }, () => {
    assert.equal(resolveOrgId(undefined), 7);
    assert.equal(resolveOrgId(''), 7);
    assert.equal(resolveOrgId('abc'), 7);
  });
});

test('isPlatformOrg compares against configured platform org', () => {
  withEnv({ PLATFORM_ORG_ID: '3' }, () => {
    assert.equal(isPlatformOrg(3), true);
    assert.equal(isPlatformOrg(1), false);
  });
});
