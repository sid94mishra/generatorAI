# Mobile redesign — native platform stack research (Expo SDK 57 / 58)

Researched 2026-09-26 for the iOS 27 / Android 17 mobile redesign (drawer IA, right workspace pane, sheets,
native chrome, system surfaces). Versions and dates come from `npm view <pkg> dist-tags time --json` run on
that date, and from reading the published tarballs of expo-router 57.0.23 / 58.0.8, react-native-screens 4.28.0,
@expo/ui 57.0.20 and expo 58.0.0-preview.7 (`bundledNativeModules.json`). Everything below is data for the plan,
not a decision. Where a claim rests on one blog or a tertiary source it is marked *(weak)*.

**Current app baseline** (`apps/mobile/package.json`): expo ~57.0.0 (latest 57.0.25), expo-router ~57.0.9,
react-native 0.86.2, react-native-screens ~4.26.2, RNGH ~2.32.0, Reanimated ~4.5.1, worklets 0.10.x,
keyboard-controller 1.21.9, @gorhom/bottom-sheet ^5.2.6, @legendapp/list ^3.3.11, expo-glass-effect,
expo-haptics, expo-local-authentication, expo-notifications, expo-secure-store, react-native-mmkv 4.3.2.
The app already has:

- a custom Reanimated/RNGH `SidePanel` (`src/components/ui/SidePanel.tsx`) used for both the left drawer and
  the right workbench, with an edge strip, `failOffsetY`, BackHandler close and reduce-motion support;
- `plugins/withSceneLifecycle.js`, which adopts the UIScene lifecycle that iOS 27 requires;
- `android.predictiveBackGestureEnabled: false` in `app.config.ts`, because back went straight to the home screen
  on an API 35 emulator;
- approval notification categories with `isAuthenticationRequired` (`src/notifications/notificationCategories.ts`);
- push through the Expo Push Service (`packages/core/src/services/push/ExpoPushProvider.ts`); the server route
  accepts `expo | apns | fcm` tokens.

---

## 0. SDK status at a glance

| Item | SDK 57 (current) | SDK 58 (beta) | Evidence |
|---|---|---|---|
| `expo` | 57.0.25, `latest` (2026-09-24). 57.0.0 shipped 2026-06-30 | `next` = 58.0.0-preview.7 (2026-09-25). Beta opened 2026-09-15 and lasts 3–4 weeks; the stable release waits for RN 0.88 final | [SDK 58 beta](https://expo.dev/changelog/sdk-58-beta), [SDK 57](https://expo.dev/changelog/sdk-57) |
| React Native / React | 0.86.2 / 19.2 | 0.88.0-rc.1 / 19.3.0 | `bundledNativeModules.json` of each SDK |
| react-native-screens | ~4.26.0 (4.28.0 is the npm latest) | ~4.28.0; the router also accepts ^5.0.0-alpha.3 | expo-router 58.0.8 peerDeps |
| RNGH | ~2.32.0 (v2 API) | **~3.2.1 (hook API, a major)** | [RNGH 3 upgrade guide](https://docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrading-to-3/) |
| Reanimated / worklets | 4.5.1 / 0.10.1 | 4.7.0 / 0.13.0 | bundledNativeModules |
| keyboard-controller | 1.21.9 | 1.22.4 | bundledNativeModules |
| @expo/ui | ~57.0.8 (production-ready since SDK 56) | ~58.0.7 (adds SwiftUI NavigationStack/SplitView/Toolbar and Compose DateRange/VerticalSlider) | [SDK 56](https://expo.dev/changelog/sdk-56), [58 beta](https://expo.dev/changelog/sdk-58-beta) |
| expo-widgets | ~57.0.7, iOS only (widgets + Live Activities) | ~58.0.7: **first Android widgets**; Live Activities gain `staleDate` | same |
| expo-app-intents | not bundled (npm `latest` 0.0.1 is a placeholder) | ~0.4.5, **alpha** | [SDK 58 beta](https://expo.dev/changelog/sdk-58-beta) |
| iOS 27 | needs the app's own `withSceneLifecycle` plugin | prebuild generates `SceneDelegate.swift` itself | [expo#46664](https://github.com/expo/expo/issues/46664) |
| expo-router | Drawer, Stack (native), `Stack.Toolbar` (alpha), `unstable-native-tabs`, `unstable-split-view`, `ExperimentalStack` | Native tabs and toolbars become **stable**; the navigation core is reworked (breaking); Drawer/Tabs/TopTabs are unified under `standard-navigation` | same |

---

## 1. expo-router in SDK 57 / 58

### 1a. Drawer

`expo-router/drawer` no longer wraps `@react-navigation/drawer`. From SDK 56 the router forked React Navigation
([Router v56 blog](https://expo.dev/blog/expo-router-v56-decoupling-from-react-navigation)). Its drawer
(`build/react-navigation/drawer`) is a vendored copy built on **react-native-drawer-layout ^4.2.2**, which is JS
drawn with RNGH + Reanimated. It offers `drawerType: front | back | slide | permanent` and `swipeEdgeWidth`, with one
drawer per navigator. SDK 58 still depends on `react-native-drawer-layout ^4.2.2`. v5 of the layout (5.0.0-alpha.19,
2026-09-19) is being prepared for RNGH 3 and React Navigation 8.

| Option | Version / date | Maturity | Pros | Cons | Evidence |
|---|---|---|---|---|---|
| `expo-router/drawer` (a navigator) | router 57.0.23 (2026-09-24) | Stable | Drawer state lives in the URL; `useDrawerStatus`/`useDrawerProgress`; `permanent` type for tablets | A drawer *navigator* forces the modules to be drawer screens, each with its own stack. You get only one side (the right pane needs a second, nested drawer). Neither the iOS "push" parallax variant nor the 318pt/28-radius spec comes without custom `drawerContent` + styles. Reworked in SDK 58 (standard-navigation) | [Expo drawer docs](https://docs.expo.dev/router/advanced/drawer/), tarball |
| `react-native-drawer-layout` as a plain component | 4.2.10 (2026-08-04); v5 alpha | Stable | The same engine without navigator coupling; `configureGestureHandler` callback; Bluesky ships it on Expo 57 | One side per instance; RNGH 3 support only in the v5 alpha | [drawer-layout docs](https://reactnavigation.org/docs/drawer-layout/), [Bluesky package.json](https://github.com/bluesky-social/social-app/blob/main/package.json) |
| **Custom `SidePanel` (Reanimated 4 + RNGH), already in the repo** | in-repo | Owned | Both sides from one component. iOS push + parallax and Android M3 modal overlay come from the same code. UI-thread drag, edge strip, reduce-motion, BackHandler close. No navigator coupling, so a module switch is `router.replace` on one native Stack | You own the a11y (focus trap, `accessibilityViewIsModal`, escape) and gesture tuning. Must be ported to the RNGH 3 hook API with SDK 58 (`Gesture.Pan()` keeps working as `Legacy*`/builder during the migration) | `src/components/ui/SidePanel.tsx` |
| `@expo/ui` SwiftUI `NavigationSplitView` / Compose `ModalNavigationDrawer` | @expo/ui 58 (split view); Compose drawer not shipped | New | Truly native | Hosts RN content inside SwiftUI/Compose, so layout is owned by the native side ([docs](https://docs.expo.dev/versions/latest/sdk/ui/)). Wrong tool for an RN-heavy chat shell | [SDK 58 beta](https://expo.dev/changelog/sdk-58-beta) |

**Recommendation (high confidence):** keep the drawer and the right pane as **overlays owned by the shell** (the
existing `SidePanel`), mounted once above a **single native `Stack`**. Do not adopt `expo-router/drawer` as the
navigator. The IA's drawer is a switcher over stack roots plus live lists, not a set of sibling routes, and the
router's drawer is JS anyway, so it adds no native feel over what the repo already has.

### 1b. Native Stack header, toolbar, large titles, search

- `Stack` = native stack (`react-native-screens`). On iOS 26+ headers adopt Liquid Glass automatically, and
  form sheets do too "with no code changes" ([SDK 55](https://expo.dev/changelog/sdk-55)).
- **`Stack.Toolbar`** (with `Button`, `Menu`, `MenuAction`, `SearchBarSlot`, `Spacer`, `View`, `Label`, `Icon`,
  `Badge`) accepts `placement="left" | "right"` for header items (UIBarButtonItems, i.e. native 44pt glass circles)
  and `"bottom"` for a UIToolbar. iOS since SDK 55, Android since SDK 56 (experimental). SDK 57 adds `Badge` on
  Android. It is marked **alpha** in the docs; SDK 58 promotes "toolbars" to stable
  ([Stack.Toolbar docs](https://docs.expo.dev/router/advanced/stack-toolbar/)). Limits: Android buttons take only
  image sources and render no labels; flexible spacers are iOS-only; bottom toolbars work only in page components;
  glass buttons can flicker in dark mode unless the root is wrapped in `ThemeProvider`; a large title collapses only
  if the scroll view is the first child or `collapsable={false}`.
- **Large titles:** `headerLargeTitle` (iOS). **Search:** `Stack.SearchBar` or `headerSearchBarOptions`, and
  `Stack.Toolbar.SearchBarSlot` for the iOS 26 bottom search.
- **Breadcrumb above the title:** there is no native slot for it. Use a custom `headerTitle` view (a small tappable
  breadcrumb stacked over the title), or `Stack.Toolbar.View` on iOS. A custom title view gives up the native
  large-title collapse, so use the breadcrumb only on *detail* screens (centered title) and keep large titles on
  top-level screens. *(Medium confidence: this follows from the API surface; no one documents the pattern.)*
- Android: react-native-screens v4 renders a plain Toolbar/AppBar, not an M3 `TopAppBar` with tonal elevation on
  scroll. M3 styling (64dp, tonal colour on scroll) needs a custom header component or `headerStyle`. Material
  headers arrive with Stack v5 (react-native-screens 5, alpha) ([SDK 56](https://expo.dev/changelog/sdk-56)).

**Recommendation:** native `Stack` with `Stack.Toolbar` left/right for the glass header buttons on iOS. On Android
keep the app's custom `StackHeader` (M3 top app bar) until Stack v5 is stable. Confidence: high for iOS, medium for
Android.

### 1c. formSheet / pageSheet / full-screen modals

- `presentation: 'formSheet'` with `sheetAllowedDetents` (fractions or `'fitToContents'`),
  `sheetInitialDetentIndex`, `sheetGrabberVisible` (iOS), `sheetCornerRadius`, `sheetLargestUndimmedDetentIndex`,
  `sheetExpandsWhenScrolledToEdge`; Android also has `unstable_sheetFooter`
  ([modals docs](https://docs.expo.dev/router/advanced/modals/)).
- iOS allows any number of detents; **Android is capped at 3**. **Android does not support native stack headers or
  nested stacks inside form sheets.** On Android, `fitToContents` sheets do not resize for the keyboard
  ([screens#3181](https://github.com/software-mansion/react-native-screens/issues/3181)).
- **Full-screen multi-step editors:** `presentation: 'fullScreenModal'` + `gestureEnabled: false`, with Cancel/Save
  in `Stack.Toolbar` left/right. Use `usePreventRemove` for the unsaved-changes guard. This is native and stable.
- `ExperimentalStack` (gamma, react-native-screens `experimental`) supports **no** sheets or modals
  ([docs](https://docs.expo.dev/versions/latest/sdk/router/experimental-stack/)).

### 1d. Native tabs

`expo-router/unstable-native-tabs` in 57; **stable `native-tabs`** in 58. The IA has no tab bar, so it is not needed.
It is worth remembering for a future iPad sidebar-adaptable tab view (iOS 18 `UITabBarController` sidebar).

### 1e. Link previews and link menus (iOS context menus)

`Link.Trigger` + `Link.Preview` (custom children or width/height) + `Link.Menu`/`Link.MenuAction` (SF Symbols,
`destructive`, nested menus). `useIsPreview()` lets a screen render a light preview. **iOS only, SDK 54+.** Only
`push` is supported, and the `href` path cannot change while the preview is open
([link preview docs](https://docs.expo.dev/router/advanced/link-preview/)). Link preview was still being fixed after
the SDK 58 state refactor ([expo#49593](https://github.com/expo/expo/pull/49593)).
**Recommendation:** use it on iOS for navigable rows (chats, runs, projects). It gives the real UIContextMenu with a
live route preview for free. On Android, render the same actions through the M3 menu (§4).

### 1f. iPad split view

`expo-router/unstable-split-view` → `SplitView`, `SplitView.Column` (≤2 before the main column) and
`SplitView.Inspector` (iOS 26+). It wraps react-native-screens' `SplitHost` (UISplitViewController) and forwards
`preferred/minimum/maximum*ColumnWidth`, `showInspector`, `preferredDisplayMode`, `preferredSplitBehavior` and more.
It is **alpha and "not ready for production"**. **iOS only.** On Android, `SplitHost.android.tsx` logs a warning and
returns null; the router falls back to a Slot. On iPhone all columns collapse into one. There can be only one
SplitView in the tree ([split view docs](https://docs.expo.dev/versions/latest/sdk/router/split-view/)).

- The IA's iPad layout (312pt sidebar + chat + 410pt pane) maps directly onto `Column` (sidebar) + main +
  `Inspector` (the pane). It is still alpha, and the Android tablet layout (300dp drawer + 400dp pane) needs a JS
  layout anyway.
- **Recommendation (medium-high confidence):** build the tablet layout in JS. Use the same `SidePanel` with a
  `persistent` presentation, with breakpoints from `useWindowDimensions()`, for both OSes. Prototype
  `SplitView` + `Inspector` on iPad behind a flag in SDK 58 and switch only when it leaves alpha.

### 1g. Predictive back (Android 16/17)

- Android 16 (API 36) enables predictive back by default for apps targeting 36. RN 0.81+ keeps `BackHandler`
  working "for most use cases" ([RN 0.81 blog](https://reactnative.dev/blog/2025/08/12/react-native-0.81)).
- **react-native-screens v4 does not support the in-app predictive-back animation.** It commits fragment
  transactions synchronously, which is incompatible with FragmentManager's back stack. The maintainer called v4
  support "highly likely … won't be ever done"
  ([screens discussion #2540](https://github.com/software-mansion/react-native-screens/discussions/2540)).
- With predictive back enabled, expo-router on Android can **exit the app instead of popping** —
  [expo#39092](https://github.com/expo/expo/issues/39092) is open, "Issue accepted", "Upstream: React Native
  Screens". This matches the repo's own API 35 finding.
- Stack v5 (react-native-screens 5.0.0-alpha.3 / `ExperimentalStack`) ships predictive back behind
  `android.predictiveBackGestureEnabled: true`. It supports only `title`, `headerShown`, `headerTransparent`,
  `headerBackVisible`: no modals, no sheets, no custom headers. It cannot be mixed with `Stack` on Android and is
  "for testing only". Known bug: the dim scrim does not render during the gesture
  ([screens PR #4670](https://github.com/software-mansion/react-native-screens/pull/4670)).
- **Recommendation (high confidence):** keep `predictiveBackGestureEnabled: false` on SDK 57 *and* on SDK 58 until
  Stack v5 reaches stable with sheets and modals. The design's "Android predictive back" becomes a
  **deferred/degraded** item. Users get the system back arrow and edge-swipe back, but no peek animation. Record it
  as a D-xx deviation. Retest on every SDK bump against a device on API 36 and API 37.

### 1h. Edge-to-edge

Mandatory on Android 16 (no opt-out) and default since SDK 55
([RN 0.81](https://reactnative.dev/blog/2025/08/12/react-native-0.81), [SDK 55](https://expo.dev/changelog/sdk-55)).
Use `react-native-safe-area-context` insets everywhere, `expo-navigation-bar` style only, and
`softwareKeyboardLayoutMode: 'resize'` (already set). Draw scrims *under* the status and navigation bars.

### 1i. Shared element and zoom transitions

- `Link.AppleZoom` / `Link.AppleZoomTarget` / `usePreventZoomTransitionDismissal` — native iOS 18+ zoom transition,
  interactive, enabled by default since SDK 55. Apple only ([SDK 55](https://expo.dev/changelog/sdk-55)).
- Reanimated shared element transitions: available on Fabric since 4.2, but **experimental behind the
  `ENABLE_SHARED_ELEMENT_TRANSITIONS` flag**, which changes layout-animation behaviour
  ([Reanimated docs](https://docs.swmansion.com/react-native-reanimated/docs/shared-element-transitions/overview/)).
- **Recommendation:** use the Apple zoom transition for card → detail on iOS (for example a run card to its run
  page), and a plain push on Android. Avoid Reanimated SET.

---

## 2. Right pane + edge-swipe drawer vs iOS back swipe and Android system back

| Option | Version | Pros | Cons | Evidence |
|---|---|---|---|---|
| **Existing `SidePanel` ×2 (left drawer + right pane) over one native Stack** | in-repo | Already solves the edge strip, vertical fail offset and UI-thread settle; one material for both | Must arbitrate gestures with the native stack itself (below) | repo |
| Two nested `react-native-drawer-layout`s | 4.2.10 | Maintained; `swipeEdgeWidth`; `configureGestureHandler` | Nesting two drawers causes gesture-priority bugs; no iOS push variant; v5 needed for RNGH 3 | [drawer-layout docs](https://reactnavigation.org/docs/drawer-layout/) |
| "react-native-reanimated-drawer" and similar small libs | — | — | No maintained package worth trusting (none found with 2026 releases) | npm search |

**Conflict rules (evidence-backed):**

1. **iOS:** the native stack's interactive pop (`UINavigationController` edge pan) and a JS pan starting in the same
   left strip race each other. Rule: **enable the left drawer's edge-swipe only when the current stack is at its
   root** (`navigation.getState().index === 0`, or `useNavigation().canGoBack() === false`). On pushed screens,
   left-edge swipe means back, and the drawer opens from the header's back/breadcrumb menu only. The right pane's
   right-edge swipe never conflicts on iOS. This matches iOS convention (Mail, Messages) and the IA's
   "iOS back = chevron + left-edge swipe".
2. **Android gesture navigation:** both screen edges belong to system back. A view can claim priority with
   `View.setSystemGestureExclusionRects()`, which the system caps at **200dp of height per edge**
   ([Android gesture-nav guide](https://developer.android.com/guide/navigation/gesturenav)). RNGH does not expose
   this ([RNGH#833](https://github.com/software-mansion/react-native-gesture-handler/issues/833)). Rule: on Android
   **do not rely on edge-swipe to open either panel**. Open them with the navigation-icon button (M3 guidance for
   modal drawers under gesture navigation). Optionally add a claimed ≤200dp band via a tiny native view (the repo's
   custom module can host `setSystemGestureExclusionRects`). Swipe-to-*close* on the open panel is safe, because it
   starts inside the panel, not at an edge.
3. **Right pane close:** a pan inside the pane toward the edge, plus a scrim tap, plus `BackHandler` (Android) or
   `accessibilityEscape` (iOS VoiceOver two-finger Z). "Full screen" is a width animation to the window width;
   keep the same gesture.
4. **Horizontal content** (code blocks, diff scrollers, terminal) must `simultaneousWithExternalGesture` /
   `blocksExternalGesture` the panel pan, or sit outside the edge strip. `SidePanel` already documents the strip
   rule. Screens that own keys and gestures (terminal, WebView) should turn edge-open off, mirroring D-46.

With RNGH 3 on SDK 58, the panel becomes `usePanGesture({...})` with the same config object; relations are
`simultaneousWith`/`requireToFail` hooks ([RNGH 3 guide](https://docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrading-to-3/)).
Expensify tracks the same forced upgrade ([Expensify#101442](https://github.com/Expensify/App/issues/101442)).

**Recommendation (high confidence):** keep `SidePanel`. Add root-only edge-open on iOS and button-first opening on
Android, and plan the RNGH 3 port as part of the SDK 58 bump.

---

## 3. Sheets

| Option | Version / date | Maturity | Liquid Glass / M3 | Detents | Keyboard | Scroll content | Nested / stacked | Predictive back | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| **expo-router `formSheet`** (route) | router 57.0.23 | Stable | iOS: automatic glass. Android: BottomSheetBehavior look, not M3-tuned | iOS: any number. Android: ≤3 + `fitToContents` | iOS ok; Android `fitToContents` does not resize ([#3181](https://github.com/software-mansion/react-native-screens/issues/3181)) | `sheetExpandsWhenScrolledToEdge` (iOS) | Sheet over sheet works on iOS; **no header or nested stack inside on Android** | System back closes it; no predictive animation | [modals](https://docs.expo.dev/router/advanced/modals/) |
| **@lodev09/react-native-true-sheet** v3 | 3.11.15 (2026-09-24) | Stable, Fabric | Native UISheetPresentationController (glass on iOS 26) / BottomSheetBehavior | Fractions, auto, peek; tap-to-cycle | Built in ("sheet and scrollables move out of the way") | `scrollable` prop | Stacking supported | Listed as supported | [site](https://sheet.lodev09.com/), [releases](https://github.com/lodev09/react-native-true-sheet/releases) |
| True Sheet v4 | 4.0.0-beta.19 (2026-09-24), 19 betas since 2026-08-09 | Beta | Same + `TrueSheetOverlay`, floating header | Auto measures scrollables | `keyboardOffset` | `scrollableRef` | Improved stacking; `onDismissAttempt` (unsaved-changes guard) | Yes | Peer `expo-router >=57`, `standard-navigation`, RN ≥0.82; ships a Sheet layout for expo-router | npm peerDeps |
| `@expo/ui` universal `BottomSheet` / `community/bottom-sheet` (a @gorhom drop-in) | @expo/ui 57.0.20 | Stable (SDK 56+) | SwiftUI `.sheet` + `presentationDetents` (glass) / Compose `ModalBottomSheet` (**true M3**) | iOS `medium/large/fraction/height`; Compose partial/expanded | Native | RN `ScrollView`/`FlatList` re-exported, "native sheets handle scroll coordination" | Via SwiftUI modifiers | Compose sheet handles back (`shouldDismissOnBackPress`) | tarball `build/community/bottom-sheet`, [@expo/ui docs](https://docs.expo.dev/versions/latest/sdk/ui/) |
| @gorhom/bottom-sheet (current) | 5.2.14 (2026-05-09) | Stable, slowing | JS drawing, **no real glass**, no M3 | JS snap points | Own keyboard logic, known flakiness | Special scrollables | Modal stack via provider | Custom BackHandler | npm |

**Recommendations:**
- **Route-level sheets** (New chat, Filters, Quick switcher, gate detail): expo-router `formSheet` on iOS. It is the
  only way to get glass, detents and the system zoom-out stacking for free. On Android use the same routes. Where a
  sheet needs a header or keyboard-heavy content, give the Android route `presentation: 'modal'` (full-height) via
  `Platform.select`. Confidence: high.
- **Component-level sheets** (action sheets from rows, pickers, composer attachments, M3 "edge sheets"):
  **replace @gorhom/bottom-sheet** with **True Sheet v3 now**, and move to v4 when it goes stable. It has the most
  complete RN-content story (keyboard, scrollables, stacking, footer). Confidence: medium-high.
- Use **`@expo/ui` `ModalBottomSheet` / `BottomSheet`** only for sheets whose content is itself Expo UI (native
  pickers/forms), where you want pixel-exact M3 on Android. Confidence: medium.
- iOS "inset glass sheet with detents" = formSheet or True Sheet on iOS 26. Both use UISheetPresentationController,
  which draws the inset floating glass at partial detents natively.

---

## 4. Menus and context menus

| Option | Version / date | Platforms | Pros | Cons | Evidence |
|---|---|---|---|---|---|
| **expo-router `Link.Menu` + `Link.Preview`** | router 57 | iOS | UIContextMenu with a live route preview, SF Symbols, destructive, submenus | iOS only; push-only; navigable rows only | [docs](https://docs.expo.dev/router/advanced/link-preview/) |
| **`@expo/ui/swift-ui` `ContextMenu` (`Items`/`Trigger`/`Preview`) and `Menu`** | 57.0.20 | iOS | Custom preview (any SwiftUI or `RNHostView`), `menuOrder`, `menuActionDismissBehavior`, `ControlGroup` | Content is in a SwiftUI host; layout inside is native | tarball `swift-ui/ContextMenu` |
| **`@expo/ui/jetpack-compose` `DropdownMenu`, `ExposedDropdownMenuBox`** | 57.0.20 | Android | Real M3 menus, anchored; enhanced in 58 | Android only | tarball, [SDK 58](https://expo.dev/changelog/sdk-58-beta) |
| `@expo/ui/community/menu` `MenuView` (drop-in for `@react-native-menu/menu`) | 57.0.20 | iOS + Android | One API; native UIMenu / PopupMenu | Android PopupMenu is less M3 than Compose `DropdownMenu` *(weak — not verified visually)* | tarball |
| zeego | 3.0.6 (2025-03-21) | iOS/Android/web | One API | **No release for 18 months**; older native deps | npm |
| react-native-ios-context-menu | 3.2.1 (2025-09-28) | iOS | Mature custom previews | iOS only, a year stale | npm |

**Recommendation (high confidence):** a `ui/` `ActionMenu` concept with two backends. **iOS:** `Link.Menu`/
`Link.Preview` on navigable rows, `@expo/ui` `ContextMenu` (with `Preview`) or `Menu` elsewhere. **Android:**
`@expo/ui` Compose `DropdownMenu` anchored to the row or long-press point. Drop zeego and react-native-ios-context-menu
from consideration. Long-press = `ContextMenu` trigger on iOS and `onLongPress` → `DropdownMenu` + `LONG_PRESS` haptic
on Android.

---

## 5. Swipe actions, drag-to-reorder, segmented / button groups, switches, pickers, sliders

| Control | Native (Expo UI) | JS option | Recommendation | Evidence |
|---|---|---|---|---|
| **Row swipe actions** | SwiftUI `List` + `SwipeActions` (only inside a native SwiftUI `List`) | **RNGH `ReanimatedSwipeable`** (works inside Legend List / FlatList) | **RNGH `ReanimatedSwipeable`**, because the rows live in Legend List. Every swipe action is mirrored in `accessibilityActions` and the long-press menu | @expo/ui tarball; RNGH docs |
| **Drag to reorder** (sidebar pins, workflow steps) | SwiftUI `List` `ListForEach onMove` + `moveDisabled` (iOS only, native feel) | `react-native-reorderable-list` 0.18.1 (2026-07-12; Reanimated/RNGH; `onDragStart`/`onIndexChange` hooks for haptics); `react-native-draggable-flatlist` 4.0.3 (2025-05-06; used by Expensify); Legend List has **no** drag API (3.4.0 checked) | **react-native-reorderable-list** for cross-platform lists (haptic `DRAG_START` on start, `SEGMENT_TICK` per index change). SwiftUI `onMove` is fine for short iOS-only settings lists | [reorderable-list](https://github.com/omahili/react-native-reorderable-list), npm |
| **Segmented control / connected button group** | iOS `Picker` + `pickerStyle('segmented')`; Android `SingleChoiceSegmentedButtonRow` (M3) — or `@expo/ui/community/segmented-control` (one API) | — | **@expo/ui**: segmented Picker on iOS, SegmentedButton row on Android, behind one `ui/SegmentedControl` | tarball |
| **Switch** | universal `Switch` (UISwitch / M3 Switch); `SyncToggle`/`SyncSwitch` for worklet-controlled state | RN `Switch` (Android is SwitchCompat, not M3) | **@expo/ui universal `Switch`** for M3 fidelity on Android | tarball |
| **Picker** | universal `Picker` (menu + wheel) | — | @expo/ui | docs |
| **Slider** | universal `Slider`; Compose `VerticalSlider` in 58 | — | @expo/ui | [SDK 58](https://expo.dev/changelog/sdk-58-beta) |

Pitfall: each Expo UI control lives in a `<Host>`. From SDK 58 `<Host>` **top-aligns** content and `HStack`/`VStack`
spacing defaults change (breaking). Wrap the controls in `ui/` so the bump touches one place.

---

## 6. Haptics

`expo-haptics` 57.0.3 already covers the whole vocabulary ([docs](https://docs.expo.dev/versions/latest/sdk/haptics/)):
`selectionAsync`, `impactAsync(Light|Medium|Heavy|Rigid|Soft)`, `notificationAsync(Success|Warning|Error)`, and
**`performAndroidHapticsAsync(AndroidHaptics.*)`**, which covers `Segment_Tick`, `Segment_Frequent_Tick`,
`Toggle_On/Off`, `Long_Press`, `Gesture_Start/End`, `Drag_Start`, `Confirm`, `Reject`, `Context_Click`,
`Clock_Tick`, `Keyboard_*`, `Virtual_Key`. It uses `View.performHapticFeedback`, so it needs no VIBRATE permission
and respects the user's system haptics setting.

| Design token | iOS | Android |
|---|---|---|
| selection | `selectionAsync()` | `Segment_Tick` |
| impact light | `impactAsync(Light)` | `Toggle_On` / `Toggle_Off` (for toggles) or `Virtual_Key` |
| impact medium | `impactAsync(Medium)` | `Long_Press` (menus) / `Gesture_Start` (drag/panel) |
| success | `notificationAsync(Success)` | `Confirm` |
| warning | `notificationAsync(Warning)` | `Reject` *(no dedicated warning constant)* |
| error | `notificationAsync(Error)` | `Reject` |

Alternatives: `react-native-haptic-feedback` 3.0.0 (2026-03-29; Expensify still uses 2.3.3),
`react-native-nitro-haptics` 0.2.3 (2026-03-15; sync JSI calls). Neither adds needed constants. **Keep expo-haptics**
(high confidence). Route every call through one `haptics.ts` map (the repo already has `ui/haptics`) so the table
above is the only place the mapping lives. iOS mutes the Taptic Engine in Low Power Mode and during dictation.

---

## 7. Keyboard and input

- **react-native-keyboard-controller** 1.21.9 (the SDK 57 pin) already exports `KeyboardChatScrollView`,
  `KeyboardStickyView`, `KeyboardAwareScrollView`, `KeyboardToolbar` and `KeyboardGestureArea` (interactive
  dismissal). 1.22.x (2026-07 → 09) adds `KeyboardEffects` (Apple-Intelligence-style keyboard glow and background)
  and fixes for Android interactive dismissal and Reanimated 4.6. SDK 58 pins 1.22.4
  ([releases](https://github.com/kirillzyusko/react-native-keyboard-controller/releases)).
  **Legend List 3.4 ships a `@legendapp/list/keyboard` entry built on `KeyboardChatScrollViewProps`**, so the chat
  list and the keyboard controller are designed to work together.
- **Chat composer best practice:** Legend List (`alignItemsAtEnd`, `maintainScrollAtEnd`, `maintainVisibleContentPosition`)
  inside the keyboard entry + a `KeyboardStickyView` composer (a glass capsule on iOS) + `KeyboardGestureArea` for
  interactive swipe-down dismiss (iOS) and `offset.closed/opened` for the home indicator. Do not use
  `KeyboardAvoidingView` with `adjustResize` together.
- **Hardware keyboard shortcuts (iPad / Android tablets):** core RN has no `onKeyDown` on iOS/Android Views; the
  docs list only Android `focusable`/`tabIndex`/`nextFocus*` ([RN View](https://reactnative.dev/docs/view)).
  Options: `react-native-key-command` 1.0.18 (Expensify, 2026-09-22; UIKeyCommand + Android `onKeyDown`; needs
  AppDelegate/MainActivity edits and ships no config plugin); or a **few lines in the repo's existing custom Expo
  module**: a `UIKeyCommand` on the scene's root view controller (it shows in the iPadOS ⌘-hold menu via
  `discoverabilityTitle`), plus `dispatchKeyEvent` in an Activity listener on Android. Note: RN's `RCTKeyCommands`
  is compiled out on device ([tolaria#1102](https://github.com/refactoringhq/tolaria/issues/1102) *(weak)*).
  **Recommendation:** a custom module, because shortcuts should come from the shared command registry
  (packages/shared) and the scene-lifecycle plugin already owns the iOS entry points. Medium confidence.
- **Dictation:** the system keyboard's mic works on any native `TextInput`, so that is the zero-cost baseline. For
  an in-composer push-to-talk: `expo-speech-recognition` 57.1.0 (2026-09-16; SFSpeechRecognizer with
  `requiresOnDeviceRecognition`; Android SpeechRecognizer; *no* iOS 26 `SpeechAnalyzer` yet). Or
  `expo-speech-transcriber` (SpeechAnalyzer, less mature) ([Callstack SpeechAnalyzer
  post](https://www.callstack.com/blog/on-device-speech-transcription-with-apple-speechanalyzer)).
  `@react-native-voice/voice` 3.2.4 is effectively legacy. **Recommendation:** expo-speech-recognition, if the
  design keeps a mic button at all.
- iOS 26/27 text input: native `TextInput` gets Writing Tools, Genmoji and the new selection UI automatically.
  Nothing to add.

---

## 8. Biometrics and app lock

| Need | Option | Notes | Evidence |
|---|---|---|---|
| Face ID confirm for risky approvals | `expo-local-authentication` 57.0.3 `authenticateAsync({ promptMessage, disableDeviceFallback:false })` | Requires `NSFaceIDUsageDescription`. **A local prompt proves presence, not intent to the server.** | docs |
| **Server-verifiable confirmation** | Key in Secure Enclave / StrongBox that requires user presence to sign → server verifies the signature over `{approvalId, decision, nonce}` | The repo's `generatorai-device-key` custom module already signs requests. Add an access-control flag (`.biometryCurrentSet` / `setUserAuthenticationRequired(true)`) to a second "approval key" | repo |
| Secret at rest behind biometrics | `expo-secure-store` `requireAuthentication: true` | iOS asks on read/update (not create); Android on every op; **keys are invalidated when biometrics change**. `accessGroup` shares with extensions. SDK 58 adds Android `requireConfirmation` | [SecureStore docs](https://docs.expo.dev/versions/latest/sdk/securestore/) |
| App-switcher privacy | `expo-screen-capture` `enableAppSwitcherProtectionAsync(blur)` (**iOS only**); Android `preventScreenCaptureAsync()` = `FLAG_SECURE` (blank recents thumbnail, but also blocks screenshots) | On Android 13+ the proper API is `Activity.setRecentsScreenshotEnabled(false)`, which hides the thumbnail without blocking screenshots. Expose it from the custom module. *(Medium confidence: platform API, no Expo wrapper found)* | [ScreenCapture docs](https://docs.expo.dev/versions/latest/sdk/screen-capture/) |
| App lock on resume | `AppState` + lock overlay rendered before content; re-auth after N minutes | With the scene lifecycle, listen for `sceneWillDeactivate`-equivalent `AppState` `inactive` to cover the snapshot moment | — |

Recommendation (high confidence): **expo-local-authentication for the UX, plus a presence-gated device key for
the server proof** of risky approvals. Notification-action approvals already rely on iOS
`isAuthenticationRequired`. Keep that and make the server treat those decisions as "device-authenticated", not
"biometric-signed".

---

## 9. Live Activities (iOS) and Live Updates (Android 16+)

| Option | Version / date | iOS LA | Android Live Updates | Push | Maturity | Evidence |
|---|---|---|---|---|---|---|
| **`expo-widgets`** (Expo) | 57.0.21 (2026-09-24); 58.0.7 next | Yes: banner, compact, minimal, expanded; `createLiveActivity`, `start/update/end`, per-activity push tokens, **push-to-start tokens (iOS 17.2+)**, dismissal policies; `staleDate` in 58 | **No** (58 adds Android *widgets* only) | APNs (you send) | Stable since SDK 56; layouts are `@expo/ui/swift-ui` components with a `'widget'` directive (isolated runtime: no hooks, no async) | [widgets docs](https://docs.expo.dev/versions/latest/sdk/widgets/), [SDK 56](https://expo.dev/changelog/sdk-56) |
| **Voltra** (Callstack incubator) | 2.3.2 (2026-09-22); v1 in 2026-01 | Yes (JSX → SwiftUI), hot reload, **server-side JSX → JSON payload rendering** | **Ongoing notifications via FCM** (`upsertAndroidOngoingNotification`); the Android 16 Live Updates polish PR (promotion request, countdown chip, eligibility check) is **still open** ([PR #325](https://github.com/callstackincubator/voltra/pull/325)) | APNs + FCM | Active, MIT, ~800 stars | [repo](https://github.com/callstackincubator/voltra), [docs](https://www.use-voltra.dev/getting-started/introduction) |
| expo-live-activity (SWM labs) | 0.4.2 (2025-11); 0.5.0-alpha1 (2026-01) | Fixed templates only | No | APNs | Stale-ish | [repo](https://github.com/software-mansion-labs/expo-live-activity) |
| `@bacons/apple-targets` + hand-written SwiftUI + own module | 5.0.0 (2026-07-17) | Full control (`ActivityAttributes`) | Custom Kotlin module (`Notification.ProgressStyle`, `requestPromotedOngoing`, `androidx.core` 1.17 backports) | You own it | Stable tooling | [handbook](https://www.freecodecamp.org/news/react-native-live-activities-handbook/) |
| Notifee | archived (last update 2024-12) | — | No Android 16 support | — | Dead | same handbook |

Facts that shape the choice:
- **iOS remote updates need APNs with `apns-push-type: liveactivity`** and topic `<bundleId>.push-type.liveactivity`.
  **The Expo Push Service does not document Live Activity pushes**
  ([Expo push fields](https://docs.expo.dev/push-notifications/sending-notifications/)). GeneratorAI's server talks
  to Expo Push on purpose, so it holds no APNs key.
- **Android has no system-managed remote update.** An FCM data message wakes the app and re-posts the same
  notification ID. Promotion needs API 36.1 (`canPostPromotedNotifications()`), must be non-colorized and must
  come from a non-dismissible ongoing notification
  ([handbook](https://www.freecodecamp.org/news/react-native-live-activities-handbook/)). Because the app holds a
  live stream to the user's server while running, **local updates from the foreground/background stream** cover most
  of the "Running" use case without FCM.

**Recommendation (medium confidence):**
- **iOS:** `expo-widgets` Live Activities. It is first-party, stable and version-locked to the SDK, and shares the
  layout system with the home-screen widgets. Start and update locally while the app is alive. For remote updates
  and push-to-start, add a small **developer-operated push gateway** that holds the APNs `.p8` key. User servers post
  `{activityPushToken, contentState}` to it, authenticated per device (pairing proof). Alternatively accept
  "updates only while the app is running, final state via a normal push". This is a product decision; write a D-xx.
- **Android 16+:** a **custom Kotlin module** (extend `generatorai-device-key` or add `modules/generatorai-live`):
  a foreground-service-backed ongoing notification with `Notification.ProgressStyle` + `setRequestPromotedOngoing(true)`,
  updated from the app's own stream. It is ~300 lines and avoids a second JSX renderer. Re-evaluate Voltra once PR
  #325 lands, because it would also give Android widgets. Do not use Notifee.

---

## 10. Widgets, Control Center, Quick Settings, shortcuts / App Intents / Siri, sharing in

| Surface | Options | Recommendation | Evidence |
|---|---|---|---|
| **iOS home/lock-screen widgets** | `expo-widgets` (Expo UI SwiftUI, timelines, interactive buttons iOS 17+, configurable); Voltra; `@bacons/apple-targets` `widget` + SwiftUI | **expo-widgets**: same pipeline as the Live Activities | [widgets docs](https://docs.expo.dev/versions/latest/sdk/widgets/) |
| **Android widgets** | expo-widgets **58** (new: own Hermes runtime, interactions, Material colours); `react-native-android-widget` 0.22.1 (2026-08-17; RN views → RemoteViews, peer expo ≥54); Voltra (Glance) | **Wait for expo-widgets 58** (one widget definition style for both OSes). On 57, use react-native-android-widget if widgets must ship earlier | [SDK 58](https://expo.dev/changelog/sdk-58-beta), npm |
| **iOS Control Center controls** (iOS 18 `ControlWidget`) | No Expo API. `@bacons/apple-targets` `widget` target with a `ControlWidgetButton`/`Toggle` + an `AppIntent` | apple-targets + ~50 lines of Swift (e.g. "New chat", "Approvals"), using `openAppWhenRun` / `OpenURLIntent` into the router's deep links | [apple-targets](https://github.com/EvanBacon/expo-apple-targets) |
| **Android Quick Settings tile** | `react-native-android-quick-settings-tiles` 0.1.0 (**2022, abandoned**); custom `TileService` in the local module + manifest via a config plugin | **Custom `TileService`** (thin: launches a deep link; shows the "Needs you" count via `Tile.subtitle`) | [Android QS docs](https://developer.android.com/develop/ui/views/quicksettings-tiles) |
| **App shortcuts / quick actions** | `expo-quick-actions` 6.0.2 (2026-05-27; static + dynamic items, iOS max 4, router `href` integration) | **expo-quick-actions** | [repo](https://github.com/EvanBacon/expo-quick-actions) |
| **App Intents / Siri / Spotlight** | `expo-app-intents` 0.4.5 (**alpha, SDK 58**; Swift inline modules in `app-intents/`, `useAppIntents()` with at-least-once delivery, ≤10 App Shortcuts, phrases fixed at compile time); apple-targets `app-intent` target | **SDK 58 + expo-app-intents**, for "Approve pending", "Start chat in <project>", "Show running agents". Keep intents thin; they dispatch to JS | [App Intents docs](https://docs.expo.dev/versions/v58.0.0/sdk/app-intents/) |
| **Share into the app** | `expo-sharing` (share-*into* since SDK 55, **experimental**; its iOS extension opens the main app, which Apple does not officially support); `expo-share-intent` 8.0.1 (2026-07-10; peer `expo ^57`; iOS extension + Android intent filters → JS hook); `expo-share-extension` 5.0.6 (custom RN UI inside the extension; 2026-02) | **expo-share-intent** (built for SDK 57, handles both OSes, "open app with payload" matches "share to agent → pick chat"). Revisit expo-sharing when it leaves experimental | [expo-sharing](https://docs.expo.dev/versions/latest/sdk/sharing/), [expo-share-intent](https://github.com/achorein/expo-share-intent) |
| **Data sharing app ↔ extensions** | App Group (`com.apple.security.application-groups`) + `ExtensionStorage` (apple-targets) or `widgetsDirectory` (expo-widgets); `expo-secure-store` `accessGroup` for keychain; MMKV 4 supports an App Group path | One App Group, one "widget snapshot" JSON written by the app, **no credentials in the group**. Extensions deep-link into the app for anything authenticated | apple-targets README |

Solo-dev maintenance cost, lowest to highest: expo-quick-actions ≈ expo-share-intent ≈ expo-widgets (SDK-locked,
upgraded with Expo) < Control widgets / QS tile (small native code, rarely changes) < App Intents (alpha API churn)
< custom Android Live Updates module < a push gateway service (an operated backend). Ship in that order.

---

## 11. Notifications

`expo-notifications` 57.0.21 supports everything the design asks for
([docs](https://docs.expo.dev/versions/latest/sdk/notifications/)):

- **Categories/actions:** `setNotificationCategoryAsync` with `opensAppToForeground`, `isAuthenticationRequired`,
  `isDestructive`, and **`textInput: { placeholder, submitButtonTitle }`** for reply. Android text-input rendering
  varies by OEM.
- **Android channels** (importance fixed after creation) + channel groups. Keep `approvals` HIGH; add `runs`
  (DEFAULT), `mentions`, and a `live` LOW channel for the ongoing notification.
- **iOS interruption levels:** `timeSensitive` for approvals (needs the Time Sensitive capability entitlement).
  `critical` needs Apple approval; do not use it.
- **Grouping:** `threadId` (Expo Push field) / iOS `threadIdentifier` (SDK 58 adds it to local notifications),
  Android `tag`/group per chat.
- **Badges:** `setBadgeCountAsync` + the Expo Push `badge` field = Needs-you count.
- **Background handling:** `registerTaskAsync` + `_contentAvailable` for silent refresh.
- **SDK 58 breaking change:** foreground notifications now display by default unless the handler says otherwise.
  Set `setNotificationHandler` explicitly.

**Push path for a self-hosted server.** The app's publisher owns the APNs/FCM credentials; the user's server does
not.
1. **Expo Push Service (current):** the user's server posts the device's Expo token to `exp.host`. This is fine for
   alerts, categories, `interruptionLevel`, `threadId`, `badge`, `channelId`, `mutableContent`. **Enhanced Push Security**
   (an access token required on every send) does not fit this model: the token would have to be embedded in every
   self-hosted server, where anyone can extract it. So either leave it off and rely on push tokens being
   unguessable, or send through a gateway (option 2) that holds the token.
2. **Developer-operated push gateway** (a small service beside `apps/relay`): user servers authenticate with their
   host key (Ed25519 identity already used by the relay cell) and the gateway forwards to Expo Push, APNs
   (Live Activity) or FCM (Android data messages for Live Updates). This is the only path that gives iOS Live
   Activity remote updates and push-to-start. It adds an operated service and becomes a metadata observer. Decide
   explicitly (D-xx).
3. Direct APNs/FCM from each user's server: this needs the publisher's keys on user machines. Rejected by the existing
   ExpoPushProvider rationale.

---

## 12. Tablets and large screens

- **iPadOS 26/27:** windowed, resizable apps. `UIRequiresFullScreen` is deprecated and ignored from iOS 27, so all
  apps must be freely resizable; orientation locks may not hold
  ([Apple forum](https://developer.apple.com/forums/thread/820475), [SDK 58](https://expo.dev/changelog/sdk-58-beta):
  "`requireFullScreen` no longer prevents resizing; `ScreenOrientation.lockAsync` may be ineffective").
  The scene lifecycle is mandatory (the repo's plugin; SDK 58 prebuild does it natively. **Remove
  `withSceneLifecycle` when moving to 58** to avoid double SceneDelegates).
- **Android:** apps targeting API 36 have orientation/aspect/resizability restrictions ignored on sw ≥ 600dp (opt-out
  possible). **API 37 removes the opt-out**; Play requires API 36 by **2026-08-31** and API 37 by **August 2027**
  ([Android blog](https://android-developers.googleblog.com/2026/02/prepare-your-app-for-resizability-and.html)).
  The app already uses `orientation: 'default'`, which is correct.
- **Approach:** width-class breakpoints from `useWindowDimensions()` (not `Platform.isPad`, not the device idiom,
  because windows resize live). Compact < 600, medium 600–839, expanded ≥ 840 (M3 window classes; iPad uses the same
  thresholds in pt). Compact = overlay drawer + overlay pane. Medium = persistent drawer, overlay pane. Expanded =
  persistent 312pt/300dp sidebar + content + persistent 410pt/400dp pane. Content max-width for reading. State must
  survive resizes: panels are UI state in `shellStore`, never remounted by a breakpoint change.
- **Foldables:** the same width classes. Avoid putting content across the hinge; the posture API is not needed at first.
- **Pointer/trackpad:** RN `Pressable` handles hover on iPadOS (`onHoverIn/Out`), and `cursor` style is supported
  on iOS 17+. Add hover states to `ui/` rows and buttons. Use keyboard shortcuts (§7) for ⌘K, ⌘N, ⌘[ / ⌘].

---

## 13. Accessibility

| Need | API | Notes |
|---|---|---|
| Swipe / long-press equivalents | `accessibilityActions` + `onAccessibilityAction` (`activate`, `longpress`, custom named actions) | Every swipe action and menu item becomes a VoiceOver rotor / TalkBack action. The panel close uses `accessibilityEscape` on iOS |
| Dynamic Type / font scale | RN `Text` scales by default; cap with `maxFontSizeMultiplier` (the repo has `MAX_SCALE`); `useWindowDimensions().fontScale` for layout switches | Large text should reflow toolbars into overflow menus |
| Reduce Motion | Reanimated `useReducedMotion()` + `ReduceMotion.System` on animations; `AccessibilityInfo.isReduceMotionEnabled` | `SidePanel` already honours it |
| **Reduce Transparency** | `AccessibilityInfo.isReduceTransparencyEnabled()` + `reduceTransparencyChanged` — **iOS only; always `false` on Android** | Native glass (UIGlassEffect via expo-glass-effect, native headers and sheets) adapts on its own. JS-drawn "glass" (BlurView fallbacks) must switch to opaque tokens when the flag is true ([RN AccessibilityInfo](https://reactnative.dev/docs/accessibilityinfo)) |
| Increase Contrast | `AccessibilityInfo.isHighTextContrastEnabled` (Android); iOS "Increase Contrast" has no RN API (use `PlatformColor` semantic colours, which adapt) | Token sets should include a high-contrast variant |
| Bold text / grayscale / invert | `isBoldTextEnabled`, `isGrayscaleEnabled`, `isInvertColorsEnabled` (iOS) | — |

---

## 14. How top apps do it

| App | Stack | Navigation | Sheets / menus | Live Activities / widgets | Evidence |
|---|---|---|---|---|---|
| ChatGPT (incl. Codex) | Native (Swift / Kotlin + Compose; the Sora Android app was built in Kotlin + Compose) | Left sidebar drawer over the chat, edge-swipe on root, no tab bar — the IA this redesign copies | Native sheets and menus | — | [OpenAI Sora Android](https://openai.com/index/shipping-sora-for-android-with-codex/) *(ChatGPT stack inferred, weak)* |
| Claude | Not publicly documented | Left drawer, no tab bar | Native-looking sheets | — | *(weak)* |
| Linear | **Native Swift + Kotlin** | Inbox-first, sidebar on iPad | Native | — | [linear.app/mobile](https://linear.app/mobile) |
| GitHub Mobile, Slack | Native *(weak: no primary source found this session)* | Tabs (GitHub); Slack moved to a tab bar + workspace switcher | Native | GitHub: widgets | — |
| **Bluesky** | **Expo 57 + React Navigation 7 (not expo-router) + `react-native-drawer-layout` 4.2.3 + @expo/ui 57.0.20**, screens 4.26.2, keyboard-controller 1.21.9 | JS drawer (drawer-layout) + native stack; its own `BlockDrawerGesture` for pagers | JS + native modules | Custom native modules (share extension, NSE) | [package.json](https://github.com/bluesky-social/social-app/blob/main/package.json), [RNGH 3 PR](https://github.com/bluesky-social/social-app/pull/11682) |
| **Expensify** | **RN 0.86 + Expo 57 modules + React Navigation 7**, screens 4.28.0 | JS-heavy custom layouts incl. wide-screen split | `react-native-draggable-flatlist`, `react-native-haptic-feedback`, `react-native-key-command` (own lib, hardware shortcuts) | — | [package.json](https://github.com/Expensify/App/blob/main/package.json) |
| **Discord** | RN (New Architecture, migrated Android first, then iOS) | Custom | Custom native-backed | — | [SWM case study](https://swmansion.com/blog/what-it-actually-takes-to-migrate-discord-to-react-native-s-new-architecture/) |
| Shopify (Shop, Shopify app) | RN | Tabs | — | Shop has order-tracking Live Activities *(weak)* | — |

Takeaways: the RN apps closest to this IA (Bluesky) run a **JS drawer over a native stack**, the same shape as
the repo's `SidePanel`. Nobody in RN ships a native drawer. Live Activities in RN apps are native extensions fed by
the app, which is what `expo-widgets` now automates.

---

## Recommended packages and native targets

| Package / target | Version to pin | Action | Reason | Evidence |
|---|---|---|---|---|
| expo (+ all expo-*) | `~57.0.25` now → `~58.0.x` at stable | upgrade (patch now, SDK later) | 57 patch fixes; 58 brings stable toolbars, Android widgets, App Intents, native SceneDelegate | §0 |
| expo-router | `~57.0.23` | upgrade (patch) | Stack.Toolbar Android badge fixes, link-preview fixes | npm |
| react-native-screens | `~4.26.2` (SDK pin); do **not** jump to 4.28 or 5.0-alpha on 57 | keep | The SDK-matched pin; v5 alpha is for testing only | §1g |
| react-native-gesture-handler | `~2.32.0` → `~3.2.x` with SDK 58 | keep → upgrade | RNGH 3 hook API; port `SidePanel` and swipeables | [RNGH 3](https://docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrading-to-3/) |
| react-native-reanimated / worklets | `~4.5.1` / `0.10.x` | keep | SDK-matched | bundledNativeModules |
| react-native-keyboard-controller | `1.21.9` → `1.22.4` with 58 | keep | Already has `KeyboardChatScrollView` / `KeyboardGestureArea` | §7 |
| @legendapp/list | `^3.4.0` | upgrade | `keyboard` entry for chat; no drag API | tarball |
| **@expo/ui** | `~57.0.20` | **add** | Menus (SwiftUI ContextMenu with Preview / Compose DropdownMenu), segmented, Switch, Picker, Slider, native sheets for Expo UI content | §4–5 |
| **@lodev09/react-native-true-sheet** | `3.11.15` → `4.x` when stable | **add** | Native sheets with RN content, keyboard, stacking, glass, predictive back | §3 |
| @gorhom/bottom-sheet (+ @gorhom/portal) | — | **remove** | JS sheet; no glass or M3; superseded by formSheet + True Sheet | §3 |
| expo-router `formSheet` / `fullScreenModal` | (router) | use | Route sheets with glass and detents (iOS); editors without swipe dismiss | §1c |
| expo-router `Link.Preview` / `Link.Menu` / `Link.AppleZoom` | (router) | use (iOS) | Native context menus with preview, zoom transitions | §1e, §1i |
| expo-router `unstable-split-view` | (router) | defer | Alpha, iOS only; JS persistent layout for tablets instead | §1f |
| expo-router `drawer` / react-native-drawer-layout | — | do not add | Keep the in-repo `SidePanel` | §1a, §2 |
| `ExperimentalStack` / predictive back | `predictiveBackGestureEnabled: false` | keep off | expo#39092 open; screens v4 cannot animate it | §1g |
| expo-haptics | `~57.0.3` | keep | Full iOS + Android constant vocabulary | §6 |
| react-native-reorderable-list | `0.18.1` | add | Cross-platform drag-to-reorder with haptic hooks | §5 |
| expo-local-authentication | `~57.0.3` | keep | Face ID prompt | §8 |
| expo-secure-store | `~57.0.4` | keep | `requireAuthentication`, `accessGroup` | §8 |
| expo-screen-capture | `~57.0.3` | add | iOS app-switcher blur | §8 |
| custom module `generatorai-device-key` | in-repo | extend | Presence-gated approval key; Android `setRecentsScreenshotEnabled(false)`; hardware key commands; system-gesture exclusion band | §2, §7, §8 |
| expo-notifications | `~57.0.21` | keep | Categories, text-input reply, channels, time-sensitive, badges | §11 |
| **expo-widgets** | `~57.0.21` (iOS) → `~58` (adds Android) | **add** | Widgets + Live Activities, first-party | §9–10 |
| new local module `generatorai-live` (Kotlin) | in-repo | **build** | Android 16+ Live Updates (`ProgressStyle`, promoted ongoing) fed by the app's stream | §9 |
| Voltra | 2.3.2 | watch | Re-evaluate when Android Live Updates PR #325 merges | §9 |
| **@bacons/apple-targets** | `5.0.0` | **add** | Control Center `ControlWidget` target (+ App Intent), later a notification-content target | §10 |
| Android `TileService` (config plugin in-repo) | in-repo | **build** | Quick Settings tile; the only library is abandoned | §10 |
| **expo-quick-actions** | `6.0.2` | **add** | Home-screen quick actions / app shortcuts | §10 |
| expo-app-intents | `~0.4.5` (SDK 58 only) | add with 58 | Siri / Shortcuts / Spotlight; alpha | §10 |
| **expo-share-intent** | `8.0.1` | **add** | Share-to-agent on both OSes (peer `expo ^57`) | §10 |
| expo-speech-recognition | `57.1.0` | add (optional) | Push-to-talk in the composer | §7 |
| react-native-key-command | 1.0.18 | skip | Prefer the custom module fed by the shared command registry | §7 |
| zeego, react-native-ios-context-menu, expo-live-activity, Notifee, react-native-android-quick-settings-tiles, @react-native-voice/voice | — | do not add | Stale, archived or superseded | §4, §9, §10, §7 |
| `plugins/withSceneLifecycle.js` | in-repo | remove at SDK 58 | SDK 58 prebuild generates the SceneDelegate | §12 |
| Push gateway service (beside `apps/relay`) | — | decide (D-xx) | Needed only for remote Live Activity updates / push-to-start and FCM data messages | §11 |

---

## SDK 57 vs wait for SDK 58 — verdict

**Start the redesign on SDK 57 now. Plan a dedicated SDK 58 bump task after 58 goes stable (expected mid/late
October 2026, following RN 0.88 final). Do not build on the 58 beta.**

Reasons:
1. Almost everything the redesign's core needs is stable on 57: native Stack + `Stack.Toolbar` (iOS glass header
   buttons), formSheet with detents, `Link.Preview`/`Link.Menu`, Apple zoom, @expo/ui menus and controls, True Sheet,
   keyboard-controller chat views, expo-haptics' Android constants, notifications, expo-widgets Live Activities, and
   the in-repo `SidePanel` for drawer and pane.
2. What 58 adds is either **peripheral** (Android widgets, App Intents alpha, stable native tabs, which are not
   used), or **does not solve the hard gaps** (predictive back is still `ExperimentalStack`-only; split view is
   still iOS-only alpha).
3. 58 is a **breaking** bump in exactly the layers the redesign touches: the navigation core rework, RNGH 2 → 3,
   `<Host>` alignment and spacing defaults, foreground notifications shown by default, the SceneDelegate now
   generated (the repo plugin must go), R8 on by default, and RN 0.88 Strict TypeScript API. Doing the redesign and
   the bump in one move doubles the unknowns. Doing the bump as its own task after the shell lands keeps each step
   verifiable.
4. Mitigations to take on 57 so the bump is cheap: keep every native control behind a `ui/` wrapper (Host alignment
   changes land in one place); write new gestures against a thin `ui/gestures` helper (RNGH 3 port in one place);
   set `setNotificationHandler` explicitly; keep Android widgets and App Intents out of the 57 scope and schedule
   them in the 58 task.

Confidence: high for "57 now, 58 as a separate task"; medium on the 58 stable date (Expo says only "3–4 weeks"
of beta from 2026-09-15, gated on RN 0.88).
