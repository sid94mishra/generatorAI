// ────────────────────────────────────────────────────────────────
// AgentTokenStream — the Phase 4 EventBus subscriber.
//
// VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part E Phase 4 asks for a
// "sentence-boundary `EventBus` subscriber (attaches only when `speak()` has
// been invoked in streaming mode for that session — never an always-on tax),
// pipelined synthesis overlapped with continued generation". Part B.5 draws
// the same thing:
//
//   Agent turn streams via the EXISTING harness.token EventBus (no new plumbing)
//      → (only when speak() has been invoked for that session) sentence-boundary
//        buffer → VoiceService.speak() → Kokoro → audio chunks streamed to client
//
// This file is the first arrow. It turns a chat's live `harness.token` event
// stream into the `AsyncIterable<string>` that `VoiceService.speak()` has
// accepted since Phase 0 — the sentence-boundary buffering itself already
// lives one layer down, in `TtsSessionRunner`/`SentenceBoundaryBuffer`, so
// nothing here needs to know what a sentence is.
//
// "Never an always-on tax" is structural, not a comment: `subscribe()` is
// only ever called from the `speak_stream` branch of the TTS WebSocket, and
// the returned `close()` detaches the one EventBus listener it added. No
// listener exists for a chat nobody asked to have read aloud.
//
// Consumed by: apps/server/src/tts-ws.ts
// ────────────────────────────────────────────────────────────────

import type { ILogger, PersistedEvent } from '@generatorai/shared';
import type { EventBus } from '../../events/EventBus.js';

/**
 * Event kinds that end a turn, and therefore the spoken stream. `turn_end`
 * is the precise signal; the other three are the ways a turn can stop
 * without reaching it. Listening for all four means a stream never hangs
 * open waiting for audio that is never coming.
 */
const DEFAULT_TERMINAL_KINDS: readonly string[] = [
  'harness.turn_end',
  'harness.idle',
  'harness.error',
  'harness.cancelled',
];

/**
 * Safety valve only. Speech is far slower than token generation, so the
 * buffer legitimately grows during a long answer — that lag IS the feature.
 * This bound exists so a runaway agent can't grow it without limit; at
 * ~15 chars/spoken-second it is roughly two hours of backlog, which no real
 * turn reaches.
 */
const DEFAULT_MAX_BUFFERED_CHARS = 100_000;

export interface AgentTokenStreamOptions {
  /** Override the kinds that terminate the stream. */
  terminalKinds?: readonly string[];
  /** Override the buffered-character safety bound. */
  maxBufferedChars?: number;
}

export interface AgentTokenStreamHandle {
  /** The agent's text, delta by delta, in generation order. */
  readonly text: AsyncIterable<string>;
  /**
   * Detach the EventBus listener and end the iterable. Idempotent — safe to
   * call from both a barge-in `stop()` and a WebSocket `close` handler.
   */
  close(): void;
}

/**
 * Attach to `sessionId`'s live token stream. This is a chat's `sessionId` —
 * the EventBus channel `ChatManagementService` emits harness events on — and
 * NOT the chat id; passing the latter subscribes to a channel nothing ever
 * emits on, which fails silently as "no audio". The returned iterable yields
 * each `harness.token` delta and completes when the turn ends (or `close()`
 * is called).
 *
 * Deliberately yields RAW deltas rather than whole messages: feeding
 * `speak()` the finished `harness.message_complete` content would be Phase
 * 3's behaviour with extra latency, not Phase 4's — the whole point is that
 * synthesis of sentence N overlaps generation of sentence N+1.
 */
export function subscribeAgentTokenStream(
  eventBus: EventBus,
  sessionId: string,
  logger?: ILogger,
  opts?: AgentTokenStreamOptions,
): AgentTokenStreamHandle {
  const terminalKinds = new Set(opts?.terminalKinds ?? DEFAULT_TERMINAL_KINDS);
  const maxBufferedChars = opts?.maxBufferedChars ?? DEFAULT_MAX_BUFFERED_CHARS;

  const pending: string[] = [];
  let pendingChars = 0;
  let overflowWarned = false;
  /** Resolver for a consumer that asked for a delta before one arrived. */
  let waiting: ((result: IteratorResult<string>) => void) | null = null;
  let closed = false;

  const unsubscribe = eventBus.subscribe(
    sessionId,
    (event: PersistedEvent) => {
      if (closed) return;
      if (terminalKinds.has(event.kind)) {
        close();
        return;
      }
      if (event.kind !== 'harness.token') return;
      const text = (event.data as { text?: unknown } | null)?.text;
      if (typeof text !== 'string' || text.length === 0) return;

      // A consumer already waiting takes the delta directly — nothing is
      // buffered, so the bound below doesn't apply to it.
      const resolve = waiting;
      if (resolve) {
        waiting = null;
        resolve({ value: text, done: false });
        return;
      }

      if (pendingChars + text.length > maxBufferedChars) {
        // Drop the TAIL, not the middle: speech that stops early is
        // coherent, speech with a hole in it is not.
        if (!overflowWarned) {
          overflowWarned = true;
          logger?.warn?.(
            `[tts] read-aloud buffer for session ${sessionId} hit the ${maxBufferedChars}-character bound — synthesis is too far behind generation; the rest of this turn will not be spoken.`,
          );
        }
        return;
      }

      pending.push(text);
      pendingChars += text.length;
    },
    `voice-tts:${sessionId}`,
  );

  function close(): void {
    if (closed) return;
    closed = true;
    unsubscribe();
    const resolve = waiting;
    if (resolve) {
      waiting = null;
      resolve({ value: undefined as unknown as string, done: true });
    }
  }

  const text: AsyncIterable<string> = {
    [Symbol.asyncIterator](): AsyncIterator<string> {
      return {
        next(): Promise<IteratorResult<string>> {
          const buffered = pending.shift();
          if (buffered !== undefined) {
            pendingChars -= buffered.length;
            return Promise.resolve({ value: buffered, done: false });
          }
          // Drain before reporting done, so a close() that races an
          // already-queued delta still speaks it.
          if (closed) return Promise.resolve({ value: undefined as unknown as string, done: true });
          return new Promise<IteratorResult<string>>((resolve) => {
            waiting = resolve;
          });
        },
        // Called when the consumer breaks out of its `for await` (barge-in,
        // WS close). Without this the EventBus listener would outlive the
        // only thing that wanted it.
        return(): Promise<IteratorResult<string>> {
          close();
          return Promise.resolve({ value: undefined as unknown as string, done: true });
        },
      };
    },
  };

  return { text, close };
}
