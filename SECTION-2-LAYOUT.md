## 2. Layout & Structure

### Top-level shell

The authenticated shell has three fixed layers: a top nav, a left sidebar anchored below it, and a scrolling main content area that fills the remainder. The outer container uses:

```css
min-height: 100vh;
min-height: 100dvh;
```

[FROM VAULT — ToolsForge used only `min-h-screen`, losing the mobile viewport fix. The `dvh` unit is essential for chat-style interfaces where the input must reach the visible bottom when the mobile browser chrome collapses. Reinstated for Curam-MCP.]

```
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
```

The sidebar is `position: fixed; top: 56px; left: 0; bottom: 0`. An in-flow spacer `div` mirrors the sidebar's current width in the main flex row so content never slides under it. Both animate with `transition: width 200ms ease`. [DELIBERATE — cleaner than Vault's full-height flex row, which required `overflow: hidden` on the outer container and constrained independent scrolling.]

### TopNav

Height `h-14` (56px), `fixed top-0 left-0 right-0 z-50`, `background: var(--color-surface)`, bottom border `1px solid var(--color-border)`. Contains left to right: hamburger toggle (mobile only), brand name, global search bar (centred), user email, org name, role badge, logout control. All colours must use CSS custom properties — hardcoded Tailwind colour classes are not acceptable in this component. [MERGED DECISION — ToolsForge set 56px; Vault used 44px. The taller nav is adopted for Curam-MCP as the more appropriate scale for a multi-user workspace.]

The role badge renders at `text-xs rounded-full px-2 py-0.5`. `org_admin`: amber tint (`bg-amber-100 text-amber-800`). Member: muted surface pill. [DELIBERATE — role is surfaced persistently in the chrome so every user always knows their access level.]

### Sidebar

**Desktop.** Fixed, `top: 56px` to `bottom: 0`. Width 220px expanded, 56px collapsed. Animates at `transition: width 200ms ease`. Background `var(--color-surface)`, right border `1px solid var(--color-border)`.

Navigation is structured into named sections with `text-xs font-semibold uppercase tracking-wider` labels in `var(--color-muted)`:

1. Dashboard — no label, always first
2. **Tools** — section label; lists tools filtered by `getPermittedTools()` for the current role
3. **Admin** — section label; visible only when `isAdmin` is true
4. Settings + collapse toggle — footer, separated by a top border

[DELIBERATE — labelled sections prevent cognitive overload as the tool count grows. This is the ToolsForge evolution from Vault's flat unlabelled header strip, and the correct architecture for a multi-tenant platform where admins and members see different navigation.]

**Collapsed state.** 56px icon rail. Label spans are removed from the DOM when `collapsed` is true; icons remain at 15px. The collapse toggle shows a chevron that rotates direction on state change. Collapse state persists in `toolStore` so it survives page reload. [DELIBERATE — the in-flow spacer technique means no content reflow occurs during collapse, only width animation.]

**Mobile.** A separate aside element starts at `transform: translateX(-100%)` and transitions to `translateX(0)` when open, at `200ms ease`. A `bg-black/40` backdrop renders at `z-40` and dismisses the sidebar on tap. Mobile sidebar is always 220px — no icon-rail mode on mobile. Navigation link clicks auto-close the sidebar via an `onLinkClick` callback. [DELIBERATE — auto-close on navigation prevents the common failure mode of navigating with the overlay still visible.]

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
  <span className="shrink-0" style={{ color: 'inherit' }}>
    {getIcon(iconName, { size: 15 })}
  </span>
  {!collapsed && (
    <span className="whitespace-nowrap overflow-hidden">{label}</span>
  )}
</NavLink>
```

The `mx-2` insets the active tint away from sidebar edges. Icon colour inherits from the parent so it tracks active/inactive state without a separate assignment. [DELIBERATE — ToolsForge evolution from Vault's `var(--color-bg)` fill, which breaks on themes where `bg` and `surface` have low contrast. The translucent `rgba(var(--color-primary-rgb), 0.1)` tint works on every theme.]

### Main content area

`flex-1 overflow-y-auto`. Fills the horizontal space the sidebar spacer does not occupy. Pages render via `Outlet` at full available height. Individual pages handle their own internal padding — `p-6` for admin and settings pages, `p-8` for the dashboard.

### Chat page layout

The chat page imposes a flex-column structure inside the main content area. Each strip is `flex-shrink-0` except the message list:

```
Chat header (h-12, 48px)  — session selector, model/persona pickers
Banners                   — persistent warnings, delete confirmations
Context bar               — files in context, collapsible [FROM VAULT]
Message list              — flex-1, overflow-y-auto
Error banner              — conditional, stream and API errors
Input area                — auto-sizing textarea + toolbar
```

The context bar is a `flex-shrink-0 border-b` strip visible only when files are in context. [FROM VAULT — Vault introduced this deliberately to make "what the model can see" explicit. ToolsForge matches the structure but did not document the pattern. Carry it forward.]

### Dashboard layout

`p-8` padded page. Greeting heading (`text-2xl font-bold`, heading font), org name subline in muted colour, responsive tool card grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`. Below the grid: "Last used: Tool →" link when `lastVisitedTool` is set. [DELIBERATE — ToolsForge; no Vault equivalent.]

### Admin page layout

Each admin page uses `p-6 max-w-4xl mx-auto`. Three parts: (1) header row with `text-xl font-semibold` title, optional description, right-aligned action buttons; (2) `rounded-2xl border overflow-hidden` container; (3) a table with thead column labels at `text-xs uppercase tracking-wider` in muted colour, tbody rows at `px-4 py-3`. The `max-w-4xl mx-auto` centering gives admin pages a contained, document-like feel. [DELIBERATE — ToolsForge; no Vault equivalent.]

### Responsive behaviour

Primary breakpoint: `md` (768px). Below: sidebar hidden, hamburger shown, single-column layouts. Above: desktop sidebar visible. A secondary `lg` (1024px) applies only to the dashboard card grid (2 → 3 columns). Mobile inputs are forced to `font-size: 16px !important` globally to prevent iOS zoom-on-focus. [MERGED DECISION — ToolsForge evolved Vault's `sm` (640px) breakpoint to `md` (768px), the conventional tablet boundary. Adopted as the standard.]

### Z-index conventions

| Layer | Value |
|---|---|
| Backdrop behind dropdowns | `z-10` |
| Dropdown menus | `z-20` |
| Mobile sidebar backdrop | `z-40` |
| Desktop sidebar (fixed) | `z-40` |
| Modals | `z-50` |
| Mobile sidebar overlay | `z-50` |
| Toast stack | `z-[9999]` |

[MERGED DECISION — ToolsForge used `z-[100]` for toasts; Vault used `z-[9999]`. Toast must clear third-party overlays and browser extensions that inject at arbitrary z values. Vault's `z-[9999]` is adopted.]

### Multi-tenancy layout considerations

Role determination happens once at `AppShell` level: `user.roles.find(r => r.scope_type === 'global')?.name`. The `isAdmin` boolean derived from this controls both the Admin sidebar section and the `RequireRole`-guarded route tree — the same value, so they can never diverge. [DELIBERATE — single derivation point eliminates the bug class where the sidebar shows an admin link but the route guard rejects access.]

The org name (`user.org_name`) surfaces in the dashboard greeting and the TopNav, making tenant context visible at all times. Members should always know which workspace they are in without navigating to settings. [DELIBERATE — ToolsForge; Vault was single-user and had no equivalent.]
