// ────────────────────────────────────────────────────────────────
// IBrowserBridge — domain port for the Integrated Browser feature.
//
// The bridge abstracts "somewhere there's a Chromium under CDP control".
// Two concrete implementations plug into it:
//
//   • ServerPlaywrightHost   — spawns a Playwright-managed Chromium on the
//                              server. Used by the web SPA (screencast mode).
//   • ElectronBridgeAdapter  — connects over CDP to a per-tab, per-workspace
//                              ScopedCdpProxy that Electron main runs for
//                              whichever tab is currently active (never an
//                              app-wide debugging port). Used by the desktop
//                              app (native mode).
//
// The BrowserService is the only consumer; hosts never leak vendor types
// (Playwright, Electron) out through this port — INV-1 preserved.
// ────────────────────────────────────────────────────────────────

import type {
  BrowserAction,
  BrowserConfig,
  BrowserInspectorSelection,
  BrowserMode,
  BrowserSessionStatus,
  ImportedCookie,
} from '@generatorai/shared';

/** Opaque handle returned by `start()`; passed to every follow-up call. */
export interface BrowserHandle {
  workspaceId: string;
  /** Loopback CDP endpoint URL, e.g. http://127.0.0.1:9333. */
  cdpEndpoint: string;
  /** The CDP target id of the top-level page. */
  targetId: string;
  /** How this host renders to the user. */
  mode: BrowserMode;
  /** Free-form host-owned identifier (e.g. Playwright's context id). */
  hostRef: string;
}

/** Result of an "action" the user drove from the URL bar / inspector. */
export interface PageOutcome {
  ok: boolean;
  url?: string;
  title?: string;
  error?: string;
  /**
   * Machine-readable error classification for cases the agent should react
   * to differently than a generic failure. Currently only
   * `'browser_stale_ref'`: the ref was issued by an earlier `readPage()`
   * call that has since been superseded by a newer snapshot — the fix is
   * to call `read_page` again, not to retry the same ref.
   */
  errorCode?: 'browser_stale_ref';
  /** Relative path (under workspace root) of any produced artifact. */
  artifactPath?: string;
  /** Artifact type when `artifactPath` is set. */
  artifactType?: 'browser_screenshot' | 'browser_dom' | 'browser_har' | 'browser_console_log';
  durationMs?: number;
}

/** Screencast frame payload (only used in screencast mode). */
export interface ScreencastFrame {
  /** JPEG-encoded bytes ready to write to an MJPEG stream. */
  jpeg: Buffer;
  /** Epoch ms. */
  ts: number;
}

/**
 * Discriminated union of low-level input events the user can dispatch to
 * the page through the live view. Coordinates are in **page** space (i.e.
 * the same coord system as `Playwright.Page.mouse.click(x, y)`) — the
 * SPA maps the CSS-pixel offset on the `<img>` to page coords using the
 * declared viewport size from the descriptor.
 */
export type BrowserInputEvent =
  | { type: 'mouse.move'; x: number; y: number }
  | { type: 'mouse.click'; x: number; y: number; button?: 'left' | 'right' | 'middle'; clickCount?: number }
  | { type: 'mouse.down'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'mouse.up'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'mouse.wheel'; x?: number; y?: number; deltaX: number; deltaY: number }
  | { type: 'key.press'; key: string; modifiers?: readonly ('Alt' | 'Control' | 'Meta' | 'Shift')[] }
  | { type: 'key.type'; text: string };

/** Options `start()` accepts. */
export interface BrowserStartOptions {
  workspaceRoot: string;
  workspaceId: string;
  config: BrowserConfig;
  /** Initial URL to navigate to. Optional — the caller can `navigate` later. */
  initialUrl?: string;
  /** Optional profile directory override. Defaults to <workspaceRoot>/browser/profile. */
  profileDir?: string;
}

/**
 * Callback fired by the host on every notable page-level event so the
 * BrowserService can persist artifacts and emit `browser.*` SSE events.
 * Never called synchronously from `start()` (the service subscribes AFTER
 * start resolves) so implementations should queue.
 */
export interface BrowserHostObserver {
  onAction?: (handle: BrowserHandle, action: BrowserAction, outcome?: PageOutcome) => void;
  onInspectorSelection?: (handle: BrowserHandle, sel: BrowserInspectorSelection) => void;
  onStatusChange?: (handle: BrowserHandle, status: BrowserSessionStatus) => void;
  /**
   * Fires when the host detects the browser exited unexpectedly (Chromium
   * crash, tab closed, target detached). BrowserService uses this to emit
   * `browser.error(kind='crash')` and drive restart policy.
   */
  onCrash?: (handle: BrowserHandle, error: string) => void;
}

/**
 * The port. Implementations are stateful — one instance manages many
 * concurrent handles keyed by workspaceId.
 */
export interface IBrowserBridge {
  /**
   * True if this bridge can accept `start()` calls right now (e.g. the
   * ElectronBridgeAdapter returns false when the loopback endpoint isn't
   * reachable). BrowserService falls back to the next bridge in the chain.
   */
  isAvailable(): Promise<boolean>;

  /** Start a session; returns the handle used for follow-up calls. */
  start(opts: BrowserStartOptions, observer?: BrowserHostObserver): Promise<BrowserHandle>;

  /** Gracefully terminate the session; safe to call twice. */
  stop(handle: BrowserHandle): Promise<void>;

  /** Navigate the top-level page. */
  navigate(handle: BrowserHandle, url: string): Promise<PageOutcome>;

  /** Reload. */
  reload(handle: BrowserHandle): Promise<PageOutcome>;

  /** History back. */
  back(handle: BrowserHandle): Promise<PageOutcome>;

  /** History forward. */
  forward(handle: BrowserHandle): Promise<PageOutcome>;

  /** Capture a PNG screenshot of the current viewport (persisted as artifact). */
  screenshot(handle: BrowserHandle): Promise<PageOutcome>;

  /** Serialise the current DOM (persisted as artifact). */
  domSnapshot(handle: BrowserHandle): Promise<PageOutcome>;

  /**
   * Add cookies to the session's browser context (e.g. imported from the
   * user's own installed browser via CookieImport — see BrowserService.
   * importCookies). Additive: existing cookies for other domains are left
   * alone; a cookie with the same name+domain+path is overwritten.
   */
  addCookies(handle: BrowserHandle, cookies: ImportedCookie[]): Promise<void>;

  /**
   * Toggle the inspector overlay. When `on=true`, host injects a content
   * script via CDP `Page.addScriptToEvaluateOnNewDocument` (plus one-shot
   * inject on the current page) that highlights on hover and POSTs the
   * selection payload back through the observer.
   */
  inspector(handle: BrowserHandle, on: boolean): Promise<void>;

  /**
   * Read current descriptor state (url, title, viewport, status). Cheap;
   * called by the /descriptor route.
   */
  describe(handle: BrowserHandle): Promise<{
    url?: string;
    title?: string;
    viewport?: { width: number; height: number };
  }>;

  /**
   * Return an async iterable of screencast frames. Only meaningful for
   * hosts in `screencast` mode; native hosts throw `Error('screencast unsupported')`.
   * Consumers must return / dispose the iterator when the client disconnects.
   */
  screencast(handle: BrowserHandle, opts: { fps: number; quality: number }): AsyncIterable<ScreencastFrame>;

  /**
   * Capture a single JPEG frame of the current viewport. Preferred by the
   * SPA over the MJPEG stream because it works through any HTTP proxy
   * (Vite dev, corporate proxies, load balancers) that may buffer
   * `multipart/x-mixed-replace`. Not persisted as an artifact — this is a
   * lightweight polling endpoint. Quality defaults to 60 (0-100 JPEG).
   */
  frame(handle: BrowserHandle, opts?: { quality?: number }): Promise<Buffer>;

  /**
   * Capture a PNG of an arbitrary rectangular region of the page (page
   * coordinates). Used by the SPA's drag-to-capture affordance so a
   * user-drawn selection becomes a chat attachment. Returns raw PNG bytes.
   */
  captureRegion(
    handle: BrowserHandle,
    clip: { x: number; y: number; width: number; height: number },
  ): Promise<Buffer>;

  /**
   * Dispatch a low-level input event to the page. Enables click-through,
   * text entry, scroll, and keyboard shortcuts from the SPA live view.
   * Fire-and-forget from the caller's perspective — the bridge maps to
   * Playwright's `page.mouse` / `page.keyboard` API and swallows benign
   * failures (e.g. clicking after the page navigated).
   */
  interact(handle: BrowserHandle, event: BrowserInputEvent): Promise<void>;

  /**
   * Resize the browser viewport. Called by the SPA when the panel is
   * dragged so the live view fills the panel without letterbox bars.
   * Widths/heights are clamped to a safe range internally.
   */
  resize(handle: BrowserHandle, width: number, height: number): Promise<void>;

  /**
   * Query the page's current scroll state so the SPA can render an
   * overlay scrollbar (headless Chromium doesn't paint OS scrollbars
   * in `page.screenshot`, so a custom indicator is needed).
   */
  scrollState(handle: BrowserHandle): Promise<{ scrollY: number; scrollHeight: number; clientHeight: number }>;

  // ── Agent-facing (built-in browser tools, mirrors VSCode's set) ──

  /**
   * Capture a serialised accessibility-tree snapshot of the current page.
   * Element refs (`e1`, `e2`, …) are cached on the host until the next
   * `readPage` invocation and can be passed to the ref-scoped variants
   * of `click` / `hover` / `type` / `drag` / `screenshot`.
   *
   * Prefer this over `domSnapshot` for agent input — it's ~10× smaller
   * in tokens because it drops decorative markup and keeps only the
   * interactive shape of the page.
   */
  readPage(handle: BrowserHandle): Promise<{
    url: string;
    title: string;
    /** YAML-ish accessibility tree with `[ref=e1]` tags on interactive nodes. */
    snapshot: string;
  }>;

  /**
   * Click a previously-seen element by its `readPage` ref.
   * `button`/`dblClick`/`modifiers` mirror Playwright's `Locator.click` opts.
   * Throws if the ref is unknown (usually because a re-`readPage` is needed).
   */
  clickRef(
    handle: BrowserHandle,
    ref: string,
    opts?: { button?: 'left' | 'right' | 'middle'; dblClick?: boolean; modifiers?: readonly ('Alt' | 'Control' | 'Meta' | 'Shift')[] },
  ): Promise<PageOutcome>;

  /**
   * Hover an element by its `readPage` ref (or a CSS/Playwright selector
   * if the model prefers). Useful to reveal hover-only menus before clicking.
   */
  hoverRef(handle: BrowserHandle, ref: string): Promise<PageOutcome>;

  /**
   * Type text into an element by its `readPage` ref, or press a special key.
   * Provide `text` for literal typing, `key` for named keys (e.g. `'Enter'`,
   * `'ArrowDown'`, `'Control+c'`). If both are provided, `text` is typed
   * first, followed by the key.
   */
  typeRef(
    handle: BrowserHandle,
    ref: string | null,
    opts: { text?: string; key?: string },
  ): Promise<PageOutcome>;

  /**
   * Drag one element onto another (source ref → target ref). Uses
   * Playwright's `Locator.dragTo` under the hood, which handles the
   * required mouse-down / move / up sequence with hover intents.
   */
  dragRef(handle: BrowserHandle, fromRef: string, toRef: string): Promise<PageOutcome>;

  /**
   * Screenshot a specific element (by ref) rather than the viewport.
   * Persisted as a `browser_screenshot` artifact identically to
   * `screenshot(handle)`.
   */
  screenshotRef(handle: BrowserHandle, ref: string): Promise<PageOutcome>;

  /**
   * Handle a pending browser dialog (alert / confirm / prompt / beforeunload).
   * If no dialog is pending this resolves to a no-op outcome.
   */
  handleDialogAction(
    handle: BrowserHandle,
    action: 'accept' | 'dismiss',
    promptText?: string,
  ): Promise<PageOutcome>;

  /**
   * Escape hatch — run arbitrary Playwright code with `page` injected as
   * the first argument. The code body executes inside
   * `async (page) => { ${fnDef} }` on the server, so it has full access
   * to Playwright's `page.*` API (evaluate, locator, network, tracing…).
   *
   * When `timeoutMs` is set (and > 0) the call races against that timeout;
   * on timeout, `deferredResultId` is returned instead of `result` and the
   * caller can pass it to `waitForDeferredResult` to keep waiting. This
   * pattern lets the LLM start a long op (e.g. waiting for a slow SPA to
   * settle) without blocking the whole conversation.
   *
   * Gated at the service layer by `browserConfig.evalAllowed` — the port
   * itself does not enforce.
   */
  invokeFunction(
    handle: BrowserHandle,
    fnDef: string,
    timeoutMs?: number,
  ): Promise<InvokeFunctionResult>;

  /**
   * Continue waiting for a previously-deferred {@link invokeFunction}.
   * Returns the same shape; if still incomplete, another `deferredResultId`
   * is returned so the caller can iterate.
   */
  waitForDeferredResult(
    handle: BrowserHandle,
    deferredResultId: string,
    timeoutMs: number,
  ): Promise<InvokeFunctionResult>;
}

/**
 * Result of an `invokeFunction` / `waitForDeferredResult` call.
 * Exactly one of `result | error | deferredResultId` is set at a time
 * — checked by consumers via the presence of `deferredResultId`.
 */
export interface InvokeFunctionResult {
  /** JSON-serialisable return value from the injected function. */
  result?: unknown;
  /** Non-fatal error message; the call finished but the code threw. */
  error?: string;
  /** Human-readable one-line summary — safe to bubble to the LLM. */
  summary: string;
  /** Non-empty when the call did NOT complete within `timeoutMs`. */
  deferredResultId?: string;
}
