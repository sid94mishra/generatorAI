// ────────────────────────────────────────────────────────────────
// AgentTokenStream — the Phase 4 EventBus subscriber.
//
// The EventBus is faked down to what this module actually uses
// (`subscribe(sessionId, handler)` returning an unsubscribe), so these tests
// cover the part that is easy to get wrong and invisible in production:
// the handoff between a producer that pushes whenever the agent emits and a
// consumer that pulls whenever synthesis is ready for more. Specifically —
// ordering, buffering when the consumer is behind, waiting when the consumer
// is ahead, draining before reporting done, terminal-event completion, and
// (the leak) whether the EventBus listener is always detached.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import type { EventBus } from '../../../events/EventBus.js';
import type { PersistedEvent } from '@generatorai/shared';
import { subscribeAgentTokenStream } from '../AgentTokenStream.js';

type Handler = (event: PersistedEvent) => void;

/** Minimal EventBus stand-in that lets a test drive the subscriber directly. */
function fakeEventBus() {
  const handlers = new Map<string, Handler>();
  const unsubscribe = vi.fn();
  const bus = {
    subscribe: vi.fn((sessionId: string, handler: Handler) => {
      handlers.set(sessionId, handler);
      return () => {
        handlers.delete(sessionId);
        unsubscribe();
      };
    }),
  } as unknown as EventBus;

  const fire = (sessionId: string, kind: string, data: unknown): void => {
    handlers.get(sessionId)?.({ id: 1, sessionId, sequenceId: 1, kind, data, timestamp: 0 } as PersistedEvent);
  };
  const token = (sessionId: string, text: string): void => fire(sessionId, 'harness.token', { text });

  return { bus, fire, token, unsubscribe, handlerCount: () => handlers.size };
}

function fakeLogger() {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn(() => logger) };
  return logger;
}

/** Drain an iterable that is expected to terminate. */
async function collect(iter: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('subscribeAgentTokenStream', () => {
  it('subscribes to the session channel with an identifying name', () => {
    const { bus } = fakeEventBus();
    subscribeAgentTokenStream(bus, 'sess-1');

    expect(bus.subscribe).toHaveBeenCalledWith('sess-1', expect.any(Function), 'voice-tts:sess-1');
  });

  it('yields harness.token deltas in generation order', async () => {
    const { bus, token, fire } = fakeEventBus();
    const stream = subscribeAgentTokenStream(bus, 's');

    token('s', 'Hello ');
    token('s', 'world.');
    fire('s', 'harness.turn_end', { turnId: 't1' });

    expect(await collect(stream.text)).toEqual(['Hello ', 'world.']);
  });

  it('ignores non-token events and tokens with no usable text', async () => {
    const { bus, token, fire } = fakeEventBus();
    const stream = subscribeAgentTokenStream(bus, 's');

    fire('s', 'harness.tool_start', { tool: 'bash', args: {} });
    fire('s', 'harness.reasoning_delta', { text: 'thinking out loud' });
    fire('s', 'harness.token', { text: '' });
    fire('s', 'harness.token', {});
    fire('s', 'harness.token', null);
    token('s', 'real');
    fire('s', 'harness.turn_end', { turnId: 't1' });

    // Reasoning is deliberately NOT spoken — only the answer is.
    expect(await collect(stream.text)).toEqual(['real']);
  });

  it('hands a delta straight to a consumer that is already waiting for one', async () => {
    const { bus, token, fire } = fakeEventBus();
    const stream = subscribeAgentTokenStream(bus, 's');
    const iterator = stream.text[Symbol.asyncIterator]();

    // Consumer asks first — nothing is buffered yet.
    const pending = iterator.next();
    token('s', 'later');

    expect(await pending).toEqual({ value: 'later', done: false });
    fire('s', 'harness.turn_end', {});
  });

  it('drains already-buffered deltas before reporting done', async () => {
    const { bus, token, fire } = fakeEventBus();
    const stream = subscribeAgentTokenStream(bus, 's');

    token('s', 'a');
    token('s', 'b');
    // Turn ends with two deltas still unread — they must still be spoken.
    fire('s', 'harness.turn_end', {});

    expect(await collect(stream.text)).toEqual(['a', 'b']);
  });

  it.each([
    ['harness.turn_end', { turnId: 't' }],
    ['harness.idle', {}],
    ['harness.error', { message: 'boom' }],
    ['harness.cancelled', { reason: 'user_abort' }],
  ])('completes the stream on %s', async (kind, data) => {
    const { bus, token, fire } = fakeEventBus();
    const stream = subscribeAgentTokenStream(bus, 's');

    token('s', 'x');
    fire('s', kind, data);

    expect(await collect(stream.text)).toEqual(['x']);
  });

  it('resolves a waiting consumer when the turn ends with nothing more to say', async () => {
    const { bus, fire } = fakeEventBus();
    const stream = subscribeAgentTokenStream(bus, 's');
    const iterator = stream.text[Symbol.asyncIterator]();

    const pending = iterator.next();
    fire('s', 'harness.turn_end', {});

    expect((await pending).done).toBe(true);
  });

  // ── Teardown: the leak this module is most likely to cause ──────

  it('detaches the EventBus listener when the turn ends', async () => {
    const { bus, token, fire, unsubscribe, handlerCount } = fakeEventBus();
    const stream = subscribeAgentTokenStream(bus, 's');

    token('s', 'x');
    fire('s', 'harness.turn_end', {});
    await collect(stream.text);

    expect(unsubscribe).toHaveBeenCalled();
    expect(handlerCount()).toBe(0);
  });

  it('detaches the listener on an explicit close() — the barge-in path', () => {
    const { bus, unsubscribe, handlerCount } = fakeEventBus();
    const stream = subscribeAgentTokenStream(bus, 's');

    stream.close();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(handlerCount()).toBe(0);
  });

  it('close() is idempotent — a barge-in AND a socket close must not double-unsubscribe', () => {
    const { bus, unsubscribe } = fakeEventBus();
    const stream = subscribeAgentTokenStream(bus, 's');

    stream.close();
    stream.close();
    stream.close();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('detaches the listener when the consumer breaks out of its for-await early', async () => {
    const { bus, token, unsubscribe } = fakeEventBus();
    const stream = subscribeAgentTokenStream(bus, 's');

    token('s', 'a');
    token('s', 'b');
    const seen: string[] = [];
    for await (const delta of stream.text) {
      seen.push(delta);
      break; // barge-in mid-utterance
    }

    expect(seen).toEqual(['a']);
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('stops accepting deltas after close(), so a late event cannot resurrect the stream', async () => {
    const { bus, token, fire } = fakeEventBus();
    const stream = subscribeAgentTokenStream(bus, 's');

    token('s', 'a');
    stream.close();
    // The handler is detached, but fire directly at it anyway to prove the
    // internal `closed` guard holds even if the bus were to deliver late.
    fire('s', 'harness.token', { text: 'ghost' });

    expect(await collect(stream.text)).toEqual(['a']);
  });

  // ── Safety valve ────────────────────────────────────────────────

  it('drops the TAIL and warns once when synthesis falls too far behind generation', async () => {
    const { bus, token, fire } = fakeEventBus();
    const logger = fakeLogger();
    const stream = subscribeAgentTokenStream(bus, 's', logger, { maxBufferedChars: 10 });

    token('s', '12345');
    token('s', '67890');
    token('s', 'this one overflows');
    token('s', 'so does this one');
    fire('s', 'harness.turn_end', {});

    // Coherent prefix kept; overflow discarded rather than leaving a hole.
    expect(await collect(stream.text)).toEqual(['12345', '67890']);
    const warnings = logger.warn.mock.calls.filter((c) => String(c[0]).includes('character bound'));
    expect(warnings).toHaveLength(1);
  });

  it('the buffer bound applies to what is QUEUED, not to what a waiting consumer takes directly', async () => {
    const { bus, token, fire } = fakeEventBus();
    const stream = subscribeAgentTokenStream(bus, 's', undefined, { maxBufferedChars: 4 });
    const iterator = stream.text[Symbol.asyncIterator]();

    // A consumer keeping up takes each delta immediately, so a long stream
    // never touches the bound however much text flows through it.
    const pendingA = iterator.next();
    token('s', 'a much longer delta than the bound');
    expect((await pendingA).value).toBe('a much longer delta than the bound');

    const pendingB = iterator.next();
    token('s', 'and another long one');
    expect((await pendingB).value).toBe('and another long one');

    fire('s', 'harness.turn_end', {});
  });

  it('frees buffered characters as they are consumed, so a slow-but-keeping-up consumer never trips the bound', async () => {
    const { bus, token, fire } = fakeEventBus();
    const stream = subscribeAgentTokenStream(bus, 's', undefined, { maxBufferedChars: 10 });
    const iterator = stream.text[Symbol.asyncIterator]();

    for (let i = 0; i < 20; i++) {
      token('s', 'abcde'); // 5 chars queued…
      expect((await iterator.next()).value).toBe('abcde'); // …then immediately drained
    }

    fire('s', 'harness.turn_end', {});
    expect((await iterator.next()).done).toBe(true);
  });

  it('honours a custom terminalKinds override', async () => {
    const { bus, token, fire } = fakeEventBus();
    const stream = subscribeAgentTokenStream(bus, 's', undefined, { terminalKinds: ['harness.usage'] });

    token('s', 'x');
    fire('s', 'harness.turn_end', {}); // no longer terminal
    token('s', 'y');
    fire('s', 'harness.usage', { model: 'm', inputTokens: 1, outputTokens: 1 });

    expect(await collect(stream.text)).toEqual(['x', 'y']);
  });
});
