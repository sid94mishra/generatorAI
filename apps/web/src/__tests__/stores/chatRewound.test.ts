// ────────────────────────────────────────────────────────────────
// A rewound chat must not keep showing the turn it just erased.
//
// The live stream state is keyed by session, not by turn, so nothing about a
// `chat.rewound` event clears it on its own: the blocks of the last completed
// turn sit in the store until the transcript-cleanup timer fires. After a
// rewind those blocks describe a response the server no longer has, under a
// prompt that is no longer in the transcript — the page would render a reply
// to a message the user just deleted.
//
// The second half of the contract is the prompt: a conversation rewind hands
// it back for editing, and it reaches the composer through `rewindStore`.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MuxHandlers } from '@/platform/muxStream.js';

/** Captures the handler bundle `sseManager` registers, so a test can feed it. */
const registered: MuxHandlers[] = [];

vi.mock('@/platform/muxStream.js', () => ({
  openMultiplexedStream: (
    _scope: string,
    _id: string,
    handlers: MuxHandlers,
  ): { close: () => void } => {
    registered.push(handlers);
    return { close: () => {} };
  },
  resetMuxStreamForTests: () => {},
}));

const { connectChatSession, _resetForTests } = await import('@/stores/sseManager.js');
const { useStreamStore } = await import('@/stores/streamStore.js');
const { useConnectionStore } = await import('@/stores/connectionStore.js');
const { useChatStore } = await import('@/stores/chatStore.js');
const { useRewindStore } = await import('@/stores/rewindStore.js');
const { queryClient } = await import('@/providers/QueryProvider.js');

const SESSION = 'session-a';
const CHAT = 'chat-1';

function createMockPlatform() {
  return {
    baseUrl: 'http://localhost:3000',
    streamReplay: vi.fn(async () => []),
  } as unknown as Parameters<typeof connectChatSession>[2];
}

async function connectAndHydrate(): Promise<MuxHandlers> {
  connectChatSession(CHAT, SESSION, createMockPlatform());
  const handlers = registered[0];
  expect(handlers, 'sseManager did not subscribe a scope').toBeDefined();
  handlers!.onOpen?.();
  await vi.waitFor(() => {
    expect(useConnectionStore.getState().connections[SESSION]?.state).toBe('connected');
  });
  return handlers!;
}

function push(handlers: MuxHandlers, seq: number, kind: string, payload: Record<string, unknown>): void {
  handlers.onMessage?.({ lastEventId: String(seq), data: JSON.stringify({ kind, payload }) });
}

/** One completed turn, so the store holds blocks the rewind should drop. */
async function streamOneTurn(handlers: MuxHandlers): Promise<void> {
  push(handlers, 1, 'harness.user_message', { content: 'break the build', sessionId: SESSION });
  push(handlers, 2, 'harness.token', { text: 'On it.', sessionId: SESSION });
  push(handlers, 3, 'harness.idle', { sessionId: SESSION });
  await vi.waitFor(() => {
    const stream = useStreamStore.getState().streams[SESSION];
    expect(stream?.status).toBe('complete');
    expect(stream?.blocks.length).toBeGreaterThan(0);
  });
}

beforeEach(() => {
  registered.length = 0;
  _resetForTests();
  useStreamStore.setState({ streams: {} });
  useConnectionStore.setState({ connections: {} });
  useChatStore.setState({ chatSessionMap: {} });
  useRewindStore.setState({ pending: null });
  queryClient.clear();
});

afterEach(() => {
  _resetForTests();
  vi.restoreAllMocks();
});

describe('chat.rewound', () => {
  it('drops the live stream blocks of the turns the rewind erased', async () => {
    const handlers = await connectAndHydrate();
    await streamOneTurn(handlers);

    push(handlers, 4, 'chat.rewound', {
      sessionId: SESSION,
      chatId: CHAT,
      turnId: 'turn-1',
      scope: 'all',
      prompt: 'break the build',
      conversation: 'native',
    });

    await vi.waitFor(() => {
      expect(useStreamStore.getState().streams[SESSION]?.blocks ?? []).toHaveLength(0);
    });
    expect(useStreamStore.getState().streams[SESSION]?.text ?? '').toBe('');
  });

  it('offers the rewound prompt back to the composer', async () => {
    const handlers = await connectAndHydrate();
    await streamOneTurn(handlers);

    push(handlers, 4, 'chat.rewound', {
      sessionId: SESSION,
      chatId: CHAT,
      turnId: 'turn-1',
      scope: 'conversation',
      prompt: 'break the build',
      conversation: 'synthetic',
    });

    await vi.waitFor(() => {
      const pending = useRewindStore.getState().pending;
      expect(pending?.chatId).toBe(CHAT);
      expect(pending?.prompt).toBe('break the build');
    });
  });

  it('leaves the transcript and the composer alone for a code-only rewind', async () => {
    const handlers = await connectAndHydrate();
    await streamOneTurn(handlers);
    const before = useStreamStore.getState().streams[SESSION]?.blocks.length ?? 0;

    push(handlers, 4, 'chat.rewound', {
      sessionId: SESSION,
      chatId: CHAT,
      turnId: 'turn-1',
      scope: 'code',
      prompt: 'break the build',
      conversation: 'skipped',
    });

    // Nothing to wait for — assert it stayed put across a frame instead.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useStreamStore.getState().streams[SESSION]?.blocks.length ?? 0).toBe(before);
    expect(useRewindStore.getState().pending).toBeNull();
  });

  it('resolves the stream key through the chat → session map', async () => {
    // The connection's own session is what a chat-scope event carries, but a
    // rewound chat is identified by chatId: the map is the only link back.
    const handlers = await connectAndHydrate();
    useChatStore.getState().registerChat(CHAT, SESSION);
    await streamOneTurn(handlers);

    push(handlers, 4, 'chat.rewound', {
      sessionId: 'some-other-session',
      chatId: CHAT,
      turnId: 'turn-1',
      scope: 'all',
      conversation: 'native',
    });

    await vi.waitFor(() => {
      expect(useStreamStore.getState().streams[SESSION]?.blocks ?? []).toHaveLength(0);
    });
  });
});
