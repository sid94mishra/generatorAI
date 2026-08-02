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

interface GeneratorAIDesktopBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GeneratorAIDesktopNativeBrowserDescriptor {
  tabId: string;
  workspaceId: string;
  currentUrl: string | null;
  title: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  cdpEndpoint: string | null;
}

interface GeneratorAIDesktopNativeBrowserEvent {
  tabId: string;
  workspaceId: string;
  url?: string;
  title?: string;
  isMainFrame?: boolean;
  errorCode?: number;
  errorDescription?: string;
  favicon?: string;
  loading?: boolean;
}

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
  openDevtools: (tabId: string, panel?: 'elements' | 'network' | 'console' | 'sources') => Promise<void>;
  setEmulation: (
    tabId: string,
    params: { width: number; height: number; deviceScaleFactor?: number; mobile?: boolean } | null,
  ) => Promise<void>;
  setZoom: (tabId: string, factor: number) => Promise<void>;
  pickElement: (tabId: string) => Promise<{
    url: string;
    tag: string;
    id: string | null;
    classes: string[];
    label: string;
    text: string;
    cssSelector: string;
    xpath: string;
    outerHtml: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    computedStyle?: Record<string, string>;
    screenshot?: string | null;
  } | null>;
  captureRegion: (tabId: string) => Promise<string | null>;
  annotateStart: (tabId: string, theme?: 'light' | 'dark') => Promise<void>;
  annotateStop: (tabId: string) => Promise<void>;
  annotatePoll: (tabId: string) => Promise<{
    total: number;
    items: Array<{ key: string; n: number; label: string; tag: string; comment: string; region: boolean }>;
    sent: Array<{
      key?: string;
      url: string;
      tag: string;
      id: string | null;
      classes: string[];
      label: string;
      text: string;
      cssSelector: string;
      xpath: string;
      outerHtml: string;
      boundingBox: { x: number; y: number; width: number; height: number };
      computedStyle?: Record<string, string>;
      screenshot?: string | null;
      comment?: string;
    }>;
  }>;
  annotateSend: (tabId: string, keys?: string[]) => Promise<Array<{
    key?: string;
    url: string;
    tag: string;
    id: string | null;
    classes: string[];
    label: string;
    text: string;
    cssSelector: string;
    xpath: string;
    outerHtml: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    computedStyle?: Record<string, string>;
    screenshot?: string | null;
    comment?: string;
  }>>;
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

/** Where the OS paints its window controls, so the SPA can leave room. */
interface GeneratorAIDesktopWindowChrome {
  platform: 'darwin' | 'win32' | 'linux';
  /** `native` = OS draws the title bar; otherwise the SPA draws it. */
  titleBarStyle: 'native' | 'hidden-inset' | 'overlay';
  titleBarHeight: number;
  /** Reserved px on the left (macOS traffic lights). */
  insetLeft: number;
  /** Reserved px on the right (Windows/Linux min-max-close). */
  insetRight: number;
  isWayland: boolean;
}

/** Renderer UI state mirrored into the native menu (checkmarks, enablement). */
interface GeneratorAIDesktopMenuState {
  sidebarOpen: boolean;
  rightPaneOpen: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  theme: 'system' | 'light' | 'dark';
  recent: Array<{ label: string; route: string }>;
}

interface GeneratorAIDesktopWindowStateChange {
  maximized: boolean;
  fullScreen: boolean;
  focused: boolean;
}

type GeneratorAIDesktopCommand =
  | 'new-chat'
  | 'new-workflow'
  | 'new-project'
  | 'new-automation'
  | 'command-palette'
  | 'focus-search'
  | 'find-next'
  | 'toggle-sidebar'
  | 'toggle-right-pane'
  | 'show-shortcuts'
  | 'reload-scripts';

interface GeneratorAIDesktopWindowApi {
  toggleMaximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
}

interface GeneratorAIDesktopBridge {
  isDesktop: true;
  browser?: GeneratorAIDesktopBrowserApi;

  // ── Window chrome / native menu integration ──
  getWindowChrome?: () => Promise<GeneratorAIDesktopWindowChrome>;
  window?: GeneratorAIDesktopWindowApi;
  setMenuState?: (state: Partial<GeneratorAIDesktopMenuState>) => Promise<void>;
  onWindowStateChanged?: (
    cb: (state: GeneratorAIDesktopWindowStateChange) => void,
  ) => () => void;
  onCommand?: (cb: (command: GeneratorAIDesktopCommand) => void) => () => void;
  onNavigate?: (cb: (path: string) => void) => () => void;

  // Additional bridge methods (getAppInfo, selectDirectory, …) exist at
  // runtime but are not surfaced here because the SPA already accesses
  // them via loose optional-chain access.
}

interface Window {
  generatoraiDesktop?: GeneratorAIDesktopBridge;
}
