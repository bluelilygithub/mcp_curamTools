# UI Primitives — Curam Vault

Curam Vault is a dense, single-user AI workspace with a calm, analogue character. The default palette is warm sand — off-white backgrounds, a muted terracotta accent, near-black text — giving it the feel of a considered personal tool rather than a SaaS product. The interface is compact: most chrome is either 44px or 48px tall, content areas use small text (12–14px), and whitespace is tight but not cramped. There are no decorative gradients, hero sections, or marketing-style layout — every surface exists to contain work. Interaction is low-key: hover states fade opacity rather than shift colour, transitions are 200ms, and destructive confirmations happen inline rather than escalating to modals wherever possible.

---

## 1. Visual Language

### Colour system

All colour is delivered through six CSS custom properties, resolved by a runtime ThemeProvider rather than Tailwind dark-mode classes. The properties are `--color-bg`, `--color-surface`, `--color-border`, `--color-primary`, `--color-text`, and `--color-muted`. Tailwind is configured to map these to utility classes (`bg-bg`, `text-primary`, `border-border`, etc.), but in practice most colour application in component code uses inline `style={{ color: 'var(--color-xxx)' }}` directly. [DELIBERATE] — this makes theme-switching a single DOM write without any class toggling or hydration concerns.

**Default theme (warm-sand):**
- `--color-bg`: `#F5F5F0` — page background, slightly warm off-white
- `--color-surface`: `#EEEEE8` — sidebar, header, cards, modal surfaces
- `--color-border`: `#D8D8D0` — all dividers and input borders
- `--color-primary`: `#CC785C` — terracotta; the sole accent colour for CTAs, active states, links in prose
- `--color-text`: `#1A1A1A` — near-black body text
- `--color-muted`: `#888888` — secondary labels, icons, placeholders

Five themes are available: warm-sand (default), dark-slate, forest, midnight-blue, paper-white. Each is a complete six-value token set. Dark themes follow the same variable names — no separate dark-mode stylesheet exists. [DELIBERATE] — the theming system deliberately avoids Tailwind's `dark:` variant so that the same component tree works for any palette without class duplication.

### Colour usage in practice

The distinction between `bg` and `surface` is used consistently: `bg` is the page canvas, `surface` is any raised element sitting on it (sidebar, header bar, modal background, dropdown, card). This two-level depth is the only elevation model — there is no third level. Borders always use `--color-border`. Primary is applied as: user message bubble background, active nav item colour, CTA button background, link colour in prose, active toggle border/colour. Warnings use hardcoded amber (`#f59e0b`, `#d97706`), errors use red (`#ef4444`, `#dc2626`, `#991b1b`) — these are not tokenised. [DELIBERATE] — semantic status colours are kept outside the theme system so they remain recognisable regardless of theme.

Specific inline uses in chat error banners show a three-tier classification: red backgrounds for auth/model/billing errors, amber for warnings and context length, yellow for informational notices.

### Typography

**Font family**: DM Sans for UI, DM Mono for code. Both are loaded from Google Fonts; the active font is swappable via settings. [DELIBERATE] — font is a user setting, not a build-time constant. The ThemeProvider injects `--font-sans` as a CSS variable and the Tailwind `font-sans` stack references that variable. Available options: DM Sans, Inter, Lato, Merriweather, JetBrains Mono.

**Scale in practice** (no Tailwind scale deviations — these are observations of actual usage):
- `text-xs` (12px): labels, meta, action buttons, badge counts, timestamps, context bar pills, toolbar controls
- `text-sm` (14px): sidebar nav items, message body prose, form inputs, dropdown options, most body text
- `text-base` (16px): modal titles, empty state headlines
- `text-lg` / `text-xl`: unused in standard UI chrome; not observed in components

**Weights**: 400 for body copy, 500 for navigation items and button labels, 600 for modal titles and section headings, `font-semibold` (600) for the "Project Vault" branding link. Bold (`font-bold`) appears only in inline keyboard shortcut keys and confirmation prompts.

`-webkit-font-smoothing: antialiased` is set globally. `tracking-tight` is applied to the branding link only.

### Dark/light mode

No OS-level `prefers-color-scheme` detection. Mode is an explicit user setting persisted in Zustand (`settingsStore`, key: `theme`). The ThemeProvider reads this setting and writes a `<style id="vault-theme-vars">` tag to `<head>` on mount and on change. Because Tailwind classes reference the CSS variables, the entire UI responds to the style tag update without re-render. [DELIBERATE] — this avoids flash-of-wrong-theme on page load, since the JS setting is read synchronously from `localStorage` via Zustand persistence before the first paint.

---

## 2. Layout & Structure

### Top-level structure

The authenticated shell is a full-viewport flex row: sidebar (fixed width) + main area (flex-1). Both use `height: 100dvh` on the outer container. [DELIBERATE] — `dvh` is used explicitly to handle mobile browser chrome collapse; a `min-height: 100vh` fallback precedes it in the global CSS.

```
┌──────────────┬────────────────────────────────────────┐
│              │  Header (h-11, 44px)                   │
│  Sidebar     ├────────────────────────────────────────┤
│  (240px)     │  Banners (flex-shrink-0, variable)     │
│              ├────────────────────────────────────────┤
│              │  Page content (flex-1, overflow-auto)  │
└──────────────┴────────────────────────────────────────┘
```

The main area is a flex column. The header is `flex-shrink-0 h-11`. Banners (context warnings, budget alerts, due-today notice) insert themselves as `flex-shrink-0` strips below the header. The page content area is `flex-1 overflow-auto`, meaning it fills remaining space and scrolls independently.

### Sidebar

Width: 240px, fixed. Background: `--color-surface`. Right border: `1px solid var(--color-border)`. Contains: ProjectSidebar component, which owns all project navigation, folder structure, and session lists.

**Mobile behaviour**: below 640px, the sidebar becomes `position: fixed`, covers full height, and slides in/out via `transform: translateX(-240px/0)` with a `transition: transform 0.2s ease`. A semi-transparent backdrop (`rgba(0,0,0,0.35)`) renders behind it on a separate `z-30` layer and dismisses it on tap. [DELIBERATE] — mobile sidebar is an overlay that does not push content, unlike desktop where it collapses the content area.

**Desktop collapse**: sidebar width animates from 240px to 0px via `transition: width 0.2s`. Content inside uses `overflow: hidden` so items do not bleed through. The toggle chevron icon rotates 180° when open, using an inline transform transition.

**Sidebar auto-close on mobile**: a `useEffect` watches `location.pathname` and closes the sidebar when it changes — navigation always dismisses the sidebar on mobile. [DELIBERATE] — avoids the common failure mode of navigating with the sidebar still visible.

### Header bar

Height: `h-11` (44px). Background: `--color-surface`. Bottom border: `--color-border`. Contains (left to right): sidebar toggle button, "Project Vault" branding link, flex spacer, search button (hidden on mobile), guide link (hidden on mobile), then a run of 7×7 icon buttons for primary navigation tools (Personas, Memory, Prompts, Notes, Clients, Tasks, Goals, History, Chains, Graph, Debate, Compare, Finance, Usage, Mood, News Digest, Admin, Settings, Logout). Most icon links are hidden on mobile via `hidden sm:flex`. [DELIBERATE] — the header is a persistent global navigation layer separate from the sidebar, oriented toward tool-switching rather than project navigation.

Icon buttons in the header follow a consistent size and hover pattern: `w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity`. Active state uses `var(--color-primary)` for icon colour, inactive uses `var(--color-muted)`.

Notification badges appear on Goals (mission reminder) and History (bookmarks): a `w-2 h-2 rounded-full` dot in amber (`#f59e0b`) positioned absolutely at `-top-0.5 -right-0.5`. [DELIBERATE] — badges use amber rather than red to avoid alarm; these are reminders, not errors.

### Chat page layout

The chat page adds a second flex column inside the main content area:

```
Header (h-12, 48px) — session picker, model/temp/persona toggles
Banners (variable) — delete confirm, summarise notice, budget alert, error
Context bar (flex-shrink-0) — files-in-context pills, collapsible
Message list (flex-1, overflow-y-auto)
Context warning / error banner (flex-shrink-0, conditional)
Input area (flex-shrink-0) — file bar, URL bar, textarea + toolbar
```

The chat header is 48px (`h-12`), one step taller than the global header. The input area is not given a fixed height; it grows with the textarea up to a max-height of 160px enforced by JS, then scrolls.

When the artifact panel is open, the chat column and artifact panel share a horizontal `flex` row (`flex flex-1 overflow-hidden`). The artifact panel pushes in from the right at a fixed width rather than overlaying.

### Z-index conventions

Observed values:
- `z-10`: click-dismiss backdrop behind dropdowns
- `z-20`: dropdown menus themselves
- `z-30`: mobile sidebar backdrop
- `z-40`: modal-like overlays (sidebar on mobile: `z-40`), picker dropdowns
- `z-50`: modals (ConfirmModal), fixed banners inside chat
- `z-[65]`: inquiry reminder banner (overrides most overlays)
- `z-[9999]`: Toast stack

No CSS variable system for z-index. Values are applied ad hoc in inline styles and Tailwind utilities. [DELIBERATE] — the Toast uses 9999 to ensure it is never covered by any other layer.

### Responsive breakpoints

Single breakpoint: `sm` (640px). Elements hidden on mobile use `hidden sm:flex` or `hidden sm:block`. The layout does not have a tablet-specific breakpoint. Below 640px: sidebar overlay, inputs forced to `font-size: 16px` (prevents iOS zoom-on-focus), several header icons hidden.

---

## 3. Component Patterns

### Sidebar navigation item

A standard nav item is a full-width button with `flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm`. Active state: `background: var(--color-bg)`, `color: var(--color-primary)`, `fontWeight: 500`. Inactive: transparent background, `var(--color-text)`, weight 400. Icons are rendered at 14px via `getIcon(name, { size: 14 })` with opacity 0.5 when inactive. Session sub-items indent further and use `text-xs` with `var(--color-muted)` colour.

Drag-and-drop reordering uses native HTML drag events. Drop targets get a visual indicator via `dragOverId` state but no animated insertion line — the item simply snaps on drop. [DELIBERATE] — drag-to-folder is separate from drag-to-reorder; folder drop zones are distinct from the reorder targets.

### Message bubble — user

Right-aligned, `max-w-[75%]`. Bubble: `px-4 py-3 rounded-2xl rounded-tr-sm` with `background: var(--color-primary)` (terracotta), white text. The `rounded-tr-sm` corners indicate message direction. [DELIBERATE] — user messages intentionally do not use a pure rectangle or full rounded pill; the flattened corner signals origin/direction without an avatar.

Image attachments display as `w-24 h-24 rounded-xl object-cover` thumbnails above the text. Non-image file attachments appear as small `rounded-lg` badges with primary background and white text.

Action controls (bookmark, branch, delete) render below the bubble at `opacity-0 group-hover:opacity-50`, scaling to full opacity on direct hover. Delete uses an inline two-step confirm ("Delete this exchange?" → Delete / Cancel) rendered inline in the action row, not a modal. [DELIBERATE] — inline confirm avoids focus disruption and keeps the destructive path visible in context.

### Message bubble — assistant

Left-aligned with a `w-7 h-7 rounded-full` avatar bearing the `✦` symbol in primary colour on a surface background. Prose renders via `ReactMarkdown` with `remarkGfm`, styled through the `.prose` class overrides in global CSS. `prose-sm max-w-none text-sm leading-relaxed` is the standard prose wrapper.

Thinking/reasoning blocks render as a collapsible toggle button above the content (`px-2 py-1 rounded-lg border` with CPU icon), revealing a left-bordered (`border-l-2 var(--color-primary)`) preformatted block.

Long messages (>2500 characters, no code blocks) collapse to 220px with a `linear-gradient(to bottom, transparent, var(--color-bg))` fade-out overlay. The latest assistant message is never auto-collapsed. A "Show more / Show less" toggle button in primary colour sits below. [DELIBERATE] — the never-collapse-latest rule prevents jarring truncation of the response the user just received.

**Loading state**: three `w-1.5 h-1.5 rounded-full` dots in primary colour, each animating with the custom `bounce` keyframe at 0ms, 150ms, 300ms delay. This is used when the response stream has not yet produced any content.

**Searching state**: a globe icon + "Searching the web…" text at `text-xs var(--color-muted)` — replaces the bounce dots when `isSearching` is true.

Action buttons (artifact, bookmark, download, TTS) render as `w-6 h-6` icon-only buttons with `background: var(--color-surface)`, `border: 1px solid var(--color-border)`. They are `opacity-0 group-hover:opacity-100` — the assistant message row has the `group` class. While TTS is active, the row is forced to `opacity-100` regardless of hover. [DELIBERATE] — keeping controls hidden until hover reduces visual clutter for long chat histories.

### Chat input area

The textarea is an auto-sizing, borderless element inside a bordered container. The container is `rounded-2xl border` with `background: var(--color-surface)`. The textarea itself has no border or background of its own. Height is driven by JS: `el.style.height = Math.min(el.scrollHeight, 160) + 'px'` on every input change. [DELIBERATE] — single-surface container rather than a visible textarea border gives a cleaner inbox-like appearance.

Below the textarea: a flex row of small icon buttons (`w-7 h-7` or `w-8 h-8`) for attach, URL, search, voice input, then a flex spacer, then the send/stop button. The send button is `w-8 h-8 rounded-xl` with primary background; the stop button shares the same slot. Buttons in this row use `hover:opacity-70 transition-opacity` with `var(--color-muted)` colour when inactive.

Context-sensitive panels (URL input, web search, Gmail search, Calendar search) pop up above the input area as absolute-positioned `rounded-xl border shadow-lg` overlays anchored at `bottom-full mb-2`. These are not modals — they are inline floating panels that preserve focus flow.

Above the textarea (when files are attached): `ChatFileBar` renders a strip of attachment pills. This is `flex-shrink-0` and stacks visually between the file bar and the typing area, all within the same outer container.

### Context bar

A collapsible strip (`flex-shrink-0 border-b px-4 py-1.5`) between the chat header banners and the message list. Visible only when pinned files or session files exist. Files appear as `rounded-full border text-xs px-2 py-0.5` pills — pinned files use `var(--color-border)` border, session files use `var(--color-primary)` border. Session file pills have an inline `×` dismiss button. [DELIBERATE] — the distinction between pinned (always in context) and session (this chat only) is surfaced visually through border colour without labels.

### Dropdowns / picker menus

All picker menus (model, temperature, persona, session list) follow this pattern: `absolute right-0 top-full mt-1 rounded-xl border shadow-lg py-1.5 z-40` with `background: var(--color-surface)`. Width varies (44–208px). Items are full-width buttons with `px-3 py-2 hover:opacity-70 transition-opacity`. Active/selected item uses `var(--color-primary)` for text colour and a `✓` suffix character. Dismiss is handled by a fixed-position `inset-0 z-10` click catcher behind the panel.

### Modals

**ConfirmModal**: `fixed inset-0 z-50` backdrop at `rgba(0,0,0,0.55)`. Panel: `w-full max-w-sm rounded-2xl border p-6 space-y-4` with `background: var(--color-surface)`. Title is `text-base font-semibold`. Body is `text-sm var(--color-muted)`. Buttons: Cancel (`px-4 py-2 rounded-lg border`) and Confirm (`px-4 py-2 rounded-lg font-medium text-white`). Danger variant uses `#ef4444` for Confirm background. Optional `confirmText` prop enables a type-to-confirm input that disables the button until matched. Backdrop click cancels. [DELIBERATE] — modals are reserved for state-change confirmations; they are not used for informational display or inline form editing.

**General modal pattern**: all modals share the `fixed inset-0 z-50` structure, backdrop click to close, and `rounded-2xl` panel. No modal has a close `×` button as the primary dismiss mechanism — backdrop click is the expected pattern.

### Toasts

Fixed `bottom: 24px right: 24px z-index: 9999`. Column flex, gap-8px. Each toast: `padding: 10px 16px`, `border-radius: 8px`, white text, `font-size: 13px`, `font-weight: 500`, `box-shadow: 0 4px 12px rgba(0,0,0,0.2)`, max-width 320px. Three colours: success `#16a34a`, warn `#d97706`, error `#dc2626`. Appear via `toast-in` keyframe: `opacity 0 → 1`, `translateY(8px) → none`, over 0.2s. Click-to-dismiss. Auto-dismiss is handled in `toastStore` via timeout (default 3500ms). [DELIBERATE] — no close button on toasts; click anywhere on the toast dismisses it.

### Cards (empty states)

The empty chat state uses: a `w-12 h-12 rounded-2xl` icon container in surface colour with primary icon, a `text-base font-medium` headline, and a `text-sm max-w-xs` sub-label in muted colour. All three are centred (`flex flex-col items-center justify-center h-full`). This pattern recurs across empty states throughout the app.

### Inline banners

Informational / warning / error banners that appear inside content areas (not global header notices) follow a consistent structure: `px-4 py-2.5 rounded-xl border flex items-center gap-2.5 text-xs`. Colour sets are hardcoded:
- Error/danger: `background: #fff1f2, border: #fca5a5, color: #991b1b`
- Warning: `background: #fffbeb, border: #fde68a, color: #78350f`
- Info/neutral: `background: var(--color-surface), border: var(--color-border), color: var(--color-text)`

These are used for context warnings, budget alerts, due-today notices, and stream errors. They are not toasts — they persist until dismissed or condition clears.

### Buttons — variants

**Primary action**: `px-4 py-2 rounded-lg font-medium text-white`, background `var(--color-primary)`. Used for modal confirm actions.

**Secondary / ghost**: `px-4 py-2 rounded-lg border`, `borderColor: var(--color-border)`, `color: var(--color-muted)`. Used for Cancel buttons.

**Icon button (header / toolbar)**: `w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity`. Colour `var(--color-muted)` inactive, `var(--color-primary)` active.

**Toggle button** (model, temp, persona pickers in chat header): `flex items-center gap-1 text-xs px-2 py-1 rounded-lg border`. Active state shows primary-coloured border and text. [DELIBERATE] — toggle buttons use border-colour change rather than fill to indicate active state, preserving the low-key aesthetic.

**Danger (inline)**: background `#ef4444` or `#dc2626`, white text. Used in destructive banners.

No component abstraction for buttons exists — all button variants are composed inline from Tailwind utilities and inline styles. [DELIBERATE] — or possibly emergent from the codebase's growth pattern. No dedicated `<Button>` component exists.

---

## 4. Interaction & Animation

### Transition conventions

Nearly all hover state transitions use `transition-opacity` with an implicit duration that resolves to `0.2s`. Width collapse (sidebar) uses `transition: width 0.2s`. Transform (sidebar mobile slide) uses `transition: transform 0.2s ease`. The sidebar chevron icon uses an inline `transition: transform 0.2s` to rotate 180° when open.

There is no system-wide animation utility — transitions are applied component by component, consistently landing at 200ms with ease or ease-in-out.

### Hover and focus states

Hover: uniformly `hover:opacity-60` or `hover:opacity-70` on interactive elements. No colour shift on hover — opacity is the sole mechanism. [DELIBERATE] — this simplifies the hover model to a single property, avoids colour tokens for hover variants, and works across any theme.

Focus: inputs use `outline: none` globally and rely on `border-color: var(--color-primary)` to indicate focus where applied (e.g. the inline title edit input uses a primary border on focus). No global `:focus-visible` ring is defined. [DELIBERATE or DEFAULT — no explicit focus ring is intentional for a single-user tool where keyboard accessibility is not a design priority, though this is worth revisiting in Curam-MCP.]

### Streaming SSE content

The `useChat` hook opens an `EventSource`-style SSE connection via a `fetch` with streaming response. Content arrives as `data: {json}` lines. Three data shapes are handled: `delta` (content chunk — appended to last message), `thinkingDelta` (reasoning block — appended to `message.thinking`), `usage` (token counts). A `[DONE]` sentinel marks end of stream.

During streaming: `isStreaming` is true, the Send button is replaced by a Stop button, new messages cannot be deleted, branching is disabled. The last assistant message renders progressively — markdown is re-rendered on each delta. [DELIBERATE] — no buffering or debouncing of delta renders; content appears character by character.

The web search state (`isSearching`) is set by a `searching: true` payload from the server. While searching, the loading indicator becomes "Searching the web…" with a globe icon rather than the bounce dots.

### Error surfacing

Four error contexts with different treatments:

1. **Stream errors**: inline error banner in the chat column below the message list, styled with coded colours (auth = red, rate_limit = yellow, etc.), dismissable via `✕` button.
2. **Destructive action confirms**: inline in the action row or as a banner strip below the chat header — never a modal (exception: when the revert-summary action might hit context limits, a ConfirmModal is used).
3. **Upload/attachment errors**: rendered in a red `text-xs` span below the input area.
4. **Toast errors**: used for async background operations (task extraction, note saving) via `toastStore.addToast(msg, 'error')`.

The pattern is: toast for background operations, inline banner for persistent blocking errors, inline confirm for destructive single actions.

### Context switches

When switching sessions or starting a new chat: messages array is cleared, summary panel is hidden, follow-up suggestions are cleared, artifacts panel is closed. These resets happen synchronously in the same action handler — there is no animated transition. [DELIBERATE] — clean slate rather than animated departure, matching the feel of switching documents rather than navigating a UI tree.

---

## 5. UX Patterns & Behaviours

### Optimistic UI

Session list refreshes (`fetchSessions()`, `fetchProjects()`) are called after mutations but the local state is updated first or simultaneously. Toast confirmations are shown immediately on action. The drag-and-drop project reorder calls `reorder()` which presumably updates local state before the server round-trip. No explicit optimistic-then-reconcile pattern is visible — side effects are handled by refetch rather than rollback.

### Focus management

After modal close: no explicit `focus()` call is made in ConfirmModal or general modals — the previously focused element retains focus. After sending a message: `textareaRef.current?.focus()` is not called explicitly; focus remains where it was. After title edit completes (blur or Enter): `setEditingTitle(false)`, no explicit focus move. After URL/search panels close: `textareaRef.current?.focus()` is called explicitly in the Gmail and Calendar "Done" handlers. [DELIBERATE for Gmail/Calendar — the inline panel pattern requires manual focus return since it is not a modal with a natural dismiss path.]

Title editing uses a `setTimeout(() => titleInputRef.current?.focus(), 0)` to ensure the input is mounted before focusing. Same pattern is used for rename inputs in the sidebar.

### Keyboard navigation

Global shortcuts (defined in App.jsx): `Cmd/Ctrl+K` opens search palette, `Cmd/Ctrl+B` toggles sidebar, `Cmd/Ctrl+N` starts new chat, `Cmd/Ctrl+/` opens keyboard shortcuts modal. These fire custom DOM events (`vault:toggle-sidebar`, `vault:new-chat`) rather than direct state calls, allowing any component to respond.

In chat input: `Enter` sends, `Shift+Enter` inserts newline. `@` triggers the AtMentionDropdown with a 150ms debounce (`mentionTimerRef`). `Escape` closes most inline panels.

Tasks page has an extensive set of keyboard shortcuts (`n`, `w`, `/`, `f`, `1-3`, `b`, `m`, `?`). No skip-navigation links or roving tab index patterns are present.

### File attachment

Three attachment paths: (1) file upload via button or drag-drop, handled by `useFileAttachment` which POSTs to the server and returns a file record with `extractedText` and optional `aiSummary`; (2) existing project file selection via `ChatFilePicker`; (3) manual URL context via `useUrlAttachment`. All three produce a normalised attachment object displayed in `ChatFileBar`.

Inline images (dragged directly into the chat or pasted) are handled separately as base64 in `inlineImages` state — they are not uploaded to the server, only embedded in the message payload. [DELIBERATE] — image-in-context does not require a file record.

The `allowedFileTypes` setting from `settingsStore` is passed as the `accept` attribute on all file inputs, making the accepted file list a user-configurable setting rather than a hardcoded constant.

### Context bar

[DELIBERATE] — the context bar is a deliberate design decision to surface "what Claude can see" rather than leaving it implicit. Users can collapse it (`showContextBar` toggle) but the bar itself only appears when files are present. Pinned files (always-on for the project) and session files (attached this session) are visually distinguished by border colour alone — no icon difference, no label difference. This is a subtle distinction that is easily lost.

### Loading states

Two modes are used:
- **Bounce dots**: three `w-1.5 h-1.5` dots with staggered `animate-bounce`. Used when the stream is open but no content has arrived yet (i.e., the model is thinking). Rendered inside a MessageBubble with `message.content === ''`.
- **Spinner**: `getIcon('loader', { size: n })` — Lucide's `Loader2` icon. Used on buttons during async operations (summarise, session title save). No skeleton loaders are used anywhere in the application.

The distinction: bounce dots = waiting for streamed content to begin; spinner icon = waiting for a discrete async action. No skeleton screens exist — data either shows or shows a spinner/empty state.

### Search palette

Global search (`Cmd+K`) renders as a `fixed inset-0 z-50` overlay. A centred panel (`max-w-xl`, `rounded-2xl`) contains a search input with debounced server search across projects, files, messages, and tasks. Results are grouped by type with icon prefixes. Keyboard navigation via ↑/↓. No result = empty state inline in the panel. [DELIBERATE] — search is a global, keyboard-first affordance mounted at the App level, not inside any page.

---

## 6. Decisions Worth Preserving

**The CSS-variable theming model** [DELIBERATE]: all colour is resolved at runtime through six CSS custom properties written by the ThemeProvider. This enables true per-user theming without CSS preprocessing, and means every new component is automatically theme-compatible as long as it references the variables rather than hardcoded hex values.

**Opacity as the sole hover mechanism** [DELIBERATE]: `hover:opacity-60` or `hover:opacity-70` is used universally rather than colour-shift hover states. This works across all themes without per-theme hover token definitions and produces a consistent, low-key feel.

**Inline destructive confirms** [DELIBERATE]: delete actions in the message bubble, session list, and sidebar show inline "Delete? Yes / No" controls rather than escalating to ConfirmModal. ConfirmModal is reserved for high-stakes operations where confirmation text input is needed. The inline approach reduces cognitive weight for routine deletions.

**No dedicated Button component** [DELIBERATE or emergent]: buttons are composed inline throughout. This makes consistency harder to enforce but means there is no abstraction to learn — variant differences are immediately visible in the component code. Any Button abstraction in Curam-MCP must make this choice explicitly.

**`100dvh` with `100vh` fallback** [DELIBERATE]: the outer container uses `min-height: 100vh; min-height: 100dvh` to handle mobile browser chrome collapse. This was an explicit engineering choice noted in the code comments.

**Icon system via semantic map** [DELIBERATE]: icons are accessed through a `getIcon(name, props)` function from `IconProvider`, backed by a semantic name-to-Lucide mapping. This decouples icon names from the Lucide library and theoretically allows swapping icon packs (the `iconPack` setting exists in `settingsStore`, though only `lucide` is implemented). New icons must be added to the semantic map before they can be used.

**Two-level surface depth** [DELIBERATE]: only `--color-bg` and `--color-surface` are used for backgrounds — there is no third elevation level (no deeply nested cards or modals on top of modals). This prevents colour layering complexity across themes.

**Streaming content renders without buffering** [DELIBERATE]: deltas are applied directly to the message content on arrival, triggering a re-render each time. The `MemoMessageList` component wraps the list in `React.memo` with explicit dependency control so that delta appends only re-render the last message, not the full list.

**Context bar as explicit visibility signal** [DELIBERATE]: rather than allowing file context to be invisible infrastructure, the context bar makes it explicit and distinguishes pinned from session-attached files. This is a UX decision, not a technical requirement — it could have been omitted.

**Bounce-dot loading vs spinner** [DELIBERATE]: the distinction between streaming-pending (dots) and discrete-async (spinner) states is maintained consistently. These are not interchangeable — using a spinner during stream pending would feel wrong because there is no discrete completion event. The bounce dots communicate "generating" rather than "loading".

**`toast-in` at 200ms, sidebar at 200ms, icon rotation at 200ms**: all micro-interactions share the same duration, not by configuration but by convention. If building Curam-MCP from this, a single `--duration-fast: 200ms` token is the right extraction.
