## 5. UX Patterns & Behaviours

**Project Context:** Internal learning project for one organisation, solo developer. Design decisions reflect this context. See [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md).

### State management

Three Zustand stores, all persisted to `localStorage`. Storage keys should be namespaced to avoid collisions with Vault or ToolsForge if they run on the same domain.

**`authStore`** (key: `curam-mcp-auth`):
```js
{
  token: string | null,
  user: {
    email, org_name,
    roles: [{ name, scope_type }],
    first_name, last_name, phone
  } | null,
  setAuth(token, user),
  clearAuth(),
  logout()
}
```
The `roles` array and `org_name` are non-negotiable for a multi-tenant application. [DELIBERATE — ToolsForge; Vault had no org context or role array.]

**`settingsStore`** (key: `curam-mcp-settings`):
```js
{ bodyFont, headingFont, theme, setBodyFont, setHeadingFont, setTheme }
```

**`toolStore`** (key: `curam-mcp-tool`):
```js
{ lastVisitedTool, sidebarCollapsed, setLastVisitedTool, toggleSidebar, setSidebarCollapsed }
```

On 401 responses, the API client clears auth state and redirects to `/login`. This should be the only place auth is cleared programmatically — never do it in component code.

### API client

A centralised fetch wrapper auto-adds `Authorization: Bearer ${token}` from `authStore` to every request and handles 401 globally. All authenticated API calls must go through this wrapper. Never use raw `fetch('/api/...')` for authenticated endpoints. [DELIBERATE — both predecessors enforced this as a rule; Vault documented it explicitly in its memory file.]

### Optimistic UI

Local state is updated before server confirmation for common mutations (list reorders, title edits). Toasts confirm immediately. Failures surface as inline errors and trigger a refetch. No explicit optimistic-then-rollback pattern exists — the simpler refetch-on-failure approach is sufficient for the current interaction surface.

### Focus management

- After modal close: return focus to the element that triggered the modal. Neither predecessor implemented this fully — do it from the start in Curam-MCP.
- After send: `textareaRef.current?.focus()` to return focus to the chat input.
- After inline panels close (URL input, search panels): `textareaRef.current?.focus()` explicitly, because inline panels are not modals with a natural dismiss path. [FROM VAULT — documented as a deliberate requirement.]
- Title / rename inputs: `setTimeout(() => inputRef.current?.focus(), 0)` to ensure the element is mounted before focusing.

### Keyboard navigation

Global shortcuts fire custom DOM events rather than direct state calls, so any component can respond without prop-drilling. [FROM VAULT — Vault used this architecture for `vault:toggle-sidebar`, `vault:new-chat`, etc. Carry the pattern forward with `curam-mcp:` namespaced events.]

Core shortcuts:
- `Cmd/Ctrl+K` — open global search palette
- `Cmd/Ctrl+B` — toggle sidebar
- `Enter` — send message in chat
- `Shift+Enter` — insert newline in chat input
- `Escape` — close modals, inline panels, dropdowns

The global search palette renders as `fixed inset-0 z-50`. A centred panel (`max-w-xl rounded-2xl`) contains a debounced search input across all entity types. Results grouped by type with icon prefixes. Keyboard navigation via ↑/↓. [FROM VAULT — Vault implemented this as a keyboard-first global affordance at the App level. ToolsForge has a nav search bar; both can coexist — nav bar for quick tool navigation, palette for cross-entity search.]

### File attachment

Three paths: (1) file picker button, (2) clipboard image paste (`paste` event), (3) drag-drop. All produce normalised attachment objects.

Images are resized client-side before encoding: max 800px on the longest edge, 0.75 JPEG quality, converted to base64. Text files are read via `FileReader` if under 500KB; larger files substitute a `[File too large]` message. Inline images (pasted or dropped directly into chat) are not uploaded to the server — they are embedded in the message payload as base64 only. [DELIBERATE — image-in-context does not require a file record on the server.]

Allowed file types are an org-level admin setting fetched from the server on component mount, not a user-level local store setting. [DELIBERATE — ToolsForge evolution from Vault's per-user setting; the correct multi-tenant approach.]

### Icon system

`IconProvider` maintains a semantic name-to-Lucide mapping (40+ entries). Usage everywhere:

```js
const getIcon = useIcon();
getIcon('message-square', { size: 14 })  // default size: 18px
```

New icons must be registered in the semantic map before use — Lucide imports are not used directly in component code. [DELIBERATE — both predecessors agreed on this pattern; it decouples icon names from the library and theoretically allows pack swaps without touching component code.]

### Voice input and output

**Input.** `useSpeechInput()` — browser Web Speech API. Continuous recognition with interim results. Returns `{ listening, transcript, start, stop, clear, supported }`. Rendered via `VoiceInputButton` in the chat toolbar.

**Output.** `useReadAloud()` — browser Speech Synthesis API. `stripForSpeech()` utility removes markdown formatting before synthesis. Each `speak()` call cancels the previous utterance. Returns `{ speaking, paused, speak, pause, resume, stop, supported }`. Rendered via `ReadAloudButton` on assistant messages.

Both hooks follow the three-layer pattern: headless logic hook → UI button component → integration in page. This separation allows the logic to be reused across tools without coupling to a specific UI.

### Timezone handling

Priority: user setting → org default (from app settings API) → browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`). The resolved timezone is used in system prompts and for message timestamps. System prompt should include today's date and current time in the resolved timezone. [FROM VAULT — Vault documented this priority chain explicitly. ToolsForge uses the same resolution order.]

### Admin config propagation

Org-level settings (timezone, allowed file types, available model list) are fetched from the server on component mount via the API client. This means admin changes propagate to new component mounts without a server restart or manual page reload — the next time the relevant component mounts, it gets fresh data. [DELIBERATE — ToolsForge; Vault stored these per-user in Zustand. The server-fetch approach is the correct multi-tenant pattern.]

### `lastVisitedTool`

`toolStore` tracks the ID of the last tool the user navigated to. The dashboard renders a "Last used: Tool →" link below the card grid on return visits. [DELIBERATE — ToolsForge quality-of-life detail; acknowledges that returning users often want to resume where they left off rather than browse the card grid again.]

### Safe area insets

The global CSS defines:

```css
.pb-safe {
  padding-bottom: max(1.25rem, env(safe-area-inset-bottom));
}
```

Apply `pb-safe` to the chat input area on mobile to prevent the iOS home indicator from overlapping the send button.
