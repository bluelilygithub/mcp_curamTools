'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseExtractionJson } = require('./index');

test('parseExtractionJson accepts fenced JSON', () => {
  const parsed = parseExtractionJson('```json\n{ "document_type": "sheet", "fields": [] }\n```');
  assert.equal(parsed.document_type, 'sheet');
  assert.deepEqual(parsed.fields, []);
});

test('parseExtractionJson accepts inline fenced JSON', () => {
  const parsed = parseExtractionJson('```json { "document_type": "sheet", "fields": [] } ```');
  assert.equal(parsed.document_type, 'sheet');
});

test('parseExtractionJson reports incomplete JSON clearly', () => {
  assert.throws(
    () => parseExtractionJson('```json\n{ "document_type": "sheet", "fields": [{ "name": "a"'),
    /No complete JSON object found/
  );
});
