// ────────────────────────────────────────────────────────────────
// Browser IPC — channel constants + payload types for the native
// desktop browser host (Phase 2 of INTEGRATED_BROWSER_IMPLEMENTATION_PLAN).
//
// The desktop main process embeds a `WebContentsView` per workspace and
// positions it as a floating child view over the SPA. The SPA drives it
// via these IPC channels (through the preload bridge).
//
// This is opt-in behind `GENERATORAI_DESKTOP_NATIVE_BROWSER=1`. When the
// flag is off, `desktopBrowser.available` resolves false and the SPA
// falls through to the server-Playwright screencast path.
//
// SECURITY: All channels are `invoke/handle` — no `send` fan-out. The
// main handler is expected to validate every input (workspaceId, url,
// bounds coords) before dispatching to Electron APIs.
// ────────────────────────────────────────────────────────────────

/** IPC channel names — main handles, renderer invokes. */
export const BROWSER_IPC = {
  available: 'desktop:browser:available',
  create: 'desktop:browser:create',
  destroy: 'desktop:browser:destroy',
  setActiveTab: 'desktop:browser:setActiveTab',
  setBounds: 'desktop:browser:setBounds',
  setVisible: 'desktop:browser:setVisible',
  navigate: 'desktop:browser:navigate',
  back: 'desktop:browser:back',
  forward: 'desktop:browser:forward',
  reload: 'desktop:browser:reload',
  screenshot: 'desktop:browser:screenshot',
  describe: 'desktop:browser:describe',
  openDevtools: 'desktop:browser:openDevtools',
  setEmulation: 'desktop:browser:setEmulation',
  setZoom: 'desktop:browser:setZoom',
  pickElement: 'desktop:browser:pickElement',
  captureRegion: 'desktop:browser:captureRegion',
  annotateStart: 'desktop:browser:annotateStart',
  annotateStop: 'desktop:browser:annotateStop',
  annotatePoll: 'desktop:browser:annotatePoll',
  annotateSend: 'desktop:browser:annotateSend',
  annotateRegion: 'desktop:browser:annotateRegion',
  annotateRemove: 'desktop:browser:annotateRemove',
  annotateClear: 'desktop:browser:annotateClear',
} as const;

/** DevTools panels the SPA may request when opening the inspector. */
export type BrowserDevtoolsPanel = 'elements' | 'network' | 'console' | 'sources';

/**
 * Device-emulation parameters for the native browser view. Mirrors the
 * subset of Chromium's device metrics that a responsive-design toolbar
 * needs. `null` (passed to `setEmulation`) disables emulation and restores
 * the real WebContentsView metrics.
 */
export interface BrowserEmulationParams {
  /** Emulated viewport width in CSS px. */
  width: number;
  /** Emulated viewport height in CSS px. */
  height: number;
  /** Device pixel ratio (deviceScaleFactor). Default 1. */
  deviceScaleFactor?: number;
  /** Emulate a touch/mobile device (screenPosition='mobile'). Default false. */
  mobile?: boolean;
}

/** Element-picker result returned by `pickElement`. Mirrors VS Code's
 * "select and attach UI elements to chat": the element's identity, HTML and
 * CSS, plus a cropped screenshot of just that element. */
export interface BrowserPickResult {
  url: string;
  /** Lowercase tag name (e.g. 'div', 'h1', 'button'). */
  tag: string;
  /** Element id, or null. */
  id: string | null;
  /** Class list. */
  classes: string[];
  /** Short human label like `div#hero.container` (DevTools-style). */
  label: string;
  /** Trimmed visible text content (truncated). */
  text: string;
  cssSelector: string;
  xpath: string;
  outerHtml: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  /** Curated computed CSS declarations (subset, DevTools-relevant). */
  computedStyle?: Record<string, string>;
  /** PNG data URL of just the selected element's box, or null. */
  screenshot?: string | null;
  /** Stable key assigned by the in-page annotation overlay. */
  key?: string;
  /** User's free-text comment attached to this element. */
  comment?: string;
}

/** A lightweight annotation list entry (for the count badge + popover). */
export interface BrowserAnnotationSummary {
  key: string;
  n: number;
  label: string;
  tag: string;
  comment: string;
  region: boolean;
}

/** Result of an annotation poll: live comment count + the current list. */
export interface BrowserAnnotatePollResult {
  /** Total live annotations currently pinned on the page. */
  total: number;
  /** Lightweight list of the current annotations. */
  items: BrowserAnnotationSummary[];
  /** Full notes the user pressed the card "Send" button on (drained). */
  sent: BrowserPickResult[];
}

/** Main→renderer events (browser lifecycle notifications). */
export const BROWSER_IPC_EVENT = {
  didNavigate: 'desktop:browser:did-navigate',
  didFinishLoad: 'desktop:browser:did-finish-load',
  didFailLoad: 'desktop:browser:did-fail-load',
  titleUpdated: 'desktop:browser:title-updated',
  faviconUpdated: 'desktop:browser:favicon-updated',
  loadingChanged: 'desktop:browser:loading-changed',
} as const;

/** Rect in CSS pixels relative to the main BrowserWindow's client area. */
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NativeBrowserDescriptor {
  /** Globally-unique browser tab id. */
  tabId: string;
  /** Owning workspace. */
  workspaceId: string;
  currentUrl: string | null;
  title: string | null;
  /** Page favicon as a data URL, when one has loaded. */
  favicon: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** 'active' when a scoped CDP proxy is running for this tab, else null.
   *  Diagnostic only — never the real endpoint URL (see NativeBrowserHost). */
  cdpEndpoint: string | null;
}

export interface NativeBrowserEvent {
  /** The browser tab this event belongs to. */
  tabId: string;
  workspaceId: string;
  url?: string;
  title?: string;
  isMainFrame?: boolean;
  errorCode?: number;
  errorDescription?: string;
  favicon?: string;
  /** True while the page is loading (did-start-loading .. did-stop-loading). */
  loading?: boolean;
}
