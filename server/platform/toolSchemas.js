'use strict';

/**
 * toolSchemas — structural validation for tool result shapes.
 *
 * Each entry is a pure function (result) => string[] of failure messages.
 * Aggregates failure types rather than per-row instances to keep boundsFailed concise.
 * Only covers the most-used tools — extend as needed.
 */

function validateCampaignPerformance(result) {
  const failures = [];
  if (!Array.isArray(result)) {
    failures.push('expected array, got ' + (result === null ? 'null' : typeof result));
    return failures;
  }
  if (result.length === 0) return failures;

  let badCtr = 0, badCost = 0, badConversions = 0, badClicksVsImpressions = 0;

  for (const row of result) {
    if (typeof row.ctr !== 'number' || row.ctr < 0 || row.ctr > 1) badCtr++;
    if (typeof row.cost !== 'number' || row.cost < 0) badCost++;
    if (typeof row.conversions !== 'number' || row.conversions < 0) badConversions++;
    if (
      typeof row.clicks === 'number' &&
      typeof row.impressions === 'number' &&
      row.impressions > 0 &&
      row.clicks > row.impressions
    ) badClicksVsImpressions++;
  }

  if (badCtr > 0) failures.push(`${badCtr} row(s) with CTR outside [0,1]`);
  if (badCost > 0) failures.push(`${badCost} row(s) with negative cost`);
  if (badConversions > 0) failures.push(`${badConversions} row(s) with negative conversions`);
  if (badClicksVsImpressions > 0) failures.push(`${badClicksVsImpressions} row(s) where clicks > impressions`);

  return failures;
}

function validateDailyPerformance(result) {
  const failures = [];
  if (!Array.isArray(result)) {
    failures.push('expected array, got ' + (result === null ? 'null' : typeof result));
    return failures;
  }
  if (result.length === 0) return failures;

  let badDate = 0, badCost = 0, badClicksVsImpressions = 0;
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  for (const row of result) {
    if (!row.date || !ISO_DATE.test(row.date)) badDate++;
    if (typeof row.cost !== 'number' || row.cost < 0) badCost++;
    if (
      typeof row.clicks === 'number' &&
      typeof row.impressions === 'number' &&
      row.impressions > 0 &&
      row.clicks > row.impressions
    ) badClicksVsImpressions++;
  }

  if (badDate > 0) failures.push(`${badDate} row(s) with invalid or missing date`);
  if (badCost > 0) failures.push(`${badCost} row(s) with negative cost`);
  if (badClicksVsImpressions > 0) failures.push(`${badClicksVsImpressions} row(s) where clicks > impressions`);

  return failures;
}

function validateSearchTerms(result) {
  const failures = [];
  if (!Array.isArray(result)) {
    failures.push('expected array, got ' + (result === null ? 'null' : typeof result));
    return failures;
  }
  if (result.length === 0) return failures;

  let badTerm = 0, badCtr = 0, badCost = 0;

  for (const row of result) {
    if (!row.term || typeof row.term !== 'string') badTerm++;
    if (typeof row.ctr === 'number' && (row.ctr < 0 || row.ctr > 1)) badCtr++;
    if (typeof row.cost !== 'number' || row.cost < 0) badCost++;
  }

  if (badTerm > 0) failures.push(`${badTerm} row(s) with missing or non-string term`);
  if (badCtr > 0) failures.push(`${badCtr} row(s) with CTR outside [0,1]`);
  if (badCost > 0) failures.push(`${badCost} row(s) with negative cost`);

  return failures;
}

const TOOL_SCHEMAS = {
  get_campaign_performance: validateCampaignPerformance,
  get_daily_performance:    validateDailyPerformance,
  get_search_terms:         validateSearchTerms,
};

module.exports = { TOOL_SCHEMAS };
