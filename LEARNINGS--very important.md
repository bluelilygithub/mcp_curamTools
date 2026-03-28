# Curam Vault — Architecture & Learnings

A personal reference document covering the technical architecture, key decisions, successful patterns, and honest retrospective on building a production LLM workspace application from scratch.

**Built by:** Michael Barrett
**Stack:** Node.js/Express · React/Vite · PostgreSQL + pgvector · Anthropic Claude · Google Gemini
**Status:** Feature-complete, deployed on Railway
**Live at:** https://curam-vault.up.railway.app

---

## Table of Contents

- [What This Is](#what-this-is)
- [Architecture Overview](#architecture-overview)
- [Technology Stack](#technology-stack)
- [Technical Deep Dives](#technical-deep-dives)
  - [1. RAG Implementation](#1-rag-implementation)
  - [2. Anthropic Prompt Caching](#2-anthropic-prompt-caching)
  - [3. YouTube Transcript Pipeline](#3-youtube-transcript-pipeline)
  - [4. Server-Sent Events for Streaming](#4-server-sent-events-for-streaming)
  - [5. Context Scoping](#5-context-scoping-global-vs-project-vs-session)
  - [6. File Processing Pipeline](#6-file-processing-pipeline)
  - [7. News Digest Pipeline](#7-news-digest-pipeline)
- [Key Architectural Decisions](#key-architectural-decisions)
- [Reusable Patterns](#reusable-patterns)
- [Lessons Learned](#lessons-learned)
- [Setup & Installation](#setup--installation)
- [Database Schema](#database-schema)
- [Portfolio Summary](#what-this-demonstrates-portfolio-summary)

---

## What This Is

A single-user, authenticated AI workspace. Everything you need to do serious LLM work in one place: structured project contexts, long-term memory, file processing with RAG, multi-model chat, document tools, and a personal productivity layer (tasks, goals, mood tracking).

The interesting engineering is in how context flows through the system — how user-uploaded files, project briefs, global memory, and pinned URLs get assembled into prompts efficiently, cached aggressively, and retrieved semantically.

---

## Architecture Overview

### System Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    React / Vite SPA                          │
│                                                              │
│  State: Zustand (auth, project, settings — persisted)        │
│  Routing: React Router v6                                    │
│  Styling: Tailwind CSS (inline styles for dynamic values)    │
│  Key hooks: useChat · useModels · useUrlAttachment           │
│             useFileAttachment · useVoice · useSearch         │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS (JSON) + SSE streams
┌────────────────────────▼────────────────────────────────────┐
│                 Node.js / Express API                         │
│                                                              │
│  Auth: requireAuth middleware (32-byte hex token → user)     │
│  Routes: 25+ route files, all under /api/*                   │
│  Services: embeddings · chunker · costCalculator             │
│            gmailNLP · calendarNLP · newsAggregation           │
│  Utils: sanitiseCodeFile · encryption · SSRF guard           │
│  Cron: newsDigestCron (node-cron, hot-reload schedule)       │
└──────┬─────────────────┬────────────────────┬───────────────┘
       │                 │                    │
┌──────▼──────┐   ┌──────▼──────┐   ┌────────▼────────────┐
│  Anthropic  │   │   Google    │   │   PostgreSQL 15      │
│  Claude     │   │  Gemini API │   │   + pgvector ext.    │
│  (primary)  │   │             │   │                      │
│  Streaming  │   │  text-      │   │   39 tables          │
│  Caching    │   │  embedding  │   │   vector(768) cols   │
│  Files API  │   │  -004       │   │   JSONB fields       │
└─────────────┘   └─────────────┘   └─────────────────────┘
```

### Context Flow Through the System

This is the most important thing to understand — how a user message becomes an AI response:

```
User sends message
       │
       ▼
Pre-send validation
  ├── Model key configured? (modelStatus check)
  ├── Token budget exceeded? (settingsStore)
  └── Smart Model Advisor (Haiku classifies prompt complexity)
       │
       ▼
buildSystemPrompt() assembles 5 blocks
  ├── Block 1: Persona + base instructions          ← cached (rarely changes)
  ├── Block 2: Project brief (goal, audience, etc.) ← cached (changes per project)
  ├── Block 3: Global memory entries                ← cached (changes occasionally)
  ├── Block 4: File + URL context                   ← cached (changes per action)
  │     ├── RAG: top-5 chunks via pgvector cosine search
  │     ├── Session files: injected in full
  │     └── Pinned URLs: transcript summary or page content
  └── Block 5: Today's date + web search notice     ← NOT cached (always fresh)
       │
       ▼
Provider routing (modelId.startsWith('gemini-') → Google SDK, else Anthropic)
       │
       ▼
SSE stream → client useChat hook → message bubble renders incrementally
       │
       ▼
Post-response (parallel, non-blocking)
  ├── Auto-title generation (Haiku, first message only)
  └── Cost logging → usage_logs table
```

---

## Technology Stack

### Frontend

**React 18 + Vite**
Fast dev server, instant HMR, small production bundles. React hooks make streaming state management clean — `useChat` accumulates SSE text in a ref and flushes to state, avoiding thousands of tiny re-renders during streaming.

**Zustand**
Chosen over Redux for simplicity. Three stores: `authStore` (token, user), `projectStore` (current project), `settingsStore` (budget, file types, reminder config). All persisted to localStorage via Zustand's `persist` middleware. The persistence meant zero API calls for settings on most page loads.

**Tailwind CSS**
Used for layout and base styles. Inline styles used for dynamic/theme values (`var(--color-primary)`, etc.) since Tailwind can't compute CSS variables at build time. Slight inconsistency in the codebase as a result.

### Backend

**Node.js + Express**
Chose JavaScript throughout (frontend + backend) to minimise context-switching. Async/await throughout. Express is verbose for large route files — the 25+ route files each got long. Would consider tRPC for type safety across the boundary in a next project.

**Why not Python (FastAPI/Django)?**
Wanted to deepen JS skills. Also, SSE streaming is idiomatic in Node's response model. Railway deployment is simpler with a single Node process.

### Database

**PostgreSQL 15 + pgvector**
The only mature open-source database with vector support at the time. JSONB columns used throughout for flexible storage (wizard_data, conversation history, task config). The `pg` driver with parameterised queries — no ORM, which kept queries transparent but added boilerplate.

**Why no ORM (Sequelize, Prisma)?**
Raw SQL gives full control over query shape. For an app with 39 tables and complex joins, an ORM would have added abstraction friction. The trade-off: migrations are manual (idempotent `ALTER TABLE ADD COLUMN IF NOT EXISTS` blocks in db.js).

### AI Providers

**Anthropic Claude (primary)**
Best-in-class prompt caching, clean streaming API, structured response parsing. The `messages.stream()` API with event handlers maps naturally to SSE. Haiku 4.5 used for background tasks (auto-titling, KR suggestions, NLP translation, cost ~$0.001/call); Sonnet 4.6 for primary chat.

**Google Gemini (secondary)**
Added for model diversity and because Gemini 2.5 Pro is strong for document comparison/analysis. Also provides `text-embedding-004` (768-dim) for RAG — free tier is generous enough that embeddings cost essentially nothing.

**Why both?**
Hedges against provider outages, rate limits, and billing issues. Teaches two different SDK patterns. The routing is dead simple: `modelId.startsWith('gemini-')` → Google SDK, else Anthropic. Adding a new model requires zero code changes.

### Infrastructure

**Railway.app**
One-click PostgreSQL, automatic deploys from GitHub, persistent volumes for uploads, managed env vars. Zero ops burden. The `railway.toml` handles build config. Cost is reasonable for a single-user app.

---

## Technical Deep Dives

### 1. RAG Implementation

**Problem**: Injecting entire files into every request wastes tokens and hits context limits. A 50-page PDF pinned to a project can't go into every message.

**Solution**: Semantic chunking + vector similarity retrieval.

**How it works:**

```
File upload
    │
    ▼
Text extraction (pdfjs / mammoth / xlsx / plain text)
    │
    ▼
chunker.js: split into ~500-token chunks at sentence boundaries
  - Splits on '. ', '? ', '! ', '\n\n'
  - 50-token overlap between adjacent chunks (prevents concept loss at boundaries)
  - Stores: chunk_text, chunk_index, file_id, project_id
    │
    ▼
embeddings.js: embedText() → Google text-embedding-004 API
  - 768-dimensional float vectors
  - Stored in file_chunks.embedding (vector(768) column)
    │
    ▼
At chat time:
  - User message embedded with same model
  - pgvector cosine similarity: SELECT ... ORDER BY embedding <=> $query_embedding LIMIT 5
  - Top-5 chunks injected as "## Relevant context from project files"
    │
    ▼
Fallback (if GEMINI_API_KEY absent or no chunks):
  - Full text injection, capped at 32,000 chars
  - Truncation note appended if exceeded
  - ragFallbackActive: true sent in usage SSE event
  - Amber "⚠ RAG unavailable" chip shown in context bar
```

**What worked well**: The graceful fallback. The system always returns *something* and the UI clearly communicates degraded state. Users can re-upload files to trigger embedding.

**What I underestimated**: The IVFFlat index on embeddings requires data to exist before it's useful. On a fresh installation it can't be created, which throws a warning but doesn't break anything. The `try/catch` around index creation is essential.

**What I learned**: Sentence-boundary chunking matters more than I expected. Fixed-size splits (just character count) produce worse retrieval results because paragraphs that flow across a chunk boundary lose their context on both sides.

**Reusable pattern**: This entire setup — chunker.js + embeddings.js + pgvector query + graceful fallback — is self-contained and extractable. The only dependency is pgvector on Postgres and a Google API key for embeddings.

---

### 2. Anthropic Prompt Caching

**Problem**: Every request re-sends the same system prompt (persona + project brief + memory + files). For a project with 10 pinned documents, this is 50K+ tokens per request at full price.

**Solution**: Structure the system prompt as cacheable content blocks.

**How it works** (in `chat.js`, `buildSystemPrompt()`):

```javascript
// The system prompt is an array of content blocks, not a string
const blocks = [
  { type: 'text', text: personaText + baseInstructions, cache_control: { type: 'ephemeral' } },  // Block 1
  { type: 'text', text: projectBriefText,               cache_control: { type: 'ephemeral' } },  // Block 2
  { type: 'text', text: globalMemoryText,               cache_control: { type: 'ephemeral' } },  // Block 3
  { type: 'text', text: fileAndUrlContext,               cache_control: { type: 'ephemeral' } },  // Block 4
  { type: 'text', text: todayDateAndWebSearchNotice },                                            // Block 5 — no cache
];
```

The `anthropic-beta: prompt-caching-2024-07-31` header is added automatically when cache blocks are present.

**Why four layers instead of one?** Each layer changes at a different frequency:

| Block | Changes when | Cache hit rate |
|---|---|---|
| Persona + base | Persona is switched | >95% |
| Project brief | User edits project or switches projects | ~80% |
| Global memory | User adds/edits a memory entry | ~90% |
| Files + URLs | File uploaded, URL pinned, session file changed | ~60% |
| Date + notices | Every request | 0% |

Breaking into layers means a project switch invalidates Block 2 but keeps Blocks 1, 3, 4 warm. A file upload invalidates Block 4 but keeps 1, 2, 3 warm.

**Practical impact**: Anthropic bills cached input tokens at ~10% of normal price. On a heavy session with a rich project context, this reduces costs by 50-70%.

**Gotcha discovered**: Anthropic supports a maximum of 4 cache breakpoints. Combining files + URLs into a single Block 4 was deliberate — it keeps the structure within the limit while still caching the most expensive content.

**What I'd do differently**: Add instrumentation to measure actual cache hit rates. I know the theory but never validated the numbers in production.

---

### 3. YouTube Transcript Pipeline

**Problem**: YouTube URLs are frequently shared in AI contexts, but fetching the page content gives you HTML noise, not the actual content. Transcripts are the signal.

**Solution**: Direct InnerTube API calls, no third-party service, with automatic Haiku summarisation.

**How it works** (`youtubeTranscript.js`):

```
YouTube URL detected (youtube.com/watch or youtu.be)
    │
    ▼
POST to YouTube's InnerTube API (/youtubei/v1/get_transcript)
  - No API key required
  - Returns caption track XML
  - Strips timestamps, joins into plain text
  - oEmbed call for title
    │
    ▼
Store raw transcript (up to 50,000 chars) in pinned_urls.content
    │
    ▼
Summarisation decision:
  if (transcript.length < 5000) → store as-is, skip summary
  else → call Claude Haiku with transcript
         prompt: "Summarise to ~20% original length, flowing prose, preserve specifics"
         store result in pinned_urls.transcript_summary
    │
    ▼
At chat time:
  use transcript_summary if present, else raw transcript (capped 40K chars)
```

**Why no npm package for transcript fetching?** Every npm YouTube transcript package I evaluated was brittle against YouTube's API changes and added a dependency I'd need to maintain. The InnerTube API is unofficial but has been stable for years. The implementation is ~50 lines, fully under my control.

**What worked**: The summary threshold (5K chars). Short transcripts are injected verbatim; long ones (a 2-hour lecture) get compressed to ~20%. In practice this means a 30-minute talk (30K tokens) becomes ~6K tokens without losing the key points.

**Limitation**: InnerTube only works for videos with captions. No captions = falls back to standard webpage content fetch.

---

### 4. Server-Sent Events for Streaming

**Problem**: AI responses take 5-30 seconds. A standard HTTP request-response pattern would stall the UI for the full duration.

**Solution**: SSE streams from the same Express process. No WebSockets, no separate streaming infrastructure.

**Pattern used throughout the codebase** (chat, compare, debate, weekly review, KR suggestions, mission generation):

```javascript
// Server side (Express route)
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');

const stream = anthropic.messages.stream({ ... });

stream.on('text', (text) => {
  res.write(`data: ${JSON.stringify(text)}\n\n`);
});
stream.on('finalMessage', () => {
  res.write('data: [DONE]\n\n');
  res.end();
});
stream.on('error', (err) => {
  res.write('data: [DONE]\n\n');  // Always close cleanly
  res.end();
});
```

```javascript
// Client side (useChat hook pattern)
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop(); // Keep partial line in buffer
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6);
    if (payload === '[DONE]') return;
    try { accumulated += JSON.parse(payload); setState(accumulated); } catch {}
  }
}
```

**Why the partial line buffer matters**: Network packets don't align with SSE event boundaries. Without buffering the incomplete line and prepending it to the next chunk, you get JSON parse errors on roughly 10-20% of tokens at normal network speeds.

**The `[DONE]` sentinel**: Both success and error paths emit `[DONE]`. The client doesn't need to distinguish — it just stops reading. Error details are communicated through a separate error classification event emitted before `[DONE]`.

**Reusability**: This pattern is 100% portable. Every SSE endpoint in this codebase follows the same shape. Extract the client-side reader into a `streamSSE(res, onChunk)` utility function and it becomes a one-liner at the call site. (The GettingStartedWizard does exactly this.)

---

### 5. Context Scoping: Global vs Project vs Session

**The three-tier context hierarchy:**

```
┌─────────────────────────────────────────┐
│  Global Memory                           │
│  "Facts the AI always knows about me"   │
│  Example: "I'm based in Melbourne, AU"   │
│  Injected into: every chat, everywhere  │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  Project Context                         │
│  Brief: goal, audience, tech stack, tone │
│  Pinned files: RAG-retrieved chunks      │
│  Pinned URLs: transcript/page summaries  │
│  Injected into: all chats in that project│
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  Session Context                         │
│  Session files: injected in full         │
│  Active URL attachments: full content    │
│  Injected into: this conversation only  │
└─────────────────────────────────────────┘
```

**Why session files inject in full while pinned files use RAG:** Pinned files represent a project's long-term knowledge base — they're often large (full PDFs) and only parts are relevant per question. Session files are explicitly attached by the user for a specific conversation — the user expects the *entire* content to be available, not just semantically similar chunks.

**The UX problem this creates**: Users don't have a clear mental model of why the same PDF behaves differently when pinned vs when attached to a session. "Why does it only know about page 3 when pinned but knows the whole thing when I attach it?" — This came up enough that I added the `ragFallbackActive` UI indicator, but the underlying confusion remains.

**What I'd do differently**: Collapse to two tiers (project + session) and make RAG opt-in per file ("use smart retrieval" toggle on the file card) rather than automatic for all pinned files. More explicit = less confusion.

---

### 6. File Processing Pipeline

Every uploaded file goes through the same extraction pipeline before being available as context.

```
Client: multipart/form-data POST to /api/files
    │
    ▼
Server: fileFilter validates extension and MIME type
  - Blocks: bare .env files (prevents secret upload)
  - Code files (.js, .ts, .py, etc.): forced mimetype = text/plain
  - 500KB hard limit for code files
    │
    ▼
Disk storage (multer, path = uploads/<projectId>/<filename>)
  - Code files: stored as <name>_<ext>.txt (prevents execution)
    │
    ▼
Text extraction (by type):
  - PDF: pdfjs-dist, page by page
  - DOCX: mammoth, preserves headings
  - XLSX/ODS: xlsx package, CSV per sheet, tab-separated sheets
  - Code/text: UTF-8 validation (rejects binary files)
    │
    ▼
sanitiseCodeFile.js (code files only):
  - Scans line by line for injection patterns
  - "Ignore previous instructions", "You are now", "SYSTEM:", etc.
  - Replaces with // [REMOVED: potential prompt injection]
  - Logs warning server-side
    │
    ▼
AI summarisation (Claude Haiku):
  - One-sentence description for all types
  - Longer summary for substantial text files
  - Stored in files.aiSummary
    │
    ▼
RAG pipeline (if GEMINI_API_KEY present):
  - chunker.js splits extractedText
  - embeddings.js calls text-embedding-004
  - Chunks + vectors stored in file_chunks
```

**The SSRF protection on URL pinning**: Before fetching any user-provided URL, `fetchUrl.js` resolves the hostname via `dns.lookup()` and rejects private IP ranges (`127.x`, `10.x`, `172.16-31.x`, `192.168.x`, `169.254.x`). This check runs on every redirect hop. Response bodies are capped at 2MB. Without this, a user could probe internal Railway services or cloud metadata endpoints.

---

### 7. News Digest Pipeline

This ended up being one of the most architecturally interesting pieces despite being a late addition.

```
node-cron (schedule from settings table, hot-reloadable)
    │ fires daily at configured time
    ▼
For each active topic (title + keywords):
    │
    ├── RSS feeds: ABC News, Guardian AU, Reuters, Sky News
    │   (topic-agnostic — score relevance after fetch)
    │
    └── Google News RSS: keyword search per topic
        (targeted — returns relevant articles directly)
    │
    ▼
Per article: pubDate parsing → 72h recency filter
  (widens to 96h automatically if < 3 articles survive)
    │
    ▼
Relevance scoring: keyword term match count
  (score 0 = drop; high score = rank higher)
    │
    ▼
Deduplication: title prefix match (first 60 chars)
    │
    ▼
Top 15 articles (600 char snippets each) → analysis model
    │
    ▼
Gemini 2.5 Pro → (fallback) Claude Sonnet
  Prompt: "daily intelligence briefing — what specifically changed TODAY"
  Returns JSON: unbiased (with timeline/keyFacts/mechanisms/actorMotivations) + left + right + commonGround
    │
    ▼
Rolling context injection (last 7 days summaries + user commentary)
  → next run has editorial memory of prior coverage
```

**The key insight in the prompt**: Framing it as "what specifically changed or happened in the last 48 hours, not background on the topic" dramatically improved output quality. Without this, the model produces evergreen summaries that could have been written any day. With it, the output is date-anchored and specific.

**The schedule hot-reload pattern**: The cron schedule is stored in the `settings` table. When the user saves new settings via the API, the existing cron job is cancelled and recreated immediately — no server restart required. This is cleaner than I expected. `node-cron` handles cancellation cleanly with the job reference.

---

## Key Architectural Decisions

### Decision 1: Single-File Schema Initialisation

All 39 tables, every `ALTER TABLE ADD COLUMN IF NOT EXISTS`, every post-commit index — all in one `db.js` file that runs on every server start.

**Rationale**: No migration tool (Flyway, Knex migrations, Prisma migrate) to install, configure, or run manually. The server bootstraps itself. On Railway, where you can't SSH in to run migrations, this is a significant operational advantage.

**Trade-off**: The file is 950+ lines. Adding a new feature means finding the right place to insert schema, which takes discipline. Also, there's no migration history — you can't tell from the code when each column was added.

**Outcome**: Works well for a personal project. Would not scale to a team — concurrent deploys could cause race conditions on schema changes. For a team, I'd switch to a proper migration tool.

**The trick that makes it safe**: Every schema change uses `IF NOT EXISTS` or `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL END $$`. Every statement is idempotent. The entire file can run 1000 times on the same database without side effects.

---

### Decision 2: Token-Based Auth (No JWTs)

Sessions stored in the `auth_sessions` table as 32-byte random hex tokens. Every request looks up the token in the database.

**Rationale**: JWTs are stateless, which means you can't invalidate them without maintaining a blocklist (which defeats the purpose). Token-based sessions can be invalidated instantly by deleting the row. For a personal productivity app where I need to be able to log out all sessions immediately, this matters.

**Trade-off**: Every authenticated request hits the database once for the token lookup. For a high-traffic service this is a concern; for a single-user app it's immaterial.

**What I'd add**: Token sliding expiry (extend expiry on each use, expire after N days of inactivity) rather than fixed 24-hour expiry. The current fixed expiry means I get logged out mid-workday if I don't actively use the app.

---

### Decision 3: Dynamic Model List in Database

AI models are stored in `settings.vault_models` as a JSON array, not hardcoded. The static `utils/models.js` file serves as a fallback default.

**Rationale**: Adding a new Claude or Gemini model shouldn't require a code deployment. When Anthropic releases claude-opus-5, I add it from the Settings UI and it's available immediately.

**The routing consequence**: Model routing becomes purely convention-based (`modelId.startsWith('gemini-')` → Google SDK, else Anthropic). Any model ID that starts with `gemini-` goes to Google; everything else goes to Anthropic. This is fragile if Anthropic ever releases a model with a non-`claude-` prefix, but in practice it's been stable.

**What worked particularly well**: The `POST /api/chat/test-model` endpoint that sends a live probe to each model and returns a classified error code (`auth`, `billing`, `model_not_found`, `rate_limit`). This makes model management transparent — you know before trying to chat whether a model is actually reachable.

---

### Decision 4: No Soft Deletes

Most records are hard-deleted when removed. The exceptions are mission statement versions (never deleted, only archived) and usage logs (append-only).

**Rationale**: Soft deletes add complexity everywhere — every query needs `WHERE deleted_at IS NULL`. For a single-user personal app, the data recovery use case barely exists. If you delete a project, you meant to.

**What I'd reconsider**: Chat sessions. Users sometimes accidentally delete sessions and lose conversations they wanted. A 30-day recycle bin for sessions would have been worth the complexity.

---

### Decision 5: Separating Multi-user userId Columns as a Post-hoc Migration

The original schema had no `userId` columns — everything was implicitly single-user. Multi-user support was added later as `ALTER TABLE ... ADD COLUMN "userId" INTEGER REFERENCES users(id)` with a backfill to `userId = 1`.

**Rationale**: Getting to a working product fast. Multi-user adds complexity everywhere.

**The cost**: The db.js migration section is now a graveyard of `ADD COLUMN IF NOT EXISTS` statements. The schema reads like an archaeological dig — you can see the evolution of the app in layers. It also means the original tables (personas, folders, memory) have no per-user isolation at the schema level — only at the query level (every query filters by `"userId"=$1`).

**Lesson**: Even for a single-user app, design your schema with `user_id` from day one. Adding it later is a one-time pain, but the ongoing `WHERE "userId"=$1` boilerplate is permanent.

---

## Reusable Patterns

Quick reference for the subsystems most worth extracting into new projects, ordered by portability.

| Pattern | Key Files | Dependencies | Portability | Extraction Effort |
|---|---|---|---|---|
| SSE Streaming | `server/routes/chat.js`, `client/src/hooks/useChat.js` | React 18+, any SSE-capable server | 95% | ~1 hour |
| RAG Pipeline | `server/services/chunker.js`, `server/services/embeddings.js` | PostgreSQL + pgvector, Google Embeddings API | 100% | ~2–3 hours |
| Prompt Caching | `server/routes/chat.js` (`buildSystemPrompt`) | Anthropic SDK | 100% | ~1 hour |
| YouTube Transcripts | `server/utils/youtubeTranscript.js` | Node.js `fetch` only | 90% | ~30 minutes |
| Hot-Reload Cron | `server/utils/newsDigestCron.js` | `node-cron` | 100% | ~30 minutes |
| Provider Routing | `server/routes/chat.js` (model routing logic) | Anthropic + Google SDKs | 80% | ~1 hour |
| Idempotent Schema | `server/db.js` | PostgreSQL | 100% | ~1 hour |

### 1. SSE Streaming with Error Recovery

The pattern in every streaming endpoint:
- Always emit `[DONE]` even on error (client always gets a clean close)
- Classify errors before sending (the `classifyStreamError` function in chat.js)
- Show specific, actionable error UI (🔑 auth error → link to API key settings; 💳 billing → link to billing console)

This is the most reusable pattern in the codebase. Extract the client-side reader into a utility; every streaming integration becomes trivial.

### 2. RAG with Graceful Fallback

Primary path: vector similarity search (fast, cheap, relevant).
Fallback path: full-text injection with truncation (always works, more expensive).
UI feedback: amber chip + tooltip when fallback is active.

The pattern of "try the smart thing, fall back gracefully, tell the user" applies everywhere. Never fail silently; never fail completely.

### 3. InnerTube-based Transcript Fetching + Summarisation Threshold

Fetch the raw transcript without a third-party service, then apply a length threshold before deciding whether to summarise. Under 5K chars → inject raw (summary would lose specificity). Over 5K → summarise to ~20% with Haiku.

This pattern applies to any long-form content: podcast transcripts, research papers, meeting recordings. The summarisation step is the key — raw transcripts are token-inefficient; Haiku summaries preserve the specifics that matter.

### 4. Prompt Caching with Layered Blocks

If using Anthropic, never send system prompts as a flat string. Structure them as an array of content blocks ordered by change frequency, with `cache_control: { type: 'ephemeral' }` on each. Put dynamic content (today's date, user-specific context) last without a cache marker.

The 10x cost reduction on cached tokens means this pays for itself within a single session on any substantial system prompt.

### 5. Convention-Based Provider Routing

`modelId.startsWith('gemini-')` → Google SDK, else Anthropic. No configuration table, no provider field in the model record (well, there is one in the UI, but routing doesn't use it). The model ID is the source of truth.

This is fragile but pragmatic. For two providers with clearly distinct ID namespaces, convention beats configuration.

### 6. Hot-Reloadable Cron from Database

Store schedule config in a settings table. When config changes via API, cancel the existing cron job and create a new one. No restart, no deployment.

```javascript
let currentJob = null;

function applySchedule(time, days) {
  if (currentJob) currentJob.stop();
  const cronExpr = buildCronExpression(time, days);
  currentJob = cron.schedule(cronExpr, runDigest);
}
```

Applies to: scheduled notifications, digest generation, any background job with user-configurable timing.

### 7. Idempotent Schema Initialisation

Every schema change uses `IF NOT EXISTS` or `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL END $$`. The entire schema file runs on every server start. This works because:
- `CREATE TABLE IF NOT EXISTS` is idempotent
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` is idempotent
- Constraint additions wrapped in exception handlers
- Foreign key additions using `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL END $$`

No migration tool needed. The server bootstraps itself. Works well until you need to modify an existing column (type change, constraint change) — at that point you need versioned migrations.

---

## Lessons Learned

### What I'd Do Differently

**Scope creep is the main regret.** The app has 39 database tables. It started as a chat interface. At some point it acquired a full double-entry bookkeeping system, a CRM module with client touchpoints, a mood tracking journal with body map input, a news aggregation pipeline, an OKR system, a Pomodoro timer, a Knowledge Graph with D3 force simulation, and a Gmail/Calendar OAuth integration.

Each module was interesting to build and technically sound. But the LLM-relevant learnings plateaued around table 15. The last 24 tables taught me more about Australian BAS reporting than about language model integration.

---

**Scope: Finance Module**

Built full double-entry accounting: accounts, invoices, expenses, wages, journal entries, BAS calculator, PDF invoice generation.

What it taught me: Australian GST, double-entry bookkeeping, `@react-pdf/renderer` for server-side PDF generation, the difference between cash-basis and accrual accounting for BAS purposes.

What it didn't teach me: anything about LLM application architecture.

The finance module is now a maintenance burden. Every new feature (e.g., adding a `clientId` FK) requires an audit of whether finance tables need updating. A focused LLM project with half the feature count would have been twice as valuable as a portfolio piece.

**Lesson**: When adding a new module, ask "does this deepen my understanding of the primary technical domain?" If not, build a separate app.

---

**Settings Table as a Type-Unsafe Key-Value Store**

The `settings` table is `(userId, key, value)` where `value` is always `TEXT`. Boolean values are stored as `'true'`/`'false'` strings. Arrays stored as JSON strings. Timestamps as ISO strings.

This means every consumer has to know the type contract:
```javascript
setTaskRemindersPaused(data.task_reminders_paused === 'true'); // boolean
setTaskReminderTimes(JSON.parse(data.task_reminder_times));    // array
setMissionReviewFreq(data.mission_review_frequency || 'off'); // string enum
```

No schema, no validation, no type safety. Adding a new setting is fast (just write the key), but the reading side is fragile and scattered.

**What I'd do instead**: A typed settings schema — either a proper `user_preferences` table with typed columns, or a JSONB column with a validation schema. The key-value store is fine for truly arbitrary configuration; it's the wrong model for a fixed set of known settings.

---

**Missing Telemetry**

There's no feature usage tracking. I don't know:
- Which features users actually use (in my case: me)
- Whether the Smart Model Advisor intercepts get ignored
- Whether the morning digest is useful or dismissed immediately
- Whether anyone has ever clicked "View History" on the mission statement

A simple `feature_events` table logging `(userId, event, metadata, created_at)` would have informed decisions about what to optimise and what to remove.

**Lesson**: Add `logEvent(userId, event, metadata)` from day one. It's 5 minutes of work and yields months of insight.

---

**Context Tier Confusion**

Three tiers of context (global memory, project, session) is probably one too many. Users (me) have to consciously decide: "Should this go in memory, in the project brief, or should I just attach it to this chat?"

The distinction between "project brief" and "project pinned files" is also blurry. The brief is structured (goal, audience, tech stack fields); pinned files are unstructured. Both end up in the system prompt. But users treat them as interchangeable.

**What I'd do instead**: Two tiers (workspace + conversation). Workspace context is project-level and always injected. Conversation context is session-level and user-managed. Eliminate global memory as a separate tier — put "always-on" facts in the workspace context.

---

**The Single-User Assumption Baked In Too Early**

The original schema had no user scoping at all. Adding it later required 10+ `ALTER TABLE ADD COLUMN "userId"` statements and corresponding backfills. Every existing query had to be audited and updated.

More subtly, some features were designed around single-user assumptions that make multi-user support non-trivial:
- The `settings` table uses `(userId, key)` which works but has no schema enforcement
- File storage is `uploads/<projectId>/` — projectId is globally unique, but there's no user isolation at the filesystem level
- Some background jobs (news digest cron) are designed for one global schedule

None of these are fatal flaws, but they'd require intentional work to support multiple users securely.

**Lesson**: Design for multi-user from day one. User-scoped tables cost almost nothing to add upfront; retrofitting them is tedious and error-prone. Even for a personal project, thinking in multi-user terms produces cleaner isolation.

---

**The Wisdom of Small Utility Functions**

The `classifyStreamError` function in chat.js turned out to be one of the highest-value pieces of code in the app. It maps Anthropic/Google error responses to named codes (`auth`, `billing`, `rate_limit`, `model_not_found`) and drives specific UI states with actionable messages.

Without it, every AI error would surface as a generic "something went wrong." With it, billing exhaustion links to the billing console, missing keys link to settings, rate limits show a clear message. Users (me) understand what happened and what to do.

The same pattern applies to `sanitiseCodeFile.js` (injection protection), `costCalculator.js` (pricing map), and `chunker.js` (sentence-boundary splitting). Each is small, focused, and testable in isolation.

**Lesson**: When a concern is complex enough to write twice, extract it immediately. The extraction cost is low; the clarity gain is permanent.

---

### What Worked Better Than Expected

**pgvector for RAG**: I expected this to be finicky to set up. In practice, adding the extension to Railway's Postgres took one line (`CREATE EXTENSION IF NOT EXISTS vector`), and the cosine similarity query is straightforward. The IVFFlat index setup is the only fragile part (requires data to exist first), which is handled with a try/catch.

**SSE as the universal streaming primitive**: I initially considered WebSockets for real-time features. SSE turned out to be sufficient for everything (chat streaming, AI generation, progress events), simpler to implement, and stateless (no connection management). If you only need server→client streaming, SSE is the right choice.

**Anthropic prompt caching**: More impactful than expected. On sessions with rich project context (pinned files, long memory), the cache hit rate is high and the cost reduction is significant. The implementation complexity is low once you understand the content block structure.

**Haiku for background tasks**: Using the cheapest capable model for non-primary tasks (auto-titling, KR suggestions, NLP translation, mission generation) keeps costs negligible while keeping quality acceptable. The `getModelsForUser()` helper that returns `{ light: 'claude-haiku-4-5-...', standard: 'claude-sonnet-4-6' }` is a simple but effective abstraction.

**Railway for deployment**: Zero-configuration PostgreSQL, automatic deploys from git push, persistent volumes for file uploads, environment variable management. For a solo project where I want to spend zero time on infrastructure, Railway delivers.

---

## Setup & Installation

### Prerequisites

- Node.js v22 LTS
- PostgreSQL 15+ with pgvector extension available
- Anthropic API key (required)
- Google Gemini API key (optional — enables Gemini models and RAG embeddings)

### Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://user:pass@localhost:5432/vault_dev
UPLOAD_DIR=./uploads
NODE_ENV=development
APP_URL=http://localhost:5173
SEED_EMAIL=you@example.com
SEED_PASSWORD=yourpassword

# Optional — enables Gemini models and RAG
GEMINI_API_KEY=AI...

# Optional — enables web search (@search in chat)
SEARCH_API_KEY=BSA...  # Brave Search

# Optional — enables Gmail/Calendar integration
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3001/api/gmail/callback

# Optional — encrypts Gmail OAuth tokens at rest
ENCRYPTION_KEY=<64 hex chars>  # openssl rand -hex 32
```

### Database Setup

pgvector must be installed on your Postgres instance. On Railway it's available as an extension. Locally:

```bash
# macOS with Homebrew
brew install pgvector

# Then in psql:
CREATE EXTENSION IF NOT EXISTS vector;
```

The application handles all table creation automatically on first start via `db.js`. No manual migrations.

### Local Development

```bash
# Install dependencies
cd vault && npm install

# Start dev server (API on :3001, Vite on :5173)
npm run dev
```

The Vite dev server proxies `/api/*` requests to Express on port 3001. The initial user is created from `SEED_EMAIL` + `SEED_PASSWORD` on first start.

### Backfilling RAG Embeddings

If you have existing files uploaded before `GEMINI_API_KEY` was configured:

```bash
npm run migrate:embeddings
```

This is idempotent — it only processes files that have extracted text but no chunks in `file_chunks`.

---

## What This Demonstrates (Portfolio Summary)

For anyone reading this as a portfolio piece, here's what the codebase demonstrates concretely:

**LLM integration depth**: Prompt caching with layered content blocks, RAG with pgvector, multi-provider routing, SSE streaming, error classification, cost tracking, model management.

**Backend architecture**: 25+ Express route files, parameterised queries throughout (no SQL injection surface), SSRF protection, prompt injection sanitisation for uploaded code files, AES-256-GCM encryption for OAuth tokens, rate limiting on sensitive endpoints.

**Frontend architecture**: Zustand state management with persistence, custom hooks that abstract complex interactions (useChat, useVoice, useFileAttachment), React.memo + useCallback optimisations for streaming performance, real-time SSE consumption.

**Production concerns**: Idempotent schema migrations, graceful degradation when optional services (pgvector, GEMINI_API_KEY) are absent, structured error handling with user-actionable messages, health check endpoint, Railway deployment with persistent volumes.

**What it doesn't demonstrate**: Comprehensive test coverage (aspirational test suites written as documentation, not implemented), horizontal scaling, multi-tenant data isolation, or CI/CD pipelines.

---

## Database Schema

Full schema is defined in `server/db.js` (39 tables, all initialised idempotently on server start). The README contains a high-level summary.

Key tables for understanding the architecture:

| Table | Purpose |
|---|---|
| `users` | Authentication — passwords hashed with bcrypt |
| `auth_sessions` | Token-based sessions (32-byte hex, stored in DB for instant invalidation) |
| `projects` | Workspace containers — holds structured brief (goal, audience, tech stack, tone) |
| `sessions` | Chat conversations — optional `project_id` FK for scoping |
| `messages` | Chat history — JSONB `content` field stores role + text + attachments |
| `files` | Uploaded documents — stores extracted text, AI summary, file metadata |
| `file_chunks` | RAG chunks — `vector(768)` embedding column, linked to `files` |
| `pinned_urls` | Project-pinned URLs — stores page content or transcript summary |
| `memory` | Global user context — injected into every chat (not yet RAG-indexed) |
| `personas` | Saved AI personas — injected as Block 1 in system prompt |
| `mission_statements` | Versioned mission statements — `is_current` enforced by DB trigger |
| `objectives` + `key_results` | OKR system — linked to projects |
| `tasks` | Task management — supports subtasks, recurrence, Pomodoro config |
| `usage_logs` | AI cost tracking — input/output tokens + cached tokens per request |
| `settings` | Key-value store for user preferences — `(userId, key, value TEXT)` |
| `news_topics` + `news_digests` | News aggregation — topics with keywords, AI-generated daily digests |
| `moods` | Mood journal — rating, energy, body map, notes |
| `contacts` + `touchpoints` | CRM — client records and interaction history |
| `accounts` + `transactions` | Double-entry bookkeeping — supports invoices, expenses, BAS |

The schema evolution is visible in the migration section of `db.js`: columns added post-launch appear as `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` blocks, which makes the original design vs. later additions easy to read.

---

## ToolsForge — Agent Platform Learnings

Patterns established while building the Google Ads Monitor agent (v0.2.0). These apply to every future agent on the platform.

---

### The Registration Contract

`createAgentRoute({ slug, runFn, requiredPermission })` is the complete registration contract for any agent. The factory owns all the plumbing — auth middleware, SSE header setup, progress/result/error event emission, `[DONE]` on both success and error paths, and history persistence to `agent_runs`. Agent authors write none of that. A new agent only needs `tools.js`, `prompt.js`, `index.js`, and a four-line route file that calls `createAgentRoute`.

The `requiredPermission` string is treated as a role name. `org_admin` always satisfies the check; the specific permission role is additive. This means access is granted at registration time, not hardcoded in platform code.

---

### The Single Write Path

`persistRun` must be the only code that writes to `agent_runs`. Both the SSE route and `AgentScheduler` call it — never write to `agent_runs` directly from agent code. This is what makes history consistent regardless of trigger source (HTTP, cron, or any future trigger type). The function is exported from `createAgentRoute.js` for exactly this reason; it is not a private implementation detail.

---

### extractToolData — Generic JSONB Storage from the Trace

`extractToolData(trace)` walks the AgentOrchestrator trace steps and keys each tool result by tool name:

```js
{
  "get_campaign_performance": [...],
  "get_search_terms": [...],
  "get_daily_performance": [...]
}
```

This is generic — it knows nothing about which agent ran. The UI then reads `run.data.get_campaign_performance` directly. The convention is: **tool names are the keys**. This means tool naming matters — tool names should be stable, lowercase, underscore-separated identifiers that are also usable as object keys. Do not rename a tool after the UI is reading from its key.

---

### extractSuggestions — Prompt-Format Dependent

`extractSuggestions(text)` parses the `### Recommendations` numbered list from the agent's final response text. It assigns priority by position: items 1–2 are `high`, 3–5 are `medium`, 6+ are `low`. This works because `prompt.js` enforces that exact output structure.

**Future agent prompts should follow the same `### Recommendations` numbered list convention** if they want priority-ordered suggestions parsed automatically. The format dependency is intentional — it keeps the parser simple and puts the structure contract in the prompt where it belongs.

Do not change the `### Recommendations` section of any agent prompt without updating `extractSuggestions`. Do not change `extractSuggestions` without auditing every prompt that relies on it.

---

### Cron Expressions, Not Named Schedules

`AgentScheduler.register` takes a raw cron expression. This keeps the platform generic and avoids building a named-schedule layer that would need its own maintenance. The Google Ads Monitor runs `'0 6,18 * * *'` — 6am and 6pm UTC, which is **4pm and 4am AEST (UTC+10)**. Always document the UTC↔local offset in a comment at the registration site; it is not obvious at a glance and easy to misconfigure.

---

### agent_runs Is the Only History Table

There are no agent-specific history tables. `agent_runs.slug` is the discriminator. Adding a new agent requires zero schema changes — the `agent_runs` table accepts any slug. The composite index on `(org_id, slug, run_at DESC)` makes per-agent history queries efficient regardless of how many agents are writing to the same table.

The existing `agent_executions` table (written by `services/AgentScheduler.js`) is a lower-level execution log used by the full-featured scheduler. `agent_runs` is the structured, UI-facing record. Both exist; they serve different purposes.

---

### The Recharts Lesson

The spec said "Recharts is already available." It wasn't. The wrong response was to silently replace it with a bespoke SVG implementation buried in an agent-specific folder — that produced a non-reusable one-off that violated the platform-first principle.

The right response: surface the missing dependency to the user and wait for direction. Then, if a zero-dependency fallback is genuinely needed, place it at `client/src/components/charts/` as a platform primitive with generic props.

Resolution: `npm install recharts` in `client/`; `PerformanceChart.jsx` reverted to Recharts; the SVG implementation promoted to `client/src/components/charts/LineChart.jsx` with a generic prop interface (`data`, `xKey`, `leftKey`, `rightKey`, `leftFormat`, `rightFormat`) so any future agent can use it without modification.

**General rule:** when an assumed dependency is missing, stop and ask. Do not silently create workarounds that encode agent-specific behaviour in platform-level locations — or worse, create agent-specific implementations of what should be platform primitives.

---

### SSE Pattern — Never Deviate

The SSE implementation in `createAgentRoute.js` matches `server/routes/stream.js` exactly:

```js
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
res.setHeader('X-Accel-Buffering', 'no');   // disables nginx buffering
res.flushHeaders();
// ...
res.write(`data: ${payload}\n\n`);
// ...
sendEvent(res, '[DONE]');   // always, on both success AND error paths
res.end();
```

The client-side consumer in `GoogleAdsMonitorPage.jsx` matches `useStream.js` exactly:

```js
buf += decoder.decode(value, { stream: true });
const parts = buf.split('\n\n');
buf = parts.pop();   // last element may be incomplete
```

These patterns must not diverge across the codebase. If a new streaming pattern is needed, update `createAgentRoute.js` and `useStream.js` together, then verify both ends match before shipping.

---

### MarkdownRenderer — Platform Primitive for LLM Output

Agent responses are markdown. `<pre>` and `whitespace-pre-wrap` do not render it — they show raw `###` and `**` characters to the user.

`client/src/components/MarkdownRenderer.jsx` is the single rendering component for all LLM text output on the platform. It is zero-dependency (line-by-line parser, no `marked`/`react-markdown`), uses CSS vars throughout, and handles the full subset Claude produces: `#`/`##`/`###` headings, `**bold**`, bullet lists, ordered lists, `---` rules, and paragraphs.

**The convention is absolute:** any component that displays LLM-generated text uses `MarkdownRenderer`. Agent authors do not write their own renderers. Improvements (code blocks, tables, links) are made once in `MarkdownRenderer` and propagate everywhere.

This applies to future agents immediately. It also applies to `ChatPage` — which currently uses `whitespace-pre-wrap` and is therefore not rendering markdown — but that is a separate change.

---

### Long-Running Agent UX — Indeterminate Progress + Elapsed Timer

Agent runs (ReAct loop + API calls) take 1–3 minutes. A single static text label is not enough feedback — the user cannot tell if the process is alive.

`RunningIndicator` in `GoogleAdsMonitorPage.jsx` provides two signals:
1. **Indeterminate sweep bar** — a `var(--color-primary)` bar slides continuously across a 4px track using a CSS keyframe (`@keyframes tf-ads-slide`). This confirms the process is running without implying false granular progress.
2. **Elapsed timer** — a `setInterval` counter in the corner updates every second (`5s`, `1m 3s`). Users calibrate their expectations; on subsequent runs they know roughly how long to wait.

The CSS keyframe is injected via a `<style>` tag in the component (scoped name `tf-ads-slide` avoids collisions). The timer resets each time the component mounts, which happens naturally when `running` toggles.

**Pattern for future agents:** any agent run that takes more than a few seconds should use the same two signals. Copy `RunningIndicator` or extract it to `client/src/components/` if more than one agent needs it.

---

### Auth Store Shape — `user.roles`, Not `user.role`

The login API returns `roles: [{ name, scope_type, scope_id }]` — **an array, not a string**. The property `user.role` does not exist; it is always `undefined`.

Three places got this wrong at the same time:
1. `RequireRole.jsx` — was checking `user?.role`
2. `AppShell.jsx` `isAdmin` — was checking `primaryRole === 'org_admin'` from `user?.role`
3. `AppShell.jsx` `getPermittedTools` — was passing `user?.role` (always null)

**Correct pattern everywhere:**
```js
// Resolve the global role from the roles array
const primaryRole = user?.roles?.find(r => r.scope_type === 'global')?.name ?? null;

// Check for a specific role
const hasRole = allowedRoles.some(r => user?.roles?.some(ur => ur.name === r));
```

**Why this matters:** All role-based guards and tool permission filtering silently fail (every check returns falsy) when this is wrong. Routes appear accessible, tools disappear from the sidebar, and `RequireRole` redirects every user to `/` regardless of their actual role. The failure is silent — no errors, no warnings.

**Reference:** `client/src/stores/authStore.js` — `user` is the raw login response. Check the actual shape there before writing any new role check.

---

### MarkdownRenderer — Infinite Loop Guard + Table Support

#### Infinite loop guard

The `parseBlocks()` function uses a `while (i < lines.length)` outer loop with branching for each block type. The paragraph branch used to be:

```js
} else {
  const paraLines = [];
  while (i < lines.length && !lines[i].trim().startsWith('#') && ...) {
    paraLines.push(lines[i++]);
  }
  blocks.push({ type: 'paragraph', ... });
}
```

**Bug:** A line like `#hashtag` (starts with `#`, no space) matches the outer `else` branch (not a heading), but also matches the inner `while` exit condition `lines[i].trim().startsWith('#')` — so `paraLines` is empty and `i` is never incremented. The outer loop iterates the same line forever, hanging the browser.

**Fix:** After the inner while, always increment `i` if nothing was consumed:
```js
} else {
  i++; // Guard: skip unrecognised line to prevent infinite loop
}
```

Also add `!lines[i].trim().startsWith('|')` to the paragraph inner-while conditions so table rows aren't swallowed into paragraphs.

#### Table support

Detect a table block: two or more consecutive lines starting with `|`. Parse with:
```js
function parseTableRow(row) {
  return row.split('|').slice(1, -1).map(c => c.trim());
}
function isTableSeparator(row) {
  return parseTableRow(row).every(c => /^[\s:-]+$/.test(c));
}
```
Filter separator rows before building header + body. Render as `<table>` / `<thead>` / `<tbody>` with border-collapse and platform CSS vars for colours.

**Key takeaway:** Any time a line-by-line parser has a catch-all `else` branch, it must guarantee forward progress (`i++`). Missing this in even one branch causes an infinite loop.

---

### Context Threading — Tool Date Range Fix

**Problem:** User-selected date range (e.g. "Last 7 days") had no effect on the report. The agent always used the hardcoded default (30 days).

**Root cause:** All four tool `execute` functions were written as `execute(input, _context)` — the underscore prefix was intentional, suppressing the linter warning. When Claude calls a tool without a `days` argument (which it does by default, relying on defaults), `input.days` is `undefined`. The `context.days` value (set from the UI) was silently ignored.

**Fix:**
```js
async execute(input, context) {
  return service.getData(context.days ?? input.days ?? 30);
}
```

**Why Claude omits arguments:** Claude's tool-use reasoning may determine that a tool's description implies a default and not include optional parameters. Never assume `input` will carry user-selected values — always thread them through `context` and read from `context` first.

**The full context flow:**
```
UI POST body → createAgentRoute context → runFn(context) → agentOrchestrator.run({ context }) → tool.execute(input, context)
```
Every layer must pass `context` through. Any agent that accepts user input (date range, filters, etc.) must read from `context`, not `input`.

---

### Two-Store Config Pattern — Admin vs Agent Settings

**Principle:** Config that controls cost and security (model, max tokens, max iterations, kill switch) belongs to the administrator. Config that controls analytical behaviour (lookback, thresholds, schedule) belongs to the operator. These must be stored separately with separate access controls.

| Setting type | Storage | Table/Key | Who can change |
|---|---|---|---|
| Admin (model, cost, kill switch) | `system_settings` | key = `agent_<slug>` | org_admin only |
| Agent (schedule, thresholds, lookback) | `agent_configs` | row per (org_id, slug) | org_admin (future: per-org operator) |

**Why separate tables?** An operator should never accidentally (or intentionally) change the cost guardrails while editing their analytical thresholds. The API routes enforce this: `/:slug/admin` requires org_admin; `/:slug` is readable by any authenticated user.

**`AgentConfigService` is the canonical access pattern** — never read from either table directly in agent or route code. The service owns defaults, merging, and error fallback. New agents add their defaults to `AGENT_DEFAULTS` and `ADMIN_DEFAULTS` in that file.

---

### `buildSystemPrompt(config)` — Dynamic Prompt Injection

Static system prompts make thresholds invisible to operators. When a threshold is hardcoded in a string, changing it requires a code change and redeploy.

**Pattern:** Export a function that builds the prompt from live config:
```js
// prompt.js
export function buildSystemPrompt({ ctr_threshold_pct, wasted_clicks_threshold, impressions_min, max_suggestions }) {
  return `...Flag campaigns where CTR < ${ctr_threshold_pct}%...produce at most ${max_suggestions} recommendations...`;
}
```

Called at run time with the freshly-loaded agent config. Operator changes in the UI take effect on the next run, no restart needed.

**Reusable:** every future agent with configurable analytical thresholds should use this pattern. Static prompts are fine for agents with no operator-configurable parameters.

---

### `AgentScheduler` Hot-Reload

When `node-cron` schedules a job and you want to change it, you must stop the old task and create a new one — you cannot mutate a running task.

**Pattern:**
```js
_jobs = {};

register({ slug, schedule, runFn, orgId }) {
  if (this._jobs[slug]) this._jobs[slug].stop();
  this._jobs[slug] = cron.schedule(schedule, handler);
}

updateSchedule(slug, newSchedule) {
  if (this._jobs[slug]) this._jobs[slug].stop();
  this.register({ slug, schedule: newSchedule, ... });
}
```

`updateSchedule` is called from the `PUT /api/agent-configs/:slug` route when the `schedule` field changes. This means an operator can change the cron expression from the UI and it takes effect immediately without a server restart.

**Lesson from the bad edit:** When editing a file that has deeply nested callbacks (`cron.schedule(expr, async () => { ... })`), partial edits can introduce mismatched braces that break the entire module. When a file has complex nesting, prefer a full rewrite over a multi-hunk patch.

---

### Admin/Operator Settings Boundary — UI Design

**Keep admin and operator settings in separate pages.** The Admin Agents page (`/admin/agents`) only shows kill switch, model, and cost guardrails. The Agent Settings panel (inside the tool page itself) shows analytical and scheduling settings. Mixing them into a single panel creates confusion about who has authority over what.

`AdminAgentsPage.jsx` pattern:
- Always show a meaningful error state, not a permanent loading spinner. If the API call fails, say why and what to do (e.g. "Restart the server if this is the first run.")
- `isDirty` computed as `JSON.stringify(cfg) !== JSON.stringify(saved)` — disables Save button when nothing has changed
- Discard button resets `cfg` to `saved` without a network call

---

### Railway Deploy — Missing Dependency (googleapis)

**Symptom:** Healthcheck at `/api/health` fails on every Railway deploy attempt. All retries time out. The app runs fine locally.

**Root cause:** `googleapis` was installed at the project root (`toolsforge/node_modules`) rather than inside `server/node_modules`. Node's module resolution walks up the directory tree, so locally `require('googleapis')` in `GoogleAdsService.js` and `GoogleAnalyticsService.js` resolves correctly. On Railway, the Dockerfile does:

```dockerfile
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/ ./
```

Only `server/` is copied into the container. The root `node_modules` never exists. `require('googleapis')` throws `MODULE_NOT_FOUND` at startup — before `app.listen()` is ever reached — so the health endpoint never responds.

**Fix:** Add `googleapis` to `server/package.json` dependencies and regenerate `server/package-lock.json` with `npm install --package-lock-only` from inside `server/`.

**General rule for this project:** Every `require(pkg)` in `server/` must be backed by an entry in `server/package.json`. The root `package.json` is irrelevant to the Railway build. When a new npm package is used in server code, always `cd server && npm install <pkg>` — never `npm install <pkg>` from the project root.

**How to catch this before deploying:** Run `cd server && npm install --omit=dev && node --check index.js` (or actually start the server) from a clean environment where only `server/node_modules` exists. Any missing dependency will throw immediately. Alternatively, run `docker build .` locally before pushing — the build stage will fail on `require` errors the same way Railway does.

---

### IconProvider — All Icons Must Be Registered

`client/src/providers/IconProvider.jsx` exports `semanticMap` — a map from semantic name (`'bot'`, `'shield'`, etc.) to Lucide component name. Icons used anywhere in the app **must** appear in this map. Unregistered names silently render nothing — no error, no fallback, no warning.

When adding a new sidebar link or UI element with an icon:
1. Decide the semantic name (e.g. `'bot'`)
2. Find the matching Lucide component name (e.g. `'Bot'`)
3. Add it to `semanticMap` in `IconProvider.jsx`

This was the cause of the missing Agents sidebar icon. The `bot` entry was absent; the sidebar link rendered with no icon and no indication of the problem.

**When to check:** any time a new icon name is used in a component via `getIcon('name')` — verify it exists in `semanticMap` before shipping.
