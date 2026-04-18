## 6. Decisions Worth Preserving

**Project Context:** Internal learning project for one organisation, solo developer. These decisions reflect the scale and context. See [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md).

Every flag in this section represents a choice that is non-obvious, easy to get wrong in a future session, or likely to be revisited. The [DELIBERATE], [FROM VAULT], and [MERGED DECISION] labels indicate origin and confidence.

---

**CSS-variable theming — seven-token model** [DELIBERATE — both predecessors]: all colour is written by `ThemeProvider` to a style tag at runtime. The same component tree works for any palette without Tailwind `dark:` duplication. Seed the defaults in `:root` in `index.css` so the first paint is never unstyled.

**`--color-primary-rgb` derived token** [DELIBERATE — ToolsForge evolution from Vault]: decompose the primary hex to bare `r,g,b` in `ThemeProvider`, enabling `rgba(var(--color-primary-rgb), 0.1)` for translucent active states. Vault used `var(--color-bg)` fills for active states, which breaks on low-contrast themes. Use the RGB pattern for all active/selected tinted backgrounds.

**Semantic colours hardcoded outside the token system** [DELIBERATE — both predecessors]: error `#ef4444`, warning `#f59e0b`, success `#22c55e` do not change with theme. They must remain universally recognisable. Success *toasts* use `var(--color-primary)` (branded) rather than the fixed green — this is the one exception.

**No flash-of-wrong-theme** [DELIBERATE — both predecessors]: seed CSS variables in `:root` with default values; `ThemeProvider` overwrites from Zustand-persisted settings synchronously on mount. The persisted setting is read before the first browser frame.

**Two font axes with a global heading rule** [DELIBERATE — ToolsForge evolution from Vault's single `--font-sans`]: `--font-body` and `--font-heading` as separate user-configurable settings. The global rule `h1–h6 { font-family: var(--font-heading) }` in `index.css` means any heading element automatically inherits the editorial font without per-component assignment.

**Opacity as the sole hover mechanism** [DELIBERATE — both predecessors agreed]: `hover:opacity-70` or `hover:opacity-80` universally. No colour shift. Works across all themes without per-theme hover token definitions.

**Structured sidebar with labelled sections and collapsible icon rail** [DELIBERATE — ToolsForge]: named sections (Tools, Admin), collapse to 56px, in-flow spacer technique. As the tool count grows, structure prevents overload. The single-derivation-point pattern (`isAdmin` from `AppShell`) ensures sidebar and route guards can never diverge.

**`--color-primary-rgb` for translucent active states in NavItem** [DELIBERATE — ToolsForge]: `rgba(var(--color-primary-rgb), 0.1)` for the active nav background. The `mx-2` inset keeps the tint away from sidebar edges. Icon colour inherits from parent via `color: inherit`. These three details together produce a cohesive active state.

**Two-level elevation model** [DELIBERATE — both predecessors]: only `--color-bg` (page canvas) and `--color-surface` (raised elements) are used for backgrounds. No third depth level. Prevents colour layering complexity across themes.

**Route-tree permission middleware** [DELIBERATE — ToolsForge evolution from Vault's `AuthGuard` wrapper]: `RequireAuth` and `RequireRole` are composable route elements, not in-page conditional JSX. Placing access control in the route definition prevents any accidental rendering of restricted UI.

**Tool registry as single source of truth** [DELIBERATE — ToolsForge]: `config/tools.js` with `getPermittedTools()` ensures dashboard card grid and sidebar nav are always in sync. One registry entry to add a tool; permission behaviour is automatic.

**Roles as a scoped array** [DELIBERATE — ToolsForge]: `user.roles: [{ name, scope_type }]` rather than a boolean flag. Designed to extend to org-scoped and team-scoped roles without a schema change.

**Admin config fetched from server on mount** [DELIBERATE — ToolsForge evolution from Vault's per-user Zustand store]: org-level settings (file types, timezone, model list) are fetched fresh on component mount. Admin changes propagate to new mounts without a page reload.

**Agent system prompts configurable in admin, not embedded in code** [DELIBERATE — ToolsForge]: the agents admin page stores slug, name, system prompt, and model assignment in the database. Vault embedded system prompts in route handler code, requiring a deploy to change them.

**`100dvh` with `100vh` fallback** [FROM VAULT — not carried forward by ToolsForge, reinstated here]: `min-height: 100vh; min-height: 100dvh` handles mobile browser chrome collapse for chat-style interfaces where the input area must reach the visible bottom. Essential; do not omit.

**Context bar as explicit visibility signal** [FROM VAULT — ToolsForge matches the structure but did not document the rationale]: the context bar makes "what the model can see" explicit. Pinned files (always in context) and session files (this session only) are distinguished by border colour alone — `var(--color-primary)` for session files, `var(--color-border)` for pinned. The subtle distinction is the right level of detail; do not over-label it.

**Inline destructive confirms, not modals** [FROM VAULT]: routine delete actions show "Delete? Yes / No" inline in the action row. ConfirmModal is reserved for high-stakes operations with type-to-confirm input. Inline confirms reduce cognitive weight and keep the destructive path visible in context.

**Bounce dots vs spinner** [DELIBERATE — both predecessors]: bounce dots = streaming pending (model is generating, no content yet); spinner = discrete async operation (save, API call with a completion event). Not interchangeable. The visual distinction communicates different states of waiting.

**`fetch` + `ReadableStream` for SSE** [DELIBERATE — both predecessors]: `EventSource` cannot POST. The fetch + `ReadableStream` approach supports sending the message payload while still receiving a streaming response. `AbortController` handles cancellation.

**`React.memo` on message list** [FROM VAULT — ToolsForge did not document this]: wrapping the message list with memo and explicit dependency control means delta appends only re-render the last message, not the entire history. Required for performance in long conversations.

**Success toasts use `var(--color-primary)`** [DELIBERATE — ToolsForge evolution from Vault's fixed green]: success feels branded on any theme. Error and warning use hardcoded colours for universal legibility.

**Explicit `×` close button on modals** [MERGED DECISION — ToolsForge evolution from Vault's backdrop-only dismiss]: adopted for accessibility. Both backdrop click and Escape key also dismiss.

**`org_name` in auth state, surfaced in UI** [DELIBERATE — ToolsForge]: members should always know which workspace they are in. Surface `user.org_name` in the dashboard greeting and TopNav without requiring navigation to settings.

**`lastVisitedTool` persisted in `toolStore`** [DELIBERATE — ToolsForge]: returning users can resume their last tool without browsing the card grid. Small quality-of-life detail with no implementation cost.

**Tailwind configuration maps CSS variables to utilities** [DECIDED — both document recommendation and human review agreed]: configure `bg-bg`, `text-primary`, `border-border` etc. in `tailwind.config.js` so responsive and variant syntax works with themed colours. Continue using inline styles where variant syntax is cumbersome.

**Corner radius convention: `rounded-xl` / `rounded-2xl`** [MERGED DECISION — ToolsForge convention adopted]: buttons and inputs at `rounded-xl`, surface containers and modals at `rounded-2xl`. Apply consistently throughout — do not introduce `rounded-lg` for new components.

**`pb-safe` for iOS home indicator** [FROM VAULT — via ToolsForge's `index.css`]: the `.pb-safe` utility class (`padding-bottom: max(1.25rem, env(safe-area-inset-bottom))`) must be applied to the chat input area on mobile to prevent the iOS home indicator from overlapping the send button.
