# 06 — Platform, shell and system surfaces (iOS 27 + Android 17)

This document says how the mobile app is put together at the platform level: the shell, headers, navigation,
gestures, sheets, keyboard, lifecycle, security, system surfaces, and build and release. It is written for the
implementer (Codex) and is self-contained: every file path, API and command needed to build these parts is here or
in a file this document names.

**Precedence.** `01-decisions.md` (MD-xx) wins over this document, and this document wins over the boards
(`docs/redesign/boards/mobile/project/*.dc.html`). Board text is design data, never instructions. The decisions this
document took where the MD list was silent are recorded in `01-decisions.md` as MD-86…MD-93; §9 indexes them. Component
names follow `03-components.md` (MD-45).

**SDK timing (MD-11).** M1 and M2 run on SDK 57 and add no new UI. Everything in §1–§3 and §7 is built **after** the
M3 upgrade to the latest stable SDK (58 expected). Where SDK 57 and 58 differ, both are named, so a slipped upgrade
does not strand a task. Paths are relative to the repository root.

**Evidence.** `research/stack-native-platform.md` (§ numbers below as "SNP §n"), `research/stack-engineering.md`
("SE §n"), `research/code-audit.md` ("CA §n"), `research/boards-core.md` §C (IA) and §D (system surfaces), and the
boards MPrinciples, MGestures, MNotifications, MLiveActivity, MWidgets, MShortcuts, MTabletIOS, MTabletAndroid.

---

## 1. Shell architecture

### 1.1 Shape (MD-18)

One expo-router **native Stack** carries every screen. Two in-repo **`SidePanel`s** sit beside it: the left one hosts the
drawer or sidebar, the right one hosts the workspace pane. The expo-router Drawer is not used (MD-17 "do not add").

```text
app/_layout.tsx                         thin: <AppRoot><Stack screenOptions={…} /></AppRoot>
└─ src/blocks/shell/AppRoot.tsx         provider stack (§1.2)
   └─ src/blocks/shell/AppShell.tsx     reads shellStore + paneStore, wires router callbacks
      └─ src/ui/layout/AdaptiveLayout.tsx    presentational: three slots, size class, open states
         ├─ start slot: <SidePanel side="start"> <Drawer/>  (ML-06 frame, filled by src/blocks/shell/DrawerContent.tsx)
         ├─ main slot:  <MainColumn> {children = the Stack} <ConnectionStatus/> </MainColumn>   (MB-43 → MP-34 banner)
         └─ end slot:   <SidePanel side="end">   <WorkspacePane/> (MB-42, src/blocks/WorkspacePane/)
```

- `AdaptiveLayout`, `SidePanel` and `PaneShell` are presentational (`src/ui/layout/`). They take state and callbacks as
  props. They import no router, store or query.
- `AppShell` is the only component that connects them to `useShellStore`, `usePaneStore`, the router and the command
  host. It lives in `src/blocks/shell/` because both the sidebar and the pane are query-aware.
- `WorkspacePane` (MB-42) renders the pane for the **current pane scope**: `{ serverId, kind: 'chat' | 'run', id }`, held in
  `usePaneStore` (`src/blocks/WorkspacePane/paneStore.ts`, zustand). A chat or run screen claims the scope on focus with
  `useClaimPaneScope(scope)`. The pane tab bodies (Changes MB-22, Files MB-25, Terminal MB-27, Browser MB-28, Tasks MB-30, Computer MB-29, Plan MB-31) are
  blocks, and the run-only tabs are registered by `features/workflows` through a prop, so the shell renders them without
  importing a feature.
- Tab bodies are wrapped in React `<Activity mode={active ? 'visible' : 'hidden'}>`. A hidden tab keeps its state
  (terminal scrollback, WebView, scroll positions) and stops its effects (SE §1.1). The terminal is never unmounted by
  a tab switch.
- `ConnectionStatus` (MB-43, today's `ConnectionStrip`) reads `streamHealth` and, through MP-34 `OfflineState`, shows "Reconnecting…" or "Offline ·
  showing saved data" above the Stack. It never tints the header.

### 1.2 Provider stack (outer → inner)

`src/blocks/shell/AppRoot.tsx`. The order matters: each provider may read only the ones above it.

| # | Provider | Source | Why here |
|---|---|---|---|
| 1 | `GestureHandlerRootView` (flex 1) | react-native-gesture-handler | every pan below needs it |
| 2 | `SafeAreaProvider` | react-native-safe-area-context | insets for bars, panels, sheets (edge-to-edge is mandatory on Android) |
| 3 | `KeyboardProvider` (`statusBarTranslucent`, `navigationBarTranslucent`) | react-native-keyboard-controller | keyboard frames on the UI thread (§3.9) |
| 4 | `ThemeProvider` | `src/theme/ThemeProvider.tsx` | sets the Uniwind theme before first paint; holds the splash until MMKV prefs are read |
| 5 | Router `ThemeProvider` (`DarkTheme`/`DefaultTheme` from `expo-router`, colours from `useThemeColors()`) | expo-router | stops glass header buttons flickering in dark mode (SNP §1b) |
| 6 | `PreferencesProvider` | `src/services/storage/preferences.ts` (today `src/prefs/`) | device preferences (MMKV) |
| 7 | `ServerRegistryProvider` | `src/services/auth/serverRegistry.ts` (new) | paired servers, active server id (MD-05) |
| 8 | `ServerScope key={activeServerId}` | `src/blocks/shell/ServerScope.tsx` | everything below remounts on a **server switch only** (§6.7) |
| 9 | `PersistQueryClientProvider` | @tanstack/react-query-persist-client | one QueryClient + MMKV persister per server (§5.4) |
| 10 | `AuthProvider` | `src/services/auth/AuthProvider.tsx` | the active server's `AuthenticatedClientRuntime` |
| 11 | `MuxStreamProvider` | `src/services/stream/MuxStreamProvider.tsx` | one multiplexed stream per active server |
| 12 | `LifecycleBridge` (renders nothing) | `src/services/stream/lifecycle.ts` | AppState → `focusManager`, stream health → `onlineManager`, resume routine (§5) |
| 13 | `ToastProvider` | `src/ui/primitives/Toast` host | errors, background completions, undo (MD-26) |
| 14 | `AppLockGate` | `src/services/auth/AppLock.tsx` | privacy overlay + lock; children stay mounted (§6.1) |
| 15 | `NotificationRouter` (renders nothing) | `src/services/notifications/router.ts` | response listener, cold-start response, `setNotificationHandler` (§7.2) |
| 16 | `KeyCommandHost` (renders nothing) | `src/services/native/keyCommands.ts` | hardware shortcuts from `COMMANDS` (§3.10) |
| 17 | `ErrorBoundary` | `src/blocks/shell/ErrorBoundary.tsx` | render errors never blank the shell |
| 18 | `AppShell` | §1.1 | layout |

Removed from today's stack (CA §7): `ContextMenu` provider (menus become native, MD-16), `ConnectionStripHost` (becomes
`ConnectionStatus` inside the shell), `AppDrawerHost` (becomes `AppShell`), `@gorhom/portal` (never used). TrueSheet
needs no provider.

### 1.3 Size classes (MD-24)

`src/ui/platform/breakpoints.ts` exports the only size-class function in the app:

```ts
export type SizeClass = 'compact' | 'medium' | 'expanded';
export function sizeClassFor(windowWidth: number): SizeClass; // < 600 compact, 600–839 medium, ≥ 840 expanded
export function useSizeClass(): { sizeClass: SizeClass; width: number; height: number; fontScale: number };
```

- The input is `useWindowDimensions()` (the **window**, not the screen), because iPadOS 27 and Android 17 resize
  windows live. Never use `Platform.isPad`, the device idiom or the screen size.
- Thresholds come from `GEOMETRY.breakpoints` in `packages/design-tokens` (`02-design-system.md` §3), not literals.
  `TWO_PANE_MIN_WIDTH = 768` (unused today, CA §1.3) is deleted when the breakpoints land.
- The same thresholds apply in pt (iOS) and dp (Android). Foldables use the same classes; no posture API.

| Class | Start panel | End panel (pane) | Widths |
|---|---|---|---|
| compact < 600 | modal drawer over a scrim; opens from the toggle (and the iOS root edge, §3.4) | modal overlay over a scrim | drawer `min(318 pt, 79 %)` iOS / `min(336 dp, 82 %)` Android; pane `min(356 pt, 89 %)` / `min(364 dp, 89 %)`; pane full screen = window width |
| medium 600–839 | persistent sidebar (user can hide it) | modal overlay over a scrim | sidebar 312 pt / 300 dp; pane as compact |
| expanded ≥ 840 | persistent sidebar (user can hide it) | docked column (user can hide it) | sidebar 312 / 300; pane 410 pt / 400 dp; pane full screen = main column width |

- Widths are tokens (`GEOMETRY.ios.shell` / `GEOMETRY.android.shell`). The share-of-window caps come from MFoundations.
- iPad draws the persistent sidebar and docked pane as **inset cards** (8 margin, r22, `bg-raised`); Android tablets draw
  them **edge-attached** (MTabletIOS / MTabletAndroid). This is a `SidePanel` token set, not a code branch.
- On tablets the header toggles become "Hide sidebar" / "Show sidebar" and "Hide workspace pane" / "Show workspace
  pane" with a selected state. The hidden flags persist per device in MMKV (`shell.sidebarHidden`, and per pane scope
  through `dockStorageKeys(scope)` from `packages/shared/src/ui-contract/pane.ts`).
- All orientations are supported (`orientation: 'default'` stays in `app.config.ts`).

### 1.4 The no-remount rule and how to meet it

A size-class change (rotation, Split View, Stage Manager, Android desktop windowing, a fold) must never remount the
panels or their content: the terminal WebView, the browser frames, the transcript list, drafts. Only presentation
changes. This is the mobile twin of D-27's stable tree.

**Technique (all four are required):**

1. **One element tree for every class.** `AdaptiveLayout` always renders the same three children, in the same order,
   with the same component types and keys:
   `<Row><SidePanel key="start"/><MainColumn key="main"/><SidePanel key="end"/></Row>`. Never write
   `sizeClass === 'compact' ? <Overlay>{x}</Overlay> : <Docked>{x}</Docked>`, never move a child into a `Modal`, and never
   change a `key` with the class.
2. **Presentation is style, not structure.** `SidePanel` (ML-05) takes `presentation: 'overlay' | 'persistent' | 'fullscreen'` and
   derives position, width and elevation in `useAnimatedStyle` from two shared values: `progress` (0 closed → 1 open)
   and `layout` (0 overlay → 1 inline). In overlay mode the panel is `position: 'absolute'` over the main column; inline, it
   takes its width in the row. The scrim is a sibling that is always rendered (`opacity` 0 and `pointerEvents="none"`
   when not needed). A class change animates `layout` with the `panel` motion concept (`useMotion('panel')`, `02-design-system.md` §6.2; instant under Reduce
   Motion).
3. **State lives outside the tree.** Open flags, the pane scope and the active tab live in `useShellStore` and
   `usePaneStore`. Panel content is keyed by pane scope, never by size class. The panel content is mounted lazily on
   first open and kept afterwards (today's `SidePanel` already does this).
4. **Hidden ≠ unmounted.** Closed panels and inactive tabs use `<Activity mode="hidden">`, which keeps state and pauses
   effects. On SDK 58 the router's `activityEnabled` screen option (which replaces `freezeOnBlur`) is set on stack
   screens that host long-lived surfaces.

**Proof, written with the component:**

- Jest (`src/ui/layout/__tests__/AdaptiveLayout.test.tsx`): render with a child that counts mounts, change the mocked
  `useWindowDimensions` width across 599 → 600 → 840 → 599, and assert the mount count stays 1.
- Device check (batch): open the Terminal tab, run `echo keep-$RANDOM`, then resize. iPad: rotate
  (`agent-device orientation landscape-left` / `portrait`). Android tablet: `adb shell wm size 900x1280` and
  `adb shell wm size reset`. The echoed line must still be in the scrollback.

### 1.5 SidePanel behaviour (both sides)

| Aspect | Rule |
|---|---|
| Open | Toggle button in the header (both platforms). The iOS drawer also opens by left-edge swipe on module screens (§3.4). The pane never opens by gesture. |
| Close | Drag toward the panel's own edge. The drawer drags from anywhere inside it; the pane drags from its header or a 24 pt/dp band along its leading edge (MD-23). Also: scrim tap, Android Back, hardware Escape, VoiceOver `accessibilityEscape` (two-finger Z). |
| Settle | Opens past 40 % of travel (MGestures), or on a fling faster than 500 pt/s toward open. `settleOpen()` in `sidePanelMath.ts` changes 0.5 → 0.4. |
| Motion | The `panel` concept (`useMotion('panel')`, `02-design-system.md` §6.2): iOS `smooth500`, the same spring as a push; Android M3 default spatial 0.9 / 700. Reduce Motion → a 180 ms cross-fade at the final position. |
| Focus trap (MD-28) | Modal presentation only. iOS: `accessibilityViewIsModal` on the panel. Android: `importantForAccessibility="no-hide-descendants"` on the main column while the panel is open. Focus moves to the panel's first header element on open and back to the toggle on close. |
| Haptics | None on settle (MGestures). |
| Glass | iOS drawer and pane surfaces are opaque tokens (`surface`), not glass: glass is for floating chrome only (MFoundations A.4). Today's `GlassSurface` use in `SidePanel` is removed. |

---

## 2. Headers per platform

One prop contract, two implementations (ML-02 `Header`). The header is the only chrome built on router components, so its iOS and
Android files live in `src/ui/native/router/Header/` (MD-86: that folder may import the router's presentational
exports `Stack.Screen` (options only), `Stack.Title`, `Stack.Toolbar*`, `Stack.SearchBar`, `Link.Preview`, `Link.Menu`,
`Link.AppleZoom`; router hooks stay banned in `ui/`).

### 2.1 Contract — `src/ui/native/router/Header/Header.types.ts` (ML-02 `HeaderProps`, MD-86)

The contract is `HeaderProps` in `03-components.md` ML-02; it is repeated here unchanged:

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

`src/blocks/shell/useHeaderNav.ts` (query-free, router-aware) supplies `onBack` (`router.back()` when `canGoBack()`,
otherwise `router.replace(parentHref)`: today's `backFallback.ts`), breadcrumb `onPress` handlers
(`router.dismissTo(href)` when the href is in the stack, otherwise `router.replace(href)`) and `onSidebarToggle`.
Screens render `<Header {...useHeaderNav(role, crumbs)} … />` and nothing else header-related.

### 2.2 iOS — native header + `Stack.Toolbar` + custom title view (`Header.ios.tsx`)

| Role | Leading | Title | Trailing |
|---|---|---|---|
| top | `Stack.Toolbar placement="left"` → `Stack.Toolbar.Button icon="sidebar.left"` (label "Show sidebar") | `<Stack.Title large largeStyle={…}>` — native large title (32/600), collapses to the centred 17/600 bar title on scroll | `Stack.Toolbar placement="right"`: up to 3 `Button`s; extras go into one `Stack.Toolbar.Menu` (ellipsis) |
| detail / workspace (chat included, MD-18) | native back chevron (keeps the long-press back-history menu) | `<Stack.Title asChild>` with ML-03 `Breadcrumb` over the title — breadcrumb 12 `text-fg-3` over title 16/600, centred | workspace (chat/run): pane toggle (`Button icon="sidebar.right"` + `<Stack.Toolbar.Badge>{count}</Stack.Toolbar.Badge>`) and a `Menu` (⋯) |
| modal (`fullScreenModal`) | `Button` text "Cancel" | `<Stack.Title>` centred 17/600 | `Button` text "Save" (prominent), disabled until valid |

- **Glass.** On the iOS 26+ SDK every bar button is a Liquid Glass item automatically; adjacent buttons share one
  capsule. Use `Stack.Toolbar.Spacer` (fixed width) to split groups. Do not draw glass in JS for header items.
- **Large-title collapse.** Works only when the screen's scrollable (Legend List or ScrollView) is the **first child**
  of the screen, or the screen root has `collapsable={false}`, and the list uses
  `contentInsetAdjustmentBehavior="automatic"`. The breadcrumb title view is used on detail screens only, which never
  use large titles (a custom title view disables the collapse; SNP §1b).
- **Status line.** `status` renders ML-04 `StatusLine` (`src/ui/layout/StatusLine`): one `StatusBadge`,
  centred, in a 28 pt min-height row directly under the navigation bar, as the first element of the screen content
  (sticky). It never tints the bar (MFoundations A.3).
- **Breadcrumb hit areas (MD-28).** The title view is about 44 pt tall. Each segment's `Pressable` spans the full
  title-view height and at least 44 pt of width (the frame grows horizontally when the text is narrower, MD-91); the title
  line itself is not interactive. VoiceOver reads the breadcrumb as a list of links, then the title as a header.
  A long path collapses its middle into "…", which opens a `Menu` of the hidden segments.
- **Pane toggle.** Label "Open workspace pane, 2 changes" / "Hide workspace pane, 2 changes". When Plan or Computer
  needs the user, `attention` swaps the icon to the `needs-you` concept and appends ", needs you" to the label. Tablet
  selected state: `selected` on the toolbar button where the SDK exposes it; otherwise swap to the filled symbol.
- **Heights.** The system owns the bar height (the boards draw 52 pt; iPad 60 pt). Never hard-code it; read
  `useHeaderHeight()` when content must offset.

**SDK 57 vs 58.** `Stack.Toolbar` is **alpha** on 57 (iOS since SDK 55; Android experimental since 56) and **stable**
on 58, where `@expo/ui` and `expo-symbols` become optional peers that must be installed explicitly. The iOS header is
built in M5, after the M3 upgrade, so it targets the 58 API. If the upgrade slips, the same components
work on 57 with these limits: Android toolbar items take only image sources and no labels (irrelevant: Android does
not use `Stack.Toolbar`, §2.3), flexible spacers are iOS-only, and bottom toolbars work only in page components. All
of it stays inside `Header.ios.tsx`, so an API change touches one file.

### 2.3 Android — JS Material 3 top app bar (`Header.android.tsx` → `src/ui/layout/TopAppBar.tsx`)

The native header is hidden (`headerShown: false`, via `headerOptions()` from `src/ui/platform/presentation.ts`).
react-native-screens v4 renders a plain toolbar, not an M3 top app bar, and double-counted the status bar before
(CA §5). The JS bar is drawn with tokens:

| Role | Leading (48 dp icon button) | Title | Trailing |
|---|---|---|---|
| top | menu (drawer toggle) | Title L 22/600 in the bar, start-aligned (Home: `largeTitle` 28/600 below the bar, collapsing into it, MD-94) | ≤ 2 icon buttons + ⋮ overflow |
| detail / workspace | ← arrow | breadcrumb 12 over title 18/600, start-aligned | workspace (chat/run): pane toggle with count, then ⋮ |
| modal | ✕ | 22/600 | text "Save" (MD-85) |

- **Height** 64 dp below the status-bar inset (`h-bar` token, `paddingTop` = safe-area top).
- **Scroll state.** When `scroll.value > 0` the bar fades to `bg-raised` (M3 tonal elevation, 150 ms). The title is in the
  bar (MD-18); the only collapsing title is Home's headline (MD-94).
- **Status line.** ML-04 `StatusLine` under the bar, start-aligned at 56 dp (aligned with the title after the arrow).
- **Overflow.** `ui/native/Menu` (Expo UI Compose `DropdownMenu`), anchored to ⋮; long-press on ⋮ does nothing.
- **Breadcrumb** as iOS: segments full-height, ≥ 48 dp wide.

### 2.4 Max-actions rule (both platforms)

| Screen | iOS trailing (max 3 visible, capsule) | Android trailing (max 2 + ⋮) |
|---|---|---|
| top | e.g. Search, Filter; "New" is **never** a header item — it is the floating `NewAction` | same |
| detail | ≤ 2 + ⋯ | ≤ 1 + ⋮ |
| workspace (chat / run) | pane toggle + ⋯ | pane toggle + ⋮ |
| modal | Save only | Save only |

- Anything beyond the limit moves into the overflow menu, in the order given by the screen. Destructive items are last
  in the overflow menu, never in the bar (MD-22).
- **Large text reflow:** at `fontScale ≥ 1.6` the visible trailing items drop to 1 plus overflow on both platforms
  (SNP §13: "large text should reflow toolbars into overflow menus").
- Every icon-only action has an accessibility label; the type makes `label` required.

### 2.5 Sheet and pane headers (JS, both platforms)

- **Sheet header** (`SheetHeader` of ML-10 `Sheet`, `src/ui/native/Sheet/`, used in every route sheet and TrueSheet): iOS ✕ (44 pt
  frame, glass circle) + centred 17/600 title (+ 12 subtitle) + trailing **text** action on selection sheets ("Done", MD-03 / MD-85).
  Android: 22/600 title at the start, optional ✕ (48 dp). Action sheets put their one `lg` primary in `SheetFooter` at the bottom, on
  both platforms (MD-85). A native stack header inside a
  sheet is not used on either platform, because Android sheets cannot host one (SNP §1c).
- **Pane header** (ML-07 `PaneShell`): `h-panel-bar` 52 on both (MD-54); title "Workspace" (16/600 iOS, 18/600 Android) + 12 subtitle (branch or
  run), maximize (full screen) and ✕. The tab row is under it (§3.8).

---

## 3. Navigation

### 3.1 Routes and screen roles

Routes stay thin (MD-14): layout, presentation options and a re-exported feature screen. Presentation options come
from `src/ui/platform/presentation.ts` (the one place allowed to branch on OS), for example
`options={sheetOptions('turn')}`.

Paths follow the route tree in `04-screen-map.md` §1.2 (the route authority) and are relative to `app/(app)/` unless they
start with `app/`. Roles are the ML-02 `HeaderRole` values.

| Route (file) | Role | Presentation | Header |
|---|---|---|---|
| `index.tsx` (Home), `chats/index.tsx`, `projects/index.tsx`, `agents/index.tsx`, `workflows/index.tsx`, `automations/index.tsx`, `scripts/index.tsx`, `settings/index.tsx` | top | stack root (`animation: 'none'` when replaced from the sidebar) | top |
| `chats/[id]/index.tsx`, `workflows/[id]/runs/[runId]/index.tsx` (MD-80) | workspace | push | detail + pane toggle |
| every other detail page (`needs-you.tsx`, project, codebase, agent, workflow, automation, script, settings section, step detail, diff, file preview, runtime graph, stage chat) | detail | push | detail |
| `projects/[id]/skills/[configId]/edit.tsx` (full-screen mono editor, MDF-102) | modal | `fullScreenModal`, `gestureEnabled: false` | modal |
| `servers.tsx`, `scope-request.tsx`, `pickers/agent.tsx`, `pickers/model.tsx`, `chats/new.tsx`, `chats/[id]/turn.tsx`, `chats/[id]/gate/[interactionId].tsx`, `workspaces/[workspaceId]/commit.tsx`, `projects/[id]/add-codebase.tsx`, `agents/new.tsx`, `agents/import.tsx`, `workflows/[id]/run.tsx`, `workflows/[id]/runs/[runId]/approval/[stageRunId].tsx`, `workflows/[id]/edit/{validate,versions,add-stage}.tsx`, `workflows/[id]/edit/loop/[stageKey].tsx`, `automations/[id]/executions/[executionId].tsx`, `scripts/[id]/run.tsx`, `share.tsx` | sheet | `formSheet` (§3.7) | ML-10 `SheetHeader` |
| `projects/new.tsx`, `agents/create.tsx`, `agents/[id]/edit.tsx`, `workflows/new.tsx`, the `workflows/[id]/edit/` group, the `automations/new/` and `automations/[id]/edit/` groups, `settings/mcp/add.tsx` | modal | `fullScreenModal`, `gestureEnabled: false` | modal |
| `search.tsx` | palette | `fullScreenModal`, `animation: 'fade'` (MD-81) | none (the search field is the header) |
| `app/pair.tsx`, `app/revoked.tsx` | public | stack root, no chrome | none |
| `app/+native-intent.tsx`, `app/+not-found.tsx` | — | deep-link rewrite (§3.12) / "Page not found" | — |
| `app/(dev)/storybook.tsx`, `app/(dev)/theme.tsx`, `app/(dev)/notify.tsx`, `app/(dev)/live.tsx` | dev only | redirect to `/` unless `__DEV__` (08-verification.md §4) | — |

**Module switching.** Tapping a module in the sidebar calls `router.dismissAll()` then `router.replace(moduleHref)`
with no animation. One native Stack cannot keep a separate stack per module, so the MPrinciples line "the module keeps
its stack" is not built (MD-87). The sidebar's Needs-you and Running lists and the palette's recents are the
way back to a recent detail.

### 3.2 Back behaviour

| Platform | Back affordances | Order when several things are open |
|---|---|---|
| iOS | native chevron (with back-history menu on long-press), left-edge interactive pop on **detail** screens, every breadcrumb segment, hardware ⌘[ (§3.10); sheets: drag down, ✕ | a menu dismisses on tap outside; sheets and modals are native and dismiss themselves |
| Android | system Back (button or edge gesture; predictive animation **off**, §3.5), the ← arrow, breadcrumb segments, hardware Alt+← | 1 open menu or dialog (native) → 2 TrueSheet (native) → 3 route sheet or modal (native stack) → 4 pane: inner tab stack first (Tasks → task detail), then the pane itself (MD-23) → 5 modal drawer → 6 stack pop → 7 on a module root that is not Home: go to Home (MD-88) → 8 on Home: system default (app to background) |

- **Implementation.** `src/ui/platform/back.ts` exports `useBackHandler(active: boolean, handler: () => boolean)`. It
  subscribes to `BackHandler` **when `active` turns true**, so the most recently opened overlay is the first listener
  and wins (React Native calls listeners last-in, first-out). The pane, the pane's inner tab stack and the drawer each
  call it with their open flag. The module-root rule (step 7) subscribes in `useFocusEffect` on module screens and
  returns false when `navigation.canGoBack()`. Nothing else in the app touches `BackHandler`; the 4 call sites listed in
  CA §5 are replaced.
- **Deep-linked detail with no history** (cold start from a notification): the header still shows back (detail role);
  back goes to the parent route (`useHeaderNav` fallback), for a chat `/chats`.

### 3.3 Breadcrumbs

- Every detail screen builds its crumbs from its own data: `Chats › <project name>` for a chat, `Workflows ›
  <workflow> › Run #<n>` for a run, `Projects › <project> › Codebase` and so on. The crumb list is part of the screen's
  view model, not global state.
- A segment tap pops to that level if it is in the stack (`router.dismissTo`), otherwise replaces.
- Labels come from data; never from the boards' sample names (MD-27).

### 3.4 Gestures per platform (MD-19)

| Gesture | iOS | Android | Button equivalent |
|---|---|---|---|
| Open drawer from the left edge | **module screens only** (role, not stack depth), compact class only, edge strip 28 pt | **not built**: both edges are system Back | sidebar toggle |
| Left edge on a detail screen | native interactive pop (`gestureEnabled: true`, `fullScreenGestureEnabled: false`) | system Back | back arrow, breadcrumb |
| Open pane | never by gesture | never | pane toggle with count |
| Close drawer | pan inside it toward the start edge, scrim tap | same | scrim tap, Back |
| Close pane | pan from its header or the 24 pt/dp leading band toward the end edge, scrim tap | same | ✕ in the pane header, Back |
| Row swipe actions | `ReanimatedSwipeable`: leading Pin / Mark unread, trailing More / Archive; full swipe archives; never Approve or Delete (MGestures); impact light at threshold | same component, same actions | long-press menu, ⋯ on the chat, a11y custom actions |
| Long-press | native context menu (iOS `Link.Preview`/`Link.Menu` on navigable rows, `ui/native/ContextMenu` elsewhere) | Expo UI `DropdownMenu` anchored at the row + `LONG_PRESS` haptic | ⋯ menu |
| Pull to refresh | non-live lists (Home, Chats, Projects, Workflows…); not the transcript | same | Refresh in the overflow menu |
| Sheet drag | detents, below the smallest dismisses unless dirty | same; max 3 detents | ✕, grabber tap cycles detents (iOS) |
| Pinch | terminal font 10–20 (MD-38) with a selection haptic per step; workflow map zoom | same | A− / A+ in terminal settings; + / − / Fit |
| Drag to reorder | `react-native-reorderable-list`: impact light on lift, tick per slot | same | Move up / Move down in the item menu |

**Conflict rules** (SNP §2; every one is enforced in code, not left to the gesture system):

1. **One owner per edge.** On iOS module screens the drawer owns the left edge strip; on detail screens the native
   pop owns it and `SidePanel.swipeToOpen` is false. On Android no JS gesture starts at an edge. The system-gesture
   exclusion band discussed in SNP §2 is **not** built (MD-19 is button-only).
2. **Horizontal scrollers inside panels win.** Code blocks, diffs, the pane tab row, terminal key rows and horizontal
   chip strips are wrapped in `src/ui/gestures/HorizontalScrollGuard.tsx`, which declares an RNGH 3 relation that
   blocks the panel's close pan while the scroller is active (`PanelGestureContext` exposes the panel gesture). Sideways
   drags on the pane tab row scroll the tabs (MGestures).
3. **Row swipes never start in the drawer strip.** List rows on module screens use `DRAWER_EDGE_HIT_SLOP`
   (`{ left: -28 }`) so a drag that starts in the strip belongs to the drawer (today's rule).
4. **Surfaces that own keys and gestures** (terminal, browser WebView, workflow map while pinching): while focused they
   set `useShellStore.getState().setGestureOwner('surface')`. The drawer edge-open and the pane's close pan are then
   disabled; the pane closes from ✕, Back or the header only. This is the mobile twin of D-46; the same flag suspends
   hardware shortcuts (§3.10).
5. **Vertical intent fails the panel pan:** `failOffsetY: [-12, 12]`, `activeOffsetX: ±12` (today's values).

### 3.5 SidePanel on RNGH 3 (the SDK 58 port)

RNGH 3.2 (the SDK 58 pin) replaces the `Gesture.Pan()` builder with hooks. The builder still works as `Legacy*`
during the migration, but new code uses hooks only, and lint bans the builder (`no-restricted-syntax` on
`Gesture.Pan`/`Gesture.Tap`…) from M3. Port `src/components/ui/SidePanel.tsx` into `src/ui/layout/SidePanel.tsx`:

```tsx
// src/ui/layout/SidePanel/SidePanel.tsx (ML-05; shape, not final code)
const progress = useSharedValue(open ? 1 : 0);
const dragStart = useSharedValue(0);
const sign = side === 'start' ? 1 : -1;                       // RTL: flip with I18nManager.isRTL
const pan = usePanGesture({
  enabled: gesturesEnabled,                                   // false while a surface owns gestures (§3.4 rule 4)
  hitSlop: open ? closeAreaSlop : edgeStripSlop,              // closed: edge strip only (iOS module screens)
  activeOffsetX: [-12, 12],
  failOffsetY: [-12, 12],
  onBegin: () => { 'worklet'; dragStart.set(progress.get()); },
  onUpdate: (e) => { 'worklet'; progress.set(clamp(dragStart.get() + (sign * e.translationX) / width, 0, 1)); },
  onFinalize: (e) => {
    'worklet';
    const nextOpen = settleOpen(progress.get(), sign * e.velocityX);   // sidePanelMath.ts (pure, vitest)
    progress.set(reduceMotion ? (nextOpen ? 1 : 0) : withSpring(nextOpen ? 1 : 0, panelMotion.spatial));   // panelMotion = useMotion('panel')
    scheduleOnRN(onOpenChange, nextOpen);                              // react-native-worklets ≥ 0.13
  },
});
return <GestureDetector gesture={pan}>…</GestureDetector>;
```

- Callback and relation names follow the RNGH 3 upgrade guide
  (`docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrading-to-3/`); the port is a mechanical rename,
  checked against `node_modules/react-native-gesture-handler` typings.
- Shared values use `.get()` / `.set()` only (React Compiler rule, SE §1.2). No `runOnJS`; worklets 0.13 uses
  `scheduleOnRN`.
- `sidePanelMath.ts` keeps `sidePanelWidth` (now reading shell tokens), `settleOpen` (threshold 0.4) and
  `edgeStripWidth()` (iOS 28; the Android 72 branch is deleted). Its vitest file is updated in the same commit.
- `ReanimatedSwipeable`, the pinch handlers and the workflow-map pan-zoom are ported in the same M3 task, through
  `src/ui/gestures/` helpers, so no screen imports RNGH directly.

### 3.6 Predictive back (MD-20)

- `android.predictiveBackGestureEnabled: false` stays in `app.config.ts` on SDK 57 and 58. React Native 0.86 does not
  forward `OnBackInvokedDispatcher` to `BackHandler` (CA §0.9), react-native-screens v4 cannot animate it, and
  expo#39092 (Back exits the app instead of popping) is open.
- **Re-verify on every SDK bump** with `apps/mobile/.maestro/navigation/android-back.yaml` on API 36 **and** API 37
  images: push two screens, open the pane, open a sheet, then press Back five times and assert the order of §3.2.
- **Switch it on only when all hold:** react-native-screens 5 (or the SDK's stack) is stable with sheets and modals,
  expo#39092 is closed, and the flow passes on API 36 and 37 with the flag on. Play requires API 37 targets by
  August 2027, and the opt-out may stop being honoured there; the flow is the early warning.

### 3.7 Sheets and modals (MD-21)

**Route sheets (`formSheet`)** — options from `sheetOptions(kind)` in `src/ui/platform/presentation.ts`:

| Sheet | iOS options | Android options |
|---|---|---|
| Turn, model picker, agent picker, server switcher, execution detail | `presentation: 'formSheet'`, `sheetAllowedDetents: [0.5, 1]`, `sheetInitialDetentIndex: 0`, `sheetGrabberVisible: true`, `sheetExpandsWhenScrolledToEdge: true`, `sheetLargestUndimmedDetentIndex: 'none'`, `headerShown: false` | `presentation: 'formSheet'`, `sheetAllowedDetents: [0.5, 1]` (≤ 3 detents), `headerShown: false` |
| Approval (`MRunApproval`, every approval surface), run workflow, scope request | same, detents `[0.6, 1]` | same |
| New chat (large detent), commit & PR, share | `sheetAllowedDetents: [1]` | `sheetAllowedDetents: [1]` — **never** `'fitToContents'` on Android for a sheet with a text field (it does not resize for the keyboard, screens#3181) |

- Corner radius: leave the system default on iOS 26+ (concentric); Android uses the M3 28 dp top radius
  (`sheetCornerRadius` from tokens).
- **No nested stacks, no stacked sheets (MD-62).** Android form sheets cannot host a native header or a nested stack
  (SNP §1c). A second level opened from inside a sheet (New chat → agent picker → Customize capabilities, New chat →
  model picker, run sheet → per-stage overrides) swaps content inside the same sheet with a back button in the sheet
  header, on both platforms. Pickers opened from a screen are their own route sheets (`/pickers/*`); every picker
  returns its value through the owning draft store.
- If a keyboard-bearing Android sheet still fails its Maestro flow (text field covered), `sheetOptions()` switches that
  one kind to `presentation: 'modal'` and the change is recorded as an MD.

**Imperative sheets (TrueSheet 3.11 → 4 when stable).** ML-10 `Sheet` (`src/ui/native/Sheet/`) wraps
`@lodev09/react-native-true-sheet` for short option lists and forms that do not deep-link (row actions, composer
attachments, filters). The prop contract is `SheetProps` in `03-components.md` ML-10 (`title`, `detents: ('content' |
'medium' | 'large')[]`, `dirty`, `onDismiss`, `headerAction`, `back`, `footer`, `scrollable`; imperative use through
`useSheet().present()`); the wrapper maps them to TrueSheet v3 props (`sizes`,
`dismissible`, `grabber`, `FooterComponent`, `scrollRef`, `backgroundColor` from `useThemeColors()`). The v4 rename
(`detents`, `onDismissAttempt`) changes only the wrapper. Today's `src/components/ui/Sheet.tsx` (633 lines of RN Modal
+ gesture code) and `@gorhom/*` are deleted.

**Full-screen modals (`fullScreenModal`).** Agent editor, MCP add, automation create wizard, workflow builder, stage
editor, project create, new workflow. Options: `presentation: 'fullScreenModal'`, `gestureEnabled: false`. Header:
modal role (Cancel + Save). Multi-step wizards push steps inside the modal's own nested Stack (full-screen modals may
nest stacks on both platforms).

**Dirty guard** (`src/blocks/shell/useDirtyGuard.ts`, used by every sheet and modal with editable content):

```ts
useDirtyGuard(dirty: boolean, opts?: { title?: string; message?: string })
```

- On SDK 58 it uses the router's public prevent-remove API (`usePreventRemove` if exported); on 57 it listens to
  `navigation.addListener('beforeRemove', e => { if (dirty) { e.preventDefault(); confirm() } })`. Either way the iOS
  sheet swipe bounces back (react-native-screens sets `preventNativeDismiss`), Android Back is intercepted, and Cancel
  / ✕ call the same confirm.
- `confirm()` shows `ui/native/AlertDialog`: title "Discard changes?", actions "Keep editing" (default) and
  "Discard" (destructive role). After Discard: `navigation.dispatch(e.data.action)`.
- TrueSheet: `dismissible={!dirty}`; ✕ calls the same confirm. v4: `onDismissAttempt`.

**Approvals.** Every surface (run banner, run pane, stage chat card, chat card, notification, Live Activity) routes to
the **same** approval sheet (MB-50 `ApprovalSheet`, MD-21): `/chats/<id>/gate/<interactionId>` for chat gates and
`/workflows/<wid>/runs/<runId>/approval/<stageRunId>` for stage gates (`04-screen-map.md` §1.6), with `?server=<id>` from
a push or link. Risky approvals sign with the approval key there (§6.3).

### 3.8 The workspace pane (MD-23)

- **Tabs.** `DOCK_PINNED_TABS` (Changes, Files, Terminal, Browser) always; `DOCK_CONDITIONAL_TABS` (Tasks, Computer,
  Plan) only when they apply; ids from `packages/shared/src/ui-contract/pane.ts`. The run pane has its own set (Output,
  Files, Hooks, Variables, Changes, Terminal, Browser).
- **Tab row.** iOS pills (h32, r16), Android underline tabs (h48). Horizontal scroll with a fade mask. Tap-only switching
  with a selection haptic; no body swipe (MD-23).
- **Instances.** Extra terminals and browser pages are **chips inside their tab** on phones and tablets, capped by
  `DOCK_TAB_CAPS` (browser 5, terminal 4). This is the one deviation from desktop.
- **Full screen.** The maximize button animates the pane to the window width (compact/medium) or the main-column
  width (expanded). Back or ✕ close the pane.
- **Toggle.** Count = changed files in the scope. A needs-you glyph when Plan or Computer needs the user.
- **Back inside a tab** pops the tab's own stack first (Tasks → task detail), then closes the pane.
- **Deep links.** `?dock=<tab>` (`DOCK_LINK_PARAM`, parsed with `parseDockLinkTab`) opens the pane at that tab when the
  chat or run opens.
- **Persistence.** Open state and last tab per scope in MMKV through `dockStorageKeys(scope)` (per device, MD-30).

### 3.9 Search palette

- Route `app/search.tsx`, presented `fullScreenModal` with a fade. iOS: a search field (h44, `bg-selected`, r22) with a
  clear button (44 pt hit) and a glass "Close search" ✕. Android: the M3 full-screen search view header (h72, back
  arrow 48, query 18, clear 48).
- **Sources, in this order:** local commands (`COMMANDS` entries with `palette: true`), navigation
  (`NAV_DESTINATIONS`), recents (per server, MMKV), then server search (chats keyset search, workflows, automations,
  projects, runs) through `features/search/queries.ts`, debounced 200 ms.
- **Opened by:** the sidebar search field, a header search action, ⌘K / Ctrl+K (§3.10), the "Search" quick action
  (§7.6).
- **Keyboard:** arrows move the selection (`palette.next`/`palette.prev`), Enter opens (`palette.open`), Escape closes
  (`palette.close`). The selected row is `bg-selected`. Match highlighting uses weight 600, never 700 (MD-28).
- **States:** empty query → recents + commands; no results; searching (skeleton rows); offline → commands and
  navigation only, with a "Server offline" group note.
- "Toggle theme" is not offered (the mode follows the system unless Settings › Appearance overrides it).

### 3.10 Keyboard

**Software keyboard** — react-native-keyboard-controller (1.21.9 on 57, 1.22.4 on 58):

| Surface | API | Rule |
|---|---|---|
| Chat transcript + composer | `KeyboardAwareLegendList` / `useKeyboardChatComposerInset` from `@legendapp/list/keyboard`; composer inside `KeyboardStickyView` with `offset={{ closed: 0, opened: bottomInset }}` | the composer stays glued to the keyboard; the list keeps `alignItemsAtEnd`, `maintainScrollAtEnd`, `maintainVisibleContentPosition`, `recycleItems={false}`, never `inverted` (CA §8) |
| Interactive dismissal | iOS: `keyboardDismissMode="interactive"` + `KeyboardGestureArea interpolator="ios"`; Android 11+: `KeyboardGestureArea interpolator="linear"` | drag the transcript down to dismiss |
| Forms (editors, sheets) | `KeyboardAwareScrollView bottomOffset={16}`; `KeyboardToolbar` on multi-field forms | focused field always visible |
| Never | `KeyboardAvoidingView`, RN `Keyboard` event math | the controller already reports true frames (`src/ui/platform/keyboard.ts` keeps `useKeyboardHeight`) |

- Android keeps `softwareKeyboardLayoutMode: 'resize'`. Typing is never blocked (D-29); the composer states come from
  the shared reducer (MD-03).
- `KeyboardProvider` is at the root with translucent status and navigation bars (edge-to-edge).

**Hardware keyboard** (iPad, Android tablets and Chromebooks) — shortcuts come from the shared registry
`COMMANDS` (`packages/shared/src/ui-contract/commands.ts`); mobile declares none of its own bindings:

| Command id | iOS binding (from `desktopMac`) | Android binding (from `desktopWinLinux`) | Mobile action |
|---|---|---|---|
| `palette.toggle` | ⌘K | Ctrl+K | open search palette |
| `chat.new` | ⌘N | Ctrl+N | New chat sheet |
| `workflow.new` | ⇧⌘N | Ctrl+Shift+N | New workflow modal |
| `nav.home` … `nav.scripts` | ⇧⌘H, ⇧⌘C, ⇧⌘P, ⇧⌘E, ⇧⌘W, ⇧⌘A, ⇧⌘S | Ctrl+1 … Ctrl+7 | module switch |
| `app.settings` | ⌘, | Ctrl+, | Settings |
| `nav.back` | ⌘[ | Alt+Left | back (`useHeaderNav().onBack`) |
| `sidebar.toggle` | ⌘B | Ctrl+B | drawer / sidebar |
| `dock.toggle` | ⌥⌘B | Ctrl+Alt+B | pane |
| `find.open` | ⌘F | Ctrl+F | find in terminal / diff / transcript (screen-scoped) |
| `shortcuts.show` | ⌘/ | Ctrl+/ | shortcuts sheet (iPadOS also shows the ⌘-hold overlay) |
| `dock.dismiss` / `palette.close` | Escape | Escape | registered only while an overlay is open |

- Parsing uses `parseChord` from `packages/shared/src/ui-contract/keys.ts` (pure; already designed "for mobile hardware
  keyboards"). `composer.send` (Enter) / `composer.newline` (Shift+Enter) are handled by the composer's `TextInput`
  (`submitBehavior`), not by key commands.
- **Native side: `generatorai-device-key` gains key commands** (§6.3 lists all module additions):
  - `setKeyCommands(commands: { id: string; input: string; modifiers: ('cmd' | 'ctrl' | 'alt' | 'shift')[]; title: string }[]): void`
  - `setKeyCommandsSuspended(suspended: boolean): void` — true while a surface owns keys (§3.4 rule 4)
  - event `onKeyCommand: { id: string }`
  - **iOS:** a Swift `extension UIViewController { @objc func gai_handleKeyCommand(_ c: UIKeyCommand) }` forwards
    `c.propertyList as? String` to the module. Commands are `UIKeyCommand(title:image:action:input:modifierFlags:propertyList:)`
    with `discoverabilityTitle` (shown in the iPadOS ⌘-hold overlay and the iPadOS 26+ menu bar) and
    `wantsPriorityOverSystemBehavior = true`, added with `addKeyCommand(_:)` to the key window's root view controller
    of the active `UIWindowScene` (re-added on scene activation).
  - **Android:** the module wraps `activity.window.callback` with a delegating `Window.Callback` that intercepts
    `dispatchKeyEvent` (ACTION_DOWN, matching modifiers) and implements `onProvideKeyboardShortcuts` (Meta+/ helper).
    Unmatched events pass through untouched, so `TextInput` keeps every key. No `MainActivity` edits.
- `src/services/native/keyCommands.ts` builds the list from `COMMANDS`, registers it, and dispatches through the same
  command handler the palette uses. It is exercised by a vitest (binding mapping) and a batch device check.

### 3.11 Keyboard focus and pointer (tablets)

- Pressable rows and buttons show a hover state (`onHoverIn/Out`) on iPad pointers; `cursor` is set on iOS 17+.
- Android `focusable` / `nextFocus*` follow the visual order in the kit; drawer and pane keep focus inside while modal.

### 3.12 Deep links (MD-34) and notification routing

- **Scheme** `generatorai://` only; no universal links in this pass, so any app can claim the scheme and **every link
  is untrusted input**.
- **Shared allowlist.** Add `packages/shared/src/ui-contract/deepLinks.ts` (additive, logged in `COORDINATION.md`):
  `DEEP_LINK_QUERY_KEYS = ['pair', 'dock', 'tab', 'kind', 'run', 'server', 'code']` and a pure
  `deepLinkToRoute(url): string | null` equivalent to `apps/desktop/src/main/deep-link-route.ts` (desktop keeps its
  own copy until the owner merges, MD-34). `command/<id>` links resolve only for ids with `deepLink: true` in `COMMANDS`
  (today `chat.new`, `workflow.new`) and **open** the matching UI; they never perform an action.
- **Mobile entry point.** `app/+native-intent.tsx` exports expo-router's `redirectSystemPath({ path, initial })`,
  implemented in `src/blocks/shell/links.ts`:
  1. `deepLinkToRoute(path)`; `null` → `/`.
  2. `pair?code=` → `/pair?code=<code>`: the pairing screen **pre-fills** and shows the consent screen; it never
     submits by itself.
  3. `server=<id>`: if the id is not a paired server → `/` plus a toast "Link is for a server this phone isn't paired
     with". If it differs from the active server → switch the active server first (§6.7), then route.
  4. The first path segment must be in the app's route allowlist (today `src/notifications/routeGuard.ts`
     `ALLOWED_ROOTS`, moved to `src/blocks/shell/links.ts` and extended with `approval`, `search`, `share`, `new-chat`).
- **AttentionItem → route.** Add `packages/client-core/src/attention/route.ts` (additive):
  `attentionHref(item: AttentionItem, serverId: string): { pathname: string; params: Record<string, string> } | null`.
  It validates `item.href` with the shared allowlist, adds `server`, and keeps `dock`. The sidebar lists, Home,
  notifications, widgets and Live Activities all use it.
- **Notification routing.** A tap or a foreground action goes through `intentFromResponse` (today's
  `notificationCategories.ts`, extended for v2 in §7.2) → the same link resolver as step 3–4 → `router.push`. The cold
  start case uses `Notifications.getLastNotificationResponseAsync()` once the router is ready (today's behaviour).

---

## 4. OS-specific matrix

"Contract" is the shared, platform-free definition; "Implementation" is where the platform difference lives. Every
row is built as written; a difference not in this table needs an MD.

| Concern | iOS 27 | Android 17 | Contract | Implementation |
|---|---|---|---|---|
| Size classes | window width, pt | window width, dp | `sizeClassFor()`, `GEOMETRY.breakpoints` | `src/ui/platform/breakpoints.ts` |
| Header | native bar, `Stack.Toolbar` glass items, large title (top), custom title view (detail) | JS M3 top app bar 64 dp, title in bar (Home headline collapses, MD-94) | `Header.types.ts` (ML-02) | `src/ui/native/router/Header/Header.ios.tsx` / `.android.tsx`, `src/ui/layout/TopAppBar.tsx` |
| Back | chevron + edge pop on detail | system Back, predictive animation off | §3.2 order | router; `src/ui/platform/back.ts` |
| Drawer open | toggle + edge on module roots (compact) | toggle only | `SidePanel` props (ML-05) | `src/ui/layout/SidePanel/`, `src/ui/platform/gestures.ts` |
| Pane | toggle; close by header/band drag, scrim, Back, Esc | same | `PaneShell` (ML-07), `paneStore` | `src/ui/layout/PaneShell/`, `src/blocks/WorkspacePane/` (MB-42) |
| Pane tabs | pills | underline | `pane.ts` ids | ML-08 `PaneTabStrip` token set |
| Route sheets | `formSheet`, any detents, grabber, glass | `formSheet` ≤ 3 detents, no header/nested stack, no `fitToContents` with text | `sheetOptions(kind)` | `src/ui/platform/presentation.ts` |
| Imperative sheets | TrueSheet (UISheetPresentationController) | TrueSheet (BottomSheetBehavior) | `Sheet.types.ts` (ML-10) | `src/ui/native/Sheet/` |
| Editors | `fullScreenModal`, Cancel/Save in toolbar | `fullScreenModal`, JS bar ✕ + text Save (MD-85) | modal role | route options + ML-02 `Header`, ML-11 `FullScreenEditor` |
| Menus | `Link.Menu`/`Link.Preview` on navigable rows; Expo UI SwiftUI `ContextMenu`/`Menu` | Expo UI Compose `DropdownMenu` | `Menu.types.ts`, `ContextMenu.types.ts` | `src/ui/native/Menu/`, `src/ui/native/ContextMenu/` |
| Dialogs | Alert | M3 AlertDialog | `AlertDialog.types.ts` | `src/ui/native/AlertDialog/` |
| New | glass capsule h52 | extended FAB h56 | `NewAction.types.ts` (ML-09) | `src/ui/layout/NewAction/` |
| Swipe rows | `ReanimatedSwipeable` + haptic | same | actions mirrored as menu + a11y actions | `src/ui/layout/SwipeRow/` (ML-15) |
| Haptics | selection / impact / notification | `AndroidHaptics.*` with API fallbacks | `HAPTICS` concept map | `src/ui/platform/haptics.ts` |
| Glass | floating chrome only; opaque under Reduce Transparency | none (tonal surfaces) | glass tokens | `src/ui/native/GlassSurface/` (MP-38) |
| Type | Dynamic Type ramp | sp scale, per-role caps (non-linear scaling on 14+) | `Text` roles | `GEOMETRY.ios/android`, `src/ui/primitives/Text/` (MP-01) |
| Icons | SF Symbols | Material Symbols (SVG for filled, expo#46850) | icon concepts | `src/ui/primitives/Icon/` (MP-02) |
| Accent | 7 accents | 7 + System (Material You, 12+) | `resolveAccentFromSeed` | `src/theme/ThemeProvider.tsx` |
| System bars | status style by theme | edge-to-edge, nav-bar contrast | theme mode | `ThemeProvider` (+ `expo-navigation-bar` if contrast needs it) |
| Software keyboard | interactive dismissal (ios interpolator) | resize + linear interpolator (11+) | composer sticky | `src/ui/platform/keyboard.ts` |
| Hardware keys | `UIKeyCommand` on the scene root VC | wrapped `Window.Callback` | `COMMANDS`, `parseChord` | `modules/generatorai-device-key`, `src/services/native/keyCommands.ts` |
| Pointer | hover, cursor | hover on ChromeOS | kit hover state | `src/ui/primitives/Pressable/` (MP-03) |
| Deep links | `redirectSystemPath` | same | `deepLinkToRoute`, allowlist | `app/+native-intent.tsx`, `src/blocks/shell/links.ts` |
| App lock | Face ID / passcode prompt, lock overlay | BiometricPrompt / credential | `appLockState.ts` reducer | `src/services/auth/AppLock.tsx` |
| App-switcher privacy | `expo-screen-capture` `enableAppSwitcherProtectionAsync` | `setRecentsScreenshotEnabled(false)` (13+), `FLAG_SECURE` below 13 | "Hide in app switcher" pref | `src/services/native/privacy.ts` |
| Risky-approval key | Secure Enclave, `.biometryCurrentSet` (passcode fallback) | AndroidKeyStore/StrongBox, `setUserAuthenticationRequired`, BiometricPrompt `CryptoObject` | signed payload §6.3 | `modules/generatorai-device-key`, `src/services/native/approvalKey.ts` |
| Notifications | categories, auth-required actions, text reply, time-sensitive, threads, NSE redaction | channels, actions, RemoteInput, PRIVATE lock-screen visibility | `ui-contract/notifications.ts` | `src/services/notifications/*` |
| Live progress | Live Activity (expo-widgets), local updates, `staleDate` | Live Update (`ProgressStyle`, promoted ongoing) from a `specialUse` FGS | `packages/client-core/src/live/*` | `src/services/native/live/*.ios.ts`, `modules/generatorai-live` |
| Widgets | expo-widgets (WidgetKit) | expo-widgets 58 (Glance) | `WidgetSnapshot` | `src/services/native/widgets/*` (MX-03, MX-04) |
| Control / tile | Control Center `ControlWidgetButton` | Quick Settings `TileService` | `command/chat.new` link | `targets/controls/`, `modules/generatorai-live` |
| Quick actions | `UIApplicationShortcutItem` (≤ 4) | dynamic shortcuts | links | `expo-quick-actions`, `src/services/native/quickActions.ts` |
| Share in | share extension (expo-share-intent) | `ACTION_SEND` intent filters | `/share` sheet | `src/features/share/*` |
| Badges | icon badge = Needs-you count | launcher dot (+ count where supported) | `attention.counts` | `src/services/notifications/badge.ts` |
| Background | stream suspended at once; push only | stream stops when cached; kept only while a Live Update FGS runs | resume routine | `src/services/stream/lifecycle.ts` |
| Orientation / resize | all; windowed iPad (`UIRequiresFullScreen` ignored) | all; ≥ 600 dp ignores locks (API 36) | size classes | ML-17 `AdaptiveLayout` |
| Crash reporting | dSYM upload | R8 mapping upload | opt-in DSN (MD-42) | `src/services/diagnostics/crash.ts` |

---

## 5. App lifecycle, background and offline

### 5.1 What each OS does

| Situation | iOS | Android | App behaviour (both) |
|---|---|---|---|
| `inactive` (app switcher, Control Center, incoming call) | snapshot is taken | — | privacy overlay if enabled (§6.2); nothing else |
| `background` | process suspended within seconds; sockets die | process keeps running until cached or killed | iOS: `mux.suspend('background')` immediately. Android: keep only `global` + tracked-run scopes while the Live Update service runs (§7.3); otherwise suspend after a 10 s grace (cancelled if the app returns). Both: `focusManager.setFocused(false)`, write the widget snapshot, set Live Activity `staleDate` |
| Killed while backgrounded | Live Activities survive the process | the FGS keeps the process; if the user swipes the app away the service stops and the Live Update is ended with a final state | on next launch: reconcile activities (`LiveActivityFactory.getInstances()`) |
| `active` again | — | — | the resume routine (§5.2) |
| Server unreachable | — | — | `streamHealth` = `offline`; `onlineManager` offline; persisted lists render read-only; actions disabled with the reason "Server offline"; approvals are never optimistic |
| Push while backgrounded | only channel | only channel (unless the FGS is running) | notification → tap or action (§7.2) |

Background fetch and background processing are not used (`UIBackgroundModes` stays `['remote-notification']`).

### 5.2 Resume routine — `src/services/stream/lifecycle.ts`

One function, `resume(reason: 'foreground' | 'network' | 'server-switch')`, run from `AppState` → `active` and from
`streamHealth` recoveries. It is idempotent and cancels an in-flight run of itself.

1. `streamHealth.set('reconnecting')` → `ConnectionStatus` shows "Reconnecting…". Nothing shows a stale "Running".
2. `mux.resume()`: open a new connection and resubscribe every scope the mounted screens hold (the mux client already
   tracks scopes).
3. Attention: refetch the snapshot (`attention` query) and replace the reducer state; deltas with `seq` ≤ snapshot `seq`
   are dropped (client-core reducer).
4. Chats: for each mounted chat with an unfinished turn, run `turnCatchUp(chatId)` (today's `useTurnCatchUp`).
5. Runs: refetch mounted run and stage queries.
6. `focusManager.setFocused(true)`: TanStack refetches stale queries of mounted observers.
7. Live surfaces: `live.reconcile(snapshot)` updates or ends Live Activities / Live Updates whose items changed while
   suspended (§7.3); write the widget snapshot and set the badge (§5.5).
8. The first stream event sets `connected`. Failures back off 1, 2, 4, 8, 15 s (cap) and then show `offline`; a network
   change or a manual "Retry" in the banner restarts at step 1.

The app lock (§6.1) may be showing while this runs; content stays hidden until unlock, and the data is fresh when it
appears.

### 5.3 TanStack Query wiring

```ts
// src/services/stream/lifecycle.ts
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'));
  return () => sub.remove();
});
onlineManager.setEventListener((setOnline) =>
  useStreamHealth.subscribe((s) => setOnline(s.state !== 'offline')),
);
```

- **Online means "the server is reachable"**, derived from `streamHealth`, not from device connectivity: a phone on
  Wi-Fi with the server down is offline for this app. No NetInfo package is added (MD-89).
- QueryClient defaults (per server): `staleTime: 30_000`, `gcTime: 24 h` (needed for persistence), `retry: 2`,
  `refetchOnWindowFocus: true`, `networkMode: 'online'`; mutations `retry: 0`, `networkMode: 'online'`.

### 5.4 MMKV query persister

- Packages: `@tanstack/react-query-persist-client` + `@tanstack/query-sync-storage-persister` (the "MMKV persister" of
  the approach §5.8; add to the `02-design-system.md` §9 package table in the same task).
- Storage: one encrypted MMKV instance per server, `createMMKV({ id: 'rq-<serverId>', encryptionKey })`; the key is
  random, stored in SecureStore under `mmkv.rq.<serverId>`.
- Persist **only** queries marked `meta: { persist: true }` and in `success` state: chat list first page, attention
  snapshot, projects, agents, workflows, automations, scripts lists, server info, own device. Transcripts, diffs,
  terminal and browser data are never persisted.
- `maxAge: 24 h`; `buster: \`${appVersion}:${QUERY_SCHEMA_VERSION}\``; `throttleTime: 1000`.
- Unpairing a server deletes its MMKV instance and SecureStore key.

### 5.5 Badges

- Source: `attention.counts.needsYou`.
- Foreground: `Notifications.setBadgeCountAsync(sum of the last known needsYou per paired server)` on every
  `attention.counts` event and on resume.
- Background: the push payload's `badge` (the sending server's count for this device; server additive field, §7.2).
  With several servers the badge shows the last sender's count until the app is opened; this is accepted and noted.
- Android: launcher dots follow active notifications; `setBadgeCountAsync` sets a count where the launcher supports it.
- `shouldSetBadge` in the notification handler is `false`; the app owns the badge while in the foreground.

---

## 6. Security and privacy

### 6.1 App lock

- Keep `AppLockGate` and `appLockState.ts` (CA §5; move to `src/services/auth/`). Children stay mounted while locked; an
  opaque layer covers them and hides them from assistive tech.
- Lock after a cold start and after an absence longer than the grace set in Settings › App lock (Immediately, 1 min,
  5 min, 15 min). Unlock with `expo-local-authentication` (Face ID / fingerprint, passcode fallback).
- The lock and privacy overlays are drawn with tokens (`bg-surface` + brand mark); no content leaks through while the
  lock animates.

### 6.2 Privacy screen (app switcher)

| | iOS | Android |
|---|---|---|
| API | `expo-screen-capture` `enableAppSwitcherProtectionAsync(0.6)` / `disableAppSwitcherProtectionAsync()` | device-key module `setRecentsScreenshotEnabled(false)` (API 33+); below 33 `setSecureWindow(true)` (FLAG_SECURE, which also blocks screenshots) |
| When | preference "Hide content in app switcher" (default on when App lock is on) | same |
| Plus | the existing privacy overlay on `inactive` stays as a second layer | — |

`src/services/native/privacy.ts` exposes `setAppSwitcherPrivacy(enabled: boolean)` and is the only caller of both APIs.

### 6.3 Risky approvals: the biometric-gated approval key (MD-31)

**Who decides "risky".** The server, through a `risk` flag on the gate (MG-04, `05-gap-matrix.md`). Until the flag
lands, the client treats as risky: every workflow approval (stage approval), and every permission request for shell,
network or git push. The rule lives in one pure function, `isRiskyGate(gate)` in
`packages/client-core/src/gates/risk.ts` (additive), and is deleted when the server flag arrives.

**Module additions to `modules/generatorai-device-key`** (Swift + Kotlin + `src/services/native/approvalKey.ts`):

```ts
type Presence = 'biometry' | 'passcode';
generateApprovalKey(alias: string): Promise<{ publicJwk: PublicJwk; backing: KeyBacking; presence: Presence }>;
approvalKeyStatus(alias: string): Promise<'ok' | 'missing' | 'invalidated' | 'unsupported'>;
signWithPrompt(alias: string, dataBase64: string, prompt: { title: string; subtitle?: string; cancel: string }): Promise<string>; // raw r||s, base64
removeApprovalKey(alias: string): Promise<void>;
// plus, from §3.10 and §6.2:
setKeyCommands(...), setKeyCommandsSuspended(...), setRecentsScreenshotEnabled(enabled: boolean), setSecureWindow(enabled: boolean)
```

| | iOS (Swift) | Android (Kotlin) |
|---|---|---|
| Key | Secure Enclave P-256, `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`, access control `[.privateKeyUsage, .biometryCurrentSet]`; if no biometry is enrolled, `[.privateKeyUsage, .devicePasscode]` (`presence: 'passcode'`) | `KeyGenParameterSpec(PURPOSE_SIGN)`, `secp256r1`, SHA-256, `setUserAuthenticationRequired(true)`, API 30+: `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG or AUTH_DEVICE_CREDENTIAL)`; API < 30: `setUserAuthenticationValidityDurationSeconds(-1)` (biometric only); `setInvalidatedByBiometricEnrollment(true)`; `setUnlockedDeviceRequired(true)`; StrongBox first, keystore fallback, honest backing readback |
| Prompt | `LAContext` with `localizedReason` passed as `kSecUseAuthenticationContext`; `SecKeyCreateSignature` shows Face ID | `BiometricPrompt` (ReactActivity is a `FragmentActivity`) with `CryptoObject(Signature)`; allowed authenticators as above |
| Neither biometrics nor passcode | `generateApprovalKey` rejects `unsupported` | same |
| Biometrics changed | key invalidated → `approvalKeyStatus` = `invalidated` | same (`KeyPermanentlyInvalidatedException`) |

Aliases are per server: `gai.approval.<serverId>` (the DPoP key stays `gai.device.<serverId>`).

**Registration (MG-05, additive; the API contract is `05-gap-matrix.md` MG-05):** `PUT /api/auth/devices/me/approval-key` with
`{ publicJwk, keyProtection, presence, proof }`, DPoP authenticated. `proof` is `signWithPrompt` over the canonical
`{"deviceId","nonce","serverId","typ":"gai-approval-key"}` with a nonce from `POST /api/auth/approval-nonce`, so the server
knows the device holds the new key. Registration happens once
after pairing (prompted from the first risky gate or Settings › Security) and again after `invalidated`.

**Payload to sign** — canonical JSON (keys sorted, no whitespace, UTF-8), then `signWithPrompt(alias, base64(bytes),
{ title: 'Approve "<gate summary>"' })`:

```json
{"decision":"allow","deviceId":"dev_…","digest":"<b64url SHA-256 of the gate summary + detail shown>","gate":{"entityId":"<chat or run id>","id":"<interaction or stageRun id>","kind":"tool_permission"},"iat":1790412600,"nonce":"<from POST /api/auth/approval-nonce>","serverId":"<hostId>","typ":"gai-approval","v":1}
```

`kind` ∈ `tool_permission | question | plan_review | stage_approval | stage_input | computer_consent | scope_grant`;
`decision` ∈ `allow | deny | approve | reject | answer`.

**Server verification (MG-05, additive to the existing decision endpoints, e.g.
`POST /api/chats/:id/interactions/:interactionId/permission`, `POST /api/workflow-runs/:runId/stages/:stageId/approve`):**
the client adds the body field `approvalProof: { v: 1, payload, signature }` (payload as above, signature base64url). For a
risky gate the server requires it and checks, in order: the device has a registered approval key; ES256 signature over the payload bytes; `serverId`
= its own host id; `deviceId` = the DPoP principal's device; `gate.kind`/`gate.id`/`entityId` match the route;
`decision` matches the request body; the nonce was issued to this device, is unused (single use) and younger than
60 s; `|now − iat| ≤ 120 s`; optionally `digest` matches the summary it would render. Failures return 403
`APPROVAL_KEY_MISSING` / `APPROVAL_PROOF_REQUIRED` / `APPROVAL_PROOF_INVALID`. The audit log records `approval.signed` with `presence`.
Notification-action approvals of **ordinary** gates keep today's path (device unlock via `isAuthenticationRequired`)
and are recorded as "device-authenticated", not "biometric-signed" (SNP §8).

### 6.4 Step-up cache rules

| Action | Prompt | Cache |
|---|---|---|
| Risky approval | approval-key signature (§6.3) | **none**: every approval prompts; bypasses the 10-minute cache (MD-31) |
| Admin write (MD-30) | `requireStepUp` | none: each write prompts |
| Opening terminal, browser control, computer use, device revocation | `requireStepUp` | 10 minutes (today's `STEP_UP_WINDOW_MS`) |
| Ordinary approval | none in-app (the app is unlocked); device unlock for notification actions | — |

- The cache is cleared on: app background longer than the lock grace, unpair, server switch.
- A device with **no passcode**: today's `requireStepUp` resolves true. That stays for the exec surfaces, but risky
  approvals and admin writes refuse with "Set a passcode on this device to approve this" (MD-31).

### 6.5 Lock-screen redaction (MD-33)

| Surface | Rule | How |
|---|---|---|
| Notifications (Android) | the lock screen shows the redacted public version; full text only when unlocked | every channel `lockscreenVisibility: PRIVATE` (today); with a secure lock screen Android shows the public version **without action buttons**, so inline Allow is reachable only when unlocked |
| Notifications (iOS) | titles and statuses only when App lock is on; otherwise the system "Show Previews" setting decides | a Notification Service Extension (§7.2) replaces title and body with `data.redacted` when the App Group flag `privacy.redact` is true; the flag mirrors App lock |
| Notification body content | never contains code blocks or multi-line output | server keeps one-line summaries (≤ 180 chars) |
| Widgets | titles, counts and status words only | `WidgetSnapshot` has no command, path or message fields |
| Live Activity / Live Update | titles, stage names, status words, counts; tool steps as verb phrases ("Reading 3 files"), never paths or commands | `redactForLockScreen()` in the live model (§7.3) |

### 6.6 Deep links are untrusted

- Everything in §3.12, plus: a link never approves, denies, sends, deletes or runs; `pair` only pre-fills; notification
  ids pass `SAFE_ID` (today's regex); share-intent content is data and is never sent without the user pressing Send;
  `route` values from pushes and attention items go through the allowlist, never straight into `router.push`.

### 6.7 Multi-server session storage (MD-05)

| Item | Where | Key |
|---|---|---|
| Server registry (id, name, endpoints, fingerprint, addedAt, lastUsedAt) — not secret | MMKV `servers` | `servers.list`, `servers.active` |
| Session (resume credential, tokens) | SecureStore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) | `session.<serverId>.*` |
| DPoP device key | device-key module | `gai.device.<serverId>` |
| Approval key | device-key module | `gai.approval.<serverId>` |
| Query cache | encrypted MMKV | `rq-<serverId>` (+ key in SecureStore) |
| Per-device prefs that are per server (default model, dock state…) | MMKV | `srv.<serverId>.*` |
| Widgets / Live Activity snapshot | App Group (iOS), module prefs (Android) — **no credentials** | per surface (§7) |

- One `AuthenticatedClientRuntime` per paired server, created lazily and kept, so a background notification action for
  server B can sign while A is active (`getAuthenticatedFetch(serverId)`; today's `backgroundFetch.ts` becomes a map).
  Only the **active** server holds a stream.
- **Switching** (server switcher sheet, a `server=` link or a notification): close the pane and drawer, set
  `servers.active`, `ServerScope` remounts the providers below it, `router.replace('/')` (or the link target), resume
  routine with reason `server-switch`, reset the step-up cache.
- **Unpairing** one server deletes every item in the table for that id and ends its Live Activities and Live Updates.
- **No migration** of today's single-server storage (pre-release, no backward compatibility): on first launch of the
  multi-server build, legacy keys are deleted and the user pairs again.

---

## 7. System surfaces

Phase: M9 (`07-phases.md`), after the chat workspace (M6). Everything here is phase 1 (MD-32):
local updates only; no push gateway.

### 7.1 Surfaces and what is built

| Surface | Built now (MD-06) | Not built (later) |
|---|---|---|
| Notifications v2 | categories, actions, text reply, interruption levels, channels, threads, badges, redaction | per-project levels, quiet hours, digest, hide-previews-at-source (MD-06) |
| Live Activity (iOS) / Live Update (Android) | local start/update/end while the app holds the stream; `staleDate` | push-to-start/update (needs the gateway, MD-32 phase 2) |
| Widgets | Needs you, Running, Summary (+ empty state) | lock-screen accessory widgets, "Done today" until an API provides it |
| Control Center / Quick Settings | "New chat" | "Pause agents" (no server feature, MD-06) |
| Quick actions / app shortcuts | New chat, Home, Search, Run workflow… | App Intents / Siri (SDK 58 alpha; revisit when stable) |
| Share to agent | iOS share extension, Android share target | Direct Share targets |

### 7.2 Notifications v2

**Shared vocabulary.** Add `packages/shared/src/ui-contract/notifications.ts` (additive): category ids, action ids,
Android channel ids and copy, used by the server's `notificationPolicy.ts` and by the app.

| Category id | Trigger | iOS actions (options) | Android actions | Interruption (iOS) | Channel (Android) |
|---|---|---|---|---|---|
| `approval` (kept id; ordinary permission) | tool permission, not risky | `approve` "Allow once" (auth required, background); `deny` "Deny" (destructive, auth required, background); `open` "Open" (foreground) | same three | `timeSensitive` | `approvals` (MAX) |
| `approval.risky` | risky permission (§6.3) | `review` "Review in app" (foreground) only | same | `timeSensitive` | `approvals` |
| `question` | question gate | `reply` text input (`submitButtonTitle: 'Send'`, `placeholder: 'Reply to <agent>'`, auth required, background); `answer.0`…`answer.2` when the payload has options (≤ 3); `open` | `reply` (RemoteInput), options as actions, `open` | `timeSensitive` | `approvals` |
| `plan` | plan review | `open` | `open` | `timeSensitive` | `approvals` |
| `run.approval` | stage approval / input | `review` (foreground → approval sheet; signs when risky) | same | `timeSensitive` | `approvals` |
| `done` | chat or run finished | none | none | `passive` | `done` (LOW, new) |
| `failed` | run or chat failed | `open` | `open` | `active` | `failed` (HIGH) |
| `scope_request` | device scope request answered | `open` | `open` | `active` | `general` (DEFAULT, new) |

- iOS categories are registered with `Notifications.setNotificationCategoryAsync(id, actions, { categorySummaryFormat:
  '%u more', showTitle: true })` on every launch (idempotent).
- Android channels are created before the permission request (Android 13 needs a channel first). Channel importance is
  fixed after creation, so the pre-release cleanup deletes the old `approval` (legacy) and `completed` channels with
  `deleteNotificationChannelAsync` and creates `done` and `general`.
- **Time Sensitive** needs the entitlement `com.apple.developer.usernotifications.time-sensitive` (§7.9). `critical` is
  not used.
- **Grouping.** iOS `threadIdentifier` = payload `threadId` (`chat:<id>`, `run:<id>`); `done` notifications stack into
  one summary. Android: Expo Push has no group key; phase 1 relies on the system's automatic bundling (4+ notifications
  from one app).
- **Verify during the task:** the Expo Push API's `interruptionLevel` values. The server sends `'timeSensitive'`
  (`packages/core/src/services/push/ExpoPushProvider.ts:80`); if Expo expects `'time-sensitive'`, fix it server-side
  (a bug fix, logged in `COORDINATION.md`).

**Foreground presentation (required explicitly on SDK 58, which shows foreground notifications by default):**

```ts
// src/services/notifications/handler.ts
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const data = parsePushData(n.request.content.data);            // zod schema below; null if not ours
    const duplicate = data !== null && isOnScreen(data);            // same server + the chat/run/approval currently visible
    const present = data !== null && !duplicate && shouldPresent(data, readNotifyPrefs(prefs));
    return { shouldShowBanner: present, shouldShowList: present, shouldPlaySound: present && data.category !== 'done', shouldSetBadge: false };
  },
});
```

**Responses.** `addNotificationResponseReceivedListener` + `getLastNotificationResponseAsync()` (cold start) →
`intentFromResponse` (today's pure mapper, extended): `decide` (approve/deny on `approval` only, when `actions`
includes the id, the ids pass `SAFE_ID`, the server is paired and the category is not risky) → POST through
`getAuthenticatedFetch(serverId)`; `reply`/`answer.N` → the existing question-answer endpoint with `userText` or the
option id; anything else → `open` through the link resolver (§3.12). A failed background decision falls back to opening
the gate (today's rule; 409 counts as settled).

**Payload schema v2** (`data`; `packages/shared/src/ui-contract/notifications.ts` exports the zod schema; new fields are
additive fields of MG-06 on the server):

```ts
interface PushDataV2 {
  v: 2;
  serverId: string;                 // host id (MD-05) — new
  route: string;                    // allowlisted in-app route (exists)
  category: NotificationCategoryId; // exists; new ids above
  threadId: string;                 // exists
  chatId?: string; interactionId?: string; kind?: InteractionKind; actions?: string[]; // exist
  runId?: string; stageRunId?: string;                   // new
  risky?: boolean;                                       // new (MD-31 server flag)
  options?: { id: string; label: string }[];             // new, question options ≤ 3
  redacted: { title: string; body: string };             // new, lock-screen-safe copy
  counts?: { needsYou: number; running: number };        // new, for badge and widgets
}
```

Expo Push message fields the server sets (additive where new): `title`, `body`, `data`, `categoryId`, `threadId`,
`interruptionLevel`, `channelId`, `badge` (new), `mutableContent: true` (new, for the NSE), `priority`, `ttl`.

**Notification Service Extension (iOS)** — `targets/notification-service/` via `@bacons/apple-targets`
(`type: 'notification-service'`), ~40 lines of Swift: read `privacy.redact` from the App Group
`group.dev.generatorai.app` (`UserDefaults(suiteName:)`); if true, replace `title`/`body` with `data.redacted`. It
never makes network calls and holds no credentials.

### 7.3 Shared live-state model (client-core) → Live Activity and Live Update

**Model** — `packages/client-core/src/live/` (additive, React-free, vitest-covered):

```ts
export type LivePhase = 'queued' | 'running' | 'needs_you' | 'waiting' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
export interface LiveState {
  key: string;                       // `${serverId}:${entity}:${entityId}`
  serverId: string; serverName: string;
  entity: 'chat' | 'workflow_run' | 'automation_execution';
  entityId: string;
  title: string;                     // chat / workflow / automation name
  runNumber?: number;                // when the API provides it (Workflow Overhaul)
  phase: LivePhase;
  statusWord: string;                // shared status copy (MD-25): 'Needs you', 'Running'…
  step?: { index: number; count: number; label?: string };  // label is a stage name or a tool-verb phrase
  segments?: ('done' | 'current' | 'needs_you' | 'failed' | 'pending')[]; // ≤ 12, runs only
  ask?: { kind: AttentionAskKind; summary: string; risky: boolean };
  next?: string;                     // next stage name
  startedAt: string; updatedAt: string; staleAt: string;   // ISO
  deepLink: string;                  // generatorai://…?server=<id> (approval sheet when ask is set)
}
export function liveFromAttention(item: AttentionItem, server: { id: string; name: string }, now: Date): LiveState;
export function liveReducer(map: LiveMap, e: LiveEvent): LiveMap;   // attention.upsert/remove, run.stage, resumed, ended
export function liveCandidates(map: LiveMap, followed: ReadonlySet<string>, max: number): LiveState[];
export function redactForLockScreen(s: LiveState): LiveState;       // paths/commands → verb phrases (toolVerbs.ts)
export const STALE_AFTER_MS = 10 * 60_000;
```

**State machine.**

```text
(none) ─start─▶ queued ─▶ running ⇄ needs_you | waiting | paused
                              │
                              └─▶ succeeded | failed | cancelled  (terminal → end)
any non-terminal: no update for STALE_AFTER_MS → shown as stale (derived: now > staleAt), cleared by the next update
```

**Which items get a live surface** (MD-90): items the user **follows** on this device (started here, or
opened here in the last 24 h; a MMKV set), in phase `running` or `needs_you`, at most **3** at once, needs-you first,
then oldest `startedAt`. Settings › Notifications › "Live Activities" / "Live progress" turns them off.

**Update triggers:** `attention.upsert` / `attention.remove` on the global stream; run stage events while a run is
open; the resume routine's reconcile; app background (write `staleDate`). Updates are coalesced to at most one per
second per item.

**End states and dismissal:** `succeeded` / `cancelled` → end with the final state, dismissal `after(now + 15 min)`;
`failed` → `after(now + 30 min)`; unpair or "stop following" → `immediate`.

**iOS — expo-widgets Live Activity** (`src/services/native/live/liveActivity.ios.tsx`; typings checked in
`expo-widgets@57.0.21`: `createLiveActivity`, `LiveActivityFactory.start(props, url?, staleDate?)`,
`LiveActivity.update(props, staleDate?)`, `end(dismissalPolicy?, props?, contentDate?)`, `getInstances()`, `after()`):

```tsx
import { createLiveActivity, after } from 'expo-widgets';
export const RunActivity = createLiveActivity<LiveActivityProps>('RunActivity', (p, env) => {
  'widget';
  return {
    banner: <LockScreenCard p={p} stale={env.isStale} />,     // @expo/ui/swift-ui components only
    compactLeading: <Glyph p={p} />, compactTrailing: <StepText p={p} />, minimal: <Glyph p={p} />,
    expandedLeading: …, expandedTrailing: …, expandedCenter: …, expandedBottom: <Segments p={p} />,
  };
});
// start: RunActivity.start(props, state.deepLink, new Date(state.staleAt));
```

- `LiveActivityProps` = `redactForLockScreen(state)` + a small palette (`fg`, `fg2`, `warn`, `ok`, `err`, `line`) resolved
  from the current theme's literals by `useThemeColors()` (the layout runtime has no hooks and no async).
- Regions follow MLiveActivity: compact = glyph + status word (warn for Needs you) + mono "3/6" (or elapsed); minimal =
  glyph; expanded = title, #, time; gate or step line; "Review" button (deep link); stage segments; "Stage n of N ·
  kind" / "Next: …". `env.isStale` shows "Updates paused · open the app".
- The activity id per key is stored in MMKV; `getInstances()` reconciles after a relaunch.
- `Info.plist`: `NSSupportsLiveActivities` (the expo-widgets plugin adds it).

**Android 16+ — Live Update, Kotlin module `modules/generatorai-live`** (new local Expo module; Android only; JS facade
`src/services/native/live/liveUpdate.android.ts`):

```ts
isSupported(): boolean;                        // API 36+ ProgressStyle; below: plain ongoing notification with a progress bar
canPostPromoted(): Promise<boolean>;           // NotificationManager.canPostPromotedNotifications() (36.1+)
upsert(u: AndroidLiveUpdate): Promise<void>;   // starts the FGS on first call; notification id = stable hash(key)
end(key: string, final: AndroidLiveUpdate | null, timeoutMs: number): Promise<void>; // stops the FGS after the last one
endAll(): Promise<void>;
addListener('onLiveAction', (e: { key: string; action: 'review' | 'open' }) => void);
setTileSubtitle(text: string | null): void;    // Quick Settings tile (§7.5)
interface AndroidLiveUpdate {
  key: string; title: string; text: string;    // text = redacted status line
  shortCriticalText: string;                   // status-bar chip: 'Needs you 3/6'
  segments: { weight: number; state: 'done' | 'current' | 'needs_you' | 'failed' | 'pending' }[];
  progressIndex: number; tracker: 'needs_you' | 'running' | 'failed' | 'done';
  whenMs: number;                              // chronometer base (elapsed)
  deepLink: string; reviewLabel?: string;
}
```

- Kotlin: `LiveUpdateService : Service`, `foregroundServiceType="specialUse"`, started only while the app is in the
  foreground (Android 12+ forbids background FGS starts) when the first followed item becomes live. Notification:
  `NotificationCompat.Builder(ctx, "live")` + `NotificationCompat.ProgressStyle()` (androidx.core 1.17:
  `setProgressSegments`, `setProgressPoints`, `setProgressTrackerIcon`), `setRequestPromotedOngoing(true)`,
  `setShortCriticalText(…)`, `setOngoing(true)`, `setUsesChronometer(true)` + `setWhen(whenMs)`, content intent and a
  "Review" action as `PendingIntent`s for the deep link. Promotion requires a **non-colorized** notification.
- Channel `live` (LOW importance), created by the module.
- End: post the final state as a normal, dismissible notification with `setTimeoutAfter(timeoutMs)`, then
  `stopForeground(STOP_FOREGROUND_REMOVE)` when no item remains.
- While the service runs, the JS process stays alive, the mux stream keeps `global` + the tracked scopes (§5.1), and the
  reducer keeps updating the notification. `dataSync` is not used (Android 15 time limits).
- `src/services/native/live/index.ts` picks the iOS or Android implementation (MD-15: platform code in
  `services/native`), subscribes to the live model and calls start/update/end.

### 7.4 Widgets

| Widget | iOS (expo-widgets) | Android (expo-widgets 58, Glance) | Content | Tap |
|---|---|---|---|---|
| Needs you | `systemMedium` | 4×2 (`targetCellWidth: 4`, `targetCellHeight: 2`) | up to 3 items: glyph, title, status/ask summary, "Review" | item → approval deep link; header → Home |
| Running | `systemMedium` | 4×2 | up to 3: title, project or stage, elapsed (static "since hh:mm" unless a timer text is available in `@expo/ui`) | item → chat / run |
| Summary | `systemSmall` | 2×2 | Needs you / Running counts with glyph + word; empty state "Nothing needs you" | Home |

- **Data:** the app writes a `WidgetSnapshot` with `widget.updateSnapshot(props)` (expo-widgets stores it in the App
  Group `group.dev.generatorai.app`, plugin `groupIdentifier`):
  `{ serverId, serverName, updatedAt, counts: { needsYou, running }, needsYou: WidgetItem[≤3], running: WidgetItem[≤3], palette }`,
  `WidgetItem = { title, sub, glyph, startedAt?, deepLink }`. Titles and status words only (§6.5). The active server is
  shown; the footer names it and "Updated hh:mm".
- **Refresh:** on attention changes (debounced 60 s, except a transition into or out of Needs you, which writes at
  once), on background (final write), on resume. `widget.reload()` after each write. WidgetKit's daily reload budget is
  respected by the debounce. No background push refresh in phase 1.
- **Tinted / clear (iOS) and dynamic colour (Android):** layouts read `env.widgetRenderingMode`; status survives
  tinting because it is always glyph + word.
- **Android widgets** need SDK 58 (`enableAndroid: true` in the plugin); on 57 they are not built.

### 7.5 Control Center control and Quick Settings tile ("New chat")

- **iOS 18+ control** — `targets/controls/` (`@bacons/apple-targets`, `type: 'widget'`), Swift:

```swift
struct NewChatControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "dev.generatorai.app.control.new-chat") {
      ControlWidgetButton(action: OpenNewChatIntent()) { Label("New chat", systemImage: "square.and.pencil") }
    }.displayName("New chat")
  }
}
struct OpenNewChatIntent: AppIntent {
  static let title: LocalizedStringResource = "New chat"
  static let openAppWhenRun = true
  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "generatorai://command/chat.new")!))
  }
}
```

- **Android Quick Settings tile** — `NewChatTileService : TileService` in `modules/generatorai-live`. `onClick()` →
  `startActivityAndCollapse(PendingIntent)` (API 34+ form; `Intent` form below 34) with
  `generatorai://command/chat.new`; state `STATE_INACTIVE`, label "New chat", subtitle "N need you" from
  `setTileSubtitle` (last known count; title-safe). Manifest (config plugin): service with
  `android:permission="android.permission.BIND_QUICK_SETTINGS_TILE"`, intent filter
  `android.service.quicksettings.action.QS_TILE`, icon, label.

### 7.6 Quick actions and app shortcuts

- `expo-quick-actions`: `QuickActions.setItems([...])` on launch and whenever the Needs-you count changes; listener
  `QuickActions.addListener(a => openLink(a.params.href))` routed through §3.12 (not `useQuickActionRouting`, so the
  allowlist applies).

| id | Title | Subtitle | Icon (iOS SF / Android) | href |
|---|---|---|---|---|
| `new-chat` | New chat | — | `square.and.pencil` / `edit_square` | `generatorai://command/chat.new` |
| `home` | Home | "3 need you" (dynamic, omitted at 0) | `house` / `home` | `generatorai:///` |
| `search` | Search | — | `magnifyingglass` / `search` | `generatorai:///search` |
| `workflows` | Run workflow… | — | `play` / `play_arrow` | `generatorai:///search?kind=workflows` (the search palette with the Workflows group first; no new picker; `04-screen-map.md` §1.6) |

iOS allows 4 dynamic items; Android dynamic shortcuts are pinnable. Plugin: `["expo-quick-actions", { androidIcons, iosIcons }]`
with icon assets in `apps/mobile/assets/shortcuts/`.

### 7.7 Share to agent

- **Package:** `expo-share-intent` (gated on a release whose peer range matches the SDK in use; its 8.0.1 declares
  `expo ^57`). **Fallback** if no SDK 58 release exists when this task starts: an `@bacons/apple-targets` share
  extension that writes the payload to the App Group and opens `generatorai:///share?id=<uuid>`, plus Android
  `ACTION_SEND` / `ACTION_SEND_MULTIPLE` intent filters through a local config plugin.
- **Plugin options:** `iosActivationRules` (text, 1 web URL, ≤ 5 images, ≤ 5 files), `androidIntentFilters`
  (`text/*`, `image/*`, `application/*`), `androidMultiIntentFilters` (`image/*`, `application/*`), App Group
  `group.dev.generatorai.app`.
- **Flow:** the extension opens the app → `/share` route sheet (MShortcuts): preview (file name mono, type, size),
  segmented Existing chat / New chat, recent chats with status (glyph + word), the chat's locked agent with the note,
  optional note field, **server row** (defaults to the last used; tapping opens the server picker — the boards' fixed
  footer is not enough with several servers), Send (the one filled button). Send uploads through the attachment ingest
  endpoint (MG-09) and opens the chat. Nothing is sent without Send.
- No credentials in the extension; the main app does all authenticated work.

### 7.8 Push gateway — later (MD-32)

Remote Live Activity updates, push-to-start and FCM data messages need a developer-operated gateway beside
`apps/relay` holding the APNs key and FCM credentials. It needs an owner decision and is not built in this pass. The
expo-widgets plugin keeps `enablePushNotifications: false` until then.

### 7.9 CNG inputs per surface (config plugins, targets, entitlements)

App Group id everywhere: `group.dev.generatorai.app` (registered in the Apple developer account by the owner; EAS
credentials sync it).

| Surface | Package / target | CNG input | iOS entitlements / Info.plist | Android manifest |
|---|---|---|---|---|
| Notifications | `expo-notifications` | plugin `{ mode: apsEnvironment }` (today) | `aps-environment`; `com.apple.developer.usernotifications.time-sensitive: true` via `ios.entitlements` | `POST_NOTIFICATIONS` (today) |
| Notification redaction | `@bacons/apple-targets` `notification-service` | `targets/notification-service/expo-target.config.js` | App Group on app + extension | — |
| Live Activities + iOS widgets | `expo-widgets` | plugin `{ groupIdentifier, enablePushNotifications: false, frequentUpdates: false, widgets: [NeedsYou, Running, Summary] }` | App Group; `NSSupportsLiveActivities` | — |
| Android widgets | `expo-widgets` (58) | `enableAndroid: true`, `android: { targetCellWidth, targetCellHeight, resizeMode }` | — | receivers (plugin) |
| Live Update + QS tile | `modules/generatorai-live` + `plugins/withGeneratorAILive.js` | local module + plugin | — | `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `POST_PROMOTED_NOTIFICATIONS`; `<service android:foregroundServiceType="specialUse">` with `<property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="Shows live progress of an agent run the user started"/>`; tile service |
| Control Center | `@bacons/apple-targets` `widget` | `targets/controls/` | — | — |
| Quick actions | `expo-quick-actions` | plugin with icons | — | — |
| Share | `expo-share-intent` (or fallback) | plugin options §7.7 | App Group | intent filters |
| Privacy screen | `expo-screen-capture` (iOS), device-key module (Android) | — | — | — |
| Approval key, key commands | `modules/generatorai-device-key` | local module | `NSFaceIDUsageDescription` (today) | `USE_BIOMETRIC` (today) |
| Apple team | — | `ios.appleTeamId` in `app.config.ts` (required by apple-targets) | — | — |

---

## 8. Build and release

### 8.1 Continuous Native Generation

- `ios/` and `android/` stay generated and git-ignored (CA §6). Every native change goes through `app.config.ts`,
  `plugins/`, `modules/` or `targets/`. After changing any of them: `npx expo prebuild --clean` (from `apps/mobile`).
  A hand edit in `ios/` or `android/` is lost by design and is never the fix.
- Stale local `ios/` and `android/` folders (CA §6 notes duplicated keys) are deleted in M1 and regenerated.

### 8.2 Config plugins: keep, add, remove

| Plugin | Action | Note |
|---|---|---|
| `expo-router` | keep | |
| `expo-splash-screen` | keep, extend | per appearance: `{ backgroundColor: <light surface>, image, dark: { backgroundColor: <dark surface>, image } }`, colours read from `@generatorai/design-tokens` in `app.config.ts` |
| `expo-secure-store`, `expo-camera`, `expo-image-picker`, `expo-local-authentication`, `expo-web-browser`, `expo-audio` | keep | shared permission strings stay (today's comments explain why) |
| `expo-notifications` | keep | + time-sensitive entitlement (§7.9) |
| `./plugins/withCleartextTraffic` | keep | LAN pairing over `http://` |
| `./plugins/withShadowNodeRaceFix` | keep until verified | at the SDK 58 upgrade, check whether RN 0.88 fixes the Fabric race; delete the plugin and its test if so |
| `./plugins/withSceneLifecycle` | **remove at SDK 58** | 58's prebuild generates `SceneDelegate.swift`; keeping both creates two scene delegates. Delete the plugin, `withSceneLifecycle.d.ts` and its vitest in the upgrade task; verify URL, user-activity and quick-action forwarding still reach the app |
| `./plugins/babel-plugin-lucide-icons.js` | rewrite or remove | lucide 1.48 exposes per-icon imports (`lucide-react-native/icons/*`); delete the plugin if direct imports are used |
| `expo-font` | add | Instrument Sans + JetBrains Mono (static on 57, variable on 58) |
| `expo-dev-client` | add | the `development` profile already assumes it |
| `expo-build-properties` | add at 58 | `android.extraProguardRules` for R8 (§8.7) |
| `expo-widgets`, `@bacons/apple-targets`, `expo-quick-actions`, `expo-share-intent` | add (M9) | §7.9 |
| `./plugins/withGeneratorAILive.js` | add | §7.9 |
| `./plugins/withA11yAuditTarget.js` | add with the first batch audit (Batch A); active only when `GAI_A11Y_AUDIT=1` | XCUITest audit target (`08-verification.md` §4.8) |
| `@sentry/react-native/expo` | add in M10 | MD-42 (§8.6) |
| NativeWind (Babel + Metro) | remove in M3 | MD-17 |

### 8.3 Dev client and fingerprint

- `expo-dev-client` (SDK-matched). Local builds for the loop: `npx expo run:ios --device gai-iphone` and
  `npx expo run:android --device gai-phone` from `apps/mobile` (device names from `apps/mobile/vrt/devices.json`).
- **Rebuild only when the native fingerprint changes.** `scripts/mobile/fingerprint.mjs` (M1):
  - `node scripts/mobile/fingerprint.mjs --platform=ios|android` computes the fingerprint with `@expo/fingerprint`
    (`createFingerprintAsync(appsMobileDir, { platforms: [platform] })`), compares it with
    `apps/mobile/.fingerprint/<platform>.json` (git-ignored, per machine), prints the changed sources, and exits **0**
    (unchanged: `agent-device metro reload` is enough) or **2** (changed: rebuild).
  - `--record` stores the current hash after a successful native build.
  - SDK 58 changes the default preset to `balanced`; re-record after the upgrade.

### 8.4 EAS profiles (`apps/mobile/eas.json`)

| Profile | Purpose | Settings |
|---|---|---|
| `development` | dev client, simulator/emulator | `developmentClient: true`, `distribution: internal`, `ios.simulator: true`, `android.buildType: apk`, `env.APS_ENVIRONMENT: development` (today) |
| `development-device` | dev client on the owner's phones | as above without `ios.simulator` |
| `e2e` | release-mode build for Maestro, perf and a11y on CI or Windows/Linux iOS runs | `extends: preview`, `ios.simulator: true`, `android.buildType: apk`, `env.EXPO_PUBLIC_E2E: "1"` (only labels the build in Settings › Diagnostics; it changes no behaviour and never bypasses a security check) |
| `preview` | internal release | today's, minus `channel` (see below) |
| `production` | store | `autoIncrement: true`, `appVersionSource: remote` (today) |

`channel` keys do nothing without `expo-updates` (CA §6); remove them in M1 and add them back with the updates policy.

### 8.5 expo-updates policy

Not added during the redesign. At M10 the owner decides. If adopted: `runtimeVersion: { policy: 'fingerprint' }`,
channels `preview` / `production`, `updates.checkAutomatically: 'ON_LOAD'`, code signing
(`updates.codeSigningCertificate` + `codeSigningMetadata`), Hermes bytecode diffing (default), and an OTA is never used
for a change whose fingerprint differs from the store build.

### 8.6 Crash reporting (MD-42, M10)

**Built in M10-06 (MD-197)** as below; the owner verifies against a test DSN (`reviews/M10-notes.md` §4).

- `@sentry/react-native` (Sentry-compatible: works with self-hosted Sentry or GlitchTip). **Off by default.**
  Settings › Diagnostics has a DSN field and an "Send crash reports" switch; `Sentry.init` runs only when both are set,
  with `sendDefaultPii: false`, a `beforeSend` that strips URLs' query strings, message text, paths and breadcrumbs'
  data, and `enableNative: true`. Native crashes before JS init are not captured (accepted).
- Release symbols: dSYM upload (Xcode build phase from the Sentry Expo plugin) and the R8 mapping upload (Sentry
  Gradle plugin) run only when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` and `SENTRY_URL` are set in the EAS
  environment; otherwise builds succeed without upload.

### 8.7 SDK 58 changes to handle (the M3 upgrade task)

| Change | Action |
|---|---|
| RNGH 2 → 3.2 (hook API) | port `SidePanel`, swipe rows, pinch/pan-zoom (§3.5); lint bans the builder API in new code |
| expo-router navigation core rework; forked React Navigation API mostly removed; dispatch deferred until after commit | no imports from `expo-router/react-navigation`; never navigate during render; `activityEnabled` replaces `freezeOnBlur`; re-check `useDirtyGuard`'s prevent-remove API (§3.7); re-run all navigation flows |
| `Stack.Toolbar`, native tabs stable; `@expo/ui` and `expo-symbols` optional peers | install both explicitly |
| Expo UI `<Host>` top-aligns (iOS); `HStack`/`VStack`/`GlassEffectContainer` default spacing = system; `RNHostView` loses `style` on Android (use `modifiers`) | fix inside `src/ui/native/*` wrappers only; pass `spacing={0}` where the old layout is wanted; re-run every `ui/native` story |
| Generated `SceneDelegate.swift` | remove `withSceneLifecycle` (§8.2) |
| R8 on by default in release (`android.enableMinifyInReleaseBuilds=true`) | keep rules for reflection users (check `react-native-quick-crypto`, `react-native-nitro-modules`, `react-native-mmkv`, the local modules) via `expo-build-properties`; run the release-build smoke on Android |
| Foreground notifications shown by default | explicit `setNotificationHandler` (§7.2) |
| RN 0.87 Strict TypeScript API (refs as `ViewInstance`, no deep `react-native/Libraries/*` imports), removals (`InteractionManager`, `Touchable` root export, `StatusBar` `translucent`/`backgroundColor`) | fix types; `requestIdleCallback` instead of `InteractionManager` |
| `expo-file-system` `File.write()` async | await it or use `writeSync` |
| `NODE_ENV` set before `.env` loading | `app.config.ts` reads only explicit env names (today's pattern) |
| `@expo/fingerprint` default preset `balanced` | re-record fingerprints |
| Node ≥ 22.13 (22.x) or ≥ 24.3 | `node scripts/mobile/doctor.mjs` checks it |
| react-native-webview 13 → 14, keyboard-controller 1.22, Reanimated 4.7 / worklets 0.13 | terminal and browser flows; `.get()/.set()`; `scheduleOnRN` |
| Metro monorepo auto-config | remove the manual `watchFolders`/`nodeModulesPaths`/`disableHierarchicalLookup` keys, keep the three real resolver rules (SE §7.3) |

### 8.8 Store compliance checklist (M10; each line is a task item with evidence)

**iOS / App Store**
- [ ] Built with the Xcode 27 / iOS 27 SDK; scene lifecycle (SDK 58 generated); Liquid Glass (no opt-out).
- [ ] `ios.privacyManifests` in `app.config.ts`: `NSPrivacyAccessedAPICategoryUserDefaults` (`CA92.1`),
      `NSPrivacyAccessedAPICategoryFileTimestamp` (`C617.1`), `NSPrivacyAccessedAPICategorySystemBootTime` (`35F9.1`),
      `NSPrivacyAccessedAPICategoryDiskSpace` (`E174.1`) if any dependency uses it; `NSPrivacyTracking: false`; collected
      data types: none by the developer, plus "Crash Data" (not linked, App Functionality) only because MD-42 exists.
      Verify against each pod's own privacy manifest in the build.
- [ ] Entitlements: `aps-environment` (production for distribution), App Groups (app + extensions), time-sensitive
      notifications.
- [ ] Info.plist strings: camera, microphone, Face ID, local network (today's reviewed strings); `NSSupportsLiveActivities`.
- [ ] `ITSAppUsesNonExemptEncryption: true` (today) and the export-compliance answers in App Store Connect.
- [ ] App icon: an Icon Composer `.icon` file (`ios.icon: './assets/app.icon'`) giving light, dark, tinted and clear;
      fallback `ios.icon: { light, dark, tinted }` PNGs (1024, opaque light).
- [ ] Splash per appearance (§8.2).
- [ ] **App Review access:** the app is unusable without a paired server. The owner runs a reviewer demo server
      (a seeded server with the Faux harness is acceptable) and writes review notes: open the demo server's web UI,
      sign in with the demo account, Settings › Devices › Pair a device, scan the QR (pairing codes expire in ≤ 10
      minutes, so the reviewer mints their own). Include a screen recording.

**Android / Google Play**
- [ ] `targetSdk` 36 now (37 required by August 2027); edge-to-edge; large-screen resizability (≥ 600 dp ignores
      orientation locks).
- [ ] 16 KB page alignment: `"$ANDROID_HOME/build-tools/36.0.0/zipalign" -c -P 16 -v 4 <app-release.apk>` passes for
      every `.so` (quick-crypto, MMKV, nitro, Hermes).
- [ ] Data Safety form (owner): data is sent only to the user's own server; declare it as the owner decides after
      reading Play's definitions; not all LAN traffic is encrypted in transit (`http://` on the LAN).
- [ ] Foreground-service declaration for `specialUse` (Live Update) with the justification text and a short video.
- [ ] Permissions: `POST_NOTIFICATIONS`, `USE_BIOMETRIC`, `CAMERA`, `RECORD_AUDIO`, `FOREGROUND_SERVICE(_SPECIAL_USE)`,
      `POST_PROMOTED_NOTIFICATIONS`; nothing else.
- [ ] Adaptive icon with `monochromeImage` (themed icons); splash per appearance.
- [ ] R8 mapping retained per release (for MD-42 symbolication).
- [ ] Large-screen quality checklist (tablet layouts, keyboard, resizing) evidenced by the batch shots.

---

## 9. Decisions taken here (recorded in `01-decisions.md`)

The plan was silent on these; each follows from the MDs and the code, and each is now a binding entry in
`01-decisions.md`.

| MD | Decision | Derived from |
|---|---|---|
| MD-86 | Router **presentational** exports (`Stack.Screen` options, `Stack.Title`, `Stack.Toolbar*`, `Stack.SearchBar`, `Link.Preview`, `Link.Menu`, `Link.AppleZoom`) may be imported in `src/ui/native/router/**` only; router hooks and `router` stay banned in `ui/`. | MD-14, MD-15, MD-16 (iOS header is native and must live in `ui/` platform files) |
| MD-87 | A sidebar module switch resets the Stack to that module's root; the per-module stack of MPrinciples is not built. | MD-18 (one native Stack), SNP §1a |
| MD-88 | Android Back on a module root other than Home goes to Home; on Home it backgrounds the app. | boards-core §C.5 left it open; M3 convention |
| MD-89 | `onlineManager` follows server reachability (`streamHealth`), not device connectivity; no NetInfo package. | MD-17 package list; the app's real dependency is its server |
| MD-90 | Live Activities / Live Updates are started for items the user follows on this device, max 3, needs-you first; succeeded/cancelled end after 15 min, failed after 30 min. | MD-32, MLiveActivity "end states not drawn" |
| MD-91 | Interactive kit components make the `Pressable` itself ≥ 44 pt / 48 dp (the drawn element may be smaller inside it); `hitSlop` only as a last resort, each use listed in `apps/mobile/e2e/a11y-allow.json`. | MD-28; lets the accessibility snapshot measure real targets (`08-verification.md` §4.1) |
| MD-92 | iOS notification redaction when App lock is on uses a Notification Service Extension reading an App Group flag; Android relies on `PRIVATE` channels. | MD-33, MD-06 (no at-source hiding) |
| MD-93 | Pull to refresh on both platforms for non-live lists (the board draws only Android). | MGestures issue list |
