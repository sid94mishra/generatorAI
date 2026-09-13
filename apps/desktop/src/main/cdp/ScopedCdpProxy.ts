// ────────────────────────────────────────────────────────────────
// ScopedCdpProxy — a per-tab CDP WebSocket server backed by
// `webContents.debugger`, replacing the app-wide `--remote-debugging-port`
// Chromium switch.
//
// Why this exists: `--remote-debugging-port` exposes EVERY webContents in
// the app over one loopback port with no auth — including the main SPA
// window, which runs a privileged preload bridge. A page loaded in a browser
// tab could in principle discover that port and use `Runtime.evaluate`
// against the main window. This proxy is scoped to exactly one `webContents`
// (the one it's constructed with) and fabricates the CDP `Target` domain so
// a CDP client (Playwright's `chromium.connectOverCDP`) sees a normal
// single-page browser with nothing else attached.
//
// Modeled on a reference Electron app's `CdpWsProxy`, which has NO
// authentication at all (security rests solely on the port being ephemeral
// and secret) and allows exactly one attached client at a time. We keep the
// single-client model but add two checks that pattern doesn't have, because
// a per-tab proxy is created far more often than a single app-lifetime port:
//   - reject any WebSocket upgrade carrying an `Origin` header (only a
//     browser page sends one — Node/Playwright's CDP client does not)
//   - require a random per-instance token as the WS path segment, checked
//     with a constant-time comparison
//
// `webContents.debugger` has no `Target` domain (Electron doesn't emulate
// multi-target CDP), so `Target.*` methods are answered locally with a
// single synthetic target/session rather than forwarded. A handful of other
// methods (`Page.captureScreenshot`, `Page.printToPDF`, `Input.insertText`,
// `Page.navigate`, `Page.reload`, `Page.bringToFront`) are rerouted around
// known Electron-guest quirks that don't affect a real Chromium CDP target
// (which is what the app used before this change) — see inline comments.
// ────────────────────────────────────────────────────────────────

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type Server } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { WebContents } from 'electron';
import { captureScreenshot } from './cdp-screenshot';
import { buildPrintToPdfOptions } from './cdp-print-to-pdf';
import { acquireElectronDebugger, type ElectronDebuggerLease } from './electron-debugger-lease';

const LIFECYCLE_PRIMING_TIMEOUT_MS = 1_000;

interface ClientMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

export class ScopedCdpProxy {
  // Holds each session's last DOM.focus params to replay right before the
  // next Input.insertText, countering the native webContents.focus() call
  // that would otherwise blur the CDP-focused node.
  private pendingDomFocusBySession = new Map<string | undefined, Promise<Record<string, unknown> | undefined>>();
  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private readonly responseSessionIdsByClient = new WeakMap<WebSocket, Map<number, string>>();
  private detachClientListeners: (() => void) | null = null;
  private port = 0;
  private readonly token = randomUUID();
  private debuggerMessageHandler: ((...args: unknown[]) => void) | null = null;
  private debuggerDetachHandler: ((...args: unknown[]) => void) | null = null;
  private debuggerLease: ElectronDebuggerLease | null = null;
  private attached = false;
  // The synthetic page-session id handed back from the first Target.attachToTarget.
  // A CDP client filters events by this id; Electron emits '' for root-session events.
  private clientSessionId: string | undefined = undefined;
  private readonly clientSessionIds = new Set<string>();
  private readonly clientBrowserSessionIds = new Set<string>();
  private nextClientSessionOrdinal = 0;
  private nextClientBrowserSessionOrdinal = 0;

  /**
   * The tab's real main-frame id, used as the advertised target id.
   *
   * Chromium guarantees a page target's id IS its main frame's id, and
   * Playwright depends on it: it looks up the session that owns a frame by
   * walking up to a frame whose id is a target id. With an invented
   * `gai-proxy-target` that walk never matched, Playwright threw while
   * attaching the main frame, and the page it handed back had no frame at all
   * — an empty URL, and every evaluate (every agent browser tool) hung.
   * Chromium keeps the main frame id across cross-process navigations.
   */
  private mainFrameId: string | null = null;

  constructor(private readonly webContents: WebContents) {}

  /** Start the proxy and return its `ws://127.0.0.1:<port>/<token>` URL. */
  async start(): Promise<string> {
    await this.attachDebugger();
    await this.refreshMainFrameId();
    return new Promise<string>((resolve, reject) => {
      this.httpServer = createServer((_req, res) => {
        // No HTTP discovery surface at all — a caller must already have the
        // full ws:// URL (including the token) from `start()`'s return
        // value. `chromium.connectOverCDP()` is given that URL directly, so
        // it never needs `/json/version` or `/json/list`.
        res.writeHead(404);
        res.end();
      });
      this.wss = new WebSocketServer({
        server: this.httpServer,
        verifyClient: (info, done) => {
          if (info.origin) {
            // Only a browser page sends an Origin header on a WebSocket
            // upgrade; Playwright's Node-side CDP client does not.
            done(false, 403, 'Forbidden');
            return;
          }
          const host = info.req.headers.host ?? '';
          if (host !== `127.0.0.1:${this.port}`) {
            done(false, 403, 'Forbidden');
            return;
          }
          if (!this.pathMatchesToken(info.req.url)) {
            done(false, 401, 'Unauthorized');
            return;
          }
          done(true);
        },
      });

      const failStart = (error: Error): void => {
        this.httpServer?.removeListener('error', onListenError);
        this.wss?.close();
        this.wss = null;
        this.httpServer?.close();
        this.httpServer = null;
        // A bind failure happens after debugger attach; release it here
        // because callers cannot safely call stop() on a failed start.
        this.detachDebugger();
        reject(error);
      };
      const onListenError = (error: Error): void => failStart(error);

      this.wss.on('connection', (ws) => {
        this.closeClient();
        this.client = ws;
        const onMessage = (data: WebSocket.RawData): void => this.handleClientMessage(ws, data.toString());
        const onClose = (): void => {
          detach();
          if (this.client === ws) {
            this.clearClientState();
            this.client = null;
          }
        };
        const detach = (): void => {
          ws.off('message', onMessage);
          ws.off('close', onClose);
          if (this.detachClientListeners === detach) this.detachClientListeners = null;
        };
        this.detachClientListeners = detach;
        ws.on('message', onMessage);
        ws.on('close', onClose);
      });

      this.httpServer.listen(0, '127.0.0.1', () => {
        this.httpServer?.removeListener('error', onListenError);
        const addr = this.httpServer!.address();
        if (typeof addr === 'object' && addr) {
          this.port = addr.port;
          resolve(`ws://127.0.0.1:${this.port}/${this.token}`);
        } else {
          failStart(new Error('Failed to bind proxy server'));
        }
      });
      this.httpServer.once('error', onListenError);
    });
  }

  async stop(): Promise<void> {
    this.detachDebugger();
    this.closeClient();
    if (this.wss) { this.wss.close(); this.wss = null; }
    if (this.httpServer) { this.httpServer.close(); this.httpServer = null; }
  }

  getPort(): number {
    return this.port;
  }

  private pathMatchesToken(url?: string): boolean {
    const got = (url ?? '').replace(/^\//, '').split('?')[0] ?? '';
    const a = Buffer.from(got);
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private closeClient(): void {
    const client = this.client;
    this.detachClientListeners?.();
    this.detachClientListeners = null;
    this.client = null;
    this.clearClientState();
    if (client) this.responseSessionIdsByClient.delete(client);
    client?.close();
  }

  private clearClientState(): void {
    this.pendingDomFocusBySession.clear();
    this.clientSessionId = undefined;
    this.clientSessionIds.clear();
    this.clientBrowserSessionIds.clear();
    this.nextClientSessionOrdinal = 0;
    this.nextClientBrowserSessionOrdinal = 0;
  }

  private send(payload: unknown, client = this.client): void {
    const responsePayload = client ? this.addResponseSessionId(payload, client) : payload;
    if (client?.readyState === WebSocket.OPEN) client.send(JSON.stringify(responsePayload));
  }

  private addResponseSessionId(payload: unknown, client: WebSocket): unknown {
    if (typeof payload !== 'object' || payload === null) return payload;
    const clientId = (payload as { id?: unknown }).id;
    if (typeof clientId !== 'number') return payload;
    const responseSessionIds = this.responseSessionIdsByClient.get(client);
    const sessionId = responseSessionIds?.get(clientId);
    responseSessionIds?.delete(clientId);
    return sessionId ? { ...payload, sessionId } : payload;
  }

  private sendResult(clientId: number, result: unknown, client = this.client): void {
    this.send({ id: clientId, result }, client);
  }

  private sendError(clientId: number, message: string, client = this.client): void {
    this.send({ id: clientId, error: { code: -32000, message } }, client);
  }

  private async enableRuntimeWithContexts(
    client: WebSocket,
    clientId: number,
    params: Record<string, unknown>,
    msgSessionId?: string,
  ): Promise<void> {
    await this.sendDebuggerCommand('Runtime.disable', {}, this.resolveDebuggerSessionId(msgSessionId)).catch(() => undefined);
    if (!this.isActiveClient(client)) return;
    this.forwardCommand(client, clientId, 'Runtime.enable', params, msgSessionId);
  }

  private async refreshMainFrameId(): Promise<void> {
    if (this.webContents.isDestroyed()) return;
    try {
      const tree = await this.sendDebuggerCommand('Page.getFrameTree', {}) as
        | { frameTree?: { frame?: { id?: unknown } } }
        | undefined;
      const id = tree?.frameTree?.frame?.id;
      if (typeof id === 'string' && id.length > 0) this.mainFrameId = id;
    } catch {
      /* keep the last known id; the synthetic fallback still attaches */
    }
  }

  private buildTargetInfo(): Record<string, unknown> {
    const destroyed = this.webContents.isDestroyed();
    return {
      targetId: this.mainFrameId ?? 'gai-proxy-target',
      type: 'page',
      title: destroyed ? '' : this.webContents.getTitle(),
      url: destroyed ? '' : this.webContents.getURL(),
      attached: true,
      canAccessOpener: false,
      // Playwright's CRBrowser._onAttachedToTarget asserts this is truthy —
      // it doesn't need to match a real Target.createBrowserContext call,
      // any non-empty id makes it fall back to the connection's default
      // context, which is exactly the one page we're exposing.
      browserContextId: 'gai-proxy-context',
    };
  }

  /** Register a new synthetic page-session id and make it the default
   *  (first-attached) session client events without an explicit session
   *  restore onto. Shared by `Target.attachToTarget` (client-driven attach,
   *  used by some CDP clients) and the proactive `Target.attachedToTarget`
   *  event `setAutoAttach` triggers (the flow Playwright's `connectOverCDP`
   *  actually uses — it never calls `attachToTarget` itself). */
  private attachSyntheticPageSession(): string {
    const sessionId = this.nextSyntheticPageSessionId();
    this.clientSessionIds.add(sessionId);
    this.clientSessionId ??= sessionId;
    return sessionId;
  }

  private async attachDebugger(): Promise<void> {
    if (this.attached) return;
    try {
      this.debuggerLease = acquireElectronDebugger(this.webContents);
    } catch {
      throw new Error('Could not attach debugger. DevTools may already be open for this tab.');
    }
    this.attached = true;

    this.debuggerMessageHandler = (_event: unknown, ...rest: unknown[]) => {
      const [method, params, sessionId] = rest as [string, Record<string, unknown>, string | undefined];
      if (!this.client || this.client.readyState !== WebSocket.OPEN) return;
      // Electron passes '' (not undefined) for root-session events; restore
      // the client's own synthetic session id so it can filter on it.
      const msg: Record<string, unknown> = { method, params };
      msg.sessionId = sessionId || this.clientSessionId;
      this.client.send(JSON.stringify(msg));
    };
    this.debuggerDetachHandler = () => {
      this.attached = false;
      const lease = this.debuggerLease;
      this.debuggerLease = null;
      lease?.release();
      void this.stop();
    };
    this.webContents.debugger.on('message', this.debuggerMessageHandler as never);
    this.webContents.debugger.on('detach', this.debuggerDetachHandler as never);
  }

  private detachDebugger(): void {
    if (this.debuggerMessageHandler) {
      this.webContents.debugger.removeListener('message', this.debuggerMessageHandler as never);
      this.debuggerMessageHandler = null;
    }
    if (this.debuggerDetachHandler) {
      this.webContents.debugger.removeListener('detach', this.debuggerDetachHandler as never);
      this.debuggerDetachHandler = null;
    }
    const lease = this.debuggerLease;
    this.debuggerLease = null;
    lease?.release();
    this.attached = false;
  }

  private handleClientMessage(client: WebSocket, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id == null || !msg.method) return;
    const clientId = msg.id;

    const responseSessionIds = this.responseSessionIdsByClient.get(client) ?? new Map();
    if (msg.sessionId) responseSessionIds.set(clientId, msg.sessionId);
    else responseSessionIds.delete(clientId);
    this.responseSessionIdsByClient.set(client, responseSessionIds);

    if (msg.method === 'Target.getTargets') {
      this.sendResult(clientId, { targetInfos: [this.buildTargetInfo()] }, client);
      return;
    }
    if (msg.method === 'Target.getTargetInfo') {
      this.sendResult(clientId, { targetInfo: this.buildTargetInfo() }, client);
      return;
    }
    if (msg.method === 'Target.setDiscoverTargets' || msg.method === 'Target.detachFromTarget') {
      if (msg.method === 'Target.detachFromTarget') {
        const detachedSessionId = msg.params?.['sessionId'];
        if (typeof detachedSessionId === 'string') {
          this.clientSessionIds.delete(detachedSessionId);
          this.clientBrowserSessionIds.delete(detachedSessionId);
          if (detachedSessionId === this.clientSessionId) {
            this.clientSessionId = this.clientSessionIds.values().next().value;
          }
        }
      }
      this.sendResult(clientId, {}, client);
      return;
    }
    if (msg.method === 'Target.attachToBrowserTarget') {
      const sessionId = this.nextSyntheticBrowserSessionId();
      this.clientBrowserSessionIds.add(sessionId);
      this.sendResult(clientId, { sessionId }, client);
      return;
    }
    if (msg.method === 'Target.attachToTarget') {
      const sessionId = this.attachSyntheticPageSession();
      this.sendResult(clientId, { sessionId }, client);
      return;
    }
    if (msg.method === 'Browser.getVersion') {
      // Deliberately not "GeneratorAI/Electron" — that string would flag this
      // as an embedded automation surface to any fingerprinting page.
      const chromeVersion = process.versions.chrome ?? '134.0.0.0';
      this.sendResult(clientId, { protocolVersion: '1.3', product: `Chrome/${chromeVersion}`, userAgent: '', jsVersion: '' }, client);
      return;
    }
    // Browser-level command Electron's webContents.debugger doesn't
    // implement (it has no Browser domain) — no-op success is sufficient;
    // Playwright only uses this to route future downloads.
    if (msg.method === 'Browser.setDownloadBehavior' && !msg.sessionId) {
      this.sendResult(clientId, {}, client);
      return;
    }
    // Playwright's `connectOverCDP` never calls `Target.attachToTarget`
    // itself — it calls `Target.setAutoAttach` and waits for the browser to
    // proactively emit `Target.attachedToTarget`. Real multi-target
    // Chromium does this automatically; our single-target proxy has to do
    // it by hand. The SAME method scoped to our page's own session (asking
    // to auto-attach to that page's child targets, of which there are none)
    // just needs an empty success — no event.
    if (msg.method === 'Target.setAutoAttach') {
      this.sendResult(clientId, {}, client);
      if (!msg.sessionId) {
        // Synchronous, like Chromium: Playwright expects the attach event in
        // step with this reply. The main-frame id was read in `start()`.
        const sessionId = this.attachSyntheticPageSession();
        this.send({
          method: 'Target.attachedToTarget',
          params: { sessionId, targetInfo: this.buildTargetInfo(), waitingForDebugger: false },
        }, client);
      }
      return;
    }

    const effectiveSessionId = this.resolveDebuggerSessionId(msg.sessionId);
    // A stored focus is only valid for the immediately following
    // Input.insertText; any other command may have moved DOM focus, so
    // invalidate the replay in one place.
    if (msg.method !== 'DOM.focus' && msg.method !== 'Input.insertText') {
      this.pendingDomFocusBySession.delete(effectiveSessionId);
    }

    // Every client shares one Electron debugger session, so `Runtime` is
    // already enabled once a previous client has connected. Chromium reports
    // live execution contexts only on a disabled → enabled transition, so a
    // reconnecting client never learned the page's main world and its
    // evaluate calls hung until the next navigation. Cycling the domain makes
    // Chromium report the contexts to whoever is connected now.
    if (msg.method === 'Runtime.enable' && !this.webContents.isDestroyed()) {
      void this.enableRuntimeWithContexts(client, clientId, msg.params ?? {}, msg.sessionId);
      return;
    }

    if (msg.method === 'Page.bringToFront') {
      if (!this.webContents.isDestroyed()) this.webContents.focus();
      this.sendResult(clientId, {}, client);
      return;
    }
    if (msg.method === 'DOM.focus') {
      this.forwardDomFocus(client, clientId, msg.params ?? {}, effectiveSessionId);
      return;
    }
    // Page.captureScreenshot via debugger.sendCommand hangs on Electron guests.
    if (msg.method === 'Page.captureScreenshot') {
      this.handleScreenshot(client, clientId, msg.params);
      return;
    }
    // CDP Page.printToPDF is not available for Electron guests — use the
    // native printToPDF path instead.
    if (msg.method === 'Page.printToPDF') {
      void this.handlePrintToPdf(client, clientId, msg.params ?? {});
      return;
    }
    // Input.insertText can still require native focus in Electron guests. Do
    // not auto-focus generic Runtime.evaluate/callFunctionOn traffic — read
    // probes use those heavily, and focusing on every eval would steal the
    // user's foreground window during background automation.
    if (msg.method === 'Input.insertText' && !this.webContents.isDestroyed()) {
      this.webContents.focus();
      void this.forwardInsertText(client, clientId, msg.params ?? {}, effectiveSessionId);
      return;
    }
    // A CDP client waits for network-idle lifecycle events to detect
    // navigation completion, but Electron guest CDP subscriptions silently
    // lapse after cross-process navigations — re-prime them first.
    if (msg.method === 'Page.navigate' && !this.webContents.isDestroyed()) {
      void this.navigateWithLifecycle(client, clientId, msg.params ?? {}, msg.sessionId);
      return;
    }
    // CDP Page.reload can destroy Electron guest targets during process
    // swaps — use the direct webContents reload path for the root session.
    if (msg.method === 'Page.reload' && !this.webContents.isDestroyed()) {
      void this.reloadWithLifecycle(client, clientId, msg.params ?? {}, msg.sessionId);
      return;
    }
    this.forwardCommand(client, clientId, msg.method, msg.params ?? {}, msg.sessionId);
  }

  private resolveDebuggerSessionId(msgSessionId?: string): string | undefined {
    const syntheticSession =
      (msgSessionId && this.clientSessionIds.has(msgSessionId)) ||
      (msgSessionId && this.clientBrowserSessionIds.has(msgSessionId));
    return msgSessionId && !syntheticSession ? msgSessionId : undefined;
  }

  private nextSyntheticPageSessionId(): string {
    this.nextClientSessionOrdinal += 1;
    return this.nextClientSessionOrdinal === 1 ? 'gai-proxy-session' : `gai-proxy-session-${this.nextClientSessionOrdinal}`;
  }

  private nextSyntheticBrowserSessionId(): string {
    this.nextClientBrowserSessionOrdinal += 1;
    return this.nextClientBrowserSessionOrdinal === 1
      ? 'gai-proxy-browser-session'
      : `gai-proxy-browser-session-${this.nextClientBrowserSessionOrdinal}`;
  }

  private isActiveClient(client: WebSocket): boolean {
    return this.client === client && client.readyState === WebSocket.OPEN;
  }

  private sendDebuggerCommand(method: string, params: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    const command = sessionId
      ? this.webContents.debugger.sendCommand(method, params, sessionId)
      : this.webContents.debugger.sendCommand(method, params);
    return Promise.resolve(command);
  }

  private forwardCommand(client: WebSocket, clientId: number, method: string, params: Record<string, unknown>, msgSessionId?: string): void {
    if (this.webContents.isDestroyed()) {
      this.sendError(clientId, 'Browser tab is no longer available', client);
      return;
    }
    const sessionId = this.resolveDebuggerSessionId(msgSessionId);
    try {
      this.sendDebuggerCommand(method, params, sessionId)
        .then((result) => this.sendResult(clientId, result, client))
        .catch((err: Error) => this.sendError(clientId, err.message, client));
    } catch (err) {
      this.sendError(clientId, err instanceof Error ? err.message : String(err), client);
    }
  }

  private async navigateWithLifecycle(client: WebSocket, clientId: number, params: Record<string, unknown>, msgSessionId?: string): Promise<void> {
    await this.primePageLifecycle(this.resolveDebuggerSessionId(msgSessionId));
    if (!this.isActiveClient(client)) return;
    this.forwardCommand(client, clientId, 'Page.navigate', params, msgSessionId);
  }

  private async reloadWithLifecycle(client: WebSocket, clientId: number, params: Record<string, unknown>, msgSessionId?: string): Promise<void> {
    const sessionId = this.resolveDebuggerSessionId(msgSessionId);
    const unsupportedParam = sessionId ? null : this.getUnsupportedRootReloadParam(params);
    if (unsupportedParam) {
      this.sendError(clientId, `Page.reload parameter "${unsupportedParam}" is not supported for this tab's reload`, client);
      return;
    }
    await this.primePageLifecycle(sessionId);
    if (!this.isActiveClient(client)) return;
    if (sessionId) {
      this.forwardCommand(client, clientId, 'Page.reload', params, msgSessionId);
      return;
    }
    if (this.webContents.isDestroyed()) {
      this.sendError(clientId, 'Browser tab is no longer available', client);
      return;
    }
    try {
      if (params.ignoreCache === true) this.webContents.reloadIgnoringCache();
      else this.webContents.reload();
      this.sendResult(clientId, {}, client);
    } catch (err) {
      this.sendError(clientId, err instanceof Error ? err.message : String(err), client);
    }
  }

  private getUnsupportedRootReloadParam(params: Record<string, unknown>): string | null {
    return Object.keys(params).find((key) => key !== 'ignoreCache') ?? null;
  }

  private async primePageLifecycle(sessionId?: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const priming = (async (): Promise<void> => {
      await this.sendDebuggerCommand('Network.enable', {}, sessionId);
      await this.sendDebuggerCommand('Page.enable', {}, sessionId);
      await this.sendDebuggerCommand('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);
    })().catch(() => undefined);

    try {
      await Promise.race([
        priming,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, LIFECYCLE_PRIMING_TIMEOUT_MS);
          timeout.unref?.();
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  // Must stay synchronous up to the `.set()` call so the pending-focus entry
  // exists before a pipelined Input.insertText message can be dispatched —
  // otherwise the replay could be silently skipped.
  private forwardDomFocus(client: WebSocket, clientId: number, params: Record<string, unknown>, effectiveSessionId?: string): void {
    const focused = this.sendDomFocus(client, clientId, params, effectiveSessionId);
    this.pendingDomFocusBySession.set(effectiveSessionId, focused);
  }

  private async sendDomFocus(client: WebSocket, clientId: number, params: Record<string, unknown>, effectiveSessionId?: string): Promise<Record<string, unknown> | undefined> {
    if (this.webContents.isDestroyed()) {
      this.sendError(clientId, 'Browser tab is no longer available', client);
      return undefined;
    }
    try {
      const result = await this.sendDebuggerCommand('DOM.focus', params, effectiveSessionId);
      this.sendResult(clientId, result, client);
      return { ...params };
    } catch (err) {
      this.sendError(clientId, err instanceof Error ? err.message : String(err), client);
      return undefined;
    }
  }

  private async forwardInsertText(client: WebSocket, clientId: number, params: Record<string, unknown>, effectiveSessionId?: string): Promise<void> {
    const pendingFocus = this.pendingDomFocusBySession.get(effectiveSessionId);
    this.pendingDomFocusBySession.delete(effectiveSessionId);
    const pendingFocusParams = pendingFocus ? await pendingFocus : undefined;
    if (!this.isActiveClient(client)) return;
    if (pendingFocusParams) {
      if (this.webContents.isDestroyed()) {
        this.sendError(clientId, 'Browser tab is no longer available', client);
        return;
      }
      try {
        await this.sendDebuggerCommand('DOM.focus', pendingFocusParams, effectiveSessionId);
      } catch (err) {
        this.sendError(clientId, err instanceof Error ? err.message : String(err), client);
        return;
      }
      if (!this.isActiveClient(client)) return;
    }
    this.forwardCommand(client, clientId, 'Input.insertText', params, effectiveSessionId);
  }

  private async handlePrintToPdf(client: WebSocket, clientId: number, params: Record<string, unknown>): Promise<void> {
    if (this.webContents.isDestroyed()) {
      this.sendError(clientId, 'Browser tab is no longer available', client);
      return;
    }
    try {
      const pdf = await this.webContents.printToPDF(buildPrintToPdfOptions(params));
      if (!this.isActiveClient(client)) return;
      const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
      this.sendResult(clientId, { data: buffer.toString('base64') }, client);
    } catch (err) {
      this.sendError(clientId, err instanceof Error ? err.message : String(err), client);
    }
  }

  private handleScreenshot(client: WebSocket, clientId: number, params?: Record<string, unknown>): void {
    captureScreenshot(
      this.webContents,
      params,
      (result) => this.sendResult(clientId, result, client),
      (message) => this.sendError(clientId, message, client),
    );
  }
}
