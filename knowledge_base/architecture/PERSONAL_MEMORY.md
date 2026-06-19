# Personal Memory

Per-user semantic notes within an organisation. Inspired by Open Brain’s capture/search protocol, implemented with mcptools patterns (MCP stdio, pgvector, trusted context injection).

---

## Scope

| Dimension | Rule |
|-----------|------|
| **Org** | Thoughts belong to one organisation (`org_id`). |
| **User** | Each user sees and manages only their own rows (`user_id`). |
| **Access** | Any authenticated org member — not admin-only. |
| **Distinct from** | `embeddings` (org-wide RAG), `agent_lessons` (curated agent rules), `user_suggestions` (inbox — see SUGGESTIONS_INBOX.md). |

---

## Database

**Table:** `personal_thoughts`

| Column | Purpose |
|--------|---------|
| `org_id`, `user_id` | Scope |
| `content` | Note text (trimmed, max ~30k chars) |
| `content_fingerprint` | SHA-256 of content — dedup per user |
| `metadata` | JSONB tags (optional) |
| `embedding` | `vector(1536)` — `text-embedding-3-small` |
| `created_at`, `updated_at` | Timestamps |

Unique: `(org_id, user_id, content_fingerprint)`.

Schema created in `initSchema()` — `server/db.js`.

---

## Service

**`server/services/PersonalMemoryService.js`**

- `capture({ orgId, userId, content, metadata })` — embed + upsert
- `search({ orgId, userId, query, limit })` — cosine similarity
- `list({ orgId, userId, limit, offset })` — recent first
- `stats({ orgId, userId })` — count + date range
- `remove({ orgId, userId, id })` — delete own row only

---

## REST API

Mounted at `/api/personal-memory` (`server/routes/personalMemory.js`). All routes require `requireAuth`.

| Method | Path | Action |
|--------|------|--------|
| `POST` | `/` | Capture thought `{ content, metadata? }` |
| `GET` | `/search?q=` | Semantic search |
| `GET` | `/` | List recent (`?limit`, `?offset`) |
| `GET` | `/stats` | Summary stats |
| `DELETE` | `/:id` | Delete one thought |

User scope comes from `req.user.orgId` and `req.user.id` — never from request body.

---

## MCP server

**File:** `server/mcp-servers/personal-memory.js`  
**Manifest:** `personal-memory` in `server/mcp-servers/manifest.js` (bootstrapped for all orgs).

| Tool | Description |
|------|-------------|
| `capture_thought` | Store or update a note |
| `search_thoughts` | Semantic search |
| `list_thoughts` | Recent list |
| `thought_stats` | Count / dates |

**Trusted context** (injected by `MCPRegistry.send`, not from model args):

- `__trusted_org_id` — always on stdio `tools/call`
- `__trusted_user_id` — when `callMcpTool(orgId, server, name, args, { userId })`

Agents must pass `context.userId` from the authenticated session.

---

## Conversation agent

`googleAdsConversation/tools.js` exports four personal-memory tools. The agent can capture preferences and recall them in later turns.

Tool count with personal memory: **29** (see `MCP-SERVERS.md`).

---

## Client UI

**Settings → Memory** (`/settings?tab=memory`)

- `client/src/components/settings/PersonalMemoryTab.jsx`
- Available to all users (not admin-only)
- Capture, semantic search, browse, delete

---

## Environment

Same as knowledge-base embeddings:

- `DATABASE_URL`
- `OPENAI_API_KEY`

---

## Related files

| Area | Path |
|------|------|
| Schema | `server/db.js` |
| Service | `server/services/PersonalMemoryService.js` |
| MCP | `server/mcp-servers/personal-memory.js` |
| Routes | `server/routes/personalMemory.js` |
| Registry | `server/platform/mcpRegistry.js`, `mcpTools.js` |
| Agent tools | `server/agents/googleAdsConversation/tools.js` |
| UI | `client/src/components/settings/PersonalMemoryTab.jsx` |
| Tool reference | `MCP-SERVERS.md` |
