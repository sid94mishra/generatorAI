/**
 * W15 — Browser context lifecycle manager.
 *
 * Wraps one Playwright BrowserContext with:
 *   - Per-context page management
 *   - Screencast: a poll loop with AT MOST ONE capture in flight
 *   - MAX_CONTEXTS = 10 cap enforced by the server
 *
 * △ The header used to claim "single pending slot, latest wins
 * (compositor-driven)". It was not: the implementation was a `setInterval` with
 * an `async` callback nobody awaited, so a page whose `screenshot()` took longer
 * than the interval accumulated captures without bound — the exact opposite of a
 * single slot. The loop below is self-scheduling and awaits each capture, which
 * is the strongest form of "one in flight" available to a *polled* source.
 *
 * It is still NOT compositor-driven. Real compositor-driven screencast means
 * CDP `Page.startScreencast` (or WebCodecs, which D5 chose and which has zero
 * occurrences in this repo) pushing frames as the page paints; that is the
 * unfinished half of W15 and is deliberately not claimed here.
 */

import type { Browser, BrowserContext, Page } from 'playwright';
import type { BrowserHostConfig, BrowserHostAction } from '@generatorai/shared';

export type FrameCallback = (data: string, format: 'jpeg' | 'webp') => void;

/** Idle-closes a context automatically after 5 min with no activity. */
const IDLE_TIMEOUT_MS = 5 * 60_000;

/**
 * Caps on one accessibility snapshot.
 *
 * The depth-10 guard bounds how DEEP the walk goes and says nothing about how
 * WIDE it is: a table or a feed with ten thousand shallow nodes serialises to
 * multi-megabyte JSON, which then crosses `process.send` — a channel that
 * serialises synchronously on the sending side and blocks the whole host while
 * it does. The budget is enforced inside the page (so the string is never built
 * in the first place) and re-checked here (so a page that defeats the in-page
 * count still cannot hand the gateway an unbounded payload).
 */
const MAX_SNAPSHOT_NODES = 1_500;
const MAX_SNAPSHOT_BYTES = 512 * 1024;

export class BrowserContextManager {
  /* W15 */
  readonly contextId: string;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly onFrame: FrameCallback;
  /**
   * Told when this context closes ITSELF — i.e. the idle timer fired rather
   * than the server asking. Without it the server's `contexts` map kept an
   * entry for a destroyed context forever: ten idle contexts and
   * `create_context` refused permanently, while the gateway was never sent
   * `context_destroyed` and went on addressing a context that no longer existed.
   */
  private readonly onSelfClose: ((contextId: string, reason: 'idle') => void) | undefined;
  private readonly idleTimeoutMs: number;
  private screencastActive = false;
  private screencastWake: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(opts: {
    contextId: string;
    onFrame: FrameCallback;
    onSelfClose?: (contextId: string, reason: 'idle') => void;
    /** Override for the 5-minute default. Bounded by the caller. */
    idleTimeoutMs?: number;
  }) {
    this.contextId = opts.contextId;
    this.onFrame = opts.onFrame;
    this.onSelfClose = opts.onSelfClose;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  }

  async initialize(browser: Browser, config?: BrowserHostConfig): Promise<void> {
    this.context = await browser.newContext({
      viewport: { width: config?.width ?? 1280, height: config?.height ?? 720 },
      userAgent: config?.userAgent,
      extraHTTPHeaders: config?.extraHTTPHeaders,
    });
    this.page = await this.context.newPage();
    this.resetIdleTimer();
  }

  async navigate(url: string): Promise<void> {
    this.ensurePage();
    this.resetIdleTimer();
    await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }

  async snapshot(mode: 'accessibility' | 'screenshot'): Promise<{ data: string; format: 'json' | 'jpeg' }> {
    this.ensurePage();
    this.resetIdleTimer();
    if (mode === 'accessibility') {
      // Capture accessibility tree via page.evaluate (works across all Playwright versions)
      //
      // △ Fixed during end-to-end review (found by BrowserHostServer.test.ts):
      // `serialize()` took a `depth` guard suggesting recursion but never
      // actually walked `el.children` — every snapshot returned exactly one
      // node (`document.body`'s own tag/role/label/text) regardless of page
      // content, so a caller could never see a button, link, or any other
      // interactive element anywhere in the tree. Own text is now only the
      // element's DIRECT text (not the full subtree's, which `textContent`
      // returns) so a parent's text and a child's text aren't duplicated.
      //
      // △ The depth guard is joined by a NODE BUDGET. Depth alone bounds
      // nothing on a wide page, and this JSON crosses `process.send`.
      const snapshot = await this.page!.evaluate<string>(`
        (function() {
          var budget = ${MAX_SNAPSHOT_NODES};
          var clipped = false;
          function ownText(el) {
            let text = '';
            for (const node of el.childNodes) {
              if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
            }
            return text.trim().slice(0, 200);
          }
          function serialize(el, depth) {
            if (depth > 10 || !el || el.nodeType !== Node.ELEMENT_NODE) return null;
            if (budget <= 0) { clipped = true; return null; }
            budget--;
            const role = el.getAttribute && el.getAttribute('role');
            const label = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'));
            const node = { tag: el.tagName, role, label, text: ownText(el) };
            const children = [];
            for (const child of el.children) {
              const serialized = serialize(child, depth + 1);
              if (serialized) children.push(serialized);
            }
            if (children.length > 0) node.children = children;
            return node;
          }
          var tree = serialize(document.body, 0);
          // A clipped tree that does not SAY it is clipped reads to the caller
          // as "this page has 1500 elements and none of them is the button".
          return JSON.stringify(clipped ? { clipped: true, nodeLimit: ${MAX_SNAPSHOT_NODES}, tree: tree } : tree);
        })()
      `);
      const data = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
      // Second line of defence: the in-page count bounds nodes, not bytes, and
      // 1500 nodes of long labels can still be large. Truncating a JSON string
      // would produce unparseable JSON, so an over-budget tree is replaced by a
      // well-formed marker instead.
      if (data.length > MAX_SNAPSHOT_BYTES) {
        return {
          data: JSON.stringify({
            clipped: true,
            byteLimit: MAX_SNAPSHOT_BYTES,
            actualBytes: data.length,
            tree: null,
          }),
          format: 'json',
        };
      }
      return { data, format: 'json' };
    } else {
      const buf = await this.page!.screenshot({ type: 'jpeg', quality: 80 });
      return { data: buf.toString('base64'), format: 'jpeg' };
    }
  }

  async performAction(action: BrowserHostAction): Promise<void> {
    this.ensurePage();
    this.resetIdleTimer();
    const page = this.page!;

    switch (action.action) {
      case 'click':
        if (action.selector) await page.click(action.selector);
        else if (action.x !== undefined && action.y !== undefined) await page.mouse.click(action.x, action.y);
        break;
      case 'type':
        if (action.selector) await page.fill(action.selector, action.text ?? '');
        break;
      case 'key':
        await page.keyboard.press(action.key ?? '');
        break;
      case 'scroll':
        // Use mouse.wheel instead of evaluate/scrollBy to avoid DOM type issues
        await page.mouse.wheel(0, (action.direction === 'down' ? 1 : -1) * (action.amount ?? 3) * 100);
        break;
      case 'hover':
        if (action.selector) await page.hover(action.selector);
        else if (action.x !== undefined && action.y !== undefined) await page.mouse.move(action.x, action.y);
        break;
      default:
        throw new Error(`Unknown browser action: ${action.action}`);
    }
  }

  startScreencast(fps = 5): void {
    if (this.screencastActive) return;
    this.screencastActive = true;
    const intervalMs = Math.max(100, Math.floor(1000 / fps));
    void this.pumpFrames(intervalMs);
  }

  stopScreencast(): void {
    this.screencastActive = false;
    if (this.screencastWake !== null) {
      clearTimeout(this.screencastWake);
      this.screencastWake = null;
    }
  }

  /** True while frames are being captured. Exposed for the host's own tests. */
  get isScreencasting(): boolean {
    return this.screencastActive;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.stopScreencast();
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    try {
      await this.context?.close();
    } catch {
      // Already closed
    }
    this.context = null;
    this.page = null;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  /**
   * One capture at a time, self-scheduling.
   *
   * Each iteration awaits its own screenshot before arming the next wake, so a
   * page that takes 800 ms to paint simply yields fewer frames instead of
   * queueing a second, third and fourth capture behind the first. The wait is
   * the REMAINDER of the interval, so a fast page still hits the target rate.
   */
  private async pumpFrames(intervalMs: number): Promise<void> {
    while (this.screencastActive && !this.destroyed) {
      const startedAt = Date.now();
      const page = this.page;
      if (!page) break;
      try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 60 });
        if (!this.screencastActive || this.destroyed) break;
        // P0-25, reintroduced in this host and fixed again here: delivering a
        // frame IS activity. Without this a context nobody is typing into but
        // everybody is watching closed itself after five minutes, mid-stream.
        this.resetIdleTimer();
        this.onFrame(buf.toString('base64'), 'jpeg');
      } catch {
        // Page may be mid-navigation; the next tick tries again.
      }
      if (!this.screencastActive || this.destroyed) break;
      const remaining = Math.max(0, intervalMs - (Date.now() - startedAt));
      await new Promise<void>((resolve) => {
        this.screencastWake = setTimeout(resolve, remaining);
        this.screencastWake.unref?.();
      });
    }
  }

  private ensurePage(): void {
    if (!this.page) throw new Error(`[BrowserContextManager] Context ${this.contextId} is not initialized`);
  }

  private resetIdleTimer(): void {
    if (this.destroyed) return;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      console.log(`[BrowserContextManager] Context ${this.contextId} idle — auto-closing`);
      // Destroy first, THEN announce: the owner's callback removes this entry
      // from the context map and tells the gateway, and both of those must
      // describe a context that is already gone.
      void this.destroy()
        .catch(() => undefined)
        .then(() => this.onSelfClose?.(this.contextId, 'idle'));
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }
}
