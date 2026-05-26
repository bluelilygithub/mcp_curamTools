'use strict';

const { scanInjection, sanitiseText } = require('../utils/sanitize');

function cleanString(value, { max = 1000, field = 'value', required = false, scan = false } = {}) {
  const cleaned = sanitiseText(value ?? '').slice(0, max).trim();
  if (required && !cleaned) {
    throw Object.assign(new Error(`${field} is required.`), { status: 400 });
  }
  if (scan && !scanInjection(cleaned).clean) {
    throw Object.assign(new Error(`${field} rejected because it contains prompt-injection language.`), { status: 400 });
  }
  return cleaned;
}

function rejectUnknownKeys(input = {}, allowed = [], label = 'request') {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(input ?? {}).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw Object.assign(new Error(`Unknown ${label} field(s): ${unknown.join(', ')}`), { status: 400 });
  }
}

function cleanBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

module.exports = {
  cleanString,
  rejectUnknownKeys,
  cleanBoolean,
};
