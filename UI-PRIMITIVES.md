UI-PRIMITIVES.md — Curam-MCP
Status: Founding document — constitutional authority for all UI work in Curam-MCP Predecessors: Curam Vault (single-user) · ToolsForge (multi-user platform) Editorial position: ToolsForge is the forward-looking standard. Vault patterns are preserved where they represent something ToolsForge did not carry forward or something observably better. All conflicts are resolved explicitly. Annotation pass: Required before UI work begins. Work through the Annotation Required section at the end of this document. Add your resolution and reasoning to each open item, then remove the [DECISION REQUIRED] tag. Last updated: 2026-03-28

Opening Summary
Curam-MCP inherits a design character that is dense but not cluttered, professional but not corporate. Both predecessors favoured dark surfaces with primary-colour accents, compact typography, and restrained animation — the aesthetic of a tool built for people who spend hours inside it, not for first impressions. ToolsForge added structural rigour appropriate for a multi-user workspace: labelled navigation sections, persistent role and org signals in the chrome, and admin patterns that feel document-like rather than dashboard-like. Curam-MCP should feel like a natural evolution of that lineage — capable, legible, and calm.

1. Visual Language
[SECTION COMPLETE — paste content from Section 1 here]

2. Layout & Structure
Top-level shell
The authenticated shell has three fixed layers: a top nav, a left sidebar anchored below it, and a scrolling main content area that fills the remainder. The outer container uses:

css
Copy
min-height: 100vh;
min-height: 100dvh;
[FROM VAULT — ToolsForge used only min-h-screen, losing the mobile viewport fix. The dvh unit is essential for chat-style interfaces where the input must reach the visible bottom when the mobile browser chrome collapses. Reinstated for Curam-MCP.]

code
Copy
┌────────────────────────────────────────────────────────────┐
│  TopNav (h-14, 56px, fixed, z-50)                         │
├────────────┬───────────────────────────────────────────────┤
│            │                                               │
│  Sidebar   │  Main content                                 │
│  fixed     │  (flex-1, overflow-y-auto)                    │
│  220px /   │                                               │
│  56px      │  <Outlet />                                   │
│            │                                               │
└────────────┴───────────────────────────────────────────────┘
The sidebar is position: fixed; top: 56px; left: 0; bottom: 0. An in-flow spacer div mirrors the sidebar's current width in the main flex row so content never slides under it. Both animate with transition: width 200ms ease. [DELIBERATE — cleaner than Vault's full-height flex row, which required overflow: hidden on the outer container and constrained independent scrolling.]

TopNav
Height h-14 (56px), fixed top-0 left-0 right-0 z-50, background: var(--color-surface), bottom border 1px solid var(--color-border). Contains left to right: hamburger toggle (mobile only), brand name, global search bar (centred), user email, org name, role badge, logout control. All colours must use CSS custom properties — hardcoded Tailwind colour classes are not acceptable in this component. [MERGED DECISION — ToolsForge set 56px; Vault used 44px. The taller nav is adopted for Curam-MCP as the more appropriate scale for a multi-user workspace.]

The role badge renders at text-xs rounded-full px-2 py-0.5. org_admin: amber tint (bg-amber-100 text-amber-800). Member: muted surface pill. [DELIBERATE — role is surfaced persistently in the chrome so every user always knows their access level.]

Sidebar
Desktop. Fixed, top: 56px to bottom: 0. Width 220px expanded, 56px collapsed. Animates at transition: width 200ms ease. Background var(--color-surface), right border 1px solid var(--color-border).

Navigation is structured into named sections with text-xs font-semibold uppercase tracking-wider labels in var(--color-muted):

Dashboard — no label, always first
Tools — section label; lists tools filtered by getPermittedTools() for the current role
Admin — section label; visible only when isAdmin is true
Settings + collapse toggle — footer, separated by a top border
[DELIBERATE — labelled sections prevent cognitive overload as the tool count grows. This is the ToolsForge evolution from Vault's flat unlabelled header strip, and the correct architecture for a multi-tenant platform where admins and members see different navigation.]

Collapsed state. 56px icon rail. Label spans are removed from the DOM when collapsed is true; icons remain at 15px. The collapse toggle shows a chevron that rotates direction on state change. Collapse state persists in toolStore so it survives page reload. [DELIBERATE — the in-flow spacer technique means no content reflow occurs during collapse, only width animation.]

Mobile. A separate aside element starts at transform: translateX(-100%) and transitions to translateX(0) when open, at 200ms ease. A bg-black/40 backdrop renders at z-40 and dismisses the sidebar on tap. Mobile sidebar is always 220px — no icon-rail mode on mobile. Navigation link clicks auto-close the sidebar via an onLinkClick callback. [DELIBERATE — auto-close on navigation prevents the common failure mode of navigating with the overlay still visible.]

NavItem
jsx
Copy
<NavLink
  className="flex items-center gap-2.5 px-3 py-2 mx-2 rounded-lg transition-all text-sm"
  style={({ isActive }) => ({
    background: isActive ? 'rgba(var(--color-primary-rgb), 0.1)' : 'transparent',
    color:      isActive ? 'var(--color-primary)' : 'var(--color-text)',
    fontWeight: isActive ? 600 : 400,
  })}
>
  <span className="shrink-0" style={{ color: 'inherit' }}>
    {getIcon(iconName, { size: 15 })}
  </span>
  {!collapsed && (
    <span className="whitespace-nowrap overflow-hidden">{label}</span>
  )}
</NavLink>
The mx-2 insets the active tint away from sidebar edges. Icon colour inherits from the parent so it tracks active/inactive state without a separate assignment. [DELIBERATE — ToolsForge evolution from Vault's var(--color-bg) fill, which breaks on themes where bg and surface have low contrast. The translucent rgba(var(--color-primary-rgb), 0.1) tint works on every theme.]

Main content area
flex-1 overflow-y-auto. Fills the horizontal space the sidebar spacer does not occupy. Pages render via Outlet at full available height. Individual pages handle their own internal padding — p-6 for admin and settings pages, p-8 for the dashboard.

Chat page layout
The chat page imposes a flex-column structure inside the main content area. Each strip is flex-shrink-0 except the message list:

code
Copy
Chat header (h-12, 48px)  — session selector, model/persona pickers
Banners                   — persistent warnings, delete confirmations
Context bar               — files in context, collapsible [FROM VAULT]
Message list              — flex-1, overflow-y-auto
Error banner              — conditional, stream and API errors
Input area                — auto-sizing textarea + toolbar
The context bar is a flex-shrink-0 border-b strip visible only when files are in context. [FROM VAULT — Vault introduced this deliberately to make "what the model can see" explicit. ToolsForge matches the structure but did not document the pattern. Carry it forward.]

Dashboard layout
p-8 padded page. Greeting heading (text-2xl font-bold, heading font), org name subline in muted colour, responsive tool card grid: grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6. Below the grid: "Last used: Tool →" link when lastVisitedTool is set. [DELIBERATE — ToolsForge; no Vault equivalent.]

Admin page layout
Each admin page uses p-6 max-w-4xl mx-auto. Three parts: (1) header row with text-xl font-semibold title, optional description, right-aligned action buttons; (2) rounded-2xl border overflow-hidden container; (3) a table with thead column labels at text-xs uppercase tracking-wider in muted colour, tbody rows at px-4 py-3. The max-w-4xl mx-auto centering gives admin pages a contained, document-like feel. [DELIBERATE — ToolsForge; no Vault equivalent.]

Responsive behaviour
Primary breakpoint: md (768px). Below: sidebar hidden, hamburger shown, single-column layouts. Above: desktop sidebar visible. A secondary lg (1024px) applies only to the dashboard card grid (2 → 3 columns). Mobile inputs are forced to font-size: 16px !important globally to prevent iOS zoom-on-focus. [MERGED DECISION — ToolsForge evolved Vault's sm (640px) breakpoint to md (768px), the conventional tablet boundary. Adopted as the standard.]

Z-index conventions
Layer	Value
Backdrop behind dropdowns	z-10
Dropdown menus	z-20
Mobile sidebar backdrop	z-40
Desktop sidebar (fixed)	z-40
Modals	z-50
Mobile sidebar overlay	z-50
Toast stack	z-[9999]
[MERGED DECISION — ToolsForge used z-[100] for toasts; Vault used z-[9999]. Toast must clear third-party overlays. Vault's z-[9999] adopted.]

3. Component Patterns
Buttons
No dedicated <Button> component exists in either predecessor — all variants are composed inline. [DECISION REQUIRED — Curam-MCP should decide explicitly. See Annotation Required.]

Primary. px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-80 disabled:opacity-50, background: var(--color-primary).

Secondary / ghost. px-4 py-2 rounded-xl text-sm font-medium border hover:opacity-70, borderColor: var(--color-border), color: var(--color-text).

Danger. Same structure as primary, background: #ef4444, white text.

Icon button. w-8 h-8 flex items-center justify-center rounded-lg hover:opacity-70 transition-all. Used in toolbars, table action columns, header controls.

Toggle button. flex items-center gap-1 text-xs px-2 py-1 rounded-lg border. Active: primary-coloured border and text, no fill change. [DELIBERATE — border-colour change rather than fill preserves the low-key aesthetic across themes.]

Hover mechanism across all variants: opacity only. No colour shift on hover. [DELIBERATE — works across all themes without per-theme hover token definitions.]

Corner radius convention
Buttons and inputs: rounded-xl. Surface containers, cards, and modals: rounded-2xl. Apply consistently — do not mix within the same component. [MERGED DECISION — ToolsForge convention adopted over Vault's one-step-smaller scale.]

Form inputs and labels
jsx
Copy
<label className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
  style={{ color: 'var(--color-muted)' }}>
  Field name
</label>
<input
  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
  style={{
    background:   'var(--color-bg)',
    borderColor:  'var(--color-border)',
    color:        'var(--color-text)',
  }}
/>
Input background is var(--color-bg) — one step lighter than the surrounding card surface — making the field visually distinct without a heavy border. outline: none removes the browser default; focus is indicated by borderColor: var(--color-primary) on the focused element. The label pattern is the same metadata text style used for sidebar section headers and table column headers — one consistent idiom for all secondary labels.

Auto-expanding textarea: onInput sets height = 'auto' then scrollHeight; max height 160px enforced in JS. Textarea overflow is hidden at rest and auto on focus to prevent scrollbar flash.

Cards and surface containers
Standard card: rounded-2xl border p-6 space-y-4, background: var(--color-surface), borderColor: var(--color-border). The space-y-4 utility handles internal vertical rhythm without per-element margin work.

Sidebar section labels
jsx
Copy
<p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider"
  style={{ color: 'var(--color-muted)' }}>
  Section Name
</p>
This single pattern covers sidebar section headers, admin table column headers, and form field labels. Do not introduce a variant.

Tool cards (Dashboard)
Four-part vertical stack: icon (32px, var(--color-primary)), tool name (font-bold text-lg, heading font), description (text-sm flex-1 in muted colour), full-width primary launch button. Card: rounded-xl shadow-sm p-6 flex flex-col items-center text-center, background: var(--color-surface), border: 1px solid var(--color-border). [DELIBERATE — centred icon-forward layout positions each tool as a destination, not a menu option.]

Toast notifications
Container: fixed bottom-5 right-5 z-[9999] flex flex-col gap-2.

Each toast: px-4 py-3 rounded-xl border shadow-lg text-sm animate-fade-in, min-width 220px, max-width 360px. A coloured 6px dot precedes the message. An explicit × close button at opacity-40 hover:opacity-80. Auto-dismiss at 3000ms. Click-to-dismiss also supported.

Colour: success uses var(--color-primary) (branded, theme-aware); warning #f59e0b; error #ef4444. [DELIBERATE — success uses primary rather than a fixed green so it feels branded on any theme.]

Modals
fixed inset-0 z-50 flex items-center justify-center p-4. Backdrop: rgba(0,0,0,0.5). Panel: max-w-sm rounded-2xl border p-6 space-y-4, background: var(--color-surface). Dismiss: backdrop click, Escape key, and explicit × close button. [MERGED DECISION — ToolsForge added the explicit close button over Vault's backdrop-only dismiss. Adopted for accessibility.]

ConfirmModal pattern [FROM VAULT]: a confirmText prop enables a type-to-confirm input that disables the confirm button until matched. Used for high-stakes destructive operations only.

Inline destructive confirms
Delete actions show an inline "Delete? Yes / No" control in place rather than escalating to a modal. [FROM VAULT — reduces cognitive weight for routine deletions. Implement from the start in Curam-MCP.]

Inline banners
px-4 py-2.5 rounded-xl border flex items-center gap-2.5 text-xs. Colour sets hardcoded:

Error: background: #fff1f2, borderColor: #fca5a5, color: #991b1b
Warning: background: #fffbeb, borderColor: #fde68a, color: #78350f
Neutral: background: var(--color-surface), borderColor: var(--color-border)
Dropdowns
absolute right-0 top-full mt-1 rounded-xl border shadow-lg py-1.5 z-40, background: var(--color-surface). Items: full-width buttons at px-3 py-2 hover:opacity-70 transition-opacity. Dismiss via a fixed inset-0 z-10 click-catcher behind the panel.

Message bubbles — user
Right-aligned, max-w-[75%]. Bubble: rounded-2xl rounded-tr-sm, background: var(--color-primary), color: #fff, whitespace-pre-wrap. [FROM VAULT — the rounded-tr-sm directional corner signals message origin without an avatar.] Action controls render at opacity-0 group-hover:opacity-100.

Message bubbles — assistant
Left-aligned. Content renders via the markdown renderer. [DECISION REQUIRED — avatar character. See Annotation Required.] Action buttons (copy, TTS, bookmark) at opacity-0 group-hover:opacity-100, w-6 h-6 icon buttons with background: var(--color-surface), border: 1px solid var(--color-border).

4. Interaction & Animation
Transition conventions
All explicit micro-interactions use 200ms: sidebar width, mobile sidebar slide, sidebar chevron rotation. Tailwind utility classes resolve to 150ms by default — a mild inconsistency that should be resolved in Curam-MCP by setting a custom default duration. [DECISION REQUIRED — see Annotation Required.]

Sidebar collapse animates width only. Content uses overflow: hidden to clip labels. Icons remain visible at all widths.

Hover states
hover:opacity-70 or hover:opacity-80 universally. No colour shift on hover. [DELIBERATE — opacity-only hover works across all themes without per-theme hover variant definitions.]

Focus states
Inputs use outline: none; border changes to var(--color-primary) on focus. No global :focus-visible ring in either predecessor. [DECISION REQUIRED — Curam-MCP is multi-user; accessibility matters more. See Annotation Required.]

Streaming SSE content
Uses fetch + ReadableStream rather than EventSource, because POST requests are required to send the message payload. [DELIBERATE — both predecessors used this approach for the same reason.]

Event types: text (appended to content), usage (token counts), error (sets error state), [DONE] (marks complete). An AbortController in a ref handles cancellation on stop() or new send().

Content renders progressively without buffering — each text event triggers a re-render. [DELIBERATE — character-by-character appearance communicates "generating" rather than "loading".]

Wrap the message list in React.memo with explicit dependency control so delta appends only re-render the last message. [FROM VAULT — essential for long conversation histories.]

When a web search is in progress before the response begins, replace bounce dots with a globe icon + "Searching the web…" at text-xs var(--color-muted). [FROM VAULT.]

Model advisor intercept
Before sending, a pre-send step analyses the prompt. If the server recommends a different model, ModelAdvisorModal is shown. The user chooses to switch or proceed. [DELIBERATE — ToolsForge; acknowledges multi-model complexity without being blocking.]

Error surfacing
Four contexts:

Stream errors — inline banner below message list, #fff1f2 / #991b1b. Dismissable. Persist until dismissed.
Destructive confirms — inline "Delete? Yes / No". ConfirmModal only for high-stakes type-to-confirm operations.
Async background operations — toast (error type, #ef4444).
Form errors — inline text-xs rounded-lg panel, rgba(239,68,68,0.1) background, #ef4444 text.
[FROM VAULT — Vault documented this four-context classification explicitly. Maintain it consistently.]

Context switches
Page navigation renders the new page immediately — no animated transition. Chat history is local component state, cleared on unmount or explicit reset. [DEFAULT — both predecessors share this behaviour.]

Bounce vs spinner
Bounce dots = waiting for streamed content to begin. Spinner = waiting for a discrete operation to complete. Not interchangeable. [DELIBERATE — both predecessors agreed. Maintain consistently.]

5. UX Patterns & Behaviours
State management
Three Zustand stores, all persisted to localStorage. Storage keys namespaced to avoid collisions:

authStore (key: curam-mcp-auth):

js
Copy
{
  token: string | null,
  user: { email, org_name, roles: [{ name, scope_type }], first_name, last_name, phone } | null,
  setAuth(token, user), clearAuth(), logout()
}
settingsStore (key: curam-mcp-settings):

js
Copy
{ bodyFont, headingFont, theme, setBodyFont, setHeadingFont, setTheme }
toolStore (key: curam-mcp-tool):

js
Copy
{ lastVisitedTool, sidebarCollapsed, setLastVisitedTool, toggleSidebar, setSidebarCollapsed }
On 401 responses, the API client clears auth state and redirects to /login. This is the only place auth is cleared programmatically — never in component code.

API client
A centralised fetch wrapper auto-adds Authorization: Bearer ${token} from authStore and handles 401 globally. All authenticated API calls must go through this wrapper. Never use raw fetch('/api/...') for authenticated endpoints. [DELIBERATE — both predecessors enforced this.]

Optimistic UI
Local state updated before server confirmation for common mutations. Failures surface as inline errors and trigger a refetch. Refetch-on-failure rather than explicit rollback is sufficient for the current interaction surface.

Focus management
After modal close: return focus to the triggering element. Neither predecessor implemented this fully — do it from the start.
After send: textareaRef.current?.focus().
After inline panels close: textareaRef.current?.focus() explicitly.
Title inputs: setTimeout(() => inputRef.current?.focus(), 0).
Keyboard navigation
Global shortcuts fire custom DOM events rather than direct state calls. Namespace: curam-mcp:. [FROM VAULT — Vault used vault: prefixed events. Carry the pattern forward with the new namespace.]

Core shortcuts: Cmd/Ctrl+K — global search palette; Cmd/Ctrl+B — toggle sidebar; Enter — send message; Shift+Enter — newline; Escape — close modals, panels, dropdowns.

Global search palette: fixed inset-0 z-50, centred panel max-w-xl rounded-2xl, debounced input, results grouped by type, ↑/↓ keyboard navigation.

File attachment
Three paths: file picker, clipboard paste, drag-drop. All produce normalised attachment objects. Images resized client-side: max 800px, 0.75 JPEG quality, base64. Text files via FileReader if under 500KB. Inline images embedded as base64 only — no server file record required. [DELIBERATE — image-in-context does not require a file record.]

Allowed file types are an org-level admin setting fetched from the server on mount. [DELIBERATE — ToolsForge multi-tenant evolution from Vault's per-user setting.]

Icon system
IconProvider maintains a semantic name-to-Lucide mapping. Usage:

js
Copy
const getIcon = useIcon();
getIcon('message-square', { size: 14 })  // default size: 18px
New icons must be registered in the semantic map before use. Lucide imports are not used directly in component code. [DELIBERATE — decouples icon names from the library.]

Voice input and output
Input. useSpeechInput() — Web Speech API. Returns { listening, transcript, start, stop, clear, supported }.

Output. useReadAloud() — Speech Synthesis API. stripForSpeech() removes markdown before synthesis. Returns { speaking, paused, speak, pause, resume, stop, supported }.

Both follow the three-layer pattern: headless logic hook → UI button component → integration in page.

Three-layer usage pattern (canonical):
1. Headless logic — useSpeechInput() / useReadAloud()
2. UI button — MicButton (pulsing red ring when listening; renders null if unsupported) / ReadAloudButton (primary colour when speaking; renders null if unsupported)
3. Integration in page — compose MicButton on text inputs, ReadAloudButton beneath assistant replies

Reference implementations:
- AdminSqlPage — MicButton appends dictated text to query draft; ReadAloudButton reads query results aloud
- HistoryChat (GoogleAdsMonitorPage) — MicButton on conversation input with interim-result display ([speaking…]); ReadAloudButton under each assistant message; voice wired into a full streaming multi-turn conversation

Inline voice conversation pattern (HistoryChat):
An inline chat panel that creates a server-persisted conversation on first open, seeds it with context (e.g. run history digest), then supports multi-turn voice Q&A. Use this pattern wherever a tool page needs in-context NLP + voice without navigating away to the Conversation tab.

```
onOpen →
  POST /conversations { title }        → convId
  send(seedMessage)                    → streams first response
onSend(text) →
  POST /conversations/:id/message      → SSE stream
  progress events → show in UI
  result event → append assistant bubble + ReadAloudButton
MicButton.onResult → append to draft
MicButton.onPartial → update draft with [interim…] suffix
```

MicButton interim-result display pattern (copy this):
```js
<MicButton
  onResult={(text) => setDraft((d) => (d ? d + ' ' : '') + text)}
  onPartial={(t)   => setDraft((d) => d.replace(/\s*\[.*?\]$/, '') + ` [${t}]`)}
/>
```

Timezone handling
Priority: user setting → org default → browser (Intl.DateTimeFormat().resolvedOptions().timeZone). Resolved timezone used in system prompts and message timestamps. [FROM VAULT — Vault documented this priority chain explicitly.]

Admin config propagation
Org-level settings fetched from the server on component mount. Admin changes propagate to new mounts without a server restart. [DELIBERATE — ToolsForge; Vault stored these per-user in Zustand.]

lastVisitedTool
toolStore tracks the last tool navigated to. Dashboard renders "Last used: Tool →" on return visits. [DELIBERATE — returning users resume where they left off.]

Safe area insets
css
Copy
.pb-safe {
  padding-bottom: max(1.25rem, env(safe-area-inset-bottom));
}
Apply pb-safe to the chat input area on mobile to prevent the iOS home indicator from overlapping the send button.

6. Decisions Worth Preserving
CSS-variable theming — seven-token model [DELIBERATE — both predecessors]: all colour written by ThemeProvider to a style tag at runtime. Seed defaults in :root in index.css so the first paint is never unstyled.

--color-primary-rgb derived token [DELIBERATE — ToolsForge evolution]: decompose the primary hex to bare r,g,b, enabling rgba(var(--color-primary-rgb), 0.1) for translucent active states. Use for all active/selected tinted backgrounds.

Semantic colours hardcoded outside the token system [DELIBERATE — both predecessors]: error #ef4444, warning #f59e0b, success #22c55e do not change with theme. Success toasts use var(--color-primary) — the one exception.

No flash-of-wrong-theme [DELIBERATE — both predecessors]: seed CSS variables in :root; ThemeProvider overwrites from Zustand synchronously on mount before the first browser frame.

Two font axes with a global heading rule [DELIBERATE — ToolsForge evolution]: --font-body and --font-heading as separate settings. Global rule h1–h6 { font-family: var(--font-heading) } in index.css.

Opacity as the sole hover mechanism [DELIBERATE — both predecessors]: hover:opacity-70 or hover:opacity-80 universally. No colour shift.

Structured sidebar with labelled sections [DELIBERATE — ToolsForge]: named sections, collapse to 56px, in-flow spacer. isAdmin derived at AppShell level — single derivation point ensures sidebar and route guards never diverge.

Two-level elevation model [DELIBERATE — both predecessors]: only --color-bg and --color-surface. No third depth level.

Route-tree permission middleware [DELIBERATE — ToolsForge evolution]: RequireAuth and RequireRole as composable route elements, not in-page conditional JSX.

Tool registry as single source of truth [DELIBERATE — ToolsForge]: config/tools.js with getPermittedTools(). One registry entry to add a tool.

Roles as a scoped array [DELIBERATE — ToolsForge]: user.roles: [{ name, scope_type }]. Designed to extend to org-scoped and team-scoped roles without a schema change.

Admin config fetched from server on mount [DELIBERATE — ToolsForge evolution]: org-level settings fresh on every mount. Admin changes propagate without a page reload.

Agent system prompts configurable in admin [DELIBERATE — ToolsForge]: slug, name, system prompt, and model assignment stored in the database. Not embedded in code.

100dvh with 100vh fallback [FROM VAULT — reinstated]: min-height: 100vh; min-height: 100dvh. Essential for chat-style interfaces on mobile. Do not omit.

Context bar as explicit visibility signal [FROM VAULT]: pinned files distinguished from session files by border colour alone — var(--color-primary) for session files, var(--color-border) for pinned.

Inline destructive confirms, not modals [FROM VAULT]: "Delete? Yes / No" inline. ConfirmModal reserved for type-to-confirm high-stakes operations only.

Bounce dots vs spinner [DELIBERATE — both predecessors]: bounce = streaming pending; spinner = discrete async operation. Not interchangeable.

fetch + ReadableStream for SSE [DELIBERATE — both predecessors]: EventSource cannot POST. AbortController handles cancellation.

React.memo on message list [FROM VAULT]: delta appends only re-render the last message. Required for long conversation performance.

Success toasts use var(--color-primary) [DELIBERATE — ToolsForge evolution]: feels branded on any theme. Error and warning use hardcoded colours.

Explicit × close button on modals [MERGED DECISION — ToolsForge evolution]: adopted for accessibility. Backdrop click and Escape also dismiss.

org_name in auth state [DELIBERATE — ToolsForge]: surface in dashboard greeting and TopNav. Members always know which workspace they are in.

lastVisitedTool persisted in toolStore [DELIBERATE — ToolsForge]: quality-of-life detail with no implementation cost.

Tailwind configuration maps CSS variables to utilities [DECIDED]: configure bg-bg, text-primary, border-border etc. in tailwind.config.js. Continue using inline styles where variant syntax is cumbersome.

Corner radius: rounded-xl / rounded-2xl [MERGED DECISION]: buttons and inputs at rounded-xl, containers and modals at rounded-2xl. Do not introduce rounded-lg for new components.

pb-safe for iOS home indicator [FROM VAULT]: .pb-safe { padding-bottom: max(1.25rem, env(safe-area-inset-bottom)) }. Apply to chat input area on mobile.

Annotation Required
[MERGED DECISION] Tailwind configuration — RESOLVED. Configure CSS variable mapping in tailwind.config.js from the start. Continue using inline styles where variant syntax is cumbersome.

[MERGED DECISION] Toast z-index — adopted Vault's z-[9999] over ToolsForge's z-[100]. Confirm or override.

[MERGED DECISION] Corner radius convention — adopted ToolsForge's rounded-xl / rounded-2xl. Confirm or override.

[MERGED DECISION] Modal dismiss — adopted ToolsForge's explicit × plus backdrop and Escape. Confirm or override.

[MERGED DECISION] TopNav height — adopted ToolsForge's 56px over Vault's 44px. Confirm or override.

[DECISION REQUIRED] Button component — inline composition vs a Button abstraction. Choose one before UI work begins.

[DECISION REQUIRED] Markdown renderer — react-markdown + remarkGfm (full GFM, third-party) vs custom zero-dependency renderer (prose and tables only). Decide based on whether Curam-MCP tools will return code samples.

[DECISION REQUIRED] Assistant message avatar — Vault's ✦ symbol (personal, warm) vs ToolsForge's no avatar (generic, clean). Character call