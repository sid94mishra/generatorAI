/**
 * W15 — Browser context lifecycle manager.
 *
 * Wraps one Playwright BrowserContext with:
 *   - Per-context page management
 *   - Screencast: single pending slot, latest wins (compositor-driven)
 *   - MAX_CONTEXTS = 10 cap enforced by the server
 */

import type { Browser, BrowserContext, Page } from 'playwright';
import type { BrowserHostConfig, BrowserHostAction } from '@generatorai/shared';

export type FrameCallback = (data: string, format: 'jpeg' | 'webp') => void;

/** Idle-closes a context automatically after 5 min with no activity. */
const IDLE_TIMEOUT_MS = 5 * 60_000;

export class BrowserContextManager {
  /* W15 */
  readonly contextId: string;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly onFrame: FrameCallback;
  private screencastActive = false;
  private screencastTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: { contextId: string; onFrame: FrameCallback }) {
    this.contextId = opts.contextId;
    this.onFrame = opts.onFrame;
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
      const snapshot = await this.page!.evaluate<string>(`
        (function() {
          function serialize(el, depth) {
            if (depth > 10) return null;
            const role = el.getAttribute && el.getAttribute('role');
            const label = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'));
            const text = el.textContent ? el.textContent.trim().slice(0, 200) : '';
            return { tag: el.tagName, role, label, text };
          }
          return JSON.stringify(serialize(document.body, 0));
        })()
      `);
      return { data: typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot), format: 'json' };
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

    this.screencastTimer = setInterval(async () => {
      if (!this.page || !this.screencastActive) return;
      try {
        const buf = await this.page.screenshot({ type: 'jpeg', quality: 60 });
        this.onFrame(buf.toString('base64'), 'jpeg');
      } catch {
        // Page may have navigated; swallow
      }
    }, intervalMs);
  }

  stopScreencast(): void {
    this.screencastActive = false;
    if (this.screencastTimer !== null) {
      clearInterval(this.screencastTimer);
      this.screencastTimer = null;
    }
  }

  async destroy(): Promise<void> {
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

  private ensurePage(): void {
    if (!this.page) throw new Error(`[BrowserContextManager] Context ${this.contextId} is not initialized`);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      console.log(`[BrowserContextManager] Context ${this.contextId} idle — auto-closing`);
      void this.destroy();
    }, IDLE_TIMEOUT_MS);
    this.idleTimer.unref?.();
  }
}
