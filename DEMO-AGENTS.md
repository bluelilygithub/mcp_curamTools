# DEMO-AGENTS.md

Reference for building demo agents on the MCP CuramTools platform.
Read this before adding any new demo agent. Companion to **DECISIONS.md** (Demo Layer), **PLATFORM-PRIMITIVES.md**, and **PROJECT_IDENTITY.md** (product norms — prompts, markdown output, reports).

**Changelog:** Record demo work in the **root** [`CHANGELOG.md`](../CHANGELOG.md) (canonical). Optionally mirror or extend detail in `server/agents/demoSuite/<slug>/CHANGELOG.md` if an agent’s history grows large — see `knowledge_base/INDEX.md` → *Changelog and evidence logs*.

### Golden-path smoke (platform spine — **required check**)

**Directive:** After any edit to **`server/services/markdownPdfBuffer.js`**, **`server/routes/export.js`**, **`server/platform/createAgentRoute.js`**, **`server/platform/AgentScheduler.js`**, **`server/platform/promptVersions.js`**, or **`server/agents/demoSuite/tenderResponse/index.js`**, run **`npm test`** from the **repository root** (after `cd server && npm install`) **before** you treat the work as complete. Run the same command **before merging** changes that materially refactor those paths. This is the platform’s smallest guard for shared PDF export and agent routing; it does **not** call Anthropic, S3, PostgreSQL, or a live agent run.

| Command (repo root) | Notes |
|---------------------|--------|
| `npm run smoke:golden-path` | Same as `npm test` |
| `npm test` | Preferred name in docs and identity |

Details: [`scripts/smoke/README.md`](./scripts/smoke/README.md). Same rule in [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md) and [server/CLAUDE.md](./server/CLAUDE.md).

### Prompt versioning (`agent_runs.result.prompt_version`)

HTTP **`createAgentRoute`** agents and cron **`AgentScheduler`** runs may return **`promptVersion`** from `runFn`; the platform persists **`result.prompt_version`** for audits. Registry: **`server/platform/promptVersions.js`**. First opted-in agent: **`demo-tender-response`**. Convention: [knowledge_base/core/PROMPT_VERSIONING.md](./knowledge_base/core/PROMPT_VERSIONING.md).

## What a demo agent is

A demo agent serves an external client org (`org_type = 'demo'`). It uses the same `createAgentRoute` / `AgentOrchestrator` infrastructure as internal agents but:

- Lives under `server/agents/demoSuite/<slug>/` (or single file `demoSuite/<slug>.js`)
- Is registered in `DEMO_CATALOG` (`server/demo/demoCatalog.js`) — code-only, not DB
- Is assigned to a client org via `org_agent_manifest` (DB row, not code)
- Renders in `DemoShell` + `DemoSidebar`, not `AppShell` + `Sidebar`
- Routes at `client/src/pages/demo/<ComponentName>.jsx` → `/demo/run/<full-slug>` (DemoSidebar uses the slug verbatim from `org_agent_manifest`)

Internal agents and demo agents share: auth, org scoping, budget enforcement, usage logging, PDF export, extraction privacy, `agent_runs` table, and `createAgentRoute`.

**Branding:** All demo orgs and synthetic packs use the **Curam** brand (e.g. **Curam Engineering**). Scenario details (industry, project type) may vary; the fictitious company identity stays Curam — see `DECISIONS.md` (Demo org UI — supplemental CSS layer) for visual-only differentiation.

---

## Standard demo UI: prompts, formatted LLM output, and reports

Use this as a **checklist** for every new demo page (and align internal tools where practical) so behaviour stays predictable: **one way to dictate instructions**, **one renderer for model prose**, **one family of export and reopen flows**.

### 1) Prompt and instruction fields (with microphone)

| Expectation | Detail |
|-------------|--------|
| **Layout** | Muted label (`text-xs font-medium`) + full-width **`textarea`**, **`rounded-xl`**, platform `border` / `background` / `color` tokens. Padding-right reserved if a mic sits in the corner. |
| **Voice** | For optional instructions **before** a run, **follow-up** questions, or **HITL edit** bodies, place **`MicButton`** bottom-right inside the field (`position: relative` on wrapper, `absolute` on mic). Wire **`onResult`** to append the final transcript; optional **`onPartial`** for interim text in brackets — mirror **`DocumentAnalyzer.jsx`** (custom instructions) or **`TenderResponseGenerator.jsx`** (edit mode). |
| **Hooks** | Use **`useSpeechInput`** only via **`MicButton`** on pages — do not call browser `SpeechRecognition` directly (`DECISIONS.md`, voice primitives). |

If a control is not a natural fit for dictation (e.g. single-line codes), **omit** the mic rather than inventing a different speech UX.

### 2) Formatted responses from the LLM

| Expectation | Detail |
|-------------|--------|
| **Renderer** | **`MarkdownRenderer`** with **`text=`** prop (never `content=` — see `DECISIONS.md`). All markdown-shaped assistant or agent output goes through this component. |
| **Prompts** | In **`prompt.js`** / system strings, require **GitHub-flavoured markdown** the renderer supports: headings, **bold**, lists, tables (pipe syntax). Keeps PDF export (markdown → HTML) and on-screen display aligned. |
| **Warnings** | When the run includes soft-fail or bounds context, render **`BoundsWarningPanel`** immediately **above** the markdown block (existing tools set the precedent). |
| **Streaming** | Pass the accumulating string into **`MarkdownRenderer`**; do not fork a second code path for “streaming vs final”. |

### 3) Reports, exports, and reopening runs

| Expectation | Detail |
|-------------|--------|
| **PDF (markdown or HTML)** | **`exportPdf`** from **`client/src/utils/exportService.js`**. **Preview:** **`fetchPdfBlob`** then `window.open` on the blob URL (same server render as download). |
| **HTML-only certificates** | Build HTML client-side, then **`exportPdf({ content, contentType: 'html', ... })`** — Document Analyzer / Spec Validator pattern. |
| **Email (demo)** | Org-scoped **`POST /api/demo/runs/:runId/email-certificate`** (client-supplied HTML → PDF) or **`email-tender-draft`** (markdown → shared PDF buffer). Always verify **`runId`** belongs to **`req.user.orgId`** before sending. |
| **Plain text / markdown files** | **`exportText`** or a small client **`Blob`** download for `.md` / `.txt` when a PDF is not the right artefact. |
| **History & audit** | List **recent runs** where useful; deep-link **`/demo/run/<slug>?runId=<uuid>`** so reviewers can return. **`DecisionLogPage`** remains the cross-demo audit trail for persisted **`agent_runs`**. |

**Icon convention:** When several artefact actions exist, group **preview (eye)**, **download**, and **email (mail)** as icon buttons beside the primary labelled action — matches Spec Validator and Tender Response Generator.

---

## Provisioning a new demo client org

Run once in Admin > SQL Console. Never commit client data to version control.

```sql
-- 1. Create org
INSERT INTO organizations (name, org_type)
VALUES ('Client Org Name', 'demo')
RETURNING id;

-- 2. Assign agents (one row per agent)
INSERT INTO org_agent_manifest (org_id, slug, enabled, is_configured, sort_order)
VALUES (<id>, 'demo-document-analyzer', true, true, 0);

-- 3. Verify
SELECT o.name, m.slug, m.enabled, m.is_configured
FROM organizations o
JOIN org_agent_manifest m ON m.org_id = o.id
WHERE o.id = <id>;
```

Then create the demo user via Admin > Users — assign to the same org, role `org_member`.

---

## Reference implementations

### document-analyzer — two-stage (vision extraction → synthesis)

**Slugs:** `demo-document-analyzer` (demo), `document-analyzer` (internal via two-slug pattern)
**Pattern:** Single-file agent, no ReAct loop. Stage 1: vision model extracts text + deterministic rules. Stage 2: synthesis model produces findings.

#### Files

| File | Role |
|---|---|
| `server/agents/demoSuite/documentAnalyzer.js` | Agent runFn — all logic in one file |
| `server/demo/demoCatalog.js` | Catalog entry |
| `server/platform/AgentConfigService.js` | `AGENT_DEFAULTS` + `ADMIN_DEFAULTS` entries |
| `server/routes/agents.js` | `createAgentRoute` registration |
| `server/routes/demo.js` | HITL review endpoints + S3 save |
| `client/src/pages/demo/DocumentAnalyzer.jsx` | Full UI — upload, stream, review, trace, certificate |
| `client/src/App.jsx` | Route: `/demo/run/demo-document-analyzer` |

#### Two-stage pipeline

**Stage 1 (vision model — resolved `adminConfig.model`):** Claude receives the rasterised PDF pages as images. Returns `document_type`, `extracted_text`, and `parties` only — no analysis. Deterministic Node.js rules then run on `extracted_text`.

**Stage 2 (synthesis model — organisation default or resolved extraction model):** Receives `extracted_text` as context string. Returns `findings`, `summary`, `custom_response`. No new extraction — synthesis only.

Both models logged via `logger.step('model_selection')` and `logger.step('synthesis_model_selection')` before each call. Both stored in `logger.complete()` metadata as `extraction_model` / `synthesis_model`.

#### HITL review

Findings stored in `agent_runs.result.data`. Review state updated via `PATCH /api/demo/runs/:runId/review/:findingId` using `jsonb_set`. No separate table.

**Enforcement rules (server-side):**
- Low confidence (`< 0.7`) + `approved` with no comment → 422
- Cross-stage overlap + `approved` with no comment → 422

**Minimum states — `approved` and `rejected` are the floor, not the ceiling:**

`approved` and `rejected` are the two states every demo agent must support. Agents may introduce additional states where the workflow requires them (e.g. `edited` — reviewer accepts a finding but modifies its stated value before approval).

Any new state must:
1. Be documented in DECISIONS.md with its semantics and transition rules
2. Have explicit server-side enforcement (the PATCH endpoint must validate state transitions, not just accept any string)
3. Be recorded in the `review_action` trace entry so the audit log reflects what actually happened
4. Be handled in the certificate gate logic — a finding in an unrecognised or intermediate state must never silently allow certificate generation

The `rejected` → anything transition is permanently blocked for all agents. Rejection means the reviewer found a problem that cannot be resolved by editing — resubmission of a corrected document is the only remediation path.

#### Decision trace steps

| step | When |
|---|---|
| `model_selection` | Before Stage 1 call |
| `synthesis_model_selection` | Before Stage 2 call |
| `input_sanitisation` | After injection scan |
| `deterministic_rules` | After deterministic stage |
| `probabilistic_analysis` | After Claude call |
| `review_action` | Each PATCH review |

---

### spec-validator — three-stage (vision → Python → synthesis)

**Slugs:** `demo-spec-validator` (demo), `spec-validator` (internal via two-slug pattern)
**Pattern:** Single `runFn` exported with both slug constants. Three discrete stages; Python subprocess for deterministic calculations.

#### Files

| File | Role |
|---|---|
| `server/agents/specValidator/index.js` | runFn — exports `runSpecValidator`, `TOOL_SLUG_INTERNAL`, `TOOL_SLUG_DEMO` |
| `server/agents/specValidator/calculator.py` | Deterministic hydraulic calculation engine |
| `server/agents/specValidator/prompt.js` | System prompt for Stage 1 extraction + Stage 3 synthesis |
| `server/demo/demoCatalog.js` | Catalog entry |
| `server/platform/AgentConfigService.js` | Entries for both slugs |
| `server/routes/agents.js` | Two `createAgentRoute` registrations (one per slug, same `runFn`) |
| `server/routes/demo.js` | HITL review endpoints |
| `client/src/pages/demo/SpecValidator.jsx` | Full UI |
| `client/src/App.jsx` | Route: `/demo/run/demo-spec-validator` |

#### Three-stage pipeline

**Stage 1 (vision model — resolved `adminConfig.model`):** Claude vision extracts all quantitative claims into structured JSON — pipe segments, pressure system, stated values. No calculations, no analysis.

**Stage 2 (Python subprocess — `execFileAsync`):** Deterministic calculations using `fluids` + `numpy`. Returns full step-by-step working with `check_status` (`PASS` / `FAIL` / `WARNING`) and `library_versions` per check. Zero AI involvement — deterministic and auditable. 30-second timeout, 10 MB buffer.

```js
const PYTHON_EXEC = process.env.PYTHON_EXEC || 'python3';
const CALC_SCRIPT = path.join(__dirname, 'calculator.py');
const { stdout } = await execFileAsync(PYTHON_EXEC, [CALC_SCRIPT], {
  input: JSON.stringify(calcInput),
  timeout: 30_000,
  maxBuffer: 10 * 1024 * 1024,
});
const calcResult = JSON.parse(stdout);
```

**Stage 3 (synthesis model — organisation default or resolved extraction model):** Receives Python output. Produces plain-language findings and probabilistic flags. Must not introduce new numeric values — synthesis only.

#### Dual-status pattern

Each finding has two independent status fields:
- `check_status` — set by Python (`PASS` / `FAIL` / `WARNING`), immutable after creation
- `status` — HITL review state (`pending` / `approved` / `rejected` / `resubmit`), mutated by PATCH

PASS findings are auto-approved at creation. Rejected findings permanently block the certificate — the rejected → approved transition is blocked server-side; no admin override path exists.

#### Two-slug registration

```js
// server/agents/specValidator/index.js
const TOOL_SLUG_INTERNAL = 'spec-validator';
const TOOL_SLUG_DEMO     = 'demo-spec-validator';
module.exports = { runSpecValidator, TOOL_SLUG_INTERNAL, TOOL_SLUG_DEMO };

// server/routes/agents.js — two registrations, one runFn
agentsRouter.use('/spec-validator',      createAgentRoute({ slug: TOOL_SLUG_INTERNAL, runFn: runSpecValidator, requiredPermission: 'org_member' }));
agentsRouter.use('/demo-spec-validator', createAgentRoute({ slug: TOOL_SLUG_DEMO,     runFn: runSpecValidator, requiredPermission: 'org_member' }));
```

Each slug gets independent admin config (model, max_tokens, prompt override) via the admin UI, but all business logic is shared.

#### Dockerfile Python layer

```dockerfile
# Python 3 + venv (avoids PEP 668 "externally managed environment" error on Alpine)
RUN apk add --no-cache python3 py3-pip && \
    python3 -m venv /opt/pyenv && \
    /opt/pyenv/bin/pip install --no-cache-dir fluids numpy
ENV PYTHON_EXEC=/opt/pyenv/bin/python3
```

Use a separate `RUN` layer — mirrors the existing ghostscript/chromium layer separation to avoid OOM.

#### ProcessingModal integration (spec-validator)

```jsx
const INITIAL_STAGES = [
  { id: 'extract',    label: 'Extracting',    description: 'Vision model reads PDF and extracts quantitative claims.', status: 'pending' },
  { id: 'calculate',  label: 'Calculating',   description: 'Python runs deterministic hydraulic checks.', status: 'pending' },
  { id: 'synthesise', label: 'Synthesising',  description: 'Analysis model interprets results and writes findings.', status: 'pending' },
];

// Advance stages from SSE onProgress callback:
const advance = (text) => {
  if (text.includes('stage 1: running'))    setStages(s => s.map((x, i) => i === 0 ? { ...x, status: 'active' }    : x));
  if (text.includes('stage 1 complete'))    setStages(s => s.map((x, i) => i === 0 ? { ...x, status: 'complete' }  : i === 1 ? { ...x, status: 'active' } : x));
  if (text.includes('stage 2 complete'))    setStages(s => s.map((x, i) => i === 1 ? { ...x, status: 'complete' }  : i === 2 ? { ...x, status: 'active' } : x));
};
```

---

## Mandatory patterns for all new demo agents

Every new demo agent must implement all of the following. These are not optional.

---

### 1. Two-model pattern (extraction + synthesis)

```js
const adminConfig = await AgentConfigService.getResolvedAdminConfig(slug, orgId);
const extractionModel = adminConfig.model;
if (!extractionModel) throw new Error('No model configured for this agent. Set one in Admin > Agents.');

const synthesisModel = (await AgentConfigService.getOrgDefaultModel(orgId)) ?? extractionModel;

// Before extraction call:
emit(`Stage 1: Extracting using ${extractionModel}…`);
await logger.step('model_selection', 'Extraction Model', extractionModel, { model: extractionModel });

// ... extraction call ...

// Before synthesis call:
emit(`Stage ${n}: Synthesising using ${synthesisModel}${synthesisModel !== extractionModel ? ' (org default)' : ''}…`);
await logger.step('synthesis_model_selection', 'Synthesis Model', synthesisModel, { model: synthesisModel });

// ... synthesis call ...

// In logger.complete():
await logger.complete({ extraction_model: extractionModel, synthesis_model: synthesisModel, ...otherMeta });
```

**Rules:**
- Never hardcode a model ID fallback (e.g. `?? 'claude-sonnet-4-6'`). Always resolve through `getResolvedAdminConfig(slug, orgId)` or consume the resolved `adminConfig` passed by `createAgentRoute`.
- A blank per-agent model is valid and means "Use organisation default"; do not treat the first model in a dropdown as persisted config.
- Extraction model must support vision if the agent processes PDFs or images.
- Synthesis model resolves to org default first — typically cheaper and doesn't need vision.
- Both models must appear in the decision log trace (`model_selection` / `synthesis_model_selection` step types).

---

### 2. ProcessingModal — required for multi-stage agents

Any agent with more than one discrete stage or expected runtime > ~10 seconds must use `ProcessingModal`. It prevents navigation during long SSE runs and manages user expectations.

```jsx
import ProcessingModal from '../../components/shared/ProcessingModal';

const INITIAL_STAGES = [
  { id: 'stage1', label: 'Stage Label',  description: 'What this stage does.', status: 'pending' },
  { id: 'stage2', label: 'Stage Label',  description: 'What this stage does.', status: 'pending' },
];

const [stages, setStages]     = useState(INITIAL_STAGES);
const [running, setRunning]   = useState(false);
const cancelledRef             = useRef(false);

// Advance from onProgress callback — match server-emitted strings:
const handleProgress = (text) => {
  if (text.includes('stage 1:'))       setStages(s => activate(s, 0));
  if (text.includes('stage 1 complete')) setStages(s => complete(s, 0));
  // etc.
};

// Use cancelledRef to prevent orphaned onResult after cancel:
const handleCancel = () => {
  cancelledRef.current = true;
  setRunning(false);
  setStages(INITIAL_STAGES);
};

// In SSE onResult:
if (!cancelledRef.current) {
  setResult(data);
  setRunning(false);
}

<ProcessingModal
  stages={stages}
  estimatedDuration="Typical processing time: 2–4 minutes."
  onCancel={handleCancel}
  cancelConfirmMessage="Cancel this run? The document will need to be resubmitted."
  isOpen={running}
/>
```

Stage `status` values: `'pending'` | `'active'` | `'complete'`. Parent advances them — the modal has no knowledge of SSE or AbortControllers.

---

### 3. SSE progress string conventions

The server emits plain-text progress strings that the client matches to advance ProcessingModal stages. Use consistent, lowercase, stage-numbered strings:

| Server emits | Client matches | Action |
|---|---|---|
| `Stage 1: running …` | `text.includes('stage 1:')` | Activate stage 1 |
| `Stage 1 complete` | `text.includes('stage 1 complete')` | Complete stage 1, activate stage 2 |
| `Stage 2: running …` | `text.includes('stage 2:')` | Activate stage 2 (if not already) |
| `Stage 2 complete` | `text.includes('stage 2 complete')` | Complete stage 2, activate stage 3 |

**Server side** — emit before and after each stage:
```js
emit('Stage 1: running vision extraction…');
// ... stage 1 work ...
emit('Stage 1 complete — extracted N segments.');

emit(`Stage 2: synthesising using ${synthesisModel}…`);
// ... stage 2 work ...
emit('Stage 2 complete.');
```

---

### 4. Decision trace — stepMeta registration

The Decision Log page (`DecisionLogPage.jsx`) needs a `stepMeta` entry for every `logger.step()` type your agent emits. Without it, the step renders with no icon or label.

Add entries to the `stepMeta` object in `client/src/pages/demo/DecisionLogPage.jsx`:

```js
const stepMeta = {
  // existing entries ...
  your_step_type:          { icon: CheckCircle, label: 'Your Step Label', highlight: false },
  model_selection:         { icon: Cpu,         label: 'Extraction Model', highlight: true },
  synthesis_model_selection: { icon: Cpu,       label: 'Synthesis Model',  highlight: true },
};
```

`highlight: true` renders the entry with an amber badge — use for model selection, file storage, and certificate events. Use `false` for routine pipeline steps.

---

### 5. File upload — base64 JSON body

Client uses `FileReader.readAsDataURL`, strips the `data:...;base64,` prefix, sends:
```json
{ "fileData": "<base64>", "mimeType": "application/pdf", "fileName": "contract.pdf" }
```
No multer. Works within `createAgentRoute`'s body parser limit. Enforce client-side max (9–10 MB).

---

### 6. PDF rasterisation — Ghostscript only

Always use `execFileAsync('gs', [...])` directly. Never use `pdf2pic` (unreliable in Docker/Alpine).

```js
const outPattern = path.join(tmpDir, 'page_%04d.png');
await execFileAsync('gs', [
  '-dBATCH', '-dNOPAUSE', '-sDEVICE=png16m',
  `-r${dpi}`, `-sOutputFile=${outPattern}`, pdfPath,
]);
```

Cap to `MAX_PDF_PAGES = 8`. Check PNG dimensions before sending to Anthropic — max 7900px on any dimension. Re-render at scaled DPI if exceeded.

---

### 7. Extraction privacy — mandatory post-AI

```js
const { excluded_field_names: excludedFields = [] } =
  await AgentConfigService.getExtractionPrivacySettings(orgId);

// After extraction, before any DB write:
if (excludedFields.length > 0) {
  const excludedSet = new Set(excludedFields);
  result.fields = result.fields.filter(f => !excludedSet.has(f.name));
}
```

Never save first and strip later. Excluded values must never reach the database.

---

### 8. Compliance certificate

Built client-side as HTML string (`buildCertificateHtml`), exported via `exportPdf` (platform service). Gated on all findings reviewed and none rejected.

```js
import { exportPdf } from '../../utils/exportService';
await exportPdf({ content: html, contentType: 'html', title: 'Compliance Certificate', filename: 'cert.pdf' });
```

Certificate is ephemeral — regenerated on each export, never stored server-side.

---

### 9. S3 — two roles

#### 9a. Post-run save (existing pattern)

After run completes, user can save the uploaded file to S3 for permanent storage.

**Server:** `POST /api/demo/runs/:runId/save-to-s3` in `server/routes/demo.js`. Reads `file_data` + `file_name` from `agent_runs.result`, uploads via `StorageService.put` under `{orgName}/{fileName}`, returns 7-day pre-signed URL.

**Client:** `api.post('/demo/runs/${runId}/save-to-s3')`. Idempotent — shows "Saved ✓" on repeat clicks.

**Requirements:** `AWS_S3_BUCKET` env var must be set.

#### 9b. Pre-run evidence source (new pattern — introduced by tender-response)

Some demo agents work from a standing evidence repository provisioned into S3 at setup time rather than requiring a one-off upload each run. This pattern makes the demo self-contained: the audience sees real artefacts without having to supply a file.

**How it works at run time:**

The agent's run endpoint loads the evidence pack from a known org-scoped S3 path before calling any model. The path convention is `{orgName}/evidence/{pack-name}/` — a flat prefix that holds all files in the pack. The server fetches a listing via `StorageService.list(prefix)` and downloads only the files it needs for the current run.

```js
// Server — load evidence pack at run start
const prefix = `${orgName}/evidence/${packName}/`;
const { files } = await StorageService.list(prefix);
const fileBuffers = await Promise.all(
  files.map(f => StorageService.get(f.storageKey))
);
// pass buffers into the agent pipeline
```

**File browser UI pattern:**

Before the run starts, the client fetches a **demo-scoped listing endpoint** (see the agent’s section below for the exact path) which returns file metadata plus, when S3 and credentials are configured, **short-lived pre-signed GET URLs** so each row can open in a new tab. A richer UI can render a tree (folder structure from key suffixes), icons, and sizes; the minimal pattern is a flat list with **Open** links.

The file tree is read-only by default. It communicates to the audience that this is the standing evidence the agent will use — not a blank-slate upload prompt.

**Implemented today — `demo-tender-response`:**

| Piece | Location / behaviour |
|---|---|
| List + presign | `GET /api/demo/tender-evidence` in `server/routes/demo.js` — lists `curam engineering/evidence-pack/` and attaches presigned URLs (default 1 hour). |
| UI | `client/src/pages/demo/TenderResponseGenerator.jsx` — pre-run pack list with links. |
| HITL draft UX | Same page: drafts rendered with **`MarkdownRenderer`**; **Edit** uses **`MicButton`** + textarea (Web Speech API) per `MicButton.jsx` / `useSpeechInput.js`. |
| Run id for PATCH | `server/platform/createAgentRoute.js` — success SSE payload is `{ type: 'result', data: { ...resultPayload, runId } }` so the client never PATCHes `.../runs/null/...`. |
| Export | **`exportPdf`** / **`fetchPdfBlob`** in `client/src/utils/exportService.js` (POST `/api/export/pdf`, Puppeteer) — same shell as Document Analyzer / Spec Validator certificates. **Email:** `POST /api/demo/runs/:runId/email-tender-draft` (markdown body → same PDF buffer as export, then `EmailService`). Markdown file download remains client-side only. No `.docx` generator in-repo. |

**Audience upload — substituting a file for testing:**

A user can substitute any file in the evidence pack with their own version for a single session. This lets a demo audience swap in their own document to see the agent process it live.

Substitution is session-scoped. Two implementation options:

| Option | When to use |
|---|---|
| **Memory-only** — hold the substituted buffer in server session state, never write to S3 | Preferred for short demos; no S3 write cost; lost on server restart |
| **Temp S3 write** — upload to `{orgName}/evidence-temp/{sessionId}/{fileName}`, set 1-hour expiry | Use when the run takes long enough that a server restart is plausible, or when the substituted file must survive a Railway redeploy mid-demo |

The substituted file is flagged in the UI with a distinct visual treatment (amber border, "Your file" badge) so the audience can see at a glance which file came from them vs the standing pack.

**Distinction between pack files and substituted files:**

| | Evidence pack | Substituted file |
|---|---|---|
| Source | S3, org-scoped, provisioned at setup | Uploaded by the user in this session |
| Scope | Permanent until re-provisioned | Session-scoped — lost on next run or page reload |
| UI signal | Normal file row | Amber "Your file" badge |
| Agent treatment | Loaded from S3 buffer | Loaded from memory or temp S3 key |
| Audit trace | `evidence_pack: { packName, files[] }` in `logger.step` | `substituted_file: { fileName, source: 'user-upload' }` in `logger.step` |

**Provisioning the evidence pack:**

Run once in Admin > SQL Console or via a setup script. Upload files to the agreed S3 path using `StorageService.put` or directly via the AWS console. Document the expected pack structure in the agent's section of this file — future agents may share the same pack or define their own.

---

## Adding a new demo agent — checklist

1. **`server/agents/demoSuite/<slug>.js`** (or `demoSuite/<slug>/index.js`) — write `runFn`, export `{ runFn, TOOL_SLUG_DEMO, TOOL_SLUG_INTERNAL }` if dual-slug, or `{ runFn, TOOL_SLUG }` if demo-only
2. **`server/demo/demoCatalog.js`** — add catalog entry: `name`, `description`, `icon`, `category`, `pattern`
3. **`server/platform/AgentConfigService.js`** — add to `AGENT_DEFAULTS` and `ADMIN_DEFAULTS` (for both slugs if dual-slug)
4. **`server/routes/agents.js`** — register with `createAgentRoute` (one call per slug). This is also the default Lessons Repository write-back path; if the demo uses a custom route or direct provider call outside `createAgentRoute`, add an explicit `proposeLessonFromRun` hook after the successful result is saved/returned. Update `LESSON_COVERAGE_SECTIONS` in `client/src/pages/admin/AdminLessonsPage.jsx` so Admin > Lessons & Rules lists the new demo/routine in "View covered agents/routines".
5. **`client/src/pages/demo/<Page>.jsx`** — build UI with `ProcessingModal`, two-model display, HITL review, certificate gate
6. **`client/src/App.jsx`** — add `<Route path="/demo/run/<full-slug>" element={<Page />} />` (must match slug in `org_agent_manifest` exactly)
7. **`client/src/pages/demo/DecisionLogPage.jsx`** — add `stepMeta` entries for every `logger.step()` type the agent emits
8. **SQL Console** — `INSERT INTO org_agent_manifest` for target org
9. **DECISIONS.md** — add entry documenting non-obvious choices
10. **CHANGELOG.md** — session entry

---

## Pattern constraints

- `org_id` always from `req.user.orgId` — never from a request param
- Extraction privacy applied post-AI, pre-return — `AgentConfigService.getExtractionPrivacySettings(orgId)`
- Always pass `customProviders` to `getProvider` — never `getProvider(model)` alone
- Use `?? fallback` at call site for any nullable admin config value — not JS default params
- PDF export: `exportService.js` only — never `window.print()`
- `https.request` for outbound HTTP on Railway — never `fetch()`
- Python subprocess: always `execFileAsync` with `shell: false` — never `exec` or `spawn` with `shell: true`
- Two-model pattern mandatory — hardcoded model IDs as fallbacks are forbidden
- ProcessingModal required for any agent with more than one stage or runtime > ~10s
- Rejected findings permanently block the certificate — no admin override path
