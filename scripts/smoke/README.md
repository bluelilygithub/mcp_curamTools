# Smoke tests (platform)

**Project norm:** Anyone changing the shared PDF or agent-routing spine must run **`npm test`** from the repository root before treating the work as done (see [PROJECT_IDENTITY.md](../../PROJECT_IDENTITY.md), [server/CLAUDE.md](../../server/CLAUDE.md), [DEMO-AGENTS.md](../../DEMO-AGENTS.md)).

## Golden path (`golden-path.mjs`)

**Purpose:** Cheapest “is the spine still intact?” check after refactors that touch **PDF export**, **routing**, or the **tender demo agent file**.

**What it does**

| Phase | Behaviour |
|-------|-------------|
| **1** | `require()` shared server modules: `markdownPdfBuffer`, `export` route, `createAgentRoute`. Verifies `tenderResponse/index.js` exists, mentions `runTenderResponse`, and passes `node --check` (no DB, no `require` of the tender agent — avoids side effects like `declareAgentFields`). |
| **2** | If system Chromium is found (same paths as production PDF), runs a **minimal markdown → PDF** via `renderMarkdownOrHtmlToPdfBuffer`. If no Chromium, **skips with exit 0** (normal on many Windows/macOS dev machines). |

**What it does *not* do**

- No HTTP, no login, no `POST /api/agents/.../run`
- No Anthropic, no S3, no PostgreSQL
- Does not exercise other agents’ code paths

**Prerequisites**

- Run from **repository root**
- `cd server && npm install` so `marked`, `puppeteer-core`, etc. resolve when the script loads `server/` modules

**Commands**

```bash
npm run smoke:golden-path
# same script:
npm test
```

**Future (optional)**

A second-tier smoke could call a running server with `SMOKE_BASE_URL` + `SMOKE_JWT` and stream one agent run; that belongs in a separate script when you want to spend tokens in CI.
