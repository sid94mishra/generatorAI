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
  return { key, n, label: `div.item-${n}`, tag: 'div', comment, intent: 'fix', region: false, text: '' };
}

function polled(
  items: ReturnType<typeof annotation>[],
  flags: Partial<{ exit: boolean; pending: ReturnType<typeof annotation> | null }> = {},
) {
  return { items, pending: null, exit: false, ...flags };
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

describe('BrowserPanel native — select element, the Comments panel and screenshots (D-145)', () => {
  type SendResult = 'sent' | 'attached';
  const sendTo = { onCapture: vi.fn(), onSend: vi.fn(async (): Promise<SendResult> => 'sent') };
  beforeEach(() => {
    sendTo.onCapture = vi.fn();
    sendTo.onSend = vi.fn(async (): Promise<SendResult> => 'sent');
  });
  const pendingOn = (key: string, label: string) => ({ ...annotation(key, 0, ''), label, text: 'Get startd' });

  it('↖ starts select mode in the page (palette passed), opens the Comments panel with the hint, and stops on the second click', async () => {
    await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    expect(bridge.api.annotateStart).toHaveBeenCalledWith('tab-1', expect.objectContaining({ accent: expect.stringMatching(/^#[0-9a-f]{6}$/i) }));
    expect(fetchStub.count('actions')).toBe(0);
    expect(annotateButton()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('browser-comments-panel')).toBeInTheDocument();
    expect(screen.getByText(/Hover the page and click an element/)).toBeInTheDocument();
    expect(bridge.api.annotatePoll).toHaveBeenCalledTimes(1);
    await advance(400);
    expect(bridge.api.annotatePoll).toHaveBeenCalledTimes(2);

    fireEvent.click(annotateButton());
    await flush();
    expect(bridge.api.annotateStop).toHaveBeenCalledWith('tab-1');
    expect(annotateButton()).toHaveAttribute('aria-pressed', 'false');
    const polls = bridge.api.annotatePoll.mock.calls.length;
    await advance(2000);
    expect(bridge.api.annotatePoll).toHaveBeenCalledTimes(polls);
  });

  it('a selection opens the Changes review form; Add comment saves it with its intent', async () => {
    bridge.api.annotatePoll.mockResolvedValue(polled([], { pending: pendingOn('d1', 'a#start.cta') }));
    await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    const form = screen.getByTestId('browser-comment-composer');
    expect(within(form).getByText(/New comment · a#start\.cta/)).toBeInTheDocument();
    for (const intent of ['Fix', 'Question', 'Refactor', 'Test', 'Note']) {
      expect(within(form).getByRole('button', { name: intent })).toBeInTheDocument();
    }
    fireEvent.click(within(form).getByRole('button', { name: 'Question' }));
    fireEvent.change(within(form).getByRole('textbox', { name: 'Comment on the page' }), { target: { value: 'Why is this grey?' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add comment' }));
    await flush();
    expect(bridge.api.annotateSave).toHaveBeenCalledWith('tab-1', 'd1', 'Why is this grey?', 'question');
    expect(sendTo.onSend).not.toHaveBeenCalled();
  });

  it('Add & send saves and sends just that comment; Cancel drops the selection', async () => {
    bridge.api.annotatePoll.mockResolvedValue(polled([], { pending: pendingOn('d1', 'a#start.cta') }));
    bridge.api.annotateSend.mockResolvedValueOnce([pick({ screenshot: 'data:image/png;base64,iVBORw0KGgo=' })]);
    await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    const form = screen.getByTestId('browser-comment-composer');
    fireEvent.change(within(form).getByRole('textbox', { name: 'Comment on the page' }), { target: { value: 'Make it blue' } });
    fireEvent.click(within(form).getByRole('button', { name: /Add & send/ }));
    await flush();
    await flush();
    expect(bridge.api.annotateSend).toHaveBeenCalledWith('tab-1', ['d1']);
    expect(sendTo.onSend).toHaveBeenCalledTimes(1);
    const files = (sendTo.onSend.mock.calls[0] as unknown as [File[]])[0];
    expect(files.map((f) => f.name)).toEqual([
      expect.stringMatching(/^browser-comments-\d{8}-\d{6}\.md$/),
      expect.stringMatching(/^browser-comments-\d{8}-\d{6}-1\.png$/),
    ]);
    expect(screen.getByTestId('browser-comment-notice')).toHaveTextContent('Sent 1 comment to the agent');

    fireEvent.click(within(screen.getByTestId('browser-comment-composer')).getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(bridge.api.annotateCancel).toHaveBeenCalledWith('tab-1', 'd1');
  });

  it('the list: the count on the Comments button; Edit is the same form with Update comment', async () => {
    bridge.api.annotatePoll.mockResolvedValue(polled([{ ...annotation('k1', 1, 'Make it bigger'), intent: 'refactor' }, annotation('k2', 2, 'Fix the spacing')]));
    await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    expect(screen.getByTestId('browser-comments-toggle')).toHaveAccessibleName('Comments (2)');
    const rows = screen.getAllByTestId('browser-comment-row');
    expect(within(rows[0]!).getByText('Refactor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit comment 1' }));
    await flush();
    const edit = screen.getByRole('group', { name: 'Edit comment 1' });
    const box = within(edit).getByRole('textbox', { name: 'Edit comment 1' });
    expect(box).toHaveValue('Make it bigger');
    expect(within(edit).getByRole('button', { name: 'Refactor' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(box, { target: { value: 'Make it much bigger' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Update comment' }));
    await flush();
    expect(bridge.api.annotateSave).toHaveBeenCalledWith('tab-1', 'k1', 'Make it much bigger', 'refactor');
  });

  it('one comment or all: Attach puts files in the composer, Send sends a message; a row shows its element; delete', async () => {
    bridge.api.annotatePoll.mockResolvedValue(polled([annotation('k1', 1, 'one'), annotation('k2', 2, 'two')]));
    bridge.api.annotateSend.mockResolvedValue([pick({ screenshot: 'data:image/png;base64,iVBORw0KGgo=' })]);
    await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Attach comment 2 to the message' }));
    await flush();
    expect(bridge.api.annotateSend).toHaveBeenLastCalledWith('tab-1', ['k2']);
    expect(sendTo.onCapture.mock.calls.map(([f, kind]) => [(f as File).type, kind])).toEqual([
      ['text/markdown', 'selection'],
      ['image/png', 'screenshot'],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Send comment 1 to the agent' }));
    await flush();
    expect(bridge.api.annotateSend).toHaveBeenLastCalledWith('tab-1', ['k1']);
    expect(sendTo.onSend).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('browser-comments-send-all'));
    await flush();
    expect(bridge.api.annotateSend).toHaveBeenLastCalledWith('tab-1', undefined);
    fireEvent.click(screen.getByTestId('browser-comments-attach-all'));
    await flush();
    expect(bridge.api.annotateSend).toHaveBeenLastCalledWith('tab-1', undefined);

    fireEvent.click(screen.getAllByRole('button', { name: /Show on the page/ })[0]!);
    await flush();
    expect(bridge.api.annotateOpen).toHaveBeenCalledWith('tab-1', 'k1');
    fireEvent.click(screen.getByRole('button', { name: 'Delete comment 2' }));
    await flush();
    expect(bridge.api.annotateRemove).toHaveBeenCalledWith('tab-1', 'k2');
  });

  it('a busy chat keeps sent comments for the next message, and says so', async () => {
    sendTo.onSend = vi.fn(async (): Promise<SendResult> => 'attached');
    bridge.api.annotatePoll.mockResolvedValue(polled([annotation('k1', 1, 'note')]));
    bridge.api.annotateSend.mockResolvedValueOnce([pick()]);
    await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    fireEvent.click(screen.getByTestId('browser-comments-send-all'));
    await flush();
    expect(screen.getByTestId('browser-comment-notice')).toHaveTextContent('The agent is busy — 1 comment added to your next message');
  });

  it('Esc in the page with nothing selected leaves select mode', async () => {
    await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    bridge.api.annotatePoll.mockResolvedValue(polled([], { exit: true }));
    await advance(400);
    await flush();
    expect(annotateButton()).toHaveAttribute('aria-pressed', 'false');
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
  });

  it('the ⋯ menu is just Open DevTools', async () => {
    await mount(sendTo);
    fireEvent.click(screen.getByRole('button', { name: 'Browser options' }));
    await flush();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Open DevTools']);
  });

  it('without a chat to send to there is no select or Screenshot', async () => {
    await mount();
    expect(screen.queryByTestId('browser-annotate')).toBeNull();
    expect(screen.queryByTestId('browser-screenshot')).toBeNull();
  });

  it('closing the panel leaves select mode', async () => {
    const view = await mount(sendTo);
    fireEvent.click(annotateButton());
    await flush();
    view.update({ open: false });
    await flush();
    expect(bridge.api.annotateStop).toHaveBeenCalledWith('tab-1');
  });
});

describe('BrowserPanel native — device mode (D-144)', () => {
  const toolbarToggle = (): HTMLElement => screen.getByRole('button', { name: /^Toggle device toolbar/ });
  const openMenu = async (name: string): Promise<HTMLElement> => {
    fireEvent.click(screen.getByRole('button', { name }));
    await flush();
    return screen.getByRole('menu');
  };
  const settle = async (): Promise<void> => {
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await advance(500);
  };
  const pick = async (menuName: string, item: string): Promise<void> => {
    const menu = await openMenu(menuName);
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: item }));
    await settle();
  };
  // The panel's free space for the device frame (jsdom lays nothing out).
  let rect: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 500, bottom: 448, width: 500, height: 448, toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => rect.mockRestore());

  it('the first switch-on is a real phone, laid out at 390×844 @3× and scaled to fit the panel; off restores the tab', async () => {
    await mount();
    fireEvent.click(toolbarToggle());
    await flush();
    expect(toolbarToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('browser-device-frame')).toBeInTheDocument();
    const [tab, params] = bridge.api.setEmulation.mock.calls.at(-1)!;
    expect(tab).toBe('tab-1');
    expect(params).toMatchObject({ width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    expect(params!.scale).toBeCloseTo(424 / 844);
    expect(bridge.api.setZoom).toHaveBeenLastCalledWith('tab-1', 1);

    fireEvent.click(toolbarToggle());
    await flush();
    expect(bridge.api.setEmulation).toHaveBeenLastCalledWith('tab-1', null);
    expect(screen.queryByTestId('browser-device-frame')).toBeNull();
  });

  it('a preset sets its size and mobile flag; rotate swaps; a fixed zoom replaces Fit', async () => {
    await mount();
    fireEvent.click(toolbarToggle());
    await flush();
    await pick('Device preset', 'Laptop — 1366×768');
    expect(bridge.api.setEmulation.mock.calls.at(-1)![1]).toMatchObject({ width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    fireEvent.click(screen.getByRole('button', { name: 'Rotate viewport' }));
    await flush();
    expect(bridge.api.setEmulation.mock.calls.at(-1)![1]).toMatchObject({ width: 768, height: 1366 });
    await pick('Zoom', '50%');
    expect(bridge.api.setEmulation.mock.calls.at(-1)![1]).toMatchObject({ scale: 0.5 });
  });

  it('Responsive uses the width and height fields; editing a preset size makes it Custom', async () => {
    await mount();
    fireEvent.click(toolbarToggle());
    await flush();
    await pick('Device preset', 'Responsive');
    const width = screen.getByRole('spinbutton', { name: 'Width (px)' });
    expect(width).toBeEnabled();
    fireEvent.change(width, { target: { value: '600' } });
    await flush();
    expect(bridge.api.setEmulation.mock.calls.at(-1)![1]).toMatchObject({ width: 600, height: 844, mobile: false });
    await pick('Device preset', 'Pixel 7 — 412×915');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Height (px)' }), { target: { value: '50' } });
    await flush();
    expect(bridge.api.setEmulation.mock.calls.at(-1)![1]).toMatchObject({ width: 412, height: 100 });
    expect(screen.getByRole('button', { name: 'Device preset' })).toHaveTextContent('Custom');
  });
});

describe('BrowserPanel native — share toggle', () => {
  it('is disabled while agentBusy', async () => {
    await mount({ agentBusy: true });
    expect(screen.getByRole('button', { name: 'Cannot detach while agent is streaming' })).toBeDisabled();
  });
});
