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
//
// P2-R41 — the payload types below live in `@generatorai/shared`
// (`types/DesktopShell.ts`), re-exported here, so the renderer's
// `desktop-bridge.d.ts` (which hand-declared these shapes and had already
// drifted in places) uses the exact same declarations.
// ────────────────────────────────────────────────────────────────

export type {
  BrowserBounds,
  BrowserDevtoolsPanel,
  BrowserEmulationParams,
  NativeBrowserDescriptor,
  NativeBrowserEvent,
  BrowserPickResult,
  BrowserAnnotationSummary,
  BrowserAnnotatePollResult,
  BrowserCaptureResult,
} from '@generatorai/shared';

// The overlay palette is the one browser-IPC payload declared outside shared:
// it lives next to `annotationPalette()` in `@generatorai/design-tokens`, a
// dependency-free leaf that shared must not depend on (06 §4.4). Type-only.
export type { AnnotationPalette } from '@generatorai/design-tokens';

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
  capture: 'desktop:browser:capture',
  captureRegion: 'desktop:browser:captureRegion',
  annotateStart: 'desktop:browser:annotateStart',
  annotateStop: 'desktop:browser:annotateStop',
  annotatePoll: 'desktop:browser:annotatePoll',
  annotateSend: 'desktop:browser:annotateSend',
  annotateOpen: 'desktop:browser:annotateOpen',
  annotateRemove: 'desktop:browser:annotateRemove',
  annotateClear: 'desktop:browser:annotateClear',
} as const;

/** Main→renderer events (browser lifecycle notifications). */
export const BROWSER_IPC_EVENT = {
  didNavigate: 'desktop:browser:did-navigate',
  didFinishLoad: 'desktop:browser:did-finish-load',
  didFailLoad: 'desktop:browser:did-fail-load',
  titleUpdated: 'desktop:browser:title-updated',
  faviconUpdated: 'desktop:browser:favicon-updated',
  loadingChanged: 'desktop:browser:loading-changed',
} as const;

