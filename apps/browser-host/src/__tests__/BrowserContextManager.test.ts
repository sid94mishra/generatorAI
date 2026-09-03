// ────────────────────────────────────────────────────────────────
// BrowserContextManager — lifecycle and screencast bounds.
//
// Driven against a fake Playwright surface rather than real Chromium: every
// defect below is about TIMING and OWNERSHIP (does a capture overlap the next
// one, does a frame count as activity, does the owner learn the context is
// gone), and a real browser makes those slow and flaky without making them any
// more true.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright';
import { BrowserContextManager } from '../BrowserContextManager.js';

/** How long the fake `page.screenshot()` takes to resolve. */
interface FakePageOptions {
  screenshotMs?: number;
  evaluateResult?: string;
}

function makeBrowser(opts: FakePageOptions = {}): {
  browser: Browser;
  concurrentPeak: () => number;
  shots: () => number;
  closed: () => boolean;
} {
  let inFlight = 0;
  let peak = 0;
  let shots = 0;
  let contextClosed = false;

  const page = {
    async goto() {},
    async screenshot(): Promise<Buffer> {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      shots += 1;
      await new Promise((r) => setTimeout(r, opts.screenshotMs ?? 0));
      inFlight -= 1;
      return Buffer.from('fake-jpeg-bytes');
    },
    async evaluate(): Promise<string> {
      return opts.evaluateResult ?? '{"tag":"BODY"}';
    },
    mouse: { async click() {}, async wheel() {}, async move() {} },
    keyboard: { async press() {} },
    async click() {},
    async fill() {},
    async hover() {},
  };

  const context = {
    async newPage() { return page; },
    async close() { contextClosed = true; },
  };

  const browser = { async newContext() { return context; } } as unknown as Browser;
  return { browser, concurrentPeak: () => peak, shots: () => shots, closed: () => contextClosed };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('BrowserContextManager screencast', () => {
  it('never runs two captures at once, even when a capture outlasts the interval', async () => {
    // 120 ms per screenshot against a 100 ms interval. The previous
    // implementation was `setInterval(async () => …)` with nothing awaiting the
    // callback, so every tick started another capture regardless of whether the
    // last one had finished — unbounded overlap on any page slower than the fps.
    const { browser, concurrentPeak, shots } = makeBrowser({ screenshotMs: 120 });
    const ctx = new BrowserContextManager({ contextId: 'c1', onFrame: () => {} });
    await ctx.initialize(browser);

    ctx.startScreencast(10);
    await sleep(700);
    ctx.stopScreencast();
    await sleep(200);

    expect(concurrentPeak()).toBe(1);
    // Sanity: it really did keep capturing, so the peak of 1 is not "it never ran".
    expect(shots()).toBeGreaterThan(2);
    await ctx.destroy();
  });

  it('stops capturing once stopped, and does not resume', async () => {
    const { browser, shots } = makeBrowser({ screenshotMs: 5 });
    const ctx = new BrowserContextManager({ contextId: 'c1', onFrame: () => {} });
    await ctx.initialize(browser);

    ctx.startScreencast(20);
    await sleep(150);
    ctx.stopScreencast();
    const taken = shots();
    await sleep(200);

    expect(ctx.isScreencasting).toBe(false);
    expect(shots()).toBe(taken);
    await ctx.destroy();
  });
});

describe('BrowserContextManager idle lifecycle', () => {
  it('an actively screencast context does NOT idle out (P0-25)', async () => {
    // The frame path did not call `resetIdleTimer()`, so a context nobody typed
    // into but everybody was watching closed itself mid-stream.
    const { browser, closed } = makeBrowser({ screenshotMs: 5 });
    const onSelfClose = vi.fn();
    const ctx = new BrowserContextManager({
      contextId: 'c1',
      onFrame: () => {},
      onSelfClose,
      idleTimeoutMs: 250,
    });
    await ctx.initialize(browser);
    ctx.startScreencast(20);

    // Four times the idle timeout with no navigate, snapshot or action —
    // frames are the ONLY activity.
    await sleep(1000);

    expect(onSelfClose).not.toHaveBeenCalled();
    expect(closed()).toBe(false);
    ctx.stopScreencast();
    await ctx.destroy();
  });

  it('tells its owner when it closes itself, so the owner can drop the entry', async () => {
    const { browser, closed } = makeBrowser();
    const onSelfClose = vi.fn();
    const ctx = new BrowserContextManager({
      contextId: 'c1',
      onFrame: () => {},
      onSelfClose,
      idleTimeoutMs: 200,
    });
    await ctx.initialize(browser);

    await sleep(600);

    expect(onSelfClose).toHaveBeenCalledWith('c1', 'idle');
    // Announced only AFTER the context is really gone — the owner's callback
    // tells the gateway, and the gateway must not be told about a context that
    // is still half-open.
    expect(closed()).toBe(true);
  });

  it('an explicit destroy does not fire the self-close callback', async () => {
    // The server already knows: it asked. Firing here would make it delete an
    // entry it is about to replace, or double-send `context_destroyed`.
    const { browser } = makeBrowser();
    const onSelfClose = vi.fn();
    const ctx = new BrowserContextManager({
      contextId: 'c1',
      onFrame: () => {},
      onSelfClose,
      idleTimeoutMs: 5_000,
    });
    await ctx.initialize(browser);
    await ctx.destroy();
    await sleep(50);

    expect(onSelfClose).not.toHaveBeenCalled();
  });

  it('navigation refreshes the idle deadline', async () => {
    const { browser } = makeBrowser();
    const onSelfClose = vi.fn();
    const ctx = new BrowserContextManager({
      contextId: 'c1',
      onFrame: () => {},
      onSelfClose,
      idleTimeoutMs: 300,
    });
    await ctx.initialize(browser);

    await sleep(200);
    await ctx.navigate('about:blank');
    await sleep(200);

    expect(onSelfClose).not.toHaveBeenCalled();
    await ctx.destroy();
  });
});

describe('BrowserContextManager accessibility snapshot budget', () => {
  it('replaces an oversized tree with a well-formed marker rather than shipping it', async () => {
    // The depth-10 guard bounds depth, not width, and this JSON crosses
    // `process.send` — which serialises synchronously and blocks the host.
    const huge = JSON.stringify({ tag: 'BODY', text: 'x'.repeat(2 * 1024 * 1024) });
    const { browser } = makeBrowser({ evaluateResult: huge });
    const ctx = new BrowserContextManager({ contextId: 'c1', onFrame: () => {} });
    await ctx.initialize(browser);

    const result = await ctx.snapshot('accessibility');

    expect(result.format).toBe('json');
    expect(result.data.length).toBeLessThan(1024);
    const parsed = JSON.parse(result.data) as { clipped?: boolean; byteLimit?: number };
    expect(parsed.clipped).toBe(true);
    expect(parsed.byteLimit).toBeGreaterThan(0);
    await ctx.destroy();
  });

  it('passes a normal tree through untouched', async () => {
    const tree = JSON.stringify({ tag: 'BODY', children: [{ tag: 'BUTTON', text: 'Go' }] });
    const { browser } = makeBrowser({ evaluateResult: tree });
    const ctx = new BrowserContextManager({ contextId: 'c1', onFrame: () => {} });
    await ctx.initialize(browser);

    const result = await ctx.snapshot('accessibility');

    expect(result.data).toBe(tree);
    await ctx.destroy();
  });
});
