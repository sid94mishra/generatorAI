// ────────────────────────────────────────────────────────────────
// BrowserPanel characterization — core (P4-01).
//
// Pins the CURRENT behaviour of components/chat/BrowserPanel.tsx (now blocks/browser/BrowserPanel.tsx) before the
// P4 split into blocks/browser/ (03-component-inventory-domain.md §6.2,
// 09-verification.md §5.2): open === false, interactivity mode (native vs the
// `generatorai:browser:webInteractivity` key + cross-mount `storage` event),
// desktop auto-start, descriptor polling cadence, SSE refetch + element
// selection, and which controls restricted mode shows.
//
// Sibling suites: BrowserPanel.toolbar.characterization.test.tsx (URL bar,
// share, Inspect/Capture, error banner), BrowserPanel.screencast.characterization.test.tsx
// (live view, resize, scroll, input, drag capture) and
// BrowserPanel.native.characterization.test.tsx (desktop-only behaviour).
//
// Already pinned elsewhere and NOT repeated here (those files are kept):
//   • the "isn’t granted to this device" copy and the 401/403/503 real-time
//     retry check — __tests__/components/BrowserPanelDenied.test.tsx
//   • an invisible panel opens 0 sockets / closes and reopens it (P1-50) —
//     __tests__/components/BrowserPanelVisibility.test.tsx
//   • VP8/JPEG decode, keyframe gating — __tests__/components/BrowserPanelWebCodecs.test.tsx
//
// Mocks only the data layer: `@/platform/muxStream`, `@/platform/authTransport`,
// `fetch`, `WebSocket` and `window.generatoraiDesktop.browser`.
// These assertions must stay unchanged through the P4 split — only the marked
// import line may change.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openMultiplexedStream } from '@/platform/muxStream.js';
import { ThemeProvider } from '@/providers/ThemeProvider.js';

import {
  advance,
  FakeWebSocket,
  flush,
  installBrowserFetch,
  jsonResponse,
  makeBrowserBridge,
  useManualClock,
  type BrowserBridge,
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
const OFF: BrowserDescriptorFixture = { status: 'off', mode: 'off', ready: false };
const NATIVE_READY: BrowserDescriptorFixture = { ...READY, mode: 'native' };

type PanelProps = React.ComponentProps<typeof BrowserPanel>;

function panel(props: Partial<PanelProps> = {}): React.JSX.Element {
  return <BrowserPanel workspaceId="ws-1" tabId="tab-1" open visible onClose={() => {}} {...props} />;
}

function renderPanel(props: Partial<PanelProps> = {}) {
  const view = render(panel(props), { wrapper: ThemeProvider });
  return { ...view, update: (next: Partial<PanelProps>) => view.rerender(panel({ ...props, ...next })) };
}

function enableWebInteractivity(): void {
  window.localStorage.setItem(INTERACTIVITY_KEY, 'true');
}

/** The last `openMultiplexedStream` subscription's message handler. */
function sseEmit(frame: unknown): void {
  const calls = vi.mocked(openMultiplexedStream).mock.calls;
  const handlers = calls[calls.length - 1]?.[2];
  act(() => {
    handlers?.onMessage?.({ lastEventId: '1', data: JSON.stringify(frame) });
  });
}

const urlBox = (): HTMLInputElement => screen.getByRole('textbox') as HTMLInputElement;
const inspectButton = (): HTMLElement => screen.getByRole('button', { name: /^Comment — click elements/ });
const captureButton = (): HTMLElement => screen.getByRole('button', { name: /^Capture region — drag/ });

let fetchStub: BrowserFetchStub;
let bridge: BrowserBridge | null = null;

beforeEach(() => {
  useManualClock();
  vi.clearAllMocks();
  window.localStorage.clear();
  FakeWebSocket.instances.length = 0;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  fetchStub = installBrowserFetch(READY);
});

afterEach(() => {
  cleanup();
  bridge?.uninstall();
  bridge = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function installNative(opts: Parameters<typeof makeBrowserBridge>[0] = {}): BrowserBridge {
  bridge = makeBrowserBridge(opts);
  bridge.install();
  return bridge;
}

// ── open === false ───────────────────────────────────────────

describe('BrowserPanel — closed', () => {
  it('renders nothing, polls nothing and opens no event stream when open is false (BrowserPanel.tsx:1523)', async () => {
    const { container } = renderPanel({ open: false });
    await advance(10_000);
    expect(container).toBeEmptyDOMElement();
    expect(fetchStub.count('descriptor')).toBe(0);
    expect(openMultiplexedStream).not.toHaveBeenCalled();
  });
});

// ── Mode ─────────────────────────────────────────────────────

describe('BrowserPanel — interactivity mode', () => {
  it('desktop native browser: always full-interactive, renders the "Native browser view" and no canvas', async () => {
    installNative();
    fetchStub.setDescriptor(NATIVE_READY);
    renderPanel();
    await flush();
    expect(screen.getByLabelText('Native browser view')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Browser live view' })).toBeNull();
    // The web interactivity key is absent, yet the nav controls and the URL input are there.
    expect(window.localStorage.getItem(INTERACTIVITY_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forward' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(urlBox()).toHaveAttribute('placeholder', 'Search or enter address');
  });

  it('web default (key unset): restricted — read-only URL pill, no nav/start-stop/capture, canvas live view', async () => {
    renderPanel();
    await flush();
    expect(screen.queryByRole('textbox')).toBeNull();
    const pill = screen.getByText('https://example.com/');
    expect(pill).toHaveAttribute('title', 'https://example.com/');
    for (const name of ['Back', 'Forward', 'Reload', 'Stop browser']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: /^Capture region/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'Browser live view' })).toBeInTheDocument();
    // Inspect stays: it is the only way to attach an element in restricted mode.
    expect(inspectButton()).toBeInTheDocument();
    // DISCREPANCY (03 §6.2): the doc says restricted mode hides share; the code renders the
    // Share toggle whenever the browser is on, regardless of interactivity (BrowserPanel.tsx:1610).
    expect(screen.getByRole('button', { name: 'Sharing with Agent — click to stop sharing' })).toBeInTheDocument();
  });

  it('web restricted + browser off: no Start button, the empty state points at the interactive-browser setting', async () => {
    fetchStub.setDescriptor(OFF);
    renderPanel();
    await flush();
    expect(screen.getByText('Browser is not running.')).toBeInTheDocument();
    expect(screen.getByText(/Ask the agent to browse a page, or enable/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start/ })).toBeNull();
    expect(screen.getByText('about:blank')).toBeInTheDocument(); // the pill's fallback
  });

  it('web with the key "true": full controls, but none of the desktop-only ones', async () => {
    enableWebInteractivity();
    renderPanel();
    await flush();
    expect(urlBox()).toHaveAttribute('placeholder', 'https://example.com');
    for (const name of ['Back', 'Forward', 'Reload', 'Stop browser']) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
    expect(captureButton()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Toggle device toolbar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Browser options' })).toBeNull();
    expect(screen.queryByLabelText('Native browser view')).toBeNull();
  });

  it('web full + browser off: Start button and the "press Start" placeholder', async () => {
    enableWebInteractivity();
    fetchStub.setDescriptor(OFF);
    renderPanel();
    await flush();
    expect(screen.getByRole('button', { name: /Start/ })).toBeEnabled();
    expect(urlBox()).toHaveAttribute('placeholder', 'https://…  (press Start)');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  it('a `storage` event for the key switches every mounted panel; key === null re-reads; other keys are ignored', async () => {
    render(
      <>
        {panel({ tabId: 'tab-1' })}
        {panel({ tabId: 'tab-2' })}
      </>,
      { wrapper: ThemeProvider },
    );
    await flush();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);

    // What setWebBrowserInteractivity() does: write, then announce.
    act(() => {
      window.localStorage.setItem(INTERACTIVITY_KEY, 'true');
      window.dispatchEvent(new StorageEvent('storage', { key: INTERACTIVITY_KEY, newValue: 'true' }));
    });
    expect(screen.getAllByRole('textbox')).toHaveLength(2);

    act(() => {
      window.localStorage.setItem(INTERACTIVITY_KEY, 'false');
      window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-key', newValue: 'x' }));
    });
    expect(screen.getAllByRole('textbox')).toHaveLength(2);

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });
});

// ── Descriptor polling ───────────────────────────────────────

describe('BrowserPanel — descriptor polling cadence (BrowserPanel.tsx:412-444)', () => {
  it('ready + active: every 4 s', async () => {
    renderPanel();
    await flush();
    expect(fetchStub.count('descriptor')).toBe(1);
    await advance(3999);
    expect(fetchStub.count('descriptor')).toBe(1);
    await advance(1);
    expect(fetchStub.count('descriptor')).toBe(2);
    await advance(4000);
    expect(fetchStub.count('descriptor')).toBe(3);
  });

  it.each([
    ['starting', { status: 'starting', mode: 'screencast', ready: false }],
    ['stopping', { status: 'stopping', mode: 'screencast', ready: false }],
    ['active but not ready', { status: 'active', mode: 'screencast', ready: false }],
  ] as const)('%s: every 400 ms', async (_label, d) => {
    fetchStub.setDescriptor(d);
    renderPanel();
    await flush();
    expect(fetchStub.count('descriptor')).toBe(1);
    await advance(399);
    expect(fetchStub.count('descriptor')).toBe(1);
    await advance(1);
    expect(fetchStub.count('descriptor')).toBe(2);
    await advance(400);
    expect(fetchStub.count('descriptor')).toBe(3);
  });

  it('off (not transient): every 4 s', async () => {
    fetchStub.setDescriptor(OFF);
    renderPanel();
    await flush();
    await advance(3999);
    expect(fetchStub.count('descriptor')).toBe(1);
    await advance(1);
    expect(fetchStub.count('descriptor')).toBe(2);
  });

  it('after a transient error: every 2 s, back to 4 s once it answers', async () => {
    fetchStub.setDescriptorStatus(503);
    renderPanel();
    await flush();
    expect(fetchStub.count('descriptor')).toBe(1);
    await advance(1999);
    expect(fetchStub.count('descriptor')).toBe(1);
    fetchStub.setDescriptorStatus(null);
    await advance(1);
    expect(fetchStub.count('descriptor')).toBe(2);
    await advance(3999);
    expect(fetchStub.count('descriptor')).toBe(2);
    await advance(1);
    expect(fetchStub.count('descriptor')).toBe(3);
  });

  it.each([401, 403])('%i: polling stops for good (only reopening the panel asks again)', async (status) => {
    fetchStub.setDescriptorStatus(status);
    const view = renderPanel();
    await flush();
    expect(fetchStub.count('descriptor')).toBe(1);
    await advance(60_000);
    expect(fetchStub.count('descriptor')).toBe(1);

    // The effect re-runs on open / workspaceId / nowKey — the only times the answer could differ.
    view.update({ open: false });
    await flush();
    view.update({ open: true });
    await flush();
    expect(fetchStub.count('descriptor')).toBe(2);
    await advance(60_000);
    expect(fetchStub.count('descriptor')).toBe(2);

    view.update({ workspaceId: 'ws-2' });
    await flush();
    expect(fetchStub.to('descriptor').map((c) => c.workspaceId)).toEqual(['ws-1', 'ws-1', 'ws-2']);
  });

  it('no workspace: no polling at all', async () => {
    renderPanel({ workspaceId: undefined });
    await advance(10_000);
    expect(fetchStub.count('descriptor')).toBe(0);
  });
});

// ── Desktop auto-start ───────────────────────────────────────

describe('BrowserPanel — desktop auto-start (BrowserPanel.tsx:588-600)', () => {
  it('starts once per workspace, with no URL, after creating the active native view', async () => {
    const b = installNative();
    fetchStub.setDescriptor({ ...OFF, mode: 'native' });
    const view = renderPanel();
    await flush();
    await flush();
    expect(fetchStub.count('start')).toBe(1);
    expect(fetchStub.to('start')[0]).toMatchObject({ workspaceId: 'ws-1', method: 'POST', body: { config: { enabled: true } } });
    expect(b.api.create).toHaveBeenCalledWith('tab-1', 'ws-1', true);

    // The server keeps reporting "off": no second start for the same workspace.
    await advance(12_000);
    expect(fetchStub.count('start')).toBe(1);

    // A different workspace gets its own auto-start.
    view.update({ workspaceId: 'ws-2' });
    await flush();
    await flush();
    expect(fetchStub.to('start').map((c) => c.workspaceId)).toEqual(['ws-1', 'ws-2']);
  });

  it('closing the panel resets the guard: reopening auto-starts again', async () => {
    installNative();
    fetchStub.setDescriptor({ ...OFF, mode: 'native' });
    const view = renderPanel();
    await flush();
    await flush();
    expect(fetchStub.count('start')).toBe(1);
    view.update({ open: false });
    await flush();
    view.update({ open: true });
    await flush();
    await flush();
    expect(fetchStub.count('start')).toBe(2);
  });

  it.each([
    ['ready', NATIVE_READY],
    ['starting', { status: 'starting', mode: 'native', ready: false }],
  ] as const)('does not auto-start a session that is already %s when the descriptor answers first', async (_label, d) => {
    const b = installNative();
    // Let the descriptor land before the native probe answers.
    b.api.available.mockImplementation(() => new Promise((resolve) => { setTimeout(() => resolve(true), 50); }));
    fetchStub.setDescriptor(d);
    renderPanel();
    await advance(2000);
    expect(fetchStub.count('start')).toBe(0);
  });

  it('starts even a running session when the native probe answers before the first descriptor', async () => {
    // Characterization of the mount race (BrowserPanel.tsx:588-600): the guard only sees a
    // descriptor that has already arrived; with none yet (`descriptor === null`) it starts.
    installNative();
    // The first descriptor body arrives 50 ms after the probe has answered.
    fetchStub.route('descriptor', () => ({
      ...jsonResponse(NATIVE_READY),
      json: () => new Promise((resolve) => { setTimeout(() => resolve(NATIVE_READY), 50); }),
    }));
    renderPanel();
    await flush();
    await flush();
    expect(fetchStub.count('start')).toBe(1);
  });

  it('never auto-starts on the web, even with full interactivity', async () => {
    enableWebInteractivity();
    fetchStub.setDescriptor(OFF);
    renderPanel();
    await advance(12_000);
    expect(fetchStub.count('start')).toBe(0);
  });
});

// ── SSE ──────────────────────────────────────────────────────

describe('BrowserPanel — browser event stream (BrowserPanel.tsx:464-507)', () => {
  it("subscribes to the session scope browser:<workspaceId> with the 'browser.' filter and closes it on unmount", async () => {
    const view = renderPanel();
    await flush();
    expect(openMultiplexedStream).toHaveBeenCalledTimes(1);
    expect(openMultiplexedStream).toHaveBeenCalledWith(
      'session',
      'browser:ws-1',
      expect.objectContaining({ onMessage: expect.any(Function) }),
      ['browser.'],
    );
    const handle = vi.mocked(openMultiplexedStream).mock.results[0]?.value as { close: ReturnType<typeof vi.fn> };
    view.unmount();
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    'browser.session_created',
    'browser.session_stopped',
    'browser.session_updated',
    'browser.navigation',
    'browser.error',
  ])('%s refetches the descriptor at once', async (kind) => {
    renderPanel();
    await flush();
    const before = fetchStub.count('descriptor');
    sseEmit({ kind, payload: {} });
    await flush();
    expect(fetchStub.count('descriptor')).toBe(before + 1);
  });

  it('other browser.* kinds do not refetch', async () => {
    renderPanel();
    await flush();
    const before = fetchStub.count('descriptor');
    sseEmit({ kind: 'browser.console', payload: {} });
    sseEmit({ kind: 'browser.selection', payload: {} });
    await flush();
    expect(fetchStub.count('descriptor')).toBe(before);
  });

  it('browser.selection ({kind, data} shape) → onCapture gets element-<ts>.json and Inspect turns off without a REST call', async () => {
    const onCapture = vi.fn();
    renderPanel({ onCapture });
    await flush();
    fireEvent.click(inspectButton());
    await flush();
    expect(fetchStub.to('actions').map((c) => c.body)).toEqual([{ kind: 'inspector', on: true }]);
    expect(inspectButton()).toHaveAttribute('aria-pressed', 'true');

    sseEmit({
      kind: 'browser.selection',
      data: { workspaceId: 'ws-1', artifactId: 'art-9', url: 'https://example.com/', cssSelector: '#hero', xpath: '/html/body/div' },
    });
    expect(onCapture).toHaveBeenCalledTimes(1);
    const [file, kind] = onCapture.mock.calls[0] as [File, string];
    expect(kind).toBe('selection');
    expect(file.name).toMatch(/^element-\d+\.json$/);
    expect(file.type).toBe('application/json');
    expect(JSON.parse(await file.text())).toEqual({
      url: 'https://example.com/', cssSelector: '#hero', xpath: '/html/body/div', artifactId: 'art-9',
    });
    expect(inspectButton()).toHaveAttribute('aria-pressed', 'false');
    // The server already disabled its inspector; the panel does not post `on:false`.
    expect(fetchStub.to('actions')).toHaveLength(1);
  });

  it('browser.selection without an onCapture handler leaves Inspect on', async () => {
    renderPanel();
    await flush();
    fireEvent.click(inspectButton());
    await flush();
    sseEmit({ kind: 'browser.selection', data: { artifactId: 'art-1' } });
    expect(inspectButton()).toHaveAttribute('aria-pressed', 'true');
  });

  // Was P4 defect #4 (fixed in P4-03): the real mux stream delivers `{kind, payload}` (platform/muxStream.ts:524, and
  // ComputerPanel.tsx:645 reads `payload`), but BrowserPanel reads `payload.data?.artifactId`
  // (BrowserPanel.tsx:472-487), so an inspector pick arriving through the mux never attaches.
  it('browser.selection in the mux wire shape ({kind, payload}) attaches the element', async () => {
    const onCapture = vi.fn();
    renderPanel({ onCapture });
    await flush();
    sseEmit({ kind: 'browser.selection', payload: { artifactId: 'art-9', url: 'https://example.com/', cssSelector: '#a', xpath: '/a' } });
    expect(onCapture).toHaveBeenCalledTimes(1);
  });
});
