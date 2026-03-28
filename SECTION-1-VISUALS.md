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
