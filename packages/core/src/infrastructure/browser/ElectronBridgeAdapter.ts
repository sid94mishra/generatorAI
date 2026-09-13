// ────────────────────────────────────────────────────────────────
// ElectronBridgeAdapter — IBrowserBridge implementation backed by a native
// Electron `WebContentsView` in the desktop main process.
//
// Security model (v14): the desktop app used to open Chromium with an
// app-wide `--remote-debugging-port`, which exposed EVERY webContents in the
// app over one unauthenticated loopback port — including the main SPA
// window and its privileged preload bridge. That flag is gone. Electron main
// (`apps/desktop/src/main/browser-host.ts`'s `NativeBrowserHost`) instead
// runs a `ScopedCdpProxy` scoped to exactly one tab's `webContents` — never
// more than one live proxy per workspace, always the currently-active tab —
// and pushes that proxy's authenticated `ws://127.0.0.1:<port>/<token>` URL
// to this server via `POST /internal/browser/cdp-endpoint` (see
// `setEndpoint()` below and `routes/internal-browser.ts`) whenever the
// active tab changes.
//
// Connection model: unlike the old design (one `chromium.connectOverCDP()`
// connection shared across all workspaces, target found by scanning for a
// `window.name`/URL-fragment marker), each workspace now gets its OWN CDP
// connection to its OWN scoped proxy. A scoped proxy always reports exactly
// one target, so there is nothing to discover — `browser.contexts()[0]
// .pages()[0]` IS the tab. Switching the active tab in the desktop UI tears
// down the old proxy and starts a new one; `ensureConnected()` notices the
// registered endpoint changed and reconnects before the next operation.
//
// If the native-browser feature flag is off, `isAvailable()` returns false
// and the composition root falls through to `ServerPlaywrightHost` unchanged.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Browser,
  BrowserContext,
  Locator,
  Page,
} from 'playwright';
import { chromium } from 'playwright';
import type { ILogger } from '@generatorai/shared';
import type { ImportedCookie } from '@generatorai/shared';
import { matchesAnyHostPattern } from '@generatorai/shared';
import type {
  BrowserHandle,
  BrowserHostObserver,
  BrowserInputEvent,
  BrowserStartOptions,
  IBrowserBridge,
  InvokeFunctionResult,
  PageOutcome,
  ScreencastCapabilities,
  ScreencastCodec,
  ScreencastFrame,
} from '../../domain/ports/IBrowserBridge.js';
import { INSPECTOR_SCRIPT } from './InspectorScript.js';
import { ANTI_DETECTION_SCRIPT } from './AntiDetectionScript.js';
import { compileSandboxedPageFunction } from './SandboxedEval.js';

interface HostEntry {
  handle: BrowserHandle;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** The scoped-proxy endpoint `browser` is currently connected to — compared
   *  against the live registry on every operation so a tab switch on the
   *  Electron side triggers a reconnect. */
  currentEndpoint: string;
  workspaceRoot: string;
  observer?: BrowserHostObserver;
  disposed: boolean;
  /** Stored so `wirePage()` can re-install the network-level enforcement
   *  route after a reconnect, when it's called without the original
   *  `BrowserStartOptions.config` in scope. */
  allowedHosts?: string[];
  /** See ServerPlaywrightHost.HostEntry.refMap. */
  refMap: Map<string, string>;
  refCounter: number;
  /** In-flight reconnect, shared by every caller — see `entryFor`. */
  reconnecting?: Promise<HostEntry>;
  deferredResults: Map<string, {
    promise: Promise<InvokeFunctionResult>;
    settled: boolean;
    cleanup?: NodeJS.Timeout;
  }>;
  pendingDialogOverride: { action: 'accept' | 'dismiss'; promptText?: string } | null;
  /** Default dialog policy, stored so the handler can be re-attached when
   *  the entry reconnects to a newly-active tab's proxy. */
  dialogPolicy: 'accept' | 'dismiss' | 'ask';
}

export interface ElectronBridgeAdapterOptions {
  /**
   * Fixed CDP endpoint used for every workspace, bypassing the live
   * registry entirely. Meant for tests that don't run the full desktop
   * handshake.
   */
  cdpEndpoint?: string;
  /** How long to wait for a workspace's scoped proxy endpoint to be
   *  registered before failing. */
  discoveryTimeoutMs?: number;
}

export class ElectronBridgeAdapter implements IBrowserBridge {
  private entries = new Map<string, HostEntry>();
  /**
   * In-flight `start()` per workspace. The scoped proxy admits ONE client and
   * drops the previous one when another connects, so two concurrent starts
   * would each evict the other's half-open connection.
   */
  private starting = new Map<string, Promise<BrowserHandle>>();
  /** Per-workspace scoped-proxy endpoint, pushed by Electron main via
   *  `setEndpoint()` (routes/internal-browser.ts). Populated lazily — a
   *  workspace has no entry until its desktop tab starts a proxy. */
  private endpoints = new Map<string, string>();
  private readonly opts: Required<ElectronBridgeAdapterOptions>;

  constructor(
    private readonly logger: ILogger,
    opts?: ElectronBridgeAdapterOptions,
  ) {
    this.opts = {
      cdpEndpoint: opts?.cdpEndpoint ?? '',
      discoveryTimeoutMs: opts?.discoveryTimeoutMs ?? 10_000,
    };
  }

  /** Called by routes/internal-browser.ts whenever Electron main starts or
   *  tears down a scoped CDP proxy for a workspace's active tab. `null`
   *  clears the entry (e.g. the active tab was closed with no sibling to
   *  promote) — the next operation on that workspace will fail loudly
   *  rather than silently reuse a dead connection. */
  setEndpoint(workspaceId: string, wsUrl: string | null): void {
    if (wsUrl) this.endpoints.set(workspaceId, wsUrl);
    else this.endpoints.delete(workspaceId);
  }

  private async waitForEndpoint(workspaceId: string): Promise<string> {
    if (this.opts.cdpEndpoint) return this.opts.cdpEndpoint;
    const deadline = Date.now() + this.opts.discoveryTimeoutMs;
    while (Date.now() < deadline) {
      const ep = this.endpoints.get(workspaceId);
      if (ep) return ep;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `[ElectronBridgeAdapter] Timed out (${this.opts.discoveryTimeoutMs}ms) waiting for a scoped CDP ` +
        `endpoint for workspace ${workspaceId}. Ensure the desktop app has an active browser tab for it.`,
    );
  }

  async isAvailable(): Promise<boolean> {
    if (this.opts.cdpEndpoint) return true;
    return process.env['GENERATORAI_DESKTOP_NATIVE_BROWSER'] === '1';
  }

  async start(opts: BrowserStartOptions, observer?: BrowserHostObserver): Promise<BrowserHandle> {
    const existing = this.entries.get(opts.workspaceId);
    if (existing && !existing.disposed) return existing.handle;
    const inFlight = this.starting.get(opts.workspaceId);
    if (inFlight) return inFlight;
    const started = this.startOnce(opts, observer).finally(() => this.starting.delete(opts.workspaceId));
    this.starting.set(opts.workspaceId, started);
    return started;
  }

  private async startOnce(opts: BrowserStartOptions, observer?: BrowserHostObserver): Promise<BrowserHandle> {

    const ep = await this.waitForEndpoint(opts.workspaceId);
    this.logger.info(`[ElectronBridgeAdapter] Connecting over CDP to scoped proxy for workspace ${opts.workspaceId}`);
    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(ep);
    } catch (err) {
      throw new Error(
        `[ElectronBridgeAdapter] connectOverCDP failed: ${(err as Error).message}. ` +
          `Ensure the desktop app was started with GENERATORAI_DESKTOP_NATIVE_BROWSER=1.`,
      );
    }
    const context = browser.contexts()[0];
    const page = context?.pages()[0];
    if (!context || !page) {
      await browser.close().catch(() => undefined);
      throw new Error(`[ElectronBridgeAdapter] Scoped proxy at ${ep} exposed no page for workspace ${opts.workspaceId}`);
    }

    // Note: `config.recordVideo` has no effect in native mode —
    // Playwright's `recordVideo` is a launch-time-only context option, and
    // this context already exists (owned by Electron main) by the time we
    // connect. Only ServerPlaywrightHost (screencast/web mode) honours it.
    //
    // Apply lightweight page-level policies. We intentionally do NOT launch
    // a new browser context here — the WCV lives in a context owned by
    // Electron main. All we do is enrich the existing page.
    const config = opts.config;
    if (config.permissions && config.permissions.length > 0) {
      try {
        await context.grantPermissions(config.permissions);
      } catch (err) {
        this.logger.warn?.(`[ElectronBridgeAdapter] grantPermissions failed: ${(err as Error).message}`);
      }
    }

    const handle: BrowserHandle = {
      workspaceId: opts.workspaceId,
      cdpEndpoint: ep,
      targetId: '', // A scoped proxy fabricates one fixed synthetic targetId internally; not stable API.
      mode: 'native',
      hostRef: randomUUID(),
    };

    const entry: HostEntry = {
      handle,
      browser,
      context,
      page,
      currentEndpoint: ep,
      workspaceRoot: opts.workspaceRoot,
      observer,
      disposed: false,
      allowedHosts: config.allowedHosts,
      refMap: new Map(),
      refCounter: 0,
      deferredResults: new Map(),
      pendingDialogOverride: null,
      dialogPolicy: config.dialogPolicy ?? 'dismiss',
    };
    this.entries.set(opts.workspaceId, entry);
    this.wirePage(entry);

    // Best-effort initial navigate — the desktop main will typically have
    // already navigated the WCV, but if the SPA passed an initialUrl to
    // /browser/start we still honour it here so behaviour matches
    // ServerPlaywrightHost.
    if (opts.initialUrl) {
      try {
        await page.goto(opts.initialUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      } catch (err) {
        this.logger.warn?.(`[ElectronBridgeAdapter] initial goto failed: ${(err as Error).message}`);
      }
    }

    return handle;
  }

  async stop(handle: BrowserHandle): Promise<void> {
    const entry = this.entries.get(handle.workspaceId);
    if (!entry || entry.disposed) return;
    entry.disposed = true;
    // Same reasoning as ServerPlaywrightHost.stop: every deferred-result
    // record owns an expiry timer that would otherwise stay armed on a
    // session nobody can reach, pinning its payload until it fires.
    for (const rec of entry.deferredResults.values()) {
      if (rec.cleanup) clearTimeout(rec.cleanup);
    }
    entry.deferredResults.clear();
    // We intentionally DO NOT close the page/context — those are owned by
    // Electron main (the scoped proxy's `stop()`, driven by the desktop's
    // tab-close/deactivate IPC, is the authoritative teardown path). Just
    // drop our own CDP connection so future `interact` calls no-op cleanly.
    void entry.browser.close().catch(() => undefined);
    this.entries.delete(handle.workspaceId);
  }

  async navigate(handle: BrowserHandle, url: string): Promise<PageOutcome> {
    const entry = await this.entryFor(handle);
    const started = Date.now();
    try {
      const response = await entry.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return {
        ok: response ? response.ok() : true,
        url: entry.page.url(),
        title: await entry.page.title().catch(() => undefined),
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return { ok: false, url, error: (err as Error).message, durationMs: Date.now() - started };
    }
  }

  async reload(handle: BrowserHandle): Promise<PageOutcome> {
    const entry = await this.entryFor(handle);
    try {
      await entry.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
      return { ok: true, url: entry.page.url() };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async back(handle: BrowserHandle): Promise<PageOutcome> {
    const entry = await this.entryFor(handle);
    try {
      await entry.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 });
      return { ok: true, url: entry.page.url() };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async forward(handle: BrowserHandle): Promise<PageOutcome> {
    const entry = await this.entryFor(handle);
    try {
      await entry.page.goForward({ waitUntil: 'domcontentloaded', timeout: 15_000 });
      return { ok: true, url: entry.page.url() };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async screenshot(handle: BrowserHandle): Promise<PageOutcome> {
    const entry = await this.entryFor(handle);
    const relPath = path.posix.join('browser', 'screenshots', `${Date.now()}-${randomUUID().slice(0, 8)}.png`);
    const absPath = path.join(entry.workspaceRoot, relPath);
    try {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      const buffer = await entry.page.screenshot({ type: 'png', fullPage: false });
      await fs.writeFile(absPath, buffer);
      return {
        ok: true,
        url: entry.page.url(),
        artifactPath: relPath,
        artifactType: 'browser_screenshot',
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async domSnapshot(handle: BrowserHandle): Promise<PageOutcome> {
    const entry = await this.entryFor(handle);
    const relPath = path.posix.join('browser', 'dom', `${Date.now()}-${randomUUID().slice(0, 8)}.html`);
    const absPath = path.join(entry.workspaceRoot, relPath);
    try {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      const html = await entry.page.content();
      await fs.writeFile(absPath, html, 'utf8');
      return {
        ok: true,
        url: entry.page.url(),
        artifactPath: relPath,
        artifactType: 'browser_dom',
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async addCookies(handle: BrowserHandle, cookies: ImportedCookie[]): Promise<void> {
    const entry = await this.entryFor(handle);
    if (cookies.length === 0) return;
    await entry.context.addCookies(cookies);
  }

  async inspector(handle: BrowserHandle, on: boolean): Promise<void> {
    const entry = await this.entryFor(handle);
    try {
      await entry.page.evaluate((enabled: boolean) => {
        const w = globalThis as unknown as { __generatoraiInspectorEnable?: (v: boolean) => void };
        w.__generatoraiInspectorEnable?.(enabled);
      }, on);
    } catch (err) {
      this.logger.warn?.(`[ElectronBridgeAdapter] inspector toggle failed: ${(err as Error).message}`);
    }
  }

  async describe(handle: BrowserHandle): Promise<{ url?: string; title?: string; viewport?: { width: number; height: number } }> {
    const entry = await this.entryFor(handle);
    const viewport = entry.page.viewportSize() ?? undefined;
    return {
      url: entry.page.url(),
      title: await entry.page.title().catch(() => undefined),
      ...(viewport ? { viewport } : {}),
    };
  }

  async frame(handle: BrowserHandle, opts?: { quality?: number }): Promise<Buffer> {
    const entry = await this.entryFor(handle);
    const quality = Math.max(20, Math.min(95, Math.floor(opts?.quality ?? 60)));
    return entry.page.screenshot({ type: 'jpeg', quality, fullPage: false });
  }

  async captureRegion(
    handle: BrowserHandle,
    clip: { x: number; y: number; width: number; height: number },
  ): Promise<Buffer> {
    const entry = await this.entryFor(handle);
    const x = Math.max(0, Math.floor(clip.x));
    const y = Math.max(0, Math.floor(clip.y));
    const width = Math.max(1, Math.floor(clip.width));
    const height = Math.max(1, Math.floor(clip.height));
    return entry.page.screenshot({ type: 'png', clip: { x, y, width, height } });
  }

  async interact(handle: BrowserHandle, event: BrowserInputEvent): Promise<void> {
    const entry = await this.entryFor(handle);
    try {
      switch (event.type) {
        case 'mouse.move':
          await entry.page.mouse.move(event.x, event.y);
          return;
        case 'mouse.click':
          await entry.page.mouse.click(event.x, event.y, {
            button: event.button ?? 'left',
            clickCount: event.clickCount ?? 1,
          });
          return;
        case 'mouse.down':
          await entry.page.mouse.move(event.x, event.y);
          await entry.page.mouse.down({ button: event.button ?? 'left' });
          return;
        case 'mouse.up':
          await entry.page.mouse.move(event.x, event.y);
          await entry.page.mouse.up({ button: event.button ?? 'left' });
          return;
        case 'mouse.wheel':
          if (typeof event.x === 'number' && typeof event.y === 'number') {
            await entry.page.mouse.move(event.x, event.y);
          }
          await entry.page.mouse.wheel(event.deltaX, event.deltaY);
          return;
        case 'key.press':
          for (const mod of event.modifiers ?? []) {
            await entry.page.keyboard.down(mod);
          }
          await entry.page.keyboard.press(event.key);
          for (const mod of event.modifiers ?? []) {
            await entry.page.keyboard.up(mod);
          }
          return;
        case 'key.type':
          await entry.page.keyboard.type(event.text);
          return;
      }
    } catch (err) {
      this.logger.debug?.(`[ElectronBridgeAdapter] interact failed: ${(err as Error).message}`);
    }
  }

  async resize(_handle: BrowserHandle, _width: number, _height: number): Promise<void> {
    // Native WCV size is authoritative — driven by IPC from the SPA
    // container's ResizeObserver. Ignoring resize on this side prevents
    // Playwright's `setViewportSize` from fighting Electron's own bounds.
  }

  async scrollState(handle: BrowserHandle): Promise<{ scrollY: number; scrollHeight: number; clientHeight: number }> {
    const entry = await this.entryFor(handle);
    try {
      return await entry.page.evaluate(`(() => ({
        scrollY: Math.round(window.scrollY),
        scrollHeight: Math.round(document.documentElement.scrollHeight),
        clientHeight: Math.round(document.documentElement.clientHeight),
      }))()`) as { scrollY: number; scrollHeight: number; clientHeight: number };
    } catch {
      return { scrollY: 0, scrollHeight: 0, clientHeight: 0 };
    }
  }

  /**
   * P1-33. Native mode draws to the screen through the WebContentsView; the
   * compositor never hands us a frame, so there is nothing to stream and no
   * codec to offer. Declaring that is the point: callers used to *discover* it
   * by catching the throw below, which cannot tell "this mode has no
   * screencast" apart from "the screencast just broke".
   */
  screencastCapabilities(): ScreencastCapabilities {
    return { supportsScreencast: false, codecs: [] };
  }

  async *screencast(
    _handle: BrowserHandle,
    _opts: { fps: number; quality: number; codecs?: readonly ScreencastCodec[]; signal?: AbortSignal },
  ): AsyncIterable<ScreencastFrame> {
    // Native mode renders on-screen via the WCV — no screencast stream.
    // Marker throw kept short so callers who forget to branch on
    // `screencastCapabilities()` fail loudly during development.
    throw new Error('screencast unsupported in native mode');
    // Unreachable, but keeps the async-generator return type well-formed.
    // eslint-disable-next-line no-unreachable
    yield undefined as unknown as ScreencastFrame;
  }

  // ── Agent-facing (VSCode-parity 10-tool set) ──

  async readPage(handle: BrowserHandle): Promise<{ url: string; title: string; snapshot: string }> {
    const entry = await this.entryFor(handle);
    // See ServerPlaywrightHost.readPage — clear the table, never the counter,
    // so an `eN` is issued at most once per session and a replayed ref can
    // never resolve to a different element.
    entry.refMap.clear();

    const url = entry.page.url();
    const title = await entry.page.title().catch(() => '');

    // Prefer the modern `Locator.ariaSnapshot()` API (Playwright ≥1.55) —
    // returns a YAML-ish accessibility snapshot. Fall back to the legacy
    // `page.accessibility.snapshot()` object tree if the runtime still
    // ships it (older builds).
    let ariaText = '';
    try {
      ariaText = await entry.page.locator('body').ariaSnapshot({ timeout: 5000 });
    } catch (err) {
      try {
        const ax = (entry.page as unknown as {
          accessibility?: { snapshot?: (opts?: { interestingOnly?: boolean }) => Promise<unknown> };
        }).accessibility;
        if (ax?.snapshot) {
          interface AxNode { role?: string; name?: string; value?: string; children?: AxNode[] }
          const root = await ax.snapshot({ interestingOnly: true }) as AxNode;
          const out: string[] = [];
          const walk = (n: AxNode, depth: number): void => {
            if (!n || typeof n !== 'object') return;
            const parts: string[] = ['-', n.role ?? ''];
            if (n.name) parts.push(`"${n.name}"`);
            out.push('  '.repeat(depth) + parts.filter(Boolean).join(' '));
            for (const c of n.children ?? []) walk(c, depth + 1);
          };
          if (root) walk(root, 0);
          ariaText = out.join('\n');
        } else {
          throw new Error(`ariaSnapshot failed: ${(err as Error).message}`);
        }
      } catch (fallbackErr) {
        throw new Error(`[ElectronBridgeAdapter] readPage failed: ${(fallbackErr as Error).message}`);
      }
    }

    const interactive = new Set([
      'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox',
      'radio', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
      'tab', 'option', 'slider', 'spinbutton', 'treeitem', 'gridcell',
      'columnheader', 'rowheader',
    ]);
    const roleIndex = new Map<string, number>();
    const lines = ariaText.split(/\r?\n/).map((line) => {
      const m = /^(\s*)-\s+([a-zA-Z]+)(?:\s+"([^"]*)")?/.exec(line);
      if (!m) return line;
      const role = m[2]!;
      const name = m[3] ?? '';
      if (!interactive.has(role)) return line;
      const key = `${role}|${name}`;
      const seen = roleIndex.get(key) ?? 0;
      roleIndex.set(key, seen + 1);
      const selector = seen === 0
        ? `role=${role}${name ? `[name=${JSON.stringify(name)}]` : ''}`
        : `role=${role}${name ? `[name=${JSON.stringify(name)}]` : ''}|nth=${seen}`;
      entry.refCounter += 1;
      const refId = `e${entry.refCounter}`;
      entry.refMap.set(refId, selector);
      return `${line} [ref=${refId}]`;
    });

    const snapshot = [
      `### Page`,
      `- URL: ${url}`,
      `- Title: ${title}`,
      ``,
      `### Snapshot (aria)`,
      lines.length > 0 ? lines.join('\n') : '(empty)',
    ].join('\n');
    return { url, title, snapshot };
  }

  private locatorForRef(entry: HostEntry, ref: string): Locator | null {
    const selector = entry.refMap.get(ref);
    if (!selector) return null;
    return this.locatorFromSelector(entry.page, selector);
  }

  /** See ServerPlaywrightHost.unresolvedRefOutcome. */
  private unresolvedRefOutcome(entry: HostEntry, ref: string, label: string): PageOutcome {
    const issued = /^e(\d+)$/.exec(ref);
    if (issued && Number(issued[1]) <= entry.refCounter) {
      return {
        ok: false,
        error: `Ref '${ref}' is from a previous snapshot and is no longer valid. Call read_page again, then retry with a fresh ref.`,
        errorCode: 'browser_stale_ref',
      };
    }
    return { ok: false, error: `Unknown ${label} '${ref}'. Call readPage to refresh.` };
  }

  private locatorFromSelector(page: Page, selector: string): Locator {
    let base = selector;
    let nth: number | null = null;
    const nthMatch = /\|nth=(\d+)$/.exec(selector);
    if (nthMatch) {
      nth = Number(nthMatch[1]);
      base = selector.slice(0, nthMatch.index);
    }
    let locator: Locator;
    const roleMatch = /^role=([a-zA-Z]+)(?:\[name=(.*)\])?$/.exec(base);
    if (roleMatch) {
      const role = roleMatch[1]!;
      const nameRaw = roleMatch[2];
      let name: string | undefined;
      if (nameRaw) {
        try { name = JSON.parse(nameRaw); } catch { name = nameRaw; }
      }
      locator = page.getByRole(role as Parameters<Page['getByRole']>[0], name ? { name, exact: true } : {});
    } else {
      locator = page.locator(base);
    }
    return nth != null ? locator.nth(nth) : locator;
  }

  async clickRef(
    handle: BrowserHandle,
    ref: string,
    opts?: { button?: 'left' | 'right' | 'middle'; dblClick?: boolean; modifiers?: readonly ('Alt' | 'Control' | 'Meta' | 'Shift')[] },
  ): Promise<PageOutcome> {
    const entry = await this.entryFor(handle);
    const started = Date.now();
    const locator = /^e\d+$/.test(ref)
      ? this.locatorForRef(entry, ref)
      : this.locatorFromSelector(entry.page, ref);
    if (!locator) return this.unresolvedRefOutcome(entry, ref, 'ref');
    try {
      const clickOpts: Parameters<typeof locator.click>[0] = {
        button: opts?.button ?? 'left',
        modifiers: opts?.modifiers ? Array.from(opts.modifiers) : undefined,
        timeout: 5000,
      };
      if (opts?.dblClick) await locator.dblclick(clickOpts);
      else await locator.click(clickOpts);
      return { ok: true, url: entry.page.url(), durationMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: (err as Error).message, durationMs: Date.now() - started };
    }
  }

  async hoverRef(handle: BrowserHandle, ref: string): Promise<PageOutcome> {
    const entry = await this.entryFor(handle);
    const started = Date.now();
    const locator = /^e\d+$/.test(ref)
      ? this.locatorForRef(entry, ref)
      : this.locatorFromSelector(entry.page, ref);
    if (!locator) return this.unresolvedRefOutcome(entry, ref, 'ref');
    try {
      await locator.hover({ timeout: 5000 });
      return { ok: true, url: entry.page.url(), durationMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: (err as Error).message, durationMs: Date.now() - started };
    }
  }

  async typeRef(
    handle: BrowserHandle,
    ref: string | null,
    opts: { text?: string; key?: string },
  ): Promise<PageOutcome> {
    const entry = await this.entryFor(handle);
    const started = Date.now();
    try {
      if (ref) {
        const locator = /^e\d+$/.test(ref)
          ? this.locatorForRef(entry, ref)
          : this.locatorFromSelector(entry.page, ref);
        if (!locator) return this.unresolvedRefOutcome(entry, ref, 'ref');
        if (opts.text != null && opts.text !== '') {
          await locator.fill(opts.text, { timeout: 5000 });
        }
        if (opts.key) {
          await locator.press(opts.key, { timeout: 5000 });
        }
      } else {
        if (opts.text != null && opts.text !== '') {
          await entry.page.keyboard.type(opts.text);
        }
        if (opts.key) {
          await entry.page.keyboard.press(opts.key);
        }
      }
      return { ok: true, url: entry.page.url(), durationMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: (err as Error).message, durationMs: Date.now() - started };
    }
  }

  async dragRef(handle: BrowserHandle, fromRef: string, toRef: string): Promise<PageOutcome> {
    const entry = await this.entryFor(handle);
    const started = Date.now();
    const from = /^e\d+$/.test(fromRef)
      ? this.locatorForRef(entry, fromRef)
      : this.locatorFromSelector(entry.page, fromRef);
    const to = /^e\d+$/.test(toRef)
      ? this.locatorForRef(entry, toRef)
      : this.locatorFromSelector(entry.page, toRef);
    if (!from) return this.unresolvedRefOutcome(entry, fromRef, 'fromRef');
    if (!to) return this.unresolvedRefOutcome(entry, toRef, 'toRef');
    try {
      await from.dragTo(to, { timeout: 10_000 });
      return { ok: true, url: entry.page.url(), durationMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: (err as Error).message, durationMs: Date.now() - started };
    }
  }

  async screenshotRef(handle: BrowserHandle, ref: string): Promise<PageOutcome> {
    const entry = await this.entryFor(handle);
    const locator = /^e\d+$/.test(ref)
      ? this.locatorForRef(entry, ref)
      : this.locatorFromSelector(entry.page, ref);
    if (!locator) return this.unresolvedRefOutcome(entry, ref, 'ref');
    const relPath = path.posix.join('browser', 'screenshots', `${Date.now()}-${randomUUID().slice(0, 8)}.png`);
    const absPath = path.join(entry.workspaceRoot, relPath);
    try {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      const buffer = await locator.screenshot({ type: 'png', timeout: 5000 });
      await fs.writeFile(absPath, buffer);
      return {
        ok: true,
        url: entry.page.url(),
        artifactPath: relPath,
        artifactType: 'browser_screenshot',
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async handleDialogAction(
    handle: BrowserHandle,
    action: 'accept' | 'dismiss',
    promptText?: string,
  ): Promise<PageOutcome> {
    const entry = await this.entryFor(handle);
    entry.pendingDialogOverride = { action, promptText };
    const started = Date.now();
    const maxWaitMs = 2000;
    while (Date.now() - started < maxWaitMs) {
      if (!entry.pendingDialogOverride) return { ok: true, durationMs: Date.now() - started };
      await new Promise((r) => setTimeout(r, 40));
    }
    entry.pendingDialogOverride = null;
    return { ok: false, error: 'No dialog appeared within 2s.', durationMs: Date.now() - started };
  }

  async invokeFunction(handle: BrowserHandle, fnDef: string, timeoutMs?: number): Promise<InvokeFunctionResult> {
    const entry = await this.entryFor(handle);
    // Compiled in a `vm` context (see SandboxedEval.ts) — no `require`/
    // `process`/`fs`/`global` in scope, only `page` itself and safe globals.
    let runner: (page: Page) => Promise<unknown>;
    try {
      runner = compileSandboxedPageFunction<Page>(fnDef);
    } catch (err) {
      return { error: `Compilation error: ${(err as Error).message}`, summary: `Failed to compile Playwright code: ${(err as Error).message}` };
    }
    const invocation = (async (): Promise<InvokeFunctionResult> => {
      try {
        const result = await runner(entry.page);
        return { result, summary: this.summarizeInvokeResult(result) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message, summary: `Playwright code threw: ${message.slice(0, 200)}` };
      }
    })();
    if (!timeoutMs || timeoutMs <= 0) return invocation;
    return this.raceWithDeferral(entry, invocation, timeoutMs);
  }

  async waitForDeferredResult(handle: BrowserHandle, deferredResultId: string, timeoutMs: number): Promise<InvokeFunctionResult> {
    const entry = await this.entryFor(handle);
    const rec = entry.deferredResults.get(deferredResultId);
    if (!rec) return { error: `Unknown deferredResultId '${deferredResultId}' — may have expired.`, summary: 'Deferred result not found (likely expired after 5 minutes).' };
    return this.raceWithDeferral(entry, rec.promise, timeoutMs, deferredResultId);
  }

  private async raceWithDeferral(entry: HostEntry, promise: Promise<InvokeFunctionResult>, timeoutMs: number, reuseId?: string): Promise<InvokeFunctionResult> {
    const timeoutMarker = Symbol('timeout');
    const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
      setTimeout(() => resolve(timeoutMarker), Math.max(1, timeoutMs));
    });
    const outcome = await Promise.race([promise, timeoutPromise]);
    if (outcome === timeoutMarker) {
      const id = reuseId ?? `d-${randomUUID().slice(0, 8)}`;
      const prior = entry.deferredResults.get(id);
      if (prior?.cleanup) clearTimeout(prior.cleanup);
      const cleanup = setTimeout(() => { entry.deferredResults.delete(id); }, 5 * 60_000);
      entry.deferredResults.set(id, { promise, settled: false, cleanup });
      void promise.finally(() => {
        const rec = entry.deferredResults.get(id);
        if (rec) rec.settled = true;
      });
      return { deferredResultId: id, summary: `Playwright code still running — pass deferredResultId '${id}' to run_playwright_code to keep waiting.` };
    }
    if (reuseId) {
      const rec = entry.deferredResults.get(reuseId);
      if (rec?.cleanup) clearTimeout(rec.cleanup);
      entry.deferredResults.delete(reuseId);
    }
    return outcome;
  }

  private summarizeInvokeResult(result: unknown): string {
    if (result === undefined) return 'Playwright code completed (no return value).';
    if (result === null) return 'Playwright code completed (returned null).';
    if (typeof result === 'string') return `Result (string, ${result.length} chars): ${result.slice(0, 200)}`;
    if (typeof result === 'number' || typeof result === 'boolean') return `Result: ${String(result)}`;
    try {
      const json = JSON.stringify(result);
      return `Result: ${json.slice(0, 400)}${json.length > 400 ? '…' : ''}`;
    } catch {
      return `Result: [unserialisable ${typeof result}]`;
    }
  }

  // ── Internals ────────────────────────────────────────────────

  private mustEntry(handle: BrowserHandle): HostEntry {
    const entry = this.entries.get(handle.workspaceId);
    if (!entry) throw new Error(`[ElectronBridgeAdapter] No session for workspace ${handle.workspaceId}`);
    if (entry.disposed) throw new Error(`[ElectronBridgeAdapter] Session disposed for workspace ${handle.workspaceId}`);
    return entry;
  }

  /**
   * Look up the entry for `handle` and make sure it's connected to the
   * CURRENT scoped-proxy endpoint for that workspace before returning it.
   * Electron main tears down the old tab's proxy and starts a new one on
   * every tab switch, so the cached `browser`/`context`/`page` can go stale
   * between calls — this is the single place that notices and reconnects.
   * Fully defensive: if the registry has no endpoint at all (e.g. every tab
   * of the workspace was closed), this throws rather than silently reusing
   * a dead connection.
   */
  private async entryFor(handle: BrowserHandle): Promise<HostEntry> {
    const entry = this.mustEntry(handle);
    const wid = entry.handle.workspaceId;
    const current = this.endpoints.get(wid) ?? (this.opts.cdpEndpoint || undefined);
    if (current && current === entry.currentEndpoint && entry.browser.isConnected()) return entry;
    if (!current) {
      throw new Error(`[ElectronBridgeAdapter] No CDP endpoint registered for workspace ${wid} (its browser tab may have been closed).`);
    }
    // One reconnect for everyone. The scoped proxy admits a single client and
    // evicts the previous one on each new connection, so concurrent callers
    // (status polls racing an agent's tool call) each reconnecting knocked the
    // others off mid-handshake — the agent's call and the polls then hung.
    entry.reconnecting ??= this.reconnect(entry, current).finally(() => {
      entry.reconnecting = undefined;
    });
    return entry.reconnecting;
  }

  private async reconnect(entry: HostEntry, current: string): Promise<HostEntry> {
    const wid = entry.handle.workspaceId;
    this.logger.info(`[ElectronBridgeAdapter] Reconnecting CDP for workspace ${wid} (active tab changed)`);
    const browser = await chromium.connectOverCDP(current);
    const context = browser.contexts()[0];
    const page = context?.pages()[0];
    if (!context || !page) {
      await browser.close().catch(() => undefined);
      throw new Error(`[ElectronBridgeAdapter] Scoped proxy at ${current} exposed no page for workspace ${wid}`);
    }
    entry.browser = browser;
    entry.context = context;
    entry.page = page;
    entry.currentEndpoint = current;
    // A reconnect means the active tab changed — every ref from the old
    // tab is now unresolvable on the new one, so it's "stale" in exactly
    // the same sense a superseded readPage() snapshot is. The counter keeps
    // climbing so those IDs are never handed out again.
    entry.refMap.clear();
    this.wirePage(entry);
    return entry;
  }

  /**
   * Attach dialog, close and inspector wiring to `entry.page`/`entry.context`.
   * Called both when an entry is first created and whenever `entryFor()`
   * reconnects it to a newly-active tab's proxy. Best-effort; failures (e.g.
   * an already-registered exposeFunction on a revisited context) swallowed.
   */
  private wirePage(entry: HostEntry): void {
    const { page, context, handle } = entry;
    // Network-level browserConfig.allowedHosts enforcement — see the same
    // comment in ServerPlaywrightHost.start(). Re-installed here (not just
    // once at start()) because a reconnect gets a brand-new `context`.
    if (entry.allowedHosts && entry.allowedHosts.length > 0) {
      const allowedHosts = entry.allowedHosts;
      void context.route('**/*', (route) => {
        let host: string;
        try {
          host = new URL(route.request().url()).host;
        } catch {
          void route.abort();
          return;
        }
        if (matchesAnyHostPattern(host, allowedHosts)) void route.continue();
        else void route.abort();
      }).catch(() => undefined);
    }
    try {
      page.on('dialog', (dialog) => {
        const override = entry.pendingDialogOverride;
        if (override) {
          entry.pendingDialogOverride = null;
          if (override.action === 'accept') void dialog.accept(override.promptText).catch(() => undefined);
          else void dialog.dismiss().catch(() => undefined);
          return;
        }
        const action = entry.dialogPolicy === 'accept' ? 'accept' : 'dismiss';
        void dialog[action]().catch(() => undefined);
      });
    } catch { /* ignore */ }
    try {
      page.on('close', () => {
        if (entry.disposed) return;
        entry.disposed = true;
        try { entry.observer?.onCrash?.(handle, 'native web contents view closed'); } catch { /* ignore */ }
      });
    } catch { /* ignore */ }
    void context.addInitScript({ content: INSPECTOR_SCRIPT }).catch(() => undefined);
    // CDP debugger attachment sets navigator.webdriver = true on the shared
    // tab — mask it (and the other automation signals) so a site the human
    // is looking at doesn't start failing bot checks the moment the agent
    // attaches. See AntiDetectionScript.ts.
    void context.addInitScript({ content: ANTI_DETECTION_SCRIPT }).catch(() => undefined);
    void context.exposeFunction('__generatoraiInspectorPost', (payload: unknown) => {
      try {
        const sel = payload as Parameters<Required<BrowserHostObserver>['onInspectorSelection']>[1];
        entry.observer?.onInspectorSelection?.(handle, sel);
      } catch { /* ignore malformed payloads */ }
    }).catch(() => undefined);
    // Force-inject on the *current* document too — addInitScript only fires
    // on next navigation. Without this, toggling Inspect right after
    // connecting (or after a reconnect) would no-op until the next navigate.
    void page.evaluate(INSPECTOR_SCRIPT).catch(() => undefined);
    void page.evaluate(ANTI_DETECTION_SCRIPT).catch(() => undefined);
  }
}
