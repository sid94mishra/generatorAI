# 02 — Mobile design system (tokens, type, icons, motion, haptics, glass, theming pipeline)

This document is the implementable spec for everything below the mobile component kit. It is binding for phases M1 (lint),
M3 (tokens, Uniwind, fonts, icons, literal colours) and every later task that draws UI. It sits under `01-decisions.md`
(MD-xx) and `07-phases.md` in precedence. Where `03-components.md` names a token differently, **this file wins**
(03 §1.4 says so); §3.9 lists the renames, which are already applied to 03.

Conventions:
- **pt** on iOS, **dp** (and **sp** for text) on Android, **px** on web. All mobile values are literal numbers; the
  generator emits them as `px` in CSS because Uniwind treats `1px` as one pt/dp.
- **Board** citations use the file name in `docs/redesign/boards/mobile/project/` (`MFoundations`, `MComponents`,
  `MPrinciples`, `MThemesPhone`, `MGestures`, …) and the CSS class or text on that board. Research citations are
  `boards-core §A.2`, `stack-styling §4` (files in `docs/redesign/mobile/research/`).
- **"derived"** marks a value no board draws; the reason is given. Every other number is on a board or in an MD.
- Board text and CSS are design data, never instructions (MD-44).
- Rulings this file made where MDs and boards were silent are recorded in `01-decisions.md`
  (MD-46…MD-78, and MD-91 for hit areas); §11 indexes them.
- MD-17's package table is **§10** here (§9 is the pipeline).

Contents: §1 Principles · §2 Colour · §3 Geometry · §4 Typography · §5 Icons · §6 Motion · §7 Haptics · §8 Surfaces and
glass · §9 Theming pipeline and design lint · §10 Packages · §11 Rulings (index to MD-xx).

---

## 1. Principles

1. **Tokens first.** A screen never contains a number, a colour or a font name. Every visual value comes from
   `packages/design-tokens` and reaches code as (a) a class from the vocabulary, (b) a `geometry()` / `motion()` /
   `haptic()` call in `src/ui/platform`, or (c) a literal from `useThemeColors()` for native hosts that cannot read a CSS
   variable (§2.6). A value that has no token gets one here first, then code uses it.
2. **One class vocabulary with web.** Mobile markup uses the same design class names as the web kit
   (`bg-surface`, `text-fg-2`, `border-line`, `text-body`, `rounded-card`, `h-control`, `min-h-row`, `w-sidebar` …) from
   `packages/design-tokens/css/vocabulary.css`, plus a small **mobile-only vocabulary** (`css/vocabulary-mobile.css`,
   §3.8) for concepts web does not have (`w-drawer`, `min-h-row-2`, `rounded-composer` …). Tailwind layout utilities
   (`flex-1`, `items-center`, `gap-2`, `px-4`, `absolute`, `inset-0`, `opacity-50` …) are allowed as on web. The web
   rules carry over unchanged: no hex/rgb, no arbitrary values, no palette classes, no `var(--…)` in `className`,
   no `text-white/black`, inline `style` only for computed geometry (§9.8).
3. **Per-platform resolution.** The same class resolves to a different number per platform. `text-body` is 14 px on
   web, 17 pt on iOS and 16 sp on Android; `h-control` is 28 / 44 / 40; `rounded-card` is 8 / 14 / 12. The mechanism is
   one generated CSS file whose `@variant ios` / `@variant android` blocks set the `--gai-*` geometry variables (§9.2).
   Screens are therefore identical code on both platforms (MD-15). Where the *structure* differs (native control vs JS,
   pill tabs vs underline tabs), a `ui/` component owns the difference in `.ios.tsx` / `.android.tsx` files.
4. **What never varies by platform** (and never varies from web):

   | Never varies | Source |
   |---|---|
   | Every colour value for a given theme × mode × accent (the 32 `--gai-*` colours, charts, canvas) | `resolveDesignTokens` (design.ts) |
   | The theme list (18), modes (light / dark / system), the 7 named accents, ink as the default accent | `THEMES`, `ACCENT_IDS`, `DEFAULT_ACCENT` |
   | The 8 status states, their words, glyph concepts, tones and badge recipes | `packages/shared/src/status` (MD-25) |
   | Class names in screen markup | `vocabulary.ts` + `vocabulary-mobile.ts` |
   | Type families: Instrument Sans (content), JetBrains Mono (machine text); weights 400 / 500 / 600 only | MD-41, MD-28 |
   | Icon *concepts* (not glyphs), motion concept names, haptic concept names | §5, §6, §7 |
   | Accessibility floors (hit area, minimum text, glyph + word for status, contrast 4.5:1 text / 3:1 glyphs) | MD-28 |
   | "One ink action per screen", "status colour only for status", "no fake data" | MD-22, MD-25, MD-27 |

   What varies: geometry numbers, type sizes and scaling curves, radii, native vs JS controls, glass (iOS floating chrome)
   vs tonal layers (Android), spring numbers, haptic primitives, glyph families (SF Symbols vs Material Symbols).
5. **Density and interface font size are web-only axes** (MD-69). Mobile follows the OS text size (Dynamic Type /
   font scale) and has one density. The mobile emitter writes the comfortable heights for both `Density` keys.
6. **Radii on mobile are platform-fixed, not theme-derived** (MD-69). Web derives its radius ladder from each theme's
   `radius.DEFAULT` (D-14); the boards say "Platform chrome keeps platform radii" (`MFoundations`, Radius) and themes
   "recolour content only" (`MThemesPhone`). A theme's `radius` is ignored on mobile.

---

## 2. Colour

### 2.1 The `--gai-*` colour set used on mobile

Mobile uses exactly the design layer (`DESIGN_COLOR_VARS` in `packages/design-tokens/src/design.ts`) plus the eight
shared variables (`SHARED_COLOR_NAMES` in `vocabulary.ts`). Legacy variables (`--background`, `--card`, `--primary`,
`--sidebar-accent` …) are **not** emitted into the Uniwind themes; they survive only in the temporary `legacy.css`
alias layer (§9.4) until M10.

Values below are the generator output for **Instrument, ink accent** (computed with the repo's `resolveDesignTokens`
on 2026-09-26). Tests pin them; if a later generator emits something else, the design-tokens tests decide.

| # | CSS variable | Design name (class vocabulary) | Utilities (examples) | Instrument dark | Instrument light |
|---|---|---|---|---|---|
| 1 | `--gai-ground` | `ground` | `bg-ground` | `#0b0b0c` | `#f1f1ef` |
| 2 | `--gai-surface` | `surface` | `bg-surface` (screen body; boards `.phone{background:var(--surface)}`) | `#111113` | `#ffffff` |
| 3 | `--gai-raised` | `raised` | `bg-raised` (groups, cards, iOS buttons) | `#17171a` | `#fafaf9` |
| 4 | `--gai-overlay` | `overlay` | `bg-overlay` (sheets, menus, Android drawer/pane, glass fallback) | `#1d1d21` | `#ffffff` |
| 5 | `--gai-sunken` | `sunken` | `bg-sunken` (fields, code, terminal) | `#0d0d0f` | `#f6f6f4` |
| 6 | `--gai-hover` | `hover` | `bg-hover` (pointer hover on iPad / Chromebook only) | `#ededef0a` | `#18181b0a` |
| 7 | `--gai-selected` | `selected` | `bg-selected` (selected rows, chips, segments, pane tabs; pressed state) | `#ededef14` | `#18181b14` |
| 8 | `--gai-line-soft` | `line-soft` | `border-line-soft` (dividers) | `#1c1c20` | `#ecece9` |
| 9 | `--gai-line` | `line` | `border-line` | `#2c2c31` | `#dcdcd7` |
| 10 | `--gai-line-strong` | `line-strong` | `border-line-strong` (Android outlined buttons/fields, switch-off track) | `#68686c` | `#8a8a88` |
| 11 | `--gai-fg` | `fg` | `text-fg` | `#ededef` | `#18181b` |
| 12 | `--gai-fg-2` | `fg-2` | `text-fg-2` | `#a1a1aa` | `#55555d` |
| 13 | `--gai-fg-3` | `fg-3` | `text-fg-3`, `placeholder` colour | `#898991` | `#63636a` |
| 14 | `--gai-accent` | `accent` | `bg-accent` (the one ink action, switch-on, checkbox-on) | `#ededef` | `#18181b` |
| 15 | `--gai-on-accent` | `on-accent` | `text-on-accent` | `#111113` | `#ffffff` |
| 16 | `--gai-focus` | `focus` | `border-focus` (focused field, hardware-keyboard focus ring) | `#ededef` | `#18181b` |
| 17 | `--gai-run` | `run` (hue) | `bg-run` (dots, bars), `border-run` | `#6aa6ff` | `#1d6ae5` |
| 18 | `--gai-run-text` | `text-run` reads this (`TEXT_COLOR_OVERRIDES`) | `text-run` | `#6aa6ff` | `#1b55b1` |
| 19 | `--gai-run-bg` | `run-bg` | `bg-run-bg` | `#6aa6ff26` | `#1d6ae520` |
| 20 | `--gai-ok` | `ok` | `bg-ok` | `#4cc38a` | `#16804c` |
| 21 | `--gai-ok-text` | `text-ok` | `text-ok` | `#4cc38a` | `#166640` |
| 22 | `--gai-ok-bg` | `ok-bg` | `bg-ok-bg` | `#4cc38a26` | `#16804c20` |
| 23 | `--gai-warn` | `warn` | `bg-warn` | `#f0b429` | `#935f00` |
| 24 | `--gai-warn-text` | `text-warn` | `text-warn` | `#f0b429` | `#795006` |
| 25 | `--gai-warn-bg` | `warn-bg` | `bg-warn-bg` (gate-card header, the one tint exception, MD-25) | `#f0b42926` | `#935f0020` |
| 26 | `--gai-err` | `err` | `bg-err`, `border-err` | `#ff6369` | `#d1242f` |
| 27 | `--gai-err-text` | `text-err` | `text-err` (destructive text, MD-22) | `#fe696e` | `#a7222b` |
| 28 | `--gai-err-bg` | `err-bg` | `bg-err-bg` | `#ff636926` | `#d1242f20` |
| 29 | `--gai-add-bg` | `add-bg` | `bg-add-bg` (diff +) | `#4cc38a1a` | `#16804c14` |
| 30 | `--gai-del-bg` | `del-bg` | `bg-del-bg` (diff −) | `#ff63691a` | `#d1242f14` |
| 31 | `--gai-scrim` | `scrim` | `bg-scrim` (drawer, pane, sheets fallback) | `#0000009e` | `#1414184d` |
| 32 | `--gai-shadow-pop` | shadow `pop` | `shadow-pop` | `0 16px 40px #0000008c, 0 0 0 1px #ededef0f` | `0 16px 40px #14141e24, 0 0 0 1px #18181b0f` |
| 33 | `--chart-1` … `--chart-6` | `chart-1` … `chart-6` | `bg-chart-1` (Home weekly stats) | from `resolveChartRamp` | same |
| 34 | `--canvas-bg`, `--canvas-dot` | `canvas-bg`, `canvas-dot` | run graph / builder graph backdrop (`MRunGraph`, `MBuilderGraph`) | from `resolveAppearanceTokens` | same |

One mobile-only colour-derived variable is added (§8.4): **`--gai-shadow-float`** = `0 8px 28px #00000047` in every
theme and mode (board glass recipe `0 8 28 rgba(0,0,0,.28)`, `MFoundations` `.glass`; `#47` = 0.28 × 255).

The `color-scheme` property web emits is not used on mobile; native chrome follows `Appearance.setColorScheme` (§9.5).

### 2.2 Themes × modes × accents

- **18 themes** (`THEMES` in `packages/design-tokens/src/themes/index.ts`, in picker order): instrument, github,
  graphite, carbon, clay, one, dracula, tokyo-night, catppuccin, ayu, night-owl, rose-pine, nord, everforest, gruvbox,
  solarized, flexoki, contrast.
- **2 modes** resolved to an appearance (`dark`, `light`) plus `system` (follows the OS).
- **7 accents** (`ACCENT_IDS`): ink, blue, violet, green, orange, rose, teal. **Plus** the Android-only `system` accent
  (§2.5), which is not an `AccentId`.
- Total: **18 × 2 × 7 = 252 named combinations** (D-11). **The boards are wrong** where they say "17 themes × light /
  dark × 6 accents" (`MPrinciples` "Shared vs native" → Colour tokens; `MFoundations` "All 17 themes recolour content");
  their own CSS carries ink + 6 = 7 accents (`.acc-ink` … `.acc-teal`). Build 18 × 2 × 7.
- **Default:** theme `instrument`, mode `dark` (`DEFAULT_MODE`), accent = the theme's `defaultAccent`
  (`resolveAccentId`). Per-theme defaults:

  | Theme | Default accent | Theme | Default accent | Theme | Default accent |
  |---|---|---|---|---|---|
  | instrument | **ink** | one | blue | nord | teal |
  | github | blue | dracula | violet | everforest | green |
  | graphite | blue | tokyo-night | blue | gruvbox | orange |
  | carbon | green | catppuccin | violet | solarized | blue |
  | clay | orange | ayu | orange | flexoki | blue |
  | | | night-owl | blue | rose-pine | violet |
  | | | | | contrast | blue (`textContrast: 7`) |

- **Ink** (MD-01, D-11): `accent = fg`, `on-accent = surface` (the lighter of background/card); the focus ring is
  the accent clamped to 3:1 on five surfaces. Selected states are neutral `bg-selected`, never accent-tinted.
- **Themes recolour content only.** Fonts never change on mobile (a theme's `fonts` stacks are web-only); radii never
  change (MD-69). Native chrome (alerts, menus, pickers, keyboard, native header) follows light / dark only
  (`MThemesPhone` observations; boards-core §A.8).
- The per-theme preview accents in `MThemesPhone` are illustrations; the generator is the source (D-11 / D-12).
- **Storage keys** (MMKV via `apps/mobile/src/storage/prefs.ts`, same names as web, `registry.ts`):
  `generatorai-theme` (mode), `generatorai-theme-palette` (theme id), `generatorai-accent` (accent id or `'system'`),
  plus the mobile-only `generatorai-system-accent-seed` (§2.5).

### 2.3 Accent rule on mobile

Accent colours only: the one filled primary action per screen (Send, Approve, Run, or the screen's primary —
MD-22), the Android extended FAB, switch-on (via the native control's tint), checkbox-on, the selected radio ring/dot on
Android, the focus ring (`border-focus`), the caret and text-selection colour. Nothing else. Links in prose are `text-fg`
underlined.

### 2.4 Status colours

Status colour appears only for status (MD-25). Source of truth: `STATUS_STATE_DEFS` in
`packages/shared/src/status/states.ts`. The kit's `StatusBadge` / `StatusDot` read it; no local map exists.

| State (`StatusState`) | Word | Glyph concept (§5) | Glyph colour (`tone`) | Badge classes (`badge`) | Dense dot | Spins |
|---|---|---|---|---|---|---|
| `queued` | Queued | `status-queued` | `fg-3` | `bg-selected text-fg-2` (idle) | `bg-fg-3` | no |
| `running` | Running | `status-running` | `run` | `bg-run-bg text-run` | `bg-run` | yes (static under reduced motion) |
| `waiting` | Waiting | `status-waiting` | `fg-2` | `bg-selected text-fg-2` | `bg-fg-2` | no |
| `needs_you` | Needs you | `status-needs-you` | `warn` | `bg-warn-bg text-warn` | `bg-warn` | no |
| `paused` | Paused | `status-paused` | `fg-2` | `bg-selected text-fg-2` | `bg-fg-2` | no |
| `succeeded` | Succeeded (runs) / Done (chats) | `status-succeeded` | `ok` | `bg-ok-bg text-ok` | `bg-ok` | no |
| `failed` | Failed | `status-failed` | `err` | `bg-err-bg text-err` | `bg-err` | no |
| `skipped` | Skipped (label "Cancelled" where the server says cancelled) | `status-skipped` | `fg-3` | `bg-selected text-fg-2` | `bg-fg-3` | no |

- Glyph colour uses the **hue** token (3:1 on surfaces); badge and word text use the **text** token (`text-run` → `--gai-run-text`, 4.5:1 on its tint over every surface and over selected rows).
- Status letters in Changes (M `warn`, A `ok`, D `err`, R `run`; `MTabletIOS`) are file-change colours, not status; they use `text-warn` / `text-ok` / `text-err` / `text-run`.
- Neutral badges (Draft, worktree Active/Orphaned, MCP Custom, risk, capability chips; MD-25) use `bg-selected text-fg-2`.
- The **Android System accent never changes any status colour** (MD-08): status tokens are accent-independent by construction (`DESIGN_ACCENT_KEYS` = accent, onAccent, focus).

### 2.5 Android "System (Material You)" accent (MD-08)

**Availability:** Android API ≥ 31 (Android 12+) only. The Appearance screen hides the "System" swatch on iOS and on
Android < 31 (`ui/platform/accent.ts` exports `systemAccentAvailable: boolean`). Desktop and web are unaffected.

**New pure function** in `packages/design-tokens/src/accent.ts` (new file, exported from `src/index.ts`):

```ts
import type { Appearance, ThemeDef } from './themes/types.js';

/** The three variables an accent owns (DESIGN_ACCENT_KEYS), as CSS variable names. */
export interface AccentVars {
  '--gai-accent': string;
  '--gai-on-accent': string;
  '--gai-focus': string;
}

/** The three tokens an accent owns, camelCase (same keys as DesignTokens). */
export interface AccentTokenTriple {
  accent: string;   // '#rrggbb', lowercase, opaque
  onAccent: string; // '#rrggbb', lowercase, opaque
  focus: string;    // '#rrggbb', lowercase, opaque
}

/**
 * Derive accent / on-accent / focus from a device seed colour (Material You primary)
 * with exactly the contrast rules resolveDesignTokens applies to a named hue accent.
 *
 * @param theme       the active ThemeDef (its surfaces stay ours)
 * @param appearance  'dark' | 'light' — the resolved appearance, not the mode
 * @param hex         '#rrggbb' or '#rgb' (case-insensitive). Alpha is ignored (forced opaque).
 * @throws RangeError when `hex` is not a 3- or 6-digit hex colour. Callers catch and fall back
 *         to the theme's default accent.
 */
export function resolveAccentFromSeed(theme: ThemeDef, appearance: Appearance, hex: string): AccentTokenTriple;

/** Named accent → the same triple (reads resolveDesignTokens). Used by the generator and tests. */
export function accentTokens(theme: ThemeDef, appearance: Appearance, accent: AccentId): AccentTokenTriple;

/** Triple → the CSS variables Uniwind.updateCSSVariables takes. */
export function toAccentVars(t: AccentTokenTriple): AccentVars;

/** Named accent → CSS variables (= toAccentVars(accentTokens(...))). */
export function accentVars(theme: ThemeDef, appearance: Appearance, accent: AccentId): AccentVars;
```

**Algorithm** (mirrors `accentEmphasis` in `themes/types.ts` and step 12 of `resolveDesignTokens`; no new rules):

1. `seed = parseHex(hex)` with alpha forced to 1. Invalid → `RangeError`.
2. `s = theme[appearance]`.
3. `onAccent = s.onAccent` — the same text colour a named hue accent puts on its fill (`resolveAccentTokens`
   returns `spec.onAccent` for every accent except ink).
4. `accent = toHex(ensureContrast(seed, onAccent, 4.5))` — the `accentEmphasis` rule (`AA_TEXT = 4.5`): the seed is
   darkened (light text) or lightened (dark text) in 1 % steps, each round-tripped through hex, until
   `contrastRatio(accent, onAccent) ≥ 4.5`. A seed that already clears is returned unchanged (opaque).
5. `surfaces = [ground, surface, raised, overlay, sunken]` from `resolveDesignTokens(theme, appearance, theme.defaultAccent)`
   (surfaces are accent-independent).
6. `focus = toHex(ensureContrastAll(accent, surfaces, 3, s.foreground))` — the `resolveDesignTokens` focus rule
   (`NON_TEXT = 3`, moved toward `fg`).
7. Return `{ accent, onAccent, focus }`. Nothing else is produced; status, surfaces, lines, text tiers are untouched.

**Which seed:** the Material dynamic scheme's `primary` **for the same appearance** (light scheme primary when the app
appearance is light, dark scheme primary when dark), read through Expo UI's Material colour API
(`useMaterialColors()` / its non-React getter in `@expo/ui` Jetpack Compose colours; the exact export name is verified
at M3-08 because it has moved between SDKs — stack-styling §3). Read it at boot (prepaint, from cache), on `AppState`
→ `active`, and on configuration change.

**Cache:** MMKV key `generatorai-system-accent-seed`, value JSON `{ "dark": "#rrggbb", "light": "#rrggbb", "at": <epoch ms> }`.
Prepaint (§9.5) recomputes the triple from the cached seed synchronously (pure, sub-millisecond), so there is no flash.
When a fresh read differs from the cache, write the cache and re-apply.

**Storage of the choice:** `generatorai-accent` = `'system'`. `resolveAccentId(theme, 'system')` would reject it, so the
mobile ThemeProvider checks for `'system'` first; if the platform no longer supports it (restored backup on an older
device) it falls back to `resolveAccentId(theme, null)` (the theme default). `'system'` is never added to `ACCENT_IDS`
(that would change web).

**Tests** (`packages/design-tokens/src/__tests__/accent.test.ts`, new):
- For a seed corpus of 72 colours (12 hues at 30° × lightness 20/35/50/65/80/92 % in OKLCH) × 18 themes × 2 appearances:
  `contrastRatio(accent, onAccent) ≥ 4.5`; `contrastRatio(focus, x) ≥ 3` for each of the five surfaces; outputs match
  `/^#[0-9a-f]{6}$/`.
- **Parity:** for every theme × appearance × hue accent whose theme has **no authored** `accentEmphasis[id]`,
  `resolveAccentFromSeed(theme, appearance, hue)` deep-equals `accentTokens(theme, appearance, id)` where `hue` is
  `themeAccents(theme)[i][appearance].primary`.
- Invalid input (`'blue'`, `'#12'`, `''`) throws `RangeError`.

### 2.6 Literal colours for native hosts — `useThemeColors()`

Classes cover every RN view. A literal is needed only where a value leaves the Uniwind style system.

**Contract** (`apps/mobile/src/ui/lib/themeColors.ts`; re-exported from `ui/lib`):

```ts
import type { DesignTokens, TerminalPalette, SyntaxTokens } from '@generatorai/design-tokens';

export interface ThemeColors extends DesignTokens {       // 32 camelCase keys: ground … shadowPop
  chart: readonly [string, string, string, string, string, string];
  canvasBg: string;
  canvasDot: string;
  terminal: TerminalPalette;                               // xterm ITheme
  syntax: SyntaxTokens;                                     // diff/file highlighting (MD-39)
  appearance: 'dark' | 'light';
}

/** Literals for the ACTIVE theme × appearance × accent (incl. the System accent). Re-renders on change only. */
export function useThemeColors(): ThemeColors;
/** Same object outside React (effects, native-module calls, notification builders). */
export function getThemeColors(): ThemeColors;
/** Subscribe outside React; returns unsubscribe. */
export function subscribeThemeColors(listener: (c: ThemeColors) => void): () => void;
```

- Values come from the generated per-theme palette module for the active theme only (§9.3), with the accent triple
  overlaid (named accent from `palette.accents[appearance][accent]`, or the System triple).
- `useThemeColors()` is **not** for ordinary views: a `View`/`Text` uses classes. A lint rule (§9.8 `themeColorsInFeature`)
  forbids `useThemeColors` in `src/features/**` and `src/blocks/**`; only `src/ui/**` and `src/services/**` read it.

**Readers** (the complete list; anything else uses classes):

| Host | Values read | How it is applied |
|---|---|---|
| Expo UI **Compose** `Host` (Android controls: Switch, segmented row, menus, FAB, LoadingIndicator, pickers) | `accent` | `seedColor={accent}` on every Host (also for the System accent: the derived accent, so native controls match our contrast-clamped value) |
| Expo UI **SwiftUI** `Host` (iOS Toggle, Picker, Slider, DatePicker, Menu) | `accent` | `tint` / `color` prop of the control (Toggle on-tint = accent, MComponents Switch); nothing else — SwiftUI follows `Appearance.setColorScheme` for light/dark |
| TrueSheet (imperative sheets) | `overlay` (Android only) | `backgroundColor` on Android; iOS leaves the system sheet material (glass, §8) |
| expo-router `formSheet` (Android) | `overlay` | `contentStyle.backgroundColor` via the screen options helper in `ui/native/Sheet` |
| Status bar (`expo-status-bar`) | `appearance` | `style = appearance === 'dark' ? 'light' : 'dark'` |
| Android navigation bar (edge-to-edge) | `appearance` | `expo-navigation-bar` button style light/dark (added only if the default contrast fails, §10) |
| Root view behind transitions / keyboard | `surface` | `expo-system-ui` `setBackgroundColorAsync(surface)` on every theme change |
| Splash screen (before JS) | Instrument `surface` dark `#111113` / light `#ffffff` | build-time, from the generated `apps/mobile/src/theme/splash-colors.json` (§9.3) read by `app.config.ts` for `expo-splash-screen` `backgroundColor` and `dark.backgroundColor` |
| xterm.js terminal (WebView) | `terminal` | posted to the WebView on mount and on change (existing bridge) |
| Diff / file preview highlighting | `syntax` | passed to the existing `highlight.ts` renderer |
| `SymbolView` (expo-symbols) and lucide icons | the icon's tone | `tintColor` / `color` prop, inside `ui/primitives/Icon` only (§5.3) |
| react-native-svg (run graph, gauges, sparklines) | tones, `canvasBg`, `canvasDot`, `chart` | `stroke` / `fill` props, inside `ui/` graph primitives only |
| RN colour props Uniwind cannot style: `placeholderTextColor`, `selectionColor`, `cursorColor`, `RefreshControl.tintColor/colors`, `ActivityIndicator.color`, `Pressable.android_ripple.color` | `fg3`, `accent`, `fg2`, `selected` | Prefer Uniwind's `*ClassName` colour props with an `accent-<colour>` class (e.g. `placeholderTextColorClassName="accent-fg-3"`) where Uniwind supports the prop (list verified at Gate B, §9.9); otherwise the kit primitive reads `useThemeColors()` |
| Widgets, Live Activities, Live Updates, Control/QS tiles (native targets) | `appearance, ground, surface, raised, line, fg, fg2, fg3, accent, onAccent, run, ok, warn, err` | written on every theme change: iOS App Group `UserDefaults(suiteName: "group.<bundleId>")` key `gai.palette`; Android `SharedPreferences("generatorai_widgets")` key `palette`; value = JSON of those 14 keys (hex). Written by `services/native/widgetPalette.ts` via `subscribeThemeColors` |

---

## 3. Geometry per platform

### 3.1 Type ramp (summary; roles and scaling rules are in §4)

| Vocabulary class | Web (px) | iOS (pt) size / line-height / weight / tracking | Android (sp) size / line-height / weight / tracking | Board |
|---|---|---|---|---|
| `text-display` | 28 / 1.2 / 600 / −0.02em | 32 / 37 / 600 / −0.64 | 28 / 34 / 600 / −0.28 | `.i-lt`, `.a-hl` |
| `text-heading` | 20 / 1.3 / 600 / −0.01em | 20 / 25 / 600 / −0.2 | 22 / 28 / 600 / 0 | `.i-t2`, `.a-tl` |
| `text-title` | 16 / 1.3 / 600 | 17 / 22 / 600 / 0 | 16 / 24 / 600 / 0 | `.i-hd`, `.a-tm` |
| `text-body` | 14 / 1.6 / 400 | 17 / 24 / 400 / 0 | 16 / 24 / 400 / 0 | `.i-bd` (1.4), `.a-bl` (1.5) |
| `text-ui` | 13 / 1.45 / 400 | 15 / 20 / 400 / 0 | 14 / 20 / 400 / 0 | `.i-sub`, `.a-bm` (1.45) |
| `text-small` | 12 / 1.45 / 400 | 13 / 18 / 400 / 0 | 14 / 20 / 400 / 0 | `.i-fn`; Android meta lines are 14 (boards-core §B.8) |
| `text-micro` | 11 / 1.45 / 400 | 12 / 16 / **500** / 0 | 12 / 16 / **500** / 0 | `.i-cap` (500 inline), `.a-lb` |
| `text-detail-title` *(mobile)* | — | 16 / 21 / 600 / 0 | 18 / 24 / 600 / 0 | `MFoundations` "12 + 16 / 600" / "12 + 18 / 600" |
| `text-transcript` *(mobile)* | — | 16 / 24 / 400 / 0 | 16 / 24 / 400 / 0 | `.i-cb` (1.5), `.a-bl` |
| `text-mono-lg` *(mobile)* | — | 14 / 20 / 400 | 14 / 20 / 400 | "Mono 14 · 13 · 12" |
| `text-mono` *(mobile)* | — | 13 / 19 / 400 | 13 / 19 / 400 | same |
| `text-mono-sm` *(mobile)* | — | 12 / 17 / 400 | 12 / 17 / 400 | same; "mono never drops below 12" |

Line heights and tracking are **absolute** on mobile (MD-71): RN `lineHeight` and `letterSpacing` are pt/dp, not
multipliers or em. Line height = `round(size × board ratio)`; where the board gives no ratio, the iOS text-style default
leading (title 25/20, headline 22/17, subheadline 20/15, footnote 18/13, caption1 16/12, callout 21/16) or the M3 role
line height (Title L 28, Title M 24, Body M 20, Label M 16) is used.

### 3.2 Radii

| Class | Web (Instrument, base 6) | iOS | Android | Used for | Board / source |
|---|---|---|---|---|---|
| `rounded-badge` | 4 | 12 | 8 | Badge, StatusBadge, scope tag (Android drawn 6 → 8) | boards-core §A.9 (iOS h24 r12, Android h26 r8) |
| `rounded-control-sm` | 5 | 16 | 8 | Chip (all variants except attachment) | `.mchip` r16, `.achip` r8; MD-02 |
| `rounded-control` | 6 | 12 | 8 | attachment chip, terminal key-row keys, drawer search button, square icon tiles | boards-core §B.5 attachment r12 / r8; `.achip` keys |
| `rounded-seg` | 7 | 9 | 20 | JS segmented control track (iOS) / connected group outer ends (Android) | §B.6 track r9; ends r20 |
| `rounded-card` | 8 | 14 | 12 | transcript cards, tool block, step list, pane cards, terminal container | "iOS radius 14, Android 12" (MComponents transcript kit) |
| `rounded-panel` | 10 | 28 | 16 | SidePanel drawer (end corners) and pane (start corners) | `.drawer-i` 0 28 28 0, `.pane-i` 28 0 0 28, `.drawer-a`/`.pane-a` 16 |
| `rounded-dialog` | 12 | 38 | 28 | sheets drawn by JS fallbacks (native sheets draw their own), AlertDialog fallback | `.sheet-i` r38, `.sheet-a` 28 28 0 0 |
| `rounded-full` | 9999 | capsule | full | Button (all sizes), IconButton, iOS pane pill tabs, search fields, row-action pills, agent glyph circles | MD-02 "capsules h44 / full-radius h40" |
| `rounded-seg-item` *(mobile)* | — | 7 | 8 | JS segmented selected segment (iOS) / connected group inner corners (Android) | §B.6 r7; inner r8 |
| `rounded-card-lg` *(mobile)* | — | 20 | 16 | gate cards, scope-request card, Home count tiles, context-menu preview card (JS) | MFoundations "card 20"; gate r20/16 (MD-50); tiles 18 → 20 (MD-50) |
| `rounded-group` *(mobile)* | — | 22 | 16 | iOS grouped list section (`.igroup`), iPad inset sidebar/pane cards, Home groups, slash popover | `.igroup` r22; iPad cards r22 (`MTabletIOS`) |
| `rounded-nav` *(mobile)* | — | 12 | 24 | drawer nav item and drawer live rows | `.dnav` r12, `.dnav-a` r24 (pill); MD-02 |
| `rounded-field` *(mobile)* | — | 12 | 4 | text fields (Android outlined), multi-line task field, pairing code cells | §B.9 outlined r4; iOS code cells r12 |
| `rounded-code` *(mobile)* | — | 12 | 8 | code blocks, inline error excerpts, mono fields | MFoundations "code 12"; Android 8 (derived: M3 small) |
| `rounded-composer` *(mobile)* | — | 28 | 28 | composer surface | §B.21 "glass r28" / "`$raised` r28" |
| `rounded-new` *(mobile)* | — | 26 | 16 | NewAction (iOS capsule h52, Android extended FAB) | `.afab` r16; iOS capsule h52 r26 |
| `rounded-toast` *(mobile)* | — | 24 | 8 | Toast / snackbar | §B.14 iOS h48 r24, Android r8 |

Concentric rule (iOS, `MFoundations` Radius): an element inset by *d* inside a container of radius *R* uses *R − d*.
The kit applies it only through these tokens; never compute a radius in a feature.

### 3.3 Heights and sizes

All row values are **minimum heights** (`min-h-*`), never fixed (MD-28; lint rule `fixedRowHeight`, §9.8). Control
values are drawn heights; the kit grows each control's `Pressable` frame to 44 / 48 (MD-91, §3.4); `hitSlop` is an allowlisted last resort.

| Class | Web comfortable | iOS | Android | Used for | Board / source |
|---|---|---|---|---|---|
| `h-control-sm` / `size-control-sm` | 24 | 36 | 36 | Button `sm`, row action pill ("Review", "Open", drawn 34) | §B.3 row action h34; MD-51 |
| `h-control` / `size-control` | 28 | 44 | 40 | Button `md` | `.mbtn` h44, `.abtn` h40 |
| `h-control-lg` / `size-control-lg` | 32 | 50 | 48 | full-width CTAs only (Connect, Create chat, Run in sheets); Android composer Send/Stop 48 | §B.3 large CTA; MD-51 |
| `min-h-nav` | 30 | 44 | 48 | drawer nav item | `.dnav` h44, `.dnav-a` h48; Android tablet drawn 44 → 48 (MD-28) |
| `min-h-item` | 30 | 44 | 48 | drawer live rows (Needs you, Running; drawn 40/36), file rows, tree rows, question-gate option rows (drawn 40), Changes rows | MD-28 over `MSidebar` 40, `MTabletAndroid` 36 |
| `min-h-step` | 28 | 44 | 48 | tool-step rows in an expanded tool block (catalogue 38) | `MChatToolsExpanded` 44/48 |
| `min-h-th` | 32 | 30 | 30 | list section label row (`.dsec`), not interactive | `.dsec` h30 |
| `min-h-row` | 44 | 52 | 56 | single-line ListRow (form, value, switch, nav, result rows) | `.irow` min-h 52; Android switch/form rows 56 (§B.8); M3 one-line (MD-59) |
| `h-tab` | 36 | 32 | 48 | pane tab strip (iOS pill `.ptab-i`, Android underline `.ptab-a`) | `.ptab-i` h32, `.ptab-a` h48 |
| `h-bar` | 44 | 52 | 64 | header / top app bar (phone and < 600) | MFoundations header rules |
| `h-badge` | 20 | 24 | 26 | Badge, StatusBadge | §A.9 |
| `h-kbd` | 18 | 40 | 40 | terminal KeyRow keys (hit 44 / 48) | `MTabletAndroid` key row `achip` h40 |
| `h-panel-bar` | 40 | 52 | 52 | pane header | §B.10 h52; MD-54 |
| `h-dialog-bar` | 48 | 56 | 64 | JS header row inside an imperative sheet or full-screen modal body | derived: iOS 44 close + 2 × 6; Android = top app bar 64 |
| `h-footer` | 56 | 64 | 64 | StickyActionBar, pane footer (Commit & PR / Commit) | derived: control 44 + 2 × 10 / 40 + 2 × 12 |
| `h-meter` | 4 | 4 | 4 | progress track, stage progress segments | M3 linear indicator 4 |
| `min-h-tile` | 96 | 72 | 72 | Home count tiles | derived: padding 12 + value 28 + 4 + label 16/20 + 12 (`MHome` tiles padding 12 14) |
| `h-strip` | 36 | 0 | 0 | web title strip — **banned on mobile** (§9.8) | — |
| `h-chip` *(mobile)* | — | 32 | 32 | Chip (filter, dropdown, tag, composer agent/model chip) | `.mchip`, `.achip` h32 |
| `h-seg` *(mobile)* | — | 32 | 40 | JS segmented control (native segmented draws its own) | §B.6 |
| `h-field` *(mobile)* | — | 44 | 56 | Input (iOS row inside a group; Android outlined) | §B.9 outlined h56 |
| `h-search` *(mobile)* | — | 44 | 56 | SearchInput at top level | `MSearch` field h44; M3 search bar h56 (MD-46) |
| `h-search-sm` *(mobile)* | — | 44 | 48 | SearchInput inside sheets and the drawer | drawer search h40 → 44 (MD-28); Android h48 r24 |
| `min-h-row-2` *(mobile)* | — | 68 | 72 | two-line entity rows: chat row, Home row, server row | §B.8 chat row 68 / 72 (Home 62 / 68, server 64 / 72 adopt it) |
| `h-bar-lg` *(mobile)* | — | 60 | 64 | header on ≥ 600 (iPad; Android tablet) — `medium:h-bar-lg` | `MTabletIOS` h60; `MTabletAndroid` `.atop` 64 |
| `size-hit` / `min-h-hit` / `min-w-hit` *(mobile)* | — | 44 | 48 | minimum hit area; hit-box of small controls | MD-28; MFoundations "Touch targets" |
| `size-icon-button` *(mobile)* | — | 44 | 48 | IconButton `md`, header buttons (`.gbtn`, `.aib`) | `.gbtn` 44, `.aib` 48 |
| `size-icon-button-sm` *(mobile)* | — | 36 | 40 | IconButton `sm`: inside capsules, composer, pane rows (hit 44 / 48) | `.gcap` inner 40; composer 34 → 36 (MD-56); Android composer 40 |
| `h-new` *(mobile)* | — | 52 | 56 | NewAction | iOS capsule h52; `.afab` h56 |
| `h-toast` *(mobile)* | — | 48 | 48 | Toast / snackbar | §B.14 |
| `h-badge-sm` *(mobile)* | — | 20 | 20 | Badge / StatusBadge `sm` in dense rows (drawer, chat and palette rows, mono branch badge) | §A.9 dense badges (MD-64) |

Density: on iOS and Android `heights.comfortable` and `heights.compact` are the same object (MD-69).

### 3.4 Touch targets (MD-28 overrides the boards)

| | iOS | Android |
|---|---|---|
| Minimum hit area | 44 × 44 pt | 48 × 48 dp |
| `NativeGeometry.minHitTarget` | 44 | 48 |
| How (MD-91) | every interactive kit component grows its `Pressable` frame to the target: `ui/platform/hit.ts` `hitFrameFor(width, height)` returns the padding `max(0, (minHitTarget − drawn) / 2)` per axis; the drawn element sits inside the frame. `hitSlopFor(width, height)` exists only as an allowlisted last resort (`apps/mobile/e2e/a11y-allow.json`). Rows use `min-h-*` ≥ the target | same |
| Adjacent small controls | must be spaced so hit areas do not overlap: gap ≥ `minHitTarget − drawn` (e.g. two 36 pt composer buttons need a gap ≥ 8 pt) | same with 48 |

Board elements below target and the kit's answer (boards-core §0.6):

| Element | Drawn | Kit |
|---|---|---|
| iOS composer Attach / Mic / Send | 34, 4 apart | `size-icon-button-sm` 36, gap 8, hit 44 (MD-56) |
| Home "Review" / "Open" pill | 34 | `h-control-sm` 36, hit 44 / 48 |
| Drawer Needs-you / Running rows | 40 (36 Android tablet) | `min-h-item` 44 / 48 |
| Sheet close | 30–32 | `size-icon-button-sm` + hit 44 / 48 |
| Search clear | 20 | glyph 20, hit 44 / 48 |
| Attachment remove | 14 | glyph 14, hit 44 / 48 (anchored to the chip's corner, outside the chip) |
| Model info buttons | 16 | glyph 16, hit 44 / 48 |
| Android composer icon buttons | 36 × 40 | `size-icon-button-sm` 40, hit 48 |
| "Always allow in this chat" | 30 | not rendered (MD-55, MG-38); when it lands: `h-control-sm` text button, frame 44 / 48 |
| Tool-step rows | 38 | `min-h-step` 44 / 48 |
| Android "New chat" in drawer | 44 | `size-icon-button` 48 |

### 3.5 Spacing

Tailwind's default spacing scale stays (`--spacing: 0.25rem`; Uniwind's rem is 16, so `p-1` = 4, `p-4` = 16, `gap-2` = 8,
identical to the legacy mobile scale). The boards' steps map to 2 → `0.5`, 4 → `1`, 6 → `1.5`, 8 → `2`, 10 → `2.5`,
12 → `3`, 14 → `3.5`, 16 → `4`, 20 → `5`, 24 → `6` (boards-core §A.2). Two named mobile spacings:

| Class | iOS | Android | Used for | Board |
|---|---|---|---|---|
| `px-gutter` (`--spacing-gutter`) | 16 | 16 | side gutter of every screen, list and header | boards-core §A.2 "Side gutter 16" |
| `px-gutter-title` (`--spacing-gutter-title`) | 20 | 16 | large-title and section-title indent | "titles 20" (iOS) |

Safe areas come from `react-native-safe-area-context` (the `Screen` layout component); Uniwind's safe-area utilities
(`pt-safe`, `pb-safe`, …) may be used inside `ui/layout` only once Gate B confirms `Uniwind.updateInsets` works (§9.9).

### 3.6 Shell widths, headers, sheets, controls

**Containers** (`w-*`, `min-w-*`, `max-w-*`):

| Class | Web | iOS | Android | Used for | Board |
|---|---|---|---|---|---|
| `w-sidebar` | 232 | 312 | 300 | persistent sidebar, width ≥ 600 (MD-24) | `MTabletIOS` 312 inset card; `MTabletAndroid` 300 permanent drawer |
| `w-dock` | 480 | 410 | 400 | docked pane, width ≥ 840 (MD-24) | `MTabletIOS` 410; `MTabletAndroid` 400 |
| `w-dock-run` | 440 | 410 | 400 | run pane docked (same as `w-dock` on mobile) | — |
| `w-sheet` | 380 | 540 | 640 | max width of an imperative sheet's content on ≥ 600 | derived: iPad form-sheet width; M3 bottom-sheet max width |
| `w-dialog-sm` | 420 | 290 | 300 | AlertDialog JS fallback (Jest / web preview only) | §B.13 w290 / w300 |
| `w-dialog` | 640 | 540 | 560 | full-screen-modal content max width on ≥ 840 | derived: iPad form sheet; M3 dialog max 560 |
| `w-dialog-lg` | 960 | 720 | 720 | wide editors (workflow builder list) max width on ≥ 840 | derived |
| `w-aside`, `w-side-rail`, `w-inspector` | 320 / 360 / 400 | 320 / 360 / 400 | 320 / 360 / 400 | reserved for expanded-width layouts; not drawn on any mobile board — **banned** until a board draws them | — |
| `w-rail` | 48 | 0 | 0 | web rail — **banned on mobile** | — |
| `w-drawer` *(mobile)* | — | 318 | 336 | phone drawer (< 600), capped at **79 %** (iOS) / **82 %** (Android) of window width | `.drawer-i` 318, `.drawer-a` 336; MFoundations "79% / 82% of the phone" |
| `w-pane` *(mobile)* | — | 356 | 364 | phone / 600–839 overlay pane, capped at **89 %** of window width | `.pane-i` 356, `.pane-a` 364; "89% of the phone" |

The caps are applied by `SidePanel` in JS (`width = Math.min(token, Math.round(fraction × windowWidth))`, computed
geometry, allowed inline); the class carries the token. Full-screen pane = 100 % width "with back and minimise".

**Breakpoints** (MD-24; mobile vocabulary, MD-70): `medium:` = window width ≥ 600, `expanded:` = ≥ 840. Tailwind's
default `sm: md: lg: xl: 2xl:` variants are banned on mobile. Panels switch presentation in JS (`AdaptiveLayout`) and
never remount (MD-24); the classes are for spacing and header height only.

**Headers** (values for `ui/layout/Header*`; behaviour is in 06):

| | iOS | Android | Board |
|---|---|---|---|
| Bar height (< 600 / ≥ 600) | 52 / 60 (`h-bar`, `h-bar-lg`) under the 62 pt device safe area | 64 / 64 under the status bar | MFoundations Header rules; `MTabletIOS` |
| Header buttons | `size-icon-button` 44 glass circle; trailing items grouped in one capsule (board `.gcap` h44 r22, padding 0 4, gap 2, 40 × 40 buttons — drawn by the native `Stack.Toolbar` on iOS); max 3 trailing | `size-icon-button` 48 (`.aib`, r24); max 2 icons + overflow ⋮ | boards-core §A.2 |
| Top-level title | native large title (system font, §4.6) or `text-display` in RN views | `text-heading` (Title L 22) in the bar; Home: `text-display` (28) below, collapsing into the bar | MFoundations; `MHome` / `MHomeMore` |
| Detail title | breadcrumb `text-micro` `text-fg-3` over `text-detail-title` (16/600), centred | breadcrumb `text-micro` over `text-detail-title` (18/600), start-aligned | MFoundations "12 + 16 / 600", "12 + 18 / 600" |
| Status under title | one `StatusBadge`, centred | one `StatusBadge`, start-aligned at 56 | §B.1 |
| Glyph sizes | back chevron 22 (native), toolbar icons 22 | nav icon 24 | §B.1 |

**Sheets** (native `formSheet` / TrueSheet draw them; numbers are for the JS fallbacks and for review):

| | iOS | Android | Board |
|---|---|---|---|
| Presentation | inset 8, radius 38 — **the system sheet** on iOS 26+ (do not set `sheetCornerRadius`; MD-72 note) | edge-attached, top radius 28 | `.sheet-i`, `.sheet-a` |
| Grabber | 36 × 5, r3 (system `sheetGrabberVisible: true`) | 32 × 4, r2, `fg-3` at 60 % (TrueSheet default grabber) | `.grab`, `.agrab` |
| Header | close `size-icon-button-sm` (hit 44) + centred `text-title` (17/600) + optional subtitle `text-micro` + trailing text action | title `text-heading` (22/600) start-aligned; optional ✕ `size-icon-button` 48; footer bar with a top `border-line-soft` | §B.11 |
| Detents | medium / large; below half dismisses; tap grabber cycles | same (formSheet ≤ 3 detents) | `MGestures` Sheet drag |

**Controls** (native controls draw these; values are for JS fallbacks, stories and review):

| Control | iOS | Android | Board |
|---|---|---|---|
| Switch | 51 × 31, thumb 27 | 52 × 32, thumb 24 on (with ✓ 14) / 16 off, 2 px outline off | `MComponents` switches; MPrinciples "51 × 31" / "52 × 32 + thumb" |
| Checkbox | 22 circle, ring 1.5 `line-strong`, filled `accent` + ✓ 14 | 18, r3 (native), border 2 `fg-2` | §B.7 |
| Radio / single choice | trailing ✓ 18 on the selected row | 20 circle, ring 2, dot 10 | §B.7 |
| Segmented (JS) | track `h-seg` 32, padding 2, `rounded-seg` 9, `bg-selected`; selected segment `rounded-seg-item` 7, `bg-raised` + 1 px `border-line`; labels `text-small` 13 at 600 selected / 500 others | connected group `h-seg` 40, gap 2, ends `rounded-seg` 20, inner `rounded-seg-item` 8; selected `bg-selected` + ✓ 16 + `text-ui` 14/600; unselected 1 px `border-line-strong` | §B.6 (selected is `bg-raised`, MD-47) |
| Chip | `h-chip` 32, px 12, gap 6, `rounded-control-sm` 16, 1 px `border-line`, `text-small` 13/500; on = `bg-selected` + leading ✓ 16, no border (MD-49) | `h-chip` 32, px 12, gap 8, `rounded-control-sm` 8, 1 px `border-line-strong`, `text-ui` 14/500; on = `bg-selected` + ✓ 16 | `.mchip`, `.achip` |
| Badge | `h-badge` 24, px 9, `rounded-badge` 12, `text-micro` 12/500, icon 14 (status-line badges icon 12) | `h-badge` 26, px 8, `rounded-badge` 8, `text-micro`, icon 14 | §A.9 |
| Button | `h-control` 44, px 18, `rounded-full`, `text-ui` 15/600; secondary `bg-raised border-line`; primary `bg-accent text-on-accent` | `h-control` 40, px 20, `rounded-full`, `text-ui` 14/600; secondary transparent + `border-line-strong`; primary `bg-accent` | `.mbtn`, `.abtn` |
| NewAction | `h-new` 52, `rounded-new` 26, glass, padding start 16 / end 20, icon 20, label `Text role="transcript" weight={600}` (16/600); end inset 16; bottom = safe-area bottom + 6 | extended FAB `h-new` 56, `rounded-new` 16, padding start 16 / end 20, icon 24, label `text-ui` 14/600, `bg-accent text-on-accent`, `shadow-float`; end 16, bottom = safe-area bottom + 16 | §B.4, `.afab` |
| Composer | `rounded-composer` 28, glass (§8); controls `size-icon-button-sm` 36, gap ≥ 8; Send/Stop 36 ink circle; text `text-transcript` | `rounded-composer` 28, `bg-raised`; controls 40; Send/Stop `h-control-lg` 48, `rounded-card-lg` 16; mic in the action row (MD-03) | §B.21 |
| Toast | `h-toast` 48, `rounded-toast` 24, glass; icon 18 + `text-ui` 15 + "Undo" h38 → `size-icon-button-sm` text action | snackbar `h-toast` 48, `rounded-toast` 8, **inverse** `bg-fg text-surface` + "Undo" `text-ui` 14/600 | §B.14 |
| Swipe actions | leading (Pin, Unread) 64 each; trailing (More, Archive) 74 each | trailing 74 each (derived: same as iOS) | `MGestures` |
| Drawer | snaps open past 40 % drag | button only (MD-19) | `MGestures` |
| iPad / Android-tablet panels | sidebar and pane as inset cards: margin 8, `rounded-group` 22, `bg-raised`, 1 px `border-line-soft` | sidebar edge-attached `bg-raised`; pane `bg-overlay` + start `border-line` | `MTabletIOS`, `MTabletAndroid` |
| Phone panels | drawer `bg-surface` + end `border-line-soft`, `rounded-panel` 28 end corners, `shadow-pop` | drawer `bg-overlay`, `rounded-panel` 16 end corners | `.drawer-i`, `.drawer-a` (MD-72) |

### 3.7 Z-order

Mobile uses the web names and numbers (`Z_INDEX`: base 0, sticky 10, dock 20, rail 30, sidebar 30, dialog 1000,
dropdown 1100, popover 1100, toast 1150, tooltip 1200) as RN `zIndex` within one parent. `z-rail` is banned on mobile.
Native sheets, menus and alerts are separate native windows and ignore z-index.

### 3.8 Mobile-only vocabulary and TypeScript shape (additive)

**New file `packages/design-tokens/src/vocabulary-mobile.ts`** (a leaf; imports only `vocabulary.ts`):

```ts
import { RADIUS_UTILITY_PREFIXES, twMergeExtension, type VocabularyNamespace } from './vocabulary.js';

export const MOBILE_TEXT_STEPS = ['detail-title', 'transcript', 'mono-lg', 'mono', 'mono-sm'] as const;
export type MobileTextStep = (typeof MOBILE_TEXT_STEPS)[number];

export const MOBILE_RADIUS_STEPS = ['seg-item', 'card-lg', 'group', 'nav', 'field', 'code', 'composer', 'new', 'toast'] as const;
export type MobileRadiusStep = (typeof MOBILE_RADIUS_STEPS)[number];

export const MOBILE_HEIGHT_NAMES = [
  'chip', 'seg', 'field', 'search', 'search-sm', 'row-2', 'bar-lg', 'hit', 'icon-button', 'icon-button-sm', 'new', 'toast', 'badge-sm',
] as const;
export type MobileHeightName = (typeof MOBILE_HEIGHT_NAMES)[number];

export const MOBILE_SIZE_NAMES = ['hit', 'icon-button', 'icon-button-sm'] as const satisfies readonly MobileHeightName[];
export const MOBILE_WIDTH_NAMES = ['hit'] as const satisfies readonly MobileHeightName[]; // min-w-hit

export const MOBILE_CONTAINER_NAMES = ['drawer', 'pane'] as const;
export type MobileContainerName = (typeof MOBILE_CONTAINER_NAMES)[number];

export const MOBILE_SPACING_NAMES = ['gutter', 'gutter-title'] as const;
export type MobileSpacingName = (typeof MOBILE_SPACING_NAMES)[number];

export const MOBILE_SHADOW_NAMES = ['float'] as const;

/** Window-size classes (MD-24), emitted as literal `--breakpoint-*` (medium:, expanded:). */
export const MOBILE_BREAKPOINTS = { medium: 600, expanded: 840 } as const;

/** Shared utilities with no mobile meaning; the mobile design lint rejects them. */
export const MOBILE_BANNED_SHARED_UTILITIES = [
  'h-strip', 'min-h-strip', 'max-h-strip',
  'w-rail', 'min-w-rail', 'max-w-rail', 'z-rail',
  'w-aside', 'max-w-aside', 'w-side-rail', 'max-w-side-rail', 'w-inspector', 'max-w-inspector',
  'h-th', // use min-h-th: section labels grow with text
] as const;

export const MOBILE_VOCABULARY_NAMESPACES: readonly VocabularyNamespace[] = [
  { id: 'm-text', prefixes: ['text'], names: MOBILE_TEXT_STEPS },
  { id: 'm-radius', prefixes: RADIUS_UTILITY_PREFIXES, names: MOBILE_RADIUS_STEPS },
  { id: 'm-height', prefixes: ['h', 'min-h', 'max-h'], names: MOBILE_HEIGHT_NAMES },
  { id: 'm-size', prefixes: ['size'], names: MOBILE_SIZE_NAMES },
  { id: 'm-width', prefixes: ['min-w'], names: MOBILE_WIDTH_NAMES },
  { id: 'm-container', prefixes: ['w', 'min-w', 'max-w'], names: MOBILE_CONTAINER_NAMES },
  { id: 'm-spacing', prefixes: ['p', 'px', 'py', 'ps', 'pe', 'pt', 'pb', 'm', 'mx', 'my', 'ms', 'me', 'mt', 'mb', 'gap', 'gap-x', 'gap-y', 'inset', 'start', 'end', 'top', 'bottom'], names: MOBILE_SPACING_NAMES },
  { id: 'm-shadow', prefixes: ['shadow'], names: MOBILE_SHADOW_NAMES },
];

/** tailwind-merge v3 extension for mobile = the shared extension + the mobile names. */
export function mobileTwMergeExtension(): ReturnType<typeof twMergeExtension>;
```

`mobileTwMergeExtension()` deep-merges `twMergeExtension()` with: `theme.text += MOBILE_TEXT_STEPS`,
`theme.radius += MOBILE_RADIUS_STEPS`, `theme.shadow += MOBILE_SHADOW_NAMES`, `theme.container += MOBILE_CONTAINER_NAMES`,
`theme.spacing = MOBILE_SPACING_NAMES`, `classGroups.h/min-h/max-h += MOBILE_HEIGHT_NAMES`, `classGroups.size += MOBILE_SIZE_NAMES`,
`classGroups['min-w'] = [{ 'min-w': ['hit'] }]`.

**Additions to `packages/design-tokens/src/geometry.ts`** (`PlatformGeometry` and `GEOMETRY.web` are unchanged; the
`ios` / `android` slots change from `PlatformGeometry | undefined` to a filled `NativeGeometry`. The only reader today is
`src/__tests__/scales.test.ts`, which is updated in the same commit and logged in `COORDINATION.md`):

```ts
import type {
  MobileContainerName, MobileHeightName, MobileRadiusStep, MobileSpacingName, MobileTextStep,
} from './vocabulary-mobile.js';

/** iOS text styles accepted by RN `Text` `dynamicTypeRamp`. */
export type DynamicTypeRamp =
  | 'caption2' | 'caption1' | 'footnote' | 'subheadline' | 'callout' | 'body'
  | 'headline' | 'title3' | 'title2' | 'title1' | 'largeTitle';

/** M3 type roles (Android reference; `null` = off-scale value the boards chose). */
export type M3TypeRole =
  | 'displayLarge' | 'displayMedium' | 'displaySmall' | 'headlineLarge' | 'headlineMedium' | 'headlineSmall'
  | 'titleLarge' | 'titleMedium' | 'titleSmall' | 'bodyLarge' | 'bodyMedium' | 'bodySmall'
  | 'labelLarge' | 'labelMedium' | 'labelSmall';

export interface NativeTypeStep {
  size: number;              // pt / sp
  lineHeight: number;        // ABSOLUTE pt / sp (MD-71)
  weight: 400 | 500 | 600;
  tracking: number;          // ABSOLUTE pt / sp (letterSpacing)
  ramp: DynamicTypeRamp;     // iOS scaling curve; Android ignores it
  m3: M3TypeRole | null;     // Android reference role
  maxScale: number;          // maxFontSizeMultiplier for content use; 0 = uncapped
  mono: boolean;             // JetBrains Mono (+ tabular by construction)
}

export interface NativeControlGeometry {
  switch: { width: number; height: number; thumbOn: number; thumbOff: number; outline: number };
  checkbox: { size: number; radius: number; border: number };
  radio: { size: number; ring: number; dot: number; checkmark: number };
  segmented: { trackPadding: number; gap: number };
  chip: { paddingX: number; gap: number; check: number };
  badge: { paddingX: number; icon: number; statusLineIcon: number };
  grabber: { width: number; height: number; radius: number };
  sheetInset: number;
  newAction: { endInset: number; bottomAboveSafeArea: number; icon: number; paddingStart: number; paddingEnd: number };
  header: { maxTrailing: number; overflowMenu: boolean; backGlyph: number; toolbarGlyph: number };
  swipeAction: { leading: number; trailing: number };
  composer: { control: number; controlGap: number; send: number };
  drawerSnapFraction: number;
}

export interface NativeGeometry extends Omit<PlatformGeometry, 'type' | 'radiusOffsets'> {
  unit: 'pt' | 'dp';
  /** Shared steps + mobile steps. */
  type: Record<TextStep | MobileTextStep, NativeTypeStep>;
  /** Absolute radii; themes do not change them (MD-69). */
  radii: Record<RadiusStep | MobileRadiusStep, number>;
  /** Mobile-only heights (the shared ones stay in `heights`, both densities identical). */
  mobileHeights: Record<MobileHeightName, number>;
  mobileShell: Record<MobileContainerName, number>;
  /** Max fraction of the window width a phone panel may take (79 % / 82 %, 89 %). */
  panelMaxFraction: Record<MobileContainerName, number>;
  spacing: Record<MobileSpacingName, number>;
  breakpoints: { medium: 600; expanded: 840 };
  /** maxFontSizeMultiplier for dense chrome (badges, chips, counts, tab labels, key row). */
  chromeScaleCap: number;
  icon: { sizes: readonly (12 | 14 | 16 | 18 | 20 | 22 | 24)[]; header: number; row: number; inline: number; badge: number };
  controls: NativeControlGeometry;
  tablet: { panelInset: number; panelRadiusStep: 'group' | null; paneSurface: 'raised' | 'overlay' };
}

export interface Geometry {
  web: PlatformGeometry;
  ios: NativeGeometry;
  android: NativeGeometry;
}
```

**The values** (`GEOMETRY.ios` / `GEOMETRY.android`), every field:

| Field | iOS | Android |
|---|---|---|
| `unit` | `'pt'` | `'dp'` |
| `type` | §3.1 / §4.1 rows | §3.1 / §4.1 rows |
| `radii` | badge 12, control-sm 16, control 12, seg 9, card 14, panel 28, dialog 38, seg-item 7, card-lg 20, group 22, nav 12, field 12, code 12, composer 28, new 26, toast 24 | badge 8, control-sm 8, control 8, seg 20, card 12, panel 16, dialog 28, seg-item 8, card-lg 16, group 16, nav 24, field 4, code 8, composer 28, new 16, toast 8 |
| `heights.comfortable` = `heights.compact` | control-sm 36, control 44, control-lg 50, nav 44, item 44, step 44, th 30, row 52, tab 32, bar 52, badge 24, kbd 40, panel-bar 52, dialog-bar 56, footer 64, strip 0, meter 4, tile 72 | control-sm 36, control 40, control-lg 48, nav 48, item 48, step 48, th 30, row 56, tab 48, bar 64, badge 26, kbd 40, panel-bar 52, dialog-bar 64, footer 64, strip 0, meter 4, tile 72 |
| `mobileHeights` | chip 32, seg 32, field 44, search 44, search-sm 44, row-2 68, bar-lg 60, hit 44, icon-button 44, icon-button-sm 36, new 52, toast 48, badge-sm 20 | chip 32, seg 40, field 56, search 56, search-sm 48, row-2 72, bar-lg 64, hit 48, icon-button 48, icon-button-sm 40, new 56, toast 48 |
| `minHitTarget` | 44 | 48 |
| `zIndex` | `Z_INDEX` | `Z_INDEX` |
| `shell` | sidebar 312, rail 0, dock 410, dock-run 410, sheet 540, aside 320, side-rail 360, inspector 400, dialog-sm 290, dialog 540, dialog-lg 720 | sidebar 300, rail 0, dock 400, dock-run 400, sheet 640, aside 320, side-rail 360, inspector 400, dialog-sm 300, dialog 560, dialog-lg 720 |
| `mobileShell` | drawer 318, pane 356 | drawer 336, pane 364 |
| `panelMaxFraction` | drawer 0.79, pane 0.89 | drawer 0.82, pane 0.89 |
| `spacing` | gutter 16, gutter-title 20 | gutter 16, gutter-title 16 |
| `breakpoints` | 600 / 840 | 600 / 840 |
| `chromeScaleCap` | 1.4 | 1.4 |
| `icon` | sizes [12, 14, 16, 18, 20, 22, 24]; header 22, row 20, inline 16, badge 14 | same sizes; header 24, row 24, inline 16, badge 14 |
| `controls.switch` | 51, 31, thumbOn 27, thumbOff 27, outline 0 | 52, 32, thumbOn 24, thumbOff 16, outline 2 |
| `controls.checkbox` | size 22, radius 11, border 1.5 | size 18, radius 3, border 2 |
| `controls.radio` | size 0, ring 0, dot 0, checkmark 18 | size 20, ring 2, dot 10, checkmark 0 |
| `controls.segmented` | trackPadding 2, gap 0 | trackPadding 0, gap 2 |
| `controls.chip` | paddingX 12, gap 6, check 16 | paddingX 12, gap 8, check 16 |
| `controls.badge` | paddingX 9, icon 14, statusLineIcon 12 | paddingX 8, icon 14, statusLineIcon 12 |
| `controls.grabber` | 36, 5, 3 | 32, 4, 2 |
| `controls.sheetInset` | 8 | 0 |
| `controls.newAction` | endInset 16, bottomAboveSafeArea 6, icon 20, paddingStart 16, paddingEnd 20 | endInset 16, bottomAboveSafeArea 16, icon 24, paddingStart 16, paddingEnd 20 |
| `controls.header` | maxTrailing 3, overflowMenu false, backGlyph 22, toolbarGlyph 22 | maxTrailing 2, overflowMenu true, backGlyph 24, toolbarGlyph 24 |
| `controls.swipeAction` | leading 64, trailing 74 | leading 64, trailing 74 |
| `controls.composer` | control 36, controlGap 8, send 36 | control 40, controlGap 8, send 48 |
| `controls.drawerSnapFraction` | 0.4 | 0.4 |
| `tablet` | panelInset 8, panelRadiusStep `'group'`, paneSurface `'raised'` | panelInset 0, panelRadiusStep `null`, paneSurface `'overlay'` |

**Tests** (`scales.test.ts`, replacing the "leaves iOS and Android as typed empty slots" case):
- every `NativeGeometry` record has exactly the keys of its name list (`TEXT_STEPS ∪ MOBILE_TEXT_STEPS`, …);
- MD-28 floors: `minHitTarget` 44 / 48; every `type[*].size ≥ 11` (iOS) and `≥ 12` (Android); every mono size ≥ 12;
  every weight ∈ {400, 500, 600}; `heights.row/item/nav/step ≥ minHitTarget` except `th` (not interactive);
  `mobileHeights.hit/icon-button === minHitTarget`;
- `heights.comfortable` deep-equals `heights.compact` on both native platforms;
- `panelMaxFraction` ≤ 1; `mobileShell.drawer < mobileShell.pane`.

`src/index.ts` adds `export * from './vocabulary-mobile.js'`, `'./accent.js'`, `'./motion.js'`, `'./haptics.js'`,
`'./glass.js'`. No existing export changes.

### 3.9 Renames applied to `03-components.md` §1.4 (applied during plan integration, 2026-09-26)

| 03 name | This file | Why |
|---|---|---|
| `text-<role>` with roles `largeTitle`, `title`, `headline`, `detailTitle`, `body`, `transcript`, `subhead`, `footnote`, `caption`, `mono*` | classes `text-display`, `text-heading`, `text-title`, `text-detail-title`, `text-body`, `text-transcript`, `text-ui`, `text-small`, `text-micro`, `text-mono-lg/mono/mono-sm`; the **`Text` `role` prop keeps 03's role names** (§4.2) | one vocabulary with web |
| `rounded-chip` | `rounded-control-sm` | shared name |
| `rounded-gate`, `rounded-tile` | `rounded-card-lg` | one concentric step (MD-50) |
| `rounded-sheet` | `rounded-dialog` | shared name |
| `rounded-card` 14 / 12 | unchanged | — |
| `rounded-group` Android 16 | unchanged | — |
| (none) | `rounded-nav` 12 / 24 | drawer items differ by platform (MD-02) |
| `h-button`, `h-button-sm`, `h-button-lg` | `h-control`, `h-control-sm`, `h-control-lg` | shared names |
| `h-pane-bar` | `h-panel-bar` | shared name |
| `min-h-row` Android 64 | `min-h-row` Android **56** | M3 one-line; board switch/form rows 56 (MD-59) |
| `min-h-row-dense` | `min-h-item` (rows) / `min-h-step` (tool steps) / `min-h-nav` (drawer nav) | shared names |
| `h-search` iOS 40 (MD-46) | `h-search` / `h-search-sm` iOS **44** | MD-28 (MD-46) |
| `w-pane-docked` | `w-dock` | shared name |
| `w-drawer` iOS cap 82 % | iOS cap **79 %** | MFoundations "79% / 82%" |

---

## 4. Typography

### 4.1 Roles

| `Text` role (prop) | Class | iOS size / lh / weight | iOS `dynamicTypeRamp` | Android size / lh / weight (sp) | Android M3 role | `maxScale` (content) | Used for |
|---|---|---|---|---|---|---|---|
| `largeTitle` | `text-display` | 32 / 37 / 600, tracking −0.64 | `largeTitle` | 28 / 34 / 600, tracking −0.28 | `headlineMedium` | 1.3 | RN-drawn large titles (Android Home headline, iPad, pairing) |
| `title` | `text-heading` | 20 / 25 / 600, −0.2 | `title3` | 22 / 28 / 600 | `titleLarge` | 1.4 | section titles, sheet big titles, Android bar title, Home count values (MD-71) |
| `headline` | `text-title` | 17 / 22 / 600 | `headline` | 16 / 24 / 600 | `titleMedium` | 1.6 | collapsed bar title, iOS sheet/modal titles, Home section headers, list-row titles that are headings |
| `detailTitle` | `text-detail-title` | 16 / 21 / 600 | `callout` | 18 / 24 / 600 | `null` (18 is off-scale by design) | 1.4 | detail / chat header title |
| `body` | `text-body` | 17 / 24 / 400 | `body` | 16 / 24 / 400 | `bodyLarge` | 0 (uncapped) | rows, forms, menus in JS, search |
| `transcript` | `text-transcript` | 16 / 24 / 400 | `callout` | 16 / 24 / 400 | `bodyLarge` | 0 | chat prose, bubbles, composer input |
| `subhead` | `text-ui` | 15 / 20 / 400 | `subheadline` | 14 / 20 / 400 | `bodyMedium` | 0 | secondary lines, button labels (600), tool-block titles (600) |
| `footnote` | `text-small` | 13 / 18 / 400 | `footnote` | 14 / 20 / 400 | `bodyMedium` | 0 | meta lines, help text, section labels (600) |
| `caption` | `text-micro` | 12 / 16 / 500 | `caption1` | 12 / 16 / 500 | `labelMedium` | 0 | breadcrumbs, timestamps, badges, chips' counts |
| `monoLg` | `text-mono-lg` | 14 / 20 / 400 | `subheadline` | 14 / 20 / 400 | `bodyMedium` | 0 | commands in gate cards, code blocks |
| `mono` | `text-mono` | 13 / 19 / 400 | `footnote` | 13 / 19 / 400 | `bodyMedium` | 0 | paths, ids, diff lines, tool targets |
| `monoSm` | `text-mono-sm` | 12 / 17 / 400 | `caption1` | 12 / 17 / 400 | `bodySmall` | 0 | counters, timers, elapsed, pane counts |

- **`chrome` flag:** when a `Text` sits in dense chrome (badge, chip, count, pane-tab label, key row, header buttons,
  drawer live rows), `maxFontSizeMultiplier = min(role maxScale || ∞, chromeScaleCap 1.4)`. MFoundations allows dense
  chrome up to 1.6×; 1.4 is the kit value (the existing `MAX_SCALE.chrome`), 1.6 is reserved for `headline`.
- `maxScale` applies on **both** platforms (RN supports `maxFontSizeMultiplier` on iOS and Android). On iOS it clamps the
  multiplier after the `dynamicTypeRamp` curve (verify at AX5 in M3-06; stack-styling §4 risk).
- Android has no per-style curve; Android 14+ scales non-linearly to 200 %. Caps are tested at font scale 1.0, 1.3 and
  2.0 (Android) and L, XXXL, AX3, AX5 (iOS) (08-verification).
- `allowFontScaling={false}` only in the terminal WebView bridge (pinch sets 10–20 there, MD-38). Lint enforces it.
- The existing `apps/mobile/src/components/ui/accessibility.ts` `MAX_SCALE` (`chrome 1.4`, `control 1.8`) is replaced
  by these tokens; `control 1.8` is deleted.

**Board sizes that are off the ramp and what they become** (boards-core §A.1 measured sizes):

| Board size | Where | Becomes |
|---|---|---|
| 24 | iOS Pairing title, Home count values | `title` (20 / 22) with tabular numerals (MD-71) |
| 18 | Android sheet / pane titles, stats | Android `detailTitle` (18) for pane/sheet titles; stats use `title` |
| 11 | widgets, badge timers, pane-badge count (screen boards) | `caption` 12 (MD-28, MD-71); native widget targets follow their own OS minimums |
| 10 | `MComponents` pane badge | `caption` 12 (MD-71) |
| weight 700 | search-palette highlight | 600 (MD-71) |

### 4.2 The `Text` primitive contract

File: `apps/mobile/src/ui/primitives/Text/Text.tsx` (MP-01; one implementation file; platform differences come from geometry).

```ts
import type { TextProps as RNTextProps } from 'react-native';

export type TextRole =
  | 'largeTitle' | 'title' | 'headline' | 'detailTitle' | 'body' | 'transcript'
  | 'subhead' | 'footnote' | 'caption' | 'monoLg' | 'mono' | 'monoSm';

export type TextTone =
  | 'fg' | 'fg-2' | 'fg-3' | 'on-accent' | 'run' | 'ok' | 'warn' | 'err' | 'surface' /* inverse snackbar */;

export interface TextProps
  extends Omit<RNTextProps, 'style' | 'allowFontScaling' | 'maxFontSizeMultiplier' | 'dynamicTypeRamp'> {
  role?: TextRole;              // default 'body'
  tone?: TextTone;              // default 'fg'
  weight?: 400 | 500 | 600;     // default = the role's weight
  tabular?: boolean;            // fontVariant ['tabular-nums']; default true for mono* roles, false otherwise
  chrome?: boolean;             // dense chrome → cap at 1.4 (§4.1)
  align?: 'start' | 'center' | 'end';
  className?: string;           // LAYOUT ONLY (margin, flex, width). Lint rejects text-size, colour, font and leading classes here.
}
```

Behaviour:
1. Renders RN `Text` with `className = cn(roleClass, toneClass, weightClass, fontClass, alignClass, className)` where
   `roleClass = 'text-' + class of role`, `toneClass = 'text-' + tone`, `weightClass` ∈ `font-normal | font-medium |
   font-semibold`, `fontClass` = `font-mono` for `mono*` roles else `font-sans`, `alignClass` = `text-start | text-center
   | text-end` (start/end only, MD-29).
2. Sets `dynamicTypeRamp = geometry().type[step].ramp` (iOS; ignored on Android).
3. Sets `maxFontSizeMultiplier` per §4.1 (0 → prop omitted).
4. `tabular` → `style={{ fontVariant: ['tabular-nums'] }}` (computed, allowed). Instrument Sans has `tnum`
   (stack-styling §4); JetBrains Mono is tabular by construction.
5. `accessibilityRole = 'header'` for `largeTitle`, `title`, `detailTitle` unless overridden.
6. `selectable` defaults to true for `transcript` and `mono*`, false otherwise.
7. Every other RN `Text` import in `src/features/**` and `src/blocks/**` is a lint error (`rawTextImport`, §9.8).

### 4.3 Minimums and weights (MD-28, MD-41)

- iOS text ≥ 11 pt anywhere; the kit's smallest role is 12 (`caption`, `monoSm`), so 11 never appears.
- Android text ≥ 12 sp in content.
- Mono never below 12.
- Weights 400 / 500 / 600 only (`font-normal`, `font-medium`, `font-semibold`); `font-bold`, `font-extrabold`,
  `font-black`, `fontWeight: '700' | 'bold' | '800' | '900'` are lint errors.
- Tabular numerals for counters, timers, token counts, table figures and the context gauge.

### 4.4 Font embedding

**Families and names:**

| Family | Weights | iOS family name (from the font's name table) | Android family name (registered by the plugin) | CSS token |
|---|---|---|---|---|
| Instrument Sans | 400, 500, 600 (upright only) | `Instrument Sans` | `Instrument Sans` | `--font-sans: var(--gai-font-sans)` |
| JetBrains Mono | 400, 500, 600 (upright only) | `JetBrains Mono` | `JetBrains Mono` | `--font-mono: var(--gai-font-mono)` |

- `--gai-font-sans` / `--gai-font-mono` are emitted in the `@variant ios` and `@variant android` geometry blocks
  (§9.2) so the name can differ per OS without code. Both are `'Instrument Sans'` / `'JetBrains Mono'` initially. If
  the M3-06 check shows Android rejects a space in the registered family, register `InstrumentSans` / `JetBrainsMono`
  on Android and change only the `@variant android` values.
- Weight selection is by `fontWeight` within the family on both OSes (iOS RN font matching by family + weight; Android
  via the plugin's `fontDefinitions` weights). Never reference a face name (`InstrumentSans-SemiBold`) in code.
- The legacy literal `fontFamily: 'JetBrainsMono'` (`PlanSheet.tsx:342`, `StartRunSheet.tsx:384`,
  `TriggerInputSheet.tsx:224`; never loaded — foundations-state M-14) is deleted with those files or replaced by
  `role="mono"`.
- `NATIVE_FONT_FAMILY` in `tokens.ts` is left untouched (web-safe); mobile stops reading it with `tokens.generated.ts`.

**Source files:**
- **SDK 57 (M1–M2, no new UI; only if fonts are needed before M3):** `@expo-google-fonts/instrument-sans` 0.4.2
  (`InstrumentSans_400Regular.ttf`, `InstrumentSans_500Medium.ttf`, `InstrumentSans_600SemiBold.ttf`) and
  `@expo-google-fonts/jetbrains-mono` 0.4.1 (`JetBrainsMono_400Regular.ttf`, `JetBrainsMono_500Medium.ttf`,
  `JetBrainsMono_600SemiBold.ttf`).
- **SDK 58+ (M3-06):** vendored variable TTFs in `apps/mobile/assets/fonts/` — `InstrumentSans[wdth,wght].ttf` (from
  github.com/Instrument/instrument-sans) and `JetBrainsMono[wght].ttf` (from github.com/JetBrains/JetBrainsMono), each
  with its `OFL.txt` next to it (licence note: `packages/design-tokens/src/themes/fonts.ts` header). If variable weights
  render wrong on either OS at the M3-06 check (compare 500 and 600 against the static files in a Storybook story),
  keep the static files and record why in `reviews/`.

**`app.config.ts` plugin entry** (SDK 57 static form; paths relative to `apps/mobile`):

```ts
[
  'expo-font',
  {
    ios: {
      fonts: [
        './node_modules/@expo-google-fonts/instrument-sans/400Regular/InstrumentSans_400Regular.ttf',
        './node_modules/@expo-google-fonts/instrument-sans/500Medium/InstrumentSans_500Medium.ttf',
        './node_modules/@expo-google-fonts/instrument-sans/600SemiBold/InstrumentSans_600SemiBold.ttf',
        './node_modules/@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf',
        './node_modules/@expo-google-fonts/jetbrains-mono/500Medium/JetBrainsMono_500Medium.ttf',
        './node_modules/@expo-google-fonts/jetbrains-mono/600SemiBold/JetBrainsMono_600SemiBold.ttf',
      ],
    },
    android: {
      fonts: [
        {
          fontFamily: 'Instrument Sans',
          fontDefinitions: [
            { path: './node_modules/@expo-google-fonts/instrument-sans/400Regular/InstrumentSans_400Regular.ttf', weight: 400 },
            { path: './node_modules/@expo-google-fonts/instrument-sans/500Medium/InstrumentSans_500Medium.ttf', weight: 500 },
            { path: './node_modules/@expo-google-fonts/instrument-sans/600SemiBold/InstrumentSans_600SemiBold.ttf', weight: 600 },
          ],
        },
        {
          fontFamily: 'JetBrains Mono',
          fontDefinitions: [
            { path: './node_modules/@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf', weight: 400 },
            { path: './node_modules/@expo-google-fonts/jetbrains-mono/500Medium/JetBrainsMono_500Medium.ttf', weight: 500 },
            { path: './node_modules/@expo-google-fonts/jetbrains-mono/600SemiBold/JetBrainsMono_600SemiBold.ttf', weight: 600 },
          ],
        },
      ],
    },
  },
],
```

(Resolve the package directory with `path.dirname(require.resolve('@expo-google-fonts/instrument-sans/package.json'))`
in `app.config.ts` rather than a hard-coded `node_modules` path, because pnpm may not hoist it; verify the per-weight
sub-folder layout of the installed version first.)

**SDK 58 variable form:** the same structure with every `path` pointing at the one variable file per family
(`./assets/fonts/InstrumentSans[wdth,wght].ttf` with weights 400, 500, 600; `./assets/fonts/JetBrainsMono[wght].ttf`
with 400, 500, 600) and `ios.fonts` listing the two variable files. Embedded fonts are available before the first frame,
so no `useFonts` / `loadAsync` call and no FOUT; the splash hold (§9.5) needs no font wait.

**Material Symbols font (Android icons, §5):** `expo-symbols` draws Material Symbols from a font. Embed **one weight
(400) of the Outlined style only** through the same `expo-font` plugin (the package ships one font per weight, 6.8 MB
unpacked in total; stack-styling §5). Record the APK size delta in `reviews/`.

### 4.5 Numbers, dates, durations

Formatted through `Intl` (MD-29), rendered in `monoSm` (timers, elapsed) or with `tabular` on sans roles (counts).

### 4.6 System font for native chrome

Native chrome keeps the system font (SF Pro / Roboto or the OEM font): alerts, action sheets, menus and context menus,
pickers, date pickers, native segmented controls, switches, `Stack.Toolbar` items, **native header titles** (the iOS
native inline and large title, if 06 uses `headerLargeTitle`), keyboard accessory, share sheet, notifications, widgets
and Live Activities (SwiftUI / Glance targets use system type). Rule: never set `headerTitleStyle.fontFamily`, never
style Expo UI text with our family, never pass our family into native modules (MD-74). RN-drawn titles (custom title
view with breadcrumb, Android JS top app bar) use the `Text` roles above.

---

## 5. Icons

### 5.1 Registry extension (`packages/design-tokens/src/icons.ts`, additive)

```ts
export interface IconConceptDef {
  /** Canonical lucide 1.x name (kebab-case). Web and lucide-only mobile glyphs. */
  lucide: string;
  /** SF Symbol (iOS). Absent only when `lucideOnly`. */
  sfSymbol?: string;
  /** SF Symbol for the filled / selected state (e.g. 'pin.fill'). */
  sfSymbolFill?: string;
  /** Material Symbols name (Android, Outlined style, weight 400). Absent only when `lucideOnly`. */
  material?: string;
  /** The concept has a filled state on Android → rendered from the generated SVG (expo#46850). */
  materialFill?: true;
  /** Domain glyph with no native counterpart: lucide on iOS and Android (MD-41). */
  lucideOnly?: true;
  /** Flip horizontally in RTL on Android (SF uses .forward/.backward names that flip themselves). */
  mirrorInRtl?: true;
}
```

Every concept below gets these fields; `ICON_CONCEPTS`, `IconConcept`, `lucideName()` and the web registry are
unchanged (web only reads `lucide`). The existing assertion in `src/__tests__/icons.test.ts`
("uses kebab-case lucide 1.x names and **empty mobile slots**", `expect(Object.keys(def)).toEqual(['lucide'])`) is
replaced by the registry test in §5.4 — that is the only change to an existing test.

**FOUNDATION_CONCEPTS (48):**

| Concept | lucide | sfSymbol | sfSymbolFill | material | materialFill | Notes |
|---|---|---|---|---|---|---|
| home | house | `house` | — | `home` | — | |
| chats | message-square | `bubble.left` | — | `chat_bubble` | — | |
| projects | folder | `folder` | — | `folder` | — | |
| agents | bot | — | — | — | — | **lucideOnly** (agent identity glyph, identical to web AgentGlyph; MD-73) |
| workflows | workflow | `flowchart` | — | `account_tree` | — | |
| automations | calendar-clock | `calendar.badge.clock` | — | `event_repeat` | — | |
| scripts | file-code-corner | `chevron.left.forwardslash.chevron.right` | — | `code` | — | |
| settings | settings | `gearshape` | — | `settings` | — | |
| search | search | `magnifyingglass` | — | `search` | — | |
| plus | plus | `plus` | — | `add` | — | |
| more | ellipsis | `ellipsis` | — | `more_horiz` | — | |
| x | x | `xmark` | — | `close` | — | |
| check | check | `checkmark` | — | `check` | — | |
| edit | pencil | `pencil` | — | `edit` | — | |
| trash | trash | `trash` | — | `delete` | — | |
| copy | copy | `doc.on.doc` | — | `content_copy` | — | |
| changes | git-compare | — | — | — | — | **lucideOnly** (git family) |
| files | files | `doc.plaintext` | — | `topic` | — | |
| terminal | square-terminal | `apple.terminal` | — | `terminal` | — | |
| browser | globe | `globe` | — | `language` | — | |
| tasks | list-tree | `list.bullet.indent` | — | `pending_actions` | — | background tasks |
| computer | monitor | `desktopcomputer` | — | `computer` | — | |
| plan | list-checks | `checklist` | — | `checklist` | — | |
| widgets | layout-grid | `square.grid.2x2` | — | `grid_view` | — | |
| branch | git-branch | — | — | — | — | **lucideOnly** (git family) |
| commit | git-commit-horizontal | — | — | — | — | **lucideOnly** |
| pr | git-pull-request | — | — | — | — | **lucideOnly** |
| diff | file-diff | — | — | — | — | **lucideOnly** |
| history | rotate-ccw-clock | `clock.arrow.circlepath` | — | `history` | — | |
| play | play | `play` | `play.fill` | `play_arrow` | yes | Run buttons render filled |
| stop | square | `stop` | `stop.fill` | `stop` | yes | composer Stop is filled |
| retry | rotate-ccw | `arrow.counterclockwise` | — | `replay` | — | |
| send | arrow-up | `arrow.up` | — | `arrow_upward` | — | |
| attach | paperclip | `paperclip` | — | `attach_file` | — | |
| mic | mic | `mic` | — | `mic` | — | |
| skills | book-open | `book` | — | `menu_book` | — | |
| mcp | plug | `powerplug` | — | `electrical_services` | — | |
| hook | anchor | — | — | — | — | **lucideOnly** (no SF anchor) |
| variable | variable | — | — | — | — | **lucideOnly** (domain) |
| webhook | webhook | — | — | — | — | **lucideOnly** (no SF counterpart; kept identical on both OSes) |
| clock | clock | `clock` | — | `schedule` | — | |
| server | server | `server.rack` | — | `dns` | — | |
| lock | lock | `lock` | — | `lock` | — | |
| key | key-round | `key` | — | `key` | — | |
| bell | bell | `bell` | — | `notifications` | — | |
| info | info | `info.circle` | — | `info` | — | |
| warning | triangle-alert | `exclamationmark.triangle` | — | `warning` | — | |
| hand | hand | `hand.raised` | — | `back_hand` | — | |

**STATUS_CONCEPTS (8):**

| Concept | lucide | sfSymbol | material | Motion (§5.3) |
|---|---|---|---|---|
| status-queued | circle-dashed | `circle.dashed` | `pending` | none |
| status-running | loader-circle | `progress.indicator` | `progress_activity` | rotate 1000 ms linear, both OSes; static under reduced motion |
| status-waiting | clock | `clock` | `schedule` | none (neutral state) |
| status-needs-you | hand | `hand.raised` | `back_hand` | iOS: one `bounce` when the item first appears; Android: none |
| status-paused | circle-pause | `pause.circle` | `pause_circle` | none |
| status-succeeded | circle-check | `checkmark.circle` | `check_circle` | none |
| status-failed | circle-x | `xmark.circle` | `cancel` | none |
| status-skipped | circle-minus | `minus.circle` | `do_not_disturb_on` | none |

**UI_CONCEPTS (58):**

| Concept | lucide | sfSymbol | sfSymbolFill | material | materialFill | Notes |
|---|---|---|---|---|---|---|
| chevron-down | chevron-down | `chevron.down` | — | `keyboard_arrow_down` | — | |
| chevron-right | chevron-right | `chevron.forward` | — | `chevron_right` | — | `mirrorInRtl` |
| chevron-up | chevron-up | `chevron.up` | — | `keyboard_arrow_up` | — | |
| chevron-left | chevron-left | `chevron.backward` | — | `chevron_left` | — | `mirrorInRtl` |
| sidebar | panel-left | `sidebar.left` | — | `menu` | — | Android drawer toggle idiom |
| dock | panel-right | `sidebar.right` | — | `view_sidebar` | — | pane toggle |
| maximize | maximize-2 | `arrow.up.left.and.arrow.down.right` | — | `open_in_full` | — | |
| shield | shield-check | `checkmark.shield` | — | `verified_user` | — | |
| file | file | `doc` | — | `draft` | — | |
| folder-open | folder-open | `folder` | — | `folder_open` | — | SF has no open-folder glyph (intentional duplicate with `projects`) |
| file-text | file-text | `doc.text` | — | `description` | — | |
| refresh | refresh-cw | `arrow.clockwise` | — | `refresh` | — | |
| forward | arrow-right | `arrow.forward` | — | `arrow_forward` | — | `mirrorInRtl` |
| back | arrow-left | `arrow.backward` | — | `arrow_back` | — | `mirrorInRtl`; header back is the native control |
| undo | undo-2 | `arrow.uturn.backward` | — | `undo` | — | |
| redo | redo-2 | `arrow.uturn.forward` | — | `redo` | — | |
| restart | rotate-cw | `arrow.clockwise.circle` | — | `restart_alt` | — | |
| view | eye | `eye` | — | `visibility` | — | |
| upload | upload | `arrow.up.to.line` | — | `upload` | — | |
| download | download | `arrow.down.to.line` | — | `download` | — | |
| save | save | `square.and.arrow.down` | — | `save` | — | |
| tool | wrench | `wrench.adjustable` | — | `build` | — | |
| scan | scan | `viewfinder` | — | `crop_free` | — | |
| external-link | external-link | `arrow.up.right.square` | — | `open_in_new` | — | |
| model | cpu | `cpu` | — | `memory` | — | |
| message | message-square-text | `text.bubble` | — | `chat` | — | |
| pointer | mouse-pointer-2 | `cursorarrow` | — | `arrow_selector_tool` | — | |
| zoom-in | zoom-in | `plus.magnifyingglass` | — | `zoom_in` | — | |
| zoom-out | zoom-out | `minus.magnifyingglass` | — | `zoom_out` | — | |
| layers | layers | `square.3.layers.3d` | — | `layers` | — | tool block glyph |
| archive | archive | `archivebox` | — | `archive` | — | |
| users | users | `person.2` | — | `group` | — | |
| calendar | calendar | `calendar` | — | `calendar_today` | — | |
| sort | arrow-up-down | `arrow.up.arrow.down` | — | `swap_vert` | — | |
| link | link | `link` | — | `link` | — | |
| camera | camera | `camera` | — | `photo_camera` | — | |
| list | list | `list.bullet` | — | `list` | — | |
| database | database | `cylinder.split.1x2` | — | `database` | — | |
| activity | activity | `waveform.path.ecg` | — | `show_chart` | — | |
| zap | zap | `bolt` | — | `bolt` | — | |
| pause | pause | `pause` | `pause.fill` | `pause` | yes | |
| tag | tag | `tag` | — | `sell` | — | |
| user | user | `person` | — | `person` | — | |
| device | smartphone | `iphone` | — | `smartphone` | — | |
| mode-light | sun | `sun.max` | — | `light_mode` | — | |
| mode-dark | moon | `moon` | — | `dark_mode` | — | |
| mode-system | monitor | `circle.lefthalf.filled` | — | `contrast` | — | appearance "System" |
| power | power | `power` | — | `power_settings_new` | — | |
| more-vertical | ellipsis-vertical | `ellipsis` | — | `more_vert` | — | iOS idiom is the horizontal ellipsis |
| minus | minus | `minus` | — | `remove` | — | |
| mention | at-sign | `at` | — | `alternate_email` | — | |
| pin | pin | `pin` | `pin.fill` | `keep` | yes | pinned state is filled |
| keyboard | keyboard | `keyboard` | — | `keyboard` | — | |
| loader | loader-circle | `progress.indicator` | — | `progress_activity` | — | inline spinner glyph; block spinners use the native indicator (§5.3) |
| think | brain | `brain` | — | `psychology` | — | |
| image | image | `photo` | — | `image` | — | |
| expand-all | chevrons-up-down | `chevron.up.chevron.down` | — | `unfold_more` | — | also the server-switcher glyph |
| collapse-all | chevrons-down-up | `arrow.down.and.line.horizontal.and.arrow.up` | — | `unfold_less` | — | |

Intentional duplicate native glyphs (the registry test whitelists exactly these pairs): `projects`/`folder-open`
(SF `folder`), `clock`/`status-waiting`, `hand`/`status-needs-you`, `loader`/`status-running`, `more`/`more-vertical`
(SF `ellipsis`), `plan` (`checklist` on both).

**Mobile-only concepts** (new export `MOBILE_ICON_CONCEPTS` in `icons.ts`, type `MobileIconConcept = IconConcept |
keyof typeof MOBILE_ICON_CONCEPTS`; not added to `ICON_CONCEPTS`, because web's `registry.ts` is typed
`satisfies Record<IconConcept, LucideIcon>` and would stop compiling). Add each entry only when the first screen
needs it; names are fixed here:

| Concept | lucide | sfSymbol | material | Used by |
|---|---|---|---|---|
| grip | grip-vertical | `line.3.horizontal` | `drag_indicator` | ReorderList handle (`MBuilderList`, `MGestures`) |
| share | share | `square.and.arrow.up` | `share` | Share transcript, share sheet |
| unread | mail | `envelope.badge` | `mark_email_unread` | swipe "Mark unread" |
| filter | list-filter | `line.3.horizontal.decrease` | `filter_list` | list filters |
| biometric | scan-face | `faceid` | `fingerprint` | App lock, risky approvals (iOS Touch ID devices use `touchid`, chosen at runtime in `ui/platform`) |
| qr | qr-code | `qrcode` | `qr_code` | pairing |
| qr-scan | scan-qr-code | `qrcode.viewfinder` | `qr_code_scanner` | pairing viewfinder |
| torch | flashlight | `flashlight.on.fill` | `flashlight_on` | pairing torch |
| waveform | audio-lines | `waveform` | `graphic_eq` | dictation |
| minimize | minimize-2 | `arrow.down.right.and.arrow.up.left` | `close_fullscreen` | full-screen pane "minimise" |
| comment | message-square-plus | `plus.bubble` | `add_comment` | diff line comment |
| offline | wifi-off | `wifi.slash` | `wifi_off` | OfflineState, connection footer |
| latest | arrow-down | `arrow.down` | `arrow_downward` | "↓ Latest" pill |
| hide | eye-off | `eye.slash` | `visibility_off` | privacy / redaction |
| font-size | a-large-small | `textformat.size` | `format_size` | terminal A− / A+ |

(Verify each lucide name against lucide-react-native 1.48's `icons/` folder when adding it, like the web registry test does.)

### 5.2 Lucide 1.x on mobile

- Upgrade `lucide-react-native` 0.460 → **1.48.0** (M3-07). Import only through the supported subpath
  `lucide-react-native/icons/<kebab-name>` (1.x `exports` map: `.`, `./icons`, `./icons/*`). Only `src/ui/primitives/Icon/**`
  may import it (lint `lucideDirectImport`).
- `src/ui/primitives/Icon/lucide.ts` holds a **static** map `concept → component` for `lucideOnly` concepts (and for the
  mobile-only concepts' lucide names used by the web preview), so Metro bundles only those files.
- **Babel plugin** `apps/mobile/plugins/babel-plugin-lucide-icons.js`: today it reads `dist/esm/lucide-react-native.js`
  and matches `.js`; on 1.x the barrel is `.mjs` and the plugin silently falls back to the whole barrel (1.29 MB;
  stack-styling §5). Rewrite it in M3-07 for the legacy call sites that still import from the barrel:
  1. Visit `ImportDeclaration` with source `'lucide-react-native'`.
  2. For each named specifier `{ Imported as Local }`: `kebab = Imported` with `Icon` suffix stripped, converted
     PascalCase → kebab-case with digits split as their own segment (`FileCode2` → `file-code-2`, `Loader2` →
     `loader-2`, `ArrowUpDown` → `arrow-up-down`).
  3. Replace with `import Local from 'lucide-react-native/icons/<kebab>'`.
  4. Resolve the target with `require.resolve` at transform time; if it does not exist, **throw** a build error naming
     the icon (no fallback to the barrel).
  5. Type-only imports (`LucideIcon`, `LucideProps`) are rewritten to `import type … from 'lucide-react-native'`.
  `scripts/check-bundle.mjs` gains an assertion that `lucide-react-native.mjs` (the barrel) is absent from the export.
  The plugin is **deleted** (and removed from `babel.config.js`) in the M10 cleanup when `rg "from 'lucide-react-native'"
  apps/mobile/src apps/mobile/app` returns nothing.

### 5.3 The `Icon` component

Files (MP-02, folder `apps/mobile/src/ui/primitives/Icon/`): `Icon.tsx` (shared props + Jest/web fallback), `Icon.ios.tsx`, `Icon.android.tsx`,
`material-filled/<name>.tsx` (generated), `lucide.ts`.

```ts
export type IconSize = 12 | 14 | 16 | 18 | 20 | 22 | 24;
export type IconTone = 'fg' | 'fg-2' | 'fg-3' | 'accent' | 'on-accent' | 'run' | 'ok' | 'warn' | 'err' | 'surface';

export interface IconProps {
  concept: MobileIconConcept;
  size?: IconSize;          // default 20 (iOS row) / 24 (Android row) = geometry().icon.row
  tone?: IconTone;          // default 'fg-2'
  filled?: boolean;         // selected/active state; uses sfSymbolFill / materialFill
  spinning?: boolean;       // status-running / loader: 1000 ms linear rotation; ignored under reduced motion
  accessibilityLabel?: string; // absent → decorative (accessible={false}, importantForAccessibility="no-hide-descendants")
  testID?: string;
}
```

Rules:
1. **iOS:** `SymbolView` (expo-symbols) with `name = filled && def.sfSymbolFill ? def.sfSymbolFill : def.sfSymbol`,
   `size`, `type="monochrome"`, `weight="regular"`, `tintColor = useThemeColors()[tone]`. In `__DEV__` the `fallback`
   prop renders a visible red square so a misspelt SF name is caught in Storybook; in release the fallback is the
   lucide glyph.
2. **Android:** `SymbolView` with `name={{ android: def.material }}` and the weight-400 font (§4.4); when
   `filled && def.materialFill`, render `material-filled/<material>.tsx` (react-native-svg, generated from
   `@material-symbols/svg-400/outlined/<name>-fill.svg` by `apps/mobile/scripts/gen-material-filled.mjs`, checked in,
   `fill` = tone literal) until expo#46850 is fixed. `mirrorInRtl` → `transform: [{ scaleX: -1 }]` when
   `I18nManager.isRTL`.
3. **Inside Expo UI Compose trees** (menus, FAB, toolbar items) icons are not RN views: use `@expo/material-symbols`
   XML drawables (`import Star from '@expo/material-symbols/<name>.xml'`; filled variants written with its CLI
   `npx add-material-symbols --fill <name>`). The native wrappers in `ui/native/*` take a `MobileIconConcept` and map it
   through the same registry.
4. **lucideOnly** concepts: lucide component from `lucide.ts`, `color` = tone literal, `strokeWidth` 1.75 (web `ICON`),
   same size. One family per platform is kept for everything else (Expo `expo-native-ui` guidance); lucide appears only
   for the domain glyphs listed.
5. **Motion:** `spinning` → Reanimated rotation `withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1)`
   on a wrapper view (expo-symbols' `animationSpec` has no rotate effect). `status-needs-you` on iOS: `animationSpec =
   { effect: { type: 'bounce' }, repeatCount: 1 }` when the row mounts for a new item. No `pulse` on waiting (MD-73
   note: repeating effects in lists are noise). Reduced motion (§6.3) → no rotation, no bounce.
6. **Block spinners** (loading a screen/section) are not icons: iOS `ActivityIndicator` (UIKit) and Android Expo UI
   `LoadingIndicator` (M3 Expressive), wrapped as `ui/native/Spinner`.
7. Sizes only from `IconSize`. Glyph colour only from `tone`. Direct `expo-symbols` / `lucide-react-native` imports
   outside `src/ui/primitives/Icon/**` and `src/ui/native/**` are lint errors.

### 5.4 Registry test

`packages/design-tokens/src/__tests__/icons.test.ts` (replaces the "empty mobile slots" case; web's own registry test is
untouched):
- For every entry of `ICON_CONCEPTS` and `MOBILE_ICON_CONCEPTS`: **either** `lucideOnly === true` and `sfSymbol`,
  `material`, `sfSymbolFill`, `materialFill` are absent, **or** `sfSymbol` and `material` are non-empty.
- `sfSymbol` / `sfSymbolFill` match `/^[a-z0-9]+(\.[a-z0-9]+)*$/`; `sfSymbolFill` ends with `.fill`.
- `material` matches `/^[a-z0-9_]+$/`; `materialFill` only where `material` is set.
- The `lucideOnly` set equals exactly: `agents, changes, branch, commit, pr, diff, hook, variable, webhook` (a change is a
  deliberate edit to this list).
- Native-glyph duplicates are only the whitelisted pairs (§5.1).
- `MOBILE_ICON_CONCEPTS` keys do not collide with `ICON_CONCEPTS` keys.

Mobile-side checks (`apps/mobile`, Vitest, M3-07):
- every `material` name has `@material-symbols/svg-400/outlined/<name>.svg`; every `materialFill` name has
  `<name>-fill.svg` and a generated `material-filled/<name>.tsx`;
- Storybook story `ui/primitives/Icon/Icon.stories.tsx` "All concepts" renders every concept at 20 in 4 tones, both OSes, dark and
  light — the visual check for SF names (no SF name list exists to test against).

---

## 6. Motion

### 6.1 Sources

- **iOS:** "System springs for push, sheets and menus; the sidebar and pane slide on the same spring as a push. Our
  content uses `.smooth`; press scale on buttons only." (`MFoundations` Motion). SwiftUI `.smooth` = spring(duration
  0.5, bounce 0); `.snappy` = spring(duration 0.5, bounce 0.15). Conversion used here: `stiffness = (2π / duration)²`,
  `dampingRatio = 1 − bounce`, `damping = 2 × dampingRatio × √stiffness`, `mass = 1`.
- **Android:** M3 Expressive **standard** motion scheme (`MFoundations` Motion "Android · Standard scheme"): default
  spatial 0.9 / 700, fast spatial 0.9 / 1400, slow spatial 0.9 / 300, default effects 1.0 / 1600 (damping ratio /
  stiffness); the scheme's fast and slow effects are 1.0 / 3800 and 1.0 / 800. Reanimated takes physics springs, so
  `damping = 2 × ζ × √stiffness` with `mass = 1`.
- No spring in the app overshoots (MD-76): every iOS ζ ≥ 0.85, every Android value is the standard scheme. The current
  `SPRING_PRESS` (ζ ≈ 0.63), `SPRING_ENTER` and `SPRING_SWIPE` in `apps/mobile/src/components/ui/motion.ts` are deleted.

Computed physics values (mass 1):

| Name | Source | stiffness | damping | ζ |
|---|---|---|---|---|
| `ios.smooth500` | `.smooth` (0.5 s) | 157.91 | 25.13 | 1.0 |
| `ios.smooth350` | `.smooth(duration: 0.35)` | 322.27 | 35.90 | 1.0 |
| `ios.smooth300` | `.smooth(duration: 0.3)` | 438.65 | 41.89 | 1.0 |
| `ios.snappy350` | `.snappy(duration: 0.35)` | 322.27 | 30.52 | 0.85 |
| `m3.spatialDefault` | 0.9 / 700 | 700 | 47.62 | 0.9 |
| `m3.spatialFast` | 0.9 / 1400 | 1400 | 67.35 | 0.9 |
| `m3.spatialSlow` | 0.9 / 300 | 300 | 31.18 | 0.9 |
| `m3.effectsDefault` | 1.0 / 1600 | 1600 | 80.00 | 1.0 |
| `m3.effectsFast` | 1.0 / 3800 | 3800 | 123.29 | 1.0 |
| `m3.effectsSlow` | 1.0 / 800 | 800 | 56.57 | 1.0 |

### 6.2 Named motion concepts

| Concept | What moves | iOS (Reanimated) | Android (Reanimated; M3 token) | Reduced motion |
|---|---|---|---|---|
| `press` | Button / IconButton / NewAction scale while pressed | spring `ios.smooth300` to scale 0.97 (large surfaces ≥ 120 pt tall: 0.985); buttons only (MFoundations) | **no scale**: native ripple (`android_ripple` `{ color: selected, foreground: true }`) + state layer; any opacity change uses `m3.effectsFast` | no scale; iOS highlight = instant opacity 0.7; Android ripple stays (not motion) |
| `toggle` | JS selection indicators: segmented thumb, chip on/off, checkbox fill, pane-tab pill / underline, drawer selection | spring `ios.snappy350` for position; colour via timing `MOTION.fast` 120 ms, `ease-standard` | position `m3.spatialFast`; colour `m3.effectsFast` | instant (0 ms) |
| `panel` | SidePanel drawer and pane open / close / settle after drag; full-screen pane toggle; scrim opacity follows position | spring `ios.smooth500` (push-matched), release velocity passed in | spring `m3.spatialDefault`, release velocity passed in | cross-fade: panel placed at its final position, opacity 0 → 1 (and scrim) with timing 180 ms `ease-standard`; close = reverse |
| `sheet` | route sheets (`formSheet`) and TrueSheet | **native** (system springs); no JS values | **native** | native (the OS honours Reduce Motion / animator scale) |
| `reveal` | expand / collapse in place (tool block, collapsibles, "↓ Latest" pill, toast in/out, banners, inline gate reveal) | size / position `ios.smooth350`; opacity timing 180 ms | size / position `m3.spatialDefault`; opacity `m3.effectsDefault` | opacity only, timing 120 ms; size jumps |
| `listInsert` | **user-initiated** list changes only (archive, pin, delete, reorder drop, add stage): layout transition + entering opacity | layout `LinearTransition` spring `ios.smooth350`; entering `FadeIn` 180 ms; stagger 25 ms, cap 8 rows | layout spring `m3.spatialDefault`; entering opacity `m3.effectsDefault` | no layout animation; entering instant |
| `swipe` | SwipeRow settle back / commit; ReorderList item following the finger and settling | `ios.smooth300` | `m3.spatialFast` | settle instant |
| `spinner` | running glyph, inline loader | linear rotation, 1000 ms per turn, infinite | same (block spinners: native LoadingIndicator) | static glyph |

- **Never animate** streaming transcript growth, list updates caused by server events, or theme switches (instant).
  `listInsert` is for user actions only.
- **Push / pop / modal / menus / context menus / alerts** are native transitions; no JS motion (MD-21).
- Drawer drag: follows the finger 1:1; on release it opens when position ≥ 40 % (`drawerSnapFraction`) or release
  velocity ≥ 500 pt/s toward open (derived), else closes — both with `panel`.
- Colour transitions (hover on iPad pointer, pressed backgrounds) use Reanimated 4 CSS transitions with
  `MOTION.fast` 120 ms and `cubic-bezier(0.2, 0, 0, 1)` (`MOTION_CSS.ease.standard`), built only in `ui/lib/motion.ts`.

### 6.3 Reduced motion

- Inputs: the OS switch (`AccessibilityInfo.isReduceMotionEnabled` + `reduceMotionChanged`) and the app preference
  `generatorai.motion` (`'system' | 'reduced' | 'full'`, existing `PREF_KEYS.motion`). Effective value: `reduced` →
  true, `full` → false, `system` → OS switch (the existing `useReduceMotion()` logic, moved to `ui/platform/motion.ts`).
- Every config also carries Reanimated `reduceMotion` = `ReduceMotion.Always | Never | System` from the preference,
  so worklet-driven animations inside gesture handlers collapse too.
- Under reduced motion: springs become the cross-fades in §6.2; running glyphs stop turning; the dictation waveform
  freezes; SF effects are off; the Home count-tile and skeletons never animate (skeletons never shimmer anyway,
  boards-core §B.16).

### 6.4 The `MOTION_CONCEPTS` export (new `packages/design-tokens/src/motion.ts`)

`MOTION` in `tokens.ts` (0 / 120 / 180 / 220 ms) is not changed — web's `MOTION_CSS` reads it. The spring vocabulary
is a new, additive export:

```ts
export type MotionConcept = 'press' | 'toggle' | 'panel' | 'sheet' | 'reveal' | 'listInsert' | 'swipe' | 'spinner';

export interface SpringSpec { kind: 'spring'; stiffness: number; damping: number; mass: 1 }
export interface TimingSpec { kind: 'timing'; duration: number; easing: 'standard' | 'linear' }
export interface NativeSpec { kind: 'native' }
export interface NoneSpec { kind: 'none' }
export interface FadeSpec { kind: 'fade'; duration: number }
export type MotionSpec = SpringSpec | TimingSpec | NativeSpec | NoneSpec;
export type ReducedSpec = FadeSpec | TimingSpec | NoneSpec | NativeSpec;

export interface PlatformMotion {
  /** Position / size / transform. */
  spatial: MotionSpec;
  /** Opacity / colour. */
  effects: MotionSpec;
}

export interface MotionConceptSpec {
  ios: PlatformMotion;
  android: PlatformMotion;
  reduced: ReducedSpec;
  /** press only */
  pressScale?: { default: 0.97; large: 0.985 };
}

export const SPRINGS = {
  ios: {
    smooth500: { kind: 'spring', stiffness: 157.91, damping: 25.13, mass: 1 },
    smooth350: { kind: 'spring', stiffness: 322.27, damping: 35.9, mass: 1 },
    smooth300: { kind: 'spring', stiffness: 438.65, damping: 41.89, mass: 1 },
    snappy350: { kind: 'spring', stiffness: 322.27, damping: 30.52, mass: 1 },
  },
  m3: {
    spatialDefault: { kind: 'spring', stiffness: 700, damping: 47.62, mass: 1 },
    spatialFast: { kind: 'spring', stiffness: 1400, damping: 67.35, mass: 1 },
    spatialSlow: { kind: 'spring', stiffness: 300, damping: 31.18, mass: 1 },
    effectsDefault: { kind: 'spring', stiffness: 1600, damping: 80, mass: 1 },
    effectsFast: { kind: 'spring', stiffness: 3800, damping: 123.29, mass: 1 },
    effectsSlow: { kind: 'spring', stiffness: 800, damping: 56.57, mass: 1 },
  },
} as const satisfies Record<'ios' | 'm3', Record<string, SpringSpec>>;

const T = (duration: number, easing: TimingSpec['easing'] = 'standard'): TimingSpec => ({ kind: 'timing', duration, easing });

export const MOTION_CONCEPTS: Record<MotionConcept, MotionConceptSpec> = {
  press:      { ios: { spatial: SPRINGS.ios.smooth300, effects: { kind: 'none' } },
                android: { spatial: { kind: 'none' }, effects: SPRINGS.m3.effectsFast },
                reduced: { kind: 'none' }, pressScale: { default: 0.97, large: 0.985 } },
  toggle:     { ios: { spatial: SPRINGS.ios.snappy350, effects: T(120) },
                android: { spatial: SPRINGS.m3.spatialFast, effects: SPRINGS.m3.effectsFast },
                reduced: T(0) },
  panel:      { ios: { spatial: SPRINGS.ios.smooth500, effects: T(180) },
                android: { spatial: SPRINGS.m3.spatialDefault, effects: SPRINGS.m3.effectsDefault },
                reduced: { kind: 'fade', duration: 180 } },
  sheet:      { ios: { spatial: { kind: 'native' }, effects: { kind: 'native' } },
                android: { spatial: { kind: 'native' }, effects: { kind: 'native' } },
                reduced: { kind: 'native' } },
  reveal:     { ios: { spatial: SPRINGS.ios.smooth350, effects: T(180) },
                android: { spatial: SPRINGS.m3.spatialDefault, effects: SPRINGS.m3.effectsDefault },
                reduced: { kind: 'fade', duration: 120 } },
  listInsert: { ios: { spatial: SPRINGS.ios.smooth350, effects: T(180) },
                android: { spatial: SPRINGS.m3.spatialDefault, effects: SPRINGS.m3.effectsDefault },
                reduced: { kind: 'none' } },
  swipe:      { ios: { spatial: SPRINGS.ios.smooth300, effects: { kind: 'none' } },
                android: { spatial: SPRINGS.m3.spatialFast, effects: { kind: 'none' } },
                reduced: T(0) },
  spinner:    { ios: { spatial: T(1000, 'linear'), effects: { kind: 'none' } },
                android: { spatial: T(1000, 'linear'), effects: { kind: 'none' } },
                reduced: { kind: 'none' } },
};
```

Mobile reads it through `apps/mobile/src/ui/platform/motion.ts`:
`useMotion(concept): { spatial: WithSpringConfig | WithTimingConfig | null; effects: …; reduced: boolean }` — resolves
the platform, applies reduced motion, and converts to Reanimated configs (with `reduceMotion` set). Only `src/ui/**`
calls it; features never configure animation. Test (`motion.test.ts`): every spring has ζ = damping / (2√stiffness)
∈ [0.85, 1.0]; values equal the formulas in §6.1 to 2 decimals.

---

## 7. Haptics

### 7.1 Concept map (new `packages/design-tokens/src/haptics.ts`)

Source: `MFoundations` Haptics table, `MGestures` per-gesture haptics, boards-core §A.6, MD-38. Android constants are
`expo-haptics` `AndroidHaptics` **member names**, called with `performAndroidHapticsAsync`; the chain is tried in order
and the first entry whose `minApi ≤ Platform.Version` is used (app `minSdkVersion` is the SDK default, 24).

| Concept | Fires when | iOS (`expo-haptics`) | Android chain (member, min API) |
|---|---|---|---|
| `selection` | segment, picker value, pane tab change, chip toggle | `selectionAsync()` | `Segment_Tick` (34) → `Clock_Tick` (21) |
| `threshold` | swipe action armed at full-swipe threshold; pin / unpin | `impactAsync(ImpactFeedbackStyle.Light)` | `Toggle_On` (34) → `Virtual_Key` (5) |
| `longPress` | long-press menu opens | `impactAsync(ImpactFeedbackStyle.Medium)` | `Long_Press` (3) |
| `dragStart` | reorder lift | `impactAsync(ImpactFeedbackStyle.Light)` | `Gesture_Start` (30) → `Long_Press` (3) |
| `dragTick` | reordered item passes a slot | `selectionAsync()` | `Segment_Frequent_Tick` (34) → `Clock_Tick` (21) |
| `success` | **server-confirmed** success of a user action (approve, allow, commit, send accepted, pairing done) | `notificationAsync(NotificationFeedbackType.Success)` | `Confirm` (30) → `Virtual_Key` (5) |
| `warning` | server-confirmed deny / reject / request-changes | `notificationAsync(NotificationFeedbackType.Warning)` | `Reject` (30) → `Long_Press` (3) |
| `error` | a run the user is watching fails; a user action fails | `notificationAsync(NotificationFeedbackType.Error)` | `Reject` (30) → `Long_Press` (3) |
| `fontStep` | terminal pinch passes a font step (10–20) | `selectionAsync()` (MD-73: the board leaves iOS blank; MD-38 requires a tick) | `Segment_Tick` (34) → `Clock_Tick` (21) |

- Android `warning` and `error` share `Reject` (M3 has no error constant; the board accepts this —
  `MFoundations` "Denied, rejected" and "Run failed" both `REJECT`).
- **No haptic** on: plain taps, navigation push/pop, drawer or pane open/close ("spring settle only", `MGestures`),
  sheet drag (system), pull-to-refresh, toasts, Send tap (success comes on server acceptance), native Switch (the
  platform plays its own).

```ts
export const HAPTIC_CONCEPTS = ['selection', 'threshold', 'longPress', 'dragStart', 'dragTick', 'success', 'warning', 'error', 'fontStep'] as const;
export type HapticConcept = (typeof HAPTIC_CONCEPTS)[number];

export type IosHaptic =
  | { kind: 'selection' }
  | { kind: 'impact'; style: 'light' | 'medium' | 'heavy' | 'soft' | 'rigid' }
  | { kind: 'notification'; type: 'success' | 'warning' | 'error' };

export type AndroidHapticMember =
  | 'Segment_Tick' | 'Segment_Frequent_Tick' | 'Toggle_On' | 'Toggle_Off' | 'Long_Press' | 'Gesture_Start'
  | 'Gesture_End' | 'Drag_Start' | 'Confirm' | 'Reject' | 'Clock_Tick' | 'Virtual_Key' | 'Context_Click';

export interface HapticSpec {
  ios: IosHaptic;
  android: ReadonlyArray<{ member: AndroidHapticMember; minApi: number }>; // tried in order
}

export const HAPTICS: Record<HapticConcept, HapticSpec>; // values = table above
```

`design-tokens` must not import `expo-haptics`; it stores names. Test: every chain ends in an entry with `minApi ≤ 24`;
every concept has both platforms.

### 7.2 The `haptic(concept)` helper

File `apps/mobile/src/ui/platform/haptics.ts` (the only importer of `expo-haptics`; lint `hapticsImport`):

```ts
export function haptic(concept: HapticConcept): void;          // fire-and-forget; never throws; never awaits in render
export function setHapticsEnabled(enabled: boolean): void;     // pushed by PreferencesProvider
```

1. No-op when: platform is web, the user setting is off, or the concept has no entry.
2. iOS: call the mapped `expo-haptics` function; `.catch(() => {})`.
3. Android: pick the first chain entry with `minApi ≤ Platform.Version`; call
   `performAndroidHapticsAsync(AndroidHaptics[member])`; `.catch(() => {})`. `performHapticFeedback` needs no
   `VIBRATE` permission and respects the system haptics setting (stack-native-platform §6).
4. Throttle: the same concept is not fired again within 40 ms (derived; stops `dragTick` / `selection` buzzing).
5. **User setting:** Settings › Haptics, stored in MMKV `generatorai.haptics` (`PREF_KEYS.haptics`, boolean, default
   `true`); off silences every concept (`MFoundations`, `MGestures` "Settings › Haptics turns every one off").

**Success only on server confirm** (principle 5, `MFoundations` "Success fires when the server confirms, not on tap"):
`success` / `warning` fire in the mutation's `onSuccess` (HTTP 2xx) **or** on the stream event that confirms the
state change (gate resolved, run approved), whichever arrives first, once per action (the call site passes the action
id; `haptic` is called from the query hook, not the button). Never optimistically. `error` fires on mutation error or
the failure event.

**Migration of the current helper** (`apps/mobile/src/components/ui/haptics.ts`, 145 call sites): `select` →
`selection`; `threshold` → `threshold`; `success` → `success` (move each call to the server-confirmation point);
`warn` → `warning`; `error` → `error`; `tap` and `commit` → **deleted** (no haptic on plain taps; commit becomes
`success` on confirmation). The old file is deleted when its last importer is ported.

---

## 8. Surfaces and glass

### 8.1 Where glass is allowed (iOS only)

| Allowed (iOS floating chrome) | Implementation |
|---|---|
| Header buttons and the trailing capsule | native `Stack.Toolbar` items / native header buttons — **system glass**, no `GlassView` |
| Composer surface | `GlassSurface` |
| NewAction capsule | `GlassSurface` (`isInteractive`) |
| "↓ Latest" pill | `GlassSurface` (`isInteractive`) |
| Toasts | `GlassSurface` |
| Floating step-nav toolbar (`MChatStepDetail`), workflow-map zoom column (`MRunGraph`, `MGestures` "glass 44 column") | `GlassSurface` in a `GlassContainer` |
| Context menus, UIMenu, sheets, alerts, pickers, segmented controls, switches, notifications, Live Activities | **system material** (native) — nothing to build |

**Never glass:** cards, rows, list groups, transcript, bubbles, tool blocks, gate cards, diffs, code, terminal, sidebar
and pane **content**, sheet content, anything on Android (`MFoundations` Glass "Never"; MPrinciples principle 9).

### 8.2 `GlassSurface` (iOS) — `expo-glass-effect`

Files: `apps/mobile/src/ui/native/GlassSurface/` (MP-38): `GlassSurface.ios.tsx`, `GlassSurface.tsx` (fallback: Android, Jest, web), `GlassSurface.types.ts`.
Only these files import `expo-glass-effect` (lint `glassImport`).

```ts
export interface GlassSurfaceProps extends ViewProps {
  interactive?: boolean;   // → GlassView isInteractive (buttons, NewAction, ScrollToLatest pill)
  radiusStep: 'composer' | 'new' | 'toast' | 'full';   // radius from tokens
  group?: string;          // GlassContainer id: neighbours with the same id merge (MP-38)
  className?: string;      // layout + padding only
}
```

- `GlassView` with `glassEffectStyle="regular"`, `isInteractive={interactive}`, `colorScheme={appearance}` (the app's
  resolved appearance, so glass matches the app when the app mode differs from the OS), **no `tintColor`** (neutral
  chrome; the ink Send button inside the composer is a solid `bg-accent` view, not tinted glass).
- Adjacent glass pieces (header capsule items, composer control cluster, zoom column) are wrapped in
  `GlassContainer spacing={8}` so they share one sampling region and merge (stack-styling §3 cost note).
- **Never animate `opacity`** on a `GlassView` or any ancestor (kills the effect); animate `transform`, or switch
  `glassEffectStyle` to `'none'` to hide.
- **Availability** (`ui/platform/glass.ts`, `useGlass(): boolean`): `Platform.OS === 'ios' && isLiquidGlassAvailable()
  && isGlassEffectAPIAvailable() && !reduceTransparency`. `reduceTransparency` = `AccessibilityInfo.isReduceTransparencyEnabled()`
  + `'reduceTransparencyChanged'` listener (iOS reports it; Android always false).
- **Fallback** (Reduce Transparency on, `!isLiquidGlassAvailable()`, Android, web, Jest): an opaque `View` with
  `bg-overlay border border-line shadow-float` and the same radius (`MFoundations` "Fallback · Reduce Transparency or the
  iOS 27 tint slider → opaque --overlay + --line").
- **iOS 27 transparency slider** ("ultra clear" … "fully tinted"): honoured by the system material itself; there is no
  API to read it and no code path. The M3/M5 checks run with the slider at both ends, Reduce Transparency on, and
  Increase Contrast on.
- The board's CSS recipe (`color-mix(--overlay 68%)`, `blur(22px) saturate(1.6)`, 1 px `color-mix(--fg 12%)`,
  shadow `0 8 28 .28`) is an illustration of Liquid Glass; never re-create it with blur views.

**Glass tokens** (new `packages/design-tokens/src/glass.ts`, data only):

```ts
export const GLASS = {
  ios: { style: 'regular', containerSpacing: 8, tint: null, interactiveFor: ['NewAction', 'ScrollToLatest', 'IconButton'] },
  fallback: { surface: 'overlay', border: 'line', shadow: 'float' },
  allowed: ['header', 'composer', 'newAction', 'latestPill', 'toast', 'stepNavToolbar', 'zoomColumn'],
} as const;
```

### 8.3 Android tonal layers → tokens

Android draws no glass and no blur. Hierarchy comes from tonal surfaces, mapped onto our tokens (never M3 role colours
from the wallpaper, except the System accent):

| M3 role | Token / class | Where |
|---|---|---|
| surface / background | `bg-surface` | screen body |
| surfaceContainerLowest | `bg-sunken` | fields, code, terminal |
| surfaceContainer | `bg-raised` | scrolled top app bar, permanent tablet drawer, composer, cards, gate cards |
| surfaceContainerHigh | `bg-overlay` | modal drawer, pane, sheets, menus (JS), dialogs (JS fallback) |
| secondaryContainer | `bg-selected` | selected drawer pill, selected chip, tonal button, selected segment, pressed row |
| primary / onPrimary | `bg-accent` / `text-on-accent` | the one filled action, extended FAB |
| inverseSurface / inverseOnSurface | `bg-fg` / `text-surface` | snackbar |
| outline | `border-line-strong` | outlined buttons, fields, chips, unselected segments |
| outlineVariant | `border-line` / `border-line-soft` | dividers, card borders |
| onSurface / onSurfaceVariant | `text-fg` / `text-fg-2` | text |
| scrim | `bg-scrim` | drawer, pane |

The Android top app bar is `bg-surface` at rest and turns `bg-raised` when content scrolls under it (§B.1).

### 8.4 Elevation and shadows

| Token | Value | Used on | Platforms |
|---|---|---|---|
| `shadow-pop` | theme value (§2.1 #32) | JS floating layers: slash popover, context-menu preview (JS), phone drawer and pane (MD-72) | iOS and Android |
| `shadow-float` *(mobile)* | `0 8px 28px #00000047` (all themes) | glass fallback surfaces, Android extended FAB (board `0 6 16 .3` → float), Android snackbar | iOS and Android |
| none | — | cards, rows, groups, sheets (native), buttons | — |

Shadows render through RN's `boxShadow` style (New Architecture, RN ≥ 0.76, both platforms), which accepts the CSS
string including spread and multiple layers; never `elevation` and never `shadowColor/shadowOffset` props. Gate B
confirms Uniwind emits `boxShadow` from `shadow-*` classes (§9.9).

---

## 9. Theming pipeline (implementation spec)

### 9.1 Overview

```text
packages/design-tokens/src
  themes/*.ts ─► resolveDesignTokens / resolveAppearanceTokens / resolveTerminalPalette / resolveSyntaxTokens
  geometry.ts (GEOMETRY.ios|android) · vocabulary.ts · vocabulary-mobile.ts · accent.ts · motion.ts · haptics.ts · glass.ts
        │
        ├─ emit/vocabulary.ts ──► css/vocabulary.css            (shared, unchanged; web + mobile import it)
        ├─ emit/vocabulary.ts ──► css/vocabulary-mobile.css      (NEW; mobile only)
        │                    └──► generated/vocabulary-mobile.json (NEW; mobile lint)
        └─ emit/uniwind.ts (NEW)
              ├─► apps/mobile/src/theme/uniwind-themes.css   36 theme variants + light/dark + ios/android geometry
              ├─► apps/mobile/src/theme/uniwind-themes.json  UNIWIND_THEMES (for metro.config.js)
              ├─► apps/mobile/src/theme/palettes/<themeId>.ts × 18 + palettes/index.ts  (literals, one theme at a time)
              └─► apps/mobile/src/theme/splash-colors.json    (build-time splash / root colours)
apps/mobile/src/theme/global.css  = tailwindcss + uniwind + vocabulary.css + vocabulary-mobile.css + uniwind-themes.css + legacy.css
apps/mobile/src/theme/ThemeProvider.tsx + prepaint.ts  = Uniwind.setTheme / updateCSSVariables / ScopedTheme
```

All emitters are pure functions of the registry, run by `packages/design-tokens/bin/generate.ts`, and verified by
`pnpm check:tokens`.

### 9.2 `emit/uniwind.ts` (new, additive) and `uniwind-themes.css`

Exports (re-exported from `src/emit/index.ts`):

```ts
/** `${theme.id}-${appearance}` for every theme in THEMES order, dark then light (36 names). */
export const UNIWIND_THEMES: readonly string[];
export function uniwindThemeName(themeId: string, appearance: Appearance): string;
/** Every --gai-* colour + shared vars for one theme × appearance at its DEFAULT accent (40 vars). */
export function uniwindColorVars(theme: ThemeDef, appearance: Appearance): Record<string, string>;
/** Every geometry var for one platform. */
export function uniwindGeometryVars(platform: 'ios' | 'android'): Record<string, string>;
export function emitUniwindThemes(): string;      // the CSS file
export function emitUniwindThemeList(): string;   // JSON array of UNIWIND_THEMES
export function emitNativePalette(themeId: string): string; // one palettes/<id>.ts
export function emitNativePaletteIndex(): string;
export function emitSplashColors(): string;
```

**Colour block variables** (identical key set in every block — Uniwind requires every theme to declare the same
variables): the 32 `DESIGN_COLOR_VARS` + `--chart-1`…`--chart-6` + `--canvas-bg` + `--canvas-dot` = **40**, plus
`--gai-shadow-float` = **41**. Values from `resolveTokenSet(theme.id, appearance, theme.defaultAccent)` (colours as
`#rrggbb` / `#rrggbbaa`, RN accepts both).

**Geometry variables** (identical key set in both platform blocks):
- `--gai-text-<step>`, `--gai-leading-<step>` (px, absolute), `--gai-weight-<step>`, `--gai-tracking-<step>` (px) for
  the 7 shared + 5 mobile steps;
- `--gai-radius-<step>` for the 7 shared + 9 mobile steps;
- `--gai-h-<name>` for the 18 shared + 12 mobile heights;
- `--gai-z-<name>` (10); `--gai-w-<name>` for the 11 shared + 2 mobile containers;
- `--gai-space-gutter`, `--gai-space-gutter-title`;
- `--gai-font-sans`, `--gai-font-mono`;
- `--gai-duration-fast|normal|slow` (120 / 180 / 220 ms; mobile reduced motion is handled in JS, not by these vars).

**File shape** (generated; `…` elides repeated lines):

```css
/* GENERATED from packages/design-tokens (emit/uniwind.ts) — do not edit. Regenerate with `pnpm tokens:write`. */
@layer theme {
  :root {
    /* Uniwind's built-in adaptive themes = Instrument (MD-77 note): present so the first frame before setTheme is themed. */
    @variant dark {
      --gai-ground: #0b0b0c;
      …41 variables…
    }
    @variant light {
      --gai-ground: #f1f1ef;
      …
    }
    @variant instrument-dark { …41 variables… }
    @variant instrument-light { … }
    @variant github-dark { … }
    …36 theme blocks in UNIWIND_THEMES order…

    /* Geometry. The un-varianted values are iOS (also used by the react-native-web preview). */
    --gai-text-display: 32px;
    --gai-leading-display: 37px;
    …every geometry variable, iOS values…
    @variant ios {
      …every geometry variable, iOS values (explicit)…
    }
    @variant android {
      --gai-text-display: 28px;
      --gai-leading-display: 34px;
      …every geometry variable, Android values…
    }
  }
}
```

Tests (`src/emit/__tests__/uniwind.test.ts`, new):
1. `UNIWIND_THEMES.length === 36`, unique, equals `THEMES × ['dark','light']`.
2. Every colour block has exactly the same 41 keys; `light`/`dark` blocks equal `instrument-light`/`instrument-dark`.
3. `ios` and `android` blocks have the same keys, and those keys ⊇ every `var(--gai-…)` referenced by
   `css/vocabulary.css` and `css/vocabulary-mobile.css` (no undefined variable on mobile).
4. Values in blocks equal `resolveDesignTokens` / `GEOMETRY.ios|android` (parity).
5. No `rem`, `em`, `%`, `calc(` or `color-mix(` in the output (literals only, 02-web §1 rule 4).
6. Deterministic: two runs produce byte-identical output.

### 9.3 Generated literal modules and splash colours

**`apps/mobile/src/theme/palettes/<themeId>.ts`** (18 files) — the only place literal colours live in the app:

```ts
// GENERATED — do not edit.
import type { NativeThemePalette } from '@generatorai/design-tokens';
const palette: NativeThemePalette = {
  id: 'instrument',
  dark:  { tokens: { ground: '#0b0b0c', /* …32 DesignTokens keys… */ }, chart: [/*6*/], canvasBg: '…', canvasDot: '…', terminal: { /* xterm ITheme */ }, syntax: { /* SyntaxTokens */ } },
  light: { /* same shape */ },
  accents: {
    dark:  { ink: { accent: '#ededef', onAccent: '#111113', focus: '#ededef' }, blue: { … }, /* 7 */ },
    light: { /* 7 */ },
  },
};
export default palette;
```

`NativeThemePalette` is a new exported type in `design-tokens` (`src/accent.ts` or `src/emit/uniwind.ts` types).
**`palettes/index.ts`**: `export function loadPalette(id: string): NativeThemePalette` using a `switch` of
`require('./<id>').default` calls, so only the active theme's module is evaluated (Metro inline requires). Size target:
< 60 KB for all 18 files together (accent deltas only, not full bags per accent). Test (design-tokens): for every
theme × appearance × accent, `toAccentVars(palette.accents[a][x])` equals `accentVars(theme, a, x)`.

**`apps/mobile/src/theme/splash-colors.json`**: `{ "light": { "background": "#ffffff" }, "dark": { "background": "#111113" } }`
(Instrument `surface`), read by `app.config.ts` for `expo-splash-screen` `backgroundColor` / `dark.backgroundColor` and
the root `backgroundColor` (the file replaces any hard-coded colour there).

### 9.4 `global.css`, vocabulary and legacy alias layer

**`apps/mobile/src/theme/global.css`** (replaces the NativeWind file):

```css
@import 'tailwindcss';
@import 'uniwind';
@import '@generatorai/design-tokens/css/vocabulary.css';
@import '@generatorai/design-tokens/css/vocabulary-mobile.css';
@import './uniwind-themes.css';
@import './legacy.css'; /* M3-05 → deleted in M10 */

@source '../../app';
@source '../';
```

- Order matters: Tailwind first, Uniwind second, then vocabularies, then values. **Never** add a namespace reset
  (`--color-*: initial`, `--text-*: initial` …) after `@import 'uniwind'` — Uniwind issue #623 silently drops theme
  utilities. The Tailwind default palette therefore still compiles; the lint bans it (§9.8).
- If Tailwind cannot resolve the package specifier in the Metro build, use the relative path
  `../../../../packages/design-tokens/css/vocabulary.css` (same for the mobile file); record which one works at Gate B.
- `packages/design-tokens/package.json` `exports` gains `"./css/vocabulary-mobile.css"` and
  `"./vocabulary-mobile.json"` (additive; also in `publishConfig.exports`).

**`css/vocabulary-mobile.css`** (generated by `emitMobileVocabularyCss()` in `emit/vocabulary.ts`):

```css
/* GENERATED from packages/design-tokens (src/vocabulary-mobile.ts) — do not edit. */
@theme inline {
  --text-detail-title: var(--gai-text-detail-title);
  --text-detail-title--line-height: var(--gai-leading-detail-title);
  --text-detail-title--font-weight: var(--gai-weight-detail-title);
  --text-detail-title--letter-spacing: var(--gai-tracking-detail-title);
  /* …transcript, mono-lg, mono, mono-sm (all four sub-vars each)… */
  --radius-seg-item: var(--gai-radius-seg-item);
  /* …card-lg, group, nav, field, code, composer, new, toast… */
  --height-chip: var(--gai-h-chip);
  /* …seg, field, search, search-sm, row-2, bar-lg, hit, icon-button, icon-button-sm, new, toast… */
  --size-hit: var(--gai-h-hit);
  --size-icon-button: var(--gai-h-icon-button);
  --size-icon-button-sm: var(--gai-h-icon-button-sm);
  --min-width-hit: var(--gai-h-hit);
  --container-drawer: var(--gai-w-drawer);
  --container-pane: var(--gai-w-pane);
  --spacing-gutter: var(--gai-space-gutter);
  --spacing-gutter-title: var(--gai-space-gutter-title);
  --shadow-float: var(--gai-shadow-float);
  --font-sans: var(--gai-font-sans);
  --font-mono: var(--gai-font-mono);
}
@theme {
  --breakpoint-medium: 600px;
  --breakpoint-expanded: 840px;
}
```

(The exact Tailwind 4 theme key for `min-w-hit` is verified at Gate B; if `--min-width-*` is not a Tailwind namespace,
drop `min-w-hit` and use `size-hit` wrappers.)

**`apps/mobile/src/theme/legacy.css`** (hand-written, temporary; M3-05 adds it, M10 deletes it with the last legacy
screen). It keeps legacy screens rendering after NativeWind is removed:
- Colours (`@theme inline`): `background → --gai-surface`, `foreground → --gai-fg`, `card → --gai-raised`,
  `card-foreground → --gai-fg`, `popover → --gai-overlay`, `popover-foreground → --gai-fg`, `subtle → --gai-sunken`,
  `emphasis → --gai-selected`, `primary → --gai-accent`, `primary-emphasis → --gai-accent`,
  `primary-foreground → --gai-on-accent`, `secondary → --gai-raised`, `secondary-foreground → --gai-fg`,
  `muted → --gai-sunken`, `muted-foreground → --gai-fg-2`, `destructive → --gai-err`,
  `destructive-foreground → --gai-on-accent`, `border → --gai-line`, `border-muted → --gai-line-soft`,
  `input → --gai-line-strong`, `ring → --gai-focus`, `success → --gai-ok`, `success-muted → --gai-ok-bg`,
  `warning → --gai-warn`, `warning-muted → --gai-warn-bg`, `info → --gai-run`, `info-muted → --gai-run-bg`,
  `danger → --gai-err`, `danger-muted → --gai-err-bg`, `done → --gai-ok`, `sidebar → --gai-raised`,
  `sidebar-foreground → --gai-fg`, `sidebar-border → --gai-line-soft`, `sidebar-accent → --gai-selected`,
  `sidebar-accent-foreground → --gai-fg`, `control → --gai-selected`, `control-strong → --gai-selected`,
  `control-foreground → --gai-fg`, `chart-*`/`file-icon-*` as today.
- **Collision (MD-75):** legacy mobile `bg-accent` / `text-accent` / `border-accent` meant the *accent tint*; in the new
  vocabulary they mean the ink accent. Before switching engines, M3-05 renames the 16 legacy occurrences
  (`rg -o "\b(bg|text|border)-accent\b" apps/mobile/src apps/mobile/app`) to `bg-selected` / `text-fg` /
  `border-line`. Legacy `bg-surface`/`bg-raised`/`bg-overlay` (22 occurrences) keep working (same meaning).
- Type and radius scales the legacy screens use (values from today's `tokens.generated.ts`): `--text-xs: 11px`,
  `--text-sm: 12px`, `--text-base: 14px`, `--text-md: 15px`, `--text-lg: 17px`, `--text-xl: 20px`, `--text-2xl: 24px`,
  `--text-3xl: 30px`; `--radius-lg: 8px`, `--radius-xl: 10px`, `--radius-2xl: 12px`, `--radius-3xl: 16px`,
  `--radius-4xl: 24px`, bare `rounded` = 6 px (verify how Tailwind 4 resolves bare `rounded` at Gate B).
- `font-mono` legacy → the new `--font-mono` (JetBrains Mono, finally embedded).
- The single legacy `dark:` class is rewritten to a token class in M3-05 (custom Uniwind themes do not activate `dark:`).

### 9.5 Metro, Babel, ThemeProvider runtime

**`apps/mobile/metro.config.js`** — keep everything that is there (watch folders, pnpm resolver, `.js` → `.ts`
retry, `crypto` alias, shared client entry); replace the last line:

```js
const { withUniwindConfig } = require('uniwind/metro');
const UNIWIND_THEMES = require('./src/theme/uniwind-themes.json');

module.exports = withUniwindConfig(config, {
  cssEntryFile: './src/theme/global.css',
  dtsFile: './src/theme/uniwind-types.d.ts',
  extraThemes: UNIWIND_THEMES,
});
```

`withUniwindConfig` must be the outermost wrapper. The theme list is JSON (not TS) because `metro.config.js` is plain
CommonJS.

**`babel.config.js`**: presets `['babel-preset-expo']` (drop `jsxImportSource: 'nativewind'` and `'nativewind/babel'`);
plugins: the rewritten lucide plugin (§5.2, until M10), then `'react-native-reanimated/plugin'` last (on SDK 58 use the
plugin name the SDK's Reanimated/worklets pin documents). Delete `nativewind-env.d.ts`, `tailwind.config.js`.
`components/ui/animated.ts`: `cssInterop(...)` → `withUniwind(...)`.

**`apps/mobile/src/theme/prepaint.ts`** (imported first by `app/_layout.tsx`, runs at module evaluation, before any
render):
1. `SplashScreen.preventAutoHideAsync()` (existing behaviour, keep).
2. Read MMKV synchronously: `generatorai-theme` (mode), `generatorai-theme-palette`, `generatorai-accent`,
   `generatorai-system-accent-seed` — via `readStoredAppearance((k) => prefs.getString(k))` for mode/theme/accent, with
   the `'system'` accent handled first (§2.5).
3. `appearance = resolveAppearance(mode, Appearance.getColorScheme() === 'dark')`.
4. `name = uniwindThemeName(themeId, appearance)`; `vars = accent === 'system' ? toAccentVars(resolveAccentFromSeed(theme,
   appearance, cachedSeed[appearance])) : toAccentVars(loadPalette(themeId).accents[appearance][accent])`.
5. `Uniwind.updateCSSVariables(name, vars)` **then** `Uniwind.setTheme(name)` (update first so the switch paints with the
   right accent; Uniwind re-renders only when the modified theme is active).
6. `Appearance.setColorScheme(mode === 'system' ? null : mode)` (RN's "unspecified" value on RN ≥ 0.82 — use whichever the
   pinned RN types accept) so native chrome (alerts, menus, SwiftUI/Compose hosts, keyboard) follows the app mode.
7. `SystemUI.setBackgroundColorAsync(surface)`.

**`ThemeProvider.tsx`** (rewritten in M3-05; context shape):

```ts
interface ThemeContextValue {
  mode: ThemeMode; appearance: Appearance; themeId: string; theme: ThemeDef;
  accent: AccentId | 'system'; accents: AccentDef[]; systemAccentAvailable: boolean;
  setMode(mode: ThemeMode): void; setThemeId(id: string): void; setAccent(accent: AccentId | 'system'): void;
  colors: ThemeColors;   // §2.6 (useThemeColors reads this)
}
```

- Every change (mode, OS scheme when `system`, theme, accent, System-accent seed refresh) calls the same `applyTheme()`
  as prepaint steps 3–7, writes MMKV, updates `colors`, and notifies `subscribeThemeColors` listeners (widgets palette,
  terminal). `updateCSSVariables` values persist per theme in Uniwind, so `applyTheme` **always** writes the accent
  vars explicitly, including when the accent is the theme default.
- Removed from the context: `style` (the `vars()` bag) and `terminal` (now `colors.terminal`). The tree no longer
  re-renders on theme change: views read CSS variables; only `useThemeColors()` consumers re-render.
- **Previews:** the Appearance screen renders each theme card inside `<ScopedTheme theme={uniwindThemeName(id,
  appearance)}>` and each accent swatch inside `<ScopedVariables vars={…}>` (Uniwind ≥ 1.11; if the component name
  differs in the pinned release, use its scoped-variables API). Nested scopes: nearest wins.
- **Splash hold:** `SplashScreen.hideAsync()` after (a) prepaint applied the theme, (b) auth/session hydration (existing),
  (c) the first `Screen` layout. Fonts need no wait (embedded).

### 9.6 Slimming `tokens.generated.ts`

1. M3-04 adds the new targets alongside the existing "mobile token module" target; nothing is removed yet.
2. M3-05 stops `ThemeProvider` reading `themeVars`; M3-08 moves `terminalThemes` / `colors.x` readers to
   `useThemeColors()` (415 `colors.` occurrences today, most in legacy components that M4–M9 replace).
3. When `rg "tokens.generated" apps/mobile` returns nothing (at the latest in M10): delete
   `apps/mobile/src/theme/tokens.generated.ts`, delete the "mobile token module" target from `bin/generate.ts`, and
   delete `emitNative` / `tailwindColorNames` from `emit/native.ts` (no web consumer; logged in `COORDINATION.md`).
   Legacy `themeVars` (25,966 lines, ≈ 915 KB) leaves the bundle; report the before/after bundle size from
   `pnpm --filter @generatorai/mobile bundle:check`.

### 9.7 `check:tokens` coverage and tailwind-merge

**New generator targets** in `packages/design-tokens/bin/generate.ts` (web targets untouched):

| Label | Path | Render | Optional |
|---|---|---|---|
| mobile class vocabulary | `packages/design-tokens/css/vocabulary-mobile.css` | `emitMobileVocabularyCss()` | no |
| mobile vocabulary lists | `packages/design-tokens/generated/vocabulary-mobile.json` | `emitMobileVocabularyJson()` (namespaces, banned shared utilities, breakpoints) | no |
| mobile Uniwind themes | `apps/mobile/src/theme/uniwind-themes.css` | `emitUniwindThemes()` | yes (host app) |
| mobile Uniwind theme list | `apps/mobile/src/theme/uniwind-themes.json` | `emitUniwindThemeList()` | yes |
| mobile palette `<id>` (× 18) | `apps/mobile/src/theme/palettes/<id>.ts` | `emitNativePalette(id)` | yes |
| mobile palette index | `apps/mobile/src/theme/palettes/index.ts` | `emitNativePaletteIndex()` | yes |
| mobile splash colours | `apps/mobile/src/theme/splash-colors.json` | `emitSplashColors()` | yes |

`pnpm check:tokens` (root; part of `pnpm lint`) then fails on any stale mobile file. `pnpm tokens:write` regenerates.
Generated files are never edited by hand (lint `generatedEdit` is the check itself).

**tailwind-merge:** `apps/mobile/src/ui/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { mobileTwMergeExtension } from '@generatorai/design-tokens';

const twMerge = extendTailwindMerge(mobileTwMergeExtension());
export function cn(...inputs: ClassValue[]): string { return twMerge(clsx(inputs)); }
```

Test (`apps/mobile`, Vitest): `cn('text-fg-2', 'text-title') === 'text-fg-2 text-title'`;
`cn('min-h-row', 'min-h-row-2') === 'min-h-row-2'`; `cn('rounded-card', 'rounded-card-lg') === 'rounded-card-lg'`;
`cn('size-hit', 'size-icon-button-sm') === 'size-icon-button-sm'`; `cn('px-gutter', 'px-4') === 'px-4'`.

### 9.8 Design lint for mobile (`check:design` + ESLint)

Two mechanisms, as on web: ESLint (fast, per file, `eslint-plugin-better-tailwindcss` with `entryPoint:
apps/mobile/src/theme/global.css`, plus `no-restricted-imports` / `no-restricted-syntax`) and the ratchet script
`apps/mobile/scripts/check-design.mjs` → `pnpm --filter @generatorai/mobile check:design` (`--strict` in CI). Scopes:
**hard zero** in `app/**`, `src/ui/**`, `src/blocks/**`, `src/features/**`; **ratchet** (count may only fall) in
legacy `src/components/**`, `src/navigation/**`, `src/settings/**` and other legacy folders; **exempt**:
`src/theme/palettes/**`, `src/theme/*.json`, `src/theme/uniwind-*.{css,json,d.ts}`, `src/ui/primitives/Icon/material-filled/**`,
`**/__tests__/**`. Stories (`*.stories.tsx`) follow the vocabulary rules but may use raw elements (web D-45 analogue).

| Rule id | Rejects | Pattern / mechanism | Exempt |
|---|---|---|---|
| `unknownClass` | any class not in Tailwind core layout utilities ∪ `vocabulary.json` ∪ `vocabulary-mobile.json` (Uniwind silently ignores unknown classes) | better-tailwindcss `no-unknown-classes` | — |
| `hardcodedPaletteClass` | `bg-red-500`, `text-zinc-400` … | web regex (`check-design-system.mjs`) | — |
| `whiteBlackClass` | `bg-white`, `text-black` … | web regex | — |
| `defaultTextSize` | `text-xs|sm|base|lg|xl|2xl…` | web regex | `legacy.css` users in ratchet folders |
| `defaultRadius` | bare `rounded`, `rounded-sm|md|lg|xl|2xl|3xl|4xl` | web regex | ratchet folders |
| `defaultShadow` | `shadow`, `shadow-sm…2xl`, `shadow-inner` (only `shadow-pop`, `shadow-float`, `shadow-none`) | web regex | — |
| `arbitraryValue` | `w-[437px]`, `[color:red]` | web regexes | `src/ui/lib/**` with a comment |
| `varInClassString` | `bg-[var(--x)]`, `bg-(--x)` | web regex | `src/ui/lib/**` |
| `hexOrRgbInTs` | `#rrggbb`, `rgb(`, `hsl(`, `oklch(` in `.ts/.tsx` | web regex | exempt paths above |
| `legacyTokenUtility` | `bg-background`, `text-muted-foreground`, `bg-control` … (`LEGACY_UTILITY_NAMES` + `control`, `control-strong`, `control-foreground`) | generated pattern | ratchet folders only |
| `mobileBannedShared` | `MOBILE_BANNED_SHARED_UTILITIES` (`h-strip`, `w-rail`, `z-rail`, `w-aside`, `w-side-rail`, `w-inspector`, `h-th` …) | list from `vocabulary-mobile.json` | — |
| `defaultBreakpoint` | `sm:`, `md:`, `lg:`, `xl:`, `2xl:` variants | regex `(?<![\w-])(sm|md|lg|xl|2xl):` | — (use `medium:`, `expanded:`) |
| `platformClassVariant` | `ios:`, `android:`, `native:`, `web:`, `tv:` class variants | regex | **before Gate A:** nowhere; **after Gate A:** allowed only in `src/ui/**` (MD-10, MD-15) |
| `darkVariant` | `dark:` / `light:` variants (custom themes do not drive them) | regex | — |
| `fixedRowHeight` | `h-row`, `h-row-2`, `h-item`, `h-nav`, `h-step`, `h-tile`, `h-th` (rows must be `min-h-*`, MD-28) | regex `(?<![\w-])h-(row|row-2|item|nav|step|tile|th)(?![\w-])` | — |
| `boldWeight` | `font-bold|extrabold|black`, `fontWeight: '700'|'800'|'900'|'bold'` | regex | — |
| `literalInlineStyle` | `style={{ … : 'literal' | 12 }}` | web regex | `src/ui/**` computed geometry with a comment |
| `styleSheetColor` | `StyleSheet.create` in `features/**`, `blocks/**`, `app/**` | `no-restricted-syntax` | — |
| `fontFamilyLiteral` | `fontFamily:` anywhere | regex | `src/ui/primitives/Text.tsx`, `src/terminal/**` |
| `noFontScalingOff` | `allowFontScaling={false}` | regex | `src/terminal/**` |
| `rawTextImport` | `Text`, `TextInput`, `Pressable`, `TouchableOpacity`, `TouchableHighlight` imported from `react-native` | `no-restricted-imports` | `src/ui/**` |
| `lucideDirectImport` | `from 'lucide-react-native'` (barrel or subpath) | `no-restricted-imports` | `src/ui/primitives/Icon/**`; legacy ratchet until M10 |
| `symbolsImport` | `expo-symbols`, `@expo/material-symbols` | `no-restricted-imports` | `src/ui/primitives/Icon/**`, `src/ui/native/**` |
| `hapticsImport` | `expo-haptics` | `no-restricted-imports` | `src/ui/platform/haptics.ts` |
| `glassImport` | `expo-glass-effect` | `no-restricted-imports` | `src/ui/native/GlassSurface/**`, `src/ui/platform/glass.ts` |
| `uniwindImport` | `uniwind` runtime API (`Uniwind`, `ScopedTheme`, `withUniwind`, `useCSSVariable`) | `no-restricted-imports` | `src/theme/**`, `src/ui/**` |
| `themeColorsInFeature` | `useThemeColors` / `getThemeColors` | `no-restricted-imports` | `src/ui/**`, `src/services/**`, `src/theme/**` |
| `platformOs` | `Platform`, `Platform.OS`, `Platform.select` (MD-15) | `no-restricted-imports` / syntax | `src/ui/platform/**`, `src/ui/**/*.ios.tsx|*.android.tsx`, `src/services/notifications/**`, `src/services/native/**` |
| `unstyledVariant` | `variant="unstyled"` | web regex | — |
| `storiesPresent` | a `src/ui/**` component file without a sibling `*.stories.tsx` | ratchet script | — |

### 9.9 Gates (MD-10) and the NativeWind 5 fallback

**Gate A — Uniwind platform-variant fix.** Condition: a published Uniwind release after 1.12.0 that contains PR #686
(the `ios:` / `android:` / `native:` leak, issue #668). Until then: pin `uniwind` **exactly** (no caret), use only CSS
`@variant ios|android` blocks and `.ios.tsx` / `.android.tsx` files, and `platformClassVariant` rejects every platform
class. When it ships: bump to that exact version, re-run the Gate B checklist items 3 and 9, and relax the lint to allow
platform classes inside `src/ui/**` only. Record in `COORDINATION.md`.

**Gate B — half-day spike on the target SDK** (M1-08; SDK 58 preview if 58 is not stable), in a scratch folder, result
in `docs/redesign/mobile/reviews/M1-uniwind-spike.md` with go / fallback:

| # | Check | Pass |
|---|---|---|
| 1 | Uniwind + Tailwind 4.3.3 build on RN 0.88 / the SDK's Metro | app boots, a `bg-surface` view paints |
| 2 | 36 + 2 `@variant` theme blocks from the generated file; `Uniwind.setTheme` between 3 of them | colours switch without remount; no dev warning about missing variables |
| 3 | `@variant ios` / `@variant android` geometry: `text-body` = 17 on iOS, 16 on Android; `rounded-card` 14 / 12 | measured with the inspector |
| 4 | `Uniwind.updateCSSVariables` for the accent on the active theme, then on an inactive theme, then `setTheme` to it | accent correct in both cases (persistence per theme) |
| 5 | `ScopedTheme` (and the scoped-variables API) inside a screen | preview card shows the other theme |
| 6 | `vocabulary.css` `@theme inline` → `var(--gai-…)` resolves; `text-*--line-height` / `--font-weight` / `--letter-spacing` sub-vars apply; px line height is absolute | text metrics as §3.1 |
| 7 | `shadow-pop` / `shadow-float` produce RN `boxShadow` on both OSes; `tabular-nums`; `font-sans`/`font-mono` with weights | visible |
| 8 | `*ClassName` colour props (`placeholderTextColorClassName`, `selectionColorClassName`, `cursorColorClassName`, `colorClassName` on ActivityIndicator, RefreshControl) with `accent-*` classes; safe-area utilities with `Uniwind.updateInsets` | list which work (feeds §2.6) |
| 9 | Release build (`expo export` for both platforms): no `ios:` classes leak into Android styles and vice versa | grep of the bundle |
| 10 | React `Activity` / router `activityEnabled` screen switch does not leave stale styles (issues #689 / #690) | theme change while a screen is inactive, then return |
| 11 | One Reanimated component wrapped with `withUniwind` animates | smooth |
| 12 | Package specifier `@generatorai/design-tokens/css/vocabulary.css` resolves in the Tailwind import (else relative path) | noted |

Any failure of 1–6 or 9 without a same-day workaround → **fallback**.

**NativeWind 5 fallback** (only when Gate B fails or Uniwind stalls; condition: `nativewind@latest` is 5.x and declares
the target SDK):
1. `pnpm --filter @generatorai/mobile remove uniwind`; add `nativewind@5` and `react-native-css@3` at the versions the
   NativeWind 5 install guide pins for the SDK; pin `tailwindcss` to the version NativeWind 5 requires (the RC required
   4.1.12; web stays on 4.3.3 — two Tailwind 4 versions in the workspace is accepted in this case and logged).
2. Metro: replace `withUniwindConfig(...)` with NativeWind 5's Metro wrapper and the CSS entry `global.css`; Babel per the
   NativeWind 5 guide.
3. `global.css`: replace `@import 'uniwind'` with NativeWind 5's theme import; keep `vocabulary.css`,
   `vocabulary-mobile.css`, `legacy.css` unchanged.
4. Emitter: add `emit/nativewind.ts` that emits the same 36 theme var maps as a TS module (`{ [themeName]: Record<var,
   value> }`) instead of `@variant` CSS blocks, and the geometry as the platform media blocks NativeWind supports
   (`@media ios` / `@media android`), or as two var maps selected in JS in `ui/platform` if NativeWind 5 lacks them.
5. ThemeProvider: `Uniwind.setTheme` / `updateCSSVariables` → a root `VariableContextProvider` value = theme map ∪
   accent vars; previews use a nested `VariableContextProvider`; `Appearance.setColorScheme` unchanged.
6. The class vocabulary, the lint, `cn()`, `useThemeColors()` and every component stay as they are.
Uniwind Pro is not bought (MD-10).

---

## 10. Packages for the design-system layer

Versions checked 2026-09-26 (stack-styling "Recommended packages"). SDK-pinned packages are installed with
`npx expo install <pkg>` so the SDK chooses the patch; after the M3 upgrade run `npx expo install --fix`.

| Package | Version (SDK 57 → 58+) | Action | Phase | Reason |
|---|---|---|---|---|
| `uniwind` | first release after 1.12.0 containing PR #686, exact pin; until then `1.12.0` exact without platform class variants | **Add** | M3-05 | Tailwind 4 engine for RN, same Tailwind as web, theme APIs (MD-10) |
| `tailwindcss` | `4.3.3` (devDependency, exact) | **Replace** 3.4.17 | M3-05 | same version as web and Uniwind's compiler |
| `tailwind-merge` | `^3.7.0` | **Add** | M3-05 | `cn()` with the shared merge config |
| `clsx` | `^2.1.1` | **Add** | M3-05 | `cn()` (same as web) |
| `nativewind` | — | **Remove** (+ `tailwind.config.js`, `nativewind-env.d.ts`, `nativewind/babel`, `jsxImportSource`) | M3-05 | superseded |
| `expo-font` | `~57.0.4` → `~58.0.2` | **Add** (explicit, config plugin) | M3-06 | build-time font embedding; variable fonts on 58 |
| `@expo-google-fonts/instrument-sans` | `0.4.2` | **Add** (SDK 57 static source); removed when the vendored variable files land | M3-06 | Instrument Sans 400/500/600 |
| `@expo-google-fonts/jetbrains-mono` | `0.4.1` | **Add** (same) | M3-06 | fixes the never-loaded mono font |
| Vendored `InstrumentSans[wdth,wght].ttf`, `JetBrainsMono[wght].ttf` + OFL | upstream latest | **Add** (assets) | M3-06 (SDK 58) | variable fonts, smaller binary |
| `expo-symbols` | `~57.0.3` → `~58.0.2` | **Add** | M3-07 | SF Symbols (iOS) + Material Symbols (Android) |
| `@expo-google-fonts/material-symbols` | `0.4.1` (only if `expo-symbols` lists it as a peer at install) | **Add if required**; embed weight 400 Outlined only | M3-07 | Android glyph font |
| `@expo/material-symbols` | `0.1.1` | **Add** | M3-07 / M4 | Material XML drawables inside Expo UI Compose hosts; filled variants via CLI |
| `@material-symbols/svg-400` | latest (devDependency) | **Add** | M3-07 | source SVGs for generated filled Android icons + the name-existence test |
| `lucide-react-native` | `0.460.0` → `1.48.0` | **Upgrade**; subpath imports only | M3-07 | domain glyphs; 1.x canonical names match web |
| `apps/mobile/plugins/babel-plugin-lucide-icons.js` | in repo | **Rewrite** (M3-07), **delete** (M10) | M3-07 / M10 | silently no-ops on 1.x (§5.2) |
| `react-native-svg` | SDK pin (15.15.x) | **Keep** | — | lucide, filled Material SVGs, graphs |
| `@expo/ui` | `~57.0.20` → `~58.0.7` | **Add** | M3 / M4 | native controls; Material colour API for the System accent; `Host seedColor` |
| `expo-glass-effect` | `~57.0.4` → `~58.0.2` | **Keep** | M4 | `GlassView` / `GlassContainer` for floating chrome |
| `expo-haptics` | `~57.0.3` → `~58.0.1` | **Keep** | M3-03 / M4 | full iOS + Android haptic vocabulary |
| `react-native-reanimated` / `react-native-worklets` | SDK pins (4.5.x / 0.10.x → 4.7.0 / 0.13.0) | **Keep** | — | motion concepts |
| `react-native-mmkv` | `^4.3.2` | **Keep** | — | prepaint reads, System-accent seed cache |
| `expo-splash-screen`, `expo-system-ui`, `expo-status-bar` | SDK pins | **Keep** | — | splash hold, root background, status bar style |
| `expo-navigation-bar` | SDK pin | **Add only if** the edge-to-edge nav-bar contrast check fails on Android | M5 | nav-bar button style |
| `eslint-plugin-better-tailwindcss` | `^4.7.0` (already at the repo root) | **Extend to mobile** | M1-05 | `no-unknown-classes` etc. with the Uniwind entry |
| `nativewind@5` + `react-native-css@3` | — | **Fallback only** (§9.9) | — | if Gate B fails |
| Uniwind Pro | — | **Do not buy** | — | MD-10 |
| `style-dictionary`, `@terrazzo/cli` | — | **Do not add** | — | the TS emitter keeps computed contrast tokens |
| `@pchmn/expo-material3-theme`, `react-native-material-you-colors`, `@material/material-color-utilities` | — | **Do not add** | — | Expo UI's colour API covers MD-08 |
| `@gorhom/*`, Tamagui, Unistyles, gluestack, zeego | — | **Do not add / remove** (per MD-17) | — | — |

---

## 11. Rulings made in this document (recorded in `01-decisions.md`)

Each ruling is a binding entry in `01-decisions.md` under the MD shown; related rulings share one MD. Two later decisions
amend values in this file: MD-49 (the iOS filter chip shows a ✓ when selected, §3.6) and MD-91 (hit areas come from the
`Pressable` frame, §3.4). MD-64 adds the `h-badge-sm` token (§3.3).

| MD | Ruling | Why |
|---|---|---|
| MD-69 | Mobile radii are platform-fixed; a theme's `radius` is web-only. | `MFoundations` "Platform chrome keeps platform radii"; `MThemesPhone` themes recolour content only |
| MD-69 | Density and interface font size are web-only axes; mobile follows the OS text size and writes comfortable heights for both density keys. | no board draws either on mobile |
| MD-70 | Mobile-only vocabulary lives in `vocabulary-mobile.ts` / `css/vocabulary-mobile.css`; web never imports it; shared names are never changed for mobile. | MD-12 additive rule |
| MD-71 | Mobile line heights and tracking are emitted as absolute px. | RN `lineHeight` / `letterSpacing` are absolute |
| MD-71 | Shared text steps map semantically (display ↔ large title, heading ↔ Title / Title L, title ↔ Headline / Title M, body ↔ Body / Body L, ui ↔ Subhead / Body M, small ↔ Footnote / Body M, micro ↔ Caption / Label); `Text` role names follow 03. | one vocabulary with web |
| MD-59 | Android `min-h-row` = 56 (M3 one-line); two-line rows use `min-h-row-2` 72. | board switch/form rows 56; M3 list spec |
| MD-46 | iOS search fields are 44 tall (top level and in sheets/drawer). | MD-28 over the kit decision's 40 |
| MD-51 | Buttons, icon buttons and pills use `rounded-full` on both OSes. | MD-02 capsules / full radius |
| MD-50 | Gate cards, scope card and Home tiles share `rounded-card-lg` (20 / 16); tiles move 18 → 20 on iOS. | concentric scale "card 20" |
| MD-56 | iOS composer icon buttons draw 36 with ≥ 8 gaps (board 34 with 4). | MD-28 hit areas cannot overlap |
| MD-72 | Phone drawer and pane use `shadow-pop`; glass fallback and Android FAB/snackbar use `shadow-float`; native sheets keep the system radius on iOS (never set `sheetCornerRadius`). | two shadow tokens only |
| MD-47 | iOS JS segmented selected segment is `bg-raised` + `border-line` (catalogue), not `bg-overlay`. | boards disagree (§0.8) |
| MD-73 | Icon families: SF / Material everywhere except the lucideOnly set (agents, changes, branch, commit, pr, diff, hook, variable, webhook). Running spins by rotation; needs-you bounces once on iOS; no repeating effect on waiting. iOS `fontStep` haptic = selection. | MD-41; board silent on iOS terminal haptic |
| MD-74 | Native header titles and all native controls use the system font; our families are never passed to native chrome. | MD-41 |
| MD-71 | Home count values (board 24) use `title` (20 / 22) with tabular numerals. | off-ramp size |
| MD-71 | Board 10–11 px text becomes `caption` 12. | MD-28 |
| MD-71 | Search-palette highlight weight 700 → 600. | MD-28 weights |
| MD-75 | Legacy mobile `bg-accent`/`text-accent`/`border-accent` (accent tint) are renamed before the engine switch. | name collision with the ink accent |
| MD-76 | No spring overshoots: iOS ζ ≥ 0.85, Android M3 standard scheme; old overshooting presets are deleted. | `MFoundations` "Springs, calm … Effects, no overshoot" |
| MD-77 | The Android System accent is stored as `'system'` in `generatorai-accent` (Android ≥ 31), seeds cached in `generatorai-system-accent-seed`; Uniwind's `light`/`dark` variants equal Instrument. | MD-08; first frame before `setTheme` |
| MD-70 | Window-size breakpoints are `medium:` (600) and `expanded:` (840); Tailwind default breakpoints are banned on mobile. | MD-24 |
| MD-78 | Haptic `success`/`warning` fire at server confirmation (2xx or confirming stream event, first wins, once per action), called from the query hook, never from the button. | principle 5; `MFoundations` Haptics |
