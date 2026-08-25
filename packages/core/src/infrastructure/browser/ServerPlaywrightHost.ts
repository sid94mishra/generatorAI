// ────────────────────────────────────────────────────────────────
// ServerPlaywrightHost — IBrowserBridge implementation via Playwright
//
// Spawns a persistent-context Chromium per workspace. Exposes CDP through
// Playwright's `browser.newBrowserCDPSession` / `page.context().browser()`
// so the agent's `playwright-cli` skill can attach via
// `open --cdp-endpoint=<url>` and drive the SAME page the user sees.
//
// Playwright types stay inside this file. Everything the service consumes
// is expressed in `IBrowserBridge` domain terms.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Browser,
  BrowserContext,
  CDPSession,
  Frame,
  Locator,
  Page,
} from 'playwright';
import { chromium } from 'playwright';
import type { ILogger } from '@generatorai/shared';
import type { ImportedCookie } from '@generatorai/shared';
import { matchesAnyHostPattern, isLoopbackHost } from '@generatorai/shared';
import type {
  BrowserHandle,
  BrowserHostObserver,
  BrowserInputEvent,
  BrowserStartOptions,
  IBrowserBridge,
  InvokeFunctionResult,
  PageOutcome,
  ScreencastFrame,
} from '../../domain/ports/IBrowserBridge.js';
import { INSPECTOR_SCRIPT } from './InspectorScript.js';
import { ANTI_DETECTION_SCRIPT } from './AntiDetectionScript.js';
import { compileSandboxedPageFunction } from './SandboxedEval.js';

interface HostEntry {
  handle: BrowserHandle;
  context: BrowserContext;
  browser: Browser | null;
  page: Page;
  cdp: CDPSession;
  screencastActive: boolean;
  /**
   * Fan-out set of screencast subscribers. Each subscriber is pushed
   * every frame Chromium emits. Ref-counted: when the last subscriber
   * detaches, the CDP screencast is stopped.
   */
  screencastSubscribers: Set<(frame: ScreencastFrame) => void>;
  observer?: BrowserHostObserver;
  cdpHttpPort: number;
  workspaceRoot: string;
  disposed: boolean;
  /**
   * Element refs (`e1`, `e2`, …) captured on the most recent `readPage`
   * call, mapped to CSS-ish Playwright selectors we can hand to
   * `page.locator(...)`. Regenerated every `readPage` — any ref returned
   * from a *previous* snapshot is invalid the moment a new one is taken.
   */
  refMap: Map<string, string>;
  /**
   * For refs captured inside a cross-origin iframe (rare — most element
   * refs target the main frame and are absent here): the owning `Frame`,
   * so `clickRef`/`typeRef`/etc. resolve the selector against the right
   * document instead of the top-level page. Regenerated alongside `refMap`.
   */
  refFrames: Map<string, Frame>;
  /**
   * Monotonic counter for `readPage`-generated ref IDs. Never rolls over
   * within a single entry lifetime; only reset when the entry is disposed.
   */
  refCounter: number;
  /**
   * In-flight `invokeFunction` promises indexed by deferred-result ID.
   * The value is the promise itself (so multiple `waitForDeferredResult`
   * calls see the same terminal state) plus a `settled` flag we flip once
   * the promise resolves/rejects, and the last-known `summary` for return.
   */
  deferredResults: Map<string, {
    promise: Promise<InvokeFunctionResult>;
    settled: boolean;
    cleanup?: NodeJS.Timeout;
  }>;
  /**
   * One-shot override for the *next* dialog event. When set, the auto-
   * handler installed on `page.on('dialog', ...)` obeys this action
   * instead of the workspace's `dialogPolicy`. Cleared after use.
   */
  pendingDialogOverride: { action: 'accept' | 'dismiss'; promptText?: string } | null;
  /**
   * Mirrors `BrowserConfig.allowLocalhostSelfSigned`. Needed on the entry
   * (not just at launch) because the exemption is enforced per navigation
   * in `assertCertificateTrustAllowed`, long after `start()` returned.
   */
  allowLocalhostSelfSigned: boolean;
}

interface DomHeuristicHit {
  selector: string;
  label: string;
  reason: string;
}

/**
 * Runs in the page (or iframe) to find clickable elements the ARIA
 * accessibility tree misses entirely — the single biggest gap in agent
 * snapshot fidelity. Modern SPA UI routinely builds buttons, drag handles,
 * and custom dropdowns out of a plain `<div>` with `cursor:pointer`,
 * `onclick`, a positive `tabindex`, or `contenteditable`, none of which the
 * accessibility tree exposes unless the author also added `role="button"`.
 * Skips anything already inside a real interactive element or an
 * ARIA-role'd node — those are already covered by the ariaSnapshot pass —
 * and anything too small to plausibly be a real target (guards against
 * matching a spacer div that merely inherited `cursor:pointer`).
 *
 * A plain string (evaluated via `page.evaluate(string)`), not a typed
 * function — this project's `tsconfig` has no DOM lib (it's a Node
 * package), so `document`/`Element`/etc. can't type-check as real code;
 * every other in-page script in this codebase (see `scrollState()` above,
 * `browser-host.ts`'s overlays) uses the same string-template convention.
 */
const DOM_HEURISTIC_SCRIPT = `(() => {
  const out = [];
  const MAX_HITS = 200;
  const esc = (s) => { try { return window.CSS && CSS.escape ? CSS.escape(s) : s; } catch { return s; } };
  const classList = (el) => el.className && typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean) : [];
  const cssPath = (el) => {
    const parts = [];
    let node = el, depth = 0;
    while (node && node.nodeType === 1 && depth < 12) {
      let seg = node.nodeName.toLowerCase();
      if (node.id) { seg += '#' + esc(node.id); parts.unshift(seg); break; }
      seg += classList(node).slice(0, 3).map((c) => '.' + esc(c)).join('');
      let sib = node, n = 1;
      while ((sib = sib.previousElementSibling)) { if (sib.nodeName === node.nodeName) n += 1; }
      seg += ':nth-of-type(' + n + ')';
      parts.unshift(seg);
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(' > ');
  };
  const alreadyInteractive = (el) => !!el.closest('button, a, input, select, textarea, [role], summary, label');
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length && out.length < MAX_HITS; i += 1) {
    const el = all[i];
    if (alreadyInteractive(el)) continue;
    let reason = '';
    if (el.hasAttribute('onclick')) reason = 'onclick';
    else if (el.isContentEditable) reason = 'contenteditable';
    else if (el.tabIndex >= 0 && el !== document.body) reason = 'tabindex';
    else if (getComputedStyle(el).cursor === 'pointer') reason = 'cursor:pointer';
    if (!reason) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const label = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    out.push({ selector: cssPath(el), label, reason });
  }
  return out;
})()`;

/**
 * Options for the server host. Callers usually leave everything default;
 * fine-grained knobs surface here for tests / operations.
 */
export interface ServerPlaywrightHostOptions {
  /**
   * Base port for CDP. Each session picks the next free port >= this.
   * Defaults to 9333.
   */
  cdpBasePort?: number;
  /** Global max concurrent browser sessions. Defaults to 5. */
  maxConcurrent?: number;
  /**
   * How long to wait for Chromium to become CDP-reachable during start()
   * (milliseconds). Defaults to 20 000.
   */
  startupTimeoutMs?: number;
}

export class ServerPlaywrightHost implements IBrowserBridge {
  private entries = new Map<string, HostEntry>(); // key: workspaceId
  private readonly opts: Required<ServerPlaywrightHostOptions>;

  constructor(
    private readonly logger: ILogger,
    opts?: ServerPlaywrightHostOptions,
  ) {
    this.opts = {
      cdpBasePort: opts?.cdpBasePort ?? 9333,
      maxConcurrent: opts?.maxConcurrent ?? Number(process.env['GENERATORAI_BROWSER_MAX_CONCURRENT'] ?? '5'),
      startupTimeoutMs: opts?.startupTimeoutMs ?? 20_000,
    };
  }

  async isAvailable(): Promise<boolean> {
    // Playwright is a runtime dep of @generatorai/core so it's always
    // available *code-wise*. The `chromium.launch...` call may still fail
    // if the user hasn't run `npx playwright install chromium` — surfaced
    // at start() time, not here.
    return true;
  }

  async start(opts: BrowserStartOptions, observer?: BrowserHostObserver): Promise<BrowserHandle> {
    if (this.entries.has(opts.workspaceId)) {
      const existing = this.entries.get(opts.workspaceId)!;
      if (!existing.disposed) return existing.handle;
      this.entries.delete(opts.workspaceId);
    }

    if (this.entries.size >= this.opts.maxConcurrent) {
      throw new Error(
        `[ServerPlaywrightHost] Cannot start browser session: max concurrent (${this.opts.maxConcurrent}) reached`,
      );
    }

    const config = opts.config;
    const profileDir = opts.profileDir ?? path.join(opts.workspaceRoot, 'browser', 'profile');
    await fs.mkdir(profileDir, { recursive: true });

    // Pick a CDP port. Playwright doesn't expose a "give me the CDP port"
    // API for `launchPersistentContext`, but it does honour
    // `args: ['--remote-debugging-port=N']` — and once launched, the port
    // is reachable at http://127.0.0.1:N/json/version.
    const cdpHttpPort = await this.findFreePort(this.opts.cdpBasePort);
    const viewport = config.viewport ?? { width: 1280, height: 800 };
    const headless = config.headless ?? true;

    this.logger.info(
      `[ServerPlaywrightHost] Starting Chromium: workspace=${opts.workspaceId} port=${cdpHttpPort} headless=${headless}`,
    );

    let context: BrowserContext;
    const launchStart = Date.now();
    try {
      context = await chromium.launchPersistentContext(profileDir, {
        headless,
        viewport,
        ...(config.recordVideo ? { recordVideo: { dir: path.join(opts.workspaceRoot, 'browser', 'videos'), size: viewport } } : {}),
        // Opt-in only (see BrowserConfig.allowLocalhostSelfSigned). This
        // switch is context-wide with no per-origin form, so
        // `assertCertificateTrustAllowed` keeps top-level https navigation
        // on loopback while it is on.
        ignoreHTTPSErrors: config.allowLocalhostSelfSigned === true,
        // Enable CDP over HTTP so `playwright-cli --cdp-endpoint=` can attach.
        // Extra flags chosen for faster cold-start:
        //   • --no-first-run / --no-default-browser-check — skip welcome UI
        //   • --disable-background-networking / --disable-sync — no
        //     spurious network calls to Google backend on launch
        //   • --disable-features=Translate,MediaRouter,OptimizationHints
        //     — subsystems that spin up their own I/O we never need
        //   • --disable-component-update — skip Widevine / other blocking
        //     component updates during first launch
        //   • --disable-extensions — no built-in extension loading
        // These together shave several seconds off the launch on Windows.
        args: [
          `--remote-debugging-port=${cdpHttpPort}`,
          '--remote-debugging-address=127.0.0.1',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-background-networking',
          '--disable-sync',
          '--disable-component-update',
          '--disable-extensions',
          '--disable-features=Translate,MediaRouter,OptimizationHints,InterestFeedContentSuggestions,CalculateNativeWinOcclusion',
          '--disable-ipc-flooding-protection',
          '--metrics-recording-only',
          '--mute-audio',
          ...(headless ? ['--disable-dev-shm-usage'] : []),
        ],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[ServerPlaywrightHost] Failed to launch Chromium: ${msg}. ` +
          `If this is the first run, install browsers with \`npx playwright install chromium\`.`,
      );
    }
    const launchMs = Date.now() - launchStart;
    this.logger.debug?.(`[ServerPlaywrightHost] Chromium context launched in ${launchMs}ms`);

    // Wait until the CDP HTTP endpoint responds — this indicates the browser
    // is ready to accept attach connections from playwright-cli.
    const cdpEndpoint = `http://127.0.0.1:${cdpHttpPort}`;
    await this.waitForCdpReady(cdpEndpoint, this.opts.startupTimeoutMs);

    // First page (persistent contexts always have one) or open a new one.
    let page: Page;
    const existingPages = context.pages();
    if (existingPages.length > 0) {
      page = existingPages[0]!;
    } else {
      page = await context.newPage();
    }

    // Permissions
    if (config.permissions && config.permissions.length > 0) {
      try {
        await context.grantPermissions(config.permissions);
      } catch (err) {
        this.logger.warn?.(`[ServerPlaywrightHost] grantPermissions failed: ${(err as Error).message}`);
      }
    }

    // Enforce browserConfig.allowedHosts at the network level, not just at
    // the navigate()-call pre-check — a `run_playwright_code` invocation
    // gets a raw `page` and can call page.goto()/click a link/redirect via
    // JS directly, none of which goes through BrowserService.navigate()'s
    // check. context.route() intercepts every request from every page in
    // this context regardless of what triggered it.
    if (config.allowedHosts && config.allowedHosts.length > 0) {
      const allowedHosts = config.allowedHosts;
      await context.route('**/*', (route) => {
        let host: string;
        try {
          host = new URL(route.request().url()).host;
        } catch {
          void route.abort();
          return;
        }
        if (matchesAnyHostPattern(host, allowedHosts)) void route.continue();
        else void route.abort();
      });
    }

    // Dialog policy — default 'dismiss'. When a caller has scheduled a
    // one-shot override via `handleDialogAction`, that takes precedence
    // and is consumed for exactly one dialog. `entryRef` is populated
    // below once we've built the HostEntry — the handler is safe to fire
    // before then because Chromium can't have raised a dialog yet.
    const dialogPolicy = config.dialogPolicy ?? 'dismiss';
    let entryRef: HostEntry | null = null;
    page.on('dialog', (dialog) => {
      const override = entryRef?.pendingDialogOverride ?? null;
      if (override && entryRef) {
        entryRef.pendingDialogOverride = null;
        if (override.action === 'accept') {
          void dialog.accept(override.promptText).catch(() => undefined);
        } else {
          void dialog.dismiss().catch(() => undefined);
        }
        return;
      }
      if (dialogPolicy === 'accept') {
        void dialog.accept().catch(() => undefined);
      } else if (dialogPolicy === 'dismiss') {
        void dialog.dismiss().catch(() => undefined);
      }
      // 'ask' is a placeholder for HITL flow — for now, dismiss to avoid
      // hanging the page. (BrowserService should surface a HITL prompt.)
      else {
        void dialog.dismiss().catch(() => undefined);
      }
    });

    // Attach a raw CDP session so we can drive screencast + Runtime.evaluate.
    const cdp = await context.newCDPSession(page);

    // Some Playwright versions don't auto-enable the Page domain on new
    // CDP sessions. Enabling it explicitly is a no-op if already on and
    // is required for `Page.screencastFrame` events to fire.
    await cdp.send('Page.enable').catch(() => undefined);

    // Drop the `HeadlessChrome` product token from the User-Agent. The
    // init-script masks in AntiDetectionScript can only rewrite
    // `navigator.userAgent`, which servers never see — the giveaway is the
    // UA *request header*, and a site that filters on it rejects the agent
    // before any page script runs. Overriding through CDP changes both at
    // once. Best-effort: if the override fails the session still works,
    // just more visibly automated.
    try {
      const version = (await cdp.send('Browser.getVersion')) as { userAgent?: string };
      const rawUa = version?.userAgent ?? '';
      if (rawUa.includes('HeadlessChrome')) {
        await cdp.send('Emulation.setUserAgentOverride', {
          userAgent: rawUa.replace(/HeadlessChrome/g, 'Chrome'),
        });
      }
    } catch {
      /* non-fatal — keep the default UA */
    }

    // Retrieve the top-level targetId (for descriptor exposure).
    const { targetInfo } = await cdp.send('Target.getTargetInfo').catch(() => ({ targetInfo: undefined as unknown as { targetId?: string } }));
    const targetId = (targetInfo as { targetId?: string } | undefined)?.targetId ?? '';

    // Install the inspector script via addInitScript so it's available on
    // every new document, plus one-shot inject for the current page.
    // The script watches for a `window.__generatoraiInspector = true` toggle
    // set by `inspector(handle, true)` below.
    await context.addInitScript({ content: INSPECTOR_SCRIPT });

    // Mask common automation signals (navigator.webdriver, empty plugins/
    // languages, missing window.chrome) before any page JS runs, on every
    // navigation. See AntiDetectionScript.ts for what this does and doesn't
    // cover.
    await context.addInitScript({ content: ANTI_DETECTION_SCRIPT });

    // Force page scrollbars to always be visible. Chromium in headless
    // mode on some platforms hides overlay scrollbars, which makes the
    // live view feel "stuck" to users who can't tell the page can
    // scroll. This CSS runs on every navigation and forces classic
    // (always-visible) scrollbars on both axes.
    await context.addInitScript({
      content: `
        (function() {
          try {
            const CSS = \`
              html {
                overflow-y: scroll !important;
                scrollbar-width: auto !important;
                scrollbar-color: #999 #e8e8e8 !important;
              }
              body {
                scrollbar-width: auto !important;
                scrollbar-color: #999 #e8e8e8 !important;
              }
              ::-webkit-scrollbar { width: 14px !important; height: 14px !important; background: #e8e8e8 !important; }
              ::-webkit-scrollbar-track { background: #e8e8e8 !important; }
              ::-webkit-scrollbar-thumb { background: #999 !important; border: 2px solid #e8e8e8 !important; border-radius: 8px !important; }
              ::-webkit-scrollbar-thumb:hover { background: #666 !important; }
              ::-webkit-scrollbar-corner { background: #e8e8e8 !important; }
            \`;
            const inject = () => {
              if (!document.documentElement) return;
              if (document.getElementById('__gai_sb')) return;
              const s = document.createElement('style');
              s.id = '__gai_sb';
              s.textContent = CSS;
              (document.head || document.documentElement).appendChild(s);
            };
            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', inject);
            } else {
              inject();
            }
            // Some SPAs (Docusaurus) replace the entire <head> during
            // route changes — re-inject on every mutation of <head>.
            new MutationObserver(() => inject()).observe(document.documentElement, {
              childList: true, subtree: true,
            });
          } catch (e) { /* ignore */ }
        })();
      `,
    });

    // Set up a page-console → observer bridge for future work.
    // For v1 we don't stream console entries but we record last N lines.

    const handle: BrowserHandle = {
      workspaceId: opts.workspaceId,
      cdpEndpoint,
      targetId,
      mode: 'screencast',
      hostRef: randomUUID(),
    };

    const entry: HostEntry = {
      handle,
      context,
      browser: context.browser(),
      page,
      cdp,
      screencastActive: false,
      screencastSubscribers: new Set(),
      observer,
      cdpHttpPort,
      workspaceRoot: opts.workspaceRoot,
      disposed: false,
      refMap: new Map(),
      refFrames: new Map(),
      refCounter: 0,
      deferredResults: new Map(),
      pendingDialogOverride: null,
      allowLocalhostSelfSigned: config.allowLocalhostSelfSigned === true,
    };
    // Publish to the dialog handler's captured ref so the one-shot
    // `handleDialogAction` override machinery can see this entry.
    entryRef = entry;
    this.entries.set(opts.workspaceId, entry);

    // Crash detection — Playwright fires 'close' on context when Chromium
    // exits, which we treat as a crash if we didn't ask for it.
    context.on('close', () => {
      if (entry.disposed) return;
      entry.disposed = true;
      try {
        entry.observer?.onCrash?.(handle, 'browser context closed unexpectedly');
      } catch { /* ignore observer errors */ }
    });

    // Wire inspector-selection observer via a page.exposeFunction the script
    // can call from page context.
    try {
      await context.exposeFunction('__generatoraiInspectorPost', (payload: unknown) => {
        try {
          const sel = payload as Parameters<Required<BrowserHostObserver>['onInspectorSelection']>[1];
          entry.observer?.onInspectorSelection?.(handle, sel);
        } catch {
          /* ignore malformed payloads */
        }
      });
    } catch (err) {
      // exposeFunction is per-context; if called twice, ignore.
      this.logger.debug?.(`[ServerPlaywrightHost] exposeFunction skipped: ${(err as Error).message}`);
    }

    // Optionally navigate to initialUrl.
    if (opts.initialUrl) {
      try {
        await page.goto(opts.initialUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      } catch (err) {
        this.logger.warn?.(
          `[ServerPlaywrightHost] initial goto failed: ${(err as Error).message}`,
        );
      }
    }

    return handle;
  }

  async stop(handle: BrowserHandle): Promise<void> {
    const entry = this.entries.get(handle.workspaceId);
    if (!entry || entry.disposed) return;
    entry.disposed = true;

    // P0-24: Wake any screencast generators that are blocked inside
    // `await new Promise<void>((resolve) => { waiter = resolve; })`.
    // Setting disposed=true alone is not enough — the while loop condition
    // is only evaluated AFTER the awaited promise resolves, so generators
    // stay stuck until the next frame arrives. Since we're about to close
    // the context (no more frames), we must unblock them explicitly.
    for (const sub of entry.screencastSubscribers) {
      try { sub({ jpeg: Buffer.alloc(0), ts: Date.now() }); } catch { /* ignore */ }
    }

    // Drop the deferred-result bookkeeping before tearing the context down.
    // Each record owns a 5-minute expiry timer; without this they stay armed
    // on a session nobody can reach any more, holding the whole entry (page,
    // context, result payloads) alive until they fire.
    for (const rec of entry.deferredResults.values()) {
      if (rec.cleanup) clearTimeout(rec.cleanup);
    }
    entry.deferredResults.clear();
    // Detach explicitly rather than relying on context.close() to sweep it —
    // an already-detached session throws, which is fine and expected here.
    try {
      await entry.cdp.detach();
    } catch {
      /* already gone with the page */
    }
    try {
      await entry.context.close();
    } catch (err) {
      this.logger.warn?.(`[ServerPlaywrightHost] context.close failed: ${(err as Error).message}`);
    }
    this.entries.delete(handle.workspaceId);
  }

  /**
   * Scope the self-signed-certificate exemption to loopback.
   *
   * Playwright's `ignoreHTTPSErrors` is a context-wide switch with no
   * per-origin form, so with it on, a bad cert is silently accepted for
   * *every* origin the session visits — including a public host being
   * actively intercepted. The setting is called `allowLocalhostSelfSigned`
   * and that is what it should mean, so top-level navigation to a
   * non-loopback `https://` origin is refused while it is on. Loopback
   * traffic never leaves the machine, which is the only reason skipping
   * cert validation is defensible in the first place.
   *
   * Sub-resources of a loopback page are still covered by the context-wide
   * switch; the guard is about where the agent can steer the top-level
   * page, which is the reachable half of the problem.
   */
  private assertCertificateTrustAllowed(entry: HostEntry, url: string): string | null {
    if (!entry.allowLocalhostSelfSigned) return null;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null; // not an absolute URL — goto will fail on its own terms
    }
    if (parsed.protocol !== 'https:') return null;
    if (isLoopbackHost(parsed.hostname)) return null;
    return (
      `Refusing to navigate to ${parsed.origin}: this workspace has ` +
      `browserConfig.allowLocalhostSelfSigned enabled, which disables TLS ` +
      `certificate validation for the whole browser context. While it is on, ` +
      `https:// navigation is restricted to loopback hosts so an invalid ` +
      `certificate on a public origin cannot be accepted silently. Turn the ` +
      `setting off to browse external https:// sites.`
    );
  }

  async navigate(handle: BrowserHandle, url: string): Promise<PageOutcome> {
    const started = Date.now();
    const entry = this.mustEntry(handle);
    const blocked = this.assertCertificateTrustAllowed(entry, url);
    if (blocked) return { ok: false, url, error: blocked, durationMs: Date.now() - started };
    try {
      const response = await entry.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return {
        ok: response ? response.ok() : true,
        url: entry.page.url(),
        title: await entry.page.title().catch(() => undefined),
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return {
        ok: false,
        url,
        error: (err as Error).message,
        durationMs: Date.now() - started,
      };
    }
  }

  async reload(handle: BrowserHandle): Promise<PageOutcome> {
    const entry = this.mustEntry(handle);
    const started = Date.now();
    try {
      await entry.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
      return { ok: true, url: entry.page.url(), durationMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: (err as Error).message, durationMs: Date.now() - started };
    }
  }

  async back(handle: BrowserHandle): Promise<PageOutcome> {
    const entry = this.mustEntry(handle);
    try {
      await entry.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 });
      return { ok: true, url: entry.page.url() };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async forward(handle: BrowserHandle): Promise<PageOutcome> {
    const entry = this.mustEntry(handle);
    try {
      await entry.page.goForward({ waitUntil: 'domcontentloaded', timeout: 15_000 });
      return { ok: true, url: entry.page.url() };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async screenshot(handle: BrowserHandle): Promise<PageOutcome> {
    const entry = this.mustEntry(handle);
    const relPath = path.posix.join('browser', 'screenshots', `${Date.now()}-${randomUUID().slice(0, 8)}.png`);
    const absPath = path.join(entry.workspaceRoot, relPath);
    try {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      // X-14: Use CSS-pixel scale so HiDPI displays capture at logical (not
      // physical) resolution. On a 1920×1080 HiDPI screen with devicePixelRatio=2
      // this halves the image from 3840×2160 to 1920×1080 before storage,
      // cutting the base64 blob sent to the model roughly 4×.
      // TODO X-14: Add a configurable downscale factor (e.g. 0.5× for 540p)
      // once a lightweight image-resize library is approved for this package.
      const buffer = await entry.page.screenshot({ type: 'png', fullPage: false, scale: 'css' });
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
    const entry = this.mustEntry(handle);
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
    const entry = this.mustEntry(handle);
    if (cookies.length === 0) return;
    await entry.context.addCookies(cookies);
  }

  async inspector(handle: BrowserHandle, on: boolean): Promise<void> {
    const entry = this.mustEntry(handle);
    try {
      await entry.page.evaluate((enabled: boolean) => {
        const w = globalThis as unknown as { __generatoraiInspectorEnable?: (v: boolean) => void };
        w.__generatoraiInspectorEnable?.(enabled);
      }, on);
    } catch (err) {
      this.logger.warn?.(`[ServerPlaywrightHost] inspector toggle failed: ${(err as Error).message}`);
    }
  }

  async describe(handle: BrowserHandle): Promise<{ url?: string; title?: string; viewport?: { width: number; height: number } }> {
    const entry = this.mustEntry(handle);
    const viewport = entry.page.viewportSize() ?? undefined;
    return {
      url: entry.page.url(),
      title: await entry.page.title().catch(() => undefined),
      ...(viewport ? { viewport } : {}),
    };
  }

  async frame(handle: BrowserHandle, opts?: { quality?: number }): Promise<Buffer> {
    const entry = this.mustEntry(handle);
    const quality = Math.max(20, Math.min(95, Math.floor(opts?.quality ?? 60)));
    return entry.page.screenshot({ type: 'jpeg', quality, fullPage: false });
  }

  async captureRegion(
    handle: BrowserHandle,
    clip: { x: number; y: number; width: number; height: number },
  ): Promise<Buffer> {
    const entry = this.mustEntry(handle);
    // Round to integer pixels; Playwright rejects fractional widths on
    // some Chromium builds. Clamp width/height to ≥1 to survive tiny
    // user drags without erroring the whole capture path.
    const x = Math.max(0, Math.floor(clip.x));
    const y = Math.max(0, Math.floor(clip.y));
    const width = Math.max(1, Math.floor(clip.width));
    const height = Math.max(1, Math.floor(clip.height));
    return entry.page.screenshot({ type: 'png', clip: { x, y, width, height } });
  }

  async interact(handle: BrowserHandle, event: BrowserInputEvent): Promise<void> {
    const entry = this.mustEntry(handle);
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
          // P1-32: Replace hardcoded 120 ms sleep with a readiness check.
          // waitForLoadState('domcontentloaded') returns as soon as the DOM
          // is interactive — typically <10 ms on SPAs — while still
          // covering the common "click opens a modal" case.  Cap at 300 ms
          // so a page stuck mid-navigation doesn't stall the input queue.
          try {
            await entry.page.waitForLoadState('domcontentloaded', { timeout: 300 });
          } catch {
            // Timeout or navigation — swallow; the next dispatch will simply
            // race against the ongoing transition, same as before the fix.
          }
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
          // Playwright's `wheel(dx, dy)` scrolls at the current cursor
          // position; move first if the caller supplied coords.
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
      // Input dispatch is best-effort — page navigation between the event
      // fire and the dispatch commonly races with `Target closed`. Log at
      // debug and swallow so the client doesn't error.
      this.logger.debug?.(`[ServerPlaywrightHost] interact failed: ${(err as Error).message}`);
    }
  }

  async resize(handle: BrowserHandle, width: number, height: number): Promise<void> {
    const entry = this.mustEntry(handle);
    // Clamp to sane bounds — Chromium supports huge viewports but they
    // waste memory and slow screencast; also enforce a min size so
    // pages don't reflow into unusable widths.
    const w = Math.max(320, Math.min(2560, Math.round(width)));
    const h = Math.max(240, Math.min(1600, Math.round(height)));
    try {
      await entry.page.setViewportSize({ width: w, height: h });
    } catch (err) {
      this.logger.debug?.(`[ServerPlaywrightHost] resize failed: ${(err as Error).message}`);
    }
  }

  async scrollState(handle: BrowserHandle): Promise<{ scrollY: number; scrollHeight: number; clientHeight: number }> {
    const entry = this.mustEntry(handle);
    try {
      // Runs inside Chromium — `window` / `document` are the page's, not Node's.
      return await entry.page.evaluate(`(() => ({
        scrollY: Math.round(window.scrollY),
        scrollHeight: Math.round(document.documentElement.scrollHeight),
        clientHeight: Math.round(document.documentElement.clientHeight),
      }))()`) as { scrollY: number; scrollHeight: number; clientHeight: number };
    } catch {
      return { scrollY: 0, scrollHeight: 0, clientHeight: 0 };
    }
  }

  async *screencast(handle: BrowserHandle, opts: { fps: number; quality: number }): AsyncIterable<ScreencastFrame> {
    const entry = this.mustEntry(handle);
    const fps = Math.max(1, Math.min(15, Math.floor(opts.fps || 5)));
    const quality = Math.max(20, Math.min(95, Math.floor(opts.quality || 60)));

    // First subscriber starts the shared CDP screencast; subsequent
    // subscribers piggy-back on the same frame stream. Ref-counted.
    if (!entry.screencastActive) {
      entry.screencastActive = true;
      const onFrame = (params: { data: string; sessionId: number; metadata?: { timestamp?: number } }) => {
        const frame: ScreencastFrame = {
          jpeg: Buffer.from(params.data, 'base64'),
          ts: (params.metadata?.timestamp ?? Date.now() / 1000) * 1000,
        };
        for (const sub of entry.screencastSubscribers) {
          try { sub(frame); } catch { /* subscriber errors are isolated */ }
        }
        // Ack — CDP requires this to receive the next frame.
        entry.cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => undefined);
      };
      entry.cdp.on('Page.screencastFrame', onFrame);
      // Stash the handler so we can remove it on last-unsubscribe.
      (entry as unknown as { _screencastHandler: typeof onFrame })._screencastHandler = onFrame;
      try {
        await entry.cdp.send('Page.startScreencast', {
          format: 'jpeg',
          quality,
          everyNthFrame: Math.max(1, Math.floor(30 / fps)),
        });
      } catch (err) {
        entry.cdp.off('Page.screencastFrame', onFrame);
        entry.screencastActive = false;
        throw err;
      }
    }

    // Local queue for this subscriber only.
    const queue: ScreencastFrame[] = [];
    let waiter: (() => void) | null = null;
    const subscriber = (frame: ScreencastFrame): void => {
      // Drop-oldest to bound memory when consumer is slow.
      if (queue.length >= 3) queue.shift();
      queue.push(frame);
      if (waiter) { const w = waiter; waiter = null; w(); }
    };
    entry.screencastSubscribers.add(subscriber);

    try {
      while (!entry.disposed) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => { waiter = resolve; });
          continue;
        }
        const frame = queue.shift()!;
        yield frame;
      }
    } finally {
      entry.screencastSubscribers.delete(subscriber);
      if (entry.screencastSubscribers.size === 0 && entry.screencastActive) {
        const handler = (entry as unknown as { _screencastHandler?: (p: unknown) => void })._screencastHandler;
        if (handler) entry.cdp.off('Page.screencastFrame', handler as never);
        try { await entry.cdp.send('Page.stopScreencast'); } catch { /* best effort */ }
        entry.screencastActive = false;
      }
    }
  }

  // ── Agent-facing (VSCode-parity 10-tool set) ──

  /**
   * Serialise the page's accessibility tree into a YAML-ish snapshot the
   * LLM can reason over, tagging interactive nodes with stable `[ref=eN]`
   * IDs. Refs live only until the next `readPage` call — a fresh snapshot
   * always resets the map.
   *
   * We build the ref → selector map by walking `page.accessibility.snapshot`
   * (fast; runs in Chromium) and computing a nth-of-role selector for
   * every node with an actionable role or a name. Selectors use
   * `role=...[name=...]` syntax which Playwright understands natively via
   * `page.getByRole`.
   */
  async readPage(handle: BrowserHandle): Promise<{ url: string; title: string; snapshot: string }> {
    const entry = this.mustEntry(handle);
    // Reset the ref TABLE, but never the counter: `refCounter` is monotonic
    // for the life of the session so an `eN` is issued at most once. Resetting
    // it made IDs recycle across snapshots, and a recycled ID is worse than a
    // dangling one — an agent replaying a stale `e1` would silently act on
    // whatever *new* element inherited that number instead of being told to
    // re-read the page. Because IDs are never reused, "was issued at some
    // point but is not in the current table" is exactly "stale", which is
    // what `unresolvedRefOutcome` keys off.
    entry.refMap.clear();
    entry.refFrames.clear();

    const url = entry.page.url();
    const title = await entry.page.title().catch(() => '');

    const mainFrameLines = await this.snapshotFrame(entry, entry.page, undefined);

    // Cross-origin iframes have their own accessibility tree the top-level
    // ariaSnapshot never sees. Snapshot each child frame the same way,
    // continuing the same eN numbering so the agent can click into an
    // embedded checkout/payment widget without a separate tool call.
    const iframeSections: string[] = [];
    for (const frame of entry.page.frames()) {
      if (frame === entry.page.mainFrame()) continue;
      if (frame.isDetached()) continue;
      let frameUrl = '';
      try { frameUrl = frame.url(); } catch { continue; }
      if (!frameUrl || frameUrl === 'about:blank') continue;
      const lines = await this.snapshotFrame(entry, frame, frame);
      if (lines.length > 0) {
        iframeSections.push([`### Frame (iframe): ${frameUrl}`, lines.join('\n')].join('\n'));
      }
    }

    const snapshot = [
      `### Page`,
      `- URL: ${url}`,
      `- Title: ${title}`,
      ``,
      `### Snapshot (aria + interactive)`,
      mainFrameLines.length > 0 ? mainFrameLines.join('\n') : '(empty)',
      ...(iframeSections.length > 0 ? ['', ...iframeSections] : []),
    ].join('\n');

    return { url, title, snapshot };
  }

  /**
   * Snapshot one frame (main or iframe): the ARIA tree first, then a DOM
   * pass for elements that are clickable but never make it into the
   * accessibility tree — `<div onclick>`/`cursor:pointer`/`tabindex`/
   * `contenteditable` widgets, which is how a lot of modern SPA UI (custom
   * dropdowns, drag handles, canvas toolbars) is actually built. Both
   * passes share the same `eN` ref numbering and `refMap`; DOM-pass refs
   * additionally skip anything already inside an ARIA-recognized
   * interactive element so the same control doesn't get two refs.
   * `owningFrame` is stored in `refFrames` so later ref resolution targets
   * the right document — `undefined` for the main frame (the common case).
   */
  private async snapshotFrame(entry: HostEntry, target: Page | Frame, owningFrame: Frame | undefined): Promise<string[]> {
    const interactive = new Set([
      'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox',
      'radio', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
      'tab', 'option', 'slider', 'spinbutton', 'treeitem', 'gridcell',
      'columnheader', 'rowheader',
    ]);

    let ariaText = '';
    try {
      ariaText = await target.locator('body').ariaSnapshot({ timeout: 5000 });
    } catch (err) {
      if (!owningFrame) {
        // Best-effort legacy fallback for old Playwright builds — main
        // frame only; not worth the complexity for the rare iframe case.
        try {
          const ax = (entry.page as unknown as {
            accessibility?: { snapshot?: (opts?: { interestingOnly?: boolean }) => Promise<unknown> };
          }).accessibility;
          if (ax?.snapshot) {
            const root = await ax.snapshot({ interestingOnly: true });
            ariaText = this.axTreeToYaml(root);
          } else {
            throw new Error(`ariaSnapshot failed: ${(err as Error).message}`);
          }
        } catch (fallbackErr) {
          throw new Error(`[ServerPlaywrightHost] readPage failed: ${(fallbackErr as Error).message}`);
        }
      } else {
        return []; // iframe ariaSnapshot failing (e.g. cross-origin quirk) isn't fatal to the whole readPage
      }
    }

    const roleIndex = new Map<string, number>(); // key: `${role}|${name}`
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
      if (owningFrame) entry.refFrames.set(refId, owningFrame);
      return `${line} [ref=${refId}]`;
    });

    let domHeuristicResults: DomHeuristicHit[] = [];
    try {
      domHeuristicResults = await target.evaluate(DOM_HEURISTIC_SCRIPT) as DomHeuristicHit[];
    } catch {
      domHeuristicResults = []; // non-fatal — ARIA-only snapshot still works
    }
    const domLines = domHeuristicResults.map((hit) => {
      entry.refCounter += 1;
      const refId = `e${entry.refCounter}`;
      entry.refMap.set(refId, hit.selector);
      if (owningFrame) entry.refFrames.set(refId, owningFrame);
      const label = hit.label ? ` "${hit.label}"` : '';
      return `- generic${label} [ref=${refId}] (non-ARIA, ${hit.reason})`;
    });

    return domLines.length > 0 ? [...lines, ...domLines] : lines;
  }

  /**
   * Legacy fallback — convert the object tree from `page.accessibility.snapshot`
   * into an ariaSnapshot-compatible YAML string so the modern parser above
   * can walk it uniformly.
   */
  private axTreeToYaml(root: unknown): string {
    const out: string[] = [];
    interface AxNode { role?: string; name?: string; value?: string; children?: AxNode[] }
    const walk = (n: AxNode, depth: number): void => {
      if (!n || typeof n !== 'object') return;
      const parts: string[] = ['-', n.role ?? ''];
      if (n.name) parts.push(`"${n.name}"`);
      out.push('  '.repeat(depth) + parts.filter(Boolean).join(' '));
      for (const c of n.children ?? []) walk(c, depth + 1);
    };
    if (root) walk(root as AxNode, 0);
    return out.join('\n');
  }

  /**
   * Resolve a `readPage`-issued ref back to a Playwright `Locator`. Returns
   * `null` if the ref is unknown so callers can produce a friendly error
   * (e.g. "ref eN unknown — call readPage first").
   */
  private locatorForRef(entry: HostEntry, ref: string): Locator | null {
    const selector = entry.refMap.get(ref);
    if (!selector) return null;
    const owningFrame = entry.refFrames.get(ref);
    return this.locatorFromSelector(owningFrame ?? entry.page, selector);
  }

  /**
   * Build the failure `PageOutcome` for a ref that didn't resolve to a
   * locator. Distinguishes a ref from a *superseded* snapshot (typed
   * `browser_stale_ref` — the fix is to call `read_page` again) from one
   * that's simply malformed or was never issued (plain unknown-ref error).
   */
  private unresolvedRefOutcome(entry: HostEntry, ref: string, label: string): PageOutcome {
    // `refCounter` only ever increases, so any well-formed `eN` with
    // N <= refCounter was handed out by some earlier snapshot. Not being in
    // the current `refMap` therefore means "superseded", however many
    // snapshots ago it was issued.
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

  /**
   * Parse our internal selector DSL into a Playwright `Locator`. Supports:
   *   • `role=<role>[name=<json-string>]`  →  page.getByRole(role, {name, exact:true})
   *   • suffix `|nth=<n>`                  →  .nth(n) on the result
   *   • otherwise: raw CSS/xpath/text= — pass through to page.locator()
   * `target` is a `Page` for the common case or a `Frame` for a ref captured
   * inside an iframe (see `snapshotFrame`) — both expose the same
   * `getByRole`/`locator` surface this method needs.
   */
  private locatorFromSelector(target: Page | Frame, selector: string): Locator {
    // Split off `|nth=N` if present.
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
      // The Playwright role types are narrow — we can safely cast here
      // because `readPage` only emits known ARIA role strings.
      locator = target.getByRole(role as Parameters<Page['getByRole']>[0], name ? { name, exact: true } : {});
    } else {
      locator = target.locator(base);
    }
    return nth != null ? locator.nth(nth) : locator;
  }

  async clickRef(
    handle: BrowserHandle,
    ref: string,
    opts?: { button?: 'left' | 'right' | 'middle'; dblClick?: boolean; modifiers?: readonly ('Alt' | 'Control' | 'Meta' | 'Shift')[] },
  ): Promise<PageOutcome> {
    const entry = this.mustEntry(handle);
    const started = Date.now();
    // Allow the model to pass a raw CSS/xpath/text selector too — if the
    // string doesn't look like an eN ref, treat it as a selector directly.
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
    const entry = this.mustEntry(handle);
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
    const entry = this.mustEntry(handle);
    const started = Date.now();
    try {
      if (ref) {
        const locator = /^e\d+$/.test(ref)
          ? this.locatorForRef(entry, ref)
          : this.locatorFromSelector(entry.page, ref);
        if (!locator) return this.unresolvedRefOutcome(entry, ref, 'ref');
        if (opts.text != null && opts.text !== '') {
          // `fill` clears + sets in one call, matching what a user would
          // expect from a "type into this box" request in natural language.
          // For append-style typing, callers should use `key` or a
          // `run_playwright_code` call.
          await locator.fill(opts.text, { timeout: 5000 });
        }
        if (opts.key) {
          await locator.press(opts.key, { timeout: 5000 });
        }
      } else {
        // No ref → type into whatever has focus.
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
    const entry = this.mustEntry(handle);
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
    const entry = this.mustEntry(handle);
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
    const entry = this.mustEntry(handle);
    entry.pendingDialogOverride = { action, promptText };
    // Wait briefly for a dialog to appear. Playwright's Dialog event
    // fires synchronously with the page's alert/confirm/prompt call, so
    // most real cases resolve within a few ms. If no dialog arrives by
    // 2 s, drop the override so it doesn't fire against an unrelated
    // future dialog.
    const started = Date.now();
    const maxWaitMs = 2000;
    while (Date.now() - started < maxWaitMs) {
      if (!entry.pendingDialogOverride) {
        // The handler consumed the override — success.
        return { ok: true, durationMs: Date.now() - started };
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    entry.pendingDialogOverride = null;
    return { ok: false, error: 'No dialog appeared within 2s.', durationMs: Date.now() - started };
  }

  async invokeFunction(
    handle: BrowserHandle,
    fnDef: string,
    timeoutMs?: number,
  ): Promise<InvokeFunctionResult> {
    const entry = this.mustEntry(handle);
    // Build the runner. `fnDef` is the *body* of an async fn taking `page`.
    // Wrapping keeps the outer signature stable regardless of what fnDef
    // is — an arrow returning a value, a full function block, etc.
    // Errors thrown during compilation → `error` (not `deferredResultId`).
    // Compiled in a `vm` context (see SandboxedEval.ts) — no `require`/
    // `process`/`fs`/`global` in scope, only `page` itself and safe globals.
    let runner: (page: Page) => Promise<unknown>;
    try {
      runner = compileSandboxedPageFunction<Page>(fnDef);
    } catch (err) {
      return {
        error: `Compilation error: ${(err as Error).message}`,
        summary: `Failed to compile Playwright code: ${(err as Error).message}`,
      };
    }

    const invocation = (async (): Promise<InvokeFunctionResult> => {
      try {
        const result = await runner(entry.page);
        return {
          result,
          summary: this.summarizeInvokeResult(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          error: message,
          summary: `Playwright code threw: ${message.slice(0, 200)}`,
        };
      }
    })();

    if (!timeoutMs || timeoutMs <= 0) {
      return invocation;
    }

    // Race the invocation against the timeout. If the timeout wins, we
    // stash the still-pending promise in the deferred-results map so
    // `waitForDeferredResult` can pick it up. The pending promise is
    // NOT cancelled — Playwright doesn't support cancellation, so the
    // best we can do is orphan it and clean up after N minutes.
    return this.raceWithDeferral(entry, invocation, timeoutMs);
  }

  async waitForDeferredResult(
    handle: BrowserHandle,
    deferredResultId: string,
    timeoutMs: number,
  ): Promise<InvokeFunctionResult> {
    const entry = this.mustEntry(handle);
    const rec = entry.deferredResults.get(deferredResultId);
    if (!rec) {
      return {
        error: `Unknown deferredResultId '${deferredResultId}' — may have expired.`,
        summary: 'Deferred result not found (likely expired after 5 minutes).',
      };
    }
    return this.raceWithDeferral(entry, rec.promise, timeoutMs, deferredResultId);
  }

  private async raceWithDeferral(
    entry: HostEntry,
    promise: Promise<InvokeFunctionResult>,
    timeoutMs: number,
    reuseId?: string,
  ): Promise<InvokeFunctionResult> {
    // Race with `Promise.race` semantics; on timeout, stash the promise
    // for later resumption. Any existing deferral record for `reuseId`
    // is replaced so a follow-up wait can iterate.
    const timeoutMarker = Symbol('timeout');
    const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
      setTimeout(() => resolve(timeoutMarker), Math.max(1, timeoutMs));
    });
    const outcome = await Promise.race([promise, timeoutPromise]);
    if (outcome === timeoutMarker) {
      const id = reuseId ?? `d-${randomUUID().slice(0, 8)}`;
      // Clear any prior cleanup timer for `reuseId` before overwriting.
      const prior = entry.deferredResults.get(id);
      if (prior?.cleanup) clearTimeout(prior.cleanup);
      // Auto-cleanup after 5 minutes if the caller never comes back.
      const cleanup = setTimeout(() => {
        entry.deferredResults.delete(id);
      }, 5 * 60_000);
      entry.deferredResults.set(id, { promise, settled: false, cleanup });
      // Flip `settled` when the inner promise finally lands.
      void promise.finally(() => {
        const rec = entry.deferredResults.get(id);
        if (rec) rec.settled = true;
      });
      return {
        deferredResultId: id,
        summary: `Playwright code still running — pass deferredResultId '${id}' to run_playwright_code to keep waiting.`,
      };
    }
    // Completed — drop any deferred record for this id.
    if (reuseId) {
      const rec = entry.deferredResults.get(reuseId);
      if (rec?.cleanup) clearTimeout(rec.cleanup);
      entry.deferredResults.delete(reuseId);
    }
    return outcome;
  }

  /** Best-effort human-readable summary of an `invokeFunction` result. */
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

  // ── Internal helpers ──

  private mustEntry(handle: BrowserHandle): HostEntry {
    const entry = this.entries.get(handle.workspaceId);
    if (!entry || entry.disposed) {
      throw new Error(`[ServerPlaywrightHost] No active browser session for workspace ${handle.workspaceId}`);
    }
    return entry;
  }

  private async findFreePort(base: number, tries = 200): Promise<number> {
    // Simple sequential probe — good enough for a handful of concurrent
    // sessions on localhost.
    const net = await import('node:net');
    for (let i = 0; i < tries; i++) {
      const port = base + i;
      const free = await new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
      });
      if (free) return port;
    }
    throw new Error(`[ServerPlaywrightHost] Could not find a free port near ${base}`);
  }

  private async waitForCdpReady(endpoint: string, timeoutMs: number): Promise<void> {
    const started = Date.now();
    const deadline = started + timeoutMs;
    let lastErr: unknown = null;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${endpoint}/json/version`).catch((e) => {
          lastErr = e;
          return null;
        });
        if (res && res.ok) {
          this.logger.debug?.(`[ServerPlaywrightHost] CDP ready in ${Date.now() - started}ms (${endpoint})`);
          return;
        }
      } catch (e) {
        lastErr = e;
      }
      // Tight poll — Chromium usually opens the CDP HTTP endpoint within
      // a few hundred milliseconds. Polling every 50 ms shaves off the
      // "quantization" tail of 200 ms per retry.
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
      `[ServerPlaywrightHost] CDP endpoint ${endpoint} did not become ready within ${timeoutMs}ms: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
  }
}
