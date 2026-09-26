# 06 — Desktop and app shell

Technical design for the app frame (sidebar, rail, main card, title strip, LegacyHeader, router split, Settings route), the Electron window chrome on each OS, the native browser view overlay contract, the shortcut and command registry, the single theme writer, the static desktop pages, and the tray, menu, deep link and updater surfaces.

Binding decisions: D-04, D-19, D-21 … D-27, D-37 in `01-decisions.md`. Where this document finds a decision wrong against the code, it says so in §11 and still gives a concrete implementation. Line numbers refer to `desktop_redesign @ a83a7bf`. Design boards in `docs/redesign/boards/web/` are reference data only.

Owner rules that apply to every item here:
- **Cross-platform.** Per-OS differences go through `apps/desktop/src/main/platform.ts` in main and through `<html>` platform classes in the web app. A fix must never correct only the OS it was tested on.
- **No backward compatibility.** Storage keys, IPC channels and CSS variables are renamed outright. There are no aliases or migration shims.
- **Verification.** Drive the real app. Web: `node_modules/.bin/playwright-cli --browser=chrome --headed`. Desktop: the `_electron.launch` smokes in `agent-tests/`.

---

## 1. Current state

### 1.1 How the SPA is loaded

| Mode | Selected by | URL the window loads | Server | Notes |
|---|---|---|---|---|
| **dev** | `DESKTOP_DEV_SERVER_URL` env (`index.ts:33-34`) | Vite dev server (`index.ts:243-245`) | external, not managed | CSP floor off (`index.ts:309`, `cspFloor: mode !== 'dev'`) because Vite needs inline HMR scripts |
| **remote** | `resolveTarget(settings.servers)` returns `mode: 'remote'` (`index.ts:219,246-254`) | the remote server's origin | the embedded server still starts in the background | the native browser is disabled (`ipc.ts:299-301`: `available` requires `serverMode === 'embedded'`) |
| **embedded** (default) | otherwise (`index.ts:255-286`) | `sm.url` = `http://127.0.0.1:<port>`. The server serves the built SPA from the same origin. | child process | `lastServerPort` (`config.ts:31-40`) keeps the origin, and therefore localStorage, stable between launches |

The window is created once (`window-manager.ts:103-274`). A backend switch or a server restart calls `repointMainWindow()` (`:286-300`), which runs `loadURL` on the **same** `BrowserWindow`. A first-launch splash (`showSplash`, `:75-94`) closes on `ready-to-show`. Failures load `resources/error.html?message=…` (`:314-336`).

### 1.2 Window options per OS

| | macOS | Windows | Linux (default) | Linux with `GENERATORAI_LINUX_CUSTOM_TITLEBAR=1` |
|---|---|---|---|---|
| `useCustomTitleBar()` (`platform.ts:63-66`) | true | true | **false** | true |
| Frame options (`platform.ts:79-102`) | `titleBarStyle: 'hiddenInset'`, `trafficLightPosition {x:16, y:(40−12)/2=14}` | `titleBarStyle: 'hidden'`, `titleBarOverlay {color:'#00000000', symbolColor, height: 40}` | `{}` (native frame and menu bar) | same as Windows (WCO) |
| `autoHideMenuBar` (`window-manager.ts:125`) | n/a | true | false | true |
| `backgroundColor` (`window-manager.ts:69-73`) | `#0d1117` / `#ffffff` from `settings.theme` + `nativeTheme` | same | same | same |
| min size | 860×560 (`:116-117`); restored bounds clamped to **940×600** (`:504`) | same | same | same |

`windowChrome()` (`platform.ts:105-115`) sends `{platform, titleBarStyle: 'hidden-inset'|'overlay'|'native', titleBarHeight: 40|0, insetLeft: 78|0, insetRight: 138|0, isWayland}` to the renderer.

### 1.3 Title bar and inset mechanics

- `useDesktopIntegration()` (`apps/web/src/hooks/useDesktopIntegration.ts:68-83`) calls `getWindowChrome` asynchronously **after** React mounts. It then runs `applyChromeToDocument` (`lib/desktop.ts:106-120`), which sets the classes `platform-*`, `desktop-shell`, `custom-titlebar`, `titlebar-overlay` and `titlebar-inset`, plus the variables `--titlebar-height` and `--titlebar-inset-left/right` on `<html>`, and then `trackWindowControlsOverlay` (`:161-200`). The first frame is therefore laid out without the title bar, which then appears and shifts the page.
- `AppLayout` (`components/layout/AppLayout.tsx:90-143`) stacks `TitleBar` (a full-width 40px drag strip with a centred "GeneratorAI" label, `TitleBar.tsx:25-43`) over `[aside 240px | Header 40px + <main><Outlet/></main>]`.
- CSS in `globals.css:5207-5270`:
  - `.app-drag-region` sets `app-region: drag`.
  - Interactive descendants are set to `no-drag`.
  - `.custom-titlebar .app-titlebar` reserves the inset through padding.
  - `.window-blurred .app-titlebar` dims the strip.
- Window state arrives through `onWindowStateChanged` (`useDesktopIntegration.ts:87-96`), which toggles `window-fullscreen`, `window-maximized` and `window-blurred`. `applyFullscreenInsets` zeroes the mac inset in fullscreen.

### 1.4 IPC surface (renderer ↔ main)

**Invoke channels.** Defined in `shared/ipc.ts:100-134`, handled in `main/ipc.ts`, all behind `createIpcGuard`:
- app and server: `getAppInfo`, `getServerStatus`, `restartServer`
- files: `selectDirectory`, `selectFile`, `saveFile`, `openExternal`, `showItemInFolder`
- theme: `getTheme`, `setTheme` (not called by the web app)
- settings: `getSetting`, `setSetting`
- window: `reload`, `toggleDevtools`, `findInPage`, `stopFindInPage`, `requestPairingCode`, `getWindowChrome`, `setMenuState`, `windowMaximizeToggle`, `windowIsMaximized`
- native browser: `desktop:browser:*`, registered only when the native browser flag is on (`ipc.ts:303-409`)

**Events, main → renderer** (`:153-169`):
- `navigate` is never sent. Main navigates with `executeJavaScript(pushState + popstate)` instead (`window-manager.ts:353-367`).
- `server-status`, `command` (`DesktopCommand`, `:185-199`), `theme-changed`, `theme-preference-changed`, `window-state-changed`, `found-in-page`.

### 1.5 Defects found while auditing (inputs to this plan)

1. **Theme is written in four places.**
   - `ThemeProvider.tsx:136-169` writes `<html>`.
   - `useDesktopIntegration.ts:184-190` toggles only the `dark` class on the OS change event.
   - `menu.ts:380-389` sets `nativeTheme.themeSource` and persists the setting.
   - `ipc.ts:242-246` handles `setTheme`.

   The renderer's mode is never pushed to `nativeTheme` (`setMenuState` only moves the menu radio, `ipc.ts:223`). Two failures follow:
   - Choose Light in the native menu, then "System" in the app. The renderer's `prefers-color-scheme` stays light even when the OS is dark.
   - The WCO symbol colour follows the OS (`platform.ts:69-71`), not the app, so app-dark on OS-light gives dark-on-dark caption glyphs.
2. **Dead or wrong commands.**
   - `show-shortcuts` and `reload-scripts` dispatch `CustomEvent`s nobody listens to (`useDesktopIntegration.ts:117-118,132-133`).
   - Nothing sends `focus-search`.
   - `new-chat` goes to `/chats` (`:120-121`). The URL that opens the create dialog is `/chats?new=1` (`CommandPalette.tsx:43`, `ChatsListPage.tsx:41`).
3. **`IPC_EVENT.navigate` is never sent.** Native navigation is `pushState` without state, so it cannot carry a background location (D-26).
4. **Toasts never hide the native view.** sonner 2.0.7 renders each toast as `li[data-sonner-toast]` inside a 0px-tall `ol[data-sonner-toaster]`. `NativeBrowserView.tsx:66-67` matches a non-existent `.sonner-toast` class, and the `ol` is dropped by the `<4px` check at `:82`.
5. **Hard-coded GitHub background colours** (`window-manager.ts:72`, `prompt-window.ts:44`, all static pages) flash the wrong colour at launch for every theme.
6. **Smokes already drift from the code.**
   - `desktop-chrome-smoke.mjs:103` asserts there is no Server menu, but `menu.ts:375` builds one.
   - `e2e/navigation.spec.ts:44,55-83` expects nav buttons and a Settings modal. The sidebar renders links and Settings is a routed page.
   - `right-pane-desktop-smoke.mjs:35` launches with `--remote-debugging-port`, which `check-no-app-wide-cdp.mjs` does not scan.
7. **Updates prompt with a modal dialog** (`updater.ts:46-55`). The design wants a pill.
8. **Minimum sizes disagree:** `sanitizeBounds` clamps to 940×600 (`window-manager.ts:504`), while `minWidth/minHeight` is 860×560.

---

## 2. Target shell architecture (web)

### 2.1 Component tree

```
main.tsx
└─ <App>                                   apps/web/src/App.tsx (kept, trimmed)
   └─ <ThemeProvider>                      single appearance writer (§6)
      └─ <QueryProvider> <PlatformProvider>
         ├─ <AuthGate>
         │   └─ <RouterProvider router>    app/router.tsx: [{ path: '*', element: <ShellRoute/>, errorElement: <RouteErrorGate/> }]
         └─ <Toaster/>                     ui/primitives/Toaster (sonner, restyled, D-30)

<ShellRoute>                               app/shell/ShellRoute.tsx — wiring only, no markup of its own
├─ useDesktopBridge()                      replaces hooks/useDesktopIntegration.ts (§3.6, §5.4, §6)
├─ useCommandHost()                        registry handlers + key listener (§5.4)
├─ <AppFrame layout mode>                  ui/shell/AppFrame        data-testid="app-frame"
│  ├─ <TitleStrip/>   (layout==='strip')   ui/shell/TitleStrip      data-testid="titlestrip"
│  └─ <FrameBody>
│     ├─ <ConnectedSidebar/> (mode expanded)  → ui/shell/Sidebar    data-testid="sidebar"
│     │  or <ConnectedRail/> (mode rail)      → ui/shell/Rail       data-testid="rail"
│     └─ <MainCard>                         ui/shell/MainCard        data-testid="main-card"
│        └─ {useRoutes(PAGE_ROUTES, pageLocation)}
│           └─ <RouteSlot handle>           app/routes/RouteSlot.tsx
│              ├─ <LegacyHeader/>  (handle.legacyHeader)             data-testid="legacy-header"
│              └─ <PageErrorBoundary><Suspense> page </Suspense></PageErrorBoundary>
│                 └─ ported page = <PageHeader/> (data-testid="page-header") + body
│                    └─ Workspace template (chat, run) → <DockFrame/> data-testid="dock" | "dock-sheet"
├─ <SidebarFlyout/>  (rail mode, Expand pressed while forced)  data-gai-overlay="sheet"
├─ <SidebarDrawer/>  (viewport < 768)                          data-gai-overlay="sheet"
├─ <CommandPalette/>                        app/shell/CommandPalette (Base UI Autocomplete in Dialog)
├─ <SettingsModalRoute/>                    P6: renders when the location matches /settings/:section?
├─ <ShortcutsSheet/>                        opened by `shortcuts.show`
└─ <FindBar/>                               desktop only (D-32 restyle, no behaviour change)
```

`ui/shell/*` components are presentational (D-04): props and slots only. `app/shell/Connected*` read the stores (`shellStore`, `dockStore`, the attention feed from `client-core`, the connection store, and the desktop update state) and pass props down. The dock is rendered **by the page** through the Workspace template, not by `AppFrame`. It lives inside the main card (D-27), and its content is page data.

### 2.2 Where state lives

| State | Store / owner | Persisted | Notes |
|---|---|---|---|
| Sidebar preference `'expanded' \| 'rail'` | `stores/shellStore.ts` (**renamed** from `uiStore.ts`) | `generatorai:shell` → `{ sidebarPref }` | set by the collapse and expand buttons, the `sidebar.toggle` command and the strip toggle |
| Sidebar flyout open (forced rail) | `shellStore.flyoutOpen` | no | closes on navigation, Esc and outside click |
| Palette open, shortcuts sheet open | `shellStore.paletteOpen`, `shellStore.shortcutsOpen` | no | |
| Effective sidebar mode | derived hook `app/shell/useSidebarMode.ts` | — | §2.5 |
| Dock controller `{open, toggle} \| null` | `stores/dockStore.ts` (**renamed** from `rightPaneStore.ts` in P4; P3 keeps the old name) | no | registered by `DockFrame`, and by the legacy `RightPane` until WorkflowRunPageV2 is ported |
| Dock layout (width, open, active tab, tab list) | `DockFrame` via react-resizable-panels `useDefaultLayout` plus a small per-page JSON | see the key table | D-27 |
| Appearance (mode, theme, accent, density, fontSize, reduceMotion) | `ThemeProvider` | six `generatorai-*` keys (D-51) | §6 |
| Settings section | `settingsUiStore.section` | no | `openSettings()` now carries a background location (§2.4) |
| Window chrome, window state | `<html>` classes and CSS variables | no | written by `useDesktopBridge` and the pre-paint script |

**localStorage keys, current → target.** No backward compatibility: dropped keys are simply no longer read, so their users get defaults once.

| Current key | Written by | Target |
|---|---|---|
| `generatorai:ui` `{sidebarOpen}` | `uiStore.ts:31` | **renamed** `generatorai:shell` `{sidebarPref: 'expanded'\|'rail'}` (P3) |
| `generatorai-theme`, `generatorai-theme-palette`, `generatorai-accent` | `design-tokens/src/registry.ts:53-55`, `index.html:21-23` | **kept** as three of six separate keys (D-51, `02` §11.1): `generatorai-theme` (mode), `generatorai-theme-palette`, `generatorai-accent`, plus `generatorai-density`, `generatorai-font-size`, `generatorai-reduce-motion` (`*_STORAGE_KEY` in `registry.ts`). An earlier draft of this row proposed one JSON key `generatorai:appearance`; it was not built. |
| `generatorai:rightPane:chat:open` | `ChatPage.tsx:359` via `useRightPaneOpen` | **renamed** `generatorai:dock:chat:open` (P4) |
| `generatorai:rightPane:chat:<chatId>` (tabs) | `RightPane.tsx:346` | **renamed** `generatorai:dock:chat:<chatId>` (P4) |
| `generatorai:rightPane:chat:width` | `useResizablePane` | **dropped**; replaced by the react-resizable-panels layout key `generatorai:dock:chat:layout` (P4) |
| `generatorai:rightPane:workflow-run[:…]` | `WorkflowRunPageV2.tsx:127,144,596` | unchanged until the run page is ported (PW / D-35). Then `generatorai:dock:run:*`. |
| `generatorai:browserTabUrls:*`, terminal sid keys, `generatorai:browser:webInteractivity`, `generatorai:terminal:*`, `generatorai:chat:changesTray:open`, `generatorai:projects:view`, `generatorai:*Prefs`, `generatorai:defaultChatModel`, `generatorai:usage:*` | panels and pages | unchanged by the shell. Page docs own them. |
| `generatorai-endpoint`, `generatorai-api-key`, auth catalog and session keys | `platform/authRuntime.ts` | unchanged (auth) |

Desktop `settings.json` (`main/config.ts`):
- `theme` is **replaced** by `appearance: { mode, themeId, groundLight, groundDark, fgLight, fgDark }` (§6.4).
- `'theme'` is removed from `RENDERER_SETTING_KEYS`.
- `window` is unchanged.

### 2.3 LegacyHeader (D-21)

**Mechanism.** Every page route is declared with `defineRoute()` (`app/routes/defineRoute.tsx`):

```ts
export interface GaiRouteHandle {
  /** Render the old global Header (components/layout/Header.tsx) above the page. Removed per route as it is ported. */
  legacyHeader?: boolean;
  /** Collapse the sidebar to the rail at every width (workflow builder). */
  forceRail?: boolean;
  /** Page name for PageErrorBoundary / Suspense and File ▸ Open Recent fallback labels. */
  name: string;
}
export function defineRoute(path: string | undefined, load: () => Promise<{ default: ComponentType }>, handle: GaiRouteHandle, index = false): RouteObject {
  const Page = lazy(load);
  return { path, index, handle, element: <RouteSlot handle={handle}><Page /></RouteSlot> };
}
```

`RouteSlot` replaces `withBoundary()` (`router.tsx:14-20`). It renders `{handle.legacyHeader && <LegacyHeader/>}`, then `PageErrorBoundary > Suspense > page`. Because it sits **inside** the `useRoutes` tree, `Header.tsx:36`'s `useParams()` still resolves `:id`. Next to `useRoutes`, it would only see `{'*': …}`.

**`LegacyHeader`** (`app/shell/LegacyHeader.tsx`) is `<div data-testid="legacy-header" data-drag-region="mac">` wrapping `<Header/>`. `Header.tsx` changes in P3, and is deleted in P7:
- **Remove** the `header-toggle-sidebar` button and its props (`:101-114`). The rail replaces it.
- **Remove** the theme cycle button (`:184-203`). It moves to the palette and Settings.
- **Remove** `ConnectionStatus` (`:154`). It moves to the sidebar footer.
- **Relabel** "Dashboard" to "Home" (`:118`).
- **Keep** the breadcrumb, status badge, `OpenInEditorButton`, Archive, and the side-pane toggle (`:207-230`).

**Route handles at P3** (`legacyHeader` removed as each page ports):

| Route | P3 handle | Ported in |
|---|---|---|
| `/` (DashboardPage, later Home) | `legacyHeader` | P5 (Home, needs the D-36 feed) |
| `/chats` | — (ChatsList ported, own PageHeader) | P3 |
| `/chats/:id` | `legacyHeader` | P4 |
| `/projects*`, `/agents*`, `/scripts*`, `/automations*`, `/workflows`, `/workflows/:id` | `legacyHeader` | P5 / PW |
| `/workflows/new`, `/workflows/:id/edit` | `legacyHeader`, `forceRail` | PW |
| `/workflows/:id/runs/:runId` | `legacyHeader` | PW |
| `/settings`, `/settings/:section` | `legacyHeader` (page) | P6 (becomes the modal; removed from `PAGE_ROUTES`) |
| `*` 404 | — (Gate-style layout, D-32) | P3 |

**Mac inset in legacy pages.** `LegacyHeader` gets the same CSS as `PageHeader`: drag region and leading inset (§3.7). The rail-mode traffic lights are therefore never covered by legacy breadcrumbs.

### 2.4 Router split and the Settings modal route

Proposed files. The route split lands in P1 with no behaviour change. `router.tsx` today is one 105-line file and a known merge hotspot.

```
apps/web/src/app/
  router.tsx                   createBrowserRouter([{ path: '*', element: <ShellRoute/>, errorElement: <RouteErrorGate/> }])
  routes/
    defineRoute.tsx            defineRoute(), GaiRouteHandle, RouteSlot
    index.ts                   export const PAGE_ROUTES: RouteObject[] = [...home, ...chats, ...projects, ...agents,
                               ...workflows, ...automations, ...scripts, ...settingsPage /* until P6 */, notFound]
    home.routes.tsx            '/'                         (DashboardPage → features/home/HomePage in P5)
    chats.routes.tsx           'chats', 'chats/:id'
    projects.routes.tsx        'projects', 'projects/new', 'projects/:id', 'projects/:id/codebases/:cid',
                               'projects/:id/codebases/:cid/pull-requests/:number'
    agents.routes.tsx          'agents', 'agents/new', 'agents/:id'
    workflows.routes.tsx       'workflows', 'workflows/new', 'workflows/:id', 'workflows/:id/edit', 'workflows/:id/runs/:runId'
    automations.routes.tsx     'automations', 'automations/new', 'automations/:id'
    scripts.routes.tsx         'scripts', 'scripts/:id'
    settings.routes.tsx        P1–P5: page routes; P6: SETTINGS_PATTERN = '/settings/:section?' + <SettingsModalRoute/>
    notFound.routes.tsx        '*'
  shell/
    ShellRoute.tsx  LegacyHeader.tsx  ConnectedSidebar.tsx  ConnectedRail.tsx  ConnectedTitleStrip.tsx
    useSidebarMode.ts  useDesktopBridge.ts  useCommandHost.ts  CommandPalette.tsx  ShortcutsSheet.tsx
    overlayNavigation.ts       isOverlayNavigation(current, next)
```

`apps/web/src/router.tsx`, `components/layout/AppLayout.tsx`, `TitleBar.tsx`, `Sidebar.tsx` and `CommandPalette.tsx` are deleted in P3. `hooks/useDesktopIntegration.ts` moves to `app/shell/useDesktopBridge.ts`. `lib/desktop.ts` stays as the bridge façade (§3.6).

**Why a `'*'` data route plus `useRoutes`.** A data router keeps `useBlocker` (`WorkflowBuilderPage.tsx:219`). `useRoutes(PAGE_ROUTES, pageLocation)` lets the main card render a location other than the URL, which the Settings modal needs. The app uses no loaders, actions or `route.lazy`. Pages use `React.lazy`, so nothing is lost. Frame-level handles (`forceRail`) come from `matchRoutes(PAGE_ROUTES, pageLocation)?.at(-1)?.route.handle`.

**Background-location Settings (D-26, lands in P6).**
- `openSettings(section?)` in `settingsUiStore.ts:88-94`:
  - Outside settings: `navigator(settingsPath(target), { state: { backgroundLocation: <current location> } })`.
  - Inside the modal: `replace: true`, keeping the same `backgroundLocation`.
  - The injected navigator becomes `(path, opts) => navigate(path, { replace, state })`.
- `ShellRoute`:
  ```ts
  const settingsMatch = matchPath('/settings/:section?', location.pathname);
  const bg = (location.state as { backgroundLocation?: Location } | null)?.backgroundLocation;
  const pageLocation = settingsMatch ? (bg ?? HOME_LOCATION) : location;   // direct load → over Home
  ```
- Close (the X button, Esc, a scrim click): `navigate(-1)` when `bg` exists and `history.state.idx > 0`. Otherwise `navigate(bg ? createPath(bg) : '/', { replace: true })`. `SettingsPage.tsx:36-66`'s `canGoBack`/Escape logic moves into the modal.
- Guard fix: `WorkflowBuilderPage.tsx:219-222`'s blocker must not fire when the Settings modal opens over the builder. Add `isOverlayNavigation(current, next)`, which is true when `next.state?.backgroundLocation?.pathname === current.pathname` or when `current` is itself an overlay location returning to its background. The blocker condition becomes `isDirty && current.pathname !== next.pathname && !isOverlayNavigation(current, next)`.
- Native and deep-link entry: the menu sends the `app.settings` command, not `nav('/settings')` (§8). `onDesktopNavigate('/settings/…')` calls `openSettings(section)`, so a deep link also opens over the current page.

**React Router 8 (D-37).** `07-phases.md` orders the upgrades (P1-U1…U5, including Vite 7 and RR8) before the router split (P1-S3), so the split imports from `react-router`. If the RR8 upgrade is ever blocked, write the split against `react-router-dom` and let the upgrade PR swap the imports.

### 2.5 Responsive rules

Constants come from `CHROME` (§3.1). Queries are exported from `hooks/useMediaQuery.ts`: `RAIL_QUERY = '(max-width: 1199.98px)'` next to the existing `NARROW_VIEWPORT_QUERY = '(max-width: 767.98px)'`.

`useSidebarMode(): 'expanded' | 'rail' | 'drawer'`
1. **Viewport below 768** gives `'drawer'`. This only happens in a browser tab, since the desktop minimum width is 860. A page-header menu button opens `SidebarDrawer`, which is today's `Drawer` behaviour (`AppLayout.tsx:94-107`).
2. **`handle.forceRail`, or a viewport below 1200,** gives `'rail'`. Expand opens `SidebarFlyout`: the 232px sidebar as an overlay (`data-gai-overlay="sheet"`). The saved preference is untouched.
3. **Otherwise** `shellStore.sidebarPref`.

`sidebar.toggle` (Mod+B, the strip toggle, the rail's Expand, the sidebar's Collapse) toggles `flyoutOpen` when the mode is forced, and `sidebarPref` otherwise.

Dock (D-27, P4):
- At 1200 and above, the dock is a resizable panel inside the main card: 480 default, 440 on runs, pixel min 360, max 60%.
- Below 1200 it is the **dock sheet**: `position:absolute; top: var(--gai-h-bar) /* 44 */; right:0; bottom:0; width:380px`, `bg-overlay`, `shadow-pop`, `role="dialog"` and **non-modal** (no backdrop, no focus trap, no `aria-modal`), with `data-gai-overlay="sheet"`. The chat column keeps a 380px gutter, per the ChatNarrow board. Inactive tabs are icon-only, and there are Maximize and Close buttons.
- On a viewport below 768, the sheet takes the full main-card width.

Main card margins, from the boards:
- `mac`, `native` and web layouts: `8px 8px 8px 0`.
- `strip` layout (Windows, Linux custom): `0 8px 8px 0`.

**Minimum window.** `CHROME.minWindow` (860×560) is used for both `minWidth/minHeight` and `sanitizeBounds`. At 860px in rail mode the chat column beside the sheet is about 400px.

### 2.6 Shell test IDs

These replace `app-header`, `app-titlebar` and `header-toggle-sidebar`. `sidebar-toggle` is kept as the ID of the sidebar's Collapse button.

| testid | Element |
|---|---|
| `app-frame` | AppFrame root. `data-layout="mac\|strip\|native"`, `data-sidebar="expanded\|rail\|drawer"` |
| `titlestrip` | Windows / Linux-custom 36px strip. Children: `titlestrip-back`, `titlestrip-forward`, `titlestrip-toggle-sidebar`, `titlestrip-search`, `update-pill`, `titlestrip-server` |
| `sidebar` | 232px sidebar. Children: `sidebar-traffic-row` (mac), `sidebar-nav-row` (Linux native), `sidebar-server-switcher`, `sidebar-toggle`, `sidebar-search`, `sidebar-new-chat`, `sidebar-nav` (`<nav>` of links `nav-home` … `nav-scripts`), `sidebar-needs-you`, `sidebar-running`, `sidebar-connection`, `sidebar-settings` |
| `rail` | 48px rail. Children: `rail-drag-row` (mac), `rail-server`, `rail-expand`, `rail-search`, `rail-new-chat`, `rail-nav`, `rail-running`, `rail-connection`, `rail-settings` |
| `sidebar-flyout`, `sidebar-drawer` | forced-rail flyout and phone drawer |
| `main-card` | inset card |
| `page-header` | ported page header (C-xx `PageHeader`). Contains `page-header-dock-toggle` on dock pages |
| `legacy-header` | LegacyHeader wrapper |
| `dock` / `dock-sheet` | DockFrame in panel mode / sheet mode. Children: `dock-tab-<type>`, `dock-add`, `dock-maximize`, `dock-close` |
| `command-palette`, `shortcuts-sheet`, `find-bar` (kept), `settings-modal` (P6) | overlays |

---

## 3. Window chrome per OS (D-23)

### 3.1 `CHROME` constants

New file `packages/design-tokens/src/chrome.ts`, exported from the root index **and** from a dependency-free subpath `@generatorai/design-tokens/chrome`. Add `"./chrome": { "import": "./src/chrome.ts", "types": "./src/chrome.ts" }` to `package.json` `exports`.

```ts
export const CHROME = {
  sidebarWidth: 232,
  railWidth: 48,
  railBreakpoint: 1200,           // window width below which the sidebar becomes the rail and the dock a sheet
  drawerBreakpoint: 768,
  cardMargin: 8,                  // main card inset; left margin is 0 (sidebar padding supplies the gap)
  pageHeaderHeight: 44,           // == --gai-h-bar; stays 44 in Compact density (D-15)
  dockWidth: 480, dockWidthRun: 440, dockMinWidth: 360, dockSheetWidth: 380,
  minWindow: { width: 860, height: 560 },
  mac:   { trafficRowHeight: 44, trafficLightX: 16, trafficLightSize: 12, trafficLightInset: 78 },
  strip: { height: 36, captionButtonWidth: 46, captionClusterWidth: 138, searchMaxWidth: 420, searchMinWidth: 200 },
  nativeNavRowHeight: 36,          // Linux native frame: back/forward + update pill row at the top of the sidebar
} as const;
export const trafficLightPosition = () => ({
  x: CHROME.mac.trafficLightX,
  y: (CHROME.mac.trafficRowHeight - CHROME.mac.trafficLightSize) / 2,   // 16
});
```

Also add `chromeColors(themeId: string, appearance: 'light' | 'dark'): { ground: string; fg: string }` in `src/chrome-colors.ts` (root export only). It returns `#rrggbb` computed from the same `AppearanceTokens` the CSS emitter uses, and is tested against the emitted `--gai-ground`/`--gai-fg` for all 18 themes × 2 modes. Add `annotationPalette(themeId, appearance)` next to it (§4.5).

### 3.2 Importing the TS package from the CommonJS desktop bundle

Verified on this checkout: esbuild, which tsup uses, bundles `@generatorai/design-tokens` (TypeScript source, `"type":"module"`, `exports` has only an `import` condition, internal `./x.js` specifiers pointing at `.ts` files) into a `format:'cjs', platform:'node'` bundle and runs correctly under Node. esbuild picks the `import` condition from the `import` statement, not from the output format. Required wiring:
1. `apps/desktop/package.json`: add `"@generatorai/design-tokens": "workspace:*"` and `"@generatorai/shared": "workspace:*"` to **devDependencies**, not dependencies. tsup automatically externalizes `dependencies`, and an externalized TS/ESM workspace package would be `require()`d at runtime and crash.
2. `apps/desktop/tsup.config.ts`: add `noExternal: [/^@generatorai\//]` so the bundling is explicit and survives someone moving the entry into `dependencies`.
3. Import only the subpaths `@generatorai/design-tokens/chrome` (constants), `@generatorai/design-tokens` (for `chromeColors` in main, about 30 KB bundled; acceptable) and `@generatorai/shared/ui-contract` (§5). The latter is a new, dependency-free subpath of `packages/shared` (`"./ui-contract": { import, types }`). **Never** import the `@generatorai/shared` root into main, because it pulls zod, protocol and similar packages.
4. `pnpm --filter @generatorai/desktop typecheck` must pass. Desktop's tsconfig (`strict`, `noUncheckedIndexedAccess`, `moduleResolution: bundler`) now type-checks the imported TS sources, and they must compile under it.
5. Desktop vitest resolves the packages through the pnpm symlink, so no config change is needed.

### 3.3 `apps/desktop/src/main/platform.ts` (P3)

- Delete `TITLE_BAR_HEIGHT` (`:42`), `MAC_TRAFFIC_LIGHT_INSET` (`:50`) and `WINDOW_CONTROLS_WIDTH` (`:53`). Import `CHROME` and `trafficLightPosition` from `@generatorai/design-tokens/chrome`.
- `titleBarSymbolColor()` (`:69-71`) becomes `titleBarSymbolColor(): string`, returning `appearanceMirror().fg` (§6.4). Its fallback is `chromeColors(DEFAULT_THEME, nativeTheme.shouldUseDarkColors ? 'dark' : 'light').fg`.
- `titleBarOptions()` (`:79-102`):
  - mac: `{ titleBarStyle: 'hiddenInset', trafficLightPosition: trafficLightPosition() }`, which gives `{x:16, y:16}`.
  - strip: `{ titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: titleBarSymbolColor(), height: CHROME.strip.height } }`, where height is 36.
- `windowChrome()` (`:105-115`) keeps the field names so the `<html>` classes stay as D-23 requires. The values change:
  ```ts
  titleBarStyle: !custom ? 'native' : isMac ? 'hidden-inset' : 'overlay',
  titleBarHeight: custom && !isMac ? CHROME.strip.height : 0,          // mac has no strip any more
  insetLeft:  custom && isMac  ? CHROME.mac.trafficLightInset : 0,
  insetRight: custom && !isMac ? CHROME.strip.captionClusterWidth : 0,
  ```
- `sectionAccelerator()` (`:125-127`) is deleted. Accelerators come from the registry (§5).
- `mnemonic()` stays.

### 3.4 `apps/desktop/src/main/window-manager.ts`

- `backgroundColor()` (`:69-73`) returns `appearanceMirror().ground` (§6.4). The appearance is resolved as `settings.appearance.mode === 'system' ? nativeTheme.shouldUseDarkColors : mode === 'dark'`, and the value is `groundDark` or `groundLight`. The fallback is `chromeColors(DEFAULT_THEME, …)`. It is used by the splash (`:85`), the main window (`:119`) and the bare error window (`:342`).
- New method `applyAppearance(a: AppearancePush)`:
  - `win.setBackgroundColor(resolvedGround)`
  - `refreshTitleBarTheme()`
  - The splash, if open, also gets `setBackgroundColor`.
- `refreshTitleBarTheme()` (`:413-425`) uses `CHROME.strip.height` and `titleBarSymbolColor()`.
- `minWidth/minHeight` (`:116-117`) and `sanitizeBounds` (`:504`) both use `CHROME.minWindow`.
- `navigateTo()` (`:353-367`) sends `IPC_EVENT.navigate` when `this.rendererReady` is true, and otherwise falls back to the current `executeJavaScript` pushState path. `rendererReady` is set on the first `setMenuState` from the current document. It is reset in `webContents.on('did-start-navigation', (d) => d.isMainFrame && !d.isSameDocument && …)` and in `repointMainWindow`.
- New: `webContents.on('did-navigate-in-page')` sends `IPC_EVENT.navHistoryChanged` with `{ back: wc.navigationHistory.canGoBack(), forward: wc.navigationHistory.canGoForward() }`. This feeds the enabled state of the strip and native-row back/forward buttons. Chromium is the authority here, as `menu.ts:57-70` already argues.
- Delete `sendThemePreference` (`:463-466`). It is replaced by `sendAppearanceRequest` (§6.2).
- `prompt-window.ts:44` uses `getWindowManager()` background colour logic, exported as `currentGround()`.

### 3.5 Per-OS layout

| Layout (`data-layout`) | When | Top of window | Sidebar top rows | Search | Server switcher | Back / Forward | Update pill | Drag regions |
|---|---|---|---|---|---|---|---|---|
| **mac** | `platform-darwin` + `titlebar-inset` | nothing (content to the top edge) | 44px `sidebar-traffic-row` (lights at x16 y16; row is empty except the update pill right-aligned when ready) → 40px server-switcher row (switcher + Collapse) → search + New chat row | sidebar button "Search ⌘K" | sidebar row 2 | none in UI (⌘[ / ⌘] via menu) | right end of the traffic row; in rail mode an icon button (`update-pill`, icon-only) under the running counter | traffic row, rail drag row, page header and legacy header bare areas |
| **strip** | `titlebar-overlay` (Windows; Linux with the env flag) | 36px `titlestrip`: [back][fwd][toggle] · centred search (width `clamp(200px, 100vw − 720px, 420px)`, grid `1fr auto 1fr` so it never collides) · [update pill][server chip ▾] · padding-right `var(--gai-titlebar-inset-right)` (WCO caption buttons 138×36) | "GeneratorAI" + New chat (40px), per DesktopWindows board | strip | strip chip (opens the Servers popover) | strip | strip | strip only (`app-drag-region`); page headers are **not** drag regions |
| **native** | Linux default (`native` title bar, OS frame and menu bar) **and every browser tab** | OS title bar (desktop) / browser chrome (web) | desktop only: 36px `sidebar-nav-row` [back][fwd] … [update pill]; rendered only when it has content, so **never on web**. Then server-switcher row, search + New chat row. | sidebar | sidebar | desktop: `sidebar-nav-row`; web: none (the browser has its own) | desktop: `sidebar-nav-row`; web: never (no updater) | none |

Rail per layout. The contents follow the ChatNarrow board: server button, Expand, divider, Search, New chat, divider, 7 nav icons (Home carries a needs-you dot), divider, running counter, spacer, connection dot, Settings.
- **mac**: a 44px empty `rail-drag-row` sits on top. The traffic lights overflow into the main card's header, which gets a leading inset (below).
- **strip**: no drag row (the strip is the drag region). The server button and Search are omitted because the strip holds them.
- **native**: as drawn. Back/forward live in the flyout's `sidebar-nav-row`.

Mac rail inset. The lights end at x≈68, and 78 includes breathing room. The rail is 48 wide and the main card's left margin is 0 on every board (DesktopMac `margin:8px 8px 8px 0`, ChatNarrow `8px 8px 8px 0`). The page header needs `78 − 48 − 0 = 30px` of leading space, measured from the card's left edge:

```css
/* generated into globals.css desktop-chrome block (not a feature file) */
:root { --gai-titlebar-inset-left: 0px; --gai-titlebar-inset-right: 0px; --gai-titlebar-height: 0px; }
.platform-darwin.titlebar-inset:not(.window-fullscreen) [data-testid="app-frame"][data-sidebar="rail"] {
  --gai-page-inset-left: max(0px, calc(78px - var(--gai-rail-w, 48px) - 0px));   /* = 30px */
}
[data-slot="page-header"], [data-testid="legacy-header"] { padding-inline-start: max(16px, var(--gai-page-inset-left, 0px)); }
```

In fullscreen the lights hide, so `:not(.window-fullscreen)` drops the inset. `applyFullscreenInsets` (`lib/desktop.ts:210-217`) is kept for `--gai-titlebar-inset-left` on strip-less mac.

### 3.6 `apps/web/src/lib/desktop.ts` and pre-paint chrome

- **Synchronous chrome.** `window-manager.ts` adds `webPreferences.additionalArguments: ['--gai-chrome=' + JSON.stringify(windowChrome())]`. The chrome is static per process (platform plus env). The preload parses `process.argv` (available in sandboxed preloads) and exposes `generatoraiDesktop.chrome` as a plain value. `IPC.getWindowChrome` and `readWindowChrome()` are **deleted**. `lib/desktop.ts` exports `windowChrome(): DesktopWindowChrome`, which returns the bridge value or `NATIVE_CHROME`.
- **Pre-paint.** The inline script in `apps/web/index.html` (§6.3) also calls the equivalent of `applyChromeToDocument` before first paint: classes plus `--gai-titlebar-*` variables. The strip and sidebar geometry is therefore correct on the first frame, and the layout jump from §1.3 disappears.
- `applyChromeToDocument()` (`:106-120`) keeps setting the same classes (`platform-*`, `desktop-shell`, `custom-titlebar`, `titlebar-overlay`, `titlebar-inset`). It renames the variables to `--gai-titlebar-height`, `--gai-titlebar-inset-left` and `--gai-titlebar-inset-right` (D-08 prefix) and adds `data-layout` on `<html>` (`mac|strip|native`). It is still called by `useDesktopBridge`, which makes it idempotent with the pre-paint script.
- `trackWindowControlsOverlay()` (`:161-200`) is unchanged in logic. It writes the renamed variables. The strip reads `--gai-titlebar-inset-right` as its padding-right.
- `window-*` classes are unchanged (`window-fullscreen`, `window-maximized`, `window-blurred`). `.window-blurred [data-testid="titlestrip"]` dims to `text-fg-3` icons, not opacity.
- `desktopWindow.toggleMaximize` stays for tests. Double-click-to-zoom is **native** on drag regions on both mac and WCO. `TitleBar.tsx:28-33`'s DOM double-click handler is dead in Electron, because drag regions do not deliver mouse events, so it is not ported.

### 3.7 Drag and no-drag rules

- Keep `.app-drag-region` and its `no-drag` descendant list (`globals.css:5227-5244`). Add `[role='combobox']`, `[role='menuitemradio']`, `[role='switch']`, `[data-no-drag]` to the no-drag list.
- `ui/shell` components set `data-drag-region` on candidate rows. The generated desktop-chrome CSS decides per layout:
  ```css
  .titlebar-inset  [data-drag-region="mac"]   { -webkit-app-region: drag; app-region: drag; }   /* traffic row, rail drag row, PageHeader, LegacyHeader */
  .titlebar-overlay [data-drag-region="strip"] { -webkit-app-region: drag; app-region: drag; }  /* TitleStrip */
  ```
- Native layout and the web never drag.
- `PageHeader` content (breadcrumb links, badges, chips, buttons) is interactive and therefore no-drag. The empty spacer between the breadcrumb and the actions is draggable.
- The sidebar's server-switcher, search and nav rows are **not** drag regions on mac. Only the 44px traffic row is.

---

## 4. Native browser view contract (D-19, D-27)

### 4.1 Who sets `data-gai-overlay`

`apps/web/src/ui/lib/overlay.ts`:

```ts
export type OverlayKind = 'menu' | 'popover' | 'select' | 'combobox' | 'tooltip' | 'dialog' | 'backdrop' | 'sheet' | 'toast' | 'palette';
export const overlayProps = (kind: OverlayKind) => ({ 'data-gai-overlay': kind }) as const;
/** The single query NativeBrowserView uses. Sonner cannot tag its <li>, so toasts are matched by their native attribute. */
export const GAI_OVERLAY_SELECTOR = '[data-gai-overlay], [data-sonner-toast]';
/** Removed in Phase 7 together with components/ui (Radix). */
export const LEGACY_OVERLAY_SELECTOR = '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"], [data-modal-open="true"]';
```

Base UI parts that receive `{...overlayProps(kind)}`. Base UI spreads unknown props onto the DOM element.
- **Positioned layers**: `Menu.Positioner`, `Popover.Positioner`, `Select.Positioner`, `Combobox.Positioner`, `Autocomplete.Positioner`, `Tooltip.Positioner`, `PreviewCard.Positioner`, `NavigationMenu.Positioner`. The Positioner is the element whose box is the floating layer.
- **Dialogs**: `Dialog.Popup` and `AlertDialog.Popup` (`'dialog'`), and their `*.Backdrop` (`'backdrop'`). A full-viewport backdrop overlaps every view, so any **modal** hides the native view. This is intended: the view would otherwise paint over the scrim.
- **Sheets**: the dock sheet, `SidebarFlyout` and `SidebarDrawer` (`'sheet'`). The dock sheet has **no backdrop** (it is non-modal, §2.5). A backdrop would not be an ancestor of the view container and would hide the view forever.
- **Palette**: `CommandPalette` Popup (`'palette'`).
- **Toaster**: `ui/primitives/Toaster.tsx` wraps sonner with `toastOptions.classNames` built from the `overlay` tokens. Toasts match through `[data-sonner-toast]` in `GAI_OVERLAY_SELECTOR`, because sonner exposes no per-toast attribute prop (§11).

A lint rule, added to the `check-design-system.mjs` ratchet, requires every `ui/primitives` file that renders a Base UI `Positioner`, `Popup` or `Backdrop` to reference `overlayProps(`.

### 4.2 `NativeBrowserView.tsx` changes (P1)

Extract the pure decision into `apps/web/src/components/chat/nativeBrowserOcclusion.ts`. It moves to `blocks/browser/` when BrowserPanel ports.

```ts
export interface OcclusionDeps {
  query: (selector: string) => Element[];           // document.querySelectorAll
  rectOf: (el: Element) => DOMRectReadOnly;
  isCssHidden: (el: Element) => boolean;             // getComputedStyle(el).visibility === 'hidden' || opacity === '0'
}
export function isObscured(container: Element, deps: OcclusionDeps, selector = `${GAI_OVERLAY_SELECTOR}, ${LEGACY_OVERLAY_SELECTOR}`): boolean {
  const target = deps.rectOf(container);
  for (const el of deps.query(selector)) {
    if (el === container || el.contains(container)) continue;      // ancestor exemption: the dock sheet that hosts us
    if (container.contains(el)) continue;                          // our own placeholder children
    const r = deps.rectOf(el);
    if (r.width < 4 || r.height < 4 || deps.isCssHidden(el)) continue;
    if (r.right > target.left && r.left < target.right && r.bottom > target.top && r.top < target.bottom) return true;
  }
  return false;
}
```

- `OVERLAY_SELECTORS` (`:59-70`) and `hasOverlayOverlap` (`:77-92`) are deleted. The poll loop (`:245-280`) calls `isContainerHidden(el) || isObscured(el, domDeps)`.
- The legacy selector includes `[role="dialog"]`. That is safe with the exemption: the dock sheet (`role=dialog`) is an ancestor of the container and is skipped.
- `isContainerHidden` (`:102-117`) is unchanged. `checkVisibility({checkVisibilityCSS:true})` covers `visibility:hidden` on inactive dock panels. A zero-size rect covers a collapsed panel.
- The "Paused (overlay open)" pill (`:349-353`) is restyled with tokens (`bg-scrim text-fg-2 text-micro rounded-badge`).
- **Maximize.** No special code. A maximized dock enlarges the container, `ResizeObserver` (`:192`) pushes new bounds, and the view stays visible.
- **Narrow sheet.** No special code beyond the exemption. The sheet is an ancestor. A menu opened from the sheet's "+" is portalled (not a descendant) and overlaps, so it hides the view. That is correct.
- Tooltips: dock toolbar tooltips use `side="top"`, so hovering the tab strip does not flicker the view.

### 4.3 DockFrame requirements that the view relies on (P4)

1. **Inactive panels** stay mounted as `absolute inset-0` with `visibility:hidden` (never `display:none`). This keeps terminal scrollback and browser pages alive, and `isContainerHidden` detects it.
2. **Dock closed** collapses the dock panel to 0 (react-resizable-panels `collapsible`, `collapsedSize: 0`) instead of unmounting it. This differs from `RightPane.tsx:636`'s `if (!open) return null`, which destroys the WebContentsView and forces a reload through `restoreUrl`. The body gets `visibility:hidden` while collapsed.
3. **Stable React tree across the 1200 breakpoint.** Switching between panel and sheet must not remount panels. Otherwise `browser.destroy`/`create` IPC runs on every resize across 1200, and terminals reconnect. Implementation: `DockFrame` renders the dock **body** once, as an absolutely positioned child of `MainCard`.
   - In panel mode the dock `Panel` is an empty spacer. The body's `left`/`width` track the spacer's rect, using `onResize` plus a `ResizeObserver` on the spacer.
   - In sheet mode the spacer collapses and the body takes the sheet geometry.
   - Fallback, if this proves brittle during P4: accept the remount and add the test "crossing 1200 restores the same URL and terminal session". `restoreUrl` and the TerminalPanel sid cache already make that work.
4. **Maximize** = the dock panel at 100% and the chat column collapsed, still inside the main card.

### 4.4 `browser-host.ts`: injected palette from tokens (P4)

Today's hard-coded hues:
- the annotation overlay `THEME` map, dark/light GitHub hues (`:161-164`)
- `ACC='#2563eb'` (`:161`)
- comment pin green `#1f883d` (`:182`)
- the picker `#4c9aff` / `#0d1117` (`:793,796`)
- region capture `#22c55e` (`:854,856`)

`themeArg` (`:902-904`) accepts only `'light'|'dark'`.

The target:
- `packages/design-tokens` exports `annotationPalette(themeId, appearance): AnnotationPalette`, with keys `{ accent, onAccent, done, bg, panel, text, sub, border, input, danger, shadow }`. It returns `#rrggbb` hex (`shadow` as `rgba(...)`) derived from:
  - `run` for highlight, pin and region. **Not** `accent`: the default ink accent is near-white in dark mode and would vanish on third-party pages.
  - `ok` for commented pins
  - `overlay`, `raised`, `fg`, `fg-2`, `line`, `sunken`, `err`, and `shadow-pop`'s colour
- `BROWSER_IPC.annotateStart(tabId, palette)`, plus new optional `palette` arguments on `pickElement` and `captureRegion`. The preload signatures in `preload/index.ts:167-172` change accordingly.
- Validation in `ipc.ts` before anything reaches `executeJavaScript`. Every value must match `/^#[0-9a-f]{6}$/i` or `/^rgba\(\d{1,3},\d{1,3},\d{1,3},(0|1|0?\.\d+)\)$/`. Anything else falls back to the default palette. The palette is interpolated with `JSON.stringify`, never raw.
- The injected script's `THEME`/`C` becomes `C = palette`. `start(theme)` becomes `start(palette)`, and `setTheme(theme)` becomes `setPalette(palette)`.
- `BrowserPanel.tsx:731-736,833` passes `annotationPalette(themeId, resolvedTheme)` from `useTheme()`.

### 4.5 Tests

Unit (`apps/web/src/__tests__/components/nativeBrowserOcclusion.test.ts`, with fake `OcclusionDeps`):
1. A menu positioner overlapping the container → obscured.
2. **"browser tab inside narrow dock sheet stays visible"**: the sheet `[data-gai-overlay=sheet][role=dialog]` contains the container → not obscured.
3. **"menu over browser tab hides it"**: a portalled menu positioner over the sheet's container → obscured.
4. A `[data-sonner-toast]` overlapping → obscured. A toast elsewhere → not.
5. Zero-size or `visibility:hidden` overlay → ignored.
6. **"maximized dock"**: a container rect equal to the main card, with no overlays → not obscured. A backdrop covering the viewport → obscured.
7. Legacy `[data-radix-popper-content-wrapper]` overlapping → obscured. This test is deleted in P7.

Component test (`BrowserPanelVisibility.test.tsx` extension): with a mocked `window.generatoraiDesktop.browser`, opening a dock "+" menu calls `setVisible(tabId,false)`, and closing it calls `setVisible(tabId,true)`.

Desktop smoke (`agent-tests/desktop-dock-browser-smoke.mjs`, new in P4, `_electron.launch`, `GENERATORAI_DESKTOP_NATIVE_BROWSER=1`). It reads view visibility in main through `app.evaluate` over `contentView.children` (`View.getVisible()`). If that API is missing, expose a `NativeBrowserHost.visibleTabIds()` test getter. The smoke asserts:
1. The Browser dock tab at 1440×900 is visible.
2. Opening the dock "+" menu hides it; Esc shows it again.
3. Mod+K (palette) hides it; closing shows it.
4. Resizing the window to 1100×760 gives `[data-testid="dock-sheet"]` with the view visible and bounds inside the sheet. Also assert that no `browser:destroy` was logged.
5. Maximize (`dock-maximize`) keeps it visible, and the bounds width is at least the main card width minus 2.
6. Switching to the Changes tab hides it.
7. Collapsing the dock (`page-header-dock-toggle`) hides it, and reopening shows the same URL.

---

## 5. Shortcut and command registry (D-24)

### 5.1 Shape

`packages/shared/src/ui-contract/commands.ts`, exported through the new `@generatorai/shared/ui-contract` subpath (React-free, no dependencies).

```ts
/** One chord: '+'-joined keys. 'Mod' = Cmd on macOS, Ctrl elsewhere (web only). Desktop bindings name Cmd/Ctrl explicitly.
 *  A web binding may be a space-separated SEQUENCE of chords ('G H'). Desktop bindings are single chords (Electron accelerators). */
export type WebBinding = string;
export type DesktopBinding = string;
export type Host = 'web' | 'desktopMac' | 'desktopWinLinux';
export type CommandScope = 'global' | 'composer' | 'palette' | 'builder' | 'dock' | 'find' | 'settings';

export interface CommandDef {
  label: string;                       // palette + help sheet + menu label
  group: 'navigate' | 'create' | 'view' | 'edit' | 'app' | 'help';
  scope: CommandScope;                 // 'global' commands are dispatched by the host; others are handled locally and only DISPLAYED
  runsIn: 'renderer' | 'main';
  web: WebBinding | null;              // null = deliberately unbound on this host (a decision, not an omission)
  desktopMac: DesktopBinding | null;
  desktopWinLinux: DesktopBinding | null;
  palette?: boolean;                   // listed in the command palette's Actions / Go to
  deepLink?: boolean;                  // may be invoked by generatorai://command/<id>
}

export const COMMANDS = { /* §5.2 */ } as const satisfies Record<string, CommandDef>;
export type CommandId = keyof typeof COMMANDS;
export type RendererCommandId = { [K in CommandId]: (typeof COMMANDS)[K]['runsIn'] extends 'renderer' ? K : never }[CommandId];
export const NAV_DESTINATIONS = [
  { id: 'home', label: 'Home', path: '/', command: 'nav.home', icon: 'home', tray: true },
  { id: 'chats', label: 'Chats', path: '/chats', command: 'nav.chats', icon: 'chat', tray: true },
  { id: 'projects', label: 'Projects', path: '/projects', command: 'nav.projects', icon: 'project', tray: true },
  { id: 'agents', label: 'Agents', path: '/agents', command: 'nav.agents', icon: 'agent', tray: true },
  { id: 'workflows', label: 'Workflows', path: '/workflows', command: 'nav.workflows', icon: 'workflow', tray: true },
  { id: 'automations', label: 'Automations', path: '/automations', command: 'nav.automations', icon: 'automation', tray: true },
  { id: 'scripts', label: 'Scripts', path: '/scripts', command: 'nav.scripts', icon: 'script', tray: false },
] as const;   // D-22 order; icon = ICON_CONCEPTS key (D-17)
export function formatBinding(b: string, host: Host): string[][];   // → [['⌘','⇧','H']] | [['Ctrl','1']] | [['G'],['H']]
export function toElectronAccelerator(b: DesktopBinding): string;   // identity + validation (throws on sequences)
```

Every field is required. Adding a command without deciding all three bindings is a type error, which is D-24's guarantee. A unit test (`ui-contract/__tests__/commands.test.ts`) asserts three things:
- No two `global` commands share a binding on the same host.
- Desktop bindings are single chords.
- No web binding is in `CHROME_RESERVED = ['Mod+N','Mod+Shift+N','Mod+T','Mod+Shift+T','Mod+W','Mod+Shift+W','Mod+1'…'Mod+9','Mod+L','Mod+,' /* mac Chrome prefs */,'Mod+Q','Mod+H','Mod+M']`.

### 5.2 Command inventory and bindings

Source column: M = `menu.ts` accelerator, D = `DesktopCommand`, W = web key handler, P = palette design board.

| id | Label | Source today | web | desktop mac | desktop win/linux | runsIn |
|---|---|---|---|---|---|---|
| `palette.toggle` | Search or jump to | M `CmdOrCtrl+K`, D `command-palette`, W `AppLayout.tsx:62-73`, P | `Mod+K` (fires while typing; never inside the terminal or a `data-gai-keys="own"` surface) | `Cmd+K` | `Ctrl+K` | renderer |
| `nav.home` | Home | M Dashboard `Cmd+Shift+D`/`Ctrl+1` | `G H` | `Cmd+Shift+H` | `Ctrl+1` | renderer |
| `nav.chats` | Chats | M `Cmd+Shift+C`/`Ctrl+3` | `G C` | `Cmd+Shift+C` | `Ctrl+2` | renderer |
| `nav.projects` | Projects | M `Cmd+Shift+P`/`Ctrl+2` | `G P` | `Cmd+Shift+P` | `Ctrl+3` | renderer |
| `nav.agents` | Agents | none (missing from menu) | `G E` | `Cmd+Shift+E` | `Ctrl+4` | renderer |
| `nav.workflows` | Workflows | M `Cmd+Shift+W`/`Ctrl+4`, P "Ctrl 4" | `G W` | `Cmd+Shift+W` | `Ctrl+5` | renderer |
| `nav.automations` | Automations | M `Cmd+Shift+A`/`Ctrl+6` | `G A` | `Cmd+Shift+A` | `Ctrl+6` | renderer |
| `nav.scripts` | Scripts | M `Cmd+Shift+S`/`Ctrl+5` | `G S` | `Cmd+Shift+S` | `Ctrl+7` | renderer |
| `nav.back` | Back | M `Cmd+[`/`Alt+Left` | null (browser) | `Cmd+[` | `Alt+Left` | main |
| `nav.forward` | Forward | M `Cmd+]`/`Alt+Right` | null | `Cmd+]` | `Alt+Right` | main |
| `app.settings` | Open settings | M `Cmd+,`/`Ctrl+,` (nav), P `Ctrl ,` | `G ,` | `Cmd+,` | `Ctrl+,` | renderer |
| `chat.new` | New chat | M `CmdOrCtrl+N`, D `new-chat`, P `Ctrl N` | `N` | `Cmd+N` | `Ctrl+N` | renderer (`deepLink`) |
| `workflow.new` | New workflow | M `CmdOrCtrl+Shift+N`, D, P `Ctrl Shift N` | `Shift+N` | `Cmd+Shift+N` | `Ctrl+Shift+N` | renderer (`deepLink`) |
| `project.new` | New project | M (no accel), D | null | null | null | renderer |
| `automation.new` | New automation | M (no accel), D | null | null | null | renderer |
| `agent.new` | New agent | palette only | null | null | null | renderer |
| `sidebar.toggle` | Toggle sidebar | M `CmdOrCtrl+B`, D | `Mod+B` | `Cmd+B` | `Ctrl+B` | renderer |
| `dock.toggle` | Toggle side dock | M `CmdOrCtrl+Alt+B`, D `toggle-right-pane` | `Mod+Alt+B` | `Cmd+Alt+B` | `Ctrl+Alt+B` | renderer |
| `theme.toggle` | Toggle theme (hint "Dark → Light") | P, Header button | null | null | null | renderer |
| `find.open` | Find… | M `CmdOrCtrl+F`, D | null (browser find) | `Cmd+F` | `Ctrl+F` | renderer |
| `find.next` | Find next | M `CmdOrCtrl+G`, D | null | `Cmd+G` | `Ctrl+G` | renderer |
| `find.previous` | Find previous | M `Shift+CmdOrCtrl+G`, D | null | `Cmd+Shift+G` | `Ctrl+Shift+G` | renderer |
| `shortcuts.show` | Keyboard shortcuts | M `CmdOrCtrl+/`, D (dead) | `Shift+/` (`?`) | `Cmd+/` | `Ctrl+/` | renderer |
| `scripts.reload` | Reload scripts | M (no accel), D (dead) | null | null | null | renderer |
| `window.reload` | Reload | M `CmdOrCtrl+R` | null | `Cmd+R` | `Ctrl+R` | main |
| `devtools.toggle` | Toggle developer tools | M | null | `Alt+Cmd+I` | `Ctrl+Shift+I` | main |
| `server.restart` | Restart server | Help ▸ Troubleshooting, tray | null | null | null | main |
| `updates.check` | Check for updates… / Restart to update | M | null | null | null | main |
| `update.install` | Restart to update | new (pill) | null | null | null | main |
| `composer.send` | Send | ChatInput | `Enter` | `Enter` | `Enter` | composer |
| `composer.newline` | New line | ChatInput | `Shift+Enter` | `Shift+Enter` | `Shift+Enter` | composer |
| `composer.moreOptions` | More options (Home quick-start) / Start chat (NewChat) | P `Ctrl ↵` | `Mod+Enter` | `Cmd+Enter` | `Ctrl+Enter` | composer |
| `composer.skills` / `composer.files` | Skills / Files trigger | ChatInput `/`, `@` | `/` / `@` | same | same | composer (display only) |
| `palette.next` / `.prev` / `.open` / `.actions` / `.close` | palette footer | P | `↓` / `↑` / `Enter` / `Tab` / `Escape` | same | same | palette |
| `builder.save` | Save workflow | `WorkflowBuilderPage.tsx:541-549` | `Mod+S` | `Cmd+S` | `Ctrl+S` | builder |
| `builder.undo` / `.redo` / `.delete` | canvas edit | `DAGCanvas.tsx:105-139` | `Mod+Z` / `Mod+Shift+Z` / `Delete` | Cmd… | Ctrl… | builder |
| `dock.dismiss` | Close sheet / exit maximize | `RightPane.tsx:620-634` | `Escape` | `Escape` | `Escape` | dock |
| `find.close`, `settings.close` | | `FindBar.tsx:100-107`, `SettingsPage.tsx:56-66` | `Escape` | `Escape` | `Escape` | find / settings |

`focus-search` is dropped. The palette is the search surface. Native roles (undo, cut, copy, paste, select all, zoom, fullscreen, minimize, close, quit, hide, services) stay Electron `role` items and are **not** commands. The help sheet shows them from a static `SYSTEM_SHORTCUTS` display list in the same file.

Rules behind the table:
- **Web** never uses a Chrome-reserved chord (`CHROME_RESERVED`). Navigation and creation use GitHub/Linear-style sequences and single keys, which no browser reserves on any OS. `Mod+,` is avoided because it is Chrome's preferences shortcut on macOS. Web single-key and sequence bindings fire only when `event.target` is not editable and no `[data-gai-overlay="dialog"|"palette"]` is open. In an editable target only chords flagged `firesInEditable` fire (only `Mod+K`); `Mod+B`, `Mod+Alt+B` and the rest are left to the field. Inside a surface that owns every key (`.xterm`, `[data-gai-keys="own"]`: the terminal, code editors) the host handles nothing. The rule is the same on every OS (D-46).
- **Desktop mac** keeps `Cmd+Shift+<letter>` for sections (the `platform.ts:117-127` rationale). Letters are unified with the web sequences: H C P E W A S. `G` is not used because `Cmd+Shift+G` is Find Previous.
- **Desktop win/linux** uses `Ctrl+1…7` in `NAV_DESTINATIONS` order. The palette board's "Workflows Ctrl 4" is superseded by the D-22 order, which makes it `Ctrl+5` (§11).

### 5.3 Consumers

- **`menu.ts`.**
  - `SECTIONS` (`:77-84`) is deleted. `nav` items come from `NAV_DESTINATIONS`.
  - A helper `accel(id: CommandId) = COMMANDS[id][isMac ? 'desktopMac' : 'desktopWinLinux'] ?? undefined` supplies every accelerator.
  - `runsIn: 'renderer'` items call `wm.sendCommand(id)`. `runsIn: 'main'` items call the main-side function.
  - Settings… (`:113`, `:198`) sends `app.settings` instead of `nav('/settings')`.
  - "Toggle Right Panel" is renamed "Toggle Side Dock". Its `checked` is `menuState.dockOpen === true` and its `enabled` is `menuState.dockOpen !== null`.
  - Menu order stays File · Edit · View · Server · Window · Help. Server is kept on purpose, per the comment at `:137-139`.
- **`shared/ipc.ts`.** `DesktopCommand` becomes `import type { RendererCommandId as DesktopCommand } from '@generatorai/shared/ui-contract'`. `apps/web/src/types/desktop-bridge.d.ts:157-170` imports the same type.
- **`app/shell/useCommandHost.ts`.** `const HANDLERS: Record<RendererCommandId, (ctx: CommandCtx) => void>` is an exhaustive record, so a new renderer command without a handler is a type error. `ctx = { navigate, openSettings, shell, dock, theme }`. Handlers:
  - `chat.new` → `navigate('/chats?new=1')`, until the NewChat dialog becomes a global overlay in P5.
  - `shortcuts.show` → `shell.setShortcutsOpen(true)`.
  - `scripts.reload` → invalidate the scripts query through `queryClient.invalidateQueries({ queryKey: scriptsKeys.all })`, replacing the dead `CustomEvent`.
  - `theme.toggle` → cycle `mode`.

  It subscribes to `onDesktopCommand` and dispatches. It installs **one** `keydown` listener (capture phase) that matches `global` commands for the current host:
  - web: the `web` binding
  - desktop: nothing that has a desktop binding, because the menu delivers those and Electron also delivers the keydown (see `AppLayout.tsx:58-61`); plus the web bindings of commands that are unbound on desktop but meaningful there, of which there are none today
  - scoped commands stay with their local handlers
- **Palette.** "Go to" rows come from `NAV_DESTINATIONS`, "Actions" rows from `palette: true` commands. Each row shows `<Kbd>` chips from `formatBinding(binding, host)`, and sequences render as "G then H".
- **Help sheet.** `ShortcutsSheet` (Base UI Dialog, `data-gai-overlay="dialog"`) groups every command with a non-null binding on the current host by `group`/`scope`, plus `SYSTEM_SHORTCUTS`.
- **Tray and dock menu** use `NAV_DESTINATIONS.filter(d => d.tray)` and `accel('chat.new')` for the displayed ⌘N (§8).

### 5.4 `setMenuState` payload

`shared/ipc.ts:79-97` becomes:

```ts
export interface ShellState {
  sidebarExpanded: boolean;        // was sidebarOpen; true when mode==='expanded' or the flyout is open
  sidebarForced: boolean;          // rail forced by width/route → menu item stays enabled (toggles the flyout)
  dockOpen: boolean | null;        // was rightPaneOpen; null = current page has no dock → menu item disabled
  recent: { label: string; route: string }[];
  hasUnsavedWork: boolean;
  attention: { needsYou: number; running: number } | null;   // from the D-36 feed; null until it exists
}
```

`theme` is **removed**. The menu's Appearance radio reads `settings.appearance.mode`, which `setAppearance` keeps current (§6). `ipc.ts:215-238` validates the new fields: booleans, `null`, `attention` as two non-negative integers capped at 999.

`useDesktopBridge` pushes it on route, sidebar, dock and attention changes. `routeLabel()` (`useDesktopIntegration.ts:34-48`) uses `NAV_DESTINATIONS` labels, so `/` is "Home".

---

## 6. Theme: single writer (D-25)

### 6.1 Target flow

```
ThemeProvider (only writer of <html> appearance + localStorage, six generatorai-* keys)
  │ on any axis change (debounced 50 ms), if isDesktop:
  └─► IPC.setAppearance({ mode, themeId, groundLight, groundDark, fgLight, fgDark })
         main: validate (hex, enum) → saveSettings({ appearance }) → nativeTheme.themeSource = mode
               → wm.applyAppearance() (setBackgroundColor + WCO symbolColor) → updateMenuState() (radio)
Native View ▸ Appearance click (menu.ts)
  └─► IPC_EVENT.appearanceRequest({ mode })  ──► ThemeProvider.setMode(mode) ──► (loop above)
OS light/dark flip while mode === 'system'
  └─► renderer matchMedia 'change' (ThemeProvider.tsx:158-169) ──► ThemeProvider re-resolves ──► push
```

`nativeTheme.themeSource` **must** mirror the renderer's mode. Electron's `themeSource` drives `prefers-color-scheme` in the renderer, so a stale `themeSource` makes "System" lie (§1.5.1). Main never writes appearance on its own. It only mirrors what the renderer pushes, and it asks the renderer through `appearanceRequest`.

### 6.2 IPC changes (P1)

- **Remove**:
  - `IPC.getTheme`, `IPC.setTheme` (`shared/ipc.ts:108-109`, `ipc.ts:240-246`, preload `:76-77`)
  - `IPC_EVENT.themeChanged` (`:157`) and its emitter (`ipc.ts:276-285`, which keeps only a `wm.refreshTitleBarTheme()` call for `mode==='system'` WCO repaint)
  - preload `onThemeChanged` (`:122-126`)
  - `useDesktopIntegration.ts:176-191` (the second DOM writer)
  - `wm.sendThemePreference`
- **Rename**: `IPC_EVENT.themePreferenceChanged` → `IPC_EVENT.appearanceRequest`, with payload `{ mode: 'light'|'dark'|'system' }`. Preload `onAppearanceRequest`.
- **Add**: `IPC.setAppearance` (guarded), with its payload validated by a new `SETTING_SCHEMAS.appearance` in `settings-schema.ts`:
  `z.object({ mode: z.enum(['light','dark','system']), themeId: z.string().max(40).regex(/^[a-z0-9-]+$/), groundLight: hex, groundDark: hex, fgLight: hex, fgDark: hex })`, where `hex = z.string().regex(/^#[0-9a-f]{6}$/i)`.
- `menu.ts:380-389` `setTheme()` becomes `requestAppearance(mode) => wm.sendAppearanceRequest(mode)`.
- `index.ts:180` sets `nativeTheme.themeSource = settings.appearance.mode` at boot.
- `syncMenuThemeFromSettings` reads `settings.appearance.mode`.

### 6.3 Axes and the pre-paint script

`ThemeProvider` gains `density: 'comfortable'|'compact'`, `fontSize: 12|13|14`, `reduceMotion: 'system'|'on'` with setters. Each of the six values has its own storage key (D-51, `02` §11.1).

`<html>` attributes (the tokens CSS keys off these; names are owned by `02-design-system-spec.md`):
- `class="light|dark"`
- `data-mode`, `data-theme`, `data-accent`
- `data-density`
- `data-font-size`
- `data-motion="reduce"`, set when `reduceMotion` is on **or** `prefers-reduced-motion` matches (D-20)

`apps/web/index.html`: `<body>` gets `class="bg-ground text-fg antialiased"`, and `html { background-color: var(--gai-ground) }` sits in the generated base layer. The script itself is **generated** by `pnpm tokens:write` between the `@generated-prepaint` markers (`02` §11.2): one ES5 line that reads the six keys, validates stored ids and resolves the theme's default accent exactly as `readStoredAppearance` does (D-51). An earlier draft here sketched a hand-written script over one JSON key; it was superseded. Desktop chrome classes stay out of the pre-paint until P3 (D-51).

The defaults (`dark`, `instrument`, `ink`, `comfortable`, `13`) must equal `DEFAULT_MODE`, `DEFAULT_THEME`, `DEFAULT_ACCENT`, `DEFAULT_DENSITY` and `DEFAULT_FONT_SIZE` in `packages/design-tokens/src/registry.ts`. A web unit test parses `index.html` and asserts this.

**CSP hash, a required part of the same PR.** The script is allow-listed by SHA-256:
- `apps/server/src/middleware/csp.ts:55` `THEME_SCRIPT_CSP_HASH`
- `apps/desktop/src/main/session-hardening.ts:34` `DESKTOP_CSP`

Recompute it with `node -e "…createHash('sha256').update(<exact text between the tags>)…"`. `apps/server/src/__tests__/csp.test.ts:66-81` and `apps/desktop/src/main/__tests__/session-hardening.test.ts` fail until both constants match. The two hashes must be identical.

### 6.4 Desktop background persistence

- `main/appearance.ts` (new) exports `appearanceMirror(): { ground: string; fg: string }`. It resolves `settings.appearance` (or the `chromeColors(DEFAULT_THEME, …)` fallback) against `nativeTheme.shouldUseDarkColors` when `mode==='system'`. It is used by `window-manager.ts` (`backgroundColor`, `applyAppearance`), `platform.ts` (`titleBarSymbolColor`) and `prompt-window.ts`.
- The renderer computes `groundLight/Dark` and `fgLight/Dark` with `chromeColors(themeId, 'light'|'dark')` from tokens. It does **not** read `getComputedStyle`, which can return `oklch()` that `setBackgroundColor` rejects. It pushes **both** appearances, so a `system` user whose OS flipped while the app was closed still gets the right first frame.
- The first launch, before any push, uses the Instrument default from `chromeColors`.

### 6.5 Optional (P6): device-scoped appearance on desktop

localStorage is per origin, so a remote server has its own appearance. The Appearance board says "Saved on this device". Fix:
- Main persists all six axes.
- The preload exposes `bootAppearance` through a guarded `ipcRenderer.sendSync` (add `guardedOnSync` to `ipc-guard.ts`, reusing `rejectionReason()`).
- The pre-paint script and ThemeProvider prefer `bootAppearance` over localStorage.

Ship this only together with the "this device" copy in P6.

---

## 7. Static desktop pages (splash, error, prompt)

**Tokens.**
- `packages/design-tokens/src/emit/static.ts` (new) → `emitStaticCss()` returns:
  - `:root{…}` Instrument **light** `--gai-*` colours (ground, surface, raised, sunken, line, line-soft, line-strong, fg, fg-2, fg-3, run, ok, err, err-bg, accent/on-accent for ink)
  - `@media (prefers-color-scheme: dark){:root{…}}` for dark (Electron's `nativeTheme.themeSource` mirrors the app mode, so the media query tracks the app)
  - radius, type scale and control height variables
  - `@font-face` for `Instrument Sans` and `JetBrains Mono` pointing at `./fonts/…woff2`
- `packages/design-tokens/bin/generate.ts` gets three new **spliced** targets, handled like `globals.css` (`spliceCss`) between `/* @generated-tokens:start */` and `/* @generated-tokens:end */` markers inside each page's `<style>`: `apps/desktop/resources/splash.html`, `error.html` and `prompt.html`. `pnpm check:tokens` (root `package.json:26`) then fails on drift.
- The pages are not linked to an external CSS file, because `'self'` matching for `file:` origins is unreliable in Chromium.

**Fonts.**
- `apps/desktop/scripts/build-resources.mjs` gets a `copyFonts()` step. It resolves `@fontsource-variable/instrument-sans` and `@fontsource-variable/jetbrains-mono` through `createRequire(<repo>/apps/web/package.json)`, because web owns the dependency (D-16). It copies `files/*-latin-wght-normal.woff2` into `apps/desktop/resources/fonts/`, doing so only when the content differs.
- `scripts/dev.mjs:22` already runs `build:resources`, and packaging includes `resources/**/*` (`scripts/lib/build-config.mjs:278`).
- Add `apps/desktop/resources/fonts/` to `.gitignore`.
- If a font is missing, the stack falls back to `ui-sans-serif, system-ui`. Never fetch fonts from the network.

**CSP per page.** Splash and prompt use `default-src 'none'; style-src 'unsafe-inline'; font-src file:; img-src data:`. Error adds `script-src 'unsafe-inline'` (unchanged). Nothing else is loosened.

**New look.** No gradients, glow or shimmer (D-20).
- **splash.html**:
  - Body `--gai-ground`, 1px `--gai-line-soft` border at radius 12.
  - 40px `--gai-fg` logo tile (radius 10) with a `--gai-surface` glyph.
  - "GeneratorAI" at 16/600, and "Starting the local engine…" at 12 `--gai-fg-3`.
  - A 16px `--gai-run` loader-circle spinner, static under reduced motion. The shimmer bar is removed.
- **error.html**:
  - A surface card on ground (max 640px, radius 12, `--gai-line`), a circle-x in `--gai-err` on `--gai-err-bg`, h1 20/600, body 13 `--gai-fg-2`.
  - `pre` is mono 12 on `--gai-sunken` with `--gai-fg` text.
  - The copy "open the logs from the Server menu" becomes "Help ▸ Troubleshooting ▸ View Logs" (`menu.ts:347-363`).
- **prompt.html**:
  - Surface body.
  - 28px input with a `--gai-line-strong` border (D-12) and an accent focus outline.
  - Cancel is a standard button; Connect uses the primary style (`--gai-accent`/`--gai-on-accent`).
  - `color-scheme: light dark`.

---

## 8. Tray, menu, deep links, updater

**Application menu (`menu.ts`)**, all P3 unless noted:
- Labels and order come from `NAV_DESTINATIONS` (adds Agents; Dashboard becomes Home). Accelerators come from `COMMANDS` (§5).
- File ▸ New Chat/New Workflow/New Project/New Automation send `chat.new` … `automation.new`.
- File ▸ Reload Scripts sends `scripts.reload`, without navigating first (`:193` did `nav('/scripts')` and then a dead command).
- Settings sends `app.settings`.
- View ▸ Toggle Side Dock (`dockOpen`). View ▸ Appearance radio → `requestAppearance`.
- Help ▸ Keyboard Shortcuts sends `shortcuts.show`, which now works.
- Help ▸ "Check for Updates…" becomes "Restart to Update (v{version})" while `updateState.status === 'ready'`.

**Tray (`tray.ts:55-76`)**, following the DesktopMac board. Tray menus cannot render badges or colour, so counts go in labels:

```
Server running · {n} agents  :{port}     disabled; "· {n} agents" only when attention != null
────
Open GeneratorAI
New chat                     ⌘N / Ctrl+N  → restoreFromTray(); sendCommand('chat.new')
────
Go to                        disabled header
Home (2) · Chats · Projects · Agents · Workflows · Automations
────
Restart server
Quit GeneratorAI             ⌘Q
```

- The Go to items come from `NAV_DESTINATIONS.filter(d => d.tray)`.
- The board's per-entity badge (Workflows 1) cannot be derived from aggregate counts, so the needs-you count goes on Home.
- `updateMenuState` also calls `refreshTrayMenu()` when `attention` changes.
- Badges: `app.dock?.setBadge(String(needsYou) || '')` on macOS and `app.setBadgeCount(needsYou)` on Linux. Windows gets no badge in this pass.

**macOS dock menu and Windows JumpList** (`index.ts:397-430`):
- Dock menu: New Chat → `sendCommand('chat.new')` (was `go('/chats')`); New Workflow → `sendCommand('workflow.new')`; Home → `nav('/')`.
- JumpList: `generatorai://command/chat.new`, `generatorai://command/workflow.new`, `generatorai://` (Home).

**Deep links (`deep-link.ts`).**
- `urlToRoute` (`:24-33`) keeps stripping query and hash (no parameter injection).
- New: `generatorai://command/<id>` → `sendCommand(id)` **only** if `id in COMMANDS && COMMANDS[id].deepLink === true && runsIn === 'renderer'`. Otherwise the link is ignored and logged.
- `generatorai://settings/<section>` reaches the renderer through `IPC_EVENT.navigate` → `openSettings(section)`, which opens over the current page (§2.4).
- Everything else → `navigateTo(route)`.

**Updater (`updater.ts`).**
- Delete the modal `dialog.showMessageBox` on `update-downloaded` (`:46-55`). Keep a module state `UpdateState = { status: 'idle'|'checking'|'downloading'|'ready'|'error'; version?: string; percent?: number }`, updated from `checking-for-update`, `download-progress`, `update-downloaded` and `error`.
- New `IPC.getUpdateState` and `IPC.installUpdate` (guarded; calls `updater.quitAndInstall()`), and `IPC_EVENT.updateStateChanged`. Preload: `updates: { getState, install, onChange }`.
- Pill (`update-pill`, text "Restart to update", `bg-run-bg text-run`, title "Update {version} is ready"):
  - Windows / Linux-custom: in the strip, before the server chip
  - mac: right end of the traffic row, or an icon in the rail
  - Linux native: `sidebar-nav-row`
  - web: never
- `checkForUpdatesInteractive` keeps its "up to date" and error dialogs. Those are explicit user requests.
- Verify with `pnpm --filter @generatorai/desktop mock-update-server` on all three OSes that `installUpdate` actually installs, given that `before-quit` (`index.ts:124-175`) ends in `app.exit(0)` (§11 risk R5).

**Servers popover (sidebar switcher / strip chip).**
- On desktop the backend switch must happen in main (a new origin). Add guarded IPC:
  - `IPC.getServers` → `connectionState()` plus a per-connection reachability flag
  - `IPC.switchServer(id | 'embedded')` → `switchToRemote` / `switchToEmbedded`
  - `IPC.addServer()` → `promptForRemoteServer()`
  - `IPC_EVENT.serversChanged`
- On the web the popover uses `platform/authRuntime.ts` `listConnections()`/`switchConnection()`.
- "Manage servers" → `openSettings('security')`.
- The native Server menu stays.

---

## 9. Tests and smokes

### 9.1 What breaks at P3 and the rewritten assertions (same PR as the shell)

| File | Breaks because | Rewrite |
|---|---|---|
| `agent-tests/desktop-chrome-smoke.mjs` | `:76` waits for `app-header`; `:103` Server-menu check is already false; `:133` "Toggle Right Panel"; `:161` `--titlebar-height`; `:178-240` title-bar/header geometry; `:285-313` sidebar open/close via `sidebar-toggle` presence | Wait for `[data-testid="app-frame"]`. Top menus = File · Edit · View · **Server** · Window · Help. "Toggle Side Dock" exists and is disabled on `/`. Read `--gai-titlebar-*`. **Per OS:**<br>• **mac**: `data-layout=mac`; `sidebar-traffic-row` height 44 and drag; `titleBarStyle==='hidden-inset'`; `trafficLightPosition` y=16 (main: `win.getWindowButtonPosition()` → `{x:16,y:16}`); no `titlestrip`.<br>• **Windows / Linux custom**: `titlestrip` height 36 and drag; WCO visible with height ≤ 36; strip padding-right ≈ WCO free-area inset ±2 (reuse `:262-281` logic on `titlestrip`); last strip control right ≤ WCO left edge; `main-card` top ≥ strip bottom.<br>• **Linux native**: `data-layout=native`; no strip; `sidebar-nav-row` present.<br>Sidebar: `sidebar-toggle` click → `rail` visible, menu "Toggle Sidebar" unchecked; `desktop:command` `sidebar.toggle` → `sidebar` back. `setBackgroundColor`: `app.evaluate(w => w.getBackgroundColor())` equals `chromeColors(...)` for the active appearance. |
| `agent-tests/packaged-app-smoke.mjs:107,158` | `app-header`, `app-titlebar` | `app-frame`; `titlestrip` on win32 or linux-custom only |
| `agent-tests/e2e/navigation.spec.ts` (already stale, §1.5.6) | `button` roles, Dashboard, Settings modal, `header-toggle-sidebar` | Nav = `getByTestId('sidebar-nav').getByRole('link')` with texts `Home, Chats, Projects, Agents, Workflows, Automations, Scripts`. Headings: `/` Mission Control until the P5 Home port, then Home's heading; Chats (ported) asserts `page-header`. Settings: P3–P5 route page (`/settings/general`, `legacy-header`); P6 modal (`settings-modal`, URL `/settings/general`, background page still rendered, Close → previous URL). Collapse: at 1440×900 `sidebar-toggle` → `rail` (width 48) → `rail-expand` → `sidebar` (232). Resize to 1100 → `rail`, `rail-expand` → `sidebar-flyout`; Esc closes. |
| `agent-tests/browser-ui-e2e.spec.ts:55,91` | 'Dashboard' button | 'Home' link |
| `agent-tests/e2e/settings-dashboard-templates.spec.ts:185`, `e2e/subsystems-live.spec.ts:537` | not at P3 (DashboardPage stays at `/`) | at P5 Home port: Home heading |
| `agent-tests/right-pane-desktop-smoke.mjs` | at **P4** (ChatPage port): `chat-toggle-right-pane`, `right-pane-*`; also uses `--remote-debugging-port` (`:35`) | P4: rewrite on `_electron.launch` as `dock-desktop-smoke.mjs`: `page-header-dock-toggle` → `dock` → `dock-tab-changes` default → `dock-add` → Browser → `dock-tab-browser`; narrow window → `dock-sheet` → `dock-close`. The workflow-run half stays on `right-pane-*` until PW. |
| `agent-tests/desktop-browser-smoke.mjs:195-201` | at **P4**: `aria-label="Show side pane"`, "Add tab", "Integrated browser for this chat" | P4: `page-header-dock-toggle`, `dock-tab-browser` (Browser is always pinned per D-27); keep the REST handshake checks unchanged |
| `apps/web/src/__tests__/RightPane*.test.tsx` | not at P3 | kept while `RightPane.tsx` serves WorkflowRunPageV2; new `DockFrame` tests in P4 |

### 9.2 New unit and component tests

- `packages/design-tokens`: `chrome.test.ts` (`trafficLightPosition` = {16,16}; `chromeColors` equals emitted CSS for 18×2); `static.test.ts` (static CSS contains light and dark roots and `@font-face`).
- `packages/shared/ui-contract`: `commands.test.ts` (§5.1 invariants; `NAV_DESTINATIONS` order equals D-22).
- `apps/desktop`:
  - `platform.test.ts` (new): options per platform with `process.platform` stubbed for darwin, win32, linux and linux+env.
  - `menu.test.ts` (new): accelerators equal the registry for both hosts; Toggle Side Dock is disabled when `dockOpen===null`.
  - `settings-schema.test.ts`: `appearance` accept/reject cases.
  - `ipc` annotate palette validation rejects `"</script>"` and `url(...)`.
  - `deep-link.test.ts`: `command/<id>` allowlist.
- `apps/web`:
  - `useSidebarMode.test.ts` (breakpoints, `forceRail`, flyout)
  - `overlayNavigation.test.ts`
  - `indexHtmlDefaults.test.ts`
  - `nativeBrowserOcclusion.test.ts` (§4.5)
  - `useCommandHost.test.tsx` (web sequences ignore editable targets; `Mod+K` works in a textarea; `Mod+B` does not, with `mac` true and false; nothing fires inside `.xterm` or `[data-gai-keys="own"]`; the desktop host ignores menu-bound chords)

### 9.3 Per-OS matrix

| Check | macOS | Windows | Linux native | Linux custom (`GENERATORAI_LINUX_CUSTOM_TITLEBAR=1`) | Web (Chrome, `playwright-cli --headed`) |
|---|---|---|---|---|---|
| `desktop-chrome-smoke.mjs` | auto | auto | auto | auto (set env) | — |
| First frame has correct layout (no jump), screenshot at 0 ms after `domcontentloaded` | manual + smoke screenshot | same | same | same | playwright-cli screenshot |
| Traffic lights centred in the 44px row; rail mode header inset 30px, lights not over text | manual | — | — | — | — |
| Caption glyph colour follows app mode (app dark / OS light and the reverse) | — | manual | — | manual | — |
| Double-click drag area maximizes / zooms | manual | manual | n/a (OS frame) | manual | n/a |
| Strip search centred and never overlapping at 860px | — | manual | — | manual | — |
| Back/forward enabled state | menu only | strip | nav row | strip | hidden |
| Update pill (`mock-update-server`) | traffic row | strip | nav row | strip | never |
| Native browser occlusion (`desktop-dock-browser-smoke.mjs`, P4) | auto | auto | auto | auto | n/a (screencast path) |
| Theme: native menu ▸ Light while app "System" → app goes light; back to System follows OS | manual | manual | manual | manual | n/a |
| Wayland (Linux): no geometry restore attempted; WCO absent under the custom flag degrades to a working native frame | — | — | manual | manual | — |
| Keyboard: registry bindings per host | smoke (menu accelerators) | smoke | smoke | smoke | `G H`, `N`, `Mod+K`, `?` via playwright-cli |

### 9.4 Security invariants that must keep passing

- `scripts/check-no-app-wide-cdp.mjs`: no `appendSwitch('remote-debugging-port'|'address')` in `apps/desktop/src`. The P4 smoke rewrite also removes the `--remote-debugging-port` launch from `agent-tests`.
- `scripts/check-security-invariants.mjs` rules touching this work:
  - `no-long-lived-key-in-url` (desktop and web: the new IPC and deep links carry no keys)
  - `no-insecure-secret-fallback` (desktop)
  - `no-secret-fields-in-config-schemas` (`apps/desktop/src/main/config.ts`: the `appearance` schema uses none of those names)
- CSP: `csp.test.ts` and `session-hardening.test.ts` must pass with the new pre-paint hash. Static pages keep `default-src 'none'`, and the only addition is `font-src file:`. Once D-16 bundles fonts, a follow-up (owned by `02`) can drop `fonts.googleapis.com`/`fonts.gstatic.com` from both CSPs.
- `ipc-guard`: every new channel (`setAppearance`, `getUpdateState`, `installUpdate`, `getServers`, `switchServer`, `addServer`, optional `getBootAppearanceSync`) is registered through `guardedHandle`/`guardedOnSync`. `ipc-guard.test.ts` gains a table test listing every `IPC` value and asserting that it is guarded.
- `navigation-guard`: unchanged. `navigateTo` routes must still start with `/` (checked in `deep-link` and `navigateTo`).
- Annotation palette validation (§4.4) prevents script injection into guest pages.

---

## 10. PR-by-PR checklist

**Task IDs.** `07-phases.md` is the canonical plan; the local IDs below map to it as follows: P1-S1…S3, S5 = the same IDs in 07 · P1-S4 = P1-T8 · P3-S1 + P3-S2 = P3-04 (one PR) · P3-S3 = P3-05 · P3-S4 = P3-06 · P4-S1 = P4-06 · P5-S1 = P5-10 · P5-S2 = the static-pages half of P5-11 · P6-S1 = P6-02 · P6-S2 is optional and has no 07 ID (add one if the owner wants it) · item 15 is PW · item 16 = P7-01.

Each PR leaves the app working, updates the smokes it breaks, and is verified by driving the real app (web with `playwright-cli --browser=chrome --headed`; desktop with the smokes on the developer's OS, plus the CI OS matrix where available).

**P1: tokens and registries**
1. **P1-S1 `CHROME` + chrome colours.** Add `design-tokens/src/chrome.ts`, `chrome-colors.ts`, the `./chrome` export and the `annotationPalette` stub. Add the desktop devDependencies and `noExternal`. `platform.ts` imports `CHROME` **only for `minWindow`** (no geometry change yet); `window-manager.ts` uses `CHROME.minWindow` for `minWidth` and `sanitizeBounds`.
   *Accept:* desktop `build`, `typecheck` and `test` pass; the packaged app launches (`packaged-app-smoke.mjs`); tokens tests cover 18×2.
2. **P1-S2 command registry + `NAV_DESTINATIONS`.** Add `@generatorai/shared/ui-contract`. `menu.ts` and `tray.ts` consume it (Home label, Agents added, new mac letters, win `Ctrl+1…7`). `DesktopCommand` type from the registry. `useCommandHost` replaces the switch in `useDesktopIntegration.ts:99-139` and the ⌘K handler in `AppLayout.tsx:62-73`. Add `ShortcutsSheet` (plain dialog for now). `scripts.reload` invalidates the query. Update the desktop-chrome smoke's accelerator checks.
   *Accept:* Help ▸ Keyboard Shortcuts opens the sheet on all hosts; web `G C` goes to Chats and is ignored inside the composer; the command registry tests pass.
3. **P1-S3 router split.** `app/routes/*`, `defineRoute`, `RouteSlot` (no LegacyHeader yet; every route behaves as today), and the `'*'` + `useRoutes` shell entry. `router.tsx` is deleted.
   *Accept:* `e2e` suites green apart from pre-existing stale specs; `useBlocker` in WorkflowBuilder still blocks; `/chats/:id` breadcrumb and Archive work.
4. **P1-S4 theme single writer + axes + pre-paint.** Everything in §6.1–§6.4:
   - one appearance key
   - `setAppearance` / `appearanceRequest`
   - `themeSource` mirroring
   - background persistence (the `setBackgroundColor` part)
   - both CSP hashes

   *Accept:* no white flash in any of the 18 themes at launch (desktop screenshot of the first frame); the native Appearance ▸ Light → app System case works; WCO glyphs are legible in app-dark/OS-light on Windows; `csp.test.ts` and `session-hardening.test.ts` pass.
5. **P1-S5 overlay contract.** `ui/lib/overlay.ts`, `nativeBrowserOcclusion.ts`, NativeBrowserView wired, unit tests 1–7.
   *Accept:* on desktop with the native browser flag, a toast now hides the view; existing Radix menus still hide it.

**P3: Slice A shell + ChatsList**
6. **P3-S1 desktop chrome geometry.** `platform.ts` §3.3, `window-manager.ts` §3.4 (`navigateTo` via IPC plus the ready flag, `navHistoryChanged`), preload `chrome` via `additionalArguments`, `lib/desktop.ts` §3.6, CSS var rename, drag CSS §3.7. Lands **together with** P3-S2 (the geometry has no consumer without the new frame).
7. **P3-S2 AppFrame.**
   - Add the `ui/shell` parts (AppFrame, Sidebar, Rail, MainCard, TitleStrip, SidebarFlyout) with stories.
   - Add the `app/shell` wiring and `LegacyHeader` (with the Header.tsx trims from §2.3).
   - Rename `uiStore` → `shellStore` (key `generatorai:shell`).
   - Delete `AppLayout.tsx`, `TitleBar.tsx` and `Sidebar.tsx` (the new frame keeps mounting the legacy `CommandPalette.tsx` until P3-S3 replaces it); move `useDesktopIntegration` → `useDesktopBridge`.
   - Show the needs-you/running sections only if the D-36 feed has landed (otherwise not rendered).
   - Put `ConnectionStatus` in the sidebar footer.
   - Rewrite `desktop-chrome-smoke`, `packaged-app-smoke`, `navigation.spec` and `browser-ui-e2e` as in §9.1.

   *Accept:*
   - Matrix rows 1–5 on the developer's OS plus CI.
   - Board-vs-app PNGs for DesktopMac, DesktopWindows, Main and ChatNarrow (rail) attached (D-34).
   - Every legacy route still has its Header actions (chat Archive, Open in editor, side-pane toggle).
   - At 1100px the rail is shown; the mac rail inset shows no overlap.
8. **P3-S3 command palette.** Base UI Autocomplete, registry hints, Go to / Actions / Recent chats. Delete `components/layout/CommandPalette.tsx`. Entity search is P5-12 (G-18). `theme.toggle` row.
   *Accept:* palette board comparison; `Mod+K` in a textarea opens it; Tab switches to row actions.
9. **P3-S4 native IA alignment.** §8 menu, tray, dock menu, JumpList, `command/<id>` deep links, Servers IPC and popover, updater state and pill.
   *Accept:* tray items per the board (with the §11 order note); `generatorai://command/chat.new` opens the new-chat flow from a cold start and from a running app; the mock update server shows the pill and installs on each OS.

**P4: Slice B chat workspace**
10. **P4-S1 DockFrame.** react-resizable-panels 4 with `useDefaultLayout` (`generatorai:dock:chat:layout`), stable-tree sheet (§4.3), `dockStore` rename (RightPane registers into it too), `generatorai:dock:chat:*` keys, collapse instead of unmount, and `browser-host` palette (§4.4). ChatPage drops `legacyHeader` later, in P4-12 (07), when its own header lands.
    *Accept:* `desktop-dock-browser-smoke.mjs` cases 1–7 on macOS, Windows and Linux; the rewritten `right-pane-desktop-smoke.mjs` (now the dock smoke, §9.1) and `desktop-browser-smoke.mjs` pass; crossing 1200 does not recreate the view (no `browser:destroy` in the main log).

**P5: fan-out**
11. **P5-S1 Home replaces Dashboard** (D-22). Drop `legacyHeader` on `/`. Update the Mission Control specs and `docs/clients/*.md`. The tray and menu already say Home.
12. **P5-S2 static pages.** §7 generator targets, fonts copy, restyle.
    *Accept:* `check:tokens` passes; splash/error/prompt screenshots in light and dark on mac and Windows; offline launch renders Instrument Sans.

**P6: settings modal and sections**
13. **P6-S1 Settings modal route.** Background location (§2.4), `isOverlayNavigation` in the WorkflowBuilder blocker, menu `app.settings`, `generatorai://settings/<section>`.
    *Accept:* the Settings modal opens over a dirty builder without the leave dialog; a direct load shows it over Home; Close returns to the previous URL; e2e settings specs are updated.
14. **P6-S2 (optional) device-scoped appearance** (§6.5).

**PW: workflow surfaces (Workflow Overhaul Plan, D-35)**
15. Builder routes get `forceRail` (rail at all widths; mac rail inset applies). The run page uses the Workspace template with `DockFrame` at `dockWidthRun` 440 and `generatorai:dock:run:*` keys. The `right-pane-*` half of the smoke is removed when `RightPane.tsx` is deleted.

**P7: lockdown**
16. Delete:
    - `components/layout/Header.tsx`, `LegacyHeader.tsx`, `GaiRouteHandle.legacyHeader`
    - `LEGACY_OVERLAY_SELECTOR` and its test
    - `RightPane.tsx`, `useRightPaneOpen`, `useResizablePane`, if PW has ported the run page; otherwise per the D-35 fallback
    - the `.app-titlebar` CSS

    Ratchet: no `--titlebar-` (unprefixed) usages; no `data-radix` in `NativeBrowserView`.
    *Accept:* grep gates at zero; all smokes are green on the matrix.

---

## 11. Risks and issues with decisions

**Issues with decisions.** Each is backed by evidence, and the design above already applies the correction. **Status (final review, 2026-09-25):** all fourteen are reconciled in `01-decisions.md` — 1, 2 → D-19; 3, 4, 5 → D-23; 6, 7, 8 → D-24; 9, 10 → D-25; 11 → D-26; 12 → D-27; 13 → D-21; 14 → D-37.
1. **D-19, toasts.**
   - sonner cannot carry `data-gai-overlay`: there is no per-toast attribute prop, and the `ol` is 0px tall.
   - The selector must include `[data-sonner-toast]`.
   - Today's selectors never match toasts at all (§1.5.4).
2. **D-19, modality.** The dock sheet must be non-modal. A modal Backdrop is not an ancestor of the view container, so it would hide the view permanently.
3. **D-23, rail inset.** `78 − railWidth − 8` assumes an 8px left card margin. The boards draw the card with `margin: 8px 8px 8px 0`, so the inset is 30px, not 22px (§3.5).
4. **D-23, Linux native row.** Back/forward and the update pill do not fit beside the server switcher and collapse button in about 216px. Use a separate 36px `sidebar-nav-row`, rendered only on desktop.
5. **D-23, mac title bar.** The mac layout has no strip, so `titleBarHeight` becomes 0. The "lockstep with h-10" coupling (`platform.ts:39`) is deleted, not ported.
6. **D-24, web bindings.** `Mod+,` is Chrome's preferences shortcut on macOS. Since one `web` binding cannot differ by OS, the web uses sequences instead (`G ,`, `G H`).
7. **D-24, palette board.** The board shows "Workflows Ctrl 4" (the old menu index). D-22's order makes it `Ctrl+5`.
8. **D-24, tray order.** The tray board's order (Home, Chats, Workflows, Automations, Projects, Agents) differs from D-22. The tray follows `NAV_DESTINATIONS`. Add a `trayOrder` field if the owner prefers the board.
9. **D-25, resolved ground.**
   - A computed CSS colour may not be a format `setBackgroundColor` accepts.
   - Pushing only the current appearance is wrong for `system` users after an OS flip.
   - Push token-computed hex for both appearances (§6.4).
10. **D-25, missing consequences.**
    - The CSP hash must be updated in two places (`csp.ts:55`, `session-hardening.ts:34`).
    - `nativeTheme.themeSource` must mirror the renderer's mode.
    - localStorage appearance is per origin (§6.5).
11. **D-26.**
    - Opening Settings over a dirty builder would trip `useBlocker` (`WorkflowBuilderPage.tsx:219-222`), so `isOverlayNavigation` is needed.
    - Native `pushState` navigation cannot carry a background location, so the menu must send `app.settings`, and `IPC_EVENT.navigate` must actually be used.
12. **D-27.**
    - D-27 does not define what Close does to panel lifetime. Today `RightPane` unmounts (`RightPane.tsx:636`), which kills the view and the terminals. This design collapses instead.
    - The 1200px panel↔sheet switch must keep a stable React tree (§4.3).
13. **D-21.** `Header.tsx` needs `useParams()` to resolve `:id`. LegacyHeader must therefore render inside the route element (`RouteSlot`), not beside `useRoutes`.
14. **D-37, needs verification.** `research/web-stack-research.md:182` says React Router 8 "requires Vite ≥7", while D-37 keeps Vite 6.4. If that requirement is not limited to framework mode, the router split stays on RR7 until Vite moves (§2.4). **Resolved:** D-37 now upgrades Vite 6.4 → 7 (with Vitest 4) in P1-U3, before RR8 (P1-U4).

**Risks:**
- **R1. Linux WCO.** Some window managers report no WCO rect. The strip falls back to the 138px estimate, and the matrix covers Linux custom.
- **R2. Sandboxed preload `process.argv`.** If a future Electron removes it, fall back to the async IPC. The layout jumps again, but nothing breaks.
- **R3. Shadowed mac shortcuts.** System-wide tools may shadow `Cmd+Shift+H/E`. There is no user keymap in this pass.
- **R4. Single-key web bindings.** They must never fire in editable targets or comboboxes. This is tested.
- **R5. Updater install path.**
  - `before-quit` ends in `app.exit(0)` (`index.ts:124-175`), so `quitAndInstall` and `autoInstallOnAppQuit` may not install. This is unverified.
  - Test with `mock-update-server` on each OS.
  - If it fails, `installUpdate` runs `confirmDiscard()` and the bounded shutdown, sets `quitHandled`, and calls `quitAndInstall()` instead of `app.exit`.
- **R6. Dropped storage keys.** Theme, sidebar and dock preferences reset once. This is accepted.
- **R7. Hotspots.** `globals.css` chrome block, `app/routes/index.ts` and `COMMANDS` are append-only. P3-S1 and P3-S2 merge together.
- **R8. Remote mode.**
  - The native browser falls back to the screencast (`ipc.ts:299-301`).
  - Appearance is per origin unless §6.5 ships.
