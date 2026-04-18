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
- Consider automatic resource registration on discovery
