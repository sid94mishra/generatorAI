// ────────────────────────────────────────────────────────────────
// Shared harness for the BrowserPanel / NativeBrowserView characterization
// suites (P4-01, 09-verification.md §5.2).
//
// Only the data layer is faked here: `fetch` (the browser REST routes), the
// screencast `WebSocket`, the `window.generatoraiDesktop.browser` IPC bridge,
// and deterministic timers. The components themselves render for real inside
// the real ThemeProvider.
// ────────────────────────────────────────────────────────────────

import { act } from '@testing-library/react';
import { vi, type Mock } from 'vitest';

// ── Timers ───────────────────────────────────────────────────

/**
 * Plain fake timers (no `shouldAdvanceTime`): polling cadences are counted
 * exactly, so the clock must only move when a test moves it.
 */
export function useManualClock(): void {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
  });
}

/** Advance the fake clock inside `act`, flushing promises between timers. */
export async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Flush pending microtasks (resolved fetches, bridge promises) without moving time. */
export async function flush(): Promise<void> {
  await advance(0);
}

// ── Geometry ─────────────────────────────────────────────────

export interface Box { left: number; top: number; width: number; height: number }

export function domRect({ left, top, width, height }: Box): DOMRect {
  return {
    left, top, width, height,
    right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

// ── fetch ────────────────────────────────────────────────────

export interface BrowserDescriptorFixture {
  status: string;
  mode: 'native' | 'screencast' | 'off';
  ready: boolean;
  currentUrl?: string;
  attachedToChat?: boolean;
  config?: { visibility?: string; enabled?: boolean };
}

export interface FetchCall {
  url: string;
  method: string;
  workspaceId: string | null;
  /** The route after `/browser/` (e.g. `descriptor`, `actions`, `resize`). */
  route: string | null;
  body: unknown;
}

export interface ResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  blob: () => Promise<Blob>;
}

export function jsonResponse(body: unknown, status = 200): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([JSON.stringify(body)]),
  };
}

export interface BrowserFetchStub {
  calls: FetchCall[];
  /** Calls to one `/browser/<route>`. */
  to: (route: string) => FetchCall[];
  count: (route: string) => number;
  /** Replace the descriptor the poll (and every refetch) returns. */
  setDescriptor: (d: BrowserDescriptorFixture) => void;
  /** Answer the descriptor route with this HTTP status instead (e.g. 403, 503). */
  setDescriptorStatus: (status: number | null) => void;
  /** Override any route. */
  route: (route: string, respond: (call: FetchCall) => ResponseLike) => void;
}

/**
 * Stubs `fetch` with a router over `/api/workspaces/:id/browser/*`. Defaults:
 * descriptor → the fixture, start → a ready descriptor, scroll → a
 * non-scrollable page, capture → a PNG blob, attach/detach → the flag,
 * everything else → `{}`.
 */
export function installBrowserFetch(initial: BrowserDescriptorFixture): BrowserFetchStub {
  let descriptor = initial;
  let descriptorStatus: number | null = null;
  const overrides = new Map<string, (call: FetchCall) => ResponseLike>();
  const calls: FetchCall[] = [];

  const defaults: Record<string, (call: FetchCall) => ResponseLike> = {
    descriptor: () =>
      descriptorStatus != null
        ? jsonResponse({ error: { code: 'INSUFFICIENT_SCOPE' } }, descriptorStatus)
        : jsonResponse(descriptor),
    start: () => jsonResponse({ ...descriptor, status: 'active', ready: true }),
    scroll: () => jsonResponse({ scrollY: 0, scrollHeight: 600, clientHeight: 600 }),
    capture: () => ({ ...jsonResponse({}), blob: async () => new Blob(['png'], { type: 'image/png' }) }),
    detach: () => jsonResponse({ attachedToChat: false }),
    attach: () => jsonResponse({ attachedToChat: true }),
  };

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const m = /\/api\/workspaces\/([^/]+)\/browser\/([^?]+)/.exec(url);
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    const call: FetchCall = {
      url,
      method: init?.method ?? 'GET',
      workspaceId: m?.[1] ?? null,
      route: m?.[2] ?? null,
      body,
    };
    calls.push(call);
    const respond = (call.route && (overrides.get(call.route) ?? defaults[call.route])) || (() => jsonResponse({}));
    return respond(call) as unknown as Response;
  }));

  return {
    calls,
    to: (route) => calls.filter((c) => c.route === route),
    count: (route) => calls.filter((c) => c.route === route).length,
    setDescriptor: (d) => { descriptor = d; },
    setDescriptorStatus: (s) => { descriptorStatus = s; },
    route: (route, respond) => { overrides.set(route, respond); },
  };
}

// ── WebSocket ────────────────────────────────────────────────

/** A screencast socket that never opens by itself (input then goes over HTTP). */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = 'blob';
  readyState = 0;
  readonly OPEN = 1;
  sent: string[] = [];
  closed = false;
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.closed = true; this.readyState = 3; }
}

/** One JPEG wire frame in the `browser-ws.ts` header layout. */
export function jpegWireFrame(width: number, height: number): ArrayBuffer {
  const HEADER = 16;
  const buf = new ArrayBuffer(HEADER + 4);
  const view = new DataView(buf);
  view.setUint8(0, 0x47);
  view.setUint8(1, 1);
  view.setUint8(2, 0); // JPEG
  view.setUint8(3, 1);
  view.setUint16(4, width);
  view.setUint16(6, height);
  view.setFloat64(8, 0);
  return buf;
}

/**
 * Canvas + bitmap stubs so a JPEG frame paints: happy-dom has no 2D context
 * and no `createImageBitmap`. The bitmap reports `width`×`height`.
 */
export function installFramePainting(width: number, height: number): void {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close: () => undefined })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => ({ drawImage: vi.fn() })) as unknown as typeof HTMLCanvasElement.prototype.getContext,
  );
}

// ── Native bridge ────────────────────────────────────────────

type BrowserApi = GeneratorAIDesktopBrowserApi;
export type BridgeMocks = { [K in keyof BrowserApi]: Mock<BrowserApi[K]> };
type NativeDescriptor = Awaited<ReturnType<BrowserApi['create']>>;
type NativeEvent = Parameters<Parameters<BrowserApi['onDidNavigate']>[0]>[0];
type EventName = 'navigate' | 'finishLoad' | 'failLoad' | 'title' | 'favicon' | 'loading';

export interface BrowserBridge {
  api: BridgeMocks;
  emit: (name: EventName, evt: Partial<NativeEvent> & { tabId: string }) => void;
  install: () => void;
  uninstall: () => void;
}

export function makeBrowserBridge(opts: { available?: boolean; created?: Partial<NativeDescriptor> } = {}): BrowserBridge {
  const listeners: Record<EventName, Set<(evt: NativeEvent) => void>> = {
    navigate: new Set(), finishLoad: new Set(), failLoad: new Set(), title: new Set(), favicon: new Set(), loading: new Set(),
  };
  const subscribe = (name: EventName) => (cb: (evt: NativeEvent) => void) => {
    listeners[name].add(cb);
    return () => { listeners[name].delete(cb); };
  };
  const descriptor = (tabId: string, workspaceId: string, extra: Partial<NativeDescriptor> = {}): NativeDescriptor => ({
    tabId, workspaceId, currentUrl: null, title: null, favicon: null, isLoading: false,
    canGoBack: false, canGoForward: false, cdpEndpoint: null, ...opts.created, ...extra,
  });
  const noop = async (): Promise<void> => undefined;

  const api: BridgeMocks = {
    available: vi.fn<BrowserApi['available']>(async () => opts.available ?? true),
    create: vi.fn<BrowserApi['create']>(async (tabId, workspaceId) => descriptor(tabId, workspaceId)),
    destroy: vi.fn<BrowserApi['destroy']>(noop),
    setActiveTab: vi.fn<BrowserApi['setActiveTab']>(noop),
    setBounds: vi.fn<BrowserApi['setBounds']>(noop),
    setVisible: vi.fn<BrowserApi['setVisible']>(noop),
    navigate: vi.fn<BrowserApi['navigate']>(async (tabId, url) => descriptor(tabId, 'ws', { currentUrl: url })),
    back: vi.fn<BrowserApi['back']>(noop),
    forward: vi.fn<BrowserApi['forward']>(noop),
    reload: vi.fn<BrowserApi['reload']>(noop),
    screenshot: vi.fn<BrowserApi['screenshot']>(async () => 'data:image/png;base64,AAAA'),
    describe: vi.fn<BrowserApi['describe']>(async (tabId) => descriptor(tabId, 'ws')),
    openDevtools: vi.fn<BrowserApi['openDevtools']>(noop),
    setEmulation: vi.fn<BrowserApi['setEmulation']>(noop),
    setZoom: vi.fn<BrowserApi['setZoom']>(noop),
    pickElement: vi.fn<BrowserApi['pickElement']>(async () => null),
    captureRegion: vi.fn<BrowserApi['captureRegion']>(async () => null),
    annotateStart: vi.fn<BrowserApi['annotateStart']>(noop),
    annotateStop: vi.fn<BrowserApi['annotateStop']>(noop),
    annotatePoll: vi.fn<BrowserApi['annotatePoll']>(async () => ({ total: 0, items: [], sent: [] })),
    annotateSend: vi.fn<BrowserApi['annotateSend']>(async () => []),
    annotateRegion: vi.fn<BrowserApi['annotateRegion']>(noop),
    annotateRemove: vi.fn<BrowserApi['annotateRemove']>(noop),
    annotateClear: vi.fn<BrowserApi['annotateClear']>(noop),
    onDidNavigate: vi.fn<BrowserApi['onDidNavigate']>(subscribe('navigate')),
    onDidFinishLoad: vi.fn<BrowserApi['onDidFinishLoad']>(subscribe('finishLoad')),
    onDidFailLoad: vi.fn<BrowserApi['onDidFailLoad']>(subscribe('failLoad')),
    onTitleUpdated: vi.fn<BrowserApi['onTitleUpdated']>(subscribe('title')),
    onFaviconUpdated: vi.fn<BrowserApi['onFaviconUpdated']>(subscribe('favicon')),
    onLoadingChanged: vi.fn<BrowserApi['onLoadingChanged']>(subscribe('loading')),
  };

  const host = window as unknown as { generatoraiDesktop?: { browser: BridgeMocks } };
  return {
    api,
    emit: (name, evt) => {
      for (const cb of [...listeners[name]]) cb({ workspaceId: 'ws', ...evt } as NativeEvent);
    },
    install: () => { host.generatoraiDesktop = { browser: api }; },
    uninstall: () => { delete host.generatoraiDesktop; },
  };
}
