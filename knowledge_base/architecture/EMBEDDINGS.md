# RAG & memory embeddings

Org-scoped embedding model for vector search — **distinct from chat models** in `ai_models`.

## Why separate?

| Chat models (`ai_models`) | Embedding model (`embedding_model`) |
|---------------------------|-------------------------------------|
| DeepSeek, Kimi, Claude, etc. | Gemini, OpenAI embedding APIs, Ollama (local) |
| `/v1/chat/completions` | Provider-specific embed APIs |
| Settings → default / fallback | Settings → Models → **RAG embedding model** |

Chat models cannot be selected for RAG. The UI validates in real time and rejects invalid selections.

## Storage

- **Key:** `system_settings.embedding_model` → `{ model_id: string | null }`
- **Registry:** `server/constants/embeddingModels.js`
- **Resolver:** `server/services/embeddingResolver.js`
- **Service:** `server/services/EmbeddingService.js`

## Available models

| Model ID | Provider | Env var | Dimensions |
|----------|----------|---------|------------|
| `text-embedding-004` | Google (Gemini) | `GEMINI_API_KEY` | 768 |
| `embedding-001` | Google (Gemini) | `GEMINI_API_KEY` | 768 |
| `text-embedding-3-small` | OpenAI | `OPENAI_API_KEY` | 768 (requested via API) |
| `nomic-embed-text` | Ollama | — (local only) | 768 |

Platform vector columns use **768 dimensions**. Migrating from the previous 1536-dim schema clears existing vectors (re-embed after upgrade).

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings/embedding-models` | List embedding-capable models + key status |
| `GET` | `/api/settings/embedding-model` | Current org selection + validation |
| `GET` | `/api/settings/embedding-model/validate?model_id=` | Real-time validation (UI) |
| `PUT` | `/api/settings/embedding-model` | Set `{ model_id }` — rejects invalid models |

Org inherits from the **platform tenant** (`PLATFORM_ORG_ID` / `getPlatformOrgId()`) when unset — same pattern as `default_model`.

## Platform tenant

See `knowledge_base/architecture/PLUGINS.md` § Platform org (`PLATFORM_ORG_ID`).

## Consumers

- `EmbeddingService` — knowledge base, agent run summary indexing
- `PersonalMemoryService` — per-user semantic memory
- MCP: `knowledge-base.js`, `personal-memory.js`
- `SuggestionService` startup / personal memory health checks

## Related

- Personal memory: `knowledge_base/architecture/PERSONAL_MEMORY.md`
- Suggestions inbox: `knowledge_base/architecture/SUGGESTIONS_INBOX.md`
