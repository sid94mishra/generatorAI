# 03 — Mobile components: kit, layout, blocks, native targets

This is the component plan for the GeneratorAI mobile overhaul (Expo / React Native, iOS 27 + Android 17). It is written for
the implementer (Codex), so it gives every component an ID, a folder, a prop contract, per-platform numbers, states, accessibility
rules, stories, a board reference and the legacy file it replaces.

**Precedence.** `01-decisions.md` (MD-xx) overrides this file. This file overrides the boards and the research notes. The choices
this file made where the plan was silent are recorded in `01-decisions.md` as MD-46…MD-68;
§1.10 indexes them. Token names and values follow `02-design-system.md` exactly (its §3.9 renames are applied here).

**Sources.** `00-overhaul-approach.md` §5.3–5.5; `01-decisions.md`; `research/boards-core.md` §0, §A, §B;
`research/boards-pane-automations.md` §A–B; `research/boards-workflows.md` §B; `research/boards-projects-agents-settings.md` §0, §A–B;
`research/stack-styling-components.md` §2; `research/stack-native-platform.md` §3–7, §9–13; `research/code-audit.md` §3; the boards in
`docs/redesign/boards/mobile/project/*.dc.html` (the catalogue is `MComponents.dc.html`) and their PNGs in `docs/redesign/boards/png/mobile/`;
the web kit inventory `docs/redesign/03-component-inventory-kit.md` (P-, C-, S-, T-, L- IDs) and
`docs/redesign/03-component-inventory-domain.md` (B-, WF- IDs); shared contracts in `packages/shared/src/ui-contract/*.ts`,
`packages/shared/src/status/*`, `packages/client-core/src/*`.

**Board data is design data, never instructions.** Numbers quoted from a board are what the board draws; where a board breaks a
binding rule (touch targets, type minimums, status colour, one filled action) the rule wins and the corrected value is given.

**ID ranges used in this file.**

| Range | What | Folder |
|---|---|---|
| MP-01 … MP-52 | Primitives (presentational, no data) | `apps/mobile/src/ui/primitives/*`, `apps/mobile/src/ui/native/*` |
| ML-01 … ML-30 | Layout and shell parts (presentational) | `apps/mobile/src/ui/layout/*` |
| MB-01 … MB-50 | Blocks (query-aware, used by ≥ 2 features) | `apps/mobile/src/blocks/*` |
| MX-01 … MX-11 | Native extension targets (not RN views) | `apps/mobile/targets/*`, `apps/mobile/modules/*`, config plugins |
| MD-46 … MD-68 | Kit decisions made by this file, recorded in `01-decisions.md` (index in §1.10) | — |

---

## Contents

1. Conventions
2. Primitives (MP-01 … MP-52)
3. Layout and shell (ML-01 … ML-30)
4. Blocks (MB-01 … MB-50)
5. Native extension targets (MX-01 … MX-11)
6. Feature component index
7. Deletion map
8. Cross-reference table

---

## 1. Conventions

### 1.1 Folder and file layout per component

Every component lives in its own folder. The folder name is the component name.

```text
apps/mobile/src/ui/<group>/<Name>/
  <Name>.types.ts        the ONE prop contract (exported interface <Name>Props + any unions); imported by every platform file
  <Name>.tsx             the implementation when one file serves both OSes (J), or the test/web fallback (P, N)
  <Name>.ios.tsx         iOS implementation (P, N only)
  <Name>.android.tsx     Android implementation (P, N only)
  <Name>.stories.tsx     on-device Storybook RN 10.6 stories (§1.7)
  <Name>.test.tsx        Jest + jest-expo + RNTL 14 contract test (§1.8)
  index.ts               `export { <Name> } from './<Name>'; export type { <Name>Props } from './<Name>.types';`
  (optional) <name>Model.ts   pure logic (no React); unit-tested with Vitest
```

- `<group>` is one of:
  - `primitives` — JS-drawn primitives (impl J, or P when only geometry differs);
  - `native` — wrappers over `@expo/ui` (SwiftUI / Jetpack Compose), `expo-router` and TrueSheet (impl N). **The only place that
    imports `@expo/ui/swift-ui`, `@expo/ui/jetpack-compose`, `@lodev09/react-native-true-sheet` or `expo-glass-effect`.**
    `@expo/ui/swift-ui` is imported only from `*.ios.tsx`, `@expo/ui/jetpack-compose` only from `*.android.tsx` (importing
    the wrong one crashes with "Unable to get view config");
  - `layout` — screen chrome, shell, lists, forms.
- `apps/mobile/src/ui/platform/` holds the OS policy (MD-15): `geometry.ts` (`geometry()` returns the active
  `GEOMETRY.ios|android` slot), `hit.ts` (`hitFrameFor(width, height)`, and `hitSlopFor` as an allowlisted last resort, MD-91),
  `haptics.ts` (`haptic(concept)`, `02-design-system.md` §7.2), `gestures.ts` (edge-swipe policy, MD-19), `glass.ts` (`useGlass()`,
  `02-design-system.md` §8.2), `motion.ts` (`useReduceMotion()`, `useMotion(concept)`, `02-design-system.md` §6.4), `transparency.ts`
  (`useReduceTransparency()`), `breakpoints.ts` (`sizeClassFor()`, `useSizeClass()`: `'compact' | 'medium' | 'expanded'` at 600 / 840,
  MD-24, `06-platform-and-shell.md` §1.3), `fontScale.ts` (`useFontScale()`; per-role `maxScale` and `chromeScaleCap` come from
  `geometry()`, `02-design-system.md` §4.1), `presentation.ts` (`sheetOptions(kind)`, `headerOptions()`, 06 §3.1), `back.ts`
  (`useBackHandler`, 06 §3.2), `pressFeedback.ts` (press-scale vs ripple), `nouns.ts` (platform nouns: "Face ID" / "fingerprint",
  "This iPhone" / "This phone", "Live Activities" / "Live Updates", "Control Center" / "Quick Settings"), `keyboard.ts`
  (`useHardwareKeyboard()`).
- `apps/mobile/src/ui/lib/` holds `cn()` (tailwind-merge with web's generated config), `useThemeColors()` (resolved literals of
  the active theme for native hosts, MD-10 / 00 §5.6.3), `testIds.ts` (§1.5 helpers), `format.ts` (Intl wrappers for dates,
  durations, numbers, MD-29), `highlight.ts` (the bounded syntax highlighter moved from `components/markdown/highlight.ts`, used by
  MP-42, MB-10, MB-24, MB-26).
- Blocks: `apps/mobile/src/blocks/<Name>/` with the same files plus `<Name>.queries.ts` (the block's data hooks; the only file in
  the block that may import `@tanstack/react-query`, `createApiClient` or client-core stores) and, where the block has a pure view
  model, `<name>Model.ts`. A block never imports `features/*` (MD-14).
- Feature-local components: `apps/mobile/src/features/<area>/components/<Name>/` (same file set; stories required, tests where they
  hold logic). Feature data hooks live in `features/<area>/queries.ts`.
- Routes (`apps/mobile/app/**`) only re-export feature screens and set presentation options (MD-14).

### 1.2 Naming (MD-45)

- A concept that exists on web keeps the **web name** (column "Web" in every entry and in §8). Prop names follow the web
  contract and the `ui-contract` types where they exist (`StatusBadgeProps`, `ComposerView`, `GateKind`, `DockTabType`, `ChatRowModel` …).
- Mobile-only concepts get their own names: `ListSection`, `ListRow`, `SidePanel`, `PaneShell`, `PaneTabStrip`, `NewAction`,
  `AdaptiveLayout`, `KeyRow`, `GlassSurface`, `SwipeRow`, `ReorderList`, `FactStrip`, `ScrollToLatest`, `StatusLine`,
  `FullScreenEditor`, `PermissionState`, `OfflineState`.
- Never suffix a component with the platform (`ButtonIOS`); platform code lives in `.ios.tsx` / `.android.tsx`.
- Event props are `on<Verb>` (`onPress`, `onValueChange`, `onDismiss`); value props `value` / `defaultValue`; selection
  `selected`; disabled `disabled` + optional `disabledReason` (read by screen readers and shown where the design has room).

### 1.3 Implementation codes

| Code | Meaning | Rule |
|---|---|---|
| **N** | Native control via `@expo/ui` (SwiftUI on iOS, Jetpack Compose on Android), `expo-router` or TrueSheet | Wrapped in `ui/native/<Name>` with `.ios.tsx` + `.android.tsx` + a `.tsx` fallback that renders a JS approximation for Jest and the web preview. Each Expo UI `Host` is a leaf; never one Host per row of a virtualised list (00 §5.4, stack-styling §2). |
| **J** | JS-drawn on Uniwind classes (`className` + `cn()`), Reanimated, RNGH | One `.tsx`. Platform differences come only from tokens (`@variant ios|android` geometry) or `ui/platform` hooks. |
| **P** | One contract, platform files | `.ios.tsx` and `.android.tsx` differ in structure (not only tokens); both implement `<Name>Props` exactly. |

### 1.4 Tokens used in this file

Colours are the shared design vocabulary (`packages/design-tokens/src/vocabulary.ts`): `bg-ground`, `bg-surface`, `bg-raised`,
`bg-overlay`, `bg-sunken`, `bg-hover`, `bg-selected`, `border-line-soft`, `border-line`, `border-line-strong`, `text-fg`, `text-fg-2`,
`text-fg-3`, `bg-accent`, `text-on-accent`, `border-focus`, `text-run|ok|warn|err` (AA text values), `bg-run-bg|ok-bg|warn-bg|err-bg`,
`bg-add-bg`, `bg-del-bg`, `bg-scrim`, `shadow-pop`. Colour literals, palette classes, `text-white/black`, arbitrary values and inline
literal styles are forbidden in `ui/`, `blocks/` and `features/` (the web rules, applied to mobile by M1 lint); inline `style` is allowed
only for computed geometry (gesture offsets, measured heights).

Geometry names below resolve per platform through the generated `@variant ios` / `@variant android` blocks
(`GEOMETRY.ios` / `GEOMETRY.android`, 00 §5.6.4). **`02-design-system.md` §3–§5 is authoritative for the exact class strings and
values**; the tables below repeat them (with the §3.9 renames applied) so this file can be read on its own. If the two ever differ,
02 wins and this file is corrected in the same commit. Values are pt on iOS and dp/sp on Android.

**Type roles** (the `Text` `role` prop; each role renders the class in the second column, `02-design-system.md` §4.1, MD-71):

| Role | Class | iOS size / lh / weight | Android size / lh / weight | Used for |
|---|---|---|---|---|
| `largeTitle` | `text-display` | 32 / 37 / 600, tracking −0.64 | 28 / 34 / 600, tracking −0.28 (Headline M) | RN-drawn large titles (Android Home headline, iPad, pairing) |
| `title` | `text-heading` | 20 / 25 / 600, −0.2 | 22 / 28 / 600 (Title L) | sheet big titles, Android bar title, section titles, Home count values |
| `headline` | `text-title` | 17 / 22 / 600 | 16 / 24 / 600 (Title M) | collapsed bar title, iOS sheet/modal titles, Home section headers |
| `detailTitle` | `text-detail-title` | 16 / 21 / 600, centred | 18 / 24 / 600, start-aligned | detail and chat header title |
| `body` | `text-body` | 17 / 24 / 400 | 16 / 24 / 400 (Body L) | rows, menus in JS, forms, search |
| `transcript` | `text-transcript` | 16 / 24 / 400 | 16 / 24 / 400 | chat prose, bubbles, composer input |
| `subhead` | `text-ui` | 15 / 20 / 400 (600 in tool-block titles and buttons) | 14 / 20 / 400 (Body M) | secondary lines, buttons (600) |
| `footnote` | `text-small` | 13 / 18 / 400 (600 for section labels) | 14 / 20 / 400 | meta lines, help text |
| `caption` | `text-micro` | 12 / 16 / 500 | 12 / 16 / 500 (Label M) | breadcrumbs, timestamps, badges |
| `monoLg` / `mono` / `monoSm` | `text-mono-lg` / `text-mono` / `text-mono-sm` | 14 / 20, 13 / 19, 12 / 17, 400, JetBrains Mono, tabular numerals | same | commands, paths, ids, counters, timers |

Minimums (MD-28): nothing below 11 pt / 12 sp; content never below 12 sp on Android; mono never below 12; weights 400/500/600 only.
Native chrome (alerts, menus, pickers) keeps the system font (MD-41, MD-74).

**Radii** (`rounded-<name>`, `02-design-system.md` §3.2):

| Name | iOS | Android | Used for |
|---|---|---|---|
| `rounded-badge` | 12 (pill at h24) | 8 | Badge, StatusBadge, scope tag |
| `rounded-control-sm` | 16 (pill at h32) | 8 | Chip (every variant except attachment) (MD-02) |
| `rounded-control` | 12 | 8 | attachment chip, terminal key-row keys, drawer search button, square icon tiles |
| `rounded-seg` / `rounded-seg-item` | track 9 / segment 7 | connected-group ends 20 / inner 8 | JS segmented fallback (MD-47) |
| `rounded-card` | 14 | 12 | transcript cards, tool block, step list, pane cards, terminal container |
| `rounded-card-lg` | 20 | 16 | gate cards, scope-request card, Home count tiles, JS context-menu preview (MD-50) |
| `rounded-group` | 22 | 16 (carded composites only; lists are flat) | iOS grouped list section, iPad inset panel cards, Home groups, slash popover |
| `rounded-nav` | 12 | 24 (pill) | drawer nav items and drawer live rows (MD-02) |
| `rounded-field` | 12 | 4 (M3 outlined) | text fields, multi-line task field, pairing code cells |
| `rounded-code` | 12 | 8 | code blocks, inline error excerpts, mono fields |
| `rounded-panel` | 28 (drawer: end corners; pane: start corners) | 16 | SidePanel |
| `rounded-dialog` | 38 (inset) | 28 top corners | sheets drawn by JS fallbacks (native sheets draw their own), AlertDialog fallback |
| `rounded-composer` | 28 | 28 | composer |
| `rounded-new` | 26 (capsule) | 16 | NewAction |
| `rounded-toast` | 24 | 8 | Toast / snackbar |
| `rounded-full` | capsule (h/2) | full | Button (all sizes), IconButton, iOS pane pill tabs, search fields, row-action pills, agent glyph circles (MD-51) |

**Heights and sizes** (`h-<name>`, `min-h-<name>`, `size-<name>`, `w-<name>`, `02-design-system.md` §3.3 and §3.6):

| Name | iOS | Android | Notes |
|---|---|---|---|
| `h-bar` / `h-bar-lg` | 52 / 60 (≥ 600) | 64 / 64 | header / top app bar (MD-94) |
| `h-panel-bar` | 52 | 52 | pane header (MD-54) |
| `h-dialog-bar` | 56 | 64 | JS header row inside an imperative sheet or full-screen modal body |
| `h-control` | 44 | 40 | Button `md` |
| `h-control-sm` | 36 | 36 | Button `sm`, in-card and in-row actions (frame 44 / 48, MD-91) |
| `h-control-lg` | 50 | 48 | full-width CTAs only; Android composer Send / Stop 48 (MD-51, MD-56) |
| `size-icon-button` | 44 | 48 | IconButton `md`, header buttons |
| `size-icon-button-sm` | 36 | 40 | IconButton `sm`: inside capsules, composer, pane rows (frame 44 / 48) |
| `h-chip` | 32 | 32 | Chip (frame 44 / 48) |
| `h-badge` / `h-badge-sm` | 24 / 20 | 26 / 20 | Badge, StatusBadge `md` / `sm` (MD-64) |
| `h-field` | 44 (row inside a group) | 56 (outlined) | Input |
| `h-search` / `h-search-sm` | 44 / 44 | 56 / 48 | SearchInput at top level / inside sheets and the drawer (MD-46) |
| `h-seg` | 32 | 40 | segmented (JS fallback) |
| `h-tab` | 32 (pill) | 48 (underline) | PaneTabStrip |
| `h-kbd` | 40 | 40 | terminal KeyRow keys (frame 44 / 48) |
| `h-footer` | 64 | 64 | StickyActionBar, pane footer |
| `min-h-row` | 52 | 56 | single-line ListRow and entity rows (MD-59) |
| `min-h-row-2` | 68 | 72 | two-line entity rows (chat row, Home row, server row) |
| `min-h-item` | 44 | 48 | dense rows: file and tree rows, drawer live rows, question-gate options, Changes rows, stage rows (MD-59) |
| `min-h-step` | 44 | 48 | tool-step rows in an expanded tool block |
| `min-h-nav` | 44 | 48 | drawer nav item |
| `min-h-th` | 30 | 30 | list section label row (not interactive) |
| `min-h-tile` | 72 | 72 | Home count tiles |
| `h-new` | 52 | 56 | NewAction |
| `h-toast` | 48 | 48 | Toast |
| `size-hit` / `min-h-hit` / `min-w-hit` | 44 | 48 | minimum hit area (MD-28, MD-91) |
| `w-drawer` | 318 (cap 79 % of window) | 336 (cap 82 %) | phone drawer |
| `w-pane` | 356 (cap 89 %) | 364 (cap 89 %) | phone and 600–839 overlay pane |
| `w-sidebar` | 312 | 300 | persistent sidebar (≥ 600) |
| `w-dock` | 410 | 400 | docked pane (≥ 840) |
| `px-gutter` / `px-gutter-title` | 16 / 20 | 16 / 16 | side gutter / large-title indent |

### 1.5 testID convention

- Format: kebab-case `<part>-<element>` where `<part>` is the component or screen part (`composer`, `chat-header`, `pane`, `drawer`,
  `changes`, `gate`, `run`) and `<element>` the thing (`send`, `toggle`, `keep-all`). Instances append a stable id:
  `drawer-<destinationId>`, `pane-tab-<DockTabType>`, `gate-<kind>-<actionId>`.
- `testID` is set only where role + accessible name are ambiguous (Maestro flows prefer `id` → testID only when text selection is
  unstable). Every interactive kit component forwards `testID` to its pressable root; composite blocks forward sub-ids through
  `testIDs?: Partial<Record<'<element>', string>>` only where a flow needs them.
- Helper: `ui/lib/testIds.ts` exports `tid(part: string, element: string, id?: string): string`.
- **Existing testIDs are kept verbatim when their screen is ported** (grep of `apps/mobile/src` and `apps/mobile/app`, 2026-09-26;
  34 ids; the frozen web-preview e2e scripts in `apps/mobile/e2e/*.mjs` reference several of them, and the Maestro flows must too):

| Existing testID | Today in | Keep on (new component) |
|---|---|---|
| `app-lock` | `src/auth/AppLock.tsx:182` | MP-35 PermissionState variant `app-lock` (the lock overlay) |
| `privacy-overlay` | `src/auth/AppLock.tsx:182` | the app-switcher privacy overlay (MX-10 JS side) |
| `header-inbox` | `src/navigation/TabHeaderActions.tsx:40` | **removed** (the inbox is replaced by Home's Needs you; delete with its e2e step in the same commit) |
| `header-search` | `src/navigation/TabHeaderActions.tsx:77` | ML-02 Header search action on top-level screens |
| `menu-button` | `src/navigation/shell/MenuButton.tsx:21` | ML-02 Header sidebar toggle (`sidebar-toggle` is **not** introduced; keep `menu-button`) |
| `drawer-search` | `AppDrawer.tsx:149` | ML-06 Drawer search field |
| `drawer-${section.id}` | `AppDrawer.tsx:171` | ML-06 Drawer nav item (`drawer-home`, `drawer-chats` … from `NAV_DESTINATIONS[].id`) |
| `drawer-inbox` | `AppDrawer.tsx:240` | ML-06 Drawer "Needs you" section header |
| `drawer-settings` | `AppDrawer.tsx:256` | ML-06 Drawer footer Settings button |
| `composer-mode` | `components/chat/Composer.tsx:756` | MB-02 TurnSheet Mode control (the chip no longer shows mode; the id moves to the sheet's Mode segmented control) |
| `composer-model` | `Composer.tsx:766` | MB-01 Composer model chip |
| `composer-options` | `Composer.tsx:781` | MB-01 Composer "+" button |
| `rewind-sheet-all` / `rewind-sheet-conversation` / `rewind-sheet-code` | `components/chat/rewindOptions.ts:36-48` | MB-32 CheckpointScrubber rewind menu items |
| `copy-transcript` | `TimelineRow.tsx:321`, `app/chats/[id].tsx:1433` | chat ⋯ menu item "Share transcript"/"Copy transcript" (features/chat) |
| `fork-chat` | `TimelineRow.tsx:330`, `app/chats/[id].tsx:1443` | chat message menu item "Fork from here" (features/chat) |
| `assistant-message-actions` | `TimelineRow.tsx:383` | MB-09 AgentTurnHeader actions button |
| `changes-tray-toggle` | `chat/panes/ChangesTray.tsx:164` | MB-01 Composer changes strip (the tray becomes the strip) |
| `changes-tray-keep-all` | `ChangesTray.tsx:193` | MB-22 ChangesPanel "Keep all" |
| `changes-tray-undo-all` | `ChangesTray.tsx:207` | MB-22 ChangesPanel "Undo all" |
| `changes-tray-review` | `ChangesTray.tsx:224` | MB-01 Composer changes strip "Review" |
| `scm-merge-in-progress` | `changes/CommitBar.tsx:224` | MB-22 CommitBar merge banner |
| `keep-file` / `unkeep-file` | `changes/ChangesList.tsx:320/311` | MB-22 ChangeFileRow menu items Keep / Unkeep |
| `workbench-tool-${tool.id}` | `workbench/WorkbenchPanel.tsx:97` | **renamed** `pane-tab-<DockTabType>` on ML-08 (update `apps/mobile/e2e/panes.mjs` and `modelterm.mjs` in the same commit, or delete them if their Maestro flow has landed) |
| `workbench-button` | `workbench/WorkbenchButton.tsx:35` | **renamed** `pane-toggle` on ML-02 (same rule) |
| `home-new-chat` | `app/(tabs)/index.tsx:192` | ML-09 NewAction on Home |
| `new-workflow` | `app/(tabs)/runs.tsx:226` | ML-09 NewAction on Workflows |
| `fork-provenance` | `app/chats/[id].tsx:1177` | features/chat ForkProvenance line |
| `chat-back` | `app/chats/[id].tsx:1499` | ML-02 Header back button on the chat (MD-18) |
| `chats-bulk-delete` | `app/(tabs)/chats.tsx:338` | ML-25 BulkActionBar Delete on Chats |
| `chats-new` | `app/(tabs)/chats.tsx:351` | ML-09 NewAction on Chats |
| `chats-select` | `app/(tabs)/chats.tsx:358` | ML-02 Header "Select chats" action on Chats |

A rename or removal updates every Maestro flow and every remaining `apps/mobile/e2e/*.mjs` script in the same commit;
`grep -rn "<old id>" apps/mobile` must then return nothing.

### 1.6 Accessibility requirements (every component)

1. **Role and name.** Every pressable sets `accessibilityRole` (`button`, `link`, `switch`, `checkbox`, `radio`, `tab`, `adjustable`,
   `header`, `image`, `alert`, `menuitem`) and an `accessibilityLabel` when the visible text is not the name (icon-only controls take a
   required `label` prop). State goes in `accessibilityState` (`selected`, `checked`, `disabled`, `expanded`, `busy`).
2. **Hit area (MD-28, MD-91).** ≥ 44 × 44 pt (iOS) / 48 × 48 dp (Android). The `Pressable` frame itself reaches the target
   (`hitFrameFor(width, height)` from `ui/platform/hit.ts`); the drawn element may be smaller inside it. Neighbouring frames never
   overlap (MD-56 composer spacing). `hitSlop` only as a last resort, listed in `apps/mobile/e2e/a11y-allow.json`.
3. **Text scaling.** Rows use `min-h-*`, never fixed `h-*` for text containers. Content text scales fully; each role's `maxScale`
   comes from `02-design-system.md` §4.1 (`largeTitle` 1.3, `title` 1.4, `headline` 1.6, `detailTitle` 1.4, others uncapped); dense
   chrome (badges, chips, counts, tab labels, key row, header buttons, drawer live rows) passes `chrome` and caps at
   `chromeScaleCap` 1.4. The legacy `MAX_SCALE` (`chrome 1.4`, `control 1.8`) is deleted. Android is tested at font scale 2.0
   (non-linear scaling).
4. **Status** is always glyph + word (MD-25). A dot alone needs `accessibilityLabel` with the word.
5. **Gestures** (swipe, long-press, drag, pinch) always have (a) a visible button or menu item and (b) an `accessibilityActions`
   entry with the same label (MD-28).
6. **Motion.** Springs become cross-fades and spinners stop when `useReduceMotion()` is true. Glass becomes opaque (`bg-overlay` +
   `border-line`) when `useReduceTransparency()` is true (iOS only; Android always opaque).
7. **Focus.** Modal layers (drawer, pane, sheets, dialogs, full-screen editors) trap focus: iOS `accessibilityViewIsModal`, Android
   `importantForAccessibility="no-hide-descendants"` on the content behind; iOS `onAccessibilityEscape` closes them.
8. **Live regions.** Streaming text, timers and progress announce politely (`accessibilityLiveRegion="polite"` on Android;
   `AccessibilityInfo.announceForAccessibility` on iOS for state changes such as "Needs you").
9. **Layout direction.** start/end only (`ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`), never left/right (MD-29).
10. **Contrast.** Text 4.5:1, glyphs 3:1 — guaranteed by tokens; never override a token colour with opacity on text.

Each entry below adds the component-specific rules.

### 1.7 Story requirements (Storybook RN 10.6, co-located)

- Title `UI/<Group>/<Name>` for `ui/`, `Blocks/<Name>` for blocks, `Features/<Area>/<Name>` for feature components.
- Stories cover **every variant × every state** listed in the entry, plus: long text (60+ chars), `fontScale` 2.0 (via the
  `withFontScale` decorator), RTL-safe layout check (`withDirection('rtl')`), and disabled.
- Both platforms: stories run on the iOS simulator and the Android emulator (the `.ios`/`.android` files are exercised by the
  platform the story runs on; the `Platform` decorator shows the name in the story chrome).
- Both appearances: the global `withTheme` decorator switches Instrument light / dark; one `ThemeMatrix` story per group renders
  the component under Instrument dark, Instrument light and Solarized light (00 §5.12: theme combinations covered by one matrix
  story, not multiplied).
- Blocks use `blocks/__fixtures__/*` typed fixtures built from `packages/shared` types (no invented fields; MD-27) and a
  `QueryClient` decorator seeded with those fixtures. No network.
- The `ui/gallery.tsx` screen is deleted when the kit stories land (MD-43).

### 1.8 Test requirements

- `ui/` and `blocks/`: Jest + jest-expo + RNTL 14. Each `<Name>.test.tsx` asserts: role and accessible name; state flags; that
  `onPress`/`onValueChange` fire; disabled blocks presses; hit area ≥ `size-hit` (the measured `Pressable` frame, MD-91); gesture
  alternatives exist (`accessibilityActions` names).
- Pure `*Model.ts` files: Vitest (the existing mobile runner), 100 % branch coverage for reducers.
- Native wrappers (N): the `.tsx` fallback is what Jest renders; the test asserts the prop mapping function
  (`to<Name>NativeProps(props)`) that both platform files call, so the contract is tested without a native host.

### 1.9 Haptic and motion concepts

Both vocabularies are defined in `02-design-system.md` (§7 haptics, §6 motion) and recorded as MD-78 and MD-76; this section
repeats them for the component entries below.

`ui/platform/haptics.ts` exports `haptic(concept: HapticConcept): void` (the only importer of `expo-haptics`). The concept → primitive
map is `HAPTICS` in `packages/design-tokens/src/haptics.ts` (added in M3-03). The user switch (Settings › Haptics) turns every concept
off. `success` and `warning` fire only when the server confirms (MD-78), from the query hook, never from the button.

| `HapticConcept` | Fires when | iOS (`expo-haptics`) | Android chain (`performAndroidHapticsAsync`, member → fallback) |
|---|---|---|---|
| `selection` | segment, picker value, pane tab change, chip toggle, JS checkbox / radio, scrubber stop | `selectionAsync()` | `Segment_Tick` → `Clock_Tick` |
| `threshold` | swipe action armed at the full-swipe threshold; pin / unpin | `impactAsync(Light)` | `Toggle_On` → `Virtual_Key` |
| `longPress` | long-press menu opens | `impactAsync(Medium)` | `Long_Press` |
| `dragStart` | reorder lift | `impactAsync(Light)` | `Gesture_Start` → `Long_Press` |
| `dragTick` | reordered item passes a slot | `selectionAsync()` | `Segment_Frequent_Tick` → `Clock_Tick` |
| `success` | server-confirmed approve, allow, commit, send accepted, pairing done | `notificationAsync(Success)` | `Confirm` → `Virtual_Key` |
| `warning` | server-confirmed deny, reject, request changes | `notificationAsync(Warning)` | `Reject` → `Long_Press` |
| `error` | a watched run fails; a user action fails | `notificationAsync(Error)` | `Reject` → `Long_Press` |
| `fontStep` | terminal pinch passes a font step (10–20) | `selectionAsync()` | `Segment_Tick` → `Clock_Tick` |

No haptic on plain taps, navigation, drawer or pane open/close and settle, sheet drag, pull-to-refresh, toasts, the Send tap, or native
switches (the platform plays its own).

Motion concepts (`useMotion(concept)` from `ui/platform/motion.ts`, values from `MOTION_CONCEPTS` in
`packages/design-tokens/src/motion.ts`, `02-design-system.md` §6.2 and §6.4):

| Concept | What moves | iOS | Android | Reduced motion |
|---|---|---|---|---|
| `press` | Button / IconButton / NewAction while pressed | spring `smooth300` to scale 0.97 (large surfaces 0.985) | no scale: native ripple + state layer | no scale; iOS highlight = instant opacity 0.7 |
| `toggle` | segmented thumb, chip on/off, checkbox fill, pane-tab indicator, drawer selection | spring `snappy350`; colour 120 ms | `spatialFast`; colour `effectsFast` | instant |
| `panel` | SidePanel drawer and pane open / close / settle; full-screen pane toggle | spring `smooth500` (push-matched) | `spatialDefault` (0.9 / 700) | 180 ms cross-fade |
| `sheet` | route sheets and TrueSheet | native | native | native |
| `reveal` | expand / collapse in place (tool block, collapsibles, ↓ Latest, toasts, banners) | `smooth350`; opacity 180 ms | `spatialDefault`; `effectsDefault` | opacity only, 120 ms |
| `listInsert` | user-initiated list changes only (archive, pin, delete, reorder drop, add stage) | layout `smooth350`; enter fade 180 ms | `spatialDefault`; `effectsDefault` | none |
| `swipe` | SwipeRow settle / commit; ReorderList follow and settle | `smooth300` | `spatialFast` | instant |
| `spinner` | running glyph, inline loader | 1000 ms linear rotation | same | static glyph |

No spring overshoots (MD-76). Streaming transcript growth, server-driven list updates and theme switches are never animated.

### 1.10 Kit decisions (recorded in `01-decisions.md`)

The kit decisions this file made are binding entries in `01-decisions.md`. This index lists where each topic is decided.

| MD | Topic | Where it applies here |
|---|---|---|
| MD-46 | One search field per platform (iOS 44, Android 56 / 48) | MP-17 SearchInput, ML-06 Drawer, ML-28 SearchHeader |
| MD-47 | Segmented control: native first, JS fallback selected `bg-raised`, at most 4 segments | MP-23 SegmentedControl, MP-24 Select |
| MD-48 | Switch: only the "on" colour is ours | MP-22 Switch |
| MD-49 | Choice indicators: single, multi, filter chips | MP-10 Chip, MP-20 Checkbox, MP-21 RadioGroup, MB-03, MB-04 |
| MD-50 | One gate-card shell; `rounded-card-lg` for gates, tiles, scope card | MB-15 GateCard, MB-34, MB-38, ML-18 |
| MD-51 | Button sizes `sm` / `md` / `lg`; `rounded-full` on both platforms | MP-04 Button, MP-05 IconButton |
| MD-52 | Row swipe actions (iOS tiles 64 / 74, Android pills 74) | ML-15 SwipeRow |
| MD-53 | Chats header: Select + Sort and more; counts in segments | features/chats, ML-02 |
| MD-54 | Pane header `h-panel-bar` 52; icon buttons 44 / 48 | ML-07 PaneShell |
| MD-55 | "Always allow" not rendered | MB-15 GateCard |
| MD-56 | Composer action row sizes and Send / Stop shape | MB-01 Composer |
| MD-57 | Stop-dictation uses the `check` glyph | MB-01 Composer (dictation) |
| MD-58 | Toast placement, timing and dismissal | MP-30 Toast |
| MD-59 | Row heights (`min-h-row`, `min-h-row-2`, `min-h-item`, `min-h-step`, `min-h-nav`) | ML-13, ML-14, MB-11, MB-25, ML-06 |
| MD-60 | Multi-select only from a header "Select" | ML-25 BulkActionBar, ML-14 |
| MD-61 | Diff comments: gutter tap, long-press menu, shared intents | MB-24 DiffView |
| MD-62 | Pages inside one sheet; pickers return through the draft store | ML-10 Sheet, MB-03, MB-04, MB-05, MB-06 |
| MD-63 | Composer "+" menu is native; "Workflows" is a checked item | MB-01 Composer, MP-27 Menu |
| MD-64 | Badge sizes (`h-badge` 24 / 26, `h-badge-sm` 20) | MP-06 Badge, MP-07 StatusBadge |
| MD-65 | Widget and Live Update text minimums; system-sized widget buttons | MX-01…MX-04 |
| MD-66 | Compact wizard stepper; the automation wizard has 6 pages | ML-21 Stepper |
| MD-58 | Undo-only toasts for reversible destructive actions | MP-30 Toast |
| MD-67 | Status line badge; progress segments use status tones | ML-04 StatusLine, MP-15 ProgressSegments |
| MD-68 | Section headers per platform | ML-20 SectionHeader, ML-12 ListSection |

Related design-system decisions used throughout this file: MD-69…MD-78 (`02-design-system.md` §11), the hit-area mechanism
MD-91, the sheet and full-screen-modal action rule MD-85 and the header location MD-86.

---
## 2. Primitives (MP-01 … MP-52)

Each entry: **Web** counterpart (web inventory id + name), **Impl** (N/J/P), **Folder**, **Native backing**, **Phase** (the task id in
`07-phases.md`: M4-01 platform/lib, M4-02 foundation, M4-03 display, M4-04 inputs, M4-05 native controls, M4-06 presentation, M4-07 lists,
M4-08 layout, M4-09 states; if 07 moves a component, 07 wins), then the per-platform spec, props, states, accessibility, haptic, boards and seed.

"Seed" names what to start from: **port** = keep the behaviour of the named legacy file and redraw it; **RNR** = copy-in from
React Native Reusables (`@rn-primitives/*` 1.5.x, Uniwind template) and restyle; **new** = write from scratch.

### MP-01 Text

- **Web** none (web uses classes on DOM text) · **Impl** J · **Folder** `ui/primitives/Text` · **Native backing** RN `Text` · **Phase** M4-02
- **Spec (both):** one component for every string in the app (lint forbids raw `<Text>` from `react-native` outside `ui/`). `role` picks
  the role's class from §1.4 (e.g. `headline` → `text-title`); `tone` picks `text-fg | text-fg-2 | text-fg-3 | text-on-accent | text-run | text-ok | text-warn | text-err | text-surface`;
  `weight` overrides to 400/500/600 only. Font family: Instrument Sans for every role except `mono*` (JetBrains Mono,
  `fontVariant: ['tabular-nums']`). `maxFontSizeMultiplier` per role from `02-design-system.md` §4.1 (`largeTitle` 1.3, `title` 1.4,
  `headline` 1.6, `detailTitle` 1.4, everything else uncapped); a Text inside a chrome component (the parent passes `chrome`) caps at
  `chromeScaleCap` 1.4. The contract below is `02-design-system.md` §4.2.
- **iOS vs Android:** only the ramp values (§1.4). iOS maps roles to Dynamic Type text styles via `dynamicTypeRamp`
  (`geometry().type[step].ramp`: `largeTitle→largeTitle`, `title→title3`, `headline→headline`, `detailTitle→callout`, `body→body`,
  `transcript→callout`, `subhead→subheadline`, `footnote→footnote`, `caption→caption1`, `monoLg→subheadline`, `mono→footnote`,
  `monoSm→caption1`); Android uses `sp` sizes that follow font scale.
- **Props:**
```ts
import type { ReactNode } from 'react';
export type TextRole =
  | 'largeTitle' | 'title' | 'headline' | 'detailTitle' | 'body' | 'transcript'
  | 'subhead' | 'footnote' | 'caption' | 'mono' | 'monoSm' | 'monoLg';
export type TextTone = 'fg' | 'fg-2' | 'fg-3' | 'on-accent' | 'run' | 'ok' | 'warn' | 'err' | 'surface' /* inverse snackbar */;
export interface TextProps {
  role?: TextRole;                 // default 'body'
  tone?: TextTone;                 // default 'fg'
  weight?: 400 | 500 | 600;
  numberOfLines?: number;          // truncation with ellipsis ('tail'; 'middle' for paths via ellipsizeMode)
  ellipsizeMode?: 'tail' | 'middle' | 'head';
  chrome?: boolean;                // dense chrome → cap at chromeScaleCap 1.4
  tabular?: boolean;               // default true for mono* roles
  selectable?: boolean;            // default false; true for code, messages, step output
  align?: 'start' | 'center' | 'end';
  accessibilityRole?: 'header' | 'text' | 'link';
  className?: string;              // design utilities only (lint)
  testID?: string;
  children: ReactNode;
}
```
- **A11y:** `role` `largeTitle | title | headline | detailTitle` sets `accessibilityRole="header"` unless overridden.
- **Boards:** MFoundations (ramps), every board. **Seed:** new (the audit found 684 raw `<Text>`; there is no typography primitive).

### MP-02 Icon

- **Web** P-01 Icon · **Impl** P · **Folder** `ui/primitives/Icon` · **Native backing** `expo-symbols` `SymbolView` (SF Symbols on iOS,
  Material Symbols on Android); SVG (react-native-svg) for filled Material glyphs (expo#46850); `lucide-react-native` 1.48 only for
  concepts with no native counterpart (MD-41) · **Phase** M4-02
- **Spec:** `name` is an `IconConcept` from `packages/design-tokens/src/icons.ts` (`ICON_CONCEPTS`), which M3 extends with
  `sfSymbol` and `material` names per concept. Sizes 12 / 14 / 16 / 18 / 20 / 22 / 24 (boards use 18, 22, 24 on mobile; M3 adds them to
  `ICON.sizes`). Colour: `tone` → the same token list as MP-01 (the SymbolView `tintColor` is read from `useThemeColors()`, never a
  literal). `spin` rotates 1 s linear (running glyph); on iOS use the SF Symbol `rotate` effect when available (`animationSpec`), else
  Reanimated; stopped under Reduce Motion. Status glyphs (`status-*` concepts) always come through MP-07/MP-08, never ad hoc.
- **iOS:** `SymbolView` with `weight="regular"`, `scale="medium"`; stroke-equivalent weight chosen so 16 pt matches lucide 1.75 stroke.
- **Android:** `SymbolView` Material Symbols Outlined, weight 400, optical size = `size`; filled variants via SVG.
- **Props:**
```ts
import type { IconConcept } from '@generatorai/design-tokens';
export type IconSize = 12 | 14 | 16 | 18 | 20 | 22 | 24;
export interface IconProps {
  name: IconConcept;
  size?: IconSize;          // default 16 (iOS) / 20 (Android) via geometry().icon.default
  tone?: TextTone;          // default: inherits 'fg-2'
  filled?: boolean;         // Android SVG path; iOS `.fill` symbol variant
  spin?: boolean;           // only for 'status-running' | 'loader'
  label?: string;           // present → accessibilityRole="image" + label; absent → hidden from a11y
  testID?: string;
}
```
- **Boards:** every board. **Seed:** replaces the 4 icon maps (`workbench/toolIcons.tsx`, `common/entityIcons.ts`,
  `chat/timeline/TimelineRow.tsx:91,104`, `brand/VendorIcons.tsx` → MP-52) and 124 direct lucide imports (lint-banned outside `ui/primitives/Icon`).

### MP-03 Pressable

- **Web** none (native `button` on web) · **Impl** J · **Folder** `ui/primitives/Pressable` · **Native backing** RN `Pressable` +
  Reanimated · **Phase** M4-02
- **Spec:** the base of every tappable kit part. Press feedback from `ui/platform/pressFeedback.ts`: iOS press-scale 0.97 (buttons
  only; rows use `bg-hover` highlight) ; Android `android_ripple` with the colour from `useThemeColors().hover` and `borderless` for
  icon buttons. Hover (iPad pointer, Android mouse): `bg-hover`. Focus ring for hardware keyboards: 2px `border-focus`.
  The frame grows to `size-hit` with `hitFrameFor()` (MD-91); the drawn content sits inside it.
- **Props:**
```ts
export type PressFeedback = 'scale' | 'highlight' | 'none';
export interface PressableProps {
  onPress?: () => void;
  onLongPress?: () => void;          // must also exist as a menu item / accessibilityAction (§1.6.5)
  delayLongPress?: number;           // default 400
  disabled?: boolean;
  disabledReason?: string;           // appended to accessibilityHint
  feedback?: PressFeedback;          // default 'highlight'
  haptic?: HapticConcept;            // fired on press-in only for 'selection'; others fire on press
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  accessibilityActions?: ReadonlyArray<{ name: string; label: string }>;
  onAccessibilityAction?: (name: string) => void;
  hitSlop?: number;                  // last resort only; each use listed in a11y-allow.json (MD-91)
  className?: string;
  testID?: string;
  children: ReactNode;
}
```
- **Seed:** port `components/ui/Touchable.tsx` (press scale, ripple `:108`, haptic intent) and `ui/animated.ts`.

### MP-04 Button

- **Web** P-02 Button · **Impl** J · **Folder** `ui/primitives/Button` · **Native backing** none · **Phase** M4-02
- **iOS** (`mbtn`): md h44, pad 0 18, `rounded-full`, gap 8, `subhead` 15/600; `secondary` = `bg-raised` + 1px `border-line`;
  `primary` = `bg-accent text-on-accent`, no border; `ghost` = transparent, `text-fg-2` (text buttons: Manage, Reset, Retry, Check again);
  `destructive` = secondary with `text-err` (+ optional `trash` icon); `tonal` = `bg-selected`, no border; sm h36 pad 0 14, 14/600;
  lg h50 pad 0 24, `headline` 17/600 (MD-51).
- **Android** (`abtn`): md h40, pad 0 20, `rounded-full`, 14/600; `secondary` = transparent + 1px `border-line-strong` (M3 outlined);
  `primary` = `bg-accent text-on-accent` (M3 filled); `ghost` = M3 text button h40 pad 0 12; `destructive` = outlined with `text-err`;
  `tonal` = `bg-selected` (M3 tonal: notification actions, widget Review); sm h36; lg h48 pad 0 24, 16/600.
- **Rules:** at most one `primary` per screen (MD-22) — dev-only warning via a `PrimaryActionRegistry` context in `Screen`
  (ML-01) that logs when two primaries mount. No filled red buttons (MD-22). Row action pills ("Review", "Open" on Home and
  widgets) are `variant="tonal" size="sm"` with hit 44/48 (the board's 34 is a violation, boards-core §0.6).
- **Props:**
```ts
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'tonal';
export type ButtonSize = 'sm' | 'md' | 'lg';
export interface ButtonProps {
  label: string;
  variant?: ButtonVariant;          // default 'secondary'
  size?: ButtonSize;                // default 'md'
  icon?: IconConcept;               // leading
  trailingIcon?: IconConcept;       // e.g. 'chevron-down', 'external-link'
  loading?: boolean;                // replaces the icon with MP-12 Spinner; keeps width; sets busy
  fullWidth?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onPress: () => void;
  haptic?: HapticConcept;           // none by default (success haptics fire on server confirm, not here)
  accessibilityLabel?: string;      // when the label is ambiguous ("Deny" → "Deny git push")
  testID?: string;
}
```
- **States:** default, pressed, disabled (`opacity` token 0.4 on content, not on background), loading, focused (hardware keyboard).
- **A11y:** role `button`; `busy` while loading; label from `label`.
- **Boards:** MComponents "Buttons, chips, segments, switches", Main, MNewChat, MPaneCommit, MPairing.
- **Seed:** port `components/ui/Button.tsx` variant API (primary/secondary/ghost/danger → `destructive`); drop `Fab` (dead).

### MP-05 IconButton

- **Web** P-03 IconButton · **Impl** P · **Folder** `ui/primitives/IconButton` · **Native backing** `expo-glass-effect` `GlassView`
  (iOS `glass` variant only, through MP-38) · **Phase** M4-02
- **iOS:** md 44 circle (`gbtn`); `variant="glass"` = GlassSurface circle (floating chrome only: header buttons not owned by the
  native header, composer buttons, torch); `plain` = transparent `text-fg`; `bordered` = 1px `border-line` (composer Attach, drawer
  New chat); `filled` = `bg-accent text-on-accent` (Send, Stop); `selected` state = `bg-selected`. sm 36 (MD-56).
- **Android:** md 48 circle (`aib`), `plain` / `bordered` / `filled` (Send/Stop: 48 square with radius 16) / `tonal` (`bg-selected`).
  Ripple borderless. No glass. sm 40.
- **Badge slot:** the pane toggle's count bubble (MP-09 `bubble`) sits at top 4 / end 2 (iOS) or top 8 / end 6 (Android).
- **Props:**
```ts
export interface IconButtonProps {
  icon: IconConcept;
  label: string;                     // required accessible name ("Open workspace pane, 2 changes")
  variant?: 'plain' | 'glass' | 'bordered' | 'filled' | 'tonal';
  size?: 'sm' | 'md';
  selected?: boolean;                // pressed/toggle state (pane toggle while open)
  badge?: { count?: number; dot?: 'warn'; tone?: 'fg' | 'run' };
  disabled?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  haptic?: HapticConcept;
  testID?: string;
}
```
- **A11y:** `label` required; with `selected`, `accessibilityState.selected`; badge count is part of `label` (callers build it).
- **Boards:** MComponents Headers, every header, composer. **Seed:** port `ui/Button.tsx` `IconButton` (`:117`).

### MP-06 Badge

- **Web** P-05 Badge · **Impl** J · **Folder** `ui/primitives/Badge` · **Phase** M4-03
- **Spec:** MD-64 geometry. Tones `neutral` (`bg-selected text-fg-2`), `run`, `ok`, `warn`, `err` (`bg-<tone>-bg text-<tone>`) — **status tones
  only through MP-07** (MD-25); plain Badge uses `neutral` or `outline` (1px `border-line`, transparent: scope tags "Project",
  "Worktree", "Writes files", risk tags; `rounded-badge` 12 / 8 at `h-badge` 24 / 26, `h-badge-sm` 20 for `sm`). Optional leading icon,
  optional `mono` suffix ("v7"); `mono` renders the whole label in `text-mono-sm` (the branch badge, MD-64).
- **Props:**
```ts
export interface BadgeProps {
  label: string;
  tone?: 'neutral' | 'outline';
  icon?: IconConcept;
  suffix?: string;          // rendered mono
  mono?: boolean;           // whole label mono (branch names)
  size?: 'sm' | 'md';       // MD-64
  testID?: string;
}
```
- **A11y:** plain text; not focusable. **Boards:** MScopeRequest (Sensitive), MNewChat (Project), MChatWorkflowRun (Agent draft, risk tags),
  MWorkflowDetail (version). **Seed:** port `ui/primitives.tsx` `Badge` (`:101`); its `primary/info/done` tones are dropped.

### MP-07 StatusBadge

- **Web** P-06 StatusBadge · **Impl** J · **Folder** `ui/primitives/StatusBadge` · **Phase** M4-03
- **Spec:** `StatusBadgeProps` from `packages/shared/src/ui-contract/status.ts`. Glyph and tone from `STATUS_STATE_DEFS[state]`
  (`glyph`, `tone`, `badge`, `spin`); word = `label ?? (context==='chat' && state==='succeeded' ? 'Done' : def.label)`;
  `phase` renders "Running · <phase>". Mobile extras: `detail` (" · Bug Fixer", " · Orchestrator") and `elapsed` (mono, live, e.g.
  "Running 4:12"). Geometry MD-64; glyph 14 (md) / 12 (sm).
- **Props:**
```ts
import type { StatusBadgeProps as SharedStatusBadgeProps } from '@generatorai/shared/ui-contract';
export interface StatusBadgeProps extends SharedStatusBadgeProps {
  detail?: string;          // appended " · <detail>", fg-2 weight 500
  elapsedSince?: string;    // ISO; renders a ticking mono duration via ui/lib/format (1 s tick, paused when off-screen)
  size?: 'sm' | 'md';
  testID?: string;
}
```
- **States:** the 8 states × `chat`/`run` context × with/without detail × with/without elapsed.
- **A11y:** `accessibilityRole="text"`, label "<word>[, <phase>][, <detail>][, <elapsed spoken via Intl>]"; state changes to `needs_you`
  are announced by the owning screen, not the badge.
- **Boards:** MComponents "Toasts and status badges", status lines of every detail screen. **Seed:** new; deletes the 13 local
  status maps (code-audit §3.1) and `runs/StatusGlyph.tsx`, `runs/statusStyle.ts`, `runs/tone.ts`, `changes/statusStyle.ts`.

### MP-08 StatusDot

- **Web** P-07 StatusDot · **Impl** J · **Folder** `ui/primitives/StatusDot` · **Phase** M4-03
- **Spec:** 8 circle (md), 6 (sm, connection footers), 7 with a 2px `bg-ground` ring (`ring`). Colour from `STATUS_STATE_DEFS[state].tone`
  or a `HealthTone` (`HEALTH` in `packages/shared/src/status/health.ts`) for connection. `hollow` = 1.5px ring, transparent (offline server).
  Never alone: either a visible word next to it or `label` (MD-25).
- **Props:** `{ state?: StatusState; health?: HealthTone; size?: 'sm'|'md'; ring?: boolean; hollow?: boolean; label?: string; testID?: string }`
- **Boards:** MSidebar footer, MServers, MWidgets small, MHomeMore footer. **Seed:** port `ui/primitives.tsx` `StatusDot` (`:133`).

### MP-09 Count

- **Web** P-08 Count · **Impl** J · **Folder** `ui/primitives/Count` · **Phase** M4-03
- **Spec:** mono `monoSm` 12 `text-fg-3`; tones `warn` (drawer Needs you count), `run`. `bubble` form (pane-toggle badge): min-w 16, h16,
  pad 0 4, `rounded-full`, `bg-fg text-surface` (`tone="run"` → `bg-run text-on-accent`), mono **12** (the boards' 10–11 is below the minimum;
  MD-28) with `scale="chrome"`. `dot` form: 6 `bg-warn` (pane tab needs you).
- **Props:** `{ value: number; tone?: 'fg-3'|'warn'|'run'; form?: 'inline'|'bubble'|'dot'; max?: number /* 99 → "99+" */; testID?: string }`
- **A11y:** hidden when inside a control whose label already carries the count (IconButton, tab); otherwise read as the number.
- **Boards:** MPaneOpen, MChats header count, MSidebar. **Seed:** new.

### MP-10 Chip

- **Web** P-09 Chip · **Impl** J · **Folder** `ui/primitives/Chip` · **Phase** M4-03
- **iOS** (`mchip`): h32, pad 0 12, `rounded-control-sm` 16, 1px `border-line`, transparent, 13/500 `text-fg-2`, gap 6; selected (`.on`) =
  `bg-selected text-fg` + leading ✓ 16, border transparent (MD-49).
- **Android** (`achip`): h32, pad 0 12, `rounded-control-sm` 8, 1px `border-line-strong`, 14/500, gap 8; selected = `bg-selected` + leading ✓ 16.
- **Variants:** `filter` (toggle), `dropdown` (trailing `chevron-down` 12/14; opens a Menu), `input` (trailing remove ✕ 14/16 with its own
  44/48 hit area and label "Remove <label>"), `composer` (transparent border, pad 0 8 / 0 6: agent chip with `lock` 12, model chip with
  chevron), `attachment` (h40 on both OSes, `rounded-control` 12 / 8, `bg-sunken` + 1px `border-line`, 28/32 thumbnail tile, filename 14,
  remove ✕ with a 44/48 frame at the chip's corner, MDF-22), `add` (dashed 1px `border-line-strong`, "+ Tag"). A mono branch label is
  not a chip: it is MP-06 Badge `sm` with mono text (MD-64).
- **Props:**
```ts
export interface ChipProps {
  label: string;
  variant?: 'filter' | 'dropdown' | 'input' | 'composer' | 'attachment' | 'add';
  selected?: boolean;
  icon?: IconConcept;
  locked?: boolean;              // composer agent chip: lock glyph + "locked" in the label
  count?: number;                // mono count after the label ("Active 12")
  thumbnail?: { uri: string } ;  // attachment images (expo-image)
  progress?: number;             // attachment upload 0..1 → thin bottom bar
  error?: string;                // attachment failed → err border + retry via onPress
  onPress?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
  testID?: string;
}
```
- **A11y:** filter → role `button` + `selected`; dropdown → `accessibilityHint` "Opens a menu"; input → the remove button is a separate
  focusable with label "Remove <label>". Drawn h32, hit 44/48.
- **Haptic:** `selection` on toggle.
- **Boards:** MComponents chips, MChats (filters), MComposerInput (attachments), MNewChatMore (tags, branch chip), MAgentPicker.
- **Seed:** port `ui/Chip.tsx` (`Chip`, `StaticChip`) API; restyle.

### MP-11 ChipGroup

- **Web** P-09 `ChipList` + C-04 FilterBar chips · **Impl** J · **Folder** `ui/primitives/ChipGroup` · **Phase** M4-03
- **Spec:** a horizontal scroller (`hscroll`, gap 8, content inset `px-gutter`, end fade mask 88 % where it scrolls) or a wrapping row
  (`wrap`). `selection: 'single' | 'multi' | 'none'`. Overflow chip "+N" when `max` is set in wrap mode. Horizontal scroll yields to
  the SidePanel pan (MD-19: horizontal scrollers block the panel pan).
- **Props:** `{ items: ChipProps[] & {id:string}[]; selection?: 'single'|'multi'|'none'; value?: string|string[]; onValueChange?(v): void; layout?: 'scroll'|'wrap'; max?: number; accessibilityLabel: string; testID?: string }`
- **A11y:** container `accessibilityRole="radiogroup"` (single) or `"list"`; label required.
- **Boards:** MChats, MNewChatMore, MPaneTerminal (instance chips use ML-08 instead), MAgentEdit3. **Seed:** new.

### MP-12 Spinner

- **Web** P-12 Spinner · **Impl** J · **Folder** `ui/primitives/Spinner` · **Phase** M4-03
- **Spec:** the running glyph (`status-running` / `loader` concept) rotating 1 s linear; sizes 12/14/16/20; tone `run` by default.
  Frozen under Reduce Motion. The only inline spinner in the app.
- **Props:** `{ size?: 12|14|16|20; tone?: TextTone; label?: string; testID?: string }` (label → `accessibilityRole="progressbar"`, busy).
- **Seed:** port `ui/States.tsx` `Spinner` (28 uses).

### MP-13 ProgressIndicator

- **Web** none (web has no page-level loader) · **Impl** N · **Folder** `ui/native/ProgressIndicator` · **Native backing** iOS SwiftUI
  `ProgressView` (circular); Android Compose `LoadingIndicator` (M3 Expressive, `contained` variant for over-content) · **Phase** M4-03
- **Spec:** page / section loading only (while a Skeleton is not appropriate: sheet submit, pairing connect, commit working). Sizes
  `md` (iOS regular / Android 48) and `lg` (iOS large / Android 64 contained). Colour from `useThemeColors().fg2` (Android `seedColor`
  = accent when the accent is not ink).
- **Props:** `{ size?: 'md'|'lg'; label: string; contained?: boolean; testID?: string }`
- **A11y:** role `progressbar`, busy, label required ("Connecting", "Committing"). Reduce Motion: Android LoadingIndicator morph
  stops (use a static indicator); iOS system handles it.
- **Boards:** MPairing (connecting, derived), MPaneCommit working (derived). **Seed:** new (replaces `ui/States.tsx` `LoadingState`).

### MP-14 ProgressBar

- **Web** P-38 ProgressBar / Meter · **Impl** J · **Folder** `ui/primitives/ProgressBar` · **Phase** M4-03
- **Spec:** linear track h4 (`meter`) `rounded-full`, track `bg-line-strong` 40 %, fill `bg-fg-2` (neutral meter: storage, context)
  or `bg-run` (determinate progress: clone 38 %, model download, upload). Indeterminate: a 30 % segment sliding 1.2 s (static at 30 %
  under Reduce Motion). Optional label row above (label `footnote` + value mono).
- **Props:** `{ value?: number /*0..1; undefined = indeterminate*/; tone?: 'neutral'|'run'; label?: string; valueText?: string; testID?: string }`
- **A11y:** role `progressbar`, `accessibilityValue {min:0,max:100,now}`. **Boards:** MProjectDetail (clone progress), MSetStorage,
  MSetAudio (download), MChatWorkflowRun (via MP-15). **Seed:** port `ui/ProgressRing.tsx` `ProgressBar`.

### MP-15 ProgressSegments

- **Web** part of WF-12 (run card stage bar) · **Impl** J · **Folder** `ui/primitives/ProgressSegments` · **Phase** M4-03
- **Spec:** N equal segments, gap 3, h4 radius 2 (in-app) or h6 r3 / h8 r4 (Live Activity previews and the run header).
  Segment tone from each stage's `StatusState` tone (`ok` done, `run` running, `warn` needs you, `err` failed, `line-strong` pending,
  `fg-3` skipped). Optional trailing mono "2/6". Optional `tracker` index (Android Live Update style: 24 circle with the state glyph on
  the current segment) — used only in the in-app LiveActivity preview (MX settings) and on Android run headers.
- **Props:** `{ segments: ReadonlyArray<{ state: StatusState; label: string }>; size?: 'sm'|'md'|'lg'; showFraction?: boolean; tracker?: number; testID?: string }`
- **A11y:** one element, label "Stage 3 of 6, Needs you: Apply upgrades"; segments hidden. **Boards:** MChatWorkflowRun, MLiveActivity,
  MWorkflowRun, MSetWidgets preview. **Seed:** new.

### MP-16 Input

- **Web** P-13 Input · **Impl** P · **Folder** `ui/primitives/Input` · **Native backing** RN `TextInput` (Writing Tools, autofill, dictation
  come free) · **Phase** M4-04
- **iOS:** two presentations. `row` (inside a ListSection group): h44 min, label column 96 wide `body`, value `body`, placeholder
  `text-fg-3`, no border (the group is the container), clear button when focused. `standalone`: h44, `rounded-field` 12, `bg-sunken`
  (or `bg-raised` on `bg-surface` screens), pad 0 12, `body`. Focus: 1px `border-fg-3` + caret `accent`.
- **Android:** M3 outlined: h56, `rounded-field` 4, 1px `border-line-strong`, pad 0 16, `body` 16; floating label 12 animates up on focus
  or value; focused border 2px `border-fg` (ink accent) — `accent` when the accent is not ink; error 2px `border-err`. `filled` variant
  is not built (M3: one style per form; the share sheet's filled Agent field becomes outlined).
- **Variants:** `text`, `secret` (secure entry + trailing eye toggle with label "Show <label>"), `mono` (branch names, URLs, ids: mono 14;
  iOS h34 `rounded-field` 10 `bg-sunken` in cards; Android h40 r4), `url`, `email`, `number`.
- **Props:**
```ts
export interface InputProps {
  label: string;                        // visible (row label / floating label) and accessible
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  presentation?: 'row' | 'standalone';  // iOS only; Android always outlined
  kind?: 'text' | 'secret' | 'mono' | 'url' | 'email' | 'number';
  leadingIcon?: IconConcept;
  trailing?: ReactNode;                 // unit, status ("● Reachable"), small button
  error?: string;                       // shows error styling; Field (MP-19) renders the message
  disabled?: boolean;
  readOnly?: boolean;                   // selectable, no keyboard
  autoFocus?: boolean;
  returnKeyType?: 'done' | 'next' | 'go' | 'search' | 'send';
  onSubmitEditing?: () => void;
  textContentType?: TextInputProps['textContentType'];
  autoComplete?: TextInputProps['autoComplete'];
  maxLength?: number;
  testID?: string;
}
```
- **A11y:** `accessibilityLabel` = label; error → `accessibilityHint` = error text and `invalid` announced; secret eye toggle has its own label.
- **Boards:** MComponents "Text fields", MSetMcpAdd, MSetSourceControl, MPairing (address), MNewChat. **Seed:** port `ui/Form.tsx` `Field` (`:53`).

### MP-17 SearchInput

- **Web** P-14 SearchInput · **Impl** P · **Folder** `ui/primitives/SearchInput` · **Phase** M4-04
- **Spec (MD-46):** iOS h40 `rounded-full` `bg-selected`, pad 0 8 0 12, search icon 18 `text-fg-3`, text `body`, clear button (drawn 20
  `bg-fg-3` circle with ✕ 12, hit 44) when non-empty, optional mic (18) for dictation. Android `bar` h56 `rounded-full` `bg-raised`, icon 22,
  text 16, trailing mic IconButton 48 or clear; `compact` (inside sheets and drawer) h48 `rounded-full` `bg-selected`. The drawer's
  search is a **button** that opens the palette (`asButton`): iOS h40 `rounded-field` 12 `bg-sunken` + 1px `border-line-soft`, 15
  `text-fg-3`; Android r20.
- **Props:** `{ value: string; onChangeText(v): void; placeholder: string; size?: 'bar'|'compact'; asButton?: boolean; onPress?(): void; onSubmit?(): void; mic?: boolean; onMicPress?(): void; autoFocus?: boolean; loading?: boolean; testID?: string }`
- **A11y:** role `search` (iOS `searchField` trait), clear "Clear search", mic "Dictate". **Boards:** MChats, MAgentPicker, MSearch,
  MSidebar, MPaneFiles (filter). **Seed:** port `ui/Form.tsx` `SearchField` (`:103`).

### MP-18 Textarea

- **Web** P-15 Textarea · **Impl** P · **Folder** `ui/primitives/Textarea` · **Phase** M4-04
- **Spec:** multi-line `TextInput`, grows from `minRows` to `maxRows` then scrolls. iOS: inside a group min-h 92, pad 12 16, `transcript`
  16/1.45; standalone `bg-raised` radius 16. Android: outlined, floating label, min-h 96. Optional footer slot (inline toolbar
  "@ Files", "/ Skills", paperclip — MNewChat task field), optional size meter ("2.1 KB of 32 KB", MAgentEdit1).
- **Props:** `{ label: string; value: string; onChangeText(v): void; placeholder?: string; minRows?: number; maxRows?: number; mono?: boolean; footer?: ReactNode; meter?: { used: number; max: number; unit: 'bytes'|'chars' }; error?: string; testID?: string }`
- **Boards:** MNewChat (Task), MAgentEdit1 (instructions), MPaneCommit (description), MShortcuts share Note, MScopeRequest reason.
- **Seed:** new.

### MP-19 Field

- **Web** P-16 Field · **Impl** J · **Folder** `ui/primitives/Field` · **Phase** M4-04
- **Spec:** wraps one control with a label (when the control does not draw its own), help text (`footnote` `text-fg-3`, below, pad 6 16
  on iOS / 4 16 on Android), error text (`footnote` `text-err` with `circle-x` 14), required marker (" · required" in the label, never `*` alone).
  `provenance` slot for "Changed ↶" chips (MAgentPickerCaps).
- **Props:** `{ label?: string; help?: string; error?: string; required?: boolean; provenance?: ReactNode; children: ReactElement; testID?: string }`
- **A11y:** injects `accessibilityHint` (help or error) into the child through context. **Boards:** settings forms, MSetMcpAdd, MAgentEdit*.
- **Seed:** port `ui/Form.tsx` `Field` label/error parts.

### MP-20 Checkbox

- **Web** P-21 Checkbox · **Impl** J · **Folder** `ui/primitives/Checkbox` · **Phase** M4-04
- **iOS:** 22 circle; checked = `bg-accent` + ✓ 14 `text-on-accent`; unchecked = 1.5px `border-line-strong` ring; indeterminate = `bg-accent` + `minus`.
- **Android:** 18 square r3 (inside a 22 box, 2px inset); checked = `bg-accent` + ✓; unchecked = 2px `border-fg-2`.
- **Props:** `{ checked: boolean | 'indeterminate'; onValueChange(v: boolean): void; label?: string; disabled?: boolean; testID?: string }`
  (in rows, ML-13 `kind="check"` renders the label and makes the whole row the target).
- **A11y:** role `checkbox`, `checked` (`mixed` for indeterminate). **Haptic:** `selection` (JS checkbox; native switches play their own).
- **Boards:** MComponents, MScopeRequest (scope checklist), MSetSecurity (access requests), MChats select mode. **Seed:** new.

### MP-21 RadioGroup (+ Radio)

- **Web** P-23 RadioGroup · **Impl** J · **Folder** `ui/primitives/RadioGroup` · **Phase** M4-04
- **Spec (MD-49):** iOS draws no radio control: the selected row shows a trailing ✓ 18 `text-accent` (ink). Android: leading M3 radio
  20 circle, 2px ring (`border-accent` when selected, `border-fg-2` otherwise) + 10 dot. Rows are ML-13 `kind="radio"`; `Radio` is
  the indicator only, exported for custom rows (gate question options, model rows).
- **Props:** `RadioGroup { value: string | null; onValueChange(v: string): void; accessibilityLabel: string; children }`;
  `Radio { value: string; selected: boolean; disabled?: boolean }`.
- **A11y:** group role `radiogroup`; items role `radio` + `checked`. **Haptic:** `selection`.
- **Boards:** MModelPicker, MAgentPicker, MComponents Question card, MSetPairDevice, MShortcuts share list. **Seed:** new.

### MP-22 Switch

- **Web** P-22 Switch · **Impl** N · **Folder** `ui/native/Switch` · **Native backing** iOS SwiftUI `Toggle` (`.switch` style) via
  `@expo/ui/swift-ui`; Android Compose M3 `Switch` via `@expo/ui/jetpack-compose` (thumb icon ✓ when on) · **Phase** M4-05
- **iOS:** 51×31 system; `tint` = `accent` literal (MD-48). **Android:** 52×32 system; checked track = `accent`, checked thumb icon
  `check` 14; unchecked = outlined (system). Host sized with `matchContents`.
- **Props:**
```ts
export interface SwitchProps {
  value: boolean;
  onValueChange: (v: boolean) => void;
  label: string;          // accessible name (the row renders the visible label)
  disabled?: boolean;
  pending?: boolean;      // optimistic write in flight: disabled + busy; reverts on error (row shows a Toast)
  testID?: string;
}
```
- **A11y:** role `switch`, `checked`. Rows (ML-13 `kind="toggle"`) make the whole row toggle it. **Haptic:** the native control's own;
  no extra call.
- **Boards:** MComponents, MAgentPickerCaps, MSettings, MSetNotifications, MSetAppLock, MComposerPlus (becomes a checked menu item, MD-63).
- **Seed:** replaces `ui/Form.tsx` `Switch` (RN Switch with `#ffffff` thumb) and `ListRow` `toggle`.

### MP-23 SegmentedControl

- **Web** P-25 SegmentedControl · **Impl** N (with a J path) · **Folder** `ui/native/SegmentedControl` · **Native backing** iOS SwiftUI
  `Picker` with `pickerStyle('segmented')`; Android Compose `SingleChoiceSegmentedButtonRow` (M3; checkmark icon on the selected
  segment). The J path (`ui/native/SegmentedControl/SegmentedControl.js.tsx`) draws segments when any segment has a `count` (native
  segments cannot style mono counts) · **Phase** M4-05
- **Spec (native):** iOS h32 system. Android h40, outer ends radius 20, inner 8, 2px gaps, selected `bg-selected` + ✓ 16.
- **Spec (J path):** iOS track h32 pad 2 `rounded-seg` 9 `bg-selected`, selected segment `rounded-seg` 7 `bg-overlay` + 1px `border-line` ring,
  13/600 `text-fg`, others 13/500 `text-fg-2`, count mono 12 `text-fg-3`. Android connected group h40 as above with counts.
- **Large text overflow → Menu:** when `fontScale ≥ 1.3` **or** the measured intrinsic width of all segments exceeds the available
  width **or** `segments.length > 5`, render a `Select` (MP-24) instead: a row showing the label and the current value that opens the
  native menu. The switch is decided in `segmentedModel.ts` (`chooseSegmentedPresentation({count, fontScale, available, intrinsic})`,
  unit-tested) and happens without remount of the parent.
- **Props:**
```ts
export interface Segment<V extends string> { value: V; label: string; icon?: IconConcept; count?: number; disabled?: boolean; locked?: boolean }
export interface SegmentedControlProps<V extends string> {
  segments: ReadonlyArray<Segment<V>>;     // 2–5 (6 allowed only because it always falls back to Select)
  value: V;
  onValueChange: (v: V) => void;
  accessibilityLabel: string;               // "Filter chats"
  size?: 'sm' | 'md';                       // sm = Android h32 inside the turn sheet
  fullWidth?: boolean;
  testID?: string;                          // segments get `${testID}-${value}`
}
```
- **States:** selected, disabled segment, locked segment (lock glyph; "GitHub Copilot" not signed in), overflow → Select.
- **A11y:** role `tablist`-free: container `radiogroup`, segments `radio` (this is a value picker, not tabs; boards-projects-agents-settings §0.1).
- **Haptic:** `selection` (native iOS picker plays its own; Android wrapper calls `haptic('selection')`).
- **Boards:** MComponents, MChats (All/Active/Archived with counts → J path), MModelPicker (Provider, Mode, Effort, Context), MNewChat,
  MNewChatMore, MPaneOpen (compare), MAgentEdit2 (5-way effort → falls back), MStage* tab rows (use ML-08, not this).
- **Seed:** replaces `ui/SegmentedControl.tsx` (JS track, swipe-to-step dropped) and `segmentLayout.ts` (its width maths moves into `segmentedModel.ts`).

### MP-24 Select

- **Web** P-17 Select · **Impl** N · **Folder** `ui/native/Select` · **Native backing** iOS SwiftUI `Picker` (`.menu` style, value + ⇅);
  Android Compose `ExposedDropdownMenuBox` (outlined field + ▾) · **Phase** M4-05
- **Spec:** single choice from ≤ 30 static options. Longer or searchable lists open a Sheet with a SearchInput + RadioGroup (the
  `searchable` prop switches to that presentation). iOS in a group row: label start, value `text-fg-3` + ⇅ end. Android: outlined h56.
- **Props:** `{ label: string; value: string | null; options: ReadonlyArray<{ value: string; label: string; description?: string; disabled?: boolean }>; onValueChange(v: string): void; placeholder?: string; searchable?: boolean; presentation?: 'row'|'field'; disabled?: boolean; testID?: string }`
- **A11y:** role `button` + hint "Opens a menu"; value read as "<label>, <value>". **Haptic:** `selection` on change.
- **Boards:** MSetGeneral, MSetSourceControl, MPaneCommit (base branch), MAutomationCreate2 (timezone), MStageModel. **Seed:** new.

### MP-25 Slider

- **Web** P-46 Slider · **Impl** N · **Folder** `ui/native/Slider` · **Native backing** iOS SwiftUI `Slider`; Android Compose `Slider`
  (M3 bar thumb) · **Phase** M4-05
- **Spec:** continuous or stepped; optional min/max glyphs (iOS "A / A" text-size glyphs); value text trailing mono. Host needs an
  explicit width (`frame`), so the wrapper measures its parent.
- **Props:** `{ value: number; min: number; max: number; step?: number; onValueChange(v): void; onSlidingComplete?(v): void; label: string; valueText?: (v: number) => string; minIcon?: IconConcept; maxIcon?: IconConcept; disabled?: boolean; testID?: string }`
- **A11y:** role `adjustable`, increments by `step`. **Haptic:** `selection` per step when stepped.
- **Boards:** MSetBrowserTerminal (font size), MSetAudio. **Seed:** new.

### MP-26 DatePicker

- **Web** none (web uses inputs) · **Impl** N · **Folder** `ui/native/DatePicker` · **Native backing** iOS SwiftUI `DatePicker`
  (`.compact` in rows, `.wheel` in sheets); Android Compose `DateTimePicker` (dialog) · **Phase** M4-05
- **Props:** `{ mode: 'date'|'time'|'datetime'; value: Date; onValueChange(d: Date): void; label: string; minimumDate?: Date; maximumDate?: Date; timeZone?: string; minuteInterval?: 1|5|15|30; testID?: string }`
- **A11y:** native. **Boards:** MAutomationCreate2 (schedule time 02:00). **Seed:** new.

### MP-27 Menu

- **Web** P-30 Menu · **Impl** N · **Folder** `ui/native/Menu` · **Native backing** iOS SwiftUI `Menu` (UIMenu: SF Symbols, destructive
  attribute, sections, submenus, checked state); Android Compose `DropdownMenu` (M3, anchored; `cornerRadius` 12 and
  `shadowElevation` on SDK 58) · **Phase** M4-05
- **Spec:** opened by tap on its trigger (⋯ / ⋮ / dropdown chip / "+"). Items: label, icon (iOS trailing 18–20, Android leading 20–22
  `text-fg-2`), `destructive` (last group, `text-err`), `checked`, `disabled` with `subtitle` reason, submenu. ≤ 3 groups. iOS glass is
  the system material (allowed: system menu). Android rows h48, 1px dividers between groups, selected/pressed row `bg-selected`.
- **Props:**
```ts
export interface MenuItem {
  id: string;
  label: string;
  icon?: IconConcept;
  subtitle?: string;            // disabled reason or secondary text
  destructive?: boolean;
  checked?: boolean;            // stateful item (MD-63)
  disabled?: boolean;
  children?: ReadonlyArray<MenuItem | MenuSeparator>;   // submenu
  testID?: string;
}
export interface MenuSeparator { type: 'separator' }
export interface MenuProps {
  items: ReadonlyArray<MenuItem | MenuSeparator>;
  onSelect: (id: string) => void;
  trigger: ReactElement;        // an IconButton / Chip / Button; rendered inside the native trigger slot
  title?: string;               // iOS menu title; Android header row
  testID?: string;
}
```
- **A11y:** native menus are accessible; the trigger keeps its own label and gets hint "Opens a menu". Destructive items that are
  irreversible still go through MP-29 after selection.
- **Haptic:** none (system). **Boards:** MComponents Menus (Android overflow), MComposerPlus, MWorkflowRunMenu, MPaneBrowser (More).
- **Seed:** replaces `ui/ActionSheet.tsx` (`ActionSheet` as a menu) and `chat/ChatMenuSheet.tsx`.

### MP-28 ContextMenu

- **Web** P-30 Menu (context) · **Impl** N · **Folder** `ui/native/ContextMenu` · **Native backing** iOS SwiftUI `ContextMenu` with
  `ContextMenu.Items` and `ContextMenu.Preview` (RN preview through `RNHostView`), or `expo-router` `Link.Menu` + `Link.Preview`
  when the row navigates; Android: long-press (`onLongPress`) → Compose `DropdownMenu` anchored at the press point, with the source
  row highlighted `bg-selected` · **Phase** M4-05
- **Spec:** wraps a row. iOS: lifted preview (r18 `bg-raised`, glyph + title + mono meta, as drawn) over a blurred dimmed scene
  (system), items as MP-27. Android: no preview, no scrim; anchored menu 232–240 wide (system).
- **Props:** `{ items: MenuProps['items']; onSelect(id: string): void; preview?: ReactElement /* iOS only */; href?: string /* navigable row → Link.Menu */; disabled?: boolean; children: ReactElement; testID?: string }`
- **A11y:** the row gets `accessibilityActions` for every item (`{name: item.id, label: item.label}`) so VoiceOver/TalkBack reach
  them without long-press; the row's hint says "Long press for actions" (MD-28).
- **Haptic:** iOS system; Android `longPress` on open. **Boards:** MComponents Menus (iOS), MChats, MPaneChanges, MPaneFiles, MProjects,
  MAgents, MAutomations. **Seed:** replaces `ui/ContextMenu.tsx` (JS long-press menu).

### MP-29 AlertDialog

- **Web** P-32 AlertDialog · **Impl** N · **Folder** `ui/native/AlertDialog` · **Native backing** iOS: RN `Alert.alert` (UIAlertController)
  or Expo UI `ConfirmationDialog` for action-sheet style; Android: Compose `AlertDialog` (icon slot, title 22/600 in the system font,
  right-aligned text buttons) · **Phase** M4-05
- **Spec:** only for destructive or irreversible actions (discard file, kill terminal, delete, revoke device, unpair, storage cleanup,
  force delete agent). Title (question), body (what is lost), optional `impact` lines (MSetStorage "23 workspaces · 4.2 GB"), cancel +
  destructive action (role `destructive`, system red on iOS; `text-err`-coloured text button on Android via `colors`). Imperative API.
- **API:**
```ts
export interface AlertDialogOptions {
  title: string;
  message?: string;
  impact?: ReadonlyArray<string>;           // appended as lines to the message
  confirmLabel: string;                     // "Delete", "Kill", "Discard"
  cancelLabel?: string;                     // default "Cancel"
  destructive?: boolean;                    // default true
  icon?: IconConcept;                       // Android only (centred, e.g. 'trash')
  requireStepUp?: boolean;                  // run biometric step-up (services/auth/stepUp) after confirm, before resolve
}
export function confirm(options: AlertDialogOptions): Promise<boolean>;
```
- **A11y:** native. **Haptic:** `warning`/`success` only after the server confirms (caller's job).
- **Boards:** MComponents Confirmation, MAgentDelete, MSetStorage, MCodebase. **Seed:** replaces `ui/ActionSheet.tsx` `ConfirmSheet`
  (17 uses) and 14 scattered `Alert.alert` call sites.

### MP-30 Toast (+ undo)

- **Web** P-34 Toast · **Impl** J · **Folder** `ui/primitives/Toast` (component + `ToastHost` + `toast()` API) · **Phase** M4-06
- **iOS:** GlassSurface capsule h48 `rounded-toast` 24, pad 0 6 0 18, icon 18, text `subhead` 15, optional action button h38 `rounded-full`
  15/600 ("Undo"). **Android:** M3 snackbar h48 (grows to 2 lines) `rounded-toast` 8, **inverse** (`bg-fg text-surface`), text 14, action
  14/600 in `text-surface` (inverse; contrast against `bg-fg` is guaranteed by the token contrast rules).
- **Rules (MD-26, MD-58):** kinds `error` (6 s, icon `circle-x`), `background` (a background completion: "Run #248 succeeded ·
  Open"; 4 s), `undo` (5 s, action "Undo"; the destructive request is **deferred** until the toast expires or is dismissed, or sent
  immediately and reverted by the undo endpoint where the server offers one — the caller chooses via `commit` / `revert`). No success toasts.
  One visible at a time; a newer toast replaces the older (the older's `commit` still runs).
- **API:**
```ts
export type ToastKind = 'error' | 'background' | 'undo';
export interface ToastOptions {
  kind: ToastKind;
  message: string;
  action?: { label: string; onPress: () => void };   // 'background': Open; 'error': Retry
  undo?: { onUndo: () => void; commit?: () => Promise<void> };  // required for kind 'undo'
  durationMs?: number;
  testID?: string;
}
export function toast(options: ToastOptions): { dismiss(): void };
```
- **A11y:** announced (`announceForAccessibility` iOS; `accessibilityLiveRegion="polite"` Android); action focusable; the toast stays
  while a screen reader focuses it; swipe dismiss has the "Dismiss" `accessibilityAction`.
- **Boards:** MComponents "Chat archived · Undo". **Seed:** port `ui/Toast.tsx` provider + `useToast` (54 files) API.

### MP-31 Skeleton

- **Web** P-37 Skeleton · **Impl** J · **Folder** `ui/primitives/Skeleton` · **Phase** M4-03
- **Spec:** `bg-selected`, **no shimmer** (MComponents). Shapes: `circle` 20/24; `bar` (60 % × 10 r5, 36–38 % × 8 r4); presets
  `row` (circle + 2 bars, min-h per row kind), `list` (n rows in a ListSection), `card`, `transcript` (bubble + 3 bars).
- **Props:** `{ shape?: 'circle'|'bar'|'block'; width?: `${number}%` | number; height?: number; preset?: 'row'|'row-2'|'list'|'card'|'transcript'; count?: number; testID?: string }`
- **A11y:** container `accessibilityLabel="Loading"` + busy; children hidden. **Boards:** MComponents. **Seed:** port `ui/Skeleton.tsx`.

### MP-32 EmptyState

- **Web** P-41 EmptyState · **Impl** J · **Folder** `ui/primitives/EmptyState` · **Phase** M4-09
- **Spec:** centred column gap 6: icon 22 (iOS) / 24 (Android) `text-fg-3`; title `headline` 17/600 (iOS) / 16/600; description `subhead`
  15 / 14 `text-fg-3`, max-w 270, centred; one optional secondary Button (never primary). Copy comes from `EMPTY_STATE_COPY`
  (`packages/shared/src/ui-contract/copy.ts`) by key; custom copy only for states not in the table (then add it to shared, additively).
- **Props:** `{ copyKey?: EmptyStateKey; icon?: IconConcept; title?: string; description?: string; action?: { label: string; icon?: IconConcept; onPress(): void }; compact?: boolean /* inside cards, widgets preview */; testID?: string }`
- **Boards:** MComponents ("No runs yet"), MWidgets empty. **Seed:** port `ui/States.tsx` `EmptyState` (39 uses; 16 hand-rolled ones deleted).

### MP-33 ErrorState

- **Web** P-41 EmptyState (error variant) + C-29 Banner · **Impl** J · **Folder** `ui/primitives/ErrorState` · **Phase** M4-09
- **Spec:** same geometry as MP-32 with icon `warning` `text-err`; title "Couldn't load <thing>"; description = the mapped error
  (`describeTransport`-style human text from `services/auth/describeTransport`, never a raw stack); action "Retry" (`ghost`). `inline`
  form: a one-line row inside a list (icon + text + Retry). No `bg-err-bg` fill (MD-25).
- **Props:** `{ title: string; error: unknown; onRetry?(): void; inline?: boolean; testID?: string }` (the description is derived by `errorText(error)` in `ui/lib/format.ts`).
- **A11y:** role `alert` for `inline`. **Boards:** derived (D-32 recipes; boards draw none). **Seed:** port `ui/States.tsx` `ErrorState` (43 uses).

### MP-34 OfflineState

- **Web** C-29 Banner (connection) · **Impl** J · **Folder** `ui/primitives/OfflineState` · **Phase** M4-09
- **Spec:** two forms. `banner`: a strip under the header, h36, `bg-selected`, icon `server` 14 `text-fg-2`, "Offline · showing saved data"
  or "Reconnecting…" (Spinner) + "Retry" ghost; not tinted. `screen`: EmptyState geometry with `server` icon, "Can't reach <server name>",
  the address mono, "Retry" + "Switch server" (opens MB-20). Driven by `streamHealth` / `onlineManager` (MB-43 supplies it).
- **Props:** `{ form: 'banner'|'screen'; state: 'offline'|'reconnecting'|'unreachable'; serverName?: string; address?: string; onRetry?(): void; onSwitchServer?(): void; testID?: string }`
- **A11y:** banner `accessibilityLiveRegion="polite"`. **Boards:** derived (MSidebar footer states; 00 §5.11a). **Seed:** port
  `common/ConnectionStrip.tsx` behaviour.

### MP-35 PermissionState

- **Web** none · **Impl** J · **Folder** `ui/primitives/PermissionState` · **Phase** M4-09
- **Spec:** EmptyState geometry for an OS permission or a scope: `kind` `camera | microphone | notifications | biometrics | localNetwork |
  scope | app-lock`. Copy per kind (platform nouns from `ui/platform/nouns.ts`: Face ID / fingerprint, "This iPhone" / "This phone").
  Actions: `denied` → "Open Settings" (`Linking.openSettings()`); `undetermined` → "Allow"; `scope` → "Request access" (opens MB-38);
  `app-lock` → "Unlock" (biometric) — the lock overlay (`testID="app-lock"`).
- **Props:** `{ kind: PermissionKind; status: 'undetermined'|'denied'|'restricted'|'missing-scope'|'locked'; scope?: string; onRequest?(): void; onOpenSettings?(): void; testID?: string }`
- **Boards:** derived (MPairing camera denied, MSetNotifications, MSetAppLock). **Seed:** port `ui/States.tsx` `LockedState`,
  `common/FeatureLocked.tsx`, `chat/panes/LockedPane.tsx`, `auth/AppLock.tsx` overlay view.

### MP-36 Separator

- **Web** P-35 Separator · **Impl** J · **Folder** `ui/primitives/Separator` · **Phase** M4-03
- **Spec:** 1px (`StyleSheet.hairlineWidth` on iOS) `bg-line-soft`; `inset` start 56 (Android list icon inset) or 16; `vertical`;
  `band` (iOS menu group band 8 `bg-hover`, JS menus only).
- **Props:** `{ orientation?: 'horizontal'|'vertical'; inset?: 0|16|56; variant?: 'line'|'band' }`. **Seed:** port `primitives.tsx` `Divider`.

### MP-37 AgentGlyph

- **Web** P-11 AgentGlyph · **Impl** J · **Folder** `ui/primitives/AgentGlyph` · **Phase** M4-03
- **Spec:** icon concept `agents` (bot) 12/14/16/20 `text-fg-3` or `text-fg-2`, no tile, optional trailing name (600) and model
  (`text-fg-3`); `kind: 'agent' | 'model' | 'team' | 'you'`: model → no icon (the model name is the identity); team → `users` icon +
  "Orchestrator · Bug Fixer, Code Reviewer, Test Writer" truncated; you → `user` icon + "You". **Never initials** (principle 8).
- **Props:** `{ kind: 'agent'|'model'|'team'|'you'; name: string; model?: string; members?: string[]; size?: 12|14|16|20; locked?: boolean; testID?: string }`
- **Boards:** MComponents "Agent label vs model only", MAgentPicker, MChats rows. **Seed:** new (replaces `ListItem` status avatar).

### MP-38 GlassSurface

- **Web** none · **Impl** P · **Folder** `ui/native/GlassSurface` · **Native backing** iOS `expo-glass-effect` `GlassView`
  (`glassEffectStyle: 'regular'`, `isInteractive` for buttons, no `tintColor`: neutral chrome) and `GlassContainer` (`spacing` 8) for merged
  groups · **Phase** M4-08
- **Spec:** **iOS floating chrome only** (A.4): header buttons and capsules not drawn by the native header, composer, NewAction,
  ScrollToLatest, toast, step-detail floating toolbar, workflow-graph zoom column. Never cards, rows, transcript, diffs, drawer or pane
  content (`02-design-system.md` §8.1). Availability is `useGlass()` (§1.1). Fallback (Reduce Transparency, `!isLiquidGlassAvailable()`,
  iOS < 26, Android, Jest): opaque `bg-overlay` + 1px `border-line` + `shadow-float` (MD-72). Known issue: never animate `opacity` on the view or its parents (kills the effect); animate `glassEffectStyle` instead.
- **Props** (`02-design-system.md` §8.2 `GlassSurfaceProps`): `{ radiusStep: 'composer'|'new'|'toast'|'full' /* radius from tokens, never a number */; interactive?: boolean; group?: string /* GlassContainer id to merge neighbours */; children; className?: string /* layout and padding only */; testID?: string }`
- **Seed:** port `ui/GlassSurface.ios.tsx` + `GlassSurface.tsx` (Reduce Transparency handling).

### MP-39 KbdHint

- **Web** P-04 Kbd + C-27 KbdHintRow · **Impl** J · **Folder** `ui/primitives/KbdHint` · **Phase** M4-03
- **Spec:** iPad / Android tablet with a hardware keyboard attached only (`useHardwareKeyboard()` from `ui/platform`). h18 min-w 18 pad 0 4
  r4 `bg-sunken` 1px `border-line`, mono 12 `text-fg-3`. Chords come from `formatBindingText(binding, host)` with the mobile host
  mapping (`⌘` on iPad, `Ctrl` on Android). Shown in palette rows, the composer (↵ Send) and menu subtitles. Hidden otherwise.
- **Props:** `{ binding: string /* e.g. 'Mod+K' */; testID?: string }`. **Boards:** none drawn (MTabletIOS notes). **Seed:** new.

### MP-40 PairingCodeInput

- **Web** C-28 PairingCodeInput · **Impl** J · **Folder** `ui/primitives/PairingCodeInput` · **Phase** M4-04
- **Spec (MD-35):** **12 characters in 3 groups of 4** (not the board's 6/7), groups separated by a 12-wide "–" `text-fg-3`. The board's
  44×52 (iOS) / 46×56 (Android) cells do not fit 12 across a 402 pt phone, so cell width = `(available − 2 × 12 − 9 × 6) / 12` clamped to
  22–32, height 52 (iOS) / 56 (Android); iOS `bg-raised` radius 8; Android outlined 1px `border-line-strong` radius 6; mono 22/500 (iOS) /
  20/500 (Android), uppercase. Input is normalised (uppercase; spaces and dashes stripped) before it reaches `value`. One hidden `TextInput` owns input (`textContentType="oneTimeCode"`,
  `autoComplete="one-time-code"`), paste fills all cells, backspace moves back. Error: every cell 2px `border-err` + message
  "That code expired — ask for a new one" (from the server error). A `pair` deep link pre-fills and **never auto-submits** (MD-34).
- **Props:** `{ value: string; onChangeText(v: string): void; length?: 12; groups?: 3; error?: string; disabled?: boolean; onComplete?(v: string): void /* focuses Connect; does not submit */; testID?: string }`
- **A11y:** one element: role `none` + label "Pairing code, 12 characters", value spoken grouped ("A B C D, …"); error announced.
- **Boards:** MPairing, MSetPairDevice (display form uses the same cells read-only with `readOnly`). **Seed:** new (logic from `auth/pairingFailure.ts`).

### MP-41 Gauge

- **Web** P-39 Gauge · **Impl** J · **Folder** `ui/primitives/Gauge` · **Native backing** react-native-svg · **Phase** M4-03
- **Spec:** ring 32 (row) / 20 (chip), 4px stroke; track `line-strong`, arc `fg-2` (< 80 %), `warn` (80–95 %), `err` (> 95 %) — the one
  place a non-status threshold uses warn/err (web B-13 rule). Centre empty; value shown by the parent row.
- **Props:** `{ value: number /*0..1*/; size?: 20|32; label: string; testID?: string }` → role `progressbar` with value.
- **Boards:** MModelPicker context row. **Seed:** port `ui/ProgressRing.tsx` `ProgressRing` (1 use) maths.

### MP-42 CodeText (InlineCode, CodeBlock)

- **Web** P-44 InlineCode + C-23 CodeBlock · **Impl** J · **Folder** `ui/primitives/CodeText` · **Phase** M4-03
- **Spec:** `inline`: mono 13 (in 16 prose) `bg-selected` pad 0 4 r4. `block`: mono 13/1.5 (iOS) / 13 (Android), pad 10 12, `rounded-code`
  12/8, `bg-sunken`, 1px `border-line-soft`, horizontally scrollable (blocks the panel pan) with a `wrap` toggle, `selectable`,
  optional header (language, Copy button 36/40 with hit 44/48), optional token colouring via `ui/lib/highlight.ts` (bounded: > 2,000
  lines or > 200 KB renders plain). `tone="err"` = `text-err` excerpt (inline failure).
- **Props:** `{ code: string; form: 'inline'|'block'; language?: string; wrap?: boolean; onToggleWrap?(): void; copyable?: boolean; tone?: 'fg'|'err'; maxLines?: number; testID?: string }`
- **A11y:** block `accessibilityRole="text"`, label "Code, <language>, <n> lines"; Copy button "Copy code". **Boards:** Main (command),
  MChatStepDetail, MChatToolsExpanded. **Seed:** port `markdown/CodeBlock.tsx`, `codeWrapStore.ts`, `syntaxColors.ts`.

### MP-43 NumberField

- **Web** P-20 NumberField · **Impl** P · **Folder** `ui/primitives/NumberField` · **Phase** M4-04
- **iOS:** joined −|+ pill 92×32 `rounded-seg` 9 `bg-selected`, value to its start (mono). **Android:** two 40 outlined circular
  IconButtons with the value between (mono 16), hit 48.
- **Props:** `{ value: number; onValueChange(v: number): void; min?: number; max?: number; step?: number; label: string; format?: (v:number)=>string; disabled?: boolean; testID?: string }`
- **A11y:** role `adjustable` with increment/decrement actions. **Haptic:** `selection`. **Boards:** MSetStorage, MStagePolicy, MAgentEdit2
  (max turns), MAutomationCreate4 (concurrency). **Seed:** new.

### MP-44 Link

- **Web** P-42 Link · **Impl** J · **Folder** `ui/primitives/Link` · **Phase** M4-03
- **Spec:** inline text link `text-fg` underline (1px, offset 2) or `standalone` ("See all ›", "Breakdown ›", "View in run") 14/500 `text-fg-2`
  with optional trailing `chevron-right` 14. `external` → `external-link` 12 and opens `expo-web-browser`. Internal links use router
  `href` (typed).
- **Props:** `{ label: string; href?: Href; onPress?(): void; external?: boolean; standalone?: boolean; testID?: string }`
- **A11y:** role `link`. **Boards:** MHome, MModelPicker, MChatWorkflowRun. **Seed:** new.

### MP-45 Callout (+ Banner)

- **Web** P-40 Callout + C-29 Banner · **Impl** J · **Folder** `ui/primitives/Callout` · **Phase** M4-09
- **Spec:** card radius 16 (iOS) / 12 (Android), pad 12 14, icon 16 + title 600 + body `footnote` + optional action (Link or ghost Button).
  Tones: `info` (`bg-selected`, `info` icon), `warn` (`bg-warn-bg`, `warning` icon `text-warn`), `err` (`bg-err-bg`), `ok` (`bg-ok-bg`).
  Tinted callouts are allowed only for **state** messages (MD-25: they describe a status — "Process exited with code 1", "Notifications
  are off", "Sensitive scope") — never for decoration. `banner` form = one line h40.
- **Props:** `{ tone: 'info'|'warn'|'err'|'ok'; title: string; body?: string; action?: { label: string; onPress(): void }; form?: 'card'|'banner'; testID?: string }`
- **A11y:** `err`/`warn` → role `alert` when it appears after load. **Boards:** MChatStepDetail (error callout), MSetNotifications banner,
  MScopeRequest. **Seed:** new.

### MP-46 Card

- **Web** P-48 Card · **Impl** J · **Folder** `ui/primitives/Card` · **Phase** M4-03
- **Spec:** `bg-raised` + `rounded-card` (14/12) or `rounded-group` (22/16), optional 1px `border-line-soft` (`outlined`, the Android default
  for composites per boards-projects-agents-settings A.4), pad 12 14 / 12 16; `pressable` wraps MP-03. No shadows (only floating layers
  use `shadow-pop`).
- **Props:** `{ radius?: 'card'|'group'|'gate'|'tile'; outlined?: boolean; padding?: 'none'|'sm'|'md'; onPress?(): void; accessibilityLabel?: string; children; testID?: string }`
- **Seed:** port `primitives.tsx` `Card`; `Surface` (dead) deleted.

### MP-47 Collapsible

- **Web** P-45 Collapsible · **Impl** J · **Folder** `ui/primitives/Collapsible` · **Phase** M4-03
- **Spec:** header row (pressable, chevron-down ↔ chevron-up 14) + animated body (height via Reanimated layout transition, cross-fade
  under Reduce Motion). Used by settings inline expansion (provider card, MCP setup, skill description) and step groups.
- **Props:** `{ expanded?: boolean; defaultExpanded?: boolean; onExpandedChange?(v: boolean): void; header: ReactNode; children: ReactNode; accessibilityLabel: string; testID?: string }`
- **A11y:** header role `button`, `expanded` state. **Seed:** port `ui/Collapsible.tsx`.

### MP-48 ChoiceCard

- **Web** P-24 RadioCard (+ C-26 ChoiceCardGrid) · **Impl** J · **Folder** `ui/primitives/ChoiceCard` · **Phase** M4-04
- **Spec:** a selectable card: icon 20, title 16/600, description `footnote`, selection indicator per MD-49 (iOS ✓ trailing / Android radio
  leading), selected `bg-selected` + 1px `border-line-strong`. Radius iOS 18 / Android 12 (MAutomationCreate2). Stacks vertically on
  phones, 2–3 columns at `medium`+.
- **Props:** `{ value: string; selected: boolean; title: string; description?: string; icon?: IconConcept; disabled?: boolean; locked?: string; onPress(): void; testID?: string }`
  (grouped by MP-21 RadioGroup).
- **Boards:** MAutomationCreate2 (trigger kind), MAgentNew (start from), MWorkflowNew (source), MNewChat ("Who works on this" uses MP-23
  instead). **Seed:** new.

### MP-49 Popover

- **Web** P-29 Popover · **Impl** J · **Folder** `ui/primitives/Popover` · **Phase** M4-06
- **Spec:** a JS floating panel anchored above or below a trigger, used **only** where a native Menu cannot host the content: the slash /
  mention suggestion popover above the composer (rich rows, keyboard-aware). iOS: GlassSurface `rounded` 24, `shadow-pop`. Android:
  `bg-overlay` `rounded` 16 `shadow-pop`. Keyboard-aware placement (react-native-keyboard-controller), max-h 50 % of the space above the
  keyboard, tap outside closes, Escape closes, `data`-like overlay flag `isOverlay` so ML-05 does not treat taps as scrim taps.
- **Props:** `{ open: boolean; onOpenChange(v: boolean): void; anchor: 'composer' | RefObject<View>; placement?: 'top'|'bottom'; children; accessibilityLabel: string; testID?: string }`
- **A11y:** role `menu`-like list with `accessibilityViewIsModal=false` (typing continues); items role `menuitem`; announces result count.
- **Seed:** new (replaces `chat/composer/SuggestionStrip.tsx` presentation).

### MP-50 QrCode

- **Web** none (web renders its own QR in pairing) · **Impl** J · **Folder** `ui/primitives/QrCode` · **Native backing** react-native-svg · **Phase** M4-09
- **Spec:** renders a payload as an SVG matrix in `fg` on `surface` (always dark-on-light quiet zone for scanners: uses the light
  theme's literals regardless of mode, the one sanctioned exception, via `useThemeColors('light')`). Size 200 default.
- **Props:** `{ value: string; size?: number; label: string; testID?: string }`. **Boards:** MSetPairDevice. **Seed:** port
  `devices/QrCode.tsx` + `devices/qrMatrix.ts` + `qrcode-core.d.ts`.

### MP-51 DiffStat

- **Web** C-33 DiffStat · **Impl** J · **Folder** `ui/primitives/DiffStat` · **Phase** M4-03
- **Spec:** mono 12: `+N` `text-ok`, space, `−N` (U+2212) `text-err`; "—" `text-fg-3` when unknown (D-36: never 0 for unknown);
  optional " · N files" `text-fg-3`.
- **Props:** `{ additions?: number; deletions?: number; files?: number; testID?: string }` → label "14 lines added, 6 removed, 2 files".
- **Boards:** MChats rows, MPaneOpen, MChatNoAgent strip. **Seed:** new.

### MP-52 BrandMark

- **Web** `components/shared/VendorIcons.tsx` → web `ui/icons` · **Impl** J · **Folder** `ui/primitives/BrandMark` · **Phase** M4-02
- **Spec:** the GeneratorAI app glyph (22/26/36; drawer header, pairing, widgets preview) and vendor marks (provider logos for
  `HARNESS_PROVIDERS` ids, GitHub). SVG paths from the existing files; colours from tokens (`fg`), never brand hex in-app.
- **Props:** `{ mark: 'app' | 'github' | HarnessProviderId; size?: 16|20|22|26|36; label?: string }`. **Seed:** port `brand/BrandMark.tsx`,
  `brand/VendorIcons.tsx`.

**Web primitives with no mobile twin** (do not build): P-10 Avatar (no initials, principle 8), P-18 Combobox and P-19 Autocomplete
(→ Select `searchable` sheet), P-26 Tabs (→ ML-08 PaneTabStrip / MP-23), P-27 NavItem (→ ML-06 Drawer item), P-28 Tooltip (touch has
no hover; iPad pointer shows the accessibility label via system), P-31 Dialog (→ ML-10 Sheet / ML-11 FullScreenEditor), P-33 Sheet
(→ ML-10), P-36 ScrollArea (→ ML-01 Screen), P-43 Table (→ ML-19 KeyValueList / lists), P-47 Toolbar (→ ML-27).

---
## 3. Layout and shell (ML-01 … ML-30)

Same entry format. Phases are the `07-phases.md` task ids: kit layout parts in M4-06…M4-08, shell parts in M5-02…M5-06. Wiring (router,
stores, queries) never lives in these components: the connected shell is `features/shell/` (§6), which composes ML parts with blocks.

### ML-01 Screen

- **Web** T-01…T-05 templates (slot discipline) · **Impl** J · **Folder** `ui/layout/Screen` · **Phase** M4-08
- **Spec:** the root of every screen. Safe areas (edge-to-edge on both OSes; bottom inset paid once), background `bg-surface`
  (or `bg-ground` for grouped iOS settings screens: `background="grouped"`), scroll container (`scroll: 'none' | 'scroll' | 'list'`
  — `list` hands the scroll to a Legend List child), keyboard handling (`KeyboardAwareScrollView` for forms; the chat uses its own),
  large-title collapse for top-level screens (iOS: native header `headerLargeTitle`, see ML-02; Android: Home only, the JS medium flexible app bar
  collapse driven by the scroll offset shared value, MD-94), pull-to-refresh (`onRefresh`: iOS `RefreshControl`, Android the same with
  `colors` from tokens; never on the transcript), content inset for a NewAction or StickyActionBar (`bottomAccessory` height is
  added to `contentInset` so the last row is never covered — MHome issue), max reading width 720 on `expanded` width (centred),
  and the `PrimaryActionRegistry` (MP-04 rule).
- **Props:**
```ts
export interface ScreenProps {
  header: ReactElement<HeaderProps>;                 // ML-02 (rendered into the native header on iOS)
  statusLine?: ReactElement;                         // ML-04
  banner?: ReactElement;                             // MP-34 banner, MP-45 banner
  scroll?: 'none' | 'scroll' | 'list';
  background?: 'plain' | 'grouped';
  onRefresh?: () => Promise<void>;
  bottomAccessory?: ReactElement;                    // NewAction, StickyActionBar, Composer, BottomToolbar
  keyboard?: 'none' | 'form' | 'chat';
  state?: { kind: 'loading'; skeleton?: ReactElement } | { kind: 'error'; error: unknown; onRetry(): void }
        | { kind: 'empty'; empty: ReactElement } | { kind: 'offline' } | { kind: 'ready' };
  children: ReactNode;
  testID?: string;
}
```
- **A11y:** the header title is the screen's first focus target on mount; `state` changes announce ("Loaded", error text).
- **Boards:** every screen board. **Seed:** port `ui/Screen.tsx` (UI-thread large-title collapse for the Android path; `ScreenHeader`
  replaced by ML-02), `ui/windowInsets.tsx`, `ui/usePullToRefresh.ts`, `navigation/scrollToTop.ts`.

### ML-02 Header

- **Web** C-01 PageHeader · **Impl** P · **Folder** `ui/native/router/Header` (MD-86; the Android bar body is `ui/layout/TopAppBar`) ·
  **Native backing** iOS: native-stack header via
  `Stack.Screen options` + `Stack.Toolbar` (glass items are automatic on the iOS 27 SDK) + `headerTitle` custom title view; Android:
  JS M3 top app bar (neither Expo UI nor react-native-screens exposes M3 medium/large) · **Phase** M4-08 (wired in M5-04)
- **Roles (MD-18):**

  | Role | iOS | Android |
  |---|---|---|
  | `top` (module root) | leading glass 44 sidebar toggle (`menu-button`); trailing glass 44 buttons or one glass capsule (`gcap` h44 r22 pad 0 4 gap 2 holding 40 buttons), ≤ 3; `headerLargeTitle` 32/600 below the bar, collapses to a centred `headline` 17/600; transparent bar, scroll-edge effect by the system | `h-bar` 64: toggle 48; title in the bar, Title L 22/600 (`text-heading`), start-aligned (MD-18, MD-94); **Home only**: `largeTitle` 28/600 below the bar, collapsing into the bar as Title L; bar turns `bg-raised` when content scrolls under; ≤ 2 icon buttons + ⋮ overflow |
  | `detail` (chat included) | glass back chevron 22 in a 44 circle (`chat-back` on the chat); custom title view: Breadcrumb (ML-03) 12 `text-fg-3` over `detailTitle` 16/600, centred, both lines truncating; trailing glass capsule | ← arrow 24 in a 48 button; title block start-aligned: Breadcrumb 12 over `detailTitle` 18/600; trailing icon buttons ≤ 2 + ⋮ |
  | `workspace` (chat and run) | `detail` + trailing capsule [pane toggle 40 with MP-09 bubble (`pane-toggle`), ⋯ 40] | `detail` + pane toggle 48 with bubble + ⋮ 48 |
  | `modal` (full-screen editors) | glass ✕ "Cancel" start, centred `headline` 17/600 title, trailing text action (Save / Create; the `prominent` toolbar item style) | ✕ 48 + Title L 22/600 start + trailing **text** button 14/600 (MD-85; never filled) |
  | `tablet` (≥ 600) | h60, toggles become "Hide sidebar" / "Hide workspace pane" with `selected` state | h64, "Hide navigation drawer" |

- **Pane toggle label:** "Open workspace pane, N changes" / "Hide workspace pane, N changes"; count = changed files; `badge.dot='warn'`
  when Plan or Computer needs you (MD-23).
- **Props:**
```ts
export type HeaderRole = 'top' | 'detail' | 'workspace' | 'modal';
export interface BreadcrumbSegment { label: string; onPress: () => void; accessibilityLabel?: string } // = ML-03 segments
export interface HeaderAction {
  id: string;                            // testID `header-${id}` unless testID is set
  icon: IconConcept;                     // concept name from packages/design-tokens/src/icons.ts
  label: string;                         // accessibility label; also the overflow-menu label
  onPress?: () => void;
  menu?: MenuProps['items'];             // renders as a Menu trigger (⋯ / ⋮)
  selected?: boolean;                    // tablet toggles
  badge?: IconButtonProps['badge'];      // neutral count badge
  destructive?: boolean;                 // overflow only (MD-22)
  testID?: string;
}
export interface HeaderProps {
  role: HeaderRole;
  title: string;
  breadcrumb?: ReadonlyArray<BreadcrumbSegment>; // 'detail' | 'workspace'; the last segment is the parent
  status?: StatusBadgeProps;             // 'detail' | 'workspace'; rendered as ML-04 StatusLine under the header
  subtitle?: ReactNode;                  // Home: "Wed, Sep 23 · ● Connected local:3100"
  actions?: ReadonlyArray<HeaderAction>; // trailing, in order; overflow beyond the platform max goes into the ⋯/⋮ menu
  onSidebarToggle?: () => void;          // role 'top' (and tablet)
  sidebarToggleState?: 'drawer' | 'shown' | 'hidden'; // 'drawer' on phones
  onBack?: () => void;                   // set by useHeaderNav; role 'detail' | 'workspace'
  paneToggle?: { open: boolean; count: number; attention: boolean; onPress(): void };  // role 'workspace'
  modal?: { cancelLabel?: string; onCancel(): void; primary?: { label: string; onPress(): void; disabled?: boolean; loading?: boolean } }; // text action (MD-85)
  largeTitle?: boolean;                  // default true for role 'top' on iOS; on Android only Home (MD-94)
  scroll?: SharedValue<number>;          // content offset: Android tonal state; iOS large title is native
  testID?: string;
}
```
- **A11y:** back "Back to <previous title>"; sidebar toggle "Open sidebar" / "Hide sidebar"; the title is a header; iOS title view is one
  element "Chats, Payments service, Fix flaky checkout test" with breadcrumb segments reachable as `accessibilityActions`
  ("Go to Chats"). Android bar buttons ≥ 48.
- **Boards:** MComponents Headers, MFoundations header rules, MHome/MHomeMore (collapse), every detail board, MTabletIOS/MTabletAndroid.
- **Seed:** replaces `navigation/StackHeader.tsx`, `navigation/TabHeaderActions.tsx`, `navigation/shell/MenuButton.tsx`,
  `chat/ChatHeader.tsx`, `ui/Screen.tsx` `ScreenHeader`, `ui/SettingsButton.tsx`, `workbench/WorkbenchButton.tsx` (pane toggle).

### ML-03 Breadcrumb

- **Web** C-02 Breadcrumb · **Impl** J · **Folder** `ui/layout/Breadcrumb` · **Phase** M4-08
- **Spec:** `caption` 12 `text-fg-3`, `chevron-right` 12 separators, gap 4; every segment tappable (pops to that level: `router.dismissTo`);
  long paths collapse the middle to "…" (which opens a Menu of the hidden levels). A segment that is not a real ancestor (e.g. "Step 4
  of 6") is rendered as plain text, not tappable (MChatStepDetail issue). Max 1 line.
- **Props:** `{ segments: ReadonlyArray<{ label: string; href?: Href; onPress?(): void }>; align?: 'center'|'start'; testID?: string }`
- **A11y:** each tappable segment role `link` in a list; inside the iOS title view they are exposed as actions (ML-02).
- **Boards:** every detail board. **Seed:** new (logic from `navigation/backFallback.ts`).

### ML-04 StatusLine

- **Web** part of C-01/C-03 (status next to the title) · **Impl** J · **Folder** `ui/layout/StatusLine` · **Phase** M4-08
- **Spec:** one StatusBadge md (+ optional mono meta "v7 · last run #248", " · daily 02:00") directly under the header; iOS centred, pad 2
  16 8; Android start-aligned at 56 (aligned with the title). Never tints the bar (MD-25). Ticking elapsed through MP-07.
- **Props:** `{ status: StatusBadgeProps; meta?: ReadonlyArray<string | ReactElement>; testID?: string }`
- **A11y:** `accessibilityLiveRegion="polite"` so a change to Needs you is announced. **Boards:** Main, MChatRunning, MScopeRequest,
  MWorkflowRun. **Seed:** new.

### ML-05 SidePanel

- **Web** C-20 SplitPane (the docked form) + S-09 NarrowDockSheet (the overlay form) · **Impl** J (Reanimated + RNGH 3 hooks) ·
  **Folder** `ui/layout/SidePanel` · **Phase** M5-02 / M5-03
- **Spec (MD-18, MD-19, MD-24):** one component for both edges: `side: 'start' | 'end'` (drawer = start, pane = end). Presentations:
  `overlay` (over `bg-scrim`, the content behind never shrinks), `persistent` (inline column; sidebar ≥ 600, pane ≥ 840), `fullscreen`
  (pane only: 100 % width over the content with its own header). Width: `w-drawer` / `w-pane` capped at 79 % (iOS) or 82 % (Android) / 89 % of the window on
  phones; `w-sidebar` / `w-dock` when persistent. Surface: iOS drawer `bg-surface` + 1px `border-line-soft` end edge,
  `rounded-panel` on the outer corners, shadow 12 0 40 at 35 % (via `shadow-pop`); iPad persistent = inset floating card (margin 8,
  `rounded-group` 22, `bg-raised`, 1px `border-line-soft`); iOS pane `bg-surface`; Android drawer and pane `bg-overlay` (tonal), `rounded-panel`
  16, no border; Android tablet persistent = edge-attached (`bg-raised` drawer, `bg-overlay` pane, 1px `border-line-soft` separator).
- **Gestures:** open by button (both OSes); iOS drawer also by left-edge swipe **only when `edgeOpenEnabled`** (root screens; the shell
  passes `useGesturePolicy().drawerEdge`), follows the finger, snaps open past 40 %; close by dragging inside the panel toward its edge,
  scrim tap, Back/Escape (`BackHandler` / `onAccessibilityEscape`); no edge gesture opens the pane; horizontal scrollers inside the
  content block the pan (`simultaneousWithExternalGesture` false, `failOffsetY`); edge-open disabled while a `data-gai-keys="own"`
  equivalent owner (terminal, WebView) is focused (MD-19). Spring `panel`; Reduce Motion → fade.
- **Never remounts content** when `presentation` changes (MD-24): the panel's children are mounted once in a stable tree; only the
  container's style/animation changes. A Jest test asserts child identity across `overlay → persistent → overlay`.
- **Props:**
```ts
export interface SidePanelProps {
  side: 'start' | 'end';
  open: boolean;                               // ignored when presentation === 'persistent'
  onOpenChange: (open: boolean) => void;
  presentation: 'overlay' | 'persistent' | 'fullscreen';
  edgeOpenEnabled?: boolean;                   // start side, iOS root screens only (policy decides)
  width?: number;                              // override (from geometry by default)
  accessibilityLabel: string;                  // "Sidebar" / "Workspace pane"
  children: ReactNode;
  testID?: string;                             // 'drawer' / 'pane'
}
```
- **A11y:** overlay → focus trap (§1.6.7), scrim is a button "Close <label>"; opening moves focus to the panel's first element; closing
  returns focus to the toggle. **Haptic:** none (MGestures: spring settle only; `02-design-system.md` §7.1).
- **Boards:** MSidebar, MPaneOpen, MGestures (edge swipe, swipe pane closed), MTabletIOS, MTabletAndroid.
- **Seed:** port `ui/SidePanel.tsx` + `ui/sidePanelMath.ts` (move to RNGH 3 hook API; drop the unused `push` mode).

### ML-06 Drawer

- **Web** S-02 Sidebar · **Impl** J · **Folder** `ui/layout/Drawer` (frame + `DrawerNavItem` + `DrawerSection` + `DrawerFooter`) · **Phase** M5-02
- **Spec:** the sidebar content frame, presentational; slots filled by the shell:
  1. `header` h52, pad 0 12 0 20: ServerSwitcher trigger (MB-20 `trigger` form: BrandMark 26, server name 16/600, "This computer" 12 `text-fg-3`,
     `chevrons-up-down` 14; h44) + New chat IconButton (iOS 44 `bordered`; Android 48 — the board's 44 is raised to 48).
  2. `search` pad 4 16 10: SearchInput `asButton` (`drawer-search`) → opens the palette.
  3. `nav`: `DrawerNavItem` × `NAV_DESTINATIONS` (7, D-22 order), gap 2, pad 0 12. iOS `.dnav`: min-h 44, pad 0 12, `rounded` 12, icon 20,
     16/500 `text-fg-2`; selected `bg-selected text-fg`. Android `.dnav-a`: min-h 48, pad 0 16, `rounded-full` (pill 24), 15/500. testID
     `drawer-<id>`.
  4. `live`: two `DrawerSection`s from MB-19 AttentionList `variant="drawer"`: label `.dsec` h30, 13/600 `text-fg-3` + Count
     (`warn` for Needs you, `drawer-inbox` on that header). Rows min-h 44 (iOS) / 48 (Android) (the board's 40/36 raised, MD-59).
  5. spacer; 6. `footer` min-h 52, top 1px `border-line-soft`: MB-43 ConnectionStatus (dot 7, "Connected" 14 `text-fg-2`, mono 12 address)
     + Settings IconButton (`drawer-settings`).
- **Variants:** phone modal (inside ML-05 overlay), iPad persistent inset card 312, Android tablet permanent 300 (`bg-raised`; nav items
  stay 48 — the tablet board's 44 is raised).
- **States:** selected destination; Needs you / Running empty → the section is hidden (no empty copy in the drawer); overflow > 5 rows →
  "Show all (N)" row (Needs you → `/needs-you`; Running → Home's Running section); disconnected / reconnecting footer; long server name truncates.
- **Props:**
```ts
export interface DrawerProps {
  header: ReactNode; search: ReactNode; nav: ReactNode; live?: ReactNode; footer: ReactNode;
  variant: 'modal' | 'persistent';
}
export interface DrawerNavItemProps {
  destination: NavDestinationId; label: string; icon: IconConcept; selected: boolean; onPress(): void; count?: number;
}
```
- **A11y:** nav items role `button` with `selected`; the nav list is a landmark-like group "Navigation".
- **Boards:** MComponents "Sidebar drawer", MSidebar, MSidebarChats, MTabletIOS, MTabletAndroid.
- **Seed:** port `navigation/shell/AppDrawer.tsx` (266), `navigation/shell/sections.ts` → replaced by `NAV_DESTINATIONS`, `shellStore.ts` kept
  in `features/shell/`.

### ML-07 PaneShell

- **Web** S-08 DockFrame · **Impl** J · **Folder** `ui/layout/PaneShell` · **Phase** M5-03
- **Spec:** the workspace pane frame inside ML-05 (`side="end"`). Header `h-panel-bar` 52 (MD-54): iOS pad 0 8 0 20, title "Workspace" 16/600 +
  subtitle (chat or run title) 12 `text-fg-3` truncated; Android title 18/600 + 12 subtitle; trailing IconButtons (IconButton `md`, `size-icon-button` 44 / 48,
  MD-54): "Open full screen" (`maximize`) ↔ "Exit full screen" (`minimize`), "Close pane" (`x`). In `fullscreen` the header gains a
  leading "Back to chat" (iOS `chevron-left` / Android `arrow-left`) and keeps the tab strip. Below: ML-08 tab strip, then the tab's
  optional toolbar slot (40–48), then the body, then an optional footer slot (e.g. Changes commit footer).
- **Nested navigation in a tab** (Tasks → Task detail): the tab body hosts a tiny in-pane stack (`paneStack` state in the dock store); Back
  pops the tab stack first, then closes the pane (MD-23). Pushed full screens (Diff, File preview) leave the pane chrome and are real
  router pushes over the chat (their breadcrumb starts with the tab: "Changes › src › cart").
- **Props:**
```ts
export interface PaneShellProps {
  title: string;                   // "Workspace"
  subtitle?: string;               // chat / run title
  mode: 'overlay' | 'fullscreen' | 'docked';
  onToggleFullscreen: () => void;
  onClose: () => void;
  onBackToChat?: () => void;       // fullscreen only
  tabs: ReactElement<PaneTabStripProps>;
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;             // the active tab body (all visited tab bodies stay mounted; MD-24)
  testID?: string;                 // 'pane'
}
```
- **A11y:** the pane is a modal region when overlay (focus trap); header title is a header. **Boards:** MPaneOpen, MPaneChanges (full screen),
  MPaneTabsOverview, MComponents "Right pane shell". **Seed:** port `workbench/WorkbenchPanel.tsx`, `workbench/WorkbenchSheet.tsx` behaviour
  (delete both).

### ML-08 PaneTabStrip

- **Web** C-19 DockTabStrip · **Impl** P · **Folder** `ui/layout/PaneTabStrip` · **Phase** M5-03
- **iOS:** pills `ptab-i`: h32, pad 0 12, `rounded-control-sm` 16, icon 16 + label 14/500 `text-fg-2`, gap 6; selected `bg-selected text-fg`; the `Pressable` frame is 44 tall
  (the 32 pill is drawn inside it, MD-91).
- **Android:** underline tabs `ptab-a`: h48, pad 0 12, 14/500; selected `text-fg` + 3px bottom indicator `bg-fg`.
- **Both:** horizontal scroll with an 88 % end fade mask; the active tab auto-scrolls into view; counts MP-09 inline mono 12 `text-fg-3`
  (Changes count, Tasks count); `attention` → MP-09 `dot` warn (Plan to approve, Computer consent). Tap-only switching, no body swipe
  (MD-23). Tabs from `DOCK_PINNED_TABS` always, `DOCK_CONDITIONAL_TABS` when they apply (the block decides; the strip renders what it gets).
  `instanceChips` variant: the same component renders Terminal instances and Browser pages as chips inside their tab (MD-23; iOS chips
  `rounded-control-sm` 16 h32, Android r8 h32; closable chips show ✕ with label "Close <name>"; trailing "+" IconButton sm "New terminal" /
  "New page" hidden when `DOCK_TAB_CAPS[type]` is reached).
- **Props:**
```ts
export interface PaneTab { id: string; type: DockTabType; label: string; icon: IconConcept; count?: number; attention?: boolean; closable?: boolean }
export interface PaneTabStripProps {
  tabs: ReadonlyArray<PaneTab>;
  active: string;
  onSelect: (id: string) => void;
  variant?: 'tabs' | 'instanceChips';
  onClose?: (id: string) => void;          // instanceChips
  onAdd?: () => void;                       // instanceChips; hidden at cap
  addLabel?: string;
  accessibilityLabel: string;               // "Workspace tabs" / "Terminals"
  testID?: string;                          // tabs get `pane-tab-<type>`; chips `pane-instance-<id>`
}
```
- **A11y:** role `tablist`, items `tab` + `selected`; label includes the count and "needs you" ("Plan, needs you"). **Haptic:** `selection`.
- **Boards:** MPaneOpen, MPaneTabsOverview, MPaneTerminal (instance chips), MPaneBrowser (page chips). **Seed:** new (replaces
  `workbench/toolIcons.tsx`, `terminal/TerminalTabs.tsx` chip strip).

### ML-09 NewAction

- **Web** none (web uses a header button) · **Impl** P · **Folder** `ui/layout/NewAction` · **Native backing** iOS GlassSurface capsule
  (MP-38, JS); Android Compose `ExtendedFloatingActionButton` via Expo UI (M3 Expressive, animated expand/collapse) · **Phase** M4-08
- **iOS:** glass capsule `h-new` 52, `rounded-new` 26, pad 0 20 0 16, icon 20 + label 16/600 `text-fg`, end 16, bottom 6 above the safe area
  (`controls.newAction`, 02 §3.8; the board's bottom 40 includes the home indicator). **Android:** Extended FAB h56 `rounded-new` 16, pad 0 20 0 16, `bg-accent`
  `text-on-accent`, 14/600, `shadow-float` (MD-72); end 16, bottom 16 above the nav bar inset.
- **Behaviour:** collapses to icon-only (iOS 52 circle / Android 56 FAB) while the list scrolls down, expands on scroll up (`collapsed`
  controlled by the Screen's scroll direction). Label per module: "New chat" (Home, Chats), "New project", "New agent", "New workflow",
  "New automation", "Run" (workflow detail, then it is the screen's primary), "Run script". It counts as the screen's primary only on
  Android when filled (MD-22: a list screen has no other primary). Covered by the drawer scrim when the drawer is open.
- **Props:** `{ label: string; icon: IconConcept; onPress(): void; collapsed?: boolean; testID?: string }`
- **A11y:** role `button`, label = the label even when collapsed. **Boards:** MComponents "Floating New", MHome, MChats, MScopeRequest (Run).
- **Seed:** new (dead `Fab` deleted).

### ML-10 Sheet

- **Web** P-33 Sheet / P-31 Dialog · **Impl** N · **Folder** `ui/native/Sheet` (`RouteSheet` + `Sheet` + `SheetHeader` + `SheetFooter`) ·
  **Native backing** route sheets: expo-router `presentation: 'formSheet'` with `sheetAllowedDetents`, `sheetGrabberVisible` and, on
  Android only, `sheetCornerRadius` 28 (iOS keeps the system radius, MD-72; iOS UISheetPresentationController: inset glass at partial
  detents; Android BottomSheetBehavior, ≤ 3 detents, no header / nested stack inside), options from `sheetOptions(kind)` (06 §3.7); imperative sheets: `@lodev09/react-native-true-sheet` 3.x (keyboard-aware, scrollables, footer, stacking) ·
  **Phase** M4-06
- **When which (MD-21):** route sheet when it deep-links or is a flow step (Turn sheet, model/agent pickers, run sheet, commit & PR, approval,
  server switcher, execution detail, scope request, New chat at the large detent); TrueSheet for short option lists and forms that do not
  deep-link (rename, feedback, permission mode, extension detail, cleanup confirm with a list).
- **Actions (MD-85):** selection sheets (Turn sheet, pickers, server switcher) apply on tap and close with a header **text** action
  ("Done"); action sheets (New chat, Commit & PR, Run, Add codebase, Use agent, Import, Request access, forms) pin one full-width `lg`
  primary in `SheetFooter` (keyboard-aware) and have no header confirm. A second level opened inside a sheet swaps content in the same
  sheet with `back` (MD-62); never a stacked second sheet.
- **iOS:** grabber 36×5 (system); header `h-dialog-bar` 56: ✕ (glass 44, start) + centred `headline` 17/600 title (+ subtitle `caption`) + optional
  trailing text action (Done / Reset) — ✕ placement is **start** on every sheet (MServers' end ✕ is normalised). Detents: `medium` / `large` / `content` (fit). Drag between detents; below the smallest dismisses; tap grabber cycles.
- **Android:** edge-attached, top corners 28, handle 32×4 `fg-3` 60 %; header: title `title` 22/600 start + optional ✕ 48 end (shown at
  the large detent or when the sheet holds a form); footer bar with a top 1px `border-line-soft` for actions. Detents `half` / `full`.
- **Dirty guard:** `dirty` → dismiss attempts (drag, ✕, scrim, Back) open MP-29 "Discard changes?" (TrueSheet `onDismissAttempt`; route
  sheets via `usePreventRemove` + `gestureEnabled: !dirty`).
- **Props:**
```ts
export interface SheetProps {
  title: string;
  subtitle?: string;
  detents?: ReadonlyArray<'content' | 'medium' | 'large'>;  // default ['medium','large']
  initialDetent?: number;
  dirty?: boolean;
  onDismiss: () => void;
  headerAction?: { label: string; onPress(): void; disabled?: boolean };  // text action
  back?: { label: string; onPress(): void };                // in-sheet page back (MD-62)
  footer?: ReactNode;                                         // SheetFooter: sticky above the keyboard
  scrollable?: boolean;
  children: ReactNode;
  testID?: string;
}
// Imperative: const sheet = useSheet(); sheet.present(<Content/>, options); sheet.dismiss();
// Route: export default function Route() { return <RouteSheet {...props}>…</RouteSheet> } + options from sheetOptions(detents)
```
- **A11y:** focus trap, ✕ "Close", grabber "Resize sheet" (adjustable on iOS), Escape closes (dirty → confirm).
- **Boards:** MComponents Sheets, MModelPicker, MAgentPicker, MServers, MPaneCommit, MShortcuts share sheet.
- **Seed:** replaces `ui/Sheet.tsx` (633, JS Modal sheet), `ui/sheetMath.ts`, `navigation/RouteSheet.tsx` (keeps its iOS formSheet path),
  and the 26 `*Sheet.tsx` shells (their content moves into blocks/features).

### ML-11 FullScreenEditor

- **Web** L-02 Wizard / T-03 FormWithAside (frame) · **Impl** N · **Folder** `ui/layout/FullScreenEditor` · **Native backing** expo-router
  `presentation: 'fullScreenModal'`, `gestureEnabled: false` · **Phase** M4-06
- **Spec (MD-21):** Header role `modal`: Cancel (start) + title + Save/Create (end; the screen's one primary). No swipe dismiss. Dirty guard
  on Cancel and Android Back (MP-29 "Discard changes?"). Keyboard-aware scroll body (`KeyboardAwareScrollView`), optional ML-23 sticky
  bar for wizards (Back · Continue); while dirty, the header title carries the change count ("3 changes", MAgentEdit; no tinted DirtyBar,
  MD-25, MDF-103). Used by: agent editor, MCP add,
  automation create wizard, workflow builder, stage editor, project create, new workflow.
- **Props:** `{ title: string; primary: { label: string; onPress(): void; disabled?: boolean; loading?: boolean }; onCancel(): void; dirty: boolean; dirtyCount?: number; stepper?: ReactElement<StepperProps>; stickyBar?: ReactElement; children; testID?: string }`
- **Boards:** MAgentEdit1–3, MSetMcpAdd, MAutomationCreate1–4, MBuilderList, MStage*, MProjectCreate, MWorkflowNew.
- **Seed:** new.

### ML-12 ListSection

- **Web** C-13 SettingsSection (recipe) · **Impl** P · **Folder** `ui/layout/ListSection` · **Phase** M4-07
- **iOS:** inset grouped: header (MD-68) pad 12 4 6 4 inside a margin 0 16; group `bg-raised` `rounded-group` 22, rows separated by 1px
  `border-line-soft` inset after the icon column; footer `footnote` 13 `text-fg-3` pad 6 16.
- **Android:** flat full-bleed: header 14/600 `text-fg-2` pad 16 16 8; rows full width with inset dividers from 56 (or full-bleed when
  `dividers="full"`); full-bleed divider between sections on detail screens; footer 14 `text-fg-3` pad 16. `carded` (composite content:
  provider cards, capability card, widget preview) → `bg-raised` `rounded-group` 16 with M3 **segmented list** geometry for grouped rows
  (2px gaps, first item radius 20 20 4 4, last 4 4 20 20, min-h 56) (MNewChat Android).
- **Virtualised form:** `ListSection` is a static container; long lists use Legend List with `SectionHeader` + row renderers that read
  `position: 'first'|'middle'|'last'|'only'` to draw the iOS group corners without a wrapping View.
- **Props:** `{ title?: string; count?: number; action?: { label: string; onPress(): void }; footer?: string; variant?: 'grouped'|'carded'; dividers?: 'inset'|'full'|'none'; children; testID?: string }`
- **A11y:** title role `header`. **Boards:** MSettings, every settings board, MServers, MSearch, MHome groups. **Seed:** replaces
  `ui/ListRow.tsx` `ListGroup`.

### ML-13 ListRow

- **Web** C-13 SettingRow / C-07 EntityRow (simple) · **Impl** J · **Folder** `ui/layout/ListRow` · **Phase** M4-07
- **Geometry:** iOS `irow` min-h 52 (`min-h-row`), pad 10 16, gap 12; Android `arow` min-h 56 (single line) / 64 (with icon) / 72 (two
  lines), pad 10 16, gap 16. Leading icon 20 (iOS) / 22–24 (Android) `text-fg-2`. Title `body`; subtitle `footnote` `text-fg-3`; value
  `subhead` 15 (iOS) / 14 (Android) `text-fg-3`; mono value option.
- **Kinds:**

  | `kind` | Trailing (iOS) | Trailing (Android) | Whole-row press |
  |---|---|---|---|
  | `navigation` | value + `chevron-right` 14 `text-fg-3` | value, no chevron (M3) | navigates |
  | `toggle` | MP-22 Switch | Switch | toggles (switch mirrors) |
  | `value` / `info` | value (mono optional), no chevron | same | none (copyable with long-press → Copy when `copyable`) |
  | `picker` | value + ⇅ → native Menu (MP-24 `presentation="row"`) | exposed dropdown (outlined + ▾) | opens |
  | `radio` | ✓ 18 when selected (MD-49) | leading Radio 20 | selects |
  | `check` | leading MP-20 circle | leading square Checkbox | toggles |
  | `stepper` | MP-43 | MP-43 | none |
  | `segmented` | label over MP-23 (full width) | same | none |
  | `destructive` | `text-err` label, centred or start; no chevron | same | runs (confirm via MP-29) |
  | `link` | `external-link` 14 | same | opens external/cross-module (↗) |
  | `requires-admin` | "Requires admin access · Request" `text-fg-3` + `lock` 14 (MD-30) | same | opens scope request (MB-38) |

- **Props:**
```ts
export interface ListRowProps {
  kind: 'navigation' | 'toggle' | 'value' | 'info' | 'picker' | 'radio' | 'check' | 'stepper' | 'segmented' | 'destructive' | 'link' | 'requires-admin';
  title: string;
  subtitle?: string;
  icon?: IconConcept;
  value?: string;
  mono?: boolean;
  selected?: boolean;                 // radio / check
  switchValue?: boolean;              // toggle
  onValueChange?: (v: boolean) => void;
  picker?: SelectProps;               // picker
  stepper?: NumberFieldProps;         // stepper
  segmented?: SegmentedControlProps<string>;
  provenance?: ReactNode;             // "Changed ↶" chip (MAgentPickerCaps), "This device" tag (MD-30)
  badge?: ReactElement;               // Badge / StatusBadge before the trailing part
  onPress?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  position?: 'first' | 'middle' | 'last' | 'only';   // iOS group corners in virtualised lists
  copyable?: boolean;
  testID?: string;
}
```
- **A11y:** one element per row with role by kind (`button`, `switch`, `radio`, `checkbox`, `adjustable`); label "title, subtitle, value";
  toggle rows expose the switch state; `requires-admin` hint "Request admin access".
- **Boards:** MComponents rows, settings boards, MAgentPickerCaps, MSetPairDevice. **Seed:** port `ui/ListRow.tsx` (56 pt settings row) API.

### ML-14 EntityRow

- **Web** C-07 EntityRow + B-26 row bindings · **Impl** J · **Folder** `ui/layout/EntityRow` · **Phase** M4-07
- **Spec:** the two-line entity row used by Chats, Projects, Agents, Workflows, Automations, Scripts, Home, palette results. iOS inside a
  ListSection group, `min-h-row-2` 68, pad 12 16; Android flat `min-h-row-2` 72, pad 12 16, gap 16. Leading slot 20 (iOS) / 24 (Android)
  column: status glyph (MP-07's glyph only, via `leading={{status}}`) or icon; line 1: title 16/600 (truncate), optional pin 14, trailing
  relative time mono 12 `text-fg-3`; line 2: meta `footnote` with mono 12 project · AgentGlyph (agent or model) and trailing slot (DiffStat,
  StatusBadge sm, timer mono `text-run`, row action pill Button `tonal sm`). Unread → title weight 600 + 8 dot `bg-fg` before the time (the
  unread flag is MG-02; rendered only when the field exists, MD-27). Archived → title `text-fg-3` + neutral Badge "Archived".
  Selection mode → leading Checkbox replaces the glyph. Long-press → ContextMenu (ML via MP-28); swipe via ML-15.
- **Props:**
```ts
export interface EntityRowProps {
  title: string;
  leading: { status: StatusState } | { icon: IconConcept } | { checkbox: boolean };
  meta?: ReadonlyArray<ReactElement | string>;    // joined with " · "
  time?: string;                                  // ISO → relative mono ("3m", "now", "1h")
  pinned?: boolean;
  unread?: boolean;
  archived?: boolean;
  trailing?: ReactElement;                        // DiffStat | StatusBadge | Button tonal sm | timer
  selected?: boolean;                             // bg-selected
  onPress: () => void;
  menu?: MenuProps['items'];                      // ContextMenu + accessibilityActions
  onMenuSelect?: (id: string) => void;
  preview?: ReactElement;                         // iOS context-menu preview
  position?: ListRowProps['position'];
  testID?: string;
}
```
- **A11y:** one element; label "<status word>, <title>, <meta>, <time>"; actions from `menu` (+ swipe actions via ML-15).
- **Boards:** MChats, MHome, MProjects, MAgents, MWorkflows, MAutomations, MScripts, MSearch. **Seed:** replaces `ui/ListItem.tsx` (64 pt
  entity row with status avatar), `runs/RunRow.tsx`, `work/ScriptRow.tsx`, `work/cards.tsx`, `search/SearchResultRow.tsx` visuals.

### ML-15 SwipeRow

- **Web** none · **Impl** J · **Folder** `ui/layout/SwipeRow` · **Native backing** RNGH 3 `ReanimatedSwipeable` (works inside Legend List;
  Expo UI `SwipeActions` needs a SwiftUI `List`, so it is not used) · **Phase** M4-07
- **Spec (MD-52):** leading and trailing action sets; iOS: leading Pin / Mark unread (64 each), trailing More / Archive (74 each), full swipe
  performs the last trailing action (Archive) with `threshold` haptic at the arming point; Android pills as MD-52. **Never Approve or Delete
  on a swipe** (MGestures). Every action also appears in the row's menu and as an `accessibilityAction` (MD-28). One row open at a time;
  scrolling closes it; opening the drawer closes it.
- **Props:** `{ leading?: SwipeAction[]; trailing?: SwipeAction[]; fullSwipe?: 'leading'|'trailing'|false; children: ReactElement<EntityRowProps>; testID?: string }` with
  `SwipeAction { id: string; label: string; icon: IconConcept; tone: 'neutral'|'strong'; onPress(): void }`.
- **Boards:** MChats, MComponents chat list rows, MGestures. **Seed:** port `ui/SwipeableRow.tsx` (1 use) threshold logic.

### ML-16 ReorderList

- **Web** none (web builder uses canvas) · **Impl** J · **Folder** `ui/layout/ReorderList` · **Native backing** `react-native-reorderable-list`
  (Reanimated/RNGH; `onDragStart`, `onIndexChange` hooks) · **Phase** M4-07
- **Spec:** list with a drag handle per row (`grip-vertical` 20, drawn 36×28, hit 44/48 — board 36×28 raised); lift = scale 1.02 + `shadow-pop`;
  `dragStart` haptic on lift, `dragTick` per slot change; `canMove(from, to)` predicate (workflow builder: only stages in a linear chain, MD-04);
  a11y actions "Move up" / "Move down" on every row and the same items in the row menu; `onMove(key, toIndex)` fires on drop.
- **Props:** `{ data: T[]; keyExtractor(item: T): string; renderItem(item: T, handle: ReactElement): ReactElement; canMove?(from: number, to: number): boolean; onMove(key: string, toIndex: number): void; editing: boolean; testID?: string }`
- **Boards:** MBuilderList, MGestures (drag to reorder), MAutomationCreate3 (workflow order). **Seed:** new.

### ML-17 AdaptiveLayout

- **Web** S-01 AppFrame + C-20 SplitPane · **Impl** J · **Folder** `ui/layout/AdaptiveLayout` · **Phase** M5-05
- **Spec (MD-24):** reads `useSizeClass()` from `useWindowDimensions()` (never the device idiom): `compact` < 600, `medium` 600–839,
  `expanded` ≥ 840. Renders `[start SidePanel][content][end SidePanel]` as one stable tree; sets each panel's `presentation`
  (compact: overlay/overlay; medium: persistent/overlay; expanded: persistent/persistent when the pane is open). Content column gets a
  reading max-width (720) on expanded when the pane is closed. Pointer hover works on iPadOS/Android through MP-03.
- **Props:** `{ start: ReactElement<SidePanelProps>; end?: ReactElement<SidePanelProps>; children: ReactNode }` + `useSizeClass()` export.
- **A11y:** focus order start → content → end. **Boards:** MTabletIOS, MTabletAndroid, MFoundations widths. **Seed:** new (legacy
  `TWO_PANE_MIN_WIDTH` 768 removed).

### ML-18 StatTile / StatStrip

- **Web** C-10 StatStrip / StatTile · **Impl** J · **Folder** `ui/layout/StatStrip` · **Phase** M4-08
- **Spec:** `tiles` variant (Home count tiles): 3 tiles flex 1, gap 8, pad 12 14, `bg-raised`, `rounded-card-lg` 20/16 (MD-50); value `title` 20/22 with tabular numerals (MD-71)
  tabular (`tone`: `warn` Needs you, `run` Running, `fg` Finished today), label 13 `text-fg-2`; each tile pressable (scrolls to its section
  or navigates). `strip` variant ("This week"): one Card `rounded-group`, pad 14 16, N columns divided by 1px `border-line-soft`; value
  18/600, label 12 `text-fg-3`; unknown values "—" (D-58 omits rates with 0 denominators).
- **Props:** `{ variant: 'tiles'|'strip'; items: ReadonlyArray<{ id: string; value: string | number | null; label: string; tone?: 'fg'|'warn'|'run'; onPress?(): void }>; testID?: string }`
- **A11y:** each tile "3, Need you, button". The tile value colour is a status tone used for a count of that status (allowed; it names a state).
- **Boards:** MHome (tiles), MHomeMore ("This week"), MAutomationDetail (StatsStrip). **Seed:** port `home/StatTiles.tsx`.

### ML-19 KeyValueList

- **Web** C-11 KeyValueList · **Impl** J · **Folder** `ui/layout/KeyValueList` · **Phase** M4-08
- **Spec:** rows min-h 44/48: label `footnote` `text-fg-3` fixed width (96 iOS / 112 Android) + value `subhead` (mono optional, selectable,
  wraps); inside a ListSection group on iOS, flat on Android. Copy action per row when `copyable`.
- **Props:** `{ items: ReadonlyArray<{ label: string; value: string | ReactElement; mono?: boolean; copyable?: boolean }>; testID?: string }`
- **Boards:** MSetDiagnostics, MAutomationWebhook, MCodebase meta, MPaneTaskDetail. **Seed:** new.

### ML-20 SectionHeader

- **Web** C-12 SectionHeader · **Impl** J · **Folder** `ui/layout/SectionHeader` · **Phase** M4-08
- **Spec:** `list` (MD-68): iOS 13/600 `text-fg-3` pad 0 20 (Home: `headline` 17/600 `text-fg`); Android 14/600 `text-fg-2` pad 0 16; optional
  icon (📌 `pin`), Count, trailing Link ("See all"). `label` (drawer `.dsec`): h30 13/600 `text-fg-3`.
- **Props:** `{ title: string; variant?: 'list'|'home'|'label'; icon?: IconConcept; count?: number; countTone?: 'fg-3'|'warn'; action?: { label: string; onPress(): void }; testID?: string }`
- **A11y:** role `header`. **Seed:** port `primitives.tsx` `SectionHeader`.

### ML-21 Stepper (wizard)

- **Web** C-17 Stepper · **Impl** J · **Folder** `ui/layout/Stepper` · **Phase** M4-08
- **Spec (MD-66):** horizontal compact on phones: numbered dots 24 (done = `bg-fg text-surface` ✓, current = 2px `border-fg` + number,
  pending = 1px `border-line-strong` `text-fg-3`) connected by 1px lines, with only the current step's label under it (`caption`);
  `medium`+ shows all labels; `expanded` switches to vertical (C-17). Inline 3-step form (MScopeRequest "1 Request → 2 Admin approves → 3 Edit")
  uses `variant="inline"`: text steps with `chevron-right`.
- **Props:** `{ steps: ReadonlyArray<{ id: string; label: string }>; current: number; done: ReadonlyArray<number>; variant?: 'wizard'|'inline'; onStepPress?(i: number): void; testID?: string }`
- **A11y:** "Step 2 of 6, Trigger"; done steps are buttons when `onStepPress`. **Boards:** MAutomationCreate1–4, MScopeRequest. **Seed:** new.

### ML-22 FormSection

- **Web** C-14 FormSection · **Impl** J · **Folder** `ui/layout/FormSection` · **Phase** M4-08
- **Spec:** a titled block of fields inside a form screen: title (MD-68) + optional hint + Fields; on iOS the fields sit in a ListSection
  group (`Input presentation="row"`); on Android they stack as outlined fields with gap 16 (`carded` optional). Sections separated by 24.
- **Props:** `{ title: string; hint?: string; children; variant?: 'grouped'|'stacked'; testID?: string }`
- **Boards:** MNewChat, MAgentEdit*, MSetMcpAdd, MProjectCreate, MWorkflowSettings. **Seed:** port `projects/ProjectSettingsForm.tsx` layout pattern.

### ML-23 StickyActionBar

- **Web** C-16 ActionBar · **Impl** P · **Folder** `ui/layout/StickyActionBar` · **Phase** M4-08
- **iOS:** floating GlassSurface capsule, start/end 12, bottom 12 above safe area (rides above the keyboard via `KeyboardStickyView`), h64,
  `rounded-full` (radius 32), pad 8 8 8 20: summary (title 14/600 + sub 12 `text-fg-3`) + primary Button `lg` (the screen's primary). **Android:**
  docked bar h76, `bg-raised`, top 1px `border-line-soft`, pad 12 16, summary + filled Button `lg` `rounded-full` (M3 buttons are full; the board's
  radius 16 is normalised).
- **Props:** `{ summary?: { title: string; subtitle?: string }; primary: ButtonProps; secondary?: ButtonProps; testID?: string }`
- **Boards:** MNewChat (Create chat), wizard footers (Back · Continue), MWorkflowLaunch (Run). **Seed:** port `work/StickyActionBar.tsx`.

### ML-24 FactStrip

- **Web** none (C-10 variant) · **Impl** J · **Folder** `ui/layout/FactStrip` · **Phase** M4-08
- **Spec:** `bg-raised`, radius 16 (iOS) / 12 (Android), pad 12 0, 2–4 columns divided by 1px `border-line-soft`; each: value
  (StatusBadge or mono 16/500) over label 12 `text-fg-3`.
- **Props:** `{ facts: ReadonlyArray<{ label: string; value: string | ReactElement; mono?: boolean }>; testID?: string }`
- **Boards:** MChatStepDetail ("Failed · 1 Exit code · 48.2s Duration"), MAutomationExecution. **Seed:** new.

### ML-25 BulkActionBar

- **Web** C-06 BulkActionBar · **Impl** P · **Folder** `ui/layout/BulkActionBar` · **Phase** M4-08
- **Spec (MD-60):** appears in selection mode, replaces the NewAction. iOS: bottom glass capsule h52 with "N selected" + icon buttons
  (Archive, Delete (`text-err`, confirm), More) and the header shows "Cancel" / "Select all". Android: M3 bottom app bar h80 `bg-raised` with
  the same actions; header becomes a contextual app bar (✕ + "N selected"). Uses D-52 bulk endpoints (callers).
- **Props:** `{ count: number; actions: ReadonlyArray<{ id: string; label: string; icon: IconConcept; destructive?: boolean; onPress(): void }>; onSelectAll(): void; onCancel(): void; testID?: string }`
  (Delete action keeps `chats-bulk-delete` on Chats).
- **A11y:** announces "N selected" on change. **Boards:** derived (MChats "Select chats"; not drawn). **Seed:** port the selection bar in `app/(tabs)/chats.tsx`.

### ML-26 ScrollToLatest

- **Web** part of B-24 ("Jump to latest") · **Impl** P · **Folder** `ui/layout/ScrollToLatest` · **Phase** M4-08
- **Spec:** "↓ Latest" pill shown when the transcript is scrolled up > 1 screen: iOS GlassSurface h40 `rounded-full` pad 0 14, `arrow-down` 16 +
  "Latest" 14/600, centred 12 above the composer; Android `bg-overlay` + `shadow-pop` h40. Optional unread count ("3 new").
- **Props:** `{ visible: boolean; onPress(): void; newCount?: number; testID?: string }` — label `TRANSCRIPT_COPY.jumpToLatest`.
- **Boards:** MChatRunning. **Seed:** new.

### ML-27 BottomToolbar

- **Web** P-47 Toolbar · **Impl** P · **Folder** `ui/layout/BottomToolbar` · **Phase** M4-08
- **iOS:** floating glass group: a capsule of navigation icon buttons (↑ / ↓, 44 each — board 38 raised) + separate glass/secondary Buttons +
  optional primary, bottom 12 above safe area. **Android:** M3 bottom app bar h80 `bg-raised`: icon buttons 48 start, actions end, primary
  as a 48 × 48 filled button with radius 16 (the M3 FAB slot of a bottom app bar).
- **Props:** `{ nav?: ReadonlyArray<IconButtonProps>; actions?: ReadonlyArray<ButtonProps>; primary?: ButtonProps; testID?: string }`
- **Boards:** MChatStepDetail, MPaneTaskDetail footer, MPaneFilePreview footer. **Seed:** new.

### ML-28 SearchHeader

- **Web** C-21 CommandList query row · **Impl** P · **Folder** `ui/layout/SearchHeader` · **Phase** M5-06
- **iOS:** no nav bar; SearchInput h44 `rounded-full` `bg-selected` 17 (palette size) + glass 44 "Close search" ✕; result count `caption`.
  **Android:** M3 full-screen search view header h72 with bottom 1px `border-line-soft`: ← 48, query 18, clear ✕ 48.
- **Props:** `{ value: string; onChangeText(v): void; placeholder: string; onClose(): void; resultCount?: number; loading?: boolean; testID?: string }`
- **Boards:** MSearch. **Seed:** new.

### ML-29 KeyboardStickyBar

- **Web** none · **Impl** J · **Folder** `ui/layout/KeyboardStickyBar` · **Native backing** react-native-keyboard-controller
  `KeyboardStickyView` (+ `KeyboardGestureArea` for interactive dismissal on iOS) · **Phase** M4-08
- **Spec:** hosts content that rides on the keyboard: the composer, the terminal KeyRow (MB-27), wizard sticky bars, inline editors.
  `offset.closed` = bottom safe area, `offset.opened` = 0; hides when a hardware keyboard is attached if `hideOnHardwareKeyboard`.
- **Props:** `{ children; hideOnHardwareKeyboard?: boolean; testID?: string }`. **Seed:** port `ui/KeyboardSticky.tsx`, `ui/keyboard.ts`,
  `ui/keyboardMath.ts`.

### ML-30 DirtyGuard

- **Web** none (web uses `useBlocker`) · **Impl** J · **Folder** `ui/layout/DirtyGuard` (hook `useDirtyGuard`) · **Phase** M4-06
- **Spec:** one hook used by Sheets, FullScreenEditors and pushed forms: blocks router removal (`usePreventRemove`), sheet dismissal, and
  Android Back while `dirty`, then asks MP-29 `{ title: 'Discard changes?', message: 'Your edits are not saved.', confirmLabel: 'Discard' }`.
- **API:** `useDirtyGuard(dirty: boolean, opts?: { onDiscard?(): void }): { guard<T>(fn: () => T): Promise<T | undefined> }`.
- **Seed:** new.

---
## 4. Blocks (MB-01 … MB-50)

Blocks are query-aware parts used by at least two features (MD-14). Each block folder holds `<Name>.tsx` (connected),
`<Name>.view.tsx` (pure presentational view taking the view model — this is what stories render), `<Name>.queries.ts` (data hooks),
optional `<name>Model.ts` (pure view model, Vitest) and platform files where noted. Entry fields: **Web**, **Folder**, **Shared logic**
(client-core / shared functions it must call — never re-implement them), **Data** (hooks in `<Name>.queries.ts`; the typed
`createApiClient` methods and query-key factories come from M2), **iOS vs Android**, **Native pieces**, **States**, **A11y / testIDs**,
**Boards**, **Seed**, **Phase** (the `07-phases.md` task id: M5 shell, M6 chat workspace, M7 modules, M8 workflows).

Live data rule for every block: server-sent updates arrive through the existing `services/stream` multiplexer and client-core stores;
blocks subscribe through their queries file (`useXxxStream`) and never open sockets themselves. Offline: blocks render persisted data
read-only with actions disabled and `disabledReason="Offline"` (00 §5.11a); no optimistic writes for approvals.

### MB-01 Composer

- **Web** F-composer (`blocks/composer`), WF-17 (stage variant) · **Folder** `blocks/Composer` (+ `parts/`: `ComposerSurface.ios.tsx` /
  `.android.tsx`, `AttachmentStrip`, `SlashPopover`, `DictationPill`, `AgentChip`, `ModelChip`, `BlockingBar`, `WorkingStrip`,
  `ChangesStrip`, `PrimaryControl`) · **Phase** M6-04
- **Shared logic:** `composerReducer`, `createComposerState`, `selectComposerView`, `selectCanSend`, `selectBlockingState`,
  `selectPrimaryAction`, `selectStopView`, `composerBlockingState`, `isPrepBlocking`, `hasComposerContent` (client-core `composer/`);
  types `ComposerView`, `ComposerBlockingState`, `ComposerPrimaryAction`, `ComposerBinding`, `ComposerVariant`, `ComposerToolToggleId`,
  `COMPOSER_TOOL_TOGGLE_IDS`, `COMPOSER_BAR_STATES` (shared `ui-contract/composer.ts`); `SlashCommand`, `SLASH_COMMAND_GROUPS`,
  `slashCommandGroup`, `BUILTIN_COMMANDS`, `skillToCommand`, `promptToCommand`, `fuzzyMatch`, `MentionFile` (client-core
  `composer/slashCommands.ts`); `computeLiveCounters`, `formatLiveCounters` (working strip). Mobile pure models kept and moved into
  `blocks/Composer/model/`: `attachmentPolicy.ts`, `captures.ts`, `captureContext.ts`, `draftStore.ts` (MMKV drafts per chat),
  `promptHistory.ts`, `slashSource.ts`, `sourceModel.ts`, `turnOptions.ts`, `composerMenu.ts`, `types.ts`, `attachmentPickers.ts`.
  `useComposerController.ts` logic is **replaced** by the shared reducer (MD-03 / D-61); only its platform plumbing (pickers, upload)
  survives in `Composer.queries.ts`.
- **Data:** `useSendMessage(chatId)`, `useStopTurn(chatId)` (two-phase: 400 ms inert, Force reset after 15 s — from the reducer's stop
  machine), `useSlashCatalog(chatId)` (skills, prompts, tools filtered by the agent's capabilities), `useMentionFiles(workspaceId, query)`,
  `useUploadAttachment()` (progress), `useChatToolToggle(chatId, 'workflows')`, `useChatChangesSummary(chatId)` (changes strip),
  `useLiveTurn(chatId)` (working strip). Dictation uses `services/voice` (`useVoiceInput`, `dictationCommit`).
- **Anatomy:** [BlockingBar (prep_failed / preparing / waiting_on_you: hand icon + "Answer the permission above to send" + "Cancel and send"
  ghost)] or [WorkingStrip (running: Spinner, "Working", mono `text-run` elapsed, "· reading Canvas.tsx", DiffStat; bottom divider)] or
  [ChangesStrip (done with changes: `git-compare` 16, "1 file changed", DiffStat, "Review" link → pane Changes; `changes-tray-toggle` /
  `changes-tray-review`)]; AttachmentStrip (MP-10 `attachment` chips; replaced by DictationPill while dictating); TextInput (`transcript`
  16/1.45, 1–8 lines then scroll, placeholder "Reply to <agent>…" / "Message <model>…" — running placeholder is the same, **never
  "Queue…"**, MD-03); action row: "+" (Menu, MD-63; `composer-options`), AgentChip (bot + name + lock; locked once bound; opens agent info
  sheet, not a picker; hidden for model-only chats), ModelChip (`composer-model`; opens MB-02), spacer, Mic (dictate), PrimaryControl
  (Send ↑ / Stop ■ / "Stopping…" inert / "Force reset").
- **iOS vs Android:** iOS surface = GlassSurface `rounded-composer` 28, pad 12 12 8 16, margin 8 12 0; controls `size-icon-button-sm` 36
  (MD-56), Attach `bordered`, Send/Stop `filled` circle. Android surface = `bg-raised` + 1px `border-line-soft` `rounded-composer` 28, pad 12 8
  8 18, margin 8 12 8; controls 40; **Mic in the action row** (MD-03); Send/Stop 48 radius 16 filled.
- **States:** idle-empty (Send disabled: `bg-selected text-fg-3`, MD-03), typing (Send ink), attachments (uploading / failed / oversize),
  slash popover, mention popover, dictation (listening / error / permission denied → MP-35 inline), + menu open ("+" `selected`),
  running (Stop), stopping, force_available, waiting_on_you (Send disabled, reason line), preparing, prep_failed (Retry / Edit sources),
  offline (disabled with reason), variant `stage` (no model chip — WF-17; MD-04), variant `quick` (Home quick start: no agent chip,
  "More options" → New chat with `CreateChatDraft`).
- **Native pieces:** `KeyboardStickyView` (ML-29) + `KeyboardGestureArea` (interactive dismiss), document picker (`expo-document-picker`),
  photo picker (`expo-image-picker`, no permission on Android Photo Picker), camera, clipboard paste, hardware keyboard ↵ send / ⇧↵
  newline (`COMMANDS['composer.send'|'composer.newline']`) on iPad/Android tablets.
- **A11y / testIDs:** input label "Message <agent/model>"; Send "Send", Stop "Stop <agent>", "Stopping", "Force reset"; disabled Send hint
  = the blocking reason; dictation pill live region "Listening, 0:07"; Stop-dictation "Stop dictation and keep text" (✓ glyph, MD-57);
  "Discard dictation". testIDs: `composer-input`, `composer-send`, `composer-stop`, `composer-options`, `composer-model`,
  `composer-agent`, `composer-mic`, `composer-attachment` (per chip, web parity), `changes-tray-toggle`, `changes-tray-review`.
- **Boards:** MComponents "Composer states", Main, MChatRunning, MChatNoAgent, MComposerPlus, MComposerInput, MComposerVoice, MRunStageChat.
- **Seed:** port `chat/Composer.tsx` (1,104) structure, `chat/composer/*` (AttachmentChips, ComposerBanners, VoicePill, SuggestionStrip,
  HistorySheet → `promptHistory` menu), `chat/chatMotion.ts`; delete `useComposerController.ts` after adoption.

### MB-02 TurnSheet

- **Web** B-01 ModelPicker composer popover (Next turn) · **Folder** `blocks/TurnSheet` · **Phase** M6-04
- **Spec (MD-03):** route sheet `formSheet` at `large` (`/chats/[id]/turn`): header ✕ + "Next turn" + **text** action "Done". Sections:
  Provider (MP-23 from `HARNESS_PROVIDERS` via the catalogue; not-ready providers `locked` with the note "<provider> isn't signed in on
  <server>. Sign in from Settings, then refresh."), Model (MB-03 embedded list), Mode (MP-23 "Auto" / "Plan"; `composer-mode`) + help
  line, Effort (MP-23 from `modelReasoningEfforts(model)`; falls back to Select at large text), Context (Standard 200K / Long 1M when the
  model offers both), MB-41 ContextUsage row. The MComponents "Turn setup" variant is not built.
- **Shared logic:** `buildModelPickerCatalog`, `providerAvailability`, `modelReasoningEfforts`, `findPickerModel`, `formatTokenLimit`
  (client-core `models/`); `turnOptions.ts` (moved model).
- **Data:** `useModelPickerCatalog()` (harness providers response), `useTurnOptions(chatId)` / `useSetTurnOptions(chatId)` (applies on Done),
  `useContextUsage(chatId)`.
- **iOS vs Android:** ✓ trailing vs radio leading in the model list (MD-49); segmented vs connected groups; iOS row 44 min / Android 48.
- **States:** loading catalogue (Skeleton list), provider locked, model unavailable, no models (EmptyState), dirty (Done enabled; ✕ asks).
- **A11y:** section headers; model info buttons 44/48 hit "Model details, <model>". **Boards:** MModelPicker. **Seed:** port
  `chat/TurnOptionsSheet.tsx`, `chat/composer/GaugeSheet.tsx`.

### MB-03 ModelPicker

- **Web** B-01 ModelPicker · **Folder** `blocks/ModelPicker` · **Phase** M6-04
- **Spec:** the model list used by TurnSheet, New chat, Settings › General (default model, "This device"), agent editor Runtime, stage editor
  Session. Tier headers (Fast / Balanced / Powerful, `caption` `text-fg-3`), rows min-h 44 (iOS) / 48 (Android): selection indicator (MD-49),
  name 16/500 (600 selected, row `bg-selected`), mono context ("200K · 1M"), info IconButton (opens a details sheet: context, efforts,
  provider). Optional SearchInput when > 12 models. Never defaults to a provider that is not ready (MD-35).
- **Shared logic / Data:** as MB-02 (`buildModelPickerCatalog`, `readyCatalogModels`, `findPickerModel`); `useModelPickerCatalog()`.
- **Props (view):** `{ catalog: ModelPickerCatalog; value: { provider: string; model: string } | null; onValueChange(v): void; providerFilter?: string; searchable?: boolean }`
- **Boards:** MModelPicker, MNewChat (model row → this in a sheet), MSetGeneral, MAgentEdit2, MStageModel. **Seed:** port `chat/ModelSheet.tsx`.

### MB-04 AgentPicker

- **Web** B-02 AgentPicker · **Folder** `blocks/AgentPicker` · **Phase** M6-05
- **Spec:** a page inside the New chat sheet (MD-62), or the route sheet `/pickers/agent` when opened from a screen (the agent editor Team
  section): header ✕ (or back, as a page) + "Agent" + subtitle "Fixed for the life of the chat"; no "Manage" action and no "No agent"
  row (the New chat "Who works on this" segment covers it; MDF-53). SearchInput `compact`; scope filter MP-23 "All 6 ·
  Global 3 · Project 1 · Built-in 2" (J path with counts); sections "Orchestrators" / "Workers"; agent rows
  (pad 10 14 / 12 16, `rounded-card` 14/16, selected `bg-selected`): AgentGlyph 20, name 16/600 + scope Badge `outline`, description 13
  `text-fg-2`, team line (`users` 14 + members) for orchestrators, mono "claude-opus-5-5 · 2 skills · 1 MCP", selection per MD-49. A
  "Customize capabilities" row (→ MB-05 page in the same sheet, MD-62). Footer (SheetFooter): one `lg` primary "Use <agent>" (MD-85).
- **Shared logic:** `agentPickerModel` (web `blocks/agent-picker/agentPickerModel.ts` logic, moved to client-core additively if not there;
  otherwise the mobile port of `work/agentModel.ts`).
- **Data:** `useAgents({ projectId })`, `useAgentCounts()`.
- **States:** loading, empty search, no agents (EmptyState `agents` + "Create agent"), built-in read-only badge.
- **A11y:** rows radio semantics. **Boards:** MAgentPicker. **Seed:** port `work/AgentDetailSheet.tsx` (list parts), `work/agentModel.ts`.

### MB-05 CapabilityEditor

- **Web** B-03 CapabilityToggleList · **Folder** `blocks/CapabilityEditor` · **Phase** M6-05
- **Spec:** page 2 of the agent sheet ("Customize capabilities" / "For <agent> in this chat", text action "Reset", back "Back to agents") and the
  agent editor capabilities section. Help "Adds to <agent>'s own, for this chat only." Nav rows: Skills ("5/9"), MCP servers ("2/4"), Extra
  instructions ("None") → sub-pages. Capabilities list "5 of 8 on": ListRow `toggle` × 8 (Read files, Write files, Run shell commands,
  Integrated browser, Web fetch & search, Widgets & canvas, Extension authoring, Orchestration); changed rows show a Chip "Changed ↶"
  (`provenance`, label "Changed for this chat. Reset to <agent>'s setting"). Tri-state in the agent editor (`TriStateSwitchRow`: inherit /
  on / off with an "Inherits" badge; value spoken with provenance). Footer summary "5 skills · 2 MCP · 5 of 8 capabilities" + "Done".
- **Data:** `useAgentCapabilities(agentRef)`; per-chat overrides go into `CreateChatParams.agentOverrides` (exists, applied at create
  and frozen at session start, `05-gap-matrix.md` NG-05), so the page is used at New chat time only; only what `AgentOverrides`
  supports is editable.
- **Boards:** MAgentPickerCaps, MAgentEdit3, MStageTools. **Seed:** new.

### MB-06 NewChatSheet

- **Web** F-create (features/chats/create) · **Folder** `blocks/NewChatSheet` (used by Chats, Home, Projects, palette, quick actions,
  share target) · **Phase** M6-05
- **Spec (MD-21):** route sheet `formSheet` **large detent** (`/chats/new`), header ✕ + "New chat"; StickyActionBar (ML-23) with summary
  ("<agent> · <model>" / "1 worktree and 1 branch will be created") + primary "Create chat" (`lg`). Sections: Task (MP-18 with footer toolbar
  paperclip / "@ Files" / "/ Skills", hint "Sent as the first message"), Name / Description (Input rows, "Named from the task" via
  `chatNameFromPrompt`), "Who works on this" (MP-23 "Just a model / An agent / An orchestrator", hint "Fixed once the chat starts") →
  Agent row (→ MB-04 page) or Model row (→ MB-03 page) + Effort, as pages inside this sheet (MD-62); Where (MB-44 ProjectPicker page +
  MB-45 SourcesCard codebase cards with Worktree/In place, New/Existing branch, branch-name mono Input "from main"; "+ Add codebase"; "Add
  server folder" opens a **server** folder browser page (`GET /api/fs/dirs`, MG-22 wrapper; paths verbatim, MDF-52)); Capabilities (MB-46
  summary + "Customize" → MB-05 page, per-chat `agentOverrides`, NG-05); More (tags MP-11 with "+ Tag", Browser
  MP-23 Headless / Visible / Off). The "Orchestrate mode" switch is **not** built (duplicates the segment).
- **Shared logic:** `CreateChatDraft`, `chatNameFromPrompt` (shared `ui-contract/chats.ts`); `newChatModel.ts` (moved from
  `chat/composer/newChatModel.ts`).
- **Data:** `useCreateChat()`, `useAgents`, `useModelPickerCatalog`, `useProjects`, `useProjectCodebases(projectId)`, `useDefaultModel()` (per device, MD-30).
- **States:** filled, model-only, orchestrator, validation (empty task → Create disabled with reason), creating (primary `loading`), failure
  (worktree creation failed → Callout err + Retry), dirty dismiss.
- **Boards:** MNewChat, MNewChatMore. **Seed:** port `chat/NewChatSheet.tsx` (1,335).

### MB-07 TranscriptView

- **Web** B-24 TranscriptTurn + TranscriptView · **Folder** `blocks/TranscriptView` · **Phase** M6-02
- **Spec:** Legend List 3.4 (`alignItemsAtEnd`, `maintainScrollAtEnd`, `maintainVisibleContentPosition`, the `@legendapp/list/keyboard` entry
  with `KeyboardChatScrollView`), one list item per **turn** (`buildTranscriptTurns`), memoised rows (React Compiler on). Turn = MB-08
  UserMessage, or MB-09 AgentTurnHeader + body entries (MB-13 StepGroupCard / MB-11 StepRow / MB-12 ToolCallCard / MB-17 DelegationGroup /
  MB-10 AssistantText / MB-15 GateCard / MB-16 InlineError / SCM result rows / widget blocks) + turn footer ("✓ Done · 1m 06s" via
  `digestBlocks` + `formatDigest`). Streaming caret (2×18 `bg-fg`, blinks; static under Reduce Motion). "Load earlier messages" at top
  (`TRANSCRIPT_COPY.loadEarlier`). ML-26 ScrollToLatest. View modes (`TRANSCRIPT_VIEW_MODES`) and find-in-transcript are not
  built on mobile in this pass (`05-gap-matrix.md` §4 G-06; `04-screen-map.md` §3 row 11).
- **Shared logic:** `buildTranscriptTurns`, `messageBlocks`, `hasRenderableContent`, `deriveTimeline`, `deriveSegments`, `deriveStreamView`,
  `groupSteps`, `MIN_GROUP`, `digestBlocks`, `formatDigest`, `findInTexts`, `awaitsUserDecision`, `chatMessageToBlocks` (client-core
  `transcript/`); `TRANSCRIPT_COPY`, `TranscriptViewMode` (shared copy); `chatActivity`, `toolCallStatus` (shared status). Mobile's own
  `deriveTimeline.ts`, `chatMessageToBlocks.ts`, `selectChatView.ts`, `mergeScmRows.ts`, `scmResultBlock.ts` are replaced by the client-core
  versions in M2 (mobile-only pieces such as SCM row merging move into `blocks/TranscriptView/model/`).
- **Data:** `useChatMessages(chatId)` (paged), `useChatStream(chatId)` (live blocks via `services/stream`), `useTurnCatchUp(chatId)` (resume).
- **iOS vs Android:** only row geometry (cards `rounded-card` 14/12, meta 13/14).
- **States:** empty (`TRANSCRIPT_COPY.emptyTitle` + `emptyBody(agent)`), loading, streaming, stopped (`stoppedPartial` / `stoppedEmpty`),
  reconnecting (via ML-04 / MP-34 banner; never stale "Running"), error.
- **A11y:** each turn is a group labelled "<author>, <time>"; new assistant text announced once per turn end (not per token); gate
  arrival announced "Needs you: <gate title>".
- **Performance:** 60 fps scroll on a 2,000-block transcript on a mid-range Android in release (M6 acceptance, 00 §5.9).
- **Boards:** Main, MChatRunning, MChatToolsExpanded, MChatNoAgent, MChatWorkflowRun, MRunStageChat, MPaneTaskDetail (last steps).
- **Seed:** port `chat/timeline/TimelineRow.tsx` (834), `RowFrame.tsx`, `TimelineActions.tsx`, `chat/GateScroll.tsx`, `chat/UsageFooter.tsx`
  behaviour; the list contract from `app/chats/[id].tsx`.

### MB-08 UserMessage

- **Web** B-14 UserMessage · **Folder** `blocks/TranscriptView/parts/UserMessage` (exported as its own block entry for TaskDetail) · **Phase** M6-02
- **Spec:** end-aligned bubble, max-w 320 (iOS) / 330 (Android) (80 % on tablets, max 380), `bg-raised` + 1px `border-line-soft`, `transcript`
  16/1.45, iOS pad 11 14 radius 20 20 6 20; Android pad 12 16 radius 20 20 4 20 (tail on the end-bottom corner; mirrored in RTL); attachment
  chips above the text; inline code MP-42. Meta row "You" + mono time (AgentGlyph `you`). Long-press → Menu: Copy, Fork from here (`fork-chat`),
  Rewind to here (→ MB-32). Pending (optimistic) at 60 % opacity with a clock glyph.
- **Boards:** Main, MComponents. **Seed:** port `chat/timeline/UserMessageRow.tsx`.

### MB-09 AgentTurnHeader

- **Web** B-15 AgentTurnHeader · **Folder** `blocks/TranscriptView/parts/AgentTurnHeader` · **Phase** M6-02
- **Spec:** MP-37 AgentGlyph (agent: bot 14/16 + name 600 `text-fg-2` + model `text-fg-3`; model only: no icon; team; worker) + mono time
  end; `footnote` 13 (iOS) / 14 (Android); actions IconButton sm `more` (`assistant-message-actions`: Copy, Copy transcript
  (`copy-transcript`), Fork (`fork-chat`), Read aloud (existing `useTextToSpeech`)). Collapsed-turn summary "6 steps · 2m 44s".
- **Boards:** MComponents "Agent label vs model only". **Seed:** port header part of `TimelineRow.tsx`.

### MB-10 AssistantText

- **Web** B-19 AssistantText · **Folder** `blocks/AssistantText` (also used by Plan, skill detail, agent instructions preview) · **Phase** M6-02
- **Spec (MD-40, gated):** markdown rendered block by block from the existing segmenter (`markdownModel.ts`, moved to
  `blocks/AssistantText/model/`). Engine: `react-native-enriched-markdown` if the M1 spike passes (60 fps streaming 2,000 lines on mid-range
  Android, selection + copy work); else the current `marked` → RN renderer restyled. Prose `transcript` 16/1.5, headings 20/17/16 600,
  lists, tables (horizontal scroll), code blocks MP-42 (copy, wrap), inline code, links (`linkPolicy.ts`: external → in-app browser,
  `generatorai://` validated against the shared allowlist), images (`MarkdownImage` → expo-image with lightbox). Streaming-safe
  (incomplete markdown). Selectable text.
- **Boards:** Main, MPanePlan, MSkillDetail. **Seed:** port `markdown/Markdown.tsx`, `MarkdownImage.tsx`, `markdownModel.ts`, `linkPolicy.ts`,
  `CodeBlock.tsx`, `highlight.ts` (→ `ui/lib/highlight.ts`), `syntaxColors.ts`.

### MB-11 StepRow

- **Web** B-17 StepRow / StepRail · **Folder** `blocks/TranscriptView/parts/StepRow` · **Phase** M6-02
- **Spec:** one tool step: `min-h-step` 44/48, pad 4 12 4 14; step glyph 16 (status via `toolCallStatus` → StatusState:
  `circle-check` `text-ok`, `circle-x` `text-err`, Spinner `run`); verb 15/600 (`TimelineStep.verb` from `toolStepVerb`/`STEP_VERBS`) + mono 13
  target `text-fg-2` (truncate middle for paths); optional second line: outcome ("3 of 20 failed" `text-err`, "50 of 50 passed" `text-ok`,
  DiffStat for edits); mono duration 12 `text-fg-3` (`formatStepDuration`); `chevron-right` 14 → MB-14 StepDetail. Compact form (chat tool
  line, MChatWorkflowRun): glyph 16 + mono tool name `text-fg-2` + target + duration, min-h 24 (not interactive; inside a card whose hit is
  larger). Inline failure excerpt → MB-16. Shell steps: long-press menu "Open in terminal" (`TRANSCRIPT_COPY.openInTerminal`, needs step-up).
- **Shared logic:** `TimelineStep`, `StepKind`, `STEP_VERBS`, `toolStepVerb`, `toolStepKind`, `humanizeToolName`, `formatStepDuration`,
  `toolCallFailed`, `toolCallErrorText`, `resolveInlineHunks`.
- **Boards:** MChatToolsExpanded, MComponents tool block expanded. **Seed:** port step parts of `TimelineRow.tsx`, `chat/toolPresentation.ts`
  (deleted when client-core owns presentation), `chat/timeline/InlineDiff.tsx`.

### MB-12 ToolCallCard (+ registry)

- **Web** B-18 ToolCallCard + tool-card registry · **Folder** `blocks/TranscriptView/cards/` (`registry.ts`, `ToolCallCard.tsx`) · **Phase** M6-02
- **Spec:** a StepRow with an attached card for tools that have a registered renderer: `registerToolCard({ match, verb, target, result, render })`
  (the web registry signature). Mobile registrations: `run_workflow` → MB-18 WorkflowRunCard, `check_workflow_run` → MB-18 ApprovalCard,
  `create_workflow_draft` → MB-18 DraftCard, file edits → inline diff (`resolveInlineHunks`, max `INLINE_DIFF_MAX_LINES` 160, "Open full diff"),
  screenshots → image tile (`TimelineStep.image`, "Open screenshot"), `spawn_background_agent` → MB-17. Card frame: `rounded-card` 14/12, 1px
  `border-line-soft`, pad 12.
- **Boards:** MChatWorkflowRun. **Seed:** new.

### MB-13 StepGroupCard ("tool block")

- **Web** part of B-24 TurnBody (`groupSteps` group rows) · **Folder** `blocks/TranscriptView/parts/StepGroupCard` · **Phase** M6-02
- **Spec:** consecutive tool calls read as **one step** (principle 7). Collapsed: pad 11 12 (iOS) / 12 12 12 14 (Android), `rounded-card`,
  1px `border-line-soft`; `layers` 18 `text-fg-2`; title 15/600 summarising in words ("Read 3 files, ran 2 commands, edited 1 file" —
  built from `StepGroup` + `STEP_VERBS[kind].group(n)` joined); sub `footnote`: "1 failed" `text-err` · mono "6 steps · 2m 44s"; `chevron-down`.
  Running: Spinner, title "Reading files… 3 so far" (`groupLive` + count), sub = current verb + mono target + `text-run` timer; optional
  current-step sub-row h40 indented 28/30 with a top divider. Expanded in place: `bg-raised` step list of MB-11 rows (`chevron-up`). Border
  `border-line` while running.
- **Shared logic:** `groupSteps`, `StepGroup`, `TimelineEntry`, `MIN_GROUP`, `STEP_VERBS`, `computeLiveCounters`.
- **A11y:** role `button`, `expanded`; label "Tool steps: Read 3 files, ran 2 commands, edited 1 file, 1 failed, 6 steps, 2 minutes 44 seconds".
- **Boards:** Main, MChatRunning, MChatToolsExpanded, MComponents "Transcript kit". **Seed:** new.

### MB-14 StepDetail

- **Web** none (web expands inline) · **Folder** `blocks/StepDetail` (pushed screen body used by chat and run stage chat) · **Phase** M6-02
- **Spec:** pushed screen `/chats/[id]/steps/[stepId]` (and the run-stage twin): header detail with breadcrumb "<chat> › Step 4 of 6" (the
  step segment is plain text), title = kind noun ("Command", "Edit", "Read"); ⋯ menu Copy command, Copy output, Share. Body: step heading
  (glyph 20 + verb 17/600 (iOS) / 16/600 + mono 14 target), ML-24 FactStrip (StatusBadge, Exit code, Duration), context line (`clock` 14 +
  mono time · `git-branch` 14 + mono "codebase · branch", labelled "Codebase"), "Input" MP-42 block, error MP-45 Callout (`err`: "Process exited
  with code 1", summary), "Output" MP-42 block with "last N of M lines" + "Show all" (fetches full output), per-kind bodies (Edit → MB-24
  DiffView inline; Read → MB-26 excerpt). ML-27 BottomToolbar: ↑/↓ step navigation ("Previous step: <verb target>"), "Copy", primary "Open in
  terminal" only for shell steps (the screen's one primary; step-up required).
- **Data:** `useStep(chatId, stepId)` (derived from the transcript cache; full output via `useToolOutput(callId)`).
- **States:** failed, succeeded, running (live output tail once MG-37 lands; until then "Output arrives when the command finishes").
- **Boards:** MChatStepDetail. **Seed:** new (parts of `chat/panes/InspectorSection.tsx`).

### MB-15 GateCard (permission, question, plan, computer consent)

- **Web** B-20 GateCard family + C-30 GateCardFrame · **Folder** `blocks/GateCard` (`GateCardFrame.tsx`, `PermissionCard.tsx`, `QuestionCard.tsx`,
  `PlanCard.tsx`, `ComputerConsentCard.tsx`, `ResolvedGateRow.tsx`) · **Phase** M6-03
- **Frame (MD-50):** 1px `border-line`, `rounded-card-lg` 20/16, `bg-raised`, overflow hidden; header h40 (iOS) / h44 (Android) on `bg-warn-bg`:
  `hand` 16/18 `text-warn` + title 15/600 (iOS) / 16/600 (Android) + end meta (`caption` `text-fg-3`: risk category "Network", "1 of 1",
  "5 steps"); body pad 12 14 (iOS) / 12 16 (Android); actions row per `GATE_ACTIONS[kind]` in display order with roles →
  Button variants (`primary` → primary, `secondary` → secondary, `danger` → destructive, `quiet` → ghost). iOS actions: equal-width
  side-by-side `md` (Deny · Allow once); Android: end-aligned (`quiet` start). Resolved → collapses to `ResolvedGateRow` (min-h 40, `rounded-card`,
  1px `border-line-soft`: "✓ Allowed once `git push …`", "✕ Denied", "Answered", "Approved"; words from `*_GATE_COPY`). Expired → header
  neutral, body `PERMISSION_GATE_COPY.expired`, no actions.
- **Kinds:**
  - **permission:** mono command block (MP-42 `rounded-code`, 13), explanation 13/14 `text-fg-3`; actions `deny` (secondary), `allow_once`
    (primary); `deny` opens an inline reason Input (`denyReasonLabel`) with `cancel_deny` (quiet) + `confirm_deny` (danger). No "Always allow"
    (MD-55). Risky (server `risk` flag, or until it exists: shell / network / git push, MD-31) → Allow once runs the biometric-signed approval
    (`services/auth` approval key, bypasses the 10-minute step-up cache); devices without biometrics/passcode show the action disabled with
    reason "Needs Face ID or a passcode on this device".
  - **question:** prompt 15, options as RadioGroup rows (min-h 44/48; mono inline), free-text Input when the question allows it; `skip_questions`
    (quiet "Skip"), `next_question` (multi-question), `submit_answers` (primary "Answer").
  - **plan:** plan title 15/600, numbered steps (mono index), "N more steps" Link → `open_plan` (pane Plan tab); `request_changes` (secondary)
    → feedback Textarea + `send_feedback`/`cancel_feedback`; `approve` (primary); `approve_autopilot` only when the server lists
    `implement_autopilot`.
  - **computer_consent:** app/window name + what the agent wants; options from `consentAnswerOptions(prompt)`; `consent_deny`,
    `consent_always_allow` (only when not synthetic), `consent_allow_run`, `consent_allow_once` (primary).
- **Shared logic:** `GATE_KINDS`, `GateKind`, `GATE_ACTIONS`, `GateActionDef`, `gateLifecycle`, `GateStatusMap`, `PERMISSION_GATE_COPY`,
  `QUESTION_GATE_COPY`, `PLAN_GATE_COPY`, `COMPUTER_CONSENT_GATE_COPY` (shared); `selectPendingConsent`, `consentAnswerOptions` (client-core
  `computer/`); mobile `gateFromInteraction.ts`, `gateActions.ts`, `permissionPreview.ts` (moved to `blocks/GateCard/model/`).
- **Data:** `useAnswerGate(chatId)` (idempotent; answered-elsewhere → resolved state "Answered on another device"), `useSignedApproval()`.
- **Haptic:** `success` / `warning` after the server confirms; `error` on error (Toast error + card stays pending).
- **A11y / testIDs:** action labels from `PERMISSION_GATE_COPY.actionLabel(action, tool)` ("Allow git push"); the card is a group "Needs you:
  Allow this command?"; `gate-<kind>-<actionId>` testIDs. Keyboard (iPad): `GATE_KEY_BINDINGS` (Esc / ↵ / ⌘↵) with MP-39 hints.
- **Boards:** Main, MComponents Permission / Question / Plan, MPanePlan (footer), MPaneComputer (consent). **Seed:** port
  `chat/PermissionCard.tsx`, `QuestionCard.tsx`, `PlanCard.tsx`, `home/useGateDecision.ts`.

### MB-16 InlineError

- **Web** B-21 InlineError · **Folder** `blocks/TranscriptView/parts/InlineError` · **Phase** M6-02
- **Spec:** mono 12/18, pad 10 12, radius 10 (iOS) / 8 (Android), `bg-sunken`, 1px `border-line-soft`, `text-err` first line ("✕ applies coupon ›
  total reflects discount"), then plain lines (Expected / Received / location); indented 38/40 under its step; max 12 lines + "Show all".
  Also renders `SystemBlock` errors/warnings (`warning` → `text-warn` glyph, text `text-fg`).
- **Boards:** MChatToolsExpanded. **Seed:** port error branch of `TimelineRow.tsx`.

### MB-17 DelegationGroup (+ BackgroundTasksCard)

- **Web** B-22 DelegationGroup · **Folder** `blocks/DelegationGroup` · **Phase** M6-02
- **Spec:** in-transcript card for an orchestrator's delegated work: `rounded-card` 14/12, 1px `border-line-soft`; header link h40 (`list-tree` 16,
  "Background tasks" 13/600, Count, "Open ›" → pane Tasks tab); task rows min-h 44/48: status glyph 16, title 14, AgentGlyph 12 worker name
  `text-fg-3`, mono elapsed or "Queued"; header summary "Delegated 4 tasks — 1 running · 1 needs you · 1 done · 1 queued"
  (`TRANSCRIPT_COPY.delegated(n)` + `computeLiveCounters` / `countRunningBackgroundTasks`). Row press → worker chat (`workerChatId`,
  "Open worker chat").
- **Shared logic:** `spawnWorkerRef`, `backgroundDigests`, `backgroundTaskStatus`, `countRunningBackgroundTasks`.
- **Data:** `useBackgroundTasks(chatId)` (shared with MB-30).
- **Boards:** MChatRunning. **Seed:** port worker rendering in `deriveTimeline` consumers, `chat/panes/useTasksSummary.ts`.

### MB-18 WorkflowRunCard / ApprovalCard / DraftCard (chat tool cards)

- **Web** WF-12 / WF-13 / WF-14 · **Folder** `blocks/WorkflowToolCards` · **Phase** M6-02 (renders once the Workflow Overhaul APIs exist; until then the StepRow alone renders)
- **WorkflowRunCard** (`run_workflow`): `rounded-card`, 1px `border-line-soft`: `workflows` 18 + name 15/600 + mono "#249" + StatusBadge sm;
  "Stage 2 of 6 · Assess risk" … "v7 · 3m 12s"; MP-15 segments + "2/6"; Button secondary sm "Open run" (`external-link`).
- **ApprovalCard** (`check_workflow_run`): MB-15 frame (MD-50): header "Review <stage>" + mono "round 1 of 3"; summary 15 + Link "View in run";
  actions Reject (destructive ghost), Request changes (secondary), Approve (primary) — on phones ≤ 402 pt the three buttons stack as Approve
  full-width + a row [Reject | Request changes]; Approve opens MB-50 ApprovalSheet when the gate is risky (MD-31), else answers inline.
  Footnote "Approving here uses the same command as the run page".
- **DraftCard** (`create_workflow_draft`): name + neutral Badge "✦ Agent draft"; "4 stages · payments-service · Not published"; risk Badges
  `outline` ("Writes files", "Opens a PR" — neutral, MD-25); Buttons "Open in builder" (secondary; → builder when MD-04 allows) + "Publish"
  (secondary; confirm).
- **Shared logic:** `runTitle`, `STATUS_MAPS.workflowRun` via `resolveStatus`; workflow command API from the Overhaul (P03).
- **Boards:** MChatWorkflowRun. **Seed:** port `runs/ApprovalCard.tsx`, `home/DecisionCard.tsx` parts.

### MB-19 AttentionList

- **Web** B-25 AttentionRow / AttentionList · **Folder** `blocks/AttentionList` · **Phase** M5-02 (drawer) / M7-01 (Home)
- **Spec:** the Needs you / Running lists. Variants:
  - `drawer-needs`: min-h 44/48, pad 0 12, `rounded` 12 (iOS) / `rounded-full` (Android), `hand` 16 `text-warn`, title 15, trailing hint 13
    `text-fg-3` (ask verb: "Approve", "git push", "Plan").
  - `drawer-running`: Spinner 14, title 15 `text-fg-2`, mono 12 elapsed.
  - `home-needs`: EntityRow in a Home group (min-h 62 → `min-h-row` 52 raised to fit two lines = 62/68), glyph 18, title 16/500, context line 13
    ("#248 · Approve Apply upgrades", "Bug Fixer wants to run `git push`", "Plan ready to review · 5 steps"), trailing Button `tonal sm`
    "Review" / "Open" (hit 44/48).
  - `home-running`: title, project · agent / "Orchestrator · 2 tasks" / "Stage 2 of 4", mono `text-run` elapsed.
  - `palette`: search result rows.
  Rows navigate with the `AttentionItem → route` helper (MD-34: new additive client-core export `attentionItemRoute(item, serverId)`),
  which also carries `?dock=` (R-4). Resolved items leave the list with a layout animation.
- **Shared logic:** `createAttentionStore`, `attentionReducer`, `selectNeedsYou`, `selectRunning`, `selectCounts`, `selectAttentionFor`,
  `ATTENTION_STREAM_FILTER`, `applyAttentionEvent` (client-core `attention/`); `AttentionItem`, `AttentionAsk`, `AttentionCounts` (shared types).
- **Data:** `useAttention()` (one store per server runtime, MD-05), `useTicker()` (1 s, paused in background).
- **States:** empty (drawer: section hidden; Home: EmptyState `needsYou` / `running`), overflow ("Show all (N)"), loading, offline (stale
  badge "Last updated 14:06").
- **A11y:** row label "<title>, needs you, <ask>"; Review button label "Review <title>".
- **Boards:** MSidebar, MHome, MHomeMore, MSearch (recents), MWidgets (content model). **Seed:** port `home/ApprovalsQueue.tsx`,
  `home/OperationCard.tsx`, `home/operationActions.ts`, `home/operationStatus.ts`, `home/OperationAction.tsx`.

### MB-20 ServerSwitcher

- **Web** S-02 ServerSwitcher button + popover · **Folder** `blocks/ServerSwitcher` · **Phase** M5-07
- **Spec (MD-05):** `trigger` form (drawer header, Settings root server card) and the `sheet` (route sheet `/servers`, `medium` detent): header
  ✕ + "Servers"; rows min-h 64 (iOS) / 72 (Android): current server `bg-selected`, `device` 20, name 17/600 (iOS) / 16/600, StatusDot + "Connected ·
  local:3100" (mono address), trailing ✓; offline: `server` `text-fg-3`, hollow dot "Offline · 10.0.4.12:3100", trailing ghost "Retry";
  revoked: "Pairing revoked" + "Pair again"; switching: Spinner. Second group: "Add server…" ("Scan or enter code" → pairing route),
  "Manage servers" (→ Settings › Security & devices). Footnote "Each server has its own pairing. Switching reconnects Home, chats and live runs
  to that server." Single server: the trigger still opens the sheet (Add server lives there).
- **Shared logic:** `probeServer` (`packages/client-runtime/src/connections.ts`); one `AuthenticatedClientRuntime` per server; session storage
  keyed by server id; `HEALTH` tones.
- **Data:** `useServers()` (client-side list), `useServerProbe(serverId)` (reachability), `useSwitchServer()`, `useServerInfo(serverId)` (`/system/info` name, version).
- **Native pieces:** iOS local-network permission prompt on first LAN probe (→ MP-35 `localNetwork`).
- **Boards:** MServers, MSidebar header, MSettings server card. **Seed:** new (multi-server is new; `auth/stores.ts` session keying is extended in M2).

### MB-21 SearchPalette

- **Web** S-10 CommandPaletteFrame + C-21 CommandList (features/palette) · **Folder** `blocks/SearchPalette` · **Phase** M5-06
- **Spec:** route `fullScreenModal`-like search screen (`/search`, iOS no header, ML-28 SearchHeader; Android M3 search view). Empty query →
  Recents (recent chats with StatusBadge, recent destinations) + Actions. Results grouped: Workflows ("Run “Nightly dependency audit”" row
  `min-h-row` 52/56 with ↗), Go to (`min-h-row` 52/56, trailing hint "daily 02:00"), Actions (from `COMMANDS` filtered to mobile-available ids: `chat.new`,
  `workflow.new`, `project.new`, `automation.new`, `agent.new`, `app.settings`, `theme.toggle` → cycles System/Light/Dark and says so), Recent
  chats (EntityRow with status glyph first, principle 8). Group labels 13/600 `text-fg-3` (iOS) / 14/600 `text-fg-2` (Android). Match
  highlight = weight **600** + `text-fg` (not 700). Hardware keyboard ↑/↓/↵/Esc (`palette.next|prev|open|close`), selected row `bg-selected`.
- **Shared logic:** `COMMANDS`, `NAV_DESTINATIONS`, `isRendererCommandId`, `fuzzyMatch` (client-core composer), `searchModel.ts` (moved from
  `components/search/searchModel.ts`); `lib/fuzzyMatch.ts` is deleted in favour of the client-core one.
- **Data:** `useServerSearch(query)` (debounced 150 ms; chats v2 server search + workflows/automations/projects), `useRecents()`.
- **States:** empty query, searching (Spinner in the header), no results (`EMPTY_STATE_COPY.searchResults`), offline (local actions only, note).
- **A11y:** result count announced; rows role `button`. **Boards:** MSearch, MSidebar (entry). **Seed:** port `app/search.tsx`,
  `search/SearchResultRow.tsx`, `search/searchModel.ts`.

### MB-22 ChangesPanel (ChangeFileRow, CompareBar, MountGroupsBar, CommitBar)

- **Web** `blocks/changes` (ChangesPanel, ChangeFileRow, CompareBar, MountGroupsBar, ChangesToolbar) + `blocks/scm` CommitBar · **Folder**
  `blocks/ChangesPanel` · **Phase** M6-07
- **Spec:** the pane's Changes tab (and the iPad docked column). Toolbar: DiffStat "+18 −8 · 2 files" + branch Chip `mono` ("fix/checkout-flake");
  CompareBar: MP-23 "This turn / This chat / Branch vs main" (3-way on phones too, aligning with iPad; overflow → Select) + mount Select when
  > 1 mount (MountGroupsBar); MB-32 CheckpointScrubber card; PendingCommentsBar (card `rounded-card`: "1 pending comment · applyCoupon.ts · L20 ·
  Fix", eye IconButton "Preview comments", Button sm "Send all"); **Keep / Keep all / Undo all** (MD-07: toolbar Buttons sm "Keep all"
  (`changes-tray-keep-all`) and "Undo all" (`changes-tray-undo-all`, destructive, confirm); per-file Keep/Unkeep in the row menu; a "Kept (N)"
  group); groups "Changed in this chat (N)" and "Also changed in the workspace (N)" (ListSection: iOS filled `bg-raised` `rounded-card` 14,
  rows `min-h-item`; Android outlined radius 12 1px `border-line-soft`, rows 56); ChangeFileRow: status letter mono (`CHANGE_KIND`: M
  `text-warn`, A `text-ok`, D `text-err`, R `text-run`, U/I `text-fg-3`), path with dimmed dir (`text-fg-3` dir + `text-fg` name, middle
  truncation; renamed shows old → new), comment count, DiffStat, row action IconButton sm ⋯/⋮ (36/40 drawn, 44/48 hit); tap → MB-24 Diff
  (pushed); long-press or ⋯ → ContextMenu: Open diff, Mention in chat, Copy path, Keep / Unkeep (`keep-file` / `unkeep-file`), Discard changes
  (destructive → MP-29 confirm "Discard changes to <file>?"). Footer CommitBar: "N files ready · into <branch>" + primary "Commit…" (→ MB-23);
  merge-in-progress banner (`scm-merge-in-progress`) with conflict actions.
- **Shared logic:** `CHANGE_KIND`, `ChangeKindValue` (shared status/health); `parseUnifiedDiff` (client-core diff); mobile `diffModel.ts`,
  `keptModel.ts`, `changeTree.ts`, `scmModel.ts`, `scmResults.ts`, `prModel.ts` (moved into `blocks/ChangesPanel/model/`); the kept-files
  semantics of web `useKeptFiles`.
- **Data:** `useChanges(workspaceId, compare, mount)`, `useChangesStream(workspaceId)`, `useKeep()`, `useKeepAll()`, `useUndoAll()`,
  `useDiscardFile()`, `usePendingComments(chatId)`, `useSendComments()`, `useScmState(workspaceId)`.
- **iOS vs Android:** filled vs outlined groups; Button heights; menus with preview vs anchored.
- **States:** loading, empty ("No changes yet"), not a git repo, merge in progress, conflicts (`ScmConflictCard` port), offline.
- **Boards:** MPaneOpen, MPaneChanges, MTabletIOS, MComponents "Right pane shell". **Seed:** port `changes/ChangesList.tsx`, `CommitBar.tsx`,
  `Toolbar.tsx`, `api.ts` (→ queries), `useChangesSummary.ts`, `chat/workbench/ChangesSection.tsx` (591), `chat/panes/ChangesTray.tsx`,
  `scm/ConflictSheet.tsx`.

### MB-23 CommitSheet

- **Web** `blocks/scm` CommitBar flow + PR form · **Folder** `blocks/CommitSheet` · **Phase** M6-07
- **Spec:** route sheet `/workspaces/[workspaceId]/commit` (`04-screen-map.md` §1.2; used from the chat and the run pane), `large` detent; header "Commit & pull request" (`title` 20/600 iOS / 22/600 Android)
  + ✕. Section Commit: "into `<branch>`", message Textarea ("Empty uses “Workspace snapshot at 14:05”"), helper "Commits all N files", mount
  Select when > 1 mount, Generate (text button, when the server offers message generation), "Push" Switch row, "Open a pull request" Switch
  row. Section Pull request (when on): base branch as a text field (D-68: readiness returns no branch list) ← head chip, Title Input,
  Description Textarea, "Open as draft" Switch row + sub-label. Footer: one `lg` primary whose label follows the switches: "Commit" /
  "Commit & push" / "Commit, push & open PR" (`scm/flow`, MD-85, MDF-60). Phases: `form` → `working` (MP-13 "Committing…") → `done` (shrinks to the `content` detent: PRResultCard — number, title,
  base ← head, commits, "Open in browser" Link (external), "Copy link") → `error` (Callout err + Retry). GitHub not connected → "Connect GitHub"
  (device login flow, `scm/deviceLogin.ts`).
- **Data:** `useScmReadiness(workspaceId)`, `useScmFlow(workspaceId)` (`POST …/scm/flow`), `useGenerateMessage(workspaceId)`, `useGitHubConnection()` (MG-22 wrappers).
- **Boards:** MPaneCommit, MPaneCommitDone. **Seed:** port `scm/ScmFlowSheet.tsx`, `scm/ConnectGitHubSheet.tsx`, `scm/deviceLogin.ts`,
  `scm/api.ts`, `scm/useScmApi.ts`, `scm/useScmResults.ts`.

### MB-24 DiffView (+ InlineCommentComposer)

- **Web** B-07 DiffView (+ review overlay) · **Folder** `blocks/DiffView` · **Phase** M6-07
- **Spec (MD-39, MD-61):** native virtualised rows (Legend List) of mono 12/19 `Text`, computed from `parseUnifiedDiff` + `toDiffList`; unified
  layout on phones (split only at `expanded` width when the file is ≥ 700 pt wide — current behaviour kept); two line-number columns (old / new,
  40 wide total 2×24 at mono 12, `text-fg-3`) + 16 sign column (`−` `text-err`, `+` `text-ok`), row fills `bg-del-bg` / `bg-add-bg`, hunk header
  rows `bg-sunken` 12 `text-fg-3`; token colours via `ui/lib/highlight.ts` (bounded); Wrap toggle (Chip `filter` "Wrap"); horizontal scroll when
  not wrapped (blocks the panel pan); selected line ring 1.5px `border-fg-2` radius 4. Tap the gutter or "Comment" (toolbar, enabled with a
  selected line) → **InlineCommentComposer** inserted after the line: card `rounded` 18/16 `bg-raised` 1px `border-line`: "Comment for <agent>"
  + "L20" + ✕; intent Chips (shared review intents from `packages/shared/src/review.ts`, overflow into a Menu); Textarea `bg-sunken`;
  "Add to review" (secondary) + "Send to agent" (primary: it is a Send). Long-press line → Menu: Comment for agent, Copy line (`longPress` haptic).
  Existing threads inline (draft / pending / submitted / addressed / resolved / outdated from `ReviewThreadStatus`). Pushed screen header:
  breadcrumb "Changes › src › cart", title file name mono 15/600 (iOS) / 17/600 (Android), ⋯ (Copy path, Open file, Share); sub-toolbar 44/48:
  status letter, DiffStat, comment count, Wrap; FileNavigatorFooter: "Prev" · "File 1 of 2" · "Next <name> ›" (44/40 buttons).
- **Shared logic:** `parseUnifiedDiff`, `toDiffList`, `DiffRow`, `DiffHunk`, `countRows` (client-core diff); `CHANGE_KIND`; `ReviewThreadStatus`;
  mobile `reviewBatch.ts`, `useReviewThreads.ts` logic, `diffPrefs.ts` (moved).
- **Data:** `useFileDiff(workspaceId, path, compare)`, `useReviewThreads(chatId, path)`, `useAddComment()`, `useSendReview()`.
- **States:** loading, binary, too large ("Open on desktop" note + Copy path), deleted file, no changes, composer open, thread states.
- **A11y:** each row label "Line 20 added: <text>" (old/new spoken explicitly); gutter button "Comment on line 20"; a11y action "Comment" on rows.
- **Boards:** MPaneDiff, MGestures (long-press a diff line). **Seed:** port `changes/FileDiff.tsx` (437), `DiffLine.tsx`, `HunkHeader.tsx`,
  `FileDiffPane.tsx`, `diff/DiffRowView.tsx`, `review/ReviewCommentsSheet.tsx`, `review/reviewBatch.ts`, `review/useReviewThreads.ts`, `review/api.ts`.

### MB-25 FileTree

- **Web** B-08 FileTree + `blocks/files` MountFileTree · **Folder** `blocks/FileTree` · **Phase** M6-08
- **Spec:** the pane's Files tab body: MB-45 SourcesCard on top; filter bar (SearchInput `compact` "Filter files…" + Chip `dropdown` "All sources 2");
  per-mount section header (alias mono 14/500, "Worktree · fix/checkout-flake" mono **12**, "214 files"); rows `min-h-item` 44/48 with 16
  indent per level, `chevron-right`/`chevron-down` 14, `folder` / `file` icons, dirty dot 6 `bg-warn` on folders (with label "has changes"), status
  letter on files; selected `bg-selected`; virtualised (Legend List, flattened tree). Tap file → MB-26 FilePreview (pushed); long-press → ContextMenu:
  Open, Mention in chat, Copy path, Share (downloads to a temp file then the share sheet).
- **Shared logic:** mobile `fileTree.ts`, `recentFiles.ts` (moved); `CHANGE_KIND`.
- **Data:** `useWorkspaceFiles(workspaceId, mount)`, `useFileStatuses(workspaceId)`.
- **States:** loading, empty mount, no filter match, stale file (404 → Toast error).
- **Boards:** MPaneFiles, MCodebaseFiles. **Seed:** port `chat/workbench/FilesSection.tsx` (500).

### MB-26 FilePreview (FileViewer)

- **Web** B-09 FileViewer · **Folder** `blocks/FilePreview` · **Phase** M6-08
- **Spec:** pushed screen `Files › <mount> › <dir>`; header actions Copy path + ⋯; meta bar "M · 71 lines · 2.1 KB · TypeScript" + Wrap Chip; body:
  virtualised mono rows (same renderer as MB-24) with a 44 line-number gutter, changed lines marked with a 3px start bar `bg-ok` + `bg-add-bg`
  fill, token colours (bounded), horizontal scroll unless wrapped; images → expo-image with zoom; markdown → toggle "Preview" (MB-10); binary /
  too large states. Footer (ML-27): "View diff" (secondary, when changed) + "Mention in chat" (primary).
- **Data:** `useFileContent(workspaceId, path)`, `useFileChangedRanges(workspaceId, path, compare)`.
- **Boards:** MPaneFilePreview, MCodebaseFiles. **Seed:** new (parts of `FilesSection.tsx`).

### MB-27 TerminalView + KeyRow

- **Web** B-10 TerminalView + C-24 TerminalFrame (`blocks/terminal`) · **Folder** `blocks/TerminalView` (`TerminalView.tsx`, `KeyRow.tsx`,
  `TerminalToolbar.tsx`, `TerminalStatusFooter.tsx`, `SelectionMenu.tsx`) · **Phase** M6-09
- **Spec (MD-38):** xterm.js in `react-native-webview` 14 (the existing `terminalHtml.ts` + `bridgeProtocol.ts`), themed from
  `resolveTerminalPalette` / `useThemeColors().terminal` (no hex fallback). The surface owns keys and gestures (`ownsKeys` → the shell disables
  edge-open, MD-19). Instances: ML-08 `instanceChips` ("Terminal", "Terminal 2", "Agent commands 4" read-only view; "+" New terminal; cap
  `DOCK_TAB_CAPS.terminal` 4). Toolbar h40/48: Badge "pty" (or "fallback"), StatusBadge sm Running "Agent working", "Attach N lines" Chip (with a
  selection), Find (IconButton → find bar with ↑/↓/count), Clear (full screen only), Kill (destructive ghost + `power`; confirm "Kill <name>?
  Stops `<command>` mid-run"). Container `bg-sunken` `rounded-card` 14/12 1px `border-line-soft`. Status footer h40: Spinner + "node running ·
  pwsh 7.5 · pid 18244 · 44×31" (cols × rows computed from the measured size and font; sent to the server on resize, including keyboard
  show/hide).
- **KeyRow** (one spec both OSes, MD-38): bar h48 on `bg-sunken`, keys h40 (drawn 36 → raised; hit 44/48 via 2px vertical slop), min-w 44,
  `rounded` 8, `bg-selected`, mono 14: **esc, tab, ctrl (sticky), alt (sticky), ^C, ←, ↑, ↓, →, paste, find**; sticky modifiers latched =
  `bg-fg text-surface`; horizontally scrollable if the width is short. Hosted in ML-29 `KeyboardStickyBar`; hidden when a hardware keyboard
  is attached (hardware keys pass through). Pinch changes the font size 10–20 with a `fontStep` haptic per step and a transient pill "14 pt"; the
  button equivalent is A− / A+ in the ⋯ menu ("Font size").
- **Selection:** xterm selection inside the WebView; a `selectionchange` bridge message renders the RN SelectionMenu above the selection: iOS
  GlassSurface capsule h40 / Android `bg-overlay` radius 8 h44 + `shadow-pop`: Copy · Attach to chat · Select all.
- **Shared logic:** `bridgeProtocol.ts`, `terminalFocus.ts`, `terminalSettings.ts`, `agentConsoleRows.ts` (moved from `src/terminal/`); web
  `agentConsoleEntries` parity for the Agent commands view.
- **Data:** `useTerminalSessions(workspaceId)`, `useTerminalSession(sessionId)` (WS), `useKillTerminal()`, `useCreateTerminal()`; step-up
  (`services/auth/stepUp`) before opening a user shell (existing 10-minute rule).
- **States:** connecting, running, exited ("Process exited — code 1" + Restart), connection lost (reattach), fallback host, workspace not ready,
  cap reached ("+" hidden, note), agent commands view (read-only blocks).
- **A11y:** the WebView is `accessibilityLabel="Terminal output"`; KeyRow keys are buttons with spoken names ("Control, latched"); Kill has a
  confirm. **Boards:** MPaneTerminal, MPaneTerminalFull, MTabletAndroid, MGestures (terminal keys + pinch).
- **Seed:** port `src/terminal/TerminalView.tsx` (1,129), `TerminalTabs.tsx`, `AgentConsole.tsx`, `terminalHtml.ts`,
  `chat/workbench/TerminalSection.tsx`, `app/terminal/[workspaceId].tsx`.

### MB-28 BrowserView

- **Web** `blocks/browser` (BrowserPanel, BrowserToolbar, AgentBrowsingStrip, CommentsPopover, DeviceEmulationBar) · **Folder**
  `blocks/BrowserView` · **Phase** M6-10
- **Spec (MD-37):** view-only server-streamed frames (expo-image fed by the server's JPEG/MJPEG frame stream; taps sent as viewport coordinates
  to the server's element picker). Page chips (ML-08 `instanceChips`: loading Spinner, globe, ✕; "+" New page; cap `DOCK_TAB_CAPS.browser` 5).
  Nav bar: Back, Forward (disabled `text-fg-3`), Reload, URL pill (h40 `rounded-full` `bg-raised`, mono 13; editable → submit navigates).
  AgentBrowsingStrip (h36 radius 10: Spinner + "<agent> is browsing" + mono "click · button “Apply”") on `bg-selected` (not `bg-run-bg`:
  MD-25). Toolbar: Chip filter "Comment", Chip "Capture screenshot", Chip dropdown device preset ("Responsive"), ⋯ Menu (Stop sharing, Zoom
  100 %, a disabled "Desktop app only" group). Live view `bg-sunken` `rounded-card` 1px `border-line`, pinch-zoom on the stream, numbered
  comment pins, the agent's click ring (26, 2px `border-run`), bottom strip "View only · tap an element to comment · 390 × 844". Comment card
  (`rounded` 18/16): pin, selector mono, author, text, Delete (destructive ghost), "Send to chat" (primary). "In your next message" attachment
  chips.
- **Data:** `useBrowserDescriptor(chatId)`, `useBrowserFrames(pageId)`, `useBrowserAnnotations(pageId)`, `useBrowserCapture()`,
  `useBrowserNavigate()`, `useDevicePreset()`.
- **States:** `poolFull` ("Session limit" card), `loadFailed`, `empty` (MP-32 + "Open a page"), `starting`, `denied`, `degraded` (MPaneBrowserStates;
  cards `rounded` 18 `bg-raised` 1px `border-line-soft`).
- **Boards:** MPaneBrowser, MPaneBrowserStates. **Seed:** port `chat/workbench/BrowserSection.tsx` (471), `chat/composer/browserConfig.ts`.

### MB-29 ComputerView

- **Web** `features/chat/dock/computer` · **Folder** `blocks/ComputerView` · **Phase** M6-10
- **Spec (MD-37):** window title + MP-23 "Now / Replay"; live frame (expo-image, ~12 fps, cursor ring) 236/244 tall aspect-fit; controls:
  Pause / Resume agent (secondary), Stop (destructive, confirm); **"Take over" hidden on phones and tablets**; "Screen video" not rendered;
  consent prompts render MB-15 `computer_consent`; Replay card (expo-video with marker ticks, scrubber with `selection` haptics); Grants list
  (ListSection rows: app, scope, since; "Revoke" destructive ghost + confirm) + audit trail link.
- **Shared logic:** `ComputerDeskState`, `initialComputerDeskState`, `seedComputerDesk`, `applyComputerEvent`, `COMPUTER_DESK_EVENT_KINDS`,
  `selectPendingConsent`, `agentHasControl`, `consentAnswerOptions` (client-core `computer/`).
- **Data:** `useComputerDesk(workspaceId)`, `useComputerFrames(workspaceId)`, `useComputerControl()`, `useComputerGrants()`.
- **Boards:** MPaneComputer. **Seed:** port `chat/panes/ComputerPane.tsx` (358), `chat/panes/computerModel.ts` (replaced by client-core).

### MB-30 TasksList / TaskDetail

- **Web** F-dock-06 Tasks panel · **Folder** `blocks/TasksList` · **Phase** M6-11
- **Spec:** Tasks tab (orchestrator chats only, `DOCK_CONDITIONAL_TABS`): summary card (`rounded-group` 22/16: workers n of max, wave, MP-15
  segmented bar, legend) + MP-23 "All / Active / Done"; TaskRow EntityRow (status glyph, title, AgentGlyph worker + model, elapsed or step, note).
  TaskDetail (in-pane stack, ML-07): header "‹ All tasks · 2 of 4 · ↑ ↓"; brief, review round (n of max + comment), last steps (MB-07 turns,
  compact), files changed; footer "Cancel task" (destructive, confirm) · "Open task chat" (primary). Status words map through `STATUS_MAPS`
  (Starting → Queued label "Starting", In review → Waiting/Needs you, Completed → Succeeded) (MD-25).
- **Shared logic:** `backgroundTaskStatus`, `countRunningBackgroundTasks`, `resolveStatus`.
- **Data:** `useBackgroundTasks(chatId)`, `useCancelTask()` (G-20).
- **Boards:** MPaneTasks, MPaneTaskDetail. **Seed:** port `chat/workbench/TasksSection.tsx`.

### MB-31 PlanView

- **Web** `blocks/plan` PlanPanel · **Folder** `blocks/PlanView` · **Phase** M6-11
- **Spec:** Plan tab: revision bar (MP-23 "v1 / v2 / v3" → Select at > 4 revisions) + meta (path mono, time) + "Edit as new revision" + ⋯
  (Discard plan, destructive + confirm); PlanDocument (MB-10 markdown: title, status, summary, steps list with mono indices, risks); step
  comments (tap a step → comment Textarea; comment chips "Stale" for earlier revisions); decision footer: notes Textarea + "Request changes (n)"
  (secondary) + "Approve plan" (primary) — the same actions as the plan gate (`GATE_ACTIONS.plan`). Needs-you dot on the tab while
  `awaiting_review`.
- **Data:** `usePlan(chatId)`, `usePlanRevisions(chatId)`, `usePlanComments(planId)`, `useAnswerGate` (shared with MB-15).
- **States:** drafting (Spinner), awaiting review, approved (read-only, StatusBadge Succeeded label "Approved"), changes requested, superseded
  (banner "A newer revision exists"), edit conflict (Toast error + reload).
- **Boards:** MPanePlan. **Seed:** port `review/PlanSheet.tsx` (506), `review/planDecisions.ts`, `chat/workbench/PlanSection.tsx`.

### MB-32 CheckpointScrubber

- **Web** `blocks/changes/checkpoints` · **Folder** `blocks/CheckpointScrubber` · **Phase** M6-07
- **Spec:** card `rounded-card` 14/12 `bg-raised`: `history` 18 + "Turn 3 of 4" + mono time + "Compare" Link; track with snap stops (thumb 20
  `bg-fg`; past stops filled `bg-fg-2`; future hollow `bg-surface` + 1px `border-line-strong`), time labels mono **12** (board 11 raised); the
  selected turn's prompt excerpt ("You: “Also cover…”"), DiffStat, and "Rewind to here" (h36 → Menu with scopes: all / conversation / code —
  `rewind-sheet-all`, `rewind-sheet-conversation`, `rewind-sheet-code`; confirm; the server writes a `pre_restore` checkpoint). `selection` haptic
  per stop. Gesture alternative: "Previous turn" / "Next turn" accessibility actions and ‹ › buttons at `fontScale ≥ 1.3`.
- **Data:** `useCheckpoints(chatId)`, `useRewind(chatId)`.
- **Boards:** MPaneOpen, MTabletIOS. **Seed:** port `review/CheckpointsSheet.tsx`, `review/checkpointGroups.ts`, `chat/rewindOptions.ts`,
  `chat/RewindSheet.tsx`.

### MB-33 RunTimeline / StageRow

- **Web** WF-04 StageTableRow, WF-05 RunLifecycleCard · **Folder** `blocks/RunTimeline` · **Phase** M8-03
- **Spec:** the run screen body: LifecycleStrip (Setup phases · "Stages 3/6" · Finalize phases, compact), StageRow list: status glyph, stage name
  16/600, AgentGlyph agent + model, attempt ("attempt 2 of 3 · resume"), mono duration, guard text; expandable to its output card
  (StructuredOutputView: table for arrays of flat objects, key/value tree otherwise) and a compact StepGroupCard; stage ⋯ Menu from the server's
  command list (Retry, Skip, Re-run from here, Open chat). LoopGroup (runtime): header "Fix and review · Loop · 3/5" + IterationChips + exit
  rules. Rows `min-h-item`; grouped (iOS) / flat (Android).
- **Shared logic:** `STATUS_MAPS.stageRun` / `workflowRun` via `resolveStatus`; `runTitle`; Workflow Overhaul read models (P03/P05).
- **Data:** `useWorkflowRun(runId)`, `useRunStream(runId)`, `useRunCommand(runId)`.
- **Boards:** MWorkflowRun, MRunLoop, MRunStageChat. **Seed:** port `runs/StageTimeline.tsx`, `runs/StageTranscriptInline.tsx`,
  `runs/stageTranscript.ts`, `runs/runModel.ts`, `runs/formatTime.ts` (→ `ui/lib/format.ts`).

### MB-34 DecisionCard (+ ReviewCard)

- **Web** WF-08 DecisionCard, WF-09 ReviewCard · **Folder** `blocks/DecisionCard` · **Phase** M8-04
- **Spec:** MB-15 frame (MD-50). ReviewCard: header "Review <stage> · round 1 of 3" + facts ("14 packages · 3 majors · 3 files · 3m"), summary,
  feedback Textarea ("Feedback for <agent> (sent with Request changes)"), actions Reject / Request changes / Approve (layout as MB-18).
  DecisionCard: header "Needs decision · fix_review 5/5 · Paused · max iterations", reason line, commands from the server
  (`grant_iterations`, `raise_budget`, `continue_with_input`, `accept`, `accept_iteration`, `fail`) as Buttons (one primary), inputs where a
  command takes one (NumberField for iterations). Risky → MB-50.
- **Data:** `useRunCommand(runId)`, `useSignedApproval()`.
- **Boards:** MRunLoop, MWorkflowRun, MRunStageChat, MRunApproval. **Seed:** port `home/DecisionCard.tsx`, `runs/FeedbackSheet.tsx`.

### MB-35 RunGraph

- **Web** L-04 canvas / WF-15 (read-only views) · **Folder** `blocks/RunGraph` · **Phase** M8-04
- **Spec (MD-04):** read-only on phones and tablets: nodes as RN `View`s (accessible, text scales: status glyph, name, agent, mono key), edges as
  `react-native-svg` paths (labels "on failure", `when` text), loop groups as framed containers; one Reanimated transform layer driven by RNGH
  pinch / pan / double-tap zoom; zoom column (iOS GlassSurface 44 column "+", "−", "Fit", "List" / Android tonal) ; layout from the shared
  layered layout in client-core (or persisted `position`, P01). Tap a node → stage sheet (StageRow detail). MiniGraph variant (static SVG, one
  button with summary label "6 stages, 1 approval gate, 2 branches"). Skia only if profiling shows jank beyond ~50 nodes.
- **A11y:** the canvas is hidden from a11y; an equivalent list (RunTimeline) is always one tap away ("List" button); each node is also an
  `accessibilityElement` in reading order.
- **Data:** `useWorkflowGraph(workflowId, version)`, `useWorkflowRun(runId)` (statuses).
- **Boards:** MRunGraph, MBuilderGraph (read-only), MWorkflowDetail (mini). **Seed:** port `work/workflowGraph.ts`.

### MB-36 VariableForm

- **Web** WF run dialog variables (L-05) · **Folder** `blocks/VariableForm` · **Phase** M8-02
- **Spec:** one input per `VariableDefinition`: string → Input; text → Textarea; number → NumberField; boolean → Switch row; choice → Select;
  list → Chip `input` list + "Add"; json → mono Textarea with parse status. Required marker, help, error per field (MP-19), reserved names
  rejected. Used by the run sheet (workflow launch), automation create step 5, trigger input for scripts/automations.
- **Shared logic:** `@generatorai/workflow-spec` validation; mobile `variableForm.ts`, `triggerInput.ts`, `stageOverrideForm.ts` (moved).
- **Boards:** MWorkflowLaunch, MAutomationCreate4, MWorkflowSettings. **Seed:** port `work/TriggerInputSheet.tsx`, `work/variableForm.ts`.

### MB-37 ValidationList

- **Web** WF-03 ProblemsPanel · **Folder** `blocks/ValidationList` · **Phase** M8-05
- **Spec:** sheet body: header "3 errors · 1 warning" + "checked 14:07" + "Check again" (ghost); rows (glyph `circle-x` err / `warning` warn,
  message, mono path/stage key, hint, "Go to" / "Fix" buttons; "Fix" only when a fix payload exists, MG-33). Banner "Publish and Run
  are blocked until the errors are fixed. Save still works." (Callout warn).
- **Shared logic:** `@generatorai/workflow-spec` client-side validate; server `POST /workflow-definitions/validate`.
- **Boards:** MWorkflowValidate. **Seed:** new.

### MB-38 ScopeRequestCard

- **Web** none (web admin approves) · **Folder** `blocks/ScopeRequestCard` · **Phase** M7-07
- **Spec (MD-30):** card board r22 (iOS) → `rounded-card-lg` 20/16 (MD-50), 1px `border-line`, `bg-raised`; header h44/h48 `bg-selected`
  (neutral, not warn): `lock` 18 + "This device can't <verb>" 16/600; body `subhead` `text-fg-2`; scope checklist (ListRow `check`: label, mono
  scope id, "Sensitive" Badge `outline` with `warning` 12 in `text-warn` glyph only); "Reason (optional)" Input; ML-21 inline stepper "1 Request →
  2 Admin approves → 3 Edit"; "Check again" (ghost) + "Request access" (primary). States: not requested, pending ("Waiting for an admin"),
  approved (writes enabled; biometric step-up per write), denied / expired (reason + "Request again").
- **Data:** `useMyScopes()`, `useScopeCatalog()`, `useMyScopeRequests()` (`/auth/devices/me/scope-requests`, self-service), `useRequestScopes()`.
  Self-service **read** routes are MG-01 (MD-30).
- **Boards:** MScopeRequest, MSettings (requires-admin rows). **Seed:** port `auth/scopeRequests.ts`, `auth/scopeLabels.ts`, `review/scopes.ts`,
  `review/useScopes.ts`, `devices/EditScopesSheet.tsx` (list parts).

### MB-39 QrScanner

- **Web** none · **Folder** `blocks/QrScanner` · **Native backing** `expo-camera` barcode scanning (`barcodeScannerSettings: { barcodeTypes: ['qr'] }`)
  · **Phase** M7-08
- **Spec:** viewfinder h220, `rounded` 28 (iOS) / 20 (Android), `bg-sunken`, 148 frame with 34 L-corners (4px `border-fg`, radius 16) and a scan
  line (static under Reduce Motion); caption "Point at the QR code on your computer"; torch IconButton (iOS glass 44 / Android tonal 48) "Torch".
  Parses `generatorai://pair?code=…&host=…` via the shared deep-link allowlist; a scan **pre-fills** code + address, never submits (MD-34).
  States: permission undetermined / denied (MP-35 `camera` inline), no camera (simulator, some tablets: hidden, "Enter the code" only), scanning,
  success (`success` haptic only after the server accepts the code on Connect).
- **Used by:** Pairing (first run), Servers "Add server…", Settings › Security › Pair (scan another device's code is not a flow; only these two).
- **Boards:** MPairing. **Seed:** port the camera part of `app/pair.tsx`.

### MB-40 StatsCards

- **Web** C-10 StatStrip bound to stats (Home, automations) · **Folder** `blocks/StatsCards` · **Phase** M7-01
- **Spec:** binds `/stats/summary` (D-58) and `/system/info` to ML-18: Home count tiles (Need you / Running / Finished today), "This week" strip
  (Chats, Runs, Succeeded %, Avg run — `runs.avgDurationMs` exists (NG-03); a value absent for a zero denominator is omitted, MD-27), automation StatsStrip (runs, success
  rate, median duration, last). Server footer link (dot + "This computer" + mono "local:3100 · 0.0.1-alpha.1" + chevron → MB-20).
- **Data:** `useStatsSummary(range)`, `useAttentionCounts()`, `useSystemInfo()`.
- **Boards:** MHome, MHomeMore, MAutomationDetail. **Seed:** port `home/StatTiles.tsx`, `home/HealthCard.tsx`.

### MB-41 ContextUsage

- **Web** B-13 ContextGauge (+ WF-07 stage variant) · **Folder** `blocks/ContextUsage` · **Phase** M6-04
- **Spec:** row min-h 56, `rounded` 16, 1px `border-line-soft`: MP-41 Gauge 32, "42% of context used" 15/600, mono "84.2K / 200K tokens"
  (`formatTokenLimit`), "Breakdown ›" → a sheet with the breakdown (system, tools, messages, cache — from `UsageInfo`; cache miss reason via
  `cacheMissReason`). Chip form (20 gauge + "42%") for the run stage header.
- **Shared logic:** `UsageInfo`, `promptTokensOf`, `computeCacheMiss`, `cacheMissReason`, `formatTokenLimit`.
- **Data:** `useContextUsage(chatId | stageId)`.
- **Boards:** MModelPicker, MWorkflowRun (stage). **Seed:** port `chat/composer/GaugeSheet.tsx`, `ui/ProgressRing.tsx` `usageTone`.

### MB-42 WorkspacePane

- **Web** `blocks/dock` (Dock, dockRegistry, dockState, useDockState, useDockLinkParam) · **Folder** `blocks/WorkspacePane` · **Phase** M5-03 (shell) / M6-07…M6-11 (tabs)
- **Spec:** the connected pane used by the chat and the run screen: ML-05 SidePanel (`side="end"`) + ML-07 PaneShell + ML-08 tabs + the tab
  registry `paneRegistry.ts` mapping `DockTabType` → body block (changes → MB-22, files → MB-25, terminal → MB-27, browser → MB-28, tasks →
  MB-30, plan → MB-31, computer → MB-29) for `scope: 'chat'`; for `scope: 'run'` the run set (Output, Files, Hooks, Variables, Changes, Terminal,
  Browser — run-only bodies come from `features/workflows` through a registration prop, so the block does not import features). Tabs:
  `DOCK_PINNED_TABS` always; `DOCK_CONDITIONAL_TABS` when they apply (tasks: orchestrator chat; computer: computer use enabled; plan: a plan
  exists). Open state and active tab persisted in MMKV with `dockStorageKeys(scope)` keys; `?dock=` deep links via `parseDockLinkTab`
  (`DOCK_LINK_PARAM`). Toggle count = changed files; attention dot when Plan awaits review or Computer has a pending consent/control request.
  Visited tab bodies stay mounted (terminal and WebView never remount; MD-24).
- **Data:** `useDockState(scope, entityId)` (local), `useChatChangesSummary(chatId)`, `usePaneAttention(chatId)`.
- **Boards:** MPaneOpen, MPaneTabsOverview, MWorkflowRunPane, MTabletIOS, MTabletAndroid. **Seed:** port `workbench/useWorkbench.ts`,
  `workbench/workbenchModel.ts`, `chat/panes/paneModel.ts`.

### MB-43 ConnectionStatus

- **Web** B-12 ConnectionStatus · **Folder** `blocks/ConnectionStatus` · **Phase** M5-02
- **Spec:** footer form (drawer: StatusDot 7 + "Connected" 14 `text-fg-2` + mono 12 address), subtitle form (Home: "● Connected `local:3100`"), and the
  MP-34 banner driver. States from `streamHealth` + `onlineManager`: connected (`ok`), reconnecting (Spinner, "Reconnecting…"), disconnected
  ("Offline"), revoked ("Pairing revoked" → `/revoked`).
- **Shared logic:** `ConnectionHealth`, `HEALTH`. **Data:** `useConnectionHealth(serverId)`.
- **Boards:** MSidebar, MHome, MHomeMore. **Seed:** port `common/ConnectionStrip.tsx`, `auth/describeTransport.ts` (text).

### MB-44 ProjectPicker / CodebasePicker

- **Web** B-06 ProjectPicker / CodebasePicker · **Folder** `blocks/ProjectPicker` · **Phase** M6-05
- **Spec:** a navigation row (`folder` 20, mono project name 15/500, "2 codebases", chevron) that opens a sheet: SearchInput + RadioGroup rows
  (project name, codebase count, last activity) + "No project". Codebase variant lists a project's codebases with status.
- **Data:** `useProjects()`, `useProjectCodebases(projectId)`.
- **Used by:** New chat, automation create (scope step), project-scoped agent import, share target (new chat). **Boards:** MNewChatMore,
  MAutomationCreate1. **Seed:** port `projects/useProjectsApi.ts`, `projects/api.ts` (→ queries).

### MB-45 SourcesCard

- **Web** B-05 SourcesPopover / MountList + `blocks/files/SourcesBlock` · **Folder** `blocks/SourcesCard` · **Phase** M6-08
- **Spec:** header "Sources · 2 mounts" + Link "Edit sources" (→ New chat's Where editor for this chat; hidden when not editable); mount rows min-h 64:
  alias mono 14/500, Badge neutral "Worktree" / "In place", branch mono + dirty dot 6 `bg-warn` (label "uncommitted changes"), path mono 12
  `text-fg-3` (server path, any OS separator), "Copy path" IconButton sm. Editable form (New chat): codebase card with Worktree/In place segment,
  New/Existing branch segment, branch Input + "from main", "✓ Working dir" selection (MD-49).
- **Data:** `useWorkspaceMounts(workspaceId)`.
- **Boards:** MPaneFiles, MNewChatMore. **Seed:** port `chat/composer/sourceModel.ts` (moved), `FilesSection.tsx` sources part.

### MB-46 CapabilitySummary

- **Web** B-27 EffectiveCapabilities · **Folder** `blocks/CapabilitySummary` · **Phase** M7-03
- **Spec:** card: title "Effective capabilities" (+ "unsaved" Badge); tools 2-column grid (on `text-fg`, off `text-fg-3` with `minus`); Skills / MCP
  Chip lists; runtime mono summary ("claude-sonnet-5 · Medium · 200K · 40 turns"); warnings list or "No resolution warnings". Compact row form
  (New chat: `shield-check` + "5 skills · 2 MCP · Shell on" / "3 from agent + 2 added" + "Customize").
- **Data:** `useResolveAgentPreview(draft)` (debounced 400 ms).
- **Used by:** Agents (detail, editor), New chat (MB-06), stage editor (Workflows). **Boards:** MAgentDetail, MAgentEdit3, MNewChatMore, MStageTools.
- **Seed:** new.

### MB-47 PermissionModePicker

- **Web** run dialog permission picker · **Folder** `blocks/PermissionModePicker` · **Phase** M8-02
- **Spec:** RadioGroup rows (mode label, description, locked modes with reason "Needs admin" — bypass requires admin per P04) or MP-23 in compact
  form; note line. Used by the run sheet, automation create step 4, run header permission change.
- **Shared logic / Data:** `permissionMode.ts` (moved); `useRunPermissionModes()`.
- **Boards:** MWorkflowLaunchAdvanced, MAutomationCreate3. **Seed:** port `runs/PermissionModeSheet.tsx`, `runs/permissionMode.ts`.

### MB-48 ChatRow

- **Web** B-26 `ChatsTable` row binding · **Folder** `blocks/ChatRow` · **Phase** M6-01
- **Spec:** `ChatRowModel` → ML-14 EntityRow: leading status glyph (`status.state`; none for never-run; archived → neutral Badge), title, pinned
  (MG-02, rendered only when present), unread (MG-02), meta = mono project · AgentGlyph agent **or** model (model only when the row carries a
  model field — MG-03), trailing DiffStat (`changes`, "—" unknown), relative time. Swipe (ML-15): leading Pin / Mark unread (only when the
  fields exist), trailing More / Archive (Undo Toast, MD-26). ContextMenu (MDF-57): Open · Pin / Mark unread (MG-02) · Stop (when `stoppable`) | Archive (undo snackbar) | Delete…
  (destructive + confirm). Selection mode checkbox.
- **Shared logic:** `toChatRowModel`, `chatRowState`, `chatRowStatus`, `chatLiveSets`, `ChatRowModel` (client-core `chats/`, shared `ui-contract/chats.ts`).
- **Data:** `useArchiveChat()`, `useDeleteChat()`, `usePinChat()`.
- **Used by:** Chats, Home (recently finished), Project detail (Chats tab), palette (recents), in-app share picker. **Boards:** MChats,
  MComponents chat list rows. **Seed:** port row parts of `app/(tabs)/chats.tsx`, `common/chatName.ts`, `common/groupByDay.ts` (→ `ui/lib/format.ts`).

### MB-49 RunRow

- **Web** B-26 `RunsTable` row · **Folder** `blocks/RunRow` · **Phase** M8-01
- **Spec:** EntityRow: status glyph, "#248" mono + workflow name (or "v7 · Manual" when inside a workflow), trigger chip (WF-20: Manual / Automation /
  Chat / Fork / CLI), mono duration or elapsed, relative time. Menu: Open, Open chat, Retry (when failed), Cancel (when running, confirm).
- **Shared logic:** `STATUS_MAPS.workflowRun`, `runTitle`. **Data:** `useWorkflowRuns(filter)`.
- **Used by:** Workflows (detail recent runs), Projects (Runs tab), Automations (executions reuse the row with `ExecutionRow` props), Home.
- **Boards:** MWorkflowDetail, MAutomationDetail, MProjectDetail. **Seed:** port `runs/RunRow.tsx`.

### MB-50 ApprovalSheet

- **Web** WF-09 ReviewCard in the run page · **Folder** `blocks/ApprovalSheet` · **Phase** M6-03
- **Spec (MD-21, MD-31):** the one approval surface opened from every entry (run banner, run pane, stage chat card, chat card, notification):
  route sheet at `large`: `/workflows/[id]/runs/[runId]/approval/[stageRunId]` for stage gates and `/chats/[id]/gate/[interactionId]` for chat
  gates (`04-screen-map.md` §1.2, §1.6; MD-80), with `?server=<id>` from a push or link; body = MB-34 ReviewCard content with the full summary, files, and feedback; risky
  approvals show "Face ID required" / "Fingerprint required" (platform noun) under Approve and sign with the biometric-gated approval key
  (`modules/generatorai-device-key` extension; bypasses the 10-minute step-up cache); devices without biometrics/passcode cannot approve risky
  gates (Approve disabled with reason). Success → `success` haptic after the server confirms, sheet closes, Toast none (MD-26).
- **Data:** `useGate(runId, gateId)`, `useRunCommand(runId)`, `useSignedApproval()`.
- **Boards:** MRunApproval. **Seed:** port `runs/ApprovalCard.tsx`, `app/approvals.tsx`.

---
## 5. Native extension targets (MX-01 … MX-11)

These are not RN views. They are built in phase **M9** (system surfaces). All of them read one shared model and obey the same privacy
and deep-link rules.

**Shared data source (MX-11, built first).**
- **Live-state model** — new additive client-core module `packages/client-core/src/live/liveStateModel.ts` (logged in
  `COORDINATION.md`): a pure reducer that turns attention items, run stage events and live turn state into
  `LiveEntity { serverId; entity: 'chat' | 'run'; id; title; number?: number; state: StatusState; stageIndex?; stageCount?; stages?: StatusState[];
  gate?: { kind: GateKind | 'approval'; title: string; summary?: string; risky: boolean }; step?: { verb: string; target: string }; startedAt: string;
  nextStage?: string; updatedAt: string }` plus `selectLiveActivityCandidates()` (most urgent first: needs_you > running; ties by `since`) and
  `selectWidgetSnapshot()` (`{ serverId, serverName, updatedAt, counts: { needsYou, running, doneToday }, needsYou: LiveEntity[3], running:
  LiveEntity[3] }`). The same model feeds in-app status, notification copy, Live Activity / Live Update content and widgets (00 §5.10).
- **Snapshot writer** — `services/native/liveBridge.ts` (the only JS that talks to the targets): writes the widget snapshot JSON and the
  current palette (`useThemeColors()` literals for light and dark, so widgets follow the app theme) to the **App Group**
  `group.<bundleId>.shared` (iOS, via `expo-widgets` `widgetsDirectory` / `ExtensionStorage`) and to Android shared preferences
  `generatorai_widgets` (read by Glance and the TileService); calls `WidgetCenter.reloadTimelines` / Glance `updateAll` on change (throttled
  to once per 15 s, plus on every needs-you change). **No credentials in the group** — extensions deep-link into the app for anything
  authenticated.
- **Redaction (MD-33)** — `redactForLockScreen(entity, { unlocked, appLockOn })` in the live-state module: titles and status words always;
  commands, code, file paths, step targets and message text only when the device is unlocked **and** App lock's "Hide notification previews"
  is off. Widgets and Live Activities are visible while locked, so they always use the redacted form (step target → verb only: "Reading").
- **Deep links (MD-34, MD-05)** — every link carries the server id as the `server` query key (added to the shared allowlist when
  `DEEP_LINK_QUERY_KEYS` moves to `packages/shared`): `generatorai://chats/<chatId>?server=<serverId>[&dock=<tab>]`,
  `generatorai://runs/<runId>?server=<serverId>[&gate=<gateId>]` (opens MB-50 when `gate` is present), `generatorai://command/chat.new`,
  `generatorai://` (Home). Built with `attentionItemRoute`. Links are untrusted input: the router validates the server id against paired
  servers, drops unknown keys, and never performs an action from a link (a link only navigates or pre-fills).

### MX-01 iOS Live Activity

- **Built with** `expo-widgets` Live Activity (`createLiveActivity`, start / update / end; layouts are `@expo/ui/swift-ui` components with the
  `'widget'` directive) in `apps/mobile/widgets/LiveRun.tsx`; `NSSupportsLiveActivities` in the Info.plist via config.
- **Content (MLiveActivity):**
  - *Compact:* leading app glyph + state word (`Needs you` in `warn`, `Running` in `run`) 13/600; trailing mono progress "3/6" 14/500 (run) or the
    elapsed timer `Text(timerInterval:)` (chat).
  - *Minimal:* the app glyph (warn ring when needs you).
  - *Expanded (371 wide):* glyph 24, title 14/600, mono "#248", mono elapsed end; gate line "✋ Apply upgrades" 16/600 over "Needs you · 14 packages,
    3 majors" 13/500 `fg-2` (redacted form drops the summary when locked); primary "Review" h40 (a `Link` to the approval deep link; never an
    inline approve — risky approvals need the app, MD-31); 6-segment bar (h6 r3, status tones, MP-15 semantics); footer "Stage 3 of 6 · approval
    gate" … "Next: Run test suite" 12/500 `fg-3`.
  - *Lock Screen:* the expanded content on the system material; a second, compact chat activity row "Upgrade React Flow to v12 · ⟳ Reading · 4:12".
- **Lifecycle (MD-32 phase 1, local only):** started by the app when a run the user started goes running or a chat the user is in waits on them
  (Settings › Widgets toggles "Runs I start", "Chats waiting on me"); updated from the stream while the app holds it; `staleDate` = now + 15 min on
  every update (shown as "Updated 14:06" when stale); ended on succeeded / failed / cancelled with a final state shown for 15 min
  (`dismissalPolicy: .after(15 min)`); at most one per entity; the island shows the most urgent (`selectLiveActivityCandidates`). Remote updates
  (push gateway) are phase 2 and not built.
- **Theme:** always dark on the island; Lock Screen uses the palette literals for the current appearance; supports iOS tinted/clear Lock Screen
  styles (glyph + word, no colour-only meaning).
- **Settings:** `ActivityAuthorizationInfo` disabled → the settings row shows "Turned off in iOS Settings" + "Open Settings".

### MX-02 Android Live Update

- **Built with** an in-repo Kotlin module `apps/mobile/modules/generatorai-live` (Expo module) + config plugin: a foreground service of type
  **`specialUse`** (manifest `FOREGROUND_SERVICE_SPECIAL_USE` + `<property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE">` with the
  Play justification "live progress of a user-started agent run") that posts an ongoing notification with `Notification.ProgressStyle`
  (API 36+, `androidx.core` 1.17 backport below), `setRequestPromotedOngoing(true)` and `setShortCriticalText("3/6")` for the status-bar chip.
  Channel `live` (LOW importance, no sound). JS API: `LiveUpdate.start(entity)`, `update(entity)`, `end(entityId, final)`.
- **Content:** status-bar chip "Needs you 3/6" (the system tints it; colour is not relied on); notification header "GeneratorAI · Run #248 · 12:40";
  title "✋ Apply upgrades"; body (redacted when locked); ProgressStyle segments (one per stage, `setProgressSegments` with the status tone
  colours from the palette), tracker icon = the current stage's state glyph on a tone circle at the current position; action "Review" (deep link,
  opens the approval sheet). Chat variant: "Upgrade React Flow to v12 · Reading · 4:12" with a chronometer.
- **Lifecycle:** runs only while a run/chat is active and the app holds the stream (MD-32); stops on end with a normal final notification;
  Android < 16 → a regular ongoing notification with a determinate progress bar. Promotion eligibility checked with
  `NotificationManager.canPostPromotedNotifications()`.

### MX-03 iOS widgets (WidgetKit)

- **Built with** `expo-widgets` (`apps/mobile/widgets/*.tsx`, SwiftUI via `@expo/ui` with `'widget'`), timeline from the App Group snapshot,
  refresh on snapshot write (`reloadTimelines`) + `after(15 min)` policy.
- **Widgets (MWidgets):**
  - **Needs you** — small / medium (364×170, `rounded` 22 system, pad 14 16): header app glyph 16 + "Needs you" 13/600 + warn count + "Updated 14:06"
    11 `fg-3`; up to 3 rows (h39): `hand` 14, title 13/600, sub 11 `fg-3` (redacted), "Review" button h26 radius 13 (`Link` to the gate; system-sized,
    MD-65); row tap → chat / run.
  - **Running** — medium / large: loader header; rows with title, project or stage, elapsed via `Text(timerInterval:)` (widgets cannot tick).
  - **Summary** — small (170): three rows with dot + word + mono count 17/600 (Needs you 3 / Running 3 / Done today 4) + "Updated".
  - **Empty** — small: ✓ "Nothing needs you" + "3 running · 4 done today" (`EMPTY_STATE_COPY.needsYou`).
  - **Lock-screen accessory** (`accessoryRectangular`, `accessoryCircular`): "3 need you" / count gauge (not drawn; derived, glyph + word).
- **Modes:** full colour, tinted and clear (iOS 18+ `widgetRenderingMode`): status never relies on colour (glyph + word). Offline → "Server offline ·
  Updated 14:06".
- **Deep links:** row → `generatorai://chats/<id>?server=<serverId>` / `runs/<id>?server=…`; Review → `runs/<id>?server=…&gate=<gateId>` or the chat with the gate;
  background → Home.

### MX-04 Android widgets (Glance)

- **Built with** `expo-widgets` 58 Android widgets (own Hermes runtime, Material colours) when SDK 58 is in (MD-11); if the SDK in use has no Android
  widgets, `react-native-android-widget` is **not** added — widgets wait (the plan's package list does not include it).
- **Widgets:** **Needs you** 4×2 (380×248, radius 24 system, pad 12): header glyph 24 + 16/600; rows h56 in an M3 segmented list (radius 16/6), title
  14/600, sub **12** `fg-2` (board 11 raised, MD-65), "Review" tonal button h36; **Running** 4×2; **Summary** 2×2 (184×184); **Empty** 2×2. Dynamic
  colour variant (Material You) when the System accent is on (MD-08); status words always present.
- **Refresh:** on snapshot write + WorkManager 15 min. **Placement count** for Settings: `GlanceAppWidgetManager.getGlanceIds` ("2 placed");
  "Add widget" button → `AppWidgetManager.requestPinAppWidget`.

### MX-05 iOS Control Center control

- **Built with** `@bacons/apple-targets` (`targets/controls/`, a `widget` target) + ~50 lines of Swift: a `ControlWidgetButton` "New chat ·
  GeneratorAI" with an `AppIntent` (`openAppWhenRun = true`) that opens `generatorai://command/chat.new`. Icon: `square.and.pencil`.
- **Not built (MD-06):** "Pause agents" toggle (no server endpoint).
- **Settings:** an info row "Add “New chat” in Control Center edit mode" (apps cannot add controls; the board's switch is replaced).

### MX-06 Android Quick Settings tile

- **Built with** a Kotlin `TileService` in `modules/generatorai-live` (manifest via the module's config plugin, `BIND_QUICK_SETTINGS_TILE`):
  label "New chat", subtitle from the snapshot ("3 need you" or empty), state `STATE_INACTIVE` normally, `STATE_UNAVAILABLE` when no server is
  paired (subtitle "Not paired"); tap → `startActivityAndCollapse` with a `PendingIntent` for `generatorai://command/chat.new`.
- **Settings:** "Add tile" button → `StatusBarManager.requestAddTileService` (API 33+); below 33 an info row.
- **Not built (MD-06):** "Pause agents".

### MX-07 Notification categories and actions

- **Built with** `expo-notifications` (`setNotificationCategoryAsync`, Android channels), `services/notifications/` (the only place with platform
  branches, MD-15), extending the existing `notificationCategories.ts` to the shared gate vocabulary (`GateKind` + `'approval'`).
- **Categories** (ids, actions and channels are defined in `06-platform-and-shell.md` §7.2 and the new shared
  `packages/shared/src/ui-contract/notifications.ts`; this table mirrors them):

  | Category id | Trigger | iOS interruption | Android channel | Actions | Grouping |
  |---|---|---|---|---|---|
  | `approval` (kept id) | ordinary (not risky) permission gate | `timeSensitive` (entitlement) | `approvals` (MAX) | "Allow once" (`authenticationRequired`), "Deny" (destructive), "Open" (`foreground`) | `threadId` = chat |
  | `approval.risky` | risky permission gate (MD-31) | `timeSensitive` | `approvals` | "Review in app" (`foreground`) only | chat |
  | `question` | question gate | `timeSensitive` | `approvals` | text reply ("Send"), one action per option when ≤ 3 options (MG-06 question options), "Open" | chat |
  | `plan` | plan ready for review | `timeSensitive` | `approvals` | "Open" | chat |
  | `run.approval` | stage approval / input | `timeSensitive` | `approvals` | "Review" (`foreground`, opens MB-50; signs when risky) | run |
  | `done` | chat / run finished | `passive` | `done` (LOW) | tap opens | summary group ("2 chats done") |
  | `failed` | run / turn failed | `active` | `failed` (HIGH) | "Open" | run / chat |
  | `scope_request` | device scope request answered | `active` | `general` (DEFAULT) | "Open" | — |
  | `live` | — | — | `live` LOW (MX-02) | "Review" | — |

- **Risky** gates (server `risk` flag or the MD-31 fallback list) never get an inline Allow action: only "Open" (the app then signs with the
  biometric key). Ordinary approvals from the lock screen are "device-authenticated" (unlock required).
- **Payload:** `{ serverId, entity, entityId, gateId?, category, title, body (redactable), command? }`; badges = `attention.counts.needsYou`.
- **Foreground:** `setNotificationHandler` explicit (SDK 58 shows foreground notifications by default): suppress a Needs-you push for the chat
  currently on screen (the in-app gate card shows it).
- **Copy:** titles and actions from the gate copy tables (`PERMISSION_GATE_COPY` etc.); lock-screen body redacted per MD-33.

### MX-08 Quick actions / app shortcuts

- **Built with** `expo-quick-actions` (router `href` integration; iOS max 4 dynamic items, Android dynamic shortcuts, pinnable).
- **Items (MShortcuts):** "New chat" (`square-pen`, `generatorai://command/chat.new`), "Home" with dynamic subtitle "3 need you" (from the snapshot),
  "Run workflow…" (`play`; opens the Workflows list filtered to runnable, since `command/<id>` allows only `chat.new` and `workflow.new`, D-60 —
  the item links to `generatorai://workflows?intent=run`; `intent` is a new allowlisted query key added with the shared allowlist move), "Search"
  (`generatorai://search`). Items come from `LAUNCHER_ACTIONS` where they overlap (New chat, Home) so desktop and mobile share labels.
- **Badge:** app icon badge = needs-you count (`setBadgeCountAsync`, from pushes and the snapshot).

### MX-09 Share target ("Send to agent")

- **Built with** `expo-share-intent` (iOS share extension + Android `ACTION_SEND` / `ACTION_SEND_MULTIPLE` intent filters) — gated on an SDK-matching
  release (MD-17). The extension only hands the payload to the app ("open app with payload"); the UI is an in-app route sheet
  `/share` (`features/share`), because credentials never leave the app.
- **In-app sheet content (MShortcuts):** header ✕ Cancel + "Send to agent" + primary "Send"; attachment preview row (file icon tile 44×52, mono name,
  "Plain text · 48 KB"); MP-23 "Existing chat / New chat"; Existing: "Recent chats" MB-48 ChatRow list (status **glyph + word**, not a dot) with
  selection ✓ / radio (MD-49) and the chosen chat's locked agent ("Set when the chat was created. Start a new chat to pick another agent.");
  New: agent / model / project rows (defaults from Settings; MB-44); "Note (optional)" Textarea; footer MB-43 server line with a server Select
  when > 1 server is paired (default: the last used).
- **Data:** upload through the attachment ingest endpoint (MG-09; until it exists the target accepts text and URLs
  only and inserts them into the composer draft). Size limit shown before Send.

### MX-10 App-switcher privacy

- **Built with** iOS `expo-screen-capture` `enableAppSwitcherProtectionAsync` (blur) and the scene-lifecycle hook; Android
  `Activity.setRecentsScreenshotEnabled(false)` (API 33+) exposed from `modules/generatorai-live` (never `FLAG_SECURE`, which also blocks
  screenshots), falling back to `FLAG_SECURE` only below 33 when the user turns the setting on.
- **Behaviour:** Settings › App lock & privacy "Hide content in app switcher / Recents" (per device, default on). The JS overlay
  (`testID="privacy-overlay"`) renders `bg-surface` + BrandMark 36 while inactive. App lock (`testID="app-lock"`) is separate: it renders
  MP-35 `app-lock` on resume after the "Lock after leaving" interval.

### MX-11 Live-state model and snapshot bridge

- The JS side described at the top of this section (`packages/client-core/src/live/liveStateModel.ts`, `services/native/liveBridge.ts`), plus the
  in-app **LiveActivityPreview** used by Settings › Widgets (`features/settings/components/LiveActivityPreview`: a JS mock of the Lock Screen /
  status-bar chip + notification, built from MP-15 and tokens, labelled "Preview").
- **Tests:** Vitest for the reducer, selectors and `redactForLockScreen` (every field × locked/unlocked × app-lock setting).

---
## 6. Feature component index

Feature-local components live in `features/<area>/components/<Name>/` (§1.1). They compose MP/ML/MB parts; they never import another
feature. Names match web feature composites (`F-<area>-xx` in `03-component-inventory-domain.md` §3) where one exists. Each list names
the screens (routes are thin re-exports, MD-14) and then the components with the boards that show them.

**Shell wiring (`features/shell/`).** Not a user-facing module: the root layout imports it. `AppShell` (ML-17 AdaptiveLayout + two ML-05
SidePanels + the router Stack), `ConnectedDrawer` (ML-06 + MB-20 trigger + MB-19 drawer variants + MB-43 footer; selection from
`navDestinationFor(pathname)`), `ConnectedPaneHost` (mounts MB-42 for the focused chat / run), `GesturePolicyProvider` (MD-19 per route
role), `HardwareKeyCommands` (iPad / tablet shortcuts from `COMMANDS` via the device-key module: ⌘K palette, ⌘N new chat, ⌘\ sidebar,
⌘⌥\ pane, ⌘[ / ⌘] back/forward), `shellStore.ts` (moved from `navigation/shell/`). Boards: MSidebar, MSidebarChats, MTabletIOS,
MTabletAndroid, MGestures, MPrinciples.

### 6.1 Home (`features/home/`) — phase M7

Screen `HomeScreen` (Header `top` with Search action; subtitle via MB-43; NewAction "New chat" `home-new-chat`).

| Component | What | Boards |
|---|---|---|
| `HomeCountTiles` | MB-40 tiles bound to attention counts + finished today; tap scrolls to the section | MHome |
| `NeedsYouSection` | SectionHeader "Needs you" + "See all" + MB-19 `home-needs` (max 5) + EmptyState `needsYou` | MHome |
| `RunningSection` | MB-19 `home-running` + EmptyState `running` | MHome |
| `RecentlyFinishedSection` | ListSection of MB-48 ChatRow / MB-49 RunRow with outcome text ("Done · committed", "Failed at typecheck"); PR events hidden until G-11 items exist | MHomeMore |
| `ThisWeekStrip` | MB-40 strip | MHomeMore |
| `ServerFooterLink` | MB-40 footer link → MB-20 | MHomeMore |
| `HomeQuickComposer` | MB-01 `variant="quick"` (only if the web Home keeps a quick start; otherwise not built) | — |

### 6.2 Chats (`features/chats/`) — phase M6

Screen `ChatsScreen` (Header `top`, title "Chats" + count, actions Select (`chats-select`) + ⋯ "Sort and more"; NewAction `chats-new`).

| Component | What | Boards |
|---|---|---|
| `ChatsFilterBar` | MP-17 SearchInput (mic) + MP-23 All / Active / Archived with counts (J path) | MChats |
| `ChatsList` | Legend List of MB-48 ChatRow with sections "Pinned" / "Recent" (pinned only when the field exists), keyset paging (`mergeChatListPages`), live via `chatListStreamFilter` | MChats, MSidebarChats |
| `ChatsSortMenu` | MP-27 Menu (sort: recent activity / created / name; show workers) | MChats |
| `ChatsBulkBar` | ML-25 with Archive / Delete (`chats-bulk-delete`) using D-52 bulk endpoints | derived |
| `ChatsEmpty` | MP-32 `chats` / `searchResults` | derived |

### 6.3 Chat (`features/chat/`) — phase M6

Screen `ChatScreen` (Header `workspace`: back `chat-back`, breadcrumb "Chats › <project>", title, pane toggle `pane-toggle`, ⋯ menu; StatusLine;
MB-07 TranscriptView; MB-01 Composer; MB-42 WorkspacePane). Screen `StepDetailScreen` (MB-14). Screen `ChatDiffScreen` (MB-24) and
`ChatFileScreen` (MB-26) pushed from the pane.

| Component | What | Boards |
|---|---|---|
| `ChatStatusLine` | ML-04 bound to `chatActivity` + agent/model detail ("Needs you · Bug Fixer", "Running 4:12 · Orchestrator", "Done · Claude Sonnet 5") | Main, MChatRunning, MChatNoAgent |
| `ChatMenu` | MP-27 (MDF-57): Rename (TrueSheet with Input) · Copy transcript (`copy-transcript`) · Open workspace pane \| Archive \| Delete… (confirm) | MComponents Menus (Android) |
| `ChatFindBar` | find bar above the composer: Input + "n of m" + ↑ ↓ + ✕ (`findInTexts`) | derived |
| `ForkProvenance` | "Forked from <chat> · <turn>" line (`fork-provenance`) | — |
| `RenameChatSheet` | TrueSheet form | — |
| `AgentInfoSheet` | opened by the locked agent chip: agent summary (MB-46 compact) + "Open agent" | MComponents composer chip |
| `ChatEmpty` | `TRANSCRIPT_COPY.emptyTitle` / `emptyBody(agent)` | derived |

### 6.4 Pane tabs (`blocks/*` — no feature folder)

All seven tabs are blocks because the chat and the run screen both host them: Changes MB-22 (+ MB-23, MB-24, MB-32), Files MB-25 (+ MB-26,
MB-45), Terminal MB-27, Browser MB-28, Tasks MB-30, Plan MB-31, Computer MB-29, hosted by MB-42. Run-only tabs (Output, Hooks, Variables) are
feature components in `features/workflows/components/RunPane*` registered into MB-42. Boards: MPaneOpen, MPaneTabsOverview, MPaneChanges,
MPaneDiff, MPaneCommit, MPaneCommitDone, MPaneFiles, MPaneFilePreview, MPaneTerminal, MPaneTerminalFull, MPaneBrowser, MPaneBrowserStates,
MPaneTasks, MPaneTaskDetail, MPanePlan, MPaneComputer, MWorkflowRunPane.

### 6.5 Projects (`features/projects/`) — phase M7

Screens: `ProjectsScreen`, `ProjectDetailScreen` (tabs: Codebases · Chats · Runs · **Pull requests** (MD-36) · Customization · Settings as ML-08-style
top tabs on the detail — MP-23 segmented falls back to Select at 5+), `CodebaseScreen`, `CodebaseLogsScreen`, `SkillDetailScreen`,
`PullRequestScreen`, `ProjectCreateScreen` (ML-11), `AddCodebaseSheet` (route sheet).

| Component | What | Boards |
|---|---|---|
| `ProjectRow` | ML-14: name, counts (codebases, chats, "1 needs you"), last run badge, updated; ContextMenu (Open, New chat in project, Run workflow…, Add codebase…, Copy root path, Project settings, Archive, Delete) | MProjects |
| `CodebaseRow` | alias, status (pending / cloning with MP-14 progress / ready / error / stale → StatusBadge mapping), url mono, branch, fetched, worktrees "3 · 2 orphaned"; ⋯ Fetch, Logs, Remove | MProjectDetail |
| `CodebaseMetaCard` | remote URL, default branch (Select), last fetched + Fetch button | MCodebase |
| `WorktreeRow` | branch mono, **neutral** Badge Active/Orphaned/Completed (MD-25), linked chat/run, updated, size (G-17, landed: shown once measured), Remove (confirm) | MCodebase |
| `CleanupConfirmSheet` | TrueSheet listing affected worktrees + sizes; destructive confirm via MP-29 impact | MCodebase, MProjectSettings |
| `LogViewer` | mono virtualised lines, live via SSE, Copy (G-16, landed: `api.projects.codebaseLogs`) | MCodebaseLogs |
| `RepositoryDraftRow` | project-create codebase draft (name, URL, kind, branch, ✕) | MProjectCreate, MAddCodebase |
| `CustomizationList` | per-project skills/prompts/agents/MCP rows with Switch (G-19, landed: stored per project on the server through `api.projects.artifactPrefs`) | MProjectCustomization |
| `SkillFileChips` + skill markdown (MB-10) | skill detail | MSkillDetail |
| `ProjectSettingsForm` | ML-22 sections + destructive "Delete project" | MProjectSettings |
| `PullRequestRow` / `PullRequestDetail` | ported PR screens (status, checks, files) | — (current mobile screens) |

### 6.6 Agents (`features/agents/`) — phase M7

Screens: `AgentsScreen`, `AgentDetailScreen`, `AgentEditorScreen` (ML-11: Cancel / Save, change count in the header), `AgentNewScreen` (ChoiceCard "start from"),
`AgentImportSheet` (route sheet with document picker).

| Component | What | Boards |
|---|---|---|
| `AgentRow` | ML-14: AgentGlyph, role, scope Badge `outline`, model · effort, skills/MCP counts, team line; menu (Open, Edit, Duplicate, Export, Delete) | MAgents |
| `AgentDetailHeader` + `UsedByList` | usage (workflows / chats with status), "See all" | MAgentDetail |
| `TeamList` | orchestrator members (ref, role, model), max workers, default worker model | MAgentDetailOrch, MAgentEdit2 |
| `AgentEditorForm` | sections Identity, Instructions (Textarea with size meter; Add/Replace default), Role, Runtime (Provider, Model → MB-03, Effort MP-23 5-way → Select at large text, Context tier, Max turns MP-43), Team, Skills Chips, MCP Chips, Capabilities (MB-05 tri-state), Effective → MB-46 | MAgentEdit1–3 |
| `TagInput` | Chip `input` list + "+ Tag" | MAgentEdit1 |
| `ImportPreview` | file card, parsed summary, warnings, scope choice, replace notice (dry-run preview hidden until MG-12 lands) | MAgentImport |
| `DeleteInUseDialog` | MP-29 with impact ("Used by 2 workflows, 3 chats") + force delete | MAgentDelete |

### 6.7 Workflows (`features/workflows/`) — phase M8 (after the Workflow Overhaul APIs, MD-04)

Screens: `WorkflowsScreen`, `WorkflowDetailScreen`, `RunSheet` (route sheet, pages: variables & stages → advanced → plan preview), `RunScreen`
(Header `workspace`, MB-42 run pane), `RunGraphScreen` (MB-35), `StageChatScreen` (MB-07 + MB-01 `stage`), `BuilderScreen` (ML-11, list view only
+ read-only graph), `StageEditorScreen` (ML-11, 6 tabs), `WorkflowSettingsScreen`, `NewWorkflowScreen` (ML-11), `VersionHistorySheet`,
`ValidationSheet` (MB-37), approval via MB-50.

| Component | What | Boards |
|---|---|---|
| `WorkflowRow` | ML-14: name, tags, VersionChip, last run (status, when; # only with MG-29), success rate (`stats.summary` `groupBy: 'definition'`, NG-04; hidden when absent), swipe/menu Run | MWorkflows |
| `VersionChip` | Badge neutral "Published v7" / "Draft rev 13" (WF-01; neutral tone, MD-25) | MWorkflowDetail |
| `MiniGraph` | MB-35 static variant | MWorkflowDetail |
| `RunHeaderMeta` + `BudgetMeter` + `LifecycleStrip` | run header row: version, trigger chip, elapsed; turns · tokens · cost (cost only when reported); setup/stages/finalize | MWorkflowRun |
| `NeedsYouBanner` | card under the header "Needs you · Apply upgrades · round 1" + Review → MB-50 (neutral card + warn glyph; not a tinted bar) | MWorkflowRun |
| `RunMenu` / `StageMenu` | MP-27 from server commands (pause drain / interrupt, resume, cancel, retry mode, skip, copy, export; stage: re-run from here, open chat) | MWorkflowRunMenu, MRunStageChat |
| `RunPaneOutput` / `RunPaneHooks` / `RunPaneVariables` | run-only pane tabs registered into MB-42 (StructuredOutputView, hook rows, variables KeyValueList) | MWorkflowRunPane |
| `RunSheetStages` + `StageSelectRow` | stage include/skip + per-stage model override | MWorkflowLaunch |
| `RunSheetAdvanced` | name, budget, codebases (base ref), uploads (`UploadChip`), permission (MB-47), test run | MWorkflowLaunchAdvanced |
| `PlanLayers` | plan preview layers L1…Ln with parallel markers, conditional list | MWorkflowLaunchPlan |
| `LoopGroup` / `IterationChips` / `LoopRuleRow` | runtime loop status and builder loop | MRunLoop, MBuilderLoop |
| `BuilderStageList` | ML-16 ReorderList (linear-chain moves only, MD-04) of `BuilderStageCard`; add-after via `StageKindPalette` sheet; `SelectionBar` (Edit, Duplicate, Delete + Undo Toast) | MBuilderList |
| `LoopSettingsSheet` | exit rules, carry, budget, on-limit | MBuilderLoop |
| `AgentDraftBanner` + `RiskChips` + `DiffBadge` | agent-authored draft notice | MWorkflowAgentDraft |
| `StageEditorTabs` | ML-08 `tabs` (scrollable pills / underline) for Prompt · Session · Tools · Output · Policy · Hooks | MStage* |
| `PromptEditor` | mono Textarea with `{{` token highlighting via a styled-range TextInput (option (a)/(c) of boards-workflows §B; chip rendering is not built) + diagnostics from `@generatorai/workflow-spec` | MStagePrompt |
| `ExpressionField`, `ContextFromField`, `RetryPolicyEditor`, `DurationGrid`, `BudgetGrid`, `JoinSelector`, `RuleRow`, `SchemaSummaryRow`, `HookRow`, `EnvTemplateRow`, `CompensateRow` | stage editor fields; editors beyond simple fields show "Edit on desktop" (MD-04) | MStageModel, MStageTools, MStageOutput, MStagePolicy, MStagePolicyMore, MStageHooks |
| `VariableEditor` | variable definition editor (type chips, defaults) | MWorkflowSettings |
| `TemplatePicker` | template list by category (categories only with MG-30: flat list until present) | MWorkflowNew, MWorkflowNewBasics |
| `StructuredOutputView` | table for arrays of flat objects, else key/value tree | MWorkflowRunPane, MRunStageChat |

### 6.8 Automations (`features/automations/`) — phase M7-04 (fields that depend on Workflow Overhaul P04 are not rendered until it lands, MD-27)

Screens: `AutomationsScreen`, `AutomationDetailScreen`, `ExecutionScreen` (route sheet at large, MD-21), `AutomationWebhookScreen`,
`AutomationCreateWizard` (ML-11 + ML-21 stepper, 6 steps on 4 pages).

| Component | What | Boards |
|---|---|---|
| `AutomationRow` | ML-14: name, scope, enabled Switch, trigger summary, workflows, last (StatusBadge + age), next | MAutomations |
| `AutomationStatusHeader` + `RunActions` | enabled Switch, summary, "Run now" / "Run with dataset" | MAutomationDetail |
| `ConfigRow` | ListRow `navigation` with chip/badge | MAutomationDetail |
| `ExecutionRow` + `ExecutionSummaryCard` + `IterationRow` | execution list/detail; iteration rows with Review → MB-50 (rows neutral, no warn tint) | MAutomationExecution |
| `WebhookCredentialsCard` + `DeliveryRow` | masked URL, header, signature alg, sample; Rotate (confirm + step-up + one-time reveal sheet); Copy | MAutomationWebhook |
| `ProjectScopePicker` | MB-44 variant | MAutomationCreate1 |
| `TriggerKindCards` | MP-48 ChoiceCards (manual / schedule / webhook) | MAutomationCreate2 |
| `ScheduleEditor` | repeat Select, time MP-26, timezone Select, cron (advanced), preview of next runs, missed/overlap policy | MAutomationCreate2 |
| `WorkflowPickList` | pick + order (ML-16) workflows | MAutomationCreate3 |
| `DatasetEditor` | schema rows, import CSV/JSON (`expo-document-picker`), concurrency MP-43, on-error | MAutomationCreate3 |
| `RetryToggleRow`, `ReviewSummaryList` | step 5–6; variables via MB-36; permission via MB-47 | MAutomationCreate4 |

Server-side drafts ("Save draft") are not rendered until the API exists (MD-27).

### 6.9 Scripts (`features/scripts/`) — phase M7

Screens: `ScriptsScreen`, `ScriptDetailScreen`, `RunScriptSheet` (route sheet).

| Component | What | Boards |
|---|---|---|
| `ScriptRow` | ML-14: file mono, title, stages, profiles, last run, error | MScripts |
| `ScriptsInfoCard` | Callout info (where scripts live, reload) | MScripts |
| `RunProfileSegment` | MP-23 profiles + summary | MScriptDetail |
| `StageOutline` + `EdgeChips` | read-only stage tree, loops, approvals | MScriptDetail |

Missing-scope and disabled-flag states use MP-35 `scope` → MB-38.

### 6.10 Settings (`features/settings/`) — phase M7

Screens: `SettingsRootScreen` (server card MB-20 trigger, "Search settings" (client index), groups App / Agents & models / Integrations / System per
boards-projects-agents-settings §A.1, footer version), 15 server sections + 4 per-device sections, plus `McpAddScreen` (ML-11),
`PairDeviceScreen`, `DefaultModelSheet` (MB-03). Every admin-scoped row renders ListRow `requires-admin` until granted (MD-30); writes after grant
run step-up. Toggles apply immediately; forms save in the header; destructive actions confirm (MD-30).

| Component | What | Boards |
|---|---|---|
| `SettingsSearch` | client-side index over section titles and row labels → navigates | MSettings |
| `ProviderCard` | provider from `HARNESS_PROVIDERS` (5): installed / running / authenticated state, models, Test, Sign in (`WebBrowser.openAuthSessionAsync`), Sign out, Make default (MD-35) | MSetProviders |
| `ThemePicker` + `AccentSwatchGroup` + `ThemePreviewCard` | 18 themes × light/dark (previews via `ScopedTheme`, mode-aware), 7 accents + Android 12+ "System (Material You)" (MD-08); iOS "Reduce transparency" row | MSetAppearance, MThemesPhone |
| `McpServerRow` + `McpSetupForm` + `McpServerForm` | registry rows with inline setup (Collapsible), custom server form (transport, command, args, URL, headers, env KeyValue editor, timeout) | MSetMcp, MSetMcpAdd |
| `KeyValueEditor` | repeatable Key / Value rows + "Add variable" | MSetMcpAdd, MSetBrowserTerminal |
| `TemplateRow` | name, source, stage count, "Use" | MSetTemplates |
| `SourceControlForm` | provider Select, token (secret Input), device-flow connect; header Save | MSetSourceControl |
| `DeviceRow` + `AccessRequestCard` | paired devices (MG-01 self-service reads), requests with scope checklist, approve (step-up) / deny | MSetSecurity, MSetSecurityMore |
| `PairingCodeCard` | address, 12-char code (MP-40 read-only), QR (MP-50), expiry countdown, scope preset (radio), device name; screenshot warning; keep-awake; no "Share" (MD-35) | MSetPairDevice |
| `StorageBar` + `RetentionRows` | neutral-tone segmented bar, retention steppers, cleanup (MP-29 with impact) | MSetStorage |
| `DiagnosticsRow` | health rows (tone from `HEALTH`), device key info, crash reporter opt-in + DSN (MD-42, M10) | MSetDiagnostics |
| `ModelDownloadCard` | audio model, languages, progress (MP-14), size, fallback note | MSetAudio |
| `GrantRow` | computer-use grants with Revoke | MSetComputerUse |
| `ExtensionDetailSheet` | TrueSheet: id, version, scope, widgets, state, Reload, Uninstall (confirm) | MSetExtensions |
| `NotificationCategoryRow` | per-category toggles with platform subtitle; permission banner (MP-45 ok / MP-35 denied); **not rendered:** morning digest, quiet hours, per-project levels (MD-06) | MSetNotifications |
| `AppLockRows` | biometric requirement, lock-after interval, "Ask before" list (+ Computer use), app-switcher privacy (MX-10); "Hide notification previews" not rendered until the server flag exists | MSetAppLock |
| `WidgetsSettings` + `LiveActivityPreview` | toggles for Live Activities / Updates, widget placement counts, "Add tile" / Control Center guidance (no switch, MX-05/06) | MSetWidgets |
| `HapticsRow` | per-device switch → `setHapticsEnabled` | MSettings |

### 6.11 Pairing and servers (`features/pairing/`) — phase M7 (pairing is also a characterization flow from M1)

Screens: `PairingScreen` (first run, no chrome: BrandMark 36, title `title` 20/600 (board 24 is off-ramp), body, MB-39 QrScanner, "or enter the code"
divider, MP-40 PairingCodeInput, address Input with reachability trailing ("● Reachable" via `probeServer`), primary `lg` "Connect", helper text),
`ScopeChoiceScreen` (the step after connecting: scope list from the server with presets; no admin preset, MD-30), `PairSuccess` (pushed: server name +
granted scope count + "Continue"), `RevokedScreen` (MP-35-style: "This device was removed from <server>" + "Pair again").

| Component | What | Boards |
|---|---|---|
| `PairingForm` | code + address + Connect, error mapping (`pairingFailure.ts`) | MPairing |
| `ScopePresetList` | radio presets from the server's scope list (count from the server) | MPairing (next step, derived) |
| `ServersSheet` | MB-20 route sheet | MServers |

### 6.12 Share (`features/share/`) — phase M9

`ShareSheet` (MX-09 in-app sheet). Boards: MShortcuts.

---
## 7. Deletion map

Rule (MD-14, "no backward compatibility"): a legacy file is deleted **in the same commit** as the screen that last used it moves to the new
component; `src/components/**` must be empty at M10. "Moved" means the pure file is `git mv`-ed (tests with it) into the named folder and
keeps its behaviour; "→ client-core" means M2 already replaced it with the shared implementation and the mobile copy is deleted then.
Verification per deletion: `grep -rn "<file basename>" apps/mobile/src apps/mobile/app` returns nothing.

### 7.1 `apps/mobile/src/components/ui/*` (38 files)

| Legacy file | Replaced by | Notes |
|---|---|---|
| `ActionSheet.tsx` | MP-27 Menu (`ActionSheet`), MP-29 AlertDialog (`ConfirmSheet`) | 14 + 17 call sites |
| `Button.tsx` | MP-04 Button, MP-05 IconButton | `Fab` is dead → delete |
| `Chip.tsx` | MP-10 Chip; `StaticChip` → MP-06 Badge `outline` | |
| `Collapsible.tsx` | MP-47 Collapsible | |
| `ContextMenu.tsx` | MP-28 ContextMenu | |
| `Form.tsx` | MP-22 Switch, MP-16 Input + MP-19 Field, MP-17 SearchInput | `#ffffff` thumb removed |
| `GlassSurface.ios.tsx`, `GlassSurface.tsx` | MP-38 GlassSurface | |
| `KeyboardSticky.tsx` | ML-29 KeyboardStickyBar | |
| `ListItem.tsx` | ML-14 EntityRow | status avatar dropped |
| `ListRow.tsx` | ML-13 ListRow, ML-12 ListSection (`ListGroup`) | |
| `Pager.tsx` | — delete (dead: only `gallery.tsx`) | |
| `ProgressRing.tsx` | MP-41 Gauge, MP-14 ProgressBar; `usageTone` → MB-41 | |
| `Screen.tsx` | ML-01 Screen, ML-02 Header (`ScreenHeader`), `goBack` → ML-03 / `features/shell` | |
| `SegmentedControl.tsx` | MP-23 SegmentedControl | swipe-to-step dropped |
| `SettingsButton.tsx` | ML-02 Header action | |
| `Sheet.tsx` | ML-10 Sheet (formSheet / TrueSheet) | JS Modal sheet removed |
| `SidePanel.tsx` | ML-05 SidePanel | `push` mode dropped |
| `Skeleton.tsx` | MP-31 Skeleton | |
| `States.tsx` | MP-12 Spinner, MP-13 ProgressIndicator (`LoadingState`), MP-32 EmptyState, MP-33 ErrorState, MP-35 PermissionState (`LockedState`) | |
| `SwipeableRow.tsx` | ML-15 SwipeRow | |
| `Toast.tsx` | MP-30 Toast | `useToast` API kept as `toast()` |
| `Touchable.tsx` | MP-03 Pressable | |
| `accessibility.ts` | `ui/platform/fontScale.ts` (`useFontScale`, `scaled`; caps from `geometry()`), `ui/platform/motion.ts` (`useSystemReduceMotion`), `ui/platform/hit.ts` (`hitFrameFor`) | `MAX_SCALE` deleted (per-role `maxScale` + `chromeScaleCap`, `02-design-system.md` §4.1) |
| `animated.ts` | MP-03 Pressable (`AnimatedPressable`) | |
| `gallery.tsx` | — delete (Storybook replaces it, MD-43) | |
| `haptics.ts` | `ui/platform/haptics.ts` (`haptic(concept)`, §1.9) | `setHapticsEnabled` kept |
| `index.ts` | — delete (per-component `index.ts`) | |
| `keyboard.ts`, `keyboardMath.ts` | ML-29 (moved; `keyboardMath` tests kept) | |
| `motion.ts` | `ui/platform/motion.ts` + design-tokens `MOTION` | |
| `pagerMath.ts` | — delete | |
| `primitives.tsx` | MP-46 Card, MP-06 Badge, MP-08 StatusDot, ML-20 SectionHeader, MP-36 Separator (`Divider`) | `Surface` dead → delete |
| `segmentLayout.ts` | MP-23 `segmentedModel.ts` | |
| `sheetMath.ts` | — delete (native detents) | |
| `sidePanelMath.ts` | ML-05 `sidePanelModel.ts` (moved) | |
| `usePullToRefresh.ts` | ML-01 `onRefresh` | |
| `windowInsets.tsx` | ML-01 Screen / `ui/platform` | |

### 7.2 Other legacy component folders

| Legacy files | Replaced by |
|---|---|
| `brand/BrandMark.tsx`, `brand/VendorIcons.tsx` | MP-52 BrandMark |
| `changes/ChangesList.tsx`, `CommitBar.tsx`, `Toolbar.tsx`, `index.ts` | MB-22 ChangesPanel (index deleted) |
| `changes/FileDiff.tsx`, `FileDiffPane.tsx`, `DiffLine.tsx`, `HunkHeader.tsx`, `diff/DiffRowView.tsx` | MB-24 DiffView |
| `changes/api.ts`, `useChangesSummary.ts` | MB-22 / MB-42 `*.queries.ts` |
| `changes/diffModel.ts`, `diffPrefs.ts` | MB-24 `model/` (parsing → client-core `parseUnifiedDiff`) |
| `changes/keptModel.ts` | MB-22 `model/` |
| `changes/statusStyle.ts` | delete (`CHANGE_KIND`) |
| `chat/ChatHeader.tsx` | ML-02 Header + features/chat `ChatStatusLine` |
| `chat/ChatMenuSheet.tsx`, `chat/RenameSheet.tsx` | features/chat `ChatMenu`, `RenameChatSheet` |
| `chat/Composer.tsx`, `chat/composerMenu.ts` | MB-01 Composer (+ `model/`) |
| `chat/composer/AttachmentChips.tsx`, `ComposerBanners.tsx`, `SuggestionStrip.tsx`, `VoicePill.tsx`, `HistorySheet.tsx` | MB-01 parts (AttachmentStrip, BlockingBar, SlashPopover (MP-49), DictationPill, prompt-history menu) |
| `chat/composer/GaugeSheet.tsx` | MB-41 ContextUsage |
| `chat/composer/attachmentPickers.ts`, `attachmentPolicy.ts`, `captureContext.ts`, `captures.ts`, `draftStore.ts`, `promptHistory.ts`, `slashSource.ts`, `types.ts`, `useCaptures.ts` | MB-01 `model/` and `Composer.queries.ts` (moved) |
| `chat/composer/browserConfig.ts` | MB-28 `model/` |
| `chat/composer/newChatModel.ts` | MB-06 `model/` |
| `chat/composer/sourceModel.ts` | MB-45 `model/` |
| `chat/composer/turnOptions.ts` | MB-02 `model/` |
| `chat/composer/useComposerController.ts` | delete (client-core `composerReducer`, MD-03 / D-61) |
| `chat/ModelSheet.tsx` | MB-03 ModelPicker |
| `chat/NewChatSheet.tsx` | MB-06 NewChatSheet |
| `chat/PermissionCard.tsx`, `QuestionCard.tsx`, `PlanCard.tsx`, `gateActions.ts`, `gateFromInteraction.ts`, `permissionPreview.ts` | MB-15 GateCard (+ `model/`) |
| `chat/GateScroll.tsx` | MB-07 (scroll-to-pending-gate) |
| `chat/RewindSheet.tsx`, `chat/rewindOptions.ts` | MB-32 CheckpointScrubber (+ `model/`; testIDs kept) |
| `chat/TurnOptionsSheet.tsx` | MB-02 TurnSheet |
| `chat/UsageFooter.tsx` | MB-09 AgentTurnHeader / MB-41 |
| `chat/chatMotion.ts` | delete (`ui/platform/motion.ts` concepts) |
| `chat/featureFlags.ts` | fold into `services/auth/featureGate.ts` (delete flags that are always on) |
| `chat/sessionTransport.ts` | `services/stream` (data layer, not UI) |
| `chat/toolPresentation.ts` | → client-core (M2) |
| `chat/panes/ChangesTray.tsx` | MB-01 ChangesStrip + MB-22 (Keep all / Undo all testIDs move) |
| `chat/panes/ComputerPane.tsx` | MB-29 ComputerView |
| `chat/panes/computerModel.ts` | → client-core `computer/consentModel.ts` |
| `chat/panes/InspectorSection.tsx` | MB-14 StepDetail |
| `chat/panes/LockedPane.tsx` | MP-35 PermissionState |
| `chat/panes/changeTree.ts` | MB-22 `model/` |
| `chat/panes/paneModel.ts`, `useChangesSummary.ts` | MB-42 WorkspacePane (`model/`, queries) |
| `chat/panes/useTasksSummary.ts` | MB-17 / MB-30 queries |
| `chat/timeline/TimelineRow.tsx`, `RowFrame.tsx`, `TimelineActions.tsx` | MB-07, MB-09, MB-11, MB-13, MB-16 |
| `chat/timeline/UserMessageRow.tsx` | MB-08 UserMessage |
| `chat/timeline/InlineDiff.tsx` | MB-12 ToolCallCard (inline diff card) |
| `chat/timeline/ScmResultRow.tsx`, `mergeScmRows.ts`, `scmResultBlock.ts`, `selectChatView.ts` | MB-07 parts / `model/` |
| `chat/timeline/deriveTimeline.ts`, `chatMessageToBlocks.ts` | → client-core `transcript/` (M2) |
| `chat/workbench/ChangesSection.tsx` | MB-22 |
| `chat/workbench/FilesSection.tsx`, `fileTree.ts`, `recentFiles.ts` | MB-25 FileTree, MB-26 FilePreview, MB-45 SourcesCard (`model/`) |
| `chat/workbench/TerminalSection.tsx` | MB-27 |
| `chat/workbench/BrowserSection.tsx` | MB-28 |
| `chat/workbench/TasksSection.tsx` | MB-30 |
| `chat/workbench/PlanSection.tsx` | MB-31 |
| `common/ConnectionStrip.tsx` | MB-43 ConnectionStatus + MP-34 OfflineState |
| `common/FeatureLocked.tsx` | MP-35 PermissionState |
| `common/States.tsx` | delete (shim) |
| `common/chatName.ts` | MB-48 ChatRow (display fallback) + shared `chatNameFromPrompt` |
| `common/disambiguate.ts`, `groupByDay.ts` | `ui/lib/format.ts` (moved) |
| `common/enterMotion.ts` | delete (`ui/platform/motion.ts`) |
| `common/entityIcons.ts` | delete (MP-02 concept registry) |
| `devices/EditScopesSheet.tsx`, `deviceAdmin.ts` | MB-38 + features/settings `AccessRequestCard`, `features/settings/queries.ts` |
| `devices/PairDeviceSheet.tsx` | features/settings `PairingCodeCard` |
| `devices/QrCode.tsx`, `qrMatrix.ts`, `qrcode-core.d.ts` | MP-50 QrCode |
| `home/ApprovalsQueue.tsx`, `OperationCard.tsx`, `OperationAction.tsx`, `operationActions.ts`, `operationStatus.ts` | MB-19 AttentionList (status → shared maps) |
| `home/DecisionCard.tsx` | MB-34 DecisionCard / MB-18 |
| `home/HealthCard.tsx` | MB-40 / MB-43 |
| `home/StatTiles.tsx` | ML-18 + MB-40 |
| `home/useGateDecision.ts` | MB-15 `GateCard.queries.ts` |
| `markdown/Markdown.tsx`, `MarkdownImage.tsx`, `markdownModel.ts`, `linkPolicy.ts` | MB-10 AssistantText (+ `model/`) |
| `markdown/CodeBlock.tsx`, `codeWrapStore.ts` | MP-42 CodeText |
| `markdown/highlight.ts`, `syntaxColors.ts` | `ui/lib/highlight.ts` (moved) |
| `projects/AddCodebaseSheet.tsx`, `CodebaseWorktrees.tsx`, `CreateProjectSheet.tsx`, `ProjectActions.tsx`, `ProjectArtifacts.tsx`, `ProjectSettingsForm.tsx` | features/projects (`AddCodebaseSheet`, `WorktreeRow`, `ProjectCreateScreen`, `ProjectRow` menu, `CustomizationList`, `ProjectSettingsForm`) |
| `projects/api.ts`, `useProjectsApi.ts` | `features/projects/queries.ts`, MB-44 queries |
| `projects/projectEditModel.ts` | `features/projects/model/` (its status map → shared) |
| `review/CheckpointsSheet.tsx`, `checkpointGroups.ts` | MB-32 |
| `review/PlanSheet.tsx`, `planDecisions.ts` | MB-31 |
| `review/ReviewCommentsSheet.tsx`, `reviewBatch.ts`, `useReviewThreads.ts`, `api.ts` | MB-24 (model, queries) |
| `review/scopes.ts`, `useScopes.ts` | MB-38 |
| `review/index.ts` | delete |
| `runs/ApprovalCard.tsx` | MB-50 ApprovalSheet / MB-18 |
| `runs/FeedbackSheet.tsx` | MB-34 |
| `runs/PermissionModeSheet.tsx`, `permissionMode.ts` | MB-47 |
| `runs/RunRow.tsx` | MB-49 RunRow |
| `runs/StageTimeline.tsx`, `StageTranscriptInline.tsx`, `stageTranscript.ts`, `runModel.ts` | MB-33 RunTimeline (+ `model/`) |
| `runs/StatusGlyph.tsx`, `statusStyle.ts`, `tone.ts` | delete (MP-07 / shared status) |
| `runs/formatTime.ts` | `ui/lib/format.ts` |
| `runs/useFeature.ts` | `services/auth/featureGate.ts` |
| `runs/usePullRefresh.ts` | ML-01 `onRefresh` |
| `scm/ConflictSheet.tsx`, `scmModel.ts`, `scmResults.ts`, `prModel.ts` | MB-22 (`model/`; PR list parts → features/projects) |
| `scm/ConnectGitHubSheet.tsx`, `ScmFlowSheet.tsx`, `deviceLogin.ts`, `api.ts`, `useScmApi.ts`, `useScmResults.ts` | MB-23 CommitSheet |
| `scm/index.ts` | delete |
| `search/SearchResultRow.tsx`, `searchModel.ts` | MB-21 SearchPalette |
| `work/AgentDetailSheet.tsx`, `agentModel.ts` | MB-04 AgentPicker + features/agents |
| `work/ExecutionSheet.tsx`, `automationModel.ts` | features/automations (`ExecutionScreen`, `model/`) |
| `work/ScriptRow.tsx`, `scriptModel.ts` | features/scripts |
| `work/StartRunSheet.tsx`, `TemplatePickerSheet.tsx`, `templateModel.ts`, `workflowHooks.ts` | features/workflows (`RunSheet`, `TemplatePicker`, `model/`, `queries.ts`) |
| `work/StickyActionBar.tsx` | ML-23 |
| `work/TriggerInputSheet.tsx`, `triggerInput.ts`, `variableForm.ts`, `stageOverrideForm.ts` | MB-36 VariableForm (+ `model/`) |
| `work/cards.tsx` | ML-14 EntityRow / feature rows (its status map deleted) |
| `work/projectModel.ts` | features/projects `model/` |
| `work/workSegment.ts` | delete (the "Work" tab is gone) |
| `work/workflowGraph.ts` | MB-35 `model/` |
| `workbench/WorkbenchButton.tsx` | ML-02 pane toggle (`pane-toggle`) |
| `workbench/WorkbenchPanel.tsx`, `WorkbenchSheet.tsx`, `useWorkbench.ts`, `workbenchModel.ts` | ML-07 PaneShell + MB-42 WorkspacePane |
| `workbench/toolIcons.tsx` | delete (MP-02) |

### 7.3 Other UI outside `src/components`

| Legacy file | Replaced by |
|---|---|
| `src/navigation/StackHeader.tsx`, `TabHeaderActions.tsx`, `shell/MenuButton.tsx` | ML-02 Header |
| `src/navigation/RouteSheet.tsx` | ML-10 Sheet (`RouteSheet`) |
| `src/navigation/shell/AppDrawer.tsx` | ML-06 Drawer + `features/shell/ConnectedDrawer` |
| `src/navigation/shell/sections.ts` | delete (`NAV_DESTINATIONS`) |
| `src/navigation/shell/shellStore.ts`, `routes.ts`, `backFallback.ts`, `ErrorBoundary.tsx` | `features/shell/` (moved; ErrorBoundary renders MP-33) |
| `src/navigation/scrollToTop.ts` | ML-01 |
| `src/navigation/tabShell.tsx`, `tabsImplementation.ts` | delete (no tab navigator; `app/(tabs)/` routes become stack routes) |
| `src/terminal/TerminalView.tsx`, `TerminalTabs.tsx`, `AgentConsole.tsx`, `index.ts` | MB-27 TerminalView |
| `src/terminal/terminalHtml.ts`, `bridgeProtocol.ts`, `terminalFocus.ts`, `terminalSettings.ts`, `agentConsoleRows.ts` | MB-27 `model/` (moved; hex fallback removed) |
| `src/auth/AppLock.tsx` (view part) | MP-35 `app-lock` + MX-10 overlay (logic stays in `services/auth`) |
| `src/auth/StepUpGate.tsx` (view part) | MP-35 (logic stays) |
| `src/settings/audioModel.ts` | `features/settings/model/` |
| `app/**` route files | rewritten as thin re-exports of feature screens (MD-14); `app/(tabs)/` removed; `app/approvals.tsx` → MB-50 route |

Pure data-layer folders (`src/api`, `src/auth` logic, `src/stream`, `src/transport`, `src/notifications`, `src/storage`, `src/voice`,
`src/crypto`, `src/native`, `src/prefs`, `src/lib`) move to `src/services/` (MD-14) and are not part of this map; `src/lib/fuzzyMatch.ts` is
deleted in favour of client-core `fuzzyMatch`.

---

## 8. Cross-reference table

"Contract" = the shared type or constant the props follow. Board lists are the primary boards (every screen board uses the primitives).

### 8.1 Primitives

| ID | Name | Impl | Web | Contract | Boards |
|---|---|---|---|---|---|
| MP-01 | Text | J | — | design-tokens type ramp (`GEOMETRY.ios/android.type`) | MFoundations |
| MP-02 | Icon | P | P-01 | `IconConcept`, `ICON_CONCEPTS` | all |
| MP-03 | Pressable | J | — | `HapticConcept` | all |
| MP-04 | Button | J | P-02 | — | MComponents, Main |
| MP-05 | IconButton | P | P-03 | — | MComponents headers |
| MP-06 | Badge | J | P-05 | — | MScopeRequest, MChatWorkflowRun |
| MP-07 | StatusBadge | J | P-06 | `StatusBadgeProps`, `STATUS_STATE_DEFS`, `resolveStatus` | MComponents, status lines |
| MP-08 | StatusDot | J | P-07 | `StatusState`, `HEALTH` | MSidebar, MServers, MWidgets |
| MP-09 | Count | J | P-08 | — | MPaneOpen, MChats |
| MP-10 | Chip | J | P-09 | — | MComponents, MChats, MComposerInput |
| MP-11 | ChipGroup | J | P-09 ChipList, C-04 | — | MChats, MNewChatMore |
| MP-12 | Spinner | J | P-12 | `STATUS_STATE_DEFS.running` | all running states |
| MP-13 | ProgressIndicator | N | — | — | derived |
| MP-14 | ProgressBar | J | P-38 | — | MProjectDetail, MSetStorage |
| MP-15 | ProgressSegments | J | WF-12 part | `StatusState` | MChatWorkflowRun, MLiveActivity |
| MP-16 | Input | P | P-13 | — | MComponents text fields, MSetMcpAdd |
| MP-17 | SearchInput | P | P-14 | — | MChats, MSearch, MSidebar |
| MP-18 | Textarea | P | P-15 | — | MNewChat, MPaneCommit |
| MP-19 | Field | J | P-16 | — | settings forms |
| MP-20 | Checkbox | J | P-21 | — | MScopeRequest, MSetSecurity |
| MP-21 | RadioGroup | J | P-23 | — | MModelPicker, MAgentPicker |
| MP-22 | Switch | N | P-22 | — | MComponents, MAgentPickerCaps |
| MP-23 | SegmentedControl | N/J | P-25 | — | MChats, MModelPicker, MPaneOpen |
| MP-24 | Select | N | P-17 | — | MSetGeneral, MPaneCommit |
| MP-25 | Slider | N | P-46 | — | MSetBrowserTerminal |
| MP-26 | DatePicker | N | — | — | MAutomationCreate2 |
| MP-27 | Menu | N | P-30 | — | MComposerPlus, MWorkflowRunMenu |
| MP-28 | ContextMenu | N | P-30 | — | MComponents menus, MPaneChanges |
| MP-29 | AlertDialog | N | P-32 | — | MComponents confirmation, MAgentDelete |
| MP-30 | Toast | J | P-34 | — | MComponents toasts |
| MP-31 | Skeleton | J | P-37 | — | MComponents |
| MP-32 | EmptyState | J | P-41 | `EMPTY_STATE_COPY`, `EmptyStateKey` | MComponents, MWidgets |
| MP-33 | ErrorState | J | P-41 + C-29 | — | derived |
| MP-34 | OfflineState | J | C-29 | `ConnectionHealth` | derived |
| MP-35 | PermissionState | J | — | — | derived |
| MP-36 | Separator | J | P-35 | — | all |
| MP-37 | AgentGlyph | J | P-11 | — | MComponents, MAgentPicker |
| MP-38 | GlassSurface | P | — | — | MFoundations (glass) |
| MP-39 | KbdHint | J | P-04, C-27 | `formatBindingText`, `COMMANDS` | MTabletIOS (notes) |
| MP-40 | PairingCodeInput | J | C-28 | — | MPairing, MSetPairDevice |
| MP-41 | Gauge | J | P-39 | — | MModelPicker |
| MP-42 | CodeText | J | P-44, C-23 | — | Main, MChatStepDetail |
| MP-43 | NumberField | P | P-20 | — | MSetStorage, MStagePolicy |
| MP-44 | Link | J | P-42 | — | MHome, MModelPicker |
| MP-45 | Callout | J | P-40, C-29 | — | MChatStepDetail, MSetNotifications |
| MP-46 | Card | J | P-48 | — | all |
| MP-47 | Collapsible | J | P-45 | — | MSetProviders, MSetMcp |
| MP-48 | ChoiceCard | J | P-24, C-26 | — | MAutomationCreate2, MAgentNew |
| MP-49 | Popover | J | P-29 | `SlashCommand` (host) | MComposerInput |
| MP-50 | QrCode | J | — | — | MSetPairDevice |
| MP-51 | DiffStat | J | C-33 | `ChatRowChanges` | MChats, MPaneOpen |
| MP-52 | BrandMark | J | web `ui/icons` vendor marks | `HARNESS_PROVIDERS` | MSidebar, MPairing |

### 8.2 Layout and shell

| ID | Name | Impl | Web | Contract | Boards |
|---|---|---|---|---|---|
| ML-01 | Screen | J | T-01…T-05 | — | all |
| ML-02 | Header | P | C-01 | `NavDestination` (titles) | MComponents headers, MFoundations |
| ML-03 | Breadcrumb | J | C-02 | — | all detail boards |
| ML-04 | StatusLine | J | C-01/C-03 | `StatusBadgeProps` | Main, MChatRunning |
| ML-05 | SidePanel | J | C-20, S-09 | — | MSidebar, MPaneOpen, MGestures |
| ML-06 | Drawer | J | S-02 | `NAV_DESTINATIONS` | MSidebar, MSidebarChats |
| ML-07 | PaneShell | J | S-08 | `DockScope` | MPaneOpen, MPaneChanges |
| ML-08 | PaneTabStrip | P | C-19 | `DockTabType`, `DOCK_PINNED_TABS`, `DOCK_CONDITIONAL_TABS`, `DOCK_TAB_CAPS` | MPaneTabsOverview, MPaneTerminal |
| ML-09 | NewAction | P | — | — | MHome, MChats |
| ML-10 | Sheet | N | P-33, P-31 | — | MComponents sheets, MModelPicker |
| ML-11 | FullScreenEditor | N | L-02, T-03 | — | MAgentEdit*, MAutomationCreate* |
| ML-12 | ListSection | P | C-13 | — | settings boards |
| ML-13 | ListRow | J | C-13 SettingRow | — | settings boards |
| ML-14 | EntityRow | J | C-07, B-26 | `ChatRowModel` (via MB-48) | MChats, MProjects, MAgents |
| ML-15 | SwipeRow | J | — | — | MChats, MGestures |
| ML-16 | ReorderList | J | — | — | MBuilderList |
| ML-17 | AdaptiveLayout | J | S-01, C-20 | — | MTabletIOS, MTabletAndroid |
| ML-18 | StatTile / StatStrip | J | C-10 | — | MHome, MHomeMore |
| ML-19 | KeyValueList | J | C-11 | — | MSetDiagnostics |
| ML-20 | SectionHeader | J | C-12 | — | all lists |
| ML-21 | Stepper | J | C-17 | — | MAutomationCreate*, MScopeRequest |
| ML-22 | FormSection | J | C-14 | — | MNewChat, MAgentEdit* |
| ML-23 | StickyActionBar | P | C-16 | — | MNewChat |
| ML-24 | FactStrip | J | C-10 variant | — | MChatStepDetail |
| ML-25 | BulkActionBar | P | C-06 | — | derived (MChats) |
| ML-26 | ScrollToLatest | P | B-24 part | `TRANSCRIPT_COPY.jumpToLatest` | MChatRunning |
| ML-27 | BottomToolbar | P | P-47 | — | MChatStepDetail |
| ML-28 | SearchHeader | P | C-21 | — | MSearch |
| ML-29 | KeyboardStickyBar | J | — | — | MPaneTerminalFull, composer |
| ML-30 | DirtyGuard | J | — | — | MPrinciples (dirty sheets) |

### 8.3 Blocks

| ID | Name | Web | Contract | Boards |
|---|---|---|---|---|
| MB-01 | Composer | F-composer, WF-17 | `ComposerView`, `ComposerBinding`, `ComposerVariant`, `COMPOSER_TOOL_TOGGLE_IDS`, `composerReducer`, `SlashCommand` | MComponents composer, Main, MComposer* |
| MB-02 | TurnSheet | B-01 (popover) | `ModelPickerCatalog`, `PickerModel` | MModelPicker |
| MB-03 | ModelPicker | B-01 | `ModelPickerCatalog`, `ProviderAvailability` | MModelPicker, MSetGeneral |
| MB-04 | AgentPicker | B-02 | — | MAgentPicker |
| MB-05 | CapabilityEditor | B-03 | — | MAgentPickerCaps, MAgentEdit3 |
| MB-06 | NewChatSheet | F-create | `CreateChatDraft`, `chatNameFromPrompt` | MNewChat, MNewChatMore |
| MB-07 | TranscriptView | B-24 | `TranscriptTurn`, `TimelineEntry`, `TRANSCRIPT_COPY`, `TranscriptViewMode` | Main, MChatRunning |
| MB-08 | UserMessage | B-14 | — | Main |
| MB-09 | AgentTurnHeader | B-15 | `UsageInfo` | MComponents transcript kit |
| MB-10 | AssistantText | B-19 | — | Main, MPanePlan |
| MB-11 | StepRow | B-17 | `TimelineStep`, `StepKind`, `STEP_VERBS` | MChatToolsExpanded |
| MB-12 | ToolCallCard | B-18 | `TimelineStep.tool`, `InlineHunks` | MChatWorkflowRun |
| MB-13 | StepGroupCard | B-24 (TurnBody) | `StepGroup`, `MIN_GROUP` | Main, MChatToolsExpanded |
| MB-14 | StepDetail | — | `TimelineStep` | MChatStepDetail |
| MB-15 | GateCard | B-20, C-30 | `GateKind`, `GATE_ACTIONS`, `gateLifecycle`, `*_GATE_COPY` | Main, MComponents gates |
| MB-16 | InlineError | B-21 | — | MChatToolsExpanded |
| MB-17 | DelegationGroup | B-22 | `LiveCounters` | MChatRunning |
| MB-18 | Workflow tool cards | WF-12, WF-13, WF-14 | `STATUS_MAPS.workflowRun` | MChatWorkflowRun |
| MB-19 | AttentionList | B-25 | `AttentionItem`, `AttentionCounts` | MSidebar, MHome |
| MB-20 | ServerSwitcher | S-02 switcher | `ConnectionHealth` | MServers |
| MB-21 | SearchPalette | S-10, C-21 | `COMMANDS`, `NAV_DESTINATIONS` | MSearch |
| MB-22 | ChangesPanel | `blocks/changes`, `blocks/scm` CommitBar | `CHANGE_KIND` | MPaneOpen, MPaneChanges, MTabletIOS |
| MB-23 | CommitSheet | `blocks/scm` | — | MPaneCommit, MPaneCommitDone |
| MB-24 | DiffView | B-07 | `ParsedDiff`, `DiffRow`, `ReviewThreadStatus` | MPaneDiff |
| MB-25 | FileTree | B-08 | `CHANGE_KIND` | MPaneFiles |
| MB-26 | FilePreview | B-09 | — | MPaneFilePreview |
| MB-27 | TerminalView + KeyRow | B-10, C-24 | `DOCK_TAB_CAPS.terminal` | MPaneTerminal, MPaneTerminalFull |
| MB-28 | BrowserView | `blocks/browser` | `DOCK_TAB_CAPS.browser` | MPaneBrowser, MPaneBrowserStates |
| MB-29 | ComputerView | features/chat/dock/computer | `ComputerDeskState` | MPaneComputer |
| MB-30 | TasksList / TaskDetail | F-dock-06 | `STATUS_MAPS` | MPaneTasks, MPaneTaskDetail |
| MB-31 | PlanView | `blocks/plan` | `GATE_ACTIONS.plan`, `GateStatusMap['plan']` | MPanePlan |
| MB-32 | CheckpointScrubber | `blocks/changes/checkpoints` | — | MPaneOpen, MTabletIOS |
| MB-33 | RunTimeline / StageRow | WF-04, WF-05 | `STATUS_MAPS.stageRun` | MWorkflowRun, MRunLoop |
| MB-34 | DecisionCard / ReviewCard | WF-08, WF-09 | — | MRunLoop, MRunApproval |
| MB-35 | RunGraph | L-04, WF-15 | — | MRunGraph, MBuilderGraph |
| MB-36 | VariableForm | L-05 run dialog | workflow-spec `VariableDefinition` | MWorkflowLaunch |
| MB-37 | ValidationList | WF-03 | workflow-spec issues | MWorkflowValidate |
| MB-38 | ScopeRequestCard | — | — | MScopeRequest |
| MB-39 | QrScanner | — | — | MPairing |
| MB-40 | StatsCards | C-10 bound | — | MHome, MHomeMore |
| MB-41 | ContextUsage | B-13, WF-07 | `UsageInfo` | MModelPicker |
| MB-42 | WorkspacePane | `blocks/dock` | `DockTabType`, `DockScope`, `dockStorageKeys`, `parseDockLinkTab` | MPaneOpen, MWorkflowRunPane |
| MB-43 | ConnectionStatus | B-12 | `ConnectionHealth`, `HEALTH` | MSidebar, MHome |
| MB-44 | ProjectPicker | B-06 | — | MNewChatMore |
| MB-45 | SourcesCard | B-05 | — | MPaneFiles, MNewChatMore |
| MB-46 | CapabilitySummary | B-27 | — | MAgentDetail, MNewChatMore |
| MB-47 | PermissionModePicker | run dialog | — | MWorkflowLaunchAdvanced |
| MB-48 | ChatRow | B-26 ChatsTable | `ChatRowModel`, `toChatRowModel` | MChats |
| MB-49 | RunRow | B-26 RunsTable | `STATUS_MAPS.workflowRun` | MWorkflowDetail |
| MB-50 | ApprovalSheet | WF-09 | `GateKind` | MRunApproval |

### 8.4 Native extension targets

| ID | Name | Built with | Contract | Boards |
|---|---|---|---|---|
| MX-01 | iOS Live Activity | expo-widgets | `LiveEntity` (MX-11) | MLiveActivity |
| MX-02 | Android Live Update | `modules/generatorai-live` (Kotlin, FGS `specialUse`) | `LiveEntity` | MLiveActivity |
| MX-03 | iOS widgets | expo-widgets (WidgetKit) | widget snapshot | MWidgets |
| MX-04 | Android widgets | expo-widgets 58 (Glance) | widget snapshot | MWidgets |
| MX-05 | iOS Control Center control | `@bacons/apple-targets` + AppIntent | `launcherActionLink` | MWidgets |
| MX-06 | Android QS tile | `modules/generatorai-live` TileService | widget snapshot | MWidgets, MNotifications |
| MX-07 | Notification categories | expo-notifications | `GateKind`, gate copy | MNotifications |
| MX-08 | Quick actions | expo-quick-actions | `LAUNCHER_ACTIONS` | MShortcuts |
| MX-09 | Share target | expo-share-intent | `ChatRowModel` | MShortcuts |
| MX-10 | App-switcher privacy | expo-screen-capture + module | — | MSetAppLock |
| MX-11 | Live-state model + bridge | client-core `live/`, `services/native/liveBridge.ts` | `LiveEntity`, `AttentionItem` | MSetWidgets |
