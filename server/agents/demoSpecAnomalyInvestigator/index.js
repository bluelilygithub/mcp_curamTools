'use strict';

/**
 * Demo Spec Anomaly Investigator — ReAct investigation agent.
 *
 * Upstream of Spec Validator: investigates whether and where a hydraulic
 * specification is likely to contain problems, before formal Python calculation.
 *
 * Input:  fileData (base64 PDF) + optional freeformConcern string
 * Output: Investigation Log / Dead Ends / Open Threads
 *         No compliance findings, no certificate.
 *
 * Post-run validation checks section presence and hypothesis hygiene.
 * Missing sections or tool-count > hypothesis-count → boundsFailed → needs_review.
 */

const { agentOrchestrator }    = require('../../platform/AgentOrchestrator');
const AgentConfigService       = require('../../platform/AgentConfigService');
const FileIntakeService        = require('../../services/FileIntakeService');
const { buildSystemPrompt }    = require('./prompt');
const { demoSpecAnomalyInvestigatorTools, TOOL_SLUG } = require('./tools');

const REQUIRED_SECTIONS = [
  { marker: '## Investigation Log', label: 'Investigation Log' },
  { marker: '## Dead Ends',         label: 'Dead Ends' },
  { marker: '## Open Threads',      label: 'Open Threads' },
];

function validateOutputSections(summary) {
  const failures = [];

  for (const { marker, label } of REQUIRED_SECTIONS) {
    if (!summary.includes(marker)) {
      failures.push({ tool: 'output-structure', message: `Missing required section: ${label}` });
    }
  }

  // Hypothesis hygiene: count **Hypothesis:** vs **Tool:** in the Investigation Log
  const logMatch = summary.match(/## Investigation Log([\s\S]*?)(?=## Dead Ends|## Open Threads|$)/);
  if (logMatch) {
    const logContent    = logMatch[1];
    const toolCount     = (logContent.match(/\*\*Tool:\*\*/g)      ?? []).length;
    const hypothesisCount = (logContent.match(/\*\*Hypothesis:\*\*/g) ?? []).length;
    if (toolCount > 0 && hypothesisCount < toolCount) {
      failures.push({
        tool: 'reasoning-hygiene',
        message: `${toolCount - hypothesisCount} of ${toolCount} log entries missing pre-call hypothesis — possible reporting pattern, not reasoning`,
      });
    }
  }

  return failures;
}

async function runDemoSpecAnomalyInvestigator(context) {
  const { orgId, req, emit } = context;

  const adminConfig = await AgentConfigService.getResolvedAdminConfig(TOOL_SLUG, orgId);
  if (!adminConfig.model) {
    throw new Error('No model configured for Spec Anomaly Investigator. Set a vision-capable model in Admin › Agents.');
  }

  // File intake — required
  const rawFileData = req?.body?.fileData;
  const mimeType    = req?.body?.mimeType ?? 'application/pdf';
  const fileName    = req?.body?.fileName ?? 'specification.pdf';

  if (!rawFileData) throw new Error('No file uploaded. Upload a hydraulic specification PDF to investigate.');

  emit('Validating uploaded file…');
  const clearedFile = await FileIntakeService.clearFile({
    base64Data:   rawFileData,
    mimeType,
    fileName,
    orgId,
    userId:       req?.user?.id,
    allowedMimes: ['application/pdf'],
  });

  const freeformConcern = (req?.body?.freeformConcern ?? '').trim();

  // Load custom providers so tools can make direct model calls
  const customProviders = await AgentConfigService.getCustomProviders(orgId).catch(() => []);

  let userMessage =
    `Investigate this hydraulic specification document for potential problems.\n\n` +
    `Start by extracting the document content, then follow the evidence from what you find.`;

  if (freeformConcern) {
    userMessage +=
      `\n\nThe engineer has flagged a specific concern:\n\n"${freeformConcern}"\n\n` +
      `Investigate this concern, but do not restrict your investigation to it — if extraction reveals other risks, follow those too.`;
  } else {
    userMessage +=
      `\n\nNo specific concern was provided — investigate freely based on what the document contains.`;
  }

  emit('Starting investigation…');

  const { result, trace, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(),
    userMessage,
    tools:         demoSpecAnomalyInvestigatorTools,
    model:         adminConfig.model,
    maxTokens:     adminConfig.max_tokens    ?? 4096,
    maxIterations: adminConfig.max_iterations ?? 12,
    fallbackModel: adminConfig.fallback_model ?? null,
    onStep:        emit,
    context: {
      ...context,
      pdfBuffer:      clearedFile.buffer,
      adminConfig,
      customProviders,
      toolSlug:       TOOL_SLUG,
    },
  });

  const sectionFailures = validateOutputSections(result.summary ?? '');

  return {
    result: {
      ...result,
      boundsFailed:   sectionFailures,
      fileName:       clearedFile.sanitisedName ?? fileName,
      freeformConcern: freeformConcern || null,
    },
    trace,
    tokensUsed,
  };
}

module.exports = { runDemoSpecAnomalyInvestigator };
