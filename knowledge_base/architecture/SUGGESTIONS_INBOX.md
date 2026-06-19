# Suggestions inbox

Per-user triage queue for findings from agents, services, and startup checks. Ported from Vault's `SuggestionService` pattern, adapted for mcptools org + user scoping.

## Distinct from High Intent Advisor

| Table | Purpose | Scope |
|-------|---------|--------|
| **`user_suggestions`** | General inbox (this doc) | `org_id` + `user_id` |
| **`agent_suggestions`** | HIA agent output only | `org_id` only |

Do not merge these tables.

## Architecture

All emitters call **`server/services/SuggestionService.js`**.

```
Services / startup / agents ──▶ SuggestionService.capture() ──▶ user_suggestions ──▶ /suggestions UI
```

**Mandatory:** When code detects an anomaly, gap, or improvement — call `capture()` or `captureIf()`. Do not only log.

## Categories & status

**Categories:** `rule`, `skill`, `automation`, `source`, `alert`, `other`

**Status:** `new` → `opened` → `apply` | `learn` | `ignore`

Automated emitters create only; users triage via UI.

## API

Mounted at `/api/suggestions`. Requires `requireAuth`. Scoped to `req.user.orgId` + `req.user.id`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/meta` | Counts by category/status |
| `GET` | `/count?status=new` | Nav badge |
| `GET` | `/` | List (`?category=`, `?status=`, `?q=`) |
| `POST` | `/` | Create |
| `PATCH` | `/:id` | Update status/fields |
| `DELETE` | `/:id` | Remove |

## Emitting (server)

```javascript
const { capture, captureIf, makeFingerprint } = require('../services/SuggestionService');

await captureIf(condition, {
  orgId,
  userId,
  source: 'MyService',
  category: 'alert',
  fingerprint: makeFingerprint('MyService', 'stable-key'),
  title: 'Short summary',
  body: 'Details',
  context: 'optional path or job id',
});
```

### Wired emitters

| Source | When |
|--------|------|
| `startup` | pgvector missing, `OPENAI_API_KEY` missing |
| `PersonalMemoryService` | User has thoughts but embeddings unavailable |
| `manual` | User adds via UI |

Workspace-wide alerts go to the primary org admin's inbox (`getPrimaryAdminForOrg`).

## UI

- **Route:** `/suggestions`
- **Nav:** inbox icon in TopNav with `new` badge
- Filter by category/status, search, status buttons on each card

## Cursor agents

After substantial mcptools work, if you find something worth flagging, call `SuggestionService.capture()` or `POST /api/suggestions`.

## Related

- Personal memory: `knowledge_base/architecture/PERSONAL_MEMORY.md`
- Vault reference: `curam-protocol/vault/docs/suggestions-inbox.md`
