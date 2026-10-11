// ────────────────────────────────────────────────────────────────
// BrowserPanel characterization — desktop native browser (P4-01).
//
// Pins the CURRENT desktop-only behaviour of components/chat/BrowserPanel.tsx (now blocks/browser/BrowserPanel.tsx)
// (window.generatoraiDesktop.browser.available() === true) before the P4 split
// (03-component-inventory-domain.md §6.2, 09-verification.md §5.2 "Native only"
// and "URL bar"):
//   • back / forward / reload / navigate go to native IPC, never REST;
//   • a fresh native tab shows a blank address and does not inherit the
//     workspace-level descriptor URL; internal URLs never reach the URL bar or
//     the tab label; the per-tab URL memory (urlScopeKey) restores once;
//   • annotate (Inspect) start / stop / poll every 400 ms, the Comments popover
//     ("Send all to chat" only with ≥ 1 commented annotation), native region
//     capture, closing the panel exits annotate mode;
//   • device emulation presets, rotate and zoom levels [0.5 … 2];
//   • the share toggle is disabled while agentBusy.
//
// NativeBrowserView renders for real (its own suite is
// NativeBrowserView.characterization.test.tsx); only the IPC bridge is stubbed.
// Mocks only the data layer: `@/platform/muxStream`, `@/platform/authTransport`,
// `fetch`, `WebSocket` and `window.generatoraiDesktop.browser`.
// These assertions must stay unchanged through the P4 split — only the marked
// import line may change.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '@/providers/ThemeProvider.js';

import {
  advance,
  FakeWebSocket,
  flush,
  installBrowserFetch,
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

const NATIVE_READY: BrowserDescriptorFixture = {
  status: 'active',
  mode: 'native',
  ready: true,
  // The workspace-level session "follows the active tab" — NOT this tab's own URL.
  currentUrl: 'https://other-tab.example/',
  config: { visibility: 'visible', enabled: true },
};

type PanelProps = React.ComponentProps<typeof BrowserPanel>;

function panel(props: Partial<PanelProps> = {}): React.JSX.Element {
  return <BrowserPanel workspaceId="ws-1" tabId="tab-1" open visible onClose={() => {}} {...props} />;
}

async function mount(props: Partial<PanelProps> = {}) {
  const view = render(panel(props), { wrapper: ThemeProvider });
  await flush();
  await flush();
  return { ...view, update: (next: Partial<PanelProps>) => view.rerender(panel({ ...props, ...next })) };
}

const urlBox = (): HTMLInputElement => screen.getByRole('textbox') as HTMLInputElement;
const annotateButton = (): HTMLElement => screen.getByTestId('browser-annotate');

function annotation(key: string, n: number, comment: string) {
  return { key, n, label: `div.item-${n}`, tag: 'div', comment, region: false, text: '' };
}

function polled(items: ReturnType<typeof annotation>[], flags: Partial<{ exit: boolean; sendAll: boolean }> = {}) {
  return { items, exit: false, sendAll: false, ...flags };
}

function pick(overrides: Partial<{ id: string | null; screenshot: string | null; comment: string }> = {}) {
  return {
    key: 'k1',
    n: 1,
    url: 'https://example.com/',
    tag: 'button',
    id: 'buy',
    classes: ['btn', 'primary'],
    label: 'button#buy.btn.primary',
    text: 'Buy now',
    cssSelector: '#buy',
    xpath: '/html/body/button',
    outerHtml: '<button id="buy">Buy now</button>',
    boundingBox: { x: 1, y: 2, width: 30, height: 10 },
    screenshot: null,
    comment: 'make it blue',
    ...overrides,
  };
}

let fetchStub: BrowserFetchStub;
let bridge: BrowserBridge;

beforeEach(() => {
  useManualClock();
  vi.clearAllMocks();
  window.localStorage.clear();
  FakeWebSocket.instances.length = 0;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  fetchStub = installBrowserFetch(NATIVE_READY);
  bridge = makeBrowserBridge({ created: { currentUrl: 'about:blank#gai-ws-1', title: 'about:blank#gai-ws-1' } });
  bridge.install();
});

afterEach(() => {
  cleanup();
  bridge.uninstall();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── Navigation over IPC ──────────────────────────────────────

describe('BrowserPanel native — navigation goes over IPC', () => {
  it.each(['back', 'forward', 'reload'] as const)('%s calls the bridge for this tab, not REST, then refetches the descriptor', async (kind) => {
    await mount();
    const before = fetchStub.count('descriptor');
    fireEvent.click(screen.getByRole('button', { name: kind[0]!.toUpperCase() + kind.slice(1) }));
    await flush();
    expect(bridge.api[kind]).toHaveBeenCalledWith('tab-1');
    expect(fetchStub.count('actions')).toBe(0);
    expect(fetchStub.count('descriptor')).toBe(before + 1);
  });

  it('the address bar navigates this tab over IPC with https:// added, and shows the new address', async () => {
    await mount();
    fireEvent.change(urlBox(), { target: { value: 'example.com' } });
    const form = urlBox().closest('form');
    if (!form) throw new Error('URL bar is not inside a form');
    fireEvent.submit(form);
    await flush();
    expect(bridge.api.navigate).toHaveBeenCalledWith('tab-1', 'https://example.com');
    expect(fetchStub.count('actions')).toBe(0);
    expect(urlBox()).toHaveValue('https://example.com');
  });

  it('falls back to the workspace id as the tab id when no tabId is given', async () => {
    await mount({ tabId: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await flush();
    expect(bridge.api.reload).toHaveBeenCalledWith('ws-1');
    expect(bridge.api.create).toHaveBeenCalledWith('ws-1', 'ws-1', false);
  });
});

// ── URL bar + tab state ──────────────────────────────────────

describe('BrowserPanel native — URL bar and tab label', () => {
  it('a fresh native tab shows a blank address and does not inherit the workspace URL', async () => {
    await mount();
    expect(bridge.api.create).toHaveBeenCalledWith('tab-1', 'ws-1', false);
    expect(urlBox()).toHaveValue('');
    expect(screen.queryByDisplayValue('https://other-tab.example/')).toBeNull();
  });

  it('internal URLs never reach the tab label; real navigation does, and only for this tab', async () => {
    const onTabStateChange = vi.fn();
    await mount({ onTabStateChange });
    expect(onTabStateChange).toHaveBeenLastCalledWith({ loading: false, title: null, favicon: null, url: null });

    bridge.emit('navigate', { tabId: 'tab-2', url: 'https://sibling.example/' });
    bridge.emit('title', { tabId: 'tab-2', title: 'Sibling' });
    await flush();
    expect(onTabStateChange).toHaveBeenLastCalledWith({ loading: false, title: null, favicon: null, url: null });

    bridge.emit('loading', { tabId: 'tab-1', loading: true });
    await flush();
    expect(onTabStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ loading: true }));
    bridge.emit('navigate', { tabId: 'tab-1', url: 'https://example.com/' });
    bridge.emit('title', { tabId: 'tab-1', title: 'Example Domain' });
    bridge.emit('favicon', { tabId: 'tab-1', favicon: 'data:image/png;base64,FAV' });
    bridge.emit('loading', { tabId: 'tab-1', loading: false });
    await flush();
    expect(onTabStateChange).toHaveBeenLastCalledWith({
      loading: false, title: 'Example Domain', favicon: 'data:image/png;base64,FAV', url: 'https://example.com/',
    });
    expect(urlBox()).toHaveValue('https://example.com/');

    // Back on the internal marker: title and favicon are withheld, the bar empties.
    bridge.emit('navigate', { tabId: 'tab-1', url: 'about:blank#gai-ws-1' });
    await flush();
    expect(onTabStateChange).toHaveBeenLastCalledWith({ loading: false, title: null, favicon: null, url: null });
    expect(urlBox()).toHaveValue('');
  });

  it('closing the panel resets the tab state', async () => {
    const onTabStateChange = vi.fn();
    const view = await mount({ onTabStateChange });
    bridge.emit('navigate', { tabId: 'tab-1', url: 'https://example.com/' });
    bridge.emit('title', { tabId: 'tab-1', title: 'Example Domain' });
    bridge.emit('loading', { tabId: 'tab-1', loading: true });
    await flush();
    view.update({ open: false });
    await flush();
    expect(onTabStateChange).toHaveBeenLastCalledWith({ loading: false, title: null, favicon: null, url: 'https://example.com/' });
  });

  it('with urlScopeKey: remembers the last real page per tab and restores it once on the next mount', async () => {
    const view = await mount({ urlScopeKey: 'chat:c1' });
    bridge.emit('navigate', { tabId: 'tab-1', url: 'https://remember.example/' });
    await flush();
    expect(JSON.parse(window.localStorage.getItem('generatorai:browserTabUrls:chat:c1') ?? '{}')).toEqual({
      'tab-1': 'https://remember.example/',
    });
    view.unmount();

    bridge.api.navigate.mockClear();
    await mount({ urlScopeKey: 'chat:c1' });
    // Pre-filled from memory, restored by the native view (which still reports the marker).
    expect(urlBox()).toHaveValue('https://remember.example/');
    expect(bridge.api.navigate).toHaveBeenCalledWith('tab-1', 'https://remember.example/');
  });
});

// ── Annotate (D-140) ─────────────────────────────────────────

describe('BrowserPanel native — Annotate, the comment tray and screenshots', () => {
  type SendResult = 'sent' | 'attached';
  const sendTo = { onCapture: vi.fn(), onSend: vi.fn(async (): Promise<SendResult> => 'sent') };
  beforeEach(() => {
    sendTo.onCapture = vi.fn();
    sendTo.onSend = vi.fn(async (): Promise<SendResult> => 'sent');
  });

  it('Annotate starts the in-page overlay (palette passed), polls every 400 ms, shows the hint, and stops on the second click', async () => {
    await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    expect(bridge.api.annotateStart).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({ accent: expect.stringMatching(/^#[0-9a-f]{6}$/i) }),
    );
    expect(fetchStub.count('actions')).toBe(0); // no server inspector in native mode
    expect(annotateButton()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Click an element or drag across an area to comment.')).toBeInTheDocument();

    expect(bridge.api.annotatePoll).toHaveBeenCalledTimes(1);
    await advance(400);
    expect(bridge.api.annotatePoll).toHaveBeenCalledTimes(2);

    fireEvent.click(annotateButton());
    await flush();
    expect(bridge.api.annotateStop).toHaveBeenCalledWith('tab-1');
    expect(annotateButton()).toHaveAttribute('aria-pressed', 'false');
    // No comments and the mode off: nothing left to track, and the tray is gone.
    expect(screen.queryByTestId('browser-comment-tray')).toBeNull();
    const polls = bridge.api.annotatePoll.mock.calls.length;
    await advance(2000);
    expect(bridge.api.annotatePoll).toHaveBeenCalledTimes(polls);
  });

  it('the tray lists saved comments; the count rides on the Annotate button', async () => {
    bridge.api.annotatePoll.mockResolvedValue(polled([annotation('a', 1, 'Make it bigger'), annotation('b', 2, 'Fix the spacing')]));
    await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    const tray = screen.getByTestId('browser-comment-tray');
    expect(within(tray).getByText('Make it bigger')).toBeInTheDocument();
    expect(within(tray).getByText('Fix the spacing')).toBeInTheDocument();
    expect(within(annotateButton()).getByText('2')).toBeInTheDocument();
  });

  it('"Send to agent" sends one Markdown file + a PNG per comment as a message, says so, and leaves the mode', async () => {
    bridge.api.annotatePoll.mockResolvedValue(polled([annotation('k1', 1, 'make it blue')]));
    bridge.api.annotateSend.mockResolvedValueOnce([pick({ screenshot: 'data:image/png;base64,iVBORw0KGgo=' })]);
    await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    fireEvent.click(screen.getByTestId('browser-comments-send'));
    await flush();
    expect(bridge.api.annotateSend).toHaveBeenCalledWith('tab-1', undefined);
    expect(sendTo.onSend).toHaveBeenCalledTimes(1);
    const files = (sendTo.onSend.mock.calls[0] as unknown as [File[]])[0];
    expect(files.map((f) => f.name)).toEqual([
      expect.stringMatching(/^browser-comments-\d{8}-\d{6}\.md$/),
      expect.stringMatching(/^browser-comments-\d{8}-\d{6}-1\.png$/),
    ]);
    expect(await files[0]!.text()).toContain('## 1. make it blue');
    expect(sendTo.onCapture).not.toHaveBeenCalled();
    expect(screen.getByTestId('browser-comment-notice')).toHaveTextContent('Sent 1 comment to the agent');
    expect(bridge.api.annotateStop).toHaveBeenCalledWith('tab-1');
  });

  it('"Add to message" puts the files in the composer instead', async () => {
    bridge.api.annotatePoll.mockResolvedValue(polled([annotation('k1', 1, 'make it blue')]));
    bridge.api.annotateSend.mockResolvedValueOnce([pick({ screenshot: 'data:image/png;base64,iVBORw0KGgo=' })]);
    await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    fireEvent.click(screen.getByTestId('browser-comments-add'));
    await flush();
    expect(sendTo.onSend).not.toHaveBeenCalled();
    expect(sendTo.onCapture.mock.calls.map(([f, kind]) => [(f as File).type, kind])).toEqual([
      ['text/markdown', 'selection'],
      ['image/png', 'screenshot'],
    ]);
    expect(screen.getByTestId('browser-comment-notice')).toHaveTextContent('Added 1 comment to your message');
  });

  it('a busy chat keeps the comments for the next message, and the tray says so', async () => {
    sendTo.onSend = vi.fn(async (): Promise<SendResult> => 'attached');
    bridge.api.annotatePoll.mockResolvedValue(polled([annotation('k1', 1, 'make it blue')]));
    bridge.api.annotateSend.mockResolvedValueOnce([pick()]);
    await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    fireEvent.click(screen.getByTestId('browser-comments-send'));
    await flush();
    expect(screen.getByTestId('browser-comment-notice')).toHaveTextContent('The agent is busy — 1 comment added to your next message');
  });

  it('acts on the page: ⌘↵ in a card sends everything; Esc with no card leaves the mode', async () => {
    bridge.api.annotatePoll.mockResolvedValueOnce(polled([annotation('k1', 1, 'note')], { sendAll: true }));
    bridge.api.annotateSend.mockResolvedValueOnce([pick()]);
    await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    await flush();
    expect(bridge.api.annotateSend).toHaveBeenCalledWith('tab-1', undefined);
    expect(sendTo.onSend).toHaveBeenCalledTimes(1);

    bridge.api.annotatePoll.mockResolvedValue(polled([], { exit: true }));
    fireEvent.click(annotateButton());
    await flush();
    await advance(400);
    expect(annotateButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('a row opens its comment in the page; delete and Clear go to the page too', async () => {
    bridge.api.annotatePoll.mockResolvedValue(polled([annotation('k1', 1, 'note')]));
    await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    fireEvent.click(screen.getByTestId('browser-comment-row'));
    await flush();
    expect(bridge.api.annotateOpen).toHaveBeenCalledWith('tab-1', 'k1');
    fireEvent.click(screen.getByRole('button', { name: 'Delete comment 1' }));
    await flush();
    expect(bridge.api.annotateRemove).toHaveBeenCalledWith('tab-1', 'k1');
    fireEvent.click(within(screen.getByTestId('browser-comment-tray')).getByRole('button', { name: 'Clear' }));
    await flush();
    expect(bridge.api.annotateClear).toHaveBeenCalledWith('tab-1');
  });

  it('Screenshot adds the visible area, the full page (or says it fell back), or a dragged area to the message', async () => {
    await mount(sendTo);
    const choose = async (name: string) => {
      fireEvent.click(screen.getByTestId('browser-screenshot'));
      await flush();
      fireEvent.click(screen.getByRole('menuitem', { name }));
      await flush();
    };
    bridge.api.capture.mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', mode: 'visible' });
    await choose('Visible area');
    expect(bridge.api.capture).toHaveBeenLastCalledWith('tab-1', 'visible');
    expect((sendTo.onCapture.mock.calls[0]![0] as File).name).toMatch(/^screenshot-visible-\d{8}-\d{6}\.png$/);

    bridge.api.capture.mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', mode: 'visible' });
    await choose('Full page');
    expect(bridge.api.capture).toHaveBeenLastCalledWith('tab-1', 'full');
    expect(screen.getByTestId('browser-comment-notice')).toHaveTextContent('Full page was unavailable — added the visible area instead');

    bridge.api.captureRegion.mockResolvedValueOnce('data:image/png;base64,iVBORw0KGgo=');
    await choose('Select an area…');
    expect(bridge.api.captureRegion).toHaveBeenCalledWith('tab-1', expect.objectContaining({ accent: expect.any(String) }));
    expect((sendTo.onCapture.mock.calls[2]![0] as File).name).toMatch(/^screenshot-area-/);
    expect(fetchStub.count('capture')).toBe(0);
  });

  it('without a chat to send to there is no Annotate or Screenshot', async () => {
    await mount();
    expect(screen.queryByTestId('browser-annotate')).toBeNull();
    expect(screen.queryByTestId('browser-screenshot')).toBeNull();
  });

  it('closing the panel leaves Annotate mode', async () => {
    const view = await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    view.update({ open: false });
    await flush();
    expect(bridge.api.annotateStop).toHaveBeenCalledWith('tab-1');
    view.update({ open: true });
    await flush();
    await flush();
    expect(annotateButton()).toHaveAttribute('aria-pressed', 'false');
  });
});

// ── Device emulation ─────────────────────────────────────────

describe('BrowserPanel native — device emulation (BrowserPanel.tsx:851-898, 1857-1948)', () => {
  const toolbarToggle = (): HTMLElement => screen.getByRole('button', { name: /^Toggle device toolbar/ });
  // P4-10: the native <select>s became kit Menus (menu-button triggers named as
  // the old selects, radio items as the options); "pick" = open + click the item.
  const openMenu = async (name: string): Promise<HTMLElement> => {
    fireEvent.click(screen.getByRole('button', { name }));
    await flush();
    return screen.getByRole('menu');
  };
  const itemTexts = (menu: HTMLElement): (string | null)[] =>
    within(menu).getAllByRole('menuitemradio').map((o) => o.textContent);
  // Base UI unmounts a closed menu on the next animation frame (real time, not
  // the manual clock) and guards the trigger for a moment after closing.
  const settle = async (): Promise<void> => {
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await advance(500);
  };
  const closeMenu = async (): Promise<void> => {
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await settle();
  };
  const pick = async (menuName: string, item: string): Promise<void> => {
    const menu = await openMenu(menuName);
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: item }));
    await settle();
  };

  it('the toggle turns the device bar on (responsive = no emulation, zoom 1) and off again', async () => {
    await mount();
    fireEvent.click(toolbarToggle());
    expect(toolbarToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(bridge.api.setEmulation).toHaveBeenLastCalledWith('tab-1', null);
    expect(bridge.api.setZoom).toHaveBeenLastCalledWith('tab-1', 1);
    expect(screen.getByRole('spinbutton', { name: 'Width (px)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rotate viewport' })).toBeDisabled();

    fireEvent.click(toolbarToggle());
    expect(bridge.api.setEmulation).toHaveBeenLastCalledWith('tab-1', null);
    expect(bridge.api.setZoom).toHaveBeenLastCalledWith('tab-1', 1);
    expect(screen.queryByRole('button', { name: 'Device preset' })).toBeNull();
  });

  it('offers the nine presets and the zoom levels 50 % … 200 %', async () => {
    await mount();
    fireEvent.click(toolbarToggle());
    expect(itemTexts(await openMenu('Device preset'))).toEqual([
      'Responsive',
      'Mobile S — 360×640',
      'iPhone 12/13 — 390×844',
      'Mobile L — 414×896',
      'Pixel 7 — 412×915',
      'Tablet — 768×1024',
      'iPad Pro — 1024×1366',
      'Laptop — 1366×768',
      'Desktop — 1920×1080',
    ]);
    await closeMenu();

    const zoomTexts = ['50%', '67%', '75%', '90%', '100%', '110%', '125%', '150%', '200%'];
    const zoomValues = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];
    expect(itemTexts(await openMenu('Page zoom'))).toEqual(zoomTexts);
    await closeMenu();
    // Each zoom item applies its level.
    for (const [i, text] of zoomTexts.entries()) {
      await pick('Page zoom', text);
      expect(bridge.api.setZoom).toHaveBeenLastCalledWith('tab-1', zoomValues[i]);
    }

    // DPR is disabled under Responsive; pick a device to enable it.
    await pick('Device preset', 'Laptop — 1366×768');
    expect(itemTexts(await openMenu('Device pixel ratio'))).toEqual(['1×', '1.5×', '2×', '3×']);
    await closeMenu();
    for (const dpr of [1.5, 2, 3, 1]) {
      await pick('Device pixel ratio', `${dpr}×`);
      expect(bridge.api.setEmulation).toHaveBeenLastCalledWith('tab-1', { width: 1366, height: 768, deviceScaleFactor: dpr, mobile: false });
    }
    // ~20 menu round trips, each waiting a real animation frame: slow under a
    // loaded parallel run, so it gets more than the default 5 s.
  }, 20_000);

  it('a preset emulates its size + mobile flag; rotate swaps; zoom and DPR re-apply', async () => {
    await mount();
    fireEvent.click(toolbarToggle());
    await pick('Device preset', 'iPhone 12/13 — 390×844');
    expect(bridge.api.setEmulation).toHaveBeenLastCalledWith('tab-1', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    expect(bridge.api.setZoom).toHaveBeenLastCalledWith('tab-1', 1);
    expect(screen.getByRole('spinbutton', { name: 'Width (px)' })).toHaveValue(390);

    fireEvent.click(screen.getByRole('button', { name: 'Rotate viewport' }));
    expect(bridge.api.setEmulation).toHaveBeenLastCalledWith('tab-1', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });

    await pick('Page zoom', '150%');
    expect(bridge.api.setZoom).toHaveBeenLastCalledWith('tab-1', 1.5);

    await pick('Device pixel ratio', '2×');
    expect(bridge.api.setEmulation).toHaveBeenLastCalledWith('tab-1', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  });

  it('editing a dimension switches to a "Custom" preset (minimum 100 px)', async () => {
    await mount();
    fireEvent.click(toolbarToggle());
    await pick('Device preset', 'Laptop — 1366×768');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Width (px)' }), { target: { value: '40' } });
    expect(bridge.api.setEmulation).toHaveBeenLastCalledWith('tab-1', { width: 100, height: 768, deviceScaleFactor: 1, mobile: false });
    expect(screen.getByRole('button', { name: 'Device preset' })).toHaveTextContent('Custom');
    expect(within(await openMenu('Device preset')).getByRole('menuitemradio', { name: 'Custom' })).toHaveAttribute('aria-checked', 'true');
  });

  it('turning the device bar off after emulating resets to no emulation and zoom 1', async () => {
    await mount();
    fireEvent.click(toolbarToggle());
    await pick('Device preset', 'Tablet — 768×1024');
    await pick('Page zoom', '200%');
    fireEvent.click(toolbarToggle());
    expect(bridge.api.setEmulation).toHaveBeenLastCalledWith('tab-1', null);
    expect(bridge.api.setZoom).toHaveBeenLastCalledWith('tab-1', 1);
  });
});

// ── Share while busy ─────────────────────────────────────────

describe('BrowserPanel native — share toggle', () => {
  it('is disabled while agentBusy', async () => {
    await mount({ agentBusy: true });
    expect(screen.getByRole('button', { name: 'Cannot detach while agent is streaming' })).toBeDisabled();
  });
});
