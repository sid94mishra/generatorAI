# GeneratorAI Web — Design System

Single source of truth for the web UI's visual language, for both the web app and the Electron desktop app (same SPA). **All UI must use these tokens and primitives** — do not hand-roll buttons, cards, badges, selects, modals, tabs, or inputs with ad-hoc classes. Enforced by ESLint (design-system rules in the root `eslint.config.mjs`) and the ratchet check (`pnpm check:design` → [`scripts/check-design-system.mjs`](./scripts/check-design-system.mjs) vs [`design-system-baseline.json`](./design-system-baseline.json) — CI fails if any violation count rises).

## 1. Tokens & theming

The source of truth is **[`packages/design-tokens`](../../packages/design-tokens/)**, not this app. `pnpm tokens:write` regenerates the CSS layers in [`src/styles/globals.css`](./src/styles/globals.css) (between the `@generated-tokens` markers) and the mobile token module; `pnpm tokens:check` fails CI if either is stale. **Never hand-edit inside the markers.**

### Three orthogonal axes

| Axis | Values | DOM | Storage key |
|---|---|---|---|
| **Mode** | `light` / `dark` / `system` | `.light`/`.dark` class + `data-mode` | `generatorai-theme` |
| **Theme** | 17 palettes, grouped — see below | `data-theme` | `generatorai-theme-palette` |
| **Accent** | `blue`, `violet`, `green`, `orange`, `rose`, `teal` | `data-accent` | `generatorai-accent` |

Any mode × any theme × any accent is valid — 17 themes × 2 variants × 6 accents = 204 combinations, every one of them asserted against WCAG AA. A theme owns its surfaces, hues, **type stack and corner radii**; an accent only recolours interactive chrome, and draws from the active theme's own hues so it can never clash. Status colours are never accent-controlled.

| Group | Themes |
|---|---|
| **Product** — interface-first, built for chrome rather than a buffer | `github` (default), `graphite`, `carbon`, `clay` |
| **Editor** — ports of the most-installed syntax themes | `one`, `dracula`, `tokyo-night`, `catppuccin`, `ayu`, `night-owl`, `rose-pine` |
| **Low glare** — warm or desaturated, for long sessions | `nord`, `everforest`, `gruvbox`, `solarized`, `flexoki`, `contrast` |

`contrast` is the odd one out and deliberately so: it targets **WCAG AAA** (7:1 body *and* secondary text, 4.5:1 for status and accents) rather than AA, and has its own assertions in the token suite. AA is what a product ships at; AAA is what low vision or a glare-heavy room actually needs.

### The CSS layers

1. **Raw semantic values** — unprefixed vars (`--background`, `--primary`, `--success-muted`…) emitted per theme × appearance × accent. Components never reference these directly.
2. **Tailwind utility bridge** — `@theme inline` maps them to `--color-*`, so semantic utilities are first-class: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `ring-ring`, `bg-primary`, `bg-primary-emphasis`, `bg-success-muted`, `text-danger`, `bg-sidebar`… **Use these utilities in all new code.**
3. **Compat aliases** — `--color-*: var(--*)` keep legacy `var(--color-*)` arbitrary values resolving during migration. Don't write new code against them.
4. **Syntax rules** — `.hljs-*` classes bound to `--syntax-*`, so code blocks follow the theme. There is no highlight.js stylesheet to swap any more.

> **The emission order in [`emit/css.ts`](../../packages/design-tokens/src/emit/css.ts) is load-bearing.** `.light[data-theme="x"]` and `[data-theme="x"][data-accent="a"]` tie on specificity (0,2,0) and are resolved by source order. Reordering those sections silently gives light-mode users dark-mode accents.

| Group | Utilities (examples) |
|---|---|
| Surfaces | `bg-background`, `bg-card`, `bg-popover`, `bg-subtle`, `bg-emphasis`, `bg-raised`, `bg-overlay` |
| Text | `text-foreground`, `text-muted-foreground`, `text-card-foreground` |
| Interactive | `bg-primary` (links/icons), `bg-primary-emphasis` (filled buttons — AA-safe), `text-primary-foreground`, `bg-accent`, `ring-ring` |
| Borders | `border-border`, `border-border-muted`, `border-input` |
| Status | `text-success` / `bg-success-muted`, `warning`, `danger`, `info`, `done` (+ `*-muted` tints) |
| Sidebar | `bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-accent` |
| Charts | `var(--chart-1)` … `var(--chart-6)` — the categorical ramp; **the only sanctioned chart colours** |
| Radii | `--radius`, `--radius-lg`, `--radius-xl` (theme-owned: 4px on Graphite, 10px on Rosé Pine) |

**Never hardcode palette classes** (`bg-blue-500`, `text-emerald-400`, hex values) — they break theming and the accent axis. Semantic mapping for migration: green/emerald → `success`, red/rose → `danger`/`destructive`, yellow/amber → `warning`, blue/indigo → `primary` (interactive) or `info` (informational state), purple/violet → `done`, chart series → `var(--chart-N)`.

**Color discipline:** color encodes *status/meaning*, not decoration. Metric values, body text, and counts stay neutral (`text-foreground`). Reserve status colors for actual state; `primary` follows the user's accent.

### Adding a theme

1. Add `packages/design-tokens/src/themes/<id>.ts` exporting a `ThemeDef` — six surfaces, three text colours, two borders and nine hues per appearance, plus a `group`.
2. Register it in `themes/index.ts`.
3. `pnpm tokens:write`.

That is the whole checklist. The web picker, the mobile picker, the CSS, the terminal palette, the syntax colours and the WCAG suite all read from the registry, so a new theme is covered by the accessibility tests before it is ever rendered.

Budget: all 17 themes cost **~19 KB gzipped** of CSS (136 KB raw, which compresses hard because it is 118 near-identical blocks). That buys zero-latency switching with no extra request and no flash, which is why they all ship in one stylesheet rather than as lazy chunks.

### Accessibility

`packages/design-tokens/src/__tests__/tokens.test.ts` asserts, for **every** theme × appearance × accent: body and muted text ≥ 4.5:1 on every surface, status colours ≥ 3:1 **and mutually distinguishable**, filled buttons ≥ 4.5:1, accent links ≥ 3:1, selection tints still readable through, borders visible, terminal and syntax colours legible. Filled-button variants are *derived* via `ensureContrast()` rather than authored, so a theme cannot ship an unreadable button.

The distinguishability assertion is the one that catches the most real bugs: warm retro palettes (Gruvbox, Solarized, Everforest) put their green and yellow one hue step apart, which is fine for syntax and not fine for a "completed" badge next to a "needs you" badge.

### Consumers that need literals

xterm.js paints to a canvas and cannot resolve `var(--…)`. It reads `resolveTerminalPalette(theme, appearance)` from the token package — **not** `getComputedStyle`, which would race the theme swap. Same rule for any future canvas/WebGL surface.

### Wiring

[`src/providers/ThemeProvider.tsx`](./src/providers/ThemeProvider.tsx) is the only writer of the three axes; the pre-hydration script in [`index.html`](./index.html) mirrors it before first paint (no FOUC). Keep the two in sync.

## 2. Primitives — import from `@/components/ui`

The barrel `@/components/ui` is the **only sanctioned import path** for primitives.

```ts
import { Button, Card, Badge, StatusBadge, Select, Modal, Input, Textarea,
         Tabs, SearchInput, EmptyState, StatCard, PageHeader, Skeleton,
         ToggleSwitch, NumberStepper, CollapsibleSection, Tooltip, ConfirmDialog } from '@/components/ui';
```

| Primitive | Use for | Key props |
|---|---|---|
| `Button` | Every clickable action | `variant` (primary/secondary/ghost/danger/subtle), `size` (sm/md/lg/icon/icon-sm), `loading`, `leftIcon`/`rightIcon` |
| `Card` | Surfaces / list cards | `interactive`, `accent` |
| `Badge` | Tags, counts, model chips | `tone` (neutral/primary/success/warning/danger/info/done), `size`, `dot` |
| `StatusBadge` | **Every** entity status (17-status map) | `status` — single source of status→color+icon+label truth |
| `Select` | **All** dropdowns (never native `<select>`) | `value`, `onChange`, `options`, `disabled` |
| `Modal` | **All** dialogs (never a hand-rolled `fixed inset-0` overlay) | `open`, `onClose`, `title`, `size`, `footer`, `dismissible` |
| `ConfirmDialog` | All confirmations (never native `confirm()`) | `open`, `title`, `tone`, `onConfirm`/`onCancel` |
| `Input` / `Textarea` | Text fields | `invalid` |
| `Tabs` | All tab bars (pages + dialogs) | — |
| `SearchInput` | List-page search | — |
| `EmptyState` | All "no data" placeholders | `icon`, `title`, `description`, `action` |
| `Skeleton` | Loading placeholders (prefer over spinners for content) | — |
| `StatCard` | Dashboard / detail metrics | `label`, `value`, `icon`, `iconTone`, `onClick` |

Planned additions (Phases 1–4 of the overhaul): shadcn/ui-vendored internals, `SearchableSelect`, `Spinner`, `DropdownMenu`, `Toolbar`, `Kbd`, sonner toasts, command palette; shared kits `components/data/` (EntityCard, EntityListRow, FilterTabs, DataTable), `components/files/` (FileTree, FileViewer, DiffView), `components/agent/` (StreamPanel, StagePanel, ToolCallCard…). See the overhaul plan.

### Legacy → primitive mapping
- `.btn-glow` → `<Button variant="primary">` · `.glass-btn` → `<Button variant="secondary">` · bare icon button → `<Button variant="ghost" size="icon">`
- `.glass-card` → `<Card>` · `.glass-input` → `<Input>` · hand-rolled overlay → `<Modal>` · native `confirm()` → `<ConfirmDialog>`
- inline status pill (`rounded-full px-2 py-0.5 bg-green-100…`) → `<StatusBadge status={…}>`
- `Loader2` + `animate-spin` → `<Spinner>` (or `<Skeleton>` for content areas)

## 3. Composite (shared) components

When a component is needed in 2+ places, extract it — never copy-paste.

| Component | Location | Used by |
|---|---|---|
| `WorkflowCard` | `components/workflow/WorkflowCard.tsx` | Dashboard, Workflows list, Templates |
| `RightPane` | `components/layout/RightPane.tsx` | Chat page, Workflow run page (the single right-dock implementation) |

## 4. Conventions

- **Imports** use the `.js` extension (NodeNext ESM); primitives via the `@/components/ui` barrel.
- **Class merging** via `cn()` from `@/lib/utils`.
- **Spacing/density:** compact, information-dense layouts (Vercel/Linear reference). Primary CTAs always visible.
- **Loading:** skeletons for content with predictable shape (lists, cards, messages); spinners only for brief inline waits (inside buttons); never a lone centered spinner on an empty page.
- **Errors:** inline next to what failed (form fields, step rows); toasts only for transient out-of-context events.
- **Accessibility:** focus-visible rings come from `globals.css`; `aria-label` on icon-only buttons; never color-only state (pair icon/label).
- **Desktop:** the Electron app renders this same SPA — no desktop-specific styling forks; platform affordances are runtime-gated.
