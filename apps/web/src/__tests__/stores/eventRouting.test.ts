// ────────────────────────────────────────────────────────────────
// W26 — one event-routing implementation.
//
// The acceptance criterion is literally "one event-routing implementation",
// and there were three: web's ~1000-line switch in `sseManager.ts`, mobile's
// `StreamEventRouter`, and the CLI's `applyEvents`. Web's is gone; this test
// is what stops it coming back.
//
// The parity assertion is the load-bearing one. It runs the SAME event
// sequence twice — once through the live web pipeline (mux frame → sseManager
// → Zustand) and once through client-core's router + applier on their own —
// and requires the resulting block models to be identical. A surface that
// re-grows its own routing diverges the moment its copy drifts, which is
// exactly how the three implementations got out of step in the first place.
//
// The ordering assertion pins the one behaviour CLAUDE.md calls load-bearing:
// a thinking run that ENDED before a token must be committed first, or the
// transcript silently reorders.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyStreamEffects,
  StreamEventRouter,
  type StreamsRecord,
} from '@generatorai/client-core';
import { WEB_CAPABILITIES } from '@generatorai/shared';

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
const { queryClient } = await import('@/providers/QueryProvider.js');

const SESSION = 'session-a';
const CHAT = 'chat-1';

/** The turn every assertion below replays. */
const EVENTS: Array<{ kind: string; data: Record<string, unknown> }> = [
  { kind: 'harness.user_message', data: { content: 'explain the router', sessionId: SESSION } },
  { kind: 'harness.reasoning_delta', data: { text: 'weighing options', sessionId: SESSION } },
  { kind: 'harness.token', data: { text: 'The router ', sessionId: SESSION } },
  { kind: 'harness.token', data: { text: 'is shared.', sessionId: SESSION } },
  { kind: 'harness.tool_start', data: { tool: 'read', args: { path: 'a.ts' }, callId: 'c1', sessionId: SESSION } },
  { kind: 'harness.tool_complete', data: { callId: 'c1', result: 'ok', sessionId: SESSION } },
  { kind: 'harness.token', data: { text: ' Done.', sessionId: SESSION } },
  { kind: 'harness.idle', data: { sessionId: SESSION } },
];

function createMockPlatform() {
  return {
    baseUrl: 'http://localhost:3000',
    streamReplay: vi.fn(async () => []),
  } as unknown as Parameters<typeof connectChatSession>[2];
}

/**
 * Connect, then let the mux report the scope as active.
 *
 * `onOpen` is what `muxStream` calls from the server's `hello`/`subs` frame,
 * and W26 hydrates off it — the snapshot is deliberately NOT taken until the
 * server has confirmed it is buffering from our cursor. Simulating it here is
 * the healthy path; `sseManager.test.ts` covers the fallback for when `hello`
 * never arrives.
 */
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

/** Feed one frame in the `{lastEventId, data}` shape `parseFrame` expects. */
function push(handlers: MuxHandlers, seq: number, kind: string, payload: Record<string, unknown>): void {
  handlers.onMessage?.({ lastEventId: String(seq), data: JSON.stringify({ kind, payload }) });
}

/** What client-core alone produces for the same sequence. */
function referenceBlocks(): StreamsRecord {
  const router = new StreamEventRouter({ blockDelivery: WEB_CAPABILITIES.highLatencyBlockDelivery });
  let streams: StreamsRecord = {};
  for (const event of EVENTS) {
    streams = applyStreamEffects(streams, router.handle(SESSION, event));
  }
  return applyStreamEffects(streams, router.drainFinal());
}

beforeEach(() => {
  registered.length = 0;
  _resetForTests();
  useStreamStore.setState({ streams: {} });
  useConnectionStore.setState({ connections: {} });
  useChatStore.setState({ chatSessionMap: {} });
  queryClient.clear();
});

afterEach(() => {
  _resetForTests();
  vi.restoreAllMocks();
});

describe('W26 — web routes every event through the shared router', () => {
  it('builds the same block model client-core builds on its own', async () => {
    // The initial REST replay has to settle before live frames are applied;
    // until then they are buffered on purpose.
    const handlers = await connectAndHydrate();

    EVENTS.forEach((event, i) => push(handlers, i + 1, event.kind, event.data));

    // Text is buffered and released on a frame boundary (W26's frame-aligned
    // drain), so the assertion waits for a frame rather than assuming one.
    await vi.waitFor(() => {
      const stream = useStreamStore.getState().streams[SESSION];
      expect(stream?.status).toBe('complete');
      expect(stream?.blocks.length).toBeGreaterThan(0);
    });

    const expected = referenceBlocks()[SESSION];
    const actual = useStreamStore.getState().streams[SESSION];
    expect(actual?.blocks).toEqual(expected?.blocks);
    expect(actual?.text).toBe(expected?.text);
    expect(actual?.thinkingText).toBe(expected?.thinkingText);
  });

  it('preserves thinking → token order across the buffer boundary', async () => {
    const handlers = await connectAndHydrate();

    // A thinking run, then prose. The naive implementation buffers both and
    // flushes on a timer, which commits the token FIRST and silently reorders
    // the transcript.
    push(handlers, 1, 'harness.reasoning_delta', { text: 'first I think', sessionId: SESSION });
    push(handlers, 2, 'harness.token', { text: 'then I answer', sessionId: SESSION });
    push(handlers, 3, 'harness.idle', { sessionId: SESSION });

    await vi.waitFor(() => {
      expect(useStreamStore.getState().streams[SESSION]?.status).toBe('complete');
    });

    const blocks = useStreamStore.getState().streams[SESSION]?.blocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(['thinking', 'text']);
  });

  it('invalidates the chat message list a turn produced', async () => {
    // The reverse lookup sessionId → chatId is what turns a session-scoped
    // event into the right chat's query key.
    const handlers = await connectAndHydrate();

    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    push(handlers, 1, 'harness.message_complete', { content: 'answer', sessionId: SESSION });

    await vi.waitFor(() => {
      expect(
        spy.mock.calls.some(([args]) =>
          JSON.stringify((args as { queryKey: unknown[] }).queryKey) ===
          JSON.stringify(['chat-messages', CHAT]),
        ),
        'the turn did not invalidate its chat message list',
      ).toBe(true);
    });
  });

  // ── The three behaviours web's own copy of the routing did not have ────
  //
  // Each of these was already correct in client-core and wrong in web, which
  // is the concrete cost of having had two implementations. They fail against
  // the pre-unification `sseManager`.

  it('does not wipe an in-flight turn when its user message is replayed', async () => {
    const handlers = await connectAndHydrate();

    push(handlers, 1, 'harness.user_message', { content: 'the question', sessionId: SESSION });
    push(handlers, 2, 'harness.token', { text: 'partial answer', sessionId: SESSION });
    await vi.waitFor(() => {
      expect(useStreamStore.getState().streams[SESSION]?.blocks).toHaveLength(1);
    });

    // Every gap fill after a dropped frame replays the user message. Web's own
    // routing called the raw reset here, deleting the answer already on screen;
    // client-core's replay-safe start leaves a same-prompt turn alone.
    push(handlers, 3, 'harness.user_message', { content: 'the question', sessionId: SESSION });
    push(handlers, 4, 'harness.token', { text: ' continues', sessionId: SESSION });
    push(handlers, 5, 'harness.idle', { sessionId: SESSION });

    await vi.waitFor(() => {
      expect(useStreamStore.getState().streams[SESSION]?.status).toBe('complete');
    });
    expect(useStreamStore.getState().streams[SESSION]?.text).toBe('partial answer continues');
  });

  it('settles a turn the user stopped (harness.cancelled)', async () => {
    const handlers = await connectAndHydrate();

    push(handlers, 1, 'harness.user_message', { content: 'go', sessionId: SESSION });
    push(handlers, 2, 'harness.token', { text: 'starting', sessionId: SESSION });
    // W13's semantic `cancelled`. Web's routing had no case for it at all, so
    // a stopped turn stayed `streaming` forever and the composer stayed
    // disabled until something else happened to complete the stream.
    push(handlers, 3, 'harness.cancelled', { sessionId: SESSION });

    await vi.waitFor(() => {
      expect(useStreamStore.getState().streams[SESSION]?.status).toBe('complete');
    });
    // The partial answer is kept — stopping is how you say "that is enough".
    expect(useStreamStore.getState().streams[SESSION]?.text).toBe('starting');
  });

  it('refreshes the background-task list when a worker changes state', async () => {
    const handlers = await connectAndHydrate();

    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    // Web's routing had no case for these, so an orchestrator's task panel
    // only ever updated on its own 2.5 s poll.
    push(handlers, 1, 'chat.background_task.completed', { chatId: CHAT, sessionId: SESSION });

    await vi.waitFor(() => {
      expect(
        spy.mock.calls.some(([args]) =>
          JSON.stringify((args as { queryKey: unknown[] }).queryKey) ===
          JSON.stringify(['background-tasks', CHAT]),
        ),
        'a background-task event did not refresh the task list',
      ).toBe(true);
    });
  });

  it('routes a workflow stage event to its own stream key, not the session', async () => {
    const handlers = await connectAndHydrate();

    // Per-EVENT stage attribution: with a shared mutable "current stage",
    // events from stage A land in stage B's transcript whenever B starts first.
    push(handlers, 1, 'harness.tool_start', {
      tool: 'grep',
      callId: 'x',
      stageRunId: 'stage-9',
      sessionId: SESSION,
    });

    await vi.waitFor(() => {
      expect(useStreamStore.getState().streams['stageRun:stage-9']?.blocks).toHaveLength(1);
    });
    expect(useStreamStore.getState().streams[SESSION]).toBeUndefined();
  });
});
