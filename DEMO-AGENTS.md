# DEMO-AGENTS.md

Reference for building demo agents on the MCP CuramTools platform.
Read this before adding a second demo agent. Companion to DECISIONS.md (Demo Layer) and PLATFORM-PRIMITIVES.md.

---

## What a demo agent is

A demo agent serves an external client org (`org_type = 'demo'`). It uses the same `createAgentRoute` / `AgentOrchestrator` infrastructure as internal agents but:

- Lives under `server/agents/demoSuite/<slug>/` (or single file `demoSuite/<slug>.js`)
- Is registered in `DEMO_CATALOG` (`server/demo/demoCatalog.js`) — code-only, not DB
- Is assigned to a client org via `org_agent_manifest` (DB row, not code)
- Renders in `DemoShell` + `DemoSidebar`, not `AppShell` + `Sidebar`
- Routes at `client/src/pages/demo/<ComponentName>.jsx` → `/demo/run/<slug-suffix>`

Internal agents and demo agents share: auth, org scoping, budget enforcement, usage logging, PDF export, extraction privacy, `agent_runs` table, and `createAgentRoute`.

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

## Reference implementation — document-analyzer

**Slug:** `demo-document-analyzer`
**Pattern:** Single-file agent, no ReAct loop, one Claude call, deterministic rules post-AI.

### Files

| File | Role |
|---|---|
| `server/agents/demoSuite/documentAnalyzer.js` | Agent runFn — all logic in one file |
| `server/demo/demoCatalog.js` | Catalog entry (name, description, icon, category, pattern) |
| `server/platform/AgentConfigService.js` | `AGENT_DEFAULTS` + `ADMIN_DEFAULTS` entries |
| `server/routes/agents.js` | `createAgentRoute` registration |
| `server/routes/demo.js` | HITL review endpoints (runs list, run detail, PATCH review) |
| `client/src/pages/demo/DocumentAnalyzer.jsx` | Full UI — upload, stream, review, trace, certificate |
| `client/src/App.jsx` | Route: `/demo/run/document-analyzer` |

### Two-stage analysis pattern

**Stage 1 (deterministic):** Rule engine runs in Node.js on text extracted by Claude. Confidence always `1.0`. Flags exact regex matches.

**Stage 2 (probabilistic):** Claude returns `findings[]` alongside `extracted_text`. Confidence `0.0–1.0` from Claude's self-report. Flags patterns that need context to interpret.

**Implementation order:** Claude call first (extracts text + probabilistic findings) → deterministic rules run on `extracted_text` in Node.js. UI and trace present them as Stage 1 (deterministic) then Stage 2 (probabilistic) — logical order, not execution order.

**Cross-stage overlap:** After both stages run, compare `finding_id` / `clause` across arrays. Set `also_flagged_deterministic` / `also_flagged_probabilistic` flags. Overlapping findings require a comment before approval (enforced server-side in the PATCH endpoint).

### File upload — base64 JSON body

Client uses `FileReader.readAsDataURL`, strips the `data:...;base64,` prefix, sends:
```json
{ "fileData": "<base64>", "mimeType": "application/pdf", "fileName": "contract.pdf" }
```
No multer. Works within `createAgentRoute`'s body parser limit. Max enforced client-side: 10 MB.

### PDF rasterisation

Mirrors `docExtractor` exactly — call Ghostscript (`gs`) directly via `execFileAsync`. Never use pdf2pic (unreliable in Docker/Alpine). See CLAUDE.md — "Do not use pdf2pic" rule.

```js
const outPattern = path.join(tmpDir, 'page_%04d.png');
await execFileAsync('gs', ['-dBATCH', '-dNOPAUSE', '-sDEVICE=png16m', `-r${dpi}`,
  `-sOutputFile=${outPattern}`, pdfPath]);
```

Cap pages to `MAX_PDF_PAGES = 8`. Check PNG dimensions before sending to Anthropic — max 7900px on any dimension. Re-render at scaled DPI if exceeded.

### AgentConfigService entries

```js
// AGENT_DEFAULTS (no operator settings for demo agents)
'demo-document-analyzer': {}

// ADMIN_DEFAULTS — before _platform sentinel
'demo-document-analyzer': {
  enabled: true,
  model: null,          // uses org default
  max_tokens: 8192,     // needed for extracted_text in Claude response
  max_task_budget_aud: 1.00,
  fallback_model: null,
}
```

`max_tokens: 8192` — the extracted_text field can be large. Do not use 4096 default.

### HITL review flow

Findings stored in `agent_runs.result.data`:
```json
{
  "all_findings": [...],
  "deterministic_findings": [...],
  "probabilistic_findings": [...],
  "pending_review_count": 3,
  "trace": [...]
}
```

Review state updated via `PATCH /api/demo/runs/:runId/review/:findingId` in `demo.js`. Uses `jsonb_set(result, '{data}', ...)` — no separate table. Syncs the same finding across all three arrays atomically in one DB write.

**Enforcement rules (server-side):**
- `status` must be `approved | rejected | resubmit`
- Low confidence (`< 0.7`) + `approved` with no comment → 422
- Cross-stage overlap + `approved` with no comment → 422

**runId acquisition:** `createAgentRoute` SSE result does not include `runId`. After SSE completes, client fetches `GET /api/demo/runs?slug=demo-document-analyzer&limit=1` to get the latest run's ID.

### Decision trace

`result.data.trace[]` — each entry appended, never mutated. Entry types:

| step | When appended |
|---|---|
| `input_sanitisation` | After injection scan, before Claude call |
| `deterministic_rules` | After deterministic stage |
| `probabilistic_analysis` | After Claude call (finding count, model, tokens) |
| `review_action` | Each PATCH review — includes `finding_id`, `decision`, `reviewed_by`, `comment` |

### Compliance certificate

Built client-side as HTML string (`buildCertificateHtml`), exported via `exportPdf` (platform PDF service). Gated on `pending_review_count === 0`. Certificate is ephemeral — regenerated on each export, never stored.

```js
import { exportPdf } from '../../utils/exportService';
await exportPdf({ content: html, contentType: 'html', title: '...', filename: '...' });
```

---

## Adding a second demo agent — checklist

1. **`server/agents/demoSuite/<slug>.js`** — write `runFn`, export `{ runFn, TOOL_SLUG }`
2. **`server/demo/demoCatalog.js`** — add catalog entry: `name`, `description`, `icon`, `category`, `pattern`
3. **`server/platform/AgentConfigService.js`** — add to `AGENT_DEFAULTS` and `ADMIN_DEFAULTS`
4. **`server/routes/agents.js`** — register with `createAgentRoute`
5. **`client/src/pages/demo/<Page>.jsx`** — build UI
6. **`client/src/App.jsx`** — add `<Route path="/demo/run/<slug-suffix>" element={<Page />} />`
7. **SQL Console** — `INSERT INTO org_agent_manifest` for target org
8. **DECISIONS.md** — add entry documenting non-obvious choices
9. **CHANGELOG.md** — session entry

---

## Pattern constraints

- `org_id` always from `req.user.orgId` — never from a request param
- Extraction privacy applied post-AI, pre-return — `AgentConfigService.getExtractionPrivacySettings(orgId)`
- Always pass `customProviders` to `getProvider` — never `getProvider(model)` alone
- Use `?? fallback` at call site for any nullable admin config value — not JS default params
- PDF export: `exportService.js` only — never `window.print()`
- `https.request` for outbound HTTP on Railway — never `fetch()`
