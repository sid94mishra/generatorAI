// ────────────────────────────────────────────────────────────────
// ChatPage characterization — the right pane (future ChatDock)
//
// Pins what `pages/ChatPage.tsx` does TODAY with its right pane, before P4
// moves the routing into `useChatDockRouting(chatId)` + `chatDockTabs.ts`
// (03 §6.4). Spec: 09-verification.md §5.4 (Right-pane persistence, Auto-open,
// Tab caps) and 03 §6.4 "Characterization behaviours to pin (ChatPage)".
//
// The REAL ChatPage and the REAL RightPane are mounted; only the data layer is
// faked (helpers/chatPageFakes.ts): React Query hooks, the chat SSE manager,
// the multiplexed stream (`openMultiplexedStream` → a fake emitter the tests
// push `browser:` / `computer:` frames into), `fetch` (browser descriptor) and
// `WebSocket`. `useStreamStore` is the real store driven through its actions.
//
// Through the P4 split these assertions must stay unchanged: only the marked
// import line below changes when the page moves. The `right-pane*` testids are
// kept verbatim by the dock (09 §7.2).
// ────────────────────────────────────────────────────────────────

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStreamStore } from '@/stores/streamStore.js';
import { useRightPaneStore } from '@/stores/rightPaneStore.js';
import { addableRightPaneTabs as addableRightPaneTabsFor } from '@/platform/surfaceCapabilities.js';
import * as H from './helpers/chatPageFakes.js';
import { renderChatPage } from './helpers/renderChatPage.js';

vi.mock('@/hooks/queries.js', async (orig) =>
  (await import('./helpers/chatPageFakes.js')).fakeQueriesModule(await orig<object>()));
vi.mock('@/hooks/sourceQueries.js', async (orig) =>
  (await import('./helpers/chatPageFakes.js')).fakeSourceQueriesModule(await orig<object>()));
vi.mock('@/hooks/harnessQueries.js', async (orig) =>
  (await import('./helpers/chatPageFakes.js')).fakeHarnessQueriesModule(await orig<object>()));
vi.mock('@/hooks/composerQueries.js', async (orig) =>
  (await import('./helpers/chatPageFakes.js')).fakeComposerQueriesModule(await orig<object>()));
vi.mock('@/platform/muxStream.js', async (orig) =>
  (await import('./helpers/chatPageFakes.js')).fakeMuxStreamModule(await orig<object>()));
vi.mock('@/stores/sseManager.js', async (orig) => ({
  ...(await orig<object>()),
  connectChatSession: (await import('./helpers/chatPageFakes.js')).connectChatSessionSpy,
}));

// Import under test — the only line that changes when P4 moves the file.
import { ChatPage } from '@/pages/ChatPage.js';

const OPEN_KEY = 'generatorai:rightPane:chat:open';
const WIDTH_KEY = 'generatorai:rightPane:chat:width';
const tabsKey = (chatId: string) => `generatorai:rightPane:chat:${chatId}`;

const store = () => useStreamStore.getState();
const pane = () => screen.queryByTestId('right-pane');
const tabsOf = (type: string) => screen.queryAllByTestId(`right-pane-tab-${type}`);
const isSelected = (type: string) => tabsOf(type).some((t) => t.getAttribute('aria-selected') === 'true');
const storedTabs = (chatId: string): Array<{ id: string; type: string }> =>
  (JSON.parse(window.localStorage.getItem(tabsKey(chatId)) ?? '{"tabs":[]}') as { tabs: Array<{ id: string; type: string }> }).tabs;

function seedTabs(chatId: string, tabs: Array<{ id: string; type: string }>, active = tabs[tabs.length - 1]!.id) {
  window.localStorage.setItem(tabsKey(chatId), JSON.stringify({ tabs, active }));
}
function seedOpen(open = true) {
  window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
}
function mount(chat = H.makeChat()) {
  H.withChat(chat);
  H.setFakeData({});
  return renderChatPage(ChatPage, `/chats/${chat.id}`);
}
/** Let the descriptor fetch → json → then chain settle. */
async function flushFetches() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}
async function openAddMenu() {
  await userEvent.click(screen.getByTestId('right-pane-add-tab'));
}
function widget(instanceId: string, title: string, surface: 'widget' | 'inline' = 'widget', status: 'active' | 'closed' = 'active') {
  return {
    instanceId,
    descriptorId: `d-${instanceId}`,
    extensionId: 'ext',
    component: 'Board',
    title,
    surface,
    assetsBase: '',
    entry: '',
    props: {},
    status,
  };
}

beforeEach(() => {
  H.resetHarness();
  act(() => useStreamStore.setState({ streams: {} }));
});

// ════════════════════════════════════════════════════════════════
describe('right-pane persistence (09 §5.4; ChatPage.tsx:360, 390, 1609-1619)', () => {
  it('open state lives under `generatorai:rightPane:chat:open` (the header toggle drives it)', () => {
    mount();
    expect(pane()).not.toBeInTheDocument();

    act(() => useRightPaneStore.getState().controller?.toggle());
    expect(pane()).toBeInTheDocument();
    expect(window.localStorage.getItem(OPEN_KEY)).toBe('1');

    act(() => useRightPaneStore.getState().controller?.toggle());
    expect(pane()).not.toBeInTheDocument();
    expect(window.localStorage.getItem(OPEN_KEY)).toBe('0');
  });

  it('a stored open state opens the pane on mount, defaulting to the Changes tab', () => {
    seedOpen();
    mount();
    expect(pane()).toBeInTheDocument();
    expect(isSelected('changes')).toBe(true);
    expect(storedTabs(H.CHAT_ID)).toEqual([{ id: 'changes-1', type: 'changes' }]);
  });

  it('tabs are per chat under `generatorai:rightPane:chat:<chatId>`; switching chats shows the other chat’s tabs', () => {
    seedOpen();
    seedTabs(H.CHAT_ID, [
      { id: 'changes-1', type: 'changes' },
      { id: 'plan-x', type: 'plan' },
    ]);
    H.withChat(H.makeChat({ id: 'chat-2', sessionId: 'sess-2' }));
    const r = mount();
    expect(tabsOf('plan')).toHaveLength(1);
    expect(isSelected('plan')).toBe(true);

    r.navigateTo('/chats/chat-2');
    expect(tabsOf('plan')).toHaveLength(0);
    expect(isSelected('changes')).toBe(true);
    expect(storedTabs('chat-2')).toEqual([{ id: 'changes-1', type: 'changes' }]);
    // chat-1's layout is untouched by the visit.
    expect(storedTabs(H.CHAT_ID).map((t) => t.type)).toEqual(['changes', 'plan']);

    r.navigateTo(`/chats/${H.CHAT_ID}`);
    expect(tabsOf('plan')).toHaveLength(1);
  });

  describe('width', () => {
    let restoreWidth: () => void;
    beforeEach(() => {
      restoreWidth = H.installClientWidth(1400);
    });
    afterEach(() => restoreWidth());

    it('is ONE global key `generatorai:rightPane:chat:width`, not per chat', async () => {
      seedOpen();
      H.withChat(H.makeChat({ id: 'chat-2', sessionId: 'sess-2' }));
      const r = mount();
      const handle = screen.getByRole('separator', { name: 'Resize right pane' });
      handle.focus();
      await userEvent.keyboard('{End}');
      const stored = window.localStorage.getItem(WIDTH_KEY);
      expect(stored).not.toBeNull();
      expect(window.localStorage.getItem(`${tabsKey(H.CHAT_ID)}:width`)).toBeNull();

      r.navigateTo('/chats/chat-2');
      expect(screen.getByRole('separator', { name: 'Resize right pane' })).toHaveAttribute('aria-valuenow', stored);
      expect(window.localStorage.getItem(`${tabsKey('chat-2')}:width`)).toBeNull();
    });
  });

  it('switching chats resets the focus request and the Tasks auto-open (380-384): Background Tasks does not follow you into a worker chat', () => {
    H.setFakeData({ backgroundTasks: [{ taskId: 'w-1', taskName: 'Worker', status: 'running', reviewRounds: 0 }] });
    H.withChat(H.makeChat({ id: 'worker-1', sessionId: 'sess-w', parentChatId: H.CHAT_ID }));
    H.withChat(H.makeChat({ id: 'orch-2', sessionId: 'sess-o2', orchestratorMode: true }));
    const r = mount(H.makeChat({ orchestratorMode: true }));
    expect(pane()).toBeInTheDocument();
    expect(isSelected('background_tasks')).toBe(true);

    r.navigateTo('/chats/worker-1');
    expect(pane()).toBeInTheDocument(); // open state is page-global
    expect(tabsOf('background_tasks')).toHaveLength(0);
    expect(storedTabs('worker-1').map((t) => t.type)).toEqual(['changes']);

    // The once-per-chat latch was reset too: the next orchestrator auto-opens again.
    r.navigateTo('/chats/orch-2');
    expect(isSelected('background_tasks')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
describe('auto-open: Browser (09 §5.4; 03 §6.4 "on mount only when visible, on the SSE path also when unset"; 745-796)', () => {
  it('mount probe: a ready descriptor with visibility "visible" opens the Browser tab', async () => {
    H.setFakeData({ browserDescriptor: { ready: true, config: { visibility: 'visible' } } });
    mount();
    await waitFor(() => expect(isSelected('browser')).toBe(true));
    expect(H.fetchSpy).toHaveBeenCalledWith(`/api/workspaces/${H.WORKSPACE_ID}/browser/descriptor`);
  });

  // DISCREPANCY (09 §5.4): the doc says Browser opens when visibility is
  // 'visible' "or it is undefined"; on the MOUNT path the code requires
  // 'visible' (ChatPage.tsx:757) — only the SSE path accepts unset (781).
  it('mount probe: visibility unset does NOT open (strict on mount)', async () => {
    H.setFakeData({ browserDescriptor: { ready: true, config: {} } });
    mount();
    await waitFor(() => expect(H.fetchSpy).toHaveBeenCalled());
    await flushFetches();
    expect(pane()).not.toBeInTheDocument();
  });

  it('mount probe: a descriptor that is not ready does not open', async () => {
    H.setFakeData({ browserDescriptor: { ready: false, config: { visibility: 'visible' } } });
    mount();
    await waitFor(() => expect(H.fetchSpy).toHaveBeenCalled());
    await flushFetches();
    expect(pane()).not.toBeInTheDocument();
  });

  it('subscribes to `browser:<workspaceId>` filtered to browser.session_created', () => {
    mount();
    const sub = H.muxSubscriptions.find((s) => s.id === `browser:${H.WORKSPACE_ID}`);
    expect(sub).toMatchObject({ scope: 'session', filter: ['browser.session_created'], closed: false });
  });

  it('SSE: browser.session_created opens when the fresh descriptor has visibility unset', async () => {
    mount();
    H.setFakeData({ browserDescriptor: { config: {} } });
    H.emitMux(`browser:${H.WORKSPACE_ID}`, { kind: 'browser.session_created' });
    await waitFor(() => expect(isSelected('browser')).toBe(true));
  });

  it('SSE: browser.session_created opens when visibility is "visible"', async () => {
    mount();
    H.setFakeData({ browserDescriptor: { config: { visibility: 'visible' } } });
    H.emitMux(`browser:${H.WORKSPACE_ID}`, { kind: 'browser.session_created' });
    await waitFor(() => expect(isSelected('browser')).toBe(true));
  });

  it('SSE: any other visibility (e.g. "hidden") does not open', async () => {
    mount();
    H.setFakeData({ browserDescriptor: { config: { visibility: 'hidden' } } });
    const before = H.fetchSpy.mock.calls.length;
    H.emitMux(`browser:${H.WORKSPACE_ID}`, { kind: 'browser.session_created' });
    await waitFor(() => expect(H.fetchSpy.mock.calls.length).toBe(before + 1));
    await flushFetches();
    expect(pane()).not.toBeInTheDocument();
  });

  it('SSE: repeated session_created re-focuses the one Browser tab instead of adding more', async () => {
    mount();
    H.setFakeData({ browserDescriptor: { config: { visibility: 'visible' } } });
    H.emitMux(`browser:${H.WORKSPACE_ID}`, { kind: 'browser.session_created' });
    await waitFor(() => expect(isSelected('browser')).toBe(true));
    await userEvent.click(tabsOf('changes')[0]!);
    H.emitMux(`browser:${H.WORKSPACE_ID}`, { kind: 'browser.session_created' });
    await waitFor(() => expect(isSelected('browser')).toBe(true));
    expect(tabsOf('browser')).toHaveLength(1);
  });

  it('no workspace → no descriptor probe and no browser subscription', () => {
    mount(H.makeChat({ workspaceId: undefined }));
    expect(H.fetchSpy).not.toHaveBeenCalled();
    expect(H.muxSubscriptions.some((s) => s.id.startsWith('browser:'))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
describe('auto-open: Computer (797-830)', () => {
  it.each(['computer.session_started', 'computer.consent_required'])('%s opens the Computer tab', async (kind) => {
    H.setFakeData({ computerUseEnabled: true });
    mount();
    H.emitMux(`computer:${H.WORKSPACE_ID}`, { kind });
    await waitFor(() => expect(isSelected('computer')).toBe(true));
  });

  it('other computer.* frames do not open anything', () => {
    H.setFakeData({ computerUseEnabled: true });
    mount();
    H.emitMux(`computer:${H.WORKSPACE_ID}`, { kind: 'computer.action' });
    expect(pane()).not.toBeInTheDocument();
  });

  it('with Computer Use disabled there is no computer subscription at all', () => {
    mount();
    expect(H.muxSubscriptions.some((s) => s.id.startsWith('computer:'))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
describe('auto-open: full-page widgets (09 §5.4; 832-864)', () => {
  it('a new full-page widget opens its own tab once, labelled by its title', () => {
    mount();
    act(() => store().addWidget(H.SESSION_ID, widget('w-1', 'Kanban')));
    expect(pane()).toBeInTheDocument();
    expect(tabsOf('widget')).toHaveLength(1);
    expect(tabsOf('widget')[0]).toHaveAttribute('title', 'Kanban');
    expect(isSelected('widget')).toBe(true);
    expect(storedTabs(H.CHAT_ID)).toContainEqual({ id: 'widget:w-1', type: 'widget' });
  });

  it('re-rendering the same instance neither duplicates the tab nor steals focus back', async () => {
    mount();
    act(() => store().addWidget(H.SESSION_ID, widget('w-1', 'Kanban')));
    await userEvent.click(tabsOf('changes')[0]!);
    act(() => store().addWidget(H.SESSION_ID, widget('w-1', 'Kanban v2')));
    act(() => store().setWidgetStatus(H.SESSION_ID, 'w-1', 'error'));
    act(() => store().setWidgetStatus(H.SESSION_ID, 'w-1', 'active'));
    expect(tabsOf('widget')).toHaveLength(1);
    // DISCREPANCY (09 §5.4 "a re-render refocuses it"): the instance is
    // remembered in `seenCanvasWidgetsRef` (ChatPage.tsx:847) and never
    // re-requested, so a re-render does NOT refocus the tab; it only relabels it.
    expect(isSelected('changes')).toBe(true);
    expect(tabsOf('widget')[0]).toHaveAttribute('title', 'Kanban v2');
  });

  it('a second widget gets a second tab', () => {
    mount();
    act(() => store().addWidget(H.SESSION_ID, widget('w-1', 'Kanban')));
    act(() => store().addWidget(H.SESSION_ID, widget('w-2', 'Chart')));
    expect(tabsOf('widget').map((t) => t.getAttribute('title'))).toEqual(['Kanban', 'Chart']);
    expect(tabsOf('widget')[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('inline or closed widgets open nothing', () => {
    mount();
    act(() => store().addWidget(H.SESSION_ID, widget('w-in', 'Inline', 'inline')));
    act(() => store().addWidget(H.SESSION_ID, widget('w-closed', 'Closed', 'widget', 'closed')));
    expect(pane()).not.toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
describe('auto-open: Plan (03 §6.4 "once per plan id and only while the document is visible"; 535-543)', () => {
  const plan = (planId: string) => ({
    planId,
    revision: 1,
    title: `Plan ${planId}`,
    summary: '',
    status: 'awaiting_review' as const,
    actions: ['implement_interactive'],
    interactionId: `i-${planId}`,
  });

  it('opens once per plan id: closing it and re-requesting review of the SAME plan does not reopen; a new plan does', async () => {
    mount();
    act(() => {
      store().startPending(H.SESSION_ID, 'plan');
      store().upsertPlan(H.SESSION_ID, plan('p-1'));
    });
    expect(isSelected('plan')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Close Plan tab' }));
    expect(tabsOf('plan')).toHaveLength(0);

    act(() => store().setPlanStatus(H.SESSION_ID, 'p-1', 'changes_requested'));
    act(() => store().setPlanStatus(H.SESSION_ID, 'p-1', 'awaiting_review', { revision: 2 }));
    expect(tabsOf('plan')).toHaveLength(0);

    act(() => store().upsertPlan(H.SESSION_ID, plan('p-2')));
    expect(isSelected('plan')).toBe(true);
  });

  it('does not open while the document is hidden', () => {
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      mount();
      act(() => {
        store().startPending(H.SESSION_ID, 'plan');
        store().upsertPlan(H.SESSION_ID, plan('p-1'));
      });
      expect(pane()).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
});

// ════════════════════════════════════════════════════════════════
describe('auto-open: Background Tasks (03 §6.4 "once per chat, orchestrator only"; 428-453)', () => {
  const task = (taskId: string) => ({ taskId, taskName: taskId, status: 'running', reviewRounds: 0 });

  it('opens on the first task of an orchestrator chat, and only once', async () => {
    mount(H.makeChat({ orchestratorMode: true }));
    expect(pane()).not.toBeInTheDocument();
    H.setFakeData({ backgroundTasks: [task('t-1')] });
    expect(isSelected('background_tasks')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: /^Close Background Tasks/ }));
    H.setFakeData({ backgroundTasks: [task('t-1'), task('t-2')] });
    expect(tabsOf('background_tasks')).toHaveLength(0);
  });

  it('never for a non-orchestrator chat (the list is not even polled)', () => {
    H.setFakeData({ backgroundTasks: [task('t-1')] });
    mount();
    expect(pane()).not.toBeInTheDocument();
    expect(H.hookCalls.useBackgroundTasks).toHaveBeenLastCalledWith(H.CHAT_ID, false);
  });
});

// ════════════════════════════════════════════════════════════════
describe('tab caps and the addable ledger (09 §5.4 Tab caps; 1139-1297)', () => {
  const addable = () =>
    screen.queryAllByRole('menuitem').map((el) => el.getAttribute('data-testid')?.replace('right-pane-add-', ''));

  it.each([
    { computerUseEnabled: false, isOrchestrator: false },
    { computerUseEnabled: true, isOrchestrator: false },
    { computerUseEnabled: false, isOrchestrator: true },
    { computerUseEnabled: true, isOrchestrator: true },
  ])('the "+" menu is exactly addableRightPaneTabsFor(%o) — Tasks only for orchestrators, Computer only when enabled', async (opts) => {
    seedOpen();
    H.setFakeData({ computerUseEnabled: opts.computerUseEnabled });
    mount(H.makeChat({ orchestratorMode: opts.isOrchestrator }));
    await openAddMenu();
    const expected = addableRightPaneTabsFor(opts);
    expect(addable()).toEqual(expected);
    expect(addable().includes('background_tasks')).toBe(opts.isOrchestrator);
    expect(addable().includes('computer')).toBe(opts.computerUseEnabled);
  });

  it.each([
    ['browser', 5],
    ['widget', 6],
    ['files', 4],
  ])('%s is capped at %i instances: below the cap it is still offered, at the cap it is not', async (type, cap) => {
    const tabs = (n: number) => [
      { id: 'changes-1', type: 'changes' },
      ...Array.from({ length: n }, (_, i) => ({ id: `${type}-seed-${i}`, type })),
    ];
    seedOpen();
    seedTabs(H.CHAT_ID, tabs(cap - 1), 'changes-1');
    const first = mount();
    await openAddMenu();
    expect(addable()).toContain(type);
    first.unmount();

    seedTabs(H.CHAT_ID, tabs(cap), 'changes-1');
    mount();
    expect(tabsOf(type)).toHaveLength(cap);
    await openAddMenu();
    expect(addable()).not.toContain(type);
  });

  it('terminal is capped at 4 instances', async () => {
    seedOpen();
    seedTabs(
      H.CHAT_ID,
      [{ id: 'changes-1', type: 'changes' }, ...[0, 1, 2, 3].map((i) => ({ id: `terminal-seed-${i}`, type: 'terminal' }))],
      'changes-1',
    );
    mount();
    expect(tabsOf('terminal')).toHaveLength(4);
    await openAddMenu();
    expect(addable()).not.toContain('terminal');
  });

  it('a 7th full-page widget at the widget cap shows the cap notice and focuses the OLDEST widget tab', () => {
    seedOpen();
    seedTabs(
      H.CHAT_ID,
      [{ id: 'changes-1', type: 'changes' }, ...['a', 'b', 'c', 'd', 'e', 'f'].map((x) => ({ id: `widget:${x}`, type: 'widget' }))],
      'changes-1',
    );
    mount();
    act(() => store().addWidget(H.SESSION_ID, widget('g', 'Seventh')));
    expect(screen.getByTestId('right-pane-cap-notice')).toBeInTheDocument();
    expect(tabsOf('widget')).toHaveLength(6);
    expect(tabsOf('widget')[0]).toHaveAttribute('aria-selected', 'true');
    expect(storedTabs(H.CHAT_ID).some((t) => t.id === 'widget:g')).toBe(false);
  });

  it('the default Changes tab has no close button; other tabs do; every tab stays mounted (inactive = aria-hidden)', () => {
    seedOpen();
    seedTabs(H.CHAT_ID, [
      { id: 'changes-1', type: 'changes' },
      { id: 'plan-x', type: 'plan' },
    ]);
    mount();
    expect(screen.queryByRole('button', { name: 'Close Changes tab' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Plan tab' })).toBeInTheDocument();
    expect(screen.getByTestId('right-pane-panel-changes')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('right-pane-panel-plan')).toHaveAttribute('aria-hidden', 'false');
  });
});
