# GeneratorAI mobile stack and cross-platform UI strategy (research, 2026-09-24)

Scope: styling layer, component layer, web/mobile UI sharing, token pipeline and fonts, ahead of a full design overhaul for web/desktop and mobile (phone and tablet, iOS 26 Liquid Glass / Material 3 Expressive). Versions and dates come from the npm registry (queried 2026-09-24) and the sources listed at the end.

## 0. Current state of the repo

- `apps/mobile`: Expo `~57.0.0`, RN `0.86.2`, React `19.2.3`, NativeWind `^4.2.1` on `tailwindcss ^3.4.17`, reanimated `~4.5.1`, worklets `0.10.3`, `react-native-web ^0.21.2`, `lucide-react-native ^0.460.0`, `@legendapp/list ^3.3.11`, `@gorhom/bottom-sheet ^5.2.6`, `expo-glass-effect`, `react-native-nitro-modules ^0.36.0`.
- Theming: `src/theme/ThemeProvider.tsx` injects NativeWind `vars()` from a generated `src/theme/tokens.generated.ts` (14,526 lines, covering every theme × appearance × accent). Tailwind v3 `tailwind.config.js` maps colours to `var(--x)` and adds mobile-only radii and `control*` aliases.
- Web (`apps/web`): Tailwind `^4.2.0`. `packages/design-tokens/src/emit/css.ts` writes the raw variables and an `@theme inline { --color-surface: var(--surface) … }` block into `globals.css`. Themes switch through specificity on `.light` / `[data-theme]` / `[data-accent]`.
- The UI kit is hand-built (`src/components/ui`). `Sheet.tsx` is custom gesture-handler/reanimated code and is the only file that imports `@gorhom/*`. `ContextMenu.tsx` is a JS long-press menu backed by the custom `ActionSheet`. `GlassSurface.ios.tsx` uses `expo-glass-effect`.
- Bugs found while reading:
  - Nothing embeds the `JetBrainsMono` font. `NATIVE_FONT_FAMILY.mono = 'JetBrainsMono'` and `font-mono` point at it, but I found no `.ttf`/`.otf` asset, no `expo-font` plugin and no `useFonts` call, so mono text falls back to the system font.
  - `lucide-react-native` is pinned to 0.460. The current release is 1.48.0; 1.0 renamed icons.

---

## 1. Mobile styling layer

| Option | Status (Sep 2026) | Tailwind | Runtime themes | Notes |
|---|---|---|---|---|
| **NativeWind v4** | `4.2.7` latest (2026-09-14), maintenance only | v3 only | `vars()` subtree injection (what we use now) | 1.28M weekly downloads. Will not follow Tailwind v4. |
| **NativeWind v5** | `5.0.0-rc.0` (2026-09-13); promotion to `latest` planned after a ~2-week bake, aiming for end of September | v4, **pinned to 4.1.12** plus lightningcss 1.30.1 | `VariableContextProvider` is required for runtime variables; no dedicated scoped-theme API | Tested against Expo 57 / RN 0.86.3 / Reanimated 4.5.1. One open issue: Android animation cancellation (upstream Reanimated). Removes `cssInterop`/`remapProps` in favour of `styled`. A C++/Nitro engine (`react-native-css@4`, zero React renders per style change) is still in preview. Expo's official `expo-tailwind-setup` agent skill targets v5. |
| **Uniwind** | `1.12.0` stable (2026-09-04), ~529k weekly downloads, MIT, 1.7k stars, 11 open issues | v4 only (CSS-first `@theme`) | Unlimited `@variant` themes, `Uniwind.setTheme()`, `Uniwind.updateCSSVariables(theme, vars)` (re-renders only when the active theme changes), `<ScopedTheme>` for subtrees, `useCSSVariable` | Metro plugin, no Babel preset. `withUniwind()` replaces `cssInterop`. `fontScale()` CSS function. Platform selectors (`ios:`/`android:`/`web:`). Free tier has no className→Reanimated animation; Pro ($) adds C++ shadow-tree updates, animated classNames and native theme transitions. Pro supports RN 0.81–0.87 / Expo 54–57 and needs nitro-modules ≥0.37.1. Uniwind ships an official `migrate-nativewind-to-uniwind` agent skill. |
| **Unistyles 3** | `3.3.0` (2026-07-10), ~165k weekly downloads | none (StyleSheet API) | C++ theme registry, adaptive themes, `ScopedTheme`, zero re-render theme switches | New Architecture only. Very fast, but it is a different vocabulary from web's Tailwind, which removes the "one class language" benefit. |
| **Tamagui** | `2.7.7` (2026-08-15). v2.0.0 shipped 2026-05-23 and **`3.0.0-beta` is already on npm** | none (own style props and compiler) | Strong nested themes | ~160k weekly downloads. Heavy config and compiler. API churn (v1 → v2 → v3 inside 12 months). Poor fit with the Tailwind/Radix web app. |
| **StyleSheet + tokens** | n/a | none | Hand-rolled context | Zero dependencies, but every component re-renders on theme change and there is no shared vocabulary with web. Bluesky does this with its in-house `@bsky.app/alf`. |

**Performance.** The only published cross-library numbers come from Uniwind's own site: 2,000 views render in 81 ms with Uniwind (55 ms Pro), 197 ms with NativeWind v4 and 258 ms with NativeWind v5. These are vendor benchmarks, so treat them as directional. Both Tailwind-v4 engines precompile at build time, and for a chat/list app the difference only shows on screens that mount many views.

**Theming fit (18 themes × light/dark × accents).** Uniwind handles this well: register the 36 theme×appearance variants as `extraThemes`, then apply the accent on top with `updateCSSVariables` on the active theme. `ScopedTheme` covers the Appearance picker's live previews, which currently needs nested `vars()`. With NativeWind v5 you would keep a `vars()`/`VariableContextProvider` design close to today's.

**Recommendation: move to Uniwind 1.x on Tailwind v4 as part of the redesign.** Reasons:
1. It is the only stable Tailwind-v4 engine for RN today. NativeWind v5 has been an RC for 11 days and pins an old Tailwind (4.1.12, while web is on 4.2 and 4.3.3 is current).
2. Its runtime-theme APIs (`setTheme`, `updateCSSVariables`, `ScopedTheme`) map directly onto the existing mode/theme/accent model.
3. React Native Reusables and gluestack both support it.
4. There is an official migration skill for Claude Code.

Fallback: if NativeWind 5.0 reaches `latest` and the Nitro engine lands before the redesign starts, it is an equally valid Tailwind-v4 choice. The class vocabulary is nearly identical, so a later switch between the two is cheap. Do not stay on NativeWind v4: it keeps mobile on a different Tailwind major than web, which is exactly the drift the overhaul should remove. Unistyles and Tamagui are ruled out by vocabulary mismatch, not by quality.

---

## 2. Mobile component layer

**Component kits**

- **React Native Reusables** (shadcn for RN, 8.7k stars, built on `@rn-primitives/*` 1.5.2 from 2026-07-02). It is copy-paste code, not a dependency, and has supported Uniwind since Dec 2025 (a `minimal-uniwind` template, and `--styling-library uniwind` in the CLI). Its component names and props mirror shadcn/Radix, which is what web already uses, so LLMs write it fluently. **Use as the starting source for the JS-drawn primitives** (Button, Badge, Input, Textarea, Toggle, Tabs, Avatar, Progress, Skeleton, Tooltip/Popover for tablet), then restyle them to the new design.
- **gluestack-ui** v5 (Tailwind v4, NativeWind v5 / Uniwind). Also copy-paste, but only ~64k weekly downloads, and it went v3 → v4 → v5 in about a year, which is a lot of churn. Nothing it offers is missing from RNR.
- **Tamagui**: see section 1. Not recommended.
- **Expo UI (`@expo/ui`)**: **stable since SDK 56** and in the default template (57.0.20 is the SDK 57 tag; ~2.7M weekly downloads, mostly from template installs). It provides real SwiftUI and Jetpack Compose views, including `ContextMenu`, `Menu`, `Popover`, `SwipeActions`, `Picker`, `DatePicker`, `Slider`, `Switch` and `BottomSheet` on iOS, and Material 3 components plus dynamic colours (`useMaterialColors`), `DropdownMenu`, `SearchBar`, `FloatingActionButton` and Expressive `LoadingIndicator` on Android. The universal `@expo/ui` import is described as "a first iteration" and its web implementations as experimental. Layout inside a `Host` follows SwiftUI/Compose rules, not Yoga, and className styling does not apply inside it. **Use Expo UI surgically for controls whose native feel matters** (menus, pickers, switches, sliders, segmented controls, date pickers, swipe actions). Do not build whole screens from it.
- **Hand-built kit.** Keep hand-building for app-specific surfaces (composer, run timeline, diff, markdown, terminal, DAG view) inside a small in-house `ui/` folder. The current structure is right; what the redesign replaces is the primitives underneath.

**Native feel (iOS 26 / Material 3 Expressive)**

- Tabs: expo-router native tabs give Liquid Glass tab bars on iOS 26 and Material 3 on Android, but on SDK 54–57 they are only available as `expo-router/unstable-native-tabs`. The stable `expo-router/native-tabs` arrives in SDK 58, which is already on npm under `next`. Plan the redesign against SDK 58.
- Glass: `expo-glass-effect` 57.0.4 (keep). Guard with `isLiquidGlassAvailable()`, as `GlassSurface.ios.tsx` already does.
- Headers and toolbars: use expo-router `Stack.Toolbar` (SDK 57 added badges and Android menu icons) rather than custom headers.

**Bottom sheets**

- Expo's own guide (Nov 2025) recommends expo-router `formSheet` for "almost all normal use cases". For fine control (detents, footers, animation sequencing), it recommends **TrueSheet** (`@lodev09/react-native-true-sheet` 3.11.14, v4 in beta), which uses the system sheet controller and so gets Liquid Glass for free. `@expo/ui` BottomSheet was beta then and is stable since SDK 56.
- `@gorhom/bottom-sheet` 5.2.14 (last release 2026-05-09) is JS/Reanimated-drawn. It will never look like a native iOS 26 floating sheet and has a long tail of edge-case bugs.
- **Recommendation:** route-level sheets use `formSheet`. Imperative sheets such as pickers, action sheets and the run-start sheet use TrueSheet. Remove `@gorhom/bottom-sheet` and `@gorhom/portal`, and retire the custom `Sheet.tsx` gesture code. Keep a thin in-house `<Sheet>` API so screens are unaffected.

**Lists.** Keep `@legendapp/list` and upgrade to 3.4.0. It has chat-specific primitives (`initialScrollAtEnd`, `maintainScrollAtEnd`, `anchoredEndSpace`), keyboard integration, sections and a DOM-native web build, plus independent reports of lower CPU and memory use than FlashList. FlashList v2 (2.3.2) is excellent too, but switching gains nothing here.

**Menus.** zeego's last release was 3.0.6 (2025-03-21), so it is 18 months stale. Replace the JS long-press `ContextMenu` with Expo UI `ContextMenu`/`Menu` on iOS and `DropdownMenu` on Android, behind one in-house `<Menu items=…>` API with `.ios.tsx`/`.android.tsx` files. Keep the ActionSheet fallback for web and tests.

**Icons.** For a single concept registry across platforms, use **SF Symbols on iOS via `expo-symbols`** (57.0.3), **Material Symbols on Android** (the Expo UI `Icon` component with `@expo/material-symbols`; beware silent blanks if the font or plugin is not bundled, see expo#46850) and **lucide for web and custom glyphs**. Upgrade `lucide-react-native` 0.460 → 1.48 either way, since 1.0 renamed icons. Define an `IconName` concept registry in the shared design contract that maps each concept to `{ sf, material, lucide }`, so LLM agents never pick raw glyph names per screen.

---

## 3. Should web and mobile share UI components?

**(i) Universal UI (react-native-web / Tamagui / Solito / Expo web) for the web SPA: no.**
- The web app is dense desktop UI built on DOM-only engines: xterm, @xyflow/react, @pierre/diffs, Radix and an Electron `WebContentsView` browser tab. None of them are RN components. Under react-native-web every one would become a `.web.tsx` escape hatch, which leaves most of the app outside the universal layer. RNW itself has had no release since 0.21.2 (2025-10-16).
- Even the flagship RNW app does this. Bluesky's `social-app` (Expo 57, RN 0.86.3, RNW 0.21) is a feed app, much less dense than ours, and it still pulls in `radix-ui` and `@floating-ui/react-dom` for web menus and popovers alongside an in-house token-atom system (`@bsky.app/alf`). It uses no Tamagui, NativeWind or Unistyles.
- Tamagui's showcase adopters (Uniswap and similar) are consumer apps. Solito (5.0.0, ~34k weekly downloads) only shares navigation between Next.js and RN, which we don't use. React Strict DOM is still `0.0.x` with broken-release notices.
- Expo UI's universal layer calls its web output experimental.

**(ii) Share a design contract: yes, this is the core of the recommendation.**
Serious multi-platform product teams share logic and design language, not view code:
- Discord shares "reducers, actions, constants, services" between web/desktop and RN while UI stays per platform.
- Linear's mobile apps are native Swift and Kotlin, separate from its web/Electron app.
- OpenAI built Sora for Android natively in Kotlin/Compose, with Codex writing most of the code under strong written conventions (AGENT.md files, exemplar features). That is the same "LLM implements under a written contract" setup this project has.

The contract should be:
- tokens (colour, radius, spacing, type scale, motion, elevation);
- a **component catalogue**: names, variants, sizes and props (`Button{variant: primary|secondary|ghost|destructive, size}`, `Badge`, `StatusDot`, `Chip`, `ListRow`, `Sheet`, `Menu`, …) that both apps implement with identical prop types (`packages/design-contract` exporting TS types only);
- the **status map** (run/agent/tool status → colour token, icon concept, label);
- the **icon concept registry**;
- **copy** (strings, error messages, empty states).

Both apps then implement against the same types: web with Radix + Tailwind v4, mobile with RNR/Expo UI + Uniwind.

**(iii) Share platform-free React "view-model" hooks: yes, selectively.**
The repo already shares React-free logic (client-core reducer, client-runtime, client-transport, shared). Add a `packages/client-react` (or `view-models`) for hooks that use only `react` (useState, useReducer, useSyncExternalStore, TanStack Query options factories) and return plain data and callbacks. Good candidates:
- composer state machine (draft, attachments, mode, model, submit gating);
- run and timeline derivation (grouping tool calls, collapsing, status rollups);
- permission and approval flows;
- search and filter state;
- query key factories.

Rules for that package:
- no `react-dom`, no `react-native`, no styling;
- it is tested with Vitest, which runs in both apps.

This is where the shared value lies for a solo developer. Behaviour stays identical, and each platform keeps the rendering that suits it.

**Firm recommendation:** use (ii) and (iii) together; do not do (i). Keep `react-native-web` only for the Expo web preview used in development and tests, never as the production web app.

---

## 4. Token pipeline

**Target:** one TS registry (`packages/design-tokens`) generates one shared `@theme inline` block and per-platform variable layers.

1. **`theme.css` (shared).** Generated once from the registry: `@theme inline { --color-surface: var(--surface); --color-fg-2: var(--fg-2); --radius-*; --text-*; --spacing-*; --font-* }`. Both `apps/web/src/styles/globals.css` and `apps/mobile/src/theme/global.css` `@import` it, which gives both apps the same utility names.
2. **Web variable layer (existing `emit/css.ts`).** `:root`, `.light`, `[data-theme]` and `[data-accent]` blocks, unchanged.
3. **Mobile variable layer (a new `emit/uniwind.ts` replacing `emit/native.ts`'s `themeVars`).**
   - Emit `@layer theme { :root { @variant <theme>-<appearance> { --surface: …; … } } }` for all 36 variants.
   - Export `UNIWIND_THEMES` so `metro.config.js` builds `extraThemes` from it; the list cannot drift.
   - Accents: emit a small `accentVars(theme, appearance, accent)` map and apply it with `Uniwind.updateCSSVariables`. The alternative, baking accents into variants, multiplies the variant count.
   - Keep the `rawTokens` / `terminalThemes` literal export for Skia, the status bar, the xterm WebView and Live Activities. Uniwind's `useCSSVariable` covers ad-hoc reads.
4. **Mobile-only extras** (touch radii 12/16/24, the `control*` aliases): move them into the registry as named tokens (for example `radius-row`, `radius-card`, `radius-sheet`) that web may also use, rather than hard-coding them in `tailwind.config.js`. Note that Uniwind's default `rem` is 16 while NativeWind's is 14. The token scale is already in px, so emit px values and do not rely on `rem`.

**Value of a shared class vocabulary for LLM implementers: high.**
- With both apps on Tailwind v4 and the same generated `@theme`, `bg-surface text-fg-2 rounded-card border-border-subtle` means the same thing in both codebases.
- An agent porting a design from web to mobile, or implementing both from one spec, needs no translation table, and the lint/`tailwind-merge` config can be shared.
- It does not make components portable (layout primitives, text nodes and interaction states still differ). It does remove the most common LLM error, inventing or mis-mapping colour and spacing names per platform.
- Add a CI check that fails if a class used in `apps/mobile` is not in the generated theme. Uniwind emits classes at build time, so unknown classes silently do nothing, which is the same failure mode as the undeclared `leading-code` bug noted in `tailwind.config.js`.

---

## 5. Fonts and dynamic type

- **Embed fonts at build time with the `expo-font` config plugin**, not `useFonts`, so there is no loading flash and no splash dependency. Source files: `@expo-google-fonts/instrument-sans` (0.4.2) and `@expo-google-fonts/jetbrains-mono` (0.4.1), or the upstream TTFs.
  - Android: use the plugin's object form (`fontFamily` + `weight` + `style`) so one family name resolves weights through `fontWeight`.
  - iOS: the family name is read from the file.
  - Variable-font and multi-face `fontWeight` selection is documented for SDK 58+. On SDK 57, ship static weights (Instrument Sans 400/500/600/700, JetBrains Mono 400/500/700).
- **Fix the current bug**: `JetBrainsMono` is referenced but never embedded.
- Decide on body sans: the system font (SF Pro / Roboto, which feels most native on iOS 26 and Material) or Instrument Sans for brand parity with web. A good split is Instrument Sans for display and headings, system font for dense body text and controls, and JetBrains Mono for code. Put the chosen stack in the token registry (`NATIVE_FONT_FAMILY`) and in `@theme --font-*`.
- **Dynamic Type.** RN `Text` scales with the OS font scale by default. The repo already clamps with `maxFontSizeMultiplier` via `MAX_SCALE.chrome/control`; keep that pattern, and don't disable scaling globally. With Uniwind, use `fontScale()` in `@theme`/utilities for the few non-Text sizes that must follow the user's scale (row heights, icon sizes). Test at the largest accessibility sizes on phone and tablet, and let row layouts reflow rather than truncate.

---

## Recommended mobile stack

| Area | Action | Package / version |
|---|---|---|
| Runtime | **Upgrade** before the redesign | Expo SDK 58 when stable (57 now; 58 is on `next`), matching RN and reanimated from `npx expo install --fix` |
| Styling | **Replace** NativeWind 4 → Uniwind | `uniwind@^1.12`, `tailwindcss@^4.3` (same major as web); remove `nativewind`, `tailwind.config.js`, `nativewind-env.d.ts`, the Babel preset and `vars()` |
| Styling (fallback) | Watch | `nativewind@5` once promoted to `latest` with `react-native-css@4` (Nitro) |
| Class merging | **Add** | `tailwind-merge` (same config as web) |
| Primitives | **Add** (copy-in) | React Native Reusables components (Uniwind variant) + `@rn-primitives/*` 1.5.x |
| Native controls | **Add** | `@expo/ui` (SDK-matched) for Menu/ContextMenu/DropdownMenu, Picker, Switch, Slider, DatePicker, SwipeActions |
| Tabs / headers | **Adopt** | expo-router native tabs (`unstable-native-tabs` on 57, stable on 58), `Stack.Toolbar` |
| Glass | Keep | `expo-glass-effect` (SDK-matched) |
| Sheets | **Replace** | expo-router `formSheet` + `@lodev09/react-native-true-sheet@^3.11`; **remove** `@gorhom/bottom-sheet`, `@gorhom/portal`, custom `Sheet.tsx` gestures |
| Menus | **Replace** JS ContextMenu | Expo UI menus; **do not add** zeego (stale since 2025-03) |
| Lists | Keep, upgrade | `@legendapp/list@^3.4` |
| Icons | **Add** + upgrade | `expo-symbols` (iOS), Material Symbols via Expo UI `Icon` (Android), `lucide-react-native` 0.460 → `^1.48` for custom glyphs and web |
| Fonts | **Add** | `expo-font` config plugin + Instrument Sans + JetBrains Mono static weights |
| Keyboard / gestures / animation | Keep | `react-native-keyboard-controller`, RNGH 2.32, reanimated 4.5 / worklets 0.10 |
| State / data / storage | Keep | zustand 5, TanStack Query 5, MMKV 4 |
| Web preview | Keep (dev only) | `react-native-web` 0.21 — for Expo web preview and tests, not the product web app |
| Rejected | — | Tamagui (churn, vocabulary mismatch), Unistyles (vocabulary mismatch), gluestack (churn, overlaps with RNR), Solito / React Strict DOM (not applicable or immature) |

## Cross-platform sharing recommendation

1. **Share everything below the view.** Keep sharing the React-free packages, and add a React-only view-model package (`packages/client-react`) for the composer state machine, run/timeline derivation, approvals, filters and query factories. It must never import `react-dom`, `react-native` or styling.
2. **Share the design contract, not components.** `packages/design-tokens` generates the shared `@theme` CSS plus per-platform variable layers. A new `packages/design-contract` (types only) holds the component catalogue with variant and prop types, the status map, the icon concept registry and copy.
3. **Implement natively per platform.** Web uses Radix + Tailwind v4 + the DOM engines (xterm, xyflow, diffs, Electron views). Mobile uses Uniwind + RNR primitives + Expo UI native controls + TrueSheet/formSheet + native tabs, with separate phone and tablet layouts (split view at `TWO_PANE_MIN_WIDTH`) that follow the desktop information architecture.
4. **Enforce with tooling.** Add a CI check that every Tailwind class used is a generated token utility. Add contract tests that both apps export components satisfying `design-contract` prop types. Add an AGENTS/CLAUDE.md section per app naming the vocabulary and exemplar components, which is the pattern OpenAI used to make Codex productive on Sora Android.

## Risks

- **Uniwind is a young, single-vendor project** (1.7k stars, commercial Pro tier). Mitigation: its API is plain Tailwind v4, so falling back to NativeWind 5 is mostly a Metro/Babel config change. Avoid Pro-only features (className-driven Reanimated) in shared patterns unless you buy Pro; Pro also needs nitro-modules ≥0.37.1 (repo has 0.36).
- **NativeWind 5 may go stable within days.** Re-check `npm view nativewind dist-tags` before starting. If the Nitro engine ships, re-evaluate performance against Uniwind.
- **Native tabs and some Expo UI APIs change between SDKs** (`unstable-` prefix until SDK 58; the universal `@expo/ui` is a "first iteration"). Pin to the SDK and wrap every native control behind an in-house component so churn stays local.
- **Expo UI `Host` layout is SwiftUI/Compose, not Yoga.** Mixing it with className-styled RN views needs care (sizing, `RNHostView`). Keep Expo UI to leaf controls.
- **Material Symbols can render blank on Android** if the font or plugin is missing (expo#46850). Add a visual test.
- **Duplicate implementation cost.** Two component sets (web and mobile) mean roughly twice the UI code. This is accepted deliberately, and it is offset by the shared contract, class vocabulary and view-model hooks, plus LLM-written implementations.
- **Theme count.** 36 Uniwind variants in CSS, with accents applied at runtime through `updateCSSVariables`. Verify cold-start cost and that the theme is set before the first paint (keep the existing hold-splash-until-hydrated approach).
- **Lucide 1.x renames** will break existing imports on upgrade; do it in one codemod pass.

## Sources

- NativeWind v5 overview / migration / release plan / RC release: https://www.nativewind.dev/v5 , https://www.nativewind.dev/v5/guides/migrate-from-v4 , https://github.com/nativewind/nativewind/discussions/1818 , https://github.com/nativewind/nativewind/releases/tag/5.0.0-rc.0
- react-native-css Nitro engine: https://github.com/ronin-software/react-native-css-nitro
- Uniwind: https://docs.uniwind.dev/ , https://uniwind.dev/vs-nativewind , https://docs.uniwind.dev/theming/custom-themes , https://docs.uniwind.dev/theming/update-css-variables , https://docs.uniwind.dev/api/scoped-themes , https://docs.uniwind.dev/pro-version , https://docs.uniwind.dev/pro/compatibility , https://docs.uniwind.dev/migration-from-nativewind , https://docs.uniwind.dev/api/css-functions , https://docs.uniwind.dev/vite , https://github.com/uni-stack/uniwind
- Unistyles 3: https://unistyl.es/v3/guides/theming/ , https://www.npmjs.com/package/react-native-unistyles
- Tamagui 2: https://tamagui.dev/blog/version-two , https://github.com/tamagui/tamagui/releases
- React Native Reusables + Uniwind: https://github.com/founded-labs/react-native-reusables , https://x.com/mrzachnugent/status/2000022905221251233 , https://github.com/founded-labs/react-native-reusables/issues/507
- gluestack-ui: https://github.com/gluestack/gluestack-ui/discussions/3366 , https://x.com/gluestack/status/2021194176143192446
- Expo SDK 57: https://expo.dev/changelog/sdk-57
- Expo UI: https://expo.dev/blog/expo-ui-stable-sdk-56 , https://docs.expo.dev/versions/latest/sdk/ui/ , https://docs.expo.dev/versions/latest/sdk/ui/universal/ , https://docs.expo.dev/versions/v57.0.0/sdk/ui/jetpack-compose/colors/ , https://docs.expo.dev/versions/latest/sdk/ui/jetpack-compose/loadingindicator/
- Native tabs: https://docs.expo.dev/router/advanced/native-tabs/
- Sheets: https://expo.dev/blog/how-to-create-apple-maps-style-liquid-glass-sheets , https://sheet.lodev09.com/
- Lists: https://legendapp.com/open-source/list/v3/overview/ , https://www.pkgpulse.com/guides/flashlist-vs-flatlist-vs-legendlist-react-native-lists-2026
- Menus: https://github.com/nandorojo/zeego/releases , https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/contextmenu/
- Icons: https://github.com/expo/expo/issues/46850 , https://iconsearch.info/blog/lucide-react-1-migration-guide
- Fonts: https://docs.expo.dev/develop/user-interface/fonts/ , https://docs.expo.dev/versions/latest/sdk/font/
- Expo agent skills: https://github.com/expo/skills , https://docs.expo.dev/skills/
- Case studies: Bluesky https://github.com/bluesky-social/social-app/blob/main/package.json ; Discord https://discord.com/blog/how-discord-achieves-native-ios-performance-with-react-native ; Linear https://linear.app/mobile ; OpenAI Sora Android https://openai.com/index/shipping-sora-for-android-with-codex/
- React Strict DOM: https://github.com/react/react-strict-dom/discussions/270 ; Expo web: https://docs.expo.dev/workflow/web/
- Versions and dates: npm registry `dist-tags`/`time` and api.npmjs.org weekly downloads, queried 2026-09-24.
