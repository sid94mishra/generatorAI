/**
 * W15 — Browser Host server process.
 *
 * Owns the single Chromium instance with up to MAX_CONTEXTS browser contexts.
 * The gateway never holds Playwright handles (L5).
 */

import { chromium, type Browser } from 'playwright';
import type {
  BrowserHostRequest,
  BrowserHostResponse,
  BrowserHostConfig,
  BrowserFrameNotification,
} from '@generatorai/shared';
import { isBrowserHostRequest } from '@generatorai/shared';
import { BrowserContextManager } from './BrowserContextManager.js';

const MAX_CONTEXTS = 10;

export class BrowserHostServer {
  /* W15 */
  private browser: Browser | null = null;
  private readonly contexts = new Map<string, BrowserContextManager>();
  private readonly bootTime = Date.now();

  start(): void {
    if (typeof process.send !== 'function') {
      throw new Error('[BrowserHostServer] Not running as a forked child process — process.send unavailable');
    }

    process.on('message', (raw: unknown) => {
      if (!isBrowserHostRequest(raw)) {
        console.warn('[BrowserHostServer] Received unrecognised IPC message');
        return;
      }
      this.handleRequest(raw as BrowserHostRequest).catch((err: unknown) => {
        console.error(`[BrowserHostServer] Unhandled error: ${String(err)}`);
      });
    });

    this.send({ type: 'pong', reqId: '__ready__' });
    console.log('[BrowserHostServer] Browser host ready');
  }

  private send(msg: BrowserHostResponse): void {
    process.send!(msg);
  }

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  private async handleRequest(req: BrowserHostRequest): Promise<void> {
    switch (req.type) {
      case 'ping':
        this.send({ type: 'pong', reqId: req.reqId });
        return;

      case 'create_context': {
        const { reqId, contextId, config } = req;
        if (this.contexts.has(contextId)) {
          this.send({ type: 'error', reqId, ok: false, message: `Context ${contextId} already exists`, contextId });
          return;
        }
        if (this.contexts.size >= MAX_CONTEXTS) {
          this.send({ type: 'error', reqId, ok: false, message: `MAX_CONTEXTS (${MAX_CONTEXTS}) reached`, contextId });
          return;
        }
        try {
          const browser = await this.ensureBrowser();
          const ctx = new BrowserContextManager({
            contextId,
            onFrame: (data, format) => {
              const notification: BrowserFrameNotification = { type: 'frame', contextId, data, format };
              this.send(notification);
            },
          });
          await ctx.initialize(browser, config);
          this.contexts.set(contextId, ctx);
          this.send({ type: 'context_ready', contextId });
          this.send({ type: 'ack', reqId, ok: true });
        } catch (err: unknown) {
          this.send({ type: 'error', reqId, ok: false, message: String(err), contextId });
        }
        return;
      }

      case 'navigate': {
        const { reqId, contextId, url } = req;
        const ctx = this.contexts.get(contextId);
        if (!ctx) {
          this.send({ type: 'error', reqId, ok: false, message: `Context ${contextId} not found`, contextId });
          return;
        }
        try {
          await ctx.navigate(url);
          this.send({ type: 'ack', reqId, ok: true });
        } catch (err: unknown) {
          this.send({ type: 'error', reqId, ok: false, message: String(err), contextId });
        }
        return;
      }

      case 'snapshot': {
        const { reqId, contextId, mode } = req;
        const ctx = this.contexts.get(contextId);
        if (!ctx) {
          this.send({ type: 'error', reqId, ok: false, message: `Context ${contextId} not found`, contextId });
          return;
        }
        try {
          const result = await ctx.snapshot(mode);
          this.send({ type: 'snapshot_result', contextId, reqId, data: result.data, format: result.format });
        } catch (err: unknown) {
          this.send({ type: 'error', reqId, ok: false, message: String(err), contextId });
        }
        return;
      }

      case 'action': {
        const { reqId, contextId, action } = req;
        const ctx = this.contexts.get(contextId);
        if (!ctx) {
          this.send({ type: 'error', reqId, ok: false, message: `Context ${contextId} not found`, contextId });
          return;
        }
        try {
          await ctx.performAction(action);
          this.send({ type: 'action_result', contextId, reqId, success: true });
        } catch (err: unknown) {
          this.send({ type: 'action_result', contextId, reqId, success: false, error: String(err) });
        }
        return;
      }

      case 'start_screencast': {
        const { reqId, contextId, fps } = req;
        const ctx = this.contexts.get(contextId);
        if (!ctx) {
          this.send({ type: 'error', reqId, ok: false, message: `Context ${contextId} not found`, contextId });
          return;
        }
        ctx.startScreencast(fps);
        this.send({ type: 'ack', reqId, ok: true });
        return;
      }

      case 'stop_screencast': {
        const { reqId, contextId } = req;
        const ctx = this.contexts.get(contextId);
        if (ctx) ctx.stopScreencast();
        this.send({ type: 'ack', reqId, ok: true });
        return;
      }

      case 'destroy_context': {
        const { reqId, contextId } = req;
        const ctx = this.contexts.get(contextId);
        if (ctx) {
          await ctx.destroy();
          this.contexts.delete(contextId);
          this.send({ type: 'context_destroyed', contextId });
        }
        this.send({ type: 'ack', reqId, ok: true });
        return;
      }

      default: {
        const unknown = req as { type: string; reqId?: string };
        console.warn(`[BrowserHostServer] Unknown request type: ${unknown.type}`);
        if (unknown.reqId) {
          this.send({ type: 'error', reqId: unknown.reqId, ok: false, message: `Unknown type: ${unknown.type}` });
        }
      }
    }
  }

  async shutdown(): Promise<void> {
    for (const [, ctx] of this.contexts) {
      await ctx.destroy();
    }
    this.contexts.clear();
    try {
      await this.browser?.close();
    } catch {
      // Already closed
    }
    this.browser = null;
    console.log('[BrowserHostServer] Shutdown complete');
  }
}
