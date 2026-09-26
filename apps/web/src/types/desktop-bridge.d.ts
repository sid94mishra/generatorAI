// ────────────────────────────────────────────────────────────────
// Ambient type for the Electron preload bridge (`window.generatoraiDesktop`).
//
// The web SPA is built as if it runs in a plain browser. At runtime the
// desktop preload (apps/desktop/src/preload/index.ts) injects an object
// exposing IPC-backed operations. We declare its shape here so TS can
// type-check components that gate on it (e.g. BrowserPanel's native branch).
//
// Everything is optional at consumption time — production callers guard
// on `window.generatoraiDesktop?.browser?.available` before invoking any
// method to keep behaviour identical when running in the browser.
// ────────────────────────────────────────────────────────────────

interface GeneratorAIDesktopBrowserApi {
  available: () => Promise<boolean>;
  create: (tabId: string, workspaceId: string, active?: boolean) => Promise<GeneratorAIDesktopNativeBrowserDescriptor>;
  destroy: (tabId: string) => Promise<void>;
  setActiveTab: (workspaceId: string, tabId: string) => Promise<void>;
  setBounds: (tabId: string, bounds: GeneratorAIDesktopBrowserBounds) => Promise<void>;
  setVisible: (tabId: string, visible: boolean) => Promise<void>;
  navigate: (tabId: string, url: string) => Promise<GeneratorAIDesktopNativeBrowserDescriptor>;
  back: (tabId: string) => Promise<void>;
  forward: (tabId: string) => Promise<void>;
  reload: (tabId: string) => Promise<void>;
  screenshot: (tabId: string) => Promise<string | null>;
  describe: (tabId: string) => Promise<GeneratorAIDesktopNativeBrowserDescriptor>;
  openDevtools: (tabId: string, panel?: GeneratorAIDesktopBrowserDevtoolsPanel) => Promise<void>;
  setEmulation: (tabId: string, params: GeneratorAIDesktopBrowserEmulationParams | null) => Promise<void>;
  setZoom: (tabId: string, factor: number) => Promise<void>;
  pickElement: (tabId: string) => Promise<GeneratorAIDesktopBrowserPickResult | null>;
  captureRegion: (tabId: string) => Promise<string | null>;
  annotateStart: (tabId: string, theme?: 'light' | 'dark') => Promise<void>;
  annotateStop: (tabId: string) => Promise<void>;
  annotatePoll: (tabId: string) => Promise<GeneratorAIDesktopBrowserAnnotatePollResult>;
  annotateSend: (tabId: string, keys?: string[]) => Promise<GeneratorAIDesktopBrowserPickResult[]>;
  annotateRegion: (tabId: string) => Promise<void>;
  annotateRemove: (tabId: string, key: string) => Promise<void>;
  annotateClear: (tabId: string) => Promise<void>;
  onDidNavigate: (cb: (evt: GeneratorAIDesktopNativeBrowserEvent) => void) => () => void;
  onDidFinishLoad: (cb: (evt: GeneratorAIDesktopNativeBrowserEvent) => void) => () => void;
  onDidFailLoad: (cb: (evt: GeneratorAIDesktopNativeBrowserEvent) => void) => () => void;
  onTitleUpdated: (cb: (evt: GeneratorAIDesktopNativeBrowserEvent) => void) => () => void;
  onFaviconUpdated: (cb: (evt: GeneratorAIDesktopNativeBrowserEvent) => void) => () => void;
  onLoadingChanged: (cb: (evt: GeneratorAIDesktopNativeBrowserEvent) => void) => () => void;
}

// The IPC payloads (menu state and attention counts, servers, updates,
// appearance, window chrome, find-in-page, browser-IPC shapes) are declared
// once in `@generatorai/shared` (`DesktopShell.ts`) and used by the desktop
// main process and preload too (P1-review P2-R24, P2-R41 — this file used to
// hand-declare its own copies of `WindowChrome`, `WindowStateChange`,
// `FindInPageResult` and every browser-IPC shape, and `WindowChrome.platform`
// had already drifted from the desktop side's declaration before this fix).
// This file is ambient (no top-level import/export; an `import type` would
// make it a module and drop every global it declares), so they are referenced
// through inline `import()` types. Through the `/client` entry (same types):
// the root specifier is path-mapped to shared's sources, which the
// `.storybook` typecheck (it includes this file, without project references)
// rejects as outside its rootDir.
/* eslint-disable @typescript-eslint/consistent-type-imports */
type GeneratorAIDesktopShellStatePush = import('@generatorai/shared/client').DesktopShellStatePush;
type GeneratorAIDesktopServerEntry = import('@generatorai/shared/client').DesktopServerEntry;
type GeneratorAIDesktopUpdateState = import('@generatorai/shared/client').DesktopUpdateState;
type GeneratorAIDesktopAppearancePush = import('@generatorai/shared/client').DesktopAppearancePush;
type GeneratorAIDesktopAppearanceRequest = import('@generatorai/shared/client').DesktopAppearanceRequest;
type GeneratorAIDesktopWindowChrome = import('@generatorai/shared/client').WindowChrome;
type GeneratorAIDesktopWindowStateChange = import('@generatorai/shared/client').WindowStateChange;
type GeneratorAIDesktopFindInPageResult = import('@generatorai/shared/client').FindInPageResult;
type GeneratorAIDesktopBrowserBounds = import('@generatorai/shared/client').BrowserBounds;
type GeneratorAIDesktopBrowserDevtoolsPanel = import('@generatorai/shared/client').BrowserDevtoolsPanel;
type GeneratorAIDesktopBrowserEmulationParams = import('@generatorai/shared/client').BrowserEmulationParams;
type GeneratorAIDesktopNativeBrowserDescriptor = import('@generatorai/shared/client').NativeBrowserDescriptor;
type GeneratorAIDesktopNativeBrowserEvent = import('@generatorai/shared/client').NativeBrowserEvent;
type GeneratorAIDesktopBrowserPickResult = import('@generatorai/shared/client').BrowserPickResult;
type GeneratorAIDesktopBrowserAnnotatePollResult = import('@generatorai/shared/client').BrowserAnnotatePollResult;
/* eslint-enable @typescript-eslint/consistent-type-imports */

interface GeneratorAIDesktopServersApi {
  /** Every known server with its reachability, probed by the main process. */
  list: () => Promise<GeneratorAIDesktopServerEntry[]>;
  switchTo: (id: string) => Promise<void>;
  /** Opens the shell's own "Connect to a server" prompt window. */
  add: () => Promise<void>;
  onChanged: (cb: () => void) => () => void;
}

interface GeneratorAIDesktopUpdatesApi {
  getState: () => Promise<GeneratorAIDesktopUpdateState>;
  install: () => Promise<void>;
  /** Subscribing also tells the shell a renderer can show update state (it then skips its native dialog). */
  onChange: (cb: (state: GeneratorAIDesktopUpdateState) => void) => () => void;
}

/** The registry's global renderer commands (D-24) — the same union main sends. */
// This file is ambient (no top-level import/export); an `import type` would make
// it a module and drop every global it declares, so the inline import() stays.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type GeneratorAIDesktopCommand = import('@generatorai/shared/ui-contract').RendererCommandId;

interface GeneratorAIDesktopWindowApi {
  toggleMaximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
}

interface GeneratorAIDesktopBridge {
  isDesktop: true;
  browser?: GeneratorAIDesktopBrowserApi;

  /**
   * Restarts the embedded server process. Needed after changing the network
   * exposure mode, because the bind address and the startup security gates
   * are resolved once at boot.
   */
  restartServer?: () => Promise<void>;

  // ── Window chrome / native menu integration ──
  getWindowChrome?: () => Promise<GeneratorAIDesktopWindowChrome>;
  window?: GeneratorAIDesktopWindowApi;
  setMenuState?: (state: Partial<GeneratorAIDesktopShellStatePush>) => Promise<void>;
  servers?: GeneratorAIDesktopServersApi;
  updates?: GeneratorAIDesktopUpdatesApi;
  onWindowStateChanged?: (
    cb: (state: GeneratorAIDesktopWindowStateChange) => void,
  ) => () => void;
  onCommand?: (cb: (command: GeneratorAIDesktopCommand) => void) => () => void;
  onNavigate?: (cb: (path: string) => void) => () => void;
  /** A mode picked in the native View ▸ Appearance menu; ThemeProvider applies it. */
  onAppearanceRequest?: (cb: (request: GeneratorAIDesktopAppearanceRequest) => void) => () => void;
  /** Mirror the applied appearance into the shell (background, caption glyphs, themeSource). */
  setAppearance?: (appearance: GeneratorAIDesktopAppearancePush) => Promise<void>;

  // ── OS file manager ──
  /** Reveals a path in Finder / File Explorer. False when it is not on this machine. */
  showItemInFolder?: (fullPath: string) => Promise<boolean>;

  // ── Find in page (Chromium does the searching) ──
  findInPage?: (text: string, opts?: { forward?: boolean; findNext?: boolean }) => Promise<void>;
  stopFindInPage?: () => Promise<void>;
  onFoundInPage?: (
    cb: (result: GeneratorAIDesktopFindInPageResult) => void,
  ) => () => void;

  // Additional bridge methods (getAppInfo, selectDirectory, …) exist at
  // runtime but are not surfaced here because the SPA already accesses
  // them via loose optional-chain access.
}

interface Window {
  generatoraiDesktop?: GeneratorAIDesktopBridge;
}
