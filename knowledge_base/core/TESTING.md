# Testing — mcptools

How to run tests, what each layer does, and how to add more. Tests are **optional** — run them when learning or before a risky deploy. Nothing runs on a schedule unless you add CI later.

---

## Quick commands

From the **repository root**:

```bash
# Unit tests (runs from server/ where dependencies live)
npm run test:unit

# Unit tests + golden-path smoke
npm test

# Single file while learning (from server/)
cd server
node --test constants/embeddingModels.test.js
node --test services/CostGuardService.test.js
```

**Note:** Dependencies are installed under `server/` (`cd server && npm install`). Root `npm run test:unit` delegates there automatically.

### View when tests last ran

```bash
npm run test:audit
```

Writes to **`test-audit/`** (local, gitignored except README):

| File | Contents |
|------|----------|
| `LAST_RUN.md` | Human-readable — status, time (UTC), pass/fail counts, git commit |
| `last-run.json` | Same data as JSON |
| `last-unit.json` | Last `npm run test:unit` only |
| `last-full.json` | Last `npm test` (unit + smoke) |
| `history.jsonl` | Last 100 runs (append-only) |

See `test-audit/README.md`.

---

## What runs today

| Layer | Command | Needs DB? | Needs API keys? | Purpose |
|-------|---------|-----------|-----------------|---------|
| **Unit tests** | `npm run test:unit` | No | No | Lock in rules for embeddings, budgets, etc. |
| **Golden-path smoke** | `npm run smoke:golden-path` | No | No | Key modules load; optional Puppeteer PDF |
| **Runtime checks** | Automatic on deploy | Yes | Sometimes | Health, startup suggestions, cost guards — not CLI |

---

## Unit test files

| File | What it teaches | Platform area |
|------|----------------|---------------|
| `server/constants/embeddingModels.test.js` | Chat models ≠ RAG models; env var validation | Settings → RAG embedding model |
| `server/services/CostGuardService.test.js` | Pure budget math; circuit breaker | Agent run cost guards |
| `server/migrations/runner.test.js` | Migration registry + applied-id lookup | Database migrations |
| `server/config/platformOrg.test.js` | `PLATFORM_ORG_ID` env parsing | Platform org fallback |
| `server/config/platformOperator.test.js` | Cross-org operator scope | Platform operator |
| `server/services/ExtractionValidationService.test.js` | Injected provider factory | Tiered extraction validation |
| `server/services/FileIntakeService.test.js` | File intake rules | Doc upload pipeline |
| `server/agents/docExtractor/index.test.js` | Agent-specific logic | Doc extractor |

Start with **embeddingModels** and **CostGuardService** — no mocks required for most cases.

---

## How unit tests work here

Uses Node’s built-in **`node:test`** and **`node:assert/strict`** (no Jest).

Pattern from `ExtractionValidationService.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { myFunction } = require('./MyService');

test('describes expected behaviour', () => {
  assert.equal(myFunction(input), expected);
});
```

For code that reads `process.env`, save and restore env in a helper (see `embeddingModels.test.js` → `withEnv`).

For code that hits the database, either mock `pool.query` or skip until you add a `TEST_DATABASE_URL` harness.

---

## Golden-path smoke

**File:** `scripts/smoke/golden-path.mjs`

Answers: “Do core platform modules still load and parse?”

- Does **not** log in, hit Postgres, or call LLM APIs
- Phase 2 (PDF) skips if Chromium is missing — exit 0

Run before deploy if you changed `createAgentRoute`, export PDF, or agent manifest spine.

---

## Runtime checks (not CLI tests)

These run **while the app is live** — you don’t invoke them:

| Check | When |
|-------|------|
| `GET /api/health` | Railway healthcheck |
| `SuggestionService.runStartupChecks()` | Server boot |
| `requireAuth` | Every protected API request |
| `CostGuardService.check()` | During agent runs |
| MCP `__trusted_org_id` injection | Every stdio tool call |

The **suggestions inbox** is your operational “something is misconfigured” channel without running tests.

---

## Suggested learning order (add more tests)

1. ✅ `embeddingModels.test.js` — config validation
2. ✅ `CostGuardService.test.js` — pure budget logic
3. `requireAuth.test.js` — mock `pool.query`, learn middleware testing
4. `PermissionService.resource.test.js` — MCP deny-by-default ACLs
5. `createAgentRoute.budget.test.js` — platform factory + SSE cost accumulation

See architecture docs: `knowledge_base/architecture/EMBEDDINGS.md`, `PERMISSIONS.md`, `PLATFORM_PRIMITIVES.md`.

---

## Adding a new unit test

1. Create `server/path/MyModule.test.js` next to the module (or under `server/constants/`).
2. Run `node --test server/path/MyModule.test.js` until green.
3. Add the path to the `test:unit` script in root `package.json` (or use a glob).
4. Optionally note the file in this doc.

Keep tests **fast** and **deterministic** — no live network, no real Anthropic/Gemini calls.

---

## Optional next steps (not required)

| Step | When worth it |
|------|----------------|
| GitHub Action running `npm test` on push | You want automatic checks without remembering |
| `TEST_DATABASE_URL` integration tests | Second developer or repeated org-leak bugs |
| `supertest` for HTTP routes | Testing auth + settings API together |

---

## After plugin / createPlatform changes

Automated: `npm run test:unit` (includes `platformOrg.test.js`) and `npm test`.

Manual local smoke (see `architecture/PLUGINS.md`):

| Check | Expected |
|-------|----------|
| Server boot log | `plugins: ["diamond-plate","engineering"]`, MCP `serverCount: 7` |
| Login at :5174 | Works with seed credentials |
| Diamond Plate sidebar | No Spec Validator / demo engineering tools |
| `GET /api/demo/manifest` | Demo agents for engineering org |

---

## Related

- Setup: `knowledge_base/core/SETUP.md`
- Plugins: `knowledge_base/architecture/PLUGINS.md`
- Embeddings: `knowledge_base/architecture/EMBEDDINGS.md`
- Permissions: `PERMISSIONS.md`
- Platform spine: `knowledge_base/architecture/PLATFORM_PRIMITIVES.md`
