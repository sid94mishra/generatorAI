# GeneratorAI Web — Design System

Single source of truth for the web UI's visual language, for both the web app and the Electron desktop app (same SPA). **All UI must use these tokens and primitives** — do not hand-roll buttons, cards, badges, selects, modals, tabs, or inputs with ad-hoc classes. Enforced by ESLint (design-system rules in the root `eslint.config.mjs`) and the ratchet check (`pnpm check:design` → [`scripts/check-design-system.mjs`](./scripts/check-design-system.mjs) vs [`design-system-baseline.json`](./design-system-baseline.json) — CI fails if any violation count rises).

## 1. Tokens & theming

Defined in [`src/styles/globals.css`](./src/styles/globals.css) in three layers:

1. **Raw semantic values** — unprefixed vars (`--background`, `--primary`, `--success-muted`…) set per theme (`:root` = dark default, `.light` override, future `[data-theme="<id>"]` blocks) and per accent (`[data-accent="<id>"]`). Components never reference these directly.
2. **Tailwind utility bridge** — `@theme inline` maps them to `--color-*` tokens, so semantic utilities are first-class: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `ring-ring`, `bg-primary`, `bg-primary-emphasis`, `bg-success-muted`, `text-danger`, `bg-sidebar`… **Use these utilities in all new code.**
3. **Compat aliases** — `--color-*: var(--*)` keep legacy `var(--color-*)` arbitrary values resolving during migration. Don't write new code against them; they're deleted in the final cleanup phase.

| Group | Utilities (examples) |
|---|---|
| Surfaces | `bg-background`, `bg-card`, `bg-popover`, `bg-subtle`, `bg-emphasis`, `bg-raised`, `bg-overlay` |
| Text | `text-foreground`, `text-muted-foreground`, `text-card-foreground` |
| Interactive | `bg-primary` (links/icons), `bg-primary-emphasis` (filled buttons — AA-safe), `text-primary-foreground`, `bg-accent`, `ring-ring` |
| Borders | `border-border`, `border-border-muted`, `border-input` |
| Status | `text-success` / `bg-success-muted`, `warning`, `danger`, `info`, `done` (+ `*-muted` tints) |
| Sidebar | `bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-accent` |
| Radii | `--radius` (6px), `--radius-lg` (8px), `--radius-xl` (10px) |

**Never hardcode palette classes** (`bg-blue-500`, `text-emerald-400`, hex values) — they break theming and the accent axis. Semantic mapping for migration: green/emerald → `success`, red/rose → `danger`/`destructive`, yellow/amber → `warning`, blue/indigo → `primary` (interactive) or `info` (informational state), purple/violet → `done`.

**Color discipline:** color encodes *status/meaning*, not decoration. Metric values, body text, and counts stay neutral (`text-foreground`). Reserve status colors for actual state; `primary` follows the user's accent.

### Themes & accents

- **Theme** (`light` / `dark` / `system`, extensible to named themes) and **accent** (blue default, violet, green, orange, rose, teal) are orthogonal axes, both user-selectable in **Settings → General → Appearance**.
- Registry: [`src/themes/registry.ts`](./src/themes/registry.ts) (`THEMES`, `ACCENTS`) — the pickers render from it. To add a theme or accent: add the registry entry + the matching CSS block in `globals.css` (recipe in each file's header comment). No other code changes.
- Wiring: [`src/providers/ThemeProvider.tsx`](./src/providers/ThemeProvider.tsx) sets `.dark`/`.light` class + `data-theme` + `data-accent` on `<html>` and persists `generatorai-theme` / `generatorai-accent`; the pre-hydration script in [`index.html`](./index.html) mirrors it before first paint (no FOUC). Keep the two in sync.
- Accent blocks override **only** `--primary`, `--primary-emphasis`, `--ring`, `--accent`, `--sidebar-accent*`. Status colors never change with accent.

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
