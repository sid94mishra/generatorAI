# Mobile stack: styling, components, platform languages, type, icons, tokens (research, 2026-09-26)

Scope: verify, refresh and deepen `docs/redesign/research/mobile-stack-research.md` (2026-09-24) for the mobile redesign
(same screens on iOS 27 and Android 17, native controls and chrome per platform). Seven questions, each with findings,
an options table, a recommendation with confidence, and risks. A package table closes the document.

Method. Versions and dates come from `npm view <pkg> dist-tags time --json` (queried 2026-09-26). Docs were read from the
Expo docs source on GitHub (`docs/pages/versions/{v57.0.0,v58.0.0,unversioned}`), the Expo SDK 58 beta changelog, the
GitHub REST API (issues, PRs, commits), vendor docs and primary blog posts. "Fetched" dates are 2026-09-26 unless stated.
Anything not verified against a primary source is marked as such.

Repo state that matters here (read on 2026-09-26): `apps/mobile` runs Expo `~57.0.0`, RN `0.86.2`, NativeWind `^4.2.1` on
`tailwindcss ^3.4.17`, `lucide-react-native ^0.460.0`, `@gorhom/bottom-sheet ^5.2.6`, RNGH `~2.32.0`, Reanimated `~4.5.1`.
NativeWind usage: 1,708 `className=` occurrences in 152 files, `cssInterop` in `src/components/ui/animated.ts`, `vars()` in
`src/theme/ThemeProvider.tsx`. `apps/web` is on `tailwindcss ^4.3.3`, `tailwind-merge ^3.7.0`, `lucide-react ^1.48.0`.
`packages/design-tokens` already has an icon concept registry with empty `sfSymbol`/`material` slots (`src/icons.ts`), a
per-platform geometry type with `ios`/`android` left `undefined` (`src/geometry.ts`), contrast maths (`src/color.ts`
`ensureContrast`) and `css/vocabulary.css` written "for mobile's Uniwind CSS in the next pass".

---

## 0. What changed since the 2026-09-24 research

New facts:

1. **Expo SDK 58 is in beta, not just "on `next`".** Beta opened 2026-09-15 for "three to four weeks"; stable ships
   "shortly after" React Native 0.88 is released. The SDK 58 bundle pins **RN 0.88.0-rc.1, React 19.3.0,
   Reanimated 4.7.0, worklets 0.13.0, RNGH ~3.2.1, react-native-screens ~4.28.0** (`expo@58.0.0-preview.7`,
   2026-09-25, `bundledNativeModules.json`). RN 0.88.0-rc.2 was published 2026-09-21. SDK 57 bundles RN 0.86.3.
   Source: https://expo.dev/changelog/sdk-58-beta (2026-09-15).
2. **SDK 58 makes native tabs, `Stack.Toolbar` and the standard navigation integration stable**, reworks the router core
   and turns `@expo/ui` and `expo-symbols` into optional peers of `expo-router` (install `expo-symbols` for
   `NativeTabs.Trigger.Icon md=…` on Android and `@expo/ui` for `Stack.Toolbar`). Same source.
3. **Expo UI in SDK 58** adds iOS `NavigationStack`, `Toolbar`, `NavigationLink`, `NavigationSplitView` (2/3 columns),
   Compose `Image`, `DateRangePicker`, `DateRangePickerDialog`, `VerticalSlider`, and fixes `RNHostView` measurement
   ("dropped presses, gestures stolen from an enclosing scrollable, and missing touches inside BottomSheet, Popover,
   AlertDialog and DropdownMenu"). Breaking: iOS `Host` now top-aligns content; `HStack`/`VStack`/`GlassEffectContainer`
   use system default spacing when `spacing` is unset. Same source.
4. **`expo-font` variable fonts land in SDK 58** (config plugin, `useFonts`, `loadAsync`), paired with RN 0.88's
   `fontVariationSettings` on `Text`. Same source; `docs/pages/versions/v58.0.0/sdk/font.mdx`.
5. **iOS 27**: `UIDesignRequiresCompatibility` is ignored when building with the iOS 27 SDK, so Liquid Glass can no longer
   be opted out of; the scene life cycle is required; iPhone apps become resizable. `expo-glass-effect` reports
   `isLiquidGlassAvailable() === true` for iOS 27 SDK builds (expo#49850, SDK 58). iOS 27 also adds a user transparency
   slider ("ultra clear" to "fully tinted") and darker glass edges.
6. **Uniwind has a live regression**: `ios:`/`android:`/`native:` classes leak into the other platform's bundle with
   Tailwind 4.3.3, which Uniwind 1.12.0 pins internally (issue #668, 2026-09-05). Fix merged 2026-09-23 (PR #686) but
   **not released**: `uniwind@latest` is still 1.12.0 (2026-09-04). Uniwind Pro's compatibility page lists RN 0.81–0.87 /
   Expo 54–57 only, so **SDK 58 (RN 0.88) is not yet declared supported**.
7. **NativeWind 5 is still RC.** `nativewind@latest` = 4.2.7; `rc` = 5.0.0-rc.0 (2026-09-13). The last maintainer update
   (2026-09-24) says performance work continues "leading into moving it to main"; benchmarks promised "next week".
8. **`react-native-web` 0.21.3 was released 2026-09-25** (the earlier note said no release since 2025-10-16).
9. **Shopify is leaving React Native** (2026-09-10): Shop, Shopify, POS and Inbox move to Swift/Kotlin; Restyle is
   archived after 2026; FlashList seeks community stewardship. See §7.

Corrections to the 2026-09-24 document:

- **`expo-symbols` already renders Material Symbols on Android and web** (docs list `platforms: android, ios, tvos, web`
  since SDK 55; SDK 54 was iOS-only). It is not "iOS only, Android via Expo UI `Icon`". §5.
- **expo#46850 is about filled Material Symbols not rendering on Android/web** (still open, 2026-06-12), not about blank
  icons when a font or plugin is missing. §5.
- **Expo no longer ships a Tailwind/NativeWind agent skill.** `expo/skills` removed it on 2026-08-31 ("[expo] remove
  NativeWind skill (#151)"). The current `expo-design-system` skill is library-neutral ("For Tailwind projects, keep tokens
  in `global.css` as CSS variables and follow the styling library's own setup guidance").
- **NativeWind 5 RC's install line pins `tailwindcss@4.1.12`** (peer range `>4.1.11`), confirmed from the RC notes.
- New finding in the repo: **the lucide babel plugin will silently stop working on lucide 1.x.** §5.

---

## 1. Styling engine

### Findings

- **Uniwind 1.12.0** (2026-09-04, MIT, 1,717 stars, 13 open issues, last push 2026-09-25). Depends on
  `@tailwindcss/node 4.3.3` and `lightningcss 1.30.1` exactly; peer `react-native >=0.81`, `tailwindcss >=4`. Web is on
  Tailwind 4.3.3, so **mobile and web would compile the same Tailwind version**.
  - Theming: unlimited `@variant` themes, `Uniwind.setTheme()`, `Uniwind.updateCSSVariables(theme, vars)` ("Variable
    changes are persisted per theme"; re-renders only if the modified theme is active; variables must already be declared
    in a `@variant`/`@theme` block), `<ScopedTheme theme>` (nearest wins, nestable), and **`<ScopedVariables>` (1.11.0+)**
    for subtree variable overrides, which fits accent swatches and the Appearance picker's previews.
  - Platform: `ios:`/`android:`/`native:`/`web:`/`tv:` class variants at runtime, and **build-time `@variant ios { … }`
    inside `@layer theme`**, which is how per-platform geometry can live in one CSS file.
  - CSS functions: `fontScale()`, `pixelRatio()`, `hairlineWidth()`, `light-dark()`; they must be wrapped in `@utility`
    definitions, not used as arbitrary className values (which the repo forbids anyway).
  - Open issues that affect us: #668 platform-variant leak (fixed on main, unreleased); #623 `@theme` namespace resets
    (`--color-*: initial`) imported after `@import "uniwind"` silently drop theme utilities (our vocabulary locks the
    namespace, so import order matters); #689 stale styles after React `Activity` reconnects (fix PR #690 merged
    2026-09-25; relevant because SDK 58 router uses `Activity`); #682 Pro + OSS in one pnpm monorepo (Pro only);
    #518 Pro-only theme-flip staleness with native-stack; #667 Pro-only remounts.
  - Pro (paid): C++ shadow-tree updates, className-driven Reanimated, native theme transitions, `group-*` variants.
    Compatibility RN 0.81–0.87 / Expo 54–57, nitro-modules >= 0.37.1 (repo has 0.36).
  - Uniwind ships an agent skill (skills.sh `uni-stack/uniwind`) and a NativeWind migration guide.
- **NativeWind 5.0.0-rc.0** + `react-native-css 3.1.0-rc.0` (2026-09-13), targets Expo 57.0.22 / RN 0.86.3 /
  Reanimated 4.5.1. Install requires `tailwindcss@4.1.12`. Breaking: `cssInterop`/`@react-native` directives error,
  `:root.dark` rejected (use `prefers-color-scheme`), `vars()` deprecated in favour of `VariableContextProvider` +
  `Appearance.setColorScheme()`. Known issue: Android animation cancellation (Reanimated #10507). The C++/Nitro engine
  (`react-native-css-nitro`, writes styles via `UIManager.updateShadowTree`) is still a preview repo. No SDK 58 statement.
- **Unistyles 3.3.0** (2026-07-10; same authors as Uniwind; 55 open issues). StyleSheet API, C++ theme registry,
  `ScopedTheme`, no Tailwind vocabulary.
- **Tamagui 2.7.7** (2026-08-15) with `3.0.0-beta` on npm; 90 open issues. Own style system and compiler.
- **StyleSheet + generated tokens**: Bluesky's `@bsky.app/alf` 0.1.15 (atoms + tokens) on Expo 57 / RN 0.86.3; Shopify's
  Restyle is being archived.

### Options

| Option | Status (version, date) | Pros | Cons | Evidence |
|---|---|---|---|---|
| **Uniwind OSS 1.x** | 1.12.0, 2026-09-04; fix for #668 on main 2026-09-23, unreleased | Same Tailwind (4.3.3) as web; build-time CSS; per-theme runtime vars; `ScopedTheme` + `ScopedVariables`; `@variant ios/android` for per-platform tokens; `fontScale()`; free tier has no hard blockers | Young, single-vendor; current release has the platform-variant leak; SDK 58/RN 0.88 not declared; Pro features (className animations, native theme transitions) paid | https://github.com/uni-stack/uniwind/issues/668 , https://github.com/uni-stack/uniwind/pull/686 , https://docs.uniwind.dev/theming/update-css-variables , https://docs.uniwind.dev/api/scoped-themes , https://docs.uniwind.dev/api/platform-select , https://docs.uniwind.dev/api/css-functions , https://docs.uniwind.dev/pro/compatibility |
| Uniwind Pro | 1.7.0 | Zero-re-render theme switches, animated classNames | Paid; RN <= 0.87 / SDK <= 57; open Pro-only theme bugs (#518, #667); pnpm conflicts (#682) | https://docs.uniwind.dev/pro-version , https://github.com/uni-stack/uniwind/issues/518 |
| NativeWind 5 | 5.0.0-rc.0, 2026-09-13 (still RC on 2026-09-26) | Closest to today's API; large user base; `vars()` still works (deprecated) | RC; pins Tailwind 4.1.12 (web is 4.3.3, so two Tailwind 4 versions in the workspace); Nitro engine preview only; no dedicated scoped-theme API | https://github.com/nativewind/nativewind/releases/tag/5.0.0-rc.0 , https://github.com/nativewind/nativewind/discussions/1818 |
| NativeWind 4 (stay) | 4.2.7, 2026-09-14, maintenance | Zero migration | Tailwind 3 only; divergent vocabulary from web; no future | npm registry |
| Unistyles 3 | 3.3.0, 2026-07-10 | Fast, mature theming | No Tailwind vocabulary, so the shared `bg-surface`/`text-fg-2` language is lost | https://unistyl.es/v3/guides/theming/ |
| Tamagui | 2.7.7 / 3.0.0-beta | Nested themes, compiler | Churn (v2 May 2026, v3 beta now); own vocabulary | https://github.com/tamagui/tamagui/releases |
| StyleSheet + tokens (ALF-style) | n/a | No dependency; full control | Every component re-renders on theme change unless you build a store; no class vocabulary shared with web; more code for LLM implementers | https://github.com/bluesky-social/social-app/blob/main/package.json |

### Recommendation (confidence: medium-high)

**Keep the Uniwind decision, OSS tier only, with two gates.**

1. Why it is still the best fit: it is the only Tailwind 4 engine for RN with a stable release, it compiles with the
   same Tailwind version as web (4.3.3), its theme model (36 theme×appearance `@variant`s, accent via
   `updateCSSVariables`, previews via `ScopedTheme`/`ScopedVariables`) maps onto the existing mode/theme/accent model,
   and build-time `@variant ios|android` lets one generated CSS file carry per-platform geometry (§6).
2. **Gate A (release):** do not adopt `ios:`/`android:` classes until a Uniwind release containing PR #686 ships (first
   release after 1.12.0). Until then either stay on 1.12.0 and avoid platform class variants (use `@variant ios|android`
   in CSS and `.ios.tsx`/`.android.tsx` files instead), or pin 1.11.0 (the #668 reporter's workaround pins Tailwind 4.3.2
   too, which diverges from web).
3. **Gate B (SDK 58 spike):** before the foundation phase, spend half a day running Uniwind 1.12.x on
   `expo@58.0.0-preview` (RN 0.88 rc). The OSS package has no RN upper bound and already fixed the RN 0.87 Strict
   TypeScript API issue (#635/#636, closed 2026-08-19), but no one has declared 0.88 support.
4. Do not buy Pro now: it lags one SDK, its open bugs are Pro-only, and nothing in the redesign needs className-driven
   Reanimated (use Reanimated CSS transitions, per Expo's `expo-animation` skill).
5. Fallback: NativeWind 5 once it is `latest` and declares SDK 58. The class vocabulary is the same, so a switch is a
   Metro/Babel/theme-provider change, not a screen rewrite.

**Migration effort from NativeWind 4 + `vars()`** (M = mechanical, D = design work):

| Step | Effort |
|---|---|
| Remove `nativewind`, `tailwind.config.js`, `nativewind-env.d.ts`, `jsxImportSource: 'nativewind'` and `nativewind/babel` from `babel.config.js`; wrap `metro.config.js` with `withUniwindConfig` (keep the pnpm resolver settings, `unstable_enablePackageExports`) | M, ~0.5 day |
| Replace `src/theme/global.css` with `@import "tailwindcss"; @import "uniwind";` + generated `vocabulary.css` + generated `uniwind-themes.css` (§6); watch import order (#623) | M, ~0.5 day |
| Rewrite `ThemeProvider.tsx`: `vars()` → `Uniwind.setTheme('<theme>-<appearance>')` + `Uniwind.updateCSSVariables(active, accentVars)`; keep hold-splash-until-hydrated so the first frame is correct | M+D, ~1 day |
| `animated.ts`: `cssInterop(...)` → `withUniwind(...)` for Animated/Reanimated components | M, ~0.5 day |
| Rename classes in 152 files (1,708 `className=`) to the shared vocabulary; `rem` is 16 in Uniwind vs 14 in NativeWind, so emit px tokens and never use `rem` | M, largely absorbed by the redesign itself since every screen is restyled |
| Add a CI check that every mobile class is in the generated vocabulary (unknown classes are silently ignored) | M, ~0.5 day |

Risks: single-vendor project (mitigated by plain Tailwind vocabulary); release cadence vs our needs (#668 took 18 days
to merge, still unreleased); SDK 58 support unverified; `Activity` + stale-style bug class (#689) resurfacing with the SDK
58 router's `activityEnabled`.

---

## 2. Component foundation

### Findings

**Expo UI (`@expo/ui`)**: `latest`/`sdk-57` = 57.0.20 (2026-09-24), `next` = 58.0.7 (2026-09-25). Stable since SDK 56
("API is mostly stable" for both SwiftUI and Compose; the universal layer is "a first iteration", web experimental).
Component lists below are the doc pages present in `docs/pages/versions/v57.0.0/sdk/ui/` and `v58.0.0/…` on 2026-09-26.

- **SwiftUI (iOS), SDK 57:** AccessoryWidgetBackground, Alert, BottomSheet, Button, ColorPicker, ConfirmationDialog,
  ContextMenu (with `ContextMenu.Preview`), ControlGroup, DatePicker, DisclosureGroup, Divider, Form, Gauge, Group, Host,
  HStack, Image, Label, LazyHStack, LazyVStack, Link, List, Menu, Namespace, Overlay, Picker (segmented, menu, wheel
  styles), Popover, ProgressView, RNHostView, ScrollView, Section, SecureField, Slider, Spacer, SwipeActions, TabView,
  Text, TextField, Toggle (switch/button styles), VStack, ZStack; plus modifiers (including `glassEffect`,
  `presentationDetents`, `presentationBackground`) and `GlassEffectContainer`. **SDK 58 adds** Background,
  NavigationStack, Toolbar, NavigationLink, NavigationDestination, NavigationSplitView, `navigationTitle`, `menuStyle`,
  `menuIndicator`, ShapeStyle-accepting modifiers.
- **Jetpack Compose (Android), SDK 57:** AlertDialog, Badge, BadgedBox, BasicAlertDialog, BottomSheet (ModalBottomSheet),
  Box, Button, Card, Carousel, Checkbox, Chip, colors (`useMaterialColors`, `seedColor`), Column, DateTimePicker, Divider,
  DockedSearchBar, DropdownMenu, ExposedDropdownMenuBox, FloatingActionButton (Small, standard, Large, **Extended** with
  animated expand/collapse), FlowRow, **HorizontalFloatingToolbar** (M3 Expressive, scroll-driven hide/show),
  HorizontalPager, Host, Icon, IconButton, LazyColumn, LazyRow, ListItem, **LoadingIndicator** (M3 Expressive morphing
  shape, contained variant), NavigationBar, Progress, PullToRefreshBox, RadioButton, Row, SearchBar, SegmentedButton
  (single/multi-choice rows), **Shape** (polygons/stars with `cornerRounding`, `smoothing`), Slider, Snackbar, Spacer,
  Surface, Switch, Text, TextField, **ToggleButton** (+ Icon/Filled/Outlined variants), Tooltip. **SDK 58 adds** Image,
  DateRangePicker, DateRangePickerDialog, VerticalSlider; DropdownMenu gains `cornerRadius`, `shadowElevation`.
  Expo UI builds against `androidx.compose.material3:1.5.0-alpha17`. **Not present:** `ButtonGroup` (connected button
  group), top app bars (small/medium/large flexible), side/edge sheets, split buttons.
- **Universal (`@expo/ui` root), SDK 57 and 58:** BottomSheet, Button, Checkbox, Collapsible, Column, FieldGroup, Host,
  Icon, List, Picker, RNHostView, Row, ScrollView, Slider, Spacer, Switch, Text, TextInput (+ Menu per the Expo skill).
- **Drop-in replacements** (`@expo/ui/community/*`, SDK 56): datetime-picker, slider, pager-view, picker,
  segmented-control, masked-view, menu (`@react-native-menu/menu`), bottom-sheet (`@gorhom/bottom-sheet`).
- **Host/Yoga interaction:** `Host` is an RN `View`; inside it SwiftUI/Compose lay out, not Yoga. `matchContents` works
  only for intrinsically sized controls (Button, Toggle, Text); Slider/linear progress need a `frame` or explicit `style`.
  An RN view inside a Host switches back to RN; a native control inside that RN view needs a new Host. RN views go inside
  native trees through `RNHostView`. `ignoreSafeArea="keyboard"` when `react-native-keyboard-controller` owns the
  keyboard. `@expo/ui/swift-ui` imported on Android (or vice versa) crashes ("Unable to get view config"), so platform
  trees live in `.ios.tsx`/`.android.tsx` files outside `app/`.
- **Performance:** each Host is a `UIHostingController` / `ComposeView`. Expo publishes no numbers. The Expo skill warns
  `List` is not virtualized ("rows are not recycled"). Treat Hosts as leaf controls, a handful per screen, and never one per
  row in a long virtualized list.
- **SwipeActions requires a SwiftUI `List`** (doc example wraps it in `List > Section`), so it cannot decorate
  `@legendapp/list` rows. Swipe actions on our chat/run lists stay JS (RNGH + Reanimated; the repo has `SwipeableRow.tsx`).
- Expo's own guidance (`expo/skills` `expo-ui` 1.0.0 and `expo-native-ui` 1.1.1): default to `@expo/ui` for sheets,
  pickers, sliders, toggles, menus and grouped-form sections; use FlatList/FlashList (or Legend List) for long lists.

**React Native Reusables** (8,670 stars, last push 2026-09-17; `@rn-primitives/*` 1.5.2, 2026-07-02): copy-in shadcn-style
components, Uniwind template since Dec 2025, recent commits add reduced-motion and overlay accessibility.
**gluestack-ui 5** (`@gluestack-ui/core` 5.0.15, 2026-06-25): Tailwind 4 / NativeWind 5 / Uniwind; overlaps with RNR.

**Other native pieces:** expo-router `NativeTabs` (UITabBar with Liquid Glass / M3 NavigationBar; stable in SDK 58,
`unstable-native-tabs` on 57), native-stack headers with `Stack.Toolbar`, `formSheet`; TrueSheet 3.11.15 (2026-09-24,
0 open issues, v4.0.0-beta.19); `@gorhom/bottom-sheet` 5.2.14 (2026-05-09, open bugs including a closed-sheet backdrop
that blocks touches, #2764). react-native-screens 4.28.0 has **no in-app predictive-back preview animation**; the
maintainers deferred it to the next major (Stack v5 is in alpha, 5.0.0-alpha.3). Android 16+ still runs the system
predictive back-to-home animation and `BackHandler` works (RN 0.81 notes).

### Options

| Option | Status | Pros | Cons | Evidence |
|---|---|---|---|---|
| **Expo UI platform layers** (`swift-ui`, `jetpack-compose`) | 57.0.20 / 58.0.7 | Real UIKit/SwiftUI and M3 controls; Liquid Glass and M3 Expressive for free; first-party, SDK-versioned | Host layout rules; per-Host cost; two trees per control; some APIs move between SDKs | https://docs.expo.dev/versions/v57.0.0/sdk/ui/ , https://expo.dev/changelog/sdk-58-beta , https://expo.dev/blog/expo-ui-stable-sdk-56 |
| Expo UI universal | same | One tree for both platforms | "First iteration"; fewer controls and modifiers | https://docs.expo.dev/versions/latest/sdk/ui/universal/ |
| **RNR + @rn-primitives (copy-in)** | RNR main 2026-09-17; primitives 1.5.2 | shadcn/Radix names match web; Uniwind template; accessible overlays | JS-drawn, so not native chrome; primitives repo quieter (940 stars, 23 issues) | https://github.com/founded-labs/react-native-reusables |
| gluestack-ui 5 | 5.0.15, 2026-06-25 | Tailwind 4 support | Churn; overlaps RNR | https://github.com/gluestack/gluestack-ui |
| Hand-built in-house | n/a | Exactly our domain surfaces | Cost | repo `src/components/ui` |
| TrueSheet | 3.11.15, 2026-09-24 | System sheet controller (glass on iOS 26+), RN content with Yoga, detents, footers | Third-party; v4 in beta | https://sheet.lodev09.com/ |
| @gorhom/bottom-sheet | 5.2.14, 2026-05-09 | Familiar | JS-drawn, not glass; open touch-blocking bugs; Expo recommends replacing | https://github.com/gorhom/react-native-bottom-sheet/issues/2764 |

### Recommendation (confidence: high for the split, medium for Android top app bar and connected button group)

Native (Expo UI or router) vs JS-drawn, per control:

| Control | iOS (27) | Android (17) | Why |
|---|---|---|---|
| Tab bar | `NativeTabs` (Liquid Glass UITabBar, search tab role) | `NativeTabs` (M3 NavigationBar), `md` icons via `expo-symbols` | Stable in SDK 58 |
| Header, large title, circle glass buttons | native-stack header + `Stack.Toolbar` (glass buttons are automatic on iOS 26+ SDK) | native-stack small header; **M3 medium/large flexible top app bar is JS-drawn** (Uniwind + Reanimated scroll collapse), because neither Expo UI nor react-native-screens exposes it | Native wherever the platform component is reachable |
| Menu on tap | Expo UI `Menu` (UIMenu) | Expo UI `DropdownMenu` (M3, `cornerRadius`, `shadowElevation` in 58) | Native look, system font |
| Context menu with preview | Expo UI `ContextMenu` + `ContextMenu.Preview` (RN preview via `RNHostView`) | Long-press (`combinedClickable`) anchored `DropdownMenu`; M3 has no preview menu | Platform idiom differs |
| Switch (51×31 / 52×32) | Expo UI `Toggle` | Expo UI `Switch` | Exact native geometry and haptics |
| Segmented / button group | Expo UI `Picker` with `pickerStyle('segmented')` | `SingleChoiceSegmentedButtonRow` now; a connected `ButtonGroup` needs a small local Compose view via Expo UI "extending" (M3 1.5 alpha API) | ButtonGroup is not in Expo UI |
| Slider | Expo UI `Slider` | Expo UI `Slider` | |
| Date / time | Expo UI `DatePicker` | Expo UI `DateTimePicker` (+ `DateRangePicker` in 58) | |
| Single-choice picker | `Picker` (menu style) | `ExposedDropdownMenuBox` | |
| Route sheets | expo-router `formSheet` | `formSheet` (M3 bottom sheet) | Real UISheetPresentationController |
| Imperative sheets with RN forms, scroll, keyboard | TrueSheet 3.x | TrueSheet 3.x | Most mature for RN content; Expo UI sheet touch fixes only arrive in SDK 58 |
| Imperative sheets with native content (option lists) | Expo UI `BottomSheet` + `presentationDetents` (58+) | Expo UI `BottomSheet` | First-party |
| Swipe actions on list rows | JS (RNGH + Reanimated) | JS | Expo UI `SwipeActions` requires a SwiftUI `List` |
| FAB / floating toolbar | none (use toolbar button) | Expo UI `ExtendedFloatingActionButton` / `HorizontalFloatingToolbar` | M3 Expressive native |
| Search | native-stack header search / NativeTabs search role | Expo UI `SearchBar`/`DockedSearchBar` or header search | |
| Loading | `ActivityIndicator` / SwiftUI `ProgressView` | Expo UI `LoadingIndicator` (Expressive) + `Progress` | |
| Alerts, confirmation | RN `Alert` / Expo UI `ConfirmationDialog` | RN `Alert` / Expo UI `AlertDialog` | |
| Buttons, chips, badges, inputs, list rows, cards, skeletons, toasts, composer, run timeline, diff, markdown, terminal | JS (RNR-derived + in-house, Uniwind) | JS | Domain surfaces; must match web vocabulary |

Wrap every native control in an in-house component with one prop contract and `.ios.tsx`/`.android.tsx`/`.tsx` (web/test
fallback) files so SDK churn stays local. Remove `@gorhom/bottom-sheet` and `@gorhom/portal`. Do not add zeego (last
release 3.0.6, 2025-03-21).

Risks: Host sizing surprises (matchContents vs flexible controls, iOS top-align change in 58); Compose M3 Expressive APIs
are alpha upstream (1.5.0-alpha29, 2026-09-23), so their Expo UI wrappers can change; no in-app predictive back preview
until react-native-screens 5; per-Host cost in dense screens.

---

## 3. Platform design languages

### Findings: iOS 26/27 Liquid Glass

- iOS 27 (WWDC 2026-06-08; stable in September): glass diffuses busy content more, darker edges and brighter specular
  highlights, a uniform toolbar appears when content scrolls under floating bars, and Settings gains a transparency slider.
  Glass adapts automatically to Reduce Transparency and Increase Contrast. Source: MacRumors 2026-06-10
  (https://www.macrumors.com/2026/06/10/how-liquid-glass-is-changing-in-ios-27/).
- `UIDesignRequiresCompatibility` is ignored for iOS 27 SDK builds; the App Store requires the iOS 27 SDK from about
  April 2027 (secondary sources: https://dev.classmethod.jp/en/articles/ios27-xcode27-migration-preparation-guide/ ).
  Standard bars, tab bars, toolbars, segmented controls, sheets, menus and switches adopt glass automatically.
- Scene life cycle is mandatory on iOS 27; Expo SDK 58 prebuild generates `SceneDelegate.swift` (the repo already has
  `plugins/withSceneLifecycle.js`). iPhone apps become resizable, so layouts must not assume fixed widths.
- **`expo-glass-effect`** 57.0.4 / 58.0.2: `GlassView` props `glassEffectStyle` (`'regular' | 'clear' | 'none'` or
  `{ style, animate, animationDuration }`), `tintColor`, `isInteractive`, `colorScheme` (`auto|light|dark`);
  `GlassContainer` (spacing) merges views into one glass shape (union/morph); `isLiquidGlassAvailable()` (compiler, OS
  and Info.plist) and `isGlassEffectAPIAvailable()` (runtime; some iOS 26 betas crashed). Known issue: `opacity: 0` on the
  view or any parent kills the effect; animate `glassEffectStyle` instead. Falls back to a plain `View` elsewhere.
  Expo UI SwiftUI also exposes the `glassEffect` modifier and `GlassEffectContainer`.
- Cost: each glass layer is a GPU compositing pass; `GlassEffectContainer`/`UIGlassContainerEffect` shares the sampling
  region (https://developer.apple.com/documentation/uikit/uiglasscontainereffect ). Keep glass to floating chrome, never
  list cells.

### Findings: Android 16/17 Material 3 Expressive

- Android 17 stable from 2026-06-16 (Pixel 6+), shipping M3 Expressive broadly (springier motion, new shapes, blur).
- Compose: `material3` **1.4.0 is the latest stable and removed every `@ExperimentalMaterial3ExpressiveApi`**
  ("switch to 1.5.0-alpha"); 1.5.0 is at alpha29 (2026-09-23, Google Maven metadata). Expressive (ButtonGroup,
  LoadingIndicator, FloatingToolbar, shape morphing, `MotionScheme.expressive()`) therefore lives on alpha APIs.
  Expo UI already builds on 1.5.0-alpha17 and exposes LoadingIndicator, HorizontalFloatingToolbar, ToggleButton, Shape.
- Dynamic colour in RN: **Expo UI `useMaterialColors()` / a non-React getter** returns the M3 role palette: wallpaper-
  derived on Android 12+, baseline below 12, or seeded from `seedColor` on any API level. `Host seedColor` themes every
  Compose control under it. `expo-router`'s `Color.android.dynamic.*` wraps `PlatformColor` for the same roles (opaque to
  JS). `@pchmn/expo-material3-theme` 1.4.0 (2026-02-02) and `react-native-material-you-colors` 0.1.2 (2023) are now
  unnecessary. `@material/material-color-utilities` 0.4.0 (2026-01-21) provides HCT tone maths in JS if needed.
- Predictive back: enabled by default when targeting API 36 (Play requirement since 2026-08-31); RN `BackHandler` keeps
  working; in-app preview animations are not available in react-native-screens 4.x (§2).

### Options: "System (Material You)" accent

| Option | Pros | Cons | Evidence |
|---|---|---|---|
| **Read palette as hex (Expo UI) → derive accent in TS with contrast guarantees → `updateCSSVariables`** | Reuses `resolveDesignTokens` / `ensureContrast`; same guarantees as precomputed accents; works with Uniwind vars and Skia/terminal literals | Must re-read on wallpaper/theme change; one extra frame on change | https://docs.expo.dev/versions/v57.0.0/sdk/ui/jetpack-compose/colors/ |
| `PlatformColor` via `expo-router` `Color.android.dynamic.*` | Zero JS, auto-updates | Opaque to JS: no contrast clamping against our 18 themes' surfaces, cannot feed CSS vars or Skia | https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-native-ui/SKILL.md |
| `@pchmn/expo-material3-theme` | Proven | Third-party, last release Feb 2026, redundant with Expo UI | npm |

### Recommendation (confidence: high for iOS glass policy, medium for the Material You pipeline)

- **iOS:** get glass from native chrome (NativeTabs, native-stack + `Stack.Toolbar`, `formSheet`/TrueSheet, Expo UI
  menus/switches/segmented pickers). Use `GlassView`/`GlassContainer` only for our own floating chrome (composer bar,
  floating header circle buttons not owned by the navigator), `isInteractive` for buttons, tint from the accent token.
  Never fake glass with blur on iOS 26+; below iOS 26 (or `!isLiquidGlassAvailable()`) render the opaque `raised`/`overlay`
  token surface. Test with the iOS 27 transparency slider at both ends, Reduce Transparency and Increase Contrast
  (SDK 58's `expo-device-hub` has toggles for these).
- **Android:** M3 controls from Expo UI; JS-drawn M3 surfaces use our tokens mapped to M3 roles (surface containers,
  on-surface, outline). Wrap Compose Hosts in `seedColor={accent}` for non-system accents so native controls match.
- **System (Material You) accent pipeline:**
  1. Android 12+ only (hide the option elsewhere; iOS has no system accent API for apps).
  2. At boot and on `AppState` `active` / configuration change, read the palette with Expo UI's getter
     (`primary`, `onPrimary`, `primaryContainer`, the dark/light pair).
  3. Pass the seed through a new pure `resolveAccentFromSeed(theme, appearance, hex)` in `packages/design-tokens` that
     runs the same `ensureContrast` rules `resolveDesignTokens` applies to named accents (accent vs `on-accent` >= 4.5,
     focus ring vs every surface, row-composite margin). The theme's surfaces stay ours; only `accent`, `on-accent`,
     `focus` (`DESIGN_ACCENT_KEYS`) change.
  4. Apply with `Uniwind.updateCSSVariables(activeTheme, vars)`; set `Host seedColor` to the system colour (or leave the
     Host on dynamic colour) so Compose controls agree.
  5. Cache the last derived vars in MMKV and apply them in the prepaint path so there is no flash.
  6. Unit-test the derivation over a corpus of seed colours × 36 theme variants for the contrast floor.

Risks: Expo UI's colour API names may shift between SDKs; wallpaper changes restart the activity on some OEMs; M3
Expressive in Compose is alpha upstream.

---

## 4. Typography

### Findings

- **expo-font config plugin** (57.0.4 / 58.0.2): embeds fonts at build time. Android uses the object form
  (`fontFamily` + `fontDefinitions[{ path, weight, style }]`) so one family resolves weights via `fontWeight`; iOS takes
  the family name from the file. **SDK 58 adds variable fonts** (one file backs several `fontDefinitions`, axes such as
  `slnt`), and RN 0.88 adds `fontVariationSettings`. On SDK 57, ship static weights.
  `@expo-google-fonts/instrument-sans` 0.4.2 ships static 400/500/600/700 (+ italics); `jetbrains-mono` 0.4.1.
- **Instrument Sans has `tnum` and `pnum`** OpenType features (read from `InstrumentSans_400Regular.ttf` GSUB table
  on 2026-09-26: `aalt case ccmp liga locl ordn pnum ss01–ss12 tnum`), so `fontVariant: ['tabular-nums']` works on both
  platforms. JetBrains Mono is monospaced, so tabular by construction.
- **Dynamic Type:** RN `Text` has the iOS-only `dynamicTypeRamp` prop (`caption2 … largeTitle`, default `body`; Paper and
  Fabric, facebook/react-native@11c8bf3). With it, a custom font scales by that text style's `UIFontMetrics` curve instead
  of a flat multiplier, which is exactly "custom font mapped onto Dynamic Type styles". `allowFontScaling` defaults on;
  `maxFontSizeMultiplier` caps per node (`0` = no cap, inherits otherwise). Android has no per-style ramp: RN converts sp
  with the system font scale (a regression for scales below 1.0 was fixed in RN 0.82, PR #54238). Android 14+ applies a
  non-linear curve only through `TypedValue.applyDimension`; whether RN reproduces that curve is unverified, so treat
  Android scaling as linear and cap large steps per token.
- Expo's `expo-design-system` skill (2026-09-09 update): never disable scaling app-wide; let labels wrap before capping;
  cap only constrained chrome.
- **System font in native chrome:** native-stack titles, large titles, `NativeTabs` labels, `Stack.Toolbar`, and every
  Expo UI SwiftUI/Compose control render in SF Pro / Roboto (Google Sans on Pixels) unless a font is explicitly set.
  So "native chrome stays in the system font, RN content uses Instrument Sans" is achievable by simply not setting
  `headerTitleStyle.fontFamily` and not styling Expo UI text with our family.

### Options

| Option | Pros | Cons |
|---|---|---|
| **Instrument Sans for RN content, system font for native chrome, JetBrains Mono for code** | Brand parity with web; chrome looks native; one rule to lint | Two sans faces on one screen (by design) |
| Instrument Sans everywhere (set header fonts) | Uniform | Fights native chrome; Expo UI text cannot always take custom fonts |
| System font everywhere | Most native | Loses brand parity with web |

### Recommendation (confidence: high)

1. Embed with the `expo-font` plugin now (static weights on SDK 57; switch to the variable files on SDK 58 to cut
   binary size). This also fixes the known bug that `JetBrainsMono` is referenced but never embedded.
2. Add `ios` and `android` type ramps to `GEOMETRY` (§6): each vocabulary text step carries `{ size, lineHeight, weight,
   ramp }`, where `ramp` is the iOS text style (body 17, callout 16, subheadline 15, footnote 13, caption1 12,
   caption2 11, headline 17 semibold, title3 20, title2 22, title1 28, largeTitle 34) and Android sizes follow the M3
   scale (body L/M/S 16/14/12, label L/M/S 14/12/11, title L/M/S 22/16/14, headline, display). The in-house `<Text>`
   primitive sets `dynamicTypeRamp` from the step and `maxFontSizeMultiplier` from a per-step cap on Android (for
   example display/title 1.3, body/label 2.0) to approximate the non-linear curve.
3. Numbers: `fontVariant: ['tabular-nums']` on Instrument Sans for counters, timers, token counts and tables; JetBrains
   Mono for code, diffs, paths and IDs.
4. Leave native chrome unstyled typographically.

Risks: `dynamicTypeRamp` is rarely used in the ecosystem, so verify at AX5 on device; Android sp curve unverified; variable
font support is new in SDK 58.

---

## 5. Icons

### Findings

- **`expo-symbols`** 57.0.3 / 58.0.2: iOS/tvOS SF Symbols; **Android and web render Material Symbols since SDK 55**
  (`name={{ ios: 'info.circle', android: 'info', web: 'info' }}`; string names are SF-only and render nothing on
  Android without `fallback`). Android weights come from `expo-symbols/androidWeights/*`. Android/web rendering loads the
  Material Symbols font (`@expo-google-fonts/material-symbols` 0.4.1, 6.8 MB unpacked, one font per weight) through
  `expo-font` and draws a glyph. Open: filled states (`favorite`) do not render on Android/web (expo#46850, 2026-06-12).
  Fixed: `style` ignored on Android/web (#48552, closed 2026-08-05). iOS animations via `animationSpec`: effects
  `bounce | pulse | scale` plus variable-colour layer animation, `repeating`, `repeatCount`, `speed`. The newer SF
  Symbols effects (wiggle, rotate, breathe, draw on/off, replace) are not in the type.
- **`@expo/material-symbols`** 0.1.1: Material Symbols as per-icon Android XML vector drawables (`import Star from
  '@expo/material-symbols/star.xml'`), rendered by Expo UI Compose `Icon` inside a `Host matchContents`. Only outlined
  ships; its CLI (`npx add-material-symbols --fill favorite`, `--style rounded`, `--weight 300`) writes other variants
  into the project. This is the route for icons inside Compose trees (menus, FAB, toolbar) and for filled states.
- `NativeTabs.Trigger.Icon sf="…" md="…"` takes Material names on Android (SDK 55+; `expo-symbols` optional peer in 58).
- Expo's `expo-native-ui` skill: SF Symbols on iOS, Material on Android, "one icon family per platform - never a mixed
  set".
- **`lucide-react-native`** 1.48.0 (2026-09-24; 1.0.0 on 2026-03-23), 3,710 icon files, peer `react-native-svg`
  12–15. 1.x publishes an `exports` map (`.`, `./icons`, `./icons/*`) and `.mjs` files. **The repo's
  `apps/mobile/plugins/babel-plugin-lucide-icons.js` reads `dist/esm/lucide-react-native.js` and matches `.js` paths;
  in 1.x the barrel is `dist/esm/lucide-react-native.mjs`, so the plugin finds nothing and silently falls back to the
  full barrel** (the 1.29 MB regression it was written to prevent). With `unstable_enablePackageExports = true`, deep
  `dist/...` paths are also outside the exports map. Use `lucide-react-native/icons/<kebab-name>` (supported subpath)
  and delete the plugin, or rewrite it to target that subpath.

### Options

| Option | Pros | Cons | Evidence |
|---|---|---|---|
| **`expo-symbols` with `{ios, android}` names for RN-drawn content** | One component; native SF rendering and animations on iOS; tint/size via props | Android is font-based, outlined only (#46850), loads a font per weight | https://docs.expo.dev/versions/v57.0.0/sdk/symbols/ , https://github.com/expo/expo/issues/46850 |
| `@expo/material-symbols` + Expo UI `Icon` | Per-icon bundling; filled/rounded via CLI; native Compose | Needs a Host per icon; not for dense RN rows | https://www.npmjs.com/package/@expo/material-symbols |
| Generated SVG components (Material Symbols Rounded, filled + outlined) via the token pipeline | Full control, filled states, works in RN rows | We maintain the generator | n/a |
| lucide on mobile for everything | Same glyphs as web | Not native on either platform; Expo guidance says one native family per platform | https://github.com/expo/skills |

### Recommendation (confidence: medium-high)

- Extend `packages/design-tokens/src/icons.ts` so every concept has `{ lucide, sf, material: { name, filledName? } }`
  and optional `sfEffect` (for status animations). A registry test fails if a concept used by mobile lacks `sf` or
  `material`.
- Mobile `<Icon concept>`: iOS renders `SymbolView` (SF); Android renders `SymbolView` with the Material name, switching
  to a generated SVG (or an `@expo/material-symbols` XML via `--fill`) for concepts whose selected state needs a filled
  glyph until #46850 is fixed. Inside Compose trees use Expo UI `Icon` with XML drawables. Tabs use
  `NativeTabs.Trigger.Icon sf md`.
- Keep lucide on mobile only for domain glyphs with no native counterpart (git branch/commit/PR, diff, terminal variants,
  provider marks), through the `./icons/*` subpath. Upgrade to 1.48 in one codemod pass (1.0 renamed icons; the registry
  already names canonical 1.x glyphs).
- Animated status (running, waiting) on iOS: `animationSpec` `pulse`/variable colour; on Android, a Reanimated opacity
  pulse on the glyph (M3 LoadingIndicator for indeterminate work).

Risks: font-based Android symbols scale with font scale unless capped; missing filled states; SF effect coverage limited.

---

## 6. Token pipeline

### Findings

- DTCG Format 2025.10 is the first stable Design Tokens spec (2025-10-28). **Style Dictionary 5.5.5** (2026-09-20) and
  **Terrazzo 2.7.1** (2026-08-11) are the reference tools; both centre on JSON token files and Figma-style workflows.
- Our registry is TypeScript with computed tokens: `resolveDesignTokens(theme, appearance, accent)` derives 30+ colours
  per variant with contrast clamping (`ensureContrast`, `ensureContrastAll`, `oklabMix`). DTCG tools would add a JSON
  intermediate without replacing that logic.
- Uniwind supports build-time platform branches inside theme CSS (`@layer theme { :root { … @variant ios { … } } }`) and
  runtime per-theme variable updates, which covers per-platform geometry and runtime accents.
- Haptics vocabulary available: `expo-haptics` 57.0.3 has `selectionAsync`, `impactAsync(Light|Medium|Heavy|Soft|Rigid)`,
  `notificationAsync(Success|Warning|Error)` and Android `performAndroidHapticsAsync(AndroidHaptics.*)` (`Confirm`,
  `Reject`, `Toggle_On/Off`, `Segment_Tick`, `Long_Press`, `Context_Click`, `Gesture_Start/End`, `Drag_Start`,
  `Keyboard_Tap`, …). The Expo docs point to Software Mansion's Pulsar for custom patterns.
- Motion: Reanimated 4 springs take `duration` + `dampingRatio` or `stiffness` + `damping`; M3 Expressive spring tokens
  use damping ratio 0.9 / 1.0 and stiffness 1400–3800 (fast spatial ~1400 / 0.9;
  https://m3.material.io/styles/motion/overview/how-it-works ). Expo's `expo-animation` skill recommends Reanimated CSS
  transitions for state changes and native navigator transitions for screens.

### Options

| Option | Pros | Cons |
|---|---|---|
| **Keep the custom TS emitter, add emitters** | Keeps computed contrast guarantees; one source; already emits CSS vocabulary and native literals | We own it (already true) |
| Style Dictionary 5 | Ecosystem transforms, DTCG | JSON intermediate; computed tokens must be precomputed anyway; extra dependency |
| Terrazzo 2 | Modern DTCG, plugins | Same as above |

### Recommendation (confidence: high)

Keep the custom emitter. Add:

1. `emit/uniwind.ts` → `apps/mobile/src/theme/uniwind-themes.css`: 36 `@variant <theme>-<appearance>` blocks of
   `--gai-*` colours, plus `@variant ios` / `@variant android` geometry blocks; export `UNIWIND_THEMES` for
   `metro.config.js` `extraThemes`. Accents: a generated `accentVars(theme, appearance, accent)` map applied with
   `updateCSSVariables` (keeps the variant count at 36), plus `resolveAccentFromSeed` for Material You (§3).
2. Fill `GEOMETRY.ios` / `GEOMETRY.android`: type ramps with `ramp` (§4), radii (inset glass sheets and concentric corners
   on iOS; M3 shape scale on Android), heights, `minHitTarget` 44 / 48, switch sizes 51×31 / 52×32, shell widths.
   The same vocabulary (`text-ui`, `rounded-card`, `h-row`) then resolves per platform in CSS.
3. `MOTION` → `{ css: {duration, cubic-bezier}, reanimated: {duration, dampingRatio}, m3: {stiffness, dampingRatio} }`
   per named motion (press, toggle, sheet, reveal), with a reduced-motion variant.
4. `HAPTICS` concept map → `{ ios: selection|impact(style)|notification(type), android: AndroidHaptics.*, web: none }`
   in `packages/shared` or the token registry, used by one `haptic(concept)` helper.
5. Optionally a DTCG 2025.10 JSON export for interoperability later; not needed without a design tool in the loop.
6. `tailwind-merge` on mobile with the same generated config as web.

Risks: the emitter grows; Uniwind CSS-variable naming rules (`--` prefix, declared before update) must be enforced by tests.

---

## 7. Case studies (2025–2026)

| Company / app | Stack and approach | What it tells us | Evidence (date) |
|---|---|---|---|
| **Shopify** (Shop, Shopify, POS, Inbox) | Moving from RN to Swift/Kotlin. Shop rebuilt in 12 weeks by 6 engineers with agents; Android start-up halved, app 109 MB smaller, crashes 10x fewer. Shared **specs**, not code: behaviour docs, analytics parity, a design system (Gravity) implemented per platform; "Android and iOS must be at feature parity at all times". Restyle archived after 2026 | Strongest 2026 signal that "same screens, native controls per platform" is now cheap with agents; also that shared specs matter more than shared views | https://shopify.engineering/back-to-native (2026-09-10), https://shopify.engineering/shop-app-migration (2026-09-10) |
| **Bluesky** | Expo 57.0.24, RN 0.86.3, `@expo/ui` 57.0.20, `expo-glass-effect`, in-house `@bsky.app/alf` 0.1.15 (atoms + tokens), `radix-ui` for web, react-navigation 7 | Serious RN apps already mix Expo UI and glass into a token-atom design system | https://github.com/bluesky-social/social-app/blob/main/package.json (fetched 2026-09-26) |
| **Discord** | RN on iOS and Android; shares reducers/actions/services; performance work with RNGH/Reanimated | Share logic, tune natives | https://discord.com/blog/how-discord-achieves-native-ios-performance-with-react-native |
| **Coinbase** | CDS open-sourced Oct 2025: React + React Native component library, source "as identical as possible" across platforms, plus native iOS/Android toolchains; ships an agent skill (`cds-code`) | Shared prop contracts and tokens across web and RN, with an agent skill as the enforcement layer | https://github.com/coinbase/cds , https://cds.coinbase.com/getting-started/ai-overview |
| **Expensify** | One RN + react-native-web codebase; tracking SDK 58 / RN 0.88 and RNGH 3 upgrades | Universal code works for form-heavy apps; not our desktop density | https://github.com/Expensify/App/issues/101427 |
| **Microsoft** | Fluent UI React Native still 0.x "alpha" (0.44.6, active Sept 2026) | Even large vendors keep RN component kits per platform | https://github.com/microsoft/fluentui-react-native |
| **Amazon** | Vega OS (Fire TV, launched 2025-09-30) is RN-based (New Architecture, Hermes) | RN as a platform bet continues outside phones | https://developer.amazon.com/apps-and-games/blogs/2025/09/announcing-vega-os |
| **Linear** | Native Swift/Kotlin mobile apps separate from web/Electron | Native per platform, shared product spec | https://linear.app/mobile |
| **OpenAI** | Sora for Android built natively in Kotlin/Compose, mostly by Codex under AGENT.md conventions. ChatGPT mobile stack not officially documented (widely reported native) | Written conventions let agents build native twice | https://openai.com/index/shipping-sora-for-android-with-codex/ |
| **Cursor** | "Native iOS app" in public beta (2026-06-29); stack not published (one third-party article calls it a PWA, contradicted by the App Store listing) | Unverified | https://cursor.com/blog/ios-mobile-app |
| **Claude, Raycast iOS, Meta** | Claude mobile's stack is not publicly documented. Raycast documents its desktop v2 (TypeScript/React UI over native hosts), not iOS. Meta keeps RN in its own apps and React Strict DOM (0.0.x) | No usable evidence for our choice | https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast |
| **Expo team** | `expo/skills` (`expo-ui`, `expo-native-ui`, `expo-design-system`, `expo-animation`): default to Expo UI for native controls, NativeTabs, `formSheet`, SF Symbols + Material, platform semantic colours, design-system rules against "native slop" | The most concrete published guidance for "same screens, native controls per platform" in RN | https://github.com/expo/skills (commits through 2026-09-24) |

**Recommendation (confidence: medium).** Stay on Expo/RN for this project: one developer, a large existing RN codebase,
shared TS packages (client-core/runtime/transport), and a web vocabulary to share. Adopt the Shopify lesson anyway: write
per-screen behaviour specs and a design contract (tokens, component catalogue with prop types, status map, icon concepts,
haptics, motion) that both platforms implement, and make native controls the default wherever Expo UI or the router
exposes them. Revisit "native per platform" only if Expo UI coverage stalls or RN performance becomes the bottleneck.

---

## Recommended packages

Pins are for SDK 57 today; the SDK 58 column applies after `npx expo install --fix` once SDK 58 is stable (expected in
October 2026, after RN 0.88 ships).

| Package | Pin (SDK 57) | SDK 58 | Action | Reason | Evidence |
|---|---|---|---|---|---|
| `expo` | `~57.0.25` | `~58.0.x` | Upgrade (plan redesign on 58) | Stable NativeTabs/Toolbar, Expo UI navigation and RNHostView fixes, variable fonts, iOS 27 SDK | https://expo.dev/changelog/sdk-58-beta |
| `react-native` | `0.86.3` | `0.88.x` | Upgrade patch now | 0.86.3 is the SDK 57 pin (repo has 0.86.2) | expo 57 `bundledNativeModules.json` |
| `uniwind` | first release after 1.12.0 (contains PR #686); until then `1.12.0` without platform class variants | spike first | Add (replace NativeWind) | Tailwind 4.3.3 parity with web, theme APIs | §1 |
| `tailwindcss` | `4.3.3` (devDep) | same | Replace 3.4.17 | Same version as web and as Uniwind's internal compiler | npm (2026-07-16) |
| `nativewind`, `tailwind.config.js`, `nativewind-env.d.ts` | – | – | Remove | Superseded | – |
| `tailwind-merge` | `3.7.0` | same | Add | Shared merge config with web | npm (2026-09-12) |
| `@rn-primitives/*` (as needed) + RNR copy-ins | `1.5.2` | same | Add | Accessible JS primitives, shadcn names | npm (2026-07-02) |
| `@expo/ui` | `~57.0.20` | `~58.0.7` | Add | Native menus, context menus, switches, segmented pickers, sliders, date pickers, M3 FAB/toolbar/loading | §2 |
| `expo-symbols` | `~57.0.3` | `~58.0.2` | Add | SF Symbols (iOS) + Material Symbols (Android); `md` tab icons | §5 |
| `@expo/material-symbols` | `0.1.1` | same | Add (Compose-only icons) | Per-icon XML drawables for Expo UI `Icon`; filled via CLI | §5 |
| `lucide-react-native` | `1.48.0` | same | Upgrade from 0.460; delete or rewrite the babel plugin; import from `lucide-react-native/icons/*` | Plugin silently no-ops on 1.x | §5 |
| `expo-glass-effect` | `~57.0.4` | `~58.0.2` | Keep | Custom floating glass | §3 |
| `expo-font` | `~57.0.4` (config plugin) | `~58.0.2` | Add explicitly | Build-time embedding; variable fonts in 58 | §4 |
| `@expo-google-fonts/instrument-sans`, `@expo-google-fonts/jetbrains-mono` | `0.4.2`, `0.4.1` (or vendored TTFs) | same | Add | Font sources; fixes missing JetBrains Mono | npm |
| `expo-haptics` | `~57.0.3` | `~58.0.1` | Keep | Haptics vocabulary | §6 |
| `react-native-reanimated` / `react-native-worklets` | `~4.5.1` / `0.10.x` | `4.7.0` / `0.13.0` | Keep (SDK-matched) | – | bundledNativeModules |
| `react-native-gesture-handler` | `~2.32.0` | `~3.2.1` | Keep; migrate to the RNGH 3 hook API with SDK 58 | Breaking in 3.0 (legacy components renamed `Legacy*`) | https://docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrading-to-3/ |
| `@gorhom/bottom-sheet`, `@gorhom/portal` | – | – | Remove | JS-drawn; open touch-blocking bugs | §2 |
| `@lodev09/react-native-true-sheet` | `3.11.15` | re-check v4 | Add | Native sheets with RN content | npm (2026-09-24) |
| `@legendapp/list` | `3.4.0` | same | Upgrade | Chat list primitives | npm (2026-09-21) |
| `react-native-screens` | `~4.26.2` | `~4.28.0` | Keep (SDK-matched) | Predictive-back previews wait for v5 | §2 |
| `react-native-web` | `0.21.3` | same | Keep (dev preview only) | Released 2026-09-25 | npm |
| `react-native-nitro-modules` | `0.36.x` | – | Keep | Only Uniwind Pro would need 0.37.1 | §1 |
| `@material/material-color-utilities` | – | – | Do not add unless tone maths beyond Expo UI roles is needed | Expo UI palette covers it | §3 |
| `@pchmn/expo-material3-theme`, `react-native-material-you-colors` | – | – | Do not add | Redundant with Expo UI colours | §3 |
| `zeego` | – | – | Do not add | Stale since 2025-03-21 | npm |
| `style-dictionary`, `@terrazzo/cli` | – | – | Do not add | Custom emitter keeps computed contrast tokens | §6 |
| Uniwind Pro, NativeWind 5, Unistyles, Tamagui | – | – | Reject for now (NativeWind 5 is the fallback) | See §1 | §1 |

## Top risks

1. Uniwind release timing (#668 fix unreleased) and undeclared SDK 58 / RN 0.88 support. Mitigation: gates A and B (§1).
2. SDK 58 upgrade bundles several breaking changes at once (RN 0.87 Strict TypeScript API, RNGH 3, router core rewrite,
   Expo UI Host alignment). Mitigation: upgrade SDK first, before restyling screens.
3. Expo UI Host layout and per-Host cost. Mitigation: leaf controls only, in-house wrappers, a Storybook/device story per
   wrapper.
4. Android gaps: no M3 flexible top app bar, ButtonGroup or in-app predictive-back preview. Mitigation: JS top app bar,
   segmented button row now, a small Compose view later.
5. Android filled Material Symbols (#46850). Mitigation: SVG/XML fallbacks for filled concepts.
