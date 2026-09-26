// ────────────────────────────────────────────────────────────────
// BrowserPanel characterization — toolbar (P4-01).
//
// Pins the CURRENT toolbar behaviour of components/chat/BrowserPanel.tsx before
// the P4 split (03-component-inventory-domain.md §6.2 → useBrowserNavigation,
// BrowserToolbar / UrlField / UrlPill / ShareToggle / CaptureButton;
// 09-verification.md §5.2 "URL bar"): https:// prefixing, start-before-ready,
// REST back/forward/reload, internal URL hiding and focus freeze, the tab state
// on the web, the restricted URL pill, the share toggle (agentBusy titles),
// Inspect/Capture exclusivity and the error banner's "Dismiss".
//
// Sibling suites: BrowserPanel.characterization.test.tsx (mode, polling,
// auto-start, SSE), BrowserPanel.screencast.characterization.test.tsx and
// BrowserPanel.native.characterization.test.tsx (native IPC variants of the URL
// bar and back/forward/reload).
//
// Mocks only the data layer: `@/platform/muxStream`, `@/platform/authTransport`,
// `fetch`, `WebSocket`.
// These assertions must stay unchanged through the P4 split — only the marked
// import line may change.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '@/providers/ThemeProvider.js';

import {
  advance,
  FakeWebSocket,
  flush,
  installBrowserFetch,
  jsonResponse,
  useManualClock,
  type BrowserDescriptorFixture,
  type BrowserFetchStub,
} from './helpers/browserHarness.js';

// Import under test — the only line that changes when P4 moves the file.
import { BrowserPanel } from '@/components/chat/BrowserPanel.js';

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

type PanelProps = React.ComponentProps<typeof BrowserPanel>;

function panel(props: Partial<PanelProps> = {}): React.JSX.Element {
  return <BrowserPanel embedded workspaceId="ws-1" tabId="tab-1" open visible onClose={() => {}} {...props} />;
}

function renderPanel(props: Partial<PanelProps> = {}) {
  const view = render(panel(props), { wrapper: ThemeProvider });
  return { ...view, update: (next: Partial<PanelProps>) => view.rerender(panel({ ...props, ...next })) };
}

function enableWebInteractivity(): void {
  window.localStorage.setItem(INTERACTIVITY_KEY, 'true');
}

const urlBox = (): HTMLInputElement => screen.getByRole('textbox') as HTMLInputElement;
const inspectButton = (): HTMLElement => screen.getByRole('button', { name: /^Comment — click elements/ });
const captureButton = (): HTMLElement => screen.getByRole('button', { name: /^Capture region — drag/ });

async function submitUrl(value: string): Promise<void> {
  fireEvent.change(urlBox(), { target: { value } });
  const form = urlBox().closest('form');
  if (!form) throw new Error('URL bar is not inside a form');
  fireEvent.submit(form);
  await flush();
}

let fetchStub: BrowserFetchStub;

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── URL bar ──────────────────────────────────────────────────

describe('BrowserPanel — URL bar (web)', () => {
  beforeEach(() => enableWebInteractivity());

  it('prefixes https:// to a bare host and navigates over REST, then refetches the descriptor', async () => {
    renderPanel();
    await flush();
    const before = fetchStub.count('descriptor');
    await submitUrl('  example.org/path  ');
    expect(fetchStub.to('actions').map((c) => c.body)).toEqual([{ kind: 'navigate', url: 'https://example.org/path' }]);
    expect(fetchStub.count('descriptor')).toBe(before + 1);
  });

  it('keeps an explicit http:// or https:// scheme', async () => {
    renderPanel();
    await flush();
    await submitUrl('http://localhost:3000');
    await submitUrl('https://a.example');
    expect(fetchStub.to('actions').map((c) => c.body)).toEqual([
      { kind: 'navigate', url: 'http://localhost:3000' },
      { kind: 'navigate', url: 'https://a.example' },
    ]);
  });

  // Was P4 defect #5 (fixed in P4-03): navigate tested the scheme case-sensitively (BrowserPanel.tsx:652) while start is
  // case-insensitive (608), so "HTTP://EXAMPLE.COM" becomes "https://HTTP://EXAMPLE.COM".
  it('does not double-prefix an upper-case scheme on navigate', async () => {
    renderPanel();
    await flush();
    await submitUrl('HTTP://EXAMPLE.COM');
    expect(fetchStub.to('actions').map((c) => c.body)).toEqual([{ kind: 'navigate', url: 'HTTP://EXAMPLE.COM' }]);
  });

  it('an empty address does nothing', async () => {
    renderPanel();
    await flush();
    await submitUrl('   ');
    expect(fetchStub.count('actions')).toBe(0);
    expect(fetchStub.count('start')).toBe(0);
  });

  it('submitting before the session is ready starts it with the (prefixed) address instead of navigating', async () => {
    fetchStub.setDescriptor(OFF);
    renderPanel();
    await flush();
    await submitUrl('example.com');
    expect(fetchStub.count('actions')).toBe(0);
    expect(fetchStub.to('start').map((c) => c.body)).toEqual([{ url: 'https://example.com', config: { enabled: true } }]);
    // start's scheme test is case-insensitive
    await submitUrl('HTTP://Upper.example');
    expect(fetchStub.to('start')[1]?.body).toEqual({ url: 'HTTP://Upper.example', config: { enabled: true } });
  });

  it('the Start button re-polls the descriptor immediately (nowKey bump)', async () => {
    fetchStub.setDescriptor(OFF);
    renderPanel();
    await flush();
    const before = fetchStub.count('descriptor');
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await flush();
    expect(fetchStub.count('start')).toBe(1);
    expect(fetchStub.count('descriptor')).toBe(before + 1);
  });

  it.each(['back', 'forward', 'reload'] as const)('%s goes to REST without a native bridge', async (kind) => {
    renderPanel();
    await flush();
    const before = fetchStub.count('descriptor');
    fireEvent.click(screen.getByRole('button', { name: kind[0]!.toUpperCase() + kind.slice(1) }));
    await flush();
    expect(fetchStub.to('actions').map((c) => c.body)).toEqual([{ kind }]);
    expect(fetchStub.count('descriptor')).toBe(before + 1);
  });

  it('shows the descriptor URL; an internal URL (about:blank*, #gai-) never replaces it on the web', async () => {
    renderPanel();
    await flush();
    expect(urlBox()).toHaveValue('https://example.com/');
    fetchStub.setDescriptor({ ...READY, currentUrl: 'about:blank#gai-ws-1' });
    await advance(4000);
    // Web mode leaves the previous address in place (only native clears it).
    expect(urlBox()).toHaveValue('https://example.com/');
    fetchStub.setDescriptor({ ...READY, currentUrl: 'https://next.example/#gai-marker' });
    await advance(4000);
    expect(urlBox()).toHaveValue('https://example.com/');
    fetchStub.setDescriptor({ ...READY, currentUrl: 'https://next.example/' });
    await advance(4000);
    expect(urlBox()).toHaveValue('https://next.example/');
  });

  it('a fresh web panel on an internal URL starts with an empty address', async () => {
    fetchStub.setDescriptor({ ...READY, currentUrl: 'about:blank' });
    renderPanel();
    await flush();
    expect(urlBox()).toHaveValue('');
  });

  it('while the address bar has focus, descriptor updates do not overwrite what the user types', async () => {
    renderPanel();
    await flush();
    fireEvent.focus(urlBox());
    fireEvent.change(urlBox(), { target: { value: 'typing' } });
    fetchStub.setDescriptor({ ...READY, currentUrl: 'https://moved.example/' });
    await advance(4000);
    expect(urlBox()).toHaveValue('typing');
    fireEvent.blur(urlBox());
    await flush();
    expect(urlBox()).toHaveValue('https://moved.example/');
  });

  it('tab state on the web: internal URL → no title/favicon, url passed through as-is', async () => {
    const onTabStateChange = vi.fn();
    fetchStub.setDescriptor({ ...READY, currentUrl: 'about:blank#gai-ws-1' });
    renderPanel({ onTabStateChange });
    await flush();
    expect(onTabStateChange).toHaveBeenLastCalledWith({ loading: false, title: null, favicon: null, url: 'about:blank#gai-ws-1' });
  });

  it('tab state on the web: "starting" shows as loading', async () => {
    const onTabStateChange = vi.fn();
    fetchStub.setDescriptor({ status: 'starting', mode: 'screencast', ready: false });
    renderPanel({ onTabStateChange });
    await flush();
    expect(onTabStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ loading: true }));
  });
});

describe('BrowserPanel — URL pill (web, restricted)', () => {
  // Was P4 defect #6 (fixed in P4-03): the restricted pill rendered `descriptor.currentUrl` verbatim (BrowserPanel.tsx:1605),
  // so the internal `about:blank#gai-<id>` discovery marker that isInternalBrowserUrl (274-277)
  // says must never surface is shown to the user.
  it('never shows the internal #gai- marker', async () => {
    fetchStub.setDescriptor({ ...READY, currentUrl: 'about:blank#gai-ws-1' });
    renderPanel();
    await flush();
    expect(screen.queryByText(/#gai-/)).toBeNull();
  });
});

// ── Share toggle ─────────────────────────────────────────────

describe('BrowserPanel — share toggle (BrowserPanel.tsx:900-911, 1517-1521, 1610-1630)', () => {
  it('shared → click detaches (POST /detach), the label and aria-pressed follow the answer; click again attaches', async () => {
    renderPanel();
    await flush();
    const shared = screen.getByRole('button', { name: 'Sharing with Agent — click to stop sharing' });
    expect(shared).toHaveAttribute('aria-pressed', 'true');
    expect(shared).toHaveAttribute('title', 'Sharing with Agent — click to stop sharing');
    fireEvent.click(shared);
    await flush();
    expect(fetchStub.to('detach')).toHaveLength(1);
    expect(fetchStub.to('detach')[0]?.method).toBe('POST');
    const unshared = screen.getByRole('button', { name: 'Share with Agent' });
    expect(unshared).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(unshared);
    await flush();
    expect(fetchStub.to('attach')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Sharing with Agent — click to stop sharing' })).toBeInTheDocument();
  });

  it('agentBusy while shared: disabled, "Cannot detach while agent is streaming"', async () => {
    renderPanel({ agentBusy: true });
    await flush();
    const btn = screen.getByRole('button', { name: 'Cannot detach while agent is streaming' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    await flush();
    expect(fetchStub.count('detach')).toBe(0);
  });

  it('agentBusy while detached: disabled, "Cannot re-attach while agent is streaming"', async () => {
    fetchStub.setDescriptor({ ...READY, attachedToChat: false });
    renderPanel({ agentBusy: true });
    await flush();
    expect(screen.getByRole('button', { name: 'Cannot re-attach while agent is streaming' })).toBeDisabled();
  });

  it('is not rendered until the session is ready', async () => {
    fetchStub.setDescriptor(OFF);
    renderPanel();
    await flush();
    expect(screen.queryByRole('button', { name: /Shar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Comment — click elements/ })).toBeNull();
  });
});

// ── Inspect / Capture ────────────────────────────────────────

describe('BrowserPanel — Inspect and Capture are mutually exclusive (web)', () => {
  beforeEach(() => enableWebInteractivity());

  it('turning Capture on turns Inspect off and tells the server (inspector on:false)', async () => {
    renderPanel();
    await flush();
    fireEvent.click(inspectButton());
    await flush();
    expect(inspectButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(captureButton());
    await flush();
    expect(captureButton()).toHaveAttribute('aria-pressed', 'true');
    expect(inspectButton()).toHaveAttribute('aria-pressed', 'false');
    expect(fetchStub.to('actions').map((c) => c.body)).toEqual([
      { kind: 'inspector', on: true },
      { kind: 'inspector', on: false },
    ]);
  });

  it('turning Inspect on turns Capture off', async () => {
    renderPanel();
    await flush();
    fireEvent.click(captureButton());
    expect(captureButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(inspectButton());
    await flush();
    expect(captureButton()).toHaveAttribute('aria-pressed', 'false');
    expect(inspectButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('Inspect toggles off with inspector on:false', async () => {
    renderPanel();
    await flush();
    fireEvent.click(inspectButton());
    await flush();
    fireEvent.click(inspectButton());
    await flush();
    expect(fetchStub.to('actions').map((c) => c.body)).toEqual([
      { kind: 'inspector', on: true },
      { kind: 'inspector', on: false },
    ]);
    expect(inspectButton()).toHaveAttribute('aria-pressed', 'false');
  });
});

// ── Error banner ─────────────────────────────────────────────

describe('BrowserPanel — error banner', () => {
  it('a failed start shows the server message; "Dismiss" clears it', async () => {
    enableWebInteractivity();
    fetchStub.setDescriptor(OFF);
    fetchStub.route('start', () => jsonResponse({ error: { message: 'Browser pool is full' } }, 503));
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await flush();
    expect(screen.getByTitle('Browser pool is full')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Browser pool is full')).toBeNull();
  });

  it('validation issues are joined with "; "', async () => {
    enableWebInteractivity();
    fetchStub.setDescriptor(OFF);
    fetchStub.route('start', () => jsonResponse({ error: { issues: [{ message: 'bad url' }, { message: 'blocked host' }] } }, 400));
    renderPanel();
    await flush();
    await submitUrl('x');
    expect(screen.getByTitle('bad url; blocked host')).toBeInTheDocument();
  });
});
