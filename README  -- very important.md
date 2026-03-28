# Curam Vault

A private AI workspace — a single-user, authenticated web app for working with Claude (Anthropic) and Gemini (Google) within structured project contexts.

## What It Does

Work is organised around **Projects**. Each project holds a structured brief (goal, problem, audience, tech stack, constraints, tone, notes) that is injected as context into every AI conversation within it.

### Features

#### Projects & Workspaces

| Feature | Description |
|---|---|
| **Projects** | Workspace containers with structured briefs — organise AI work by client or topic |
| **Folders** | Group projects into folders; drag-and-drop projects in and out of folders from the sidebar |
| **Personas** | Reusable AI roles with custom system prompts (e.g. "Senior Copywriter", "Legal Reviewer") |
| **Prompts** | Prompt library — save, tag, and reuse prompt templates across projects; supports `{{variable}}` placeholders that turn any prompt into a fill-in-the-blanks template |
| **Memory** | Global persistent notes injected into all chats (facts the AI should always know) |
| **Pinned URLs** | Attach web URLs to a project; content is fetched and stored for AI context; YouTube URLs (`youtube.com/watch`, `youtu.be`) are automatically detected — the full video transcript is fetched directly from YouTube's InnerTube API (no third-party service), stored up to 50,000 chars; on pin and refresh, Claude Haiku summarises the transcript to ~20% of its original length (prose, not bullets) and stores the summary in `transcript_summary`; the summary is injected into chat context instead of the raw transcript, reducing token usage significantly; transcripts under 5,000 chars are injected as-is; raw transcript is always preserved; regular pages use the SSRF-protected fetch route (4,000 chars in context); 📺 icon for YouTube, 🌐 for web pages; each card shows "Last fetched: today / yesterday / X days ago" and a refresh button; the Project Files Panel in chat lists all pinned pages with a paperclip attach button |
| **Files** | Upload PDFs, images, text files (txt, md, csv, json), spreadsheets (xlsx, xls, ods), Word documents (docx, doc), and code files (js, jsx, ts, tsx, php, py, css, html, sql, sh, .env.example) to a project; text is extracted and AI-summarised on upload for all supported formats; spreadsheets converted to CSV per sheet; Word docs extracted via mammoth; code files stored as plain text, 500 KB limit, prompt-injection sanitised |
| **File Preview** | Eye icon on every file card opens a right-side drawer (full-screen on mobile, 640 px panel on desktop); PDF pages rendered visually via pdfjs-dist with lazy loading (3 pages on open, 3 more per scroll); XLSX/ODS spreadsheets rendered as a sortable table with a tab per sheet; CSV rendered as a flat table; Word/DOCX rendered as formatted text; all other files shown in a styled `<pre>` block; "Attach" button inside the drawer adds the file to the current session context; ESC or backdrop click closes and restores focus to the previous element; also available in the Document Compare vault file picker |
| **Pinned files** | Pinned files are automatically included in every chat's system prompt for that project |
| **Session files** | Select any project file to include in the current chat session only; persisted to `session_files` table so context survives page refresh; visible in the context bar above the message list |
| **Notes** | Quick-capture thought pad — title, date, free text body; optional project link; "Take to Chat →" opens note as a new chat session with full context preloaded; "Convert to Task" button on each note card and in the editor toolbar opens Quick Capture pre-filled with the note title, body (truncated to 500 chars), and linked project; a "↳ task created" pill appears on the note card after conversion |

#### Chat & AI

| Feature | Description |
|---|---|
| **Chat** | Claude and Gemini conversations scoped to a project's context; model and temperature switchable per session; today's date (in the user's local timezone) injected into every system prompt; user's name, location, and current local time injected when a profile is configured; pinned file context served via RAG when `GEMINI_API_KEY` is set — only the most relevant chunks are injected rather than the full file text; AI responses exceeding 2500 characters auto-collapse with a fade-out and "Show more" toggle — messages containing code blocks are always shown in full; the most recent response is always expanded |
| **Anthropic prompt caching** | The Anthropic system prompt is structured as a layered array of content blocks — persona + base (1), project brief (2), memory (3), file/URL context (4) — each marked `cache_control: { type: "ephemeral" }`; today's date and web-search notice are appended last with no cache marker so they are always evaluated fresh; the `prompt-caching-2024-07-31` beta header is sent automatically whenever cache blocks are present; Gemini calls receive the same content flattened to a plain string |
| **RAG file context** | Pinned project files are chunked (~500 tokens, 50-token overlap at sentence boundaries) and embedded with Google `text-embedding-004` on upload; at chat time the user's message is embedded and the top-5 most semantically relevant chunks are retrieved via pgvector cosine similarity and injected under `## Relevant context from project files`; falls back to full-text injection if embeddings are unavailable; full-text fallback is capped at 32,000 characters with a truncation note appended if exceeded; `ragFallbackActive: true` is sent in the usage SSE event when fallback fires — the context bar shows an amber "⚠ RAG unavailable" chip and a server warning is logged with session ID, project ID, and raw vs capped character counts; session files (explicitly attached by the user) are always injected in full |
| **General Chat** | Project-free chat workspace for ad-hoc questions; sessions are saved and searchable |
| **Auto-generated session titles** | After the first AI response in a new session, Claude Haiku automatically generates a concise 4-6 word title using both the user message and AI response as context; saved in the background without blocking the chat response; sidebar updates within ~2 seconds; never overwrites a title the user has manually set |
| **Chat History** | Browse every session across all projects and General Chat, filterable by date range and searchable by content |
| **Message bookmarks** | Star any individual message (user or AI) in a chat by hovering and clicking the ★ icon; bookmarks are persisted to the database; a Bookmarks tab on the Chat History page shows all bookmarked messages grouped by session with a 100-character preview, each clickable to navigate back to that session; an amber dot badge appears on the Chat History nav icon when any bookmarks exist |
| **Project Files panel** | Side panel in the chat interface — lists all project files, upload new files, pin/unpin for permanent context, or click the paperclip icon on any file to add it to the current session; session files shown in the context bar above messages |
| **Clipboard image paste** | Paste images directly from the clipboard into the chat input; sent as inline base64 to the AI, no file upload required |
| **Native AI web search** | Globe/Search toggle in the chat header enables provider-native real-time web search — Anthropic's `web_search_20250305` tool for Claude models (capped at 3 searches per turn), Google Search grounding for Gemini models; the model decides when to search based on whether the query requires current information; a "Searching the web…" indicator replaces the loading dots while a search is in progress; on by default, toggleable per session |
| **`@search` web search** | Type `@` in chat and select "Search the web"; results shown in a panel before attaching as URL context |
| **`@gmail` email search** | Type `@` in chat and select "Search Gmail…"; natural language query translated to Gmail search syntax via Claude Haiku; browse results, attach email threads as context; ask follow-up questions about any thread via the `/ask` endpoint (SSE streaming) |
| **`@calendar` event search** | Type `@` in chat and select "Search Calendar…"; natural language query (e.g. "meetings next week", "party time") translated to Google Calendar API parameters via Claude Haiku; time-based queries search a 30-day forward window; name-based searches automatically use a 90-day past/future window to find events regardless of date; browse results, attach events as context with title, time, and location; click outside the modal to dismiss |
| **@mention in Chat** | Type `@` in chat to insert context or trigger actions — attach a task's details (title, notes, due date), switch project context, insert a prompt from the library (with variable fill-in modal if placeholders are present), trigger web search, query Gmail, or search Calendar |
| **Document Compare** | Compare two documents side by side using any Claude or Gemini model; 4 comparison modes; save results to a project |
| **Multi-Model Debate** | Pit multiple AI models against each other on a topic; multi-file context upload; synthesis summary |
| **Export** | Export chat conversations to Markdown, JSON, or PDF; email thread export |
| **Voice input** | Mic button in chat toolbar starts browser-native speech recognition (Web Speech API); `continuous: true` so dictation keeps running across natural pauses — a red pulsing dot indicates recording is active; a separate **Stop** button (red pill) commits the full accumulated transcript to the input and ends the session; live interim text shown while recording; hidden in unsupported browsers |
| **Read aloud** | Speaker icon in the action row below the last assistant message reads it via browser text-to-speech (no external service); while playing, the icon is replaced by a **Pause/Resume** toggle (pause icon → play icon) and an **✕ Stop** button in the same row; the action row stays fully visible while audio is playing (not hover-only); only the most recent AI response is ever passed to `speechSynthesis` |
| **Token budget alerts** | Set a per-session cost limit in Settings; configurable amber warning threshold (50–90%, default 80%) and red critical threshold (90/95/100%, default 100%); both banners are dismissible with an ✕ button; re-alert frequency configurable (don't show again / every 10 messages / every 20 messages / at 95%); red banner includes a "Save to Notes" checkbox (checked by default) — on summarisation, automatically creates a note titled "[Session title] — Summary [date]" linked to the current project with a confirmation toast |
| **Model error handling** | Stream errors classified by type and shown in a banner: 🔑 auth (key missing/invalid), 💳 billing (credit exhausted — links to Anthropic billing), 🤖 model not found, ⏳ rate limit, ⚠️ timeout/unknown; pre-send check blocks requests immediately if the provider key is confirmed absent |
| **Smart Model Advisor** | Pre-send intercept that analyses every prompt before it is sent — calls `POST /api/chat/analyse-prompt` using Claude Haiku to classify the prompt's complexity tier (simple/moderate/complex/image) and checks whether the currently selected model is a good fit; if there is a mismatch a **Model Advisor** modal appears with the reason, the current model, and up to three suggested alternatives (selectable cards); user can **Switch & Send** (changes the model then sends immediately) or **Keep & Send** (sends with the current model unchanged); image-generation requests show an amber notice directing to AI Studio instead of a switch option; Haiku response is parsed with a regex JSON extractor to handle markdown-wrapped output; classification mismatch threshold is conservative — only fires when the model tier difference is meaningful |

#### Tasks

| Feature | Description |
|---|---|
| **Tasks** | Full personal task manager — List, Kanban, Calendar, Eisenhower Matrix, and Tree views; drag-to-reorder; priority, urgency, due date, category, tags, project link; keyboard shortcuts; milestone flag (`isMilestone`) — 🏁 badge on List, Kanban, Matrix, and Tree views; amber diamond marker in Calendar view |
| **Kanban Board** | Three-column board (To Do / In Progress / Done); drag cards within or across columns to reorder and change status |
| **Time-Blocking Calendar** | Day/week/month/agenda sub-views; task blocks absolutely positioned on a 24-hour CSS Grid; drag-drop to reschedule; resize bottom edge to change estimated effort; current-time indicator |
| **Subtasks** | Nested subtasks with completion tracking; AI-generate subtasks from task title and notes |
| **Eisenhower Matrix** | 4th task view — 2×2 Priority Matrix; Urgent (⚡ toggle) × Important (high priority); Q1 Do First / Q2 Schedule / Q3 Delegate / Q4 Eliminate; insight line + Show completed toggle; `m` shortcut; `?view=matrix` URL param; drag tasks between quadrants — dropping on a new quadrant opens a confirmation modal showing exactly which attributes will change (`isUrgent`, `priority`) and the strategic implication of the move; if the task has subtasks the modal notes how many will move with it; drop zones highlight in the quadrant's colour when a task is dragged over them; subtasks displayed indented below their parent task within each quadrant (non-draggable) |
| **Tree view** | 5th task view — hierarchical list showing tasks with inline expand/collapse for subtasks; expand any row with a chevron to reveal subtasks indented with a `↳` connector; subtask depth is unlimited; hover metadata (priority badge, ⚡, due date, subtask count) appears on hover; `t` shortcut; `?view=tree` URL param |
| **Activity Status** | Lightweight progress label on any task — three states: **Started** (green), **Paused** (grey), **Waiting** (amber); set via pill-style buttons in the task form (below Title); coloured badge shown on list, kanban, and matrix rows when a status is set; coloured dot on matrix rows (space-compact); blank by default — nothing shown when unset; filterable via the "All activity" dropdown in the filter bar; stored as `activityStatus` column on the tasks table |
| **Renewal Dimension** | Tag any task with 🏃 Physical / 📚 Mental / 🤝 Social / 🌱 Spiritual (Habit 7 — Sharpen the Saw); four-button selector in the task form (below the Urgent toggle); emoji pill on list and board cards; second filter row in the filter bar (All Dimensions · 🏃 · 📚 · 🤝 · 🌱) |
| **Task Dependencies** | Mark tasks as "blocked by" other tasks; 🔒 badge when incomplete blockers exist; dependency UI in expanded row; circular dependency detection |
| **Recurring Tasks** | Daily / Weekly / Fortnightly / Monthly / Annually; new copy created automatically when marked done; fires even without a due date (uses today as the base date); guarded against double-creation on already-done tasks; all instances in a series share a `recurrenceGroupId` UUID; deleting a recurring task shows a 3-option modal — cancel, delete this task only, or delete this and all future (non-done) recurrences |
| **Task Duplication** | Duplicate any task via the copy icon on kanban cards and list rows; copies all fields including recurrence, renewal dimension, key result link, estimated effort, and milestone flag; subtasks are also duplicated |
| **Task Comments & Activity** | Per-task comment thread; system events (status, priority, due date changes) auto-logged |
| **Task Templates** | Save any task as a reusable template (with subtasks, priority, category, recurrence); apply in one click |
| **Focus Mode (Pomodoro)** | Full-screen overlay with a 25/5/15-min Pomodoro timer; SVG ring progress; subtask checklist; Web Audio API beep; auto-start breaks; time logged to task on close |
| **Time Tracking** | `timeSpentMinutes` accumulated via Focus Mode or the per-card stopwatch; running timer indicator in toolbar; time pill on cards; Time Logged 6th stat card |
| **Effort Estimation** | Set estimated effort per task (quick-select presets or custom input); effort pills on cards; Total Effort stat in toolbar |
| **Natural Language Due Dates** | Type `"tomorrow 3pm"`, `"next friday"`, `"Mar 15"` in the due date field; live resolved-date preview; 📅 calendar picker fallback |
| **Task Sharing** | Generate a public share link for any task; read-only view (no login required) with title, status, notes, tags, subtasks; revocable at any time |
| **CSV Import** | Import tasks in bulk from a CSV file; download template, drag-drop upload, preview with row-level validation, selective import; template includes `isMilestone` column (0/1) |
| **Quick Capture** | Floating `+` button on every page (or `Ctrl+Shift+N`) — capture a task without leaving the current page; includes Urgent and Milestone toggles side-by-side |
| **Inline task creation from chat** | Select any text in a chat message to reveal a floating "+ Task" button; Claude Haiku suggests a priority and due date based on the selected text and surrounding context (1.5s timeout with medium/null fallback); opens Quick Capture pre-filled; the created task records the source session ID so it links back to the conversation |
| **Source chat link** | Tasks created from a chat selection show "Created from chat: [session title]" as a clickable link in the expanded task view; navigates directly to that chat session |
| **Morning Digest** | Daily overlay on first visit — overdue + today's tasks with a Claude-generated focus suggestion |
| **Task Reminder Popups** | Configurable time-of-day reminder popups — select up to 7 daily times (5 AM, 8 AM, 10 AM, 12 PM, 2 PM, 5 PM, 8 PM) in Settings → Task Reminders; at each scheduled time a modal overlay lists overdue tasks (red) and today's tasks (amber) if any exist; tasks are clickable and navigate to the Tasks page; "Go to Tasks" and "Dismiss" buttons; reminders are tracked per-day in localStorage so they never double-show; on login, the most recent missed reminder from the past 4 hours is shown automatically; a "Pause all reminders" toggle suppresses all popups without clearing the schedule; settings persisted to both `settings` table (DB) and Zustand localStorage |
| **Weekly Review** | Guided 3-step modal (`w` shortcut) — north star mission statement banner in Step 1 (if set); last week recap, overdue carry-forward with reschedule actions, week-ahead with Claude suggestions, Goals progress update, milestone awareness per objective (up to 2 non-done milestones shown, amber=upcoming, red=overdue), and 🌱 Renewal This Week row (4 dimension icons with per-dimension completed-task counts; red dot on any zero) |

#### Goals

| Feature | Description |
|---|---|
| **Personal Mission Statement** | Compass-guided north star card at the top of the Goals page; write manually or use a 4-step Claude wizard (roles → character → contributions → principles) that streams a personalised statement via SSE; statement shown as a banner in Weekly Review Step 1 |
| **Goals (OKR-lite)** | Objectives → Key Results → Tasks hierarchy; set numeric targets and track progress; AI-generated KR suggestions via Claude; tag objectives with renewal dimension |
| **Renewal Balance Dashboard** | Collapsible section on Goals page (below Mission Statement); 4 dimension cards (🏃🟦 📚🟩 🤝🟨 🌱🟪) with active task/goal counts + progress; balance bar; nudge if dominant dimension >50%; AI Assessment button streams a warm coaching message |
| **7 Habits Sidebar** | Collapsible section in the project sidebar; 3 quick-links: 🧭 Mission Statement, ⚡ Priority Matrix, 🌱 Renewal Balance |
| **Goals Widget** | Home page summary showing active objective count, average progress, and top 3 progress bars |
| **Goals in Weekly Review** | Step 3 of Weekly Review shows active objectives + 🌱 Renewal This Week row (4 dimension icons with completed task counts; red dot if zero) |
| **Getting Started Wizard** | 7-step full-screen guided setup triggered automatically on first visit when no objectives exist; steps: Personal Context → Mission Statement (Claude drafts from context, editable) → First Objective (AI-suggested with colour picker) → Key Results (3 AI-suggested, toggle/edit) → Connect Tasks (link existing open tasks to the new objective) → Renewal Balance (four 0–10 sliders + streaming AI observation) → Review & Save; draft auto-saved to `localStorage`; ✨ button in Goals header reopens the wizard at any time; Settings page "Redo Setup" button resets the completion flag |
| **Milestone Timeline** | Collapsible timeline per objective (collapsed by default) showing all tasks marked as milestones across that objective's Key Results; chevron label shows total count and a red badge if any are overdue; each row shows 🏁 or ✓, title, due date, and coloured status (done=muted+strikethrough, overdue=red, other=amber); empty state shows a hint to add milestones via the task form |

#### Prompt Chains

| Feature | Description |
|---|---|
| **Prompt Chains** | Build reusable multi-step AI pipelines — each step's output feeds into the next; accessible via the ⛓ icon in the top nav |
| **Template variables** | Use `{{input}}` for the initial run input, `{{output}}` for the previous step's output, or `{{step_N}}` to reference any specific step by number |
| **Per-step model selection** | Each step in a chain can use a different model — mix Claude and Gemini models within a single pipeline |
| **Starter templates** | Three built-in starter chains (Blog Post Generator, Code Review Pipeline, Meeting Notes Processor) shown when no chains exist yet |
| **SSE streaming** | Chain runs stream output step-by-step in real time; each step shows a progress indicator, live output, and a copy button on completion |
| **Stop & re-run** | Abort a running chain mid-stream; re-run from the beginning with new input once complete |

#### Knowledge Graph

| Feature | Description |
|---|---|
| **Canvas** | Full-screen D3 force-simulation canvas at `/graph`; accessible via the 🕸 share-2 icon in the top nav (desktop) or directly by URL on mobile |
| **Node types** | Projects (large indigo circle), Files (blue rectangle), Notes (amber rounded rect), Chat Sessions (green circle), Tasks (orange diamond), Goals (purple hexagon), Pinned URLs (teal circle) |
| **Explicit edges** | Structural connections drawn automatically: `contains` (project→file/note/session), `subtask` (task→task), `branch` (session→session), `created` (session→task), `tracks` (task→key result), `key_result` (objective→KR), `blocks` (task dependency) |
| **Semantic edges** | AI-computed dashed pink lines via pgvector + Gemini embeddings; computed on demand via the "Find connections" button; cached in the `graph_edges` table; similarity threshold 0.82 |
| **Interactions** | Zoom and pan the canvas; drag nodes to reposition; click any node to open a detail side panel showing the node type, title, and a "Go to →" button for direct in-app navigation; hover a node to highlight its immediate neighbours and dim everything else |
| **Search** | Search bar in the toolbar filters nodes by name; matched nodes glow amber; unmatched nodes dim |
| **Type filters** | Per-type colour-coded checkboxes hide/show node categories without recomputing the graph; filter choices persisted to `localStorage` under `graph_filter_prefs` and restored on next visit; Finance-related node types default to hidden on first visit; preset buttons above the checkboxes provide one-click views — **All** (everything), **Work** (Projects + Files + Notes + Pinned URLs), **Tasks & Goals** (Tasks + Goals only), **This Project** (enabled when a project node is selected — filters to connected node types and highlights the subgraph); active preset highlighted with primary-colour border |
| **Insights panel** | Claude Haiku analyses the graph structure (orphaned nodes, cross-project clusters, top-connected nodes) and generates 4–6 specific observations; each insight has a "Show me" button that highlights and zooms to the relevant nodes; cached in the `settings` table and refreshed on demand |
| **Label behaviour** | Node labels hidden when zoomed out below threshold; always shown on hover, search match, or selection |
| **Scale-aware layout** | Logarithmic force scaling — charge and link distance computed from `ln(n)` so the graph looks correct at 5 nodes or 50+ nodes without manual tuning |

#### Finance

| Feature | Description |
|---|---|
| **Curam Finance** | Lightweight bookkeeping and invoicing at `/finance` — Dashboard, Invoices, Clients, Expenses, Wages, Journal, BAS, and Finance Settings tabs |
| **Invoice builder** | Line-item invoice builder with GST toggle per item; auto-numbered `INV-YYYY###`; Draft → Sent → Paid workflow; edit Draft and Sent invoices; Paid invoices are read-only |
| **Invoice email** | Send invoices as styled HTML emails via MailChannels TX API (or SMTP fallback); Resend available for Sent invoices |
| **Expense GST auto-calc** | Enter total paid; when "GST Included" is ticked, GST is auto-calculated as amount ÷ 11; category field autocompletes from past entries |
| **Double-entry journal** | Auto-generated balanced journal entries for every invoice, payment, expense, and wage; viewable in the Journal tab |
| **Cash-basis BAS** | Australian BAS calculator — GST collected from paid invoices only (by `paidAt` date); Australian quarterly periods; G1/G11/1A/1B/W1/W2 fields |

#### Mood Tracking

| Feature | Description |
|---|---|
| **Mood page** | Dedicated `/mood` page — two tabs: **Overview** (Plutchik density wheel, breakdown list, daily timeline, most active projects, Pattern Insights) and **Sessions** (list of completed inquiry sessions with inline transcript reader); period tabs on Overview: Today / Week / Month / Custom date range |
| **Project filter** | Filter the Mood page by a specific project — shows only check-ins logged on tasks, notes, or the project itself within that project; hides the project breakdown section when a project is selected |
| **Source filter** | Multi-select pill filter (All / Projects / Tasks / Goals / Notes / Sessions / General) to narrow the mood summary by entity type |
| **MoodDot** | Small dot button attached to tasks, notes, and projects — click to log a feeling for that specific entity; shows the dominant emotion colour when check-ins exist; uses a dashed border when no check-ins exist yet |
| **Quick check-in** | "Quick check-in" button in the Mood page header opens the 3-step check-in modal |
| **Begin inquiry** | "Begin inquiry" button in the Mood page header (and "Or take a few minutes for a guided inquiry →" link in Morning Digest) launches the full InquirySession modal |
| **Project card mood** | Each project card on the home page shows the dominant emotion colour and name in a bottom row; clicking it opens the check-in modal for that project |
| **Project header mood** | MoodDot in the project detail header — log a feeling directly for the project entity |
| **Project chat feeling** | "Feeling" button in the project chat toolbar (desktop) — shows the current dominant emotion colour and name if check-ins exist; opens check-in modal; hidden in general chats |
| **Check-in modal** | 3-step full-screen flow — Step 1: body scan (tap body locations on a body map, describe quality of sensation in free text); Step 2: interactive Plutchik emotion wheel (core → secondary → tertiary, intensity 1–10 slider); Step 3: context (optional note, `is_surface` toggle); saves to `mood_checkins` |
| **Guided inquiry (InquirySession)** | 5-stage full-screen modal for deep self-inquiry — **Stage 1** arrival prompt (optional free text, sets the session opening tone); **Stage 2** body scan (tap body locations on a body map, select sensation qualities from a pill grid, free-text description); **Stage 3** emotion wheel (interactive Plutchik selection + intensity slider); **Stage 4** live AI conversation (SSE-streamed Claude responses using the `INQUIRY_SYSTEM_PROMPT` — *"You are a clean mirror…"* — with full body scan + emotion context; voice input via Web Speech API mic button; speaker controls on each AI message for read-aloud via browser TTS); **Stage 5** integration (free-text user summary, session saved to `mood_sessions`); sessions accessible in the Sessions tab |
| **Sessions tab** | Lists all completed inquiry sessions sorted by date — duration, dominant emotions, user summary preview; click any row to expand an inline transcript showing the full AI conversation |
| **Pattern Insights** | Collapsible section on the Overview tab — generates 3–5 AI-written insight cards from recent check-in and session data via SSE streaming (`POST /api/mood/insights`); results cached to `mood_insights_cache` + `mood_insights_generated` in the settings table; each insight card has a left-colour-border; a closing reflective question is shown centred in italics |
| **Inquiry reminder** | Configurable reminder banner — Settings → Mood & Reflection: set frequency (Off / Daily / Weekly), preferred time, and day-of-week pills; Layout checks on mount and route change and shows a slide-in banner when conditions are met (4-hour tolerance window, once-per-day via `inquiry_reminder_{YYYY-MM-DD}` localStorage key); banner has "Begin now" (opens InquirySession) and "Maybe later" (dismiss) actions |
| **Voice input (inquiry)** | In Stage 4 of the inquiry — mic button starts Web Speech API recognition; red pulsing dot while active; Stop button commits transcript to the input; live interim text shown in the textarea while recording |
| **Speaker controls (inquiry)** | Speaker icon on each AI message in Stage 4 reads it aloud via browser TTS; the most recent completed AI message shows active Pause/Resume + Stop controls; all earlier messages show a static speaker icon for on-demand playback |
| **Emotion wheel** | Reusable `EmotionWheel` component with two modes: **interactive** (click to select an emotion, with secondary/tertiary drill-down) and **density** (radial segments sized by check-in count for the summary view) |
| **Daily timeline** | Mood page timeline groups check-ins by local date (browser timezone aware); each day shows coloured emotion pills and a dominant-emotion dot; dates parsed at local noon to avoid DST boundary issues |
| **Timezone-correct dates** | Server uses `TO_CHAR(DATE_TRUNC('day', created_at AT TIME ZONE $tz), 'YYYY-MM-DD')` — dates always reflect the user's local day, not UTC |
| **Custom emotion wheel** | `GET /PUT /api/mood/config` — store and retrieve a custom Plutchik wheel configuration per user; defaults to the 8-primary Plutchik model if no config is saved |

#### News Digest

| Feature | Description |
|---|---|
| **Daily digest** | Automatically fetches and analyses news for user-defined topics every day at a configurable time; results stored per-topic per-date so any past digest can be retrieved |
| **Topics** | Add topics by title + optional extra keywords (e.g. "Climate policy Australia" + "carbon, emissions, IPCC"); drag-to-reorder; enable/disable per topic without deleting |
| **Perspectives** | Each topic is analysed across four collapsible blocks: Unbiased Summary, Left-leaning perspective, Right-leaning perspective, and Common Ground |
| **Deep analysis fields** | Unbiased block includes: `timeline` (dated events from the articles), `keyFacts` (specific verifiable claims), `mechanisms` (how things work — funding flows, supply chains), `actorMotivations` (named actors and their strategic reasons), `uncertainties` (what is contested or unresolved), `sourceCredibility` (flags state media and contradictions between sources) |
| **Commentary** | Per-topic free-text commentary saved per date; auto-saved after 1.5 s idle; injected as rolling context into the next day's analysis so the AI can note how your interpretation evolved |
| **Per-topic chat** | Q&A chat window inside each topic card; system prompt built from the last 7 days of summaries + your commentary so questions are answered with rolling context |
| **Copy** | ⎘ Copy button in the expanded card header copies the full analysis as structured plain text (Markdown headings) to the clipboard |
| **Date navigation** | Browse any past digest with ← → arrows or a jump-to dropdown listing all dates that have a digest |
| **Generate now** | Manual trigger button on the Digest tab; always force-regenerates (fetches fresh articles and re-runs analysis, replacing any existing result for that date) |
| **Configurable schedule** | Settings → News Digest: set the time (HH:MM) and which days of the week the digest auto-runs; schedule is applied immediately without a server restart |
| **Configurable sources** | Toggle built-in RSS feeds on/off (ABC News, Guardian Australia, Reuters, Sky News, Google News); add custom RSS feed URLs by name and URL; saved to the settings table |

#### Admin & Account

| Feature | Description |
|---|---|
| **User Profile** | Settings → Profile — set your first name, city, state, and country (dropdown); stored in the `settings` table; used to personalise every LLM conversation with your name, location, local time, and default currency/country context |
| **Token Budget Settings** | Settings → Token Budget Alerts — configure initial alert threshold, critical threshold, and re-alert frequency after dismissal; settings persisted to DB and take effect immediately without page refresh |
| **Task Reminder Settings** | Settings → Task Reminders — toggle any of 7 reminder times on/off; pause all reminders with a single toggle; yellow banner shown when paused; times saved as JSON to `task_reminder_times` in the settings table; pause state saved to `task_reminders_paused` |
| **Mood & Reflection Settings** | Settings → Mood & Reflection — configure inquiry reminder frequency (Off / Daily / Weekly), preferred time (time picker), and active days (Mon–Sun pill toggles, visible in Weekly mode); saved to `inquiry_reminder_frequency`, `inquiry_reminder_time`, and `inquiry_reminder_days` in the settings table |
| **Admin Dashboard** | Usage stats — sessions, messages, tokens, searches, debates, comparisons; filterable by date range |
| **Search** | Global search palette across projects, chats, files, and tasks |
| **Password reset** | Email-based password reset flow with 1-hour expiry tokens |
| **Password show/hide** | Eye icon on all password fields (login, change password, reset password) toggles visibility |
| **Model management** | Add, edit, delete, and test AI models from Settings → AI Models; changes persist to DB and are reflected immediately across the entire app (chat selector, compare, project settings); Reset to defaults button restores the built-in 5 models |
| **Model availability** | Settings page shows API key status (✓ configured / ⚠️ key missing) per model; Test button sends a live probe to each model and reports success or the exact error (auth, billing, model not found, rate limit) |
| **Usage & Cost Log** | Every completed AI chat call writes a row to `usage_logs` — model, session, input tokens, output tokens, and estimated cost in USD (calculated server-side from a pricing map in `costCalculator.js`); accessible at `/usage` (⚡ icon in the top nav); period selector: **Today / Week / Month / Quarter / Year / Custom / All Time**; Custom shows From/To date pickers; each view shows four stat cards (est. cost, total tokens, input tokens, API calls), a per-model cost breakdown with inline bar chart, an over-time bar chart (daily for short periods, weekly for Year, monthly for All Time), and a paginated raw call log (time, model, feature, in/out tokens, cost); all data scoped to the logged-in user |

> **Detailed feature docs:** [TASKS.md](TASKS.md) · [GOALS.md](GOALS.md)

### Tech Stack

- **Backend:** Node.js / Express, PostgreSQL (`pg`), Anthropic SDK (`@anthropic-ai/sdk`), Google Generative AI SDK (`@google/generative-ai`), multer (file uploads), mammoth (DOCX extraction), xlsx (spreadsheet extraction), pdfjs-dist (PDF extraction + client-side rendering), bcryptjs, express-rate-limit
- **Frontend:** React 18 / Vite, Zustand (auth + project + settings state), React Router, Tailwind CSS, ReactMarkdown + remark-gfm, `react-force-graph-2d` (D3 force simulation — Knowledge Graph), `remove-markdown` (strips markdown formatting from text before passing to browser TTS)
- **Auth:** Token-based sessions — random hex token stored in `auth_sessions` table; `requireAuth` middleware on all `/api/*` routes; bcryptjs for password hashing
- **Deploy:** Railway with managed PostgreSQL service and persistent volume for file uploads (`UPLOAD_DIR` env var)

### Database Schema (39 tables)

#### Core / Auth
| Table | Key columns |
|---|---|
| `users` | id, email, passwordHash |
| `auth_sessions` | token, userId, createdAt |
| `password_resets` | token, email, expiresAt |
| `settings` | userId, key, value — key/value store for all user preferences, API keys, and feature flags |

#### Projects & Files
| Table | Key columns |
|---|---|
| `projects` | id, userId, name, goal, problem, audience, techStack, constraints, tone, notes, personaId, folderId, projectType, typeConfig |
| `folders` | id, userId, name |
| `files` | id, projectId, name, size, mimetype, path, extractedText, aiSummary, anthropicFileId, pinned, uploadedAt |
| `file_chunks` | id, fileId, projectId, chunkIndex, chunkText, embedding (vector 768 — pgvector) |
| `session_files` | sessionId, fileId — files attached to a specific chat session |
| `pinned_urls` | id, projectId, url, title, content, isYoutube, transcript_summary, lastFetchedAt |

#### Chat & AI
| Table | Key columns |
|---|---|
| `sessions` | sessionId, projectId, userId, title, starred, createdAt |
| `messages` | id, sessionId, projectId, role, content, createdAt |
| `comparisons` | id, projectId, docAName, docBName, mode, model, result, createdAt |
| `debates` | id, projectId, topic, result, createdAt |
| `usage_logs` | id, user_id (FK → users CASCADE), session_id, model_id, input_tokens, output_tokens, estimated_cost_usd (NUMERIC 10,8), feature (default 'chat'), created_at; indexed on (user_id, created_at DESC) |

#### Personas, Prompts & Memory
| Table | Key columns |
|---|---|
| `personas` | id, userId, name, description, systemPrompt, createdAt, updatedAt |
| `prompts` | id, userId, title, content, tags, createdAt |
| `memory` | id, userId, content, createdAt |
| `notes` | id, userId, projectId, title, body, createdAt |

#### Tasks
| Table | Key columns |
|---|---|
| `tasks` | id, title, notes, status, priority, isUrgent, isMilestone, activityStatus, renewalDimension, category, projectId, parentTaskId, dueDate, recurrence, recurrenceConfig, recurrenceGroupId, order, shareToken, estimatedMinutes, timeSpentMinutes, keyResultId |
| `task_tags` | taskId, tag |
| `task_comments` | id, taskId, type (user/system), content, createdAt |
| `task_templates` | id, name, description, category, priority, recurrence, tags |
| `template_subtasks` | id, templateId, title, order |
| `task_dependencies` | taskId, blockerTaskId |

#### Goals (OKR)
| Table | Key columns |
|---|---|
| `objectives` | id, userId, title, description, timeframe, status, color, renewalDimension |
| `key_results` | id, objectiveId (FK → objectives CASCADE), title, targetValue, currentValue, unit, status, dueDate |

#### Finance
| Table | Key columns |
|---|---|
| `fin_accounts` | userId, code, name, type (asset/liability/equity/income/expense), isSystem |
| `fin_clients` | userId, name, email, phone, address, abn |
| `fin_invoices` | userId, clientId, number (UNIQUE per user+number), status (draft/sent/paid/void), issueDate, dueDate, subtotal, gst, total, notes, paidAt |
| `fin_invoice_items` | invoiceId (CASCADE), description, qty, unitPrice, gst, amount |
| `fin_expenses` | userId, date, description, amount (ex-GST), gst, category, supplier |
| `fin_wages` | userId, date, employee, gross, tax, superannuation, net |
| `fin_journal_entries` | userId, date, description, reference, type CHECK (invoice/payment/expense/wage/manual), sourceId |
| `fin_journal_lines` | entryId (CASCADE), accountId (RESTRICT), debit, credit |

#### Mood
| Table | Key columns |
|---|---|
| `mood_checkins` | id, user_id, entity_type (project/task/note/goal/key_result/session/general), entity_id, core_emotion, secondary_emotion, tertiary_emotion, intensity (1–10), body_locations (JSON), body_qualities (JSON), body_description (TEXT), note, is_surface (BOOLEAN), check_in_type (quick/inquiry), inquiry_session_id (FK → mood_sessions), created_at |
| `mood_sessions` | id, user_id, started_at, completed_at, body_scan (JSON — locations + qualities + description), conversation (JSON — full message array), pattern_context (JSON), user_summary (TEXT), dominant_emotions (JSON), duration_seconds (INTEGER) |
| `mood_wheel_config` | user_id (UNIQUE), config (JSON — custom Plutchik wheel), updated_at |

#### Integrations & Search
| Table | Key columns |
|---|---|
| `gmail_tokens` | userId, accessToken, refreshToken, expiryDate, scope, email (tokens AES-256-GCM encrypted at rest) |
| `search_logs` | id, userId, query, createdAt |
| `search_index` | type, projectId, title, body |
| `graph_edges` | source, target, type, weight — cached semantic connections for Knowledge Graph |

---

## AI Model Management

Models are managed centrally from **Settings → AI Models**. The active model list is stored in the `settings` table under the key `vault_models` as a JSON array. If that key is absent the app falls back to the static defaults defined in `client/src/utils/models.js`.

### How it works end-to-end

1. **Static defaults** — `utils/models.js` exports `MODELS` (5 built-in models: Haiku 4.5, Sonnet 4.6, Opus 4.6, Gemini 2.0 Flash, Gemini 2.5 Pro). This is the fallback used on first run and as the "Reset defaults" target.

2. **`useModels` hook** (`hooks/useModels.js`) — fetches `GET /api/settings` on mount; if `vault_models` exists it parses and returns that list, otherwise returns the static defaults. Exposes `models`, `saveModels(array)`, and `loading`. Used by **ChatPage** (model picker) and **SettingsPage** (CRUD UI).

3. **Settings UI** — Settings → AI Models section lets you:
   - **Add** a model (fields: Model API ID, display name, label, provider, emoji, tagline, description)
   - **Edit** any model inline
   - **Delete** any model
   - **Reset to defaults** — clears `vault_models` and restores the built-in 5
   - **Test** any model — `POST /api/chat/test-model` sends a minimal live probe and reports success or the classified error (key missing, credit exhausted, model not found, rate limit)

4. **API key status** — `GET /api/chat/model-status` returns `{ anthropic: bool, gemini: bool }` indicating which provider keys are configured. Shown as ✓ / ⚠️ badges in the Settings model list and in the chat model picker button/dropdown.

5. **Server routing** — `chat.js`, `compare.js`, and `debate.js` detect the provider by checking whether `modelId.startsWith('gemini-')`. Any model whose ID starts with `gemini-` is routed to the Google Generative AI SDK; all others go to the Anthropic SDK. Adding a new Gemini model in Settings just requires using the correct `gemini-*` ID.

6. **Pre-send validation** — `ChatPage.handleSend` checks `modelStatus` before calling the API. If the provider key is confirmed absent it shows an error banner immediately without consuming the request.

### Adding a new model

1. Go to **Settings → AI Models → + Add model**
2. Enter the exact API model ID (e.g. `claude-opus-4-5` or `gemini-2.0-flash-exp`)
3. Set provider to **Anthropic** or **Google Gemini** (controls which SDK is used server-side)
4. Click **Test** to verify the model is reachable before using it in chat

No server restart or code deploy is required.

---

## Gmail & Calendar Integration

Users can connect their personal Gmail account via Google OAuth 2.0 and query their inbox using natural language directly from the chat `@gmail` mention. The same single OAuth flow also grants read-only Google Calendar access, enabling `@calendar` event search. Both integrations share the `gmail_tokens` table.

### Gmail — how it works end-to-end

1. **OAuth flow** — `GET /api/gmail/auth` generates an OAuth URL with a short-lived state nonce stored in the `settings` table. Google redirects back to `GET /api/gmail/callback` (registered *before* `requireAuth` — no session cookie required during callback). Tokens are stored in `gmail_tokens`.

2. **Natural language → Gmail query** — `GET /api/gmail/search?q=` passes the user's natural language input through `translateToGmailQuery()` in `server/services/gmailNLP.js`, which calls Claude Haiku to produce a valid Gmail search query, intent classification, max result count, and response mode. All date arithmetic is pre-computed in JavaScript and injected into the system prompt — Claude never invents dates.

3. **Thread attachment** — selecting a search result fetches the full email thread via `GET /api/gmail/thread/:threadId`. The thread text is injected into the chat as a `gmail://thread/<id>` URL attachment (using the existing URL attachment system) with pre-fetched content, so no additional API call is made when the message is sent.

4. **Ask endpoint** — `POST /api/gmail/ask` streams a Claude Haiku answer about a specific thread via SSE. The system prompt strongly asserts inbox ownership to prevent content-policy refusals on financial/legal/personal emails. Any suspected refusal is logged to the console with the email subject and question for prompt tuning.

### Calendar — how it works end-to-end

1. **Shared OAuth** — the same Google OAuth flow requests `calendar.readonly` alongside `gmail.readonly`. If a user connected Gmail before Calendar was added, the Settings page shows a "Reconnect Google" prompt. Calendar access is confirmed by checking `scope.includes('calendar')` on the stored token.

2. **Natural language → Calendar query** — `GET /api/calendar/search?q=` passes the query through `translateToCalendarQuery()` in `server/services/calendarNLP.js`, which calls Claude Haiku and returns `{ timeMin, timeMax, searchQuery, maxResults, calendarId, intent }`. All date ranges are pre-computed in JavaScript — Claude never calculates dates. Two default range strategies: time-based queries use today → +30 days; name-based searches (no time context) use −90 → +90 days so past and future events are both found.

3. **Event attachment** — selecting a result fetches the full event via `GET /api/calendar/event/:eventId` and injects it as a `calendar://event/<id>` URL attachment with pre-formatted plain text (title, date/time, location, organiser, attendees, description).

4. **Dismiss on outside click** — the search modal closes when clicking anywhere outside it, same as the Gmail and web search modals.

### Date ranges supported

The `gmailNLP` service pre-computes all commonly needed date ranges from today's date: today, yesterday, this/last week (Mon-Sun), this/last month, this/last year, last 7/14/30/90 days, this/last quarter, current and last Australian financial year (Jul–Jun), and the most recent January.

The `calendarNLP` service pre-computes the same ranges plus named weekdays for the current week (Monday–Sunday) and time-of-day boundaries (morning 06:00–12:00, afternoon 12:00–17:00, evening 17:00–22:00 UTC).

### Setup

1. Enable the **Gmail API** in [Google Cloud Console](https://console.cloud.google.com/) and create an OAuth 2.0 Client ID (Web application type).
2. Enable the **Google Calendar API** in the same Google Cloud project.
3. Add the redirect URI: `https://your-app.up.railway.app/api/gmail/callback` (and `http://localhost:3001/api/gmail/callback` for local dev).
4. Add the three env vars (see Environment Variables below).
5. Connect from **Settings → Integrations → Connect Google** (one flow covers both Gmail and Calendar).

### NLP test harness

Run `node server/services/gmailNLP.test.js` to execute 45 test cases across 11 categories (direction, name resolution, time ranges, content keywords, attachments, status, count/extract/summary/thread intent, and combined queries). Output includes per-category breakdown and an overall score.

---

## News Digest — How Information is Extracted

Understanding this pipeline matters for tuning quality. Every stage is a point where you can intervene.

### Pipeline overview

```
Topics (title + keywords)
        ↓
  Article fetching          newsAggregationService.js
  (RSS + Google News)
        ↓
  Recency filter            isRecent() — 72h window, widens to 96h if < 3 results
        ↓
  Relevance scoring         keyword term matching against title + snippet
        ↓
  Deduplication             title prefix match (first 60 chars)
        ↓
  Sort                      newest-first, then by relevance score within same recency band
        ↓
  Top 15 articles passed    truncated to 600 chars of snippet per article
  to analysis model
        ↓
  AI analysis               newsAnalysisService.js — Gemini 2.5 Pro → Claude Sonnet fallback
        ↓
  JSON stored per topic     news_digest_topics table
        ↓
  Rolling context           last 7 days of unbiased summaries + user commentary
  injected into next run
```

### Article fetching (`server/services/newsAggregationService.js`)

**Built-in sources** (configurable from Settings → News Digest):

| Source | Type | Notes |
|---|---|---|
| ABC News | RSS | General Australian news |
| Guardian Australia | RSS | Centre-left Australian/world coverage |
| Reuters | RSS | Wire service, internationally neutral |
| Sky News | RSS | Centre-right world coverage |
| Google News | Keyword search | `news.google.com/rss/search?q=<keywords>&hl=en-AU&gl=AU` — returns up to 15 articles matching the topic's keywords directly |

Each built-in RSS feed returns all recent articles regardless of topic; keyword relevance is scored after fetching. Google News runs a targeted keyword search and is the primary source for specific topics.

**Recency filter:** articles with a parseable `pubDate` older than 72 hours are excluded. If fewer than 3 articles survive, the window automatically widens to 96 hours. Articles with no parseable date are always kept.

**Relevance scoring:** each keyword from the topic (title words + extra keywords, split on spaces and commas) is matched against the article title and snippet. Score = count of matching terms. Articles scoring 0 are dropped.

**What this means in practice:** if a topic has only one or two keywords (e.g. "AI"), many articles will score 1 and the ranking will be almost purely chronological. More specific keywords ("LLM regulation EU Act") produce better discrimination.

### Analysis model and prompt (`server/services/newsAnalysisService.js`)

**Model priority:** Gemini 2.5 Pro is tried first (faster, lower cost for batch runs). If it fails or is unavailable, Claude Sonnet is the fallback. Token budget is 3,000 output tokens.

**What the prompt asks for:** the analyst role is framed as writing a *daily intelligence briefing* — specifically what changed or happened in the last 48 hours, not a general background on the topic. The key instruction is: *"summaries must be specific enough that they could not apply to any other day's news on this topic."*

**The JSON schema the model must return:**

```json
{
  "unbiased": {
    "summary":           "3-4 sentence narrative of today's specific development",
    "timeline":          ["[date] event — only if dates appear in articles"],
    "keyFacts":          ["specific verifiable claim with context"],
    "mechanisms":        ["How X works — only if supply chains/funding discussed"],
    "actorMotivations":  ["Named actor: what they did — strategic reason"],
    "uncertainties":     ["What is contested or left unresolved"],
    "sourceCredibility": "Flags PressTV=Iran, RT=Russia, Xinhua=China, Sputnik=Russia, or contradictions",
    "sourceIndices":     [1, 2, 3]
  },
  "left": {
    "summary":      "Progressive framing of TODAY's specific development",
    "keyPoints":    ["argument tied to this story"],
    "emphasis":     "The value or concern driving this framing",
    "sourceIndices": [1, 3]
  },
  "right": {
    "summary":      "Conservative framing of TODAY's specific development",
    "keyPoints":    ["argument tied to this story"],
    "emphasis":     "The value or concern driving this framing",
    "sourceIndices": [2, 4]
  },
  "commonGround": {
    "agreedFacts":       ["verifiable fact both sides accept"],
    "coreDisagreement":  "The fundamental tension in today's story"
  }
}
```

Optional fields (`timeline`, `mechanisms`, `actorMotivations`, `uncertainties`, `sourceCredibility`) are only generated when the articles actually support them. The prompt instructs the model not to produce placeholder content.

**Source indices** are 1-based references to the numbered article list. URLs are resolved server-side from the original article objects — the model never generates URLs, eliminating hallucinated links.

### Rolling context

Before each topic analysis, the cron fetches the last 6 days of unbiased summaries + any user commentary for that topic. This is prepended to the prompt so the model can note escalations, shifts in tone, or developments that contradict prior coverage. User commentary (written in the per-topic text field) is treated as editorial input — use it to flag angles the AI missed or to note your own interpretation.

### Schedule and idempotency

The digest runs via `node-cron` (`server/cron/newsDigestCron.js`). The schedule is stored in the `settings` table (`news_digest_time`, `news_digest_days`) and applied immediately when saved — the cron job is cancelled and recreated without a server restart.

The scheduled cron is **idempotent** — it skips topics that already have a result for that date, so if it runs twice (e.g. after a restart) nothing is duplicated. **Manual generation** (the Generate now / Refresh button) always force-regenerates, deleting existing results for that topic+date before re-running.

### Tuning the quality

| Problem | Likely cause | Fix |
|---|---|---|
| Analysis is generic / could be any day | Topic keywords too broad | Add specific keywords to the topic (Settings → Topics → edit) |
| Old articles appearing | RSS feed pubDate missing or malformed | Those articles have no date and pass the recency filter; add more specific keywords to outrank them |
| No results for a topic | No articles in 96h window, or keywords too niche | Broaden keywords; add Google News as a source; check topic name matches what news outlets call the subject |
| Left/right framing feels templated | Insufficient ideological signal in sources | Add sources with a clear editorial line (e.g. The Australian, The Guardian) |
| State media not flagged | Model missed it | Note it in your commentary — it feeds back into tomorrow's context |

---

## File Structure

```
vault/
├── server/
│   ├── index.js                  # Express server entry point
│   ├── db.js                     # PostgreSQL schema + pool
│   ├── typePrompts.js            # AI type-specific prompt helpers
│   ├── seed.js                   # Initial user seeding from env vars
│   ├── middleware/
│   │   └── auth.js               # requireAuth middleware (protects /api/*)
│   └── routes/
│       ├── auth.js               # Login (rate-limited) / logout / session / password reset
│       ├── user.js               # Change password (protected by requireAuth)
│       ├── projects.js           # Project CRUD
│       ├── chat.js               # Claude/Gemini streaming chat + session management; GET /model-status (key config check); POST /test-model (live model probe)
│       ├── compare.js            # Document comparison (Claude + Gemini, SSE streaming)
│       ├── debate.js             # Multi-model debate rounds
│       ├── files.js              # File upload, extraction, AI summary; RAG chunking + embedding pipeline runs after extraction (skipped silently if GEMINI_API_KEY absent)
│       ├── personas.js           # Persona CRUD
│       ├── prompts.js            # Prompt library CRUD
│       ├── memory.js             # Global memory CRUD
│       ├── folders.js            # Folder management
│       ├── pinnedUrls.js         # URL pinning + content fetch; YouTube URLs detected and routed to youtubeTranscript.js (InnerTube API); summariseTranscript() calls Claude Haiku to compress transcripts to ~20% on pin/refresh; SSRF-protected for all other URLs
│       ├── fetchUrl.js           # URL content fetching (SSRF-protected)
│       ├── webSearch.js          # Web search — Brave / Serper.dev / SerpAPI (rate-limited)
│       ├── search.js             # Global search (vault-internal full-text)
│       ├── admin.js              # Usage stats for dashboard (sessions, tokens, searches, debates)
│       ├── export.js             # Chat export (JSON, PDF, Markdown, email)
│       ├── email.js              # Email sending (HTML-escaped)
│       ├── pdf.js                # PDF text extraction
│       ├── tasks.js              # Task CRUD + subtasks + comments + templates + AI generate/extract + SSE weekly review + CSV import + share
│       ├── taskTemplates.js      # Task template CRUD + apply
│       ├── goals.js              # Objectives + Key Results CRUD + dashboard + AI KR suggestions (SSE)
│       ├── finance.js            # Finance module — clients, invoices (send via MailChannels), expenses, wages, journal, BAS, dashboard; fin_* tables; double-entry journal auto-generation
│       ├── usage.js              # Usage & Cost — GET /summary (period-scoped totals + per-model breakdown + daily series) and GET /log (paginated raw call log); period param: today/week/month/quarter/year/custom/all; custom accepts from/to date params; all boundaries computed in Australia/Sydney timezone
│       ├── gmail.js              # Gmail OAuth flow + search + thread fetch + ask (SSE); registered before requireAuth; applies auth internally for all paths except /callback
│       ├── calendar.js           # Google Calendar search + event fetch + ask (SSE); shares gmail_tokens table; scope check ensures calendar.readonly was granted
│       ├── sharedTasks.js        # Public shared task view — no auth (registered before requireAuth)
│       ├── settings.js           # App settings key/value store (API keys, config)
│       ├── bookmarks.js          # Bookmark CRUD — toggle, session lookup, all-bookmarks with message+session context, count endpoint
│       └── health.js             # Health check endpoint
│   ├── services/
│   │   ├── costCalculator.js     # Token cost estimator — pricing map for all current Anthropic and Gemini models ($/1M tokens); calculateCost(modelId, inputTokens, outputTokens) returns USD float; substring fallback for unknown model IDs; called by chat.js after each completed request
│   │   ├── embeddings.js         # RAG embedding service — embedText() calls Google text-embedding-004 (768-dim); retrieveRelevantChunks() queries file_chunks via pgvector cosine similarity; returns empty array on any error so callers fall back gracefully
│   │   ├── chunker.js            # Text chunking — splits extracted text into ~500-token chunks at sentence boundaries with 50-token overlap; used by the file upload route and migration script
│   │   ├── gmailNLP.js           # Natural language → Gmail query translator; calculateDates() pre-computes all date ranges; translateToGmailQuery() calls Claude Haiku; GMAIL_LIMITS constants
│   │   ├── gmailNLP.test.js      # 45-case test harness with scoring and ANSI colour output; run: node server/services/gmailNLP.test.js
│   │   ├── calendarNLP.js        # Natural language → Calendar API query translator; calculateDates() pre-computes ISO 8601 time ranges for named days/weeks/time-of-day; translateToCalendarQuery() calls Claude Haiku; CALENDAR_LIMITS constants
│   │   └── youtubeTranscript.js  # YouTube transcript fetcher — no npm dependency; isYoutubeUrl() detects YT links; fetchYoutubeTranscript() POSTs to InnerTube API for caption tracks, fetches caption XML, strips timestamps, fetches title via oEmbed; stores up to 50,000 chars; chat.js uses transcript_summary if present, otherwise falls back to raw transcript up to 40,000 chars; falls back to webpage fetch on failure
│   ├── scripts/
│   │   └── migrateEmbeddings.js  # One-time idempotent backfill — chunks and embeds all existing files that have extracted text but no file_chunks rows; run: npm run migrate:embeddings
│
├── client/
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── src/
│       ├── main.jsx              # React entry point
│       ├── App.jsx               # Router setup + keyboard shortcuts
│       ├── index.css
│       ├── themes.js             # Theme definitions
│       ├── pages/
│       │   ├── LoginPage.jsx
│       │   ├── ResetPasswordPage.jsx  # Email-based password reset
│       │   ├── ProjectList.jsx   # Home — projects + Goals widget + Tasks widget
│       │   ├── ProjectDetail.jsx # Project brief + files + pinned URLs
│       │   ├── ChatPage.jsx      # Main chat interface (project and general); uses useModels for dynamic model list; MemoMessageList defined at module level and wrapped in React.memo so the message list only re-renders on message/streaming changes, not on every keystroke; handleOpenArtifact/handleRegenerate/handleBranch wrapped in useCallback; stableSuggestionSelect uses latest-ref pattern for stable FollowUpChips callback; @mention query debounced 150ms
│       │   ├── ChatHistoryPage.jsx    # Browse all sessions by date / search; Bookmarks tab shows all starred messages grouped by session
│       │   ├── ComparisonPage.jsx     # Document compare tool
│       │   ├── DebatePage.jsx         # Multi-model debate tool
│       │   ├── PersonasPage.jsx  # Manage AI personas
│       │   ├── PromptsPage.jsx   # Prompt library
│       │   ├── MemoryPage.jsx    # Global memory management
│       │   ├── SettingsPage.jsx  # Account settings, password change, and AI model management (add/edit/delete/test)
│       │   ├── AdminPage.jsx     # Usage dashboard
│       │   ├── UserGuidePage.jsx # In-app user guide
│       │   ├── TasksPage.jsx     # Full task manager — List / Kanban / Calendar / Matrix views
│       │   ├── GoalsPage.jsx     # OKR Goals — Objectives + Key Results
│       │   ├── FinancePage.jsx   # Finance module — 8-tab layout (Dashboard/Invoices/Clients/Expenses/Wages/Journal/BAS/Settings); CategoryInput autocomplete; ConfirmModal + Toast throughout
│       │   ├── UsagePage.jsx     # Usage & Cost — period selector (Today/Week/Month/Quarter/Year/Custom/All Time), stat cards, per-model bar breakdown, over-time bar chart, paginated call log
│       │   └── SharedTaskPage.jsx     # Public read-only task view (no auth required)
│       ├── components/
│       │   ├── Layout.jsx        # App shell with sidebar + top nav
│       │   ├── ProjectSidebar.jsx
│       │   ├── AuthGuard.jsx     # Route protection
│       │   ├── MessageBubble.jsx # Chat message rendering; ★ bookmark button on hover for both user and assistant messages; TTS controls (speaker → pause/play toggle + ✕ stop) rendered in the action row of the last assistant message when `onSpeak` prop is present; action row stays fully visible (`opacity-100`) while audio is playing
│       │   ├── ArtifactPanel.jsx # Rendered code/content panel
│       │   ├── ChatFileBar.jsx   # Files attached to a chat
│       │   ├── ChatFilePicker.jsx
│       │   ├── FileUploader.jsx
│       │   ├── FileList.jsx
│       │   ├── ProjectFilesPanel.jsx # Side panel for project file management in chat
│       │   ├── UrlBar.jsx        # URL chips above textarea
│       │   ├── SearchPalette.jsx # Global search modal
│       │   ├── AtMentionDropdown.jsx  # @file/@prompt/@search/@task/@gmail mentions in chat
│       │   ├── GmailConnect.jsx   # Gmail OAuth connect/disconnect component (used in SettingsPage → Integrations)
│       │   ├── CalendarConnect.jsx # Calendar OAuth status/connect component (used in SettingsPage → Integrations; shares Gmail OAuth flow)
│       │   ├── FollowUpChips.jsx # Suggested follow-up prompts
│       │   ├── ExportMenu.jsx
│       │   ├── EmailModal.jsx
│       │   ├── NewProjectModal.jsx
│       │   ├── KeyboardShortcutsModal.jsx
│       │   ├── TasksCalendar.jsx # Time-blocking calendar (day/week/month/agenda; drag-drop; block resize)
│       │   ├── MorningDigest.jsx # Daily task digest overlay (once per day)
│       │   ├── TaskReminderModal.jsx # Scheduled task reminder overlay — shows overdue + today tasks at configured times; localStorage-keyed per day/time to prevent double-show; "Go to Tasks" + "Dismiss" buttons
│       │   ├── QuickCapture.jsx  # Floating quick-capture FAB (Ctrl+Shift+N)
│       │   ├── PromptVariableModal.jsx  # Fill-in-the-blanks modal for {{variable}} prompt templates; live preview; used by ChatPage and PromptsPage
│       │   ├── Toast.jsx         # Fixed-position toast notification renderer; reads from toastStore; auto-dismiss; success (green) / error (red) / warn (amber) variants; mounted globally in Layout
│       │   ├── ConfirmModal.jsx  # Reusable confirmation dialog — title, message, confirm label, danger variant (red button); optional confirmText prop requires user to type a specific string before confirming (used for destructive resets)
│       │   ├── ModelAdvisorModal.jsx  # Smart Model Advisor modal — shows when a pre-send prompt analysis detects a model mismatch; displays reason, current model chip, selectable suggested model cards, and Switch & Send / Keep & Send buttons; amber AI Studio notice for image-generation requests; Escape key dismissal
│       │   └── tasks/            # Task-specific sub-components (extracted from TasksPage)
│       │       ├── TaskFilters.jsx        # Quick-filter chips, category/project/status dropdowns, search, sort
│       │       ├── TaskStatsBar.jsx       # 6-card stats bar + 14-day completion chart
│       │       ├── TaskTemplatesPanel.jsx # Templates side panel (create, apply, delete)
│       │       ├── FocusMode.jsx          # Pomodoro timer overlay with subtask checklist + time tracking
│       │       ├── WeeklyReviewModal.jsx  # 3-step guided weekly review modal
│       │       └── TaskImportModal.jsx    # CSV import modal (template download, drag-drop, preview, validation)
│       ├── store/
│       │   ├── authStore.js      # Zustand auth state (persisted)
│       │   ├── projectStore.js   # Zustand project state
│       │   ├── settingsStore.js  # Zustand settings state — persists font, theme, icon pack, session budget, file types, task reminder times + paused flag
│       │   └── toastStore.js     # Zustand toast store — addToast(message, type, duration); auto-removes after timeout; used by Finance and other modules
│       ├── hooks/
│       │   ├── useChat.js        # Chat logic + streaming (Anthropic + Gemini)
│       │   ├── useModels.js      # Dynamic model list — loads from DB (settings.vault_models), falls back to static defaults; used by ChatPage and SettingsPage
│       │   ├── useFileAttachment.js
│       │   ├── useUrlAttachment.js
│       │   ├── useSearch.js
│       │   ├── useSystemPrompt.js
│       │   └── useVoice.js       # Browser speech recognition + TTS; STT uses `continuous: true` — finals accumulated in a ref across pauses, committed on `stopListening()`; `no-speech` errors suppressed; TTS exposes `isSpeaking`/`isPaused` states and `pauseSpeaking()`/`resumeSpeaking()`/`stopSpeaking()` in addition to `speak()`; `speak()` pre-processes text through `stripForSpeech()` which strips fenced code blocks, inline code, URLs, HTML tags, and all markdown formatting via `remove-markdown` before passing to `SpeechSynthesisUtterance`
│       ├── utils/
│       │   ├── apiClient.js      # Authenticated fetch wrapper (use for all /api/ calls)
│       │   ├── models.js         # Default Claude + Gemini model definitions (static fallback); active list is managed via useModels hook and stored in settings.vault_models
│       │   ├── pricing.js        # Token pricing helpers
│       │   ├── promptVariables.js  # extractVariables(), fillVariables(), labelFor() — parse and resolve {{variable}} placeholders in prompt templates
│       │   ├── parseDate.js      # Natural language date parser (pure frontend, no API calls)
│       │   ├── exportMd.js       # Markdown export formatter
│       │   └── exportHelpers.js
│       └── providers/
│           ├── ThemeProvider.jsx
│           └── IconProvider.jsx
│
├── uploads/                      # Uploaded files (gitignored)
├── railway.toml                  # Railway build + deploy config
├── .env.example                  # Environment variable template
└── package.json
```

---

## Database Schema

| Table | Purpose |
|---|---|
| `users` | Single user account |
| `auth_sessions` | Active login tokens (32-byte hex, 24-hour expiry) |
| `password_resets` | Email-based reset tokens (1-hour expiry) |
| `projects` | Project workspaces with context briefs |
| `sessions` | Chat session metadata — title, star, summary state, token counts |
| `messages` | Chat message history (linked to session and optionally a project) |
| `files` | Uploaded files with extracted text + AI summaries |
| `personas` | Saved AI personas with system prompts |
| `prompts` | Reusable prompt templates |
| `memory` | Global persistent memory entries |
| `pinned_urls` | URLs pinned to projects with fetched content, `lastFetchedAt` timestamp, `isYoutube` boolean (drives 📺/🌐 icon and transcript vs webpage fetch), and `transcript_summary` (Claude Haiku-generated ~20% summary of YouTube transcripts; injected in chat instead of the raw transcript when present) |
| `folders` | Folder organisation |
| `debates` | Multi-model debate rounds and results |
| `comparisons` | Saved document comparison results linked to projects |
| `search_logs` | Web search query log (powers admin dashboard search count) |
| `settings` | Key/value store for API keys and app config — includes `vault_models` (JSON array of active AI models); if `vault_models` is absent the app uses the built-in defaults from `utils/models.js`; `task_reminder_times` (JSON array of HH:MM strings); `task_reminders_paused` (boolean string) |
| `tasks` | Task records — status, priority, urgency (`isUrgent`), milestone flag (`isMilestone INTEGER DEFAULT 0`), renewal dimension (`renewalDimension`), due date, category, tags, recurrence, estimated effort, time spent, share token, parent task link, key result link, `recurrenceGroupId` (UUID linking all non-done instances in a recurring series); partial index `idx_tasks_milestone` on `(userId, isMilestone) WHERE isMilestone = 1` |
| `task_tags` | Many-to-many tag associations for tasks |
| `task_comments` | Per-task comments and auto-logged activity events (status/priority/due-date changes) |
| `task_dependencies` | Directed blocker relationships between tasks — `taskId` is blocked by `blockedByTaskId`; unique constraint prevents duplicates; circular dependency detection on insert |
| `task_templates` | Reusable task templates with predefined priority, category, recurrence, and tags |
| `template_subtasks` | Subtask definitions belonging to a task template |
| `objectives` | OKR Objectives — title, description, timeframe, colour, status, renewal dimension (`renewalDimension`) |
| `key_results` | Key Results linked to an Objective — numeric target/current values, unit, due date |
| `gmail_tokens` | Gmail + Calendar OAuth tokens per user — `accessToken`, `refreshToken`, `tokenType`, `expiryDate`, `scope`, `email`; access token auto-refreshed and persisted via `googleapis` token event; `scope` field used to detect whether `calendar.readonly` was granted |
| `notes` | User-scoped quick-capture notes — title, body, optional project link |
| `session_files` | Files selected for a specific chat session — `sessionId` + `fileId` composite PK; content injected into system prompt for that session only |
| `bookmarks` | Starred messages — `messageId` (FK → messages, unique), `sessionId` (FK → sessions); cascade-deleted when the message or session is deleted |
| `file_chunks` | RAG chunk store — each row holds a ~500-token chunk of a file's extracted text, its chunk index, and a 768-dimensional Google `text-embedding-004` embedding (`vector(768)`); queried at chat time via pgvector cosine similarity to retrieve the top-5 most relevant chunks for the user's message; cascade-deleted when the parent file is deleted |
| `usage_logs` | AI call log — one row per completed chat request; stores model ID, session ID, input/output token counts, and estimated cost in USD calculated by `costCalculator.js`; used to power the Usage & Cost page at `/usage` |

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API access |
| `SEED_EMAIL` | Yes | Initial user email (created on first startup if no users exist) |
| `SEED_PASSWORD` | Yes | Initial user password (change via Settings after first login) |
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/vault`) |
| `UPLOAD_DIR` | Yes | Absolute path to file uploads directory |
| `NODE_ENV` | Yes | `production` or `development` |
| `APP_URL` | Yes | Base URL for password reset emails and task share links (e.g. `https://curam-vault.up.railway.app`) |
| `PORT` | Optional | HTTP port (default `3001` in dev; Railway sets this automatically) |
| `GEMINI_API_KEY` | Optional | Google Gemini API access — enables Gemini 2.0 Flash and Gemini 2.5 Pro models |
| `SEARCH_API_KEY` | Optional | Web search API key — supports Brave Search (`BSA…` prefix), Serper.dev (40-char hex), or SerpAPI (default) |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth 2.0 client ID — enables Gmail + Calendar integration (`@gmail`, `@calendar` in chat, Settings → Integrations) |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | Optional | OAuth redirect URI — must match exactly in Google Cloud Console (e.g. `https://your-app.up.railway.app/api/gmail/callback`) |
| `ENCRYPTION_KEY` | Optional² | 64 hex char key (32 bytes) for AES-256-GCM encryption of Gmail OAuth tokens at rest. Generate: `openssl rand -hex 32`. If absent, tokens stored plaintext with a startup warning. |
| `MAIL_CHANNEL_API_KEY` | Optional | MailChannels API key for email; if absent, falls back to SMTP (see below) |
| `SMTP_HOST` | Optional¹ | SMTP server hostname (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | Optional¹ | SMTP port — `587` for TLS (default), `465` for SSL |
| `SMTP_USER` | Optional¹ | SMTP username / email address; also used as the sender `From` address |
| `SMTP_PASS` | Optional¹ | SMTP password or app-specific password |

¹ Required together if `MAIL_CHANNEL_API_KEY` is not set and you want email features to work.

² Strongly recommended in production. Without it Gmail OAuth tokens are stored unencrypted in the database.

### `.env.example`

```env
# ── Required ──────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# ── Server ────────────────────────────────────────────────────────────────────
PORT=3001
NODE_ENV=development   # set to "production" on Railway (handled via railway.toml)

# ── Database ───────────────────────────────────────────────────────────────────
# Local dev
DATABASE_URL=postgresql://vault:vault@localhost:5432/vault_dev

# Railway production: set DATABASE_URL to your Railway PostgreSQL service URL
# (available under the PostgreSQL service → Variables → DATABASE_URL)

# ── Storage ───────────────────────────────────────────────────────────────────
UPLOAD_DIR=./uploads

# ── Google Gemini (optional — enables Gemini models in chat, compare, debate) ─
# Get a key at https://aistudio.google.com/app/apikey
# You can also set this via Settings in the app UI
GEMINI_API_KEY=

# ── Web search (optional — enables @search in chat) ──────────────────────────
# Supports Brave Search (BSA… prefix), Serper.dev (40-char hex), or SerpAPI
# You can also set this via Settings in the app UI
SEARCH_API_KEY=

# ── Email ─────────────────────────────────────────────────────────────────────
# Option A: MailChannels API (preferred — set MAIL_CHANNEL_API_KEY, or via Settings UI)
MAIL_CHANNEL_API_KEY=

# Option B: SMTP via nodemailer (fallback if MAIL_CHANNEL_API_KEY not set)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password

# ── Password reset & task share links ─────────────────────────────────────────
# Base URL used in reset email links and public task share URLs (no trailing slash)
# Local: http://localhost:5173 | Railway: https://your-app.up.railway.app
APP_URL=http://localhost:5173

# ── Gmail integration (optional — enables @gmail in chat) ─────────────────────
# Create credentials at https://console.cloud.google.com/ → APIs & Services → Credentials
# Enable the Gmail API and create an OAuth 2.0 Client ID (Web application)
# Add redirect URIs: http://localhost:3001/api/gmail/callback (dev) and
#                   https://your-app.up.railway.app/api/gmail/callback (prod)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3001/api/gmail/callback

# ── Gmail token encryption (recommended in production) ────────────────────────
# Encrypts OAuth access and refresh tokens at rest using AES-256-GCM.
# Generate with: openssl rand -hex 32
# If absent, tokens are stored in plaintext (a warning is logged on startup).
ENCRYPTION_KEY=
```

---

## Security

| Area | Protection |
|---|---|
| **SSRF** | `fetchUrl.js` and `pinnedUrls.js` resolve hostnames via `dns.lookup()` before connecting; requests to private/internal IP ranges (`127.x`, `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x`, `::1`) are rejected with 400. Check runs on every redirect hop. |
| **Response size** | Both URL-fetch routes cap the response body at 2 MB; the request is destroyed if exceeded. |
| **Path traversal** | File upload and list routes validate `projectId` is numeric-only before constructing any filesystem path. Validation runs *before* multer processes the upload. |
| **Code file isolation** | Uploaded code files (`.js`, `.ts`, `.php`, `.py`, etc.) are stored on disk with a `.txt` extension appended (e.g. `index.js` → `index_js.txt`). The original filename is preserved in DB metadata only. `mimetype` is forced to `text/plain` in the database regardless of what the browser sent. No route serves code file content publicly — it is only injected into LLM context server-side. |
| **Code file size limit** | Code uploads hard-capped at 500 KB. Files exceeding this are deleted immediately and the upload returns a 400 error explaining the limit, preventing context overflow. |
| **Prompt injection sanitisation** | `server/utils/sanitiseCodeFile.js` scans every uploaded code file line by line for injection patterns (`Ignore previous instructions`, `You are now`, `SYSTEM:`, `###Instructions`, etc.). Matching lines are replaced with `// [REMOVED: potential prompt injection]` and a server-side warning is logged. Legitimate code constructs (`eval()`, `exec()`, `require()`) are not affected. |
| **`.env` file block** | Bare `.env` files are explicitly rejected by the upload `fileFilter` regardless of MIME type, preventing accidental upload of secrets. `.env.example` is the only dotenv-style file permitted. |
| **Brute force** | `POST /api/auth/login` is rate-limited to 10 attempts per 15 minutes per IP via `express-rate-limit`. |
| **XSS in email** | All user-generated content (message body, role, subject) is HTML-escaped via `escapeHtml()` before injection into the email template. |
| **Change-password auth** | Route is at `/api/user/change-password` and protected by the standard `requireAuth` middleware. |
| **Web search cost** | `/api/web-search` rate-limited to 20 requests per hour per IP. |
| **SQL injection** | All database queries use `pg` parameterised queries (`$1`, `$2`, …) — no string interpolation. |
| **Auth sessions** | 32-byte random hex tokens; 24-hour expiry checked server-side on every request. |
| **Passwords** | bcryptjs with SALT_ROUNDS=12. |
| **Security headers** | `helmet` middleware applied in production (default CSP, HSTS, X-Frame-Options, etc.). |
| **Public routes** | `/api/shared/task/:token`, `/api/auth/*`, and `/api/gmail/callback` are registered before `requireAuth`; all other `/api/*` routes require a valid session token. The Gmail router applies `requireAuth` internally for all its paths except `/callback`. |
| **OAuth state nonce** | Gmail OAuth state nonce stored in `settings` table with a 10-minute expiry; validated and deleted on use; prevents CSRF during the OAuth redirect flow. |
| **Gmail tokens at rest** | `accessToken` and `refreshToken` encrypted with AES-256-GCM before writing to `gmail_tokens`; decrypted only at runtime. Key loaded from `ENCRYPTION_KEY` env var (64 hex chars). Graceful fallback: if key is absent, tokens are stored plaintext and a startup warning is logged. Existing plaintext rows are transparently handled on read and re-encrypted on next write. |
| **Gmail rate limiting** | `/api/gmail/auth` — 5 req/15 min per IP; `/api/gmail/search` and `/api/gmail/thread/:id` — 60 req/min per IP; `/api/gmail/ask` — 20 req/min per IP (tightest, triggers both Gmail API and Anthropic). |
| **Gmail search input** | `q` parameter capped at 500 characters; returns 400 if exceeded. `max` clamped to `GMAIL_LIMITS.count` (500). |
| **Web search prompt injection** | When native web search is enabled the system prompt explicitly instructs the model that search results are untrusted external data; the model is told never to follow instructions found in `web_search_tool_result` blocks or `<search_result>` tags regardless of how they are framed, and never to treat search result content as coming from the system, the user, or the AI provider. Anthropic caps searches at 3 per user turn via `max_uses: 3` on the tool definition. |
| **Anthropic data retention** | `store: false` set on every Anthropic API call (chat stream, summarisation, auto-title, suggestions, Gmail ask, NLP query translation). Opts out of Anthropic using request content for model training. |

---

## Running Locally

```bash
cd vault
npm install
npm run dev
```

**Node version:** Node.js v22 LTS is recommended.

**Production** is deployed on Railway: `https://curam-vault.up.railway.app`

---

## Recent Changes

### March 2026

- **News Digest** — new `/news-digest` page; topics with title + keywords, drag-to-reorder, enable/disable toggle; daily digest auto-run via `node-cron` at a user-configurable time and day selection (stored in `settings` table, applied immediately without restart); article fetching from RSS feeds + Google News keyword search (`newsAggregationService.js`); 72h recency filter with automatic 96h fallback when fewer than 3 articles match; relevance scoring by keyword term count; top 15 articles (600-char snippets) passed to Gemini 2.5 Pro → Claude Sonnet fallback for analysis; prompt framed as a daily intelligence briefing — asks for what specifically changed today, not background; JSON schema includes `timeline`, `keyFacts`, `mechanisms`, `actorMotivations`, `uncertainties`, `sourceCredibility` (all optional, generated only when supported by articles); rolling 7-day context (prior summaries + user commentary) injected into each run; per-topic Q&A chat with 7-day context window; user commentary auto-saved and used as editorial input for next day; date navigation with jump-to dropdown; copy button (⎘) in expanded card header copies full analysis as Markdown; manual Generate now / Refresh always force-regenerates (deletes and re-runs, bypassing idempotency); scheduled cron remains idempotent; Settings → News Digest tab: time picker, day-of-week toggles, source toggle list, add custom RSS URL; 5 new DB tables: `news_topics`, `news_digests`, `news_digest_topics`, `news_digest_context`, `news_chat`; `node-cron` and `rss-parser` added to dependencies; see [News Digest — How Information is Extracted](#news-digest--how-information-is-extracted) for full pipeline documentation

- **Client Management** — new `/clients` page and `/clients/:id` detail page; client records with name, company, status (Prospect / Active / Paused / Archived), communication preference, tags, notes; client contacts sub-table; client touchpoints (calls, emails, meetings) with AI-generated summaries; link clients to projects and invoices; mood summary pulled from project check-ins; Gmail integration: `@gmail` search filtered to client email domain; `clients`, `client_contacts`, `client_touchpoints` tables; `clientId` FK added to `projects` and `fin_invoices`

- **Curam Finance module** — full bookkeeping and invoicing module at `/finance`; 8-tab layout (Dashboard, Invoices, Clients, Expenses, Wages, Journal, BAS, Settings); double-entry journal auto-generated for every transaction; invoice numbers auto-sequenced `INV-YYYY###`; invoice email via MailChannels TX API with styled HTML template (or SMTP fallback); Draft + Sent invoices editable (journal deleted and recreated on save); Paid invoices read-only; Resend button for Sent invoices; expense GST auto-calculated as total ÷ 11 when "GST Included" ticked; category autocomplete from `GET /expenses/categories` (no hardcoded list); expense edit with journal reversal; BAS on **cash basis** — GST collected from `paidAt` date not issue date; all destructive actions use `ConfirmModal`; success/error feedback via `Toast` (new `toastStore.js` Zustand store + `Toast.jsx` component mounted in `Layout`); 8 `fin_*` tables added to `db.js` init schema; route registered at `app.use('/api/finance', ...)`; 💰 nav icon added to top bar
- **Finance — PDF invoices, BAS workflow, receipt uploads, overdue flagging** — PDF invoice download generated server-side via `@react-pdf/renderer` (ESM, loaded with dynamic `await import()` from CJS server); gold-branded A4 layout with logo, line-item table, GST subtotals and bank payment footer; served from `GET /api/finance/invoices/:id/pdf`; BAS reconciliation status bar (Open → Reconciled → Lodged → Paid) with timestamps and locked notice on paid quarters; BAS paid auto-generates a `bas` journal entry; pre-reconcile warnings modal (amber) checks for G1/G11=0, negative net GST, 1A mismatch, and unpaid invoices raised in the quarter (`GET /bas/:quarterId/warnings`); lodge confirmation shows G1/1A/1B/net GST figures; Annual BAS Summary panel (right side of BAS tab) with financial-year navigation and a row-click that syncs the left panel's quarter; receipt upload on expenses — multer disk storage under `uploads/receipts/`, `receipt_path` column on `fin_expenses`, drag-and-drop upload modal, PDF iframe / image viewer modal, remove with ConfirmModal; paperclip icon on expense rows (amber = has receipt); overdue invoice badge — `displayStatus()` helper returns `'overdue'` for `sent` invoices past their due date; filter tabs on the invoice list (All / Draft / Sent / Overdue / Paid); Dashboard splits Outstanding into Outstanding and Overdue cards; Finance Settings adds Account Name field; `apiClient.js` extended with `postForm()` for multipart uploads; `ConfirmModal` message prop changed from `<p>` to `<div>` to support JSX content
- **File Preview Drawer** — eye icon on every file card in the Project Files panel and Compare vault picker opens a `FilePreviewDrawer` component; PDF pages rendered visually via pdfjs-dist (lazy loads 3 pages at a time on scroll); XLSX/ODS multi-sheet spreadsheets rendered as tables with sheet tabs; CSV as a flat table; DOCX/Word as plain text; all other files as a styled `<pre>`; "Attach" button inside the drawer adds the file to the session context bar; full-screen on mobile, 640 px fixed panel on desktop; ESC / backdrop closes and restores keyboard focus; `GET /api/files/:id/raw` endpoint added to serve the raw file binary for client-side rendering
- **User profile & LLM personalisation** — new Profile section at the top of Settings (first name, city, state, country); stored as `user_name`, `user_city`, `user_state`, `user_country` in the `settings` table; each field saves on blur (country saves on change); on every chat request the browser sends `userTimezone` (from `Intl.DateTimeFormat().resolvedOptions().timeZone`); Block 5 of `buildSystemPrompt` queries these four keys and injects "You are speaking with [name], located in [city, state, country]. Default all research, prices and recommendations to their country and currency. Their current local time is [time]." — only the fields that are set are included; today's date in the system prompt also uses the user's local timezone rather than UTC
- **AI message timestamps** — each assistant response bubble shows the receive time in the hover action row (same row as bookmark/copy/download buttons); live messages are stamped with `receivedAt` at stream start; sessions loaded from history use the DB `createdAt`; time is formatted in the browser's local timezone via `toLocaleTimeString`
- **Quarterly recurring tasks** — "Quarterly" added as a recurrence option alongside Daily / Weekly / Fortnightly / Monthly / Annually; server advances the due date by 3 months on each completion
- **Calendar view improvements** — major rewrite of `TasksCalendar.jsx`; improved day/week/month/agenda sub-view rendering and drag-drop reliability
- **Eisenhower Matrix drag-and-drop** — tasks in the Matrix view are now draggable between quadrants; dropping a task on a different quadrant opens `MatrixMoveModal` showing the task title, a from→to quadrant pill, exactly what changes (⚡ Urgent flag and/or priority), and a one-line strategic implication ("Block dedicated time for this", "Consider delegating", etc.); confirming applies the changes via `PUT /api/tasks/:id`; Q3/Q4 moves only lower priority to Medium if the task was previously High — existing medium/low priority is preserved; drop zones highlight in the quadrant's accent colour during drag; done tasks are not draggable
- **YouTube transcript summarisation** — when a YouTube URL is pinned or refreshed, `summariseTranscript()` in `pinnedUrls.js` calls Claude Haiku to compress the raw transcript to ~20% of its original length (flowing prose, key points and specifics preserved); result stored in the new `transcript_summary` column on `pinned_urls`; transcripts under 5,000 chars are stored as-is without an API call; `chat.js` now injects `transcript_summary` when present instead of the raw transcript, significantly reducing context token usage; raw transcript always preserved for re-summarisation on refresh; graceful fallback to raw transcript if `ANTHROPIC_API_KEY` is absent or the Haiku call fails
- **RAG fallback cap + observability** — when embeddings are unavailable and full-text injection is used instead, the combined file content is now capped at 32,000 characters; if truncated, `[Content truncated — embeddings unavailable. Re-upload files to restore full RAG context.]` is appended; `console.warn` logs `[RAG FALLBACK] session=… project=… raw_chars=… capped_chars=…`; `ragFallbackActive: true` added to the usage SSE event so the client can surface it; the context bar in `ChatPage` now shows an amber ⚠ chip when fallback is active, with a tooltip explaining the cause and remedy
- **Anthropic prompt caching** — `buildSystemPrompt` in `server/routes/chat.js` now returns an array of `{ type, text, cache_control? }` content blocks instead of a flat string; blocks ordered: [1] persona + base instructions, [2] project brief, [3] global memory, [4] file/URL context (RAG chunks, full-text fallback, session files, pinned URLs — combined to respect Anthropic's 4-breakpoint limit); today's date and web-search notice form a final uncached block so they are always fresh; `prompt-caching-2024-07-31` added to the `anthropic-beta` header whenever cached blocks are present; Gemini path joins all block texts with `\n\n` and passes to `systemInstruction` as before; no behaviour change for Gemini
- **Recurring task delete modal** — deleting a recurring task now shows a 3-option modal (cancel / delete this task only / delete this and all future recurrences); all tasks in a series share a `recurrenceGroupId` UUID generated at creation and carried forward on each recurrence spawn; `DELETE /api/tasks/:id?stopSeries=true` deletes all non-done tasks in the group (cleaning up their subtasks first); existing series gain group IDs on next recurrence spawn
- **Task duplication** — copy icon on kanban cards duplicates the task with all fields intact (recurrence, `renewalDimension`, `keyResultId`, `estimatedMinutes`, `isUrgent`) plus all subtasks; `POST /api/tasks/:id/duplicate` endpoint
- **Eisenhower Matrix Q2 prominence** — Q2 (Schedule — Important, not Urgent) visually elevated in the Matrix view; two-column flex layout (Q2 at 58% width right, Q1/Q3/Q4 stacked at 42% left); Q2 has a stronger border, subtle surface tint, larger shadow, and bolder task titles; mobile-first — Q2 appears at top on small screens
- **Getting Started Tour** — Shepherd.js product tour on the Goals page that introduces the Getting Started Wizard before users run it; 6 steps in a warm, encouraging tone; "I'm ready" finish step does not auto-launch the wizard; `TOUR_KEY = 'vault_tour_getting_started_completed'` in localStorage; tour takes priority over the Goals tour when both are pending on `/goals`; replayable from Settings → Product Tours
- **Getting Started Wizard** — 7-step full-screen guided setup for the Goals page; steps: Personal Context (what matters most, what you're improving, life stage) → Mission Statement (Claude drafts from context, editable + regenerate) → First Objective (AI-suggested with colour picker, fully editable) → Key Results (3 AI-suggested, toggle/edit/add) → Connect Tasks (link existing open tasks to the objective) → Renewal Balance (four 0–10 sliders + streaming AI observation) → Review & Save (sequential save of mission, objective, KRs, task links, and completion flag); draft auto-saved to `localStorage`; wizard triggered automatically on first visit when no objectives exist; ✨ button in Goals header to reopen; Settings page "Redo Setup" button resets completion flag; `GET /api/goals/wizard/status`, `POST /api/goals/wizard/complete`, `POST /api/goals/wizard/reset`, `POST /api/goals/wizard/generate-mission`, `POST /api/goals/wizard/suggest-objective`, `POST /api/goals/wizard/suggest-krs`, `POST /api/goals/wizard/renewal-observation` — completion state stored in the `settings` table
- **Knowledge Graph — Phase 3: Proactive Insights** — Insights panel powered by Claude Haiku; analyses graph structure (orphaned nodes, cross-project semantic clusters, top-connected nodes) and generates 4–6 specific observations; each insight has a "Show me" button that highlights and zooms to the relevant nodes; insights cached in the `settings` table and refreshed on demand
- **Knowledge Graph — Phase 2: Semantic Connections** — `POST /api/graph/compute-semantic` SSE endpoint; file↔file similarity via pgvector SQL; note and session embeddings via Gemini; note↔note, file↔note, and session↔note comparisons; connections cached in the `graph_edges` table; dashed pink lines on canvas; "Find connections" / "Re-compute" button with live progress bar
- **Knowledge Graph — Phase 1** — New `/graph` route with a full-screen `react-force-graph-2d` canvas; all vault content (projects, files, notes, sessions, tasks, goals, pinned URLs) rendered as typed, shaped nodes; explicit structural edges; hover highlights adjacency; click opens node detail panel with "Go to" navigation; search, type filters, Insights panel, scale-aware logarithmic force layout
- **Prompt Chains** — New `/chains` page for building and running multi-step prompt sequences; output from each step passed as context to the next; per-step model selection; starter templates; SSE streaming
- **RAG (Retrieval-Augmented Generation) for file context** — replaces full pinned-file injection with semantic chunk retrieval; `pgvector` extension enabled on PostgreSQL; new `file_chunks` table stores text chunks with 768-dimensional embeddings from Google's `text-embedding-004` model (reuses the existing `GEMINI_API_KEY`); `server/services/chunker.js` splits extracted text into ~500-token chunks at sentence boundaries with 50-token overlap; `server/services/embeddings.js` calls the Google Generative AI SDK for embedding and exposes `retrieveRelevantChunks(queryText, projectId, topK)` which queries `file_chunks` using pgvector cosine similarity (`<=>` operator); file upload route chunks and embeds text immediately after extraction; chat route calls RAG first and injects the top-5 relevant chunks under `## Relevant context from project files`, falling back to full-text injection if `GEMINI_API_KEY` is absent or no chunks exist yet; session files (user-selected per session) continue to be injected in full as before; `server/scripts/migrateEmbeddings.js` back-fills embeddings for all existing files (`npm run migrate:embeddings`); requires no new environment variables — completely optional, zero behaviour change without `GEMINI_API_KEY`
- **Chat input performance** — eliminated keyboard input lag as conversations grow; `MemoMessageList` extracted as a module-level `React.memo` component so the message list bails out of re-rendering when only the input state changes; `handleOpenArtifact` signature changed to `(idx, blocks)` and memoised with `useCallback([], [])` — `extractCodeBlocks` is now computed inside `MessageBubble` via `useMemo` so no per-message closure is created in the parent; `handleRegenerate` and `handleBranch` wrapped in `useCallback` with explicit deps; `stableSuggestionSelect` uses a latest-ref pattern (`handleSendRef.current = handleSend` each render; stable `useCallback` reads through the ref) so `FollowUpChips` gets a stable prop without stale-closure risk; `@mention` query debounced 150 ms — `setShowMention` remains immediate while `setMentionQuery` (which triggers filtering) fires only after the user pauses typing; `extractCodeBlocks` import removed from `ChatPage` since it is now encapsulated in `MessageBubble`
- **Native AI web search** — Globe/Search toggle added to the chat header (on by default); Anthropic models use the `web_search_20250305` built-in tool with `max_uses: 3` and the `web-search-2025-03-05` beta header; Gemini models use Google Search grounding (`{ googleSearch: {} }` tool); provider detected automatically from the active model — no manual switching required; a `{ searching: true }` SSE event is emitted when the Anthropic model initiates a search, replacing the loading dots with a globe icon + "Searching the web…" in the message bubble; `isSearching` state exposed from `useChat` and aliased to `isAiSearching` in `ChatPage` to avoid collision with the existing `isSearching` search-UI state; system prompt includes a prompt-injection security notice when web search is on, instructing the model to treat all search results as untrusted external data and never follow instructions found in them
- **Today's date in system prompt** — current date (`YYYY-MM-DD`) injected into every chat's system prompt so the model always knows the current date and can correctly judge whether its training data is stale; applied regardless of whether web search is enabled
- **My Tasks "Invalid Date" fix** — `dueLabel()` in `ProjectList.jsx` was appending `T00:00:00` directly to `dateStr` without first checking for an existing time component; tasks with a time set (e.g. `2026-03-13T09:00`) produced `2026-03-13T09:00T00:00:00` — an invalid date string that rendered as "Invalid Date"; fixed by slicing to the date part first (matching the pattern already used in `TasksPage.jsx`'s `dueInfo()`)
- **Office file extraction** — `.xlsx`, `.xls`, `.ods` files parsed sheet-by-sheet into CSV text via the `xlsx` package; `.docx` and `.doc` files extracted via `mammoth`; extracted text stored as `extractedText` in the `files` table and AI-summarised on upload; works identically to PDFs for pinning and session context injection; `xlsx` and `mammoth` added to dependencies
- **Session files** — select any project library file to include in the current chat session only; files persisted to `session_files` table (survives page refresh within the same session); shown in a context bar above the message list; paperclip icon on each file card (turns primary colour when active); `POST /api/session-files/:sessionId`, `GET`, and `DELETE` endpoints added; `session_files` table created in `db.js` with cascade deletes
- **Project sidebar accordion** — clicking a project name now toggles its recent session list open/closed; only one project expanded at a time; sessions fetched lazily on first expand; chevron icon shows open/closed state; `+` button on hover starts a new chat for that project; clicking a session navigates directly into that chat
- **Milestones (CR04)** — `isMilestone INTEGER DEFAULT 0` column added to `tasks` table with partial index; milestone toggle in task form (amber pill, warns if no due date set) and Quick Capture (side-by-side with Urgent toggle); 🏁 badge on List, Kanban, and Tree view rows; amber diamond marker (rotated square) in Calendar view for milestone tasks — not draggable or resizable, done milestones grey; `isMilestone` copied on task duplication and included in CSV bulk import template; Goals page gains a **Milestone Timeline** per objective — collapsible (collapsed by default), sources milestones from tasks linked to that objective's Key Results via `WHERE keyResultId IN (...) AND isMilestone = 1`, overdue count badge on the chevron; Weekly Review Step 3 shows up to 2 non-done milestones per objective (amber=upcoming, red=overdue)
- **Code block rendering fix** — `@tailwindcss/typography`'s `prose` class was injecting backtick pseudo-elements (`code::before/after`) onto `<code>` elements inside react-syntax-highlighter and inline code; fixed by adding `className="not-prose"` to `CodeBlock`'s outer div and to the inline `<code>` element in `mdComponents.jsx`
- **Recurring tasks fix** — recurrence previously required a `dueDate` to fire; now uses today as the base date when none is set; added a `wasAlreadyDone` guard to prevent duplicate occurrences when updating an already-completed task
- **File card layout** — filename now uses `flex-1 min-w-0` with a two-row layout (name on top, badges below) so it is always visible regardless of how many action buttons are present
- **File library — attach from Project Files panel** — every file in the Project Files chat panel now has an **Attach** button; clicking it adds the file to the current message's attachments without re-uploading; use pin for files that should be present in all chats in a project, and Attach for on-demand per-message access; `ProjectFilesPanel`, `FileList`, and `FileCard` updated; `onAttach` callback wired from `ChatPage` via `attachExisting` in `useFileAttachment`
- **Markdown table rendering** — tables in AI responses, document compare, and debate now render with proper styling; `mdComponents.jsx` updated with `table`, `thead`, `tbody`, `tr`, `th`, `td` renderers; tables scroll horizontally on overflow rather than breaking layout
- **Anthropic SDK upgraded to 0.78.0** — `@anthropic-ai/sdk` updated from `^0.36.3` to `^0.78.0`; required for `anthropic.beta.files` API support; `beta.files.upload` and `beta.files.del` are now available
- **Chat context fix** — `betas: ['files-api-2025-04-14']` was incorrectly placed inside the message params object; moved to request options (`{ headers: { 'anthropic-beta': '...' } }` as second argument to `messages.stream()`); incorrect placement caused streaming failures when any file document block was present, breaking conversation context
- **Code file uploads** — new file types accepted: `.js`, `.jsx`, `.ts`, `.tsx`, `.php`, `.py`, `.css`, `.html`, `.sql`, `.sh`, `.env.example`; stored on disk with `.txt` appended to the extension (original filename kept in DB); `mimetype` forced to `text/plain` in the database; 500 KB hard limit with a clear error message; UTF-8 validation rejects binary files; all content passed through `server/utils/sanitiseCodeFile.js` before storage — prompt injection patterns replaced with a comment and a server-side warning logged; `.env` files (without `.example`) explicitly blocked; `FileUploader` now reads `allowedFileTypes` from the settings store instead of a hardcoded string, so the file picker respects user settings
- **Settings file type save** — `allowedFileTypes` in Settings → Upload File Types now persists to the database (`settings` table, key `allowedFileTypes`) via `POST /api/settings` on blur; on page load the value is fetched from `GET /api/settings` and synced to the Zustand store, so the setting survives across browsers and devices; previously the value was Zustand/localStorage only

- **Security hardening** — `store: false` added to every Anthropic API call (chat stream, summarisation, auto-title, suggestions, Gmail ask, NLP translation) opting out of Anthropic data retention; Gmail OAuth tokens (`accessToken`, `refreshToken`) encrypted at rest with AES-256-GCM via `server/utils/encryption.js` (`ENCRYPTION_KEY` env var, 64 hex chars); existing plaintext rows transparently handled and re-encrypted on next write; one-time migration script at `server/scripts/reencrypt-gmail-tokens.js`; rate limiting added to all Gmail endpoints (auth: 5/15 min, search/thread: 60/min, ask: 20/min); 500-char length cap on Gmail search `q` param
- **Gmail integration** — connect personal Gmail via Google OAuth 2.0 from Settings → Integrations; `@gmail` mention in chat opens a search modal; natural language queries translated to Gmail search syntax via Claude Haiku (`gmailNLP.js` service with `calculateDates()` for pre-computed date ranges — today/yesterday/this week/last week/month/year/quarter/Australian FY); browse results, attach email threads as context (`gmail://thread/<id>` URL attachments via `addManual()`); ask follow-up questions about any thread via SSE `/ask` endpoint with ownership-framing system prompt; refusal detection logged to console; `GMAIL_LIMITS` constants control max result counts (count:500/extract:200/list:50/prose:50); 45-case NLP test harness (`gmailNLP.test.js`)
- **Chat stream error handling** — `classifyStreamError` extended with a dedicated `billing` code for Anthropic credit exhaustion (HTTP 402 or "credit balance too low" message) and improved Gemini patterns (`API_KEY_INVALID`, `RESOURCE_EXHAUSTED`, `models/*/is not found`); unknown errors now surface the raw API message in the hint; chat error banner redesigned with per-code icons (🔑 auth, 💳 billing, 🤖 model, ⏳ rate limit, ⚠️ other) and distinct colours; billing errors styled orange with a direct link to `console.anthropic.com/settings/billing`; `preflightError` state in ChatPage surfaces key-missing errors before any API call is made, avoiding wasted requests
- **Search — chat result navigation fixed** — clicking a message result in the global search palette now opens the correct chat session; `search.js` extracts the `sessionId` from the stored `Chat: <id>` title, looks up the session's human title from the `sessions` table, and returns both; `SearchPalette.navigateTo` now uses the same navigate-then-dispatch pattern as the history page (`vault:load-session` event after 80ms); general chat sessions (no project) correctly navigate to `/chat` instead of `/projects/null/chat`
- **Dynamic AI Model Management** — models are now managed from Settings → AI Models; add, edit, delete, and reorder models without a code deploy; model list stored in `settings.vault_models` (JSON) with static `utils/models.js` as fallback; `useModels` hook used by ChatPage and SettingsPage for a single source of truth; API key status shown per model (✓ / ⚠️); Test button sends a live probe via `POST /api/chat/test-model` and reports success or classified error (auth, billing, model not found, rate limit); pre-send validation in ChatPage blocks requests when the provider key is missing; `GET /api/chat/model-status` endpoint returns `{ anthropic: bool, gemini: bool }` for key config checks
- **Renewal Dimension Tracking (Habit 7)** — tag any task or objective with 🏃 Physical / 📚 Mental / 🤝 Social / 🌱 Spiritual; emoji pills on task cards; dimension chip row in filter bar; dimension prefix in Matrix view insight line; Renewal Balance Dashboard on Goals page (4 dimension cards + balance bar + nudge + AI Assessment SSE via Claude Haiku); Renewal This Week row in Weekly Review Step 3 (4 icons + per-dimension count + red dot if zero); `?view=matrix` and `?section=renewal/mission` query params for deep-linking
- **7 Habits Sidebar Navigation** — collapsible section in ProjectSidebar; 3 links: 🧭 Mission Statement (`/goals?section=mission`), ⚡ Priority Matrix (`/tasks?view=matrix`), 🌱 Renewal Balance (`/goals?section=renewal`); state persisted in `localStorage sidebarHabitsOpen`
- **Eisenhower Matrix** — new 4th Tasks view (`m` shortcut or view toggle); 2×2 Priority Matrix grid (Q1 Do First / Q2 Schedule / Q3 Delegate / Q4 Eliminate); `isUrgent` toggle in task form and Quick Capture; ⚡ Urgent badge on list and board cards; insight line summarising most critical quadrant; "Show completed" toggle in matrix sub-header
- **Personal Mission Statement** — compass-guided north star card at the top of Goals page; 4-step Claude wizard generates a personalised statement via SSE streaming; statement shown as context banner in Weekly Review Step 1
- **TasksPage refactoring** — `TasksPage.jsx` split into focused sub-components under `components/tasks/`: `TaskFilters` (quick-filter chips, dropdowns, search, sort), `TaskStatsBar` (6-card stats bar + 14-day chart), `TaskTemplatesPanel` (templates side panel with internal form state), `FocusMode`, `WeeklyReviewModal`, `TaskImportModal`; no behaviour or API changes — pure structural extraction
- **Time-Blocking Calendar** — full rewrite of `TasksCalendar.jsx`; day/week/month/agenda sub-views (persisted in `localStorage`); task blocks absolutely positioned on a 24-hour CSS Grid (`64px` per hour); drag-drop tasks to reschedule (updates `dueDate` via `PUT /api/tasks/:id`); drag from unscheduled panel to assign a time; resize block bottom edge to update `estimatedMinutes` (snaps to 15-min); current-time red indicator line; inline popover on block click; click empty slot opens New Task form pre-filled with that datetime
- **Task Dependencies** — `task_dependencies` table; `blockerCount` computed field on every task response; dependency UI in expanded task row (Blocked by + Blocking subsections with live search to add blockers); `🔒` badge on cards with incomplete blockers; blocker-confirm warning when marking a blocked task done; circular dependency detection via BFS on `POST /api/tasks/:id/dependencies`
- **Focus Mode (Pomodoro)** — `FocusMode.jsx` full-screen overlay; four timer modes (Focus 25m / Short break 5m / Long break 15m / Custom); SVG ring progress indicator; subtask checklist; Web Audio API beep (440Hz sine, 0.3s) at timer zero; auto-start breaks/focus toggles; session counter (N of 4); settings persisted in `localStorage`; accumulated focus time logged to `timeSpentMinutes` on close; accessible via 🎯 card button or `Shift+F` on expanded task
- **Time Tracking** — `timeSpentMinutes` column on `tasks` (via migration); per-card ⏱ stopwatch button (one timer at a time); running `⏱ title — HH:MM:SS` indicator in toolbar; time pill on task cards; expanded view shows logged time vs estimate with progress bar; 6th **Time Logged** stat card in toolbar; `timeSpentMinutes` included in CSV import and public shared-task response
- **Natural Language Due Dates** — single text input replaces separate date+time fields in the task form; `parseDate.js` utility handles: `today`, `tomorrow`, `yesterday`, `next friday`, `this monday`, `in 3 days/weeks/months`, `end of week/month`, `mar 15`, `15/03`, `2027-03-15`, `tomorrow 3pm`, `friday 14:30`; live green "Resolved: …" preview; amber warning when unparseable; 📅 icon opens native date picker fallback
- **Goals (OKR-lite)** — new `/goals` page with two-panel layout; create Objectives with timeframe and colour; add measurable Key Results (target value, current value, unit); progress bars colour-coded green/amber/red; AI Suggest KRs streams SMART Key Result suggestions via Claude; inline editing throughout; Goals widget on home page shows active count, average progress, and top 3 progress bars; Goals section in Weekly Review Step 3 for end-of-week KR updates
- **Key Result ↔ Task linking** — task form "Link to Goal" two-step dropdown (Objective → Key Result); linked tasks show a 🎯 badge with KR title on cards; completed linked tasks count toward KR task progress
- **Effort Estimation** — `estimatedMinutes` field on tasks; quick-select presets (15m / 30m / 1h / 2h / 4h / 1d / 2d) plus free-text input (`45m`, `3h`, `1.5h`); effort pill on list and kanban cards; "Total Effort" 5th stat card in toolbar (sum of incomplete tasks with estimates in current filter)
- **Weekly Review** — `w` keyboard shortcut or toolbar button opens a 3-step guided modal: (1) last week completed tasks grouped by category, (2) overdue carry-forward with mark-done / reschedule / remove-date actions, (3) week-ahead task list + Claude SSE focus suggestions + effort total + quick-add + Goals progress panel
- **CSV Import** — toolbar Import button opens modal; download CSV template; drag-drop or browse to upload; client-side parsing with quoted-field support; row-level validation (missing title, invalid priority/status, bad date format); preview table with per-row checkboxes; bulk `POST /api/tasks/import`
- **Public Task Sharing** — hover any task card to reveal share icon; generates a `shareToken` and public URL (`/shared/task/:token`); read-only view accessible without login (title, priority, status, notes, tags, subtasks); Revoke button deletes the token
- **Clipboard image paste** — paste screenshots or images directly into the chat input with Ctrl/Cmd+V; sent as inline base64, works in both project and General Chat without a file upload
- **Session delete from dropdown** — native `<select>` replaced with a custom dropdown; hover any session to reveal a trash icon with an inline confirmation; non-active sessions can now be deleted without switching to them first
- **General Chat** — project-free workspace at `/chat`; "General" section at the top of the sidebar with session list and new-chat button; sessions persisted with `projectId = null`
- **Chat History browser** — `/history` page with date filter chips (Today, Yesterday, This Week, Last 7 days, This Month, Last Month, Last 30 days, Custom), text search across title/project/content, click-to-navigate
- **Gemini models everywhere** — `gemini-2.0-flash` and `gemini-2.5-pro-preview-05-06` available in chat, document compare, and multi-model debate; centrally defined in `models.js` with `provider: 'gemini'`; server routes auto-detect and call Google SDK
- **`@search` web search** — type `@` in chat and select "Search the web"; results shown in a panel (title, snippet, clickable URL) before attaching as URL context; supports Brave Search (auto-detected via `BSA` key prefix), Serper.dev, and SerpAPI

### February 2026

- **Tasks** — full task manager at `/tasks` with List (grouped by category, drag-to-reorder), Kanban (3-column board, drag cards within/across columns), and Calendar (day/week/month/range, drag to reschedule) views; priority, due date + time, category, tags, project and parent task links; keyboard shortcuts (`n` new, `/` search, `f` cycle filter, `1-3` status filter, `b` cycle view, `?` help)
- **Task Templates** — save any task as a template; templates panel in sidebar; apply with one click to create a pre-filled task
- **Recurring Tasks** — set recurrence (daily/weekly/fortnightly/monthly/annually) on any task with a due date; new instance auto-created when marked done; ↻ badge with recurrence count on cards
- **Subtasks** — nested subtasks on any top-level task; expand row to add/complete; AI-generate subtasks from task title + notes
- **Task Comments & Activity** — per-task comment thread visible in expanded row; status/priority/due-date changes are auto-logged as system events
- **Quick Capture** — floating `+` FAB in bottom-right corner of every page; `Ctrl+Shift+N` from anywhere; opens minimal capture modal (title, priority, optional due date)
- **Morning Digest** — on first visit each day, overlay shows overdue + today's tasks with Claude-generated focus suggestion; dismissed once per day
- **Task Search** — global search palette (`Ctrl+K`) includes tasks (title + notes matching) alongside projects, files, and messages
- **`@mention` tasks in chat** — type `@` in chat input and scroll to Tasks section to attach a task's title, notes, and due date as conversation context
- **Multi-Model Debate** (`/debate`) — pit multiple Claude and Gemini models against each other; multi-file context; round navigation; NO_CHANGE detection; synthesis summary; save to project
- **Document Compare** (`/compare`) — compare two text blocks or vault files with any Claude or Gemini model; 4 modes (differences, similarities, improvements, summary); SSE streaming; save result to project
- **Admin Dashboard** (`/admin`) — stat cards for projects, sessions, messages, searches, debates, comparisons, and tokens; period selector (Today / Week / Month / Last month / 6 months / 12 months / Custom)
- **Password reset** — email-based flow at `/reset-password`; token stored in `password_resets` table with 1-hour expiry; `APP_URL` env var controls the link domain
- **Token budget alerts** — set a per-session cost limit in Settings; amber warning at 80%, red at 100% with a direct "Summarise now" button
- **Password show/hide** — eye icon toggles visibility on all password fields (login, change password, reset password)
- **Voice input** — mic button in chat toolbar starts browser-native speech recognition (`continuous: true`); dictation persists across natural pauses; red pulsing dot + live accumulated transcript shown while recording; separate **Stop** button commits the full session transcript to the input field; `no-speech` errors suppressed in continuous mode; hidden in unsupported browsers
- **Read aloud** — speaker icon in the action row below the last assistant message reads it via browser TTS; **Pause/Resume** toggle (pause ↔ play icon) and **✕ Stop** button replace the speaker icon while audio is active; action row stays fully visible during playback; only the most recent AI response is ever spoken; no external service required
- **Knowledge Graph filter improvements** — filter state persisted to `localStorage` (`graph_filter_prefs`); Finance node types default to hidden; preset buttons (**All / Work / Tasks & Goals / This Project**) set filter state in one click; active preset highlighted; "This Project" traverses graph edges to isolate a project's connected subgraph

### Earlier

- **Security hardening** — SSRF blocked in all URL-fetch routes (DNS-based private IP check); path traversal fixed in file upload; login brute-force rate-limited; HTML escaping in email export; web search rate-limited; 2 MB response cap on URL fetching
- **Mobile-responsive** — sidebar becomes a slide-over drawer; chat header collapses on small screens; artifact and file panels open full-screen on mobile; iOS keyboard zoom prevented; safe-area insets for notch and home bar

---

## Curam Finance

A lightweight bookkeeping and invoicing module built into Curam Vault. Purpose-built for a single-person Australian services business — not a replacement for MYOB or Xero. Accessible via the 💰 icon in the top nav at `/finance`.

### Features

| Feature | Description |
|---|---|
| **Dashboard** | YTD revenue (paid invoices), outstanding amount + count, overdue amount + count (sent past due date), YTD expenses, YTD wages, estimated net profit |
| **Invoices** | Create invoices with line items (description, qty, unit price, GST toggle); auto-generated invoice numbers (`INV-YYYY###`, resets each year); Draft → Sent → Paid workflow |
| **Invoice email** | "Send" button opens a recipient email modal; invoice rendered as a styled HTML email and sent via MailChannels TX API (or SMTP fallback); marks invoice as Sent on delivery; "Resend" available for Sent invoices |
| **Invoice editing** | Draft and Sent invoices are fully editable; journal entry deleted and recreated on each save to keep the ledger in sync; Paid invoices are read-only |
| **Invoice PDF download** | Download button on each invoice row generates a branded PDF (gold header, logo, line-item table, GST subtotal, payment instructions) server-side via `@react-pdf/renderer`; served from `GET /api/finance/invoices/:id/pdf` |
| **Overdue invoice flagging** | Invoices in `sent` status with a `dueDate` in the past show a red `Overdue` badge (computed `displayStatus()` — not stored in DB); filter tabs across the invoice list: All / Draft / Sent / Overdue / Paid |
| **Mark Paid** | Marks invoice as paid with today's date; auto-generates a journal entry (DR Bank, CR Accounts Receivable) |
| **Clients** | Client directory with name, email, phone, ABN, address; client email pre-filled in invoice send modal |
| **Expenses** | Record expenses with total-paid amount; GST auto-calculated as amount ÷ 11 when "GST Included" is ticked; ex-GST amount and GST stored separately; edit mode with full journal reversal |
| **Category autocomplete** | Expense category field shows a live dropdown of previously used categories pulled from `GET /expenses/categories` — no hardcoded list |
| **Receipt uploads** | Attach a receipt image or PDF to any expense; paperclip icon on each expense row (amber = has receipt); upload modal with drag-and-drop; viewer modal (PDF iframe or image); remove with ConfirmModal; stored under `uploads/receipts/` via multer; `receipt_path` column on `fin_expenses` |
| **Wages** | Record wage payments with gross, tax withheld, superannuation, and net pay; gross/net auto-calculated as tax changes |
| **Double-entry journal** | Every invoice, expense, and wage auto-generates balanced journal entries; viewer tab shows all entries with debit/credit breakdown by account |
| **BAS (cash basis)** | Australian Business Activity Statement — calculates GST collected from *paid* invoices in the quarter (`paidAt` date, not issue date); GST credits from expenses; PAYG withholding from wages; displays G1/G11/1A/1B/W1/W2 fields |
| **BAS reconciliation workflow** | Status bar shows current quarter status (Open → Reconciled → Lodged → Paid) with timestamps; action button advances the status; Paid quarters are locked (read-only notice); BAS paid auto-generates a journal entry (type `bas`); status and timestamps stored in `fin_bas_quarters` table |
| **BAS warnings** | Before reconciling, frontend checks (G1=0, G11=0, negative net GST, 1A≠G1÷11) and a backend query for unpaid `draft`/`sent` invoices raised in the quarter period; `WarningsModal` shows amber warnings and a table of at-risk invoices; user can Go Back or Proceed Anyway |
| **BAS lodge confirmation** | Lodge-with-ATO step shows a summary of G1, 1A, 1B and net GST figures inside the confirmation modal before the user commits |
| **Annual BAS summary** | Panel to the right of the BAS form; prev/next financial year navigation; table of all 4 quarters with cash-basis figures, GST owed, and colour-coded status badges; clicking a quarter row syncs the left panel to that quarter |
| **Chart of accounts** | 9 default accounts seeded per user on first use: Bank/Cash (1000), AR (1100), GST Paid (1200), AP (2000), GST Collected (2200), Equity (3000), Income (4000), Expenses (5000), Wages (6000) |
| **Finance Settings** | Business name, ABN, address, bank details (BSB, account number, account name, bank name) stored as `fin_*` keys in the existing `settings` table; injected into invoice emails and PDF footer |
| **Confirm modals + toasts** | All destructive actions (delete invoice, expense, wage, client, remove receipt) use `ConfirmModal`; success/error feedback via `Toast` component (bottom-right, auto-dismiss) |

### Database Schema (`fin_` prefix)

| Table | Key columns |
|---|---|
| `fin_accounts` | userId, code, name, type (asset/liability/equity/income/expense), isSystem |
| `fin_clients` | userId, name, email, phone, address, abn |
| `fin_invoices` | userId, clientId, number (UNIQUE per user), status (draft/sent/paid/void), issueDate, dueDate, subtotal, gst, total, notes, paidAt |
| `fin_invoice_items` | invoiceId (CASCADE), description, qty, unitPrice, gst, amount |
| `fin_expenses` | userId, date, description, amount (ex-GST), gst, category, supplier, receipt_path (nullable — path to uploaded receipt file) |
| `fin_wages` | userId, date, employee, gross, tax, superannuation, net |
| `fin_journal_entries` | userId, date, description, reference, type (invoice/payment/expense/wage/bas/manual), sourceId |
| `fin_journal_lines` | entryId (CASCADE), accountId (RESTRICT), debit, credit |
| `fin_bas_quarters` | userId, year, quarter (1–4), status (open/reconciled/lodged/paid), reconciledAt, lodgedAt, paidAt; upserted on every BAS page load |

**Auto-generated journal entries:**
- Invoice created → DR Accounts Receivable, CR Income, CR GST Collected
- Invoice paid → DR Bank, CR Accounts Receivable
- Expense recorded → DR Expenses (ex-GST), DR GST Paid, CR Bank (total paid)
- Wage payment → DR Wages, CR Bank (net), CR Accounts Payable (tax withheld)

---

## ToolsForge

A multi-user modular platform for teams — role-based access, org-scoped AI agents, shared data services, and a reusable agent platform layer.

**Stack:** Node.js/Express · React/Vite · PostgreSQL 15 + pgvector · Anthropic Claude · Railway
**Auth:** JWT session tokens, role-based permissions (org_admin / org_member), per-tool permission scopes
**Status:** Active development

---

### Platform Architecture

```
client/src/                     React/Vite SPA
  stores/                       Zustand (authStore, toolStore)
  tools/                        Per-agent UI modules
  utils/apiClient.js            Fetch wrapper with 401 interception

server/
  middleware/requireAuth.js     JWT auth + requireRole factory
  services/permissions.js       PermissionService — hasRole, isOrgAdmin, canUseModel
  services/AgentOrchestrator.js Tool-agnostic ReAct loop (Claude ↔ tools)
  services/ToolRegistry.js      Per-tool-slug tool registration + permission filtering
  services/StateManager.js      Agent key-value memory + conclusion persistence
  services/AgentScheduler.js    Full-featured cron scheduler → agent_executions
  platform/createAgentRoute.js  Factory: POST /run (SSE) + GET /history → agent_runs
  platform/AgentScheduler.js    Lightweight cron wrapper → agent_runs (shared with route)
  routes/stream.js              Generic SSE streaming for chat tools
  routes/agents/                One file per agent, wired via createAgentRoute
  db.js                         initializeSchema() — all DDL here, idempotent on startup
```

---

### Agent Platform Primitives

All primitives are reusable by any future agent. Adding a new agent requires only `tools.js`, `prompt.js`, and one route file.

#### `createAgentRoute({ slug, runFn, requiredPermission })`

Location: `server/platform/createAgentRoute.js`

Returns an Express router with two endpoints:

| Endpoint | Auth | Description |
|---|---|---|
| `POST /run` | requireAuth + requireRole([org_admin, permission]) | SSE stream — calls runFn, persists to agent_runs, emits progress → result → [DONE] |
| `GET /history` | requireAuth | Last 20 runs for this slug + org, ordered by run_at DESC |

Internal helpers (zero agent-specific code):
- `extractToolData(trace)` — walks AgentOrchestrator trace steps, keys tool results by name into a JSONB-ready object
- `extractSuggestions(text)` — parses `### Recommendations` numbered list from agent result text; assigns priority (high/medium/low) by position
- `persistRun(...)` — exported; shared with platform/AgentScheduler

SSE events emitted: `{ type: 'progress', text }` · `{ type: 'result', data }` · `{ type: 'error', error }` · `[DONE]`

#### `AgentScheduler.register({ slug, schedule, runFn, orgId })`

Location: `server/platform/AgentScheduler.js`

Thin cron wrapper using `node-cron`. On each tick: resolves orgId from DB if omitted (single active org fallback), calls runFn, persists to agent_runs via shared persistRun. Logs success/failure. Zero agent-specific code.

#### `persistRun({ slug, orgId, status, summary, trace, tokensUsed, startTime })`

Exported from `createAgentRoute.js`. Single write path to `agent_runs` for both HTTP-triggered and cron-triggered runs.

#### `MarkdownRenderer` — `client/src/components/MarkdownRenderer.jsx`

Zero-dependency markdown renderer for all LLM text output. Handles `#`/`##`/`###` headings, `**bold**`, bullet lists, ordered lists, `---` rules, and paragraphs. Styling uses platform CSS vars throughout.

**Convention:** all agent UIs that display LLM text use `MarkdownRenderer`. Never use `<pre>` or `whitespace-pre-wrap` for agent output directly. Improvements to rendering are made once here and propagate to every agent.

#### `LineChart` — `client/src/components/charts/LineChart.jsx`

Zero-dependency SVG dual-axis line chart. Generic props: `data`, `xKey`, `leftKey`, `rightKey`, `leftLabel`, `rightLabel`, `leftFormat`, `rightFormat`, `leftColor`, `rightColor`. Use when Recharts is unavailable or a zero-dependency fallback is preferred.

---

### Database Schema

#### Agent Platform Tables

| Table | Key columns |
|---|---|
| `agent_runs` | id (UUID), org_id, slug, status (running/complete/error), summary (TEXT — agent result), data (JSONB — tool results keyed by name), suggestions (JSONB — [{text, priority}]), run_at, duration_ms, token_count |
| `agent_states` | org_id, tool_slug, session_id, key, value (JSONB) — key-value memory scoped per org + agent |
| `agent_conclusions` | org_id, tool_slug, run_id (UUID UNIQUE), result (TEXT), trace (JSONB), tokens_used (JSONB) — raw conclusion store |
| `agent_schedules` | agent_id (UNIQUE), tool_slug, org_id, schedule (cron), enabled, last_run_at, last_run_status |
| `agent_executions` | agent_id, org_id, trigger_type, status, result (JSONB), tokens_used — full execution history |

Index on `agent_runs`: `(org_id, slug, run_at DESC)`

---

### Agent Tools

#### Google Ads Monitor

| Detail | Value |
|---|---|
| Route | `POST /api/agents/google-ads-monitor/run` (SSE), `GET /api/agents/google-ads-monitor/history` |
| Schedule | `0 6,18 * * *` — 6am and 6pm UTC (4pm and 4am AEST) |
| Permission | `google_ads_monitor.run` (org_admin always allowed) |
| Data sources | Google Ads API v23 · GA4 Data API v1beta |
| Agent file | `server/agents/googleAdsMonitor/index.js` — `runAdsMonitor(context)` |

**Tools registered (ToolRegistry, slug `google-ads-monitor`):**

| Tool | Service method | Returns |
|---|---|---|
| `get_campaign_performance` | GoogleAdsService | Per-campaign: id, name, status, budget, impressions, clicks, cost (AUD), conversions, ctr, avgCpc |
| `get_daily_performance` | GoogleAdsService | Daily: date, impressions, clicks, cost (AUD), conversions |
| `get_search_terms` | GoogleAdsService | Top 50 terms by clicks: term, status, impressions, clicks, cost, conversions, ctr |
| `get_analytics_overview` | GoogleAnalyticsService | Daily GA4: date, sessions, activeUsers, newUsers, bounceRate |

**React UI** (`client/src/tools/GoogleAdsMonitor/`):

| Component | Data source | Description |
|---|---|---|
| `GoogleAdsMonitorPage.jsx` | GET /history + POST /run SSE | Top-level page; fetches latest run on mount, streams new runs, refreshes history on completion; indeterminate sweep progress bar + elapsed timer while running; Full Analysis rendered via `MarkdownRenderer` |
| `CampaignPerformanceTable.jsx` | `run.data.get_campaign_performance` | name · status badge · impressions · clicks · CTR · cost (AUD) · conversions · CPA |
| `SearchTermsTable.jsx` | `run.data.get_search_terms` | term · clicks · impressions · CTR · cost · intent bucket (Converting / Wasted Spend / Ad Copy Oppty / Standard) |
| `PerformanceChart.jsx` | `run.data.get_daily_performance` | Recharts dual-axis LineChart — Spend (AUD, left) + Conversions (right); custom AUD tooltip |
| `AISuggestionsPanel.jsx` | `run.suggestions` | Priority-badged cards — high (positions 1–2) / medium (3–5) / low (6+) |

**Intent bucket logic (derived from metrics, no AI call):**
- Converting → `conversions > 0`
- Wasted Spend → `clicks >= 5 && conversions === 0`
- Ad Copy Oppty → `impressions >= 100 && ctr < 0.05`
- Standard → everything else
- BAS paid → DR GST Collected (1A), CR GST Paid (1B), CR Bank (net GST owed)

**Updated UI** (`client/src/tools/GoogleAdsMonitor/GoogleAdsMonitorPage.jsx`):

The page was substantially extended. Current capabilities:

| Feature | Detail |
|---|---|
| Date range selector | Preset pills: Day / Week / Month / Qtr / Year / Custom. Active preset shown with primary-colour border. Custom reveals a numeric input (days). Sends `{ days: activeDays }` in the POST body. |
| Run history panel | Sidebar table showing all past runs — date, status badge, summary preview. Click any row to view that run in the main panel. Newest run is auto-selected after each new run completes. |
| Agent Settings panel | Collapsible panel. Loads from `GET /api/agent-configs/google-ads-monitor`. Editable fields: schedule (cron), lookback days, ctr_threshold_pct, wasted_clicks_threshold, impressions_min, max_suggestions. Save triggers `PUT /api/agent-configs/google-ads-monitor`. Saving a new lookback also syncs the date range preset. |
| ~70s run note | Small label next to Run Now button — "Typically takes ~70s" — sets user expectation before the run starts. |
| MarkdownRenderer tables | Full Analysis block now renders markdown tables as styled HTML tables (see MarkdownRenderer below). |

`fetchHistory(resetToLatest)` is the canonical history-load function. Pass `true` after a run completes to force-select the newest result; omit on mount to preserve user's current selection.

---

### Agent Configuration System

Two-store pattern: admin settings (security, cost, kill switch) stored in `system_settings`; operator/agent settings (analytical, scheduling) stored in `agent_configs`.

#### `AgentConfigService` — `server/services/AgentConfigService.js`

| Method | Storage | Description |
|---|---|---|
| `getAgentConfig(orgId, slug)` | `agent_configs` table | Returns defaults merged with stored JSONB. Gracefully falls back to defaults on DB error. |
| `updateAgentConfig(orgId, slug, patch, updatedBy)` | `agent_configs` table | Upserts config patch. Returns merged result. |
| `getAdminConfig(slug)` | `system_settings` table | Key: `agent_<slug_underscored>`. Returns defaults merged with stored JSON. |
| `updateAdminConfig(slug, patch, updatedBy)` | `system_settings` table | Saves merged config to system_settings. Returns merged result. |

Default values per slug are defined in `AGENT_DEFAULTS` and `ADMIN_DEFAULTS` constants at the top of the service. All methods return the full merged object — callers never see a partial config.

**Agent defaults (google-ads-monitor):**

| Key | Default | Description |
|---|---|---|
| `schedule` | `'0 6,18 * * *'` | Cron expression |
| `lookback_days` | `30` | Days of data to analyse |
| `ctr_threshold_pct` | `2.0` | CTR % below which campaigns are flagged |
| `wasted_clicks_threshold` | `5` | Clicks with zero conversions = wasted spend |
| `impressions_min` | `100` | Minimum impressions to flag Ad Copy Oppty |
| `max_suggestions` | `5` | Maximum recommendations to produce |

**Admin defaults (google-ads-monitor):**

| Key | Default | Description |
|---|---|---|
| `enabled` | `true` | Kill switch — false rejects all run requests |
| `model` | `'claude-sonnet-4-6'` | Claude model for analysis |
| `max_tokens` | `4096` | Output token cap |
| `max_iterations` | `10` | Maximum ReAct loop iterations |

#### `/api/agent-configs` Routes — `server/routes/agentConfigs.js`

| Endpoint | Auth | Description |
|---|---|---|
| `GET /:slug` | requireAuth | Returns agent config for the caller's org |
| `PUT /:slug` | org_admin | Updates agent config; calls `AgentScheduler.updateSchedule()` if schedule changed |
| `GET /:slug/admin` | org_admin | Returns admin config (model, cost guardrails, kill switch) |
| `PUT /:slug/admin` | org_admin | Saves admin config to system_settings |

#### `createAgentRoute` — Admin Config Enforcement

`createAgentRoute.js` now loads admin config before every run:

1. Loads `AdminConfig` via `AgentConfigService.getAdminConfig(slug)`
2. Checks `adminConfig.enabled` — if false, emits SSE error + `[DONE]` immediately (no agent code runs)
3. Passes `model`, `maxTokens`, `maxIterations` from admin config into the `context` object
4. Agent code reads `context.model` / `context.maxTokens` to forward to `AgentOrchestrator`

This means admin guardrails are enforced platform-wide. No agent can bypass them.

#### `AgentScheduler` Hot-Reload

`AgentScheduler` (`server/platform/AgentScheduler.js`) now tracks active jobs in a `_jobs` map.

| Method | Description |
|---|---|
| `register({ slug, schedule, runFn, orgId })` | Stops any existing job for this slug before registering the new one |
| `updateSchedule(slug, newSchedule)` | Stops existing cron task and re-registers with new expression — no server restart required |
| `getSchedule(slug)` | Returns the current cron expression for a slug |

Called from the `PUT /api/agent-configs/:slug` route when the `schedule` field changes.

#### Dynamic System Prompt — `buildSystemPrompt(config)`

`server/agents/googleAdsMonitor/prompt.js` exports `buildSystemPrompt(config)` instead of a static string. Live threshold values from the agent config are injected into the prompt at run time:

```js
buildSystemPrompt({ ctr_threshold_pct, wasted_clicks_threshold, impressions_min, max_suggestions })
```

This means operator changes to thresholds in the Agent Settings panel take effect on the next run without any code changes or server restart.

---

### Admin UI — Agents Page

`client/src/pages/AdminAgentsPage.jsx` — accessible at `/admin/agents` (org_admin only via sidebar).

Contains `AdminSettingsSection` which loads from `GET /api/agent-configs/:slug/admin` and allows editing:
- Kill switch (enabled toggle)
- Model selector (Haiku 4.5 / Sonnet 4.6 / Opus 4.6)
- Max output tokens
- Max iterations

Separate from the Agent Settings panel (analytical settings), which lives in the tool page itself.

**Error state design:** If the API call fails (e.g. first run before DB is seeded), a red inline error message is shown: "Could not load settings — {error}. Restart the server if this is the first run." — not a permanent loading spinner.

---

### Updated Database Schema

#### Agent Configuration Tables

| Table | Key columns |
|---|---|
| `agent_configs` | id (UUID), org_id (INT FK → organizations), slug (TEXT), config (JSONB DEFAULT '{}'), updated_by (INT FK → users), updated_at — UNIQUE(org_id, slug) |

Admin config is stored in the existing `system_settings` table under `key = 'agent_<slug_underscored>'`.

---

### Updated MarkdownRenderer

`client/src/components/MarkdownRenderer.jsx` now supports markdown tables:

- Consecutive `|`-prefixed lines are detected as a table block
- Separator rows (`| --- | --- |`) are filtered out before rendering
- Rendered as a styled `<table>` / `<thead>` / `<tbody>` consistent with platform CSS vars
- **Infinite loop guard:** The paragraph branch now always increments `i` to prevent browser hangs when a line starts with `#` but has no space (e.g. `#hashtag`) — previously matched no branch and looped forever

Table parsing helpers:
```js
function parseTableRow(row) {
  return row.split('|').slice(1, -1).map(c => c.trim());
}
function isTableSeparator(row) {
  return parseTableRow(row).every(c => /^[\s:-]+$/.test(c));
}
```

Also applies to `ChatPage.jsx` — assistant messages now render via `MarkdownRenderer` instead of `whitespace-pre-wrap`.
