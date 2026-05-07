# CHANGELOG.md

**Project Context:** Internal learning project for one organisation, solo developer. See [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md).

> **Primary reader:** AI + human. Read the last 2–3 entries at session start to understand current state.
> **Update trigger:** Every session. Add an entry before closing.
> **Format:** Date · What was built · What broke/was fixed · What's next.

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

## 2026-05-08 — Knowledge base creation + DeepSeek Bayesian Prior protocol

### Built
- **`knowledge_base/`** — full documentation directory structure with 10 files across 5 subdirectories:
  - `core/` — PROJECT_IDENTITY.md, SETUP.md, CHANGELOG.md, PROMPTS.md
  - `architecture/` — PLATFORM_PRIMITIVES.md, MCP_SERVERS.md
  - `agents/` — AGENTS_INDEX.md (catalog of all 6 agents)
  - `decisions/` — DECISIONS.md (30+ architectural decisions)
  - `ops/` — DEPLOYMENT.md
- **`server/CLAUDE.md`** — appended `[DEEPSEEK_OVERRIDE]` section with Search-Verify-Update protocol and Bayesian Prior Interpretation, mapping each knowledge_base file to Bayesian concepts

### Fixed / discovered
- INDEX.md updated to reference the new knowledge approach and CLAUDE.md as the primary guardrail file
- CHANGELOG.md updated with this entry

### Open / next
- Write individual agent docs (google-ads-monitor, high-intent-advisor, etc.)
- Write DATABASE_SCHEMA.md, CRON.md, ENVIRONMENT.md
- Move raw data files to raw_data/
- Update root-level .md files to reference knowledge_base/INDEX.md

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
- `server/platform/toolSchemas.js` — pure validator functions for the three most-used tool result shapes: `get_campaign_performance` (CTR ∈ [0,1], cost ≥ 0, conversions ≥ 0, clicks ≤ impressions), `get_daily