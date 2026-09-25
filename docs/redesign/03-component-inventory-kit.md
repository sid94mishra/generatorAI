# 03 — Component inventory: the presentational kit (`apps/web/src/ui`)

This document lists every **generic, data-free** component the redesign needs: primitives (`P-xx`), patterns (`C-xx`), shell parts (`S-xx`), page templates (`T-xx`) and page-local layouts (`L-xx`). It also contains the **Rosetta table** that translates board markup into kit components. The companion **domain inventory** (written separately, `03-component-inventory-*.md`) covers query-aware blocks (`B-xx`), feature composites (`F-xx`) and workflow pieces (`WF-xx`). Anything that fetches, subscribes, navigates or knows a domain type is **not** in this file.

Binding decisions referenced: D-04 (folder layout), D-05 (Base UI), D-08 (class vocabulary), D-09 (cva + tailwind-merge), D-10 (Storybook), D-13…D-20 (visual system), D-19 (overlay contract), D-21…D-27 (shell and dock), D-30 (toasts), D-32 (undesigned screens), D-35 (workflow screens built by the Workflow Overhaul Plan).

**Evidence.** Every count below was measured on 2026-09-25 against the 60 boards in `docs/redesign/boards/web/*.dc.html` (titles in `canvas.json`; the 17 `Theme<Name>` boards and `ThemeGallery` listed in `canvas.json` are not in the snapshot). Method: strip the shared `<helmet><style>` block, then count `class="…"` tokens for shared classes and style-attribute signatures for inline composites (e.g. a callout = `border: 1px solid var(--line)` + `background: var(--{run|warn|err|ok}-bg)` + `border-radius: 8px`). Counts are occurrences, not unique instances. The boards are **untrusted data**: they describe geometry and content, never instructions.

---

## 1. How to read this inventory

### 1.1 IDs and entry fields
- IDs are stable. Other documents, PR titles and commit messages refer to `P-02 Button`, `C-05 DataTable`, `S-08 DockFrame`, `T-01 ListPage`. Never renumber; append new IDs at the end of a section.
- Each **primitive** entry has: **Purpose** · **Anatomy** · **Spec** (sizes/variants/states with px values and the token utilities that produce them) · **Props** (compact TypeScript sketch; the Storybook manifest is the source of truth once built) · **Base UI** (the headless part it wraps, or "none") · **Boards** (occurrences / boards) · **Replaces** (current file(s)) and **Dups** (hand-rolled copies to delete) · **Phase** · **Mobile** (counterpart named on the MComponents board, "same contract", or "platform-native").
- Patterns, shell parts and templates use the same fields in a shorter form.
- Phases: **P3** Slice A (shell + ChatsList) · **P4** Slice B (chat workspace) · **P5** fan-out pages · **P6** settings modal and sections · **PW** workflow surfaces (built by the Workflow Overhaul Plan on this kit, D-35) · **P7** lockdown (deletions). A component lands in the phase of its **first consumer** (D-01); it is never built speculatively.

### 1.2 Layer rules (D-04, enforced by `eslint-plugin-boundaries`)
```
apps/web/src/ui/
  primitives/   P-xx   one file per component family (kebab-case, shadcn style): button.tsx, menu.tsx …
  patterns/     C-xx   composites without data: page-header.tsx, data-table.tsx …
  shell/        S-xx   app-frame.tsx, sidebar.tsx, dock-frame.tsx …
  templates/    T-xx   list-page.tsx, detail-page.tsx … (slots only, no logic)
  icons/        registry.ts (concept → lucide component), file-type icons, vendor icons
  lib/          cn.ts, overlay.ts, focus.ts, container.ts
```
- `ui/**` **may import**: `react`, `@base-ui/react` (verify the package name at install time; pre-1.0 it was `@base-ui-components/react`), `class-variance-authority`, `ui/lib/cn`, `lucide-react` (**only** inside `ui/icons`), `react-resizable-panels` (only `C-20 SplitPane`), `@tanstack/react-virtual` (only `C-05 DataTable` / `C-21 CommandList`), `sonner` (only `P-34 Toast`), and the **pure data** exports of `packages/design-tokens` (tokens, `CHROME`, `ICON_CONCEPTS`) and `packages/shared` (8-state status map D-18, `NAV_DESTINATIONS`, shortcut display data D-24).
- `ui/**` **must not import**: `stores/`, `platform/`, `hooks/*Queries`, `@tanstack/react-query`, `react-router` (links arrive through the `render` prop), `lib/desktop.ts`, `blocks/`, `features/`, `app/`. A kit component never calls `fetch`, never reads a store, never navigates.
- No barrel file at `ui/` root. Import by path: `import { Button } from '@/ui/primitives/button'`. Each file exports the component, its props type and (where useful) its cva recipe (`buttonVariants`).

### 1.3 Contract every kit component honours
1. **Storybook (D-10).** Every file ships `<name>.stories.tsx` next to it with one story per variant × size × state (default, hover via `pseudo-states`, focus-visible, disabled, invalid/loading where applicable), rendered under the toolbar axes theme × mode × accent × density × font size. `addon-vitest` runs every story; `addon-a11y` must pass. Overlays get a `play` test that opens them. The Storybook MCP manifest is how sessions discover existing components — search it before creating anything.
2. **Props pass-through.** The root element receives `...rest`, so `data-testid`, `aria-*`, `id`, `onKeyDown` etc. work without special props. Compound parts (`Menu.Item`, `Dialog.Footer`) do the same. Existing e2e tests use 239 `data-testid`s; a port must keep them.
3. **`className` merges last** through `cn()` (tailwind-merge v3 configured from the token package, D-09), so callers can override layout (`w-[264px]`, `ml-auto`) but should never override colour or type.
4. **`ref` is a normal prop** (React 19); no `forwardRef`. **`render` replaces `asChild`** (Base UI, D-05): `<Button render={<Link to="/x" />}>`.
5. **Every floating layer sets `data-gai-overlay`** (D-19): menu, context menu, popover, tooltip, select/combobox/autocomplete popups, dialog + backdrop, alert dialog, sheet, toast region, command palette. (The C-06 bulk bar sits inside the main card, never over a web view, and does not need it.) Implement once in `ui/lib/overlay.ts` (`export const overlayAttrs = { 'data-gai-overlay': '' }`) and spread it on the outermost portalled element (Base UI `Positioner` for anchored popups; `Backdrop` and `Popup` for dialogs). A Storybook play test asserts the attribute on every overlay story.
6. **No literals.** Colours, radii, type and heights come from the D-08 vocabulary (`bg-raised`, `rounded-control`, `text-small`, `h-control`). Heights are CSS variables so density (D-15) is a variable swap. No `#hex`, no palette classes, no `text-[11px]`.
7. **Accessibility.** Icon-only controls require `label` (rendered as `aria-label` and as the tooltip text). Minimum hit area 24px. Status is never colour alone (D-18). Focus ring: the `focus-ring` utility — `outline: 2px solid var(--gai-focus); outline-offset: 2px` (`02-design-system-spec.md` §2.3 focus-ring recipe; it replaces the board's `0 0 0 2px surface, 0 0 0 4px accent` shadow, because the accent fails 3:1 on some surfaces, D-12); inputs use `border-focus` plus `0 0 0 3px var(--gai-selected)`.
8. **Density and font size.** Components read `--gai-h-*`; compact subtracts 4px from controls and rows, never from 44px bars (D-15). Text uses the semantic scale so the 12/13/14 interface font setting (D-13) shifts everything.

### 1.4 Token shorthand used below
Heights: `h-control-sm` 24 · `h-control` 28 · `h-control-lg` 32 · `h-nav` 30 · `h-tab` 36 · `h-row` 44 · `h-bar` 44. Radii (Instrument, D-14): `rounded-badge` 4 · `rounded-control-sm` 5 · `rounded-control` 6 · `rounded-seg` 7 · `rounded-card` 8 · `rounded-panel` 10 · `rounded-dialog` 12. Type: `text-micro` 11 · `text-small` 12 · `text-ui` 13 · `text-body` 14 · `text-title` 16 · `text-heading` 20 · `text-display` 28; `font-mono` = JetBrains Mono.
**Needed beyond the original D-08 list** (now specified in `02-design-system-spec.md` §6.3 heights and §8 `SHELL` widths; D-08 updated): 40 (`h-panel-bar`: card headers, dock panel toolbars, Windows sidebar header row), 48 (`h-dialog-bar`: dialog header, palette input), 56 (`h-footer`: action bars, dialog footers, two-line table rows), 20 (`h-badge`), 18 (`h-kbd`); layout widths `w-sidebar` 232, `w-rail` 48, `w-dock` 480/440, `w-sheet` 380, `w-aside` 320, `w-side-rail` 360, `w-inspector` 400; and a switch-thumb colour (the board hard-codes `#ffffff`).

---

## 2. Primitives (P-xx) — `ui/primitives/`

48 primitives. "Boards" = occurrences / number of boards.

**P-01 Icon** (+ `ui/icons/registry.ts`)
- Purpose: the only way to draw a glyph (D-17). Anatomy: inline SVG, `fill:none; stroke:currentColor; stroke-width:1.75`, round caps/joins.
- Spec: sizes 12 (`.i12`, 1,240/58) · 14 (`.i14`, 1,495/59) · 16 (default `.i`, and `.i16` used 2× in ChatWorkflowRun without a definition) · 20 (`.i20`, 49/2). Colour inherits; tone via `text-fg-3`, `text-run` etc.
- Props: `{ name: IconConcept; size?: 12|14|16|20; label?: string }` — `label` sets `role="img"`, else `aria-hidden`.
- Base UI: none. Replaces: 147 direct `lucide-react` imports (the Audit board says 174 icon uses) (lint-banned outside `ui/icons`). File-type icons (`components/shared/fileIcons.tsx`) and vendor marks (`components/shared/VendorIcons.tsx`) move under `ui/icons/`. Phase P3 (registry and all 49 concepts in P1 if the registry lands with shared registries). Mobile: same concept registry (SF Symbols / Material names in `ICON_CONCEPTS`).

**P-02 Button**
- Anatomy: `button` → optional leading `Icon` · label · optional trailing `Kbd` (shortcut) or chevron.
- Spec: md 28h (`h-control`), pad 0 10, `rounded-control`, 1px `border-line`, `bg-raised`, `text-fg`, `text-ui` 500, gap 6, lh 1. sm 24h, pad 0 8, `rounded-control-sm`, `text-small`. lg 32h, pad 0 12. Variants: **primary** `bg-accent text-on-accent border-transparent`; **secondary** (default); **ghost** `bg-transparent border-transparent text-fg-2` (hover `bg-hover text-fg`); **danger** secondary chrome with `text-err`; **danger-ghost** ghost with `text-err`. States: hover (`bg-hover` overlay), `pressed` (aria-pressed → `bg-selected border-transparent text-fg`; used by "Add codebase", the expanded "Pair a new device", the Windows server chip), focus-visible `ring-focus`, disabled (`text-fg-3`, cursor not-allowed; primary gets `opacity-45`), `loading` (P-12 Spinner replaces the leading icon, width locked). A trailing `Kbd` inside a primary button renders `onAccent` (transparent, currentColor border, opacity .7). One primary per view.
- Props: `{ variant?: 'primary'|'secondary'|'ghost'|'danger'|'danger-ghost'; size?: 'sm'|'md'|'lg'; icon?: IconConcept; trailingIcon?: IconConcept; shortcut?: string[]; pressed?: boolean; loading?: boolean; fullWidth?: boolean; render?: ReactElement }`.
- Base UI: none (native `button`; `useRender` for `render`). Boards: `.btn` 678/58 (all but Audit, Themes); primary 64/43; danger 18/12; lg 8/5; `btn-g btn-sm` 256.
- Replaces: `components/ui/Button.tsx` (113 barrel imports). Dups: `layout/Header.tsx` `ActionButton`. Phase P3. Mobile: Capsule button 44pt (iOS) / M3 button 40dp; "Prominent" = primary.

**P-03 IconButton**
- Anatomy: square `button` with one `Icon` (16; 14 in sm) and required `label`.
- Spec: md 28×28 `rounded-control`, sm 24×24 `rounded-control-sm`, lg 32×32 (rail). `bg-transparent text-fg-2`, hover `bg-hover text-fg`, `pressed`/selected (`.ib.on`) `bg-selected text-fg`; variant **primary** (`bg-accent text-on-accent rounded-card`, the Send/Start button); **tone** `warn|run` for rail counters. Optional `badge` slot (dot or count, P-07/P-08).
- Props: `{ icon: IconConcept; label: string; size?: 'sm'|'md'|'lg'; variant?: 'ghost'|'primary'; pressed?: boolean; tooltip?: boolean|string; shortcut?: string[]; badge?: ReactNode; render? }` — shows a P-28 Tooltip with `label` (+ shortcut) by default.
- Base UI: none (+ Tooltip). Boards: `.ib` 834/56; `.ib-sm` 461/51; `.ib.on` 48.
- Dups: `diff/ChangesSurface.tsx:1859` `IconButton`, `diff/FilesSurface.tsx:547` `IconButton`. Phase P3. Mobile: toolbar icon button (platform-native).

**P-04 Kbd**
- Spec: 18h, min-w 18, pad 0 4, `rounded-badge`, 1px `border-line`, `bg-sunken`, `font-mono text-micro text-fg-3` 400. `onAccent` variant for primary buttons. One box holds a whole chord (`Ctrl K`, `Ctrl ↵`, `⌘K`); arrow keys are separate boxes.
- Props: `{ keys: string[] | string; onAccent?: boolean }`. Display strings come from the caller (blocks resolve D-24 `SHORTCUTS` per host); the kit does not detect the platform.
- Boards: 219/54. Replaces: `components/ui/Kbd.tsx` (its `isMacPlatform`/`modEnterLabel` helpers move to `packages/shared` shortcut formatting). Phase P3. Mobile: none (hardware keyboard hints only on iPad; platform-native).

**P-05 Badge**
- Spec: 20h, pad 0 6, `rounded-badge`, `text-small` 500, gap 4, optional 12px icon, nowrap. Tones: `neutral` (`bg-selected text-fg-2`, = `.s-idle`), `run`, `ok`, `warn`, `err` (`bg-{tone}-bg text-{tone}`). Optional `mono` suffix slot (e.g. "Published v7"). Used for non-status labels (Draft, Agent, Worker, Published, counts).
- Props: `{ tone?: 'neutral'|'run'|'ok'|'warn'|'err'; icon?: IconConcept; suffix?: ReactNode }`.
- Boards: `.bdg` 194/51 (s-idle 101, s-warn 31, s-ok 29, s-run 24, s-err 9). Replaces `components/ui/Badge.tsx` (tones primary/info/done are dropped), `components/common/SourceBadge.tsx`. Dups: `pages/WorkflowDefinitionPage.tsx` `MetaChip`. Phase P3. Mobile: status badge (same contract).

**P-06 StatusBadge**
- Purpose: the D-18 8-state badge. Anatomy: Badge + state glyph (12) + word.
- Spec: Queued `circle-dashed` neutral(fg-3 glyph) · Running `loader-circle` run (spins, P-12) · Waiting `clock` neutral · Needs you `hand` warn · Paused `circle-pause` neutral · Succeeded/Done `circle-check` ok · Failed `circle-x` err · Skipped `circle-minus` neutral. Always glyph + word.
- Props: `{ state: VisualStatus; context?: 'chat'|'run'; label?: string; phase?: string }` — `context="chat"` says "Done"; `phase` renders "Running · Finalizing". The server-status → `VisualStatus` mapping is done by callers with the `packages/shared` map.
- Boards: all `.bdg.s-*` used as status (≈180/51). Replaces `components/ui/StatusBadge.tsx` (19-status map). Dups: `settings/sections/Security.tsx` `StatusPill`, `workflow/redesign/RunHeaderBar.tsx` `StatusPill`, `layout/Header.tsx` `ChatStatusBadge`, `chat/BackgroundTasksPanel.tsx` `StatusChip`, `chat/sources/SourcesPanel.tsx` `StatusChip`, `settings/sections/Providers.tsx` `ConnectionPill`, `dashboard/SystemStatusPill.tsx`. Phase P3. Mobile: status badge (same contract; `ui-contract` type in `packages/shared`).

**P-07 StatusDot**
- Spec: 8px circle (dense rows); `size="sm"` 6px (inline, connection); `ring` = 7px with `0 0 0 2px var(--gai-ground)` (rail notification). Colour from `state` (same map as P-06) or `tone`. Never alone for meaning: pair with text or `label` (→ `role="img"`).
- Props: `{ state?: VisualStatus; tone?: Tone; size?: 'sm'|'md'; ring?: boolean; label?: string }`.
- Boards: `.dot` 183/54. Dups: `agent/StepRow.tsx` `StatusDot`. Phase P3. Mobile: same contract.

**P-08 Count**
- Spec: `font-mono text-micro text-fg-3`, `ml-auto` inside rows (`.cnt`); tones `warn|run|err`; `bubble` form for rail icons (11px, lh 14, pad 0 3, `rounded-badge`, tone bg).
- Props: `{ tone?: Tone; bubble?: boolean; align?: 'end'|'inline' }`. Boards: `.cnt` 217/38 (+ mono counts after titles/tabs ≈300). Phase P3. Mobile: same contract.

**P-09 Chip**
- Anatomy: root (`span`, or `button` when interactive) → optional leading icon (12/14) · text · optional trailing chevron / remove button.
- Spec: md 24h (`h-control-sm`), pad 0 8, `rounded-control`, 1px `border-line`, transparent, `text-small` 500 `text-fg-2`, gap 6. sm 20h, pad 0 6 (boards also draw 22h; normalise to 20). Variants: `outline` (default), `ghost` (border transparent — composer toolbar, sort chip), `mono` (`font-mono text-micro`), `overflow` ("+N", `text-fg-3`), `dropdown` (trailing 12px chevron, `aria-haspopup`), `removable` (`onRemove` renders an 18×18 ghost IconButton `rounded-badge`, root pad-right 2), `pressed` (toggle chip with an embedded 12px checkbox, SettingsSecurity scopes). Truncation always shows `+N`, never silently.
- Props: `{ variant?: 'outline'|'ghost'; size?: 'sm'|'md'; mono?: boolean; icon?: IconConcept; dropdown?: boolean; onRemove?: () => void; removeLabel?: string; pressed?: boolean; render? }` + `<ChipList max={n}>` helper that renders the overflow chip.
- Boards: `.chip` 460/49. Dups: `chat/ChatInput.tsx` `ComposerChip`, `agent/UsageChip.tsx`, `WorkflowDefinitionPage.tsx` `MetaChip`. Phase P3. Mobile: chip (same contract, capsule shape per mobile pass).

**P-10 Avatar**
- Purpose: human/agent **initials** tile (desktop only; v2 removes initials from workflow surfaces).
- Spec: square, `bg-selected text-fg-2` 600. Sizes 18 (9px text) · 20 (10px) · 24 (11px, default) · 32 (12px, `rounded-card`); ≤24 use `rounded-control`. The 9–10px text is the only sub-11px type allowed (D-13 exception).
- Props: `{ name: string; size?: 18|20|24|32; src?: string }` (initials derived; image optional). Base UI: `Avatar` (image + fallback).
- Boards: `.av` 91/23 (NewChat 13, AgentPickerBoard 12, ChatsList 12). Phase P3 (ChatsList agent column). Mobile: **platform-native / none** — mobile bans initials avatars (agent icon + name).

**P-11 AgentGlyph**
- Spec: registry concept `agents` (lucide `bot`) at 12/14/16, `text-fg-3`, no backing tile; optional trailing name. Replaces Avatar on workflow surfaces (v2: WorkflowAgentDraft 10, WorkflowDetail 8, WorkflowRun 8, WorkflowRunDialog 8, WorkflowStage* 7–8 occurrences beyond the nav icon).
- Props: `{ size?: 12|14|16; name?: string }`. Phase PW (P4 if the in-chat workflow card needs it). Mobile: agent icon + name (same contract).

**P-12 Spinner**
- Spec: the Running glyph (`loader-circle`) rotating 1 s linear; sizes 12/14/16; inherits colour (`text-run`). Stops under `data-motion="reduce"` (D-20). No other spinners exist in the design.
- Props: `{ size?: 12|14|16; label?: string }`. Boards: loader glyph 189/54. Replaces `components/ui/Spinner.tsx` (57 imports) and `animate-spin` in 21 files. Phase P3. Mobile: running glyph (same contract).

**P-13 Input**
- Anatomy: wrapper (`label`-able) → optional leading icon · native `input` · optional trailing slot (Kbd, unit, status).
- Spec: md 32h (`h-control-lg`), sm 28h; pad 0 10, gap 8, `rounded-control`, 1px **`border-line-strong`** (D-12 overrides the board's `--line`), `bg-sunken`, `text-ui text-fg`, placeholder `text-fg-3`. Focus: `border-fg-3` + `0 0 0 3px var(--gai-selected)`. Invalid (`aria-invalid`): `border-err` + `0 0 0 3px var(--gai-err-bg)`. `mono` (`font-mono text-small`). `readOnly` "generated" look: transparent bg, `text-fg-2`. Disabled `text-fg-3`. Boards also draw 26h and 30h inputs in dense rows — use sm (28).
- Props: `{ size?: 'sm'|'md'; mono?: boolean; leading?: IconConcept|ReactNode; trailing?: ReactNode; invalid?: boolean } & InputHTMLAttributes`.
- Base UI: `Input` (inside `Field`). Boards: `.inp` 148/40. Replaces `components/ui/Input.tsx` (`Input` 37, `Textarea` 20 imports). Phase P3. Mobile: outlined field / form row.

**P-14 SearchInput**
- Spec: P-13 with leading `search` icon and trailing `Kbd` hint (default `/`, focuses on keypress when no text field is focused); clear button (ghost ib-sm) when non-empty. Widths used: 240–264 (list filter bars), 160 (inspector filter), full width (settings nav, 30h → sm).
- Props: `{ value; onValueChange; placeholder; shortcut?: string|null; size?: 'sm'|'md'; label: string }` (`label` → `aria-label`; the Agents audit found a missing accessible name).
- Boards: search `.inp` with kbd ≈40/30. Replaces `components/ui/SearchInput.tsx`. Phase P3. Mobile: search field (platform-native search bar).

**P-15 Textarea**
- Spec: `md`: min-h 64, pad 7 10, `text-ui` lh 1.45, same chrome as P-13. `prose`: `text-body` lh 1.6, pad 10 8 6 12, `rounded-card`, heights 96/112, optional `footer` slot (attach ib-sm left, KbdHint right) — the task box in ChatCreate/NewChat. `autosize` with `maxRows`.
- Props: `{ variant?: 'md'|'prose'; autosize?: boolean|{minRows,maxRows}; footer?: ReactNode; invalid? }`.
- Boards: 7/7 (AgentEditor, ChatCreate, ChatCreateModel, Components, DockBrowser, DockChanges, NewChat). Replaces `Textarea` in `ui/Input.tsx`. Phase P4 (review comments, composer-adjacent). Mobile: multi-line field.

**P-16 Field** (`Field`, `Field.Label`, `Field.Hint`, `Field.Error`)
- Spec: vertical: label (`.lbl` `text-small` 500 `text-fg-2`; optional "optional" suffix 400 `text-fg-3`), control, hint (`.hint` `text-small text-fg-3`); gap 6 (5 in dense 3-column grids). **Error replaces the hint**, `text-err`, with a 12px `circle-x` icon, `role="alert"` only when it appears after interaction. Horizontal: fixed label column (64 in NewChat, 100 in inspectors, 108 in key-value forms) + control.
- Props: `{ label; hint?; error?; optional?; orientation?: 'vertical'|'horizontal'; labelWidth?: number; children }`.
- Base UI: `Field` (Root/Label/Description/Error/Control) + `Fieldset`. Boards: `.lbl` 134/22, `.hint` 148/24. Dups: `settings/sections/Catalogs.tsx` `Field`, `pages/AgentEditorPage.tsx` `Field`, `automation/WebhookCredentialsDialog.tsx` `CopyField`. Phase P5. Mobile: form row.

**P-17 Select**
- Anatomy: trigger styled as P-13 (`button.inp`: optional icon · value · meta in `font-mono text-micro text-fg-3` · chevron `ml-auto text-fg-3`) → popup styled as P-30 Menu (overlay, r8, pad 4, 30h options with check indicator).
- Props: `{ value; onValueChange; items: {value,label,meta?,icon?,disabled?}[]; size?; placeholder?; invalid? }`.
- Base UI: `Select`. Boards: `button.inp` 17/8 (AgentEditor 3, ChatCreate 3, ChatCreateOrchestrator 3, NewChat 3 …) + dense select cells in WorkflowRunDialog (6). Replaces `components/ui/Select.tsx` (14 imports). Phase P5. Mobile: picker / menu (platform-native).

**P-18 Combobox**
- Purpose: searchable single/multi select (project, codebase, timezone, model, agent pickers' shell). Anatomy: trigger or inline input → popup with search input (32h) + grouped list (group label 28h) + optional detail pane slot (model picker 620 wide, agent picker 760).
- Props: `{ items; value; onValueChange; multiple?; groupBy?; renderItem?; detail?: (item)=>ReactNode; width? }`.
- Base UI: `Combobox`. Boards: listbox popups ComposerModelPicker (620×384), AgentPickerBoard (760×508). Replaces `components/ui/SearchableSelect.tsx` + `ui/primitives/command.tsx` (cmdk). Phase P4 (model picker in composer). Mobile: picker sheet.

**P-19 Autocomplete**
- Purpose: free-text input with suggestions (command palette query, slash `/` and `@` menus in the composer, `{{` variable insertion). Popup: grouped options 30h (menus) or 36h (palette), highlighted = `bg-selected text-fg`, match text 600 `text-fg`.
- Props: `{ value; onValueChange; items|groups; renderItem; onSelect; open?; anchor? }`. Base UI: `Autocomplete`. Boards: CommandPalette, ComposerStates (slash 460, @ 440), WorkflowStagePrompt (insert variable 360). Replaces `cmdk` (last release 2024, D-38). Phase P3 (palette, P3-02/P3-05); the composer's slash/@ menus reuse it in P4. Mobile: suggestion list (platform-native).

**P-20 NumberField**
- Spec: P-13 chrome, `font-mono` value, optional unit suffix (`text-micro text-fg-3`), optional stepper pair (ib-sm chevrons), min/max/step, scrub on the label optional.
- Props: `{ value; onValueChange; min?; max?; step?; unit?: string; steppers?: boolean; size? }`. Base UI: `NumberField`. Boards: numeric `.inp mono` in WorkflowBuilder (attempts, delays, budgets), AutomationCreate, SettingsSecurity. Replaces `components/workflow/NumberStepper.tsx` (re-exported from `ui/index.ts`). Phase P6 (retention/limits sections; PW otherwise). Mobile: stepper / numeric field.

**P-21 Checkbox**
- Spec: 14×14, `rounded-badge`, 1px `border-line-strong`; checked `bg-accent border-accent` with 12px check in `text-on-accent`; indeterminate shows a minus (ChatsList "select all" `aria-checked="mixed"`); `size="sm"` 12×12 (inside chips). Label 13px, gap 8. "Checkboxes wait for Save; switches apply now."
- Props: `{ checked; onCheckedChange; indeterminate?; size?: 'sm'|'md'; label?: ReactNode }` + `CheckboxGroup`. Base UI: `Checkbox`, `CheckboxGroup`. Boards: `.cb` 82/15. Replaces `ui/primitives/checkbox.tsx` (14 imports). Phase P3. Mobile: checkbox / selection mark (platform-native).

**P-22 Switch**
- Spec: 28×16 pill, off track `bg-line-strong`, thumb 12 circle at 2px `bg-surface` (board: white; `line-strong` is derived ≥ 3:1 against every surface, D-12, so no extra token is needed), on track `bg-accent`, thumb `bg-on-accent` at left 14. `role="switch"`. Applies immediately.
- Props: `{ checked; onCheckedChange; label?: string; disabled? }`. Base UI: `Switch`. Boards: `.sw` 70/17 (AgentPickerBoard 17, ChatCreateOrchestrator 9, ProjectCustomization 8, WorkflowRunDialog 7). Replaces `components/ui/ToggleSwitch.tsx`, `ui/primitives/switch.tsx`. Dups: hand-rolled `role="switch"` in `settings/sections/Security.tsx`. Phase P5 (P4 if a composer toggle needs it). Mobile: switch (on = ink).

**P-23 RadioGroup** (`RadioGroup`, `Radio`)
- Spec: radio 14 circle, 1px `border-line-strong`; checked = 4px `border-accent` (Components board; AutomationCreate draws a 1px accent ring + 6px dot — **use the Components version**). Label 13px gap 8. Variant **swatch**: 20px circle filled with the option colour, unchecked `inset 0 0 0 1px line`, checked `0 0 0 2px overlay, 0 0 0 4px fg` (Settings › Accent).
- Props: `{ value; onValueChange; orientation?; variant?: 'default'|'swatch' }`. Base UI: `RadioGroup` + `Radio`. Boards: `role=radio` 57/7, `radiogroup` 23/10. Dups: radiogroups in `settings/sections/Appearance.tsx`, `chat/sources/SourcePicker.tsx`, `browser/BrowserVisibilityPicker.tsx`. Phase P5 (swatch P6). Mobile: platform-native list selection.

**P-24 RadioCard**
- Anatomy: radio item rendered as a card: top row (16 icon · radio indicator `ml-auto`) · title · description.
- Spec: pad 10 (12 on wizard), `rounded-card`, 1px `border-line`, `bg-raised`, `text-fg`; title `text-ui` 600; description `text-micro` (12 on wizard) `text-fg-3` lh 1.3; checked `border-accent bg-selected` + checked indicator. Variant **tile** (theme picker): 96h, pad 4, preview slot 58h `rounded-control-sm`, caption row 28h `text-small` 500 with check icon; checked = `0 0 0 2px var(--gai-fg)` ring, transparent border.
- Props: `{ value; icon?; title; description?; variant?: 'card'|'tile'; preview?: ReactNode; disabled? }` (inside P-23 RadioGroup). Base UI: `Radio` via `render`. Boards: radio cards 12/6 (Components, AutomationCreate, ChatCreateModel, WorkflowNew, WorkflowAgentDraft, WorkflowSettingsPanel) + ChatCreate* "Who works" grids + 12 theme tiles on SettingsAppearance. Replaces `settings/sections/Appearance.tsx` `ThemeCard`. Phase P5 (tile P6). Mobile: selection row / grouped list.

**P-25 SegmentedControl**
- Spec: track pad 2, `rounded-seg`, `bg-sunken`, 1px `border-line-soft`, gap 2; items 24h, pad 0 10, `rounded-control-sm`, `text-small` 500 `text-fg-2`; selected `bg-raised text-fg` + `0 0 0 1px var(--gai-line)`; optional icon, count (`font-mono text-micro text-fg-3`), icon-only items (pad 0 7), disabled items `opacity-45` + reason tooltip. `size="md"`: 32h track / 28h items (NewChat effort). `fullWidth` stretches items (Security network exposure).
- Semantics: `semantics="radio"` (a value: mode, density, effort — Base UI `ToggleGroup`/`RadioGroup`) or `semantics="tabs"` (scopes that filter a list: All/Active/Archived — Base UI `Tabs` with segmented styling). The boards use both roles; choose by what the control does.
- Props: `{ value; onValueChange; items: {value,label?,icon?,count?,disabled?,reason?}[]; semantics?: 'radio'|'tabs'; size?: 'sm'|'md'; fullWidth?; label: string }`.
- Boards: `.seg` 79/39. Replaces `components/data/FilterTabs.tsx`. Dups: `chat/sources/SourcePicker.tsx` `Segmented`, `diff/FilesSurface.tsx` `ModeButton`, `aria-pressed` button groups in 16 files. Phase P3. Mobile: segment (same contract).

**P-26 Tabs** (underline)
- Spec: list gap 20 (12 in panels/inspectors, pad 0 16), bottom 1px `border-line-soft`; tab 36h (`h-tab`), pad 0, `text-ui` 500 `text-fg-2`, gap 6; active `text-fg` + `inset 0 -2px 0 var(--gai-fg)` (**fg, not accent**); optional count (`font-mono text-micro text-fg-3`). Never tabs inside tabs.
- Props: `{ value; onValueChange; items: {value,label,count?,disabled?}[]; density?: 'page'|'panel'; renderTab? }` (router links via `render`). Base UI: `Tabs`. Boards: `.tabs` 13/12, `.tab` 67. Replaces `components/ui/Tabs.tsx`, `ui/primitives/tabs.tsx`. Dups: `role="tab"` strips in `workflow/StagePropertiesPanel.tsx`, `workflow/redesign/RightInspector.tsx`. Phase P5 (ProjectDetail). Mobile: top tabs / segment (platform-native).

**P-27 NavItem**
- Spec: 30h (`h-nav`), pad 0 8, `rounded-control`, gap 10, `text-ui` 500 `text-fg-2`, 16 icon; hover `bg-hover text-fg`; active (`aria-current="page"`) `bg-selected text-fg`; trailing P-08 Count. `twoLine`: 44h, align start, pad-top 6, leading 8px StatusDot (margin 5 4 0 4), title `text-fg` truncated, subtitle `text-small` 400 `text-fg-3`, lh 1.3. `dense`: 28h (settings nav). `iconOnly` = P-03 lg for the rail.
- Props: `{ icon?; label; subtitle?; dot?: VisualStatus; count?: ReactNode; active?; dense?; render }`. Boards: `.nav` 510/38 (≈12 per board in the sidebar + settings nav + Home link card). Replaces `layout/Sidebar.tsx` nav rows. Phase P3. Mobile: sidebar drawer row.

**P-28 Tooltip**
- Spec: `bg-overlay`, 1px `border-line`, `shadow-pop`, `rounded-control`, `text-small text-fg`, pad 4 8; with shortcut: 28h, pad 0 8, gap 8 + Kbd; optional 8px arrow. Open delay 400 ms, close 0; never holds interactive content.
- Props: `{ content: ReactNode; shortcut?: string[]; side?; children }` + `TooltipProvider` at the app root. Base UI: `Tooltip`. Boards: `role=tooltip` 1 (ComposerStates) + Components; 107 `title=` attributes on 18 boards become tooltips. Replaces `components/ui/Tooltip.tsx`, `ui/primitives/tooltip.tsx`, shim `components/Tooltip.tsx`. Phase P3. Mobile: none (long-press preview is platform-native).

**P-29 Popover**
- Spec: `bg-overlay`, 1px `border-line`, `rounded-card`, `shadow-pop`, pad 12 (content) or 4 (list); widths 186–288 on the boards. Parts `Popover.Title` (`text-ui` 600), `Popover.Description` (`text-small text-fg-3` lh 1.45), `Popover.Actions` (justify-end gap 6, sm buttons). Recipe **ConfirmPopover** (kill terminal: title, consequence, Cancel+Esc / danger action).
- Props: `{ trigger; children; width?; side?; align? }`. Base UI: `Popover`. Boards: ChatTerminal (264), ChatBrowser (256), ComposerStates context window (288), DockBrowser (186), DockTerminal find widget. Replaces `ui/primitives/popover.tsx` (6 imports). Dups: `diff/review/FloatingCard.tsx` (createPortal), `ReviewCommentsPopover`, `ReviewComposerPopover`. Phase P4. Mobile: sheet / popover (platform-native).

**P-30 Menu** (dropdown, context menu, submenu)
- Spec: popup `bg-overlay`, 1px `border-line`, `rounded-card`, `shadow-pop`, pad 4; width 176–460 (default min 220). Item 30h (`h-nav`), pad 0 8, `rounded-control-sm`, gap 8, `text-ui text-fg`, 16 icon; highlighted `bg-selected`; trailing Kbd or `chevron-right text-fg-3` (submenu); **danger** item `text-err`; disabled `text-fg-3`; two-line item 40h (title 13 + `font-mono text-micro text-fg-3` meta, Servers menu); `CheckboxItem`/`RadioItem` with a 14px leading check column; `GroupLabel` 28h (26 in the Servers menu), `text-small text-fg-3`, pad 0 8; `Separator` 1px `bg-line-soft`, margin 4 0.
- Props: `Menu.Root/Trigger/Popup/Item{icon,shortcut,danger,description}/CheckboxItem/RadioGroup/RadioItem/SubmenuRoot/SubmenuTrigger/GroupLabel/Separator`; `ContextMenu.*` identical parts.
- Base UI: `Menu`, `ContextMenu`. Boards: 17 menus, 113 items on 13 boards (ComposerStates 16, DockBrowser 13, Components 12, DesktopMac 10, WorkflowStagePrompt 10, DockChanges 9 incl. 9 `menuitemcheckbox`, Projects 8, WorkflowRun 8, Workflows 7). Replaces `ui/primitives/dropdown-menu.tsx`. Dups (audit: 11 hand-rolled menus): `diff/ChangesSurface.tsx` `MenuLabel`/`MenuSeparator`/`MenuCheckItem`, `pages/WorkflowDefinitionPage.tsx` `MenuItem`, `role="menu"` in `chat/PlanCard.tsx`, `layout/RightPane.tsx`, `workflow/StageEdge.tsx`, `chat/RewindMenu.tsx`, `chat/composer/ComposerMenu.tsx`. Phase P3. Mobile: long-press context menu (iOS) / M3 overflow menu.

**P-31 Dialog**
- Spec: backdrop `bg-scrim`; popup `bg-overlay`, 1px `border-line`, `rounded-dialog`, `shadow-pop`, overflow hidden. Sizes: `sm` 420 (inferred, alert/confirm), `md` 640 (NewChat), `lg` 960×640 (Settings), `xl` 1040×856 (Run dialog), each clamped to `100vw−64` × `100vh−44`. `placement="top"` (palette, top 120 at 900h ≈ 13vh) or centred. Parts: `Dialog.Header` (48h, pad 0 10 0 20, border-b `line-soft`, title `text-title` 600, optional badge, close ib), `Dialog.Body` (pad 20, gap 20, scrolls), `Dialog.Footer` (56h, pad 0 16 0 20, border-t `line-soft`; `hint` left in `text-small text-fg-3`, actions right).
- Props: `{ open; onOpenChange; size?; placement?; title; children }`. Base UI: `Dialog`. Boards: 7 dialogs, scrim on 6 boards. Replaces `components/ui/Modal.tsx`, `ui/primitives/dialog.tsx`, `ui/Drawer.tsx` (as modal use). Phase P3 (the command palette frame S-10, P3-05; NewChat is P5; P4 uses it for file viewer/review dialogs). Mobile: sheet (inset, grabber, detents).

**P-32 AlertDialog**
- Spec: Dialog `sm` (420); title `text-title` 600; description `text-ui text-fg-2`; footer Cancel (secondary + `Esc` kbd) and confirm (danger for destructive). Only for destructive or irreversible actions (mobile board rule). Not drawn on desktop; geometry derived from Dialog.
- Props: `{ title; description; confirmLabel; tone?: 'danger'|'primary'; onConfirm }` + `useConfirm()` hook. Base UI: `AlertDialog`. Replaces `components/ui/ConfirmDialog.tsx`, `ui/useConfirm.tsx`, `ui/primitives/alert-dialog.tsx`, shim `components/ConfirmDialog.tsx`. Phase P3 (ChatsList bulk delete). Mobile: confirmation alert.

**P-33 Sheet**
- Spec: side panel as a dialog: `bg-overlay`, border-left 1px `border-line`, `shadow-pop`, no radius; width prop (380 narrow dock). Can render into a container (inside the main card, `top: 44px`) and be **non-modal** (chat stays usable beside it).
- Props: `{ open; onOpenChange; side?: 'right'|'left'; width?; container?; modal?: boolean }`. Base UI: `Dialog` (modal=false). Boards: ChatNarrow dock sheet. Replaces `components/ui/Drawer.tsx`. Phase P4. Mobile: sheet.

**P-34 Toast** (sonner wrapper, D-30)
- Spec: `bg-overlay`, 1px `border-line`, `rounded-card`, `shadow-pop`, pad 10 12, `text-ui`; tone icon (err `circle-x`, background completion `circle-check` ok / `info` run); description `text-small text-fg-2`; optional action (sm button) and expandable `logs` (CodeBlock); bottom-right, offset 16. Errors and background-job completions only.
- Props: `toast.error(title, {description?, logs?, action?})`, `toast.done(title, …)`; `<Toaster />` carries `data-gai-overlay`. Replaces `components/Toast.tsx` adapter (19 importers), `ui/primitives/sonner.tsx`. Phase P3. Mobile: toast (same contract).

**P-35 Separator** — 1px `bg-line-soft` horizontal (menus: margin 4 0); vertical 1×16 or 1×20 (`bg-line` in headers, `bg-line-soft` in bars), margin 0 6. Props `{ orientation?; tone?: 'soft'|'default' }`. Base UI `Separator`. Boards: H 25/16, V 28/15. Replaces `ui/primitives/separator.tsx`. Phase P3. Mobile: divider.

**P-36 ScrollArea** — Base UI `ScrollArea`; 8px scrollbar, thumb `bg-line-strong rounded-full`, visible on hover/scroll; exposes `viewportRef` for virtualisation. Not drawn (boards are static). Replaces `ui/primitives/scroll-area.tsx`. Phase P3. Mobile: platform-native.

**P-37 Skeleton** — no shimmer, no spinner. Shapes: `line` (8h `rounded-badge`), `meta` (6h, radius 3), `block` (e.g. 24×24 `rounded-control`), width in %/px; all `bg-selected`. Container sets `aria-busy`. Boards: Components (3 rows 44h). Replaces `components/ui/Skeleton.tsx` (`SessionListSkeleton`, `ChatMessageSkeleton`, `CardGridSkeleton`), shim `components/Skeleton.tsx`, `animate-pulse` in 7 files. Phase P3. Mobile: skeleton (same contract).

**P-38 ProgressBar / Meter**
- Spec: 4h, radius 2, track `bg-selected`, fill `bg-run` (progress) or `bg-fg-3` (neutral meter: disk) or tone thresholds (warn ≥80 %, err ≥95 %). Inline mini meter 40×4 (run budget). Label row: `text-small text-fg-2` label + `font-mono text-micro text-fg-3` value.
- Props: `{ value; max?; tone?; label: string; kind?: 'progress'|'meter'; size?: 'inline'|'block' }`. Base UI: `Progress`, `Meter`. Boards: 6/6 (+ budget meters on WorkflowRun/Loop). Phase P5 (Home disk). Mobile: progress bar.

**P-39 Gauge** (context ring)
- Spec: 14×14 SVG, r 6, stroke 2, track `stroke-line-strong`, arc `stroke-fg-2` (warn/err thresholds), optional `font-mono text-micro` percentage; usually inside a ghost sm Button that opens a Popover.
- Props: `{ value; max?; size?: 14|16; showLabel?; label: string }`. Base UI: `Meter`. Boards: 31/16 (ComposerStates 15, every chat board 1). Replaces the ring in `components/shared/ContextUsageGauge.tsx` (the popover content becomes a block). Phase P4. Mobile: gauge in the turn sheet.

**P-40 Callout**
- Spec: pad 10 12, `rounded-card`, **full** 1px `border-line`, background `bg-{run|warn|err|ok}-bg`, gap 10, `text-ui text-fg`, 16 tone icon (`info`, `warning`, `circle-x`, `circle-check`); optional second line `text-small text-fg-2`; optional trailing sm Button; `tone="neutral"`: `bg-raised border-line-soft`, `text-small text-fg-2` (Scripts info box). **Never a left stripe.**
- Props: `{ tone?: 'info'|'warn'|'err'|'ok'|'neutral'; title?; children; action?; icon? }`. Boards: 18/12 (Components 4, ComposerStates 3, DockBrowser 2 …). Replaces unbounded red error text (audit: run page), inline `border-l-*` alerts. Phase P4. Mobile: alert / inline banner.

**P-41 EmptyState**
- Spec: centred column, gap 8: icon 20 `text-fg-3`, title `text-ui` 600, one sentence `text-small text-fg-3`, one secondary Button (margin-top 4). `framed`: 1px `border-line-soft`, `rounded-card`, 204h, pad 0 28. `tone="error"`: the real error in `font-mono text-small text-err` + Retry (dock "States" columns). One icon, one sentence, one action.
- Props: `{ icon; title; description?; action?; tone?: 'empty'|'error'; framed? }`. Boards: Components, DockBrowser, DockTasks (+ state columns on Dock* boards). Replaces `components/ui/EmptyState.tsx`. Dups: `widgets/WidgetHost.tsx` `EmptyState`, `shared/FileExplorer.tsx` `FileExplorerEmptyState`. Phase P3. Mobile: empty state (same contract).

**P-42 Link** — `muted` (breadcrumbs, `text-fg-3`, hover `text-fg`, no underline), `default` (`text-fg`, underline on hover), `external` (trailing 12 icon, `rel`). Router via `render`. Boards: breadcrumb links on 38 boards; row title links (ChatsList). Phase P3. Mobile: platform-native.

**P-43 Table** (`Table`, `TableHeader`, `TableHeadCell`, `TableRow`, `TableCell`)
- Spec: container 1px `border-line-soft`, `rounded-card`, overflow hidden. Header 32h (`h-control-lg`), `text-small` 500 `text-fg-3`, gap 16, pad-x 20 (16 compact tables, 12 in cards), border-b `line-soft`; sortable head cells show a 12 chevron + `aria-sort`. Row 44h (`h-row`), gap 16, same pad-x, border-b `line-soft` (none on last), `text-ui`; hover `bg-hover`, selected `bg-selected`; sizes `dense` 28/30h (run-dialog stages, package tables; header 24–26h `text-micro`) and `lg` 56h (two-line rows). Cells: fixed `width`, `grow`, `align="end"`, `mono` (`font-mono text-micro text-fg-3`), truncate. Checkbox column 14. Trailing actions cell (ib-sm) visible on row hover/selection/focus-within. Layout is CSS grid from column widths (div + ARIA `role="table|row|columnheader|cell"`) so TanStack Virtual can virtualise rows.
- Base UI: none. Boards: `.th` 24/18, `.tr` 70/10, plus custom rows (Home, SettingsSecurity, WorkflowRunDialog). Replaces `ui/primitives/table.tsx`, `components/data/EntityListRow.tsx`. Phase P3. Mobile: chat list row / flat list (platform-native).

**P-44 InlineCode** — `font-mono text-small` (11 in dense text), pad 1 4, `rounded-badge`, `bg-selected`, colour inherits. Boards: 37/18. Phase P4. Mobile: same contract.

**P-45 Collapsible** (`Collapsible`, `Accordion`)
- Triggers: `disclosure` (24h, no chrome, `text-ui text-fg-3`, leading icon, chevron — "Thought for 12s", "6 steps · 2m 44s"); `attached` (full-width Button `rounded-card` top corners + panel `bg-sunken border-line-soft` bottom corners — "Pair a new device"); `section` (section header + chevron). Base UI: `Collapsible`, `Accordion`. Boards: `aria-expanded` 99 on 17 boards; disclosure rows on 13 chat boards. Replaces `components/workflow/CollapsibleSection.tsx` (re-exported from `ui/index.ts`), `settings/shared.tsx` `CatalogAccordionRow`. Phase P4. Mobile: expand-in-place tool block.

**P-46 Slider** — Base UI `Slider` with optional tick labels; used by the Changes checkpoint scrubber (34h with turn ticks, `aria-valuetext="Turn 3 of 4"`) and the Computer replay scrubber (20h). Measure track/thumb from DockChanges/ChatComputer at build time (thumb 12 circle `bg-fg` with 2px `surface` ring, track `bg-line`, filled part `bg-fg-2`). Boards: 2/2. Replaces `diff/CheckpointTimeline` scrubber markup. Phase P4. Mobile: platform-native slider.

**P-47 Toolbar** — Base UI `Toolbar` (roving focus, `role="toolbar"`): `Toolbar`, `Toolbar.Group`, `Toolbar.Separator` (1×20 `bg-line-soft`, margin 0 6), buttons via `render={<Button/>}`. Boards: ChatsList bulk bar (explicit), composer toolbars and dock panel toolbars (implicit). Replaces `components/layout/Toolbar.tsx` (layout helper; its page-toolbar role goes to C-04). Phase P3. Mobile: platform-native.

**P-48 Card** (`Card`, `Card.Header`, `Card.Body`, `Card.Section`)
- Spec: `bg-raised`, 1px `border-line-soft`, `rounded-card`. Header 40h, pad 0 14 (0 8 0 14 with an action), border-b `line-soft`, title `text-ui` 600, meta `font-mono text-micro text-fg-3 ml-auto` or ghost sm action. Body pad 12 14 (12 or 16 variants). Sections stack with `border-line-soft` dividers. `selected` = `border-line-strong`.
- Boards: `.card` 65/24. Replaces `components/ui/Card.tsx`, `settings/shared.tsx` `SettingsCard`. Dups: `pages/AgentEditorPage.tsx` `SectionCard`, `agents/EffectiveCapabilitiesPanel.tsx` `Section`. Phase P5. Mobile: inset grouped list (iOS) / card.

---

## 3. Patterns (C-xx) — `ui/patterns/`

Generic composites; they take data as props and never fetch. 35 patterns.

| ID | Pattern | Anatomy & dimensions | Props sketch | Boards (count) | Replaces / dups | Phase | Mobile |
|---|---|---|---|---|---|---|---|
| C-01 | **PageHeader** | 44h (`h-bar`), pad 0 10 0 16, gap 10, border-b `line-soft`, `flex-shrink-0`; slots: `breadcrumb` (C-02) or plain title (`text-ui` 600), `status` (P-06), `meta` (chips, "Unsaved changes" `text-small text-fg-3`, mono timestamps), spacer, `actions` (buttons, ib, separators), `dockToggle` (ib `pressed` = dock open). Optional second row 38h (run header: permission menu, budget meter, gauge, trigger text) via `subbar`. It is the macOS drag region (S-07). | `{breadcrumb?, title?, status?, meta?, actions?, dockToggle?, subbar?}` | 47/46 | `ui/PageHeader.tsx` (15), `layout/Breadcrumb` (in part), `layout/Header.tsx` (retired per route, D-21), `workflow/redesign/RunHeaderBar.tsx` | P3 | Header (top-level / detail) |
| C-02 | **Breadcrumb** | `text-ui`; ancestors P-42 muted links, separators "/" `text-fg-3`, gap 6; current item 600 `text-fg`, truncates first; optional mono segment (`Run #248`) | `{items: {label, render?}[]}` | 43 separators / 38 | `layout/Breadcrumb.tsx` | P3 | Header breadcrumb |
| C-03 | **PageTitle** | 32h row, gap 10: H1 `text-heading` 600 (−0.01em), count `font-mono text-small text-fg-3`, optional description `text-small text-fg-3`, spacer, actions (secondary + one primary with shortcut). Detail variant: H1 lh 1.3 + description `text-ui text-fg-2` + meta line `font-mono text-micro text-fg-3` with "·" separators | `{title, count?, description?, meta?, actions?, variant?: 'list'\|'detail'}` | H1 31/31 | `ui/PageHeader.tsx` title part | P3 | Large title |
| C-04 | **FilterBar** | row gap 8: P-14 SearchInput (sm, 240–264) · P-25 Segmented scope with counts · filter chips (P-09 dropdown) · spacer · sort (ghost chip / ghost sm button with icon) · view toggle (icon-only segmented). Container < 900px: chips collapse into one "Filters" dropdown chip | `{search, scope?, filters?, sort?, view?}` | 12 list/detail boards | `layout/Toolbar.tsx`, `data/FilterTabs.tsx`, `ui/SearchInput.tsx` compositions | P3 | Search field + segment |
| C-05 | **DataTable** | P-43 Table + column defs (`width`, `align`, `mono`, `hideBelow` container width, `sortable`), optional checkbox column with select-all (mixed), row click / link title, trailing row actions (ib-sm + P-30 menu), empty (P-41 framed), loading (3–8 skeleton rows 44h: 24 block + 8h/6h lines), footer note ("Showing 12 of 48 · Scroll to load more" `text-small text-fg-3`). `virtualized` uses TanStack Virtual inside P-36 | `{columns, rows, getRowId, selection?, onSelectionChange?, sort?, rowActions?, virtualized?, loading?, empty?}` | `.th`/`.tr` 94/18 | `data/EntityListRow.tsx`, per-page tables (`ChatsListPage` `ChatCard`, `AutomationDetailPage` `ExecutionRow`/`IterationRow`, `WorkflowDefinitionPage` `RunRow`, `PullRequestPage` `PrFileRow`) | P3 | Flat list |
| C-06 | **BulkActionBar** | floating, `absolute bottom-20 left-1/2 -translate-x-1/2`, 40h, pad 0 6 0 12, gap 4, `bg-overlay border-line rounded-card shadow-pop`; "N selected" (mono N) · separator · ghost sm actions (danger-ghost for delete) · separator · "Select all N" · "Clear Esc". Built on P-47 | `{count, total, actions, onSelectAll, onClear}` | ChatsList | — | P3 | Selection toolbar |
| C-07 | **EntityRow** | list row outside tables: 16 icon · two-line text (title `text-ui` 500 / sub `text-small text-fg-3`, lh 1.3–1.35) · meta · trailing actions; heights 36 (compact card lists), 44, 56. Variant `nav` (master-detail list item: pad 8 10, `rounded-control`, selected `bg-selected`, sub-line indented 22) | `{icon?, title, subtitle?, meta?, actions?, selected?, variant?: 'row'\|'nav', height?}` | SettingsSecurity, Scripts, AutomationDetail, Home | `settings/shared.tsx` `InfoRow`, `chat/sources/*` `SourceRow`/`MountRow`, `DirectoryBrowser` `RowButton` | P5 | List row |
| C-08 | **ActivityRow** | 44h (or 56h two-line with actions), pad 0 10 0 14, gap 12, border-b `line-soft`: status glyph · title (fixed 184 or grow, 500) · context `font-mono text-micro text-fg-3` (116) · live text `text-small text-fg-2` (grow, may contain InlineCode/DiffStat) · timer `font-mono text-micro text-fg-3` (40, right) · one ib-sm action or 2 sm buttons | `{status, title, context?, detail?, time?, actions?, twoLine?}` | Home, DesktopWindows (TwoLineRow44 132/38 incl. tables) | `dashboard/ActivityPanel.tsx` `ActivityRow` | P5 | Chat list row |
| C-09 | **EntityCard / CardGrid** | grid `repeat(3, minmax(0,1fr))` gap 12; card = P-48 pad 16 gap 12: header (Avatar 32/AgentGlyph · title `text-body` 600 · badge · ib-sm actions), description `text-ui text-fg-2` clamped to 2 lines (38h), mono meta line, footer (border-t, scope text, tag chips sm, version) | `{title, leading?, badge?, description?, meta?, footer?, actions?, selected?}` | Agents (6), WorkflowNew templates | `data/EntityCard.tsx`, `workflow/WorkflowCard.tsx` (grid part) | P5 | Grid → list on phone |
| C-10 | **StatStrip / StatTile** | strip: P-48 card, flex, tiles `flex-1` pad 12 20, divided by `border-l line-soft`; tile: value `text-heading` 600 (mono when numeric; tone colour for Needs you/Running), label `text-small text-fg-3`, gap 2. Grid form (Home "This week"): 2×2 tiles pad 12 14, value mono 20 lh 1.2, tiles may be links | `{items: {value, label, tone?, href?}[], layout?: 'strip'\|'grid'}` | StatValue20 22/6 + Workflows | `ui/StatCard.tsx`, `dashboard/HealthStatCard.tsx` | P5 | Summary tiles |
| C-11 | **KeyValueList** | rows 28–32h (or auto with min 20 for wrapping), gap 8–12: label fixed width (92/100/108/110) `text-small text-fg-3`, value `text-ui` or mono, optional trailing mono meta; optional inline meter row | `{items: {label, value, meta?}[], labelWidth?, dense?}` | 73/13 (WorkflowRunDialog 14, DesktopWindows 7, Home 6, WorkflowDetail 6) | `dashboard/SystemHealthCard.tsx` `HealthRow`, `shared/ModelPicker.tsx` `DetailRow`, `settings/shared.tsx` `InfoRow` | P5 | Key-value rows |
| C-12 | **SectionHeader** | `label`: 28h (24 dense), pad 0 8, gap 6, `text-small` 500 `text-fg-3` + Count (`.sec`, sidebar/menus). `title`: 24h, `text-ui` 600 (h2/h3) + Count or hint + spacer + ghost sm action (Home, Security). `form`: `text-title` 600 + baseline hint (C-14) | `{title, count?, hint?, action?, variant?: 'label'\|'title'\|'form'}` | `.sec` 87/37, h2-13 30/8, h2-16 55/13 | `settings/shared.tsx` `SectionHeader`/`SectionListHeader`, `diff/FilesSurface.tsx` `MountSectionHeader` | P3 | Section header |
| C-13 | **SettingsSection / SettingRow / SettingsTable** (recipe for all 15 sections, D-32) | Section: title `text-title` 600 lh 1.45 + description `text-small text-fg-3`, gap 2, margin-bottom 8, right padding 40 (clears the close button). Row: flex, gap 24, pad 12 0, border-b `line-soft` (none on last): left (label `text-ui` 500 + P-16 hint), right control (Segmented, Switch, Select, swatches) `flex-shrink-0`; `stacked` rows put a grid below (theme tiles). Group heading: C-12 `title` 24h + action. SettingsTable: P-48 card + dense P-43 (header 28h, rows 36/44h) with row actions. Two-column layouts (main + 264 side column, gap 20). Footer status bar 40h: icon + "Changes apply instantly" / "Saved on this device" | `SettingsSection{title, description}`, `SettingRow{label, hint?, control, stacked?}`, `SettingsTable{columns, rows}` | SettingsAppearance, SettingsSecurity | `components/settings/shared.tsx` (`SectionHeader`, `SettingRow`, `InfoRow`, `SettingsCard`, `SectionListHeader`, `CatalogAccordionRow`) | P6 | Settings form rows (MSet* boards) |
| C-14 | **FormSection** | section pad 16 0, border-t `line-soft` (not on first), gap 12; header: h2 `text-title` 600 + baseline hint (`.hint`); body: fields in 1–4 column grids (gap 12/16) | `{title, hint?, children, first?}` | ChatCreate* (6 each), AgentEditor, AutomationCreate | `pages/AgentEditorPage.tsx` `SectionCard`, `workflow/AgentBindingSection.tsx` layout | P5 | Grouped form |
| C-15 | **SummaryAside** | 320 wide, `sticky top-0`, P-48 card: header 40h ("Summary" + hint), sections pad 12 14 each with a `.hint` caption, value lines, mono detail, small icon notes; counts row (mono 13/500 + hint). Must show real computed values only (D-36) | `{title, hint?, sections: {label, content}[]}` | ChatCreate, ChatCreateModel, ChatCreateOrchestrator, AgentEditor | `agents/EffectiveCapabilitiesPanel.tsx` (layout) | P5 | — (content moves inline) |
| C-16 | **ActionBar** (sticky footer) | 56h, pad 0 16 0 20 (0 20 in wizard), gap 8, border-t `line-soft`, `bg-surface`; left hint (KbdHint "Esc to cancel", "Next: …", draft status), spacer, secondary actions, one primary with shortcut (`Ctrl ↵`) | `{hint?, secondary?, primary}` | Footer56 6/6 | per-page footers | P5 | Floating primary action |
| C-17 | **Stepper** (vertical step nav) | 220 wide, pad 20 12, border-r `line-soft`, gap 2; step: pad 8, `rounded-control`, gap 10: marker 20 circle (done = check icon; current = `bg-accent text-on-accent` mono 11; future = 1px `border-line-strong text-fg-3`), title `text-ui` 500 (`text-fg-2` future), subtitle `text-small text-fg-3` truncated (errors in `text-err`); current step `bg-selected` + `aria-current="step"`; bottom note separated by border-t. Body header "Step 2 of 6" `text-small text-fg-3` + h2 | `{steps: {id,title,subtitle?,state}[], current, onSelect}` | AutomationCreate | — (new) | PW | Stepped sheet |
| C-18 | **Inspector** | side panel 400 (360–440), border-l `line-soft`, `bg-surface`: header (title, mono id "`key` · Agent stage · n of 6", ib actions) · P-26 Tabs `density="panel"` (gap 12, pad 0 16) · scroll body of horizontal P-16 fields (label 100) · optional footer | `{title, subtitle?, tabs, actions?, children}` | Inspector-width asides 12/12 (WorkflowBuilder, Stage*×4, SettingsPanel, Validate, LoopBuilder, AgentDraft, WorkflowRun, RunLoop, ProjectCustomization) | `workflow/StagePropertiesPanel.tsx`, `workflow/redesign/RightInspector.tsx` (tab parts) | P5 (ProjectCustomization); PW | Detail sheet |
| C-19 | **DockTabStrip** | 44h, pad 0 8 (0 6 0 8 narrow), gap 2, border-b `line-soft`, `role="tablist"`: tabs are sm Buttons at 28h (`h-control`) with 14 icon + label + Count/dot; active `bg-selected border-transparent text-fg`; inactive ghost; narrow: inactive tabs icon-only (P-03 md); "+" ib-sm opens a P-30 menu ("Open another panel": Widget, extra Browser ≤5, Terminal ≤4, file tabs ≤8); spacer; Maximize ib-sm; Close ib-sm (narrow only); overflow tabs collapse into the "+" menu | `{tabs: {id,label,icon,count?,closable?}[], value, onValueChange, onAdd?, addItems?, onMaximize, onClose?, compact?}` | DockTabStrip 36/18 | `layout/RightPane.tsx` tab strip (`role="tab"`, `role="menu"`) | P4 | Right pane shell tab bar |
| C-20 | **SplitPane** | react-resizable-panels 4: main + dock panel, default 480 (440 runs), min 360, max 60 %; 1px `line-soft` separator with 8px invisible hit area, `cursor-col-resize`, keyboard resizable; `autoSaveId` persistence per page (D-27) | `{id, defaultSize, minSize, maxSize, children: [main, side], collapsed?}` | Main, Chat*, WorkflowRun | `hooks/useResizablePane.ts`, `hooks/useResizable.ts`, ChatPage split state | P4 | — |
| C-21 | **CommandList** | palette list: query row 48h (pad 0 14 0 16, 16 search icon, `text-body` input, result count `text-small text-fg-3` right); listbox pad 4 0 8; group label 28h pad 0 12 `text-small text-fg-3`; option 36h, pad 0 12, margin 0 6, `rounded-control`, gap 12, `text-ui text-fg-2` (highlighted `bg-selected text-fg`), match 600 `text-fg`, trailing context text + Badge/Kbd; footer 32h `bg-raised` border-t: KbdHints "↑↓ Navigate · ↵ Open · Tab Actions · Esc Close". Tab opens an inline action list for the highlighted entity | `{query, onQueryChange, groups, onSelect, onAction?, footerHints}` (P-19 underneath) | CommandPalette (Option 21/3 incl. pickers) | `layout/CommandPalette.tsx` list, `ui/primitives/command.tsx` (deleted in P5 with `SearchableSelect`) | P3 | Search screen |
| C-22 | **MenuButton / SplitButton** | Button (or IconButton "More") + P-30 menu with `aria-haspopup`; `split`: primary part `rounded-l-control` + chevron part pad 0 6, `border-l-0`, `rounded-r-control` (Pause · drain/interrupt) | `{label, items, split?, onPrimary?}` | row "More" menus on 13 boards; split 2/2 | `chat/RewindMenu.tsx` trigger, `layout/Header.tsx` action menus | P3 (split: PW) | Overflow button |
| C-23 | **CodeBlock** | `font-mono text-small` lh 1.5, pad 8 10, `rounded-control`, `bg-sunken`, 1px `border-line-soft`; `tone="err"` text `text-err` (inline tool errors); optional header (language/path + copy ib-sm); highlighted content is supplied by the caller (Shiki block, D-33) | `{children, tone?, header?, copy?: string, wrap?}` | 35/17 | `common/SyntaxHighlightedCode.tsx` chrome (highlighter moves to a block) | P4 | Code block |
| C-24 | **TerminalFrame** | dock terminal chrome without xterm: instance toolbar (40–44h, instance tabs as chips/btn-sm, status, Clear ghost, Kill danger with `bg-err-bg`), body slot `bg-sunken` pad 10 12 (`font-mono text-small` lh 18px), status footer; hosts C-32 FindWidget top-right | `{toolbar, status?, children, find?}` | DockTerminal, ChatTerminal | `terminal/TerminalPanel.tsx` chrome | P4 | Terminal pane |
| C-25 | **StepRail** (timeline) | column with a 1px `bg-line` vertical line at x=9 (top/bottom inset 14); rows 28h (`h-control`), gap 10: 16 glyph (status/tool) · verb 500 · target `font-mono text-fg-2` truncated · result (`text-small` tone text or DiffStat) · duration `font-mono text-micro text-fg-3 ml-auto` · optional chevron; expanded detail indented 24 (CodeBlock) | `{items: {glyph, verb, target?, result?, time?, expandable?}[]}` | StepRow28 58/13 | `agent/StepRow.tsx` layout, `workflow/RunTimeline`, `redesign/StageTimelineItem` layout | P4 | Tool block rows |
| C-26 | **ChoiceCardGrid** | P-23 RadioGroup laid out as a grid of P-24 cards (`grid-cols-3 gap-12`, or flex `1 1 0` gap 10) | `{value, onValueChange, options, columns?}` | ChatCreate "Who works", AutomationCreate trigger, WorkflowNew start | — (new) | P5 | Selection list |
| C-27 | **KbdHintRow** | `text-micro text-fg-3`, gap 14 (12 in boxes); each hint = P-04 + label, gap 4; optional right-aligned status (6px dot + text) | `{hints: {keys, label}[], end?}` | KbdHint 79/23 | composer hint row, dialog footers | P4 | — |
| C-28 | **PairingCodeInput** | `role="group"`: 6 cells 48×52, `rounded-control`, 1px `border-line-strong` (`border-err` invalid), `bg-sunken`, `font-mono` 20/500 centred, gap 8, 12×1 `bg-line-strong` dash between groups of 3; paste fills all; error line below (Field error) | `{value, onValueChange, length?: 6, groups?: 3, invalid?}` (Base UI `Input` per cell) | Pairing | `AuthGate.tsx` code input | P5 | Code entry (platform-native OTP field) |
| C-29 | **Banner** | single-line tinted strip 40h, pad 0 8 0 12, gap 10, `rounded-card`, 1px `border-line`, `bg-{tone}-bg`: icon · bold lead `text-ui` 600 · truncated detail `text-ui text-fg-2` · spacer · sm action (Review). Generic ApprovalBanner for "N need you" | `{tone, lead, detail?, action?}` | ProjectDetail, ProjectCustomization | `workflow/redesign/InlineHitlControls` (layout) | P5 | Inline banner |
| C-30 | **GateCardFrame** | card 1px `border-line`, `rounded-panel`, `bg-raised`, overflow hidden: header 36h (`h-tab`), pad 0 12, gap 8, `bg-warn-bg` (tone), border-b `line-soft`: icon · title 600 · meta `text-small text-fg-3 ml-auto`; body pad 12 gap 8–10; action row: explanation `text-small text-fg-3` truncated · spacer · sm buttons each with its keyboard default (Esc / ↵ / Ctrl ↵) | `{tone?, icon, title, meta?, children, actions: {label, variant, shortcut?}[]}` | ApprovalHeader36 20/14 | layout parts of `chat/PermissionCard.tsx`, `PlanCard.tsx`, `QuestionCard.tsx` (their logic stays F-xx) | P4 | Gate card |
| C-31 | **Dropzone** | 40h row (or larger area), pad 0 8 0 12, gap 8, 1px **dashed** `border-line-strong`, `rounded-card`: icon · "Drop files or" `text-small text-fg-3` · sm "Choose files"; drag-over `bg-hover border-fg-3` | `{onFiles, accept?, multiple?, label?}` | 8/7 | ad-hoc file inputs (`workflow/VariableInputModal.tsx` `UploadSection`) | P5 | Attachment picker |
| C-32 | **FindWidget** | floating `bg-overlay border-line rounded-card shadow-pop`, pad 3 3 3 8, gap 2: search icon · 150-wide mono input (24h) · match count · prev/next/close ib-sm with titles (Shift+Enter / Enter / Escape); `role="search"` | `{query, onQueryChange, matches?, onPrev, onNext, onClose}` | DockTerminal | `layout/FindBar.tsx` visuals | P4 | — |
| C-33 | **DiffStat** | `font-mono text-micro`: `+N` `text-ok`, space, `−N` (U+2212) `text-err`; `—` `text-fg-3` when unknown; optional "N files" | `{added, removed, files?}` | `.c-ok` 135/28, `.c-err` 117/33 | inline `+/-` spans in `ChatChangesTray`, `ChangesSurface`, `ChangesTree` | P4 | Same |
| C-34 | **ListPane** (master list) | 320 aside, border-r `line-soft`: header block pad 16 12 10 16 (H1 20 + count + sm action; SearchInput sm), list pad 0 8 gap 2 of C-07 `nav` rows, spacer, optional neutral Callout at the bottom (margin 12) | `{title, count?, action?, search?, children, footer?}` | Scripts | `pages/ScriptsListPage.tsx` list | P6 (T-05) / PW | List screen |
| C-35 | **ModalForm body** | dialog body recipe: prose Textarea, horizontal Fields (label 64), sections headed by `text-ui` 600 h3 + hint, gap 20 | `{children}` | NewChat | `NewChatModal` layout | P5 | Sheet form |

---

## 4. Shell (S-xx) — `ui/shell/`

Presentational frames; wiring (queries, router, desktop bridge) lives in `app/` (`ConnectedSidebar`, `AppShellRoute`). 13 parts.

**S-01 AppFrame** — `bg-ground` full window, `flex`. Children: optional S-06 TitleStrip (Windows / Linux-custom) above a row of [S-02 Sidebar | S-03 Rail] + S-04 MainCard. Sets `@container/app`. Reads `<html>` classes set by `lib/desktop.ts` (`platform-*`, `desktop-shell`, `custom-titlebar`, `titlebar-overlay`, `titlebar-inset`, `window-fullscreen`, `window-maximized`, `window-blurred`) — never sets them. Collapses the sidebar to the rail when the window is < 1200px or the route asks (`handle.forceRail`, workflow builder) — the decision is passed in as `sidebarMode: 'full'|'rail'` by `app/`. Mounts S-13. Replaces `layout/AppLayout.tsx`. P3.

**S-02 Sidebar** — 232 wide (`w-sidebar`), no border, `bg-ground`, flex column gap 2. Padding: web & Linux-native `10 8 8 8`; macOS `0 8 8 8` (S-07 row first); Windows `4 8 8 8`. Slots in order:
1. `header` — 40h row, pad 0 4 0 6, gap 8: **ServerSwitcher** button (36h, pad 0 6 0 2, `rounded-control`; 22px logo; "GeneratorAI" `text-ui` 600 / "This computer" `text-micro text-fg-3`, lh 1.2; chevron) opening a P-30 menu 280 wide (group label 26h, two-line 40h radio items with status dot + mono address, separator, "Add server…", "Manage servers") + Collapse ib. On Windows the row is logo + "GeneratorAI" + New-chat ib (pad 0 4 0 8, margin-bottom 6) because search and servers move to S-06.
2. `search` — row pad 4 0 8 0, gap 6: **SearchButton** (Button 30h, `bg-surface`, `text-fg-3` 400, icon, "Search", Kbd `Ctrl K`/`⌘K` right) + **NewChat** square button 30×30 `bg-surface`.
3. `nav` — P-27 list, gap 1, from `NAV_DESTINATIONS` (Home, Chats, Projects, Agents, Workflows, Automations, Scripts).
4. `live` — two sections: C-12 label "Needs you" + warn Count (margin-top 14) with P-27 `twoLine` rows; "Running" + Count (margin-top 10) with one-line rows (icon · truncated title · elapsed Count). Rendered only when the attention feed exists (D-36).
5. spacer; 6. `footer` — 44h, pad 8 4 0 10, border-t `line-soft`, margin-top 8: 6px StatusDot · "Connected" `text-small text-fg-2` · address `font-mono text-micro text-fg-3` · Settings ib `ml-auto`.
Replaces `layout/Sidebar.tsx`, `status/ConnectionStatus.tsx` (footer view). P3. Mobile: sidebar drawer (iOS 318pt / Android 336dp, same sections).

**S-03 Rail** — 48 wide, pad 12 0 8 0, gap 2, centred column: server logo button 32 · Expand ib (lg 32) · divider 20×1 `bg-line-soft` (margin 6 0) · Search ib · New chat ib · divider · nav ib lg with `aria-current` (Home carries a 7px warn `ring` dot when something needs you) · divider · Needs-you ib (warn, count bubble) and Running ib (run, count bubble) · spacer · 6px connection dot · Settings ib. Every icon has a tooltip. macOS: top 44px is an empty drag region (S-07) and the main card header gets `--gai-page-inset-left: max(0, 78 − 48 − 0)` = 30px (D-23, `06-desktop-and-shell.md` §3.5). P3.

**S-04 MainCard** — `flex-1 min-w-0`, margin `8 8 8 0` (Windows/Linux-custom: `0 8 8 0` under the strip), `bg-surface`, 1px `border-line-soft`, `rounded-panel`, overflow hidden, `position: relative` (sheet/bulk-bar containing block), `@container/main`. Children: S-05 then the route. P3.

**S-05 PageHeaderSlot / LegacyHeaderSlot** — the route renders its own C-01 PageHeader as the first child of the main card. Routes with `handle: { legacyHeader: true }` get the old `layout/Header.tsx` rendered inside the card instead (D-21); `app/` decides, the slot only reserves the 44px position and applies the title-bar insets (`padding-inline-start: max(16px, var(--gai-page-inset-left, 0px))` when the header is the first row under macOS lights in rail mode, `06-desktop-and-shell.md` §3.5). P3; the legacy branch is deleted in P7.

**S-06 TitleStrip** (Windows, and Linux with `GENERATORAI_LINUX_CUSTOM_TITLEBAR=1`) — 36h full width, `bg-ground`, pad-left 8, `.app-drag-region` (children get `no-drag` from the existing CSS rule). Left: Back, Forward (ib-sm), Toggle sidebar (ib-sm, margin-left 4). Centre: search Button 420×26 absolutely centred (`bg-surface`, `text-small text-fg-3`, Kbd). Right: "Restart to update" pill (Button sm 26h, `bg-run-bg text-run`, only when an update is ready), server chip (Button sm 26h `pressed`, 6px dot + name + chevron → the Servers menu), then a reserved 138px (3 × 46×36) caption-button area painted by WCO — width taken from `navigator.windowControlsOverlay` geometry (`--gai-titlebar-inset-right`, renamed in P3-04), not hard-coded. Height from `CHROME.strip.height` (36, D-23; `platform.ts` `TITLE_BAR_HEIGHT = 40` moves to that constant). Linux native frame: no strip; back/forward and the update pill move into S-02's header row; plain web uses the same layout. Replaces `layout/TitleBar.tsx`. P3.

**S-07 MacTrafficLightRow** — 44h row at the top of S-02, pad-left 8, `.app-drag-region`, `aria-hidden`, empty (the OS draws the lights; `trafficLightPosition` centred in 44 from `CHROME.mac`). The main card's C-01 header is also a drag region on macOS. In rail mode the rail's top 44px is the drag region (lights end at x≈78). `window-fullscreen` removes the row. P3.

**S-08 DockFrame** — right dock inside the main card via C-20 SplitPane: `aside` border-l `line-soft`, `bg-surface`, flex column: C-19 DockTabStrip · panel toolbar slot (40–44h) · body · optional sticky footer (commit bar: border-t, pad 10 12, gap 8). Inactive panels stay mounted with `visibility:hidden` (not `display:none`; `NativeBrowserView.isContainerHidden()` relies on it). Maximize hides the main column. Chat and workflow-run pages only (D-27). Replaces `layout/RightPane.tsx`. P4.

**S-09 NarrowDockSheet** — below 1200px window width the dock becomes a P-33 Sheet inside the main card: `absolute top-44 right-0 bottom-0 w-[380px]`, `bg-overlay`, border-l `line`, `shadow-pop`, `role="dialog"`, non-modal, carries `data-gai-overlay` and is exempted as an ancestor by D-19; the main column adds right padding 404 (380 + 24) so content is not hidden; the tab strip switches to compact (icon-only inactive tabs + Close). The header drops the branch chip. P4.

**S-10 CommandPaletteFrame** — P-31 Dialog `md` (640), `placement="top"` (120px at 900h), backdrop `bg-scrim`, hosting C-21 CommandList. `data-gai-overlay`. Replaces `layout/CommandPalette.tsx` (cmdk). P3 (P3-05).

**S-11 SettingsModalFrame** — P-31 Dialog `lg` 960×640, flex: left nav 220 (`bg-raised`, border-r `line-soft`, pad 12 8, gap 1; SearchInput sm 30h with `/` kbd, margin-bottom 10; C-12 `label` group headings 24h (margin-top 8); P-27 `dense` 28h items) + content (close ib absolute top 14 right 14; scroll body pad 20 28 0; C-13 recipe; footer status bar 40h pad 0 28 border-t). Route-addressed (`/settings/:section?`, background location, D-26) — the frame only renders. Replaces `pages/SettingsPage.tsx` layout, `settingsUiStore` page navigation. P6.

**S-12 FindBarFrame** — desktop Cmd/Ctrl+F: C-32 FindWidget anchored top-right of the main card (below the header, right 8). Replaces `layout/FindBar.tsx` visuals (behaviour and IPC stay in `app/`). P4.

**S-13 ToasterRegion** — P-34 `<Toaster />` mounted by S-01, bottom-right 16px inside the window (above the Windows strip region rules), `data-gai-overlay`. P3.

---

## 5. Templates (T-xx) and page-local layouts (L-xx)

Templates are slot-only components in `ui/templates/`. Page-local layouts live with their feature (they have one consumer) but follow the same slot discipline. Responsive rules use container queries on `@container/main` (the main card), not the viewport; the two reference windows are 1440 (main card ≈ 1192 with sidebar) and 1100 (rail → main card ≈ 1036).

**T-01 ListPage** — slots `header` (C-01, usually plain title + More ib), `title` (C-03 list), `stats?` (C-10 strip), `filters` (C-04), `content` (C-05 DataTable or C-09 grid), `footer?` (note), `overlay?` (C-06). Body pad 24 28, gap 16; content scrolls inside the body (header and title stay). 1100: table columns with `hideBelow` drop (e.g. ChatsList Project/Changes) so the title column keeps ≥ 240; filter chips collapse into "Filters"; grids go 3 → 2 columns below 900. Boards: ChatsList, Projects, Agents, Workflows (PW), Automations (PW). Phase P3.

**T-02 DetailPage** — slots `header` (C-01 with breadcrumb + actions), `title` (C-03 detail), `banner?` (C-29), `tabs?` (P-26), `content`, `rail?` (360 column of P-48 cards pad 12 gap 10) or `inspector?` (C-18 400). Body pad 24 28 gap 16 (tabs margin-top 4). 1100: `rail` stacks under the content when the card is < 960; `inspector` becomes collapsible (header toggle). Boards: ProjectDetail, ProjectCustomization (+400 inspector), CodebaseDetail, AutomationDetail (PW), WorkflowDetail (PW); PullRequestPage (D-31). Phase P5.

**T-03 FormWithAside** — slots `header` (breadcrumb + route hint), `form` (C-14 sections), `aside?` (C-15, sticky), `actions` (C-16). Scroll body: `flex justify-center gap-48 pad 24 28 0`; form column 720 (`min(720px,100%)`), aside 320. 1100 (card ≈ 1036 < 1150 needed): gap 32 and the form column becomes fluid (min 560); below 960 the aside collapses into a "Summary" disclosure (P-45) above the ActionBar. Boards: ChatCreate, ChatCreateModel, ChatCreateOrchestrator, AgentEditor; WorkflowNew (no aside, PW); CreateProjectPage (D-32). Phase P5.

**T-04 Workspace** — slots `header` (C-01 + dockToggle), `main` (transcript / timeline, pad 20 28 0, gap 18; `max-width 860` centred when the dock is closed), `bottom?` (composer / stage composer, pad 12 28 10), `dock?` (S-08, 480 or 440 on runs). Below 1200px window: dock → S-09 sheet, main right padding 404, header drops chips. Boards: Main, ChatBrowser, ChatComputer, ChatFiles, ChatLight, ChatNarrow, ChatPlan, ChatTasks, ChatTerminal, ChatWorkflowRun, ComposerModelPicker, AgentPickerBoard, DesktopMac, WorkflowRun (PW), WorkflowRunLoop (PW). Phase P4.

**T-05 MasterDetail** — slots `list` (C-34, 320) and `detail` (scroll, pad 24 28, gap 20). 1100: list 260 below a 900 card. The Settings modal uses the same layout component with `listWidth={220}` inside S-11. Boards: Scripts (PW), SettingsAppearance/SettingsSecurity (variant). Phase P6.

**L-01 Dashboard (Home)** — header (plain title + actions), body pad 24 28; centred `max-width 1040`, flex gap 24: left column (grow, gap 20: date line mono 12 + display title 28/600 −0.02em; quick-start composer block; sections "Needs you" (C-12 title + 56h two-line C-08 rows in a bordered r8 list), "Running", "Recently finished") and right column 300 (gap 16, pad-top 6: StatStrip grid card, System KeyValue card with Meter, link card of P-27 rows). 1100: fits (left ≈ 664); below 900 the right column stacks under. Boards: Home, DesktopWindows. Phase P5.

**L-02 Wizard** — header (breadcrumb + Draft badge + "Draft saved" + Cancel), body flex: C-17 Stepper 220 + section (scroll pad 28 40, content `max-width 640` gap 22) + C-16 ActionBar (Back · next hint · Save draft · Continue). Board: AutomationCreate. Phase PW.

**L-03 Gate** — full window `bg-ground` (no sidebar), centred column gap 16: card 420, pad 28, gap 20, `bg-surface`, 1px `border-line-soft`, `rounded-dialog`; below it a 420 note `text-small text-fg-3` lh 1.6. Used by Pairing (logo 28, H1 20, Field + C-28, lg primary full width, "or" divider, QR link) and by 404 / route error / page error boundary (D-32: icon, title, one sentence, the real error in C-23, Retry / Go home). Phase P3 (NotFound + RouteError in P3-04, which inside the shell render in the main card per `04-screen-map.md` R-6; C-23 arrives in P4, so P3 shows the error as plain `font-mono text-small` text); Pairing reuses it in P5.

**L-04 CanvasEditor** — forced S-03 rail; header (breadcrumb, Published badge, "Unsaved changes", undo/redo/history, separator, Save/Validate/Publish/Run, More, inspector toggle); body flex: canvas section (`bg-sunken` with `radial-gradient(var(--gai-line) 1px, transparent 1px)` 16px dot grid, floating zoom controls, minimap 168×104 bottom-right 12 `bg-raised border-line-soft rounded-card`) + C-18 Inspector 400; optional problems panel. Boards: WorkflowBuilder, WorkflowStagePrompt/Model/Tools/Hooks, WorkflowSettingsPanel, WorkflowValidate, WorkflowLoopBuilder, WorkflowAgentDraft. Phase PW.

**L-05 ModalWithAside** — P-31 Dialog `xl` (1040×856, clamped): header 48 (title 16/600 + badge + close), body flex: main (scroll, pad 14 22 20 20, sections headed 20h `text-ui` 600 + hint) + aside 360 (`bg-sunken`, border-l `line-soft`, pad 18, gap 14: read-only preview, KeyValue, warnings Callout), footer 56 (explanation, Cancel ghost, secondary, primary `lg` with `Ctrl ↵`). 1100: dialog clamps to `100vw − 64`; aside 300 below a 1000 dialog. Board: WorkflowRunDialog. Phase PW.

---

## 6. Rosetta table — board markup → kit

Use this when translating a board. Left: what the board contains (class or inline signature). Right: what to write. Inline `style` values not listed here are layout (gap, width, margin) and become Tailwind layout utilities on the caller.

### 6.1 Shared classes
| Board markup | Kit |
|---|---|
| `.btn` | `<Button>` (secondary, md) |
| `.btn.btn-p` / `.btn-g` / `.btn-d` / `.btn-g.btn-d` | `variant="primary"` / `"ghost"` / `"danger"` / `"danger-ghost"` |
| `.btn-sm` / `.btn-lg` | `size="sm"` / `size="lg"` |
| `.btn` containing `.kbd` | `<Button shortcut={['Ctrl','↵']}>` (Kbd auto `onAccent` on primary) |
| `.btn` with inline `background: var(--selected); border-color: transparent` | `<Button pressed>` |
| `.btn` 30h `background: var(--surface)`, "Search", kbd | S-02 `SearchButton` (420×26 variant in S-06) |
| `.btn.btn-sm` 26h `background: var(--run-bg); color: var(--run)` | S-06 update pill |
| `.ib` / `.ib.ib-sm` / `.ib` 32px | `<IconButton size="md" / "sm" / "lg" label="…">` |
| `.ib.on` | `<IconButton pressed>` |
| `.ib` with `background: var(--accent)` r8 | `<IconButton variant="primary">` (Send / Start chat) |
| `.ib` 18×18 r4 inside `.chip` | `<Chip onRemove removeLabel>` |
| `.kbd` / kbd with `border-color: currentColor` | `<Kbd keys>` / `<Kbd onAccent>` |
| `.bdg.s-run/.s-ok/.s-warn/.s-err/.s-idle` + status word | `<StatusBadge state="running\|succeeded\|needs-you\|failed\|queued\|paused\|waiting\|skipped" context?>` |
| `.bdg.s-idle` "Draft", "Agent", "Worker", "Published v7" | `<Badge tone="neutral" suffix={<mono>v7</mono>}>` |
| `.bdg.s-warn` with a number | `<Badge tone="warn" icon="hand">1</Badge>` |
| `.dot` + `background: var(--x)` / 6px / 7px + ground ring | `<StatusDot state\|tone>` / `size="sm"` / `ring` |
| `.chip` / `.chip.mono` / `border-color: transparent` | `<Chip>` / `<Chip mono>` / `<Chip variant="ghost">` |
| `.chip` + trailing chevron | `<Chip dropdown render={<button/>}>` inside `<Menu>` or `<Select>` trigger |
| `.chip` "+3" in `fg-3` | `<ChipList max>` overflow chip |
| `label.chip` with `.cb` inside | `<Chip pressed size="sm">` with embedded `<Checkbox size="sm">` |
| `.av` (18/20/24/32) | `<Avatar name size>` (workflow surfaces: `<AgentGlyph>`) |
| `.inp` (`input`) / `.inp.mono` / red border + `.hint` in err | `<Input>` / `<Input mono>` / `<Field error>` |
| `.inp` with search icon + `.kbd` "/" | `<SearchInput size="sm\|md">` |
| `button.inp` with value + meta + chevron | `<Select>` (searchable → `<Combobox>`) |
| `.inp` height ≥ 64 / `role="textbox" aria-multiline` 96–112h | `<Textarea>` / `<Textarea variant="prose" footer>` |
| `.inp` numeric mono with unit | `<NumberField unit>` |
| `.lbl` + control + `.hint` | `<Field label hint>` |
| `.cb` / `.cb.on` / `aria-checked="mixed"` | `<Checkbox>` / `checked` / `indeterminate` |
| `.sw` / `.sw.on` | `<Switch>` / `checked` |
| `.seg` with `button.on` | `<SegmentedControl semantics="radio\|tabs">` |
| `.seg` of icon-only buttons "List view / Grid view" | `<SegmentedControl items=[{icon,label}]>` (view toggle) |
| `.tabs` + `.tab` / `.tab.on` | `<Tabs>` (`density="panel"` when gap 12) |
| `.nav` / `.nav.on` / `.nav` 44h with `.dot` | `<NavItem>` / `active` / `twoLine dot` |
| `.cnt` | `<Count>` |
| `.sec` | `<SectionHeader variant="label">` |
| `.card` | `<Card>` |
| `.th` / `.tr` | `<DataTable>` (or `<Table>` parts) |
| `.mono`, `.trunc` | `font-mono text-small`, `truncate min-w-0` (classes, not components) |
| `.c-1/.c-2/.c-3`, `.c-run/.c-ok/.c-warn/.c-err` | `text-fg`, `text-fg-2`, `text-fg-3`, `text-run` … |
| `svg.i` / `.i12` / `.i14` / `.i16` / `.i20` | `<Icon name size={16\|12\|14\|16\|20}>` |
| `.app`, `.t-dark`, `.t-light`, `.acc-*` | nothing — ThemeProvider sets `<html>` attributes (D-25) |

### 6.2 Recurring inline patterns
| Board markup (signature) | Kit |
|---|---|
| `<header>` 44h, border-b line-soft, breadcrumb/title + actions | `<PageHeader>` (C-01) |
| `<a>` fg-3 + `<span>/</span>` + 600 span | `<Breadcrumb items>` (C-02) |
| H1 20/600 + mono count + primary button, 32h row | `<PageTitle>` (C-03) |
| search inp + `.seg` counts + `.chip` filters + sort | `<FilterBar>` (C-04) |
| `role="toolbar"` floating overlay bar "N selected" | `<BulkActionBar>` (C-06) |
| overlay r8 pad 4 box with 30h items r5 | `<Menu>` (P-30) |
| 28h / 26h `fg-3` 12px row at top of a menu | `<Menu.GroupLabel>` |
| `height:1px; margin:4px 0; background: var(--line-soft)` | `<Menu.Separator>` / `<Separator>` |
| menu item in `color: var(--err)` | `<Menu.Item danger>` |
| `menuitemradio` 40h two-line (server) | `<Menu.RadioItem description>` |
| `menuitemcheckbox` | `<Menu.CheckboxItem>` |
| row item with right chevron | `<Menu.SubmenuTrigger>` |
| overlay 28h / pad 4 8, 12px, optional kbd, tiny rotated square | `<Tooltip shortcut>` (P-28) |
| overlay r8 pad 12, title 13/600 + text + Cancel/danger | `<Popover>` ConfirmPopover recipe |
| `var(--scrim)` + overlay r12 box | `<Dialog size>` (P-31); header 48 / footer 56 → `Dialog.Header` / `Dialog.Footer` |
| `aside role="dialog"` 380 absolute right | S-09 NarrowDockSheet |
| pad 10 12, r8, border line, `--*-bg` background | `<Callout tone>` (P-40) |
| 40h tinted strip with bold lead + Review button | `<Banner>` (C-29) |
| card r10 with 36h `warn-bg` header and kbd-default buttons | `<GateCardFrame>` (C-30) |
| radio-card `button`/`label` r8 with 14px circle indicator | `<RadioCard>` in `<RadioGroup>` / `<ChoiceCardGrid>` |
| 14px circle, 4px accent border | `<Radio>` |
| 20px accent circles in a radiogroup | `<RadioGroup variant="swatch">` |
| 96h theme tile with SVG preview | `<RadioCard variant="tile" preview>` |
| 4h r2 bar `--selected` + fill | `<ProgressBar>` / `<Meter>` (P-38) |
| 14px SVG circle r6 + arc + "42%" | `<Gauge>` (P-39) |
| 28h rows + absolute 1px line at left 9 | `<StepRail>` (C-25) |
| "Thought for 12s" 24h chromeless button | `<Collapsible>` `disclosure` trigger |
| mono, `--sunken`, pad 8 10, r6, border line-soft | `<CodeBlock>` (C-23) |
| mono 12, pad 1 4, r4, `--selected` | `<InlineCode>` |
| `c-ok "+14"` + `c-err "−6"` | `<DiffStat added removed>` (C-33) |
| `<span><span class="kbd">↵</span>Send</span>` row, 11px fg-3 | `<KbdHintRow>` (C-27) |
| centred icon + 13/600 title + 12px text + one button | `<EmptyState>` (P-41) |
| rows of `--selected` bars 8h/6h, `aria-busy` | `<Skeleton>` / DataTable `loading` |
| label (width 92–110, 12px fg-3) + value rows | `<KeyValueList>` (C-11) |
| card of flex tiles: 20/600 value + 12px label | `<StatStrip>` (C-10) |
| 44/56h rows: glyph · title · mono project · live text · timer · ib | `<ActivityRow>` (C-08) |
| icon + two-line (500 name / 12px fg-3) cell | `<EntityRow>` / DataTable cell renderer (C-07) |
| 3-column grid of `.card` pad 16 with avatar header | `<CardGrid>` + `<EntityCard>` (C-09) |
| `role="tablist" aria-label="Side dock"` 44h of btn-sm tabs | `<DockTabStrip>` (C-19) |
| `aside` 400 with `.tabs` and form rows | `<Inspector>` (C-18) |
| 220 nav with numbered circles + "Step 2 of 6" | `<Stepper>` (C-17) |
| `<footer>` 56h with Esc hint and primary `Ctrl ↵` | `<ActionBar>` (C-16) |
| 320 sticky card "Summary" with captioned sections | `<SummaryAside>` (C-15) |
| h2 16/600 + `.hint` baseline, border-t sections | `<FormSection>` (C-14) |
| flex row gap 24 pad 12 0 border-b: label 13/500 + hint · control | `<SettingRow>` (C-13) |
| six 48×52 mono cells with a dash | `<PairingCodeInput>` (C-28) |
| 1px dashed border row "Drop files or Choose files" | `<Dropzone>` (C-31) |
| two buttons joined (`border-radius: 6px 0 0 6px`) | `<MenuButton split>` (C-22) |
| overlay search box with prev/next/close ib-sm | `<FindWidget>` (C-32) |
| `width:1px; height:16–20px; background: var(--line…)` | `<Separator orientation="vertical">` |
| `role="slider"` scrubbers | `<Slider>` (P-46) |
| `role="group"` of ib/btn toolbars, floating | `<Toolbar>` (P-47) |
| sunken canvas with 16px radial dot grid | L-04 canvas surface |
| user bubble, agent header, tool rows content, composer, model/agent pickers, diff lines, file trees | **domain** (B-xx/F-xx) built from the parts above |

---

## 7. Board × component usage matrix

Counts are occurrences on each board (`·` = none). Column key: Btn `.btn` · IB `.ib` · Kbd · Bdg `.bdg` · Dot · Chip · Av `.av` · Inp `.inp` · Lbl `.lbl` · CB `.cb` · SW `.sw` · Rad `role=radio` · Seg `.seg` · Tab `.tabs` · Dock dock tab strips · Menu menu items · Dlg `role=dialog` · Pop floating layers (`--shadow-pop`) · Call callouts · Card `.card` · Tbl `.th`+`.tr` · Nav `.nav` (≈12 per board is the sidebar) · Sec `.sec` · Ring context gauge · Step 28h step rows · KV key-value labels · PH 44px page headers · Code code blocks.

| Board | Btn | IB | Kbd | Bdg | Dot | Chip | Av | Inp | Lbl | CB | SW | Rad | Seg | Tab | Dock | Menu | Dlg | Pop | Call | Card | Tbl | Nav | Sec | Ring | Step | KV | PH | Code |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AgentEditor | 5 | 4 | 2 | 3 | 7 | 4 | 2 | 8 | 13 | 9 | 1 | · | 12 | · | · | · | · | · | · | 2 | · | 12 | 2 | · | · | · | 1 | 1 |
| AgentPickerBoard | 1 | 2 | 3 | 13 | · | · | 12 | 2 | 1 | · | 17 | · | 1 | · | · | · | · | 1 | · | 1 | · | · | · | · | · | 4 | · | · |
| Agents | 4 | 11 | 2 | 7 | 3 | 8 | 6 | 1 | · | · | · | · | 1 | · | · | · | · | · | · | 6 | · | 12 | 2 | · | · | · | 1 | · |
| Audit | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 8 | · | · | · | · | · | · | · | · |
| AutomationCreate | 6 | 2 | 1 | 1 | 3 | · | · | 3 | 6 | · | · | · | 3 | · | · | · | · | · | 1 | · | · | 12 | 2 | · | · | · | 1 | · |
| AutomationDetail | 6 | 10 | 1 | 1 | 4 | 3 | · | · | · | · | 1 | · | 1 | · | · | · | · | · | · | 6 | 7 | 12 | 2 | · | · | 3 | 1 | 1 |
| Automations | 3 | 14 | 3 | · | 3 | 5 | · | 1 | · | · | 6 | · | 1 | · | · | 5 | · | 1 | · | · | 7 | 12 | 2 | · | · | · | 1 | · |
| ChatBrowser | 14 | 19 | 5 | 1 | 2 | 7 | 2 | 1 | · | · | · | · | · | · | 1 | · | · | 1 | · | · | · | 12 | 2 | 1 | 4 | · | 1 | · |
| ChatComputer | 16 | 9 | 7 | 1 | 7 | 5 | 1 | · | 1 | · | · | · | 2 | · | 1 | · | · | · | · | · | · | 12 | 2 | 1 | 3 | · | 1 | 1 |
| ChatCreate | 7 | 13 | 6 | 4 | 3 | 3 | 2 | 10 | 8 | 1 | 1 | 20 | 6 | · | · | · | · | · | · | 1 | · | 12 | 2 | · | · | · | 1 | · |
| ChatCreateModel | 6 | 3 | 5 | 1 | 3 | · | 1 | 4 | 4 | · | 1 | 6 | 1 | · | · | · | · | · | · | 1 | · | 12 | 2 | · | · | · | 1 | · |
| ChatCreateOrchestrator | 7 | 3 | 3 | 11 | 3 | · | 5 | 3 | 4 | · | 9 | 8 | 3 | · | · | · | · | · | 1 | 1 | · | 12 | 2 | · | · | · | 1 | · |
| ChatFiles | 14 | 12 | 8 | 1 | 8 | 7 | 1 | 1 | · | · | · | · | · | · | 1 | · | · | · | · | · | · | 12 | 2 | 1 | 4 | · | 1 | 1 |
| ChatLight | 5 | 7 | 7 | 1 | 3 | 6 | 1 | · | · | · | · | 3 | 1 | · | · | · | · | · | · | · | · | 12 | 2 | 1 | 4 | · | 1 | 1 |
| ChatNarrow | 9 | 25 | 6 | 1 | 3 | 4 | 1 | 1 | · | · | · | · | · | · | 1 | · | 1 | 1 | · | · | · | · | · | 1 | · | · | 1 | 1 |
| ChatPlan | 13 | 11 | 6 | 2 | 6 | 5 | 2 | 1 | · | · | · | · | 1 | · | 1 | · | · | · | · | · | · | 13 | 2 | 1 | 4 | · | 1 | · |
| ChatTasks | 15 | 13 | 5 | 5 | 3 | 5 | 9 | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | 12 | 2 | 1 | 5 | · | 1 | · |
| ChatTerminal | 14 | 12 | 7 | 1 | 3 | 8 | 1 | · | · | · | · | · | 1 | · | 1 | · | · | 1 | · | · | · | 12 | 2 | 1 | 3 | · | 1 | 2 |
| ChatWorkflowRun | 13 | 9 | 4 | 3 | 4 | 9 | · | · | · | · | 4 | · | · | · | 1 | 5 | · | 1 | · | · | · | 12 | 5 | 1 | · | · | 1 | · |
| ChatsList | 8 | 5 | 4 | 12 | 3 | 4 | 12 | 1 | · | 13 | · | · | 1 | · | · | · | · | 1 | · | · | 13 | 12 | 2 | · | · | · | 1 | · |
| CodebaseDetail | 11 | 4 | 1 | 7 | 3 | 1 | · | · | · | · | · | · | 1 | 1 | · | · | · | · | · | 1 | 7 | 12 | 2 | · | · | · | 1 | · |
| CommandPalette | 10 | 10 | 12 | 2 | 4 | 4 | · | · | · | · | · | · | · | · | · | · | 1 | 1 | · | 3 | · | 16 | 2 | · | · | 6 | 1 | · |
| Components | 28 | 11 | 17 | 13 | 7 | 11 | · | 5 | 3 | 7 | 2 | 3 | 1 | 1 | 1 | 12 | · | 2 | 4 | · | 5 | 3 | · | 1 | 7 | · | · | 2 |
| ComposerModelPicker | 8 | 10 | 10 | 1 | 4 | 9 | 3 | · | · | · | · | · | · | · | · | · | · | 1 | 1 | · | · | 12 | 2 | 1 | 4 | · | 1 | 1 |
| ComposerStates | 22 | 56 | 3 | 5 | · | 86 | 3 | · | · | · | · | · | · | · | · | 16 | 1 | 7 | 3 | 1 | · | · | · | 15 | · | · | · | · |
| DesktopMac | 5 | 7 | 5 | 2 | 4 | 4 | 1 | · | · | · | · | · | · | · | · | 10 | · | 1 | · | · | · | 12 | 2 | · | 4 | · | 1 | 1 |
| DesktopWindows | 12 | 13 | 2 | · | 6 | 4 | · | · | · | · | · | · | · | · | · | 4 | · | 1 | · | 3 | · | 16 | 2 | · | · | 7 | 1 | · |
| DockBrowser | 27 | 41 | · | · | 1 | 3 | · | 8 | · | 1 | · | · | · | · | 5 | 13 | · | 3 | 2 | · | · | · | · | · | · | · | · | · |
| DockChanges | 31 | 37 | 1 | 5 | · | 4 | 1 | 4 | 1 | · | 1 | · | 2 | · | 4 | 9 | · | 1 | · | · | · | · | · | · | · | · | · | · |
| DockFiles | 17 | 16 | 2 | 2 | 4 | · | · | 2 | · | · | · | · | · | · | 3 | · | · | · | · | · | · | · | · | · | · | · | · | · |
| DockTasks | 29 | 17 | · | 6 | 4 | · | 9 | · | 3 | · | · | · | 1 | · | 5 | · | · | · | · | · | · | · | · | · | 4 | · | · | 1 |
| DockTerminal | 25 | 13 | 1 | 4 | · | · | · | · | · | · | · | · | · | · | 5 | · | · | 1 | 1 | · | · | · | · | · | · | · | · | 5 |
| Foundations | 6 | · | · | 8 | 8 | 1 | · | 1 | · | 1 | 1 | · | 1 | · | · | · | · | 2 | · | 7 | 1 | · | · | · | · | · | · | · |
| Home | 10 | 10 | 2 | · | 4 | 4 | · | · | · | · | · | · | · | · | · | · | · | · | · | 3 | · | 16 | 2 | · | · | 6 | 1 | · |
| Main | 16 | 10 | 7 | 1 | 4 | 7 | 1 | 1 | · | · | · | · | 1 | · | 1 | · | · | · | · | · | · | 12 | 2 | 1 | 4 | · | 1 | 2 |
| NewChat | 8 | 5 | 7 | 13 | 3 | 6 | 13 | 5 | 5 | 15 | · | 5 | 3 | · | · | · | 1 | 1 | · | · | 13 | 12 | 2 | · | · | · | 1 | · |
| Pairing | 1 | · | · | · | 1 | · | · | 2 | 3 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 6 |
| ProjectCustomization | 9 | 12 | 1 | 9 | 3 | 3 | · | 1 | · | · | 8 | · | 1 | 1 | · | · | · | · | 1 | · | 9 | 12 | 2 | · | · | · | 1 | 1 |
| ProjectDetail | 12 | 6 | 1 | 2 | 3 | · | · | 4 | 5 | · | · | · | 1 | 1 | · | · | · | · | 1 | 1 | 3 | 12 | 2 | · | · | · | 1 | · |
| Projects | 3 | 7 | 2 | 4 | 4 | 1 | · | 1 | · | · | · | · | 2 | · | · | 8 | · | 1 | · | · | 5 | 12 | 2 | · | · | · | 1 | · |
| Scripts | 6 | 2 | 2 | · | 3 | 4 | · | 1 | · | · | · | · | 1 | · | · | · | · | · | · | 1 | · | 12 | 2 | · | · | · | 1 | · |
| SettingsAppearance | 10 | 11 | 3 | · | 4 | 4 | · | 1 | · | · | 1 | 12 | 4 | · | · | · | 1 | 1 | · | 3 | · | 31 | 6 | · | · | 6 | 1 | · |
| SettingsSecurity | 19 | 14 | 3 | 2 | 4 | 7 | · | 1 | · | 3 | · | · | 1 | · | · | · | 1 | 1 | 1 | 6 | 1 | 31 | 6 | · | · | 6 | 1 | · |
| ThemeInstrument | 32 | 20 | 14 | 3 | 8 | 14 | 2 | 2 | · | · | · | · | 2 | · | 2 | · | · | · | · | · | · | 24 | 4 | 2 | 8 | · | 2 | 4 |
| Themes | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 1 | · | · | · | · | · | · | · | · |
| WorkflowAgentDraft | 11 | 33 | 2 | 5 | 1 | 22 | · | · | · | 5 | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | 1 | · |
| WorkflowBuilder | 7 | 27 | 3 | 1 | 1 | 19 | · | 14 | 18 | 2 | 3 | · | 3 | 1 | · | · | · | · | · | · | · | · | · | · | · | · | 1 | · |
| WorkflowDetail | 6 | 5 | 1 | 1 | 3 | 6 | · | · | · | · | · | · | · | · | · | · | · | · | · | 3 | 2 | 12 | 2 | · | · | 6 | 1 | · |
| WorkflowLoopBuilder | 10 | 26 | 4 | 2 | 1 | 9 | · | 9 | 10 | · | · | · | 2 | 1 | · | 6 | · | 1 | · | · | 1 | · | · | · | · | · | 1 | · |
| WorkflowNew | 2 | 13 | 2 | 2 | 1 | 11 | · | 4 | 4 | 2 | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | 1 | 1 | · |
| WorkflowRun | 16 | 14 | 2 | 9 | 3 | 1 | · | 1 | · | · | · | · | 1 | · | 1 | 8 | · | 1 | · | 1 | 2 | 12 | 2 | 1 | · | 4 | · | · |
| WorkflowRunDialog | 15 | 6 | 2 | 2 | 3 | 8 | · | 16 | 10 | 2 | 7 | · | 1 | · | · | · | 1 | 1 | 1 | 3 | 3 | 12 | 2 | · | · | 14 | 1 | · |
| WorkflowRunLoop | 18 | 11 | 1 | 2 | 3 | 1 | · | · | · | · | · | · | 2 | · | 1 | · | · | · | · | 1 | 3 | 12 | 2 | 1 | · | 4 | · | · |
| WorkflowSettingsPanel | 10 | 27 | 3 | 1 | 1 | 20 | · | 4 | 5 | 1 | · | · | · | 1 | · | · | · | · | · | · | 1 | · | · | · | · | · | 1 | · |
| WorkflowStageHooks | 11 | 35 | 3 | 2 | 1 | 23 | · | 11 | 12 | · | 3 | · | 4 | 2 | · | · | · | · | · | · | · | · | · | · | · | · | 1 | · |
| WorkflowStageModel | 7 | 28 | 3 | 1 | 1 | 16 | · | 4 | 8 | · | · | · | 4 | 1 | · | · | · | · | 1 | · | · | · | · | · | · | · | 1 | · |
| WorkflowStagePrompt | 12 | 30 | 4 | 1 | 1 | 16 | · | 4 | 5 | · | · | · | 1 | 1 | · | 10 | · | 1 | · | · | · | · | · | · | · | · | 1 | · |
| WorkflowStageTools | 9 | 27 | 3 | 1 | 1 | 19 | · | 1 | · | 9 | 4 | · | · | 1 | · | · | · | · | · | · | · | · | · | · | · | · | 1 | · |
| WorkflowValidate | 17 | 31 | 3 | 4 | 2 | 16 | · | 3 | 5 | · | · | · | 1 | 1 | · | · | · | · | · | · | · | · | · | · | · | · | 1 | 4 |
| Workflows | 4 | 5 | 2 | 2 | 3 | 13 | · | 1 | · | 11 | · | · | 2 | · | · | 7 | · | 1 | · | 1 | 11 | 12 | 2 | · | · | 6 | 1 | · |
| **Total** | 678 | 834 | 219 | 194 | 183 | 460 | 91 | 148 | 134 | 82 | 70 | 57 | 79 | 13 | 36 | 113 | 7 | 36 | 18 | 65 | 94 | 510 | 87 | 31 | 58 | 73 | 47 | 35 |

---

## 8. Delete list

"Last importer" means the phase in which the last caller is ported; D-02 allows the legacy `components/ui` folder to live until then and requires removal by P7. Files marked **→ B/F** are replaced by domain items in the companion inventory, listed here so nothing is forgotten.

| File | Replaced by | Delete in |
|---|---|---|
| `components/ui/Button.tsx` | P-02, P-03 | P7 (last legacy importer) |
| `components/ui/Badge.tsx`, `components/common/SourceBadge.tsx` | P-05 | P7 / P5 |
| `components/ui/StatusBadge.tsx` | P-06 + `packages/shared` status map | P7 (first new consumer P3) |
| `components/ui/Card.tsx` | P-48 | P7 |
| `components/ui/Input.tsx` (`Input`, `Textarea`) | P-13, P-15 | P7 |
| `components/ui/Modal.tsx`, `ui/primitives/dialog.tsx` | P-31 | P7 |
| `components/ui/Drawer.tsx` | P-33 (and S-03 rail replaces the mobile nav drawer in `AppLayout`) | P3 |
| `components/ui/ConfirmDialog.tsx`, `ui/useConfirm.tsx`, `ui/primitives/alert-dialog.tsx`, shim `components/ConfirmDialog.tsx` | P-32 | P7 (shim: P3) |
| `components/ui/Select.tsx` | P-17 | P7 |
| `components/ui/SearchableSelect.tsx`, `ui/primitives/command.tsx` | P-18, P-19 | P5 (after pickers and palette; remove the `cmdk` dependency in the same PR) |
| `components/ui/Tabs.tsx`, `ui/primitives/tabs.tsx` | P-26 | P7 |
| `components/ui/Tooltip.tsx`, `ui/primitives/tooltip.tsx`, shim `components/Tooltip.tsx` | P-28 | P7 (shim P3) |
| `components/ui/ToggleSwitch.tsx`, `ui/primitives/switch.tsx` | P-22 | P6 (settings are the main users) |
| `components/ui/Spinner.tsx` | P-12 | P7 |
| `components/ui/Skeleton.tsx`, shim `components/Skeleton.tsx` | P-37 | P7 (shim P3) |
| `components/ui/EmptyState.tsx` | P-41 | P7 |
| `components/ui/PageHeader.tsx` | C-01, C-03 | P7 |
| `components/ui/SearchInput.tsx` | P-14 | P7 |
| `components/ui/StatCard.tsx` | C-10 | P5 (Home) |
| `components/ui/Kbd.tsx` | P-04 (+ shortcut formatting in `packages/shared`) | P7 |
| `components/ui/primitives/checkbox.tsx` | P-21 | P7 |
| `components/ui/primitives/dropdown-menu.tsx` | P-30 | P7 |
| `components/ui/primitives/popover.tsx` | P-29 | P7 |
| `components/ui/primitives/separator.tsx`, `scroll-area.tsx`, `table.tsx` | P-35, P-36, P-43 | P7 |
| `components/ui/primitives/sonner.tsx`, `components/Toast.tsx` | P-34 | P3 rewrite the adapter onto P-34; delete once its 19 importers import `ui/primitives/toast` (at latest P7) |
| `components/ui/index.ts` (barrel incl. re-exports of `workflow/NumberStepper`, `workflow/CollapsibleSection`) | path imports | P7 |
| `components/workflow/NumberStepper.tsx` | P-20 | PW |
| `components/workflow/CollapsibleSection.tsx` | P-45 | PW (importers `StagePropertiesPanel`, `AgentOverridesEditor`) |
| `components/layout/AppLayout.tsx` | S-01 | P3 |
| `components/layout/Sidebar.tsx` | S-02, S-03 | P3 |
| `components/layout/TitleBar.tsx` | S-06, S-07 | P3 |
| `components/layout/Header.tsx` | per-route C-01; `LegacyHeader` slot | P7 |
| `components/layout/RightPane.tsx` (+ `hooks/useResizablePane.ts`) | S-08, C-19, C-20 | chat stops using it in P4; the file stays for the legacy `WorkflowRunPageV2` and is deleted when PW (or the D-35 fallback) replaces that page, at the latest P7 (`04-screen-map.md` §2.1 note) |
| `hooks/useResizable.ts` | C-20 | PW (WorkflowBuilderPage) |
| `components/layout/PageContainer.tsx` | T-01…T-05 | P7 (15 importers across P3–PW) |
| `components/layout/Toolbar.tsx` | C-04 / P-47 | P7 |
| `components/layout/Breadcrumb.tsx` | C-02 | P7 |
| `components/layout/CommandPalette.tsx` | S-10 + C-21 (+ palette wiring in `app/`) | P3 (P3-05) |
| `components/layout/FindBar.tsx` | S-12 + C-32 (+ wiring in `app/`) | P4 |
| `components/data/EntityCard.tsx` | C-09 | P5 (Agents) / PW (Scripts) |
| `components/data/EntityListRow.tsx` | C-05, C-07 | PW (Workflows, Automations) |
| `components/data/FilterTabs.tsx`, `components/data/index.ts` | P-25, C-04 | P3 (ChatsList) / P5 (dashboard ActivityPanel dies with Home) |
| `components/common/CodebasePicker.tsx`, `ProjectPicker.tsx` | nothing (zero importers today, D-32); B-06 is built new on P-18 when its first consumer (P5-09 / P5-10) needs it | P0 (P0-05) |
| `components/common/SyntaxHighlightedCode.tsx` | C-23 + → B (Shiki, D-33) | P4 |
| `components/shared/ContextUsageGauge.tsx` | P-39 + → B (context popover) | P4 |
| `components/shared/ModelPicker.tsx` | → B ModelPicker on P-18 | P4 |
| `components/shared/FileExplorer.tsx`, `FileViewerComponents.tsx` | → B FileTree / FileViewer | P4 |
| `components/shared/ImageHoverPreview.tsx`, `OpenInEditorButton.tsx` | → B (on P-29 / P-02) | P4 |
| `components/shared/fileIcons.tsx`, `VendorIcons.tsx` | move to `ui/icons/` (see §10 issue 5) | P1/P3 move |
| `components/status/ConnectionStatus.tsx` | S-02 footer + `app/` wiring | P3 |
| `components/settings/shared.tsx` | C-12, C-13, C-07, P-45 | P6 |
| `components/dashboard/*` (`HealthStatCard`, `SystemHealthCard`, `SystemStatusPill`, `ActivityPanel`) | C-10, C-11, P-06, C-08 | P5 |
| Local dups: `diff/ChangesSurface.tsx` (`IconButton`, `Menu*`), `diff/FilesSurface.tsx` (`IconButton`, `ModeButton`, `MountSectionHeader`), `agent/StepRow.tsx` (`StatusDot`), `chat/BackgroundTasksPanel.tsx` / `chat/sources/SourcesPanel.tsx` (`StatusChip`), `chat/sources/SourcePicker.tsx` (`Segmented`), `chat/ChatInput.tsx` (`ComposerChip`), `widgets/WidgetHost.tsx` (`EmptyState`), `layout/Header.tsx` (`ActionButton`, `ChatStatusBadge`) | kit parts named above | P4 (with their surfaces) |
| Local dups: `settings/sections/Security.tsx` (`StatusPill`, `role="switch"`), `Providers.tsx` (`ConnectionPill`), `Catalogs.tsx` (`Field`), `Appearance.tsx` (`ThemeCard`) | P-06, P-22, P-16, P-24 | P6 |
| Local dups: `pages/AgentEditorPage.tsx` (`Field`, `SectionCard`), `agents/EffectiveCapabilitiesPanel.tsx` (`Section`), `pages/ChatsListPage.tsx` (`ChatCard`) | P-16, C-14, C-05 | P5 / P3 |
| Local dups: `workflow/redesign/RunHeaderBar.tsx` (`StatusPill`), `pages/WorkflowDefinitionPage.tsx` (`MenuItem`, `MetaChip`, `RunRow`), `pages/AutomationDetailPage.tsx` (`ExecutionRow`, `IterationRow`), `workflow/StageEdge.tsx` (`role="menu"`) | P-06, P-30, P-05, C-05 | PW |

After P7, `apps/web/src/components/{ui,layout,data,common,shared,status}` and the four top-level shims are empty and deleted; Radix packages and `cmdk` are removed from `package.json` (D-05, D-38).

---

## 9. Build order

Each item lands with its first consumer (D-01) and its stories.

- **P3 — Slice A (shell + ChatsList).** Core 12: P-02 Button, P-03 IconButton, P-04 Kbd, P-05/P-06 Badge + StatusBadge, P-09 Chip, P-13/P-14 Input + SearchInput, P-25 SegmentedControl, P-27 NavItem, P-28 Tooltip, P-30 Menu, P-32 AlertDialog, P-43 Table, and for the palette (P3-05) P-19 Autocomplete, P-31 Dialog, C-21 CommandList, S-10 CommandPaletteFrame. Trivial companions: P-01 Icon, P-07 StatusDot, P-08 Count, P-10 Avatar, P-12 Spinner, P-21 Checkbox, P-34 Toast, P-35 Separator, P-36 ScrollArea, P-37 Skeleton, P-41 EmptyState, P-42 Link, P-47 Toolbar. Patterns: C-01 PageHeader, C-02 Breadcrumb, C-03 PageTitle, C-04 FilterBar, C-05 DataTable (virtualized), C-06 BulkActionBar, C-12 SectionHeader, C-22 MenuButton. Shell: S-01…S-07, S-13. Template: T-01; layout L-03 Gate (NotFound/RouteError, P3-04). `ui/lib` (cn with generated merge config, overlay attrs). Storybook itself is set up earlier, in P1-SB.
- **P4 — Slice B (chat workspace).** P-15 Textarea, P-18 Combobox, P-29 Popover, P-33 Sheet, P-39 Gauge, P-40 Callout, P-44 InlineCode, P-45 Collapsible, P-46 Slider (P-22 Switch if a composer toggle needs it). Patterns: C-19 DockTabStrip, C-20 SplitPane, C-23 CodeBlock, C-24 TerminalFrame, C-25 StepRail, C-27 KbdHintRow, C-30 GateCardFrame, C-32 FindWidget, C-33 DiffStat. Shell: S-08 DockFrame, S-09 NarrowDockSheet, S-12 FindBarFrame. Template: T-04. D-19 tests (sheet ancestor exemption, menu over browser tab).
- **P5 — fan-out pages.** P-16 Field, P-17 Select, P-22 Switch, P-23 RadioGroup, P-24 RadioCard, P-26 Tabs, P-38 ProgressBar/Meter, P-48 Card. Patterns: C-07 EntityRow, C-08 ActivityRow, C-09 EntityCard/CardGrid, C-10 StatStrip, C-11 KeyValueList, C-14 FormSection, C-15 SummaryAside, C-16 ActionBar, C-18 Inspector, C-26 ChoiceCardGrid, C-28 PairingCodeInput, C-29 Banner, C-31 Dropzone, C-35 ModalForm body. Templates: T-02, T-03; layout L-01 Home (L-03 Gate already exists from P3).
- **P6 — settings.** P-20 NumberField, P-23 swatch variant, P-24 tile variant, C-13 SettingsSection/SettingRow/SettingsTable, C-34 ListPane, S-11 SettingsModalFrame, T-05 MasterDetail.
- **PW — workflow surfaces (Workflow Overhaul Plan, on this kit).** P-11 AgentGlyph (unless P4 needs it), C-17 Stepper, C-22 split variant, L-02 Wizard, L-04 CanvasEditor, L-05 ModalWithAside; WF-xx pieces in the domain inventory.
- **P7 — lockdown.** Delete list §8; ratchet at 0; Tailwind namespace reset (D-07).

---

## 10. Issues found while compiling this inventory

**Status (final review, 2026-09-25):** 1 → resolved in `02-design-system-spec.md` §6.3/§8 and D-08; 2, 6, 7, 8, 9 are inventory choices applied below (no decision change); 3 → resolved in P-22 (off thumb `bg-surface`, on thumb `bg-on-accent`; no new token); 4 → resolved in D-23 (renamed to `--gai-titlebar-*` in P3-04; the rail inset is `--gai-page-inset-left`); 5 → resolved in D-17 (`ui/icons/vendor/`).

1. **Height tokens are incomplete** (D-08/D-15): the boards need 40, 48, 56, 20 and 18px heights and several layout widths that D-08 does not name (§1.4). Add them to `02-design-system-spec.md` with density behaviour (compact: rows −4, bars unchanged).
2. **Radio selected style is inconsistent**: Components draws a 4px accent border; AutomationCreate a 1px accent ring + 6px dot and a radio-card border in `--fg-2` instead of `--accent`. This inventory adopts the Components board.
3. **Switch thumb is a literal `#ffffff`** in both modes; there is no token. Needs a `--gai-switch-thumb` (or use `on-accent` when on and a fixed light thumb when off) with a 3:1 check against `line-strong` (D-12).
4. **D-23 names `--gai-titlebar-inset-left`**, but `lib/desktop.ts` writes `--titlebar-inset-left/right` and `--titlebar-height` today. Either rename in `lib/desktop.ts` in P3 or amend D-23.
5. **D-17 keeps vendor marks in `components/shared/VendorIcons.tsx`**, which conflicts with emptying `components/` at P7 and with "lucide only inside `ui/icons`". Proposal: `ui/icons/vendor.tsx` and `ui/icons/file-types.tsx`.
6. **Rail button size**: ChatNarrow draws 28px `.ib` rail buttons; the eleven workflow boards and the spec draw 32px. This inventory uses 32 (P-03 `lg`).
7. **Off-grid control heights** (22px chips, 26px and 30px inputs, 26px menu headers, 28px settings-nav rows) are normalised to the 20/24/28/32 steps or to `dense` variants; review the visual diff at the first consumer.
8. **No AlertDialog, Toast or narrow-dialog geometry is drawn** on desktop; P-31 `sm` 420 and P-34 styling are derived (D-30 confirms toasts stay).
9. **SegmentedControl semantics** differ per board (`tablist` for list scopes, `radiogroup` for settings choices); the `semantics` prop makes this explicit so screen readers get the right role.
