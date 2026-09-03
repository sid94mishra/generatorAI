import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentHostResponse, AgentEventNotification, SessionEndedNotification } from '@generatorai/shared';
import { AgentHostServer } from '../AgentHostServer.js';
import type { RuntimeSupervisor } from '../RuntimeSupervisor.js';
import { FakeHarness, idleEvent, tokenEvent, recordingLogger } from './helpers/fakeHarness.js';

/** Let queued setImmediate work (the pump) run to completion. */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}

interface Sent {
  msg: AgentHostResponse;
  /** Serialized byte length — the cost this frame imposes on the one IPC channel. */
  bytes: number;
}

/** Test transport. Records every frame and can simulate a full channel buffer. */
function makeTransport() {
  const sent: Sent[] = [];
  const pendingCallbacks: Array<(err: Error | null) => void> = [];
  let blockAfter = Number.POSITIVE_INFINITY;
  let writes = 0;

  let throwsLeft = 0;
  let asyncErrorsLeft = 0;

  const send = (msg: AgentHostResponse, callback: (err: Error | null) => void): boolean => {
    if (throwsLeft > 0) {
      throwsLeft--;
      // What a real `process.send` does when the IPC channel has gone away:
      // it throws synchronously, so the frame was NEVER handed to the OS.
      throw new Error('channel closed');
    }
    if (asyncErrorsLeft > 0) {
      asyncErrorsLeft--;
      // Accepted by the channel, then reported as failed on the flush
      // callback. Deliberately NOT recorded in `sent`: it never arrived.
      setImmediate(() => callback(new Error('write failed')));
      return false;
    }
    sent.push({ msg, bytes: JSON.stringify(msg).length });
    writes++;
    if (writes >= blockAfter) {
      // Channel buffer full: the frame is accepted but not flushed yet.
      pendingCallbacks.push(callback);
      return false;
    }
    setImmediate(() => callback(null));
    return true;
  };

  return {
    send,
    sent,
    events: () => sent.filter((s) => s.msg.type === 'agent_event').map((s) => s.msg as AgentEventNotification),
    ended: () => sent.filter((s) => s.msg.type === 'session_ended').map((s) => s.msg as SessionEndedNotification),
    setBlockAfter: (n: number) => {
      blockAfter = n;
    },
    /** The next `n` writes throw synchronously, as a closed IPC channel does. */
    throwNext: (n: number) => {
      throwsLeft = n;
    },
    /** The next `n` writes are accepted and then fail on their flush callback. */
    failAsyncNext: (n: number) => {
      asyncErrorsLeft = n;
    },
    /** Simulate the OS flushing the channel. */
    drain: () => {
      blockAfter = Number.POSITIVE_INFINITY;
      const cbs = pendingCallbacks.splice(0, pendingCallbacks.length);
      for (const cb of cbs) cb(null);
    },
    writeCount: () => writes,
  };
}

/** Text of the streamed `harness.token` frames, in delivery order. */
function tokenTexts(events: AgentEventNotification[]): Array<string | undefined> {
  return events
    .filter((e) => (e.event as { kind?: string }).kind === 'harness.token')
    .map((e) => (e.event as { data?: { text?: string } }).data?.text);
}

let reqCounter = 0;
const nextReqId = () => `req-${++reqCounter}`;

describe('AgentHostServer (W12)', () => {
  let harness: FakeHarness;
  let logger: ReturnType<typeof recordingLogger>;
  let transport: ReturnType<typeof makeTransport>;
  let server: AgentHostServer;

  beforeEach(() => {
    harness = new FakeHarness();
    logger = recordingLogger();
    transport = makeTransport();
    server = new AgentHostServer({ logger, send: transport.send });
    server.registerHarness(harness.asHarness());
  });

  async function spawn(sessionId: string): Promise<void> {
    server.onMessage({ type: 'spawn_session', reqId: nextReqId(), sessionId, params: {} });
    await flush();
  }

  function conversationFor(index: number): string {
    return [...harness.conversations][index]!;
  }

  it('rejects messages that are not AgentHostRequests instead of falling through', () => {
    // Regression: the guard used to accept ANY object with a string `type`,
    // which made the "unrecognised IPC message" branch unreachable.
    server.onMessage({ type: 'not_a_real_request', reqId: 'x' });
    server.onMessage({ type: 'ping' }); // no reqId
    server.onMessage(null);
    expect(logger.lines.filter((l) => l.includes('unrecognised IPC message')).length).toBe(3);
    expect(transport.sent).toHaveLength(0);
  });

  it('acks a spawn and streams events with per-session sequence numbers', async () => {
    await spawn('s1');
    expect(transport.sent[0]?.msg).toMatchObject({ type: 'ack', ok: true });

    harness.emit(conversationFor(0), tokenEvent('hello'));
    harness.emit(conversationFor(0), tokenEvent('world'));
    await flush();

    const events = transport.events();
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(events.every((e) => e.sessionId === 's1')).toBe(true);
  });

  // ── W12 acceptance criterion, measured ─────────────────────────────────────
  it('a multi-megabyte tool result in one session does not delay another session tokens', async () => {
    await spawn('big');
    await spawn('small');
    const bigConv = conversationFor(0);
    const smallConv = conversationFor(1);

    const HUGE = 'x'.repeat(4 * 1024 * 1024); // 4 MB per frame
    const FRAMES = 20;

    for (let i = 0; i < FRAMES; i++) {
      harness.emit(bigConv, {
        kind: 'harness.tool_complete',
        data: { tool: 'read', result: HUGE, callId: `c${i}` },
        timestamp: new Date().toISOString(),
      } as never);
    }
    harness.emit(smallConv, tokenEvent('hi'));
    await flush(FRAMES * 2 + 10);

    const events = transport.events();
    const smallIndex = events.findIndex((e) => e.sessionId === 'small');
    expect(smallIndex).toBeGreaterThanOrEqual(0);

    // Measured: bytes written to the shared IPC channel BEFORE the small
    // session's token, versus the total the big session queued.
    const bytesBeforeSmall = transport.sent
      .slice(0, transport.sent.findIndex((s) => s.msg.type === 'agent_event' && (s.msg as AgentEventNotification).sessionId === 'small'))
      .filter((s) => s.msg.type === 'agent_event')
      .reduce((sum, s) => sum + s.bytes, 0);
    const bigTotalBytes = transport.sent
      .filter((s) => s.msg.type === 'agent_event' && (s.msg as AgentEventNotification).sessionId === 'big')
      .reduce((sum, s) => sum + s.bytes, 0);

    // Round-robin: the small session waits behind at most ONE big frame, not 20.
    expect(smallIndex).toBe(1);
    expect(bytesBeforeSmall).toBeLessThan(bigTotalBytes / (FRAMES - 1));
    // And all of the big session's frames still arrive.
    expect(events.filter((e) => e.sessionId === 'big')).toHaveLength(FRAMES);
  });

  it('honours process.send backpressure: stops writing until the channel flushes', async () => {
    await spawn('s1');
    const conv = conversationFor(0);
    const ackWrites = transport.writeCount();

    transport.setBlockAfter(ackWrites + 1); // the very next write backpressures
    for (let i = 0; i < 10; i++) harness.emit(conv, tokenEvent(`t${i}`));
    await flush();

    // Exactly one event frame got out; the rest stayed in the bounded queue.
    expect(transport.events()).toHaveLength(1);

    transport.drain();
    await flush();
    expect(transport.events()).toHaveLength(10);
  });

  it('does not treat harness.message_complete as the end of a turn', async () => {
    // Regression: the host keyed on 'chat.message_complete' — a kind nothing
    // emits. The real kind, 'harness.message_complete', fires several times per
    // agentic turn and must NOT end it.
    await spawn('s1');
    const conv = conversationFor(0);
    server.onMessage({ type: 'send_turn', reqId: nextReqId(), sessionId: 's1', prompt: 'hi' });
    await flush();

    harness.emit(conv, { kind: 'harness.message_complete', data: { content: 'partial' }, timestamp: '' } as never);
    await flush();
    expect(transport.ended()).toHaveLength(0);

    harness.emit(conv, idleEvent());
    await flush();
    expect(transport.ended()).toEqual([{ type: 'session_ended', sessionId: 's1', reason: 'complete' }]);
  });

  it('delivers session_ended AFTER the events queued ahead of it', async () => {
    await spawn('s1');
    const conv = conversationFor(0);
    server.onMessage({ type: 'send_turn', reqId: nextReqId(), sessionId: 's1', prompt: 'hi' });
    await flush();

    transport.setBlockAfter(transport.writeCount() + 1);
    harness.emit(conv, tokenEvent('a'));
    harness.emit(conv, tokenEvent('b'));
    harness.emit(conv, idleEvent());
    await flush();
    transport.drain();
    await flush();

    const streamed = transport.sent
      .filter((s) => s.msg.type === 'agent_event' || s.msg.type === 'session_ended')
      .map((s) => s.msg.type);
    expect(streamed[streamed.length - 1]).toBe('session_ended');
  });

  // ── B1: one throwing process.send must not park the pump ───────────────────
  it('a throwing process.send does not strand session_ended or park the pump', async () => {
    // Regression (BLOCKER B1): `write()` caught the throw and returned false,
    // which stopped `drainTo`. Nothing set `ipcBlocked`, so no flush callback
    // was ever coming to re-arm the pump, and `schedulePump` had already been
    // consumed — so every frame still queued behind the throwing one (here the
    // turn's `session_ended`) sat in the queue forever and the turn never
    // settled. Silent: no error to the gateway, no timeout, just a hang.
    await spawn('s1');
    const conv = conversationFor(0);
    server.onMessage({ type: 'send_turn', reqId: nextReqId(), sessionId: 's1', prompt: 'hi' });
    await flush();

    transport.throwNext(1);
    harness.emit(conv, tokenEvent('a'));
    harness.emit(conv, idleEvent());

    await vi.waitFor(
      () => {
        expect(transport.ended()).toHaveLength(1);
      },
      { timeout: 2000, interval: 10 },
    );

    // The frame the throw ate is re-delivered, not silently dropped.
    const texts = tokenTexts(transport.events());
    expect(texts).toEqual(['a']);
    expect(transport.ended()[0]).toMatchObject({ sessionId: 's1', reason: 'complete' });
  });

  it('a write that fails on its flush callback is retried, not lost', async () => {
    // Same defect on the asynchronous half: `process.send` accepted the frame,
    // returned false, and then reported an error on the callback. The callback
    // cleared `ipcBlocked` and re-armed the pump, but the frame it had already
    // shifted out of the queue was gone.
    await spawn('s1');
    const conv = conversationFor(0);
    server.onMessage({ type: 'send_turn', reqId: nextReqId(), sessionId: 's1', prompt: 'hi' });
    await flush();

    transport.failAsyncNext(1);
    harness.emit(conv, tokenEvent('only-token'));
    harness.emit(conv, idleEvent());

    await vi.waitFor(
      () => {
        expect(transport.ended()).toHaveLength(1);
      },
      { timeout: 2000, interval: 10 },
    );
    const texts = tokenTexts(transport.events());
    expect(texts).toEqual(['only-token']);
  });

  it('re-spawning the same sessionId does not leak the previous subscription', async () => {
    // Regression: unsubscribe handles were stashed on dynamic `_unsub_<id>`
    // properties, so a second spawn overwrote (and leaked) the first.
    await spawn('s1');
    const firstConv = conversationFor(0);
    expect(harness.subscriberCount(firstConv)).toBe(1);

    await spawn('s1');
    expect(harness.subscriberCount(firstConv)).toBe(0);
    expect(harness.subscriberCount(conversationFor(1))).toBe(1);
  });

  it('delete_session tears the subscription down even when the runtime is gone', async () => {
    // Regression: teardown lived inside `if (runtime && conversationId)`, so a
    // session whose runtime had vanished leaked its harness subscription.
    await spawn('s1');
    const conv = conversationFor(0);
    const supervisor = (server as unknown as { supervisor: RuntimeSupervisor }).supervisor;
    for (const rt of supervisor.all()) supervisor.remove(rt.id);

    server.onMessage({ type: 'delete_session', reqId: nextReqId(), sessionId: 's1' });
    await flush();

    expect(harness.subscriberCount(conv)).toBe(0);
    expect(server.activeSessionIds()).toEqual([]);
    expect(transport.sent.some((s) => s.msg.type === 'ack')).toBe(true);
  });

  it('bounds cold starts with its own narrow semaphore', async () => {
    // Regression: turning the agent host ON removed the bound the in-process
    // path had — `spawn_session` awaited createConversation with no semaphore.
    let release: (() => void) | undefined;
    harness.createGate = () => new Promise<void>((r) => { release = r; });

    const bounded = new AgentHostServer({ logger, send: transport.send, maxConcurrentColdStarts: 1 });
    bounded.registerHarness(harness.asHarness());

    bounded.onMessage({ type: 'spawn_session', reqId: nextReqId(), sessionId: 'a', params: {} });
    bounded.onMessage({ type: 'spawn_session', reqId: nextReqId(), sessionId: 'b', params: {} });
    await flush();

    expect(harness.createStarted).toBe(1);
    expect(bounded.concurrencyStats().coldStartQueueDepth).toBe(1);

    release?.();
    harness.createGate = undefined;
    await flush();
    expect(harness.createStarted).toBe(2);
  });

  it('bounds concurrent turns and releases the permit on the terminal event', async () => {
    const bounded = new AgentHostServer({ logger, send: transport.send, maxConcurrentExecutions: 1 });
    bounded.registerHarness(harness.asHarness());
    bounded.onMessage({ type: 'spawn_session', reqId: nextReqId(), sessionId: 'a', params: {} });
    bounded.onMessage({ type: 'spawn_session', reqId: nextReqId(), sessionId: 'b', params: {} });
    await flush();
    const [convA] = [...harness.conversations];

    bounded.onMessage({ type: 'send_turn', reqId: 'turn-a', sessionId: 'a', prompt: 'p' });
    bounded.onMessage({ type: 'send_turn', reqId: 'turn-b', sessionId: 'b', prompt: 'p' });
    await flush();

    // Only the first turn was admitted; the second is queued on the semaphore.
    expect(harness.prompts).toHaveLength(1);
    expect(bounded.concurrencyStats().executionQueueDepth).toBe(1);

    harness.emit(convA!, idleEvent());
    await flush();
    expect(harness.prompts).toHaveLength(2);
  });

  it('migrates live sessions onto the replacement runtime during a recycle', async () => {
    // W12 drain-and-swap, end to end: the gateway's sessionId is unchanged, so
    // a recycle is invisible from its side.
    const replacement = new FakeHarness('replacement');
    const recycling = new AgentHostServer({
      logger,
      send: transport.send,
      createHarness: async () => replacement.asHarness(),
      supervisorOptions: { probeRss: async () => 10, maxRuntimeAgeMs: -1 },
    });
    recycling.registerHarness(harness.asHarness());
    recycling.onMessage({ type: 'spawn_session', reqId: nextReqId(), sessionId: 's1', params: { model: 'opus' } });
    await flush();
    const originalConv = [...harness.conversations][0]!;

    const supervisor = (recycling as unknown as { supervisor: RuntimeSupervisor }).supervisor;
    await supervisor.runRecyclePass();

    expect(harness.stopped).toBe(true);
    expect(recycling.activeSessionIds()).toEqual(['s1']);
    // The old harness no longer feeds the session…
    expect(harness.subscriberCount(originalConv)).toBe(0);
    // …and the new one does, under the same IPC sessionId.
    const newConv = [...replacement.conversations][0]!;
    expect(replacement.subscriberCount(newConv)).toBe(1);

    replacement.emit(newConv, tokenEvent('after-recycle'));
    await flush();
    expect(transport.events().some((e) => e.sessionId === 's1')).toBe(true);
  });

  // ── B3: a recycle must not destroy a live turn or the conversation history ──
  it('defers a recycle while a turn is in flight instead of destroying it', async () => {
    // Regression (BLOCKER B3): drain-and-swap re-created the session on the
    // replacement and released the turn permit, but the prompt was running on
    // the OLD harness — which was then stopped. No `session_ended` was ever
    // sent, so the gateway went on believing the turn was live and
    // `sendPromptAndWait` hung forever. Nothing was logged.
    const replacement = new FakeHarness('replacement');
    const recycling = new AgentHostServer({
      logger,
      send: transport.send,
      createHarness: async () => replacement.asHarness(),
      supervisorOptions: { probeRss: async () => 10, maxRuntimeAgeMs: -1 },
    });
    recycling.registerHarness(harness.asHarness());
    recycling.onMessage({ type: 'spawn_session', reqId: nextReqId(), sessionId: 's1', params: { conversationId: 'c1' } });
    await flush();
    const conv = [...harness.conversations][0]!;

    recycling.onMessage({ type: 'send_turn', reqId: nextReqId(), sessionId: 's1', prompt: 'hi' });
    await flush();
    expect(harness.prompts).toHaveLength(1);

    const supervisor = (recycling as unknown as { supervisor: RuntimeSupervisor }).supervisor;
    await supervisor.runRecyclePass();
    await flush();

    // The runtime running the turn is left alone, and the turn is untouched.
    expect(harness.stopped).toBe(false);
    expect(replacement.createStarted).toBe(0);
    expect(transport.ended()).toHaveLength(0);
    expect(logger.lines.some((l) => l.includes('turn in flight'))).toBe(true);

    // Once the turn ends, the next pass recycles normally.
    harness.emit(conv, idleEvent());
    await flush();
    expect(transport.ended()).toHaveLength(1);

    await supervisor.runRecyclePass();
    await flush();
    expect(harness.stopped).toBe(true);
    expect(recycling.activeSessionIds()).toEqual(['s1']);
  });

  it('carries the provider-side resume token onto the replacement runtime', async () => {
    // Regression (BLOCKER B3): the replacement was handed the same
    // CreateConversationParams and nothing else, and those params carry no
    // resume field — so the new runtime started a COLD provider session and the
    // conversation silently lost its entire history mid-chat.
    const replacement = new FakeHarness('replacement');
    const recycling = new AgentHostServer({
      logger,
      send: transport.send,
      createHarness: async () => replacement.asHarness(),
      supervisorOptions: { probeRss: async () => 10, maxRuntimeAgeMs: -1 },
    });
    recycling.registerHarness(harness.asHarness());
    recycling.onMessage({ type: 'spawn_session', reqId: nextReqId(), sessionId: 's1', params: { conversationId: 'c1', model: 'opus' } });
    await flush();
    const conv = [...harness.conversations][0]!;

    const supervisor = (recycling as unknown as { supervisor: RuntimeSupervisor }).supervisor;
    await supervisor.runRecyclePass();
    await flush();

    expect(replacement.createParams).toHaveLength(1);
    expect(replacement.createParams[0]).toMatchObject({
      model: 'opus',
      conversationId: conv,
      resumeProviderSessionId: `sdk-${conv}`,
    });
  });

  it('reports a migration failure to the gateway rather than stranding the session', async () => {
    const replacement = new FakeHarness('replacement');
    replacement.failCreate = new Error('cannot rebuild');
    const recycling = new AgentHostServer({
      logger,
      send: transport.send,
      createHarness: async () => replacement.asHarness(),
      supervisorOptions: { probeRss: async () => 10, maxRuntimeAgeMs: -1 },
    });
    recycling.registerHarness(harness.asHarness());
    recycling.onMessage({ type: 'spawn_session', reqId: nextReqId(), sessionId: 's1', params: {} });
    await flush();

    const supervisor = (recycling as unknown as { supervisor: RuntimeSupervisor }).supervisor;
    await supervisor.runRecyclePass();
    await flush();

    expect(recycling.activeSessionIds()).toEqual([]);
    expect(transport.ended()).toEqual([
      { type: 'session_ended', sessionId: 's1', reason: 'error', error: expect.stringContaining('recycled') },
    ]);
  });

  it('builds a runtime on demand when boot never produced one', async () => {
    // index.ts treats a failed boot as non-fatal and says the host "will retry
    // on demand"; with no runtime and no factory that was a permanent
    // NO_RUNTIME with nothing to retry it.
    const late = new FakeHarness('late');
    let built = 0;
    const empty = new AgentHostServer({
      logger,
      send: transport.send,
      createHarness: async () => { built++; return late.asHarness(); },
    });
    // Deliberately no registerHarness — this is the failed-boot state.

    empty.onMessage({ type: 'spawn_session', reqId: nextReqId(), sessionId: 'a', params: {} });
    empty.onMessage({ type: 'spawn_session', reqId: nextReqId(), sessionId: 'b', params: {} });
    await flush();

    // One runtime for the burst, not one per spawn.
    expect(built).toBe(1);
    expect(empty.activeSessionIds().sort()).toEqual(['a', 'b']);
  });

  it('still reports NO_RUNTIME when there is no factory to build one', async () => {
    const empty = new AgentHostServer({ logger, send: transport.send });
    empty.onMessage({ type: 'spawn_session', reqId: 'r', sessionId: 'a', params: {} });
    await flush();
    expect(transport.sent[0]?.msg).toMatchObject({ type: 'error', code: 'NO_RUNTIME' });
  });

  it('reports queue and drop statistics', async () => {
    await spawn('s1');
    const stats = server.demuxStats();
    expect(stats.droppedFrames).toBe(0);
    expect(server.activeSessionIds()).toEqual(['s1']);
  });
});
