# CHANGELOG.md

**Project Context:** Internal learning project for one organisation, solo developer. See [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md).

> **Primary reader:** AI + human. Read the last 2–3 entries at session start to understand current state.
> **Update trigger:** Every session. Add an entry before closing.
> **Format:** Date · What was built · What broke/was fixed · What's next.

### Which changelog to use

| Log | Path | Scope |
|-----|------|--------|
| **Platform / container (canonical)** | This file — `CHANGELOG.md` at repo root | Express app, shared client, platform primitives, cross-cutting work, and any session that touches multiple areas. Prefer this as the default. |
| **Knowledge base mirror (optional)** | `knowledge_base/core/CHANGELOG.md` | May lag root; use when documenting work primarily through the `knowledge_base/` tree, or sync entries from root when convenient. |
| **Per-agent or per-suite (optional)** | e.g. `server/agents/<slug>/CHANGELOG.md` or suite folder | Large or long-lived agents may keep their own evidence log; each entry should link or one-line summarise related root entries so readers can follow cross-cutting changes. |

If a session changes both platform and one agent, **one root entry** is enough unless the agent log needs extended detail.

---

## 2026-05-22 — Shared Model Resolution + Admin Agents Clarity

### Built
- **Shared model resolver:** Added `AgentConfigService.getResolvedAdminConfig(slug, orgId)` so runtime agents resolve model settings consistently: per-agent override first, organisation default second, then no hidden hardcoded fallback.
- **Fallback resolver:** The same shared path resolves fallback models consistently: per-agent fallback first, organisation fallback second.
- **Agent runtime coverage:** Updated standard agent entry points, `createAgentRoute`, `AgentScheduler`, conversation, demo follow-up/resubmit, and Doc Extractor to use resolved model config rather than raw `adminConfig.model` where appropriate.
- **Admin Agents UI clarity:** `Admin > Agents` now shows an explicit `Use organisation default` option so a blank saved value cannot look like a concrete model override.
- **Doc Extractor Auto:** The Doc Extractor model selector keeps `Auto` as an empty override and lets the server resolve the current model at run time.

### Fixed / discovered
- Several agents could display a model in the UI while the saved agent model was actually `null`; the browser selected the first option visually, but the runtime still received no model.
- Some custom/direct agent paths read raw `getAdminConfig()` and passed `adminConfig.model` directly to `AgentOrchestrator`, bypassing the organisation default.
- SQL Console NLP documentation still described a hardcoded Sonnet fallback; this is no longer the intended pattern.

### Open / next
- Continue removing or documenting remaining literal model IDs that are catalog defaults, pricing tables, provider-prefix examples, or diagnostics so future agents do not copy them as runtime fallbacks.
- Any new model-backed agent must use `getResolvedAdminConfig()` or receive resolved `adminConfig` from `createAgentRoute` / `AgentScheduler`.

---

## 2026-05-22 — Backwards-Compatible Permission Layer

### Built
- **Capability middleware:** Added `requirePermission(permission)` as a compatibility layer over existing roles.
- **Role-to-capability mapping:** Added `ROLE_PERMISSIONS`, `getEffectivePermissions()`, and `hasPermission()` to `PermissionService`. `org_admin` maps to `*`; legacy role names are still exposed as capabilities during migration.
- **Route adoption:** Moved shared agent run protection, the main admin router, Lessons management, MCP admin, admin knowledge, and Google Ads customer/assignment management to capability checks while preserving existing `org_admin`, `org_member`, and `ads_operator` behaviour.
- **Agent access controls:** Added `Admin > Agents > Agent Access` for standard route-factory agents. Admins can leave the coded default in place or select roles that may run that agent; `org_admin` remains always allowed.
- **Usable role assignment:** Added explicit system-role assignment to `Admin > Users`, kept custom roles separate, and added user/agent access previews so admins can verify who can run what.
- **Organisation-scoped agent access:** Agent admin config now resolves per organisation with fallback to the platform/default org, allowing demo organisations to diverge without hardcoding.
- **Permissions guide:** Added `PERMISSIONS.md` with the current model, migration rules, route/agent usage examples, naming guidance, and testing checklist.

### Fixed / discovered
- Existing role checks were already a workable foundation; no schema change was needed for the first retrofit step.
- MCP resource-level permissions already existed and remain separate from route-level capabilities.

### Open / next
- Add UI and persistence for custom capability grants only if/when the current role mapping becomes too coarse.
- Continue migrating new admin areas to `requirePermission()` rather than adding more raw `requireRole()` checks.

---

## 2026-05-22 — Lesson AI Revision Cycle + Lesson Model Setting

### Built
- **Lesson AI model setting:** Added `getOrgLessonModel` / `updateOrgLessonModel` to `AgentConfigService`, stored in `system_settings` under key `lesson_model`. Follows the same pattern as `default_model` and `fallback_model` with org admin fallback.
- **Settings API:** Added `GET/PUT /api/settings/lesson-model` endpoints in `settings.js` for reading and updating the lesson AI model selection.
- **Settings UI:** Added "Lesson AI model" selector (fourth column) to the Default & Fallback Models grid in `ModelsTab.jsx`, with inactive-model warning and "lesson" badge on model list entries.
- **AI revision endpoint:** Added `POST /api/lessons/:id/revise` — takes a human prompt, calls the configured lesson AI model with current content + prompt, returns revised content for preview. Does not auto-persist.
- **Chat revision UI:** Replaced the simple comment form in `AdminLessonsPage.jsx` with a two-mode `LessonRevisionChat` component supporting iterative AI-powered revisions with side-by-side preview and apply/discard controls.
- **Documentation:** Updated `PLATFORM-PRIMITIVES.md` with new AgentConfigService methods; updated `lessons-repository.txt` with the revised HITL flow.

### Fixed / discovered
- The `proposeLessonFromRun` callers in `createAgentRoute` and `AgentScheduler` discard the return value (fire-and-forget). Per-run lesson evaluation visibility remains a known gap — the outcome is not persisted on `agent_runs.result`.

### Open / next
- Add per-run lesson evaluation marker (`lesson_evaluated`, `lesson_outcome`) to `agent_runs.result` so run history shows whether lesson evaluation occurred.
- Consider adding the `returnDetails: true` pattern to `createAgentRoute` and `AgentScheduler` for better diagnostics.

---


## 2026-05-21 — Lessons & Rules Repository

### Built
- **Platform lessons store:** Added `agent_lessons` schema with org/global scope, agent/global scope, active/disabled/under-review status, applied dates, JSONB audit history, soft delete, and search/runtime indexes.
- **Service + API:** Added `LessonRepositoryService` and `/api/lessons` routes for admin CRUD, metadata, runtime prompt loading, and under-review agent proposals.
- **Runtime integration:** `AgentOrchestrator` now appends active matching lessons to the system prompt once per run via `loadLessonsForAgent(toolSlug, orgId)`.
- **Admin UI:** Added Admin › Lessons Repository with filters, sortable table, create/edit modal, status toggles, soft-delete confirmation, read-only detail, and audit history with content diff view.
- **Reflection write-back:** Completed SSE and scheduled agent runs now create under-review `agent-reflection` drafts for admin review; they are never injected into future runs until activated.
- **Custom routine coverage:** Added review-only lesson proposals for custom execution paths that bypass `createAgentRoute`: Google Ads conversation turns, Doc Extractor, Media Gen, and SQL Console NLP.
- **Docs:** Updated platform and new-agent documentation to state that every new model-backed agent or AI routine must be covered by Lessons Repository write-back.
- **Coverage register:** Admin > Lessons & Rules now links to a covered agents/routines list; docs require `LESSON_COVERAGE_SECTIONS` to be updated whenever a new model-backed routine is added.
- **Lesson quality guard:** `proposeLessonFromRun` now rejects plain operational telemetry unless an explicit reusable lesson/pattern is present; clean Doc Extractor successes remain in run logs only.
- **Lesson review comments:** Admins can now add sanitised, append-only review comments to a lesson without editing the agent-proposed observation; the UI reuses the app's microphone input pattern.
- **Doc Extractor runtime lessons:** Active `doc-extractor` lessons are now loaded into the extraction prompt before each run, so approved extraction-quality guidance can be followed on subsequent runs.
- **Lesson review UI:** Removed existing lesson edit controls from the Lessons page so review comments do not require modifying the agent-generated observation.
- **Doc Extractor lesson diagnostics:** Lesson proposals are now awaited and returned per file as `lessonProposal`, making created vs skipped proposals visible instead of relying on background logs.
- **Lesson de-duplication:** Repeated lesson candidates with the same agent/org/category/title now report `duplicate` instead of creating multiple under-review rows.
- **Doc Extractor lesson visibility:** The Doc Extractor result panel now shows lesson proposal outcome (`created`, `duplicate`, `skipped`, or `error`) with the saved/duplicate lesson ID or skip reason.
- **Doc Extractor lesson history:** Extraction history now includes a Lesson status column so proposal outcomes are visible without opening a run.

### Fixed / discovered
- Client build initially failed because `react-is` was declared in `client/package.json` but absent from `client/package-lock.json` / `node_modules`; `npm install` restored it and the Vite build now passes.
- Initial repository implementation exposed `proposeLesson()` but did not call it from normal agent completion paths, so running agents did not populate the Lessons view.
- Doc Extractor and other custom routes bypassed the platform route factory, so they needed explicit write-back hooks.
- First Doc Extractor proposals looked like run logs (`file extracted N fields`) rather than future-facing lessons; write-back is now selective so Lessons remains a pattern/learning trail.
- Lesson review previously forced admins toward editing the lesson content when they only wanted to add context; comments now live as audit entries.
- Doc Extractor had write-back coverage but was not yet loading active lessons at runtime; approved lessons now feed back into extraction.
- Skipped lesson proposals were only visible in the immediate response; Doc Extractor now persists `result.lesson_proposal` into the run record for auditability.

### Open / next
- Non-`AgentOrchestrator` agents can call `loadLessonsForAgent()` directly when they need lesson injection in custom multi-stage flows.

---

## 2026-05-14 — Prompt versioning on `AgentScheduler`; `createAgentRoute` header fix

### Built
- **`server/platform/AgentScheduler.js`:** Cron **single-run** and **multi-customer** persist paths merge optional **`promptVersion`** into **`result.prompt_version`** (same truncation rule as HTTP), using **`mergePromptVersionIntoResult`** from **`promptVersions.js`**.
- **`server/platform/promptVersions.js`:** **`normalizePromptVersion`**, **`mergePromptVersionIntoResult`** (shared by HTTP and cron).

### Fixed / discovered
- **`server/platform/createAgentRoute.js`:** File-level `/**` block comment was missing a closing **`*/`**, which commented out all top-level **`require`** calls — **`express` was undefined** the first time **`createAgentRoute()`** ran.

### Open / next
- **B (Zod / schema):** opt-in validation at tool/API boundaries — not started.

---

## 2026-05-17 — Prompt versioning (C): optional `prompt_version` on HTTP runs

### Built
- **`server/platform/promptVersions.js`:** Central **`BY_SLUG`** labels; **`getPromptVersion(slug)`**. First entry: **`demo-tender-response@1`**.
- **`createAgentRoute`:** If `runFn` returns **`promptVersion`** (string), merged into persisted **`result.prompt_version`** (max 160 chars). JSDoc updated. **No change** for agents that omit the field.
- **`demo-tender-response`:** Returns **`promptVersion`** from registry so completed runs record lineage.
- **`knowledge_base/core/PROMPT_VERSIONING.md`:** Convention, opt-in steps, HTTP + `AgentScheduler` persistence, link to golden-path smoke after registry edits.
- **Docs / nav:** `PROMPTS.md`, `knowledge_base/INDEX.md`, `PLATFORM-PRIMITIVES.md` (root + `knowledge_base/architecture/`), `DEMO-AGENTS.md`, `persistRun.js` JSDoc, **Quality gate** lists now include **`promptVersions.js`**; **`scripts/smoke/golden-path.mjs`** loads **`promptVersions`** in phase 1.

### Fixed / discovered
- (none)

### Open / next
- **B (Zod / schema):** opt-in validation at tool/API boundaries — not started.

---

## 2026-05-15 — Golden-path smoke test (platform spine, no live agents)

### Built
- **`scripts/smoke/golden-path.mjs`:** Phase 1 loads **`markdownPdfBuffer`**, **`server/routes/export`**, **`createAgentRoute`**; verifies **`tenderResponse/index.js`** exists and passes **`node --check`** (does not `require` the tender agent — avoids DB side effects). Phase 2 runs a minimal **markdown → PDF** when system Chromium is found; otherwise **skips with exit 0**.
- **`scripts/smoke/README.md`:** What the smoke covers, prerequisites, and future optional HTTP tier.
- **Root `package.json`:** `npm test` and **`npm run smoke:golden-path`** invoke the script from repo root.
- **Docs:** `DEMO-AGENTS.md`, `knowledge_base/core/SETUP.md`, `knowledge_base/INDEX.md` — how to run and scope.
- **Policy alignment (same day):** Golden-path smoke stated as **required discipline** (when touching the listed spine files / before merge) in **`PROJECT_IDENTITY.md`**, **`knowledge_base/core/PROJECT_IDENTITY.md`**, **`server/CLAUDE.md`**, **`DEMO-AGENTS.md`**, **`knowledge_base/agents/AGENTS_INDEX.md`**, and **`scripts/smoke/README.md`** so the same rule appears in identity, server guardrails, demo checklist, agents index, and smoke README.

### Fixed / discovered
- (none)

### Open / next
- Optional second-tier smoke (authenticated `POST /agents/demo-tender-response/run`) when CI secrets and a tiny fixture PDF are available.

---

## Template

```
## YYYY-MM-DD — [one-line session summary]

### Built
- …

### Fixed / discovered
- …

### Open / next
- …
```

---

## 2026-05-14 — Tender draft pack: PDF preview + email (Spec Validator parity)

### Built
- **`server/services/markdownPdfBuffer.js`:** Shared **markdown/HTML → PDF buffer** (Puppeteer + same shell CSS as former inline `export.js`) for **`POST /api/export/pdf`** and demo email routes.
- **`server/routes/export.js`:** Delegates PDF generation to **`markdownPdfBuffer`** (no behaviour change intended).
- **`POST /api/demo/runs/:runId/email-tender-draft`** in **`server/routes/demo.js`:** Org-scoped run check; body `{ to, markdown, title?, filename? }`; renders PDF via shared service; sends via **`EmailService`** (same idea as **`email-certificate`**).
- **`client/src/utils/exportService.js`:** **`fetchPdfBlob`** (authenticated fetch to `/api/export/pdf`); **`exportPdf`** calls it to avoid duplicated fetch logic.
- **`TenderResponseGenerator.jsx`:** **Eye** (open PDF in new tab) and **mail** (inline recipient + Send) next to Download/Markdown; **`useAuthStore`** default recipient; copy updates in **`DEMO-AGENTS.md`**.
- **Documentation:** **`PROJECT_IDENTITY.md`** — *Product norms* (standard prompt fields + **`MicButton`**, **`MarkdownRenderer`** for LLM prose, **`exportService`** / demo email / history & report access). **`DEMO-AGENTS.md`** — *Standard demo UI* checklist (tables for prompts, output, reports). **`knowledge_base/INDEX.md`** — quick navigation row.

### Fixed / discovered
- (none)

### Open / next
- (none)

---

## 2026-05-16 — Tender demo: HITL save fix, evidence links, voice + markdown drafts

### Built
- **`createAgentRoute.js`:** Final SSE `result` message now includes **`runId`** on the streamed `data` object (alongside `summary`, `data`, `tokensUsed`, etc.). Persisted `agent_runs.result` is unchanged — `runId` is for clients that must call `PATCH /api/demo/runs/:runId/...` before a full reload.
- **`GET /api/demo/tender-evidence`:** Each listed object includes a short-lived **presigned download URL** so the pre-run evidence browser can open files in a new tab.
- **`TenderResponseGenerator.jsx`:** Evidence filenames link to presigned URLs; draft and original-draft body use **`MarkdownRenderer`**; edit mode adds **`MicButton`** (Web Speech API, same append pattern as Admin SQL / Google Ads conversation) when supported; `encodeURIComponent` on requirement id in review PATCH path; guard when `runId` is missing.
- **Tender results UX:** **What happens next** explainer (no auto Word/PDF); **HITL counts** + progress bar (reviewed vs actionable, excludes blocked); **filter chips** (All / Pending / Edited / Approved / Rejected / Blocked); **Download draft pack (.md)** client-side export of all requirement sections; header copy clarifies per-requirement scope.
- **Tender export:** **Download PDF** uses **`exportPdf`** (`client/src/utils/exportService.js` → `/api/export/pdf`, same as compliance certificates); **Markdown** remains for raw text workflows.
- **`server/agents/demoSuite/tenderResponse/prompt.js`:** **DRAFT TEXT FORMAT** rules aligned with `MarkdownRenderer` (paragraphs, `##` headings, `**bold**`, lists, no HTML / bare URLs; citations remain `[REF-xxx]` style).

### Fixed / discovered
- **Tender HITL “Save edit” → “Failed to update review”:** The streamed result payload omitted `runId`; the page left `runId` null, so the client called `PATCH .../runs/null/tender-review/...`, PostgreSQL rejected the UUID, and the route returned 500. Fixed by emitting `runId` on the SSE payload.
- **`PATCH .../tender-review/:requirementId`:** Match `requirement_id` / `finding_id` using trimmed strings so minor whitespace mismatches do not skip the row.
- **Tender HITL after “Save edit”:** `edited` was treated like a terminal review state, so Approve / Edit / Reject disappeared. Actions now stay available for **`edited`** (revise again, **Approve** to finalise, or **Reject**); only **`approved`** / **`rejected`** hide the bar. **Approve** after an edit shows the saved **`edited_text`** in the card (not the original AI draft).
- **Write with no AI draft:** The draft block only rendered when `draft_response` or `edited_text` existed, so **Write** toggled the buttons but never showed the textarea. The block now also renders when **`editMode`** is on; the yellow hint hides while writing.

### Open / next
- None for this slice.

---

## 2026-05-15 — Tender demo: Curam brand across pack + agent prompts

### Built
- **`tender-response-demo-pack/`:** `Voice_of_Firm_Style_Guide.md`, `Evidence_Pack_Overview.md`, `Curam_Engineering_Scenario_Document.md`, `Compliance_Rules_Seed_v2.csv` — replaced Coastline / CCM with **Curam Engineering** / **Curam** for a single demo brand.
- **`server/agents/demoSuite/tenderResponse/style-guide.md`** and **`prompt.js`:** Aligned bundled style guide and Stage 3 system prompt with the same naming.

### Fixed / discovered
- None.

### Open / next
- Re-upload S3 evidence pack CSV if production bucket still holds the old `CCM` rule row for Rule 9.

---

## 2026-05-14 — Documentation: changelog strategy, agents index, demo CSS intent

### Built
- **`CHANGELOG.md` (root):** Documented canonical vs optional changelogs (kb mirror, per-agent logs) in file header.
- **`knowledge_base/INDEX.md`:** New *Changelog and evidence logs* section; quick nav + reading order point to root `CHANGELOG.md` as canonical; Bayesian table updated.
- **`knowledge_base/core/CHANGELOG.md`:** Banner linking to root canonical log (fixed relative path).
- **`knowledge_base/agents/AGENTS_INDEX.md`:** Expanded with `spec-validator` / `demo-spec-validator`, `demo-tender-response`, `ai-visibility-monitor`, corrected interactive slug to `google-ads-conversation`, fixed demo document-analyzer pipeline description, summary table of other `agents.js` registrations, demo catalog placeholder note.
- **`DECISIONS.md`:** Entries for changelog layout and future demo supplemental CSS layer.
- **`PROJECT_IDENTITY.md`** + **`knowledge_base/core/PROJECT_IDENTITY.md`:** Security evolution note (incremental hardening, not frozen).
- **`DEMO-AGENTS.md`:** Pointer to root changelog + optional per-demo agent log.

### Fixed / discovered
- `knowledge_base/core/CHANGELOG.md` link to root used one too many `../` segments — corrected to `../../CHANGELOG.md`.

### Open / next
- Reconcile conversation-agent **tool count** claims across `MCP-SERVERS.md`, `server/CLAUDE.md`, and `tools.js` when auditing.
- Implement demo org supplemental CSS when the first second-industry demo needs it (`DemoShell` hook per `DECISIONS.md`).

---

## 2026-05-13 — Tender Response Generator demo agent (full build)

### Built
- **`server/agents/demoSuite/tenderResponse/compliance.py`**: Deterministic compliance checker. Reads JSON from stdin (requirements + 4 evidence files: CSV + 3 XLSX). Parses multi-row XLSX title blocks via `_find_header_row()` (finds first row whose first cell ends with 'ID'). Matches requirements against: compliance rules CSV, Project Experience Library (C5-M corrosivity check: `'C5-M' in corrosivity_class`; value threshold: `> 5_000_000`; ICCP/dredging flags), Personnel Register (RPEQ registration, role matching), Certificates/Insurance Register (ISO 45001 AMBER blocker for RENEWING status, value parse strips `per occurrence/claim/event` suffix). Returns `{ requirement_matches[], compliance_summary, execution_time_ms }`. Tested: 9/10 STRONG, 1/10 PARTIAL (ISO 45001 AMBER), 55ms.
- **`server/agents/demoSuite/tenderResponse/style-guide.md`**: Voice_of_Firm_Style_Guide bundled in repo (prompt constraint, not S3 — no audience substitution needed).
- **`server/agents/demoSuite/tenderResponse/prompt.js`**: Stage 1 extraction system prompt (requirements → structured JSON); Stage 3 draft generation system prompt (includes full style guide + non-negotiable rules: ISO 45001 renewal language, REF-002 C4 not C5-M, PER-006 subconsultant, etc.).
- **`server/agents/demoSuite/tenderResponse/index.js`**: Four-stage pipeline. Stage 0: input sanitisation. Stage 1: PDF rasterisation → vision model extracts requirements (mandatory gates + evaluation criteria). Stage 2a: S3 download of 4 evidence pack files. Stage 2b: spawnWithStdin → compliance.py → matchResults. Stage 3: synthesis model generates first-draft response paragraphs for non-RED-blocked requirements. Result: `data.requirements[]` combining all data; HITL state `pending | blocked`.
- **`server/services/StorageService.js`**: Added `get()` method (GetObjectCommand + async stream iteration → Buffer). Previously only had `put`, `getSignedDownloadUrl`, `remove`, `list`, `healthCheck`.
- **`Dockerfile`**: Added `openpyxl` to existing pip install line for XLSX parsing in compliance.py.
- **Platform wiring**: `DEMO_CATALOG` entry; `AGENT_DEFAULTS` + `ADMIN_DEFAULTS` for `demo-tender-response` (16384 max_tokens, $3.00 budget ceiling); `createAgentRoute` registration in `agents.js` (rateLimit: 10); `GET /api/demo/tender-evidence` + `PATCH /api/demo/runs/:runId/tender-review/:requirementId` in `demo.js`.
- **`client/src/pages/demo/TenderResponseGenerator.jsx`**: Evidence pack browser (pre-run), PDF upload zone, ProcessingModal (3 stages), coverage stats (5-col grid), two-model display, per-requirement HITL cards with Approve / Edit (inline textarea, preserves original_draft) / Reject (requires comment) controls, run history.
- **`client/src/App.jsx`**: Route `/demo/run/demo-tender-response`.
- **`client/src/pages/demo/DecisionLogPage.jsx`**: Added `stepMeta` entries for `rft_extraction`, `evidence_retrieval`, `compliance_check`, `draft_generation`, `blocker_flagged`, `pdf_rasterisation`. Updated `review_action` renderer to also use `requirement_id` (tender-response HITL events have `requirement_id` not `finding_label`).
- **`DECISIONS.md`**: Entry for `edited` HITL state as new platform-level primitive (stores `original_draft` + `edited_text`, `original_draft` frozen at first edit).
- **`DEMO-AGENTS.md`**: Filled `[new agent name]` placeholder in Section 9b → `tender-response`.
- **S3 evidence pack**: 5 files uploaded to `curam-tools-docs / curam engineering/evidence-pack/`: `Compliance_Rules_Seed_v2.csv`, `Project_Experience_Library_Extended.xlsx`, `Personnel_Register.xlsx`, `Certificates_Insurance_Register.xlsx`, `Voice_of_Firm_Style_Guide.md` (style guide is in repo, not S3).

### Fixed / discovered
- S3 folder contains space: `curam engineering` (not `curam-engineering`). Hardcoded in `EVIDENCE_PREFIX`.
- XLSX files have 3-row decorative title block before actual column headers. `_find_header_row()` skips it.
- Corrosivity class stored as `C5-M Marine` not `C5-M`. Changed to substring check `'C5-M' in corrosivity_class`.
- Insurance cover values include text suffix `per occurrence/claim/event`. Regex strips suffix before float parse.
- JSON truncation from long model output fixed by extracting first-`{` last-`}` slice before `JSON.parse` (same pattern as document-analyzer).

### Open / next
- SQL Console: `INSERT INTO org_agent_manifest (org_id, slug, enabled, is_configured, sort_order) VALUES (<curam_org_id>, 'demo-tender-response', true, true, 2);`
- Smoke test full pipeline with test RFT PDF once Railway deploys.
- Confirm compliance.py AMBER (ISO 45001 RENEWING) shows amber highlight in TenderResponseGenerator HITL card.

---

## 2026-05-12 — Two-model pattern, decision log navigation, model logging

### Built
- **Two-model pattern (spec-validator)**: Stage 1 extraction uses `adminConfig.model` (vision-capable); Stage 3 synthesis switches to `getOrgDefaultModel(orgId)`, falling back to `adminConfig.model`. Both models emitted to run log, stored as `logger.step()` events (`model_selection`, `synthesis_model_selection`), and persisted in `logger.complete()` metadata as `extraction_model` / `synthesis_model`.
- **Extraction quality rating (spec-validator)**: After `buildCalcInput`, compute `coverage_pct` (checkable segments / total), `field_coverage_pct`, `has_pressure_budget`, and emit/log a rating: Excellent / Good / Partial / Poor.
- **Settings › Models — Spec Validator selector**: Third column added to the Default & Fallback grid. Saves to both `spec-validator` and `demo-spec-validator` agent slugs. Adds `spec-validator` badge in model list rows.
- **Two-model pattern (document-analyzer)**: Removed hardcoded `'deepseek-chat'` fallback. Now resolves `adminConfig.model ?? orgDefaultModel`; throws clearly if neither is set. Added `logger.step('model_selection', ...)` and `emit()` naming the model before the call. Added `extraction_model` to `logger.complete()` metadata.
- **Decision log — all demo runs**: `/demo/runs` endpoint now returns all agent_runs for the org (no slug filter) unless `?slug=` is explicitly passed. `DecisionLogPage` drops the hardcoded `demo-document-analyzer` slug filter. Runs from both tools appear with a slug badge.
- **Decision log — "View report →" navigation**: Each run card has a button that navigates to `/demo/run/:slug?runId=:id`. `SpecValidator` adds `useSearchParams` + `useEffect` to load a specific run by `?runId=` URL param.
- **Transaction log — model metadata**: `TransactionDetail` renders `extraction_model` and `synthesis_model` from `tx.metadata` in the expanded detail panel.
- **Demo dashboard — cards active by default**: `is_configured` defaults to `true` for all catalog agents when no DB row overrides, so spec-validator and future agents show as "Ready" without manual seeding.
- **Decision log — spec-validator trace steps**: Added `stepMeta` mappings for `pdf_extraction`, `python_calculation`, `synthesis` so the decision log timeline shows correct icons and labels for spec-validator runs.

### Fixed / discovered
- Decision log was empty for spec-validator: `/demo/runs` was hardcoded to `slug=demo-document-analyzer`. Fixed to no-filter default.
- Spec Validator card on demo dashboard showed "Not configured" / "Coming soon" because `is_configured` defaulted to `false`. Fixed to `true`.
- Stage 3 synthesis was using the vision extraction model for text-only synthesis — wasteful and inflexible. Now uses org default model.

### Fixed / discovered (session 2)
- **document-analyzer — genuine two-stage split**: Previous implementation combined extraction and analysis in a single model call despite CLAUDE.md mandating two-model pattern. Split into: Stage 1 (vision model `adminConfig.model`) returns `document_type`, `extracted_text`, `parties` only; Stage 2 (synthesis model `orgDefaultModel || extractionModel`) receives extracted text as context, returns `findings`, `summary`, `custom_response`. Both models now appear in decision log, transaction log metadata (`extraction_model`, `synthesis_model`), and all `emit()` / `logger.step()` calls.
- **Decision log step rendering**: Added `model_selection` and `synthesis_model_selection` to `stepMeta`. Fixed `pdf_extraction` detail renderer to show `image_pages` (doc-analyzer) alongside `segments_extracted` (spec-validator) — previously showed "0 segments" for doc-analyzer runs.
- **CLAUDE.md reference implementation**: Updated to name both `specValidator` (three-stage) and `documentAnalyzer` (two-stage) as reference implementations. Removed "(single-stage)" description that was outdated.

### Open / next
- Confirm extraction quality rating accuracy against 452 George Street document once Railway deploys.
- Remove temp `console.log` debug lines from spec-validator index.js once extraction confirmed working.
- Smoke test document-analyzer two-stage split with a real PDF — confirm decision log shows two distinct model entries.

---

## 2026-05-11 — ProcessingModal shared component

### Built
- **`client/src/components/shared/ProcessingModal.jsx`**: New shared overlay modal for multi-stage agent runs. Full-screen backdrop overlay (z-50, `rgba(0,0,0,0.5)`), rounded-2xl panel. Props: `stages`, `estimatedDuration`, `onCancel`, `cancelConfirmMessage`, `isOpen`. Internal 1s tick timer; per-stage elapsed via `useRef` timestamps on status transitions. Completed stages show checkmark + frozen duration; active stage shows spinner + live elapsed; pending shows hollow circle. Description shown for active/complete, hidden for pending. Cancel → confirm → "Confirm cancel" / "Keep waiting". Always includes browser tab note. No close button — only dismisses via parent setting `isOpen=false`.
- **`client/src/pages/demo/SpecValidator.jsx`**: Replaced inline three-stage pipeline block with `<ProcessingModal>`. Added `STAGE_DESCRIPTIONS` constants. Added `cancelledRef` to prevent orphaned SSE `onResult` from updating state after cancel. Stage shape converted from `{ key, name, status, detail }` to `{ id, label, description, status }` at the call site.
- **`client/src/pages/demo/DocumentAnalyzer.jsx`**: Added `ProcessingModal` replacing the inline loading block. Added `INITIAL_DA_STAGES`, `advanceDocStages` function (advances stages based on server-emitted progress strings: "stage 1: running deterministic" → stage 2 active; "stage 1 complete" / "stage 2 complete" → complete). Added `docStages` state, `cancelledRef`, and `handleCancel` (resets `running`, `file`, `progress`, `docStages`). No existing logic changed.
- **`DECISIONS.md`**: Added "ProcessingModal — shared component for multi-stage agent runs" entry with full props interface, behaviour spec, rationale, and future-agent usage pattern.

### Fixed / discovered
- `SpecValidator.jsx` `onResult` callback previously received the outer `resultPayload` shape `{ summary, data: { all_findings, ... } }` but all field access assumed the inner flat object. Fixed by extracting `data?.data ?? data` in the SSE callback (mirrors `refreshRun` which uses `row.result?.data ?? row.result`).
- HITL comment requirement was inverted: approve required a comment (for low-confidence or cross-stage), reject/resubmit did not. Fixed server-side (422 on reject/resubmit without comment; approve only blocked for cross-stage overlap) and client-side (Reject/Resubmit buttons disabled + validation text when comment empty).

### Open / next
- End-to-end smoke test of ProcessingModal in both SpecValidator and DocumentAnalyzer.
- Verify elapsed timers and stage transitions look correct against a real run.

---

## 2026-05-11 — Spec Validator — Phase 2 (frontend complete)

### Built
- **`client/src/providers/IconProvider.jsx`**: Added `FileCheck` import and `'file-check': FileCheck` semantic map entry.
- **`client/src/pages/demo/SpecValidator.jsx`**: Primary Phase 2 deliverable (~700 lines). PDF-only upload zone (10 MB, drag-drop + picker). Three-stage progress indicator (Extracting / Python Calculations / Synthesising) with SSE keyword advancement, post-run stage detail (model name, token counts, library versions). Findings panel: deterministic (Python) section with stated/calculated 3-col grid, expandable "Show working" monospace block, auto-approved PASS rows, approve/reject/resubmit controls for FAIL/WARNING; probabilistic (Claude) section with confidence badges, low-confidence comment gate. Cross-stage overlap pills. Sticky review summary bar (PASS/FAIL/WARNING counts, pending count, certificate gate). Certificate export via `exportService.js` (library versions + full working for FAIL findings). Follow-up Q&A via `ConversationView` with `agentSlug` context. Persistent inline error banner for run failures (not toast).
- **`client/src/pages/tools/SpecValidatorPage.jsx`**: Thin wrapper — renders `<SpecValidator slug="spec-validator" />`.
- **`client/src/App.jsx`**: Added two routes: `/demo/run/demo-spec-validator` → `<SpecValidator />`, `/tools/spec-validator` → `<SpecValidatorPage />`.
- **`client/src/config/tools.js`**: Added `spec-validator` entry (Utilities group, `org_member`+ roles, `file-check` icon).

### Fixed / discovered
- Sidebar and DemoSidebar: no direct edits required. Sidebar renders dynamically from tools.js via `getPermittedToolGroups`; DemoSidebar is manifest-driven via `/demo/manifest` API. Adding to tools.js and demoCatalog.js (Phase 1 Step 6) covers both surfaces automatically.

### Open / next
- Phase 1 remaining steps (prompt.js, agents.js, demoCatalog.js, AgentConfigService.js, demo.js) were completed in the Phase 1 session.
- End-to-end smoke test against a real hydraulic PDF when Railway env is available.

---

## 2026-05-11 — Spec Validator agent — Phase 1 (server-side pipeline complete)

### Built
- **`Dockerfile`**: Added Python 3 + venv layer (`/opt/pyenv`) with `fluids` and `numpy`. Separate `RUN` layers to avoid OOM (mirrors existing ghostscript/chromium pattern). `PYTHON_EXEC` env var for local override.
- **`server/agents/specValidator/calculator.py`**: Deterministic hydraulic calculation engine (~340 lines). Reads JSON from stdin, writes JSON to stdout. Implements: continuity-equation velocity check (`Q = V·A`), Hazen-Williams pressure drop, Darcy-Weisbach pressure drop (friction factor via `fluids.friction_factor`), Reynolds number + flow regime classification, static pressure budget residual check. Returns full step-by-step working for every check. Status: `PASS` / `FAIL` / `WARNING` per AS/NZS 3500.1 limits (velocity max 3.0 m/s, min 0.5 m/s). Output includes `library_versions` for certificate traceability.
- **`server/agents/specValidator/test_calculator.py`**: Standalone test script — no server dependencies, calls `calculator.py` via subprocess. Hardcoded 452 George Street test cases: CW-04 velocity FAIL (4.09 m/s stated as 2.51), CW-06 velocity WARNING (1.25 m/s stated as 0.87), CW-03 Hazen-Williams FAIL (19.8 kPa stated as 12.4 — C=120 too high for copper, fittings allowance omitted). Assertions with tolerance, prints full working for CW-04 and CW-03.
- **`server/agents/specValidator/index.js`**: Three-stage pipeline agent (~430 lines). Stage 1: Claude vision PDF extraction (pipe segments + pressure system as structured JSON, no calculations). Stage 2: `execFileAsync(PYTHON_EXEC, [CALC_SCRIPT])` — 30s timeout, 10 MB buffer. Stage 3: Claude synthesis (plain-language findings + probabilistic flags, no new calculations). Dual-status pattern: `check_status` (Python, immutable) vs `status` (HITL review state). PASS findings auto-approved at creation. Cross-stage overlap detection. Extraction privacy post-AI. S3 auto-save. Exports `{ runSpecValidator, TOOL_SLUG_INTERNAL, TOOL_SLUG_DEMO }`.

### Fixed / discovered
- CW-03 pressure drop reverse-engineering: document used C=120 (incorrect for copper per AS/NZS 3500.1 Table 3.3, should be C=100) and omitted fittings equivalent length (22.0m fittings → total 30.2m equiv). These two errors together produce stated 12.4 kPa vs correct 19.8 kPa (59.7% under-calculation).
- Python venv required on Alpine to avoid PEP 668 "externally managed environment" errors with system pip.

### Open / next
- Phase 1 remaining: `prompt.js`, `agents.js` registrations, `demoCatalog.js`, `AgentConfigService.js`, `demo.js` (follow-up slug routing + rejected-finding block).
- Phase 2: Full frontend — `SpecValidator.jsx`, `SpecValidatorPage.jsx`, `IconProvider`, `App.jsx`, `tools.js`, `Sidebar.jsx`, `DemoSidebar.jsx`.

---

## 2026-05-11 — Document Analyzer certificate actions: preview, download, email (icon-only buttons)

### Built
- **View certificate button** (`DocumentAnalyzer.jsx`): New `handleViewCertificate` builds the certificate HTML client-side and opens it as a blob URL in a new tab — no download, no server round-trip.
- **Three icon-only certificate buttons**: Replaced the previous labeled Download/Email buttons with three compact square icon-only buttons (eye, download, mail). All use `p-2` + `border: 1px solid var(--color-border)`. Email button shows green border/icon when sent — no text label needed.
- **`viewLoading` state**: Added alongside `certLoading` to disable the view button while the blob URL is being built (synchronous but guarded).

### Fixed
- Email button icon and label were rendering on separate lines because `getIcon()` returns an SVG element and adjacent text node sits below it without a flex container. Fixed by making the button icon-only — no text node, no layout issue.

### Open / next
- Nothing outstanding on certificate actions.

---

## 2026-05-11 — Document Analyzer follow-up Q&A scope restriction + configurable prompt

### Built
- **Follow-up system prompt** (`server/agents/demoDocumentAnalyzer/prompt.js`): New `buildSystemPrompt()` for the document analyzer follow-up Q&A. Default prompt restricts the AI to only answer questions about the uploaded document — refuses off-topic queries (e.g. general knowledge). Admin-overridable via Admin › MCP Prompts.
- **Admin Prompts entry** (`client/src/pages/admin/AdminPromptsPage.jsx`): Added `demo-document-analyzer` to the AGENTS list so admins can view and customise the follow-up system prompt.

### Fixed
- Removed conflicting `"You are a specialist… / Answer the question directly"` instructions from the `contextPrompt` user message in `server/routes/demo.js`. These were overriding the system prompt boundary, allowing the model to answer off-topic questions. Both the system prompt and user message closing instruction now consistently enforce the document scope restriction.

### Open / next
- Test with Railway deployed build to confirm off-topic questions are declined.

---

## 2026-05-11 — Document Analyzer PDF parsing resilience + global model fallback

### Built
- **PDF text extraction fallback**: Updated `server/agents/demoSuite/documentAnalyzer.js` to automatically extract text from PDFs using `pdf-parse` if the configured model does not support vision (e.g. DeepSeek).
- **Global default model fallback**: Updated `server/platform/AgentConfigService.js` (`getOrgDefaultModel`, `getOrgFallbackModel`) to inherit the default model from the primary admin organisation (`org_id = 1`) if the current tenant organisation has not configured one, rather than returning `null`.
- **OpenAI-compatible text-only enforcement**: Updated `server/platform/providers/openai-compatible.js` to automatically concatenate an array of text-only message contents into a single string for models that do not support vision inputs. This prevents unhandled API hangs or `unknown variant image_url` errors when interacting with strictly text-based providers like DeepSeek.

### Fixed
- Fixed an issue where the Document Analyzer would hang and keep transactions permanently stuck in the 'started' state when a text-only model (like DeepSeek) was fed a large document as an array of objects.
- Fixed a bug where `pdf-parse` was instantiated incorrectly, causing it to fail or hang on text extraction.

### Open / next
- Due to the hard output generation limits of all major models (typically 8,192 tokens), passing large documents (e.g. 190,000+ characters) to text-only models and asking the LLM to output the verbatim text back into the JSON response will result in an `Unterminated string in JSON` error. Consider removing `extracted_text` from the LLM's expected JSON output and injecting the `pdf-parse` extracted text into the final response payload server-side instead, which will significantly reduce tokens and prevent output truncation.

---

## 2026-05-10 — Re-introduce shared sanitize utility + vision model enforcement for document analyzer

### Built
- `server/utils/sanitize.js` — shared prompt-injection detection utility, extracted from inline code in documentAnalyzer.js. Available for all agents as a platform standard.
- Documented as a platform primitive in `PLATFORM_PRIMITIVES.md`.

### Fixed
- Removed hardcoded `'deepseek-chat'` fallback from documentAnalyzer.js. If no model is configured in Admin > Agents, a clear error is thrown telling the user to set a vision-capable model.
- Re-added `supportsVision` checks: provider adapters (anthropic.js, gemini.js = true; openai-compatible.js = false) are already in place.
- The document analyzer's `callModel()` checks `provider.supportsVision === false` and throws a clear error if the configured model (e.g. DeepSeek) doesn't support image analysis.

### Open / next
- Document Analyzer default model must be set in Admin > Agents or Admin > Settings > Models. The old `'deepseek-chat'` hardcode no longer masks the issue.
- Demo users should configure Claude or Gemini in their agent config for document analysis to work.

---

## 2026-05-08 — Fix: S3 presigned URL expiration reduced from 1 year to 7 days (AWS SigV4 limit)

### Fixed
- **`server/agents/demoSuite/documentAnalyzer.js`** — S3 presigned URL `expiresIn` changed from `365 * 24 * 3600` (1 year) to `7 * 24 * 3600` (7 days). AWS Signature Version 4 presigned URLs have a maximum expiration of 7 days. The 1-year value caused a non-fatal S3 save error on every document analysis run. The S3 save is already non-fatal (caught and logged as a warning), so document analysis itself was never blocked — but the error log is now eliminated and the signed URL is generated successfully.

### Open / next
- Run provisioning SQL to create Curam Engineering org (if not done already)
- Invite demo user via Admin > Users, select Curam Engineering org
- Demo user logs in → routed to DemoShell + document-analyzer agent

---

## 2026-05-08 — Documentation: DEMO-AGENTS.md + DECISIONS.md entries for document-analyzer session

### Built
- **`DEMO-AGENTS.md`** — comprehensive reference doc for building demo agents on the platform. Covers: what a demo agent is, provisioning a demo client org, full reference implementation of document-analyzer (two-stage analysis pattern, file upload via base64, PDF rasterisation, HITL review flow, decision trace, compliance certificate, S3 save, Decision Log page), checklist for adding a second demo agent, and pattern constraints.
- **`DECISIONS.md`** — three new decision entries: Default & Fallback Model Management (Settings > Models tab), Document Analyzer file upload via base64 JSON body, Document Analyzer Save to AWS S3, and Decision Log page run history viewer.

### Fixed
- Removed duplicate content blocks from DEMO-AGENTS.md (S3 save and Decision Log sections appeared twice at the bottom).
- Removed duplicate `---` separators from DECISIONS.md.

### Open / next
- Run provisioning SQL to create Curam Engineering org (if not done already)
- Invite demo user via Admin > Users, select Curam Engineering org
- Demo user logs in → routed to DemoShell + document-analyzer agent

---

## 2026-05-08 — Default LLM model tables; file upload fix; S3 save; Decision Log page

### Built

**Default & Fallback Model Management — Settings > Models tab**
- `server/routes/settings.js` — new `GET/PUT /api/settings/default-model` and `GET/PUT /api/settings/fallback-model` endpoints. Store/retrieve org-level default and fallback model IDs in `system_settings` under keys `default_model` and `fallback_model`.
- `server/platform/AgentConfigService.js` — new `getOrgDefaultModel`, `updateOrgDefaultModel`, `getOrgFallbackModel`, `updateOrgFallbackModel` methods. Canonical access path for model resolution.
- `client/src/components/settings/ModelsTab.jsx` — new "Default & Fallback Models" section with two dropdowns (default model, fallback model), inactive-model warning highlighting, and "Save defaults" button. Fetches all three endpoints on mount via `Promise.all`.
- `client/src/pages/SettingsPage.jsx` — wired ModelsTab into the settings page layout.

**Document Analyzer — file upload fix**
- `client/src/pages/demo/DocumentAnalyzer.jsx` — fixed file upload to use `FileReader.readAsDataURL` with base64 prefix stripping, sending `{ fileData, mimeType, fileName }` JSON body. No multer dependency. 9 MB client-side limit.

**Document Analyzer — Save to AWS S3**
- `server/routes/demo.js` — new `POST /api/demo/runs/:runId/save-to-s3` endpoint. Reads `file_data` and `file_name` from the run's result JSONB, uploads to S3 via `StorageService.put` under `{orgName}/{fileName}`, returns a 7-day pre-signed download URL.
- `client/src/pages/demo/DocumentAnalyzer.jsx` — new "Save to AWS" section below the certificate card. Orange AWS-branded button, loading/saved states, pre-signed URL link. Idempotent — shows "Saved ✓" on repeat clicks.

**Decision Log Page — readable run history**
- `client/src/pages/demo/DecisionLogPage.jsx` — new full page listing all document analyzer runs in chronological order. Expandable cards with timeline view showing decision badges (amber-highlighted for model selection, file storage, certificate readiness) and regular step entries for each trace step.
- `client/src/App.jsx` — new route `/demo/decision-log` added.
- `client/src/components/layout/DemoSidebar.jsx` — new "Decision Log" nav item under new "History" section.
- `server/routes/demo.js` — extended runs list query to also return `tokens_used` and `cost_aud` from the result JSONB.

### Open / next
- Run provisioning SQL to create Curam Engineering org (if not done already)
- Invite demo user via Admin > Users, select Curam Engineering org
- Demo user logs in → routed to DemoShell + document-analyzer agent

---

## 2026-05-06 — Multi-org user management: Organisations page + invite org selector

### Built
- **`GET/POST /api/admin/organizations`** — list all orgs, create new org (name + org_type). New routes in `server/routes/admin.js`, before the invite block.
- **`AdminOrganizationsPage.jsx`** — new admin page: table of all orgs with name, type badge (Demo/Internal), created date; "New Organisation" modal with name + type fields.
- **`AdminUsersPage.jsx` — InviteModal** — org dropdown added; fetches `/admin/organizations` on mount, shows selector when more than one org exists, defaults to admin's own org. `orgId` passed to invite endpoint.
- **`Sidebar.jsx`** — "Organisations" nav item (building icon) added above Users under Users & Access.
- **`IconProvider.jsx`** — `Building2` Lucide icon added as `building` semantic key.
- **`App.jsx`** — `/admin/organizations` route added.

### Fixed
- Route mismatch: `/demo/run/document-analyzer` → `/demo/run/demo-document-analyzer` (DemoSidebar uses slug verbatim from `org_agent_manifest`).

### Open / next
- Run provisioning SQL to create Curam Engineering org (if not done already)
- Invite demo user via Admin > Users, select Curam Engineering org
- Demo user logs in → routed to DemoShell + document-analyzer agent

---

## 2026-05-05 — Curam Engineering demo: document-analyzer built and deployed

### Built
- **`server/agents/demoSuite/documentAnalyzer.js`** — single-file two-stage analysis agent. Stage 1: 7 deterministic regex rules run in Node.js on Claude-extracted text. Stage 2: Claude probabilistic findings with per-finding confidence scores. PDF rasterisation via Ghostscript (mirrors docExtractor). SHA-256 file hash. Injection scan with annotation. Cross-stage overlap detection. Extraction privacy applied post-AI.
- **`server/routes/demo.js`** — three HITL review endpoints appended: `GET /runs`, `GET /runs/:runId`, `PATCH /runs/:runId/review/:findingId`. Review state patched via `jsonb_set` into `agent_runs.result.data` — no separate table. Comment enforcement (low confidence + cross-stage). Trace append per review action.
- **`server/platform/AgentConfigService.js`** — `AGENT_DEFAULTS` and `ADMIN_DEFAULTS` entries for `demo-document-analyzer` (max_tokens 8192, budget AUD 1.00).
- **`server/routes/agents.js`** — `createAgentRoute` registration at `/api/agents/demo-document-analyzer`.
- **`client/src/pages/demo/DocumentAnalyzer.jsx`** — full HITL UI: drag-drop upload, SSE stream with progress, sanitisation card, per-finding review (approve/reject/resubmit), comment enforcement, decision trace timeline, compliance certificate export via exportService.
- **`client/src/App.jsx`** — route `/demo/run/document-analyzer`.
- **`DEMO-AGENTS.md`** — new reference guide for building demo agents: provisioning SQL, two-stage pattern, HITL flow, compliance certificate, second-agent checklist, pattern constraints.

### Open / next
- Run provisioning SQL in Admin console to create Curam Engineering org + manifest row
- Create demo user via Admin > Users

---

## 2026-05-05 — Curam Engineering demo: document-analyzer planning + decisions

### Built
- Nothing deployed — planning and prep session only.

### Decided
- **Curam Engineering** is the first external demo client org (`org_type = 'demo'`).
- Org + manifest created via Admin SQL Console, not committed code — client data stays out of version control.
- `document-analyzer` agent: single-file `server/agents/demoSuite/documentAnalyzer.js`. No tools.js/prompt.js split (fixed prompt, no ReAct loop). Reuses `docExtractor` Ghostscript helpers + `getProvider`. Applies extraction privacy settings post-AI.
- File upload: client converts to base64 → JSON body. No multer. Stays within `createAgentRoute` contract.
- Slug: `demo-document-analyzer`. Permission: `org_member`.
- Extraction prompt covers: parties/obligations, dates/milestones, payment terms, liability, scope boundaries, compliance refs. Flags: risk transfer, unlimited liability, missing specs. Tune after first real demo.
- All decisions recorded in DECISIONS.md — "Demo Client Org — Curam Engineering" entry.

### Open / next
- Run SQL in Admin console to create Curam Engineering org + manifest row
- Build `server/agents/demoSuite/documentAnalyzer.js`
- Register route in `agents.js` + add AgentConfigService defaults
- Build `client/src/pages/demo/DocumentAnalyzer.jsx`
- Add `/demo/run/document-analyzer` route in `App.jsx`
- Create demo user via Admin > Users

---

## 2026-05-05 — Demo layer foundation: multi-tenant org branching, manifest API, demo shell

### Built

**Schema — `organizations.org_type` + `org_agent_manifest`**
- `server/db.js` — idempotent migration adds `org_type TEXT NOT NULL DEFAULT 'internal'` to `organizations`, with DROP/ADD CONSTRAINT pattern for `CHECK (org_type IN ('internal', 'demo'))`. New table `org_agent_manifest` — per-org agent assignment: `(org_id, slug)` PK, `enabled`, `label`, `description`, `sort_order`, `is_configured`, `assigned_at`, `assigned_by`.

**Auth — `orgType` propagated through session**
- `server/middleware/requireAuth.js` — `org_type` added to session JOIN; `orgType: row.org_type ?? 'internal'` set on `req.user`.
- `server/routes/auth.js` — `org_type` added to the `organizations` JOIN in login, register, and GET /profile. Response shape includes `orgType` — `authStore` persists it automatically, no extra API call needed.

**Manifest API — `server/routes/demo.js` (new)**
- `GET /api/demo/manifest` — enabled rows merged with `DEMO_CATALOG` metadata, ordered by `sort_order`. Public (authenticated).
- `GET /api/demo/admin/catalog` — full catalog array. Admin-only.
- `GET /api/demo/admin/manifest` — all rows including disabled, merged with catalog. Admin-only.
- `PUT /api/demo/admin/manifest/:slug` — upsert with `ON CONFLICT (org_id, slug)`. Admin-only.
- `DELETE /api/demo/admin/manifest/:slug` — remove assignment. Admin-only.
- `org_id` always from `req.user.orgId` — no org param accepted.

**Catalog — `server/demo/demoCatalog.js` (new)**
- `DEMO_CATALOG` code constant. Three agents: `document-analyzer` (extraction), `web-intelligence` (prefetch), `conversation-assistant` (react). Code-registered because catalog entries are tied to deployed agent code — per-org assignment lives in DB manifest.

**Route mount — `server/index.js`**
- One line added: `app.use('/api/demo', require('./routes/demo'))`.

**Client — OrgShell layout branching**
- `OrgShell.jsx` — reads `user.orgType`; renders `AppShell` for internal orgs, `DemoShell` for demo orgs. Redirects demo users away from non-`/demo` paths on mount.
- `DemoShell.jsx` — mirrors AppShell pattern: TopNav + in-flow spacer + `DemoSidebar` + `<Outlet />`.
- `DemoSidebar.jsx` — fetches `/api/demo/manifest` on mount, renders agent nav items from manifest. No import of `Sidebar.jsx` or `tools.js`.
- `DemoDashboardPage.jsx` — agent card grid. Each card: icon, name, description, Ready/Coming-soon badge, Launch button (disabled when `is_configured = false`).
- `App.jsx` — `OrgShell` replaces `AppShell` on the authenticated shell route; `/demo/dashboard` route added; `DemoDashboardPage` imported.

### Fixed / discovered
- Demo org users would land on `/dashboard` (internal shell) without the `OrgShell` redirect — `OrgShell` useEffect redirects to `/demo/dashboard` on any non-`/demo` path when `orgType === 'demo'`.

### Open / next
- Restart server to run schema migrations, create demo org + user in DB, test full login → redirect flow
- Build `document-analyzer` agent under `server/agents/demoSuite/documentAnalyzer/`
- Admin UI: Demo Manifest management page (`/admin/demo-manifest`) — assign/remove/configure agents per org
- `DemoRunPage.jsx` — slug-routed page that dispatches to the correct agent UI

---

## 2026-05-03 — WP Theme Extractor: URL → WordPress theme skeleton with vanilla CSS

### Built

**WP Theme Extractor agent (`wp-theme-extractor`) — new tool at `/tools/wp-theme-extractor`**

- `server/agents/wpThemeExtractor/index.js` — pre-fetch pattern. Fetches external URL HTML via `https.request` (not fetch — Railway-safe), strips scripts/comments, sends to Claude in a single call. Handles HTTP/HTTPS, redirects (max 5), 100KB truncation, 20s timeout.
- `server/agents/wpThemeExtractor/prompt.js` — detailed extraction prompt covering: Tailwind→vanilla CSS conversion, BEM class naming, `:root` variable extraction, responsive breakpoint preservation, `{{semantic-placeholder}}` text substitution, `placehold.co` image replacement, WordPress theme header, and full file structure requirements for all 9 output files.
- `parseThemeJson()` — strips markdown fences and finds first `{`/last `}` (CLAUDE.md pattern) before `JSON.parse`. Catches truncated/wrapped JSON from model.
- Returns `{ result: { summary, data: { files, url, pageType, mainFilename, fetchedKb } } }` — consumed by `createAgentRoute` to produce `resultPayload.summary` + `resultPayload.data.files`.

**Files generated per run:**
- `style.css` — WP theme header + extracted vanilla CSS + `:root` custom properties
- `functions.php` — `add_theme_support`, nav menus (`primary-menu`, `footer-menu`), `wp_enqueue_style`, two widget areas
- `header.php` — `wp_head()`, `body_class()`, `wp_nav_menu()` for primary nav
- `footer.php` — footer nav, `wp_footer()`
- `front-page.php` or `single.php` — toggled by Homepage / Post/Page selector
- `page.php` — static page template with standard WP loop
- `archive.php` — `the_archive_title()` + post loop with excerpt
- `single-{detected-cpt}.php` — Claude detects CPT from HTML content (service, product, project, etc.)
- `template-outline.html` — annotated HTML with `{{semantic-placeholders}}` for reference

**Route:** registered in `server/routes/agents.js` as `/api/agents/wp-theme-extractor`, `org_member` permission.

**Frontend — `client/src/pages/tools/WpThemeExtractorPage.jsx`**
- Three tabs: Extract (URL input + page type toggle + run button), Files (file browser), History
- File browser: left sidebar of filenames, right code view with Copy + Download per file, Download All button
- Homepage/Post/Page radio toggle — controls which main template is generated
- SPA warning: if fetched HTML looks empty (React SPA without SSR), the tool notifies the user to use DevTools → Copy outerHTML instead
- Dashboard entry in `client/src/config/tools.js` under new "WordPress" group
- Route wired in `client/src/App.jsx`

**Token/cost notes:** `max_tokens` default is 16384 (overrides platform default 8192) — necessary because Claude generates ~8 PHP/CSS files. Typical run ≈ 30,000–60,000 input tokens (100KB HTML) + ~4,000 output tokens.

### Fixed / discovered
- `agentOrchestrator.run()` with `tools: []` and `maxIterations: 1` returns `{ result: { summary: rawText } }` where `rawText` is the model's raw response string. Pre-fetch agents that prompt Claude to return JSON must parse `result.summary` themselves before constructing their own `{ result: { summary, data } }` return shape.
- React SPAs without SSR return `<div id="root"></div>` — fetching the page source URL gives an empty shell with no visible content. Only SSR pages (Next.js, WordPress, static HTML) produce useful output from a URL fetch.

### Open / next
- Test against real-world URLs (WordPress, Webflow, plain HTML, Next.js SSR)
- Calibrate HTML truncation threshold (100KB) — complex pages may need more context; simple pages waste tokens
- Consider a "Refine" step: let user paste back partial theme + ask Claude to improve specific files
- ZIP download (all files in one click) — currently downloads files individually in a loop

---

## 2026-04-29 — Cross-source reconciliation: Ads vs GA4 vs WordPress ground-truth checks

### Built

**Cross-source reconciliation — googleAdsMonitor extension**
- `server/agents/googleAdsMonitor/index.js` — two reconciliation functions added before and after the Claude call:
  - `reconcilePreRun(dailyPerformance, sessionsOverview)` — pure, synchronous. Sums Ads clicks from `ads_get_daily_performance` and GA4 sessions from `ga4_get_sessions_overview`. Ads paid clicks are a subset of total sessions — if Ads > GA4 × 1.2 (20% tolerance for ad-blockers), flags `cross_source_pre_run`. Skips when Ads clicks < 10 (low-traffic noise guard).
  - `reconcilePostRun(orgId, startDate, endDate, totalAdsConversions)` — async. Fetches `wp_get_enquiries` via `getWordPressServer` for same date range. Flags `cross_source_post_run` when Ads conversions ≥ 3 AND (WP has 0 enquiries, or Ads:WP ratio > 5:1). WordPress errors/missing server caught silently — no false positives on unconfigured installs.
  - Both produce `{ tool, message }` entries. Attached to `result.boundsFailed` before returning from `runSingleCustomer`.
- `server/platform/createAgentRoute.js` — `boundsFailed` now merges `validateToolData(toolData)` with `result?.boundsFailed ?? []`. Any agent can contribute reconciliation failures by setting `result.boundsFailed` — platform handles the merge generically.

**Direction-of-check rationale:**
- Pre-run checks Ads clicks > GA4 sessions only (tracking breakage). GA4 >> Ads is normal (organic traffic).
- Post-run checks Ads conversions >> WP enquiries only (Ads overcounting). WP >> Ads is expected (organic/direct leads exist outside paid campaigns).

### Open / next
- Calibrate thresholds (1.2× clicks/sessions, 5:1 conversions/enquiries) after 4–6 weeks of production data
- Step 3 guardrails: operationalise `analyticalGuardrails` from intelligence_profile (flag ROAS > 10× declared target as potentially inflated)
- Additional cross-source checks as patterns emerge (e.g. GA4 conversion events vs Ads conversion count)

---

## 2026-04-29 — Deterministic guardrails: needs_review status, tool schema validation, bounds warning UI

### Built

**Foundation — `needs_review` run status**
- `server/db.js` — extended `agent_runs.status` CHECK constraint to include `'needs_review'`. Two-step migration: `DROP CONSTRAINT IF EXISTS agent_runs_status_check` + `ADD CONSTRAINT` with updated value list. Idempotent on both new and existing deployments. Also updated the `CREATE TABLE IF NOT EXISTS` block for clean installs.
- `server/platform/persistRun.js` — JSDoc updated to document `'needs_review'` as a valid status value.

**Schema validation — `validateToolData` + `toolSchemas`**
- `server/platform/toolSchemas.js` — pure validator functions for the three most-used tool result shapes: `get_campaign_performance` (CTR ∈ [0,1], cost ≥ 0, conversions ≥ 0, clicks ≤ impressions), `get_daily_performance` (date format, cost ≥ 0, clicks ≤ impressions), `get_search_terms` (term string, CTR ∈ [0,1], cost ≥ 0). Aggregates failures by type using counters — 500 bad rows = one summary message. Max 10 `boundsFailed` entries total across all three schemas.
- `server/platform/validateToolData.js` — pure orchestrator. Walks `extractToolData` output, runs matching schema per tool name, returns `Array<{ tool, message }>`. Catches validator throws so a bad schema never kills a run.
- `server/platform/createAgentRoute.js` — wired validation between `extractToolData` and `persistRun`. Sets `status: 'needs_review'` when `boundsFailed.length > 0`; attaches `boundsFailed` to `resultPayload` only when non-empty. Backwards compatible — agents with no registered schemas always get `status: 'complete'`.

**UI — `BoundsWarningPanel` + `GoogleAdsMonitorPage` updates**
- `client/src/components/ui/BoundsWarningPanel.jsx` — reusable amber warning panel. Null-renders when `boundsFailed` is absent. Any tool page imports with one line and places before `<MarkdownRenderer>`.
- `client/src/pages/tools/GoogleAdsMonitorPage.jsx` — four `status === 'complete'` filters updated to include `needs_review` (history tab, dashboard card "last run" header, run confirmation modal, history load). Amber "needs review" badge added to both the dashboard card and history run rows. `BoundsWarningPanel` added to both the live result view and expanded history run view.

**Documentation**
- `DECISIONS.md` — new entry: deterministic guardrails foundation decision + observability deferral rationale (Option 1 ad-hoc SQL now, Option 2 Admin Logs tab when manual querying becomes friction, Option 3 deferred until sustained list volume).
- `server/CLAUDE.md` — new "Deterministic guardrails — needs_review status" section with the correct history filter pattern, `boundsFailed` render pattern, and observability SQL.
- `PLATFORM-PRIMITIVES.md` — new entries for `validateToolData`, `toolSchemas`, `BoundsWarningPanel`; updated `agent_runs` schema status values; added post-extraction validation note to `extractToolData` entry.

### Open / next
- Extend `toolSchemas.js` to cover remaining high-use tools after observing production failure patterns.
- Step 3 of the guardrails plan: operationalise `analyticalGuardrails` — parse `intelligence_profile` targets into a post-run bounds function (e.g. flag ROAS > 10× declared target as potentially inflated). Same `needs_review` + `boundsFailed` output. Additive to the existing text hint in the prompt.
- Metric service layer: move deterministic arithmetic (CTR, ROAS, CPA derived values) out of LLM reasoning and into tool `execute()` functions so the AI receives pre-computed values.

---

## 2026-04-29 — ROI Analysis: actual revenue vs investment vs industry benchmark chart

### Built

**ROI Analysis section — added to Campaign Dashboard (bottom of page)**
- `server/routes/dashboard.js` — new `GET /api/dashboard/roi-analysis?days=` endpoint.
  Fetches Google Ads daily performance (spend) and WordPress `wp_get_enquiry_details` (final_value) in parallel via MCPRegistry. Aggregates by calendar month. Calculates total investment (ad spend + prorated $1,500/mo management fee), actual CRM revenue, ROAS, vs industry benchmark vs target.
- Revenue source: `final_value` from `clientenquiry` post type in WordPress CRM, by enquiry submission date. Only records with a recorded final_value are counted.
- Management fee: $1,500/mo, prorated by calendar days covered for partial months at range boundaries.
- Industry benchmark: Car Detailing / Auto Detailing AU, Google Ads average 3–5× ROAS (WordStream). 3.5× used as conservative lower bound.
- Revenue target: $50,000/mo (stated).
- WordPress gracefully unavailable: if WP MCP server not connected, returns `wordpressAvailable: false` — cost bars still display, revenue/ROAS bars show zero with explanatory note.

**ROI section charts (inline Recharts — `ReferenceLine` required, not in BarChart wrapper):**
- 6 KPI tiles: total investment, actual revenue, actual ROAS (colour-coded vs benchmarks), net return, vs $50k/mo target, industry benchmark revenue
- Monthly Revenue vs Investment: stacked bar (ad spend + management fee) alongside actual revenue bar; $50k target reference line
- Monthly ROAS: bar chart colour-coded green/amber/red; industry 3.5× reference line; target 5.56× reference line (50000/9000)
- Methodology note: explains revenue calculation caveat (recent months may be understated as jobs complete after enquiry date)

**Date range filtering:** ROI section uses same `days` preset (30d/60d/90d) as the rest of the dashboard; loads in parallel independently so WordPress delays don't block Google Ads charts.

### Open / next
- Profitability Oracle (True ROAS) — cross-source revenue attribution (ad campaign → CRM final_value) for per-campaign ROAS.
- PDF export button for full management pack distribution.

---

## 2026-04-29 — Campaign Dashboard: management chart view of 90-day Google Ads performance

### Built

**Campaign Dashboard — new tool at `/tools/campaign-dashboard`**
- `server/routes/dashboard.js` — new `GET /api/dashboard/campaign-performance?days=` endpoint. Calls 5 `GoogleAdsService` methods in parallel (`getCampaignPerformance`, `getDailyPerformance`, `getSearchTerms`, `getBudgetPacing`, `getImpressionShareByCampaign`) and returns all data in one JSON response. Auth-gated (`requireAuth`), no agent/MCP overhead.
- `client/src/pages/tools/CampaignDashboardPage.jsx` — management-ready single-page dashboard. No AI runs required — pure data visualisation.
- Registered in `client/src/config/tools.js` (Google Ads group, `ads_operator` + `org_admin`).
- Wired in `App.jsx` and `server/index.js`.

**Charts included:**
- 5 KPI tiles: total spend, total conversions, avg CPA, avg CTR, revenue context (~$50k/mo avg, 6.7× ROAS)
- Daily spend vs conversions trend (LineChart, 90-day overlay)
- Ad spend by campaign (horizontal BarChart, sorted spend desc)
- Conversions by campaign (horizontal BarChart)
- CPA by campaign (horizontal BarChart, worst first — flags high-cost campaigns)
- CTR by campaign (horizontal BarChart, lowest first — copy review targets)
- Impression share breakdown per campaign (grouped BarChart: IS%, lost-to-rank%, lost-to-budget%)
- Budget pacing current month (grouped BarChart: budget vs spent-to-date)
- Top 15 converting search terms (horizontal BarChart)
- Monthly spend vs $50k revenue benchmark (LineChart)

**Management context built in:**
- Context banner: AU small-population market, $7,500/mo spend, ~$50k/mo avg revenue, 6.7× ROAS
- Algorithm sensitivity note: explains why apparent loss-leaders are intentional — previous negative keyword / location tightening disrupted algorithmic trust and caused ~50% traffic loss

**Preset selector:** 30d / 60d / 90d (defaults 90d).

### Open / next
- Profitability Oracle (True ROAS) — cross-references CRM `final_value` with ad spend per campaign for actual revenue-based ROAS, not estimated.
- Consider PDF export button on campaign dashboard for management pack distribution.

---

## 2026-04-28 — Media Gen: fix reference image upload for image-to-video/image models

### Fixed / discovered
- Both `storage.fal.run` and `storage.fal.ai` fail DNS resolution on Railway — fal.ai's storage subdomain is unreachable from Railway's network.
- All image-to-video and image-to-image models were failing with `getaddrinfo ENOTFOUND` whenever a reference image was uploaded.
- Fix: removed `uploadToFalStorage()` entirely. Reference image is now converted to a base64 data URL locally and passed directly in the `image_url` payload field. Fal.ai models accept data URLs — no storage upload needed.
- `server/routes/mediaGen.js` — replaced multipart upload function with `imageToDataUrl(buffer, mimetype)`.

### Open / next
- Test image-to-video and image-to-image models end-to-end with reference image after Railway redeploy.

**Further fix (same session):** fal.ai models silently ignore base64 data URLs in `image_url` — generate from prompt only, image is discarded. Real fix: upload reference image to S3 via existing `StorageService`, pass 1-hour pre-signed URL. Fal.ai fetches it normally over HTTPS. Requires `AWS_S3_BUCKET` configured (env or Admin › Storage). `getImageUrl()` replaces `uploadToFalStorage()` and `imageToDataUrl()`. Commit `e45c3d2`.

---

## 2026-04-23 — Geo Heatmap: geographic lead intelligence map for DiamondPlate Data

### Built

**Geo Heatmap — new tab in DiamondPlate Data**
- New `geo-heatmap` agent (`server/agents/geoHeatmap/index.js`) — pre-fetch pattern (1 Claude call, `maxIterations: 1`).
- Fetches up to 3000 CRM enquiries via `wp_get_enquiries`; buckets into `notInterested` (reason_not_interested set) vs `active` (all other statuses).
- Geocodes unique suburb/postcode pairs via Nominatim (`nominatim.openstreetmap.org`) with 1 req/sec rate limiting.
- Geocode results cached in new `geocode_cache` table (idempotent migration in `db.js`). First run geocodes everything; subsequent runs serve from cache (near-instant).
- Returns `{ summary, data: { locations, notInterestedTotal, activeTotal, geocodedCount, skippedCount } }`.
- `server/agents/geoHeatmap/prompt.js` — geographic analysis prompt with `buildSystemPrompt(config)` / custom_prompt support.
- Route registered in `agents.js` as `/geo-heatmap`, `requiredPermission: 'org_member'`.
- `AgentConfigService.js`: AGENT_DEFAULTS, ADMIN_DEFAULTS (`max_tokens: 2048`, `max_task_budget_aud: 0.50`), AGENT_MODEL_REQUIREMENTS (standard tier).

**Geo Heatmap — client UI (`GeoHeatmapTab.jsx`)**
- New `client/src/pages/tools/DiamondPlate/GeoHeatmapTab.jsx` — Leaflet map with CircleMarkers.
- Packages: `leaflet@^1.9.4` + `react-leaflet@^5.0.0` (installed with `--legacy-peer-deps`).
- Toggle between Not Interested (red) / Active Leads (green) datasets. Marker radius = log-scaled by count (4–20px).
- Summary pills: totals + geocoded count. MapContainer centred on Australia (`-27, 133.8`, zoom 4).
- Tooltip per marker: suburb + postcode + count.
- AI observations rendered below map via `MarkdownRenderer`.
- Auto-loads most recent completed run on mount.
- New **Geo Map** tab added to `DiamondPlateDataPage.jsx` between Search Terms and Conversation.

### Open / next
- Ads Setup Architect: model resolution fix; AU market + negative keyword risk prompt; MCP Prompts wiring (separate entry below)

---

## 2026-04-23 — Ads Setup Architect: model resolution fix; AU market + negative keyword risk prompt; MCP Prompts wiring

### Fixed

**Model resolution bug — `index.js` ignored `context.adminConfig`**
- `index.js` was calling `AgentConfigService.getAdminConfig(TOOL_SLUG)` directly, bypassing the `context.adminConfig` that `createAgentRoute` already resolved (including org default fallback).
- Org default model was never applied. UI model selector was silently ignored (body.model never read).
- Fix: `adminConfig` now uses `context.adminConfig` when populated (canonical pattern); falls back to direct fetch only for scheduled runs. `model` resolves: `req.body.model` → `adminConfig.model` → `'claude-sonnet-4-6'`.
- `maxIterations` fallback corrected: 15 → 20 to match `AgentConfigService` registered default.

### Built

**Ads Setup Architect — Australian Market Constraint (prompt)**
- New `## Australian Market Constraint (CRITICAL)` section in `prompt.js`.
- AU ceramic/graphene search pool is niche and thin — keyword bloat dilutes signal and splits budget. Exact/Phrase match preferred over Broad. Every keyword recommendation must be backed by AU volume from `ads_generate_keyword_ideas`; zero/negligible volume = do not recommend.

**Ads Setup Architect — Negative Keyword Risk (prompt)**
- New `## Negative Keyword Risk (CRITICAL)` section in `prompt.js`.
- Documents the historical account lesson: a keyword added to the shared negative list caused ~50% traffic loss and significant CPC rise; performance did not fully recover on removal — weeks of re-learning.
- Rules baked in: cross-reference `ads_get_search_terms` before any negative recommendation; prefer campaign-level negatives over shared list; mandatory risk flag per recommendation.
- Operational Step 5 now explicitly calls `ads_get_search_terms` before the negative keyword section.
- New output section `### 6. Negative Keyword Recommendations (with risk flags)` — Term | Scope | Rationale | Risk Assessment per row.

**Ads Setup Architect — MCP Prompts support**
- `prompt.js` refactored: `buildSystemPrompt(config = {})` checks `config.custom_prompt?.trim()` — if set, uses Admin override; else uses built-in default. Exports `DEFAULT_PROMPT` for preview endpoint.
- `index.js` passes `adminConfig` to `buildSystemPrompt(adminConfig)`.
- `ads-setup-architect` registered in `AdminPromptsPage.jsx` AGENTS array — now visible and editable in Admin › MCP Prompts.

### Open / next
- Implement **Profitability Oracle (True ROAS)** agent within the suite.
- Develop **Radius Clustering** bidder using newly available postcode signals.
- Run first Ads Setup Architect blueprint against live AU competitors.
- MCP-SERVERS.md google-ads.js header says 11 tools but `server/CLAUDE.md` lists 15 — 4 undocumented tools pending full MCP-SERVERS.md entry: `ads_get_ad_group_performance`, `ads_get_search_terms_by_ad_group`, `ads_get_quality_scores`, `ads_get_negative_keywords`.

---

## 2026-04-23 — Profitability Suite: Ads Setup Architect; Live Verification Mandate; Model Selection UI

### Built

**Profitability Suite — Siloed Architecture**
- Created `server/agents/profitabilitySuite/` and `client/src/pages/profitabilitySuite/` directory silos.
- Purpose: high-level strategic Business Intelligence tools separate from daily monitoring.

**Ads Setup Architect Agent (`ads-setup-architect`)**
- Strategic agent that designs Google Ads structures (Campaigns, Ad Groups, Keywords, RSA Copy).
- Sequential tool chain: Competitor discovery → Keyword brainstorming → Live ad verification → CRM theme analysis → KB differentiator search.
- Hardcoded brand guardrails: 12-year warranty, CSIRO-tested formula, 9H+ hardness, pricing from $790/$990.
- Registered in `agents.js` and `AgentConfigService.js` (`max_iterations: 20`, `max_task_budget_aud: 3.00`).

**Live Verification Mandate (CRITICAL)**
- New `ads_get_ad_group_ads` and `ads_get_ad_asset_performance` tools added to `google-ads.js` MCP server.
- Mandatory verify instruction added to system prompts for **Ads Setup Architect** and **Conversation** agents.
- Logic: AI must call live tools to verify headlines/descriptions before confirming edits or proposing new ones; distinguishes from stale KB reports.

**Ads Setup Architect UI**
- Four-tab layout: Report / Conversation / History / Settings.
- **Discussion View:** Integrated `ConversationView` with "Discuss this report" seeder button.
- **Model Settings:** Dynamic dropdown for model selection defaulting to Org Default.
- **Expert Guidance:** "Pros & Cons" panels for Sonnet, Opus, GPT-4o, and Gemini based on strategic architecture performance.
- SSE progress logging with "Architecting..." state.
- TXT/PDF export for blueprints.

**WordPress CRM Enhancement — Geographic Data**
- `wp_get_enquiries` and `wp_get_enquiry_details` updated to include **postcode** and **suburb** ACF fields.
- Enables geographic clustering/radius analysis for the Australian market.

### Fixed / discovered
- `ads_get_ad_group_ads` return shape updated in `MCP-SERVERS.md` to reflect RSA nested structure.
- Resolved race condition in `AdsSetupArchitectPage` where model state initialized before admin config loaded.

### Open / next
- Implement **Profitability Oracle (True ROAS)** agent within the suite.
- Develop **Radius Clustering** bidder using newly available postcode signals.
- Run first Ads Setup Architect blueprint against live AU competitors.

---

## 2026-04-23 — Not Interested Report: negative keyword coverage analysis; AI session token savings

### Built

**Not Interested Report — negative keyword coverage**
- `ads_get_negative_keywords` added to Phase 2 parallel fetch in `notInterestedReport/index.js` — runs alongside existing 4 calls, zero extra latency
- Returns `{ sharedLists: { [listName]: [{ text, matchType }] }, campaignNegatives: [{ campaign, text, matchType }] }` — shared library lists + per-campaign negatives
- Graceful fallback: if MCP call errors, passes `{ sharedLists: {}, campaignNegatives: [] }` so Claude gets an explicit empty signal rather than crashing
- Prompt expanded from 2 questions → 3: new Q2 teaches Claude the data shape and asks for named gaps, not generic advice
- New `### Negative Keyword Coverage` output section: what's already blocked (by list name) + exact terms/patterns to add
- `### Where to act` expanded to 3 paragraphs: campaigns/match types · exact negative terms to add + shared vs campaign-specific · sales qualification
- Two new constraints: inference is indicative not definitive; empty negative lists → state it explicitly as the structural cause

**AI session token optimisation — memory and doc cleanup**
- `project_scaffold.md` memory deleted — 488 lines, 16 days stale, conflicted with `CLAUDE.md` (9 vs 15 google-ads tools). All content superseded by `CLAUDE.md`
- `feedback_read_docs_first.md` rewritten — mandatory reads now scoped by task type; `mcp_curamtools_prompts.md` explicitly excluded (historical setup prompts only); `DECISIONS.md` + `PLATFORM-PRIMITIVES.md` only required for new agents/platform primitives
- `server/CLAUDE.md` 985→925 lines — duplicate Data Privacy + CRM field exclusions sections removed (68 lines); unique info (API endpoints, bypass note, do-not list) merged into the first section
- Net saving: ~1,000+ tokens per session from eliminated mandatory reads; ~600 tokens from scaffold memory; ~90 tokens from CLAUDE.md dedup

### Fixed / discovered
- Nothing broken

### Open / next
- Run Not Interested Report to validate negative keyword data shape in live output
- Consider whether `wp_get_enquiry_details` should be added to fetch extended fields for wrong-products leads (package_type, final_value)

---

## 2026-04-22 — SQL Console NLP: multi-provider model routing; configurable prompt; reasoning model support

### Built

**SQL Console NLP — full multi-provider model routing (7-attempt fix)**

Root cause chain that took 7 attempts to fully resolve:
1. Route called `new Anthropic()` directly → fixed to `getProvider()`
2. `getDefaultModel()` ignored org default when not in `ai_models` → fixed fallback return
3. `getProvider()` called without `customProviders` → added `getCustomProviders(orgId)` load
4. Frontend `useEffect` fell back to first Claude model when org default not in `ai_models` → fixed initialization to use org default as-is
5. `AdminModelsPage.jsx` `<select>` restricted to `ai_models` silently overrode org default → changed to `<input list>` + `<datalist>`
6. Answer generation step still hardcoded to `claude-haiku-4-5-20251001` → fixed to use same `provider` + `modelDef.id`, wrapped in `try/catch`
7. `deepseek-reasoner` returned empty `content` (reasoning-only response) → `openai-compatible.js` `reasoning_content` fallback

**`server/platform/providers/openai-compatible.js` — reasoning model fix**
- `convertResponse` had truthy-check bug: `if (msg?.content)` silently dropped empty-string content
- Fixed: explicit `!= null && !== ''` check; falls back to `msg?.reasoning_content` if content is null/empty
- Affects all OpenAI-compatible providers: deepseek, openai, groq, mistral, xai
- `deepseek-reasoner` uses chain-of-thought — sometimes returns `content: null` with full answer in `reasoning_content`

**SQL Console NLP — schema context and cannotAnswer path**
- `max_tokens` bumped to 8192 (reasoning models use tokens for internal chain-of-thought before producing SQL)
- Prompt now explains this is platform admin DB only — WordPress CRM data (enquiries, leads) is NOT here
- If model cannot answer from schema: returns `-- CANNOT_ANSWER: <reason>` comment
- Route detects the pattern, returns `{ cannotAnswer: true, reason }` (HTTP 200, not error)
- Frontend: amber warning banner with "Use the Conversation Agent" guidance; error banner suppressed

**SQL NLP prompt — configurable via Admin › MCP Prompts**
- New `server/agents/sqlNlp/prompt.js` — `buildSystemPrompt(config)` returns `custom_prompt` if set, else built-in instructions
- `preview-prompt` endpoint picks it up automatically via kebab→camelCase slug convention (`sql-nlp` → `sqlNlp`)
- Route loads `AgentConfigService.getAdminConfig('sql-nlp')` and calls `buildSystemPrompt(config)` — schema + question always appended at runtime
- `sql-nlp` added to `AGENTS` array in `AdminPromptsPage.jsx` — now visible and editable in Admin › MCP Prompts

**`AdminModelsPage.jsx` — org default model field**
- Changed from `<select>` (restricted to `ai_models`) to `<input list>` + `<datalist>`
- Allows typing any model ID (e.g. `deepseek-reasoner`, `gpt-4o`) not present in `ai_models`
- Documented in `server/CLAUDE.md` as required pattern for org default model selector

**`docExtractor` — `customProviders` threading**
- `extractFromImage` and `runDocExtraction` both accept `customProviders = []`
- Route loads `getCustomProviders(orgId)` and passes through the call chain
- `getProvider(model, customProviders)` — never single-arg in a route context

**`server/CLAUDE.md` — model resolution documented**
- "Model resolution — server side" section: `createAgentRoute` pattern, non-agent routes pattern, helper-function agent pattern
- "Model selector — frontend pattern" section: `<input list>` rule, initialization rule, fallback option rule
- Two "Rules learned through pain" entries: `<select>`/`ai_models` silent override trap; single-arg `getProvider` trap

### Fixed / discovered

- `ai_models` is a display list, NOT the routing list. `providerRegistry.PROVIDERS` handles routing via hardcoded prefixes. A model routes correctly without being in `ai_models`. Any selector restricted to `ai_models` silently overrides custom org defaults.
- JS default parameters do not fire when the argument is `null` — only `undefined`. `adminConfig.max_tokens ?? 4096` is always correct; bare `adminConfig.max_tokens` passes `null` through.
- `deepseek-reasoner` with `max_tokens: 1024` exhausted the budget mid-reasoning — output was truncated to prose instead of SQL. 8192 gives sufficient headroom.
- Platform SQL console queries the **platform PostgreSQL DB** (organisations, users, agents, usage_logs, system_settings). WordPress CRM (enquiries, leads, bqq_posts) is MySQL-only, accessible via conversation agent MCP tools.

### Open / next

- `docExtractor` `logUsage` still passes `{ input, output }` only — should pass full `tokensUsed` with `cacheRead`/`cacheWrite`
- Gemini URL double-prefix bug in `providers/gemini.js` (stub — throws until implemented)
- `purpose` field not injected into doc extraction prompt (noted in CLAUDE.md as known gap)
- Phase 2.1 — tool grouping + cross-source routing guidance
- Phase 2.2 — resource permissions wired to access checks
- Phase 3.1 — MCP Prompts Primitive
- Phase 3.2 — Sampling implementation
- Phase 4.1 — parallel tool execution in AgentOrchestrator
- `not-interested-report` not yet run against live data

---

## 2026-04-21 — Token usage dashboard; UsageLogger cache token capture; caveman mode

### Built

**Token usage tracking — full pipeline**
- `usage_logs` extended: 3 new columns via idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `db.js` — `cache_read_tokens INTEGER DEFAULT 0`, `cache_creation_tokens INTEGER DEFAULT 0`, `cost_aud NUMERIC(10,6) DEFAULT 0`
- `UsageLogger.js` updated to persist all 4 token types (`input`, `output`, `cacheRead`, `cacheWrite` from `AgentOrchestrator.tokensUsed`) plus direct AUD cost — no change to callers in `createAgentRoute.js` or `conversation.js`
- `GET /admin/usage-stats?days=7|30|90` — new endpoint in `routes/admin.js`; returns: totals (runs, all token types, cost AUD, cache hit rate, estimated cache savings AUD), `by_model[]`, `by_tool[]`, `daily[]`. Cache savings estimated as `cache_read_tokens × ($3.00 − $0.30) / 1M × AUD_PER_USD`

**Admin › Token Usage page**
- `AdminUsagePage.jsx` — 4 summary cards (total cost AUD, total tokens, cache hit rate, est. savings), CSS bar chart for daily cost trend, by-model table, by-agent/tool table
- Period selector: 7d / 30d / 90d tab strip — re-fetches on change
- No new npm dependencies — pure CSS bars using `var(--color-primary)` and `var(--color-border)`
- Wired in `App.jsx` (`/admin/usage`) and `Sidebar.jsx` (between Diagnostics and Logs, `trending-up` icon, label "Token Usage")

**AI session setup — Caveman mode**
- This session used the **caveman Claude Code plugin** (full mode) — drops articles/filler, keeps all technical substance, ~75% token reduction
- Activate at session start: plugin auto-activates via `UserPromptSubmit` hook in `settings.json`
- Status badge in Claude Code statusline shows `[CAVEMAN]` when active
- To disable: type `stop caveman` or `normal mode` in the prompt

### Fixed / discovered
- Historical `usage_logs` rows will show `0` for cache token columns and `cost_aud` — only runs after this deployment are fully populated. `cost_usd` is the reliable historical cost field.
- `logUsage` already received `cacheRead`/`cacheWrite` in `tokensUsed` from the orchestrator — they were captured but never stored. No orchestrator changes needed.

### Open / next
- `docExtractor` route calls `logUsage` with `{ input, output }` only — should pass full `tokensUsed` object (noted in 2026-04-18 open items too)
- `usage_logs` `cost_usd` column is now redundant with `cost_aud` — could be cleaned up later, but harmless to keep
- Daily chart timezone is hardcoded to `Australia/Brisbane` — acceptable for single-org deployment

---

## 2026-04-21 — Token usage warnings; proactive cost and health alerts on usage page

### Built

**`GET /admin/usage-warnings` endpoint**
- 8 parallel queries, 6 independent warning checks, returns `{ warnings: [{ type, severity, title, detail }] }`
- Severity levels: `critical` (red), `warning` (amber), `info` (blue)

| Check | Logic | Severity |
|---|---|---|
| Budget pace | 7-day avg daily spend ≥ 80% / 100% of `max_daily_org_budget_aud` | warning / critical |
| Agent over budget | Per-slug avg run cost ≥ 90% of agent's `max_task_budget_aud` (from `getAdminConfig`) | warning / critical |
| Cache health | Cache hit rate < 15% over last 7 days (min 5 runs to avoid noise) | warning |
| Cost spike | Yesterday's spend > 2.5× 30-day daily average | warning |
| Stale agents | Ran in last 14 days but not last 3 days | info |
| Overkill model | Model tier > agent's declared tier in `AGENT_MODEL_REQUIREMENTS` | info |

- Agent over budget uses `Promise.all` across unique slugs — N parallel `getAdminConfig` calls, not N sequential
- Overkill model check uses `ai_models` from `system_settings` (with `MODEL_DEFAULTS` fallback) for model tier lookup; cross-referenced against `AGENT_MODEL_REQUIREMENTS` exported from `AgentConfigService`

**`AdminUsagePage.jsx` — warnings display**
- Both `usage-stats` and `usage-warnings` fetched in a single `Promise.all` on load and period change
- Colour-coded banners rendered above stat cards: red (critical), amber (warning), blue (info)
- Non-dismissable — persist until the underlying condition clears

### Fixed / discovered
- Budget pace warning skipped when `max_daily_org_budget_aud` is `null` (unlimited) — no false positives for orgs without a budget set
- Stale agent check uses 14-day look-back (not 30-day) to avoid flagging agents that are intentionally infrequent

### Open / next
- All open items from prior session carry forward
- Budget pace warning has no monthly projection — only compares against daily limit; a `max_monthly_budget_aud` field would enable richer projection (not yet in schema)

---

## 2026-04-21 — Prompt cache keep-warm; ConversationView 270s interval

### Built

**`POST /api/conversation/keep-warm`** (`routes/conversation.js`)
- Loads the same `agentConfig` + `adminConfig` as a real conversation turn
- Builds system prompt via `buildSystemPrompt(agentConfig, monitorConfig)` — exact same token sequence
- Strips `execute`/`requiredPermissions`/`toolSlug`/`cacheable` from tools (mirrors `AgentOrchestrator`)
- Calls `provider.chat({ max_tokens: 1, system, tools, messages: [{ role: 'user', content: 'ping' }] })`
- `anthropic.js` provider adds `cache_control: { type: 'ephemeral' }` to system prompt and last tool automatically — cache key matches real calls exactly
- Returns `{ ok, cacheRead, cacheWrite }`, logs to console, **not** written to `usage_logs`
- Cost per ping: ~$0.002 AUD (cache read); ~$0.025 AUD on first call (cache write)

**`ConversationView.jsx` — keep-warm interval**
- `useEffect` with empty deps: `setInterval(270_000)` fires every 4.5 min while view is mounted
- Calls `api.post('/conversation/keep-warm', {})` — silent failure (`.catch(() => {})`)
- `clearInterval` on unmount — stops when user navigates away

**Documentation**
- `setup.md` — new "Prompt Cache Keep-Warm" section: cost breakdown, what's cached, pattern for new agents
- `server/CLAUDE.md` — keep-warm note added to prompt caching section

### Fixed / discovered
- Cache key depends on exact token sequence — keep-warm MUST use same `buildSystemPrompt()` call, same tools array, same `cache_control` placement. Anything different = separate cache entry = no benefit.
- `POST /keep-warm` placed after all `POST /:id/*` routes — no Express route conflict (different literal paths)

### Open / next
- Keep-warm only covers the conversation agent — other agents with ReAct loops (high-intent-advisor) could benefit but are not frequently used interactively

---

## 2026-04-21 — Claude Sessions page; 5-hour and weekly usage window gauges

### Built

**`/admin/claude-sessions`** — new admin page ("Claude Sessions", clock icon in sidebar)
- Two SVG donut gauges, purely client-side time math, auto-refresh every 30s
- **5-hour wheel**: `(now − daily_start_time) / 300min` → shows minutes remaining + reset time (e.g. "42m remaining · Resets at 11:00am")
- **Weekly wheel**: ISO week progress Mon→Sun → shows day N of 7 + days remaining
- Gauge colours: green < 65%, amber 65–85%, red > 85%
- Info cards explain 5-hour vs weekly cap mechanics; `/usage` terminal command referenced

**Settings**
- Configurable daily start time (time picker, default 06:00)
- Stored in `system_settings` key `claude_session_config` — `{ daily_start: 'HH:MM' }`
- Changing the time picker updates gauges live before saving
- `GET/PUT /admin/claude-session-config` routes in `admin.js`

**Timezone removed**
- `timezone` field was added to config then removed — browser `new Date()` already uses local time; explicit timezone config was unused and misleading

### Fixed / discovered
- Gauges are 100% client-side — no server involvement at runtime. Server only stores the configured start time.
- Weekly gauge uses ISO week (Mon = day 1). Anthropic's actual weekly reset day is unknown — this is a reasonable approximation.

### Fixed / discovered (follow-up)
- **Window chaining bug** — original implementation only tracked the first 5-hour window of the day. After 11am the gauge showed 100% and stayed there. Fixed: `Math.floor(elapsed / windowMs)` finds the current window index; windows chain indefinitely (6am→11am→4pm→9pm→…). At 6:15pm with 6am start: window 3, 4pm→9pm, 45% used, "2h 45m remaining".
- `fmt12()` refactored to accept a `Date` object (avoids manual hour arithmetic that broke across midnight)
- `fmtDuration()` helper added — shows `2h 45m` for durations ≥ 60 min instead of `165m`

### Open / next
- Actual Claude Code weekly reset day may not align with Monday — configurable via settings (see follow-up entry below)

---

## 2026-04-21 — Claude Sessions: configurable weekly reset day

### Built

**Configurable `weekly_start_day`** — Claude Sessions page
- `CLAUDE_SESSION_DEFAULTS` in `admin.js` updated: `{ daily_start: '06:00', weekly_start_day: 1 }` (1 = Monday)
- PUT route validates `weekly_start_day` is a number (0–6) when present
- `computeWindows(cfg)` refactored: accepts full config object `{ daily_start, weekly_start_day }` — previously accepted a bare string which broke the weekly day lookup
- `AdminClaudeSessionPage.jsx` updated:
  - `weeklyDay` state (default 1) populated from loaded config
  - `livePreview(start, day)` helper — updates gauges immediately on any input change
  - Day-of-week `<select>` dropdown added to settings form (Sun–Sat, 0–6)
  - Save payload now includes `weekly_start_day`
  - All `computeWindows` call sites pass full config object

### Fixed / discovered
- `parseHHMM` was receiving the full config object instead of the time string after the signature change — fixed by extracting `cfg.daily_start` inside `computeWindows` before calling `parseHHMM`

### Open / next
- All prior open items carry forward

---

## 2026-04-21 — Not Interested Report agent; platform pattern corrections; session-start guardrail update

### Built

**Not Interested Report agent (`not-interested-report`)**
- Pre-fetch architecture — fetches all data in Node.js, passes to Claude in one call, no ReAct loop
- Data sources: `wp_get_not_interested_reasons` (all-time CRM data), `wp_get_progress_details` (filtered in Node.js to not-interested lead IDs only), `ads_get_search_terms` + `ads_get_active_keywords` + `ads_get_campaign_performance` (90-day window)
- CRM privacy applied pre-AI via `AgentConfigService.getCrmPrivacySettings()` — field exclusions stripped from records before they reach the prompt
- Prompt structured around two diagnostic lenses per reason category: Ads Signal (which campaigns/keywords are producing wrong-fit leads) and Sales Signal (what the call notes reveal about rep qualification behaviour)
- Output is prose analysis with a "Where to act" close — one paragraph for marketing, one for sales
- `AgentConfigService` defaults: `max_tokens: 6000`, `max_task_budget_aud: 2.00`, standard tier
- Route registered in `agents.js` via `createAgentRoute`, `org_admin` only, on-demand (no cron)
- UI: `NotInterestedReportPage.jsx` — Run button, SSE progress log, `MarkdownRenderer` output, history sidebar, PDF export
- Wired in `App.jsx` and `client/src/config/tools.js`

**`auto-agent-instructions.txt` — mandatory reference read rule added**
- Before writing any new agent: read `adsAttributionSummary/index.js` (canonical pre-fetch pattern)
- Before writing any new frontend page: read `DiamondPlateDataPage.jsx` and `client/src/api/client.js`
- Four specific rules added covering the pattern failures found this session (see below)

### Fixed / discovered

Four deviations from established platform patterns were introduced and then corrected during this session. They are documented here so the pattern is explicit.

**1. Raw `fetch` used instead of `api.stream()` (auth failure)**
- Root cause: wrote a raw `fetch()` with `credentials: 'include'` for the SSE run endpoint. This project uses Bearer tokens, not cookies. `api.stream()` in `client/src/api/client.js` reads the token from `useAuthStore` and attaches it as `Authorization: Bearer`.
- Symptom: `{"error":"Authentication required."}` immediately on run.
- Fix: replace raw `fetch` with `api.stream('/agents/not-interested-report/run', {})`.
- Rule: `client/src/api/client.js` line 6 states explicitly — "Never use raw fetch('/api/...') for authenticated endpoints."

**2. `api.get()` result read as `res.data` (history never loaded)**
- Root cause: assumed Axios-style `{ data: [] }` response shape. `api.get()` calls `res.json()` and returns the parsed body directly — there is no wrapper object.
- Symptom: history silently returned an empty array; `res.data` was `undefined`.
- Fix: `const rows = (await api.get(...)) ?? []`.

**3. SSE history row read as `run.summary` instead of `run.result?.summary`**
- Root cause: history endpoint returns `agent_runs` rows where the full result JSONB is in the `result` column. Summary is `run.result?.summary`, not a top-level field.
- Fix: updated history display, run selection, and initial load to use `run.result?.summary`.

**4. Status comparison `=== 'success'` instead of `=== 'complete'`**
- Root cause: `persistRun()` saves `status: 'complete'` on success. Comparison against `'success'` meant the status badge never showed the green success colour.
- Fix: changed condition to `run.status === 'complete'`.

**5. Missing `startDate`/`endDate` in `agentOrchestrator.run()` context spread**
- Root cause: all other pre-fetch agents spread `{ ...context, startDate, endDate, toolSlug, customerId }` — these fields are present in every reference implementation. New agent omitted them.
- Fix: added `startDate` and `endDate` to the context spread.

### Open / next

- MCP-SERVERS.md `platform.js` table still missing `get_pending_suggestions`, `update_suggestion_outcome`, and `get_suggestion_history` — carry-over from 2026-04-19
- `not-interested-report` has not been run against live data yet — first run will reveal whether `wp_get_progress_details` returns sufficient note coverage for the not-interested lead IDs
- `entry_date` in progress notes is known-unreliable (ACF UI bug) — prompt instructs Claude not to use it for timing analysis; verify this guidance holds in practice
- AgentScheduler cron not registered — this report is on-demand only by design

---

## 2026-04-16 — Media Generator: Save to S3 + cost estimation; Admin Providers fix

### Built

**Media Generator — Save to S3**
- New `POST /api/media-gen/runs/:id/save-to-s3` route: fetches video/image bytes from Fal.ai CDN via `https.request`, uploads to S3 using `StorageService.put`, writes `storage_key` back to the run row. Idempotent — returns cached key on repeat calls.
- New `GET /api/media-gen/runs/:id/download-url` route: generates a 1-hour pre-signed S3 URL for saved media.
- DB migration: `ALTER TABLE media_gen_runs ADD COLUMN IF NOT EXISTS storage_key TEXT`.
- Uses org-level `storage_settings` (bucket/region) with env var fallback (`AWS_S3_BUCKET`, `AWS_S3_REGION`). All four AWS env vars confirmed set in Railway.

**Media Generator — Cost estimation**
- Added `FAL_COST_PER_UNIT` lookup table in `server/routes/mediaGen.js` — price per second (video) or per image (image models) for all default models.
- `estimateCost(modelId, outputType, duration)` called at job completion; result saved as `cost_usd NUMERIC(10,4)` on the run row.
- DB migration: `ALTER TABLE media_gen_runs ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10,4)`.
- Cost included in the SSE `complete` event (`costUsd` field) and in the `GET /runs` history response.

**Media Generator — UI**
- Result panel: amber `~$0.20` cost badge; "Save to S3" button with loading/saved states.
- History table: new "Cost" column; compact "S3" button per completed row; "✓ S3" indicator once saved.

**Admin Providers — apiKeyEnv editable for built-ins + Test button fix**
- `apiKeyEnv` field is now editable in the edit form for built-in providers (Anthropic, Google, etc.).
- Test button no longer disabled when `!p.configured` — always enabled (only disabled while a test is in progress).
- `GET /admin/model-status` already re-checks `configured` using the custom `apiKeyEnv` when a builtin override is saved.

**Documentation system**
- Created 7 new root-level documentation files: `META.md`, `INTENT.md`, `SOUL.md`, `GUARDRAILS.md`, `MEMORY.md`, `PERSONA.md`, `DATABASE.md`.
- Merged missing content from `server/CLAUDE.md` into the new system: PII/data privacy (GUARDRAILS), PDF export rule (GUARDRAILS), pre-fetch vs ReAct principle (SOUL), JSDoc/backtick/null/updated_by/JSON-parsing/image-dimensions/Ghostscript gotchas (MEMORY), `updated_by` FK note (DATABASE), tool tables for `doc_extraction_runs` and `media_gen_runs` (DATABASE).
- Created `MCP-SERVERS.md` — full tool inventory (source of truth for all 6 MCP servers, 32 tools).
- Created `CHANGELOG.md` (this file).

### Fixed / discovered
- Fal.ai CDN URLs are direct HTTPS — no redirect handling needed for the S3 save fetch.
- `result` JSONB column returns as a parsed JS object from `pg` — `run.result?.video?.url` works directly in Node route handlers without `JSON.parse`.

### Open / next
- `CRON.md` not yet created — scheduled jobs (google-ads-monitor at 06:00/18:00 AEST) not yet documented.
- `ROI.md` not yet created — cost model and budget thresholds not yet documented.
- Media Generator: Fal.ai URLs on some models may expire before user clicks "Save to S3" — unknown TTL; test in production.
- `server/CLAUDE.md` is now superseded by the new documentation system but has not been deleted — confirm before removing.

---

## 2026-04-19 — High Intent Advisor: user feedback capture + suggestion history tool

### Built

**DB migration**
- `ALTER TABLE agent_suggestions ADD COLUMN IF NOT EXISTS user_action TEXT` — what action the user took when marking acted on
- `ALTER TABLE agent_suggestions ADD COLUMN IF NOT EXISTS user_reason TEXT` — why the user dismissed a suggestion

**Platform MCP server — 1 new tool (v1.2.0)**
- `get_suggestion_history` — returns full suggestion history for the org (all statuses), ordered by created_at DESC, limit 100 default cap 200. `cacheable: false`. Returns `user_action, user_reason, outcome_notes, outcome_metrics, baseline_metrics, created_at, acted_on_at, reviewed_at` plus category/priority/suggestion_text/rationale/status.

**Agent tools.js — 14 → 15 tools**
- Added `getSuggestionHistoryTool` wrapping `get_suggestion_history`. `cacheable: false`. Injected `org_id` from `context.orgId` — not exposed to LLM.

**PATCH route extended**
- `PATCH /api/agents/high-intent-advisor/suggestions/:id` now accepts and writes `user_action` and `user_reason` via COALESCE SQL. Org validation unchanged.

**UI — HighIntentAdvisorPage.jsx**
- "Mark acted on" flow: now expands inline (like dismiss) with a textarea "What action did you take?" and Confirm/Cancel buttons. PATCH sends `{ status: 'acted_on', acted_on_at, user_action }`.
- Dismiss flow: textarea now captures `user_reason` ("Why are you dismissing this?"). PATCH sends `{ status: 'dismissed', user_reason }`.
- Both flows remove the card from the active list on success and show a toast.

**prompt.js — Phase 1 updated**
- Added step 4: call `get_suggestion_history` to review full history across all statuses
- After completing steps 1–4, agent writes a **Response Pattern Summary** paragraph (outside `<suggestion>` tags) covering: highest confidence intervention type, active constraints from dismissal reasons, calibration note for suggestion types that haven't moved metrics. Stored in `agent_runs.result` for future retrieval via `get_report_history`.

### Open / next
- MCP-SERVERS.md platform table still missing `get_pending_suggestions`, `update_suggestion_outcome`, and now `get_suggestion_history` — update next session
- AgentScheduler cron registration (`0 7 * * *`) — add after manual QA confirms output quality
- History tab could show `user_action` and `user_reason` columns — deferred

---

## 2026-04-19 — High Intent Advisor agent + suggestions UI

### Built

**DB migration**
- `agent_suggestions` table with `id, org_id, run_id, slug, category, priority, suggestion_text, rationale, status, baseline_metrics, outcome_metrics, outcome_notes, acted_on_at, reviewed_at, created_at`
- Indexes: `idx_agent_suggestions_org_status` (org_id, status, created_at DESC), `idx_agent_suggestions_run` (run_id)

**Platform MCP server — 2 new tools (v1.1.0)**
- `get_pending_suggestions` — returns pending/monitoring suggestions for the org ordered by priority
- `update_suggestion_outcome` — updates outcome_metrics, outcome_notes, reviewed_at, and optionally status; org_id validated server-side

**Agent: `server/agents/highIntentAdvisor/`**
- `tools.js` — 14 tools: 5 Ads, 3 GA4, 2 WordPress CRM, 4 Platform/KB. `get_search_terms`, `get_budget_pacing`, `get_paid_bounced_sessions`, `get_enquiries`, `get_pending_suggestions`, `update_suggestion_outcome` all marked `cacheable: false`
- `prompt.js` — three-phase system prompt: Phase 1 reviews prior suggestions via `get_pending_suggestions` + `update_suggestion_outcome`; Phase 2 gathers data across all sources; Phase 3 generates 3–7 suggestions in `<suggestion>` tag format
- `index.js` — parses `<suggestion>` blocks from agent output, validates category/priority, INSERTs to `agent_suggestions`; emits phase boundary progress; returns plain-text summary

**Route registration (`server/routes/agents.js`)**
- `POST /api/agents/high-intent-advisor/run` via `createAgentRoute` (org_admin only)
- `GET /api/agents/high-intent-advisor/suggestions` — pending/monitoring, priority-ordered
- `GET /api/agents/high-intent-advisor/suggestions/history` — acted_on/dismissed, limit 50
- `PATCH /api/agents/high-intent-advisor/suggestions/:id` — status, outcome_notes, acted_on_at; org_id validated
- AgentScheduler cron registration deferred to after manual QA

**AgentConfigService**
- AGENT_DEFAULTS: `high-intent-advisor` — schedule `0 7 * * *` (inactive until cron registered)
- ADMIN_DEFAULTS: enabled, max_tokens 4096, max_iterations 25, max_task_budget_aud 3.00, maxTokensHardLimit 6000
- AGENT_MODEL_REQUIREMENTS: advanced tier

**UI: `client/src/pages/tools/HighIntentAdvisorPage.jsx`**
- Two tabs: Active Suggestions (grouped by priority with red/amber/grey dots) and Suggestion History (table)
- Suggestion cards: category pill, priority dot, date, suggestion text, rationale, baseline_metrics row, outcome_notes
- Inline dismiss with optional note textarea (no modal) + Mark acted on button
- Run Advisor button — SSE stream with progress log, toast on completion
- EmptyState for zero suggestions

**App registration**
- Route: `/tools/high-intent-advisor`
- `tools.js` entry: org_admin only, icon: target
- `api/client.js`: added `api.patch()` method (was missing)

### Deferred
- AgentScheduler cron registration (`0 7 * * *`) — add after manual QA confirms output quality
- MCP-SERVERS.md not updated this session (add `get_pending_suggestions` and `update_suggestion_outcome` to the platform table next session)

### What to test
1. Server starts cleanly — `agent_suggestions` table present
2. `POST /api/agents/high-intent-advisor/run` returns SSE stream; agent completes all three phases
3. At least one `<suggestion>` row written to `agent_suggestions` after first run
4. `GET /api/agents/high-intent-advisor/suggestions` returns the suggestion
5. `/tools/high-intent-advisor` renders with Active Suggestions visible
6. Mark acted on → row moves to history tab
7. Dismiss (with and without note) → row moves to history tab
8. Check baseline_metrics in suggestion cards contain meaningful numeric values
9. Check outcome_notes from Phase 1 are coherent once there are prior suggestions

---

## 2026-04-18 — Code audit + session-scoped tool result cache

### Built

**Session-scoped tool result cache in AgentOrchestrator**
- Added module-level `sessionCache: Map(sessionKey → Map(cacheKey → { result, timestamp }))` in `AgentOrchestrator.js`
- Cache key: `orgId:userId` (per-user, cross-turn within TTL)
- Entry key: `toolName:JSON(input)` — different inputs get separate entries
- TTL: 5 minutes (matches Anthropic prompt cache window)
- Eviction: `setInterval` every 5 min purges expired entries and removes empty session Maps; `.unref()` ensures it won't block process exit
- Error results (`result?.error`) are never cached — failed tool calls always re-run
- `cacheable` field on tool definitions controls opt-out (`cacheable: false` on `getBudgetPacingTool`)
- `cacheable` stripped from provider schema alongside `execute`, `requiredPermissions`, `toolSlug`
- Cache hits: `onStep` callback skipped (no "Running…" noise), `fromCache: true` stored in trace
- Verified correct with `console.info '[AgentOrchestrator] cache hit'` log

**`getBudgetPacingTool` marked non-cacheable**
- Added `cacheable: false` to `getBudgetPacingTool` in `googleAdsConversation/tools.js`
- Reason: returns today's live spend — a 5-min-old result could cause incorrect budget decisions

### Fixed / discovered

**Code audit of recent AI provider commits**
- `ca363ad` (`Minimal AI provider fixes`) reviewed: `anthropic.js` system prompt changes are correct and safe — string path is functionally identical to the old one-liner; array handling is defensive and never triggered by current callers
- Commit message inaccuracy: `ca363ad` claims "Added model mapping for deprecated models (gemini-2.0-flash → gemini-2.0-flash-exp)" — no such mapping exists in the committed files
- Gemini URL bug identified: `ca363ad` kept `providerRegistry.js` change (`'models/gemini-'` prefix) but reverted the matching `gemini.js` fix, leaving the URL builder as `/v1beta/models/${model}:generateContent`. A `models/gemini-*` model ID would produce a double-prefixed, URL-encoded path (`/v1beta/models/models%2Fgemini-...`). Not applied yet — Gemini is a stub in this deployment

### Open / next
- Apply Gemini URL fix: `const modelPath = model.startsWith('models/') ? model : \`models/${model}\``; use `modelPath` in the `httpsPost` call in `gemini.js` — needed before Gemini is activated
- `logUsage` in docExtractor only passes `{ input, output }` — missing `cacheRead`/`cacheWrite` in `usage_logs` DB record (cost tracking is still correct; breakdown is incomplete)

---

## 2026-04-17 — MCP Resource Support: Phase 1.2-1.3 Complete

### Built

**Phase 1.2: Basic MCP Resources Implementation**
- Updated Google Ads MCP server (`google-ads.js`) with 3 resources:
  - `google-ads://campaigns/current` - Active campaigns with performance metrics
  - `google-ads://keywords/top-performing` - Top converting keywords
  - `google-ads://budget/pacing-summary` - Budget pacing status
- Updated WordPress MCP server (`wordpress.js`) with 3 resources:
  - `wordpress://enquiries/recent` - Recent enquiries with attribution
  - `wordpress://enquiries/device-breakdown` - Device type analysis
  - `wordpress://enquiries/utm-sources` - Top UTM sources
- Both servers now advertise resources capability in `initialize` response
- Resource handlers reuse existing tool functionality for consistency
- Updated server versions: Google Ads v1.1.0, WordPress v2.1.0

**Phase 1.3: Resource Discovery UI**
- Added backend API endpoints:
  - `GET /api/admin/mcp-servers/:id/resources` - Discover resources from connected server
  - `POST /api/admin/mcp-servers/:id/resources/read` - Read resource content
- Enhanced Admin MCP Servers page with "Resources" button
- Created `ResourceViewer` component for displaying and reading resources
- Enhanced Admin MCP Resources page with "Discover resources" button
- Added modal for bulk resource discovery with one-click registration
- Resource content viewing with JSON formatting and MIME type display

**Documentation Updates**
- Updated `MCP-SERVERS.md` with resource documentation tables
- Created `test-mcp-resources.js` for testing resource support
- Updated `CHANGELOG.md` with comprehensive session summary

### Fixed / discovered
- MCP protocol requires proper `capabilities.resources` advertisement in `initialize`
- Resource URIs should follow consistent pattern: `{server}://{category}/{name}`
- Backend auto-connects to servers if not already connected for resource discovery
- Frontend handles servers without resource support gracefully

### Open / next
- **Phase 1.4: Resource Integration in Agent Tools** - Update agent tools to use resources
- Add resource references in tool descriptions
- Implement resource-based prompts for AI agents
- Create resource usage analytics
- Test resource discovery with actual connected servers
- Consider automatic resource registration on discovery..
