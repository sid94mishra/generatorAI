// ────────────────────────────────────────────────────────────────
// EventBus tests
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus, type ISessionEventStore } from '../src/events/EventBus.js';
import type { AgentEvent, PersistedEvent } from '@generatorai/shared';

/** A durable store that records what it was asked to commit. */
function fakeStore(overrides: Partial<ISessionEventStore> = {}): ISessionEventStore & {
  appended: Array<{ sessionId: string; kind: string }>;
  deleted: string[];
} {
  const appended: Array<{ sessionId: string; kind: string }> = [];
  const deleted: string[] = [];
  let seq = 0;
  return {
    appended,
    deleted,
    append: async (sessionId, event) => {
      appended.push({ sessionId, kind: event.kind });
      seq += 1;
      return { seq, id: seq * 10 };
    },
    replaySessionEvents: async () => [],
    deleteSessionEvents: async (sessionId) => {
      deleted.push(sessionId);
    },
    ...overrides,
  };
}

describe('EventBus durability contract (EVT-01)', () => {
  it('commits to the durable store before broadcasting', async () => {
    const order: string[] = [];
    const store = fakeStore({
      append: async (_sessionId, event) => {
        order.push(`append:${event.kind}`);
        return { seq: 1, id: 1 };
      },
    });
    const bus = new EventBus();
    bus.setEventStore(store);
    bus.subscribe('s1', (e) => order.push(`broadcast:${e.kind}`));

    await bus.emit('s1', { kind: 'session.created', data: {} });

    expect(order).toEqual(['append:session.created', 'broadcast:session.created']);
  });

  it('suppresses the broadcast when the durable append fails', async () => {
    const store = fakeStore({
      append: async () => {
        throw new Error('disk full');
      },
    });
    const bus = new EventBus();
    bus.setEventStore(store);
    const handler = vi.fn();
    bus.subscribe('s1', handler);

    await bus.emit('s1', { kind: 'session.created', data: {} });

    // A live subscriber must never see an event replay cannot return.
    expect(handler).not.toHaveBeenCalled();
    expect(bus.getPersistFailures('s1')).toHaveLength(1);
  });

  it('takes its sequence numbers from the store, so replay shares one space', async () => {
    const store = fakeStore();
    const bus = new EventBus();
    bus.setEventStore(store);
    const seen: number[] = [];
    bus.subscribe('s1', (e) => seen.push(e.sequenceId));

    await bus.emit('s1', { kind: 'session.created', data: {} });
    await bus.emit('s1', { kind: 'session.completed', data: {} });

    expect(seen).toEqual([1, 2]);
  });

  it('deletes durable rows when a session is deleted', async () => {
    const store = fakeStore();
    const bus = new EventBus();
    bus.setEventStore(store);

    await bus.deleteSessionEvents('s1');

    // Leaving prompts and tool results behind for the retention TTL after a
    // user deletes a chat is a data-deletion bug, not a cleanup shortcut.
    expect(store.deleted).toEqual(['s1']);
  });

  it('does not suppress harness.session_info, which carries plan and subagent state', async () => {
    const store = fakeStore();
    const bus = new EventBus();
    bus.setEventStore(store);

    const persisted = await bus.emit('s1', {
      kind: 'harness.session_info',
      data: { infoType: 'unresolved_variables' },
    } as AgentEvent);

    expect(store.appended).toHaveLength(1);
    expect(persisted.sequenceId).toBeGreaterThan(0);
  });
});

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  it('should emit and deliver events to session subscribers', async () => {
    const handler = vi.fn();
    eventBus.subscribe('s1', handler);

    await eventBus.emit('s1', { kind: 'session.created', data: { sessionId: 's1' } });

    expect(handler).toHaveBeenCalledOnce();
    const event: PersistedEvent = handler.mock.calls[0][0];
    expect(event.sessionId).toBe('s1');
    expect(event.kind).toBe('session.created');
    expect(event.sequenceId).toBe(1);
  });

  it('should increment sequence numbers per session', async () => {
    const handler = vi.fn();
    eventBus.subscribe('s1', handler);

    await eventBus.emit('s1', { kind: 'session.created', data: {} });
    await eventBus.emit('s1', { kind: 'session.completed', data: {} });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0].sequenceId).toBe(1);
    expect(handler.mock.calls[1][0].sequenceId).toBe(2);
  });

  it('should maintain separate sequences per session', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    eventBus.subscribe('s1', h1);
    eventBus.subscribe('s2', h2);

    await eventBus.emit('s1', { kind: 'session.created', data: {} });
    await eventBus.emit('s2', { kind: 'session.created', data: {} });
    await eventBus.emit('s1', { kind: 'session.completed', data: {} });

    expect(h1.mock.calls[0][0].sequenceId).toBe(1);
    expect(h1.mock.calls[1][0].sequenceId).toBe(2);
    expect(h2.mock.calls[0][0].sequenceId).toBe(1);
  });

  it('should deliver to subscribeAll listeners', async () => {
    const allHandler = vi.fn();
    eventBus.subscribeAll(allHandler);

    await eventBus.emit('s1', { kind: 'session.created', data: {} });
    await eventBus.emit('s2', { kind: 'session.created', data: {} });

    expect(allHandler).toHaveBeenCalledTimes(2);
  });

  it('should unsubscribe correctly', async () => {
    const handler = vi.fn();
    const unsub = eventBus.subscribe('s1', handler);

    await eventBus.emit('s1', { kind: 'session.created', data: {} });
    unsub();
    await eventBus.emit('s1', { kind: 'session.completed', data: {} });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('should emit global events to global subscribers', async () => {
    const handler = vi.fn();
    eventBus.subscribeGlobal(handler);

    await eventBus.emitGlobal({ kind: 'harness.session_start', data: {} });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('should not deliver session events to other sessions', async () => {
    const handler = vi.fn();
    eventBus.subscribe('s2', handler);

    await eventBus.emit('s1', { kind: 'session.created', data: {} });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should persist events when eventRepo is provided', async () => {
    const mockRepo = {
      insert: vi.fn().mockResolvedValue(42),
      getBySessionId: vi.fn(),
      getAfterSequence: vi.fn(),
      getMaxSequencePerSession: vi.fn().mockResolvedValue([]),
      deleteBySession: vi.fn(),
      persistGlobal: vi.fn().mockResolvedValue({ id: 1, kind: 'test', data: {}, sessionId: '__global__', sequenceId: 0, timestamp: Date.now() }),
    };

    // P1-4 — the legacy `events` table is off by default now; this test is
    // specifically about that table's write, so it opts in.
    const persistentBus = new EventBus(mockRepo, undefined, undefined, { legacyEventLog: true });
    await persistentBus.emit('s1', { kind: 'session.created', data: {} });

    expect(mockRepo.insert).toHaveBeenCalledOnce();
  });

  it('should restore counters from repo', async () => {
    const mockRepo = {
      insert: vi.fn().mockResolvedValue(100),
      getBySessionId: vi.fn(),
      getAfterSequence: vi.fn(),
      getMaxSequencePerSession: vi.fn().mockResolvedValue([
        { sessionId: 's1', maxSeq: 50 },
        { sessionId: 's2', maxSeq: 25 },
      ]),
      deleteBySession: vi.fn(),
      persistGlobal: vi.fn(),
    };

    const persistentBus = new EventBus(mockRepo);
    await persistentBus.restoreCounters();

    const handler = vi.fn();
    persistentBus.subscribe('s1', handler);
    await persistentBus.emit('s1', { kind: 'session.created', data: {} });

    // Should start from 51 (50 + 1)
    expect(handler.mock.calls[0][0].sequenceId).toBe(51);
  });

  // ── EVT-01: commit-then-broadcast ──
  it('EVT-01: should NOT broadcast to session subscribers when persistence fails after retry', async () => {
    const mockRepo = {
      insert: vi.fn().mockRejectedValue(new Error('disk full')),
      getBySessionId: vi.fn(),
      getAfterSequence: vi.fn(),
      getMaxSequencePerSession: vi.fn().mockResolvedValue([]),
      deleteBySession: vi.fn(),
      persistGlobal: vi.fn(),
    };
    const bus = new EventBus(mockRepo, undefined, undefined, { legacyEventLog: true });
    const handler = vi.fn();
    bus.subscribe('s1', handler);

    await bus.emit('s1', { kind: 'session.created', data: { sessionId: 's1' } });

    // Retry happened (2 calls) and broadcast suppressed (0 handler invocations)
    expect(mockRepo.insert).toHaveBeenCalledTimes(2);
    expect(handler).not.toHaveBeenCalled();
    expect(bus.getPersistFailures('s1')).toHaveLength(1);
  });

  it('EVT-01: should NOT broadcast global subscribers when persistence fails', async () => {
    const mockRepo = {
      insert: vi.fn().mockRejectedValue(new Error('boom')),
      getBySessionId: vi.fn(),
      getAfterSequence: vi.fn(),
      getMaxSequencePerSession: vi.fn().mockResolvedValue([]),
      deleteBySession: vi.fn(),
      persistGlobal: vi.fn(),
    };
    const allocator = { allocate: vi.fn().mockResolvedValue(1) };
    const bus = new EventBus(mockRepo, undefined, allocator, { legacyEventLog: true });
    const handler = vi.fn();
    bus.subscribeGlobal(handler);

    await bus.emitGlobal({ kind: 'harness.session_start', data: {} });

    expect(handler).not.toHaveBeenCalled();
  });

  // ── EVT-02: subscriber error bubble-up ──
  it('EVT-02: should catch subscriber exceptions and keep delivering to peer subscribers', async () => {
    const good = vi.fn();
    const bad = vi.fn(() => {
      throw new Error('subscriber explosion');
    });
    eventBus.subscribe('s1', bad, 'bad-subscriber');
    eventBus.subscribe('s1', good, 'good-subscriber');

    await eventBus.emit('s1', { kind: 'session.created', data: { sessionId: 's1' } });

    expect(bad).toHaveBeenCalledOnce();
    expect(good).toHaveBeenCalledOnce(); // peer still receives the event
  });

  it('EVT-02: should emit subscriber.error meta-event when a handler throws', async () => {
    const bus = new EventBus();
    const globalEvents: Array<{ kind: string; data: unknown }> = [];
    bus.subscribeGlobal((evt) => {
      globalEvents.push({ kind: evt.kind, data: evt.data });
    });
    bus.subscribe(
      's1',
      () => {
        throw new Error('nope');
      },
      'throwing-subscriber',
    );

    await bus.emit('s1', { kind: 'session.created', data: { sessionId: 's1' } });

    // queueMicrotask defers the meta-emit — wait a tick
    await new Promise((r) => setTimeout(r, 0));

    const errs = globalEvents.filter((e) => e.kind === 'subscriber.error');
    expect(errs).toHaveLength(1);
    const data = errs[0]!.data as {
      subscriberName: string;
      sourceKind: string;
      error: string;
    };
    expect(data.subscriberName).toBe('throwing-subscriber');
    expect(data.sourceKind).toBe('session.created');
    expect(data.error).toBe('nope');
  });

  it('EVT-02: should NOT recurse when a subscriber.error handler itself throws', async () => {
    const bus = new EventBus();
    bus.subscribeGlobal(() => {
      throw new Error('handler of handlers is broken');
    });
    bus.subscribe(
      's1',
      () => {
        throw new Error('original');
      },
      'origin',
    );

    // No infinite loop, no unhandled rejection
    await bus.emit('s1', { kind: 'session.created', data: { sessionId: 's1' } });
    await new Promise((r) => setTimeout(r, 10));
    // If we got here, the recursion guard held.
    expect(true).toBe(true);
  });
});
