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
const inspectButton = (): HTMLElement => screen.getByRole('button', { name: /^Comment(ing)? — click elements/ });

function annotation(key: string, n: number, comment: string) {
  return { key, n, label: `div.item-${n}`, tag: 'div', comment, region: false };
}

function pick(overrides: Partial<{ id: string | null; screenshot: string | null; comment: string }> = {}) {
  return {
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

// ── Annotate (Inspect) ───────────────────────────────────────

describe('BrowserPanel native — annotate mode (BrowserPanel.tsx:728-824)', () => {
  it('Inspect starts annotate in the page (palette passed), polls every 400 ms, and stops on the second click', async () => {
    await mount();
    fireEvent.click(inspectButton());
    await flush();
    // P4-06 (06 §4.4): the injected overlay takes a token-derived palette instead of 'light' | 'dark'.
    expect(bridge.api.annotateStart).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({ accent: expect.stringMatching(/^#[0-9a-f]{6}$/i) }),
    );
    expect(fetchStub.count('actions')).toBe(0); // no server inspector in native mode
    expect(inspectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(inspectButton()).toHaveAttribute('title', 'Commenting — click elements to leave notes; click to exit');
    expect(screen.getByText('Click an element or drag a region to leave a comment')).toBeInTheDocument();

    expect(bridge.api.annotatePoll).toHaveBeenCalledTimes(1);
    await advance(399);
    expect(bridge.api.annotatePoll).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(bridge.api.annotatePoll).toHaveBeenCalledTimes(2);
    await advance(400);
    expect(bridge.api.annotatePoll).toHaveBeenCalledTimes(3);

    fireEvent.click(inspectButton());
    await flush();
    expect(bridge.api.annotateStop).toHaveBeenCalledWith('tab-1');
    expect(inspectButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: /^Comments \(/ })).toBeNull();
    const polls = bridge.api.annotatePoll.mock.calls.length;
    await advance(2000);
    expect(bridge.api.annotatePoll).toHaveBeenCalledTimes(polls);
  });

  it('the poll drives the Comments count and the status strip', async () => {
    bridge.api.annotatePoll.mockResolvedValue({ total: 2, items: [annotation('a', 1, ''), annotation('b', 2, 'fix')], sent: [] });
    await mount();
    fireEvent.click(inspectButton());
    await flush();
    expect(screen.getByRole('button', { name: 'Comments (2)' })).toBeInTheDocument();
    expect(screen.getByText('2 comments — open Comments to review & send')).toBeInTheDocument();
  });

  it('cards sent from inside the page are attached as element-*.md (+ .png when there is a screenshot)', async () => {
    const onCapture = vi.fn();
    bridge.api.annotatePoll.mockResolvedValueOnce({
      total: 0, items: [], sent: [pick({ screenshot: 'data:image/png;base64,iVBORw0KGgo=' })],
    });
    await mount({ onCapture });
    fireEvent.click(inspectButton());
    await flush();
    expect(onCapture).toHaveBeenCalledTimes(2);
    const [md, mdKind] = onCapture.mock.calls[0] as [File, string];
    const [png, pngKind] = onCapture.mock.calls[1] as [File, string];
    expect(mdKind).toBe('selection');
    expect(md.name).toMatch(/^element-buy-\d+-[a-z0-9]+\.md$/);
    expect(md.type).toBe('text/markdown');
    const text = await md.text();
    expect(text).toContain('# UI change request');
    expect(text).toContain('**Requested change:** make it blue');
    expect(text).toContain('- **CSS selector:** `#buy`');
    expect(pngKind).toBe('screenshot');
    expect(png.name).toMatch(/^element-buy-\d+-[a-z0-9]+\.png$/);
    expect(png.type).toBe('image/png');
  });

  it('"Send all to chat" appears only when at least one annotation has a comment, and drains all', async () => {
    const onCapture = vi.fn();
    bridge.api.annotatePoll.mockResolvedValue({ total: 1, items: [annotation('a', 1, '')], sent: [] });
    await mount({ onCapture });
    fireEvent.click(inspectButton());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Comments (1)' }));
    await flush();
    const menu = screen.getByRole('dialog');
    expect(within(menu).getByText('No comment yet')).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Send this comment to chat' })).toBeDisabled();
    expect(within(menu).queryByRole('button', { name: /Send all to chat/ })).toBeNull();

    bridge.api.annotatePoll.mockResolvedValue({ total: 1, items: [annotation('a', 1, 'make it blue')], sent: [] });
    await advance(400);
    bridge.api.annotateSend.mockResolvedValueOnce([pick()]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Send all to chat/ }));
    await flush();
    expect(bridge.api.annotateSend).toHaveBeenCalledWith('tab-1', undefined);
    expect(onCapture).toHaveBeenCalledWith(expect.any(File), 'selection');
  });

  it('per-item send drains just that key; delete removes it', async () => {
    bridge.api.annotatePoll.mockResolvedValue({ total: 1, items: [annotation('k1', 1, 'note')], sent: [] });
    await mount({ onCapture: vi.fn() });
    fireEvent.click(inspectButton());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Comments (1)' }));
    await flush();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send this comment to chat' }));
    await flush();
    expect(bridge.api.annotateSend).toHaveBeenCalledWith('tab-1', ['k1']);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete this comment' }));
    await flush();
    expect(bridge.api.annotateRemove).toHaveBeenCalledWith('tab-1', 'k1');
  });

  it('Capture in native mode is a region comment: starts annotate if needed, then annotateRegion — no /capture', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /^Comment on a region — drag/ }));
    await flush();
    expect(bridge.api.annotateStart).toHaveBeenCalledTimes(1);
    expect(bridge.api.annotateRegion).toHaveBeenCalledWith('tab-1');
    expect(inspectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(fetchStub.count('capture')).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /^Comment on a region — drag/ }));
    await flush();
    expect(bridge.api.annotateStart).toHaveBeenCalledTimes(1);
    expect(bridge.api.annotateRegion).toHaveBeenCalledTimes(2);
  });

  it('closing the panel exits annotate mode (annotateStop) and reopening starts clean', async () => {
    const view = await mount();
    fireEvent.click(inspectButton());
    await flush();
    view.update({ open: false });
    await flush();
    expect(bridge.api.annotateStop).toHaveBeenCalledWith('tab-1');
    const polls = bridge.api.annotatePoll.mock.calls.length;
    await advance(2000);
    expect(bridge.api.annotatePoll).toHaveBeenCalledTimes(polls);
    view.update({ open: true });
    await flush();
    await flush();
    expect(inspectButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Click an element or drag a region to leave a comment')).toBeNull();
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
