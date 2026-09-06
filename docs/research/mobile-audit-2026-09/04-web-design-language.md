# GeneratorAI Web Client — Design Language & Chat/Agent Surface Internals

Audience: a mobile designer/engineer reproducing the web app natively. Everything below is
read from the working tree of `apps/web` and `packages/design-tokens` (branch `arch-redesign`,
uncommitted changes included). Paths are repo-relative; `L` = line number.

---

## 1. Tokens & theming

### 1.1 Three orthogonal axes (mode × theme × accent)

`packages/design-tokens/src/registry.ts` L1-16 documents the model:

| Axis   | Values | Persisted key (`registry.ts` L50-55) | DOM hook on web |
|--------|--------|--------------------------------------|-----------------|
| mode   | `system` / `light` / `dark` (`ThemeMode`, default **`dark`** L34) | `generatorai-theme` | `<html class="light|dark">` |
| theme  | 17 palettes (see 1.3) default **`github`** | `generatorai-theme-palette` | `<html data-theme="…">` |
| accent | `blue` / `violet` / `green` / `orange` / `rose` / `teal` (`ACCENT_IDS`, `themes/types.ts`) | `generatorai-accent` | `<html data-accent="…">` |

`apps/web/index.html` L17-36 applies all three from localStorage before first paint (no flash);
`providers/ThemeProvider.tsx` L141-165 keeps them in sync and follows `prefers-color-scheme`
when mode is `system`. Mobile should persist the same three keys with the same ids.

### 1.2 What a theme author writes vs. what is derived

`themes/types.ts` — `ThemeAppearanceSpec` (authored per appearance):

- 6 surfaces: `background` (canvas) → `card` (sidebar/panels, one step off) → `popover` (menus, dialogs, tooltips; floats above everything) → `raised` (nested panels) → `subtle` (hover/inset fills, inputs, secondary buttons) → `emphasis` (strongest non-text fill, dividers that read as a shape).
- 3 text: `foreground` (4.5:1 on every surface), `mutedForeground` (secondary, also 4.5:1), `onAccent` (text on filled buttons).
- 2 borders: `border`, `borderMuted`.
- 9 hues: `red orange yellow green teal cyan blue purple pink`.
- Optional: `canvasBg`, `canvasDot`, `accentEmphasis` (filled-button colour per accent), `terminal` overrides.
- Per theme (not per appearance): `fonts {sans, mono}`, `radius {DEFAULT, lg, xl}`, `defaultAccent`, `group`.

Everything else is **derived** (`resolveAppearanceTokens`, `resolveAccentTokens`, `resolveTerminalPalette`, `resolveSyntaxTokens`, `resolveChartRamp`, `themeSwatch` in `themes/types.ts`):

| Derived token | Rule |
|---|---|
| `surface` / `surfaceHover` | aliases of `card` / `subtle` (for embedded/iframe content) |
| `secondary`, `muted` | = `subtle`; `secondaryForeground` = `foreground` |
| `destructive` / `danger` | = `hues.red`; `success` = green; `warning` = yellow; `info` = blue; `done` = purple |
| `*-muted` status washes | hue at alpha **15% dark / 12.5% light** (`TINT.status`) |
| `input` (form-control border) | `border` pushed toward foreground until **3:1** on both `background` and `card` (`inputBorder`) |
| `primary` | the accent's hue; `primaryEmphasis` = authored `accentEmphasis[id]` or hue darkened/lightened until **4.5:1** against `onAccent` (`accentEmphasis`) |
| `ring` | === `primary` (invariant) |
| `accent` (selected rows / hovered menu items) | tint base at **20% dark / 10% light** (`TINT.accent`); tint base = `emphasis` on dark, `primary` on light |
| `sidebarAccent` (active nav pill) | tint base at **13% dark / 8% light**; `sidebarAccentForeground` === `primary` |
| `sidebar` / `sidebarForeground` / `sidebarBorder` | = `card` / `mutedForeground` / `border` |
| `canvasBg` / `canvasDot` | `background` / `border` at 60% |
| chart ramp `--chart-1..6` | `[blue, purple, orange, green, teal, pink]` |
| syntax roles | comment=muted, keyword=purple, string=green, number/constant=orange, function=blue, type=yellow, variable=foreground, operator=cyan, punctuation=muted, tag=red, attribute=teal, deleted=red, inserted=green |
| terminal (xterm ITheme) | black=`emphasis`, white=`mutedForeground`, brightWhite=`foreground`, bright* = hue mixed 25% toward foreground, selection = blue @ 40% dark / 25% light, cursor = foreground |

Default theme (GitHub/Primer) values, `themes/github.ts` L30-129:

| token | dark | light |
|---|---|---|
| background | `#0d1117` | `#ffffff` |
| card | `#161b22` | `#f6f8fa` |
| popover | `#1c2129` | `#ffffff` |
| subtle | `#21262d` | `#f0f3f6` |
| emphasis | `#30363d` | `#dfe2e5` |
| foreground | `#e6edf3` | `#1f2328` |
| mutedForeground | `#8b949e` | `#656d76` |
| border | `#30363d` | `#d0d7de` |
| borderMuted | `#21262d` | `#d8dee4` |
| blue (primary, default accent) | `#4493f8` | `#0969da` |
| blue emphasis (filled button) | `#1f6feb` | `#0969da` |
| red / green / yellow / purple | `#f85149` / `#3fb950` / `#d29922` / `#a371f7` | `#d1242f` / `#1a7f37` / `#9a6700` / `#8250df` |

### 1.3 Theme registry (`themes/index.ts` L36-56, picker order)

- **Product**: `github` (default, blue, SYSTEM fonts, radius 6/8/10), `graphite` (blue, Geist/JetBrains, 4/6/8), `carbon` (green, Geist/JetBrains, 8/12/16), `clay` (orange, IBM Plex, **10/14/20**).
- **Editor**: `one` (6/8/12), `dracula` (violet, 6/10/14), `tokyoNight` (Geist/Cascadia, 6/10/14), `catppuccin` (violet, Nunito rounded, 8/12/16), `ayu` (orange, 6/8/12), `nightOwl` (6/10/14), `rosePine` (violet, 10/14/18).
- **Low glare**: `nord` (teal, 4/6/8), `everforest` (green, 6/10/14), `gruvbox` (orange, 4/6/8), `solarized` (4/6/10), `flexoki` (4/6/10), `contrast` ("High Contrast", 4/6/8).

Radius is a **per-theme** property; do not hardcode one radius set. Font stacks (`themes/fonts.ts`): `SYSTEM_SANS`, `GEOMETRIC_SANS` (Geist/Inter), `HUMANIST_SANS` (IBM Plex Sans), `ROUNDED_SANS` (Nunito Sans); mono: `SYSTEM_MONO`, `CODE_MONO` (JetBrains Mono/Fira Code), `PLEX_MONO`, `CASCADIA_MONO`. Every stack ends in the platform default; nothing is bundled on web. Native: `NATIVE_FONT_FAMILY = { sans: undefined (system), mono: 'JetBrainsMono' }` (`tokens.ts`).

### 1.4 File-icon palette (theme-independent)

`tokens.ts` `FILE_ICON_COLORS`: 13 named pairs (gray, red, vermilion, orange, yellow, green, teal, cyan, blue, indigo, purple, pink, mauve) with light/dark hexes mirroring `@pierre/trees`. Emitted as `--file-icon-<name>`. Known upstream defect: `vermilion` is inverted (light `#ff8c5b`, dark `#d5512f`) — mirrored deliberately.

### 1.5 Export pipeline and `tokens:check`

`bin/generate.ts` (targets L30-47):
- Web: splices generated CSS between `/* @generated-tokens:start … */` and `/* @generated-tokens:end */` in `apps/web/src/styles/globals.css` (L5 → L5202 in the working tree). Hand-written CSS below the end marker is untouched (`emit/css.ts` `spliceCss`).
- Mobile: writes the whole file `apps/mobile/src/theme/tokens.generated.ts` (optional target; skipped if the app dir is absent).
- `--check` (CI) compares **CRLF-normalised** text (`generate.ts` L66-80) and fails with "STALE" if either target differs; `--write` regenerates preserving the file's dominant EOL. Scripts: `pnpm --filter @generatorai/design-tokens tokens:check | tokens:write` (`package.json` L34-35).

CSS emitter (`emit/css.ts`): four layers —
1. Raw semantic vars per theme × appearance × accent. Specificity ladder (L14-28): `:root` (github dark) → `.light` → `[data-theme=x]` → `.light[data-theme=x]` → `[data-theme=x][data-accent=a]` → `.light[data-theme=x][data-accent=a]`. Emission order is load-bearing.
2. `@theme inline { --color-* : var(--*) }` → Tailwind v4 utilities (`bg-background`, `text-muted-foreground`, `bg-success-muted`, `ring-ring`…). Full list L131-176.
3. `:root { --color-*: var(--*) }` compat aliases for legacy `var(--color-…)` arbitrary values.
4. highlight.js rules driven by `--syntax-*`.

Native emitter (`emit/native.ts` `emitNative`): exports `themeVars[theme][appearance][accent]` (NativeWind `vars()` input, keys identical to the web CSS var names), `rawTokens` (same object for Skia/status bar), `terminalThemes[theme][appearance]` (xterm ITheme), `themeMeta` (id/label/description/credit/defaultAccent/radius/swatch), `tailwindColors`, `radius`, `fontFamily`, `fontSize`, `lineHeight`, `spacing`, `motion`, `TWO_PANE_MIN_WIDTH`.

---

## 2. Typography, spacing, radius, motion — actual numbers

Source: `packages/design-tokens/src/tokens.ts` unless noted.

**Type scale** (`FONT_SIZE`, px): xs 11 · sm 12 · base **14** · md 15 · lg 17 · xl 20 · 2xl 24 · 3xl 30.
Web body: 14px / line-height 1.5 (`globals.css` ≈L5278). In practice the chat UI uses many odd sizes via Tailwind arbitrary values: 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5px (see sections 5–7).

**Line heights** (`LINE_HEIGHT`): tight 1.25 · normal 1.5 · relaxed 1.7 · code **1.45** (diff/terminal rows). Markdown prose 1.7 (`globals.css` `.markdown-content`), assistant answer body `leading-relaxed`.

**Spacing** (`SPACING`, 4px grid): 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.

**Radius** fallback (`RADIUS`): DEFAULT 6 · lg 8 · xl 10 · full 9999. Live values are per theme (1.3). Web classes: `rounded-md` = `--radius`, `rounded-lg` = `--radius-lg`, `rounded-xl` = `--radius-xl`. Notable fixed radii: composer card **20px** (`ChatInput.tsx` L1298), user bubble `rounded-2xl rounded-br-sm`, pills `rounded-full`.

**Motion** (`MOTION`, ms): instant 0 · fast 120 · normal 180 · slow 220. Web defaults: all interactive elements transition color/bg/border/opacity/shadow **150ms cubic-bezier(0.4,0,0.2,1)** (`globals.css` ≈L5660). `prefers-reduced-motion` collapses every animation/transition to 0.01ms.

**Breakpoints**: narrow viewport = `(max-width: 767.98px)` (`hooks/useMediaQuery.ts` L16); mobile two-pane restore width `TWO_PANE_MIN_WIDTH = 768` dp.

**Shadows**: Tailwind `shadow-sm` (cards, chips), `shadow-md` (tooltips, jump pill), `shadow-lg` (popovers, menus, toasts), `shadow-xl` (composer menu), `shadow-2xl` (dialogs, model picker, composer dropdowns). No custom shadow tokens.

**Focus ring** (`globals.css` ≈L5288): `outline: 2px solid var(--color-ring); outline-offset: 2px; border-radius: calc(var(--radius) + 2px)` on `:focus-visible`. Inputs use `focus:border-primary focus:ring-2 focus:ring-primary/20`.

**Scrollbars**: 6px, transparent track, thumb `emphasis` → `mutedForeground` on hover, `border-radius: 9999px`.

**Selection**: `primary` at 25%.

**Code**: `pre code` 13px (0.8125rem), lh 1.5, tab-size 2; inline code 0.85em, `bg subtle`, `text primary`, weight 500, radius 4px; code block bg `subtle` with 1px border.

**Markdown** (`globals.css` `.markdown-content`): 14px (0.875rem), lh 1.7; h1 22px w/ bottom border, h2 18px w/ bottom border, h3 16px, h4 14px, all weight 600; list markers coloured `primary`; blockquote 3px `primary` left border on `accent` wash; table th uppercase 12px tracking 0.05em; hr 1px `border`.

---

## 3. Component primitives (`apps/web/src/components/ui/`)

Barrel: `ui/index.ts`. Two layers — `ui/primitives/*` are vendored shadcn parts (Radix/cmdk/sonner): `alert-dialog, checkbox, command, dialog, dropdown-menu, popover, scroll-area, separator, sonner, switch, table, tabs, tooltip`. `ui/*` is the app-facing API.

| Primitive | Anatomy / variants (file:line) |
|---|---|
| **Button** (`Button.tsx` L12-37) | variants: `primary` (bg `primary-emphasis`, text `primary-foreground`, hover opacity .9), `secondary` (**default**; 1px border, transparent, hover `subtle`), `ghost` (no chrome, muted text → fg on hover), `danger` (border `danger/30`, text danger, hover `danger-muted`), `subtle` (bg subtle → emphasis). Sizes: `sm` h28 px10 12px · `md` h36 px14 14px · `lg` h44 px20 rounded-lg · `icon` 36×36 · `icon-sm` 28×28. `loading` swaps left icon for spinner. Focus: ring-2 ring-ring offset-2. |
| **Badge** (`Badge.tsx` L22-33) | `rounded-full border font-medium`; tones neutral (subtle/muted/border), primary & info (`info-muted`/primary or info), success, warning, danger (`*-muted` bg + hue text), done (`done/15`). Sizes sm `px-1.5 py-0.5 text-[10px]`, md `px-2 py-0.5 text-xs`. Optional 6px leading dot. |
| **StatusBadge** (`StatusBadge.tsx` L25-51) | canonical status pill: icon + label always. Map: created·neutral CircleDot, starting·info spinner, running·info Play, paused·warning Pause, cancelling·danger spinner, completed·success Check, failed·danger AlertCircle, partial·warning "Partly failed", cancelled·neutral X, pending·neutral Clock, queued·info Clock, skipped·neutral SkipForward, sleeping·info Moon, awaiting_input·warning Hand, active·success, archived/deleted/idle·neutral, error·danger. |
| **Card** (`Card.tsx`) | `rounded-lg border bg-card`; `interactive` adds hover `subtle` bg + primary-tinted border (`color-mix(primary 30%, border)`); `accent` = primary 20% border. |
| **Input / Textarea** (`Input.tsx` L8-16) | `rounded-md border border-input bg-background text-sm`; hover border `mix(primary 50%, border)`; focus border primary + ring primary/20; Input h36 px12; Textarea `px-3 py-2 resize-y`; `invalid` → danger border/ring. |
| **Modal** (`Modal.tsx` L22-27, L76-78) | fixed w×h boxes: sm 28×22rem, md 36×32rem, lg 48×40rem, xl 64×48rem (capped to 92–96vw / 80–88vh); `rounded-xl border bg-card shadow-2xl`, enter `animate-slide-in-up`. |
| **Dialog** (`primitives/dialog.tsx` L24-50) | overlay `bg-black/50 backdrop-blur-[2px]` z-1000 fade-in; content centred, `rounded-xl border bg-card shadow-2xl` slide-in-up; header `px-5 py-4` border-b, footer `px-5 py-3` border-t; title 16px semibold. |
| **Drawer** (`Drawer.tsx` L25-28) | left `w-[min(85vw,18rem)]` slide-in-left; right `w-[min(85vw,22rem)]`; bottom `max-h-85vh rounded-t-xl` + safe-area padding; `bg-sidebar shadow-2xl` z-1000; focus trap, Esc, backdrop close. |
| **Tabs** (`primitives/tabs.tsx` L19-42) | underline tabs: list `flex gap-1 border-b`; trigger `px-3 py-2 text-sm font-medium border-b-2 border-transparent`, active `border-primary text-primary`. |
| **Popover / DropdownMenu** (`popover.tsx` L22, `dropdown-menu.tsx` L44-60) | `z-1100 rounded-lg border bg-popover p-1 shadow-lg`, fade-in; items `rounded-md py-1.5 pl-8 pr-2 text-sm`, focus `bg-subtle`. |
| **Tooltip** (`primitives/tooltip.tsx` L23-27) | `z-1200 max-w-xs rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md`, sideOffset 6, fade-in. |
| **Command palette** (`primitives/command.tsx` L38-74) | dialog `w-[min(92vw,40rem)]`, input row with Search icon, list max-h 300px, group headings 12px muted. |
| **Switch** (`primitives/switch.tsx`) | 36×20 track, `bg-primary-emphasis` checked / `bg-emphasis` unchecked, 16px white thumb translate 16px. |
| **ToggleSwitch** | label (14px medium) + optional description (12px muted) left, Switch right. |
| **Kbd** (`Kbd.tsx` L10-56) | `rounded border bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground`; `mod` → ⌘ on mac / Ctrl elsewhere, `shift` ⇧, `alt` ⌥, `enter` ↵, `esc` Esc. |
| **Spinner** (`Spinner.tsx` L13-18) | Loader2 spin; xs 12, sm 14, md 16, lg 20px. |
| **StatCard** (`StatCard.tsx` L55-64) | label 12px uppercase tracking-wide muted; value 24px semibold tabular; 36px icon chip (tone bg). |
| **PageHeader** (`PageHeader.tsx`) | h1 20px semibold, subtitle 14px muted, actions right. |
| **EmptyState** (`EmptyState.tsx`) | centred, `py-16`; icon muted, title 14px medium, hint 12px muted max-w-sm, action mt-4. |
| **PageContainer** (`layout/PageContainer.tsx` L14-18) | default `max-w-6xl px-6 py-8` scroll; narrow `max-w-4xl`; full = flex column. |
| **EntityCard / EntityListRow / FilterTabs** (`components/data/`) | card: icon+title, 2-line description, hover-revealed actions, meta row; list row: leading chip, title/description, trailing badges, hover actions; FilterTabs = segmented pill group `rounded-lg border p-0.5`. |
| **Toast** (`Toast.tsx`, `primitives/sonner.tsx`) | sonner, **bottom-right**, `bg-popover border rounded-lg shadow-lg`; variants success/error/warning/info tint the icon; default 4s, error 8s, `duration: 0` = sticky; optional `logs` renders a mono `<pre>` block. |
| **Skeleton** (`Skeleton.tsx`) | `ChatMessageSkeleton`: two rows of 32px avatar circle + 12px label bar + 64/96px body block. Shimmer class `skeleton-shimmer` (1.8s gradient sweep). |

---

## 4. App shell & layout

`layout/AppLayout.tsx` L75-125:

```
┌ TitleBar (desktop only; drag region; product name 12px muted) ───────────────┐
├ Sidebar w-60 (240px) │ Header h-10 (40px) ──────────────────────────────────┤
│  bg-sidebar          │ [☰ when collapsed] Breadcrumb …   [ConnStatus][Archive]│[theme][pane]
│  border-r            ├────────────────────────────────────────────────────────┤
│                      │ <main> (page)                    │ RightPane (optional) │
└──────────────────────┴──────────────────────────────────┴──────────────────────┘
```

- **Sidebar** (`Sidebar.tsx`): header row h-10 with 24px primary square logo (Zap icon) + "GeneratorAI" 14px semibold + collapse button (primary-tinted, `PanelLeftClose`). Nav items: `rounded-lg px-3 py-2.5 text-sm font-medium gap-3`, 16px lucide icon; active = `bg-sidebar-accent text-sidebar-accent-foreground`. Order: Dashboard, Projects, Chats, Agents, Workflows, Scripts, Automations; bottom: Settings + "Command palette ⌘K" hint (11px). Collapse animates width 240→0 over 200ms ease-in-out and sets `inert`. Below `md` it becomes a left **Drawer** (w-60) that auto-closes on navigation.
- **Header** (`Header.tsx` L84-215): h-10, `border-b bg-background px-3`; left = breadcrumb (`Chats / <name>` + `ChatStatusBadge`: Generating·info / Processing·warning / active·success); right = `ConnectionStatus quietWhenHealthy` (pill with 6px dot: connected border/muted, reconnecting warning+pulse, disconnected danger; plus "Events may be missing since hh:mm — refresh" warning badge when gap-fill lost events, `status/ConnectionStatus.tsx` L14-30, L120-180), Archive action (chat only), theme mode cycle button (dark→light→system, Moon/Sun/Monitor), right-pane toggle (`PanelRightOpen/Close`, primary-tinted when open; shown only when a page registered a controller via `rightPaneStore`).
- **Command palette** (`CommandPalette.tsx`): ⌘K/Ctrl+K (not in editable targets; on desktop the native menu accelerator fires it instead). Groups "Navigate" (Dashboard, Projects, Chats, Workflows, Scripts, Automations, Settings) and "Actions" (New Chat/Workflow/Automation/Project). Footer shows Kbd hints ↵ Select, ↑↓ Navigate, Esc Close.
- **RightPane** (`layout/RightPane.tsx`): unified tabbed dock for chat & workflow-run pages.
  - Resizable via 6px drag handle on its left edge (`w-1.5 border-l border-r bg-border/40`, hover `primary/40`, 32px pill grip; double-click resets). Width persisted per page (`useResizablePane`: minPx **320**, maxRatio **0.75**, default ratio from caller). L569-575, L611-626.
  - Tab strip h-10 `bg-card px-1.5`: tabs `rounded-md border px-2 py-1 text-[11.5px] font-medium` with 14px icon, label truncated at 120px, per-tab close ✕ (opacity .6); active = `border-primary/40 bg-primary/10`. Overflowing tabs collapse into a "… N" menu (L716-770). "+" opens an add menu (w-56, header "ADD PANEL" 10px uppercase, item label + 10.5px description, disabled reason tooltip). Fullscreen toggle (Maximize2/Minimize2) and close ✕. Cap notice banner (warning wash, 11px) for 6s when a multi-instance tab hits its cap (L292-301, L865).
  - Every tab body stays **mounted** (absolute inset-0, hidden = `invisible pointer-events-none`) so terminals/browsers keep state; panels gate sockets on `active` (L28-40).
  - State `{tabs, active, width}` persisted in localStorage under `storageKey` (per chat/run) and `widthStorageKey` (per page). Default tab cannot be closed.
  - Narrow viewport: pane becomes a full-width sheet (`absolute inset-0 z-30 bg-card`), resize handle and fullscreen hidden; Esc closes it (L280-286, L592-604).
- **Chat page composition** (`pages/ChatPage.tsx` L1174-1420): `flex h-full` → main column (`flex-1 flex-col`) + `RightPane`. Main column: optional streaming banner (`bg-primary/5 border-b px-4 py-2`, spinner or PauseCircle + 12px primary text "Generating response..." / "Processing..." / "Paused — waiting for your input"), archived banner (amber), scroll area `px-4 py-4` with content `max-w-3xl mx-auto` (768px), "Load earlier messages" pill at top, `ChatMessageList`, optimistic user bubble, `LiveTranscript`, empty state (64px `accent` circle with Bot icon, "Start the conversation", "Type a message below to chat with <Provider>"), `ThinkingPlaceholder` when pending, "Jump to latest" floating pill (`absolute bottom-3 centre rounded-full border bg-card shadow-md text-xs` with ArrowDown), then `ChatInput` at the bottom.
- Right-pane tab kinds on the chat page (`ChatPage.tsx` L1030-1300; offered set from `platform/surfaceCapabilities.ts` L62-76): **Changes** (default, FolderGit2), Files (ListTree, multi), file (per-file, hidden from menu), **Browser** (Globe/favicon+spinner, max 5), **Terminal** (TerminalSquare, max 4), **Computer** (MonitorCog, only when computer-use is enabled), **Widget** (LayoutGrid, one tab per widget instance, max 6), **Plan** (ClipboardList), **Background Tasks** (Boxes, orchestrator chats only). Auto-open triggers: browser `session_created` with visibility `visible`, computer `session_started`/`consent_required`, first plan awaiting review, first background task, each full-page widget, `/browser` & `/terminal` slash commands.

---

## 5. Chat composer anatomy (`components/chat/ChatInput.tsx`)

Container: `bg-background px-2 sm:px-4 pt-3 pb-[max(0.75rem, safe-area-bottom)]`, inner `max-w-3xl` (L1250-1256). Held behind `ChatInputSkeleton` until the model catalog resolves (L1238-1245, L1900-1920).

Top-to-bottom, annotated:

1. **`aboveComposer` slot** → `ChatChangesTray` (section 8.4) — same width as the card.
2. **WorkspacePrepBar** (`sources/WorkspacePrepBar.tsx` L40-95): `rounded-xl` banner; preparing = `border-primary/30 bg-primary/5` with spinner + 12px status; error = `border-danger/30 bg-danger-muted` with "Workspace preparation failed." + `Retry` (RefreshCw) and `Edit sources` (Settings2) 24px buttons. Send is held while pending/preparing.
3. **Blocked-by-gate banner** (L1272-1295): `rounded-xl border-primary/30 bg-primary/5 px-3 py-2`, ClipboardList icon + 12px reason ("Waiting on your plan review…", "The agent is waiting for you to allow or deny a tool call.", "The agent is waiting for your answer.") + ghost "Cancel and send" (11px).
4. **Main input card** (L1297-1305): `rounded-[20px] border bg-card`, idle border `border/60`; focused → `border-primary ring-2 ring-primary/40`; disabled → opacity .6.
   - **ComposerMenu** (`composer/ComposerMenu.tsx`): anchored above the card (`bottom-full mb-2`), `w-[min(28rem, 100vw-2rem)] rounded-xl border bg-card shadow-xl`, animate fade+slide-from-bottom 150ms. Header 10px uppercase ("Commands & skills" for `/`, "Attach a file" for `@`). Rows: 16px icon, title 12px medium, subtitle 11px muted truncated, badge pill 9px uppercase (`tool` / `skill` / `prompt` / `command`, or worktree alias for mentions). Active row `bg-primary/12`. Max height 288px, ≤50 items, fuzzy subsequence match (`builtins.ts` `fuzzyMatch`). Keyboard: ↑/↓ cycle, Enter/Tab select, Esc close (L1116-1140).
     - Slash trigger: value starts with `/` and caret within first token (L862-872). Sources: builtins `/browser`, `/terminal` (Globe/TerminalSquare icons, wrap text into an instruction, `builtins.ts` L15-41), skills (Sparkles), prompts (ScrollText, template loaded lazily on send), computer-use skill.
     - Mention trigger: `@` preceded by start/whitespace, requires a workspace (L874-886). Selecting fetches the file and attaches it as a text `File` chip labelled with its path (L921-965).
   - **Codebase expansion panel** (L1319-1385): slides down under the card top (`border-b bg-subtle/50 p-3 rounded-t-2xl`), lists project codebases as primary-tinted chips and local folder paths as mono fields. Read-only.
   - **Attachment chip row** (L1388-1420): `px-3 pt-2.5 gap-1.5`. `ComposerChip` (L1850-1895): `rounded-md border px-2.5 py-1 text-[11px] font-medium`; normal = `border-primary/20 bg-primary/8 text-primary`; muted (browser/terminal captures) = `border bg-accent text-foreground`; icon Paperclip / Image / AtSign / Globe / TerminalSquare; label truncated 140px; ✕ remove; images show `ImageHoverPreview` (Radix tooltip w/ 420×320 max image, 250ms delay). "Attaching…" spinner chip while a mention loads.
   - **Textarea area** (`px-2.5 sm:px-4 pt-3.5 pb-1.5`, L1423-1500):
     - **Active command pill** (L1428-1446): `rounded-md bg-primary/12 border-primary/30 px-2 py-1 text-[11px] font-medium text-primary`, icon + `/name` + ✕. Backspace on empty text removes it (L1143-1148). Placeholder becomes the command's `argHint`.
     - Textarea: borderless, 14px, `leading-relaxed`, min-h 64px, max-h 200px auto-grow (L286-293), height transition 150ms. Placeholder default "What feature are you dreaming up?" / "Waiting for response..." when disabled.
     - Paste of image files → attachment (`pasted-<ts>.png`). Drag-and-drop files → attachments (L1197-1215). Both gated by the surface's `fileAttachment` capability.
   - **Bottom toolbar** (`px-2.5 pb-2 pt-0.5`, L1503-1840). Left cluster (wraps, `gap-0.5`; `ResizeObserver` collapses reasoning+context controls into a "⋯" `SlidersHorizontal` overflow menu when < **420px**, L300-312):
     1. **Attach** `+` — 28px round ghost (hidden, not disabled, when the surface has no file attachment).
     2. **ModelPicker** `variant="inline" side="top"` (`shared/ModelPicker.tsx`): trigger = provider brand icon + short model name + chevron. Popover (`rounded-xl border bg-card shadow-2xl`): 48px **provider rail** (GitHub Copilot / Claude Code icons, locked ones show a padlock) + 288px model list with search field (h-10), refresh button, rows with info-icon details popover (`DetailRow`).
     3. **Agent chip** (read-only, L1522-1532): `h-7 rounded-full bg-primary/10 px-2 text-[11px] text-primary`, Bot icon + agent name.
     4. **Agent mode picker** (L1538-1610): ghost pill `px-2 py-1 text-xs font-medium` with Zap (Interactive) or ClipboardList (Plan) + label + chevron; plan mode tints it `bg-primary/10 text-primary`. Dropdown opens **upward** (`bottom-full mb-1.5`), `w-64 rounded-lg border bg-card shadow-2xl p-1.5`, 9px uppercase heading "Agent mode", options with check + label 12px + description 10px. Options come from `AGENT_MODE_REGISTRY` (shared). Hidden on background worker chats.
     5. **Reasoning effort pill** (L1618-1660): capitalised level (low/medium/high or provider list) + chevron; dropdown `w-44` same style.
     6. **Context window pill** (L1663-1710): shows tier budget (`formatTokens`, e.g. "200K"); dropdown `w-48` with "Standard"/"Long context" + mono token counts. Only when the model has both tiers.
     7. **ContextUsageGauge** (`shared/ContextUsageGauge.tsx`): 18px SVG ring (stroke 2.5, track `border`, fill colour from `contextRingColor(pct)`), optional % label (≥lg). Click → `w-72` popover (`rounded-lg border bg-card p-3 text-[11px] shadow-2xl`): title + model, "used / limit tokens" + % coloured, **stacked bar** h-2 with `--chart-*` segments (System, Tools, MCP tools, Memory, Skills, Conversation) and an auto-compact marker line, "WHERE THE TOKENS GO" breakdown rows with 8px colour squares (nested rows reuse parent hue at reduced opacity), then Remaining / Max prompt / Max output / Messages / Input / Cache read / Cache write / Output / Cost (USD or Copilot "×" multiplier) / Duration, footer source note.
   - Right cluster (`gap-1`):
     8. **VoiceRecorder** (`VoiceRecorder.tsx`): idle = 32px round Mic ghost (red when in error). Active = pill `rounded-full border bg-card pl-2.5 pr-1 py-1` containing: "Listening…"/"Transcribing…" spinner text, or an 18-bar live waveform (bars 2.5px wide, 20px tall, `bg-primary`, scroll every 50ms ≈0.9s window), "Paused" affordance (Pause icon, 10px) with the waveform dimmed to 40%; ✕ cancel (icon-sm ghost) and ✓ accept (icon-sm primary round). Dictation writes streaming partials straight into the textarea at the caret, paced one word per 70ms; typing/pasting pauses dictation; "scratch that" retracts the previous utterance (L620-900).
     9. **Send / Stop** (L1760-1835): Send = 32px circle ArrowUp, `bg-primary text-primary-foreground` when `canSend`, else `bg-muted text-muted-foreground/50`; spinner while sending. While streaming: Stop = 32px circle `bg-primary` with filled Square; disabled for **400ms** after press ("Stopping…"), and after **15s** without the backend settling it becomes a red pill "Force reset" (`bg-danger rounded-full px-3 text-[11px] font-semibold`). Phases from `packages/client-core/src/stream/stopController.ts` L45-47, L196-210: idle/ready "Stop" → arming (disabled) → stopping "Stopping…" → force "Force reset". `useTwoPhaseStop` ticks every 200ms.
5. **Below-card row** (L1842-1868): "Codebase" / "N Codebases" toggle button (`rounded-lg border px-2.5 py-1 text-xs`, FolderGit2 + chevron; primary-tinted when any codebase is connected or the panel is open).

**Send behaviour** (L985-1080): clears text/attachments/command immediately, records to local ↑ history, formats the prompt via the command's `format(input, template)`, calls `startPending(sessionId, prompt)` (optimistic bubble + "thinking" state), awaits `onBuiltinCommand` (opens Browser/Terminal tab first), then `customSendFn({prompt, attachments, mode})`. On failure the draft is restored and the stream cleared; the server's refusal reason is toasted under "Message not sent". Pending browser/terminal captures are merged into the attachments and cleared.

**Keyboard** (L1108-1180): Enter sends (only when `keyboardShortcuts` capability is declared); Shift/Ctrl/⌘+Enter inserts newline; ↑ on the first line / ↓ on the last line walks prompt history (draft parked and restored past the newest entry; editing a recalled prompt exits history mode; attachments are re-fetched into Files; `composer/promptHistory.ts`); Esc closes menus/dropdowns.

**Data the composer reads**: `useModels`, `useHarnessConfig`, `useSlashCommands(projectId)`, `useWorkspaceFileIndex(workspaceId)`, stream store `usage` + `contextUsage` for the gauge, `workspacePrep`, `pendingInteractionLabel` and `promptHistory` from the page.

---

## 6. Transcript & message bubbles

- **List** (`chat/ChatMessageList.tsx`): `space-y-5`; every message stays in the DOM; above 40 messages each row gets `content-visibility: auto; contain-intrinsic-size: auto 160px` (no windowing — preserves find-in-page, selection, a11y). Roles: user, assistant, system, tool. Assistant turns with no text but with tool calls/cards still render.
- **UserMessage** (`UserMessage.tsx`): right-aligned, `max-w-[85%]`, bubble `rounded-2xl rounded-br-sm border border-primary/20 bg-primary/[0.08] px-3.5 py-2.5`; header row 10px uppercase tracking-wider `primary/80` "YOU" with User icon + timestamp (`toLocaleTimeString`, muted) right; body 13px `leading-relaxed` `foreground/90` pre-wrap; `AttachmentChips` below (11px chips, `border-primary/20 bg-primary/[0.07] text-primary`, images open in new tab with hover preview). The optimistic bubble (`ChatPage.tsx` L1235-1248) is identical with "just now".
- **AssistantMessage** (`AssistantMessage.tsx`): **headerless** by default (no avatar; `showHeader` adds a 32px primary circle Bot avatar + "Assistant" 14px semibold + time). Body = `StreamPanel` built from `chatMessageToBlocks(message)` → `deriveStreamView`. Below: optional "Read aloud" ghost button (feature-flagged TTS; Volume2/Square/Spinner), "Stopped before the response finished." note (11px muted, CircleSlash) when `metadata.partial`, and generated artifacts as download chips.
- **StreamingMessage** (`StreamingMessage.tsx`): same `StreamPanel` with `active` + `answerStreaming`; usage chip appears only when `status === 'complete'`; "Speak live" button while active (flagged); `ThinkingPlaceholder` when no blocks yet ("Analyzing your request…" if status `thinking`, else "Generating response…"); "Stopped before the agent responded." when cancelled before any block.
- **ThinkingPlaceholder** (`ThinkingPlaceholder.tsx`): `.thinking-orb` 14px breathing radial-gradient disc (primary→purple, 1.8s) + label 13px medium with `.text-shimmer` sweep (2.4s), then two shimmer bars 72%/46% width.
- **SystemMessage**: centred `max-w-xl`, `bg-subtle border rounded-lg px-4 py-2.5`, 20px info circle (`info/15`), 12px muted text, 10px time.
- **ToolMessage** (legacy role `tool`): `rounded-lg border bg-warning-muted`, collapsible header (Wrench chip, tool name 12px semibold, green check, time), body shows args/result.
- No per-message copy/edit/retry/fork buttons exist in the transcript; copy lives on code blocks (`MarkdownRenderer.tsx` L218-250: header bar `bg-muted px-4 py-2` with language label 11px uppercase, filename mono, Copy/Check button). Checkpoint restore lives in the Changes view, not on messages.
- Markdown answer container: `text-[13.5px] leading-relaxed message-assistant`, streaming uses `IncrementalMarkdown` (block-memoised, append-only; code highlighted off-thread by a worker) and the container gets `stream-container` (`contain: content`) with a 0.3s fade on new content.

---

## 7. Timeline row taxonomy

Pipeline: `StreamBlock[]` (from `packages/client-core/src/stream/types.ts`: thinking / text / tool_call / system / widget / plan / question / permission) → `deriveSegments` (`agent/deriveTimeline.ts` L478-560) walks blocks in order and yields `steps | answer | widget | plan | question | permission` segments → `StreamPanel` (`agent/StreamPanel.tsx` L155-260) renders them in sequence with `space-y-2.5` → each `steps` segment is a `StepsTimeline` (1px vertical connector at x=16px, `bg-border`, L349-364) whose entries are `groupSteps()` output → `StepRow` / `StepGroupRow` (`agent/StepRow.tsx`).

Row shell (`StepRow.tsx` L68-130): ghost button `w-full rounded-md px-2 py-1 gap-2`; 16px status-dot circle with `bg-background` (occludes the connector); 14px kind icon (muted; danger when failed; warning when kind warning); verb 12px medium `foreground/85` + target (`mono 11.5px foreground/70` when `mono`); right meta 11px `muted/70` + chevron (rotates 90° in 200ms when expanded). Rows enter with `animate-step-in` (180ms, 3px rise). Running rows show `.step-progress` — a 2px indeterminate bar (`primary/12` track, sliding primary gradient 1.4s) at `ml-8` (L286-290). Expanded content = `DetailPanel` (`ml-8 max-h-[260px] overflow-auto rounded-md border bg-subtle/35 px-3 py-2 text-[11.5px]`, slim 8px scrollbar).

Status dot (`StepRow.tsx` L40-58): running → 12px primary spinner; waiting → PauseCircle primary; done → CheckCircle2 success; failed → XCircle danger; pending → Circle `muted/40`; kind `warning` → TriangleAlert warning.

| Row type | Visual treatment | Interactions | Data source / derivation |
|---|---|---|---|
| **Thinking** (`kind: think`, Brain) | "Thinking about …" (live) / "Thought about …" (settled) + first 60 chars; dot spinner while live | Expand → full thinking text in DetailPanel | `ThinkingBlock` (`deriveTimeline.ts` L279-296); empty heartbeat blocks skipped |
| **Tool call – read / search / edit / run / tool / memory** | verb = humanised tool name (`mcp__srv__tool` → `tool`), target = basename of `file_path/path/uri/url` or shortened `pattern/query/command/description` (≤80 chars, long paths collapsed to `…\name`), meta = `lines a–b` / `N matches` | Expand → "Args:\n…\n\nResult:\n…" pretty JSON (lazy thunk) | `ToolCallBlock`; kind from tool-name substrings (`inferKind` L84-94); status: complete→done/failed (`toolCallFailed` = `error` flag or `{ok:false,error}` envelope), else waiting (gate open) / running (turn live) / pending (settled but unresolved) |
| **File-op row** (edit kind with `fileOp`) | meta = mono `+N` success / `−N` danger; FileDiff icon action | Expand → **InlineDiff** first (`chat/InlineDiff.tsx`: mono 11px table, add rows `success/10`, del rows `danger/10`, gutter line numbers, `@@` hunk headers, max-h 320px, "Diff shortened for the transcript. Open full diff" footer), then "Show raw tool call" toggle; FileDiff icon opens Changes tab focused on that file | `fileOp {kind, filePath, additions, deletions, hunks?}`; hunks resolved via `resolveInlineHunks` (provider hunks or rebuilt from args) |
| **Shell command row** (`isShell` = bash/powershell/shell) | run kind (Play icon); SquareTerminal icon action | Icon opens the Terminal tab's **AgentConsole** at this callId | `isShellTool` L142-144 |
| **Browser-tool row with screenshot** | meta gains an Image icon | Hover → `ImageHoverPreview` of the PNG (caption "Screenshot · name", side left); click opens in new tab | `screenshotOf(result)` reads `artifactPath` ending in png/jpg/webp; URL `/api/workspaces/:id/browser/files/…` (`streamActions.ts` L23-27) |
| **Grouped row** (`StepGroupRow`, L340-440) | ≥2 consecutive steps of the same groupable kind (read/search/edit/run/tool/memory) fold to one row: label "Read 5 files" / "Searched 3 times" / "Edited N files" / "Ran N commands" / "navigate_page ×3" (same-verb MCP) or live "Reading files (3)"; sub-line = up to 4 distinct targets newest-first "+N more"; meta: "N failed" danger, aggregate `+/−` for edits, Layers pill with count, summed duration | Expand → children rendered as nested `StepRow`s inside a `ml-4 border-l` rail | `agent/groupSteps.ts` (`MIN_GROUP = 2`, `GROUPABLE` set, `LABELS`) |
| **Subagent / Agent call** (`kind: subagent`, Bot) | (a) legacy: one "Explore <name>" composite row from system `subagent` messages with `note` children ("Sub-agent started/completed/failed: …"); (b) SDK nesting: any tool block whose `parentCallId` names an earlier `Agent` call is a **child** of that step (never grouped) | Expand → children as nested rows (`ml-6`, `py-0.5`) | `deriveTimeline.ts` L370-405 (system), L344-350 (`parentCallId` map) |
| **Warning** (`kind: warning`) | TriangleAlert in warning colour in both dot and icon; verb "Warning" in warning colour; status done | none | `SystemBlock category 'warning'` (MCP failed to start, missing credential) L407-420 |
| **Error** (`kind: error`, AlertCircle) | verb "Error", failed status (red X) | none | `SystemBlock category 'error'` L421-432 |
| **Waiting-for-you** (any tool row while a gate is open) | dot = PauseCircle primary; meta text "Waiting for you" in primary | — | `awaitsUserDecision(blocks)` L232-240 |
| **Failure flag** on a plain tool row | meta "Failed" in danger + red XCircle dot | expand shows result | `toolCallFailed` |
| **Answer segment** | markdown prose 13.5px; while streaming the *last* answer segment gets `stream-container` + `aria-busy` | — | consecutive `TextBlock`s concatenated |
| **Streaming indicator** | three 7px gradient dots (primary→purple), bounce 1.3s staggered 160ms, glow shadow; always at the tail; suppressed while a gate awaits the user | — | `StreamPanel` L228 |
| **Loading skeleton** | three `skeleton-shimmer` bars 92/78/54% when tokens are expected and no answer yet | — | `loading && !hasAnswerSeg` |
| **Plan card** (segment) | see §12 | Open / Approve / Request changes | `PlanBlock` |
| **Question card** (segment) | see §12 | answer / submit | `QuestionBlock` |
| **Permission card** (segment) | see §12 | Allow / Deny (+ reason) | `PermissionBlock` |
| **Inline widget** (segment) | `WidgetFrame` sandboxed iframe (min 160px, grows via ResizeObserver, `sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"`, dedicated loopback origin) | interactive | `WidgetBlock surface 'inline'` |
| **Error box** | `rounded-md border-danger/30 bg-danger/[0.06] px-3 py-2`, TriangleAlert + mono 11px pre | — | `stream.error` |
| **Usage footer** (`UsageChip`) | inline pill `rounded-md border/60 bg-subtle/50 px-2.5 py-1 text-[10.5px] muted`: model (semibold) · ↑ input · ⚡ Nk cached (primary/70) · ↓ output · duration s · $cost · optional warning pill "⚠ ~$0.0031 cache miss" / "Nk tokens uncached" (tooltip explains idle >5 min vs model changed) | hover titles | `StreamUsage`; cache-miss logic `agent/UsageChip.tsx` (1024-token noise floor, 5-min TTL, sticky per (session, provider) ledger in localStorage) |
| **Context gauge** | lives in the composer toolbar, not the transcript (§5.7) | click popover | `stream.contextUsage` + `stream.usage` |
| **Checkpoint markers** | none in the transcript; checkpoints are a panel in the Changes view (§8.3) | — | — |
| **Background agents** | not timeline rows; a right-pane panel (§13) | — | — |

Persisted history replays through the identical pipeline: `agent/chatMessageToBlocks.ts` rebuilds blocks from `metadata.thinkingText`, `textSegments`, `toolCalls`, `planCards`, `questionCards`, `permissionCards`, ordered by the server `sequence` ordinal; tool statuses are coerced to `complete`, and cards persisted as pending/awaiting become `expired` (never actionable from history).

---

## 8. Changes view (`components/diff/`)

### 8.1 ChangesSurface (`ChangesSurface.tsx`, 1480 lines)
Summary-first: file list from `GET /changes`, file bodies on expand, rows virtualised by `@pierre/diffs` `CodeView` with worker highlighting.

- **Toolbar** (L933-1100): FileDiff icon + "N files changed" 12px + mono `+A −D` (emerald/rose); **base-revision Select** ("Compare against": *Since session start* (baseline), *Branch base (<ref>)* per mount, and one entry per turn checkpoint "label · hh:mm:ss"); right cluster of 24px icon buttons: toggle file tree (ListTree), expand/collapse all, **View settings** popover (Settings2: Unified / Split radio; split note when narrow), **Checkpoints & rewind** (History, toggles side panel), Refresh.
- **Mount groups strip** (L1108-1140): per-mount chips with alias, branch (GitBranch 10px), file count and `+/−`.
- **Review send preview** (L1190-1205): "This will be sent to the agent:" + mono pre block.
- **Source-control row** (L1211-1290): `Commit` (GitCommit) and `Create PR` (GitPullRequest) buttons; "Committed" success note; PR form (title Input h-7, description Textarea, submit); existing PRs listed as `#N title` links with ExternalLink.
- **File row** (L716-900): group row with hover `primary/10` wash and 2px left primary bar when selected; chevron 16px; `FileTypeIcon` 14px; mono path with `alias/` prefix muted and `old → new` for renames (strikethrough old); comment-count pill (`bg-primary/15 text-primary 9px`); `binary` / `too large` labels; mono `+A −D`; status badge letter A/M/D/R (`STATUS_STYLE` L122-146, colours matched to diff rows); hover-revealed **Undo2 "Discard this file's changes (undoable)"** → inline confirm ("Confirm discard" amber pill / Cancel). Discard = restore the base checkpoint for that path (server writes a `pre_restore` checkpoint first).
- **Diff body**: `DiffCodeView` (`DiffCodeView.tsx`): `viewMode 'unified' | 'split'`, `wrapLines`, line selection → review composer; theme via `diffTheme.ts` (`--diffs-font-size 12px`, line-height 1.55, tab 2, gaps 8/6px; Shiki themes `pierre-dark`/`pierre-light`; panel bg/fg pinned to app tokens, red/green left to the library).
- **Tree** (`ChangesTree.tsx`): `@pierre/trees` `FileTree` façade, virtualised, git-status lane only colours the A/M/D marker (never filename/icon), status colours passed via `--trees-git-*-color-override`.
- **Review** (`review/*`): gutter "+" on selection → `ReviewComposerPopover` floating card (340px, anchored at the pointer, Radix Popover, non-modal): intent pills Fix / Question / Refactor / Test / Note, textarea "What should the agent change here? (⌘↵ to add)", Add / "Add & send". Threads render inline under the line (`ReviewThreadCard`, collapsed GitHub-style; status pills Draft·muted, Pending·amber, Sent to agent·sky, Addressed/Resolved·emerald, Outdated·muted; reply, edit (⌘↵ save), resolve, delete). `ReviewBatchBar`: "N pending · Send all to agent" with optional note textarea, Preview, Discard all. `ReviewCommentsPopover`: toolbar count badge → list of every thread with jump/send/delete and "Send all to chat".

### 8.2 FilesSurface (`FilesSurface.tsx`)
Read-only workspace browser (not a diff): header with tree toggle, breadcrumb (file icon + path), Source select ("All sources (N)" / per mount), Preview/Code segmented toggle for markdown, wrap toggle, refresh; 240px tree column + code preview (line numbers, highlighting). "Double-click to open it in its own tab." Files-tab leads with a Sources block linking to "Edit sources…" when the host provides `onEditSources`.

### 8.3 CheckpointTimeline (`CheckpointTimeline.tsx` L125-270)
Side panel `border-l bg-card text-xs`: header History icon "Checkpoints" + close; list of grouped checkpoints (`rounded border p-2 hover:bg-accent/40`): label, kind pill 9px, mono time, 2-line prompt excerpt (review XML humanised to "Review: …"), mount aliases (Layers icon + mono pills), `+A −D`, actions **"Use as the diff base"** and **Rewind** (RotateCcw) → amber confirm box ("Rewind N sources") → per-mount report (restored/skipped counts, undo link since a `pre_restore` checkpoint was written).

### 8.4 ChatChangesTray (`chat/ChatChangesTray.tsx` L268-380)
Docked above the composer: `rounded-xl border/70 bg-card/80 shadow-sm backdrop-blur-sm`. Collapsed row (h-8): chevron, FileDiff icon with a 6px breathing primary dot while files are still changing, "N files changed **in this chat**" 12px, mono `+A −D`, "updating…" while live, and a `subtle` "Review changes" button (h-7, 11.5px). Expanded (persisted `generatorai:chat:changesTray:open`): ≤224px scroll tree — directory rows (11px, folder icon, single-child chains collapsed `src/lib`), file rows h-6 with file icon, mono name, 16px status square (A success / M warning / D danger / R info), `+/−`; click opens the Changes tab focused on that file. Data = workspace summary (baseline→working) overlaid with live `fileOp`s from the stream; refetches 1.5s after each live op and when the turn settles.

---

## 9. Terminal (`components/terminal/TerminalPanel.tsx`)

- xterm.js + `FitAddon` + `WebglAddon` (falls back if WebGL is unavailable), font `JetBrainsMono, "Fira Code", Menlo, monospace` **12px** (L233-234), theme from `resolveTerminalPalette(theme, appearance)` re-applied live on theme change (L216-219, L495-503).
- Transport: WebSocket to the server PTY; binary frames → `term.write` with ACK every ~64KB; JSON control frames `resize / ready / exit`; client sends `input / resize / ack`. Server session id persisted per RightPane `tabId` in localStorage so reload re-attaches. Max **4** terminal tabs (WebGL context budget, `ChatPage.tsx` L1112-1118).
- **Header** (L645-740, h≈28): TerminalIcon, mono cwd (10.5px muted, ≤240px), shell/pid/host pill (`bg-subtle mono 10px`), "⚡ agent" pill (`bg-primary/10 text-primary 10px`) while the agent streams, spacer, then 24px icon buttons: **Attach selection** (Send; enabled when text is selected → `.txt` File to the composer as a muted "terminal" chip), **Find** (Search, Ctrl/⌘+F → inline widget top-right `bg-card/95 shadow-lg backdrop-blur` with input, ↑ prev (Shift+Enter), ↓ next (Enter), ✕ (Esc)), **Clear scrollback** (Eraser), **Kill** (Trash2, danger hover). Optional worktree `cd` dropdown (FolderGit2) on run pages.
- Banners: sandbox tint (`done`-purple wash, "sandbox") and fallback-child-process warning (`warning-muted`).
- Overlays: "Starting terminal…" spinner scrim; error scrim (danger); "Process exited — code N. Close the tab to restart." bottom-left warning pill; transient hints top-centre (warning/success) for 2.5s.
- **AgentConsole** (`chat/AgentConsole.tsx`): replaces the interactive shell inside the Terminal tab when opened from a shell row. Header "Agent commands · N run in this chat" + "← Back to shell"; explanatory line; list of mono 11.5px cards (`rounded-md border bg-card/50`; selected = `border-primary/60 ring-1 ring-primary/30`): status (spinner / green dot / red X), `$ command`, description, then output `<pre>` (max-h 288px, truncated at 20k chars) or "Running — output arrives when the command finishes…".

---

## 10. Browser (`components/chat/BrowserPanel.tsx`, `NativeBrowserView.tsx`, `browser/BrowserVisibilityPicker.tsx`)

- Two render modes: **native** (Electron `WebContentsView` positioned over a placeholder div; 1s screenshot polled as background image for seamless tab switches; hidden when any overlay/portal intersects) and **screencast** (web: `<canvas>` painted from a WebSocket JPEG/frame stream at `/browser/screencast`, HTTP polling fallback `screencast.jpg?quality=45` when degraded). Only the *visible* tab holds a socket. Max **5** browser tabs; each RightPane tab is its own isolated page (title/favicon/spinner surfaced in the tab strip via `BrowserTabIcon`).
- **Top bar** (L1567-1605): `flex gap-1.5 border-b bg-card px-2 py-1.5`: Back / Forward / Reload (icon-sm ghost) → URL field (`rounded-full bg-background px-3 py-1 text-xs`, placeholder "Search or enter address") → right cluster: **Share/attach to chat** toggle (Share2 / Link2Off; disabled while the agent is busy: "Cannot detach while agent is streaming"), **Comment/Inspect** (MousePointerClick; click elements to leave notes; Comments count badge popover listing notes with send/delete and "Send all to chat"), **Capture region** (Crop; drag a rectangle on the canvas → server crops PNG → composer chip), **Device toolbar** (Smartphone: preset select, width/height inputs, rotate, DPR, mobile UA checkbox, zoom), **More** (MoreVertical: DevTools etc.), **Start/Stop** (Play/Square).
- Web-only interactivity switch (`generatorai:browser:webInteractivity`, default OFF): when off, nav controls are hidden and the URL is read-only; scrolling and Inspect still work.
- Status header when not embedded: 8px dot (active success / starting warning pulse / error danger / off muted) + "Integrated Browser · status" + stream-state pill (reconnecting… warning / degraded (polling) danger / connecting… muted).
- Canvas cursor: crosshair in capture mode, copy in inspector, pointer when fully interactive; capture rectangle overlay drawn absolutely.
- **BrowserVisibilityPicker** (New-Chat dialog + workflow editor): radios Headless (EyeOff, "Runs invisibly. Fast, safe, recommended default."), Visible, Off; switch for `run_playwright_code`; allowed-hosts CSV.

---

## 11. Computer use (`components/chat/ComputerPanel.tsx`)

- Header: MonitorCog + window title (or "Computer Use") 12px medium; right: "grants" key-icon toggle.
- Mode segmented control `rounded border p-0.5`: **Now** (Image icon; the PNG of the *target window* captured each time the agent read it — never the whole screen) / **Replay** (Video icon; per-turn frame sequence with play/pause, scrubber `accent-primary`, "Turn N — tool" caption; or ffmpeg fragmented-MP4 with markers when the operator opted into screen video). Recording toggle (Circle/Square) + "also record screen video" (Video) button with a warning tooltip about the lock screen.
- Info strips (11px, `bg-subtle/50` or `warning/10`): live-preview note, runtime status with action button, grants list (app identity, scope, revoke).
- **Consent card** (L906-972): `border-b border-warning/40 bg-warning/10 p-3`, ShieldQuestion; "Allow **<action>** on **<app>**?" + summary + warning line when the action takes over keyboard/mouse (`synthetic`/`clipboard` tiers); buttons **Allow once** (primary), **Allow all this run** (primary outline), **Always allow** (only for non-takeover tiers), **Deny**. Expires automatically at `expiresAt`. The Computer tab auto-opens on `computer.consent_required` (`ChatPage.tsx` L806-832).
- Live view (`bg-subtle/40`): window frame `object-contain` with a cursor overlay positioned via window bounds; timeline entries (action Hand, snapshot Eye, keyboard takeover Keyboard warning, refusal Ban destructive, consent ShieldQuestion warning).
- Feature-gated: tab only offered when `computerUseEnabled` and the surface declares `computerPanelRendering`.

---

## 12. Plan mode (PLN-01)

- **Mode selection**: composer Agent-mode picker (§5.4) — Interactive vs Plan; persisted per chat as `defaultAgentMode` and sent per turn as `mode`. Plan mode tints the pill `bg-primary/10 text-primary` with ClipboardList.
- **PlanCard** (`chat/PlanCard.tsx`): in-transcript segment. Header button: 32px `rounded-lg bg-primary/10` FileText tile, title 14px medium, status pill with icon (`STATUS_META` L30-70: Drafting spinner·muted, Recorded·muted, **Needs review**·primary, Changes requested·amber, Approved·emerald, Discarded/Superseded·muted CircleSlash, Expired·muted AlertTriangle), meta line 11px (mono file name · "Revision N"), 2-line summary. Clicking opens the Plan tab. Action row (only `awaiting_review`, `border-t p-2`): ghost "Open" text button, split primary **"Approve & implement"** with chevron → "Approve & run autonomously" (autopilot, only when `actions` includes it), outline **"Request changes"** → inline textarea ("Be specific — this goes straight to the agent.") + Cancel / Send. Decisions are applied optimistically to the store then POSTed; stale gates are reconciled against `usePendingInteractions` polling (`ChatPage.tsx` L560-600).
- **QuestionCard** (`chat/QuestionCard.tsx`): header 24px `primary/10` HelpCircle tile + title; multi-question pager (‹ N/M ›); each question = fieldset with 10px uppercase pill (question id/label) + 12px prompt; options as radio/checkbox (`accent-primary`) with label 12px medium + 11px description + optional preview; host-added **"Other…"** free-text option; footer: ghost "Leave it to the agent" (freeform skip), Next › / primary **"Submit answers"** (Send icon). Answered state shows chosen answers in `bg-muted/30` blocks + emerald check line; expired shows muted note.
- **PermissionCard** (`chat/PermissionCard.tsx`): header 24px warning-tinted ShieldAlert tile + status label; body: permission-type pill 10px uppercase + mono tool name, description 12px, `inputSummary` mono pre (max-h 160px); actions **Deny** (outline danger → reveals optional reason input + Cancel / red "Deny" confirm) and **Allow** (primary, ShieldCheck). Settled state pill Allowed (check) / Denied (ShieldX) with message.
- **PlanDocumentPanel** (`chat/PlanDocumentPanel.tsx`, right-pane Plan tab): header with title 14px semibold + mono file name, **Edit** (Pencil) and **Save to workspace** (Download); revision chips `v1 v2 …` (History icon; older revision shows amber "Viewing an older revision" note); body = `MarkdownRenderer` 13px; text selection → inline comment box (`border-primary/40 bg-primary/[0.04]`, quoted excerpt, "What should change here?", Add comment); comments list with `vN` tags; edit mode = mono textarea + "Save as vN+1"; decision footer (only actionable + current revision): follow-up textarea, primary **"Approve & implement"**, outline **"Request changes"**, icon **Discard plan** (CircleSlash, "Exit plan mode without implementing"). Empty state: "No plan yet — switch the composer to Plan mode…".
- **Composer gating**: while a plan review / question / permission gate is open the composer is disabled with the banner in §5.3; the streaming banner reads "Paused — waiting for your input" and all generating cues stand down (`awaitsUserDecision`).

---

## 13. Orchestrator & background agents

- Enabled per chat at creation (`CreateChatDialog.tsx` L348-360 "Orchestrate mode" checkbox; auto-on when the bound agent's role is `orchestrator`). Orchestrator chats get the **Background Tasks** right-pane tab (Boxes icon), auto-opened when the first task appears (`ChatPage.tsx` L385-400).
- **BackgroundTasksPanel** (`chat/BackgroundTasksPanel.tsx`): header "Background Tasks · N tasks"; rows (`divide-y`, `px-3 py-2`, hover `muted/40`): task name 12px medium + `StatusChip` (`rounded-full px-2 py-0.5 text-[10px]`: Running spinner blue, Needs review Eye amber, Completed check green, Failed X red, Cancelled Ban grey, Starting Clock grey), model mono pill, "· N reviews"; actions: **Open worker chat** (ExternalLink → `/chats/<taskId>`, a real chat with its own stream) and **Cancel** (Ban, red hover) while running. Expanding a row loads the worker's **digest**: Summary, Key findings (bullets), Artifacts (mono paths), Risks (amber heading), Open questions.
- Worker chats hide the agent-mode picker (`showAgentModePicker={!chat.parentChatId}`).
- In-transcript SDK subagents render as nested rows under the `Agent` tool call (§7).

---

## 14. Widgets, artifacts, extensions

- `widgets/WidgetFrame.tsx`: sandboxed iframe from a dedicated loopback origin (port-isolated), `WidgetBridge` maps postMessage ↔ REST; status `active | closed | error`; refuses to mount when the widget origin equals the host origin (sandbox-escape guard). Inline surface = in transcript; `widget` surface = its own RightPane tab titled by the widget (`WidgetHost` picker when unbound).
- `artifacts/ArtifactBrowser.tsx`, `ArtifactPicker.tsx`: config-artifact (skills/prompts/agents) browsing used by Settings and the composer slash-command sources.
- Extensions settings section lists installed system extensions (Document Studio, Web Designer, etc.).

---

## 15. Dashboard (`pages/DashboardPage.tsx`, `components/dashboard/`)

- `PageContainer` with `animate-fade-in`; `PageHeader` leading 40px primary square with Radar icon, title **"Mission Control"**, subtitle "<Good morning> — here's what's running across your agents"; actions: `SystemStatusPill` (Disconnected·danger / "N running"·info + breathing dot / "All systems idle"·neutral; hidden < sm), "New Chat" (MessageSquare), "New Workflow" (GitBranch).
- Stat row `grid 1/2/4 cols gap-4`: `StatCard` Chats, Workflows, Automations (20px icons) + `HealthStatCard` (live connection Connected/Degraded/Disconnected with breathing dot and uptime; click → Settings › Diagnostics).
- Below: `ActivityPanel` — single list with tabs **Today** (top 20 newest), **Running**, **Needs attention** (failed + waiting on a human); rows = kind badge (chat/run/automation), title link, `StatusBadge`, inline secondary actions Cancel / Stop / Restart. `SystemHealthCard` — "System Health" with connection status and `HealthRow`s (Uptime, Agent provider, Database, Active chats, Active runs, Running chats) polled from `/api/health` with "synced Xs ago" ticker.

---

## 16. Workflows

### 16.1 List (`pages/WorkflowListPage.tsx`, `workflow/WorkflowCard.tsx`)
`PageHeader` + search + tag filter + grid/list toggle; virtualised grid (`sm:2 lg:3 xl:4` columns) of `WorkflowCard` (Card: GitBranch primary icon, title 14px semibold, 2-line description, tag badges, hover actions Edit / Run (success hover) / Delete (danger hover), selection checkbox) or `WorkflowListRow`; bulk select/delete; template import CTA.

### 16.2 Builder (`pages/WorkflowBuilderPage.tsx`, `workflow/DAGCanvas.tsx`, `StageNode.tsx`, `StageEdge.tsx`, `StagePropertiesPanel.tsx`)
- Header (L608-731): ← Back, editable name (borderless 14px semibold, underline on focus), "(unsaved)" / "Saved" (success check, 3s) / "Workflow is valid" / error text; right: Undo (Ctrl+Z) / Redo (Ctrl+Shift+Z), Workflow settings (Settings2 → `WorkflowConfigPanel` xl Modal with tabs General / Variables / Project codebases / Tags & metadata / Hooks), **Validate** (AlertTriangle), properties panel toggle (PanelRight), **Save** (Ctrl/⌘+S, L538-548), **Run** (primary, Play; opens `VariableInputModal` for variables, file uploads for prompts/skills/agents, per-stage skip/overrides). Validation error banner in `warning-muted`.
- **Canvas**: React Flow with `Background` dots gap 20 size 1 colour `--color-border` on `--canvas-bg`, `snapGrid [20,20]`, `fitView padding 0.18 maxZoom 1.3` (animated 300–400ms), `Controls` and `MiniMap` themed via `--xy-*` vars (`globals.css` ≈L5590), connection line `primary` 2px, Backspace/Delete removes selection (handled in `DAGCanvas.tsx` L117), panels: top-left legend of edge types, top-right ghost actions, bottom-centre "Add new stage" (+), top-centre validation chips.
- **StageNode** (L55-170): `min-w-[240px] max-w-[320px] rounded-lg border-2 px-4 py-3.5 shadow-sm`, 200ms ease-out; selected = `border-primary ring-2 ring-primary/25`; hover border `primary/60`; left/right `Handle`s glow on hover; icon chip (`primary/10` Box or runtime status icon), name 14px semibold, template/type line; runtime status colours (pending grey, queued blue, running yellow pulse, paused orange, completed green, failed red, cancelled grey, skipped grey).
- **StageEdge** (bezier, `strokeWidth 2 / 3 selected`): colour by edge type from `edgeTypeStyles.ts` — on_success `success`, on_failure `danger`, on_completion `info`, always `done`(purple); mid-edge label pill `rounded-full px-2 py-0.5 text-[11px] font-semibold text-white` with icon (Check / X / Flag / Repeat) + label + chevron → type menu; hover reveals red ✕ delete.
- **StagePropertiesPanel** (right sidebar, resizable via `useResizable`): header with stage name + close; two tabs *Properties* / *Execution*. Properties = `CollapsibleSection`s: Basic (name, description), Model & Template (`StyledSelect` template, `ModelPicker` field, reasoning), Prompts & Context (sub-tabs pill group: prompt type; `PromptEditor` / `PromptFilePicker`), Skills (`SkillSelector`), MCP Servers (`McpServerSelector`), Variables. Execution = Execution (condition expression input e.g. `status == 'completed' AND variables.env == 'prod'`, `NumberStepper` Timeout, permission mode select, **Approval required** `ToggleSwitch`), Retry Policy (toggle + Max retries / Backoff ms / Multiplier steppers), Result Validation (rules: contains / regex / length / command with failure message; badge count), Hooks (command / webhook / handler with args JSON).
- Store: `stores/workflowBuilderStore.ts` — nodes/edges, selection, `isDirty`, `validationErrors`, undo/redo history stack with `pushHistory(coalesceKey)` (coalesces keystrokes), `validate()`.

### 16.3 Run page (`pages/WorkflowRunPageV2.tsx`, `workflow/redesign/*`)
- **RunHeaderBar** (54px, `border-b bg-card px-4 py-2.5`): status pill (Pending·muted Clock, Running·spinner, Paused·warning, Cancelling, Cancelled, Completed·success, Failed·danger), run name 14px semibold, "done/total · N failed" + 112px progress bar (`h-1.5`, primary, width transition 500ms) + mono elapsed; "⚡ N parallel" cyan pill; "✋ N awaiting" warning pill (breathing); controls **Pause** (outline) / **Resume** (primary) / **Cancel** / **Retry** (creates a new run and navigates to it); graph toggle.
- Optional **PipelineFlow** strip (320px tall RuntimeDAGCanvas or horizontal chain): stage pills with status icon (spin/breathe), duration, parallel groups in a cyan outline.
- **Stage timeline** (`StageTimelineItem.tsx`): vertical rail (2px `border`) with 24px status dots ringed by `background` (Completed success Check, Running primary spinner, Queued primary/40, Pending muted, Paused warning, Awaiting input warning Hand breathing, Sleeping indigo Moon, Failed danger, Cancelled/Skipped muted); header row = order 10.5px mono, name, status pill, "⚡" parallel pill, `stepsDone/total`, files count, duration, Retry (failed), "…" menu; expanded body (`pl-[34px]`): right-aligned stage prompt bubble (same style as the chat user bubble, 12.5px), Sleeping card (indigo, countdown, "Wake now"), the shared `StreamPanel` (identical timeline/answer rendering to chat), chips row (Files, Output cyan, Details → opens Inspector, `UsageChip`), and `InlineHitlControls` when `awaiting_input` (textarea "Optional feedback — required to request changes…", **Approve & continue**, **Request changes** (requires feedback; loops), **Reject** (terminal, confirmed)).
- Right pane tabs: Changes (default; base pre-selected to `stage:<id>`), Files/file, **Inspector** (`RightInspector.tsx`: tabs Files (A/M/D/R chips) · Output · Hooks · Tools with count pills), Browser, Terminal (with worktree `cd` menu), Widget (per focused stage).
- Timeline overlay Drawer (`RunTimeline.tsx`): vertical event list (run/stage created/running/completed…) with status icons.
- Store: `stores/workflowRunStore.ts` (run, stage↔session map, selected stage, timeline events, elapsed timer, awaiting-input stages).

---

## 17. Automations (`pages/AutomationsPage.tsx`, `AutomationDetailPage.tsx`, `CreateAutomationPage.tsx`, `components/automation/`)

- List: `PageHeader` "Automations — Schedule, trigger, and loop workflows automatically", `EmptyState`, rows/cards with trigger `Badge` (Manual Hand / Schedule Clock / Webhook icons, tone per type), enable/disable, Run, delete confirm.
- Create (narrow page): sections **Basic Info**, **Trigger** (three selectable cards: Manual "Trigger by clicking Run", Schedule "Run on a cron schedule" with cron input default `0 9 * * *`, Webhook "Trigger via HTTP POST"), workflow selection, input mode (single vs schema-driven batch with data format/source), retry policy (toggle + max attempts), then Create. Webhook automations show a **one-time credentials dialog** (`WebhookCredentialsDialog.tsx`: Webhook URL / token / HMAC secret copy fields, "Shown once…").
- Detail: `PageHeader` with `StatusBadge`, description; actions **Run now** (opens `TriggerAutomationModal` for schema-driven automations: paste/upload dataset, preview iterations, save as default), Enable/Disable, Delete, rotate webhook; "Trigger" info block; execution history list with `StatusBadge`, cancel for running executions, live execution stream (`useAutomationExecutionStream`).

---

## 18. Settings patterns (`components/settings/`)

- **SettingsModal** (`SettingsModal.tsx` L88-170): Dialog `h-[min(96dvh,54rem)] w-[calc(100vw-1rem)] sm:w-[min(98vw,78rem)]`, no default close; header h-14 `bg-card` with 28px `primary/10` Settings2 tile + "Settings" + ✕; **left nav** w-60 `bg-subtle/40 border-r` grouped with 12px bold uppercase headings — *Workspace*: General, Appearance; *Agent*: Model Providers, Agents, Skills, MCP Servers, Templates; *Integrations*: Source Control, Browser & Terminal, Computer Use, Audio, Extensions; *System*: Security & Devices, Storage, Diagnostics (icons Settings2, Palette, Cpu, Bot, Sparkles, Server, LayoutTemplate, GitPullRequest, SquareTerminal, MonitorCog, Mic, Blocks, ShieldCheck, HardDrive, HeartPulse). Below `sm` the nav becomes a native `<select>` with optgroups. Content column `max-w-3xl px-8 py-6`.
- **Section anatomy** (`shared.tsx`): `SectionHeader` (16px semibold + 14px muted description, mb-5); `SettingsCard` (`rounded-lg border bg-card`, optional header `px-4 py-3 border-b` with 14px medium title + 12px description + action, body `p-4`); `SettingRow` (label 14px medium + 12px description left, control right, `py-2`); `SectionListHeader`; `InfoRow` (muted label / tabular value with success·danger·warning·muted tone); `StatusPip` (check/x/minus + text); `CatalogAccordionRow` (left chevron rotating 90°, 32px icon tile `border bg-subtle`, title + badge + subtitle, right control usually a Switch, expanded body `bg-subtle/30`; expanded border `primary/40`) used by Skills / MCP / Providers.
- **Appearance** (`sections/Appearance.tsx`): Mode radios (System/Light/Dark with Monitor/Sun/Moon), Theme radiogroup grouped Product / Editor / Low glare with swatch triples `[background, emphasis, accent]` (`themeSwatch`), Accent radiogroup of six colour dots (uses the swatch of the *resolved* appearance), live Preview card.
- Sections list: Agents, Appearance, Audio (STT/TTS), BrowserTerminal (web interactivity switch), Catalogs, ComputerUse, Diagnostics, Extensions, General (default model via `ModelPicker field allowEmpty`), Providers, Security, SourceControl, WorkspaceRetention.
- Open from sidebar gear, ⌘K, or `openSettings(section)` (`stores/settingsUiStore.ts`).

---

## 19. Motion & keyboard shortcuts

**No framer-motion**; all motion is CSS keyframes in `globals.css` (≈L5374-5590) plus Tailwind `animate-in` utilities in a few dropdowns (`fade-in-0 zoom-in-95 duration-150`).

| Name | Spec | Used by |
|---|---|---|
| `fade-in` | opacity 150ms ease-out | dialogs (`animate-dialog-in`), popovers, tooltips, page containers |
| `slide-in-up` | 6px rise + fade 150ms | Modal/Dialog content, bottom Drawer |
| `slide-in-left/right` | 12px slide + fade 200ms | Drawers |
| `block-in` | 8px rise + fade 250ms cubic-bezier(0.22,1,0.36,1) | ThinkingPlaceholder, expanded stage content (`stage-content-enter` 200ms) |
| `step-in` | 3px rise + fade **180ms** cubic-bezier(0.22,1,0.36,1) | every timeline row |
| `step-progress-slide` | 33%-wide gradient sweep 1.4s | running tool row bar |
| `stream-dot-bounce` | 7px dots, −4px bounce, 1.3s, delays 0/160/320ms | streaming indicator |
| `stream-fade-in` | 0.4→1 opacity 300ms | new streamed markdown |
| `caret-pulse` | 1s | `.streaming-caret` (legacy) |
| `text-shimmer` | gradient sweep across text 2.4s linear | "Thinking…" labels |
| `orb-breathe` | scale .92↔1.06, 1.8s | thinking orb |
| `skeleton-shimmer` | 1.8s gradient sweep (`shimmer` 1.5s variant) | skeletons |
| `dot-pulse` | scale .6↔1, 1.4s, 200ms stagger | misc loading dots |
| `tool-spin` | 1.2s rotate | tool spinners |
| `thinking-glow` | purple glow 2s | (legacy thinking) |
| `status-breathe` | opacity .7↔1 scale 1↔1.2, 2s | live dots (changes tray, awaiting-input hand, status pills) |
| `stage-pulse` | primary box-shadow ring 2s | running stage nodes |
| `edge-flow` | dash offset 1s linear | active DAG edges |
| `blink` | 0.8s step-end | text caret |

Interaction transitions: 150ms colour/opacity on all controls; sidebar width 200ms; composer height 150ms; chevrons rotate 200ms; progress bar width 500ms; active `scale(0.93)` on round send/stop/mic buttons; hover-revealed action clusters (`opacity-0 group-hover:opacity-100`).

**Scroll**: `hooks/useStickToBottom.ts` — pinned while within **80px** of the bottom; follow writes coalesced to one per animation frame via ResizeObserver; scrolling up shows "Jump to latest" (smooth scroll unless reduced motion). Re-binds on `messages:blocks:status` signature, not per token.

**Keyboard shortcuts** (grep of key handlers):

| Keys | Scope | File |
|---|---|---|
| ⌘/Ctrl+K | toggle command palette (not in inputs) | `layout/AppLayout.tsx` L50-60 |
| Enter / Shift·Ctrl·⌘+Enter | send / newline | `ChatInput.tsx` L1157-1172 |
| ↑ / ↓ | prompt history (first/last line), menu navigation | `ChatInput.tsx` L1116-1156 |
| Tab / Enter, Esc | accept / dismiss `/` `@` menu | `ChatInput.tsx` L1130-1140 |
| Backspace (empty) | remove active command pill | `ChatInput.tsx` L1143 |
| Esc | close dropdowns, right-pane fullscreen/sheet, review cards, popovers | `RightPane.tsx` L592-604 etc. |
| ⌘/Ctrl+F | terminal find; Enter next, Shift+Enter prev, Esc close | `TerminalPanel.tsx` L259-262, L854-855 |
| ⌘/Ctrl+Enter | submit review comment / save edit | `review/*.tsx` |
| ⌘/Ctrl+S | save workflow | `WorkflowBuilderPage.tsx` L538-548 |
| ⌘/Ctrl+Z / ⌘/Ctrl+Shift+Z, Backspace/Delete | undo / redo / delete selection on canvas | `workflow/DAGCanvas.tsx` L117-135 |
| F12 | DevTools in native browser | `BrowserPanel.tsx` L981 |
| Space / Enter | activate card-like `role=button` rows | various |

No global hotkey registry; every binding is a local `onKeyDown`.

---

## 20. Stores (UI-relevant shape)

All Zustand, wrapped in `globalSingleton` (HMR-safe).

- **`streamStore.ts`** → `streams: Record<sessionId, StreamState>` (`client-core/stream/types.ts` L246-321): `status: 'idle'|'pending'|'streaming'|'thinking'|'complete'|'error'`, `blocks: StreamBlock[]` (ordered, immutable per change), `text`, `thinkingText`, `toolCalls`, `systemMessages`, `hooks`, `pendingUserMessage`, `turnUserMessage`, `turnId`, `serverTurnId`, `usage: StreamUsage | null`, `contextUsage`, `cancelRequested`, `typing`, `lastActivityAt`. Actions: `applyEffects` (batched router effects), `appendToken`, `appendThinking`, `completeThinking`, `addToolCall`, `completeToolCall`, `addSystemMessage`, widget/plan/question/permission upserts and status setters, `startPending`, `setServerTurnId`, `setUsage`, `setContextUsage`, `completeStream`, `requestCancel`, `errorStream`, `clearStream`, `evictStream` (LRU-bounded; on-screen chat is protected via `protectStream`). Pages subscribe with narrow primitive selectors; only `LiveTranscript`/`AgentShellPanel` subscribe to the full record.
- **`uiStore.ts`**: `sidebarOpen` (persisted `generatorai:ui`), `commandPaletteOpen` (session).
- **`rightPaneStore.ts`**: `controller {open, toggle} | null` registered by pages so the Header shows the pane toggle.
- **`settingsUiStore.ts`**: `open`, `section` (ids in §18), `openSettings(section?)`.
- **`connectionStore.ts`**: per-session `{state: connected|reconnecting|disconnected, eventsReceived, lastEventTime, unrecoverableEvents, lastGapAt}` + `globalSSEState`; feeds `ConnectionStatus`.
- **`chatStore.ts`**: chat entity cache + `activeChatId`. **`workflowBuilderStore.ts`** / **`workflowRunStore.ts`**: §16. **`providerPrefsStore`, `catalogPrefsStore`, `customMcpStore`**: picker preferences.
- **localStorage keys worth mirroring on mobile**: `generatorai-theme`, `generatorai-theme-palette`, `generatorai-accent`, `generatorai:ui`, `generatorai:rightPane:chat:<id>` (+`:width`, `:open`), `generatorai:chat:changesTray:open`, `generatorai:browser:webInteractivity`, `generatorai:usage:cacheCapableScopes`.

---

## 21. Quick reference — "feel" rules to preserve natively

1. Chrome is quiet: surfaces step by one token (`background → card → popover`), 1px `border` dividers, colour only for status/accent. Filled buttons use `primaryEmphasis` (AA by construction); text-on-accent is `onAccent`.
2. Density: 40px header/tab strips, 28px small controls, 24px icon buttons inside panels, 11–13.5px text in agent surfaces, 14px body elsewhere; 4px grid.
3. Timeline rows are muted (verb medium, target mono 11.5px); the answer prose is the eye-catcher. Groups of ≥2 same-kind tool calls collapse to one row.
4. Never spin when the human is the blocker: gates flip rows to "Waiting for you" and hide the generating indicator.
5. Every status has icon + label (never colour alone): `StatusBadge`, plan/permission pills, stage dots.
6. Motion is short (120–220ms), compositor-only (opacity/transform), and fully disabled under reduced motion.
7. Corner radius, fonts and accent follow the selected theme; the composer card (20px) and pills (full) are the only fixed radii.

---

## Appendix A — Right-pane auto-open matrix (`pages/ChatPage.tsx`)

| Trigger | Tab focused | Condition | Lines |
|---|---|---|---|
| `browser.session_created` SSE or on-mount descriptor probe | Browser | `config.visibility === 'visible'` (or unset, legacy) | L716-775 |
| `computer.session_started` / `computer.consent_required` | Computer | computer-use enabled | L806-832 |
| plan block enters `awaiting_review` | Plan | document visible; once per plan id | L466-473 |
| first background task appears | Background Tasks | orchestrator chat; once per chat | L385-400 |
| full-page widget block (`surface: 'widget'`) | Widget (tab id = instance) | once per instance | L838-860 |
| `/browser` slash command sent | Browser (started in visible mode) | — | L1340-1365 |
| `/terminal` slash command sent | Terminal | — | L1366-1370 |
| FileDiff icon on a file-op row / tray file / summary | Changes (focused file) | — | L432-445 |
| SquareTerminal icon on a shell row | Terminal → AgentConsole | — | L447-458 |

## Appendix B — Measurement cheat-sheet (px)

| Element | Size |
|---|---|
| Sidebar width / header height / tab strip height | 240 / 40 / 40 |
| Right pane min width / max | 320 / 75% of host |
| Chat content column max width | 768 (`max-w-3xl`) |
| Composer: outer radius / textarea min–max height / send button / toolbar collapse threshold | 20 / 64–200 / 32 / 420 |
| Composer dropdowns width (mode / reasoning / context / overflow / gauge popover / menu) | 256 / 176 / 192 / 208 / 288 / min(448, vw−32) |
| Timeline: connector x / status dot / kind icon / detail panel max height / nested indent | 16 / 16 / 14 / 260 / 24 |
| Inline diff max height / group children rail indent | 320 / 16 |
| Step-in animation / row entrance stagger | 180ms / none (rows animate independently) |
| Stop button arming window / force-reset threshold / tick | 400ms / 15s / 200ms |
| Stick-to-bottom pin threshold | 80 |
| Voice waveform bars / bar width / tick | 18 / 2.5 / 50ms |
| Changes tray expanded max height / row height | 224 / 24 |
| Terminal font / max tabs; browser max tabs; widget max tabs | 12px / 4; 5; 6 |
| Toast durations (default / error) | 4s / 8s |
| Modal sizes sm / md / lg / xl (w×h rem) | 28×22 / 36×32 / 48×40 / 64×48 |
| Settings modal | w min(98vw, 78rem) × h min(94vh, 54rem); nav 240 |
