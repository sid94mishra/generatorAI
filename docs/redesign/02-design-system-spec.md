# 02 — Design-system specification (tokens and foundations)

This document is the implementable spec for everything below the component kit: colour tokens, typography, geometry, density, elevation, z-order, motion, the status map, chrome constants, the icon concept registry, and the generators that emit them. It is binding for Phase 1 (P1 "Platform upgrades and tokens v2 + shared registries"). Decisions are referenced as `D-xx` (see `01-decisions.md`). Where this document refines a decision because the decision does not hold against the code, the refinement is listed in §14.

Code facts were measured at `desktop_redesign @ a83a7bf`. Computed colour values in this document were produced with the repo's own `color.ts` functions (via `tsx`) and are the values the generator must emit. If a later session's generator emits something different, the tests in §12 decide which one is right.

Conventions:
- **design name**: the name the boards use (`ground`, `fg-2`, …). These are also the class vocabulary (D-08).
- **raw var**: `--gai-<name>`, the runtime custom property (D-08).
- **legacy**: everything the token package emits today (`--background`, `--card`, `--primary`, `--accent`, …). Legacy values are not changed by P1 (D-06), except where §3 renames a colliding name.
- `s` = one `ThemeAppearanceSpec` (a theme's dark or light spec). `t` = `resolveAppearanceTokens(theme, appearance)`. `a` = `resolveAccentTokens(theme, accent, appearance)`.

---

## 1. Architecture after P1

```
                           packages/design-tokens/src
 ┌─────────────────────────────────────────────────────────────────────────────────────┐
 │ themes/*.ts  ThemeDef (authored: 6 surfaces [+ optional sunken], 3 text, 2 borders,   │
 │              9 hues, radius, fonts, defaultAccent)   18 themes incl. instrument.ts    │
 │                              │                                                        │
 │        ┌─────────────────────┼──────────────────────────────┐                         │
 │        ▼                     ▼                              ▼                         │
 │ resolveAppearanceTokens  resolveAccentTokens (+onAccent,  resolveDesignTokens (NEW,   │
 │ (legacy, unchanged)      +ink)  (legacy)                  design.ts) → DesignTokens   │
 │        │                     │                              │                         │
 │ tokens.ts (legacy scales) · design.ts (TYPE_SCALE, radiusScale, HEIGHTS, Z_INDEX,      │
 │ MOTION_CSS, ELEVATION) · vocabulary.ts (class names, twMergeExtension) · icons.ts      │
 │ (ICON_CONCEPTS) · chrome.ts (CHROME, SHELL, CHROME_FALLBACK_COLORS) · registry.ts      │
 │ (modes, defaults, storage keys for 5 axes + reduce motion)                             │
 └───────┬─────────────────┬─────────────────┬───────────────┬───────────────┬──────────┘
         │ emit/css.ts     │ emit/vocab.ts   │ emit/native.ts│ emit/ansi.ts  │ emit/prepaint.ts
         ▼                 ▼                 ▼               ▼               ▼
 apps/web/src/styles/  packages/design-  apps/mobile/src/  TUI (tui-kit,   apps/web/index.html
 globals.css           tokens/css/       theme/tokens.     cli) runtime    <!-- @generated-
 (generated region)    vocabulary.css    generated.ts      buildTerminal   prepaint --> block
  L1  legacy values     @theme inline {   legacy keys       Theme()
  L1b --gai-* values     --color-ground:   unchanged +                        also read by:
  L1c density/font/      var(--gai-...)    additive --gai-*  apps/Documentation Site/
      motion blocks      --text-ui ...     keys + gaiColors  scripts/generate-theme.mjs
  L2  legacy @theme      --radius-card     (next pass:       (palettes.css, manual run)
      inline (accent →   --height-row      Uniwind reads
      accent-tint)       --z-index-* }     vocabulary.css)
  L3  legacy compat     ◄── @import'ed by globals.css (web) and, next pass, by mobile's
  L4  hljs rules            Uniwind global.css (D-08/D-40)
 hand-written tail: base styles, @utility focus-ring/transition-control, @custom-variant reduced

 apps/web/src/ui/lib/cn.ts  ── extendTailwindMerge(twMergeExtension())   (D-09, runtime import)
 apps/web/src/ui/icons      ── concept → lucide component, keyed by ICON_CONCEPTS (D-17)
 apps/desktop/src/main      ── imports CHROME + CHROME_FALLBACK_COLORS (@generatorai/design-tokens/chrome)
 packages/shared/src/status ── 8-state status map (D-18), React-free, no design-tokens import
```

Key properties:
1. **One derivation, many emitters.** Every colour on every platform comes from `resolveDesignTokens()` (new) or the legacy resolvers. No emitter computes colours itself.
2. **Legacy layer is frozen.** `resolveAppearanceTokens` and the legacy half of `resolveAccentTokens` return byte-identical values for the 17 existing themes and 6 existing accents. The only legacy-CSS changes are: the §3 bridge renames, the new `ink` accent blocks, `--primary-foreground` inside accent blocks (identical values for the 6 hue accents), and the Instrument theme's blocks.
3. **Vocabulary is platform-neutral, values are per platform.** `vocabulary.css` maps design names to `--gai-*` variables only. Web supplies `--gai-*` values from `globals.css`; mobile (next pass) supplies its own values (per-platform geometry, D-40).
4. **All emitted values are literals** (hex, px). No `calc()` chains, no `color-mix()` in generated output. This keeps mobile parity trivial and makes attribute overrides work on any element (Storybook wrappers), not only `<html>`.

---

## 2. Colour tokens

### 2.1 Derivation primitives (add to `src/color.ts`)

| Function | Signature | Behaviour |
|---|---|---|
| `oklabMix` | `(from: string\|Rgba, to: string\|Rgba, amount: number) => Rgba` | sRGB → linear → OKLab, linear interpolate by `amount` (share of `to`), back to sRGB, clamp, **round-trip through `toHex`** (same reason as `ensureContrast`, `color.ts:164-167`). |
| `ensureContrastAll` | `(colour, backs: Array<string\|Rgba>, minRatio: number, toward: string\|Rgba) => Rgba` | Returns `colour` if `min(contrastRatio(colour, b))` over all `backs` ≥ `minRatio`; otherwise steps `mix(colour, toward, s/100)` for s = 1..100 (hex round-trip each step) and returns the first that clears every back; falls back to `toward`. `toward` is always the theme foreground for text and strokes (moving toward the text colour raises contrast against every surface of the same appearance). |

`TINT` (`themes/types.ts:313-320`) gains: `hover: { dark: 4, light: 4 }`, `selected: { dark: 8, light: 8 }`, `diff: { dark: 10, light: 8 }`. New constants in `design.ts`: `SCRIM = { dark: '#0000009e', light: '#1414184d' }` (62 % / 30 %), `SHADOW = { dark: '#0000008c', light: '#14141e24' }` (55 % / 14 %).

`ThemeAppearanceSpec` (`types.ts:80-119`) gains `sunken?: string` (optional; defaults to ground). `ThemeDef` (`types.ts:153-173`) gains `textContrast?: 4.5 | 7` (default 4.5; `contrast.ts` sets 7 so the High Contrast theme keeps its AAA promise on the new layer).

### 2.2 `resolveDesignTokens(theme, appearance, accentId): DesignTokens` (new `src/design.ts`)

Let `fg = s.foreground`, `minText = theme.textContrast ?? 4.5`, `ap = appearance`.

1. `ground` = the darker (lower relative luminance) of `s.background` / `s.card`; `surface` = the other. Ties → `ground = s.background`.
2. `raised` = `s.raised` unless `s.raised === surface`, then `s.subtle`.
3. `overlay` = `s.popover`. `sunken` = `s.sunken ?? ground`.
4. `hover` = `toHex(withAlpha(fg, TINT.hover[ap]))`; `selected` = `toHex(withAlpha(fg, TINT.selected[ap]))` (translucent `#rrggbbaa`).
5. `TEXT_BACKS` = `[ground, surface, raised, overlay, sunken, flatten(hover, surface), flatten(hover, ground), flatten(selected, surface), flatten(selected, ground)]`.
6. `fg2` = `ensureContrastAll(s.mutedForeground, TEXT_BACKS, minText, fg)`.
7. `fg3` = for `k` = 18 down to 0: `c = oklabMix(fg2, surface, k/100)`; the first `c` with min contrast over `TEXT_BACKS` ≥ `minText` (k = 0 gives `fg2`, which always passes).
8. `lineSoft` = `s.borderMuted`; `line` = `s.border`; `lineStrong` = `ensureContrastAll(s.border, [ground, surface, raised, overlay, sunken], 3, fg)`.
9. Status, for each `(state, hue)` in `run:blue, ok:green, warn:yellow, err:red`:
   - `<state>Bg` = `toHex(withAlpha(s.hues[hue], TINT.status[ap]))` (identical to legacy `infoMuted` / `successMuted` / `warningMuted` / `dangerMuted`);
   - `<state>` (glyph, dot, bar, stroke) = `ensureContrastAll(s.hues[hue], [ground, surface, raised, overlay], 3, fg)`;
   - `<state>Text` (coloured words) = `ensureContrastAll(s.hues[hue], [flatten(bg, surface), flatten(bg, ground), flatten(bg, raised), flatten(bg, hover∘surface), flatten(bg, hover∘ground), flatten(bg, selected∘surface), flatten(bg, selected∘ground), ground, surface, raised, overlay, sunken], minText, fg)` (`sunken` because inputs sit on it; the hovered/selected-row backdrops because status badges sit in selected table rows — added in P3-02 after axe measured 4.39–4.40:1 for light-theme badges on a selected row; the row composites are clamped to minText + 0.05 because the browser composites the two translucent layers in 8 bits — measured 4.48 where the float maths said 4.50).
10. `addBg` = `toHex(withAlpha(s.hues.green, TINT.diff[ap]))`; `delBg` = same with `red`.
11. `scrim` = `SCRIM[ap]`; `shadowPop` = `` `0 16px 40px ${SHADOW[ap]}, 0 0 0 1px ${toHex(withAlpha(fg, 6))}` ``.
12. Accent: `accent` = `fg` for `ink`, else `a.primaryEmphasis`; `onAccent` = `surface` for `ink`, else `s.onAccent`; `focus` = `ensureContrastAll(accent, [ground, surface, raised, overlay, sunken], 3, fg)` (inputs sit on `sunken` and take the focus ring there).

`DESIGN_COLOR_VARS: Array<[keyof DesignTokens, string]>` fixes the camelCase → CSS name mapping (`fg2 → --gai-fg-2`, `lineStrong → --gai-line-strong`, `runText → --gai-run-text`, `shadowPop → --gai-shadow-pop`, …).

### 2.3 Colour token table

Instrument values are the generator outputs for the ThemeDef in §4 (they are pinned by a test, §12). "Utilities" are the class vocabulary from `vocabulary.css` (§10.2).

| Design name | Raw var | Utilities | Derivation (§2.2) | Instrument dark | Instrument light | Legacy nearest |
|---|---|---|---|---|---|---|
| ground | `--gai-ground` | `bg-ground` | darker of background/card | `#0b0b0c` | `#f1f1ef` | `bg-background` (dark) / `bg-card` (light) |
| surface | `--gai-surface` | `bg-surface` | lighter of background/card | `#111113` | `#ffffff` | `bg-card` (dark) / `bg-background` (light) |
| raised | `--gai-raised` | `bg-raised` | raised, or subtle if raised = surface | `#17171a` | `#fafaf9` | `--raised` (not bridged after §3) |
| overlay | `--gai-overlay` | `bg-overlay` | popover | `#1d1d21` | `#ffffff` | `bg-popover` |
| sunken | `--gai-sunken` | `bg-sunken` | `s.sunken ?? ground` | `#0d0d0f` | `#f6f6f4` | `bg-subtle` (inputs) |
| hover | `--gai-hover` | `bg-hover`, `hover:bg-hover` | fg @ 4 % | `#ededef0a` | `#18181b0a` | `hover:bg-accent-tint` / `bg-subtle` |
| selected | `--gai-selected` | `bg-selected`, `aria-selected:bg-selected` | fg @ 8 % | `#ededef14` | `#18181b14` | `bg-sidebar-accent`, `bg-accent-tint` |
| line-soft | `--gai-line-soft` | `border-line-soft`, `divide-line-soft` | borderMuted | `#1c1c20` | `#ecece9` | `border-border-muted` |
| line | `--gai-line` | `border-line` | border | `#2c2c31` | `#dcdcd7` | `border-border` |
| line-strong | `--gai-line-strong` | `border-line-strong`, `bg-line-strong` (switch track) | border → fg until ≥3:1 on 5 surfaces | `#68686c` | `#8a8a88` | `border-input` |
| fg | `--gai-fg` | `text-fg` | foreground | `#ededef` | `#18181b` | `text-foreground` |
| fg-2 | `--gai-fg-2` | `text-fg-2` | mutedFg → fg until ≥4.5 on TEXT_BACKS | `#a1a1aa` | `#55555d` | `text-muted-foreground` |
| fg-3 | `--gai-fg-3` | `text-fg-3`, `placeholder:text-fg-3` | OKLab mix fg-2→surface, k≤18 %, clamped | `#898991` | `#63636a` | (none) |
| accent | `--gai-accent` | `bg-accent`, `border-accent` | ink: fg; else primaryEmphasis | ink `#ededef` | ink `#18181b` | `bg-primary-emphasis` |
| on-accent | `--gai-on-accent` | `text-on-accent` | ink: surface; else onAccent | ink `#111113` | ink `#ffffff` | `text-primary-foreground` |
| focus | `--gai-focus` | `outline-focus`, `ring-focus`, `border-focus` | accent → fg until ≥3:1 on 4 surfaces | ink `#ededef` | ink `#18181b` | `ring-ring` |
| run | `--gai-run` | `bg-run` (dot/bar), `border-run`, `stroke-run` | blue, ≥3:1 on 4 surfaces | `#6aa6ff` | `#1d6ae5` | `text-info` |
| run (text) | `--gai-run-text` | `text-run` (see §10.2: `--text-color-run`) | blue, ≥4.5 on tint over surfaces and over hovered/selected rows | `#6aa6ff` | `#1b55b1` | `text-info` |
| run-bg | `--gai-run-bg` | `bg-run-bg` | blue @ 15 % / 12.5 % | `#6aa6ff26` | `#1d6ae520` | `bg-info-muted` |
| ok / ok text / ok-bg | `--gai-ok`, `--gai-ok-text`, `--gai-ok-bg` | `bg-ok`, `text-ok`, `bg-ok-bg` | green (same rules) | `#4cc38a` / `#4cc38a` / `#4cc38a26` | `#16804c` / `#166640` / `#16804c20` | `success`, `success-muted` |
| warn / warn text / warn-bg | `--gai-warn`, `--gai-warn-text`, `--gai-warn-bg` | `bg-warn`, `text-warn`, `bg-warn-bg` | yellow | `#f0b429` / `#f0b429` / `#f0b42926` | `#935f00` / `#795006` / `#935f0020` | `warning`, `warning-muted` |
| err / err text / err-bg | `--gai-err`, `--gai-err-text`, `--gai-err-bg` | `bg-err`, `text-err`, `bg-err-bg`, `border-err` | red | `#ff6369` / `#fe696e` / `#ff636926` | `#d1242f` / `#a7222b` / `#d1242f20` | `danger`, `danger-muted`, `destructive` |
| add-bg | `--gai-add-bg` | `bg-add-bg` | green @ 10 % / 8 % | `#4cc38a1a` | `#16804c14` | `bg-success-muted` |
| del-bg | `--gai-del-bg` | `bg-del-bg` | red @ 10 % / 8 % | `#ff63691a` | `#d1242f14` | `bg-danger-muted` |
| scrim | `--gai-scrim` | `bg-scrim` | constant | `#0000009e` | `#1414184d` | `bg-black/50` literals |
| shadow-pop | `--gai-shadow-pop` | `shadow-pop` | `0 16px 40px SHADOW, 0 0 0 1px fg@6 %` | `0 16px 40px #0000008c, 0 0 0 1px #ededef0f` | `0 16px 40px #14141e24, 0 0 0 1px #18181b0f` | `shadow-lg` etc. |
| `color-scheme` | (property) | — | appearance | `dark` | `light` | same |

**Focus-ring recipe.** `@utility focus-ring { &:focus-visible { outline: 2px solid var(--gai-focus); outline-offset: 2px; } }` (hand-written tail of `globals.css`). Outline + offset replaces the board's `0 0 0 2px surface, 0 0 0 4px accent` box-shadow: the offset gap shows the real backdrop (correct on raised and overlay too), outlines follow `border-radius` in Chromium, and it does not fight `shadow-pop` or the input halo. Inputs: default `border-line-strong`; `:focus-visible` → `border-focus` plus `box-shadow: 0 0 0 3px var(--gai-selected)` (the board's halo); error → `border-err` plus `0 0 0 3px var(--gai-err-bg)`.

**Inside floating layers (D-165).** Every element carrying `data-gai-overlay` (dialog, sheet, popover, menu, select popup, toast) re-bases the depth tokens on `overlay`: `--gai-raised` = `overlay`; `--gai-sunken` = `--gai-overlay-sunken`; `--gai-line-soft` = `--gai-overlay-line-soft`. Each re-based value is the point on the overlay → token line (toward `fg` when the token lies on the wrong side of the overlay) whose contrast with `overlay` equals the token's contrast with `surface`, so a field, segmented track, secondary button or divider in a dialog looks as it does on a page (`resolveOverlayTokens`). Instrument dark: sunken `#1a1a1e`, line-soft `#27272b`; Instrument light keeps `#f6f6f4` / `#ecece9`. The WCAG suite (§12 row 14b) asserts every text tier, status text, `line-strong` and `focus` on the re-based sunken. The boards draw the absolute values inside dialogs (inputs `#0d0d0f` on `#1d1d21`); this is a deliberate deviation.

**Kept tokens (shared, not legacy).** `--chart-1..6`, `--syntax-*` (14 roles), `--file-icon-*` (13) and `--canvas-bg`/`--canvas-dot` keep their names and derivations (`css.ts:226-241`). The terminal palette stays TS-only (`resolveTerminalPalette`). They are classified as a "shared" layer: P7 lockdown must **not** delete them with the legacy layer. Their `@theme inline` bridges (`--color-chart-N`, `--color-canvas-*`) move from the legacy list into `vocabulary.css` so they survive P7.

**Accent rule (unchanged from the boards):** accent colours only the primary button, Send, switch-on, checkbox-on, selected radio-card border (use `border-focus`, which is the accent clamped to 3:1), and the focus ring. Links in prose are `fg` underlined, not accent.

---

## 3. Collisions between the new vocabulary and legacy (P1, first PR)

Raw variables cannot collide: new ones are all `--gai-*`. Collisions exist only in the Tailwind namespace (`--color-*` in `@theme inline`, `globals.css:5039`) and in the Layer 3 compat block (`:root { --color-*: var(--*) }`). Measured over `apps/web/src/**/*.{ts,tsx}` plus the hand-written tail of `globals.css` (the generated region is excluded):

| Design name | Legacy bridge today | Legacy utilities used | `var(--color-X)` used | Action |
|---|---|---|---|---|
| `accent` | `--color-accent: var(--accent)` (selection tint) | **53 in 18 files** | **72 in 30 files** | Rename legacy to `accent-tint` (codemod) |
| `surface` | `--color-surface: var(--surface)` (= card) | 0 | **4 in 2 files** | Codemod to `card` (value identical: `tokens.test.ts:347-354` pins `surface === card`) |
| (`surface-hover`) | `--color-surface-hover` (= subtle) | 0 | **1 in 1 file** | Codemod to `subtle` (identical) |
| `raised` | `--color-raised: var(--raised)` | 0 | 0 | Remove from legacy bridge; no codemod |
| `overlay` | `--color-overlay: var(--overlay)` | 0 | 0 | Remove from legacy bridge; no codemod |
| (`accent-foreground`) | `--color-accent-foreground` | 0 | 0 | Remove from legacy bridge (pairs with the old tint) |

No collision: `ground, sunken, hover, selected, line*, fg*, on-accent, focus, run*, ok*, warn*, err*, add-bg, del-bg, scrim` (0 uses each); `subtle` (163 utilities / 72 vars) is **not** a design name, so it stays legacy; `ring`, `input`, `border`, `muted`, `primary*`, `sidebar*` stay legacy. Type (`text-micro … text-display`), radius (`rounded-badge … rounded-dialog`), height (`h-control…`), z (`z-dialog…`), `shadow-pop` names have no legacy or Tailwind-default counterpart (Tailwind 4.2 defaults: `text-xs…9xl`, `rounded-xs…4xl`, `shadow-2xs…2xl`; no `--height-*` defaults).

**Files for the `accent` codemod.** Utilities: `components/diff/ChangesSurface.tsx` (10), `components/diff/review/ReviewThreadCard.tsx` (8), `components/diff/FilesSurface.tsx` (7), `pages/CodebaseDetailPage.tsx` (4), `components/chat/sources/SourcePicker.tsx` (3), `pages/AutomationDetailPage.tsx` (3), `pages/WorkflowListPage.tsx` (3), `components/chat/sources/DirectoryBrowser.tsx`, `components/diff/CheckpointTimeline.tsx`, `components/diff/review/ReviewCommentsPopover.tsx`, `pages/ProjectsListPage.tsx` (2 each), `components/PageErrorBoundary.tsx`, `components/ui/Select.tsx`, `components/settings/sections/Security.tsx`, `components/diff/review/ReviewBatchBar.tsx`, `components/diff/review/ReviewComposerPopover.tsx`, `pages/ChatsListPage.tsx`, `pages/ScriptDetailPage.tsx`, `pages/ProjectDetailPage.tsx` (1 each). `var(--color-accent)`: `components/chat/ChatInput.tsx` (17), `components/chat/PlanDocumentPanel.tsx` (7), `components/chat/QuestionCard.tsx` (6), `components/shared/ModelPicker.tsx` (6), `components/chat/PlanCard.tsx` (4), `components/shared/FileViewerComponents.tsx` (4), `components/chat/VoiceRecorder.tsx`, `components/common/SyntaxHighlightedCode.tsx`, `components/workflow/DAGCanvas.tsx`, `components/workflow/WorkflowConfigPanel.tsx` (2 each), and 1 each in `styles/globals.css:5386` (markdown blockquote), `components/ErrorBoundary.tsx`, `components/artifacts/ArtifactBrowser.tsx`, `components/chat/{AssistantMessage,StreamingMessage,MessageActions,ChatList,PermissionCard,MarkdownRenderer}.tsx`, `components/chat/composer/ComposerMenu.tsx`, `components/layout/Header.tsx`, `components/diff/diffTheme.ts` (a comment, line 102), `components/diff/ChangesSurface.tsx`, `components/shared/ContextUsageGauge.tsx`, `components/workflow/{StageEdge,RuntimeDAGCanvas,StageNode}.tsx`, `components/codebase/CodebaseFileBrowser.tsx`, `components/widgets/WidgetHost.tsx`, `pages/ChatPage.tsx`.

**Surface files:** `components/widgets/WidgetFrame.tsx:246,306` (`var(--color-surface)` → `var(--color-card)`), `pages/ChatPage.tsx:95,1402` (same; `:1402` also `var(--color-surface-hover)` → `var(--color-subtle)`).

**Codemod** (one-off Node script, run from `apps/web`, not committed; `.ts`, `.tsx` under `src/` and the hand-written tail of `src/styles/globals.css` after the `/* @generated-tokens:end */` marker):
1. Utilities: replace `(?<![\w-])((?:[^\s"'\`]*?:)?!?(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|divide|shadow|accent|caret|decoration|placeholder)-)accent(?=(?:\/[\d.]+|\/\[[^\]]+\])?(?![\w-]))` with `$1accent-tint`. (The negative look-ahead leaves `accent-foreground`, `sidebar-accent`, `sidebar-accent-foreground` untouched.)
2. `--color-accent(?![\w-])` → `--color-accent-tint`; `--color-surface-hover` → `--color-subtle`; `--color-surface(?![\w-])` → `--color-card`.
3. Emitter (`css.ts:132-177` `THEME_COLOR_VARS`): replace `'accent'` with `'accent-tint'` and emit `--color-accent-tint: var(--accent)` in Layers 2 and 3 (the raw legacy `--accent` keeps its name and value; web has 0 direct `var(--accent)` uses and mobile reads it, so it is not renamed); delete `'accent-foreground'`, `'surface'`, `'surface-hover'`, `'raised'`, `'overlay'` from the list. `APPEARANCE_VARS` and the raw Layer 1 emission are unchanged (raw `--surface`, `--raised`, `--overlay` keep emitting until P7).
4. `pnpm tokens:write`.
5. Verification: `rg -n "(bg|text|border|ring|outline|fill|stroke|from|via|to|divide|shadow|accent|caret|decoration|placeholder)-accent(?![\w-])" apps/web/src` → 0 hits; `rg -n -- "--color-(accent|surface|raised|overlay)\b" apps/web/src --glob '!styles/globals.css'` → 0 hits.

Acceptance: `pnpm check:tokens`, `pnpm --filter @generatorai/design-tokens test`, web `typecheck`/`test` pass; pixel-identical screenshots (§13).

---

## 4. The Instrument theme, the ink accent, and default changes

### 4.1 `packages/design-tokens/src/themes/instrument.ts` (new)

Values from `Foundations.dc.html` / `ThemeInstrument.dc.html` (`.t-dark`, `.t-light`). The boards give no orange/teal/cyan/purple/pink or subtle/emphasis; those are authored here (they drive syntax, terminal, chart, and the violet/rose/teal/orange accents). Two authored values differ from the boards so the existing suite passes (`line`, see §14).

```ts
import { BUNDLED_MONO, INSTRUMENT_SANS } from './fonts.js';
import type { ThemeDef } from './types.js';

export const instrument: ThemeDef = {
  id: 'instrument',
  label: 'Instrument',
  description: 'The default. Neutral surfaces, Instrument Sans and JetBrains Mono; colour means status, nothing else.',
  group: 'product',
  defaultAccent: 'ink',
  fonts: { sans: INSTRUMENT_SANS, mono: BUNDLED_MONO },
  radius: { DEFAULT: 6, lg: 8, xl: 10 },
  dark: {
    background: '#0b0b0c', card: '#111113', popover: '#1d1d21', raised: '#17171a',
    subtle: '#1a1a1d', emphasis: '#2a2a30', sunken: '#0d0d0f',
    foreground: '#ededef', mutedForeground: '#a1a1aa', onAccent: '#ffffff',
    border: '#2c2c31',            // board #27272c is 1.13:1 on popover; suite needs ≥1.2
    borderMuted: '#1c1c20',
    hues: { red: '#ff6369', orange: '#ff8f4d', yellow: '#f0b429', green: '#4cc38a', teal: '#2cc2b5',
            cyan: '#56c7e8', blue: '#6aa6ff', purple: '#a48cff', pink: '#f27aae' },
    // Board accent hexes where they pass 4.5:1 with white; green/orange are derived.
    accentEmphasis: { blue: '#2f6fed', violet: '#7152e0', rose: '#c8325f', teal: '#0f7f7a' },
  },
  light: {
    background: '#ffffff', card: '#f1f1ef', popover: '#ffffff', raised: '#fafaf9',
    subtle: '#efefec', emphasis: '#dcdcd7', sunken: '#f6f6f4',
    foreground: '#18181b', mutedForeground: '#55555d', onAccent: '#ffffff',
    border: '#dcdcd7',            // board #e2e2de is 1.15:1 on card; suite needs ≥1.2
    borderMuted: '#ecece9',
    hues: { red: '#d1242f', orange: '#c2410c', yellow: '#935f00', green: '#16804c', teal: '#0f7f7a',
            cyan: '#0e7490', blue: '#1d6ae5', purple: '#7152e0', pink: '#c8325f' },
    accentEmphasis: { blue: '#2f6fed', violet: '#7152e0', rose: '#c8325f', teal: '#0f7f7a' },
  },
};
```

Verified with the current suite logic: body/muted text, status 3:1 on background/card, surface separability, border ≥ 1.2, input border 3:1, terminal ≥ 2.5, syntax ≥ 3 on card, chart ≥ 2.5 all pass. Derived accent fills: dark green `#34855e`, orange `#ad6134`; light green `#16804c`, orange `#c2410c` (hues already pass). White on each fill is 4.50–5.27:1. Note: light `ground` = `card` (`#f1f1ef`), `surface` = `background` (`#ffffff`), as the §2.2 rule requires.

### 4.2 The ink accent (`themes/types.ts`)

- `ACCENT_IDS` (`types.ts:38`) → `['ink', 'blue', 'violet', 'green', 'orange', 'rose', 'teal'] as const` (board order). `ACCENT_LABELS` adds `ink: 'Ink'`.
- `ACCENT_HUE` (`types.ts:51-58`) becomes `Record<HueAccentId, keyof HuePalette>` with `type HueAccentId = Exclude<AccentId, 'ink'>`.
- `accentEmphasis(spec, 'ink')` → `spec.foreground`. `themeAccents()` gives ink `{ primary: fg, emphasis: fg }`. `themeSwatch()` (`types.ts:525-528`) uses `fg` when `defaultAccent === 'ink'`.
- `AccentTokens` (`types.ts:241-248`) gains `onAccent: string`. `resolveAccentTokens()`: for hue accents `onAccent = spec.onAccent` (so legacy output is unchanged); for ink: `primary = primaryEmphasis = ring = sidebarAccentForeground = fg`, `accent = withAlpha(fg, TINT.accent[ap])`, `sidebarAccent = withAlpha(fg, TINT.sidebar[ap])`, `onAccent = surface` (lighter of background/card).
- Legacy CSS: `accentBlock()` (`css.ts:263-277`) also emits `--primary-foreground: ${a.onAccent}` (identical for hue accents; required for ink, or legacy primary buttons would render white on near-white in dark mode). `appearanceBlock()` uses `a.onAccent` for `--primary-foreground` instead of `t.primaryForeground`.
- Ink is available in all 18 themes (7 × 18 × 2 = **252** combinations, D-11).

### 4.3 Defaults and pinned-default code to change

| Where | Today | Change |
|---|---|---|
| `themes/index.ts:68` | `DEFAULT_THEME = 'github'` | `'instrument'` |
| `themes/index.ts:42-47`, header `:14-16` | product group starts with `github` | `instrument, github, graphite, carbon, clay`; update the header comment |
| `registry.ts` (new exports) | — | `DEFAULT_ACCENT: AccentId = 'ink'`, `DENSITIES = ['comfortable','compact']`, `DEFAULT_DENSITY = 'comfortable'`, `FONT_SIZES = ['12','13','14']`, `DEFAULT_FONT_SIZE = '13'`, storage keys (§11), `isKnownDensity`, `isKnownFontSize` |
| `registry.ts:34` | `DEFAULT_MODE = 'dark'` | unchanged |
| `apps/web/index.html:21-27` | `'dark'`/`'github'`/`'blue'` | generated block (§11) |
| `emit/native.ts:93` | sample `(DEFAULT_THEME,'dark','blue')` | `DEFAULT_ACCENT` |
| `packages/cli-core/src/config/schema.ts:56` | `z.enum(['blue',…,'teal']).default('blue')` | `z.enum(['ink','blue','violet','green','orange','rose','teal']).optional()` (theme default applies; cli-core does not depend on design-tokens, so the literal list is duplicated and a test in `apps/cli` asserts it equals `ACCENT_IDS`) |
| `packages/tui-kit/src/theme.tsx:116,124` | accent union without ink | `accent?: AccentId` imported from design-tokens |
| `emit/ansi.ts:142` | `primaryForeground: flat(tokens.primaryForeground)` | `flat(accents.onAccent)` |
| `apps/Documentation Site/scripts/generate-theme.mjs:21` | `--app-on-primary:${t.primaryForeground}` | `${a.onAccent}`; re-run `theme:generate` (default palette becomes instrument, 7 accents) |
| `tokens.test.ts:509-562` | "the default theme is unchanged" (GitHub) | rename to "the GitHub theme reproduces its original values"; assertions unchanged |
| `tokens.test.ts:146-152` | "same six accents" | "same seven accents" |
| `tokens.test.ts:190-202` | uses `tokens.primaryForeground` | use `resolveAccentTokens(...).onAccent` |
| mobile `ThemeProvider.tsx` | imports `DEFAULT_THEME` | picks up instrument automatically; no change in P1 |

---

## 5. Typography

### 5.1 Families (D-16)

| Role | Package (web) | Registered family name | Stack constant (`themes/fonts.ts`) |
|---|---|---|---|
| UI / prose | `@fontsource-variable/instrument-sans` | `"Instrument Sans Variable"` | `INSTRUMENT_SANS = '"Instrument Sans Variable", "Instrument Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'` |
| Machine text | `@fontsource-variable/jetbrains-mono` | `"JetBrains Mono Variable"` | `BUNDLED_MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'` |

- Import in `apps/web/src/main.tsx` before `./styles/globals.css` (line 9): the latin and latin-ext subset CSS files of each package (verify the exact filenames with `ls node_modules/@fontsource-variable/*/`; if per-subset `wght` files do not exist, import `wght.css`). Fontsource ships the whole `wght` axis; weights 400/500/600 are used.
- Rewrite the policy header of `themes/fonts.ts` (lines 1-13): "Two variable families are bundled (Instrument Sans, JetBrains Mono). Every theme stack names its own fonts first, then the bundled family, then generic system fonts. No font is ever fetched from a CDN."
- Stacks: `GEOMETRIC_SANS` → `'"Geist", "Inter Variable", "Inter", "Instrument Sans Variable", ui-sans-serif, system-ui, sans-serif'`; `HUMANIST_SANS` and `ROUNDED_SANS` likewise insert `"Instrument Sans Variable"` before their system fallbacks; `CODE_MONO` → `BUNDLED_MONO` with `"Fira Code"` after JetBrains; `PLEX_MONO` / `CASCADIA_MONO` insert `"JetBrains Mono Variable"` before `ui-monospace`. `SYSTEM_SANS` / `SYSTEM_MONO` (GitHub, One, …) are unchanged: the system font is that theme's choice.
- This changes rendered fonts on legacy pages for themes whose named fonts are not installed (Graphite, Carbon, Clay, Tokyo Night, Catppuccin, Ayu, Rosé Pine, Nord, Everforest, Flexoki, High Contrast). This is expected (D-16) and excluded from the "no visual change" check, which pins GitHub (§13).
- `apps/web/src/components/diff/diffTheme.ts:29`: `--diffs-font-family` → `var(--font-mono)`.
- `apps/web/scripts/check-bundle-size.mjs`: add `FONT_BUDGET_BYTES = 400 * 1024` over `dist/assets/*.woff2`, reported separately from the 800 KB JS budget (`:32`).
- `NATIVE_FONT_FAMILY` (`tokens.ts:90-93`) is not changed in P1 (mobile pass).

### 5.2 Type scale (D-13)

All sizes in px (the UI is dense and fixed-height; rem would let a browser default font size break control heights). The interface font-size setting shifts every step by −1 / 0 / +1 px through `data-font-size` on `<html>`, emitted as literal blocks.

| Step | Utility | 12 setting | **13 (default)** | 14 setting | Line height | Weight | Tracking | Use |
|---|---|---|---|---|---|---|---|---|
| micro | `text-micro` | 10 | **11** | 12 | 1.45 | 400 | 0 | meta, kbd, counts, time (usually mono) |
| small | `text-small` | 11 | **12** | 13 | 1.45 | 400 | 0 | secondary text, badges, chips, labels, hints; mono paths |
| ui | `text-ui` | 12 | **13** | 14 | 1.45 | 400 | 0 | UI default, nav, table cells, buttons |
| body | `text-body` | 13 | **14** | 15 | 1.6 | 400 | 0 | transcript prose, composer input |
| title | `text-title` | 15 | **16** | 17 | 1.3 | 600 | 0 | section title, dialog title |
| heading | `text-heading` | 19 | **20** | 21 | 1.3 | 600 | −0.01em | page title |
| display | `text-display` | 27 | **28** | 29 | 1.2 | 600 | −0.02em | Home hero, big numbers |

- Weights: `font-normal` (400), `font-medium` (500), `font-semibold` (600) only. `text-title/heading/display` carry weight 600 by default through `--text-<step>--font-weight`.
- Mono uses the same steps: `font-mono text-small` (12, paths/commands), `font-mono text-micro` (11, dense rows, kbd, times). There are no separate mono size tokens.
- Raw vars: `--gai-text-<step>`, `--gai-leading-<step>` (unitless), `--gai-weight-<step>`, `--gai-tracking-<step>`. Vocabulary: `--text-ui: var(--gai-text-ui); --text-ui--line-height: var(--gai-leading-ui); --text-title--font-weight: var(--gai-weight-title); --text-heading--letter-spacing: var(--gai-tracking-heading);` etc. (Tailwind 4.2 supports the `--line-height`, `--letter-spacing` and `--font-weight` sub-keys; the §10.2 compile test confirms this.)
- Avatar initials (the only 9/10 px text) live inside `ui/primitives/Avatar` as a component-local custom property (`--gai-avatar-font: 10px` at 20 px, `9px` at 18 px), exempted from the arbitrary-value lint for that one file.
- `body` in the hand-written tail (`font-size: 14px; line-height: 1.5`) stays for legacy pages; the new `AppFrame` sets `text-ui text-fg font-sans`.

### 5.3 Prose rules (new transcript and Streamdown output)

New class `.gai-prose` in the hand-written tail of `globals.css` (the legacy `.markdown-content` rules stay until P7):

| Element | Rule |
|---|---|
| root | `font-size: var(--gai-text-body); line-height: var(--gai-leading-body); color: var(--gai-fg)` |
| `p`, `ul`, `ol`, `pre`, `table`, `blockquote` | margin `0 0 8px`; first/last child margins 0 |
| `h1` | title step (16/600/1.3), margin `16px 0 8px` |
| `h2` | body size, 600, margin `14px 0 6px` |
| `h3`, `h4` | ui size, 600 (`h4` colour fg-2) |
| `li::marker` | `var(--gai-fg-3)` |
| `a` | `color: var(--gai-fg); text-decoration: underline; text-decoration-color: var(--gai-line-strong); text-underline-offset: 2px`; hover decoration `var(--gai-fg)` |
| inline `code` | mono, `font-size: var(--gai-text-small)`, `background: var(--gai-selected)`, radius `var(--gai-radius-badge)`, padding `1px 4px` |
| `pre` | `background: var(--gai-sunken)`, `1px solid var(--gai-line-soft)`, radius `var(--gai-radius-card)`, padding `10px 12px`, mono small, line-height 1.5 |
| `blockquote` | `border-left: 2px solid var(--gai-line)`, padding-left 12px, colour fg-2 (a quotation, not a callout) |
| `table` | `th`: small/500 fg-2, no uppercase, `border-bottom: 1px solid var(--gai-line)`; `td`: `border-bottom: 1px solid var(--gai-line-soft)`, padding `6px 10px` |
| `hr` | 1px `var(--gai-line-soft)`, margin 16px 0 |

---

## 6. Geometry, density, elevation, z-order, focus, icons, motion

### 6.1 Radius (D-14)

Each theme owns one base `r` = `ThemeDef.radius.DEFAULT`. `radiusScale(r)` (in `design.ts`) returns `badge r−2, control-sm r−1, control r, seg r+1, card r+2, panel r+4, dialog r+6`, each `max(2, …)`. Emitted per theme as literals `--gai-radius-<step>` in the theme chrome block (next to `--font-sans`, `css.ts:251-261`). Utilities: `rounded-badge`, `rounded-control-sm`, `rounded-control`, `rounded-seg`, `rounded-card`, `rounded-panel`, `rounded-dialog`; `rounded-full` (Tailwind default) for switches and dots. Legacy `--radius`, `--radius-lg`, `--radius-xl` are unchanged.

| Base r | Themes | badge | control-sm | control | seg | card | panel | dialog |
|---|---|---|---|---|---|---|---|---|
| 4 | graphite, nord, gruvbox, solarized, flexoki, contrast | 2 | 3 | 4 | 5 | 6 | 8 | 10 |
| 6 | **instrument**, github, one, dracula, tokyo-night, ayu, night-owl, everforest | 4 | 5 | 6 | 7 | 8 | 10 | 12 |
| 8 | carbon, catppuccin | 6 | 7 | 8 | 9 | 10 | 12 | 14 |
| 10 | clay, rose-pine | 8 | 9 | 10 | 11 | 12 | 14 | 16 |

Where each step is used (from the boards): badge = badges, kbd, checkbox, inline code; control-sm = 24 px buttons, `ib-sm`, segment buttons, menu items; control = buttons, inputs, chips, nav rows, avatars (square); seg = segmented track; card = cards, menus, popovers, callouts, radio cards, trays, code blocks; panel = main card, user message, approval cards; dialog = dialogs, composer box.

### 6.2 Spacing

Tailwind's default spacing (`0.25rem` multiples) stays. The design's effective steps map to: 2 → `0.5`, 4 → `1`, 6 → `1.5`, 8 → `2`, 10 → `2.5`, 12 → `3`, 14 → `3.5`, 16 → `4`, 20 → `5`, 24 → `6`, 28 → `7`, 32 → `8`. Named shell paddings are recipes in the kit (page body `px-7 py-6`, composer `pt-3 pr-2.5 pb-2 pl-3.5`, list header `pl-4 pr-2.5`), not tokens. `SPACING` (`tokens.ts:116-128`) stays for mobile.

### 6.3 Heights and density (D-15)

Emitted as `--gai-h-<name>` literals in `:root` (Comfortable) and `[data-density="compact"]`. Vocabulary: `--height-<name>: var(--gai-h-<name>)` gives `h-*`, `min-h-*`, `max-h-*`; `--size-<name>` is added for the three control sizes (square icon buttons: `size-control`).

| Name | Utility | Comfortable | Compact | Use |
|---|---|---|---|---|
| control-sm | `h-control-sm`, `size-control-sm` | 24 | 20 | small button, `ib-sm`, chip, segment button |
| control | `h-control`, `size-control` | 28 | 24 | button, icon button |
| control-lg | `h-control-lg`, `size-control-lg` | 32 | 28 | large button, input, select trigger, sidebar search |
| nav | `h-nav` | 30 | 26 | sidebar nav row |
| item | `h-item` | 30 | 26 | menu item, listbox option |
| step | `h-step` | 28 | 24 | transcript step row, tree row, section header (`.sec`) |
| th | `h-th` | 32 | 28 | table header |
| row | `h-row` | 44 | 36 | list/table row, two-line nav row |
| tab | `h-tab` | 36 | 32 | underline tabs |
| bar | `h-bar` | 44 | 44 | page header, dock header/tab strip (window-chrome alignment) |
| badge | `h-badge` | 20 | 20 | badge |
| kbd | `h-kbd` | 18 | 18 | kbd (min-width 18) |
| panel-bar | `h-panel-bar` | 40 | 40 | card headers, dock panel toolbars, Windows sidebar header row (`03-component-inventory-kit.md` §1.4) |
| dialog-bar | `h-dialog-bar` | 48 | 48 | dialog header, palette query row |
| footer | `h-footer` | 56 | 56 | action bars, dialog footers, two-line table rows |

Fixed (not density-dependent, component constants): checkbox 14, switch 28×16 (thumb 12), avatar 24 (20/18 in rows), dot 8 (6 inline, 7 notification), min hit area 24. No `h-7`-style literals in cva recipes (D-15).

### 6.4 Elevation

| Level | Recipe | Used by |
|---|---|---|
| 0 flat | background + `border-line-soft` or `border-line`; no shadow | cards, main card, tables, trays |
| 1 float | `bg-overlay border border-line shadow-pop rounded-card` | menus, popovers, selects, comboboxes, tooltips, toasts, floating bulk bar |
| 2 modal | level 1 + `rounded-dialog` over a `bg-scrim` backdrop | dialogs, command palette, settings modal, narrow dock sheet |

`shadow-pop` is the only shadow. Legacy `shadow-*` classes are counted by the ratchet.

### 6.5 Z-index scale

Tailwind 4.2 reads `--z-index-*` (verified in `tailwindcss/dist/lib.js`). Vocabulary emits:

| Name | Utility | Value | Layer |
|---|---|---|---|
| base | `z-base` | 0 | normal flow |
| sticky | `z-sticky` | 10 | sticky table/list headers, dock resize handle |
| dock | `z-dock` | 20 | narrow-window dock sheet inside the main card |
| dialog | `z-dialog` | 1000 | dialog, sheet and palette backdrops + popups |
| dropdown | `z-dropdown` | 1100 | menus, selects, comboboxes |
| popover | `z-popover` | 1100 | popovers, pickers |
| toast | `z-toast` | 1150 | sonner `<Toaster style={{ zIndex: 'var(--z-index-toast)' }}>` |
| tooltip | `z-tooltip` | 1200 | tooltips |

Popups rendered by Base UI portal to `<body>`, so a select opened inside a dialog must stack above the dialog: dropdown/popover are therefore above dialog. The values equal today's legacy primitives (`components/ui/primitives/dialog.tsx:25,46` and `alert-dialog.tsx:22,40` `z-[1000]`, `popover.tsx:23` and `dropdown-menu.tsx:45,63` `z-[1100]`, `tooltip.tsx:24` `z-[1200]`), so the new primitives keep stacking correctly next to legacy ones during migration. Legacy usages are **not** codemodded in P1 (they disappear with `components/ui`): `z-[1000]` ×7 (incl. `ui/Drawer.tsx:80`, `ui/Modal.tsx:77`, `shared/ModelPicker.tsx:394`), `z-[1100]` ×4, `z-[1200]` ×1, `z-[100]` ×5 (`chat/ChatInput.tsx:1698,1764,1807,1857`, `shared/ContextUsageGauge.tsx:232`), plus `z-10` ×15, `z-50` ×6, `z-40` ×3, `z-30`, `z-20`. Mapping for ports: `z-[1000]` → `z-dialog`, `z-[1100]` → `z-dropdown`/`z-popover`, `z-[1200]` → `z-tooltip`, local `z-[100]`/`z-10..50` → `z-sticky` or remove (portal instead). The ratchet gets a rule counting `z-\[\d+\]`.

### 6.6 Icons (D-17)

`ICON = { sizes: [12, 14, 16, 20] as const, defaultSize: 16, strokeWidth: 1.75 }` exported from `design-tokens/src/icons.ts`. Sizes map to Tailwind `size-3`, `size-3.5`, `size-4`, `size-5`. lucide `strokeWidth={1.75}` without `absoluteStrokeWidth` (the boards scale the stroke with the 24 viewBox). The registry is in §9.

### 6.7 Motion (D-20)

| Raw var | Value | Reduced |
|---|---|---|
| `--gai-duration-fast` | 120ms (`MOTION.fast`) | 0ms |
| `--gai-duration-normal` | 180ms | 0ms |
| `--gai-duration-slow` | 220ms | 0ms |
| `--gai-ease-standard` (vocabulary `--ease-standard`) | `cubic-bezier(0.2, 0, 0, 1)` | — |
| `--gai-ease-in-out` (vocabulary `--ease-in-out`, D-109) | `cubic-bezier(0.4, 0, 0.2, 1)` | — |

Design utilities (D-109): `duration-fast` · `duration-normal` · `duration-slow` (theme `--transition-duration-*`), `ease-standard`, `ease-in-out`. Expand / collapse and show / hide go through the hand-written `motion-*` utilities in globals.css ("Motion") and the kit's `Collapsible` / `Accordion` / `CollapsiblePanel` / `Reveal` (ui/primitives/Collapsible) and AppFrame — never ad-hoc transitions in features. The full list and rules: D-109, `reviews/motion.md`.

- `@utility transition-control { transition-property: color, background-color, border-color, outline-color, box-shadow, opacity; transition-duration: var(--gai-duration-fast); transition-timing-function: var(--gai-ease-standard); }`, the only transition kit components use (hover/press ≤ 120 ms).
- `@custom-variant reduced (&:where([data-motion="reduce"], [data-motion="reduce"] *));` so the kit can write `reduced:animate-none`.
- Generated block `[data-motion="reduce"] { --gai-duration-fast: 0ms; --gai-duration-normal: 0ms; --gai-duration-slow: 0ms; }` and a hand-written rule `[data-motion="reduce"] *, [data-motion="reduce"] *::before, [data-motion="reduce"] *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }` (mirrors the existing media rule at the end of `globals.css`). The Running glyph (`loader-circle`) then renders static.
- Skeletons do not shimmer (the design); legacy `.skeleton-shimmer` stays until P7.

---

## 7. Status system (D-18)

### 7.1 The 8 visual states

| State id | Label (default) | Glyph concept → lucide | Colour tokens | Badge recipe | Dot |
|---|---|---|---|---|---|
| `queued` | Queued | `status-queued` → `circle-dashed` | glyph `text-fg-3` | `bg-selected text-fg-2` | `bg-fg-3` |
| `running` | Running | `status-running` → `loader-circle` (spins; static under reduce) | `text-run` | `bg-run-bg text-run` | `bg-run` |
| `waiting` | Waiting | `status-waiting` → `clock` | `text-fg-2` | `bg-selected text-fg-2` | `bg-fg-2` |
| `needs_you` | Needs you | `status-needs-you` → `hand` | `text-warn` | `bg-warn-bg text-warn` | `bg-warn` |
| `paused` | Paused | `status-paused` → `circle-pause` | `text-fg-2` | `bg-selected text-fg-2` | `bg-fg-2` |
| `succeeded` | Succeeded (chat domain: **Done**) | `status-succeeded` → `circle-check` | `text-ok` | `bg-ok-bg text-ok` | `bg-ok` |
| `failed` | Failed | `status-failed` → `circle-x` | `text-err` | `bg-err-bg text-err` | `bg-err` |
| `skipped` | Skipped | `status-skipped` → `circle-minus` | `text-fg-3` | `bg-selected text-fg-2` | `bg-fg-3` |

Always glyph + word; 8 px dots only in dense rows. `text-run` etc. resolve to the AA-safe `--gai-*-text` values, `bg-run` etc. to the hue (§10.2). The `#a855f7` literals (`globals.css:5451,5517,5518,5637`) are not used by the new layer; they die with the legacy streaming styles.

### 7.2 Where and how

`packages/shared/src/status/` (new; exported from the package root `src/index.ts`; React-free; **no** dependency on design-tokens — glyphs are concept ids checked by a web test against `ICON_CONCEPTS`):

```ts
// states.ts
export const STATUS_STATES = ['queued','running','waiting','needs_you','paused','succeeded','failed','skipped'] as const;
export type StatusState = (typeof STATUS_STATES)[number];
export type StatusTone = 'fg-2' | 'fg-3' | 'run' | 'ok' | 'warn' | 'err';
export interface StatusStateDef { label: string; glyph: `status-${string}`; tone: StatusTone; badge: 'idle'|'run'|'ok'|'warn'|'err'; spin: boolean; }
export const STATUS_STATE_DEFS: Record<StatusState, StatusStateDef> = { /* §7.1 */ };

// maps.ts
export interface StatusMapping { state: StatusState; label?: string /* overrides the default word */; }
const m = (state: StatusState, label?: string): StatusMapping => (label ? { state, label } : { state });
export const STATUS_MAPS = {
  workflowRun: { … } satisfies Record<WorkflowRunStatus | 'pending', StatusMapping>,
  stageRun:    { … } satisfies Record<StageRunStatus, StatusMapping>,
  …
} as const;
export type StatusDomain = keyof typeof STATUS_MAPS;
export function toStatus<D extends StatusDomain>(domain: D, value: keyof (typeof STATUS_MAPS)[D]): StatusMapping | null;
export function chatActivity(input: { stream: StreamStatusValue; pendingInteraction: boolean }): StatusMapping | null;
export const STATUS_DOMAIN_LABELS: Partial<Record<StatusDomain, Partial<Record<StatusState, string>>>> = { chat: { succeeded: 'Done' } };
```

`satisfies Record<Union, StatusMapping | null>` makes a new server state a type error until it is mapped. `null` means "not a run status; render as plain metadata, not a badge". The union types are imported from `packages/shared/src/types/*` (same package). Client-core's duplicates (`RunStatus`, `StageRunStatus` in `packages/client-core/src/api/client.ts:426-463`) must become re-exports of the shared unions (see §14).

### 7.3 Complete mapping (server/client value → state, label override)

| Domain (type, file:line) | Mapping |
|---|---|
| `workflowRun`: `WorkflowRunStatus` (= workflow-spec `WorkflowRunState`) + client-core `'pending'` | created → queued; pending → queued; starting → running "Starting"; running → running; waiting → waiting; paused → paused; finalizing → running "Finalizing"; cancelling → running "Cancelling"; completed → succeeded; failed → failed; cancelled → skipped "Cancelled" (engine v2 states as merged from the Workflow Overhaul) |
| `stageRun`: `StageRunStatus` (= workflow-spec `StageRunState`) | pending → queued; ready → queued "Ready"; starting → running "Starting"; running → running; validating → running "Validating"; awaiting_input → needs_you; waiting → waiting; retry_wait → waiting "Retrying"; paused → paused; completed → succeeded; failed → failed; skipped → skipped; cancelled → skipped "Cancelled" |
| `automationExecution`: `AutomationExecutionStatus` `Automation.ts:138` | pending → queued; running → running; paused → paused; completed → succeeded; partial → failed "Partly failed"; failed → failed; cancelled → skipped "Cancelled"; skipped → skipped |
| `automationRunItem`: `AutomationRunItemStatus` `Automation.ts:147` | pending → queued; running → running; paused → paused; completed → succeeded; failed → failed; cancelled → skipped "Cancelled" |
| `backgroundTask`: `BackgroundTaskStatus` `Chat.ts:31-37` | spawned → queued "Starting"; running → running; needs_review → waiting "In review" (the orchestrator reads the result; D-87); completed → succeeded "Done"; failed → failed; cancelled → skipped "Cancelled" |
| `chat`: `ChatStatus` `Chat.ts:22` | active → null; archived → null (rendered as a neutral "Archived" chip) |
| `chatTurn`: `ChatTurnStatus` `ChatList.ts` (G-02 `summary.lastTurn.status`) | succeeded → succeeded (word "Done"); failed → failed; cancelled → skipped "Cancelled". The ChatsList Status column shows it when the chat is neither archived nor live (G-01 wins: `chatRowState` in client-core) |
| `stream` (chat activity): `StreamStatus` `packages/client-core/src/stream/types.ts:16` | idle → null; pending → running "Starting"; streaming → running; thinking → running "Thinking"; complete → succeeded "Done"; error → failed. `chatActivity()` returns needs_you whenever a pending plan/question/permission interaction exists (replaces `Header.tsx:254-286` `ChatStatusBadge`) |
| `session`: `SessionStatus` `Session.ts:6` | created → queued; active → null; paused → paused; closing → running "Closing"; closed → null; error → failed |
| `toolCall`: `ToolCallBlock.status` `stream/types.ts:57` (+ `error?: boolean`) | running → running; complete → succeeded, or failed when `error === true` (resolved by a helper `toolCallStatus(block)`) |
| `hook`: `StreamHookInvocation.status` `stream/types.ts:313` | running → running; ok → succeeded; failed → failed |
| `question`: `QuestionBlock.status` `stream/types.ts:164` | pending → needs_you; answered → succeeded "Answered"; expired → skipped "Expired" |
| `permission`: `PermissionBlock.status` `stream/types.ts:194` | pending → needs_you; allowed → succeeded "Allowed"; denied → skipped "Denied"; expired → skipped "Expired" |
| `plan`: `PlanStatus` `AgentMode.ts:170-186` | drafting → running "Drafting"; recorded → succeeded "Recorded"; awaiting_review → needs_you "Review"; changes_requested → running "Revising"; approved → succeeded "Approved"; rejected → skipped "Rejected"; superseded → skipped "Superseded"; expired → skipped "Expired" |
| `interaction`: `AgentInteractionStatus` `AgentMode.ts:334-343` | pending → needs_you; approved → succeeded "Approved"; changes_requested → succeeded "Changes requested"; answered → succeeded "Answered"; rejected → skipped "Rejected"; cancelled → skipped "Cancelled"; expired → skipped "Expired"; failed → failed |
| `reviewThread`: `ReviewThreadStatus` `apps/web/src/types/review.ts:9-15` (move the union to shared) | draft → queued "Draft"; pending → queued "Pending"; submitted → running "Sent"; addressed → succeeded "Addressed"; resolved → succeeded "Resolved"; outdated → skipped "Outdated" |
| `ciCheck`: `CheckConclusion` `SourceControl.ts:99` | pending → running; success → succeeded; failure → failed; neutral → skipped "Neutral"; cancelled → skipped "Cancelled"; unknown → null |
| `scmStep`: `ScmFlowStep.status` `SourceControl.ts:210` | done → succeeded; skipped → skipped; failed → failed; blocked → needs_you "Blocked" |
| `scmResult`: `ScmFlowResult.status` `SourceControl.ts:223` | ok → succeeded; conflicts → needs_you "Conflicts"; blocked → needs_you "Blocked"; failed → failed |
| `deviceLogin`: `DeviceLoginStatus.status` `SourceControl.ts:78` | pending → needs_you "Enter code"; complete → succeeded "Connected"; expired → skipped "Expired"; error → failed |
| `widget`: `WidgetInstanceStatus` `Widget.ts:106` and `WidgetBlock.status` `stream/types.ts:112` | active → null; suspended → paused "Suspended"; closed → null; error → failed |
| `browserSession`: `BrowserSessionStatus` `Workspace.ts:142-148` | off → null; starting → running "Starting"; active → null; idle → null; terminated → skipped "Closed"; error → failed |

Not run statuses, so **separate small maps** in the same folder, typed the same way:
- `HEALTH` (tone only: `ok | warn | err | idle`, rendered as dot + word): `ConnectionState` (`apps/web/src/stores/connectionStore.ts:9`: connected ok, reconnecting warn, disconnected err); computer runtime state (`HttpPlatformClient.ts:198`: ready ok, stopped idle, degraded warn, unavailable err); `/health` (`ok` ok, `degraded` warn); `CodebaseStatus` (`Project.ts:49`: pending idle, cloning run → shown as running badge, ready ok, error err, stale warn); `WorkspacePrepStatus` / `MountStatus` (`Workspace.ts:80,33`: pending/preparing idle|run, ready ok, error err, removed idle).
- `CHANGE_KIND` (letter + tone): added `A`/ok, modified `M`/fg-2, deleted `D`/err, renamed `R`/fg-2, untracked `U`/fg-3, ignored `I`/fg-3; PR files `removed` → `D`. Covers `ChangeStatus` (`apps/web/src/types/changes.ts:5`), `ChangeFileEntry.status` (`client-core/src/api/client.ts:551`), `CheckpointDiffFile.status` (`Checkpoint.ts:112`), `PullRequestFile.status` (`SourceControl.ts:127`), `TreeGitStatus` (`diff/ChangesTree.tsx:22-28`). Replaces `ChangesSurface.tsx:144-173`, `ChatChangesTray.tsx:58-70`, `FileViewerComponents.tsx:180-188`.
- Explicitly unmapped (no badge): `PullRequestState` (neutral chip text), `WorktreeStatus` / `WorktreeDetail.status`, `SttStatus`/`TtsStatus` (composer states), `CheckpointKind`. The preview-only unions `apps/web/src/components/chat/redesign/types.ts:9,97` and `components/workflow/redesign/types.ts:10-30` are deleted with their preview pages, not mapped.

Replaced local maps: `components/ui/StatusBadge.tsx:25-52` (19 keys; unknown values fall back to a neutral pill at `:64`, which the new typed map makes impossible), `chat/PlanCard.tsx:45-88`, `chat/BackgroundTasksPanel.tsx:22-29`, `workflow/RuntimeStageNode.tsx:24-99`, `workflow/StageNode.tsx:18-59`, `workflow/redesign/RunHeaderBar.tsx:47-56`, `diff/review/ReviewThreadCard.tsx:31-38`, `settings/sections/ComputerUse.tsx:19-30`, `status/ConnectionStatus.tsx:51-61`, `layout/Header.tsx:254-286`. They are replaced when their pages are ported. P1 only lands the map and its tests.

Tests (`packages/shared/src/status/__tests__/status.test.ts`): every value of every union maps (compile-time via `satisfies`, runtime via a list of literal arrays); every `STATUS_STATE_DEFS[*].glyph` exists in `ICON_CONCEPTS` (web test, `apps/web/src/ui/icons/__tests__`); chat domain `succeeded` label is "Done".

---

## 8. Chrome constants (D-23)

> **Canonical shape (final review).** The `CHROME` object's key layout is owned by `06-desktop-and-shell.md` §3.1 (flat groups: `CHROME.mac.*`, `CHROME.strip.*`, `CHROME.minWindow`, `CHROME.nativeNavRowHeight`, plus the shell widths main needs). The nested `mac/windows/linux` grouping in the first block below is an earlier draft: its **values** agree with §3.1 and stay valid, but code uses the §3.1 key names (e.g. `CHROME.strip.height`, not `CHROME.windows.titleStripHeight`). This section owns `SHELL` (renderer-only widths; fields that `CHROME` already has are re-exported from it, not redefined) and `CHROME_FALLBACK_COLORS`. Both land in task P1-S1.

New `packages/design-tokens/src/chrome.ts`, exported from the root and from a lean subpath `@generatorai/design-tokens/chrome` (`package.json` `exports["./chrome"] = "./src/chrome.ts"`), so the Electron main bundle does not pull in the theme tables.

```ts
export const CHROME = {
  mac: {
    headerRowHeight: 44,                         // traffic lights sit in the sidebar's top row
    trafficLightPosition: { x: 16, y: 16 },      // 12px buttons centred in 44
    trafficLightInset: 78,                       // x where the lights end (platform.ts:50)
  },
  windows: {
    titleStripHeight: 36,                        // titleBarOverlay.height
    captionButtonWidth: 46,
    captionButtonsWidth: 138,                    // 3 × 46 (platform.ts:53)
    stripControlHeight: 26,
    searchWidth: 420,
  },
  linux: {
    customTitleBarEnv: 'GENERATORAI_LINUX_CUSTOM_TITLEBAR',   // opt-in, then Windows layout
    customTitleStripHeight: 36,
  },
} as const;

export const SHELL = {
  sidebarWidth: 232, railWidth: 48, railBreakpoint: 1200, mainCardInset: 8,
  pageHeaderHeight: 44, dockWidth: 480, dockWidthRun: 440, dockSheetWidth: 380,
  serversPopoverWidth: 280, dialogWidth: { sm: 420, md: 640, lg: 960, xl: 1040 },   // = P-31 sizes
  pickerWidth: { model: 620, agent: 760 }, menuWidth: { min: 176, default: 240 },
} as const;

/** Instrument ground/fg per appearance, used before the renderer has pushed real colours. */
export const CHROME_FALLBACK_COLORS = {
  dark:  { background: '#0b0b0c', symbol: '#ededef' },
  light: { background: '#f1f1ef', symbol: '#18181b' },
} as const;
```

A test asserts `CHROME_FALLBACK_COLORS` equals `resolveDesignTokens(instrument, ap, 'ink')` ground/fg, so the literals cannot drift. `SHELL` widths are also emitted as `--gai-w-*` and vocabulary `--container-sidebar`, `--container-rail`, `--container-dock`, `--container-dock-run`, `--container-sheet`, `--container-dialog-sm|dialog|dialog-lg` (so `w-sidebar`, `max-w-dialog` work; Tailwind's `w-*`/`max-w-*` read `--container-*`). The mac rail inset is `--gai-page-inset-left: max(0px, 78px − railWidth − 0px)` = `30px` (the boards draw the main card flush with the rail, left margin 0), emitted by the generated desktop-chrome CSS block only for `.platform-darwin.titlebar-inset` in rail mode and not in fullscreen (`06-desktop-and-shell.md` §3.5).

Consumers:

| Consumer | Today | Uses | Phase |
|---|---|---|---|
| `apps/desktop/src/main/platform.ts:42` `TITLE_BAR_HEIGHT = 40`, `:50` `MAC_TRAFFIC_LIGHT_INSET`, `:53` `WINDOW_CONTROLS_WIDTH`, `:87` traffic lights, `:96-100` WCO, `:110-112` `windowChrome()` | local constants | `CHROME.*` (Windows 36, mac lights at y 16) | P3 (with the shell; switching earlier misaligns the legacy 40 px header) |
| `apps/desktop/src/main/platform.ts:69-71` `titleBarSymbolColor()` (`#e6edf3`/`#1f2328`) | GitHub literals | pushed `symbol`, else `CHROME_FALLBACK_COLORS` | P1 |
| `apps/desktop/src/main/window-manager.ts:69-73` `backgroundColor()` (`#0d1117`/`#ffffff`), `:418-420` `refreshTitleBarTheme` | GitHub literals | persisted pushed `background`, else fallback; `height: CHROME.strip.height` from P3 | P1 / P3 |
| `apps/desktop/src/main/prompt-window.ts:44` `backgroundColor: '#0d1117'` | literal | same as `backgroundColor()` | P1 |
| `apps/desktop/src/main/__tests__/window-manager.test.ts:120` mocks `TITLE_BAR_HEIGHT: 36` | mock | mock `CHROME` instead | P3 |
| `apps/desktop/package.json` | no workspace deps | add `"@generatorai/design-tokens": "workspace:*"` to **devDependencies** (tsup bundles devDependencies; `tsup.config.ts` externalises only electron/electron-updater) | P1 |
| `apps/web/src/lib/desktop.ts:110-119` (`--titlebar-*`, `<html>` classes) | reads `WindowChrome` from main | same classes; variables renamed `--titlebar-*` → `--gai-titlebar-*` and `data-layout` added (`06` §3.6); the rail-mode page inset is the CSS-only `--gai-page-inset-left` (`06` §3.5) | P3 |
| `apps/web/src/ui/shell/*` (AppFrame, Sidebar, Rail, TitleStrip) | — | `CHROME`, `SHELL` | P3 |
| `apps/desktop/resources/{splash,error,prompt}.html`, `src/main/browser-host.ts:162-165` annotate overlay `THEME` | GitHub literals | out of P1 scope; follow-up: splash reads the persisted background via query param; the annotate overlay receives colours through its existing `setTheme` call | later |

---

## 9. Icon concept registry (D-17)

`packages/design-tokens/src/icons.ts`:

```ts
export interface IconConceptDef { lucide: string; sfSymbol?: string; material?: string }
export const ICON_CONCEPTS = { home: { lucide: 'house' }, /* … */ } as const satisfies Record<string, IconConceptDef>;
export type IconConcept = keyof typeof ICON_CONCEPTS;
```

`sfSymbol` / `material` stay empty (filled in the mobile pass). `apps/web/src/ui/icons/registry.ts` maps each concept to an imported lucide component with `satisfies Record<IconConcept, LucideIcon>`. A test asserts `kebab(Component.displayName) === ICON_CONCEPTS[c].lucide` for every concept, which fails if a lucide 1.x rename was missed. Names below were resolved by matching the boards' SVG path data against lucide-react 0.460's icon nodes, then switched to the canonical lucide-react 1.x names in P1-U5 (1.48; the 0.x names survive only as aliases, which the displayName test rejects); the React component is the PascalCase form.

**Foundations registry (48 concepts; D-17 says 49, the board draws 48):**

| Concept | lucide | Concept | lucide | Concept | lucide |
|---|---|---|---|---|---|
| home | `house` | chats | `message-square` | projects | `folder` |
| agents | `bot` | workflows | `workflow` | automations | `calendar-clock` |
| scripts | `file-code-corner` | settings | `settings` | search | `search` |
| plus | `plus` | more | `ellipsis` | x | `x` |
| check | `check` | edit | `pencil` | trash | `trash` |
| copy | `copy` | changes | `git-compare` | files | `files` |
| terminal | `square-terminal` | browser | `globe` | tasks | `list-tree` |
| computer | `monitor` | plan | `list-checks` | widgets | `layout-grid` (same paths as `layout-dashboard` in 0.460; use `layout-grid`) |
| branch | `git-branch` | commit | `git-commit-horizontal` | pr | `git-pull-request` |
| diff | `file-diff` | history | `rotate-ccw-clock` | play | `play` |
| stop | `square` | retry | `rotate-ccw` | send | `arrow-up` |
| attach | `paperclip` | mic | `mic` | skills | `book-open` |
| mcp | `plug` | hook | `anchor` | variable | `variable` |
| webhook | `webhook` | clock | `clock` | server | `server` |
| lock | `lock` | key | `key-round` | bell | `bell` |
| info | `info` | warning | `triangle-alert` | hand | `hand` |

**Status glyphs (§7):** `status-queued` `circle-dashed`, `status-running` `loader-circle`, `status-waiting` `clock`, `status-needs-you` `hand`, `status-paused` `circle-pause`, `status-succeeded` `circle-check`, `status-failed` `circle-x`, `status-skipped` `circle-minus`.

**UI concepts used on the boards but missing from the Foundations list** (count = uses across the 60 boards): `chevron-down` (302), `chevron-right` (67), `chevron-up` (12), `chevron-left` (8), `sidebar` → `panel-left` (56), `dock` → `panel-right` (28), `maximize` → `maximize-2` (37), `shield` → `shield-check` (39), `file` (38), `folder-open` (27), `file-text` (19), `refresh` → `refresh-cw` (23), `forward` → `arrow-right` (23), `back` → `arrow-left` (10), `undo` → `undo-2` (16), `redo` → `redo-2` (9), `restart` → `rotate-cw` (11), `view` → `eye` (14), `upload` (14), `download` (4), `save` (11), `tool` → `wrench` (11), `scan` (11), `external-link` (10), `model` → `cpu` (10), `message` → `message-square-text` (10), `pointer` → `mouse-pointer-2` (9), `zoom-in` (9), `zoom-out` (9), `layers` (8), `archive` (7), `users` (7), `calendar` (7), `sort` → `arrow-up-down` (6), `link` (6), `camera` (6), `list` (5), `database` (5), `activity` (5), `zap` (5), `pause` (4), `tag` (4), `user` (4), `device` → `smartphone` (4), `mode-light` → `sun`, `mode-dark` → `moon`, `mode-system` → `monitor` (replaces `ModeDef.icon` in `registry.ts:24`), `power` (3), `more-vertical` → `ellipsis-vertical` (2), `minus` (1), `mention` → `at-sign` (1), `pin` (1).

lucide 1.x renamed three registry glyphs (0.460 `file-code-2` → `file-code-corner`, `trash-2` → `trash`, `history` → `rotate-ccw-clock`; same drawings). The `Github` brand icon is removed in lucide 1.x; its uses render `GitHubMark` from `apps/web/src/ui/icons/vendor/VendorIcons.tsx`, the home of every brand mark (D-17). The Spinner (P-12) draws the `loader` concept (`loader-circle`, the same glyph as `status-running`).

---

## 10. Generated artefacts and emitter changes, file by file

### 10.1 `packages/design-tokens/src/emit/css.ts`

Output order inside the `@generated-tokens` markers (`css.ts:337-431` today):

1. **L1 legacy values**: unchanged functions; `THEMES` now includes instrument, and `:root`/`.light` are emitted from instrument (the default). Accent blocks gain `--primary-foreground`; ink blocks are added for every theme whose default is not ink; instrument gets blocks for the six hue accents.
2. **L1b design values** (`--gai-*` colours), with the **same specificity ladder** in its own section so P7 can delete L1 wholesale:
   - `:root { color-scheme: dark; …all DesignTokens for (default theme, dark, default accent)… }`, `.light { … light … }`;
   - per theme, dark then light: `[data-theme="x"] { … }`, `.light[data-theme="x"] { … }` (default theme included, so an explicit attribute fully describes the theme);
   - per theme × non-default accent: `[data-theme="x"][data-accent="a"] { --gai-accent; --gai-on-accent; --gai-focus }` then `.light[data-theme="x"][data-accent="a"] { … }`.
   - Per-theme non-colour block (in the existing `themeChromeBlock`, `css.ts:251-261`): `--gai-radius-badge … --gai-radius-dialog` literals.
3. **L1c axis blocks** (appearance- and theme-independent): `:root { --gai-h-*: comfortable; --gai-text-*/leading/weight/tracking: 13-setting; --gai-duration-*; --gai-ease-standard; --gai-w-* }`, then `[data-density="compact"] { --gai-h-* }`, `[data-font-size="12"] { --gai-text-* }`, `[data-font-size="14"] { --gai-text-* }`, `[data-motion="reduce"] { --gai-duration-*: 0ms }`. Each is a single attribute selector (0,1,0) emitted after `:root` (also (0,1,0): `:root` is a pseudo-class, so the existing comment at `css.ts:19` stating (0,0,0) is wrong, though the ladder still works through source order).
4. **L2 legacy `@theme inline`**: `THEME_COLOR_VARS` after §3 (no `accent`, `accent-foreground`, `surface`, `surface-hover`, `raised`, `overlay`, `chart-*`, `canvas-*`; adds `accent-tint`), plus `--font-sans`/`--font-mono`.
5. **L3 legacy compat** (`:root { --color-*: var(--*) }`), same list as L2. New names get **no** compat alias: new code uses utilities or `var(--gai-*)`.
6. **L4 hljs rules**: unchanged (deleted in P4 when Shiki lands, D-33).

`data-mode` is the stored *preference* (`system|light|dark`) and is not a CSS key. The resolved appearance is the `.light`/`.dark` class (the `dark:` variant is `@custom-variant dark (&:is(.dark *))`, `globals.css:4`). Selectors are unqualified, so the same attributes on a Storybook decorator element theme a subtree.

### 10.2 Shared class vocabulary: `packages/design-tokens/src/vocabulary.ts` + `emit/vocabulary.ts` → `packages/design-tokens/css/vocabulary.css`

`vocabulary.ts` exports name lists (single source for CSS, tailwind-merge and lint):
`COLOR_NAMES` (§2.3 names plus `run-text` etc. excluded), `TEXT_COLOR_OVERRIDES = { run: 'run-text', ok: 'ok-text', warn: 'warn-text', err: 'err-text' }`, `TEXT_STEPS`, `RADIUS_STEPS`, `HEIGHT_NAMES`, `SIZE_NAMES`, `Z_NAMES`, `SHADOW_NAMES = ['pop']`, `CONTAINER_NAMES`, `SHARED_COLOR_NAMES` (`chart-1..6`, `canvas-bg`, `canvas-dot`).

`vocabulary.css` (generated, committed, checked):

```css
/* GENERATED from packages/design-tokens — do not edit. */
@theme inline {
  --color-ground: var(--gai-ground);        /* … one line per COLOR_NAMES entry */
  --color-accent: var(--gai-accent);
  --color-run: var(--gai-run);              /* bg-run, border-run, stroke-run, fill-run = hue */
  --text-color-run: var(--gai-run-text);    /* text-run = AA-safe text colour (Tailwind reads --text-color-* before --color-*) */
  --color-chart-1: var(--chart-1);          /* shared layer, survives P7 */
  --text-micro: var(--gai-text-micro);
  --text-micro--line-height: var(--gai-leading-micro);
  --text-title--font-weight: var(--gai-weight-title);
  --text-heading--letter-spacing: var(--gai-tracking-heading);
  --radius-card: var(--gai-radius-card);
  --height-row: var(--gai-h-row);
  --size-control: var(--gai-h-control);
  --shadow-pop: var(--gai-shadow-pop);
  --z-index-dialog: 1000;
  --ease-standard: var(--gai-ease-standard);
  --container-sidebar: var(--gai-w-sidebar);
}
```

- `package.json` `exports["./css/vocabulary.css"] = "./css/vocabulary.css"`; add `"css"` to `files`.
- `apps/web/src/styles/globals.css`: add `@import "@generatorai/design-tokens/css/vocabulary.css";` directly after `@import "tailwindcss";` (line 1). If Tailwind's resolver cannot resolve the package export in Vite, use the relative path `../../../../packages/design-tokens/css/vocabulary.css` and record it.
- Mobile (next pass): Uniwind's `global.css` imports the same file; the native side provides `--gai-*` values.
- **Compile test** (`apps/web/src/ui/lib/__tests__/vocabulary.test.ts`): uses `compile()` from `tailwindcss` on `@import "tailwindcss"; @import "<vocabulary.css>";` and builds candidates `bg-ground text-fg-2 text-run bg-run text-title rounded-card h-row size-control z-dialog shadow-pop w-sidebar`; asserts each produces a rule referencing the expected `--gai-*` var and that `text-title` emits `font-weight: var(--gai-weight-title)`.

### 10.3 tailwind-merge v3 (D-09)

`vocabulary.ts` exports `twMergeExtension()`:

```ts
export function twMergeExtension() {
  return {
    extend: {
      theme: {
        color: [...COLOR_NAMES, ...SHARED_COLOR_NAMES, ...LEGACY_COLOR_NAMES /* from css.ts THEME_COLOR_VARS */],
        text: [...TEXT_STEPS],            // text-title is a size, not a colour
        radius: [...RADIUS_STEPS],
        shadow: [...SHADOW_NAMES],
        container: [...CONTAINER_NAMES],
        ease: ['standard'],
      },
      classGroups: {
        h: [{ h: [...HEIGHT_NAMES] }], 'min-h': [{ 'min-h': [...HEIGHT_NAMES] }], 'max-h': [{ 'max-h': [...HEIGHT_NAMES] }],
        size: [{ size: [...SIZE_NAMES] }], z: [{ z: [...Z_NAMES] }],
      },
    },
  } as const;
}
```

`apps/web/src/ui/lib/cn.ts`: `const twMerge = extendTailwindMerge(twMergeExtension()); export const cn = (...i: ClassValue[]) => twMerge(clsx(i));` (runtime import, no generated file, so no drift). Upgrade `tailwind-merge` `^2.6.1` → `^3` in `apps/web/package.json`. Conflict test (`cn.test.ts`), each pair must keep both or the last as stated: `cn('text-fg-2','text-title')` keeps both; `cn('text-fg','text-fg-2')` → `text-fg-2`; `cn('text-ui','text-body')` → `text-body`; `cn('bg-surface','bg-raised')` → `bg-raised`; `cn('rounded-control','rounded-card')` → `rounded-card`; `cn('h-control','h-control-sm')` → `h-control-sm`; `cn('h-row','h-8')` → `h-8`; `cn('size-control','size-4')` → `size-4`; `cn('z-dialog','z-tooltip')` → `z-tooltip`; `cn('shadow-pop','shadow-none')` → `shadow-none`; `cn('border-line','border-line-strong')` → `border-line-strong`; `cn('border','border-line')` keeps both. The legacy `apps/web/src/lib/utils.ts` `cn` switches to re-export this one.

### 10.4 `packages/design-tokens/src/emit/native.ts` (additive)

- `resolveTokenSet()` (`native.ts:52-89`): after the legacy keys, add every `DESIGN_COLOR_VARS` entry as `--gai-*` with literal values (translucent tokens stay `#rrggbbaa`, which RN accepts); set `--primary-foreground` to `a.onAccent`; accept `ink`.
- `tailwindColorNames()` (`:92-95`): filter out `--gai-*` keys so mobile's current NativeWind config gets no new utilities in P1.
- New exports in the generated file: `gaiColors` (design name → `var(--gai-name)`, for the mobile pass), `accentIds`, and `themeMeta[].radiusBase` + `radiusScale`.
- `fontSize`, `lineHeight`, `radius`, `spacing`, `motion` exports unchanged (mobile geometry is the next pass, D-40). Size grows from 14,526 lines by about 7,000 (27 keys × 18 × 2 × 7). The emit test's "one bag per theme × appearance × accent" now covers 7 accents.

### 10.5 `packages/design-tokens/src/emit/ansi.ts`

`buildTerminalTheme` uses `accents.onAccent` (line 142). Everything else is unchanged; ink gives `primary = foreground`. `ansi.test.ts` adds an ink case.

### 10.6 Pre-paint emitter `emit/prepaint.ts` (new) → `apps/web/index.html`

`emitPrepaint()` returns the `<script>` of §11 with `THEME_DEFAULT_ACCENT`, the valid id lists and the storage keys inlined from the registry. `splicePrepaint()` replaces the region between `<!-- @generated-prepaint:start -->` and `<!-- @generated-prepaint:end -->` (markers added in `<head>`; the current inline script at `index.html:11-38` is removed).

### 10.7 `bin/generate.ts` targets (`generate.ts:31-48`)

Add: `{ label: 'web pre-paint script', path: apps/web/index.html, render: splicePrepaint }` and `{ label: 'shared class vocabulary', path: packages/design-tokens/css/vocabulary.css, render: emitVocabularyCss }`. `tokens:check` (root `check:tokens`, part of `pnpm lint`) then fails on any stale globals.css, index.html, vocabulary.css or mobile module.

### 10.8 Docs site

`apps/Documentation Site/scripts/generate-theme.mjs` reads `THEMES`, `ACCENT_IDS`, `DEFAULT_THEME`, `resolveAppearanceTokens` and `resolveAccentTokens` (`:5`). With the §4 changes it emits instrument + 7 accents; fix `:21` to `a.onAccent` and run `pnpm --filter "./apps/Documentation Site" theme:generate`, then commit `src/theme-data/palettes.{json,css}` and `audit/theme-tokens.json`. No `AppearanceTokens` field is renamed, so nothing else breaks. `apps/web/scripts/check-theme-contrast.mjs` (not wired to CI) parses legacy vars from globals.css; run it once after the ink PR; it is deleted in P7.

### 10.9 Files touched in `packages/design-tokens`

`src/color.ts` (oklabMix, ensureContrastAll) · `src/themes/types.ts` (ink, sunken, textContrast, onAccent, TINT) · `src/themes/instrument.ts` (new) · `src/themes/contrast.ts` (`textContrast: 7`) · `src/themes/fonts.ts` · `src/themes/index.ts` · `src/registry.ts` · `src/design.ts` (new: DesignTokens, resolveDesignTokens, DESIGN_COLOR_VARS, radiusScale, TYPE_SCALE, HEIGHTS, Z_INDEX, MOTION_CSS, SCRIM, SHADOW) · `src/vocabulary.ts` (new) · `src/icons.ts` (new) · `src/chrome.ts` (new) · `src/index.ts` (export all) · `src/emit/{css,native,ansi,prepaint,vocabulary}.ts` · `bin/generate.ts` · `package.json` (exports `./chrome`, `./css/vocabulary.css`).

---

## 11. Pre-paint script and ThemeProvider (D-25)

### 11.1 Storage keys (`registry.ts`)

| Axis | Key | Values | Default |
|---|---|---|---|
| mode | `generatorai-theme` (existing `MODE_STORAGE_KEY`, `registry.ts:53`) | `system` `light` `dark` | `dark` |
| theme | `generatorai-theme-palette` (existing) | 18 ids | `instrument` |
| accent | `generatorai-accent` (existing) | 7 ids | the theme's `defaultAccent` (`ink` for instrument) |
| density | `generatorai-density` (new `DENSITY_STORAGE_KEY`) | `comfortable` `compact` | `comfortable` |
| font size | `generatorai-font-size` (new `FONT_SIZE_STORAGE_KEY`) | `12` `13` `14` | `13` |
| reduce motion | `generatorai-reduce-motion` (new `REDUCE_MOTION_STORAGE_KEY`) | `1` = always; absent = follow OS | absent |

### 11.2 Generated script (in `<head>`, before any stylesheet link)

```html
<!-- @generated-prepaint:start -->
<script>
(function () {
  var TA = {"instrument":"ink","github":"blue", /* …every theme id → defaultAccent… */};
  var A = ["ink","blue","violet","green","orange","rose","teal"], D = ["comfortable","compact"], F = ["12","13","14"];
  function g(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function mq(q) { try { return matchMedia(q).matches; } catch (e) { return false; } }
  var mode = g("generatorai-theme"); if (mode !== "light" && mode !== "dark" && mode !== "system") mode = "dark";
  var theme = g("generatorai-theme-palette"); if (!Object.prototype.hasOwnProperty.call(TA, theme)) theme = "instrument";
  var accent = g("generatorai-accent"); if (A.indexOf(accent) < 0) accent = TA[theme];
  var density = g("generatorai-density"); if (D.indexOf(density) < 0) density = "comfortable";
  var fs = g("generatorai-font-size"); if (F.indexOf(fs) < 0) fs = "13";
  var resolved = mode === "system" ? (mq("(prefers-color-scheme: dark)") ? "dark" : "light") : mode;
  var r = document.documentElement;
  r.classList.add(resolved);
  r.setAttribute("data-mode", mode); r.setAttribute("data-theme", theme); r.setAttribute("data-accent", accent);
  r.setAttribute("data-density", density); r.setAttribute("data-font-size", fs);
  if (g("generatorai-reduce-motion") === "1" || mq("(prefers-reduced-motion: reduce)")) r.setAttribute("data-motion", "reduce");
})();
</script>
<!-- @generated-prepaint:end -->
```

Unlike today's script (`index.html:17-38`), it validates stored ids (a removed theme can no longer paint an unthemed frame) and resolves the default accent per theme, exactly as `resolveAccentId()` (`themes/index.ts:101-105`) does. Without that, a user with a stored `github` and no stored accent would paint ink and then flash to blue.

### 11.3 ThemeProvider (`apps/web/src/providers/ThemeProvider.tsx`)

- Context adds `density`/`setDensity`, `fontSize`/`setFontSize` and `reduceMotion: 'system' | 'on'`/`setReduceMotion`. (A `designTokens` context value for canvases and xterm was planned but not built: xterm takes `resolveTerminalPalette()` directly and canvases read CSS variables; add it only when a consumer needs `DesignTokens` literals.)
- Effects (same one-attribute-per-effect pattern as `:135-155`): `data-density`, `data-font-size`, `data-motion` (`reduce` when `on` or the OS media query matches; subscribe to `(prefers-reduced-motion: reduce)` changes).
- It remains the only DOM writer of these attributes. The native menu (`apps/desktop/src/main/menu.ts:380-389` `setTheme`) keeps sending the preference to the renderer, which applies it through `setMode`. It must stop writing `nativeTheme.themeSource` directly; main sets `themeSource` only in response to the renderer (via the chrome push below).
- **Desktop background push:** after mount and whenever `themeId`, `resolvedTheme` or `accent` change (debounced 50 ms, `DESKTOP_PUSH_DEBOUNCE_MS`; same as `06` §6.1), call the guarded **`IPC.setAppearance`** with `{ mode, themeId, groundLight, groundDark, fgLight, fgDark }` computed by `chromeColors()` from the token package (hex literals for **both** appearances, never `getComputedStyle`). The IPC contract, validation schema (`SETTING_SCHEMAS.appearance`), `themeSource` mirroring and persistence are owned by `06-desktop-and-shell.md` §6.2–§6.4 — an earlier draft of this bullet used a `setChromeColors` channel; that name is superseded. Main calls `win.setBackgroundColor`, repaints the WCO symbol colour on Windows/Linux-custom, and `window-manager.ts:69-73` returns the persisted ground for the current appearance, else `CHROME_FALLBACK_COLORS[dark ? 'dark' : 'light'].background`.

---

## 12. WCAG test suite (`packages/design-tokens/src/__tests__`)

New file `design.test.ts`. `MATRIX7` = 18 themes × 2 appearances × 7 accents = **252** entries, each `{ label, tokens: resolveDesignTokens(...) }`. Thresholds use `min = theme.textContrast ?? 4.5`. Translucent tokens are composited with `flatten` before measuring (as the existing tint test does).

| # | Assertion | Scope |
|---|---|---|
| 1 | `fg`, `fg-2`, `fg-3` ≥ `min` on ground, surface, raised, overlay, sunken, hover∘surface, hover∘ground, selected∘surface, selected∘ground | 36 (theme × appearance) |
| 2 | explicit regression: instrument dark `fg-3` on overlay ≥ 4.5 (the board's 4.30 case, D-12) | 1 |
| 3 | ordering: `contrast(fg3, surface) ≤ contrast(fg2, surface) ≤ contrast(fg, surface)` | 36 |
| 4 | `line-strong` ≥ 3 on ground, surface, raised, overlay, sunken (checkbox, switch, input borders) | 36 |
| 5 | `line` ≥ 1.2 on ground, surface, overlay (mirrors `tokens.test.ts:356-366`) | 36 |
| 6 | `run/ok/warn/err` (hue) ≥ 3 on ground, surface, raised, overlay | 36 |
| 7 | `run/ok/warn/err-text` ≥ `min` on `<state>-bg`∘surface, ∘ground, ∘raised, and on ground, surface, raised, overlay, sunken | 36 |
| 8 | status hues distinguishable (reuse the metric at `tokens.test.ts:246-269`, pairs ok/err, ok/warn, warn/err, run/ok, run/err) on the **hue** tokens | 36 |
| 9 | `on-accent` on `accent` ≥ 4.5 | **252** |
| 10 | `focus` ≥ 3 on ground, surface, raised, overlay, sunken | **252** |
| 11 | ink: `accent === fg`, `onAccent === surface`, `focus === fg` | 36 |
| 12 | `fg` ≥ `min` on add-bg∘surface and del-bg∘surface | 36 |
| 12b | dialogs: `overlay` is opaque (so row 1's overlay figure is what the reader sees over the scrim) and `scrim` is translucent and darkens `surface` | 36 |
| 13 | High Contrast: 1 and 7 at 7:1 | 2 |
| 14 | Instrument pins: ground/surface/raised/overlay/sunken/fg/fg-2 equal the board hexes; fg-3, line, line-strong, `*-text` equal the §2.3 values | 2 |
| 14b | floating layers (D-165): fg/fg-2/fg-3 and `*-text` ≥ `min`, `line-strong` and `focus` ≥ 3 on the re-based sunken; re-based sunken and line-soft keep their page step on overlay; Instrument pins `#1a1a1e`/`#27272b` (dark), `#f6f6f4`/`#ecece9` (light) | 252 |
| 15 | `CHROME_FALLBACK_COLORS` equals instrument ground/fg | 2 |
| 16 | density and font size do not affect colour: `resolveDesignTokens` takes no density/font-size input (type-level), and the emit test asserts `[data-density=…]` blocks contain only `--gai-h-*` and `[data-font-size=…]` blocks only `--gai-text-*`/`--gai-leading-*` | emit |

`color.test.ts` additions: `oklabMix` endpoints and midpoint (`#000000`→`#ffffff` at 0.5 gives L≈0.5 grey `#636363`); hex round-trip; `ensureContrastAll` returns input unchanged when it already passes, and always reaches the ratio for a set of 3 backs.

`emit.test.ts` additions: every `DESIGN_COLOR_VARS` name appears in `:root` and in each theme block; L1b ladder order (dark theme < light theme < accent dark < accent light, per theme) asserted like `emit.test.ts:62-81`; ink accent blocks exist for all 17 non-ink-default themes; no unscoped `[data-accent]` selector in L1b; `--color-accent-tint: var(--accent)` bridged and `--color-accent: var(--accent)` absent; `vocabulary.css` output contains every `COLOR_NAMES` entry and `--text-color-run`; per-theme `--gai-radius-card` present; the prepaint output contains every theme id and `"instrument"` as the fallback.

Existing tests to update (all in `tokens.test.ts` unless noted): `:146-152` six → seven accents; `:190-202` use `onAccent`; `:509-562` rename (GitHub-specific, assertions unchanged); `emit.test.ts:83-105` add `--gai-ground`, `--gai-fg-3`, `--gai-radius-card`, `--gai-h-row`; `emit.test.ts:124-130` also check `--gai-radius-card:` per theme; `emit/__tests__/ansi.test.ts` add ink (`primaryForeground` = surface); `emit.test.ts:149-160` add `"--gai-ground"` to the native bundle check.

Before any of this is written, the §2.2 algorithm was run over all 34 variants: every assertion above passes with the listed derivations (no theme needs an authored override other than instrument's `border`).

---

## 13. P1 token work: ordered checklist (PR-sized)

Baseline for every "no visual change" check: build and start the app (`pnpm --filter @generatorai/web build`, server on its usual port), then with `node_modules/.bin/playwright-cli --browser=chrome --headed` set `localStorage` to `generatorai-theme-palette=github`, `generatorai-accent=blue`, and `generatorai-theme` = `dark` then `light`, and screenshot **`/` (Dashboard), `/chats`, `/workflows`** at 1440×900. Take the screenshots before the PR (on the base commit) and after it, and compare them with a pixel diff (`pixelmatch` or ImageMagick `compare -metric AE`). Expected AE = 0 unless the step says otherwise. Also run `pnpm check:tokens`, `pnpm --filter @generatorai/design-tokens test`, `pnpm --filter @generatorai/web typecheck test`, `pnpm --filter @generatorai/web check:design`.

1. **P1-T1 Collision codemod** (§3). Emitter list change + codemod + regenerate. *Accept:* the grep checks return 0 hits; AE = 0 on all 6 screenshots; `bg-accent`, `bg-surface`, `bg-raised`, `bg-overlay` generate nothing (compile check) until T5.
2. **P1-T2 Colour utilities** (`oklabMix`, `ensureContrastAll`, `TINT` additions) + unit tests. *Accept:* tests green; generated files unchanged (`tokens:check` passes with no rewrite).
3. **P1-T3 Ink accent + `onAccent`** (§4.2): types, legacy emitter (`--primary-foreground` in accent blocks, ink blocks), ANSI, native additive `--primary-foreground`, docs-site generator, cli-core/tui-kit unions, test updates. *Accept:* AE = 0 (GitHub/blue); a manual screenshot with `generatorai-accent=ink` shows fg-coloured primary buttons with readable labels in dark and light; `git diff` of globals.css shows only added ink blocks and added `--primary-foreground` lines whose values equal the appearance block's.
4. **P1-T4 Instrument theme + defaults** (§4.1, §4.3; fonts not yet bundled): `instrument.ts`, registry order, `DEFAULT_THEME`, `DEFAULT_ACCENT`, `contrast.ts` `textContrast`, test renames, temporary hand edit of the index.html defaults (replaced in T8). *Accept:* the existing suite passes including instrument; AE = 0 with GitHub pinned; with cleared storage the legacy pages render in Instrument colours (screenshot attached to the PR).
5. **P1-T5 Design colour layer**: `design.ts` colours, L1b emission, `vocabulary.ts` + `vocabulary.css` + `@import`, the shared-layer bridge move (chart/canvas), native additive `--gai-*`, `design.test.ts` (§12 rows 1-12, 14), compile test (§10.2). *Accept:* 252-combination suite green; `tokens:check` green; AE = 0 (no legacy page uses the new names yet).
6. **P1-T6 Scales**: radius scale, type scale + font-size blocks, heights + density blocks, z-index, motion vars, `@utility focus-ring`, `@utility transition-control`, `@custom-variant reduced`, `.gai-prose`, shell width vars; emit tests (§12 row 16). *Accept:* compile test covers `text-title`, `rounded-card`, `h-row`, `size-control`, `z-dialog`, `w-sidebar`; AE = 0.
7. **P1-T7 Fonts** (§5.1): Fontsource packages, imports, stack changes, `diffTheme.ts:29`, font budget in `check-bundle-size.mjs`. *Accept:* the Network panel in the built app shows only local `.woff2` requests; `check:bundle` passes both budgets; AE = 0 for GitHub (system stack); visual change allowed for Graphite and other named-font themes.
8. **P1-T8 Pre-paint + ThemeProvider axes + desktop push** (§11): prepaint emitter/target, ThemeProvider state/effects, IPC `setAppearance`/`appearanceRequest` per `06-desktop-and-shell.md` §6.2, settings schema, `window-manager.ts`/`platform.ts`/`prompt-window.ts` colours, desktop devDependency. *Accept:* `tokens:check` covers index.html; a cold load with `generatorai-density=compact` has `data-density="compact"` on `<html>` before `main.tsx` runs (check with playwright-cli `eval` on `DOMContentLoaded`); desktop: switch to Solarized light, quit, relaunch, and the first frame is `#eee8d5` (screenshot of the empty window); AE = 0.
9. **P1-T9 tailwind-merge v3 + `cn`** (§10.3). *Accept:* conflict test green; web tests green; AE = 0.
10. **P1-T10 Status map** in `packages/shared/src/status` (§7) + tests; client-core `RunStatus`/`StageRunStatus` re-export shared unions. *Accept:* `pnpm -r typecheck` green; removing any mapping entry makes `tsc` fail (demonstrated in the PR description).
11. **P1-T11 Icon concepts** (§9): `icons.ts` + tests. `CHROME`/`SHELL` (`chrome.ts`, `./chrome` export, fallback-colour test, §8) are task **P1-S1** in `07-phases.md`, where `platform.ts`/`window-manager.ts` switch to `CHROME.minWindow` only; the geometry switch is P3-04. The lucide 1.x upgrade and `ui/icons` registry with its name test land in the D-37 upgrade PR; if that PR lands first, the registry test runs against 1.x names immediately. *Accept:* tests green; no consumer changes yet (platform.ts switches in P3).

---

## 14. Issues with decisions, and open design feedback

### 14.1 Issues with decisions

**Status (final review, 2026-09-25):** all nine are reconciled. 1–3 → D-12 (and D-08 now lists `focus` and the text/hue split); 4 → D-06 + P1-T1; 5 → D-18 (19 statuses) + P1-T10; 6 → D-17 (48 concepts); 7 → D-25; 8 → D-41; 9 is a code-comment fix done while editing `css.ts`. The text below is kept as the evidence.

1. **D-12, line-strong.** D-12 says `line-strong` "uses the existing `inputBorder()` 3:1 derivation". `inputBorder()` (`types.ts:385-391`) only guarantees 3:1 against `background` and `card`. Measured on the new surfaces, it falls below 3:1 on `raised`/`overlay` in 18 of 34 variants (inputs inside dialogs sit on overlay). This spec uses `ensureContrastAll(border, [ground, surface, raised, overlay, sunken], 3, fg)` for `--gai-line-strong`. That value differs from `inputBorder()` in 32 of 34 variants. Legacy `--input` keeps `inputBorder()`.
2. **D-12, fg-3.** The "82 % OKLab mix" misses 4.5:1 in 31 of 34 variants. Clamped as specified, fg-3 ends up near fg-2 in most themes (mix share ≤ 5 % in 15 variants, equal to fg-2 in 5). Instrument keeps a visible step (15 % dark, 9 % light). Also, `mutedForeground` itself (the new `fg-2`) is below 4.5 on overlay, raised or selected rows in 4 variants (github light, rose-pine dark, everforest dark, solarized dark), so `--gai-fg-2` is clamped too. D-12 does not mention either effect. The rest of D-12 stands.
3. **D-08 / D-12, status text and focus.** Status hues used as badge **text** (12 px) are below 4.5:1 on their own tint in 20+ variants. Clamping the hue itself destroys status distinguishability in 17 variants (everforest dark would move every hue 57–71 % toward fg). This spec therefore adds text variants (`--gai-run-text` …), wired so that `text-run` resolves to them and `bg-run` to the hue, through Tailwind's `--text-color-*` namespace. The accent fill is below 3:1 against at least one surface in 22 theme × accent combinations (nord dark, one dark, clay dark, tokyo-night dark blue, solarized dark …), so this spec adds `--gai-focus` (`ring-focus`/`outline-focus`/`border-focus`). D-08's vocabulary list should add `focus` and note the text/hue split.
4. **D-06 collision list.** Legacy `raised` and `overlay` have 0 usages in `apps/web/src`, so the codemod D-06 anticipates for them is unnecessary: they are only dropped from the legacy bridge. The real collisions are `accent` (126 sites) and `surface` (5 sites, including `surface-hover`).
5. **D-18 count.** `StatusBadge.tsx` maps 19 statuses (`:25-52`), not 17. Client-core redefines `RunStatus` (adds `'pending'`) and `StageRunStatus` (`packages/client-core/src/api/client.ts:426-463`) instead of importing the shared unions. `SessionStatus` (`Session.ts:6`) is narrower than the DB enum (`packages/db/src/schema.ts:34-40`). The status map keys on the shared unions plus `'pending'` for runs; client-core should re-export the shared types (P1-T10).
6. **D-17 count.** The Foundations icon registry draws 48 concepts, not 49. The boards use about 50 further UI glyphs (chevrons, panel toggles, maximize …) that the registry must also include (§9).
7. **D-25 default accent.** "New defaults … `ink`" is only correct for the default theme. The pre-paint default accent must be the stored theme's `defaultAccent`, to match `resolveAccentId()`. The generated script inlines that map (§11.2).
8. **Brief vs. correctness, z-order.** Listing the z layers as "dropdown, popover, dialog, toast, tooltip" in ascending order would put body-portalled selects and popovers *below* an open dialog. This spec orders dialog (1000) < dropdown = popover (1100) < toast (1150) < tooltip (1200), matching today's primitives.
9. **Code comment.** `css.ts:19` gives `:root` specificity (0,0,0). It is (0,1,0). The ladder still works because of source order, and the emit tests pin that order. Fix the comment while editing the file.

### 14.2 Open design feedback (design values overridden, and why)

| Board value | Spec value | Why |
|---|---|---|
| Instrument `--line` `#27272c` / `#e2e2de` | `#2c2c31` / `#dcdcd7` | Board lines are 1.13:1 on overlay (dark) and 1.15:1 on ground (light); the existing suite requires 1.2 for dividers |
| `--line-strong` `#37373d` / `#d0d0cb` | `#68686c` / `#8a8a88` | 1.37–1.66:1 fails the 3:1 non-text bar for checkbox, switch and input borders (D-12) |
| `--fg-3` `#80808a` / `#6b6b73` | `#898991` / `#63636a` | 4.30:1 on overlay (dark); must clear 4.5 on every surface and on hover/selected rows |
| Light status as text `#1d6ae5 #16804c #935f00 #d1242f` | text `#1c5ec7 #167145 #895902 #bb232d`; glyph/dot keep the board hues | 4.37–4.39:1 on ground/tints; badge words are 12 px text |
| Inputs bordered with `--line` | `border-line-strong`, focus `border-focus` + selected halo | 1.2–1.3:1 input edges are invisible; the board's halo-only focus (≈1.1:1) is not a usable indicator |
| Fixed accent hexes for all themes | per-theme derivation; instrument uses the board hexes for blue/violet/rose/teal, derived green `#34855e`/`#16804c`, orange `#ad6134`/`#c2410c` | green 4.37 and orange 4.08 with white fail AA; fixed hexes ignore the theme (D-11) |
| hover/selected Instrument `.035/.07` dark, `.03/.055` light | fg @ 4 % / 8 % in every theme | the formula used by the 17 theme boards; one rule for all themes |
| status `-bg` `.12` dark / `.09` light | 15 % / 12.5 % (`TINT.status`) | identical to legacy `*-muted` and to the theme boards |
| add/del-bg `.09` / `.08–.07` | 10 % dark / 8 % light | one rule for all themes |
| theme boards' shadow without the 1px ring | Instrument recipe (ring = fg @ 6 %) for all themes | one elevation recipe |
| other themes' `--sunken` = `--ground` | kept; Instrument authors its own `sunken` | reproduces all boards |
| `.i16` used but undefined (ChatWorkflowRun) | 16 px is `ICON.defaultSize` (`size-4`) | design bug (web-design-delta) |
| Links coloured by accent (legacy) | fg + underline | the boards reserve the accent for primary action, selection and focus |
| Instrument hues for orange/teal/cyan/purple/pink | authored in §4.1 | the boards define only run/ok/warn/err; syntax, terminal, charts and four accents need the other five |
| Radius label "Instrument 4/6/8" | base 6 → 4/5/6/7/8/10/12 | D-14; the label contradicts the drawn radii |
