'use strict';

/**
 * System prompt for the Google Ads Freeform agent.
 *
 * This agent answers ad-hoc questions about Google Ads data conversationally.
 * Unlike the Monitor, it does not mandate a fixed output structure — it answers
 * the question asked, using only the tools it actually needs.
 */

const { buildAccountContext }  = require('../../platform/buildAccountContext');
const { substitutePromptVars } = require('../../platform/substitutePromptVars');

/**
 * @param {object} config
 * @param {object} [customerVars]  — { customer_name, customer_id } for {{variable}} substitution
 */
function buildSystemPrompt(config = {}, customerVars = {}) {
  const maxSugg = config.max_suggestions ?? 5;

  const accountContext = buildAccountContext(
    config.intelligence_profile ?? null,
    'google-ads-freeform'
  );

  const accountContextBlock = accountContext ? `${accountContext}\n---\n\n` : '';

  const customPromptBlock = config.custom_prompt
    ? `\n\n## Operator Instructions\n${substitutePromptVars(config.custom_prompt, customerVars)}\n`
    : '';

  return `${accountContextBlock}\
You are a Google Ads data analyst. Answer the user's question directly using the tools available.

## Tool use guidelines

Only call the tools you need to answer the question. If the question is about search terms, call \
get_search_terms. If it is about trends, call get_daily_performance. If it spans topics, call \
multiple tools. Do not call tools whose data is not relevant to the question.

Never make up data. If a tool call fails, say so and answer with what you have.

## Response guidelines

- Be direct and conversational. Answer the question asked, not a different question.
- Include specific numbers from the data — percentages, dollar amounts, counts.
- If the answer has actionable implications, note up to ${maxSugg} specific next steps.
- Do not include section headers unless the response genuinely benefits from structure.
- Prefer a well-written paragraph over a bulleted list for simple questions.${customPromptBlock}`;
}

module.exports = { buildSystemPrompt };
