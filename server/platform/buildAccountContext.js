/**
 * buildAccountContext — platform primitive for intelligence profile injection.
 * Generic — contains zero agent-specific logic.
 * The agentSpecific extension field carries agent-owned context.
 *
 * Returns '' when profile is null or empty so the system prompt starts
 * with the role block unmodified.
 *
 * Shared base fields (all agents):
 *   targetROAS           — declared target return on ad spend
 *   targetCPA            — declared target cost per acquisition (AUD)
 *   businessContext      — free text: what the business does, key constraints
 *   analyticalGuardrails — free text: what the agent should NOT flag as issues
 *
 * Agent-specific extension:
 *   agentSpecific        — open JSONB; agent-owned keys formatted as key: value lines
 */
function buildAccountContext(profile, agentSlug) {
  if (!profile || Object.keys(profile).length === 0) return '';

  const lines = ['## Account Intelligence Profile'];
  lines.push('');

  const { targetROAS, targetCPA, businessContext, analyticalGuardrails, agentSpecific } = profile;

  if (targetROAS != null) {
    lines.push(`**Target ROAS:** ${targetROAS}x`);
  }
  if (targetCPA != null) {
    lines.push(`**Target CPA:** AUD $${targetCPA}`);
  }
  if (businessContext) {
    lines.push('');
    lines.push('**Business Context:**');
    lines.push(businessContext);
  }
  if (analyticalGuardrails) {
    lines.push('');
    lines.push('**Analytical Guardrails (do not flag as issues):**');
    lines.push(analyticalGuardrails);
  }

  // Agent-specific extension: format as key: value pairs
  if (agentSpecific && typeof agentSpecific === 'object') {
    const agentLines = Object.entries(agentSpecific)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `**${formatKey(k)}:** ${v}`);

    if (agentLines.length > 0) {
      lines.push('');
      lines.push(`**${agentSlug} context:**`);
      agentLines.forEach((l) => lines.push(l));
    }
  }

  // Guard: if only the header was added, return ''
  if (lines.length <= 2) return '';

  lines.push('');
  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

function formatKey(camelOrSnake) {
  return camelOrSnake
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

module.exports = { buildAccountContext };
