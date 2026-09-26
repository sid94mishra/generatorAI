// ────────────────────────────────────────────────────────────────
// NativeBrowserView characterization (P4-01).
//
// Pins the CURRENT component behaviour of components/chat/NativeBrowserView.tsx (now blocks/browser/NativeBrowserView.tsx)
// before it moves to blocks/browser/ (03-component-inventory-domain.md §6.2,
// 09-verification.md §5.2 "NativeBrowserView" + the D-19 cases):
//   • lifecycle — create(tabId, workspaceId, false) on mount, destroy on
//     unmount, the restore URL read once and used only when the view is not
//     already on an http(s) page;
//   • bounds — setBounds via rAF on ResizeObserver / window resize / scroll
//     (capture phase), DPR-snapped, skipped under 4 px, deduplicated;
//   • the 100 ms visibility loop at component level — hidden container
//     (visibility:hidden ancestor, < 4 px), overlapping `data-gai-overlay` /
//     toast layers, the ancestor (narrow dock sheet) exemption, the
//     "Paused (overlay open)" badge, setActiveTab on becoming visible, hide on
//     unmount;
//   • the placeholder screenshot poll (2 s watched / 1 s otherwise) and the
//     250 ms refresh after navigation / load events.
//
// The pure occlusion decision is pinned by __tests__/components/
// nativeBrowserOcclusion.test.ts (D-19, kept); the old OVERLAY_SELECTORS list
// cases are replaced by those.
//
// Mocks only the `window.generatoraiDesktop.browser` bridge, plus layout
// (getBoundingClientRect, ResizeObserver, requestAnimationFrame,
// devicePixelRatio) and timers, which happy-dom cannot provide.
// These assertions must stay unchanged through the P4 split — only the marked
// import line may change.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  advance,
  domRect,
  flush,
  makeBrowserBridge,
  useManualClock,
  type Box,
  type BrowserBridge,
} from './helpers/browserHarness.js';

// Import under test — the only line that changes when P4 moves the file.
import { NativeBrowserView } from '@/blocks/browser/NativeBrowserView.js';

const VIEW_LABEL = 'Native browser view';
const BADGE = 'Paused (overlay open)';
/** The dock's browser tab body at 1440×900 (same geometry as nativeBrowserOcclusion.test.ts). */
const VIEW: Box = { left: 960, top: 100, width: 460, height: 760 };

// ── Layout stubs ─────────────────────────────────────────────

const rects = new Map<Element, Box>();
let viewBox: Box = VIEW;

function stubLayout(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const own = rects.get(this);
    if (own) return domRect(own);
    if (this.getAttribute('aria-label') === VIEW_LABEL) return domRect(viewBox);
    return domRect({ left: 0, top: 0, width: 0, height: 0 });
  });
}

let frames: Array<FrameRequestCallback | null> = [];
function stubAnimationFrames(): void {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames[id - 1] = null;
  });
}
/** Runs every queued animation frame. */
function runFrames(): void {
  const queued = frames;
  frames = [];
  act(() => { for (const cb of queued) cb?.(0); });
}
const pendingFrames = (): number => frames.filter(Boolean).length;

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(private readonly cb: ResizeObserverCallback) { FakeResizeObserver.instances.push(this); }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  fire(): void { act(() => { this.cb([], this as unknown as ResizeObserver); }); }
}

function setDpr(dpr: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: dpr });
}

/** A floating layer appended to <body> at `box`. */
function addLayer(attrs: Record<string, string>, box: Box): HTMLElement {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  rects.set(el, box);
  return el;
}

// ── Render ───────────────────────────────────────────────────

type ViewProps = React.ComponentProps<typeof NativeBrowserView>;

function view(props: Partial<ViewProps> = {}): React.JSX.Element {
  return <NativeBrowserView tabId="tab-1" workspaceId="ws-1" {...props} />;
}

/** Wraps the view in a host element (e.g. a hidden tab panel or a dock sheet). */
function Host({ attrs, style, children }: { attrs?: Record<string, string>; style?: React.CSSProperties; children: React.ReactNode }) {
  return <div data-testid="host" style={style} {...attrs}>{children}</div>;
}

const container = (): HTMLElement => screen.getByLabelText(VIEW_LABEL);

let bridge: BrowserBridge;

beforeEach(() => {
  useManualClock();
  rects.clear();
  viewBox = VIEW;
  FakeResizeObserver.instances.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  stubLayout();
  stubAnimationFrames();
  setDpr(1);
  bridge = makeBrowserBridge();
  bridge.install();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  bridge.uninstall();
  setDpr(1);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── Lifecycle ────────────────────────────────────────────────

describe('NativeBrowserView — lifecycle (NativeBrowserView.tsx:93-123)', () => {
  it('creates the view as an inactive tab on mount and reports its url / title / favicon', async () => {
    bridge = makeBrowserBridge({ created: { currentUrl: 'https://a.example/', title: 'A', favicon: 'data:fav' } });
    bridge.install();
    const onUrlChange = vi.fn();
    const onTitleChange = vi.fn();
    const onFaviconChange = vi.fn();
    render(view({ onUrlChange, onTitleChange, onFaviconChange }));
    await flush();
    expect(bridge.api.create).toHaveBeenCalledTimes(1);
    expect(bridge.api.create).toHaveBeenCalledWith('tab-1', 'ws-1', false);
    expect(onUrlChange).toHaveBeenCalledWith('https://a.example/');
    expect(onTitleChange).toHaveBeenCalledWith('A');
    expect(onFaviconChange).toHaveBeenCalledWith('data:fav');
  });

  it('does not report a favicon the view does not have', async () => {
    const onFaviconChange = vi.fn();
    render(view({ onFaviconChange }));
    await flush();
    expect(onFaviconChange).not.toHaveBeenCalled();
  });

  it('destroys the view and hides it on unmount', async () => {
    const { unmount } = render(view());
    await flush();
    unmount();
    expect(bridge.api.destroy).toHaveBeenCalledWith('tab-1');
    expect(bridge.api.setVisible).toHaveBeenLastCalledWith('tab-1', false);
  });

  it('a new tabId destroys the old view and creates the new one', async () => {
    const { rerender } = render(view());
    await flush();
    rerender(view({ tabId: 'tab-2' }));
    await flush();
    expect(bridge.api.destroy).toHaveBeenCalledWith('tab-1');
    expect(bridge.api.create).toHaveBeenLastCalledWith('tab-2', 'ws-1', false);
  });

  it('a create failure is reported through onError', async () => {
    bridge.api.create.mockRejectedValueOnce(new Error('no WebContentsView'));
    const onError = vi.fn();
    render(view({ onError }));
    await flush();
    expect(onError).toHaveBeenCalledWith('no WebContentsView');
  });

  it('restores the remembered page when the view is on an internal / blank page', async () => {
    bridge = makeBrowserBridge({ created: { currentUrl: 'about:blank#gai-ws-1' } });
    bridge.install();
    render(view({ restoreUrl: 'https://restored.example/' }));
    await flush();
    expect(bridge.api.navigate).toHaveBeenCalledWith('tab-1', 'https://restored.example/');
  });

  it('does not restore over a view that already shows an http(s) page (tab reuse)', async () => {
    bridge = makeBrowserBridge({ created: { currentUrl: 'http://live.example/' } });
    bridge.install();
    render(view({ restoreUrl: 'https://restored.example/' }));
    await flush();
    expect(bridge.api.navigate).not.toHaveBeenCalled();
  });

  it.each([null, '', 'about:blank', 'about:blank#gai-ws-1', 'file:///etc/hosts', 'chrome://settings'])(
    'never restores a non-http(s) URL (%j)',
    async (restoreUrl) => {
      render(view({ restoreUrl }));
      await flush();
      expect(bridge.api.navigate).not.toHaveBeenCalled();
    },
  );

  it('a failing restore navigation is swallowed', async () => {
    bridge.api.navigate.mockRejectedValueOnce(new Error('dead bookmark'));
    const onError = vi.fn();
    render(view({ restoreUrl: 'https://dead.example/', onError }));
    await flush();
    expect(bridge.api.navigate).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reads the restore URL once: later prop changes are ignored, even by a re-created view', async () => {
    const { rerender } = render(view({ restoreUrl: 'https://first.example/' }));
    await flush();
    rerender(view({ restoreUrl: 'https://second.example/' }));
    await flush();
    expect(bridge.api.navigate).toHaveBeenCalledTimes(1);
    // A new tabId re-runs create; the ref still holds the mount-time URL.
    rerender(view({ tabId: 'tab-2', restoreUrl: 'https://second.example/' }));
    await flush();
    expect(bridge.api.navigate.mock.calls).toEqual([
      ['tab-1', 'https://first.example/'],
      ['tab-2', 'https://first.example/'],
    ]);
  });
});

// ── Bounds ───────────────────────────────────────────────────

describe('NativeBrowserView — bounds sync (NativeBrowserView.tsx:129-171)', () => {
  it('pushes the container rect on the next animation frame after mount', () => {
    render(view());
    expect(bridge.api.setBounds).not.toHaveBeenCalled();
    runFrames();
    expect(bridge.api.setBounds).toHaveBeenCalledWith('tab-1', { x: 960, y: 100, width: 460, height: 760 });
  });

  it('snaps to device pixels, then floors (DPR 1 vs DPR 4)', () => {
    viewBox = { left: 10.6, top: 20.2, width: 300.6, height: 200.3 };
    setDpr(1);
    const first = render(view());
    runFrames();
    expect(bridge.api.setBounds).toHaveBeenLastCalledWith('tab-1', { x: 11, y: 20, width: 301, height: 200 });
    first.unmount();

    setDpr(4);
    render(view({ tabId: 'tab-2' }));
    runFrames();
    // 10.6 × 4 = 42.4 → 42 / 4 = 10.5 → 10; 300.6 × 4 = 1202.4 → 1202 / 4 = 300.5 → 300
    expect(bridge.api.setBounds).toHaveBeenLastCalledWith('tab-2', { x: 10, y: 20, width: 300, height: 200 });
  });

  it('never pushes a rect under 4 px on either axis (keeps the last real bounds)', () => {
    viewBox = { ...VIEW, width: 3 };
    render(view());
    runFrames();
    expect(bridge.api.setBounds).not.toHaveBeenCalled();
    viewBox = { ...VIEW, height: 3 };
    window.dispatchEvent(new Event('resize'));
    runFrames();
    expect(bridge.api.setBounds).not.toHaveBeenCalled();
    viewBox = VIEW;
    window.dispatchEvent(new Event('resize'));
    runFrames();
    expect(bridge.api.setBounds).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a ResizeObserver callback', () => FakeResizeObserver.instances.forEach((o) => o.fire())],
    ['a window resize', () => window.dispatchEvent(new Event('resize'))],
    ['a scroll anywhere (capture phase)', () => {
      const scroller = document.createElement('div');
      document.body.appendChild(scroller);
      scroller.dispatchEvent(new Event('scroll')); // scroll does not bubble
    }],
  ])('%s re-pushes changed bounds on the next frame', (_label, trigger) => {
    render(view());
    runFrames();
    expect(bridge.api.setBounds).toHaveBeenCalledTimes(1);
    viewBox = { ...VIEW, left: 900, width: 520 };
    trigger();
    expect(bridge.api.setBounds).toHaveBeenCalledTimes(1);
    runFrames();
    expect(bridge.api.setBounds).toHaveBeenLastCalledWith('tab-1', { x: 900, y: 100, width: 520, height: 760 });
  });

  it('coalesces several triggers into one frame and skips an unchanged rect', () => {
    render(view());
    runFrames();
    viewBox = { ...VIEW, top: 140, height: 720 };
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    FakeResizeObserver.instances.forEach((o) => o.fire());
    expect(pendingFrames()).toBe(1);
    runFrames();
    expect(bridge.api.setBounds).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('resize'));
    runFrames();
    expect(bridge.api.setBounds).toHaveBeenCalledTimes(2);
  });

  it('unmount cancels the pending frame and stops listening', () => {
    const { unmount } = render(view());
    expect(pendingFrames()).toBe(1);
    unmount();
    expect(pendingFrames()).toBe(0);
    window.dispatchEvent(new Event('resize'));
    expect(pendingFrames()).toBe(0);
  });
});

// ── Visibility / overlay loop ────────────────────────────────

describe('NativeBrowserView — 100 ms visibility loop (NativeBrowserView.tsx:212-246)', () => {
  it('first tick at 100 ms: a visible view is shown and made the active tab', async () => {
    render(view());
    await advance(99);
    expect(bridge.api.setVisible).not.toHaveBeenCalled();
    await advance(1);
    expect(bridge.api.setVisible).toHaveBeenCalledWith('tab-1', true);
    // DISCREPANCY (03 §6.2 "setActiveTab only on hidden→visible after the first tick"): the
    // code also calls it on the FIRST tick when the view starts visible — `wasHidden !== false`
    // is true for the initial `null` (NativeBrowserView.tsx:233). Only a first tick that finds
    // the view hidden skips it.
    expect(bridge.api.setActiveTab).toHaveBeenCalledWith('ws-1', 'tab-1');
    expect(screen.queryByText(BADGE)).toBeNull();
  });

  it('only transitions call the bridge (steady state is silent)', async () => {
    render(view());
    await advance(100);
    await advance(1000);
    expect(bridge.api.setVisible).toHaveBeenCalledTimes(1);
    expect(bridge.api.setActiveTab).toHaveBeenCalledTimes(1);
  });

  it('a visibility:hidden ancestor (inactive dock tab) hides it; showing it again re-activates the tab', async () => {
    const { rerender } = render(<Host style={{ visibility: 'hidden' }}>{view()}</Host>);
    await advance(100);
    expect(bridge.api.setVisible).toHaveBeenLastCalledWith('tab-1', false);
    expect(bridge.api.setActiveTab).not.toHaveBeenCalled();

    rerender(<Host>{view()}</Host>);
    await advance(100);
    expect(bridge.api.setVisible).toHaveBeenLastCalledWith('tab-1', true);
    expect(bridge.api.setActiveTab).toHaveBeenCalledTimes(1);
    expect(bridge.api.setActiveTab).toHaveBeenCalledWith('ws-1', 'tab-1');

    rerender(<Host style={{ visibility: 'hidden' }}>{view()}</Host>);
    await advance(100);
    rerender(<Host>{view()}</Host>);
    await advance(100);
    expect(bridge.api.setActiveTab).toHaveBeenCalledTimes(2);
  });

  it('a container under 4 px counts as hidden (and shows the paused badge)', async () => {
    viewBox = { ...VIEW, height: 3 };
    render(view());
    await advance(100);
    expect(bridge.api.setVisible).toHaveBeenLastCalledWith('tab-1', false);
    expect(screen.getByText(BADGE)).toBeInTheDocument();
    viewBox = VIEW;
    await advance(100);
    expect(bridge.api.setVisible).toHaveBeenLastCalledWith('tab-1', true);
    expect(screen.queryByText(BADGE)).toBeNull();
  });

  it('D-19: a data-gai-overlay layer over the view (a menu) hides it with "Paused (overlay open)"; closing it shows the view again', async () => {
    render(view());
    await advance(100);
    const menu = addLayer({ 'data-gai-overlay': 'menu' }, { left: 1000, top: 150, width: 200, height: 240 });
    await advance(100);
    expect(bridge.api.setVisible).toHaveBeenLastCalledWith('tab-1', false);
    expect(screen.getByText(BADGE)).toBeInTheDocument();
    expect(container()).toContainElement(screen.getByText(BADGE));

    menu.remove();
    await advance(100);
    expect(bridge.api.setVisible).toHaveBeenLastCalledWith('tab-1', true);
    expect(bridge.api.setActiveTab).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(BADGE)).toBeNull();
  });

  it('D-19: an overlay that does not intersect the view leaves it visible', async () => {
    render(view());
    addLayer({ 'data-gai-overlay': 'popover' }, { left: 100, top: 100, width: 300, height: 300 });
    await advance(300);
    expect(bridge.api.setVisible.mock.calls).toEqual([['tab-1', true]]);
    expect(screen.queryByText(BADGE)).toBeNull();
  });

  it('D-19: browser tab inside the narrow dock sheet stays visible (the overlay is an ancestor)', async () => {
    render(<Host attrs={{ 'data-gai-overlay': 'sheet' }}>{view()}</Host>);
    rects.set(screen.getByTestId('host'), { left: 0, top: 0, width: 1440, height: 900 });
    await advance(300);
    expect(bridge.api.setVisible.mock.calls).toEqual([['tab-1', true]]);
    expect(screen.queryByText(BADGE)).toBeNull();
  });

  it('D-19: the maximized dock (not an overlay) covering the viewport keeps it visible', async () => {
    render(<Host attrs={{ 'data-testid': 'dock' }}>{view()}</Host>);
    rects.set(screen.getByTestId('dock'), { left: 0, top: 0, width: 1440, height: 900 });
    viewBox = { left: 0, top: 44, width: 1440, height: 856 };
    await advance(300);
    expect(bridge.api.setVisible.mock.calls).toEqual([['tab-1', true]]);
  });

  it('D-19: the toast layer hides it only while a toast overlaps', async () => {
    render(view());
    const away = addLayer({ 'data-sonner-toast': '' }, { left: 16, top: 820, width: 356, height: 64 });
    await advance(200);
    expect(bridge.api.setVisible.mock.calls).toEqual([['tab-1', true]]);
    away.remove();
    addLayer({ 'data-sonner-toast': '' }, { left: 1068, top: 820, width: 356, height: 64 });
    await advance(100);
    expect(bridge.api.setVisible).toHaveBeenLastCalledWith('tab-1', false);
    expect(screen.getByText(BADGE)).toBeInTheDocument();
  });

  it('a legacy Radix layer (role="dialog") over the view still hides it (legacy half of the selector, removed in P7-01)', async () => {
    render(view());
    await advance(100);
    addLayer({ role: 'dialog' }, { left: 400, top: 200, width: 800, height: 500 });
    await advance(100);
    expect(bridge.api.setVisible).toHaveBeenLastCalledWith('tab-1', false);
  });

  it('hides the view on unmount', async () => {
    const { unmount } = render(view());
    await advance(100);
    unmount();
    expect(bridge.api.setVisible).toHaveBeenLastCalledWith('tab-1', false);
    const calls = bridge.api.setVisible.mock.calls.length;
    await advance(500);
    expect(bridge.api.setVisible).toHaveBeenCalledTimes(calls);
  });
});

// ── Placeholder screenshot ───────────────────────────────────

describe('NativeBrowserView — placeholder screenshot (NativeBrowserView.tsx:177-204, 249-301)', () => {
  it('while watched: captures at mount, then every 2 s, and paints it as the background', async () => {
    render(view());
    await flush();
    expect(bridge.api.screenshot).toHaveBeenCalledTimes(1);
    expect(bridge.api.screenshot).toHaveBeenCalledWith('tab-1');
    expect(container().style.backgroundImage).toContain('data:image/png;base64,AAAA');
    await advance(1999);
    expect(bridge.api.screenshot).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(bridge.api.screenshot).toHaveBeenCalledTimes(2);
    await advance(2000);
    expect(bridge.api.screenshot).toHaveBeenCalledTimes(3);
  });

  it('while hidden: never captures, but re-checks every 1 s', async () => {
    const { rerender } = render(<Host style={{ visibility: 'hidden' }}>{view()}</Host>);
    await advance(5000);
    expect(bridge.api.screenshot).not.toHaveBeenCalled();
    rerender(<Host>{view()}</Host>);
    await advance(999);
    expect(bridge.api.screenshot).not.toHaveBeenCalled();
    await advance(1);
    expect(bridge.api.screenshot).toHaveBeenCalledTimes(1);
  });

  it('a hidden document counts as not watched', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    try {
      render(view());
      await advance(3000);
      expect(bridge.api.screenshot).not.toHaveBeenCalled();
    } finally {
      delete (document as unknown as { hidden?: boolean }).hidden;
    }
  });

  it('a navigation of this tab reports the URL and refreshes the placeholder 250 ms later', async () => {
    const onUrlChange = vi.fn();
    render(view({ onUrlChange }));
    await flush();
    const n = bridge.api.screenshot.mock.calls.length;
    act(() => bridge.emit('navigate', { tabId: 'tab-1', url: 'https://next.example/' }));
    expect(onUrlChange).toHaveBeenLastCalledWith('https://next.example/');
    await advance(249);
    expect(bridge.api.screenshot).toHaveBeenCalledTimes(n);
    await advance(1);
    expect(bridge.api.screenshot).toHaveBeenCalledTimes(n + 1);
  });

  it('a finished load refreshes the placeholder 250 ms later', async () => {
    render(view());
    await flush();
    const n = bridge.api.screenshot.mock.calls.length;
    act(() => bridge.emit('finishLoad', { tabId: 'tab-1' }));
    await advance(250);
    expect(bridge.api.screenshot).toHaveBeenCalledTimes(n + 1);
  });

  it("another tab's events are ignored", async () => {
    const onUrlChange = vi.fn();
    const onTitleChange = vi.fn();
    render(view({ onUrlChange, onTitleChange }));
    await flush();
    onUrlChange.mockClear();
    onTitleChange.mockClear();
    const n = bridge.api.screenshot.mock.calls.length;
    act(() => {
      bridge.emit('navigate', { tabId: 'tab-2', url: 'https://other.example/' });
      bridge.emit('finishLoad', { tabId: 'tab-2' });
      bridge.emit('title', { tabId: 'tab-2', title: 'Other' });
    });
    await advance(300);
    expect(onUrlChange).not.toHaveBeenCalled();
    expect(onTitleChange).not.toHaveBeenCalled();
    expect(bridge.api.screenshot).toHaveBeenCalledTimes(n);
  });
});

describe('NativeBrowserView — page events', () => {
  it('forwards title / load failure / loading / favicon for this tab and unsubscribes on unmount', async () => {
    const onTitleChange = vi.fn();
    const onError = vi.fn();
    const onLoadingChange = vi.fn();
    const onFaviconChange = vi.fn();
    const { unmount } = render(view({ onTitleChange, onError, onLoadingChange, onFaviconChange }));
    await flush();
    onTitleChange.mockClear();
    act(() => {
      bridge.emit('title', { tabId: 'tab-1', title: 'Hello' });
      bridge.emit('failLoad', { tabId: 'tab-1', errorDescription: 'ERR_NAME_NOT_RESOLVED' });
      bridge.emit('failLoad', { tabId: 'tab-1' }); // no description → not an error
      bridge.emit('loading', { tabId: 'tab-1', loading: true });
      bridge.emit('favicon', { tabId: 'tab-1' });
    });
    expect(onTitleChange).toHaveBeenCalledWith('Hello');
    expect(onError.mock.calls).toEqual([['ERR_NAME_NOT_RESOLVED']]);
    expect(onLoadingChange).toHaveBeenCalledWith(true);
    expect(onFaviconChange).toHaveBeenCalledWith(null);

    unmount();
    onTitleChange.mockClear();
    act(() => bridge.emit('title', { tabId: 'tab-1', title: 'After' }));
    expect(onTitleChange).not.toHaveBeenCalled();
  });
});
