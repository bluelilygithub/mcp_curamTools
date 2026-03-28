# UI Primitives — ToolsForge

ToolsForge is a multi-user organisational platform: denser in purpose than Vault, more structured in its surfaces, and explicitly multi-tenant in its framing. The default palette and token set are identical to Vault's warm-sand theme — the same terracotta primary, the same near-black text, the same two-level surface depth — but the overall character shifts from personal tool to shared workspace. Where Vault keeps all navigation in a single header strip, ToolsForge separates tool navigation into a collapsible left sidebar with labelled sections. Where Vault is radial and flat, ToolsForge is hierarchical: Dashboard → Tool → Admin. Typography is split across two font axes (body and heading), with headings defaulting to Playfair Display — more editorial than Vault's DM Sans everywhere approach. The overall feel is calm and considered rather than busy; whitespace is generous, card grids are properly spaced, and admin surfaces are clean tables rather than cramped dashboards. The key character difference: ToolsForge signals "workspace for your organisation" while Vault signals "workspace for you."

---

## 1. Visual Language

### Colour system

The token model is identical to Vault: six CSS custom properties written by a runtime ThemeProvider to a `<style>` tag in `<head>`, making the entire UI theme-responsive to a single DOM write. The properties are `--color-bg`, `--color-surface`, `--color-border`, `--color-primary`, `--color-text`, and `--color-muted`. A seventh derived property, `--color-primary-rgb`, stores the primary colour as a bare `r,g,b` triple so that `rgba(var(--color-primary-rgb), 0.1)` works for translucent active states without a separate token. [DELIBERATE] — this pattern appears in ToolsForge but not Vault, and is the cleanest way to produce theme-aware transparent fills.

**Default theme (warm-sand) — identical to Vault:**
- `--color-bg`: `#F5F5F0` — page canvas
- `--color-surface`: `#EEEEE8` — sidebar, header, cards, inputs
- `--color-border`: `#D8D8D0` — all dividers and borders
- `--color-primary`: `#CC785C` — terracotta; CTAs, active nav, badges
- `--color-text`: `#1A1A1A` — near-black body text
- `--color-muted`: `#888888` — secondary labels, placeholders, inactive icons

Five themes: warm-sand (default), dark-slate, forest, midnight-blue, paper-white. Each is a complete six-token replacement. No Tailwind `dark:` variant is used anywhere. The `:root` block in `index.css` seeds the defaults so that the first paint is never unstyled — ThemeProvider overwrites them at runtime from the Zustand-persisted setting. [DELIBERATE] — avoids the flash-of-wrong-theme that a CSS-first approach would require JS-disabling safeguards to prevent.

Semantic colours (errors, warnings, success) are hardcoded outside the token system: error red `#ef4444`, warning amber `#f59e0b`, success green `#22c55e`. This matches Vault's approach. [DELIBERATE] — these must remain recognisable regardless of theme.

The `--color-primary-rgb` derived token is the one genuine evolution from Vault. Active nav items use `rgba(var(--color-primary-rgb), 0.1)` for their background — a soft translucent tint rather than an opaque fill. Vault uses explicit `var(--color-bg)` for active nav backgrounds, which is less elegant and breaks down on themes where bg and surface have low contrast.

### Typography

ToolsForge introduces a split between body and heading fonts — two separate CSS variables, two separate settings. Vault used a single font variable (`--font-sans`) applied everywhere.

**CSS variables:**
- `--font-body`: Inter (default) — all running text, inputs, labels, nav items
- `--font-heading`: Playfair Display (default) — all `h1`–`h6` elements, applied globally in `index.css`
- `--font-mono`: DM Mono — code blocks (third variable, not present in Vault)

The `h1`–`h6` selector in `index.css` applies `font-family: var(--font-heading)` globally, so any heading element inherits the editorial font automatically. In Vault, headings had no special treatment at the CSS level. [DELIBERATE] — this is an architectural shift: ToolsForge treats editorial headings as a design signal, Vault did not.

**Font library**: 16 Google Fonts across three categories — 9 sans-serif body fonts (Inter, DM Sans, Open Sans, Lato, Nunito, Poppins, Raleway, Montserrat, Oswald), 5 serif heading fonts (Lora, Merriweather, Playfair Display, PT Serif, Crimson Text), and 2 monospace fonts (JetBrains Mono, Fira Code). Fonts are lazy-loaded on demand via Google Fonts URL. Vault had a smaller selection and no serif heading category.

**Scale in practice:**
- `text-xs` (12px): column headers in admin tables, section labels (`TOOLS`, `ADMIN` in sidebar), badge text, input labels (`text-xs font-semibold uppercase tracking-wider`), timestamps
- `text-sm` (14px): nav items, all form inputs and selects, body content in cards, button labels, table cell content
- `text-lg` (18px): tool card names inside the dashboard grid
- `text-2xl` (24px): dashboard greeting `h1`

Weights follow: 400 for body, 600 (`font-semibold`) for section labels and card titles, `font-bold` for the dashboard greeting and table column headers.

### Scrollbars

Custom scrollbar styling in `index.css`: 5px wide, transparent track, `--color-border` thumb with 10px radius, `--color-muted` on hover. Identical to Vault's pattern. Applied globally.

### Dark/light mode

No OS `prefers-color-scheme` detection. Theme is an explicit user setting persisted in `settingsStore` (Zustand). ThemeProvider reads on mount and on change, writes CSS variables to `<head>`. Identical model to Vault.

---

## 2. Layout & Structure

### Top-level shell

The authenticated shell is a fixed `TopNav` at the top (h-14, 56px — four pixels taller than Vault's 44px) with a fixed left sidebar beneath it. Content flows in the remaining space. The outer container uses `min-h-screen` rather than Vault's `100dvh` approach — a regression worth noting. [DEFAULT — `dvh` was the deliberate Vault choice for mobile chrome collapse; ToolsForge does not carry this forward.]

```
┌────────────────────────────────────────────────────────────┐
│  TopNav (h-14, 56px, fixed, z-50)                         │
├────────────┬───────────────────────────────────────────────┤
│            │                                               │
│  Sidebar   │  Main content (flex-1, overflow-y-auto)       │
│  (220px /  │                                               │
│   56px     │  <Outlet />                                   │
│  collapsed)│                                               │
└────────────┴───────────────────────────────────────────────┘
```

The sidebar is positioned `fixed left-0 top-14 bottom-0` — it anchors below the nav rather than being part of a flex row. An in-flow spacer `<div>` mirrors its width so the main content area does not sit under it. [DELIBERATE] — this is a cleaner pattern than Vault's full-height flex row; the sidebar and content are independently positioned, which avoids the `overflow: hidden` constraint that a flex row imposes.

### Sidebar

**Desktop**: fixed, 220px expanded / 56px collapsed, animated with `transition: width 200ms ease`. Background: `--color-surface`. Right border: `1px solid var(--color-border)`. Navigation content uses `SidebarLinks`, which renders structured sections: Dashboard (top-level), Tools (section with `text-xs font-semibold uppercase tracking-wider` label), Admin (conditional on `isAdmin`, same label style), then a footer area with Settings link and collapse toggle.

**Collapsed state**: the sidebar collapses to 56px (icon-only width). NavItems are still rendered but the label `<span>` is conditionally hidden when `collapsed` is true. The icon alone remains, sized at 15px via `getIcon(iconName, { size: 15 })`. The collapse toggle button sits at the bottom of the sidebar footer area and is `aria-label`-ed. [DELIBERATE] — collapsible sidebar is not present in Vault, which has no sidebar at all. This is a new structural addition in ToolsForge to handle the growing nav surface.

**Mobile**: a separate `<aside>` with `transform: translateX(-100%)` default, `translateX(0)` when `mobileOpen`. Transition: `200ms ease`. A semi-transparent backdrop (`bg-black/40`) renders at `z-40` and closes the sidebar on click. Mobile sidebar is always 220px (not collapsible in mobile state). Mobile sidebar auto-closes on navigation via `onLinkClick` callback. [DELIBERATE] — same pattern as Vault's mobile sidebar overlay.

### TopNav

Height: `h-14` (56px), `fixed top-0 left-0 right-0 z-50`. Contains: hamburger toggle (mobile only), brand name "ToolsForge", `GlobalSearchBar` (centred), user email, role badge, logout button. [DEFAULT — TopNav appears to use some hardcoded Tailwind colours (`text-slate-*`, `bg-gray-*`) rather than CSS variables, suggesting it was scaffolded quickly and not fully theme-integrated. This should be addressed in Curam-MCP.]

The role badge renders conditionally: `org_admin` gets an amber pill (`bg-amber-100 text-amber-800`), members get a slate pill. [DELIBERATE] — role is surfaced persistently in the chrome so users always know their access level.

### Dashboard and tool card grid

The dashboard is an 8px-padded (`p-8`) full-width page with a greeting heading followed by a responsive card grid. The grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`. Each card is `rounded-xl shadow-sm p-6 flex flex-col items-center text-center`. The card pattern is notable: icon at 32px (primary colour), tool name in heading font (`font-bold text-lg font-heading`), description in muted colour, then a full-width primary button at the bottom. [DELIBERATE] — the card is centred/icon-forward, not a left-aligned list item. This positions tools as destinations rather than menu options.

The dashboard tracks `lastVisitedTool` in `toolStore` and renders a persistent "Last used: Tool →" link below the grid on return visits. [DELIBERATE] — small quality-of-life detail absent from Vault.

### Z-index conventions

Observed values:
- `z-40`: fixed sidebar desktop, mobile backdrop
- `z-50`: mobile sidebar overlay, modals
- `z-[100]`: toast stack

Fewer layers than Vault's ad-hoc z-index escalation (which reached z-9999). ToolsForge's toast uses `z-[100]` rather than Vault's `z-[9999]`. [DEFAULT — neither is configurable; both are hardcoded. ToolsForge's is more conservative but could still conflict with future layers.]

### Responsive behaviour

Single breakpoint: `md` (768px), aligning with Tailwind's default. Below 768px: sidebar hidden, hamburger shown. Above 768px: desktop sidebar visible, mobile sidebar hidden. A second breakpoint `lg` (1024px) applies only to the dashboard grid (2 → 3 columns). Vault used `sm` (640px) as its sole breakpoint — ToolsForge shifts to `md`, giving more room to the mobile experience. [DELIBERATE] — `md` at 768px is the conventional tablet-width boundary; `sm` at 640px was an unusually tight desktop threshold in Vault.

---

## 3. Component Patterns

### NavItem

```jsx
<NavLink
  className="flex items-center gap-2.5 px-3 py-2 mx-2 rounded-lg transition-all text-sm"
  style={({ isActive }) => ({
    background: isActive ? 'rgba(var(--color-primary-rgb), 0.1)' : 'transparent',
    color:      isActive ? 'var(--color-primary)' : 'var(--color-text)',
    fontWeight: isActive ? 600 : 400,
  })}
>
```

Active state: translucent primary tint background (not `--color-bg` as in Vault), primary text colour, weight 600. Inactive: transparent, `--color-text`, weight 400. The `mx-2` gives a slight inset so the active background does not touch the sidebar edges — a detail Vault did not implement. Icon inherits colour from the parent via `color: inherit`. [DELIBERATE] — icon colour tracks the active/inactive text colour rather than being independently muted, giving a more unified look.

### Tool cards (Dashboard)

Each card follows a strict four-part vertical structure: icon (32px, primary colour), name (`font-bold text-lg`, heading font), description (muted, `text-sm flex-1` for equal-height cards), action button (full-width, primary). Cards use `rounded-xl shadow-sm` rather than Vault's standard `rounded-2xl` — a smaller corner radius, more structured. [DELIBERATE] — `rounded-xl` vs `rounded-2xl` is a character choice; ToolsForge is slightly more angular than Vault.

### Sidebar section labels

```jsx
<p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider"
  style={{ color: 'var(--color-muted)' }}>
  Tools
</p>
```

This label pattern — `text-xs uppercase tracking-wider font-semibold muted` — recurs across sidebar section labels, table column headers in admin pages, and form field labels. It is the primary metadata text style in the system.

### Buttons and variants

No dedicated `<Button>` component exists — all variants are composed inline, as in Vault.

**Primary**: `px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-80 disabled:opacity-50`, background `var(--color-primary)`. Corner radius is `rounded-xl` (Vault used `rounded-lg`). [DELIBERATE] — ToolsForge consistently uses `rounded-xl` and `rounded-2xl` where Vault used `rounded-lg` and `rounded-xl`. Every corner in ToolsForge is one step rounder.

**Secondary/ghost**: `px-4 py-2 rounded-xl text-sm font-medium border hover:opacity-70`, `borderColor: var(--color-border)`, `color: var(--color-text)`.

**Icon button**: `w-8 h-8 flex items-center justify-center rounded-lg hover:opacity-70 transition-all`. Used in form actions, toolbar controls.

**Hover**: `hover:opacity-80` (primary) or `hover:opacity-70` (secondary/ghost/icon). The mechanism is identical to Vault — opacity only, no colour shift.

### Form inputs

```jsx
// Label
<label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" />

// Input
<input className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
```

Inputs use `rounded-xl` (vs Vault's `rounded-lg`). The background is `--color-bg` rather than `--color-surface`, making inputs appear slightly lighter than the surrounding card surface. Label pattern is the same metadata style used in sidebar section headers — consistent application of the `text-xs uppercase tracking-wider` idiom.

Selects follow the same pattern but at `rounded-lg` (one step smaller). The inconsistency between input and select corner radius appears to be unintentional.

Auto-expanding textarea: `onInput` handler sets `style.height = 'auto'` then `scrollHeight`. Mobile override: `font-size: 16px !important` via the global CSS rule (same as Vault, prevents iOS zoom-on-focus).

### Cards and surface containers

Standard card: `rounded-2xl border p-6 space-y-4`, `background: var(--color-surface)`, `borderColor: var(--color-border)`. The `space-y-4` utility handles internal vertical rhythm without per-element margin work. This is a consistent pattern across settings sections, admin content areas, and modal bodies.

### Toast notifications

**Container**: `fixed bottom-5 right-5 z-[100] flex flex-col gap-2`. Each toast: `px-4 py-3 rounded-xl border shadow-lg text-sm` with `animate-fade-in` (the custom 0.2s fadeIn keyframe from `index.css`). A coloured indicator dot (1.5px circle) precedes the message text. A close button sits at the end: `opacity-40 hover:opacity-80 transition-opacity`. Min-width 220px, max-width 360px.

Colour coding: success uses `--color-primary` (theme-aware), warning uses hardcoded `#f59e0b`, error uses hardcoded `#ef4444`. Auto-dismiss at 3000ms. [DELIBERATE] — success toasts use the primary colour rather than a fixed green, meaning they visually echo the brand colour on any theme. This differs from Vault, where success toasts always used a fixed `#16a34a` green.

The `animate-fade-in` keyframe is `opacity: 0 → 1` + `translateY(6px) → 0` over 0.2s. Vault's `toast-in` keyframe was `translateY(8px) → 0` — slightly more pronounced. ToolsForge is subtler. [DEFAULT — this may be coincidental rather than deliberate.]

### Modals

**ModelAdvisorModal**: The only fully-specified modal in the observed codebase. Structure: `fixed inset-0 z-50 flex items-center justify-center p-4`, backdrop `rgba(0,0,0,0.5)`. Panel: `max-w-sm rounded-2xl border p-6 space-y-4`, `background: var(--color-surface)`. Backdrop click dismisses. Escape key dismisses via `useEffect` listener. Close `×` button in the header. [DELIBERATE] — unlike Vault, ToolsForge modals include an explicit close button in addition to backdrop-click dismiss. This is more conventional and more accessible.

### Loading states

**Streaming/generating**: three `w-2 h-2 rounded-full` dots (Vault used `w-1.5 h-1.5`) with the `animate-bounce` keyframe at 0ms, 150ms, 300ms delay. Colour: `--color-primary`. Slightly larger dots than Vault.

**Async operations**: SVG spinner (`animate-spin`) used inline in `GlobalSearchBar`. This matches Vault's spinner pattern for discrete async operations.

**No skeleton loaders**: data either renders or shows a spinner/empty state. Identical to Vault.

### Empty states

```jsx
<div className="flex flex-col items-center justify-center h-full gap-2">
  {getIcon('icon-name', { size: 32 })}
  <p className="text-sm">Message</p>
  <p className="text-xs">Hint</p>
</div>
```

Centred column, icon at 32px (muted colour), message at `text-sm`, optional hint at `text-xs`. Consistent across tools.

### Error states

Inline error: `text-xs text-center py-2 px-4 rounded-lg`, `background: rgba(239,68,68,0.1)`, `color: #ef4444`. Used for API errors within components rather than as persistent banners.

### Markdown renderer

A zero-dependency custom renderer (`MarkdownRenderer.jsx`) rather than `react-markdown` + `remark-gfm`. Supports headings, bold, unordered and ordered lists, tables, horizontal rules, and paragraphs. Code block support is absent. [DELIBERATE] — Vault used `react-markdown` with `remarkGfm`, a third-party dependency. ToolsForge's custom renderer keeps bundle size down but loses fenced code block rendering, syntax highlighting, and link handling. This is a trade-off that should be revisited in Curam-MCP.

### Chat message bubbles

**User**: right-aligned, `max-w-[75%]`. Bubble: `rounded-2xl`, `background: var(--color-primary)`, `color: #fff`, `whitespace-pre-wrap`. Image thumbnails: `w-14 h-14 object-cover rounded-lg border` — smaller than Vault's `w-24 h-24`. [DELIBERATE] — compact image previews signal "attached context" rather than "photo display".

**Assistant**: surface-colour bubble, `border: 1px solid var(--color-border)`, content rendered through `MarkdownRenderer`. No avatar character (Vault rendered a `✦` avatar). [DELIBERATE — or DEFAULT. No avatar signals a cleaner, more generic workspace than Vault's more personal feel.]

### Chat input

Auto-sizing textarea inside a bordered container (`rounded-2xl border`, `background: var(--color-surface)`). The textarea itself is borderless and transparent within the container — the same single-surface pattern as Vault. Height grows with content up to 160px. Below textarea: voice input, file attach, model select, send button toolbar. Keyboard: `Enter` sends, `Shift+Enter` newlines.

Image attachments display as `w-14 h-14` thumbnails with a red `×` badge for removal. Text file attachments display as small surface-coloured pills with filename and icon.

---

## 4. Role-Conditional Rendering and Multi-Tenancy

### Permission model

Each user has a `roles` array from the auth store, each role with a `scope_type`. The primary role is extracted as `user.roles.find(r => r.scope_type === 'global')?.name`. Currently two roles exist: `org_admin` and member (absence of admin role). [DELIBERATE] — roles are not a simple boolean flag; they are scoped, suggesting the model is designed to extend to org-scoped and team-scoped roles.

Role affects three things: the tool list shown (via `getPermittedTools`), the sidebar Admin section visibility, and the Admin badge in TopNav. These are all driven by the single `isAdmin` boolean derived at the AppShell level.

### Route guards

```jsx
<Route element={<RequireAuth />}>        {/* Token check → redirect /login */}
  <Route element={<AppShell />}>
    <Route element={<RequireRole allowedRoles={['org_admin']} />}>
      {/* Admin-only routes */}
    </Route>
  </Route>
</Route>
```

`RequireAuth` checks `authStore.token`. `RequireRole` checks `user.roles[].name` against `allowedRoles`. Both render `<Outlet />` on pass, `<Navigate to="/" replace />` on fail. [DELIBERATE] — the guard components are composable middleware in the route tree, not conditional JSX inside page components. This is architecturally cleaner than Vault, which used an `AuthGuard` wrapper component.

### Tool registry and permission filtering

Tools are defined in `src/config/tools.js` with an optional `requiredPermission` field. `getPermittedTools(userRole)` returns all tools for `org_admin`, and only tools without `requiredPermission` for members. The Dashboard card grid and the sidebar both consume this filtered list — they are always in sync. [DELIBERATE] — single source of truth for what tools exist and who can access them.

---

## 5. Interaction & Animation

### Transition conventions

All micro-interactions share 200ms duration: sidebar width (`transition: width 200ms ease`), mobile sidebar slide (`transition: transform 200ms ease`), hover states via Tailwind's `transition-all` or `transition-opacity` (which resolve to Tailwind's default 150ms unless overridden — note that Tailwind's `transition-opacity` default is `150ms ease-in-out`, not 200ms). This is a mild inconsistency — explicit inline transitions are 200ms, Tailwind utilities are 150ms. [DEFAULT — not a deliberate discrepancy, likely unnoticed.]

Sidebar collapse animates width, not position or opacity. Content inside the sidebar is hidden (label text conditionally removed from the DOM; the sidebar container uses `overflow: hidden` to clip remaining content). Icons remain visible at all widths because they are 15px and the collapsed width is 56px.

### Hover states

`hover:opacity-70` or `hover:opacity-80` universally. Colour does not shift on hover — identical approach to Vault. The `transition-opacity` or `transition-all` class is applied to most interactive elements.

### Streaming SSE content

The `useStream` hook uses `fetch` + `ReadableStream` (not `EventSource`) because POST requests are needed. The stream is read as UTF-8 text, split on `\n\n`, and each SSE event parsed as JSON. Events: `text` (appended to content), `usage` (token/cost data), `error` (sets error state), `[DONE]` (marks stream complete). An `AbortController` is held in a ref and cancelled on `stop()` or new `send()`. [DELIBERATE] — the `fetch`+`ReadableStream` approach for SSE over POST is the same deliberate pattern as Vault's `useChat`.

During streaming: the accumulated `content` string grows with each text event. The streamed content transitions to message history once streaming ends via a `useEffect` watching `[streaming, content]`. [DELIBERATE] — same pattern as Vault.

### Model advisor flow

Before sending a message, `ChatPage` calls a `checkModelBeforeSend()` step that analyses the prompt via `/api/tools/{tool}/analyse-prompt`. If the server suggests a different model, `ModelAdvisorModal` is shown. The user chooses to switch or proceed. This intercept pattern is new relative to Vault — Vault sends immediately. [DELIBERATE] — pre-send model suggestion is a new UX pattern in ToolsForge that acknowledges multi-model complexity.

### Error surfacing

Inline error within components: small `rounded-lg` coloured panel. Persistent blocking errors in chat: inline banner below message list. Toast: for async background operations. No `ConfirmModal` pattern is observed in the current codebase (contrast with Vault which uses ConfirmModal for destructive confirmations). ToolsForge appears to handle destructive confirmations within the admin table rows rather than with a shared modal component — though a shared ConfirmModal would be the natural next step.

### Context switches

Page navigation renders the new `<Outlet />` immediately. No animated page transitions. Chat history is local component state and is cleared when the component unmounts or resets. [DEFAULT — same as Vault.]

---

## 6. Admin UI Patterns

The admin section is entirely new in ToolsForge — no Vault equivalent exists.

### Admin page structure

Each admin page follows a consistent three-part layout: a `p-6 max-w-4xl mx-auto` outer wrapper with:
1. A header row: page title (`text-xl font-semibold`), optional description, action buttons (Refresh, Invite/Create) right-aligned
2. A `rounded-2xl border overflow-hidden` container
3. Inside: a `<table>` with thead (column headers in the `text-xs uppercase tracking-wider muted` style), tbody (rows with `px-4 py-3` cells)

The `max-w-4xl mx-auto` centering gives admin pages a contained, document-like feel rather than full-bleed tables.

### Admin Users page

Table columns: Name, Email, Role, Status, Actions. Role and status are rendered as coloured pills (small `rounded-full px-2 py-0.5 text-xs`). Actions column: icon-only buttons for edit, deactivate, delete. Loading state: three-dot bounce animation in the table area. Empty state: inline message.

Invite flow: clicking "Invite User" opens a form (either inline or in a modal — pattern suggested by the `AdminUsersPage` import structure) to send an invitation email. New users accept via `/invite/:token` (public route outside `RequireAuth`).

### Admin AI Models page

Manages the set of AI models available to org users. Allows toggling models on/off, setting default model. Pattern: table of models with toggle switches. [DELIBERATE] — the ability for an org admin to control which AI models are available to members is a multi-tenancy feature absent from single-user Vault.

### Admin App Settings page

Organisation-level configuration: app name, timezone, allowed file types, and other org-wide defaults. These settings are consumed by the frontend (`useFileAttachment` fetches allowed types from `/api/admin/app-settings` on mount). [DELIBERATE] — in Vault, allowed file types were a user-level setting in `settingsStore`. In ToolsForge they are an org-level admin config, fetched from the server. This is the correct multi-tenant approach.

### Admin Agents page

Manages AI agent definitions available to the organisation. Each agent has a slug, name, system prompt, and model assignment. [DELIBERATE] — agent management as an admin concern is new to ToolsForge. In Vault, system prompts were embedded in code; in ToolsForge they are admin-configurable per tool.

---

## 7. State Management

Three Zustand stores, all persisted to `localStorage`:

**`authStore`** (key: `toolsforge-auth`): `{ token, user: { email, org_name, roles, first_name, last_name, phone } }`. The `roles` array is the multi-tenancy extension over Vault's single-user model. [DELIBERATE] — user object carries org context (`org_name`) alongside identity.

**`settingsStore`** (key: `toolsforge-settings`): `{ bodyFont, headingFont, theme }`. Two font axes rather than Vault's single font. Theme key is identical to Vault.

**`toolStore`** (key: `toolStore`): `{ lastVisitedTool, sidebarCollapsed }`. Tracks sidebar collapse state persistently (survives page reload). Also tracks the last visited tool ID for the "Last used" dashboard link. [DELIBERATE] — `lastVisitedTool` is a new UX pattern that acknowledges ToolsForge users may not know which tool they want on return visits.

---

## 8. Icon and Theme Providers

### IconProvider

A semantic name-to-Lucide mapping with 40+ entries. Usage: `const getIcon = useIcon(); getIcon('message-square', { size: 14 })`. Default size: 18px. Identical pattern to Vault. The semantic map is the same deliberate decoupling from the Lucide library directly — new icons must be registered in the map. [DELIBERATE] — same reasoning as Vault: future icon pack swaps are possible without touching component code.

### ThemeProvider

Reads `settingsStore.theme`, `settingsStore.bodyFont`, and `settingsStore.headingFont` on mount and on change. Writes CSS variables to a `<style id="toolsforge-theme-vars">` tag. The `--color-primary-rgb` derived variable is computed here from the hex primary colour. [DELIBERATE] — the RGB decomposition (`hexToRgb`) is a new utility in ToolsForge that Vault did not have.

---

## 9. Decisions Worth Preserving

**The `--color-primary-rgb` derived token** [DELIBERATE]: decomposing the primary hex to bare RGB components enables `rgba(var(--color-primary-rgb), 0.1)` for translucent active states — the cleanest possible approach to theme-aware transparent fills. Vault did not have this. Curam-MCP should adopt it from the start.

**Structured sidebar with section labels** [DELIBERATE]: ToolsForge's sidebar uses explicit section labels (Tools, Admin) rather than a flat icon strip (Vault) or a single undifferentiated list. As surface area grows, structure prevents cognitive overload. The `text-xs uppercase tracking-wider` label style is the right idiom.

**Sidebar collapse to icon rail** [DELIBERATE]: the 56px collapsed state keeps the sidebar present as a navigational aid without consuming horizontal space. Vault had no collapse at all. The in-flow spacer technique (a `<div>` that mirrors the sidebar's fixed width) is the correct implementation — no overlapping or re-laying-out of content.

**Role-aware tool registry as single source of truth** [DELIBERATE]: `src/config/tools.js` + `getPermittedTools()` ensures the dashboard grid and the sidebar nav are always in sync. Adding a new tool requires one registry entry; permission behaviour is automatic.

**Two font axes (body and heading)** [DELIBERATE]: splitting typography into body (`--font-body`) and heading (`--font-heading`) gives more expressive range than Vault's single variable. The global `h1–h6 { font-family: var(--font-heading) }` rule means any heading element automatically gets the editorial font.

**`org_name` in auth state** [DELIBERATE]: surfacing the organisation name in the dashboard greeting (`{user?.org_name} workspace`) makes multi-tenancy feel deliberate rather than incidental. Curam-MCP should always include org context in the identity model.

**Admin config propagated to UI on mount** [DELIBERATE]: `useFileAttachment` fetches org-level settings (allowed file types, timezone) from `/api/admin/app-settings` rather than reading a local store. Changes an admin makes propagate to new component mounts without a page reload. Vault read allowed file types from a user-owned Zustand store. The server-fetch approach is the correct multi-tenant pattern.

**Success toasts use `--color-primary`** [DELIBERATE]: success notifications use the theme's primary colour rather than a fixed green. On warm-sand this is terracotta; on dark-slate it is blue. This makes success feel branded rather than generic. Only error and warning use hardcoded colours (for legibility and universal recognition).

**Custom MarkdownRenderer over `react-markdown`** [DELIBERATE]: reduces bundle dependency but loses code fencing, syntax highlighting, and link handling. A reasonable trade-off for a tool-focused platform where AI output is structured prose, not code. Curam-MCP should evaluate whether fenced code blocks are needed and choose accordingly — not default to either approach.

**`RequireRole` as a route-tree middleware** [DELIBERATE]: placing access control in the route definition rather than inside page components is architecturally cleaner and prevents any accidental rendering of restricted UI. The pattern is: `<Route element={<RequireRole allowedRoles={[...]} />}><Route ... /></Route>`.

**`rounded-xl`/`rounded-2xl` everywhere, one step rounder than Vault** [DELIBERATE]: ToolsForge's corner radius convention is consistently one Tailwind step larger than Vault's. This is a subtle but consistent character decision — slightly softer, slightly more modern. Curam-MCP should pick one convention and apply it consistently rather than mixing.

**No flash-of-wrong-theme** [DELIBERATE]: seeding CSS variables in `:root` in `index.css` with the default theme values, then overwriting with the persisted setting at runtime, means the first paint always has valid colours. The ThemeProvider overwrites immediately on mount (synchronously via Zustand's persisted store), before the first browser frame would show unstyled content.
