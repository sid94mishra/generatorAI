// ────────────────────────────────────────────────────────────────
// EventBus tests
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../src/events/EventBus.js';
import type { AgentEvent, PersistedEvent } from '@generatorai/shared';

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

    const persistentBus = new EventBus(mockRepo);
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
    const bus = new EventBus(mockRepo);
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
    const bus = new EventBus(mockRepo, undefined, allocator);
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
