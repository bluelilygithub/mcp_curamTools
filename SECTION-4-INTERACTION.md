## 4. Interaction & Animation

### Transition conventions

All explicit micro-interactions use 200ms: sidebar width (`transition: width 200ms ease`), mobile sidebar slide (`transition: transform 200ms ease`), sidebar chevron rotation (inline `transition: transform 200ms`). Tailwind utility classes (`transition-opacity`, `transition-all`) resolve to 150ms by Tailwind's default — a mild inconsistency in both predecessors that should be resolved in Curam-MCP by setting a custom default duration. [DECISION REQUIRED — see Annotation Required.]

Sidebar collapse animates width only, not position or opacity. Content inside uses `overflow: hidden` to clip labels during the animation. Icons remain visible at all widths because they are 15px and the collapsed width is 56px.

### Hover states

`hover:opacity-70` or `hover:opacity-80` universally. No colour shift on hover. [DELIBERATE — opacity-only hover works across all themes without per-theme hover variant definitions. Both predecessors agreed on this approach.]

### Focus states

Inputs use `outline: none`; border changes to `var(--color-primary)` on focus where implemented. No global `:focus-visible` ring exists in either predecessor. [DECISION REQUIRED — Curam-MCP is multi-user; accessibility matters more than in a single-user tool. See Annotation Required.]

### Streaming SSE content

The streaming hook uses `fetch` + `ReadableStream` rather than `EventSource`, because POST requests are required to send the message payload. `EventSource` is GET-only. [DELIBERATE — both predecessors used this approach for the same reason.]

The stream is read as UTF-8 text, split on `\n\n`, each SSE event parsed as JSON. Event types:
- `text` — appended to the accumulated content string
- `usage` — token counts and cost data, stored in hook state
- `error` — sets error state, stops streaming
- `[DONE]` — marks stream complete

An `AbortController` is held in a ref and triggered on `stop()` or on a new `send()` call, cancelling any in-flight request.

During streaming, content renders progressively without buffering or debouncing — each `text` event triggers a re-render of the active message. [DELIBERATE — character-by-character appearance communicates "generating" rather than "loading". Both predecessors agreed.]

After streaming ends, the accumulated content transitions to message history via a `useEffect` watching `[streaming, content]`.

**Performance.** Wrap the message list in `React.memo` with explicit dependency control so that delta appends only re-render the last message, not the full list. [FROM VAULT — Vault used `MemoMessageList` with this pattern and documented it explicitly. ToolsForge did not. Essential for long conversation histories.]

**Searching state** [FROM VAULT]. When a web search is in progress before the response begins, replace the bounce loading dots with a globe icon + "Searching the web…" at `text-xs var(--color-muted)`.

### Model advisor intercept

Before sending in chat tools, a pre-send step analyses the prompt via an API endpoint. If the server recommends a different model, `ModelAdvisorModal` is shown. The user chooses to switch or proceed. Only after this check (or its bypass) does the actual stream begin. [DELIBERATE — ToolsForge; Vault sent immediately. The intercept acknowledges multi-model complexity without being blocking.]

### Error surfacing

Four contexts with distinct treatments:

1. **Stream errors** — inline error banner below the message list, in the `#fff1f2` / `#991b1b` error colour set. Dismissable via `×`. Persist until dismissed.
2. **Destructive action confirms** — inline "Delete? Yes / No" in the action row. ConfirmModal only for high-stakes operations requiring type-to-confirm input.
3. **Async background operations** — toast (error type, `#ef4444`).
4. **Form / component errors** — inline `text-xs rounded-lg` panel, `rgba(239,68,68,0.1)` background, `#ef4444` text.

The pattern: toast for background operations, inline banner for persistent blocking errors, inline confirm for routine destructive actions. [FROM VAULT — Vault documented this four-context classification explicitly and implemented it consistently. ToolsForge followed the same approach but did not document it.]

### Context switches

Page navigation renders the new page immediately — no animated transition. Chat history is local component state; it is cleared on component unmount or explicit reset. Clean slate rather than animated departure. [DEFAULT — both predecessors share this behaviour without flagging it as deliberate.]

### `animate-bounce` vs `animate-spin`

Bounce dots = waiting for streamed content to begin (model is generating). Spinner = waiting for a discrete operation to complete (save, invite, API call). These are not interchangeable — a spinner during stream pending would feel wrong because there is no discrete completion event. [DELIBERATE — Vault documented this distinction; ToolsForge used the same pattern. Maintain it consistently in Curam-MCP.]
