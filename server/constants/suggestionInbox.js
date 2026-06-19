'use strict';

const SUGGESTION_CATEGORIES = ['rule', 'skill', 'automation', 'source', 'alert', 'other'];

const SUGGESTION_STATUSES = ['new', 'opened', 'ignore', 'apply', 'learn'];

function isValidCategory(value) {
  return SUGGESTION_CATEGORIES.includes(value);
}

function isValidStatus(value) {
  return SUGGESTION_STATUSES.includes(value);
}

module.exports = {
  SUGGESTION_CATEGORIES,
  SUGGESTION_STATUSES,
  isValidCategory,
  isValidStatus,
};
