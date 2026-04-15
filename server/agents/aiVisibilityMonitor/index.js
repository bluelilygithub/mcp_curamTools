'use strict';

/**
 * AI Visibility Monitor — weekly AI search presence agent.
 *
 * For each active monitoring prompt in ai_visibility_prompts, this agent:
 *   1. Calls Claude with the Anthropic web_search_20250305 tool
 *   2. Captures the full response text + all cited URLs
 *   3. Detects brand mentions (Diamond Plate Australia) and competitor mentions
 *
 * After all prompts have been processed, a single final Claude call
 * (via agentOrchestrator, no tools) produces the narrative analysis report.
 *
 * Architecture: pre-fetch pattern — no ReAct loop.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../../db');
const { agentOrchestrator } = require('../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../platform/AgentConfigService');
const { buildSystemPrompt } = require('./prompt');
const { TOOL_SLUG }         = require('./tools');

// ── Constants ─────────────────────────────────────────────────────────────────

const BRAND_TERMS = [
  'diamond plate australia',
  'diamondplate australia',
  'diamond plate',
  'diamondplate',
];

const COMPETITORS = [
  'Ceramic Pro',
  'Gtechniq',
  'IGL Coatings',
  'Gyeon',
  'Autobond',
];

// Default prompts seeded on first run per org. Covers 5 categories.
const DEFAULT_PROMPTS = [
  { label: 'Best paint protection in Australia',         category: 'brand',        prompt_text: 'best car paint protection coating in Australia',                         sort_order: 1 },
  { label: 'Best protection for new car',               category: 'brand',        prompt_text: 'what is the best paint protection for a new car Australia',               sort_order: 2 },
  { label: 'Ceramic coating installer near me',         category: 'brand',        prompt_text: 'recommended ceramic coating installer near me Australia',                 sort_order: 3 },
  { label: 'Ceramic Pro vs Gtechniq comparison',        category: 'competitor',   prompt_text: 'Ceramic Pro vs Gtechniq paint protection comparison',                     sort_order: 4 },
  { label: 'Best professional ceramic coating brand',   category: 'competitor',   prompt_text: 'best professional ceramic coating brand Australia',                       sort_order: 5 },
  { label: 'Gyeon vs IGL Coatings',                     category: 'competitor',   prompt_text: 'Gyeon vs IGL Coatings which is better',                                  sort_order: 6 },
  { label: 'How long does ceramic coating last',        category: 'category',     prompt_text: 'how long does ceramic coating last on a car',                            sort_order: 7 },
  { label: 'Is paint protection film worth it',         category: 'category',     prompt_text: 'is paint protection film worth the cost',                                sort_order: 8 },
  { label: 'Ceramic coating vs PPF difference',         category: 'category',     prompt_text: 'difference between ceramic coating and paint protection film',           sort_order: 9 },
  { label: 'Self-healing paint protection review',      category: 'differentiator', prompt_text: 'self-healing paint protection coating review',                         sort_order: 10 },
  { label: 'Long-life hydrophobic ceramic coating',     category: 'differentiator', prompt_text: 'hydrophobic ceramic coating that lasts 5 years',                      sort_order: 11 },
  { label: 'Ceramic coating reviews Australia',         category: 'sources',      prompt_text: 'ceramic coating reviews Australia',                                      sort_order: 12 },
  { label: 'Paint protection pros and cons',            category: 'sources',      prompt_text: 'paint protection coating pros and cons',                                 sort_order: 13 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if the response text mentions Diamond Plate Australia.
 */
function detectBrandMention(text) {
  const lower = text.toLowerCase();
  return BRAND_TERMS.some((t) => lower.includes(t));
}

/**
 * Returns an array of competitor names found in the response text.
 */
function detectCompetitorMentions(text) {
  const lower = text.toLowerCase();
  return COMPETITORS.filter((c) => lower.includes(c.toLowerCase()));
}

/**
 * Extract the plain text response and all cited URLs from a web search API response.
 * The Anthropic web search response content array may contain:
 *   - server_tool_use blocks (the search request)
 *   - web_search_tool_result blocks (search results with URLs)
 *   - text blocks (the final narrative answer)
 */
function parseWebSearchResponse(content) {
  let responseText = '';
  const citedUrls = [];

  for (const block of content) {
    if (block.type === 'text') {
      responseText += block.text;
    } else if (block.type === 'web_search_tool_result') {
      // Each result item has a url property
      const items = Array.isArray(block.content) ? block.content : [];
      for (const item of items) {
        if (item.url && !citedUrls.includes(item.url)) {
          citedUrls.push(item.url);
        }
      }
    }
  }

  return { responseText: responseText.trim(), citedUrls };
}

// ── Seed default prompts ──────────────────────────────────────────────────────

async function seedDefaultPromptsIfEmpty(orgId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*) AS cnt FROM ai_visibility_prompts WHERE org_id = $1',
    [orgId]
  );

  if (parseInt(rows[0].cnt, 10) > 0) return;

  const values = DEFAULT_PROMPTS.map((p, i) => [
    orgId, p.prompt_text, p.category, p.label, true, p.sort_order,
  ]);

  for (const v of values) {
    await pool.query(
      `INSERT INTO ai_visibility_prompts
         (org_id, prompt_text, category, label, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      v
    );
  }
}

// ── Per-prompt web search call ────────────────────────────────────────────────

async function runWebSearchPrompt(wsClient, promptText, model) {
  const response = await wsClient.messages.create({
    model:      model,
    max_tokens: 1024,
    tools: [
      {
        type:     'web_search_20250305',
        name:     'web_search',
        max_uses: 3,
      },
    ],
    messages: [
      {
        role:    'user',
        content: promptText,
      },
    ],
  });

  return parseWebSearchResponse(response.content);
}

// ── Agent run ─────────────────────────────────────────────────────────────────

async function runAiVisibilityMonitor(context) {
  const { orgId, req, emit } = context;

  const config = Object.keys(context.config || {}).length > 0
    ? context.config
    : await AgentConfigService.getAgentConfig(orgId, TOOL_SLUG);

  const adminConfig = Object.keys(context.adminConfig || {}).length > 0
    ? context.adminConfig
    : await AgentConfigService.getAdminConfig(TOOL_SLUG);

  const model = (adminConfig.model) || 'claude-sonnet-4-6';

  // ── Seed defaults and load active prompts ─────────────────────────────────

  emit('Loading monitoring prompts...');
  await seedDefaultPromptsIfEmpty(orgId);

  const { rows: prompts } = await pool.query(
    `SELECT id, prompt_text, category, label
       FROM ai_visibility_prompts
      WHERE org_id = $1 AND is_active = true
      ORDER BY sort_order, id`,
    [orgId]
  );

  if (prompts.length === 0) {
    throw new Error('No active monitoring prompts configured.');
  }

  emit('Found ' + prompts.length + ' active monitoring prompts');

  // ── Load previous run for comparison ─────────────────────────────────────

  let previousRunData = null;
  try {
    const { rows: prevRows } = await pool.query(
      `SELECT result FROM agent_runs
        WHERE org_id = $1 AND slug = $2 AND status = 'complete'
        ORDER BY run_at DESC LIMIT 1`,
      [orgId, TOOL_SLUG]
    );
    if (prevRows.length > 0 && prevRows[0].result) {
      previousRunData = prevRows[0].result.data ?? null;
    }
  } catch (e) {
    // Non-fatal — proceed without prior comparison
  }

  // ── Create web search client with beta header ─────────────────────────────

  const wsClient = new Anthropic({
    apiKey:         process.env.ANTHROPIC_API_KEY,
    defaultHeaders: { 'anthropic-beta': 'web-search-2025-03-05' },
  });

  // ── Run each prompt ───────────────────────────────────────────────────────

  emit('Running ' + prompts.length + ' monitoring prompts against live web search...');

  const promptResults = [];
  let brandMentionCount = 0;
  const competitorMentionTotals = {};

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    const label = p.label || p.prompt_text.slice(0, 40);
    emit('[' + (i + 1) + '/' + prompts.length + '] Searching: ' + label);

    try {
      const { responseText, citedUrls } = await runWebSearchPrompt(wsClient, p.prompt_text, model);

      const brandMentioned       = detectBrandMention(responseText);
      const competitorsMentioned = detectCompetitorMentions(responseText);

      if (brandMentioned) brandMentionCount++;
      for (const comp of competitorsMentioned) {
        competitorMentionTotals[comp] = (competitorMentionTotals[comp] || 0) + 1;
      }

      promptResults.push({
        promptId:             p.id,
        promptText:           p.prompt_text,
        category:             p.category,
        label:                p.label || null,
        responseText:         responseText,
        citedUrls:            citedUrls,
        brandMentioned:       brandMentioned,
        competitorsMentioned: competitorsMentioned,
      });
    } catch (err) {
      emit('Error on prompt "' + label + '": ' + err.message);
      promptResults.push({
        promptId:             p.id,
        promptText:           p.prompt_text,
        category:             p.category,
        label:                p.label || null,
        error:                err.message,
        responseText:         '',
        citedUrls:            [],
        brandMentioned:       false,
        competitorsMentioned: [],
      });
    }
  }

  // ── Build summary stats ───────────────────────────────────────────────────

  const totalPrompts       = prompts.length;
  const brandMentionRate   = totalPrompts > 0 ? Math.round((brandMentionCount / totalPrompts) * 100) : 0;

  // Rank competitors by mention count
  const competitorRanking = Object.entries(competitorMentionTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count, rate: Math.round((count / totalPrompts) * 100) }));

  const topCompetitor = competitorRanking.length > 0 ? competitorRanking[0].name : null;

  // Collect all cited domains
  const domainCounts = {};
  for (const pr of promptResults) {
    for (const url of (pr.citedUrls || [])) {
      try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        domainCounts[domain] = (domainCounts[domain] || 0) + 1;
      } catch { /* skip malformed URLs */ }
    }
  }
  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([domain, count]) => ({ domain, count }));

  // Prior period comparison
  let priorBrandMentionRate = null;
  if (previousRunData && previousRunData.summaryStats) {
    priorBrandMentionRate = previousRunData.summaryStats.brandMentionRate ?? null;
  }

  const summaryStats = {
    totalPrompts,
    brandMentionCount,
    brandMentionRate,
    priorBrandMentionRate,
    competitorRanking,
    topCompetitor,
    topDomains,
  };

  // ── Final narrative analysis via Claude (no tools) ─────────────────────────

  emit('Analysing AI visibility results...');

  const analysisPayload = {
    summaryStats,
    promptResults: promptResults.map((pr) => ({
      promptText:           pr.promptText,
      category:             pr.category,
      label:                pr.label,
      responseText:         pr.responseText,
      citedUrls:            pr.citedUrls,
      brandMentioned:       pr.brandMentioned,
      competitorsMentioned: pr.competitorsMentioned,
      error:                pr.error || null,
    })),
    previousRunSummaryStats: priorBrandMentionRate !== null ? previousRunData.summaryStats : null,
  };

  const userMessage =
    'Produce the AI Visibility Monitor weekly report. All monitoring data has been pre-fetched below.\n\n' +
    '```json\n' + JSON.stringify(analysisPayload, null, 2) + '\n```';

  const run = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(config),
    userMessage:   userMessage,
    tools:         [],
    maxIterations: 1,
    model:         model,
    maxTokens:     (adminConfig.max_tokens) ?? 4096,
    fallbackModel: (adminConfig.fallback_model) ?? null,
    onStep:        emit,
    context:       Object.assign({}, context, { toolSlug: TOOL_SLUG }),
  });

  return {
    result: {
      summary: run.result?.summary ?? '',
      data:    { promptResults, summaryStats },
    },
    trace:      run.trace,
    tokensUsed: run.tokensUsed,
  };
}

module.exports = { runAiVisibilityMonitor };
