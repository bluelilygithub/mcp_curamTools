## Annotation Required

Every point below was flagged during the merge process as requiring a human decision before UI work starts. Work through this list in sequence. Add your resolution and reasoning directly to each item, then the document is done.

---

- ~~**[MERGED DECISION] Tailwind configuration**~~ — **RESOLVED.** Configure the CSS variable mapping in `tailwind.config.js` from the start. Continue using inline styles where variant syntax is cumbersome. See §1 Tailwind configuration for the config excerpt.

- **[MERGED DECISION] Toast z-index** — adopted Vault's `z-[9999]` over ToolsForge's `z-[100]` on the grounds that toast must clear any future third-party overlay. Confirm or override.

- **[MERGED DECISION] Corner radius convention** — adopted ToolsForge's `rounded-xl` / `rounded-2xl` (inputs+buttons / containers+modals) over Vault's one-step-smaller convention. Confirm or override.

- **[MERGED DECISION] Modal dismiss** — adopted ToolsForge's explicit `×` close button in addition to backdrop-click and Escape, over Vault's backdrop-only approach. Rationale: more accessible and more conventional. Confirm or override.

- **[MERGED DECISION] TopNav height** — adopted ToolsForge's 56px over Vault's 44px. Rationale: more appropriate scale for a multi-user workspace. Confirm or override.

- **[DECISION REQUIRED] `Button` component** — neither predecessor created a dedicated component; all button variants are composed inline everywhere. Curam-MCP should decide explicitly: inline composition (accepts inconsistency risk, no abstraction to learn) or a `Button` abstraction (enforces consistency, adds a component to maintain). Choose one before any UI work begins.

- **[DECISION REQUIRED] Markdown renderer** — Vault used `react-markdown` + `remarkGfm` (full GFM: code blocks, links, tables; third-party dependency). ToolsForge used a custom zero-dependency renderer (headings, bold, lists, tables, rules; no fenced code blocks or link handling). If Curam-MCP tools will return code samples, use `react-markdown`. If prose and tables only, the custom renderer is leaner. Decide based on the tool surface area.

- **[DECISION REQUIRED] Assistant message avatar** — Vault rendered a `✦` symbol in a small rounded avatar circle at the start of assistant messages (personal, warm). ToolsForge rendered no avatar (generic, clean). These signal different things: avatar → personal tool; no avatar → shared workspace. Curam-MCP is multi-tenant; no avatar may be the right signal. This is a character call, not a technical one.

- **[DECISION REQUIRED] Transition duration standardisation** — both predecessors have a 200ms/150ms mismatch: explicit inline transitions use 200ms, but Tailwind utility classes (`transition-opacity`, `transition-all`) resolve to Tailwind's default 150ms. The fix is `transitionDuration: { DEFAULT: '200ms' }` in `tailwind.config.js`. Confirm this is acceptable, or decide to leave the mismatch and document it as a known inconsistency.

- **[DECISION REQUIRED] `:focus-visible` ring** — neither predecessor implemented a global focus ring. Acceptable for a single-user tool; less so for a multi-user platform where keyboard accessibility matters more. Options: (a) add `*:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }` globally, (b) handle focus per-component as both predecessors did, or (c) use a UI library component that handles it. The recommendation is option (a) as the lowest-effort baseline.
