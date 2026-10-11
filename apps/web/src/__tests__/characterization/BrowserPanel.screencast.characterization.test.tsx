// ────────────────────────────────────────────────────────────────
// BrowserPanel characterization — screencast live view (P4-01).
//
// Pins the CURRENT web/screencast behaviour of components/chat/BrowserPanel.tsx (now blocks/browser/BrowserPanel.tsx)
// before the P4 split (03-component-inventory-domain.md §6.2 →
// useBrowserViewportResize / useBrowserScrollState / useBrowserLiveStream input
// dispatch / useBrowserCapture; 09-verification.md §5.2 "Screencast"):
//   • resize pushes: ≥ 256 px change, 400 ms debounce, skipped below 100×100,
//     the first push 100 ms after the session is ready;
//   • scroll polling every 250 ms (never for a native-mode session) and the
//     overlay scrollbar rule `scrollHeight > clientHeight + 4` (+ thumb drag);
//   • canvas input: mouse-move throttle 100 ms, clicks only in inspect mode when
//     restricted, wheel always, keys (F5/F12 not forwarded);
//   • drag-capture ≥ 8×8 px posting /capture with a clip.
//
// Already pinned elsewhere and NOT repeated here: "an invisible panel opens 0
// sockets" (BrowserPanelVisibility.test.tsx) and the codec/keyframe/hidden-frame
// rules (BrowserPanelWebCodecs.test.tsx).
//
// Mocks only the data layer (`@/platform/muxStream`, `@/platform/authTransport`,
// `fetch`, `WebSocket`) plus DOM APIs happy-dom lacks (ResizeObserver callbacks,
// layout rects, a 2D canvas context and createImageBitmap).
// These assertions must stay unchanged through the P4 split — only the marked
// import line may change.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '@/providers/ThemeProvider.js';

import {
  advance,
  domRect,
  FakeWebSocket,
  flush,
  installBrowserFetch,
  installFramePainting,
  jpegWireFrame,
  jsonResponse,
  useManualClock,
  type BrowserDescriptorFixture,
  type BrowserFetchStub,
} from './helpers/browserHarness.js';

// Import under test — the only line that changes when P4 moves the file.
import { BrowserPanel } from '@/blocks/browser/BrowserPanel.js';

vi.mock('@/platform/authTransport.js', () => ({
  buildAuthenticatedSocketUrl: vi.fn(async (url: string) => url),
}));
vi.mock('@/platform/muxStream.js', () => ({
  openMultiplexedStream: vi.fn(() => ({ close: vi.fn() })),
}));

const INTERACTIVITY_KEY = 'generatorai:browser:webInteractivity';

const READY: BrowserDescriptorFixture = {
  status: 'active',
  mode: 'screencast',
  ready: true,
  currentUrl: 'https://example.com/',
  config: { visibility: 'visible', enabled: true },
};

/** The live container and the canvas both lay out at 800×600 from the origin. */
const LAYOUT = { left: 0, top: 0, width: 800, height: 600 };

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  targets: Element[] = [];
  constructor(private readonly cb: ResizeObserverCallback) { FakeResizeObserver.instances.push(this); }
  observe(el: Element): void { this.targets.push(el); }
  unobserve(): void {}
  disconnect(): void { this.targets = []; }
  fire(width: number, height: number): void {
    const entry = { contentRect: { width, height } } as ResizeObserverEntry;
    act(() => { this.cb([entry], this as unknown as ResizeObserver); });
  }
}

type PanelProps = React.ComponentProps<typeof BrowserPanel>;

function panel(props: Partial<PanelProps> = {}): React.JSX.Element {
  // A chat host by default (Annotate and Screenshot exist only where there is a chat to send to).
  return <BrowserPanel workspaceId="ws-1" tabId="tab-1" open visible onClose={() => {}} onCapture={() => {}} {...props} />;
}

async function mountReady(props: Partial<PanelProps> = {}) {
  const view = render(panel(props), { wrapper: ThemeProvider });
  // descriptor → ready → ticket → socket
  await flush();
  await flush();
  return { ...view, update: (next: Partial<PanelProps>) => view.rerender(panel({ ...props, ...next })) };
}

/** Delivers one JPEG frame on the live socket so the canvas is 800×600 and `hasFrame` is true. */
async function paintFrame(): Promise<void> {
  const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!ws) throw new Error('no live socket was opened');
  act(() => { ws.onmessage?.({ data: jpegWireFrame(800, 600) }); });
  await flush();
}

const liveView = (): HTMLElement => screen.getByRole('img', { name: 'Browser live view' });
const inspectButton = (): HTMLElement => screen.getByTestId('browser-annotate');
const inputs = (): unknown[] => fetchStub.to('input').map((c) => c.body);
/** The overlay scrollbar track: the only aria-hidden <div> the panel renders (BrowserPanel.tsx:2088-2098). */
const scrollbar = (container: HTMLElement): HTMLElement | null => container.querySelector('div[aria-hidden="true"]');

let fetchStub: BrowserFetchStub;

beforeEach(() => {
  useManualClock();
  vi.clearAllMocks();
  window.localStorage.clear();
  delete (window as unknown as { __gaiLastMouseMove?: number }).__gaiLastMouseMove;
  FakeWebSocket.instances.length = 0;
  FakeResizeObserver.instances.length = 0;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(domRect(LAYOUT));
  installFramePainting(800, 600);
  fetchStub = installBrowserFetch(READY);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── Viewport resize ──────────────────────────────────────────

describe('BrowserPanel screencast — viewport resize pushes (BrowserPanel.tsx:510-539)', () => {
  const resizeBodies = (): unknown[] => fetchStub.to('resize').map((c) => c.body);
  const liveObserver = (): FakeResizeObserver => {
    const ro = FakeResizeObserver.instances.find((o) => o.targets.some((t) => t.contains(liveView())));
    if (!ro) throw new Error('the live container is not observed');
    return ro;
  };

  it('pushes the container size 100 ms after the session is ready', async () => {
    await mountReady();
    await advance(99);
    expect(resizeBodies()).toEqual([]);
    await advance(1);
    expect(resizeBodies()).toEqual([{ width: 800, height: 600 }]);
    expect(fetchStub.to('resize')[0]?.method).toBe('POST');
  });

  it('ignores changes under 256 px on both axes', async () => {
    await mountReady();
    await advance(100);
    liveObserver().fire(1055, 855);
    await advance(1000);
    expect(resizeBodies()).toHaveLength(1);
  });

  it('a change of ≥ 256 px on either axis is pushed after a 400 ms debounce (latest size wins)', async () => {
    await mountReady();
    await advance(100);
    liveObserver().fire(1056, 600);
    await advance(200);
    liveObserver().fire(1200, 600);
    await advance(399);
    expect(resizeBodies()).toHaveLength(1);
    await advance(1);
    expect(resizeBodies()).toEqual([{ width: 800, height: 600 }, { width: 1200, height: 600 }]);

    liveObserver().fire(1200, 856);
    await advance(400);
    expect(resizeBodies()[2]).toEqual({ width: 1200, height: 856 });
  });

  it('sizes below 100×100 are never pushed', async () => {
    await mountReady();
    await advance(100);
    liveObserver().fire(99, 900);
    liveObserver().fire(1200, 99);
    await advance(1000);
    expect(resizeBodies()).toHaveLength(1);
  });

  it('nothing is pushed while the session is not ready', async () => {
    fetchStub.setDescriptor({ ...READY, status: 'off', ready: false });
    await mountReady();
    await advance(2000);
    expect(resizeBodies()).toEqual([]);
  });
});

// ── Scroll polling + overlay scrollbar ───────────────────────

describe('BrowserPanel screencast — scroll polling (BrowserPanel.tsx:542-562)', () => {
  it('polls /scroll immediately and then every 250 ms', async () => {
    await mountReady();
    expect(fetchStub.count('scroll')).toBe(1);
    await advance(249);
    expect(fetchStub.count('scroll')).toBe(1);
    await advance(1);
    expect(fetchStub.count('scroll')).toBe(2);
    await advance(500);
    expect(fetchStub.count('scroll')).toBe(4);
  });

  it('never polls a native-mode session', async () => {
    fetchStub.setDescriptor({ ...READY, mode: 'native' });
    await mountReady();
    await advance(2000);
    expect(fetchStub.count('scroll')).toBe(0);
  });

  it('stops when the panel closes', async () => {
    const view = await mountReady();
    view.update({ open: false });
    await flush();
    const n = fetchStub.count('scroll');
    await advance(2000);
    expect(fetchStub.count('scroll')).toBe(n);
  });
});

describe('BrowserPanel screencast — overlay scrollbar (BrowserPanel.tsx:2081)', () => {
  function scrollOf(scrollHeight: number, clientHeight = 600, scrollY = 0): void {
    fetchStub.route('scroll', () => jsonResponse({ scrollY, scrollHeight, clientHeight }));
  }

  it('appears only when scrollHeight > clientHeight + 4', async () => {
    scrollOf(604);
    const { container } = await mountReady();
    await paintFrame();
    await advance(250);
    expect(scrollbar(container)).toBeNull();
    scrollOf(605);
    await advance(250);
    expect(scrollbar(container)).not.toBeNull();
  });

  it('is not drawn before the first frame has painted', async () => {
    scrollOf(2000);
    const { container } = await mountReady();
    await advance(250);
    expect(scrollbar(container)).toBeNull();
    await paintFrame();
    expect(scrollbar(container)).not.toBeNull();
  });

  it('dragging the thumb sends a mouse.wheel for the scroll delta', async () => {
    scrollOf(2000);
    const { container } = await mountReady();
    await paintFrame();
    const thumb = scrollbar(container)?.firstElementChild;
    if (!thumb) throw new Error('no scrollbar thumb');
    fireEvent.mouseDown(thumb, { clientY: 100 });
    // 30 px of a 600 px track = 5 % of the 2000 px page = 100 px.
    fireEvent.mouseMove(window, { clientY: 130 });
    fireEvent.mouseUp(window);
    await flush();
    expect(inputs()).toContainEqual({ type: 'mouse.wheel', deltaX: 0, deltaY: 100 });
  });
});

// ── Canvas input ─────────────────────────────────────────────

describe('BrowserPanel screencast — pointer input', () => {
  it('full interactivity: mouse moves are throttled to one per 100 ms', async () => {
    window.localStorage.setItem(INTERACTIVITY_KEY, 'true');
    await mountReady();
    await paintFrame();
    // The fake clock starts at performance.now() === 0, which the throttle's truthiness
    // check treats as "never moved"; real clocks are never 0, so move off it first.
    await advance(1000);
    fireEvent.mouseMove(liveView(), { clientX: 10, clientY: 20 });
    await advance(50);
    fireEvent.mouseMove(liveView(), { clientX: 11, clientY: 21 });
    await advance(49);
    fireEvent.mouseMove(liveView(), { clientX: 12, clientY: 22 });
    await flush();
    expect(inputs()).toEqual([{ type: 'mouse.move', x: 10, y: 20 }]);
    await advance(1);
    fireEvent.mouseMove(liveView(), { clientX: 13, clientY: 23 });
    await flush();
    expect(inputs()).toEqual([{ type: 'mouse.move', x: 10, y: 20 }, { type: 'mouse.move', x: 13, y: 23 }]);
  });

  it('restricted: no moves and no clicks reach the page unless Inspect is on', async () => {
    await mountReady();
    await paintFrame();
    fireEvent.mouseMove(liveView(), { clientX: 10, clientY: 20 });
    fireEvent.click(liveView(), { clientX: 10, clientY: 20 });
    await flush();
    expect(inputs()).toEqual([]);

    fireEvent.click(inspectButton());
    await flush();
    fireEvent.mouseMove(liveView(), { clientX: 30, clientY: 40 });
    fireEvent.click(liveView(), { clientX: 30, clientY: 40 });
    await flush();
    expect(inputs()).toEqual([
      { type: 'mouse.move', x: 30, y: 40 },
      { type: 'mouse.click', x: 30, y: 40, button: 'left', clickCount: 1 },
    ]);
  });

  it('restricted: the wheel always scrolls the page', async () => {
    await mountReady();
    await paintFrame();
    fireEvent.wheel(liveView(), { clientX: 5, clientY: 6, deltaX: 0, deltaY: 120 });
    await flush();
    // happy-dom's WheelEvent carries no clientX/Y, so only the deltas are asserted.
    expect(inputs()).toEqual([expect.objectContaining({ type: 'mouse.wheel', deltaX: 0, deltaY: 120 })]);
  });

  it('full interactivity: a click is forwarded with page coordinates; right-click as button "right"', async () => {
    window.localStorage.setItem(INTERACTIVITY_KEY, 'true');
    await mountReady();
    await paintFrame();
    fireEvent.click(liveView(), { clientX: 400, clientY: 300 });
    fireEvent.contextMenu(liveView(), { clientX: 100, clientY: 50, button: 2 });
    await flush();
    expect(inputs()).toEqual([
      { type: 'mouse.click', x: 400, y: 300, button: 'left', clickCount: 1 },
      { type: 'mouse.click', x: 100, y: 50, button: 'right', clickCount: 1 },
    ]);
  });
});

describe('BrowserPanel screencast — keyboard input (BrowserPanel.tsx:983-997)', () => {
  it('printable keys are typed, others pressed with modifiers; both are preventDefault-ed', async () => {
    window.localStorage.setItem(INTERACTIVITY_KEY, 'true');
    await mountReady();
    expect(fireEvent.keyDown(liveView(), { key: 'a' })).toBe(false);
    expect(fireEvent.keyDown(liveView(), { key: 'c', ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(liveView(), { key: 'Enter' })).toBe(false);
    await flush();
    expect(inputs()).toEqual([
      { type: 'key.type', text: 'a' },
      { type: 'key.press', key: 'c', modifiers: ['Control'] },
      { type: 'key.press', key: 'Enter', modifiers: [] },
    ]);
  });

  it.each(['F5', 'F12'])('%s is neither forwarded nor prevented', async (key) => {
    window.localStorage.setItem(INTERACTIVITY_KEY, 'true');
    await mountReady();
    expect(fireEvent.keyDown(liveView(), { key })).toBe(true);
    await flush();
    expect(inputs()).toEqual([]);
  });

  it('restricted: keys are not forwarded', async () => {
    await mountReady();
    expect(fireEvent.keyDown(liveView(), { key: 'a' })).toBe(true);
    await flush();
    expect(inputs()).toEqual([]);
  });
});

// ── Drag capture ─────────────────────────────────────────────

describe('BrowserPanel screencast — drag capture (BrowserPanel.tsx:1000-1056)', () => {
  const captureButton = (): HTMLElement => screen.getByRole('button', { name: /^Screenshot an area — drag/ });

  async function drag(from: [number, number], to: [number, number]): Promise<void> {
    fireEvent.mouseDown(liveView(), { clientX: from[0], clientY: from[1] });
    fireEvent.mouseMove(liveView(), { clientX: to[0], clientY: to[1] });
    fireEvent.mouseUp(liveView(), { clientX: to[0], clientY: to[1] });
    await flush();
  }

  it('a drag of at least 8×8 posts /capture with the clip and attaches capture-<ts>.png; capture mode ends', async () => {
    window.localStorage.setItem(INTERACTIVITY_KEY, 'true');
    const onCapture = vi.fn();
    await mountReady({ onCapture });
    await paintFrame();
    fireEvent.click(captureButton());
    expect(captureButton()).toHaveAttribute('aria-pressed', 'true');
    await drag([110, 70], [10, 20]); // dragging up-left normalises the rect
    expect(fetchStub.to('capture').map((c) => [c.method, c.body])).toEqual([
      ['POST', { clip: { x: 10, y: 20, width: 100, height: 50 } }],
    ]);
    expect(onCapture).toHaveBeenCalledTimes(1);
    const [file, kind] = onCapture.mock.calls[0] as [File, string];
    expect(kind).toBe('screenshot');
    expect(file.name).toMatch(/^capture-\d+\.png$/);
    expect(file.type).toBe('image/png');
    expect(captureButton()).toHaveAttribute('aria-pressed', 'false');
    // Capture-mode mouse events are not forwarded to the page.
    expect(inputs()).toEqual([]);
  });

  it('exactly 8×8 is captured; 7 px on either axis is a stray click (mode still ends)', async () => {
    window.localStorage.setItem(INTERACTIVITY_KEY, 'true');
    await mountReady({ onCapture: vi.fn() });
    await paintFrame();
    fireEvent.click(captureButton());
    await drag([0, 0], [7, 50]);
    expect(fetchStub.count('capture')).toBe(0);
    expect(captureButton()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(captureButton());
    await drag([0, 0], [50, 7]);
    expect(fetchStub.count('capture')).toBe(0);
    fireEvent.click(captureButton());
    await drag([0, 0], [8, 8]);
    expect(fetchStub.to('capture')[0]?.body).toEqual({ clip: { x: 0, y: 0, width: 8, height: 8 } });
  });

  it('a failed capture shows the server error', async () => {
    window.localStorage.setItem(INTERACTIVITY_KEY, 'true');
    fetchStub.route('capture', () => jsonResponse({ error: { message: 'capture timed out' } }, 500));
    await mountReady({ onCapture: vi.fn() });
    await paintFrame();
    fireEvent.click(captureButton());
    await drag([0, 0], [100, 100]);
    expect(screen.getByTitle('capture timed out')).toBeInTheDocument();
  });
});
