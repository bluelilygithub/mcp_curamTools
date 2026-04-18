## 3. Component Patterns

**Project Context:** Internal learning project for one organisation, solo developer. Design decisions reflect this context. See [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md).

### Buttons

No dedicated `<Button>` component exists in either predecessor — all variants are composed inline. [DECISION REQUIRED — Curam-MCP should decide explicitly. See Annotation Required.]

**Primary.** `px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-80 disabled:opacity-50`, `background: var(--color-primary)`.

**Secondary / ghost.** `px-4 py-2 rounded-xl text-sm font-medium border hover:opacity-70`, `borderColor: var(--color-border)`, `color: var(--color-text)`.

**Danger.** Same structure as primary, `background: #ef4444`, white text.

**Icon button.** `w-8 h-8 flex items-center justify-center rounded-lg hover:opacity-70 transition-all`. Used in toolbars, table action columns, header controls.

**Toggle button** (model/persona pickers in chat header). `flex items-center gap-1 text-xs px-2 py-1 rounded-lg border`. Active: primary-coloured border and text, no fill change. [DELIBERATE — border-colour change rather than fill preserves the low-key aesthetic across themes.]

Hover mechanism across all variants: opacity only. No colour shift on hover. [DELIBERATE — works across all themes without per-theme hover token definitions.]

### Corner radius convention

Buttons and inputs: `rounded-xl`. Surface containers, cards, and modals: `rounded-2xl`. Apply consistently — do not mix within the same component. [MERGED DECISION — ToolsForge used one step rounder than Vault throughout. The ToolsForge convention is adopted as the standard.]

### Form inputs and labels

```jsx
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
```

Input background is `var(--color-bg)` — one step lighter than the surrounding card surface — making the field visually distinct without a heavy border. `outline: none` removes the browser default; focus is indicated by `borderColor: var(--color-primary)` on the focused element. The label pattern (`text-xs font-semibold uppercase tracking-wider`) is the same metadata text style used for sidebar section headers and table column headers — one consistent idiom for all secondary labels.

Auto-expanding textarea: `onInput` sets `height = 'auto'` then `scrollHeight`; max height 160px enforced in JS. Textarea overflow is hidden at rest and `auto` on focus (global CSS rule) to prevent scrollbar flash.

### Cards and surface containers

Standard card: `rounded-2xl border p-6 space-y-4`, `background: var(--color-surface)`, `borderColor: var(--color-border)`. The `space-y-4` utility handles internal vertical rhythm without per-element margin work. Used for settings sections, admin content areas, modal bodies, and dashboard card interiors.

### Sidebar section labels

The primary metadata text style — used for sidebar section headers, admin table column headers, and form field labels:

```jsx
<p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider"
  style={{ color: 'var(--color-muted)' }}>
  Section Name
</p>
```

This single pattern covers all three contexts. Do not introduce a variant.

### Tool cards (Dashboard)

Four-part vertical stack: icon (32px, `var(--color-primary)`), tool name (`font-bold text-lg`, heading font), description (`text-sm flex-1` in muted colour, `flex-1` for equal-height cards), full-width primary launch button. Card: `rounded-xl shadow-sm p-6 flex flex-col items-center text-center`, `background: var(--color-surface)`, `border: 1px solid var(--color-border)`. [DELIBERATE — centred icon-forward layout positions each tool as a destination, not a menu option.]

### Toast notifications

Container: `fixed bottom-5 right-5 z-[9999] flex flex-col gap-2`.

Each toast: `px-4 py-3 rounded-xl border shadow-lg text-sm animate-fade-in`, min-width 220px, max-width 360px. A coloured 6px dot precedes the message. An explicit `×` close button sits at the end at `opacity-40 hover:opacity-80`. Auto-dismiss at 3000ms. Click-to-dismiss also supported.

Colour: success uses `var(--color-primary)` (branded, theme-aware); warning `#f59e0b`; error `#ef4444`. [DELIBERATE — success uses primary rather than a fixed green so it feels branded on any theme. ToolsForge evolution from Vault's hardcoded green.]

### Modals

`fixed inset-0 z-50 flex items-center justify-center p-4`. Backdrop: `rgba(0,0,0,0.5)`. Panel: `max-w-sm rounded-2xl border p-6 space-y-4`, `background: var(--color-surface)`. Dismiss: backdrop click, Escape key via `useEffect` listener, and an explicit `×` close button in the header. [MERGED DECISION — ToolsForge added the explicit close button over Vault's backdrop-only dismiss. Adopted for accessibility.]

Modals are reserved for state-change confirmations and complex intercepts. Not used for informational display or inline form editing.

**ConfirmModal pattern** [FROM VAULT — ToolsForge has no shared ConfirmModal; carry this forward]: a `confirmText` prop enables a type-to-confirm input that disables the confirm button until matched. Used for high-stakes destructive operations only. Standard destructive operations use inline confirm (see below).

### Inline destructive confirms

Delete actions in tables, message lists, and nav items show an inline "Delete? Yes / No" control in place rather than escalating to a modal. [FROM VAULT — Vault documented and implemented this as deliberate. ToolsForge admin pages do not yet have it. Inline confirm reduces cognitive weight for routine deletions and keeps the destructive path visible in context. Implement from the start in Curam-MCP.]

### Inline banners

Persistent contextual warnings inside content areas — not toasts, not modals. Structure: `px-4 py-2.5 rounded-xl border flex items-center gap-2.5 text-xs`.

Colour sets are hardcoded, not token-based:
- **Error / danger:** `background: #fff1f2`, `borderColor: #fca5a5`, `color: #991b1b`
- **Warning:** `background: #fffbeb`, `borderColor: #fde68a`, `color: #78350f`
- **Neutral / info:** `background: var(--color-surface)`, `borderColor: var(--color-border)`

[FROM VAULT — Vault documented this three-tier classification explicitly. These persist until the condition clears or the user dismisses, unlike toasts which are transient.]

### Dropdowns / picker menus

`absolute right-0 top-full mt-1 rounded-xl border shadow-lg py-1.5 z-40`, `background: var(--color-surface)`. Items: full-width buttons at `px-3 py-2 hover:opacity-70 transition-opacity`. Active/selected item: `var(--color-primary)` text colour. Dismiss via a fixed `inset-0 z-10` click-catcher behind the panel.

### Message bubbles — user

Right-aligned, `max-w-[75%]`. Bubble: `rounded-2xl rounded-tr-sm`, `background: var(--color-primary)`, `color: #fff`, `whitespace-pre-wrap`. [FROM VAULT — the `rounded-tr-sm` directional corner signals message origin without an avatar. ToolsForge omitted it; it is preserved here as a deliberate character detail.]

Image thumbnails: `w-14 h-14 object-cover rounded-lg border` above the text — compact, signalling attached context rather than photo display. Action controls render at `opacity-0 group-hover:opacity-100` below the bubble on the `group`-classed row.

### Message bubbles — assistant

Left-aligned. Content renders via the markdown renderer. [DECISION REQUIRED — whether to include an avatar character. Vault rendered a `✦` symbol in a small rounded avatar; ToolsForge omitted it. See Annotation Required.]

Action buttons (copy, TTS, bookmark) at `opacity-0 group-hover:opacity-100`, `w-6 h-6` icon buttons with `background: var(--color-surface)`, `border: 1px solid var(--color-border)`. While TTS is active, the row is forced to full opacity regardless of hover. [DELIBERATE — keeping controls hidden until hover reduces visual clutter in long histories.]

**Long message collapse** [FROM VAULT — Vault collapsed messages over 2500 characters (no code blocks) to 220px with a `linear-gradient` fade-out overlay and a "Show more / Show less" toggle. The latest assistant message is never auto-collapsed. Carry forward — prevents jarring truncation of the response just received.]

**Thinking / reasoning block** [FROM VAULT — rendered as a collapsible toggle above content with a CPU icon, revealing a left-bordered (`border-l-2 var(--color-primary)`) preformatted block. Carry forward if the underlying model supports reasoning output.]

### Chat input area

Auto-sizing textarea inside a bordered container. Container: `rounded-2xl border`, `background: var(--color-surface)`. The textarea itself has no border or background — the single-surface container gives a cleaner inbox appearance. [DELIBERATE — both predecessors used this pattern.]

Below the textarea: icon button toolbar (attach, URL, voice input, spacer, send/stop). Send button: `w-8 h-8 rounded-xl`, primary background. Stop button replaces it during streaming.

Context panels (URL input, search, Gmail) pop up above the input as `absolute rounded-xl border shadow-lg` overlays anchored at `bottom-full mb-2`. Not modals — inline floating panels that preserve focus flow. After closing, `textareaRef.current?.focus()` must be called explicitly. [FROM VAULT — documented as a deliberate focus-return requirement for inline panels.]

### Context bar

`flex-shrink-0 border-b px-4 py-1.5`, visible only when files are in context. Pinned files (always in context for the project) and session files (attached this session) are distinguished by border colour alone: `var(--color-border)` for pinned, `var(--color-primary)` for session. Session file pills have an inline `×` dismiss button. [DELIBERATE — FROM VAULT. Makes "what the model can see" explicit rather than invisible infrastructure. The pinned/session distinction is surfaced visually without labels.]

### Loading states

**Streaming / generating.** Three `w-2 h-2 rounded-full` dots in `var(--color-primary)` with `animate-bounce` at 0ms, 150ms, 300ms stagger delay. [MERGED DECISION — ToolsForge used `w-2 h-2`; Vault used `w-1.5 h-1.5`. The slightly larger size is adopted.]

**Discrete async operations.** SVG spinner with `animate-spin`. Used on buttons during form submissions and discrete actions (save, invite, refresh).

The distinction is maintained consistently: bounce dots = streaming pending; spinner = discrete operation in progress. Not interchangeable. [DELIBERATE — Vault documented this explicitly; ToolsForge used the same pattern.]

No skeleton loaders. Data either renders or shows a spinner / dots / empty state.

### Empty states

```jsx
<div className="flex flex-col items-center justify-center h-full gap-2">
  {getIcon('icon-name', { size: 32 })}
  <p className="text-sm" style={{ color: 'var(--color-text)' }}>Primary message</p>
  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Optional hint</p>
</div>
```

Centred column, icon at 32px in muted colour, `text-sm` message, optional `text-xs` hint. Consistent across all tools.

### Error states

Inline component error: `text-xs text-center py-2 px-4 rounded-lg`, `background: rgba(239,68,68,0.1)`, `color: #ef4444`. For API errors surfaced within a component rather than as a persistent banner.

### Markdown renderer

[DECISION REQUIRED — both predecessors made different choices. Vault used `react-markdown` + `remarkGfm`: full GFM including fenced code blocks, links, and tables, at the cost of a third-party dependency. ToolsForge used a custom zero-dependency renderer with headings, bold, lists, tables, and horizontal rules, but no fenced code blocks or link handling. Choose based on whether Curam-MCP tools will return code samples. See Annotation Required.]

### Admin UI patterns

Admin pages are a ToolsForge addition — no Vault equivalent exists.

**Admin sections and their purpose:**
- **Users** — member list, invite flow (token-based; new users accept via `/invite/:token`), role and status management. Role and status rendered as `rounded-full px-2 py-0.5 text-xs` pills in hardcoded semantic colours. Actions column: icon-only `w-8 h-8 rounded-lg` buttons for edit, deactivate, delete.
- **AI Models** — toggle model availability for the org, set default model. [DELIBERATE — org admin controls which models members can access; absent from single-user Vault.]
- **Agents** — admin-configurable agent definitions: slug, name, system prompt, model assignment. System prompts are not embedded in code. [DELIBERATE — ToolsForge; Vault embedded system prompts in code. The server-configurable approach is the correct multi-tenant pattern.]
- **App Settings** — org-wide defaults: app name, timezone, allowed file types. Consumed by the frontend on mount via API fetch, not from a local store. [DELIBERATE — admin changes propagate to new component mounts without a page reload or server restart.]
- **Email Templates, Security, Logs, Diagnostics** — supporting admin surfaces following the same three-part page layout.

### Model advisor modal

Before sending in chat tools, a `checkModelBeforeSend()` step may call the analyse-prompt endpoint. If the server recommends a different model, a modal is shown with the reason, the current model, and suggested alternatives. The user chooses "Switch & Send" or "Keep & Send". [DELIBERATE — ToolsForge; acknowledges multi-model complexity and guides users toward appropriate model selection without blocking them.]

### Role-conditional rendering

Role determination: `user.roles.find(r => r.scope_type === 'global')?.name`. Currently `org_admin` or member (absence of admin role). The `isAdmin` boolean flows from `AppShell` to `SidebarLinks` and route guards. The tool list (`getPermittedTools(primaryRole)`) is the single source of truth — sidebar and dashboard always render the same filtered set. [DELIBERATE — single derivation point prevents sidebar/route divergence.]

Route protection:

```jsx
<Route element={<RequireAuth />}>
  <Route element={<AppShell />}>
    {/* General routes */}
    <Route element={<RequireRole allowedRoles={['org_admin']} />}>
      {/* Admin-only routes */}
    </Route>
  </Route>
</Route>
```

`RequireAuth` checks `authStore.token`. `RequireRole` checks `user.roles[].name` against `allowedRoles`. Both render `Outlet` on pass, redirect to `/` on fail. [DELIBERATE — route-tree middleware, not in-page conditional JSX. Prevents any accidental rendering of restricted UI.]
