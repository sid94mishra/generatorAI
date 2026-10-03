// ────────────────────────────────────────────────────────────────
// ChatPage characterization — transcript, composer and gate behaviour
//
// Pins what `pages/ChatPage.tsx` does TODAY, before P4-02..04 split it into
// `features/chat/` (useChatWorkspace / useChatStreamState / useChatTranscript /
// useChatGates / useChatRewind, 03 §6.4). Spec: 09-verification.md §5.4 and the
// "Characterization behaviours to pin (ChatPage)" list in 03 §6.4.
//
// The REAL ChatPage is mounted (with the real ChatInput, ChatMessageList,
// StreamingMessage and RightPane); only the data layer is faked — see
// helpers/chatPageFakes.ts. `useStreamStore` is the real store, driven through
// its actions exactly as the SSE manager would.
//
// Through the P4 split these assertions must stay unchanged: only the marked
// import line below changes when the page moves. A test that has to change its
// assertions is exposing a regression (or an intended change for the PR).
//
// The dock half (right-pane persistence, auto-open, tab caps) lives in
// ChatPage.dock.characterization.test.tsx.
// ────────────────────────────────────────────────────────────────

import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@generatorai/shared';
import { useStreamStore } from '@/stores/streamStore.js';
import * as H from './helpers/chatPageFakes.js';
import { currentLocation, renderChatPage } from './helpers/renderChatPage.js';

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
import { ChatPage } from '@/features/chat/ChatPage.js';

const store = () => useStreamStore.getState();
const stream = () => store().streams[H.SESSION_ID];
const composer = () => screen.queryByRole('textbox', { name: 'Message' });
/** The page / transcript skeleton (`chat-skeleton` since P4-12; the kit skeleton has no pulse, D-20). */
const skeletonBlocks = (root: HTMLElement) => root.querySelectorAll('[data-testid="chat-skeleton"]').length;

function mount(chat = H.makeChat(), messages: ChatMessage[] = []) {
  H.withChat(chat);
  H.setFakeData((d) => ({ messages: { ...d.messages, [chat.id]: messages } }));
  return renderChatPage(ChatPage, `/chats/${chat.id}`);
}

beforeEach(() => {
  H.resetHarness();
  act(() => useStreamStore.setState({ streams: {} }));
});

// ════════════════════════════════════════════════════════════════
describe('routing (09 §5.4 Routing)', () => {
  it('no chatId navigates to "/" (ChatPage.tsx:1321-1324)', async () => {
    renderChatPage(ChatPage, '/chats');
    expect(await screen.findByText('Home route')).toBeInTheDocument();
    expect(currentLocation()).toBe('/');
  });

  it('shows only the skeleton while the chat RECORD loads — loaded messages do not un-gate it (1330-1332)', () => {
    H.setFakeData({
      chats: { [H.CHAT_ID]: { data: undefined, isLoading: true, error: null } },
      messages: { [H.CHAT_ID]: H.makeConversation(2) },
    });
    const { container } = renderChatPage(ChatPage);
    expect(skeletonBlocks(container)).toBeGreaterThan(0);
    expect(screen.queryByText('msg #1')).not.toBeInTheDocument();
    expect(composer()).not.toBeInTheDocument();

    H.withChat(H.makeChat());
    H.setFakeData({});
    expect(screen.getByText('msg #1')).toBeInTheDocument();
    expect(composer()).toBeInTheDocument();
  });

  it('while only the MESSAGES load, the shell (composer) is already interactive under a transcript skeleton', () => {
    H.withChat(H.makeChat());
    H.setFakeData({ messagesLoading: true });
    const { container } = renderChatPage(ChatPage);
    expect(composer()).toBeInTheDocument();
    expect(skeletonBlocks(container)).toBeGreaterThan(0);
    // The empty state waits for the messages too.
    expect(screen.queryByText('Start the conversation')).not.toBeInTheDocument();
  });

  it('an errored chat shows "Chat not found" and "Go back" returns to "/" (1334-1346)', async () => {
    H.setFakeData({ chats: { [H.CHAT_ID]: { data: undefined, isLoading: false, error: new Error('404') } } });
    renderChatPage(ChatPage);
    expect(screen.getByText('Chat not found')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(currentLocation()).toBe('/');
  });

  it('a missing chat (no record, not loading) also shows "Chat not found"', () => {
    renderChatPage(ChatPage, '/chats/nope');
    expect(screen.getByText('Chat not found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
    expect(composer()).not.toBeInTheDocument();
  });

  it('an empty loaded chat shows the "Start the conversation" empty state', () => {
    mount();
    expect(screen.getByText('Start the conversation')).toBeInTheDocument();
    expect(screen.getByText('Type a message below to start.')).toBeInTheDocument();
  });

  it('opens the chat SSE session for (chatId, sessionId) (712-718)', () => {
    mount();
    expect(H.connectChatSessionSpy).toHaveBeenCalledWith(H.CHAT_ID, H.SESSION_ID, expect.anything());
  });
});

// ════════════════════════════════════════════════════════════════
describe('paging (09 §5.4 Paging; 236-244, 1398-1408)', () => {
  const lastLimit = () => H.hookCalls.useChatMessages.mock.lastCall?.[1];
  const loadEarlier = () => screen.queryByRole('button', { name: 'Load earlier messages' });

  it('asks for 100 first, offers "Load earlier messages" while the page is full, and each click adds 100', async () => {
    mount(H.makeChat(), H.makeConversation(230));
    expect(lastLimit()).toBe(100);
    expect(screen.getByText('msg #230')).toBeInTheDocument();
    expect(screen.queryByText('msg #130')).not.toBeInTheDocument();
    expect(loadEarlier()).toBeInTheDocument();

    await userEvent.click(loadEarlier()!);
    expect(lastLimit()).toBe(200);
    expect(screen.getByText('msg #31')).toBeInTheDocument();
    expect(loadEarlier()).toBeInTheDocument();

    await userEvent.click(loadEarlier()!);
    expect(lastLimit()).toBe(300);
    expect(screen.getByText('msg #1')).toBeInTheDocument();
    // 230 < 300: the server did not fill the page, so there is nothing older.
    expect(loadEarlier()).not.toBeInTheDocument();
  });

  it('keys on count === limit: exactly 100 still offers the button (one wasted round-trip)', () => {
    mount(H.makeChat(), H.makeConversation(100));
    expect(loadEarlier()).toBeInTheDocument();
  });

  it('keys on count === limit: 99 does not offer the button', () => {
    mount(H.makeChat(), H.makeConversation(99));
    expect(loadEarlier()).not.toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
describe('composer, archived banner and fork provenance (09 §5.4 Composer)', () => {
  it('an active chat with a session renders the composer and no archived banner', () => {
    mount();
    expect(composer()).toBeInTheDocument();
    expect(screen.queryByText('This chat has been archived')).not.toBeInTheDocument();
  });

  it('an archived chat shows the banner and no composer (1377-1385, 1499-1500)', () => {
    mount(H.makeChat({ status: 'archived' }), H.makeConversation(2));
    expect(screen.getByText('This chat has been archived')).toBeInTheDocument();
    expect(composer()).not.toBeInTheDocument();
    expect(screen.getByText('msg #2')).toBeInTheDocument();
  });

  it('an active chat without a session has no composer', () => {
    mount(H.makeChat({ sessionId: '' }));
    expect(composer()).not.toBeInTheDocument();
  });

  it('`fork-provenance` names the parent and links to it, only for a forked chat (92-109, 1373-1375)', async () => {
    H.withChat(H.makeChat({ id: 'parent-1', name: 'Parent chat', sessionId: 'sess-p' }));
    mount(H.makeChat({ forkedFromChatId: 'parent-1' }));
    const chip = screen.getByTestId('fork-provenance');
    expect(chip).toHaveTextContent('Forked from Parent chat');
    await userEvent.click(chip);
    expect(currentLocation()).toBe('/chats/parent-1');
  });

  it('a fork whose parent cannot be read says "Forked chat"', () => {
    mount(H.makeChat({ forkedFromChatId: 'gone' }));
    expect(screen.getByTestId('fork-provenance')).toHaveTextContent('Forked chat');
  });

  it('a chat that is not a fork has no `fork-provenance`', () => {
    mount();
    expect(screen.queryByTestId('fork-provenance')).not.toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
describe('optimistic bubble dedup (09 §5.4; 03 §6.4 "prefers serverTurnId, content-match only on the last message"; 966-1009)', () => {
  const user = (content: string, turnId?: string) =>
    H.makeMessage('user', content, turnId ? { metadata: { turnId } } : {});
  const assistant = (content: string) => H.makeMessage('assistant', content);
  const count = (text: string) => screen.queryAllByText(text).length;

  it('by turnId: hides the persisted copy of THIS turn only, even when an older identical prompt exists', () => {
    mount(H.makeChat(), [user('same prompt', 't1'), assistant('first answer'), user('same prompt', 't2')]);
    expect(count('same prompt')).toBe(2);
    act(() => {
      store().startPending(H.SESSION_ID, 'same prompt');
      store().setServerTurnId(H.SESSION_ID, 't2');
    });
    // Older persisted copy (t1) + the optimistic bubble; the t2 copy is hidden.
    expect(count('same prompt')).toBe(2);
    expect(screen.getByText('first answer')).toBeInTheDocument();
    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('by turnId: everything from the matching row on is hidden (slice before it)', () => {
    mount(H.makeChat(), [user('q1', 't1'), assistant('a1'), user('q2', 't2'), assistant('partial persisted')]);
    act(() => {
      store().startPending(H.SESSION_ID, 'q2');
      store().setServerTurnId(H.SESSION_ID, 't2');
    });
    expect(screen.queryByText('partial persisted')).not.toBeInTheDocument();
    expect(count('q2')).toBe(1); // the optimistic bubble
    expect(screen.getByText('a1')).toBeInTheDocument();
  });

  it('content fallback (no turnId yet): hides the LAST message when it is the matching user prompt', () => {
    mount(H.makeChat(), [user('hello'), assistant('hi'), user('again')]);
    // The match is on trimmed content; the persisted copy is hidden and the
    // one visible "again" is the optimistic bubble.
    act(() => store().startPending(H.SESSION_ID, '  again  '));
    expect(screen.queryAllByText(/^\s*again\s*$/)).toHaveLength(1);
    expect(screen.getByText('just now')).toBeInTheDocument();
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('content fallback never hides an OLDER identical prompt (last row is not a match)', () => {
    mount(H.makeChat(), [user('same'), assistant('answer')]);
    act(() => store().startPending(H.SESSION_ID, 'same'));
    // persisted older copy + optimistic bubble
    expect(count('same')).toBe(2);
    expect(screen.getByText('answer')).toBeInTheDocument();
  });

  it('a whitespace-only turn prompt trims everything after the last user message', () => {
    mount(H.makeChat(), [user('q1'), assistant('a1'), user('q2'), assistant('stale tail')]);
    act(() => store().startPending(H.SESSION_ID, '   '));
    expect(screen.queryByText('stale tail')).not.toBeInTheDocument();
    expect(screen.getByText('q2')).toBeInTheDocument();
    expect(screen.getByText('a1')).toBeInTheDocument();
  });

  it('no dedup and no optimistic bubble once the stream is idle', () => {
    mount(H.makeChat(), [user('again')]);
    act(() => {
      store().startPending(H.SESSION_ID, 'again');
      store().clearStream(H.SESSION_ID);
    });
    expect(count('again')).toBe(1);
    expect(screen.queryByText('just now')).not.toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
describe('working banner and pending gates (09 §5.4 Pending gates)', () => {
  it('banner: "Processing..." while pending, "Generating response..." while streaming, "Paused — waiting for your input" on a gate (1354-1367)', () => {
    mount();
    expect(screen.queryByText(/Generating response/)).not.toBeInTheDocument();

    act(() => store().startPending(H.SESSION_ID, 'go'));
    expect(screen.getByText('Processing...')).toBeInTheDocument();

    act(() => store().appendToken(H.SESSION_ID, 'tok'));
    // DISCREPANCY (09 §5.4): the doc spells "Generating response…" (ellipsis
    // character); the code renders three ASCII dots (ChatPage.tsx:1364).
    expect(screen.getByText('Generating response...')).toBeInTheDocument();

    act(() =>
      store().upsertQuestion(H.SESSION_ID, {
        interactionId: 'q-1',
        questions: [],
        status: 'pending',
      }),
    );
    expect(screen.getByText('Paused — waiting for your input')).toBeInTheDocument();
    expect(screen.queryByText('Generating response...')).not.toBeInTheDocument();

    act(() => store().completeStream(H.SESSION_ID));
    expect(screen.queryByText('Paused — waiting for your input')).not.toBeInTheDocument();
  });

  it.each([
    ['plan_review', 'Waiting on your plan review before the agent can continue.'],
    ['tool_permission', 'The agent is waiting for you to allow or deny a tool call.'],
    ['question', 'The agent is waiting for your answer.'],
  ])('composer gate label for a polled %s gate (600-609)', (kind, label) => {
    H.setFakeData({ pendingInteractions: [{ interactionId: 'g-1', kind, status: 'pending' }] });
    mount();
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('polls pending interactions only for an active chat (473-476)', () => {
    mount(H.makeChat({ status: 'archived' }));
    expect(H.hookCalls.usePendingInteractions).toHaveBeenLastCalledWith(H.CHAT_ID, false);
  });

  describe('reconciliation against the poll never expires a card opened after the poll (624-657)', () => {
    function openAllGates() {
      act(() => {
        store().startPending(H.SESSION_ID, 'go');
        store().upsertQuestion(H.SESSION_ID, { interactionId: 'q-1', questions: [], status: 'pending' });
        store().upsertPlan(H.SESSION_ID, {
          planId: 'p-1',
          revision: 1,
          title: 'Plan',
          summary: '',
          status: 'awaiting_review',
          actions: ['implement_interactive'],
          interactionId: 'pl-1',
        });
        store().upsertPermission(H.SESSION_ID, {
          interactionId: 'perm-1',
          toolName: 'bash',
          permissionType: 'bash',
          description: 'run',
          inputSummary: 'ls',
          permissionMode: 'default',
          status: 'pending',
        });
      });
    }
    const statusOf = (id: string) => {
      const b = stream()?.blocks.find(
        (x) => ('interactionId' in x && x.interactionId === id) || ('planId' in x && x.planId === id),
      );
      return b && 'status' in b ? b.status : undefined;
    };
    const openedAt = () => {
      const b = stream()?.blocks.find((x) => x.type === 'question');
      return b && b.type === 'question' ? b.openedAt ?? 0 : 0;
    };

    it('a poll fetched BEFORE the cards opened leaves them pending', () => {
      mount();
      openAllGates();
      H.setFakeData({ pendingInteractions: [], pendingFetchedAt: openedAt() - 1000 });
      expect(statusOf('q-1')).toBe('pending');
      expect(statusOf('p-1')).toBe('awaiting_review');
      expect(statusOf('perm-1')).toBe('pending');
    });

    it('a poll fetched AFTER the cards opened expires the ones it does not list', () => {
      mount();
      openAllGates();
      H.setFakeData({
        pendingInteractions: [{ interactionId: 'perm-1', kind: 'tool_permission', status: 'pending' }],
        pendingFetchedAt: openedAt() + 1000,
      });
      expect(statusOf('q-1')).toBe('expired');
      expect(statusOf('p-1')).toBe('expired');
      // Still listed by the server → still live.
      expect(statusOf('perm-1')).toBe('pending');
    });
  });

  it('plan approval applies optimistically: the card leaves "awaiting_review" before the mutation is sent (551-559)', async () => {
    mount();
    let statusWhenSent: string | undefined;
    H.mutations.decidePlan.mutate.mockImplementation(() => {
      const plan = stream()?.blocks.find((b) => b.type === 'plan');
      statusWhenSent = plan && plan.type === 'plan' ? plan.status : undefined;
    });
    act(() => {
      store().startPending(H.SESSION_ID, 'plan it');
      store().appendToken(H.SESSION_ID, 'Here is the plan');
      store().upsertPlan(H.SESSION_ID, {
        planId: 'p-9',
        revision: 1,
        title: 'Refactor plan',
        summary: 'Do things',
        status: 'awaiting_review',
        actions: ['implement_interactive'],
        interactionId: 'pl-9',
      });
    });
    await userEvent.click(await screen.findByRole('button', { name: /Approve & implement/ }));
    expect(H.mutations.decidePlan.mutate).toHaveBeenCalledWith({
      planId: 'p-9',
      approved: true,
      action: 'implement_interactive',
    });
    expect(statusWhenSent).toBe('approved');
  });
});

// ════════════════════════════════════════════════════════════════
describe('scroll (09 §5.4 Scroll; 1039-1048, 1489-1496)', () => {
  let metrics: ReturnType<typeof H.installScrollMetrics>;
  beforeEach(() => {
    metrics = H.installScrollMetrics(2000, 500);
  });
  afterEach(() => metrics.restore());

  function scroller(): Element {
    const el = metrics.scrollerOf(screen.getByText('msg #1'));
    if (!el) throw new Error('transcript scroll container was never pinned');
    return el;
  }

  it('re-pins on message-count / block-count / status changes, never on streamed text alone', () => {
    mount(H.makeChat(), H.makeConversation(2));
    const el = scroller();
    const pins = () => metrics.writesTo(el);
    const before = pins();

    act(() => store().startPending(H.SESSION_ID, 'go')); // status → pending
    expect(pins()).toBe(before + 1);

    act(() => store().appendToken(H.SESSION_ID, 'a')); // status → streaming, +1 block
    const afterFirstToken = pins();
    expect(afterFirstToken).toBe(before + 2);

    for (let i = 0; i < 5; i++) act(() => store().appendToken(H.SESSION_ID, ' more'));
    expect(pins()).toBe(afterFirstToken); // text grew, signature did not

    act(() => store().addToolCall(H.SESSION_ID, 'bash', { cmd: 'ls' }, 'call-1')); // +1 block
    expect(pins()).toBe(afterFirstToken + 1);
  });

  it('"Jump to latest" appears once the user scrolls up, and clicking it re-pins and hides it', async () => {
    mount(H.makeChat(), H.makeConversation(2));
    const el = scroller();
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).not.toBeInTheDocument();

    metrics.userScrollTo(el, 0); // 2000 - 0 - 500 ≥ 80 px from the bottom
    const jump = screen.getByRole('button', { name: /Jump to latest/ });
    const scrollTo = vi.fn();
    (el as HTMLElement).scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    await userEvent.click(jump);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 2000 }));
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).not.toBeInTheDocument();

    metrics.userScrollTo(el, 1450); // within 80 px of the bottom → pinned, no pill
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).not.toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
describe('completed-stream retention (03 §6.4; 1054-1092)', () => {
  const persisted = () => [H.makeMessage('user', 'do it'), H.makeMessage('assistant', 'done it')];

  function completeTurn(extra?: () => void) {
    act(() => {
      store().startPending(H.SESSION_ID, 'do it');
      store().appendToken(H.SESSION_ID, 'done it');
      extra?.();
      store().completeStream(H.SESSION_ID);
    });
  }

  it('clears the completed stream once history holds the turn prompt AND a later assistant reply', () => {
    mount(H.makeChat(), persisted());
    completeTurn();
    expect(stream()?.status).toBe('idle');
    expect(stream()?.blocks).toHaveLength(0);
  });

  it('keeps it while history has the prompt but no reply yet', () => {
    mount(H.makeChat(), [H.makeMessage('user', 'do it')]);
    completeTurn();
    expect(stream()?.status).toBe('complete');
  });

  it('keeps it while the stream holds a widget block', () => {
    mount(H.makeChat(), persisted());
    completeTurn(() =>
      store().addWidget(H.SESSION_ID, {
        instanceId: 'w-inline',
        descriptorId: 'd',
        extensionId: 'e',
        component: 'Counter',
        surface: 'inline',
        assetsBase: '',
        entry: '',
        props: {},
        status: 'active',
      }),
    );
    expect(stream()?.status).toBe('complete');
  });

  it('keeps it while an orchestrator worker is still running', () => {
    mount(H.makeChat(), persisted());
    completeTurn(() =>
      store().applyEffects([
        { op: 'upsertBackgroundTask', key: H.SESSION_ID, task: { taskId: 'w-1', taskName: 'Worker', status: 'running' } },
      ]),
    );
    expect(stream()?.status).toBe('complete');
    expect(stream()?.blocks.some((b) => b.type === 'background_task')).toBe(true);
  });

  it('clears it once that worker has settled', () => {
    mount(H.makeChat(), persisted());
    completeTurn(() =>
      store().applyEffects([
        { op: 'upsertBackgroundTask', key: H.SESSION_ID, task: { taskId: 'w-1', taskName: 'Worker', status: 'completed' } },
      ]),
    );
    expect(stream()?.status).toBe('idle');
  });
});

// ════════════════════════════════════════════════════════════════
describe('canRewind = isChatActive && !isCopilotWorking (03 §6.4; 894, 1412)', () => {
  const rewindable = () => [
    H.makeMessage('user', 'first', { metadata: { turnId: 't1' } }),
    H.makeMessage('assistant', 'reply'),
  ];
  const rewindButton = () => screen.getByTestId('rewind-button');

  it('enabled on an active, idle chat', () => {
    mount(H.makeChat(), rewindable());
    expect(rewindButton()).toBeEnabled();
  });

  it('disabled while a turn is pending or streaming, enabled again when it completes', () => {
    mount(H.makeChat(), rewindable());
    act(() => store().startPending(H.SESSION_ID, 'next'));
    expect(within(screen.getByText('first').closest('[data-chat-row]') as HTMLElement).getByTestId('rewind-button')).toBeDisabled();
    act(() => store().appendToken(H.SESSION_ID, 'x'));
    expect(rewindButton()).toBeDisabled();
    act(() => store().completeStream(H.SESSION_ID));
    expect(rewindButton()).toBeEnabled();
  });

  it('disabled on an archived chat', () => {
    mount(H.makeChat({ status: 'archived' }), rewindable());
    expect(rewindButton()).toBeDisabled();
  });
});
