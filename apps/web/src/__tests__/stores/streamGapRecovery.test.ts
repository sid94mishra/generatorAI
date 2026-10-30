// ────────────────────────────────────────────────────────────────
// U-39 — a dropped frame of any age is refilled exactly, and a chat opens from its latest turn.
//
// The seen set used to be pruned to 2000 below the tip, so a hole older than that was skipped for good ("some
// events could not be recovered"), and a dropped frame in a busy stream waited for the 20 s stall watchdog. Only
// events the server itself no longer has are lost now — and still reported (N4).
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MuxHandlers } from '@/platform/muxStream.js';
import { SequenceLedger } from '@/stores/sequenceLedger.js';

const registered: MuxHandlers[] = [];
vi.mock('@/platform/muxStream.js', () => ({
  openMultiplexedStream: (_scope: string, _id: string, handlers: MuxHandlers) => {
    registered.push(handlers);
    return { close: () => {} };
  },
  resetMuxStreamForTests: () => {},
}));
vi.mock('@/utils/hydrateWidgets.js', () => ({ hydrateWidgetsForChat: vi.fn(async () => {}) }));

const { connectChatSession, _resetForTests } = await import('@/stores/sseManager.js');
const { useConnectionStore } = await import('@/stores/connectionStore.js');
const { useStreamStore } = await import('@/stores/streamStore.js');

const SESSION = 'session-gap';
const CHAT = 'chat-gap';

type Row = { id: number; scope: string; scopeId: string; seq: number; kind: string; payload: unknown; ts: number };
const row = (seq: number, kind = 'harness.unknown'): Row => ({ id: seq, scope: 'chat', scopeId: CHAT, seq, kind, payload: { sessionId: SESSION }, ts: seq });

/** A server holding `stored` sequences; replay pages them like `/api/stream/replay`. */
function platformWith(stored: (seq: number) => boolean, tip: () => number, prelude?: { turnStartSeq: number; rows: Row[] }) {
  return {
    baseUrl: 'http://localhost:3000',
    streamReplay: vi.fn(async (_scope: string, _id: string, afterSeq: number, limit = 500) => {
      const out: Row[] = [];
      for (let seq = afterSeq + 1; seq <= tip() && out.length < limit; seq++) if (stored(seq)) out.push(row(seq));
      return out;
    }),
    streamChatPrelude: vi.fn(async () => prelude ?? { turnStartSeq: 0, rows: [] }),
  } as unknown as Parameters<typeof connectChatSession>[2] & {
    streamReplay: ReturnType<typeof vi.fn>;
    streamChatPrelude: ReturnType<typeof vi.fn>;
  };
}

async function connect(platform: Parameters<typeof connectChatSession>[2]): Promise<MuxHandlers> {
  connectChatSession(CHAT, SESSION, platform);
  const handlers = registered[0]!;
  handlers.onOpen?.();
  await vi.waitFor(() => expect(useConnectionStore.getState().connections[SESSION]?.state).toBe('connected'));
  return handlers;
}

const push = (h: MuxHandlers, seq: number) =>
  h.onMessage?.({ lastEventId: String(seq), data: JSON.stringify({ kind: 'harness.unknown', payload: { sessionId: SESSION } }) });

const lost = () => useConnectionStore.getState().getConnection(SESSION).unrecoverableEvents;

beforeEach(() => {
  registered.length = 0;
  _resetForTests();
  useStreamStore.setState({ streams: {} });
  useConnectionStore.setState({ connections: {} });
});
afterEach(() => _resetForTests());

describe('SequenceLedger', () => {
  it('tracks the frontier, holes and out-of-order arrivals as ranges', () => {
    const l = new SequenceLedger();
    for (const s of [1, 2, 3, 5, 6, 4, 9]) l.add(s);
    expect(l.frontier).toBe(6);
    expect(l.max).toBe(9);
    expect(l.missing).toBe(2);
    expect(l.has(4)).toBe(true);
    expect(l.has(7)).toBe(false);
    l.addRange(7, 8);
    expect(l.frontier).toBe(9);
    expect(l.missing).toBe(0);
  });

  it('gives up the oldest holes only past 512 separate ones, and says how many', () => {
    const l = new SequenceLedger();
    let given = 0;
    for (let s = 1; s <= 2 * 600; s += 2) given += l.add(s);
    expect(given).toBeGreaterThan(0);
    expect(l.has(2)).toBe(true);
    expect(l.max).toBe(1199);
  });
});

describe('gap recovery (U-39)', () => {
  it('refills a frame dropped 3000 events ago exactly, without waiting for the stream to go quiet', async () => {
    let tip = 0;
    const platform = platformWith(() => true, () => tip);
    const h = await connect(platform);
    for (let seq = 1; seq <= 3000; seq++) {
      tip = seq;
      if (seq !== 7) push(h, seq);
    }
    await vi.waitFor(() => expect(platform.streamReplay).toHaveBeenCalledWith('chat', CHAT, 6, 500));
    await vi.waitFor(() => expect(platform.streamReplay.mock.calls.length).toBeGreaterThan(1));
    expect(lost()).toBe(0);
  });

  it('reports only what the server no longer has, once', async () => {
    let tip = 0;
    const swept = new Set([7, 8, 9]);
    const platform = platformWith((s) => !swept.has(s), () => tip);
    const h = await connect(platform);
    for (let seq = 1; seq <= 200; seq++) {
      tip = seq;
      if (!swept.has(seq)) push(h, seq);
    }
    await vi.waitFor(() => expect(lost()).toBe(3));
    const fills = platform.streamReplay.mock.calls.length;
    for (let seq = 201; seq <= 260; seq++) {
      tip = seq;
      push(h, seq);
    }
    expect(platform.streamReplay.mock.calls.length).toBe(fills);
  });
});

describe('opening a chat (U-39)', () => {
  it('replays from the latest turn plus the prelude rows, not from the first event', async () => {
    const platform = platformWith(() => true, () => 905, { turnStartSeq: 900, rows: [row(5, 'harness.widget.rendered')] });
    await connect(platform);
    expect(platform.streamChatPrelude).toHaveBeenCalledWith(CHAT);
    expect(platform.streamReplay.mock.calls[0]?.[2]).toBe(899);
    expect(platform.streamReplay.mock.calls.every((c) => c[2] >= 899)).toBe(true);
  });
});
