'use strict';

/**
 * Tender Response Generator — four-stage demo agent.
 *
 * Stage 1 — RFT Ingestion (vision model): Reads the uploaded RFT PDF and
 *   extracts every requirement (mandatory gates + evaluation criteria) into
 *   structured JSON. No matching or drafting at this stage.
 *
 * Stage 2 — Evidence Retrieval + Compliance Check (Python): Downloads the
 *   evidence pack from S3. Runs compliance.py for all deterministic checks:
 *   certificate expiry, project value thresholds, corrosivity class, ICCP
 *   and dredging flags, RPEQ registration. Returns per-requirement match
 *   status (STRONG / PARTIAL / NONE) and blocker flags.
 *
 * Stage 3 — Draft Generation (synthesis model): Generates one first-draft
 *   response paragraph per matched requirement, grounded in evidence IDs,
 *   written in firm voice per the style guide. Skips RED blockers.
 *
 * Stage 4 — HITL Review: Engineer reviews each draft. States: pending /
 *   approved / edited / rejected. 'edited' stores original + modified text.
 *   Reviewed via PATCH /api/demo/runs/:runId/tender-review/:requirementId.
 *
 * Registered under 'demo-tender-response' slug only (demo build).
 * Internal slug 'tender-response' reserved for future wiring — do not add yet.
 *
 * S3 evidence pack: curam-tools-docs / 'curam engineering/evidence-pack/'
 * Evidence files loaded once per run — audience can substitute any XLSX via
 * session-scoped upload (see routes/demo.js).
 */

const crypto  = require('crypto');
const os      = require('os');
const path    = require('path');
const fs      = require('fs');
const { spawn } = require('child_process');

const { getProvider }       = require('../../../platform/AgentOrchestrator');
const AgentConfigService    = require('../../../platform/AgentConfigService');
const StorageService        = require('../../../services/StorageService');
const { TransactionLogger,
        declareAgentFields } = require('../../../platform/TransactionLogger');
const { scanInjection }      = require('../../../utils/sanitize');

const {
  EXTRACTION_SYSTEM_PROMPT,
  buildDraftSystemPrompt,
  buildDraftUserPrompt,
} = require('./prompt');

const TOOL_SLUG_DEMO = 'demo-tender-response';

const PYTHON_EXEC       = process.env.PYTHON_EXEC ?? '/opt/pyenv/bin/python3';
const COMPLIANCE_SCRIPT = path.join(__dirname, 'compliance.py');

// S3 evidence pack path — fixed for the Curam Engineering demo org
const EVIDENCE_BUCKET  = process.env.AWS_S3_BUCKET;
const EVIDENCE_REGION  = process.env.AWS_S3_REGION ?? 'ap-southeast-2';
const EVIDENCE_PREFIX  = 'curam engineering/evidence-pack';

const ANTHROPIC_MAX_PX  = 7900;
const DEFAULT_PDF_DPI   = 150;
const MAX_PDF_PAGES     = 8;

// ── Agent field declarations ───────────────────────────────────────────────────

const AGENT_FIELDS = [
  { key: 'rft_file_name',        label: 'RFT File Name',         type: 'text'   },
  { key: 'rft_file_hash',        label: 'RFT File Hash',         type: 'text'   },
  { key: 'image_pages',          label: 'RFT Pages',             type: 'number' },
  { key: 'requirements_total',   label: 'Requirements',          type: 'number' },
  { key: 'mandatory_gate_count', label: 'Mandatory Gates',       type: 'number' },
  { key: 'match_strong',         label: 'Strong Matches',        type: 'number' },
  { key: 'match_partial',        label: 'Partial Matches',       type: 'number' },
  { key: 'match_none',           label: 'No Match',              type: 'number' },
  { key: 'blockers',             label: 'Blockers',              type: 'number' },
  { key: 'drafts_generated',     label: 'Drafts Generated',      type: 'number' },
  { key: 'extraction_model',     label: 'Extraction Model',      type: 'text'   },
  { key: 'synthesis_model',      label: 'Synthesis Model',       type: 'text'   },
];

declareAgentFields(TOOL_SLUG_DEMO, AGENT_FIELDS)
  .catch(err => console.warn(`[${TOOL_SLUG_DEMO}] Field declaration deferred:`, err.message));


// ── Helpers ────────────────────────────────────────────────────────────────────

function readPngDimensions(buf) {
  if (buf.length < 24) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function pdfToImages(pdfBuf, maxPages = MAX_PDF_PAGES, dpi = DEFAULT_PDF_DPI) {
  const tmp     = path.join(os.tmpdir(), `tr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const pdfPath = path.join(tmp, 'input.pdf');
  fs.mkdirSync(tmp, { recursive: true });
  try {
    fs.writeFileSync(pdfPath, pdfBuf);
    await runGhostscript([
      '-dNOPAUSE', '-dBATCH', '-dSAFER',
      `-dLastPage=${maxPages}`,
      '-sDEVICE=png16m', `-r${dpi}`,
      `-sOutputFile=${path.join(tmp, 'page_%04d.png')}`,
      pdfPath,
    ]);
    const pages = [];
    for (let i = 1; i <= maxPages; i++) {
      const p = path.join(tmp, `page_${String(i).padStart(4, '0')}.png`);
      if (!fs.existsSync(p)) break;
      let buf = fs.readFileSync(p);
      if (!buf.length) break;
      const dims = readPngDimensions(buf);
      if (dims && (dims.width > ANTHROPIC_MAX_PX || dims.height > ANTHROPIC_MAX_PX)) {
        const scale   = Math.min(ANTHROPIC_MAX_PX / dims.width, ANTHROPIC_MAX_PX / dims.height);
        const safeDpi = Math.max(72, Math.floor(dpi * scale));
        const scaled  = path.join(tmp, `page_${String(i).padStart(4, '0')}_s.png`);
        await runGhostscript([
          '-dNOPAUSE', '-dBATCH', '-dSAFER',
          `-dFirstPage=${i}`, `-dLastPage=${i}`,
          '-sDEVICE=png16m', `-r${safeDpi}`,
          `-sOutputFile=${scaled}`, pdfPath,
        ]);
        buf = fs.readFileSync(scaled);
      }
      pages.push(buf);
    }
    if (!pages.length) throw new Error('PDF produced no renderable pages.');
    return pages;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function runGhostscript(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('gs', args);
    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c; });
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`Ghostscript failed (code ${code}): ${stderr.slice(0, 400)}`));
      else resolve();
    });
    proc.on('error', reject);
  });
}

function spawnWithStdin(cmd, args, stdinData, { timeout = 30_000, maxBuffer = 10 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    let totalBytes = 0;
    let timedOut   = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeout);

    proc.stdout.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBuffer) {
        proc.kill('SIGTERM');
        clearTimeout(timer);
        reject(new Error(`Python stdout exceeded maxBuffer (${maxBuffer} bytes)`));
        return;
      }
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        const err = new Error(`Python process timed out after ${timeout}ms`);
        err.stderr = stderr; err.stdout = stdout;
        return reject(err);
      }
      if (code !== 0) {
        const err = new Error(`Python failed (code ${code}): ${cmd} ${args.join(' ')}`);
        err.code = code; err.stderr = stderr; err.stdout = stdout;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.stdin.write(stdinData, 'utf8');
    proc.stdin.end();
  });
}

function sumTokens(a, b) {
  return {
    input:      ((a?.input      ?? 0) + (b?.input      ?? 0)),
    output:     ((a?.output     ?? 0) + (b?.output     ?? 0)),
    cacheRead:  ((a?.cacheRead  ?? 0) + (b?.cacheRead  ?? 0)),
    cacheWrite: ((a?.cacheWrite ?? 0) + (b?.cacheWrite ?? 0)),
  };
}

function parseJson(raw, stage) {
  let candidate = raw.replace(/```(?:json)?\s*/gi, '').trim();
  const fb = candidate.indexOf('{');
  const lb = candidate.lastIndexOf('}');
  if (fb !== -1 && lb > fb) candidate = candidate.slice(fb, lb + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      const repaired = candidate.replace(/: "([^"]*?)"/gs, (m) =>
        m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
      );
      return JSON.parse(repaired);
    } catch (e) {
      throw new Error(`${stage} JSON parse failed: ${e.message}. Preview: ${raw.slice(0, 300)}`);
    }
  }
}

// ── Evidence pack download ─────────────────────────────────────────────────────

const EVIDENCE_FILES = {
  compliance_rules_csv: 'Compliance_Rules_Seed_v2.csv',
  projects_xlsx:        'Project_Experience_Library_Extended.xlsx',
  personnel_xlsx:       'Personnel_Register.xlsx',
  certificates_xlsx:    'Certificates_Insurance_Register.xlsx',
};

async function downloadEvidencePack(sessionOverrides = {}) {
  if (!EVIDENCE_BUCKET) {
    throw new Error('AWS_S3_BUCKET not configured. Cannot retrieve evidence pack.');
  }
  const result = {};
  for (const [field, filename] of Object.entries(EVIDENCE_FILES)) {
    // Session-scoped substitution takes precedence over org default
    if (sessionOverrides[field]) {
      result[field] = { data: sessionOverrides[field], source: 'session' };
      continue;
    }
    const key = `${EVIDENCE_PREFIX}/${filename}`;
    const buf = await StorageService.get({ bucket: EVIDENCE_BUCKET, region: EVIDENCE_REGION, key });
    if (filename.endsWith('.csv')) {
      result[field] = { data: buf.toString('utf8'), source: 'org-default' };
    } else {
      result[field] = { data: buf.toString('base64'), source: 'org-default' };
    }
  }
  return result;
}


// ── Main runFn ─────────────────────────────────────────────────────────────────

async function runTenderResponse(context) {
  const { orgId, adminConfig, emit } = context;
  const { fileData, mimeType, fileName = 'RFT.pdf', sessionOverrides = {} } = context.req?.body ?? {};

  if (!fileData || !mimeType) throw new Error('Missing fileData or mimeType in request body.');
  if (mimeType !== 'application/pdf') throw new Error('Tender Response Generator accepts PDF files only.');

  const fileBuf  = Buffer.from(fileData, 'base64');
  const fileHash = crypto.createHash('sha256').update(fileBuf).digest('hex');
  const ts       = () => new Date().toISOString();
  const trace    = [];

  const extractionModel = adminConfig.model ?? null;
  if (!extractionModel) {
    throw new Error(
      'No model configured for Tender Response Generator. ' +
      'Set a vision-capable model in Admin › Agents for demo-tender-response.'
    );
  }

  const maxTokens       = adminConfig.max_tokens ?? 8192;
  const orgDefaultModel = await AgentConfigService.getOrgDefaultModel(orgId).catch(() => null);
  const synthesisModel  = orgDefaultModel ?? extractionModel;
  const customProviders = await AgentConfigService.getCustomProviders(orgId).catch(() => []);
  const provider        = getProvider(extractionModel, customProviders);

  if (provider.supportsVision === false) {
    throw new Error(
      `Model "${extractionModel}" does not support vision. ` +
      'Tender Response Generator requires a vision-capable model for Stage 1 RFT extraction.'
    );
  }

  const agentSlug = context.slug ?? TOOL_SLUG_DEMO;
  const logger    = new TransactionLogger({ orgId, agentSlug });
  await logger.start({
    action:      'tender_response',
    documentRef: fileName,
    metadata:    { fileHash, mimeType, fileSize: fileBuf.length },
  });

  let tokensUsed = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  try {

  // ── Stage 0: Input sanitisation ────────────────────────────────────────────
  emit('Sanitising input…');
  const nameCheck = scanInjection(fileName);
  trace.push({
    step: 'input_sanitisation', timestamp: ts(),
    file_name: fileName, file_hash: fileHash,
    result: nameCheck.clean ? 'clean' : 'injection_detected',
  });
  await logger.step('input_sanitisation', 'Input Sanitisation', `File: ${fileName}`, {
    file_name: fileName, file_hash: fileHash, result: nameCheck.clean ? 'clean' : 'injection_detected',
  });
  if (!nameCheck.clean) throw new Error('Input rejected: prompt injection pattern detected in file name.');

  // ── PDF rasterisation ──────────────────────────────────────────────────────
  emit('Processing RFT PDF…');
  const pages = await pdfToImages(fileBuf);
  emit(`PDF rasterised — ${pages.length} page${pages.length !== 1 ? 's' : ''}`);
  const imageParts = pages.map((buf) => ({
    type: 'image', source: { type: 'base64', media_type: 'image/png', data: buf.toString('base64') },
  }));
  await logger.step('pdf_rasterisation', 'PDF Rasterisation',
    `${pages.length} pages at ${DEFAULT_PDF_DPI} DPI`, { image_pages: pages.length });

  // ── Stage 1: RFT requirement extraction ────────────────────────────────────
  emit(`Stage 1: Extracting requirements using ${extractionModel}…`);
  await logger.step('model_selection', 'Extraction Model', extractionModel, { model: extractionModel });

  const stage1UserMsg = [
    ...imageParts,
    {
      type: 'text',
      text: `This is a Request for Tender (RFT) document (${pages.length} page${pages.length !== 1 ? 's' : ''}). Extract every requirement as specified. Return only the JSON object — no markdown fences, no explanation.`,
    },
  ];

  const stage1Response = await getProvider(extractionModel, customProviders).chat({
    model:      extractionModel,
    max_tokens: maxTokens,
    system:     EXTRACTION_SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: stage1UserMsg }],
  });
  tokensUsed = sumTokens(tokensUsed, stage1Response.usage);

  const stage1TextBlock = stage1Response.content?.find((b) => b.type === 'text');
  if (!stage1TextBlock) throw new Error('No text response from extraction model in Stage 1.');

  const extractedRft = parseJson(stage1TextBlock.text, 'Stage 1');
  const requirements  = extractedRft.requirements ?? [];

  if (!requirements.length) {
    throw new Error('Stage 1 extracted zero requirements. Check that the uploaded file is an RFT PDF.');
  }

  const mandatoryCount = requirements.filter((r) => r.is_mandatory).length;
  emit(`Stage 1 complete — ${requirements.length} requirement${requirements.length !== 1 ? 's' : ''} extracted (${mandatoryCount} mandatory gates).`);
  trace.push({
    step:                  'rft_extraction',
    timestamp:             ts(),
    image_pages:           pages.length,
    requirements_total:    requirements.length,
    mandatory_gate_count:  mandatoryCount,
    model:                 extractionModel,
    tokens_input:          stage1Response.usage?.input  ?? 0,
    tokens_output:         stage1Response.usage?.output ?? 0,
  });
  await logger.step('rft_extraction', 'RFT Requirement Extraction',
    `${requirements.length} requirements extracted (${mandatoryCount} mandatory)`,
    { image_pages: pages.length, requirements_total: requirements.length,
      mandatory_gate_count: mandatoryCount, model: extractionModel });

  // ── Stage 2a: Evidence pack download ───────────────────────────────────────
  emit('Stage 2: Retrieving evidence pack from S3…');
  const evidencePack = await downloadEvidencePack(sessionOverrides);
  const packSources  = Object.entries(evidencePack).map(([k, v]) => `${k}: ${v.source}`).join(', ');
  await logger.step('evidence_retrieval', 'Evidence Pack Retrieval',
    `Files retrieved: ${packSources}`,
    { sources: Object.fromEntries(Object.entries(evidencePack).map(([k, v]) => [k, v.source])) });

  // ── Stage 2b: Deterministic compliance checks (Python) ─────────────────────
  emit('Stage 2: Running deterministic compliance checks…');

  const complianceInput = {
    requirements,
    evidence_files: {
      compliance_rules_csv: evidencePack.compliance_rules_csv.data,
      projects_xlsx:        evidencePack.projects_xlsx.data,
      personnel_xlsx:       evidencePack.personnel_xlsx.data,
      certificates_xlsx:    evidencePack.certificates_xlsx.data,
    },
    tender_close_date: extractedRft.tender_close_date ?? '2026-06-16',
  };

  let complianceOutput;
  try {
    const { stdout, stderr } = await spawnWithStdin(
      PYTHON_EXEC, [COMPLIANCE_SCRIPT],
      JSON.stringify(complianceInput),
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
    );
    if (stderr) console.warn(`[${TOOL_SLUG_DEMO}] Python stderr: ${stderr.slice(0, 500)}`);
    complianceOutput = JSON.parse(stdout);
    if (complianceOutput.error) throw new Error(`Python compliance error: ${complianceOutput.error}`);
  } catch (pyErr) {
    if (pyErr.code === 'ENOENT') {
      throw new Error(
        `Python executable not found at "${PYTHON_EXEC}". ` +
        'Set PYTHON_EXEC env var to your local Python path.'
      );
    }
    const detail = [
      pyErr.stderr ? `stderr: ${pyErr.stderr.slice(0, 600)}` : null,
      pyErr.stdout ? `stdout: ${pyErr.stdout.slice(0, 300)}` : null,
    ].filter(Boolean).join(' | ');
    throw new Error(`Stage 2 compliance check failed: ${pyErr.message}${detail ? ` — ${detail}` : ''}`);
  }

  const matchResults  = complianceOutput.requirement_matches ?? [];
  const summary       = complianceOutput.compliance_summary  ?? {};
  const blockerCount  = summary.blockers ?? 0;

  emit(`Stage 2 complete — ${summary.strong ?? 0} matched, ${summary.partial ?? 0} partial, ${blockerCount} blocked.`);
  trace.push({
    step:      'compliance_check',
    timestamp: ts(),
    ...summary,
    execution_time_ms: complianceOutput.execution_time_ms,
  });
  await logger.step('compliance_check', 'Deterministic Compliance Check',
    `${summary.strong} strong, ${summary.partial} partial, ${summary.none} none, ${blockerCount} blockers`,
    { ...summary, execution_time_ms: complianceOutput.execution_time_ms });

  // Flag individual blockers in trace
  for (const m of matchResults) {
    if (m.blocker) {
      trace.push({
        step:           'blocker_flagged',
        timestamp:      ts(),
        requirement_id: m.requirement_id,
        blocker_level:  m.blocker_level,
        blocker_reason: m.blocker_reason,
        evidence_ids:   m.evidence_ids,
      });
      await logger.step('blocker_flagged', `Blocker: ${m.requirement_id}`,
        m.blocker_reason ?? 'Compliance blocker identified',
        { requirement_id: m.requirement_id, blocker_level: m.blocker_level });
    }
  }

  // ── Stage 3: Draft generation ───────────────────────────────────────────────
  // Only draft for non-RED-blocker requirements
  const draftableReqs = requirements.filter((req) => {
    const match = matchResults.find((m) => m.requirement_id === req.requirement_id);
    return match && match.match_status !== 'NONE' && !(match.blocker && match.blocker_level === 'RED');
  });

  emit(`Stage 3: Generating draft responses using ${synthesisModel}…`);
  await logger.step('synthesis_model_selection', 'Draft Generation Model', synthesisModel,
    { model: synthesisModel });

  let draftResults = [];
  if (draftableReqs.length > 0) {
    const synthProvider = getProvider(synthesisModel, customProviders);
    const stage3Response = await synthProvider.chat({
      model:      synthesisModel,
      max_tokens: maxTokens,
      system:     buildDraftSystemPrompt(),
      messages:   [{
        role:    'user',
        content: buildDraftUserPrompt(draftableReqs, matchResults),
      }],
    });
    tokensUsed = sumTokens(tokensUsed, stage3Response.usage);

    const stage3TextBlock = stage3Response.content?.find((b) => b.type === 'text');
    if (stage3TextBlock) {
      try {
        const parsed = parseJson(stage3TextBlock.text, 'Stage 3');
        draftResults = parsed.drafts ?? [];
      } catch (e) {
        console.warn(`[${TOOL_SLUG_DEMO}] Stage 3 JSON parse warning: ${e.message}`);
      }
    }
  }

  const draftsGenerated = draftResults.filter((d) => d.draft_response).length;
  emit(`Stage 3 complete — ${draftsGenerated} draft${draftsGenerated !== 1 ? 's' : ''} generated.`);
  trace.push({
    step:             'draft_generation',
    timestamp:        ts(),
    draftable_count:  draftableReqs.length,
    drafts_generated: draftsGenerated,
    model:            synthesisModel,
  });
  await logger.step('draft_generation', 'Draft Response Generation',
    `${draftsGenerated} drafts generated from ${draftableReqs.length} matched requirements`,
    { draftable_count: draftableReqs.length, drafts_generated: draftsGenerated, model: synthesisModel });

  // ── Build result.data.requirements[] ──────────────────────────────────────
  const requirementData = requirements.map((req) => {
    const match = matchResults.find((m) => m.requirement_id === req.requirement_id) ?? {};
    const draft = draftResults.find((d) => d.requirement_id === req.requirement_id) ?? {};

    const isRedBlocker = match.blocker && match.blocker_level === 'RED';

    return {
      // Identity
      finding_id:       req.requirement_id,
      requirement_id:   req.requirement_id,
      label:            req.requirement_text?.slice(0, 80) ?? req.requirement_id,
      category:         req.category,
      requirement_text: req.requirement_text,
      is_mandatory:     req.is_mandatory,
      evaluation_weight: req.evaluation_weight,
      // Match results
      match_status:     match.match_status ?? 'NONE',
      evidence_ids:     match.evidence_ids ?? [],
      match_rationale:  match.match_rationale ?? '',
      blocker:          match.blocker ?? false,
      blocker_level:    match.blocker_level ?? null,
      blocker_reason:   match.blocker_reason ?? null,
      // Draft
      draft_response:       isRedBlocker ? null : (draft.draft_response ?? null),
      original_draft:       isRedBlocker ? null : (draft.draft_response ?? null),
      evidence_citations:   draft.evidence_citations ?? [],
      confidence:           draft.confidence ?? null,
      draft_notes:          draft.notes ?? null,
      // HITL review state
      status:      isRedBlocker ? 'blocked' : 'pending',
      comment:     null,
      edited_text: null,
      reviewed_by: null,
      reviewed_at: null,
    };
  });

  const pendingCount  = requirementData.filter((r) => r.status === 'pending').length;
  const blockedCount  = requirementData.filter((r) => r.status === 'blocked').length;

  const resultData = {
    requirements:         requirementData,
    pending_review_count: pendingCount,
    compliance_summary:   summary,
    extraction_summary: {
      document_title:      extractedRft.document_title    ?? null,
      organisation:        extractedRft.organisation       ?? null,
      tender_reference:    extractedRft.tender_reference   ?? null,
      tender_close_date:   extractedRft.tender_close_date  ?? null,
      requirements_total:  requirements.length,
      mandatory_gate_count: mandatoryCount,
    },
    evidence_pack_sources: Object.fromEntries(
      Object.entries(evidencePack).map(([k, v]) => [k, v.source])
    ),
    trace,
  };

  await logger.complete({
    outcome:  `${requirements.length} requirements · ${summary.strong ?? 0} strong · ${blockerCount} blocker${blockerCount !== 1 ? 's' : ''} · ${draftsGenerated} draft${draftsGenerated !== 1 ? 's' : ''} generated`,
    metadata: {
      rft_file_name:        fileName,
      rft_file_hash:        fileHash,
      image_pages:          pages.length,
      requirements_total:   requirements.length,
      mandatory_gate_count: mandatoryCount,
      match_strong:         summary.strong   ?? 0,
      match_partial:        summary.partial  ?? 0,
      match_none:           summary.none     ?? 0,
      blockers:             blockerCount,
      drafts_generated:     draftsGenerated,
      extraction_model:     extractionModel,
      synthesis_model:      synthesisModel,
      pending_count:        pendingCount,
      blocked_count:        blockedCount,
    },
  });

  return {
    result: { data: resultData },
    tokensUsed,
  };

  } catch (err) {
    await logger.fail(err.message).catch(() => {});
    throw err;
  }
}


module.exports = { runTenderResponse, TOOL_SLUG_DEMO };
