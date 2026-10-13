// ────────────────────────────────────────────────────────────────
// browser-host — Native Chromium WebContentsView manager for the
// GeneratorAI desktop app. Phase 2 of INTEGRATED_BROWSER_IMPLEMENTATION_PLAN.
//
// This is intentionally minimal: it owns a Map<workspaceId, WebContentsView>
// and positions each view as a floating child of the main BrowserWindow at
// coordinates supplied by the renderer via IPC. Each tab has its own
// persistent session partition with a deny-all permission policy
// (session-hardening.ts) and same-origin/OAuth-only popup gating; agent CDP
// attach goes through a per-tab ScopedCdpProxy. Cert overrides for loopback
// live in index.ts.
//
// Feature flag: see `nativeBrowserEnabled()` below. ON by default in the
// desktop app; set `GENERATORAI_DESKTOP_NATIVE_BROWSER=0` to opt out. When
// disabled, `isEnabled()` returns false and none of the IPC handlers do
// anything — the SPA falls back to the server-Playwright screencast path,
// preserving parity with the web build.
// ────────────────────────────────────────────────────────────────

import { BrowserWindow as ElectronBrowserWindow, WebContentsView, session as electronSession } from 'electron';
import type { BrowserWindow } from 'electron';
import { EventEmitter } from 'node:events';
import { log } from './logger';
import { ScopedCdpProxy } from './cdp/ScopedCdpProxy';
import { getIpcToken } from './cdp/ipc-token';
import { getServerManager } from './server-manager';
import { hardenBrowserTabSession } from './session-hardening';
import { DEFAULT_ANNOTATION_PALETTE, type AnnotationPalette } from './annotation-palette';
import { annotateOverlayScript } from './annotate-overlay';
import { acquireElectronDebugger, type ElectronDebuggerLease } from './cdp/electron-debugger-lease';

/** What a mobile device reports in device mode (D-144): current iOS Safari. */
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
import type {
  BrowserBounds,
  BrowserEmulationParams,
  BrowserPickResult,
  BrowserAnnotatePollResult,
  BrowserCaptureResult,
  NativeBrowserDescriptor,
  NativeBrowserEvent,
} from '../shared/browser-ipc';

/**
 * Whether the agent drives a native Electron `WebContentsView` (through a
 * per-tab `ScopedCdpProxy`) instead of a separately launched Chromium.
 *
 * **On by default in the desktop app.** The alternative — the server's
 * `ServerPlaywrightHost` — calls `chromium.launchPersistentContext()`, which
 * needs browser binaries that `npx playwright install` downloads into a
 * user-level cache. A packaged install has no such cache, so defaulting the
 * other way would ship a browser feature that fails the first time it is
 * used. Attaching over CDP to the Chromium already inside Electron needs no
 * download, and the agent and the user end up driving the same tab.
 *
 * Other clients (web, mobile, CLI, standalone server) keep the Playwright
 * path, where installing browsers is a reasonable ask.
 */
export function nativeBrowserEnabled(): boolean {
  return process.env['GENERATORAI_DESKTOP_NATIVE_BROWSER'] !== '0';
}

/** Largest favicon inlined as a data URL; anything bigger is not an icon. */
const MAX_FAVICON_BYTES = 256 * 1024;

/**
 * A page favicon as a `data:` URL, or undefined when it is missing, not an
 * image, too large, or cannot be fetched within a few seconds.
 */
async function faviconAsDataUrl(
  sess: Electron.Session,
  url: string | undefined,
): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith('data:image/')) return url;
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    const res = await sess.fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return undefined;
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    if (!type.startsWith('image/')) return undefined;
    const body = Buffer.from(await res.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > MAX_FAVICON_BYTES) return undefined;
    return `data:${type};base64,${body.toString('base64')}`;
  } catch {
    return undefined;
  }
}

// The embedded server can still be starting (or restarting after a crash)
// when a browser tab activates, so the endpoint push gets a few tries
// before we give up and discard the proxy.
const CDP_ENDPOINT_PUSH_ATTEMPTS = 3;
const CDP_ENDPOINT_PUSH_BACKOFF_MS = [250, 1000];

// Well-known OAuth/SSO login-popup hosts. Deliberately a short, curated
// list of the providers agents actually hit in practice — not an attempt
// at exhaustive coverage. Add to this list rather than loosening the
// same-origin default.
const KNOWN_OAUTH_PROVIDER_HOSTS = [
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'github.com',
  'appleid.apple.com',
  'www.facebook.com',
  'facebook.com',
  'login.okta.com',
  'auth0.com',
];

function isKnownOAuthProvider(hostname: string): boolean {
  return KNOWN_OAUTH_PROVIDER_HOSTS.some(
    (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
  );
}

interface Session {
  /** Globally-unique tab id — the primary key for every host operation. */
  tabId: string;
  /** Owning workspace. Only the active tab of a workspace carries the
   *  durable `gai-<workspaceId>` discovery marker the server binds to. */
  workspaceId: string;
  view: WebContentsView;
  visible: boolean;
  lastBounds: BrowserBounds | null;
  /** Last favicon as a data URL, so a remounted renderer can show it again. */
  favicon: string | null;
  /**
   * Set when the app document that placed this view was replaced (reload,
   * full navigation, renderer crash) without releasing it. An orphan is
   * hidden and stays hidden until a document claims it again through
   * `create()`; one nobody claims is destroyed by the reaper.
   */
  orphaned: boolean;
  /**
   * Settles when the view's first load — the `about:blank#gai-…` discovery
   * page `create()` starts — has finished, whichever way it went. Every later
   * navigation waits on it; see `navigate()`.
   */
  ready: Promise<void>;
  /**
   * The page the hidden agent tab handed this tab (D-105), reported as its URL until its own page commits — so the
   * dock does not restore the tab's remembered page over the one the agent is working on (U-65).
   */
  handedOverUrl?: string;
}

/**
 * How long a view whose document went away waits to be claimed again.
 *
 * Long enough for the app to boot after a reload and remount the chat that
 * owns the tab — which keeps the page, its history and any agent connection
 * alive across Cmd+R — and short enough that a tab nobody is coming back for
 * does not hold a renderer process open for the rest of the session.
 */
export const ORPHAN_GRACE_MS = 30_000;

// The in-page Annotate overlay (D-140): see annotate-overlay.ts.
const ANNOTATE_SCRIPT = annotateOverlayScript(DEFAULT_ANNOTATION_PALETTE);

export class NativeBrowserHost extends EventEmitter {
  /** All browser tabs across all workspaces, keyed by tabId. */
  private sessions = new Map<string, Session>();
  private ownerWindow: BrowserWindow | null = null;
  /** The active (visible, agent-bound) tabId for each workspace. Only the
   *  active tab carries the `gai-<workspaceId>` discovery marker so the
   *  server-side ElectronBridgeAdapter always drives whichever tab the
   *  user is currently viewing ("follow the active tab"). */
  private activeTab = new Map<string, string>();
  /** Tabs with the in-page annotation overlay active (keyed by tabId).
   *  Used to re-inject the overlay after navigations wipe window scope. */
  private annotating = new Set<string>();
  /** Scoped CDP proxy for the currently-active tab of each workspace that
   *  has one running. Never more than one live proxy per workspace — see
   *  `ensureActiveProxy()`. Replaces the old app-wide `--remote-debugging-
   *  port` switch: each proxy exposes exactly one tab's webContents. */
  private cdpProxies = new Map<string, ScopedCdpProxy>();
  /** The tab whose proxy endpoint the server currently holds, per workspace. When that tab's proxy stops (a hand-over
   *  from the hidden agent tab, a tab switch) the endpoint is cleared at once, so the server waits for the next tab's
   *  endpoint instead of dialling a dead port (U-60). */
  private postedTab = new Map<string, string>();
  /** Endpoint pushes per workspace, chained so a clear never lands after the push that replaced it. */
  private pushes = new Map<string, Promise<boolean>>();
  /** Pending sweep of views orphaned by the last document change. */
  private orphanReaper: ReturnType<typeof setTimeout> | null = null;
  /**
   * D-105: the never-shown window agent tabs live in. A view hidden in (or placed outside) the app window renders at
   * 0×0 — no layout, empty screenshots — while a hidden window that paints keeps a real viewport.
   */
  private agentWindow: BrowserWindow | null = null;
  /** Tabs in device mode (D-144): the debugger lease it holds and the tab's own user agent. */
  private emulations = new Map<string, { lease: ElectronDebuggerLease; userAgent: string }>();

  isEnabled(): boolean {
    return nativeBrowserEnabled();
  }

  attachOwnerWindow(win: BrowserWindow): void {
    // Idempotent: the IPC `create` handler re-attaches on every browser tab
    // create (the window may not have existed when registerIpc ran). Without
    // this guard each create adds another `closed` listener, tripping
    // EventEmitter's MaxListeners warning once >10 tabs are opened.
    if (this.ownerWindow === win) return;
    this.ownerWindow = win;
    // When the window is destroyed we drop everything.
    win.once('closed', () => {
      this.disposeAll();
      this.ownerWindow = null;
    });

    // THE VIEWS BELONG TO A DOCUMENT, NOT TO THE WINDOW.
    //
    // A view is placed, shown, hidden and destroyed by the page: React mounts
    // a placeholder, mirrors its rect here, and releases the view in an effect
    // cleanup. That contract only holds while the page gets to run its
    // cleanups, and replacing the document skips every one of them. Reload, a
    // Cmd/Ctrl/middle-click on an in-app link (the window-open handler turns
    // that into `loadURL`), the error boundary's "Back to home", a backend
    // switch, the crash page — after any of these the view was still a child
    // of the window, still visible, at the rectangle of a pane that no longer
    // existed, painting a web page over whatever screen the user had gone to.
    // Nothing in the new document knew it was there, so nothing could ever
    // hide it; it stayed until the window closed.
    //
    // `did-navigate` rather than `did-start-navigation`: it fires once a new
    // main-frame document has COMMITTED. A navigation that never commits — a
    // download, a 204, one the user cancels — leaves the old page and its
    // browser pane exactly where they were, and must leave the view alone.
    // Same-document route changes (`pushState`) report as
    // `did-navigate-in-page` and are the page's own business.
    const wc = win.webContents;
    wc.on('did-navigate', () => this.orphanAll('the app document was replaced'));
    wc.on('render-process-gone', () => this.orphanAll('the app renderer exited'));
  }

  /**
   * Take every view away from a document that can no longer manage it.
   *
   * Hidden at once — that is the visible bug — but not destroyed: after a
   * reload the same chat normally remounts within a second or two and asks for
   * the same `tabId`, and handing it the live view back keeps the page state
   * and the agent's CDP connection. What is not claimed within
   * `ORPHAN_GRACE_MS` is destroyed.
   */
  private orphanAll(reason: string): void {
    if (this.sessions.size === 0) return;
    for (const sess of this.sessions.values()) {
      sess.orphaned = true;
      sess.visible = false;
      try { sess.view.setVisible(false); } catch { /* view already gone */ }
    }
    log.info(`[NativeBrowserHost] hid ${this.sessions.size} view(s): ${reason}`);
    if (this.orphanReaper) clearTimeout(this.orphanReaper);
    this.orphanReaper = setTimeout(() => {
      this.orphanReaper = null;
      for (const sess of Array.from(this.sessions.values())) {
        if (!sess.orphaned) continue;
        log.info(`[NativeBrowserHost] reaping unclaimed tab=${sess.tabId}`);
        this.destroy(sess.tabId);
      }
    }, ORPHAN_GRACE_MS);
    // Never the reason the app cannot quit.
    this.orphanReaper.unref?.();
  }

  create(tabId: string, workspaceId: string, active = false): NativeBrowserDescriptor {
    if (!this.isEnabled()) return this.blankDescriptor(tabId, workspaceId);
    if (!this.ownerWindow) throw new Error('[NativeBrowserHost] Owner window not attached yet');
    let sess = this.sessions.get(tabId);
    if (sess) {
      // Claimed again by the document that replaced the one it was placed by.
      // It stays hidden until that document positions and shows it.
      sess.orphaned = false;
      // Tab reuse (e.g. Start pressed again after a server-side stop).
      // Re-assert the discovery marker (active tab carries the durable
      // `gai-<workspaceId>` marker so the server adapter can find it).
      if (active) this.activeTab.set(workspaceId, tabId);
      this.applyMarker(sess);
      return this.describe(tabId);
    }

    // Per-TAB persistent partition so cookies + local storage survive across
    // sessions but stay isolated between tabs of the same workspace.
    const partition = `persist:browser-${tabId}`;
    const tabSession = electronSession.fromPartition(partition);
    // Electron GRANTS every permission request on a session with no handler.
    // A site the agent lands on must not get the camera, microphone,
    // location, screen capture or notifications without anyone asking — the
    // policy is deny-all, with an allow-list hook in session-hardening.ts.
    hardenBrowserTabSession(tabSession);
    const view = new WebContentsView({
      webPreferences: {
        session: tabSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        // Prevent auto-focus stealing from the SPA during layout dance.
        // Focus flows through explicit IPC in a later phase.
        // (Electron typing: cast via Record; property exists at runtime.)
        ...( { focusOnNavigation: false } as Record<string, boolean> ),
      },
    });
    // Allow same-origin popups and a small set of well-known OAuth/SSO
    // providers (a login popup is the single most common legitimate popup
    // use case; everything else defaults to deny). Electron's default
    // child window has no URL bar at all — a popup's OS-native title bar
    // shows only its `document.title`, never the URL — so there's no
    // separate "origin-only address bar" to build; the safety property
    // ("never expose the full URL, which can carry tokens") is already
    // the platform default we're relying on here, not a custom UI.
    view.webContents.setWindowOpenHandler(({ url }) => {
      let targetHost = '';
      try { targetHost = new URL(url).hostname; } catch { return { action: 'deny' }; }
      let originHost = '';
      try { originHost = new URL(view.webContents.getURL()).hostname; } catch { /* about:blank on first popup — fall through to allowlist */ }
      if (originHost && targetHost === originHost) return { action: 'allow' };
      if (isKnownOAuthProvider(targetHost)) return { action: 'allow' };
      return { action: 'deny' };
    });
    view.webContents.on('did-create-window', (popupWindow) => {
      popupWindow.setMenuBarVisibility(false);
    });

    // Wire lifecycle events so the SPA can update its URL bar / status pill.
    // Every event carries both tabId (the addressed view) and workspaceId.
    const wc = view.webContents;
    // Chrome-like tab spinner: did-start-loading → spinner, did-stop-loading
    // → resolved (favicon/title). Emitted separately from navigation commits.
    wc.on('did-start-loading', () => {
      this.emit('loading-changed', { tabId, workspaceId, loading: true } as NativeBrowserEvent);
    });
    wc.on('did-stop-loading', () => {
      this.emit('loading-changed', { tabId, workspaceId, loading: false } as NativeBrowserEvent);
    });
    wc.on('did-navigate', (_e, url) => {
      this.emit('did-navigate', { tabId, workspaceId, url, isMainFrame: true } as NativeBrowserEvent);
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      this.emit('did-navigate', { tabId, workspaceId, url, isMainFrame } as NativeBrowserEvent);
    });
    wc.on('did-finish-load', () => {
      // Re-assert the discovery marker after every load so the server-side
      // adapter can find this WCV even after it navigated away from the
      // `about:blank#gai-<id>` fragment. Active tabs get the workspace
      // marker; inactive tabs get their own tab marker.
      const s = this.sessions.get(tabId);
      if (s) this.applyMarker(s);
      // Navigations wipe the page's window scope, so re-install + re-activate
      // the annotation overlay when this tab is in annotate mode.
      if (this.annotating.has(tabId)) {
        wc.executeJavaScript(`${ANNOTATE_SCRIPT};window.__GAI_ANNO&&window.__GAI_ANNO.start()`, true).catch(() => undefined);
      }
      this.emit('did-finish-load', { tabId, workspaceId, url: wc.getURL() } as NativeBrowserEvent);
    });
    wc.on('did-fail-load', (_e, errorCode, errorDescription, url, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorCode === -3) return; // ERR_ABORTED, benign
      this.emit('did-fail-load', { tabId, workspaceId, url, errorCode, errorDescription } as NativeBrowserEvent);
    });
    wc.on('page-title-updated', (_e, title) => {
      this.emit('title-updated', { tabId, workspaceId, title } as NativeBrowserEvent);
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      // The app's CSP only admits `data:` / `blob:` images, so a remote favicon
      // URL handed to the renderer was blocked and every tab showed a generic
      // globe. Fetch it here — through the tab's own session, so it carries
      // that tab's cookies and proxy — and pass a data URL instead.
      void faviconAsDataUrl(wc.session, favicons[0]).then((favicon) => {
        if (wc.isDestroyed()) return;
        const owner = this.sessions.get(tabId);
        if (owner) owner.favicon = favicon ?? null;
        this.emit('favicon-updated', { tabId, workspaceId, favicon } as NativeBrowserEvent);
      });
    });

    this.ownerWindow.contentView.addChildView(view);
    // Hidden until the renderer has placed it and marked it visible.
    view.setVisible(false);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

    sess = { tabId, workspaceId, view, visible: false, lastBounds: null, favicon: null, orphaned: false, ready: Promise.resolve() };
    this.sessions.set(tabId, sess);
    // First tab of a workspace (or an explicit `active`) becomes the active
    // tab and inherits the workspace discovery marker.
    if (active || !this.activeTab.has(workspaceId)) this.activeTab.set(workspaceId, tabId);

    // Navigate to the marker URL BEFORE any real navigation so
    // `ElectronBridgeAdapter.discoverTargetPage()` can find this WCV via
    // `page.url()` scanning. The active tab uses the workspace fragment
    // (`#gai-<workspaceId>`) the server binds to; inactive tabs use a
    // per-tab fragment so they are never mistaken for the workspace target.
    const isActive = this.activeTab.get(workspaceId) === tabId;
    const frag = isActive ? `#gai-${workspaceId}` : `#gai-tab-${tabId}`;
    sess.ready = wc.loadURL(`about:blank${frag}`).then(() => undefined, () => undefined);

    log.info(`[NativeBrowserHost] created tab=${tabId} workspace=${workspaceId} active=${isActive} partition=${partition}`);
    // D-105: the person opened a Browser tab while the agent browses in its hidden tab — this tab takes over now
    // (its first "visible" tick can arrive before this create resolved, so waiting for it raced).
    const current = this.activeTab.get(workspaceId);
    if (!isAgentTabId(tabId) && current && current !== tabId && isAgentTabId(current)) {
      this.setActiveTab(workspaceId, tabId);
      return this.describe(tabId);
    }
    void this.ensureActiveProxy(workspaceId);
    return this.describe(tabId);
  }

  /**
   * Ensure exactly one `ScopedCdpProxy` is running, scoped to the currently
   * active tab of `workspaceId` — never a sibling tab, never the app's main
   * window. Tears down any proxy left over from a previously-active tab of
   * this workspace first, then starts one for the new active tab if it
   * doesn't have one yet, and pushes the resulting `ws://` endpoint to the
   * embedded server so `ElectronBridgeAdapter` can reconnect to it.
   */
  private async ensureActiveProxy(workspaceId: string): Promise<void> {
    if (!this.isEnabled()) return;
    const activeTabId = this.activeTab.get(workspaceId);
    if (!activeTabId) return;
    const sess = this.sessions.get(activeTabId);
    if (!sess) return;

    for (const [tabId, proxy] of this.cdpProxies) {
      const siblingSess = this.sessions.get(tabId);
      if (siblingSess && siblingSess.workspaceId === workspaceId && tabId !== activeTabId) {
        this.cdpProxies.delete(tabId);
        void proxy.stop().catch(() => undefined);
        this.clearPostedEndpoint(workspaceId, tabId);
      }
    }

    if (this.cdpProxies.has(activeTabId)) return; // already proxying the active tab

    let proxy: ScopedCdpProxy | null = null;
    try {
      proxy = new ScopedCdpProxy(sess.view.webContents);
      const wsUrl = await proxy.start();
      this.cdpProxies.set(activeTabId, proxy);
      const pushed = await this.pushEndpoint(workspaceId, wsUrl);
      if (pushed) this.postedTab.set(workspaceId, activeTabId);
      if (!pushed) {
        // The proxy is live but the server never learned its address, so
        // nothing can ever connect to it. Leaving it cached would strand a
        // listening socket AND make every later call sit through the
        // adapter's full discovery timeout waiting for an endpoint that is
        // never coming. Drop it instead so the next activation retries from
        // scratch.
        this.cdpProxies.delete(activeTabId);
        await proxy.stop().catch(() => undefined);
        log.warn(`[NativeBrowserHost] scoped CDP proxy discarded (endpoint push failed) tab=${activeTabId}`);
        return;
      }
      log.info(`[NativeBrowserHost] scoped CDP proxy started tab=${activeTabId} workspace=${workspaceId}`);
    } catch (err) {
      // start() can throw after the debugger was attached; make sure we do
      // not leave a half-open proxy behind on the failure path either.
      this.cdpProxies.delete(activeTabId);
      if (proxy) await proxy.stop().catch(() => undefined);
      log.warn('[NativeBrowserHost] failed to start scoped CDP proxy', err);
    }
  }

  /** Push (or clear, with `wsUrl: null`) a workspace's scoped CDP endpoint
   *  to the embedded server. Retries a few times because the server may
   *  still be coming up (or briefly restarting) when a tab activates.
   *  Returns whether the endpoint actually landed, so the caller can avoid
   *  keeping a proxy the server can never reach. A permanent failure just
   *  leaves the agent CDP path unavailable for this workspace, matching the
   *  old flag-off behavior — it never breaks the native WCV the user sees. */
  private pushEndpoint(workspaceId: string, wsUrl: string | null): Promise<boolean> {
    const next = (this.pushes.get(workspaceId) ?? Promise.resolve(true)).catch(() => false).then(() => this.postCdpEndpoint(workspaceId, wsUrl));
    this.pushes.set(workspaceId, next);
    void next.finally(() => {
      if (this.pushes.get(workspaceId) === next) this.pushes.delete(workspaceId);
    });
    return next;
  }

  /** The server's endpoint for `workspaceId` came from `tabId`'s proxy, which just stopped: clear it. */
  private clearPostedEndpoint(workspaceId: string, tabId: string): void {
    if (this.postedTab.get(workspaceId) !== tabId) return;
    this.postedTab.delete(workspaceId);
    void this.pushEndpoint(workspaceId, null);
  }

  private async postCdpEndpoint(workspaceId: string, wsUrl: string | null): Promise<boolean> {
    const token = getIpcToken();
    if (!token) return false;
    for (let attempt = 0; attempt < CDP_ENDPOINT_PUSH_ATTEMPTS; attempt += 1) {
      // Re-read each attempt: a restarting server comes back on a new port.
      const base = getServerManager().url;
      if (base) {
        try {
          const res = await fetch(`${base}/internal/browser/cdp-endpoint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ workspaceId, wsUrl }),
          });
          if (res.ok) return true;
          // 4xx means the request itself is wrong (bad token, bad body) —
          // retrying an identical request cannot fix that.
          if (res.status >= 400 && res.status < 500) {
            log.warn(`[NativeBrowserHost] cdp-endpoint push rejected: HTTP ${res.status}`);
            return false;
          }
          log.warn(`[NativeBrowserHost] cdp-endpoint push failed: HTTP ${res.status}`);
        } catch (err) {
          log.warn('[NativeBrowserHost] cdp-endpoint push failed', err);
        }
      }
      if (attempt < CDP_ENDPOINT_PUSH_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, CDP_ENDPOINT_PUSH_BACKOFF_MS[attempt] ?? 1000));
      }
    }
    return false;
  }

  /**
   * Write the navigation-durable discovery marker into a tab's
   * `window.name`. The ACTIVE tab of a workspace carries `gai-<workspaceId>`
   * (the marker the server-side ElectronBridgeAdapter binds to); every other
   * tab carries `gai-tab-<tabId>` so it is never mistaken for the workspace
   * target. `window.name` survives same-tab cross-origin navigations, so the
   * out-of-process adapter can still find the right WCV after navigation.
   * Best-effort and idempotent: we only overwrite `window.name` when it is
   * empty or already one of our markers, so we never clobber a site value.
   */
  private applyMarker(sess: Session): void {
    const isActive = this.activeTab.get(sess.workspaceId) === sess.tabId;
    const marker = isActive ? `gai-${sess.workspaceId}` : `gai-tab-${sess.tabId}`;
    const js = `try{var m=${JSON.stringify(marker)};if(!window.name||/^gai-/.test(window.name))window.name=m;}catch(e){}`;
    // `true` = user gesture; harmless here. Fire-and-forget: discovery polls.
    sess.view.webContents.executeJavaScript(js, true).catch(() => undefined);
  }

  /**
   * Mark `tabId` as the active (visible, agent-bound) tab for its workspace.
   * Moves the durable `gai-<workspaceId>` discovery marker onto the newly
   * active tab and demotes every sibling tab to its own `gai-tab-<id>`
   * marker, so the server-side adapter re-binds to whatever the user is
   * viewing ("follow the active tab").
   */
  setActiveTab(workspaceId: string, tabId: string): void {
    if (!this.sessions.has(tabId)) return;
    const previous = this.activeTab.get(workspaceId);
    this.activeTab.set(workspaceId, tabId);
    // D-105: the person opened a Browser tab where the agent was browsing in its hidden tab — the new tab takes over
    // the agent's page and the hidden tab goes away, so the agent and the person keep seeing one page.
    if (previous && previous !== tabId && isAgentTabId(previous)) this.handOverAgentTab(previous, tabId);
    for (const s of this.sessions.values()) {
      if (s.workspaceId === workspaceId) this.applyMarker(s);
    }
    void this.ensureActiveProxy(workspaceId);
  }

  /**
   * D-105: a tab for the agent when the workspace has none (the server asked over IPC: an agent's browser call with the
   * Browser dock closed). Laid out at a desktop size outside the window's visible area, so pages render and
   * screenshots have pixels, and made the workspace's active tab so its scoped CDP endpoint is pushed. An existing tab
   * is used as it is.
   */
  ensureAgentTab(workspaceId: string): void {
    if (!this.isEnabled() || !this.ownerWindow) {
      log.warn(`[NativeBrowserHost] no agent tab for workspace=${workspaceId}: ${this.isEnabled() ? 'no app window' : 'native browser off'}`);
      return;
    }
    const active = this.activeTab.get(workspaceId);
    if (active && this.sessions.has(active)) {
      void this.ensureActiveProxy(workspaceId);
      return;
    }
    const tabId = agentTabId(workspaceId);
    this.create(tabId, workspaceId, true);
    const sess = this.sessions.get(tabId);
    if (sess) {
      // Moved into the hidden agent window, shown there at a desktop size: nobody sees it, pages lay out and
      // screenshots have pixels.
      try { this.ownerWindow.contentView.removeChildView(sess.view); } catch { /* not attached */ }
      this.agentHost().contentView.addChildView(sess.view);
      sess.lastBounds = { ...AGENT_TAB_BOUNDS };
      sess.visible = true;
      sess.view.setBounds(sess.lastBounds);
      sess.view.setVisible(true);
    }
    log.info(`[NativeBrowserHost] agent tab for workspace=${workspaceId} (no Browser dock tab was open)`);
  }

  private agentHost(): BrowserWindow {
    if (this.agentWindow && !this.agentWindow.isDestroyed()) return this.agentWindow;
    const win = new ElectronBrowserWindow({
      show: false,
      width: AGENT_TAB_BOUNDS.width,
      height: AGENT_TAB_BOUNDS.height,
      paintWhenInitiallyHidden: true,
      skipTaskbar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    win.on('closed', () => { if (this.agentWindow === win) this.agentWindow = null; });
    // Its own page is never used, but a never-loaded page stalls CDP clients that enumerate the app's targets.
    void win.loadURL('about:blank').catch(() => undefined);
    this.agentWindow = win;
    return win;
  }

  private handOverAgentTab(agentTab: string, toTab: string): void {
    const agent = this.sessions.get(agentTab);
    const next = this.sessions.get(toTab);
    if (agent && next) {
      const url = agent.view.webContents.getURL();
      const nextUrl = next.view.webContents.getURL();
      // A tab created a moment ago has no URL yet (its blank discovery page is still loading).
      if (url && !url.startsWith('about:') && (!nextUrl || nextUrl.startsWith('about:'))) {
        next.handedOverUrl = url;
        void this.navigate(toTab, url).catch(() => undefined);
      }
    }
    this.destroy(agentTab);
  }

  destroy(tabId: string): void {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    this.emulations.get(tabId)?.lease.release();
    this.emulations.delete(tabId);
    const proxy = this.cdpProxies.get(tabId);
    if (proxy) {
      this.cdpProxies.delete(tabId);
      void proxy.stop().catch(() => undefined);
      this.clearPostedEndpoint(sess.workspaceId, tabId);
    }
    try {
      if (this.ownerWindow && !this.ownerWindow.isDestroyed()) {
        this.ownerWindow.contentView.removeChildView(sess.view);
      }
    } catch { /* ignore */ }
    try {
      if (this.agentWindow && !this.agentWindow.isDestroyed()) this.agentWindow.contentView.removeChildView(sess.view);
    } catch { /* ignore */ }
    try {
      // Cast through unknown to invoke destroy() where Electron typings
      // vary between minor versions.
      const wc = sess.view.webContents as unknown as { destroy?: () => void; close?: () => void };
      if (typeof wc.close === 'function') wc.close();
      else if (typeof wc.destroy === 'function') wc.destroy();
    } catch { /* ignore */ }
    this.sessions.delete(tabId);
    this.annotating.delete(tabId);
    // If this was the workspace's active tab, drop the pointer so the next
    // create()/setActiveTab() promotes a sibling tab to carry the marker.
    if (this.activeTab.get(sess.workspaceId) === tabId) this.activeTab.delete(sess.workspaceId);
    // The hidden agent window lives only while it hosts an agent tab: a lingering window would keep the app from
    // quitting where closing the last visible window quits it (Windows, Linux).
    if (isAgentTabId(tabId) && ![...this.sessions.keys()].some(isAgentTabId)) this.closeAgentWindow();
    log.info(`[NativeBrowserHost] destroyed tab=${tabId} workspace=${sess.workspaceId}`);
  }

  setBounds(tabId: string, bounds: BrowserBounds): void {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    const w = Math.max(0, Math.round(bounds.width));
    const h = Math.max(0, Math.round(bounds.height));
    const x = Math.max(0, Math.round(bounds.x));
    const y = Math.max(0, Math.round(bounds.y));
    sess.lastBounds = { x, y, width: w, height: h };
    if (sess.visible) sess.view.setBounds({ x, y, width: w, height: h });
  }

  setVisible(tabId: string, visible: boolean): void {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    // Only `create()` hands an orphan to a new owner. A "show" that was already
    // in flight from the document that just went away must not put the view
    // back on screen with nobody left to hide it.
    if (sess.orphaned && visible) return;
    sess.visible = visible;
    // A real hide. "Hiding" by collapsing the view to a 0×0 rect at the window
    // origin still left it painting there — the browser page appeared over the
    // top-left of the app whenever another right-pane tab was selected. The
    // bounds are left alone so showing it again needs no fresh layout.
    if (visible && sess.lastBounds) sess.view.setBounds(sess.lastBounds);
    sess.view.setVisible(visible);
  }

  async navigate(tabId: string, url: string): Promise<NativeBrowserDescriptor> {
    const sess = this.sessions.get(tabId);
    if (!sess) throw new Error(`No browser tab ${tabId}`);
    // Only http(s) — mirror VSCode simple-browser's opener host allowlist
    // approach and refuse `file:`, `javascript:`, etc. for the SPA's URL bar.
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    // Two navigations started a few milliseconds apart do not resolve in the
    // order they were asked for. A remounted tab restores its page the instant
    // `create()` returns, while the discovery page `create()` itself started
    // is still in flight — and more often than not the blank page committed
    // LAST, silently dropping the restore. The tab came back empty two times
    // out of three. Let the first load land, then navigate.
    await sess.ready;
    if (!this.sessions.has(tabId) || sess.view.webContents.isDestroyed()) {
      throw new Error(`No browser tab ${tabId}`);
    }
    await sess.view.webContents.loadURL(url).catch((err: unknown) => {
      log.warn('[NativeBrowserHost] loadURL failed', err);
    });
    return this.describe(tabId);
  }

  back(tabId: string): void {
    const sess = this.sessions.get(tabId);
    // Electron 33+ deprecated `webContents.goBack()` in favor of
    // `webContents.navigationHistory.goBack()`. Support both.
    const wc = sess?.view.webContents as unknown as {
      navigationHistory?: { goBack?: () => void };
      goBack?: () => void;
    };
    if (wc?.navigationHistory?.goBack) wc.navigationHistory.goBack();
    else if (typeof wc?.goBack === 'function') wc.goBack();
  }

  forward(tabId: string): void {
    const sess = this.sessions.get(tabId);
    const wc = sess?.view.webContents as unknown as {
      navigationHistory?: { goForward?: () => void };
      goForward?: () => void;
    };
    if (wc?.navigationHistory?.goForward) wc.navigationHistory.goForward();
    else if (typeof wc?.goForward === 'function') wc.goForward();
  }

  /**
   * Reload bypassing the cache. This browser previews the user's own site
   * while an agent edits it; a plain reload re-validates only the document, so
   * a stylesheet the agent just changed could still come from the cache.
   */
  reload(tabId: string): void {
    const sess = this.sessions.get(tabId);
    sess?.view.webContents.reloadIgnoringCache();
  }

  async screenshot(tabId: string): Promise<string | null> {
    const sess = this.sessions.get(tabId);
    if (!sess) return null;
    // A hidden view has no surface to capture: Chromium answers
    // `UnknownVizError`, after doing the work of trying. Every mounted browser
    // tab asks once a second, so each hidden one cost a failed capture and a
    // warning in the log per second, forever.
    if (!sess.visible || sess.orphaned) return null;
    try {
      const image = await sess.view.webContents.capturePage();
      if (image.isEmpty()) return null;
      // JPEG, not PNG: this is a throwaway placeholder painted behind the live
      // view. A PNG of a full pane is several hundred KB, base64'd and pushed
      // over IPC every tick; the JPEG is a tenth of that.
      return `data:image/jpeg;base64,${image.toJPEG(70).toString('base64')}`;
    } catch (err) {
      log.warn('[NativeBrowserHost] capturePage failed', err);
      return null;
    }
  }

  /**
   * Apply Chromium device emulation to the workspace's WebContentsView
   * (the same primitive DevTools' "device toolbar" uses). Passing `null`
   * disables emulation and restores the real view metrics. This lets the
   * SPA offer responsive-design testing (mobile/tablet widths, DPR) without
   * resizing the actual native view rectangle.
   */
  setEmulation(tabId: string, params: BrowserEmulationParams | null): void {
    void this.applyEmulation(tabId, params).catch((err) => log.warn('[NativeBrowserHost] setEmulation failed', err));
  }

  /**
   * Device mode the way a real browser's DevTools does it (D-144): the page
   * lays out at the device's CSS size with its pixel ratio and the mobile
   * viewport (so media queries and `vw` follow the device), paints scaled to
   * fit the frame the renderer sized the view to, and — for a mobile device —
   * gets touch events and a mobile user agent. Held through a debugger lease
   * so it coexists with the agent's CDP connection; `null` restores the tab.
   */
  private async applyEmulation(tabId: string, params: BrowserEmulationParams | null): Promise<void> {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    const wc = sess.view.webContents;
    let emu = this.emulations.get(tabId);
    if (!params) {
      if (!emu) return;
      this.emulations.delete(tabId);
      try {
        await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
        await wc.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
        await wc.debugger.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: false });
        await wc.debugger.sendCommand('Emulation.setUserAgentOverride', { userAgent: emu.userAgent });
      } finally {
        emu.lease.release();
      }
      return;
    }
    if (!emu) {
      emu = { lease: acquireElectronDebugger(wc), userAgent: wc.getUserAgent() };
      this.emulations.set(tabId, emu);
    }
    const width = Math.max(1, Math.round(params.width));
    const height = Math.max(1, Math.round(params.height));
    const mobile = params.mobile === true;
    const dpr = params.deviceScaleFactor && params.deviceScaleFactor > 0 ? params.deviceScaleFactor : mobile ? 3 : 1;
    await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: dpr,
      mobile,
      scale: params.scale && params.scale > 0 ? params.scale : 1,
      screenWidth: width,
      screenHeight: height,
      screenOrientation: width > height ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 },
    });
    await wc.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
    await wc.debugger.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: mobile, configuration: 'mobile' });
    await wc.debugger.sendCommand('Emulation.setUserAgentOverride', { userAgent: mobile ? MOBILE_USER_AGENT : emu.userAgent });
  }

  /** Set the page zoom factor (1 = 100%). */
  setZoom(tabId: string, factor: number): void {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    const clamped = Math.max(0.25, Math.min(5, factor || 1));
    try {
      sess.view.webContents.setZoomFactor(clamped);
    } catch (err) {
      log.warn('[NativeBrowserHost] setZoom failed', err);
    }
  }

  /**
   * Region capture for the native view. Injects a drag-to-select overlay
   * that resolves with a viewport-relative rect, then captures just that
   * rectangle via `webContents.capturePage(rect)` and returns a PNG data
   * URL. Resolves `null` on Escape or a zero-size drag.
   */
  async captureRegion(tabId: string, palette: AnnotationPalette = DEFAULT_ANNOTATION_PALETTE): Promise<string | null> {
    const sess = this.sessions.get(tabId);
    if (!sess) return null;
    const wc = sess.view.webContents;
    const dragScript = String.raw`(function(){return new Promise(function(resolve){
      var ID='__gai_cap_ov', C=${JSON.stringify(palette)};
      function tint(a){var h=C.accent;return 'rgba('+parseInt(h.slice(1,3),16)+','+parseInt(h.slice(3,5),16)+','+parseInt(h.slice(5,7),16)+','+a+')';}
      var old=document.getElementById(ID); if(old) old.remove();
      var layer=document.createElement('div'); layer.id=ID;
      layer.style.cssText='position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.05);';
      var box=document.createElement('div');
      box.style.cssText='position:fixed;border:2px solid '+C.accent+';background:'+tint(0.15)+';pointer-events:none;left:0;top:0;width:0;height:0;';
      layer.appendChild(box); document.documentElement.appendChild(layer);
      var start=null;
      function md(e){e.preventDefault();start={x:e.clientX,y:e.clientY};box.style.left=start.x+'px';box.style.top=start.y+'px';box.style.width='0px';box.style.height='0px';}
      function mm(e){if(!start)return;var x=Math.min(start.x,e.clientX),y=Math.min(start.y,e.clientY);box.style.left=x+'px';box.style.top=y+'px';box.style.width=Math.abs(e.clientX-start.x)+'px';box.style.height=Math.abs(e.clientY-start.y)+'px';}
      function done(rect){cleanup();resolve(rect);}
      function mu(e){if(!start){return;}var x=Math.min(start.x,e.clientX),y=Math.min(start.y,e.clientY),w=Math.abs(e.clientX-start.x),h=Math.abs(e.clientY-start.y);if(w<6||h<6){done(null);}else{done({x:x,y:y,width:w,height:h});}}
      function key(e){if(e.key==='Escape')done(null);}
      function cleanup(){layer.removeEventListener('mousedown',md,true);layer.removeEventListener('mousemove',mm,true);layer.removeEventListener('mouseup',mu,true);document.removeEventListener('keydown',key,true);layer.remove();}
      layer.addEventListener('mousedown',md,true);
      layer.addEventListener('mousemove',mm,true);
      layer.addEventListener('mouseup',mu,true);
      document.addEventListener('keydown',key,true);
    });})()`;
    try {
      const rect = (await wc.executeJavaScript(dragScript, true)) as { x: number; y: number; width: number; height: number } | null;
      if (!rect) return null;
      const image = await wc.capturePage({
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      });
      return image.toDataURL();
    } catch (err) {
      log.warn('[NativeBrowserHost] captureRegion failed', err);
      return null;
    }
  }

  // ── Annotate overlay (D-140) ───────────────────────────────────
  //
  // The overlay (`annotate-overlay.ts`) only selects and pins inside the page;
  // the comment form and list are React, in the Comments panel under the view
  // (D-145). `annotatePoll` reports saved comments, the pending selection and
  // Esc-to-leave; `annotateSave` / `annotateCancel` settle the selection.
  // `annotateSend` captures each comment IN CONTEXT — scrolled into view,
  // padded, only its own pin and outline showing — then removes the sent
  // comments from the page so none can be sent twice.

  private async ensureAnnotate(wc: WebContentsView['webContents']): Promise<void> {
    await wc.executeJavaScript(`${ANNOTATE_SCRIPT};true`, true).catch(() => undefined);
  }

  async annotateStart(tabId: string, palette: AnnotationPalette = DEFAULT_ANNOTATION_PALETTE): Promise<void> {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    this.annotating.add(tabId);
    await this.ensureAnnotate(sess.view.webContents);
    await sess.view.webContents
      .executeJavaScript(`window.__GAI_ANNO&&window.__GAI_ANNO.start(${JSON.stringify(palette)})`, true)
      .catch(() => undefined);
    // Hover and Esc need the page to have the pointer's attention.
    try { sess.view.webContents.focus(); } catch { /* view gone */ }
  }

  async annotateStop(tabId: string): Promise<void> {
    const sess = this.sessions.get(tabId);
    this.annotating.delete(tabId);
    if (!sess) return;
    await sess.view.webContents.executeJavaScript('window.__GAI_ANNO&&window.__GAI_ANNO.stop()', true).catch(() => undefined);
  }

  async annotateOpen(tabId: string, key: string): Promise<void> {
    const sess = this.sessions.get(tabId);
    if (!sess || typeof key !== 'string') return;
    await sess.view.webContents
      .executeJavaScript(`window.__GAI_ANNO&&window.__GAI_ANNO.open(${JSON.stringify(key)})`, true)
      .catch(() => undefined);
  }

  async annotateRemove(tabId: string, key: string): Promise<void> {
    const sess = this.sessions.get(tabId);
    if (!sess || typeof key !== 'string') return;
    await sess.view.webContents
      .executeJavaScript(`window.__GAI_ANNO&&window.__GAI_ANNO.remove(${JSON.stringify(key)})`, true)
      .catch(() => undefined);
  }

  async annotateClear(tabId: string): Promise<void> {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    await sess.view.webContents.executeJavaScript('window.__GAI_ANNO&&window.__GAI_ANNO.clear()', true).catch(() => undefined);
  }

  async annotatePoll(tabId: string): Promise<BrowserAnnotatePollResult> {
    const empty: BrowserAnnotatePollResult = { items: [], pending: null, exit: false };
    const sess = this.sessions.get(tabId);
    if (!sess) return empty;
    const wc = sess.view.webContents;
    try {
      // A navigation wiped the page's scope: put the overlay back (and on).
      if (this.annotating.has(tabId)) {
        const live = (await wc.executeJavaScript('!!window.__GAI_ANNO', true)) as boolean;
        if (!live) {
          await this.ensureAnnotate(wc);
          await wc.executeJavaScript(`window.__GAI_ANNO&&window.__GAI_ANNO.start()`, true);
        }
      }
      const raw = (await wc.executeJavaScript('window.__GAI_ANNO?window.__GAI_ANNO.poll():null', true)) as
        | (BrowserAnnotatePollResult & { picked?: boolean })
        | null;
      if (!raw) return empty;
      // Something was just selected: the comment form is in the app, so the
      // keyboard has to go back there from the page the user clicked in.
      if (raw.picked) {
        try { this.ownerWindow?.webContents.focus(); } catch { /* window gone */ }
      }
      return { items: Array.isArray(raw.items) ? raw.items : [], pending: raw.pending ?? null, exit: raw.exit === true };
    } catch {
      return empty;
    }
  }

  async annotateSave(tabId: string, key: string, comment: string, intent: string): Promise<boolean> {
    const sess = this.sessions.get(tabId);
    if (!sess || typeof key !== 'string' || typeof comment !== 'string' || !comment.trim()) return false;
    const ok = await sess.view.webContents
      .executeJavaScript(
        `window.__GAI_ANNO?window.__GAI_ANNO.save(${JSON.stringify(key)},${JSON.stringify(comment.trim())},${JSON.stringify(String(intent || 'fix'))}):false`,
        true,
      )
      .catch(() => false);
    return ok === true;
  }

  async annotateCancel(tabId: string, key: string): Promise<void> {
    const sess = this.sessions.get(tabId);
    if (!sess || typeof key !== 'string') return;
    await sess.view.webContents
      .executeJavaScript(`window.__GAI_ANNO&&window.__GAI_ANNO.cancel(${JSON.stringify(key)})`, true)
      .catch(() => undefined);
  }

  async annotateSend(tabId: string, keys?: string[]): Promise<BrowserPickResult[]> {
    const sess = this.sessions.get(tabId);
    if (!sess) return [];
    const wc = sess.view.webContents;
    const wanted = Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : [];
    let list: Array<{ key: string }>;
    try {
      list = (await wc.executeJavaScript('window.__GAI_ANNO?window.__GAI_ANNO.list():[]', true)) as Array<{ key: string }>;
    } catch {
      return [];
    }
    const targets = list.map((i) => i.key).filter((k) => wanted.length === 0 || wanted.includes(k));
    const shots = new Map<string, string | null>();
    for (const key of targets) {
      try {
        const rect = (await wc.executeJavaScript(`window.__GAI_ANNO.focus(${JSON.stringify(key)})`, true)) as
          | { x: number; y: number; width: number; height: number }
          | null;
        // Let the scroll and the isolated pin paint before capturing.
        await new Promise((r) => setTimeout(r, 120));
        if (rect && rect.width >= 1 && rect.height >= 1) {
          const image = await wc.capturePage({
            x: Math.max(0, Math.round(rect.x)),
            y: Math.max(0, Math.round(rect.y)),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
          });
          shots.set(key, image.isEmpty() ? null : image.toDataURL());
        }
      } catch {
        shots.set(key, null);
      }
    }
    try {
      await wc.executeJavaScript('window.__GAI_ANNO&&window.__GAI_ANNO.unfocus()', true);
      const items = (await wc.executeJavaScript(
        `window.__GAI_ANNO?window.__GAI_ANNO.take(${JSON.stringify(targets)}):[]`,
        true,
      )) as BrowserPickResult[];
      if (!Array.isArray(items)) return [];
      for (const item of items) item.screenshot = (item.key && shots.get(item.key)) ?? null;
      return items;
    } catch {
      return [];
    }
  }

  /**
   * A user screenshot of the page as a PNG. `visible` is the viewport;
   * `full` is the whole scrollable page through CDP (`captureBeyondViewport`),
   * capped at 16k px tall — and the viewport when CDP is unavailable or stalls,
   * reported as `mode: 'visible'` so the UI can say so.
   */
  async capture(tabId: string, mode: 'visible' | 'full'): Promise<BrowserCaptureResult | null> {
    const sess = this.sessions.get(tabId);
    if (!sess || !sess.visible || sess.orphaned) return null;
    const wc = sess.view.webContents;
    if (mode === 'full') {
      const full = await this.captureFullPage(wc).catch(() => null);
      if (full) return { dataUrl: full, mode: 'full' };
    }
    try {
      const image = await wc.capturePage();
      return image.isEmpty() ? null : { dataUrl: image.toDataURL(), mode: 'visible' };
    } catch (err) {
      log.warn('[NativeBrowserHost] capture failed', err);
      return null;
    }
  }

  private async captureFullPage(wc: WebContentsView['webContents']): Promise<string | null> {
    const dbg = wc.debugger;
    let lease: ElectronDebuggerLease;
    try {
      // A lease, never a bare attach/detach: the agent's CDP proxy may hold
      // the same debugger, and detaching it here would cut the agent off.
      lease = acquireElectronDebugger(wc);
    } catch {
      return null;
    }
    const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
    try {
      const metrics = (await withTimeout(dbg.sendCommand('Page.getLayoutMetrics'), 4000)) as {
        cssContentSize?: { width: number; height: number };
        contentSize?: { width: number; height: number };
      };
      const size = metrics.cssContentSize ?? metrics.contentSize;
      if (!size) return null;
      const width = Math.ceil(Math.min(size.width, 4096));
      const height = Math.ceil(Math.min(size.height, 16_384));
      const shot = (await withTimeout(
        dbg.sendCommand('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width, height, scale: 1 },
        }),
        10_000,
      )) as { data?: string };
      return shot.data ? `data:image/png;base64,${shot.data}` : null;
    } catch (err) {
      log.warn('[NativeBrowserHost] full-page capture fell back to the viewport', err);
      return null;
    } finally {
      lease.release();
    }
  }

  /**
   * Open Chromium DevTools for a workspace's WebContentsView. When a
   * `panel` is supplied (e.g. 'network') we best-effort switch the
   * DevTools frontend to that panel once it has booted. DevTools opens
   * in a detached window so it never overlaps the floating WCV.
   */
  openDevTools(tabId: string, panel?: string): void {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    const wc = sess.view.webContents;
    try {
      if (wc.isDevToolsOpened()) {
        if (panel) this.showDevToolsPanel(wc, panel);
        else wc.devToolsWebContents?.focus();
        return;
      }
      wc.openDevTools({ mode: 'detach' });
      if (panel) {
        wc.once('devtools-opened', () => this.showDevToolsPanel(wc, panel));
      }
      log.info(`[NativeBrowserHost] opened devtools tab=${tabId} panel=${panel ?? 'default'}`);
    } catch (err) {
      log.warn('[NativeBrowserHost] openDevTools failed', err);
    }
  }

  /**
   * Best-effort switch of the DevTools frontend to a named panel. The
   * DevTools window exposes different internal globals across Chromium
   * versions, so we try a few known entry points and swallow failures —
   * if none match, DevTools simply stays on its last-used panel.
   */
  private showDevToolsPanel(wc: WebContentsView['webContents'], panel: string): void {
    const dt = wc.devToolsWebContents;
    if (!dt) return;
    const script = `(() => { try {
      const id = ${JSON.stringify(panel)};
      const ui = globalThis.UI;
      if (ui?.viewManager?.showView) { ui.viewManager.showView(id); return true; }
      if (ui?.inspectorView?.showPanel) { ui.inspectorView.showPanel(id); return true; }
      return false;
    } catch { return false; } })()`;
    // Give the DevTools frontend a moment to finish booting before we
    // poke its internal view manager.
    setTimeout(() => { void dt.executeJavaScript(script).catch(() => undefined); }, 400);
  }

  describe(tabId: string): NativeBrowserDescriptor {
    const sess = this.sessions.get(tabId);
    if (!sess) return this.blankDescriptor(tabId, '');
    const wc = sess.view.webContents;
    const navUnknown = wc as unknown as {
      navigationHistory?: { canGoBack?: () => boolean; canGoForward?: () => boolean };
      canGoBack?: () => boolean;
      canGoForward?: () => boolean;
    };
    const canGoBack = navUnknown.navigationHistory?.canGoBack?.() ?? navUnknown.canGoBack?.() ?? false;
    const canGoForward = navUnknown.navigationHistory?.canGoForward?.() ?? navUnknown.canGoForward?.() ?? false;
    const url = wc.getURL();
    return {
      tabId,
      workspaceId: sess.workspaceId,
      currentUrl: (url && !url.startsWith('about:') ? url : sess.handedOverUrl) || null,
      title: wc.getTitle() || null,
      favicon: sess.favicon,
      isLoading: wc.isLoading(),
      canGoBack,
      canGoForward,
      // Diagnostic only — never the real ws:// URL (it carries this tab's
      // proxy auth token). 'active' means a ScopedCdpProxy is currently
      // running for this tab; the server-side ElectronBridgeAdapter is the
      // only thing that actually connects to it.
      cdpEndpoint: this.cdpProxies.has(tabId) ? 'active' : null,
    };
  }

  disposeAll(): void {
    if (this.orphanReaper) { clearTimeout(this.orphanReaper); this.orphanReaper = null; }
    for (const wid of Array.from(this.sessions.keys())) {
      this.destroy(wid);
    }
    this.closeAgentWindow();
  }

  private closeAgentWindow(): void {
    const win = this.agentWindow;
    this.agentWindow = null;
    if (win && !win.isDestroyed()) win.destroy();
  }

  private blankDescriptor(tabId: string, workspaceId: string): NativeBrowserDescriptor {
    return {
      tabId,
      workspaceId,
      currentUrl: null,
      title: null,
      favicon: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      cdpEndpoint: null,
    };
  }
}

/** D-105: the hidden tab an agent browses in while no Browser dock tab is open. */
const AGENT_TAB_PREFIX = 'agent-';
const AGENT_TAB_BOUNDS = { x: 0, y: 0, width: 1280, height: 800 };
export function agentTabId(workspaceId: string): string {
  return `${AGENT_TAB_PREFIX}${workspaceId}`;
}
export function isAgentTabId(tabId: string): boolean {
  return tabId.startsWith(AGENT_TAB_PREFIX);
}

let instance: NativeBrowserHost | null = null;
export function getNativeBrowserHost(): NativeBrowserHost {
  if (!instance) instance = new NativeBrowserHost();
  return instance;
}
